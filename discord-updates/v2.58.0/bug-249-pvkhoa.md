@Pvkhoa

# UPDATE v2.58.0 : HẾT LỖI ĐỎ "ZOD SCHEMA FIELD" OAN KHI DỊCH CARD MVU (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Hết báo lỗi oan "Zod schema field prefault:… missing" (bug 249):**
- Trước đây: Kiểm Tra Field coi **giá trị mặc định** trong `.prefault('未描述')` hay `.default('太阳风暴后第30天')` là **tên trường** của schema, nên đòi giữ nguyên chữ Hán. Nhưng đó là chữ người chơi nhìn thấy, dịch là **đúng**. Vì vậy card MVU nào dịch xong cũng ra cả loạt lỗi đỏ "This will break the card's state management", đúng như ảnh bạn gửi.
- Bây giờ: giá trị mặc định được dịch thoải mái. Tool chỉ báo lỗi khi **mất hẳn lời gọi** `.prefault()` / `.default()`, tức là code bị cắt thật.
- Tên trường Zod được Chiến lược B đổi theo từ điển MVU cũng không còn bị báo là "mất".

**2) Mục "Schema ↔ Hướng dẫn định dạng biến" hết báo nhầm:**
- Trước đây: một dòng chú thích kiểu `/* Bên trong mỗi trang: Tiêu đề cố định */` bị coi là một biến, nên ra cảnh báo "biến chỉ có trong hướng dẫn, schema không khai".
- Bây giờ: tool bỏ qua chú thích trước khi so.
