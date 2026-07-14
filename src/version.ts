// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.8';
export const APP_VERSION_NOTE = 'Strategy B (Sync MVU) — sửa UI theo yêu cầu: hàng biến giờ để "ô gốc → ô đã dịch" NẰM CẠNH NHAU trên cùng 1 dòng (cả 2 flex:1 + minWidth:0 nên co vừa khung, HẾT cuộn ngang kéo qua kéo lại); badges (nguồn/độ tin/loại) + mô tả dồn xuống dòng dưới nên không giành chỗ ngang. Toolbar: thêm flexWrap + search minWidth + nút flexShrink:0 → nút Import/Export KHÔNG còn tràn khỏi khung. Hàng "thêm biến mới" cũng minWidth:0. | 1.99.7: fix triệt để script TavernHelper vỡ + Glossary xoá hàng loạt.';
