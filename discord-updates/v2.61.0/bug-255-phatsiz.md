@PhatSiz — bug 255 (chuyển máy / chia việc + chunk kẹt "luồng khác") ✅ **v2.61.0**

**1. Chuyển máy mất bản gốc.** File bạn gửi (`…png_vi.json`) là **thẻ đã xuất** — bản để CHƠI, chữ Trung đã bị thay. Bản để **làm tiếp** là **Xuất workspace** (màn hình nạp thẻ): đủ gốc tiếng Trung + bản dịch + tiến độ chunk, không kèm API. Giờ xuất thẻ khi còn mục chưa xong tool sẽ nhắc.
Workspace được sửa thêm:
• **Hết phình key:** trước đây file chép NGUYÊN từ điển của máy (khoá 🔒 thì gồm cả thẻ khác) rồi ghi đè máy nhận. Giờ chỉ mang mục **của thẻ này**, không xoá từ điển/thuật ngữ riêng của người nhận; file cũ cũng được lọc lại.
• **Kèm ảnh thẻ** — trước đây máy nhận xuất PNG bị dính ảnh thẻ cũ.
• **Chia việc:** nạp workspace của **chính thẻ đang mở** → tool hỏi **GỘP**: lấy mục bạn chưa dịch từ file, giữ mục bạn đã dịch, mục hai bên khác nhau thì liệt kê.

**2. "Dịch lại chunk" báo luồng khác + mất chunk.** Nút xoá ô TRƯỚC rồi mới xin khoá; khoá bị lượt cũ (treo) giữ ⇒ ô mất, không ai dịch. Giờ chỉ xoá khi đã cầm khoá, và nút bấm tay được **dừng lượt cũ đang treo** của đúng mục đó để chạy ngay (chunk đã xong vẫn giữ) — khỏi huỷ cả tiến trình.

**3. Tên file có chữ Hán** (`scripts/02_大乾风华录后台GM修改器.js`, `状态机.js`…) giữ nguyên, không đem dịch, không tính là "còn chữ Hán".

Chunk "dịch 3 tiếng ra nguyên văn": chưa tái hiện được vì báo cáo không có log — gặp lại thì bấm dịch lại chunk đó (giờ chạy được) và gửi mình log nhé.
