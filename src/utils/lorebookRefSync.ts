/**
 * src/utils/lorebookRefSync.ts — ĐỒNG BỘ THAM CHIẾU LOREBOOK NẰM TRONG CODE.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 2026 — việc 81) Regex và script TavernHelper hay trỏ thẳng vào lorebook bằng CHUỖI:
 *     getLorebookEntries('主世界书')                     ← tên SÁCH
 *     entries.find(e => e.comment === '开场白')          ← tên ENTRY
 *     getwi(null, '世界观设定')                          ← tên ENTRY (kiểu EJS cũ)
 *     entries.find(e => e.uid === 12)                    ← UID
 *
 * Cả ba thứ này đều ĐANG BỊ DỊCH: `data.character_book.name` là field dịch, `entries[i].comment`
 * và `entries[i].name` cũng là field dịch. Nhưng chuỗi nằm TRONG CODE lại được dịch bởi một
 * lượt gọi AI KHÁC, ngữ cảnh khác → gần như chắc chắn ra chữ khác. Kết quả: script tìm không
 * thấy entry nào, im lặng không chạy. Đây là lý do "mismatch không ăn script là gần như tất
 * nhiên sẽ xảy ra".
 *
 * Gốc rễ đã vá ở `buildEntryNameDictionary` (trước chỉ đọc `.name`, mà card thật dùng `.comment`
 * → từ điển rỗng). File này lo phần còn lại: coi mỗi tham chiếu như MỘT KEY, ép chuỗi trong code
 * khớp đúng tên đã dịch, và soi ra tham chiếu nào trỏ vào hư không.
 *
 * NGUYÊN TẮC: chỉ thay chuỗi Ở ĐÚNG VỊ TRÍ ĐỐI SỐ của lời gọi/phép so sánh — KHÔNG thay mù
 * toàn văn bản (thay mù sẽ đụng cả văn xuôi và chuỗi trùng tên trong ngữ cảnh khác).
 */

export type LorebookRefKind = 'book' | 'entry' | 'uid';

export interface LorebookRef {
  kind: LorebookRefKind;
  /** Chuỗi (hoặc số, dạng chuỗi) mà code đang trỏ tới. */
  value: string;
  /** Hàm/phép so sánh phát hiện ra nó — để báo lỗi cho người đọc hiểu. */
  via: string;
}

export interface RefFix {
  kind: LorebookRefKind;
  from: string;
  to: string;
  via: string;
}

export interface RefMismatch extends LorebookRef {
  /** Gợi ý tên đúng nếu đoán được (khớp gần đúng với một entry có thật). */
  suggestion?: string;
}

/** Từ điển đồng bộ: tên gốc → tên đã dịch, tách riêng sách và entry. */
export interface LorebookRefDictionary {
  book: Record<string, string>;
  entry: Record<string, string>;
}

/* ────────────────────────── MẪU NHẬN DẠNG ────────────────────────── */

/**
 * Mỗi mẫu bắt đúng MỘT nhóm là chuỗi tham chiếu (group 1), phần còn lại giữ nguyên.
 * Viết dạng có `(['"\`])` … `\2` để chuỗi phải đóng đúng loại nháy đã mở.
 */
interface RefPattern {
  kind: LorebookRefKind;
  via: string;
  re: RegExp;
  /** Chỉ số nhóm chứa giá trị tham chiếu. */
  group: number;
}

/** Tên hàm TavernHelper thao tác trên cả CUỐN sách — đối số đầu là TÊN SÁCH. */
const BOOK_FNS = [
  'getLorebookEntries',
  'setLorebookEntries',
  'createLorebookEntries',
  'deleteLorebookEntries',
  'createLorebook',
  'deleteLorebook',
  'setCurrentCharPrimaryLorebook',
  'getLorebookSettings',
].join('|');

/** Hàm kiểu EJS/cũ: đối số ĐẦU là tên sách (thường null), đối số HAI là tên entry. */
const ENTRY_FNS = ['getwi', 'getWorldInfo', 'getWorldInfoData', 'getWorldInfoActivatedData', 'activewi', 'activateWorldInfo'].join('|');

function buildPatterns(): RefPattern[] {
  return [
    // getLorebookEntries('主世界书')  ← tên sách ở đối số ĐẦU
    { kind: 'book', via: 'hàm thao tác sách', group: 2, re: new RegExp(`(?:${BOOK_FNS})\\s*\\(\\s*(['"\`])([^'"\`]+)\\1`, 'g') },

    // getwi('主世界书', '开场白')  ← đối số đầu là chuỗi ⇒ tên SÁCH
    { kind: 'book', via: 'đối số sách của getwi', group: 2, re: new RegExp(`(?:${ENTRY_FNS})\\s*\\(\\s*(['"\`])([^'"\`]+)\\1\\s*,`, 'g') },

    // getwi(null, '开场白') / activewi(x.y, "开场白", true)  ← đối số HAI là tên ENTRY
    { kind: 'entry', via: 'đối số entry của getwi/activewi', group: 2, re: new RegExp(`(?:${ENTRY_FNS})\\s*\\(\\s*(?:null|undefined|''|""|\`\`|[\\w.$]+|['"\`][^'"\`]*['"\`])\\s*,\\s*(['"\`])([^'"\`]+)\\1`, 'g') },

    // e.comment === '开场白' / entry.name == "X" / x.comment.trim() === 'X'
    { kind: 'entry', via: 'so sánh comment/name', group: 2, re: /\.(?:comment|name)(?:\s*\.\s*trim\s*\(\s*\))?\s*[=!]==?\s*(['"`])([^'"`]+)\1/g },

    // '开场白' === e.comment  ← viết ngược
    { kind: 'entry', via: 'so sánh comment/name (ngược)', group: 2, re: /(['"`])([^'"`]+)\1\s*[=!]==?\s*[\w.$]*\.(?:comment|name)\b/g },

    // e.comment.includes('开场白') / .startsWith / .endsWith
    { kind: 'entry', via: 'so khớp chuỗi trên comment/name', group: 2, re: /\.(?:comment|name)\s*\.\s*(?:includes|startsWith|endsWith|indexOf|search)\s*\(\s*(['"`])([^'"`]+)\1/g },

    // { comment: '开场白' }  ← tạo/sửa entry
    { kind: 'entry', via: 'gán comment/name', group: 2, re: /\b(?:comment|name)\s*:\s*(['"`])([^'"`]+)\1/g },

    // (bugNeedFix/110) const WI_FILE = '{ Tên sách }';  ← HẰNG SỐ CẤU HÌNH, không phải lời gọi hàm.
    // Đây là kiểu viết phổ biến nhất của bảng trạng thái: script khai một hằng chứa TÊN SÁCH rồi
    // dùng nó đi tra lorebook. Bản cũ chỉ soi đối số của lời gọi hàm nên bỏ lọt hoàn toàn → tên
    // sách trong card và tên trong script được hai lượt dịch khác nhau xử lý ("mùa hè của em" vs
    // "mùa hạ của em") → script không tìm thấy sách, biến không lên bảng.
    {
      kind: 'book', via: 'hằng số tên sách (WI_FILE…)', group: 3,
      re: /\b(?:const|let|var)?\s*\b(WI_FILE|WI_BOOK|WI_NAME|BOOK_NAME|LOREBOOK_NAME|WORLDBOOK_NAME|WORLD_BOOK|LOREBOOK|WORLDBOOK)\b\s*[:=]\s*(['"`])([^'"`]+)\2/gi,
    },

    // e.uid === 12 / uid: 12 / e.uid === '12'
    { kind: 'uid', via: 'so sánh uid', group: 2, re: /\.uid\s*[=!]==?\s*(['"`]?)(\d+)\1/g },
    { kind: 'uid', via: 'gán uid', group: 2, re: /\buid\s*:\s*(['"`]?)(\d+)\1/g },
  ];
}

/** Dò mọi tham chiếu lorebook có trong một đoạn code/text. */
export function extractLorebookRefs(text: string): LorebookRef[] {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set<string>();
  const out: LorebookRef[] = [];

  for (const p of buildPatterns()) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const value = (m[p.group] || '').trim();
      if (!value) continue;
      const key = `${p.kind}::${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: p.kind, value, via: p.via });
    }
  }
  return out;
}

/* ────────────────────────── DỰNG TỪ ĐIỂN ────────────────────────── */

interface DictField {
  path: string;
  original: string;
  translated: string;
  status: string;
}

/**
 * Dựng từ điển tham chiếu từ các field ĐÃ DỊCH XONG.
 * - Tên sách: `data.character_book.name`
 * - Tên entry: `data.character_book.entries[i].comment` và `.name`
 *   (card thật dùng `comment`; `name` chỉ có ở một số card nên gom cả hai)
 */
/**
 * (bugNeedFix/110) KHOÁ TÊN WORLDBOOK — bản dịch tên sách được CHỐT một lần, mọi nơi dùng đúng nó.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "tên worldbook trong card và trong bảng trạng thái thường xuyên không khớp nhau: sách dịch
 * là 'mùa hè của em' thì trong bảng trạng thái lại là 'mùa hạ của em', hệ thống không check được
 * worldbook nên không hiện biến". Gốc: tên sách nằm ở HAI CHỖ (field `character_book.name` và
 * chuỗi trong code), hai chỗ đó do hai lượt gọi AI khác nhau dịch — khác một chữ là đứt.
 *
 * Khoá hoạt động y như khoá từ điển MVU: đã chốt thì pipeline KHÔNG dịch lại tên sách nữa, và mọi
 * tham chiếu trong code bị ép về đúng tên đã chốt.
 */
export type WorldbookNameLock = Record<string, string>;

/** Chuẩn hoá để tra khoá: bỏ khoảng trắng thừa (giữ nguyên chữ hoa/thường và dấu). */
function lockKey(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Tên đã chốt cho một tên sách gốc, nếu có. */
export function getLockedBookName(lock: WorldbookNameLock | undefined, original: string): string | undefined {
  if (!lock) return undefined;
  const k = lockKey(original);
  if (!k) return undefined;
  if (lock[k]) return lock[k];
  // Tra không phân biệt hoa/thường như một lưới đỡ (tên sách hay bị đổi hoa/thường khi copy).
  const lower = k.toLowerCase();
  for (const [o, t] of Object.entries(lock)) {
    if (lockKey(o).toLowerCase() === lower) return t;
  }
  return undefined;
}

/** Ghi/cập nhật một cặp khoá. Trả về BẢN SAO mới (không đột biến tại chỗ). */
export function setLockedBookName(
  lock: WorldbookNameLock | undefined, original: string, translated: string,
): WorldbookNameLock {
  const next = { ...(lock || {}) };
  const k = lockKey(original);
  const v = lockKey(translated);
  if (!k) return next;
  if (!v) delete next[k];
  else next[k] = v;
  return next;
}

export function buildLorebookRefDictionary(
  fields: DictField[],
  /** (bugNeedFix/110) Khoá tên sách — ưu tiên TUYỆT ĐỐI, đè lên bản dịch của lượt hiện tại. */
  lock?: WorldbookNameLock,
): LorebookRefDictionary {
  const book: Record<string, string> = {};
  const entry: Record<string, string> = {};

  for (const f of fields || []) {
    if (f.status !== 'done') continue;
    if (typeof f.translated !== 'string' || !f.translated.trim()) continue;
    const orig = (f.original || '').trim();
    const trans = f.translated.trim();
    if (!orig || orig === trans) continue;

    if (/(?:^|\.)character_book\.name$/.test(f.path)) {
      book[orig] = trans;
    } else if (/character_book\.entries\[\d+\]\.(?:comment|name)$/.test(f.path)) {
      entry[orig] = trans;
    }
  }

  // Khoá đè lên bản dịch của lượt này: user đã chốt thì mọi nơi phải theo, kể cả khi lượt dịch
  // hiện tại vô tình cho ra chữ khác.
  for (const [orig, locked] of Object.entries(lock || {})) {
    const k = lockKey(orig);
    if (k && locked?.trim()) book[k] = locked.trim();
  }
  return { book, entry };
}

/* ────────────────────────── ÉP KHỚP ────────────────────────── */

/**
 * Ép mọi tham chiếu trong code khớp đúng tên đã dịch.
 * Chỉ thay ĐÚNG vị trí đối số của lời gọi/phép so sánh — văn xuôi quanh đó không bị đụng.
 * `uid` không bao giờ bị đổi (số, không dịch).
 */
export function enforceLorebookRefs(
  text: string,
  dict: LorebookRefDictionary,
): { text: string; fixes: RefFix[] } {
  if (!text || typeof text !== 'string') return { text: text || '', fixes: [] };
  const fixes: RefFix[] = [];
  let out = text;

  for (const p of buildPatterns()) {
    if (p.kind === 'uid') continue;
    const table = p.kind === 'book' ? dict.book : dict.entry;
    if (!table || Object.keys(table).length === 0) continue;

    p.re.lastIndex = 0;
    out = out.replace(p.re, (whole, ...rest) => {
      // rest = [group1, group2, …, offset, string] → giá trị nằm ở p.group - 1.
      const value = String(rest[p.group - 1] ?? '').trim();
      const target = table[value];
      if (!target || target === value) return whole;
      fixes.push({ kind: p.kind, from: value, to: target, via: p.via });
      // Thay ĐÚNG một lần, đúng chuỗi đó, trong phạm vi đoạn đã khớp.
      return whole.replace(value, target);
    });
  }

  return { text: out, fixes };
}

/* ────────────────────────── SOI LỖI ────────────────────────── */

export interface CardLike {
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

interface EntryLike { comment?: string; name?: string; uid?: number | string }

/** Lấy danh sách tên/uid CÓ THẬT trong card (dùng để biết tham chiếu nào trỏ vào hư không). */
export function collectLorebookIdentity(card: CardLike): {
  bookNames: Set<string>;
  entryNames: Set<string>;
  uids: Set<string>;
} {
  const d = ((card?.data as Record<string, unknown>) || card || {}) as Record<string, unknown>;
  const cb = (d.character_book || {}) as { name?: string; entries?: EntryLike[] };
  const bookNames = new Set<string>();
  if (cb.name && String(cb.name).trim()) bookNames.add(String(cb.name).trim());

  const entryNames = new Set<string>();
  const uids = new Set<string>();
  for (const e of cb.entries || []) {
    if (e?.comment && String(e.comment).trim()) entryNames.add(String(e.comment).trim());
    if (e?.name && String(e.name).trim()) entryNames.add(String(e.name).trim());
    if (e?.uid !== undefined && e?.uid !== null && String(e.uid).trim()) uids.add(String(e.uid).trim());
  }
  return { bookNames, entryNames, uids };
}

/**
 * Khối luật bơm vào prompt khi dịch field CODE (regex / TavernHelper).
 * Chuỗi tên sách/tên entry nằm trong code KHÔNG phải văn xuôi — nó là KHOÁ TRA CỨU, dịch lệch
 * một chữ là script mất kết nối với lorebook. Trả về '' khi chưa có gì để dặn.
 */
export function buildLorebookRefPromptBlock(dict: LorebookRefDictionary): string {
  const bookList = Object.entries(dict.book || {});
  const entryList = Object.entries(dict.entry || {});
  if (bookList.length === 0 && entryList.length === 0) return '';

  const fmt = (rows: [string, string][]) =>
    rows.slice(0, 60).map(([o, t]) => `  "${o}" → "${t}"`).join('\n');

  const parts = [
    '',
    '=== TÊN SÁCH / TÊN ENTRY LOREBOOK TRONG CODE LÀ KHOÁ TRA CỨU (BẮT BUỘC DÙNG ĐÚNG) ===',
    'Những chuỗi dưới đây KHÔNG phải văn xuôi để dịch tự do. Code dùng chúng để TÌM lorebook:',
    "  getLorebookEntries('tên sách')      entries.find(e => e.comment === 'tên entry')",
    "  getwi(null, 'tên entry')            activewi(null, 'tên entry', true)",
    'Sai một chữ là script không tìm thấy gì và IM LẶNG không chạy — card hỏng mà không báo lỗi.',
    'Gặp các chuỗi này trong code, PHẢI thay bằng đúng bản bên phải, không được dịch kiểu khác:',
  ];
  if (bookList.length) parts.push('TÊN SÁCH:', fmt(bookList));
  if (entryList.length) parts.push('TÊN ENTRY:', fmt(entryList));
  parts.push('Giá trị `uid` là SỐ — tuyệt đối không đổi.');
  return parts.join('\n');
}

/** So chuỗi bỏ qua hoa/thường + khoảng trắng — để gợi ý tên đúng khi chỉ lệch vỏ. */
function loose(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/[\s_-]+/g, '');
}

/**
 * Soi các tham chiếu trong code của card CUỐI CÙNG: cái nào không trỏ tới sách/entry/uid nào có
 * thật thì báo. Đây là thứ user cần thấy — mismatch trước giờ HOÀN TOÀN IM LẶNG, script chỉ
 * đơn giản là không chạy mà không có lỗi nào hiện ra.
 */
export function validateLorebookRefs(
  card: CardLike,
  codeTexts: { text: string; source: string }[],
): { mismatches: (RefMismatch & { source: string })[]; checked: number } {
  const { bookNames, entryNames, uids } = collectLorebookIdentity(card);
  const mismatches: (RefMismatch & { source: string })[] = [];
  let checked = 0;

  for (const { text, source } of codeTexts || []) {
    for (const ref of extractLorebookRefs(text)) {
      checked++;
      const pool = ref.kind === 'book' ? bookNames : ref.kind === 'entry' ? entryNames : uids;
      // Card không có uid nào (nhiều card không dùng) thì đừng báo oan tham chiếu uid.
      if (ref.kind === 'uid' && pool.size === 0) continue;
      if (pool.has(ref.value)) continue;

      // Chỉ lệch vỏ (hoa/thường, khoảng trắng) → gợi ý luôn tên đúng.
      const suggestion = Array.from(pool).find(n => loose(n) === loose(ref.value));
      mismatches.push({ ...ref, source, suggestion });
    }
  }
  return { mismatches, checked };
}
