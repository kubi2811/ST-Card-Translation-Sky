// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.1.6';
export const APP_VERSION_NOTE = 'Fix theo bugNeedFix/4 — Trợ Lý AI treo hàng chục phút / màn sleep: (1) NÚT DỪNG — mỗi lượt gửi có 1 AbortController; nút Gửi khi đang chạy đổi thành nút "Dừng" (đỏ), bấm HUỶ HẲN request đang chạy (chính + mọi vòng viết-tiếp) → thoát ngay, không retry, báo "Bạn đã dừng". Trước đây không có cách nào ngắt lượt đang chạy → phải chờ hoặc F5. (2) TIMEOUT CỨNG mỗi lane 120s (thêm hardTimeoutMs vào callProviderHedged): trước đây khi cả lane chính + lane hedge cùng treo (proxy nghẽn / MÀN SLEEP làm fetch treo) thì chờ tới timeout nội 5 PHÚT × 3 lần retry = hàng chục phút "im ru". Nay mỗi lane tự abort ở 120s → hedge/retry lane khác sớm; khi máy bừng dậy request cũ chết thì retry là xong (chỉ user-abort mới dừng hẳn, timeout cứng vẫn retry). i18n vi/en/zh. tsc + 437 test + build sạch. | 2.1.5: hết treo khi dịch card lớn / mở dict MVU.';
