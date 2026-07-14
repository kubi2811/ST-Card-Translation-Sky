// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.14';
export const APP_VERSION_NOTE = 'Regex Manager (feedback user): 2 khung "Original Preview / Translated Preview" KHÔNG còn thanh cuộn riêng — iframe tự giãn ĐÚNG bằng chiều cao nội dung nên giao diện card trải dài xuống, chỉ cần cuộn bảng ngoài (trước đây bị nhốt trong khung 240px → cuộn lồng cuộn, rất khó theo dõi & so sánh 2 bản). Cách làm: srcDoc tự đo chiều cao rồi postMessage ra ngoài (sandbox không cho parent đọc contentDocument), parent giãn iframe theo; báo lại khi ảnh/font tải xong hoặc accordion mở/đóng (ResizeObserver). Có trần 4000px + chốt 40 lần báo chống vòng lặp phình với card dùng min-height:100vh. Đo live card Long Tộc: khung giãn 2129px cho UI dài, 182px cho script ngắn, ổn định không nhấp nháy. | 1.99.13: warm-up chunk chống quay mãi khi đang dịch.';
