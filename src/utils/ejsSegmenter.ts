/**
 * ─── Surgical EJS: tách CODE / PROSE cho entry EJS (Chiến lược C) ───
 *
 * (User yêu cầu 2026) Entry lorebook-EJS = văn bản (YAML/note/rule/thoại) LẪN khối code EJS
 * (`<% … %>`), macro `{{…}}`, JSON Patch trong `<%- j({…}) %>`, URL… Gửi NGUYÊN cả entry cho AI →
 * AI dịch nửa vời, lẫn Hán-Việt, hoặc phá code. Giải pháp: CHẺ entry thành đoạn CODE (giữ NGUYÊN)
 * và đoạn PROSE (mới dịch). Chỉ gửi PROSE cho AI, rồi GHÉP LẠI đúng thứ tự.
 *
 * BẤT BIẾN AN TOÀN: `reassembleEjs(segmentEjs(x)) === x` với MỌI x (chỉ slice + nối, không mất byte).
 * Thuần logic, không gọi API — test được bằng vitest.
 */

export type EjsSegmentType = 'code' | 'prose';
export interface EjsSegment {
  type: EjsSegmentType;
  text: string;
}

// Khối được coi là CODE (giữ nguyên tuyệt đối):
//  1. EJS block mọi biến thể: <% … %>, <%- … %>, <%= … %>, <%_ … _%>  (non-greedy, cho phép xuống dòng)
//  2. Macro SillyTavern: {{getvar::X}}, {{char}}, {{user}}, {{random}}…
//  3. URL / đường dẫn ảnh: http(s)://…
// Thứ tự alternation: EJS trước (dài, có thể chứa {{}} bên trong) → macro → URL.
const CODE_TOKEN_RE = /<%[\s\S]*?%>|\{\{[^{}]*\}\}|https?:\/\/[^\s"'`)<>]+/g;

/** Chẻ text EJS thành mảng segment CODE/PROSE theo thứ tự xuất hiện. */
export function segmentEjs(text: string): EjsSegment[] {
  if (typeof text !== 'string' || text.length === 0) {
    return [{ type: 'prose', text: text || '' }];
  }
  const segments: EjsSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((m = CODE_TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'prose', text: text.slice(last, m.index) });
    segments.push({ type: 'code', text: m[0] });
    last = m.index + m[0].length;
    // Bảo vệ chống vòng lặp vô hạn nếu match rỗng (không xảy ra với regex trên, phòng thủ).
    if (m[0].length === 0) CODE_TOKEN_RE.lastIndex++;
  }
  if (last < text.length) segments.push({ type: 'prose', text: text.slice(last) });
  return segments;
}

/** Ghép các segment lại → chuỗi gốc (khi chưa dịch) / chuỗi đã dịch (khi prose.text đã thay). */
export function reassembleEjs(segments: EjsSegment[]): string {
  return segments.map((s) => s.text).join('');
}

const CJK_RE = /[一-鿿㐀-䶿぀-ヿ가-힯]/;

/** Có cần dịch entry này bằng surgical EJS không: có khối EJS `<%…%>` VÀ có prose chứa CJK. */
export function isEjsProseField(text: string): boolean {
  if (typeof text !== 'string' || !text) return false;
  if (!/<%[\s\S]*?%>/.test(text)) return false; // không phải template EJS
  return segmentEjs(text).some((s) => s.type === 'prose' && CJK_RE.test(s.text));
}

/**
 * Chỉ số các segment PROSE CÓ CJK (cần gửi AI). Dùng để dịch chọn lọc rồi ghép lại.
 * Trả về { proseIndices, proseTexts } — caller dịch proseTexts, gán lại vào segments[proseIndices[i]].text.
 */
export function collectProseToTranslate(segments: EjsSegment[]): { indices: number[]; texts: string[] } {
  const indices: number[] = [];
  const texts: string[] = [];
  segments.forEach((s, i) => {
    if (s.type === 'prose' && CJK_RE.test(s.text)) {
      indices.push(i);
      texts.push(s.text);
    }
  });
  return { indices, texts };
}

/** Còn CJK sót ở bất kỳ đoạn PROSE nào sau khi dịch không (cờ để retry/log). */
export function hasResidualCjkInProse(segments: EjsSegment[]): boolean {
  return segments.some((s) => s.type === 'prose' && CJK_RE.test(s.text));
}
