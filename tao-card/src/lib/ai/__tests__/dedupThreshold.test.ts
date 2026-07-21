// (User 21/07 — bug 71) Auto Creator tạo quá ít lorebook entry.
// Thủ phạm ăn entry nhiều nhất: dedup layer-1 ngưỡng 0.5 với mẫu số max(size) —
// entry 2 key chỉ cần TRÙNG 1 key với entry cũ là bị loại. Thế giới nhiều phe phái/NPC
// hay dùng chung một tên riêng ⇒ rơi hàng loạt, kế hoạch 20 entry còn 6-10.
import { describe, it, expect } from 'vitest';
import { checkKeyOverlap } from '../deduplicator';
import type { LorebookEntry } from '../../../types';

const entry = (comment: string, keys: string[]): LorebookEntry =>
  ({ comment, keys, content: 'x', enabled: true } as unknown as LorebookEntry);

describe('checkKeyOverlap — không loại nhầm thực thể khác nhau', () => {
  const existing = [entry('Thiên Kiếm Tông', ['Thiên Kiếm Tông', 'tông môn'])];

  it('THỰC THỂ KHÁC chỉ chạm 1 key chung → KHÔNG bị coi là trùng (đúng ca bug 71)', () => {
    // Trưởng lão là thực thể riêng, chỉ tình cờ cùng nhắc tên tông môn
    const r = checkKeyOverlap(['Trưởng lão Hạc', 'Thiên Kiếm Tông'], existing);
    expect(r.isDuplicate).toBe(false);
  });

  it('nhiều NPC cùng một phe → mỗi người vẫn giữ được entry riêng', () => {
    const list = [existing[0]];
    for (const npc of ['Lý Mộ Vân', 'Trần Tú', 'Vương Hạo']) {
      const r = checkKeyOverlap([npc, 'Thiên Kiếm Tông'], list);
      expect(r.isDuplicate, `${npc} bị loại oan`).toBe(false);
      list.push(entry(npc, [npc, 'Thiên Kiếm Tông']));
    }
    expect(list).toHaveLength(4);
  });

  it('VẪN loại đúng khi thật sự là một thực thể (trùng gần hết key)', () => {
    const r = checkKeyOverlap(['Thiên Kiếm Tông', 'tông môn'], existing);
    expect(r.isDuplicate).toBe(true);
    expect(r.conflictWith).toBe('Thiên Kiếm Tông');
  });

  it('VẪN loại đúng khi key trùng y hệt (1 key duy nhất, giống nhau)', () => {
    const r = checkKeyOverlap(['Thiên Kiếm Tông'], [entry('TKT', ['Thiên Kiếm Tông'])]);
    expect(r.isDuplicate).toBe(true);
  });

  it('không key → không loại', () => {
    expect(checkKeyOverlap([], existing).isDuplicate).toBe(false);
  });
});
