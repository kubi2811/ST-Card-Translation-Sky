// (bug 151) Từ điển user phải đổi được KHOÁ DỮ LIỆU, không chỉ văn xuôi.
//
// Trước đây `extractCJKTokens` tính ra `isMvuVariable` rồi vứt đi, và đường Dịch Script còn
// không truyền từ điển vào — nên khoá MVU (`t.人际网络`, `{身份:…}`) nằm ngoài mọi đường dịch.
// Hệ quả nặng nhất KHÔNG phải là còn chữ Hán: card đã đổi biến sang tiếng Việt thì script đọc
// khoá Hán ra `undefined` — chạy trơn tru, dữ liệu rỗng, không lỗi nào báo.
import { describe, it, expect } from 'vitest';
import { extractCJKTokens, reinsertTranslations } from '../surgical';
import { jsParseErrorAny } from '../scriptSafety';

const DICT = { 人际网络: 'Mạng Lưới Quan Hệ', 身份: 'Thân Phận', 忠心: 'Trung Thành' };
const run = (src: string, dict = DICT) => reinsertTranslations(src, extractCJKTokens(src, undefined, 'preserve', dict));

describe('(bug 151) từ điển đổi khoá dữ liệu', () => {
  it('khoá object `{身份:…}` → bọc nháy, cú pháp còn lành', () => {
    const out = run(`const r={身份:'x',忠心:50};`);
    expect(out).toContain("'Thân Phận'");
    expect(out).toContain("'Trung Thành'");
    expect(jsParseErrorAny(out), 'phải parse được').toBeFalsy();
  });

  it('truy cập thuộc tính `r.身份` → bọc bracket, cú pháp còn lành', () => {
    const out = run(`if(r.身份)r.忠心=1;`);
    expect(out).toContain("r['Thân Phận']");
    expect(out).toContain("r['Trung Thành']");
    expect(jsParseErrorAny(out)).toBeFalsy();
  });

  it('KHÔNG có trong từ điển thì giữ nguyên (mặc định an toàn)', () => {
    const out = run(`if(r.身份&&r.职责)x=1;`);
    expect(out, '职责 ngoài từ điển → giữ nguyên chữ Hán').toContain('r.职责');
  });

  it('khai báo trần `const 身份` KHÔNG được đổi dù có trong từ điển (không cứu nổi cú pháp)', () => {
    const out = run(`const 身份=1;if(身份)x=1;`);
    expect(out).toContain('const 身份');
    expect(jsParseErrorAny(out)).toBeFalsy();
  });

  // Lớp B trong bằng chứng user: '军事.各营' bị AI dịch nguyên cụm thành 'Quân sự.Các doanh'.
  // Không vỡ cú pháp nên không lỗi nào báo — nhưng chuỗi tra cứu lệch khỏi khoá code dùng.
  it("đường dẫn trong chuỗi `'人际网络.身份'` đổi theo TỪNG ĐOẠN, dấu chấm còn nguyên", () => {
    const out = run(`const n=_.get(t,'人际网络.身份',{});`);
    expect(out).toContain("'Mạng Lưới Quan Hệ.Thân Phận'");
    expect(jsParseErrorAny(out)).toBeFalsy();
  });

  it('đoạn ngoài từ điển trong đường dẫn được giữ nguyên, không bịa', () => {
    const out = run(`_.get(t,'人际网络.私帷');`);
    expect(out).toContain("'Mạng Lưới Quan Hệ.私帷'");
  });

  it('đường dẫn trong chuỗi KHÔNG được đem đi hỏi AI (phải khớp khoá code dùng)', () => {
    const toks = extractCJKTokens(`_.get(t,'人际网络.私帷');`, undefined, 'preserve', DICT);
    for (const t of toks) expect(t.isIdentifier, `${t.text} phải nằm ngoài tầm AI`).toBe(true);
  });

  it('không có từ điển → hành vi cũ y nguyên, không hồi quy', () => {
    const src = `const r={身份:'x'};`;
    expect(reinsertTranslations(src, extractCJKTokens(src))).toBe(src);
  });
});
