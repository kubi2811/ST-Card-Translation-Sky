// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.17.2';
export const APP_VERSION_NOTE = 'Quét tổng sau đợt fix lớn: cả 5 app biên dịch sạch, 1.545 test xanh (Dịch Card 921, Tạo Card 606, Tạo Preset 18), build đủ mod-card lẫn crawler. Vá nốt vết sót cuối của bug 125 bắt được khi quét: THƯ VIỆN TEMPLATE trong EJS Studio còn 18 chỗ dạy setEntryEnabled — user bấm chèn template là tự tay nhét lỗi đỏ vào thẻ dù mọi đường sinh AI đã chặn từ trước; kèm snippet getwi() thiếu await nên in ra [object Promise] thay vì nội dung entry. Cả 6 template điều khiển viết lại theo mô hình kích hoạt thật (entry tắt sẵn, bật bằng await activewi), và từ nay TOÀN BỘ thư viện template phải qua đúng bộ kiểm dùng chung với code AI sinh — thêm template dạy API bịa là test đỏ ngay, không đợi user báo.';
