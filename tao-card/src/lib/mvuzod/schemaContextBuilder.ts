/**
 * schemaContextBuilder.ts — Build schema context text for batch generation prompts
 *
 * Khi đã có MVUZOD schema, flatten các fields thành text mô tả ngắn gọn
 * để inject vào prompt AI → AI tạo entries tương thích với hệ biến.
 */

import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Flatten schema thành text context cho batch generation prompt.
 * Output mô tả toàn bộ cây biến, kèm kiểu + constraints + description.
 */
export function buildSchemaContextForBatch(schema: MVUZODSchema): string {
  if (!schema?.fields?.length) return '';

  const lines: string[] = [];
  lines.push('=== HỆ THỐNG BIẾN (MVUZOD Schema) ===');
  lines.push('Card này sử dụng hệ thống biến MVU-ZOD. Dưới đây là cấu trúc biến:');
  lines.push('');

  flattenFields(schema.fields, lines, 0);

  lines.push('');
  lines.push('--- HƯỚNG DẪN VIẾT ENTRY BÁM SCHEMA (QUAN TRỌNG) ---');
  lines.push('• BẮT BUỘC: entry mô tả NHÂN VẬT/NPC phải GÁN GIÁ TRỊ CỤ THỂ cho các chỉ số của nhân vật CÓ TRONG SCHEMA ở trên. Ví dụ nếu schema có võ lực / trí lực / thể lực / mị lực… thì mỗi entry NPC phải ghi rõ từng chỉ số một con số/mức hợp lý theo nhân vật đó (vd "Võ lực: 85, Trí lực: 60").');
  lines.push('• Entry mô tả địa điểm / vật phẩm / thế lực → đề cập các biến liên quan tương ứng trong schema (nếu schema có).');
  lines.push('• DÙNG ĐÚNG TÊN biến như liệt kê trong schema ở trên; KHÔNG bịa thêm biến ngoài schema, KHÔNG bỏ sót các chỉ số chính của nhân vật.');
  lines.push('• KHÔNG viết code EJS/getvar trong content — chỉ ghi giá trị bằng ngôn ngữ tự nhiên / danh sách.');
  lines.push('• Content theo format database (YAML/danh sách), viết ngôi thứ ba.');

  return lines.join('\n');
}

/**
 * Tạo summary ngắn gọn cho UI preview (hiển thị trong BatchGeneratorPanel).
 * Returns: { fieldCount, topLevelNames, summary }
 */
export function getSchemaPreviewSummary(schema: MVUZODSchema): {
  fieldCount: number;
  topLevelNames: string[];
  summary: string;
} {
  if (!schema?.fields?.length) {
    return { fieldCount: 0, topLevelNames: [], summary: 'Schema trống' };
  }

  const fieldCount = countAllFields(schema.fields);
  const topLevelNames = schema.fields.map(f => f.label);
  const summary = `${fieldCount} fields — ${topLevelNames.slice(0, 5).map(n => `/${n}`).join(', ')}${topLevelNames.length > 5 ? '...' : ''}`;

  return { fieldCount, topLevelNames, summary };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function flattenFields(fields: MVUZODField[], lines: string[], depth: number): void {
  for (const field of fields) {
    const indent = '  '.repeat(depth);
    const typeStr = formatFieldType(field);
    const constraintsStr = formatConstraints(field);
    const descStr = field.description ? ` — ${field.description}` : (field.label !== field.path.split('/').pop() ? ` — ${field.label}` : '');

    if (field.children?.length) {
      // Object/group node
      lines.push(`${indent}📂 ${field.path} (${field.type})${descStr}`);
      flattenFields(field.children, lines, depth + 1);
    } else {
      // Leaf node
      lines.push(`${indent}• ${field.path} (${typeStr})${constraintsStr}${descStr}`);
    }
  }
}

function formatFieldType(field: MVUZODField): string {
  let typeStr: string = field.type;
  if (field.constraints?.coerce) {
    typeStr = `coerce.${typeStr}`;
  }
  if (field.constraints?.enumValues?.length) {
    typeStr = `enum[${field.constraints?.enumValues.join('|')}]`;
  }
  return typeStr;
}

function formatConstraints(field: MVUZODField): string {
  const parts: string[] = [];
  const c = field.constraints;

  if (c.min !== undefined || c.max !== undefined) {
    parts.push(`range: ${c.min ?? ''}~${c.max ?? ''}`);
  }
  if (c.clamp) {
    parts.push(`clamp: ${c.clamp[0]}~${c.clamp[1]}`);
  }
  if (c.readOnly) {
    parts.push('readonly');
  }
  if (c.hidden) {
    parts.push('hidden');
  }
  if (c.prefault !== undefined) {
    parts.push(`default: ${JSON.stringify(c.prefault)}`);
  }
  if (c.updateRange) {
    parts.push(`update: ${c.updateRange}`);
  }
  if (c.describe) {
    parts.push(`describe: "${c.describe}"`);
  }

  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}

function countAllFields(fields: MVUZODField[]): number {
  let count = 0;
  for (const field of fields) {
    count++;
    if (field.children?.length) {
      count += countAllFields(field.children);
    }
  }
  return count;
}
