import { describe, it, expect } from 'vitest';
import { splitKeyInput, sanitizeAiKeys } from '../keyInput';

/**
 * (User 2026) Nhập "giao hàng, ship hàng" ở ô từ khoá kích hoạt phải ra HAI key riêng,
 * không phải một key dài dính dấu phẩy.
 */
describe('splitKeyInput', () => {
  it('tách theo dấu phẩy thường', () => {
    expect(splitKeyInput('giao hàng, ship hàng')).toEqual(['giao hàng', 'ship hàng']);
  });

  it('tách theo dấu phẩy TOÀN RỘNG (，) — bàn phím tiếng Trung hay ra dấu này', () => {
    expect(splitKeyInput('giao hàng，ship hàng')).toEqual(['giao hàng', 'ship hàng']);
  });

  it('cắt khoảng trắng thừa quanh từng key', () => {
    expect(splitKeyInput('  giao hàng ,   ship hàng  ')).toEqual(['giao hàng', 'ship hàng']);
  });

  it('bỏ phần rỗng do dấu phẩy thừa/liên tiếp', () => {
    expect(splitKeyInput('a,,b,')).toEqual(['a', 'b']);
  });

  it('bỏ trùng lặp trong cùng lần nhập', () => {
    expect(splitKeyInput('a, b, a')).toEqual(['a', 'b']);
  });

  it('không có dấu phẩy → giữ nguyên 1 key, KHÔNG tách theo khoảng trắng', () => {
    expect(splitKeyInput('giao hàng')).toEqual(['giao hàng']);
  });

  it('chuỗi rỗng / chỉ khoảng trắng → mảng rỗng', () => {
    expect(splitKeyInput('')).toEqual([]);
    expect(splitKeyInput('   ')).toEqual([]);
    expect(splitKeyInput(' , , ')).toEqual([]);
  });
});

/**
 * (User 2026) AI tạo entry hay ra keyword dính dấu _ ("giao_hàng"). Người chơi gõ
 * "giao hàng" có khoảng trắng nên key đó không bao giờ kích hoạt → entry chết.
 */
describe('sanitizeAiKeys — dọn keys do AI sinh', () => {
  it('đổi gạch dưới thành khoảng trắng', () => {
    expect(sanitizeAiKeys(['giao_hàng', 'ship_hàng'])).toEqual(['giao hàng', 'ship hàng']);
  });

  it('gạch dưới liên tiếp → một khoảng trắng', () => {
    expect(sanitizeAiKeys(['Lý__Thanh___Vân'])).toEqual(['Lý Thanh Vân']);
  });

  it('GIỮ NGUYÊN gạch ngang (có từ thật dùng nó)', () => {
    expect(sanitizeAiKeys(['sci-fi', 'Anti-Hero'])).toEqual(['sci-fi', 'Anti-Hero']);
  });

  it('AI gộp nhiều key vào 1 phần tử → tách ra', () => {
    expect(sanitizeAiKeys(['giao hàng, ship hàng'])).toEqual(['giao hàng', 'ship hàng']);
  });

  it('bỏ trùng sau khi dọn (giao_hàng và giao hàng là một)', () => {
    expect(sanitizeAiKeys(['giao_hàng', 'giao hàng'])).toEqual(['giao hàng']);
  });

  it('đầu vào không phải mảng / phần tử không phải chuỗi → không nổ', () => {
    expect(sanitizeAiKeys(undefined)).toEqual([]);
    expect(sanitizeAiKeys('abc')).toEqual([]);
    expect(sanitizeAiKeys([null, 123, 'ok'])).toEqual(['ok']);
  });
});
