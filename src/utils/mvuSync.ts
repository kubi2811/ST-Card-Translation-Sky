import type { CharacterCard, ProxySettings, TranslationField } from '../types/card';
import type { ZodFieldDef } from '../types/mvuZodTypes';
import { extractPatchFieldNames } from './jsonPatchValidator';
import { callProvider } from './apiClient';
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

  // Wrap with a clear error so a truncated/garbled AI response surfaces a
  // readable message (and is caught by the caller's retry loop) instead of a
  // bare "Unexpected end of JSON input".
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`AI response is not valid JSON (${(e as Error).message}). Snippet: ${text.slice(0, 120)}…`);
  }
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
 * Now also enforces covariance for macro variables ({{getvar::KEY}}) and
 * bracket access (obj['KEY']), not just YAML keys.
 *
 * @param translatedText The AI-translated initvar text
 * @param mvuDictionary The MVU dictionary (original CJK → translated name)
 * @returns { text: string, fixes: { found: string, replaced: string }[] }
 */
export function enforceInitvarCovariance(
  translatedText: string,
  mvuDictionary: Record<string, string>,
  strict = false
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

  let result = cleanYamlQuotes(translatedText);

  // ─── Pass 1: YAML key covariance (existing logic) ───
  const lines = result.split('\n');
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
    const correctValue = findClosestDictValue(yamlKey, mvuDictionary, strict);
    if (correctValue && correctValue !== yamlKey) {
      // Build a regex that replaces this specific YAML key occurrence
      const escaped = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyRegex = new RegExp(
        `^(\\s*)([\"']?)${escaped}([\"']?)(\\s*:)`,
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

  // ─── Pass 2: Macro variable covariance ───
  // Fix {{getvar::KEY}} / {{setvar::KEY::}} where KEY is a mismatched translation
  const macroRegex = /(\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)([^:}]+)(}}|::)/g;
  let macroMatch;
  const macroFixes: { from: string; to: string }[] = [];
  while ((macroMatch = macroRegex.exec(result)) !== null) {
    const varName = macroMatch[2].trim();
    if (!varName) continue;
    // Skip if already correct
    if (translatedToOriginal.has(varName.toLowerCase())) continue;
    // Skip if it's still a CJK original
    if (originalToTranslated.has(varName)) continue;

    const correctValue = findClosestDictValue(varName, mvuDictionary, strict);
    if (correctValue && correctValue !== varName) {
      macroFixes.push({ from: varName, to: correctValue });
    }
  }
  for (const mf of macroFixes) {
    const escaped = mf.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safeReplacement = mf.to.replace(/\$/g, '$$$$');
    const mfRegex = new RegExp(
      `(\\{\\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)${escaped}(}}|::)`,
      'g'
    );
    const newText = result.replace(mfRegex, `$1${safeReplacement}$2`);
    if (newText !== result) {
      result = newText;
      if (!fixes.some(f => f.found === mf.from)) {
        fixes.push({ found: mf.from, replaced: mf.to });
      }
    }
  }

  // ─── Pass 3: Bracket access covariance ───
  // Fix obj['KEY'] / data["KEY"] where KEY is a mismatched translation
  const bracketRegex = /(\[\s*['"])([^'"]+)(['"]\s*\])/g;
  let bracketMatch;
  const bracketFixes: { from: string; to: string }[] = [];
  while ((bracketMatch = bracketRegex.exec(result)) !== null) {
    const varName = bracketMatch[2].trim();
    if (!varName || varName.length < 2) continue;
    if (translatedToOriginal.has(varName.toLowerCase())) continue;
    if (originalToTranslated.has(varName)) continue;

    const correctValue = findClosestDictValue(varName, mvuDictionary, strict);
    if (correctValue && correctValue !== varName) {
      bracketFixes.push({ from: varName, to: correctValue });
    }
  }
  for (const bf of bracketFixes) {
    const escaped = bf.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safeReplacement = bf.to.replace(/\$/g, '$$$$');
    const bfRegex = new RegExp(
      `(\\[\\s*['"])${escaped}(['"]\\s*\\])`,
      'g'
    );
    const newText = result.replace(bfRegex, `$1${safeReplacement}$2`);
    if (newText !== result) {
      result = newText;
      if (!fixes.some(f => f.found === bf.from)) {
        fixes.push({ found: bf.from, replaced: bf.to });
      }
    }
  }

  // ─── Pass 4: EJS function call covariance ───
  // Fix getvar('KEY') / setvar('KEY', ...) where KEY is a mismatched translation
  const ejsRegex = /((?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"])([^'"]+)(['"])/g;
  result = result.replace(ejsRegex, (match, prefix, inner, suffix) => {
    if (!inner) return match;
    const segments = inner.split('.');
    let changed = false;
    const newSegments = segments.map((seg: string) => {
      if (!seg || seg.length < 2) return seg;
      if (translatedToOriginal.has(seg.toLowerCase())) return seg;
      if (originalToTranslated.has(seg)) return seg;

      const correctValue = findClosestDictValue(seg, mvuDictionary, strict);
      if (correctValue && correctValue !== seg) {
        changed = true;
        if (!fixes.some(f => f.found === seg)) {
          fixes.push({ found: seg, replaced: correctValue });
        }
        return correctValue;
      }
      return seg;
    });
    return changed ? `${prefix}${newSegments.join('.')}${suffix}` : match;
  });

  // ─── Pass 5: String comparison covariance ───
  // Fix === 'KEY' / !== "KEY" / case 'KEY'
  const compRegex = /((?:===|!==|==|!=|case)\s*['"])([^'"]+)(['"])/g;
  result = result.replace(compRegex, (match, prefix, inner, suffix) => {
    if (!inner || inner.length < 2) return match;
    if (translatedToOriginal.has(inner.toLowerCase())) return match;
    if (originalToTranslated.has(inner)) return match;

    const correctValue = findClosestDictValue(inner, mvuDictionary, strict);
    if (correctValue && correctValue !== inner) {
      if (!fixes.some(f => f.found === inner)) {
        fixes.push({ found: inner, replaced: correctValue });
      }
      return `${prefix}${correctValue}${suffix}`;
    }
    return match;
  });

  // ─── Pass 6: Lodash path covariance ───
  // Fix _.get(data, 'KEY') / _.set(obj, 'KEY', ...)
  const lodashRegex = /(_\.(?:get|set|has|result|pick|omit)\s*\([^,]+,\s*['"])([^'"]+)(['"])/g;
  result = result.replace(lodashRegex, (match, prefix, inner, suffix) => {
    if (!inner) return match;
    const segments = inner.split('.');
    let changed = false;
    const newSegments = segments.map((seg: string) => {
      if (!seg || seg.length < 2) return seg;
      if (translatedToOriginal.has(seg.toLowerCase())) return seg;
      if (originalToTranslated.has(seg)) return seg;

      const correctValue = findClosestDictValue(seg, mvuDictionary, strict);
      if (correctValue && correctValue !== seg) {
        changed = true;
        if (!fixes.some(f => f.found === seg)) {
          fixes.push({ found: seg, replaced: correctValue });
        }
        return correctValue;
      }
      return seg;
    });
    return changed ? `${prefix}${newSegments.join('.')}${suffix}` : match;
  });

  // Lodash array-style paths: _.get(data, ['Key1', 'Key2'])
  const lodashArrRegex = /(_\.(?:get|set|has|result)\s*\([^,]+,\s*\[)([^\]]+)(\])/g;
  result = result.replace(lodashArrRegex, (match, prefix, inner, suffix) => {
    const items = inner.split(',');
    let changed = false;
    const newItems = items.map((item: string) => {
      const trimmed = item.trim();
      const quoteMatch = trimmed.match(/^(['"])([^'"]+)(['"])$/);
      if (!quoteMatch) return item;
      const quoteStart = quoteMatch[1];
      const val = quoteMatch[2];
      const quoteEnd = quoteMatch[3];

      if (!val || val.length < 2) return item;
      if (translatedToOriginal.has(val.toLowerCase())) return item;
      if (originalToTranslated.has(val)) return item;

      const correctValue = findClosestDictValue(val, mvuDictionary, strict);
      if (correctValue && correctValue !== val) {
        changed = true;
        if (!fixes.some(f => f.found === val)) {
          fixes.push({ found: val, replaced: correctValue });
        }
        return `${quoteStart}${correctValue}${quoteEnd}`;
      }
      return item;
    });
    if (changed) {
      let newInner = '';
      for (let i = 0; i < items.length; i++) {
        const orig = items[i];
        const leadingWhitespace = orig.match(/^\s*/)?.[0] || '';
        const trailingWhitespace = orig.match(/\s*$/)?.[0] || '';
        newInner += leadingWhitespace + newItems[i].trim() + trailingWhitespace + (i < items.length - 1 ? ',' : '');
      }
      return `${prefix}${newInner}${suffix}`;
    }
    return match;
  });

  return { text: result, fixes };
}

/**
 * Enforce variable casing in regex/lorebook/tavern_helper content to match
 * the MVU Dictionary EXACTLY.
 *
 * Problem: AI translates schema variables as Title Case ("Hảo Cảm") but
 * when translating regex/lorebook content, uses lowercase ("hảo cảm").
 * This breaks the card because getvar('Hảo Cảm') ≠ 'hảo cảm'.
 *
 * Solution: After AI translation, scan for all variable-like references
 * and replace any that match a dictionary value case-insensitively but
 * differ in exact casing with the canonical dictionary form.
 *
 * @param translatedText The AI-translated regex/lorebook/etc text
 * @param mvuDictionary The MVU dictionary (original CJK → translated name)
 * @returns { text: string, fixes: { found: string, replaced: string }[] }
 */
export function enforceVariableCasing(
  translatedText: string,
  mvuDictionary: Record<string, string>
): { text: string; fixes: { found: string; replaced: string }[] } {
  if (!translatedText || typeof translatedText !== 'string') {
    return { text: translatedText, fixes: [] };
  }

  const fixes: { found: string; replaced: string }[] = [];

  // Build case-insensitive lookup: lowercased translated value → canonical translated value
  const canonicalMap = new Map<string, string>();
  for (const [, trans] of Object.entries(mvuDictionary)) {
    if (trans && trans.trim()) {
      const lower = trans.toLowerCase();
      // If there are multiple entries with same lowercase form, prefer longer one
      if (!canonicalMap.has(lower) || trans.length > (canonicalMap.get(lower)?.length || 0)) {
        canonicalMap.set(lower, trans);
      }
    }
  }

  if (canonicalMap.size === 0) {
    return { text: translatedText, fixes: [] };
  }

  let result = translatedText;

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');

  // Helper: check if a variable name needs casing fix
  const getCasingFix = (varName: string): string | null => {
    if (!varName || varName.length < 2) return null;
    const lower = varName.toLowerCase();
    const canonical = canonicalMap.get(lower);
    if (canonical && canonical !== varName) {
      return canonical;
    }
    return null;
  };

  // ─── Pass 1: Macro variables {{getvar::KEY}} / {{setvar::KEY::}} ───
  const macroRegex = /(\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)([^:}]+)(}}|::)/g;
  let macroMatch;
  const macroFixes: { from: string; to: string }[] = [];
  while ((macroMatch = macroRegex.exec(result)) !== null) {
    const varName = macroMatch[2].trim();
    const canonical = getCasingFix(varName);
    if (canonical) {
      macroFixes.push({ from: varName, to: canonical });
    }
  }
  for (const mf of macroFixes) {
    const escaped = escapeRegExp(mf.from);
    const safe = safeReplacement(mf.to);
    const mfRegex = new RegExp(
      `(\\{\\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)${escaped}(}}|::)`,
      'g'
    );
    const newText = result.replace(mfRegex, `$1${safe}$2`);
    if (newText !== result) {
      result = newText;
      if (!fixes.some(f => f.found === mf.from)) {
        fixes.push({ found: mf.from, replaced: mf.to });
      }
    }
  }

  // ─── Pass 2: data-var="KEY" ───
  const dataVarRegex = /(data-var\s*=\s*["'])([^"']+)(["'])/g;
  result = result.replace(dataVarRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      if (!fixes.some(f => f.found === inner)) {
        fixes.push({ found: inner, replaced: canonical });
      }
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ─── Pass 3: Bracket access obj['KEY'] / data["KEY"] ───
  const bracketRegex = /(\[\s*['"])([^'"]+)(['"]\s*\])/g;
  result = result.replace(bracketRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      if (!fixes.some(f => f.found === inner)) {
        fixes.push({ found: inner, replaced: canonical });
      }
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ─── Pass 4: EJS function calls getvar('KEY') / setvar('KEY', ...) ───
  const ejsRegex = /((?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"])([^'"]+)(['"])/g;
  result = result.replace(ejsRegex, (match, prefix, inner, suffix) => {
    if (!inner) return match;
    const segments = inner.split('.');
    let changed = false;
    const newSegments = segments.map((seg: string) => {
      const canonical = getCasingFix(seg);
      if (canonical) {
        changed = true;
        if (!fixes.some(f => f.found === seg)) {
          fixes.push({ found: seg, replaced: canonical });
        }
        return canonical;
      }
      return seg;
    });
    return changed ? `${prefix}${newSegments.join('.')}${suffix}` : match;
  });

  // ─── Pass 5: String comparisons === 'KEY' / !== "KEY" / case 'KEY' ───
  const compRegex = /((?:===|!==|==|!=|case)\s*['"])([^'"]+)(['"])/g;
  result = result.replace(compRegex, (match, prefix, inner, suffix) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      if (!fixes.some(f => f.found === inner)) {
        fixes.push({ found: inner, replaced: canonical });
      }
      return `${prefix}${canonical}${suffix}`;
    }
    return match;
  });

  // ─── Pass 6: YAML keys (start of line) ───
  const yamlKeyRegex = /^(\s*)(["']?)([^"':\s\n][^"':\n]*[^"':\s\n]|[^"':\s\n])(["']?)(\s*:)/gm;
  result = result.replace(yamlKeyRegex, (match, indent, q1, key, q2, colon) => {
    const canonical = getCasingFix(key.trim());
    if (canonical) {
      if (!fixes.some(f => f.found === key.trim())) {
        fixes.push({ found: key.trim(), replaced: canonical });
      }
      return `${indent}${q1}${canonical}${q2}${colon}`;
    }
    return match;
  });

  // ─── Pass 7: Lodash paths _.get(data, 'KEY') ───
  const lodashRegex = /(_\.(?:get|set|has|result|pick|omit)\s*\([^,]+,\s*['"])([^'"]+)(['"])/g;
  result = result.replace(lodashRegex, (match, prefix, inner, suffix) => {
    if (!inner) return match;
    const segments = inner.split('.');
    let changed = false;
    const newSegments = segments.map((seg: string) => {
      const canonical = getCasingFix(seg);
      if (canonical) {
        changed = true;
        if (!fixes.some(f => f.found === seg)) {
          fixes.push({ found: seg, replaced: canonical });
        }
        return canonical;
      }
      return seg;
    });
    return changed ? `${prefix}${newSegments.join('.')}${suffix}` : match;
  });

  return { text: result, fixes };
}

/**
 * Common CSS properties, JS keywords, and HTML tag names that must NEVER be
 * fuzzy-matched to MVU dictionary values. These short ASCII tokens are
 * especially vulnerable to Levenshtein false-positives (e.g., "top" → "Tay"
 * has edit distance 2, which was previously accepted).
 */
const PROTECTED_CODE_KEYWORDS = new Set([
  // CSS positioning & layout
  'top', 'left', 'right', 'bottom', 'gap', 'row', 'auto', 'flex', 'grid',
  'none', 'block', 'inline', 'wrap', 'start', 'end', 'center', 'space',
  'fixed', 'sticky', 'static', 'absolute', 'relative', 'inherit', 'initial',
  'unset', 'revert', 'normal', 'bold', 'italic', 'solid', 'dashed', 'dotted',
  'hidden', 'visible', 'scroll', 'clip', 'cover', 'contain', 'fill',
  'both', 'ease', 'linear', 'step',
  // CSS properties (short ones vulnerable to fuzzy match)
  'color', 'font', 'size', 'width', 'height', 'margin', 'padding', 'border',
  'display', 'position', 'float', 'clear', 'overflow', 'opacity', 'cursor',
  'content', 'order', 'align', 'justify', 'transform', 'transition',
  'animation', 'filter', 'outline', 'resize', 'zoom',
  // CSS units & functions
  'calc', 'var', 'rgb', 'rgba', 'hsl', 'hsla', 'url', 'attr', 'env',
  // HTML tags (short)
  'div', 'span', 'img', 'svg', 'nav', 'pre', 'sub', 'sup', 'map', 'col',
  'tag', 'tab', 'btn', 'bar', 'box', 'row', 'cell', 'icon', 'link', 'meta',
  'body', 'head', 'main', 'area', 'base', 'form', 'slot', 'mark', 'ruby',
  // JS keywords
  'var', 'let', 'new', 'for', 'try', 'set', 'get', 'map', 'key', 'val',
  'str', 'num', 'int', 'obj', 'arr', 'len', 'idx', 'err', 'msg', 'log',
  'max', 'min', 'sum', 'avg', 'pop', 'push', 'shift', 'sort', 'find',
  'join', 'trim', 'split', 'match', 'test', 'exec', 'call', 'bind', 'apply',
  'true', 'false', 'null', 'void', 'this', 'self', 'type', 'data', 'name',
  'text', 'value', 'label', 'title', 'class', 'style', 'event', 'index',
  // Common Vietnamese short words that shouldn't be fuzzy-matched
  'Thu', 'thu',
]);

/**
 * Find the closest matching dictionary value for a potentially mismatched YAML key.
 * Uses 3-pass matching strategy:
 * Pass 1: Normalized exact match (case, whitespace, underscore insensitive)
 * Pass 2: Substring containment with length ratio check
 * Pass 3: Levenshtein distance fallback with proportional threshold
 */
function findClosestDictValue(
  yamlKey: string,
  mvuDictionary: Record<string, string>,
  strict = false
): string | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const normalizedKey = normalize(yamlKey);

  // Reject protected CSS/JS/HTML keywords — these must NEVER be fuzzy-matched
  if (PROTECTED_CODE_KEYWORDS.has(yamlKey) || PROTECTED_CODE_KEYWORDS.has(normalizedKey)) {
    return null;
  }

  // Pass 1: Direct case-insensitive match against translated values
  for (const [, trans] of Object.entries(mvuDictionary)) {
    if (!trans || trans === yamlKey) continue;
    if (normalize(trans) === normalizedKey) {
      return trans; // Exact match after normalization — use dict value
    }
  }

  // In strict mode, ONLY use exact normalized match — no fuzzy matching.
  // This prevents false positives when running on narrative lorebook content
  // where Vietnamese proper nouns (dynasty names, place names) can be
  // fuzzy-matched to completely different MVU variable names.
  if (strict) return null;

  // Pass 2: Substring containment: "Độ Hảo Cảm" contains "Hảo Cảm"
  // Only match if the dict value is a significant portion of the key
  // CRITICAL: Use high ratio (0.85) to prevent false positives with Vietnamese diacritics
  // e.g. "Hương tần" vs "Dương Thị" have similar lengths but completely different meanings
  if (normalizedKey.length > 3) {
    for (const [, trans] of Object.entries(mvuDictionary)) {
      if (!trans || trans.length < 2) continue;
      const normalizedTrans = normalize(trans);
      if (normalizedTrans.length <= 3) continue; // Skip short dict values for substring match
      if (normalizedKey.includes(normalizedTrans) || normalizedTrans.includes(normalizedKey)) {
        const ratio = Math.min(normalizedKey.length, normalizedTrans.length) /
                      Math.max(normalizedKey.length, normalizedTrans.length);
        if (ratio > 0.85) {
          return trans;
        }
      }
    }
  }

  // Pass 3: Levenshtein distance fallback — catch typos and diacritics
  // e.g. "Hảo Câm" (typo) → "Hảo Cảm" (distance = 1)
  // CRITICAL: Use STRICT PROPORTIONAL threshold to prevent short-string false positives.
  // Vietnamese diacritics create many near-misses between completely different words:
  //   "Thanh Hà" vs "Thành Hán" (distance=2, completely different place names!)
  //   "Hồ Hạ" vs "Bộ Hạ" (distance=2, completely different dynasty names!)
  // Short strings (≤ 6 chars): allow max distance 1 (only single typo/diacritic)
  // Medium strings (7-10 chars): allow max distance 2
  // Long strings (≥ 11 chars): allow max distance 3
  let bestMatch: string | null = null;
  let bestDist = Infinity;
  for (const [, trans] of Object.entries(mvuDictionary)) {
    if (!trans || trans.length < 2) continue;
    const normalizedTrans = normalize(trans);
    const dist = levenshteinDistance(normalizedKey, normalizedTrans);
    
    const maxLen = Math.max(normalizedKey.length, normalizedTrans.length);
    const maxDist = maxLen <= 6 ? 1 : maxLen <= 10 ? 2 : 3;
    
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      bestMatch = trans;
    }
  }

  return bestMatch;
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESSIVE DICTIONARY — Extract mappings from translated entries
   ═══════════════════════════════════════════════════════════════ */

/** Check if a string contains CJK characters (module-level reusable) */
function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(s);
}

/**
 * Extract YAML-style keys from text in order of appearance.
 * Matches: `key: value`, `"key": value`, `'key': value`
 * Returns only unique keys in appearance order.
 */
function extractYamlKeysOrdered(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const yamlKeyRegex = /^\s*(?:["']([^"':\n]+)["']|([^"':\s\n][^"':\n]*[^"':\s\n]|[^"':\s\n]))\s*:/gm;
  let match;
  while ((match = yamlKeyRegex.exec(text)) !== null) {
    const key = (match[1] || match[2])?.trim();
    if (key && !seen.has(key) &&
        !key.startsWith('[') && !key.startsWith('<') &&
        !key.startsWith('//') && !key.startsWith('#') &&
        !key.startsWith('{') && !key.startsWith('*')) {
      keys.push(key);
      seen.add(key);
    }
  }
  return keys;
}

/**
 * Extract macro variable names from text in order of appearance.
 * Matches: {{getvar::KEY}}, {{setvar::KEY::VAL}}, {{addvar::KEY}}, etc.
 * Returns only unique variable names in appearance order.
 */
function extractMacroVarNamesOrdered(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const names: string[] = [];
  const seen = new Set<string>();
  const macroRegex = /\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::([^:}]+)/g;
  let match;
  while ((match = macroRegex.exec(text)) !== null) {
    const name = match[1].trim();
    if (name && !seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }
  return names;
}

/**
 * Extract variable name mappings from already-translated initvar/controller/mvu_logic entries.
 * Compares original vs translated text to find:
 * 1. YAML key mappings (positional comparison)
 * 2. Macro variable name mappings (positional comparison)
 * 3. Bracket access variable mappings
 *
 * This provides "ground truth" mappings from entries that define their OWN variables
 * (not just schema variables). These mappings are then merged into the MVU dictionary
 * so that subsequent entries can use the correct translated names.
 *
 * @param fields Array of TranslationField with status=done, translated set
 * @returns Record<originalCJK, translatedName>
 */
export function extractMappingFromTranslatedInitvar(
  fields: { original: string; translated: string; status: string; entryType?: string }[]
): Record<string, string> {
  const mapping: Record<string, string> = {};

  // Filter to initvar/controller/mvu_logic entries that are done
  const relevantFields = fields.filter(f =>
    (f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic') &&
    f.status === 'done' && f.translated && f.original
  );

  for (const field of relevantFields) {
    // ─── 1. YAML key positional mapping ───
    const origKeys = extractYamlKeysOrdered(field.original);
    const transKeys = extractYamlKeysOrdered(field.translated);

    if (origKeys.length === transKeys.length && origKeys.length > 0) {
      for (let i = 0; i < origKeys.length; i++) {
        if (origKeys[i] !== transKeys[i] && hasCJK(origKeys[i])) {
          mapping[origKeys[i]] = transKeys[i];
        }
      }
    }

    // ─── 2. Macro variable name positional mapping ───
    const origMacros = extractMacroVarNamesOrdered(field.original);
    const transMacros = extractMacroVarNamesOrdered(field.translated);

    if (origMacros.length === transMacros.length && origMacros.length > 0) {
      for (let i = 0; i < origMacros.length; i++) {
        if (origMacros[i] !== transMacros[i] && hasCJK(origMacros[i])) {
          // Only add if not already mapped (YAML keys take priority)
          if (!(origMacros[i] in mapping)) {
            mapping[origMacros[i]] = transMacros[i];
          }
        }
      }
    }

    // ─── 3. Bracket access: obj['KEY'] / data["KEY"] ───
    const bracketRegex = /\w+\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
    const origBrackets: string[] = [];
    const transBrackets: string[] = [];
    let bm;
    while ((bm = bracketRegex.exec(field.original)) !== null) {
      if (hasCJK(bm[1])) origBrackets.push(bm[1]);
    }
    bracketRegex.lastIndex = 0;
    while ((bm = bracketRegex.exec(field.translated)) !== null) {
      transBrackets.push(bm[1]);
    }
    if (origBrackets.length === transBrackets.length && origBrackets.length > 0) {
      for (let i = 0; i < origBrackets.length; i++) {
        if (origBrackets[i] !== transBrackets[i] && !(origBrackets[i] in mapping)) {
          mapping[origBrackets[i]] = transBrackets[i];
        }
      }
    }

    // ─── 4. String comparisons: === 'KEY' / case 'KEY' ───
    const compRegex = /(?:===|!==|==|!=|case)\s*['"]([^'"]+)['"]/g;
    const origComps: string[] = [];
    const transComps: string[] = [];
    while ((bm = compRegex.exec(field.original)) !== null) {
      if (hasCJK(bm[1])) origComps.push(bm[1]);
    }
    compRegex.lastIndex = 0;
    while ((bm = compRegex.exec(field.translated)) !== null) {
      transComps.push(bm[1]);
    }
    if (origComps.length === transComps.length && origComps.length > 0) {
      for (let i = 0; i < origComps.length; i++) {
        if (origComps[i] !== transComps[i] && !(origComps[i] in mapping)) {
          mapping[origComps[i]] = transComps[i];
        }
      }
    }
  }

  return mapping;
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

/** Metadata for a single MVU dictionary entry — stored separately from dict */
export interface MvuKeyMetadata {
  sources: string[];         // ['zod', 'yaml', 'macro', 'enum', ...]
  keyType?: 'field_name' | 'enum_value' | 'string_literal';
  description?: string;      // From Zod .describe()
  occurrences: number;       // Number of appearances in card
  confidence: 'schema' | 'ai' | 'manual' | 'progressive'; // Translation source
}

/* ═══════════════════════════════════════════════════════════════
   Levenshtein Distance — for fuzzy matching in covariance checks
   ═══════════════════════════════════════════════════════════════ */

/**
 * Compute Levenshtein (edit) distance between two strings.
 * Used by findClosestDictValue and enforceExactConsistency to catch
 * near-miss translations (typos, diacritics, case variations).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two-row optimization for O(min(m,n)) space
  const la = a.length, lb = b.length;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lb];
}

/* ═══════════════════════════════════════════════════════════════
   Dictionary Conflict Detection
   ═══════════════════════════════════════════════════════════════ */

/**
 * Detect conflicts: 2+ original CJK keys mapping to the SAME translated value.
 * This causes runtime ambiguity — the card can't distinguish between two
 * different variables if they have identical translated names.
 */
export function validateDictionaryConflicts(
  dict: Record<string, string>
): { key1: string; key2: string; sharedValue: string }[] {
  const conflicts: { key1: string; key2: string; sharedValue: string }[] = [];
  const reverseMap = new Map<string, string[]>();

  for (const [orig, trans] of Object.entries(dict)) {
    if (!trans || orig === trans) continue;
    const normalized = trans.toLowerCase().trim();
    if (!reverseMap.has(normalized)) reverseMap.set(normalized, []);
    reverseMap.get(normalized)!.push(orig);
  }

  for (const [, origKeys] of reverseMap) {
    if (origKeys.length > 1) {
      // Report all pairs
      for (let i = 0; i < origKeys.length; i++) {
        for (let j = i + 1; j < origKeys.length; j++) {
          conflicts.push({
            key1: origKeys[i],
            key2: origKeys[j],
            sharedValue: dict[origKeys[i]],
          });
        }
      }
    }
  }

  return conflicts;
}

/* ═══════════════════════════════════════════════════════════════
   Exact Consistency Enforcement
   ═══════════════════════════════════════════════════════════════ */

/**
 * Enforce 100% character-exact consistency across all dictionary values.
 * Finds near-duplicate translated values (e.g. "Hảo Cảm" vs "Hảo cảm")
 * and normalizes them to a single canonical form.
 *
 * Canonical selection priority:
 * 1. Schema-sourced mapping (if metadata available)
 * 2. Most common form (by frequency in dict)
 * 3. First encountered form
 */
export function enforceExactConsistency(
  dict: Record<string, string>,
  metadata?: Record<string, MvuKeyMetadata>
): { fixedDict: Record<string, string>; fixes: string[] } {
  const fixedDict = { ...dict };
  const fixes: string[] = [];

  // Group values by normalized form
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const groups = new Map<string, { origKey: string; transValue: string }[]>();

  for (const [origKey, transValue] of Object.entries(dict)) {
    if (!transValue || origKey === transValue) continue;
    const norm = normalize(transValue);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push({ origKey, transValue });
  }

  // Also check Levenshtein-close groups that normalize differently
  const normKeys = [...groups.keys()];
  const mergedGroups = new Map<string, string[]>(); // canonical norm → all similar norms
  const visited = new Set<string>();

  for (let i = 0; i < normKeys.length; i++) {
    if (visited.has(normKeys[i])) continue;
    const cluster = [normKeys[i]];
    visited.add(normKeys[i]);
    for (let j = i + 1; j < normKeys.length; j++) {
      if (visited.has(normKeys[j])) continue;
      if (levenshteinDistance(normKeys[i], normKeys[j]) <= 2) {
        cluster.push(normKeys[j]);
        visited.add(normKeys[j]);
      }
    }
    if (cluster.length > 1) {
      mergedGroups.set(normKeys[i], cluster);
    }
  }

  // For each cluster of similar normalized forms, pick canonical and fix
  for (const [, clusterNorms] of mergedGroups) {
    // Collect all entries from all norms in this cluster
    const allEntries: { origKey: string; transValue: string }[] = [];
    for (const norm of clusterNorms) {
      const entries = groups.get(norm);
      if (entries) allEntries.push(...entries);
    }
    if (allEntries.length < 2) continue;

    // Pick canonical: prefer schema confidence, then frequency
    let canonical = allEntries[0].transValue;
    if (metadata) {
      const schemaEntry = allEntries.find(e => metadata[e.origKey]?.confidence === 'schema');
      if (schemaEntry) canonical = schemaEntry.transValue;
    }
    if (!metadata) {
      // Pick most frequent form
      const freq = new Map<string, number>();
      for (const e of allEntries) {
        freq.set(e.transValue, (freq.get(e.transValue) || 0) + 1);
      }
      let maxCount = 0;
      for (const [val, count] of freq) {
        if (count > maxCount) { maxCount = count; canonical = val; }
      }
    }

    // Fix all non-canonical to canonical
    for (const entry of allEntries) {
      if (entry.transValue !== canonical) {
        fixedDict[entry.origKey] = canonical;
        fixes.push(`"${entry.origKey}": "${entry.transValue}" → "${canonical}"`);
      }
    }
  }

  // Also fix exact-normalize duplicates within single groups
  for (const [, entries] of groups) {
    if (entries.length < 2) continue;
    // Check if any entries have different exact strings
    const uniqueValues = new Set(entries.map(e => e.transValue));
    if (uniqueValues.size <= 1) continue;

    // Pick canonical
    let canonical = entries[0].transValue;
    if (metadata) {
      const schemaEntry = entries.find(e => metadata[e.origKey]?.confidence === 'schema');
      if (schemaEntry) canonical = schemaEntry.transValue;
    }

    for (const entry of entries) {
      if (entry.transValue !== canonical) {
        fixedDict[entry.origKey] = canonical;
        fixes.push(`"${entry.origKey}": "${entry.transValue}" → "${canonical}"`);
      }
    }
  }

  return { fixedDict, fixes };
}

/**
 * Build metadata registry from extracted key infos.
 * Called after extractPotentialMvuKeys() to create metadata for the panel.
 */
export function buildKeyMetadata(
  keyInfos: MvuKeyInfo[],
  dict: Record<string, string>
): Record<string, MvuKeyMetadata> {
  const result: Record<string, MvuKeyMetadata> = {};
  for (const ki of keyInfos) {
    const hasTranslation = ki.key in dict && dict[ki.key] && dict[ki.key] !== ki.key;
    result[ki.key] = {
      sources: ki.sources,
      keyType: ki.keyType,
      description: ki.description,
      occurrences: ki.occurrences,
      confidence: hasTranslation ? 'ai' : 'ai', // Will be updated by callers
    };
  }
  return result;
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
    // Handle both unquoted (word chars + unicode) and quoted keys.
    // NOTE: the unquoted branch is length-capped ({1,100}) to prevent catastrophic
    // regex backtracking on huge HTML/CSS replaceString fields (e.g. 135KB cards with
    // many ":" chars). A real Zod field key is always short, so this loses no matches
    // while turning an O(n²) blow-up (30s+ freeze) into linear time.
    const zodFieldRegex = /(?:["']([^"']+)["']|([^\s:.,;()]{1,100}))\s*:\s*(?:z|Zod)\.\w+/g;
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
    // NOTE: anchor on the bracket+quote (rare) and verify the leading identifier
    // manually, instead of putting `\w+\s*` in the regex. A leading `\w+` causes
    // catastrophic O(n\u00b2) backtracking on huge JS/HTML fields (e.g. a 328KB script \u2192
    // 600ms+ freeze). The form below has no leading quantifier, so it stays linear.
    const bracketRegex = /\[\s*['"]([^'"]+)['"]\s*\]/g;
    let match;
    while ((match = bracketRegex.exec(text)) !== null) {
      // Require an identifier char immediately before the '[' (whitespace allowed)
      let j = match.index - 1;
      while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
      if (j < 0 || !/\w/.test(text[j])) continue;
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

/* ═══ CJK Character Meaning Hints (prevent same-translation-for-different-keys) ═══ */

/**
 * Common CJK characters that LLMs frequently confuse when translating variable names.
 * Each entry maps a character to its core meaning hint, helping the AI distinguish
 * characters that look similar or share radicals but have completely different meanings.
 *
 * This is used when Zod .describe() is not available for a key, to auto-generate
 * semantic hints that prevent 武力 and 魅力 from both being translated as "Võ Lực".
 */
const CJK_CHAR_HINTS: Record<string, string> = {
  // ── Force/Power characters (commonly confused) ──
  '武': 'martial/military', '魅': 'charm/charisma/attractiveness', '魔': 'magic/demonic',
  '体': 'body/physical', '智': 'intelligence/wisdom', '敏': 'agility/speed',
  '力': 'force/power/strength', '气': 'energy/qi/breath', '精': 'spirit/essence',
  '耐': 'endurance/patience', '速': 'speed/velocity', '防': 'defense/protection',
  '攻': 'attack/offense', '运': 'luck/fortune', '幸': 'fortune/happiness',
  // ── Description/Explanation characters (commonly confused) ──
  '描': 'depict/draw/describe', '述': 'narrate/state', '说': 'speak/explain',
  '明': 'clear/bright/explain', '释': 'release/explain', '义': 'meaning/justice',
  '注': 'note/annotate', '解': 'solve/explain/understand',
  // ── Status/State characters ──
  '状': 'shape/condition/status', '态': 'state/attitude', '情': 'emotion/feeling',
  '感': 'feel/sense', '绪': 'thread/mood', '心': 'heart/mind',
  '怒': 'anger', '喜': 'joy/happiness', '悲': 'sorrow/sadness', '恐': 'fear',
  '爱': 'love', '恨': 'hate', '欲': 'desire/want',
  // ── Appearance/Beauty characters ──
  '容': 'appearance/face/tolerate', '貌': 'appearance/looks', '美': 'beauty/beautiful',
  '丑': 'ugly', '颜': 'face/color', '色': 'color/lust',
  // ── People/Family characters ──
  '人': 'person/people', '员': 'member/staff', '族': 'clan/family/ethnic',
  '家': 'family/home', '成': 'become/achieve', '动': 'move/action',
  '友': 'friend', '敌': 'enemy', '侣': 'companion/partner',
  // ── Time characters ──
  '月': 'month/moon', '日': 'day/sun', '年': 'year', '时': 'time/hour',
  '无': 'none/without/nothing', '有': 'have/exist',
  // ── Stats/Numbers ──
  '值': 'value/worth', '数': 'number/count', '量': 'measure/amount',
  '率': 'rate/ratio', '度': 'degree/level', '级': 'level/grade/class',
  '分': 'divide/score/minute', '点': 'point/dot',
  // ── Actions ──
  '统': 'govern/system/unified', '治': 'govern/cure', '政': 'politics/government',
  '务': 'affairs/duty/task', '学': 'study/learn', '才': 'talent/ability',
  '射': 'shoot/emit', '骑': 'ride/mount',
};

/**
 * Generate a semantic hint for a CJK key using character-level analysis.
 * Returns a brief English meaning hint like "martial + force" for "武力".
 */
function generateCjkHint(key: string): string | null {
  const chars = key.split('').filter(ch => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch));
  if (chars.length === 0) return null;

  const hints = chars.map(ch => CJK_CHAR_HINTS[ch]).filter(Boolean);
  if (hints.length === 0) return null;

  // Only generate hint if we know at least half the characters
  if (hints.length < Math.ceil(chars.length / 2)) return null;

  return hints.join(' + ');
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
  existingMappings?: Record<string, string>,
  customPrompt?: string,
  onProgress?: (done: number, total: number) => void,
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

  // Build custom prompt block (user-defined rules for variable name translation)
  const customPromptBlock = customPrompt?.trim()
    ? `\n\n═══ USER CUSTOM TRANSLATION RULES (HIGHEST PRIORITY) ═══\nThe user has provided custom instructions for how variable names should be translated. Follow these instructions ABOVE ALL other rules:\n${customPrompt.trim()}\n═══ END CUSTOM RULES ═══`
    : '';

  const systemPrompt = `Translate CJK (Chinese/Japanese/Korean) variable names to ${targetLang}. Do NOT translate English or ASCII names. Chinese proper nouns (names, places) → Sino-Vietnamese (Hán Việt). Japanese proper nouns → Romaji. Do NOT translate English. Keep consistency with MVU Schema.

You are a variable name translator for SillyTavern character cards.
Your job: translate variable names from the source language to ${targetLang}.

STRICT RULES:
1. Use natural, readable formatting with diacritics (e.g. Vietnamese: Độ Hảo Cảm, Sức Tấn Công). CONSISTENCY is the only formatting rule — same variable = identical string everywhere.
2. Keep the names SHORT but meaningful (2-4 words max).
3. Be CONSISTENT: similar concepts MUST have similar naming patterns.
   - All emotion/feeling variables should follow the same pattern (e.g. Mức X, Độ X)
   - All stat variables should follow the same pattern
4. If a key is already in Latin/ASCII or English, keep it AS IS. Do NOT translate English.
5. Chinese proper nouns (character names, places, dynasties) → Sino-Vietnamese (Hán Việt) reading. Examples: 清河→Thanh Hà, 慕容冲→Mộ Dung Xung, 洛阳→Lạc Dương.
6. Japanese proper nouns → Romaji transliteration (e.g. 田中→Tanaka, 桜→Sakura). Do NOT apply Sino-Vietnamese to Japanese names.
7. Western/Fantasy names transcribed into CJK (e.g. 维拉→Vera, 塞勒涅→Selene) → restore original Latin spelling.
   Follow user custom rules if provided (custom prompt overrides these defaults).
8. Keep numeric suffixes and prefixes intact (e.g. \"攻击力2\" → \"Sức Tấn Công 2\").
9. For Vietnamese specifically:
   - Use Title Case with diacritics: Hảo Cảm, Thể Lực, Trí Tuệ
   - Each word should be properly capitalized
   - Translate based on MEANING, not character-by-character. Examples:
     武力 = Võ Lực (martial force), 魅力 = Sức Hút (charm/charisma), 体力 = Thể Lực (stamina)
     描述 = Mô Tả (description), 说明 = Giải Thích (explanation)
10. The translated names must be covariant with the Zod Schema — matching the field structure and semantics.
11. COMPOUND ENUM VALUES: Some keys are compound enum values with structure like "Phase N_Name" (e.g. "阶段 1_静谧", "阶段 2_心动"). Translate the ENTIRE compound value as one unit: "阶段 1_静谧" → "Giai đoạn 1_Tĩnh lặng". Keep the separator character (underscore) and numbering intact. These values appear in z.enum([...]), .prefault('...'), .default('...'), and YAML values — they MUST all be the same translated string.
12. ██ UNIQUE TRANSLATIONS — ABSOLUTELY CRITICAL ██
   Every DIFFERENT source key MUST produce a DIFFERENT translated name. If two source keys have different Chinese characters, their translations MUST be different strings.
   FORBIDDEN: 武力 → "Võ Lực" AND 魅力 → "Võ Lực" (WRONG! Same translation for different keys!)
   CORRECT:   武力 → "Võ Lực" AND 魅力 → "Sức Hút" (Different translations for different keys)
   If you produce duplicate translations for different source keys, the card's variable system will CRASH because two different variables will share the same name.${modBlock}${customPromptBlock}

RESPOND in EXACT JSON format (no markdown): {"translations": {"original_key": "Translated Key", ...}}`;

  // ─── Batch chunking for large key sets ───
  const BATCH_SIZE = 25;
  const batches: string[][] = [];
  for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
    batches.push(keysToTranslate.slice(i, i + BATCH_SIZE));
  }

  // Report initial progress so the UI shows a bar immediately (0 of N)
  onProgress?.(0, keysToTranslate.length);
  let translatedSoFar = 0;

  for (const batch of batches) {
    if (signal?.aborted) break;

    let contextBlock = '';
    if (schemaContext && schemaContext.trim()) {
      contextBlock = `\nHere is the Zod schema or script context where these variables are defined. USE THIS CONTEXT to understand what the variables mean (look at the .describe() text or comments):\n\`\`\`javascript\n${schemaContext.slice(0, 5000)}\n\`\`\`\n\n`;
    }

    // Build covariance constraint block from existing + accumulated batch mappings
    // This ensures batch 2 knows what batch 1 already translated
    let covarianceBlock = '';
    const allConstraints = { ...(existingMappings || {}), ...result };
    if (Object.keys(allConstraints).length > 0) {
      const mappingLines = Object.entries(allConstraints)
        .filter(([k, v]) => k !== v)
        .slice(0, 80) // Increased limit to include batch results
        .map(([k, v]) => `  "${k}" → "${v}"`)
        .join('\n');
      if (mappingLines) {
        covarianceBlock = `\n═══ MANDATORY COVARIANCE CONSTRAINTS ═══\nThe following variables have ALREADY been translated. You MUST follow the same naming patterns and style for consistency. If any variable you are translating is semantically related to these, use the same conventions (e.g. same prefix, same word choice for shared concepts):\n${mappingLines}\n═══ END COVARIANCE CONSTRAINTS ═══\n\n`;
      }
    }

    // Build variable list with optional descriptions + auto CJK hints
    const varList = batch.map((k, i) => {
      const desc = keyDescriptions?.[k];
      if (desc) return `${i + 1}. "${k}" — ${desc}`;
      const hint = generateCjkHint(k);
      if (hint) return `${i + 1}. "${k}" — [char meaning: ${hint}]`;
      return `${i + 1}. "${k}"`;
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
          if (desc) return `${i + 1}. "${k}" — ${desc}`;
          const hint = generateCjkHint(k);
          if (hint) return `${i + 1}. "${k}" — [char meaning: ${hint}]`;
          return `${i + 1}. "${k}"`;
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
        const rotatedConfig = { ...proxy, temperature: retryTemperature };

        // Add per-request timeout protection
        const requestTimeout = (proxy as any).requestTimeout || 300000;
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort('MVU key translation timeout'), requestTimeout * 2);
        const fetchSignal = signal
          ? AbortSignal.any([signal, timeoutController.signal])
          : timeoutController.signal;

        const responseText = await callProvider(rotatedConfig, systemPrompt, currentUserPrompt, fetchSignal, undefined, {
          label: `Tên biến MVU (${currentBatchKeys.length} biến)`,
        });
        clearTimeout(timeoutId);

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

    // Report progress after each batch completes (success or exhausted retries)
    translatedSoFar += batch.length;
    onProgress?.(Math.min(translatedSoFar, keysToTranslate.length), keysToTranslate.length);
  } // end batch loop

  // ── POST-BATCH: Auto-dedup conflicting translations ──────────────────────
  // Detect cases where different source keys got the SAME translated name
  // (e.g. 武力 → "Võ Lực" AND 魅力 → "Võ Lực") and re-translate the conflicts.
  const translationToSources = new Map<string, string[]>();
  for (const [src, tgt] of Object.entries(result)) {
    if (src === tgt) continue; // skip identity mappings
    const existing = translationToSources.get(tgt);
    if (existing) {
      existing.push(src);
    } else {
      translationToSources.set(tgt, [src]);
    }
  }

  const conflictGroups = [...translationToSources.entries()]
    .filter(([, srcs]) => srcs.length > 1);

  if (conflictGroups.length > 0 && !signal?.aborted) {
    console.warn(
      `[MVU Sync] Detected ${conflictGroups.length} duplicate translation group(s). Re-translating conflicts...`
    );

    // Collect all conflicting source keys
    const conflictKeys: string[] = [];
    for (const [dupTranslation, srcKeys] of conflictGroups) {
      console.warn(`[MVU Sync] Conflict: ${srcKeys.map(k => `"${k}"`).join(' & ')} → "${dupTranslation}"`);
      conflictKeys.push(...srcKeys);
    }

    // Build a disambiguation prompt with explicit "these are DIFFERENT" instructions
    const disambiguationList = conflictGroups
      .map(([dup, srcs]) =>
        `  ⚠️ ${srcs.map(s => `"${s}"`).join(', ')} were ALL translated as "${dup}" — but they are DIFFERENT concepts! Give each a UNIQUE name.`
      )
      .join('\n');

    const dedupPrompt = `You previously translated these variable names, but MULTIPLE different source keys got the SAME translation. This is WRONG — it will cause variable collisions and crash the system.

CONFLICTS TO FIX:
${disambiguationList}

Translate these keys again. Each MUST have a UNIQUE, DIFFERENT translation. Pay attention to the actual MEANING of each Chinese character:
${conflictKeys.map((k, i) => {
  const desc = keyDescriptions?.[k];
  return desc ? `${i + 1}. "${k}" — ${desc}` : `${i + 1}. "${k}"`;
}).join('\n')}

IMPORTANT: Do NOT repeat the same translation for different keys. If unsure, use the .describe() context or character meaning to differentiate.`;

    try {
      const requestTimeout = (proxy as any).requestTimeout || 300000;
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort('Dedup retry timeout'), requestTimeout * 2);
      const fetchSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;

      const responseText = await callProvider(proxy, systemPrompt, dedupPrompt, fetchSignal);
      clearTimeout(timeoutId);

      const parsed = parseJsonFromAi(responseText);
      const fixedTranslations = parsed.translations || parsed;

      // Apply fixed translations — verify they are actually unique now
      const newValues = new Set<string>();
      let fixedCount = 0;
      for (const [k, v] of Object.entries(fixedTranslations)) {
        if (typeof v !== 'string' || !v.trim()) continue;
        const trimmed = v.trim();
        if (!newValues.has(trimmed)) {
          newValues.add(trimmed);
          result[k] = trimmed;
          fixedCount++;
        } else {
          // Still a duplicate — append source key hint to force uniqueness
          const disambiguated = `${trimmed} (${k})`;
          result[k] = disambiguated;
          fixedCount++;
          console.warn(`[MVU Sync] Still duplicate "${trimmed}" for "${k}" — appending hint: "${disambiguated}"`);
        }
      }
      console.log(`[MVU Sync] Dedup retry fixed ${fixedCount}/${conflictKeys.length} conflicting keys`);
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) throw err;
      console.error('[MVU Sync] Dedup retry failed:', err.message);
    }
  }

  return result;
}

/**
 * Gọi AI để giải quyết xung đột dịch thuật tên biến MVU.
 * Quét từ điển hiện tại để tìm các xung đột (các khóa CJK khác nhau cùng dịch sang 1 tên Latinh).
 * Gọi AI để dịch lại các khóa này với hướng dẫn chọn tên độc bản và đúng nghĩa nhất.
 */
export async function aiResolveMvuConflicts(
  mvuDictionary: Record<string, string>,
  targetLang: string,
  proxy: ProxySettings,
  signal?: AbortSignal,
  schemaContext?: string,
  keyDescriptions?: Record<string, string>
): Promise<{ fixedDict: Record<string, string>; fixedCount: number }> {
  const conflicts = validateDictionaryConflicts(mvuDictionary);
  if (conflicts.length === 0) {
    return { fixedDict: mvuDictionary, fixedCount: 0 };
  }

  // Gom các xung đột theo giá trị dịch bị trùng lặp
  const translationToSources = new Map<string, string[]>();
  for (const [src, tgt] of Object.entries(mvuDictionary)) {
    if (!tgt || src === tgt) continue;
    const normalized = tgt.toLowerCase().trim();
    if (!translationToSources.has(normalized)) {
      translationToSources.set(normalized, []);
    }
    translationToSources.get(normalized)!.push(src);
  }

  const conflictGroups = [...translationToSources.entries()]
    .filter(([, srcs]) => srcs.length > 1);

  if (conflictGroups.length === 0) {
    return { fixedDict: mvuDictionary, fixedCount: 0 };
  }

  const conflictKeys = Array.from(new Set(conflictGroups.flatMap(([, srcs]) => srcs)));
  const disambiguationList = conflictGroups
    .map(([dup, srcs]) => {
      const originalVal = mvuDictionary[srcs[0]]; // Lấy lại casing gốc trong từ điển
      return `  ⚠️ Các khóa: ${srcs.map(s => `"${s}"`).join(', ')} đều đang bị dịch trùng thành "${originalVal}" — Nhưng chúng mang ý nghĩa KHÁC NHAU! Hãy dịch mỗi khóa thành một tên duy nhất và phù hợp.`;
    })
    .join('\n');

  const systemPrompt = `Translate CJK (Chinese/Japanese/Korean) variable names to ${targetLang}. Do NOT translate English or ASCII names. Chinese proper nouns → Sino-Vietnamese (Hán Việt). Japanese proper nouns → Romaji. Keep consistency with MVU Schema.

You are a variable name translator for SillyTavern character cards.
Your job: translate variable names from the source language to ${targetLang}.

STRICT RULES:
1. Use natural, readable formatting with diacritics (e.g. Vietnamese: Độ Hảo Cảm, Sức Tấn Công). CONSISTENCY is the only formatting rule.
2. Keep the names SHORT but meaningful (2-4 words max).
3. If a key is already in Latin/ASCII or English, keep it AS IS.
4. Chinese proper nouns (names, places) → Sino-Vietnamese (Hán Việt). Japanese proper nouns → Romaji. Western/Fantasy names in CJK → restore original Latin spelling.
5. Every DIFFERENT source key MUST produce a DIFFERENT translated name.
6. Do NOT repeat the same translation. If you produce duplicate translations for different source keys, the system will crash.

RESPOND in EXACT JSON format: {"translations": {"original_key": "Translated Key", ...}}`;

  const contextBlock = schemaContext && schemaContext.trim()
    ? `\nHere is the Zod schema or script context for context:\n\`\`\`javascript\n${schemaContext.slice(0, 3000)}\n\`\`\`\n\n`
    : '';

  const userPrompt = `You previously translated these variable names, but MULTIPLE different source keys got the SAME translation. This is WRONG — it will cause variable collisions.

CONFLICTS TO FIX:
${disambiguationList}

Translate these keys again. Each MUST have a UNIQUE, DIFFERENT translation. Pay attention to the actual MEANING of each CJK character:
${conflictKeys.map((k, i) => {
  const desc = keyDescriptions?.[k];
  if (desc) return `${i + 1}. "${k}" — ${desc}`;
  const hint = generateCjkHint(k);
  if (hint) return `${i + 1}. "${k}" — [char meaning: ${hint}]`;
  return `${i + 1}. "${k}"`;
}).join('\n')}

IMPORTANT: Do NOT repeat the same translation for different keys. Resolve the conflicts and return unique, correct translations.`;

  try {
    const responseText = await callProvider(proxy, systemPrompt, userPrompt, signal);
    const parsed = parseJsonFromAi(responseText);
    const fixedTranslations = parsed.translations || parsed;

    const result = { ...mvuDictionary };
    const newValues = new Set<string>();
    
    // Thu thập toàn bộ giá trị không bị xung đột để tránh trùng lặp mới
    for (const [k, v] of Object.entries(result)) {
      if (!conflictKeys.includes(k) && v && v.trim()) {
        newValues.add(v.toLowerCase().trim());
      }
    }

    let fixedCount = 0;
    for (const [k, v] of Object.entries(fixedTranslations)) {
      if (typeof v !== 'string' || !v.trim() || !conflictKeys.includes(k)) continue;
      const trimmed = v.trim();
      const lowerTrimmed = trimmed.toLowerCase();
      if (!newValues.has(lowerTrimmed)) {
        newValues.add(lowerTrimmed);
        result[k] = trimmed;
        fixedCount++;
      } else {
        // Nếu AI vẫn trả về trùng, chèn thêm hậu tố để ép buộc độc bản
        const disambiguated = `${trimmed} (${k})`;
        result[k] = disambiguated;
        fixedCount++;
      }
    }

    return { fixedDict: result, fixedCount };
  } catch (err) {
    console.error('[MVU Sync] Failed to resolve MVU conflicts via AI:', err);
    throw err;
  }
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
        const requestTimeout = (proxy as any).requestTimeout || 300000;
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort('MVU rename timeout'), requestTimeout * 2);
        const fetchSignal = signal
          ? AbortSignal.any([signal, timeoutController.signal])
          : timeoutController.signal;

        const responseText = await callProvider(proxy, systemPrompt, userPrompt, fetchSignal);
        clearTimeout(timeoutId);

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
   - For Vietnamese (${targetLang}), use Sino-Vietnamese reading for Chinese proper nouns only (e.g. 李明 -> Lý Minh, 长安 -> Trường An). All descriptive text → natural modern Vietnamese.
3. Keep the list concise (max 15-20 most important terms).
4. Output EXACT JSON format: {"glossary": {"Source Term": "Translated Term"}}
5. DO NOT wrap the JSON in markdown blocks like \`\`\`json. Just output the raw JSON string.`;

  const userPrompt = `Extract and translate terminology to ${targetLang} from the following text:\n\n${context}`;

  try {
    // Add per-request timeout protection
    const requestTimeout = (proxy as any).requestTimeout || 300000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort('Glossary extraction timeout'), requestTimeout * 2);
    const fetchSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    const responseText = await callProvider(proxy, systemPrompt, userPrompt, fetchSignal);
    clearTimeout(timeoutId);

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
 * Fix broken lodash/utility paths that were split across lines during AI translation.
 * 
 * After AI translation, string paths inside _.get(), _.set(), _.has(), etc. often get
 * broken across multiple lines with extra whitespace. For example:
 *   _.get(data, 'stat_data['\n  Bản Tôn.Xuân Thu  ']')
 * This function normalizes them back to clean single-line strings.
 * 
 * Also fixes getvar/setvar paths with similar line-break corruption.
 */
export function fixBrokenLodashPaths(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // ═══ Phase 1: Fix multi-line string arguments in _.get/_.set/_.has/_.result/_.pick/_.omit ═══
  // Match: _.get(anything, 'broken\n  path\n  here')  or  _.get(anything, "broken\n  path")
  // The key insight: the string argument should never contain actual newlines.
  const lodashFuncPattern = /(_\.(?:get|set|has|result|pick|omit)\s*\(\s*[^,]+,\s*)(['"])([\s\S]*?)\2/g;
  result = result.replace(lodashFuncPattern, (_match, prefix: string, quote: string, pathContent: string) => {
    // Check if the path content contains line breaks or excessive whitespace
    if (/[\n\r]/.test(pathContent) || /\s{2,}/.test(pathContent)) {
      // Normalize: collapse all whitespace sequences (including newlines) to single spaces, then trim
      const cleaned = pathContent
        .replace(/[\n\r]+/g, '') // Remove newlines
        .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
        .replace(/\[\s+/g, '[')  // Fix '[ ' → '['
        .replace(/\s+\]/g, ']')  // Fix ' ]' → ']'
        .trim();
      return `${prefix}${quote}${cleaned}${quote}`;
    }
    return _match;
  });

  // ═══ Phase 2: Fix multi-line array path arguments in _.get(obj, ['Key1', 'Key2']) ═══
  const lodashArrPattern = /(_\.(?:get|set|has|result)\s*\(\s*[^,]+,\s*)\[([\s\S]*?)\]/g;
  result = result.replace(lodashArrPattern, (_match, prefix: string, arrContent: string) => {
    if (/[\n\r]/.test(arrContent)) {
      // Normalize array elements: collapse newlines, trim each element
      const cleaned = arrContent
        .replace(/[\n\r]+/g, '') // Remove newlines
        .replace(/\s{2,}/g, ' ') // Collapse spaces
        .trim();
      return `${prefix}[${cleaned}]`;
    }
    return _match;
  });

  // ═══ Phase 3: Fix getvar/setvar paths with line breaks ═══
  const getsetvarPattern = /((?:getvar|setvar|addvar|getglobalvar|setglobalvar)\s*\(\s*)(['"])([\s\S]*?)\2/g;
  result = result.replace(getsetvarPattern, (_match, prefix: string, quote: string, pathContent: string) => {
    if (/[\n\r]/.test(pathContent) || /\s{2,}/.test(pathContent)) {
      const cleaned = pathContent
        .replace(/[\n\r]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\[\s+/g, '[')
        .replace(/\s+\]/g, ']')
        .trim();
      return `${prefix}${quote}${cleaned}${quote}`;
    }
    return _match;
  });

  return result;
}

/**
 * Convert dot-delimited paths with spaces/diacritics to bracket notation.
 * 
 * When translated keys contain spaces (e.g. "Bản Tôn" instead of "本尊"),
 * using dot notation in _.get(obj, 'stat_data.Bản Tôn.Xuân Thu') will fail
 * because lodash interprets dots as path separators — and 'Bản Tôn' has a
 * space which makes it an invalid JS identifier.
 * 
 * This function converts such paths to bracket notation:
 *   _.get(obj, 'stat_data.Bản Tôn.Xuân Thu')
 *   → _.get(obj, "stat_data['Bản Tôn']['Xuân Thu']")
 * 
 * Or to array path syntax:
 *   _.get(obj, ['stat_data', 'Bản Tôn', 'Xuân Thu'])
 */
export function fixDotNotationPaths(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // ═══ Fix _.get/_.set/_.has/_.result with dot-delimited string paths ═══
  // Pattern: _.get(obj, 'segment1.segment2.segment3')
  // If any segment contains spaces or diacritics, convert to array path
  const lodashDotPathPattern = /(_\.(?:get|set|has|result|pick|omit)\s*\(\s*[^,]+,\s*)(['"])([^'"]+)\2(\s*(?:,\s*[^)]+)?\s*\))/g;
  
  result = result.replace(lodashDotPathPattern, (_match, prefix: string, quote: string, path: string, suffix: string) => {
    // Only process if it's a dotted path (has at least one dot)
    if (!path.includes('.')) return _match;

    const segments = path.split('.');
    
    // Check if any segment has spaces or diacritics that would cause path parsing issues
    const hasProblematicSegment = segments.some(seg => 
      /\s/.test(seg) || /[À-ỹĐđ]/.test(seg)
    );
    
    if (!hasProblematicSegment) return _match; // No problem, leave as-is

    // Convert to array path: _.get(obj, ['seg1', 'seg2', 'seg3'])
    const arrayPath = segments.map(seg => `'${seg.replace(/'/g, "\\'")}'`).join(', ');
    return `${prefix}[${arrayPath}]${suffix}`;
  });

  // ═══ Fix direct bracket-in-string patterns caused by AI confusion ═══
  // Pattern: _.get(data, 'stat_data['Bản Tôn']['Xuân Thu']')
  // This is syntactically broken — the AI tried bracket notation inside a string literal.
  // Fix: convert to proper array path syntax
  const brokenBracketInStringPattern = /(_\.(?:get|set|has|result)\s*\(\s*[^,]+,\s*)(['"])([^'"]*?\[['"]\s*[\s\S]*?['"]\s*\][\s\S]*?)\2/g;
  result = result.replace(brokenBracketInStringPattern, (_match, prefix: string, _quote: string, pathContent: string) => {
    // Extract all bracket segments: ['Key1']['Key2']
    const bracketPattern = /\['([^']*?)'\]|\["([^"]*?)"\]/g;
    const segments: string[] = [];
    let bm;

    // First, check for a prefix before the first bracket (e.g., "stat_data")
    const firstBracketIdx = pathContent.indexOf('[');
    if (firstBracketIdx > 0) {
      const prefix_seg = pathContent.slice(0, firstBracketIdx).trim();
      if (prefix_seg) {
        // Split prefix by dots (e.g., "stat_data")
        for (const s of prefix_seg.split('.')) {
          if (s.trim()) segments.push(s.trim());
        }
      }
    }

    while ((bm = bracketPattern.exec(pathContent)) !== null) {
      const seg = (bm[1] || bm[2] || '').trim();
      if (seg) segments.push(seg);
    }

    if (segments.length >= 2) {
      const arrayPath = segments.map(seg => `'${seg.replace(/'/g, "\\'")}'`).join(', ');
      return `${prefix}[${arrayPath}]`;
    }

    return _match;
  });

  return result;
}

/**
 * Fix broken optional chaining patterns where translated multi-word identifiers
 * were not converted to bracket notation.
 * 
 * e.g. wd['Thời Thế']?.Tiêu Đề  → wd['Thời Thế']?.['Tiêu Đề']
 * 
 * This is a safety net for cases where the surgical translation engine
 * failed to detect the dot notation context (e.g. CJK char before ?.).
 */
export function fixBrokenOptionalChaining(text: string): string {
  if (!text || typeof text !== 'string') return text;

  // Pattern: ?. followed by a multi-word Vietnamese/diacritics identifier
  // that is NOT already in bracket notation ['...']
  // Match context: ?.WordA WordB (followed by typical JS terminators)
  // The identifier must:
  //   - Start with a letter (including Vietnamese diacritics)
  //   - Contain at least one space (making it invalid for dot notation)
  //   - End before a JS operator/delimiter
  return text.replace(
    /\?\.\s*([A-ZÀ-Ỹa-zà-ỹĐđ][A-ZÀ-Ỹa-zà-ỹĐđ\w]*(?:\s+[A-ZÀ-Ỹa-zà-ỹĐđ][A-ZÀ-Ỹa-zà-ỹĐđ\w]*)+)(?=\s*[|&)?\]:;,}\n\r]|\s*$|\s*\|\|)/g,
    (_match, prop: string) => {
      return `?.['${prop.trim()}']`;
    }
  );
}

/**
 * Chuẩn hoá dấu nháy "thông minh"/toàn rộng (smart / full-width quotes) về dấu nháy
 * thẳng ASCII bên trong MÃ NGUỒN. Các model AI (nhất là model train nhiều tiếng Trung)
 * hay xuất ra “ ” ‘ ’ ＂ ＇ thay cho " và ' — làm vỡ chuỗi JS, thuộc tính HTML và regex,
 * khiến script regex không chạy được (đây chính là "lỗi dấu" mà người dùng phải ngồi sửa tay).
 *
 * Phạm vi xử lý thận trọng để KHÔNG đụng tới dấu nháy trong văn bản hiển thị:
 * - Với nội dung HTML: chỉ chuẩn hoá bên trong khối <script>/<style> và bên trong thẻ
 *   (attribute), giữ nguyên dấu nháy ở phần chữ hiển thị cho người đọc.
 * - Với mã thuần (JS / regex / Zod schema, không có thẻ HTML): chuẩn hoá toàn bộ.
 */
export function normalizeSmartQuotesInCode(code: string): string {
  if (!code || typeof code !== 'string') return code;

  const swap = (s: string): string =>
    s
      // “ ” ‟ ″ 〃 ＂ → "
      .replace(/[“”‟″〃＂]/g, '"')
      // ‘ ’ ‛ ′ ＇ → '
      .replace(/[‘’‛′＇]/g, "'");

  const looksLikeHtml = /<[a-z!/][^>]*>/i.test(code);
  if (!looksLikeHtml) {
    // Mã thuần — an toàn chuẩn hoá toàn bộ.
    return swap(code);
  }

  let result = code;
  // 1. Khối <script>…</script> và <style>…</style> (JS/CSS bắt buộc dùng dấu nháy thẳng)
  result = result.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_m, open: string, _tag: string, body: string, close: string) => swap(open) + swap(body) + close
  );
  // 2. Phần đánh dấu thẻ còn lại `<...>` (dấu nháy của attribute) — chừa lại chữ hiển thị
  result = result.replace(/<[a-z!/][^>]*>/gi, (tag) => swap(tag));
  return result;
}

/**
 * Hậu xử lý HTML trong regex replaceString sau khi dịch:
 * 1. Chuẩn hoá dấu nháy thông minh/toàn rộng → dấu nháy thẳng trong mã (tránh vỡ regex/JS)
 * 2. Thay font chữ Trung/Nhật → font tương thích tiếng Việt
 * 3. Sửa đường dẫn _.get() bị ngắt dòng hoặc dùng dot notation sai cú pháp
 * 4. Sửa optional chaining bị lỗi bracket notation
 */
export function postProcessRegexHtml(html: string): string {
  if (!html || typeof html !== 'string') return html;

  let result = html;

  // Chuẩn hoá dấu nháy thông minh/toàn rộng → dấu nháy thẳng (sửa "lỗi dấu" làm hỏng regex)
  result = normalizeSmartQuotesInCode(result);

  // Thay font Trung/Nhật → font Việt
  for (const [pattern, replacement] of CHINESE_FONT_MAP) {
    result = result.replace(pattern, replacement);
  }

  // Sửa đường dẫn _.get/_.set bị ngắt dòng
  result = fixBrokenLodashPaths(result);

  // Chuyển dot notation có khoảng trắng sang bracket notation
  result = fixDotNotationPaths(result);

  // Sửa optional chaining bị lỗi: ?.Tiêu Đề → ?.['Tiêu Đề']
  result = fixBrokenOptionalChaining(result);

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

    // ═══ PHASE A: Extract Zod field name mappings ═══
    const len = Math.min(origBlocks.length, transBlocks.length);
    for (let bIdx = 0; bIdx < len; bIdx++) {
      try {
        const origFields = parseZodFields(origBlocks[bIdx]);
        const transFields = parseZodFields(transBlocks[bIdx]);

        // Strategy 1: Position-based mapping (when field counts match)
        if (origFields.length === transFields.length) {
          for (let fIdx = 0; fIdx < origFields.length; fIdx++) {
            const origF = origFields[fIdx];
            const transF = transFields[fIdx];
            if (origF.name && transF.name && origF.name !== transF.name) {
              mapping[origF.name] = transF.name;
            }
          }
        }

        // Strategy 2: Type-chain matching fallback
        // When AI reorders fields or counts differ, match by Zod type signature
        // e.g. origField "好感度: z.number().min(0).max(100)" matches
        //      transField "Hảo Cảm: z.number().min(0).max(100)" by type chain
        const unmappedOrig = origFields.filter(f => f.name && !(f.name in mapping));
        const unmappedTrans = transFields.filter(f => {
          const isAlreadyMapped = Object.values(mapping).includes(f.name);
          return f.name && !isAlreadyMapped;
        });

        if (unmappedOrig.length > 0 && unmappedTrans.length > 0) {
          // Build type signature for matching: "type|optional|nullable|enumCount"
          const getTypeSignature = (f: { type: string; isOptional?: boolean; isNullable?: boolean; constraints?: any }) => {
            const parts = [f.type];
            if (f.isOptional) parts.push('opt');
            if (f.isNullable) parts.push('null');
            if (f.constraints?.enumValues) parts.push(`enum${f.constraints.enumValues.length}`);
            if (f.constraints?.min !== undefined) parts.push(`min${f.constraints.min}`);
            if (f.constraints?.max !== undefined) parts.push(`max${f.constraints.max}`);
            return parts.join('|');
          };

          const usedTrans = new Set<number>();
          for (const origF of unmappedOrig) {
            const origSig = getTypeSignature(origF);
            for (let tIdx = 0; tIdx < unmappedTrans.length; tIdx++) {
              if (usedTrans.has(tIdx)) continue;
              const transF = unmappedTrans[tIdx];
              if (getTypeSignature(transF) === origSig && origF.name !== transF.name) {
                mapping[origF.name] = transF.name;
                usedTrans.add(tIdx);
                break;
              }
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

/**
 * Normalize and clean up double-single quotes (''KEY'':) in YAML text.
 */
export function cleanYamlQuotes(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  // Fix double single quotes around keys: ''KEY'': -> 'KEY':
  result = result.replace(/^(\s*)''([^'\n]+)''(\s*:)/gm, "$1'$2'$3");
  // Fix double single quotes around values: : ''VALUE'' -> : 'VALUE'
  result = result.replace(/(:\s*)''([^'\n]+)''(\s*)$/gm, "$1'$2'$3");
  return result;
}

/**
 * Helper to extract keys from Zod schema text.
 */
function extractKeysFromSchema(schemaText: string): string[] {
  const keys: string[] = [];
  try {
    const cleanSchema = fixZodSyntaxErrors(schemaText);
    const blocks = extractZodObjectBlocks(cleanSchema);
    const collectKeys = (fields: ZodFieldDef[]) => {
      for (const field of fields) {
        if (field.name) {
          keys.push(field.name);
        }
        if (field.children) {
          collectKeys(field.children);
        }
      }
    };
    for (const block of blocks) {
      const fields = parseZodFields(block);
      collectKeys(fields);
    }
  } catch (e) {
    console.error('Error extracting keys from schema:', e);
  }
  return Array.from(new Set(keys));
}

/**
 * Fix common Zod syntax errors in AI-generated schema scripts.
 */
export function fixZodSyntaxErrors(scriptContent: string): string {
  if (!scriptContent || typeof scriptContent !== 'string') {
    return scriptContent;
  }

  let fixed = scriptContent;

  // 1. Fix missing () for z.string, z.number, z.boolean
  fixed = fixed.replace(/\bz\.(string|number|boolean)(?!\s*\()/g, 'z.$1()');

  // 2. Fix missing () for safeString
  fixed = fixed.replace(/\bsafeString(?!\s*[\(=])/g, 'safeString()');

  // 3. Fix missing () for .prefault and .default
  // Case A: .prefault 'value' or .prefault "value" -> .prefault('value')
  fixed = fixed.replace(/\.(prefault|default)\s*(['"`])(.*?)\2/g, '.$1($2$3$2)');

  // Case B: .prefault 123 or .prefault true -> .prefault(123)
  fixed = fixed.replace(/\.(prefault|default)\s*(\d+|true|false)\b/g, '.$1($2)');

  // Case C: Any leftover .prefault or .default without () -> .prefault()
  fixed = fixed.replace(/\.(prefault|default)(?!\s*\()/g, '.$1()');

  return fixed;
}

/**
 * Force initvar YAML keys to match exactly the keys in the translated Zod schema.
 */
export function enforceSchemaAuthoritative(
  initvarText: string,
  translatedSchemaContent: string
): string {
  if (!initvarText || !translatedSchemaContent) return initvarText;

  const schemaKeys = extractKeysFromSchema(translatedSchemaContent);
  if (schemaKeys.length === 0) return initvarText;

  // Normalization helper for matching
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '').trim();
  const schemaKeysLower = schemaKeys.map(k => normalize(k));

  let result = cleanYamlQuotes(initvarText);
  const lines = result.split('\n');

  for (const line of lines) {
    const yamlMatch = line.match(/^(\s*)(?:["']+|['"]{2,})?([^"':\n]+?)(?:["']+|['"]{2,})?\s*:/);
    if (!yamlMatch) continue;

    const yamlKey = yamlMatch[2]?.trim();
    if (!yamlKey) continue;

    // Check if the key exists exactly in schemaKeys
    if (schemaKeys.includes(yamlKey)) continue;

    // Try to find the closest match in schemaKeys
    const normalizedKey = normalize(yamlKey);
    let bestMatch: string | null = null;
    
    // Pass 1: exact match after normalization
    const exactIndex = schemaKeysLower.indexOf(normalizedKey);
    if (exactIndex !== -1) {
      bestMatch = schemaKeys[exactIndex];
    }

    // Skip protected CSS/JS keywords — these must NEVER be fuzzy-matched
    if (PROTECTED_CODE_KEYWORDS.has(yamlKey) || PROTECTED_CODE_KEYWORDS.has(normalizedKey)) continue;

    // Pass 2: Substring matching (skip very short keys to avoid false positives)
    if (!bestMatch && normalizedKey.length > 3) {
      for (const sk of schemaKeys) {
        const normalizedSk = normalize(sk);
        if (normalizedSk.length <= 3) continue; // Skip short schema keys for substring match
        if (normalizedKey.includes(normalizedSk) || normalizedSk.includes(normalizedKey)) {
          const ratio = Math.min(normalizedKey.length, normalizedSk.length) /
                        Math.max(normalizedKey.length, normalizedSk.length);
          if (ratio > 0.85) {
            bestMatch = sk;
            break;
          }
        }
      }
    }

    // Pass 3: Levenshtein distance fallback with STRICT PROPORTIONAL threshold
    // Short strings (≤ 6 chars): max distance 1 to avoid false positives with Vietnamese diacritics
    // Medium strings (7-10 chars): max distance 2
    // Long strings (≥ 11 chars): max distance 3
    if (!bestMatch) {
      let bestDist = Infinity;
      for (const sk of schemaKeys) {
        const normalizedSk = normalize(sk);
        const dist = levenshteinDistance(normalizedKey, normalizedSk);
        const maxLen = Math.max(normalizedKey.length, normalizedSk.length);
        const maxDist = maxLen <= 6 ? 1 : maxLen <= 10 ? 2 : 3;
        if (dist <= maxDist && dist < bestDist) {
          bestDist = dist;
          bestMatch = sk;
        }
      }
    }

    // If we found a best match, replace the key in the YAML content
    if (bestMatch && bestMatch !== yamlKey) {
      const escaped = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyRegex = new RegExp(
        `^(\\s*)(["']+|['"]{2,})?${escaped}(["']+|['"]{2,})?(\\s*:)`,
        'gm'
      );
      const safeReplacement = bestMatch.replace(/\$/g, '$$$$');
      result = result.replace(keyRegex, `$1$2${safeReplacement}$3$4`);
    }
  }

  return result;
}
