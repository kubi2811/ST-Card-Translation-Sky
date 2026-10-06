/**
 * src/utils/codeLiterals.ts — (bug 257) CHUỖI TIẾNG TRUNG TRONG CODE: MỘT GỐC, MỘT BẢN DỊCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thẻ thật (thanh trạng thái "Thần Hào"): CÙNG chuỗi `'房产地产'` xuất hiện ở key của `titleMap`,
 * phần tử của mảng `order` và giá trị `return` của hàm phân loại. Dịch xong ra ba kiểu:
 *   titleMap: 'Bất động sản' · order: 'nhà đất' · return: 'nhà đất'
 * ⇒ `cats[type].push` ném TypeError, cả tab tài sản (và mọi tab render sau nó) chết.
 * Đường surgical chỉ gom bản dịch cho định danh / key object / class CSS; chuỗi đứng trong mảng,
 * sau `return`, sau `===` thì mỗi chỗ hỏi AI một lần riêng.
 *
 * Quy tắc mới: cụm chữ Hán chiếm TRỌN một chuỗi (`'房产地产'`, `"18-25岁"`) là một "giá trị" mà
 * code dùng để tra / so sánh ⇒ mọi chỗ cùng gốc phải ra cùng bản dịch — trong một field (gom lúc
 * dịch) và giữa các field của thẻ (từ điển chuỗi lưu theo thẻ, như từ điển MVU).
 *
 * Cùng họ: (bug 257) khi chuỗi đó được NỐI với biến (`diff + '天后临产'`), tiếng Trung không cần
 * dấu cách còn tiếng Việt thì cần — "Dự Đoán5Ngày nữa", "bước vàoKỳ An Toàn". Thêm đúng một dấu
 * cách ở phía có phép nối.
 */
import type { CJKToken } from './surgical';

/** Chuỗi dài hơn mức này là câu văn (thông báo, tooltip) chứ không phải giá trị tra cứu. */
export const MAX_LITERAL_KEY_CHARS = 24;

const CJK_RE = /[㐀-䶿一-鿿぀-ヿ가-힯]/;

/** Cụm có chiếm TRỌN nội dung một chuỗi không (`'房产地产'` — cả trong lẫn ngoài là nháy). */
export function isWholeLiteralToken(text: string, token: Pick<CJKToken, 'start' | 'end' | 'text'>): boolean {
  const q = text[token.start - 1];
  if (q !== "'" && q !== '"' && q !== '`') return false;
  if (text[token.end] !== q) return false;
  // `\'` đứng trước thì nháy đó là ký tự trong chuỗi, không phải nháy mở
  return text[token.start - 2] !== '\\';
}

/** Cụm có đủ tư cách vào từ điển chuỗi toàn thẻ. */
export function isLiteralKeyCandidate(text: string, token: Pick<CJKToken, 'start' | 'end' | 'text'>): boolean {
  const t = token.text.trim();
  return t.length >= 2 && t.length <= MAX_LITERAL_KEY_CHARS && isWholeLiteralToken(text, token);
}

/* ─── Từ điển chuỗi của thẻ đang dịch — store đăng ký vào đây (util không import store) ─── */
interface LiteralStore { get(): Record<string, string>; merge(add: Record<string, string>): void }
let store: LiteralStore | null = null;
export function registerCodeLiteralStore(s: LiteralStore | null): void { store = s; }
export function getCodeLiteralDict(): Record<string, string> {
  try { return store?.get() || {}; } catch { return {}; }
}
export function mergeCodeLiteralDict(add: Record<string, string>): void {
  if (!store || !Object.keys(add).length) return;
  try { store.merge(add); } catch { /* từ điển chỉ là tối ưu nhất quán — lỗi thì bỏ qua */ }
}

/**
 * (bug 257) Thêm dấu cách ở mép bản dịch nếu chuỗi đó đang được NỐI với biểu thức khác:
 *   `prefix + diff + '天后临产'`      ⇒ `' Ngày nữa sắp sinh'`
 *   `'今天进入' + phase`              ⇒ `'Hôm nay bước vào '`
 *   `${n}天后`                         ⇒ `${n} ngày sau`
 * Không đụng khi phép nối đang dựng TÊN KEY trong `[...]` (thêm dấu cách là đổi key), khi bản dịch
 * đã có dấu cách/dấu câu ở mép, hoặc khi token là định danh/key/class.
 */
export function padConcatBoundaries(text: string, token: CJKToken, translated: string): string {
  if (!translated || token.isObjectKey || token.isDotNotation || token.isIdentifier || token.isCssClass || token.isHtmlAttr) return translated;
  const q = token.inStringQuote;
  if (!q) return translated;
  let out = translated;
  const before = text.slice(Math.max(0, token.start - 160), token.start);
  const after = text.slice(token.end, token.end + 160);
  // Mép trái: `… + '天…` hoặc `${…}天…`
  if (/^[A-Za-zÀ-ỹĐđ0-9]/.test(out)) {
    const concat = q === '`' ? /\}$/.test(before) : new RegExp(`\\+[ \\t]*${q}$`).test(before);
    const inKey = q !== '`' && new RegExp(`\\[[ \\t]*[\\w$.()'"\\[\\]]*[ \\t]*\\+[ \\t]*${q}$`).test(before);
    if (concat && !inKey) out = ' ' + out;
  }
  // Mép phải: `…天' + …` hoặc `…天${…}`
  if (/[A-Za-zÀ-ỹĐđ0-9]$/.test(out)) {
    const concat = q === '`' ? /^\$\{/.test(after) : new RegExp(`^${q}[ \\t]*\\+`).test(after);
    const inKey = q !== '`' && new RegExp(`^${q}[ \\t]*\\+[ \\t]*[\\w$.()'"\\[\\]]*[ \\t]*\\]`).test(after);
    if (concat && !inKey) out = out + ' ';
  }
  return out;
}

/** Bản dịch có đủ sạch để nhớ lại cho chỗ khác không (không rỗng, không còn chữ Hán). */
export function isRememberableLiteral(translated: string | undefined): translated is string {
  return !!translated && !!translated.trim() && !CJK_RE.test(translated) && translated.length <= 120;
}

/**
 * Số chuỗi mang DẤU VẾT GỘP: một chuỗi nháy kép mà bên trong là `' + biểu thức + '` (hoặc ngược lại)
 * — tức hai chuỗi nối quanh một biểu thức đã bị đổi nháy ngoài thành một chuỗi hằng.
 */
export function countMergedConcatStrings(code: string): number {
  if (!code) return 0;
  const a = code.match(/"[^"\n]*'[ \t]*\+[^"\n]*\+[ \t]*'[^"\n]*"/g) ?? [];
  const b = code.match(/'[^'\n]*"[ \t]*\+[^'\n]*\+[ \t]*"[^'\n]*'/g) ?? [];
  return a.length + b.length;
}

/**
 * (bug 257) Bản dịch có thêm bao nhiêu chuỗi bị GỘP so với bản gốc (`'[' + x + ']'` →
 * `"[' + x + ']"`). Code vẫn chạy nên chốt cú pháp không thấy — chỉ giao diện in nguyên văn đoạn
 * code. Không đếm tổng số chuỗi: đổi bracket / bọc nháy key thêm hàng trăm chuỗi hợp lệ, che mất
 * vài chỗ gộp (đo trên thẻ thật: lệch ròng bằng 0).
 */
export function stringLiteralDrop(original: string, translated: string): number {
  try {
    const d = countMergedConcatStrings(translated) - countMergedConcatStrings(original);
    return d > 0 ? d : 0;
  } catch { return 0; }
}
