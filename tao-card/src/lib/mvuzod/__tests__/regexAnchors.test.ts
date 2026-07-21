import { describe, it, expect } from 'vitest';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../regexAnchors';

/**
 * (User 21/07) BUG: Regex "Status Bar" và "Opening Form" dùng CÙNG một Find Regex
 * `<StatusPlaceHolderImpl/>` → hai script đè nhau, cái nào chạy sau thắng.
 * Opening Form phải có mỏ neo RIÊNG, đặt trong First Message.
 */
describe('mỏ neo regex — Status Bar vs Opening Form phải KHÁC nhau', () => {
  it('hai mỏ neo không được trùng', () => {
    expect(OPENING_FORM_ANCHOR).not.toBe(STATUS_BAR_ANCHOR);
  });

  it('Status Bar giữ nguyên mỏ neo MVU chuẩn (MVU tự chèn thẻ này vào output AI)', () => {
    expect(STATUS_BAR_ANCHOR).toBe('<StatusPlaceHolderImpl/>');
  });

  it('Opening Form dùng thẻ riêng, đúng dạng self-closing tag', () => {
    expect(OPENING_FORM_ANCHOR).toMatch(/^<[A-Za-z][\w]*\/>$/);
  });

  it('mỏ neo Opening Form không chứa chữ StatusPlaceHolder (tránh regex Status Bar quét trúng)', () => {
    expect(OPENING_FORM_ANCHOR).not.toContain('StatusPlaceHolder');
  });
});
