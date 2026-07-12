// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.79.0';
export const APP_VERSION_NOTE = 'TỐI ƯU: PROMPT CACHING — khối RAG (biến theo từng field) được dời từ GIỮA xuống CUỐI system prompt, phần đầu (jailbreak + quy tắc + prompt nền) giờ GIỐNG HỆT giữa các call cùng loại field → prefix ổn định để implicit caching của Gemini/OpenAI trúng (rẻ + nhanh hơn; nội dung prompt không đổi, chỉ đổi vị trí — đã verify dịch full card 29/29 không lỗi, token không đổi). Kèm ĐO cache thật: đọc cachedContentTokenCount (Gemini) / cached_tokens (OpenAI) / cache_read_input_tokens (Claude) → panel hiện ⚡X cache + log cuối run ghi % input trúng cache. | 1.78: bộ thuật ngữ Tu tiên. | 1.77: 🩺 Kiểm tra tổng.';
