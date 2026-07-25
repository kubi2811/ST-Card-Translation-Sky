// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.14.0';
export const APP_VERSION_NOTE = 'Tạo Card — Regex Lab hết cảnh chỉ-xem (goal 103): thêm nút [Sinh AI] — mô tả nhu cầu bằng lời thường (ẩn khối thinking, render bảng trạng thái…), AI lên kế hoạch cho bạn duyệt rồi sinh script, và LUẬT SẮT: mọi regex bị ép compile + CHẠY THỬ THẬT trên sample của Lab trước khi vào card, lỗi thì AI tự sửa có chốt hoàn nguyên, không sửa nổi thì không ghi gì cả; thêm nút [Bộ chuẩn từ schema] — một phát sinh trọn bộ Thanh trạng thái + Form mở đầu TĨNH từ MVUZOD schema (không tốn call AI, form ghi biến qua đúng Mvu API của goal 100, bấm lại là thay bản cũ không nhân đôi). Kèm fix bug engine: pattern không bọc /…/ trước đây bị coi là chuỗi thường và escape sạch — preview khớp khác hẳn SillyTavern thật và validator không bao giờ bắt được regex hỏng; nay parse đúng như ST.';
