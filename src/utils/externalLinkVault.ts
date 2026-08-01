/**
 * src/utils/externalLinkVault.ts — (bugNeedFix/181) KHO LINK NGOÀI.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "thêm chức năng lưu phần dịch của link ngoài, phân loại link ngoài regex, link ngoài
 * schema để có thể check tham chiếu, vì card có link ngoài nên chức năng liên quan đến kiểm tra
 * lại đều bị phế vì ko đọc được code đã dịch… dành cho card có nhiều link ngoài 4-5 cái."
 *
 * VÌ SAO KIỂM TRA BỊ PHẾ (đọc thẳng từ mã):
 *   • Tab "Link ngoài" cũ chỉ có ĐÚNG MỘT ô nháp, ghi vào một field duy nhất `custom_external_link`.
 *     Dịch link thứ hai là ĐÈ mất link thứ nhất — không có chỗ nào giữ lại 4-5 bản dịch.
 *   • Thẻ dùng link ngoài thì trong thẻ chỉ còn <script src="…cdn…">, code nằm trên GitHub.
 *     VerifyPanel gom `regexFields` từ chính các field của thẻ → rỗng → rơi vào nhánh
 *     `else { setCrossCheckResult(null) }`, tức là kiểm tra chéo TẮT HẲN, và tắt im lặng:
 *     màn hình sạch bong nên trông như "không có lỗi".
 *
 * KHO NÀY LÀ CHỖ THIẾU ĐÓ: mỗi link ngoài là một mục có gốc + bản dịch + phân loại + URL đã đăng.
 * Có kho thì bộ kiểm mới có cái để đọc, và mới đối chiếu được biến giữa các link với nhau và với
 * thẻ (xem externalRefCheck.ts).
 *
 * Lưu ở IndexedDB chứ không localStorage: script TavernHelper thường 1-3MB, 4-5 cái là vượt xa
 * hạn ~5MB của localStorage — nhét vào đó thì mất trắng cả kho lẫn những thứ khác đang lưu chung.
 */
import { IDB } from './idb';

export type ExternalLinkKind =
  | 'regex'          // bộ regex SillyTavern (findRegex/replaceString) — thứ render ra giao diện
  | 'schema'         // cấu trúc biến: [initvar], registerMvuSchema, zod
  | 'tavern_helper'  // script TavernHelper/JS-Slash-Runner chạy trong ST
  | 'ejs'            // template EJS <% … %>
  | 'style'          // CSS thuần
  | 'html_ui'        // mảng HTML giao diện (không có JS)
  | 'other';

export const KIND_LABEL: Record<ExternalLinkKind, string> = {
  regex: 'Regex',
  schema: 'Schema / Cấu trúc biến',
  tavern_helper: 'Tavern Helper',
  ejs: 'EJS',
  style: 'CSS',
  html_ui: 'HTML giao diện',
  other: 'Khác',
};

export interface ExternalLinkEntry {
  id: string;
  /** Tên do user đặt (mặc định lấy từ tên file trong URL). */
  name: string;
  /** URL đã đăng (jsDelivr/raw.githubusercontent…). Rỗng = chưa đăng. */
  url: string;
  kind: ExternalLinkKind;
  /** Vì sao máy xếp vào loại này — để user biết mà sửa khi máy đoán sai. */
  kindReason: string;
  /** User tự chọn loại ⇒ không cho máy đoán đè nữa. */
  kindLocked?: boolean;
  /** Code GỐC (trước dịch). Có thể rỗng nếu user chỉ nhập bản đã đăng về. */
  original: string;
  /** Code ĐÃ DỊCH — đây chính là thứ mọi bộ kiểm cần mà trước giờ không có. */
  translated: string;
  /** Thẻ nào đang dùng link này (chỉ để hiển thị/lọc). */
  cardName?: string;
  updatedAt: number;
}

const VAULT_KEY = 'ext-link-vault-v1';

/* ─────────────────────────── Lưu trữ ─────────────────────────── */

export async function loadVault(): Promise<ExternalLinkEntry[]> {
  const raw = await IDB.get<ExternalLinkEntry[]>(VAULT_KEY, []);
  return Array.isArray(raw) ? raw.filter(e => e && typeof e.id === 'string') : [];
}

export async function saveVault(list: ExternalLinkEntry[]): Promise<void> {
  await IDB.set(VAULT_KEY, list);
}

export function newLinkId(): string {
  return 'ext-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
}

/**
 * Thêm/cập nhật một mục. Ghép theo `id`, không có id thì ghép theo URL (cùng URL = cùng file trên
 * Git, đăng lại thì phải cập nhật chứ không phải đẻ thêm mục trùng), cuối cùng mới theo tên.
 */
export function upsertLink(
  list: ExternalLinkEntry[],
  entry: Omit<ExternalLinkEntry, 'id' | 'updatedAt'> & { id?: string },
): ExternalLinkEntry[] {
  const now = Date.now();
  const key = (e: ExternalLinkEntry) =>
    (entry.id && e.id === entry.id) ||
    (!!entry.url && e.url === entry.url) ||
    (!entry.url && !e.url && e.name === entry.name);

  const idx = list.findIndex(key);
  if (idx >= 0) {
    const merged: ExternalLinkEntry = { ...list[idx], ...entry, id: list[idx].id, updatedAt: now };
    const next = list.slice();
    next[idx] = merged;
    return next;
  }
  return [...list, { ...entry, id: entry.id || newLinkId(), updatedAt: now }];
}

export function removeLink(list: ExternalLinkEntry[], id: string): ExternalLinkEntry[] {
  return list.filter(e => e.id !== id);
}

/* ─────────────────────────── Phân loại ─────────────────────────── */

/** Tên file gợi ý sẵn rất nhiều — nhưng chỉ dùng làm điểm cộng, nội dung mới là bằng chứng chính. */
function hintFromUrl(url: string): ExternalLinkKind | null {
  const u = url.toLowerCase();
  if (/\.css(\?|$)/.test(u)) return 'style';
  if (/regex/.test(u)) return 'regex';
  if (/schema|initvar|mvu[-_.]?var/.test(u)) return 'schema';
  if (/\.ejs(\?|$)/.test(u)) return 'ejs';
  return null;
}

/**
 * Đoán link ngoài này là loại gì, KÈM LÝ DO.
 * Thứ tự xét đi từ bằng chứng chắc nhất xuống: JSON regex của ST → schema biến → EJS →
 * API TavernHelper → CSS/HTML thuần. Đoán sai thì user bấm đổi (kindLocked), không mất gì.
 */
export function classifyExternalLink(
  name: string, url: string, code: string,
): { kind: ExternalLinkKind; reason: string } {
  const c = code || '';
  const head = c.slice(0, 200_000);   // file 3MB thì quét đầu là đủ nhận dạng, khỏi treo UI

  // 1. Bộ regex SillyTavern — chắc chắn nhất: đúng cặp khoá của định dạng regex ST.
  if (/["']findRegex["']\s*:/.test(head) && /["']replaceString["']\s*:/.test(head)) {
    return { kind: 'regex', reason: 'có cặp khoá findRegex/replaceString của định dạng regex SillyTavern' };
  }

  // 2. Cấu trúc biến / schema.
  if (/registerMvuSchema|Mvu\.registerSchema/.test(head)) {
    return { kind: 'schema', reason: 'có registerMvuSchema — đây là file khai báo cấu trúc biến MVU' };
  }
  if (/\bz\s*\.\s*object\s*\(/.test(head) && /\bz\s*\.\s*(string|number|boolean|array|enum)\s*\(/.test(head)) {
    return { kind: 'schema', reason: 'dựng schema bằng zod (z.object/z.string…)' };
  }
  if (/\[initvar\]/i.test(head) || /^\s*stat_data\s*:/m.test(head)) {
    return { kind: 'schema', reason: 'chứa khối [initvar]/stat_data — giá trị khởi tạo của biến' };
  }

  // 3. EJS.
  if (/<%[-=_]?[\s\S]{0,400}?%>/.test(head)) {
    return { kind: 'ejs', reason: 'có khối <% … %> của EJS' };
  }

  // 4. Script TavernHelper / JS-Slash-Runner.
  const thApi = head.match(/\b(TavernHelper|eventOn|eventMakeLast|triggerSlash|getChatMessages|setChatMessages|Mvu\.|SillyTavern\.|getVariables|insertOrAssignVariables|replaceVariables)\b/);
  if (thApi) {
    return { kind: 'tavern_helper', reason: `gọi API của TavernHelper/SillyTavern (${thApi[1]})` };
  }

  // 5. CSS thuần — có luật style mà tuyệt nhiên không có cấu trúc JS.
  const looksJs = /\b(function|=>|const |let |var |return |document\.|window\.)/.test(head);
  if (!looksJs && /[.#@][\w-]+\s*\{[^}]*:[^}]*;/.test(head)) {
    return { kind: 'style', reason: 'chỉ có luật CSS, không có mã JS' };
  }

  // 6. HTML giao diện — nhiều thẻ, không JS.
  if (!looksJs && /<(div|span|table|section|details|button)\b/i.test(head)) {
    return { kind: 'html_ui', reason: 'là mảng HTML giao diện, không có mã JS' };
  }

  const hinted = hintFromUrl(url) ?? hintFromUrl(name);
  if (hinted) return { kind: hinted, reason: 'đoán theo tên file (nội dung không có dấu hiệu rõ ràng)' };

  if (looksJs) return { kind: 'tavern_helper', reason: 'là mã JS nhưng không thấy API đặc trưng — tạm xếp vào script' };
  return { kind: 'other', reason: 'không khớp dấu hiệu nào — cần bạn tự chọn loại' };
}

/** Tên gợi ý từ URL: lấy tên file. */
export function suggestNameFromUrl(url: string): string {
  const clean = (url || '').split(/[?#]/)[0];
  const last = clean.split('/').filter(Boolean).pop() || '';
  return last || 'link-ngoai';
}

/* ─────────────────── Dò link ngoài mà THẺ đang dùng ─────────────────── */

export interface CardExternalUrl {
  url: string;
  /** Field nào của thẻ nhắc tới link này. */
  foundIn: string;
}

/**
 * Quét các field của thẻ để tìm link ngoài thẻ đang nạp.
 * Bắt <script src>, <link href>, import('…') và URL trần trỏ tới file code.
 * Ảnh/ảnh nền không tính — chỉ quan tâm thứ chứa CODE, vì chỉ code mới có biến để đối chiếu.
 */
export function extractCardExternalUrls(
  fields: Array<{ label: string; original?: string; translated?: string }>,
): CardExternalUrl[] {
  const out: CardExternalUrl[] = [];
  const seen = new Set<string>();
  const CODE_EXT = /\.(js|mjs|cjs|css|json|txt|ejs|html?)(\?[^\s"'<>]*)?$/i;

  const URL_RE = /https?:\/\/[^\s"'`<>()]+/g;
  for (const f of fields) {
    const text = `${f.original || ''}\n${f.translated || ''}`;
    if (!text.includes('http')) continue;
    for (const m of text.matchAll(URL_RE)) {
      let url = m[0].replace(/[.,;:]+$/, '');
      if (!CODE_EXT.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, foundIn: f.label });
    }
  }
  return out;
}

/** So kho với thẻ: link nào của thẻ đã có bản dịch lưu, link nào chưa (chỗ kiểm tra sẽ mù). */
export function matchVaultToCard(
  cardUrls: CardExternalUrl[], vault: ExternalLinkEntry[],
): { covered: CardExternalUrl[]; missing: CardExternalUrl[] } {
  // So theo tên file, không so nguyên URL: cùng một file thường có nhiều dạng URL (raw
  // githubusercontent, cdn.jsdelivr, kèm @branch hoặc @commit) — bắt trùng tuyệt đối là hụt hết.
  const known = new Set(vault.map(e => suggestNameFromUrl(e.url).toLowerCase()).filter(Boolean));
  const covered: CardExternalUrl[] = [];
  const missing: CardExternalUrl[] = [];
  for (const u of cardUrls) {
    const file = suggestNameFromUrl(u.url).toLowerCase();
    if (known.has(file)) covered.push(u); else missing.push(u);
  }
  return { covered, missing };
}
