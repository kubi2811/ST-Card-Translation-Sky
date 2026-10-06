@gogopikachu.

# UPDATE v2.61.0 : DỊCH LẠI CHUNK KHÔNG CÒN KẸT "ĐANG DỊCH Ở LUỒNG KHÁC" (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Bấm "dịch lại chunk" báo đang dịch ở luồng khác, còn xoá mất chunk:**
- Trước đây: nút xoá chunk TRƯỚC rồi mới xin quyền dịch; lượt dịch cũ (đã treo) vẫn giữ quyền ⇒ chunk mất bản dịch mà không ai dịch lại, phải huỷ cả tiến trình.
- Bây giờ: chunk chỉ bị xoá khi tool đã nhận việc. Bấm tay thì tool **dừng lượt cũ đang treo** của đúng mục đó rồi chạy ngay — các chunk đã xong vẫn giữ, không cần huỷ cả tiến trình.

**2) Tên file JS khác bị báo là "còn chữ Hán":**
- Trước đây: `scripts/02_大乾风华录后台GM修改器.js`, `状态机.js`… trong ghi chú bị đếm là chưa dịch, và còn bị đem đi dịch (dễ lỗi).
- Bây giờ: tên file có chữ Hán được giữ nguyên từng chữ, không dịch, không đếm.

**Còn chờ bạn:** chunk "dịch gần 3 tiếng mà ra nguyên văn 100% chữ Hán" mình chưa tái hiện được vì báo cáo không có log. Gặp lại thì bấm dịch lại chunk đó (giờ đã chạy được) và gửi mình log của lượt dịch nhé.
