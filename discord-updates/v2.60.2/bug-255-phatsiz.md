@PhatSiz — bug 255 (tavernHelper "生理周期调度" dịch xong vỡ, dịch lại cũng không được) ✅ đã sửa ở **v2.60.2**

Cảm ơn bạn gửi cả bản gốc lẫn bản dịch, soi ra **3 lỗi chồng nhau**:

**1. Từ điển MVU thay nhầm giữa từ.** Tiếng Trung không có dấu cách nên tool thay key `来源` → "Nguồn Gốc" luôn cả trong `基准来源` (một key khác) ⇒ `{ 基准Nguồn Gốc: resolved.source }` — khoá có dấu cách, **cả script vỡ cú pháp**. Cùng lỗi đó sinh ra mấy chuỗi lai kiểu `'追踪Sự KiệnXác Chẩn'`, `Ngày原文`.
→ Giờ key tiếng Trung chỉ được thay khi **đứng riêng** (không dính chữ Hán hai bên). `stat['日期']`, `rec.周期长度` vẫn đổi bình thường.

**2. `'user', 'User', 'USER'` thành "Tỷ Lệ Mang Thai" ×3.** Từ điển học lệch một mục `user` → "Tỷ Lệ Mang Thai" ⇒ danh sách HERO_ALIASES mất tên vai của bạn, script nhận nhầm nhân vật chính.
→ `user` / `char` không bao giờ bị đổi nữa; mục key tiếng Anh bị máy tự đổi tên sẽ được **tự dọn** khỏi từ điển (mục bạn tự nhập tay thì giữ).

**3. Dịch lại bị kẹt.** Lần dịch lại vấp lỗi ở trên ⇒ trả bản gốc cho script khỏi chết; nhưng chốt "dịch lại không được tệ hơn" lại so **số chữ Hán** (662 < 1659) nên giữ bản cũ — chính là bản đang **vỡ**. Vì thế bấm bao nhiêu lần cũng vậy.
→ Giờ bản đang có mà vỡ cú pháp JS thì không bao giờ được giữ thay cho một bản chạy được.

**Bạn làm:** cập nhật tool, mở lại card (từ điển tự dọn mục `user`), rồi **Dịch lại** entry tavernHelper[5]. Nếu từ điển có sẵn mục tiếng Anh do bạn tự thêm mà không muốn áp, xoá tay trong tab MVU.
