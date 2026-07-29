// (bug 151) Đối chiếu trên CHÍNH file script user gửi — không phải mẫu tự bịa.
// bug/ nằm trong .gitignore (bằng chứng chỉ có trên một máy) nên test tự bỏ qua khi thiếu file.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractCJKTokens, reinsertTranslations } from '../surgical';
import { jsParseErrorAny } from '../scriptSafety';
import { isTranslatableToken } from '../../scriptTranslate/tokenBatcher';

const SRC = resolve(__dirname, '../../../bug/151/Trước Dịch.txt');
const has = existsSync(SRC);
const read = () => readFileSync(SRC, 'utf-8');

describe.skipIf(!has)('(bug 151) script thật của user', () => {
  it('`_预产天数` được nhận là truy cập thuộc tính → KHÔNG đem đi dịch', () => {
    const toks = extractCJKTokens(read());
    const t = toks.filter((x) => x.text.includes('预产天数'));
    expect(t.length, 'phải tìm thấy token 预产天数').toBeGreaterThan(0);
    for (const tok of t) {
      expect(tok.isDotNotation, `${tok.text} @${tok.start} phải là dot-notation`).toBe(true);
      expect(isTranslatableToken(tok), `${tok.text} không được đem đi dịch`).toBe(false);
    }
  });

  it('không token dịch được nào nằm ở thế truy cập thuộc tính trần', () => {
    const src = read();
    const bad = extractCJKTokens(src)
      .filter(isTranslatableToken)
      .filter((t) => {
        const head = src.slice(0, t.start);
        const bare = head.slice(0, head.length - (/[\w$]*$/.exec(head)?.[0].length ?? 0));
        // dấu chấm dính liền định danh + trước nó không phải chữ số = truy cập thuộc tính thật
        return /[\w$\])}'"一-鿿㐀-䶿]\??\.$/.test(bare) && !/[0-9]\??\.$/.test(bare);
      });
    expect(bad.map((t) => `${t.text}@${t.start}`), 'dịch mấy token này là vỡ cú pháp').toEqual([]);
  });

  // Đây là phép kiểm quan trọng nhất của bug 151: đổi tên KHOÁ DỮ LIỆU theo từ điển trên chính
  // script thật, rồi đòi output vẫn parse được. Bản gốc user gửi về chết ở cột 3641.
  it('đổi khoá theo từ điển trên script thật → vẫn parse được, không sót khoá cũ', () => {
    const src = read();
    const DICT: Record<string, string> = {
      人际网络: 'Mạng Lưới Quan Hệ',
      下属与幕僚: 'Thuộc Hạ Và Mạc Liêu',
      身份: 'Thân Phận',
      忠心: 'Trung Thành',
      好感度: 'Hảo Cảm Độ',
      类型: 'Loại Hình',
    };
    const toks = extractCJKTokens(src, undefined, 'preserve', DICT);
    const out = reinsertTranslations(src, toks);

    expect(jsParseErrorAny(src), 'script GỐC phải parse được (mốc đối chiếu)').toBeFalsy();
    expect(jsParseErrorAny(out), 'sau khi đổi khoá vẫn phải parse được').toBeFalsy();

    // Đổi thì phải đổi HẾT ở thế thuộc tính — sót một chỗ là đọc trúng ô rỗng, hỏng âm thầm.
    for (const [cn, vi] of Object.entries(DICT)) {
      expect(out, `${cn} phải xuất hiện dưới tên mới`).toContain(vi);
      expect(out, `${cn} không được còn ở thế .thuộc-tính`).not.toMatch(
        new RegExp(`\\.${cn}(?![\\w$一-鿿])`),
      );
    }
  });
});
