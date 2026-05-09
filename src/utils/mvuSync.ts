import type { CharacterCard, ProxySettings } from '../types/card';
import { extractPatchFieldNames } from './jsonPatchValidator';
import { getMaxOutputTokens } from './apiClient';

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
        new RegExp(`([{,]\\s*)(["']?)${escaped}(["']?)(\\s*:\\s*z\\.)`, 'g'),
        `$1$2${safeTranslated}$3$4`
      );
      
      // ── 6. General standalone occurrences (fallback) ──
      const isAsciiOnly = /^[a-zA-Z0-9_]+$/.test(original);
      let regex: RegExp;
      if (isAsciiOnly) {
        // ASCII keys: sử dụng word boundary để tránh replace nhầm
        regex = new RegExp(`\\b${escaped}\\b`, 'g');
      } else {
        // Unicode keys (Trung/Nhật/Hàn): replace trực tiếp
        regex = new RegExp(escaped, 'g');
      }
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
    if (tavernHelper?.scripts) {
      tavernHelper.scripts = tavernHelper.scripts.map((script: any) => ({
        ...script,
        content: replaceInCode(script.content)
      }));
    }
    // Hỗ trợ phiên bản cũ của TavernHelper
    const tavernHelperLegacy = result.data.extensions?.TavernHelper_scripts as any;
    if (Array.isArray(tavernHelperLegacy)) {
      result.data.extensions!.TavernHelper_scripts = tavernHelperLegacy.map((script: any) => ({
        ...script,
        content: replaceInCode(script.content)
      }));
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
  // Single char
  if (key.length < 2) return true;
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
  sources: ('yaml' | 'macro' | 'zod' | 'datavar' | 'jsonpatch')[];
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
  const regex = /(\w+)\s*:\s*z\.\w+\([^)]*\)(?:\.\w+\([^)]*\))*\.describe\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;
  while ((match = regex.exec(schemaText)) !== null) {
    result[match[1]] = match[2];
  }

  // Also try: z.object keys with describe
  const regex2 = /['"]?([^'":\s]+)['"]?\s*:\s*z\.\w+(?:\([^)]*\))?\.describe\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = regex2.exec(schemaText)) !== null) {
    if (!result[match[1]]) {
      result[match[1]] = match[2];
    }
  }

  return result;
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
    // Handle both unquoted (word chars) and quoted keys
    const zodFieldRegex = /(?:["']([^"']+)["']|(\w+))\s*:\s*z\.\w+/g;
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
      // Full scan for MVU/initvar entries: YAML + macros + EJS + Zod + data-var
      scanYamlKeys(entry.content);
      scanMacros(entry.content);
      scanEjsCalls(entry.content);
      scanZodFields(entry.content);
      scanDataVar(entry.content);
    } else if (entry.content) {
      // Scan for JSON Patch field names
      const patchFields = extractPatchFieldNames(entry.content);
      for (const pf of patchFields) trackKey(pf, 'jsonpatch');
      // Other entries: macros + EJS + data-var only (NO YAML — too noisy)
      scanMacros(entry.content);
      scanEjsCalls(entry.content);
      scanDataVar(entry.content);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SOURCE 2: TavernHelper scripts (Zod schema, MVU logic)
  // ═══════════════════════════════════════════════════════════
  const tavernHelper = data.extensions?.tavern_helper as { scripts?: { content: string }[] } | undefined;
  if (tavernHelper?.scripts) {
    for (const script of tavernHelper.scripts) {
      // Zod + macros + EJS + data-var (NO YAML — scripts are JS code, not YAML)
      scanZodFields(script.content);
      scanMacros(script.content);
      scanEjsCalls(script.content);
      scanDataVar(script.content);
    }
  }
  const tavernHelperLegacy = data.extensions?.TavernHelper_scripts as { content: string }[] | undefined;
  if (Array.isArray(tavernHelperLegacy)) {
    for (const script of tavernHelperLegacy) {
      scanZodFields(script.content);
      scanMacros(script.content);
      scanEjsCalls(script.content);
      scanDataVar(script.content);
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
      }
      if (script.replaceString) {
        // data-var + macros + EJS only (NO YAML, NO Zod — this is HTML)
        scanDataVar(script.replaceString);
        scanMacros(script.replaceString);
        scanEjsCalls(script.replaceString);
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
  }
  if (Array.isArray(data.alternate_greetings)) {
    for (const greeting of data.alternate_greetings) {
      if (typeof greeting !== 'string') continue;
      scanMacros(greeting);
      scanEjsCalls(greeting);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EXTRACT Zod descriptions for context
  // ═══════════════════════════════════════════════════════════
  let zodDescriptions: Record<string, string> = {};
  const allScripts = [
    ...(tavernHelper?.scripts || []),
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
    const isExplicit = sources && (sources.has('macro') || sources.has('datavar') || sources.has('yaml'));

    if (isExplicit) {
      // For explicit sources (macros, explicitly marked MVU YAML, UI data-vars),
      // we only filter out extreme noise, allowing generic words like "name" or "status".
      if (/^\d+$/.test(key) || key.length < 2 || key.length > 50) continue;
      // Skip pure hex colors and URLs as they are never variables
      if (/^#[0-9a-fA-F]{3,8}$/.test(key) || /^https?:/.test(key) || /^\/\//.test(key)) continue;
    } else {
      // For implicit sources (e.g. only Zod schema), apply full strict noise filtering
      if (isNoiseKey(key)) continue;
    }

    result.push({
      key,
      sources: [...(sources || [])] as MvuKeyInfo['sources'],
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
  keyDescriptions?: Record<string, string>
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

    // Build variable list with optional descriptions
    const varList = batch.map((k, i) => {
      const desc = keyDescriptions?.[k];
      return desc
        ? `${i + 1}. "${k}" — ${desc}`
        : `${i + 1}. "${k}"`;
    }).join('\n');

    const userPrompt = `Translate these variable names to ${targetLang} (natural, readable formatting — consistency is the only rule):${contextBlock}
Variables to translate:
${varList}`;

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
      let jsonStr = responseText.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const parsed = JSON.parse(jsonStr);
      const translations = parsed.translations || parsed;

      for (const [k, v] of Object.entries(translations)) {
        if (typeof v === 'string' && v.trim()) {
          result[k] = v.trim();
        }
      }

    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw err; // Re-throw to handle cancellation properly
      }
      console.error(`AI MVU key translation batch failed:`, err);
      // Continue with next batch
    }
  } // end batch loop

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

    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('\`\`\`')) {
      jsonStr = jsonStr.replace(/^\`\`\`(?:json)?\s*\n?/, '').replace(/\n?\`\`\`\s*$/, '');
    }

    const parsed = JSON.parse(jsonStr);
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
