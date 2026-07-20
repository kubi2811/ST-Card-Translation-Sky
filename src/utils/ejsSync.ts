/**
 * EJS Sync — Strategy C
 *
 * Deep analysis and synchronization of EJS constructs in SillyTavern cards.
 * Ensures that entry names, keyword triggers, alias dictionaries, and decorators
 * are correctly translated and synchronized across all card fields.
 *
 * Works standalone or alongside Strategy B (MVU Sync).
 */

import type { CharacterCard, TranslationField, ProxySettings } from '../types/card';
import { fandomNameOverride } from './fandomMode';
import { callProvider } from './apiClient';
import { unifyVarWordSeparators } from './mvuSync';

/**
 * Parse JSON from AI response, handling markdown code blocks and surrounding text.
 */
function parseJsonFromAi(responseText: string): any {
  let text = responseText.trim();
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdownMatch && markdownMatch[1]) {
    text = markdownMatch[1].trim();
  } else {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    }
  }
  return JSON.parse(text);
}

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

export interface EjsDetectionResult {
  isEjs: boolean;
  confidence: number;
  ejsBlockCount: number;       // Total <% %> blocks across all fields
  entryWithEjsCount: number;   // Lorebook entries containing EJS
  hasGetwi: boolean;           // Uses getwi() / getWorldInfo()
  hasActivewi: boolean;        // Uses activewi() / activateWorldInfo() for dynamic entry control
  hasDefine: boolean;          // Uses define() for shared helpers
  hasGetChatMessages: boolean; // Uses getChatMessages() for context scanning
  hasExecute: boolean;         // Uses execute() for slash commands
  hasDecorators: boolean;      // Uses @@render_after, @@iframe, [GENERATE:], etc.
  reasons: string[];
}

export interface EjsEntryRef {
  /** The entry name/title referenced in getwi() */
  name: string;
  /** Field paths where this reference was found */
  referencedIn: string[];
  /** The actual lorebook entry index (if matched), -1 if unresolved */
  entryIndex: number;
  /** Source type of the reference */
  sourceType: 'getwi' | 'getWorldInfo' | 'getWorldInfoData' | 'getWorldInfoActivatedData' | 'activewi' | 'activateWorldInfo';
}

export interface EjsKeyword {
  /** The keyword/alias string */
  keyword: string;
  /** How it was found */
  type: 'comparison' | 'alias' | 'trigger' | 'define_name' | 'decorator_regex';
  /** Field path where found */
  foundIn: string;
  /** Surrounding context (for AI translation) */
  context?: string;
}

export interface EjsDecorator {
  /** The full decorator line */
  line: string;
  /** Decorator type */
  type: 'render' | 'iframe' | 'if' | 'private' | 'generate' | 'inject' | 'initvar' | 'other';
  /** Field path where found */
  foundIn: string;
}

export interface EjsSyncReport {
  /** Total entry names checked */
  totalEntryNames: number;
  /** Entry names correctly found in translated text */
  matchedEntryNames: number;
  /** Entry names missing from translated text */
  missingEntryNames: { name: string; translatedName: string; referencedIn: string[] }[];
  /** Total keywords checked */
  totalKeywords: number;
  /** Keywords correctly synced */
  matchedKeywords: number;
  /** Keywords missing */
  missingKeywords: { keyword: string; translatedKeyword: string; foundIn: string }[];
  /** Decorators that were incorrectly translated (should be preserved) */
  brokenDecorators: { original: string; translated: string; fieldPath: string }[];
  /** General warnings */
  warnings: string[];
}

/* ═══════════════════════════════════════════════════════════════════
   DETECTION — Detect if a card uses EJS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Detect whether a card uses EJS and how extensively.
 * Scans all lorebook entries, system prompts, depth prompts, and regex scripts.
 */
export function detectEjsCard(card: CharacterCard): EjsDetectionResult {
  const result: EjsDetectionResult = {
    isEjs: false,
    confidence: 0,
    ejsBlockCount: 0,
    entryWithEjsCount: 0,
    hasGetwi: false,
    hasActivewi: false,
    hasDefine: false,
    hasGetChatMessages: false,
    hasExecute: false,
    hasDecorators: false,
    reasons: [],
  };

  // Collect all text content from card
  const allTexts: { text: string; source: string }[] = [];

  const data = (card.data || card) as any;

  // Core fields
  for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions'] as const) {
    const val = (data as any)[key];
    if (typeof val === 'string' && val.trim()) {
      allTexts.push({ text: val, source: `data.${key}` });
    }
  }

  // Alternate greetings
  if (Array.isArray((data as any).alternate_greetings)) {
    (data as any).alternate_greetings.forEach((g: string, i: number) => {
      if (typeof g === 'string' && g.trim()) {
        allTexts.push({ text: g, source: `data.alternate_greetings[${i}]` });
      }
    });
  }

  // Lorebook entries
  const entries = data.character_book?.entries || [];
  entries.forEach((entry: any, i: number) => {
    if (typeof entry.content === 'string' && entry.content.trim()) {
      allTexts.push({ text: entry.content, source: `lorebook[${i}]` });
    }
    if (typeof entry.comment === 'string' && entry.comment.trim()) {
      allTexts.push({ text: entry.comment, source: `lorebook[${i}].comment` });
    }
    if (typeof entry.name === 'string' && entry.name.trim()) {
      allTexts.push({ text: entry.name, source: `lorebook[${i}].name` });
    }
  });

  // Depth prompt
  if (data.extensions?.depth_prompt?.prompt) {
    allTexts.push({ text: data.extensions.depth_prompt.prompt, source: 'depth_prompt' });
  }

  // Regex scripts
  if (Array.isArray(data.extensions?.regex_scripts)) {
    data.extensions.regex_scripts.forEach((rs: any, i: number) => {
      if (typeof rs.replaceString === 'string' && rs.replaceString.trim()) {
        allTexts.push({ text: rs.replaceString, source: `regex[${i}].replaceString` });
      }
    });
  }

  // TavernHelper scripts
  const thScripts = data.extensions?.tavern_helper;
  if (thScripts) {
    let scripts: any[] = [];
    if (Array.isArray(thScripts)) {
      for (const item of thScripts) {
        if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
          scripts.push(...item[1]);
        } else if (item && typeof item === 'object' && !Array.isArray(item) && item.content) {
          scripts.push(item);
        }
      }
    } else if (thScripts.scripts && Array.isArray(thScripts.scripts)) {
      scripts = thScripts.scripts;
    }
    scripts.forEach((s: any, i: number) => {
      if (typeof s.content === 'string' && s.content.trim()) {
        allTexts.push({ text: s.content, source: `tavern_helper[${i}]` });
      }
    });
  }

  // Scan all texts
  const ejsTagRegex = /<%[\s\S]*?%>/g;
  const getwiRegex = /(?:getwi|getWorldInfo)\s*\(/g;
  const activewiRegex = /(?:activewi|activateWorldInfo)\s*\(/g;
  const getWorldInfoDataRegex = /(?:getWorldInfoData|getWorldInfoActivatedData)\s*\(/g;
  const defineRegex = /define\s*\(\s*['"`]/g;
  const getChatMessagesRegex = /getChatMessages\s*\(/g;
  const executeRegex = /(?:await\s+)?execute\s*\(\s*['"`]/g;
  const decoratorRegex = /^@@(?:render_after|render_before|iframe|if|private|else|end)|^\[(?:GENERATE|RENDER):[^\]]*\]|^@INJECT\s|^\[InitialVariables\]/m;

  for (const { text, source } of allTexts) {
    // Count EJS blocks
    const ejsMatches = text.match(ejsTagRegex);
    if (ejsMatches) {
      result.ejsBlockCount += ejsMatches.length;
      if (source.startsWith('lorebook[')) {
        result.entryWithEjsCount++;
      }
    }

    // Detect API usage
    if (getwiRegex.test(text)) { result.hasGetwi = true; getwiRegex.lastIndex = 0; }
    if (activewiRegex.test(text)) { result.hasActivewi = true; activewiRegex.lastIndex = 0; }
    if (getWorldInfoDataRegex.test(text)) { result.hasGetwi = true; getWorldInfoDataRegex.lastIndex = 0; }
    if (defineRegex.test(text)) { result.hasDefine = true; defineRegex.lastIndex = 0; }
    if (getChatMessagesRegex.test(text)) { result.hasGetChatMessages = true; getChatMessagesRegex.lastIndex = 0; }
    if (executeRegex.test(text)) { result.hasExecute = true; executeRegex.lastIndex = 0; }
    if (decoratorRegex.test(text)) { result.hasDecorators = true; }
  }

  // Calculate confidence
  let score = 0;
  if (result.ejsBlockCount > 0) { score += 30; result.reasons.push(`${result.ejsBlockCount} EJS blocks`); }
  if (result.ejsBlockCount > 10) { score += 15; }
  if (result.ejsBlockCount > 50) { score += 10; }
  if (result.entryWithEjsCount > 0) { score += 10; result.reasons.push(`${result.entryWithEjsCount} entries with EJS`); }
  if (result.hasGetwi) { score += 15; result.reasons.push('getwi() calls'); }
  if (result.hasActivewi) { score += 15; result.reasons.push('activewi() dynamic entry control'); }
  if (result.hasDefine) { score += 10; result.reasons.push('define() shared helpers'); }
  if (result.hasGetChatMessages) { score += 10; result.reasons.push('getChatMessages() context scan'); }
  if (result.hasExecute) { score += 5; result.reasons.push('execute() slash commands'); }
  if (result.hasDecorators) { score += 5; result.reasons.push('Decorators detected'); }

  result.confidence = Math.min(score / 100, 1);
  result.isEjs = result.ejsBlockCount > 0;

  return result;
}

/* ═══════════════════════════════════════════════════════════════════
   EXTRACTION — Deep scan EJS constructs
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Extract all entry names referenced by getwi() / getWorldInfo() calls.
 * Deep scans all EJS blocks across all card fields.
 */
export function extractEjsEntryNames(card: CharacterCard): EjsEntryRef[] {
  const data = (card.data || card) as any;
  const entries = data.character_book?.entries || [];

  // Build entry name → index map (by comment, name, or both)
  const entryNameMap = new Map<string, number>();
  entries.forEach((entry: any, i: number) => {
    const comment = (entry.comment || '').trim();
    const name = (entry.name || '').trim();
    if (comment) entryNameMap.set(comment, i);
    if (name && name !== comment) entryNameMap.set(name, i);
  });

  // Collect all text with field path info
  const allTexts = collectAllTexts(card);

  // Pattern: getwi(null, 'Entry Name') / getwi('', "Entry Name") / getwi(null, `Entry Name`)
  // Also: getWorldInfo(null, 'Entry Name')
  // Also: getwi(null, variable) — we skip variable references
  const getwiPatterns = [
    // getwi(null, 'name') or getwi('', 'name') or getwi(bookName, 'name')
    /(?:getwi|getWorldInfo)\s*\(\s*(?:null|''|""|\w+)\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g,
    // await getwi(null, 'name')
    /await\s+(?:getwi|getWorldInfo)\s*\(\s*(?:null|''|""|\w+)\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];

  const refMap = new Map<string, EjsEntryRef>();

  for (const { text, source } of allTexts) {
    for (const pattern of getwiPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const entryName = match[1].trim();
        if (!entryName) continue;

        const existing = refMap.get(entryName);
        if (existing) {
          if (!existing.referencedIn.includes(source)) {
            existing.referencedIn.push(source);
          }
        } else {
          refMap.set(entryName, {
            name: entryName,
            referencedIn: [source],
            entryIndex: entryNameMap.get(entryName) ?? -1,
            sourceType: match[0].includes('getWorldInfo') ? 'getWorldInfo' : 'getwi',
          });
        }
      }
    }

    // Also scan getWorldInfoData / getWorldInfoActivatedData for entry-level access
    const worldInfoDataPattern = /(?:getWorldInfoData|getWorldInfoActivatedData)\s*\(\s*(?:null|''|""|\w+)\s*(?:,\s*['"`]([^'"`]+)['"`])?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = worldInfoDataPattern.exec(text)) !== null) {
      if (m[1]) {
        const entryName = m[1].trim();
        const existing = refMap.get(entryName);
        if (existing) {
          if (!existing.referencedIn.includes(source)) existing.referencedIn.push(source);
        } else {
          refMap.set(entryName, {
            name: entryName,
            referencedIn: [source],
            entryIndex: entryNameMap.get(entryName) ?? -1,
            sourceType: 'getWorldInfoData',
          });
        }
      }
    }

    // Scan activewi() / activateWorldInfo() — dynamic entry enable/disable
    // Pattern: activewi(null, 'Entry Name', true/false) or activateWorldInfo(null, 'Entry Name', true)
    const activewiPattern1 = /(?:activewi|activateWorldInfo)\s*\(\s*(?:null|''|""|[\w.]+)\s*,\s*['"`]([^'"`]+)['"`]/g;
    const activewiPattern2 = /await\s+(?:activewi|activateWorldInfo)\s*\(\s*(?:null|''|""|[\w.]+)\s*,\s*['"`]([^'"`]+)['"`]/g;
    for (const awPattern of [activewiPattern1, activewiPattern2]) {
      awPattern.lastIndex = 0;
      let aw: RegExpExecArray | null;
      while ((aw = awPattern.exec(text)) !== null) {
        const entryName = aw[1].trim();
        if (!entryName) continue;
        const existing = refMap.get(entryName);
        if (existing) {
          if (!existing.referencedIn.includes(source)) existing.referencedIn.push(source);
        } else {
          refMap.set(entryName, {
            name: entryName,
            referencedIn: [source],
            entryIndex: entryNameMap.get(entryName) ?? -1,
            sourceType: aw[0].includes('activateWorldInfo') ? 'activateWorldInfo' : 'activewi',
          });
        }
      }
    }
  }

  return Array.from(refMap.values());
}

/**
 * Deep extract keywords from EJS blocks: string comparisons, alias arrays,
 * decorator triggers, and define() names.
 */
/**
 * (User 2026 \u2014 "qu\u00e9t keywords kh\u00f4ng theo quy lu\u1eadt g\u00ec") QUY LU\u1eacT keyword h\u1ee3p l\u1ec7 \u2014 1 ngu\u1ed3n duy nh\u1ea5t,
 * d\u00f9ng cho C\u1ea2 scan (addKeyword) l\u1eabn \u0110\u1ed3ng nh\u1ea5t t\u1eeb \u0111i\u1ec3n (prune entry r\u00e1c \u0111\u00e3 l\u1ee1 v\u00e0o dict).
 * Keyword = chu\u1ed7i NG\u1eaeN ki\u1ec3u \u0111\u1ecbnh danh d\u00f9ng trong LOGIC game (t\u00ean tr\u1ea1ng th\u00e1i/phe/quan h\u1ec7/t\u1eeb kho\u00e1 so s\u00e1nh).
 * KH\u00d4NG ph\u1ea3i keyword:
 *  - V\u0102N XU\u00d4I: d\u00e0i >32 k\u00fd t\u1ef1, ho\u1eb7c ch\u1ee9a d\u1ea5u c\u00e2u c\u00e2u-v\u0103n (\u3002\uff01\uff1f\uff1b\uff0c, xu\u1ed1ng d\u00f2ng) \u2014 \u0111\u00e2y l\u00e0 VALUE m\u00f4 t\u1ea3,
 *    \u0111\u01b0\u1ee3c d\u1ecbch theo ng\u1eef c\u1ea3nh b\u00ecnh th\u01b0\u1eddng, nh\u00e9t v\u00e0o dict ch\u1ec9 ph\u00e1 (bug 78/309 entry l\u00e0 nguy\u00ean \u0111o\u1ea1n v\u0103n).
 *  - M\u1ea2NH CODE: ch\u1ee9a ${ <% %> => == && || </ <tag>, ngo\u1eb7c {}(), d\u1ea5u ; = ` \u2014 thay c\u00e1c m\u1ea3nh n\u00e0y qua
 *    covariance l\u00e0 V\u1ee0 code (bug `'${item.id === profile.id ? '`, `,\n    `).
 *  - Token CSS/k\u1ef9 thu\u1eadt: m\u00e0u #hex, var(--x), s\u1ed1 thu\u1ea7n.
 *  - IDENTIFIER ASCII thu\u1ea7n (stat_data, sfw_keywords, east_asia_1629): l\u00e0 T\u00caN BI\u1ebeN code \u2014 kh\u00f4ng \u0111\u01b0\u1ee3c
 *    d\u1ecbch (bug AI d\u1ecbch `sfw_keywords` \u2192 `t\u1eeb_kh\u00f3a_sfw` r\u1ed3i dict \u00e9p v\u00e0o code). Kh\u00f4ng v\u00e0o dict = gi\u1eef nguy\u00ean.
 */
export function isValidEjsKeywordKey(keyword: string): boolean {
  if (!keyword || typeof keyword !== 'string') return false;
  const k = keyword.trim();
  if (k.length < 2 || k.length > 32) return false;
  if (/[\n\r]/.test(k)) return false;
  if (/[\u3002\uff01\uff1f\uff1b\uff0c\u3001,;]/.test(k)) return false;                       // d\u1ea5u c\u00e2u v\u0103n xu\u00f4i (CN + ASCII)
  if (/\$\{|<%|%>|=>|==|&&|\|\||<\/|[{}()<>=`]/.test(k)) return false; // m\u1ea3nh code
  if (/^#[0-9a-fA-F]{3,8}$/.test(k)) return false;                    // m\u00e0u CSS
  if (/^\d+(?:\.\d+)?$/.test(k)) return false;                        // s\u1ed1 thu\u1ea7n
  if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(k)) return false;            // identifier ASCII thu\u1ea7n
  if (!/[\p{L}\p{N}]/u.test(k)) return false;                         // to\u00e0n k\u00fd hi\u1ec7u
  return true;
}

export function extractEjsKeywords(card: CharacterCard): EjsKeyword[] {
  const allTexts = collectAllTexts(card);
  const keywords: EjsKeyword[] = [];
  const seen = new Set<string>();

  const addKeyword = (keyword: string, type: EjsKeyword['type'], foundIn: string, context?: string) => {
    const key = `${keyword}::${type}`;
    if (seen.has(key)) return;
    // (User 2026) 1 c\u1ed5ng QUY LU\u1eacT duy nh\u1ea5t \u2014 l\u1ecdc v\u0103n xu\u00f4i/m\u1ea3nh code/CSS/identifier ASCII (xem isValidEjsKeywordKey)
    if (!isValidEjsKeywordKey(keyword)) return;

    seen.add(key);
    keywords.push({ keyword, type, foundIn, context });
  };

  for (const { text, source } of allTexts) {
    // ═══ 1. String comparisons inside EJS blocks ═══
    // Extract EJS blocks first
    const ejsBlocks = text.match(/<%[\s\S]*?%>/g) || [];
    for (const block of ejsBlocks) {
      // if (xxx === 'keyword') or if (xxx == 'keyword')
      // (User 2026) Nháy mở/đóng phải CÙNG LOẠI (backreference \1) — trước đây `['"\`]…['"\`]` cho phép
      // mở ` đóng ' → nuốt nguyên mảnh template literal (`'${item.id === profile.id ? '`) làm keyword rác.
      const comparisonPatterns = [
        /[=!]==?\s*(['"`])([^'"`]{2,})\1/g,
        /(['"`])([^'"`]{2,})\1\s*[=!]==?/g,
        // .includes('keyword')
        /\.includes\s*\(\s*(['"`])([^'"`]{2,})\1\s*\)/g,
        // .indexOf('keyword')
        /\.indexOf\s*\(\s*(['"`])([^'"`]{2,})\1\s*\)/g,
        // .match('pattern') or .match(/pattern/)
        /\.match\s*\(\s*(['"`])([^'"`]{2,})\1\s*\)/g,
        // .startsWith('keyword') / .endsWith('keyword')
        /\.(?:startsWith|endsWith)\s*\(\s*(['"`])([^'"`]{2,})\1\s*\)/g,
        // switch case: case 'value':
        /case\s+(['"`])([^'"`]{2,})\1\s*:/g,
      ];

      for (const pattern of comparisonPatterns) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(block)) !== null) {
          addKeyword(m[2], 'comparison', source, block.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
        }
      }
    }

    // ═══ 2. Alias arrays — deep scan for arrays of CJK strings ═══
    // var aliases = ['唐三', '小舞', ...]  or  const npcs = ["唐三", "小舞"]
    const arrayPatterns = [
      // var/let/const name = ['...', '...']
      /(?:var|let|const)\s+\w+\s*=\s*\[([^\]]{10,})\]/g,
      // name: ['...', '...'] (in object literal)
      /\w+\s*:\s*\[([^\]]{10,})\]/g,
    ];

    for (const pattern of arrayPatterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m[1]) {
          // Extract individual strings from the array — nháy đóng phải CÙNG LOẠI nháy mở (backreference),
          // nếu không chuỗi 1 ký tự bị bỏ qua rồi match "lệch pha" nuốt cả dấu phẩy giữa 2 phần tử (`,\n    `).
          const stringPattern = /(['"`])([^'"`]+)\1/g;
          let s: RegExpExecArray | null;
          while ((s = stringPattern.exec(m[1])) !== null) {
            addKeyword(s[2], 'alias', source, m[0].slice(0, 100));
          }
        }
      }
    }

    // push('...') — tách riêng vì capture group khác các pattern mảng ở trên
    const pushPattern = /\.push\s*\(\s*(['"`])([^'"`]{2,})\1\s*\)/g;
    pushPattern.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = pushPattern.exec(text)) !== null) {
      addKeyword(pm[2], 'alias', source, pm[0].slice(0, 100));
    }

    // ═══ 3. Decorator regex triggers ═══
    // [GENERATE:REGEX:pattern]
    const decoratorRegexPattern = /\[GENERATE:REGEX:([^\]]+)\]/g;
    let dr: RegExpExecArray | null;
    while ((dr = decoratorRegexPattern.exec(text)) !== null) {
      // Split by | for alternation
      const parts = dr[1].split('|');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) addKeyword(trimmed, 'decorator_regex', source);
      }
    }

    // ═══ 4. define() names with CJK ═══
    const definePattern = /define\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let d: RegExpExecArray | null;
    while ((d = definePattern.exec(text)) !== null) {
      addKeyword(d[1], 'define_name', source);
    }

    // ═══ 5. Deep scan: object key-value pairs with CJK values (alias dictionaries) ═══
    // Pattern: 'key': 'CJK value' or "key": "CJK value" inside objects
    // (User 2026) Nh\u00e1y b\u1eaft c\u1eb7p C\u00d9NG LO\u1ea0I (backreference). VALUE v\u1eabn \u0111\u01b0a qua addKeyword nh\u01b0ng quy lu\u1eadt
    // s\u1ebd l\u1ecdc: value m\u00f4 t\u1ea3 d\u00e0i = V\u0102N XU\u00d4I (d\u1ecbch theo ng\u1eef c\u1ea3nh) \u2014 g\u1ed1c bug 78/309 entry dict l\u00e0 nguy\u00ean
    // \u0111o\u1ea1n v\u0103n 90+ k\u00fd t\u1ef1 l\u1ea5y t\u1eeb value c\u1ee7a object c\u1eeda h\u00e0ng/nh\u00e2n v\u1eadt.
    const objKvPattern = /(['"`])([^'"`]{2,})\1\s*:\s*(['"`])([^'"`]{2,})\3/g;
    for (const block of ejsBlocks) {
      objKvPattern.lastIndex = 0;
      let kv: RegExpExecArray | null;
      while ((kv = objKvPattern.exec(block)) !== null) {
        const hasCJKKey = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(kv[2]);
        const hasCJKVal = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(kv[4]);
        if (hasCJKKey) addKeyword(kv[2], 'alias', source, kv[0].slice(0, 80));
        if (hasCJKVal) addKeyword(kv[4], 'alias', source, kv[0].slice(0, 80));
      }
    }

    // ═══ 6. Deep scan: template literal CJK strings ═══
    // `some ${var} 中文 text`
    const templatePattern = /`([^`]*[\u4e00-\u9fff\u3400-\u4dbf][^`]*)`/g;
    for (const block of ejsBlocks) {
      templatePattern.lastIndex = 0;
      let tl: RegExpExecArray | null;
      while ((tl = templatePattern.exec(block)) !== null) {
        // Ch\u1ec9 l\u1ea5y C\u1ee4M CH\u1eee CJK (kh\u00f4ng l\u1ea5y c\u1ea3 template literal). KH\u00d4NG g\u1ed9p d\u1ea3i \uff00-\uffef n\u1eefa \u2014 d\u1ea5u c\u00e2u
        // \uff0c\u3002\uff01\uff1f n\u1eb1m trong d\u1ea3i \u0111\u00f3 n\u00ean "c\u1ee5m" nu\u1ed1t nguy\u00ean c\u00e2u v\u0103n d\u00e0i th\u00e0nh keyword r\u00e1c. + tr\u1ea7n 32.
        const cjkSegments = tl[1].match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,32}/g);
        if (cjkSegments) {
          for (const seg of cjkSegments) {
            addKeyword(seg, 'comparison', source, tl[0].slice(0, 80));
          }
        }
      }
    }

    // ═══ 7. Deep scan: condition/value strings in getvar comparisons ═══
    // getvar('var_name') === 'CJK value'
    const getvarCompPattern = /getvar\s*\(\s*['"`][^'"`]*['"`](?:\s*,\s*\{[^}]*\})?\s*\)\s*[=!]==?\s*(['"`])([^'"`]{2,})\1/g;
    getvarCompPattern.lastIndex = 0;
    let gvc: RegExpExecArray | null;
    while ((gvc = getvarCompPattern.exec(text)) !== null) {
      addKeyword(gvc[2], 'comparison', source, gvc[0]);
    }

    // ═══ 8. getvar() dotted path CJK segments ═══
    // 'stat_data.Giai đoạn thế giới' → extract 'Giai đoạn thế giới'
    // 'stat_data.Trạng thái phái sinh.nationality' → extract 'Trạng thái phái sinh'
    const getvarPathPattern = /getvar\s*\(\s*['"`]([^'"`]+)['"`]/g;
    getvarPathPattern.lastIndex = 0;
    let gvp: RegExpExecArray | null;
    while ((gvp = getvarPathPattern.exec(text)) !== null) {
      const fullPath = gvp[1];
      const segments = fullPath.split('.');
      for (const seg of segments) {
        const trimmed = seg.trim();
        if (trimmed.length >= 2) {
          addKeyword(trimmed, 'comparison', source, `getvar path: ${fullPath}`);
        }
      }
    }

    // ═══ 9. .includes() keywords in full text (not just EJS blocks) ═══
    // Catches patterns like: _p.includes('kinh nguyệt'), _p.includes('mang thai')
    // These appear in EJS blocks but the full-text scan ensures nothing is missed
    const includesFullTextPattern = /\.includes\s*\(\s*(['"`])([^'"`]{2,})\1\s*\)/g;
    includesFullTextPattern.lastIndex = 0;
    let incl: RegExpExecArray | null;
    while ((incl = includesFullTextPattern.exec(text)) !== null) {
      addKeyword(incl[2], 'comparison', source, incl[0]);
    }
  }

  return keywords;
}

/**
 * Extract all decorator lines from a text field.
 * Decorators MUST be preserved exactly as-is during translation.
 */
export function extractEjsDecorators(text: string, fieldPath: string): EjsDecorator[] {
  const decorators: EjsDecorator[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // @@render_after, @@render_before, @@iframe, @@if, @@else, @@end, @@private
    if (/^@@\w+/.test(trimmed)) {
      let type: EjsDecorator['type'] = 'other';
      if (trimmed.startsWith('@@render_after') || trimmed.startsWith('@@render_before')) type = 'render';
      else if (trimmed.startsWith('@@iframe')) type = 'iframe';
      else if (trimmed.startsWith('@@if') || trimmed.startsWith('@@else') || trimmed.startsWith('@@end')) type = 'if';
      else if (trimmed.startsWith('@@private')) type = 'private';
      decorators.push({ line: trimmed, type, foundIn: fieldPath });
    }

    // [GENERATE:BEFORE], [GENERATE:AFTER], [RENDER:BEFORE], etc.
    if (/^\[(?:GENERATE|RENDER):[^\]]*\]/.test(trimmed)) {
      decorators.push({ line: trimmed, type: 'generate', foundIn: fieldPath });
    }

    // @INJECT pos=..., role=...
    if (/^@INJECT\s/.test(trimmed)) {
      decorators.push({ line: trimmed, type: 'inject', foundIn: fieldPath });
    }

    // [InitialVariables]
    if (/^\[InitialVariables\]/i.test(trimmed)) {
      decorators.push({ line: trimmed, type: 'initvar', foundIn: fieldPath });
    }
  }

  return decorators;
}

/**
 * Extract all decorators from the entire card.
 */
export function extractAllDecorators(card: CharacterCard): EjsDecorator[] {
  const allTexts = collectAllTexts(card);
  const decorators: EjsDecorator[] = [];
  for (const { text, source } of allTexts) {
    decorators.push(...extractEjsDecorators(text, source));
  }
  return decorators;
}

/* ═══════════════════════════════════════════════════════════════════
   AI TRANSLATION — Translate entry names + keywords via AI
   ═══════════════════════════════════════════════════════════════════ */

type EjsItem = { text: string; type: 'entry_name' | 'keyword' };

/** Build the system prompt for ONE batch of items. */
function buildEjsBatchSystemPrompt(items: EjsItem[], targetLang: string, cardContext?: string, customPrompt?: string): string {
  const entryList = items.map((item, i) => `${i + 1}. [${item.type}] "${item.text}"`).join('\n');
  const contextBlock = cardContext ? `\n\nCONTEXT (EJS code from the card for reference):\n${cardContext.slice(0, 3000)}` : '';
  const customPromptBlock = customPrompt?.trim()
    ? `\n\n═══ USER CUSTOM TRANSLATION RULES (HIGHEST PRIORITY) ═══\n${customPrompt.trim()}\n═══ END CUSTOM RULES ═══`
    : '';
  return `You are a specialized translator for SillyTavern EJS character cards.
You must translate the following items from their original language into ${targetLang}.

ITEMS TO TRANSLATE:
${entryList}
${contextBlock}

RULES:
1. [entry_name] items are lorebook entry titles used in getwi() calls. The translated name MUST be used consistently wherever this entry is referenced.
2. [keyword] items are EJS trigger keywords, NPC/location aliases, or comparison strings. Translate naturally but consistently.
3. Chinese proper nouns (character names, places) → Sino-Vietnamese (Hán Việt) reading. Japanese proper nouns → Romaji. Korean proper nouns → Standard Revised Romanization (e.g. 金泰亨 → Kim Tae-hyung, 仁川 → Incheon), NOT Sino-Vietnamese. Do NOT translate English. Follow user custom rules if provided.${fandomNameOverride()}
4. Western/Fantasy names transcribed into CJK → restore to original Latin spelling.
5. Short system/technical terms should remain concise after translation.
6. NEVER translate technical tokens (variable names, function names, CSS selectors).${customPromptBlock}

OUTPUT FORMAT — STRICT JSON object mapping original → translated. You MUST include EVERY item above:
{
  "original text 1": "translated text 1",
  "original text 2": "translated text 2"
}

Output ONLY the JSON object. No markdown, no explanation.`;
}

export interface EjsTranslateOptions {
  /** Số item mỗi call. Nhỏ = an toàn (không tràn output token). Mặc định 50. */
  batchSize?: number;
  /** Số lô chạy song song. callProvider tự gate RPM + xoay key nên cứ bắn nhiều lane. Mặc định 6. */
  concurrency?: number;
  /** Số vòng retry cho item còn sót. Mặc định 2. */
  maxRetryRounds?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Dịch entry names + keywords của EJS bằng AI.
 *
 * KHÁC bản cũ (nhồi TẤT CẢ vào 1 call → card bự tràn output token → sót hàng loạt, phải chạy
 * 2-3 lần): nay CHIA LÔ nhỏ + chạy SONG SONG nhiều lane (callProvider tự gate RPM & xoay key,
 * y như Chiến Lược MVU) + TỰ RETRY riêng những item chưa có bản dịch → nhanh và không bỏ sót.
 */
export async function aiTranslateEjsEntries(
  entryNames: string[],
  keywords: string[],
  targetLang: string,
  proxy: ProxySettings,
  signal?: AbortSignal,
  cardContext?: string,
  customPrompt?: string,
  opts?: EjsTranslateOptions,
): Promise<{ entryTranslations: Record<string, string>; keywordTranslations: Record<string, string> }> {
  const allItems: EjsItem[] = [
    ...entryNames.map(n => ({ text: n, type: 'entry_name' as const })),
    ...keywords.map(k => ({ text: k, type: 'keyword' as const })),
  ];
  if (allItems.length === 0) return { entryTranslations: {}, keywordTranslations: {} };

  const batchSize = Math.max(1, opts?.batchSize ?? 50);
  const concurrency = Math.max(1, opts?.concurrency ?? 6);
  const maxRetryRounds = opts?.maxRetryRounds ?? 2;
  const total = allItems.length;

  const entryTranslations: Record<string, string> = {};
  const keywordTranslations: Record<string, string> = {};
  const has = (it: EjsItem) => !!(it.type === 'entry_name' ? entryTranslations : keywordTranslations)[it.text];
  const apply = (items: EjsItem[], map: Record<string, any>) => {
    for (const it of items) {
      const t = map?.[it.text];
      if (t && typeof t === 'string' && t.trim()) {
        (it.type === 'entry_name' ? entryTranslations : keywordTranslations)[it.text] = t.trim();
      }
    }
  };

  // Dịch 1 lô qua callProvider (đã tự gate RPM + xoay key + hiện ở monitor như 1 lane).
  const translateBatch = async (items: EjsItem[], label: string): Promise<void> => {
    if (signal?.aborted) throw new Error('Cancelled');
    const system = buildEjsBatchSystemPrompt(items, targetLang, cardContext, customPrompt);
    const user = `Translate these items to ${targetLang}:\n${items.map((it, i) => `${i + 1}. [${it.type}] "${it.text}"`).join('\n')}`;
    const responseText = await callProvider(proxy, system, user, signal, undefined, { label });
    const parsed = parseJsonFromAi(responseText);
    apply(items, parsed.translations || parsed);
  };

  // Chạy 1 danh sách lô với concurrency window (pool). Lỗi 1 lô không giết cả mẻ — để retry lo.
  const runBatches = async (batches: EjsItem[][], phase: string): Promise<void> => {
    let next = 0;
    let done = 0;
    const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      for (;;) {
        if (signal?.aborted) throw new Error('Cancelled');
        const idx = next++;
        if (idx >= batches.length) return;
        const items = batches[idx];
        try {
          await translateBatch(items, `EJS ${phase} · lô ${idx + 1}/${batches.length} (${items.length} mục)`);
        } catch (err) {
          if (err instanceof Error && (err.message === 'Cancelled' || signal?.aborted)) throw err;
          // để item sót cho vòng retry
        }
        done += items.length;
        opts?.onProgress?.(Math.min(done, total), total);
      }
    });
    await Promise.all(workers);
  };

  const makeBatches = (items: EjsItem[], size: number): EjsItem[][] => {
    const out: EjsItem[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  };

  // Vòng chính.
  await runBatches(makeBatches(allItems, batchSize), 'chính');

  // Retry riêng những item chưa có bản dịch (lô nhỏ hơn cho chắc) — thay cho việc phải chạy tay 2-3 lần.
  for (let round = 1; round <= maxRetryRounds; round++) {
    if (signal?.aborted) throw new Error('Cancelled');
    const missing = allItems.filter(it => !has(it));
    if (missing.length === 0) break;
    await runBatches(makeBatches(missing, Math.max(15, Math.floor(batchSize / 2))), `retry ${round}`);
  }

  return { entryTranslations, keywordTranslations };
}

/* ═══════════════════════════════════════════════════════════════════
   VALIDATION — Post-translation sync verification
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Verify that EJS entry names and keywords were correctly synced in translated text.
 */
export function validateEjsSync(
  fields: { path: string; group: string; original: string; translated: string; status: string }[],
  ejsEntryNameDict: Record<string, string>,
  ejsKeywordDict: Record<string, string>,
): EjsSyncReport {
  const report: EjsSyncReport = {
    totalEntryNames: 0,
    matchedEntryNames: 0,
    missingEntryNames: [],
    totalKeywords: 0,
    matchedKeywords: 0,
    missingKeywords: [],
    brokenDecorators: [],
    warnings: [],
  };

  const doneFields = fields.filter(f => f.status === 'done' && f.translated);
  const allTranslatedText = doneFields.map(f => f.translated).join('\n');

  // ─── Verify entry name sync ───
  const entryEntries = Object.entries(ejsEntryNameDict).filter(([k, v]) => k && v && k !== v);
  report.totalEntryNames = entryEntries.length;

  for (const [original, translated] of entryEntries) {
    // Check if translated name appears in any getwi()/activewi() call in translated fields
    const quoteClass = "['\"\x60]";
    const getwiPattern = new RegExp(
      '(?:getwi|getWorldInfo|activewi|activateWorldInfo)\\s*\\(\\s*(?:null|\'\'|""|[\\w.]+)\\s*,\\s*' + quoteClass + escapeRegex(translated) + quoteClass,
    );

    const originalGetwiPattern = new RegExp(
      '(?:getwi|getWorldInfo|activewi|activateWorldInfo)\\s*\\(\\s*(?:null|\'\'|""|[\\w.]+)\\s*,\\s*' + quoteClass + escapeRegex(original) + quoteClass,
    );

    const translatedHasCorrect = getwiPattern.test(allTranslatedText);
    const translatedHasOriginal = originalGetwiPattern.test(allTranslatedText);

    if (translatedHasCorrect) {
      report.matchedEntryNames++;
    } else if (translatedHasOriginal) {
      // Original name still present — not synced
      const referencedIn = doneFields
        .filter(f => originalGetwiPattern.test(f.translated))
        .map(f => f.path);
      report.missingEntryNames.push({ name: original, translatedName: translated, referencedIn });
    } else {
      // Neither found — might have been removed or is in an untranslated field
      report.matchedEntryNames++; // Don't count as missing if neither version exists
    }
  }

  // ─── Verify keyword sync ───
  const kwEntries = Object.entries(ejsKeywordDict).filter(([k, v]) => k && v && k !== v);
  report.totalKeywords = kwEntries.length;

  for (const [original, translated] of kwEntries) {
    // Check EJS blocks in translated text for old keyword
    const ejsBlocks = allTranslatedText.match(/<%[\s\S]*?%>/g) || [];
    const ejsText = ejsBlocks.join('\n');

    const hasOriginal = ejsText.includes(original);
    const hasTranslated = ejsText.includes(translated);

    if (hasTranslated && !hasOriginal) {
      report.matchedKeywords++;
    } else if (hasOriginal) {
      const foundIn = doneFields.find(f => {
        const fEjs = (f.translated.match(/<%[\s\S]*?%>/g) || []).join('');
        return fEjs.includes(original);
      });
      report.missingKeywords.push({
        keyword: original,
        translatedKeyword: translated,
        foundIn: foundIn?.path || 'unknown',
      });
    } else {
      report.matchedKeywords++; // Neither found
    }
  }

  // ─── Verify decorator preservation ───
  for (const f of doneFields) {
    const originalDecorators = extractEjsDecorators(f.original, f.path);
    if (originalDecorators.length === 0) continue;

    const translatedLines = new Set(f.translated.split('\n').map(l => l.trim()));

    for (const dec of originalDecorators) {
      if (!translatedLines.has(dec.line)) {
        // Check if a similar but broken version exists
        const partialMatch = f.translated.includes(dec.line.slice(0, 10));
        if (partialMatch) {
          report.brokenDecorators.push({
            original: dec.line,
            translated: '(modified)',
            fieldPath: f.path,
          });
        } else {
          report.brokenDecorators.push({
            original: dec.line,
            translated: '(missing)',
            fieldPath: f.path,
          });
        }
      }
    }
  }

  if (report.brokenDecorators.length > 0) {
    report.warnings.push(`${report.brokenDecorators.length} decorator(s) were modified or missing in translated output.`);
  }

  return report;
}

/* ═══════════════════════════════════════════════════════════════════
   PROMPT BUILDING — EJS-specific prompt blocks
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Build the EJS sync prompt injection block.
 * This gets appended to the translation prompt when Strategy C is enabled.
 */
export function buildEjsPromptBlock(
  ejsEntryNameDict: Record<string, string>,
  ejsKeywordDict: Record<string, string>,
  ejsDecoratorPreserve: boolean,
): string {
  let block = '';

  // ─── Entry Name Dictionary ───
  const entryEntries = Object.entries(ejsEntryNameDict).filter(([k, v]) => k && v && k !== v);
  if (entryEntries.length > 0) {
    const entryList = entryEntries.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');
    block += `\n\nCRITICAL — EJS ENTRY NAME DICTIONARY (getwi() & activewi() SYNC):
This card uses EJS Entry Jumping — lorebook entries are loaded dynamically via getwi(null, 'Entry Name') and enabled/disabled via activewi(null, 'Entry Name', true/false).
You MUST replace ALL original entry names with their translated equivalents in these calls:
${entryList}
Rules:
- In getwi() / getWorldInfo() calls, the entry name argument MUST use the translated name
- In activewi() / activateWorldInfo() calls, the entry name argument MUST also use the translated name
- The actual lorebook entry comment/name field will also be translated — they MUST match exactly
- If you see a narrative text referencing an entry name (for auto-trigger), use the translated name
- NEVER leave the original CJK entry name in a getwi() or activewi() call if a translation is provided above`;
  }

  // ─── Keyword Dictionary ───
  const kwEntries = Object.entries(ejsKeywordDict).filter(([k, v]) => k && v && k !== v);
  if (kwEntries.length > 0) {
    const kwList = kwEntries.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');
    block += `\n\nEJS KEYWORD & ALIAS DICTIONARY (MANDATORY SYNC):
This card uses EJS to scan chat for keywords/aliases (NPC names, locations, triggers).
When translating EJS code blocks, you MUST replace these keywords with their translations:
${kwList}
Rules:
- String comparisons (===, includes(), indexOf(), match(), switch/case) MUST use translated keywords
- Alias arrays (var aliases = [...]) MUST use translated names
- getChatMessages() scan targets MUST use translated keywords
- Narrative text that triggers these keywords MUST also use the same translated versions`;
  }

  // ─── Decorator Preservation ───
  if (ejsDecoratorPreserve) {
    block += `\n\nEJS DECORATOR PRESERVATION (ABSOLUTE — NEVER TRANSLATE):
The following line prefixes are SillyTavern EJS system decorators. They MUST be preserved EXACTLY as-is:
- @@render_after, @@render_before, @@iframe, @@if, @@else, @@end, @@private
- [GENERATE:BEFORE], [GENERATE:AFTER], [RENDER:BEFORE], [RENDER:AFTER]
- [GENERATE:REGEX:...], [GENERATE:{idx}:BEFORE], [GENERATE:{idx}:AFTER]
- @INJECT pos=..., @INJECT target=..., @INJECT regex=...
- [InitialVariables]
These lines control EJS execution flow. Translating or modifying them will BREAK the card.
If a decorator contains CJK in its parameters (e.g., [GENERATE:REGEX:中文keyword]), translate ONLY the CJK parameter using the keyword dictionary above, NOT the decorator syntax itself.`;
  }

  block += `\n\nEJS OBJECT LITERAL KEY QUOTING (CRITICAL SAFETY FOR VIETNAMESE):
When translating EJS code blocks, templates, or narrative openers containing EJS, if there is an object literal being constructed or passed to functions (such as passing an object to setvar('key', { ... })), any key that contains spaces, special characters, or Vietnamese diacritics (e.g., 'Loại', 'Mô Tả') MUST be enclosed in single quotes '' (e.g., 'Loại': 'Võ công', 'Mô Tả': '...').
Without quotes, the EJS compiler will throw an immediate syntax error due to the special characters and spaces in the key names.

EXAMPLE (Before):
  setvar('skill_path', { Loại: 'Võ công', Mô Tả: '...' });
EXAMPLE (After - CORRECT):
  setvar('skill_path', { 'Loại': 'Võ công', 'Mô Tả': '...' });`;

  return block;
}

/* ═══════════════════════════════════════════════════════════════════
   POST-TRANSLATION AUTO-FIX — Enforce EJS dictionary in translated output
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Auto-fix EJS entry names in getwi() / activewi() calls.
 * Scans translated text for original (untranslated) entry names in API calls
 * and replaces them with the translated version from the dictionary.
 *
 * This is the EJS equivalent of MVU's autoFixMvuVariables().
 */
/**
 * (User 2026 — bugNeedFix/39) LỌC TỪ ĐIỂN THEO TEXT trước khi dựng RegExp.
 *
 * Bối cảnh: chuỗi auto-fix EJS (5 hàm dưới) chạy SAU KHI MỖI field dịch xong. Mỗi hàm duyệt TOÀN BỘ
 * từ điển và dựng vài RegExp cho TỪNG mục — chi phí theo SỐ MỤC chứ không theo độ dài text. Đo thật
 * trên card user (dict ~400 mục): field chỉ 1.117 ký tự vẫn tốn 145ms, field lớn tốn 1.250ms
 * ⇒ ~88 giây cộng dồn cho 187 field ⇒ main thread nghẽn ⇒ "Trang không phản hồi" (đúng bug 39).
 *
 * Nhận xét then chốt: MỌI pattern trong các hàm này đều nhúng `escapeRegex(original)` NGUYÊN VĂN.
 * Nếu `original` KHÔNG xuất hiện trong text thì KHÔNG pattern nào có thể khớp → loại mục đó ra là
 * BẢO TOÀN HÀNH VI 100%, chỉ bỏ công vô ích. `includes` là mã native rất nhanh (≈1 GB/s) nên 1 lượt
 * lọc rẻ hơn nhiều so với dựng hàng trăm RegExp.
 *
 * @param caseInsensitive true cho hàm sửa HOA/thường (khớp không phân biệt hoa thường).
 */
function filterDictByText(
  dict: Record<string, string>,
  text: string,
  caseInsensitive = false,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;
  const hay = caseInsensitive ? text.toLowerCase() : text;
  for (const [k, v] of Object.entries(dict)) {
    if (!k || !v || k === v) continue;
    if (hay.includes(caseInsensitive ? k.toLowerCase() : k)) out[k] = v;
  }
  return out;
}

export function autoFixEjsEntryNames(
  translated: string,
  ejsEntryNameDictRaw: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  // (bug 39) chỉ giữ mục THỰC SỰ có mặt trong text — xem filterDictByText.
  const ejsEntryNameDict = filterDictByText(ejsEntryNameDictRaw, translated);
  const fixes: { found: string; replaced: string }[] = [];
  let text = translated;

  const entries = Object.entries(ejsEntryNameDict).filter(([k, v]) => k && v && k !== v);
  if (entries.length === 0) return { text, fixes };

  for (const [original, translatedName] of entries) {
    // Pattern: getwi(null, 'Original Name') or getWorldInfo(null, "Original Name")
    // Also: activewi(null, 'Original Name', true/false) and activateWorldInfo(...)
    // Handles: null, '', "", variable as first arg
    const escapedOriginal = escapeRegex(original);

    const patterns = [
      // getwi / getWorldInfo
      new RegExp(
        `((?:getwi|getWorldInfo)\\s*\\(\\s*(?:null|''|""|[\\w.]+)\\s*,\\s*)(['"\`])${escapedOriginal}\\2`,
        'g',
      ),
      // activewi / activateWorldInfo
      new RegExp(
        `((?:activewi|activateWorldInfo)\\s*\\(\\s*(?:null|''|""|[\\w.]+)\\s*,\\s*)(['"\`])${escapedOriginal}\\2`,
        'g',
      ),
      // getWorldInfoData / getWorldInfoActivatedData
      new RegExp(
        `((?:getWorldInfoData|getWorldInfoActivatedData)\\s*\\(\\s*(?:null|''|""|[\\w.]+)\\s*,\\s*)(['"\`])${escapedOriginal}\\2`,
        'g',
      ),
    ];

    for (const pattern of patterns) {
      const before = text;
      text = text.replace(pattern, `$1$2${translatedName}$2`);
      if (text !== before) {
        fixes.push({ found: original, replaced: translatedName });
      }
    }
  }

  return { text, fixes };
}

/**
 * Auto-fix EJS keywords inside <% %> code blocks.
 * Only modifies content INSIDE EJS blocks to avoid breaking narrative text.
 * Replaces original CJK keywords with translated versions in:
 *   - String comparisons (===, ==, !==, !=)
 *   - .includes(), .indexOf(), .startsWith(), .endsWith()
 *   - switch/case values
 *   - String literals (single/double/backtick quoted)
 *
 * This is the EJS equivalent of MVU's enforceVariableCasing().
 */
export function autoFixEjsKeywords(
  translated: string,
  ejsKeywordDictRaw: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  // (bug 39) lọc từ điển theo text trước khi dựng RegExp — xem filterDictByText.
  const ejsKeywordDict = filterDictByText(ejsKeywordDictRaw, translated);
  const fixes: { found: string; replaced: string }[] = [];

  const entries = Object.entries(ejsKeywordDict).filter(([k, v]) => k && v && k !== v);
  if (entries.length === 0) return { text: translated, fixes };

  // Extract EJS blocks, fix keywords inside, reassemble
  const ejsBlockRegex = /<%[\s\S]*?%>/g;
  let text = translated;
  const ejsBlocks: { start: number; end: number; content: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = ejsBlockRegex.exec(translated)) !== null) {
    ejsBlocks.push({ start: m.index, end: m.index + m[0].length, content: m[0] });
  }

  // Process blocks in reverse order (to preserve indices)
  for (let i = ejsBlocks.length - 1; i >= 0; i--) {
    const block = ejsBlocks[i];
    let fixedBlock = block.content;

    for (const [original, translatedKw] of entries) {
      // Only replace inside string literals within the EJS block
      // Pattern: quoted strings containing the original keyword
      const escapedOriginal = escapeRegex(original);

      // Match the keyword inside any quoted string context
      const quotedPatterns = [
        // 'keyword' or "keyword" — exact or as substring
        new RegExp(`(['"\`])([^'"\`]*?)${escapedOriginal}([^'"\`]*?)\\1`, 'g'),
      ];

      for (const pattern of quotedPatterns) {
        const before = fixedBlock;
        fixedBlock = fixedBlock.replace(pattern, (match, q, pre, post) => {
          return `${q}${pre}${translatedKw}${post}${q}`;
        });
        if (fixedBlock !== before) {
          // Deduplicate: only add if not already recorded
          if (!fixes.some(f => f.found === original && f.replaced === translatedKw)) {
            fixes.push({ found: original, replaced: translatedKw });
          }
        }
      }
    }

    if (fixedBlock !== block.content) {
      text = text.slice(0, block.start) + fixedBlock + text.slice(block.end);
    }
  }

  return { text, fixes };
}

/**
 * Force lorebook entry name/comment to match the EJS entry name dictionary.
 * When a lorebook name or comment field is translated, ensure it matches
 * exactly what the EJS dictionary specifies — overriding any AI translation.
 */
export function enforceEjsEntryName(
  original: string,
  translated: string,
  ejsEntryNameDict: Record<string, string>,
): { text: string; forced: boolean } {
  const trimmedOriginal = original.trim();
  if (trimmedOriginal in ejsEntryNameDict) {
    const dictValue = ejsEntryNameDict[trimmedOriginal];
    if (dictValue && dictValue !== trimmedOriginal && dictValue.trim() !== translated.trim()) {
      return { text: dictValue, forced: true };
    }
  }
  return { text: translated, forced: false };
}

/* ═══════════════════════════════════════════════════════════════════
   COVARIANCE — Full-context enforcement (equivalent to Strategy B)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Enforce EJS covariance across ALL code contexts in translated text.
 * This is the Strategy C equivalent of MVU's `enforceInitvarCovariance()`.
 *
 * Strategy B enforces covariance for MVU variables across YAML keys, macros,
 * bracket access, EJS function calls, string comparisons, lodash paths.
 * Strategy C needs the same treatment for EJS entry names and keywords —
 * especially in regex `replaceString` fields which contain HTML/JS/CSS with
 * EJS keywords scattered across many code contexts (not just inside <% %> blocks).
 *
 * This function scans translated text and replaces original (untranslated)
 * EJS entry names and keywords with their translated counterparts in:
 *   Pass 1: getwi/activewi API calls (entry names)
 *   Pass 2: String comparisons (===, ==, !==, !=, includes, indexOf, match, startsWith, endsWith, case)
 *   Pass 3: Bracket access (obj['keyword'], data["keyword"])
 *   Pass 4: data-* HTML attributes (data-name="keyword", data-label="keyword")
 *   Pass 5: CSS content property (content: 'keyword')
 *   Pass 6: Generic quoted string replacements in inline <script> blocks
 *   Pass 7: .push() / array literal string replacements
 */
export function enforceEjsCovariance(
  translatedText: string,
  ejsEntryNameDictRaw: Record<string, string>,
  ejsKeywordDictRaw: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  if (!translatedText || typeof translatedText !== 'string') {
    return { text: translatedText, fixes: [] };
  }
  // (bug 39) lọc 2 từ điển theo text trước khi dựng RegExp — xem filterDictByText.
  const ejsEntryNameDict = filterDictByText(ejsEntryNameDictRaw, translatedText);
  const ejsKeywordDict = filterDictByText(ejsKeywordDictRaw, translatedText);

  const fixes: { found: string; replaced: string }[] = [];
  let result = translatedText;

  // Merge both dicts: entry names + keywords (entry names take priority)
  const allMappings = new Map<string, string>();
  for (const [k, v] of Object.entries(ejsKeywordDict)) {
    if (k && v && k !== v) allMappings.set(k, v);
  }
  for (const [k, v] of Object.entries(ejsEntryNameDict)) {
    if (k && v && k !== v) allMappings.set(k, v);
  }

  if (allMappings.size === 0) {
    return { text: result, fixes: [] };
  }

  // Sort by length descending (replace longer strings first to avoid partial matches)
  const sortedEntries = Array.from(allMappings.entries())
    .sort((a, b) => b[0].length - a[0].length);

  const addFix = (found: string, replaced: string) => {
    if (!fixes.some(f => f.found === found && f.replaced === replaced)) {
      fixes.push({ found, replaced });
    }
  };

  // Helper: safe replacement for regex $ characters
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');

  for (const [original, translated] of sortedEntries) {
    const escaped = escapeRegex(original);
    const safe = safeReplacement(translated);

    // ── Pass 1: getwi / activewi / getWorldInfo / activateWorldInfo calls ──
    const apiPatterns = [
      new RegExp(
        `((?:getwi|getWorldInfo)\\s*\\(\\s*(?:null|''|""|[\\w.]+)\\s*,\\s*)(['"\`])${escaped}\\2`,
        'g',
      ),
      new RegExp(
        `((?:activewi|activateWorldInfo)\\s*\\(\\s*(?:null|''|""|[\\w.]+)\\s*,\\s*)(['"\`])${escaped}\\2`,
        'g',
      ),
      new RegExp(
        `((?:getWorldInfoData|getWorldInfoActivatedData)\\s*\\(\\s*(?:null|''|""|[\\w.]+)\\s*,\\s*)(['"\`])${escaped}\\2`,
        'g',
      ),
    ];
    for (const pattern of apiPatterns) {
      const before = result;
      result = result.replace(pattern, `$1$2${safe}$2`);
      if (result !== before) addFix(original, translated);
    }

    // ── Pass 2: String comparisons ===, ==, !==, !=, case ──
    const compPattern = new RegExp(
      `((?:===|!==|==|!=|case)\\s*['"\`])${escaped}(['"\`])`,
      'g',
    );
    {
      const before = result;
      result = result.replace(compPattern, `$1${safe}$2`);
      if (result !== before) addFix(original, translated);
    }

    // .includes('original'), .indexOf('original'), .match('original'),
    // .startsWith('original'), .endsWith('original')
    const methodPatterns = [
      new RegExp(`(\\.(?:includes|indexOf|match|startsWith|endsWith)\\s*\\(\\s*['"\`])${escaped}(['"\`]\\s*\\))`, 'g'),
    ];
    for (const mp of methodPatterns) {
      const before = result;
      result = result.replace(mp, `$1${safe}$2`);
      if (result !== before) addFix(original, translated);
    }

    // ── Pass 3: Bracket access obj['keyword'] / data["keyword"] ──
    const bracketPattern = new RegExp(
      `(\\[\\s*['"\`])${escaped}(['"\`]\\s*\\])`,
      'g',
    );
    {
      const before = result;
      result = result.replace(bracketPattern, `$1${safe}$2`);
      if (result !== before) addFix(original, translated);
    }

    // ── Pass 4: data-* HTML attributes ──
    // data-name="keyword", data-label="keyword", data-entry="keyword"
    const dataAttrPattern = new RegExp(
      `(data-[a-z_-]+\\s*=\\s*['"\`])${escaped}(['"\`])`,
      'gi',
    );
    {
      const before = result;
      result = result.replace(dataAttrPattern, `$1${safe}$2`);
      if (result !== before) addFix(original, translated);
    }

    // ── Pass 5: CSS content property ──
    // content: 'keyword' or content: "keyword"
    const cssContentPattern = new RegExp(
      `(content\\s*:\\s*['"\`])${escaped}(['"\`])`,
      'g',
    );
    {
      const before = result;
      result = result.replace(cssContentPattern, `$1${safe}$2`);
      if (result !== before) addFix(original, translated);
    }

    // ── Pass 6: Inline <script> quoted strings ──
    // Replace original keywords in quoted strings within <script> blocks
    // We detect <script>...</script> and process quoted strings inside
    const scriptBlockRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch: RegExpExecArray | null;
    const scriptFixes: { start: number; end: number; content: string }[] = [];
    while ((scriptMatch = scriptBlockRegex.exec(result)) !== null) {
      const scriptContent = scriptMatch[1];
      const scriptStart = scriptMatch.index + scriptMatch[0].indexOf(scriptContent);
      const quotedPattern = new RegExp(
        `(['"\`])([^'"\`]*?)${escaped}([^'"\`]*?)\\1`,
        'g',
      );
      const fixedScript = scriptContent.replace(quotedPattern, (m, q, pre, post) => {
        return `${q}${pre}${translated}${post}${q}`;
      });
      if (fixedScript !== scriptContent) {
        scriptFixes.push({ start: scriptStart, end: scriptStart + scriptContent.length, content: fixedScript });
        addFix(original, translated);
      }
    }
    // Apply script fixes in reverse order
    for (let i = scriptFixes.length - 1; i >= 0; i--) {
      const sf = scriptFixes[i];
      result = result.slice(0, sf.start) + sf.content + result.slice(sf.end);
    }

    // ── Pass 7: .push('keyword') / array literals ['keyword1', 'keyword2'] ──
    const pushPattern = new RegExp(
      `(\\.push\\s*\\(\\s*['"\`])${escaped}(['"\`]\\s*\\))`,
      'g',
    );
    {
      const before = result;
      result = result.replace(pushPattern, `$1${safe}$2`);
      if (result !== before) addFix(original, translated);
    }
  }

  return { text: result, fixes };
}

/**
 * Enforce EJS keyword/entry name casing to match the dictionaries EXACTLY.
 * This is the Strategy C equivalent of MVU's `enforceVariableCasing()`.
 *
 * Problem: AI translates EJS keywords as one casing (e.g., "giai đoạn") but
 * the dictionary has a different casing (e.g., "Giai Đoạn"). This breaks
 * comparisons because JavaScript string matching is case-sensitive.
 *
 * Solution: After AI translation, scan for all EJS-related references and
 * replace any that match a dictionary value case-insensitively but differ
 * in exact casing with the canonical dictionary form.
 */
export function enforceEjsKeywordCasing(
  translatedText: string,
  ejsEntryNameDictRaw: Record<string, string>,
  ejsKeywordDictRaw: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  if (!translatedText || typeof translatedText !== 'string') {
    return { text: translatedText, fixes: [] };
  }
  // (bug 39) lọc theo text KHÔNG phân biệt hoa/thường (hàm này chuyên sửa casing) — xem filterDictByText.
  // Lọc theo GIÁ TRỊ dịch (canonical) vì hàm dò biến thể sai hoa/thường của chính giá trị đó.
  const keepByValue = (d: Record<string, string>) => {
    const low = translatedText.toLowerCase();
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) if (v && low.includes(v.toLowerCase())) o[k] = v;
    return o;
  };
  const ejsEntryNameDict = keepByValue(ejsEntryNameDictRaw);
  const ejsKeywordDict = keepByValue(ejsKeywordDictRaw);

  const fixes: { found: string; replaced: string }[] = [];

  // Build case-insensitive lookup: lowercased translated value → canonical form
  const canonicalMap = new Map<string, string>();
  for (const [, trans] of Object.entries(ejsEntryNameDict)) {
    if (trans && trans.trim()) {
      canonicalMap.set(trans.toLowerCase(), trans);
    }
  }
  for (const [, trans] of Object.entries(ejsKeywordDict)) {
    if (trans && trans.trim()) {
      // Don't overwrite entry name canonicals (they have priority)
      if (!canonicalMap.has(trans.toLowerCase())) {
        canonicalMap.set(trans.toLowerCase(), trans);
      }
    }
  }

  if (canonicalMap.size === 0) {
    return { text: translatedText, fixes: [] };
  }

  let result = translatedText;

  const addFix = (found: string, replaced: string) => {
    if (!fixes.some(f => f.found === found && f.replaced === replaced)) {
      fixes.push({ found, replaced });
    }
  };

  // Helper: check if a string needs casing fix
  const getCasingFix = (value: string): string | null => {
    if (!value || value.length < 2) return null;
    const lower = value.toLowerCase();
    const canonical = canonicalMap.get(lower);
    if (canonical && canonical !== value) {
      return canonical;
    }
    return null;
  };

  // ── Pass 1: getwi/activewi entry name arguments ──
  const apiRegex = /((?:getwi|getWorldInfo|activewi|activateWorldInfo|getWorldInfoData|getWorldInfoActivatedData)\s*\(\s*(?:null|''|""|[\w.]+)\s*,\s*)(['"`])([^'"`]+)\2/g;
  result = result.replace(apiRegex, (match, prefix, quote, inner) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      addFix(inner, canonical);
      return `${prefix}${quote}${canonical}${quote}`;
    }
    return match;
  });

  // ── Pass 2: String comparisons ===, ==, !==, !=, case ──
  const compRegex = /((?:===|!==|==|!=|case)\s*['"`])([^'"`]+)(['"`])/g;
  result = result.replace(compRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      addFix(inner, canonical);
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ── Pass 3: .includes(), .indexOf(), .match(), .startsWith(), .endsWith() ──
  const methodRegex = /(\.(?:includes|indexOf|match|startsWith|endsWith)\s*\(\s*['"`])([^'"`]+)(['"`]\s*\))/g;
  result = result.replace(methodRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      addFix(inner, canonical);
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ── Pass 4: Bracket access ──
  const bracketRegex = /(\[\s*['"`])([^'"`]+)(['"`]\s*\])/g;
  result = result.replace(bracketRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      addFix(inner, canonical);
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ── Pass 5: data-* attributes ──
  const dataAttrRegex = /(data-[a-z_-]+\s*=\s*['"`])([^'"`]+)(['"`])/gi;
  result = result.replace(dataAttrRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      addFix(inner, canonical);
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ── Pass 6: CSS content property ──
  const cssContentRegex = /(content\s*:\s*['"`])([^'"`]+)(['"`])/g;
  result = result.replace(cssContentRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      addFix(inner, canonical);
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  return { text: result, fixes };
}

/**
 * Extended EJS keyword auto-fix that works OUTSIDE of <% %> blocks as well.
 * The original autoFixEjsKeywords() only processes keywords inside EJS blocks.
 * This function additionally handles:
 *   - Keywords in inline <script> blocks (JS code outside EJS)
 *   - Keywords in data-* attributes
 *   - Keywords in string comparisons outside EJS blocks
 *
 * Use this AFTER autoFixEjsKeywords() for complete coverage.
 */

/**
 * (User 2026) Làm sạch 1 GIÁ TRỊ từ điển EJS: bỏ nháy/khoảng trắng bao ngoài + ký tự điều khiển/
 * zero-width + gộp khoảng trắng. GIỮ nội dung & hoa/thường có nghĩa (casing do enforceEjsKeywordCasing lo).
 */
export function canonicalizeEjsValue(value: string): string {
  if (!value || typeof value !== 'string') return value;
  let v = value.replace(/[\u0000-\u001F\u200B-\u200D\uFEFF]/g, ''); // control + zero-width
  v = v.replace(/^["'「『`\s]+|["'」』`\s]+$/g, '');
  v = v.replace(/\s+/g, ' ').trim();
  // (User 2026 — bug #8) ĐỒNG NHẤT SEPARATOR `_`/`-` dùng CHUNG quy tắc với MVU (unifyVarWordSeparators):
  // từ Việt-có-dấu nối `_` → space (kể cả khi có mảnh ASCII như "Tam"/"Bi"/"User" — quy tắc cũ đòi mọi
  // mảnh non-ASCII nên Lưu_Tam_Bảo lọt lưới); identifier thật (stat_data, [mvu_update], 场景_sfw,
  // evt_01) giữ nguyên.
  v = v.split(' ').map(unifyVarWordSeparators).join(' ');
  return v || value;
}

/**
 * (User 2026) ĐỒNG NHẤT từ điển EJS — mirror `enforceExactConsistency` (MVU). (1) làm sạch mọi value;
 * (2) gom cụm value gần-giống (chuẩn hoá: lower + bỏ khoảng trắng/gạch) → chọn 1 dạng canonical (phổ
 * biến nhất, hoà thì dài nhất); (3) gán canonical cho mọi key. Hết "thêm dấu / ký tự lạ / hoa-thường lệch".
 */
export function enforceEjsDictConsistency(
  dict: Record<string, string>,
  opts?: { pruneInvalidKeywords?: boolean },
): { fixedDict: Record<string, string>; fixes: string[] } {
  const fixes: string[] = [];
  const fixedDict: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict || {})) {
    // (User 2026 — "quét keywords không theo quy luật gì") PRUNE entry rác đã lỡ vào dict từ các bản
    // scan cũ: nguyên đoạn văn, mảnh code (${…?), identifier ASCII bị dịch (sfw_keywords→từ_khóa_sfw)…
    // Chỉ áp cho KEYWORD dict (opts.pruneInvalidKeywords) — entry NAME dài/có [prefix] là hợp lệ.
    if (opts?.pruneInvalidKeywords && !isValidEjsKeywordKey(k)) {
      fixes.push(`"${k.slice(0, 40)}${k.length > 40 ? '…' : ''}" — BỎ khỏi từ điển (không phải keyword: văn xuôi/mảnh code/identifier)`);
      continue;
    }
    const clean = canonicalizeEjsValue(v);
    fixedDict[k] = clean;
    if (clean !== v) fixes.push(`"${k}": "${v}" → "${clean}" (làm sạch)`);
  }
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const clusters = new Map<string, string[]>();
  for (const v of Object.values(fixedDict)) {
    if (!v) continue;
    const nk = norm(v);
    if (!clusters.has(nk)) clusters.set(nk, []);
    clusters.get(nk)!.push(v);
  }
  const canonicalOf = new Map<string, string>();
  for (const [nk, vals] of clusters) {
    const freq = new Map<string, number>();
    for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
    let best = vals[0];
    for (const [v, c] of freq) {
      const bc = freq.get(best) || 0;
      if (c > bc || (c === bc && v.length > best.length)) best = v;
    }
    canonicalOf.set(nk, best);
  }
  for (const [k, v] of Object.entries(fixedDict)) {
    if (!v) continue;
    const canon = canonicalOf.get(norm(v));
    if (canon && canon !== v) {
      fixedDict[k] = canon;
      fixes.push(`"${k}": "${v}" → "${canon}" (đồng nhất cụm)`);
    }
  }
  // (User 2026) BÁO ĐỤNG ĐỘ: ≥2 key GỐC khác nhau dịch ra CÙNG 1 value (vd 父女 và 父子 đều → "Cha
  // con") ⇒ logic game so sánh 2 keyword đó hết phân biệt được. KHÔNG tự đổi (đổi là lệch bản dịch đã
  // áp) — báo để user sửa tay trong panel (input sửa được).
  const byValue = new Map<string, string[]>();
  for (const [k, v] of Object.entries(fixedDict)) {
    if (!v || v === k) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(k);
  }
  for (const [v, keys] of byValue) {
    if (keys.length > 1) {
      fixes.push(`⚠ ĐỤNG ĐỘ: ${keys.length} key khác nhau (${keys.slice(0, 3).map(k => `"${k}"`).join(', ')}) cùng dịch thành "${v}" — game sẽ không phân biệt được, hãy sửa tay cho khác nhau.`);
    }
  }
  return { fixedDict, fixes };
}

/* ═══════════════════════════════════════════════════════════════════
   AI DỊCH LẠI KHI DỊCH TRÙNG NGHĨA (mirror aiResolveMvuConflicts của Chiến lược B)
   ═══════════════════════════════════════════════════════════════════
   (User 2026) "khác từ nhưng dịch ra cùng nghĩa" — vd 父女 và 父子 đều → "Cha con",
   青龙 và 苍龙 đều → "Thanh Long". Với EJS, keyword dùng để SO SÁNH/kích hoạt và entry name
   dùng trong getwi(): 2 nguồn khác nhau mà ra CÙNG 1 tên thì logic game hết phân biệt được.
   enforceEjsDictConsistency chỉ BÁO (không dám tự đổi vì sợ lệch bản dịch đã áp); hàm này gọi
   AI DỊCH LẠI đúng các key đụng độ với prompt buộc mỗi key 1 tên DUY NHẤT + đúng nghĩa. */

export interface EjsConflict {
  /** 'entry_name' | 'keyword' — biết ghi lại vào dict nào. */
  type: 'entry_name' | 'keyword';
  /** Giá trị bản dịch bị trùng. */
  value: string;
  /** Các key gốc KHÁC NHAU cùng dịch ra `value`. */
  keys: string[];
}

/** Tìm các bản dịch trùng: ≥2 key GỐC khác nhau → CÙNG 1 value (bỏ map identity k===v). */
export function detectEjsConflicts(dict: Record<string, string>): { value: string; keys: string[] }[] {
  const byValue = new Map<string, string[]>();
  for (const [k, v] of Object.entries(dict || {})) {
    if (!v) continue;
    const nv = v.trim();
    if (!nv || nv === k) continue;
    if (!byValue.has(nv)) byValue.set(nv, []);
    byValue.get(nv)!.push(k);
  }
  return [...byValue.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([value, keys]) => ({ value, keys }));
}

/**
 * Gọi AI dịch lại các key bị dịch trùng nghĩa trong TỪ ĐIỂN EJS (entry name + keyword).
 * Trả về dict đã sửa + số key đã dịch lại + danh sách đụng độ phát hiện.
 * Đường thoát an toàn: key nào AI vẫn trả về trùng → tự thêm hậu tố "(gốc)" để ép duy nhất.
 */
export async function aiResolveEjsConflicts(
  entryNameDict: Record<string, string>,
  keywordDict: Record<string, string>,
  targetLang: string,
  proxy: ProxySettings,
  signal?: AbortSignal,
  cardContext?: string,
  customPrompt?: string,
): Promise<{
  fixedEntryDict: Record<string, string>;
  fixedKeywordDict: Record<string, string>;
  fixedCount: number;
  conflicts: EjsConflict[];
}> {
  const fixedEntryDict = { ...entryNameDict };
  const fixedKeywordDict = { ...keywordDict };

  const conflicts: EjsConflict[] = [
    ...detectEjsConflicts(entryNameDict).map(c => ({ type: 'entry_name' as const, ...c })),
    ...detectEjsConflicts(keywordDict).map(c => ({ type: 'keyword' as const, ...c })),
  ];
  if (conflicts.length === 0) {
    return { fixedEntryDict, fixedKeywordDict, fixedCount: 0, conflicts };
  }

  // Gom mọi key đụng độ (kèm type để ghi lại đúng dict). 1 key có thể xuất hiện 1 lần.
  const conflictItems: { key: string; type: 'entry_name' | 'keyword' }[] = [];
  const seen = new Set<string>();
  for (const c of conflicts) {
    for (const k of c.keys) {
      const id = `${c.type}:${k}`;
      if (seen.has(id)) continue;
      seen.add(id);
      conflictItems.push({ key: k, type: c.type });
    }
  }

  const conflictList = conflicts
    .map(c => `  ⚠️ [${c.type}] ${c.keys.map(k => `"${k}"`).join(', ')} đều bị dịch thành "${c.value}" — nhưng chúng là các khái niệm KHÁC NHAU! Mỗi cái cần MỘT tên riêng biệt.`)
    .join('\n');

  const contextBlock = cardContext ? `\n\nNGỮ CẢNH (mã EJS của card để tham khảo nghĩa):\n${cardContext.slice(0, 2500)}` : '';
  const customBlock = customPrompt?.trim()
    ? `\n\n═══ QUY TẮC DỊCH RIÊNG CỦA NGƯỜI DÙNG (ƯU TIÊN CAO NHẤT) ═══\n${customPrompt.trim()}\n═══ HẾT QUY TẮC RIÊNG ═══`
    : '';

  const system = `Bạn là chuyên gia dịch thuật cho thẻ nhân vật SillyTavern dùng EJS.
Trước đó bạn đã dịch một số tên/keyword, nhưng NHIỀU nguồn gốc KHÁC NHAU lại ra CÙNG một bản dịch.
Đây là LỖI NGHIÊM TRỌNG: keyword EJS dùng để SO SÁNH/kích hoạt và entry name dùng trong getwi() — hai thứ khác nhau mà trùng tên thì logic game sẽ không phân biệt được và hỏng.

Dịch LẠI mỗi mục dưới đây thành một tên DUY NHẤT, KHÁC NHAU, và ĐÚNG NGHĨA. Chú ý phân biệt nghĩa thật của từng chữ Hán/Nhật/Hàn (vd 父女 = cha-con GÁI ≠ 父子 = cha-con TRAI; 青龙 = Thanh Long ≠ 苍龙 = Thương Long).
- Danh từ riêng Trung → Hán Việt; Nhật → Romaji; Hàn → Romanization chuẩn. KHÔNG dịch tiếng Anh.
- Tên phương Tây phiên qua CJK → khôi phục chữ Latinh gốc.${customBlock}${contextBlock}

ĐỊNH DẠNG ĐẦU RA — JSON object ánh xạ nguyên bản gốc → bản dịch MỚI, gồm ĐỦ mọi mục:
{ "nguyên bản 1": "bản dịch mới 1", "nguyên bản 2": "bản dịch mới 2" }
Chỉ xuất JSON, không markdown, không giải thích.`;

  const user = `CÁC ĐỤNG ĐỘ CẦN SỬA:
${conflictList}

Dịch lại các mục sau, mỗi mục PHẢI có bản dịch DUY NHẤT và khác nhau:
${conflictItems.map((it, i) => `${i + 1}. [${it.type}] "${it.key}"`).join('\n')}`;

  try {
    const requestTimeout = (proxy as any).requestTimeout || 300000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort('EJS dedup timeout'), requestTimeout * 2);
    const fetchSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

    const responseText = await callProvider(proxy, system, user, fetchSignal, undefined, { label: `EJS sửa dịch trùng (${conflictItems.length} mục)` });
    clearTimeout(timeoutId);

    const parsed = parseJsonFromAi(responseText);
    const fixedMap: Record<string, any> = parsed.translations || parsed;

    // Áp bản dịch mới; đảm bảo DUY NHẤT trong PHẠM VI từng dict (entry vs keyword tách namespace).
    const usedEntry = new Set(Object.entries(fixedEntryDict).filter(([k, v]) => v && !conflictItems.some(c => c.type === 'entry_name' && c.key === k)).map(([, v]) => v.trim()));
    const usedKw = new Set(Object.entries(fixedKeywordDict).filter(([k, v]) => v && !conflictItems.some(c => c.type === 'keyword' && c.key === k)).map(([, v]) => v.trim()));
    let fixedCount = 0;
    for (const it of conflictItems) {
      const raw = fixedMap?.[it.key];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      let val = canonicalizeEjsValue(raw.trim());
      const used = it.type === 'entry_name' ? usedEntry : usedKw;
      if (used.has(val)) {
        // Vẫn trùng → ép duy nhất bằng hậu tố gốc (đường thoát an toàn)
        val = canonicalizeEjsValue(`${val} (${it.key})`);
      }
      used.add(val);
      if (it.type === 'entry_name') fixedEntryDict[it.key] = val;
      else fixedKeywordDict[it.key] = val;
      fixedCount++;
    }

    return { fixedEntryDict, fixedKeywordDict, fixedCount, conflicts };
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    console.error('[EJS Sync] Dịch lại đụng độ thất bại:', err?.message);
    return { fixedEntryDict, fixedKeywordDict, fixedCount: 0, conflicts };
  }
}

export function autoFixEjsKeywordsExtended(
  translated: string,
  ejsKeywordDictRaw: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  // (bug 39) lọc từ điển theo text trước khi dựng RegExp — xem filterDictByText.
  const ejsKeywordDict = filterDictByText(ejsKeywordDictRaw, translated);
  const fixes: { found: string; replaced: string }[] = [];

  const entries = Object.entries(ejsKeywordDict).filter(([k, v]) => k && v && k !== v);
  if (entries.length === 0) return { text: translated, fixes };

  // Sort by length descending to avoid partial replacement
  const sortedEntries = entries.sort((a, b) => b[0].length - a[0].length);

  let text = translated;

  // Build a set of EJS block ranges to skip (already handled by autoFixEjsKeywords)
  const ejsBlockRegex = /<%[\s\S]*?%>/g;
  const ejsRanges: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = ejsBlockRegex.exec(text)) !== null) {
    ejsRanges.push({ start: m.index, end: m.index + m[0].length });
  }

  const isInEjsBlock = (pos: number): boolean => {
    return ejsRanges.some(r => pos >= r.start && pos < r.end);
  };

  for (const [original, translatedKw] of sortedEntries) {
    const escapedOriginal = escapeRegex(original);

    // Only replace inside quoted strings OUTSIDE of EJS blocks
    // We use a global scan + manual position check
    const quotedPattern = new RegExp(
      `(['"\`])([^'"\`]*?)${escapedOriginal}([^'"\`]*?)\\1`,
      'g',
    );

    // Process matches from end to start to preserve indices
    const matches: { index: number; match: string; replacement: string }[] = [];
    let qm: RegExpExecArray | null;
    while ((qm = quotedPattern.exec(text)) !== null) {
      // Skip if this match is inside an EJS block (already handled)
      if (isInEjsBlock(qm.index)) continue;

      const q = qm[1];
      const pre = qm[2];
      const post = qm[3];
      const replacement = `${q}${pre}${translatedKw}${post}${q}`;
      matches.push({ index: qm.index, match: qm[0], replacement });
    }

    // Apply in reverse order
    for (let i = matches.length - 1; i >= 0; i--) {
      const { index, match: matchStr, replacement } = matches[i];
      text = text.slice(0, index) + replacement + text.slice(index + matchStr.length);
      if (!fixes.some(f => f.found === original && f.replaced === translatedKw)) {
        fixes.push({ found: original, replaced: translatedKw });
      }
    }
  }

  return { text, fixes };
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/** Collect all translatable text from a card with source path info */
function collectAllTexts(card: CharacterCard): { text: string; source: string }[] {
  const allTexts: { text: string; source: string }[] = [];
  const data = (card.data || card) as any;

  for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions'] as const) {
    const val = (data as any)[key];
    if (typeof val === 'string' && val.trim()) {
      allTexts.push({ text: val, source: `data.${key}` });
    }
  }

  if (Array.isArray((data as any).alternate_greetings)) {
    (data as any).alternate_greetings.forEach((g: string, i: number) => {
      if (typeof g === 'string' && g.trim()) {
        allTexts.push({ text: g, source: `data.alternate_greetings[${i}]` });
      }
    });
  }

  const entries = data.character_book?.entries || [];
  entries.forEach((entry: any, i: number) => {
    if (typeof entry.content === 'string' && entry.content.trim()) {
      allTexts.push({ text: entry.content, source: `lorebook[${i}].content` });
    }
    if (typeof entry.comment === 'string' && entry.comment.trim()) {
      allTexts.push({ text: entry.comment, source: `lorebook[${i}].comment` });
    }
    if (typeof entry.name === 'string' && entry.name.trim()) {
      allTexts.push({ text: entry.name, source: `lorebook[${i}].name` });
    }
  });

  if (data.extensions?.depth_prompt?.prompt) {
    allTexts.push({ text: data.extensions.depth_prompt.prompt, source: 'depth_prompt' });
  }

  if (Array.isArray(data.extensions?.regex_scripts)) {
    data.extensions.regex_scripts.forEach((rs: any, i: number) => {
      if (typeof rs.replaceString === 'string' && rs.replaceString.trim()) {
        allTexts.push({ text: rs.replaceString, source: `regex[${i}].replaceString` });
      }
      if (typeof rs.scriptName === 'string' && rs.scriptName.trim()) {
        allTexts.push({ text: rs.scriptName, source: `regex[${i}].scriptName` });
      }
    });
  }

  const thScripts = data.extensions?.tavern_helper;
  if (thScripts) {
    let scripts: any[] = [];
    if (Array.isArray(thScripts)) {
      for (const item of thScripts) {
        if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
          scripts.push(...item[1]);
        } else if (item && typeof item === 'object' && !Array.isArray(item) && item.content) {
          scripts.push(item);
        }
      }
    } else if (thScripts.scripts && Array.isArray(thScripts.scripts)) {
      scripts = thScripts.scripts;
    }
    scripts.forEach((s: any, i: number) => {
      if (typeof s.content === 'string' && s.content.trim()) {
        allTexts.push({ text: s.content, source: `tavern_helper[${i}]` });
      }
    });
  }

  return allTexts;
}

/** Escape string for use in RegExp */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
