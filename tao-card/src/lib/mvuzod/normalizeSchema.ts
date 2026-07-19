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

/** Chấp nhận mọi input (kể cả null/rác) — luôn trả về schema hợp lệ, không ném lỗi. */
export function normalizeMVUZODSchema(raw: any): MVUZODSchema {
  const s = (raw && typeof raw === 'object') ? raw : {};
  return {
    ...s,
    version: typeof s.version === 'string' && s.version ? s.version : '1.0',
    fields: Array.isArray(s.fields) ? s.fields.map(normalizeMVUZODField) : [],
  } as MVUZODSchema;
}
