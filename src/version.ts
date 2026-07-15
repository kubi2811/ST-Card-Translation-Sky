// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.17';
export const APP_VERSION_NOTE = 'Trợ Lý AI — FIX cắt cụt file đính kèm ~100k ký tự (bug 23). GỐC BUG: handleFileUpload cắt slice(0,100000) NGAY LÚC UPLOAD → dữ liệu sau 100k mất VĨNH VIỄN, AI không bao giờ thấy (user tưởng AI đọc thiếu nhưng thật ra tool đã vứt data). FIX: KHÔNG cắt nữa — file lớn tự CHẺ THÀNH CÁC PHẦN ~90k tại ranh giới dòng (utils/attachmentParts.ts + 5 test, bảo toàn 100%: ghép các phần == file gốc); mỗi phần 1 chip có badge i/N (hover có giải thích), gỡ được từng phần; ngữ cảnh gửi AI dán nhãn "PHẦN i/N — xử lý TRỌN VẸN, KHÔNG tóm tắt"; chat tự báo đã chia mấy phần + cảnh báo khi tổng đính kèm >360k ký tự (nên xử lý từng phần). Áp cho CẢ tab Trò Chuyện lẫn tab Tạo MVU-Zod. Verify live: file 721.779 ký tự → 9 phần, giữ đủ 721.779 (bug cũ còn đúng 100.000). | 1.99.16: fix code văng khỏi khung chat.';
