import type { CharacterCard, ProxySettings, TranslationField } from '../types/card';
import { extractPatchFieldNames } from './jsonPatchValidator';
import { getMaxOutputTokens } from './apiClient';
import { extractZodObjectBlocks, parseZodFields, extractOrderedStringPairs } from './zodSchemaEngine';

/**
 * Trích xuất và parse JSON từ phản hồi của AI một cách an toàn.
 * Xử lý trường hợp AI trả về markdown code blocks hoặc có văn bản bao quanh.
 */
function parseJsonFromAi(responseText: string): any {
  let text = responseText.trim();
  
  // Try to find markdown json block
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdownMatch && markdownMatch[1]) {
    text = markdownMatch[1].trim();
  } else {
    // If no markdown block, try to find the outermost JSON object/array
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    
    // Choose the outermost structure
    let startIdx = -1;
    let endIdx = -1;
    
    if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = lastBrace;
    } else if (firstBracket !== -1 && lastBracket !== -1) {
      startIdx = firstBracket;
      endIdx = lastBracket;
    }
    
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      text = text.substring(startIdx, endIdx + 1);
    }
  }
  
  return JSON.parse(text);
}

/**
 * Áp dụng logic thay thế biến MVU/Zod vào một đoạn văn bản (text).
 * @param text Văn bản cần xử lý
 * @param variableDictionary Từ điển biến { gốc: dịch }
 * @param aggressive true: thay thế mọi nơi (code), false: chỉ thay thế trong macro/cấu trúc (văn bản)
 */
export function applyMvuToText(
  text: string,
  variableDictionary: Record<string, string>,
  aggressive: boolean = true
): string {
  if (!text || typeof text !== 'string') return text;
  
  const entries = Object.entries(variableDictionary)
    .filter(([k, v]) => k && v && k !== v)
    .sort((a, b) => b[0].length - a[0].length);
  if (entries.length === 0) return text;
  
  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CRITICAL: Escape `$` in replacement strings to prevent regex replacement pattern
  // interpretation. Without this, `$1`, `$&`, `$'`, `$\`` in translated names
  // cause the replacement to eat surrounding code characters like `{`, `$`.
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');
  
  let newText = text;
  for (const [original, translated] of entries) {
    const escaped = escapeRegExp(original);
    const safeTranslated = safeReplacement(translated);
    
    if (aggressive) {
      // ── 1. Macro double-curly: {{getvar::KEY}} / {{setvar::KEY::VAL}} ──
      newText = newText.replace(
        new RegExp(`(\\{\\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)${escaped}(\\}\\}|::)`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // ── 2. EJS function calls: getvar('KEY') / setvar('KEY', ...) ──
      const ejsRegex = new RegExp(`((?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\\s*\\(\\s*['"])([^'"]+)(['"])`, 'g');
      newText = newText.replace(ejsRegex, (match, prefix, inner, suffix) => {
        const segmentRegex = new RegExp(`(^|\\.)(${escaped})(\\.|$)`, 'g');
        const newInner = inner.replace(segmentRegex, `$1${safeTranslated}$3`);
        return `${prefix}${newInner}${suffix}`;
      });
      
      // ── 3. data-var="KEY" ──
      newText = newText.replace(
        new RegExp(`(data-var\\s*=\\s*["'])${escaped}(["'])`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // ── 4. YAML-style KEY: (at start of line) ──
      newText = newText.replace(
        new RegExp(`^(\\s*)(["']?)${escaped}(["']?)(\\s*:)`, 'gm'),
        `$1$2${safeTranslated}$3$4`
      );
      
      // ── 5. Zod schema: { KEY: z.type() } or { "KEY": z.type() } ──
      newText = newText.replace(
        new RegExp(`(["']?)${escaped}(["']?)(\\s*:\\s*(?:z|Zod)\\.)`, 'g'),
        `$1${safeTranslated}$2$3`
      );
      
      // ── 5.5. Bracket property access: obj['KEY'] / data["KEY"] ──
      newText = newText.replace(
        new RegExp(`(\\[\\s*['"])${escaped}(['"]\\s*\\])`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // ── 5.6. String literal comparisons: === 'KEY' / !== "KEY" / case 'KEY' ──
      newText = newText.replace(
        new RegExp(`((?:===|!==|==|!=|case)\\s*['"])${escaped}(['"])`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // ── 5.7. Lodash utility calls: _.get(data, 'KEY') ──
      newText = newText.replace(
        new RegExp(`(_\\.(?:get|set|has|result|pick|omit)\\s*\\([^,]+,\\s*['"])${escaped}(['"])`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // ── 6. General standalone occurrences (fallback) ──
      const isAsciiOnly = /^[a-zA-Z0-9_]+$/.test(original);
      let pattern = isAsciiOnly ? `\\b${escaped}\\b` : escaped;
      
      // Prevent double replacement if 'translated' contains 'original'
      // Example: original = "A", translated = "A (B)"
      // If we see "A", we should only replace it if it's NOT followed by " (B)"
      if (translated.includes(original)) {
        const idx = translated.indexOf(original);
        const prefix = translated.substring(0, idx);
        const suffix = translated.substring(idx + original.length);
        
        if (suffix) pattern = pattern + `(?!${escapeRegExp(suffix)})`;
        if (prefix) pattern = `(?<!${escapeRegExp(prefix)})` + pattern;
      }
      
      const regex = new RegExp(pattern, 'g');
      newText = newText.replace(regex, safeTranslated);
    } else {
      // ── Non-aggressive: chỉ thay thế trong cấu trúc cụ thể ──
      
      // 1. {{getvar::KEY}} / {{setvar::KEY::}} / {{addvar::KEY}}
      newText = newText.replace(
        new RegExp(`(\\{\\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)${escaped}(\\}\\}|::)`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // 2. EJS function calls: getvar('KEY') / setvar('KEY', ...)
      const ejsRegex = new RegExp(`((?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\\s*\\(\\s*['"])([^'"]+)(['"])`, 'g');
      newText = newText.replace(ejsRegex, (match, prefix, inner, suffix) => {
        const segmentRegex = new RegExp(`(^|\\.)(${escaped})(\\.|$)`, 'g');
        const newInner = inner.replace(segmentRegex, `$1${safeTranslated}$3`);
        return `${prefix}${newInner}${suffix}`;
      });
      
      // 3. data-var="KEY"
      newText = newText.replace(
        new RegExp(`(data-var\\s*=\\s*["'])${escaped}(["'])`, 'g'),
        `$1${safeTranslated}$2`
      );
      
      // 4. YAML-style KEY: (at start of line, with optional quotes)
      newText = newText.replace(
        new RegExp(`^(\\s*)(["']?)${escaped}(["']?)(\\s*:)`, 'gm'),
        `$1$2${safeTranslated}$3$4`
      );
      
      // 5. Zod schema: { KEY: z.type() } or { "KEY": z.type() }
      newText = newText.replace(
        new RegExp(`(["']?)${escaped}(["']?)(\\s*:\\s*(?:z|Zod)\\.)`, 'g'),
        `$1${safeTranslated}$2$3`
      );
    }
  }
  
  return newText;
}

/**
 * Áp dụng Chiến Lược B: Đồng bộ hóa tên biến MVU/Zod trên toàn bộ thẻ.
 * Thay thế một tập hợp các khóa (keys) thành các khóa đã dịch (translatedKeys) 
 * trong các thành phần trọng yếu của thẻ:
 * 1. Zod Schema Script (TavernHelper)
 * 2. Regex Scripts (HTML Dashboard)
 * 3. Lorebook Entries (Đặc biệt là [initvar] và [mvu_update])
 */
export function syncMvuVariables(
  card: CharacterCard,
  variableDictionary: Record<string, string>,
  enabledGroups?: string[]
): CharacterCard {
  // Deep clone thẻ để tránh tham chiếu
  const result = JSON.parse(JSON.stringify(card)) as CharacterCard;
  
  if (!result.data) return result;

  // Lấy danh sách các cặp [gốc, dịch], sắp xếp theo độ dài giảm dần
  const entries = Object.entries(variableDictionary).filter(([k, v]) => k && v && k !== v);
  if (entries.length === 0) return result;

  const replaceInCode = (text: string) => applyMvuToText(text, variableDictionary, true);
  const replaceInStructured = (text: string) => applyMvuToText(text, variableDictionary, false);

  // 1. Xử lý TavernHelper Scripts (Zod Schema) — code context
  if (!enabledGroups || enabledGroups.includes('tavern_helper')) {
    const tavernHelper = result.data.extensions?.tavern_helper as any;
    
    const replaceScriptContent = (script: any) => {
      if (!script || typeof script !== 'object') return script;
      const res = { ...script };
      if (typeof res.content === 'string') res.content = replaceInCode(res.content);
      if (typeof res.script === 'string') res.script = replaceInCode(res.script);
      if (typeof res.code === 'string') res.code = replaceInCode(res.code);
      return res;
    };

    // V2 object format: { scripts: [...] }
    if (tavernHelper?.scripts && Array.isArray(tavernHelper.scripts)) {
      tavernHelper.scripts = tavernHelper.scripts.map(replaceScriptContent);
    }
    // Tuple format: [ ["scripts", [...]] ]
    else if (Array.isArray(tavernHelper)) {
      for (const item of tavernHelper) {
        if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
          item[1] = item[1].map(replaceScriptContent);
        } else if (item && typeof item === 'object' && !Array.isArray(item) && (item.content || item.script || item.code)) {
          // Direct array of scripts
          Object.assign(item, replaceScriptContent(item));
        }
      }
    }
    // Hỗ trợ phiên bản cũ của TavernHelper
    const tavernHelperLegacy = result.data.extensions?.TavernHelper_scripts as any;
    if (Array.isArray(tavernHelperLegacy)) {
      result.data.extensions!.TavernHelper_scripts = tavernHelperLegacy.map(replaceScriptContent);
    }
  }

  // 2. Xử lý Regex Scripts (HTML UI, class, id, data-var) — code context
  if (!enabledGroups || enabledGroups.includes('regex')) {
    if (result.data.extensions?.regex_scripts) {
      result.data.extensions.regex_scripts = result.data.extensions.regex_scripts.map((script) => ({
        ...script,
        findRegex: typeof script.findRegex === 'string' ? replaceInCode(script.findRegex) : script.findRegex,
        replaceString: typeof script.replaceString === 'string' ? replaceInCode(script.replaceString) : script.replaceString
      }));
    }
  }

  // 3. Xử lý Lorebook Entries (Rules, [initvar], JSON Patch) — code context
  if (!enabledGroups || enabledGroups.includes('lorebook')) {
    if (result.data.character_book?.entries) {
      result.data.character_book.entries = result.data.character_book.entries.map((entry) => ({
        ...entry,
        content: replaceInCode(entry.content)
      }));
    }

    // Cập nhật backup lorebook nếu có
    const extCharBook = result.data.extensions?.character_book as any;
    if (extCharBook?.entries) {
      extCharBook.entries = extCharBook.entries.map((entry: any) => ({
        ...entry,
        content: replaceInCode(entry.content)
      }));
    }
  }

  // 4. Xử lý narrative fields — structured replacement only (chỉ thay trong macro/data-var/YAML)
  // Không replace bừa bãi trong văn xuôi
  if (!enabledGroups || enabledGroups.includes('system')) {
    if (result.data.system_prompt) {
      result.data.system_prompt = replaceInStructured(result.data.system_prompt);
    }
    if (result.data.post_history_instructions) {
      result.data.post_history_instructions = replaceInStructured(result.data.post_history_instructions);
    }
  }

  if (!enabledGroups || enabledGroups.includes('core')) {
    if (result.data.description) {
      result.data.description = replaceInStructured(result.data.description);
    }
    if (result.data.personality) {
      result.data.personality = replaceInStructured(result.data.personality);
    }
    if (result.data.scenario) {
      result.data.scenario = replaceInStructured(result.data.scenario);
    }
  }

  if (!enabledGroups || enabledGroups.includes('messages')) {
    if (result.data.first_mes) {
      result.data.first_mes = replaceInStructured(result.data.first_mes);
    }
  }

  return result;
}

/**
 * Enforce covariance between initvar YAML keys and the MVU Dictionary.
 * After AI translates an initvar entry, this function scans all YAML keys
 * in the translated text and replaces any that don't match the MVU Dictionary
 * with the correct (dictionary) value.
 *
 * This is the FINAL SAFETY NET — even if the AI used a slightly different
 * translation for a variable name, this function will forcefully align it
 * with the schema-derived dictionary.
 *
 * @param translatedText The AI-translated initvar text
 * @param mvuDictionary The MVU dictionary (original CJK → translated name)
 * @returns { text: string, fixes: { found: string, replaced: string }[] }
 */
export function enforceInitvarCovariance(
  translatedText: string,
  mvuDictionary: Record<string, string>
): { text: string; fixes: { found: string; replaced: string }[] } {
  if (!translatedText || typeof translatedText !== 'string') {
    return { text: translatedText, fixes: [] };
  }

  const fixes: { found: string; replaced: string }[] = [];

  // Build reverse lookup: translated value → original CJK key
  // This lets us check if a YAML key in the output IS a valid translated name
  const translatedToOriginal = new Map<string, string>();
  const originalToTranslated = new Map<string, string>();
  for (const [orig, trans] of Object.entries(mvuDictionary)) {
    if (orig && trans && orig !== trans) {
      translatedToOriginal.set(trans.toLowerCase(), orig);
      originalToTranslated.set(orig, trans);
    }
  }

  if (originalToTranslated.size === 0) {
    return { text: translatedText, fixes: [] };
  }

  // Extract all YAML-style keys from the translated text
  // Match: "key": value  OR  key: value  (at start of line, with optional quotes)
  const lines = translatedText.split('\n');
  let result = translatedText;

  for (const line of lines) {
    const yamlMatch = line.match(/^(\s*)(?:["']([^"':\n]+)["']|([^"':\s\n][^"':\n]*[^"':\s\n]|[^"':\s\n]))\s*:/);
    if (!yamlMatch) continue;

    const yamlKey = (yamlMatch[2] || yamlMatch[3])?.trim();
    if (!yamlKey) continue;

    // Skip if this key is already correct (exists as a translated value in dict)
    if (translatedToOriginal.has(yamlKey.toLowerCase())) continue;

    // Skip if this key is a CJK original (hasn't been translated yet — will be handled by applyMvuToText)
    if (originalToTranslated.has(yamlKey)) continue;

    // This key is NOT in the dictionary — it might be a mismatched translation
    // Try to find the correct translation by checking if any dictionary value
    // is "close" to this key (fuzzy match)
    const correctValue = findClosestDictValue(yamlKey, mvuDictionary);
    if (correctValue && correctValue !== yamlKey) {
      // Build a regex that replaces this specific YAML key occurrence
      const escaped = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyRegex = new RegExp(
        `^(\\s*)(["']?)${escaped}(["']?)(\\s*:)`,
        'gm'
      );
      const safeReplacement = correctValue.replace(/\$/g, '$$$$');
      const newText = result.replace(keyRegex, `$1$2${safeReplacement}$3$4`);
      if (newText !== result) {
        result = newText;
        fixes.push({ found: yamlKey, replaced: correctValue });
      }
    }
  }

  return { text: result, fixes };
}

/**
 * Find the closest matching dictionary value for a potentially mismatched YAML key.
 * Uses normalized comparison to handle common AI translation variations:
 * - Case differences: "Hảo cảm" vs "Hảo Cảm"
 * - Prefix additions: "Độ Hảo Cảm" vs "Hảo Cảm"
 * - Word order: "Cảm Hảo" vs "Hảo Cảm"
 */
function findClosestDictValue(
  yamlKey: string,
  mvuDictionary: Record<string, string>
): string | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const normalizedKey = normalize(yamlKey);

  // Direct case-insensitive match against translated values
  for (const [, trans] of Object.entries(mvuDictionary)) {
    if (!trans || trans === yamlKey) continue;
    if (normalize(trans) === normalizedKey) {
      return trans; // Exact match after normalization — use dict value
    }
  }

  // Substring containment: "Độ Hảo Cảm" contains "Hảo Cảm"
  // Only match if the dict value is a significant portion of the key
  for (const [, trans] of Object.entries(mvuDictionary)) {
    if (!trans || trans.length < 2) continue;
    const normalizedTrans = normalize(trans);
    // Check if key contains the dict value or vice versa
    if (normalizedKey.includes(normalizedTrans) || normalizedTrans.includes(normalizedKey)) {
      // Only accept if length ratio is reasonable (> 60%)
      const ratio = Math.min(normalizedKey.length, normalizedTrans.length) /
                    Math.max(normalizedKey.length, normalizedTrans.length);
      if (ratio > 0.6) {
        return trans;
      }
    }
  }

  return null;
}

// ─── Noise Filter Sets ───
const NOISE_GENERIC = new Set([
  'true', 'false', 'null', 'undefined', 'enabled', 'disabled',
  'name', 'value', 'type', 'content', 'key', 'keys', 'data', 'id',
  'class', 'style', 'script', 'div', 'span', 'table', 'tr', 'td', 'th',
  'input', 'button', 'label', 'select', 'option', 'form', 'img', 'src',
  'href', 'title', 'alt', 'width', 'height', 'comment', 'entries',
  'description', 'text', 'string', 'number', 'boolean', 'object', 'array',
  'index', 'length', 'count', 'size', 'min', 'max', 'start', 'end',
  'role', 'user', 'system', 'assistant', 'model', 'prompt', 'message',
  'error', 'result', 'response', 'request', 'status', 'code', 'enum',
]);

const NOISE_CSS = new Set([
  'color', 'background', 'background-color', 'background-image', 'background-size',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-radius', 'border-color', 'border-width', 'border-style',
  'border-top', 'border-bottom', 'border-left', 'border-right',
  'display', 'position', 'top', 'left', 'right', 'bottom',
  'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
  'text-align', 'text-decoration', 'text-transform', 'text-shadow',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'overflow', 'overflow-x', 'overflow-y', 'opacity', 'cursor', 'z-index',
  'float', 'clear', 'visibility', 'outline', 'box-shadow', 'box-sizing',
  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows',
  'align-items', 'align-content', 'align-self',
  'justify-content', 'justify-items', 'justify-self',
  'gap', 'row-gap', 'column-gap', 'order',
  'transform', 'transition', 'animation', 'animation-name',
  'animation-duration', 'animation-delay',
  'filter', 'backdrop-filter', 'clip-path', 'object-fit',
  'appearance', 'resize', 'user-select', 'pointer-events',
  'vertical-align', 'list-style', 'content',
  'fill', 'stroke', 'stroke-width', // SVG
  'rgb', 'rgba', 'hsl', 'hsla', 'calc', 'var', // CSS functions (lowercase)
]);

const NOISE_CODE = new Set([
  'const', 'let', 'var', 'function', 'return', 'export', 'import',
  'if', 'else', 'for', 'while', 'do', 'class', 'new', 'this',
  'async', 'await', 'try', 'catch', 'throw', 'finally',
  'switch', 'case', 'break', 'continue', 'default',
  'typeof', 'instanceof', 'void', 'delete', 'from', 'as', 'extends',
  'implements', 'interface', 'abstract', 'static', 'super', 'yield',
  'constructor', 'prototype', 'module', 'require', 'define',
  'console', 'document', 'window', 'event', 'target', 'element',
  'innerHTML', 'textContent', 'className', 'classList',
  'addEventListener', 'removeEventListener', 'querySelector',
  'getAttribute', 'setAttribute', 'appendChild', 'createElement',
  'parse', 'stringify', 'toString', 'valueOf', 'hasOwnProperty',
  'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every',
  'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
  'join', 'split', 'replace', 'match', 'test', 'exec', 'trim',
  'includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith',
  'keys', 'values', 'entries', 'assign', 'freeze', 'defineProperty',
  'Promise', 'resolve', 'reject', 'then', 'catch', 'finally',
  'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean',
  'JSON', 'RegExp', 'Error', 'Map', 'Set', 'Symbol', 'Proxy',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'fetch', 'abort', 'signal', 'headers', 'body', 'method',
]);

/** Check if a key is noise (CSS, code, HTML, generic) */
function isNoiseKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (NOISE_GENERIC.has(lower)) return true;
  if (NOISE_CSS.has(lower)) return true;
  if (NOISE_CODE.has(lower)) return true;
  // Pure numeric
  if (/^\d+$/.test(key)) return true;
  // Single char (allow single CJK chars, ignore single ASCII)
  if (key.length < 2 && /^[a-zA-Z0-9_]$/.test(key)) return true;
  // Too long (not a typical variable name)
  if (key.length > 50) return true;
  // CSS-like patterns: starts with - or contains only lowercase+hyphens (e.g. "border-radius")
  if (/^-/.test(key) || /^[a-z]+-[a-z-]+$/.test(key)) return true;
  // Pure hex colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(key)) return true;
  // URL-like
  if (/^https?:/.test(key) || /^\/\//.test(key)) return true;
  return false;
}

/** Rich key info for MVU Panel display */
export interface MvuKeyInfo {
  key: string;
  sources: ('yaml' | 'macro' | 'zod' | 'datavar' | 'jsonpatch' | 'enum' | 'bracket' | 'comparison' | 'lodash')[];
  keyType?: 'field_name' | 'enum_value' | 'string_literal';
  description?: string; // from Zod .describe()
  occurrences: number;  // how many times it appears in card
}

/**
 * Extract Zod .describe() annotations from schema text.
 * E.g. `好感度: z.number().describe("How much the character likes the user")` → {"好感度": "How much..."}
 */
export function extractZodDescriptions(schemaText: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!schemaText) return result;

  // Pattern: fieldName: z.type().describe("description") or .describe('description')
  const regex = /([^\s:.,;()]+)\s*:\s*(?:z|Zod)\.\w+(?:\([^)]*\))?(?:\.\w+\([^)]*\))*\.describe\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;
  while ((match = regex.exec(schemaText)) !== null) {
    result[match[1]] = match[2];
  }

  // Also try: z.object keys with describe, including quoted ones
  const regex2 = /['"]([^'":\s]+)['"]\s*:\s*(?:z|Zod)\.\w+(?:\([^)]*\))?(?:\.\w+\([^)]*\))*\.describe\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = regex2.exec(schemaText)) !== null) {
    if (!result[match[1]]) {
      result[match[1]] = match[2];
    }
  }

  return result;
}

/**
 * Robustly extract schema context (TavernHelper scripts) from a card.
 * Handles different TavernHelper formats (V2 object, V1 tuples, Legacy).
 */
export function extractSchemaContextFromCard(card: CharacterCard | null | undefined): string {
  if (!card?.data?.extensions) return '';
  const data = card.data;
  
  const thScripts: { content?: string; script?: string; code?: string }[] = [];
  
  // 1. Current tavern_helper
  const tavernHelperRaw = data.extensions?.tavern_helper as any;
  if (Array.isArray(tavernHelperRaw)) {
    // Tuple format: [ ["scripts", [{content:...}, ...]] ]
    for (const item of tavernHelperRaw) {
      if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
        thScripts.push(...item[1].filter((s: any) => s?.content || s?.script || s?.code));
      } else if (item && typeof item === 'object' && !Array.isArray(item) && (item.content || item.script || item.code)) {
        thScripts.push(item);
      }
    }
  } else if (tavernHelperRaw?.scripts && Array.isArray(tavernHelperRaw.scripts)) {
    thScripts.push(...tavernHelperRaw.scripts.filter((s: any) => s?.content || s?.script || s?.code));
  }

  // 2. Legacy TavernHelper_scripts
  const tavernHelperLegacy = data.extensions?.TavernHelper_scripts as any;
  if (Array.isArray(tavernHelperLegacy)) {
    thScripts.push(...tavernHelperLegacy.filter((s: any) => s?.content || s?.script || s?.code));
  }
  
  return thScripts.map(s => s.content || s.script || s.code || '').filter(Boolean).join('\n\n');
}

export function extractPotentialMvuKeys(card: CharacterCard): MvuKeyInfo[] {
  const keys = new Set<string>();
  // Track key sources for cross-validation
  const keySources = new Map<string, Set<string>>(); // key → Set<'yaml'|'macro'|'zod'|'datavar'>
  // Track occurrence counts
  const keyOccurrences = new Map<string, number>();
  const data = card.data;
  if (!data) return [];

  const trackKey = (key: string, source: string) => {
    keys.add(key);
    if (!keySources.has(key)) keySources.set(key, new Set());
    keySources.get(key)!.add(source);
    keyOccurrences.set(key, (keyOccurrences.get(key) || 0) + 1);
  };

  // ─── Scan YAML keys: ONLY for [initvar]/MVU entries ───
  const scanYamlKeys = (text: string) => {
    if (!text || typeof text !== 'string') return;
    // Match keys with or without quotes, e.g. 'key:', '"My Key":', 'My_Key:'
    const yamlKeyRegex = /^\s*(?:["']([^"':\n]+)["']|([^"':\s\n][^"':\n]*[^"':\s\n]|[^"':\s\n]))\s*:/gm;
    let match;
    while ((match = yamlKeyRegex.exec(text)) !== null) {
      const key = (match[1] || match[2])?.trim();
      if (key && !key.startsWith('[') && !key.startsWith('<') && !key.startsWith('//') && !key.startsWith('#') && !key.startsWith('{') && !key.startsWith('*')) {
        trackKey(key, 'yaml');
      }
    }
  };

  // ─── Scan macros (all sources) ───
  const scanMacros = (text: string) => {
    if (!text || typeof text !== 'string') return;
    const varMacroRegex = /\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/g;
    let match;
    while ((match = varMacroRegex.exec(text)) !== null) {
      const key = match[1].trim();
      if (key) trackKey(key, 'macro');
    }
  };

  // ─── Scan EJS function calls (TavernHelper/Regex/Lorebook) ───
  const scanEjsCalls = (text: string) => {
    if (!text || typeof text !== 'string') return;
    const ejsCallRegex = /(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = ejsCallRegex.exec(text)) !== null) {
      const fullKey = match[1].trim();
      if (fullKey) {
        // For dotted paths like stat_data.X.Y, extract each segment
        const segments = fullKey.split('.');
        for (const seg of segments) {
          if (seg && !isNoiseKey(seg)) {
            trackKey(seg, 'ejs');
          }
        }
      }
    }
  };

  // ─── Scan Zod schema fields ───
  const scanZodFields = (text: string) => {
    if (!text || typeof text !== 'string') return;
    // Handle both unquoted (word chars + unicode) and quoted keys
    const zodFieldRegex = /(?:["']([^"']+)["']|([^\s:.,;()]+))\s*:\s*(?:z|Zod)\.\w+/g;
    let match;
    while ((match = zodFieldRegex.exec(text)) !== null) {
      const key = match[1] || match[2];
      if (key && !isNoiseKey(key)) {
        trackKey(key, 'zod');
      }
    }
  };

  // ─── Scan data-var attributes ───
  const scanDataVar = (text: string) => {
    if (!text || typeof text !== 'string') return;
    const dataVarRegex = /data-var\s*=\s*["']([^"']+)["']/g;
    let match;
    while ((match = dataVarRegex.exec(text)) !== null) {
      trackKey(match[1], 'datavar');
    }
  };

  // ─── Scan z.enum values and .default/.prefault values ───
  // Extracts enum option strings and default values so they get into the MVU dictionary
  // and are translated consistently across schema, initvar, and all other fields.
  const scanZodEnumAndDefaultValues = (text: string) => {
    if (!text || typeof text !== 'string') return;
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(text);
    if (!hasCJK) return;

    // z.enum(['value1', 'value2', ...])
    const enumRegex = /(?:z|Zod)\.enum\(\s*\[([^\]]+)\]/g;
    let match;
    while ((match = enumRegex.exec(text)) !== null) {
      const valuesStr = match[1];
      const values = valuesStr.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''));
      for (const val of values) {
        if (val && val.length > 1 && /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(val)) {
          trackKey(val, 'enum');
        }
      }
    }

    // .default('value') or .prefault('value') — extract CJK string values
    const defaultRegex = /\.(?:default|prefault)\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = defaultRegex.exec(text)) !== null) {
      const val = match[1].trim();
      if (val && val.length > 1 && /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(val)) {
        trackKey(val, 'enum');
      }
    }
  };

  // ─── Scan bracket property access: obj['Key'], data["Key"] ───
  const scanBracketAccess = (text: string) => {
    if (!text || typeof text !== 'string') return;
    // Match: identifier['CJK key'] or identifier["CJK key"]
    const bracketRegex = /\w+\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
    let match;
    while ((match = bracketRegex.exec(text)) !== null) {
      const val = match[1].trim();
      if (val && val.length > 1 && /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(val) && !isNoiseKey(val)) {
        trackKey(val, 'bracket');
      }
    }
  };

  // ─── Scan string literal comparisons: === 'X', !== 'X', case 'X' ───
  const scanStringLiteralComparisons = (text: string) => {
    if (!text || typeof text !== 'string') return;
    // Match: === 'CJK', !== "CJK", == 'CJK', != "CJK", case 'CJK':
    const compRegex = /(?:===|!==|==|!=|case)\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = compRegex.exec(text)) !== null) {
      const val = match[1].trim();
      if (val && val.length > 1 && /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(val)) {
        trackKey(val, 'comparison');
      }
    }
  };

  // ─── Scan lodash/utility access: _.get(data, 'X'), _.set(obj, ['X','Y']) ───
  const scanLodashAccess = (text: string) => {
    if (!text || typeof text !== 'string') return;
    // _.get(data, 'Key') or _.set(obj, 'Key', val)
    const lodashStrRegex = /_\.(?:get|set|has|result|pick|omit)\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = lodashStrRegex.exec(text)) !== null) {
      const fullPath = match[1].trim();
      // Handle dotted paths: 'a.b.c' → extract each segment
      for (const seg of fullPath.split('.')) {
        if (seg && /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(seg) && !isNoiseKey(seg)) {
          trackKey(seg, 'lodash');
        }
      }
    }
    // _.get(data, ['Key1', 'Key2']) — array path
    const lodashArrRegex = /_\.(?:get|set|has|result)\s*\([^,]+,\s*\[([^\]]+)\]/g;
    while ((match = lodashArrRegex.exec(text)) !== null) {
      const arrStr = match[1];
      const items = arrStr.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''));
      for (const item of items) {
        if (item && /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(item) && !isNoiseKey(item)) {
          trackKey(item, 'lodash');
        }
      }
    }
  };

  // ═══════════════════════════════════════════════════════════
  // SOURCE 1: Lorebook entries
  // ═══════════════════════════════════════════════════════════
  const entries = data.character_book?.entries || [];
  for (const entry of entries) {
    const commentStr = String(entry.comment || '');
    const nameStr = String(entry.name || '');
    const contentStr = String(entry.content || '');
    const isInitvar = commentStr.toLowerCase().includes('initvar') ||
      contentStr.includes('[initvar]');
    const isMvu = /mvu|variable|var_init|zod/i.test(commentStr) ||
      /mvu|variable|var_init|zod|initvar/i.test(nameStr);

    if (isInitvar || isMvu) {
      // Full scan for MVU/initvar entries: ALL scanners
      scanYamlKeys(entry.content);
      scanMacros(entry.content);
      scanEjsCalls(entry.content);
      scanZodFields(entry.content);
      scanDataVar(entry.content);
      scanZodEnumAndDefaultValues(entry.content);
      scanBracketAccess(entry.content);
      scanStringLiteralComparisons(entry.content);
      scanLodashAccess(entry.content);
    } else if (entry.content) {
      // Scan for JSON Patch field names
      const patchFields = extractPatchFieldNames(entry.content);
      for (const pf of patchFields) trackKey(pf, 'jsonpatch');
      // Other entries: macros + EJS + data-var + Zod + enum + bracket + comparison (NO YAML — too noisy)
      scanMacros(entry.content);
      scanEjsCalls(entry.content);
      scanDataVar(entry.content);
      scanZodFields(entry.content);
      scanZodEnumAndDefaultValues(entry.content);
      scanBracketAccess(entry.content);
      scanStringLiteralComparisons(entry.content);
      scanLodashAccess(entry.content);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SOURCE 2: TavernHelper scripts (Zod schema, MVU logic)
  // ═══════════════════════════════════════════════════════════
  const tavernHelperRaw = data.extensions?.tavern_helper as any;
  // Collect all TavernHelper scripts regardless of format
  const thScripts: { content: string }[] = [];
  if (Array.isArray(tavernHelperRaw)) {
    // Tuple format: [ ["scripts", [{content:...}, ...]] ]
    for (const item of tavernHelperRaw) {
      if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
        thScripts.push(...item[1].filter((s: any) => s?.content));
      } else if (item && typeof item === 'object' && !Array.isArray(item) && item.content) {
        thScripts.push(item);
      }
    }
  } else if (tavernHelperRaw?.scripts && Array.isArray(tavernHelperRaw.scripts)) {
    thScripts.push(...tavernHelperRaw.scripts.filter((s: any) => s?.content));
  }
  for (const script of thScripts) {
    // ALL code scanners (NO YAML — scripts are JS code, not YAML)
    scanZodFields(script.content);
    scanMacros(script.content);
    scanEjsCalls(script.content);
    scanDataVar(script.content);
    scanZodEnumAndDefaultValues(script.content);
    scanBracketAccess(script.content);
    scanStringLiteralComparisons(script.content);
    scanLodashAccess(script.content);
  }
  const tavernHelperLegacy = data.extensions?.TavernHelper_scripts as { content: string }[] | undefined;
  if (Array.isArray(tavernHelperLegacy)) {
    for (const script of tavernHelperLegacy) {
      scanZodFields(script.content);
      scanMacros(script.content);
      scanEjsCalls(script.content);
      scanDataVar(script.content);
      scanZodEnumAndDefaultValues(script.content);
      scanBracketAccess(script.content);
      scanStringLiteralComparisons(script.content);
      scanLodashAccess(script.content);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SOURCE 3: Regex scripts (HTML dashboard UI)
  // ═══════════════════════════════════════════════════════════
  if (data.extensions?.regex_scripts) {
    for (const script of data.extensions.regex_scripts) {
      if (script.findRegex && typeof script.findRegex === 'string') {
        scanDataVar(script.findRegex);
        scanMacros(script.findRegex);
        scanEjsCalls(script.findRegex);
        scanZodFields(script.findRegex);
        scanZodEnumAndDefaultValues(script.findRegex);
        scanBracketAccess(script.findRegex);
        scanStringLiteralComparisons(script.findRegex);
      }
      if (script.replaceString) {
        // ALL code scanners (NO YAML — this is HTML)
        scanDataVar(script.replaceString);
        scanMacros(script.replaceString);
        scanEjsCalls(script.replaceString);
        scanZodFields(script.replaceString);
        scanZodEnumAndDefaultValues(script.replaceString);
        scanBracketAccess(script.replaceString);
        scanStringLiteralComparisons(script.replaceString);
        scanLodashAccess(script.replaceString);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SOURCE 4: Narrative fields — macros only
  // ═══════════════════════════════════════════════════════════
  const narrativeFields = [
    data.system_prompt, data.post_history_instructions,
    data.description, data.personality, data.scenario, data.first_mes,
  ];
  for (const fieldText of narrativeFields) {
    if (!fieldText || typeof fieldText !== 'string') continue;
    scanMacros(fieldText);
    scanEjsCalls(fieldText);
    scanZodFields(fieldText);
  }
  if (Array.isArray(data.alternate_greetings)) {
    for (const greeting of data.alternate_greetings) {
      if (typeof greeting !== 'string') continue;
      scanMacros(greeting);
      scanEjsCalls(greeting);
      scanZodFields(greeting);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EXTRACT Zod descriptions for context
  // ═══════════════════════════════════════════════════════════
  let zodDescriptions: Record<string, string> = {};
  const allScripts = [
    ...thScripts,
    ...(Array.isArray(tavernHelperLegacy) ? tavernHelperLegacy : []),
  ];
  for (const script of allScripts) {
    if (script.content) {
      Object.assign(zodDescriptions, extractZodDescriptions(script.content));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FILTER: Remove noise + prioritize multi-source keys
  // ═══════════════════════════════════════════════════════════
  const result: MvuKeyInfo[] = [];
  for (const key of keys) {
    const sources = keySources.get(key);
    const isExplicit = sources && (sources.has('macro') || sources.has('datavar') || sources.has('yaml') || sources.has('zod') || sources.has('enum') || sources.has('bracket') || sources.has('lodash'));

    if (isExplicit) {
      // For explicit sources, only filter out extreme noise
      if (/^\d+$/.test(key) || key.length > 80) continue;
      if (key.length < 2 && /^[a-zA-Z0-9_]$/.test(key)) continue;
      // Skip pure hex colors and URLs as they are never variables
      if (/^#[0-9a-fA-F]{3,8}$/.test(key) || /^https?:/.test(key) || /^\/\//.test(key)) continue;
    } else {
      // For implicit sources (e.g. only EJS calls, comparison), apply full strict noise filtering
      if (isNoiseKey(key)) continue;
    }

    // Auto-classify keyType based on sources
    let keyType: MvuKeyInfo['keyType'] = undefined;
    if (sources) {
      if (sources.has('enum')) {
        keyType = 'enum_value';
      } else if (sources.has('yaml') || sources.has('zod') || sources.has('datavar')) {
        keyType = 'field_name';
      } else if (sources.has('comparison') || (sources.has('bracket') && !sources.has('macro'))) {
        keyType = 'string_literal';
      }
    }

    result.push({
      key,
      sources: [...(sources || [])] as MvuKeyInfo['sources'],
      keyType,
      description: zodDescriptions[key],
      occurrences: keyOccurrences.get(key) || 1,
    });
  }

  return result;
}

/**
 * Backward-compatible wrapper: returns just the key strings.
 * Used by callers that don't need the rich metadata.
 */
export function extractPotentialMvuKeyStrings(card: CharacterCard): string[] {
  return extractPotentialMvuKeys(card).map(k => k.key);
}

/* ═══ AI Auto-translate MVU Keys ═══ */

/**
 * Gọi AI để dịch tên biến MVU/Zod thành tên biến tương ứng trong ngôn ngữ đích.
 * Quy tắc: Tên biến dịch phải dùng underscore thay space, giữ format code-friendly.
 * VD: "好感度" → "Do_Hao_Cam", "攻击力" → "Suc_Tan_Cong"
 */
export async function aiTranslateMvuKeys(
  keys: string[],
  targetLang: string,
  proxy: ProxySettings,
  signal?: AbortSignal,
  schemaContext?: string,
  keyDescriptions?: Record<string, string>,
  modInstructions?: string,
  existingMappings?: Record<string, string>
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  // Lọc keys đã là ASCII — không cần dịch
  const keysToTranslate = keys.filter(k => !/^[a-zA-Z0-9_]+$/.test(k));
  const result: Record<string, string> = {};

  // ASCII keys giữ nguyên
  for (const k of keys) {
    if (/^[a-zA-Z0-9_]+$/.test(k)) {
      result[k] = k;
    }
  }

  if (keysToTranslate.length === 0) return result;

  // Build mod-aware system prompt
  const modBlock = modInstructions?.trim()
    ? `\n\n═══ USER MOD INSTRUCTIONS (HIGHEST PRIORITY) ═══\nThe user has provided custom instructions for how variable names should be translated. Follow these instructions ABOVE ALL other rules:\n${modInstructions.trim()}\n═══ END MOD INSTRUCTIONS ═══`
    : '';

  const systemPrompt = `Translate CJK (Chinese/Japanese/Korean) variable names to ${targetLang}. Do NOT translate English or ASCII names. Chinese proper nouns → Hán Việt. Japanese proper nouns → Romaji. Keep consistency with MVU Schema.

You are a variable name translator for SillyTavern character cards.
Your job: translate variable names from the source language to ${targetLang}.

STRICT RULES:
1. Use natural, readable formatting with diacritics (e.g. Vietnamese: Độ Hảo Cảm, Sức Tấn Công). CONSISTENCY is the only formatting rule — same variable = identical string everywhere.
2. Keep the names SHORT but meaningful (2-4 words max).
3. Be CONSISTENT: similar concepts MUST have similar naming patterns.
   - All emotion/feeling variables should follow the same pattern (e.g. Mức X, Độ X)
   - All stat variables should follow the same pattern
4. If a key is already in Latin/ASCII or English, keep it AS IS. Do NOT translate English.
5. Chinese proper nouns (character names) should use Hán Việt (Sino-Vietnamese) reading.
6. Japanese proper nouns should use Romaji transliteration (e.g. 田中 → Tanaka, 桜 → Sakura).
7. Keep numeric suffixes and prefixes intact (e.g. "攻击力2" → "Sức Tấn Công 2").
8. For Vietnamese specifically:
   - Use Title Case with diacritics: Hảo Cảm, Thể Lực, Trí Tuệ
   - Each word should be properly capitalized
   - Common patterns: 好感 → Hảo Cảm, 体力 → Thể Lực, 攻击 → Tấn Công
9. The translated names must be covariant with the Zod Schema — matching the field structure and semantics.
10. COMPOUND ENUM VALUES: Some keys are compound enum values with structure like "Phase N_Name" (e.g. "阶段 1_静谧", "阶段 2_心动"). Translate the ENTIRE compound value as one unit: "阶段 1_静谧" → "Giai đoạn 1_Tĩnh lặng". Keep the separator character (underscore) and numbering intact. These values appear in z.enum([...]), .prefault('...'), .default('...'), and YAML values — they MUST all be the same translated string.${modBlock}

RESPOND in EXACT JSON format (no markdown): {"translations": {"original_key": "Translated Key", ...}}`;

  // ─── Batch chunking for large key sets ───
  const BATCH_SIZE = 25;
  const batches: string[][] = [];
  for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
    batches.push(keysToTranslate.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    if (signal?.aborted) break;

    let contextBlock = '';
    if (schemaContext && schemaContext.trim()) {
      contextBlock = `\nHere is the Zod schema or script context where these variables are defined. USE THIS CONTEXT to understand what the variables mean (look at the .describe() text or comments):\n\`\`\`javascript\n${schemaContext.slice(0, 5000)}\n\`\`\`\n\n`;
    }

    // Build covariance constraint block from existing schema mappings
    let covarianceBlock = '';
    if (existingMappings && Object.keys(existingMappings).length > 0) {
      const mappingLines = Object.entries(existingMappings)
        .filter(([k, v]) => k !== v)
        .slice(0, 50) // Limit to avoid token overflow
        .map(([k, v]) => `  "${k}" → "${v}"`)
        .join('\n');
      if (mappingLines) {
        covarianceBlock = `\n═══ MANDATORY COVARIANCE CONSTRAINTS ═══\nThe following variables have ALREADY been translated in the Zod Schema. You MUST follow the same naming patterns and style for consistency. If any variable you are translating is semantically related to these, use the same conventions (e.g. same prefix, same word choice for shared concepts):\n${mappingLines}\n═══ END COVARIANCE CONSTRAINTS ═══\n\n`;
      }
    }

    // Build variable list with optional descriptions
    const varList = batch.map((k, i) => {
      const desc = keyDescriptions?.[k];
      return desc
        ? `${i + 1}. "${k}" — ${desc}`
        : `${i + 1}. "${k}"`;
    }).join('\n');

    let currentBatchKeys = [...batch];
    let batchRetries = 0;
    const MAX_RETRIES = 3;
    let batchSuccess = false;

    while (batchRetries < MAX_RETRIES && !batchSuccess && currentBatchKeys.length > 0) {
      if (signal?.aborted) break;

      try {
        // Build variable list for current (possibly reduced) key set
        const currentVarList = currentBatchKeys.map((k, i) => {
          const desc = keyDescriptions?.[k];
          return desc
            ? `${i + 1}. "${k}" — ${desc}`
            : `${i + 1}. "${k}"`;
        }).join('\n');

        // On retry, escalate the prompt with explicit correction hints
        let retryHint = '';
        if (batchRetries > 0) {
          retryHint = `\n\n⚠️ CRITICAL: Your previous response STILL contained Chinese/Japanese/Korean characters in the translated values. This is WRONG. You MUST translate ALL values to ${targetLang} using ONLY Latin/Roman script. Do NOT keep ANY CJK characters (汉字/漢字/한글/カタカナ) in the output values. Convert them to ${targetLang} equivalents (e.g. 好感度 → Hảo Cảm, 攻击力 → Sức Tấn Công, 状态 → Trạng Thái).`;
        }

        const currentUserPrompt = `Translate these variable names to ${targetLang} (natural, readable formatting — consistency is the only rule):${contextBlock}${covarianceBlock}
Variables to translate:
${currentVarList}${retryHint}`;

        // Increase temperature on retries to get different outputs
        const retryTemperature = Math.min(0.1 + batchRetries * 0.2, 0.5);

        const url = proxy.proxyUrl.replace(/\/+$/, '');
        let apiUrl: string;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let body: any;

        if (proxy.provider === 'anthropic') {
          apiUrl = url + '/messages';
          headers['x-api-key'] = proxy.apiKey;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
          body = {
            model: proxy.model,
            max_tokens: getMaxOutputTokens(proxy.model, proxy.maxTokens),
            system: systemPrompt,
            messages: [{ role: 'user', content: currentUserPrompt }],
            temperature: retryTemperature,
          };
        } else if (proxy.provider === 'google') {
          apiUrl = `${url}/models/${proxy.model}:generateContent?key=${proxy.apiKey}`;
          body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: currentUserPrompt }] }],
            generationConfig: { maxOutputTokens: getMaxOutputTokens(proxy.model, proxy.maxTokens), temperature: retryTemperature },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
          };
        } else {
          apiUrl = url + '/chat/completions';
          if (proxy.apiKey) headers['Authorization'] = `Bearer ${proxy.apiKey}`;
          body = {
            model: proxy.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: currentUserPrompt },
            ],
            max_tokens: getMaxOutputTokens(proxy.model, proxy.maxTokens),
            temperature: retryTemperature,
          };
        }

        // Add per-request timeout protection
        const requestTimeout = (proxy as any).requestTimeout || 300000;
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort('MVU key translation timeout'), requestTimeout * 2);
        const fetchSignal = signal
          ? AbortSignal.any([signal, timeoutController.signal])
          : timeoutController.signal;

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: fetchSignal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
        }

        const json = await res.json();
        let responseText = '';
        if (proxy.provider === 'anthropic') {
          responseText = json.content?.[0]?.text || '';
        } else if (proxy.provider === 'google') {
          responseText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          responseText = json.choices?.[0]?.message?.content || '';
        }

        // Parse JSON response
        const parsed = parseJsonFromAi(responseText);
        const translations = parsed.translations || parsed;

        // --- CJK Validation: accept good keys, collect bad ones ---
        const isTargetNonCJK = !(/chinese|中文|japanese|日本語|korean|한국어/i.test(targetLang));
        const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/;
        const cjkFailedKeys: string[] = [];

        for (const [k, v] of Object.entries(translations)) {
          if (typeof v !== 'string' || !v.trim()) continue;

          if (isTargetNonCJK && cjkRegex.test(v.trim())) {
            // This key still has CJK — track it for retry
            cjkFailedKeys.push(k);
          } else {
            // Good translation — accept immediately
            result[k] = v.trim();
          }
        }

        if (cjkFailedKeys.length > 0 && isTargetNonCJK) {
          batchRetries++;
          console.warn(`[MVU Sync] CJK detected in ${cjkFailedKeys.length}/${Object.keys(translations).length} translated variables. Retrying failed keys... (${batchRetries}/${MAX_RETRIES})`);
          if (batchRetries < MAX_RETRIES) {
            // Only retry the keys that still have CJK (not the whole batch)
            currentBatchKeys = cjkFailedKeys;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, batchRetries)));
            continue; // Retry with reduced key set
          } else {
            console.warn(`[MVU Sync] CJK remained after max retries for ${cjkFailedKeys.length} keys. Accepting CJK translations as fallback.`);
            // Accept CJK translations as fallback (better than nothing — the MVU dict
            // will still have entries, and the caller can handle them)
            for (const k of cjkFailedKeys) {
              const v = translations[k];
              if (typeof v === 'string' && v.trim()) {
                result[k] = v.trim();
              }
            }
            break;
          }
        }

        batchSuccess = true;

      } catch (err: any) {
        if (err.name === 'AbortError' || signal?.aborted) {
          throw err; // Re-throw to handle cancellation properly
        }
        batchRetries++;
        console.error(`AI MVU key translation batch failed (Retry ${batchRetries}/${MAX_RETRIES}):`, err);
        if (batchRetries < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, batchRetries)));
        }
      }
    }
  } // end batch loop

  return result;
}

/* ═══ AI Rename MVU Keys (Mod Mode) ═══ */

/**
 * Gọi AI để ĐỔI TÊN biến MVU theo yêu cầu Mod.
 * Khác với aiTranslateMvuKeys (dịch CJK → ngôn ngữ đích),
 * function này nhận biến ở BẤT KỲ ngôn ngữ nào và đổi tên theo Mod instructions.
 * Không lọc CJK, không validate ngôn ngữ — chỉ đổi tên theo yêu cầu.
 */
export async function aiRenameMvuKeys(
  keys: string[],
  currentLang: string,
  modInstructions: string,
  proxy: ProxySettings,
  signal?: AbortSignal,
  schemaContext?: string,
  keyDescriptions?: Record<string, string>
): Promise<Record<string, string>> {
  if (keys.length === 0 || !modInstructions.trim()) return {};

  const result: Record<string, string> = {};

  const systemPrompt = `You are a variable name modifier for SillyTavern character cards.
The user wants to RENAME/MODIFY variable names according to their custom instructions.
Current language: ${currentLang}.

═══ USER MOD INSTRUCTIONS (FOLLOW EXACTLY) ═══
${modInstructions.trim()}
═══ END MOD INSTRUCTIONS ═══

RULES:
1. Read the Mod instructions carefully and rename variables EXACTLY as requested.
2. If the Mod instructions say to keep a variable unchanged, return the SAME name.
3. If the Mod instructions don't mention a specific variable, keep it AS IS (return same name).
4. Maintain CONSISTENCY: similar concepts should follow similar naming patterns.
5. The renamed variables must still be valid for use in code (macros, Zod schemas, YAML keys).
6. Keep the output in the SAME script/language as the input unless Mod instructions say otherwise.

RESPOND in EXACT JSON format (no markdown): {"renames": {"current_name": "new_name", ...}}
For variables that stay the same, still include them: {"renames": {"unchanged_var": "unchanged_var"}}`;

  // ─── Batch chunking ───
  const BATCH_SIZE = 25;
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    batches.push(keys.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    if (signal?.aborted) break;

    let contextBlock = '';
    if (schemaContext && schemaContext.trim()) {
      contextBlock = `\nHere is the Zod schema or script context where these variables are defined:\n\`\`\`javascript\n${schemaContext.slice(0, 5000)}\n\`\`\`\n\n`;
    }

    const varList = batch.map((k, i) => {
      const desc = keyDescriptions?.[k];
      return desc
        ? `${i + 1}. "${k}" — ${desc}`
        : `${i + 1}. "${k}"`;
    }).join('\n');

    const userPrompt = `Rename these variable names according to the Mod instructions above:${contextBlock}
Variables to rename:
${varList}`;

    let retries = 0;
    const MAX_RETRIES = 2;

    while (retries <= MAX_RETRIES) {
      if (signal?.aborted) break;

      try {
        const url = proxy.proxyUrl.replace(/\/+$/, '');
        let apiUrl: string;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let body: any;

        if (proxy.provider === 'anthropic') {
          apiUrl = url + '/messages';
          headers['x-api-key'] = proxy.apiKey;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
          body = {
            model: proxy.model,
            max_tokens: getMaxOutputTokens(proxy.model, proxy.maxTokens),
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.1,
          };
        } else if (proxy.provider === 'google') {
          apiUrl = `${url}/models/${proxy.model}:generateContent?key=${proxy.apiKey}`;
          body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { maxOutputTokens: getMaxOutputTokens(proxy.model, proxy.maxTokens), temperature: 0.1 },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
          };
        } else {
          apiUrl = url + '/chat/completions';
          if (proxy.apiKey) headers['Authorization'] = `Bearer ${proxy.apiKey}`;
          body = {
            model: proxy.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: getMaxOutputTokens(proxy.model, proxy.maxTokens),
            temperature: 0.1,
          };
        }

        const requestTimeout = (proxy as any).requestTimeout || 300000;
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort('MVU rename timeout'), requestTimeout * 2);
        const fetchSignal = signal
          ? AbortSignal.any([signal, timeoutController.signal])
          : timeoutController.signal;

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: fetchSignal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
        }

        const json = await res.json();
        let responseText = '';
        if (proxy.provider === 'anthropic') {
          responseText = json.content?.[0]?.text || '';
        } else if (proxy.provider === 'google') {
          responseText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          responseText = json.choices?.[0]?.message?.content || '';
        }

        const parsed = parseJsonFromAi(responseText);
        const renames = parsed.renames || parsed.translations || parsed;

        for (const [k, v] of Object.entries(renames)) {
          if (typeof v === 'string' && v.trim()) {
            result[k] = v.trim();
          }
        }

        break; // Success, exit retry loop

      } catch (err: any) {
        if (err.name === 'AbortError' || signal?.aborted) {
          throw err;
        }
        retries++;
        console.error(`AI MVU rename failed (Retry ${retries}/${MAX_RETRIES}):`, err);
        if (retries <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries)));
        }
      }
    }
  }

  return result;
}

/* ═══ AI Auto-extract Glossary Terms ═══ */

/**
 * Gọi AI để quét các trường văn bản của thẻ (description, personality, lorebook names...)
 * và trích xuất ra các thuật ngữ quan trọng (tên người, địa danh, khái niệm) 
 * cùng với bản dịch sang ngôn ngữ đích.
 */
export async function aiExtractGlossaryTerms(
  card: CharacterCard,
  targetLang: string,
  proxy: ProxySettings,
  signal?: AbortSignal
): Promise<Record<string, string>> {
  let context = '';
  const data = card.data || (card as any);
  if (data.name) context += `Character Name: ${data.name}\n`;
  if (data.description) context += `Description:\n${data.description}\n\n`;
  if (data.personality) context += `Personality:\n${data.personality}\n\n`;
  if (data.scenario) context += `Scenario:\n${data.scenario}\n\n`;
  
  if (data.character_book?.entries) {
    const names = data.character_book.entries.map((e: any) => e.name).filter(Boolean);
    if (names.length > 0) context += `Lorebook Entries (Concepts/Characters):\n${names.join(', ')}\n\n`;
  }
  
  // Truncate to save tokens (first 6000 chars)
  context = context.slice(0, 6000);

  if (!context.trim()) return {};

  const systemPrompt = `You are a terminology extraction AI for roleplay character cards.
Your job is to read the character's background and extract proper nouns, character names, locations, special artifacts, and unique concepts, then translate them to ${targetLang}.

RULES:
1. ONLY extract important proper nouns and specific terminology. DO NOT extract common words (like "sword", "house", "run").
2. Translate them to ${targetLang}. 
   - For Vietnamese (${targetLang}), use proper Hán Việt (Sino-Vietnamese) for Chinese/wuxia/xianxia names (e.g. 李明 -> Lý Minh, 长安 -> Trường An).
3. Keep the list concise (max 15-20 most important terms).
4. Output EXACT JSON format: {"glossary": {"Source Term": "Translated Term"}}
5. DO NOT wrap the JSON in markdown blocks like \`\`\`json. Just output the raw JSON string.`;

  const userPrompt = `Extract and translate terminology to ${targetLang} from the following text:\n\n${context}`;

  try {
    const url = proxy.proxyUrl.replace(/\/+$/, '');
    let apiUrl: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: any;

    if (proxy.provider === 'anthropic') {
      apiUrl = url + '/messages';
      headers['x-api-key'] = proxy.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = {
        model: proxy.model,
        max_tokens: getMaxOutputTokens(proxy.model, proxy.maxTokens),
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.1,
      };
    } else if (proxy.provider === 'google') {
      apiUrl = `${url}/models/${proxy.model}:generateContent?key=${proxy.apiKey}`;
      body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: getMaxOutputTokens(proxy.model, proxy.maxTokens), temperature: 0.1 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      };
    } else {
      apiUrl = url + '/chat/completions';
      if (proxy.apiKey) headers['Authorization'] = `Bearer ${proxy.apiKey}`;
      body = {
        model: proxy.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: getMaxOutputTokens(proxy.model, proxy.maxTokens),
        temperature: 0.1,
      };
    }

    // Add per-request timeout protection
    const requestTimeout = (proxy as any).requestTimeout || 300000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort('Glossary extraction timeout'), requestTimeout * 2);
    const fetchSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: fetchSignal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`API ${res.status}`);

    const json = await res.json();
    let responseText = '';
    if (proxy.provider === 'anthropic') responseText = json.content?.[0]?.text || '';
    else if (proxy.provider === 'google') responseText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    else responseText = json.choices?.[0]?.message?.content || '';

    const parsed = parseJsonFromAi(responseText);
    const result: Record<string, string> = {};
    const glossary = parsed.glossary || parsed;
    for (const [k, v] of Object.entries(glossary)) {
      if (typeof v === 'string' && v.trim() && typeof k === 'string' && k.trim()) {
        result[k.trim()] = v.trim();
      }
    }
    return result;
  } catch (err) {
    console.error('AI Glossary extraction failed:', err);
    throw err;
  }
}

/* ═══ Regex HTML Post-Processing ═══ */

/**
 * Bản đồ font Trung → font tương thích tiếng Việt.
 * Khi gặp font-family chứa tên font Trung, thay bằng font Việt tương ứng.
 */
const CHINESE_FONT_MAP: [RegExp, string][] = [
  // Tên tiếng Trung
  [/['"']?微软雅黑['"']?/gi, "'Segoe UI', Tahoma, sans-serif"],
  [/['"']?黑体['"']?/gi, "'Segoe UI', Arial, sans-serif"],
  [/['"']?宋体['"']?/gi, "'Times New Roman', 'Noto Serif', serif"],
  [/['"']?新宋体['"']?/gi, "'Times New Roman', serif"],
  [/['"']?楷体['"']?/gi, "'Georgia', serif"],
  [/['"']?仿宋['"']?/gi, "'Georgia', serif"],
  [/['"']?幼圆['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?华文[^'",;}\s]+['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?方正[^'",;}\s]+['"']?/gi, "'Segoe UI', sans-serif"],
  // Tên tiếng Anh của font Trung
  [/['"']?SimSun['"']?/gi, "'Times New Roman', 'Noto Serif', serif"],
  [/['"']?SimHei['"']?/gi, "'Segoe UI', Arial, sans-serif"],
  [/['"']?NSimSun['"']?/gi, "'Times New Roman', serif"],
  [/['"']?FangSong['"']?/gi, "'Georgia', serif"],
  [/['"']?KaiTi['"']?/gi, "'Georgia', serif"],
  [/['"']?Microsoft YaHei['"']?/gi, "'Segoe UI', Tahoma, sans-serif"],
  [/['"']?Microsoft JhengHei['"']?/gi, "'Segoe UI', Tahoma, sans-serif"],
  [/['"']?STSong['"']?/gi, "'Times New Roman', serif"],
  [/['"']?STHeiti['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?STKaiti['"']?/gi, "'Georgia', serif"],
  [/['"']?STFangsong['"']?/gi, "'Georgia', serif"],
  [/['"']?PingFang SC['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?PingFang TC['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?Hiragino Sans GB['"']?/gi, "'Segoe UI', sans-serif"],
  // Font Nhật thường gặp
  [/['"']?MS Gothic['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?MS Mincho['"']?/gi, "'Times New Roman', serif"],
  [/['"']?Meiryo['"']?/gi, "'Segoe UI', sans-serif"],
  [/['"']?Yu Gothic['"']?/gi, "'Segoe UI', sans-serif"],
];

/**
 * Hậu xử lý HTML trong regex replaceString sau khi dịch:
 * 1. Thay font chữ Trung/Nhật → font tương thích tiếng Việt
 */
export function postProcessRegexHtml(html: string): string {
  if (!html || typeof html !== 'string') return html;

  let result = html;

  // Thay font Trung/Nhật → font Việt
  for (const [pattern, replacement] of CHINESE_FONT_MAP) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Trích xuất ánh xạ (mapping) trực tiếp từ các Schema đã được dịch (TavernHelper).
 * Hàm này so sánh Zod Object trong mã nguồn gốc và mã nguồn đã dịch của TavernHelper
 * để tìm ra các biến CJK đã được dịch thành tên biến gì một cách chính xác 100%.
 */
export function extractMappingFromTranslatedSchemas(
  card: CharacterCard,
  fields: TranslationField[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const data = card.data;
  if (!data) return mapping;

  const allScripts: { originalContent: string; translatedContent: string }[] = [];

  // Thu thập các TavernHelper scripts gốc và đã dịch tương ứng
  const thRaw = data.extensions?.tavern_helper as any;
  const legacy = data.extensions?.TavernHelper_scripts as any[];

  const findTranslatedContent = (path: string): string | null => {
    const f = fields.find(field => field.path === path);
    return f && f.status === 'done' && f.translated ? f.translated : null;
  };

  if (Array.isArray(thRaw)) {
    thRaw.forEach((item: any, i: number) => {
      if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
        item[1].forEach((s: any, idx: number) => {
          if (s?.content) {
            const path = `data.extensions.tavern_helper[${i}][1][${idx}].content`;
            const trans = findTranslatedContent(path);
            if (trans) allScripts.push({ originalContent: s.content, translatedContent: trans });
          }
        });
      } else if (item && typeof item === 'object' && !Array.isArray(item) && item.content) {
        const path = `data.extensions.tavern_helper[${i}].content`;
        const trans = findTranslatedContent(path);
        if (trans) allScripts.push({ originalContent: item.content, translatedContent: trans });
      }
    });
  } else if (thRaw?.scripts && Array.isArray(thRaw.scripts)) {
    thRaw.scripts.forEach((s: any, i: number) => {
      if (s.content) {
        const path = `data.extensions.tavern_helper.scripts[${i}].content`;
        const trans = findTranslatedContent(path);
        if (trans) allScripts.push({ originalContent: s.content, translatedContent: trans });
      }
    });
  }

  if (Array.isArray(legacy)) {
    legacy.forEach((s, i) => {
      if (s.content) {
        const path = `data.extensions.TavernHelper_scripts[${i}].content`;
        const trans = findTranslatedContent(path);
        if (trans) allScripts.push({ originalContent: s.content, translatedContent: trans });
      }
    });
  }

  // So sánh từng cặp EJS script gốc vs đã dịch
  for (const script of allScripts) {
    const origBlocks = extractZodObjectBlocks(script.originalContent);
    const transBlocks = extractZodObjectBlocks(script.translatedContent);

    // ═══ PHASE A: Extract Zod field name mappings (existing logic) ═══
    const len = Math.min(origBlocks.length, transBlocks.length);
    for (let bIdx = 0; bIdx < len; bIdx++) {
      try {
        const origFields = parseZodFields(origBlocks[bIdx]);
        const transFields = parseZodFields(transBlocks[bIdx]);

        // Nếu số lượng trường bằng nhau, ánh xạ 1-1
        if (origFields.length === transFields.length) {
          for (let fIdx = 0; fIdx < origFields.length; fIdx++) {
            const origF = origFields[fIdx];
            const transF = transFields[fIdx];
            if (origF.name && transF.name && origF.name !== transF.name) {
              mapping[origF.name] = transF.name;
            }
          }
        }
      } catch (err) {
        console.error('Failed to compare Zod block:', err);
      }
    }

    // ═══ PHASE B: Extract string literal mappings (enums, defaults, describes) ═══
    // Compare ALL string literals in the full script source (not just Zod blocks)
    // to capture enum values, .default() values, .describe() strings, etc.
    try {
      const literalMappings = extractOrderedStringPairs(
        script.originalContent,
        script.translatedContent
      );
      for (const [origLit, transLit] of Object.entries(literalMappings)) {
        // Don't override field name mappings from Phase A
        if (!(origLit in mapping)) {
          mapping[origLit] = transLit;
        }
      }
    } catch (err) {
      console.error('Failed to extract string literal mappings:', err);
    }
  }

  return mapping;
}
