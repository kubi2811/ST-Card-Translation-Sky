/**
 * src/lib/mvuzod/gameUiAgent.ts — Trái tim Game UI Studio (agent loop + validate-fix)
 * ──────────────────────────────────────────────────────────────────────────────
 * 1 lượt user → gọi AI (XML out) → áp action vào store → KIỂM 4 tầng → nếu lỗi thì bơm report
 * ngược cho AI TỰ SỬA (tối đa MAX_FIX_ROUNDS) → lặp tới khi <done/> hoặc MAX_LOOPS.
 * Tối ưu Gemini 3.1 Pro: max_tokens ≥ 60k (chống output cắt cụt — lý do #1 bản cũ vỡ), ít call to.
 */
import { v4 as uuidv4 } from 'uuid';
import { callAI } from '../ai/client';
import type { ProxyProfile, GenerationParams, ChatMessage } from '../../types';
import type { MVUZODSchema, InitVarConfig } from '../../types/mvuzod.types';
import { useGameStudioStore, type StudioActionSummary } from '../../store/gameStudioStore';
import { buildGameUiSystemPrompt } from '../../prompts/gameUiStudioPrompt';
import {
  validateRegexDraft, collectSchemaVarNames, collectInitVarNames, reportToXml,
  type ValidationIssue,
} from './gameUiValidator';
import {
  stripCdata, tagInner, tagAttr, allBlocks, hasDoneTag,
  applyOneEdit, extractSearchReplacePairs, parseSetRegex,
} from './gameUiXml';

const MAX_LOOPS = 6;
const MAX_FIX_ROUNDS = 3;
const MIN_OUTPUT_TOKENS = 60000;

export interface GameUiAgentDeps {
  schema: MVUZODSchema | null | undefined;
  /** Bộ initvar (giá trị khởi tạo thật) — UI phải đồng biến với CẢ schema lẫn initvar. */
  initVarConfig?: InitVarConfig | null;
  profile: ProxyProfile;
  params: GenerationParams;
  signal: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════════════════
export async function runGameUiTurn(userMessage: string, deps: GameUiAgentDeps): Promise<void> {
  const store = useGameStudioStore;
  const st = () => store.getState();
  const abortCheck = () => { if (deps.signal.aborted || st().stopped) throw new DOMException('Người dùng đã dừng', 'AbortError'); };

  st().appendMessage({ id: uuidv4(), role: 'user', content: userMessage });

  // Tập biến hợp lệ = schema ∪ initvar (đồng biến 2 nguồn). Thiếu initvar thì biến chỉ khai
  // trong initvar sẽ bị báo "bịa" oan, còn thiếu chốt error thì biến bịa lọt lưới.
  const schemaVars = [...new Set([
    ...collectSchemaVarNames(deps.schema),
    ...collectInitVarNames(deps.initVarConfig),
  ])];
  let loops = 0;
  let consecutiveFails = 0;
  let pendingInject: string | null = null;

  try {
    while (loops < MAX_LOOPS) {
      abortCheck();
      loops++;
      const isFix = pendingInject != null;
      st().setPhase('thinking');
      st().setStatus(isFix ? `AI tự sửa (vòng ${consecutiveFails})…` : `AI đang nghĩ (lượt ${loops})…`);

      const system = buildGameUiSystemPrompt(deps.schema, st().components, st().regexDraft, st().sampleOutput, st().validation, schemaVars);
      const history: ChatMessage[] = st().messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        ...history,
        ...(pendingInject ? [{ role: 'user' as const, content: `Kết quả kiểm tự động (ẩn với user) — hãy SỬA rồi gửi lại:\n${pendingInject}` }] : []),
      ];
      const params: GenerationParams = {
        ...deps.params,
        max_tokens: Math.max(deps.params.max_tokens || 0, MIN_OUTPUT_TOKENS),
        temperature: isFix ? 0.3 : 0.7,
        stream: false,
        useJsonResponseFormat: false,
      };

      abortCheck();
      const raw = await callAI({ profile: deps.profile, params, messages, signal: deps.signal, label: 'Game UI Studio' });
      abortCheck();
      const text = raw.text || '';

      // ─── Áp actions ───
      const actions: StudioActionSummary[] = [];
      const editIssues: ValidationIssue[] = [];

      const sample = tagInner(text, 'sample_output');
      if (sample != null) st().setSampleOutput(stripCdata(sample).trim());

      for (const b of allBlocks(text, 'write_component')) {
        const id = tagAttr(b.attrs, 'id') || 'component';
        const name = tagAttr(b.attrs, 'name') || id;
        const html = stripCdata(b.inner).trim();
        st().upsertComponent(id, name, html);
        actions.push({ kind: 'write', label: `✍️ ${id} ${(html.length / 1024).toFixed(1)}KB` });
      }

      for (const b of allBlocks(text, 'edit_component')) {
        const id = tagAttr(b.attrs, 'id');
        const comp = st().components[id];
        if (!comp) { editIssues.push({ level: 'error', code: 'EDIT_MISMATCH', message: `edit_component id="${id}" không tồn tại — dùng write_component để tạo mới, hoặc sửa đúng id.` }); continue; }
        const pairs = extractSearchReplacePairs(b.inner);
        let html = comp.html; let applied = 0;
        for (const p of pairs) {
          const r = applyOneEdit(html, p.search, p.replace);
          if (r.ok) { html = r.html; applied++; }
          else editIssues.push({ level: 'error', code: 'EDIT_MISMATCH', message: `edit_component "${id}": không tìm thấy đoạn <search> "${p.search.slice(0, 50)}…" trong component. Sao chép ĐÚNG NGUYÊN VĂN đoạn hiện có rồi gửi lại.` });
        }
        if (applied) st().upsertComponent(id, comp.name, html);
        actions.push({ kind: 'edit', label: `✏️ ${id} ${applied}/${pairs.length} chỗ sửa` });
      }

      const setRegexBlocks = allBlocks(text, 'set_regex');
      if (setRegexBlocks.length) {
        const draft = [...st().regexDraft];
        for (const b of setRegexBlocks) {
          const script = parseSetRegex(b.inner, st().components);
          if (!script) continue;
          const idx = parseInt(tagAttr(b.attrs, 'index'), 10);
          if (!isNaN(idx) && idx >= 0 && idx < draft.length) draft[idx] = script;
          else draft.push(script);
          actions.push({ kind: 'regex', label: `🔧 ${script.scriptName}` });
        }
        st().setRegexDraft(draft);
      }

      const say = (tagInner(text, 'say') || '').trim();
      st().appendMessage({ id: uuidv4(), role: 'assistant', content: say || '(đã cập nhật)', actions: actions.length ? actions : undefined });

      // ─── KIỂM ───
      st().setPhase('validating');
      const report = validateRegexDraft(st().regexDraft, st().sampleOutput, schemaVars);
      if (editIssues.length) report.issues.unshift(...editIssues);
      report.ok = !report.issues.some((x) => x.level === 'error');
      st().setValidation(report);

      const hasDone = hasDoneTag(text);

      if (report.ok) {
        consecutiveFails = 0;
        pendingInject = null;
        st().appendMessage({ id: uuidv4(), role: 'system-note', content: '✅ Regex qua kiểm tự động (cú pháp + MATCH THẬT sample + biến schema). Xem preview bên phải.', tone: 'ok' });
        if (hasDone) break;
        // không <done/> → AI tự chia việc, lặp tiếp
      } else {
        consecutiveFails++;
        const nErr = report.issues.filter((i) => i.level === 'error').length;
        if (consecutiveFails > MAX_FIX_ROUNDS) {
          st().appendMessage({ id: uuidv4(), role: 'system-note', content: `⚠️ Còn ${nErr} lỗi sau ${MAX_FIX_ROUNDS} vòng tự sửa. Bạn kiểm/sửa tay ở tab Regex, hoặc nhắn AI làm lại.`, tone: 'error' });
          break;
        }
        pendingInject = reportToXml(report);
        st().appendMessage({ id: uuidv4(), role: 'system-note', content: `🔧 Tự sửa (vòng ${consecutiveFails}): còn ${nErr} lỗi cần vá…`, tone: 'info' });
      }
    }
  } finally {
    st().setPhase('done');
    st().setStatus(null);
  }
}
