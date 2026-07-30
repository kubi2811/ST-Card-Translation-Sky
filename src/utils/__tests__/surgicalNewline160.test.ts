// (bug 160) MỘT nguyên nhân giải thích cả hai triệu chứng nặng nhất.
//
// Script gốc là bản minify MỘT DÒNG. Bản dịch user nhận về có 42 dòng, và chỗ vỡ khớp khít:
//   dòng 1 dừng giữa câu Hán "…她仰头看了一眼房梁"
//   dòng 2 bắt đầu bằng "Cô ngẩng đầu nhìn xà nhà…" — đúng bản dịch của chính câu Hán đó
// Tức là AI trả về `nguyên_văn` + XUỐNG DÒNG + `bản_dịch`, rồi cả cục được chèn vào. Hệ quả:
//   • ký tự xuống dòng THẬT nằm trong chuỗi JS ⇒ "Unterminated string constant" (báo lỗi mục 4);
//   • phần nguyên văn còn nguyên bên trên bản dịch ⇒ "dịch nhưng không xoá đoạn gốc" (mục 2).
//
// Nên chốt chặn phải là một BẤT BIẾN tất định: bản dịch KHÔNG được mang thêm ký tự xuống dòng mà
// token gốc không có. Bất biến này không cần AI ngoan, và nó chặn cả hai triệu chứng cùng lúc.
import { describe, it, expect } from 'vitest';
import { extractCJKTokens, reinsertTranslations } from '../surgical';
import { jsParseErrorAny } from '../scriptSafety';

describe('(bug 160) bản dịch không được tự thêm ký tự xuống dòng', () => {
  it('AI trả "nguyên văn \\n bản dịch" → chỉ giữ bản dịch, chuỗi JS không vỡ', () => {
    const src = `const s='她仰头看了一眼房梁';`;
    const toks = extractCJKTokens(src);
    // Đúng thứ AI đã trả về trong bằng chứng.
    for (const t of toks) t.translated = '她仰头看了一眼房梁\nCô ngẩng đầu nhìn xà nhà';
    const out = reinsertTranslations(src, toks);

    expect(out, 'không được còn ký tự xuống dòng thật trong chuỗi một dòng').not.toContain('\n');
    expect(jsParseErrorAny(out), 'phải parse được').toBeFalsy();
  });

  it('token gốc VỐN có xuống dòng thì bản dịch được phép có', () => {
    const src = 'const s = `第一行\n第二行`;';
    const toks = extractCJKTokens(src);
    for (const t of toks) if (t.text.includes('\n')) t.translated = 'Dòng một\nDòng hai';
    const out = reinsertTranslations(src, toks);
    // Không đòi giữ nguyên số dòng tuyệt đối, chỉ cần không vỡ cú pháp.
    expect(jsParseErrorAny(out)).toBeFalsy();
  });

  it('nhiều dòng gộp thành một dấu cách, không dính chữ vào nhau', () => {
    const src = `const s='测试';`;
    const toks = extractCJKTokens(src);
    for (const t of toks) t.translated = 'Dòng một\nDòng hai';
    const out = reinsertTranslations(src, toks);
    expect(out).toContain('Dòng một Dòng hai');
  });

  it('xuống dòng kiểu CRLF cũng bị chặn', () => {
    const src = `const s='测试';`;
    const toks = extractCJKTokens(src);
    for (const t of toks) t.translated = 'A\r\nB';
    const out = reinsertTranslations(src, toks);
    expect(out).not.toMatch(/[\r\n]/);
  });
});

describe('(bug 160) chữ dính vào nhau ở ranh giới Hán ↔ Latin', () => {
  it('"给AI使用" → không ra "dành choAIDùng để hiểu"', () => {
    // Bộ gom token cắt quanh cụm Latin `AI`, nên hai bản dịch nằm sát hai bên nó. Tiếng Trung
    // không có dấu cách nên nối lại là dính liền — user báo đúng cảnh này.
    const src = `const s='给AI使用';`;
    const toks = extractCJKTokens(src);
    const m = new Map([['给', 'dành cho'], ['使用', 'Dùng để hiểu']]);
    for (const t of toks) { const v = m.get(t.text); if (v) t.translated = v; }
    const out = reinsertTranslations(src, toks);
    expect(out, 'phải có dấu cách hai bên cụm Latin').not.toContain('choAI');
    expect(out).not.toContain('AIDùng');
  });

  it('không thêm dấu cách khi bản dịch đã có sẵn', () => {
    const src = `const s='测试';`;
    const toks = extractCJKTokens(src);
    for (const t of toks) t.translated = ' Đã có cách ';
    const out = reinsertTranslations(src, toks);
    expect(out).not.toContain('  ');
  });
});

// Ví dụ (d) user gửi: `ee={世界运转:{},主角:{},'Khoa kỹ':{},…}` — có cái đã dịch có cái chưa, NGAY
// CẠNH NHAU. Bản vá 154 chỉ cho từ điển thắng lớp bảo vệ ở thế THUỘC TÍNH, nên khoá object bị bỏ
// qua trong khi `世界运转.当前日期` ở chỗ khác lại được đổi. Nửa đổi nửa không còn tệ hơn không đổi:
// chỗ ghi và chỗ đọc trỏ vào hai ô khác nhau, chạy không lỗi mà dữ liệu mất hút.
describe('(bug 160) khoá object cũng phải đổi được theo từ điển', () => {
  const DICT = { 世界运转: 'Thế giới vận hành', 主角: 'Nhân vật chính', 当前日期: 'Ngày hiện tại' };
  const run = (src: string) =>
    reinsertTranslations(src, extractCJKTokens(src, undefined, 'preserve', DICT));

  it('đổi khoá object dù tên đó cũng xuất hiện ở thế thuộc tính chỗ khác', () => {
    // `世界运转.当前日期` làm 世界运转 vào protectedIds; bản cũ vì thế bỏ qua khoá object của nó.
    const src = `let ee={世界运转:{},主角:{}};const x=ee.世界运转.当前日期;`;
    const out = run(src);
    expect(out, 'khoá object phải đổi').toContain("'Thế giới vận hành'");
    expect(out, 'thế thuộc tính cũng phải đổi — hai bên phải khớp').toContain("['Thế giới vận hành']");
    expect(jsParseErrorAny(out)).toBeFalsy();
  });

  it('mọi khoá trong cùng object đều đổi, không bỏ sót cái nào', () => {
    const out = run(`let ee={世界运转:{},主角:{}};`);
    expect(out).toContain("'Thế giới vận hành'");
    expect(out).toContain("'Nhân vật chính'");
  });

  it('khoá KHÔNG có trong từ điển vẫn giữ nguyên (mặc định an toàn)', () => {
    expect(run(`let ee={世界运转:{},风月阁:{}};`)).toContain('风月阁');
  });

  it('khai báo trần vẫn KHÔNG bị đổi — không có cách bọc nào cứu cú pháp', () => {
    const out = run(`const 主角=1;if(主角)x=1;`);
    expect(out).toContain('const 主角');
    expect(jsParseErrorAny(out)).toBeFalsy();
  });
});
