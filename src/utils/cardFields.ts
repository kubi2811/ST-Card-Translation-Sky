import {
  parseMythicComment, TRANSLATABLE_META_FIELDS, applyMythicTranslation,
  stripAllMeta, titleTranslationIsSafe,
} from './mythicSkill';
import type { CharacterCard, CharacterBookEntry, TranslationField, FieldGroup, FieldGroupConfig } from '../types/card';

/* ─── Default Field Group Configs ─── */
export const DEFAULT_FIELD_GROUPS: FieldGroupConfig[] = [
  { id: 'core', label: 'Core Fields', description: 'name, description, personality, scenario', enabled: true },
  { id: 'messages', label: 'Messages', description: 'first_mes, alternate_greetings, mes_example', enabled: true },
  { id: 'system', label: 'System Prompts', description: 'system_prompt, post_history_instructions', enabled: true },
  { id: 'creator', label: 'Creator Notes', description: 'creator_notes, creatorcomment', enabled: true },
  { id: 'lorebook', label: 'Lorebook Entries', description: 'character_book entries content + comment + name', enabled: true },
  { id: 'lorebook_keys', label: 'Lorebook Keys', description: 'character_book entries keywords + secondary_keys', enabled: true },
  { id: 'depth_prompt', label: 'Depth Prompt', description: 'extensions.depth_prompt.prompt', enabled: true },
  { id: 'tavern_helper', label: 'TavernHelper Scripts', description: 'TavernHelper/JS-Slash-Runner script content', enabled: true },
  { id: 'regex', label: 'Regex Scripts', description: 'Regex scripts replaceString + trimStrings', enabled: true },
];

/* ─── Language Options ─── */
export const SOURCE_LANGUAGES = [
  { value: 'auto', label: '🔍 Auto Detect' },
  { value: '中文', label: '🇨🇳 中文' },
  { value: 'English', label: '🇺🇸 English' },
  { value: '日本語', label: '🇯🇵 日本語' },
  { value: '한국어', label: '🇰🇷 한국어' },
  { value: 'Tiếng Việt', label: '🇻🇳 Tiếng Việt' },
  { value: 'Français', label: '🇫🇷 Français' },
  { value: 'Deutsch', label: '🇩🇪 Deutsch' },
  { value: 'Español', label: '🇪🇸 Español' },
  { value: 'Русский', label: '🇷🇺 Русский' },
];

export const TARGET_LANGUAGES = [
  { value: 'Tiếng Việt', label: '🇻🇳 Tiếng Việt' },
  { value: 'English', label: '🇺🇸 English' },
  { value: '日本語', label: '🇯🇵 日本語' },
  { value: '한국어', label: '🇰🇷 한국어' },
  { value: 'Français', label: '🇫🇷 Français' },
  { value: 'Deutsch', label: '🇩🇪 Deutsch' },
  { value: 'Español', label: '🇪🇸 Español' },
  { value: '中文', label: '🇨🇳 中文' },
  { value: 'Русский', label: '🇷🇺 Русский' },
];

/* ─── Helper: Set nested value ─── */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/* ─── Check if text is only HTML/code (should not translate) ─── */
function isCodeOnly(text: string): boolean {
  // If the text contains any CJK characters, it must be translated regardless of macros/HTML
  if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)) {
    return false;
  }

  const stripped = text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/\s+/g, '')
    .trim();
  return stripped.length === 0;
}

/**
 * Check if text has translatable natural-language content.
 * Less aggressive than isCodeOnly — used for regex/TavernHelper content
 * that may have text embedded inside HTML tags or mixed with code.
 */
function hasTranslatableText(text: string): boolean {
  if (!text || typeof text !== 'string' || text.trim() === '') return false;
  
  // If the text contains any CJK characters, it is immediately translatable
  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
  if (hasCJK) return true;

  // Strip pure code patterns
  let stripped = text
    .replace(/<style[\s\S]*?<\/style>/gi, '')  // remove style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '') // remove script blocks
    .replace(/<[^>]+>/g, '')                     // remove HTML tags
    .replace(/\{\{[^}]+\}\}/g, '')               // remove {{macros}}
    .replace(/<\|[^|]+\|>/g, '')                 // remove <|special|> tokens
    .replace(/[\{\}\[\]\(\);:,=<>!&|+\-*/%.#@~`"'\\]/g, '') // remove code symbols
    .replace(/\s+/g, ' ')
    .trim();
  // If remaining text has Cyrillic or >10 chars of Latin text, it's translatable
  const hasCyrillic = /[\u0400-\u04ff]/.test(stripped);
  const hasSubstantialLatin = stripped.replace(/[^a-zA-ZÀ-ÿ]/g, '').length > 10;
  return hasCyrillic || hasSubstantialLatin || stripped.length > 20;
}

/* ─── Classify lorebook entry type for MVU per-type strategy ─── */
// (bug 213) `json_patch` từng bị thiếu ở alias CỤC BỘ này, trong khi TranslationField.entryType
// (types/card.ts) có nó và 8+ chỗ khác kiểm nó — nên phép gán không thể tồn tại ngay từ tầng KIỂU.
// Đó là lý do gốc khiến chốt bug 128 chưa từng chạy lần nào.
type LorebookEntryType = 'initvar' | 'mvu_logic' | 'rules' | 'narrative' | 'controller' | 'json_patch';

/**
 * (bug 213) Nội dung này có phải một tài liệu JSON Patch không — `[{ "op": …, "path": … }]`?
 *
 * `entryType: 'json_patch'` được KIỂM ở 8+ chỗ (chốt bug 128 "json_patch là JSON, KHÔNG phải
 * script" → miễn guard cú pháp JS ở useTranslation, đổi luật ở retryGuards/mvuValidator/cardHealth,
 * đổi cách hiển thị ở FieldEditor) nhưng TRƯỚC ĐÂY KHÔNG NƠI NÀO GÁN nó — grep cả src không có
 * một phép gán. Tức là toàn bộ chốt bug 128 chưa từng chạy lần nào: entry JSON-patch bị xếp nhầm
 * thành mvu_logic/narrative rồi đem soi bằng guard cú pháp JS, và nếu nội dung tình cờ parse được
 * như JS thì còn bị bắt dịch lại vô ích.
 *
 * Nhận diện CHẶT (phải parse ra JSON thật + mọi phần tử có `op` và `path` kiểu chuỗi) để không
 * kéo nhầm entry văn xuôi nào vào đây.
 */
export function isJsonPatchContent(content: string): boolean {
  const t = (content || '').trim();
  if (!t.startsWith('[') && !t.startsWith('{')) return false;
  if (!/"op"\s*:/.test(t) || !/"path"\s*:/.test(t)) return false;
  try {
    const parsed = JSON.parse(t) as unknown;
    const ops = Array.isArray(parsed) ? parsed : [parsed];
    if (ops.length === 0) return false;
    return ops.every((o) =>
      !!o && typeof o === 'object' &&
      typeof (o as { op?: unknown }).op === 'string' &&
      typeof (o as { path?: unknown }).path === 'string');
  } catch {
    return false;
  }
}

function classifyLorebookEntry(entry: { name?: string; comment?: string; content?: string }): LorebookEntryType {
  const name = (typeof entry.name === 'string' ? entry.name : '').toLowerCase();
  const comment = (typeof entry.comment === 'string' ? entry.comment : '').toLowerCase();
  const content = typeof entry.content === 'string' ? entry.content : '';

  // (bug 213) JSON Patch phải xét TRƯỚC mọi luật dựa vào tên/comment: một entry patch hoàn toàn có
  // thể được đặt tên "mvu_update" và bị luật controller/mvu_logic bên dưới hớt mất.
  if (isJsonPatchContent(content)) return 'json_patch';

  // [initvar] — variable initialization YAML
  if (content.includes('[initvar]') || comment.includes('initvar') || name.includes('initvar') || name.includes('var_init')) {
    return 'initvar';
  }

  // Controller — MVU controller/update logic
  if (/controller|mvu_update|update_mvu/i.test(comment) || /controller|mvu_update/i.test(name)) {
    return 'controller';
  }

  // MVU logic — contains setvar/getvar/addvar macros or Zod patterns
  if (/mvu|zod|variable/i.test(comment) || /mvu|zod|variable/i.test(name)) {
    return 'mvu_logic';
  }
  
  // Check content for heavy macro usage (more than 3 setvar/getvar macros = probably logic)
  const macroCount = (content.match(/\{\{(?:setvar|getvar|addvar)::/g) || []).length;
  if (macroCount >= 3) {
    return 'mvu_logic';
  }

  // Rules / world info
  if (/rules|rule|world_info|system|guideline/i.test(comment) || /rules|rule|world_info/i.test(name)) {
    return 'rules';
  }

  return 'narrative';
}

/**
 * (Bug #13, PhatSiz) Field có thuộc entry "[mvu update]" không — entry quy tắc CẬP NHẬT biến MVU.
 * Ở chế độ "Dịch Nhẹ" (giữ nguyên content tiếng gốc) các entry này VẪN được dịch, vì người dùng
 * cần quy tắc cập nhật ra tiếng đích. Nhận diện 2 kiểu như bug mô tả ("chứa hoặc có tên"):
 *   - comment/tên khớp mvu_update/update_mvu/controller ⇒ classifyLorebookEntry gán entryType 'controller';
 *   - marker [mvu update]/[mvu_update] nằm ngay trong nội dung entry.
 */
export function isMvuUpdateField(f: Pick<TranslationField, 'entryType' | 'original'>): boolean {
  return f.entryType === 'controller' || /\[mvu[\s_]?update\]/i.test(f.original || '');
}

/* ─── Extract translatable fields from a card ─── */
export function extractTranslatableFields(
  card: CharacterCard,
  enabledGroups: FieldGroup[]
): TranslationField[] {
  const fields: TranslationField[] = [];
  const data = card.data;

  function addField(path: string, label: string, group: FieldGroup, text: unknown, entryType?: LorebookEntryType) {
    if (!enabledGroups.includes(group)) return;
    if (typeof text !== 'string' || text.trim() === '') return;
    const isCommentField = path.endsWith('.comment');
    const isLogicField = entryType === 'mvu_logic' || entryType === 'rules' || entryType === 'controller' || entryType === 'initvar';
    if (!isCommentField && !isLogicField && isCodeOnly(text)) return;
    fields.push({
      path,
      label,
      group,
      original: text,
      translated: '',
      status: 'pending',
      retries: 0,
      entryType,
    });
  }

  function addArrayField(basePath: string, label: string, group: FieldGroup, arr: unknown) {
    if (!enabledGroups.includes(group)) return;
    if (!Array.isArray(arr)) return;
    arr.forEach((item, i) => {
      if (typeof item === 'string' && item.trim() !== '' && !isCodeOnly(item)) {
        fields.push({
          path: `${basePath}[${i}]`,
          label: `${label}[${i}]`,
          group,
          original: item,
          translated: '',
          status: 'pending',
          retries: 0,
        });
      }
    });
  }

  // Root level
  addField('name', 'name', 'core', card.name);
  addField('description', 'description', 'core', card.description);
  addField('personality', 'personality', 'core', card.personality);
  addField('scenario', 'scenario', 'core', card.scenario);
  addField('first_mes', 'first_mes', 'messages', card.first_mes);
  addField('mes_example', 'mes_example', 'messages', card.mes_example);
  addField('creatorcomment', 'creatorcomment', 'creator', card.creatorcomment);

  if (!data) return fields;

  // Data level
  addField('data.name', 'data.name', 'core', data.name);
  addField('data.description', 'data.description', 'core', data.description);
  addField('data.personality', 'data.personality', 'core', data.personality);
  addField('data.scenario', 'data.scenario', 'core', data.scenario);
  addField('data.first_mes', 'data.first_mes', 'messages', data.first_mes);
  addField('data.mes_example', 'data.mes_example', 'messages', data.mes_example);
  addField('data.creator_notes', 'data.creator_notes', 'creator', data.creator_notes);
  addField('data.system_prompt', 'data.system_prompt', 'system', data.system_prompt);
  addField('data.system_prompts', 'data.system_prompts', 'system', data.system_prompts);
  addField('data.post_history_instructions', 'data.post_history_instructions', 'system', data.post_history_instructions);

  // Alternate greetings
  addArrayField('data.alternate_greetings', 'data.alternate_greetings', 'messages', data.alternate_greetings);

  // Group only greetings
  addArrayField('data.group_only_greetings', 'data.group_only_greetings', 'messages', data.group_only_greetings);

  // Character book entries — with MVU entry classification
  if (data.character_book) {
    addField('data.character_book.name', 'lorebook.name', 'lorebook', data.character_book.name);
    addField('data.character_book.description', 'lorebook.description', 'lorebook', data.character_book.description);

    if (data.character_book.entries) {
      data.character_book.entries.forEach((entry, i) => {
        const eType = classifyLorebookEntry(entry);
        const typeTag = eType !== 'narrative' ? ` [${eType}]` : '';

        // Entry name (display name)
        addField(
          `data.character_book.entries[${i}].name`,
          `lorebook[${i}].name${typeTag}`,
          'lorebook',
          entry.name,
          eType
        );
        addField(
          `data.character_book.entries[${i}].content`,
          `lorebook[${i}].content${typeTag}`,
          'lorebook',
          entry.content,
          eType
        );
        // (Chiến lược A) `comment` của entry Mythic = TIÊU ĐỀ + toàn bộ khối JSON meta
        // (trung bình 672 ký tự, ~449k ký tự trên cả thẻ). Gửi nguyên cho AI là nó viết lại
        // JSON: hash lệch, `eras` bay mất, entry bị Agent loại — chưa kể tốn token gấp bội và
        // dịch trùng với chính field meta. Nên khi bật Chiến lược A, field này chỉ mang TIÊU ĐỀ;
        // khối meta được ghép lại nguyên vẹn ở applyMythicToCard.
        const mythicOn = enabledGroups.includes('mythic');
        const rawComment = String(entry.comment ?? '');
        const mythicBlocks = mythicOn ? parseMythicComment(rawComment).blocks : [];
        const isMythicEntry = mythicBlocks.length > 0;
        if (isMythicEntry) {
          // Entry KHÔNG ghi sẵn `eras` phải suy thời đại từ từ khoá Hán trong tiêu đề —
          // dịch tiêu đề là mất từ khoá và mất luôn entry. Những entry đó không trích tiêu đề.
          if (titleTranslationIsSafe(rawComment)) {
            addField(
              `data.character_book.entries[${i}].comment`,
              `lorebook[${i}].comment${typeTag}`,
              'lorebook',
              stripAllMeta(rawComment).trim(),
              eType
            );
          }
        } else {
          addField(
            `data.character_book.entries[${i}].comment`,
            `lorebook[${i}].comment${typeTag}`,
            'lorebook',
            entry.comment,
            eType
          );
        }
        // (Chiến lược A) Skill Mythic: `description` + `triggerWhen` nằm trong JSON nhúng
        // trong `comment`. Đây là thứ Agent đọc để quyết định nạp entry — không dịch thì người
        // chơi chat tiếng Việt sẽ không bao giờ kích hoạt được entry.
        if (isMythicEntry) {
          for (const b of mythicBlocks) {
            for (const mf of TRANSLATABLE_META_FIELDS) {
              const v = b.data[mf];
              if (typeof v !== 'string' || !v.trim()) continue;
              fields.push({
                path: `data.character_book.entries[${i}].__mythic.${b.name}.${mf}`,
                label: `mythic[${i}].${mf}`,
                group: 'mythic',
                original: v,
                translated: '',
                status: 'pending',
                retries: 0,
                entryType: eType,
              });
            }
          }
        }
        // Primary keys as joined string
        if (enabledGroups.includes('lorebook_keys') && Array.isArray(entry.keys) && entry.keys.length > 0) {
          const keysText = entry.keys.join(', ');
          if (keysText.trim()) {
            fields.push({
              path: `data.character_book.entries[${i}].keys`,
              label: `lorebook[${i}].keys${typeTag}`,
              group: 'lorebook_keys',
              original: keysText,
              translated: '',
              status: 'pending',
              retries: 0,
              entryType: eType,
            });
          }
        }
        // Secondary keys as joined string
        if (enabledGroups.includes('lorebook_keys') && Array.isArray(entry.secondary_keys) && entry.secondary_keys.length > 0) {
          const secKeysText = entry.secondary_keys.join(', ');
          if (secKeysText.trim()) {
            fields.push({
              path: `data.character_book.entries[${i}].secondary_keys`,
              label: `lorebook[${i}].secondary_keys${typeTag}`,
              group: 'lorebook_keys',
              original: secKeysText,
              translated: '',
              status: 'pending',
              retries: 0,
              entryType: eType,
            });
          }
        }
      });
    }
  }

  // Depth prompt
  if (data.extensions?.depth_prompt) {
    addField(
      'data.extensions.depth_prompt.prompt',
      'depth_prompt.prompt',
      'depth_prompt',
      data.extensions.depth_prompt.prompt
    );
  }
  // Regex scripts (scriptName, findRegex, replaceString & trimStrings)
  if (enabledGroups.includes('regex') && data.extensions?.regex_scripts && Array.isArray(data.extensions.regex_scripts)) {
    data.extensions.regex_scripts.forEach((script, i) => {
      if (!script || typeof script !== 'object') return;
      const scriptName = script.scriptName ? ` (${script.scriptName})` : ` (Script ${i + 1})`;

      // 1. scriptName
      if (typeof script.scriptName === 'string' && script.scriptName.trim() !== '') {
        fields.push({
          path: `data.extensions.regex_scripts[${i}].scriptName`,
          label: `regex[${i}].scriptName${scriptName}`,
          group: 'regex',
          original: script.scriptName,
          translated: '',
          status: 'pending',
          retries: 0,
        });
      }

      // 2. findRegex
      if (typeof script.findRegex === 'string' && script.findRegex.trim() !== '') {
        fields.push({
          path: `data.extensions.regex_scripts[${i}].findRegex`,
          label: `regex[${i}].findRegex${scriptName}`,
          group: 'regex',
          original: script.findRegex,
          translated: '',
          status: 'pending',
          retries: 0,
        });
      }

      // 3. replaceString
      if (typeof script.replaceString === 'string' && script.replaceString.trim() !== '') {
        fields.push({
          path: `data.extensions.regex_scripts[${i}].replaceString`,
          label: `regex[${i}].replaceString${scriptName}`,
          group: 'regex',
          original: script.replaceString,
          translated: '',
          status: 'pending',
          retries: 0,
        });
      }

      // 4. trimStrings
      if (Array.isArray(script.trimStrings)) {
        script.trimStrings.forEach((ts, j) => {
          if (typeof ts === 'string' && ts.trim() !== '') {
            fields.push({
              path: `data.extensions.regex_scripts[${i}].trimStrings[${j}]`,
              label: `regex[${i}].trimStrings[${j}]${scriptName}`,
              group: 'regex',
              original: ts,
              translated: '',
              status: 'pending',
              retries: 0,
            });
          }
        });
      }
    });
  }
  if (enabledGroups.includes('tavern_helper')) {
    const possibleKeys = ['tavern_helper', 'TavernHelper', 'js_slash_runner', 'TavernHelper_scripts'];
    
    possibleKeys.forEach(key => {
      const extData = data.extensions?.[key];
      if (!extData) return;
      
      let scriptsArray: any[] = [];
      let isDirectArray = false;
      let basePath = ''; // custom base path for tuple format
      
      if (Array.isArray(extData)) {
        // Check for tuple format: [ ["scripts", [{script}, ...]] ]
        // where the outer array contains sub-arrays of [key, value] pairs
        const tupleEntry = extData.find(
          (item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])
        );
        if (tupleEntry) {
          // Tuple format: extract scripts from the ["scripts", [...]] pair
          const tupleIndex = extData.indexOf(tupleEntry);
          scriptsArray = tupleEntry[1];
          basePath = `data.extensions.${key}[${tupleIndex}][1]`;
        } else if (extData.length > 0 && extData[0] && typeof extData[0] === 'object' && !Array.isArray(extData[0])) {
          // Direct array of script objects
          scriptsArray = extData;
          isDirectArray = true;
        }
      } else if (extData && typeof extData === 'object' && 'scripts' in extData && Array.isArray((extData as any).scripts)) {
        scriptsArray = (extData as any).scripts;
      }
      
      scriptsArray.forEach((script, i) => {
        if (!script || typeof script !== 'object') return;
        
        const scriptName = script.name ? ` (${script.name})` : '';

        // Extract script name
        if (typeof script.name === 'string' && script.name.trim() !== '') {
          const path = basePath 
            ? `${basePath}[${i}].name`
            : isDirectArray 
              ? `data.extensions.${key}[${i}].name`
              : `data.extensions.${key}.scripts[${i}].name`;
          fields.push({
            path,
            label: `tavernHelper[${i}].name${scriptName}`,
            group: 'tavern_helper',
            original: script.name,
            translated: '',
            status: 'pending',
            retries: 0,
          });
        }

        // Extract script info
        if (typeof script.info === 'string' && script.info.trim() !== '') {
          const path = basePath 
            ? `${basePath}[${i}].info`
            : isDirectArray 
              ? `data.extensions.${key}[${i}].info`
              : `data.extensions.${key}.scripts[${i}].info`;
          fields.push({
            path,
            label: `tavernHelper[${i}].info${scriptName}`,
            group: 'tavern_helper',
            original: script.info,
            translated: '',
            status: 'pending',
            retries: 0,
          });
        }

        // Extract script button names
        if (script.button && Array.isArray(script.button.buttons)) {
          script.button.buttons.forEach((btn: any, j: number) => {
            if (typeof btn.name === 'string' && btn.name.trim() !== '') {
              const path = basePath 
                ? `${basePath}[${i}].button.buttons[${j}].name`
                : isDirectArray 
                  ? `data.extensions.${key}[${i}].button.buttons[${j}].name`
                  : `data.extensions.${key}.scripts[${i}].button.buttons[${j}].name`;
              fields.push({
                path,
                label: `tavernHelper[${i}].button[${j}]${scriptName}`,
                group: 'tavern_helper',
                original: btn.name,
                translated: '',
                status: 'pending',
                retries: 0,
              });
            }
          });
        }

        // Extract actual script content/code
        const contentKey = typeof script.content === 'string' ? 'content' : 
                          (typeof script.script === 'string' ? 'script' : 
                          (typeof script.code === 'string' ? 'code' : null));
                          
        if (contentKey && script[contentKey].trim() !== '') {
          // Intentionally skipping hasTranslatableText and isCodeOnly for TavernHelper 
          // because JS scripts contain heavily stripped syntax that causes false negatives
          const path = basePath 
            ? `${basePath}[${i}].${contentKey}`
            : isDirectArray 
              ? `data.extensions.${key}[${i}].${contentKey}`
              : `data.extensions.${key}.scripts[${i}].${contentKey}`;
            
          fields.push({
            path,
            label: `tavernHelper[${i}].${contentKey}${scriptName}`,
            group: 'tavern_helper',
            original: script[contentKey],
            translated: '',
            status: 'pending',
            retries: 0,
          });
        }
      });
    });
  }

  return fields;
}

/* ─── Apply translations back to the card JSON ─── */
export function applyTranslationsToCard(
  card: CharacterCard,
  fields: TranslationField[],
  exportKeyMode: 'merge' | 'translated_only' | 'original_only' = 'merge'
): CharacterCard {
  // Deep clone
  const result = JSON.parse(JSON.stringify(card)) as Record<string, unknown>;

  for (const field of fields) {
    if (field.status !== 'done' || !field.translated) continue;

    // Special handling for lorebook keys AND secondary_keys (array of strings)
    if (field.path.endsWith('.keys') || field.path.endsWith('.secondary_keys')) {
      const translatedKeys = field.translated.split(',').map(k => k.trim()).filter(Boolean);
      const originalKeys = field.original.split(',').map(k => k.trim()).filter(Boolean);

      let finalKeys: string[];
      switch (exportKeyMode) {
        case 'translated_only':
          finalKeys = translatedKeys;
          break;
        case 'original_only':
          finalKeys = originalKeys;
          break;
        case 'merge':
        default:
          // MERGE: keep original keys + add translated keys (deduplicate)
          // This ensures SillyTavern triggers work in BOTH original and translated languages
          finalKeys = [...new Set([...originalKeys, ...translatedKeys])];
          break;
      }
      setNestedValue(result, field.path, finalKeys);
    } else {
      setNestedValue(result, field.path, field.translated);
    }
  }

  return result as CharacterCard;
}

/**
 * B3 FIX: Auto-translate lorebook trigger keys at export time.
 * 
 * After a card is translated from CJK → target language, lorebook entries may still
 * have CJK-only trigger keys (e.g. character names like "夏目贵志"). Since the AI
 * will now write translated names (e.g. "Natsume Takashi"), the CJK trigger keys
 * will never match → lorebook entries never activate.
 * 
 * This function:
 * 1. Builds a dictionary from translated lorebook entry names and MVU variables
 * 2. For each lorebook entry's keys/secondary_keys, finds CJK keys
 * 3. If a CJK key matches a known translated name, adds the translated name
 * 4. De-duplicates the final key list
 * 
 * @param card - The card with translations already applied
 * @param fields - All translation fields (for building name dictionary)
 * @param mvuDictionary - Optional MVU variable dictionary for additional mappings
 * @returns Card with auto-translated trigger keys added
 */
export function autoTranslateLorebookTriggerKeys(
  card: CharacterCard,
  fields: TranslationField[],
  mvuDictionary?: Record<string, string>
): CharacterCard {
  const entries = card.data?.character_book?.entries;
  if (!entries || entries.length === 0) return card;

  // Build name mapping: original CJK name → translated name
  const nameDict: Record<string, string> = {};
  
  // From lorebook entry names (name fields that were translated)
  for (const f of fields) {
    if (
      f.status === 'done' &&
      f.translated &&
      f.translated.trim() &&
      /\.name$/.test(f.path) &&
      f.path.includes('character_book.entries[')
    ) {
      const orig = f.original.trim();
      const trans = f.translated.trim();
      if (orig && trans && orig !== trans) {
        nameDict[orig] = trans;
      }
    }
  }

  // From MVU dictionary (variable names that map CJK → translated)
  if (mvuDictionary) {
    for (const [k, v] of Object.entries(mvuDictionary)) {
      if (k && v && k !== v && !nameDict[k]) {
        nameDict[k] = v;
      }
    }
  }

  // From translated lorebook key fields themselves
  for (const f of fields) {
    if (
      f.status === 'done' &&
      f.translated &&
      (f.path.endsWith('.keys') || f.path.endsWith('.secondary_keys')) &&
      f.path.includes('character_book.entries[')
    ) {
      const origKeys = f.original.split(',').map(k => k.trim()).filter(Boolean);
      const transKeys = f.translated.split(',').map(k => k.trim()).filter(Boolean);
      for (let i = 0; i < Math.min(origKeys.length, transKeys.length); i++) {
        if (origKeys[i] !== transKeys[i] && !nameDict[origKeys[i]]) {
          nameDict[origKeys[i]] = transKeys[i];
        }
      }
    }
  }

  if (Object.keys(nameDict).length === 0) return card;

  // CJK character detection regex
  const isCjk = (text: string) => /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(text);

  // Deep clone for modification
  const result = JSON.parse(JSON.stringify(card)) as CharacterCard;
  const resultEntries = result.data?.character_book?.entries;
  if (!resultEntries) return result;

  let addedCount = 0;
  for (const entry of resultEntries) {
    // Process keys
    if (Array.isArray(entry.keys)) {
      const newKeys = [...entry.keys];
      for (const key of entry.keys) {
        if (isCjk(key) && nameDict[key] && !newKeys.includes(nameDict[key])) {
          newKeys.push(nameDict[key]);
          addedCount++;
        }
      }
      entry.keys = [...new Set(newKeys)];
    }

    // Process secondary_keys
    if (Array.isArray(entry.secondary_keys)) {
      const newSecKeys = [...entry.secondary_keys];
      for (const key of entry.secondary_keys) {
        if (isCjk(key) && nameDict[key] && !newSecKeys.includes(nameDict[key])) {
          newSecKeys.push(nameDict[key]);
          addedCount++;
        }
      }
      entry.secondary_keys = [...new Set(newSecKeys)];
    }
  }

  if (addedCount > 0) {
    console.log(`[B3 AutoTrigger] Added ${addedCount} translated trigger keys to lorebook entries`);
  }

  return result;
}

/**
 * Inject new lorebook entries into a card.
 * Creates character_book structure if it doesn't exist.
 * Returns a deep-cloned updated card (does NOT mutate input).
 */
export function injectNewLorebookEntries(
  card: CharacterCard,
  newEntries: Partial<CharacterBookEntry>[]
): CharacterCard {
  const result = JSON.parse(JSON.stringify(card)) as CharacterCard;

  // Ensure data + character_book structure exists
  if (!result.data) {
    (result as any).data = {};
  }
  if (!result.data!.character_book) {
    result.data!.character_book = {
      entries: [],
      name: '',
      description: '',
    };
  }
  if (!Array.isArray(result.data!.character_book!.entries)) {
    result.data!.character_book!.entries = [];
  }

  const existingCount = result.data!.character_book!.entries.length;

  for (let i = 0; i < newEntries.length; i++) {
    const raw = newEntries[i];
    const entry: CharacterBookEntry = {
      id: existingCount + i,
      keys: Array.isArray(raw.keys) ? raw.keys : [],
      secondary_keys: Array.isArray(raw.secondary_keys) ? raw.secondary_keys : [],
      comment: typeof raw.comment === 'string' ? raw.comment : '',
      content: typeof raw.content === 'string' ? raw.content : '',
      name: typeof raw.name === 'string' ? raw.name : `Entry ${existingCount + i}`,
      constant: raw.constant ?? false,
      selective: raw.selective ?? true,
      insertion_order: raw.insertion_order ?? 100,
      enabled: raw.enabled ?? true,
      position: raw.position ?? 'before_char',
      use_regex: raw.use_regex ?? false,
      extensions: raw.extensions ?? {},
    };
    result.data!.character_book!.entries.push(entry);
  }

  return result;
}

/* ─── Validate if JSON is a valid SillyTavern card ─── */
export function validateCard(json: unknown): { valid: boolean; error?: string } {
  if (!json || typeof json !== 'object') {
    return { valid: false, error: 'Invalid JSON: not an object' };
  }
  const obj = json as Record<string, unknown>;

  const hasSpec = typeof obj.spec === 'string';
  const hasFirstMes = typeof obj.first_mes === 'string';
  const hasData = obj.data && typeof obj.data === 'object';
  const hasCharBook = hasData && (obj.data as Record<string, unknown>).character_book != null;
  const hasDataFirstMes = hasData && typeof (obj.data as Record<string, unknown>).first_mes === 'string';

  if (!hasSpec && !hasFirstMes && !hasCharBook && !hasDataFirstMes) {
    return {
      valid: false,
      error: 'Not a SillyTavern card: missing spec, first_mes, or data.character_book',
    };
  }

  return { valid: true };
}

/* ─── Get card summary info ─── */
export function getCardSummary(card: CharacterCard) {
  const name = card.data?.name || card.name || 'Unknown';
  const lorebookCount = card.data?.character_book?.entries?.length ?? 0;
  const altGreetingsCount = card.data?.alternate_greetings?.length ?? 0;
  const regexCount = card.data?.extensions?.regex_scripts?.length ?? 0;
  const hasDepthPrompt = !!card.data?.extensions?.depth_prompt?.prompt;
  const spec = card.spec || 'unknown';
  const tavernHelperCount = (() => {
    let count = 0;
    const th = card.data?.extensions?.tavern_helper as any;
    if (Array.isArray(th)) {
      // Tuple format: [ ["scripts", [...]] ]
      const tuple = th.find((item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1]));
      count += tuple ? tuple[1].length : th.filter((s: any) => s && typeof s === 'object' && !Array.isArray(s)).length;
    } else if (th?.scripts) {
      count += th.scripts.length;
    }
    if (Array.isArray(card.data?.extensions?.TavernHelper_scripts)) {
      count += (card.data.extensions!.TavernHelper_scripts as any[]).length;
    }
    return count;
  })();

  return { name, lorebookCount, altGreetingsCount, regexCount, hasDepthPrompt, spec, tavernHelperCount };
}

/**
 * (User 23/07 — Chiến lược A) Ghép bản dịch meta Mythic vào thẻ và TÍNH LẠI hash.
 *
 * Phải chạy SAU khi title/content đã được dịch: `sourceHash` lấy chính title + content làm
 * đầu vào, nên tính hash trước khi dịch xong là ra hash của bản cũ.
 *
 * Hash được tính lại cho MỌI entry Mythic, kể cả entry không có field meta nào được dịch —
 * vì content của nó vẫn có thể đã đổi ở nhánh dịch khác.
 */
export function applyMythicToCard(
  card: CharacterCard,
  fields: TranslationField[],
  originalCard?: CharacterCard,
): { card: CharacterCard; entriesTouched: number; metaFields: number; hashes: number } {
  const entries = card?.data?.character_book?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return { card, entriesTouched: 0, metaFields: 0, hashes: 0 };
  }
  // Meta luôn đọc từ thẻ GỐC: comment của thẻ xuất có thể chỉ còn tiêu đề (đã dịch), vì
  // khối meta bị tách ra khỏi đường dịch để AI không đụng vào.
  const originals = originalCard?.data?.character_book?.entries;

  // Gom bản dịch theo entry: entryIndex -> Map('BLOCK.field' -> bản dịch)
  const byEntry = new Map<number, Map<string, string>>();
  for (const f of fields) {
    if (f.group !== 'mythic' || f.status !== 'done' || !f.translated) continue;
    const m = /entries\[(\d+)\]\.__mythic\.(.+)$/.exec(f.path);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!byEntry.has(idx)) byEntry.set(idx, new Map());
    byEntry.get(idx)!.set(m[2], f.translated);
  }

  let entriesTouched = 0, metaFields = 0, hashes = 0;
  entries.forEach((entry, i) => {
    const exported = String((entry as { comment?: string }).comment ?? '');
    const origComment = String(
      (Array.isArray(originals) ? (originals[i] as { comment?: string })?.comment : undefined) ?? exported,
    );
    if (parseMythicComment(origComment).blocks.length === 0) return; // không phải entry Mythic

    // Tiêu đề cuối cùng: ưu tiên bản đã dịch trong thẻ xuất; nếu ở đó vẫn còn meta thì bóc ra.
    const title = stripAllMeta(exported).trim() || stripAllMeta(origComment).trim();
    // Hash lấy TIÊU ĐỀ MỚI + content/keys đã dịch làm đầu vào.
    const hashEntry = {
      comment: title,
      content: (entry as { content?: string }).content,
      keys: (entry as { keys?: string[] }).keys,
      key: (entry as { key?: string[] }).key,
      keysecondary: (entry as { keysecondary?: string[] }).keysecondary,
    };
    const r = applyMythicTranslation(origComment, byEntry.get(i) ?? new Map(), hashEntry as never);

    // Ghép lại: tiêu đề (đã dịch) + phần meta, giữ đúng khoảng trắng phân cách của thẻ gốc.
    const at = r.comment.indexOf('<!--');
    const metaPart = at >= 0 ? r.comment.slice(at) : '';
    const gap = /\n\s*\n\s*<!--/.test(origComment) ? '\n\n' : '\n';
    const next = metaPart ? (title ? title + gap + metaPart : metaPart) : r.comment;
    if (next === exported) return;
    (entry as { comment?: string }).comment = next;
    entriesTouched++;
    metaFields += r.metaFieldsApplied;
    hashes += r.hashesRebuilt.length;
  });

  return { card, entriesTouched, metaFields, hashes };
}
