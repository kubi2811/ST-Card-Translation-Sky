import { describe, it, expect } from 'vitest';
import { splitKeyInput } from '../keyInput';

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
