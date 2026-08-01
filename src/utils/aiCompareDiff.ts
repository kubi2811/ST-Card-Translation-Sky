/**
 * src/utils/aiCompareDiff.ts — (bugNeedFix/184) AI SOI KHÁC BIỆT TỪNG MỤC trong So Sánh Card.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "thêm tính năng call API để xem từng mục của bản Dịch và bản Final khác gì nhau, vì
 * đôi khi khác có tí xíu nhưng phải dịch lại toàn bộ entry thì không ổn lắm. Tương tự với
 * regex làm đẹp bảng, script, schema."
 *
 * Cảnh thật: user đã dịch card V1; tác giả ra bản Final (V2, tiếng Trung). Gộp thông minh chỉ
 * chia được hai loại — "y hệt thì tái dùng" và "khác thì dịch lại cả entry". Nhưng "khác" rất
 * hay chỉ là tác giả sửa MỘT câu trong entry 3.000 chữ; dịch lại từ đầu vừa tốn call vừa mất
 * những chỗ user đã trau chuốt tay ở bản dịch cũ.
 *
 * Việc của module này, mỗi lần MỘT entry: đưa AI xem (gốc cũ nếu có +) bản dịch cũ + bản Final,
 * yêu cầu trả về:
 *   • differences — liệt kê ĐÍCH DANH tác giả đã đổi gì (thêm/bớt/sửa chỗ nào), tiếng Việt;
 *   • patched     — bản dịch CẬP NHẬT: giữ nguyên tối đa bản dịch cũ, chỉ đắp phần thay đổi.
 * Với code (regex làm đẹp bảng, script, schema): cấu trúc code lấy THEO FINAL (tác giả có thể
 * đã sửa logic), chỉ bê phần chữ dịch cũ vào các chuỗi hiển thị tương ứng.
 *
 * Bản patched đi qua chốt máy trước khi cho áp (verifyPatched) — AI vá thì máy phải khám:
 * macro đúng ruột (bug 180), ngoặc không rỗng ruột (bug 178), JS không vỡ (nếu là script).
 */
import { jsParseErrorAny, isLikelyJsScript } from './scriptSafety';
import { restoreMacros } from './macroGuard';
import { countEmptiedBrackets } from './cardHealth';

export interface CompareDiffInput {
  /** Nhãn hiển thị của mục (vd "lorebook[33].content", "regex[2].replaceString"). */
  label: string;
  path: string;
  /** Bản GỐC CŨ (slot Raw) — có thì diff chính xác hơn nhiều; không có vẫn chạy được. */
  raw?: string;
  /** Bản DỊCH hiện có (slot Dịch). */
  translated: string;
  /** Bản FINAL mới của tác giả (slot Final). */
  final: string;
}

/** Mục này là code hay văn? Quyết định giọng prompt + bộ kiểm sau vá. */
export function detectContentKind(path: string, final: string): 'code' | 'text' {
  // Cả hai lối đặt tên đều có thật trong thẻ: extensions.tavern_helper.scripts[…] lẫn
  // extensions.TavernHelper_scripts[…] — mẫu "tavern_helper" trần bắt trượt lối thứ hai.
  if (/replaceString|findRegex|tavern.?helper|regex_scripts/i.test(path)) return 'code';
  if (isLikelyJsScript(final)) return 'code';
  if (/<script|<style|<%|registerMvuSchema|z\s*\.\s*object|\[initvar\]/i.test(final)) return 'code';
  return 'text';
}

const SYSTEM_PROMPT = `Bạn là trợ lý so sánh phiên bản cho card SillyTavern. Người dùng có BẢN DỊCH
(tiếng Việt) của phiên bản cũ và BẢN FINAL (bản mới của tác giả, thường tiếng Trung/Anh) của CÙNG
một mục. Nhiệm vụ, đúng hai phần:

1. "differences" — liệt kê ĐÍCH DANH tác giả đã thay đổi gì giữa phiên bản cũ và Final:
   • mỗi khác biệt một dòng, tiếng Việt, kiểu "Thêm: …", "Bỏ: …", "Sửa: … → …";
   • trích NGUYÊN VĂN cụm bị đổi (kèm bản dịch nghĩa trong ngoặc nếu là tiếng Trung);
   • chỉ nêu khác biệt THẬT về nội dung — đảo thứ tự trình bày, đổi khoảng trắng thì bỏ qua;
   • không tìm thấy khác biệt nội dung nào thì trả mảng rỗng.

2. "patched" — bản dịch tiếng Việt ĐÃ CẬP NHẬT theo Final:
   • GIỮ NGUYÊN TỐI ĐA câu chữ của bản dịch cũ — nó là công sức người dùng đã trau chuốt;
   • chỉ dịch mới phần tác giả THÊM, sửa phần tác giả SỬA, bỏ phần tác giả BỎ;
   • macro {{user}}, {{char}}, {{getvar::…}} và mọi placeholder giữ nguyên ruột;
   • KHÔNG được tự ý "cải thiện" những đoạn tác giả không đổi.

VỚI MỤC LÀ CODE (regex làm đẹp bảng, script, schema, HTML):
   • cấu trúc code lấy THEO FINAL — tác giả có thể đã đổi logic/selector/biến, phải theo bản mới;
   • chỉ bê phần CHỮ HIỂN THỊ đã dịch (nhãn, text trong thẻ HTML, chuỗi thông báo) từ bản dịch cũ
     vào đúng vị trí tương ứng trong code Final;
   • tên biến, tên hàm, key JSON, selector: giữ đúng như Final, tuyệt đối không dịch.

Trả về DUY NHẤT JSON: {"differences": ["...", "..."], "patched": "..."}`;

export function buildCompareDiffMessages(input: CompareDiffInput): { system: string; user: string } {
  const kind = detectContentKind(input.path, input.final);
  const parts: string[] = [
    `MỤC ĐANG SO: ${input.label} (${input.path}) — loại: ${kind === 'code' ? 'CODE' : 'văn bản'}`,
  ];
  if (input.raw?.trim()) {
    parts.push(`\n══ BẢN GỐC CŨ (nguyên ngữ, ứng với bản dịch bên dưới) ══\n${input.raw}`);
  } else {
    parts.push('\n(Không có bản gốc cũ — hãy suy ra nội dung cũ từ chính bản dịch.)');
  }
  parts.push(`\n══ BẢN DỊCH HIỆN CÓ (tiếng Việt) ══\n${input.translated}`);
  parts.push(`\n══ BẢN FINAL MỚI CỦA TÁC GIẢ ══\n${input.final}`);
  parts.push('\nLiệt kê khác biệt + trả bản dịch cập nhật theo đúng định dạng JSON đã nêu.');
  return { system: SYSTEM_PROMPT, user: parts.join('\n') };
}

export interface CompareDiffResult {
  differences: string[];
  patched: string;
}

export function parseCompareDiffResponse(rawText: string): CompareDiffResult {
  const m = rawText.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON.');
  const p = JSON.parse(m[0]) as { differences?: unknown; patched?: unknown };
  const patched = String(p.patched ?? '').trim();
  if (!patched) throw new Error('AI không trả về bản dịch cập nhật (patched).');
  const differences = Array.isArray(p.differences)
    ? p.differences.map(String).map(s => s.trim()).filter(Boolean).slice(0, 30)
    : [];
  return { differences, patched };
}

export interface PatchVerdict {
  ok: boolean;
  /** Bản patched sau khi máy tự chữa được gì thì chữa (macro). */
  patched: string;
  /** Lý do từ chối / cảnh báo — rỗng nghĩa là sạch. */
  problems: string[];
}

/**
 * Chốt máy sau khi AI vá — dùng lại đúng các bài học cũ:
 *  • (bug 180) macro bị đổi ruột so với FINAL → tự trả về nguyên văn, đếm là đã sửa;
 *  • (bug 178) ngoặc 【…】 rỗng ruột so với FINAL → từ chối;
 *  • (bug 49/128) FINAL là JS lành mà bản vá vỡ cú pháp → từ chối, kèm dòng lỗi.
 * Chuẩn đối chiếu là FINAL chứ không phải bản dịch cũ: sau vá, entry phải "ăn khớp" với
 * phiên bản MỚI của thẻ — macro của Final, cấu trúc của Final.
 */
export function verifyPatched(input: CompareDiffInput, patchedIn: string): PatchVerdict {
  const problems: string[] = [];
  let patched = patchedIn;

  // (bug 180) Macro ghép cặp với FINAL.
  const mg = restoreMacros(input.final, patched);
  if (mg.fixes.length > 0) {
    patched = mg.text;   // máy tự chữa được — không cần từ chối
  }
  if (mg.unresolved.length > 0) {
    problems.push(`Bản vá làm mất macro bắt buộc: ${mg.unresolved.join(', ')}.`);
  }

  // (bug 178) Ngoặc rỗng ruột so với Final.
  const emptied = countEmptiedBrackets(input.final, patched);
  if (emptied.length > 0) {
    problems.push(`Bản vá làm rỗng ruột ${emptied.length} cặp ngoặc: ${emptied.slice(0, 3).join(', ')}.`);
  }

  // (bug 49/128) Final là JS lành → bản vá cũng phải lành.
  // KHÔNG lọc qua isLikelyJsScript: heuristic đó cần script "đủ dáng" nên bỏ sót script ngắn,
  // mà script ngắn vỡ thì cũng liệt như script dài. Gate đúng là "Final tự nó parse được thành
  // JS" + có ký tự cấu trúc code (một từ trần như "hello" cũng parse được thành JS — không tính).
  if (detectContentKind(input.path, input.final) === 'code'
      && /[{};=]|=>|\(\)/.test(input.final) && jsParseErrorAny(input.final) === null) {
    const err = jsParseErrorAny(patched);
    if (err) problems.push(`Bản vá vỡ cú pháp JS (dòng ~${err.line}: ${err.msg.slice(0, 60)}).`);
  }

  return { ok: problems.length === 0, patched, problems };
}
