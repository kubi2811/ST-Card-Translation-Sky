// (bug 148-2) Ba kiểu cấu trúc Object / Array / Record — từ bảng chỉnh tay tới Zod, prompt và
// bộ kiểm. User: "không tự ý gộp tất cả vào String như cách làm cũ".
import { describe, it, expect } from 'vitest';
import { auditCardQuality } from '../cardQualityAudit';
import { schemaToZodCode } from '../schemaInferencer';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import { repairQualityIssues } from '../../ai/cardAutoRepair';
import { buildMvuzodPrompt } from '../../ai/autoCreatorPrompts';
import { EJS_SYSTEM_PROMPT } from '../../../prompts/ejsPrompt';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { CharacterCardV3 } from '../../../types';

/** Schema có đủ 3 kiểu — array/record khai cấu trúc con bằng path "/_child/". */
const STRUCT_SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    {
      path: '/Người Chơi/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
      children: [
        { path: '/Người Chơi/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
        { path: '/Người Chơi/Kho Đồ/_child/Số Lượng', type: 'number', label: 'Số Lượng', defaultValue: 1, constraints: { min: 0 } },
      ],
    },
    {
      path: '/Quan Hệ NPC', type: 'record', label: 'Quan Hệ NPC', defaultValue: {}, constraints: {},
      children: [
        { path: '/Quan Hệ NPC/_child/Hảo Cảm', type: 'number', label: 'Hảo Cảm', defaultValue: 0, constraints: { min: -100, max: 100 } },
      ],
    },
  ],
}) as MVUZODSchema;

const mkCard = (schema: MVUZODSchema): CharacterCardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: 'T', character_book: { name: 'wb', entries: [] }, extensions: { mvuzod: { schema } } },
} as unknown as CharacterCardV3);

describe('(bug 148-2) Zod sinh đúng cho Array/Record có cấu trúc con', () => {
  it('array có children → z.array(z.object({...})) chứ KHÔNG phải mảng chuỗi', () => {
    const code = schemaToZodCode(STRUCT_SCHEMA, 'Card');
    expect(code).toContain('z.array(z.object(');
    expect(code).toContain('"Số Lượng"');
    expect(code).not.toMatch(/Kho Đồ[^\n]*z\.array\(z\.string\(\)\)/);
  });

  it('record có children → z.record(z.string(), z.object({...})) và prefault rỗng', () => {
    const code = schemaToZodCode(STRUCT_SCHEMA, 'Card');
    expect(code).toContain('z.record(');
    expect(code).toContain('"Hảo Cảm"');
    expect(code).toContain('.prefault({})');
  });

  it('array KHÔNG có children vẫn dựng được (mảng chuỗi) — tương thích ngược', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{ path: '/Ghi Chú', type: 'array', label: 'Ghi Chú', defaultValue: [], constraints: {} }],
    }) as MVUZODSchema;
    expect(schemaToZodCode(s, 'C')).toContain('z.array(z.string())');
  });
});

describe('(bug 148-2) audit cấu trúc', () => {
  it('array/record khai đủ cấu trúc con → KHÔNG báo gì', () => {
    const issues = auditCardQuality({ entries: [], schema: STRUCT_SCHEMA });
    expect(issues.filter(i => i.code.startsWith('struct-') || i.code === 'record-duplicate-key')).toEqual([]);
  });

  it('array/record THIẾU cấu trúc con → cảnh báo nói rõ hệ quả', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{ path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {} }],
    }) as MVUZODSchema;
    const issues = auditCardQuality({ entries: [], schema: s });
    const noChild = issues.filter(i => i.code === 'struct-no-child');
    expect(noChild).toHaveLength(1);
    expect(noChild[0].message).toContain('mảng chuỗi');
  });

  it('record KHAI SẴN tên khoá trong mặc định → cảnh báo + vá về {}', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{
        path: '/Quan Hệ NPC', type: 'record', label: 'Quan Hệ NPC',
        defaultValue: { Elric: { 'Hảo Cảm': 10 } }, constraints: {},
        children: [{ path: '/Quan Hệ NPC/_child/Hảo Cảm', type: 'number', label: 'Hảo Cảm', defaultValue: 0, constraints: {} }],
      }],
    }) as MVUZODSchema;
    const issues = auditCardQuality({ entries: [], schema: s });
    expect(issues.filter(i => i.code === 'record-duplicate-key')).toHaveLength(1);

    const r = repairQualityIssues(mkCard(s), s);
    expect(r.fixed.some(f => f.id === 'record-duplicate-key')).toBe(true);
    const ext = r.card.data.extensions as unknown as { mvuzod: { schema: MVUZODSchema } };
    expect(ext.mvuzod.schema.fields[0].defaultValue).toEqual({});
  });

  it('array có defaultValue SAI KIỂU (object) → lỗi + vá về []', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{ path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: {}, constraints: {},
        children: [{ path: '/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} }] }],
    }) as MVUZODSchema;
    expect(auditCardQuality({ entries: [], schema: s }).filter(i => i.code === 'struct-bad-default')).toHaveLength(1);
    const r = repairQualityIssues(mkCard(s), s);
    const ext = r.card.data.extensions as unknown as { mvuzod: { schema: MVUZODSchema } };
    expect(ext.mvuzod.schema.fields[0].defaultValue).toEqual([]);
  });

  it('hai trường con TRÙNG TÊN trong cùng cấu trúc → lỗi (dữ liệu một cái mất im lặng)', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{
        path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
        children: [
          { path: '/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
          { path: '/Kho Đồ/_child/tên', type: 'string', label: 'tên', defaultValue: '', constraints: {} },
        ],
      }],
    }) as MVUZODSchema;
    expect(auditCardQuality({ entries: [], schema: s }).filter(i => i.code === 'record-duplicate-key')).toHaveLength(1);
  });
});

describe('(bug 148-2) AI toàn pipeline được dạy 3 kiểu', () => {
  const cfg = { autoDetect: true, createInitVar: true, createUpdateRules: true, createVarList: true } as never;

  it('prompt MVUZOD phân biệt object/array/record + ví dụ children "_child"', () => {
    const p = buildMvuzodPrompt('ý tưởng', '(ctx)', cfg, null);
    expect(p).toContain('"array"');
    expect(p).toContain('"record"');
    expect(p).toContain('/_child/');
    expect(p).toContain('KHÔNG gộp hết vào string');
  });

  it('prompt dạy initvar + cập nhật đúng cho từng kiểu (insert "/-" cho array, khoá cụ thể cho record)', () => {
    const p = buildMvuzodPrompt('ý tưởng', '(ctx)', cfg, null);
    expect(p).toContain('/Kho Đồ/-');
    expect(p).toContain('/Quan Hệ NPC/Elric');
    expect(p).toContain('kiểm khoá đã tồn tại hay chưa');
  });

  it('prompt EJS dạy vòng lặp cho Array (forEach) và Record (theo tên khoá)', () => {
    expect(EJS_SYSTEM_PROMPT).toContain('forEach');
    expect(EJS_SYSTEM_PROMPT).toContain('Object.keys');
    expect(EJS_SYSTEM_PROMPT).toContain('không chỉ số thứ tự');
  });
});
