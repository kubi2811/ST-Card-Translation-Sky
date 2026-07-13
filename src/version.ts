// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.91.0';
export const APP_VERSION_NOTE = 'Dịch Card (theo yêu cầu user): KHÔI PHỤC tùy chọn dịch GỘP NHIỀU ENTRY / 1 lần gọi — ở Chiến lược Lorebook "Hàng loạt" nay có nút BẬT/TẮT "Gộp nhiều entry (batch)" + ô nhập SỐ ENTRY mỗi lô (2–50). Trước khi chạy tự KIỂM TRA TOKEN: ước lượng lô nặng nhất so trần output của model, cảnh báo màu (xanh an toàn / vàng lưu ý / đỏ vượt) + gợi ý batchSize an toàn ngay trong cấu hình và trong log. Các lô vẫn chạy ĐA LUỒNG song song qua pool RPM; lô quá lớn tự chia nhỏ để không tràn; log hiện RÕ đang chạy những entry nào trong mỗi batch. Tắt = mỗi entry 1 request (mặc định, an toàn nhất). | 1.90: Mod Card giao diện tối. | 1.89: Dịch Nhẹ dịch [mvu update].';
