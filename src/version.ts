// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.94.0';
export const APP_VERSION_NOTE = 'Dịch Card: thêm POPUP HƯỚNG DẪN sau khi dịch xong — báo cho dịch giả nên bấm gì tiếp theo cho dễ dùng: 🩺 Sức khoẻ thẻ (khuyên dùng, non-AI) → 🔗 Đồng nhất tên biến MVU (thẻ cũ) → 🤖 AI Verify (CHỈ khi nghi lỗi ngữ nghĩa). Mỗi bước có nút tự cuộn tới đúng panel + nháy sáng viền; có ô "Đừng hiện lại". | 1.93: FIX lỗi nghiêm trọng — ĐỒNG NHẤT TÊN BIẾN MVU về 1 dạng "Họ Tên" (bỏ dấu _/-), tự áp khi dịch + nút non-AI cho thẻ cũ, Zod key có space tự bọc nháy. | 1.92: model phụ CHỈ chạy entry ≤ ngưỡng ký tự. | 1.91: dịch gộp nhiều entry/batch.';
