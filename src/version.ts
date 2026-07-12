// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.70.0';
export const APP_VERSION_NOTE = 'THÂN THIỆN NGƯỜI MỚI (đợt 4): (1) FIX ô API Key không Enter xuống dòng được để nhập key thứ 2 (textarea bị chuẩn hoá mỗi phím gõ nuốt mất dấu xuống dòng — áp cho cả provider phụ). (2) Khối API chính đổi thành card "Provider #1 (chính)" viền xanh ĐỒNG BỘ giao diện với Provider bổ sung (Loại + Base URL 2 cột, key, Load model, Model chính + RPM, Model phụ + Ngưỡng) — 2 mục ngang hàng thì giao diện giống nhau. (3) 3 nút preset (⚡/📖/🚀) giờ SÁNG VIỀN nút đang chọn — nhìn phát biết đang ở chế độ nào. (4) Sidebar rộng 400px + khung nội dung kéo sát cạnh phải màn hình (bỏ trần 1200px). (5) Mặc định tốt hơn cho người mới: "Dịch phẫu thuật" BẬT sẵn (bảo vệ regex/code khỏi vỡ), "Ngưỡng ký tự" = 10.000 (entry ngắn tự đi model phụ cho nhanh khi có model phụ). | 1.69: khử code đúp. | 1.68: UI phân tầng. | 1.67: gỡ knob chết + đa luồng triệt để.';
