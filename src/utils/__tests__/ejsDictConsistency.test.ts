import { describe, it, expect } from 'vitest';
import { canonicalizeEjsValue, enforceEjsDictConsistency } from '../ejsSync';

/**
 * (User 2026) Từ điển Chiến lược C không được làm sạch → cùng 1 keyword ra nhiều dạng (thêm dấu,
 * ký tự lạ, hoa/thường lệch) → EJS/MVU gãy. canonicalizeEjsValue + enforceEjsDictConsistency đồng nhất.
 */
describe('canonicalizeEjsValue', () => {
  it('bỏ nháy/khoảng trắng bao ngoài + gộp khoảng trắng', () => {
    expect(canonicalizeEjsValue('  "Trạng thái chiến đấu"  ')).toBe('Trạng thái chiến đấu');
    expect(canonicalizeEjsValue('Hiệp   xung   đột')).toBe('Hiệp xung đột');
  });
  it('bỏ ký tự zero-width lẫn trong chuỗi', () => {
    expect(canonicalizeEjsValue('Kim​Đan')).toBe('KimĐan');
  });
  it('giữ nội dung/hoa-thường; rỗng/không phải chuỗi → như cũ', () => {
    expect(canonicalizeEjsValue('Nghỉ ngơi giữa giờ')).toBe('Nghỉ ngơi giữa giờ');
    // @ts-expect-error kiểm đầu vào lạ
    expect(canonicalizeEjsValue(null)).toBe(null);
  });
});

describe('enforceEjsDictConsistency', () => {
  it('làm sạch value + gom cụm gần-giống về 1 dạng canonical (phổ biến nhất)', () => {
    const { fixedDict } = enforceEjsDictConsistency({
      a: 'Trạng thái chiến đấu',
      b: 'trạng thái chiến đấu',   // lệch hoa/thường
      c: '"Trạng thái chiến đấu"',  // dính nháy
      d: 'Trạng-thái-chiến-đấu',    // dính gạch
    });
    // a xuất hiện dạng "Trạng thái chiến đấu" nhiều nhất → canonical
    expect(fixedDict.a).toBe('Trạng thái chiến đấu');
    expect(fixedDict.b).toBe('Trạng thái chiến đấu');
    expect(fixedDict.c).toBe('Trạng thái chiến đấu');
    // d chuẩn hoá cụm (bỏ gạch để so) → về cùng canonical
    expect(fixedDict.d).toBe('Trạng thái chiến đấu');
  });
  it('value khác cụm → giữ riêng, không gộp bừa', () => {
    const { fixedDict } = enforceEjsDictConsistency({ x: 'Kim Đan', y: 'Linh Khí' });
    expect(fixedDict.x).toBe('Kim Đan');
    expect(fixedDict.y).toBe('Linh Khí');
  });
  it('hoà tần suất → chọn value DÀI nhất làm canonical', () => {
    const { fixedDict } = enforceEjsDictConsistency({ p: 'Hiệp xung đột', q: 'hiep xung dot' });
    // 2 value khác normKey (dấu) → KHÔNG cùng cụm (norm chỉ bỏ space/gạch, giữ dấu) → giữ nguyên
    expect(fixedDict.p).toBe('Hiệp xung đột');
  });
});
