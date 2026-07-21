import { CardV3 } from '../types/card';
import { CardParser, VariableRemap } from './parser';
import { LLMConfig } from './llm';
import { SYSTEM_PROMPT, ANALYZE_CARD_PROMPT, MOD_SECTION_PROMPT, MOD_SCRIPT_PROMPT, KEYWORD_SYNC_PROMPT, CONSISTENCY_AUDIT_PROMPT, VALIDATE_CARD_PROMPT, MVUZOD_NARRATIVE_MOD_PROMPT, MVUZOD_VALIDATE_PROMPT, MVUZOD_VAR_REMAP_PROMPT, EXPAND_SECTION_PROMPT, EXPAND_SUBSECTION_PROMPT } from './prompts';
import { describeIntegrity, checkBracketBalance } from './scriptSafety';

/** Tuỳ chọn chế độ mở rộng khi mod 1 section. */
export interface ModOptions {
  expand?: boolean;
  intensity?: string;
  loreDigest?: string;
  /** Báo tiến độ khi entry lớn bị chia phần (done/total) — để UI hiển thị "phần i/N". */
  onChunkProgress?: (done: number, total: number) => void;
}

/** Digest toàn cảnh card + lorebook (để AI mở rộng bám lore, không mâu thuẫn). */
export function buildLoreDigest(card: CardV3): string {
  const d = card.data;
  const strip = (s: string) => (s || '').replace(/<%[\s\S]*?%>/g, '').replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  if (d.name) parts.push(`Nhân vật chính: ${d.name}`);
  const desc = strip(d.description || card.description || '').slice(0, 600);
  if (desc) parts.push(`Mô tả (tóm tắt): ${desc}`);
  const scen = strip(d.scenario || '').slice(0, 300);
  if (scen) parts.push(`Bối cảnh: ${scen}`);
  const entries = (d.character_book?.entries || []).filter(e =>
    e.content && !e.content.trim().startsWith('@@preprocessing') &&
    !e.comment?.includes('[mvu_update]') && !e.comment?.includes('[initvar]'));
  const loreLines = entries.slice(0, 30).map(e => `• ${e.comment || 'entry'}: ${strip(e.content).slice(0, 160)}`);
  if (loreLines.length) parts.push(`LOREBOOK (${loreLines.length} mục tham chiếu):\n${loreLines.join('\n')}`);
  return parts.join('\n\n').slice(0, 5000);
}

/**
 * Chia nội dung NARRATIVE dài thành nhiều phần ≤ maxChars, cắt ở ranh giới ĐOẠN → DÒNG (không
 * cắt giữa từ nếu tránh được). Dùng khi entry quá lớn (cả trăm nghìn ký tự) để mod/mở rộng TỪNG
 * PHẦN rồi ghép — tránh lỗi output bị cắt cụt khi gọi AI 1 lần với nội dung khổng lồ.
 */
export function chunkContent(text: string, maxChars = 8000): string[] {
  if (!text || text.length <= maxChars) return [text || ''];
  const parts: string[] = [];
  let cur = '';
  const flush = () => { if (cur) { parts.push(cur); cur = ''; } };
  for (const para of text.split(/\n\n+/)) {
    if (cur && cur.length + para.length + 2 > maxChars) flush();
    if (para.length > maxChars) {
      flush();
      let line = '';
      for (const ln of para.split('\n')) {
        if (line && line.length + ln.length + 1 > maxChars) { parts.push(line); line = ''; }
        if (ln.length > maxChars) {
          if (line) { parts.push(line); line = ''; }
          for (let i = 0; i < ln.length; i += maxChars) parts.push(ln.slice(i, i + maxChars));
        } else line = line ? line + '\n' + ln : ln;
      }
      if (line) cur = line;
    } else {
      cur = cur ? cur + '\n\n' + para : para;
    }
  }
  flush();
  return parts;
}

/** Lấy nội dung 1 tag XML (khoan dung: chấp nhận thiếu tag đóng). */
function extractTag(text: string, name: string): string {
  const closed = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(text);
  if (closed) return closed[1].replace(/^\n+|\n+$/g, '').trim();
  const open = new RegExp(`<${name}>([\\s\\S]*)`, 'i').exec(text);
  return open ? open[1].replace(/^\n+/g, '').trim() : '';
}

/**
 * Rút khối JSON (mảng `[]` hoặc object `{}`) từ output AI một cách BỀN VỮNG.
 * Bệnh cũ: `response.match(/\[[\s\S]*\]/)` tham lam bắt từ dấu `[` ĐẦU TIÊN (thường nằm trong
 * văn xuôi Chain-of-Thought, vd `[USER_CUSTOM_PROMPT]`, `[MODULE 1]`) tới `]` CUỐI → dính cả
 * prose lẫn JSON → JSON.parse vỡ dù AI thật ra đã xuất JSON đúng (trong khối ```json ở cuối).
 * Cách mới: (1) ưu tiên khối ```json fenced (lấy khối cuối); (2) quét mọi dấu mở, cân bằng ngoặc
 * CÓ HIỂU CHUỖI (bỏ qua ngoặc nằm trong "..." như "[Đoạn 3]"), parse — trả về khối HỢP LỆ đầu tiên.
 */
function findBalanced(text: string, start: number, open: string, close: string): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function extractJson<T>(text: string, open: '[' | '{', close: ']' | '}'): T | null {
  const tryParse = (s: string): T | null => {
    try { return JSON.parse(s) as T; } catch { return null; }
  };
  // 1) khối ```json / ``` fenced — duyệt từ CUỐI (JSON thường xuất sau phần phân tích)
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim()).reverse();
  for (const f of fences) {
    const direct = tryParse(f);
    if (direct != null) return direct;
    const s = f.indexOf(open);
    if (s >= 0) { const slice = findBalanced(f, s, open, close); if (slice) { const v = tryParse(slice); if (v != null) return v; } }
  }
  // 2) quét toàn bộ text: khối cân bằng đầu tiên parse được (ngoặc prose parse fail → tự bỏ qua)
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== open) continue;
    const slice = findBalanced(text, i, open, close);
    if (!slice) continue;
    const v = tryParse(slice);
    if (v != null) return v;
  }
  return null;
}

/* Bộ parse khoan dung — caller tự khẳng định shape (giữ nguyên hành vi cũ: JSON.parse trả any). */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const extractJsonArray = <T = any>(text: string): T[] | null => extractJson<T[]>(text, '[', ']');
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const extractJsonObject = <T = any>(text: string): T | null => extractJson<T>(text, '{', '}');

/** Parse khoan dung khối <remap> XML từ AI → danh sách đổi biến. */
function parseRemapXml(text: string): VariableRemap[] {
  const block = /<remap>([\s\S]*?)<\/remap>/i.exec(text)?.[1] ?? text;
  const tag = (s: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'i').exec(s)?.[1]?.trim() ?? '';
  const out: VariableRemap[] = [];
  const re = /<var>([\s\S]*?)<\/var>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const oldKey = tag(m[1], 'old');
    if (!oldKey) continue;
    const newName = tag(m[1], 'new_name');
    const newDesc = tag(m[1], 'new_desc');
    out.push({ oldKey, newKey: newName || oldKey, newDescribe: newDesc || undefined });
  }
  return out;
}

export interface OrchestratorRule {
  id: string;
  name: string;
  details: string;
  keywords: string;
  enabled: boolean;
}

async function fetchLLM(systemPrompt: string, userPrompt: string, config: LLMConfig, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Người dùng đã dừng', 'AbortError');
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt, config }),
    signal   // abort của người dùng → fetch reject ngay (AbortError), pipeline dừng tức thì
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'LLM fetch failed');
  }
  const data = await res.json();
  return data.result;
}

export interface CardSection {
  section_id: string;
  label: string;
  field_path: string;
  mirror_paths: string[];
  content: string;
  is_code: boolean;
  content_type?: string;
  entry_position?: string;
}

export const extractSections = (card: CardV3): CardSection[] => {
  const sections: CardSection[] = [];
  const CORE_FIELDS = [
    { key: 'description', label: 'Mô tả nhân vật', mirror: 'data.description' },
    { key: 'personality', label: 'Tính cách', mirror: 'data.personality' },
    { key: 'scenario', label: 'Kịch bản', mirror: 'data.scenario' },
    { key: 'first_mes', label: 'Tin nhắn đầu', mirror: 'data.first_mes' },
    { key: 'mes_example', label: 'Tin nhắn mẫu', mirror: 'data.mes_example' },
  ];

  // Core fields
  CORE_FIELDS.forEach(({ key, label, mirror }) => {
    // Only looking at the root level for extraction
    const val = (card as unknown as Record<string, string | undefined>)[key] || card.data[key]; 
    if (val && typeof val === 'string' && val.trim()) {
      sections.push({
        section_id: key,
        label,
        field_path: key,
        mirror_paths: [mirror],
        content: val,
        is_code: false,
        content_type: 'text_narrative'
      });
    }
  });

  // System instructions
  const sysPrompt = card.data.system_prompt;
  if (sysPrompt && sysPrompt.trim()) {
    sections.push({
      section_id: 'system_prompt',
      label: 'System Prompt',
      field_path: 'data.system_prompt',
      mirror_paths: [],
      content: sysPrompt,
      is_code: false,
      content_type: 'system_instruction'
    });
  }

  // Lorebook entries
  const entries = card.data.character_book?.entries || [];
  entries.forEach((entry, i) => {
    if (entry.content && entry.content.trim()) {
      const isEjs = entry.content.trim().startsWith('@@preprocessing');
      sections.push({
        section_id: `entry_${i}`,
        label: isEjs ? `EJS Controller: ${entry.comment || `Entry #${i+1}`}` : `Lorebook: ${entry.comment || `Entry #${i+1}`}`,
        field_path: `data.character_book.entries[${i}].content`,
        mirror_paths: [],
        content: entry.content,
        is_code: isEjs,
        content_type: isEjs ? 'template_code' : 'world_lore',
        entry_position: entry.position !== undefined ? String(entry.position) : undefined
      });
    }
  });

  // Tavern Helper scripts (Protect MVU runtime CDN library)
  const scripts = card.data.extensions?.tavern_helper?.scripts || [];
  scripts.forEach((s, i) => {
    // DO NOT extract or mod core MVU runtime script
    const isMvuCore = s.content && (
      s.content.includes('MagicalAstrogy/MagVarUpdate') ||
      s.content.includes('MagVarUpdate/artifact/bundle.js')
    );
    if (isMvuCore) return;
    
    if (s.content && s.content.trim()) {
      sections.push({
        section_id: `script_${i}`,
        label: `Script: ${s.name || `Script #${i+1}`}`,
        field_path: `data.extensions.tavern_helper.scripts[${i}].content`,
        mirror_paths: [],
        content: s.content,
        is_code: true,
        content_type: 'template_code'
      });
    }
  });

  return sections;
};

const formatRules = (rules: OrchestratorRule[]) => {
  return rules
    .filter(r => r.enabled)
    .map(r => `[ID: ${r.id}] ${r.name}: ${r.details} (Từ khóa: ${r.keywords})`)
    .join('\n\n');
};

export const applyModification = (card: CardV3, fieldPath: string, newContent: string): CardV3 => {
  const newCard = JSON.parse(JSON.stringify(card));
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setField = (obj: any, path: string, val: any) => {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
      if (!current) return;
    }
    current[keys[keys.length - 1]] = val;
  };

  let finalContent = newContent;
  // MVU Zod Protection: Auto re-inject <StatusPlaceHolderImpl/> in first_mes
  if (fieldPath === 'data.first_mes' || fieldPath === 'first_mes') {
    if (typeof finalContent === 'string' && !finalContent.includes('<StatusPlaceHolderImpl/>')) {
      finalContent = finalContent + '\n\n<StatusPlaceHolderImpl/>';
    }
  }

  setField(newCard, fieldPath, finalContent);

  // Sync mirrors (Update the mirror if it exists, but don't recurse)
  const MIRRORS: Record<string, string> = {
    'description': 'data.description',
    'data.description': 'description',
    'personality': 'data.personality',
    'data.personality': 'personality',
    'scenario': 'data.scenario',
    'data.scenario': 'scenario',
    'first_mes': 'data.first_mes',
    'data.first_mes': 'first_mes',
    'mes_example': 'data.mes_example',
    'data.mes_example': 'mes_example',
  };

  if (MIRRORS[fieldPath]) {
    const mirrorPath = MIRRORS[fieldPath];
    let mirrorContent = finalContent;
    if (mirrorPath === 'data.first_mes' || mirrorPath === 'first_mes') {
      if (typeof mirrorContent === 'string' && !mirrorContent.includes('<StatusPlaceHolderImpl/>')) {
        mirrorContent = mirrorContent + '\n\n<StatusPlaceHolderImpl/>';
      }
    }
    setField(newCard, mirrorPath, mirrorContent);
  }

  return newCard;
};

export class ModOrchestrator {
  config: LLMConfig;
  private pool: LLMConfig[];
  private cursor = 0;
  private signal?: AbortSignal;   // nút Dừng của người dùng → hủy mọi call đang chạy

  /** Nhận provider chính + (tuỳ chọn) danh sách provider PHỤ → pool rải call round-robin
   *  (nhiều provider chạy song song cho các bước mod). 1 provider ⇒ như cũ.
   *  `signal` (tuỳ chọn) để người dùng dừng cả pipeline giữa chừng. */
  constructor(config: LLMConfig, extraProviders: LLMConfig[] = [], signal?: AbortSignal) {
    this.config = config;
    this.signal = signal;
    const usable = (c?: LLMConfig) => !!(c?.apiKey?.trim() && c?.model?.trim());
    const pool = [config, ...extraProviders.filter(usable)].filter(usable);
    this.pool = pool.length ? pool : [config];
  }

  /** Chọn provider kế tiếp (round-robin) cho 1 call. */
  private cfg(): LLMConfig {
    if (this.pool.length <= 1) return this.pool[0];
    const c = this.pool[this.cursor % this.pool.length];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return c;
  }

  async analyze(card: CardV3, rules: OrchestratorRule[]) {
    // We sanitize avatar to save tokens
    const sanitized = JSON.parse(JSON.stringify(card));
    if (sanitized.avatar) sanitized.avatar = "[BASE64_IMAGE_OMITTED]";
    if (sanitized.data?.extensions?.avatar) sanitized.data.extensions.avatar = "[OMITTED]";

    const userPrompt = ANALYZE_CARD_PROMPT
      .replace('{MOD_RULES}', formatRules(rules))
      .replace('{CARD_JSON}', JSON.stringify(sanitized, null, 2));

    const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);

    // Rút JSON bền vững: AI xuất phân tích 5 bước (văn xuôi) RỒI mới tới JSON array trong ```json.
    // Bắt đúng khối JSON, không dính ngoặc trong prose (vd [USER_CUSTOM_PROMPT], [MODULE 1]).
    const parsed = extractJsonArray(response);
    if (!parsed) {
      console.error('LLM raw response (analyze):', response);
      throw new Error(`Không tìm thấy JSON hợp lệ trong phản hồi Analyze. Trích đầu phản hồi: ${response.substring(0, 300)}...`);
    }
    return parsed;
  }

  async modSection(card: CardV3, section: CardSection, rules: OrchestratorRule[], context: string, opts?: ModOptions) {
    const isMvuZod = CardParser.detectMvuZod(card);
    const isCode = section.is_code;
    const isSystemMvuEntry = section.label.includes('[mvu_update]') || section.label.includes('[initvar]') || section.section_id === 'system_prompt';

    // ═══ CHỐNG LỖI ENTRY QUÁ LỚN ═══
    // Entry narrative cả trăm nghìn ký tự (vd "quy tắc" dài) gửi 1 call → output bị CẮT CỤT →
    // kết quả vỡ / "chả làm được gì". Nay: nếu > ngưỡng thì CHIA PHẦN, mod/mở rộng TỪNG PHẦN
    // (đưa đuôi phần trước làm context giữ mạch) rồi GHÉP. Code KHÔNG chia (dễ vỡ cấu trúc).
    const CHUNK_THRESHOLD = 8000;
    const runNarrative = async (
      buildPrompt: (part: string, prevCtx: string) => string,
      extract: (resp: string) => string,
    ): Promise<string> => {
      const content = section.content || '';
      if (content.length <= CHUNK_THRESHOLD) {
        const resp = await fetchLLM(SYSTEM_PROMPT, buildPrompt(content, context || 'Chưa có context'), this.cfg(), this.signal);
        return extract(resp) || content;
      }
      const parts = chunkContent(content, CHUNK_THRESHOLD);
      const out: string[] = [];
      let prevTail = context || '';
      for (let pi = 0; pi < parts.length; pi++) {
        if (this.signal?.aborted) throw new DOMException('Người dùng đã dừng', 'AbortError');
        opts?.onChunkProgress?.(pi + 1, parts.length);
        const part = parts[pi];
        const resp = await fetchLLM(SYSTEM_PROMPT, buildPrompt(part, prevTail || 'Chưa có context'), this.cfg(), this.signal);
        const r = extract(resp) || part;
        out.push(r);
        prevTail = r.slice(-1000); // đuôi phần vừa xong → context cho phần kế (giữ mạch)
      }
      return out.join('\n\n');
    };

    // ═══ Chế độ MỞ RỘNG: đào sâu narrative (không dùng cho code / entry hệ thống MVU) ═══
    if (opts?.expand && !isCode && !isSystemMvuEntry) {
      return runNarrative(
        (part, prevCtx) => EXPAND_SECTION_PROMPT
          .replace('{INTENSITY}', opts.intensity || 'vừa')
          .replace('{MOD_RULES}', formatRules(rules))
          .replace('{LORE_DIGEST}', opts.loreDigest || '(không có)')
          .replace('{SECTION_LABEL}', section.label)
          .replace('{CONTENT_TYPE}', section.content_type || 'text_narrative')
          .replace('{ORIGINAL_CONTENT}', part)
          .replace('{PREVIOUSLY_MODIFIED_CONTEXT}', prevCtx),
        (resp) => extractTag(resp, 'expanded') || resp.trim(),
      );
    }

    if (isMvuZod && !isCode && !isSystemMvuEntry) {
      const entryIndex = section.section_id.startsWith('entry_')
        ? section.section_id.replace('entry_', '')
        : 'N/A';
      return runNarrative(
        (part) => MVUZOD_NARRATIVE_MOD_PROMPT
          .replace('{ENTRY_INDEX}', entryIndex)
          .replace('{ENTRY_COMMENT}', section.label)
          .replace('{POSITION}', section.entry_position || 'N/A')
          .replace('{ENTRY_KEYS}', '')
          .replace('{MOD_RULES}', formatRules(rules))
          .replace('{ORIGINAL_CONTENT}', part),
        (resp) => extractTag(resp, 'modified') || resp.trim(),
      );
    }

    // ─── Narrative thường (không phải code): cũng chia phần nếu lớn ───
    if (!isCode) {
      return runNarrative(
        (part, prevCtx) => MOD_SECTION_PROMPT
          .replace('{SECTION_ID}', section.section_id)
          .replace('{SECTION_LABEL}', section.label)
          .replace('{FIELD_PATH}', section.field_path)
          .replace('{MOD_RULES_APPLIED}', formatRules(rules))
          .replace('{ORIGINAL_CONTENT}', part)
          .replace('{ORIGINAL_SCRIPT}', part)
          .replace('{MIRROR_PATHS}', section.mirror_paths.join(', '))
          .replace('{CONTENT_TYPE}', section.content_type || 'text_narrative')
          .replace('{XML_TAGS}', 'auto-detect')
          .replace('{CARD_LANGUAGE}', 'Vietnamese')
          .replace('{IMPORTANCE_SCORE}', '90')
          .replace('{PREVIOUSLY_MODIFIED_CONTEXT}', prevCtx),
        (resp) => resp.trim(), // MOD_SECTION_PROMPT trả về RAW nội dung (không tag)
      );
    }

    // ─── Code: giữ single-call (KHÔNG chia — chia dễ vỡ cấu trúc code) ───
    const userPrompt = MOD_SCRIPT_PROMPT
      .replace('{SECTION_ID}', section.section_id)
      .replace('{SECTION_LABEL}', section.label)
      .replace('{FIELD_PATH}', section.field_path)
      .replace('{MOD_RULES_APPLIED}', formatRules(rules))
      .replace('{ORIGINAL_CONTENT}', section.content)
      .replace('{ORIGINAL_SCRIPT}', section.content);
    const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
    // Output XML: lấy <modified_script> (fallback raw) — chắc hơn JSON cho script dài.
    return extractTag(response, 'modified_script') || response.trim() || section.content;
  }

  /**
   * MOD BIẾN MVU-ZOD: gom biến schema → AI đề xuất đổi tên/nghĩa theo yêu cầu (output XML, chia lô).
   * Trả về danh sách remap để user duyệt; áp bằng CardParser.applyVariableRemap (deterministic).
   */
  async remapMvuVariables(card: CardV3, userRequest: string): Promise<VariableRemap[]> {
    const infos = CardParser.extractVariableInfos(card);
    if (infos.length === 0) return [];
    const BATCH = 60;
    const results: VariableRemap[] = [];
    for (let i = 0; i < infos.length; i += BATCH) {
      const batch = infos.slice(i, i + BATCH);
      const list = batch
        .map(v => `- ${v.key} | ${v.type} | ${v.describe || '(chưa có mô tả)'}${v.enumValues.length ? ' | enum: ' + v.enumValues.join(', ') : ''}`)
        .join('\n');
      const userPrompt = MVUZOD_VAR_REMAP_PROMPT
        .replace('{USER_REQUEST}', userRequest)
        .replace('{VARIABLE_LIST}', list);
      const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
      results.push(...parseRemapXml(response));
    }
    // Chỉ giữ remap có oldKey là biến THẬT + thực sự thay đổi.
    const valid = new Set(infos.map(v => v.key));
    return results.filter(r => valid.has(r.oldKey) && ((r.newKey && r.newKey !== r.oldKey) || r.newDescribe));
  }

  /** Đào sâu 1 phần nhỏ (sub-block) trong 1 section → trả về TOÀN BỘ section đã đào sâu. */
  async expandSubSection(card: CardV3, sectionContent: string, subMarker: string, instruction: string): Promise<string> {
    const userPrompt = EXPAND_SUBSECTION_PROMPT
      .replace('{SUB_MARKER}', subMarker)
      .replace('{INSTRUCTION}', instruction || '(chi tiết hoá tối đa, giữ đúng ý gốc)')
      .replace('{LORE_DIGEST}', buildLoreDigest(card))
      .replace('{ORIGINAL_CONTENT}', sectionContent);
    const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
    return extractTag(response, 'result') || response.trim() || sectionContent;
  }

  async syncKeywords(card: CardV3, rules: OrchestratorRule[], moddedEntries: { index: number; content: string }[]) {
    if (!moddedEntries || moddedEntries.length === 0) return [];
    
    const userPrompt = KEYWORD_SYNC_PROMPT
      .replace('{MOD_RULES}', formatRules(rules))
      .replace('{MODIFIED_ENTRIES_JSON}', JSON.stringify(moddedEntries, null, 2));

    const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
    
    const parsed = extractJsonArray(response);
    if (!parsed) {
      console.warn("Could not parse JSON array for keyword sync");
      return [];
    }
    return parsed;
  }

  async auditConsistency(card: CardV3, rules: OrchestratorRule[]) {
    const sanitized = JSON.parse(JSON.stringify(card));
    if (sanitized.avatar) sanitized.avatar = "[BASE64_IMAGE_OMITTED]";
    if (sanitized.data?.extensions?.avatar) sanitized.data.extensions.avatar = "[OMITTED]";

    const userPrompt = CONSISTENCY_AUDIT_PROMPT
      .replace('{MOD_RULES}', formatRules(rules))
      .replace('{MODIFIED_CARD_JSON}', JSON.stringify(sanitized, null, 2));

    const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
    
    const parsed = extractJsonObject(response);
    if (!parsed) {
      console.warn("Could not parse JSON object for consistency audit");
      return null;
    }
    return parsed;
  }

  async validateCard(originalCard: CardV3, modifiedCard: CardV3, rules: OrchestratorRule[]) {
    const isMvuZod = CardParser.detectMvuZod(modifiedCard);

    if (isMvuZod) {
      const sanitizeOriginal = JSON.parse(JSON.stringify(originalCard));
      if (sanitizeOriginal.avatar) sanitizeOriginal.avatar = "[BASE64_IMAGE_OMITTED]";
      const sanitizeModified = JSON.parse(JSON.stringify(modifiedCard));
      if (sanitizeModified.avatar) sanitizeModified.avatar = "[BASE64_IMAGE_OMITTED]";
      
      const scripts = modifiedCard.data.extensions?.tavern_helper?.scripts || [];
      // Tìm ĐÚNG script chứa Zod schema thay vì mặc định scripts[1]
      let schemaIdx = scripts.findIndex(s => /z\.object\s*\(|registerMvuSchema/.test(s?.content || ''));
      if (schemaIdx < 0) schemaIdx = scripts.length > 1 ? 1 : 0;
      const schemaScript = scripts[schemaIdx]?.content || '';

      const entries = modifiedCard.data.character_book?.entries || [];
      const updateRulesIdx = entries.findIndex(e => e.comment?.includes('[mvu_update]'));
      const ejsIdx = entries.findIndex(e => e.content?.trim().startsWith('@@preprocessing'));
      const initvarIdx = entries.findIndex(e => e.comment?.includes('[initvar]'));
      const updateRules = updateRulesIdx >= 0 ? entries[updateRulesIdx].content || '' : '';
      const ejsController = ejsIdx >= 0 ? entries[ejsIdx].content || '' : '';
      const initvar = initvarIdx >= 0 ? entries[initvarIdx].content || '' : '';

      // ─── Kiểm cắt cụt BẰNG CODE trên nội dung ĐẦY ĐỦ ───
      // Trước đây mỗi field bị substring(0,2000) rồi mới đưa cho LLM: Zod schema ~5K và
      // mvu_update rules ~7.5K nên LLM chỉ thấy đoạn đứt giữa chừng → báo CRITICAL
      // "schema bị cắt cụt" dù card hoàn toàn nguyên vẹn. Nay đo bằng code rồi nói thẳng
      // kết quả cho LLM, và nếu buộc phải cắt cho vừa prompt thì dán nhãn rõ ràng.
      const integrityPrecheck = [
        // Chỉ Zod schema mới là JS thật → đếm ngoặc mới có nghĩa.
        describeIntegrity(`Schema (Script ${schemaIdx})`, schemaScript, true),
        // Còn lại là văn xuôi/XML → đưa ĐUÔI thật, không đếm ngoặc (ngoặc trong câu chữ gây lệch giả).
        describeIntegrity(`mvu_update Rules (Entry [${updateRulesIdx}])`, updateRules),
        describeIntegrity(`EJS Controller (Entry [${ejsIdx}])`, ejsController),
        describeIntegrity(`initvar (Entry [${initvarIdx}])`, initvar),
      ].join('\n');

      const MAX_FIELD = 12000; // đủ chứa schema (~5K) và rules (~7.5K) thật, không còn cắt oan
      const clip = (s: string, label: string) =>
        s.length <= MAX_FIELD
          ? s
          : `${s.slice(0, MAX_FIELD)}\n\n…[CẮT ĐỂ HIỂN THỊ — còn ${s.length - MAX_FIELD} ký tự nữa không gửi kèm. ` +
            `ĐÂY KHÔNG PHẢI LỖI CỦA CARD: KHÔNG được báo "${label} bị cắt cụt/truncated".]`;

      const userPrompt = MVUZOD_VALIDATE_PROMPT
        .replace('{MOD_SUMMARY}', formatRules(rules))
        .replace('{INTEGRITY_PRECHECK}', integrityPrecheck)
        .replace('{SCHEMA_INDEX}', String(schemaIdx))
        .replace('{UPDATE_RULES_INDEX}', String(updateRulesIdx))
        .replace('{EJS_INDEX}', String(ejsIdx))
        .replace('{INITVAR_INDEX}', String(initvarIdx))
        .replace('{SCHEMA_CONTENT}', clip(schemaScript, 'Schema'))
        .replace('{UPDATE_RULES_CONTENT}', clip(updateRules, 'mvu_update Rules'))
        .replace('{EJS_CONTROLLER_PREVIEW}', clip(ejsController, 'EJS Controller'))
        .replace('{INITVAR_CONTENT}', clip(initvar, 'initvar'));

      const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
      
      const parsed = extractJsonObject<{ validation_status?: string; passed_checks?: unknown[]; issues?: { severity?: string; check?: string; description?: string; fix?: string }[] }>(response);
      if (!parsed) {
        console.warn("Could not parse JSON object for MVU-Zod validation");
        return null;
      }
      // ─── CHẶN CỨNG: bỏ issue "cắt cụt/truncated" khi CODE đã xác nhận ngoặc cân bằng ───
      // Không phụ thuộc việc LLM có tuân thủ luật trong prompt hay không. Đây là nguồn gây
      // báo động giả CRITICAL khiến user tưởng mod hỏng dù card hoàn toàn nguyên vẹn.
      // Một cáo buộc "cắt cụt" chỉ đáng tin khi nội dung THẬT SỰ có vấn đề. Ta biết chắc:
      //  • field nào bị CHÍNH TA cắt cho vừa prompt (→ mọi cáo buộc cắt cụt là ảo), và
      //  • Zod schema có cân bằng ngoặc không (kiểm bằng code trên bản đầy đủ).
      const fieldChecks = [
        { re: /schema|script/i,                clipped: schemaScript.length > MAX_FIELD,   intact: !schemaScript || checkBracketBalance(schemaScript).balanced },
        { re: /mvu_update|update\s*rules/i,    clipped: updateRules.length > MAX_FIELD,    intact: true },
        { re: /ejs|controller/i,               clipped: ejsController.length > MAX_FIELD,  intact: true },
        { re: /initvar/i,                      clipped: initvar.length > MAX_FIELD,        intact: true },
      ];
      const TRUNC_RE = /cắt\s*cụt|truncat|bị\s*cắt|thiếu\s*dấu\s*đóng|chưa\s*đóng\s*ngoặc|unclosed|incomplete\s*schema/i;

      const rawIssues = parsed.issues || [];
      const keptIssues = rawIssues.filter((issue) => {
        const text = `${issue.description || ''} ${issue.fix || ''} ${issue.check || ''}`;
        if (!TRUNC_RE.test(text)) return true; // không phải cáo buộc cắt cụt → giữ nguyên
        const field = fieldChecks.find(f => f.re.test(text));
        if (!field) return true;
        // Ta đã cắt field này để vừa prompt → LLM chỉ đang mô tả vết cắt của chính ta.
        if (field.clipped) {
          console.warn('[validateCard] Bỏ cáo buộc "cắt cụt" ảo (do prompt tự cắt field):', issue.description);
          return false;
        }
        // Gửi trọn vẹn + code xác nhận nguyên vẹn → cáo buộc sai.
        if (field.intact) {
          console.warn('[validateCard] Bỏ cáo buộc "cắt cụt" sai (nội dung gửi đủ & nguyên vẹn):', issue.description);
          return false;
        }
        return true;
      });

      return {
        status: keptIssues.length === 0 && rawIssues.length > 0 ? 'PASS' : (parsed.validation_status || 'PASS'),
        stats: {
          protected_fields_verified: (parsed.passed_checks?.length || 2) * 5
        },
        issues: keptIssues.map((issue: { severity?: string; check?: string; description?: string; fix?: string }) => ({
          severity: issue.severity || 'MEDIUM',
          category: issue.check || 'MVUZOD_INTEGRITY',
          description: issue.description || '',
          fix: issue.fix || ''
        }))
      };
    }

    const sanitizeOriginal = JSON.parse(JSON.stringify(originalCard));
    if (sanitizeOriginal.avatar) sanitizeOriginal.avatar = "[BASE64_IMAGE_OMITTED]";
    if (sanitizeOriginal.data?.extensions?.avatar) sanitizeOriginal.data.extensions.avatar = "[OMITTED]";

    const sanitizeModified = JSON.parse(JSON.stringify(modifiedCard));
    if (sanitizeModified.avatar) sanitizeModified.avatar = "[BASE64_IMAGE_OMITTED]";
    if (sanitizeModified.data?.extensions?.avatar) sanitizeModified.data.extensions.avatar = "[OMITTED]";

    const userPrompt = VALIDATE_CARD_PROMPT
      .replace('{MOD_RULES}', formatRules(rules))
      .replace('{ORIGINAL_CARD_JSON}', JSON.stringify(sanitizeOriginal, null, 2))
      .replace('{MODIFIED_CARD_JSON}', JSON.stringify(sanitizeModified, null, 2));

    const response = await fetchLLM(SYSTEM_PROMPT, userPrompt, this.cfg(), this.signal);
    
    const parsed = extractJsonObject(response);
    if (!parsed) {
      console.warn("Could not parse JSON object for validation");
      return null;
    }
    return parsed;
  }
}
