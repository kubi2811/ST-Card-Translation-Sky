import { describe, it, expect } from 'vitest';
import { buildMemoryBlock } from '../memoryContext';
import type { MemoryEntry } from '../../../store/memoryStore';

function mem(p: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: p.id ?? 'x', scope: p.scope ?? 'global', key: p.key ?? 'k', value: p.value ?? 'v',
    projectId: p.projectId, sessionId: p.sessionId,
    createdAt: 0, updatedAt: 0, disabled: p.disabled ?? false,
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
});
