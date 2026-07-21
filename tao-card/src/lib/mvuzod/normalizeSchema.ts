/**
 * normalizeSchema — chốt chặn tại BIÊN cho schema MVUZOD.
 *
 * Bug user báo 19/07: Auto Creator crash "Cannot read properties of undefined (reading 'enumValues')".
 * Gốc rễ: type MVUZODField khai `constraints` là BẮT BUỘC nên cả chục nơi đọc thẳng
 * `field.constraints.X` không guard — nhưng schema do AI SINH RA (bước mvuzod của Auto Creator,
 * SchemaWizard, InitVar/UpdateRules editor) đi vào app qua JSON.parse + cast thô, AI lại hay bỏ
 * hẳn key `constraints` (nhất là field string/boolean và children lồng nhau) ⇒ field đầu tiên
 * thiếu constraints là crash ở scriptGenerator/schemaInferencer/schemaContextBuilder.
 *
 * Cách chữa đúng: normalize NGAY tại nơi dữ liệu ngoài đi vào (AI trả về, load project cũ) —
 * mọi consumer phía sau được bảo đảm `constraints` luôn là object, children đã đệ quy sạch.
 */
import type { MVUZODField, MVUZODSchema } from '../../types/mvuzod.types';

const DEFAULT_BY_TYPE: Record<string, unknown> = {
  number: 0,
  boolean: false,
  record: {},
  object: {},
  array: [],
  string: '',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeMVUZODField(raw: any): MVUZODField {
  const f = (raw && typeof raw === 'object') ? raw : {};
  // constraints luôn là object — đây chính là chỗ chặn crash 'enumValues'/'coerce'/'clamp'.
  if (!f.constraints || typeof f.constraints !== 'object') f.constraints = {};
  // enumValues nếu có phải là mảng string; AI đôi khi trả chuỗi "a,b,c" hoặc null.
  if (f.constraints.enumValues != null && !Array.isArray(f.constraints.enumValues)) {
    if (typeof f.constraints.enumValues === 'string') {
      f.constraints.enumValues = f.constraints.enumValues.split(',').map((s: string) => s.trim()).filter(Boolean);
    } else {
      delete f.constraints.enumValues;
    }
  }
  if (typeof f.path !== 'string') f.path = String(f.path ?? '');
  if (typeof f.type !== 'string' || !(f.type in DEFAULT_BY_TYPE)) f.type = 'string';
  if (typeof f.label !== 'string' || !f.label) f.label = f.path.split('/').filter(Boolean).pop() ?? f.path;
  if (f.defaultValue === undefined) f.defaultValue = DEFAULT_BY_TYPE[f.type];
  if (Array.isArray(f.children)) f.children = f.children.map(normalizeMVUZODField);
  else if (f.children != null) delete f.children;
  return f as MVUZODField;
}

/**
 * (bug 72) AI rất hay trả schema PHẲNG: mọi field nằm cùng một tầng, quan hệ cha-con chỉ
 * nằm trong chuỗi `path` (`/Nhân vật/Cấp độ`), không có `children`. Opening Form dựng trang
 * nhập liệu bằng cách duyệt `children` của từng field gốc — schema phẳng ⇒ mỗi field thành
 * một "section" rỗng ⇒ 0 trang nhập ⇒ form chỉ còn trang bìa + trang xác nhận. Đúng y triệu
 * chứng user báo: "chỉ có nút bắt đầu và xác nhận, chưa có nhập thông tin".
 *
 * Hàm này dựng lại cây từ `path`. Chỉ chạy khi schema THẬT SỰ phẳng (không field nào có
 * children) để không bao giờ đụng vào schema vốn đã đúng.
 */
export function nestFlatSchema(fields: MVUZODField[]): MVUZODField[] {
  if (!Array.isArray(fields) || fields.length === 0) return fields;
  const anyNested = fields.some(f => Array.isArray(f.children) && f.children.length > 0);
  const anyDeepPath = fields.some(f => String(f.path ?? '').split('/').filter(Boolean).length >= 2);
  if (anyNested || !anyDeepPath) return fields;

  const roots: MVUZODField[] = [];
  const groupByPath = new Map<string, MVUZODField>();

  /** Lấy (hoặc tạo) node nhóm ứng với đường dẫn tổ tiên. */
  const ensureGroup = (segments: string[]): MVUZODField => {
    const key = segments.join('/');
    const found = groupByPath.get(key);
    if (found) return found;
    const node: MVUZODField = {
      path: '/' + key,
      type: 'object',
      label: segments[segments.length - 1],
      defaultValue: {},
      constraints: {},
      children: [],
    } as MVUZODField;
    groupByPath.set(key, node);
    if (segments.length === 1) roots.push(node);
    else ensureGroup(segments.slice(0, -1)).children!.push(node);
    return node;
  };

  // Field lá 1 tầng (`/Tên`) không có nhóm cha nào — gom vào một nhóm chung, nếu bỏ ở gốc
  // thì chúng cũng bị coi là section rỗng và biến mất khỏi form.
  let looseGroup: MVUZODField | null = null;

  for (const f of fields) {
    const segs = String(f.path ?? '').split('/').filter(Boolean);
    if (segs.length >= 2) {
      ensureGroup(segs.slice(0, -1)).children!.push(f);
    } else {
      if (!looseGroup) {
        looseGroup = {
          path: '/Thông tin chung',
          type: 'object',
          label: 'Thông tin chung',
          defaultValue: {},
          constraints: {},
          children: [],
        } as MVUZODField;
        roots.push(looseGroup);
      }
      looseGroup.children!.push(f);
    }
  }

  return roots;
}

/** Chấp nhận mọi input (kể cả null/rác) — luôn trả về schema hợp lệ, không ném lỗi. */
export function normalizeMVUZODSchema(raw: any): MVUZODSchema {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const fields = Array.isArray(s.fields) ? s.fields.map(normalizeMVUZODField) : [];
  return {
    ...s,
    version: typeof s.version === 'string' && s.version ? s.version : '1.0',
    fields: nestFlatSchema(fields),
  } as MVUZODSchema;
}
