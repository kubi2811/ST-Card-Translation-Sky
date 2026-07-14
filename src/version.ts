// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.98.0';
export const APP_VERSION_NOTE = 'Dịch Card — Chiến lược C (EJS Sync) Đợt 1a: ĐỒNG NHẤT TỪ ĐIỂN EJS. Trước đây cùng 1 keyword ra nhiều dạng (thêm dấu / ký tự lạ / hoa-thường lệch) làm EJS/MVU gãy, dịch không đồng nhất. Nay: (1) canonicalizeEjsValue làm sạch value + enforceEjsDictConsistency gom cụm gần-giống về 1 dạng chuẩn duy nhất; (2) SWEEP cuối sau khi dịch tự đồng nhất từ điển EJS + enforce lại mọi field code/lorebook; (3) nút "🔗 Đồng nhất" (non-AI) trong panel Chiến lược C cho thẻ đã dịch trước. Thêm util ejsSegmenter (tách CODE/PROSE, round-trip an toàn) — nền cho fix "dịch nửa vời" (Đợt 1b: surgical dịch prose, cần chạy thật để verify). 22 test mới (segmenter round-trip + dict consistency). | 1.97: fix tên riêng ngoài Trung giữ nguyên + Kiểu tên. | 1.96: Từ điển thông minh + visualize.';
