// (bug 154) KHOÁ OBJECT có TIỀN TỐ ASCII — `{_开场标识: …}`.
//
// Bug 151 đã vá đúng ca này ở đường DOT-NOTATION (`n._预产天数`), nhưng đường OBJECT-KEY có y
// hệt điểm mù mà lúc đó không vá. Bằng chứng bug/154 cho thấy hậu quả trên cùng một dòng:
//     世界运转  -> 'Thế giới vận hành'   ✅ có bọc nháy
//     当前日期  -> 'Ngày hiện tại'       ✅ có bọc nháy
//     _开场标识 -> _Định danh khởi đầu   ❌ KHÔNG bọc  => SyntaxError (7:14), file chết
// Khác nhau đúng một ký tự `_` đứng trước cụm Hán.
import { describe, it, expect } from 'vitest';
import { extractCJKTokens, reinsertTranslations } from '../surgical';
import { jsParseErrorAny } from '../scriptSafety';

const DICT = { 开场标识: 'Định danh khởi đầu', 当前日期: 'Ngày hiện tại', 世界运转: 'Thế giới vận hành', 天气: 'Thời tiết' };
const run = (src: string, dict: Record<string, string> = DICT) =>
  reinsertTranslations(src, extractCJKTokens(src, undefined, 'preserve', dict));

describe('(bug 154) khoá object có tiền tố ASCII', () => {
  it('`_开场标识:` phải được nhận là khoá object (như `当前日期:`)', () => {
    const src = `const a=z.object({_开场标识:z.string(),当前日期:z.string()});`;
    const toks = extractCJKTokens(src);
    const withPrefix = toks.find((t) => t.text === '开场标识');
    const noPrefix = toks.find((t) => t.text === '当前日期');
    expect(noPrefix?.isObjectKey, '当前日期 xưa nay vẫn đúng — mốc đối chiếu').toBe(true);
    expect(withPrefix?.isObjectKey, '_开场标识 cũng phải là khoá object').toBe(true);
  });

  it('bọc nháy PHẢI ôm cả tiền tố: `_开场标识` → `\'_Định danh khởi đầu\'`', () => {
    const out = run(`const a=z.object({_开场标识:z.string()});`);
    expect(out).toContain("'_Định danh khởi đầu'");
    expect(out, 'không được để gạch dưới nằm NGOÀI nháy').not.toContain("_'Định danh");
    expect(jsParseErrorAny(out), 'phải parse được').toBeFalsy();
  });

  it('tái hiện đúng dòng vỡ trong bug/154 — sau khi vá phải parse được', () => {
    const src = `const a=r.z.object({世界运转:r.z.object({_开场标识:r.z.string().prefault(''),当前日期:r.z.string()})});`;
    const out = run(src);
    expect(jsParseErrorAny(src), 'gốc phải parse được (mốc)').toBeFalsy();
    expect(jsParseErrorAny(out), 'bản dịch cũng phải parse được').toBeFalsy();
  });

  it('chỗ ĐỌC và chỗ GHI cùng một khoá phải ra CÙNG một tên', () => {
    // `{_开场标识: …}` (khai) và `i.世界运转._开场标识 = …` (ghi) phải khớp nhau, không thì
    // script chạy trơn tru mà đọc trúng ô rỗng — hỏng âm thầm.
    const out = run(`const a={_开场标识:1};i.世界运转._开场标识=2;`);
    expect(out).toContain("'_Định danh khởi đầu'");
    expect(out).toContain("['_Định danh khởi đầu']");
    expect(jsParseErrorAny(out)).toBeFalsy();
  });
});

describe('(bug 154) đường dẫn có dấu chấm trong CODE cũng phải tra từ điển theo từng đoạn', () => {
  it('`变量.世界运转.天气` đổi được dù từ điển chỉ có từng đoạn riêng lẻ', () => {
    // User: "đã có từ điển cho 世界运转 và 天气, nhưng vẫn bỏ qua" — vì tra nguyên cụm
    // `世界运转.天气` thì không khớp mục nào trong từ điển.
    const out = run(`const x=变量.世界运转.天气;`);
    expect(out).toContain('Thế giới vận hành');
    expect(out).toContain('Thời tiết');
    expect(jsParseErrorAny(out)).toBeFalsy();
  });
});
