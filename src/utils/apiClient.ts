import type { AIProvider, ProxySettings, GlossaryEntry, CharacterBookEntry } from '../types/card';
import {
  buildMasterSystemPrompt,
  extractTranslationFromResponse,
  fieldGroupToFieldType,
  type TranslationFieldType,
  type MasterPromptOptions,
} from './masterPrompt';
import { LOREBOOK_GENERATION_PROMPT } from './promptBuilder';
import { extractCJKTokens, reinsertTranslations } from './surgical';

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

/**
 * ChunkError — thrown when a multi-chunk translation fails partway through.
 * Carries the successfully translated chunks so the caller can save partial progress.
 */
export class ChunkError extends Error {
  completedChunks: string[];
  failedChunkIndex: number;
  totalChunks: number;
  originalError: Error;

  constructor(
    message: string,
    completedChunks: string[],
    failedChunkIndex: number,
    totalChunks: number,
    originalError: Error,
  ) {
    super(message);
    this.name = 'ChunkError';
    this.completedChunks = completedChunks;
    this.failedChunkIndex = failedChunkIndex;
    this.totalChunks = totalChunks;
    this.originalError = originalError;
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
    - WESTERN/FANTASY NAMES EXCEPTION: For non-Chinese names (Western, European, Fantasy, Sci-fi) phonetically transcribed into Chinese characters (e.g., 维拉→Vera, 塞勒涅→Selene, 亚瑟→Arthur, 艾琳→Irene), restore them to their original Latin spelling. NEVER apply Hán Việt to these phonetic transcriptions (e.g., NEVER output "Vi Lạp", "Tắc Lặc Niết"). Hán Việt applies EXCLUSIVELY to native Chinese names.
    - Use natural roleplay pronouns (e.g., tôi/bạn, anh/em, hắn/nàng/y) suitable for the context, avoiding rigid direct translation of pronouns (like 'ngươi/ta' unless it's a historical setting).
    - Ensure correct Vietnamese word order and grammar for placeholders/macros like {{user}} or {{char}}. For possessive/object constructs (e.g., A's B / A的B), translate as "B của A" (e.g., "B của {{user}}") instead of placing {{user}} at the beginning/end or displacing it.
      * Example: "{{user}}的茶会肉便器" ➔ "tiệc trà đồ nội thất bằng thịt của {{user}}" (NOT: "{{user}}Đồ nội thất bằng thịt của tiệc trà").
      * Example: "承受{{user}}的侵犯" ➔ "chịu đựng sự xâm phạm của {{user}}" (NOT: "chịu đựng sự xâm phạm của - ... {{user}}").
      * Example: "夹紧{{user}}肉棒的双腿" ➔ "đôi chân đang kẹp chặt gậy thịt của {{user}}" (NOT: "đôi chân đang kẹp chặt - ... {{user}}").
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
    - WESTERN/FANTASY NAMES: Non-Chinese names phonetically transcribed into CJK (e.g., 维拉→Vera, 塞勒涅→Selene, 亚瑟→Arthur) → restore to original Latin spelling. NEVER apply Hán Việt to these.
    - Keep honorifics as-is or map to Vietnamese equivalents based on context (-san, -chan, -sama).
12. CRITICAL: The output must contain ONLY the translated text in ${targetLang}. Do NOT include source language text. Do NOT pair original text with translation. Do NOT use arrows (→) or colons (:) to show before/after.
13. CRITICAL: You MUST translate the COMPLETE text. Do NOT stop early. Do NOT summarize or truncate. If the text is very long, translate ALL of it from start to finish.
14. CRITICAL: ABSOLUTELY NO untranslated source language characters (e.g., Chinese Hanzi, Japanese Kanji) should remain in the final output. You MUST translate every single word into ${targetLang} unless it is a specific system variable name (like {{char}}). This includes: section headers, YAML-like key names, parenthetical annotations, labels, category names, and text inside XML tags. After translating, scan your ENTIRE output for any remaining Chinese characters — if you find ANY, translate them immediately.
15. LOREBOOK SPECIFIC: Lorebook entries commonly have Chinese text that gets missed during translation. You MUST translate ALL of these: Chinese section headers (e.g., "人物设定："), Chinese YAML keys (e.g., "外貌:"), Chinese annotations in parentheses (e.g., "(可爱的)"), Chinese text inside XML tags (e.g., <tag>中文内容</tag>), and any Chinese text mixed with already-translated Vietnamese text. The final output must have ZERO Chinese characters.
16. CRITICAL: Do NOT translate URLs, file paths, or image links. Never modify any part of a URL, web link, file path, or image source (e.g., https://..., src="...", href="...", url(...), .html, .png, .jpg), even if they contain foreign characters. Translating links will break them and cause 404 errors.${vietnameseRules}`;
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

    const safetyRule = `\n\nCRITICAL RULE: ABSOLUTELY NO untranslated source language characters (e.g., Chinese Hanzi, Japanese Kanji) should remain in the final output. You MUST translate every single word into ${targetLang} unless it is a specific system variable name (like {{char}}).${vietnameseSafetyRule}\n    - PROPER NOUN RULE: Chinese proper nouns → Hán Việt. Japanese proper nouns → Romaji (NOT Hán Việt). Western/Fantasy names phonetically transcribed into CJK → restore to original Latin spelling (NOT Hán Việt). Do NOT mix up these systems.`;

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
  const afterAt = slice.slice(lastAt);
  let depth = 0;
  for (const ch of afterAt) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth > 0;
}

/**
 * Check if position is inside a URL (src="...", href="...", or standalone https://...).
 * Splitting inside a URL will break the link.
 */
function isInsideUrl(text: string, pos: number): boolean {
  const scanLen = Math.min(pos, 500);
  const slice = text.slice(pos - scanLen, pos);
  if (/(?:src|href|url|action|data-src|data-url|poster|srcset)\s*=\s*["'][^"']*$/i.test(slice)) return true;
  if (/url\s*\(\s*["']?[^)"']*$/i.test(slice)) return true;
  if (/https?:\/\/[^\s<>"')\]]*$/i.test(slice)) return true;
  return false;
}

/**
 * Check if a candidate split position is "safe" — i.e., not inside a template literal,
 * EJS block, regex pattern, function body, script/style block, HTML tag, CSS block,
 * URL, or unbalanced JSON/code structure.
 * Returns true if it is safe to split at `pos`.
 */
function isSafeBoundary(text: string, pos: number): boolean {
  const before = text.slice(0, pos);

  // 1. Backtick balance
  const backtickCount = countUnescapedBackticks(text, pos, 10000);
  if (backtickCount % 2 !== 0) return false;

  // 2. EJS tag balance
  const ejsOpens = (before.match(/<%/g) || []).length;
  const ejsCloses = (before.match(/%>/g) || []).length;
  if (ejsOpens > ejsCloses) return false;

  // 3. Triple-backtick code fence balance
  const codeBlockMarkers = (before.match(/```/g) || []).length;
  if (codeBlockMarkers % 2 !== 0) return false;

  // 4. Brace/bracket balance
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
  if (braceDepth > 2) return false;
  if (bracketDepth > 2) return false;
  if (parenDepth > 2) return false;

  // 5. Function body detection
  if (isInsideFunctionBody(text, pos)) return false;

  // 6. Script/style block detection
  if (isInsideScriptOrStyle(text, pos)) return false;

  // 7. String literal detection
  if (isInsideStringLiteral(text, pos)) return false;

  // 8. Regex literal detection
  if (isInsideRegexLiteral(text, pos)) return false;

  // 9. HTML tag detection
  if (isInsideHtmlTag(text, pos)) return false;

  // 10. CSS @-rule block detection
  if (isInsideCssAtRule(text, pos)) return false;

  // 11. URL detection — splitting inside a URL breaks links and image sources
  if (isInsideUrl(text, pos)) return false;

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
  // Default chunk size depends on content type.
  // Code-heavy content (regex HTML, embedded scripts) needs smaller chunks
  // because AI output limit (~8K-65K tokens) can't reproduce 100K chars of code 1:1.
  if (maxChars === undefined) {
    const codeSignals = [
      /<style[\s>]/i.test(text),
      /<script[\s>]/i.test(text),
      (text.match(/\{/g) || []).length > 50,
      (text.match(/<[a-z][^>]*>/gi) || []).length > 100,
    ].filter(Boolean).length;
    // Code-heavy: 30K chars ≈ 10K tokens output — safe for all models
    // Normal text: 100K chars ≈ 30K tokens
    maxChars = codeSignals >= 2 ? 30000 : 100000;
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
      // Flexible hard cut: search within +/- 5% tolerance of maxChars
      const tolerance = Math.floor(maxChars * 0.05);
      const startSearch = Math.max(0, maxChars - tolerance);
      const endSearch = Math.min(remaining.length, maxChars + tolerance);
      const searchRange = remaining.slice(startSearch, endSearch);
      
      // Look for best fallback separator in this tolerance range
      // Priority: pipe (for regex), newline, semicolon, comma, space, period
      const fallbackSeps = ['|', '\n', ';', ',', ' ', '.'];
      let bestPos = -1;
      
      for (const sep of fallbackSeps) {
        // Find nearest separator to maxChars (which corresponds to index 'tolerance' in searchRange)
        const targetIdx = tolerance;
        let nearestDist = Infinity;
        let idx = searchRange.indexOf(sep);
        while (idx !== -1) {
          const dist = Math.abs(idx - targetIdx);
          if (dist < nearestDist) {
            nearestDist = dist;
            bestPos = startSearch + idx + sep.length;
          }
          idx = searchRange.indexOf(sep, idx + 1);
        }
        if (bestPos !== -1) break;
      }
      
      if (bestPos !== -1) {
        splitIdx = bestPos;
        console.log(`[chunkText] ⚠️ Flexible hard cut at ${splitIdx} (within 5% tolerance of ${maxChars}) using fallback separator`);
      } else {
        splitIdx = maxChars;
        console.warn(`[chunkText] ⚠️ HARD CUT at ${maxChars} — no safe boundary or fallback separator found in tolerance range.`);
      }
    }

    chunks.push(remaining.slice(0, splitIdx));
    // Never trimStart to ensure exact reconstruction when joining with ''
    remaining = remaining.slice(splitIdx);

    // Guard: if remaining is only whitespace, append to last chunk instead of creating empty chunk
    if (remaining.length > 0 && remaining.trim().length === 0) {
      if (chunks.length > 0) {
        chunks[chunks.length - 1] += remaining;
      }
      break;
    }
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
  
  // Google Models
  // Nếu model chứa "-pro" (ví dụ: gemini-3.1-pro, gemini-2.5-pro) thì hỗ trợ 65535 tokens
  if (model.includes('-pro') || model.includes('gemini-3.1-pro') || model.includes('gemini-2.5-pro')) {
    return 65535;
  }
  if (model.includes('flash') || model.includes('gemini-3.') || model.includes('gemini-2.0') || model.includes('gemini-1.5')) {
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
  
  // Default fallback
  return 8192;
}

/* ─── OpenAI-compatible API call ─── */
async function callOpenAICompatible(
  config: ProxySettings,
  system: string,
  user: string,
  signal?: AbortSignal,
  images?: string[]
): Promise<string> {
  const useStream = config.useStream !== false;
  const rawUrl = config.proxyUrl.replace(/\/+$/, '') + '/chat/completions';
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);

  const userContent: any[] = [{ type: 'text', text: user }];
  if (images && images.length > 0) {
    images.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: img }
      });
    });
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: images && images.length > 0 ? userContent : user },
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
  signal?: AbortSignal,
  images?: string[]
): Promise<string> {
  const useStream = config.useStream !== false;
  const rawUrl = config.proxyUrl.replace(/\/+$/, '') + '/messages';
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);

  const userContent: any[] = [{ type: 'text', text: user }];
  if (images && images.length > 0) {
    images.forEach(img => {
      const match = img.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2]
          }
        });
      }
    });
  }

  const body = {
    model: config.model,
    max_tokens: getMaxOutputTokens(config.model, config.maxTokens),
    system,
    messages: [{ role: 'user', content: images && images.length > 0 ? userContent : user }],
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
  signal?: AbortSignal,
  images?: string[]
): Promise<string> {
  const useStream = config.useStream !== false;
  const baseUrl = config.proxyUrl.replace(/\/+$/, '');
  const endpoint = useStream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
  const rawUrl = `${baseUrl}/models/${config.model}:${endpoint}key=${config.apiKey}`;
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);

  const parts: any[] = [{ text: user }];
  if (images && images.length > 0) {
    images.forEach(img => {
      const match = img.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      }
    });
  }

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: parts }],
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
  signal?: AbortSignal,
  images?: string[]
): Promise<string> {
  // ═══ Rate limit gate ═══
  await waitForRateLimit(signal);

  // Create a config copy with rotated key
  const activeKey = getRotatedKey(config);
  const rotatedConfig = { ...config, apiKey: activeKey };

  try {
    switch (config.provider) {
      case 'anthropic':
        return await callAnthropic(rotatedConfig, system, user, signal, images);
      case 'google':
        return await callGemini(rotatedConfig, system, user, signal, images);
      case 'openai':
      case 'custom':
      default:
        return await callOpenAICompatible(rotatedConfig, system, user, signal, images);
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
// When isChunkedPart=true, arrow cleanup is SKIPPED because chunks are fragments that
// may legitimately contain → characters (CSS, code, mapping notations).
function cleanTranslationResponse(original: string, translated: string, isExpertMode?: boolean, isChunkedPart?: boolean): string {
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

  // ═══ EMBEDDED BACKTICK REPAIR ═══
  // AI sometimes injects ``` INSIDE code strings when translating large minified JS.
  // e.g. 'editor-node' → 'editor-n```ode', `${var}` → `${var}```
  // Detect by comparing: if original has fewer ``` occurrences than translated,
  // the extras are AI hallucinations that must be removed.
  const repairEmbeddedBackticks = (orig: string, trans: string): string => {
    const origCount = (orig.match(/```/g) || []).length;
    const transCount = (trans.match(/```/g) || []).length;
    if (transCount > origCount) {
      // Remove ``` that are embedded within code (not at line start/end as fences)
      // Pattern: ``` preceded and/or followed by non-whitespace (embedded in identifiers/strings)
      let repaired = trans.replace(/(?<=\S)```(?=\S)/g, '');
      // Also handle ``` at word boundaries that don't match original structure
      if ((repaired.match(/```/g) || []).length > origCount) {
        repaired = repaired.replace(/(?<=\S)```/g, '');
      }
      if ((repaired.match(/```/g) || []).length > origCount) {
        repaired = repaired.replace(/```(?=\S)/g, '');
      }
      return repaired;
    }
    return trans;
  };

  const isHtmlContent = /<[a-z][^>]*>/i.test(original) && /<\/[a-z]+>/i.test(original);
  if (isHtmlContent) {
    // For HTML content, apply code fence logic + embedded backtick repair (safe operation)
    let cleaned = stripMarkdownFences(translated, original);
    cleaned = repairEmbeddedBackticks(original, cleaned);
    return cleaned.trim() || translated.trim();
  }

  let cleaned = stripMarkdownFences(translated, original);
  cleaned = repairEmbeddedBackticks(original, cleaned);

  // Pattern 1: Full text "original → translation" or "original -> translation"
  // The AI sometimes returns "Chinese text → Vietnamese text"
  // SKIP for chunked parts — chunks are text fragments where → is often legitimate content.
  // This hallucination mostly happens on short texts. For very long texts (>2000 chars),
  // it's almost certainly a legitimate arrow in the code/regex.
  if (original.length < 2000 && !isChunkedPart) {
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
  }

  // Pattern 2: Backtick-wrapped pairs like `original` → `translation`
  // Also skip for chunked parts to avoid stripping legitimate content
  if (!isChunkedPart) {
    cleaned = cleaned.replace(/`[^`]+`\s*[→➜➡⇒]\s*`([^`]+)`/g, '$1');
    cleaned = cleaned.replace(/`[^`]+`\s*->\s*`([^`]+)`/g, '$1');
  }

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
  const normalize = (str: string) => str.replace(/\s+/g, '').toLowerCase();
  const aNorm = normalize(a);
  const bNorm = normalize(b);
  
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1.0;
  
  // If b is a large substring of a
  if (aNorm.includes(bNorm)) return bNorm.length / aNorm.length;
  if (bNorm.includes(aNorm)) return aNorm.length / bNorm.length;
  
  // Use word-level overlap instead of character sets (which fails for long strings)
  const aWords = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const bWords = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  let overlap = 0;
  for (const w of bWords) {
    if (aWords.has(w)) overlap++;
  }
  return overlap / Math.max(aWords.size, 1);
}

export interface StructuralCheckResult {
  isTruncated: boolean;
  reason: string;
}

export function isStructuralChar(char: string): boolean {
  return /[\{\}\[\]\(\):,;'"\`<>\/]/.test(char);
}

export function getStructure(str: string): string {
  let struct = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (isStructuralChar(char)) {
      struct += char;
    }
  }
  return struct;
}

function getLcpLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}

export function recoverTruncatedTail(original: string, translation: string): string {
  const origStruct = getStructure(original);
  const transStruct = getStructure(translation);
  const lcpLength = getLcpLength(transStruct, origStruct);
  
  let structCount = 0;
  let splitIdx = 0;
  
  if (lcpLength > 0) {
    for (let i = 0; i < original.length; i++) {
      const char = original[i];
      if (isStructuralChar(char)) {
        structCount++;
        if (structCount === lcpLength) {
          splitIdx = i + 1;
          break;
        }
      }
    }
  } else {
    splitIdx = Math.min(original.length, translation.length);
  }

  const tail = original.slice(splitIdx);
  
  // ═══ SAFETY GUARD: prevent content doubling ═══
  // If the tail to append is too large relative to original, it's likely a false positive
  // from detectStructuralTruncation (minor structural differences between languages).
  // A genuine truncation typically loses 5-25% of the content, not 50%+.
  const tailRatio = tail.length / Math.max(1, original.length);
  const resultWouldBe = translation.length + tail.length;
  const sizeRatio = resultWouldBe / Math.max(1, original.length);
  
  if (tailRatio > 0.30) {
    console.warn(`[recoverTruncatedTail] SKIPPED: tail is ${(tailRatio * 100).toFixed(0)}% of original (${tail.length}/${original.length} chars) — likely false positive truncation detection`);
    return translation;
  }
  
  if (sizeRatio > 1.5) {
    console.warn(`[recoverTruncatedTail] SKIPPED: result would be ${(sizeRatio * 100).toFixed(0)}% of original (${resultWouldBe} chars vs ${original.length}) — would cause content bloat`);
    return translation;
  }
  
  // Adjust quote seam
  const trimmedTrans = translation.trimEnd();
  const trimmedTail = tail.trimStart();
  
  if (trimmedTrans && trimmedTail) {
    const lastChar = trimmedTrans.slice(-1);
    const firstChar = trimmedTail.slice(0, 1);
    if ((lastChar === "'" || lastChar === '"' || lastChar === '`') && firstChar === lastChar) {
      console.log(`[recoverTruncatedTail] Appending ${tail.length} chars of original tail (quote seam adjusted)`);
      return translation + tail.slice(tail.indexOf(firstChar) + 1);
    }
  }
  
  console.log(`[recoverTruncatedTail] Appending ${tail.length} chars of original tail`);
  return translation + tail;
}

export function detectStructuralTruncation(original: string, translation: string): StructuralCheckResult {
  if (!original || !translation) {
    return { isTruncated: false, reason: '' };
  }

  const trimmedTrans = translation.trim();
  const trimmedOrig = original.trim();
  if (trimmedTrans.endsWith('...') && !trimmedOrig.endsWith('...')) {
    return { isTruncated: true, reason: 'Ends with literal ellipsis "..."' };
  }

  // Bracket Balance Checks (paren, bracket, brace)
  const getBracketBalances = (str: string) => {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (i > 0 && str[i - 1] === '\\') continue;
      if (char === '(') paren++;
      else if (char === ')') paren--;
      else if (char === '[') bracket++;
      else if (char === ']') bracket--;
      else if (char === '{') brace++;
      else if (char === '}') brace--;
    }
    return { paren, bracket, brace };
  };

  const origBrackets = getBracketBalances(original);
  const transBrackets = getBracketBalances(translation);

  if (transBrackets.paren > Math.max(0, origBrackets.paren) && Math.abs(transBrackets.paren - origBrackets.paren) > 2) {
    return { isTruncated: true, reason: `Unbalanced parentheses (excess open: ${transBrackets.paren} vs original: ${origBrackets.paren})` };
  }
  if (transBrackets.bracket > Math.max(0, origBrackets.bracket) && Math.abs(transBrackets.bracket - origBrackets.bracket) > 2) {
    return { isTruncated: true, reason: `Unbalanced square brackets (excess open: ${transBrackets.bracket} vs original: ${origBrackets.bracket})` };
  }
  if (transBrackets.brace > Math.max(0, origBrackets.brace) && Math.abs(transBrackets.brace - origBrackets.brace) > 2) {
    return { isTruncated: true, reason: `Unbalanced curly braces (excess open: ${transBrackets.brace} vs original: ${origBrackets.brace})` };
  }

  // String Quote Balance Checks
  const getQuoteCounts = (str: string) => {
    let single = 0;
    let double = 0;
    let backtick = 0;
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        single++;
      } else if (char === '"') {
        double++;
      } else if (char === '`') {
        backtick++;
      }
    }
    return { single, double, backtick };
  };

  const origQuotes = getQuoteCounts(original);
  const transQuotes = getQuoteCounts(translation);

  // NOTE: Only check backtick balance (code-critical). Skip single/double quotes
  // because translation legitimately changes quote parity (Vietnamese contractions,
  // different quoting conventions, etc.) — these are NOT reliable truncation signals.
  if (origQuotes.backtick % 2 === 0 && transQuotes.backtick % 2 !== 0) {
    return { isTruncated: true, reason: 'Odd number of backticks (unclosed template literal)' };
  }

  // HTML tag balance checks
  const getHtmlTagBalances = (str: string) => {
    const counts: { [tag: string]: number } = {};
    const tagRegex = /<\/?([a-zA-Z1-6]+)(?:\s+[^>]*)*>/g;
    let match;
    const selfClosing = ['br', 'img', 'hr', 'input', 'link', 'meta', 'col', 'embed', 'source', 'track', 'wbr'];
    
    while ((match = tagRegex.exec(str)) !== null) {
      const fullTag = match[0];
      const isClose = fullTag.startsWith('</');
      const tagName = match[1].toLowerCase();
      
      if (selfClosing.includes(tagName) || fullTag.endsWith('/>')) {
        continue;
      }
      
      if (!counts[tagName]) counts[tagName] = 0;
      if (isClose) {
        counts[tagName]--;
      } else {
        counts[tagName]++;
      }
    }
    return counts;
  };

  const origTags = getHtmlTagBalances(original);
  const transTags = getHtmlTagBalances(translation);

  for (const tag in transTags) {
    const origVal = origTags[tag] || 0;
    const transVal = transTags[tag] || 0;
    // Only flag if excess is >1 to avoid false positives from minor tag differences
    if (transVal > Math.max(0, origVal) && (transVal - origVal) > 1) {
      return { isTruncated: true, reason: `Unclosed HTML tag <${tag}> (excess open: ${transVal} vs original: ${origVal})` };
    }
  }

  // Sudden ending checks
  if (original.length > 50) {
    const lastCharOrig = trimmedOrig.slice(-1);
    const lastCharTrans = trimmedTrans.slice(-1);
    const isPunctuation = (c: string) => /[;\}\]\)>\.\?\!"'`\n]/.test(c);
    
    if (isPunctuation(lastCharOrig) && !isPunctuation(lastCharTrans)) {
      if (/[,:\[\(\{]/.test(lastCharTrans)) {
        return { isTruncated: true, reason: `Ends abruptly with invalid trailing character "${lastCharTrans}"` };
      }
      if (/[\}\]\)>'"`]/.test(lastCharOrig) && /\w/.test(lastCharTrans)) {
        return { isTruncated: true, reason: `Ends with word character "${lastCharTrans}" but original ends with closing structural character "${lastCharOrig}"` };
      }
    }
  }

  return { isTruncated: false, reason: '' };
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
  /** Mod mode: skip bloat guards since output can legitimately be much larger than input */
  isModMode = false,
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

      // ═══ Expert Mode: detect <translation> bị cắt ngang ═══
      // AI output đủ reasoning nhưng <translation> không có </translation>
      // → reasoning ăn hết output tokens, bản dịch bị truncated
      if (config.expertMode) {
        const hasTransOpen = /<translation>/i.test(result);
        const hasTransClose = /<\/translation>/i.test(result);
        if (hasTransOpen && !hasTransClose) {
          // Extract partial translation để dùng cho continuation
          const partialMatch = result.match(/<translation>\s*([\s\S]+)$/i);
          if (partialMatch) {
            // Chỉ giữ phần translation, bỏ reasoning để continuation nhận đúng
            result = partialMatch[1].trim();
            console.warn(`[translateChunk] Expert Mode: <translation> bị cắt ngang (${result.length} chars partial) — reasoning ăn quá nhiều output tokens. Sẽ trigger continuation.`);
          }
        }
      }

      // ─── Multi-round truncation detection & continuation ───
      // Nếu AI trả về < input → gần chắc chắn bị cắt do max output tokens.
      // Code-heavy content (như Regex, Custom Code) thường có tỷ lệ 1:1 do code giữ nguyên.
      // CJK→Latin expansion: CJK text is very compact (~1 char = 1 word), Vietnamese/English
      // translations are 1.3-2x longer. Adjust threshold so continuation triggers correctly.
      const isCodeHeavy = fieldName.toLowerCase().includes('regex') || fieldName.toLowerCase().includes('code') || fieldName.toLowerCase().includes('script') || fieldName.toLowerCase().includes('helper');
      const cjkRatioInChunk = getCJKRatio(chunk);
      // High CJK ratio = expect longer output, so raise threshold to avoid premature stop
      const cjkExpansionFactor = cjkRatioInChunk > 0.3 ? 1.4 : (cjkRatioInChunk > 0.1 ? 1.2 : 1.0);
      // Code-heavy: ratio thấp là bình thường (code giữ nguyên, chỉ dịch CJK)
      // Giảm threshold để không trigger continuation vô ích
      const CONT_THRESHOLD = isCodeHeavy ? 0.50 : Math.min(0.7 * cjkExpansionFactor, 0.95);
      const MAX_CONT_ROUNDS = 5;

      if (chunk.length > 500 && result.length > 0) {
        for (let contRound = 0; contRound < MAX_CONT_ROUNDS; contRound++) {
          const responseRatio = result.length / chunk.length;
          
          if (responseRatio >= CONT_THRESHOLD) {
            const structuralCheck = detectStructuralTruncation(chunk, result);
            if (!structuralCheck.isTruncated) {
              break;
            }
            console.log(`[translateChunk] Structural truncation detected in ${fieldName} chunk ${chunkIdx + 1}/${totalChunks} despite ratio ${(responseRatio * 100).toFixed(0)}%: ${structuralCheck.reason}`);
          } else if (isCodeHeavy && responseRatio >= 0.30) {
            // Code-heavy: ratio thấp là bình thường (code giữ nguyên, chỉ dịch CJK rải rác)
            // Kiểm tra structural — nếu cấu trúc OK thì dịch xong rồi, dừng continuation
            const structuralCheck = detectStructuralTruncation(chunk, result);
            if (!structuralCheck.isTruncated) {
              console.log(`[translateChunk] Code-heavy ${fieldName}: ratio ${(responseRatio * 100).toFixed(0)}% but structure OK — skipping continuation`);
              break;
            }
          }

          console.log(`[translateChunk] ${fieldName} chunk ${chunkIdx + 1}/${totalChunks}: response ${(responseRatio * 100).toFixed(0)}% < ${(CONT_THRESHOLD * 100).toFixed(0)}% (or structural issue) → continuation round ${contRound + 1}/${MAX_CONT_ROUNDS}...`);

          // ═══ SIZE GUARD: prevent bloat from false-positive structural checks ═══
          // If result is already bigger than the chunk, continuation is not needed.
          // MOD MODE: skip this guard — mod output can legitimately be much larger than input
          if (!isModMode && result.length > chunk.length * 1.8) {
            console.warn(`[translateChunk] STOPPING continuation: result (${result.length}) already > 1.8x chunk (${chunk.length}) — likely false positive truncation`);
            break;
          }

          // Estimate where in the original text we need to pick up
          // Account for CJK→Latin expansion: if source is mostly CJK, the translation
          // will be longer per-character, so we need to adjust the coverage estimate.
          const expectedExpansion = cjkRatioInChunk > 0.3 ? 1.4 : (cjkRatioInChunk > 0.1 ? 1.2 : 1.0);
          const adjustedResultRatio = result.length / (chunk.length * expectedExpansion);
          const estimatedCoverage = Math.min(Math.max(adjustedResultRatio - 0.05, 0.1), 0.95);
          const remainingOriginal = chunk.slice(Math.floor(chunk.length * estimatedCoverage));

          const continuationPrompt = `The previous translation was cut off at approximately ${(responseRatio * 100).toFixed(0)}% of the content. Continue translating from where you stopped.\n` +
            `The last translated text ended with: "${result.slice(-300)}"\n\n` +
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
              // ═══ SIZE GUARD: don't append if it would make result absurdly large ═══
              // MOD MODE: skip this guard — mod output can legitimately be much larger than input
              if (!isModMode && (result.length + continuation.length) > chunk.length * 2.5) {
                console.warn(`[translateChunk] SKIPPED continuation append: would make result ${result.length + continuation.length} chars (${((result.length + continuation.length) / chunk.length * 100).toFixed(0)}% of chunk) — likely duplicate content`);
                break;
              }
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
/* ─── AI Chunk Verification: compare original vs translated ─── */

/**
 * Quick structural comparison (no AI needed).
 * Returns a report string or null if structure is acceptable.
 */
function quickStructuralCheck(original: string, translated: string): string | null {
  const counts = (s: string) => ({
    backticks: (s.match(/`/g) || []).length,
    singleQ: (s.match(/'/g) || []).length,
    doubleQ: (s.match(/"/g) || []).length,
    parenOpen: (s.match(/\(/g) || []).length,
    parenClose: (s.match(/\)/g) || []).length,
    curlyOpen: (s.match(/\{/g) || []).length,
    curlyClose: (s.match(/\}/g) || []).length,
    brackets: (s.match(/[\[\]]/g) || []).length,
    tripleBacktick: (s.match(/```/g) || []).length,
  });
  
  const orig = counts(original);
  const trans = counts(translated);
  const issues: string[] = [];

  // Absolute thresholds for structural drift
  if (Math.abs(orig.backticks - trans.backticks) > 5) {
    issues.push(`backticks: ${orig.backticks}→${trans.backticks}`);
  }
  if (Math.abs(orig.singleQ - trans.singleQ) > 10) {
    issues.push(`single-quotes: ${orig.singleQ}→${trans.singleQ}`);
  }
  if (Math.abs(orig.parenOpen - trans.parenOpen) > 5) {
    issues.push(`parens(: ${orig.parenOpen}→${trans.parenOpen}`);
  }
  if (Math.abs(orig.curlyOpen - trans.curlyOpen) > 5) {
    issues.push(`braces{: ${orig.curlyOpen}→${trans.curlyOpen}`);
  }
  if (trans.tripleBacktick > orig.tripleBacktick) {
    issues.push(`triple-backtick injected: ${orig.tripleBacktick}→${trans.tripleBacktick}`);
  }
  
  // Length ratio check — translated should not be drastically shorter
  if (translated.length < original.length * 0.7) {
    issues.push(`length drop: ${original.length}→${translated.length} (${(translated.length/original.length*100).toFixed(0)}%)`);
  }

  return issues.length > 0 ? issues.join(', ') : null;
}

/**
 * AI-powered chunk verification. Sends a sample of original + translated to the AI
 * to detect corruption, missing content, and structural issues.
 * Returns: { ok: true } or { ok: false, repaired: string }
 */
async function verifyChunkIntegrity(
  originalChunk: string,
  translatedChunk: string,
  chunkIdx: number,
  totalChunks: number,
  fieldName: string,
  config: ProxySettings,
  targetLang: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; repaired?: string; issues?: string }> {
  // Step 1: Quick structural check (free, no API call)
  const structIssues = quickStructuralCheck(originalChunk, translatedChunk);
  if (!structIssues) {
    return { ok: true };
  }
  
  console.log(`[verifyChunk] Chunk ${chunkIdx + 1}/${totalChunks} structural issues: ${structIssues}`);
  
  // Step 2: AI verification — send a SAMPLE (not full chunk) to save tokens
  // Sample: first 2000 + last 2000 chars to catch head/tail corruption
  const sampleOrig = originalChunk.length > 5000
    ? originalChunk.slice(0, 2500) + '\n[...MIDDLE OMITTED...]\n' + originalChunk.slice(-2500)
    : originalChunk;
  const sampleTrans = translatedChunk.length > 5000
    ? translatedChunk.slice(0, 2500) + '\n[...MIDDLE OMITTED...]\n' + translatedChunk.slice(-2500)
    : translatedChunk;

  const verifySystem = `You are a translation integrity verifier for code-heavy content translated to ${targetLang}.
Compare the ORIGINAL and TRANSLATED samples below. Look for these specific issues:

1. **Markdown injection**: Triple backticks (\`\`\`) inserted inside JS strings/identifiers (e.g. 'editor-n\`\`\`ode')
2. **Unicode corruption**: Chinese characters corrupted into garbled text (e.g. 【 → ã??)  
3. **Missing code**: Brackets, quotes, or parentheses that exist in original but are missing in translated
4. **Extra characters**: Characters added by AI that don't exist in original
5. **Structural breaks**: Code structure broken by translation (template literals, regex patterns)

IMPORTANT: Only flag REAL structural damage. Translating Chinese text to ${targetLang} is CORRECT behavior.

DETECTED STRUCTURAL DRIFT: ${structIssues}

Respond in this exact format:
- If no real issues: VERIFIED_OK
- If issues found: ISSUES_FOUND\\n<description of each issue, one per line>`;

  const verifyUser = `=== ORIGINAL (chunk ${chunkIdx + 1}/${totalChunks} of "${fieldName}") ===
${sampleOrig}

=== TRANSLATED ===
${sampleTrans}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Verify timeout'), 60000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const result = await callProvider(config, verifySystem, verifyUser, combinedSignal);
    clearTimeout(timeout);

    if (result.trim().startsWith('VERIFIED_OK')) {
      console.log(`[verifyChunk] Chunk ${chunkIdx + 1}: AI verified OK despite structural drift`);
      return { ok: true };
    }

    // Issues found — log them
    const issueText = result.replace(/^ISSUES_FOUND\s*/i, '').trim();
    console.warn(`[verifyChunk] Chunk ${chunkIdx + 1} issues:\n${issueText}`);
    
    return { ok: false, issues: issueText };
  } catch (err) {
    // Verification failed — don't block translation, just log
    console.warn(`[verifyChunk] Chunk ${chunkIdx + 1} verification failed:`, err);
    return { ok: true }; // Fail-open: treat as ok if verification errors out
  }
}

/**
 * Post-join overall verification. Compares full original vs full translated
 * using structural analysis. No AI call — just quick metrics.
 */
function verifyFinalTranslation(
  original: string,
  translated: string,
  fieldName: string,
): { ok: boolean; report: string } {
  const issues: string[] = [];

  // 1. Length ratio
  const ratio = translated.length / original.length;
  if (ratio < 0.8) {
    issues.push(`⚠️ Bản dịch ngắn hơn gốc: ${(ratio * 100).toFixed(0)}% (${translated.length}/${original.length} chars)`);
  }

  // 2. Triple backtick injection
  const origTriple = (original.match(/```/g) || []).length;
  const transTriple = (translated.match(/```/g) || []).length;
  if (transTriple > origTriple) {
    issues.push(`⚠️ Markdown \`\`\` injection: gốc ${origTriple}, dịch ${transTriple} (+${transTriple - origTriple})`);
  }

  // 3. Bracket balance
  const bracketCheck = (text: string, open: string, close: string) => {
    const o = (text.match(new RegExp('\\' + open, 'g')) || []).length;
    const c = (text.match(new RegExp('\\' + close, 'g')) || []).length;
    return { open: o, close: c, balanced: o === c };
  };
  
  const origParens = bracketCheck(original, '(', ')');
  const transParens = bracketCheck(translated, '(', ')');
  if (origParens.balanced && !transParens.balanced) {
    issues.push(`⚠️ Parens bị mất cân bằng: gốc balanced, dịch (=${transParens.open} )=${transParens.close}`);
  }

  const origCurly = bracketCheck(original, '{', '}');
  const transCurly = bracketCheck(translated, '{', '}');
  if (origCurly.balanced && !transCurly.balanced) {
    issues.push(`⚠️ Braces bị mất cân bằng: gốc balanced, dịch {=${transCurly.open} }=${transCurly.close}`);
  }

  // 4. Single quote count drift
  const origSq = (original.match(/'/g) || []).length;
  const transSq = (translated.match(/'/g) || []).length;
  if (Math.abs(origSq - transSq) > 20) {
    issues.push(`⚠️ Single quotes drift: gốc ${origSq}, dịch ${transSq} (diff ${transSq - origSq})`);
  }

  const report = issues.length > 0
    ? `[verifyFinal] ${fieldName}:\n${issues.join('\n')}`
    : `[verifyFinal] ${fieldName}: ✅ All structural checks passed`;
  
  return { ok: issues.length === 0, report };
}

/* ─── Verify seam coherence between adjacent translated chunks ─── */
async function verifySeams(
  translatedChunks: string[],
  originalChunks: string[],
  config: ProxySettings,
  targetLang: string,
  signal?: AbortSignal,
  enableStructuralVerification?: boolean,
  isCodeHeavy?: boolean,
): Promise<string[]> {
  if (translatedChunks.length < 2) return translatedChunks;

  // Only check seams — the tail of chunk[i] + head of chunk[i+1]
  // Dynamic seam chars: scale with chunk size for better coverage on large texts
  const avgChunkSize = originalChunks.reduce((s, c) => s + c.length, 0) / originalChunks.length;
  const SEAM_CHARS = Math.min(Math.max(300, Math.floor(avgChunkSize * 0.02)), 800);
  
  interface SeamInfo {
    idx: number;
    tailOrig: string;
    headOrig: string;
    tailTrans: string;
    headTrans: string;
    structuralIssues?: string;
  }
  
  const seamIssues: SeamInfo[] = [];

  for (let i = 0; i < translatedChunks.length - 1; i++) {
    const tailTrans = translatedChunks[i].slice(-SEAM_CHARS);
    const headTrans = translatedChunks[i + 1].slice(0, SEAM_CHARS);
    const tailOrig = originalChunks[i].slice(-SEAM_CHARS);
    const headOrig = originalChunks[i + 1].slice(0, SEAM_CHARS);
    
    const seam: SeamInfo = { idx: i, tailOrig, headOrig, tailTrans, headTrans };
    
    // ═══ STRUCTURAL CHECK AT SEAM (when verification enabled) ═══
    if (enableStructuralVerification && isCodeHeavy) {
      const origBoundary = tailOrig + headOrig;
      const transBoundary = tailTrans + headTrans;
      const issues: string[] = [];

      // 1. Check quote/bracket balance at seam boundary
      const countChar = (s: string, ch: string) => {
        let n = 0;
        for (let j = 0; j < s.length; j++) if (s[j] === ch) n++;
        return n;
      };
      
      const origSq = countChar(origBoundary, "'");
      const transSq = countChar(transBoundary, "'");
      if (Math.abs(origSq - transSq) > 4) {
        issues.push(`quotes: ${origSq}→${transSq}`);
      }
      
      const origBt = countChar(origBoundary, '`');
      const transBt = countChar(transBoundary, '`');
      if (Math.abs(origBt - transBt) > 2) {
        issues.push(`backticks: ${origBt}→${transBt}`);
      }

      const origPo = countChar(origBoundary, '(');
      const transPo = countChar(transBoundary, '(');
      if (Math.abs(origPo - transPo) > 3) {
        issues.push(`parens: ${origPo}→${transPo}`);
      }

      // 2. Check for split string literals at seam
      // If tail ends mid-string (odd number of quotes) and head starts mid-string
      const tailTransSq = countChar(tailTrans, "'");
      const headTransSq = countChar(headTrans, "'");
      if (tailTransSq % 2 !== 0 && headTransSq % 2 !== 0) {
        // Check if original also has this pattern (legitimate split)
        const tailOrigSq = countChar(tailOrig, "'");
        const headOrigSq = countChar(headOrig, "'");
        if (tailOrigSq % 2 === 0 || headOrigSq % 2 === 0) {
          issues.push('split-string: translated has unmatched quotes at seam (original does not)');
        }
      }

      // 3. Check for triple backtick injection at seam
      const seamTrans = tailTrans + headTrans;
      const seamOrig = tailOrig + headOrig;
      const origTriple = (seamOrig.match(/```/g) || []).length;
      const transTriple = (seamTrans.match(/```/g) || []).length;
      if (transTriple > origTriple) {
        issues.push(`seam-backtick-injection: ${origTriple}→${transTriple}`);
      }
      
      // 4. Check length ratio at seam boundary
      const seamRatio = transBoundary.length / origBoundary.length;
      if (seamRatio < 0.7) {
        issues.push(`seam-length-drop: ${(seamRatio * 100).toFixed(0)}%`);
      }

      if (issues.length > 0) {
        seam.structuralIssues = issues.join(', ');
        console.warn(`[verifySeams] Seam ${i + 1} structural issues: ${seam.structuralIssues}`);
      }
    }
    
    seamIssues.push(seam);
  }

  // ═══ Build AI verification prompt ═══
  const hasStructuralIssues = seamIssues.some(s => s.structuralIssues);
  
  const seamDescriptions = seamIssues.map((s, i) => {
    let desc = `=== SEAM ${i + 1} (between chunk ${s.idx + 1} and ${s.idx + 2}) ===\n` +
      `Original tail: ${s.tailOrig}\n` +
      `Original head: ${s.headOrig}\n` +
      `Translated tail: ${s.tailTrans}\n` +
      `Translated head: ${s.headTrans}`;
    if (s.structuralIssues) {
      desc += `\n⚠️ STRUCTURAL DRIFT: ${s.structuralIssues}`;
    }
    return desc;
  }).join('\n\n');

  // Enhanced prompt when structural verification is enabled
  let verifySystem = `You are a translation quality checker for ${targetLang}. ` +
    `A large text was split into chunks and translated in parallel. ` +
    `Check if the seam points (where chunks join) are coherent. ` +
    `Look for: broken sentences, duplicated phrases, missing connectors, inconsistent terminology, or broken HTML tags at seam boundaries.\n`;
  
  if (enableStructuralVerification && isCodeHeavy) {
    verifySystem += `\nCRITICAL — CODE STRUCTURAL INTEGRITY CHECK:
This is code-heavy content (minified JS/HTML/CSS). At each seam boundary, also check for:
1. **Split string literals**: A quote opened in the tail but not closed, or vice versa in the head
2. **Broken identifiers**: CSS class names, variable names, or function names split across the seam
3. **Markdown injection**: Triple backticks (\`\`\`) that don't exist in the original appearing in the translated seam
4. **Missing brackets/parens**: Structural characters (brackets, parentheses, braces) lost at the seam
5. **Character corruption**: Chinese/Unicode characters corrupted into garbled text at boundaries

Seams marked with ⚠️ STRUCTURAL DRIFT have detected numeric differences between original and translated structural characters.
For these seams, compare the ORIGINAL boundary against the TRANSLATED boundary carefully.
If code is corrupted at the seam, provide the fix that restores the original code structure while keeping translations.\n`;
  }
  
  verifySystem += `If ALL seams are fine, respond with exactly: ALL_OK\n` +
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
      console.log('[verifySeams] All seams coherent ✓' + (hasStructuralIssues ? ' (structural drift was acceptable)' : ''));
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
        if (s.structuralIssues) {
          console.log(`[verifySeams] Fixed structural seam ${seamNum + 1}: ${s.structuralIssues}`);
        }
      }
    }
    console.log(`[verifySeams] Fixed ${fixCount} seam(s)` + (hasStructuralIssues ? ' (including structural repairs)' : ''));
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

// ─── URL Masking Utilities ───
// Protect URLs/image links from being translated by the AI.
// Similar to secret masking, but for URLs in src, href, CSS url(), standalone URLs, and markdown images.
interface UrlMaskMap {
  [placeholder: string]: string;
}

function maskUrls(text: string): { maskedText: string; map: UrlMaskMap } {
  const map: UrlMaskMap = {};
  let maskedText = text;
  let counter = 0;

  // Helper to create unique placeholder
  const makePlaceholder = () => `__PROTECTED_URL_${counter++}__`;

  // 1. Markdown image links: ![alt](url)
  maskedText = maskedText.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (_match, prefix, url, suffix) => {
    const ph = makePlaceholder();
    map[ph] = url;
    return `${prefix}${ph}${suffix}`;
  });

  // 2. HTML attributes: src="...", href="...", url="...", action="...", data-src="...", poster="...", srcset="..."
  maskedText = maskedText.replace(
    /((?:src|href|action|data-src|data-url|poster|srcset)\s*=\s*)(["'])(https?:\/\/[^"'<>\s]+|[^"'<>\s]+\.(?:png|jpg|jpeg|gif|svg|webp|mp4|webm|mp3|ogg|wav|pdf|zip|css|js|html?)(?:[?#][^"'<>\s]*)?)\2/gi,
    (_match, attr, quote, url) => {
      const ph = makePlaceholder();
      map[ph] = url;
      return `${attr}${quote}${ph}${quote}`;
    }
  );

  // 3. CSS url() patterns
  maskedText = maskedText.replace(
    /(url\s*\(\s*)(["']?)(https?:\/\/[^"')\s]+|[^"')\s]+\.(?:png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)(?:[?#][^"')\s]*)?)\2(\s*\))/gi,
    (_match, prefix, quote, url, suffix) => {
      const ph = makePlaceholder();
      map[ph] = url;
      return `${prefix}${quote}${ph}${quote}${suffix}`;
    }
  );

  // 4. Standalone URLs (https://... not already captured)
  // Only match URLs that aren't already placeholders
  maskedText = maskedText.replace(
    /(?<=[\s\n(]|^)(https?:\/\/[^\s<>"'`)\]]{10,})/gm,
    (match, url) => {
      if (url.includes('__PROTECTED_URL_')) return match; // Already masked
      const ph = makePlaceholder();
      map[ph] = url;
      return match.replace(url, ph);
    }
  );

  return { maskedText, map };
}

function unmaskUrls(text: string, map: UrlMaskMap): string {
  let unmaskedText = text;
  for (const [placeholder, url] of Object.entries(map)) {
    // Use split+join for safety (avoids regex special char issues in URLs)
    unmaskedText = unmaskedText.split(placeholder).join(url);
  }
  return unmaskedText;
}

// ─── Code Block Masking Utilities ───
interface CodeBlockMaskMap {
  [placeholder: string]: string;
}

async function maskCodeBlocks(
  text: string,
  config: ProxySettings,
  targetLang: string,
  sourceLang: string,
  signal?: AbortSignal,
  glossary?: GlossaryEntry[],
  mvuDictionary?: Record<string, string>
): Promise<{ maskedText: string; map: CodeBlockMaskMap }> {
  const map: CodeBlockMaskMap = {};
  let maskedText = text;
  let counter = 0;

  // Pattern to find <script>...</script> blocks
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  // Pattern to find <style>...</style> blocks
  const styleRegex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;

  interface CodeBlockMatch {
    fullMatch: string;
    attrs: string;
    content: string;
    type: 'script' | 'style';
    placeholder: string;
  }
  
  const matches: CodeBlockMatch[] = [];
  
  // Find script blocks
  let match;
  while ((match = scriptRegex.exec(maskedText)) !== null) {
    const fullMatch = match[0];
    const attrs = match[1];
    const content = match[2];
    if (content.trim()) {
      const placeholder = `__PROTECTED_SCRIPT_${counter++}__`;
      matches.push({ fullMatch, attrs, content, type: 'script', placeholder });
    }
  }
  
  // Find style blocks
  while ((match = styleRegex.exec(maskedText)) !== null) {
    const fullMatch = match[0];
    const attrs = match[1];
    const content = match[2];
    if (content.trim()) {
      const placeholder = `__PROTECTED_STYLE_${counter++}__`;
      matches.push({ fullMatch, attrs, content, type: 'style', placeholder });
    }
  }

  // Surgically translate the CJK contents of script/style blocks
  for (const m of matches) {
    let translatedContent = m.content;
    
    try {
      const tokens = extractCJKTokens(m.content);
      if (tokens.length > 0) {
        // 1. Apply local glossary / MVU dictionary translations first to save API tokens
        for (const token of tokens) {
          const trimmed = token.text.trim();
          
          // Check MVU dictionary
          if (mvuDictionary && mvuDictionary[trimmed]) {
            token.translated = mvuDictionary[trimmed];
            continue;
          }
          
          // Check Glossary
          if (glossary) {
            const match = glossary.find(g => g.source.trim() === trimmed);
            if (match && match.target.trim()) {
              token.translated = match.target.trim();
              continue;
            }
          }
        }

        const pendingTokens = tokens.filter(t => !t.translated);
        if (pendingTokens.length > 0) {
          console.log(`[maskCodeBlocks] Surgically translating ${pendingTokens.length} CJK tokens (out of ${tokens.length} total) in ${m.type} block...`);
          
          let glossaryPrompt = '';
          if (glossary && glossary.length > 0) {
            const terms = glossary
              .filter(g => g.source.trim() && g.target.trim())
              .map(g => `  "${g.source}" → "${g.target}"`)
              .join('\n');
            if (terms) {
              glossaryPrompt = `\n\nGlossary terms (use these translations if they appear in text):\n${terms}`;
            }
          }
          
          let mvuPrompt = '';
          if (mvuDictionary && Object.keys(mvuDictionary).length > 0) {
            const terms = Object.entries(mvuDictionary)
              .filter(([k, v]) => k && v && k !== v)
              .map(([k, v]) => `  "${k}" → "${v}"`)
              .join('\n');
            if (terms) {
              mvuPrompt = `\n\nMVU variable mappings (use these translations if they appear in text):\n${terms}`;
            }
          }

          const BATCH_SIZE = 80;
          const systemPrompt = `You are a surgical translation tool. Your job is to translate CJK strings into ${targetLang} exactly line-by-line.
You will receive a list of items formatted as "#{id}\t{text}".
Return ONLY the translated items in the exact same format "#{id}\t{translated_text}".
Do NOT output any conversational text or markdown blocks. Do NOT skip items.${glossaryPrompt}${mvuPrompt}`;

          for (let i = 0; i < pendingTokens.length; i += BATCH_SIZE) {
            const batch = pendingTokens.slice(i, i + BATCH_SIZE);
            const payload = batch.map(t => `#${t.id}\t${t.text}`).join('\n');
            const rawResult = await callProvider(config, systemPrompt, payload, signal);
            
            const parsed = extractTranslationFromResponse(rawResult);
            const cleanedResult = parsed.translation || rawResult;

            const lines = cleanedResult.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const parsedTranslations: { id?: number; text: string }[] = [];
            
            for (const line of lines) {
              const matchLine = line.match(/^(?:[^\d#]*#?\s*)?(\d+)[\t \.\:\-\]\)]+(.+)$/);
              if (matchLine) {
                parsedTranslations.push({ id: parseInt(matchLine[1], 10), text: matchLine[2].trim() });
              } else {
                parsedTranslations.push({ text: line });
              }
            }

            if (parsedTranslations.length === batch.length) {
              // Positional fallback mapping (most robust if line count matches)
              for (let idx = 0; idx < batch.length; idx++) {
                const token = batch[idx];
                let translatedText = parsedTranslations[idx].text;
                
                if (translatedText.startsWith(token.text)) {
                  translatedText = translatedText.substring(token.text.length).trim();
                  translatedText = translatedText.replace(/^[\s\:\-\=\>\t\(\)\[\]\{\}]+/, '').trim();
                }
                const parenthesized = `(${token.text})`;
                if (translatedText.endsWith(parenthesized)) {
                  translatedText = translatedText.substring(0, translatedText.length - parenthesized.length).trim();
                }
                const bracketed = `[${token.text}]`;
                if (translatedText.endsWith(bracketed)) {
                  translatedText = translatedText.substring(0, translatedText.length - bracketed.length).trim();
                }
                token.translated = translatedText;
              }
            } else {
              // Match strictly by ID
              for (const parsed of parsedTranslations) {
                if (parsed.id !== undefined) {
                  const token = batch.find(t => t.id === parsed.id);
                  if (token) {
                    let translatedText = parsed.text;
                    if (translatedText.startsWith(token.text)) {
                      translatedText = translatedText.substring(token.text.length).trim();
                      translatedText = translatedText.replace(/^[\s\:\-\=\>\t\(\)\[\]\{\}]+/, '').trim();
                    }
                    const parenthesized = `(${token.text})`;
                    if (translatedText.endsWith(parenthesized)) {
                      translatedText = translatedText.substring(0, translatedText.length - parenthesized.length).trim();
                    }
                    const bracketed = `[${token.text}]`;
                    if (translatedText.endsWith(bracketed)) {
                      translatedText = translatedText.substring(0, translatedText.length - bracketed.length).trim();
                    }
                    token.translated = translatedText;
                  }
                }
              }
            }
          }
        }

        // Fill in any missing translations with original CJK to keep structural stability
        for (const token of tokens) {
          if (!token.translated || token.translated.trim() === '') {
            token.translated = token.text;
          }
        }
        
        translatedContent = reinsertTranslations(m.content, tokens);
      }
    } catch (err) {
      console.warn(`[maskCodeBlocks] Failed to surgically translate ${m.type} block:`, err);
    }
    
    map[m.placeholder] = translatedContent;
    
    // Replace in maskedText safely using indexOf
    const idx = maskedText.indexOf(m.fullMatch);
    if (idx !== -1) {
      const replacement = `<${m.type}${m.attrs}>${m.placeholder}</${m.type}>`;
      maskedText = maskedText.slice(0, idx) + replacement + maskedText.slice(idx + m.fullMatch.length);
    }
  }

  return { maskedText, map };
}

function unmaskCodeBlocks(text: string, map: CodeBlockMaskMap): string {
  let unmaskedText = text;
  for (const [placeholder, code] of Object.entries(map)) {
    unmaskedText = unmaskedText.split(placeholder).join(code);
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
  /** Chunk-level resume: previously completed chunk translations */
  previouslyCompletedChunks?: string[],
  /** Callback fired after each chunk is successfully translated */
  onChunkComplete?: (chunkIndex: number, translatedChunk: string, totalChunks: number) => void,
  /** Number of chunks to translate in parallel (1 = sequential, 2+ = concurrent) */
  parallelChunks?: number,
  /** Enable AI verification per chunk (compare original vs translated) */
  enableChunkVerification?: boolean,
  /** Callback fired when chunks are determined and unmasked */
  onChunksReady?: (rawChunks: string[]) => void,
): Promise<string> {
  if (!text || text.trim() === '') return '';

  // 0. Mask code blocks (<script>, <style>) before translation
  const { maskedText: codeMasked, map: codeMap } = await maskCodeBlocks(
    text,
    config,
    targetLang,
    sourceLang,
    signal,
    glossary,
    mvuDictionary
  );
  // 1. Mask secrets (API keys, tokens, passwords) before translation
  const { maskedText: secretMasked, map: secretMap } = maskSecrets(codeMasked);
  // 2. Mask URLs/image links to prevent AI from translating them
  const { maskedText, map: urlMap } = maskUrls(secretMasked);

  const isExpert = config.expertMode;
  // Detect Mod Mode: output can legitimately be much larger than input (e.g. 200-word prompt → 2000+ words)
  // so all bloat guards must be bypassed
  const isModMode = customPrompt?.includes('[CRITICAL: STANDALONE MODIFICATION & REWRITE MODE]') || false;
  const isCodeHeavy = fieldName.toLowerCase().includes('regex') || fieldName.toLowerCase().includes('code') || fieldName.toLowerCase().includes('script') || fieldName.toLowerCase().includes('helper');
  // Adaptive chunk size: code-heavy content cần chunk nhỏ hơn
  // vì AI output limit không đủ cho 100K chars code 1:1
  let effectiveChunkSize = chunkSize && chunkSize > 0 ? chunkSize : undefined;
  if (!effectiveChunkSize && isCodeHeavy) {
    effectiveChunkSize = 30000; // ~10K tokens output — an toàn cho mọi model
  }
  const chunks = chunkText(maskedText, effectiveChunkSize, config.maxTokens);

  if (onChunksReady) {
    const unmaskedChunks = chunks.map(chunk => {
      let unmasked = unmaskUrls(chunk, urlMap);
      unmasked = unmaskSecrets(unmasked, secretMap);
      unmasked = unmaskCodeBlocks(unmasked, codeMap);
      return unmasked;
    });
    onChunksReady(unmaskedChunks);
  }

  // ═══ SINGLE CHUNK — fast path (no parallelism needed) ═══
  if (chunks.length === 1) {
    const { system, user } = buildTranslationMessages(
      chunks[0], fieldName, targetLang, config.systemPromptPrefix,
      sourceLang, customPrompt, customSchema, contextHint, glossary, '',
      previousTranslationToUpdate,
      fieldType, isExpert, mvuDictionary,
    );
    const result = await translateChunk(
      chunks[0], 0, 1, fieldName, config, targetLang, sourceLang, system, user, signal, isModMode
    );
    let cleaned = cleanTranslationResponse(maskedText, result, isExpert, false);
    cleaned = unmaskUrls(cleaned, urlMap);  // Unmask URLs
    cleaned = unmaskSecrets(cleaned, secretMap); // Unmask secrets before residual check
    
    if (isCodeHeavy) {
      const structuralTrunc = detectStructuralTruncation(maskedText, cleaned);
      if (structuralTrunc.isTruncated) {
        console.warn(`[translateText] Structural truncation detected in single chunk for ${fieldName}: ${structuralTrunc.reason}`);
        cleaned = recoverTruncatedTail(maskedText, cleaned);
      }
    }
    
    // ═══ SINGLE-CHUNK BLOAT GUARD ═══
    // MOD MODE: skip — mod output can legitimately be much larger than input
    const singleBloatRatio = cleaned.length / Math.max(1, maskedText.length);
    if (!isModMode && singleBloatRatio > 1.8 && maskedText.length > 5000) {
      console.error(`[translateText] ⚠️ SINGLE CHUNK BLOAT for ${fieldName}: ${cleaned.length} chars is ${(singleBloatRatio * 100).toFixed(0)}% of original ${maskedText.length} — trimming`);
      cleaned = cleaned.slice(0, Math.floor(maskedText.length * 1.3));
    }

    // RESIDUAL CJK CHECK: auto-retry if Chinese text remains
    const finalResult = await postTranslationResidualCheck(
      maskedText, cleaned, fieldName, config, targetLang, sourceLang, signal, fieldType, mvuDictionary
    );
    return unmaskCodeBlocks(finalResult, codeMap);
  }

  // ═══ MULTIPLE CHUNKS — sequential OR parallel translation ═══
  const concurrency = Math.max(1, parallelChunks || 1);
  const isParallel = concurrency > 1 && chunks.length > 1;

  // ═══ CHUNK-LEVEL RESUME: Support both contiguous (sequential) and sparse (parallel) ═══
  // For parallel, completedChunks may have undefined gaps: [chunk0, undefined, chunk2]
  // For sequential, completedChunks is always contiguous from index 0
  const hasResume = !!(previouslyCompletedChunks && previouslyCompletedChunks.length > 0 && (
    previouslyCompletedChunks.length < chunks.length ||
    previouslyCompletedChunks.some(c => !c)
  ));

  if (hasResume) {
    console.log(`[translateText] ${fieldName}: RESUMING (${previouslyCompletedChunks!.filter(c => c).length} chunks already done)`);
  } else {
    console.log(`[translateText] ${fieldName}: Translating ${chunks.length} chunks ${isParallel ? `(${concurrency} parallel)` : 'sequentially'}...`);
  }

  const ORIGINAL_BOUNDARY_CHARS = 500;
  // Pre-fill results array with previously completed chunks
  const translatedChunks: (string | undefined)[] = new Array(chunks.length).fill(undefined);
  if (hasResume) {
    for (let ri = 0; ri < previouslyCompletedChunks!.length; ri++) {
      if (previouslyCompletedChunks![ri]) {
        translatedChunks[ri] = previouslyCompletedChunks![ri];
      }
    }
  }

  // Build list of chunk indices that still need translation
  const pendingIndices: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!translatedChunks[i]) pendingIndices.push(i);
  }

  if (isParallel) {
    // ═══ PARALLEL PATH — concurrent chunk translation with semaphore ═══
    console.log(`[translateText] ${fieldName}: ${pendingIndices.length} chunks pending, concurrency=${concurrency}`);

    let queueIdx = 0; // Shared queue index (safe: JS single-threaded, yields only at await)
    const errors: { idx: number; err: Error }[] = [];

    const worker = async () => {
      while (queueIdx < pendingIndices.length) {
        if (signal?.aborted) return;
        const myQueuePos = queueIdx++;
        if (myQueuePos >= pendingIndices.length) return;
        const idx = pendingIndices[myQueuePos];

        // Parallel: use original text boundary only (no prev translation context)
        // Code-heavy fields don't benefit much from cross-chunk context
        // Narrative fields get original boundary for structural awareness
        let prevContext = '';
        if (idx > 0) {
          const originalBoundaryTail = chunks[idx - 1].slice(-ORIGINAL_BOUNDARY_CHARS);
          prevContext = `=== ORIGINAL TEXT BOUNDARY (last ${ORIGINAL_BOUNDARY_CHARS} chars before this chunk — for code structure awareness) ===\n${originalBoundaryTail}`;
          // If previous chunk is already translated (from resume), include tail
          if (translatedChunks[idx - 1]) {
            const CONTEXT_TAIL_CHARS = 1000; // Shorter for parallel to reduce prompt size
            const prevTail = translatedChunks[idx - 1]!.slice(-CONTEXT_TAIL_CHARS);
            prevContext = `=== PREVIOUS CHUNK TRANSLATION TAIL ===\n${prevTail}\n\n${prevContext}`;
          }
        }

        const { system, user } = buildTranslationMessages(
          chunks[idx], `${fieldName} [part ${idx + 1}/${chunks.length}]`, targetLang, config.systemPromptPrefix,
          sourceLang, customPrompt, customSchema, contextHint, glossary,
          prevContext,
          idx === 0 && !hasResume ? previousTranslationToUpdate : undefined,
          fieldType, isExpert, mvuDictionary,
        );

        try {
          const translated = await translateChunk(
            chunks[idx], idx, chunks.length, fieldName, config, targetLang, sourceLang, system, user, signal, isModMode
          );
          const chunkCleaned = cleanTranslationResponse(chunks[idx], translated, isExpert, true);
          translatedChunks[idx] = chunkCleaned;
          // Structural integrity check for code-heavy chunks
          if (isCodeHeavy) {
            const origBt = (chunks[idx].match(/`/g) || []).length;
            const transBt = (chunkCleaned.match(/`/g) || []).length;
            const origSq = (chunks[idx].match(/'/g) || []).length;
            const transSq = (chunkCleaned.match(/'/g) || []).length;
            if (Math.abs(origBt - transBt) > 5 || Math.abs(origSq - transSq) > 10) {
              console.warn(`[translateText] ⚠️ Structural drift in chunk ${idx + 1}: backticks ${origBt}→${transBt}, quotes ${origSq}→${transSq}`);
            }
          }
          console.log(`[translateText] ${fieldName}: chunk ${idx + 1}/${chunks.length} done ✓`);

          // AI Chunk Verification (if enabled)
          if (enableChunkVerification && chunkCleaned) {
            const verification = await verifyChunkIntegrity(
              chunks[idx], chunkCleaned, idx, chunks.length, fieldName, config, targetLang, signal
            );
            if (!verification.ok) {
              console.warn(`[translateText] Chunk ${idx + 1} failed verification, retrying once...`);
              // Auto-retry the chunk once
              try {
                const retryResult = await translateChunk(
                  chunks[idx], idx, chunks.length, fieldName, config, targetLang, sourceLang, system, user, signal, isModMode
                );
                const retryCleaned = cleanTranslationResponse(chunks[idx], retryResult, isExpert, true);
                const retryVerify = await verifyChunkIntegrity(
                  chunks[idx], retryCleaned, idx, chunks.length, fieldName, config, targetLang, signal
                );
                if (retryVerify.ok || (retryCleaned.length >= chunkCleaned.length)) {
                  translatedChunks[idx] = retryCleaned;
                  console.log(`[translateText] Chunk ${idx + 1} retry ${retryVerify.ok ? 'verified ✓' : 'better than original, using retry'}`);
                } else {
                  console.warn(`[translateText] Chunk ${idx + 1} retry also failed verification, keeping original`);
                }
              } catch (retryErr) {
                console.warn(`[translateText] Chunk ${idx + 1} retry failed:`, retryErr);
              }
            }
          }

          if (onChunkComplete) {
            onChunkComplete(idx, translatedChunks[idx]!, chunks.length);
          }
        } catch (err: any) {
          if (signal?.aborted || err?.message === 'Cancelled') {
            return; // Stop this worker
          }
          errors.push({ idx, err: err instanceof Error ? err : new Error(String(err)) });
          // Continue with other chunks — don't fail entire batch
        }
      }
    };

    // Launch concurrent workers
    const workers = Array.from({ length: Math.min(concurrency, pendingIndices.length) }, () => worker());
    await Promise.allSettled(workers);

    // Check for cancellation
    if (signal?.aborted) throw new Error('Cancelled');

    // Check for failures — create ChunkError with completed chunks
    const completedList = translatedChunks.filter((c): c is string => c !== undefined);

    // ═══ CRITICAL: Detect incomplete translation even if no errors were recorded ═══
    // Workers may exit early (abort race, unhandled rejection) without pushing to errors[].
    // If we have incomplete chunks, we MUST throw ChunkError to trigger resume on retry.
    if (completedList.length < chunks.length) {
      const completedForResume = translatedChunks.map(c => c || '') as string[];
      const firstMissingIdx = translatedChunks.findIndex(c => !c);
      const errorMsg = errors.length > 0
        ? `Parallel: ${errors.length} chunk(s) failed. First: chunk ${errors[0].idx + 1}/${chunks.length}: ${errors[0].err.message}`
        : `Parallel: ${chunks.length - completedList.length} chunk(s) incomplete (workers exited early). Completed: ${completedList.length}/${chunks.length}`;
      
      if (completedList.length > 0) {
        throw new ChunkError(
          errorMsg,
          completedForResume,
          firstMissingIdx !== -1 ? firstMissingIdx : 0,
          chunks.length,
          errors.length > 0 ? errors[0].err : new Error('Workers exited before completing all chunks'),
        );
      }
      throw errors.length > 0 ? errors[0].err : new Error('All parallel workers exited without completing any chunks');
    }
  } else {
    // ═══ SEQUENTIAL PATH — original behavior with full context continuity ═══
    let resumeFromIdx = 0;
    if (hasResume) {
      const firstPending = translatedChunks.findIndex(c => !c);
      resumeFromIdx = firstPending !== -1 ? firstPending : 0;
    }

    for (let idx = resumeFromIdx; idx < chunks.length; idx++) {
      if (signal?.aborted) throw new Error('Cancelled');

      // Build rich context: tail of previous translated chunk + original boundary
      let prevContext = '';
      if (idx > 0 && translatedChunks[idx - 1]) {
        const prevTranslation = translatedChunks[idx - 1]!;
        const CONTEXT_TAIL_CHARS = 2000;
        const prevTranslationTail = prevTranslation.length > CONTEXT_TAIL_CHARS
          ? '...[earlier content truncated for brevity]...\n' + prevTranslation.slice(-CONTEXT_TAIL_CHARS)
          : prevTranslation;
        const originalBoundaryTail = chunks[idx - 1].slice(-ORIGINAL_BOUNDARY_CHARS);
        prevContext =
          `=== PREVIOUS CHUNK TRANSLATION TAIL (for terminology & flow consistency) ===\n` +
          `${prevTranslationTail}\n\n` +
          `=== ORIGINAL TEXT BOUNDARY (last ${ORIGINAL_BOUNDARY_CHARS} chars before this chunk — for code structure awareness) ===\n` +
          `${originalBoundaryTail}`;
      }

      const { system, user } = buildTranslationMessages(
        chunks[idx], `${fieldName} [part ${idx + 1}/${chunks.length}]`, targetLang, config.systemPromptPrefix,
        sourceLang, customPrompt, customSchema, contextHint, glossary,
        prevContext,
        idx === 0 && !hasResume ? previousTranslationToUpdate : undefined,
        fieldType, isExpert, mvuDictionary,
      );

      try {
        const translated = await translateChunk(
          chunks[idx], idx, chunks.length, fieldName, config, targetLang, sourceLang, system, user, signal, isModMode
        );
        const chunkCleaned = cleanTranslationResponse(chunks[idx], translated, isExpert, true);
        translatedChunks[idx] = chunkCleaned;
        // Structural integrity check for code-heavy chunks
        if (isCodeHeavy) {
          const origBt = (chunks[idx].match(/`/g) || []).length;
          const transBt = (chunkCleaned.match(/`/g) || []).length;
          const origSq = (chunks[idx].match(/'/g) || []).length;
          const transSq = (chunkCleaned.match(/'/g) || []).length;
          if (Math.abs(origBt - transBt) > 5 || Math.abs(origSq - transSq) > 10) {
            console.warn(`[translateText] ⚠️ Structural drift in chunk ${idx + 1}: backticks ${origBt}→${transBt}, quotes ${origSq}→${transSq}`);
          }
        }
        console.log(`[translateText] ${fieldName}: chunk ${idx + 1}/${chunks.length} done ✓`);

        // AI Chunk Verification (if enabled)
        if (enableChunkVerification && chunkCleaned) {
          const verification = await verifyChunkIntegrity(
            chunks[idx], chunkCleaned, idx, chunks.length, fieldName, config, targetLang, signal
          );
          if (!verification.ok) {
            console.warn(`[translateText] Chunk ${idx + 1} failed verification, retrying once...`);
            try {
              const retryResult = await translateChunk(
                chunks[idx], idx, chunks.length, fieldName, config, targetLang, sourceLang, system, user, signal, isModMode
              );
              const retryCleaned = cleanTranslationResponse(chunks[idx], retryResult, isExpert, true);
              const retryVerify = await verifyChunkIntegrity(
                chunks[idx], retryCleaned, idx, chunks.length, fieldName, config, targetLang, signal
              );
              if (retryVerify.ok || (retryCleaned.length >= chunkCleaned.length)) {
                translatedChunks[idx] = retryCleaned;
                console.log(`[translateText] Chunk ${idx + 1} retry ${retryVerify.ok ? 'verified ✓' : 'better, using retry'}`);
              } else {
                console.warn(`[translateText] Chunk ${idx + 1} retry also failed, keeping original`);
              }
            } catch (retryErr) {
              console.warn(`[translateText] Chunk ${idx + 1} retry failed:`, retryErr);
            }
          }
        }

        if (onChunkComplete) {
          onChunkComplete(idx, translatedChunks[idx]!, chunks.length);
        }
      } catch (err: any) {
        if (signal?.aborted || err?.message === 'Cancelled') {
          throw new Error('Cancelled');
        }
        // Save completed chunks for resume
        const completedForResume = translatedChunks.filter((c): c is string => c !== undefined);
        if (completedForResume.length > 0) {
          throw new ChunkError(
            `Chunk ${idx + 1}/${chunks.length} failed: ${err?.message || String(err)}`,
            completedForResume,
            idx,
            chunks.length,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
        throw err;
      }
    }
  }

  console.log(`[translateText] ${fieldName}: All ${chunks.length} chunks done. Verifying seams...`);

  // ═══ SEAM VERIFICATION — check chunk boundaries for coherence ═══
  const finalChunks = translatedChunks.filter((c): c is string => c !== undefined);
  const verifiedChunks = await verifySeams(finalChunks, chunks, config, targetLang, signal, enableChunkVerification, isCodeHeavy);

  // For HTML and Code/Regex content, join without separator
  const isHtmlContent = /<[a-z][^>]*>/i.test(maskedText) && /<\/[a-z]+>/i.test(maskedText);
  const joiner = (isHtmlContent || isCodeHeavy) ? '' : '\n\n';
  const rawResult = verifiedChunks.join(joiner);
  let cleaned = unmaskUrls(rawResult, urlMap);
  cleaned = unmaskSecrets(cleaned, secretMap);
  
  if (isCodeHeavy) {
    const structuralTrunc = detectStructuralTruncation(maskedText, cleaned);
    if (structuralTrunc.isTruncated) {
      console.warn(`[translateText] Structural truncation detected in final joined result for ${fieldName}: ${structuralTrunc.reason}`);
      cleaned = recoverTruncatedTail(maskedText, cleaned);
    }
  }

  // ═══ FINAL VERIFICATION — structural report on entire translation ═══
  if (enableChunkVerification && chunks.length > 1) {
    const finalCheck = verifyFinalTranslation(maskedText, cleaned, fieldName);
    console.log(finalCheck.report);
    if (!finalCheck.ok) {
      console.warn(`[translateText] ⚠️ Final verification flagged issues for ${fieldName} — check log above`);
    }
  }
  
  // ═══ ULTIMATE BLOAT GUARD — last line of defense against content doubling ═══
  // If translation is >1.8x the original, something went very wrong (false positive
  // structural truncation, duplicate continuations, etc.). Log and trim.
  // MOD MODE: skip entirely — mod output can legitimately be much larger than input
  // (e.g. a 200-word prompt can produce 2000+ words of modded content)
  const bloatRatio = cleaned.length / Math.max(1, maskedText.length);
  if (!isModMode && bloatRatio > 1.8 && maskedText.length > 5000) {
    console.error(`[translateText] ⚠️ BLOAT DETECTED for ${fieldName}: result ${cleaned.length} chars is ${(bloatRatio * 100).toFixed(0)}% of original ${maskedText.length} chars — trimming to prevent content doubling`);
    // Try to find where the duplication starts by checking if the second half
    // is similar to the first half (common pattern: translation + original tail)
    const halfLen = Math.floor(cleaned.length / 2);
    const firstHalf = cleaned.slice(0, halfLen);
    const secondHalf = cleaned.slice(halfLen);
    
    // Check structural similarity of the two halves by sampling
    const sampleSize = Math.min(500, halfLen);
    const firstSample = firstHalf.slice(-sampleSize);
    const secondSampleStart = secondHalf.slice(0, sampleSize);
    
    // If the end of first half and start of second half share significant structural overlap,
    // it's likely the second half is a duplicate
    const firstStructure = getStructure(firstSample);
    const secondStructure = getStructure(secondSampleStart);
    const overlapLen = getLcpLength(firstStructure, secondStructure);
    
    if (overlapLen > firstStructure.length * 0.3) {
      console.error(`[translateText] BLOAT CONFIRMED: structural overlap at midpoint (${overlapLen}/${firstStructure.length}) — keeping first ${halfLen} chars`);
      cleaned = cleaned.slice(0, Math.floor(maskedText.length * 1.3));
    } else {
      // Not a clear duplicate, but still too long — trim conservatively
      console.warn(`[translateText] BLOAT WARNING: no clear duplicate pattern, trimming to 130% of original`);
      cleaned = cleaned.slice(0, Math.floor(maskedText.length * 1.3));
    }
  } else if (isModMode && bloatRatio > 1.8) {
    console.log(`[translateText] ℹ️ MOD MODE: output ${cleaned.length} chars is ${(bloatRatio * 100).toFixed(0)}% of original ${maskedText.length} — bloat guard skipped (mod mode allows larger output)`);
  }

  // RESIDUAL CJK CHECK: auto-retry if Chinese text remains
  const finalResult = await postTranslationResidualCheck(
    maskedText, cleaned, fieldName, config, targetLang, sourceLang, signal, fieldType, mvuDictionary
  );
  return unmaskCodeBlocks(finalResult, codeMap);
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
- CRITICAL: You MUST translate ALL Chinese/Japanese/Korean characters in EVERY section. Do NOT leave any CJK text untranslated. This includes section headers, YAML keys, annotations, labels, and text inside XML/HTML tags.
- SELF-CHECK MANDATE: Before outputting EACH section, scan your translation for ANY remaining Chinese characters (Unicode \u4e00-\u9fff). If you find even ONE Chinese character that should be translated, fix it BEFORE outputting. Common mistake: leaving single CJK characters at word boundaries (e.g. "nhân际" should be "nhân tế", "关系" should be "quan hệ"). ZERO Chinese characters may remain in the output.${schemaInstructions}${glossaryBlock}`;

  const sourceHint = sourceLang && sourceLang !== 'auto' ? ` (from ${sourceLang})` : '';
  const user = `Translate these ${items.length} sections${sourceHint} to ${targetLang}. Keep the ${DELIMITER}N${DELIMITER} delimiters. Return ONLY translations. IMPORTANT: Translate ALL Chinese text in every section — ZERO Chinese characters should remain in the output. Before outputting each section, re-scan for any remaining CJK and translate them:\n\n${combinedText}`;

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
            if (origChinese >= 3 && residual > 0) {
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

/* ─── Fetch models from proxy ─── */
export async function fetchModelsFromProxy(config: ProxySettings): Promise<string[]> {
  let rawUrl = config.proxyUrl.replace(/\/+$/, '') + '/models';
  
  if (config.provider === 'google') {
    rawUrl = `${config.proxyUrl.replace(/\/+$/, '')}/models?key=${config.apiKey}`;
  }
  
  const url = corsProxyUrl(rawUrl, config.useCorsProxy);
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  
  if (config.apiKey && config.provider !== 'google') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
    if (config.provider === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
    });
  } catch (err) {
    throw wrapCorsError(err, rawUrl, config.useCorsProxy);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401) throw new ApiError('Invalid API key', 401);
    throw new ApiError(`HTTP ${res.status}: ${errText || res.statusText}`, res.status);
  }

  const data = await res.json();
  
  let models: string[] = [];
  if (data && Array.isArray(data.data)) {
    models = data.data.map((m: any) => m.id).filter((id: any) => typeof id === 'string');
  } else if (data && Array.isArray(data.models)) {
    models = data.models.map((m: any) => {
      const name = m.name || '';
      return name.startsWith('models/') ? name.substring(7) : name;
    }).filter(Boolean);
  } else if (data && Array.isArray(data)) {
    models = data.map((m: any) => typeof m === 'string' ? m : m.id || m.name).filter(Boolean);
  } else {
    throw new Error('Unsupported response format from /models. Expected data array.');
  }

  return models;
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
