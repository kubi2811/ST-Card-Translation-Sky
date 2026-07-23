/**
 * (User 23/07 — bug 93) "Nâng cấp Regex Lab có thêm preview, mà xem được giao diện như trên
 * SillyTavern khi bọc ```html và ```".
 *
 * Card MVU gói giao diện trong khối fence Markdown:
 *
 *     ```html
 *     <!DOCTYPE html> … </html>
 *     ```
 *
 * SillyTavern bóc fence rồi render HTML bên trong. Regex Lab thì trước giờ nhét NGUYÊN chuỗi
 * (kể cả dấu fence) vào iframe, nên user thấy chữ "```html" nằm chình ình trên đầu và phần
 * HTML thì hiển thị như văn bản. Không xem trước được giao diện thật.
 *
 * Module này bóc fence y như ST, và chịu được các biến thể hay gặp:
 *  - fence chỉ mở mà chưa đóng (thẻ đang viết dở, hoặc lỗi thiếu fence đóng — chính là bug 72)
 *  - có chữ dẫn trước/sau khối fence
 *  - nhiều khối fence trong một replaceString
 *  - fence ghi là ```HTML hoặc ``` trần
 */

/** Một khối fence tìm thấy trong văn bản. */
export interface FenceBlock {
  /** Nội dung bên trong fence (đã bỏ dấu fence). */
  html: string;
  /** Ngôn ngữ khai sau dấu fence mở ('' nếu fence trần). */
  lang: string;
  /** Fence có dấu đóng không — thiếu là lỗi thật, ST sẽ không render. */
  closed: boolean;
}

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)[ \t]*$/;

/**
 * Tách mọi khối fence trong văn bản.
 * Trả mảng rỗng khi không có fence nào — khi đó cứ render nguyên văn như cũ.
 */
export function extractFenceBlocks(text: string): FenceBlock[] {
  const lines = String(text ?? '').split('\n');
  const out: FenceBlock[] = [];
  let open: { marker: string; lang: string; buf: string[] } | null = null;

  for (const line of lines) {
    if (!open) {
      const m = line.match(FENCE_OPEN);
      if (m) open = { marker: m[1][0], lang: (m[2] || '').toLowerCase(), buf: [] };
      continue;
    }
    // Dấu đóng phải cùng loại ký tự (` hay ~) và không kèm ngôn ngữ.
    const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
    if (close && close[1][0] === open.marker) {
      out.push({ html: open.buf.join('\n'), lang: open.lang, closed: true });
      open = null;
      continue;
    }
    open.buf.push(line);
  }

  // Fence mở mà không đóng: vẫn lấy nội dung ra để user xem trước được, nhưng đánh dấu
  // closed=false để UI cảnh báo — đây đúng là lỗi khiến ST không render (xem bug 72).
  if (open) out.push({ html: open.buf.join('\n'), lang: open.lang, closed: false });

  return out;
}

export interface UnfencedResult {
  /** HTML để đưa vào iframe. */
  html: string;
  /** Có tìm thấy khối fence nào không. */
  hadFence: boolean;
  /** Có khối nào thiếu dấu fence đóng không — ST sẽ KHÔNG render khối đó. */
  unclosed: boolean;
  /** Số khối fence tìm được. */
  blockCount: number;
}

/**
 * Bóc fence để lấy HTML đem render, mô phỏng đúng cách SillyTavern xử lý.
 *
 * Không có fence ⇒ trả nguyên văn (nhiều regex thay bằng HTML trần, vẫn render được).
 * Nhiều khối ⇒ nối lại, vì ST cũng render lần lượt từng khối trong một tin nhắn.
 */
export function stripHtmlFence(text: string): UnfencedResult {
  const src = String(text ?? '');
  const blocks = extractFenceBlocks(src);
  if (blocks.length === 0) {
    return { html: src, hadFence: false, unclosed: false, blockCount: 0 };
  }
  return {
    html: blocks.map(b => b.html).join('\n'),
    hadFence: true,
    unclosed: blocks.some(b => !b.closed),
    blockCount: blocks.length,
  };
}
