// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.16.3';
export const APP_VERSION_NOTE = 'Dịch Card — fix bug 109 (“mất mục khi dịch tool”): thật ra không mất chữ nào, mà cả khối script của thẻ bị CHẾT nên giao diện biến mất sạch. Nguyên nhân: trong JavaScript, chữ Hán là tên biến hợp lệ nên thẻ gốc viết được { AP上限: 8 } và obj.stats.AP上限 = 10 mà không cần nháy; dịch sang tiếng Việt thành APGiới hạn / APtối đa — có khoảng trắng — thì thành lỗi cú pháp. Nay sau mỗi lần dịch, tool tự dò đúng vị trí lỗi và vá: khoá object được bọc nháy, truy cập thuộc tính đổi sang dạng ngoặc vuông, rồi kiểm lại bằng bộ phân tích cú pháp — chỉ nhận bản vá khi nó thật sự chữa được, code đang lành thì không đụng tới. Đo trên chính file user gửi: script từ VỠ thành sạch hoàn toàn (3 chỗ hỏng).';
