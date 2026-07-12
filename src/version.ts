// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.76.0';
export const APP_VERSION_NOTE = 'MỚI: ĐẾM TOKEN THẬT. App đọc usage/usageMetadata từ chính response API (OpenAI-compatible / Gemini / Claude, cả stream lẫn non-stream) thay vì đoán theo ký tự: panel Luồng đang chạy hiện 🧮 tổng vào/ra realtime + token từng lane; dịch xong log tổng kết "Token cả lượt dịch: X vào / Y ra, N call" chi tiết theo từng model. API/proxy nào không trả usage thì tự ước lượng và đánh dấu "~" cho biết là số ước. Dùng key chung giờ biết chính xác mình đốt bao nhiêu. | 1.75: dịch bản update card chỉ dịch phần thay đổi (♻ tái dùng theo nội dung). | 1.74: Pha 0 bảng tên riêng tự động.';
