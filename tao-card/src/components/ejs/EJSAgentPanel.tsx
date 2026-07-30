/**
 * EJSAgentPanel — (Goal 101.2) Chế độ MẶC ĐỊNH của EJS Studio: AI tự quyết.
 * ─────────────────────────────────────────────────────────────────────────────
 * User gõ MỘT yêu cầu → agent lên kế hoạch → user duyệt → chạy → mọi code qua kiểm tự động
 * + tự sửa hội tụ → entry được tạo thẳng vào worldbook, có Hoàn tác. Studio 3 panel cũ vẫn
 * còn nguyên trong chế độ "Nâng cao".
 *
 * ═══ (bug 126) ĐẠI TU ═══
 * User test rồi báo kế hoạch "khá sơ sài và không thực hiện được tất cả yêu cầu". Bản cũ chỉ
 * hiện `scope` (vài câu) + danh sách bước, nên user chỉ duyệt được CẢ CỤC. Nay:
 *   • BẢNG KẾ HOẠCH từng dòng: đối tượng, chế độ kích hoạt hiện tại (MÁY đo từ card, không
 *     phải AI khai), đề xuất, lý do — và nút Đồng ý / Từ chối RIÊNG từng dòng.
 *   • Dòng chỉ đổi chế độ kích hoạt được máy áp thẳng, KHÔNG tốn call AI nào.
 *   • Preset Nhanh cho người mới, mỗi cái nêu công dụng và tự bám ngữ cảnh card thật.
 *   • State nằm ở store nên đổi tab không mất kế hoạch (lên kế hoạch = một call tính tiền),
 *     kèm nút "Làm lại từ đầu" khi user muốn xoá sạch.
 *   • Nút áp chính sách sang Auto Creator, chỉ bật khi card đã tạo xong.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Loader2, Play, Undo2, AlertTriangle, Check, X, BookPlus,
  ListChecks, Square, RotateCcw, Info, ArrowRight,
} from 'lucide-react';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { ChatMessage, LorebookEntry } from '../../types';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useEjsStudioStore } from '../../store/ejsStudioStore';
import { callAI } from '../../lib/ai/client';
import { nextEntryId } from '../../lib/converters/cardDefaults';
import { executeGoalPlan, type AgentCallFn, type GoalRunResult } from '../../lib/ai/goalAgent';
import {
  createEjsDomain, planEjsRich, buildAgentPlanFromRows,
  type EjsDraft, type EjsAgentContext,
} from '../../lib/ejs/ejsAgent';
import {
  ACTIVATION_LABEL, findOrphanConditionalEntries, entriesNeedingLiveActivationCheck,
  liveActivationCheckHint, type EjsPlanRow,
} from '../../lib/ejs/ejsPlanModel';
import { QUICK_PRESETS, PRESET_GROUP_LABEL, type PresetGroup } from '../../lib/ejs/ejsQuickPresets';
import { attributePlanRows } from '../../lib/ejs/ejsPresetAttribution';

/** Thứ tự nhóm preset hiện trên màn — đi từ việc hay dùng nhất tới việc nâng cao. */
const PRESET_GROUP_ORDER: PresetGroup[] = ['all', 'condition', 'mvu', 'ui', 'bigdata', 'dynamic', 'orchestrate'];
import { groupPlanRows, extractEntryRefs } from '../../lib/ejs/ejsPlanGroups';
import {
  buildEditMessages, parseEditResponse, verifyEdit,
  resolveCharacterField, characterFieldLabel, EDITABLE_CHARACTER_FIELDS,
} from '../../lib/ejs/ejsEditActions';
import { buildSplitMessages, parseSplitResponse } from '../../lib/ejs/ejsSplit';
import { scanBrokenRefs, rewriteRefs, fuzzyRepairMapping } from '../../lib/ejs/ejsRefIntegrity';
import { proposeTestValues, simulateActivation } from '../../lib/ejs/ejsTestMode';

interface EJSAgentPanelProps {
  schema: MVUZODSchema | null;
  /** Mở tab Nâng cao + nạp code vào editor để user chỉnh tay tiếp. */
  onOpenInEditor?: (code: string) => void;
}

const ACTION_LABEL: Record<EjsPlanRow['action'], string> = {
  create_ejs: 'Tạo khối EJS',
  reclassify: 'Đổi chế độ kích hoạt',
  edit_content: 'Sửa nội dung',
  edit_character: 'Sửa Character Definition',
  split_entry: 'Tách entry',
};

/** Rút gọn văn bản cho khung trước/sau. */
const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

export function EJSAgentPanel({ schema, onOpenInEditor }: EJSAgentPanelProps) {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card.data.character_book?.entries]);
  const characterName = card.data.name || 'Character';

  const st = useEjsStudioStore();
  const abortRef = useRef<AbortController | null>(null);
  // (bugNeedFix/147) Preset nào đang mở phần giải thích đầy đủ.
  // (bug 159-9) MỞ NHIỀU CÙNG LÚC — trước là một cái một lúc nên không so hai preset cạnh nhau
  // được, mà đây đúng là lúc cần so: chọn cái nào trong 20 cái thì phải đọc song song.
  const [expandedPresets, setExpandedPresets] = useState<Set<string>>(() => new Set());
  // (bug 162 mục 3.1) Preset user vừa chọn — dùng để gắn nhãn cho từng dòng bảng kế hoạch.
  // Dùng ref vì hàm lập kế hoạch đọc giá trị này ngoài chu kỳ render (trong callback async).
  const [activePresetIds, setActivePresetIds] = useState<string[]>([]);
  const activePresetIdsRef = useRef<string[]>([]);
  useEffect(() => { activePresetIdsRef.current = activePresetIds; }, [activePresetIds]);
  const togglePreset = (id: string) => setExpandedPresets((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Đổi card → kế hoạch cũ trỏ vào entry của card khác nên phải bỏ (xem ejsStudioStore).
  const cardKey = card.data.name || '(chưa đặt tên)';
  const ensureCard = st.ensureCard;
  useEffect(() => { ensureCard(cardKey); }, [cardKey, ensureCard]);

  const ctx = useMemo<EjsAgentContext>(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown> | undefined;
    const regexScripts = (ext?.regex_scripts as Array<{ scriptName?: string; replaceString?: string }>) ?? [];
    const th = ext?.tavern_helper as { scripts?: Array<{ name?: string; content?: string }> } | undefined;
    return {
      schema, entries, characterName,
      characterFields: {
        description: card.data.description,
        personality: card.data.personality,
        scenario: card.data.scenario,
        first_mes: card.data.first_mes,
      },
      regexScripts,
      tavernScripts: th?.scripts ?? [],
    };
  }, [schema, entries, characterName, card.data]);

  const domain = useMemo(() => createEjsDomain(ctx), [ctx]);

  const makeCall = useCallback((signal: AbortSignal): AgentCallFn => {
    return async (messages: ChatMessage[], opts) => {
      const profile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!profile?.apiKey) throw new Error('Chưa cấu hình API — vào Cài đặt thêm profile trước.');
      const res = await callAI({
        profile,
        params: {
          ...params,
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
          useJsonResponseFormat: true,
          stream: false,
        },
        messages, signal, label: opts?.label ?? 'EJS Agent',
      });
      return res.text;
    };
  }, []);

  // Preset Nhanh — dựng lại theo ngữ cảnh card thật mỗi khi card đổi.
  const presets = useMemo(
    () => QUICK_PRESETS.map(p => ({
      preset: p,
      built: p.build({ schema, entries, regexScripts: ctx.regexScripts, tavernScripts: ctx.tavernScripts }),
    })),
    [schema, entries, ctx.regexScripts, ctx.tavernScripts],
  );

  // ─── Pha 1: lên kế hoạch ───
  const handlePlan = useCallback(async () => {
    const s = useEjsStudioStore.getState();
    s.setPhase('planning');
    s.setError(null);
    s.setProgress([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const p = await planEjsRich(s.goal, ctx, makeCall(ac.signal), ac.signal);
      // (bug 162 mục 3.1) Gắn nhãn preset cho từng dòng trước khi đưa vào bảng.
      s.setPlan({ ...p, rows: attributePlanRows(p.rows, activePresetIdsRef.current) }, cardKey);
      s.setPhase('review');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { s.setPhase('idle'); return; }
      s.setError(e instanceof Error ? e.message : String(e));
      s.setPhase('idle');
    }
  }, [ctx, makeCall, cardKey]);

  // ─── Pha 2: chạy các dòng ĐÃ DUYỆT ───
  const handleRun = useCallback(async () => {
    const s = useEjsStudioStore.getState();
    const plan = s.plan;
    if (!plan) return;
    const accepted = s.acceptedIds();
    s.setPhase('running');
    s.setError(null);
    s.setProgress([]);
    const ac = new AbortController();
    abortRef.current = ac;

    // Snapshot hoàn tác — chụp TRƯỚC khi đụng vào bất cứ thứ gì, kể cả khi chạy dở bị dừng.
    const changed: Array<{ id: number; enabled: boolean; constant: boolean; keys: string[] }> = [];
    const changedContents: Array<{ id: number; content: string }> = [];
    const createdIds: number[] = [];
    const snap = (e: LorebookEntry) => {
      if (changed.some(c => c.id === e.id)) return;
      changed.push({ id: e.id, enabled: e.enabled, constant: e.constant, keys: [...(e.keys ?? [])] });
    };
    const snapContent = (e: LorebookEntry) => {
      if (changedContents.some(c => c.id === e.id)) return;
      changedContents.push({ id: e.id, content: String(e.content ?? '') });
    };
    // (Goal 28/07) Mapping tên cũ → tên mới (tách/đổi tên) — nguồn để vá tham chiếu getwi.
    const refMapping = new Map<string, string[]>();
    // (bugNeedFix/147 — mục 1&2) SỔ GHI THẬT: đếm đúng số thay đổi ĐÃ VÀO CARD, và gom lý do
    // của những dòng KHÔNG vào được. Trước đây chạy xong là phase 'done' vô điều kiện, khối
    // "✅ Hoàn thành" hiện kèm code in đẹp, trong khi card có thể không đổi một chữ nào —
    // đúng thứ user tả: "báo đã tạo/chạy được nhưng thực tế không có entry nào được sửa/tạo".
    let writes = 0;
    const blockedReasons: string[] = [];
    // Bản cũ của các trường Character Definition bị sửa — để nút Hoàn tác trả lại được.
    const charEdits: Array<{ field: string; before: string }> = [];
    // Phần tách mang mode 'conditional' (tắt sẵn, chờ controller) — phải soát mồ côi kiểu bug 127.
    const conditionalParts: string[] = [];
    s.setBeforeAfter([]);

    try {
      // 2a. Dòng "đổi chế độ kích hoạt" là thao tác CẤU HÌNH thuần — máy làm thẳng, 0 call AI.
      const byName = new Map(entries.map(e => [String(e.comment || `#${e.id}`).trim().toLowerCase(), e]));
      let reclassified = 0;
      for (const r of plan.rows) {
        if (!accepted.has(r.id) || r.action !== 'reclassify' || r.target !== 'lorebook') continue;
        // (bugNeedFix/147) Khớp tên trước đây là so khớp CHÍNH XÁC (chỉ trim+lowercase). AI trả
        // tên kèm dấu nháy, thêm tiền tố "Entry: ", sai một dấu — cả dòng biến mất không dấu vết.
        // Nay: thử khớp gần (bỏ dấu nháy/tiền tố) rồi mới chịu thua, và thua thì NÓI RA.
        const target = byName.get(r.name.trim().toLowerCase())
          ?? byName.get(r.name.trim().toLowerCase().replace(/^["'\u201C\u2018]|["'\u201D\u2019]$/g, '').replace(/^(entry|mục)\s*[:\-]\s*/i, '').trim());
        if (!target) {
          blockedReasons.push(`Không tìm thấy entry tên "${r.name}" trong thẻ — AI có thể đã ghi sai tên. Dòng này bị bỏ qua.`);
          s.pushProgress(`⚠️ Bỏ qua đổi chế độ "${r.name}" — không có entry nào tên như vậy trong thẻ.`);
          continue;
        }
        if (!r.proposedMode) {
          blockedReasons.push(`Dòng "${r.name}" không nêu chế độ kích hoạt đề xuất — không biết đổi sang gì.`);
          continue;
        }
        snap(target);
        // 'conditional' = entry TẮT sẵn, chờ controller EJS gọi activewi bật lên (xem stptApi).
        const patch =
          r.proposedMode === 'constant' ? { constant: true, enabled: true }
          : r.proposedMode === 'keyword' ? { constant: false, enabled: true }
          : r.proposedMode === 'conditional' ? { constant: false, enabled: false }
          : { enabled: false };
        useCardStore.getState().updateEntry(target.id, patch);
        reclassified++;
        writes++;
        s.pushProgress(`⚙️ "${r.name}" → ${ACTIVATION_LABEL[r.proposedMode]}`);
        s.pushBeforeAfter({
          name: r.name, kind: 'reclassified',
          before: r.currentMode ? ACTIVATION_LABEL[r.currentMode] : '(không rõ)',
          after: ACTIVATION_LABEL[r.proposedMode],
        });
      }
      if (reclassified) s.pushProgress(`✅ Đổi chế độ kích hoạt cho ${reclassified} entry (không tốn call AI).`);

      // 2a-bis. (Goal 28/07) DÒNG TÁCH ENTRY — đã duyệt trước trong bảng, giờ mới thực thi.
      // 1 call AI/dòng; validate tất định (đủ phần, không rơi chữ) rồi mới áp. Entry gốc TẮT
      // (không xoá — còn hoàn tác); mapping cũ→mới đưa cho bộ vá tham chiếu ở bước chốt.
      const splitRows = plan.rows.filter(r => accepted.has(r.id) && r.action === 'split_entry');
      for (const r of splitRows) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const original = byName.get(r.name.trim().toLowerCase());
        if (!original) { s.pushProgress(`⚠️ Bỏ qua tách "${r.name}" — không tìm thấy entry trong card.`); continue; }
        s.pushProgress(`✂️ Đang tách "${r.name}" thành ${r.splitInto?.length ?? '?'} phần…`);
        try {
          const raw = await makeCall(ac.signal)(buildSplitMessages(original, r), { temperature: 0.3, label: `EJS Split: ${r.name}` });
          const { parts, warnings } = parseSplitResponse(raw, original, r);
          for (const w of warnings) s.pushProgress(`⚠️ ${w}`);

          let cur = useCardStore.getState().card.data.character_book?.entries ?? [];
          const newNames: string[] = [];
          for (const part of parts) {
            // Tên phần không được trùng entry CÓ SẴN trong card — trùng là getwi/activewi trỏ
            // nhầm (đúng loại xung đột ejsCollision sinh ra để chặn cho khối EJS).
            const taken = new Set(cur.map(e => String(e.comment || `#${e.id}`).trim().toLowerCase()));
            let finalName = part.comment, k = 2;
            while (taken.has(finalName.trim().toLowerCase())) finalName = `${part.comment} (${k++})`;
            if (finalName !== part.comment) {
              s.pushProgress(`⚠️ Tên phần "${part.comment}" trùng entry có sẵn — đã đổi thành "${finalName}".`);
              part.comment = finalName;
            }
            const newId = nextEntryId(cur);
            const newEntry: LorebookEntry = {
              id: newId,
              keys: part.mode === 'keyword' ? part.keys : [],
              secondary_keys: [], comment: part.comment, content: part.content,
              constant: part.mode === 'constant', selective: false,
              insertion_order: original.insertion_order ?? 100,
              enabled: part.mode !== 'conditional' && part.mode !== 'disabled',
              position: original.position ?? 'before_char', use_regex: false,
              extensions: { ...DEFAULT_ENTRY_EXT, display_index: newId },
            };
            addEntry(newEntry);
            createdIds.push(newId);
            writes++;
            cur = [...cur, newEntry];
            newNames.push(part.comment);
            if (part.mode === 'conditional') conditionalParts.push(part.comment);
          }
          snap(original);
          useCardStore.getState().updateEntry(original.id, { enabled: false, constant: false });
          refMapping.set(String(original.comment || `#${original.id}`), newNames);
          s.pushProgress(`✅ Đã tách "${r.name}" → ${newNames.join(' · ')} (entry gốc tắt, còn hoàn tác).`);
          s.pushBeforeAfter({
            name: r.name, kind: 'split',
            before: clip(String(original.content ?? '')),
            after: parts.map(x => `▸ ${x.comment} [${ACTIVATION_LABEL[x.mode]}${x.keys.length ? ` | keys: ${x.keys.join(', ')}` : ''}]\n${clip(x.content, 160)}`).join('\n\n'),
          });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          s.pushProgress(`⚠️ Tách "${r.name}" thất bại: ${e instanceof Error ? e.message : String(e)} — entry gốc giữ nguyên.`);
        }
      }

      // ═══ 2a-ter. (bugNeedFix/147) SỬA NỘI DUNG CÓ SẴN — entry lorebook & Character Definition ═══
      // Hai action này trước đây KHÔNG có đường ghi nào: chúng rơi thẳng vào bước sinh khối EJS
      // mới, nên kết quả là tạo thêm một entry lạ còn entry gốc / phần mô tả nhân vật không đổi
      // một chữ. Cũng chính là thứ user xin ở bug 126 ("cho AI xử lý luôn Character Definition").
      // Sửa ĐÈ lên văn bản người ta viết là thao tác phá huỷ ⇒ qua verifyEdit mới được ghi.
      const editRows = plan.rows.filter(r =>
        accepted.has(r.id) && (r.action === 'edit_content' || r.action === 'edit_character'));
      for (const r of editRows) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!r.requirement) {
          blockedReasons.push(`Dòng "${r.name}" không nêu rõ cần sửa gì — bỏ qua.`);
          continue;
        }
        const isChar = r.action === 'edit_character';
        const card = useCardStore.getState().card;
        let current = '';
        let field: string | null = null;
        let entryTarget: LorebookEntry | undefined;

        if (isChar) {
          field = resolveCharacterField(r.name);
          if (!field) {
            blockedReasons.push(
              `Không rõ "${r.name}" là trường nào của nhân vật — chỉ sửa được: ${EDITABLE_CHARACTER_FIELDS.join(', ')}.`);
            s.pushProgress(`⚠️ Bỏ qua "${r.name}" — không phải trường Character Definition hợp lệ.`);
            continue;
          }
          current = String((card.data as unknown as Record<string, unknown>)[field] ?? '');
        } else {
          entryTarget = byName.get(r.name.trim().toLowerCase());
          if (!entryTarget) {
            blockedReasons.push(`Không tìm thấy entry "${r.name}" để sửa nội dung.`);
            s.pushProgress(`⚠️ Bỏ qua sửa nội dung "${r.name}" — không có entry nào tên như vậy.`);
            continue;
          }
          current = String(entryTarget.content ?? '');
        }

        if (!current.trim()) {
          blockedReasons.push(`"${r.name}" đang rỗng — không có gì để sửa (dùng mục tạo mới thay vì sửa).`);
          continue;
        }

        const what = isChar ? `trường "${characterFieldLabel(field!)}" của nhân vật` : `entry "${r.name}"`;
        s.pushProgress(`✏️ Đang sửa ${what}…`);
        try {
          const raw = await makeCall(ac.signal)(
            buildEditMessages(current, r.requirement, what),
            { temperature: 0.3, label: `EJS Edit: ${r.name}` },
          );
          const next = parseEditResponse(raw);
          const check = verifyEdit(current, next);
          if (!check.ok) {
            blockedReasons.push(`Bản sửa cho "${r.name}" bị từ chối — ${check.problems.join(' · ')}`);
            s.pushProgress(`⚠️ Giữ nguyên ${what}: ${check.problems.join(' · ')}`);
            continue;
          }
          if (isChar) {
            // Lưu bản cũ để hoàn tác được — dùng chung sổ changedContents với entry (id âm để
            // không đụng id entry thật; handleUndo phân biệt bằng chính khoảng giá trị này).
            charEdits.push({ field: field!, before: current });
            useCardStore.getState().updateField(`data.${field}`, next);
          } else {
            snapContent(entryTarget!);
            useCardStore.getState().updateEntry(entryTarget!.id, { content: next });
          }
          writes++;
          s.pushProgress(`✅ Đã sửa ${what} (${current.length} → ${next.length} ký tự).`);
          s.pushBeforeAfter({ name: r.name, kind: 'ref_patched', before: clip(current), after: clip(next) });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          blockedReasons.push(`Sửa "${r.name}" thất bại: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 2b. Dòng cần sinh code → khung goalAgent (kiểm + tự sửa hội tụ).
      const agentPlan = buildAgentPlanFromRows(plan, accepted);
      if (agentPlan.steps.length) {
        const r: GoalRunResult<EjsDraft> = await executeGoalPlan(agentPlan, domain, makeCall(ac.signal), {
          signal: ac.signal,
          onProgress: (ev) => useEjsStudioStore.getState().pushProgress(ev.text),
        });
        s.setDrafts(r.items);

        if (r.items.length && r.ok) {
          let cur = useCardStore.getState().card.data.character_book?.entries ?? [];
          for (const d of r.items) {
            const newId = nextEntryId(cur);
            const newEntry: LorebookEntry = {
              id: newId, keys: ['@@ejs'], secondary_keys: [], comment: d.entryComment,
              content: d.code, constant: true, selective: false, insertion_order: 100,
              enabled: true, position: 'before_char', use_regex: false,
              extensions: {
                ...DEFAULT_ENTRY_EXT, position: 4, depth: 4, display_index: newId,
                exclude_recursion: true, prevent_recursion: true,
              },
            };
            addEntry(newEntry);
            createdIds.push(newId);
            writes++;
            cur = [...cur, newEntry];
            s.pushBeforeAfter({ name: d.entryComment, kind: 'created', before: '(chưa có entry này)', after: clip(d.code) });

            for (const action of d.entryActions) {
              if (action.action !== 'disable') continue;
              const target = cur.find(e => e.comment === action.comment);
              if (target) {
                snap(target);
                useCardStore.getState().updateEntry(target.id, { enabled: false });
              }
            }
          }
        }
        if (!r.ok) {
          // (bugNeedFix/147) Đây là ca hay gặp nhất khiến "chạy xong mà không có gì": code sinh ra
          // không qua nổi validator (thiếu await, thiếu force, biến lệch schema…) nên bị CHẶN ghi.
          // Trước đây chỉ có một dòng log 10px trong khung cuộn — rất dễ trôi khuất, còn banner
          // vẫn báo Hoàn thành. Nay đưa thẳng lên phần kết luận.
          const why = (r.issues ?? []).filter(i => i.level === 'error').slice(0, 3).map(i => i.message);
          blockedReasons.push(
            `${r.items.length} khối EJS đã sinh ra nhưng KHÔNG qua kiểm nên không được ghi vào thẻ`
            + (why.length ? `: ${why.join(' · ')}` : '.'),
          );
          s.pushProgress('⚠️ Còn lỗi chưa tự sửa được — xem danh sách bên dưới, entry KHÔNG được ghi vào card.');
        }
      } else if (!reclassified) {
        // (bugNeedFix/147) Thông báo cũ nói "không có mục nào được duyệt" — SAI nguyên nhân khi
        // user đã duyệt nhưng AI quên khai `requirement` cho dòng đó (buildAgentPlanFromRows lọc
        // im lặng). Phân biệt hai ca để user biết phải làm gì.
        const acceptedRows = plan.rows.filter(r2 => accepted.has(r2.id));
        const droppedNoReq = acceptedRows.filter(r2 =>
          r2.action !== 'reclassify' && r2.action !== 'split_entry' && !r2.requirement);
        if (droppedNoReq.length) {
          blockedReasons.push(
            `${droppedNoReq.length} mục đã duyệt bị bỏ vì AI không mô tả rõ cần làm gì `
            + `(${droppedNoReq.slice(0, 3).map(x => x.name).join(', ')}) — bấm "Lên kế hoạch" lại để AI khai đủ.`,
          );
        } else if (acceptedRows.length === 0) {
          blockedReasons.push('Bạn chưa duyệt mục nào — không có gì để chạy.');
        }
        s.pushProgress('⚠️ Không có mục nào chạy được — xem phần kết luận bên dưới để biết vì sao.');
      }

      // (bug 127) Chốt cuối: entry vừa bị TẮT để "kích hoạt theo điều kiện" mà không controller
      // nào gọi activewi cho nó thì nó chết hẳn — lore biến mất khỏi mọi lượt chat mà không có
      // lỗi đỏ nào. Đây là mâu thuẫn nội bộ của chính cơ chế phân loại, phải nói thẳng ra.
      const orphans = findOrphanConditionalEntries(
        plan.rows.filter(r => accepted.has(r.id)),
        useEjsStudioStore.getState().drafts.map(d => d.code),
      );
      if (orphans.length) {
        s.pushProgress(
          `⚠️ ${orphans.length} entry đã bị tắt để chờ điều kiện nhưng CHƯA có khối EJS nào bật chúng lên: ` +
          `${orphans.join(', ')}. Chúng sẽ không bao giờ xuất hiện — hãy bấm Hoàn tác, hoặc chạy thêm một ` +
          `lượt yêu cầu AI tạo controller bật đúng các entry này.`,
        );
      }

      // (bug 162 mục 3.7) Entry TẮT TAY trông vào activewi — nói rõ tool kiểm được gì và KHÔNG kiểm
      // được gì, kèm cách user tự xác nhận một lần trong chat thật.
      for (const line of liveActivationCheckHint(
        entriesNeedingLiveActivationCheck(plan.rows.filter(r => accepted.has(r.id))),
      )) s.pushProgress(line);

      // (Goal 28/07) CHỐT THAM CHIẾU: quét toàn bộ getwi/activewi trong lorebook xem còn trỏ
      // đúng entry tồn tại không. Vá tất định theo mapping tách/đổi tên + khớp không phân biệt
      // hoa-thường; còn lại BÁO RÕ, không đoán mò. Sạch thì báo sạch.
      {
        const curEntries = useCardStore.getState().card.data.character_book?.entries ?? [];
        // Cả entry đang TẮT cũng là đích hợp lệ (activewi chính là để bật entry tắt).
        const names = curEntries.map(e => String(e.comment || `#${e.id}`));
        const blocks = curEntries
          .filter(e => String(e.content ?? '').includes('<%'))
          .map(e => ({ name: String(e.comment || `#${e.id}`), code: String(e.content ?? ''), id: e.id }));

        let broken = scanBrokenRefs(blocks, names);
        if (broken.length && (refMapping.size || true)) {
          // Vá theo mapping tách/đổi tên trước, rồi khớp gần cho phần còn lại.
          const fuzzy = fuzzyRepairMapping(broken, names);
          const mapping = new Map([...refMapping, ...fuzzy]);
          if (mapping.size) {
            for (const b of blocks) {
              const { code, changes } = rewriteRefs(b.code, mapping);
              if (changes.length) {
                const entry = curEntries.find(e => e.id === b.id)!;
                snapContent(entry);
                useCardStore.getState().updateEntry(b.id, { content: code });
                for (const c of changes) s.pushProgress(`🔗 Vá tham chiếu trong "${b.name}": ${c}`);
                s.pushBeforeAfter({ name: b.name, kind: 'ref_patched', before: clip(b.code), after: clip(code) });
                b.code = code;
              }
            }
            broken = scanBrokenRefs(blocks, names);
          }
        }
        if (broken.length) {
          for (const b of broken) {
            s.pushProgress(`❌ Tham chiếu GÃY: "${b.from}" gọi ${b.kind} tới "${b.ref}" — entry này không tồn tại (đổi tên/xoá?). Máy không đủ căn cứ tự vá, hãy kiểm lại.`);
          }
        } else {
          s.pushProgress('🔗 Kiểm tham chiếu getwi/activewi: tất cả đều trỏ đúng entry tồn tại.');
        }

        // Phần tách để "chờ điều kiện" mà không controller nào activewi tới → lore chết im lặng
        // (đúng mâu thuẫn bug 127). refMapping có thể đã vá tự động (controller cũ bật entry gốc
        // giờ bật đủ các phần) — nên kiểm SAU khi vá, chỉ báo cái còn thật sự mồ côi.
        if (conditionalParts.length) {
          const activatedNames = new Set(blocks.flatMap(b => extractEntryRefs(b.code)));
          const orphanParts = conditionalParts.filter(n => !activatedNames.has(n.trim().toLowerCase()));
          if (orphanParts.length) {
            s.pushProgress(
              `⚠️ ${orphanParts.length} phần tách đang TẮT chờ điều kiện nhưng chưa khối EJS nào bật: ` +
              `${orphanParts.join(', ')} — hãy chạy thêm một lượt yêu cầu AI tạo controller bật đúng các entry này, hoặc đổi chúng sang từ khoá.`,
            );
          }
        }
      }

      s.setUndo({ createdEntryIds: createdIds, changedEntries: changed, changedContents, charEdits });
      // (bugNeedFix/147) KẾT LUẬN TRUNG THỰC. `writes` đếm số thay đổi THẬT SỰ vào thẻ; 0 nghĩa là
      // không có gì đổi, dù pipeline chạy trót lọt và code vẫn hiện ra để xem. Nói thẳng ra thay
      // vì treo cờ Hoàn thành rồi để user tự phát hiện lúc mang thẻ qua SillyTavern.
      s.setRunSummary({ writes, blockedReasons });
      if (writes === 0) {
        s.pushProgress(
          '❌ KHÔNG có thay đổi nào được ghi vào thẻ.'
          + (blockedReasons.length ? ` Lý do: ${blockedReasons.join(' | ')}` : ''),
        );
      } else {
        s.pushProgress(`✅ Đã ghi ${writes} thay đổi vào thẻ.`
          + (blockedReasons.length ? ` (${blockedReasons.length} mục KHÔNG vào được — xem kết luận.)` : ''));
      }
      s.setPhase('done');
    } catch (e) {
      // Dừng giữa chừng vẫn phải giữ snapshot, nếu không user mất đường lùi.
      s.setUndo({ createdEntryIds: createdIds, changedEntries: changed, changedContents, charEdits });
      if (e instanceof DOMException && e.name === 'AbortError') {
        s.pushProgress('⏹ Đã dừng theo yêu cầu.');
        s.setPhase('review');
        return;
      }
      s.setError(e instanceof Error ? e.message : String(e));
      s.setPhase('review');
    }
  }, [domain, makeCall, addEntry, entries]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleUndo = useCallback(() => {
    const s = useEjsStudioStore.getState();
    const u = s.undo;
    if (!u) return;
    const cs = useCardStore.getState();
    for (const id of u.createdEntryIds) cs.deleteEntry(id);
    for (const c of u.changedEntries) cs.updateEntry(c.id, { enabled: c.enabled, constant: c.constant, keys: c.keys });
    // (Goal 28/07) Trả cả nội dung bị vá tham chiếu về nguyên bản.
    for (const c of u.changedContents ?? []) cs.updateEntry(c.id, { content: c.content });
    // (bugNeedFix/147) Trả cả trường Character Definition đã sửa về nguyên bản.
    for (const c of u.charEdits ?? []) cs.updateField(`data.${c.field}`, c.before);
    s.setUndo(null);
    s.resetRunOnly();
    s.pushProgress('↩️ Đã hoàn tác: xoá entry vừa tạo + trả entry bị đổi về trạng thái cũ.');
  }, []);

  // (bug 134) NÚT "Áp dụng sang Auto Creator" ĐÃ BỎ.
  // User: "để dùng được 'Bạn muốn EJS làm gì?' thì card cần có sẵn vài entry, sau đó mới ra
  // bảng kế hoạch, rồi mới có nút áp dụng. Nhưng tới lúc đó card đã tạo xong rồi, không còn
  // trong quá trình Auto Creator nữa — nên đặt nút này ở đây là không hợp lý."
  // Đúng: điều kiện để nút bật (`isCardReadyForPolicy` đòi card đã có tên + mô tả + lorebook)
  // chính là điều kiện card đã hoàn chỉnh, tức luôn nằm SAU khi Auto Creator xong việc. Giữ
  // lại chỉ tạo cảm giác có đường tắt mà thực tế không dùng được đúng lúc.
  // `ejsPolicy.ts` vẫn còn (Auto Creator vẫn đọc chính sách cũ nếu người dùng đã áp trước đây,
  // và banner ở Auto Creator vẫn cho Gỡ) — chỉ bỏ ĐƯỜNG TẠO MỚI từ EJS Studio.

  const busy = st.phase === 'planning' || st.phase === 'running';
  const rows = st.plan?.rows ?? [];
  const acceptedCount = rows.filter(r => st.decisions[r.id] !== 'rejected').length;

  // (Goal 28/07) Nhóm các mục theo liên quan (máy đo, tất định) + tổng token ước tính.
  const groups = useMemo(
    () => (st.plan ? groupPlanRows(st.plan.rows, entries) : []),
    [st.plan, entries],
  );
  const rowById = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const tokensTotal = rows
    .filter(r => st.decisions[r.id] !== 'rejected')
    .reduce((sum, r) => sum + (r.tokensDelta ?? 0), 0);

  // (Goal 28/07) Test mode: đề xuất giá trị từ chính điều kiện trong code vừa sinh + controller sẵn có.
  const testProposals = useMemo(() => {
    if (st.phase !== 'done') return [];
    const codes = [
      ...st.drafts.map(d => d.code),
      ...entries.filter(e => String(e.content ?? '').includes('<%')).map(e => String(e.content ?? '')),
    ];
    return proposeTestValues(codes);
  }, [st.phase, st.drafts, entries]);

  const handleSimulate = useCallback(async () => {
    const s = useEjsStudioStore.getState();
    const values: Record<string, unknown> = {};
    for (const [path, raw] of Object.entries(s.testValues)) {
      if (raw.trim() === '') continue;
      const n = Number(raw);
      values[path] = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(n) && raw.trim() !== '' ? n : raw;
    }
    const cur = useCardStore.getState().card.data.character_book?.entries ?? [];
    // Chỉ controller đang BẬT mới chạy trong game — entry EJS tắt mà đem mô phỏng là kết quả giả.
    const controllers = cur
      .filter(e => e.enabled !== false && String(e.content ?? '').includes('<%'))
      .map(e => ({ name: String(e.comment || `#${e.id}`), code: String(e.content ?? '') }));
    const report = await simulateActivation(controllers, cur, values, s.testSampleText);
    s.setSimReport(report);
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-4 p-4">
      {/* ═══ Ô yêu cầu + Preset Nhanh ═══ */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold">Bạn muốn EJS làm gì?</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mô tả bằng lời thường — AI tự quyết cần làm những gì, rồi trình <b>bảng kế hoạch từng mục</b> để
          bạn duyệt hoặc từ chối riêng từng mục trước khi chạy. Chưa quen EJS thì bấm một Preset Nhanh bên dưới.
        </p>

        {/* ═══ (bugNeedFix/147 — mục 4) PRESET NHANH: LƯỚI THẺ GỌN ═══
            User: "hiện các preset đầy chữ mô tả dài, khi cần quét nhanh nhiều preset thì mệt.
            Rút gọn mặc định chỉ còn icon + tiêu đề ngắn + 1 dòng mô tả; mô tả chi tiết đưa vào
            tooltip/expand. Ưu tiên lưới thẻ nhỏ gọn, đồng đều, dễ quét mắt."
            Thẻ nay cao BẰNG NHAU (1 dòng mô tả cắt gọn), xếp theo nhóm chức năng, và bấm dấu ⓘ
            mới mở phần giải thích đầy đủ. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Preset nhanh · {presets.filter(x => x.built.blockers.length === 0).length}/{presets.length} dùng được với thẻ này
            </div>
            {expandedPresets.size > 0 && (
              <button onClick={() => setExpandedPresets(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground">Thu gọn tất cả</button>
            )}
          </div>

          {PRESET_GROUP_ORDER.map(g => {
            const inGroup = presets.filter(x => x.preset.group === g);
            if (!inGroup.length) return null;
            return (
              <div key={g} className="space-y-1">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  {PRESET_GROUP_LABEL[g]}
                </div>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {inGroup.map(({ preset, built }) => {
                    const blocked = built.blockers.length > 0;
                    const open = expandedPresets.has(preset.id);
                    return (
                      <div key={preset.id}
                        className={`rounded-lg border transition-colors ${
                          blocked ? 'border-border/40 bg-muted/10' : 'border-border hover:border-emerald-500/40'
                        }`}>
                        <div className="flex items-start gap-1 p-1.5">
                          <button
                            disabled={busy || blocked}
                            // (bug 162 mục 3.1) Nhớ luôn preset vừa chọn — bấm preset chỉ đổ ra
                            // chuỗi goal nên danh tính preset rơi mất ngay ở bước đầu, khiến bảng
                            // kế hoạch không biết dòng nào của preset nào.
                            onClick={() => { st.setGoal(built.goal); setActivePresetIds([preset.id]); }}
                            title={blocked ? built.blockers.join('\n') : preset.effect}
                            className={`flex-1 min-w-0 text-left ${blocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <div className="text-[11px] font-medium flex items-center gap-1 truncate">
                              <span className="shrink-0">{preset.icon}</span>
                              <span className="truncate">{preset.title}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                              {blocked ? built.blockers[0] : preset.short}
                            </div>
                          </button>
                          <button
                            onClick={() => togglePreset(preset.id)}
                            title="Xem giải thích đầy đủ"
                            className="shrink-0 p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/30"
                          >
                            <Info className="w-3 h-3" />
                          </button>
                        </div>
                        {open && (
                          <div className="px-2 pb-2 space-y-1 border-t border-border/50 pt-1.5">
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{preset.effect}</p>
                            {built.blockers.map((b, i) => (
                              <p key={i} className="text-[10px] text-amber-400/90">⚠️ {b}</p>
                            ))}
                            {built.notes.map((n, i) => (
                              <p key={i} className="text-[10px] text-sky-400/80">ℹ️ {n}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <textarea
          value={st.goal}
          onChange={e => st.setGoal(e.target.value)}
          disabled={busy}
          rows={4}
          placeholder={'Ví dụ: "Làm bộ điều khiển bật/tắt entry theo Cảnh Giới của người chơi — Luyện Khí thì chỉ hiện entry cơ bản, Kim Đan trở lên mở thêm bí cảnh."'}
          className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-emerald-500/30 resize-y placeholder:text-muted-foreground/40"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handlePlan}
            disabled={busy || !st.goal.trim()}
            className="flex-1 min-w-[180px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
              bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
              text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {st.phase === 'planning'
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang lên kế hoạch…</>
              : <><ListChecks className="w-3.5 h-3.5" /> Lên kế hoạch</>}
          </button>
          {busy && (
            <button onClick={handleStop}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              <Square className="w-3 h-3" /> Dừng
            </button>
          )}
          {(st.plan || st.goal) && !busy && (
            <button onClick={st.reset}
              title="Xoá kế hoạch và ô yêu cầu, làm lại từ đầu"
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">
              <RotateCcw className="w-3 h-3" /> Làm lại từ đầu
            </button>
          )}
        </div>
        {!schema && (
          <p className="text-[10px] text-amber-400/90">
            ⚠️ Card chưa có MVUZOD schema — code vẫn sinh được nhưng không kiểm chéo được biến.
            Nên tạo schema ở tab MVUZOD trước để agent bám đúng biến.
          </p>
        )}
      </div>

      {st.error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{st.error}</p>
        </div>
      )}

      {/* ═══ Bảng kế hoạch — duyệt từng dòng ═══ */}
      {st.plan && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Kế hoạch — {rows.length} mục</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  ~{st.plan.estCalls} call AI
                </span>
                {tokensTotal !== 0 && (
                  <span
                    title="Ước tính tất định từ độ dài entry và chế độ kích hoạt — hiệu quả thật tuỳ diễn biến chat"
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      tokensTotal < 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                    {tokensTotal < 0
                      ? `ước tiết kiệm ~${-tokensTotal} token/lượt`
                      : `ước tăng ~+${tokensTotal} token/lượt`}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{st.plan.scope}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => st.setAllDecisions('accepted')}
                className="px-2 py-1 rounded text-[10px] border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                Chọn hết
              </button>
              <button onClick={() => st.setAllDecisions('rejected')}
                className="px-2 py-1 rounded text-[10px] border border-border text-muted-foreground hover:bg-muted transition-colors">
                Bỏ hết
              </button>
            </div>
          </div>

          {st.plan.warnings.map((w, i) => (
            <div key={`w${i}`} className="text-[11px] text-amber-400/90 flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {w}
            </div>
          ))}
          {st.plan.notes.map((n, i) => (
            <div key={`n${i}`} className="text-[11px] text-sky-400/80 flex gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> {n}
            </div>
          ))}

          <div className="space-y-2">
            {/* (Goal 28/07) Mục được GOM NHÓM theo liên quan (chung biến / getwi tới nhau /
                cùng chuỗi if-else). Từ chối cả nhóm chỉ đụng nhóm đó; trong nhóm vẫn duyệt
                từng mục. Mục độc lập đứng riêng, không khung nhóm. */}
            {groups.map(g => {
              const gRows = g.rowIds.map(id => rowById.get(id)!).filter(Boolean);
              const renderRow = (r: EjsPlanRow) => {
                const rejected = st.decisions[r.id] === 'rejected';
                return (
                  <div key={r.id}
                    className={`rounded-lg border p-2.5 transition-colors ${
                      rejected ? 'border-border/40 bg-muted/10 opacity-50' : 'border-border bg-background/60'
                    }`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/15 text-purple-300">
                            {ACTION_LABEL[r.action]}
                          </span>
                          {r.target === 'character' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-500/15 text-orange-300">
                              Character Definition
                            </span>
                          )}
                          <span className="text-xs font-medium truncate">{r.name}</span>
                          {/* (bug 162 mục 3.1) Dòng này do PRESET NÀO sinh ra. Trước đây bảng chỉ có
                              mũi tên chế độ và nhãn Tách/Tạo mới, nên user phải tự đoán qua icon
                              hoặc nội dung lý do. Không suy được chắc chắn thì KHÔNG hiện nhãn —
                              nhãn sai còn tệ hơn không có nhãn. */}
                          {r.presetTitle && (
                            <span
                              title={`Thay đổi này đến từ Preset Nhanh: ${r.presetTitle} (${r.presetId})`}
                              className="px-1.5 py-0.5 rounded text-[9px] bg-sky-500/15 text-sky-300 shrink-0"
                            >⚡ {r.presetTitle}</span>
                          )}
                          {typeof r.tokensDelta === 'number' && r.tokensDelta !== 0 && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                              r.tokensDelta < 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                            }`}>
                              {r.tokensDelta < 0 ? '' : '+'}{r.tokensDelta} token/lượt
                            </span>
                          )}
                        </div>

                        {(r.currentMode || r.proposedMode) && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="text-muted-foreground">
                              {r.currentMode ? ACTIVATION_LABEL[r.currentMode] : '(entry mới)'}
                            </span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground/60" />
                            <span className="text-emerald-400">
                              {r.proposedMode ? ACTIVATION_LABEL[r.proposedMode] : 'giữ nguyên'}
                            </span>
                          </div>
                        )}

                        <div className="text-[11px]">{r.proposal}</div>
                        {/* (Goal 28/07) Dòng tách: liệt kê từng entry con + điều kiện — duyệt TRƯỚC khi tách. */}
                        {r.action === 'split_entry' && r.splitInto?.length ? (
                          <div className="text-[10px] space-y-0.5 pl-2 border-l-2 border-purple-500/30">
                            {r.splitInto.map((p2, i2) => (
                              <div key={i2}>
                                <span className="text-purple-300">▸ {p2.name}</span>
                                <span className="text-muted-foreground"> · {ACTIVATION_LABEL[p2.mode]} · {p2.criterion}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="text-[10px] text-muted-foreground">Lý do: {r.reason}</div>
                      </div>

                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => st.setDecision(r.id, 'accepted')} title="Đồng ý mục này"
                          className={`p-1.5 rounded border transition-colors ${
                            !rejected ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                                      : 'border-border text-muted-foreground hover:bg-muted'
                          }`}>
                          <Check className="w-3 h-3" />
                        </button>
                        <button onClick={() => st.setDecision(r.id, 'rejected')} title="Từ chối mục này"
                          className={`p-1.5 rounded border transition-colors ${
                            rejected ? 'border-red-500/50 bg-red-500/15 text-red-400'
                                     : 'border-border text-muted-foreground hover:bg-muted'
                          }`}>
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              };

              if (gRows.length === 1) return renderRow(gRows[0]);

              const allRejected = gRows.every(r => st.decisions[r.id] === 'rejected');
              return (
                <div key={g.id} className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-2 space-y-1.5">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-semibold text-sky-300">🧩 {g.label}</span>
                    <span className="text-[9px] text-muted-foreground truncate flex-1" title={g.reasons.join('\n')}>
                      {g.reasons[0] ?? ''}
                    </span>
                    <button
                      onClick={() => st.setDecisions(g.rowIds, allRejected ? 'accepted' : 'rejected')}
                      title={allRejected
                        ? 'Đồng ý lại cả nhóm này'
                        : 'Từ chối cả nhóm này — chỉ ảnh hưởng các mục trong nhóm, không lan sang nhóm khác'}
                      className={`px-2 py-0.5 rounded text-[9px] border transition-colors shrink-0 ${
                        allRejected
                          ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                          : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                      }`}>
                      {allRejected ? 'Đồng ý cả nhóm' : 'Từ chối cả nhóm'}
                    </button>
                  </div>
                  {gRows.map(renderRow)}
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="text-xs text-muted-foreground py-4 text-center">
                AI không đưa ra mục nào. Thử diễn đạt yêu cầu cụ thể hơn, hoặc bấm một Preset Nhanh.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={handleRun}
              disabled={busy || acceptedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium
                bg-primary text-primary-foreground hover:bg-primary/90
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {st.phase === 'running'
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang chạy…</>
                : <><Play className="w-3.5 h-3.5" /> Chạy {acceptedCount}/{rows.length} mục đã duyệt</>}
            </button>
          </div>
        </div>
      )}

      {/* ═══ Tiến trình ═══ */}
      {st.progress.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3 max-h-52 overflow-y-auto scrollbar-thin space-y-1">
          {st.progress.map((line, i) => (
            <p key={i} className="text-[10px] font-mono text-muted-foreground">{line}</p>
          ))}
          {st.phase === 'running' && (
            <p className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> đang chạy…
            </p>
          )}
        </div>
      )}

      {/* ═══ Kết quả ═══ */}
      {st.phase === 'done' && (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          {/* (bugNeedFix/147) KẾT LUẬN TRUNG THỰC — thay cho banner "Hoàn thành" vô điều kiện.
              Code sinh ra vẫn hiện bên dưới để xem, nhưng dòng đầu phải nói đúng thẻ có đổi
              hay không: user từng tưởng đã xong rồi mang thẻ qua SillyTavern mới biết trống trơn. */}
          <div className="flex items-center gap-2">
            {st.runSummary && st.runSummary.writes === 0 ? (
              <AlertTriangle className="w-4 h-4 text-red-400" />
            ) : (
              <Check className="w-4 h-4 text-green-400" />
            )}
            <span className="text-sm font-semibold">
              {st.runSummary
                ? st.runSummary.writes === 0
                  ? 'Không có thay đổi nào được ghi vào thẻ'
                  : `Đã ghi ${st.runSummary.writes} thay đổi vào thẻ`
                : 'Hoàn thành'}
            </span>
            {st.undo && (
              <button onClick={handleUndo}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors">
                <Undo2 className="w-3 h-3" /> Hoàn tác tất cả
              </button>
            )}
          </div>

          {/* (bugNeedFix/147) Lý do các mục KHÔNG vào được thẻ — trước đây chỉ nằm trong log
              tiến trình cỡ chữ 10px trong khung cuộn, rất dễ trôi khuất. */}
          {st.runSummary && st.runSummary.blockedReasons.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-amber-400">Vì sao chưa vào được thẻ:</p>
              {st.runSummary.blockedReasons.map((r, i) => (
                <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">• {r}</p>
              ))}
              <p className="text-[10px] text-muted-foreground pt-1">
                Code sinh ra vẫn hiện bên dưới để bạn xem/sửa tay — nhưng thẻ thì CHƯA có nó.
              </p>
            </div>
          )}

          {st.drafts.map(d => (
            <div key={d.stepId + d.entryComment} className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center gap-2">
                <BookPlus className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-[11px] font-medium truncate flex-1">{d.entryComment}</span>
                <span className="text-[9px] text-muted-foreground">{d.strategy}</span>
                {onOpenInEditor && (
                  <button onClick={() => onOpenInEditor(d.code)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                    Mở editor
                  </button>
                )}
              </div>
              {d.explanation && <p className="px-3 py-1.5 text-[10px] text-muted-foreground">{d.explanation}</p>}
              <pre className="px-3 py-2 text-[9px] font-mono leading-relaxed overflow-x-auto max-h-40 overflow-y-auto scrollbar-thin bg-background/50">
                {d.code}
              </pre>
            </div>
          ))}

          {/* ═══ (Goal 28/07) TRƯỚC / SAU — xem máy đã đổi GÌ, không chỉ tên ═══ */}
          {st.beforeAfter.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-sky-400" /> Trước / Sau ({st.beforeAfter.length} thay đổi)
              </div>
              {st.beforeAfter.map((ba, i) => (
                <details key={i} className="rounded-lg border border-border overflow-hidden">
                  <summary className="px-3 py-1.5 text-[11px] cursor-pointer bg-muted/20 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                      ba.kind === 'created' ? 'bg-emerald-500/15 text-emerald-300'
                      : ba.kind === 'split' ? 'bg-purple-500/15 text-purple-300'
                      : ba.kind === 'ref_patched' ? 'bg-sky-500/15 text-sky-300'
                      : 'bg-amber-500/15 text-amber-300'
                    }`}>
                      {ba.kind === 'created' ? 'Tạo mới' : ba.kind === 'split' ? 'Tách' : ba.kind === 'ref_patched' ? 'Vá tham chiếu' : 'Đổi kích hoạt'}
                    </span>
                    <span className="font-medium truncate">{ba.name}</span>
                  </summary>
                  <div className="grid sm:grid-cols-2 gap-px bg-border">
                    <div className="bg-background/60 p-2">
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Trước</div>
                      <pre className="text-[9px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto scrollbar-thin">{ba.before}</pre>
                    </div>
                    <div className="bg-background/60 p-2">
                      <div className="text-[9px] uppercase text-emerald-400/80 mb-1">Sau</div>
                      <pre className="text-[9px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto scrollbar-thin">{ba.after}</pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* ═══ (Goal 28/07) TEST MODE — thử điều kiện kích hoạt ngay trong tool ═══ */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="text-xs font-semibold">🧪 Test mode — thử xem entry nào kích hoạt</div>
            <p className="text-[10px] text-muted-foreground">
              Giá trị đề xuất lấy từ CHÍNH các mốc so sánh trong code (tại mốc và hai phía ranh giới).
              Nhập giá trị muốn thử rồi bấm Chạy thử — mô phỏng ngay trong tool, không cần ra chat thật.
            </p>
            {testProposals.length === 0 && (
              <p className="text-[10px] text-muted-foreground">Không tìm thấy điều kiện đọc biến nào trong các khối EJS của card.</p>
            )}
            {testProposals.map(tp => (
              <div key={tp.path} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono text-sky-300 min-w-[120px]">{tp.path}</span>
                <input
                  value={st.testValues[tp.path] ?? ''}
                  onChange={e => st.setTestValue(tp.path, e.target.value)}
                  placeholder="giá trị thử"
                  className="px-2 py-1 text-[10px] rounded border border-border bg-background w-28 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                />
                <span className="text-[9px] text-muted-foreground">gợi ý:</span>
                {tp.values.slice(0, 6).map((v, i) => (
                  <button key={i} onClick={() => st.setTestValue(tp.path, String(v))}
                    title={tp.fromConditions.join(' · ')}
                    className="px-1.5 py-0.5 rounded text-[9px] border border-border hover:bg-muted transition-colors font-mono">
                    {String(v)}
                  </button>
                ))}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={st.testSampleText}
                onChange={e => st.setTestSampleText(e.target.value)}
                placeholder="(tuỳ chọn) đoạn chat mẫu — để thử entry kích hoạt theo từ khoá"
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              />
              <button onClick={handleSimulate}
                className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30 transition-colors">
                ▶ Chạy thử
              </button>
            </div>
            {st.simReport && (
              <div className="space-y-1 pt-1 border-t border-border/50">
                {st.simReport.errors.map((e, i) => (
                  <p key={`e${i}`} className="text-[10px] text-red-400">❌ Lỗi khi chạy controller {e}</p>
                ))}
                {st.simReport.missingVars.length > 0 && (
                  <p className="text-[10px] text-amber-400/90">
                    ⚠️ Controller đọc các biến chưa nhập giá trị: {st.simReport.missingVars.join(', ')} (đang dùng giá trị mặc định).
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-1">
                  {st.simReport.results.map((r, i) => (
                    <div key={i} className={`px-2 py-1 rounded text-[10px] flex items-start gap-1.5 ${
                      r.activated ? 'bg-emerald-500/10 text-emerald-300' : 'bg-muted/20 text-muted-foreground'
                    }`}>
                      <span>{r.activated ? '✅' : '⬜'}</span>
                      <span className="min-w-0"><b>{r.entry}</b> — {r.via}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
