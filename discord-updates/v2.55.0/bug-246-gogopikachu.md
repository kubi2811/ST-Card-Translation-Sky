@gogopikachu.

# UPDATE v2.55.0 : FIX MẤT ``` KHI DỊCH REGEX (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Tự trả lại dấu ``` mà AI làm rơi (bug 246):**
- Trước đây: tool chỉ cứu được đúng 1 trường hợp là cả regex được bọc trọn trong ``` và AI làm mất cả hai dấu. Còn các kiểu khác thì lọt hết: có chữ trước dòng ```html, AI chỉ làm mất dấu đóng, hoặc nhiều khối ``` trong một regex. Có trường hợp tool còn bọc thêm một lớp ``` thừa.
- Bây giờ: sau khi dịch, tool so với bản gốc rồi **đặt lại từng dòng ``` về đúng chỗ**. Không chắc vị trí thì tool **báo lỗi chứ không đoán bừa**.

**2) Các khâu kiểm tra giờ đã bắt được lỗi này:**
- Bảng **Sức khoẻ thẻ** (trước khi xuất) báo lỗi đỏ "Mất N dòng ```", thẻ không còn hiện "An toàn để xuất" nữa.
- Nút **AI sửa** trong Regex Manager: bản sửa nào làm mất ``` thì tool từ chối, không áp vào thẻ.

Đã chạy thử thật trên regex 8.462 ký tự của một card (gemini-3.8-flash): dịch sạch chữ Hán, giữ đủ ```.
