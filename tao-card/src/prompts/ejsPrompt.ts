/**
 * src/prompts/ejsPrompt.ts — AI Prompt cho EJS Code Generation
 * Dạy AI sinh EJS @@preprocessing code cho SillyTavern TavernHelper
 */

import type { MVUZODSchema, MVUZODField } from '../types/mvuzod.types';
import type { LorebookEntry } from '../types';
import { formatExamplesForPrompt } from './ejsExamples';
import { analyzeEntryGroups, type EntryAnalysis, type EjsStrategy } from '../lib/worldbook/entryGroupAnalyzer';

// ─── EJS TEMPLATE CATEGORIES ────────────────────────────────────────────────

export type EJSTemplateCategory =
  | 'conditional_entry'
  | 'dynamic_content'
  | 'stat_reader'
  | 'multi_stage'
  | 'variable_display'
  | 'custom';

export const EJS_TEMPLATE_LABELS: Record<EJSTemplateCategory, { label: string; emoji: string; desc: string }> = {
  conditional_entry: {
    label: 'Bật/Tắt Entries theo điều kiện',
    emoji: '🔀',
    desc: 'Tự động bật/tắt worldbook entries dựa trên giá trị biến (era, mood, stats...)',
  },
  dynamic_content: {
    label: 'Sinh nội dung động',
    emoji: '✨',
    desc: 'Tạo nội dung text động dựa trên stat_data (mô tả trạng thái, tóm tắt...)',
  },
  stat_reader: {
    label: 'Đọc và hiển thị biến',
    emoji: '📊',
    desc: 'Đọc biến từ stat_data và xuất dạng text cho AI context',
  },
  multi_stage: {
    label: 'Multi-stage Persona',
    emoji: '🎭',
    desc: 'Thay đổi persona/tính cách nhân vật theo giá trị stat (ví dụ: corruption level)',
  },
  variable_display: {
    label: 'Hiển thị biến cho AI',
    emoji: '📋',
    desc: 'Xuất bảng stat cho AI đọc, dạng structured text',
  },
  custom: {
    label: 'Tự mô tả yêu cầu',
    emoji: '🛠️',
    desc: 'Nhập mô tả tự do, AI sẽ sinh EJS phù hợp',
  },
};

// ─── SYSTEM PROMPT ──────────────────────────────────────────────────────────

export const EJS_SYSTEM_PROMPT = `
Bạn là chuyên gia viết EJS template cho SillyTavern TavernHelper (@@preprocessing).
Nhiệm vụ: sinh ra code EJS hoàn chỉnh, chạy được ngay trong worldbook entry.

═══ CÚ PHÁP EJS ═══

Code EJS nằm trong worldbook entry, BẮT BUỘC bắt đầu bằng @@preprocessing ở dòng đầu.

Tag types:
  <%_  _%>    Statement (logic, khai báo biến) — dùng nhiều nhất
  <%=  %>     Expression output (in giá trị ra prompt)
  <%-  %>     Raw output (in HTML không escape, dùng với getwi)
  <%#  %>     Comment (bị bỏ qua khi render)

Ví dụ cấu trúc cơ bản:
\`\`\`
@@preprocessing
<%_
  // Đọc biến
  var hp = getvar('stat_data.Nhân vật.HP', { defaults: 100 });
  var era = getvar('stat_data.Trạng thái.Thời đại', { defaults: 'Hiện đại' });
_%>
\`\`\`

═══ BUILT-IN FUNCTIONS ═══

📖 ĐỌC/GHI BIẾN:
  getvar(key, opts)             Đọc biến. opts: { defaults, scope }
                                Key dùng dấu chấm: 'stat_data.Nhân vật.HP'
  setvar(key, value)            Ghi biến

📝 OUTPUT:
  print(text)                   In text vào prompt context
  <%= expr %>                   In giá trị expression

📚 WORLDBOOK (QUAN TRỌNG: getwi là async!):
  await getwi('comment')         Đọc nội dung entry theo comment (PHẢI có await!)
  await getwi(null, 'comment')   Đọc entry từ worldbook hiện tại (PHẢI có await!)
  await activewi('comment', true) KÍCH HOẠT entry đang TẮT cho lượt này (alias activateWorldInfo)
  await activewi('sách', 'comment', true)  như trên, chỉ đích danh sách
  activateWorldInfoByKeywords(['từ khoá'], { force: true })  kích hoạt entry tắt khớp từ khoá

  ⛔ KHÔNG TỒN TẠI — viết vào là lỗi đỏ "is not defined" khi chơi:
     setEntryEnabled(), activateEntry(), setEntryContent(), enableWorldInfo(), disableWorldInfo()
  ⚠️ EJS KHÔNG TẮT được entry. Muốn một entry chỉ hiện có điều kiện thì để nó TẮT sẵn
     (enabled = false) rồi bật bằng activewi. Muốn tắt hẳn thì tắt trong cấu hình entry.
  ⚠️ activewi PHẢI có tham số force = true; thiếu nó lời gọi chạy êm nhưng không kích hoạt gì.

  ⚠️ getwi() là ASYNC — BẮT BUỘC dùng await:
    <%- await getwi('tên entry') %>         ← Output nội dung entry
    <% print(await getwi('tên entry')) %>   ← Tương đương

💉 INJECTION:
  injectPrompt(opts)            Inject text vào prompt
                                opts: { text, position: 'in_chat', depth: N }

💬 CHAT:
  getChatMessages(idx, role)    Đọc tin nhắn chat (-1 = cuối)
  matchChatMessages(keywords, opts)
                                Scan chat messages theo keywords hoặc regex
                                keywords: string[] hoặc RegExp[]
                                opts: { start: -N } scan N tin gần nhất (default: -2)
                                Trả về true/false

📌 MVU DATA:
  Mvu.getMvuData(opts)          Đọc MVU state
                                opts: {type:'message', message_id:'latest'}

═══ 2 STRATEGIES CHO CONTROLLER ═══

🅰️ Strategy activate (card đơn giản, <50 entries):
  Entries liên quan để TẮT sẵn, EJS bật cái đúng điều kiện:
  \`\`\`
  if (biến === 'giá trị A') { await activewi('Entry A', true); }
  if (biến === 'giá trị B') { await activewi('Entry B', true); }
  \`\`\`

🅱️ Strategy getwi (card phức tạp, 50+ entries):
  Entries DISABLED sẵn, EJS load nội dung khi cần:
  \`\`\`
  <%_ if (điều_kiện) { _%>
  <%- await getwi(null, 'Tên entry') %>
  <%_ } _%>
  \`\`\`
  Pattern NPC: scan chat → tìm NPC → load entry:
  \`\`\`
  <%_ for (var i = 0; i < _npcs.length; i++) { _%>
  <%- await getwi(null, era + ': ' + _npcs[i]) %>
  <%_ } _%>
  \`\`\`

═══ SLASH COMMANDS QUAN TRỌNG (dùng trong STScript, KHÔNG dùng trong EJS) ═══

/getvar key                     Đọc local variable
/setvar key=name value          Ghi local variable
/getglobalvar key               Đọc global variable
/setglobalvar key=name value    Ghi global variable
/ejs code                       Chạy EJS template
/ejs-refresh                    Preload world info
/sendas name=CharName text      Gửi tin nhắn dưới tên nhân vật
/trigger                        Trigger AI response
/echo text                      Hiển thị toast message

═══ QUY TẮC QUAN TRỌNG ═══

1. LUÔN bắt đầu bằng @@preprocessing
2. KHÔNG dùng this.variables — dùng getvar()
3. stat_data dùng dấu chấm (.) làm path separator, KHÔNG dùng gạch chéo (/)
4. Khai báo biến dùng var (KHÔNG dùng let/const — scoping khác trong EJS)
5. getvar trả về string — cần parse nếu so sánh số: Number(getvar(...))
6. Comment entry nên có prefix "EJS:" hoặc "Bộ điều khiển EJS" để dễ nhận biết
7. Dùng <%_ _%> (whitespace slurp) để tránh xuống dòng thừa
8. Logic phức tạp nên chia nhỏ thành nhiều entries
9. getwi() là async — BẮT BUỘC dùng await: await getwi('comment') hoặc await getwi(null, 'comment')
10. Card nhiều entries (>50): ưu tiên dùng getwi() load nội dung thay vì kích hoạt từng entry
11. Entries được getwi() load PHẢI ở trạng thái DISABLED trong worldbook
12. matchChatMessages() dùng để phát hiện keyword context trong chat gần nhất
13. (bug 135) SO SÁNH VỚI BIẾN ENUM: chuỗi đem so PHẢI chép NGUYÊN VĂN một giá trị trong
    enumValues của schema (đúng dấu, đúng hoa-thường). Đo trên card thật: so "Chưa rõ" trong
    khi enum chỉ có "Chưa thức tỉnh" ⇒ nhánh đó KHÔNG BAO GIỜ đúng, cơ chế chết im lặng.
    Khi phân nhánh theo enum, phủ ĐỦ mọi giá trị hoặc chốt bằng else cho phần còn lại.
14. (bug 135) Entry nào bạn để TẮT thì PHẢI có đường bật lại (activewi trong controller hoặc
    getwi đọc nội dung). Tắt + không key + không ai gọi tên = lore chết trong file.

═══ ĐỊNH DẠNG OUTPUT ═══

Trả về JSON object:
{
  "explanation": "Giải thích ngắn gọn EJS code làm gì",
  "strategy": "getwi hoặc activate",
  "controller": {
    "entryComment": "Tên entry controller (ví dụ: 'Bộ điều khiển EJS')",
    "code": "@@preprocessing\\n<%_ ... _%>"
  },
  "entryActions": [
    { "comment": "tên entry", "action": "disable", "reason": "lý do" },
    { "comment": "tên entry", "action": "keep", "reason": "lý do" }
  ]
}

entryActions chỉ cần cho strategy getwi. action: "disable" = tắt entry, "keep" = giữ nguyên.
Nếu strategy là activate, entryActions phải liệt kê các entry cần chuyển sang TẮT sẵn.

CHỈ trả về JSON. KHÔNG markdown, KHÔNG giải thích bên ngoài JSON.
`;

// ─── USER PROMPT BUILDERS ───────────────────────────────────────────────────

export function buildEjsUserPrompt(
  category: EJSTemplateCategory,
  schema: MVUZODSchema | null,
  entries: LorebookEntry[],
  characterName: string,
  customInstructions: string,
  options?: {
    selectedEntryIds?: number[];
    selectedFieldPaths?: string[];
    iterationCode?: string;  // existing code for AI to improve
    iterationFeedback?: string;  // user feedback for iteration
  },
): string {
  const parts: string[] = [];

  // 1. Schema context (optionally filtered)
  if (schema) {
    if (options?.selectedFieldPaths?.length) {
      const filtered = filterSchemaFields(schema.fields, options.selectedFieldPaths);
      parts.push(`=== MVUZOD SCHEMA (${options.selectedFieldPaths.length} fields được chọn) ===\n${formatSchemaTree(filtered, 0)}`);
    } else {
      parts.push(`=== MVUZOD SCHEMA ===\n${formatSchemaForEjsPrompt(schema)}`);
    }
  } else {
    parts.push('=== SCHEMA: Không có MVUZOD schema ===\nKhông có schema. Dùng getvar() với path tự do.');
  }

  // 2. Existing entries context (optionally filtered)
  const allNonEjsEntries = entries.filter(e => !e.content.trimStart().startsWith('@@preprocessing'));
  const ejsEntries = entries.filter(e => e.content.trimStart().startsWith('@@preprocessing'));

  // If user selected specific entries, highlight them
  const selectedIds = options?.selectedEntryIds;
  const nonEjsEntries = selectedIds?.length
    ? allNonEjsEntries.filter(e => selectedIds.includes(e.id))
    : allNonEjsEntries;

  if (nonEjsEntries.length > 0) {
    const prefix = selectedIds?.length ? `(${nonEjsEntries.length} entries ĐƯỢC CHỌN)` : `(${nonEjsEntries.length} entries thường)`;
    parts.push(`=== WORLDBOOK ENTRIES ${prefix} ===
${nonEjsEntries.slice(0, 30).map(e => {
  const status = e.enabled ? '🟢' : '🔴';
  const keys = e.keys.length > 0 ? ` | keys: ${e.keys.slice(0, 5).join(', ')}` : '';
  return `  ${status} [id=${e.id}] "${e.comment || '(no comment)'}"${keys}`;
}).join('\n')}${nonEjsEntries.length > 30 ? `\n  ... và ${nonEjsEntries.length - 30} entries khác` : ''}`);
  }

  if (ejsEntries.length > 0) {
    parts.push(`=== EJS ENTRIES ĐÃ CÓ (${ejsEntries.length}) ===
${ejsEntries.map(e => `  [id=${e.id}] "${e.comment}" — ${e.content.split('\n').length} dòng`).join('\n')}
KHÔNG tạo lại logic đã có trong các EJS entries trên.`);
  }

  // 3. Character context
  if (characterName) {
    parts.push(`=== NHÂN VẬT ===\nTên: ${characterName}`);
  }

  // 4. Category-specific prompt
  parts.push(getCategoryPrompt(category, schema, nonEjsEntries));

  // 5. Few-shot examples (Phase 2)
  const examples = formatExamplesForPrompt(category);
  if (examples) {
    parts.push(examples);
  }

  // 6. Iteration mode (Phase 2) — send existing code + feedback
  if (options?.iterationCode) {
    parts.push(`=== CODE HIỆN TẠI (CẦN SỬA) ===
\`\`\`
${options.iterationCode}
\`\`\`

NGƯỜI DÙNG YÊU CẦU: ${options.iterationFeedback || 'Cải thiện code này'}

Hãy sửa/cải thiện code trên theo yêu cầu. Giữ lại logic tốt, chỉ sửa phần cần thiết.`);
  }

  // 7. Custom instructions
  if (customInstructions.trim()) {
    parts.push(`=== YÊU CẦU TỪ NGƯỜI DÙNG ===\n${customInstructions.trim()}`);
  }

  return parts.join('\n\n');
}

// ─── CATEGORY PROMPTS ───────────────────────────────────────────────────────

function getCategoryPrompt(
  category: EJSTemplateCategory,
  schema: MVUZODSchema | null,
  entries: LorebookEntry[],
): string {
  switch (category) {
    case 'conditional_entry':
      return buildConditionalEntryPrompt(schema, entries, entries);
    case 'dynamic_content':
      return buildDynamicContentPrompt(schema, entries);
    case 'stat_reader':
      return buildStatReaderPrompt(schema);
    case 'multi_stage':
      return buildMultiStagePrompt(schema, entries);
    case 'variable_display':
      return buildVariableDisplayPrompt(schema);
    case 'custom':
      return buildCustomPrompt(schema, entries);
  }
}

function buildConditionalEntryPrompt(
  schema: MVUZODSchema | null,
  entries: LorebookEntry[],
  allEntries?: LorebookEntry[],
  strategyOverride?: EjsStrategy,
): string {
  // Run Smart Entry Analyzer
  const analysis = analyzeEntryGroups(allEntries ?? entries, schema);
  const strategy = strategyOverride ?? analysis.recommendedStrategy;

  // Build schema fields section
  const enumFields = schema ? collectLeafFields(schema.fields).filter(f => f.constraints?.enumValues?.length) : [];
  const boolFields = schema ? collectLeafFields(schema.fields).filter(f => f.type === 'boolean') : [];
  const numFields = schema ? collectLeafFields(schema.fields).filter(f => f.type === 'number') : [];

  const schemaSection = [
    enumFields.length > 0 ? `Field enum có thể dùng làm điều kiện:\n${enumFields.map(f => `  - ${f.label}: [${f.constraints?.enumValues?.join(', ')}]`).join('\n')}` : '',
    boolFields.length > 0 ? `Field boolean:\n${boolFields.map(f => `  - ${f.label}`).join('\n')}` : '',
    numFields.length > 0 ? `Field số (dùng so sánh ngưỡng):\n${numFields.slice(0, 10).map(f => `  - ${f.label} (${f.constraints?.clamp ? `range: ${f.constraints.clamp[0]}~${f.constraints.clamp[1]}` : 'number'})`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  // Build strategy-specific pattern
  const patternSection = strategy === 'getwi'
    ? `STRATEGY ĐƯỢC CHỌN: getwi() LOADING
Entries sẽ được DISABLE. EJS controller load nội dung khi cần bằng await getwi().

PATTERN CHÍNH:
\`\`\`
@@preprocessing
<%_
  var _era = getvar('stat_data.path.đến.biến', { defaults: 'Giá trị mặc định' });

  // Scan chat messages gần nhất để xác định context
  var _txt = '';
  var _um = getChatMessages(-1, 'user');
  var _am = getChatMessages(-1, 'assistant');
  if (_um) { var _un = Math.min(3, _um.length); for (var _i = _um.length - _un; _i < _um.length; _i++) { _txt += _um[_i] + ' '; } }
  if (_am) { var _an = Math.min(3, _am.length); for (var _j = _am.length - _an; _j < _am.length; _j++) { _txt += _am[_j] + ' '; } }
_%>

<%# Load entries theo era/context %>
<%_ if (_era === 'Giá trị A') { _%>
<%- await getwi(null, 'Entry cho Giá trị A') %>
<%_ } else if (_era === 'Giá trị B') { _%>
<%- await getwi(null, 'Entry cho Giá trị B') %>
<%_ } _%>

<%# Load entries theo keyword từ chat %>
<%_ if (_txt.includes('keyword1')) { _%>
<%- await getwi(null, 'Entry liên quan keyword1') %>
<%_ } _%>
\`\`\``
    : `STRATEGY ĐƯỢC CHỌN: KÍCH HOẠT CÓ ĐIỀU KIỆN (await activewi)
Entries giữ nguyên, EJS controller bật/tắt chúng.

PATTERN:
\`\`\`
@@preprocessing
<%_
  var era = getvar('stat_data.Trạng thái.Thời đại', { defaults: 'Hiện đại' });
  if (era === 'Cổ đại') { await activewi('WB: Cổ đại', true); }
  if (era === 'Hiện đại') { await activewi('WB: Hiện đại', true); }
_%>
\`\`\``;

  return `=== YÊU CẦU: ĐIỀU KHIỂN ENTRIES THEO ĐIỀU KIỆN ===

Tạo EJS controller đọc biến từ stat_data và điều khiển worldbook entries tương ứng.

${schemaSection}

${analysis.promptSummary}

${patternSection}`;
}

function buildDynamicContentPrompt(schema: MVUZODSchema | null, entries: LorebookEntry[]): string {
  const fields = schema ? collectLeafFields(schema.fields).filter(f => !f.constraints?.hidden) : [];
  const numFields = fields.filter(f => f.type === 'number');
  const enumFields = fields.filter(f => f.constraints?.enumValues?.length);
  const stringFields = fields.filter(f => f.type === 'string' && !f.constraints?.enumValues?.length);

  // Categorize available entries for context loading
  const contentEntries = entries.filter(e => {
    const c = (e.comment || '').toLowerCase();
    return !e.content.trimStart().startsWith('@@preprocessing') &&
      !e.constant &&
      (c.includes('mô tả') || c.includes('cảnh') || c.includes('bối cảnh') ||
       c.includes('địa điểm') || c.includes('trạng thái') || c.includes('sự kiện') ||
       c.includes('ngoại hình') || c.includes('hành vi'));
  });

  const fieldsSection = [
    numFields.length > 0 ? `Field số (dùng so sánh ngưỡng):\n${numFields.slice(0, 10).map(f => `  - ${f.label}${f.constraints?.clamp ? `: ${f.constraints.clamp[0]}~${f.constraints.clamp[1]}` : ''}`).join('\n')}` : '',
    enumFields.length > 0 ? `Field enum (dùng switch mô tả):\n${enumFields.slice(0, 8).map(f => `  - ${f.label}: [${f.constraints?.enumValues?.join(', ')}]`).join('\n')}` : '',
    stringFields.length > 0 ? `Field text (dùng đưa vào mô tả):\n${stringFields.slice(0, 8).map(f => `  - ${f.label}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const entriesSection = contentEntries.length > 0
    ? `Entries có thể load nội dung bằng getwi():\n${contentEntries.slice(0, 15).map(e => `  - "${e.comment}" (${e.enabled ? 'bật' : 'tắt'})`).join('\n')}`
    : '';

  return `=== YÊU CẦU: SINH NỘI DUNG ĐỘNG ===

Tạo EJS code đọc biến và sinh text mô tả trạng thái hiện tại, inject vào context cho AI đọc.
Text được sinh phải là mô tả narrative (không phải bảng số), giúp AI hiểu bối cảnh để viết phản hồi phù hợp.

${fieldsSection}

${entriesSection}

3 CÁCH OUTPUT (chọn phù hợp):

1. print() — in text vào context entry này:
\`\`\`
print('[Trạng thái: ...' + môTả + ']');
\`\`\`

2. injectPrompt() — inject vào vị trí chính xác trong prompt:
\`\`\`
injectPrompt({ text: '[Mô tả: ' + desc + ']', position: 'in_chat', depth: 0 });
\`\`\`
  depth: 0 = tin mới nhất, 1 = trước 1 tin, etc.
  Vị trí này giúp AI “thấy” mô tả ngay trước khi viết phản hồi.

3. getwi() — load mô tả dài từ entry khác:
\`\`\`
<%_ if (điềuKiện) { _%>
<%- await getwi(null, 'Tên entry mô tả') %>
<%_ } _%>
\`\`\`
  Dùng khi mô tả quá dài để hardcode trong EJS.

PATTERN:
\`\`\`
@@preprocessing
<%_
  var hp = Number(getvar('stat_data.Nhân vật.HP', { defaults: 100 }));
  var mood = getvar('stat_data.Nhân vật.Tâm trạng', { defaults: 'Bình thường' });
  var location = getvar('stat_data.Thế giới.Địa điểm', { defaults: '' });

  var desc = [];
  if (hp < 30) desc.push('đang bị thương nặng, thở hổn hển');
  if (mood === 'Tức giận') desc.push('đôi mắt đỏ rực giận dữ');
  if (location) desc.push('đang ở ' + location);

  if (desc.length > 0) {
    injectPrompt({
      text: '[Ngoại hình {{char}}: ' + desc.join(', ') + ']',
      position: 'in_chat',
      depth: 0
    });
  }
_%>
\`\`\``;
}

function buildStatReaderPrompt(schema: MVUZODSchema | null): string {
  const fields = schema ? collectLeafFields(schema.fields).filter(f => !f.constraints?.hidden) : [];
  const visibleFields = fields.filter(f => !f.constraints?.readOnly);
  const schemaTree = schema ? formatSchemaTree(schema.fields.filter(f => !f.constraints?.hidden), 0) : '';

  return `=== YÊU CẦU: ĐỌC VÀ HIỂN THỊ BIẾN ===

Tạo EJS code đọc tất cả biến quan trọng và print dạng structured text cho AI đọc.

${schemaTree ? `Schema structure:\n${schemaTree}` : `${visibleFields.length > 0 ? `Các biến:\n${visibleFields.slice(0, 20).map(f => `  - ${f.label} (${f.type})`).join('\n')}` : 'Không có schema. Tạo ví dụ generic.'}`}

2 APPROACHES (chọn 1):

🅰️ YAML auto (khuyên dùng — tự render tất cả, zero-config):
\`\`\`
@@preprocessing
[== TRẠNG THÁI HIỆN TẠI ==]
<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) %>
[== END ==]
\`\`\`

🅱️ Selective print (chỉ show biến cần thiết, format đẹp):
\`\`\`
@@preprocessing
<%_
  var hp = getvar('stat_data.Nhân vật.HP', { defaults: 100 });
  var mp = getvar('stat_data.Nhân vật.MP', { defaults: 50 });
  print('[Stats: HP=' + hp + ', MP=' + mp + ']');
_%>
\`\`\`

Lưu ý: bỏ qua biến có readOnly=true hoặc hidden=true (biến nội bộ, AI không cần biết).`;
}

function buildMultiStagePrompt(schema: MVUZODSchema | null, entries: LorebookEntry[]): string {
  const numericFields = schema ? collectLeafFields(schema.fields).filter(f => f.type === 'number' && f.constraints?.clamp) : [];
  const enumFields = schema ? collectLeafFields(schema.fields).filter(f => f.constraints?.enumValues?.length) : [];

  // Find persona/stage entries
  const personaEntries = entries.filter(e => {
    const c = (e.comment || '').toLowerCase();
    return !e.content.trimStart().startsWith('@@preprocessing') &&
      (c.includes('persona') || c.includes('stage') || c.includes('giai đoạn') ||
       c.includes('tính cách') || c.includes('hành vi') || c.includes('thái độ') ||
       c.includes('phase') || c.includes('level'));
  });

  const fieldsSection = [
    numericFields.length > 0 ? `Field số có range (tốt cho multi-stage):\n${numericFields.slice(0, 10).map(f => `  - ${f.label}: ${f.constraints?.clamp?.[0]}~${f.constraints?.clamp?.[1]}`).join('\n')}` : '',
    enumFields.length > 0 ? `Field enum (tốt cho mode switching):\n${enumFields.slice(0, 5).map(f => `  - ${f.label}: [${f.constraints?.enumValues?.join(', ')}]`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const personaSection = personaEntries.length > 0
    ? `\nEntries persona có thể load (dùng getwi):\n${personaEntries.slice(0, 15).map(e => `  - "${e.comment}" (${e.enabled ? 'bật' : 'tắt'})`).join('\n')}`
    : '';

  const hasEntriesToLoad = personaEntries.length > 0;

  return `=== YÊU CẦU: MULTI-STAGE PERSONA ===

Tạo EJS code thay đổi persona/hành vi nhân vật theo stat (ví dụ: mức độ thân mật, corruption, mood level).

${fieldsSection}${personaSection}

2 APPROACHES:

🅰️ Inline persona (card đơn giản — mô tả ngắn):
\`\`\`
@@preprocessing
<%_
  var affinity = Number(getvar('stat_data.Nhân vật.Độ thân mật', { defaults: 0 }));
  var stage = '';
  if (affinity < 25) stage = '{{char}} rất lạnh lùng, nói ngắn gọn.';
  else if (affinity < 75) stage = '{{char}} thân thiện, hay đùa giỡn.';
  else stage = '{{char}} cực kỳ thân thiết, chia sẻ bí mật.';

  injectPrompt({ text: '[Persona: ' + stage + ']', position: 'in_chat', depth: 0 });
_%>
\`\`\`

🅱️ getwi persona (card phức tạp — persona dài trong entries riêng):${hasEntriesToLoad ? '\nDùng approach này vì có entries persona sẵn!' : ''}
\`\`\`
@@preprocessing
<%_
  var affinity = Number(getvar('stat_data.Nhân vật.Độ thân mật', { defaults: 0 }));
  var stage = '';
  if (affinity < 25) stage = 'Stage 1';
  else if (affinity < 50) stage = 'Stage 2';
  else if (affinity < 75) stage = 'Stage 3';
  else stage = 'Stage 4';
_%>
<%- await getwi(null, 'Persona: ' + stage) %>
\`\`\`

IMPORTANT: Dùng injectPrompt() thay vì print() khi cần inject persona vào đúng vị trí.
  injectPrompt({ text: personaText, position: 'in_chat', depth: 0 })
  depth: 0 = ngay trước tin mới nhất (AI "thấy" persona sát tin nhắn cuối cùng).`;
}

function buildVariableDisplayPrompt(schema: MVUZODSchema | null): string {
  const fields = schema ? schema.fields.filter(f => !f.constraints?.hidden) : [];
  const schemaTree = fields.length > 0 ? formatSchemaTree(fields, 0) : '';

  return `=== YÊU CẦU: HIỂN THỊ BẢNG BIẾN CHO AI ===

Tạo EJS code xuất tất cả biến dạng structured text để AI context luôn cập nhật.
Bỏ qua biến hidden (AI không cần thấy) và readOnly (biến bắt đầu _ là private).

${schemaTree ? `Schema structure:\n${schemaTree}` : 'Không có schema. Tạo ví dụ generic với Mvu.getMvuData().'}

3 APPROACHES (chọn phù hợp):

🅰️ YAML auto (đơn giản nhất, tự render tất cả):
\`\`\`
@@preprocessing
[== TRẠNG THÁI HIỆN TẠI ==]
<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) %>
[== END ==]
\`\`\`

🅱️ Selective JSON (chỉ show nhóm cần thiết):
\`\`\`
@@preprocessing
<%_
  var data = getvar('stat_data');
  var filtered = {};
  for (var key in data) {
    if (key.charAt(0) !== '_' && data.hasOwnProperty(key)) {
      filtered[key] = data[key];
    }
  }
  print('[== TRẠNG THÁI ==]');
  print(JSON.stringify(filtered, null, 2));
  print('[== END ==]');
_%>
\`\`\`

🅲️ Recursive print (format đẹp với emoji và box):
\`\`\`
@@preprocessing
<%_
  var data = Mvu.getMvuData({type:'message', message_id:'latest'});
  var stats = data?.stat_data ?? {};
  var lines = ['[== TRẠNG THÁI GAME ==]'];
  function printGroup(obj, prefix) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key) && key.charAt(0) !== '_') {
        var val = obj[key];
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          lines.push(prefix + '【' + key + '】');
          printGroup(val, prefix + '  ');
        } else {
          lines.push(prefix + key + ': ' + String(val));
        }
      }
    }
  }
  printGroup(stats, '');
  lines.push('[== END ==]');
  print(lines.join('\\n'));
_%>
\`\`\`

Lưu ý: Filter bỏ key bắt đầu bằng _ (biến private/readOnly, AI không cần biết).`;
}

function buildCustomPrompt(schema: MVUZODSchema | null, entries: LorebookEntry[]): string {
  const fields = schema ? collectLeafFields(schema.fields).filter(f => !f.constraints?.hidden) : [];
  const nonEjsEntries = entries.filter(e => !e.content.trimStart().startsWith('@@preprocessing'));

  const contextParts: string[] = [];

  // Schema summary
  if (fields.length > 0) {
    contextParts.push(`Schema có ${fields.length} fields. Các fields chính:\n${fields.slice(0, 15).map(f => {
      const type = f.constraints?.enumValues?.length ? `enum[${f.constraints.enumValues.join(',')}]` : f.type;
      return `  - ${f.label} (${type})`;
    }).join('\n')}`);
  }

  // Entry summary
  if (nonEjsEntries.length > 0) {
    contextParts.push(`Worldbook có ${nonEjsEntries.length} entries. Ví dụ:\n${nonEjsEntries.slice(0, 10).map(e => `  - "${e.comment}" (${e.enabled ? 'bật' : 'tắt'})`).join('\n')}`);
  }

  return `=== YÊU CẦU: TỰ DO ===

Sinh EJS code theo mô tả của người dùng bên dưới.

${contextParts.length > 0 ? contextParts.join('\n\n') : ''}

FUNCTIONS CÓ THỂ DÙNG:
  getvar(key, {defaults})     Đọc biến
  setvar(key, value)           Ghi biến
  print(text)                  Output text
  await getwi(null, 'comment') Load entry
  await activewi(comment, true)  Kích hoạt entry đang tắt (KHÔNG có setEntryEnabled)
  injectPrompt({text, position:'in_chat', depth:N})
  matchChatMessages(keywords)  Scan chat keywords
  getChatMessages(-1, role)    Đọc chat
  Mvu.getMvuData({type:'message', message_id:'latest'})
  YAML.stringify(obj)          Format YAML
  _.random(min, max)           Số ngẫu nhiên
  _.sample(arr)                Phần tử ngẫu nhiên
  new Date()                   Thời gian thực
  TavernHelper.getLastMessageId()  Message ID cuối

Nhớ: @@preprocessing ở dòng đầu, dùng var (không let/const), getwi() PHẢI có await.`;
}

// ─── PARSE RESPONSE ─────────────────────────────────────────────────────────

export interface EJSEntryAction {
  comment: string;
  action: 'disable' | 'keep';
  reason?: string;
}

export interface EJSGenerationResult {
  explanation: string;
  strategy: EjsStrategy;
  entryComment: string;
  code: string;
  entryActions: EJSEntryAction[];
}

/**
 * Parse AI response JSON into EJSGenerationResult.
 * Backward-compatible: handles both old format (flat) and new format (controller + entryActions).
 */
export function parseEjsResponse(rawText: string): EJSGenerationResult {
  // Strip markdown fences if present
  let text = rawText.trim();
  text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  text = text.replace(/^```\s*/i, '').replace(/```\s*$/i, '');

  // Try to find JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI không trả về JSON hợp lệ. Vui lòng thử lại.');
  }

  const tryParse = (jsonStr: string): EJSGenerationResult => {
    const parsed = JSON.parse(jsonStr);

    // New format: { controller: { entryComment, code }, entryActions: [...] }
    if (parsed.controller) {
      return {
        explanation: parsed.explanation ?? '',
        strategy: parsed.strategy ?? 'activate',
        entryComment: parsed.controller.entryComment ?? 'Bộ điều khiển EJS',
        code: parsed.controller.code ?? '',
        entryActions: Array.isArray(parsed.entryActions) ? parsed.entryActions : [],
      };
    }

    // Old format: { explanation, entryComment, code }
    return {
      explanation: parsed.explanation ?? '',
      strategy: parsed.strategy ?? 'activate',
      entryComment: parsed.entryComment ?? 'EJS: Generated',
      code: parsed.code ?? '',
      entryActions: Array.isArray(parsed.entryActions) ? parsed.entryActions : [],
    };
  };

  try {
    return tryParse(jsonMatch[0]);
  } catch {
    // Try fixing trailing commas
    const fixed = jsonMatch[0].replace(/,\s*([\]}])/g, '$1');
    try {
      return tryParse(fixed);
    } catch {
      throw new Error('Không thể parse JSON từ phản hồi AI. Vui lòng thử lại.');
    }
  }
}

// ─── ANALYSIS EXPORT ────────────────────────────────────────────────────────

/**
 * Run Smart Entry Analyzer — exported for UI to call before generation.
 */
export function runEntryAnalysis(
  entries: LorebookEntry[],
  schema: MVUZODSchema | null,
): EntryAnalysis {
  return analyzeEntryGroups(entries, schema);
}

export type { EntryAnalysis, EjsStrategy };

// ─── HELPERS ────────────────────────────────────────────────────────────────

function formatSchemaForEjsPrompt(schema: MVUZODSchema): string {
  return formatSchemaTree(schema.fields, 0);
}

function formatSchemaTree(fields: MVUZODField[], indent: number): string {
  const lines: string[] = [];
  for (const f of fields) {
    const pad = '  '.repeat(indent);
    const name = f.path.split('/').filter(Boolean).pop() ?? f.path;
    const extras: string[] = [];
    if (f.constraints?.hidden) extras.push('hidden');
    if (f.constraints?.readOnly) extras.push('readOnly');
    if (f.constraints?.clamp) extras.push(`range: ${f.constraints.clamp[0]}~${f.constraints.clamp[1]}`);
    if (f.constraints?.enumValues?.length) extras.push(`enum: [${f.constraints.enumValues.join(', ')}]`);
    if (f.defaultValue !== undefined) extras.push(`default: ${JSON.stringify(f.defaultValue)}`);
    const extStr = extras.length ? ` (${extras.join(', ')})` : '';
    lines.push(`${pad}${name}: ${f.type}${f.label !== name ? ` [${f.label}]` : ''}${extStr}`);
    if (f.children?.length) {
      lines.push(formatSchemaTree(f.children, indent + 1));
    }
  }
  return lines.join('\n');
}

function collectLeafFields(fields: MVUZODField[]): MVUZODField[] {
  const result: MVUZODField[] = [];
  function collect(ff: MVUZODField[]) {
    for (const f of ff) {
      if (f.children?.length) collect(f.children);
      else result.push(f);
    }
  }
  collect(fields);
  return result;
}

/**
 * Filter schema fields to only include those matching selected paths.
 * Keeps parent hierarchy intact when a child is selected.
 */
function filterSchemaFields(fields: MVUZODField[], selectedPaths: string[]): MVUZODField[] {
  const result: MVUZODField[] = [];
  for (const f of fields) {
    if (selectedPaths.includes(f.path)) {
      result.push(f);
    } else if (f.children?.length) {
      const filtered = filterSchemaFields(f.children, selectedPaths);
      if (filtered.length > 0) {
        result.push({ ...f, children: filtered });
      }
    }
  }
  return result;
}

/**
 * Flatten all fields (including nested) into a flat list for field picker UI.
 */
export function flattenAllFields(fields: MVUZODField[], prefix = ''): Array<{
  path: string;
  label: string;
  type: string;
  depth: number;
}> {
  const result: Array<{ path: string; label: string; type: string; depth: number }> = [];
  for (const f of fields) {
    const depth = f.path.split('/').filter(Boolean).length - 1;
    result.push({ path: f.path, label: f.label, type: f.type, depth });
    if (f.children?.length) {
      result.push(...flattenAllFields(f.children, prefix + f.path));
    }
  }
  return result;
}
