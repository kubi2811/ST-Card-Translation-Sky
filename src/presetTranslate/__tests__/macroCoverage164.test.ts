/**
 * (bug 164 · HM0-A + HM0-C) BẢY MACRO BIẾN, KHÔNG PHẢI HAI.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bộ macro app tự khai (và macroResolver.ts thực thi đủ) gồm 7: setvar, getvar, addvar, incvar,
 * decvar, setglobalvar, getglobalvar.
 *
 * Bản cũ hở đúng 5 cái, ở CẢ HAI phía:
 *   • applyVarRenames chỉ đổi tên {{setvar::}} và {{getvar::}};
 *   • countMacros chỉ ĐẾM hai cái đó (lưu ý `{{setglobalvar::` không khớp `{{setvar::`).
 * Nên khi một biến được dịch, `{{addvar::好感度::1}}` giữ nguyên chữ Hán trong khi
 * `{{setvar::好感度}}` đã thành `{{setvar::affection}}` — chỗ ghi và chỗ tăng trỏ vào hai biến khác
 * nhau, và hàng rào dựng ra để bắt lệch cũng không thấy gì. Lỗi im lặng kép.
 */
import { describe, it, expect } from 'vitest';
import { applyVarRenames, VAR_MACROS } from '../consistencyPass';
import { countMacros, validateMacroParity } from '../macroGuard';

const dict = { '好感度': 'affection' };

describe('(bug 164 · HM0-A) applyVarRenames phủ đủ 7 macro', () => {
  it('danh sách macro đúng 7 cái theo quy ước app', () => {
    expect([...VAR_MACROS].sort()).toEqual(
      ['addvar', 'decvar', 'getglobalvar', 'getvar', 'incvar', 'setglobalvar', 'setvar'].sort(),
    );
  });

  for (const m of ['setvar', 'getvar', 'addvar', 'incvar', 'decvar', 'setglobalvar', 'getglobalvar']) {
    it(`đổi tên trong {{${m}::…}}`, () => {
      const out = applyVarRenames(`x {{${m}::好感度}} y`, dict);
      expect(out).toBe(`x {{${m}::affection}} y`);
    });
  }

  it('macro có thêm tham số (addvar::name::value) vẫn giữ nguyên phần value', () => {
    expect(applyVarRenames('{{addvar::好感度::5}}', dict)).toBe('{{addvar::affection::5}}');
  });

  it('KHÔNG đụng macro khác (char/user/roll) — chỉ macro biến', () => {
    const src = '{{char}} {{user}} {{roll::2d6}} {{setvar::好感度}}';
    expect(applyVarRenames(src, dict)).toBe('{{char}} {{user}} {{roll::2d6}} {{setvar::affection}}');
  });

  it('key DÀI vẫn thay trước — không để 好感 cắn nửa 好感度', () => {
    const out = applyVarRenames('{{addvar::好感度::1}}', { '好感': 'like', '好感度': 'affection' });
    expect(out, 'thay ngắn trước sẽ ra {{addvar::like度::1}} — tên biến hỏng').toBe('{{addvar::affection::1}}');
  });
});

describe('(bug 164 · HM0-C) countMacros THẤY đủ 7 macro', () => {
  it('nhóm GHI gộp setvar/setglobalvar/addvar/incvar/decvar theo tên biến', () => {
    const c = countMacros('{{setvar::A::1}}{{setglobalvar::A::2}}{{addvar::A::3}}{{incvar::A}}{{decvar::A}}');
    expect(c.setvar.get('A'), 'cả 5 macro ghi đều phải được đếm').toBe(5);
  });

  it('nhóm ĐỌC gộp getvar/getglobalvar', () => {
    const c = countMacros('{{getvar::A}}{{getglobalvar::A}}');
    expect(c.getvar.get('A')).toBe(2);
  });

  it('setglobalvar KHÔNG bị đếm lẫn thành setvar của biến khác', () => {
    const c = countMacros('{{setglobalvar::B::1}}');
    expect(c.setvar.get('B')).toBe(1);
    expect([...c.setvar.keys()]).toEqual(['B']);
  });

  it('bắt được lệch ở addvar sau khi đổi tên — ca thật của lỗ hổng', () => {
    // Giả cảnh bản cũ: setvar đã đổi tên, addvar bị bỏ sót.
    const before = '{{setvar::好感度::0}}{{addvar::好感度::1}}';
    const halfDone = '{{setvar::affection::0}}{{addvar::好感度::1}}';
    const issues = validateMacroParity(before, halfDone, { '好感度': 'affection' });
    expect(issues.length, 'phải phát hiện addvar chưa được đổi tên').toBeGreaterThan(0);
    expect(issues.some((i) => i.name === '好感度' || i.name === 'affection')).toBe(true);
  });

  it('đổi tên ĐẦY ĐỦ thì hàng rào im lặng (không báo oan)', () => {
    const before = '{{setvar::好感度::0}}{{addvar::好感度::1}}{{getglobalvar::好感度}}';
    const after = applyVarRenames(before, dict);
    expect(validateMacroParity(before, after, dict)).toEqual([]);
  });
});
