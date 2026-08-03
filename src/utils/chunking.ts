// ═══════════════════════════════════════════════════════════════════════════════
// CHUNKING — cắt văn bản dài thành nhiều phần AN TOÀN (không cắt giữa code/tag/URL…).
// Tách khỏi apiClient.ts (Đợt tách monolith): đây là cụm THUẦN (chỉ xử lý chuỗi, không
// gọi API/không đụng store) → dễ test + tái dùng. chunkText có test riêng (chunkText.test.ts).
// ═══════════════════════════════════════════════════════════════════════════════
import { planJsChunkCuts, sliceAtCuts } from './jsChunkBoundaries';

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
/**
 * (User 2026 — bugNeedFix/39) TRẦN SỐ LẦN DÒ mỗi dấu phân tách.
 *
 * isSafeBoundary() ĐẮT (slice tiền tố + vài regex quét lại + vòng 10K ký tự). Trước đây
 * findSafeBoundary duyệt LÙI qua MỌI lần xuất hiện của dấu phân tách trong cửa sổ [minPos, targetPos]
 * — với field code 88K ký tự, riêng dấu CÁCH và XUỐNG DÒNG đã hàng nghìn vị trí ⇒ hàng nghìn lần gọi
 * ⇒ đo thật 1.123ms CHỈ để chunk 1 field (×10 field code = ~10 giây nghẽn main thread → bug 39).
 *
 * Ta chỉ cần 1 ranh giới AN TOÀN, KHÔNG cần ranh giới "đẹp nhất": dò tối đa N vị trí gần targetPos
 * nhất cho mỗi dấu, không thấy thì sang dấu kế (rồi tới các fallback sẵn có). Kết quả vẫn luôn là
 * ranh giới an toàn, chỉ có thể lệch đôi chút so với trước.
 */
const MAX_BOUNDARY_PROBES_PER_SEP = 12;

function findSafeBoundary(text: string, targetPos: number, minPos: number): number {
  // Try double newline boundaries first (most natural)
  const priorities = ['\n\n', '\n', '. ', '。', '；', ' '];

  // (bug 39) memo theo vị trí — findSafeBoundary hay dò lại đúng vị trí cũ giữa các dấu/fallback.
  const memo = new Map<number, boolean>();
  const safeAt = (pos: number): boolean => {
    const hit = memo.get(pos);
    if (hit !== undefined) return hit;
    const ok = isSafeBoundary(text, pos);
    memo.set(pos, ok);
    return ok;
  };

  for (const sep of priorities) {
    let searchFrom = targetPos;
    let probes = 0;
    while (searchFrom > minPos && probes < MAX_BOUNDARY_PROBES_PER_SEP) {
      const idx = text.lastIndexOf(sep, searchFrom);
      if (idx <= minPos) break;

      const splitAt = idx + sep.length;
      probes++;
      if (safeAt(splitAt)) {
        return splitAt;
      }
      searchFrom = idx - 1;
    }
  }

  // Fallback: try any position near targetPos that is safe
  // (bug 39) bước 200 thay vì 50: isSafeBoundary đắt (quét ngược 5000 ký tự + regex mỗi dấu `{`),
  // mà trạng thái an toàn đổi rất chậm theo vị trí → bước thưa hơn vẫn tìm ra ranh giới an toàn.
  for (let pos = targetPos; pos > minPos; pos -= 200) {
    if (safeAt(pos)) {
      // Find nearest newline or space
      const nl = text.lastIndexOf('\n', pos);
      if (nl > minPos && safeAt(nl + 1)) return nl + 1;
      const sp = text.lastIndexOf(' ', pos);
      if (sp > minPos && safeAt(sp + 1)) return sp + 1;
      return pos;
    }
  }

  return -1; // Failed to find safe boundary, trigger subsequent fallbacks
}

export function chunkText(text: string, maxChars?: number, _maxTokens?: number): string[] {
  // Chunk size mặc định 15.000 ký tự (theo feedback user: 12–15k/lần call cho kết quả tốt nhất).
  // → entry ≤15k dịch 1 lần; entry lớn (vd 90k) cắt ~6 phần đều nhau tại ranh giới AN TOÀN
  //   (isSafeBoundary, không cắt giữa code/tag), rồi dịch SONG SONG + ghép lại.
  if (maxChars === undefined) {
    maxChars = 15000;
  }

  // ═══ HARD CAP: 15.000 ký tự/chunk ═══ (fields code-heavy tự truyền 12.000 để an toàn hơn)
  // Giữ dưới ngưỡng để tránh cắt cụt đầu ra AI (flash: 15k ký tự CJK ≈ 7,5k token < 8,2k limit).
  const HARD_CAP = 15000;
  maxChars = Math.min(maxChars, HARD_CAP);

  if (text.length <= maxChars) return [text];

  // ═══ (bug 203) FIELD JAVASCRIPT: CẮT THEO CÂY CÚ PHÁP, KHÔNG ĐẾM NGOẶC ═══
  // Đo trên schema Zod 29.700 ký tự user gửi: đường cắt cũ dừng ngay sau `const escapeRegExp
  // = text =>` và giữa một object literal — mảnh nào cũng là JS cụt, AI đoán bừa, ghép lại vỡ
  // cú pháp, dịch lại vẫn cắt y chỗ đó nên vỡ y hệt. Hỏi thẳng bộ phân tích cú pháp thì chỉ
  // cắt ở ranh giới giữa hai nút anh em. Không parse được / không phải JS thật → rơi xuống
  // đúng thuật toán cũ bên dưới, văn xuôi và HTML không đổi hành vi.
  const jsPlan = planJsChunkCuts(text, maxChars);
  if (jsPlan) {
    const pieces = sliceAtCuts(text, jsPlan.cuts);
    if (pieces.length > 1 && pieces.join('') === text) {
      console.log(`[chunkText] JS: cắt ${pieces.length} phần tại ranh giới cú pháp `
        + `(mảnh dài nhất ${jsPlan.maxPieceLen} ký tự)`);
      return pieces;
    }
  }

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
