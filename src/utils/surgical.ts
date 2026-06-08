export interface CJKToken {
  id: number;
  text: string;
  start: number;
  end: number;
  translated?: string;
}

/**
 * Extracts segments of CJK text, avoiding code brackets, braces,
 * and fullwidth punctuation (（），。：；！？) which must be preserved as-is.
 *
 * EXCLUDED ranges:
 * - \u3000-\u303f: CJK Symbols & Punctuation (。、「」 etc.)
 * - \uff00-\uff64: Fullwidth punctuation (（），：；！？ etc.)
 * INCLUDED ranges:
 * - \u4e00-\u9fff: CJK Unified Ideographs (Chinese characters)
 * - \u3400-\u4dbf: CJK Extension A
 * - \u3040-\u30ff: Hiragana + Katakana
 * - \uac00-\ud7af: Hangul Syllables
 * - \uff65-\uffdc: Halfwidth Katakana + Fullwidth Latin/Hangul (rare but safe)
 */
export function extractCJKTokens(text: string): CJKToken[] {
  const tokens: CJKToken[] = [];
  // Match CJK ideographs + kana + hangul, optionally joined by safe non-code characters.
  // EXCLUDES fullwidth punctuation (\uff00-\uff64) and CJK symbols (\u3000-\u303f)
  // to prevent capturing （），。：；！？ as part of CJK tokens.
  const regex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\uff65-\uffdc]+(?:[ \tA-Za-z0-9.\-_/!?%~]+[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\uff65-\uffdc]+)*/g;
  
  let match;
  let id = 1;
  while ((match = regex.exec(text)) !== null) {
    const hasIdeograph = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(match[0]);
    if (hasIdeograph) {
      // Skip CJK tokens that appear inside CSS function calls
      // Check the context before this match for CSS function patterns: func-name(
      const contextBefore = text.slice(Math.max(0, match.index - 80), match.index);
      const isCssFunction = /[a-zA-Z-]+\s*\(\s*$/.test(contextBefore);
      // Also check if surrounded by CSS property syntax: { ... property: value ... }
      const contextAfter = text.slice(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 30));
      const isCssValue = isCssFunction && /^\s*[\d\s,.)px%ems]+/.test(contextAfter);
      
      if (isCssValue) {
        // Skip this token — it's inside a CSS function call (e.g. drop-shadow(商 10px ...))
        continue;
      }

      tokens.push({
        id: id++,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }
  return tokens;
}

/**
 * Reinserts translated tokens back into the original string safely by iterating in reverse.
 */
export function reinsertTranslations(original: string, tokens: CJKToken[]): string {
  let result = original;
  // Sort by start index descending to avoid offsetting issues
  const sortedTokens = [...tokens].sort((a, b) => b.start - a.start);
  
  for (const token of sortedTokens) {
    if (token.translated) {
      result = result.slice(0, token.start) + token.translated + result.slice(token.end);
    }
  }
  return result;
}

/**
 * Verifies if structural integrity of code has been broken during translation.
 * Treats fullwidth and halfwidth variants as equivalent (e.g. （ = (, ） = )).
 */
export function verifySurgicalResult(original: string, translated: string): boolean {
  const countChar = (str: string, char: string) => (str.match(new RegExp(`\\${char}`, 'g')) || []).length;
  
  // Backticks must match exactly
  if (countChar(original, '`') !== countChar(translated, '`')) return false;
  
  // For braces, brackets, angle brackets: count both fullwidth and halfwidth as equivalent
  const countEquiv = (str: string, halfwidth: string, fullwidth: string) => {
    return countChar(str, halfwidth) + countChar(str, fullwidth);
  };
  
  // Braces: { ＋ ｛ and } ＋ ｝
  if (countEquiv(original, '{', '\uff5b') !== countEquiv(translated, '{', '\uff5b')) return false;
  if (countEquiv(original, '}', '\uff5d') !== countEquiv(translated, '}', '\uff5d')) return false;
  
  // Angle brackets: < ＋ ＜ and > ＋ ＞
  if (countEquiv(original, '<', '\uff1c') !== countEquiv(translated, '<', '\uff1c')) return false;
  if (countEquiv(original, '>', '\uff1e') !== countEquiv(translated, '>', '\uff1e')) return false;
  
  // Parentheses: ( ＋ （ and ) ＋ ）
  const origParenOpen = countEquiv(original, '\\(', '\uff08');
  const origParenClose = countEquiv(original, '\\)', '\uff09');
  const transParenOpen = countEquiv(translated, '\\(', '\uff08');
  const transParenClose = countEquiv(translated, '\\)', '\uff09');
  if (origParenOpen !== transParenOpen) return false;
  if (origParenClose !== transParenClose) return false;
  
  return true;
}

import { extractTranslationFromResponse } from './masterPrompt';
import type { ProxySettings, GlossaryEntry } from '../types/card';
import { writeDebugLog } from './debugLogger';

/**
 * Lightly sanitize LLM translated text.
 * Only strips markdown formatting artifacts (```, ***, etc.) that LLM may add.
 * Does NOT strip <>{} — these are valid in HTML-heavy replaceString fields.
 */
function sanitizeTranslatedText(text: string): string {
  return text
    .replace(/^```[\w]*\n?/gm, '')  // Strip opening code fences
    .replace(/\n?```$/gm, '')       // Strip closing code fences
    .replace(/^\*{3,}$/gm, '')     // Strip horizontal rules from markdown
    .trim();
}

/**
 * Normalize fullwidth CJK punctuation to halfwidth equivalents.
 * Applied after reinsertion to fix inconsistencies where LLM converts
 * some fullwidth chars (like （) to halfwidth but leaves others (like ）).
 *
 * This ensures balanced parentheses and consistent punctuation in the output.
 */
function normalizeFullwidthPunctuation(text: string): string {
  const map: Record<string, string> = {
    '\uff08': '(',  // （ → (
    '\uff09': ')',  // ） → )
    '\uff0c': ',',  // ， → ,
    '\u3002': '.',  // 。 → .
    '\uff1a': ':',  // ： → :
    '\uff1b': ';',  // ； → ;
    '\uff01': '!',  // ！ → !
    '\uff1f': '?',  // ？ → ?
  };
  return text.replace(/[\uff08\uff09\uff0c\u3002\uff1a\uff1b\uff01\uff1f]/g, ch => map[ch] || ch);
}

/**
 * Parse a batch of LLM response lines into id-text pairs.
 */
function parseBatchResponse(rawResult: string): { id?: number; text: string }[] {
  const parsed = extractTranslationFromResponse(rawResult);
  const cleanedResult = parsed.translation || rawResult;
  const lines = cleanedResult.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  const results: { id?: number; text: string }[] = [];
  for (const line of lines) {
    const matchLine = line.match(/^(?:[^\d#]*#?\s*)(\d+)[\t \.\:\-\]\)]+(.+)$/);
    if (matchLine) {
      results.push({ id: parseInt(matchLine[1], 10), text: matchLine[2].trim() });
    } else {
      results.push({ text: line });
    }
  }
  return results;
}

/**
 * Apply parsed translations to a batch of tokens, sanitizing structural chars.
 */
function applyBatchTranslations(batch: CJKToken[], parsedTranslations: { id?: number; text: string }[]): number {
  let matched = 0;

  const cleanTranslation = (token: CJKToken, raw: string): string => {
    let t = raw;
    if (t.startsWith(token.text)) {
      t = t.substring(token.text.length).trim();
      t = t.replace(/^[\s\:\-\=\>\t\(\)\[\]\{\}]+/, '').trim();
    }
    const parenthesized = `(${token.text})`;
    if (t.endsWith(parenthesized)) t = t.substring(0, t.length - parenthesized.length).trim();
    const bracketed = `[${token.text}]`;
    if (t.endsWith(bracketed)) t = t.substring(0, t.length - bracketed.length).trim();
    return sanitizeTranslatedText(t);
  };

  if (parsedTranslations.length === batch.length) {
    // Positional mapping (most robust if line count matches)
    for (let idx = 0; idx < batch.length; idx++) {
      const cleaned = cleanTranslation(batch[idx], parsedTranslations[idx].text);
      if (cleaned) {
        batch[idx].translated = cleaned;
        matched++;
      }
    }
  } else {
    // Match strictly by ID
    for (const p of parsedTranslations) {
      if (p.id !== undefined) {
        const token = batch.find(t => t.id === p.id);
        if (token) {
          const cleaned = cleanTranslation(token, p.text);
          if (cleaned) {
            token.translated = cleaned;
            matched++;
          }
        }
      }
    }
  }
  return matched;
}

/**
 * The main surgical translation orchestrator.
 * @param strictVerification If false, accept results even if structural verification fails slightly (for replaceString with no fallback)
 */
export async function surgicalTranslate(
  text: string,
  config: ProxySettings,
  targetLang: string,
  signal?: AbortSignal,
  glossary?: GlossaryEntry[],
  mvuDictionary?: Record<string, string>,
  strictVerification: boolean = true
): Promise<{ translated: string; success: boolean; fallbackTriggered: boolean }> {
  const { callProvider } = await import('./apiClient');
  const tokens = extractCJKTokens(text);
  
  writeDebugLog(`[surgicalTranslate] Starting with strictVerification=${strictVerification}. Tokens extracted: ${tokens.length}`);

  if (tokens.length === 0) {
    writeDebugLog(`[surgicalTranslate] Zero tokens extracted, returning early`);
    return { translated: text, success: true, fallbackTriggered: false };
  }

  // 1. Apply local glossary / MVU dictionary translations first to save API tokens
  for (const token of tokens) {
    const trimmed = token.text.trim();
    
    // Check MVU dictionary
    if (mvuDictionary && mvuDictionary[trimmed]) {
      token.translated = mvuDictionary[trimmed];
      writeDebugLog(`[surgicalTranslate] Resolved locally via MVU dictionary: "${trimmed}" -> "${token.translated}"`);
      continue;
    }
    
    // Check Glossary
    if (glossary) {
      const match = glossary.find(g => g.source.trim() === trimmed);
      if (match && match.target.trim()) {
        token.translated = match.target.trim();
        writeDebugLog(`[surgicalTranslate] Resolved locally via Glossary: "${trimmed}" -> "${token.translated}"`);
        continue;
      }
    }
  }
  
  // Only send tokens that weren't translated locally
  const pendingTokens = tokens.filter(t => !t.translated);
  
  // Deduplicate tokens by text to avoid sending duplicates to LLM and save tokens
  const uniquePendingMap = new Map<string, CJKToken>();
  for (const token of pendingTokens) {
    if (!uniquePendingMap.has(token.text)) {
      uniquePendingMap.set(token.text, token); // Keep the first token as representative
    }
  }
  const uniquePendingTokens = Array.from(uniquePendingMap.values());

  if (uniquePendingTokens.length === 0) {
    const reinserted = reinsertTranslations(text, tokens);
    return { translated: reinserted, success: true, fallbackTriggered: false };
  }

  // Strategy: try ALL tokens in a single batch first (most LLMs handle 3000+ items fine with 65K output).
  // If match rate < 50% (LLM truncated), automatically fall back to parallel smaller batches.
  const FALLBACK_BATCH_SIZE = 500;
  const MAX_RETRIES = 2;
  const PARALLEL_CONCURRENCY = 3;

  // Start with a single mega-batch containing all tokens
  let tokenBatches: CJKToken[][] = [uniquePendingTokens];
  let usedMegaBatch = true;

  console.log(`[surgicalTranslate] Extracted ${tokens.length} tokens (${uniquePendingTokens.length} unique pending, ${tokens.length - pendingTokens.length} local-resolved). Trying single mega-batch first...`);
  writeDebugLog(`[surgicalTranslate] Unique pending tokens: ${uniquePendingTokens.length}. Strategy: mega-batch → fallback ${FALLBACK_BATCH_SIZE} × ${PARALLEL_CONCURRENCY} parallel`);
  
  let glossaryPrompt = '';
  if (glossary && glossary.length > 0) {
    const terms = glossary
      .filter(g => g.source.trim() && g.target.trim())
      .map(g => `  "${g.source}" → "${g.target}"`)
      .join('\n');
    if (terms) {
      glossaryPrompt = `\n\nMANDATORY GLOSSARY (use these translations exactly):\n${terms}`;
    }
  }
  
  let mvuPrompt = '';
  if (mvuDictionary && Object.keys(mvuDictionary).length > 0) {
    const terms = Object.entries(mvuDictionary)
      .filter(([k, v]) => k && v && k !== v)
      .map(([k, v]) => `  "${k}" → "${v}"`)
      .join('\n');
    if (terms) {
      mvuPrompt = `\n\nMVU VARIABLE MAPPINGS (use these translations exactly):\n${terms}`;
    }
  }

  const isVietnamese = targetLang.toLowerCase().includes('việt') || targetLang.toLowerCase().includes('vietnamese');
  const langRules = isVietnamese
    ? `
VIETNAMESE-SPECIFIC RULES:
- Chinese proper nouns (人名, 地名, 国名, 官职) → MUST use Hán Việt (Sino-Vietnamese reading). Examples: 清河 → Thanh Hà, 慕容冲 → Mộ Dung Xung, 洛阳 → Lạc Dương, 东晋 → Đông Tấn, 前秦 → Tiền Tần.
- Dynasty/era names → Hán Việt. Examples: 永嘉 → Vĩnh Gia, 太元 → Thái Nguyên, 建元 → Kiến Nguyên.
- Titles/positions → Hán Việt. Examples: 太守 → Thái thú, 刺史 → Thứ sử, 将军 → Tướng quân.
- Use natural Vietnamese roleplay pronouns (ta, ngươi, hắn, nàng).
- Maintain literary/classical Vietnamese tone for historical content.`
    : '';

  const systemPrompt = `You are a professional CJK-to-${targetLang} translation engine specialized in game/roleplay character cards.
You MUST translate ALL items completely. Do NOT skip any item.
The source text is from a historical Chinese roleplay card containing proper nouns (人名, 地名, 朝代), game mechanics, and narrative descriptions.

INPUT FORMAT: Lines formatted as "#{id}\t{CJK text}"
OUTPUT FORMAT: Return ONLY "#{id}\t{translated text}" for EACH input line. One line per item.

CRITICAL RULES:
1. Translate EVERY item. Zero untranslated Chinese characters allowed in output.
2. Keep output format exactly: #{id}\t{translated text}
3. Do NOT output any markdown, explanations, or conversational text.
4. Do NOT use < > \` { } in your translations.
5. Output ALL items — do NOT truncate or summarize even if the list is long.
${langRules}${glossaryPrompt}${mvuPrompt}`;

  try {
    const processBatch = async (batch: CJKToken[], label: string): Promise<void> => {
      const payload = batch.map(t => `#${t.id}\t${t.text}`).join('\n');
      
      let matched = 0;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          writeDebugLog(`[surgicalTranslate] Sending ${label} (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);
          const rawResult = await callProvider(config, systemPrompt, payload, signal);
          writeDebugLog(`[surgicalTranslate] Received ${label} raw response of length ${rawResult.length}`);
          const parsedTranslations = parseBatchResponse(rawResult);
          matched = applyBatchTranslations(batch, parsedTranslations);
          writeDebugLog(`[surgicalTranslate] Matched ${matched}/${batch.length} for ${label}`);

          if (matched >= batch.length * 0.5) {
            console.log(`[surgicalTranslate] ${label}: ${matched}/${batch.length} tokens matched${attempt > 0 ? ` (retry ${attempt})` : ''}`);
            break;
          } else if (attempt < MAX_RETRIES) {
            console.warn(`[surgicalTranslate] ${label}: only ${matched}/${batch.length} matched, retrying (${attempt + 1}/${MAX_RETRIES})...`);
            writeDebugLog(`[surgicalTranslate] Low match rate (${matched}/${batch.length}) for ${label}, retrying...`);
          } else {
            console.warn(`[surgicalTranslate] ${label}: ${matched}/${batch.length} matched after ${MAX_RETRIES} retries`);
            writeDebugLog(`[surgicalTranslate] Low match rate (${matched}/${batch.length}) for ${label} after all retries`);
          }
        } catch (err: any) {
          writeDebugLog(`[surgicalTranslate] Error in ${label} attempt ${attempt + 1}: ${err.message || String(err)}`);
          if (attempt < MAX_RETRIES) {
            console.warn(`[surgicalTranslate] ${label}: error on attempt ${attempt + 1}, retrying...`, err);
          } else {
            console.error(`[surgicalTranslate] ${label}: failed after ${MAX_RETRIES} retries:`, err);
          }
        }
      }
    };

    // ── Phase 1: Try mega-batch (all tokens in 1 API call) ──
    await processBatch(tokenBatches[0], `Mega-batch (${uniquePendingTokens.length} tokens)`);
    
    // Check mega-batch success rate
    const megaMatched = uniquePendingTokens.filter(t => t.translated && t.translated.trim() !== '').length;
    const megaMatchRate = megaMatched / uniquePendingTokens.length;
    
    if (megaMatchRate < 0.5 && usedMegaBatch) {
      // ── Phase 2: Mega-batch failed (LLM truncated) → split into parallel smaller batches ──
      console.warn(`[surgicalTranslate] Mega-batch only matched ${megaMatched}/${uniquePendingTokens.length} (${(megaMatchRate * 100).toFixed(0)}%). Falling back to parallel ${FALLBACK_BATCH_SIZE}-token batches...`);
      writeDebugLog(`[surgicalTranslate] Mega-batch fallback triggered. Match rate: ${(megaMatchRate * 100).toFixed(0)}%`);
      
      // Collect tokens that still need translation
      const stillPending = uniquePendingTokens.filter(t => !t.translated || t.translated.trim() === '');
      tokenBatches = [];
      for (let i = 0; i < stillPending.length; i += FALLBACK_BATCH_SIZE) {
        tokenBatches.push(stillPending.slice(i, i + FALLBACK_BATCH_SIZE));
      }
      
      // Process fallback batches in parallel waves
      for (let waveStart = 0; waveStart < tokenBatches.length; waveStart += PARALLEL_CONCURRENCY) {
        const waveEnd = Math.min(waveStart + PARALLEL_CONCURRENCY, tokenBatches.length);
        const wave = tokenBatches.slice(waveStart, waveEnd);
        
        console.log(`[surgicalTranslate] Fallback wave ${Math.floor(waveStart / PARALLEL_CONCURRENCY) + 1}/${Math.ceil(tokenBatches.length / PARALLEL_CONCURRENCY)}: batches ${waveStart + 1}-${waveEnd}/${tokenBatches.length} in parallel...`);
        
        await Promise.all(wave.map((batch, i) => 
          processBatch(batch, `Fallback batch ${waveStart + i + 1}/${tokenBatches.length}`)
        ));
      }
    } else {
      console.log(`[surgicalTranslate] Mega-batch success: ${megaMatched}/${uniquePendingTokens.length} matched (${(megaMatchRate * 100).toFixed(0)}%)`);
    }
    
    // ── Phase 3: Sub-batch recovery for any remaining untranslated tokens ──
    const finalUntranslated = uniquePendingTokens.filter(t => !t.translated || t.translated.trim() === '');
    if (finalUntranslated.length > 5) {
      console.log(`[surgicalTranslate] Recovery: ${finalUntranslated.length} tokens still untranslated, retrying in micro-batches...`);
      const MICRO_BATCH = 50;
      const microBatches = [];
      for (let si = 0; si < finalUntranslated.length; si += MICRO_BATCH) {
        microBatches.push(finalUntranslated.slice(si, si + MICRO_BATCH));
      }
      await Promise.all(microBatches.map((mb, i) =>
        processBatch(mb, `Recovery micro-batch ${i + 1}/${microBatches.length}`)
      ));
    }
    
    // Build a cache of successful translations from unique tokens (and local glossary matches)
    const translationCache: Record<string, string> = {};
    for (const token of tokens) {
      if (token.translated && token.translated !== token.text && token.translated.trim() !== '') {
        translationCache[token.text] = token.translated;
      }
    }

    // Apply translations to all tokens, filling missing ones from cache or keeping original
    for (const token of tokens) {
      if (!token.translated || token.translated.trim() === '') {
        if (translationCache[token.text]) {
          token.translated = translationCache[token.text];
        } else {
          token.translated = token.text;
        }
      }
    }
    
    const rawReinserted = reinsertTranslations(text, tokens);
    // Normalize fullwidth punctuation to prevent imbalanced parens/brackets
    const reinserted = normalizeFullwidthPunctuation(rawReinserted);
    const isValid = verifySurgicalResult(text, reinserted);
    
    const translatedCount = tokens.filter(t => t.translated !== t.text).length;
    const missedCount = tokens.filter(t => t.translated === t.text).length;
    console.log(`[surgicalTranslate] Complete: ${translatedCount}/${tokens.length} tokens translated, ${missedCount} remained original, verification=${isValid ? 'PASS' : 'FAIL'}`);
    writeDebugLog(`[surgicalTranslate] Complete: translated=${translatedCount}, missed=${missedCount}, verification=${isValid ? 'PASS' : 'FAIL'}`);

    if (isValid) {
      if (missedCount > 0) {
        console.warn(`[surgicalTranslate] ${missedCount} tokens could not be translated:`, tokens.filter(t => t.translated === t.text).map(m => m.text).slice(0, 20));
      }
      writeDebugLog(`[surgicalTranslate] Verification PASSED. Returning translated text.`);
      return { translated: reinserted, success: true, fallbackTriggered: false };
    } else if (!strictVerification) {
      // Lenient mode: accept the result even if verification fails (for replaceString with no fallback)
      console.warn(`[surgicalTranslate] Verification failed but strictVerification=false, accepting result with ${translatedCount} translations applied`);
      writeDebugLog(`[surgicalTranslate] Verification FAILED but strictVerification=false (lenient). Accepting result anyway.`);
      return { translated: reinserted, success: true, fallbackTriggered: false };
    } else {
      console.warn('[surgicalTranslate] Verification FAILED (strict mode). Falling back to normal translation.');
      writeDebugLog(`[surgicalTranslate] Verification FAILED (strict mode). Returning original text.`);
      return { translated: text, success: false, fallbackTriggered: true };
    }
  } catch (err: any) {
    console.error('[surgicalTranslate] Fatal error:', err);
    writeDebugLog(`[surgicalTranslate] Fatal error: ${err.message || String(err)}`);
    return { translated: text, success: false, fallbackTriggered: true };
  }
}
