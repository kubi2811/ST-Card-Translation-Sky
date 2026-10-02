@gogopikachu.

# UPDATE v2.56.0 : XEM TIẾN ĐỘ DỊCH LINK NGOÀI KHÔNG CẦN F12 (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Báo cáo từng bước hiện ngay trên giao diện (bug 240):**
- Trước đây: lúc dịch link ngoài chỉ thấy được tool gọi API. Muốn biết đang dịch phần nào, mảnh nào lỗi thì phải mở F12, mà trong F12 cũng không đánh dấu phần nào là phần nào.
- Bây giờ: có khung **"Nhật ký từng bước"** ngay dưới ô dịch, ghi rõ giờ, phần/mảnh đang dịch, mảnh nào xong, mảnh nào phải sửa, AI trả thiếu nên phải gọi viết tiếp, mảnh nào lỗi và lỗi gì.

**2) Bảng tiến độ từng phần / từng mảnh:**
- Script nặng (chia phần): mỗi phần hiện **trạng thái, thời gian chạy, số chữ Hán còn sót / tổng chữ Hán gốc, độ khớp độ dài** (bản dịch so với bản gốc) và lời nhận xét nếu nghi bị cắt cụt, bị phình hoặc chưa dịch. Có thanh % tổng và tổng số chữ Hán còn sót (không tính link và CSS giữ nguyên).
- Dịch thường (tự chia mảnh): có khung **"Tiến độ dịch"** hiện từng mảnh với cùng các số đo trên, đồng hồ chạy, và số chữ Hán còn lại của bản cuối.
- Thoát Regex Manager rồi vào lại, toàn bộ nhật ký và tiến độ **vẫn còn nguyên**.
- Một lỗi trước đây bị che: khi dịch lỗi, tool **lặng lẽ trả về bản gốc** và báo xong. Bây giờ tool ghi rõ lỗi vào nhật ký, và phần đó hiện số chữ Hán còn sót kèm câu "giống hệt bản gốc".
