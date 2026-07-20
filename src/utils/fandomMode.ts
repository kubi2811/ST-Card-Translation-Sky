/**
 * fandomMode.ts — 🎌 CHẾ ĐỘ ĐỒNG NHÂN, trạng thái dùng chung cho MỌI tầng prompt.
 *
 * Vì sao là module RIÊNG (không nhét vào apiClient/masterPrompt): luật tên riêng bị hardcode rải
 * rác ở rất nhiều nơi — Chiến lược B (mvuSync), Chiến lược C (ejsSync), surgical fallback, aiVerify.
 * Các module đó không import store/apiClient (dễ vòng). Đây là module LÁ, không import gì cả, nên
 * ai cũng dùng được an toàn.
 *
 * Bối cảnh bug (user 19/07): card đồng nhân là card TIẾNG TRUNG viết về IP Nhật/Hàn. Mọi prompt đều
 * có câu "Chinese proper nouns → Sino-Vietnamese" ⇒ 雪乃 ra "Tuyết Nãi" thay vì "Yukino". Ngay cả
 * kiểu tên Romaji cũng chưa cứu được vì nó bảo "Chinese → Pinyin" ⇒ "Xue Nai".
 */

let _on = false;
let _name = '';

export function setFandom(on: boolean, name = ''): void {
  _on = !!on;
  _name = name || '';
}
export function isFandom(): boolean { return _on; }
export function fandomName(): string { return _name; }

/**
 * Khối luật CHỐNG HÁN-VIỆT HOÁ TÊN — nối vào CUỐI prompt (vị trí ưu tiên cao nhất) ở những chỗ
 * có luật tên hardcode. Trả '' khi tắt ⇒ mọi hành vi mặc định giữ nguyên 100%.
 */
export function fandomNameOverride(): string {
  if (!_on) return '';
  const ip = _name.trim();
  return `

[🎌 FAN-FICTION / DOUJIN MODE — THIS OVERRIDES EVERY PROPER-NOUN RULE ABOVE]
This card is fan-fiction of an existing work${ip ? `: "${ip}"` : ''}. Character/place/organization names are ESTABLISHED CANON, not ordinary Chinese words.
- Use the canonical Latin-script name the fandom uses (Japanese work → Romaji reading; Korean → Revised Romanization; Western → original spelling).
- NEVER apply Sino-Vietnamese (Hán-Việt) to a canon name just because it is written in Han characters: 雪乃 → "Yukino" (NEVER "Tuyết Nãi"), 比企谷 → "Hikigaya" (NEVER "Tỉ Xí Cốc").
- NEVER use Pinyin for a Japanese-work name (雪乃 is "Yukino", NOT "Xue Nai").
- If unsure of the canonical reading, KEEP THE NAME UNCHANGED in its original script. A wrong localized name is far worse than an untranslated one.
- Never "correct" a name into a different form later — keep one exact spelling everywhere.`;
}
