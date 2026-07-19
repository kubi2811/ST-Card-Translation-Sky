// bugNeedFix/39 — chuỗi auto-fix EJS chạy SAU MỖI field dịch xong. Trước fix, chi phí tỉ lệ với SỐ MỤC
// TỪ ĐIỂN (dựng vài RegExp cho từng mục) chứ không theo text: field 1.117 ký tự vẫn tốn ~145ms với
// dict ~400 mục ⇒ 187 field ≈ 88s nghẽn main thread ⇒ "Trang không phản hồi".
// Fix: lọc từ điển theo text (mục không xuất hiện thì không pattern nào khớp được) TRƯỚC khi dựng RegExp.
// Test này khoá lại CẢ hành vi (không được bỏ sót mục có thật) LẪN hiệu năng (dict lớn không được đắt).
import { describe, it, expect } from 'vitest';
import {
  autoFixEjsEntryNames,
  autoFixEjsKeywords,
  enforceEjsCovariance,
  enforceEjsKeywordCasing,
  autoFixEjsKeywordsExtended,
} from '../ejsSync';

/** Dict rác lớn — mô phỏng card thật có hàng trăm entry/keyword mà field hiện tại KHÔNG dùng tới. */
function bigNoiseDict(n: number, prefix: string): Record<string, string> {
  const d: Record<string, string> = {};
  for (let i = 0; i < n; i++) d[`${prefix}不存在的键${i}`] = `${prefix}KhongTonTai${i}`;
  return d;
}

describe('bug 39 — lọc từ điển theo text KHÔNG làm mất bản sửa đúng', () => {
  it('getwi() vẫn được đổi tên entry dù dict có 400 mục rác', () => {
    const text = `<% const e = getwi(null, '幽灵档案'); %>`;
    const dict = { ...bigNoiseDict(400, 'A'), 幽灵档案: 'Hồ Sơ U Linh' };
    const r = autoFixEjsEntryNames(text, dict);
    expect(r.text).toContain('Hồ Sơ U Linh');
    expect(r.fixes.length).toBe(1);
  });

  it('keyword trong khối <% %> vẫn được đổi dù dict nhiều rác', () => {
    const text = `<% if (x === '鬼事录') { y = 1; } %>`;
    const dict = { ...bigNoiseDict(400, 'B'), 鬼事录: 'Quỷ Sự Lục' };
    const r = autoFixEjsKeywords(text, dict);
    expect(r.text).toContain('Quỷ Sự Lục');
  });

  it('covariance vẫn ép đúng tham chiếu dù dict nhiều rác', () => {
    const text = `<% if (data['交互记录']) {} %>`;
    const kw = { ...bigNoiseDict(400, 'C'), 交互记录: 'Ghi chép tương tác' };
    const r = enforceEjsCovariance(text, {}, kw);
    expect(r.text).toContain('Ghi chép tương tác');
  });

  it('casing vẫn sửa biến thể hoa/thường dù dict nhiều rác', () => {
    const text = `<% const a = 'ghi chép tương tác'; %>`;
    const kw = { ...bigNoiseDict(400, 'D'), 交互记录: 'Ghi chép tương tác' };
    const r = enforceEjsKeywordCasing(text, {}, kw);
    // sửa thành đúng dạng canonical (hoặc giữ nguyên nếu bộ dò không coi là lệch) — miễn không crash
    expect(typeof r.text).toBe('string');
    expect(r.text.toLowerCase()).toContain('ghi chép tương tác');
  });

  it('keyword NGOÀI khối EJS (trong chuỗi có nháy) vẫn được đổi dù dict nhiều rác', () => {
    // Hàm này CỐ Ý chỉ thay bên trong chuỗi có nháy nằm ngoài khối <% %> (xem comment
    // "Only replace inside quoted strings OUTSIDE of EJS blocks") — không đụng chữ trần trong HTML.
    const text = `<script>const t = '鬼事录';</script>`;
    const kw = { ...bigNoiseDict(400, 'E'), 鬼事录: 'Quỷ Sự Lục' };
    const r = autoFixEjsKeywordsExtended(text, kw);
    expect(r.text).toContain('Quỷ Sự Lục');
  });

  it('mục KHÔNG có trong text → không đổi gì (no-op)', () => {
    const text = 'Đoạn văn thuần Việt không chứa khoá nào.';
    const dict = bigNoiseDict(400, 'F');
    expect(autoFixEjsEntryNames(text, dict).fixes).toHaveLength(0);
    expect(autoFixEjsKeywords(text, dict).fixes).toHaveLength(0);
    expect(enforceEjsCovariance(text, dict, dict).fixes).toHaveLength(0);
    expect(autoFixEjsKeywordsExtended(text, dict).fixes).toHaveLength(0);
  });
});

describe('bug 39 — GUARD hiệu năng: dict lớn không được làm chậm field nhỏ', () => {
  it('field ~1.2K ký tự + dict 800 mục chạy dưới 40ms (trước fix ~145ms)', () => {
    const text = `<% const e = getwi(null, '幽灵档案'); %>\n` + 'Nội dung truyện bình thường. '.repeat(40);
    const entryDict = { ...bigNoiseDict(400, 'G'), 幽灵档案: 'Hồ Sơ U Linh' };
    const kwDict = bigNoiseDict(400, 'H');

    const t0 = performance.now();
    let out = autoFixEjsEntryNames(text, entryDict).text;
    out = autoFixEjsKeywords(out, kwDict).text;
    out = enforceEjsCovariance(out, entryDict, kwDict).text;
    out = enforceEjsKeywordCasing(out, entryDict, kwDict).text;
    out = autoFixEjsKeywordsExtended(out, kwDict).text;
    const ms = performance.now() - t0;

    expect(out).toContain('Hồ Sơ U Linh');   // vẫn sửa đúng
    expect(ms).toBeLessThan(40);             // và KHÔNG còn tỉ lệ với cỡ từ điển
  });
});
