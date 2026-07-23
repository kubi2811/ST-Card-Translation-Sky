import { describe, it, expect } from 'vitest';
import { findCrossStrategyConflicts, unifyCrossStrategyDicts } from '../crossStrategySync';

/**
 * (User 2026 — việc 79) Chiến lược B và C dựng từ điển ĐỘC LẬP, không bên nào thấy bên kia.
 * Cùng một từ gốc ra hai bản dịch lệch nhau → biến MVU tên một đằng, tên mục/từ khoá EJS
 * gọi một nẻo → card gãy. Bộ này bắc cầu và thống nhất về một bản.
 */

describe('findCrossStrategyConflicts — dò lệch pha giữa hai chiến lược', () => {
  it('cùng từ gốc, hai bên dịch KHÁC nhau → báo lệch', () => {
    const c = findCrossStrategyConflicts(
      { '修为': 'Tu Vi' },
      { '修为': 'Cảnh Giới' },
      {},
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ source: '修为', side: 'entry', mvuValue: 'Tu Vi', ejsValue: 'Cảnh Giới' });
  });

  it('cùng từ gốc, hai bên dịch GIỐNG nhau → không báo gì', () => {
    expect(findCrossStrategyConflicts({ '修为': 'Tu Vi' }, { '修为': 'Tu Vi' }, {})).toHaveLength(0);
  });

  it('từ chỉ có ở một bên → không phải việc của bộ này', () => {
    expect(findCrossStrategyConflicts({ '修为': 'Tu Vi' }, { '灵石': 'Linh Thạch' }, {})).toHaveLength(0);
  });

  it('lệch ở từ điển TỪ KHOÁ cũng bắt được, và ghi đúng side', () => {
    const c = findCrossStrategyConflicts({ '灵石': 'Linh Thạch' }, {}, { '灵石': 'Đá Linh' });
    expect(c).toHaveLength(1);
    expect(c[0].side).toBe('keyword');
  });

  it('bản C thừa nháy/khoảng trắng nhưng cùng chữ → KHÔNG báo lệch giả', () => {
    expect(findCrossStrategyConflicts({ '修为': 'Tu Vi' }, { '修为': '  "Tu Vi"  ' }, {})).toHaveLength(0);
  });

  it('key gốc lệch vỏ (HP vs hp) vẫn coi là cùng từ', () => {
    const c = findCrossStrategyConflicts({ 'HP': 'Máu' }, {}, { 'hp': 'Sinh Lực' });
    expect(c).toHaveLength(1);
    expect(c[0].mvuValue).toBe('Máu');
  });

  it('từ điển B rỗng → thoát sớm, không báo gì', () => {
    expect(findCrossStrategyConflicts({}, { '修为': 'Cảnh Giới' }, {})).toHaveLength(0);
  });
});

describe('luật chọn bản chuẩn', () => {
  it('mặc định lấy bản B (tên biến MVU ảnh hưởng rộng hơn)', () => {
    const c = findCrossStrategyConflicts({ '修为': 'Tu Vi' }, { '修为': 'Cảnh Giới' }, {});
    expect(c[0].winner).toBe('B');
    expect(c[0].unified).toBe('Tu Vi');
  });

  it('bên nào CÒN CHỮ HÁN là dịch sót → bên đã dịch thắng, kể cả khi đó là C', () => {
    const c = findCrossStrategyConflicts({ '修为': '修为' }, { '修为': 'Cảnh Giới' }, {});
    expect(c[0].winner).toBe('C');
    expect(c[0].unified).toBe('Cảnh Giới');
    expect(c[0].reason).toContain('chữ Hán');
  });

  it('bản B rỗng → lấy bản C', () => {
    const c = findCrossStrategyConflicts({ '修为': '   ' }, { '修为': 'Cảnh Giới' }, {});
    expect(c[0].winner).toBe('C');
  });

  it('chỉ lệch hoa/thường → lấy dạng B (B đã ép in hoa theo schema Zod — bug "Cảnh Giới"/"Cảnh giới")', () => {
    const c = findCrossStrategyConflicts({ '境界': 'Cảnh Giới' }, { '境界': 'cảnh giới' }, {});
    expect(c[0].winner).toBe('B');
    expect(c[0].unified).toBe('Cảnh Giới');
  });

  it('user KHOÁ từ điển B → luôn lấy B, kể cả khi B còn chữ Hán', () => {
    const c = findCrossStrategyConflicts(
      { '修为': '修为' },
      { '修为': 'Cảnh Giới' },
      {},
      { mvuDictLocked: true },
    );
    expect(c[0].winner).toBe('B');
    expect(c[0].reason).toContain('khoá');
  });
});

describe('unifyCrossStrategyDicts — ghi bản thắng vào CẢ HAI phía', () => {
  it('ghi bản B sang dict C, đếm đúng số ô đã sửa', () => {
    const r = unifyCrossStrategyDicts({ '修为': 'Tu Vi' }, { '修为': 'Cảnh Giới' }, {});
    expect(r.ejsEntryNameDict['修为']).toBe('Tu Vi');
    expect(r.mvuDictionary['修为']).toBe('Tu Vi');
    expect(r.fixedCount).toBe(1);
  });

  it('khi C thắng thì dict B cũng bị ghi lại theo C', () => {
    const r = unifyCrossStrategyDicts({ '修为': '修为' }, { '修为': 'Cảnh Giới' }, {});
    expect(r.mvuDictionary['修为']).toBe('Cảnh Giới');
    expect(r.ejsEntryNameDict['修为']).toBe('Cảnh Giới');
  });

  it('key lệch vỏ vẫn ghi đúng ô bên B (HP) chứ không tạo key mới', () => {
    const r = unifyCrossStrategyDicts({ 'HP': 'Máu' }, {}, { 'hp': 'Sinh Lực' });
    expect(r.mvuDictionary['HP']).toBe('Máu');
    expect(r.ejsKeywordDict['hp']).toBe('Máu');
    expect(Object.keys(r.mvuDictionary)).toEqual(['HP']);
  });

  it('không lệch gì → giữ nguyên, fixedCount = 0', () => {
    const mvu = { '修为': 'Tu Vi' };
    const r = unifyCrossStrategyDicts(mvu, { '修为': 'Tu Vi' }, { '灵石': 'Linh Thạch' });
    expect(r.fixedCount).toBe(0);
    expect(r.conflicts).toHaveLength(0);
    expect(r.mvuDictionary).toEqual(mvu);
  });

  it('KHÔNG sửa vào object gốc (tránh mutate state zustand)', () => {
    const mvu = { '修为': 'Tu Vi' };
    const ejs = { '修为': 'Cảnh Giới' };
    unifyCrossStrategyDicts(mvu, ejs, {});
    expect(ejs['修为']).toBe('Cảnh Giới');
    expect(mvu['修为']).toBe('Tu Vi');
  });

  it('nhiều từ lệch cùng lúc, cả entry lẫn keyword → thống nhất hết', () => {
    const r = unifyCrossStrategyDicts(
      { '修为': 'Tu Vi', '灵石': 'Linh Thạch', '好感度': 'Hảo Cảm' },
      { '修为': 'Cảnh Giới' },
      { '灵石': 'Đá Linh', '好感度': 'Hảo Cảm' },
    );
    expect(r.conflicts).toHaveLength(2);
    expect(r.ejsEntryNameDict['修为']).toBe('Tu Vi');
    expect(r.ejsKeywordDict['灵石']).toBe('Linh Thạch');
    expect(r.ejsKeywordDict['好感度']).toBe('Hảo Cảm');
  });

  it('dict undefined/null → không nổ', () => {
    const r = unifyCrossStrategyDicts(
      { '修为': 'Tu Vi' },
      undefined as unknown as Record<string, string>,
      null as unknown as Record<string, string>,
    );
    expect(r.fixedCount).toBe(0);
  });
});
