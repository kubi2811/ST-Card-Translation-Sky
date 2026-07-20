// (User 20/07) Phase C "Dịch Preset": hàng rào macro — mẫu thật giữ đúng 342/342 setvar
// + 290/290 getvar sau dịch; đổi tên biến phải NGUYÊN TỬ (đủ cả 2 vế theo renameMap).
import { describe, it, expect } from 'vitest';
import { countMacros, validateMacroParity } from '../macroGuard';

describe('countMacros', () => {
  it('đếm setvar (có value) / getvar / comment / cân bằng ngoặc', () => {
    const t = '{{setvar::美型化::on}} rồi {{getvar::美型化}} và {{setvar::mood::vui}} {{//ghi chú}} {{char}}';
    const c = countMacros(t);
    expect(c.setvar.get('美型化')).toBe(1);
    expect(c.setvar.get('mood')).toBe(1);
    expect(c.getvar.get('美型化')).toBe(1);
    expect(c.comments).toBe(1);
    expect(c.braceBalanced).toBe(true);
  });

  it('phát hiện {{ }} mất cân bằng', () => {
    expect(countMacros('{{setvar::a::1}} {{char}').braceBalanced).toBe(false);
  });
});

describe('validateMacroParity', () => {
  const before = '{{setvar::美型化::on}} A {{getvar::美型化}} B {{getvar::美型化}} {{//gốc}}';

  it('dịch chuẩn + đổi tên nguyên tử theo renameMap → 0 lỗi', () => {
    const after = '{{setvar::beautify::on}} X {{getvar::beautify}} Y {{getvar::beautify}} {{//đã dịch}}';
    expect(validateMacroParity(before, after, { 美型化: 'beautify' })).toEqual([]);
  });

  it('đổi tên NỬA VỜI (sót 1 getvar tiếng Trung) → báo đúng biến + đúng số', () => {
    const after = '{{setvar::beautify::on}} X {{getvar::beautify}} Y {{getvar::美型化}} {{//c}}';
    const issues = validateMacroParity(before, after, { 美型化: 'beautify' });
    // getvar::beautify thiếu 1 (2→1) + xuất hiện biến lạ 美型化 (chưa rename)
    expect(issues.some((i) => i.kind === 'getvar' && i.name === 'beautify' && i.before === 2 && i.after === 1)).toBe(true);
    expect(issues.some((i) => i.kind === 'getvar' && i.name === '美型化' && i.after === 1)).toBe(true);
  });

  it('AI bịa thêm biến mới → bị bắt', () => {
    const after = before + ' {{setvar::hacker::1}}';
    const issues = validateMacroParity(before, after);
    expect(issues.some((i) => i.kind === 'setvar' && i.name === 'hacker')).toBe(true);
  });

  it('AI nuốt mất comment macro → bị bắt', () => {
    const after = '{{setvar::美型化::on}} A {{getvar::美型化}} B {{getvar::美型化}}';
    const issues = validateMacroParity(before, after);
    expect(issues.some((i) => i.kind === 'comment')).toBe(true);
  });
});
