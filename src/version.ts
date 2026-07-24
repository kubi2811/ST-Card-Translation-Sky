// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.11.0';
export const APP_VERSION_NOTE = 'Tạo Card — Đại tu MVUZOD (goal 100): hợp đồng MVU giờ đối chiếu từ SOURCE MagVarUpdate thật thay vì đoán — nhận cả 2 phương ngữ update (JSON Patch lẫn lệnh _.set) nên hết bắt lỗi oan; FIX TẬN GỐC bug 78/#162: Opening Form trước ghi biến bằng /setvar (kho biến chat của ST, stat_data không đổi) nay ghi đúng qua Mvu.parseMessage/replaceMvuData nên thanh trạng thái ăn giá trị thật; thêm harness giả lập đủ vòng initvar→form→status bar + bộ kiểm hợp nhất validateMvuCard chạy trong final_check của Auto Creator; bộ AI tự sửa của Game UI Studio có chốt hoàn nguyên: vòng sửa nào làm lỗi NỞ RA (3→500) là quay về bản trước, không bao giờ lấy bản tệ hơn làm nền (bug #42).';
