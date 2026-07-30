# HƯỚNG DẪN SỬ DỤNG — SILLYTAVERN MULTITOOLS

Bộ công cụ gồm **8 app làm việc** cộng app **Giới thiệu** (chính chỗ bạn đang đọc). Tài liệu này bao
trọn cả 8 app. Riêng ruột sâu của **Tạo Card** còn có tài liệu dày hơn nữa nằm ngay trong app đó
(nút *Hướng Dẫn Sử Dụng* ở app Tạo Card) — ở đây chỉ tóm phần cần để dùng được.

> **Tài liệu này không được để mục ruỗng.** Mỗi app trong bộ và mỗi tính năng lớn đều có một test
> canh: thêm app mới hoặc thêm tính năng lớn mà quên viết vào đây là test đỏ ngay lúc build. Xem
> mục 12 để biết cách nó hoạt động. Mục **"Có gì mới"** ở cuối tab Hướng dẫn thì dựng thẳng từ
> commit thật, nên luôn khớp với bản đang chạy.

---

## 1. Bắt đầu — ba điều phải biết trước

### 1.1 API key: KHÔNG dùng chung cho cả bộ

Đây là chỗ nhầm đầu tiên của gần như mọi người. Sự thật:

| Nhóm | Cấu hình API |
|---|---|
| 🌐 Dịch Card · 📜 Dịch Script · 🈶 Dịch Preset | **Dùng chung một pool** provider/key. Nhập một lần là cả ba app dùng. |
| 🃏 Tạo Card · 🎛️ Tạo Preset · 🛠️ Mod Card · 🧭 Web Crawler | **Mỗi app một bộ riêng.** Phải vào Cài đặt của từng app nhập lại. |
| 🔍 Trích Card | Bộ riêng, và còn cho **lưu nhiều cấu hình** để đổi nhanh. |

Vì sao phải vậy: ba app dịch chạy chung trong một trang, còn các app kia là ứng dụng độc lập chạy ở
cổng riêng — trình duyệt cố tình không cho trang ở cổng này đọc dữ liệu đã lưu của cổng khác. Đó là
cơ chế bảo mật của trình duyệt, không phải thiếu sót.

Nên nếu Mod Card báo *"Chưa cấu hình API Key"* trong khi bạn vừa dịch card xong bình thường — không
có gì hỏng, chỉ là app đó chưa được nhập key.

### 1.2 Chọn app nào?

| Bạn muốn | App |
|---|---|
| Dịch một thẻ nhân vật tiếng Trung sang tiếng Việt | 🌐 **Dịch Card** |
| Dịch script TavernHelper nhúng trong thẻ | 📜 **Dịch Script** |
| Dịch preset SillyTavern (250+ prompts) | 🈶 **Dịch Preset** |
| Tạo thẻ mới từ ý tưởng, hoặc từ cả một bộ truyện; làm biến RPG, EJS, lorebook | 🃏 **Tạo Card** |
| Soạn preset mới bằng hội thoại, hoặc gộp/sửa preset có sẵn | 🎛️ **Tạo Preset** |
| Sửa một thẻ đã có theo yêu cầu bằng lời, xem trước rồi mới áp | 🛠️ **Mod Card** |
| Sao chép một website tĩnh về máy rồi chạy thử tại chỗ | 🧭 **Web Crawler** |
| Đọc file truyện rồi trích ra thẻ nhân vật + lorebook | 🔍 **Trích Card** |

### 1.3 Đổi phiên bản và đọc log

Tab **Chọn phiên bản** ngay trong app Giới thiệu này là **nơi duy nhất** để đổi bản — các đường đổi
version rải rác ở app khác đã bị gỡ.

- Lọc theo app để chỉ xem những bản có sửa app bạn quan tâm.
- Nút **Log** mở nội dung chi tiết của bản đó. **Mở được nhiều bản cùng lúc** để đặt cạnh nhau so.
- **Dùng bản này** sẽ `git checkout` rồi cài lại thư viện cho cả bộ. Xong phải **F5** mới thấy bản mới.

---

## 2. 🌐 Dịch Card

Dịch thẻ nhân vật (`.png` / `.json`) sang tiếng Việt mà **không phá cấu trúc** — biến MVU, regex,
script và EJS đều được giữ đúng.

### Các bước dịch một thẻ

1. **Nạp thẻ** → app tách thẻ thành từng trường để dịch riêng.
2. **Chọn phạm vi**: *Dịch nhẹ* (chỉ phần người đọc thấy) hay *Dịch đầy đủ* (cả ruột thẻ).
3. **Pha 0 — Từ điển**: app đề xuất bảng tên riêng / thuật ngữ. **Duyệt bảng này trước khi chạy** —
   nó chốt một bản dịch duy nhất cho mỗi tên, để hàng chục lô chạy song song không mỗi lô dịch một
   kiểu.
4. **Bấm dịch.** Tiến trình tự lưu ra file: F5 hay đóng tab đều không mất. Tạm dừng / tiếp tục được
   bất kỳ lúc nào, và nối lại đúng chỗ đã dừng chứ không dịch lại từ đầu.
5. **Tab Regex** dịch riêng phần giao diện thẻ. Xong **phải bấm "Áp bản dịch vào thẻ"** thì mới ghi
   vào thẻ thật — đây là bước hay bị quên nhất.

### Panel Kiểm tra — nên xem trước khi xuất

Panel này chạy các phép đối chiếu chéo mà mắt thường không soi được:

- **HTML ↔ initvar** — giao diện có đang đọc đúng tên biến đã dịch không.
- **findRegex ↔ nội dung** — regex có còn khớp văn bản sau khi dịch không.
- **Schema ↔ Hướng dẫn định dạng biến** — thẻ MVU có **hai** nơi cùng khai biến: script zod và entry
  *Định Dạng Xuất Biến*. Lệch nhau thì **không có lỗi nào báo**, nhưng AI hoặc ghi vào một đường
  không tồn tại (chỉ số đứng im mãi), hoặc không biết biến đó tồn tại nên không bao giờ cập nhật nó.

### Cái bẫy hay gặp

Nhập lại một thẻ đang dịch dở — phần **Regex đã dịch vẫn được giữ**, không bị trả về nguyên bản.
Trước đây nó bị mất, nay thì không.

---

## 3. 📜 Dịch Script

Dịch phần chữ trong script TavernHelper mà **không đụng vào code**. Code không bao giờ được gửi cho
AI — chỉ danh sách chuỗi đã tách. Nên cấu trúc script được bảo toàn **bởi thiết kế**, không nhờ AI
ngoan.

### Các bước dịch một script

1. Dán hoặc nạp file script.
2. **Bước 3 — Từ điển (Pha 0)**: bấm *Tạo từ điển (1 lượt AI)*. Bảng này gồm cả **tên khoá dữ liệu**
   (`世界运转`, `天气`…), không chỉ tên riêng trong văn xuôi.
3. Sửa / thêm / xoá trong bảng rồi chạy.

### Điều quan trọng nhất phải hiểu

**Từ điển chính là công cụ đổi tên biến.**

- Tên **có** trong từ điển → đổi **tất định**, không qua AI, đổi đồng loạt cả chỗ đọc lẫn chỗ ghi.
- Tên **không có** trong từ điển → **giữ nguyên chữ Hán**. Đó là mặc định an toàn, không phải lỗi.

Nếu thẻ của bạn đã dịch biến sang tiếng Việt thì script **phải** đổi theo. Không đổi thì script đọc
khoá Hán sẽ ra rỗng — chạy trơn tru, không lỗi nào báo, mà dữ liệu không có.

Và nguy hơn cả không đổi là **nửa đổi nửa không**: chỗ ghi trỏ vào ô này, chỗ đọc trỏ vào ô khác.
Vì vậy khi một tên đã vào từ điển, nó được đổi ở *mọi* thế xuất hiện an toàn.

### Đọc báo cáo cuối của Dịch Script

- **"N token giữ nguyên (còn X ký tự Trung nằm ở đây)"** — đây là khoá dữ liệu chưa có trong từ
  điển. Muốn đổi thì thêm vào Từ Điển rồi chạy lại.
- **"Regex: vá N, hoàn nguyên M"** — nhánh tiếng Việt được thêm vào regex, giữ nguyên nhánh Hán để
  khớp cả nội dung cũ lẫn mới. Nhánh mới không compile được thì trả lại nguyên trạng.
- **"Số dòng: vào N → ra M"** — hai số này phải gần bằng nhau. Chênh nhiều là dấu hiệu có xuống dòng
  lọt vào giữa chuỗi. Script minify một dòng mà ra bốn mươi dòng thì gần như chắc chắn file đã vỡ.
- **Dòng ❌ về cú pháp JS là lỗi thật**, đừng bỏ qua: file xuất ra sẽ không chạy. Triệu chứng trong
  SillyTavern là *"Unterminated string constant"* và script chết hoàn toàn.

---

## 4. 🈶 Dịch Preset

Dịch preset SillyTavern (JSON, thường 250+ prompts) và giữ **đồng bộ nhãn** giữa prompt, regex và
script nhúng.

### Vì sao "đồng bộ" là cả vấn đề

Prompt bảo AI xuất ra `>选项一：`, còn regex thì rình đúng chuỗi đó để tô màu. Dịch prompt mà quên
regex là regex thành vô dụng — **mà không có lỗi nào báo**, chỉ là giao diện tự nhiên hết đẹp.

### Các bước dịch một preset

1. Nạp file preset `.json`. App đếm ngay: bao nhiêu prompts, bao nhiêu regex, bao nhiêu script nhúng,
   bao nhiêu ký tự Trung.
2. **Pha 0 — Từ điển**: một lượt AI đề xuất ba loại tên — **tag tự chế** (`正文` → *Chính văn*),
   **tên biến** `{{setvar}}`/`{{getvar}}` (chỉ ASCII), và tên riêng. Sau đó **code** thay toàn cục,
   nguyên tử. AI không bao giờ tự đổi tên.
3. Tuỳ chọn **"Dịch cả script TavernHelper nhúng"** — script nhúng (có cái là app JS 300KB+) đi
   nguyên pipeline Dịch Script với **cùng một từ điển**, nên tag khớp giữa preset và script.
4. Chạy. Pipeline sáu chặng: đọc preset → dịch → áp từ điển toàn cục → vá regex → dịch script nhúng
   → kiểm tra.

### Những vùng dễ bị bỏ quên mà app có quét

- Bản sao regex nằm trong `extensions.SPreset` — cùng một regex tồn tại hai chỗ, dịch một chỗ là lệch.
- Các trường prompt ở cấp cao nhất: `new_chat_prompt`, `assistant_prefill`…
- Vòng **quét lại chữ Hán sót** để vá những mục AI dịch nửa chừng, chạy tối đa 2 lượt bù.
- Mục trùng nội dung được nhân bản bản dịch sang chứ không dịch lại — vừa nhanh vừa không lệch.

### Đọc báo cáo cuối của Dịch Preset

- **Cấu trúc nguyên vẹn** — số lượng, thứ tự, identifier, field đóng băng, `prompt_order`.
- **Macro khớp tuyệt đối** — `{{setvar}}`/`{{getvar}}` đủ số theo từng biến. Lệch là có biến bị đổi
  tên ở chỗ ghi mà không đổi ở chỗ đọc.
- **Đồng bộ N regex với nhãn trong prompt** — chính là phần chống lỗi im lặng nói ở trên.
- Regex chứa thuật ngữ lạ ngoài từ điển được **giữ nguyên và báo cho bạn xem tay**. Tự chế lại ngữ
  nghĩa của chúng là không an toàn.

---

## 5. 🃏 Tạo Card

App lớn nhất bộ, gồm nhiều màn. Phần dưới đủ để bạn biết màn nào làm gì và đi đúng chỗ; muốn đào sâu
từng màn thì mở **Hướng Dẫn Sử Dụng** trong chính app Tạo Card.

### 5.1 Auto Creator — tạo thẻ từ ý tưởng

1. Gõ ý tưởng, càng cụ thể càng tốt. Bấm 🪄 **Đũa thần** để AI sắp lại thành đề bài rõ ràng.
2. Ô **Yêu cầu / quy tắc cho AI** để đặt luật riêng cho thẻ này (giọng văn, điều cấm, thể loại).
3. Chọn chế độ tạo (pipeline) rồi bấm tạo.
4. Cuối quy trình có **Kiểm tra tổng thể** rồi **Vá lỗi tự động** — nên chạy cả hai.

> Dữ liệu của *Xem trước & Tinh chỉnh*, ô Ý tưởng và ô Quy tắc được lưu **riêng cho từng thẻ**.
> Chuyển sang thẻ khác sẽ thấy đúng dữ liệu của thẻ đó, không bị lẫn.

### 5.2 Xem trước & Tinh chỉnh — chỗ bạn nắm quyền

Nên dùng. Đây là nơi bạn chốt trước khi tốn cả một lượt pipeline dài.

**Bước 1 · Schema** — duyệt bảng biến MVU. Bảng có 5 cột cố định, ô nhập đổi theo Kiểu của từng
hàng, nhóm hiện thành cây lồng cấp, và sắp lại thứ tự bằng nút lên/xuống. Ba kiểu cấu trúc:

- **Object** — nhóm cố định, biết trước có những trường nào (Thời Gian: Giờ, Phút).
- **Array** — danh sách, số phần tử đổi khi chơi (Kho Đồ). Khởi tạo `[]`.
- **Record** — từ điển, tên khoá sinh ra khi chơi (Quan hệ NPC). Khởi tạo `{}`. **Đừng khai sẵn tên
  khoá** — mỗi lần khởi tạo lại nó sẽ đè lên dữ liệu thật của người chơi.

Không tự sửa tay thì bấm **Nhờ AI sửa giùm** — AI thêm được biến mới, không chỉ sửa biến có sẵn.

**Bước 2 · Giao diện** — 3-4 mẫu dựng thẳng từ schema, **bấm / kéo thử được** như trong SillyTavern.
Có cả **Opening Form mô phỏng**: điền form xong thì Status Bar bên cạnh **tự cập nhật theo**, đúng
như lúc chơi thật. Nút *Mở rộng* để xem to, công tắc *Xem với biến của schema* để thấy số liệu thật.

**Bước 3** — chốt. Pipeline sẽ dùng **đúng 100%** schema và giao diện đã chốt, không tự ý đổi.

### 5.3 Tạo thẻ từ truyện

Đây **không phải** công cụ tạo một thẻ nhân vật đơn lẻ, cũng **không phải** công cụ soi lỗ hổng cốt
truyện. Nó là bộ **chuyển cả cuốn truyện thành cơ sở tri thức để nhập vai**: một Character Card làm
điểm khởi đầu, cộng một Lorebook chứa toàn bộ tri thức thế giới.

Quy trình đọc nhiều vòng: cấu trúc → danh sách nhân vật → hồ sơ từng nhân vật → thế giới quan →
timeline → văn phong tác giả → **đọc đối chiếu lặp tới khi hết thông tin mới** → tổng hợp Card +
Lorebook → khử trùng lặp & soát nhất quán.

- Chọn **số vòng đọc đối chiếu** — 5 là hợp lý cho truyện dài.
- Bỏ tick **Tạo Character Card** nếu chỉ cần Lorebook. Việc này **không ảnh hưởng** tới số entry.
- Truyện giữ bí mật điều gì thì entry **vẫn được tạo**, ghi rõ "chưa được tiết lộ tại thời điểm đó".
  Đó là lore hợp lệ: người nhập vai cần biết là chưa ai biết.
- Tạm dừng / tiếp tục bất kỳ lúc nào; tiến trình tự lưu, F5 không mất.
- Quét xong mà ra **0 entry thì đó là lỗi**, không phải "truyện thiếu dữ liệu". App sẽ cảnh báo rõ
  khi số dữ kiện thu được nhiều mà số entry ra lại bằng không.
- **Một phần hỏng không làm mất cả lượt quét.** Lượt đọc nào dính lỗi tạm thời (hết lượt/phút,
  timeout, khoá hết hạn) sẽ bị bỏ qua và quá trình chạy tiếp, cuối cùng vẫn ra lorebook — chỉ mỏng
  hơn. Báo cáo cuối ghi rõ đã bỏ qua những phần nào để bạn chạy lại bù nếu muốn.

### 5.4 Sổ tay tri thức (Lorebook)

Quản lý toàn bộ entry của thẻ, kèm những bộ soát mà làm tay không nổi:

- **Danh sách & trình biên tập chi tiết** từng entry (từ khoá, vị trí chèn, độ sâu, constant…).
- **Dọn trùng lặp ngữ nghĩa** — hai entry viết khác chữ nhưng cùng một ý.
- **Worldbook Health Check** — soát sức khoẻ tổng thể worldbook.
- **RAG Debug** — giả lập: gõ một câu, xem entry nào sẽ kích hoạt. Rất hữu ích khi entry "có mà
  không bao giờ chạy".
- **AI Sinh theo Batch** — sinh hàng loạt entry, bật/tắt bằng công tắc; trạng thái hiện rõ ở Auto
  Creator để bạn không chạy nhầm chế độ.
- **Trích xuất tài liệu** — đổ tài liệu vào thành entry.
- **Cào Wiki** — xem 5.8.
- **Phân tích & tối ưu cấu trúc**, **Chất lượng MN**, **Sinh EJS điều khiển (TCTRL)**.

### 5.5 MVUZOD Studio — xưởng biến RPG động

Tám tab, đi theo thứ tự là ra một bộ biến chạy được:

1. **Schema Wizard** — thiết kế cấu trúc biến.
2. **InitVar Editor** — thiết lập giá trị khởi tạo.
3. **Biến Số** — sinh danh sách biến.
4. **Update Rules** — quy tắc cập nhật biến (AI đọc cái này để biết khi nào tăng/giảm gì).
5. **Patch Simulator** — giả lập một lượt cập nhật, xem biến đổi ra sao trước khi xuất.
6. **Script Output** — trích mã nguồn ra.
7. **Game UI Preview** — xem giao diện game.
8. **Playground** — kiểm thử chat tương tác.

Một luật phải nhớ: **`[initvar]` phải để tắt** trong thẻ xuất ra. Bật là mỗi lượt chat nó khởi tạo
lại biến, đè sạch dữ liệu người chơi.

### 5.6 EJS Studio

Mô tả "bạn muốn EJS làm gì" → app lập **bảng kế hoạch**, gộp các thay đổi liên quan thành nhóm, tách
entry khi cần, **ước lượng token**, và **rà xung đột** trước khi áp. Có **Preset Nhanh** cho các mẫu
hay dùng, kèm bước **xác minh preset đã thật sự áp** — trước đây bấm xong không biết nó có vào không.

### 5.7 Phòng thí nghiệm Regex

Giao diện hai cột để viết và thử regex ngay tại chỗ, có **Regex Copilot** và **thư viện 10 pattern
thực tế** dùng làm khuôn.

### 5.8 Wiki Collector — cào wiki thành lorebook

**Đây mới là chỗ cào wiki**, không phải app 🧭 Web Crawler. Nó gọi API MediaWiki, và khi wiki chặn
thì tự đổi đường: proxy nội bộ, đi theo chuyển hướng, nhiều tầng transport khác nhau. Kết quả đổ
thẳng thành entry lorebook.

---

## 6. 🎛️ Tạo Preset

Soạn preset SillyTavern mới bằng hội thoại, hoặc gộp / sửa preset có sẵn.

### Hai chế độ và thư viện dự án

- Công tắc **Preset Mode / Regex Mode** ở đầu app — làm preset hay làm bộ regex.
- **Dự Án Đang Lưu** giữ nhiều dự án song song. **Nhấp đúp** lên tên để đổi tên. Nhập / xuất dự án
  bằng file JSON.

### Năm bước

1. **Tham số** — nhiệt độ, top_p, các tham số sinh.
2. **Khối Prompts** — từng prompt block, bật/tắt và sắp thứ tự.
3. **Template** — xem ngay dưới.
4. **Regex Scripts** — các script regex kèm preset.
5. **Xuất bản JSON** — ra file nạp thẳng vào SillyTavern.

### Tool tạo Template Preset (bước 3)

Nhập **bối cảnh · thể loại · chủ đề cốt truyện**, chọn **ngôi kể** (ngôi 3 giới hạn được khuyên
dùng) và số đoạn mỗi lượt. Tool xuất ra một System Prompt hoàn chỉnh **chia thành 5 khối độc lập** có
nhãn đóng/mở.

Hai cách tạo:

- **Tạo mẫu (không cần AI)** — chạy ngay tại máy, không tốn API.
- **Tạo bằng AI** — lấy bản mẫu đó làm khung rồi may đo lại từ ngữ, chi tiết giác quan và kiểu xung
  đột cho khớp thể loại bạn nhập.

Mỗi khối được soát riêng: *khối hợp lệ* / *thiếu khối* / *khối rỗng* / *có nhãn mở nhưng thiếu nhãn
đóng*. Bấm **Nạp N khối vào Prompts** thì mỗi khối thành một prompt block riêng, **đặt đúng thứ tự**
(biến phải khai báo trước khi khối 3 gọi `[GetVar]`). Nạp lại sẽ **ghi đè đúng các khối cũ**, không
tạo trùng.

### Chat với AI

Cửa sổ chat bên cạnh: ra lệnh kiểu *"gộp preset A với B"*, *"sửa preset này cho hợp dịch thuật"* —
AI sinh hoặc cập nhật thẳng vào Preset/Regex của dự án đang mở.

---

## 7. 🛠️ Mod Card

Sửa một thẻ Character Card V3 đã có theo yêu cầu bằng lời, **xem trước toàn bộ thay đổi trước khi áp**.

### Nạp vào

- **Character Card V3** → mod cả thẻ.
- **File Lorebook** (JSON có `entries`) → chạy **chế độ Mod LOREBOOK**, xuất riêng lorebook.

App tự nhận thẻ có kiến trúc **MVU-ZOD** và hiện danh sách biến được định nghĩa cứng trong Zod Schema.

### Ba cách ra lệnh — dùng đúng cái cho đúng việc

| Việc | Dùng |
|---|---|
| Sửa theo mô tả tự do | Ô **Yêu cầu Mod bằng AI** |
| Thay chủ đề có hệ thống, lặp lại nhiều thẻ | **Rule** — đặt tên, theme cũ → theme mới, từ khoá nhận biết, chi tiết thay đổi. Lưu lại dùng cho thẻ sau. |
| Viết dày thêm chứ không đổi nội dung | **Chế độ Mở rộng / đào sâu** |

**Chế độ Mở rộng** đáng nói riêng: thay vì làm theo nghĩa đen, AI đọc **toàn cảnh** lorebook rồi bổ
sung 3-4 phần mở rộng và viết chi tiết hơn, vẫn bám lore. Ba mức: **Nhẹ · Vừa · Sâu**.

Còn **🔬 Đào sâu 1 phần** thì hẹp hơn nữa: mở rộng đúng **một** phần trong một section (ví dụ block
`<Appearance>` hoặc "Ngoại hình"), giữ nguyên toàn bộ phần còn lại.

### 🧬 Mod biến MVU-Zod

Đổi **tên** hoặc **nghĩa** của biến trong schema theo yêu cầu (`hp → sinh_lực`), và tự áp **đồng bộ**
khắp schema, `getvar`, `initvar`, `mvu_update`. Runtime MVU không bị đụng.

Quy trình: **Phân tích biến** → xem bảng *Biến cũ / Tên mới / Nghĩa mới*, bỏ tick dòng không muốn →
**Áp dụng**. Đây là cách an toàn duy nhất để đổi tên biến, vì nửa đổi nửa không là mất dữ liệu im lặng.

### Năm giai đoạn khi chạy

1. Khởi tạo và chuẩn bị.
2. **Analyze** — LLM đọc thẻ, đánh dấu section nào `NEEDS_MOD` kèm **lý do** và **dự kiến sửa gì**.
3. **Mod** từng section đã đánh dấu. Entry lớn được chia nhỏ cho khỏi lỗi.
4. **Keyword Sync** + **Consistency Audit** — đồng bộ từ khoá rồi cho điểm nhất quán.
5. **Validation** — kiểm định an toàn cấu trúc, xác thực các trường được bảo vệ.

### Đọc kết quả

- **Bảng Diff** — JSON gốc so JSON sau mod, cạnh nhau.
- **Audit Score** (nhất quán) và **Validation Status** (kiểm định) kèm đề xuất.
- **Entry lorebook sau khi mod** — tổng số, đang bật, `+thêm / sửa / mất`, tìm theo tên hoặc nội
  dung, và lọc **chỉ hiện entry có thay đổi**.
- ⚠️ Cảnh báo **"N script có thể VỠ cú pháp sau khi mod"** — nạp vào SillyTavern dễ liệt nút. Thấy
  dòng này thì **phải mở Bảng Diff kiểm tay**, đừng tải về dùng luôn.

### Mod nối tiếp

Chưa ưng thì gõ yêu cầu tiếp và bấm **Mod tiếp (lượt n)** — lượt sau chạy **trên bản vừa ra**, giữ
lại những gì các lượt trước làm đúng. Không phải tải về rồi nạp lại.

### Tải về

- **Tải xuống JSON (đã ghép Avatar)** — thẻ hoàn chỉnh.
- **Tải Lorebook JSON (riêng)** — chỉ lorebook.

---

## 8. 🧭 Web Crawler

**Đây không phải bộ cào wiki thành lorebook** — cái đó nằm trong Tạo Card (mục 5.8). App này làm việc
khác: **sao chép tài nguyên một website tĩnh về máy rồi giả lập môi trường chạy thực tế**, để bạn mở
lại trang đó offline hoặc lấy file phân phối từ đó.

### Cấu hình tải trang

- **Đường dẫn Website mục tiêu** — URL cần sao.
- **Bộ lọc thư mục hợp lệ (Prefixes)** — chặn tải dư thừa bằng cách giới hạn đường dẫn được tải.
  Không đặt là dễ kéo về cả những nhánh không liên quan.
- **Tự phân tích R2 Presets** — đọc `manifest.json` của trang để tự tải các file thẻ / preset nếu có.

Trong lúc chạy có **tiến độ cào theo queue**, **thông số thu thập thực tế** và **cửa sổ Console** để
xem nhật ký.

### Giả lập host local

Chọn thư mục đã thu thập rồi **KHỞI CHẠY HOST** — app dựng một server tại chỗ và cho **xem trước trực
tiếp** đúng như trang thật. Xong thì **ĐÓNG SERVER**.

---

## 9. 🔍 Trích Card

Đọc file truyện `.txt` / `.epub` rồi trích ra **Thẻ Nhân vật** và **Lorebook**. Toàn bộ app là **một
file HTML tự chứa** — văn bản truyện chỉ được gửi tới API do chính bạn thiết lập, không đi đâu khác.

Nhẹ hơn "Tạo thẻ từ truyện" của Tạo Card: dùng khi bạn muốn thẻ nhân vật cụ thể chứ không cần dựng
cả cơ sở tri thức thế giới.

### Cấu hình API — có phần đáng dùng mà hay bị bỏ qua

- Hai định dạng: **tương thích OpenAI** (`/v1/chat/completions`) hoặc **Gemini gốc** (`/v1beta`).
  Lưu **nhiều bộ cấu hình** để đổi nhanh.
- **Pool đa-luồng**: thêm nhiều provider để engine rải call, chạy song song.
- **Model phụ + ngưỡng ký tự** — đoạn ngắn hơn ngưỡng thì đẩy sang model phụ (rẻ / nhanh hơn). Đặt
  **RPM** riêng cho từng model để không bị chặn vì gọi quá nhanh.
- **Chỉ thị bổ sung** — thêm vào đầu mọi yêu cầu (quét / tạo thẻ / lorebook), dùng để ép chuẩn đầu ra
  hoặc giọng điệu.

### Quét nhân vật

- **Quét toàn bộ truyện** nếu chưa biết truyện có những ai. Điều chỉnh **kích thước phân đoạn** và
  **giới hạn số đoạn quét** — quét càng nhiều tìm càng đủ, càng tốn.
- Đã biết cần làm thẻ cho ai thì **nhập tên thủ công** để bỏ hẳn bước quét, tiết kiệm token.
- Kết quả kèm **giới tính, vai (chính / phụ / NPC qua đường), mô tả danh tính** và số lần xuất hiện.
- **Quét trùng & gợi ý gộp** — tìm những "nhân vật" thực ra là một người dưới biệt danh khác, rồi
  gợi ý gộp. Nên chạy: không gộp là thẻ bị xé làm hai bản nửa vời.
- Mẹo tiết kiệm: bật **quét bằng model phụ** (flash — nhanh), bước tạo thẻ vẫn dùng model chính.
- **Lịch sử tiểu thuyết** tự lưu văn bản và danh sách nhân vật đã quét, lần sau tải lại không cần
  quét lại.

### Tạo Thẻ Nhân vật

- **Mẫu thiết kế thẻ** sửa được — AI điền nội dung theo đúng định dạng đó.
- **Mức độ chi tiết**: *bản lược* (ngắn, nhẹ, dùng được ngay) hay *chi tiết* (tối đa, giàu văn cảnh).
- Các công tắc: **gồm nội dung NSFW**, **bật Jailbreak**, **dùng toàn văn** (không lọc phân đoạn),
  **phản hồi dạng Stream**, **tự động viết tiếp khi bị cắt ngang**, **lược bỏ trường không có trong
  truyện**.
- **Cấu hình `{{user}}`** — hai kiểu, dùng cái nào cũng được:
  - *Thêm mối quan hệ với `{{user}}`*: mô tả trải nghiệm chung, thái độ. Viết càng chi tiết thẻ càng tốt.
  - *Để `{{user}}` thay thế một nhân vật trong truyện*: nhập tên nhân vật đó, app đổi hoàn toàn thành `{{user}}`.
- **Chọn nhiều nhân vật** để trích hàng loạt và gộp chung một kết quả.
- Ra kết quả rồi vẫn **sửa trực tiếp** được, hoặc gõ **yêu cầu chỉnh sửa** để AI sửa **trên bản hiện
  tại** thay vì tạo lại từ đầu. Xuất `.json` hoặc `.yaml`.

### Tạo Lorebook

Trích bối cảnh thế giới / thế lực / địa điểm / thiết lập / lịch sử thành entry cho SillyTavern:

- **Bối cảnh đại cương chung (Constant)** — đúc kết thời đại, thế giới quan, quy tắc xã hội thành
  **một** mục thường trú luôn kích hoạt. Nhờ nó mà AI luôn nắm khung thế giới chung, không phải lặp
  lại thông tin đó trên từng thẻ nhân vật.
- **Cách xử lý nhân vật phụ**: gộp thành *một mục quần tượng chung* (tiết kiệm mục từ) hoặc *mỗi
  người một mục riêng kích hoạt bằng từ khoá* (chi tiết hơn). Có **giới hạn số nhân vật phụ** — quá
  nhiều là quá tải ngữ cảnh.
- **Cấu hình `{{user}}`** trong lorebook, tương tự phần thẻ.

> Lưu ý của chính app, đáng nghe: nội dung AI trích xuất **đôi khi nhầm**, nên đối chiếu lại với
> nguyên tác trước khi dùng.

---

## 10. Những cái bẫy chung, đáng nhớ

**Lỗi im lặng đáng sợ hơn lỗi đỏ.** Phần lớn hỏng hóc trong bộ này không làm app văng ra — nó chạy
xong, báo xanh, mà kết quả sai. Vì thế:

- Xem **panel Kiểm tra** trước khi xuất thẻ.
- Báo cáo cuối của Dịch Script / Dịch Preset nói rõ cái gì được giữ nguyên và vì sao — **đọc nó**,
  đừng chỉ nhìn dấu ✅.
- Thấy **"0 entry"** sau một lượt chạy dài thì **đó là lỗi**, không phải "truyện thiếu dữ liệu".
  Nguyên nhân đã được vá (bản 163); nếu vẫn gặp thì kiểm tra **API key còn hạn không** — một khoá
  hết hạn nằm lẫn trong danh sách là đủ làm gãy giữa chừng.
- Thấy cảnh báo **script có thể vỡ cú pháp** thì mở diff kiểm tay trước khi dùng.

**Nửa đổi nửa không còn tệ hơn không đổi.** Đổi tên biến, đổi nhãn, đổi khoá dữ liệu — nếu chỉ áp
được một nửa thì chỗ ghi và chỗ đọc trỏ vào hai ô khác nhau: chạy không lỗi, mà dữ liệu mất hút. Vì
vậy mọi việc đổi tên trong bộ này đều làm **tất định, đồng loạt**, qua từ điển hoặc qua bảng remap —
không bao giờ để AI tự đổi từng chỗ.

**Từ điển là nơi bạn nắm quyền.** Ở cả Dịch Card, Dịch Script và Dịch Preset, bảng từ điển quyết định
tên gọi cuối cùng. Duyệt nó **trước** khi chạy tiết kiệm rất nhiều thời gian sửa sau.

**Tiến trình luôn được lưu.** Mọi app chạy dài đều có tạm dừng / tiếp tục và tự lưu ra file. Đóng tab
giữa chừng không mất việc đã làm.

**`[initvar]` phải tắt** trong thẻ MVU xuất ra. Bật là mỗi lượt chat khởi tạo lại biến, đè sạch dữ
liệu người chơi.

---

## 11. Khi gặp lỗi

1. Chụp màn hình + **gửi kèm file bị lỗi và file gốc**. Không có file gốc thì gần như không sửa được.
2. Ghi rõ từng bước đã bấm, hoặc dán đúng prompt đã nhập — **có tái hiện được thì mới sửa được**.
3. Nói rõ **app nào** và **phiên bản nào** (số bản ở đầu app Giới thiệu).
4. Gửi vào kênh Discord. Nút **Báo lỗi** ở góc trên bên phải mở thẳng kênh đó.

---

## 12. Tài liệu này tự cập nhật thế nào

Nói thẳng: không có cách nào để máy **tự viết** hướng dẫn cho tử tế — máy không biết tính năng dùng
ra sao, và để AI bịa vào tài liệu chính thức thì còn hại hơn thiếu. Thứ làm được và có ích thật là
**tự động phát hiện thiếu**:

- Mỗi app trong thanh điều hướng **phải** có một mục trong tài liệu này. Thêm app mới mà quên viết →
  **test đỏ ngay lúc build**, người thêm biết liền.
- Mỗi tính năng lớn phải để lại dấu vết trong tài liệu này, canh bằng danh sách từ khoá trong cùng
  test đó.
- Tài liệu chỉ dùng tối đa **3 cấp tiêu đề** (`#`, `##`, `###`) vì bộ render của tab Hướng dẫn chỉ
  hiểu tới đó — viết `####` sẽ hiện ra nguyên chữ `####`. Test cũng canh luôn việc này.
- Mục **"Có gì mới"** ở cuối tab Hướng dẫn thì hoàn toàn tự động: nó dựng thẳng từ danh sách commit
  thật của repo, nên không bao giờ lệch với bản đang chạy.

Vậy nên tài liệu này mục ruỗng dần là chuyện *không thể xảy ra âm thầm* — nó sẽ làm build đỏ trước.
