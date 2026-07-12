// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.75.0';
export const APP_VERSION_NOTE = 'MỚI: DỊCH BẢN UPDATE CỦA CARD — CHỈ DỊCH PHẦN THAY ĐỔI. Nạp card phiên bản mới (V2.2 → V2.3), app tự quét cache tiến trình các card cũ, field nào NỘI DUNG KHÔNG ĐỔI thì bê thẳng bản dịch cũ sang (match theo nội dung nên lorebook đảo/chèn entry vẫn khớp), kèm từ điển biến MVU/EJS của phiên bản cũ để tên biến nhất quán. Field Editor gắn badge ♻ cho biết bản dịch bê từ đâu. Card update thường chỉ đổi 10-20% → tiết kiệm ~80% thời gian + token. Tắt chung công tắc Bộ nhớ dịch. Kèm fix: khôi phục cache giờ đợi parse xong hẳn (hết race 500ms trượt cache với card lớn). | 1.74: Pha 0 bảng tên riêng tự động. | 1.73: popup gợi ý cấu hình sau import.';
