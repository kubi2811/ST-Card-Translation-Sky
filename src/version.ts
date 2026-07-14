// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.6';
export const APP_VERSION_NOTE = 'Dịch Card: nút "Đồng nhất tên biến MVU" nay ÉP luôn hoa/thường theo từ điển vào TEXT các field đã dịch (enforceVariableCasing — trước chỉ chạy lúc dịch) + vá lỗ hổng casing trong MẢNG path (_.get(stat, [\'Tiến trình\', \'Giai đoạn\']) — Pass 3 cũ chỉ bắt mảng 1 phần tử) → dẹp 8 cảnh báo "mvu inconsistent Tiến trình/Tiến Trình" của Kiểm tra tổng trên card Mafia. 2 test mới. | 1.99.5: quy luật keyword EJS + prune dict + guard EJS theo chunk + nút Áp dict vào bản dịch.';
