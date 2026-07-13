// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.95.0';
export const APP_VERSION_NOTE = 'Dịch Card — dọn Cấu hình Provider + FIX đa-key: (1) BỎ field "Loại": tự nhận diện OpenAI/Gemini/Claude từ Base URL (badge hiện loại đã nhận). (2) Ô Model giờ là PICKLIST đổ ĐỦ model sau khi Load (hết lỗi "thành ô search chỉ hiện model chứa flash"), thêm mục "Nhập thủ công" cho proxy/local. (3) FIX đa key trong 1 provider bị TREO / chỉ dùng 1 key: mỗi (provider × key) giờ là 1 LANE độc lập — nhịp RPM + cooling RIÊNG; 1 key 429 KHÔNG làm cả provider nghỉ; nhét 5 key = 5 luồng song song. (4) Nhãn lane fail "⚠ lỗi ×N" → "⚡ PVP ×N" + tooltip: đây là tranh proxy CHUNG (429/nghẽn), KHÔNG phải lỗi thẻ/key của bạn. (5) Cập nhật NHANH hơn: quét nền 3 phút/lần + quét NGAY khi quay lại tab → push xong thấy badge +N trong vài giây (trước là 30 phút). | 1.94: popup hướng dẫn sau khi dịch. | 1.93: đồng nhất tên biến MVU về "Họ Tên".';
