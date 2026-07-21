# Bản tin cập nhật v2.6.1 — dán lên Discord

> Discord giới hạn 2000 ký tự / tin nhắn, nên bài được chia sẵn thành 5 tin.
> Mỗi tin nằm giữa 2 dòng `════`. Copy phần BÊN TRONG, bỏ dòng `════` đi.
> (Nếu server bạn có bot/webhook đăng bài dài thì cứ dán liền một mạch cũng được.)

════════════════ TIN 1/5 ════════════════

# 🎉 Silly Tavern Multitools v2.6.1

Bản này có **2 tool hoàn toàn mới**, app khởi động nhẹ hơn hẳn, và một đợt soát lỗi lớn trước khi phát hành. Chi tiết ở các tin dưới 👇

## 🎌 Chế độ Đồng Nhân — hết cảnh "Yukino" biến thành "Tuyết Nãi"

Bật công tắc này ở **Thiết lập dịch** (có ô điền tên tác phẩm) khi dịch card đồng nhân IP Nhật/Hàn.

Lý do trước đây hay sai: card đồng nhân hầu hết là card **tiếng Trung**, nên luôn bị đẩy sang lối đọc Hán-Việt — kể cả khi bạn đã chọn Romaji. Nay AI bị cấm cả Hán-Việt hoá lẫn Pinyin cho tên nhân vật; không chắc cách đọc thì **giữ nguyên chữ gốc** thay vì bịa.

Kèm 2 lỗi gốc rễ đã vá:
- Ở **chế độ chuyên gia**, lựa chọn Kiểu tên (Romaji / Hán-Việt / Giữ nguyên) bị rơi mất trước khi tới AI — tức là bấm Romaji xưa nay **không hề có tác dụng**.
- Hiện tượng "đã dịch đúng rồi mà sau một hồi tự sửa thành sai": bước quét cuối lượt lấy từ điển biến MVU áp đè lên cả văn xuôi lorebook, ghi đè ngược lên tên đã dịch đúng.

════════════════ TIN 2/5 ════════════════

## ⚡ Khởi động nhẹ — mở app không còn bung 4-5 cửa sổ đen

`start.bat` giờ **chỉ mở Dịch Card**, một cửa sổ duy nhất. Các tool khác (Tạo Card / Tạo Preset / Mod Card / Web Crawler) chỉ khởi động khi bạn **bấm vào tab** đó — chạy ngầm, không bung cửa sổ CMD nào.

- Icon trên thanh bên có chấm trạng thái: **xanh** = đang chạy, **xám mờ** = đang tắt, **vàng nhấp nháy** = đang khởi động.
- Trong mỗi tab có nút **"Dừng server"** để tắt tool không dùng cho nhẹ máy.
- Lần đầu bật một tool mất ~30 giây (cài thư viện), các lần sau chỉ vài giây.
- Vẫn muốn mở sẵn cả 5 tool như trước? Dùng **`start-all.bat`** (mới thêm).

════════════════ TIN 3/5 ════════════════

## 📜 TOOL MỚI: Dịch Script

Tab mới trên thanh bên, dịch **script TavernHelper** (file JS 1–3 MB) từ Trung sang Việt. Dùng chung pool provider / API key bạn đã cấu hình bên Dịch Card, **không phải khai báo lại gì**.

Nguyên tắc cốt lõi: **code không bao giờ được gửi cho AI**. Tool tách riêng các chuỗi tiếng Trung ra, chỉ gửi chúng đi dịch, rồi ghép lại đúng chỗ — nhờ vậy cấu trúc script được bảo toàn theo thiết kế, không phải trông chờ AI ngoan.

- Tự làm đẹp code trước khi dịch — file 1.5 MB xử lý mượt, **không đơ giao diện**.
- **Giữ nguyên có chủ đích**: key dữ liệu tiếng Trung (`{子时: "00:00"}`), tên class CSS, truy cập thuộc tính, `${…}`, `{{macro}}`, thẻ HTML — đổi mấy thứ này là vỡ script.
- **Regex thông minh**: regex khớp tên nhân vật được **giữ chữ Hán + thêm nhánh tiếng Việt** (`/秋青子/` → `/(?:秋青子|Thu Thanh Tử)/`), nên chat cũ vẫn khớp. Regex sửa xong mà không chạy được thì tự hoàn nguyên.
- **Bảng tên (Pha 0)**: một lượt AI đề xuất bản dịch cố định cho từng tên riêng, bạn sửa tay thoải mái — để hàng chục lô chạy song song không mỗi lô dịch tên một kiểu.
- **Tự lưu tiến độ**: F5 hay tắt trình duyệt giữa chừng, mở lại nạp đúng file là dịch tiếp, phần đã dịch không tốn tiền API lần nữa.
- Cuối cùng có **báo cáo sức khoẻ**: JS còn hợp lệ không, ngoặc có lệch không, còn chuỗi nào chưa dịch — kèm nút "Dịch lại mục lỗi".

════════════════ TIN 4/5 ════════════════

## 🈶 TOOL MỚI: Dịch Preset

Tab mới, dịch **preset SillyTavern** (JSON, 250+ prompts). Cũng dùng chung API key với Dịch Card.

Điểm khó nhất của preset là **tính nhất quán**: một tag như `正文` phải thành cùng một chữ ở cả trăm chỗ, và tên biến `{{setvar}}` đổi thì phải đổi đủ cả hai vế — sót một cái là preset chạy sai âm thầm. Cách giải: AI chỉ **đề xuất** từ điển (tag + tên biến + tên riêng, bạn sửa được), còn việc thay tên là **máy thay toàn cục** nên không thể lệch.

- Bảng kê rõ trước khi chạy: bao nhiêu prompt, bao nhiêu regex, script nhúng nào.
- **Giữ nguyên tuyệt đối**: identifier, thứ tự, bật/tắt, vai trò, vị trí chèn của từng prompt.
- Regex chứa tiếng Trung **ngoài** từ điển (kiểu blocklist từ văn phong) thì **giữ nguyên** và liệt kê "cần chỉnh tay" — tự chế lại mấy regex đó dễ phá preset.
- Script TavernHelper nhúng trong preset (có cái là app JS 384 KB) đi **nguyên pipeline Dịch Script** với cùng một từ điển.
- Kiểm tra cuối: JSON hợp lệ, cấu trúc nguyên vẹn, và **đếm khớp từng biến** `{{setvar}}` / `{{getvar}}`.

════════════════ TIN 5/5 ════════════════

## 🛡️ Đợt soát lỗi lớn trước khi phát hành

Bản này đã qua một vòng review chéo và chạy thử thật với API. Ba lỗi nặng được tìm ra và vá:

- **Thiếu một thư mục tool là sập cả app.** Nếu bạn copy thiếu folder, hoặc phần mềm diệt virus chặn, thì chỉ cần bấm nhầm tab đó là **mất toàn bộ công việc đang dịch dở**. Nay báo lỗi tử tế kèm nút Thử lại.
- **Lệnh Dừng server có thể tắt nhầm chương trình khác của bạn** (Windows tái dùng mã tiến trình rất nhanh). Nay chỉ dừng đúng thứ còn đang chạy.
- **Mở app ở 2 cửa sổ thì cửa sổ kia tự bật lại tool bạn vừa Dừng.** Nay mọi cửa sổ đều tôn trọng ý bạn.

Cộng thêm 2 lỗi dịch: từ điển có cả `好感` lẫn `好感度` thì tên dài bị băm nát làm đứt dây biến; và regex dạng `/A|B/` (khớp nhiều tên, rất phổ biến) bị bỏ qua hoàn toàn — tính năng im lặng không chạy.

## ✨ Chi tiết nhỏ cho dễ dùng

- Đang dịch thì **khoá nạp file** — trước đây nạp file khác giữa chừng sẽ tải ra file sai tên.
- Đang tạo bảng tên thì **khoá nút Dịch** — trước đây bấm vội là bảng tên bị bỏ qua âm thầm.
- Dừng server thất bại giờ **hiện băng đỏ nói rõ lý do** thay vì màn hình nháy một cái rồi thôi.
- Bảng từ điển không còn nuốt mất dòng bạn đang gõ.
- Toàn bộ thông báo lỗi và báo cáo kiểm tra đã dịch đủ **Tiếng Việt / English / 中文**.

## ⚠️ Lưu ý khi dùng

- Hai tool mới **chỉ dịch Trung → Việt**, dùng chung cấu hình API với Dịch Card.
- File càng lớn càng tốn lượt gọi API (script 1.5 MB khoảng ~170 lượt) — cứ yên tâm bấm Dừng giữa chừng, lần sau chạy tiếp không mất phần đã dịch.
- Nếu model của bạn báo lỗi 502, thử đổi sang model khác rồi chạy lại.
- Bản dịch xong nên **mở thử trong SillyTavern một lượt** trước khi dùng chính thức — báo cáo sức khoẻ bắt được lỗi cấu trúc, nhưng không thay được một lần chạy thật.

════════════════ HẾT ════════════════
