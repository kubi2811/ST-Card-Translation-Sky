// ═══════════════════════════════════════════════════════════════════════════════
// LƯỚI AN TOÀN CÚ PHÁP <script> — util DÙNG CHUNG (một nguồn sự thật)
//
// Trước đây logic "trích thân <script> + parse acorn" bị lặp ở surgical.ts (để TỰ VÁ) và
// cardHealth.ts (để CẢNH BÁO). Gom về đây: surgical dùng jsParseError (cần VỊ TRÍ lỗi để vá),
// cardHealth dùng isJsSyntaxOk (chỉ cần đúng/sai). Parse KHÔNG chạy code nên an toàn.
// ═══════════════════════════════════════════════════════════════════════════════
import { parse as acornParse } from 'acorn';

/** Lấy thân mọi <script>…</script> (bỏ khối rỗng). */
export function extractScriptBodies(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) if (m[1].trim()) out.push(m[1]);
  return out;
}

/** Trả về lỗi cú pháp JS (kèm VỊ TRÍ) nếu có, hoặc null nếu parse sạch. */
export function jsParseError(code: string): { pos: number; msg: string } | null {
  try {
    acornParse(code, { ecmaVersion: 'latest' });
    return null;
  } catch (e: unknown) {
    const err = e as { pos?: number; message?: string };
    return { pos: typeof err?.pos === 'number' ? err.pos : -1, msg: String(err?.message || e) };
  }
}

/** Cú pháp JS có hợp lệ không (đúng/sai). */
export function isJsSyntaxOk(code: string): boolean {
  return jsParseError(code) === null;
}

/**
 * (bug 199) THAY MACRO SILLYTAVERN BẰNG ĐỊNH DANH HỢP LỆ trước khi parse.
 *
 * Thẻ 黑色修士 viết thẳng `val === <user>` trong script — 61 chỗ. Với SillyTavern đó là script
 * HỢP LỆ (macro được thay giá trị lúc chạy), nhưng với acorn thì vỡ ngay tại `<user>` đầu tiên
 * ⇒ điều kiện "bản gốc parse sạch" của chốt cú pháp KHÔNG BAO GIỜ thoả ⇒ cả chốt bị tắt. Khi AI
 * dịch làm vỡ một dấu nháy, lỗi thật ("Unterminated string constant, dòng 10") không ai bắt, rơi
 * xuống cổng đếm ngoặc và hiện thành "dấu ( BỚT 1015" — chẩn đoán rác user thấy lặp mãi ở bug 199.
 *
 * Chỉ thay khi ký tự đứng TRƯỚC `<` không phải [\w$)\]] — cùng luật với regexCanStartHere: ở đó
 * `<` không thể là phép so sánh (so sánh cần vế trái), nên chắc chắn là macro. `a<user>b` (so
 * sánh biến tên user thật) đứng sau ký tự từ nên được giữ nguyên.
 *
 * (bug 203) GIỮ NGUYÊN ĐỘ DÀI: đổi hai dấu ngoặc nhọn thành `$` (ký tự định danh hợp lệ trong
 * JS) thay vì bọc hai gạch dưới mỗi bên. Bản cũ làm chuỗi DÀI RA 2 ký tự mỗi macro, nên VỊ TRÍ
 * lỗi acorn trả về không còn trỏ đúng vào chuỗi gốc — vô hại với ai chỉ đọc số dòng, nhưng bộ
 * vá khoá object (repairObjectKeys) cắt chuỗi THEO VỊ TRÍ nên lệch là vá nhầm chỗ.
 */
export function neutralizeStMacros(code: string): string {
  if (typeof code !== 'string' || code.indexOf('<') === -1) return code;
  return code.replace(
    /(^|[^\w$)\]])<(user|char|bot|charname|group|persona)>/gi,
    (_m, pre: string, name: string) => `${pre}$${name.toLowerCase()}$`,
  );
}

/**
 * (User 2026 — bug script TavernHelper) Parse JS "khoan dung" cho SCRIPT TRẦN của thẻ:
 * script 酒馆助手 là ES MODULE (mở đầu `import 'https://…jsdelivr…'` — theo template chuẩn cộng đồng)
 * hoặc script thường. Thử CẢ 2 mode — 1 trong 2 parse sạch là hợp lệ. Trả lỗi kèm SỐ DÒNG (loc)
 * của mode script (dễ đọc hơn) để chỉ đúng chỗ vỡ cho user.
 *
 * (bug 199) Macro SillyTavern (`<user>`…) được trung hoà trước khi parse — xem neutralizeStMacros.
 */
export function jsParseErrorAny(rawCode: string): { line: number; msg: string } | null {
  const e = jsParseErrorPosAny(rawCode);
  return e ? { line: e.line, msg: e.msg } : null;
}

/**
 * (bug 203) Bản đầy đủ của `jsParseErrorAny`: trả thêm VỊ TRÍ ký tự.
 *
 * Vì sao cần: bộ vá khoá object mất nháy (repairObjectKeys) phải cắt chuỗi ngay tại chỗ lỗi,
 * mà nó vốn gọi `jsParseError` — hàm này chỉ parse mode SCRIPT. Script 酒馆助手 chuẩn là ES
 * MODULE (dòng đầu `import … from 'https://…'`), nên với MỌI schema MVU nó luôn báo lỗi ở
 * dòng 1 ("'import' and 'export' may appear only with 'sourceType: module'"). Bộ vá lấy vị trí
 * đó, không nhận ra dạng hỏng nào, rồi dừng ⇒ CẢ BỘ VÁ CHƯA TỪNG CHẠY trên schema. Đó là lý do
 * lỗi "khoá dịch ra có khoảng trắng" (vd `Số Lượng: safeNum`) vẫn thoát ra tới tận bản xuất,
 * dù đã có bản vá riêng cho nó từ bugNeedFix/109.
 *
 * Vị trí trả về là vị trí trong CHUỖI GỐC: neutralizeStMacros giữ nguyên độ dài (xem trên).
 */
export function jsParseErrorPosAny(rawCode: string): { pos: number; line: number; msg: string } | null {
  const code = neutralizeStMacros(rawCode);
  const attempt = (opts: Parameters<typeof acornParse>[1]): { pos: number; line: number; msg: string } | null => {
    try {
      acornParse(code, opts);
      return null;
    } catch (e: unknown) {
      const err = e as { pos?: number; loc?: { line?: number }; message?: string };
      return {
        pos: typeof err?.pos === 'number' ? err.pos : -1,
        line: err?.loc?.line ?? -1,
        msg: String(err?.message || e),
      };
    }
  };
  const scriptErr = attempt({ ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true });
  if (!scriptErr) return null;
  const moduleErr = attempt({ ecmaVersion: 'latest', sourceType: 'module', locations: true });
  if (!moduleErr) return null;
  // (bugNeedFix/95) CẢ HAI mode đều fail ⇒ phải chọn thông điệp NÓI ĐÚNG chỗ hỏng.
  // Script 酒馆助手 là ES module (mở đầu `import 'https://…'`). Trước đây luôn trả lỗi mode
  // SCRIPT, nên user chỉ thấy "'import' and 'export' may appear only with 'sourceType: module'"
  // ở dòng 1 — câu này VÔ NGHĨA với ESM (import ở đó là đúng) và che mất lỗi THẬT (thường là
  // chuỗi bị vỡ ở giữa file do dịch). Với ESM, lỗi module-mode mới là lỗi thật.
  return isEsModuleScript(code) ? moduleErr : scriptErr;
}

/** Script có phải ES module không: có import/export ở ĐẦU DÒNG (không tính trong chuỗi/comment). */
export function isEsModuleScript(code: string): boolean {
  if (typeof code !== 'string') return false;
  return /^\s*(?:import|export)\s/m.test(code);
}

/**
 * Text có PHẢI là script JS trần không (để biết field nào cần guard cú pháp).
 * Quy tắc: KHÔNG chứa khối EJS `<%…%>` (đường EJS riêng lo), đủ dài, và có mật độ dấu hiệu code
 * (const/let/var/function/=>/;/{}) trên nhiều dòng — tránh bắt nhầm văn xuôi có 1-2 ký hiệu.
 */
export function isLikelyJsScript(text: string): boolean {
  if (typeof text !== 'string' || text.length < 60) return false;
  if (/<%[\s\S]*?%>/.test(text)) return false;
  const lines = text.split('\n');
  let codeLines = 0;
  for (const l of lines) {
    if (/\b(?:const|let|var|function|return|if|for|while)\b|=>|[;{}]\s*$/.test(l)) codeLines++;
    if (codeLines >= 5) return true;
  }
  return false;
}

/**
 * (bugNeedFix/128) Text có TÍN HIỆU JS THẬT không — khác với "vô tình parse được".
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật làm user kẹt vòng dịch-lại: entry [initvar] là YAML thuần
 *     叙事:
 *       标题: 待定
 *     夹带: {}
 * YAML chữ Hán VÔ TÌNH là JS hợp lệ (mỗi dòng thành labeled statement, `夹带: {}` còn đếm là
 * "dòng code" vì kết thúc bằng {}), nên lọt qua cả isLikelyJsScript lẫn acorn. Dịch sang tiếng
 * Việt → nhãn có dấu cách → "Unexpected token (1:7)" → guard tưởng dịch làm vỡ SCRIPT và bắt
 * dịch lại — trong khi đây chưa bao giờ là script. Hàm này đòi BẰNG CHỨNG CHỦ ĐỘNG của JS
 * (từ khoá/arrow/gọi hàm/gán), thứ YAML không bao giờ có.
 */
export function hasRealJsSignal(text: string): boolean {
  if (typeof text !== 'string') return false;
  return /\b(?:const|let|var|function|return|await|async|=>)\b|[\w$一-鿿]\s*\([^)]*\)\s*[;{.]|[^=!<>]=[^=>]/.test(text)
    && /\b(?:const|let|var|function|class|if|for|while|return|await|=>)\b/.test(text);
}

/**
 * (bugNeedFix/128) Vân tay lỗi cú pháp KHÔNG PHỤ THUỘC SỐ DÒNG/CỘT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Guard chống-retry-vô-ích (bug 95) so vân tay `dòng|thông điệp` — nhưng thông điệp của acorn
 * TỰ CHỨA "(85:11)", và giữa hai lượt dịch phần văn xuôi có thể xê dịch vài dòng (85 → 81 trong
 * bằng chứng user). Thế là "lỗi cũ" bị coi là "lỗi mới", đốt đủ 3 lượt retry MỖI LẦN CHẠY dù
 * kết cục y hệt — đúng cái "vòng lặp không thoát ra được" user tả. Dịch phẫu thuật gần như tất
 * định: cùng LOẠI lỗi nghĩa là cùng nguyên nhân, dòng lệch mấy cũng vậy. Vân tay chỉ giữ phần
 * chữ của thông điệp, mọi con số thay bằng #.
 */
export function jsErrorFingerprint(err: { line: number; msg: string } | null): string {
  if (!err) return '';
  return err.msg.replace(/\d+/g, '#').slice(0, 120);
}

/**
 * Script CHỈ gồm import + comment + dòng trắng (mẫu template cộng đồng: script tự cập nhật từ CDN
 * qua 1 dòng `import 'https://…jsdelivr…'`). Các script này DỊCH VÔ ÍCH (nội dung thật nằm trên CDN)
 * và đụng vào chỉ thêm rủi ro → caller bỏ qua không dịch.
 */
export function isImportOnlyScript(text: string): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
  if (stripped.length === 0) return false;
  return stripped.every((l) => /^import\b/.test(l) || /^export\s*\{?\s*\}?;?$/.test(l));
}

/**
 * Đếm số <script> vỡ cú pháp trong 1 đoạn HTML — dùng để CẢNH BÁO (không tự sửa).
 * Trả về { total, broken, brokenIndices }.
 */
export function checkHtmlScripts(html: string): { total: number; broken: number; brokenIndices: number[] } {
  const bodies = extractScriptBodies(html);
  const brokenIndices: number[] = [];
  bodies.forEach((b, i) => { if (!isJsSyntaxOk(b)) brokenIndices.push(i); });
  return { total: bodies.length, broken: brokenIndices.length, brokenIndices };
}
