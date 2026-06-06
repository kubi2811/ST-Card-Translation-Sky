# Kế hoạch Tích hợp Trợ Lý AI (Bản Cập Nhật)

Kế hoạch này chi tiết hóa việc tích hợp trợ lý lập trình chuyên sâu hỗ trợ viết code, regex, và EJS trực tiếp vào ứng dụng dịch card SillyTavern của bạn.

---

## Điều chỉnh theo phản hồi của bạn

1. **Mô hình AI:** Trợ lý sẽ sử dụng trực tiếp mô hình và cấu hình API đang chọn toàn cục tại **API Configuration** (tiết kiệm tài nguyên và đồng bộ cấu hình).
2. **Nhân cách hóa Trợ lý:** Loại bỏ hoàn toàn các yếu tố tu tiên, tu chân (xưng hô huynh - thiếp, phu quân, tiên tử, ngọc giản, linh lệnh...). Trợ lý sẽ hoạt động như một **Trợ lý Lập trình Chuyên nghiệp & Thân thiện**, trả lời rõ ràng, tập trung vào kỹ thuật, code blocks, và hỗ trợ trực tiếp việc xây dựng card.
3. **Quản lý Regex:** Đồng ý tách biệt hoàn toàn Regex khỏi Batch Translation ở màn hình chính; người dùng sẽ quản lý và dịch Regex qua Regex Manager Panel hoặc nhờ Trợ lý AI hỗ trợ viết/sửa.

---

## UI/UX & Vị trí hiển thị

1. **Nút kích hoạt trên Sidebar:**
   - Thêm nút **"🔮 Trợ Lý AI"** ở thanh bên (Sidebar) dưới nút Regex Manager.
   - Nút bấm sẽ được thiết kế với hiệu ứng gradient tím-xanh công nghệ bắt mắt.
2. **Cơ chế hiển thị:**
   - Khi bấm nút, ứng dụng sẽ mở **AiCompanionPanel Modal** lơ lửng ở trung tâm màn hình, thiết kế split-pane (2 cột):
     - **Cột Trái: Chat & Lệnh** (Khung chat với Trợ lý, hỗ trợ gửi lệnh ưu tiên cao, đính kèm Linh ảnh / Vision).
     - **Cột Phải: Context & File Đính Kèm** (Quản lý các file đính kèm/ngữ cảnh và hiển thị thông tin thẻ hiện tại tự động nạp làm Context).

---

## Chi tiết kỹ thuật & Tính năng tích hợp

### 1. AI Chatbot Engine chuyên nghiệp
- Gọi API qua hàm `callProvider` trong `src/utils/apiClient.ts` để đảm bảo tương thích 100% với cấu hình proxy hiện tại của người dùng.
- Tích hợp Chế độ **NSFW / R18** (cho phép thảo luận và dịch card NSFW nếu bật) và cơ chế **Tự động thử lại (Auto-Retry)**.
- System Prompt mới tập trung hoàn toàn vào việc phò tá viết code, debug Regex/EJS, phân tích Zod Schema của card một cách chuyên nghiệp nhất.

### 2. Tự động nạp Ngữ cảnh Card (Card Context Auto-Loading)
- Trợ lý AI sẽ tự động hấp thụ dữ liệu thẻ hiện tại đang mở trong App (`store.card`) để làm ngữ cảnh nền.
- Hỗ trợ khu vực đính kèm file ở cột phải để tải lên thêm các tệp bổ sung (như file script mẫu, prompt mẫu) hoặc đính kèm ảnh chụp màn hình cho các mô hình đa phương thức.

---

## Proposed Changes

### [NEW] [AiCompanionPanel.tsx](file:///e:/d-ch-card-sillytarven/src/components/AiCompanionPanel.tsx)
- Tạo component mới chứa giao diện chat trợ lý, khu vực upload file context phụ, và các nút thao tác nhanh (Copy mã, Tải về mã, Tiếp tục, Xóa chat/file).

### [MODIFY] [App.tsx](file:///e:/d-ch-card-sillytarven/src/App.tsx)
- Khai báo state `showAiCompanion`.
- Thêm nút bấm **🔮 Trợ Lý AI** vào Sidebar chính.
- Gắn kết render `<AiCompanionPanel onClose={() => setShowAiCompanion(false)} />`.

### [MODIFY] [index.css](file:///e:/d-ch-card-sillytarven/src/index.css)
- Bổ sung CSS class dành riêng cho khung chat, bong bóng thoại của trợ lý/người dùng và layout split-pane.

---

## Verification Plan

### Automated/Compilation Checks
- Chạy `npx tsc --noEmit` và `npm run build` để kiểm tra lỗi cú pháp sau khi tích hợp.

### Manual Verification
- Mở bảng trợ lý AI từ Sidebar.
- Chat thử xem trợ lý phản hồi đúng văn phong chuyên nghiệp và hỗ trợ viết Regex/EJS tốt không.
- Đính kèm file script bên ngoài xem trợ lý có nhận diện và trả lời dựa trên file đó không.
