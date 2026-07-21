// (User 20/07) Phase B "Dịch Script": regex khớp nhãn Trung phải GIỮ Hán + THÊM nhánh Việt
// (bản dịch tay mẫu: /秋青子\s*[:：]?\s*/g → /(?:秋青子|Thu Thanh Tử)\s*[:：]?\s*/g).
// Sửa xong phải compile được, không thì hoàn nguyên — thà giữ Hán còn hơn vỡ script.
import { describe, it, expect } from 'vitest';
import {
  findCjkRegexLiterals,
  alternateRegexBody,
  applyRegexAlternation,
  escapeForRegex,
} from '../regexAlternation';

const DICT = { 秋青子: 'Thu Thanh Tử', 明月: 'Minh Nguyệt' };

describe('findCjkRegexLiterals — tách regex literal bằng tokenizer (phân biệt / chia và / regex)', () => {
  it('bắt đúng literal chứa CJK, bỏ qua literal thuần Latin + phép chia', () => {
    const code = `const a = 10 / 2; const r = /秋青子\\s*/g; const p = /hello/i; const d = b / c;`;
    const lits = findCjkRegexLiterals(code);
    expect(lits).toHaveLength(1);
    expect(lits[0].body).toBe('秋青子\\s*');
    expect(lits[0].flags).toBe('g');
    expect(code.slice(lits[0].start, lits[0].end)).toBe('/秋青子\\s*/g');
  });

  it('code không parse được → [] (bỏ pass, không đoán mò)', () => {
    expect(findCjkRegexLiterals('const x = {{{')).toEqual([]);
  });
});

describe('alternateRegexBody', () => {
  it('thêm nhánh đúng ca mẫu của user', () => {
    const r = alternateRegexBody('秋青子\\s*[:：]?\\s*', DICT);
    expect(r.body).toBe('(?:秋青子|Thu Thanh Tử)\\s*[:：]?\\s*');
    expect(r.changed).toBe(true);
  });

  it('regex vốn đã là alternation nhiều tên → VẪN thêm nhánh Việt cho từng tên', () => {
    // Review chéo bắt được: cũ chỉ cần thấy ký tự `|` là bỏ qua ⇒ /秋青子|明月/ (khớp nhiều
    // tên, rất phổ biến) không bao giờ được dịch — tính năng im lặng không chạy.
    const r = alternateRegexBody('秋青子|明月', DICT);
    expect(r.changed).toBe(true);
    expect(r.body).toBe('(?:秋青子|Thu Thanh Tử)|(?:明月|Minh Nguyệt)');
    expect(() => new RegExp(r.body)).not.toThrow();

    const g = alternateRegexBody('(秋青子|明月)[:：]', DICT);
    expect(g.changed).toBe(true);
    expect(() => new RegExp(g.body)).not.toThrow();
  });

  it('idempotent: đã có nhánh rồi thì KHÔNG bọc thêm lần nữa', () => {
    const once = alternateRegexBody('秋青子', DICT).body;
    const twice = alternateRegexBody(once, DICT).body;
    expect(twice).toBe(once);
  });

  it('bản dịch chứa ký tự đặc biệt của regex → được escape', () => {
    const r = alternateRegexBody('测试', { 测试: 'a.b(c)' });
    expect(r.body).toBe('(?:测试|a\\.b\\(c\\))');
    expect(() => new RegExp(r.body)).not.toThrow();
  });

  it('cụm CJK trong character class [..] → KHÔNG đụng (thêm nhánh trong class là sai nghĩa)', () => {
    const r = alternateRegexBody('[秋青子]+', DICT);
    expect(r.body).toBe('[秋青子]+');
    expect(r.skippedInClass).toContain('秋青子');
  });

  it('cụm không có trong dict → báo unknown, giữ nguyên', () => {
    const r = alternateRegexBody('无名氏', DICT);
    expect(r.changed).toBe(false);
    expect(r.unknown).toContain('无名氏');
  });
});

describe('applyRegexAlternation — áp lên cả file', () => {
  it('sửa nhiều literal, offset không lệch (ghép phải-sang-trái)', () => {
    const code = `const a=/秋青子/g;\nconst b=/明月来了/;\nconst c=/plain/;`;
    const r = applyRegexAlternation(code, DICT);
    expect(r.changed).toBe(2);
    expect(r.code).toContain('/(?:秋青子|Thu Thanh Tử)/g');
    expect(r.code).toContain('/(?:明月|Minh Nguyệt)来了/');
    expect(r.code).toContain('/plain/');
    expect(r.unknownTerms).toContain('来了');
  });

  it('kết quả cả file vẫn là JS parse được', async () => {
    const acorn = await import('acorn');
    const code = `export const r = /秋青子\\s*[:：]?\\s*/g;`;
    const r = applyRegexAlternation(code, DICT);
    expect(() => acorn.parse(r.code, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
  });
});

describe('escapeForRegex', () => {
  it('escape đủ bộ ký tự đặc biệt', () => {
    expect(escapeForRegex('a.b*c?')).toBe('a\\.b\\*c\\?');
    expect(() => new RegExp(escapeForRegex('($^|[]{}\\/)'))).not.toThrow();
  });
});
