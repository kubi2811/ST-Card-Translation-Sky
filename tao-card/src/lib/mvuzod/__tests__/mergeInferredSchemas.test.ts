// (bugNeedFix/99) Bước "Tổng hợp" của quét AI trước đây nhờ AI merge ⇒ output chạm trần token ⇒
// vòng "viết tiếp" gọi lại 4 lượt với lịch sử phình to ⇒ treo. Nay gộp bằng code: kiểm ở đây.
import { describe, it, expect } from 'vitest';
import { mergeInferredSchemas } from '../mergeInferredSchemas';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const s = (fields: unknown[]): MVUZODSchema => ({ version: '1.0', fields } as unknown as MVUZODSchema);

const BATCH_1 = s([
  {
    path: 'Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
    children: [
      { path: 'Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 10, max: 100 } },
      { path: 'Người Chơi/Cảnh Giới', type: 'string', label: 'Cảnh Giới', defaultValue: '', constraints: { enumValues: ['Luyện Khí', 'Trúc Cơ'] } },
    ],
  },
]);

const BATCH_2 = s([
  {
    path: 'Người Chơi', type: 'object', label: '', defaultValue: {}, constraints: {},
    children: [
      { path: 'Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 999, coerce: true } },
      { path: 'Người Chơi/Cảnh Giới', type: 'string', label: '', defaultValue: '', constraints: { enumValues: ['Trúc Cơ', 'Kim Đan'] } },
      { path: 'Người Chơi/Linh Thạch', type: 'number', label: 'Linh Thạch', defaultValue: 0, constraints: {} },
    ],
  },
  { path: 'Thế Giới', type: 'object', label: 'Thế Giới', defaultValue: {}, constraints: {}, children: [] },
]);

describe('Gộp schema nhiều batch — bằng code, không gọi AI', () => {
  const r = mergeInferredSchemas([BATCH_1, BATCH_2]);

  it('field trùng path được hợp nhất chứ không nhân đôi', () => {
    expect(r.schema.fields.map(f => f.path)).toEqual(['Người Chơi', 'Thế Giới']);
    const nc = r.schema.fields[0];
    expect(nc.children?.map(c => c.path)).toEqual([
      'Người Chơi/HP', 'Người Chơi/Cảnh Giới', 'Người Chơi/Linh Thạch',
    ]);
  });

  it('enum của 2 batch được gộp, bỏ trùng', () => {
    const cg = r.schema.fields[0].children!.find(c => c.path.endsWith('Cảnh Giới'))!;
    expect(cg.constraints.enumValues).toEqual(['Luyện Khí', 'Trúc Cơ', 'Kim Đan']);
  });

  it('biên số lấy rộng nhất, ràng buộc chỉ batch kia có thì vẫn giữ', () => {
    const hp = r.schema.fields[0].children!.find(c => c.path.endsWith('HP'))!;
    expect(hp.constraints.min).toBe(0);
    expect(hp.constraints.max).toBe(999);
    expect(hp.constraints.coerce).toBe(true);
  });

  it('nhãn rỗng ở batch sau không xoá nhãn đã có', () => {
    expect(r.schema.fields[0].label).toBe('Người Chơi');
  });

  it('báo đúng số batch đã dùng + số path hợp nhất', () => {
    expect(r.usedCount).toBe(2);
    expect(r.mergedPaths).toBe(1); // chỉ 'Người Chơi' trùng ở cấp cao nhất
  });
});

describe('Chống rác — batch hỏng không làm chết cả mẻ', () => {
  it('batch null/rỗng bị bỏ qua, phần còn lại vẫn ra schema', () => {
    const r = mergeInferredSchemas([null, BATCH_1, undefined, s([])]);
    expect(r.usedCount).toBe(1);
    expect(r.schema.fields.length).toBe(1);
  });

  it('không batch nào dùng được → schema rỗng + usedCount 0 (để UI báo lỗi rõ)', () => {
    const r = mergeInferredSchemas([null, s([])]);
    expect(r.usedCount).toBe(0);
    expect(r.schema.fields).toEqual([]);
  });

  it('một batch duy nhất → giữ nguyên, không đụng gì', () => {
    const r = mergeInferredSchemas([BATCH_1]);
    expect(r.schema.fields).toEqual(BATCH_1.fields);
    expect(r.mergedPaths).toBe(0);
  });

  it('gộp 30 batch vẫn tức thì (không gọi mạng)', () => {
    const many = Array.from({ length: 30 }, () => BATCH_2);
    const r = mergeInferredSchemas(many);
    expect(r.usedCount).toBe(30);
    expect(r.schema.fields.length).toBe(2);
  });
});
