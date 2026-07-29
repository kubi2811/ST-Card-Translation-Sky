// (bug 151) Truy cập thuộc tính có TIỀN TỐ ASCII sau dấu chấm — `n._预产天数`.
//
// Bằng chứng thật (bug/151): bộ dò dot-notation đòi chữ Hán đứng NGAY SAU dấu chấm, nên
// `n.状态` thoát nạn còn `n._预产天数` (có `_` chen giữa) bị coi là văn xuôi → dịch ra cụm
// có dấu cách → `n._Số ngày dự sinh` → SyntaxError, cả script chết.
//
// Đúng một ký tự `_` là đủ lọt lưới. Test này khoá cả hai chiều: nhận diện đúng, và tuyệt
// đối không sinh ra định danh chứa dấu cách.
import { describe, it, expect } from 'vitest';
import { extractCJKTokens, reinsertTranslations } from '../surgical';

/** Token phủ lên vị trí chữ Hán trong `src` (theo offset trả về từ extractor). */
const at = (src: string, needle: string) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`không tìm thấy ${needle}`);
  return i;
};

describe('(bug 151) truy cập thuộc tính có tiền tố ASCII', () => {
  it('`n._预产天数` phải được nhận là dot-notation (như `n.状态`)', () => {
    const src = `if(!n||n._预产天数||'已孕'!==n.状态)return;`;
    const toks = extractCJKTokens(src);

    const withPrefix = toks.find((t) => t.start === at(src, '预产天数'));
    const noPrefix = toks.find((t) => t.start === at(src, '状态'));

    // `n.状态` xưa nay vẫn đúng — dùng làm mốc đối chiếu.
    expect(noPrefix?.isDotNotation, 'n.状态 phải là dot-notation').toBe(true);
    // Đây là chỗ vỡ trong bằng chứng user.
    expect(withPrefix?.isDotNotation, 'n._预产天数 cũng phải là dot-notation').toBe(true);
  });

  it('dịch xong KHÔNG được sinh ra định danh chứa dấu cách (vỡ cú pháp)', () => {
    const src = `n._预产天数=r;`;
    const toks = extractCJKTokens(src);
    // Giả lập AI trả về bản dịch có dấu cách — đúng cái đã xảy ra thật.
    for (const t of toks) t.translated = 'Số ngày dự sinh';
    const out = reinsertTranslations(src, toks);

    expect(out, 'không được để lọt `._Số ngày dự sinh` trần').not.toMatch(
      /\.\s*_?[A-Za-zÀ-ỹ]+ +[A-Za-zÀ-ỹ]/,
    );
  });

  it('văn xuôi đánh số `1. 身份档案` KHÔNG được nhận nhầm là dot-notation', () => {
    const src = `const s='1. 身份档案';`;
    const toks = extractCJKTokens(src);
    const t = toks.find((x) => x.text.includes('身份档案'));
    expect(t?.isDotNotation, 'văn xuôi trong chuỗi không phải dot-notation').toBeFalsy();
  });

  it('dot-notation base Latin thường `wd.时势` vẫn nhận đúng (không hồi quy)', () => {
    const src = `const x=wd.时势;`;
    const toks = extractCJKTokens(src);
    const t = toks.find((x) => x.text === '时势');
    expect(t?.isDotNotation).toBe(true);
  });
});
