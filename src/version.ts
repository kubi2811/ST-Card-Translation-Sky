// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.9.3';
export const APP_VERSION_NOTE = 'Sửa hỏng ký tự UTF-8 khi lưu cache tiến trình (fs-cache): body vài MB bị ghép sai ở ranh giới chunk TCP làm ký tự tiếng Việt nhiều byte (đ, ổ…) biến thành ký tự thay thế. Nay gom Buffer rồi decode một lần. Ảnh hưởng resume Dịch Script/Preset và mọi payload lớn qua /api/progress.';
