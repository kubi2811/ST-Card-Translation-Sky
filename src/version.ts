// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.12.0';
export const APP_VERSION_NOTE = 'Tạo Card — EJS Studio mới (goal 101): thêm chế độ MẶC ĐỊNH “AI tự quyết” — bạn chỉ gõ một yêu cầu bằng lời thường, AI tự phán đoán cần mấy khối EJS rồi TRÌNH KẾ HOẠCH (phạm vi + số call) cho bạn duyệt trước khi chạy; mọi code sinh ra qua kiểm tự động (cú pháp EJS + biến PHẢI có trong MVUZOD schema, không cho bịa biến) và tự sửa tối đa 3 vòng theo luật hội tụ: vòng sửa nào làm lỗi tăng là hoàn nguyên ngay; entry được ghi thẳng vào worldbook kèm nút Hoàn tác. Studio 3 panel cũ vẫn nguyên trong chế độ Nâng cao. Nền tảng là khung goalAgent dùng chung sẽ tái dùng cho đại tu Lorebook/Regex/Auto sắp tới. Kèm fix nhỏ: settings đời cũ thiếu mảng stop không làm crash lúc gọi AI nữa.';
