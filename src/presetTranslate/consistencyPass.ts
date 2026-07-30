// ─── Thay thế toàn cục DETERMINISTIC sau AI (pure) ───
// Tên biến {{setvar}}/tag XML phải NHẤT QUÁN xuyên 253 prompts + 36 regex + script nhúng
// (mẫu thật: 正文→Chính văn đúng 148/148 chỗ). AI dịch song song không thể tự nhất quán
// ⇒ code thay toàn cục theo dict Pha 0, chạy ĐÈ lên cả output AI để nghiền phi-nhất-quán.
import type { PresetDict } from './types';

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Đổi tên biến {{setvar::旧}}/{{getvar::旧}} → tên mới. Delimited bởi `::` nên thay chuỗi
 * thẳng là NGUYÊN TỬ tuyệt đối — không thể sót vế setvar mà trượt vế getvar.
 */
export function applyVarRenames(text: string, vars: Record<string, string>): string {
  let out = text;
  // Key DÀI thay trước: nếu từ điển có cả 好感 và 好感度 mà thay 好感 trước thì
  // {{setvar::好感度}} biến thành {{setvar::affection度}} — tên biến hỏng, dây setvar/getvar
  // đứt câm lặng. (Bug do review chéo phát hiện, đã có test khoá.)
  const keys = Object.keys(vars).filter((k) => k && vars[k] && k !== vars[k]).sort((a, b) => b.length - a.length);
  for (const zh of keys) {
    const en = vars[zh];
    // (bug 164 · HM0-A) PHẢI PHỦ ĐỦ CẢ 7 MACRO, KHÔNG CHỈ setvar/getvar.
    // Bộ macro app tự khai (và macroResolver.ts xử đủ) gồm 7 cái dưới đây. Bản cũ chỉ đổi tên
    // setvar + getvar, nên nếu một biến được dịch thì `{{setvar::好感度}}` thành
    // `{{setvar::affection}}` còn `{{addvar::好感度::1}}` vẫn giữ chữ Hán — chỗ GHI và chỗ TĂNG trỏ
    // vào hai biến khác nhau. Không lỗi nào báo, chỉ là số liệu sai dần.
    // Delimiter `::` nằm ngay sau tên macro nên thay chuỗi thẳng vẫn nguyên tử như cũ.
    for (const m of VAR_MACROS) {
      out = out.split(`{{${m}::${zh}`).join(`{{${m}::${en}`);
    }
  }
  return out;
}

/**
 * (bug 164 · HM0-A) Bảy macro biến của SillyTavern mà app này hỗ trợ.
 * Nguồn: chính `src/utils/macroResolver.ts` — nơi duy nhất thực thi chúng. Thêm macro mới thì thêm
 * ở CẢ hai nơi, không thì rename lại hở đúng chỗ mới thêm.
 */
export const VAR_MACROS = [
  'setvar', 'getvar', 'addvar', 'incvar', 'decvar', 'setglobalvar', 'getglobalvar',
] as const;

/**
 * Đổi tên tag: cả dạng delimited (<旧>, </旧>, <旧␣, ### 旧) LẪN dạng trần — mẫu thật dịch
 * 正文 nhất quán ở cả văn xuôi ("trong khối 正文 hãy…"). Key DÀI thay trước để 状态面板
 * không bị 面板 ăn mất một nửa.
 */
export function applyTagRenames(text: string, tags: Record<string, string>): string {
  let out = text;
  const keys = Object.keys(tags)
    .filter((k) => k && tags[k] && k !== tags[k])
    .sort((a, b) => b.length - a.length);
  for (const zh of keys) {
    const vi = tags[zh];
    out = out.replace(new RegExp(escRe(zh), 'g'), vi);
  }
  return out;
}

/** Áp trọn bộ dict (vars trước — tránh tag trần cắn vào tên biến trong {{setvar::…}}). */
export function applyPresetDict(text: string, dict: PresetDict): string {
  return applyTagRenames(applyVarRenames(text, dict.vars), dict.tags);
}

/** Tên biến mới phải là identifier ASCII an toàn; đề xuất bậy → auto-slug. */
export function sanitizeVarName(proposed: string, fallback: string): string {
  const cleaned = proposed.trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(cleaned)) return cleaned;
  return fallback;
}
