// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.16.1';
export const APP_VERSION_NOTE = 'Dịch Card — fix bug 95 (dịch MVU ZOD trong TavernHelper mất 1-2 tiếng vì thử lại vô ích): script 酒馆助手 vốn là ES module nên khi bản dịch hỏng, tool lại báo lỗi của chế độ script thường — “import and export may appear only with sourceType: module” ở dòng 1 — câu này vô nghĩa với ESM và che mất chỗ hỏng THẬT (thường là một chuỗi bị vỡ ở giữa file). Nay script ESM được chẩn đoán bằng đúng chế độ module nên báo đúng dòng lỗi thật. Kèm chốt chống thử lại vô ích: dịch phẫu thuật là phép thay thế theo từ điển gần như tất định, chạy lại cho ra y hệt — nên nếu dịch lại vẫn ra ĐÚNG lỗi cũ (cùng dòng, cùng thông điệp) thì dừng ngay, giữ nguyên bản gốc và nói rõ phải sửa tay/chỉnh từ điển, thay vì đốt hết lượt thử lại.';
