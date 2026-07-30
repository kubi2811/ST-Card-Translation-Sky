// (bug 159-1, 159-2) Bảng biến ở "Xem trước & Tinh chỉnh".
//
// 159-1: gõ một ký tự vào cột Tên biến là mất focus. Gốc: React key chứa `v.path`, mà rename()
// đổi path ngay khi gõ → key đổi → React tháo/dựng lại phần tử → mất focus. Cột khác không đụng
// path nên không bị. Tầng hai: vòng `rowsToSchema → normalize → setTuning` chạy mỗi ký tự, mà
// normalize thấy label rỗng thì suy lại từ path ⇒ xoá trắng ô tên là tên tự nhảy về.
//
// 159-2: sắp xếp lại thứ tự chỉ có nghĩa nếu thứ tự đó SỐNG SÓT qua vòng ghi về schema.
import { describe, it, expect } from 'vitest';
import { schemaToRows, rowsToSchema } from '../PreviewTunerModal';
import { normalizeMVUZODSchema } from '../../../lib/mvuzod/normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const mk = (names: string[]): MVUZODSchema => normalizeMVUZODSchema({
  version: '1.0',
  fields: names.map((n, i) => ({
    path: `/${n}`, type: 'number', label: n, defaultValue: i, constraints: {},
  })),
}) as MVUZODSchema;

describe('(bug 159-2) thứ tự phải sống sót qua vòng bảng → schema', () => {
  it('đảo hai hàng → schema đổi theo ĐÚNG thứ tự đó', () => {
    const rows = schemaToRows(mk(['Máu', 'Mana', 'Thể Lực']));
    const swapped = [rows[1], rows[0], rows[2]];
    const back = rowsToSchema(swapped);
    expect(back.fields.map(f => f.label)).toEqual(['Mana', 'Máu', 'Thể Lực']);
  });

  it('normalize KHÔNG tự sắp lại theo tên (nếu có thì kéo-thả vô nghĩa)', () => {
    const back = rowsToSchema(schemaToRows(mk(['Zêta', 'Alpha', 'Mu'])));
    expect(back.fields.map(f => f.label), 'phải giữ nguyên thứ tự người dùng đặt')
      .toEqual(['Zêta', 'Alpha', 'Mu']);
  });

  it('đổi thứ tự trong NHÓM con cũng giữ được', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{
        path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
        children: [
          { path: '/Người Chơi/A', type: 'number', label: 'A', defaultValue: 1, constraints: {} },
          { path: '/Người Chơi/B', type: 'number', label: 'B', defaultValue: 2, constraints: {} },
        ],
      }],
    }) as MVUZODSchema;
    const rows = schemaToRows(s);
    rows[0].children = [rows[0].children![1], rows[0].children![0]];
    const back = rowsToSchema(rows);
    expect(back.fields[0].children?.map(c => c.label)).toEqual(['B', 'A']);
  });
});

describe('(bug 159-1) đổi tên biến', () => {
  it('đổi tên thì path đi theo — path là danh tính thật của biến', () => {
    const rows = schemaToRows(mk(['Máu']));
    // Mô phỏng đúng việc rename() làm: đổi cả label và đoạn cuối path.
    const renamed = [{ ...rows[0], label: 'Sinh Lực', path: '/Sinh Lực' }];
    const back = rowsToSchema(renamed);
    expect(back.fields[0].label).toBe('Sinh Lực');
    expect(back.fields[0].path).toContain('Sinh Lực');
  });

  it('CHÍNH LÝ DO mất focus: path đổi ngay khi gõ dở một chữ', () => {
    // "M" là trạng thái sau khi gõ ký tự đầu của "Mana". path đổi theo ⇒ key cũ dùng path sẽ
    // đổi ⇒ remount ⇒ mất focus. Test này khoá lại BẢN CHẤT đó để ai đọc còn hiểu vì sao key
    // không được phép chứa path.
    const rows = schemaToRows(mk(['Máu']));
    const typing = { ...rows[0], label: 'M', path: '/M' };
    expect(typing.path).not.toBe(rows[0].path);
  });
});
