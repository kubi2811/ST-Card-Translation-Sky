// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.1.4';
export const APP_VERSION_NOTE = '2 cải tiến UI theo bugNeedFix/35 + Ký ức: (35) HIỆN TRẠNG THÁI BẬT/TẮT REGEX — Regex Manager giờ mỗi script có công tắc bật/tắt (đọc cờ `disabled` của SillyTavern): tắt thì gạch ngang tên + mờ đi + badge TẮT, bấm công tắt để đảo cờ ghi thẳng vào card (chỉ đổi cờ — DỊCH vẫn xử lý tất cả regex như thường); thanh dưới thêm "{x} bật · {y} tắt". User nhìn được regex nào đang chạy rồi tự quyết dịch sao. (KÝ ỨC) (a) NÚT "XOÁ TẤT CẢ" trong panel 🧠 Ký ức (có xác nhận + báo số đã xoá; thêm clearAllMemories vào memoryStore + sync đa tab type "clear"); (b) FIX XOÁ 1 MỤC NHẢY VỀ ĐẦU — trước đây xoá/ghim gọi reload() (bật loading → thay cả mảng → khung cuộn tụt về đầu). Nay cập nhật LẠC QUAN tại chỗ (filter/patch đúng 1 dòng) giữ nguyên vị trí cuộn. i18n đủ vi/en/zh. | 2.1.3: fix trắng màn preview + AI đọc bản dịch + chống bịa code.';
