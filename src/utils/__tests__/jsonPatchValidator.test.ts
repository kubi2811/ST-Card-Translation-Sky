import { describe, it, expect } from 'vitest';
import { extractJsonPatches, hasJsonPatchOps, extractPatchFieldNames, translatePatchPaths } from '../jsonPatchValidator';

/**
 * Trích JSON Patch từ nội dung entry [mvu_update] — hàm parse "khoan dung" (bắt được cả
 * mảng lẫn op rời, bỏ qua rác). Đây là loại hàm dễ vỡ khi AI trả về format lạ → cần test.
 */
describe('extractJsonPatches', () => {
  it('trích mảng patch chuẩn', () => {
    const content = 'Trước đó...\n[{"op":"replace","path":"/hp","value":10},{"op":"add","path":"/mp","value":5}]\nsau đó';
    const patches = extractJsonPatches(content);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toHaveLength(2);
    expect(patches[0][0]).toMatchObject({ op: 'replace', path: '/hp', value: 10 });
  });

  it('nội dung rỗng / không có patch → mảng rỗng', () => {
    expect(extractJsonPatches('')).toEqual([]);
    expect(extractJsonPatches('chỉ là văn xuôi bình thường, không có op nào')).toEqual([]);
  });

  it('bỏ qua object KHÔNG phải patch (thiếu op/path hợp lệ)', () => {
    // "op" sai giá trị → không khớp regex verb → không trích
    expect(extractJsonPatches('[{"op":"foobar","path":"/x"}]')).toEqual([]);
  });

  it('Strategy 2 — op rời (không bọc mảng) vẫn gom được', () => {
    const content = 'abc {"op":"replace","path":"/status","value":"ok"} xyz';
    const patches = extractJsonPatches(content);
    expect(patches).toHaveLength(1);
    expect(patches[0][0]).toMatchObject({ op: 'replace', path: '/status' });
  });
});

describe('op MVU-riêng delta/insert (guide MVU_ZOD 5.3)', () => {
  it('extractJsonPatches gom được mảng chứa delta/insert', () => {
    const content = '[{"op":"delta","path":"/白娅/依存度","value":5},{"op":"insert","path":"/主角/物品栏/新物品","value":"x"}]';
    const patches = extractJsonPatches(content);
    expect(patches).toHaveLength(1);
    expect(patches[0][0]).toMatchObject({ op: 'delta', path: '/白娅/依存度' });
    expect(patches[0][1]).toMatchObject({ op: 'insert' });
  });

  it('hasJsonPatchOps true với delta/insert', () => {
    expect(hasJsonPatchOps('[{"op":"delta","path":"/hp","value":3}]')).toBe(true);
    expect(hasJsonPatchOps('[{"op":"insert","path":"/bag/-","value":1}]')).toBe(true);
  });

  it('extractPatchFieldNames rút được tên biến CJK từ block delta/insert', () => {
    const content = '[{"op":"delta","path":"/依存度","value":5},{"op":"insert","path":"/物品栏/新物品","value":"x"}]';
    const names = extractPatchFieldNames(content);
    expect(names).toContain('依存度');
    expect(names).toContain('物品栏');
  });
});

describe('hasJsonPatchOps', () => {
  it('true khi có op-verb + path bắt đầu bằng /', () => {
    expect(hasJsonPatchOps('{"op":"add","path":"/hp","value":1}')).toBe(true);
  });
  it('false khi thiếu path dạng / hoặc không có op', () => {
    expect(hasJsonPatchOps('')).toBe(false);
    expect(hasJsonPatchOps('{"op":"add"}')).toBe(false);
    expect(hasJsonPatchOps('{"path":"/hp"}')).toBe(false);
    expect(hasJsonPatchOps('văn xuôi thường')).toBe(false);
  });
});

describe('translatePatchPaths — chỉ dịch đường dẫn', () => {
  it('không đổi string value/enum và giữ escape RFC 6901', () => {
    const [op] = translatePatchPaths(
      [{ op: 'replace', path: '/a~1b/状态', value: '状态' }],
      { 'a/b': 'Mục/Con', 状态: 'Trạng Thái' },
    );
    expect(op.path).toBe('/Mục~1Con/Trạng Thái');
    expect(op.value).toBe('状态');
  });
});
