// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.97.0';
export const APP_VERSION_NOTE = 'Dịch Card — FIX dịch TÊN RIÊNG ngoài tiếng Trung + thêm KIỂU TÊN: (1) Tên phương Tây/ngoài Trung (William, Titan, Arthur) trước bị đọc Hán-Việt bậy (Uy Lợi Nhĩ, Thái Thản) → NAY LUÔN giữ nguyên chữ Latin gốc. Gốc lỗi: bảng tên Pha 0 thiếu luật này nên đóng băng SAI vào Từ điển rồi lan ra; đã vá + gom về 1 nguồn luật chung. (2) Thêm chọn "Kiểu tên riêng": Hán-Việt (mặc định VN) / Romaji-Quốc tế (tên nhân vật → phiên âm quốc tế, hợp card dùng tên Nhật-IP: 小白→Shiro) / Giữ nguyên. Áp cho CẢ bảng tên (Pha 0) lẫn dịch chính; mục Từ điển bạn tự gõ LUÔN thắng. (3) Badge "Kiểu tên" hiển thị trong panel Bộ quy tắc dịch. | 1.96: Từ điển thông minh (học biệt danh khi dịch) + visualize. | 1.95: dọn Cấu hình Provider + fix đa-key.';
