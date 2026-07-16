/**
 * ─── Script Nặng (Chia Phần) — chia bundle JS/CSS/HTML khổng lồ thành phần an toàn ───
 *
 * (User 2026) Bundle Vue/webpack của card cao cấp có thể 3.000.000+ ký tự — dán nguyên khối vào
 * ô dịch làm AI đọc thiếu/cắt cụt và treo UI. Chia phần ở đây KHÔNG cắt theo số ký tự cứng:
 * scanner đọc từng ký tự, theo dõi trạng thái CHUỖI ('..' ".." `..` + \escape + ${} lồng trong
 * template), COMMENT (// và những khối chú thích), và ĐỘ SÂU ngoặc {}/[]/() — chỉ cho phép cắt tại
 * ranh giới SẠCH: sau xuống dòng (hoặc sau `;` `}` với bundle minify ít xuống dòng), ngoài chuỗi,
 * ngoài comment, và độ sâu ngoặc về mức nền của file. Nhờ đó không bao giờ đứt giữa chuỗi
 * sourcesContent, giữa hàm, giữa rule CSS.
 *
 * BẤT BIẾN SỐNG CÒN (test khoá): ghép các phần theo thứ tự == file gốc 100% từng ký tự.
 */

/** Ngưỡng mặc định để cảnh báo "script nặng" (ký tự). User chỉnh được trong UI. */
export const HEAVY_SCRIPT_DEFAULT_THRESHOLD = 100_000;

/** Cỡ đích mỗi phần (ký tự). Phần thực tế có thể lớn hơn nếu phải né 1 chuỗi khổng lồ. */
export const HEAVY_PART_TARGET = 80_000;

export interface HeavyPart {
  index: number;   // 1-based
  text: string;
  chars: number;
}

type ScanState = {
  quote: '"' | "'" | '`' | null;   // đang trong chuỗi loại nào
  templateBraces: number[];        // stack ${…} lồng trong template
  lineComment: boolean;
  blockComment: boolean;
  depth: number;                   // {} [] () cộng dồn
};

/**
 * Quét toàn file 1 lượt, trả về danh sách VỊ TRÍ CẮT AN TOÀN (cắt TRƯỚC index này):
 * - không nằm trong chuỗi/comment,
 * - độ sâu ngoặc == mức nền (baseDepth — thường 0, nhưng bundle bọc IIFE thì có thể là 1),
 * - đứng ngay sau '\n' (ưu tiên) hoặc sau ';' / '}' (fallback cho bundle minify).
 */
export function findSafeCutPoints(code: string): { newlineCuts: number[]; punctCuts: number[] } {
  const st: ScanState = { quote: null, templateBraces: [], lineComment: false, blockComment: false, depth: 0 };
  // Lượt 1 xác định baseDepth: độ sâu nhỏ nhất đạt được tại các vị trí sau-xuống-dòng sạch.
  const newlineCuts: number[] = [];
  const punctCuts: number[] = [];
  const n = code.length;
  let prevMeaningful = ''; // ký tự có nghĩa gần nhất (để đoán regex literal vs phép chia)

  for (let i = 0; i < n; i++) {
    const c = code[i];
    const next = i + 1 < n ? code[i + 1] : '';

    if (st.lineComment) {
      if (c === '\n') st.lineComment = false;
      continue;
    }
    if (st.blockComment) {
      if (c === '*' && next === '/') { st.blockComment = false; i++; }
      continue;
    }
    if (st.quote) {
      if (c === '\\') { i++; continue; }
      if (c === st.quote) { st.quote = null; continue; }
      if (st.quote === '`' && c === '$' && next === '{') {
        st.templateBraces.push(0);
        st.quote = null; // tạm rời chuỗi, vào biểu thức ${}
        i++;
      }
      continue;
    }

    switch (c) {
      case '"': case "'": case '`':
        st.quote = c as '"' | "'" | '`';
        prevMeaningful = c;
        continue;
      case '/':
        if (next === '/') { st.lineComment = true; i++; continue; }
        if (next === '*') { st.blockComment = true; i++; continue; }
        // regex literal: sau các ký tự này thì '/' mở regex — nhảy qua tới '/' đóng (né cắt trong regex)
        if (/[(,=:[!&|?{};\n+\-*%~^<>]/.test(prevMeaningful) || prevMeaningful === '') {
          let j = i + 1;
          let inClass = false;
          while (j < n) {
            const rc = code[j];
            if (rc === '\\') { j += 2; continue; }
            if (rc === '[') inClass = true;
            else if (rc === ']') inClass = false;
            else if (rc === '/' && !inClass) break;
            else if (rc === '\n') break; // không phải regex thật → thôi
            j++;
          }
          if (j < n && code[j] === '/') { i = j; prevMeaningful = '/'; continue; }
        }
        prevMeaningful = c;
        continue;
      case '{': case '[': case '(':
        st.depth++;
        prevMeaningful = c;
        continue;
      case '}':
        if (st.templateBraces.length > 0) {
          // đóng ${} → quay lại trong template string
          st.templateBraces.pop();
          st.quote = '`';
          continue;
        }
        st.depth = Math.max(0, st.depth - 1);
        prevMeaningful = c;
        // fallback cắt sau '}' ở độ sâu 0 (bundle minify không có \n)
        if (st.depth === 0) punctCuts.push(i + 1);
        continue;
      case ']': case ')':
        st.depth = Math.max(0, st.depth - 1);
        prevMeaningful = c;
        continue;
      case ';':
        prevMeaningful = c;
        if (st.depth === 0) punctCuts.push(i + 1);
        continue;
      case '\n':
        if (st.depth === 0) newlineCuts.push(i + 1);
        continue;
      default:
        if (!/\s/.test(c)) prevMeaningful = c;
    }
  }
  return { newlineCuts, punctCuts };
}

/**
 * Chia code thành các phần ~targetSize, CHỈ cắt tại điểm an toàn.
 * Không có điểm an toàn nào trong tầm (vd 1 chuỗi khổng lồ dài hơn target) → phần đó được phép
 * DÀI HƠN target (đúng > đẹp). Trường hợp xấu nhất không tìm được điểm nào → 1 phần duy nhất.
 */
export function splitHeavyScript(code: string, targetSize: number = HEAVY_PART_TARGET): HeavyPart[] {
  if (!code) return [];
  if (code.length <= targetSize) return [{ index: 1, text: code, chars: code.length }];

  const { newlineCuts, punctCuts } = findSafeCutPoints(code);
  // Ưu tiên newline; bundle minify (ít newline) → dùng punct. Trộn cả hai, sort.
  const cutSet = new Set<number>([...newlineCuts, ...punctCuts]);
  const cuts = [...cutSet].sort((a, b) => a - b);

  const texts: string[] = [];
  let start = 0;
  let ci = 0;
  while (start < code.length) {
    const limit = start + targetSize;
    if (limit >= code.length) { texts.push(code.slice(start)); break; }
    // tìm điểm cắt LỚN NHẤT ≤ limit và > start
    let chosen = -1;
    while (ci < cuts.length && cuts[ci] <= limit) {
      if (cuts[ci] > start) chosen = cuts[ci];
      ci++;
    }
    if (chosen === -1) {
      // không có điểm nào trong tầm → lấy điểm an toàn KẾ TIẾP (phần dài hơn target nhưng không đứt cấu trúc)
      while (ci < cuts.length && cuts[ci] <= start) ci++;
      chosen = ci < cuts.length ? cuts[ci++] : code.length;
    }
    texts.push(code.slice(start, chosen));
    start = chosen;
  }

  return texts.filter(t => t.length > 0).map((text, i) => ({ index: i + 1, text, chars: text.length }));
}

/** Ghép các phần (thứ tự index) — dùng cho bản dịch: phần nào chưa dịch dùng bản gốc phần đó. */
export function mergeHeavyParts(parts: HeavyPart[], translated: (string | null)[]): string {
  return parts.map((p, i) => (translated[i] ?? p.text)).join('');
}

/** Thống kê nhanh để báo "khớp 1:1": số dòng + tổng ký tự (dịch được phép lệch ký tự, dòng nên khớp). */
export function heavyStats(text: string): { lines: number; chars: number } {
  return { lines: (text.match(/\n/g) || []).length + 1, chars: text.length };
}
