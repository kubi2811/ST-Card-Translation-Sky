@gogopikachu.

# UPDATE v2.56.0 : TỪ ĐIỂN MVU CHO DỊCH LINK NGOÀI (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Quét key + AI dịch key ngay trong tab Dịch link ngoài (bug 238):**
- Trước đây: card đưa hết biến MVU vào script link ngoài thì từ điển của card chỉ có khoảng 9-14 key. Tab link ngoài lại không quét được key, cũng không dịch được key, nên 140+ key nằm trong script không có cách nào vào từ điển.
- Bây giờ: dán script vào ô link ngoài là tool **tự quét key** trong script và hiện khung **"Từ điển MVU của link này"**. Khung cho biết có bao nhiêu key, bao nhiêu key đã có bản dịch, bao nhiêu key còn thiếu. Bấm **"AI dịch N key thiếu"** là xong. Có ô **tra key** và sửa tay từng key ngay trong khung.
- Từ điển này **dùng chung với từ điển MVU của card**, không phải một bảng riêng. Biến trong script ngoài và biến trong card luôn giống hệt nhau.

**2) Nút quét key ở panel MVU giờ quét cả link ngoài:**
- Hai nút "Quét key" và "Quét + AI dịch" quét cả các script trong **Kho link ngoài** của card và script đang nằm ở ô dịch link ngoài.

**3) Hai lỗi ngầm đã sửa luôn:**
- Chế độ **Script nặng (Chia phần)** trước đây **không áp từ điển MVU**, nên tên biến được dịch tự do và lệch với card. Bây giờ đã áp.
- Card để hết biến ở link ngoài thì tool tưởng là "card thường", và **bấm Bắt đầu dịch là xoá sạch từ điển MVU**. Bây giờ tool tính cả link ngoài nên không xoá nữa.

Đã chạy thử thật (gemini-3.8-flash): script 220.000 ký tự, quét ra đủ 7 key, AI dịch đủ 7/7 key. Bản dịch dùng đúng key trong từ điển, ví dụ `{{getvar::好感度}}` thành `{{getvar::Độ Hảo Cảm}}`.
