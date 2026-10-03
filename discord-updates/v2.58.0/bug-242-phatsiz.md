@PhatSiz

# UPDATE v2.58.0 : SỬA ĐƯỜNG DẪN BIẾN BỊ LẶP TÊN NHÓM TRONG [mvu_update] (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Hết lỗi `Nhóm['Nhóm.Thuộc tính']` (bug 242):**
- Trước đây: khi dịch các entry [mvu_update], AI hay nhét lại tên nhóm vào trong đường dẫn, ví dụ `Nhân Vật Chính['Nhân Vật Chính.Ngày Sinh']` hay `Đánh Giá Chuyên Môn['Đánh Giá Chuyên Môn.Vị Thế Hiện Tại']`. MVU hiểu đó là một thuộc tính tên dài ngoằng không tồn tại, nên ghi vào chỗ trống và chỉ số đứng im, không có lỗi nào báo.
- Bây giờ: dịch xong, tool **tự sửa về đúng dạng** `Nhân Vật Chính['Ngày Sinh']`. Áp cho mọi kiểu dịch (cả card, dịch lẻ, dịch lại) và mọi loại entry. Tool chỉ sửa khi card gốc **không** tự viết kiểu đó, nên card cố ý dùng key có dấu chấm thì vẫn được giữ nguyên.

**2) Card đã dịch rồi cũng sửa được:**
- Bấm **Kiểm Tra Field**: tool báo lỗi đỏ "đường dẫn biến bị lặp tên nhóm" ở đúng entry đó. Bấm **Sửa nhanh** là xong, không tốn API.
