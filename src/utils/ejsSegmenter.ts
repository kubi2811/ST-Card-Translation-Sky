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

// Token MASK cho khối CODE — dạng `{{__ejs_N__}}` (giống macro ST) để AI GIỮ NGUYÊN (prompt đã dặn
// bảo toàn {{…}}). Chỉ số N để unmask khôi phục đúng code gốc.
const EJS_MASK = (i: number) => `{{__ejs_${i}__}}`;
const EJS_MASK_RE = /\{\{__ejs_(\d+)__\}\}/g;

/**
 * (User 2026 — Đợt 1b) MASK toàn bộ CODE (khối EJS `<%…%>`, macro `{{…}}`, URL — kể cả CJK BÊN TRONG
 * code) thành token `{{__ejs_N__}}`, CHỈ để lại PROSE. Gửi `masked` cho AI dịch → AI không thấy/không
 * đụng code ⇒ hết "dịch nửa vời / vỡ code". CJK trong code do từ điển EJS (covariance) lo sau đó.
 * Nếu text đã lỡ chứa chuỗi `__ejs_` (cực hiếm) → không mask để tránh nhầm khi unmask.
 */
export function maskEjsCode(text: string): { masked: string; codes: string[] } {
  if (typeof text !== 'string' || !text || text.includes('__ejs_')) {
    return { masked: text || '', codes: [] };
  }
  const segs = segmentEjs(text);
  const codes: string[] = [];
  let masked = '';
  for (const s of segs) {
    if (s.type === 'code') { masked += EJS_MASK(codes.length); codes.push(s.text); }
    else masked += s.text;
  }
  return { masked, codes };
}

/**
 * Khôi phục CODE: thay `{{__ejs_N__}}` bằng code gốc. Trả về `restored` = số token khôi phục được để
 * caller KIỂM: nếu restored !== codes.length ⇒ AI đã làm hỏng/rơi token ⇒ nên bỏ mask, dịch cách thường.
 */
export function unmaskEjsCode(translated: string, codes: string[]): { text: string; restored: number } {
  if (typeof translated !== 'string') return { text: translated, restored: 0 };
  let restored = 0;
  const text = translated.replace(EJS_MASK_RE, (m, n) => {
    const i = Number(n);
    if (i >= 0 && i < codes.length) { restored++; return codes[i]; }
    return m;
  });
  return { text, restored };
}
