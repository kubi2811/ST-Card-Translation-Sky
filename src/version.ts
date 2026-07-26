// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.16.2';
export const APP_VERSION_NOTE = 'Dịch Card — fix bug 108 (nhập card xong entry EJS bị BỎ QUA 100%, không dịch gì): entry kiểu <%_ getvar(...) _%> có vỏ toàn từ khoá tiếng Anh (var/getvar/await/getwi) nên bộ đoán ngôn ngữ kết luận đây là entry tiếng Anh, rồi luật tôn trọng hợp đồng FROM/TO nuốt trọn nó — trong khi ruột vẫn còn nguyên tên biến MVU và tên worldbook tiếng Trung phải dịch. Nay field CODE (EJS/JS/regex) chỉ được bỏ qua khi RUỘT đã sạch ký tự nguồn; văn xuôi tiếng Anh/Nhật trong thẻ Trung vẫn được bỏ qua đúng như trước.';
