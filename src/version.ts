// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.9.2';
export const APP_VERSION_NOTE = 'Dịch Card giờ VÁ luôn regex bên trong script thẻ: regex khớp đúng nhãn tiếng Trung mà script tự render ra (ví dụ card Mythic dùng /(小总结|大总结)#số/ để dựng memory chip) sẽ được thêm nhánh tiếng Việt, giữ nguyên nhánh Hán, compile thử — vỡ thì hoàn nguyên. Trước đó dịch nhãn xong là regex hết khớp và chức năng chết IM LẶNG, không lỗi không cảnh báo.';
