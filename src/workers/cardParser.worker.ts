/* ─── Card Parser Web Worker ───
 * Offloads CPU-intensive operations from main thread:
 * - PNG binary parsing (extractCharaFromPNG)
 * - JSON.parse for large card data
 * - Card validation
 * - Worldbook detection & conversion
 * - Field extraction
 */

// ─── Types (duplicated to avoid import issues in worker context) ───

interface WorkerRequest {
  type: 'parse';
  id: string;
  buffer: ArrayBuffer;
  fileName: string;
  enabledGroups: string[];
}

interface WorkerResponse {
  type: 'result' | 'error' | 'progress';
  id: string;
  card?: any;
  fields?: any[];
  blobUrl?: string;
  contentType?: 'card' | 'worldbook';
  originalWorldbook?: any;
  cardFileName?: string;
  pngBuffer?: ArrayBuffer;
  error?: string;
  progress?: { stage: string; percent: number };
}

// ─── PNG Extraction (copied from pngHandler.ts to run in worker) ───

function extractCharaFromBuffer(buffer: ArrayBuffer): { json: string } {
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  // Check PNG signature
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (uint8[i] !== sig[i]) throw new Error('Not a valid PNG file');
  }

  let offset = 8;
  let foundJson: string | null = null;

  while (offset < uint8.length) {
    const length = view.getUint32(offset);
    offset += 4;
    const typeBytes = uint8.slice(offset, offset + 4);
    const type = decoder.decode(typeBytes);
    offset += 4;

    if (type === 'tEXt' || type === 'iTXt') {
      const dataBytes = uint8.slice(offset, offset + length);
      const nullIdx = dataBytes.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = decoder.decode(dataBytes.slice(0, nullIdx));
        if (keyword === 'chara') {
          const textData = dataBytes.slice(nullIdx + 1);
          const b64 = decoder.decode(textData);
          // Decode base64 → bytes → UTF-8 string
          const binStr = atob(b64);
          const bytes = Uint8Array.from({ length: binStr.length }, (_, i) => binStr.charCodeAt(i));
          foundJson = new TextDecoder('utf-8').decode(bytes);
          break;
        }
      }
    }
    offset += length;
    offset += 4; // Skip CRC
  }

  if (!foundJson) {
    throw new Error("No SillyTavern 'chara' data found in PNG.");
  }

  // Do NOT create Blob here — pass the raw buffer back to main thread via transfer (zero-copy, avoids disk write)
  return { json: foundJson };
}

// ─── Card Validation (copied from cardFields.ts) ───

function validateCard(json: unknown): { valid: boolean; error?: string } {
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

// ─── Worldbook Detection (copied from worldbookParser.ts) ───

function isWorldbookFormat(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const obj = json as Record<string, unknown>;
  if (!obj.entries || typeof obj.entries !== 'object') return false;
  if (Array.isArray(obj.entries)) return false;
  if (typeof obj.spec === 'string') return false;
  if (typeof obj.first_mes === 'string') return false;
  if (obj.data && typeof obj.data === 'object' && typeof (obj.data as any).first_mes === 'string') return false;
  const entryKeys = Object.keys(obj.entries as object);
  if (entryKeys.length === 0) return false;
  const firstEntry = (obj.entries as Record<string, unknown>)[entryKeys[0]];
  if (!firstEntry || typeof firstEntry !== 'object') return false;
  const entry = firstEntry as Record<string, unknown>;
  return Array.isArray(entry.key) || typeof entry.content === 'string';
}

function worldbookEntryToCardEntry(wb: any, originalKey: string): any {
  const entry: any = {
    keys: Array.isArray(wb.key) ? [...wb.key] : [],
    secondary_keys: Array.isArray(wb.keysecondary) ? [...wb.keysecondary] : [],
    comment: wb.comment || '',
    content: wb.content || '',
    name: wb.name,
    constant: wb.constant,
    selective: wb.selective,
    insertion_order: wb.order,
    enabled: wb.disable != null ? !wb.disable : true,
    position: typeof wb.position === 'number' ? String(wb.position) : wb.position,
    extensions: wb.extensions,
    _wb_original_key: originalKey,
    _wb_uid: wb.uid,
  };
  const knownFields = new Set([
    'key', 'keysecondary', 'comment', 'content', 'name', 'constant',
    'selective', 'order', 'position', 'disable', 'extensions', 'uid',
  ]);
  for (const [k, v] of Object.entries(wb)) {
    if (!knownFields.has(k)) entry[`_wb_${k}`] = v;
  }
  return entry;
}

function worldbookToCard(worldbook: any, fileName?: string): any {
  const entriesObj = worldbook.entries || {};
  const sortedKeys = Object.keys(entriesObj).sort((a: string, b: string) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
  const entries = sortedKeys.map((key) => worldbookEntryToCardEntry(entriesObj[key], key));
  const wbName = worldbook.name || fileName?.replace(/\.json$/i, '') || 'Worldbook';
  return {
    name: wbName,
    spec: 'worldbook',
    spec_version: '1.0',
    data: {
      name: wbName,
      description: worldbook.description || '',
      first_mes: '', mes_example: '', personality: '', scenario: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '',
      character_book: {
        name: worldbook.name, description: worldbook.description,
        scan_depth: worldbook.scan_depth, token_budget: worldbook.token_budget,
        recursive_scanning: worldbook.recursive_scanning, extensions: worldbook.extensions,
        entries,
      },
    },
  };
}

function getWorldbookSummary(worldbook: any) {
  const entryKeys = Object.keys(worldbook.entries || {});
  let withContent = 0;
  let totalContentLength = 0;
  for (const key of entryKeys) {
    const entry = worldbook.entries[key];
    if (entry.content && entry.content.trim()) {
      withContent++;
      totalContentLength += entry.content.length;
    }
  }
  return {
    name: worldbook.name || 'Unnamed Worldbook',
    entryCount: entryKeys.length,
    withContent,
    totalContentLength,
    hasDescription: !!worldbook.description,
  };
}

// ─── Field Extraction (copied from cardFields.ts) ───

function isCodeOnly(text: string): boolean {
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

function hasTranslatableText(text: string): boolean {
  if (!text || typeof text !== 'string' || text.trim() === '') return false;
  if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)) {
    return true;
  }
  let stripped = text
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/[\{\}\[\]\(\);:,=<>!&|+\-*/%.#@~`"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hasCyrillic = /[\u0400-\u04ff]/.test(stripped);
  const hasSubstantialLatin = stripped.replace(/[^a-zA-ZÀ-ÿ]/g, '').length > 10;
  return hasCyrillic || hasSubstantialLatin || stripped.length > 20;
}

type LorebookEntryType = 'initvar' | 'mvu_logic' | 'rules' | 'narrative' | 'controller';

function classifyLorebookEntry(entry: { name?: string; comment?: string; content?: string }): LorebookEntryType {
  const name = (entry.name || '').toLowerCase();
  const comment = (entry.comment || '').toLowerCase();
  const content = entry.content || '';
  if (content.includes('[initvar]') || comment.includes('initvar') || name.includes('initvar') || name.includes('var_init')) return 'initvar';
  if (/controller|mvu_update|update_mvu/i.test(comment) || /controller|mvu_update/i.test(name)) return 'controller';
  if (/mvu|zod|variable/i.test(comment) || /mvu|zod|variable/i.test(name)) return 'mvu_logic';
  const macroCount = (content.match(/\{\{(?:setvar|getvar|addvar)::/g) || []).length;
  if (macroCount >= 3) return 'mvu_logic';
  if (/rules|rule|world_info|system|guideline/i.test(comment) || /rules|rule|world_info/i.test(name)) return 'rules';
  return 'narrative';
}

function extractTranslatableFields(card: any, enabledGroups: string[]): any[] {
  const fields: any[] = [];
  const data = card.data;

  function addField(path: string, label: string, group: string, text: unknown, entryType?: LorebookEntryType) {
    if (!enabledGroups.includes(group)) return;
    if (typeof text !== 'string' || text.trim() === '') return;
    // B5 fix: comment fields are always human-readable — skip isCodeOnly check
    const isCommentField = path.endsWith('.comment');
    const isLogicField = entryType === 'mvu_logic' || entryType === 'rules' || entryType === 'controller' || entryType === 'initvar';
    if (!isCommentField && !isLogicField && isCodeOnly(text)) return;
    fields.push({ path, label, group, original: text, translated: '', status: 'pending', retries: 0, entryType });
  }

  function addArrayField(basePath: string, label: string, group: string, arr: unknown) {
    if (!enabledGroups.includes(group)) return;
    if (!Array.isArray(arr)) return;
    arr.forEach((item: any, i: number) => {
      if (typeof item === 'string' && item.trim() !== '' && !isCodeOnly(item)) {
        fields.push({ path: `${basePath}[${i}]`, label: `${label}[${i}]`, group, original: item, translated: '', status: 'pending', retries: 0 });
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
  addArrayField('data.alternate_greetings', 'data.alternate_greetings', 'messages', data.alternate_greetings);
  addArrayField('data.group_only_greetings', 'data.group_only_greetings', 'messages', data.group_only_greetings);

  // Character book entries
  if (data.character_book) {
    addField('data.character_book.name', 'lorebook.name', 'lorebook', data.character_book.name);
    addField('data.character_book.description', 'lorebook.description', 'lorebook', data.character_book.description);

    if (data.character_book.entries) {
      data.character_book.entries.forEach((entry: any, i: number) => {
        const eType = classifyLorebookEntry(entry);
        const typeTag = eType !== 'narrative' ? ` [${eType}]` : '';
        addField(`data.character_book.entries[${i}].name`, `lorebook[${i}].name${typeTag}`, 'lorebook', entry.name, eType);
        addField(`data.character_book.entries[${i}].content`, `lorebook[${i}].content${typeTag}`, 'lorebook', entry.content, eType);
        addField(`data.character_book.entries[${i}].comment`, `lorebook[${i}].comment${typeTag}`, 'lorebook', entry.comment, eType);

        if (enabledGroups.includes('lorebook_keys') && Array.isArray(entry.keys) && entry.keys.length > 0) {
          const keysText = entry.keys.join(', ');
          if (keysText.trim()) {
            fields.push({ path: `data.character_book.entries[${i}].keys`, label: `lorebook[${i}].keys${typeTag}`, group: 'lorebook_keys', original: keysText, translated: '', status: 'pending', retries: 0, entryType: eType });
          }
        }
        if (enabledGroups.includes('lorebook_keys') && Array.isArray(entry.secondary_keys) && entry.secondary_keys.length > 0) {
          const secKeysText = entry.secondary_keys.join(', ');
          if (secKeysText.trim()) {
            fields.push({ path: `data.character_book.entries[${i}].secondary_keys`, label: `lorebook[${i}].secondary_keys${typeTag}`, group: 'lorebook_keys', original: secKeysText, translated: '', status: 'pending', retries: 0, entryType: eType });
          }
        }
      });
    }
  }

  // Depth prompt
  if (data.extensions?.depth_prompt) {
    addField('data.extensions.depth_prompt.prompt', 'depth_prompt.prompt', 'depth_prompt', data.extensions.depth_prompt.prompt);
  }

  // Regex scripts (scriptName, findRegex, replaceString & trimStrings)
  if (enabledGroups.includes('regex') && data.extensions?.regex_scripts && Array.isArray(data.extensions.regex_scripts)) {
    data.extensions.regex_scripts.forEach((script: any, i: number) => {
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
        script.trimStrings.forEach((ts: any, j: number) => {
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

  // TavernHelper scripts (JS-Slash-Runner)
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
        const tupleEntry = extData.find(
          (item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])
        );
        if (tupleEntry) {
          const tupleIndex = extData.indexOf(tupleEntry);
          scriptsArray = tupleEntry[1];
          basePath = `data.extensions.${key}[${tupleIndex}][1]`;
        } else if (extData.length > 0 && extData[0] && typeof extData[0] === 'object' && !Array.isArray(extData[0])) {
          scriptsArray = extData;
          isDirectArray = true;
        }
      } else if (extData && typeof extData === 'object' && 'scripts' in extData && Array.isArray((extData as any).scripts)) {
        scriptsArray = (extData as any).scripts;
      }
      
      scriptsArray.forEach((script: any, i: number) => {
        if (!script || typeof script !== 'object') return;
        
        const scriptName = script.name ? ` (${script.name})` : '';

        // Extract script name if translatable
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
            retries: 0
          });
        }

        // Extract script info if translatable
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
            retries: 0
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
                retries: 0
              });
            }
          });
        }

        // Extract actual script content/code
        const contentKey = typeof script.content === 'string' ? 'content' : 
                          (typeof script.script === 'string' ? 'script' : 
                          (typeof script.code === 'string' ? 'code' : null));
                          
        if (contentKey && script[contentKey].trim() !== '') {
          // Skipping hasTranslatableText
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
            retries: 0
          });
        }
      });
    });
  }

  return fields;
}

// ─── Card Summary (copied from cardFields.ts) ───

function getCardSummary(card: any) {
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

// ─── Main Worker Message Handler ───

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, id, buffer, fileName, enabledGroups } = e.data;

  if (type !== 'parse') return;

  try {
    const isPng = fileName.toLowerCase().endsWith('.png');
    const isJson = fileName.toLowerCase().endsWith('.json');

    if (!isJson && !isPng) {
      self.postMessage({ type: 'error', id, error: 'Only .json and .png files are accepted' } as WorkerResponse);
      return;
    }

    // Progress: reading file
    self.postMessage({ type: 'progress', id, progress: { stage: 'reading', percent: 10 } } as WorkerResponse);
    console.time('[WORKER] total');
    console.time('[WORKER] png-parse');

    let text = '';

    if (isPng) {
      const extracted = extractCharaFromBuffer(buffer);
      text = extracted.json;
      console.timeEnd('[WORKER] png-parse');
    } else {
      console.timeEnd('[WORKER] png-parse');
      text = new TextDecoder('utf-8').decode(buffer);
    }

    // Progress: parsing JSON
    self.postMessage({ type: 'progress', id, progress: { stage: 'parsing', percent: 40 } } as WorkerResponse);
    console.time('[WORKER] json-parse');
    const json = JSON.parse(text);
    console.timeEnd('[WORKER] json-parse');

    const validation = validateCard(json);

    if (!validation.valid) {
      // Try worldbook format
      if (isWorldbookFormat(json)) {
        self.postMessage({ type: 'progress', id, progress: { stage: 'extracting', percent: 60 } } as WorkerResponse);

        const wbSummary = getWorldbookSummary(json);
        const pseudoCard = worldbookToCard(json, fileName);

        // Extract fields in worker
        self.postMessage({ type: 'progress', id, progress: { stage: 'fields', percent: 80 } } as WorkerResponse);
        console.time('[WORKER] extract-fields');
        const fields = extractTranslatableFields(pseudoCard, enabledGroups);
        console.timeEnd('[WORKER] extract-fields');

        console.timeEnd('[WORKER] total');
        console.time('[WORKER] postmessage-result');

        const result: any = {
          type: 'result', id,
          card: pseudoCard,
          fields,
          contentType: 'worldbook',
          originalWorldbook: json,
          cardFileName: fileName,
          toastMessage: `📖 Loaded Worldbook: ${wbSummary.name} (${wbSummary.entryCount} entries, ${wbSummary.withContent} with content)`,
        };
        if (isPng) {
          result.pngBuffer = buffer;
          (self as any).postMessage(result, [buffer]);
        } else {
          self.postMessage(result);
        }
        console.timeEnd('[WORKER] postmessage-result');
        return;
      }

      self.postMessage({ type: 'error', id, error: validation.error || 'Invalid card format' } as WorkerResponse);
      return;
    }

    // Progress: extracting fields
    self.postMessage({ type: 'progress', id, progress: { stage: 'extracting', percent: 60 } } as WorkerResponse);

    const card = json;
    const summary = getCardSummary(card);

    // Extract fields in worker
    self.postMessage({ type: 'progress', id, progress: { stage: 'fields', percent: 80 } } as WorkerResponse);
    console.time('[WORKER] extract-fields');
    const fields = extractTranslatableFields(card, enabledGroups);
    console.timeEnd('[WORKER] extract-fields');

    self.postMessage({ type: 'progress', id, progress: { stage: 'done', percent: 100 } } as WorkerResponse);

    console.timeEnd('[WORKER] total');
    console.time('[WORKER] postmessage-result');

    // Transfer buffer back zero-copy — avoids Chrome writing Blob to temp disk (which triggers AV scans on Windows)
    const result: any = {
      type: 'result', id,
      card,
      fields,
      contentType: 'card',
      originalWorldbook: null,
      cardFileName: fileName,
      toastMessage: `Loaded: ${summary.name} (${summary.lorebookCount} lorebook entries)`,
    };
    if (isPng) {
      result.pngBuffer = buffer;
      (self as any).postMessage(result, [buffer]);
    } else {
      self.postMessage(result);
    }
    console.timeEnd('[WORKER] postmessage-result');

  } catch (err) {
    self.postMessage({
      type: 'error', id,
      error: `Failed to parse: ${err instanceof Error ? err.message : String(err)}`,
    } as WorkerResponse);
  }
};
