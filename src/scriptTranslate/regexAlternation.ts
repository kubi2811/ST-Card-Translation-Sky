// ─── Regex alternation cho "Dịch Script" (pure — test được không cần AI/DOM) ───
// Script TavernHelper hay có regex khớp NHÃN DO AI SINH RA, vd /秋青子\s*[:：]?\s*/g để
// nhận diện tên nhân vật trong output. Sau khi dịch script sang tiếng Việt, model sẽ sinh
// "Thu Thanh Tử" — nhưng chat cũ vẫn còn "秋青子". Vì vậy KHÔNG thay chữ Hán trong regex,
// mà THÊM nhánh: 秋青子 → (?:秋青子|Thu Thanh Tử). Đây đúng là cách bản dịch tay mẫu làm
// (bugNeedFix/NewFeature_Script_and_Preset). Mọi regex sửa xong PHẢI compile lại được,
// không thì hoàn nguyên nguyên văn — thà giữ Hán còn hơn làm vỡ script.
import * as acorn from 'acorn';

export interface CjkRegexLiteral {
  /** Offset của cả literal /body/flags trong code */
  start: number;
  end: number;
  body: string;
  flags: string;
}

/** Khoảng CJK liên tục (Hán + kana + Hangul) — đơn vị để tra từ điển & thêm nhánh. */
const CJK_RUN = /[一-鿿㐀-䶿぀-ヿ가-힯]+/g;

/**
 * Tìm mọi regex LITERAL chứa CJK bằng tokenizer acorn (phân biệt được `/` chia và `/` regex).
 * Parse lỗi → trả [] (bỏ qua pass này thay vì đoán mò bằng regex-trên-regex).
 */
export function findCjkRegexLiterals(code: string): CjkRegexLiteral[] {
  const out: CjkRegexLiteral[] = [];
  try {
    const t = acorn.tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' });
    for (;;) {
      const tok = t.getToken();
      if (tok.type.label === 'eof') break;
      if (tok.type.label === 'regexp') {
        const v = (tok as unknown as { value?: { pattern: string; flags: string } }).value;
        if (v && CJK_RUN.test(v.pattern)) {
          CJK_RUN.lastIndex = 0;
          out.push({ start: tok.start, end: tok.end, body: v.pattern, flags: v.flags });
        }
        CJK_RUN.lastIndex = 0;
      }
    }
  } catch {
    return [];
  }
  return out;
}

/** Escape chuỗi thường để nhét an toàn vào thân regex. */
export function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Các đoạn [start,end) nằm TRONG character class [...] của thân regex — trong đó `(?:a|b)`
 * là ký tự thường chứ không phải nhóm ⇒ TUYỆT ĐỐI không thêm nhánh vào đấy.
 */
function charClassRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inClass = false;
  let classStart = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }
    if (!inClass && c === '[') { inClass = true; classStart = i; }
    else if (inClass && c === ']') { inClass = false; ranges.push([classStart, i + 1]); }
  }
  if (inClass) ranges.push([classStart, body.length]);
  return ranges;
}

export interface AlternateBodyResult {
  body: string;
  changed: boolean;
  /** Cụm CJK không có trong từ điển — pipeline sẽ dịch bổ sung rồi áp lại */
  unknown: string[];
  /** Cụm nằm trong [...] — không đụng (thêm nhánh trong class là sai ngữ nghĩa) */
  skippedInClass: string[];
}

/**
 * Thêm nhánh tiếng Việt cho từng cụm CJK trong thân regex (idempotent: cụm đã ở dạng
 * `(?:cụm|...)` thì thôi). dict: CJK → bản dịch (từ glossary Pha 0).
 */
export function alternateRegexBody(body: string, dict: Record<string, string>): AlternateBodyResult {
  const classes = charClassRanges(body);
  const inClass = (pos: number) => classes.some(([s, e]) => pos >= s && pos < e);
  const unknown = new Set<string>();
  const skippedInClass = new Set<string>();
  let changed = false;

  type Hit = { start: number; end: number; run: string };
  const hits: Hit[] = [];
  CJK_RUN.lastIndex = 0;
  for (let m = CJK_RUN.exec(body); m; m = CJK_RUN.exec(body)) {
    hits.push({ start: m.index, end: m.index + m[0].length, run: m[0] });
  }

  // Key từ điển sắp DÀI trước — run CJK là cụm LIỀN (vd 明月来了 = tên 明月 + 来了),
  // phải khớp key con dài nhất bên trong run chứ không chỉ tra nguyên run.
  const keys = Object.keys(dict)
    .filter((k) => k.trim() && dict[k]?.trim() && dict[k].trim() !== k)
    .sort((a, b) => b.length - a.length);

  /** Dựng bản thay thế cho 1 run: phủ các key không chồng lấn, phần CJK còn thừa → unknown. */
  const rewriteRun = (run: string): string | null => {
    type Seg = { s: number; e: number; key: string };
    const segs: Seg[] = [];
    for (const k of keys) {
      for (let at = run.indexOf(k); at !== -1; at = run.indexOf(k, at + 1)) {
        if (segs.some((x) => at < x.e && at + k.length > x.s)) continue; // chồng lấn → key dài hơn đã chiếm
        segs.push({ s: at, e: at + k.length, key: k });
      }
    }
    if (!segs.length) { unknown.add(run); return null; }
    segs.sort((a, b) => a.s - b.s);
    let res = '';
    let cur = 0;
    for (const seg of segs) {
      const gap = run.slice(cur, seg.s);
      if (gap) { res += gap; unknown.add(gap); } // phần chưa phủ giữ nguyên + báo để AI bổ sung dict
      res += `(?:${seg.key}|${escapeForRegex(dict[seg.key].trim())})`;
      cur = seg.e;
    }
    const tail = run.slice(cur);
    if (tail) { res += tail; unknown.add(tail); }
    return res;
  };

  let out = body;
  for (let i = hits.length - 1; i >= 0; i--) {
    const { start, end, run } = hits[i];
    if (inClass(start)) { skippedInClass.add(run); continue; }

    // IDEMPOTENT đúng nghĩa: chỉ bỏ qua khi BẢN DỊCH của chính run này đã nằm sát bên
    // (tức đã được thêm nhánh ở lần chạy trước). Trước đây chỉ cần thấy ký tự `|` là bỏ qua
    // ⇒ regex kiểu /秋青子|明月/ (khớp nhiều tên — rất phổ biến) KHÔNG bao giờ được thêm
    // nhánh tiếng Việt, tính năng im lặng không chạy. (Bug do review chéo phát hiện.)
    const vi = dict[run]?.trim();
    if (vi) {
      const win = out.slice(Math.max(0, start - vi.length - 8), Math.min(out.length, end + vi.length + 8));
      if (win.includes(vi)) continue;
    }

    const rewritten = rewriteRun(run);
    if (rewritten === null || rewritten === run) continue;
    out = out.slice(0, start) + rewritten + out.slice(end);
    changed = true;
  }
  return { body: out, changed, unknown: [...unknown], skippedInClass: [...skippedInClass] };
}

export interface ApplyAlternationResult {
  code: string;
  /** Số literal đã sửa thành công (compile OK) */
  changed: number;
  /** Số literal sửa xong KHÔNG compile được → đã hoàn nguyên */
  reverted: number;
  /** Cụm CJK chưa có trong từ điển (gom từ mọi literal) */
  unknownTerms: string[];
  /**
   * (bug 200 — Mục 1.3) Cụm CJK nằm TRONG character class `[...]` — CHỦ ĐỘNG không đụng
   * (chèn `(?:a|b)` vào trong class là thành ký tự literal, phá ngữ nghĩa regex; quyết định
   * đó ĐÚNG). Nhưng bản cũ tính ra `skippedInClass` cho từng literal rồi... vứt: hàm này chỉ
   * gom `unknown`, dữ liệu không bao giờ tới pipeline hay báo cáo. Hệ quả trên fixture Status
   * Bar: `[家丁亲兵内丁]` `[骑马骡驼]`… — cả bộ phân loại quân chủng soi những trường ĐÃ dịch
   * — bị bỏ sót 100% mà không một dòng cảnh báo. Người dùng không thể quyết định thứ họ
   * không nhìn thấy.
   */
  skippedInClassTerms: string[];
}

/** Áp alternation lên toàn bộ regex literal chứa CJK trong code. Ghép phải-sang-trái để offset không lệch. */
export function applyRegexAlternation(code: string, dict: Record<string, string>): ApplyAlternationResult {
  const literals = findCjkRegexLiterals(code);
  let out = code;
  let changed = 0;
  let reverted = 0;
  const unknown = new Set<string>();
  const skippedInClass = new Set<string>();

  for (let i = literals.length - 1; i >= 0; i--) {
    const lit = literals[i];
    const r = alternateRegexBody(lit.body, dict);
    r.unknown.forEach((u) => unknown.add(u));
    r.skippedInClass.forEach((u) => skippedInClass.add(u));
    if (!r.changed) continue;
    try {
      // Compile thử đúng như engine sẽ chạy — vỡ là hoàn nguyên, không "để rồi tính".
      void new RegExp(r.body, lit.flags);
    } catch {
      reverted++;
      continue;
    }
    out = out.slice(0, lit.start) + `/${r.body}/${lit.flags}` + out.slice(lit.end);
    changed++;
  }
  return { code: out, changed, reverted, unknownTerms: [...unknown], skippedInClassTerms: [...skippedInClass] };
}

/** (bug 200 — Mục 1.4) Một cụm CJK bị bỏ qua trong character class, kèm kết quả truy nguồn. */
export interface SkippedInClassAnalysis {
  term: string;
  /**
   * Các mục Từ Điển (nguồn) TRÙNG vào cụm này. Trùng là dấu hiệu MẠNH rằng trường dữ liệu mà
   * regex này soi đã bị dịch ở nơi khác trong cùng file — như hàm phân loại quân chủng của
   * fixture Status Bar: 3 trường input đã thành khoá tiếng Việt, mà 5 character class vẫn thử
   * khớp ký tự Hán đơn lẻ ⇒ mọi nhánh .test() vĩnh viễn false, cả tính năng chết lặng lẽ.
   */
  dictMatches: string[];
  /** true = rủi ro cao, cần người review — KHÔNG tự viết lại (hiểu sai một ký tự là phân loại hỏng theo hướng khác). */
  risky: boolean;
}

/**
 * Truy nguồn từng cụm bị bỏ qua: cụm (hoặc ký tự đơn trong đó) có trùng khoá Từ Điển không.
 * Ca B của đề bài (bảng số `[一二三四五六七八九十]` parse ngày tháng dạng số Hán) thường KHÔNG
 * trùng từ điển khoá → risky=false, giữ nguyên là đúng. Không có quy tắc "luôn giữ"/"luôn dịch"
 * chung cho cả hai — nên đây chỉ PHÂN TÍCH và BÁO, quyết định là của con người.
 */
export function analyzeSkippedInClass(
  terms: string[],
  dict: Record<string, string>,
): SkippedInClassAnalysis[] {
  const sources = Object.keys(dict).filter((k) => k.trim() && dict[k]?.trim());
  return terms.map((term) => {
    const dictMatches = sources.filter((s) => term.includes(s) || (s.length > 1 && [...term].some((ch) => s.includes(ch))));
    return { term, dictMatches: dictMatches.slice(0, 8), risky: dictMatches.length > 0 };
  });
}
