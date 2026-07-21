// (User 21/07) Nhập/gộp từ điển giữa Dịch Card ↔ Dịch Script.
// Hợp đồng quan trọng nhất: bộ XUẤT ra từ Dịch Card phải NHẬP thẳng được vào Dịch Script.
// Và gộp KHÔNG ĐƯỢC ghi đè mục user đã sửa tay ở bảng đích.
import { describe, it, expect } from 'vitest';
import { parseGlossaryJson, mergeGlossaries, countUsable, hasNewEntries, glossaryToJson } from '../glossaryIO';
import type { GlossaryEntry } from '../../types/card';

describe('parseGlossaryJson — đọc được đúng thứ Dịch Card xuất ra + các dạng dễ gặp', () => {
  it('ĐÚNG format xuất của Dịch Card (round-trip)', () => {
    const src: GlossaryEntry[] = [{ source: '秋青子', target: 'Thu Thanh Tử' }, { source: '明月', target: 'Minh Nguyệt' }];
    const parsed = parseGlossaryJson(glossaryToJson(src));
    expect(parsed).toEqual(src);
  });

  it('object phẳng { hán: việt }', () => {
    expect(parseGlossaryJson('{"秋青子":"Thu Thanh Tử"}')).toEqual([{ source: '秋青子', target: 'Thu Thanh Tử' }]);
  });

  it('mảng cặp [[hán, việt]]', () => {
    expect(parseGlossaryJson('[["明月","Minh Nguyệt"]]')).toEqual([{ source: '明月', target: 'Minh Nguyệt' }]);
  });

  it('bọc trong khoá glossary/entries', () => {
    expect(parseGlossaryJson('{"glossary":[{"source":"雪乃","target":"Yukino"}]}')).toEqual([{ source: '雪乃', target: 'Yukino' }]);
  });

  it('khoá viết kiểu khác (zh/vi, from/to, term/translation)', () => {
    const r = parseGlossaryJson('[{"zh":"甲","vi":"A"},{"from":"乙","to":"B"},{"term":"丙","translation":"C"}]');
    expect(r).toEqual([{ source: '甲', target: 'A' }, { source: '乙', target: 'B' }, { source: '丙', target: 'C' }]);
  });

  it('bỏ mục thiếu vế + cắt khoảng trắng thừa', () => {
    const r = parseGlossaryJson('[{"source":" 甲 ","target":" A "},{"source":"乙","target":""},{"source":"","target":"C"}]');
    expect(r).toEqual([{ source: '甲', target: 'A' }]);
  });

  it('JSON hỏng → BAD_JSON; JSON hợp lệ nhưng rỗng nội dung → NO_ENTRIES', () => {
    expect(() => parseGlossaryJson('{lỗi')).toThrow('BAD_JSON');
    expect(() => parseGlossaryJson('[]')).toThrow('NO_ENTRIES');
    expect(() => parseGlossaryJson('{"a":1,"b":2}')).toThrow('NO_ENTRIES');
  });
});

describe('mergeGlossaries — KHÔNG ghi đè bảng đích', () => {
  const base: GlossaryEntry[] = [{ source: '秋青子', target: 'Thu Thanh Tử' }];

  it('thêm mục mới, đếm đúng', () => {
    const r = mergeGlossaries(base, [{ source: '明月', target: 'Minh Nguyệt' }]);
    expect(r.added).toBe(1);
    expect(r.merged).toHaveLength(2);
  });

  it('trùng source + dịch KHÁC → giữ bản đang có, chỉ đếm xung đột (user đã sửa tay)', () => {
    const r = mergeGlossaries(base, [{ source: '秋青子', target: 'Thu Thanh Tu' }]);
    expect(r.conflicts).toBe(1);
    expect(r.added).toBe(0);
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].target).toBe('Thu Thanh Tử'); // bản gốc thắng
  });

  it('trùng y hệt → im lặng bỏ qua', () => {
    const r = mergeGlossaries(base, [{ source: '秋青子', target: 'Thu Thanh Tử' }]);
    expect(r.duplicates).toBe(1);
    expect(r.merged).toHaveLength(1);
  });

  it('gộp 2 lần liên tiếp không đẻ thêm mục (idempotent)', () => {
    const once = mergeGlossaries(base, [{ source: '明月', target: 'Minh Nguyệt' }]).merged;
    const twice = mergeGlossaries(once, [{ source: '明月', target: 'Minh Nguyệt' }]).merged;
    expect(twice).toHaveLength(once.length);
  });
});

describe('countUsable / hasNewEntries — quyết định có nên hỏi user không', () => {
  it('chỉ đếm mục đủ 2 vế', () => {
    expect(countUsable([{ source: '甲', target: 'A' }, { source: '乙', target: '' }, { source: '', target: 'C' }])).toBe(1);
  });

  it('không còn mục mới → KHÔNG hỏi lại (trả lời Không một lần là yên)', () => {
    const base = [{ source: '甲', target: 'A' }];
    expect(hasNewEntries(base, [{ source: '乙', target: 'B' }])).toBe(true);
    expect(hasNewEntries(base, [{ source: '甲', target: 'A' }])).toBe(false);
    expect(hasNewEntries(base, [{ source: '乙', target: '' }])).toBe(false); // thiếu vế → không tính
  });
});
