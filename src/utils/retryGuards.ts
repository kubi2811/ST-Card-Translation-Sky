/**
 * src/utils/retryGuards.ts — (bug 211) MỘT bộ chốt an toàn CHUNG cho MỌI đường dịch lại.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bệnh nền của bug 211: vòng dịch chính (translateSingleField) có đủ dàn chốt — vá khoá object
 * mất nháy (bug 109), toàn vẹn khối EJS, cú pháp JS (acorn), chống AI bịa code — nhưng HAI
 * đường dịch lại thì không:
 *   - `retranslateField` (nút dịch lại 1 entry): chỉ có hậu xử lý nhẹ (macro, nháy cong);
 *   - `retranslateFieldsBulk` (nút thử lại hàng loạt): KHÔNG có gì cả — nhận thẳng đầu ra AI.
 * Tức là đúng những nút sinh ra để CHỮA entry hỏng lại là những đường dễ ghi code vỡ vào thẻ
 * nhất. Bug 203 từng dính chính lỗ này (đường bulk quên truyền rawChunks); đây là bước rút hết
 * phần "chấm điểm bản dịch" về một chỗ để ba đường không bao giờ lệch nhau nữa.
 *
 * Luật chấm y hệt vòng dịch chính, cùng thứ tự:
 *   1. Hậu xử lý: postProcessRegexHtml (regex/tavern_helper có HTML) → nháy cong về nháy thẳng
 *      (code) → trả macro {{…}} về nguyên văn (mọi loại field).
 *   2. Vá khoá object mất nháy (bug 109) — vá TRƯỚC khi chấm cú pháp, vì đây là lỗi chữa được.
 *   3. Toàn vẹn khối EJS: bản dịch lệch số khối <%…%> so với gốc ⇒ GIỮ GỐC.
 *   4. Cú pháp JS: gốc là script parse sạch mà bản dịch vỡ ⇒ GIỮ GỐC (kèm dòng lỗi).
 *   5. Chống bịa code: khai báo lạ + ngoặc lệch ⇒ GIỮ GỐC.
 * "GIỮ GỐC" nghĩa là thà xuất code tiếng Trung CHẠY ĐƯỢC còn hơn script liệt — caller đánh dấu
 * `keptOriginalOnPurpose` để bộ đếm "mục chưa đạt" còn lôi ra cho user bấm dịch lại một phát.
 *
 * Hàm THUẦN, không đụng store/log — caller tự ghi `notes` vào log của mình.
 */

import { postProcessRegexHtml, normalizeSmartQuotesInCode, fixNestedQuoteBracketPaths } from './mvuSync';
import { restoreMacros } from './macroGuard';
import { countEjsBlocks } from './ejsSegmenter';
import { isLikelyJsScript, hasRealJsSignal, jsParseErrorAny } from './scriptSafety';
import { repairUnquotedObjectKeys, repairUnquotedObjectKeysInHtml } from './repairObjectKeys';
import { verifyCodeStructureParity, detectInventedDeclarations } from './surgical';
import { detectRefusal, refusalMessage } from './refusalGuard';

export interface RetryGuardInput {
  original: string;
  translated: string;
  label: string;
  /** FieldGroup — để lỏng kiểu string cho test khỏi dựng cả TranslationField. */
  group: string;
  entryType?: string;
  /** path của field — cần cho điều kiện regex replaceString/trimStrings. */
  path?: string;
}

export interface RetryGuardNote {
  level: 'info' | 'warning';
  msg: string;
}

export interface RetryGuardResult {
  /** Văn bản CUỐI để ghi vào field (đã hậu xử lý, hoặc là bản gốc nếu bị chốt chặn). */
  text: string;
  /** true = chốt an toàn quyết định GIỮ GỐC (hoặc AI trả về đúng bản gốc). */
  keptOriginal: boolean;
  /** Lý do giữ gốc — chỉ có khi một chốt thật sự chặn (AI trả nguyên văn thì không có). */
  guardReason?: string;
  notes: RetryGuardNote[];
}

const isCodeGroup = (group: string): boolean => group === 'regex' || group === 'tavern_helper';

/**
 * Chấm và hoàn thiện MỘT bản dịch trên đường dịch lại. Không bao giờ ném.
 */
export function finalizeRetryTranslation(input: RetryGuardInput): RetryGuardResult {
  const { original, label, group, entryType, path = '' } = input;
  const notes: RetryGuardNote[] = [];
  let text = input.translated ?? '';

  if (!text || !original) {
    return { text, keptOriginal: text === original, notes };
  }

  // ─── 0. (bug 214) LỜI TỪ CHỐI ĐỘI LỐT BẢN DỊCH — chốt TRƯỚC mọi thứ ───
  // apiClient đã chặn ở tầng chunk, nhưng đây là lưới cuối cho mọi đường dịch lại: thà giữ bản
  // gốc tiếng Trung còn hơn ghi câu "The prompt could not be submitted…" của Google vào thẻ.
  const refusal = detectRefusal(text, { sourceLength: original.length });
  if (refusal) {
    return {
      text: original,
      keptOriginal: true,
      guardReason: 'ai-refusal',
      notes: [{ level: 'warning', msg: refusalMessage(refusal, label) }],
    };
  }

  // ─── 1. Hậu xử lý (giống retranslateField cũ — nay bulk cũng được hưởng) ───
  const isRegexContent = group === 'regex' && (path.includes('replaceString') || path.includes('trimStrings'));
  if (isRegexContent) {
    text = postProcessRegexHtml(text);
  }
  if (group === 'tavern_helper' && /<[a-z][^>]*>/i.test(text)) {
    text = postProcessRegexHtml(text);
  }
  if (isCodeGroup(group)) {
    text = normalizeSmartQuotesInCode(text);
    text = fixNestedQuoteBracketPaths(text);
  }

  // Macro {{…}} về nguyên văn — áp cho MỌI loại field (bugNeedFix/180).
  const mg = restoreMacros(original, text);
  if (mg.fixes.length > 0) {
    text = mg.text;
    notes.push({
      level: 'warning',
      msg: `🔒 Trả lại ${mg.fixes.length} macro bị đổi trong ${label}: `
        + mg.fixes.map(f => `{{${f.wrong}}}→{{${f.right}}}`).join(', '),
    });
  }
  if (mg.unresolved.length > 0) {
    notes.push({ level: 'warning', msg: `⚠️ ${label}: mất macro ${mg.unresolved.slice(0, 3).join(', ')} — hãy kiểm tay.` });
  }

  if (text === original) {
    return { text, keptOriginal: true, notes };
  }

  // ─── 2. Vá khoá object mất nháy (bug 109) — chữa được thì chữa trước khi chấm ───
  const keyFix = /<script[^>]*>/i.test(text)
    ? repairUnquotedObjectKeysInHtml(text)
    : repairUnquotedObjectKeys(text);
  if (keyFix.repaired) {
    text = keyFix.code;
    notes.push({
      level: 'info',
      msg: `🔧 ${label}: bọc nháy ${keyFix.fixed.length} khoá bị dịch thành có khoảng trắng `
        + `(${keyFix.fixed.slice(0, 3).join(', ')}${keyFix.fixed.length > 3 ? '…' : ''}).`,
    });
  }

  // ─── 3. Toàn vẹn khối EJS ───
  if (original.includes('<%')) {
    const origBlocks = countEjsBlocks(original);
    const transBlocks = countEjsBlocks(text);
    if (origBlocks > 0 && transBlocks !== origBlocks) {
      const guardReason = `lệch khối EJS (${transBlocks}/${origBlocks} khối <%…%>)`;
      notes.push({
        level: 'warning',
        msg: `⚠️ EJS toàn vẹn: ${label} có ${transBlocks}/${origBlocks} khối <%…%> → GIỮ NGUYÊN bản gốc để KHÔNG vỡ JS khi xuất.`,
      });
      return { text: original, keptOriginal: true, guardReason, notes };
    }
  }

  // ─── 4. Cú pháp JS: gốc sạch thì bản dịch cũng phải sạch (bugNeedFix/128 giữ nguyên miễn trừ) ───
  if (entryType !== 'initvar' && entryType !== 'json_patch'
    && isLikelyJsScript(original) && hasRealJsSignal(original)
    && jsParseErrorAny(original) === null) {
    const jsErr = jsParseErrorAny(text);
    if (jsErr) {
      const guardReason = `vỡ cú pháp JS (dòng ~${jsErr.line}: ${jsErr.msg.slice(0, 60)})`;
      notes.push({
        level: 'warning',
        msg: `⚠️ Script toàn vẹn: ${label} vỡ cú pháp JS sau dịch (dòng ~${jsErr.line}) → GIỮ NGUYÊN bản gốc để script KHÔNG liệt trong SillyTavern.`,
      });
      return { text: original, keptOriginal: true, guardReason, notes };
    }
  }

  // ─── 5. Chống AI bịa code (chỉ field code — y hệt cổng của vòng dịch chính) ───
  const isCodeFieldForHallucGuard =
    isCodeGroup(group) || entryType === 'initvar' || entryType === 'controller' || entryType === 'mvu_logic';
  if (isCodeFieldForHallucGuard) {
    const parity = verifyCodeStructureParity(original, text);
    const invented = detectInventedDeclarations(original, text);
    const hallucinated = parity.maxDiff >= 4 || (invented.length > 0 && parity.maxDiff >= 1);
    if (hallucinated) {
      const why = invented.length > 0
        ? `thêm khai báo lạ [${invented.slice(0, 3).join(', ')}${invented.length > 3 ? '…' : ''}]` + (parity.reason ? ` + ${parity.reason}` : '')
        : (parity.reason || 'cấu trúc code lệch');
      const guardReason = parity.quoteCollapse ? `nghi vỡ dấu nháy (${why})` : `nghi bịa code (${why})`;
      notes.push({
        level: 'warning',
        msg: parity.quoteCollapse
          ? `⚠️ ${label}: bản dịch có chuỗi không đóng đúng chỗ → GIỮ NGUYÊN bản gốc. Soi các chuỗi có dấu nháy trong bản dịch.`
          : `⚠️ Chống bịa code: ${label} — ${why} → GIỮ NGUYÊN bản gốc để KHÔNG nhét code AI tự chế vào card.`,
      });
      return { text: original, keptOriginal: true, guardReason, notes };
    }
  }

  return { text, keptOriginal: false, notes };
}
