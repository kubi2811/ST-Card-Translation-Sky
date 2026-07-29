// ── Imports ───────────────────────────────────────────────────────────────────
import { extractTranslationFromResponse } from './masterPrompt';
import { fandomNameOverride } from './fandomMode';
import type { ProxySettings, GlossaryEntry } from '../types/card';
import { writeDebugLog } from './debugLogger';
import { extractScriptBodies, jsParseError } from './scriptSafety';

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
  isDotNotation?: boolean;
  isObjectKey?: boolean;
  isCssClass?: boolean;
  isHtmlAttr?: boolean;
  /** (bug 151) Khoá dữ liệu/định danh được ĐỔI TÊN theo từ điển user đã chốt — không hỏi AI.
   *  Chỉ bật khi chính user đưa tên đó vào từ điển, nên đây là quyết định của user chứ không
   *  phải tool tự ý; reinsert vẫn bọc bracket/nháy nên cú pháp luôn hợp lệ. */
  fromDictionary?: boolean;
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
 * Identifies URL/link positions in the text.  CJK tokens that overlap
 * these zones are excluded from extraction, preventing URLs like
 * `https://cdn.com/骰子系统/stable.js` from having their CJK path
 * segments translated (which would break the link).
 *
 * Covers:
 * - Standard URLs (http://, https://, ftp://, protocol-relative //)
 * - HTML attributes containing URLs (src, href, action, data-src, poster, srcset)
 * - CSS url() references
 * - JavaScript import() / require() string arguments
 * - Data URIs (data:...)
 * - File paths starting with ./ or ../
 * - Markdown image/link syntax ![...](url) and [...](url)
 */
function extractURLZones(text: string): ProtectedZone[] {
  const zones: ProtectedZone[] = [];

  // ── 1. Standard URLs: http://, https://, ftp://, // ────────────────────
  const urlRe = /(?:https?|ftp):\/\/[^\s'"<>(){}\]]+|\/\/[a-zA-Z0-9][^\s'"<>(){}\]]*/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    zones.push({ start: m.index, end: m.index + m[0].length, reason: 'url' });
  }

  // ── 2. HTML src/href/action/poster/srcset/data-src attributes ──────────
  const attrRe = /(?:src|href|action|data-src|data-href|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = attrRe.exec(text)) !== null) {
    const val = m[1] ?? m[2];
    if (val) {
      const vStart = m.index + m[0].indexOf(val);
      zones.push({ start: vStart, end: vStart + val.length, reason: 'html-url-attr' });
    }
  }

  // ── 3. CSS url() references ────────────────────────────────────────────
  const cssUrlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  while ((m = cssUrlRe.exec(text)) !== null) {
    const val = m[1] ?? m[2] ?? m[3];
    if (val && val.trim()) {
      const vStart = m.index + m[0].indexOf(val);
      zones.push({ start: vStart, end: vStart + val.length, reason: 'css-url' });
    }
  }

  // ── 4. JS import() / require() string arguments ────────────────────────
  const importRe = /(?:import|require)\s*\(\s*(?:[`'"]([^`'"]*)[`'"]|`([^`]*)`)\s*\)/gi;
  while ((m = importRe.exec(text)) !== null) {
    const val = m[1] ?? m[2];
    if (val) {
      const vStart = m.index + m[0].indexOf(val);
      zones.push({ start: vStart, end: vStart + val.length, reason: 'import-path' });
    }
  }

  // ── 5. Template literal import: import(`...`) ──────────────────────────
  const importTemplateRe = /(?:import|require)\s*\(\s*`([^`]*)`\s*\)/gi;
  while ((m = importTemplateRe.exec(text)) !== null) {
    const val = m[1];
    if (val) {
      const vStart = m.index + m[0].indexOf(val);
      zones.push({ start: vStart, end: vStart + val.length, reason: 'import-template' });
    }
  }

  // ── 6. Data URIs (data:image/...) ──────────────────────────────────────
  const dataUriRe = /data:[a-zA-Z0-9+/.-]+;[^\s'"<>)]+/gi;
  while ((m = dataUriRe.exec(text)) !== null) {
    zones.push({ start: m.index, end: m.index + m[0].length, reason: 'data-uri' });
  }

  // ── 7. Relative file paths: ./... or ../... ────────────────────────────
  const filePathRe = /(?:\.\.?\/)[^\s'"<>(){}\]]+/g;
  while ((m = filePathRe.exec(text)) !== null) {
    zones.push({ start: m.index, end: m.index + m[0].length, reason: 'file-path' });
  }

  // ── 8. Markdown links: [...](url) and ![...](url) ──────────────────────
  const mdLinkRe = /!?\[[^\]]*\]\(([^)]+)\)/g;
  while ((m = mdLinkRe.exec(text)) !== null) {
    const url = m[1];
    if (url) {
      const urlStart = m.index + m[0].indexOf(url);
      zones.push({ start: urlStart, end: urlStart + url.length, reason: 'markdown-link' });
    }
  }

  // ── 9. Email addresses ─────────────────────────────────────────────────
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  while ((m = emailRe.exec(text)) !== null) {
    zones.push({ start: m.index, end: m.index + m[0].length, reason: 'email' });
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
 * Extracts segments of CJK text as contiguous runs, using CJK punctuation
 * (，。、！？：；…（）「」『』【】〈〉《》) as JOINERS between CJK text runs
 * so that full sentences are captured as single tokens instead of being
 * split at every punctuation mark.
 *
 * CJK PUNCTUATION as JOINERS (connect CJK text on both sides):
 * - \u3001-\u3002  、。
 * - \u3008-\u3011  〈〉《》「」『』【】
 * - \u3014-\u301b  〔〕〖〗〘〙〚〛
 * - \uff01,\uff08-\uff09,\uff0c,\uff0e,\uff1a,\uff1b,\uff1f,\uff5e  ！（），．：；？～
 * - \u2013-\u2014 –—  \u2018-\u201d ''"" \u2026 …
 *
 * INCLUDED unicode ranges (primary CJK text characters):
 * - \u4e00-\u9fff  CJK Unified Ideographs
 * - \u3400-\u4dbf  CJK Extension A
 * - \u3040-\u30ff  Hiragana + Katakana
 * - \uac00-\ud7af  Hangul Syllables
 * - \uff65-\uffdc  Halfwidth Katakana + Fullwidth Latin/Hangul
 *
 * NOTE: A-Za-z is deliberately excluded from joiners so that English words
 * such as CSS properties are never captured as part of a CJK token.
 */
/**
 * (bugNeedFix/34) Quét `lineBefore` (từ đầu dòng tới vị trí token) xác định điểm cuối có ĐANG NẰM
 * TRONG CHUỖI ' hoặc " hay không — theo ĐÚNG ngữ nghĩa JS: dấu " nằm trong chuỗi '…' KHÔNG mở chuỗi
 * mới, và ngược lại; có xử lý \escape. Backtick (`) cố tình BỎ QUA (giữ hành vi cũ: token CJK trong
 * ${obj.<CJK>} của template literal vẫn được coi là code để wrap bracket).
 */
export function isInsideStringAtEnd(lineBefore: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < lineBefore.length; i++) {
    const c = lineBefore[i];
    if (quote) {
      if (c === '\\') { i++; continue; }      // bỏ qua ký tự escape kế tiếp
      if (c === quote) quote = null;           // đóng chuỗi
      // dấu nháy loại KHÁC bên trong chuỗi → chỉ là ký tự thường, KHÔNG đổi trạng thái
    } else {
      if (c === "'" || c === '"') quote = c;   // mở chuỗi
    }
  }
  return quote !== null;
}

/**
 * (bugNeedFix/128) THU THẬP ĐỊNH DANH JS TRẦN — thứ mà dịch là CHẮC CHẮN vỡ script.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bằng chứng user: `const 配置 = {` dịch thành `const Cấu hình = {` → SyntaxError (2:12);
 * schema Zod vỡ ở 85:11 cùng kiểu. Chữ Hán là ĐỊNH DANH JS HỢP LỆ, nhưng bản dịch tiếng Việt
 * có dấu cách/dấu thanh thì không — và khác với object-key (bọc nháy được) hay dot-notation
 * (đổi bracket được), định danh trần KHÔNG có cách nào cứu sau dịch: `const Cấu hình` là vỡ,
 * chấm hết. Các fix trước (34/49/109) chỉ vá object-key/dot-notation/chuỗi nên lỗ này còn nguyên,
 * và vì surgical gần như tất định nên user gặp ĐI GẶP LẠI trên mọi card có script kiểu này.
 *
 * Cách xử duy nhất đúng: NHẬN DIỆN các tên này rồi ĐỪNG DỊCH — giữ nguyên chữ Hán. Script vẫn
 * chạy y nguyên (tên nội bộ, người chơi không nhìn thấy), và mọi tham chiếu tự khớp nhau.
 *
 * Nguồn thu thập (ưu tiên chính xác cao — thà sót một tên còn hơn giết oan cả câu văn):
 *   1. Khai báo:            const/let/var/function/class 配置
 *   2. Destructuring:       const { 配置, 状态 } = x
 *   3. Tham số hàm:         function f(配置) / (配置, 状态) =>
 *   4. Gốc truy cập thuộc tính: 配置.xxx / 配置?.xxx — dấu CHẤM ASCII dính liền chữ là code,
 *      văn xuôi Trung dùng 。fullwidth nên không đụng.
 * Mọi lần xuất hiện của đúng những tên này (ngoài string literal) đều được giữ nguyên.
 */
export function collectProtectedJsIdentifiers(text: string): Set<string> {
  const out = new Set<string>();
  const src = String(text || '');
  // Định danh CÓ ÍT NHẤT MỘT chữ Hán, cho phép dính chữ Latin/số/gạch dưới hai bên (AP上限, 魔力值2)
  // — chỉ những tên chứa CJK mới cần bảo vệ, tên thuần Latin không bao giờ bị extractor đụng tới.
  const W = '[\\w$\\u4e00-\\u9fff\\u3400-\\u4dbf]';
  const ID = `${W}*[\\u4e00-\\u9fff\\u3400-\\u4dbf]${W}*`;

  // 1. Khai báo trực tiếp.
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var|function|class)\\s+(${ID})`, 'g'))) {
    out.add(m[1]);
  }
  // 2. Destructuring `const { a, b: c } = …` — lấy tên BÊN TRÁI dấu hai chấm (tên nguồn)
  //    lẫn tên đơn; tên nguồn phải khớp key gốc nên càng không được dịch.
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]{1,300})\}/g)) {
    for (const part of m[1].split(',')) {
      const id = part.match(new RegExp(`^\\s*(${ID})`));
      if (id) out.add(id[1]);
    }
  }
  // 3. Tham số hàm: function f(...) và (...) =>
  const paramLists: string[] = [];
  for (const m of src.matchAll(new RegExp(`\\bfunction\\s*(?:${ID}|[\\w$]*)\\s*\\(([^)]{0,300})\\)`, 'g'))) {
    paramLists.push(m[1]);
  }
  for (const m of src.matchAll(/\(([^()]{0,300})\)\s*=>/g)) {
    paramLists.push(m[1]);
  }
  for (const list of paramLists) {
    for (const part of list.split(',')) {
      const id = part.match(new RegExp(`^\\s*(${ID})\\s*(?:=[^,]*)?$`));
      if (id) out.add(id[1]);
    }
  }
  // 4. Gốc truy cập thuộc tính: `配置.xxx` / `配置?.xxx` / `配置(` — KHÔNG lấy khi chính nó
  //    đứng sau dấu chấm (khi đó nó là property, đã có đường dot-notation lo).
  for (const m of src.matchAll(new RegExp(`(^|[^.\\w$\\u4e00-\\u9fff\\u3400-\\u4dbf])(${ID})\\s*(?:\\?\\.|\\.(?=[\\w$\\u4e00-\\u9fff\\u3400-\\u4dbf]))`, 'gm'))) {
    out.add(m[2]);
  }
  return out;
}

export function extractCJKTokens(
  text: string,
  protectedZones?: ProtectedZone[],
  cssCjkHandling: 'preserve' | 'translate' = 'preserve',
  mvuDictionary?: Record<string, string>
): CJKToken[] {
  const tokens: CJKToken[] = [];
  // (bugNeedFix/128) Định danh JS trần — gặp token TRÙNG KHỚP tên này ngoài chuỗi là bỏ qua,
  // không đưa đi dịch. Văn xuôi thuần không có const/let/`.` nên tập này rỗng, không tốn gì.
  const protectedIds = collectProtectedJsIdentifiers(text);
  // CJK ideograph ranges (primary text characters)
  const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3040-\\u30ff\\uac00-\\ud7af\\uff65-\\uffdc';
  // CJK punctuation joiners: ，。、！？：；…—–\u2018\u2019\u201c\u201d～．（）「」『』【】〈〉《》〔〕〖〗〘〙〚〛
  const CPUNCT = '\\u2013\\u2014\\u2018-\\u201d\\u2026\\u3001\\u3002\\u3008-\\u3011\\u3014-\\u301b\\uff01\\uff08\\uff09\\uff0c\\uff0e\\uff1a\\uff1b\\uff1f\\uff5e';
  const regex = new RegExp(
    `[${CJK}]+(?:[${CPUNCT} \\t0-9.\\-_%]+[${CJK}]+)*`,
    'g'
  );

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

    // Skip CJK used as CSS variables (e.g., var(--中文) or --中文: ...)
    const isCssVar = /--$/.test(contextBefore);
    if (isCssVar) continue;

    // ═══ Guard "ĐANG Ở TRONG CHUỖI STRING" ═══
    // Vụ vỡ card thật: token CJK nằm TRONG chuỗi ('人，统领:' / '1. 回答…') bị coi là object-key /
    // dot-notation → reinsert chèn thêm nháy hoặc ['…'] vào GIỮA chuỗi → SyntaxError, script sập.
    // Trong chuỗi string thì mọi kiểu wrap đều sai — chỉ được thay chữ thuần tuý.
    //
    // (User 2026 — bugNeedFix/34: Translated Preview TRẮNG MÀN) BUG CŨ: đếm ' và " ĐỘC LẬP
    // (_sq % 2 / _dq % 2). Chuỗi '<span class="tag ' có 1 dấu " (là KÝ TỰ trong chuỗi nháy đơn,
    // KHÔNG phải mở chuỗi) → _dq lẻ → tưởng đang trong chuỗi nháy kép → tắt dot-notation cho
    // cv.已测能量 ngay sau đó → không đổi sang cv['…'] → "cv.Đã Đo Năng Lượng" (có dấu cách) =
    // SyntaxError → <script> sập → iframe preview trắng, mất cả UI. FIX: quét ĐÚNG trạng thái nháy —
    // dấu " nằm trong chuỗi '…' KHÔNG tính là mở chuỗi (và ngược lại), có xử lý \escape.
    const _lineStart = text.lastIndexOf('\n', mStart - 1) + 1;
    const _lineBefore = text.slice(_lineStart, mStart);
    const insideStringLiteral = isInsideStringAtEnd(_lineBefore);

    // ═══ (bugNeedFix/128) ĐỊNH DANH JS TRẦN → KHÔNG DỊCH ═══
    // `const 配置` dịch ra `const Cấu hình` là SyntaxError không thuốc chữa — không như object-key
    // (bọc nháy) hay dot-notation (đổi bracket). Token trùng tên đã thu thập (kể cả khi chữ Hán
    // dính liền chữ Latin thành một từ như AP上限) và KHÔNG nằm trong chuỗi → giữ nguyên chữ Hán.
    // Trong chuỗi thì vẫn dịch bình thường ('stat_data.配置' đi theo chuẩn SPACE của từ điển MVU).
    // (bug 151) Bóc đuôi ASCII của định danh ra trước — dùng chung cho cả lớp bảo vệ bên dưới
    // lẫn bộ dò dot-notation, để `n._预产天数` và `n.状态` được soi bằng cùng một thước.
    const _idPrefix = /[\w$]*$/.exec(contextBefore)?.[0] ?? '';
    const _beforeId = _idPrefix ? contextBefore.slice(0, contextBefore.length - _idPrefix.length) : contextBefore;
    /** Đang ở thế THUỘC TÍNH (sau dấu chấm) — reinsert bọc bracket được nên đổi tên vẫn hợp lệ. */
    const _inPropPos = /[\w$\])}'"一-鿿㐀-䶿]\??\.$/.test(_beforeId) && !/[0-9]\??\.$/.test(_beforeId);

    // ═══ (bug 151) ĐƯỜNG DẪN DỮ LIỆU NẰM TRONG CHUỖI: '军事.各营' ═══
    // `_.get(t,'军事.各营')` là chuỗi nên không đi qua nhánh bảo vệ nào, bị coi là văn xuôi và
    // AI dịch NGUYÊN CỤM → 'Quân sự.Các doanh' (bằng chứng user, 5 chỗ). Cụm này vẫn parse
    // được nên không có lỗi nào báo, nhưng nó phải khớp TỪNG ĐOẠN với khoá mà code truy cập —
    // dịch tự do là trượt. Xử: tách theo dấu chấm, mỗi đoạn CHỈ đổi theo từ điển (đúng nguồn
    // mà code accessor cũng dùng), đoạn ngoài từ điển giữ nguyên. Dấu chấm không bao giờ bị
    // đụng nên cấu trúc đường dẫn luôn còn.
    // (bug 154) Áp cho CẢ TRONG CHUỖI LẪN TRONG CODE, không chỉ trong chuỗi như bản 151.
    // User báo: "đã có từ điển cho 世界运转 và cho 天气, nhưng 世界运转.天气 vẫn bị bỏ qua".
    // Đúng vậy: bộ gom token nuốt cả cụm `世界运转.天气` thành MỘT token (dấu `.` nằm trong bộ
    // nối), rồi tra từ điển nguyên cụm — không mục nào khớp nên giữ nguyên. Nhánh tách cũ chỉ
    // chạy khi base nằm trong protectedIds, mà `i.世界运转._开场标识` thì base đứng sau dấu chấm
    // nên không được bảo vệ ⇒ không tách ⇒ chỗ GHI đổi tên mà chỗ ĐỌC thì không: hỏng âm thầm.
    if (match[0].includes('.')) {
      const seg = match[0].split('.');
      // Đoạn được phép mang tiền tố/hậu tố ASCII (`_开场标识`) nhưng phải CÓ chữ Hán và KHÔNG có
      // khoảng trắng — đủ hẹp để văn xuôi kiểu "3.5 mét" hay "1. Mục lục" không lọt vào.
      const segRe = /^[\w$]*[一-鿿㐀-䶿぀-ヿ가-힯][\w$一-鿿㐀-䶿぀-ヿ가-힯]*$/;
      const looksLikePath =
        seg.length >= 2 && seg.length <= 5 &&
        seg.every((p) => p.length >= 1 && p.length <= 14 && segRe.test(p) && !/^[0-9]/.test(p));
      if (looksLikePath) {
        let pos = mStart;
        for (let si = 0; si < seg.length; si++) {
          const p = seg[si];
          // Tra từ điển theo phần Hán THUẦN (bỏ tiền tố ASCII) — từ điển user nhập tên biến Hán,
          // không ai nhập kèm gạch dưới. Tiền tố được reinsert ghép lại vào trong nháy/bracket.
          const core = p.replace(/^[\w$]+/, '');
          const hit = mvuDictionary?.[core] ?? mvuDictionary?.[p];
          const coreStart = pos + (p.length - core.length);
          // Đoạn 0 chỉ là thuộc tính khi chính nó đứng sau dấu chấm; các đoạn sau thì luôn là.
          const asProp = si > 0 || _inPropPos;
          // ĐOẠN 0 PHẢI TÔN TRỌNG LỚP BẢO VỆ ĐỊNH DANH. `配置.调试` với `const 配置` khai ở trên
          // thì `配置` là BIẾN THẬT, không phải khoá — đổi tên nó là SyntaxError không cứu nổi
          // (không có cách bọc nháy/bracket nào cho một khai báo trần). Chỉ tha khi user đã đưa
          // vào từ điển VÀ nó đang ở thế thuộc tính (lúc đó bọc bracket được).
          if (si === 0 && !insideStringLiteral && protectedIds.has(p) && !(hit && _inPropPos)) {
            pos += p.length + 1;
            continue;
          }
          // Trong chuỗi thì KHÔNG bọc bracket (bọc là chèn nháy vào giữa chuỗi ⇒ vỡ).
          const dot = asProp && !insideStringLiteral;
          tokens.push({
            id: id++, text: core, start: coreStart, end: coreStart + core.length,
            // isIdentifier ⇒ AI không đụng tới; chỉ từ điển đổi được, nhờ đó chuỗi đường dẫn và
            // code accessor luôn đổi cùng nhau hoặc cùng đứng yên.
            isIdentifier: true, isDotNotation: dot, isObjectKey: false,
            isCssClass: false, isHtmlAttr: false,
            ...(hit ? { translated: hit, fromDictionary: true } : {}),
          });
          pos += p.length + 1;
        }
        continue;
      }
    }

    if (!insideStringLiteral && protectedIds.size > 0) {
      let wStart = mStart, wEnd = mEnd;
      while (wStart > 0 && /[\w$]/.test(text[wStart - 1])) wStart--;
      while (wEnd < text.length && /[\w$]/.test(text[wEnd])) wEnd++;
      // (bug 151) TỪ ĐIỂN USER THẮNG LỚP BẢO VỆ — nhưng CHỈ ở thế thuộc tính.
      // Lý do phải phân biệt: cùng một cái tên có thể vừa là khai báo trần (`const 配置` —
      // đổi là SyntaxError, không có cách bọc nào cứu được) vừa là thuộc tính (`t.配置` —
      // bọc `t['…']` là xong). Nếu bỏ qua cả hai thì tên trong chuỗi `_.get(t,'配置.x')` vẫn
      // bị đổi trong khi code đọc thì không → đọc trúng ô rỗng, hỏng âm thầm.
      const _dictHit = mvuDictionary?.[match[0].trim()];
      if ((protectedIds.has(match[0]) || protectedIds.has(text.slice(wStart, wEnd))) && !(_dictHit && _inPropPos)) continue;

      // ═══ CỤM TRUY CẬP THUỘC TÍNH VỚI BASE CHỮ HÁN: 配置.调试验证 ═══
      // Dấu `.` ASCII nằm trong bộ JOINER (để câu văn "3.5米" không bị băm), nên cả cụm
      // `配置.调试验证` bị bắt thành MỘT token và — vì không khớp mẫu dot-notation (mẫu đó chỉ
      // nhìn ký tự TRƯỚC token) — bị coi là văn xuôi, dịch nguyên cụm thành "Bản dịch có dấu
      // cách" ⇒ `if (!Bản dịch…)` vỡ. Base Latin (wd.时势) thoát nạn vì run bắt đầu SAU dấu
      // chấm; base chữ Hán thì xưa nay luôn vỡ — đúng dòng ~85 trong bằng chứng user.
      // Xử: tách cụm theo dấu chấm — base giữ nguyên, MỖI thuộc tính thành token dot-notation
      // riêng để reinsert đổi sang bracket: 配置['Bản dịch'] — hợp lệ và khớp key đã dịch.
      const dotIdx = match[0].indexOf('.');
      if (dotIdx > 0) {
        const base = match[0].slice(0, dotIdx);
        if (protectedIds.has(base)) {
          const parts = match[0].split('.');
          let pos = mStart;
          for (let pi = 0; pi < parts.length; pi++) {
            const part = parts[pi];
            const dictPart = mvuDictionary?.[part];
            // (bug 151) BASE CŨNG PHẢI ĐỔI THEO TỪ ĐIỂN. Trước đây base luôn bị bỏ qua vì nằm
            // trong protectedIds, nên `t.人际网络` lẻ thì đổi mà `t.人际网络.下属与幕僚` thì không
            // → code tạo object ở `t['Tên Mới']` rồi ghi dữ liệu vào `t.人际网络` — hai ô khác
            // nhau, chạy không lỗi, dữ liệu mất hút. Đổi nửa vời tệ hơn không đổi.
            // pi>0 luôn là thuộc tính; pi===0 chỉ tính khi chính base cũng đứng sau dấu chấm.
            const propPos = pi > 0 || _inPropPos;
            const isCjkPart = /[一-鿿㐀-䶿぀-ヿ가-힯]/.test(part);
            if (isCjkPart && ((pi > 0 && !protectedIds.has(part)) || (dictPart && propPos))) {
              tokens.push({
                id: id++, text: part, start: pos, end: pos + part.length,
                isIdentifier: true, isDotNotation: true,
                isObjectKey: false, isCssClass: false, isHtmlAttr: false,
                ...(dictPart ? { translated: dictPart, fromDictionary: true } : {}),
              });
            }
            pos += part.length + 1;   // +1 cho dấu chấm phân cách
          }
          continue;
        }
      }
    }

    // 1. JS Object Key
    // Must be preceded by {, ,, or newline/spaces, optionally followed by a quote.
    // (object-key thật dạng {'中文': …} có nháy bao sẵn → alreadyQuoted ở reinsert lo, không cần wrap)
    //
    // (bug 154) Soi trên _beforeId — tức là ĐÃ BÓC đuôi ASCII của định danh. Bug 151 vá đúng ca
    // này ở đường dot-notation (`n._预产天数`) nhưng bỏ quên đường object-key, dù nó có y hệt
    // điểm mù: với `{_开场标识: …}` thì ký tự ngay trước cụm Hán là `_` chứ không phải `{`, nên
    // mẫu dưới đây trượt → coi là văn xuôi → dịch ra cụm CÓ DẤU CÁCH mà KHÔNG bọc nháy →
    // SyntaxError. Trong khi `当前日期` sát ngay `{` thì thoát. Chênh nhau đúng một ký tự `_`.
    const isObjectKey = !insideStringLiteral &&
                        /(?:[{,]\s*|\n\s*|^['"\s]*)['"]?$/.test(_beforeId) &&
                        /^['"]?\s*:/.test(contextAfter) &&
                        !/^['"]?\s*:\/\//.test(contextAfter);

    // 2. JS Dot Notation vs CSS Class
    // JS dot notation usually follows a variable name (alphanumeric, _, $, or closing bracket/quote, optionally with ?. for optional chaining)
    // Also includes CJK ranges (\u4e00-\u9fff, \u3400-\u4dbf) because in source Chinese code, CJK identifiers appear before ?.
    // e.g. wd.时势?.标题 — the char before ?. is 势 (CJK), which must be matched
    // (bug 151) TI\u1ec0N T\u1ed0 ASCII GI\u1eeeA D\u1ea4U CH\u1ea4M V\u00c0 CH\u1eee H\u00c1N: `n._\u9884\u4ea7\u5929\u6570`.
    // M\u1eabu d\u01b0\u1edbi \u0111\u00e2y soi k\u00fd t\u1ef1 NGAY TR\u01af\u1edaC c\u1ee5m H\u00e1n, n\u00ean `n.\u72b6\u6001` kh\u1edbp c\u00f2n `n._\u9884\u4ea7\u5929\u6570` th\u00ec
    // kh\u00f4ng (\u0111\u1ee9ng tr\u01b0\u1edbc \u9884 l\u00e0 `_`, kh\u00f4ng ph\u1ea3i `.`) \u2192 b\u1ecb coi l\u00e0 v\u0103n xu\u00f4i \u2192 d\u1ecbch ra c\u1ee5m C\u00d3 D\u1ea4U
    // C\u00c1CH \u2192 `n._S\u1ed1 ng\u00e0y d\u1ef1 sinh` = SyntaxError, c\u1ea3 script ch\u1ebft (b\u1eb1ng ch\u1ee9ng bug/151, c\u1ed9t 3641).
    // X\u1eed: soi tr\u00ean _beforeId (\u0111\u00e3 b\u00f3c \u0111u\u00f4i ASCII \u1edf tr\u00ean). Ti\u1ec1n t\u1ed1 r\u1ed7ng th\u00ec _beforeId ===
    // contextBefore n\u00ean \u0111\u01b0\u1eddng c\u0169 gi\u1eef nguy\u00ean h\u00e0nh vi, kh\u00f4ng h\u1ed3i quy.
    let isJsDotNotation = /[a-zA-Z0-9_$\])}'"\u4e00-\u9fff\u3400-\u4dbf]\s*\??\s*\.\s*$/.test(_beforeId);

    // Exclude dot notation detection inside comments (HTML/CSS/JS)
    // e.g. <!-- 1. 身份档案 --> or /* 1. 世界时局 */ — the "1." is NOT real dot notation
    if (isJsDotNotation && /(?:\/\*|<!--)[^]*$/.test(contextBefore) && !/(?:\*\/|-->)[^]*$/.test(contextBefore)) {
      isJsDotNotation = false;
    }

    // ═══ CHẶN "VĂN XUÔI ĐÁNH SỐ" & "TRONG CHUỖI STRING" bị nhầm thành dot-notation/CSS class ═══
    // Vụ vỡ card thật: sysPrompt+='1. <CJK>…' → "1." bị coi là dot-notation → reinsert bọc ['bản dịch']
    // chèn dấu ' vào GIỮA chuỗi đang mở → SyntaxError, cả <script> sập, nút bấm liệt hết.
    // 3 dấu hiệu prose (dot-notation THẬT không bao giờ có):
    //   (a) CHỮ SỐ đứng ngay trước dấu chấm ("1." "2.") — JS không viết 1.prop (arr[0].prop có ']' trước chấm)
    //   (b) CÓ KHOẢNG TRẮNG giữa dấu chấm và chữ ("1. <CJK>") — obj.prop luôn viết liền
    //   (c) đang Ở TRONG string literal (đếm nháy '/" chưa đóng từ đầu dòng) — bọc ['…'] trong chuỗi luôn vỡ
    let isProseContext = insideStringLiteral;   // (c) — trong chuỗi thì bracket-wrap luôn vỡ
    if (isJsDotNotation && !isProseContext) {
      // Soi trên _beforeId (đã bóc tiền tố ASCII) để khớp với bộ dò ở trên — nếu vẫn soi
      // contextBefore thì `n._预产天数` không match, dm = null, và lưới prose mất tác dụng.
      const dm = _beforeId.match(/([a-zA-Z0-9_$\])}'"一-鿿㐀-䶿])\s*\??\s*\.(\s*)$/);
      if (dm && (/[0-9]/.test(dm[1]) || dm[2].length > 0)) isProseContext = true;   // (a) + (b)
    }
    if (isProseContext) isJsDotNotation = false;

    // CSS class usually follows whitespace, quotes, tag names, or structural combinators
    // (prose "1. …" cũng khớp mẫu CSS class → chặn luôn, kẻo bản dịch bị thay space thành dấu chấm)
    const isCssClass = !isProseContext && !isJsDotNotation && /(?:^|['"\s,>+~{(])[a-zA-Z0-9-]*\.\s*$/.test(contextBefore);

    // 3. HTML Attributes
    const isHtmlAttr = /(?:class|id|name|for|data-[a-zA-Z0-9_-]+)\s*=\s*(?:"[^"]*|'[^']*)$/.test(contextBefore);

    const isIdentifier = isObjectKey || isJsDotNotation || isCssClass || isHtmlAttr;

    // (bug 151) KHOÁ DỮ LIỆU CÓ TRONG TỪ ĐIỂN → ĐỔI TÊN NGAY, KHÔNG QUA AI.
    // Trước đây giá trị này được tính ra rồi vứt đi, nên khoá MVU (`t.人际网络`, `{身份:…}`)
    // luôn nằm ngoài mọi đường dịch — bật hay tắt Từ Điển đều y hệt nhau, đúng như user thấy.
    // Hệ quả nặng: card đã đổi biến sang tiếng Việt thì script đọc khoá Hán ra `undefined` —
    // chạy trơn tru mà dữ liệu rỗng, không lỗi nào báo. Đổi theo từ điển là quyết định của
    // user (họ tự nhập vào đó); tên không có trong từ điển vẫn giữ nguyên như cũ.
    const isMvuVariable = mvuDictionary?.[match[0].trim()];

    tokens.push({
      id: id++,
      text: match[0],
      start: mStart,
      end: mEnd,
      isIdentifier,
      isDotNotation: isJsDotNotation,
      isObjectKey,
      isCssClass,
      isHtmlAttr,
      ...(isMvuVariable ? { translated: isMvuVariable, fromDictionary: true } : {}),
    });
  }
  return tokens;
}

/* ═══ LƯỚI AN TOÀN CÚ PHÁP <script> SAU KHI GHÉP ═══
 * Dù detector đã chặn prose (xem isProseContext), vẫn có thể lọt mẫu hỏng khác. Nguyên tắc:
 * script GỐC parse OK mà bản GHÉP vỡ → chắc chắn hỏng do quá trình dịch → sửa TỰ ĐỘNG bằng acorn:
 * parse lấy VỊ TRÍ lỗi chính xác → revert đúng cái bracket-wrap prose (['câu văn']) gần vị trí lỗi
 * nhất → parse lại; lặp tới khi sạch lỗi (tối đa 25 vòng). Chỉ giữ bản vá khi parse OK hoàn toàn.
 * Parse KHÔNG thực thi code nên an toàn. Bracket-wrap MVU hợp lệ (stat_data['Bản Tôn']) không gây
 * lỗi parse nên không bao giờ bị đụng. Script gốc vốn vỡ sẵn thì bỏ qua (không phải lỗi dịch).
 * (extractScriptBodies + jsParseError nay dùng chung từ scriptSafety.ts.) */
export function repairScriptSyntaxCorruption(original: string, translated: string): { text: string; repaired: number } {
  const origScripts = extractScriptBodies(original);
  const transScripts = extractScriptBodies(translated);
  if (origScripts.length === 0 || origScripts.length !== transScripts.length) return { text: translated, repaired: 0 };
  let result = translated;
  let repaired = 0;
  for (let i = 0; i < transScripts.length; i++) {
    if (jsParseError(origScripts[i])) continue;   // gốc đã vỡ sẵn → không phải do dịch
    let body = transScripts[i];
    let err = jsParseError(body);
    if (!err) continue;                            // bản dịch lành
    let iter = 0;
    let reverts = 0;
    while (err && err.pos >= 0 && iter++ < 40) {
      // Ứng viên quanh vị trí lỗi ±400, 2 loại mẫu hỏng đã gặp thực tế:
      //   #1 prose bị bọc bracket:   1['câu văn…']      → revert ". câu văn…"
      //   #2 token bị bọc nháy TRONG chuỗi: 'người,'thống lĩnh':' → bỏ cặp nháy quanh "thống lĩnh"
      const winStart = Math.max(0, err.pos - 400);
      const win = body.slice(winStart, Math.min(body.length, err.pos + 400));
      const cands: { start: number; end: number; replacement: string }[] = [];
      let m;
      const reBracket = /\['([^'\]]{2,600})'\]/g;
      while ((m = reBracket.exec(win)) !== null) {
        if (/\s/.test(m[1]) || /[À-ỹĐđ]/.test(m[1])) {
          cands.push({ start: winStart + m.index, end: winStart + m.index + m[0].length, replacement: '. ' + m[1] });
        }
      }
      const reQuoted = /'([^'\n]{2,160})'/g;
      while ((m = reQuoted.exec(win)) !== null) {
        // chỉ chuỗi CÓ dấu tiếng Việt (kết quả dịch) — chuỗi code thường không bị nghi oan
        if (/[À-ỹĐđ]/.test(m[1])) {
          cands.push({ start: winStart + m.index, end: winStart + m.index + m[0].length, replacement: m[1] });
        }
      }
      if (!cands.length) break;
      const errPos = err.pos;
      cands.sort((a, b) => Math.abs((a.start + a.end) / 2 - errPos) - Math.abs((b.start + b.end) / 2 - errPos));
      let progressed = false;
      for (const c of cands) {
        const candidate = body.slice(0, c.start) + c.replacement + body.slice(c.end);
        const newErr = jsParseError(candidate);
        if (!newErr || newErr.pos > errPos + 2) {   // hết lỗi hoặc lỗi lùi RA XA = có tiến triển
          body = candidate; err = newErr; progressed = true; reverts++; break;
        }
      }
      if (!progressed) break;                        // không candidate nào giúp → dừng, không phá thêm
    }
    if (!err && reverts > 0) {
      result = result.replace(transScripts[i], body);
      repaired++;
      console.warn(`[surgicalTranslate] 🩹 Script ${i + 1}: vá ${reverts} chỗ "prose bị bọc bracket" → cú pháp lành trở lại`);
    }
  }
  return { text: result, repaired };
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
      let replaceStart = token.start;
      const replaceEnd = token.end;

      // Check if the CJK token is ALREADY surrounded by quotes in the original text.
      // e.g. '西晋' → regex extracted 西晋 without quotes, but the source has quotes.
      // If we add quotes again, we get ''Tây Tấn'' which is a fatal JS SyntaxError.
      const charBefore = original.charAt(replaceStart - 1);
      const charAfter  = original.charAt(replaceEnd);
      const alreadyQuoted =
        (charBefore === "'" && charAfter === "'") ||
        (charBefore === '"' && charAfter === '"');

      if (token.isDotNotation && (finalTranslation.includes(' ') || /[À-ỹĐđ]/.test(finalTranslation))) {
        // JS Dot notation: rewrite to bracket notation
        if (!alreadyQuoted) {
          const dotIndex = original.lastIndexOf('.', replaceStart);
          if (dotIndex !== -1 && !original.substring(dotIndex + 1, replaceStart).includes('\n')) {
            const isOptionalChain = dotIndex > 0 && original.charAt(dotIndex - 1) === '?';
            // (bug 151) Giữ TIỀN TỐ ASCII của định danh: `n._预产天数` → `n['_Bản dịch']`.
            // Bỏ quên `_` thì khoá đọc/ghi lệch nhau, script chạy nhưng dữ liệu rơi vào ô khác —
            // hỏng âm thầm, tệ hơn vỡ cú pháp vì không có lỗi nào báo.
            const asciiPrefix = original.slice(dotIndex + 1, replaceStart);
            if (isOptionalChain) {
              // For optional chain obj?.prop, eat the "." and replace with ".['prop']" to get obj?.['prop']
              replaceStart = dotIndex;
              finalTranslation = `.['${asciiPrefix}${finalTranslation}']`;
            } else {
              // For normal dot notation obj.prop, replace ".prop" with "['prop']" to get obj['prop']
              replaceStart = dotIndex;
              finalTranslation = `['${asciiPrefix}${finalTranslation}']`;
            }
          }
        }
      } else if (token.isObjectKey && (finalTranslation.includes(' ') || /[À-ỹ]/.test(finalTranslation))) {
        // JS Object Key: wrap in quotes
        if (!alreadyQuoted) {
          // (bug 154) Nháy phải ÔM CẢ tiền tố ASCII: `_开场标识` → `'_Định danh khởi đầu'`.
          // Bọc mỗi phần Hán sẽ ra `_'Định danh khởi đầu'` — vẫn vỡ, mà còn khó nhìn ra hơn.
          // Và tên khoá phải khớp ĐÚNG với chỗ đọc `['_Định danh khởi đầu']` do nhánh
          // dot-notation ở trên sinh ra, không thì đọc/ghi lệch ô, hỏng âm thầm.
          const kb = original.slice(0, replaceStart);
          const keyPrefix = /[\w$]*$/.exec(kb)?.[0] ?? '';
          if (keyPrefix) replaceStart -= keyPrefix.length;
          finalTranslation = `'${keyPrefix}${finalTranslation}'`;
        }
      } else if (token.isCssClass) {
        // CSS Class & jQuery Selector: replace spaces with dots to act as multiple classes matching the HTML
        if (finalTranslation.includes(' ') && !finalTranslation.startsWith('[')) {
          if (!alreadyQuoted) {
            finalTranslation = finalTranslation.replace(/\s+/g, '.');
          }
        }
      } else if (token.isHtmlAttr) {
        // HTML Attributes (id, data, etc.): If it's ID, use underscore.
        // For class, spaces are fine (they act as multiple classes which CSS will match using dots).
        // Let's check context before for id vs class
        const contextBefore = original.substring(Math.max(0, replaceStart - 50), replaceStart);
        if (/id\s*=\s*['"]\s*$/.test(contextBefore)) {
           finalTranslation = finalTranslation.replace(/\s+/g, '_');
        }
      }
      
      // AUTO-SPACE FIX FOR VIETNAMESE CJK UNITS
      if (finalTranslation && /^[a-zA-ZÀ-ỹ]/.test(finalTranslation) && !finalTranslation.startsWith('[')) {
        const prevChar = result.charAt(replaceStart - 1);
        if (prevChar && /[\d\}\)\]>]/.test(prevChar)) {
          finalTranslation = ' ' + finalTranslation;
        }
      }

      // ANTI-DUPLICATE-QUOTE GUARD
      // Large regex/replaceString fields embed JS/HTML where CJK keys/strings are
      // already wrapped in quotes. If the source already has a quote right at the
      // boundary AND the (possibly re-wrapped) translation also carries that same
      // quote, inserting it would produce '' or "" — a stray/duplicated quote that
      // breaks the embedded code. This is the "dư dấu" symptom users hit on big
      // regex cards. Strip the duplicate at each boundary. Purely defensive: it
      // only removes a quote that would immediately collide with an existing one.
      {
        const cb = result.charAt(replaceStart - 1);
        const ca = result.charAt(replaceEnd);
        if ((cb === "'" || cb === '"') && finalTranslation.charAt(0) === cb) {
          finalTranslation = finalTranslation.slice(1);
        }
        if ((ca === "'" || ca === '"') && finalTranslation.charAt(finalTranslation.length - 1) === ca) {
          finalTranslation = finalTranslation.slice(0, -1);
        }
      }

      // ═══ (bug 151) LƯỚI CHẶN CUỐI: KHÔNG BAO GIỜ ĐẺ ĐỊNH DANH CÓ DẤU CÁCH ═══
      // Mọi nhánh trên đều có thể sai sót ở một mẫu chưa lường tới; nhưng hậu quả thì luôn
      // giống nhau và luôn chí mạng: `obj.Hai Từ` không phải cú pháp JS hợp lệ, script chết
      // hoàn toàn. Chốt chặn này soi ĐÚNG vị trí sắp ghi: nếu đang ở thế truy cập thuộc tính
      // mà bản dịch có dấu cách và chưa được bọc bracket/nháy thì THÀ GIỮ NGUYÊN chữ Hán —
      // code Trung vẫn chạy, còn hơn xuất ra file không parse nổi.
      // Chỉ chặn khi ĐÚNG là truy cập thuộc tính trần: dấu chấm DÍNH LIỀN định danh, ký tự
      // trước dấu chấm không phải chữ số, và không đang ở trong chuỗi. Ba điều kiện này loại
      // hết văn xuôi đánh số ('1. Thế cục' — chấm có khoảng trắng theo sau, lại nằm trong
      // chuỗi) vốn được phép thay chữ thuần tuý.
      if (/\s/.test(finalTranslation) && !/^[['"`.]/.test(finalTranslation)) {
        const head = result.slice(0, replaceStart);
        const bare = head.slice(0, head.length - (/[\w$]*$/.exec(head)?.[0].length ?? 0));
        const lineHead = head.slice(head.lastIndexOf('\n') + 1);
        if (/[\w$\])}'"一-鿿㐀-䶿]\??\.$/.test(bare) && !/[0-9]\??\.$/.test(bare) && !isInsideStringAtEnd(lineHead)) {
          continue;
        }
      }

      result = result.slice(0, replaceStart) + finalTranslation + result.slice(replaceEnd);
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
/**
 * (User 2026 — bugNeedFix/31 BUG A) Phát hiện ĐỤNG ĐỘ ĐỊNH DANH: ≥2 token nguồn KHÁC NHAU nhưng
 * dịch ra CÙNG 1 giá trị — với token là khóa/định danh code (isObjectKey/isDotNotation/isIdentifier)
 * thì đây là LỖI LOGIC (vd 女性角色 & 男性角色 đều → "Nhân Vật Nam" ⇒ tường Nữ đọc nhầm data Nam;
 * hoặc 2 khóa ảnh trùng ⇒ tra nhầm ảnh). Trả về các nhóm đụng độ để dịch lại cho khác nhau.
 */
export function detectSurgicalIdentifierCollisions(
  tokens: CJKToken[],
): { translated: string; sources: string[] }[] {
  const byTrans = new Map<string, Set<string>>();
  for (const t of tokens) {
    const isIdent = t.isObjectKey || t.isDotNotation || t.isIdentifier || t.isCssClass || t.isHtmlAttr;
    if (!isIdent) continue;
    const src = t.text.trim();
    const trg = (t.translated || '').trim();
    if (!trg || trg === src) continue; // chưa dịch / giữ nguyên CJK → bỏ
    if (!byTrans.has(trg)) byTrans.set(trg, new Set());
    byTrans.get(trg)!.add(src);
  }
  const out: { translated: string; sources: string[] }[] = [];
  for (const [trg, srcs] of byTrans) {
    if (srcs.size > 1) out.push({ translated: trg, sources: [...srcs] });
  }
  return out;
}

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

/**
 * (User 2026 — bugNeedFix/33) GUARD CHỐNG "AI BỊA THÊM CODE".
 *
 * Triệu chứng: dịch 1 script code (vd Zod schema `变量管理`), AI KHÔNG chỉ dịch chữ Hán mà TỰ VIẾT
 * THÊM hàm mới (vd `const safeString = () => z.preprocess((val) => {…})`) vốn KHÔNG có trong bản gốc.
 * Code bịa ra vẫn parse HỢP LỆ nên guard cú pháp JS (acorn) không bắt được → lọt vào card.
 *
 * Nguyên tắc bắt lỗi: một bản dịch CODE trung thực CHỈ đổi chữ trong comment/chuỗi/định danh — nó
 * KHÔNG BAO GIỜ làm đổi TỔNG SỐ dấu ngoặc `()`, `{}`, `[]` và backtick. Thêm 1 hàm/khối = thêm ngoặc;
 * xoá code = bớt ngoặc. Nên chênh lệch số ngoặc (ngoài dung sai nhỏ) ⇒ code bị thêm/bớt ⇒ chặn.
 *
 * Đếm gộp fullwidth (（ ＝ (, ｛ ＝ {, …) để KHÔNG báo nhầm khi comment tiếng Trung đổi ngoặc
 * fullwidth→halfwidth. `tolerance` cho phép lệch rất nhỏ (mặc định 0 = nghiêm ngặt cho code).
 */
export function verifyCodeStructureParity(
  original: string,
  translated: string,
  tolerance = 0,
  /**
   * (bug 154) Số cặp `[ ]` được thêm CÓ CHỦ ĐÍCH do đổi khoá sang dạng bracket
   * (`obj.键` → `obj['Tên Việt']`). Mỗi lần đổi thêm đúng một `[` và một `]` — cân bằng, hợp lệ.
   * Không trừ ra thì bộ kiểm đếm thô sẽ kêu "dấu [ THÊM 19" mỗi lần từ điển hoạt động, đúng
   * cảnh user thấy: cấu trúc ✅ ngoặc không lệch, mà vẫn ⚠️ báo thêm ngoặc.
   * Báo động giả kiểu này nguy hiểm ở chỗ nó dạy người ta bỏ qua cảnh báo thật.
   */
  expectedBracketPairs = 0,
): { ok: boolean; reason?: string; maxDiff: number } {
  // Đếm 1 lớp ngoặc gồm biến thể ASCII + fullwidth + CJP tương ĐƯƠNG (để KHÔNG báo nhầm khi comment
  // tiếng Trung đổi （→( , 【→[ , 〔→[ … sang ASCII lúc dịch — chúng cùng lớp nên tổng giữ nguyên).
  // KHÔNG gộp ngoặc-nháy CJK 「」『』《》〈〉 vì chúng thường đổi thành "…"/'…' (không phải ngoặc ASCII
  // tôi đang đếm) → không gây nhiễu lớp (){}[].
  const countClass = (str: string, chars: string): number => {
    let c = 0;
    for (let i = 0; i < str.length; i++) if (chars.indexOf(str[i]) !== -1) c++;
    return c;
  };
  const checks: { name: string; chars: string }[] = [
    { name: '(', chars: '(（' },
    { name: ')', chars: ')）' },
    { name: '{', chars: '{｛' },
    { name: '}', chars: '}｝' },
    { name: '[', chars: '[［【〔〖' },
    { name: ']', chars: ']］】〕〗' },
    { name: '`', chars: '`' },
  ];
  let worst: { name: string; o: number; t: number; diff: number } | null = null;
  for (const c of checks) {
    const o = countClass(original, c.chars);
    const t = countClass(translated, c.chars);
    // Với [ và ] thì trừ đi phần thêm hợp lệ do bracket-wrap; chỉ trừ khi bản dịch NHIỀU HƠN
    // (bớt ngoặc thì vẫn là bất thường, không có lý do gì tha).
    const allowance = (c.name === '[' || c.name === ']') && t > o ? expectedBracketPairs : 0;
    const diff = Math.max(0, Math.abs(t - o) - allowance);
    if (!worst || diff > worst.diff) worst = { name: c.name, o, t, diff };
  }
  const maxDiff = worst ? worst.diff : 0;
  if (worst && worst.diff > tolerance) {
    const verb = worst.t > worst.o ? 'THÊM' : 'BỚT';
    return { ok: false, maxDiff, reason: `dấu "${worst.name}" ${verb} ${worst.diff} (gốc ${worst.o} → dịch ${worst.t})` };
  }
  return { ok: true, maxDiff };
}

/**
 * (User 2026 — bugNeedFix/33) Phát hiện ĐỊNH DANH KHAI BÁO MỚI mà bản dịch tự thêm.
 * Bắt các khai báo top-levelish `const/let/var/function NAME` với NAME là ASCII (không phải chữ Hán
 * được phiên âm) mà bản GỐC KHÔNG hề có → dấu hiệu AI bịa hàm/biến (vd `safeString`, `helper`, `sanitize`).
 * Trả về danh sách tên bịa (rỗng nếu không có). Dùng làm tín hiệu PHỤ (log rõ), không phải cổng cứng
 * vì phiên âm định danh Hán sang ASCII là hợp lệ trong vài trường hợp.
 */
export function detectInventedDeclarations(original: string, translated: string): string[] {
  const declRe = /\b(?:const|let|var|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const names = (src: string): Set<string> => {
    const s = new Set<string>();
    let m: RegExpExecArray | null;
    declRe.lastIndex = 0;
    while ((m = declRe.exec(src)) !== null) s.add(m[1]);
    return s;
  };
  const origNames = names(original);
  const transNames = names(translated);
  const invented: string[] = [];
  for (const n of transNames) {
    if (!origNames.has(n)) invented.push(n);
  }
  return invented;
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
    // Strip any hallucinated [context: ...] that the LLM might echo back
    t = t.replace(/\[context:.*?\]/gi, '').trim();

    if (t.startsWith(token.text)) {
      t = t.substring(token.text.length).trim().replace(/^[\s:=>-]+/, '').trim();
    }
    const paren   = `(${token.text})`;
    const bracket = `[${token.text}]`;
    if (t.endsWith(paren))   t = t.slice(0, -paren.length).trim();
    if (t.endsWith(bracket)) t = t.slice(0, -bracket.length).trim();

    // Strip matching wrapping parentheses or brackets that might remain (e.g. "(trĩ)" -> "trĩ")
    if (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
    if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1).trim();
    
    t = sanitizeTranslatedText(t);

    // Clean up LLM syntax reflections before performing safety checks
    // 1. Strip leading key-value identifier prefix (e.g. desc: 'translation' -> 'translation')
    t = t.replace(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*[:=]\s*/, '');

    // 1b. (User 2026 — bugNeedFix/31 BUG B) LLM hay biến các mục JSON object thành DANH SÁCH và
    // thêm ký tự đầu dòng "-"/"*"/"•"/"+" vào bản dịch của KEY: "秦鱼" → "- Tần Ngư". Key có "- " ở
    // đầu làm hỏng tra cứu (IMAGE_CONFIG[tên] không khớp) ⇒ mất ảnh. Định danh/khóa KHÔNG BAO GIỜ
    // hợp lệ khi bắt đầu bằng ký tự đầu dòng — strip sạch.
    t = t.replace(/^[-*•+]\s+/, '');

    // 2. Strip leading/trailing quotes, commas, semicolons, and spaces
    t = t.replace(/^['"`\s]+|['"`\s,;]+$/g, '');

    // SAFETY: Reject translations containing structural syntax characters.
    // Short tokens (<=6 chars, likely identifiers) -> also reject quotes
    // Long tokens (>6 chars, full sentences with punct) -> allow quotes in natural text
    if (/[<>{}`]/.test(t)) return '';
    if (/['"]/.test(t) && token.text.length <= 6) return '';

    // Reject translations that still contain CJK characters (LLM echoed them back or failed to translate)
    if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(t)) return '';

    return t;
  };

  const validIdCount = parsedTranslations.filter(p => p.id !== undefined).length;

  if (validIdCount >= batch.length * 0.5) {
    // Prefer ID-based mapping to prevent scrambled translations
    for (const p of parsedTranslations) {
      if (p.id !== undefined) {
        const token = batch.find(t => t.id === p.id);
        if (token && !token.translated) {
          const cleaned = clean(token, p.text);
          if (cleaned) { token.translated = cleaned; matched++; }
        }
      }
    }
  } else if (parsedTranslations.length === batch.length) {
    // Fallback to positional mapping only if IDs are mostly missing
    for (let i = 0; i < batch.length; i++) {
      if (!batch[i].translated) {
        const cleaned = clean(batch[i], parsedTranslations[i].text);
        if (cleaned) { batch[i].translated = cleaned; matched++; }
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
  cssCjkHandling: 'preserve' | 'translate' = 'preserve',
  customSchema?: string,
  customPrompt?: string,
  fieldLabel?: string
): Promise<{ translated: string; success: boolean; fallbackTriggered: boolean; dict?: Record<string, string> }> {
  const { callProvider, computePoolConcurrency } = await import('./apiClient');
  // Bang Hán → Việt cua chinh lan dich nay. Nguoi goi can no de va regex trong code:
  // regex khop nhan tieng Trung ma khong duoc va thi sau khi dich literal se het khop,
  // chuc nang chet im lang (khong loi, khong canh bao).
  const dictOf = (ts: CJKToken[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const t of ts) {
      const a = String(t.text ?? '').trim();
      const b = String(t.translated ?? '').trim();
      // Identifier / object key / class CSS la khoa may doc, khong phai nhan hien thi —
      // khong dua vao bang de tranh va regex bang thu khong bao gio xuat hien tren man.
      if (t.isIdentifier || t.isObjectKey || t.isCssClass || t.isDotNotation) continue;
      if (a && b && a !== b) out[a] = b;
    }
    return out;
  };

  // ── Step 1: Extract CSS + URL protected zones, then CJK tokens ─────────────
  const cssZones = extractCSSPropertyZones(text);
  const urlZones = extractURLZones(text);
  const allProtectedZones = [...cssZones, ...urlZones];
  const tokens   = extractCJKTokens(text, allProtectedZones, cssCjkHandling, mvuDictionary);

  writeDebugLog(
    `[surgicalTranslate] Start — strict=${strictVerification}, cssZones=${cssZones.length}, urlZones=${urlZones.length}, tokens=${tokens.length}`
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

  let userPriorityPrompt = '';
  if (customPrompt) {
    const priorityMatch = customPrompt.match(/\[USER_PRIORITY_PROMPT_START\]\n([\s\S]*?)\n\[USER_PRIORITY_PROMPT_END\]/);
    if (priorityMatch) {
      userPriorityPrompt = priorityMatch[1];
      customPrompt = customPrompt.replace(/\[USER_PRIORITY_PROMPT_START\]\n[\s\S]*?\n\[USER_PRIORITY_PROMPT_END\]\n?/, '');
    }
    // (Prompt caching) Surgical ghép customPrompt vào CUỐI prompt của nó sẵn rồi — chỉ cần lột
    // marker [DYNAMIC_CONTEXT_*] (giữ nguyên nội dung RAG bên trong) để không lộ marker vào prompt.
    customPrompt = customPrompt.replace(/\[DYNAMIC_CONTEXT_(START|END)\]\n?/g, '');
  }

  const pendingTokens = tokens.filter(t => !t.translated);
  if (pendingTokens.length === 0) {
    const { text: reinserted } = repairScriptSyntaxCorruption(text, reinsertTranslations(text, tokens));
    onProgress?.(tokens.length, tokens.length, 'Done (local)');
    return { translated: reinserted, success: true, fallbackTriggered: false, dict: dictOf(tokens) };
  }

  // ── Step 3: Deduplicate pending tokens ────────────────────────────────────
  const isLogicField = fieldLabel && (
    fieldLabel.toLowerCase().includes('regex') ||
    fieldLabel.toLowerCase().includes('replacestring') ||
    fieldLabel.toLowerCase().includes('trimstrings') ||
    fieldLabel.toLowerCase().includes('helper') ||
    fieldLabel.toLowerCase().includes('script')
  );

  const uniqueTokens: CJKToken[] = [];
  const textToRepToken = new Map<string, CJKToken>();

  for (const token of pendingTokens) {
    const trimmed = token.text.trim();
    const needsConsistency = isLogicField || token.isIdentifier || token.isObjectKey || token.isDotNotation || token.isCssClass || token.isHtmlAttr;

    if (needsConsistency) {
      if (!textToRepToken.has(trimmed)) {
        textToRepToken.set(trimmed, token);
        uniqueTokens.push(token);
      }
    } else {
      // Prose tokens: never deduplicate, always add as unique token
      uniqueTokens.push(token);
    }
  }

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
- Translate into NATURAL, MODERN Vietnamese that is easy to understand. Do NOT use archaic Hán Việt (Sino-Vietnamese) for descriptive text.
- Chinese proper nouns (人名, 地名, 国名) → Use Hán Việt reading ONLY for names. Examples: 清河 → Thanh Hà, 慕容冲 → Mộ Dung Xung, 洛阳 → Lạc Dương.
- Dynasty/era names → Hán Việt. Examples: 东晋 → Đông Tấn, 前秦 → Tiền Tần, 永嘉 → Vĩnh Gia.
- All OTHER text (descriptions, traits, abilities, UI labels, dialogue) → Translate into plain, natural Vietnamese. 
  Examples: 身壮体健 → Thân thể cường tráng (NOT "Thân tráng thể kiện"), 相貌平平 → Ngoại hình bình thường (NOT "Tướng mạo bình bình"), 弱不胜衣 → Yếu đuối không chịu nổi áo (NOT "Nhược bất thắng y"), 体能与力量 → Thể lực và sức mạnh (NOT "Thể năng và lực lượng"), 容貌与气度 → Dung mạo và phong thái.
- Use natural Vietnamese roleplay pronouns (ta, ngươi, hắn, nàng).
- Keep the tone fitting for historical content but always prioritize readability over literary style.`
    : '';

  const systemPrompt =
    `You are a professional CJK-to-${targetLang} translation engine for game/roleplay character cards.
${fieldLabel ? `You are currently translating the field: "${fieldLabel}". Use this to understand which part of the character card these text snippets belong to.
` : ''}

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
9. [CRITICAL CONTEXT RULE]: The [context: ...] provides surrounding text ONLY for you to understand the situation. DO NOT translate the context! DO NOT output the context! Your output MUST strictly be the translation of the exact CJK text alone. If you output the context or any HTML tags, the system will crash!
10. [UNIQUENESS] Items are object KEYS / data-path IDENTIFIERS used for lookups. DIFFERENT source items MUST get DIFFERENT translations — especially opposite pairs: 男=Nam vs 女=Nữ, 上=Trên vs 下=Dưới, 内=Trong vs 外=Ngoài. NEVER collapse two distinct sources into the same translation (it silently breaks the game logic). The SAME source item must always get the SAME translation.
11. [NO LIST MARKERS] These are code identifiers, NOT a bullet list. NEVER prefix a translation with "-", "*", "•" or "+". A key like "秦鱼" → "Tần Ngư", never "- Tần Ngư".
${langRules}${glossaryPrompt}${mvuPrompt}` +
    (customPrompt ? `\n\nUSER DIRECTIVES & RAG CONTEXT:\n${customPrompt}` : '') +
    (customSchema ? `\n\nSCHEMA CONTEXT:\n${customSchema}` : '') +
    `\n\nORIGINAL CODE/REGEX CONTEXT (For Reference Only):\nBelow is the full original code/regex block you are currently translating. Use it to understand the full context of the variables and text snippets:\n\`\`\`\n${text.slice(0, 50000)}\n\`\`\`` +
    (userPriorityPrompt ? `\n\n[YÊU CẦU QUAN TRỌNG NHẤT TỪ NGƯỜI DÙNG — PHẢI TUÂN THỦ TẠI MỌI GIÁ]\n${userPriorityPrompt}` : '');

  // ── Step 5: Batch configuration ────────────────────────────────────────────
  const MEGA_BATCH_MAX   = 1500;
  const FALLBACK_BATCH   = 500;
  const MICRO_BATCH      = 50;
  const MAX_RETRIES      = 2;
  // Số batch song song = tổng ngân sách RPM toàn pool (mọi key × provider), tối thiểu 4 (giữ hành vi
  // cũ cho cấu hình nhỏ). Không còn kẹt cứng 4 luồng. pickLane vẫn gate RPM nên không vượt 429.
  const PARALLEL_CONCUR  = Math.max(4, computePoolConcurrency(config));
  // Giãn khởi động chỉ 150ms (trước 2000ms) — pickLane đã pace theo RPM nên không cần giãn tay 2s nữa.
  const STAGGER_MS       = 150;
  const BATCH_TIMEOUT_MS = 500_000; // 500s per batch

  let tokenBatches: CJKToken[][] = [];
  let usedMegaBatch = false;

  const isRegex = fieldLabel && (
    fieldLabel.toLowerCase().includes('regex') ||
    fieldLabel.toLowerCase().includes('replacestring') ||
    fieldLabel.toLowerCase().includes('trimstrings')
  );

  if (uniqueTokens.length <= MEGA_BATCH_MAX && !isRegex) {
    tokenBatches  = [uniqueTokens];
    usedMegaBatch = true;
    console.log(`[surgicalTranslate] ${uniqueTokens.length} unique tokens — single mega-batch`);
  } else {
    for (let i = 0; i < uniqueTokens.length; i += FALLBACK_BATCH) {
      tokenBatches.push(uniqueTokens.slice(i, i + FALLBACK_BATCH));
    }
    console.log(
      `[surgicalTranslate] ${uniqueTokens.length} tokens — ` +
      (isRegex ? `regex mode (mega-batch bypassed) — ` : '') +
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
        // Provide surrounding context for EVERY token so the LLM grasps meaning in long paragraphs
        // Gemini 3.1 Pro has massive context — use ±200 chars to capture field labels/section headers
        const ctxStart = Math.max(0, t.start - 200);
        const ctxEnd   = Math.min(text.length, t.end + 200);
        const ctx      = text.slice(ctxStart, ctxEnd).replace(/[\n\r]+/g, ' ').trim();
        return `#${t.id}\t${t.text}\t[context: ${ctx}]`;
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

    // ── Step 8.5: Hán Việt / Sino-Vietnamese Fallback Wave for remaining untranslated tokens ──
    const fallbackUntranslated = tokens.filter(t => !t.translated?.trim());
    if (fallbackUntranslated.length > 0) {
      console.log(
        `[surgicalTranslate] Fallback Wave: ${fallbackUntranslated.length} token(s) still untranslated` +
        ` — translating in dedicated Sino-Vietnamese fallback wave`
      );
      writeDebugLog(
        `[surgicalTranslate] Fallback Wave start for ${fallbackUntranslated.length} tokens`
      );

      const fallbackUniqueMap = new Map<string, CJKToken[]>();
      for (const t of fallbackUntranslated) {
        const key = t.text.trim();
        if (!fallbackUniqueMap.has(key)) {
          fallbackUniqueMap.set(key, []);
        }
        fallbackUniqueMap.get(key)!.push(t);
      }

      const fallbackUniqueTokens = Array.from(fallbackUniqueMap.values()).map(arr => arr[0]);

      const fallbackBatches: CJKToken[][] = [];
      for (let i = 0; i < fallbackUniqueTokens.length; i += MICRO_BATCH) {
        fallbackBatches.push(fallbackUniqueTokens.slice(i, i + MICRO_BATCH));
      }

      const processFallbackBatch = async (batch: CJKToken[], label: string): Promise<void> => {
        if (signal?.aborted) return;

        const payload = batch
          .map(t => `#${t.id}\t${t.text}`)
          .join('\n');

        const fallbackSystemPrompt =
          `You are a professional CJK Sino-Vietnamese (Hán Việt) dictionary and translation engine.${fandomNameOverride()}
Your task is to translate the following isolated CJK terms to Vietnamese:
1. For single Chinese characters (length 1): Return ONLY their standard Sino-Vietnamese (Hán Việt) reading in lowercase.
   Examples: 峙 -> trĩ, 庸 -> dung, 饷 -> hướng, 铠 -> khải, 槊 -> sóc, 兵 -> binh.
2. For multi-character words: Translate them to plain, natural Vietnamese.
   Examples: 曹操 -> Tào Tháo, 骑兵 -> kỵ binh, 战斗力 -> sức chiến đấu.

INPUT FORMAT: Lines formatted as "#{{id}}\t{{CJK text}}"
OUTPUT FORMAT: Return ONLY "#{{id}}\t{{translated text}}" for EACH input line, one per item.
CRITICAL RULES:
- Absolutely ZERO Chinese/Japanese/Korean characters allowed in output.
- Do NOT output explanations, context, markdown formatting, or conversational text.
- Do NOT use quotes or any punctuation in the translation unless part of a natural Vietnamese word.`;

        const callWithTimeout = (): Promise<string> =>
          new Promise<string>((resolve, reject) => {
            const timerId = setTimeout(
              () => reject(new Error(`Fallback Batch timeout after 100s`)),
              100000
            );
            callProvider(config, fallbackSystemPrompt, payload, signal)
              .then(r  => { clearTimeout(timerId); resolve(r); })
              .catch(e => { clearTimeout(timerId); reject(e); });
          });

        for (let attempt = 0; attempt <= 1; attempt++) {
          if (signal?.aborted) break;
          try {
            writeDebugLog(`[surgicalTranslate] ${label} attempt ${attempt + 1}`);
            const rawResult = await callWithTimeout();
            const parsed = parseBatchResponse(rawResult);

            let matched = 0;
            for (const p of parsed) {
              if (p.id !== undefined) {
                const sourceToken = batch.find(t => t.id === p.id);
                if (sourceToken) {
                  let cleaned = p.text.trim();
                  cleaned = cleaned.replace(/^['"`\s]+|['"`\s,;]+$/g, '');
                  
                  const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(cleaned);
                  if (cleaned && !hasCjk) {
                    const group = fallbackUniqueMap.get(sourceToken.text.trim()) || [];
                    for (const t of group) {
                      t.translated = cleaned;
                    }
                    matched++;
                  }
                }
              }
            }

            writeDebugLog(`[surgicalTranslate] ${label}: matched=${matched}/${batch.length}`);
            if (matched >= batch.length * 0.5) break;
          } catch (err: any) {
            console.warn(`[surgicalTranslate] ${label} error:`, err.message);
          }
        }
      };

      for (const batch of fallbackBatches) {
        await processFallbackBatch(batch, `Fallback Batch`);
      }
    }

    // ── Step 9: Propagate deduplicated translations and fill untranslated tokens ──
    const translationMap = new Map<string, string>();
    for (const t of tokens) {
      if (t.translated?.trim()) {
        translationMap.set(t.text.trim(), t.translated.trim());
      }
    }

    for (const t of tokens) {
      const trimmed = t.text.trim();
      const needsConsistency = isLogicField || t.isIdentifier || t.isObjectKey || t.isDotNotation || t.isCssClass || t.isHtmlAttr;
      if (!t.translated?.trim() && needsConsistency) {
        if (translationMap.has(trimmed)) {
          t.translated = translationMap.get(trimmed);
          writeDebugLog(`[surgicalTranslate] Propagated translation for: "${trimmed}" → "${t.translated}"`);
        }
      }
    }

    // ── Step 9b: (bugNeedFix/31 BUG A) Giải quyết ĐỤNG ĐỘ ĐỊNH DANH ──────────
    // ≥2 khóa/định danh nguồn KHÁC NHAU dịch ra CÙNG 1 giá trị (vd 女性角色 & 男性角色 → "Nhân Vật
    // Nam") ⇒ logic tra nhầm object. Gọi AI dịch LẠI đúng các nguồn đụng độ cho khác nhau + đồng bộ
    // lại translationMap để mọi token cùng nguồn ăn theo. Lỗi/không có key thì bỏ qua (không chặn).
    const collisions = detectSurgicalIdentifierCollisions(tokens.filter(t => t.translated?.trim()));
    if (collisions.length > 0 && !signal?.aborted) {
      const conflictSources = [...new Set(collisions.flatMap(c => c.sources))];
      console.warn(`[surgicalTranslate] ĐỤNG ĐỘ định danh: ${collisions.length} nhóm — dịch lại ${conflictSources.length} nguồn`, collisions);
      try {
        const sys = `Bạn là chuyên gia dịch ĐỊNH DANH/KHÓA trong code sang ${targetLang}.
Các mục dưới đây trước đó bị dịch TRÙNG NHAU (nhiều nguồn khác nhau ra cùng một bản dịch) — điều này làm HỎNG logic vì code dùng chúng để tra cứu object. Dịch LẠI mỗi mục thành một tên DUY NHẤT, KHÁC NHAU, đúng nghĩa. Chú ý cặp đối lập (男=Nam/女=Nữ, 上=Trên/下=Dưới…) phải khác nhau rõ.
CHỈ trả về JSON object ánh xạ nguyên bản gốc → bản dịch mới: {"源":"dịch"}. Không markdown, không giải thích, KHÔNG thêm ký tự đầu dòng.`;
        const user = `Dịch lại (mỗi mục 1 tên DUY NHẤT):\n${conflictSources.map((s, i) => `${i + 1}. "${s}"`).join('\n')}`;
        const raw = await callProvider(config, sys, user, signal, undefined, { label: `Sửa đụng độ định danh (${conflictSources.length})` });
        let fixMap: Record<string, string> = {};
        try {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) fixMap = JSON.parse(m[0]);
        } catch { /* AI trả sai JSON → bỏ pass này, giữ bản cũ */ }
        const usedTargets = new Set(tokens.map(t => (t.translated || '').trim()).filter(Boolean));
        for (const src of conflictSources) {
          let val = (fixMap[src] || '').trim().replace(/^[-*•+]\s+/, '');
          if (!val || /[一-鿿]/.test(val)) continue; // AI trả rỗng/còn CJK → giữ nguyên
          // đảm bảo DUY NHẤT: nếu vẫn trùng, thêm hậu tố phân biệt (đường thoát an toàn)
          let uniq = val, n = 2;
          while (usedTargets.has(uniq) && ![...tokens].some(t => t.text.trim() === src && t.translated?.trim() === uniq)) { uniq = `${val} ${n++}`; }
          usedTargets.add(uniq);
          for (const t of tokens) if (t.text.trim() === src) t.translated = uniq;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        console.error('[surgicalTranslate] Sửa đụng độ thất bại (bỏ qua):', err?.message);
      }
    }

    for (const t of tokens) {
      if (!t.translated?.trim()) {
        t.translated = t.text; // keep original CJK if LLM missed it
      }
    }

    // ── Step 10: Reinsertion + post-processing ─────────────────────────────
    const rawReinserted = reinsertTranslations(text, tokens);
    const normalized    = normalizeFullwidthPunctuation(rawReinserted);
    // Pass the original `text` so CSS property names can be compared and restored
    const cssValidated  = postValidateCSSProperties(text, normalized);
    // Lưới an toàn: script gốc compile OK mà bản ghép vỡ → vá mẫu hỏng đã biết (compile-gated)
    const { text: reinserted, repaired } = repairScriptSyntaxCorruption(text, cssValidated);
    if (repaired > 0) writeDebugLog(`[surgicalTranslate] repaired ${repaired} corrupted <script> block(s)`);
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
      return { translated: reinserted, success: true, fallbackTriggered: false, dict: dictOf(tokens) };
    } else if (!strictVerification) {
      console.warn(
        `[surgicalTranslate] Verification FAILED but strictVerification=false` +
        ` — accepting with ${translatedCount} translations applied`
      );
      writeDebugLog('[surgicalTranslate] Verification FAILED (lenient). Accepting result.');
      return { translated: reinserted, success: true, fallbackTriggered: false, dict: dictOf(tokens) };
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
