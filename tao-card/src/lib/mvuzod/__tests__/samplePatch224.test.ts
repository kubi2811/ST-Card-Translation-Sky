/**
 * (bug 224) Tab Patch "vô dụng" — thật ra chỉ vì CÁI MẪU.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bộ bóc/áp/kiểm patch chạy đủ. Nhưng chuỗi mẫu bị ghi cứng với đường dẫn của một schema khác
 * ("/Trạng thái thế giới/Loại cảnh hiện tại"), nên mở tab bấm Test là ăn "path không tồn tại"
 * trên MỌI thẻ ⇒ người dùng kết luận tab không chạy. Nay mẫu dựng từ chính schema đang mở.
 *
 * Test khoá điều đáng khoá: mọi đường dẫn trong mẫu PHẢI có thật trong schema, và mẫu phải dạy
 * được `delta` (thao tác riêng của MVU) khi schema có biến số.
 */
import { describe, it, expect } from 'vitest';
import { buildSamplePatch, FALLBACK_SAMPLE_PATCH } from '../samplePatch';
import { extractPatches } from '../patchExtractor';
import type { MVUZODSchema, MVUZODField } from '../../../types/mvuzod.types';

const leaf = (label: string, type: string): MVUZODField =>
  ({ label, path: label, type } as MVUZODField);
const obj = (label: string, children: MVUZODField[]): MVUZODField =>
  ({ label, path: label, type: 'object', children } as unknown as MVUZODField);
const mk = (fields: MVUZODField[]): MVUZODSchema => ({ fields } as MVUZODSchema);

/** Mọi đường dẫn lá có thật trong schema, dạng JSON Pointer. */
function realPaths(fields: MVUZODField[], base = '', out: string[] = []): string[] {
  for (const f of fields) {
    const p = `${base}/${f.label}`;
    const kids = (f as unknown as { children?: MVUZODField[] }).children;
    if (kids?.length) realPaths(kids, p, out);
    else out.push(p);
  }
  return out;
}

const SCHEMA = mk([
  obj('Nhân vật', [leaf('Tên', 'string'), leaf('Máu', 'number'), leaf('Đang chiến đấu', 'boolean')]),
  obj('Hành trang', [leaf('Kho đồ', 'array')]),
]);

describe('(bug 224) buildSamplePatch', () => {
  it('MỌI đường dẫn trong mẫu đều có thật trong schema (gốc của bệnh cũ)', () => {
    const { ops } = extractPatches(buildSamplePatch(SCHEMA, 4));
    expect(ops.length).toBeGreaterThan(0);
    const valid = realPaths(SCHEMA.fields);
    for (const op of ops) {
      const path = 'path' in op ? op.path : '';
      // insert vào mảng dùng đuôi "/-" — bỏ đuôi đó rồi mới đối chiếu.
      const base = path.replace(/\/-$/, '');
      expect(valid, `đường dẫn lạ: ${path}`).toContain(base);
    }
  });

  it('bóc ra được patch hợp lệ (khối <UpdateVariable> đúng định dạng)', () => {
    const { ops } = extractPatches(buildSamplePatch(SCHEMA));
    expect(ops.length).toBeGreaterThanOrEqual(2);
    for (const op of ops) expect(op.op).toBeTruthy();
  });

  it('có biến số ⇒ mẫu PHẢI dạy delta (thao tác riêng của MVU)', () => {
    const { ops } = extractPatches(buildSamplePatch(SCHEMA, 3));
    expect(ops.some(o => o.op === 'delta')).toBe(true);
  });

  it('mỗi KIỂU một thao tác phù hợp, không lặp lại cùng một kiểu khi còn kiểu khác', () => {
    const { ops } = extractPatches(buildSamplePatch(SCHEMA, 3));
    expect(new Set(ops.map(o => o.op)).size).toBeGreaterThanOrEqual(2);
  });

  it('mảng ⇒ insert vào đuôi "/-", không phải replace cả mảng', () => {
    const s = buildSamplePatch(mk([obj('Hành trang', [leaf('Kho đồ', 'array')])]));
    expect(s).toContain('"op":"insert"');
    expect(s).toContain('/Hành trang/Kho đồ/-');
  });

  it('schema chỉ có MỘT kiểu ⇒ vẫn lấp đủ số thao tác, không ra mẫu một dòng', () => {
    const s = mk([obj('A', [leaf('x', 'string'), leaf('y', 'string'), leaf('z', 'string')])]);
    const { ops } = extractPatches(buildSamplePatch(s, 3));
    expect(ops).toHaveLength(3);
  });

  it('tôn trọng maxOps', () => {
    const { ops } = extractPatches(buildSamplePatch(SCHEMA, 1));
    expect(ops).toHaveLength(1);
  });

  it('không có schema / schema rỗng ⇒ mẫu dự phòng, không nổ', () => {
    expect(buildSamplePatch(null)).toBe(FALLBACK_SAMPLE_PATCH);
    expect(buildSamplePatch(mk([]))).toBe(FALLBACK_SAMPLE_PATCH);
  });

  it('schema chỉ có container rỗng (không lá nào) ⇒ mẫu dự phòng', () => {
    expect(buildSamplePatch(mk([obj('Trống', [])]))).toBe(FALLBACK_SAMPLE_PATCH);
  });
});
