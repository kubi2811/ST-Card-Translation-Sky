import { describe, it, expect } from 'vitest';
import { buildMemoryBlock } from '../memoryContext';
import type { MemoryEntry } from '../../../store/memoryStore';

function mem(p: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: p.id ?? 'x', scope: p.scope ?? 'global', key: p.key ?? 'k', value: p.value ?? 'v',
    projectId: p.projectId, sessionId: p.sessionId,
    createdAt: p.createdAt ?? 0, updatedAt: p.updatedAt ?? 0, disabled: p.disabled ?? false,
  };
}

describe('buildMemoryBlock', () => {
  it('kho rỗng → chuỗi rỗng (không tốn token thừa)', () => {
    expect(buildMemoryBlock([])).toBe('');
  });

  it('mục disabled bị loại', () => {
    const out = buildMemoryBlock([mem({ key: 'A', value: 'giữ' }), mem({ key: 'B', value: 'bỏ', disabled: true })]);
    expect(out).toContain('giữ');
    expect(out).not.toContain('bỏ');
  });

  it('nhóm đúng 3 scope với nhãn riêng', () => {
    const out = buildMemoryBlock([
      mem({ scope: 'global', key: 'g', value: 'thói quen' }),
      mem({ scope: 'project', key: 'p', value: 'về thẻ' }),
      mem({ scope: 'session', key: 's', value: 'trong phiên' }),
    ]);
    expect(out).toContain('Thói quen của user');
    expect(out).toContain('Về thẻ đang làm');
    expect(out).toContain('Trong phiên này');
    expect(out.indexOf('thói quen')).toBeLessThan(out.indexOf('về thẻ'));
  });

  it('cắt còn top-N khi quá nhiều', () => {
    const many = Array.from({ length: 30 }, (_, i) => mem({ id: String(i), key: `k${i}`, value: `v${i}` }));
    const out = buildMemoryBlock(many, 5);
    expect(out.match(/^- /gm)?.length).toBe(5);
  });

  it('tất cả mục đều disabled → chuỗi rỗng', () => {
    expect(buildMemoryBlock([mem({ disabled: true })])).toBe('');
  });

  it('sortByRecent → giữ mục MỚI nhất, không phải mục cũ nhất khi cắt topN', () => {
    // Danh sách theo thứ tự chèn: cũ trước, mới sau (đúng như store trả khi query rỗng).
    const list = [
      mem({ id: '1', key: 'cu', value: 'cu-nhat', updatedAt: 100 }),
      mem({ id: '2', key: 'giua', value: 'o-giua', updatedAt: 200 }),
      mem({ id: '3', key: 'moi', value: 'moi-nhat', updatedAt: 300 }),
    ];

    // Không bật cờ → giữ nguyên thứ tự chèn, mục mới nhất bị cắt mất.
    const asIs = buildMemoryBlock(list, 1);
    expect(asIs).toContain('cu-nhat');
    expect(asIs).not.toContain('moi-nhat');

    // Bật cờ → mục mới nhất được ưu tiên.
    const recent = buildMemoryBlock(list, 1, true);
    expect(recent).toContain('moi-nhat');
    expect(recent).not.toContain('cu-nhat');
  });

  it('sortByRecent KHÔNG làm biến đổi mảng đầu vào', () => {
    const list = [
      mem({ id: '1', key: 'a', value: 'a', updatedAt: 100 }),
      mem({ id: '2', key: 'b', value: 'b', updatedAt: 300 }),
    ];
    buildMemoryBlock(list, 12, true);
    expect(list.map(m => m.id)).toEqual(['1', '2']);
  });
});
