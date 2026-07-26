// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.16.4';
export const APP_VERSION_NOTE = 'Dịch Card — fix bug 107 (gõ tiếng Việt trong ô Bản dịch bị lặp dấu: “Tân Thuận” ra “Taân Thuaâận”, bấm Backspace/Space thì con trỏ nhảy về cuối). Nguyên nhân: ô đó lưu vào bộ nhớ sau MỖI phím, trong khi bộ gõ tiếng Việt cần tổ hợp nhiều phím mới ra một chữ — lần lưu giữa chừng làm hỏng tổ hợp và đặt lại con trỏ. Nay ô nhập giữ chữ ở bản nháp trong lúc bạn gõ, tuyệt đối không lưu khi bộ gõ đang ghép dấu, chỉ lưu khi bạn ngưng tay khoảng 0,4 giây hoặc rời ô — nên gõ mượt như ô văn bản bình thường mà vẫn không mất chữ (rời trang giữa chừng cũng lưu nốt). Bản dịch mới từ AI hay thao tác hoàn tác vẫn hiện vào ô như cũ, trừ khi bạn đang sửa dở thì tool không giật chữ khỏi tay bạn.';
