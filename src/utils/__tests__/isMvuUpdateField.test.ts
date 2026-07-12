import { describe, it, expect } from 'vitest';
import { isMvuUpdateField } from '../cardFields';

/**
 * Bug #13 (PhatSiz): ở "Dịch Nhẹ", entry [mvu update] (quy tắc cập nhật biến MVU) vẫn phải được
 * dịch — nhận diện qua entryType 'controller' (comment/tên khớp mvu_update) HOẶC marker trong content.
 */
describe('isMvuUpdateField (bug #13)', () => {
  it('entryType controller (comment/tên [mvu_update]) → true', () => {
    expect(isMvuUpdateField({ entryType: 'controller', original: '规则规则' })).toBe(true);
  });

  it('marker [mvu_update] trong content → true', () => {
    expect(isMvuUpdateField({ entryType: 'narrative', original: '[mvu_update]变量更新规则\n...' })).toBe(true);
  });

  it('marker [mvu update] (viết cách như bug mô tả) → true', () => {
    expect(isMvuUpdateField({ entryType: undefined, original: 'abc [MVU Update] def' })).toBe(true);
  });

  it('entry thường (narrative, không marker) → false', () => {
    expect(isMvuUpdateField({ entryType: 'narrative', original: '这是一段普通的世界观描述。' })).toBe(false);
  });

  it('initvar KHÔNG bị coi là mvu update (giữ nguyên tiếng gốc ở Dịch Nhẹ) → false', () => {
    expect(isMvuUpdateField({ entryType: 'initvar', original: '[initvar]\n武力: 10' })).toBe(false);
  });

  it('original rỗng/thiếu → false, không ném', () => {
    expect(isMvuUpdateField({ entryType: 'narrative', original: '' })).toBe(false);
    expect(isMvuUpdateField({ entryType: undefined, original: undefined as unknown as string })).toBe(false);
  });
});
