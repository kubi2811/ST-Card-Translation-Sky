// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.92.0';
export const APP_VERSION_NOTE = 'Dịch Card (theo yêu cầu user): ĐỔI cách dùng MODEL PHỤ. BỎ HẲN tính năng "model chính treo/hết RPM lâu quá → nhảy sang model phụ" (kể cả khi retry) — entry DÀI giờ LUÔN chờ & chạy model chính, không bị model phụ (flash) thay thế làm giảm chất lượng. Model phụ giờ CHỈ kích hoạt cho entry có số ký tự ≤ Ngưỡng ký tự bạn nhập (vd nhập 1000 → chỉ entry ≤1000 ký tự mới đi model phụ; ngưỡng 0 = tắt model phụ). Model phụ tự "dò" mọi entry ngắn thoả điều kiện và chạy song song đa luồng qua pool, không cần theo thứ tự. Ngân sách luồng chỉ cộng RPM phụ khi có ngưỡng. | 1.91: khôi phục dịch gộp nhiều entry/batch + token check. | 1.90: Mod Card giao diện tối.';
