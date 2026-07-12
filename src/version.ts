// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.85.0';
export const APP_VERSION_NOTE = 'FIX ĐÚNG GỐC: popup gợi ý cấu hình TỰ TẮT sau khi import. Thủ phạm thật (không phải click-through như tưởng ở 1.82): tính năng tái dùng bản dịch giữa phiên bản (1.75) chạy async sau khi import, tìm thấy field trùng nội dung với card cũ thì đánh dấu "done" → popup tưởng "user đang dở việc" nên tự đóng. Nay popup được KÍCH HOẠT TƯỜNG MINH khi import card mới (tách hẳn khỏi trạng thái field) — chỉ không hiện khi thật sự khôi phục tiến trình dịch cũ của chính card đó. | 1.84: lỗi script preview tra ra đúng field + ⇄ So 2 bản. | 1.83: 🧪 chạy script + data test.';
