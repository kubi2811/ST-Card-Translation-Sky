# Kế Hoạch Triển Khai: Chức Năng EJS Creator (Trình Tạo EJS)

Dựa trên yêu cầu của bạn, tôi đề xuất kế hoạch xây dựng một tính năng **EJS Creator** (Trình tạo mã EJS) tích hợp trực tiếp vào giao diện của ứng dụng hiện tại. Giao diện này sẽ được thiết kế dạng 2 cột (Split-pane layout) để tối ưu hóa trải nghiệm viết Lorebook có nhúng EJS.

## 1. Thiết Kế Giao Diện (UI/UX)
Sẽ tạo một component mới có tên `EjsCreatorPanel.tsx` bao gồm 2 phần chính:

### Cột Trái: Bảng Tra Cứu Khái Niệm EJS (EJS Reference / Cheat Sheet)
Cột này đóng vai trò như một cẩm nang (Wiki) thu nhỏ, hiển thị các khái niệm và đoạn mã mẫu (snippets) để người dùng có thể copy nhanh:
- **Cú pháp cơ bản:** `<%_ _%>` (Thực thi logic), `<%- %>` (In giá trị thô).
- **Lấy biến (Get Variables):** Cách dùng `getvar('stat_data.something')`, `getvar('affinity')`.
- **Gán biến (Set Variables):** Cách dùng `setvar('key', 'value')`.
- **Tải Lorebook động (Get World Info):** Cách dùng `await getwi(null, 'Tên Entry')`.
- **Đọc lịch sử Chat:** Cách dùng `getChatMessages(-1, 'user')`.
- **Logic điều kiện:** Vòng lặp `if/else` để rẻ nhánh kịch bản dựa trên thời đại, khu vực, trạng thái sinh lý.
*(Có nút "Copy" bên cạnh mỗi đoạn mã mẫu để dán nhanh sang cột phải)*

### Cột Phải: Trình Soạn Thảo Lorebook (Lorebook EJS Editor)
- Một khung văn bản lớn (Textarea hoặc Code Editor như Monaco Editor nếu có thể) để bạn "nhét" Lorebook vào.
- Hỗ trợ gõ mã EJS trực tiếp trộn lẫn với nội dung văn bản thông thường.
- Có nút **"Copy toàn bộ"** để bạn mang đi dán vào SillyTavern, hoặc nút **"Lưu vào Card"** (nếu bạn muốn lưu thẳng đoạn EJS này vào một Entry cụ thể trong `character_book` của thẻ nhân vật đang mở).

## 2. Kiến Trúc Kỹ Thuật (Architecture)

### 2.1. Tạo Component mới
- **File:** `src/components/EjsCreatorPanel.tsx`
- **Mô tả:** Sử dụng CSS Grid hoặc Flexbox để chia đôi màn hình (ví dụ: `grid-template-columns: 35% 65%`).
- **State:** Sử dụng state nội bộ (`useState`) để lưu trữ nội dung văn bản đang soạn thảo ở cột phải. 

### 2.2. Cập nhật `App.tsx`
- Lazy-load component `EjsCreatorPanel` tương tự như các panel khác.
- Đặt panel này ở phía dưới cùng hoặc tạo một nút để mở rộng/thu gọn (accordion) nhằm tránh làm rối giao diện chính.

### 2.3. Tích hợp Đa ngôn ngữ (i18n)
- Thêm các key dịch thuật mới vào `src/i18n/translations.ts` cho phần tiêu đề, hướng dẫn và nội dung của bảng tra cứu EJS để hỗ trợ cả tiếng Anh và tiếng Việt.

## 3. Các Câu Hỏi Cần Bạn Phản Hồi (Open Questions)

> [!IMPORTANT]
> Vui lòng cho tôi biết ý kiến của bạn về các vấn đề sau trước khi tôi bắt đầu viết code:
> 
> 1. **Mục đích lưu trữ:** Bạn chỉ muốn khung bên phải là một "nháp" (chỉ copy ra ngoài) hay bạn muốn nó có tính năng **Lưu thẳng vào một Entry cụ thể trong World Info** của file JSON đang mở?
> 2. **Giao diện:** Bạn thích nó hiển thị mặc định (luôn mở) ở dưới cùng, hay nằm trong một cái Modal (cửa sổ popup) để khi nào cần mới bấm nút hiện lên?
> 3. **Thư viện Editor:** Tôi có thể dùng thẻ `<textarea>` mặc định (đơn giản, nhẹ), hay bạn muốn cài đặt thêm thư viện Code Editor (để có tô màu cú pháp xanh đỏ cho các thẻ `<% %>`)?

## 4. Kế Hoạch Xác Minh (Verification)
- Chạy thử dự án (`npm run dev`).
- Mở bảng EJS Creator.
- Nhấp thử vào các nút "Copy" ở bảng tham khảo xem nội dung có dán sang editor đúng không.
- Đảm bảo giao diện 2 cột hiển thị tốt, không bị vỡ layout trên màn hình nhỏ.

---
**Bạn có đồng ý với kế hoạch này không? Nếu có phản hồi cho các câu hỏi trên, vui lòng cho tôi biết!**
