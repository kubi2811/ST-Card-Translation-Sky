@Pvkhoa

# UPDATE v2.57.0 : TRỢ LÝ AI KHÔNG CÒN QUÊN CÂU HỎI SAU KHI ĐỌC ENTRY (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Đọc entry xong vẫn nhớ bạn đang hỏi gì (bug 245):**
- Trước đây: bạn hỏi về lỗi regex, trợ lý cần đọc trọn entry nên tool tự gửi nội dung entry cho nó, kèm đúng một câu "hãy tiếp tục xử lý yêu cầu trước đó của tôi". Ngay trước câu đó là cả trang nội dung vừa đọc, còn câu hỏi thật thì nằm lẫn trong 10 lượt chat cũ. Thế là AI hiểu nhầm "yêu cầu trước đó" là chủ đề cũ (ví dụ dịch entry) và bỏ qua câu bạn vừa hỏi.
- Bây giờ: sau phần nội dung đã đọc, tool **nhắc lại nguyên văn câu hỏi của lượt này** và dặn rõ "trả lời ĐÚNG câu này, không quay lại chủ đề cũ". Đọc nhiều entry liên tiếp cũng vẫn giữ đúng câu hỏi gốc.
- Lượt đọc tiếp cũng giữ nguyên chế độ của câu hỏi gốc (xem bản tin bug 243), nên không bị đổi vai giữa chừng.
