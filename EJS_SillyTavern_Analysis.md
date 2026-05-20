# Phân Tích Chuyên Sâu: EJS trong Character Card "Mùa Thu Tĩnh Lặng"

Sau khi bạn yêu cầu tìm hiểu sâu hơn, tôi đã tiến hành quét toàn bộ cấu trúc ngầm của file JSON khổng lồ này (dung lượng ~3.4MB) và phát hiện ra **sự thật vô cùng thú vị**: Bạn hoàn toàn chính xác! File này **thực sự sử dụng EJS (ST-Prompt-Template)** một cách cực kỳ tinh vi ở tầng sâu nhất: **Hệ thống World Info (Lorebook - character_book)**.

Dưới đây là báo cáo chuyên sâu về cách hệ thống EJS vận hành trong Card của bạn.

---

## 1. EJS được giấu ở đâu trong file này?
Trong cấu trúc của SillyTavern, file JSON không chỉ chứa thông tin cơ bản của nhân vật mà còn nhúng cả một quyển "Lorebook" (World Info) khổng lồ tại đường dẫn `data.character_book`. 

Khi quét nội dung của hàng trăm Entry trong Lorebook này, tôi đã tìm thấy rất nhiều đoạn mã JavaScript sử dụng cú pháp EJS (`<%_ ... _%>` và `<%- ... %>`).

## 2. Cách EJS được sử dụng để làm "Game Engine"

Khác với Regex chỉ dùng để hiển thị giao diện bên ngoài, **EJS ở đây đóng vai trò là "Bộ não" quản lý logic ngầm** của thế giới. Tác giả đã dùng EJS để lập trình các kịch bản động dựa trên biến số (`variables`).

### 2.1. Quản lý Giai đoạn Thế giới (World Phase)
EJS tự động đọc biến `Giai đoạn thế giới` (ví dụ: Thời kỳ trật tự, Thời kỳ bùng phát) để nạp các quy tắc sinh tồn tương ứng vào Prompt của AI.

```ejs
<%_ if (typeof _phase === 'undefined') var _phase = getvar('stat_data.Giai đoạn thế giới', { defaults: undefined }); _%>
<%_ if (_phase === 'Thời kỳ trật tự') { _%>
<%- await getwi(null, 'Trước đại bùng phát/Đêm trước đại bùng phát') %>
<%- await getwi(null, 'Trước đại bùng phát/Quy tắc-Đối phó với sự kiện bất thường') %>
<%- await getwi(null, 'Trước đại bùng phát/Quy tắc-Thu thập vật tư') %>
<%_ } _%>
```
**Ý nghĩa:** Tùy thuộc vào việc đại dịch đã bùng phát hay chưa, AI sẽ tự động biết được các luật lệ mới của thế giới mà không cần bạn phải viết tay vào Prompt. Nó dùng lệnh `await getwi()` để kéo các mục Lorebook khác vào một cách linh hoạt.

### 2.2. Xử lý logic NPC và Quốc Tịch
Card này hỗ trợ người chơi ở các quốc gia khác nhau. Tác giả dùng EJS để kiểm tra xem người chơi đang ở đâu, từ đó tự động nạp danh sách NPC phù hợp với quốc gia đó.

```ejs
<%_ var _nat = getvar('stat_data.Trạng thái phái sinh.nationality', { defaults: undefined }); _%>
<%_ if (_nat === 'Trung Quốc') { _%>
<%- await getwi(null, 'Tóm tắt NPC đã định nghĩa của trung quốc') %>
<%_ } else if (_nat === 'Mỹ') { _%>
<%- await getwi(null, 'Tóm tắt NPC đã định nghĩa của mỹ') %>
<%_ } ... _%>
```

### 2.3. Điều khiển Trạng thái Sinh lý phức tạp (Mang thai, Chu kỳ)
Một phát hiện rất đặc biệt tại Entry 242 của Lorebook: Tác giả lập trình một **Bộ điều khiển động thai sản và sinh lý** hoàn toàn bằng EJS!

```ejs
<%_
var _needBaseCycle = true;
var _isPregnant = false;
var _isLatePregnancy = false; // Thai kỳ cuối
var _isLabor = false; // Đang sinh nở
var _isPostpartum = false; // Phục hồi sau sinh

var _allPhys = [];
_allPhys.push(getvar('stat_data.Trạng thái phái sinh.physical_status', { defaults: '' }));
// Mã tiếp tục xử lý mảng này để điều chỉnh kịch bản...
_%>
```
**Ý nghĩa:** Nó biến SillyTavern từ một công cụ chat text đơn thuần thành một cỗ máy có khả năng theo dõi sát sao tình trạng cơ thể, chu kỳ sinh lý và thai kỳ của nhân vật. Tùy vào biến `physical_status`, AI sẽ nhận được hướng dẫn để viết diễn biến phù hợp (ví dụ: nhân vật đang ở giai đoạn "đang sinh nở" sẽ có những phản ứng khác biệt).

### 2.4. Điều hướng Mô hình Hành vi của Zombie và Người sống sót
Dựa vào cài đặt của người chơi, EJS sẽ quyết định xem Zombie sẽ cư xử thế nào (ví dụ: `Loại điên loạn`) và NPC sẽ cư xử ra sao (`Loại bình thường`).
```ejs
<%_ if (_mo_hinh_hanh_vi_nguoi_nhiem === 'Loại điên loạn') { _%>
<%- await getwi(null, 'Thế giới quan-Tổng quan hành vi người nhiễm COVID-30') %>
<%_ } _%>
```

---

## 3. Kết luận Toàn cảnh

Thẻ nhân vật **"Mùa Thu Tĩnh Lặng 1.6 MOD"** là một kiệt tác về mặt kỹ thuật trong cộng đồng SillyTavern. Tác giả đã kết hợp hai công cụ mạnh nhất:

1. **EJS (ST-Prompt-Template) ở Tầng Đáy (Backend):** 
   - Hoạt động ẩn bên trong hệ thống World Info.
   - Liên tục đọc các biến số (`getvar`) như Máu, Vị trí, Quốc tịch, Tình trạng cơ thể, Giai đoạn dịch bệnh.
   - Tự động lắp ráp và đẩy các "Quy tắc cốt truyện" (`getwi`) tương ứng vào não của AI (Prompt), ép AI phải tuân thủ nghiêm ngặt logic của một thế giới mở (Sandbox RPG).

2. **Regex Scripts ở Tầng Mặt (Frontend):**
   - Đọc kết quả văn bản mà AI trả ra (có chứa các thẻ `<data_block>`).
   - Dùng HTML, CSS, JavaScript để render (vẽ) ra một bảng Terminal cực đẹp trên trình duyệt người dùng để hiển thị thanh HP, bản đồ, kho đồ...

Việc áp dụng mã EJS vào World Info theo cách này đòi hỏi tư duy lập trình hệ thống cực tốt, biến card này vượt xa một nhân vật trò chuyện thông thường để trở thành một hệ thống quản lý Game độc lập.
