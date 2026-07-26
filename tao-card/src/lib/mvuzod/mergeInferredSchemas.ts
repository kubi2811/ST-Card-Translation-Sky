/**
 * mergeInferredSchemas.ts — (bugNeedFix/99) Gộp schema từ nhiều batch quét, KHÔNG gọi AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * Trước đây bước "Tổng hợp" nhồi TOÀN BỘ JSON của mọi batch vào một prompt rồi nhờ AI merge, ở
 * chế độ bắt-buộc-trả-JSON. Hệ quả đúng như user báo — "cứ xong là lại gọi tiếp rồi treo":
 *
 *   • Input merge = tổng mọi batch ⇒ output gần như luôn chạm trần token ⇒ finishReason = length.
 *   • Vòng "viết tiếp phần còn thiếu" gửi LẠI cả lịch sử đang phình ⇒ mỗi lượt một chậm hơn, tới 4
 *     lượt; nhìn từ ngoài y như gọi AI vô tận.
 *   • Tệ hơn: ở chế độ JSON-object, mỗi lượt model buộc phải trả MỘT object hoàn chỉnh mới, nên
 *     nối chuỗi các lượt lại KHÔNG bao giờ ra JSON hợp lệ — tốn 4 lượt rồi vẫn hỏng.
 *
 * Mà gộp schema vốn là việc DỮ LIỆU thuần: hợp nhất field theo path, gộp enum, giữ ràng buộc đầy
 * đủ nhất. Làm bằng code thì tức thì, miễn phí, không bao giờ treo và luôn ra kết quả như nhau.
 */
import type { MVUZODSchema, MVUZODField, MVUZODConstraints } from '../../types/mvuzod.types';

/** Ưu tiên kiểu "chứa được nhiều thứ hơn" khi 2 batch đoán khác nhau cho cùng một path. */
const TYPE_RANK: Record<MVUZODField['type'], number> = {
  object: 5, record: 4, array: 3, string: 2, number: 1, boolean: 0,
};

function mergeConstraints(a: MVUZODConstraints, b: MVUZODConstraints): MVUZODConstraints {
  const out: MVUZODConstraints = { ...a };
  for (const [k, v] of Object.entries(b) as Array<[keyof MVUZODConstraints, unknown]>) {
    if (v === undefined || v === null) continue;
    const cur = out[k];
    if (cur === undefined || cur === null || cur === '') {
      (out as Record<string, unknown>)[k] = v;
      continue;
    }
    // Gộp mảng (enumValues, checkRules) — hợp nhất, bỏ trùng, giữ thứ tự gặp trước.
    if (Array.isArray(cur) && Array.isArray(v)) {
      (out as Record<string, unknown>)[k] = Array.from(new Set([...cur, ...v]));
      continue;
    }
    // Biên số: lấy rộng nhất để không cắt mất giá trị batch kia thấy được.
    if (k === 'min' && typeof cur === 'number' && typeof v === 'number') { out.min = Math.min(cur, v); continue; }
    if (k === 'max' && typeof cur === 'number' && typeof v === 'number') { out.max = Math.max(cur, v); continue; }
    // Còn lại: giữ giá trị của batch trước (ổn định, không phụ thuộc thứ tự chạy xong).
  }
  return out;
}

function mergeField(a: MVUZODField, b: MVUZODField): MVUZODField {
  const type = TYPE_RANK[b.type] > TYPE_RANK[a.type] ? b.type : a.type;
  return {
    ...a,
    type,
    label: a.label || b.label,
    description: a.description || b.description,
    defaultValue: a.defaultValue !== undefined && a.defaultValue !== null ? a.defaultValue : b.defaultValue,
    constraints: mergeConstraints(a.constraints ?? {}, b.constraints ?? {}),
    children: mergeFieldLists(a.children, b.children),
  };
}

function mergeFieldLists(a?: MVUZODField[], b?: MVUZODField[]): MVUZODField[] | undefined {
  if (!a?.length) return b?.length ? [...b] : a;
  if (!b?.length) return [...a];
  const byPath = new Map<string, MVUZODField>();
  const order: string[] = [];
  for (const f of [...a, ...b]) {
    if (!f?.path) continue;
    const key = f.path;
    const cur = byPath.get(key);
    if (cur) byPath.set(key, mergeField(cur, f));
    else { byPath.set(key, { ...f }); order.push(key); }
  }
  return order.map((p) => byPath.get(p)!);
}

export interface MergeSchemasResult {
  schema: MVUZODSchema;
  /** Số batch thực sự góp field (để báo cho user thay vì im lặng bỏ qua batch hỏng). */
  usedCount: number;
  /** Số path bị 2+ batch cùng mô tả và đã được hợp nhất. */
  mergedPaths: number;
}

/**
 * Gộp N schema (mỗi cái từ một batch) thành MỘT. Schema rỗng/hỏng bị bỏ qua chứ không làm hỏng cả mẻ.
 */
export function mergeInferredSchemas(parts: Array<MVUZODSchema | null | undefined>): MergeSchemasResult {
  const valid = parts.filter((s): s is MVUZODSchema => !!s && Array.isArray(s.fields) && s.fields.length > 0);
  if (valid.length === 0) return { schema: { version: '1.0', fields: [] }, usedCount: 0, mergedPaths: 0 };

  let fields: MVUZODField[] = [...valid[0].fields];
  let mergedPaths = 0;
  for (let i = 1; i < valid.length; i++) {
    const before = new Set(fields.map((f) => f.path));
    const overlap = valid[i].fields.filter((f) => before.has(f.path)).length;
    mergedPaths += overlap;
    fields = mergeFieldLists(fields, valid[i].fields) ?? fields;
  }

  return {
    schema: { version: valid[0].version || '1.0', fields },
    usedCount: valid.length,
    mergedPaths,
  };
}
