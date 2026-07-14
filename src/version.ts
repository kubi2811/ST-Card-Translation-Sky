// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.3';
export const APP_VERSION_NOTE = 'Dịch Card: FIX "Nghiệm thu" báo SAI hàng loạt "EJS template expression missing". Trước đây nó so EJS expression VERBATIM với card GỐC tiếng Trung — mà tên biến/chuỗi so sánh bên trong (getvar/=== "…") đã được DỊCH có chủ ý (Chiến lược B/C) → expression "khác" nên đếm là thiếu/vỡ (vd 78 lỗi ma). Nay so CẤU TRÚC: chuẩn hoá bỏ NỘI DUNG chuỗi (normalizeEjsExpr) rồi mới đối chiếu → expression cùng cấu trúc (chỉ khác chuỗi đã dịch) KHÔNG bị báo lỗi; chỉ còn lỗi THẬT (mất/đổi code). Code (if/=>/map) vẫn nguyên vẹn. 4 test mới. | 1.99.2: log lỗi chỉ rõ Key nào sai. | 1.99: surgical EJS mask code chỉ dịch prose.';
