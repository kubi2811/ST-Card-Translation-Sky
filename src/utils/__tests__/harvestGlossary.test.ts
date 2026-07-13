import { describe, it, expect } from 'vitest';
import { harvestGlossaryFromFields } from '../nameGlossary';
import type { TranslationField } from '../../types/card';

/**
 * (User yêu cầu 2026) Từ điển tự LỚN DẦN khi dịch: gặt tên/biệt danh từ keyword lorebook + tên thẻ
 * ĐÃ DỊCH. Test khoá: zip đúng khi số key khớp; bỏ khi lệch; chỉ nhận nguồn Hán → đích không Hán.
 */
function mkField(o: Partial<TranslationField>): TranslationField {
  return {
    path: 'x', label: 'x', group: 'lorebook_keys', original: '', translated: '',
    status: 'done', retries: 0, ...o,
  } as TranslationField;
}

describe('harvestGlossaryFromFields', () => {
  it('keyword lorebook khớp số lượng → zip từng cặp tên→biệt danh', () => {
    const g = harvestGlossaryFromFields([
      mkField({ original: '叶凡, 小凡', translated: 'Diệp Phàm, Tiểu Phàm' }),
    ]);
    const map = Object.fromEntries(g.map(e => [e.source, e.target]));
    expect(map['叶凡']).toBe('Diệp Phàm');
    expect(map['小凡']).toBe('Tiểu Phàm');
    expect(g.every(e => e.origin === 'harvest' && e.auto)).toBe(true);
  });

  it('số key nguồn ≠ đích → BỎ (không zip sai thứ tự)', () => {
    const g = harvestGlossaryFromFields([
      mkField({ original: '叶凡, 小凡, 凡哥', translated: 'Diệp Phàm, Tiểu Phàm' }),
    ]);
    expect(g.length).toBe(0);
  });

  it('tên thẻ (core.name) Hán → bản dịch được gặt', () => {
    const g = harvestGlossaryFromFields([
      mkField({ path: 'data.name', group: 'core', original: '青云', translated: 'Thanh Vân' }),
    ]);
    expect(g).toEqual([{ source: '青云', target: 'Thanh Vân', auto: true, origin: 'harvest' }]);
  });

  it('đích còn chữ Hán (chưa dịch) → bỏ; nguồn không Hán (đã Latin) → bỏ', () => {
    const g = harvestGlossaryFromFields([
      mkField({ original: '叶凡, Bob', translated: '叶凡, Bob' }), // cả 2 cặp đều bị loại
    ]);
    expect(g.length).toBe(0);
  });

  it('field chưa done → bỏ qua', () => {
    const g = harvestGlossaryFromFields([
      mkField({ status: 'pending', original: '叶凡', translated: 'Diệp Phàm' }),
    ]);
    expect(g.length).toBe(0);
  });

  it('khử trùng nguồn (xuất hiện nhiều field) → chỉ 1 mục', () => {
    const g = harvestGlossaryFromFields([
      mkField({ original: '叶凡', translated: 'Diệp Phàm' }),
      mkField({ path: 'data.name', group: 'core', original: '叶凡', translated: 'Diep Fan' }),
    ]);
    expect(g.filter(e => e.source === '叶凡').length).toBe(1);
  });
});
