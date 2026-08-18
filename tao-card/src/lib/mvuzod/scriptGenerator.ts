/**
 * src/lib/mvuzod/scriptGenerator.ts — Complete Script Generation Engine
 * Converts MVUZODSchema → 5 output artifacts for SillyTavern Tavern Helper:
 *
 * 1. Schema Script (registerMvuSchema) — complete JS for 酒馆助手 角色脚本
 * 2. InitVar YAML — [initvar] worldbook entry content
 * 3. Variable List Entry — Danh sách biến worldbook entry with macros
 * 4. Update Rules Entry — [mvu_update] Quy tắc cập nhật biến
 * 5. Regex Patterns — hide <UpdateVariable> blocks from chat display
 *
 * References:
 * - MVU_ZOD指南.md (from enterprise20020924-web/-)
 * - EJS実戦指南_2026_ZOD版.md
 * - 前端項目改造指南.md
 */

import { buildMvuOutputBlock } from './mvuReference';
import { emitYamlScalar } from './yamlScalars';
import { synthCheck } from './updateRulesBuilder';
import type { MVUZODSchema, MVUZODField, InitVarEntry } from '../../types/mvuzod.types';

// ═══════════════════════════════════════════════════════════════════════════
// 1. SCHEMA SCRIPT GENERATOR — registerMvuSchema complete JS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build Zod type expression for a single field.
 * Supports: coerce, clamp, min/max, pattern, prefault, describe, enum, transform, record children.
 */
function buildZodTypeExpr(field: MVUZODField, indent: number): string {
  const { constraints: c } = field;

  // Leaf types
  switch (field.type) {
    case 'number': {
      let t = c.coerce ? 'z.coerce.number()' : 'z.number()';
      if (c.clamp) {
        t += `.transform(v => _.clamp(v, ${c.clamp[0]}, ${c.clamp[1]}))`;
      } else if (c.transformExpr) {
        t += `.transform(${c.transformExpr})`;
      } else {
        if (c.min !== undefined) t += `.min(${c.min})`;
        if (c.max !== undefined) t += `.max(${c.max})`;
      }
      if (c.prefault !== undefined) t += `.prefault(${JSON.stringify(c.prefault)})`;
      if (c.describe) t += `.describe('${escapeQuotes(c.describe)}')`;
      return t;
    }

    case 'string': {
      let t = 'z.string()';
      if (c.enumValues?.length) {
        t = `z.enum([${c.enumValues.map(v => `'${escapeQuotes(v)}'`).join(', ')}])`;
      }
      if (c.pattern) t += `.regex(/${c.pattern}/)`;
      if (c.prefault !== undefined) t += `.prefault(${JSON.stringify(c.prefault)})`;
      if (c.describe) t += `.describe('${escapeQuotes(c.describe)}')`;
      return t;
    }

    case 'boolean': {
      let t = 'z.boolean()';
      if (c.prefault !== undefined) t += `.prefault(${JSON.stringify(c.prefault)})`;
      return t;
    }

    case 'record': {
      // Build record key and value types
      const keyType = c.describe
        ? `z.string().describe('${escapeQuotes(c.describe)}')`
        : 'z.string()';

      // If record has children template, build complex value type
      if (field.children?.length) {
        const valueFields = field.children
          .map(child => {
            const childName = zodKey(getFieldName(child));
            const childType = buildZodTypeExpr(child, indent + 1);
            return `${pad(indent + 2)}${childName}: ${childType},`;
          })
          .join('\n');
        return `z.record(\n${pad(indent + 1)}${keyType},\n${pad(indent + 1)}z.object({\n${valueFields}\n${pad(indent + 1)}}),\n${pad(indent)})`;
      }

      return `z.record(${keyType}, z.string())`;
    }

    case 'array': {
      let itemType = 'z.string()';
      if (field.children?.length) {
        const firstChild = field.children[0];
        itemType = buildZodTypeExpr(firstChild, indent + 1);
      }
      return `z.array(${itemType})`;
    }

    case 'object': {
      if (!field.children?.length) return 'z.object({})';
      // Handled by renderFieldBlock for nested objects
      return 'z.unknown()';
    }

    default:
      return 'z.unknown()';
  }
}

/**
 * Render a complete field block (including nested children for objects).
 * Returns array of code lines.
 */
function renderFieldBlock(field: MVUZODField, indent: number): string[] {
  const name = getFieldName(field);
  const lines: string[] = [];

  if (field.type === 'object' && field.children?.length) {
    // Object with children → z.object({...})
    const hasTransform = !!field.constraints?.transformExpr;

    lines.push(`${pad(indent)}${zodKey(name)}: z.object({`);
    for (const child of field.children) {
      if (child.type === 'object' && child.children?.length) {
        lines.push(...renderFieldBlock(child, indent + 1));
      } else if (child.type === 'record' && child.children?.length) {
        // Record with complex value
        const recordType = buildZodTypeExpr(child, indent + 1);
        lines.push(`${pad(indent + 1)}${zodKey(getFieldName(child))}: ${recordType},`);
      } else {
        const zodType = buildZodTypeExpr(child, indent + 1);
        lines.push(`${pad(indent + 1)}${zodKey(getFieldName(child))}: ${zodType},`);
      }
    }

    if (hasTransform) {
      lines.push(`${pad(indent)}})`);
      lines.push(`${pad(indent + 1)}.transform(${field.constraints?.transformExpr}),`);
    } else {
      lines.push(`${pad(indent)}}),`);
    }
  } else if (field.type === 'record' && field.children?.length) {
    // Record with children template
    const recordType = buildZodTypeExpr(field, indent);
    const hasTransform = !!field.constraints?.transformExpr;
    if (hasTransform) {
      lines.push(`${pad(indent)}${zodKey(name)}: ${recordType}`);
      lines.push(`${pad(indent + 1)}.transform(${field.constraints?.transformExpr}),`);
    } else {
      lines.push(`${pad(indent)}${zodKey(name)}: ${recordType},`);
    }
  } else {
    // Simple field
    const zodType = buildZodTypeExpr(field, indent);
    lines.push(`${pad(indent)}${zodKey(name)}: ${zodType},`);
  }

  return lines;
}

/**
 * Generate complete registerMvuSchema script from schema.
 * Output follows the exact pattern from MVU_ZOD指南.md:
 *
 * ```js
 * import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/.../mvu_zod.js';
 *
 * export const Schema = z.object({
 *   // fields...
 * });
 *
 * $(() => {
 *   registerMvuSchema(Schema);
 * });
 * ```
 */
export function generateSchemaScript(schema: MVUZODSchema): string {
  const lines: string[] = [
    "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';",
    '',
    'export const Schema = z.object({',
  ];

  for (const field of schema.fields) {
    lines.push(...renderFieldBlock(field, 1));
  }

  lines.push('});');
  lines.push('');
  lines.push('$(() => {');
  lines.push('  registerMvuSchema(Schema);');
  lines.push('});');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. INITVAR YAML GENERATOR — [initvar] worldbook entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert schema + initial values to YAML format for [initvar] worldbook entry.
 * If `values` is provided, uses those values; otherwise uses schema defaults.
 */
export function generateInitVarYAML(
  schema: MVUZODSchema,
  values?: Record<string, unknown>,
): string {
  if (values && Object.keys(values).length > 0) {
    return objectToYAML(values, 0);
  }
  return fieldsToYAML(schema.fields, 0);
}

/**
 * Generate InitVar YAML from an InitVarEntry (for per-opening initvar blocks).
 * Wraps the YAML in <initvar>...</initvar> tags for use in opening messages.
 */
export function generateInitVarBlock(entry: InitVarEntry): string {
  const yaml = objectToYAML(entry.data, 0);
  return `<UpdateVariable>\n<initvar>\n${yaml}\n</initvar>\n</UpdateVariable>`;
}

function fieldsToYAML(fields: MVUZODField[], indent: number): string {
  const lines: string[] = [];
  const p = '  '.repeat(indent);

  for (const field of fields) {
    const name = getFieldName(field);

    // (bug 155) `record` LUÔN khởi tạo rỗng `{}`, kể cả khi có children.
    // Children "_child" là KHAI CẤU TRÚC một mục, không phải dữ liệu có sẵn. Nhánh cũ đẻ ra một
    // khoá mẫu tên `样例条目` — hai cái sai cùng lúc: chữ Hán nằm trong thẻ tiếng Việt, và một
    // tên khoá giả được khai sẵn thì MỖI LẦN khởi tạo lại nó lại đè lên dữ liệu thật của người
    // chơi. Trước bug 148-2 record không có children nên nhánh này gần như không chạy; thêm
    // `_child` vào là nó bắt đầu chạy cho mọi record.
    const realKids = (field.children ?? []).filter(c => !String(c.path || '').includes('/_child/'));
    if (field.type === 'record') {
      lines.push(`${p}${name}: {}`);
    } else if (realKids.length && field.type === 'object') {
      lines.push(`${p}${name}:`);
      lines.push(fieldsToYAML(realKids, indent + 1));
    } else if (field.type === 'array') {
      const arr = field.defaultValue;
      if (Array.isArray(arr) && arr.length > 0) {
        lines.push(`${p}${name}:`);
        for (const item of arr) {
          lines.push(`${p}  - ${formatYAMLValue(item)}`);
        }
      } else {
        lines.push(`${p}${name}: []`);
      }
    } else {
      // (bug 116 — học phong cách thẻ mẫu One Piece) Trường CHUỖI tự do (không enum, không
      // readOnly) khởi tạo bằng "" — ô trống chờ Opening Form/AI điền lúc chơi. Bản cũ ghi
      // thẳng placeholder AI bịa trong defaultValue ("Vô Danh", "Chưa thức tỉnh") → trình
      // quản lý biến đầy giá trị giả, không phân biệt được ô nào user cần điền.
      // Enum giữ default (là một lựa chọn hợp lệ, vd "Chủng Tộc: Con Người"); số/boolean giữ
      // nguyên (0/100/false là giá trị thật) — đúng như thẻ mẫu.
      const isFreeString = field.type === 'string'
        && !field.constraints?.enumValues?.length
        && !field.constraints?.readOnly;
      const val = isFreeString
        ? '""'
        : formatYAMLValue(field.defaultValue ?? getDefaultForType(field.type));
      lines.push(`${p}${name}: ${val}`);
    }
  }

  return lines.join('\n');
}

function objectToYAML(obj: unknown, indent: number): string {
  const lines: string[] = [];
  const p = '  '.repeat(indent);

  if (obj === null || obj === undefined) return `${p}~`;
  if (typeof obj !== 'object') return `${p}${formatYAMLValue(obj)}`;

  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${p}[]`;
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        return `${p}-\n${objectToYAML(item, indent + 1)}`;
      }
      return `${p}- ${formatYAMLValue(item)}`;
    }).join('\n');
  }

  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return `${p}{}`;

  for (const [key, val] of entries) {
    if (typeof val === 'object' && val !== null && !Array.isArray(val) && Object.keys(val).length > 0) {
      lines.push(`${p}${key}:`);
      lines.push(objectToYAML(val, indent + 1));
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${p}${key}: []`);
      } else {
        lines.push(`${p}${key}:`);
        lines.push(objectToYAML(val, indent));
      }
    } else {
      lines.push(`${p}${key}: ${formatYAMLValue(val)}`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. VARIABLE LIST ENTRY GENERATOR — Danh sách biến worldbook entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the Variable List worldbook entry content.
 * Uses {{format_message_variable::stat_data}} macros.
 *
 * Two modes:
 * - 'full': Single macro for all variables
 * - 'selective': Individual macros per top-level field for granular control
 */
export function generateVariableListEntry(
  schema: MVUZODSchema,
  mode: 'full' | 'selective' = 'full',
): string {
  const lines: string[] = ['---', '<status_current_variable>'];

  if (mode === 'full') {
    lines.push('{{format_message_variable::stat_data}}');
  } else {
    // Selective: mỗi biến một macro riêng, ĐI HẾT MỌI TẦNG.
    // Bản cũ chỉ xuống đúng một tầng con: schema 3 tầng trở lên (Người Chơi → Chỉ Số → HP) thì
    // tầng trong cùng không bao giờ được liệt kê, mà tầng giữa lại in ra nguyên cụm object.
    // record/array là lá theo nghĩa hiển thị — khoá của chúng chỉ có lúc chơi nên in cả cụm.
    const walk = (fields: MVUZODField[], prefix: string, indent: number) => {
      for (const field of fields) {
        const name = getFieldName(field);
        if (!name || field.constraints?.hidden) continue;
        const path = prefix ? `${prefix}.${name}` : name;
        const pad = '  '.repeat(indent);
        const kids = (field.children ?? []).filter(c => !String(c.path || '').includes('/_child/'));

        if (kids.length && field.type === 'object') {
          lines.push(`${pad}${name}:`);
          walk(kids, path, indent + 1);
        } else {
          lines.push(`${pad}${name}: {{format_message_variable::stat_data.${path}}}`);
        }
      }
    };
    walk(schema.fields, '', 0);
  }

  lines.push('</status_current_variable>');
  return lines.join('\n');
}

/**
 * Generate worldbook entry metadata for the Variable List entry.
 */
export function getVariableListEntryConfig() {
  return {
    comment: 'Danh sách biến',
    position: 'at_depth_system' as const,
    depth: 0,
    order: 200,
    constant: true,
    keys: [] as string[],
    description: 'Hiển thị giá trị biến hiện tại cho AI. Đặt tại D0 hoặc D1.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. UPDATE RULES ENTRY GENERATOR — [mvu_update] Quy tắc cập nhật biến
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the Update Rules worldbook entry content.
 * Follows pattern from MVU_ZOD指南.md "第六步：配置酒馆正则" section.
 */
export function generateUpdateRulesEntry(schema: MVUZODSchema): string {
  const lines: string[] = ['---', 'Quy tắc cập nhật biến:'];

  for (const field of schema.fields) {
    processUpdateRuleField(field, 1, lines);
  }

  // (bug 159-8) DẠY CÁCH CHÈN VÀO MẢNG / TỪ ĐIỂN.
  // Luật array/record đã có trong prompt lúc TẠO thẻ, nhưng entry này là thứ AI đọc lúc CHƠI — và
  // nó im lặng hoàn toàn về hai kiểu đó. Nên AI chỉ biết replace/delta các biến phẳng, còn Túi Đồ
  // với Hồ Sơ Quan Hệ đứng nguyên rỗng suốt ván. Đúng cảnh user báo: "mới chỉ được tạo giao diện,
  // chưa có logic xử lý và cập nhật dữ liệu".
  // Chỉ in khi thẻ THẬT SỰ có array/record, và nêu ĐÍCH DANH đường dẫn — luật chung chung thì AI
  // phải tự suy đường dẫn, mà suy sai là lệnh trỏ vào chỗ không tồn tại rồi bị MVU bỏ.
  const arrays: string[] = [];
  const records: string[] = [];
  const scan = (fields: MVUZODField[], prefix: string) => {
    for (const f of fields ?? []) {
      const nm = getFieldName(f);
      if (!nm || nm.startsWith('_')) continue;
      const path = prefix ? `${prefix}/${nm}` : nm;
      if (f.type === 'array') arrays.push(path);
      else if (f.type === 'record') records.push(path);
      const kids = (f.children ?? []).filter(c => !String(c.path || '').includes('/_child/'));
      if (kids.length) scan(kids, path);
    }
  };
  scan(schema.fields ?? [], '');

  if (arrays.length || records.length) {
    lines.push('');
    lines.push('Cách thêm/bớt mục trong danh sách và từ điển:');
  }
  for (const a of arrays) {
    lines.push(`  ${a} (DANH SÁCH — tra theo thứ tự, số phần tử đổi khi chơi):`);
    lines.push(`    - thêm mục mới: {"op":"insert","path":"/${a}/-","value":{…}}  ← path KẾT THÚC bằng "/-"`);
    lines.push(`    - sửa mục đã có: {"op":"replace","path":"/${a}/0/<trường>","value":…}  ← dùng CHỈ SỐ 0,1,2…`);
    lines.push(`    - bỏ mục: {"op":"remove","path":"/${a}/0"}`);
    lines.push('    - KHÔNG insert lại mục đã có trong danh sách — hãy replace trường của mục đó.');
  }
  for (const r of records) {
    lines.push(`  ${r} (TỪ ĐIỂN — tra theo TÊN, tên chỉ biết khi chơi):`);
    lines.push(`    - gặp lần ĐẦU (tên chưa có): {"op":"insert","path":"/${r}/<tên cụ thể>","value":{…}}`);
    lines.push(`    - đã có tên đó: {"op":"replace","path":"/${r}/<tên cụ thể>/<trường>","value":…}`);
    lines.push('    - PHẢI kiểm tên đã tồn tại chưa trước khi chọn insert hay replace: insert đè lên tên đã có sẽ xoá sạch dữ liệu cũ của mục đó.');
  }

  return lines.join('\n');
}

function processUpdateRuleField(field: MVUZODField, indent: number, lines: string[]) {
  const name = getFieldName(field);
  const p = '  '.repeat(indent);

  // Skip readonly fields
  if (name.startsWith('_') || field.constraints?.readOnly) return;

  if (field.children?.length && (field.type === 'object')) {
    lines.push(`${p}${name}:`);
    for (const child of field.children) {
      processUpdateRuleField(child, indent + 1, lines);
    }
    return;
  }

  // Leaf field — generate rule
  lines.push(`${p}${name}:`);

  // Type info
  if (field.constraints?.updateType) {
    const typeLines = field.constraints?.updateType.split('\n');
    if (typeLines.length > 1) {
      lines.push(`${p}  type: |-`);
      for (const line of typeLines) {
        lines.push(`${p}    ${line}`);
      }
    } else {
      lines.push(`${p}  type: ${field.constraints?.updateType}`);
    }
  } else if (field.type === 'number') {
    lines.push(`${p}  type: number`);
  } else if (field.type === 'record') {
    // Generate TypeScript-like type signature
    const keyDesc = field.constraints?.describe ?? 'key';
    if (field.children?.length) {
      lines.push(`${p}  type: |-`);
      lines.push(`${p}    {`);
      lines.push(`${p}      [${keyDesc}: string]: {`);
      for (const child of field.children) {
        const childName = getFieldName(child);
        const childType = child.type === 'number' ? 'number'
          : child.type === 'boolean' ? 'boolean'
            : 'string';
        const optional = child.constraints?.prefault !== undefined ? '?' : '';
        const comment = child.constraints?.prefault !== undefined
          ? `  // mặc định: ${JSON.stringify(child.constraints?.prefault)}`
          : '';
        lines.push(`${p}        ${childName}${optional}: ${childType};${comment}`);
      }
      lines.push(`${p}      }`);
      lines.push(`${p}    }`);
    }
  }

  // Range
  if (field.constraints?.updateRange) {
    lines.push(`${p}  range: ${field.constraints?.updateRange}`);
  } else if (field.constraints?.clamp) {
    lines.push(`${p}  range: ${field.constraints?.clamp[0]}~${field.constraints?.clamp[1]}`);
  }

  // Format
  if (field.constraints?.updateFormat) {
    lines.push(`${p}  format: ${field.constraints?.updateFormat}`);
  }

  // Check rules
  if (field.constraints?.checkRules?.length) {
    lines.push(`${p}  check:`);
    for (const rule of field.constraints.checkRules) {
      lines.push(`${p}    - ${rule}`);
    }
    return;
  }

  // (bugNeedFix/112, làm tiếp cho tab Update) Lá KHÔNG có checkRules trước đây ra đúng một dòng
  // `Tên:` trống trơn — schema do AI sinh hầu như chẳng bao giờ có sẵn checkRules, nên phần lớn
  // biến string/boolean rơi vào đây. AI trong game đọc entry thấy tên biến mà không thấy luật nào
  // thì để nguyên biến đó cả ván: đúng lời user "có cái cập nhật được, có cái không".
  // Sinh bù bằng CHÍNH bộ luật Auto Creator dùng (updateRulesBuilder.synthCheck) để hai đường ra
  // — Studio và Auto Creator — không còn lệch nội dung.
  const synth = synthCheck(field, name);
  if (synth.length) {
    lines.push(`${p}  check:`);
    for (const rule of synth) {
      lines.push(`${p}    - ${rule}`);
    }
  }
}

/**
 * Generate the Output Format worldbook entry content.
 * Tells AI to output JSON Patch in <UpdateVariable> blocks.
 */
export function generateOutputFormatEntry(schema: MVUZODSchema): string {
  // Build a sample JSON Patch from schema to show AI the format
  const sampleOps: string[] = [];

  for (const field of schema.fields) {
    const sampleChild = field.children?.find(c => !c.constraints?.readOnly);
    if (sampleChild) {
      const parentName = getFieldName(field);
      const childName = getFieldName(sampleChild);

      if (sampleChild.type === 'number') {
        sampleOps.push(`{"op":"delta","path":"/${parentName}/${childName}","value":1}`);
      } else if (sampleChild.type === 'string') {
        sampleOps.push(`{"op":"replace","path":"/${parentName}/${childName}","value":"新的值"}`);
      }

      if (sampleOps.length >= 2) break;
    }
  }

  if (sampleOps.length === 0) {
    sampleOps.push('{"op":"replace","path":"/例子/值","value":"mới"}');
  }

  // (User 23/07 — việc 87) TRƯỚC ĐÂY xuất mảng JSON ĐỂ TRẦN trong <UpdateVariable>. MVU đọc mảng
  // lệnh BÊN TRONG <JSONPatch> nên để trần là parse không ra — mọi thẻ Auto Creator tạo đều dính
  // ❌ "thiếu thẻ con <Analysis>/<JSONPatch>". Đối chiếu thẻ thật đang chạy được (bug/) và dùng
  // chung khuôn ở mvuReference.ts để bộ sinh, bộ kiểm và prompt không bao giờ lệch nhau nữa.
  const block = buildMvuOutputBlock(sampleOps)
    .split('\n').map(l => `    ${l}`).join('\n');
  return `variables_update_format:
  rule:
    - Xuất JSON Patch ở CUỐI mỗi reply, không được bỏ qua
    - Mảng lệnh PHẢI nằm trong <JSONPatch>, và phải có <Analysis> đi kèm
    - Dùng 5 operators: replace, delta, insert, remove, move
    - delta PHẢI là number (không có quotes)
    - Không cập nhật field bắt đầu bằng _ (readonly)
    - Khi tạo entry mới trong record: insert TOÀN BỘ data, không bỏ sót field
    - Đường dẫn giữ NGUYÊN tên biến (có dấu, có khoảng trắng), không đổi sang snake_case
  format: |
${block}`;
}

/**
 * Generate emphasis entry — reminds AI to always output UpdateVariable block.
 */
export function generateEmphasisEntry(): string {
  // Nhắc lại ĐỦ cấu trúc chứ không chỉ tên thẻ ngoài cùng: entry này nằm ở D0 (cuối prompt) nên
  // là thứ model đọc sau chót — nói thiếu ở đây là model quên mất hai thẻ con.
  return `Nhấn mạnh: Sau MỖI reply, BẮT BUỘC xuất khối cập nhật biến đầy đủ:
<UpdateVariable>
  <Analysis>…tóm tắt bằng tiếng Anh những gì vừa đổi…</Analysis>
  <JSONPatch>[ …lệnh… ]</JSONPatch>
</UpdateVariable>
Mảng lệnh PHẢI nằm trong <JSONPatch> — để trần là không cập nhật được biến.
Không được bỏ qua dù chỉ 1 lượt. Nếu không có thay đổi, xuất <JSONPatch>[]</JSONPatch>.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. REGEX PATTERNS GENERATOR — hide <UpdateVariable> from display
// ═══════════════════════════════════════════════════════════════════════════

export interface GeneratedRegex {
  name: string;
  findRegex: string;
  replaceString: string;
  description: string;
  scope: 'ai_output' | 'user_input' | 'both';
}

/**
 * Generate regex patterns for hiding/processing MVUZOD tags in SillyTavern.
 */
export function generateRegexPatterns(): GeneratedRegex[] {
  return [
    {
      name: '[MVU] Ẩn UpdateVariable',
      findRegex: '<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>',
      replaceString: '',
      description: 'Ẩn block <UpdateVariable>...</UpdateVariable> khỏi hiển thị chat',
      scope: 'ai_output',
    },
    {
      name: '[MVU] Ẩn initvar block',
      findRegex: '<initvar>[\\s\\S]*?<\\/initvar>',
      replaceString: '',
      description: 'Ẩn block <initvar>...</initvar> trong opening messages',
      scope: 'ai_output',
    },
    {
      name: '[MVU] Ẩn JSONPatch',
      findRegex: '<JSONPatch>[\\s\\S]*?<\\/JSONPatch>',
      replaceString: '',
      description: 'Ẩn block <JSONPatch>...</JSONPatch> khỏi hiển thị',
      scope: 'ai_output',
    },
    {
      name: '[MVU] Status Placeholder',
      findRegex: '<StatusPlaceHolder(?:Impl)?\\s*\\/>',
      replaceString: '<div class="mvu-status-placeholder"></div>',
      description: 'Chuyển <StatusPlaceHolderImpl/> thành div cho Tavern Helper render',
      scope: 'ai_output',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED — Generate all outputs at once
// ═══════════════════════════════════════════════════════════════════════════

export interface AllGeneratedOutputs {
  schemaScript: string;
  initVarYAML: string;
  variableListEntry: string;
  updateRulesEntry: string;
  outputFormatEntry: string;
  emphasisEntry: string;
  regexPatterns: GeneratedRegex[];
}

/**
 * Generate all 5 output artifacts from a single schema.
 */
export function generateAllOutputs(
  schema: MVUZODSchema,
  initVarValues?: Record<string, unknown>,
  variableListMode: 'full' | 'selective' = 'full',
): AllGeneratedOutputs {
  return {
    schemaScript: generateSchemaScript(schema),
    initVarYAML: generateInitVarYAML(schema, initVarValues),
    variableListEntry: generateVariableListEntry(schema, variableListMode),
    updateRulesEntry: generateUpdateRulesEntry(schema),
    outputFormatEntry: generateOutputFormatEntry(schema),
    emphasisEntry: generateEmphasisEntry(),
    regexPatterns: generateRegexPatterns(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function pad(n: number): string {
  return '  '.repeat(n);
}

function getFieldName(field: MVUZODField): string {
  return field.path.split('/').filter(Boolean).pop() ?? field.path;
}

/**
 * (bugNeedFix/97) Tên biến làm KHOÁ trong code Zod/JS thì phải BỌC NHÁY khi không phải một
 * identifier hợp lệ.
 *
 * Chuẩn tên biến của bộ tool là DÙNG DẤU CÁCH ("Thế Giới", "Khung Giờ") — đã chốt ở bug #8 sau khi
 * bản ép `_` làm 272 chỗ trong thẻ user lệch nhau. Dấu cách hoàn toàn hợp lệ với MVU vì MVU truy
 * biến bằng KHOÁ CHUỖI. Cái KHÔNG hợp lệ là viết khoá trần trong code:
 *     Thế Giới: z.object({ … })   ← SyntaxError, cả file schema chết
 *     "Thế Giới": z.object({ … }) ← đúng
 * Đây chính là lỗi mà người báo bug gặp và đề xuất chữa bằng `_`. Bọc nháy chữa tận gốc mà không
 * phải đổi chuẩn tên biến (đổi chuẩn sẽ làm thẻ sinh mới lệch với thẻ đã dịch).
 */
export function zodKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function escapeQuotes(s: unknown): string {
  if (typeof s !== 'string') {
    s = typeof s === 'object' ? JSON.stringify(s) : String(s);
  }
  return (s as string).replace(/'/g, "\\'");
}

function getDefaultForType(type: string): unknown {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'string': return '';
    case 'array': return [];
    case 'record': return {};
    case 'object': return {};
    default: return null;
  }
}

/**
 * (bug 174) Bản cũ chỉ bọc nháy khi chuỗi có `\n`, `:`, `#` hoặc mở đầu bằng `{`/`[`. Nó bỏ lọt
 * đúng lớp nguy hiểm nhất: chuỗi TRÔNG NHƯ thứ khác. `Null` để trần bị YAML đọc thành RỖNG, và
 * enum Zod `['…','Null']` không nhận null ⇒ thẻ vừa nhập vào SillyTavern là đỏ, không nạp được
 * biến nào. Cùng họ: "123", "true", "~", ".inf", chuỗi có dấu cách ở đầu/cuối.
 * Nay giao hẳn cho yamlScalars.ts — nơi bên ĐỌC cũng lấy luật, nên hai bên không thể lệch nữa.
 */
function formatYAMLValue(val: unknown): string {
  return emitYamlScalar(val);
}
