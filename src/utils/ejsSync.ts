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
import { getMaxOutputTokens } from './apiClient';

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
  sourceType: 'getwi' | 'getWorldInfo' | 'getWorldInfoData' | 'getWorldInfoActivatedData';
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
  }

  return Array.from(refMap.values());
}

/**
 * Deep extract keywords from EJS blocks: string comparisons, alias arrays,
 * decorator triggers, and define() names.
 */
export function extractEjsKeywords(card: CharacterCard): EjsKeyword[] {
  const allTexts = collectAllTexts(card);
  const keywords: EjsKeyword[] = [];
  const seen = new Set<string>();

  const addKeyword = (keyword: string, type: EjsKeyword['type'], foundIn: string, context?: string) => {
    const key = `${keyword}::${type}`;
    if (seen.has(key)) return;
    // Skip very short strings, pure numbers, common code tokens
    if (keyword.length < 2) return;
    if (/^\d+$/.test(keyword)) return;
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(keyword) && keyword.length < 4) return;
    // Only collect CJK or long strings (likely translatable)
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\uac00-\ud7af\u3040-\u30ff]/.test(keyword);
    if (!hasCJK && keyword.length < 6) return;

    seen.add(key);
    keywords.push({ keyword, type, foundIn, context });
  };

  for (const { text, source } of allTexts) {
    // ═══ 1. String comparisons inside EJS blocks ═══
    // Extract EJS blocks first
    const ejsBlocks = text.match(/<%[\s\S]*?%>/g) || [];
    for (const block of ejsBlocks) {
      // if (xxx === 'keyword') or if (xxx == 'keyword')
      const comparisonPatterns = [
        /[=!]==?\s*['"`]([^'"`]{2,})['"`]/g,
        /['"`]([^'"`]{2,})['"`]\s*[=!]==?/g,
        // .includes('keyword')
        /\.includes\s*\(\s*['"`]([^'"`]{2,})['"`]\s*\)/g,
        // .indexOf('keyword')
        /\.indexOf\s*\(\s*['"`]([^'"`]{2,})['"`]\s*\)/g,
        // .match('pattern') or .match(/pattern/)
        /\.match\s*\(\s*['"`]([^'"`]{2,})['"`]\s*\)/g,
        // .startsWith('keyword') / .endsWith('keyword')
        /\.(?:startsWith|endsWith)\s*\(\s*['"`]([^'"`]{2,})['"`]\s*\)/g,
        // switch case: case 'value':
        /case\s+['"`]([^'"`]{2,})['"`]\s*:/g,
      ];

      for (const pattern of comparisonPatterns) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(block)) !== null) {
          addKeyword(m[1], 'comparison', source, block.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
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
      // push('...')
      /\.push\s*\(\s*['"`]([^'"`]{2,})['"`]\s*\)/g,
    ];

    for (const pattern of arrayPatterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        if (m[1]) {
          // Extract individual strings from the array
          const stringPattern = /['"`]([^'"`]{2,})['"`]/g;
          let s: RegExpExecArray | null;
          while ((s = stringPattern.exec(m[1])) !== null) {
            addKeyword(s[1], 'alias', source, m[0].slice(0, 100));
          }
        }
      }
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
    const objKvPattern = /['"`]([^'"`]{2,})['"`]\s*:\s*['"`]([^'"`]{2,})['"`]/g;
    for (const block of ejsBlocks) {
      objKvPattern.lastIndex = 0;
      let kv: RegExpExecArray | null;
      while ((kv = objKvPattern.exec(block)) !== null) {
        const hasCJKKey = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(kv[1]);
        const hasCJKVal = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(kv[2]);
        if (hasCJKKey) addKeyword(kv[1], 'alias', source, kv[0]);
        if (hasCJKVal) addKeyword(kv[2], 'alias', source, kv[0]);
      }
    }

    // ═══ 6. Deep scan: template literal CJK strings ═══
    // `some ${var} 中文 text`
    const templatePattern = /`([^`]*[\u4e00-\u9fff\u3400-\u4dbf][^`]*)`/g;
    for (const block of ejsBlocks) {
      templatePattern.lastIndex = 0;
      let tl: RegExpExecArray | null;
      while ((tl = templatePattern.exec(block)) !== null) {
        // Extract only the CJK segments (not the whole template literal)
        const cjkSegments = tl[1].match(/[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]{2,}/g);
        if (cjkSegments) {
          for (const seg of cjkSegments) {
            addKeyword(seg, 'comparison', source, tl[0].slice(0, 80));
          }
        }
      }
    }

    // ═══ 7. Deep scan: condition/value strings in getvar comparisons ═══
    // getvar('var_name') === 'CJK value'
    const getvarCompPattern = /getvar\s*\(\s*['"`][^'"`]*['"`](?:\s*,\s*\{[^}]*\})?\s*\)\s*[=!]==?\s*['"`]([^'"`]{2,})['"`]/g;
    getvarCompPattern.lastIndex = 0;
    let gvc: RegExpExecArray | null;
    while ((gvc = getvarCompPattern.exec(text)) !== null) {
      addKeyword(gvc[1], 'comparison', source, gvc[0]);
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

/**
 * Use AI to translate EJS entry names and keywords.
 * Groups them into a single API call for efficiency.
 */
export async function aiTranslateEjsEntries(
  entryNames: string[],
  keywords: string[],
  targetLang: string,
  proxy: ProxySettings,
  signal?: AbortSignal,
  cardContext?: string,
): Promise<{ entryTranslations: Record<string, string>; keywordTranslations: Record<string, string> }> {
  const allItems = [
    ...entryNames.map(n => ({ text: n, type: 'entry_name' })),
    ...keywords.map(k => ({ text: k, type: 'keyword' })),
  ];

  if (allItems.length === 0) {
    return { entryTranslations: {}, keywordTranslations: {} };
  }

  const entryList = allItems.map((item, i) => `${i + 1}. [${item.type}] "${item.text}"`).join('\n');

  let contextBlock = '';
  if (cardContext) {
    contextBlock = `\n\nCONTEXT (EJS code from the card for reference):\n${cardContext.slice(0, 3000)}`;
  }

  const systemPrompt = `You are a specialized translator for SillyTavern EJS character cards.
You must translate the following items from their original language into ${targetLang}.

ITEMS TO TRANSLATE:
${entryList}
${contextBlock}

RULES:
1. [entry_name] items are lorebook entry titles used in getwi() calls. The translated name MUST be used consistently wherever this entry is referenced.
2. [keyword] items are EJS trigger keywords, NPC/location aliases, or comparison strings. Translate naturally but consistently.
3. Chinese proper nouns → Hán Việt (Sino-Vietnamese reading). Japanese proper nouns → Romaji.
4. Western/Fantasy names transcribed into CJK → restore to original Latin spelling.
5. Short system/technical terms should remain concise after translation.
6. NEVER translate technical tokens (variable names, function names, CSS selectors).

OUTPUT FORMAT — STRICT JSON object mapping original → translated:
{
  "original text 1": "translated text 1",
  "original text 2": "translated text 2"
}

Output ONLY the JSON object. No markdown, no explanation.`;

  const userPrompt = `Translate these items to ${targetLang}:\n${entryList}`;

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
    const timeoutId = setTimeout(() => timeoutController.abort('EJS key translation timeout'), requestTimeout * 2);
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
    const translations = parsed.translations || parsed;

    const entryTranslations: Record<string, string> = {};
    const keywordTranslations: Record<string, string> = {};

    for (const item of allItems) {
      const translated = translations[item.text];
      if (translated && typeof translated === 'string' && translated.trim()) {
        if (item.type === 'entry_name') {
          entryTranslations[item.text] = translated.trim();
        } else {
          keywordTranslations[item.text] = translated.trim();
        }
      }
    }

    return { entryTranslations, keywordTranslations };
  } catch (err) {
    if (err instanceof Error && (err.message === 'Cancelled' || signal?.aborted)) throw err;
    console.error('AI EJS translation error:', err);
    throw err;
  }
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
    // Check if translated name appears in any getwi() call in translated fields
    const getwiPattern = new RegExp(
      `(?:getwi|getWorldInfo)\\s*\\(\\s*(?:null|''|""|\\w+)\\s*,\\s*['"\`]${escapeRegex(translated)}['"\`]`,
    );

    const originalGetwiPattern = new RegExp(
      `(?:getwi|getWorldInfo)\\s*\\(\\s*(?:null|''|""|\\w+)\\s*,\\s*['"\`]${escapeRegex(original)}['"\`]`,
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
    block += `\n\nCRITICAL — EJS ENTRY NAME DICTIONARY (getwi() SYNC):
This card uses EJS Entry Jumping — lorebook entries are loaded dynamically via getwi(null, 'Entry Name').
You MUST replace ALL original entry names with their translated equivalents in getwi() calls:
${entryList}
Rules:
- In getwi() / getWorldInfo() calls, the entry name argument MUST use the translated name
- The actual lorebook entry comment/name field will also be translated — they MUST match exactly
- If you see a narrative text referencing an entry name (for auto-trigger), use the translated name
- NEVER leave the original CJK entry name in a getwi() call if a translation is provided above`;
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
