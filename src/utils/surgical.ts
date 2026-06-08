// ── Imports ───────────────────────────────────────────────────────────────────
import { extractTranslationFromResponse } from './masterPrompt';
import type { ProxySettings, GlossaryEntry } from '../types/card';
import { writeDebugLog } from './debugLogger';

// ═══════════════════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════════════════

export interface CJKToken {
  id: number;
  text: string;
  start: number;
  end: number;
  translated?: string;
  isIdentifier?: boolean;
}

/**
 * Optional progress callback fired at each meaningful stage.
 * @param translated  Number of tokens translated so far
 * @param total       Total token count
 * @param stage       Human-readable stage label
 */
export type TranslationProgressCallback = (
  translated: number,
  total: number,
  stage: string
) => void;

// ═══════════════════════════════════════════════════════════════════════════════
// Internal types
// ═══════════════════════════════════════════════════════════════════════════════

/** A region of the source text that must not be modified during translation. */
interface ProtectedZone {
  start: number;
  end: number;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSS protection helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Identifies CSS property-name positions inside <style> blocks and inline
 * style attributes.  CJK tokens that overlap these zones are excluded from
 * extraction, preventing property names such as `gap` from ever being sent
 * to the LLM and getting replaced with translated words (e.g. "Tay").
 *
 * The zones are intentionally broad: they cover ANY text before a CSS colon,
 * including already-corrupted non-ASCII property names, so that
 * `restoreCSSFromOriginal` can locate and fix them.
 */
function extractCSSPropertyZones(text: string): ProtectedZone[] {
  const zones: ProtectedZone[] = [];

  // ── 1. <style> … </style> blocks ──────────────────────────────────────────
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let sb: RegExpExecArray | null;
  while ((sb = styleBlockRe.exec(text)) !== null) {
    const innerStart = sb.index + sb[0].indexOf(sb[1]);
    const inner      = sb[1];

    // Match: optional-indent  PROPERTY-NAME  whitespace* : (not ::)
    // Intentionally wide — catches already-translated non-ASCII names too.
    const propRe = /^([ \t]*)([^\s{}:;/\n][^{}:;\n]*?)(\s*:(?!:))/gm;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(inner)) !== null) {
      zones.push({
        start:  innerStart + pm.index + pm[1].length,
        end:    innerStart + pm.index + pm[1].length + pm[2].length,
        reason: `css-property:${pm[2].trim()}`,
      });
    }
  }

  // ── 2. Inline style="…" attributes ────────────────────────────────────────
  // Protect the entire value to avoid mangling property names inside.
  const inlineRe = /\bstyle\s*=\s*(?:"([^"]*?)"|'([^']*?)')/gi;
  let im: RegExpExecArray | null;
  while ((im = inlineRe.exec(text)) !== null) {
    const val    = im[1] ?? im[2];
    const vStart = im.index + im[0].indexOf(val);
    zones.push({ start: vStart, end: vStart + val.length, reason: 'inline-style' });
  }

  return zones;
}

/**
 * Compares <style> blocks between `original` and `translated` and restores
 * any CSS property names that were changed by translation (e.g. "gap" → "Tay").
 *
 * Strategy A — Line-by-line (preferred when line counts match):
 *   Aligns declarations by position; restores property name where the
 *   original has a valid ASCII name and the translated has a different one.
 *
 * Strategy B — Value-fingerprint (fallback when line counts differ):
 *   Builds a map of {valueFingerprint → propertyName} from the original,
 *   then scans each translated line.  If the value portion matches an
 *   original declaration but the property name is non-ASCII or unknown,
 *   the correct name is spliced in.
 */
function restoreCSSFromOriginal(original: string, translated: string): string {
  // Collect inner contents of all <style> blocks in the original, in order
  const origInners: string[] = [];
  const collectRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = collectRe.exec(original)) !== null) origInners.push(m[1]);
  if (origInners.length === 0) return translated;

  let blockIdx = 0;
  return translated.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (fullMatch, inner) => {
    const origInner = origInners[blockIdx++];
    if (!origInner) return fullMatch;

    const origLines  = origInner.split('\n');
    const transLines = inner.split('\n');

    // ── Strategy A: Line-by-line (line counts match) ─────────────────────
    if (origLines.length === transLines.length) {
      let restoredCount = 0;
      const fixedLines = transLines.map((tLine: string, i: number) => {
        const oLine = origLines[i];

        // Original line must have a valid ASCII CSS property name before ':'
        const oM = oLine.match(/^([ \t]*)([a-zA-Z][a-zA-Z0-9-]*)(\s*:(?!:))/);
        if (!oM) return tLine;

        // Translated line must look like a property declaration (any name)
        const tM = tLine.match(/^([ \t]*)([^\s{}:;/\n][^{}:;\n]*?)(\s*:(?!:))/);
        if (!tM) return tLine;

        const origProp  = oM[2];
        const transProp = tM[2].trim();

        if (origProp === transProp) return tLine;

        const indent    = tM[1];
        const afterProp = tLine.slice(indent.length + tM[2].length);
        console.warn(`[restoreCSSFromOriginal] Line restore: "${transProp}" → "${origProp}"`);
        restoredCount++;
        return indent + origProp + afterProp;
      });

      if (restoredCount > 0) {
        console.log(`[restoreCSSFromOriginal] Restored ${restoredCount} property name(s) via line-by-line`);
      }

      const innerStart = fullMatch.indexOf(inner);
      if (innerStart === -1) return fullMatch;
      return (
        fullMatch.slice(0, innerStart) +
        fixedLines.join('\n') +
        fullMatch.slice(innerStart + inner.length)
      );
    }

    // ── Strategy B: Value-fingerprint (line counts differ, e.g. CJK comments
    //    translated to a different number of lines) ──────────────────────────
    type PropEntry = { prop: string; valueFingerprint: string };
    const origMap: PropEntry[] = [];
    for (const oLine of origLines) {
      const oM = oLine.match(/^[ \t]*([a-zA-Z][a-zA-Z0-9-]*)\s*:(?!:)\s*(.+)/);
      if (oM) {
        origMap.push({
          prop:             oM[1],
          // First 30 non-space chars of the value as a fingerprint
          valueFingerprint: oM[2].replace(/\s+/g, '').slice(0, 30),
        });
      }
    }

    if (origMap.length === 0) return fullMatch;

    let fuzzyFixed = 0;
    const fixedLines = transLines.map((tLine: string) => {
      // Only touch lines that look like property declarations
      const tM = tLine.match(/^([ \t]*)([^\s{}:;/\n][^{}:;\n]*?)(\s*:(?!:))\s*(.+)/);
      if (!tM) return tLine;

      const tProp  = tM[2].trim();
      const tValue = tM[4].replace(/\s+/g, '').slice(0, 30);

      // Already a valid ASCII CSS property — leave it alone
      if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tProp)) return tLine;

      // Find an original entry whose value fingerprint best matches
      const hit = origMap.find(e =>
        tValue.startsWith(e.valueFingerprint) || e.valueFingerprint.startsWith(tValue)
      );
      if (!hit) return tLine;

      console.warn(`[restoreCSSFromOriginal] Fuzzy restore: "${tProp}" → "${hit.prop}" (value match)`);
      fuzzyFixed++;
      // Rebuild the line with the corrected property name
      const afterProp = tLine.slice(tM[1].length + tM[2].length);
      return tM[1] + hit.prop + afterProp;
    });

    if (fuzzyFixed > 0) {
      console.log(`[restoreCSSFromOriginal] Restored ${fuzzyFixed} property name(s) via value-fingerprint`);
    }

    if (fuzzyFixed === 0) return fullMatch; // Nothing changed, keep original match

    const innerStart = fullMatch.indexOf(inner);
    if (innerStart === -1) return fullMatch;
    return (
      fullMatch.slice(0, innerStart) +
      fixedLines.join('\n') +
      fullMatch.slice(innerStart + inner.length)
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core extraction / reinsertion
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extracts segments of CJK text, skipping code brackets, braces, fullwidth
 * punctuation (（），。：；！？), and optionally any caller-supplied
 * ProtectedZones (e.g. CSS property-name positions).
 *
 * EXCLUDED unicode ranges:
 * - \u3000-\u303f  CJK Symbols & Punctuation  (。、「」 …)
 * - \uff00-\uff64  Fullwidth punctuation       (（），：；！？ …)
 * INCLUDED unicode ranges:
 * - \u4e00-\u9fff  CJK Unified Ideographs
 * - \u3400-\u4dbf  CJK Extension A
 * - \u3040-\u30ff  Hiragana + Katakana
 * - \uac00-\ud7af  Hangul Syllables
 * - \uff65-\uffdc  Halfwidth Katakana + Fullwidth Latin/Hangul
 *
 * NOTE: A-Za-z is deliberately excluded from joiners so that English words
 * such as CSS properties are never captured as part of a CJK token.
 */
export function extractCJKTokens(
  text: string,
  protectedZones?: ProtectedZone[],
  cssCjkHandling: 'preserve' | 'translate' = 'preserve'
): CJKToken[] {
  const tokens: CJKToken[] = [];
  const regex =
    /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\uff65-\uffdc]+(?:[ \t0-9.\-_%]+[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\uff65-\uffdc]+)*/g;

  let match: RegExpExecArray | null;
  let id = 1;
  while ((match = regex.exec(text)) !== null) {
    const hasIdeograph =
      /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(match[0]);
    if (!hasIdeograph) continue;

    const mStart = match.index;
    const mEnd   = match.index + match[0].length;

    // ── Skip tokens overlapping a protected zone (e.g. CSS property name) ──
    if (protectedZones?.some(z => mStart < z.end && mEnd > z.start)) continue;

    const contextBefore = text.slice(Math.max(0, mStart - 80), mStart);
    const contextAfter  = text.slice(mEnd, Math.min(text.length, mEnd + 30));

    // Skip CJK inside CSS function calls: e.g. var(--中文)
    const isCssFunc  = /[a-zA-Z-]+\s*\(\s*$/.test(contextBefore);
    const isCssValue = isCssFunc && /^\s*[\d\s,.)px%ems]+/.test(contextAfter);
    if (isCssValue) continue;

    // Check if it's used as a JS identifier (unquoted object key or dot notation)
    const isObjectKey = /^\s*:/.test(contextAfter) && !/^\s*:\/\//.test(contextAfter);
    const isDotNotation = /\.\s*$/.test(contextBefore);
    const isIdentifier = isObjectKey || isDotNotation;

    if (isIdentifier && cssCjkHandling === 'preserve') {
      continue;
    }

    tokens.push({ id: id++, text: match[0], start: mStart, end: mEnd, isIdentifier });
  }
  return tokens;
}

/**
 * Reinserts translated tokens back into the original string.
 * Processes tokens right-to-left so earlier position indices remain valid
 * even when translated text has a different byte length.
 */
export function reinsertTranslations(original: string, tokens: CJKToken[]): string {
  let result = original;
  const sorted = [...tokens].sort((a, b) => b.start - a.start);
  for (const token of sorted) {
    if (token.translated) {
      let finalTranslation = token.translated;
      if (token.isIdentifier) {
        finalTranslation = finalTranslation.replace(/\s+/g, '_');
      }
      result = result.slice(0, token.start) + finalTranslation + result.slice(token.end);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Structural verification
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verifies that structural integrity is preserved after translation.
 * Treats fullwidth and halfwidth variants as equivalent (e.g. （ = (), ） = )).
 *
 * Also verifies that the count of CSS property declarations inside <style>
 * blocks is unchanged.  A mismatch indicates a property was corrupted or
 * removed during translation.
 */
export function verifySurgicalResult(original: string, translated: string): boolean {
  const countChar = (str: string, ch: string): number => {
    let c = 0;
    for (let i = 0; i < str.length; i++) if (str[i] === ch) c++;
    return c;
  };
  const countPair = (str: string, half: string, full: string) =>
    countChar(str, half) + countChar(str, full);

  if (countChar(original, '`') !== countChar(translated, '`')) return false;
  if (countPair(original, '{', '\uff5b') !== countPair(translated, '{', '\uff5b')) return false;
  if (countPair(original, '}', '\uff5d') !== countPair(translated, '}', '\uff5d')) return false;
  if (countPair(original, '<', '\uff1c') !== countPair(translated, '<', '\uff1c')) return false;
  if (countPair(original, '>', '\uff1e') !== countPair(translated, '>', '\uff1e')) return false;
  if (countPair(original, '(', '\uff08') !== countPair(translated, '(', '\uff08')) return false;
  if (countPair(original, ')', '\uff09') !== countPair(translated, ')', '\uff09')) return false;

  // ── CSS declaration count (only when <style> is present) ─────────────────
  if (/<style[\s>]/i.test(original)) {
    const countDecls = (str: string): number => {
      let n = 0;
      const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let sm: RegExpExecArray | null;
      while ((sm = re.exec(str)) !== null) {
        for (const ln of sm[1].split('\n')) {
          // Only count lines whose property name is valid ASCII CSS
          if (/^\s*[-a-zA-Z][a-zA-Z0-9-]*\s*:(?!:)/.test(ln)) n++;
        }
      }
      return n;
    };
    if (countDecls(original) !== countDecls(translated)) return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Text-level post-processing helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lightly sanitizes LLM output.
 * Strips markdown artifacts (```, ***) that models occasionally insert.
 * Does NOT strip < > { } — they are valid in HTML-heavy replaceString fields.
 */
function sanitizeTranslatedText(text: string): string {
  return text
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/\n?```$/gm, '')
    .replace(/^\*{3,}$/gm, '')
    .trim();
}

/**
 * Normalises fullwidth CJK punctuation to halfwidth equivalents.
 * Applied after reinsertion to prevent imbalanced parentheses/brackets when
 * the LLM converts some but not all fullwidth characters.
 */
function normalizeFullwidthPunctuation(text: string): string {
  const map: Record<string, string> = {
    '\uff08': '(', '\uff09': ')', '\uff0c': ',', '\u3002': '.',
    '\uff1a': ':', '\uff1b': ';', '\uff01': '!', '\uff1f': '?',
  };
  return text.replace(/[\uff08\uff09\uff0c\u3002\uff1a\uff1b\uff01\uff1f]/g, ch => map[ch] || ch);
}

/**
 * Post-validation safety net for CSS property names.
 *
 * Step 1 — calls `restoreCSSFromOriginal` to actually FIX corrupted names
 *           using the original text as the source of truth.
 * Step 2 — scans remaining unrecognised property names and logs a warning
 *           for each (these may be valid vendor-specific or custom properties
 *           not in the known-set, or may indicate residual corruption).
 */
function postValidateCSSProperties(original: string, translated: string): string {
  if (!/<style[\s>]/i.test(translated)) return translated;

  // ── Step 1: Structural restoration using the original ────────────────────
  let result = restoreCSSFromOriginal(original, translated);

  // ── Step 2: Warn about any remaining unrecognised property names ──────────
  const knownCSS = new Set([
    'gap', 'flex', 'display', 'grid', 'margin', 'padding', 'border', 'color',
    'width', 'height', 'font', 'background', 'position', 'top', 'left', 'right',
    'bottom', 'opacity', 'overflow', 'transform', 'transition', 'animation',
    'cursor', 'z-index', 'align-items', 'justify-content', 'box-sizing',
    'text-align', 'font-size', 'font-family', 'font-weight', 'line-height',
    'letter-spacing', 'white-space', 'word-break', 'max-width', 'max-height',
    'min-width', 'min-height', 'border-radius', 'box-shadow', 'text-shadow',
    'flex-direction', 'flex-wrap', 'align-self', 'order', 'resize',
    'visibility', 'outline', 'appearance', 'user-select', 'pointer-events',
    'backdrop-filter', 'content', 'float', 'clear', 'vertical-align',
    'text-decoration', 'text-transform', 'text-overflow', 'object-fit',
    'grid-template-columns', 'grid-template-rows', 'grid-gap', 'column-gap',
    'row-gap', 'place-items', 'place-content',
  ]);

  result = result.replace(/<style[\s\S]*?<\/style>/gi, styleBlock =>
    styleBlock.replace(
      // \s* (not \s+) so top-level (non-indented) properties are also caught
      /^(\s*)([A-ZÀ-Ỹa-zà-ỹ][A-ZÀ-Ỹa-zà-ỹ\s-]*?)(\s*:\s*)/gm,
      (match, _indent, propName) => {
        const lc = propName.trim().toLowerCase().replace(/\s+/g, '-');
        if (knownCSS.has(lc) || /^-(?:webkit|moz|ms|o)-/.test(lc)) return match;
        console.warn(
          `[postValidateCSS] Unrecognised CSS property "${propName.trim()}" — may still be corrupted`
        );
        return match;
      }
    )
  );

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Batch helpers
// ═══════════════════════════════════════════════════════════════════════════════

function parseBatchResponse(rawResult: string): { id?: number; text: string }[] {
  const parsed        = extractTranslationFromResponse(rawResult);
  const cleanedResult = parsed.translation || rawResult;
  const lines         = cleanedResult.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const results: { id?: number; text: string }[] = [];
  for (const line of lines) {
    const ml = line.match(/^(?:[^\d#]*#?\s*)(\d+)[\t \.\:\-\]\)]+(.+)$/);
    if (ml) {
      results.push({ id: parseInt(ml[1], 10), text: ml[2].trim() });
    } else {
      results.push({ text: line });
    }
  }
  return results;
}

function applyBatchTranslations(
  batch: CJKToken[],
  parsedTranslations: { id?: number; text: string }[]
): number {
  let matched = 0;

  const clean = (token: CJKToken, raw: string): string => {
    let t = raw;
    if (t.startsWith(token.text)) {
      t = t.substring(token.text.length).trim().replace(/^[\s:=>t()\[\]{}]+/, '').trim();
    }
    const paren   = `(${token.text})`;
    const bracket = `[${token.text}]`;
    if (t.endsWith(paren))   t = t.slice(0, -paren.length).trim();
    if (t.endsWith(bracket)) t = t.slice(0, -bracket.length).trim();
    return sanitizeTranslatedText(t);
  };

  if (parsedTranslations.length === batch.length) {
    // Positional mapping (most reliable when line count matches)
    for (let i = 0; i < batch.length; i++) {
      const cleaned = clean(batch[i], parsedTranslations[i].text);
      if (cleaned) { batch[i].translated = cleaned; matched++; }
    }
  } else {
    // Strict ID-based mapping
    for (const p of parsedTranslations) {
      if (p.id !== undefined) {
        const token = batch.find(t => t.id === p.id);
        if (token) {
          const cleaned = clean(token, p.text);
          if (cleaned) { token.translated = cleaned; matched++; }
        }
      }
    }
  }
  return matched;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Surgical translation orchestrator.
 *
 * Extracts CJK tokens from `text`, translates them via the LLM, reinserts the
 * results, and verifies structural integrity — all without touching surrounding
 * HTML/CSS/JS syntax.
 *
 * @param text               Source text (HTML / JS / plain)
 * @param config             API proxy settings
 * @param targetLang         Target language (e.g. "Vietnamese")
 * @param signal             Optional AbortSignal for cancellation
 * @param glossary           Optional glossary (source → target)
 * @param mvuDictionary      Optional MVU variable-name mappings
 * @param strictVerification If false, accept even if structural check fails
 * @param onProgress         Optional progress callback
 * @param cssCjkHandling     Whether to preserve or translate CJK CSS/JS identifiers
 */
export async function surgicalTranslate(
  text: string,
  config: ProxySettings,
  targetLang: string,
  signal?: AbortSignal,
  glossary?: GlossaryEntry[],
  mvuDictionary?: Record<string, string>,
  strictVerification: boolean = true,
  onProgress?: TranslationProgressCallback,
  cssCjkHandling: 'preserve' | 'translate' = 'preserve'
): Promise<{ translated: string; success: boolean; fallbackTriggered: boolean }> {
  const { callProvider } = await import('./apiClient');

  // ── Step 1: Extract CSS protected zones, then CJK tokens ──────────────────
  const cssZones = extractCSSPropertyZones(text);
  const tokens   = extractCJKTokens(text, cssZones, cssCjkHandling);

  writeDebugLog(
    `[surgicalTranslate] Start — strict=${strictVerification}, cssZones=${cssZones.length}, tokens=${tokens.length}`
  );

  if (tokens.length === 0) {
    writeDebugLog('[surgicalTranslate] No CJK tokens found, returning early');
    return { translated: text, success: true, fallbackTriggered: false };
  }

  onProgress?.(0, tokens.length, 'Extracting');

  // ── Step 2: Resolve tokens locally (glossary + MVU) ───────────────────────
  for (const token of tokens) {
    const trimmed = token.text.trim();
    if (mvuDictionary?.[trimmed]) {
      token.translated = mvuDictionary[trimmed];
      writeDebugLog(`[surgicalTranslate] MVU: "${trimmed}" → "${token.translated}"`);
      continue;
    }
    if (glossary) {
      const match = glossary.find(g => g.source.trim() === trimmed);
      if (match?.target.trim()) {
        token.translated = match.target.trim();
        writeDebugLog(`[surgicalTranslate] Glossary: "${trimmed}" → "${token.translated}"`);
      }
    }
  }

  const pendingTokens = tokens.filter(t => !t.translated);
  if (pendingTokens.length === 0) {
    const reinserted = reinsertTranslations(text, tokens);
    onProgress?.(tokens.length, tokens.length, 'Done (local)');
    return { translated: reinserted, success: true, fallbackTriggered: false };
  }

  // ── Step 3: Deduplicate pending tokens ────────────────────────────────────
  // Only the first occurrence of each unique string is sent to the LLM;
  // translations are propagated to all duplicates later via cache (Step 9).
  const uniqueMap = new Map<string, CJKToken>();
  for (const t of pendingTokens) {
    if (!uniqueMap.has(t.text)) uniqueMap.set(t.text, t);
  }
  const uniqueTokens = Array.from(uniqueMap.values());

  // ── Step 4: Build LLM prompt ───────────────────────────────────────────────
  const glossaryPrompt = glossary?.length
    ? '\n\nMANDATORY GLOSSARY (use these translations exactly):\n' +
      glossary
        .filter(g => g.source.trim() && g.target.trim())
        .map(g => `  "${g.source}" → "${g.target}"`)
        .join('\n')
    : '';

  const mvuPrompt =
    mvuDictionary && Object.keys(mvuDictionary).length
      ? '\n\nMVU VARIABLE MAPPINGS (use these translations exactly):\n' +
        Object.entries(mvuDictionary)
          .filter(([k, v]) => k && v && k !== v)
          .map(([k, v]) => `  "${k}" → "${v}"`)
          .join('\n')
      : '';

  const isVietnamese =
    targetLang.toLowerCase().includes('việt') ||
    targetLang.toLowerCase().includes('vietnamese');

  const langRules = isVietnamese
    ? `
VIETNAMESE-SPECIFIC RULES:
- Chinese proper nouns (人名, 地名, 国名, 官职) → MUST use Hán Việt (Sino-Vietnamese reading).
  Examples: 清河 → Thanh Hà, 慕容冲 → Mộ Dung Xung, 洛阳 → Lạc Dương, 东晋 → Đông Tấn, 前秦 → Tiền Tần.
- Dynasty/era names → Hán Việt. Examples: 永嘉 → Vĩnh Gia, 太元 → Thái Nguyên, 建元 → Kiến Nguyên.
- Titles/positions → Hán Việt. Examples: 太守 → Thái thú, 刺史 → Thứ sử, 将军 → Tướng quân.
- Use natural Vietnamese roleplay pronouns (ta, ngươi, hắn, nàng).
- Maintain literary/classical Vietnamese tone for historical content.`
    : '';

  const systemPrompt =
    `You are a professional CJK-to-${targetLang} translation engine for game/roleplay character cards.

INPUT FORMAT:  Lines formatted as "#{{id}}\t{{CJK text}}" or "#{{id}}\t{{CJK text}}\t[context: ...]"
OUTPUT FORMAT: Return ONLY "#{{id}}\t{{translated text}}" for EACH input line, one per item.

CRITICAL RULES:
1. Translate EVERY item. Zero untranslated CJK characters allowed in output.
2. Keep output format exactly: #{{id}}\t{{translated text}}
3. Do NOT output markdown, explanations, or conversational text.
4. Do NOT use < > \` { } in your translations.
5. Output ALL items — do NOT truncate or summarise even for very long lists.
6. Keep ALL English text exactly as-is (CSS properties, variable names, HTML tags, etc.).
7. Translate 无/無/没有 as the correct "none/nothing/empty" word in ${targetLang} (e.g. "Không" or "Không có" in Vietnamese). NEVER translate it as a date, month, or number.
8. CSS property names (gap, flex, display, margin, padding, border, color, width, height, font, background, grid, position, opacity, overflow, transform, transition, cursor, etc.) MUST NEVER appear in your translations — they are code, not prose.
9. If a [context: ...] hint is present, use it to understand meaning but do NOT include it in output.
${langRules}${glossaryPrompt}${mvuPrompt}`;

  // ── Step 5: Batch configuration ────────────────────────────────────────────
  const MEGA_BATCH_MAX   = 1500;
  const FALLBACK_BATCH   = 500;
  const MICRO_BATCH      = 50;
  const MAX_RETRIES      = 2;
  const PARALLEL_CONCUR  = 2;
  const STAGGER_MS       = 2000;
  const BATCH_TIMEOUT_MS = 500_000; // 500s per batch

  let tokenBatches: CJKToken[][] = [];
  let usedMegaBatch = false;

  if (uniqueTokens.length <= MEGA_BATCH_MAX) {
    tokenBatches  = [uniqueTokens];
    usedMegaBatch = true;
    console.log(`[surgicalTranslate] ${uniqueTokens.length} unique tokens — single mega-batch`);
  } else {
    for (let i = 0; i < uniqueTokens.length; i += FALLBACK_BATCH) {
      tokenBatches.push(uniqueTokens.slice(i, i + FALLBACK_BATCH));
    }
    console.log(
      `[surgicalTranslate] ${uniqueTokens.length} tokens — ` +
      `${tokenBatches.length} × ${FALLBACK_BATCH} batches, ${PARALLEL_CONCUR} parallel`
    );
  }
  writeDebugLog(
    `[surgicalTranslate] unique=${uniqueTokens.length}, megaBatch=${usedMegaBatch}, batches=${tokenBatches.length}`
  );

  // Track translated count for progress reporting (starts from locally resolved)
  let progressCount = tokens.filter(t => t.translated).length;

  // ── Step 6: Batch processor ────────────────────────────────────────────────
  const processBatch = async (batch: CJKToken[], label: string): Promise<void> => {
    // Fast-fail if the caller already aborted
    if (signal?.aborted) {
      writeDebugLog(`[surgicalTranslate] ${label} skipped — signal already aborted`);
      return;
    }

    const payload = batch
      .map(t => {
        // For short tokens add surrounding context so the LLM grasps meaning
        if (t.text.length <= 2) {
          const ctxStart = Math.max(0, t.start - 30);
          const ctxEnd   = Math.min(text.length, t.end + 30);
          const ctx      = text.slice(ctxStart, ctxEnd).replace(/[\n\r]+/g, ' ').trim();
          return `#${t.id}\t${t.text}\t[context: ${ctx}]`;
        }
        return `#${t.id}\t${t.text}`;
      })
      .join('\n');

    // Timer-safe API call — always clears the timeout, preventing timer leaks
    // when the API responds (either successfully or with an error) before the deadline.
    const callWithTimeout = (): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const timerId = setTimeout(
          () => reject(new Error(`Batch timeout after ${BATCH_TIMEOUT_MS / 1000}s`)),
          BATCH_TIMEOUT_MS
        );
        callProvider(config, systemPrompt, payload, signal)
          .then(r  => { clearTimeout(timerId); resolve(r); })
          .catch(e => { clearTimeout(timerId); reject(e); });
      });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Respect abort signal between retries
      if (signal?.aborted) {
        writeDebugLog(`[surgicalTranslate] ${label} aborted between retries`);
        break;
      }

      try {
        writeDebugLog(`[surgicalTranslate] ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
        const rawResult = await callWithTimeout();
        writeDebugLog(`[surgicalTranslate] ${label} raw response: ${rawResult.length} chars`);

        // Snapshot count before applying so we only report *newly* translated tokens,
        // avoiding double-counting when a batch is retried.
        const prevTranslated = batch.filter(t => t.translated?.trim()).length;
        const parsed         = parseBatchResponse(rawResult);
        const matched        = applyBatchTranslations(batch, parsed);
        const newlyTranslated = batch.filter(t => t.translated?.trim()).length - prevTranslated;

        progressCount += newlyTranslated;
        onProgress?.(Math.min(progressCount, tokens.length), tokens.length, label);
        writeDebugLog(
          `[surgicalTranslate] ${label}: matched=${matched}/${batch.length}, newly=${newlyTranslated}`
        );

        if (matched >= batch.length * 0.5) {
          console.log(
            `[surgicalTranslate] ${label}: ${matched}/${batch.length} matched` +
            (attempt > 0 ? ` (retry ${attempt})` : '')
          );
          break;
        } else if (attempt < MAX_RETRIES) {
          console.warn(
            `[surgicalTranslate] ${label}: only ${matched}/${batch.length} — retrying (${attempt + 1}/${MAX_RETRIES})`
          );
        } else {
          console.warn(
            `[surgicalTranslate] ${label}: ${matched}/${batch.length} after all retries`
          );
        }
      } catch (err: any) {
        writeDebugLog(`[surgicalTranslate] ${label} error (attempt ${attempt + 1}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          console.warn(`[surgicalTranslate] ${label}: error, retrying…`, err.message);
        } else {
          console.error(`[surgicalTranslate] ${label}: failed after ${MAX_RETRIES} retries`, err);
        }
      }
    }
  };

  // Runs batches in parallel with staggered start times to avoid rate-limit bursts
  const staggeredParallel = (
    batches: CJKToken[][],
    labelFn: (i: number) => string
  ): Promise<void[]> =>
    Promise.all(
      batches.map((batch, i) =>
        new Promise<void>(resolve =>
          setTimeout(async () => {
            await processBatch(batch, labelFn(i));
            resolve();
          }, i * STAGGER_MS)
        )
      )
    );

  // ── Step 7: Execute main batches ───────────────────────────────────────────
  try {
    if (usedMegaBatch) {
      // Path A: single mega-batch (≤1500 unique tokens)
      await processBatch(tokenBatches[0], `Mega-batch (${tokenBatches[0].length} tokens)`);

      const megaMatched = uniqueTokens.filter(t => t.translated?.trim()).length;
      const megaRate    = megaMatched / uniqueTokens.length;

      if (megaRate < 0.5) {
        console.warn(
          `[surgicalTranslate] Mega-batch matched only ${(megaRate * 100).toFixed(0)}%` +
          ` — falling back to parallel smaller batches`
        );
        const stillPending = uniqueTokens.filter(t => !t.translated?.trim());
        const fbBatches: CJKToken[][] = [];
        for (let i = 0; i < stillPending.length; i += FALLBACK_BATCH) {
          fbBatches.push(stillPending.slice(i, i + FALLBACK_BATCH));
        }
        for (let ws = 0; ws < fbBatches.length; ws += PARALLEL_CONCUR) {
          const wave = fbBatches.slice(ws, ws + PARALLEL_CONCUR);
          await staggeredParallel(wave, i => `Fallback ${ws + i + 1}/${fbBatches.length}`);
        }
      } else {
        console.log(
          `[surgicalTranslate] Mega-batch: ${megaMatched}/${uniqueTokens.length}` +
          ` (${(megaRate * 100).toFixed(0)}%)`
        );
      }
    } else {
      // Path B: parallel batches (>1500 unique tokens)
      for (let ws = 0; ws < tokenBatches.length; ws += PARALLEL_CONCUR) {
        const we   = Math.min(ws + PARALLEL_CONCUR, tokenBatches.length);
        const wave = tokenBatches.slice(ws, we);
        console.log(
          `[surgicalTranslate] Wave ${Math.floor(ws / PARALLEL_CONCUR) + 1}/` +
          `${Math.ceil(tokenBatches.length / PARALLEL_CONCUR)}:` +
          ` batches ${ws + 1}-${we}/${tokenBatches.length} (staggered ${STAGGER_MS}ms)`
        );
        await staggeredParallel(wave, i => `Batch ${ws + i + 1}/${tokenBatches.length}`);
      }
    }

    // ── Step 8: Recovery micro-batches for remaining untranslated tokens ──────
    // Runs for ANY untranslated token (not just when count > 5).
    const finalUntranslated = uniqueTokens.filter(t => !t.translated?.trim());
    if (finalUntranslated.length > 0) {
      console.log(
        `[surgicalTranslate] Recovery: ${finalUntranslated.length} token(s) still untranslated` +
        ` — retrying in micro-batches of ${MICRO_BATCH}`
      );
      const microBatches: CJKToken[][] = [];
      for (let i = 0; i < finalUntranslated.length; i += MICRO_BATCH) {
        microBatches.push(finalUntranslated.slice(i, i + MICRO_BATCH));
      }
      for (let ws = 0; ws < microBatches.length; ws += PARALLEL_CONCUR) {
        const wave = microBatches.slice(ws, ws + PARALLEL_CONCUR);
        await staggeredParallel(wave, i => `Recovery ${ws + i + 1}/${microBatches.length}`);
      }
    }

    // ── Step 9: Propagate translations to all duplicate tokens ────────────────
    const cache: Record<string, string> = {};
    for (const t of tokens) {
      if (t.translated && t.translated !== t.text && t.translated.trim()) {
        cache[t.text] = t.translated;
      }
    }
    for (const t of tokens) {
      if (!t.translated?.trim()) {
        t.translated = cache[t.text] ?? t.text; // keep original if still untranslated
      }
    }

    // ── Step 10: Reinsertion + post-processing ─────────────────────────────
    const rawReinserted = reinsertTranslations(text, tokens);
    const normalized    = normalizeFullwidthPunctuation(rawReinserted);
    // Pass the original `text` so CSS property names can be compared and restored
    const reinserted    = postValidateCSSProperties(text, normalized);
    const isValid       = verifySurgicalResult(text, reinserted);

    const translatedCount = tokens.filter(t => t.translated !== t.text).length;
    const missedCount     = tokens.filter(t => t.translated === t.text).length;

    console.log(
      `[surgicalTranslate] Complete: ${translatedCount}/${tokens.length} translated,` +
      ` ${missedCount} kept original, verify=${isValid ? 'PASS' : 'FAIL'}`
    );
    writeDebugLog(
      `[surgicalTranslate] translated=${translatedCount}, missed=${missedCount},` +
      ` verify=${isValid ? 'PASS' : 'FAIL'}`
    );

    onProgress?.(tokens.length, tokens.length, 'Complete');

    if (isValid) {
      if (missedCount > 0) {
        const samples = tokens
          .filter(t => t.translated === t.text)
          .map(t => t.text)
          .slice(0, 20);
        console.warn(`[surgicalTranslate] ${missedCount} token(s) untranslated (sample):`, samples);
      }
      writeDebugLog('[surgicalTranslate] Verification PASSED.');
      return { translated: reinserted, success: true, fallbackTriggered: false };
    } else if (!strictVerification) {
      console.warn(
        `[surgicalTranslate] Verification FAILED but strictVerification=false` +
        ` — accepting with ${translatedCount} translations applied`
      );
      writeDebugLog('[surgicalTranslate] Verification FAILED (lenient). Accepting result.');
      return { translated: reinserted, success: true, fallbackTriggered: false };
    } else {
      console.warn('[surgicalTranslate] Verification FAILED (strict) — falling back to original text');
      writeDebugLog('[surgicalTranslate] Verification FAILED (strict). Returning original.');
      return { translated: text, success: false, fallbackTriggered: true };
    }
  } catch (err: any) {
    console.error('[surgicalTranslate] Fatal error:', err);
    writeDebugLog(`[surgicalTranslate] Fatal error: ${err.message ?? String(err)}`);
    return { translated: text, success: false, fallbackTriggered: true };
  }
}
