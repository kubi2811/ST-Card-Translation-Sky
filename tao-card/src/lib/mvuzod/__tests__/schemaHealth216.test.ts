/**
 * (bug 216a) Tab MVUZOD "không tạo được schema" — trong khi bước mvuzod của Auto Creator thì chạy tốt.
 *
 * NGUYÊN NHÂN GỐC: `normalizeMVUZODSchema` cố ý KHÔNG BAO GIỜ ném lỗi và luôn trả về một object
 * hợp lệ — đầu vào `undefined` vẫn cho ra `{ version:'1.0', fields: [] }`. Rất tiện cho việc
 * render, nhưng nó biến chốt DUY NHẤT của tab
 *
 *     if (!parsed.proposedSchema) throw new Error('AI không trả về schema hợp lệ.')
 *
 * thành CHỐT CHẾT: vế trái luôn là object truthy nên không đời nào kích hoạt. AI trả sai tên khoá
 * (`schema` thay vì `proposedSchema`) hoặc JSON bị cắt → tab ghi vào thẻ schema 0 biến, KHÔNG báo
 * lỗi, mà header vẫn hiện "Schema loaded". Auto Creator không dính vì nó có `verifyMvuzodResult`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkSchemaHealth, summarizeHealth } from '../schemaHealth';
import { assertUsableSchema, parseSchemaInferenceResponse } from '../schemaInferencer';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const goodSchema = (): MVUZODSchema => normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    { path: 'HP', label: 'HP', type: 'number', defaultValue: 100, constraints: { min: 0, max: 100 } },
    { path: 'Ten', label: 'Tên', type: 'string', defaultValue: '' },
  ],
} as unknown);

/* ═══════ Bản chất của bug: chốt cũ không thể kích hoạt ═══════ */

describe('vì sao chốt cũ là CHỐT CHẾT', () => {
  it('normalizeMVUZODSchema không bao giờ trả null — kể cả với undefined/rác', () => {
    for (const bad of [undefined, null, 'rác', 42, {}, { fields: null }]) {
      const out = normalizeMVUZODSchema(bad as never);
      expect(out).toBeTruthy();               // ⇐ nên `if (!schema) throw` KHÔNG BAO GIỜ chạy
      expect(Array.isArray(out.fields)).toBe(true);
    }
  });

  it('assertUsableSchema mới CHẶN được đúng ca đó', () => {
    for (const bad of [undefined, null, {}, { version: '1.0', fields: [] }]) {
      expect(() => assertUsableSchema(bad as never, 'Test')).toThrow(/0 biến/);
    }
  });

  it('schema có biến thật thì đi qua bình thường', () => {
    const s = assertUsableSchema(goodSchema(), 'Test');
    expect(s.fields.length).toBe(2);
  });

  it('thông báo lỗi nói rõ nguyên nhân và việc cần làm', () => {
    try {
      assertUsableSchema(null, 'AI Inference');
      throw new Error('đáng lẽ phải ném');
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain('AI Inference');
      expect(m).toMatch(/JSON bị cắt|sai định dạng/);
    }
  });
});

/* ═══════ AI hay trả sai tên khoá ═══════ */

describe('parseSchemaInferenceResponse nhận cả các tên khoá AI hay trả nhầm', () => {
  const fields = [{ path: 'HP', label: 'HP', type: 'number', defaultValue: 1 }];

  it('đúng khoá `proposedSchema`', () => {
    const r = parseSchemaInferenceResponse(JSON.stringify({ proposedSchema: { version: '1.0', fields } }));
    expect(r.proposedSchema.fields.length).toBe(1);
  });

  it('khoá `schema` (tên mà prompt Auto Creator dùng — model rất hay trả nhầm sang)', () => {
    const r = parseSchemaInferenceResponse(JSON.stringify({ schema: { version: '1.0', fields } }));
    expect(r.proposedSchema.fields.length).toBe(1);
  });

  it('trả thẳng `{ version, fields }` không bọc gì', () => {
    const r = parseSchemaInferenceResponse(JSON.stringify({ version: '1.0', fields }));
    expect(r.proposedSchema.fields.length).toBe(1);
  });

  it('không có gì dùng được → schema rỗng, và assertUsableSchema sẽ chặn', () => {
    const r = parseSchemaInferenceResponse(JSON.stringify({ analysis: {} }));
    expect(r.proposedSchema.fields.length).toBe(0);
    expect(() => assertUsableSchema(r.proposedSchema)).toThrow();
  });
});

/* ═══════ Cơ chế kiểm tra "nó có hoạt động không" ═══════ */

describe('checkSchemaHealth — cơ chế kiểm user yêu cầu', () => {
  it('schema tử tế → ok, không lỗi', () => {
    const r = checkSchemaHealth(goodSchema());
    expect(r.ok).toBe(true);
    expect(r.issues.filter(i => i.level === 'error')).toEqual([]);
    expect(r.stats.totalLeaves).toBe(2);
    expect(r.stats.zodCodeChars).toBeGreaterThan(0);
    expect(summarizeHealth(r)).toContain('✅');
  });

  it('schema RỖNG → báo lỗi đúng mã (đây là ca user gặp)', () => {
    const r = checkSchemaHealth(normalizeMVUZODSchema(undefined as never));
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'empty-schema')).toBe(true);
    expect(summarizeHealth(r)).toContain('❌');
  });

  it('biến không tên / không kiểu → lỗi', () => {
    const r = checkSchemaHealth({ version: '1.0', fields: [{ label: '', path: '', type: undefined }] } as never);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'field-no-name' || i.code === 'field-no-type')).toBe(true);
  });

  it('tên biến trùng nhau → cảnh báo (dễ ghi đè nhau lúc chạy)', () => {
    const r = checkSchemaHealth({
      version: '1.0',
      fields: [
        { path: 'HP', label: 'HP', type: 'number', defaultValue: 1, constraints: { min: 0, max: 10 } },
        { path: 'HP2', label: 'hp', type: 'number', defaultValue: 1, constraints: { min: 0, max: 10 } },
      ],
    } as never);
    expect(r.issues.some(i => i.code === 'duplicate-name')).toBe(true);
  });

  it('biến số thiếu min/max → cảnh báo, KHÔNG phải lỗi (vẫn chạy được)', () => {
    const r = checkSchemaHealth({
      version: '1.0', fields: [{ path: 'HP', label: 'HP', type: 'number', defaultValue: 1 }],
    } as never);
    expect(r.issues.some(i => i.code === 'number-no-range' && i.level === 'warning')).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('KHÔNG BAO GIỜ ném — mọi hỏng hóc đều thành issue để UI hiện được', () => {
    for (const bad of [undefined, null, 'rác', 42, { fields: 'không phải mảng' }]) {
      expect(() => checkSchemaHealth(bad as never)).not.toThrow();
    }
  });

  it('đếm được biến lồng trong nhánh con', () => {
    const r = checkSchemaHealth({
      version: '1.0',
      fields: [{
        path: 'NPC', label: 'NPC', type: 'object', defaultValue: {},
        children: [
          { path: 'NPC.HaoCam', label: 'Hảo Cảm', type: 'number', defaultValue: 0, constraints: { min: -100, max: 100 } },
        ],
      }],
    } as never);
    expect(r.stats.maxDepth).toBe(2);
    expect(r.stats.totalLeaves).toBe(1);
  });
});

/* ═══════ Nối dây vào tab ═══════ */

describe('nối dây — tab MVUZOD dùng chốt mới và có nút kiểm', () => {
  const src = readFileSync(new URL('../../../components/mvuzod/SchemaBuilder.tsx', import.meta.url), 'utf-8');

  it('cả HAI đường sinh schema đều đi qua assertUsableSchema', () => {
    expect((src.match(/assertUsableSchema\(parsed\.proposedSchema/g) || []).length).toBe(2);
  });

  it('chốt chết cũ đã bị gỡ hẳn', () => {
    expect(src).not.toMatch(/if \(!parsed\.proposedSchema\) throw new Error/);
  });

  it('có bảng "Kiểm schema" trong ActionsPanel', () => {
    expect(src).toMatch(/function SchemaHealthPanel/);
    // (bug 224) Panel này nhận thêm onAskAiFix — nút "Nhờ AI sửa" đẩy chỉ thị sang ô AI chỉnh schema.
    expect(src).toContain('<SchemaHealthPanel schema={schema} onAskAiFix=');
    expect(src).toContain('buildSchemaFixInstruction');
    expect(src).toMatch(/checkSchemaHealth/);
  });
});
