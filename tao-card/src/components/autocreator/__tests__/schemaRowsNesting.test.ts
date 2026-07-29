// (bug 149b) Bảng bước 1 phải GIỮ CÂY LỒNG CẤP, không bóc phẳng thành danh sách lá.
//
// Bản cũ "đi xuyên qua" nhóm object nên bảng chỉ liệt kê lá — user phải tự đoán biến nào thuộc
// nhóm nào, trong khi đúng cái cây đó lại hiện rõ ràng ở bước tạo card (ảnh user gửi kèm hai
// cái để so sánh). Nguy hiểm hơn phần nhìn: chiều ghi ngược chỉ giữ children cho array/record,
// nên nếu bảng có nhóm thì mọi biến bên trong bị VỨT ngay khi ghi về schema.
import { describe, it, expect } from 'vitest';
import { schemaToRows, rowsToSchema } from '../PreviewTunerModal';
import { normalizeMVUZODSchema } from '../../../lib/mvuzod/normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    {
      path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        {
          path: '/Người Chơi/Thông Tin', type: 'object', label: 'Thông Tin', defaultValue: {}, constraints: {},
          children: [
            { path: '/Người Chơi/Thông Tin/Họ Tên', type: 'string', label: 'Họ Tên', defaultValue: 'A', constraints: {} },
            { path: '/Người Chơi/Thông Tin/Cấp', type: 'number', label: 'Cấp', defaultValue: 1, constraints: { min: 1, max: 99 } },
          ],
        },
        { path: '/Người Chơi/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: { min: 0, max: 100 } },
      ],
    },
    {
      path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
      children: [{ path: '/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} }],
    },
    { path: '/Ngày', type: 'number', label: 'Ngày', defaultValue: 1, constraints: {} },
  ],
}) as MVUZODSchema;

describe('(bug 149b) bảng bước 1 giữ cây lồng cấp', () => {
  it('nhóm object hiện thành HÀNG CHA, không bị bóc phẳng', () => {
    const rows = schemaToRows(SCHEMA);
    expect(rows.map(r => r.label)).toEqual(['Người Chơi', 'Kho Đồ', 'Ngày']);
    const player = rows[0];
    expect(player.type).toBe('object');
    expect(player.children?.map(c => c.label)).toEqual(['Thông Tin', 'Máu']);
  });

  it('lồng nhiều tầng vẫn giữ đủ', () => {
    const info = schemaToRows(SCHEMA)[0].children?.[0];
    expect(info?.label).toBe('Thông Tin');
    expect(info?.children?.map(c => c.label)).toEqual(['Họ Tên', 'Cấp']);
  });

  it('array vẫn chỉ lấy phần khai cấu trúc phần tử ("/_child/"), không lẫn với nhóm', () => {
    const bag = schemaToRows(SCHEMA)[1];
    expect(bag.type).toBe('array');
    expect(bag.children?.map(c => c.label)).toEqual(['Tên']);
  });

  it('ĐI VÀ VỀ không mất biến nào — đây là chỗ nguy hiểm nhất', () => {
    const back = rowsToSchema(schemaToRows(SCHEMA));
    const paths = (fs: MVUZODSchema['fields']): string[] =>
      fs.flatMap(f => [f.path, ...paths(f.children ?? [])]);
    const before = paths(SCHEMA.fields).sort();
    const after = paths(back.fields).sort();
    expect(after, 'mọi biến phải còn nguyên sau khi bảng ghi ngược về schema').toEqual(before);
  });

  it('ĐI VÀ VỀ giữ nguyên ràng buộc của biến trong nhóm', () => {
    const back = rowsToSchema(schemaToRows(SCHEMA));
    const find = (fs: MVUZODSchema['fields'], p: string): MVUZODSchema['fields'][number] | undefined => {
      for (const f of fs) {
        if (f.path === p) return f;
        const hit = find(f.children ?? [], p);
        if (hit) return hit;
      }
    };
    const lv = find(back.fields, '/Người Chơi/Thông Tin/Cấp');
    expect(lv?.type).toBe('number');
    expect(lv?.constraints?.min).toBe(1);
    expect(lv?.constraints?.max).toBe(99);
  });
});
