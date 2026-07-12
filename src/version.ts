// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.87.0';
export const APP_VERSION_NOTE = 'Tạo Card — Lorebook "AI Chỉnh Sửa" fix 3 lỗi (bug #9): (1) TÔN TRỌNG số batch song song đã cấu hình (trước đây luôn kẹt mặc định ~5 dù chỉnh khác) — nay = min(giá trị bạn nhập, trần pool RPM). (2) Nút "Tạm dừng"/"Dừng hẳn" GIỜ CÓ TÁC DỤNG THẬT: hủy luôn request đang chạy giữa chừng thay vì phải đợi hết vòng, dừng là dừng ngay. (3) CHỐNG MẤT TIẾN TRÌNH: bản xem trước (các đề xuất AI) + cấu hình được lưu tự động, lỡ đổi tab hay refresh vẫn khôi phục lại, không phải chạy lại từ đầu. | 1.86: preview mạnh hơn (render app toàn màn hình + 🎲 AI tạo data test). | 1.85: fix popup gợi ý tự tắt.';
