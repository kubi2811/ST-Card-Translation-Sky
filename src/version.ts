// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.11';
export const APP_VERSION_NOTE = 'Xem như SillyTavern: shim đối chiếu SOURCE THẬT của JS-Slash-Runner (predefine.js) — bổ sung 3 global script card được cấp trong ST thật mà preview thiếu: 1) YAML (parse/stringify — alias sang js-yaml; card gọi YAML.parse trước đây chết im lặng); 2) EjsTemplate stub (ST-Prompt-Template); 3) getScriptId/getScriptName trả ID thật thay vì undefined. Kết quả trên card Long Tộc: panel trạng thái Thiên Ý (Tổng Quan/Ngôn Linh/Hồ Sơ Thân Phận) giờ MỞ ĐƯỢC với data từ initvar — trước chỉ hiện quả cầu. 0 lỗi script. | 1.99.10: nạp script TavernHelper của card vào preview.';
