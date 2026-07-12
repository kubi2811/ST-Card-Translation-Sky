// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.81.0';
export const APP_VERSION_NOTE = 'FIX XUẤT/ĐỌC PNG (từ báo cáo "xuất ra tiếng Trung dù dịch rồi"): (1) Đã audit toàn đường xuất PNG — chunk ghi đúng chuẩn (strip sạch chara+ccv3 cũ, ghi chara mới), bản dịch vào file đầy đủ; nguyên nhân báo cáo = chế độ ⚡ Dịch nhẹ chủ ý giữ ruột tiếng Trung → giờ khung Export hiện GHI CHÚ VÀNG giải thích rõ trước khi tải, hết tưởng lỗi. (2) Đọc PNG giờ ưu tiên chunk ccv3 (V3) rồi mới fallback chara (V2) — GIỐNG SillyTavern; card bị tool khác đóng gói lệch 2 chunk sẽ không còn dịch nhầm bản cũ. | 1.80: 👁 Xem như SillyTavern. | 1.79: prompt caching.';
