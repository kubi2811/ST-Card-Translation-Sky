// (bug 155-1) "Vá lỗi" luôn kết thúc bằng "không có lỗi nào tự vá được bằng máy".
// Lý do: simulateCard SINH RA `sim-missing-in-initvar` nhưng KHÔNG NƠI NÀO vá nó — dù thiếu một
// dòng `Kho Đồ: []` thì máy thừa sức tự điền.
import { describe, it, expect } from 'vitest';
import { repairMissingInitvarLeaves } from '../cardAutoRepair';
import { normalizeMVUZODSchema } from '../../mvuzod/normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { LorebookEntry } from '../../../types/lorebook.types';

const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    { path: '/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: {} },
    { path: '/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
    {
      path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
      children: [{ path: '/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} }],
    },
    { path: '/Quan Hệ NPC', type: 'record', label: 'Quan Hệ NPC', defaultValue: {}, constraints: {} },
  ],
}) as MVUZODSchema;

const initEntry = (content: string): LorebookEntry =>
  ({ comment: '[initvar] Khởi tạo', content } as unknown as LorebookEntry);

describe('(bug 155-1) tự điền biến còn thiếu vào [initvar]', () => {
  it('thiếu mảng → thêm `Kho Đồ: []`', () => {
    const r = repairMissingInitvarLeaves([initEntry('<initvar>\nMáu: 100\nTên: ""\n</initvar>')], SCHEMA);
    expect(r.fixed.length).toBe(1);
    expect(r.fixed[0].id, 'phải khớp mã lỗi mà báo cáo nêu ra').toBe('sim-missing-in-initvar');
    expect(r.entries[0].content).toContain('Kho Đồ: []');
  });

  it('chèn TRƯỚC thẻ đóng — biến phải nằm trong cây, không rơi ra ngoài', () => {
    const r = repairMissingInitvarLeaves([initEntry('<initvar>\nMáu: 100\n</initvar>')], SCHEMA);
    const c = r.entries[0].content;
    expect(c.indexOf('Kho Đồ')).toBeLessThan(c.indexOf('</initvar>'));
  });

  it('record là túi khoá động → KHÔNG tự thêm (giữ hợp đồng có sẵn)', () => {
    const r = repairMissingInitvarLeaves([initEntry('<initvar>\nMáu: 100\n</initvar>')], SCHEMA);
    expect(r.entries[0].content).not.toContain('Quan Hệ NPC');
  });

  it('đã đủ biến → không đụng vào, không báo vá khống', () => {
    const full = '<initvar>\nMáu: 100\nTên: ""\nKho Đồ: []\n</initvar>';
    const r = repairMissingInitvarLeaves([initEntry(full)], SCHEMA);
    expect(r.fixed).toEqual([]);
    expect(r.entries[0].content).toBe(full);
  });

  it('entry KHÔNG phải initvar thì không đụng tới', () => {
    const e = { comment: 'Lore thường', content: 'nội dung' } as unknown as LorebookEntry;
    const r = repairMissingInitvarLeaves([e], SCHEMA);
    expect(r.fixed).toEqual([]);
    expect(r.entries[0].content).toBe('nội dung');
  });

  it('không có schema → không làm gì (đừng đoán mò)', () => {
    const r = repairMissingInitvarLeaves([initEntry('<initvar>\n</initvar>')], null);
    expect(r.fixed).toEqual([]);
  });
});
