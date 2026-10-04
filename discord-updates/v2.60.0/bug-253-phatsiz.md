@PhatSiz

# UPDATE v2.60.0 : SỬA DỊCH ENTRY [mvu_update] + TỪ ĐIỂN MVU BỎ DẤU / (NHỚ BẤM UPDATE)

Cảm ơn bộ "raw + sai + đúng", có nó mới tìm ra đủ 4 lỗi (bug 253):

**1) Entry hướng dẫn kiểu [mvu_update] giờ dịch thành câu văn trôi chảy:**
- Trước đây: tool coi mọi entry loại "controller" là code, nên chỉ dịch **từng cụm chữ Hán riêng lẻ**. Kết quả là "`<UpdateVariable>` Bắt đầu、", "2026Năm3Tháng15Ngày", "20 Dưới Tuổi", còn dấu câu tiếng Trung, và tự bọc nháy `'Nghề Nghiệp':`.
- Bây giờ: tool tự nhận ra entry là **tài liệu văn xuôi xen ví dụ code** và dịch như văn bản, code giữ nguyên. Chạy thật trên file bạn gửi: "14:30 ngày 15 tháng 3 năm 2026", backtick đủ 264/264.

**2) Câu hỏi "từ điển MVU bỏ dấu / có ảnh hưởng không":**
- Với tên biến thật như `灾难/暴雪场景` thì **không sao**. Tool cố ý bỏ `/` vì trong JSONPatch `/` là dấu ngăn tầng, và bản dịch được thay đồng nhất ở mọi chỗ.
- Cái bạn gặp là lỗi khác: tool **nhặt nhầm dòng liệt kê ký tự cấm** (`` `.`　`/`　空格 `` …) làm "tên biến", áp vào là mất dấu `/` và dính backtick. Giờ không nhặt nữa, và từ điển cũ bị dính sẽ được tự dọn.

**3) Hết báo "HTML hỏng" oan:** chỗ giữ chỗ như `<Tên Khu Tị Nạn>` không còn bị đếm là thẻ HTML.

**4) Hết câu "còn 0 trường có chữ Hán":** chỉ trường bị bỏ qua mà **còn chữ Hán** mới chặn xuất.
