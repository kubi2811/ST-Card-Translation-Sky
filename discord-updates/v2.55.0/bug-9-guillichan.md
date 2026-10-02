@guillichan

# UPDATE v2.55.0 : LOREBOOK AI CHỈNH SỬA CHẠY LIÊN TỤC + ÁP DỤNG TỚI ĐÂU ĐỔI TỚI ĐÓ (NHỚ BẤM UPDATE)

Có gì mới / đã fix (Tạo Card → Lorebook → AI chỉnh sửa):

**1) Ba lỗi bạn báo trước đó đã được sửa từ các bản trước:**
- Số batch song song giờ theo đúng số bạn chỉnh, không còn luôn là 5.
- Nút **Tạm dừng / Dừng hẳn** có tác dụng ngay.
- Thoát ra hay chuyển tab giữa chừng không còn mất tiến trình.

**2) Gọi batch LIÊN TỤC (mới):**
- Trước đây: chạy theo lượt, đợi cả lượt xong mới gọi lượt kế. Một batch chậm là cả đám đứng chờ.
- Bây giờ: batch nào xong là gọi ngay batch kế tiếp. Lúc nào cũng chạy đủ số luồng bạn đặt, cho tới khi hết việc.

**3) "Áp dụng luôn" làm tới đâu đổi tới đó (mới):**
- Mỗi batch xong là áp luôn vào lorebook, không phải đợi hết mới thấy thay đổi.
- Entry mới vẫn được lọc trùng (kể cả trùng với entry vừa thêm ở batch trước). Bấm **Dừng hẳn** giữa chừng thì phần đã làm vẫn được giữ.
- Trước khi chạy tool vẫn tự lưu snapshot, muốn quay lại thì khôi phục.
