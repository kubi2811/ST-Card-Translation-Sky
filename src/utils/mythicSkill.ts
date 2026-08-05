/**
 * (User 23/07 — Chiến lược A) Dịch card dùng **Mythic** (Auto Database).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * CARD MYTHIC HOẠT ĐỘNG THẾ NÀO — đo trên card thật `bugNeedFix/94/Reborn_V1.5_.png`
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Đây KHÔNG phải card thường. Mọi trường chính đều rỗng (description/personality/scenario/
 * system_prompt = 0 ký tự, first_mes = 4 ký tự). Toàn bộ nội dung nằm ở 689 lorebook entry
 * (~1 triệu ký tự) và 7 script TavernHelper (~3,07 triệu ký tự).
 *
 * Điểm mấu chốt: entry được kích hoạt bằng **Agent ngữ nghĩa**, không phải keyword. Metadata
 * nằm trong trường `comment` (KHÔNG phải `content`), dạng JSON nhúng trong HTML comment:
 *
 *     🧬斗四：斗天者
 *     <!-- ACU_SKILL_META_START {"description":"…","triggerWhen":"…","tk":234} ACU_SKILL_META_END -->
 *     <!-- DOULUO_AGENT_SKILL_V2_START {"description":"…","triggerWhen":"…","eras":["dou4"],
 *          "sourceHash":"fnv1a-v1:…","sourceSkillHash":"fnv1a-v1:…"} DOULUO_AGENT_SKILL_V2_END -->
 *
 * Script `斗罗 Agent 分层召回伴侣` đọc `triggerWhen` để quyết định nạp entry nào vào ngữ cảnh.
 *
 * ═══ BỐN RÀNG BUỘC SỐNG CÒN ═══
 *
 * 1. KHÔNG dịch `triggerWhen` thì card CHẾT. Người chơi chat tiếng Việt mà `triggerWhen` là
 *    tiếng Trung ⇒ Agent không khớp ⇒ entry không bao giờ được nạp. Chiến lược B/C không hề
 *    đụng tới hai field này (chúng nằm trong comment, dạng JSON trong HTML comment).
 *
 * 2. HASH phải tính lại. Script tự tính hash để biết entry có bị sửa ngoài không:
 *      sourceHash      ← {title, keys, keysecondary, content, eras}
 *      sourceSkillHash ← {description, triggerWhen, tk}
 *    Dịch xong mà giữ hash cũ ⇒ script thấy lệch ⇒ coi entry đã hỏng.
 *
 * 3. `eras` là điều kiện sinh tử: script có `if (!eras.length) return null` — mất era thì skill
 *    bị LOẠI HOÀN TOÀN. Mà `deriveEras` dò từ khoá tiếng Trung trong TIÊU ĐỀ (斗三/斗四/通用…).
 *    660/689 entry có `eras` sẵn trong meta (giữ nguyên là an toàn), 29 entry còn lại phụ thuộc
 *    tiêu đề ⇒ dịch tên mà bỏ từ khoá era là mất era.
 *
 * 4. Các field kỹ thuật (`version`, `kind`, `tk`, `updatedAt`, `updatedBy`, `eras`) phải giữ
 *    NGUYÊN VĂN — chúng là hợp đồng với script, không phải văn bản cho người đọc.
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * 1. HASH — chép đúng thuật toán trong script Agent (không được lệch một bit)
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * FNV-1a 32-bit, y hệt script:
 *   let hash = 0x811c9dc5;
 *   hash ^= input.charCodeAt(i); hash = Math.imul(hash, 0x01000193);
 *   return hash >>> 0;
 */
export function fnv1a(value: unknown): number {
  let hash = 0x811c9dc5;
  const input = String(value ?? '');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function stableHashHex(value: unknown): string {
  return fnv1a(value).toString(16).padStart(8, '0');
}

/** `text()` của script: ép chuỗi rồi trim. */
const text = (v: unknown): string => String(v ?? '').trim();

/**
 * `normalizeStringList()` của script: tách theo `,` `，` xuống dòng, bỏ trùng, **sắp xếp theo
 * locale zh-CN**. Thứ tự sắp xếp ảnh hưởng thẳng tới hash nên phải giữ đúng locale.
 */
export function normalizeStringList(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\n]/)
      : [];
  return [...new Set(raw.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** Danh sách era hợp lệ, đúng thứ tự trong script (thứ tự này vào hash). */
export const ERA_IDS = ['dou1', 'dou2', 'dou3', 'dou4', 'common'] as const;

export function normalizeEras(value: unknown): string[] {
  const selected = new Set(normalizeStringList(value).map(s => s.toLowerCase()));
  return ERA_IDS.filter(era => selected.has(era));
}

/** Bóc mọi khối meta khỏi tiêu đề — script dùng `stripAllMeta` trước khi tính hash. */
export function stripAllMeta(value: unknown): string {
  return String(value ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
}

export interface EntryForHash {
  comment?: string;
  name?: string;
  keys?: unknown;
  key?: unknown;
  keysecondary?: unknown;
  content?: string;
}

/** `buildSourceHash()` của script — hash của bản thân entry. */
export function buildSourceHash(entry: EntryForHash, eras: unknown): string {
  const payload = JSON.stringify({
    title: stripAllMeta(entry?.comment || entry?.name || ''),
    keys: normalizeStringList([...normalizeStringList(entry?.keys), ...normalizeStringList(entry?.key)]),
    keysecondary: normalizeStringList(entry?.keysecondary),
    content: String(entry?.content || '').trim().replace(/\r\n?/g, '\n'),
    eras: normalizeEras(eras),
  });
  return `fnv1a-v1:${stableHashHex(payload)}`;
}

/** `buildSkillHash()` của script — hash của phần "kỹ năng" mà Agent đọc. */
export function buildSkillHash(skill: { description?: unknown; triggerWhen?: unknown; tk?: unknown }): string {
  const payload = JSON.stringify({
    description: text(skill?.description),
    triggerWhen: text(skill?.triggerWhen),
    tk: Math.max(0, Math.trunc(Number(skill?.tk) || 0)),
  });
  return `fnv1a-v1:${stableHashHex(payload)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 2. BÓC / GHÉP KHỐI META
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Các khối meta đã gặp trên card thật. Tên khối = phần trước `_START`. */
export const META_BLOCK_NAMES = ['ACU_SKILL_META', 'DOULUO_AGENT_SKILL_V2'] as const;

export interface MetaBlock {
  /** Tên khối, ví dụ 'DOULUO_AGENT_SKILL_V2'. */
  name: string;
  /** JSON đã parse. */
  data: Record<string, unknown>;
  /** Nguyên văn khối (kể cả dấu comment) — để thay thế chính xác. */
  raw: string;
}

export interface ParsedComment {
  /** Tiêu đề hiển thị (phần trước mọi khối meta). */
  title: string;
  blocks: MetaBlock[];
}

const blockRe = /<!--\s*([A-Z0-9_]+?)_START\s*([\s\S]*?)\s*\1_END\s*-->/g;

/** Tách `comment` thành tiêu đề + các khối meta. */
export function parseMythicComment(comment: string): ParsedComment {
  const src = String(comment ?? '');
  const blocks: MetaBlock[] = [];
  blockRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src)) !== null) {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(m[2]);
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch {
      continue; // khối hỏng thì bỏ qua, KHÔNG dựng lại kẻo phá dữ liệu
    }
    blocks.push({ name: m[1], data, raw: m[0] });
  }
  return { title: stripAllMeta(src), blocks };
}

/** Thẻ có phải card Mythic không — dùng để bật gợi ý Chiến lược A. */
export function detectMythicCard(card: unknown): { isMythic: boolean; skillEntries: number; totalEntries: number } {
  const entries = ((card as { data?: { character_book?: { entries?: unknown[] } } })?.data?.character_book?.entries) ?? [];
  let skillEntries = 0;
  for (const e of entries) {
    const cm = String((e as { comment?: string })?.comment ?? '');
    if (META_BLOCK_NAMES.some(n => cm.includes(`${n}_START`))) skillEntries++;
  }
  return { isMythic: skillEntries > 0, skillEntries, totalEntries: entries.length };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 3. TRÍCH PHẦN CẦN DỊCH / GHÉP BẢN DỊCH VÀO LẠI
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Chỉ HAI field này được dịch trong meta. Mọi field khác là hợp đồng với script. */
export const TRANSLATABLE_META_FIELDS = ['description', 'triggerWhen'] as const;

export interface MythicSkillField {
  /** Chỉ số entry trong character_book.entries. */
  entryIndex: number;
  blockName: string;
  field: 'description' | 'triggerWhen';
  original: string;
}

/** Quét cả thẻ, lấy ra mọi `description`/`triggerWhen` cần dịch. */
export function extractMythicFields(card: unknown): MythicSkillField[] {
  const entries = ((card as { data?: { character_book?: { entries?: unknown[] } } })?.data?.character_book?.entries) ?? [];
  const out: MythicSkillField[] = [];
  entries.forEach((e, entryIndex) => {
    const { blocks } = parseMythicComment(String((e as { comment?: string })?.comment ?? ''));
    for (const b of blocks) {
      for (const field of TRANSLATABLE_META_FIELDS) {
        const v = b.data[field];
        if (typeof v === 'string' && v.trim()) {
          out.push({ entryIndex, blockName: b.name, field, original: v });
        }
      }
    }
  });
  return out;
}

export interface ApplyResult {
  comment: string;
  /** Số field meta đã thay bản dịch. */
  metaFieldsApplied: number;
  /** Hash đã được tính lại cho khối nào. */
  hashesRebuilt: string[];
}

/**
 * Ghép bản dịch vào `comment` của một entry, rồi **tính lại hash**.
 *
 * `translations` khoá theo `${blockName}.${field}`.
 * `entryForHash` là entry SAU KHI đã dịch title/content — hash phải phản ánh nội dung cuối.
 */
export function applyMythicTranslation(
  comment: string,
  translations: Map<string, string>,
  entryForHash: EntryForHash,
): ApplyResult {
  const { blocks } = parseMythicComment(comment);
  let out = String(comment ?? '');
  let metaFieldsApplied = 0;
  const hashesRebuilt: string[] = [];

  for (const b of blocks) {
    const next: Record<string, unknown> = { ...b.data };
    let touched = false;

    for (const field of TRANSLATABLE_META_FIELDS) {
      const key = `${b.name}.${field}`;
      const t = translations.get(key);
      if (typeof t === 'string' && t.trim() && t !== next[field]) {
        next[field] = t;
        metaFieldsApplied++;
        touched = true;
      }
    }

    // Hash phải tính lại NGAY CẢ KHI meta không đổi — vì title/content của entry có thể đã
    // được dịch ở nhánh khác, mà sourceHash lấy chính title/content làm đầu vào.
    if ('sourceSkillHash' in next) {
      const h = buildSkillHash({ description: next.description, triggerWhen: next.triggerWhen, tk: next.tk });
      if (h !== next.sourceSkillHash) { next.sourceSkillHash = h; hashesRebuilt.push(`${b.name}.sourceSkillHash`); touched = true; }
    }
    if ('sourceHash' in next) {
      const h = buildSourceHash(entryForHash, next.eras);
      if (h !== next.sourceHash) { next.sourceHash = h; hashesRebuilt.push(`${b.name}.sourceHash`); touched = true; }
    }

    if (!touched) continue;
    // Giữ nguyên định dạng khối gốc: xuống dòng sau _START, JSON một dòng, xuống dòng trước _END.
    const rebuilt = `<!-- ${b.name}_START\n${JSON.stringify(next)}\n${b.name}_END -->`;
    // (bug 213) PHẢI dùng callback. `rebuilt` chứa description/triggerWhen ĐÃ DỊCH; nếu bản dịch
    // có `$&`, `$'`, "$`" hay `$1` (AI echo nhầm capture group, hoặc văn bản có ký hiệu tiền tệ
    // kèm ký tự đặc biệt) thì String.replace diễn giải chúng thành pattern thay thế → khối meta
    // bị chèn rác, JSON hỏng, entry bị Agent loại. Truyền hàm thì chuỗi được chèn nguyên văn.
    out = out.replace(b.raw, () => rebuilt);
  }

  return { comment: out, metaFieldsApplied, hashesRebuilt };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 4. GIỮ TỪ KHOÁ ERA TRONG TIÊU ĐỀ
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Từ khoá era mà `deriveEras` của script dò trong TIÊU ĐỀ. Entry không có `eras` trong meta
 * phải dựa hoàn toàn vào đây — dịch tên mà bỏ mất từ khoá là entry mất era và bị Agent loại.
 */
export const ERA_TITLE_KEYWORDS = [
  '斗一', '斗1', '斗罗大陆', '第一纪元',
  '斗二', '斗2', '绝世唐门', '第二纪元',
  '斗三', '斗3', '龙王传说', '第三纪元',
  '斗四', '斗4', '终极斗罗', '第四纪元', '星海征途',
  '通用', '全时代', '跨时代通用',
];

/** Tiêu đề có chứa từ khoá era không. */
export function titleHasEraKeyword(title: string): boolean {
  const s = String(title ?? '');
  return ERA_TITLE_KEYWORDS.some(k => s.includes(k));
}

/**
 * Entry này có AN TOÀN khi dịch tiêu đề không?
 * An toàn khi meta đã ghi sẵn `eras` — lúc đó script đọc meta, không cần dò tiêu đề.
 */
export function titleTranslationIsSafe(comment: string): boolean {
  const { blocks, title } = parseMythicComment(comment);
  const hasEras = blocks.some(b => Array.isArray(b.data.eras) && (b.data.eras as unknown[]).length > 0);
  return hasEras || !titleHasEraKeyword(title);
}
