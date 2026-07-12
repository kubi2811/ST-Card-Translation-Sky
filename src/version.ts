// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.86.0';
export const APP_VERSION_NOTE = 'PREVIEW MẠNH HƠN: (1) Fix UI vỡ — card "app toàn màn hình" (wizard tạo NV, game UI position:fixed/100vh) giờ render THẲNG vào iframe giống SillyTavern thật, hết bị bong bóng chat bóp méo vào cột hẹp. (2) MỚI 🎲 AI tạo data test: gọi API đã cấu hình điền GIÁ TRỊ MẪU thực tế cho biến trạng thái (như nhân vật đang chơi giữa chừng) → thanh trạng thái/game UI hiện SỐ THẬT thay vì toàn "Chưa Biết"; dùng được cả cho card chưa chơi lẫn card KHÔNG có [initvar] (tự suy cấu trúc biến từ script). AI chỉ đổi giá trị, giữ nguyên tên biến. | 1.85: fix popup gợi ý tự tắt. | 1.84: lỗi script tra ra field + So 2 bản.';
