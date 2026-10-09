@gogopikachu.

# UPDATE v2.64.0 : ĐÁNH GIÁ CHUNK ĐÚNG BỆNH, DỊCH LẠI ĐÚNG CHUNK (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Chunk đã dịch bị gắn "chưa dịch":**
- Trước đây: chunk dịch 27.000 ký tự mà sót vài chữ Hán cũng bị gắn "chưa dịch" y như chunk chưa dịch thật.
- Bây giờ nhãn nói đúng: **chưa dịch** (giống hệt bản gốc) · **còn N/M chữ Hán** (sót nặng) · **sót N chữ Hán** (đã dịch, chỉ sót lẻ tẻ) · **trống**.

**2) Bấm dịch lại thì cả loạt chunk "có vẻ ổn" bị dịch lại theo:**
- Trước đây: nút "Dịch lại chunk lỗi" gom cả chunk chỉ sót vài chữ, xoá trắng bản dịch tốt rồi dịch lại — dịch xong vẫn sót ⇒ về vạch xuất phát.
- Bây giờ: nút **"Dịch lại N chunk hỏng"** chỉ lấy chunk trống / chưa dịch / nghi cụt / nghi thừa. Chunk sót lẻ tẻ có nút riêng **"🧷 Vá chữ Hán sót"**: gom mọi chỗ sót vào một lượt gọi AI rồi điền lại đúng chỗ — không xoá chunk nào.

**3) Chunk "Pending" mấy tiếng không ai dịch:**
- Trước đây: bộ quét chữ Hán sót và nút "dịch lại mục chưa đạt" xoá chunk TRƯỚC rồi mới xin quyền dịch; mục đang bị lượt khác giữ thì bị bỏ qua ⇒ chunk đã xoá nằm trống mãi.
- Bây giờ: chunk chỉ bị xoá khi tool đã nhận việc. Mục chỉ sót lẻ tẻ thì được **vá trước**, vá sạch thì khỏi dịch lại.

**4) Bản dịch chunk hiện `__PROTECTED_URL_0__`:** đó là ký hiệu che link/tên file bị lưu nhầm vào chunk — bấm "Ghép lại" là lọt vào thẻ. Giờ chunk lưu bản đã gỡ che; chunk lưu từ bản cũ cũng được tự gỡ khi ghép.

Bạn nên mở lại entry, xem nhãn mới rồi: chunk **hỏng** → "Dịch lại N chunk hỏng"; chunk **sót** → "Vá chữ Hán sót". Còn kẹt chunk nào thì gửi mình log nhé.
