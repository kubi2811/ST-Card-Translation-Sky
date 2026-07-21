// ═══════════════════════════════════════════════════════════════════════════════
// LƯỚI AN TOÀN CÚ PHÁP — Mod Card viết lại <script>/JS, nếu AI trả code vỡ cú pháp thì
// nạp vào SillyTavern sẽ liệt nút. Ở đây chỉ CẢNH BÁO (không tự sửa code sáng tạo của AI).
//
// Dùng `new Function(code)` để BIÊN DỊCH thử (KHÔNG chạy) — bắt lỗi cú pháp, 0 phụ thuộc
// (khác Dịch Card dùng acorn; Mod Card là Next.js không có acorn). Đủ để cảnh báo.
// ═══════════════════════════════════════════════════════════════════════════════

/** Cú pháp JS có hợp lệ không? new Function biên dịch thân hàm, ném lỗi nếu sai cú pháp. */
export function isJsSyntaxOk(code: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(code);
    return true;
  } catch (e) {
    // Chỉ coi là "vỡ" khi đúng là SyntaxError; lỗi khác (ReferenceError…) không xảy ra vì không chạy.
    return !(e instanceof SyntaxError);
  }
}

/**
 * Đếm cân bằng ngoặc, BỎ QUA ngoặc nằm trong chuỗi / template / comment.
 * Dùng để KHẲNG ĐỊNH BẰNG CODE là nội dung có bị cắt cụt hay không — thay vì để LLM
 * đoán (LLM chỉ nhìn thấy phần đã bị prompt cắt nên hay báo "truncated" nhầm).
 */
export function checkBracketBalance(code: string): { balanced: boolean; brace: number; paren: number; bracket: number } {
  let brace = 0, paren = 0, bracket = 0;
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    // comment dòng
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    // comment khối
    if (c === '/' && code[i + 1] === '*') { i += 2; while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    // chuỗi ' " `
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n && code[i] !== q) { if (code[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '{') brace++; else if (c === '}') brace--;
    else if (c === '(') paren++; else if (c === ')') paren--;
    else if (c === '[') bracket++; else if (c === ']') bracket--;
    i++;
  }
  return { balanced: brace === 0 && paren === 0 && bracket === 0, brace, paren, bracket };
}

/**
 * Mô tả kết quả kiểm toàn vẹn để nhét vào prompt cho LLM.
 *
 * `isCode = true`  → nội dung là JS/Zod thật: đếm cân bằng ngoặc (đáng tin).
 * `isCode = false` → văn xuôi/XML (mvu_update rules, initvar…): KHÔNG đếm ngoặc, vì ngoặc
 *   trong câu chữ như "(Nhân Loại Bình Thường)" làm lệch số vô nghĩa. Thay vào đó đưa ĐUÔI
 *   thật của nội dung để LLM tự thấy nó kết thúc gọn ghẽ hay đứt giữa chừng.
 */
export function describeIntegrity(label: string, code: string, isCode = false): string {
  if (!code || !code.trim()) return `- ${label}: (KHÔNG TỒN TẠI trong card này — bỏ qua, đừng báo lỗi về mục này)`;

  if (isCode) {
    const b = checkBracketBalance(code);
    return b.balanced
      ? `- ${label}: ĐỦ ${code.length} ký tự, ngoặc CÂN BẰNG {}=0 ()=0 []=0 → NGUYÊN VẸN, KHÔNG bị cắt cụt.`
      : `- ${label}: ${code.length} ký tự, ngoặc LỆCH {}=${b.brace} ()=${b.paren} []=${b.bracket} → NGHI bị cắt cụt thật.`;
  }

  const tail = code.replace(/\s+$/, '').slice(-120).replace(/\n/g, '⏎');
  return `- ${label}: ĐỦ ${code.length} ký tự (đã gửi trọn vẹn). Kết thúc bằng: «…${tail}»`;
}

/** Lấy thân mọi <script>…</script> (bỏ khối rỗng). */
export function extractScriptBodies(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) if (m[1].trim()) out.push(m[1]);
  return out;
}

/**
 * Kiểm cú pháp 1 đoạn code JS (hoặc HTML chứa <script>). Trả về gốc-lành-mà-bản-mới-vỡ để cảnh báo.
 * Chỉ dùng cho JS THUẦN — KHÔNG dùng cho EJS (`<% %>`) vì EJS không phải JS hợp lệ.
 */
export function scriptBrokeByMod(originalJs: string, moddedJs: string): boolean {
  const origBodies = originalJs.includes('<script') ? extractScriptBodies(originalJs) : [originalJs];
  const modBodies = moddedJs.includes('<script') ? extractScriptBodies(moddedJs) : [moddedJs];
  if (origBodies.length !== modBodies.length) return false; // khác cấu trúc → không kết luận
  for (let i = 0; i < modBodies.length; i++) {
    if (modBodies[i].trim() && isJsSyntaxOk(origBodies[i]) && !isJsSyntaxOk(modBodies[i])) return true;
  }
  return false;
}
