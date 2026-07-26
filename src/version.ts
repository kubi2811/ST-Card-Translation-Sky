// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.16.5';
export const APP_VERSION_NOTE = 'Tạo Card — fix bug 96 (AI Sinh Theo Batch báo “AI trả về không phải JSON array” hàng loạt, phải thử lại liên tục). Ba nguyên nhân: (1) lệnh gọi batch bị ép chế độ trả JSON-object, mà chế độ này CẤM mảng ở cấp cao nhất trong khi prompt lại đòi mảng entry — nay bỏ ép; (2) bộ bóc JSON gặp mảng không phải entry (ví dụ mảng “keys” bên trong một entry trần) là thoát luôn, các cách bóc còn lại không bao giờ chạy — nay trượt thì thử tiếp; (3) bổ sung cứu dữ liệu khi AI trả MỘT entry trần, trả NDJSON mỗi dòng một entry, hoặc mảng bị cắt cụt do chạm giới hạn token. Log giờ in luôn đoạn AI thực sự trả về và cảnh báo khi output bị cắt, để biết đúng bệnh thay vì chỉ thấy “không phải JSON array”.';
