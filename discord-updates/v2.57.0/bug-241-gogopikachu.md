@gogopikachu.

# UPDATE v2.57.0 : GIỮ TAB CHẠY NỀN ỔN ĐỊNH + NÚT BẬT/TẮT TAY (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Loa giữ tab không còn lúc có lúc không (bug 241):**
- Trước đây: âm thanh giữ tab **chỉ bật khi bấm "Bắt đầu dịch" cả card**. Dịch lẻ ở Regex Manager, dịch link ngoài, Script nặng, nút "Dịch lại mục này" đều chạy mà không có loa, nên tab ở nền một lúc là bị ngủ. Thêm nữa, việc nào xong hoặc tạm dừng cũng tắt luôn loa, kể cả khi việc khác vẫn đang chạy.
- Bây giờ: **mọi kiểu dịch đều giữ tab**. Mỗi việc giữ riêng phần của nó, còn việc nào chạy là loa còn phát.

**2) Tắt rồi tự bật lại được, không phải tắt cmd:**
- Trước đây: âm thanh chết hẳn (đổi tai nghe/loa, bấm phím Pause trên bàn phím/tai nghe, trình duyệt chặn) thì tool chỉ "gọi dậy" mà không dựng lại được, nên phải tắt cmd mở lại.
- Bây giờ: cứ 10 giây tool **đo mức âm thanh thật**. Thấy chết thì **dựng lại từ đầu**. Bị trình duyệt chặn thì chờ cú bấm kế tiếp của bạn rồi tự bật lại. Phím Pause trên bàn phím/tai nghe không làm tắt được nữa.

**3) Nút 🔊 "Giữ tab" trên thanh đầu trang (cạnh nút Báo lỗi):**
- Hiện đúng trạng thái: **bật / tự động / bị chặn — bấm**. Rê chuột vào để xem việc nào đang giữ và mức đo dBFS.
- Bấm để **bật giữ tay**: giữ cả khi không dịch gì, áp cho mọi tool trong Hub, và tool nhớ cho lần mở sau (bật lại ở cú bấm đầu tiên).
- Đang bị chặn thì bấm vào là bật lại ngay.
