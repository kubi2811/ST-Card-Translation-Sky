/**
 * src/lib/mvuzod/systemEntriesBuilder.ts — Build 5 MVUZOD System Entries
 * Spec 9C Bước 4: EJS Controller, Update Rules, Output Format, Emphasis, InitVar
 */

import type { LorebookEntry } from '../../types';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { materializeEntry } from '../converters/cardDefaults';

// ═══════════════════════════════════════════════════════════════════════════
// BUILD 5 SYSTEM ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build 5 MVUZOD system entries from schema.
 * Returns entries ready to be added to lorebook.
 */
export function buildMVUZODSystemEntries(
  schema: MVUZODSchema,
  _cardName: string,
  existingEntries: LorebookEntry[],
): LorebookEntry[] {
  const entries: LorebookEntry[] = [];
  let baseId = Math.max(0, ...existingEntries.map(e => e.id)) + 1;

  // Entry 1: EJS Controller
  entries.push(materializeEntry({
    comment: 'Bộ điều khiển EJS',
    keys: [],
    content: buildEJSControllerContent(schema),
  }, {
    defaultPosition: 0,
    insertionOrderStart: 10,
  }, baseId++));
  // Patch: constant=true
  entries[entries.length - 1].constant = true;

  // Entry 2: [mvu_update] Update Rules
  entries.push(materializeEntry({
    comment: '[mvu_update] Quy tắc cập nhật biến',
    keys: [],
    content: buildUpdateRulesContent(schema),
  }, {
    defaultPosition: 0,
    insertionOrderStart: 11,
  }, baseId++));
  entries[entries.length - 1].constant = true;

  // Entry 3: [mvu_update] Output Format
  entries.push(materializeEntry({
    comment: '[mvu_update] Định dạng đầu ra biến',
    keys: [],
    content: buildOutputFormatContent(),
  }, {
    defaultPosition: 0,
    insertionOrderStart: 12,
  }, baseId++));
  entries[entries.length - 1].constant = true;

  // Entry 4: [mvu_update] Emphasis (depth=0)
  entries.push(materializeEntry({
    comment: '[mvu_update] Nhấn mạnh định dạng đầu ra biến',
    keys: [],
    content: buildEmphasisContent(),
  }, {
    defaultPosition: 4,  // @depth
    insertionOrderStart: 13,
  }, baseId++));
  entries[entries.length - 1].constant = true;
  entries[entries.length - 1].extensions.depth = 0;
  entries[entries.length - 1].extensions.role = 0; // system

  // Entry 5: [initvar] Init Variables
  entries.push(materializeEntry({
    comment: '[initvar] Khởi tạo biến - đừng mở',
    keys: [],
    content: buildInitVarContent(schema),
  }, {
    defaultPosition: 0,
    insertionOrderStart: 14,
    // (bug 72) Entry khởi tạo phải TẮT: engine MVU đọc nội dung nó làm template biến.
    // Để bật thì khối YAML bị bơm vào prompt như lore thường, còn biến thì không bao giờ
    // được khởi tạo — đúng triệu chứng "tạo xong card không chơi được MVU".
    enabled: false,
  }, baseId));
  entries[entries.length - 1].constant = true;
  entries[entries.length - 1].selective = false;

  return entries;
}

/**
 * Check which system entries already exist (by comment).
 */
export function findExistingSystemEntries(
  existingEntries: LorebookEntry[],
): { comment: string; id: number }[] {
  const systemComments = [
    'Bộ điều khiển EJS',
    '[mvu_update] Quy tắc cập nhật biến',
    '[mvu_update] Định dạng đầu ra biến',
    '[mvu_update] Nhấn mạnh định dạng đầu ra biến',
    '[initvar] Khởi tạo biến - đừng mở',
  ];

  return existingEntries
    .filter(e => systemComments.some(c => e.comment.includes(c)))
    .map(e => ({ comment: e.comment, id: e.id }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

function buildEJSControllerContent(schema: MVUZODSchema): string {
  const varReads: string[] = [];

  // Find enum fields (typically "XXX hiện tại" in world state)
  const worldFields = schema.fields.find(f => f.path.includes('Trạng thái thế giới'))?.children ?? [];
  for (const field of worldFields) {
    const name = field.path.split('/').pop() ?? '';
    const varName = '_' + name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '');
    varReads.push(
      `if (typeof ${varName} === 'undefined') var ${varName} = getvar('stat_data.Trạng thái thế giới.${name}', { defaults: ${JSON.stringify(field.defaultValue)} });`
    );
  }

  return `@@preprocessing
<%_
// Đọc biến từ stat_data (TavernHelper variables)
${varReads.join('\n')}
// Kích hoạt/tắt entries theo era bằng activateEntry(id, bool) hoặc setEntryEnabled(comment, bool)
_%>`;
}

function buildUpdateRulesContent(schema: MVUZODSchema): string {
  const lines = ['Quy tắc cập nhật biến:'];
  lines.push('  _Quy tắc toàn cục:');
  lines.push('    - Chỉ cập nhật những thứ thực sự thay đổi trong lượt này');
  lines.push('    - NPC không xuất hiện → giữ nguyên, không cập nhật');
  lines.push('    - Cấm bỏ sót, cấm lược bớt khi tạo NPC mới');

  for (const field of schema.fields) {
    const name = field.path.split('/').pop() ?? field.path;
    lines.push(`  ${name}:`);
    if (field.children) {
      for (const child of field.children) {
        const childName = child.path.split('/').pop() ?? child.path;
        lines.push(`    ${childName}:`);
        lines.push(`      type: ${child.type}${child.constraints?.clamp ? ` [${child.constraints?.clamp[0]}-${child.constraints?.clamp[1]}]` : ''}`);
        if (child.description) lines.push(`      note: ${child.description}`);
      }
    } else if (field.type === 'record') {
      lines.push(`    type: Record`);
      lines.push(`    note: ${field.description ?? 'Key-value mapping'}`);
    }
  }

  return lines.join('\n');
}

function buildOutputFormatContent(): string {
  return `variables_update_format:
  rule:
    - Xuất JSON Patch ở CUỐI mỗi reply, không được bỏ qua
    - Dùng 5 operators: replace, delta, insert, remove, move
    - delta PHẢI là number (không có quotes)
    - Không cập nhật field bắt đầu bằng _ (readonly)
    - Khi tạo NPC mới: insert TOÀN BỘ data, không bỏ sót field
  format: |
    <UpdateVariable>
    [{"op":"replace","path":"/Trạng thái thế giới/Loại cảnh hiện tại","value":"Chiến đấu"},
     {"op":"delta","path":"/Người chơi/Trạng thái tu luyện/Cấp bậc hồn lực","value":1}]
    </UpdateVariable>`;
}

function buildEmphasisContent(): string {
  return `Nhấn mạnh: Sau MỖI reply, BẮT BUỘC xuất block <UpdateVariable>...</UpdateVariable>
Không được bỏ qua dù chỉ 1 lượt. Nếu không có thay đổi, xuất mảng rỗng [].`;
}

function buildInitVarContent(schema: MVUZODSchema): string {
  return schemaToYAML(schema.fields, 0);
}

function schemaToYAML(fields: MVUZODField[], indent: number): string {
  const lines: string[] = [];
  const pad = '  '.repeat(indent);

  for (const field of fields) {
    const name = field.path.split('/').pop() ?? field.path;

    if (field.children?.length) {
      lines.push(`${pad}${name}:`);
      lines.push(schemaToYAML(field.children, indent + 1));
    } else if (field.type === 'record') {
      lines.push(`${pad}${name}: {}`);
    } else if (field.type === 'object') {
      lines.push(`${pad}${name}: {}`);
    } else {
      const val = field.defaultValue;
      const valStr = typeof val === 'string' ? val
        : typeof val === 'number' ? String(val)
        : typeof val === 'boolean' ? String(val)
        : JSON.stringify(val);
      lines.push(`${pad}${name}: ${valStr}`);
    }
  }

  return lines.join('\n');
}
