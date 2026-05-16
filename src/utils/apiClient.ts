import type { AIProvider, ProxySettings, GlossaryEntry, CharacterBookEntry } from '../types/card';
import {
  buildMasterSystemPrompt,
  extractTranslationFromResponse,
  fieldGroupToFieldType,
  type TranslationFieldType,
  type MasterPromptOptions,
} from './masterPrompt';
import { LOREBOOK_GENERATION_PROMPT } from './promptBuilder';

/* ─── Error types ─── */
export class ApiError extends Error {
  statusCode?: number;
  retryable: boolean;
  isCorsError?: boolean;

  constructor(message: string, statusCode?: number, retryable: boolean = false) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/* ─── CORS Proxy URL Rewriting ─── */

/** Known provider proxy paths (must match vite.config.ts proxy entries) */
const PROXY_ROUTES: Record<string, string> = {
  'https://api.openai.com':                        '/api-proxy/openai',
  'https://api.anthropic.com':                     '/api-proxy/anthropic',
  'https://generativelanguage.googleapis.com':      '/api-proxy/google',
};

/** Base64url-encode a string (URL-safe, no padding) */
function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Rewrite a URL to go through the Vite dev-server CORS proxy.
 * - Known providers (OpenAI, Anthropic, Google) → /api-proxy/<provider>/path
 * - Custom/unknown URLs → /api-proxy/custom/<base64url(origin)>/path
 * - localhost / 127.0.0.1 URLs → returned as-is (no CORS issue)
 */
function corsProxyUrl(originalUrl: string, useCorsProxy: boolean): string {
  if (!useCorsProxy) return originalUrl;

  // Don't proxy localhost — no CORS issues there
  try {
    const u = new URL(originalUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') {
      return originalUrl;
    }
  } catch {
    return originalUrl;
  }

  // Check known providers
  for (const [origin, proxyPath] of Object.entries(PROXY_ROUTES)) {
    if (originalUrl.startsWith(origin)) {
      return proxyPath + originalUrl.slice(origin.length);
    }
  }

  // Generic proxy for unknown URLs
  try {
    const u = new URL(originalUrl);
    const origin = u.origin;
    const rest = u.pathname + u.search;
    return `/api-proxy/custom/${toBase64Url(origin)}${rest}`;
  } catch {
    return originalUrl;
  }
}

/**
 * Detect if a fetch error is a CORS error and wrap it with a helpful message.
 */
function wrapCorsError(err: unknown, url: string, useCorsProxy: boolean): Error {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
      const corsErr = new ApiError(
        useCorsProxy
          ? `Network error calling ${url}. The CORS proxy is enabled but the Vite dev server may not be running. Run 'npm run dev' first.`
          : `Network/CORS error calling ${url}. Enable the built-in CORS Proxy in API settings to fix this.`,
        0,
        true
      );
      corsErr.isCorsError = true;
      return corsErr;
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

/* ─── Default prompt template ─── */
/**
 * Legacy prompt generator — used when expertMode is OFF or as fallback.
 * When expertMode is ON, buildMasterSystemPrompt() from masterPrompt.ts is used instead.
 */
export function getDefaultTranslationPrompt(sourceLang: string, targetLang: string): string {
  const sourceInfo = sourceLang && sourceLang !== 'auto'
    ? `You are translating FROM ${sourceLang} TO ${targetLang}.`
    : `You are translating content to ${targetLang}.`;

  const vietnameseRules = targetLang.toLowerCase().includes('việt') || targetLang.toLowerCase().includes('vietnamese')
    ? `\n15. VIETNAMESE SPECIFIC RULES:
    - Translate Chinese names (characters, places, martial arts, etc.) into Hán Việt (Sino-Vietnamese) instead of Pinyin or raw English.
    - For Japanese proper nouns (names, places), use standard Romaji transliteration (e.g. 田中 → Tanaka, 桜 → Sakura). Do NOT apply Hán Việt to Japanese names.
    - Use natural roleplay pronouns (e.g., tôi/bạn, anh/em, hắn/nàng/y) suitable for the context, avoiding rigid direct translation of pronouns (like 'ngươi/ta' unless it's a historical setting).
    - Ensure a smooth, natural literary flow (văn phong mượt mà) suitable for fiction/roleplay. Avoid word-by-word literal translation.`
    : '';

  return `You are a professional translator specializing in translating to ${targetLang}.
You are translating content from a SillyTavern AI character card (roleplay fiction).
${sourceInfo}

STRICT RULES:
1. Return ONLY the translated text. Do NOT include the original text, do NOT show "original → translation" pairs, no explanations, no markdown wrapping.
2. Preserve ALL formatting: HTML tags, markdown, newlines (\\n), special characters.
3. Preserve ALL placeholders: {{char}}, {{user}}, {{original}}, <|im_start|>, <START>, etc.
4. Preserve ALL code blocks, regex patterns, JSON structures inside the text.
5. Keep proper nouns (character names, place names) consistent throughout.
6. For lorebook keys (keywords): translate naturally but keep them short and comma-separated.
7. Maintain the same tone and style of the original text.
8. DO NOT translate text that is already in ${targetLang} (leave it exactly as is).
9. FORMATTING RULES for structured text:
   - If text uses YAML-like structure (lines with "key:" format), keep underscores ONLY in the KEY part (before the colon). The VALUE part (after the colon) is normal text — do NOT add underscores.
   - XML/HTML tag names and attributes: Keep exactly as-is (e.g., <Sabercharacter>, <user_setting>).
   - Regular prose/narrative text: Write naturally WITHOUT underscores. Underscores are NOT needed in flowing text or dialogue.
   - Variable placeholders like {{char}}, {{user}}, {{random}}: Keep exactly as-is, do NOT translate.
   - Text inside angle brackets like <角色名>, <设定>: Keep the bracket structure, translate the content inside.
10. Maintain consistent terminology. If you translate a term one way, use that same translation throughout.
11. PROPER NOUN TRANSLITERATION RULES:
    - Chinese proper nouns (names, places, titles) → Hán Việt / Sino-Vietnamese reading (e.g. 李明 → Lý Minh). Do NOT use Pinyin.
    - Japanese proper nouns (names, places) → standard Romaji transliteration (e.g. 田中 → Tanaka, 桜 → Sakura). Do NOT apply Hán Việt to Japanese names.
    - Keep honorifics as-is or map to Vietnamese equivalents based on context (-san, -chan, -sama).
12. CRITICAL: The output must contain ONLY the translated text in ${targetLang}. Do NOT include source language text. Do NOT pair original text with translation. Do NOT use arrows (→) or colons (:) to show before/after.
13. CRITICAL: You MUST translate the COMPLETE text. Do NOT stop early. Do NOT summarize or truncate. If the text is very long, translate ALL of it from start to finish.
14. CRITICAL: ABSOLUTELY NO untranslated source language characters (e.g., Chinese Hanzi, Japanese Kanji) should remain in the final output. You MUST translate every single word into ${targetLang} unless it is a specific system variable name (like {{char}}). This includes: section headers, YAML-like key names, parenthetical annotations, labels, category names, and text inside XML tags. After translating, scan your ENTIRE output for any remaining Chinese characters — if you find ANY, translate them immediately.
15. LOREBOOK SPECIFIC: Lorebook entries commonly have Chinese text that gets missed during translation. You MUST translate ALL of these: Chinese section headers (e.g., "人物设定："), Chinese YAML keys (e.g., "外貌:"), Chinese annotations in parentheses (e.g., "(可爱的)"), Chinese text inside XML tags (e.g., <tag>中文内容</tag>), and any Chinese text mixed with already-translated Vietnamese text. The final output must have ZERO Chinese characters.${vietnameseRules}`;
}

/**
 * Build the system prompt using the Master Prompt engine when expertMode is ON,
 * or fallback to the legacy prompt when OFF.
 */
export function buildSystemPromptForField(
  config: ProxySettings,
  fieldType: TranslationFieldType,
  sourceLang: string,
  targetLang: string,
  customPrompt?: string,
  glossary?: GlossaryEntry[],
  mvuDictionary?: Record<string, string>,
): string {
  if (config.expertMode) {
    return buildMasterSystemPrompt({
      fieldType,
      sourceLang,
      targetLang,
      enableThoughtProcess: true,
      mvuDictionary,
      glossary,
      customPromptSuffix: customPrompt?.trim() || undefined,
    });
  }

  // Legacy mode: use getDefaultTranslationPrompt + manual layering
  const basePrompt = customPrompt && customPrompt.trim()
    ? customPrompt
    : getDefaultTranslationPrompt(sourceLang, targetLang);
  return basePrompt;
}

// Re-export for external use
export { fieldGroupToFieldType, type TranslationFieldType } from './masterPrompt';

/* ─── Build messages for translation ─── */
function buildTranslationMessages(
  text: string,
  fieldName: string,
  targetLang: string,
  systemPromptPrefix: string,
  sourceLang: string,
  customPrompt?: string,
  customSchema?: string,
  contextHint?: string,
  glossary?: GlossaryEntry[],
  previousTranslationContext?: string,
  previousTranslationToUpdate?: string,
  /** Field type for Master Prompt selection (expert mode) */
  fieldType?: TranslationFieldType,
  /** Expert mode: use Master Prompt with thought process */
  expertMode?: boolean,
  /** MVU dictionary for variable sync */
  mvuDictionary?: Record<string, string>,
) {
  const isStandaloneMod = customPrompt?.includes('[CRITICAL: STANDALONE MODIFICATION & REWRITE MODE]');

  if (isStandaloneMod) {
    let systemPrompt = customPrompt!;
    if (systemPromptPrefix?.trim()) {
      systemPrompt = systemPromptPrefix.trim() + '\n\n' + systemPrompt;
    }
    
    // Inject schema manually if provided, since we bypass both Master Prompt and Legacy Prompt builders
    if (customSchema && !systemPrompt.includes('CARD SCHEMA / VARIABLE DEFINITIONS')) {
      systemPrompt += `\n\n[USER PROVIDED ZOD/JSON SCHEMA — STRICT COMPLIANCE REQUIRED]\n${customSchema}`;
    }

    let previousContextMsg = '';
    if (previousTranslationContext) {
      previousContextMsg = `\n\n[CHUNK CONTINUITY — Bạn đang chỉnh sửa một phần của văn bản lớn được cắt nhỏ (chunks).
${previousTranslationContext}
CHUNK RULES:
- CHỈNH SỬA TẤT CẢ nội dung trong chunk hiện tại — dù câu/đoạn có vẻ bị cắt ngang ở đầu/cuối.
- GIỮ SỰ NHẤT QUÁN về thuật ngữ, xưng hô và văn phong từ phần trước.
- KHÔNG lặp lại hoặc dịch lại bất kỳ văn bản nào từ chunk trước.
- BẢO TOÀN CODE: Giữ nguyên tất cả code (HTML, EJS <% %>, template literals \`...\`, JS/CSS, regex, macros {{char}}).
- Nếu một code block bị cắt ngang (ví dụ <script> chưa đóng, template literal chưa kết thúc), BẢO TOÀN NGUYÊN VẸN phần code bị cắt đó — KHÔNG cố gắng "sửa" hoặc đóng tag.]`;
    }

    const userMsg = `Thực hiện chỉnh sửa nội dung (MOD) cho field "${fieldName}". Chỉ trả về nội dung đã chỉnh sửa, KHÔNG trả về giải thích hay markdown code blocks thừa. Bắt buộc xử lý TOÀN BỘ đoạn văn bản bên dưới, KHÔNG được bỏ sót dù câu/đoạn có vẻ chưa hoàn chỉnh do cắt chunk.${previousContextMsg}\n\n${text}`;
    
    return { system: systemPrompt, user: userMsg };
  }

  let systemPrompt: string;

  if (expertMode && fieldType) {
    // ═══ EXPERT MODE: Use Master System Prompt ═══
    // Schema and glossary are baked into the master prompt via layers 5 & 6
    // RAG context is injected as Layer 8 via ragContextBlock
    
    // Split customPrompt: RAG context goes to Layer 8, rest to suffix
    let ragBlock: string | undefined;
    let promptSuffix: string | undefined;
    if (customPrompt?.trim()) {
      // If customPrompt contains RAG sections (from promptBuilder.ts), route to Layer 8
      const hasRAGContext = customPrompt.includes('═══ CROSS-FIELD') || 
                           customPrompt.includes('═══ MANDATORY TERMINOLOGY') ||
                           customPrompt.includes('═══ MVU/ZOD') ||
                           customPrompt.includes('═══ CARD SCHEMA');
      if (hasRAGContext) {
        ragBlock = customPrompt;
      } else {
        promptSuffix = customPrompt;
      }
    }

    systemPrompt = buildMasterSystemPrompt({
      fieldType,
      sourceLang,
      targetLang,
      enableThoughtProcess: true,
      mvuDictionary,
      glossary,
      customPromptSuffix: promptSuffix,
      ragContextBlock: ragBlock,
    });

    // Schema is injected via RAG context or Layer 8 — add separately if provided and not already in RAG
    if (customSchema && !ragBlock) {
      systemPrompt += `\n\nCARD SCHEMA / VARIABLE DEFINITIONS:\n${customSchema}`;
    }

    // Prepend user's system prompt prefix if any
    if (systemPromptPrefix?.trim()) {
      systemPrompt = systemPromptPrefix.trim() + '\n\n' + systemPrompt;
    }
  } else {
    // ═══ LEGACY MODE: Original prompt construction ═══
    const schemaInstructions = customSchema
      ? `\n\nCARD SCHEMA / GLOSSARY:\nHere is the schema or variable definitions for this character. Please mentally translate these variables into the target language to establish a consistent vocabulary, and apply this vocabulary strictly when translating the text below. Maintain any variable names, JSON keys, or special formats:\n${customSchema}\n`
      : '';

    let glossaryInstructions = '';
    if (glossary && glossary.length > 0) {
      const terms = glossary
        .filter(g => g.source.trim() && g.target.trim())
        .map(g => `  "${g.source}" → "${g.target}"`)
        .join('\n');
      if (terms) {
        glossaryInstructions = `\n\nMANDATORY TERMINOLOGY (use these translations exactly, no exceptions):\n${terms}\n`;
      }
    }

    const basePrompt = customPrompt && customPrompt.trim()
      ? customPrompt
      : getDefaultTranslationPrompt(sourceLang, targetLang);

    const isVietnamese = targetLang.toLowerCase().includes('việt') || targetLang.toLowerCase().includes('vietnamese');
    const vietnameseSafetyRule = isVietnamese 
      ? `\n    - VIETNAMESE SPECIFIC: Translate names into Hán Việt (Sino-Vietnamese). Use natural roleplay pronouns. Ensure smooth literary flow.`
      : '';

    const safetyRule = `\n\nCRITICAL RULE: ABSOLUTELY NO untranslated source language characters (e.g., Chinese Hanzi, Japanese Kanji) should remain in the final output. You MUST translate every single word into ${targetLang} unless it is a specific system variable name (like {{char}}).${vietnameseSafetyRule}\n    - PROPER NOUN RULE: Chinese proper nouns → Hán Việt. Japanese proper nouns → Romaji (NOT Hán Việt). Do NOT mix up these two systems.`;

    let regexInstruction = '';
    if (fieldName.includes('findRegex') || fieldName.includes('replaceString')) {
      regexInstruction = `\n\nREGEX SCRIPT INSTRUCTION: You are translating a Regular Expression pattern or Replacement String.
- Translate any natural language text (e.g., Chinese) inside the string to ${targetLang}.
- STRICTLY PRESERVE all regex syntax, slashes, flags, brackets, and capture groups (e.g., /.../g, $1, \\s, \\d).
- DO NOT remove the outer slashes (like /pattern/s) if they exist.
- IMPORTANT: Nếu có CSS hoặc thẻ HTML thay đổi font chữ (font-family) chứa tên font tiếng Trung (như SimSun, KaiTi, v.v.), BẮT BUỘC thay thế bằng font chữ tiếng Việt tương ứng (ví dụ: 'Be Vietnam Pro', 'Inter', 'Arial', sans-serif).`;
    }

    systemPrompt = `${systemPromptPrefix ? systemPromptPrefix + '\n\n' : ''}${basePrompt}${safetyRule}${regexInstruction}${schemaInstructions}${glossaryInstructions}`;
  }

  const sourceHint = sourceLang && sourceLang !== 'auto' ? ` (from ${sourceLang})` : '';

  // Contextual keyword translation: include content context for lorebook keys
  let userMsg: string;
  let previousContextMsg = '';
  
  if (previousTranslationContext) {
    previousContextMsg = `\n\n[CHUNK CONTINUITY — You are translating one part of a larger text split into chunks.
${previousTranslationContext}
CHUNK RULES:
- Translate ALL text in the current chunk COMPLETELY — even if sentences/paragraphs appear cut off at the start or end.
- MATCH terminology, tone, and proper nouns from the previous translation.
- Do NOT repeat or re-translate any text from the previous chunk.
- CODE PRESERVATION: Keep ALL code exactly as-is (HTML tags, EJS <% %>, template literals \`...\`, JS/CSS blocks, regex patterns, macros like {{char}}). Only translate natural-language text WITHIN code.
- If a code block is split across the chunk boundary (e.g. an unclosed <script>, template literal, or function), preserve the partial code exactly — do NOT attempt to "fix" or close it.]`;
  }

  if (previousTranslationToUpdate && previousTranslationToUpdate.trim()) {
    userMsg = `You are updating the translation of the "${fieldName}" field${sourceHint} to ${targetLang}.
Some parts of the original text are NEW or CHANGED.
Please translate the ENTIRE updated original text below, but REUSE the "PREVIOUS TRANSLATION" as much as possible for parts that haven't changed. This ensures consistency.

--- PREVIOUS TRANSLATION ---
${previousTranslationToUpdate}
--- END PREVIOUS TRANSLATION ---

Translate the following updated original text. Return ONLY the pure translated text, without including any of the original text:${previousContextMsg}\n\n${text}`;
  } else if (contextHint) {
    userMsg = `Here is the entry content for context (use these terms consistently):\n"${contextHint}"\n\nBased on the terminology above, translate the following "${fieldName}" field${sourceHint} to ${targetLang}. Return ONLY comma-separated translated keywords. Keep them short and use the SAME terms that appear in the content:${previousContextMsg}\n\n${text}`;
  } else {
    userMsg = `Translate the following "${fieldName}" field${sourceHint} to ${targetLang}. Return ONLY the pure translated text, without including any of the original text.\nIMPORTANT: Translate EVERY word. Do NOT skip or drop any text, even if sentences appear incomplete at the beginning or end — they are part of a larger split text.${previousContextMsg}\n\n${text}`;
  }

  return {
    system: systemPrompt,
    user: userMsg,
  };
}

/* ─── Detect CJK content ratio ─── */
function getCJKRatio(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return text.length > 0 ? cjkChars / text.length : 0;
}

/** Count only Chinese characters (CJK Unified Ideographs), excluding Japanese kana */
function countChineseChars(text: string): number {
  return (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
}

/**
 * Extract Chinese fragments from a partially-translated text.
 * Returns segments of consecutive Chinese characters with surrounding context.
 */
function extractChineseFragments(text: string): string[] {
  const fragments: string[] = [];
  const regex = /[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\s]{0,200}[\u4e00-\u9fff\u3400-\u4dbf]/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    fragments.push(m[0]);
  }
  // Also catch single isolated Chinese chars
  const singles = text.match(/(?<![\u4e00-\u9fff\u3400-\u4dbf])[\u4e00-\u9fff\u3400-\u4dbf](?![\u4e00-\u9fff\u3400-\u4dbf])/g) || [];
  for (const s of singles) {
    if (!fragments.some(f => f.includes(s))) fragments.push(s);
  }
  return fragments;
}

/**
 * Post-translation residual CJK check & auto-retry.
 * If the translated result still contains Chinese characters above threshold,
 * sends it back to the AI with a focused cleanup prompt.
 * Max 2 retry attempts to avoid infinite loops.
 */
async function postTranslationResidualCheck(
  original: string,
  translated: string,
  fieldName: string,
  config: ProxySettings,
  targetLang: string,
  sourceLang: string,
  signal?: AbortSignal,
  _fieldType?: TranslationFieldType,
  mvuDictionary?: Record<string, string>,
): Promise<string> {
  const isTargetCJK = /chinese|japanese|korean/i.test(targetLang);
  if (isTargetCJK) return translated;

  const origChineseCount = countChineseChars(original);
  if (origChineseCount < 3) return translated;

  let currentResult = translated;

  for (let retry = 0; retry < 2; retry++) {
    const residualCount = countChineseChars(currentResult);
    if (residualCount <= 2) {
      if (retry > 0) console.log(`[ResidualCheck] ${fieldName}: Clean after ${retry} retry(ies)`);
      return currentResult;
    }

    const fragments = extractChineseFragments(currentResult);
    const fragmentList = fragments.slice(0, 20).map(f => `  ${f}`).join('\n');

    console.log(`[ResidualCheck] ${fieldName}: ${residualCount} Chinese chars remain (retry ${retry + 1}/2). Fragments:\n${fragmentList}`);

    let mvuBlock = '';
    if (mvuDictionary && Object.keys(mvuDictionary).length > 0) {
      mvuBlock = '\nMVU Variable Dictionary:\n' +
        Object.entries(mvuDictionary)
          .filter(([k, v]) => k && v && k !== v)
          .map(([k, v]) => `  "${k}" -> "${v}"`)
          .join('\n');
    }

    const cleanupSystem = `You are a translation cleanup agent. The text below was translated from ${sourceLang || 'Chinese'} to ${targetLang}, but some Chinese characters were left untranslated.

Your ONLY job: Find ALL remaining Chinese text and translate it to ${targetLang}.

RULES:
1. Output the COMPLETE text with ALL Chinese replaced by ${targetLang} translations.
2. Do NOT change anything already in ${targetLang}, English, or code.
3. Preserve ALL formatting, HTML, code, macros, EJS, regex patterns.
4. Translate Chinese names using Hán Việt (Sino-Vietnamese) reading. Japanese names use Romaji transliteration (NOT Hán Việt).
5. Do NOT wrap output in markdown fences.
6. Do NOT add explanations.
7. Return the FULL text, not just the translated fragments.

Chinese fragments that need translation:
${fragmentList}${mvuBlock}`;

    const cleanupUser = `Translate ALL remaining Chinese text in the following to ${targetLang}. Return the COMPLETE corrected text:\n\n${currentResult}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('Residual check timeout'), (config.requestTimeout || 300000) * 3);
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      const cleanedResult = await callProvider(config, cleanupSystem, cleanupUser, combinedSignal);
      clearTimeout(timeout);

      if (cleanedResult && cleanedResult.trim()) {
        const parsed = config.expertMode
          ? (extractTranslationFromResponse(cleanedResult).translation || cleanedResult)
          : cleanedResult;
        const newResidual = countChineseChars(parsed);
        if (newResidual < residualCount) {
          currentResult = parsed.trim();
          console.log(`[ResidualCheck] ${fieldName}: Reduced ${residualCount} -> ${newResidual} Chinese chars`);
        } else {
          console.log(`[ResidualCheck] ${fieldName}: Cleanup did not reduce Chinese (${residualCount} -> ${newResidual}), keeping original`);
          return currentResult;
        }
      }
    } catch (err) {
      console.warn(`[ResidualCheck] ${fieldName}: Cleanup retry failed:`, err);
      return currentResult;
    }
  }

  return currentResult;
}

/* ─── Chunk long text (CJK-aware / Unlimited Context) ─── */
/**
 * Check if position is inside a JS function body by scanning backward for
 * unmatched braces preceded by function-like keywords.
 */
function isInsideFunctionBody(text: string, pos: number): boolean {
  // Scan backward up to 5000 chars for brace balance
  const scanStart = Math.max(0, pos - 5000);
  const slice = text.slice(scanStart, pos);
  
  let braceDepth = 0;
  for (let i = slice.length - 1; i >= 0; i--) {
    if (slice[i] === '}') braceDepth++;
    else if (slice[i] === '{') {
      braceDepth--;
      if (braceDepth < 0) {
        // Found unmatched opening brace — check if preceded by function keyword
        const preceding = slice.slice(Math.max(0, i - 80), i).trim();
        if (/(?:function\s*\w*\s*\([^)]*\)\s*$|=>\s*$|\)\s*$|catch\s*\([^)]*\)\s*$|finally\s*$|else\s*$|try\s*$|do\s*$)/.test(preceding)) {
          return true;
        }
        // Could be an object literal or class body — still unsafe
        if (/(?:class\s+\w+|if\s*\([^)]*\)|for\s*\([^)]*\)|while\s*\([^)]*\)|switch\s*\([^)]*\))\s*$/.test(preceding)) {
          return true;
        }
        braceDepth = 0; // reset
      }
    }
  }
  return braceDepth < -1; // deeply unmatched = inside nested block
}

/**
 * Check if position is inside a <script> or <style> block.
 */
function isInsideScriptOrStyle(text: string, pos: number): boolean {
  const before = text.slice(0, pos);
  const scriptOpens = (before.match(/<script[\s>]/gi) || []).length;
  const scriptCloses = (before.match(/<\/script>/gi) || []).length;
  if (scriptOpens > scriptCloses) return true;

  const styleOpens = (before.match(/<style[\s>]/gi) || []).length;
  const styleCloses = (before.match(/<\/style>/gi) || []).length;
  if (styleOpens > styleCloses) return true;

  return false;
}

/**
 * State-machine scan for backtick balance. More accurate than regex —
 * properly handles escaped backticks and nested template expressions.
 * Scans the last `maxScan` chars before `pos`.
 */
function countUnescapedBackticks(text: string, pos: number, maxScan: number = 5000): number {
  const start = Math.max(0, pos - maxScan);
  const slice = text.slice(start, pos);
  let count = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === '`' && (i === 0 || slice[i - 1] !== '\\')) {
      count++;
    }
  }
  return count;
}

/**
 * Check if position is inside an unclosed string literal (single or double quote).
 * Scans the last 10000 chars for quote state — large window for deeply nested code.
 */
function isInsideStringLiteral(text: string, pos: number): boolean {
  const start = Math.max(0, pos - 10000);
  const slice = text.slice(start, pos);
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    const prev = i > 0 ? slice[i - 1] : '';
    if (prev === '\\') continue; // escaped
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
  }
  return inSingle || inDouble;
}

/**
 * Check if position is inside a regex literal like /pattern/flags.
 * Scans backward to find unmatched '/' that looks like regex open.
 */
function isInsideRegexLiteral(text: string, pos: number): boolean {
  const scanLen = Math.min(pos, 5000);
  const slice = text.slice(pos - scanLen, pos);
  // Count unescaped forward slashes — odd count = inside regex
  let slashCount = 0;
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    const prev = i > 0 ? slice[i - 1] : '';
    if (prev === '\\') continue;
    if (!inStr && (ch === '"' || ch === "'")) { inStr = true; strChar = ch; continue; }
    if (inStr && ch === strChar) { inStr = false; continue; }
    if (inStr) continue;
    if (ch === '/' && prev !== '*' && (i + 1 >= slice.length || slice[i + 1] !== '/') && slice[i + 1] !== '*') {
      // Check if this '/' is a regex delimiter (preceded by operator/keyword, not a division)
      const beforeSlash = slice.slice(Math.max(0, i - 10), i).trimEnd();
      if (!beforeSlash || /[=(:,;\[!&|?{}\n^~+\-*/%]$/.test(beforeSlash) || /\b(?:return|case|typeof|void|delete|throw|new|in|of)\s*$/.test(beforeSlash)) {
        slashCount++;
      }
    }
  }
  return slashCount % 2 !== 0;
}

/**
 * Check if position is inside an unclosed HTML tag like <div class="...
 * Scans backward up to 500 chars for unmatched '<'.
 */
function isInsideHtmlTag(text: string, pos: number): boolean {
  const scanLen = Math.min(pos, 500);
  const slice = text.slice(pos - scanLen, pos);
  const lastOpen = slice.lastIndexOf('<');
  if (lastOpen === -1) return false;
  const afterOpen = slice.slice(lastOpen);
  // If there's a '<' with no matching '>' after it, we're inside a tag
  return !afterOpen.includes('>');
}

/**
 * Check if position is inside a CSS @-rule block (@media, @keyframes, etc.).
 */
function isInsideCssAtRule(text: string, pos: number): boolean {
  const scanLen = Math.min(pos, 10000);
  const slice = text.slice(pos - scanLen, pos);
  const atRulePattern = /@(?:media|keyframes|supports|font-face|layer|container|property)\b/gi;
  let lastAt = -1;
  let m;
  while ((m = atRulePattern.exec(slice)) !== null) {
    lastAt = m.index;
  }
  if (lastAt === -1) return false;
  // Check brace balance after the @-rule
  const afterAt = slice.slice(lastAt);
  let depth = 0;
  for (const ch of afterAt) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth > 0; // unclosed = inside @-rule block
}

/**
 * Check if a candidate split position is "safe" — i.e., not inside a template literal,
 * EJS block, regex pattern, function body, script/style block, HTML tag, CSS block,
 * or unbalanced JSON/code structure.
 * Returns true if it is safe to split at `pos`.
 */
function isSafeBoundary(text: string, pos: number): boolean {
  const before = text.slice(0, pos);

  // 1. Backtick balance — splitting inside `template ${expr}` breaks JS (B1)
  const backtickCount = countUnescapedBackticks(text, pos, 10000);
  if (backtickCount % 2 !== 0) return false;

  // 2. EJS tag balance — splitting inside <% ... %> breaks templates
  const ejsOpens = (before.match(/<%/g) || []).length;
  const ejsCloses = (before.match(/%>/g) || []).length;
  if (ejsOpens > ejsCloses) return false;

  // 3. Triple-backtick code fence balance
  const codeBlockMarkers = (before.match(/```/g) || []).length;
  if (codeBlockMarkers % 2 !== 0) return false;

  // 4. Brace/bracket balance — scan last 10000 chars for deep nesting
  const recentSlice = before.slice(-10000);
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (const ch of recentSlice) {
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
  }
  if (braceDepth > 2) return false;   // deep nesting = inside JSON/code block
  if (bracketDepth > 2) return false;  // inside array literal
  if (parenDepth > 2) return false;    // inside function call / expression

  // 5. Function body detection — splitting inside function(){...} corrupts code (B8)
  if (isInsideFunctionBody(text, pos)) return false;

  // 6. Script/style block detection — never split inside <script> or <style>
  if (isInsideScriptOrStyle(text, pos)) return false;

  // 7. String literal detection — splitting inside "..." or '...' breaks code
  if (isInsideStringLiteral(text, pos)) return false;

  // 8. Regex literal detection — splitting inside /pattern/ breaks regex
  if (isInsideRegexLiteral(text, pos)) return false;

  // 9. HTML tag detection — splitting inside <div class="... breaks tags
  if (isInsideHtmlTag(text, pos)) return false;

  // 10. CSS @-rule block detection — splitting inside @media{...} breaks CSS
  if (isInsideCssAtRule(text, pos)) return false;

  return true;
}

/**
 * Find the best safe boundary position near `targetPos` within `text`.
 * Searches backward from targetPos looking for a split point that passes isSafeBoundary().
 * Returns the best position, or targetPos if no safe boundary found.
 */
function findSafeBoundary(text: string, targetPos: number, minPos: number): number {
  // Try double newline boundaries first (most natural)
  const priorities = ['\n\n', '\n', '. ', '。', '；', ' '];
  
  for (const sep of priorities) {
    let searchFrom = targetPos;
    while (searchFrom > minPos) {
      const idx = text.lastIndexOf(sep, searchFrom);
      if (idx <= minPos) break;
      
      const splitAt = idx + sep.length;
      if (isSafeBoundary(text, splitAt)) {
        return splitAt;
      }
      searchFrom = idx - 1;
    }
  }

  // Fallback: try any position near targetPos that is safe
  for (let pos = targetPos; pos > minPos; pos -= 50) {
    if (isSafeBoundary(text, pos)) {
      // Find nearest newline or space
      const nl = text.lastIndexOf('\n', pos);
      if (nl > minPos && isSafeBoundary(text, nl + 1)) return nl + 1;
      const sp = text.lastIndexOf(' ', pos);
      if (sp > minPos && isSafeBoundary(text, sp + 1)) return sp + 1;
      return pos;
    }
  }

  return targetPos; // give up, use original position
}

export function chunkText(text: string, maxChars?: number, _maxTokens?: number): string[] {
  // Default 50K per chunk for ALL models.
  // Chunk quá lớn (100K+) sẽ khiến AI chạm giới hạn max output tokens → mất đuôi.
  // 50K chars ≈ 15K tokens (mixed content) — an toàn cho mọi model.
  if (maxChars === undefined) {
    maxChars = 50000;
  }

  // ═══ HARD CAP: 500K chars per chunk ═══
  // Tăng giới hạn lên rất cao để tôn trọng API trả phí / proxy không giới hạn
  const HARD_CAP = 500000;
  maxChars = Math.min(maxChars, HARD_CAP);

  if (text.length <= maxChars) return [text];

  // Smart splitting states
  const isHtml = /<[a-z][^>]*>/i.test(text) && /<\/[a-z]+>/i.test(text);
  const hasTable = isHtml && /<table[\s>]/i.test(text);

  const chunks: string[] = [];
  let remaining = text;
  const minChunkRatio = 0.3; // Don't accept chunks smaller than 30% of maxChars

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    const minPos = Math.floor(maxChars * minChunkRatio);
    let splitIdx = -1;
    
    // ─── PRIMARY: Use findSafeBoundary for template-literal/EJS/regex safety ───
    splitIdx = findSafeBoundary(remaining, maxChars, minPos);
    
    // ─── SECONDARY: HTML-aware splitting if primary didn't find good spot ───
    if (splitIdx < minPos && isHtml) {
      if (hasTable) {
        const safeBlockEndRegex = /<\/(div|section|article|table|ul|ol|p|h[1-6])>\s*/gi;
        let bestHtmlSplit = -1;
        let m;
        while ((m = safeBlockEndRegex.exec(remaining)) !== null) {
          const endPos = m.index + m[0].length;
          if (endPos > maxChars) break;
          if (endPos > minPos) {
            const textBefore = remaining.slice(0, endPos);
            const tableOpens = (textBefore.match(/<table[\s>]/gi) || []).length;
            const tableCloses = (textBefore.match(/<\/table>/gi) || []).length;
            if (!(tableOpens > tableCloses) || m[1].toLowerCase() === 'table') {
              if (isSafeBoundary(remaining, endPos)) {
                bestHtmlSplit = endPos;
              }
            }
          }
        }
        if (bestHtmlSplit > minPos) splitIdx = bestHtmlSplit;
      } else {
        const htmlBlockEndRegex = /<\/(?:div|section|article|table|ul|ol|tr|li|p|h[1-6])>\s*/gi;
        let bestHtmlSplit = -1;
        let m;
        while ((m = htmlBlockEndRegex.exec(remaining)) !== null) {
          const endPos = m.index + m[0].length;
          if (endPos <= maxChars && endPos > minPos && isSafeBoundary(remaining, endPos)) {
            bestHtmlSplit = endPos;
          }
          if (endPos > maxChars) break;
        }
        if (bestHtmlSplit > minPos) splitIdx = bestHtmlSplit;
      }
    }
    
    // ─── SCRIPT/STYLE block-end splitting ───
    // Prefer splitting after </script> or </style> end tags (complete blocks)
    if (splitIdx < minPos) {
      const blockEndRegex = /<\/(?:script|style)>\s*/gi;
      let bestBlockSplit = -1;
      let m;
      while ((m = blockEndRegex.exec(remaining)) !== null) {
        const endPos = m.index + m[0].length;
        if (endPos > maxChars) break;
        if (endPos > minPos && isSafeBoundary(remaining, endPos)) {
          bestBlockSplit = endPos;
        }
      }
      if (bestBlockSplit > minPos) splitIdx = bestBlockSplit;
    }

    // ─── Code-safe fallback: split at statement boundaries ;  }  > ───
    if (splitIdx < minPos) {
      const maxSlice = remaining.slice(0, maxChars);
      const codeBoundaries = /[;}>](?=[^\w]|$)/g;
      let bestCodeSplit = -1;
      let m;
      while ((m = codeBoundaries.exec(maxSlice)) !== null) {
        const pos = m.index + 1;
        if (pos <= maxChars && pos > minPos && isSafeBoundary(remaining, pos)) {
          bestCodeSplit = pos;
        }
      }
      if (bestCodeSplit > minPos) splitIdx = bestCodeSplit;
    }

    // ─── Newline fallback with safety check ───
    if (splitIdx < minPos) {
      const nl = remaining.lastIndexOf('\n', maxChars);
      if (nl > minPos && isSafeBoundary(remaining, nl + 1)) splitIdx = nl + 1;
    }

    // ─── Space fallback with safety check ───
    if (splitIdx < minPos) {
      // Search backward for a space at a safe boundary
      let searchPos = maxChars;
      while (searchPos > minPos) {
        const sp = remaining.lastIndexOf(' ', searchPos);
        if (sp <= minPos) break;
        if (isSafeBoundary(remaining, sp + 1)) {
          splitIdx = sp + 1;
          break;
        }
        searchPos = sp - 1;
      }
    }

    // ─── Prose punctuation fallback ───
    if (splitIdx < minPos) {
      const sentenceEnd = remaining.slice(0, maxChars).search(/[。！？；」』】）\n][^。！？；」』】）]*$/); 
      if (sentenceEnd > minPos && isSafeBoundary(remaining, sentenceEnd + 1)) {
        splitIdx = sentenceEnd + 1;
      }
    }

    // ─── OVERFLOW RESCUE: If no safe split found within maxChars, ───
    // ─── search FORWARD up to 1.5× maxChars to close the current code block. ───
    // ─── Better to have a slightly larger chunk than to cut inside code. ───
    if (splitIdx < minPos) {
      const overflowLimit = Math.min(Math.floor(maxChars * 1.5), remaining.length);
      const overflowPriorities = ['\n\n', '\n', '. ', '。', ' '];
      for (const sep of overflowPriorities) {
        let searchFrom = maxChars;
        while (searchFrom < overflowLimit) {
          const idx = remaining.indexOf(sep, searchFrom);
          if (idx < 0 || idx >= overflowLimit) break;
          const pos = idx + sep.length;
          if (isSafeBoundary(remaining, pos)) {
            splitIdx = pos;
            console.log(`[chunkText] ⚠️ Overflow rescue: split at ${pos} (${((pos / maxChars) * 100).toFixed(0)}% of maxChars) to avoid cutting inside code block`);
            break;
          }
          searchFrom = idx + 1;
        }
        if (splitIdx >= minPos) break;
      }
    }

    // ─── ULTIMATE FALLBACK: hard cut (should rarely happen) ───
    if (splitIdx < minPos) {
      splitIdx = maxChars;
      console.warn(`[chunkText] ⚠️ HARD CUT at ${maxChars} — no safe boundary found. Code may be corrupted at this seam.`);
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = isHtml ? remaining.slice(splitIdx) : remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/* ─── Model Output Token Limits ─── */
export function getMaxOutputTokens(modelId: string, maxTokensFromConfig?: number): number {
  if (maxTokensFromConfig && maxTokensFromConfig > 0) {
    return maxTokensFromConfig;
  }

  const model = modelId.toLowerCase();
  
  // Anthropic Models
  if (model.includes('claude-4') || model.includes('claude-3-7') || model.includes('claude-3-5') || model.includes('claude-sonnet-4')) {
    return 8192;
  }
  if (model.includes('claude-3-opus') || model.includes('claude-3-haiku')) {
    return 4096;
  }
  
  // Google Models — Gemini 2.5 Pro supports 65535 max output tokens
  if (model.includes('gemini-2.5-pro') || model.includes('gemini-3.1-pro')) {
    return 65535;
  }
  if (model.includes('gemini-2.5-flash') || model.includes('gemini-3.1-flash') || model.includes('gemini-3.') || model.includes('gemini-2.0') || model.includes('gemini-1.5')) {
    return 8192;
  }
  
  // OpenAI & Compatible
  if (model.includes('gpt-5') || model.includes('gpt-4o') || model.includes('gpt-4.1')) {
    return 16384;
  }
  if (model.includes('o3') || model.includes('o4')) {
    return 100000;
  }
  if (model.includes('deepseek')) {
    return 8192;
  }
  
  // Default
  return 8192; 
}

/* ─── OpenAI-compatible API call ─── */
async function callOpenAICompatible(
  config: ProxySettings,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const useStream = config.useStream !== false;
  const rawUrl = config.proxyUrl.replace(/\/+$/, '') + '/chat/completions';
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: getMaxOutputTokens(config.model, config.maxTokens),
    temperature: config.temperature,
    stream: useStream,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw wrapCorsError(err, rawUrl, config.useCorsProxy);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401) throw new ApiError('Invalid API key', 401);
    if (res.status === 429) throw new ApiError('Rate limited (429)', 429, true);
    if (res.status >= 500) throw new ApiError(`Server error ${res.status}: ${errText}`, res.status, true);
    throw new ApiError(`HTTP ${res.status}: ${errText}`, res.status);
  }

  if (!res.body) throw new ApiError('No response body from API');

  if (!useStream) {
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || json.choices?.[0]?.text;
    if (!text) throw new ApiError(`Empty response from API`);
    return text.trim();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullContent = '';
  let buffer = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer) {
          // Process any remaining buffered text
          const line = buffer.trim();
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const parsed = JSON.parse(line.slice(6));
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) fullContent += text;
            } catch (e) {}
          }
        }
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(trimmedLine.slice(6));
            const text = parsed.choices?.[0]?.delta?.content;
            if (text) fullContent += text;
          } catch (e) {}
        }
      }
    }
  } catch (err: any) {
    if (fullContent && !signal?.aborted) {
      console.warn(`[API] OpenAI stream aborted prematurely (${err.message}). Returning partial content.`);
    } else {
      throw err;
    }
  }

  if (!fullContent) {
    throw new ApiError(`Empty response from API`);
  }
  return fullContent.trim();
}

/* ─── Anthropic API call ─── */
async function callAnthropic(
  config: ProxySettings,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const useStream = config.useStream !== false;
  const rawUrl = config.proxyUrl.replace(/\/+$/, '') + '/messages';
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);

  const body = {
    model: config.model,
    max_tokens: getMaxOutputTokens(config.model, config.maxTokens),
    system,
    messages: [{ role: 'user', content: user }],
    temperature: config.temperature,
    stream: useStream,
  };

  // When using the CORS proxy, we don't need the dangerous-direct-browser-access header
  // because the request goes through the Vite server (not from browser to Anthropic)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (!config.useCorsProxy) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw wrapCorsError(err, rawUrl, config.useCorsProxy);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401) throw new ApiError('Invalid API key', 401);
    if (res.status === 429) throw new ApiError('Rate limited (429)', 429, true);
    if (res.status >= 500) throw new ApiError(`Server error ${res.status}: ${errText}`, res.status, true);
    throw new ApiError(`HTTP ${res.status}: ${errText}`, res.status);
  }

  if (!res.body) throw new ApiError('No response body from Anthropic API');

  if (!useStream) {
    const json = await res.json();
    const text = json.content?.[0]?.text;
    if (!text) throw new ApiError(`Empty response from Anthropic API`);
    return text.trim();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullContent = '';
  let buffer = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullContent += parsed.delta.text;
              }
            } catch (e) {}
          }
        }
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmedLine.slice(6));
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullContent += parsed.delta.text;
            }
          } catch (e) {}
        }
      }
    }
  } catch (err: any) {
    if (fullContent && !signal?.aborted) {
      console.warn(`[API] Anthropic stream aborted prematurely (${err.message}). Returning partial content.`);
    } else {
      throw err;
    }
  }

  if (!fullContent) {
    throw new ApiError(`Empty response from Anthropic API`);
  }
  return fullContent.trim();
}

/* ─── Google Gemini API call ─── */
async function callGemini(
  config: ProxySettings,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const useStream = config.useStream !== false;
  const baseUrl = config.proxyUrl.replace(/\/+$/, '');
  const endpoint = useStream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
  const rawUrl = `${baseUrl}/models/${config.model}:${endpoint}key=${config.apiKey}`;
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: getMaxOutputTokens(config.model, config.maxTokens),
      temperature: config.temperature,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw wrapCorsError(err, rawUrl, config.useCorsProxy);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new ApiError('Invalid API key', res.status);
    if (res.status === 429) throw new ApiError('Rate limited (429)', 429, true);
    if (res.status >= 500) throw new ApiError(`Server error ${res.status}: ${errText}`, res.status, true);
    throw new ApiError(`HTTP ${res.status}: ${errText}`, res.status);
  }

  if (!res.body) throw new ApiError('No response body from Gemini API');

  if (!useStream) {
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new ApiError(`Empty response from Gemini API`);
    return text.trim();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullContent = '';
  let buffer = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              if (jsonStr) {
                const parsed = JSON.parse(jsonStr);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) fullContent += text;
              }
            } catch (e) {}
          }
        }
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ')) {
          try {
            const jsonStr = trimmedLine.slice(6).trim();
            if (!jsonStr) continue;
            const parsed = JSON.parse(jsonStr);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) fullContent += text;
          } catch (e) {}
        }
      }
    }
  } catch (err: any) {
    if (fullContent && !signal?.aborted) {
      console.warn(`[API] Gemini stream aborted prematurely (${err.message}). Returning partial content.`);
    } else {
      throw err;
    }
  }

  if (!fullContent) {
    throw new ApiError(`Empty response from Gemini API`);
  }
  return fullContent.trim();
}

/* ─── API Key Rotation ─── */
let _keyIndex = 0;

/** Get the next API key from rotation pool. Falls back to primary key. */
function getRotatedKey(config: ProxySettings): string {
  const pool = config.apiKeys.filter(k => k.trim());
  if (pool.length === 0) return config.apiKey;

  // Include primary key in the pool if not already there
  const allKeys = [config.apiKey, ...pool].filter(Boolean);
  const uniqueKeys = [...new Set(allKeys)];
  if (uniqueKeys.length === 0) return config.apiKey;

  const key = uniqueKeys[_keyIndex % uniqueKeys.length];
  _keyIndex = (_keyIndex + 1) % uniqueKeys.length;
  return key;
}

/** Force advance to next key (e.g. after rate limit) */
function advanceKeyRotation() {
  _keyIndex++;
}

/* ─── Rate Limiter — Sliding Window (5 req / 60s) ─── */

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5;
const _requestTimestamps: number[] = [];

/**
 * Wait until a rate-limit slot is available.
 * Uses a sliding window: keeps only timestamps within the last 60s,
 * and waits if 5 requests were already made in that window.
 */
async function waitForRateLimit(signal?: AbortSignal): Promise<void> {
  const now = Date.now();

  // Prune old timestamps outside the window
  while (_requestTimestamps.length > 0 && _requestTimestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    _requestTimestamps.shift();
  }

  // If under limit, record and go
  if (_requestTimestamps.length < RATE_LIMIT_MAX_REQUESTS) {
    _requestTimestamps.push(now);
    return;
  }

  // Over limit — calculate wait time until oldest entry expires
  const oldestInWindow = _requestTimestamps[0];
  const waitMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - now + 50; // +50ms buffer

  if (waitMs > 0) {
    console.log(`[RateLimit] 5/${RATE_LIMIT_WINDOW_MS / 1000}s limit hit — waiting ${(waitMs / 1000).toFixed(1)}s`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      if (signal) {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason || new Error('Aborted')); };
        if (signal.aborted) { clearTimeout(timer); reject(signal.reason || new Error('Aborted')); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  // Prune again after waiting and record
  const now2 = Date.now();
  while (_requestTimestamps.length > 0 && _requestTimestamps[0] <= now2 - RATE_LIMIT_WINDOW_MS) {
    _requestTimestamps.shift();
  }
  _requestTimestamps.push(now2);
}

/* ─── Route to correct provider (with key rotation + rate limiting) ─── */
export async function callProvider(
  config: ProxySettings,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  // ═══ Rate limit gate ═══
  await waitForRateLimit(signal);

  // Create a config copy with rotated key
  const activeKey = getRotatedKey(config);
  const rotatedConfig = { ...config, apiKey: activeKey };

  try {
    switch (config.provider) {
      case 'anthropic':
        return await callAnthropic(rotatedConfig, system, user, signal);
      case 'google':
        return await callGemini(rotatedConfig, system, user, signal);
      case 'openai':
      case 'custom':
      default:
        return await callOpenAICompatible(rotatedConfig, system, user, signal);
    }
  } catch (err) {
    // On rate limit, advance to next key for the retry
    if (err instanceof ApiError && err.statusCode === 429) {
      advanceKeyRotation();
    }
    throw err;
  }
}

/* ─── Sleep utility ─── */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ─── Clean translation response ─── */
// Strips patterns where AI returns "original → translation" instead of just translation
// Also handles Expert Mode XML responses (<thought_process>/<translation> tags)
function cleanTranslationResponse(original: string, translated: string, isExpertMode?: boolean): string {
  if (!translated || !translated.trim()) return translated;

  // ═══ EXPERT MODE: Extract <translation> content from XML response ═══
  if (
    isExpertMode || 
    translated.includes('<translation>') || 
    translated.includes('<thought_process>') || 
    translated.includes('<think>') ||
    translated.includes('<variable_map>') ||
    translated.includes('<code_inventory>')
  ) {
    const parsed = extractTranslationFromResponse(translated);
    if (parsed.translation) {
      if (parsed.thoughtProcess) {
        console.log('[Ultra Expert V2] Thought process:', parsed.thoughtProcess.slice(0, 200) + '...');
      }
      if (parsed.qualityScore !== undefined) {
        console.log(`[Ultra Expert V2] Quality Score: ${parsed.qualityScore}/100`);
      }
      if (parsed.integrityReport) {
        console.log('[Ultra Expert V2] Integrity:', parsed.integrityReport.slice(0, 200));
      }
      // Use extracted translation (which has thought blocks stripped) for further cleaning
      translated = parsed.translation;
    }
  }

  // Strip markdown code fences if present (e.g. ```html ... ```)
  // B2 FIX: PRESERVE code fences when the ORIGINAL text had them.
  // SillyTavern uses ```html ... ``` to determine that content is renderable HTML.
  const codeFenceRegex = /^```([a-z]*)\r?\n([\s\S]*?)\r?\n```\s*$/i;
  
  const stripMarkdownFences = (text: string, orig: string) => {
    const trimmedText = text.trim();
    const trimmedOrig = orig.trim();
    
    const origCodeFenceMatch = trimmedOrig.match(codeFenceRegex);
    const transCodeFenceMatch = trimmedText.match(codeFenceRegex);
    
    if (origCodeFenceMatch) {
      // Original HAD code fences — they are part of the content, not AI hallucination
      if (transCodeFenceMatch) {
        // Translation also has code fences → keep as-is (already correct)
        return text;
      } else {
        // AI dropped the code fences → RE-WRAP with the original fence type
        const fenceType = origCodeFenceMatch[1] || '';
        return `\`\`\`${fenceType}\n${trimmedText}\n\`\`\``;
      }
    }
    
    // Original did NOT have code fences — strip them if AI added them
    if (transCodeFenceMatch) {
      return transCodeFenceMatch[2].trim();
    }
    
    // Fallback: strip any leading/trailing backticks if original didn't have them
    if (trimmedText.startsWith('`') && trimmedText.endsWith('`') && !trimmedOrig.startsWith('`')) {
      return trimmedText.replace(/^`+|`+$/g, '').trim();
    }
    return text;
  };

  const isHtmlContent = /<[a-z][^>]*>/i.test(original) && /<\/[a-z]+>/i.test(original);
  if (isHtmlContent) {
    // For HTML content, apply code fence logic (safe operation)
    let cleaned = stripMarkdownFences(translated, original);
    return cleaned.trim() || translated.trim();
  }

  let cleaned = stripMarkdownFences(translated, original);

  // Pattern 1: Full text "original → translation" or "original -> translation"
  // The AI sometimes returns "Chinese text → Vietnamese text"

  // Check if the response contains the original text with an arrow separator
  // Split by various arrow characters
  const arrowSeparators = ['→', '➜', '➡', '⇒', '->'];
  for (const sep of arrowSeparators) {
    if (cleaned.includes(sep)) {
      // Split by the separator and check if the left side looks like original text
      const parts = cleaned.split(sep);
      if (parts.length === 2) {
        const leftTrimmed = parts[0].trim();
        const rightTrimmed = parts[1].trim();
        // If left side significantly overlaps with the original, take only the right side
        // BUT only if the right side is substantial (at least 10% of the original length)
        if (leftTrimmed.length > 0 && rightTrimmed.length > 0 && rightTrimmed.length >= original.length * 0.1) {
          const overlapRatio = calculateOverlap(original, leftTrimmed);
          if (overlapRatio > 0.5) { // Raised threshold from 0.3 to 0.5 to be less aggressive
            cleaned = rightTrimmed;
          }
        }
      } else if (parts.length > 2) {
        // Multiple arrows - likely "line1_orig → line1_trans\nline2_orig → line2_trans"
        // Process line by line
        const lines = cleaned.split('\n');
        const cleanedLines: string[] = [];
        for (const line of lines) {
          let processedLine = line;
          for (const s of arrowSeparators) {
            if (processedLine.includes(s)) {
              const lineParts = processedLine.split(s);
              if (lineParts.length === 2 && lineParts[1].trim().length > 0) {
                processedLine = lineParts[1].trim();
                break;
              }
            }
          }
          cleanedLines.push(processedLine);
        }
        cleaned = cleanedLines.join('\n');
      }
    }
  }

  // Pattern 2: Backtick-wrapped pairs like `original` → `translation`
  cleaned = cleaned.replace(/`[^`]+`\s*[→➜➡⇒]\s*`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/`[^`]+`\s*->\s*`([^`]+)`/g, '$1');

  // Pattern 3: Remove any remaining quotes wrapping around the whole response
  if (cleaned.startsWith("'") && cleaned.endsWith("'") && !original.startsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }

  // SAFETY NET: If cleaning produced an empty result but the raw translation was not empty,
  // return the raw translation instead — better to have unclean text than no text.
  const result = cleaned.trim();
  if (!result && translated.trim()) {
    return translated.trim();
  }

  return result;
}

/* ─── Calculate character overlap ratio ─── */
function calculateOverlap(a: string, b: string): number {
  // Simple character-level overlap check
  const aChars = new Set(a.split(''));
  const bChars = new Set(b.split(''));
  let overlap = 0;
  for (const ch of bChars) {
    if (aChars.has(ch)) overlap++;
  }
  return overlap / Math.max(aChars.size, 1);
}

/* ─── Translate a single chunk with retry + truncation detection ─── */
async function translateChunk(
  chunk: string,
  chunkIdx: number,
  totalChunks: number,
  fieldName: string,
  config: ProxySettings,
  targetLang: string,
  sourceLang: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (signal?.aborted) throw new Error('Cancelled');

      const controller = new AbortController();
      const baseTimeout = config.requestTimeout || 300000;
      const chunkRatio = Math.max(1, chunk.length / 2000);
      const timeout = Math.min(baseTimeout * chunkRatio, baseTimeout * 5);
      const timeoutId = setTimeout(() => controller.abort('Request timeout'), timeout);

      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      let result = await callProvider(config, systemPrompt, userPrompt, combinedSignal);
      clearTimeout(timeoutId);

      // ─── Token limit truncation detection ───
      // If AI hits max tokens inside a thought block, it never outputs the translation.
      // To avoid false positives when translating text that literally contains "<think>",
      // we check if the thought block is structural:
      // 1. It starts near the beginning of the text (e.g. DeepSeek R1)
      // 2. Or we are in expertMode and the <translation> block is missing
      const hasThoughtOpen = /<(?:thought_process|think)>/i.test(result);
      const hasThoughtClose = /<\/(?:thought_process|think)>/i.test(result);
      const hasUnclosedThought = hasThoughtOpen && !hasThoughtClose;
      
      const startsWithThought = /^\s*<(?:thought_process|think)>/i.test(result);
      const isExpertMissingTranslation = config.expertMode && !/<translation>/i.test(result);

      if (hasUnclosedThought && (startsWithThought || isExpertMissingTranslation)) {
        throw new Error('AI bị ngắt ngang do chạm giới hạn Max Tokens (chưa kịp xuất bản dịch).');
      }

      // ─── Multi-round truncation detection & continuation ───
      // Nếu AI trả về < 50% input → gần chắc chắn bị cắt do max output tokens.
      // Loop tối đa 3 lần, mỗi lần yêu cầu AI dịch tiếp phần còn lại.
      const CONT_THRESHOLD = 0.5; // 50% — nếu response ngắn hơn nửa input → continuation
      const MAX_CONT_ROUNDS = 3;

      if (chunk.length > 500 && result.length > 0) {
        for (let contRound = 0; contRound < MAX_CONT_ROUNDS; contRound++) {
          const responseRatio = result.length / chunk.length;
          if (responseRatio >= CONT_THRESHOLD) break;

          console.log(`[translateChunk] ${fieldName} chunk ${chunkIdx + 1}/${totalChunks}: response ${(responseRatio * 100).toFixed(0)}% < ${(CONT_THRESHOLD * 100).toFixed(0)}% → continuation round ${contRound + 1}/${MAX_CONT_ROUNDS}...`);

          // Estimate where in the original text we need to pick up
          const estimatedCoverage = Math.max(responseRatio - 0.05, 0.1);
          const remainingOriginal = chunk.slice(Math.floor(chunk.length * estimatedCoverage));

          const continuationPrompt = `The previous translation was cut off at approximately ${(responseRatio * 100).toFixed(0)}% of the content. Continue translating from where you stopped.\n` +
            `The last translated text ended with: "${result.slice(-200)}"\n\n` +
            `Continue translating the remaining original text below. Return ONLY the continuation, do NOT repeat what was already translated:\n\n` +
            `${remainingOriginal}`;

          try {
            const contController = new AbortController();
            const contTimeout = setTimeout(() => contController.abort('Continuation timeout'), timeout);
            const contSignal = signal
              ? AbortSignal.any([signal, contController.signal])
              : contController.signal;

            const continuation = await callProvider(config, systemPrompt, continuationPrompt, contSignal);
            clearTimeout(contTimeout);

            if (continuation.trim()) {
              result = result + '\n' + continuation;
              console.log(`[translateChunk] Continuation +${continuation.length} chars → total ${result.length} chars (${((result.length / chunk.length) * 100).toFixed(0)}%)`);
            } else {
              break; // Empty continuation — stop
            }
          } catch {
            console.warn(`[translateChunk] Continuation round ${contRound + 1} failed, using accumulated result`);
            break;
          }
        }
      }

      lastError = null;
      return result;
    } catch (err) {
      lastError = err as Error;
      if (lastError.message?.includes('BodyStreamBuffer was aborted') || lastError.message?.includes('fetch failed')) {
        lastError = new Error('Lỗi mạng: API đột ngột ngắt kết nối (BodyStreamBuffer aborted). Có thể do timeout proxy hoặc nội dung bị bộ lọc an toàn của AI chặn.');
      }

      if (signal?.aborted) throw err;

      if (err instanceof ApiError && !err.retryable) {
        throw err;
      }

      if (attempt < config.maxRetries) {
        const baseDelay = config.retryDelay || 1000;
        const backoff = Math.min(baseDelay * Math.pow(2, attempt), 30000);
        await sleep(backoff);
      }
    }
  }

  if (lastError) throw lastError;
  return '';
}

/* ─── Verify seam coherence between adjacent translated chunks ─── */
async function verifySeams(
  translatedChunks: string[],
  originalChunks: string[],
  config: ProxySettings,
  targetLang: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (translatedChunks.length < 2) return translatedChunks;

  // Only check seams — the tail of chunk[i] + head of chunk[i+1]
  // Take ~300 chars from each side of the seam
  const SEAM_CHARS = 300;
  const seamIssues: { idx: number; tailOrig: string; headOrig: string; tailTrans: string; headTrans: string }[] = [];

  for (let i = 0; i < translatedChunks.length - 1; i++) {
    const tailTrans = translatedChunks[i].slice(-SEAM_CHARS);
    const headTrans = translatedChunks[i + 1].slice(0, SEAM_CHARS);
    const tailOrig = originalChunks[i].slice(-SEAM_CHARS);
    const headOrig = originalChunks[i + 1].slice(0, SEAM_CHARS);
    seamIssues.push({ idx: i, tailOrig, headOrig, tailTrans, headTrans });
  }

  // Build a single verification prompt for ALL seams
  const seamDescriptions = seamIssues.map((s, i) =>
    `=== SEAM ${i + 1} (between chunk ${s.idx + 1} and ${s.idx + 2}) ===\n` +
    `Original tail: ${s.tailOrig}\n` +
    `Original head: ${s.headOrig}\n` +
    `Translated tail: ${s.tailTrans}\n` +
    `Translated head: ${s.headTrans}`
  ).join('\n\n');

  const verifySystem = `You are a translation quality checker for ${targetLang}. ` +
    `A large text was split into chunks and translated in parallel. ` +
    `Check if the seam points (where chunks join) are coherent. ` +
    `Look for: broken sentences, duplicated phrases, missing connectors, inconsistent terminology, or broken HTML tags at seam boundaries.\n` +
    `If ALL seams are fine, respond with exactly: ALL_OK\n` +
    `If issues exist, respond in this format for EACH problematic seam:\n` +
    `SEAM <number>\nFIXED_TAIL: <corrected last ~100 chars of the preceding chunk>\nFIXED_HEAD: <corrected first ~100 chars of the following chunk>\n` +
    `Only output fixes for seams that have real problems. Keep fixes minimal — only change what's needed at the boundary.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Seam verify timeout'), (config.requestTimeout || 300000) * 3);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const verifyResult = await callProvider(config, verifySystem, seamDescriptions, combinedSignal);
    clearTimeout(timeout);

    if (verifyResult.trim() === 'ALL_OK') {
      console.log('[verifySeams] All seams coherent ✓');
      return translatedChunks;
    }

    // Parse fixes
    const fixedChunks = [...translatedChunks];
    const seamFixRegex = /SEAM\s+(\d+)\s*\n\s*FIXED_TAIL:\s*([\s\S]*?)\n\s*FIXED_HEAD:\s*([\s\S]*?)(?=\nSEAM|\n*$)/gi;
    let match;
    let fixCount = 0;
    while ((match = seamFixRegex.exec(verifyResult)) !== null) {
      const seamNum = parseInt(match[1], 10) - 1; // 0-indexed
      const fixedTail = match[2].trim();
      const fixedHead = match[3].trim();

      if (seamNum >= 0 && seamNum < seamIssues.length) {
        const s = seamIssues[seamNum];
        // Replace the tail of chunk[s.idx]
        if (fixedTail && fixedTail.length > 10) {
          const existingTail = fixedChunks[s.idx].slice(-s.tailTrans.length);
          if (existingTail === s.tailTrans) {
            fixedChunks[s.idx] = fixedChunks[s.idx].slice(0, -s.tailTrans.length) + fixedTail;
          }
        }
        // Replace the head of chunk[s.idx+1]
        if (fixedHead && fixedHead.length > 10) {
          const existingHead = fixedChunks[s.idx + 1].slice(0, s.headTrans.length);
          if (existingHead === s.headTrans) {
            fixedChunks[s.idx + 1] = fixedHead + fixedChunks[s.idx + 1].slice(s.headTrans.length);
          }
        }
        fixCount++;
      }
    }
    console.log(`[verifySeams] Fixed ${fixCount} seam(s)`);
    return fixedChunks;
  } catch (err) {
    // Verification failed — return originals (non-critical)
    console.warn('[verifySeams] Verification failed, using unverified seams:', err);
    return translatedChunks;
  }
}

/* ─── Main translate function with parallel chunks + seam verification ─── */
// ─── Secret Masking Utilities ───
interface SecretMaskMap {
  [placeholder: string]: string;
}

function maskSecrets(text: string): { maskedText: string; map: SecretMaskMap } {
  const map: SecretMaskMap = {};
  let maskedText = text;
  let counter = 0;

  // Patterns to protect: Bearer tokens, API keys, passwords, generic tokens
  const patterns = [
    /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g,
    /([a-zA-Z0-9_]*key[a-zA-Z0-9_]*\s*[:=]\s*['"])([^'"]+)(['"])/gi,
    /([a-zA-Z0-9_]*password[a-zA-Z0-9_]*\s*[:=]\s*['"])([^'"]+)(['"])/gi,
    /([a-zA-Z0-9_]*token[a-zA-Z0-9_]*\s*[:=]\s*['"])([^'"]+)(['"])/gi,
    // B7: SillyTavern password check patterns
    // input === "secret_code" or input == "密码"
    /(input\s*={2,3}\s*['"])([^'"]{3,50})(['"])/g,
    // executeSlashCommands('/pass secret')
    /(\/pass\s+)([^\s'"<>]{3,30})/g,
    // data-password="value" or data-secret="value"
    /(data-(?:password|pass|secret|code|pin)\s*=\s*['"])([^'"]+)(['"])/gi,
    // const pass = "hardcoded" or let secret = 'value'
    /((?:pass|secret|credential|pwd|pin)\s*=\s*['"])([^'"]+)(['"])/gi,
  ];

  for (const pattern of patterns) {
    maskedText = maskedText.replace(pattern, (match, p1, p2, p3) => {
      // If it's the Bearer pattern, there is no p3
      if (!p3) {
        const placeholder = `__SECRET_TOKEN_${counter++}__`;
        map[placeholder] = match.substring(p1.length);
        return `${p1}${placeholder}`;
      }
      
      const placeholder = `__SECRET_TOKEN_${counter++}__`;
      map[placeholder] = p2;
      return `${p1}${placeholder}${p3}`;
    });
  }

  return { maskedText, map };
}

function unmaskSecrets(text: string, map: SecretMaskMap): string {
  let unmaskedText = text;
  for (const [placeholder, secret] of Object.entries(map)) {
    unmaskedText = unmaskedText.replace(new RegExp(placeholder, 'g'), secret);
  }
  return unmaskedText;
}

export async function translateText(
  text: string,
  fieldName: string,
  config: ProxySettings,
  targetLang: string,
  sourceLang: string,
  customPrompt?: string,
  customSchema?: string,
  signal?: AbortSignal,
  contextHint?: string,
  glossary?: GlossaryEntry[],
  previousTranslationToUpdate?: string,
  /** Field type for Master Prompt selection (expert mode) */
  fieldType?: TranslationFieldType,
  /** MVU dictionary for variable sync (expert mode) */
  mvuDictionary?: Record<string, string>,
  /** Custom chunk size (override default logic) */
  chunkSize?: number,
): Promise<string> {
  if (!text || text.trim() === '') return '';

  // 1. Mask secrets (API keys, tokens, passwords) before translation
  const { maskedText, map: secretMap } = maskSecrets(text);

  const isExpert = config.expertMode;
  const chunks = chunkText(maskedText, chunkSize && chunkSize > 0 ? chunkSize : undefined, config.maxTokens);

  // ═══ SINGLE CHUNK — fast path (no parallelism needed) ═══
  if (chunks.length === 1) {
    const { system, user } = buildTranslationMessages(
      chunks[0], fieldName, targetLang, config.systemPromptPrefix,
      sourceLang, customPrompt, customSchema, contextHint, glossary, '',
      previousTranslationToUpdate,
      fieldType, isExpert, mvuDictionary,
    );
    const result = await translateChunk(
      chunks[0], 0, 1, fieldName, config, targetLang, sourceLang, system, user, signal
    );
    let cleaned = cleanTranslationResponse(maskedText, result, isExpert);
    cleaned = unmaskSecrets(cleaned, secretMap); // Unmask before residual check
    
    // RESIDUAL CJK CHECK: auto-retry if Chinese text remains
    return postTranslationResidualCheck(
      text, cleaned, fieldName, config, targetLang, sourceLang, signal, fieldType, mvuDictionary
    );
  }

  // ═══ MULTIPLE CHUNKS — sequential translation with context continuity ═══
  // CRITICAL: Translate sequentially so each chunk gets the FULL previous
  // translated chunk as context. This prevents word loss at chunk boundaries
  // and preserves code structure across splits.
  console.log(`[translateText] ${fieldName}: Translating ${chunks.length} chunks sequentially (with full context)...`);

  const ORIGINAL_BOUNDARY_CHARS = 500; // Tail of original prev chunk for code structure awareness
  const translatedChunks: string[] = [];

  for (let idx = 0; idx < chunks.length; idx++) {
    if (signal?.aborted) throw new Error('Cancelled');

    // Build rich context: full previous translated chunk + original boundary
    let prevContext = '';
    if (idx > 0 && translatedChunks[idx - 1]) {
      const fullPrevTranslation = translatedChunks[idx - 1];
      const originalBoundaryTail = chunks[idx - 1].slice(-ORIGINAL_BOUNDARY_CHARS);
      prevContext =
        `=== PREVIOUS CHUNK TRANSLATION (for terminology & flow consistency) ===\n` +
        `${fullPrevTranslation}\n\n` +
        `=== ORIGINAL TEXT BOUNDARY (last ${ORIGINAL_BOUNDARY_CHARS} chars before this chunk — for code structure awareness) ===\n` +
        `${originalBoundaryTail}`;
    }

    const { system, user } = buildTranslationMessages(
      chunks[idx], `${fieldName} [part ${idx + 1}/${chunks.length}]`, targetLang, config.systemPromptPrefix,
      sourceLang, customPrompt, customSchema, contextHint, glossary,
      prevContext, // ← context from previous chunk's translation
      idx === 0 ? previousTranslationToUpdate : undefined,
      fieldType, isExpert, mvuDictionary,
    );

    try {
      const translated = await translateChunk(
        chunks[idx], idx, chunks.length, fieldName, config, targetLang, sourceLang, system, user, signal
      );
      // Clean each chunk individually against its OWN original text to prevent
      // arrow-separator cleanup from incorrectly stripping legitimate content
      const chunkCleaned = cleanTranslationResponse(chunks[idx], translated, isExpert);
      translatedChunks.push(chunkCleaned);
      console.log(`[translateText] ${fieldName}: chunk ${idx + 1}/${chunks.length} done ✓`);
    } catch (err: any) {
      if (signal?.aborted || err?.message === 'Cancelled') {
        throw new Error('Cancelled');
      }
      throw err;
    }
  }

  console.log(`[translateText] ${fieldName}: All ${chunks.length} chunks done. Verifying seams...`);

  // ═══ SEAM VERIFICATION — check chunk boundaries for coherence ═══
  const verifiedChunks = await verifySeams(translatedChunks, chunks, config, targetLang, signal);

  // For HTML content, join without separator to avoid injecting text nodes
  // that break <table>, <ul>, and other structural elements.
  // For plain text, use \n\n to maintain paragraph separation.
  const isHtmlContent = /<[a-z][^>]*>/i.test(maskedText) && /<\/[a-z]+>/i.test(maskedText);
  const joiner = isHtmlContent ? '' : '\n\n';
  const rawResult = verifiedChunks.join(joiner);
  // Chunks already individually cleaned above — only unmask secrets here
  let cleaned = unmaskSecrets(rawResult, secretMap);
  
  // RESIDUAL CJK CHECK: auto-retry if Chinese text remains
  return postTranslationResidualCheck(
    text, cleaned, fieldName, config, targetLang, sourceLang, signal, fieldType, mvuDictionary
  );
}

/* ─── Batch translate multiple fields in one API call ─── */
export async function translateBatch(
  items: { text: string; fieldName: string }[],
  config: ProxySettings,
  targetLang: string,
  sourceLang: string,
  systemPromptPrefix: string,
  customPrompt?: string,
  customSchema?: string,
  signal?: AbortSignal,
  glossary?: GlossaryEntry[],
  chunkSize?: number
): Promise<string[]> {
  if (items.length === 0) return [];
  if (items.length === 1) {
    const result = await translateText(
      items[0].text, items[0].fieldName, config, targetLang, sourceLang, 
      customPrompt, customSchema, signal, undefined, glossary, undefined, undefined, undefined, chunkSize
    );
    return [result];
  }

  // Build combined prompt with numbered sections
  const DELIMITER = '===';
  const combinedText = items
    .map((item, i) => `${DELIMITER}${i + 1}${DELIMITER}\n${item.text}`)
    .join('\n\n');

  const schemaInstructions = customSchema
    ? `\n\nCARD SCHEMA / GLOSSARY:\n${customSchema}\n`
    : '';

  const basePrompt = customPrompt && customPrompt.trim()
    ? customPrompt
    : getDefaultTranslationPrompt(sourceLang, targetLang);

  // Build glossary block
  let glossaryBlock = '';
  if (glossary && glossary.length > 0) {
    const terms = glossary
      .filter(g => g.source.trim() && g.target.trim())
      .map(g => `  "${g.source}" → "${g.target}"`)
      .join('\n');
    if (terms) glossaryBlock = `\n\nMANDATORY TERMINOLOGY:\n${terms}\n`;
  }

  const system = `${systemPromptPrefix ? systemPromptPrefix + '\n\n' : ''}${basePrompt}

BATCH FORMAT:
- The input contains ${items.length} numbered sections, each starting with ${DELIMITER}N${DELIMITER} (e.g., ${DELIMITER}1${DELIMITER}, ${DELIMITER}2${DELIMITER}).
- You MUST return the same numbered delimiters with the translated text for each section.
- Do NOT merge or skip any sections. Every section must be present in your output.
- CRITICAL: You MUST translate ALL Chinese/Japanese/Korean characters in EVERY section. Do NOT leave any CJK text untranslated. This includes section headers, YAML keys, annotations, labels, and text inside XML/HTML tags. Scan each section before outputting — if ANY Chinese characters remain, translate them immediately.${schemaInstructions}${glossaryBlock}`;

  const sourceHint = sourceLang && sourceLang !== 'auto' ? ` (from ${sourceLang})` : '';
  const user = `Translate these ${items.length} sections${sourceHint} to ${targetLang}. Keep the ${DELIMITER}N${DELIMITER} delimiters. Return ONLY translations. IMPORTANT: Translate ALL Chinese text in every section — ZERO Chinese characters should remain in the output:\n\n${combinedText}`;

  // Call provider
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (signal?.aborted) throw new Error('Cancelled');

      const controller = new AbortController();
      const timeout = (config.requestTimeout || 300000) * 6; // 6× timeout for batch (large batches with many sections need more time)
      const timeoutId = setTimeout(() => controller.abort('Batch request timeout'), timeout);

      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      const rawResult = await callProvider(config, system, user, combinedSignal);
      clearTimeout(timeoutId);

      // Parse response by delimiters
      const results = parseBatchResponse(rawResult, items.length);

      // ═══ RESIDUAL CJK CHECK for each batch result ═══
      // Single-field translateText() always runs postTranslationResidualCheck(),
      // but batch mode was missing this — causing residual Chinese in batch translations.
      const isTargetCJK = /chinese|japanese|korean/i.test(targetLang);
      if (!isTargetCJK) {
        for (let ri = 0; ri < results.length; ri++) {
          if (results[ri] && results[ri].trim() && items[ri]) {
            const origChinese = countChineseChars(items[ri].text);
            const residual = countChineseChars(results[ri]);
            if (origChinese >= 3 && residual > 2) {
              try {
                results[ri] = await postTranslationResidualCheck(
                  items[ri].text, results[ri], items[ri].fieldName,
                  config, targetLang, sourceLang, combinedSignal,
                  undefined, undefined
                );
              } catch (residualErr) {
                console.warn(`[BatchResidualCheck] ${items[ri].fieldName}: cleanup failed, keeping original`, residualErr);
              }
            }
          }
        }
      }

      return results;
    } catch (err) {
      lastError = err as Error;
      if (signal?.aborted) throw err;
      if (err instanceof ApiError && !err.retryable) throw err;

      if (attempt < config.maxRetries) {
        const baseDelay = config.retryDelay || 1000;
        await sleep(Math.min(baseDelay * Math.pow(2, attempt), 30000));
      }
    }
  }

  if (lastError) throw lastError;
  return items.map(() => ''); // Fallback
}

/* ─── Parse batch response into individual translations ─── */
function parseBatchResponse(response: string, expectedCount: number): string[] {
  const results: string[] = new Array(expectedCount).fill('');

  // Strategy 1: Split by ===N=== delimiters (exact or with spaces)
  const sectionRegex = /===\s*(\d+)\s*===/g;
  const matches: { index: number; num: number; fullMatch: string }[] = [];
  let match;

  while ((match = sectionRegex.exec(response)) !== null) {
    matches.push({ index: match.index, num: parseInt(match[1], 10), fullMatch: match[0] });
  }

  if (matches.length >= Math.min(expectedCount, 2)) {
    for (let i = 0; i < matches.length; i++) {
      const num = matches[i].num;
      if (num < 1 || num > expectedCount) continue;

      const startIdx = matches[i].index + matches[i].fullMatch.length;
      const endIdx = i + 1 < matches.length ? matches[i + 1].index : response.length;
      const text = response.slice(startIdx, endIdx).trim();
      if (text) results[num - 1] = text;
    }

    // Check if we got most results
    const filledCount = results.filter(r => r.trim()).length;
    if (filledCount >= expectedCount * 0.5) return results;
  }

  // Strategy 2: Try ---N--- or [N] delimiters
  const altRegex = /(?:---\s*(\d+)\s*---|^\[(\d+)\]\s*)/gm;
  const altMatches: { index: number; num: number; fullMatch: string }[] = [];

  while ((match = altRegex.exec(response)) !== null) {
    const num = parseInt(match[1] || match[2], 10);
    altMatches.push({ index: match.index, num, fullMatch: match[0] });
  }

  if (altMatches.length >= Math.min(expectedCount, 2)) {
    for (let i = 0; i < altMatches.length; i++) {
      const num = altMatches[i].num;
      if (num < 1 || num > expectedCount) continue;

      const startIdx = altMatches[i].index + altMatches[i].fullMatch.length;
      const endIdx = i + 1 < altMatches.length ? altMatches[i + 1].index : response.length;
      const text = response.slice(startIdx, endIdx).trim();
      if (text) results[num - 1] = text;
    }

    const filledCount = results.filter(r => r.trim()).length;
    if (filledCount >= expectedCount * 0.5) return results;
  }

  // Strategy 3: Line-by-line numbered patterns like "1. text" or "1: text"
  const lines = response.split('\n');
  const numberedLine = /^(\d+)[.:)\]]\s+(.+)/;
  let foundNumbered = 0;
  for (const line of lines) {
    const m = line.trim().match(numberedLine);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= expectedCount) {
        if (!results[num - 1]) results[num - 1] = m[2].trim();
        foundNumbered++;
      }
    }
  }
  if (foundNumbered >= expectedCount * 0.5) return results;

  // Strategy 4: Split by double newlines as last resort
  const parts = response.split(/\n\n+/).filter(p => p.trim());
  for (let i = 0; i < Math.min(parts.length, expectedCount); i++) {
    if (!results[i]) {
      results[i] = parts[i].replace(/===\s*\d+\s*===/g, '').replace(/---\s*\d+\s*---/g, '').trim();
    }
  }

  return results;
}

/* ─── Test connection ─── */
export async function testConnection(config: ProxySettings): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await translateText(
      'Hello, this is a connection test.',
      'test',
      { ...config, maxRetries: 0 },
      'English',
      'auto'
    );
    if (result) {
      const proxyNote = config.useCorsProxy ? ' (via CORS proxy)' : '';
      return { ok: true, message: `Connected${proxyNote}! Response: "${result.slice(0, 60)}..."` };
    }
    return { ok: false, message: 'Empty response from API' };
  } catch (err) {
    if (err instanceof ApiError && err.isCorsError) {
      return { ok: false, message: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
      if (config.useCorsProxy) {
        return { ok: false, message: `Cannot reach API through CORS proxy. Make sure 'npm run dev' is running and the API URL is correct: ${config.proxyUrl}` };
      }
      return { ok: false, message: `CORS/Network error reaching ${config.proxyUrl}. Try enabling the "CORS Proxy" toggle in API settings.` };
    }
    return { ok: false, message: msg };
  }
}

/* ─── Model suggestions per provider ─── */
export function getModelSuggestions(provider: AIProvider): string[] {
  switch (provider) {
    case 'openai':
    case 'custom':
      return [
        // OpenAI latest (2026)
        'gpt-5.4', 'gpt-5.3-instant', 'gpt-5.3-codex',
        'gpt-5.2', 'o3-mini', 'o3-pro',
        'gpt-4o', 'gpt-4.1',
        // DeepSeek
        'deepseek-chat', 'deepseek-reasoner',
        // Qwen
        'qwen3-235b-a22b', 'qwen3-32b', 'qwen3-30b-a3b',
        // Claude via proxy
        'claude-4-7-opus-202604', 'claude-4-6-sonnet-202602',
        // Gemini via proxy
        'gemini-3.1-pro', 'gemini-3.1-flash-lite',
      ];
    case 'anthropic':
      return [
        'claude-4-7-opus-202604',
        'claude-4-6-sonnet-202602',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
      ];
    case 'google':
      return [
        'gemini-3.1-pro-preview', 'gemini-3.1-pro', 'gemini-3.1-flash-lite',
        'gemini-3.1-flash-live',
        'gemini-2.5-pro-preview-05-06', 'gemini-2.5-pro', 'gemini-2.5-flash',
        'gemini-1.5-pro', 'gemini-1.5-flash',
      ];
    default:
      return [];
  }
}

/* ─── Default proxy URLs per provider ─── */
export function getDefaultProxyUrl(provider: AIProvider): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'custom':
    default:
      return 'http://localhost:8080/v1';
  }
}

/* ─── Generate new lorebook entries via AI ─── */
export async function generateLorebookEntries(
  config: ProxySettings,
  cardContext: string,
  existingEntryNames: string[],
  modInstructions: string,
  signal?: AbortSignal,
): Promise<Partial<CharacterBookEntry>[]> {
  const systemPrompt = LOREBOOK_GENERATION_PROMPT;

  const userMsg = `[MOD INSTRUCTIONS]
${modInstructions}

[EXISTING LOREBOOK ENTRIES — KHÔNG TẠO TRÙNG]
${existingEntryNames.length > 0 ? existingEntryNames.map((n, i) => `${i + 1}. ${n}`).join('\n') : '(Chưa có entry nào)'}

[CARD CONTENT — Phân tích để tìm nhân vật/khái niệm/địa điểm cần tạo entry]
${cardContext}`;

  const raw = await callProvider(config, systemPrompt, userMsg, signal);

  // Strip markdown code fences if present
  let jsonStr = raw.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to find JSON array in the response
    const match = jsonStr.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        console.error('[generateLorebookEntries] Failed to parse JSON:', jsonStr.slice(0, 500));
        throw new Error('AI response is not valid JSON');
      }
    } else {
      console.error('[generateLorebookEntries] No JSON array found:', jsonStr.slice(0, 500));
      throw new Error('AI response does not contain a JSON array');
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not a JSON array');
  }

  // Validate each entry has at minimum name and content
  const entries: Partial<CharacterBookEntry>[] = parsed
    .filter((e: any) => e && typeof e === 'object' && typeof e.name === 'string' && typeof e.content === 'string')
    .map((e: any) => ({
      name: e.name,
      content: e.content,
      keys: Array.isArray(e.keys) ? e.keys.map(String) : [e.name],
      secondary_keys: Array.isArray(e.secondary_keys) ? e.secondary_keys.map(String) : [],
      comment: typeof e.comment === 'string' ? e.comment : '',
    }));

  console.log(`[generateLorebookEntries] AI returned ${parsed.length} entries, ${entries.length} valid`);
  return entries;
}
