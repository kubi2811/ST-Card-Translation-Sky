/**
 * (bug 174) SCALAR YAML — MỘT NGUỒN SỰ THẬT CHO CẢ BÊN GHI LẪN BÊN ĐỌC.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bug 174 sinh ra đúng từ chỗ hai bên lệch nhau: bên GHI thả `Phả Hệ: Null` ra file, bên ĐỌC
 * của tool coi đó là chuỗi "Null", còn engine MVU (parse bằng YAML thật) coi là RỖNG. Zod nhận
 * null trong khi enum chỉ có chuỗi "Null" ⇒ đỏ ngay lúc nhập thẻ, không nạp được biến nào.
 *
 * Nên gom về một chỗ: `parseYamlScalar` (đọc) và `emitYamlScalar` (ghi) là hai vế của cùng một
 * hợp đồng, và có test khoá vòng tròn `parse(emit(x)) === x`. Sau này muốn nới luật thì sửa
 * một chỗ, không thể lệch nữa.
 *
 * Chuẩn bám theo: YAML 1.2 core schema — đúng cái mà thư viện `yaml` (MVU dùng trong
 * util/common.ts:parseString) phân giải mặc định.
 *   null : ~ | null | Null | NULL | (rỗng)
 *   bool : true | True | TRUE | false | False | FALSE
 *   int  : [-+]?[0-9]+ | 0o[0-7]+ | 0x[0-9a-fA-F]+
 *   float: [-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)? | ±.inf | .nan
 * `yes/no/on/off` KHÔNG phải boolean ở core schema (chỉ ở YAML 1.1) — bên đọc không tự ý đổi,
 * nhưng bên GHI vẫn bọc nháy cho chắc, phòng khi engine đổi sang 1.1 thì thẻ vẫn sống.
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

const NULL_RE = /^(?:~|null|Null|NULL)$/;
const BOOL_TRUE_RE = /^(?:true|True|TRUE)$/;
const BOOL_FALSE_RE = /^(?:false|False|FALSE)$/;
const INT_RE = /^[-+]?[0-9]+$/;
const INT_OCT_RE = /^0o[0-7]+$/;
const INT_HEX_RE = /^0x[0-9a-fA-F]+$/;
const FLOAT_RE = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const INF_NAN_RE = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
/** Chỉ ở YAML 1.1 mới là boolean — bên ghi né, bên đọc không đổi. */
const YAML11_BOOL_RE = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/;
/** Ký tự mở đầu mang nghĩa cú pháp trong YAML — để trần là đổi nghĩa cả dòng. */
const LEADING_INDICATOR_RE = /^[-?:,[\]{}#&*!|>'"%@`]/;

/** Một token TRẦN sẽ được YAML đọc thành cái gì. */
export function parseYamlScalar(raw: string): unknown {
  const s = String(raw ?? '').trim();
  if (s === '' || NULL_RE.test(s)) return null;
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (BOOL_TRUE_RE.test(s)) return true;
  if (BOOL_FALSE_RE.test(s)) return false;
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2)
    || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  if (INT_RE.test(s) || FLOAT_RE.test(s)) return Number(s);
  if (INT_OCT_RE.test(s)) return parseInt(s.slice(2), 8);
  if (INT_HEX_RE.test(s)) return parseInt(s.slice(2), 16);
  if (INF_NAN_RE.test(s)) return s.includes('nan') || s.includes('NaN') || s.includes('NAN')
    ? NaN
    : (s.startsWith('-') ? -Infinity : Infinity);
  return s;
}

/**
 * Một CHUỖI để trần có bị YAML đọc ra thứ khác không (số, boolean, rỗng, hay vỡ cú pháp).
 * Đây là câu hỏi duy nhất quyết định có phải bọc nháy hay không.
 */
export function isYamlAmbiguousScalar(s: string): boolean {
  const raw = String(s ?? '');
  if (raw === '') return true;                       // rỗng trần = null
  if (raw !== raw.trim()) return true;               // dấu cách đầu/cuối bị YAML cắt mất
  if (LEADING_INDICATOR_RE.test(raw)) return true;
  if (raw.includes('\n') || raw.includes(': ') || raw.includes(' #')) return true;
  if (raw.endsWith(':')) return true;
  if (YAML11_BOOL_RE.test(raw)) return true;
  return typeof parseYamlScalar(raw) !== 'string';
}

/** Ghi một giá trị JS thành scalar YAML AN TOÀN — đọc lại phải ra đúng cái vừa ghi. */
export function emitYamlScalar(val: unknown): string {
  if (val === null || val === undefined) return '~';
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val !== 'string') return JSON.stringify(val);
  return isYamlAmbiguousScalar(val)
    ? `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    : val;
}

// ─────────────────────────────────────────────────────────────────────────────
// VÁ LẠI initvar DO AI VIẾT
// ─────────────────────────────────────────────────────────────────────────────

/** Bảng tra `đường.dẫn.đầy.đủ` → kiểu, dựng từ schema để biết ô nào đáng lẽ là chuỗi. */
function typeByPath(schema: MVUZODSchema | null | undefined): Map<string, MVUZODField['type']> {
  const map = new Map<string, MVUZODField['type']>();
  const walk = (fields: MVUZODField[] | undefined, prefix: string) => {
    for (const f of fields ?? []) {
      const name = String(f.path || '').split('/').filter(Boolean).pop() ?? '';
      if (!name) continue;
      const p = prefix ? `${prefix}.${name}` : name;
      map.set(p, f.type);
      if (Array.isArray(f.children) && f.children.length) walk(f.children, p);
    }
  };
  walk(schema?.fields, '');
  return map;
}

export interface QuoteResult {
  content: string;
  /** Những chỗ đã bọc nháy — để còn nói cho user biết tool vừa động vào cái gì. */
  fixed: string[];
}

/**
 * Bọc nháy những giá trị TRẦN mà YAML sẽ đọc sai, trong nội dung [initvar] do AI viết.
 *
 * Có schema thì chuẩn xác: ô nào schema khai là `string` mà giá trị trần lại không ra chuỗi
 * thì bọc. Không có schema thì CHỈ cứu ca null (`Null`/`null`/`~`) và giá trị dính dấu cách
 * thừa — hai thứ không bao giờ là ý định thật trong một thẻ MVU. Cố tình KHÔNG đụng
 * `true/false`/số khi thiếu schema: bọc bừa là biến boolean/số thật hoá thành chuỗi, đổi một
 * lỗi lấy một lỗi khác.
 */
export function quoteAmbiguousInitVarScalars(
  yaml: string,
  schema?: MVUZODSchema | null,
): QuoteResult {
  const src = String(yaml ?? '');
  if (!src.trim()) return { content: src, fixed: [] };

  const types = typeByPath(schema);
  const fixed: string[] = [];
  const stack: Array<{ indent: number; key: string }> = [];
  const out = src.split('\n').map((line) => {
    const m = /^(\s*)((?:'[^']*'|"[^"]*"|[^:#\n]+?))\s*:(\s*)(.*)$/.exec(line);
    if (!m) return line;

    const indent = m[1].length;
    const key = m[2].trim().replace(/^['"]|['"]$/g, '');
    const gap = m[3] || ' ';
    const value = m[4];

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const path = [...stack.map((s) => s.key), key].join('.');

    // `khoá:` trống = mở map con.
    if (value.trim() === '') {
      stack.push({ indent, key });
      return line;
    }

    const v = value.trim();
    // Bỏ qua: đã bọc nháy, cấu trúc rỗng, khối nhiều dòng, chú thích.
    if (/^['"]/.test(v) || v === '{}' || v === '[]' || /^[|>]/.test(v) || v.startsWith('#')) return line;

    const declared = types.get(path);
    const wantQuote = declared === 'string'
      ? isYamlAmbiguousScalar(v)
      : (declared === undefined && NULL_RE.test(v));

    if (!wantQuote) return line;
    fixed.push(`${path}: ${v}`);
    return `${m[1]}${m[2]}:${gap}${emitYamlScalar(v)}`;
  });

  return { content: out.join('\n'), fixed };
}
