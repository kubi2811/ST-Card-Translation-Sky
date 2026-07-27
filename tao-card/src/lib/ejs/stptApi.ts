/**
 * src/lib/ejs/stptApi.ts — (bugNeedFix/125) NGUỒN SỰ THẬT về API + cú pháp EJS của
 * ST-Prompt-template, kèm bộ kiểm chạy TRƯỚC khi ghi code vào thẻ.
 * ─────────────────────────────────────────────────────────────────────────────
 * User dùng "Sinh EJS điều khiển" trong Lorebook rồi chơi thẻ, nhận một chuỗi lỗi đỏ:
 *     1) setEntryEnabled is not defined
 *     2) Unexpected token '<' while compiling ejs … at line: 1, column: 1
 *
 * HAI GỐC BỆNH RIÊNG BIỆT, đã đối chiếu thẳng source extension:
 *
 * (1) `setEntryEnabled` KHÔNG TỒN TẠI. SHARE_CONTEXT + prepareContext trong
 *     ST-Prompt-template/src/function/ejs.ts liệt kê đầy đủ global của EJS — không có nó.
 *     Extension KHÔNG cho phép TẮT một entry từ EJS; chỉ cho KÍCH HOẠT một entry đang tắt:
 *         await activewi('tên entry')          (alias activateWorldInfo)
 *         activateWorldInfoByKeywords([...])
 *     Muốn tắt vĩnh viễn thì tắt bằng CẤU HÌNH entry (enabled=false), không viết code.
 *     Tool cũ dạy AI API bịa này và tự sinh nó trong template fallback → thẻ nào cũng chết.
 *
 * (2) Lỗi `Unexpected token '<'` là do template fallback sinh THẺ EJS LỆCH. Cụ thể nhánh
 *     `getwi` mở `<%_`, đóng `_%>`, rồi MỞ LẠI `<%_` mà không bao giờ đóng. Hàm lint() của
 *     extension chạy máy trạng thái: khi còn "inside Scriptlet" (mode≠0) thì mọi token sau đó
 *     được TRẢ NGUYÊN thay vì thay bằng khoảng trắng — nên ký tự `<` của `<%#` kế tiếp lọt
 *     nguyên vào JS và acorn báo Unexpected token '<'.
 *
 * Vì (2) là lỗi cấu trúc chứ không phải lỗi API, kiểm bằng cách đếm thô là không đủ.
 * `validateWorldbookEjs` dưới đây DỰNG LẠI ĐÚNG máy trạng thái lint() của extension
 * (padWhitespace + mode 0/1/2 + acorn) — thứ gì extension báo lỗi thì ở đây cũng báo lỗi,
 * trước khi code kịp chạm vào thẻ của user.
 */
import { parse } from 'acorn';

/** API có thật trong context EJS của ST-Prompt-template (đối chiếu ejs.ts + prepareContext). */
export const STPT_API = {
  /** Kích hoạt entry ĐANG TẮT cho lượt sinh này. PHẢI await. */
  activate: ['activewi', 'activateWorldInfo', 'activateWorldInfoByKeywords'],
  /** Đọc nội dung entry (PHẢI await). */
  read: ['getwi', 'getWorldInfo', 'getWorldInfoData', 'getEnabledWorldInfoEntries'],
  vars: ['getvar', 'setvar', 'incvar', 'decvar', 'getGlobalVar', 'setGlobalVar', 'getMessageVar', 'setMessageVar'],
  chat: ['getChatMessage', 'getChatMessages', 'matchChatMessages'],
  misc: ['injectPrompt', 'define', 'evalTemplate', 'selectActivatedEntries', 'activateRegex'],
} as const;

/**
 * API KHÔNG TỒN TẠI mà AI (và cả code cũ của chính tool) hay bịa ra.
 * Gặp trong code sinh ra là loại thẳng — đây chính là gốc bệnh (1) của bug 125.
 */
export const STPT_FORBIDDEN_FNS = [
  'setEntryEnabled',
  'activateEntry',
  'setEntryContent',
  'enableWorldInfo',
  'disableWorldInfo',
  'setWorldInfoEnabled',
] as const;

/** Khối luật bơm vào MỌI prompt sinh EJS worldbook — dạy đúng mô hình kích hoạt. */
export const STPT_API_PROMPT_BLOCK = `API EJS THẬT của ST-Prompt-template (đối chiếu source extension — ngoài danh sách này là KHÔNG TỒN TẠI):
- await activewi('tên entry', true) — KÍCH HOẠT một entry đang TẮT cho lượt sinh này (alias: activateWorldInfo). Tham số true (force) là BẮT BUỘC: thiếu nó lời gọi chạy êm nhưng không đẩy được entry nào vào prompt.
- await activewi('tên sách', 'tên entry', true) — như trên, chỉ đích danh sách.
- activateWorldInfoByKeywords(['từ khoá'], { force: true }) — kích hoạt entry tắt có key khớp từ khoá.
- await getwi(null, 'tên entry') — đọc NỘI DUNG entry (không kích hoạt).
- getvar('đường.dẫn', { defaults: x }) / setvar('đường.dẫn', x) — đọc/ghi biến.
- getChatMessages(-1, 'user'|'assistant') / matchChatMessages(['từ khoá']) — đọc/quét chat.
- injectPrompt({ text, position, depth }) — chèn prompt.

MÔ HÌNH ĐIỀU KHIỂN (BẮT BUỘC HIỂU ĐÚNG):
- KHÔNG có hàm nào TẮT entry từ EJS. TUYỆT ĐỐI KHÔNG viết setEntryEnabled / activateEntry /
  enableWorldInfo / disableWorldInfo — không tồn tại, chạy là "is not defined".
- Entry cần điều khiển phải TẮT SẴN (enabled=false trong cấu hình); controller BẬT nó có điều
  kiện bằng await activewi(...).
- Muốn tắt vĩnh viễn một entry → tắt trong cấu hình, không viết code.

QUY TẮC CÚ PHÁP (vi phạm là vỡ compile "Unexpected token '<'"):
- MỖI <%_ hoặc <% PHẢI có _%> hoặc %> đóng lại. Tuyệt đối không mở khối rồi để hở —
  khi còn khối hở, mọi thẻ phía sau bị nuốt vào JS và cả entry chết.
- Dùng var (không let/const). activewi/getwi PHẢI có await.
- Trong scriptlet nên dùng chú thích /* ... */; nếu dùng // thì PHẢI có xuống dòng ngay sau.`;

export interface WorldbookEjsCheck {
  ok: boolean;
  problems: string[];
}

/** Token EJS — cùng bộ với ejs.Template.parseTemplateText của extension. */
const EJS_TOKEN_RE = /(<%%|%%>|<%=|<%-|<%_|<%#|<%|-%>|_%>|%>)/;

/** Thay mỗi ký tự bằng khoảng trắng nhưng GIỮ xuống dòng — y hệt padWhitespace của extension. */
function padWhitespace(text: string): string {
  return text.split('\n').map(line => ' '.repeat(line.length)).join('\n');
}

/**
 * Dựng lại đúng lint() của ST-Prompt-template: biến template EJS thành JS tương đương
 * (giữ nguyên dòng/cột) để acorn soi. Trả về cả `js` lẫn trạng thái khối còn hở.
 *
 * Điểm mấu chốt sao chép nguyên: khi mode ≠ 0 (đang trong scriptlet), token/chuỗi văn bản
 * được TRẢ NGUYÊN. Đó là lý do một khối `<%_` quên đóng khiến ký tự `<` lọt vào JS.
 */
export function ejsToLintableJs(text: string): { js: string; unclosed: boolean } {
  const parts = String(text).split(EJS_TOKEN_RE);
  let mode = 0;
  const out: string[] = [];

  for (const str of parts) {
    if (str === '') continue;
    switch (str) {
      case '<%':
      case '<%_':
        mode = 1;
        out.push(padWhitespace(str));
        break;
      case '<%=':
      case '<%-':
        mode = 2;
        out.push(`;${padWhitespace(str).slice(1)}`);
        break;
      case '<%#':
        // Extension KHÔNG có case riêng cho <%# — nó rơi vào nhánh default. Nghĩa là: đang trong
        // scriptlet hở thì `<%#` được TRẢ NGUYÊN (đây đúng là ký tự '<' gây lỗi), còn bình thường
        // thì bị xoá thành khoảng trắng. Sao chép y hệt để không che mất lỗi thật.
        if (mode === 1 || mode === 2) {
          out.push(str);
        } else {
          mode = 3;
          out.push(padWhitespace(str));
        }
        break;
      case '%>':
      case '-%>':
      case '_%>':
        out.push(padWhitespace(str) + (mode === 2 ? ';' : ''));
        mode = 0;
        break;
      default:
        // Trong scriptlet → giữ nguyên JS. Ngoài scriptlet (hoặc trong <%#) → xoá thành trắng.
        out.push(mode === 1 || mode === 2 ? str : padWhitespace(str));
        break;
    }
  }

  return { js: out.join(''), unclosed: mode !== 0 };
}

/**
 * Kiểm code EJS worldbook TRƯỚC khi ghi vào thẻ. Không qua = không ghi.
 * Chốt chặn để "AI trả gì cũng lưu" (và cả template tự sinh sai) không bao giờ tới tay user.
 */
export function validateWorldbookEjs(code: string): WorldbookEjsCheck {
  const problems: string[] = [];
  const src = String(code || '');

  // 1. API bịa — gốc bệnh (1).
  for (const fn of STPT_FORBIDDEN_FNS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(src)) {
      problems.push(
        `gọi ${fn}() — API KHÔNG tồn tại trong ST-Prompt-template ` +
        `(entry phải TẮT sẵn trong cấu hình rồi bật bằng await activewi)`,
      );
    }
  }

  // 2. Cấu trúc thẻ + cú pháp JS — gốc bệnh (2), soi bằng chính máy trạng thái của extension.
  const { js, unclosed } = ejsToLintableJs(src);
  if (unclosed) {
    problems.push("còn khối EJS chưa đóng (thiếu _%> hoặc %>) — token phía sau lọt vào JS, extension sẽ báo Unexpected token '<'");
  }

  if (js.trim()) {
    try {
      parse(js, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    } catch (e) {
      problems.push(`JS trong scriptlet không parse được: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. activewi/getwi thiếu await → trả Promise: điều kiện luôn truthy, nội dung ra [object Promise].
  const bare = [...js.matchAll(/(await\s+)?\b(activewi|activateWorldInfo|getwi|getWorldInfo)\s*\(/g)]
    .filter(m => !m[1]);
  if (bare.length > 0) {
    problems.push(`${bare.length} lời gọi ${[...new Set(bare.map(b => b[2]))].join('/')} thiếu await`);
  }

  // 4. activewi thiếu force → im lặng vô hiệu (xem chú thích ở activationLine).
  const noForce = [...js.matchAll(/\b(?:activewi|activateWorldInfo)\s*\(([^)]*)\)/g)]
    .filter(m => !/,\s*true\s*$/.test(m[1] ?? ''));
  if (noForce.length > 0) {
    problems.push(`${noForce.length} lời gọi activewi thiếu tham số force (true) — chạy êm nhưng không kích hoạt được entry nào`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Dựng một dòng kích hoạt entry có điều kiện — dạng chuẩn duy nhất tool dùng.
 *
 * BẮT BUỘC truyền `true` (force). Đọc kỹ worldinfo.ts: activateWorldInfo chỉ gán `hash` khi
 * force=true, mà applyActivateWorldInfo() lại lọc `e => e.hash` trước khi phát
 * WORLDINFO_FORCE_ACTIVATE. Không có force thì lời gọi chạy êm nhưng KHÔNG đẩy được entry nào
 * vào prompt — im lặng vô hiệu, còn khó chẩn đoán hơn cả lỗi đỏ.
 */
export function activationLine(entryComment: string, condition?: string): string {
  const safe = entryComment.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return condition
    ? `if (${condition}) { await activewi('${safe}', true); }`
    : `await activewi('${safe}', true);`;
}
