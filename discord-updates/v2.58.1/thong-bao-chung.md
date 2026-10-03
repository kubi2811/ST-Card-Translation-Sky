# UPDATE v2.58.1 : SỬA 3 LỖI NGẦM KHI ĐANG DỊCH (NHỚ BẤM UPDATE)

Bản này không có người báo, mình tự dò lại tool rồi tìm ra. Ai đang dịch card lớn nên cập nhật.

Có gì mới / đã fix:

**1) Bấm Tạm dừng / Huỷ giờ dừng thật:**
- Trước đây: đang dịch card mà mở **Regex Manager** rồi đóng lại thì nút Tạm dừng / Huỷ **mất tác dụng**. Nhãn hiện "đã tạm dừng" nhưng tool **vẫn dịch tiếp ngầm và vẫn tốn API**.
- Bây giờ: mở/đóng bao nhiêu lần thì Tạm dừng / Huỷ vẫn dừng đúng lượt đang chạy.

**2) Báo lỗi key/provider không còn bị tắt:**
- Trước đây: đang dịch mà chuyển qua lại các tab Trường dịch / Kiểm tra / Xuất thẻ thì phần **thông báo key sai, 429, provider lỗi** bị tắt ngầm, key hỏng lại im re.
- Bây giờ: thông báo luôn chạy suốt lượt dịch.

**3) Dịch link ngoài giữ code an toàn như Regex:**
- Trước đây: tab Dịch link ngoài ghi "cơ chế dịch như Regex" nhưng thực ra để AI **viết lại cả khối code** (dễ vỡ script, dễ bị cắt cụt).
- Bây giờ: chỉ dịch **chữ tiếng Trung** trong code, phần code giữ nguyên từng ký tự, đúng như dịch Regex, và áp luôn từ điển MVU.
