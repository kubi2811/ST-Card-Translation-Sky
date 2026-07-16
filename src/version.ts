// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.0.0';
export const APP_VERSION_NOTE = '🎉 BIG UPDATE 2.0 — Trợ Lý AI nâng cấp toàn diện (roadmap P0-P4): TRÍ NHỚ dài hạn IndexedDB có nguồn truy vết + cache LRU đa tab; RAG tự tìm đoạn liên quan trong lorebook/file/kho kiến thức kèm nhãn nguồn (giảm bịa); vòng lặp sinh phản hồi chống cắt cụt + khử lặp; hiểu code (shiki highlight + chẩn đoán cú pháp + nút AI sửa); sub-agent + sandbox QuickJS an toàn. Cùng đợt: (1) Chiến lược C (EJS) nay TỰ ĐỘNG bắt "khác từ nhưng dịch ra cùng nghĩa" (vd 父女 & 父子 → "Cha con") sau khi dịch + nút "🔍 Sửa trùng nghĩa" có badge đếm — gọi AI dịch lại cho khác nhau (port cơ chế dedup của Chiến lược B, giúp logic game phân biệt keyword/entry). (2) So Sánh Card thêm nút "Dán JSON" mỗi ô — nạp card bằng cách dán JSON trực tiếp, không cần file (dùng khi tạo card từ worldbook). 409 test. | 1.99.24: sub-agent + sandbox.';
