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
 * (User 2026 — bug script TavernHelper) Parse JS "khoan dung" cho SCRIPT TRẦN của thẻ:
 * script 酒馆助手 là ES MODULE (mở đầu `import 'https://…jsdelivr…'` — theo template chuẩn cộng đồng)
 * hoặc script thường. Thử CẢ 2 mode — 1 trong 2 parse sạch là hợp lệ. Trả lỗi kèm SỐ DÒNG (loc)
 * của mode script (dễ đọc hơn) để chỉ đúng chỗ vỡ cho user.
 */
export function jsParseErrorAny(code: string): { line: number; msg: string } | null {
  let scriptErr: { line: number; msg: string } | null = null;
  try {
    acornParse(code, { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true });
    return null;
  } catch (e: unknown) {
    const err = e as { loc?: { line?: number }; message?: string };
    scriptErr = { line: err?.loc?.line ?? -1, msg: String(err?.message || e) };
  }
  let moduleErr: { line: number; msg: string } | null = null;
  try {
    acornParse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    return null;
  } catch (e: unknown) {
    const err = e as { loc?: { line?: number }; message?: string };
    moduleErr = { line: err?.loc?.line ?? -1, msg: String(err?.message || e) };
  }
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
