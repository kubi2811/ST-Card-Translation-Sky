@gogopikachu.

# UPDATE v2.56.0 : THOÁT REGEX MANAGER VẪN DỊCH TIẾP (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Thoát Regex Manager không còn làm dừng lượt dịch link ngoài (bug 239):**
- Trước đây: lượt dịch Script nặng (chia phần) chạy bên trong khung Regex Manager. Thoát ra màn hình chính là khung đóng lại, mất hết tiến trình và bản ghép. Mở lại thì tool tưởng chưa chạy, bấm "Dịch tiếp" là ra **hai lượt dịch chồng lên nhau**.
- Bây giờ: lượt dịch **chạy nền**. Thoát ra ngoài nó vẫn dịch tiếp. Ở màn hình chính có nhãn nổi góc phải dưới, ví dụ **"Script nặng đang dịch — phần 2/3"**. Bấm vào nhãn là mở lại Regex Manager **đúng tab Dịch link ngoài**, thấy đúng phần đang dịch.
- Bấm Dịch hai lần cũng chỉ có một lượt chạy. Dừng giữa chừng rồi bấm "Dịch tiếp" thì chỉ dịch các phần còn thiếu.

**2) Nút Huỷ dùng được cả sau khi mở lại:**
- Trước đây: thoát rồi vào lại thì nút Huỷ chỉ đổi chữ trên màn hình, còn lượt dịch thật vẫn chạy và vẫn ghi đè kết quả. Bây giờ bấm Huỷ là dừng thật.
- Bấm Bắt đầu / Tạm dừng dịch card **không còn vô tình giết** lượt dịch link ngoài đang chạy.

**3) Lỗi giữa chừng thì dịch tiếp, không dịch lại từ đầu:**
- Link ngoài lớn bị lỗi giữa chừng (mạng, hết quota…) mà bấm Dịch lại thì tool **giữ các mảnh đã xong**, chỉ dịch phần còn thiếu.

Đã chạy thử thật: script 220.000 ký tự chia 3 phần. Đóng Regex Manager khi phần 1 đang chạy, ở ngoài vẫn thấy nó chạy sang phần 2. Mở lại thì thấy đúng phần 3/3, sau đó ghép đủ, sạch chữ Hán.
