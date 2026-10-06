/**
 * src/utils/vnFonts.ts — (bug 252) FONT HIỂN THỊ ĐƯỢC TIẾNG VIỆT CHO REGEX / HTML ĐÃ DỊCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Khi dịch regex, bắt buộc phải thay font phù hợp với tiếng Việt, tránh sử dụng font khiến
 * hiển thị tiếng Việt bị lồi lõm chữ đậm chữ nhạt, chữ to chữ nhỏ."
 *
 * Vì sao lồi lõm: font Trung/Nhật (Noto Serif SC, 霞鹜文楷, Ma Shan Zheng, 微软雅黑…) có chữ Latin cơ
 * bản nhưng thiếu phần lớn chữ có dấu tiếng Việt (ế, ộ, ữ…). Trình duyệt vẽ chữ có trong font, còn chữ
 * thiếu thì mượn từng chữ một từ font khác ⇒ trong cùng một từ, chữ này đậm chữ kia nhạt, to nhỏ
 * khác nhau.
 *
 * Bộ đổi font cũ (CHINESE_FONT_MAP trong mvuSync) có ba chỗ hổng:
 *   1. chỉ biết ~25 font hệ thống Windows — không biết các web font card hay dùng (Noto Serif SC,
 *      Source Han, LXGW WenKai, Ma Shan Zheng, ZCOOL…);
 *   2. thay bằng 'Segoe UI' / 'Georgia' — chỉ có trên Windows, máy Mac/điện thoại vẫn rơi về font khác;
 *   3. chèn tên font KÈM dấu nháy đơn ⇒ font nằm trong chuỗi JS nháy đơn là vỡ script.
 *
 * Cách làm ở đây:
 *   • duyệt từng khai báo `font-family:` (CSS, style="…", chuỗi JS) và `fontFamily = '…'`, đọc danh
 *     sách font có biết dấu nháy;
 *   • có font CJK ⇒ CHÈN một web font hỗ trợ đủ tiếng Việt, cùng phong cách, lên TRƯỚC font CJK đầu
 *     tiên (giữ font CJK phía sau làm dự phòng cho chữ Hán còn sót — giao diện gốc không bị phá);
 *   • tên font chèn vào viết KHÔNG dấu nháy (CSS cho phép tên nhiều từ không nháy) ⇒ không bao giờ
 *     đụng dấu nháy của chuỗi bao quanh;
 *   • văn bản là HTML ⇒ nạp các font đã dùng từ Google Fonts (subset vietnamese) bằng @import.
 */

export type FontStyleClass = 'serif' | 'sans' | 'hand';

/** Font thay thế — đều có trên Google Fonts với subset vietnamese. */
export const VN_FONT: Record<FontStyleClass, { family: string; gf: string }> = {
  serif: { family: 'Noto Serif', gf: 'Noto+Serif:ital,wght@0,400;0,700;1,400' },
  sans: { family: 'Be Vietnam Pro', gf: 'Be+Vietnam+Pro:ital,wght@0,400;0,600;0,700;1,400' },
  // Thư pháp / viết tay (楷, 行书, Ma Shan Zheng, ZCOOL…): giữ nét mềm mà vẫn dễ đọc.
  hand: { family: 'Lora', gf: 'Lora:ital,wght@0,400;0,700;1,400' },
};

const CJK_NAME = /[一-鿿぀-ヿ가-힯]/;

/** Font CJK nhận diện bằng tên Latin (không chứa chữ Hán). Thứ tự: hand trước, rồi serif, rồi sans. */
const LATIN_CJK_FONTS: Array<[RegExp, FontStyleClass]> = [
  [/\b(kai|kaiti|stkaiti|dfkai|wenkai|lxgw|ma shan zheng|zhi mang xing|long cang|liu jian mao cao|zcool|xingkai|stxingkai|stliti|lishu|huawen ?xingkai|klee|kyokasho)\b/i, 'hand'],
  [/\b(simsun|nsimsun|songti|stsong|stzhongsong|stfangsong|fangsong|mingliu|pmingliu|mincho|ms mincho|yu mincho|hiragino mincho|batang|noto serif (?:sc|tc|hk|jp|kr|cjk)|source han serif|shippori|zen old mincho)\b/i, 'serif'],
  [/\b(simhei|microsoft yahei|microsoft jhenghei|heiti|stheiti|stxihei|pingfang|hiragino sans|hiragino kaku|noto sans (?:sc|tc|hk|jp|kr|cjk)|source han sans|smiley sans|harmonyos sans sc|misans|alibaba puhuiti|ms gothic|yu gothic|meiryo|malgun gothic|nanum gothic|dengxian|youyuan|wenquanyi)\b/i, 'sans'],
];

/** Phân loại một tên font: CJK thì trả phong cách, không phải CJK thì null. */
export function classifyCjkFont(name: string): FontStyleClass | null {
  const n = name.trim().replace(/^['"]|['"]$/g, '');
  if (!n) return null;
  if (CJK_NAME.test(n)) {
    if (/[楷行草隶篆书體体]/.test(n) && /[楷行草隶篆]|书法|手写|手書/.test(n)) return 'hand';
    if (/(霞鹜|文楷|站酷|马善政|字魂|手写|毛笔|书法|行楷|草书|隶书|楷)/.test(n)) return 'hand';
    if (/(宋|明朝|明體|明体|仿宋|标宋|書宋|Song)/.test(n)) return 'serif';
    return 'sans';   // 黑体, 雅黑, 苹方, 圆体, 思源黑体, ゴシック…
  }
  for (const [re, cls] of LATIN_CJK_FONTS) if (re.test(n)) return cls;
  return null;
}

/** Tách danh sách font theo dấu phẩy, biết dấu nháy. */
function splitFamilies(list: string): string[] {
  const out: string[] = [];
  let cur = '', q: string | null = null;
  for (const c of list) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const familyName = (tok: string) => tok.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();

/**
 * Sửa MỘT danh sách font. Trả null khi không có gì cần đổi.
 * Giữ nguyên định dạng (khoảng trắng, nháy) của các mục cũ; mục chèn thêm không có nháy.
 */
export function fixFontList(list: string): { list: string; added: FontStyleClass } | null {
  const parts = splitFamilies(list);
  const idx = parts.findIndex(p => classifyCjkFont(p) !== null);
  if (idx < 0) return null;
  const cls = classifyCjkFont(parts[idx])!;
  const vn = VN_FONT[cls].family;
  // Đã có sẵn font Việt đứng TRƯỚC font CJK ⇒ không đụng (idempotent).
  const allVn = new Set(Object.values(VN_FONT).map(v => v.family.toLowerCase()));
  if (parts.slice(0, idx).some(p => allVn.has(familyName(p)))) return null;
  if (idx === 0) {
    // Chèn lên đầu: giữ khoảng trắng mở đầu cũ cho mục mới, mục cũ đứng sau dấu phẩy + 1 cách.
    const lead = parts[0].match(/^\s*/)?.[0] ?? '';
    parts[0] = ' ' + parts[0].trimStart();
    parts.unshift(lead + vn);
  } else {
    parts.splice(idx, 0, ' ' + vn);
  }
  return { list: parts.join(','), added: cls };
}

/**
 * Đọc giá trị font-family bắt đầu ở `start` tới hết khai báo. Dừng ở `;`, `}`, xuống dòng, hoặc một
 * dấu nháy KHÔNG có cặp trong phần còn lại của khai báo (đó là nháy đóng của chuỗi/thuộc tính bao
 * ngoài, vd style="font-family: X" hay 'font-family:"X"').
 */
export function readDeclValue(text: string, start: number): number {
  let i = start, q: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === q) q = null; i++; continue; }
    if (c === ';' || c === '}' || c === '\n' || c === '!' ) break;
    if (c === '"' || c === "'" || c === '`') {
      // Có nháy đóng tương ứng trước khi hết khai báo không?
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== ';' && text[j] !== '}' && text[j] !== '\n') j++;
      if (j < text.length && text[j] === c) { q = c; i++; continue; }
      break;
    }
    i++;
  }
  return i;
}

export interface VnFontResult {
  text: string;
  /** Số khai báo đã sửa. */
  fixes: number;
  /** Các phong cách font đã chèn (để nạp đúng font). */
  used: FontStyleClass[];
}

/** Sửa mọi khai báo font trong một đoạn HTML/CSS/JS đã dịch. */
export function applyVietnameseFonts(input: string): VnFontResult {
  if (!input || typeof input !== 'string' || !/font/i.test(input)) return { text: input, fixes: 0, used: [] };
  let text = input;
  let fixes = 0;
  const used = new Set<FontStyleClass>();

  // 1. CSS / style="" / chuỗi JS: `font-family: …`
  const out: string[] = [];
  let last = 0;
  const re = /font-family\s*:\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const vStart = m.index + m[0].length;
    const vEnd = readDeclValue(text, vStart);
    const fixed = fixFontList(text.slice(vStart, vEnd));
    if (fixed) {
      out.push(text.slice(last, vStart), fixed.list);
      last = vEnd;
      fixes++;
      used.add(fixed.added);
    }
    re.lastIndex = Math.max(vEnd, re.lastIndex);
  }
  out.push(text.slice(last));
  text = out.join('');

  // 2. JS: el.style.fontFamily = '…'  /  { fontFamily: "…" }
  text = text.replace(/(fontFamily\s*[:=]\s*)(['"`])((?:(?!\2)[^\n])*)\2/g, (whole, pre: string, q: string, list: string) => {
    const fixed = fixFontList(list);
    if (!fixed) return whole;
    fixes++;
    used.add(fixed.added);
    return `${pre}${q}${fixed.list}${q}`;
  });

  // 3. Nạp font (chỉ khi là HTML có thẻ) — @import phải đứng đầu stylesheet.
  if (used.size && /<[a-z][^>]*>/i.test(text)) {
    // Tìm trong URL nạp font (`family=Lora`), KHÔNG tìm tên trần — tên vừa chèn vào font-family ở trên.
    const need = [...used].filter(c => !text.includes(`family=${VN_FONT[c].gf.split(':')[0]}`));
    if (need.length) {
      const href = `https://fonts.googleapis.com/css2?${need.map(c => `family=${VN_FONT[c].gf}`).join('&')}&display=swap`;
      // url() KHÔNG nháy: thẻ <style> có thể nằm trong chuỗi JS — thêm nháy là vỡ chuỗi.
      const imp = `@import url(${href});`;
      if (/<style[^>]*>/i.test(text)) text = text.replace(/<style([^>]*)>/i, `<style$1>${imp}`);
      else text = `<style>${imp}</style>${text}`;
    }
  }

  return { text, fixes, used: [...used] };
}

/** Mọi danh sách font trong văn bản, theo thứ tự xuất hiện (CSS `font-family:` + JS `fontFamily`). */
function fontLists(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /font-family\s*:\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const vStart = m.index + m[0].length;
    out.push({ start: vStart, end: readDeclValue(text, vStart) });
  }
  const js = /fontFamily\s*[:=]\s*(['"`])((?:(?!\1)[^\n])*)\1/g;
  while ((m = js.exec(text)) !== null) {
    const vStart = m.index + m[0].indexOf(m[1]) + 1;
    out.push({ start: vStart, end: vStart + m[2].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * (bug 257) TÊN FONT KHÔNG ĐƯỢC DỊCH. Thẻ thật: `font-family: 'SimHei', '黑体', sans-serif` thành
 * `'SimHei', 'Hắc Thể', sans-serif` — "Hắc Thể" không phải font nào cả. Lớp che CSS chỉ chạy ở chế
 * độ "giữ CJK trong CSS", còn mặc định là "dịch"; đường surgical cũng lọt. Nên chốt ở hậu xử lý:
 * ghép từng danh sách font của bản dịch với bản GỐC theo thứ tự, tên font gốc có chữ CJK thì trả
 * lại nguyên văn đúng vị trí. Font Việt do tool chèn (Noto Serif, Be Vietnam Pro, Lora) được bỏ
 * qua khi ghép, nên chạy lại bao nhiêu lần cũng không lệch.
 */
export function restoreCjkFontNames(original: string, translated: string): string {
  if (!original || !translated || !CJK_NAME.test(original) || !/font/i.test(original)) return translated;
  const o = fontLists(original);
  const t = fontLists(translated);
  if (!o.length || o.length !== t.length) return translated;
  const vnNames = new Set(Object.values(VN_FONT).map(v => v.family.toLowerCase()));
  let out = translated;
  for (let i = t.length - 1; i >= 0; i--) {
    const oParts = splitFamilies(original.slice(o[i].start, o[i].end));
    if (!oParts.some(p => CJK_NAME.test(p))) continue;
    const tParts = splitFamilies(out.slice(t[i].start, t[i].end));
    const realIdx = tParts.map((p, j) => (vnNames.has(familyName(p)) && !oParts.some(q => familyName(q) === familyName(p)) ? -1 : j)).filter(j => j >= 0);
    if (realIdx.length !== oParts.length) continue;
    let changed = false;
    realIdx.forEach((j, k) => {
      if (CJK_NAME.test(oParts[k]) && tParts[j].trim() !== oParts[k].trim()) {
        const lead = tParts[j].match(/^\s*/)?.[0] ?? '';
        tParts[j] = lead + oParts[k].trim();
        changed = true;
      }
    });
    if (changed) out = out.slice(0, t[i].start) + tParts.join(',') + out.slice(t[i].end);
  }
  return out;
}
