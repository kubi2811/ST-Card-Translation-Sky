/**
 * (bug 257) Thẻ "Thần Hào" — thanh trạng thái 4.700 dòng dịch xong mất màu phẩm chất, font hỏng,
 * regex ngày/đơn vị/"无" chết. Đoạn trích dưới đây lấy nguyên văn từ thẻ gốc và bản dịch lỗi.
 */
import { describe, it, expect } from 'vitest';
import { postProcessRegexHtml } from '../mvuSync';
import { restoreCjkFontNames } from '../vnFonts';
import { fixCjkClassSelectors, setHtmlLangVi } from '../htmlLocalize';
import { lookupCodeChars, cjkCharClassesToAlternation } from '../codeChars';
import { extractCJKTokens } from '../surgical';
import { maskCssCjkValues, unmaskCssCjkValues } from '../apiClient';

const RAW = `<html lang="zh-CN"><head><style>
    body { font-family: 'SimHei', '黑体', sans-serif; }
    .q-普通 { color: var(--q-normal); }
    .q-精英, .q-优良 { color: var(--q-elite); }
    .card .q-传说:hover { text-shadow: 0 0 5px rgba(255,153,0,0.5); }
    .card span { color: red; }
</style></head><body><span class="q-传说">x</span></body></html>`;

const BUG = `<html lang="zh-CN"><head><style>
    body { font-family: Be Vietnam Pro, 'SimHei', 'Hắc Thể', sans-serif; }
    .q-Thường { color: var(--q-normal); }
    .q-Tinh Anh, .q-Ưu Lương { color: var(--q-elite); }
    .card .q-Truyền Thuyết:hover { text-shadow: 0 0 5px rgba(255,153,0,0.5); }
    .card span { color: red; }
</style></head><body><span class="q-Truyền Thuyết">x</span></body></html>`;

describe('bug 257 — bước 1: font, class CSS, lang', () => {
  it('tên font CJK được trả lại, font Việt chèn thêm vẫn giữ', () => {
    const out = restoreCjkFontNames(RAW, BUG);
    expect(out).toContain("font-family: Be Vietnam Pro, 'SimHei', '黑体', sans-serif");
    expect(out).not.toContain('Hắc Thể');
  });

  it('selector class chữ Hán ⇒ :is(gạch nối, hai class) — selector thường không đụng', () => {
    const { text, fixed } = fixCjkClassSelectors(RAW, BUG);
    expect(fixed).toBe(2);
    expect(text).toContain(':is(.q-Tinh-Anh, .q-Tinh.Anh), :is(.q-Ưu-Lương, .q-Ưu.Lương) {');
    expect(text).toContain('.card :is(.q-Truyền-Thuyết, .q-Truyền.Thuyết):hover {');
    expect(text).toContain('.q-Thường {');
    expect(text).toContain('.card span {');
  });

  it('lang zh-CN ⇒ vi; postProcessRegexHtml làm đủ cả ba khi có bản gốc', () => {
    expect(setHtmlLangVi('<html lang="zh-CN">')).toBe('<html lang="vi">');
    const out = postProcessRegexHtml(BUG, RAW);
    expect(out).toContain('<html lang="vi">');
    expect(out).toContain("'黑体'");
    expect(out).toContain(':is(.q-Tinh-Anh, .q-Tinh.Anh)');
  });

  it('lớp che CSS giữ tên font ở CẢ chế độ "dịch CSS" (trước đây bị xoá trắng)', () => {
    const css = `body { font-family: 'SimHei', '黑体', sans-serif; } .a::after { content: "商品"; }`;
    const m = maskCssCjkValues(css, 'translate');
    expect(m.maskedText).not.toContain('黑体');
    expect(m.maskedText).toContain('商品');
    expect(unmaskCssCjkValues(m.maskedText, m.map, 'translate')).toBe(css);
  });
});

describe('bug 257 — bước 2: chữ Hán đơn trong code theo bảng cố định', () => {
  const at = (code: string, ch: string, from = 0) => {
    const i = code.indexOf(ch, from);
    return lookupCodeChars(ch, code, i, i + ch.length);
  };
  it('các chữ hay gặp', () => {
    const c = `if (s === '无') return '你'; x + '次' + '人'; unit === '万' ? 1e4 : unit === '千' ? 1e3 : unit === '亿'; '岁'`;
    expect(at(c, '无')).toBe('Không');
    expect(at(c, '你')).toBe('Bạn');
    expect(at(c, '次')).toBe('lần');
    expect(at(c, '人')).toBe('người');
    expect(at(c, '万')).toBe('vạn');
    expect(at(c, '千')).toBe('nghìn');
    expect(at(c, '亿')).toBe('trăm triệu');
    expect(at(c, '岁')).toBe('tuổi');
    expect(lookupCodeChars('日 周', '', 0, 0)).toBe('Ngày Thứ');
    expect(lookupCodeChars('分', '', 0, 0)).toBeNull();   // nhiều nghĩa — để AI
    expect(lookupCodeChars('无经验', '', 0, 0)).toBeNull();
  });
  it('thứ trong tuần chỉ khi nằm trong danh sách thứ', () => {
    const w = `const w = ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()];`;
    expect(at(w, '日')).toBe('Chủ Nhật');
    expect(at(w, '一')).toBe('Hai');
    expect(at(w, '六')).toBe('Bảy');
    const d = `s.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日/)`;
    expect(at(d, '日')).toBe('Ngày');
    expect(at(d, '年')).toBe('Năm');
  });
  it('[日号] trong regex ⇒ (?:日|号); chuỗi thường không đụng', () => {
    const src = `let m = s.match(/(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*[日号]/);\nconst label = '[日号]';`;
    const r = cjkCharClassesToAlternation(src);
    expect(r.count).toBe(1);
    expect(r.text).toContain('\\s*(?:日|号)/);');
    expect(r.text).toContain("const label = '[日号]';");
    // tách token: hai chữ riêng ⇒ cùng tra được bảng
    const toks = extractCJKTokens(r.text).map(t => t.text);
    expect(toks).toEqual(expect.arrayContaining(['月', '日', '号']));
  });
});
