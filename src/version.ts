// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.88.0';
export const APP_VERSION_NOTE = 'Sửa 3 bug (từ file bug #10-#12): (10) DỊCH CARD — bảng Glossary/tên riêng tự sinh cho card cũ nay TỰ DỌN khi Gỡ card / Xoá cache (mục bạn tự gõ vẫn giữ), hết cảnh card mới dính tên card trước. (11) TẠO CARD — Export card kèm "Inject Tavern Helper Scripts": script MVU + Cấu trúc biến trước đây THIẾU field (type/id/info/button/data) nên load vào SillyTavern là lỗi phần Tavern Helper; nay xuất đủ chuẩn (dùng lại card thường không inject vẫn ổn như cũ). (12) DỊCH CARD — card THƯỜNG (không MVU/EJS) không còn bị tự nhận "chế độ MVU/EJS" và tự chế key: chỉ card thật sự có biến MVU (initvar/Zod)/EJS mới chạy Chiến lược B/C, đồng thời dọn từ điển MVU/EJS dây từ card trước. | 1.87: Refiner tôn trọng số batch + pause/stop + lưu tiến trình.';
