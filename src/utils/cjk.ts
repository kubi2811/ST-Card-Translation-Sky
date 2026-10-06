/**
 * src/utils/cjk.ts — NGUỒN CHÂN LÝ cho việc đếm/lọc ký tự CJK (audit đợt 3).
 * ─────────────────────────────────────────────────────────────────────────
 * Trước đây `stripUrlsForCjkCheck` bị ĐÚP 3 NƠI (useTranslation, apiClient, bản lite ở langDetect)
 * và regex đếm CJK đúp 2 nơi (aiVerify, langDetect) — bản apiClient còn dính typo `(?:\.\.\?\/)`
 * khiến không strip được đường dẫn tương đối `./x`. Gom về đây: sửa 1 chỗ, mọi nơi hưởng.
 *
 * Hai "thước đo" CJK khác nhau CÓ CHỦ Ý (đừng gộp làm một):
 *  - HAN_RE_G:      chỉ ideograph Hán — dùng cho việc "còn tiếng TRUNG chưa dịch?" (card nguồn zh).
 *  - CJK_TEXT_RE_G: Hán + kana Nhật + hangul Hàn — dùng cho Verify "còn chữ NGUỒN chưa dịch?"
 *    (card nguồn có thể là Nhật/Hàn). KHÔNG bao gồm dải dấu câu 、。【】 (bug #2: đếm dấu câu
 *    làm báo oan "còn tiếng Trung").
 */

/** Chỉ chữ Hán (CJK Unified Ideographs + Extension A). */
export const HAN_RE_G = /[一-鿿㐀-䶿]/g;

/** Chữ VĂN BẢN CJK: Hán + hiragana + katakana + hangul (không dấu câu/fullwidth). */
export const CJK_TEXT_RE_G = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/g;

/**
 * Bỏ URL/đường dẫn/link khỏi text TRƯỚC khi đếm CJK — CJK trong URL là cố ý
 * (vd `import('https://cdn.com/骰子系统/stable.js')`) và KHÔNG được tính là "chưa dịch".
 * Strips: URL chuẩn, thuộc tính src/href..., CSS url(), import()/require(), data URI,
 * đường dẫn tương đối ./ ../, và phần URL của link markdown.
 */
export function stripUrlsForCjkCheck(text: string): string {
  let s = text || '';
  // 1. URL chuẩn: http(s)://, ftp://, //host
  s = s.replace(/(?:https?|ftp):\/\/[^\s'"<>(){}\\]+|\/\/[a-zA-Z0-9][^\s'"<>(){}\\]*/gi, '');
  // 2. Giá trị thuộc tính HTML src/href/action/data-src/poster/srcset
  s = s.replace(/(?:src|href|action|data-src|data-href|poster|srcset)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  // 3. CSS url()
  s = s.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)/gi, '');
  // 4. import()/require() (chuỗi thường và template literal)
  s = s.replace(/(?:import|require)\s*\(\s*(?:[`'"][^`'"]*[`'"]|`[^`]*`)\s*\)/gi, '');
  // 5. Data URI
  s = s.replace(/data:[a-zA-Z0-9+/.-]+;[^\s'"<>)]+/gi, '');
  // 6. Đường dẫn tương đối ./x hoặc ../x  (bản apiClient cũ dính typo `\.\.\?\/` — đã sửa)
  s = s.replace(/(?:\.\.?\/)[^\s'"<>(){}\\]+/g, '');
  // 7. Link markdown [...](url) — chỉ bỏ phần URL
  s = s.replace(/(!?\[[^\]]*\])\([^)]+\)/g, '$1()');
  // 8. (bug 255) Tên file trần có chữ Hán: `状态机.js`, `scripts/02_大乾风华录后台GM修改器.js`
  s = replaceCjkFileNames(s, () => '');
  return s;
}

/**
 * (bug 255) TÊN FILE có chữ Hán nằm trần trong văn bản/comment — `状态机.js`, `_src/状态栏面板.模板.js`,
 * `scripts/02_大乾风华录后台GM修改器.js`. Đó là tên một file KHÁC của tác giả: dịch ra là trỏ vào file
 * không tồn tại, và đếm nó là "còn chữ Hán chưa dịch" thì vòng dịch lại không bao giờ hết báo.
 * Biên của cụm: khoảng trắng, nháy, ngoặc, dấu nhấn markdown `**`, dấu câu tiếng Trung (`／`, `：`, `《》`…).
 */
const FILE_BOUNDARY_RE = /[\s'"`<>()[\]{},;|=*~：，。、；！？（）「」『』【】《》〈〉／]/;
const FILE_EXT_RE = /\.(?:js|mjs|cjs|ts|json|ya?ml|txt|md|html?|css|png|jpe?g|gif|webp|svg|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf)(?![A-Za-z0-9_])/gi;
const HAN_ONE_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
/** Tên file dài hơn mức này thì không phải tên file — chặn cả chi phí dò ngược trên chuỗi khổng lồ. */
const MAX_FILE_TOKEN = 160;

/**
 * Vị trí các tên file có chữ Hán trong `text`. Quét TUYẾN TÍNH: tìm đuôi file trước rồi lùi về
 * biên gần nhất (tối đa MAX_FILE_TOKEN ký tự) — regex kiểu `[^biên]*Hán[^biên]*\.js` dò ngược bậc
 * hai trên script minify / base64 dài hàng trăm nghìn ký tự không có dấu cách.
 */
export function cjkFileNameRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!text || !HAN_ONE_RE.test(text)) return out;
  const re = new RegExp(FILE_EXT_RE.source, 'gi');
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    let a = m.index;
    const floor = Math.max(lastEnd, m.index - MAX_FILE_TOKEN);
    while (a > floor && !FILE_BOUNDARY_RE.test(text[a - 1])) a--;
    if (a === floor && a > 0 && a !== lastEnd && !FILE_BOUNDARY_RE.test(text[a - 1])) continue; // quá dài
    const token = text.slice(a, end);
    if (HAN_ONE_RE.test(token.slice(0, token.length - m[0].length)) && isLikelyCjkFileName(token)) {
      out.push([a, end]);
      lastEnd = end;
    }
  }
  return out;
}

/** Thay mọi tên file có chữ Hán bằng `fn(tên)`. */
export function replaceCjkFileNames(text: string, fn: (name: string) => string): string {
  const ranges = cjkFileNameRanges(text);
  if (!ranges.length) return text;
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) { out += text.slice(last, a) + fn(text.slice(a, b)); last = b; }
  return out + text.slice(last);
}

export function isLikelyCjkFileName(token: string): boolean {
  const stem = token.replace(/\.[A-Za-z0-9]+$/, '');
  if (/[\/\\A-Za-z0-9_-]/.test(stem)) return true;
  return stem.replace(/\./g, '').length <= 6;
}

/**
 * Đuôi file tài nguyên (ảnh/âm thanh/video/font/mã/dữ liệu). Cho phép `?query`/`#hash` phía sau.
 * Dùng để nhận ra TÊN FILE trần như `变身状态agp4lq.png` — không có scheme, không có `/`, nhưng
 * vẫn là một tên phải giữ nguyên từng byte.
 */
const ASSET_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|woff2?|ttf|otf|css|js|mjs|json|ya?ml|txt|html?)(?:[?#][^\s]*)?$/i;

/** Ký tự kết thúc một "cụm" URL/tên file: khoảng trắng, nháy, ngoặc, phân cách thuộc tính/JS. */
const LINK_BOUNDARY_RE = /[\s'"`<>()[\]{},;|=]/;

/**
 * (bug 247) Đoạn `text.slice(start, end)` có nằm trong một URL / đường dẫn / tên file không?
 *
 * Nở ra hai phía tới ký tự biên gần nhất để lấy nguyên cụm chứa nó, rồi xét cụm đó:
 * có scheme (`https://`, `//host`, `data:`), là đường dẫn tương đối (`./`, `../`), hoặc kết thúc
 * bằng đuôi file tài nguyên. Thước đo này cố ý HẸP: văn bản thường có dấu `/` (`攻击/防御`) không
 * bị coi là link — nó phải còn được dịch/ép từ điển như cũ.
 */
export function isInsideLinkOrFile(text: string, start: number, end: number): boolean {
  if (!text || start < 0 || end > text.length || start >= end) return false;
  let a = start;
  while (a > 0 && !LINK_BOUNDARY_RE.test(text[a - 1])) a--;
  let b = end;
  while (b < text.length && !LINK_BOUNDARY_RE.test(text[b])) b++;
  const token = text.slice(a, b);
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(token)) return true; // https://… ftp://… //host
  if (/^data:/i.test(token)) return true;
  if (/^\.{1,2}\//.test(token)) return true;
  return ASSET_EXT_RE.test(token);
}

/** Đếm chữ Hán SAU khi bỏ URL — thước đo "còn tiếng Trung chưa dịch". */
export function countHanStripped(text: string): number {
  return (stripUrlsForCjkCheck(text).match(HAN_RE_G) || []).length;
}

/** Đếm chữ văn bản CJK (Hán+kana+hangul), KHÔNG strip URL — thước đo của Verify. */
export function countCjkText(text: string): number {
  return ((text || '').match(CJK_TEXT_RE_G) || []).length;
}
