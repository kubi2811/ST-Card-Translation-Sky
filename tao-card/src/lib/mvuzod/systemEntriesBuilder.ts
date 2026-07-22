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

/**
 * (User 22/07 — bug 75) Nội dung entry "[mvu_update] Định dạng đầu ra biến".
 *
 * ĐÂY LÀ HỢP ĐỒNG VỚI ENGINE MVU, KHÔNG PHẢI VĂN BẢN TỰ DO. Khối `<UpdateVariable>` phải có
 * ĐÚNG HAI thẻ con `<Analysis>` và `<JSONPatch>`; mảng JSON nằm TRONG `<JSONPatch>`.
 *
 * Bản cũ nhét thẳng mảng JSON vào `<UpdateVariable>`, thiếu cả hai thẻ con ⇒ engine MVU không
 * bóc ra được lệnh ⇒ SillyTavern báo "[MVU额外模型解析]变量更新失败".
 *
 * Cấu trúc dưới đây chép theo entry `[mvu_update]变量输出格式` của card MVU thật đang chạy
 * (đối chiếu 3 card: bugNeedFix/1/_raw.json, /8, /9 — cả 3 đều có entry này, thẻ của Auto
 * Creator thì không).
 */
export function buildOutputFormatContent(): string {
  return `变量输出格式:
  rule:
    - Xuất phần phân tích VÀ lệnh cập nhật MỘT LẦN ở CUỐI mỗi reply, không được bỏ qua.
    - Lệnh cập nhật theo chuẩn **JSON Patch (RFC 6902)**: một mảng JSON hợp lệ gồm các object
      thao tác, nhưng dùng bộ operator sau:
      - replace: thay giá trị của đường dẫn đã có
      - delta: cộng/trừ một lượng vào đường dẫn kiểu SỐ (value là number, KHÔNG có nháy)
      - insert: thêm mục mới vào object hoặc mảng (dùng \`-\` làm chỉ số để nối vào cuối mảng)
      - remove
      - move
    - KHÔNG cập nhật field bắt đầu bằng \`_\` — đó là field chỉ đọc.
    - Khi tạo NPC mới: insert TOÀN BỘ dữ liệu, không bỏ sót field nào.
    - Nếu lượt này không có gì thay đổi: vẫn xuất khối, với mảng rỗng [].
  format: |-
    <UpdateVariable>
    <Analysis>$(VIẾT NGẮN, tối đa 80 từ)
    - \${thời gian đã trôi qua: ...}
    - \${có được phép cập nhật mạnh tay không (tình huống đặc biệt / thời gian trôi nhiều hơn thường lệ): có/không}
    - \${xét từng biến theo \`check\` của nó, CHỈ dựa vào reply hiện tại chứ không dựa vào tình tiết cũ: ...}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "\${/đường/dẫn/tới/biến}", "value": "\${giá_trị_mới}" },
      { "op": "delta", "path": "\${/đường/dẫn/tới/biến/số}", "value": \${lượng_tăng_hoặc_giảm} },
      { "op": "insert", "path": "\${/đường/dẫn/tới/khoá_mới}", "value": "\${giá_trị_mới}" }
    ]
    </JSONPatch>
    </UpdateVariable>`;
}

/**
 * (bug 75) Entry nhấn mạnh — card MVU thật có entry riêng cho việc này
 * (`[mvu_update]变量输出格式强调`), rất ngắn, chỉ để nhắc AI không được quên khối.
 */
export function buildEmphasisContent(): string {
  return `变量输出格式强调:
  rule: Khối dưới đây BẮT BUỘC phải được chèn vào CUỐI mỗi reply, không được phép bỏ qua.
  format: |-
    <UpdateVariable>
    ...
    </UpdateVariable>`;
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
