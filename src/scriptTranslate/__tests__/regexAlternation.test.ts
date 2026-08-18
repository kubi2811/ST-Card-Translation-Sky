// (User 20/07) Phase B "Dịch Script": regex khớp nhãn Trung phải GIỮ Hán + THÊM nhánh Việt
// (bản dịch tay mẫu: /秋青子\s*[:：]?\s*/g → /(?:秋青子|Thu Thanh Tử)\s*[:：]?\s*/g).
// Sửa xong phải compile được, không thì hoàn nguyên — thà giữ Hán còn hơn vỡ script.
import { describe, it, expect } from 'vitest';
import {
  findCjkRegexLiterals,
  alternateRegexBody,
  applyRegexAlternation,
  escapeForRegex,
  restoreMachineRegexCharacterClasses,
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

  it('không bỏ qua nhầm khi bản dịch giống nhãn ở gần đó', () => {
    const dict = { 甲: 'Chung', 乙: 'Chung' };
    // 甲 đã vá sẵn, còn 乙 chưa vá. Kiểm tra kiểu `window.includes("Chung")` cũ thấy chữ
    // Chung của 甲 ở gần 乙 rồi kết luận nhầm rằng 乙 cũng đã được xử lý.
    const r = alternateRegexBody('(?:甲|Chung)|乙', dict);
    expect(r.body).toBe('(?:甲|Chung)|(?:乙|Chung)');
    expect(r.changed).toBe(true);
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

describe('restoreMachineRegexCharacterClasses — dấu phân cách không được dịch thành chữ', () => {
  it('khôi phục đúng ca /[·・]/ → /[·dấu chấm giữa]/', () => {
    const original = 'var parts=spec.split(/[·・]/);';
    const broken = 'var parts=spec.split(/[·dấu chấm giữa]/);';
    const r = restoreMachineRegexCharacterClasses(original, broken);
    expect(r.code).toBe(original);
    expect(r.restored).toBe(1);
  });

  it('không đoán class có chữ thật', () => {
    const original = 'const r=/[男・女]/;';
    const translated = 'const r=/[Nam・Nữ]/;';
    expect(restoreMachineRegexCharacterClasses(original, translated))
      .toEqual({ code: translated, restored: 0 });
  });

  it('nhiều literal được ghép phải-sang-trái mà không lệch offset', () => {
    const original = 'const a=/[·・]/; const b=/x/; const c=/[・]/g;';
    const broken = 'const a=/[·dấu chấm giữa]/; const b=/xin chào/; const c=/[dấu giữa]/g;';
    const r = restoreMachineRegexCharacterClasses(original, broken);
    expect(r.code).toBe('const a=/[·・]/; const b=/xin chào/; const c=/[・]/g;');
    expect(r.restored).toBe(2);
  });

  it('khôi phục được regex nằm trong field replaceString có cả HTML/CSS', () => {
    const original = '<style>.x{content:"商品"}</style><script>var parts=spec.split(/[·・]/);</script>';
    const broken = '<style>.x{content:"Hàng hóa"}</style><script>var parts=spec.split(/[·dấu chấm giữa]/);</script>';
    const r = restoreMachineRegexCharacterClasses(original, broken);
    expect(r.code).toBe('<style>.x{content:"Hàng hóa"}</style><script>var parts=spec.split(/[·・]/);</script>');
    expect(r.restored).toBe(1);
  });
});
