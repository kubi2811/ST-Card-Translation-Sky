/**
 * src/lib/mvuzod/samplePatch.ts — (bug 224) MẪU PATCH DỰNG TỪ CHÍNH SCHEMA ĐANG MỞ.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "đại tu lại các tab đang khá vô dụng như Playground, Patch…".
 *
 * Tab Patch KHÔNG hỏng — nó bóc, áp và kiểm patch đầy đủ. Nó vô dụng vì cái MẪU: chuỗi mẫu bị
 * ghi cứng trong mã với đường dẫn của một schema khác ("/Trạng thái thế giới/Loại cảnh hiện tại").
 * Mở tab lên bấm Test là ăn ngay "path không tồn tại" trên MỌI thẻ — nên người dùng kết luận tab
 * này không chạy, đúng như user viết.
 *
 * Sửa gốc: sinh mẫu từ đường dẫn THẬT của schema đang mở, mỗi kiểu dữ liệu một thao tác phù hợp:
 *   • string  → replace (đổi giá trị)
 *   • number  → delta   (cộng/trừ — thao tác MVU dùng nhiều nhất, và là thao tác riêng của MVU)
 *   • boolean → replace true/false
 *   • array   → insert vào "-" (đuôi mảng)
 * Nhờ vậy bấm Test là thấy patch chạy đúng ngay, và người dùng học được đúng cú pháp thẻ mình.
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

interface Leaf { path: string; type: string; label: string }

/** Gom lá theo kiểu — đường dẫn dạng JSON Pointer mà MVU dùng: /Cha/Con. */
function collectLeaves(fields: MVUZODField[] | undefined, base = '', out: Leaf[] = []): Leaf[] {
  for (const f of fields ?? []) {
    const name = f.label || f.path || '';
    if (!name) continue;
    const path = `${base}/${name}`;
    const kids = (f as unknown as { children?: MVUZODField[] }).children;
    if (kids?.length) {
      collectLeaves(kids, path, out);
    } else {
      out.push({ path, type: String(f.type || 'string'), label: name });
    }
  }
  return out;
}

/** Giá trị mẫu hợp kiểu — cố ý đơn giản để người dùng thấy ngay chỗ cần sửa. */
function sampleValueFor(leaf: Leaf): { op: string; body: string } | null {
  switch (leaf.type) {
    case 'number':
      // delta là thao tác MVU riêng (cộng dồn), đáng để mẫu dạy trước tiên.
      return { op: 'delta', body: `{"op":"delta","path":"${leaf.path}","value":1}` };
    case 'boolean':
      return { op: 'replace', body: `{"op":"replace","path":"${leaf.path}","value":true}` };
    case 'array':
      return { op: 'insert', body: `{"op":"insert","path":"${leaf.path}/-","value":"Giá trị mới"}` };
    case 'string':
      return { op: 'replace', body: `{"op":"replace","path":"${leaf.path}","value":"Giá trị mới"}` };
    default:
      return null;
  }
}

/** Mẫu dùng khi CHƯA có schema — giữ để tab vẫn có gì đó hiển thị. */
export const FALLBACK_SAMPLE_PATCH = `<UpdateVariable>
[
  {"op":"replace","path":"/Ví dụ/Trạng thái","value":"Chiến đấu"},
  {"op":"delta","path":"/Ví dụ/Cấp bậc","value":1}
]
</UpdateVariable>`;

/**
 * Dựng khối `<UpdateVariable>` mẫu từ schema. Ưu tiên phủ NHIỀU KIỂU khác nhau (mỗi kiểu một
 * thao tác) thay vì lấy mấy lá đầu tiên — để mẫu dạy được cả `delta` lẫn `insert`.
 * @param maxOps số thao tác tối đa trong mẫu
 */
export function buildSamplePatch(schema: MVUZODSchema | null | undefined, maxOps = 3): string {
  const leaves = collectLeaves(schema?.fields);
  if (leaves.length === 0) return FALLBACK_SAMPLE_PATCH;

  const ops: string[] = [];
  const usedTypes = new Set<string>();
  // Vòng 1: mỗi KIỂU một thao tác.
  for (const leaf of leaves) {
    if (ops.length >= maxOps) break;
    if (usedTypes.has(leaf.type)) continue;
    const s = sampleValueFor(leaf);
    if (!s) continue;
    usedTypes.add(leaf.type);
    ops.push(s.body);
  }
  // Vòng 2: schema chỉ có một kiểu ⇒ lấp thêm cho đủ, khỏi ra mẫu một dòng.
  for (const leaf of leaves) {
    if (ops.length >= maxOps) break;
    const s = sampleValueFor(leaf);
    if (!s || ops.includes(s.body)) continue;
    ops.push(s.body);
  }
  if (ops.length === 0) return FALLBACK_SAMPLE_PATCH;

  return `<UpdateVariable>\n[\n${ops.map(o => `  ${o}`).join(',\n')}\n]\n</UpdateVariable>`;
}
