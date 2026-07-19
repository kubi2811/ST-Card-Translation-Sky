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
