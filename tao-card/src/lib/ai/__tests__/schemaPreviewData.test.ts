// (bug 148-3) Preview bước 2 phải hiện GIÁ TRỊ CỦA SCHEMA đang chỉnh, không phải khung rỗng.
import { describe, it, expect } from 'vitest';
import { buildSampleStatData, withPreviewData } from '../schemaPreviewData';
import { normalizeMVUZODSchema } from '../../mvuzod/normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    {
      path: '/Nhân Vật', type: 'object', label: 'Nhân Vật', defaultValue: {}, constraints: {},
      children: [
        { path: '/Nhân Vật/Máu', type: 'number', label: 'Máu', defaultValue: 87, constraints: { min: 0, max: 100 } },
        { path: '/Nhân Vật/Cảnh Giới', type: 'string', label: 'Cảnh Giới', defaultValue: '', constraints: { enumValues: ['Luyện Khí', 'Trúc Cơ'] } },
        { path: '/Nhân Vật/Thể Lực', type: 'number', label: 'Thể Lực', defaultValue: '', constraints: { min: 0, max: 200 } },
      ],
    },
    {
      path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
      children: [
        { path: '/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: 'Kiếm gỉ', constraints: {} },
        { path: '/Kho Đồ/_child/Số Lượng', type: 'number', label: 'Số Lượng', defaultValue: 2, constraints: {} },
      ],
    },
    {
      path: '/Quan Hệ NPC', type: 'record', label: 'Quan Hệ NPC', defaultValue: {}, constraints: {},
      children: [{ path: '/Quan Hệ NPC/_child/Hảo Cảm', type: 'number', label: 'Hảo Cảm', defaultValue: 5, constraints: {} }],
    },
  ],
}) as MVUZODSchema;

describe('(bug 148-3) buildSampleStatData', () => {
  it('lấy defaultValue khi có; suy giá trị hợp lý khi trống (số có trần → ~70% thang, enum → giá trị đầu)', () => {
    const d = buildSampleStatData(SCHEMA) as Record<string, Record<string, unknown>>;
    expect(d['Nhân Vật']['Máu']).toBe(87);                 // default có sẵn
    expect(d['Nhân Vật']['Cảnh Giới']).toBe('Luyện Khí');   // enum đầu tiên
    expect(d['Nhân Vật']['Thể Lực']).toBe(140);            // 0 + 200*0.7
  });

  it('array/record có cấu trúc con → sinh phần tử/mục MẪU để vòng lặp có thứ mà vẽ', () => {
    const d = buildSampleStatData(SCHEMA) as Record<string, unknown>;
    const bag = d['Kho Đồ'] as Array<Record<string, unknown>>;
    expect(Array.isArray(bag)).toBe(true);
    expect(bag.length).toBeGreaterThan(0);
    expect(bag[0]['Tên']).toBe('Kiếm gỉ');

    const rel = d['Quan Hệ NPC'] as Record<string, Record<string, unknown>>;
    const keys = Object.keys(rel);
    expect(keys.length).toBeGreaterThan(0);
    expect(rel[keys[0]]['Hảo Cảm']).toBe(5);
  });

  it('schema rỗng/null → object rỗng, không nổ', () => {
    expect(buildSampleStatData(null)).toEqual({});
    expect(buildSampleStatData({ version: '1.0', fields: [] } as MVUZODSchema)).toEqual({});
  });
});

describe('(bug 148-3) withPreviewData — bơm MVU giả vào iframe', () => {
  const HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="x"></div></body></html>';

  it('chèn stub ngay sau <head> để chạy TRƯỚC script giao diện; giữ nguyên phần HTML thật', () => {
    const out = withPreviewData(HTML, SCHEMA);
    expect(out.indexOf('getAllVariables')).toBeLessThan(out.indexOf('<body'));
    expect(out).toContain('<div id="x"></div>');
    expect(out).toContain('waitGlobalInitialized');   // nếu không có, init() treo mãi
  });

  it('dữ liệu schema thật nằm trong stub (đúng thứ preview cần hiện)', () => {
    const out = withPreviewData(HTML, SCHEMA);
    expect(out).toContain('"Máu":87');
    expect(out).toContain('Luyện Khí');
  });

  it('HTML không có <head> vẫn chèn được (fallback body / prepend)', () => {
    expect(withPreviewData('<body><p>a</p></body>', SCHEMA)).toContain('getAllVariables');
    expect(withPreviewData('<p>a</p>', SCHEMA)).toContain('getAllVariables');
  });
});
