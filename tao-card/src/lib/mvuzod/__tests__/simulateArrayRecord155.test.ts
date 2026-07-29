// (bug 155-1) final_check báo oan "4 biến schema KHÔNG có trong initvar":
//   Kho Đồ.Tên · Kho Đồ.Số Lượng · Quan Hệ NPC.Hảo Cảm Tên · Quan Hệ NPC.Đánh Giá
//
// Toàn bộ đều là trường con của array/record. Bug 148-2 thêm children "_child" để KHAI CẤU TRÚC
// một phần tử; schemaLeafPaths thì đi xuyên vào mọi children nên tưởng đó là biến phải có sẵn.
// Nhưng `Kho Đồ: []` rỗng thì đương nhiên chưa có `Kho Đồ.Tên` — phần tử chỉ sinh ra khi chơi.
//
// Hậu quả không chỉ là một dòng đỏ: "Vá lỗi" không tự sửa nổi (vì không có gì để sửa) nên trả
// về "cần xử lý tay" — đúng thứ user muốn dẹp.
import { describe, it, expect } from 'vitest';
import { schemaLeafPaths, simulateCard } from '../simulateCard';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    { path: '/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: {} },
    {
      path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
      children: [
        { path: '/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
        { path: '/Kho Đồ/_child/Số Lượng', type: 'number', label: 'Số Lượng', defaultValue: 1, constraints: {} },
      ],
    },
    {
      path: '/Quan Hệ NPC', type: 'record', label: 'Quan Hệ NPC', defaultValue: {}, constraints: {},
      children: [
        { path: '/Quan Hệ NPC/_child/Hảo Cảm', type: 'number', label: 'Hảo Cảm', defaultValue: 0, constraints: {} },
      ],
    },
  ],
}) as MVUZODSchema;

describe('(bug 155-1) trường con của array/record không phải biến bắt buộc trong initvar', () => {
  it('schemaLeafPaths KHÔNG đi xuyên vào "_child"', () => {
    const paths = schemaLeafPaths(SCHEMA).map(l => l.path);
    expect(paths, 'array: phải đòi chính cái thùng chứa').toContain('Kho Đồ');
    expect(paths).not.toContain('Kho Đồ.Tên');
    expect(paths).not.toContain('Kho Đồ.Số Lượng');
    // record là túi khoá động — không đòi khai sẵn, kể cả chính cái túi (hợp đồng có từ trước).
    expect(paths).not.toContain('Quan Hệ NPC');
    expect(paths).not.toContain('Quan Hệ NPC.Hảo Cảm');
  });

  it('initvar khai `Kho Đồ: []` và `Quan Hệ NPC: {}` → KHÔNG còn báo thiếu biến', () => {
    const r = simulateCard({
      schema: SCHEMA,
      initVarContent: 'Máu: 100\nKho Đồ: []\nQuan Hệ NPC: {}\n',
    });
    const miss = r.issues.filter(i => i.code === 'sim-missing-in-initvar');
    expect(miss.map(m => m.message), 'không được báo oan').toEqual([]);
  });

  it('nhưng THIẾU HẲN thùng chứa thì VẪN phải báo — đây mới là lỗi thật', () => {
    const r = simulateCard({ schema: SCHEMA, initVarContent: 'Máu: 100\n' });
    const miss = r.issues.filter(i => i.code === 'sim-missing-in-initvar');
    expect(miss.length, 'thiếu mảng Kho Đồ là lỗi thật').toBeGreaterThan(0);
    expect(miss[0].message).toContain('Kho Đồ');
  });

  it('nhóm object thường thì VẪN đi xuyên như cũ (không hồi quy)', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{
        path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
        children: [{ path: '/Người Chơi/Máu', type: 'number', label: 'Máu', defaultValue: 10, constraints: {} }],
      }],
    }) as MVUZODSchema;
    expect(schemaLeafPaths(s).map(l => l.path)).toContain('Người Chơi.Máu');
  });
});
