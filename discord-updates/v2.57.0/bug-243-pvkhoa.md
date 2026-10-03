@Pvkhoa

# UPDATE v2.57.0 : TRỢ LÝ AI THÔI BỊ CHẶN VÔ LÝ + NGHE LỜI "CHỈ ĐỌC" (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Hết cảnh action bị chặn "ngoài quyền CodeFixer" (bug 243):**
- Trước đây: khi trợ lý cần đọc trọn một entry, tool tự gửi tiếp nội dung vừa đọc. Tin nhắn tự gửi đó có chữ "REGEX SCRIPT", "script"… nên tool tưởng bạn đang nhờ sửa code và chuyển sang chế độ CodeFixer. Chế độ này không được phép sửa entry, thế là mọi lệnh EDIT_ENTRY bị chặn. Đó chính là dòng "nằm ngoài quyền của sub-agent CodeFixer" trong ảnh.
- Bây giờ: lượt tự gửi tiếp **giữ nguyên chế độ của câu bạn hỏi lúc đầu**. Ngoài ra CodeFixer giờ cũng được sửa entry, vì lỗi trong entry như thiếu dấu ```, EJS hay [initvar] cũng là lỗi code.
- Trợ lý được **báo trước** lượt này nó được dùng những action nào, nên không còn kiểu viết "tôi sẽ dùng action để sửa" rồi bị chặn.

**2) Dặn "chỉ đọc" là chỉ đọc:**
- Trước đây: câu dặn "chỉ tạo action để đọc" chỉ là chữ trong prompt, tool không hiểu. AI lỡ tay tạo action sửa là action đó vẫn đi tiếp.
- Bây giờ: tool **tự nhận ra** các câu như "chỉ đọc", "chỉ phân tích", "đừng sửa thẻ", "không tạo action chỉnh sửa"… Khi đó tool nói thẳng với AI lượt này chỉ được đọc. Nếu AI vẫn tạo action sửa thì tool **chặn**, kèm lý do dễ hiểu là "Bạn đã dặn lượt này CHỈ ĐỌC", và thẻ không bị đụng tới.
- Muốn áp thay đổi thì nhắn lại mà không kèm câu dặn chỉ đọc.
