// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.4';
export const APP_VERSION_NOTE = 'Dịch Card: FIX gốc lỗi EJS "html broken / tag mismatch" (entry lớn bị chunk → AI rơi khối <%…%>, vd Mafia entry9 21→19 khối) + dẹp lỗi MA khi Nghiệm thu. 1) GUARD TOÀN VẸN KHỐI: mọi field, nếu bản dịch lệch số khối <%…%> so gốc → tự DỊCH LẠI (retry), hết retry thì GIỮ NGUYÊN bản gốc field đó (code Trung vẫn chạy) — KHÔNG bao giờ xuất card vỡ JS (cả đường single-field lẫn batch). 2) unmaskEjsCode nay bắt cả NHÂN BẢN + RƠI token cùng lúc (ok theo từng index, không chỉ đếm tổng). 3) Nghiệm thu: chỉ báo "EJS expression missing" khi field THỰC SỰ mất khối (số khối giảm) — field cùng số khối chỉ khác do chuỗi đã dịch/định dạng → HẾT hàng chục lỗi ma. 4) Nút "🔧 Sửa nhanh (revert EJS vỡ về gốc)" non-AI trong Xuất để chữa card CŨ tức thì. 5 test mới. | 1.99.3: normalizeEjsExpr. | 1.99: surgical EJS.';
