// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.13';
export const APP_VERSION_NOTE = 'FIX (feedback user): đang DỊCH mà bấm Regex Manager / Trợ Lý AI / EJS Creator thì QUAY MÃI, không vào được. GỐC: các bảng này tải theo kiểu lazy — mỗi lần mở là 1 request HTTP tới CÙNG ORIGIN với các lượt gọi AI (/api-proxy/…); trình duyệt chỉ cho ~6 kết nối đồng thời mỗi trang, mà lúc dịch pool mở hàng chục call LLM treo rất lâu (có cái 524) ⇒ request tải bảng xếp hàng mãi không tới lượt ⇒ vòng xoay vô tận. FIX: nạp trước (warm-up) toàn bộ chunk bảng nặng ngay khi app rảnh — lúc mở chỉ đọc từ bộ nhớ, KHÔNG cần request nào, mở tức thì dù đang dịch (đo live: mở trong 360ms dù 8 kết nối đang treo). Kèm lời nhắc trong vòng xoay sau 6s giải thích + gợi ý bấm Dừng, phòng khi F5 giữa lúc dịch. | 1.99.12: nâng cấp Trợ Lý AI.';
