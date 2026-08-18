import type { CharacterCard, ProxySettings, TranslationField } from '../types/card';
import { fandomNameOverride } from './fandomMode';
import type { ZodFieldDef } from '../types/mvuZodTypes';
import { extractPatchFieldNames } from './jsonPatchValidator';
import { callProvider } from './apiClient';
import { runWorkerPool } from './runWorkerPool';
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

/* ═══════════════════════════════════════════════════════════════════════════
   (bug 238) VẾ TRÁI CỦA DẤU CHẤM: BỘ NHẬN JS, HAY ĐOẠN ĐẦU CỦA MỘT PATH MVU?
   ═══════════════════════════════════════════════════════════════════════════
   Đổi `obj.Tên Nhiều Từ` → `obj['Tên Nhiều Từ']` là bắt buộc trong JS (việc 119). Nhưng cùng hình
   dạng "chữ · chấm · chữ" còn là cách MVU viết ĐƯỜNG DẪN BIẾN trong entry quy tắc:

       - `[Thế Giới.Thời Gian Hiện Tại]`: giờ trong game

   Chốt cũ chỉ đòi MỘT ký tự `[\w$\])]` ngay trước dấu chấm. `\w` trong JS là ASCII, nhưng chữ Việt
   có dấu vẫn KẾT THÚC bằng ký tự ASCII rất thường xuyên ("Giới" → `i`), nên chốt đó khớp luôn — và
   token path bị xẻ thành biểu thức JS:

       `[Thế Giới.Thời Gian Hiện Tại]`  →  `[Thế Giới['Thời Gian Hiện Tại']]`

   Sau đó AI trong game copy đúng hình dạng đó vào lệnh cập nhật, ra `_.set('Thế Giới['…']', …)` —
   nháy đơn lồng nháy đơn, vỡ chuỗi. (`fixNestedQuoteBracketPaths` sinh ra để dọn đúng đống này;
   nó chữa triệu chứng, còn đây là nơi bệnh phát ra.)

   Chốt mới: vế trái phải là một BỘ NHẬN JS THẬT — định danh ASCII TRỌN VẸN (`base`, `detail`,
   `stat_data`, `mpPool`), hoặc `]`/`)` (`arr[0].`, `fn().`). Lookbehind chặn ca "định danh giả":
   `Giới` bị loại vì ngay trước `i` là `ớ`. Chữ Việt/CJK trước dấu chấm ⇒ đó là path, chừa lại.
*/
const JS_RECEIVER = String.raw`(?:(?<![\w$À-ỹĐđ぀-ヿ一-鿿])[A-Za-z_$][\w$]*|[\]\)])`;

/** Một mục từ path `A.B` phải được hiểu là HAI đoạn path, không phải một key chứa dấu chấm. */
function normalizeMvuPathDots(source: string, target: string): string {
  const sourceParts = source.split('.');
  const targetParts = target.trim().split('.');
  if (sourceParts.length > 1 && sourceParts.length === targetParts.length) {
    return targetParts.map(part => part.trim()).join('.');
  }
  return target.trim().replace(/\s*\.\s*/g, ' ');
}

function expandMvuDictionarySegments(dict: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [source, target] of Object.entries(dict)) {
    if (!source || !target || source === target) continue;
    // JSON/JSON Pointer tự escape được nháy, slash và `~`; ở đây chỉ xử lý dấu chấm mang nghĩa path.
    const safeTarget = normalizeMvuPathDots(source, target);
    if (!safeTarget) continue;
    out.set(source, safeTarget);
    const sourceParts = source.split('.').map(s => s.trim());
    const targetParts = safeTarget.split('.').map(s => s.trim());
    if (sourceParts.length > 1 && sourceParts.length === targetParts.length &&
        sourceParts.every(Boolean) && targetParts.every(Boolean)) {
      sourceParts.forEach((part, i) => {
        // Mục từ riêng cho một đoạn cụ thể có độ tin cậy cao hơn mục được suy ra từ path.
        if (!out.has(part)) out.set(part, targetParts[i]);
      });
    }
  }
  return out;
}

const decodeJsonPointerSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');
const encodeJsonPointerSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/** Dịch JSON Pointer theo TỪNG đoạn và giữ đúng escape RFC 6901 (`~0`, `~1`). */
export function translateMvuJsonPointer(pointer: string, dict: Record<string, string>): string {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return pointer;
  const lookup = expandMvuDictionarySegments(dict);
  return pointer.split('/').map((raw, index) => {
    if (index === 0 || /^\d+$/.test(raw) || raw === '-') return raw;
    const decoded = decodeJsonPointerSegment(raw);
    const translated = lookup.get(decoded) ?? decoded;
    return encodeJsonPointerSegment(translated);
  }).join('/');
}

function jsonIndentOf(text: string): string | number | undefined {
  if (!/[\r\n]/.test(text)) return undefined;
  const m = text.match(/\r?\n([ \t]+)["}\]]/);
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : Math.min(10, m[1].length);
}

function parseJsonDocument(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined;
  try { return JSON.parse(trimmed) as unknown; } catch { return undefined; }
}

/**
 * Áp từ điển lên JSON bằng cấu trúc đã parse. Chỉ đổi object-key và `path`/`from` của JSON Patch;
 * KHÔNG thay bừa trong string value (enum, mô tả, nội dung) như bộ regex văn bản cũ.
 */
export function applyMvuToJsonText(text: string, dict: Record<string, string>): string | null {
  const parsed = parseJsonDocument(text);
  if (parsed === undefined) return null;
  const lookup = expandMvuDictionarySegments(dict);
  let changed = false;

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const originalKeys = new Set(Object.keys(source));
    for (const key of Object.keys(source)) {
      let nextValue = visit(source[key]);
      if ((key === 'path' || key === 'from') && typeof source[key] === 'string' &&
          typeof source.op === 'string') {
        const nextPointer = translateMvuJsonPointer(source[key] as string, dict);
        if (nextPointer !== source[key]) changed = true;
        nextValue = nextPointer;
      }

      let nextKey = lookup.get(key) ?? key;
      // Không bao giờ làm mất dữ liệu khi hai mục từ cùng đổ vào một key hoặc key chuẩn đã tồn tại.
      if (nextKey !== key && (Object.prototype.hasOwnProperty.call(result, nextKey) || originalKeys.has(nextKey))) {
        nextKey = key;
      }
      if (nextKey !== key) changed = true;
      result[nextKey] = nextValue;
    }
    return result;
  };

  const mapped = visit(parsed);
  if (!changed) return text;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(text) ? newline : '';
  return JSON.stringify(mapped, null, jsonIndentOf(text)).replace(/\n/g, newline) + trailing;
}

/** Ép key/path JSON theo bản gốc + từ điển, nhưng giữ nguyên mọi giá trị đã được AI dịch. */
function alignMvuJsonFromOriginal(originalText: string, translatedText: string, dict: Record<string, string>): string | null {
  const original = parseJsonDocument(originalText);
  const translated = parseJsonDocument(translatedText);
  if (original === undefined || translated === undefined) return null;
  const lookup = expandMvuDictionarySegments(dict);
  let changed = false;

  const align = (source: unknown, target: unknown): unknown => {
    if (Array.isArray(source) && Array.isArray(target)) {
      return target.map((item, i) => i < source.length ? align(source[i], item) : item);
    }
    if (!source || !target || typeof source !== 'object' || typeof target !== 'object' ||
        Array.isArray(source) || Array.isArray(target)) return target;

    const src = source as Record<string, unknown>;
    const dst = target as Record<string, unknown>;
    const srcKeys = Object.keys(src);
    const dstKeys = Object.keys(dst);
    const result: Record<string, unknown> = {};
    const reserved = new Set(dstKeys);

    dstKeys.forEach((currentKey, i) => {
      const sourceKey = srcKeys[i];
      const desired = sourceKey ? lookup.get(sourceKey) : undefined;
      let nextKey = currentKey;
      if (desired && desired !== currentKey && !Object.prototype.hasOwnProperty.call(result, desired) &&
          (!reserved.has(desired) || desired === currentKey)) {
        nextKey = desired;
        changed = true;
      }
      let nextValue = sourceKey ? align(src[sourceKey], dst[currentKey]) : dst[currentKey];
      if ((currentKey === 'path' || currentKey === 'from') && sourceKey && typeof src[sourceKey] === 'string' &&
          typeof src.op === 'string') {
        const pointer = translateMvuJsonPointer(src[sourceKey] as string, dict);
        if (nextValue !== pointer) changed = true;
        nextValue = pointer;
      }
      result[nextKey] = nextValue;
    });
    return result;
  };

  const aligned = align(original, translated);
  if (!changed) return translatedText;
  const newline = translatedText.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(translatedText) ? newline : '';
  return JSON.stringify(aligned, null, jsonIndentOf(translatedText)).replace(/\n/g, newline) + trailing;
}

/**
 * Khôi phục `obj['']`/`obj[""]` khi bản gốc ở đúng vị trí có key và từ điển biết tên chuẩn.
 * Chỉ chạy khi số bracket-access hai phía bằng nhau để không đoán lệch vị trí.
 */
export function restoreEmptyMvuBracketAccess(
  original: string,
  translated: string,
  dict: Record<string, string>,
): { text: string; count: number } {
  const re = /\[\s*(['"])(.*?)\1\s*\]/g;
  const sourceSlots = [...original.matchAll(re)];
  const targetSlots = [...translated.matchAll(re)];
  if (sourceSlots.length === 0 || sourceSlots.length !== targetSlots.length) return { text: translated, count: 0 };

  const edits: Array<{ start: number; end: number; value: string }> = [];
  targetSlots.forEach((slot, i) => {
    if (slot[2].trim()) return;
    const sourceKey = sourceSlots[i][2].trim();
    const mapped = dict[sourceKey];
    if (!sourceKey || !mapped) return;
    const canonical = sanitizeMvuVarName(sourceKey, mapped);
    if (!canonical) return;
    const quote = slot[1];
    const escaped = canonical.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`);
    edits.push({ start: slot.index, end: slot.index + slot[0].length, value: `[${quote}${escaped}${quote}]` });
  });

  let out = translated;
  for (const edit of edits.reverse()) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
  return { text: out, count: edits.length };
}

/**
 * (bug 238) TỰ LÀNH dot-access ĐÃ vỡ từ lượt dịch trước — `base.Lời Tiên Tri Và Tin Đồn`.
 *
 * Trước đây việc này nằm trong vòng lặp từ điển của {@link applyMvuToText}, mỗi tên một lượt
 * `replace`. Path NHIỀU TẦNG thì hỏng theo thứ tự: tầng sau chỉ hợp lệ SAU KHI tầng trước đã thành
 * bracket (`stat_data.A.B` → `stat_data['A'].B` → `stat_data['A']['B']`), mà thứ tự vòng lặp lại
 * theo độ dài tên GỐC nên có card rơi vào đúng thứ tự sai. Quét LẶP tới khi không đổi nữa thì
 * không còn phụ thuộc may rủi.
 *
 * `names` là các giá trị ĐÃ DỊCH trong từ điển — biết chính xác ranh giới tên nên không đoán mò.
 */
export function bracketizeDotAccess(text: string, names: Iterable<string>): string {
  if (!text || typeof text !== 'string') return text;
  const targets = [...new Set([...names].flatMap(name => name.split('.').map(part => part.trim()).filter(Boolean)))]
    // Tên là định danh ASCII hợp lệ (`Level`) thì dot-access vốn đã đúng cú pháp — chừa ra.
    .filter((n) => n && !/^[A-Za-z_$][\w$]*$/.test(n))
    .sort((a, b) => b.length - a.length);
  if (targets.length === 0) return text;

  let out = text;
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const name of targets) {
      // Từ điển thẻ lớn có vài trăm tên, mà một field chỉ dùng vài chục. Chặn bằng `includes`
      // (rẻ, không dựng RegExp) để lượt quét lặp không thành hàng giây cho mỗi field.
      if (!out.includes(name)) continue;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bracket = `['${name.replace(/'/g, "\\'")}']`;
      // Hàm thay (không dùng chuỗi `$1`) để `$` trong tên biến không bị đọc thành mẫu thay thế.
      const next = out
        .replace(new RegExp(`(${JS_RECEIVER})\\.${esc}(?![\\w$])`, 'g'), (_m, recv: string) => recv + bracket)
        .replace(new RegExp(`\\?\\.${esc}(?![\\w$])`, 'g'), () => `?.${bracket}`);
      if (next !== out) { out = next; changed = true; }
    }
    if (!changed) break;
  }
  return out;
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

  // JSON/JSON Patch phải dịch bằng cây dữ liệu. Regex fallback trên JSON có thể thay cả enum,
  // ăn escape hoặc chèn nháy làm JSON.parse thất bại.
  const jsonResult = applyMvuToJsonText(text, variableDictionary);
  if (jsonResult !== null) return jsonResult;
  
  const entries = Object.entries(variableDictionary)
    .filter(([k, v]) => k && v && k !== v)
    .map(([k, v]) => [k, sanitizeMvuVarName(k, v)] as [string, string])
    .filter(([, v]) => !!v)
    .sort((a, b) => b[0].length - a[0].length);
  if (entries.length === 0) return text;
  
  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CRITICAL: Escape `$` in replacement strings to prevent regex replacement pattern
  // interpretation. Without this, `$1`, `$&`, `$'`, `$\`` in translated names
  // cause the replacement to eat surrounding code characters like `{`, `$`.
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');
  
  let newText = text;
  /** (bug 238) Tên đã dịch cần soát dot-access ở lượt cuối — xem {@link bracketizeDotAccess}. */
  const dotHealNames: string[] = [];
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

      // ── 5.8. (User 27/07 — việc 119) DOT-ACCESS: obj.KEY ──
      // Bản dịch NHIỀU TỪ mà thay trần sau dấu chấm là vỡ cú pháp JS:
      //     base.预言流言  →  base.Lời Tiên Tri Và Tin Đồn   ← "Missing } in template expression"
      // Cả <script> chết theo, mọi nút ẩn/hiện tê liệt (bug/119: đúng MỘT dòng thế này giết
      // nguyên giao diện). Phải chuyển sang bracket: base['Lời Tiên Tri Và Tin Đồn'].
      // Chỉ cần khi bản dịch KHÔNG phải identifier hợp lệ; ký tự đứng trước dấu chấm phải là
      // đuôi identifier/`]`/`)` để không đụng số thập phân hay chuỗi văn xuôi "xong. Rồi".
      const translatedIsIdentifier = /^[A-Za-z_$][\w$]*$/.test(translated);
      // Mục từ cả path (`A.B` → `X.Y`) không phải một property; để lượt cuối xử lý từng đoạn.
      if (!translatedIsIdentifier && !original.includes('.') && !translated.includes('.')) {
        const bracket = `['${safeTranslated.replace(/'/g, "\\'")}']`;
        // Dot thường: obj.KEY / arr[0].KEY / fn().KEY
        newText = newText.replace(
          new RegExp(`(${JS_RECEIVER})\\.${escaped}`, 'g'),
          `$1${bracket}`
        );
        // Optional chaining: obj?.KEY — dạng bracket đúng là obj?.['KEY'] (file bug/119 dòng 940:
        // detail.能量池?.当前值 — vá tầng đầu xong thì tầng sau đứng sau `?.`).
        newText = newText.replace(
          new RegExp(`\\?\\.${escaped}`, 'g'),
          `?.${bracket}`
        );
      }

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
      dotHealNames.push(translated);
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

  // (bug 238) Lượt CUỐI, chạy một lần trên cả đoạn: dọn dot-access nhiều tầng còn sót — kể cả
  // những chỗ vốn đã vỡ từ lượt dịch trước. Đặt ngoài vòng lặp để không phụ thuộc thứ tự từ điển.
  if (aggressive && dotHealNames.length > 0) {
    newText = bracketizeDotAccess(newText, dotHealNames);
  }

  // Tự lành path lai từ lượt cũ: `[Nhân Vật['Tuổi Tác']]` → `[Nhân Vật.Tuổi Tác]`.
  // Dùng chính target trong từ điển làm chứng cứ, không quét/đổi array expression JS tuỳ tiện.
  const normTarget = (s: string) => s.toLowerCase().replace(/\s*\.\s*/g, '.').replace(/[\s_-]+/g, ' ').trim();
  const targetMap = new Map(entries.map(([, target]) => [normTarget(target), target]));
  newText = normalizeHybridMvuPathTokens(newText, (name) => targetMap.get(normTarget(name)) ?? null, () => {});

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
 * (User yêu cầu 2026) ĐỒNG NHẤT TÊN BIẾN MVU trên TOÀN THẺ — non-AI, dùng cho:
 *  (a) sweep cuối pipeline sau khi dịch, và (b) nút bấm tay cho thẻ đã dịch trước bản vá.
 * Quy trình:
 *  1. Làm sạch dict về dạng chuẩn "Họ Tên" (enforceExactConsistency — bỏ `_`/`-`, gom cụm gần giống).
 *  2. Áp CJK-nguồn → dict sạch trên toàn thẻ (syncMvuVariables) — bắt biến còn tiếng Trung.
 *  3. Với TỪNG field code (tavern_helper / regex / lorebook entry): enforce tên biến ĐÃ DỊCH nhưng
 *     lệch dạng (Họ_Tên/Họ tên → Họ Tên) qua enforceInitvarCovariance (4 pass) + enforceVariableCasing
 *     + fixZodSyntaxErrors (bọc nháy key có space cho khỏi vỡ Zod).
 * Trả về thẻ mới + dict đã chuẩn + số field đã đổi.
 */
/**
 * (User 2026 — bug #8) SWEEP DICT-LESS: quét text, đổi mọi TỪ TIẾNG VIỆT-CÓ-DẤU bị nối bằng `_`/`-`
 * về dạng space theo unifyVarWordSeparators (Lưu_Tam_Bảo → Lưu Tam Bảo), rồi BỌC NHÁY các object key
 * JS/Zod không nháy vừa bị đổi thành có space (tránh SyntaxError). KHÔNG cần từ điển — chữa được card
 * đã nhiễm import vào (dict trống). Identifier thật (stat_data, evt_01, 场景_sfw, URL ASCII) không
 * dính vì quy tắc từ-Việt-có-dấu; đổi ĐỒNG LOẠT mọi chỗ nên card underscore-nhất-quán vẫn nhất quán.
 */
export function unifyVietnameseUnderscoresInText(text: string): { text: string; count: number } {
  if (typeof text !== 'string' || !text) return { text, count: 0 };
  let count = 0;
  let out = text.replace(
    /[$_]?[A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ0-9]*(?:[_-]+[A-Za-zÀ-ỹĐđ0-9][A-Za-zÀ-ỹĐđ0-9]*)+[_-]*|[A-Za-zÀ-ỹĐđ]+[_-]+(?=[\s,:'"\)\]\}]|$)/g,
    (w) => {
      if (!LATIN_DIACRITIC_RE.test(w)) return w; // từ thuần ASCII (stat_data, sfw_keywords) → giữ
      const u = unifyVarWordSeparators(w).replace(/[_-]+$/, (m) => (LATIN_DIACRITIC_RE.test(w) && !/\d/.test(w) ? '' : m));
      if (u !== w) count++;
      return u;
    },
  );
  // Bọc nháy key JS/Zod không nháy giờ CÓ space (sau `{`/`,`): { Giới Hạn Từ Bi: → { 'Giới Hạn Từ Bi':
  out = out.replace(
    /([{,]\s*)([A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ0-9]*(?: [A-Za-zÀ-ỹĐđ0-9]+)+)(\s*:)(?!:)/g,
    (m, prefix, key, colon) => (LATIN_DIACRITIC_RE.test(key) ? `${prefix}'${key}'${colon}` : m),
  );
  return { text: out, count };
}

export function recanonicalizeMvuInCard(
  card: CharacterCard,
  mvuDictionary: Record<string, string>,
  /**
   * (bug 232) Biến thể dịch lệch đã học được từ `fields` (nơi CÒN bản gốc để đối chiếu). Ruột thẻ
   * thì bản gốc đã bị ghi đè nên tự nó không suy ra được "Tiền bạc" là 钱财 — phải nhận từ ngoài.
   */
  variantAliases: Record<string, string> = {},
): { card: CharacterCard; dictionary: Record<string, string>; fixCount: number } {
  const { fixedDict } = enforceExactConsistency(mvuDictionary);
  const synced = syncMvuVariables(card, fixedDict);
  let fixCount = 0;

  const enforceCode = (text: unknown): string => {
    if (typeof text !== 'string' || !text) return text as string;
    // (bug #8) Sweep dict-less TRƯỚC — gom mọi biến thể `_` về space, kể cả khi dict trống/thiếu.
    let t = unifyVietnameseUnderscoresInText(text).text;
    t = enforceInitvarCovariance(t, fixedDict, false).text;
    t = enforceDictVariants(t, variantAliases).text;
    t = enforceVariableCasing(t, fixedDict).text;
    t = fixZodSyntaxErrors(t);
    if (t !== text) fixCount++;
    return t;
  };

  const data = synced.data;
  if (data) {
    // TavernHelper scripts (Zod schema, code)
    const th = data.extensions?.tavern_helper as any;
    const fixScript = (s: any) => {
      if (!s || typeof s !== 'object') return s;
      const r = { ...s };
      if (typeof r.content === 'string') r.content = enforceCode(r.content);
      if (typeof r.script === 'string') r.script = enforceCode(r.script);
      if (typeof r.code === 'string') r.code = enforceCode(r.code);
      return r;
    };
    if (th?.scripts && Array.isArray(th.scripts)) th.scripts = th.scripts.map(fixScript);
    else if (Array.isArray(th)) {
      for (const item of th) {
        if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) item[1] = item[1].map(fixScript);
        else if (item && typeof item === 'object' && !Array.isArray(item) && (item.content || item.script || item.code)) Object.assign(item, fixScript(item));
      }
    }
    const legacy = data.extensions?.TavernHelper_scripts as any;
    if (Array.isArray(legacy)) data.extensions!.TavernHelper_scripts = legacy.map(fixScript);

    // Regex scripts (HTML/UI code)
    // (bug 238) `findRegex` cũng phải theo từ điển: khối `<statusbar>` mà script bắt được thường
    // nêu thẳng tên biến, nên MẪU TÌM lệch một chữ hoa là regex không khớp gì và bảng trạng thái
    // trắng trơn — đúng "không đúng y chang ở regex" mà user báo. `syncMvuVariables` ở trên đã
    // dịch CJK→Việt trong findRegex rồi; chỉ riêng lượt ép hoa/thường + biến thể là bỏ sót nó.
    //
    // Ép HẸP HƠN `replaceString`: chỉ đổi TÊN BIẾN (casing + biến thể + path). Không chạy
    // `unifyVietnameseUnderscoresInText` (nó bọc nháy khoá sau `{`/`,` — mà `{`/`,` trong mẫu tìm
    // là lượng từ regex) và không chạy `fixZodSyntaxErrors` (`.default` → `.default()` là phá mẫu).
    const enforcePattern = (text: unknown): string => {
      if (typeof text !== 'string' || !text) return text as string;
      let t = enforceDictVariants(text, variantAliases).text;
      t = enforceVariableCasing(t, fixedDict).text;
      if (t !== text) fixCount++;
      return t;
    };
    if (data.extensions?.regex_scripts) {
      data.extensions.regex_scripts = data.extensions.regex_scripts.map((s) => ({
        ...s,
        findRegex: typeof s.findRegex === 'string' ? enforcePattern(s.findRegex) : s.findRegex,
        replaceString: typeof s.replaceString === 'string' ? enforceCode(s.replaceString) : s.replaceString,
      }));
    }

    // Lorebook entries (initvar / update-rules / controller)
    // (bug #8) Quét CẢ comment (tên entry hiển thị — "Quy_Tắc_Cập_Nhật_Biến") + keys (trigger
    // keyword) chứ không riêng content — card user còn 30 chỗ `_` trong comment + 2 trong keys.
    if (data.character_book?.entries) {
      data.character_book.entries = data.character_book.entries.map((e) => {
        const next = { ...e, content: enforceCode(e.content) };
        if (typeof (next as { comment?: unknown }).comment === 'string') {
          (next as { comment: string }).comment = unifyVietnameseUnderscoresInText((next as { comment: string }).comment).text;
        }
        if (Array.isArray(next.keys)) {
          next.keys = next.keys.map((k) => (typeof k === 'string' ? unifyVietnameseUnderscoresInText(k).text : k));
        }
        return next;
      });
    }
  }

  return { card: synced, dictionary: fixedDict, fixCount };
}

/**
 * (User yêu cầu 2026) Bản field-level của {@link recanonicalizeMvuInCard} — dùng cho phiên DỊCH
 * đang chạy (bản dịch nằm ở `fields`, chưa bake vào card). Làm sạch dict rồi enforce lại giá trị
 * `translated` của MỌI field code/lorebook đã 'done'. Trả về mảng field mới + dict sạch + số field đổi.
 * Dùng chung ở: sweep cuối pipeline (useTranslation) và nút "Đồng nhất tên biến MVU".
 */
/* ═══════════════════════════════════════════════════════════════════════════
   (bug 232) BIẾN THỂ DỊCH LỆCH — ĐỐI CHIẾU BẢN GỐC MỚI BIẾT "Tiền bạc" LÀ 钱财
   ═══════════════════════════════════════════════════════════════════════════
   User: từ điển ghi 钱财 → "Tiền Tài", nhưng bản dịch ra "Tiền bạc" ở chỗ này, "Tiền tài" ở chỗ
   kia; bấm áp dụng chỉ sửa được 50~70%.

   Phần "Tiền tài" là lệch HOA/THƯỜNG — `enforceVariableCasing` lo (xem Pass 7b). Phần "Tiền bạc"
   thì ép casing KHÔNG BAO GIỜ cứu được, vì nó chuẩn hoá hoa/thường chứ không biết hai từ khác
   nhau lại cùng chỉ một biến. Muốn biết điều đó thì phải nhìn BẢN GỐC: ở đúng vị trí đó bản gốc
   ghi 钱财, mà từ điển bảo 钱财 = "Tiền Tài" ⇒ "Tiền bạc" là bản dịch lệch của chính biến ấy.

   Bộ học ánh xạ theo vị trí vốn ĐÃ CÓ (`extractMappingFromTranslatedInitvar`) nhưng chỉ soi
   initvar/controller/mvu_logic — trong khi chứng cứ user gửi nằm ở tavernHelper (schema zod) và
   regex (thanh trạng thái). Nên nó không bao giờ nhìn thấy chỗ hỏng.

   Hai hàm dưới đây: HỌC biến thể từ mọi field CODE có cả gốc lẫn dịch, rồi ÉP biến thể đó ở mọi
   field code khác — kể cả field mà một mình nó không đủ căn cứ để tự suy ra. */

/** Mọi chuỗi trong nháy, THEO THỨ TỰ, KHÔNG gộp trùng (gộp là lệch vị trí). */
function extractQuotedLiteralsOrdered(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const out: string[] = [];
  for (const m of text.matchAll(/(['"])((?:[^'"\n\\])*)\1/g)) out.push(m[2]);
  return out;
}

const normVarName = (s: string) => s.toLowerCase().normalize('NFC').replace(/[\s_-]+/g, ' ').trim();

/**
 * Học các BIẾN THỂ dịch lệch: `bản-dịch-AI-đã-viết` → `giá trị trong từ điển`.
 * Chỉ nhận khi số chuỗi hai bên KHỚP NHAU — lệch một cái là mất căn cứ vị trí, thà không sửa còn
 * hơn đoán bừa rồi ghi đè lên một giá trị hợp lệ.
 */
/* ═══════════════════════════════════════════════════════════════════════════
   (bug 232 — lượt 2) LUẬT CHUNG: TỪ ĐIỂN LÀ CHÂN LÝ, TÊN PHẢI SUY RA ĐƯỢC TỪ BẢN GỐC
   ═══════════════════════════════════════════════════════════════════════════
   User: "cậu chỉ sửa cho case tiền tài/tiền bạc. Phải có rule hay logic nào fix triệt để chứ,
   lần sau card khác không còn bị bug kiểu này nữa."

   Đúng. Đo lại trên THẺ THẬT của user (cặp PNG gốc + JSON đã dịch), bản vá lượt 1 hụt ở hai chỗ,
   và cả hai đều là lỗ hổng NGUYÊN TẮC:

     1. BỎ NGUYÊN TRƯỜNG KHI SỐ TÊN LỆCH. Lượt 1 chỉ ghép vị trí khi số chuỗi hai bên bằng nhau.
        Đo được 31/71 trường (44%) có số tên lệch — AI thêm/bớt một chuỗi là cả trường mất trắng
        cơ hội được sửa.
     2. CHỈ KHỚP KHI CẢ TÊN ĐÚNG BẰNG MỤC TỪ ĐIỂN. Thực tế thuật ngữ nằm LỒNG trong tên dài hơn:
          模块二_蝴蝶效应 → "Mô đun 2_Hiệu ứng cánh bướm"   (từ điển: 蝴蝶效应 → Hiệu Ứng Hồ Điệp)
          业务能力曲线    → "Đường cong năng lực nghiệp vụ"  (từ điển: 业务能力 → Năng Lực Nghiệp Vụ)

   Nguyên tắc thay cho việc vá từng ca: BẢN DỊCH CỦA MỘT CÁI TÊN PHẢI SUY RA ĐƯỢC TỪ BẢN GỐC +
   TỪ ĐIỂN. Tên gốc chứa thuật ngữ nào thì bản dịch phải mang đúng bản dịch của thuật ngữ ấy — dù
   nó nằm giữa tên, và dù chỗ khác trong trường có lệch nhịp. Không còn phụ thuộc trí nhớ mô hình. */

/** Vị trí một cái TÊN trong text (khoá YAML/object, hoặc chuỗi trong nháy). */
interface NameSlot { value: string; start: number; end: number }

/**
 * Quét mọi VỊ TRÍ TÊN theo đúng thứ tự tài liệu, không chồng lấn.
 * Chuỗi trong nháy quét trước; khoá không nháy chỉ nhận khi không nằm đè lên chuỗi nào.
 */
function collectNameSlots(text: string): NameSlot[] {
  const slots: NameSlot[] = [];
  const taken: Array<[number, number]> = [];

  for (const m of text.matchAll(/(['"])([^'"\n]{1,80})\1/g)) {
    const inner = m[2];
    const start = m.index + 1;
    slots.push({ value: inner, start, end: start + inner.length });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/^[ \t]*([^"':\s\n][^"':\n]*?)\s*:/gm)) {
    const raw = m[1];
    const start = m.index + m[0].indexOf(raw);
    if (taken.some(([a, b]) => start >= a && start < b)) continue;
    slots.push({ value: raw, start, end: start + raw.length });
  }
  return slots.sort((a, b) => a.start - b.start);
}

const normName = (s: string) => s.toLowerCase().normalize('NFC').replace(/[\s_-]+/g, ' ').trim();
const hasCjkChar = (s: string) => /[一-鿿]/.test(s);

/**
 * Thay MỌI thuật ngữ của từ điển có mặt trong một cái tên, ưu tiên khớp DÀI NHẤT trước —
 * nếu không thì 关系 sẽ ăn mất 关系簿 và ra bản dịch sai.
 */
function applyDictToName(name: string, sortedKeys: string[], dict: Record<string, string>): string {
  let out = name;
  for (const k of sortedKeys) {
    if (!out.includes(k)) continue;
    out = out.split(k).join(dict[k]);
  }
  return out;
}

/**
 * Tách một cái tên theo dấu ngăn CẤU TRÚC để ghép từng khúc — dùng khi từ điển chỉ phủ MỘT PHẦN.
 * CỐ Ý không tách theo khoảng trắng: tiếng Trung không có dấu cách còn tiếng Việt thì có, tách
 * theo khoảng trắng là hai bên ra số khúc khác nhau ngay lập tức.
 */
const SEP_SPLIT = /([_·|/()[\]{}<>,;、。→]+)/;
const splitTokens = (s: string) => s.split(SEP_SPLIT);

/** Khoảng mã nằm GIỮA các tên: seg[i] đứng trước tên i, seg[n] là phần đuôi. */
function segmentsAround(text: string, slots: NameSlot[]): string[] {
  const segs: string[] = [];
  let prev = 0;
  for (const s of slots) { segs.push(text.slice(prev, s.start)); prev = s.end; }
  segs.push(text.slice(prev));
  return segs;
}

// Chỉ đổi xuống dòng thành một dấu neo, KHÔNG gộp khoảng trắng và KHÔNG cắt hai đầu: với khoá
// YAML thì khung mã sau nó chỉ là ':' + thụt lề, gộp/cắt đi là mất sạch thứ để phân biệt.
const normSeg = (s: string) => s.replace(new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n', 'g'), '⏎');

/**
 * Ghép hai danh sách tên. Ba tầng, tầng sau chỉ chạy cho phần tầng trước chưa giải được.
 *
 * Bản vá lượt 1 sai ở chỗ đòi hai bên có ĐÚNG BẰNG NHAU số tên rồi mới ghép — AI thêm/bớt một
 * chuỗi là bỏ cả trường (đo trên thẻ thật: 44% số trường rơi vào cảnh này).
 *
 * Còn cách ghép thuần theo "khung mã xung quanh" cũng không đủ: với field lorebook thì GIÁ TRỊ
 * cũng được dịch, nên đoạn mã sau một cái tên ở bản gốc là tiếng Trung còn ở bản dịch là tiếng
 * Việt — không bao giờ bằng nhau. Đo được: field 51 tên chỉ ghép nổi 8 cặp.
 *
 *   Tầng 1 — MỎ NEO: cặp mà bản dịch ĐÃ ĐÚNG (bằng đúng kết quả áp từ điển lên tên gốc) hoặc hai
 *            bên giống hệt (số, mã, tên không cần dịch). Chạy LCS để giữ đúng thứ tự.
 *   Tầng 2 — LẤP KHOẢNG THEO VỊ TRÍ: giữa hai mỏ neo, nếu hai bên còn ĐÚNG BẰNG NHAU số tên thì
 *            ghép theo thứ tự. Luật cấm sắp xếp lại code nên thứ tự khoá là bất biến.
 *   Tầng 3 — DÒ THEO KHUNG MÃ: khoảng nào lệch số lượng (chính là chỗ AI thêm/bớt) thì dò bằng
 *            chữ ký khung mã ngay sau tên, độ dài thích ứng, và CHỈ nhận khi duy nhất một chỗ khớp.
 */
function alignNamesByCodeShape(
  original: string,
  translated: string,
  orig: NameSlot[],
  trans: NameSlot[],
  expected: string[],
): Array<[number, number]> {
  const n = orig.length, m = trans.length;
  if (n === 0 || m === 0 || n * m > 400_000) return [];

  const os = segmentsAround(original, orig).map(normSeg);
  const ts = segmentsAround(translated, trans).map(normSeg);
  const already = (i: number, j: number) =>
    normName(expected[i]) === normName(trans[j].value) || orig[i].value === trans[j].value;

  /* ── Tầng 1: mỏ neo ── */
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = already(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const anchors: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (already(i, j)) { anchors.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  /* ── Tầng 2 + 3: lấp từng khoảng giữa các mỏ neo ── */
  const pairs: Array<[number, number]> = [...anchors];
  const SIG_LENGTHS = [14, 10, 7, 5, 4];
  const fillGap = (i0: number, i1: number, j0: number, j1: number) => {
    const gapO = i1 - i0, gapT = j1 - j0;
    if (gapO <= 0 || gapT <= 0) return;
    if (gapO === gapT) {                       // tầng 2
      for (let k = 0; k < gapO; k++) pairs.push([i0 + k, j0 + k]);
      return;
    }
    for (let i = i0; i < i1; i++) {            // tầng 3
      for (const len of SIG_LENGTHS) {
        const sig = (os[i + 1] ?? '').slice(0, len);
        if (sig.length < 4) break;
        const cands: number[] = [];
        for (let j = j0; j < j1; j++) if ((ts[j + 1] ?? '').slice(0, len) === sig) cands.push(j);
        if (cands.length === 0) continue;      // chữ ký dài quá vì khoá kế bên đổi → rút ngắn
        if (cands.length > 1) break;           // nhiều chỗ khớp như nhau → mơ hồ, không đoán bừa
        pairs.push([i, cands[0]]);
        break;
      }
    }
  };
  let pi = 0, pj = 0;
  for (const [ai, aj] of [...anchors, [n, m] as [number, number]]) {
    fillGap(pi, ai, pj, aj);
    pi = ai + 1; pj = aj + 1;
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}

export function enforceDictOnAlignedNames(
  original: string,
  translated: string,
  mvuDictionary: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  const fixes: { found: string; replaced: string }[] = [];
  if (!original || !translated || typeof original !== 'string' || typeof translated !== 'string') {
    return { text: translated, fixes };
  }
  const sortedKeys = Object.keys(mvuDictionary)
    .filter(k => k && hasCjkChar(k) && mvuDictionary[k]?.trim())
    .sort((a, b) => b.length - a.length);
  if (sortedKeys.length === 0) return { text: translated, fixes };

  const origSlots = collectNameSlots(original);
  const transSlots = collectNameSlots(translated);
  if (origSlots.length === 0 || transSlots.length === 0) return { text: translated, fixes };

  const expected = origSlots.map(s => applyDictToName(s.value, sortedKeys, mvuDictionary));
  const pairs = alignNamesByCodeShape(original, translated, origSlots, transSlots, expected);

  // Gom sửa đổi theo offset rồi áp từ CUỐI về ĐẦU để offset không xê dịch.
  // Tên nào ĐANG LÀ một bản dịch hợp lệ của mục từ điển KHÁC thì cấm ghi đè: ghép nhầm mà xoá
  // mất một tên biến vốn đã đúng là làm hỏng thẻ, tệ hơn hẳn việc bỏ sót một chỗ chưa đồng nhất.
  const validTargets = new Set(
    Object.values(mvuDictionary).filter(v => v?.trim()).map(normName),
  );

  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const [i, j] of pairs) {
    const o = origSlots[i].value;
    if (!sortedKeys.some(k => o.includes(k))) continue;   // không có bằng chứng thì không đụng
    const want = expected[i];
    const got = transSlots[j].value;
    if (normName(got) !== normName(want) && validTargets.has(normName(got))) continue;

    if (!hasCjkChar(want)) {
      // Từ điển phủ TRỌN tên → biết chính xác bản dịch phải là gì.
      //
      // Nhưng phải GIỮ NGUYÊN dấu đầu dòng của chính bản dịch. Bộ quét có lúc bắt tên gốc kèm
      // `- ` (khoá YAML) trong khi bên bản dịch lại bắt phần trong nháy không kèm dấu — dán
      // nguyên `want` vào là đẻ ra `- - Tên`, hỏng cấu trúc YAML. Lấy phần LÕI của want rồi ghép
      // lại đúng dấu đầu dòng mà bản dịch đang có.
      const LEAD = /^[\s\-*•·]+/;
      const core = want.replace(LEAD, '');
      const replacement = (got.match(LEAD)?.[0] ?? '') + core;
      if (normName(replacement) !== normName(got)) {
        edits.push({ start: transSlots[j].start, end: transSlots[j].end, text: replacement });
        fixes.push({ found: got, replaced: replacement });
      }
      continue;
    }

    // ─── Từ điển phủ MỘT PHẦN tên ───
    // (1) Ghép từng khúc theo dấu ngăn cấu trúc: `模块二_蝴蝶效应` ↔ `Mô đun 2_Hiệu ứng cánh bướm`
    //     tách ra 3 khúc đều nhau, khúc nào từ điển biết chắc thì ép, khúc còn lại giữ nguyên
    //     bản dịch của AI.
    const ot = splitTokens(o), gt = splitTokens(got);
    let merged = got;
    let changed = false;
    if (ot.length === gt.length) {
      const next = gt.map((seg, k) => {
        const src = ot[k];
        if (!src || !sortedKeys.some(x => src.includes(x))) return seg;
        const w = applyDictToName(src, sortedKeys, mvuDictionary);
        if (hasCjkChar(w) || normName(w) === normName(seg)) return seg;
        changed = true;
        return w;
      });
      if (changed) merged = next.join('');
    }
    // (2) Không tách được đều khúc (vd `业务能力曲线` ↔ `Đường cong năng lực nghiệp vụ` — tiếng
    //     Việt đảo trật tự từ) thì KHÔNG đoán chỗ chèn. Nhưng nếu bản dịch của thuật ngữ đã nằm
    //     sẵn trong tên chỉ khác HOA/THƯỜNG thì vẫn gom về đúng dạng từ điển — việc này an toàn
    //     tuyệt đối vì không đổi một chữ nào, chỉ đổi kiểu chữ.
    for (const k of sortedKeys) {
      if (!o.includes(k)) continue;
      const want = mvuDictionary[k];
      const idx = merged.toLowerCase().indexOf(want.toLowerCase());
      if (idx < 0) continue;
      const at = merged.slice(idx, idx + want.length);
      if (at === want) continue;
      merged = merged.slice(0, idx) + want + merged.slice(idx + want.length);
      changed = true;
    }
    if (changed) {
      edits.push({ start: transSlots[j].start, end: transSlots[j].end, text: merged });
      fixes.push({ found: got, replaced: merged });
    }
  }

  if (edits.length === 0) return { text: translated, fixes };
  edits.sort((a, b) => b.start - a.start);
  let out = translated;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, fixes };
}

export function buildDictVariantAliases(
  fields: { original?: string; translated?: string; status?: string; group?: string; entryType?: string }[],
  mvuDictionary: Record<string, string>,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  const canonicalSet = new Set(
    Object.values(mvuDictionary).filter(v => v && v.trim()).map(normVarName),
  );
  if (canonicalSet.size === 0) return aliases;

  const learnPair = (orig: string, trans: string) => {
    // Từ điển user có thể chốt cả dạng PATH ("财务.钱财") lẫn từng đoạn rời — thử nguyên chuỗi
    // trước, không có mới tách theo dấu chấm.
    const os = mvuDictionary[orig.trim()] ? [orig] : orig.split('.');
    const ts = os.length === 1 ? [trans] : trans.split('.');
    if (os.length !== ts.length) return;
    for (let k = 0; k < os.length; k++) {
      const wanted = mvuDictionary[os[k].trim()];
      if (!wanted || !wanted.trim()) continue;
      const got = ts[k].trim();
      const gotNorm = normVarName(got);
      if (!gotNorm || gotNorm === normVarName(wanted)) continue;
      // Bỏ qua rác: quá ngắn, thuần số, hoặc trùng một tên biến ĐÚNG khác trong từ điển (ánh xạ
      // tên đúng này sang tên đúng kia là phá dữ liệu, không phải sửa).
      if (gotNorm.length < 2 || /^[\d\s.,%+-]+$/.test(gotNorm)) continue;
      if (canonicalSet.has(gotNorm)) continue;
      aliases[gotNorm] = wanted;
    }
  };

  for (const f of fields) {
    if (f.status !== 'done' || !f.original || !f.translated) continue;
    const isCode =
      f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic' || f.entryType === 'rules' ||
      f.group === 'regex' || f.group === 'tavern_helper';
    if (!isCode) continue;

    for (const [ol, tl] of [
      [extractQuotedLiteralsOrdered(f.original), extractQuotedLiteralsOrdered(f.translated)],
      [extractYamlKeysOrdered(f.original), extractYamlKeysOrdered(f.translated)],
      [extractMacroVarNamesOrdered(f.original), extractMacroVarNamesOrdered(f.translated)],
    ] as [string[], string[]][]) {
      if (ol.length === 0 || ol.length !== tl.length) continue;
      for (let i = 0; i < ol.length; i++) learnPair(ol[i], tl[i]);
    }
  }
  return aliases;
}

/** Ép các biến thể đã học vào ĐÚNG VỊ TRÍ TÊN BIẾN (chuỗi trong nháy, khoá YAML, macro). */
export function enforceDictVariants(
  text: string,
  aliases: Record<string, string>,
): { text: string; fixes: { found: string; replaced: string }[] } {
  const fixes: { found: string; replaced: string }[] = [];
  if (!text || typeof text !== 'string' || Object.keys(aliases).length === 0) {
    return { text, fixes: [] };
  }
  const hit = (seg: string): string | null => {
    const canonical = aliases[normVarName(seg)];
    // (bug 238) So `!== seg.trim()`: đoạn `" Tiền bạc"` (thừa khoảng trắng sau dấu chấm) vẫn phải
    // được nhận là tên biến để `canonicalizeDotPath` dán lại cho sạch.
    return canonical && canonical !== seg.trim() ? canonical : null;
  };
  const note = (found: string, replaced: string) => {
    if (!fixes.some(f => f.found === found)) fixes.push({ found, replaced });
  };

  let result = text;

  // (bug 238) PATH MVU — `[Nhân Vật Chính.Sổ Ghi Nhớ]` trong văn quy tắc và macro có path. Biến
  // thể NHÓM 2 ("Sổ Ghi Nhớ" thay vì "Bản Ghi Nhớ") nằm rải rác đúng ở những chỗ này, mà ba pass
  // dưới chỉ soi nháy / khoá YAML / macro một đoạn nên không thấy.
  result = enforceMvuPathTokens(result, (seg) => aliases[normVarName(seg)] ?? null, note);

  // Chuỗi trong nháy (tách theo dấu chấm để bắt cả path 'Tài Chính.Tiền bạc').
  result = result.replace(/(['"])((?:[^'"\n\\])*)\1/g, (match, quote, inner: string) => {
    if (!inner || inner.length < 2) return match;
    // (bug 238) `canonicalizeDotPath` dán lại bằng đúng một dấu chấm — không giữ khoảng trắng
    // quanh dấu chấm, vì `' Tiền Tài'` là một khoá khác với `'Tiền Tài'` khi `_.get` tra.
    const res = canonicalizeDotPath(inner, (seg) => hit(seg));
    if (!res.changed) return match;
    for (const h of res.hits) note(h.found, h.replaced);
    return `${quote}${res.text}${quote}`;
  });

  // Khoá YAML/JS đầu dòng — `Tiền bạc: 5000`.
  result = result.replace(/^(\s*)(["']?)([^"':\n]+?)(["']?)(\s*:)/gm, (match, indent, q1, key, q2, colon) => {
    const canonical = hit(String(key).trim());
    if (!canonical) return match;
    note(String(key).trim(), canonical);
    return `${indent}${q1}${canonical}${q2}${colon}`;
  });

  // Macro {{getvar::Tiền bạc}}
  result = result.replace(
    /(\{\{(?:get|set|add)(?:global)?var::\s*)([^:}]+)(}}|::)/g,
    (match, prefix, name: string, suffix) => {
      const canonical = hit(name.trim());
      if (!canonical) return match;
      note(name.trim(), canonical);
      return `${prefix}${canonical}${suffix}`;
    },
  );

  return { text: result, fixes };
}

export function recanonicalizeMvuInFields(
  fields: TranslationField[],
  mvuDictionary: Record<string, string>,
  keyMetadata?: Record<string, { confidence?: string; keyType?: string }>,
  /**
   * (User 19/07 — bug "dịch đúng rồi tự sửa thành sai") Bỏ qua field VĂN XUÔI (lorebook/
   * lorebook_keys), chỉ sweep field CODE. Dùng cho Chế độ Đồng Nhân: từ điển biến MVU (do AI
   * dịch tên biến sinh ra, dễ ra "Tuyết Nãi") KHÔNG phải nguồn chân lý cho tên nhân vật trong
   * văn xuôi — để nó quét narrative là ghi đè ngược lên bản dịch tên đã đúng ở cuối lượt dịch.
   */
  skipNarrative = false,
  /**
   * (bug 232) Có được CHUẨN HOÁ chính từ điển không. Khi user bật 🔒 Khoá từ điển thì KHÔNG —
   * dict của họ là chân lý, kể cả khi họ cố ý giữ `_`. Vẫn phải ÉP dict đó lên bản dịch; hai
   * việc này là hai việc khác nhau, gộp làm một chính là lỗi của bản cũ.
   */
  normalizeDict = true,
): { fields: TranslationField[]; dictionary: Record<string, string>; fixCount: number; variantAliases: Record<string, string> } {
  const fixedDict = normalizeDict
    ? enforceExactConsistency(mvuDictionary, keyMetadata as any).fixedDict
    : mvuDictionary;
  // (bug 232) HỌC biến thể dịch lệch TRƯỚC, trên TOÀN BỘ field — vì field biết sự thật (bản gốc
  // có 钱财 ở đúng vị trí đó) và field bị lệch thường KHÔNG phải cùng một field.
  const variantAliases = buildDictVariantAliases(fields as never, fixedDict);
  let fixCount = 0;
  const out = fields.map((f) => {
    if (f.status !== 'done' || typeof f.translated !== 'string' || !f.translated) return f;
    const isCode =
      f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic' || f.entryType === 'rules' ||
      f.group === 'regex' || f.group === 'tavern_helper';
    // (bug #8) Gồm cả lorebook_keys — trigger keyword nhiễm `_` khi export sẽ đè lên card đã sửa.
    const isLbNarr = (f.group === 'lorebook' || f.group === 'lorebook_keys') && !isCode;
    if (!isCode && !isLbNarr) return f;
    if (isLbNarr && skipNarrative) return f;

    // JSON có luồng riêng hoàn toàn: parse → căn key/path → stringify. Thoát sớm để JSON không
    // bao giờ đi qua regex chuyên cho YAML/Zod/JS (vừa chậm vừa có thể đổi enum hoặc nháy).
    const structuredJson = alignMvuJsonFromOriginal(f.original || '', f.translated, fixedDict)
      ?? applyMvuToJsonText(f.translated, fixedDict);
    if (structuredJson !== null) {
      if (structuredJson === f.translated) return f;
      fixCount++;
      return { ...f, translated: structuredJson };
    }

    // Ép trực tiếp tên NGUỒN → tên chuẩn trước các lượt covariance. Đây là lưới an toàn cho
    // ca AI đã dịch một số lần xuất hiện nhưng còn sót số khác (ví dụ vừa có 年龄 vừa có
    // Tuổi Tác), cũng như access lai `Nhân Vật['Tuổi Tác']`. Văn xuôi chỉ áp trong macro/
    // cấu trúc xác định; field code mới được phép thay mạnh toàn bộ.
    let t = applyMvuToText(f.translated, fixedDict, isCode);
    // (bug #8) Sweep dict-less — Lưu_Tam_Bảo → Lưu Tam Bảo kể cả khi dict trống/thiếu key.
    t = unifyVietnameseUnderscoresInText(t).text;
    t = enforceInitvarCovariance(t, fixedDict, isLbNarr).text;
    // (bug 232) Biến thể chỉ ép ở field CODE. Văn xuôi thì "Tiền bạc" có thể là chữ dùng thật
    // trong truyện, ép sang tên biến ở đó là sửa hỏng bản dịch chứ không phải đồng nhất biến.
    if (isCode) {
      // (bug 232 lượt 2) LUẬT CHÍNH, chạy TRƯỚC: ép theo BẢN GỐC + từ điển. Đây là cửa duy nhất
      // biết chắc "tên này lẽ ra phải là gì", kể cả khi thuật ngữ nằm lồng trong tên dài hơn và
      // kể cả khi số tên hai bên lệch nhau.
      if (typeof f.original === 'string' && f.original) {
        t = enforceDictOnAlignedNames(f.original, t, fixedDict).text;
      }
      // Biến thể học được từ field KHÁC — dọn nốt những chỗ mà chính field này không đủ căn cứ.
      t = enforceDictVariants(t, variantAliases).text;
    }
    t = enforceVariableCasing(t, fixedDict).text;
    if (isCode) t = fixZodSyntaxErrors(t);
    if (isCode && f.original) t = restoreEmptyMvuBracketAccess(f.original, t, fixedDict).text;

    if (t === f.translated) return f;
    fixCount++;
    return { ...f, translated: t };
  });
  return { fields: out, dictionary: fixedDict, fixCount, variantAliases };
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
/**
 * (bug 213) Gom mọi chuỗi ĐANG ĐỨNG Ở VỊ TRÍ TÊN BIẾN trong một đoạn text.
 *
 * Dùng làm chứng cứ cho Pass 5: chỉ khi một literal cũng xuất hiện ở đây thì nó mới đáng được
 * fuzzy-match theo từ điển; còn lại phải khớp chính xác mới đụng vào. Đây là ranh giới giữa
 * "sửa tên biến bị dịch lệch" (đúng việc) và "ghi đè giá trị enum hợp lệ" (phá code âm thầm).
 */
export function collectNameLikeLiterals(text: string): Set<string> {
  const out = new Set<string>();
  const add = (s?: string) => { const t = s?.trim(); if (t) out.add(t.toLowerCase()); };
  // {{getvar::TÊN}}, {{setglobalvar::TÊN::...}}
  for (const m of text.matchAll(/(?:get|set|add)(?:global)?var::\s*([^:}]+)/g)) add(m[1]);
  // obj['TÊN'] / obj["TÊN"]
  for (const m of text.matchAll(/\[\s*['"]([^'"]+)['"]\s*\]/g)) add(m[1]);
  // stat_data.TÊN / data.TÊN / variables.TÊN
  for (const m of text.matchAll(/(?:stat_data|data|variables)\.([^\s.,;:'")\]}]+)/g)) add(m[1]);
  // khoá YAML `TÊN:` đầu dòng
  for (const m of text.matchAll(/^\s*(?:["']([^"':\n]+)["']|([^"':\s\n][^"':\n]*[^"':\s\n]))\s*:/gm)) add(m[1] || m[2]);
  return out;
}

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

  // (bug 213) MEMO cho findClosestDictValue. Mỗi lần gọi là một lượt Levenshtein QUÉT TRỌN từ điển;
  // hàm này chạy cho từng dòng YAML lệch dict, từng macro, từng path, từng phép so sánh — mà tên
  // khoá lặp lại rất nhiều trong initvar (map lồng dùng đi dùng lại cùng bộ khoá). Với initvar
  // nghìn dòng + dict vài trăm mục thì đây là hàng giây block main thread cho MỖI field code, và
  // recanonicalize gọi nó cho MỌI field. `strict` cố định trong một lượt gọi nên cache theo khoá
  // là chính xác. Cùng loại thuốc đã dùng cho extractZodDescriptions (bug 39c) và filterDictByText.
  const closestCache = new Map<string, string | null>();
  const closest = (key: string): string | null => {
    const hit = closestCache.get(key);
    if (hit !== undefined) return hit;
    const val = findClosestDictValue(key, mvuDictionary, strict);
    closestCache.set(key, val);
    return val;
  };

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
    const correctValue = closest(yamlKey);
    if (correctValue && correctValue !== yamlKey) {
      // Build a regex that replaces this specific YAML key occurrence
      const escaped = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyRegex = new RegExp(
        `^(\\s*)([\"']?)${escaped}([\"']?)(\\s*:)`,
        'gm'
      );
      // (User yêu cầu 2026) An toàn cú pháp: nếu tên chuẩn CÓ SPACE (vd "Họ Tên") mà key gốc là BARE
      // identifier (không nháy — vd Zod `{ Họ_Tên: z.string() }`), phải BỌC NHÁY '…' để không vỡ cú
      // pháp JS. Nháy đơn hợp lệ ở cả YAML lẫn JS/Zod.
      const valNeedsQuote = /\s/.test(correctValue);
      const newText = result.replace(keyRegex, (_m: string, indent: string, q1: string, q2: string, colon: string) => {
        if (valNeedsQuote && !q1 && !q2) return `${indent}'${correctValue}'${colon}`;
        return `${indent}${q1}${correctValue}${q2}${colon}`;
      });
      if (newText !== result) {
        result = newText;
        fixes.push({ found: yamlKey, replaced: correctValue });
      }
    }
  }

  // ─── Pass 2: Macro variable covariance ───
  // Fix {{getvar::KEY}} / {{setvar::KEY::}} where KEY is a mismatched translation
  //
  // (bug 238) Macro có PATH được tách theo dấu chấm TRƯỚC — giống Pass 4 (getvar) và Pass 6
  // (_.get) vốn đã làm vậy từ lâu. Bỏ sót ở đây không chỉ là "không sửa được": vòng dưới tra fuzzy
  // NGUYÊN chuỗi, và nhánh so-khớp-chuỗi-con của `findClosestDictValue` chỉ cần tỉ lệ > 0.85 — nên
  // một path kiểu `Ngày.Thời Gian Hiện Tại` có thể bị đổi thẳng thành `Thời Gian Hiện Tại`, ăn mất
  // đoạn cha mà không báo gì. Tách trước là chặn luôn ca đó.
  result = result.replace(
    /(\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)([^:}\n]*\.[^:}\n]*)(}}|::)/g,
    (match, prefix: string, name: string, suffix: string) => {
      const res = canonicalizeDotPath(name, (seg) => {
        if (!seg || seg.length < 2) return null;
        if (originalToTranslated.has(seg)) return null;               // còn chữ gốc — applyMvuToText lo
        if (translatedToOriginal.has(seg.toLowerCase())) return seg;  // đã đúng — giữ nguyên
        return closest(seg);
      });
      if (!res.changed) return match;
      for (const h of res.hits) {
        if (!fixes.some(f => f.found === h.found)) fixes.push(h);
      }
      return `${prefix}${res.text}${suffix}`;
    },
  );

  const macroRegex = /(\{\{(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar)::)([^:}]+)(}}|::)/g;
  let macroMatch;
  const macroFixes: { from: string; to: string }[] = [];
  while ((macroMatch = macroRegex.exec(result)) !== null) {
    const varName = macroMatch[2].trim();
    if (!varName) continue;
    // (bug 238) Path đã do enforceMvuPathTokens lo theo từng đoạn — đừng cho fuzzy nguyên chuỗi.
    if (varName.includes('.')) continue;
    // Skip if already correct
    if (translatedToOriginal.has(varName.toLowerCase())) continue;
    // Skip if it's still a CJK original
    if (originalToTranslated.has(varName)) continue;

    const correctValue = closest(varName);
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

    const correctValue = closest(varName);
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

      const correctValue = closest(seg);
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
  //
  // (bug 213) Đây là chỗ MẬP MỜ NHẤT trong cả hàm: chuỗi trong `=== '...'` / `case '...'` có thể
  // là TÊN BIẾN (đáng ép theo từ điển) mà cũng rất có thể là GIÁ TRỊ enum hợp lệ (tuyệt đối không
  // được đụng). Trước đây nó gọi fuzzy Levenshtein y như các pass khác, nên `case 'Hảo Tâm':` —
  // một giá trị hợp lệ, cách "Hảo Cảm" đúng 2 ký tự và dài 7 nên lọt ngưỡng dist ≤ 2 — bị ghi đè
  // thành `case 'Hảo Cảm':`. So sánh sai âm thầm: không lỗi cú pháp, không cảnh báo, chỉ lộ ra
  // lúc chơi khi nhánh đó không bao giờ khớp nữa.
  //
  // Giờ chỉ sửa khi CÓ CHỨNG CỨ chuỗi đó thật sự là tên biến:
  //   (a) khớp CHÍNH XÁC (sau chuẩn hoá hoa/thường, gạch dưới) một giá trị trong từ điển — an
  //       toàn tuyệt đối, không phải đoán; HOẶC
  //   (b) đúng chuỗi đó còn xuất hiện ở vị trí TÊN BIẾN trong CÙNG văn bản (getvar::X, data.X,
  //       obj['X'], hay khoá YAML `X:`) — lúc đó nó đúng là tên và fuzzy mới được phép.
  const nameLikeLiterals = collectNameLikeLiterals(result);
  const compRegex = /((?:===|!==|==|!=|case)\s*['"])([^'"]+)(['"])/g;
  result = result.replace(compRegex, (match, prefix, inner, suffix) => {
    if (!inner || inner.length < 2) return match;
    if (translatedToOriginal.has(inner.toLowerCase())) return match;
    if (originalToTranslated.has(inner)) return match;

    const exactValue = findClosestDictValue(inner, mvuDictionary, true);
    const correctValue = exactValue
      ?? (nameLikeLiterals.has(inner.trim().toLowerCase())
        ? closest(inner)
        : null);
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

      const correctValue = closest(seg);
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

      const correctValue = closest(val);
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

  // (User 2026 — bug #8) Khoá tra cứu CHUẨN HOÁ: lowercase + gộp mọi `_`/`-`/space về 1 space.
  // Trước chỉ lowercase → "Giới_Hạn_Từ_Bi" không khớp dict "Giới Hạn Từ Bi" nên casing/separator
  // lệch dict KHÔNG được ép lại. Giờ mọi biến thể separator đều quy về đúng dạng trong từ điển.
  const normVar = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const canonicalMap = new Map<string, string>();
  for (const [, trans] of Object.entries(mvuDictionary)) {
    if (trans && trans.trim()) {
      const norm = normVar(trans);
      // If there are multiple entries with same normalized form, prefer longer one
      if (!canonicalMap.has(norm) || trans.length > (canonicalMap.get(norm)?.length || 0)) {
        canonicalMap.set(norm, trans);
      }
    }
  }

  if (canonicalMap.size === 0) {
    return { text: translatedText, fixes: [] };
  }

  let result = translatedText;

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeReplacement = (str: string) => str.replace(/\$/g, '$$$$');

  // (bug 238) Dạng CHUẨN của một tên biến, kể cả khi nó đã đúng sẵn. Cần cho việc ép path: đoạn
  // `" AI Tiếp Quản"` đúng chính tả nhưng thừa khoảng trắng, `getCasingFix` trả null vì so bằng
  // `!==` với chuỗi đã trim ⇒ không đủ để biết "đây là một tên biến".
  const canonicalOf = (varName: string): string | null => {
    if (!varName || varName.length < 2) return null;
    return canonicalMap.get(normVar(varName)) ?? null;
  };

  // Helper: check if a variable name needs casing/separator fix
  const getCasingFix = (varName: string): string | null => {
    const canonical = canonicalOf(varName);
    return canonical && canonical !== varName ? canonical : null;
  };

  const note = (found: string, replaced: string) => {
    if (!fixes.some(f => f.found === found)) fixes.push({ found, replaced });
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

  // ─── Pass 1b: (bug 238) PATH MVU — `[Thế Giới.Thời Gian Hiện Tại]`, macro có path, khoá là
  // path. Xem chú thích khối của {@link enforceMvuPathTokens}: đây là ba ngữ cảnh mà tám pass
  // còn lại không chạm tới, và cũng là nơi sai hoa/thường gây hại nhất. ───
  result = enforceMvuPathTokens(result, canonicalOf, note);

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

  // ─── Pass 3b: MẢNG path ['KEY 1', 'KEY 2'] — dạng _.get(stat, ['Tiến trình', 'Giai đoạn']) ───
  // Pass 3 chỉ khớp mảng 1 phần tử (['KEY']) vì đòi `]` ngay sau nháy đóng; card MVU thật dùng
  // mảng nhiều segment → casing lệch dict không được vá (nguồn 8 cảnh báo "mvu inconsistent" ở
  // Kiểm tra tổng). Khớp từng chuỗi đứng giữa `[`/`,` và `,`/`]`; chỉ đổi khi khác casing với dict
  // (getCasingFix) nên không đụng mảng chuỗi thường.
  const arraySegRegex = /([[,]\s*)(['"])([^'"]+)\2(?=\s*[,\]])/g;
  result = result.replace(arraySegRegex, (match, prefix, quote, inner) => {
    const canonical = getCasingFix(inner);
    if (canonical) {
      if (!fixes.some(f => f.found === inner)) {
        fixes.push({ found: inner, replaced: canonical });
      }
      return `${prefix}${quote}${canonical}${quote}`;
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
      // (User 2026 — bug #8) Key cũ KHÔNG space (identifier kiểu Giới_Hạn_Từ_Bi — có thể đang là
      // object key JS/Zod không nháy) mà canonical CÓ space → phải BỌC NHÁY ('Giới Hạn Từ Bi':)
      // — hợp lệ ở CẢ JS lẫn YAML, không đoán ngữ cảnh. Key có nháy sẵn thì giữ nháy như cũ.
      if (!q1 && !/\s/.test(key.trim()) && /\s/.test(canonical)) {
        return `${indent}'${canonical}'${colon}`;
      }
      return `${indent}${q1}${canonical}${q2}${colon}`;
    }
    return match;
  });

  // ─── Pass 6b: object key JS/Zod KHÔNG nháy đứng sau `{` hoặc `,` (không ở đầu dòng) ───
  // (User 2026 — bug #8) `z.object({ Giới_Hạn_Từ_Bi: z.number() })` — Pass 6 chỉ bắt đầu dòng nên
  // key inline bị bỏ sót. Bắt key sau `{`/`,`, tra dict (chuẩn hoá separator) → thay bằng dạng dict,
  // BỌC NHÁY nếu có space. `(?!:)` để không đụng macro `{{getvar::…}}`.
  const jsKeyRegex = /([{,]\s*)([A-Za-zÀ-ỹĐđ_$][\w$À-ỹĐđ-]*)(\s*:)(?!:)/g;
  result = result.replace(jsKeyRegex, (match, prefix, key, colon) => {
    const canonical = getCasingFix(key);
    if (canonical) {
      if (!fixes.some(f => f.found === key)) {
        fixes.push({ found: key, replaced: canonical });
      }
      return /\s/.test(canonical) ? `${prefix}'${canonical}'${colon}` : `${prefix}${canonical}${colon}`;
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

  // ─── Pass 7b: (bug 232) MỌI CHUỖI TRONG NHÁY đứng đúng bằng một tên biến ───
  // Bảy pass trên là một DANH SÁCH TRẮNG các ngữ cảnh cú pháp: macro, obj['k'], getvar(), ===,
  // khoá YAML, lodash… Thẻ thật lại gọi qua hàm CỦA RIÊNG NÓ và dùng tên biến làm GIÁ TRỊ chuỗi:
  //     const money = getVal(sd, 'Tài chính.Tiền tài', 0);
  //     rows.push({k: 'Tiền tài', v: '¥ ' + fmtMoney(money)});
  // `getVal` không nằm trong danh sách trắng nào, còn `k: '…'` là VỊ TRÍ GIÁ TRỊ chứ không phải
  // khoá — nên cả hai chỗ không pass nào chạm tới. Đo trên sáu chuỗi thật user gửi: chỉ 2/6 được
  // vá, đúng con số "50~70%" user cảm nhận.
  //
  // AN TOÀN: `getCasingFix` chỉ trả kết quả khi chuỗi (hoặc từng đoạn của path) CHUẨN HOÁ RA
  // ĐÚNG một mục trong từ điển — tức chỉ lệch hoa/thường hoặc dấu nối. Câu văn có CHỨA tên biến
  // ("Số Tiền tài của ngươi…") không chuẩn hoá ra tên biến nào nên không bị đụng; chuỗi lạ như
  // '¥ ' hay 'px' cũng vậy. Không khớp qua xuống dòng và bỏ qua chuỗi có escape để không cắt nhầm.
  //
  // (bug 238) Ghi lại qua `canonicalizeDotPath`: bản cũ `seg.replace(seg.trim(), canonical)` GIỮ
  // khoảng trắng quanh dấu chấm, nên `'Nhân mạch. AI tiếp quản'` chỉ được sửa hoa/thường thành
  // `'Nhân Mạch. AI Tiếp Quản'` — vẫn tra ra khoá `' AI Tiếp Quản'` và vẫn trả undefined.
  const anyLiteralRegex = /(['"])((?:[^'"\n\\])*)\1/g;
  result = result.replace(anyLiteralRegex, (match, quote, inner: string) => {
    if (!inner || inner.length < 2) return match;
    const res = canonicalizeDotPath(inner, canonicalOf);
    if (!res.changed) return match;
    for (const h of res.hits) note(h.found, h.replaced);
    return `${quote}${res.text}${quote}`;
  });

  // ─── Pass 8: NHÃN HIỂN THỊ trong HTML — <td>Cảnh giới</td> ───
  // (User 2026) Schema khai "Cảnh Giới" nhưng bảng trạng thái trong regex hiển thị "Cảnh giới".
  // 7 pass trên chỉ chạm tới tên biến ở ngữ cảnh CODE (macro/bracket/getvar/YAML/lodash), còn tên
  // biến nằm làm CHỮ HIỂN THỊ thì không pass nào đụng → hai nơi lệch nhau, regex không khớp được
  // giá trị → vỡ card. Đây là lý do "đã khoá từ điển rồi vẫn bị".
  //
  // AN TOÀN: chỉ ép khi TOÀN BỘ text node đúng bằng tên biến (cho phép khoảng trắng và dấu ':'
  // hai bên) — tức nó thực sự là một cái NHÃN. Văn xuôi có chứa tên biến giữa câu
  // (vd "<p>Cảnh giới hạn của ngươi</p>") KHÔNG bị đụng, vì cả node không khớp.
  result = result.replace(/>([^<>]+)</g, (match, textNode: string) => {
    const raw = String(textNode);
    // Tách: khoảng trắng đầu | phần chữ | dấu ':' và khoảng trắng cuối
    const m = raw.match(/^(\s*)(.+?)(\s*[:：]?\s*)$/);
    if (!m) return match;
    const [, lead, core, trail] = m;
    const canonical = getCasingFix(core);
    if (!canonical) return match;
    if (!fixes.some(f => f.found === core)) fixes.push({ found: core, replaced: canonical });
    return `>${lead}${canonical}${trail}<`;
  });

  return { text: result, fixes };
}

/* ═══════════════════════════════════════════════════════════════════════════
   (bug 238) BA NGỮ CẢNH "PATH MVU" MÀ MỌI PASS ÉP TÊN BIẾN ĐỀU BỎ SÓT
   ═══════════════════════════════════════════════════════════════════════════
   Từ điển chốt `当前时间 → "Thời Gian Hiện Tại"` (Title Case). Trong entry quy tắc, cùng biến đó
   lại được gọi bằng ĐƯỜNG DẪN, và AI dịch gõ thường lộn xộn:

       - `[Thế giới.Thời gian hiện tại]`   ← đúng ra `[Thế Giới.Thời Gian Hiện Tại]`
       - `{{getvar::Thế giới.Thời gian hiện tại}}`
       - `Thế giới.Thời gian hiện tại: mô tả`

   Ba chỗ này KHÔNG phải chuỗi trong nháy, KHÔNG phải khoá YAML một đoạn, KHÔNG phải node HTML —
   nên tám pass của `enforceVariableCasing` không chạm tới chỗ nào cả (đo trên 12 ca user gửi:
   0/12 được sửa). Mà đây lại là chỗ ĐẮT NHẤT: entry quy tắc là bản hướng dẫn AI trong game viết
   lệnh cập nhật, sai hoa/thường ở đây là sai khoá ở MỌI lượt chơi về sau — Zod strict chặn, ra
   đúng "lỗi json" user gặp.

   Pass macro cũ còn hỏng theo cách riêng: nó tra NGUYÊN chuỗi, nên path nhiều đoạn không bao giờ
   khớp một mục từ điển. Hai pass tương đương — `getvar('A.B')` (Pass 4) và `_.get(x,'A.B')`
   (Pass 7) — đã tách theo dấu chấm từ lâu; macro chỉ là chỗ bị bỏ quên.
*/

/** Trả về dạng CHUẨN của một đoạn tên biến, hoặc null nếu đoạn đó không phải tên biến nào. */
type SegResolver = (segment: string) => string | null;

/**
 * (bug 238) Chuẩn hoá MỘT path MVU dạng `A.B.C` theo từ điển.
 *
 * Dán lại bằng ĐÚNG một dấu chấm, KHÔNG giữ khoảng trắng quanh dấu chấm. Đây là lỗi thật chứ
 * không phải chuyện thẩm mỹ: `[Nhân mạch. AI tiếp quản]` tách ra đoạn `" AI tiếp quản"`, mà
 * `_.get` tra khoá theo nguyên văn nên `" AI Tiếp Quản"` ≠ `"AI Tiếp Quản"` — biến trả về
 * undefined. (Pass 7b cũ có `trim()` khi TRA nhưng lại `seg.replace(seg.trim(), …)` khi GHI, nên
 * khoảng trắng sống sót và path vẫn hỏng dù đã "sửa xong".)
 */
function canonicalizeDotPath(
  raw: string,
  resolve: SegResolver,
): { text: string; changed: boolean; hits: { found: string; replaced: string }[] } {
  const hits: { found: string; replaced: string }[] = [];
  // Từ điển có thể chốt cả DẠNG PATH ("财务.钱财" → "Tài Chính.Tiền Tài") — thử nguyên chuỗi trước.
  const whole = resolve(raw.trim());
  if (whole) {
    if (whole === raw) return { text: raw, changed: false, hits };
    return { text: whole, changed: true, hits: [{ found: raw.trim(), replaced: whole }] };
  }
  const segs = raw.split('.');
  if (segs.length < 2) return { text: raw, changed: false, hits };

  let changed = false;
  const out = segs.map((seg) => {
    const bare = seg.trim();
    const canonical = resolve(bare);
    if (!canonical) return seg;
    if (canonical !== seg) {
      changed = true;
      hits.push({ found: seg.trim() === canonical ? seg : bare, replaced: canonical });
    }
    return canonical;
  });
  return { text: out.join('.'), changed, hits };
}

/**
 * (bug 238) Ép từ điển lên PATH MVU ở ba ngữ cảnh trên. Dùng chung cho cả ba bộ ép tên biến
 * (`enforceVariableCasing`, `enforceDictVariants`, `enforceInitvarCovariance`) nên không còn cảnh
 * bộ này biết ngữ cảnh mà bộ kia không.
 *
 * AN TOÀN cho token `[…]` và `A.B:` — hai chỗ này nằm giữa văn xuôi nên phải qua HAI cửa:
 *   1. MỌI đoạn có DÁNG một tên biến: chỉ chữ/số/khoảng trắng/`_`, và có ít nhất một chữ cái.
 *      Loại thẳng mọi biểu thức JS có thật trong thẻ mẫu — `[talent.thresholds.length - 1]` (dấu
 *      `-`), `[z.string(), z.number()]` (ngoặc, phẩy), `[data-zone="${x}"]` (`-`, `"`, `=`), `[0,1]`.
 *   2. ÍT NHẤT MỘT đoạn tra ra một tên biến trong từ điển. Cửa này loại phần còn lại:
 *      `[userData.name]`, `[item.name]`, `[talent.key]`, `[tier.title]` — không đoạn nào là tên
 *      biến MVU nên token không bị đụng.
 * (Không thể đòi MỌI đoạn đều tra ra: với bộ ép BIẾN THỂ, đoạn nào ĐÚNG SẴN thì vắng mặt trong
 * bảng biến thể — `[Nhân Vật Chính.Sổ Ghi Nhớ]` chỉ có đoạn sau cần sửa.)
 */
const MVU_NAME_SHAPE = /^[\p{L}\p{N}_ ]+$/u;
const HAS_LETTER = /\p{L}/u;

/** Một đoạn CÓ DÁNG tên biến MVU (chưa cần có trong từ điển) — cửa 1 ở chú thích trên. */
const looksLikeMvuName = (seg: string): boolean => {
  const s = seg.trim();
  return s.length >= 2 && MVU_NAME_SHAPE.test(s) && HAS_LETTER.test(s);
};

/** Path giữa văn xuôi mới đáng ép: mọi đoạn có dáng tên, và ít nhất một đoạn có trong từ điển. */
function isProsePath(segs: string[], resolve: SegResolver): boolean {
  if (segs.length < 2) return false;
  if (!segs.every(looksLikeMvuName)) return false;
  return segs.some((s) => resolve(s.trim()));
}

/**
 * Dọn dạng path LAI do bản dịch cũ sinh ra:
 *   `[Nhân Vật['Tuổi Tác']]` → `[Nhân Vật.Tuổi Tác]`
 *   `[A['B']['C']]`           → `[A.B.C]`
 *
 * Chỉ đổi khi từ điển xác nhận cả path hoặc ít nhất một đoạn, và không đụng array expression
 * JS thật kiểu `[data['status']]` trừ khi từ điển có đúng full-path `data.status`.
 */
function normalizeHybridMvuPathTokens(
  text: string,
  resolve: SegResolver,
  note: (found: string, replaced: string) => void,
): string {
  return text.replace(
    /\[([^\[\]\n]+?)((?:\[\s*['"][^'"\]\n]+['"]\s*\])+)]/g,
    (match, parentRaw: string, bracketRaw: string) => {
      const parent = parentRaw.trim();
      const children = [...bracketRaw.matchAll(/\[\s*(['"])([^'"\]\n]+)\1\s*\]/g)].map(m => m[2].trim());
      if (!parent || children.length === 0) return match;
      const parentSegments = parent.split('.').map(s => s.trim());
      const segments = [...parentSegments, ...children];
      if (!segments.every(looksLikeMvuName)) return match;

      const joined = segments.join('.');
      const whole = resolve(joined);
      const parentIsJsReceiver = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(parent);
      if (!whole && parentIsJsReceiver) return match;
      if (!whole && !segments.some(seg => resolve(seg))) return match;

      const canonical = canonicalizeDotPath(joined, resolve).text;
      const replacement = `[${canonical}]`;
      if (replacement !== match) note(match, replacement);
      return replacement;
    },
  );
}

function enforceMvuPathTokens(
  text: string,
  resolve: SegResolver,
  note: (found: string, replaced: string) => void,
): string {
  let out = normalizeHybridMvuPathTokens(text, resolve, note);

  // (a) Token đường dẫn trong văn quy tắc: `[Thế Giới.Thời Gian Hiện Tại]`
  out = out.replace(/\[([^[\]\n]+)\]/g, (match, inner: string) => {
    if (!isProsePath(inner.split('.'), resolve)) return match;
    const res = canonicalizeDotPath(inner, resolve);
    if (!res.changed) return match;
    for (const h of res.hits) note(h.found, h.replaced);
    return `[${res.text}]`;
  });

  // (b) Macro có path: {{getvar::Thế Giới.Thời Gian Hiện Tại}}
  out = out.replace(
    /(\{\{(?:get|set|add)(?:global)?var::\s*)([^:}\n]+?)(\s*)(\}\}|::)/g,
    (match, prefix: string, name: string, _trail: string, suffix: string) => {
      if (!name.includes('.')) return match;
      const res = canonicalizeDotPath(name, resolve);
      if (!res.changed) return match;
      for (const h of res.hits) note(h.found, h.replaced);
      return `${prefix}${res.text}${suffix}`;
    },
  );

  // (c) Khoá YAML/dòng quy tắc là một path: `Thế Giới.Thời Gian Hiện Tại: mô tả`.
  // Qua đúng hai cửa của isProsePath — nên `1.5:` (không có chữ cái) hay `http://x.y:` không dính.
  out = out.replace(/^([ \t]*[-*]?[ \t]*)(["'`]?)([^"'`:\n]+)(["'`]?)([ \t]*:)/gm, (match, lead, q1, key: string, q2, colon) => {
    if (!isProsePath(String(key).split('.'), resolve)) return match;
    const res = canonicalizeDotPath(key, resolve);
    if (!res.changed) return match;
    for (const h of res.hits) note(h.found, h.replaced);
    return `${lead}${q1}${res.text}${q2}${colon}`;
  });

  return out;
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
 * (User yêu cầu 2026) Chuẩn hoá TÊN BIẾN MVU đã dịch về MỘT dạng DUY NHẤT: bỏ dấu `_`/`-` mà AI
 * hay chèn (vì tưởng biến là identifier code) → dùng dạng "Họ Tên" (cách). MVU truy cập biến bằng
 * KEY chuỗi (`_.get`/`bracket['X']`/YAML/Zod string key) nên dạng có space vẫn hợp lệ VÀ đồng nhất
 * mọi nơi (đây là gốc lỗi: chỗ `Họ_Tên`, chỗ `Họ Tên`, chỗ `Họ tên`).
 *
 * CHỈ đụng tên đã DỊCH (có ký tự NON-ASCII: tiếng Việt có dấu / CJK). KHÔNG đụng:
 *  - identifier code THUẦN ASCII (`stat_data`, `mvu_update`, `_mvu`, `camelCase`…) — dấu `_` bắt buộc.
 *  - từ khoá bảo vệ (PROTECTED_CODE_KEYWORDS).
 * Giữ nguyên HOA/THƯỜNG (việc đồng nhất case đã có `enforceVariableCasing`).
 */
export function canonicalizeMvuVarName(name: string): string {
  if (!name || typeof name !== 'string') return name;
  const unquoted = name.trim().replace(/^["']|["']$/g, '').trim();
  if (!unquoted) return name;
  // ASCII thuần (không dấu tiếng Việt/CJK) ⇒ có thể là identifier code ⇒ KHÔNG đụng (giữ `_`).
  if (!/[^\x00-\x7F]/.test(unquoted)) return name;
  if (PROTECTED_CODE_KEYWORDS.has(unquoted) || PROTECTED_CODE_KEYWORDS.has(unquoted.toLowerCase())) return name;
  const cleaned = unquoted
    .split(/\s+/)
    .map(unifyVarWordSeparators)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || name;
}

/* Chữ Latin CÓ DẤU (tiếng Việt) — dấu hiệu "từ tự nhiên", không phải identifier code. */
const LATIN_DIACRITIC_RE = /[À-ỹĐđ]/;
const CJK_PART_RE = /^[぀-ヿ㐀-䶿一-鿿가-힯]+$/;
const LATIN_PART_RE = /^[A-Za-zÀ-ỹĐđ]+$/;

/**
 * (User 2026 — bug #8: `Lưu_Tam_Bảo`, `Giới_Hạn_Từ_Bi` lọt lưới) Đồng nhất separator `_`/`-` → space
 * cho MỘT từ (không chứa khoảng trắng). Quy tắc cũ đòi "MỌI mảnh đều non-ASCII" nên từ Việt thuần-ASCII
 * ("Tam", "Bi", "User", "Tin"…) làm cả từ bị bỏ qua → underscore sống sót tràn vào lorebook. Quy tắc mới:
 *  - Giữ nguyên marker MVU đầu từ (`_` readonly / `$` hidden).
 *  - Mảnh nào có CHỮ SỐ → giữ nguyên (enum "阶段 1_静谧", id "evt_01").
 *  - MỌI mảnh đều CJK → nối space (武_力 → 武 力).
 *  - MỌI mảnh đều chữ Latin VÀ cả từ có ≥1 ký tự CÓ DẤU → từ tiếng Việt bị AI nối `_` → nối space
 *    (Lưu_Tam_Bảo → Lưu Tam Bảo, Tình_Cảm_Với_User → Tình Cảm Với User, Tô Yến Hề_ → bỏ `_` cuối).
 *  - Còn lại (mixed CJK+ASCII như 场景_sfw, ASCII thuần như stat_data, có ký hiệu như [mvu_update])
 *    → identifier code → GIỮ NGUYÊN.
 */
export function unifyVarWordSeparators(word: string): string {
  if (!/[_-]/.test(word)) return word;
  const marker = word.startsWith('_') || word.startsWith('$') ? word[0] : '';
  const core = marker ? word.slice(1) : word;
  const parts = core.split(/[_-]+/).filter(Boolean);
  if (parts.length === 0) return word;
  if (parts.some((p) => /\d/.test(p))) return word;
  const allCjk = parts.every((p) => CJK_PART_RE.test(p));
  const allLatin = parts.every((p) => LATIN_PART_RE.test(p));
  if (allCjk || (allLatin && LATIN_DIACRITIC_RE.test(core))) return marker + parts.join(' ');
  return word;
}

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

  // ═══ (User 22/07 — bug 76) VÌ SAO KHÔNG GOM THEO BẢN DỊCH NỮA ═══
  //
  // Bản cũ gom cụm theo GIÁ TRỊ ĐÃ DỊCH, dùng khoảng cách Levenshtein ≤ 2, rồi ép cả cụm về
  // một tên. Với tiếng Việt Hán-Việt thì đó là suy luận SAI: hai thực thể khác hẳn nhau rất
  // hay chỉ lệch 1-2 ký tự. Đo thật trên chính ca user gặp:
  //
  //     "Bạch Thược" ↔ "Xích Thược"   Levenshtein = 2  → BỊ GỘP   (白芍 vs 赤芍!)
  //     "Thanh Vân"  ↔ "Thành Vân"    Levenshtein = 1  → BỊ GỘP
  //     "Đông Cung"  ↔ "Đồng Cung"    Levenshtein = 1  → BỊ GỘP
  //     "Hỏa Linh"   ↔ "Hàn Linh"     Levenshtein = 2  → BỊ GỘP
  //
  // Nút "Đồng nhất tên biến MVU" vì thế TỰ TAY tạo ra xung đột rồi mới báo có xung đột.
  //
  // Nguyên tắc đúng: chỉ được gom khi hai mục là CÙNG MỘT BIẾN ở phía NGUỒN (chỉ khác dấu
  // nối/hoa thường, ví dụ 好感度 vs 好感_度). Hai nguồn KHÁC NHAU thì bản dịch phải giữ
  // riêng — nếu chúng trùng nhau thì đó là XUNG ĐỘT cần báo cho user (validateDictionaryConflicts
  // + nút "gọi AI dịch lại"), tuyệt đối không được im lặng gộp.
  const normSource = (s: string) =>
    canonicalizeMvuVarName(String(s)).toLowerCase().replace(/[\s_-]+/g, '').trim();

  // Gom theo NGUỒN: mỗi nhóm = một biến, có thể được viết vài kiểu khác nhau.
  const bySource = new Map<string, { origKey: string; transValue: string }[]>();
  for (const [origKey, transValue] of Object.entries(dict)) {
    if (!transValue || origKey === transValue) continue;
    const norm = normSource(origKey);
    if (!norm) continue;
    if (!bySource.has(norm)) bySource.set(norm, []);
    bySource.get(norm)!.push({ origKey, transValue });
  }

  for (const [, entries] of bySource) {
    if (entries.length < 2) continue;
    if (new Set(entries.map(e => e.transValue)).size <= 1) continue;

    // Chọn bản chuẩn: ưu tiên bản đến từ schema, không có thì lấy bản phổ biến nhất.
    let canonical = entries[0].transValue;
    const schemaEntry = metadata && entries.find(e => metadata[e.origKey]?.confidence === 'schema');
    if (schemaEntry) {
      canonical = schemaEntry.transValue;
    } else {
      const freq = new Map<string, number>();
      for (const e of entries) freq.set(e.transValue, (freq.get(e.transValue) || 0) + 1);
      let maxCount = 0;
      for (const [val, count] of freq) if (count > maxCount) { maxCount = count; canonical = val; }
    }

    for (const entry of entries) {
      if (entry.transValue !== canonical) {
        fixedDict[entry.origKey] = canonical;
        fixes.push(`"${entry.origKey}": "${entry.transValue}" → "${canonical}"`);
      }
    }
  }

  // (User yêu cầu 2026) Làm SẠCH mọi giá trị về dạng chuẩn "Họ Tên" (bỏ `_`/`-` → space) — khoá
  // dạng canonical DUY NHẤT cho MỌI biến, kể cả biến đơn lẻ không thuộc cụm nào ở trên.
  for (const [k, v] of Object.entries(fixedDict)) {
    // Giữ nguyên mục rỗng để UI còn nhận ra đây là key chưa được dịch, không tự biến nó thành source.
    const clean = v ? sanitizeMvuVarName(k, v) : v;
    if (clean !== v) {
      fixedDict[k] = clean;
      fixes.push(`"${k}": "${v}" → "${clean}" (chuẩn hoá dấu)`);
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

  // (Bug 39c — TREO khi bấm Dịch, xác nhận bằng card thật bugNeedFix/40) Bản regex cũ có
  // `(?:\.\w+\([^)]*\))*` — QUANTIFIER LỒNG không chặn ⇒ catastrophic backtracking: script MVU
  // 525K với hàng nghìn chuỗi `z.number().min(0).max(100)` KHÔNG có .describe làm regex chạy
  // hàng CHỤC PHÚT (đo Node: >10 phút chưa xong 1 script). extractPotentialMvuKeys gọi hàm này
  // cho TỪNG script TavernHelper ngay sau Pha 0 ⇒ đúng cú "Trang không phản hồi" của user.
  // Viết lại TUYẾN TÍNH: indexOf từng ".describe(" rồi đi LÙI qua chuỗi method bằng máy quét
  // tay (bounded) tới `z.`/`Zod.` để lấy tên field — không còn backtracking, O(n) theo text.
  const MAX_CHAIN_BACK = 2000; // chuỗi method dài nhất chấp nhận (z.enum([...]).min()... )
  let idx = 0;
  while ((idx = schemaText.indexOf('.describe(', idx)) !== -1) {
    const anchor = idx;
    idx += 10; // qua ".describe(" — vòng sau tìm tiếp từ đây dù occurrence này bị bỏ

    // ── Đọc chuỗi mô tả phía trước: '…' | "…" | `…` ──
    let j = anchor + 10;
    while (j < schemaText.length && (schemaText[j] === ' ' || schemaText[j] === '\t' || schemaText[j] === '\n' || schemaText[j] === '\r')) j++;
    const quote = schemaText[j];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    let k = j + 1;
    while (k < schemaText.length && schemaText[k] !== quote) k++;
    if (k >= schemaText.length) continue;
    const desc = schemaText.slice(j + 1, k);
    if (!desc) continue;

    // ── Đi lùi từ trước ".describe": bỏ qua các đoạn `.\w+(...)` cho tới `z.`/`Zod.` ──
    const floor = Math.max(0, anchor - MAX_CHAIN_BACK);
    let p = anchor - 1;
    let sawZ = false;
    let hops = 0;
    while (p >= floor && hops++ < 200) {
      while (p >= floor && /\s/.test(schemaText[p])) p--;
      if (p < floor) break;
      if (schemaText[p] === ')') {
        // nhảy lùi qua cặp ngoặc cân bằng (đối số của method)
        let depth = 0;
        while (p >= floor) {
          const ch = schemaText[p];
          if (ch === ')') depth++;
          else if (ch === '(') { depth--; if (depth === 0) { p--; break; } }
          p--;
        }
        if (depth !== 0) break; // ngoặc lệch (paren trong chuỗi…) → bỏ occurrence này
        continue;
      }
      // tên method hoặc z/Zod: quét \w đi lùi
      const wEnd = p;
      while (p >= floor && /\w/.test(schemaText[p])) p--;
      if (wEnd === p) break; // không phải \w → cấu trúc lạ
      const word = schemaText.slice(p + 1, wEnd + 1);
      if (p >= 0 && schemaText[p] === '.') { p--; continue; } // ".word" → phần chuỗi method, lùi tiếp
      if (word === 'z' || word === 'Zod') sawZ = true;
      break;
    }
    if (!sawZ) continue;

    // ── p đứng TRƯỚC `z`/`Zod` — kỳ vọng dạng `field  :  z…` ──
    let q = p;
    while (q >= 0 && /\s/.test(schemaText[q])) q--;
    if (q < 0 || schemaText[q] !== ':') continue;
    q--;
    while (q >= 0 && /\s/.test(schemaText[q])) q--;
    if (q < 0) continue;
    let field = '';
    if (schemaText[q] === '"' || schemaText[q] === "'") {
      const qq = schemaText[q];
      let r = q - 1;
      while (r >= 0 && schemaText[r] !== qq && q - r <= 120) r--;
      if (r < 0 || schemaText[r] !== qq) continue;
      field = schemaText.slice(r + 1, q);
    } else {
      let r = q;
      while (r >= 0 && q - r < 100 && !/[\s:.,;()'"`{}[\]]/.test(schemaText[r])) r--;
      field = schemaText.slice(r + 1, q + 1);
    }
    field = field.trim();
    if (field && field.length <= 80) result[field] = desc;
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
 * (v1.99.9) Quy tắc: tên biến dùng DẤU CÁCH tự nhiên, giữ dấu tiếng Việt.
 * VD: "好感度" → "Độ Hảo Cảm", "攻击力" → "Sức Tấn Công". KHÔNG dùng underscore.
 */
/**
 * Bảo toàn prefix chức năng của biến MVU (guide MVU_ZOD mvu-11):
 *   `_` = readonly (AI thấy, không sửa), `$` = ẩn (AI không thấy).
 * Nếu bản dịch của một key có prefix nhưng chính bản dịch lại mất ký tự đó
 * (AI dịch `_类型` → `Loại`), gắn lại để MVU không mất ngữ nghĩa. Sửa tại chỗ.
 */
export function restoreVariablePrefixes(dict: Record<string, string>): void {
  for (const k of Object.keys(dict)) {
    const marker = k.startsWith('_') ? '_' : k.startsWith('$') ? '$' : '';
    if (marker && dict[k] && !dict[k].startsWith(marker)) {
      dict[k] = marker + dict[k];
    }
  }
}

/**
 * (User 2026 — bug #8 ĐẢO CHIỀU fix bug #4 cũ) TRƯỚC ĐÂY hàm này ÉP `_` thay space (chống SyntaxError
 * khi tên làm object key KHÔNG quote trong Zod/JS). Nhưng nó ĐÁNH NHAU với canonicalizeMvuVarName +
 * promptBuilder rule 21 (đều chuẩn SPACE) → từ điển lúc `Độ_Hảo_Cảm` lúc `Độ Hảo Cảm` → initvar/lorebook
 * TRỘN 2 kiểu, biến lệch nhau, card user vỡ (bugNeedFix/8: 272 chỗ nhiễm `_`).
 * CHUẨN DUY NHẤT từ v1.99.9: tên biến dùng DẤU CÁCH tự nhiên ("Độ Hảo Cảm") — khớp UI người chơi thấy.
 * Chỗ key JS/Zod không quote do enforceVariableCasing/unify tự BỌC NHÁY ('Độ Hảo Cảm': hợp lệ cả JS lẫn
 * YAML); guard cú pháp JS (v1.99.7) làm lưới đỡ cuối. Hàm giữ tên cũ để không phải sửa 4 caller.
 */
export function sanitizeMvuVarName(originalKey: string, translated: string): string {
  const sourceParts = originalKey.split('.');
  const dotted = normalizeMvuPathDots(originalKey, translated);
  const targetParts = dotted.split('.');
  const cleanSegment = (part: string) => canonicalizeMvuVarName(
    part.trim()
      // Đây là tên KEY, không phải văn xuôi. Ký tự điều khiển/nháy/slash/dấu phân cách có thể
      // đóng chuỗi, mở comment, đổi YAML hoặc làm regex literal chết sau khi thay từ điển.
      .replace(/[\u0000-\u001f\u007f'"`\\\/:{}\[\],#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  // Dấu chấm là toán tử PATH của MVU. Một key nguồn đơn không được tự mọc thêm tầng sau dịch.
  // Với mục từ path, chỉ giữ dấu chấm khi số tầng hai phía khớp; mỗi tầng được làm sạch riêng.
  if (sourceParts.length === targetParts.length && sourceParts.length > 1) {
    return targetParts.map((part, i) => cleanSegment(part) || sourceParts[i].trim()).join('.');
  }
  return cleanSegment(dotted) || originalKey.trim();
}

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
  /** Số lô chạy song song = computePoolConcurrency (Σ key×RPM mọi provider). Mặc định 1. */
  concurrency: number = 1,
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

  const systemPrompt = `Translate CJK (Chinese/Japanese/Korean) variable names to ${targetLang}. Do NOT translate English or ASCII names. Chinese proper nouns (names, places) → Sino-Vietnamese (Hán Việt). Japanese proper nouns → Romaji. Korean proper nouns → Standard Revised Romanization (e.g. 金泰亨→Kim Tae-hyung), NOT Sino-Vietnamese. Do NOT translate English. Keep consistency with MVU Schema.${fandomNameOverride()}

You are a variable name translator for SillyTavern character cards.
Your job: translate variable names from the source language to ${targetLang}.

STRICT RULES:
1. Variable names use NATURAL SPACES between words (e.g. Vietnamese: "Độ Hảo Cảm", "Sức Tấn Công"). NEVER join words with underscore '_' — do NOT output "Độ_Hảo_Cảm". Keep diacritics. If the SOURCE key contains '_' or spaces, mirror the source's separators exactly. CONSISTENCY: same variable = identical string everywhere. (When a translated name is used as a JavaScript/Zod object key, it must be wrapped in quotes: 'Độ Hảo Cảm': — the tool enforces this automatically.)
2. Keep the names SHORT but meaningful (2-4 words max).
3. Be CONSISTENT: similar concepts MUST have similar naming patterns.
   - All emotion/feeling variables should follow the same pattern (e.g. Mức X, Độ X)
   - All stat variables should follow the same pattern
4. If a key is already in Latin/ASCII or English, keep it AS IS. Do NOT translate English.
5. Chinese proper nouns (character names, places, dynasties) → Sino-Vietnamese (Hán Việt) reading. Examples: 清河→Thanh Hà, 慕容冲→Mộ Dung Xung, 洛阳→Lạc Dương.
6. Japanese proper nouns → Romaji transliteration (e.g. 田中→Tanaka, 桜→Sakura). Korean proper nouns → Standard Revised Romanization (e.g. 金泰亨→Kim Tae-hyung, 仁川→Incheon). Do NOT apply Sino-Vietnamese to Japanese/Korean names.
7. Western/Fantasy names transcribed into CJK (e.g. 维拉→Vera, 塞勒涅→Selene) → restore original Latin spelling.
   Follow user custom rules if provided (custom prompt overrides these defaults).
8. Keep numeric suffixes and prefixes intact (e.g. \"攻击力2\" → \"Sức Tấn Công 2\").
9. For Vietnamese specifically:
   - Use Title Case with diacritics, words separated by SPACES: "Hảo Cảm", "Thể Lực", "Trí Tuệ" (NEVER "Hảo_Cảm")
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
   If you produce duplicate translations for different source keys, the card's variable system will CRASH because two different variables will share the same name.
13. MVU PREFIX MARKERS — PRESERVE A LEADING "_" OR "$" EXACTLY:
   A variable name may start with "_" (readonly: AI sees but cannot update) or "$" (hidden: AI does not see).
   These single leading characters are FUNCTIONAL markers, not part of the name. If a key starts with one,
   KEEP that exact character at the front of your translation and translate only the rest.
   Examples: "_类型" → "_Loại" (NOT "Loại"), "$开局类型" → "$Loại_Mở_Đầu". Never add a "_"/"$" that wasn't there.${modBlock}${customPromptBlock}

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

  // Xử lý 1 lô. Chạy SONG SONG qua runWorkerPool (mỗi call vẫn đi qua pickLane nên RPM
  // an toàn) — trước đây for...await tuần tự khiến pha "Dịch tên biến MVU" chỉ dùng 1 lane.
  const processBatch = async (batch: string[]): Promise<void> => {
    if (signal?.aborted) return;

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
            // Good translation — accept immediately (sanitize: khong space trong ten bien)
            result[k] = sanitizeMvuVarName(k, v);
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
                result[k] = sanitizeMvuVarName(k, v);
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
  }; // end processBatch

  // ── SEED COVARIANCE: lô ĐẦU chạy một mình để "định chuẩn" quy ước đặt tên
  // (Mức X / Độ X, Title Case…). Các lô SAU chạy SONG SONG và đọc kết quả lô đầu
  // qua covarianceBlock (allConstraints gộp `result` tại lúc chạy) → giữ nhất quán
  // gần bằng bản tuần tự mà chỉ trả giá 1 call chờ. pickLane trong callProvider lo RPM.
  if (batches.length > 0) {
    await processBatch(batches[0]);
  }
  if (batches.length > 1) {
    const rest = batches.slice(1);
    await runWorkerPool({
      total: rest.length,
      concurrency: Math.max(1, concurrency),
      runOne: (i) => processBatch(rest[i]),
      shouldStop: () => !!signal?.aborted,
    });
  }

  // ── POST-BATCH: Bảo toàn prefix chức năng "_" (readonly) / "$" (ẩn) ───────
  // Chạy TRƯỚC dedup để `类型`→`Loại` và `_类型`→`_Loại` được xem là hai bản
  // dịch KHÁC nhau (không báo trùng giả).
  restoreVariablePrefixes(result);

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
          result[k] = sanitizeMvuVarName(k, trimmed);
          fixedCount++;
        } else {
          // Still a duplicate — append source key hint to force uniqueness
          const disambiguated = `${trimmed} (${k})`;
          result[k] = sanitizeMvuVarName(k, disambiguated);
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

  const systemPrompt = `Translate CJK (Chinese/Japanese/Korean) variable names to ${targetLang}. Do NOT translate English or ASCII names. Chinese proper nouns → Sino-Vietnamese (Hán Việt). Japanese proper nouns → Romaji. Korean proper nouns → Standard Revised Romanization (NOT Sino-Vietnamese). Keep consistency with MVU Schema.${fandomNameOverride()}

You are a variable name translator for SillyTavern character cards.
Your job: translate variable names from the source language to ${targetLang}.

STRICT RULES:
1. Use natural, readable formatting with diacritics (e.g. Vietnamese: Độ Hảo Cảm, Sức Tấn Công). CONSISTENCY is the only formatting rule.
2. Keep the names SHORT but meaningful (2-4 words max).
3. If a key is already in Latin/ASCII or English, keep it AS IS.
4. Chinese proper nouns (names, places) → Sino-Vietnamese (Hán Việt). Japanese proper nouns → Romaji. Korean proper nouns → Standard Revised Romanization (e.g. 金泰亨→Kim Tae-hyung), NOT Sino-Vietnamese. Western/Fantasy names in CJK → restore original Latin spelling.
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
   - For Vietnamese (${targetLang}), use Sino-Vietnamese reading for Chinese proper nouns only (e.g. 李明 -> Lý Minh, 长安 -> Trường An). All descriptive text → natural modern Vietnamese.${fandomNameOverride()}
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
 * Sửa lỗi cú pháp "dấu nháy đơn lồng dấu nháy đơn" (hoặc kép lồng kép) trong bracket notation.
 *
 *   setDeepValue(x, 'stat_data['Thế Giới.Chương Hiện Tại']', y)   ← VỠ: chuỗi kết thúc ở 'stat_data['
 *   → setDeepValue(x, "stat_data['Thế Giới.Chương Hiện Tại']", y) ← đổi nháy NGOÀI sang nháy kép
 *
 * Xảy ra khi một key CJK có dấu chấm/khoảng trắng (vd 世界.当前章节) được dịch sang tiếng Việt
 * ("Thế Giới.Chương Hiện Tại") — AI buộc phải chuyển dot→bracket notation ['...'] nhưng GIỮ NGUYÊN
 * dấu nháy bao ngoài cùng loại → nháy đơn lồng nháy đơn làm vỡ chuỗi → Uncaught SyntaxError,
 * cả kịch bản JS dừng chạy ngay khi card được nạp vào SillyTavern.
 *
 * Sửa ở MỨC CHUỖI, KHÔNG phụ thuộc tên hàm — nên bắt được setDeepValue/getDeepValue/Mvu.xxx/_.get…
 * (các fix path cũ chỉ khớp _.get/_.set của lodash & bỏ qua field tavern_helper). An toàn: chỉ động
 * vào đúng mẫu BỊ VỠ; chuỗi thường, arr['x'] đứng riêng, hay nháy đã escape \' đều không bị đụng.
 */
export function fixNestedQuoteBracketPaths(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  // Nháy ĐƠN bao ngoài chứa ['key'] dùng nháy đơn → đổi nháy ngoài thành nháy KÉP
  result = result.replace(
    /'([A-Za-z_$][\w$.]*)?((?:\[\s*'[^'\]]*'\s*\])+)'/g,
    (m, prefix: string | undefined, brackets: string) => (m.includes('"') ? m : `"${prefix || ''}${brackets}"`)
  );
  // Nháy KÉP bao ngoài chứa ["key"] dùng nháy kép → đổi nháy ngoài thành nháy ĐƠN
  result = result.replace(
    /"([A-Za-z_$][\w$.]*)?((?:\[\s*"[^"\]]*"\s*\])+)"/g,
    (m, prefix: string | undefined, brackets: string) => (m.includes("'") ? m : `'${prefix || ''}${brackets}'`)
  );
  return result;
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

  // Sửa nháy đơn lồng nháy đơn trong bracket notation: 'x['key']' → "x['key']"
  result = fixNestedQuoteBracketPaths(result);

  return result;
}

export interface SanitizedSchemaMappings {
  mapping: Record<string, string>;
  removed: string[];
}

/**
 * Loại ánh xạ giả do so sánh schema theo vị trí khi AI đổi thứ tự các field cùng kiểu.
 *
 * Bằng chứng thật: `B→V, V→B, A→M, M→A`. Đây không phải dịch ngôn ngữ mà là một hoán vị:
 * target của dòng này lại là source của dòng kia. Tên generic Latin một ký tự cũng không bao
 * giờ nên được tự dịch. Chỉ dùng guard này cho mapping TỰ SINH từ schema; mục manual không qua đây.
 */
export function sanitizeAutomaticSchemaMappings(
  input: Record<string, string>,
): SanitizedSchemaMappings {
  const raw: Record<string, string> = {};
  for (const [source, target] of Object.entries(input || {})) {
    const s = String(source || '').trim();
    const t = String(target || '').trim();
    if (s && t && s !== t) raw[s] = t;
  }

  // Tìm mọi node nằm trong chu kỳ A→B→…→A, không chỉ chu kỳ hai phần tử.
  const cycleKeys = new Set<string>();
  for (const start of Object.keys(raw)) {
    const path: string[] = [];
    const at = new Map<string, number>();
    let node: string | undefined = start;
    while (node && raw[node] && !at.has(node)) {
      at.set(node, path.length);
      path.push(node);
      node = raw[node];
    }
    if (node && at.has(node)) {
      for (const key of path.slice(at.get(node)!)) cycleKeys.add(key);
    }
  }

  const mapping: Record<string, string> = {};
  const removed: string[] = [];
  for (const [source, target] of Object.entries(raw)) {
    const isSingleLatinGeneric = /^[A-Za-z_$]$/.test(source) || /^[A-Za-z_$]$/.test(target);
    if (isSingleLatinGeneric || cycleKeys.has(source)) {
      removed.push(source);
      continue;
    }
    mapping[source] = target;
  }
  return { mapping, removed };
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

  return sanitizeAutomaticSchemaMappings(mapping).mapping;
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
