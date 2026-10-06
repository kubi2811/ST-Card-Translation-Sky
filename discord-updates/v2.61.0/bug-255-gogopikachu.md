@gogopikachu.

# UPDATE v2.61.0 : CHUYỂN MÁY / CHIA VIỆC DỊCH BẰNG WORKSPACE (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Chuyển máy bị mất bản gốc tiếng Trung:**
- Trước đây: xuất thẻ dịch dở rồi nạp sang máy khác thì "bản gốc" là tiếng Việt đã dịch — không còn gì để đối chiếu.
- Bây giờ: thẻ xuất ra là bản để CHƠI. Muốn làm tiếp ở máy khác hay nhờ người khác dịch hộ thì dùng **Xuất workspace** (màn hình nạp thẻ): mang đủ gốc tiếng Trung + bản dịch + tiến độ từng chunk, không kèm API. Xuất thẻ khi còn mục chưa xong, tool sẽ nhắc.

**2) Từ điển MVU/EJS phình to sau mỗi lần chuyền:**
- Trước đây: file workspace chép nguyên từ điển của cả máy (bật khoá 🔒 thì có cả thẻ khác) rồi ghi đè sang máy nhận.
- Bây giờ: chỉ mang mục **của thẻ này**; nạp vào không xoá từ điển/thuật ngữ riêng của người nhận. File workspace cũ cũng được lọc lại khi nạp.

**3) Chia nhỏ dự án cho nhiều người:**
- Bây giờ: nạp workspace của **chính thẻ đang mở** → tool hỏi **GỘP**: lấy mục bạn chưa dịch từ file, giữ nguyên mục bạn đã dịch, mục hai bên dịch khác nhau thì liệt kê ra để bạn xem.

**4) Ảnh thẻ:** workspace giờ kèm ảnh — trước đây máy nhận xuất PNG bị dính ảnh của thẻ đang mở trước đó.
