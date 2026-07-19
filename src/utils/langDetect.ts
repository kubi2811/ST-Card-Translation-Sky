import { countHanStripped } from './cjk';
/**
 * Heuristic language detection optimized for Vietnamese + CJK detection.
 * Vietnamese is special: it uses Latin script + diacritics, so pure character
 * counting would mis-classify it as English. Instead, we use a "fingerprint"
 * approach: if Vietnamese-specific diacritics exist, it's Vietnamese.
 */

/* ─── Vietnamese-specific characters ─── */
// These diacritics/chars ONLY appear in Vietnamese, not French/Spanish/etc.
const VI_UNIQUE_CHARS = /[ạảẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđĐ]/;
const VI_UNIQUE_CHARS_G = /[ạảẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđĐ]/g;

// Broader Vietnamese diacritics (includes chars shared with French/Spanish)
const VI_ALL_DIACRITICS_G = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/g;

/* ─── CJK / Kana / Hangul ─── */
const CJK_G = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
const KANA_G = /[\u3040-\u309f\u30a0-\u30ff]/g;
const HANGUL_G = /[\uac00-\ud7af\u1100-\u11ff]/g;

/* ─── Cleanup ─── */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')           // HTML tags
    .replace(/\{\{[^}]+\}\}/g, '')     // {{placeholders}}
    .replace(/\[\[?[^\]]*\]?\]/g, '')  // [[brackets]]
    .replace(/```[\s\S]*?```/g, '')    // Code blocks
    .replace(/https?:\/\/\S+/g, '')    // URLs
    .trim();
}

/**
 * Detect dominant language of text.
 */
export function detectLanguage(text: string): string {
  const clean = cleanText(text);
  if (clean.length < 5) return 'unknown';

  const cjkMatches = clean.match(CJK_G);
  const kanaMatches = clean.match(KANA_G);
  const hangulMatches = clean.match(HANGUL_G);
  const cyrillicMatches = clean.match(/[\u0400-\u04ff]/g);

  const cjkCount = cjkMatches?.length || 0;
  const kanaCount = kanaMatches?.length || 0;
  const hangulCount = hangulMatches?.length || 0;
  const cyrillicCount = cyrillicMatches?.length || 0;

  // ── Check for Vietnamese ──
  const viUniqueMatches = clean.match(VI_UNIQUE_CHARS_G);
  const viAllMatches = clean.match(VI_ALL_DIACRITICS_G);
  
  let isVietnamese = false;
  if (viUniqueMatches && viUniqueMatches.length >= 2) {
    isVietnamese = true;
  } else if (viAllMatches && viAllMatches.length >= 5) {
    const viExclusiveTest = /[ơưăĂƠƯ]/.test(clean);
    if (viExclusiveTest) isVietnamese = true;
  }

  if (isVietnamese) {
    // If it's Vietnamese BUT it also has a substantial amount of CJK/foreign text, it's mixed.
    // Example: A lorebook entry with Chinese headers and Vietnamese content.
    if (cjkCount >= 5 || kanaCount >= 3 || hangulCount >= 3 || cyrillicCount >= 5) {
      return 'mixed';
    }
    return 'Tiếng Việt';
  }

  // ── Priority 2: CJK-based languages ──
  // Japanese: has kana OR mixed CJK+kana
  if (kanaCount > 0 && (kanaCount + cjkCount) > 3) return '日本語';
  // Korean
  if (hangulCount > 3) return '한국어';
  // Chinese: only CJK, no kana/hangul
  if (cjkCount > 3 && kanaCount === 0 && hangulCount === 0) return '中文';

  // ── Priority 3: Cyrillic (Russian) ──
  if (cyrillicCount > 3) return 'Русский';

  // ── Priority 4: Other Latin-script languages ──
  // German: ä, ö, ü, ß
  const germanChars = clean.match(/[äöüßÄÖÜẞ]/g);
  if (germanChars && germanChars.length >= 3) return 'Deutsch';

  // Spanish: ñ, ¿, ¡
  const spanishChars = clean.match(/[ñ¿¡Ñ]/g);
  if (spanishChars && spanishChars.length >= 2) return 'Español';

  // French: ç, œ, æ, ê, û with no Vietnamese markers
  const frenchChars = clean.match(/[çœæÇŒÆ]/g);
  if (frenchChars && frenchChars.length >= 2) return 'Français';

  // ── Default: if text is mostly Latin letters → English ──
  const latinLetters = clean.match(/[a-zA-Z]/g);
  if (latinLetters && latinLetters.length > clean.length * 0.3) return 'English';

  return 'unknown';
}

/* ─── Language label normalization ─── */
const LANG_LABEL_MAP: Record<string, string> = {
  'Tiếng Việt': 'Tiếng Việt',
  'English': 'English',
  '日本語': '日本語',
  '한국어': '한국어',
  'Français': 'Français',
  'Deutsch': 'Deutsch',
  'Español': 'Español',
  '中文': '中文',
  'Русский': 'Русский',
};

/**
 * Check if text should be skipped for translation. Skips when:
 *  1. Text is already in the TARGET language (nothing to do), or
 *  2. (Bug "dịch cả entry tiếng Anh" 2026) The user declared a SPECIFIC source language
 *     (e.g. FROM 中文 in the Custom Translation Prompt) and the text is definitively in a
 *     DIFFERENT specific language that is neither source nor target (e.g. a pure-English
 *     lorebook entry in a Chinese card). Master prompt rules ("no foreign chars may remain")
 *     used to force the AI to translate those too — violating the user's FROM/TO contract.
 *     This guard is deterministic: the field never reaches the AI at all.
 * 'unknown'/'mixed' still always translate (cards mix languages — let the AI handle them),
 * and sourceLanguage 'auto' keeps the old behavior (only target-language skip).
 */
export function shouldSkipTranslation(text: string, targetLanguage: string, sourceLanguage: string = 'auto'): boolean {
  const detected = detectLanguage(text);
  // If we can't detect or it's mixed → always translate (let AI handle it)
  if (detected === 'unknown' || detected === 'mixed') return false;

  const normalizedTarget = LANG_LABEL_MAP[targetLanguage] || targetLanguage;
  // Skip if text is definitively already in the target language
  if (detected === normalizedTarget) return true;

  // Skip if text is definitively in a THIRD language (≠ declared source, ≠ target).
  // Only when the source is a specific known language — 'auto' means "translate whatever".
  const normalizedSource = LANG_LABEL_MAP[sourceLanguage];
  if (normalizedSource && normalizedSource !== normalizedTarget && detected !== normalizedSource) {
    return true;
  }

  return false;
}

/* --- Residual-CJK detection (chong "DONE gia") --- */
// (Audit dot 3) stripUrls + regex dem Han gom ve utils/cjk.ts - truoc day dup 3 noi.
export function countCjk(text: string): number {
  return countHanStripped(text || '');
}

export interface ResidualCjkResult {
  suspect: boolean;   // true ⇒ gần như chắc chắn CHƯA DỊCH (echo nguồn) hoặc dịch dở
  origCjk: number;
  transCjk: number;
  survival: number;   // transCjk / origCjk (0 khi nguồn không có Hán)
}

/**
 * Phát hiện field văn bản thường bị AI TRẢ LẠI NGUYÊN VĂN (echo) hoặc dịch dở nửa chừng.
 * Bản dịch tốt zh→ngôn ngữ Latin hầu như 0% chữ Hán (chỉ vài danh từ riêng ≈ vài %).
 * Nếu tỷ lệ chữ Hán SỐNG SÓT so với nguồn vượt `maxSurvival` (mặc định 0.35) và nguồn có ít nhất
 * `minOrigCjk` chữ Hán (mặc định 20) ⇒ nghi CHƯA DỊCH.
 * KHÔNG dùng cho lorebook_keys (merge mode cố ý giữ key gốc) hay code field (CJK trong code hợp lệ).
 */
export function detectResidualCjk(
  original: string,
  translated: string,
  opts: { minOrigCjk?: number; maxSurvival?: number } = {}
): ResidualCjkResult {
  const minOrigCjk = opts.minOrigCjk ?? 20;
  const maxSurvival = opts.maxSurvival ?? 0.35;
  const origCjk = countCjk(original);
  const transCjk = countCjk(translated);
  if (origCjk < minOrigCjk) {
    return { suspect: false, origCjk, transCjk, survival: origCjk ? transCjk / origCjk : 0 };
  }
  const survival = transCjk / origCjk;
  return { suspect: survival > maxSurvival, origCjk, transCjk, survival };
}
