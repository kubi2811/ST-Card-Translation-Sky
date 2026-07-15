// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.22';
export const APP_VERSION_NOTE = 'Trợ Lý AI — P2 roadmap: VÒNG LẶP SINH + KÝ ỨC SỐNG. (1) LoopController thay continuation cũ (cả tab Chat lẫn MVU-Zod): phát hiện cắt dở (fence/XML/ngoặc lệch + kết thúc giữa câu), vòng sau chỉ gửi MỎ NEO ĐUÔI ~800 ký tự thay vì cả bài (đỡ phình token), GHÉP KHỬ LẶP (dò overlap suffix↔prefix, cắt phần AI lỡ viết lại), dừng rõ ràng: hoàn chỉnh / 8 vòng / quá 5 phút / 2 vòng dậm chân — chống lặp vô hạn đốt quota; 13 test. (2) Trích KÝ ỨC tự động sau lượt chat thành công (throttle 90s, model phụ, chạy nền, lỗi nuốt): fact/sở thích/thuật ngữ lưu IndexedDB kèm nguồn turnId. (3) Ký ức ĐỘNG nhập vào chỉ mục RAG — trợ lý nhớ xuyên phiên. (4) Panel 🧠 Ký ức (nút cạnh Xóa chat): xem/ghim 📌/xoá/Sao lưu-Nhập JSON + đếm xung đột đa tab; i18n 3 locale. Verify live: panel hiện đúng ký ức gieo + nút sao lưu. | 1.99.21: RAG MVP.';
