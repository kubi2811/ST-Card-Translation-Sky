// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.0';
export const APP_VERSION_NOTE = 'Dịch Card — Chiến lược C (EJS Sync) Đợt 1b: SURGICAL EJS fix "dịch nửa vời". Entry lorebook-EJS (chữ + khối <%…%>) trước đây gửi NGUYÊN cho AI → dịch lẫn Hán-Việt / vỡ code. Nay khi bật Chiến lược C: MASK toàn bộ CODE (khối EJS, macro {{…}}, URL — kể cả chữ Hán bên trong code) thành token {{__ejs_N__}}, CHỈ gửi phần CHỮ (prose) cho AI rồi khôi phục code → AI không thấy/không đụng code, hết nửa vời. Chữ Hán trong code do từ điển EJS (covariance) lo. An toàn: nếu AI làm rơi token → giữ bản gốc field (không vỡ code) + cảnh báo. 6 test mới (mask/unmask round-trip + mô phỏng dịch prose). | 1.98: đồng nhất từ điển EJS + ejsSegmenter. | 1.97: fix tên riêng ngoài Trung + Kiểu tên.';
