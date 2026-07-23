import { describe, it, expect } from 'vitest';
import { mergePersisted } from '../usePersistedState';

/**
 * (User 23/07 — việc 89) "Tạo thẻ từ truyện: để nó chạy xong 7 lượt quét mà không có lorebook
 * nào được tạo hết, chả có entry nào cả."
 *
 * Gốc: `withWorldEntries` không nằm trong object mặc định của `s2c.opts` nên luôn `undefined` →
 * prompt không hề yêu cầu world entries → bộ bóc tag cũng không tìm entry → 0 entry, im lặng.
 *
 * Nhưng chỉ thêm vào mặc định thì CHƯA đủ: `usePersistedState` trả về giá trị đã lưu NGUYÊN
 * KHỐI, nên ai đã dùng tool từ trước vẫn giữ object cũ thiếu khoá đó — sửa xong họ vẫn không
 * thấy gì đổi. Phải gộp mặc định vào bản đã lưu. Đây là bẫy chung cho MỌI thiết lập được lưu,
 * không riêng gì tab này.
 */

describe('mergePersisted — thêm khoá mới mà không đè lựa chọn của user', () => {
  it('CHÍNH CA BUG: khoá mới thêm vào mặc định phải tới được người dùng cũ', () => {
    const stored = { detail: 'vừa phải', nsfw: false, template: 'chuẩn' };
    const initial = { detail: 'vừa phải', nsfw: false, template: 'chuẩn', withWorldEntries: true };
    expect(mergePersisted(stored, initial)).toMatchObject({ withWorldEntries: true });
  });

  it('lựa chọn user đã đặt thì GIỮ NGUYÊN, không bị mặc định đè', () => {
    const merged = mergePersisted({ nsfw: true, detail: 'chi tiết' }, { nsfw: false, detail: 'vừa phải' });
    expect(merged).toEqual({ nsfw: true, detail: 'chi tiết' });
  });

  it('user đã TẮT một tuỳ chọn đang bật mặc định → vẫn tắt (false không bị coi là thiếu)', () => {
    expect(mergePersisted({ withWorldEntries: false }, { withWorldEntries: true }))
      .toEqual({ withWorldEntries: false });
  });

  it('chưa lưu gì / lưu null → dùng nguyên mặc định', () => {
    const initial = { a: 1 };
    expect(mergePersisted(undefined, initial)).toBe(initial);
    expect(mergePersisted(null, initial)).toBe(initial);
  });

  it('MẢNG không merge — merge mảng thì user không xoá được phần tử', () => {
    expect(mergePersisted(['a'], ['a', 'b', 'c'])).toEqual(['a']);
    expect(mergePersisted([], ['x'])).toEqual([]);
  });

  it('chuỗi/số/boolean giữ nguyên hành vi cũ', () => {
    expect(mergePersisted('đã lưu', 'mặc định')).toBe('đã lưu');
    expect(mergePersisted(0, 5)).toBe(0);
    expect(mergePersisted(false, true)).toBe(false);
  });

  it('chỉ merge NÔNG — object lồng bên trong giữ nguyên bản đã lưu', () => {
    const merged = mergePersisted(
      { cfg: { a: 1 }, top: 'cũ' },
      { cfg: { a: 9, b: 9 }, top: 'mới', them: 'mới' },
    );
    expect(merged).toEqual({ cfg: { a: 1 }, top: 'cũ', them: 'mới' });
  });
});
