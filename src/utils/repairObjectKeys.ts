/**
 * src/utils/repairObjectKeys.ts — (bugNeedFix/109) VÁ ĐỊNH DANH VỠ SAU KHI DỊCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật (thẻ Grimoire, user báo "mất mục khi dịch tool"): bản gốc viết
 *   `return { stats: { 魔力值:80, AP上限:8 } }`  và  `obj.stats.AP上限 = 10`
 * Chữ Hán là ĐỊNH DANH HỢP LỆ trong JavaScript nên không cần nháy — code chạy tốt.
 * Dịch sang tiếng Việt thì thành `APGiới hạn:8` và `.APtối đa=10`: có KHOẢNG TRẮNG mà vẫn
 * viết như định danh ⇒ `SyntaxError` ⇒ CẢ khối <script> chết ⇒ user thấy giao diện biến mất
 * ("mất mục"), chứ không phải mất chữ. Đây là bẫy chỉ xảy ra khi dịch CJK → hệ chữ Latin.
 *
 * Cách vá — bám ĐÚNG vị trí acorn báo lỗi, không quét bừa cả file:
 *   1. Parse. Sạch ⇒ trả nguyên, không đụng một ký tự.
 *   2. Lấy vị trí lỗi → lùi lại đọc cụm định danh-có-khoảng-trắng bao quanh nó.
 *   3. Sửa đúng cụm đó: khoá object → bọc nháy; truy cập `.x y` → đổi sang `['x y']`.
 *   4. Parse lại. CHỈ nhận khi vị trí lỗi TIẾN LÊN (hoặc hết lỗi) — nghĩa là thật sự chữa
 *      được chỗ đó. Không tiến ⇒ trả nguyên bản. Lặp tối đa MAX_ROUNDS chỗ hỏng.
 * Nhờ (4), dù đoán sai chỗ nào thì kết quả cũng không bao giờ tệ hơn đầu vào.
 */
import { jsParseErrorPosAny, jsParseErrorAny, extractScriptBodies } from './scriptSafety';

/** Ký tự hợp lệ để làm định danh JS (gồm cả CJK/Unicode chữ). */
const IDENT_CHAR = /[\p{L}\p{N}$_]/u;
/**
 * (bug 203) 40 → 400. Một schema MVU có hàng trăm khoá chữ Hán; AI dịch cả loạt ra tiếng Việt
 * CÓ DẤU CÁCH thì số chỗ hỏng vượt xa 40, vá dở dang là vẫn vỡ ⇒ guard bắt dịch lại ⇒ đúng vòng
 * lặp user gặp. Mỗi vòng chỉ là một lần parse (~5ms cho file 30K) nên trần cao vẫn rẻ.
 *
 * (bug 207/L5) NHƯNG "rẻ" chỉ đúng với file 30K. Bản ghép tavernHelper 340K thì MỖI vòng là
 * 2-4 lần acorn parse cả 340K (~trăm ms/lần), 400 vòng ĐỒNG BỘ = khoá cứng main thread nhiều
 * phút — trang "treo", bấm Tạm dừng/Huỷ không ăn. Thêm hai phanh: trần vòng CO THEO ĐỘ DÀI
 * (file khổng lồ thì mỗi vòng đắt gấp chục lần nên trần phải thấp tương ứng) + NGÂN SÁCH THỜI
 * GIAN tuyệt đối. Vá dở dang vẫn hơn treo trình duyệt — phần lỗi còn lại do guard cú pháp phía
 * sau xử lý và báo đúng dòng như trước giờ.
 */
const MAX_ROUNDS = 400;
const TIME_BUDGET_MS = 3500;
const roundsCapForLength = (len: number): number =>
  len > 200_000 ? 40 : len > 80_000 ? 120 : MAX_ROUNDS;

export interface KeyRepairResult {
  code: string;
  /** Các định danh đã vá (để ghi log cho user thấy tool sửa gì). */
  fixed: string[];
  /** true khi bản vá thật sự làm code hết lỗi hoặc tiến xa hơn hẳn. */
  repaired: boolean;
}

/** Đọc ngược từ `end` về đầu cụm "định danh có khoảng trắng"; trả [start,end) hoặc null. */
function readIdentRunBackward(code: string, end: number): { start: number; text: string } | null {
  let i = end;
  let sawSpace = false;
  let sawIdent = false;
  while (i > 0) {
    const ch = code[i - 1];
    if (IDENT_CHAR.test(ch)) { sawIdent = true; i--; continue; }
    if ((ch === ' ' || ch === '\t') && sawIdent) {
      // Khoảng trắng chỉ được nuốt khi liền TRƯỚC nó vẫn là ký tự định danh
      // (tránh nuốt luôn khoảng trắng thụt đầu dòng).
      if (i - 2 >= 0 && IDENT_CHAR.test(code[i - 2])) { sawSpace = true; i--; continue; }
      break;
    }
    break;
  }
  if (!sawSpace || !sawIdent || i >= end) return null;
  return { start: i, text: code.slice(i, end) };
}

/** Đọc xuôi hết phần còn lại của cụm định danh (token lỗi thường nằm giữa cụm). */
function readIdentRunForward(code: string, start: number): number {
  let i = start;
  while (i < code.length) {
    const ch = code[i];
    if (IDENT_CHAR.test(ch)) { i++; continue; }
    if ((ch === ' ' || ch === '\t') && i + 1 < code.length && IDENT_CHAR.test(code[i + 1])) { i++; continue; }
    break;
  }
  return i;
}

/** Vá MỘT chỗ hỏng tại vị trí lỗi `pos`; trả code mới + tên đã vá, hoặc null nếu không nhận ra. */
function repairAt(code: string, pos: number): { code: string; name: string } | null {
  if (pos < 0 || pos > code.length) return null;
  // Token lỗi có thể là chữ thứ hai của cụm ("hạn" trong "APGiới hạn") → mở rộng cả 2 chiều.
  const end = readIdentRunForward(code, pos);
  const run = readIdentRunBackward(code, end);
  if (!run) return null;

  const name = run.text.trim();
  if (!name || name.length > 80) return null;

  // Ký tự có nghĩa đứng ngay trước cụm quyết định đây là khoá object hay truy cập thuộc tính.
  let p = run.start - 1;
  while (p >= 0 && /\s/.test(code[p])) p--;
  const prev = p >= 0 ? code[p] : '';

  // Sau cụm là `:` ⇒ khoá trong object literal → bọc nháy.
  let q = end;
  while (q < code.length && /\s/.test(code[q])) q++;
  const next = code[q] ?? '';

  if ((prev === '{' || prev === ',') && next === ':') {
    return { code: code.slice(0, run.start) + `'${name}'` + code.slice(end), name };
  }
  // Trước cụm là `.` ⇒ truy cập thuộc tính `a.b c` → đổi sang `a['b c']`.
  if (prev === '.') {
    return { code: code.slice(0, p) + `['${name}']` + code.slice(end), name };
  }
  return null;
}

/**
 * Vá định danh vỡ trong MỘT đoạn JS. Trả nguyên bản nếu không vá được gì.
 */
export function repairUnquotedObjectKeys(code: string): KeyRepairResult {
  if (!code || typeof code !== 'string') return { code, fixed: [], repaired: false };
  if (jsParseErrorAny(code) === null) return { code, fixed: [], repaired: false }; // code lành: không đụng

  const fixed: string[] = [];
  let cur = code;
  let lastPos = -1;
  const startedAt = Date.now();
  const roundsCap = roundsCapForLength(code.length);

  for (let round = 0; round < roundsCap; round++) {
    // (bug 207/L5) Hết ngân sách thời gian → dừng với những gì đã vá được, trả UI lại cho user.
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.warn(`[repairUnquotedObjectKeys] hết ngân sách ${TIME_BUDGET_MS}ms sau ${round} vòng (file ${code.length} ký tự) — dừng để không khoá main thread.`);
      break;
    }
    // (bug 203) PHẢI dùng bản parse hiểu CẢ module: script 酒馆助手 mở đầu bằng `import`, mà
    // bản cũ chỉ parse mode script nên lỗi luôn rơi về dòng 1 và bộ vá thoát ngay ở vòng đầu.
    const err = jsParseErrorPosAny(cur);
    if (!err) break;                       // hết lỗi ⇒ xong
    if (err.pos <= lastPos) break;         // không tiến lên ⇒ dừng, tránh lặp vô ích
    lastPos = err.pos;

    const r = repairAt(cur, err.pos);
    if (!r) break;                         // lỗi không thuộc dạng này ⇒ để nguyên phần còn lại

    const after = jsParseErrorPosAny(r.code);
    // Chỉ nhận khi thật sự tiến bộ: hết lỗi, hoặc lỗi tiếp theo nằm XA HƠN chỗ vừa sửa.
    if (after && after.pos <= err.pos) break;
    cur = r.code;
    fixed.push(r.name);
    lastPos = -1;                          // vị trí dịch chuyển sau khi sửa → đo lại từ đầu
  }

  if (fixed.length === 0) return { code, fixed: [], repaired: false };
  // Ưu tiên bản hết lỗi hẳn; nếu chưa hết vẫn nhận vì đã gỡ được các chỗ hỏng đúng dạng này
  // (script còn lỗi khác sẽ do guard cú pháp phía sau xử lý và báo đúng dòng).
  return { code: cur, fixed, repaired: true };
}

/**
 * Vá cho nội dung HTML có nhúng <script>: bóc từng khối, vá riêng, ghép lại.
 * Dùng cho replaceString của regex script (giao diện MVU/dashboard) — đúng ca bug 109.
 */
export function repairUnquotedObjectKeysInHtml(html: string): KeyRepairResult {
  if (!html || typeof html !== 'string' || !/<script[^>]*>/i.test(html)) {
    return repairUnquotedObjectKeys(html);
  }
  const bodies = extractScriptBodies(html);
  if (bodies.length === 0) return { code: html, fixed: [], repaired: false };

  const allFixed: string[] = [];
  let anyRepaired = false;
  let out = html;
  for (const body of bodies) {
    const r = repairUnquotedObjectKeys(body);
    if (r.repaired) {
      out = out.replace(body, r.code);
      allFixed.push(...r.fixed);
      anyRepaired = true;
    }
  }
  return { code: out, fixed: allFixed, repaired: anyRepaired };
}
