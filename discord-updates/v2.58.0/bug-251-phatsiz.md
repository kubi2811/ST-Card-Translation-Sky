@PhatSiz

# UPDATE v2.58.0 : XUẤT / NHẬP WORKSPACE — CHIA SẺ NGUYÊN PHIÊN DỊCH (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Nút "Xuất workspace" và "Nhập workspace" (bug 251):**
- Nằm ngay dưới khung thẻ nhân vật (mục Nạp dữ liệu). Khi chưa nạp thẻ thì chỉ có nút Nhập.
- **Xuất workspace** gom toàn bộ phiên dịch của card thành 1 file `.workspace.json`: thẻ, mọi field (bản gốc + bản dịch + tiến độ từng chunk), từ điển MVU / EJS, thuật ngữ, prompt và tuỳ chọn dịch, preset đang dùng, các link ngoài trong kho của card đó.
- **Nhập workspace**: người nhận nạp file là **làm tiếp đúng chỗ dở**. Card đang dịch dở thì được nạp ở trạng thái tạm dừng, không tự chạy.

**2) Tuyệt đối không có API trong file:**
- File **không bao giờ** chứa key, URL proxy hay cấu hình provider của bạn.
- Preset SillyTavern có `reverse_proxy`, `proxy_password` cũng bị gỡ.
- Trước khi ghi file, tool soát cả file: lỡ dán key vào đâu (kể cả trong nội dung card) thì cũng bị xoá thành `[ĐÃ XOÁ KEY]`.
- Lúc nhập, mọi thứ dính tới kết nối có trong file đều bị bỏ qua. **Kết nối/API của người nhận giữ nguyên.**
