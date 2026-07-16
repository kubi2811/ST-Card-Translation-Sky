// bugNeedFix/31 — surgical: phát hiện đụng độ định danh (khác nguồn → cùng bản dịch).
import { describe, it, expect } from 'vitest';
import { detectSurgicalIdentifierCollisions, type CJKToken } from '../surgical';

function tok(over: Partial<CJKToken> & { text: string; translated?: string }): CJKToken {
  return { id: 0, start: 0, end: 0, isObjectKey: true, ...over };
}

describe('detectSurgicalIdentifierCollisions — bug 女/男 cùng dịch "Nhân Vật Nam"', () => {
  it('2 khóa nguồn KHÁC NHAU → CÙNG bản dịch → báo đụng độ', () => {
    const c = detectSurgicalIdentifierCollisions([
      tok({ text: '男性角色', translated: 'Nhân Vật Nam', isDotNotation: true }),
      tok({ text: '女性角色', translated: 'Nhân Vật Nam', isDotNotation: true }), // SAI — trùng Nam
      tok({ text: '世界', translated: 'Thế Giới', isDotNotation: true }),
    ]);
    expect(c.length).toBe(1);
    expect(c[0].translated).toBe('Nhân Vật Nam');
    expect(c[0].sources.sort()).toEqual(['女性角色', '男性角色']);
  });

  it('dịch ĐÚNG (Nam/Nữ khác nhau) → KHÔNG đụng độ', () => {
    expect(detectSurgicalIdentifierCollisions([
      tok({ text: '男性角色', translated: 'Nhân Vật Nam' }),
      tok({ text: '女性角色', translated: 'Nhân Vật Nữ' }),
    ])).toEqual([]);
  });

  it('CÙNG nguồn → cùng bản dịch (nhất quán) KHÔNG tính đụng độ', () => {
    expect(detectSurgicalIdentifierCollisions([
      tok({ text: '世界', translated: 'Thế Giới' }),
      tok({ text: '世界', translated: 'Thế Giới' }),
    ])).toEqual([]);
  });

  it('CHỈ xét token định danh (key/path/identifier/class/attr); prose trùng nghĩa bỏ qua', () => {
    expect(detectSurgicalIdentifierCollisions([
      tok({ text: '你好', translated: 'Xin chào', isObjectKey: false }), // prose
      tok({ text: '您好', translated: 'Xin chào', isObjectKey: false }),
    ])).toEqual([]);
  });

  it('token chưa dịch / giữ nguyên CJK → bỏ qua', () => {
    expect(detectSurgicalIdentifierCollisions([
      tok({ text: '甲', translated: '甲' }),
      tok({ text: '乙', translated: '' }),
    ])).toEqual([]);
  });

  it('nhóm 3 nguồn cùng dịch → gom đủ 3', () => {
    const c = detectSurgicalIdentifierCollisions([
      tok({ text: '上衣', translated: 'Áo' }),
      tok({ text: '下装', translated: 'Áo' }),
      tok({ text: '外套', translated: 'Áo' }),
    ]);
    expect(c[0].sources.length).toBe(3);
  });
});
