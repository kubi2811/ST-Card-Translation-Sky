import { countHanStripped, stripUrlsForCjkCheck } from './cjk';
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
    //
    // (bug 234) NGƯỠNG HẠ TỪ 5 XUỐNG 1. Ngưỡng cũ nói rằng "tiếng Việt lẫn tối đa 4 chữ Hán thì
    // vẫn coi là tiếng Việt xịn" — mà đúng cái kết luận đó lại được `shouldSkipTranslation` dùng
    // để BỎ QUA cả field. Một entry dịch dở, còn nguyên tiêu đề Hán như "<道具>" ở đầu, vì thế
    // được đóng dấu "đã đúng ngôn ngữ đích" và không bao giờ được dịch nốt.
    // Còn chữ Hán = còn việc phải làm, không có mức "lẫn tí thì thôi".
    if (cjkCount >= 1 || kanaCount >= 1 || hangulCount >= 1 || cyrillicCount >= 5) {
      return 'mixed';
    }
    return 'Tiếng Việt';
  }

  /* ═══ (bug 237) KANA/HANGUL PHẢI THỰC SỰ GÁNH CHỮ, KHÔNG PHẢI ĐIỂM XUYẾT ═══
   * Luật cũ: `kanaCount > 0` — CHỈ CẦN MỘT ký tự kana là cả field được gọi là tiếng Nhật.
   *
   * Bằng chứng thẻ thật (bugNeedFix/237, lorebook[71].content — hồ sơ 材木座义辉): 398 ký tự,
   * 272 chữ HÁN, và đúng 2 kana — đến từ một chú thích furigana `我（われ）` lọt giữa đoạn văn
   * Trung. Bộ dò kết luận 日本語, rồi `shouldSkipTranslation` thấy "日本語 ≠ nguồn 中文, ≠ đích
   * Tiếng Việt" nên áp luật NGÔN NGỮ THỨ BA của yêu cầu #140 và BỎ QUA cả entry. 272 chữ Hán
   * không hề được gửi cho AI một lần nào, mà bảng vẫn ghi là đã xử lý.
   *
   * Chú ý ngoại lệ CJK của bug 234 nằm NGAY SAU chỗ này và cố ý cho 日本語 đi qua chốt "còn chữ
   * nguồn thì phải dịch" — nên nếu ở đây gọi nhầm tên ngôn ngữ thì không còn lưới nào đỡ.
   *
   * Sửa tại GỐC PHÉP ĐO thay vì thêm lưới thứ hai: tiếng Nhật KHÔNG viết được nếu thiếu kana
   * (trợ từ は/を/に/の, okurigana), nên văn bản Nhật thật luôn có tỉ lệ kana đáng kể trong khối
   * kana+Hán — kể cả nhan đề ngắn (`鋼の錬金術師` 1/6 ≈ 17%, `進撃の巨人` 1/5 = 20%). Còn văn bản
   * Trung lỡ dính một chú thích kana thì tỉ lệ đó là 2/274 ≈ 0,7%. Ngưỡng 12% tách sạch hai ca.
   *
   * Không đạt ngưỡng thì rơi xuống chốt 'mixed' phía dưới (kanaCount>0 chặn nhánh 中文 thuần),
   * mà 'mixed' thì LUÔN được dịch — nghiêng về phía dịch thừa, không nghiêng về phía bỏ sót.
   * Cùng một cái bẫy với 한국어 nên áp cùng một luật, không đợi nó nổ lần nữa.
   */
  const KANA_SHARE_MIN = 0.12;
  const cjkMass = kanaCount + cjkCount;
  if (kanaCount > 0 && cjkMass > 3 && kanaCount / cjkMass >= KANA_SHARE_MIN) return '日本語';
  // Korean
  if (hangulCount > 3 && hangulCount / (hangulCount + cjkCount) >= KANA_SHARE_MIN) return '한국어';
  // Chinese: only CJK, no kana/hangul
  if (cjkCount > 3 && kanaCount === 0 && hangulCount === 0) return '中文';

  // ── Priority 3: Cyrillic (Russian) ──
  if (cyrillicCount > 3) return 'Русский';

  /* ═══ (bug 234) CÒN CHỮ HÁN/KANA/HANGUL MÀ ĐI KẾT LUẬN "TIẾNG ANH" LÀ SAI ═══
   * User: "lỗi tự động bỏ qua khi trường ngắn và có xen kẽ như \"boss骇爪\" không dịch mà xem nó
   * như đã dịch."
   *
   * Đây chính là chỗ đẻ ra lỗi đó. Xuống tới đây nghĩa là chữ Hán ĐÃ CÓ nhưng chưa đủ ngưỡng
   * `cjkCount > 3` để gọi là 中文. Luật mặc định bên dưới chỉ hỏi "chữ Latin có chiếm >30% không";
   * "boss骇爪" có 4/6 là Latin nên nó trả về 'English'. Rồi `shouldSkipTranslation` thấy English
   * ≠ nguồn 中文, ≠ đích Tiếng Việt ⇒ kết luận "entry ngôn ngữ thứ ba, tôn trọng hợp đồng
   * FROM/TO, không dịch" và đóng dấu XONG. Field không hề được gửi cho AI lần nào.
   *
   * Một chuỗi vừa có chữ Latin vừa có chữ Hán KHÔNG phải tiếng Anh — nó là TRỘN. Trả 'mixed' để
   * mọi luật bỏ qua ở dưới tự động nhường đường (mixed luôn được dịch).
   *
   * Không đụng tới nhánh 中文/日本語/한국어 ở trên: chúng nằm TRƯỚC chốt này nên text thật sự
   * thuộc mấy ngôn ngữ đó vẫn được nhận đúng tên, và luật "ngôn ngữ thứ ba" vẫn chạy như cũ. */
  if (cjkCount > 0 || kanaCount > 0 || hangulCount > 0) return 'mixed';

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

  /* ═══ (bug 234) LUẬT CHUNG: CÒN CHỮ CHƯA DỊCH THÌ KHÔNG ĐƯỢC BỎ QUA ═══
   * Trước đây chốt này chỉ áp cho FIELD CODE (bug 108: vỏ JS là Latin, comment đã Việt, nhưng
   * chuỗi hiển thị bên trong vẫn tiếng Trung). Hoá ra văn xuôi cũng dính đúng bệnh ấy — chỉ khác
   * cái vỏ: "boss骇爪" đủ Latin để bị gọi là tiếng Anh, "Tân Thuận 骇爪" đủ dấu tiếng Việt để bị
   * gọi là đã dịch xong. Cả hai đều bị bỏ qua với bản "dịch" chính là bản gốc.
   *
   * Nên nâng nó thành luật chung, đặt TRƯỚC mọi luật bỏ qua: còn ký tự thuộc hệ chữ nguồn mà
   * ngôn ngữ đích không dùng ⇒ vẫn còn việc để làm ⇒ phải đưa cho AI.
   *
   * NGOẠI LỆ có chủ ý — text được nhận là một ngôn ngữ CJK KHÁC (Nhật/Hàn/Trung): kanji trong
   * một entry tiếng Nhật là chữ của chính tiếng Nhật, không phải "chữ Trung còn sót". Bỏ ngoại lệ
   * này là phá hợp đồng FROM/TO của yêu cầu #140 (card Trung có entry tiếng Nhật thì để yên). */
  const detectedIsCjkLanguage = detected === '中文' || detected === '日本語' || detected === '한국어';
  if (!detectedIsCjkLanguage && hasSourceScriptLeft(text, normalizedTarget)) return false;

  // (bugNeedFix/108) CODE có vỏ ngoài đánh lừa bộ đoán ngôn ngữ: từ khoá JS là Latin, comment
  // có thể đã là tiếng Việt — nên cả hai luật bỏ qua bên dưới đều dễ kết luận "xong rồi",
  // trong khi CHUỖI HIỂN THỊ và tên worldbook bên trong vẫn là tiếng Trung. Với code, chỉ được
  // bỏ qua khi ruột đã SẠCH ký tự nguồn. (Giữ nguyên: code tiếng Nhật vẫn phải dịch chuỗi.)
  if (looksLikeCodeField(text) && hasSourceScriptLeft(text, normalizedTarget)) return false;

  // Skip if text is definitively already in the target language
  if (detected === normalizedTarget) return true;

  // Skip if text is definitively in a THIRD language (≠ declared source, ≠ target).
  // Only when the source is a specific known language — 'auto' means "translate whatever".
  const normalizedSource = LANG_LABEL_MAP[sourceLanguage];
  if (normalizedSource && normalizedSource !== normalizedTarget && detected !== normalizedSource) {
    // Lưu ý: luật này CHỈ dành cho VĂN XUÔI thuần ngôn ngữ khác (yêu cầu #140 — card Trung có
    // entry tiếng Anh/Nhật thì tôn trọng hợp đồng FROM/TO, không dịch). Field CODE đã được
    // chốt riêng ở đầu hàm (bug 108) nên không rơi xuống đây khi ruột còn chữ nguồn.
    return true;
  }

  return false;
}

/**
 * Text có phải FIELD CODE không (EJS / JS / regex script). Nhận diện rộng tay: chỉ cần vài dấu
 * hiệu là đủ, vì hậu quả của việc bỏ sót code lớn hơn nhiều so với việc dịch thừa một entry.
 */
function looksLikeCodeField(text: string): boolean {
  if (typeof text !== 'string') return false;
  if (/<%[\s\S]*?%>/.test(text)) return true;                       // khối EJS
  if (/\b(?:getvar|setvar|getwi|activateEntry|setEntryEnabled)\s*\(/.test(text)) return true; // API TavernHelper
  return /\b(?:function|const|let|var)\b[\s\S]*[;{]/.test(text);     // JS thường
}

/**
 * Còn ký tự thuộc hệ chữ NGUỒN (Hán / kana / hangul / Cyrillic) mà đích không dùng hệ chữ đó?
 * Dùng làm chốt an toàn cho mọi luật "bỏ qua": còn thứ để dịch thì không được bỏ qua.
 */
function hasSourceScriptLeft(text: string, normalizedTarget: string): boolean {
  // KHÔNG dùng cleanText ở đây: nó xoá `<…>` (để đoán ngôn ngữ văn xuôi cho chuẩn), mà khối
  // EJS `<%_ … _%>` cũng khớp luật đó ⇒ chữ Hán nằm TRONG code bị xoá sạch trước khi đếm,
  // thành ra "không còn gì để dịch" — đúng cái bẫy làm entry EJS bị bỏ qua (bug 108).
  // Cùng cái bẫy ấy nuốt luôn tiêu đề dạng "<道具>" của bug 234.
  // Ở đây chỉ cần biết "còn ký tự hệ chữ nguồn hay không", nên đếm trên text THÔ (bỏ URL).
  //
  // (bug 234) Dùng CHUNG `stripUrlsForCjkCheck` với bộ quét chữ Hán sót thay vì tự viết một
  // phép bỏ URL yếu hơn. Bản cũ chỉ bỏ `https?://…` nên chữ Hán trong `src="…"`, `url(…)`,
  // `import('./骰子/x.js')` vẫn bị tính là "còn chưa dịch" ⇒ hai bên đo bằng hai thước khác nhau,
  // và field cứ bị lôi đi dịch lại mãi vì cái không bao giờ dịch được.
  const t = stripUrlsForCjkCheck(text || '');
  const cjk = (t.match(CJK_G) || []).length;
  const kana = (t.match(KANA_G) || []).length;
  const hangul = (t.match(HANGUL_G) || []).length;
  const cyrillic = (t.match(/[Ѐ-ӿ]/g) || []).length;
  if (cjk > 0 && normalizedTarget !== '中文' && normalizedTarget !== '日本語') return true;
  if (kana > 0 && normalizedTarget !== '日本語') return true;
  if (hangul > 0 && normalizedTarget !== '한국어') return true;
  if (cyrillic > 0 && normalizedTarget !== 'Русский') return true;
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
