// (User 21/07 — bug 72.2) "Opening Form giao diện chạy preview hơi sơ sài: chỉ có nút bắt
// đầu và xác nhận, chưa có nhập thông tin."
// Gốc rễ: AI trả schema PHẲNG (quan hệ cha-con chỉ nằm trong `path`, không có `children`),
// mà buildOpeningForm lại duyệt `children` để dựng trang nhập → mọi field gốc thành section
// rỗng → bị `continue` bỏ qua → form còn đúng trang bìa + trang xác nhận.
import { describe, it, expect } from 'vitest';
import { nestFlatSchema, normalizeMVUZODSchema } from '../normalizeSchema';
import type { MVUZODField } from '../../../types';

const leaf = (path: string, type = 'string'): MVUZODField =>
  ({ path, type, label: path.split('/').filter(Boolean).pop(), constraints: {}, defaultValue: '' } as MVUZODField);

/** Đếm field lá đúng cách buildOpeningForm đếm: duyệt children đệ quy. */
const countLeafs = (fields: MVUZODField[]): number =>
  fields.reduce((n, f) => n + (f.children?.length ? countLeafs(f.children) : 1), 0);

describe('nestFlatSchema — schema phẳng phải dựng lại thành cây', () => {
  it('ca bug 72: schema phẳng → có nhóm cha, form đếm được field nhập', () => {
    const flat = [
      leaf('/Nhân vật/Tên'),
      leaf('/Nhân vật/Cấp độ', 'number'),
      leaf('/Túi đồ/Vàng', 'number'),
    ];
    // Trước fix: 3 field gốc, không cái nào có children → 0 trang nhập.
    expect(flat.every(f => !f.children)).toBe(true);

    const nested = nestFlatSchema(flat);
    expect(nested).toHaveLength(2);
    expect(nested.map(f => f.label)).toEqual(['Nhân vật', 'Túi đồ']);
    expect(nested[0].children).toHaveLength(2);
    expect(nested[1].children).toHaveLength(1);
    expect(countLeafs(nested)).toBe(3); // không mất field nào
  });

  it('lồng nhiều tầng: /A/B/C dựng đủ A > B > C', () => {
    const nested = nestFlatSchema([leaf('/A/B/C')]);
    expect(nested[0].label).toBe('A');
    expect(nested[0].children![0].label).toBe('B');
    expect(nested[0].children![0].children![0].path).toBe('/A/B/C');
  });

  it('field lá 1 tầng được gom vào nhóm chung (không bị rơi khỏi form)', () => {
    const nested = nestFlatSchema([leaf('/Nhân vật/Tên'), leaf('/Ghi chú')]);
    const loose = nested.find(f => f.label === 'Thông tin chung');
    expect(loose?.children?.map(c => c.path)).toEqual(['/Ghi chú']);
    expect(countLeafs(nested)).toBe(2);
  });

  it('KHÔNG đụng vào schema vốn đã có children', () => {
    const already = [
      { path: '/Nhân vật', type: 'object', label: 'Nhân vật', constraints: {}, defaultValue: {},
        children: [leaf('/Nhân vật/Tên')] } as MVUZODField,
    ];
    expect(nestFlatSchema(already)).toBe(already);
  });

  it('schema toàn field 1 tầng (đã đúng dạng) giữ nguyên', () => {
    const flatTop = [leaf('/Nhân vật'), leaf('/Túi đồ')];
    expect(nestFlatSchema(flatTop)).toBe(flatTop);
  });

  it('normalizeMVUZODSchema tự nhóm lại — mọi consumer hưởng fix, không cần sửa chỗ gọi', () => {
    const s = normalizeMVUZODSchema({ fields: [{ path: '/Nhân vật/Tên', type: 'string' }] });
    expect(s.fields[0].label).toBe('Nhân vật');
    expect(s.fields[0].children).toHaveLength(1);
  });

  it('rác/rỗng không ném lỗi', () => {
    expect(nestFlatSchema([])).toEqual([]);
    expect(normalizeMVUZODSchema(null).fields).toEqual([]);
  });
});
