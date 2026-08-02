/**
 * (bug 187 — Hạng mục F) Verifier tự động sau dịch: 4 phép kiểm AST.
 * ─────────────────────────────────────────────────────────────────────────────
 * Điều được kiểm ở đây KHÔNG chỉ là "bắt được lỗi" mà còn là "KHÔNG báo động giả
 * trên các biến đổi hợp lệ của chính pipeline" (đổi khoá theo Từ Điển, bọc bracket,
 * thêm nhánh alternation) — báo động giả dạy người ta bỏ qua cảnh báo thật.
 */
import { describe, it, expect } from 'vitest';
import { verifyTranslationAst, isValidAlternationUpgrade } from '../astVerifier';

const DICT = { 世界: 'Thế Giới', 天气: 'Thời Tiết', 状态: 'Trạng Thái', 身份: 'Thân Phận' };

describe('không báo động giả trên biến đổi hợp lệ', () => {
  it('file y hệt → sạch tuyệt đối', () => {
    const src = 'const a = { 状态: 1 }; t.世界.x = /秋青子/g;';
    const r = verifyTranslationAst(src, src, DICT);
    expect(r.mode).toBe('ast');
    expect(r.hardFail).toBe(false);
    expect(r.keyRenames).toHaveLength(0);
  });

  it('dịch văn xuôi + đổi khoá theo dict (dot→bracket, quote-wrap, thay nội dung nháy) → không hardFail', () => {
    const org = `const o = { 状态: 1, '身份': 2 };\nconst v = t.世界.天气;\nconst msg = '你好世界';`;
    const vi  = `const o = { 'Trạng Thái': 1, 'Thân Phận': 2 };\nconst v = t['Thế Giới']['Thời Tiết'];\nconst msg = 'Xin chào thế giới';`;
    const r = verifyTranslationAst(org, vi, DICT);
    expect(r.hardFail, r.hardFailReasons.join(' | ')).toBe(false);
    expect(r.nodeCountDiffs).toEqual([]);
    expect(r.structuralDiffs).toEqual([]);
    expect(r.identDiffs).toEqual([]);
    const renames = Object.fromEntries(r.keyRenames.map((k) => [k.from, k.to]));
    expect(renames).toEqual({ 状态: 'Trạng Thái', 身份: 'Thân Phận', 世界: 'Thế Giới', 天气: 'Thời Tiết' });
    expect(r.keyRenames.every((k) => k.inDict)).toBe(true);
    expect(r.renamesOffDict).toBe(0);
  });

  it('khoá có tiền tố ASCII: n._预产天数 → n["_Số ngày dự sinh"] vẫn tính là đúng dict', () => {
    const r = verifyTranslationAst(
      'n._预产天数 = 1;',
      `n['_Số ngày dự sinh'] = 1;`,
      { 预产天数: 'Số ngày dự sinh' },
    );
    expect(r.hardFail).toBe(false);
    expect(r.renamesOffDict).toBe(0);
    expect(r.keyRenames[0]).toMatchObject({ from: '_预产天数', inDict: true });
  });

  it('khoá đổi KHÁC dict → không chặn cứng nhưng renamesOffDict phải điểm mặt', () => {
    const r = verifyTranslationAst('t.世界 = 1;', `t['The Gioi Khac'] = 1;`, DICT);
    expect(r.hardFail).toBe(false);
    expect(r.renamesOffDict).toBe(1);
    expect(r.keyRenames[0]).toMatchObject({ from: '世界', to: 'The Gioi Khac', inDict: false });
  });

  it('regex bọc alternation hợp lệ → regexUpgrades, không phải lỗi', () => {
    const r = verifyTranslationAst(
      'const re = /秋青子\\s*[:：]/g;',
      'const re = /(?:秋青子|Thu Thanh Tử)\\s*[:：]/g;',
      DICT,
    );
    expect(r.hardFail).toBe(false);
    expect(r.regexUpgrades).toBe(1);
    expect(r.regexDiffs).toEqual([]);
  });
});

describe('4 phép kiểm — mỗi lớp lỗi bị chặn đích danh', () => {
  it('kiểm 1: AI bịa thêm statement → lệch node count → chặn cứng', () => {
    const r = verifyTranslationAst(
      'const a = 1;',
      'const a = 1; const safeString = () => 2;',
      DICT,
    );
    expect(r.hardFail).toBe(true);
    expect(r.nodeCountDiffs.length + r.structuralDiffs.length).toBeGreaterThan(0);
  });

  it('kiểm 2a: định danh TRẦN bị đổi tên → chặn cứng (khoá đổi hợp lệ không bị vạ lây)', () => {
    const r = verifyTranslationAst('const 配置 = 1; use(配置);', 'const CauHinh = 1; use(CauHinh);', DICT);
    expect(r.hardFail).toBe(true);
    expect(r.identDiffs.length).toBeGreaterThan(0);
    expect(r.identDiffs[0]).toMatchObject({ before: '配置', after: 'CauHinh' });
  });

  it('kiểm 2b: literal số/bool đổi giá trị → chặn cứng', () => {
    const r = verifyTranslationAst('const x = 100; const y = true;', 'const x = 10; const y = true;', DICT);
    expect(r.hardFail).toBe(true);
    expect(r.literalDiffs).toEqual([{ before: '100', after: '10', line: 1 }]);
  });

  it('kiểm 2c: regex đổi KHÔNG theo kiểu alternation → chặn cứng', () => {
    const r = verifyTranslationAst('const re = /秋青子/g;', 'const re = /Thu Thanh Tử/g;', DICT);
    expect(r.hardFail).toBe(true);
    expect(r.regexDiffs.length).toBe(1);
  });

  it('kiểm 3: .join("、") đổi thành .join(", ") → chặn cứng', () => {
    const r = verifyTranslationAst(`const s = arr.join('、');`, `const s = arr.join(', ');`, DICT);
    expect(r.hardFail).toBe(true);
    expect(r.delimiterDiffs).toEqual([
      { delimiter: '、', joinBefore: 1, joinAfter: 0, splitBefore: 0, splitAfter: 0 },
    ]);
  });

  it('bản dịch vỡ cú pháp (gốc lành) → chặn cứng + nói rõ lỗi do dịch', () => {
    const r = verifyTranslationAst(`const s = 'a';`, `const s = 'a;`, DICT);
    expect(r.mode).toBe('text-only');
    expect(r.hardFail).toBe(true);
    expect(r.hardFailReasons.join(' ')).toContain('KHÔNG parse được');
  });
});

describe('kiểm 4 — phân loại CJK còn sót (Hạng mục C)', () => {
  it('tách đúng 4 nhóm: khoá dữ liệu / văn xuôi / alternation hợp lệ / định danh giữ chủ đích', () => {
    const vi = [
      `const 配置 = 1;`,                                  // định danh trần — giữ chủ đích (bug 128)
      `const v = t.世界经济简报;`,                          // khoá dot-notation còn Hán — ĐỎ
      `const s = '这段话没翻译';`,                          // văn xuôi sót — VÀNG
      `const re = /(?:行动选项|Lựa chọn hành động)/g;`,      // alternation — hợp lệ
      `const re2 = /平行世界/g;`,                           // regex chưa có nhánh Việt
    ].join('\n');
    const r = verifyTranslationAst(vi, vi, DICT);
    const g = r.cjkGroups;
    expect(g.dataKey.map((x) => x.text)).toEqual(['世界经济简报']);
    expect(g.dataKey[0].line).toBe(2);
    expect(g.prose.map((x) => x.text)).toEqual(['这段话没翻译']);
    expect(g.keptIdentifiers).toBeGreaterThan(0);
    expect(g.alternationChars).toBe(4);                    // 行动选项
    expect(g.regexNoAlt.map((x) => x.text)).toEqual(['平行世界']);
  });

  it('bản dịch sạch 100% → mọi nhóm rỗng', () => {
    const r = verifyTranslationAst('const a = 1;', `const a = 1; const s = 'Xin chào';`, DICT);
    // (ví dụ này cố tình lệch node count — chỉ soi cjkGroups)
    expect(r.cjkGroups.dataKey).toEqual([]);
    expect(r.cjkGroups.prose).toEqual([]);
    expect(r.cjkGroups.alternationChars).toBe(0);
  });
});

describe('isValidAlternationUpgrade', () => {
  it('bọc một/nhiều cụm, có ký tự regex đặc biệt trong nhánh Việt', () => {
    expect(isValidAlternationUpgrade('秋青子出现', '(?:秋青子|Thu Thanh Tử)出现')).toBe(true);
    expect(isValidAlternationUpgrade('秋青子|明月', '(?:秋青子|Thu Thanh Tử)|(?:明月|Minh Nguyệt)')).toBe(true);
    expect(isValidAlternationUpgrade('秋青子', 'Thu Thanh Tử')).toBe(false);
    expect(isValidAlternationUpgrade('秋青子出现', '(?:秋青子|Thu)不出现')).toBe(false);
  });

  it('(review 187) alternation CÓ SẴN trong gốc không bị bóc oan — kể cả trộn lẫn', () => {
    // Gốc có sẵn group ASCII, pipeline chỉ bọc thêm run Hán bên cạnh — hợp lệ.
    expect(isValidAlternationUpgrade('(?:foo|bar)汉', '(?:foo|bar)(?:汉|viet)')).toBe(true);
    // Gốc có sẵn group CJK-đầu, thêm wrap cho run khác — hợp lệ.
    expect(isValidAlternationUpgrade('(?:汉|x)中', '(?:汉|x)(?:中|viet)')).toBe(true);
    // Ca World Engine thật: nâng cấp thành viên bên trong group có sẵn.
    expect(isValidAlternationUpgrade(
      '<\\/?(?:平行世界|parallel[_ -]?world)(?:\\s[^>]*)?>',
      '<\\/?(?:(?:平行世界|Thế giới song song)|parallel[_ -]?world)(?:\\s[^>]*)?>',
    )).toBe(true);
    // Đổi thật sự vẫn phải bị bắt.
    expect(isValidAlternationUpgrade('(?:foo|bar)汉', '(?:foo|baz)(?:汉|viet)')).toBe(false);
  });
});

describe('(review 187) rename hậu tố + identity trong dict', () => {
  it('khoá hậu tố đổi theo core+ghép hậu tố → inDict, không báo off-dict oan', () => {
    const r = verifyTranslationAst('n._魔力值2 = 1;', `n['_Mana2'] = 1;`, { 魔力值: 'Mana' });
    expect(r.hardFail).toBe(false);
    expect(r.renamesOffDict).toBe(0);
    expect(r.keyRenames[0]).toMatchObject({ from: '_魔力值2', to: '_Mana2', inDict: true });
  });

  it('khoá identity trong dict còn Hán → nhóm giữ-chủ-đích trung tính, không sơn đỏ dataKey', () => {
    const src = 'const v = t.身份;';
    const r = verifyTranslationAst(src, src, { 身份: '身份' });
    expect(r.cjkGroups.dataKey).toEqual([]);
    expect(r.cjkGroups.keptIdentifiers).toBeGreaterThan(0);
  });
});
