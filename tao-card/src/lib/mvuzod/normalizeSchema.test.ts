// Bug 19/07: Auto Creator crash "Cannot read properties of undefined (reading 'enumValues')" —
// schema AI sinh ra thiếu key `constraints` (type khai bắt buộc nhưng JSON.parse + cast thô không
// kiểm), consumer đầu tiên đọc field.constraints.enumValues là sập. Test khoá normalizer tại biên
// + chứng minh đường crash cũ hết sập với schema "bẩn" đúng kiểu AI hay trả.
import { describe, it, expect } from 'vitest';
import { normalizeMVUZODSchema, normalizeMVUZODField } from './normalizeSchema';
import { schemaToZodCode } from './schemaInferencer';
import { buildSchemaContextForBatch } from './schemaContextBuilder';
import type { MVUZODSchema } from '../../types/mvuzod.types';

/** Schema "bẩn" đúng kiểu AI hay trả: string/children thiếu constraints, enumValues là chuỗi. */
const DIRTY: unknown = {
  version: '1.0',
  fields: [
    { path: '/Người_Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 100 } },
    { path: '/Người_Chơi/Tên', type: 'string', label: 'Tên', defaultValue: 'A' }, // ← thiếu constraints
    {
      path: '/NPC', type: 'object', label: 'NPC', defaultValue: {},
      children: [
        { path: '/NPC/Tâm_Trạng', type: 'string', defaultValue: 'vui' }, // ← thiếu constraints + label
      ],
    },
    { path: '/Cảnh_Giới', type: 'string', defaultValue: '', constraints: { enumValues: 'Luyện Khí, Trúc Cơ, Kim Đan' } },
  ],
};

describe('normalizeMVUZODSchema — chốt chặn schema AI sinh', () => {
  const s = normalizeMVUZODSchema(DIRTY);

  it('mọi field (kể cả children) đều có constraints là object', () => {
    const walk = (fs: MVUZODSchema['fields']): boolean =>
      fs.every(f => !!f.constraints && typeof f.constraints === 'object' && (!f.children || walk(f.children)));
    expect(walk(s.fields)).toBe(true);
  });

  it('enumValues dạng chuỗi "a, b, c" được tách thành mảng', () => {
    const cg = s.fields.find(f => f.path === '/Cảnh_Giới')!;
    expect(cg.constraints.enumValues).toEqual(['Luyện Khí', 'Trúc Cơ', 'Kim Đan']);
  });

  it('label thiếu được suy từ path; defaultValue thiếu được suy từ type', () => {
    const child = s.fields.find(f => f.path === '/NPC')!.children![0];
    expect(child.label).toBe('Tâm_Trạng');
    const f = normalizeMVUZODField({ path: '/X', type: 'number' });
    expect(f.defaultValue).toBe(0);
  });

  it('input rác (null/mảng fields hỏng) không ném lỗi, trả schema rỗng hợp lệ', () => {
    expect(normalizeMVUZODSchema(null).fields).toEqual([]);
    expect(normalizeMVUZODSchema({ fields: 'x' }).fields).toEqual([]);
  });
});

describe('đường crash cũ hết sập với schema bẩn đã normalize', () => {
  const s = normalizeMVUZODSchema(DIRTY);

  it('schemaToZodCode (điểm crash schemaInferencer) chạy trọn', () => {
    const code = schemaToZodCode(s, 'TestCard');
    expect(code).toContain('z.');
    expect(code).toContain('Luyện Khí'); // enum đã vào code
  });

  it('buildSchemaContextForBatch (điểm crash schemaContextBuilder) chạy trọn', () => {
    const ctx = buildSchemaContextForBatch(s);
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('guard ?. phòng thủ: schema CŨ trong DB chưa normalize cũng không sập nữa', () => {
    // gọi thẳng với schema bẩn KHÔNG normalize — nhờ optional chaining vẫn sống
    expect(() => schemaToZodCode(DIRTY as MVUZODSchema, 'X')).not.toThrow();
    expect(() => buildSchemaContextForBatch(DIRTY as MVUZODSchema)).not.toThrow();
  });
});

// (Goal 28/07) Ràng buộc mềm giữa chỉ số liên quan: chốt chặn statRelations do AI sinh.
describe('normalizeStatRelations — lọc relation bẩn, gỡ trần trường phụ thuộc', () => {
  const RAW = {
    version: '1.0',
    fields: [
      {
        path: '/NV', type: 'object', label: 'NV', defaultValue: {}, constraints: {},
        children: [
          { path: '/NV/Cấp', type: 'number', label: 'Cấp', defaultValue: 1, constraints: { min: 1, max: 10 } },
          { path: '/NV/Năng lượng', type: 'number', label: 'Năng lượng', defaultValue: 10, constraints: { min: 0, max: 100 } },
          { path: '/NV/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
        ],
      },
    ],
    statRelations: [
      // hợp lệ: neo số theo khoảng, có basis + landmark dùng được (min "5" dạng chuỗi phải được ép số)
      {
        anchorPath: 'NV/Cấp', dependentPath: '/NV/Năng lượng', basis: 'theo mô tả sức mạnh trong ý tưởng',
        landmarks: [{ anchor: [1, 10], plausibleMin: '5', plausibleMax: 200, note: 'cấp thấp chỉ nội khí mỏng' }],
      },
      // trùng cặp path → bỏ
      {
        anchorPath: '/NV/Cấp', dependentPath: 'NV/Năng lượng', basis: 'trùng',
        landmarks: [{ anchor: 1, plausibleMax: 9 }],
      },
      // path không tồn tại → bỏ
      { anchorPath: '/NV/Cấp', dependentPath: '/NV/Ma lực', basis: 'x', landmarks: [{ anchor: 1, plausibleMax: 9 }] },
      // dependent không phải số → bỏ
      { anchorPath: '/NV/Cấp', dependentPath: '/NV/Tên', basis: 'x', landmarks: [{ anchor: 1, plausibleMax: 9 }] },
      // thiếu basis → bỏ (căn cứ là bắt buộc — cảnh báo phải nói dựa vào đâu)
      { anchorPath: '/NV/Cấp', dependentPath: '/NV/Năng lượng', landmarks: [{ anchor: 1, plausibleMax: 9 }] },
      // landmark không có plausibleMin/Max nào là số → cả relation bị bỏ (không bịa khoảng)
      { anchorPath: '/NV/Cấp', dependentPath: '/NV/Năng lượng', basis: 'y', landmarks: [{ anchor: 2 }] },
    ],
  };
  const s = normalizeMVUZODSchema(RAW);

  it('chỉ giữ relation hợp lệ, path được chuẩn hoá, số dạng chuỗi được ép kiểu', () => {
    expect(s.statRelations).toHaveLength(1);
    const r = s.statRelations![0];
    expect(r.anchorPath).toBe('NV/Cấp');
    expect(r.dependentPath).toBe('NV/Năng lượng');
    expect(r.landmarks).toEqual([{ anchor: [1, 10], plausibleMin: 5, plausibleMax: 200, note: 'cấp thấp chỉ nội khí mỏng' }]);
  });

  it('trường PHỤ THUỘC được gỡ max/clamp (giữ min) — cảnh báo mềm thay cho kẹp cứng', () => {
    const dep = s.fields[0].children!.find(f => f.path === '/NV/Năng lượng')!;
    expect(dep.constraints.max).toBeUndefined();
    expect(dep.constraints.clamp).toBeUndefined();
    expect(dep.constraints.min).toBe(0);
    // trường NEO không bị đụng — thang cấp 1-10 vẫn nguyên
    const anchor = s.fields[0].children!.find(f => f.path === '/NV/Cấp')!;
    expect(anchor.constraints.max).toBe(10);
  });

  it('không có statRelations (hoặc toàn rác) → key vắng mặt, schema không đổi khác', () => {
    const clean = normalizeMVUZODSchema({ ...RAW, statRelations: undefined });
    expect(clean.statRelations).toBeUndefined();
    const dep = clean.fields[0].children!.find(f => f.path === '/NV/Năng lượng')!;
    expect(dep.constraints.max).toBe(100); // không relation thì không gỡ trần
  });
});
