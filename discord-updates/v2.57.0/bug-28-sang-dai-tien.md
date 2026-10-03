@Sáng Đại Tiên

# UPDATE v2.57.0 : GIAO DIỆN TIẾNG VIỆT HẾT CHỮ TIẾNG ANH (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Dịch nốt phần mô tả tiếng Anh trong giao diện tiếng Việt (bug 28):**
- Trước đây: lúc làm đa ngôn ngữ, bản tiếng Việt được chép nguyên văn từ giao diện cũ, mà giao diện cũ vốn trộn tiếng Anh. Vì vậy còn **160 chuỗi tiếng Anh**: mô tả chia chunk, dịch song song, RAG, bộ nhớ dịch, dịch Surgical, Chiến lược B/C (MVU, EJS), kiểm/sửa regex, xuất thẻ, sức khoẻ thẻ…
- Bây giờ: đã dịch hết sang tiếng Việt, cộng thêm khoảng 30 nhãn trước đây viết thẳng trong giao diện (xem trước bản gốc/bản dịch, ngôn ngữ gốc, thử regex, sandbox của Trợ lý AI…).
- Chỉ giữ tiếng Anh cho tên riêng và thuật ngữ quen dùng của SillyTavern/API: Regex Manager, API Key, Mod Card, Web Crawler, CORS Proxy, Depth prompt, Frequency/Presence/Repetition Penalty.

**2) Không để tái diễn:**
- Có test tự động: chuỗi tiếng Anh mới nào lọt vào bản tiếng Việt là tool báo lỗi ngay khi kiểm tra.

Nếu bạn còn thấy chỗ nào tiếng Anh, chụp màn hình gửi mình là sửa luôn.
