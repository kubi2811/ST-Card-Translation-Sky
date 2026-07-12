// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.71.0';
export const APP_VERSION_NOTE = 'SỬA BUG #4 (card AI帝国1.1 Dịch nhẹ xong vỡ MVU "không hỗ trợ 额外模型解析"): gốc rễ — Strategy B dịch tên biến MVU ra tiếng Việt CÓ DẤU CÁCH rồi áp vào script Zod ở vị trí object key KHÔNG QUOTE (`叙事:` hợp lệ nhưng `Tự Sự:` là SyntaxError) → schema chết → framework MVU báo card không hỗ trợ. Fix kép: (1) Dịch nhẹ KHÔNG đổi tên biến MVU nữa — đúng nghĩa: ruột card (content/script/biến) giữ 100% tiếng gốc, AI tự đọc và trả lời tiếng Việt, logic không bao giờ bị đụng; (2) guard toàn cục cho mọi chế độ: tên biến dịch ra tự thay dấu cách bằng "_" (Tự_Sự) khi tên gốc là identifier + prompt dạy AI đặt tên nối "_" ngay từ đầu. +5 test hồi quy từ chính schema card lỗi. | 1.70: thân thiện người mới (API card đồng bộ, fix Enter key, preset highlight, layout, mặc định surgical+ngưỡng). | 1.69: khử code đúp. | 1.68: UI phân tầng.';
