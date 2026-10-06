/**
 * src/utils/htmlLocalize.ts — (bug 257) CHỖ HTML/CSS MÀ DỊCH CHỮ LÀ GÃY GIAO DIỆN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thẻ thật (thanh trạng thái "Thần Hào", bạn của user soát lại bằng tay):
 *
 * 1. CLASS CSS CÓ CHỮ HÁN. CSS viết `.q-精英 { color: … }`, code dựng class động `'q-' + q` với `q`
 *    là giá trị phẩm chất (cũng là chữ Hán). Dịch xong: CSS `.q-Tinh Anh` (= `.q-Tinh` rồi thẻ con
 *    `<Anh>` — selector con cháu!), còn phần tử nhận `class="q-Tinh Anh"` (= HAI class `q-Tinh` và
 *    `Anh`). Không bên nào khớp ⇒ mất hết màu phẩm chất.
 *    Không đổi được code dựng class (giá trị động), nên chữa phía CSS: selector thành
 *    `:is(.q-Tinh-Anh, .q-Tinh.Anh)` — vế sau khớp đúng phần tử mang cả hai class mà dấu cách đã
 *    tách ra, vế trước cho ai muốn viết class có gạch nối. Thẻ chạy đúng mà không phải sửa JS.
 *    Nhận ra selector nào là class-chữ-Hán bằng BẢN GỐC (không đoán trên bản dịch: `.card span`
 *    cũng là "chữ, dấu cách, chữ").
 *
 * 2. `<html lang="zh-CN">` — trình duyệt chọn font/cách ngắt dòng theo tiếng Trung cho chữ Việt.
 */

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';
const CJK_RE = new RegExp(`[${CJK}]`);
/** Một class trong selector có chứa chữ CJK: `.q-精英`, `.tag-女`. */
const CJK_CLASS_IN_SELECTOR = new RegExp(`\\.([A-Za-z_-]*[${CJK}][A-Za-z0-9_${CJK}-]*)`, 'g');

/** Các selector (phần trước `{`) trong một khối CSS, theo thứ tự. */
function selectorsOf(css: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let segStart = 0;
  let inComment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (inComment) { if (c === '*' && css[i + 1] === '/') { inComment = false; i++; segStart = i + 1; } continue; }
    if (c === '/' && css[i + 1] === '*') { inComment = true; i++; continue; }
    if (c === '{') {
      out.push({ start: segStart, end: i });
      depth++;
      segStart = i + 1;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      segStart = i + 1;
    } else if (c === ';' && depth > 0) {
      segStart = i + 1;
    }
  }
  return out;
}

function styleBlocks(html: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index + m[0].indexOf('>') + 1;
    out.push({ start, end: start + m[1].length });
  }
  return out;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sửa MỘT selector đã dịch theo selector gốc tương ứng. Trả null khi không khớp được khuôn. */
function fixSelector(origSel: string, transSel: string): string | null {
  const classes: string[] = [];
  const tpl = origSel.replace(CJK_CLASS_IN_SELECTOR, (_m, cls: string) => {
    classes.push(cls);
    return '\u0000';
  });
  if (!classes.length) return null;
  // Khuôn: phần ngoài class-chữ-Hán giữ nguyên; tiền tố ASCII của class (`q-`) cũng phải còn.
  const parts = tpl.split('\u0000');
  let reSrc = '^' + escRe(parts[0].replace(/^\s+/, '')).replace(/\s+/g, '\\s+');
  classes.forEach((cls, i) => {
    const prefix = (cls.match(/^[A-Za-z_-]*/) || [''])[0];
    reSrc += '\\.' + escRe(prefix) + '([^{},]+?)';
    reSrc += escRe(parts[i + 1].replace(/\s+/g, ' ')).replace(/\\? /g, '\\s*');
  });
  reSrc += '$';
  let m: RegExpMatchArray | null;
  try { m = transSel.trim().match(new RegExp(reSrc)); } catch { return null; }
  if (!m) return null;
  let i = 0;
  const rebuilt = tpl.replace(/\u0000/g, () => {
    const prefix = (classes[i].match(/^[A-Za-z_-]*/) || [''])[0];
    const word = m![++i].trim();
    if (!/\s/.test(word)) return `.${prefix}${word}`;
    const w = word.split(/\s+/);
    return `:is(.${prefix}${w.join('-')}, .${prefix}${w.join('.')})`;
  });
  const lead = transSel.match(/^\s*/)?.[0] ?? '';
  const tail = transSel.match(/\s*$/)?.[0] ?? '';
  return lead + rebuilt.trim() + tail;
}

/** (bug 257) Selector class chữ Hán đã bị dịch thành nhiều từ ⇒ `:is(.a-B-C, .a-B.C)`. */
export function fixCjkClassSelectors(original: string, translated: string): { text: string; fixed: number } {
  if (!original || !translated || !CJK_RE.test(original) || !/<style/i.test(original)) return { text: translated, fixed: 0 };
  const ob = styleBlocks(original);
  const tb = styleBlocks(translated);
  if (!ob.length || ob.length !== tb.length) return { text: translated, fixed: 0 };
  let out = translated;
  let fixed = 0;
  for (let b = tb.length - 1; b >= 0; b--) {
    const oCss = original.slice(ob[b].start, ob[b].end);
    const tCss = out.slice(tb[b].start, tb[b].end);
    const os = selectorsOf(oCss);
    const ts = selectorsOf(tCss);
    if (os.length !== ts.length) continue;
    let css = tCss;
    for (let i = ts.length - 1; i >= 0; i--) {
      const oSel = oCss.slice(os[i].start, os[i].end);
      if (!CJK_RE.test(oSel) || !oSel.includes('.')) continue;
      // Selector có thể là danh sách `a, b` — sửa từng vế.
      const oList = oSel.split(',');
      const tSel = css.slice(ts[i].start, ts[i].end);
      const tList = tSel.split(',');
      if (oList.length !== tList.length) continue;
      let changed = false;
      const next = tList.map((t, k) => {
        if (!CJK_CLASS_IN_SELECTOR.test(oList[k])) { CJK_CLASS_IN_SELECTOR.lastIndex = 0; return t; }
        CJK_CLASS_IN_SELECTOR.lastIndex = 0;
        const f = fixSelector(oList[k], t);
        if (f !== null && f !== t) { changed = true; return f; }
        return t;
      });
      if (changed) {
        css = css.slice(0, ts[i].start) + next.join(',') + css.slice(ts[i].end);
        fixed++;
      }
    }
    if (css !== tCss) out = out.slice(0, tb[b].start) + css + out.slice(tb[b].end);
  }
  return { text: out, fixed };
}

/** (bug 257) `<html lang="zh-…">` / `lang="ja"`… ⇒ `lang="vi"`. */
export function setHtmlLangVi(html: string): string {
  if (!html || !/<html/i.test(html)) return html;
  return html.replace(/(<html\b[^>]*?\blang\s*=\s*)(["'])(?:zh|ja|ko)(?:-[A-Za-z]+)*\2/gi, '$1$2vi$2');
}
