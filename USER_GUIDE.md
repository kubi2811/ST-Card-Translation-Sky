# HƯỚNG DẪN SỬ DỤNG — SILLY TAVERN MULTITOOLS

Bộ công cụ gồm 8 app dùng chung một cấu hình API. Tài liệu này bao trọn **toàn bộ** các app; phần
ruột sâu của Tạo Card còn có tài liệu riêng dày hơn ngay trong app đó.

> Tài liệu này được cập nhật cùng lúc với mỗi lần thêm tính năng hoặc sửa lỗi. Mục
> **"Có gì mới"** ở cuối tab Hướng dẫn dựng thẳng từ commit thật nên luôn khớp với bản đang chạy.

---

## 1. Bắt đầu trong 3 phút

1. **Thêm API key** — vào **Cài đặt** của bất kỳ app nào, dán key. Key dùng chung cho cả bộ, chỉ
   cần nhập một lần.
2. **Chọn app** ở thanh bên trái theo việc cần làm (bảng ngay dưới).
3. **Đổi phiên bản** khi cần — tab *Chọn phiên bản* của chính app Giới thiệu này. Mỗi bản có nút
   *Log* xem chi tiết đã sửa gì; mở được nhiều bản cùng lúc để so.

### Chọn app nào?

| Bạn muốn | App |
|---|---|
| Dịch một thẻ tiếng Trung sang tiếng Việt | 🌐 **Dịch Card** |
| Dịch script TavernHelper nhúng trong thẻ | 📜 **Dịch Script** |
| Dịch preset SillyTavern | 🈶 **Dịch Preset** |
| Tạo thẻ mới từ ý tưởng, hoặc từ cả một bộ truyện | 🃏 **Tạo Card** |
| Tạo/gộp preset bằng hội thoại | 🎛️ **Tạo Preset** |
| Sửa thẻ có sẵn theo yêu cầu bằng lời | 🛠️ **Mod Card** |
| Cào wiki thành nguồn cho lorebook | 🧭 **Web Crawler** |
| Trích thẻ từ file truyện | 🔍 **Trích Card** |

---

## 2. 🌐 Dịch Card

Dịch thẻ nhân vật (.png/.json) sang tiếng Việt mà **không phá cấu trúc** — biến MVU, regex, script
và EJS đều được giữ đúng.

**Các bước**
1. Nạp thẻ → app tách thẻ thành từng trường để dịch riêng.
2. Chọn phạm vi: *Dịch nhẹ* (chỉ phần người đọc thấy) hay *Dịch đầy đủ* (cả ruột thẻ).
3. **Pha 0 — Từ điển**: app đề xuất bảng tên riêng/thuật ngữ. **Duyệt bảng này trước khi chạy** —
   nó chốt một bản dịch duy nhất cho mỗi tên, để hàng chục lô chạy song song không mỗi lô dịch một
   kiểu.
4. Bấm dịch. Tiến trình tự lưu ra file: F5 hay đóng tab đều không mất.
5. Tab **Regex** dịch riêng phần giao diện thẻ. Xong phải bấm **Áp bản dịch vào thẻ** thì mới ghi
   vào thẻ thật.

**Panel Kiểm tra** chạy các phép đối chiếu chéo, đáng xem trước khi xuất:
- HTML ↔ initvar: giao diện có đọc đúng tên biến đã dịch không.
- findRegex ↔ nội dung: regex có còn khớp văn bản sau khi dịch không.
- **Schema ↔ Hướng dẫn định dạng biến**: thẻ MVU có hai nơi cùng khai biến (script zod và entry
  *Định Dạng Xuất Biến*). Lệch nhau thì **không có lỗi nào báo**, nhưng AI hoặc ghi vào đường không
  tồn tại (chỉ số đứng im), hoặc không biết biến đó tồn tại nên không bao giờ cập nhật.

**Cái bẫy hay gặp:** nhập lại một thẻ đang dịch dở — phần Regex đã dịch vẫn được giữ, không bị trả
về nguyên bản.

---

## 3. 📜 Dịch Script

Dịch phần chữ trong script TavernHelper mà **không đụng vào code**. Code không bao giờ được gửi cho
AI — chỉ danh sách chuỗi đã tách, nên cấu trúc script được bảo toàn bởi thiết kế chứ không nhờ AI
ngoan.

**Các bước**
1. Dán hoặc nạp file script.
2. **Bước 3 — Từ điển (Pha 0)**: bấm *Tạo từ điển (1 lượt AI)*. Bảng này giờ gồm cả **tên khoá dữ
   liệu** (`世界运转`, `天气`…), không chỉ tên riêng trong văn xuôi.
3. Sửa/thêm/xoá trong bảng rồi chạy.

**Điều quan trọng nhất phải hiểu:** *Từ điển chính là công cụ đổi tên biến.*
- Tên có trong từ điển → đổi **tất định**, không qua AI, đổi đồng loạt cả chỗ đọc lẫn chỗ ghi.
- Tên không có trong từ điển → **giữ nguyên chữ Hán**, đó là mặc định an toàn.

Nếu thẻ của bạn đã dịch biến sang tiếng Việt thì script cũng **phải** đổi theo, nếu không script
đọc khoá Hán sẽ ra rỗng — chạy trơn tru mà dữ liệu không có, không lỗi nào báo.

**Đọc báo cáo cuối**
- *"N token giữ nguyên (còn X ký tự Trung nằm ở đây)"* — đây là khoá dữ liệu chưa có trong từ điển.
  Muốn đổi thì thêm vào Từ Điển rồi chạy lại.
- *"Regex: vá N, hoàn nguyên M"* — nhánh tiếng Việt được thêm vào regex, giữ nguyên nhánh Hán để
  khớp cả nội dung cũ lẫn mới; nhánh mới không compile được thì trả lại nguyên trạng.
- Dòng ❌ về cú pháp JS là **lỗi thật**, đừng bỏ qua: file xuất ra sẽ không chạy.

---

## 4. 🈶 Dịch Preset

Dịch preset SillyTavern, giữ **đồng bộ nhãn** giữa prompt và regex.

Vì sao cần đồng bộ: prompt bảo AI xuất `>选项一：`, còn regex thì rình đúng chuỗi đó. Dịch prompt mà
quên regex là regex thành vô dụng — mà không có lỗi nào báo.

App xử lý cả những vùng dễ bị bỏ quên: bản sao regex nằm trong `extensions.SPreset`, các trường
prompt ở cấp cao nhất (`new_chat_prompt`, `assistant_prefill`), và có vòng quét lại chữ Hán sót để
vá những mục AI dịch nửa chừng.

Regex chứa thuật ngữ lạ ngoài từ điển sẽ được **giữ nguyên và báo cho bạn xem tay** — tự chế lại
ngữ nghĩa của chúng là không an toàn.

---

## 5. 🃏 Tạo Card

App lớn nhất, gồm nhiều màn.

### 5.1 Auto Creator — tạo thẻ từ ý tưởng
1. Gõ ý tưởng (càng cụ thể càng tốt). Bấm 🪄 **Đũa thần** để AI sắp xếp lại thành đề bài rõ ràng.
2. Ô **Yêu cầu/quy tắc cho AI** để đặt luật riêng cho thẻ này.
3. **Xem trước & Tinh chỉnh** — nên dùng, đây là chỗ bạn nắm quyền:
   - *Bước 1 · Schema*: duyệt bảng biến MVU trước khi tạo. Bảng có 5 cột cố định, ô nhập đổi theo
     Kiểu của từng hàng, và nhóm hiện thành cây lồng cấp. Ba kiểu cấu trúc:
     - **Object** — nhóm cố định, biết trước có những trường nào.
     - **Array** — danh sách, số phần tử đổi khi chơi (Kho Đồ). Khởi tạo `[]`.
     - **Record** — từ điển, tên khoá sinh ra khi chơi (Quan hệ NPC). Khởi tạo `{}`; **đừng khai sẵn
       tên khoá**, vì mỗi lần khởi tạo lại nó sẽ đè lên dữ liệu thật của người chơi.
   - *Bước 2 · Giao diện*: 3-4 mẫu dựng thẳng từ schema, **bấm/kéo thử được** như trong SillyTavern.
     Có nút *Mở rộng* để xem to, và công tắc *Xem với biến của schema*.
   - *Bước 3*: chốt. Pipeline sẽ dùng **đúng 100%** schema và giao diện đã chốt.
4. Bấm tạo. Cuối quy trình có **Kiểm tra tổng thể** rồi **Vá lỗi tự động**.

> Dữ liệu của "Xem trước & Tinh chỉnh", ô Ý tưởng và ô Quy tắc được lưu **riêng cho từng thẻ** —
> chuyển sang thẻ khác sẽ thấy đúng dữ liệu của thẻ đó.

### 5.2 Tạo thẻ từ truyện
Đây **không phải** công cụ tạo một thẻ nhân vật đơn lẻ, cũng **không phải** công cụ soi lỗ hổng cốt
truyện. Nó là bộ **chuyển cả cuốn truyện thành cơ sở tri thức để nhập vai**: một Character Card làm
điểm khởi đầu, cộng một Lorebook chứa toàn bộ tri thức thế giới.

Quy trình đọc nhiều vòng: cấu trúc → danh sách nhân vật → hồ sơ từng nhân vật → thế giới quan →
timeline → văn phong tác giả → **đọc đối chiếu lặp tới khi hết thông tin mới** → tổng hợp Card +
Lorebook → khử trùng lặp & soát nhất quán.

- Chọn **số vòng đọc đối chiếu** (5 là hợp lý cho truyện dài).
- Bỏ tick **Tạo Character Card** nếu chỉ cần Lorebook — **không ảnh hưởng** tới số entry.
- Truyện giữ bí mật điều gì thì entry vẫn được tạo, ghi rõ "chưa được tiết lộ tại thời điểm đó" —
  đó là lore hợp lệ, người nhập vai cần biết là chưa ai biết.
- Tạm dừng / tiếp tục bất kỳ lúc nào; tiến trình tự lưu, F5 không mất.

### 5.3 Lorebook, MVUZOD, EJS Studio, Wiki Collector
- **Lorebook**: quản lý entry, dọn trùng lặp ngữ nghĩa, kiểm tra sức khoẻ worldbook, **AI Sinh theo
  Batch** (bật/tắt bằng công tắc, trạng thái hiện rõ ở Auto Creator).
- **MVUZOD**: schema biến, initvar, quy tắc cập nhật, bảng trạng thái.
- **EJS Studio**: mô tả "bạn muốn EJS làm gì" → app lập bảng kế hoạch, gộp các thay đổi liên quan,
  ước lượng token, rà xung đột trước khi áp.
- **Wiki Collector**: cào wiki thành entry.

---

## 6. 🎛️ Tạo Preset

Tạo preset mới bằng hội thoại. Nạp vài preset mẫu vào thư viện rồi ra lệnh kiểu *"gộp A với B"*,
*"sửa preset này cho hợp dịch thuật"*.

---

## 7. 🛠️ Mod Card

Sửa thẻ có sẵn theo yêu cầu bằng lời, **xem trước thay đổi trước khi áp**. Mod được nhiều lần nối
tiếp nhau, và xem được entry lorebook sau mỗi lần mod.

---

## 8. 🧭 Web Crawler

Cào dữ liệu web/wiki thành nguồn cho lorebook. Có nhiều đường lấy dữ liệu (API MediaWiki, proxy nội
bộ, theo chuyển hướng) để lách các trang chặn.

---

## 9. 🔍 Trích Card

Trích thẻ từ file truyện `.txt` / `.epub`. Nhẹ hơn "Tạo thẻ từ truyện" — dùng khi chỉ cần thẻ nhân
vật, không cần cả thế giới.

---

## 10. Những cái bẫy chung, đáng nhớ

**Lỗi im lặng đáng sợ hơn lỗi đỏ.** Phần lớn hỏng hóc trong bộ này không làm app văng ra — nó chạy
xong, báo xanh, mà kết quả sai. Vì thế:
- Xem **panel Kiểm tra** trước khi xuất thẻ.
- Báo cáo cuối của Dịch Script/Preset nói rõ cái gì được giữ nguyên và vì sao — đọc nó.
- Thấy "0 entry" sau một lượt chạy dài thì **đó là lỗi**, không phải "truyện thiếu dữ liệu". Chạy
  lại; vẫn vậy thì đổi model.

**Từ điển là nơi bạn nắm quyền.** Ở cả Dịch Card, Dịch Script và Dịch Preset, bảng từ điển quyết
định tên gọi cuối cùng. Duyệt nó trước khi chạy sẽ tiết kiệm rất nhiều thời gian sửa sau.

**Tiến trình luôn được lưu.** Mọi app chạy dài đều có tạm dừng/tiếp tục và tự lưu ra file. Đóng tab
giữa chừng không mất việc đã làm.

---

## 11. Khi gặp lỗi

1. Chụp màn hình + **gửi kèm file bị lỗi và file gốc**.
2. Ghi rõ từng bước đã bấm, hoặc dán đúng prompt đã nhập — có tái hiện được thì mới sửa được.
3. Gửi vào kênh Discord. Nút **Báo lỗi** ở góc trên bên phải mở thẳng kênh đó.
