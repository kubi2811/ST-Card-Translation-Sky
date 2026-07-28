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
import type { MVUZODField, MVUZODSchema, StatRelation, StatRelationLandmark } from '../../types/mvuzod.types';
import { stripBogusNumericCaps } from './numericSemantics';

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

/** So sánh path bất kể có "/" đầu hay không: "/A/B" ≡ "A/B". */
export function normalizeFieldPath(p: unknown): string {
  return String(p ?? '').split('/').filter(Boolean).join('/');
}

/** Gom map path-chuẩn-hoá → field lá (đệ quy). */
function collectLeafByPath(fields: MVUZODField[], out: Map<string, MVUZODField>): void {
  for (const f of fields ?? []) {
    if (Array.isArray(f.children) && f.children.length) collectLeafByPath(f.children, out);
    else out.set(normalizeFieldPath(f.path), f);
  }
}

function asFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * (Goal 28/07 — ràng buộc mềm giữa chỉ số liên quan) Chốt chặn tại biên cho `statRelations`
 * do AI sinh: chỉ giữ relation trỏ đúng 2 field lá CÓ THẬT, có `basis` (căn cứ — sẽ hiện
 * nguyên văn trong cảnh báo cho người chơi) và còn ít nhất 1 landmark dùng được (có
 * plausibleMin hoặc plausibleMax là số). Relation hỏng thì BỎ chứ không vá — thiếu căn cứ
 * mà tự bịa khoảng là đúng cái user cấm.
 */
export function normalizeStatRelations(raw: any, fields: MVUZODField[]): StatRelation[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const leafByPath = new Map<string, MVUZODField>();
  collectLeafByPath(fields, leafByPath);

  const seen = new Set<string>();
  const result: StatRelation[] = [];

  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const anchorPath = normalizeFieldPath(r.anchorPath);
    const dependentPath = normalizeFieldPath(r.dependentPath);
    const basis = typeof r.basis === 'string' ? r.basis.trim() : '';
    if (!anchorPath || !dependentPath || anchorPath === dependentPath || !basis) continue;

    const anchorField = leafByPath.get(anchorPath);
    const depField = leafByPath.get(dependentPath);
    // Neo phải đọc được thành mốc: số hoặc enum. Phụ thuộc phải là số (khoảng hợp lý là số).
    if (!anchorField || !depField || depField.type !== 'number') continue;
    if (anchorField.type !== 'number' && !anchorField.constraints?.enumValues?.length) continue;

    const key = `${anchorPath}→${dependentPath}`;
    if (seen.has(key)) continue;

    const landmarks: StatRelationLandmark[] = [];
    for (const lm of Array.isArray(r.landmarks) ? r.landmarks : []) {
      if (!lm || typeof lm !== 'object') continue;
      let anchor: StatRelationLandmark['anchor'] | null = null;
      if (Array.isArray(lm.anchor)) {
        const lo = asFiniteNumber(lm.anchor[0]);
        const hi = asFiniteNumber(lm.anchor[1]);
        if (lo !== undefined && hi !== undefined) anchor = [Math.min(lo, hi), Math.max(lo, hi)];
      } else if (asFiniteNumber(lm.anchor) !== undefined) {
        anchor = asFiniteNumber(lm.anchor)!;
      } else if (typeof lm.anchor === 'string' && lm.anchor.trim()) {
        anchor = lm.anchor.trim();
      }
      const plausibleMin = asFiniteNumber(lm.plausibleMin);
      const plausibleMax = asFiniteNumber(lm.plausibleMax);
      if (anchor === null || (plausibleMin === undefined && plausibleMax === undefined)) continue;
      const entry: StatRelationLandmark = { anchor };
      if (plausibleMin !== undefined) entry.plausibleMin = plausibleMin;
      if (plausibleMax !== undefined) entry.plausibleMax = plausibleMax;
      if (typeof lm.note === 'string' && lm.note.trim()) entry.note = lm.note.trim();
      landmarks.push(entry);
    }
    if (landmarks.length === 0) continue;

    seen.add(key);
    result.push({ anchorPath, dependentPath, basis, landmarks });
  }
  return result;
}

/**
 * (Goal 28/07 — gỡ MỘT PHẦN bug 113 theo yêu cầu) Trường PHỤ THUỘC trong relation phải là ô
 * nhập tự do: bỏ `max`/`clamp` khỏi constraints (giữ `min`). Cảnh báo mềm mới là ràng buộc —
 * để Zod kẹp thì giá trị user cố ý giữ (nhân vật thiên tài…) bị cắt mất lúc chơi.
 */
function freeDependentFields(fields: MVUZODField[], depPaths: Set<string>): MVUZODField[] {
  return (fields ?? []).map((f) => {
    const next: MVUZODField = { ...f };
    if (Array.isArray(f.children) && f.children.length) next.children = freeDependentFields(f.children, depPaths);
    if (f.type === 'number' && depPaths.has(normalizeFieldPath(f.path))
        && (f.constraints?.max !== undefined || f.constraints?.clamp)) {
      const c = { ...(f.constraints ?? {}) };
      delete c.max;
      delete c.clamp;
      next.constraints = c;
    }
    return next;
  });
}

/** Chấp nhận mọi input (kể cả null/rác) — luôn trả về schema hợp lệ, không ném lỗi. */
export function normalizeMVUZODSchema(raw: any): MVUZODSchema {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const fields = Array.isArray(s.fields) ? s.fields.map(normalizeMVUZODField) : [];
  const base = {
    ...s,
    version: typeof s.version === 'string' && s.version ? s.version : '1.0',
    fields: nestFlatSchema(fields),
  } as MVUZODSchema;

  // (bugNeedFix/113) Bỏ TRẦN BỊA khỏi bộ đếm. Ví dụ JSON trong prompt ghi thẳng
  // `"constraints": { "min": 0, "max": 100 }` nên AI chép y nguyên cho mọi biến số — kể cả tiền
  // tệ, ngày và số lượng vật phẩm. Đây không chỉ là lỗi hiển thị: `max`/`clamp` được Zod dùng để
  // KẸP giá trị, nên người chơi kiếm quá 100 đồng là bị cắt về 100, mất dữ liệu thật.
  // Làm ở đây vì mọi đường ghi schema (AI sinh, wizard, import) đều đi qua hàm này.
  const clean = stripBogusNumericCaps(base).schema;

  // (Goal 28/07) Ràng buộc mềm giữa chỉ số liên quan: lọc relation AI sinh, rồi thả trần
  // cứng của các trường phụ thuộc — cảnh báo mềm thay cho kẹp giá trị.
  const relations = normalizeStatRelations(s.statRelations, clean.fields);
  if (relations.length > 0) {
    clean.statRelations = relations;
    clean.fields = freeDependentFields(clean.fields, new Set(relations.map(r => r.dependentPath)));
  } else {
    delete clean.statRelations;
  }
  return clean;
}
