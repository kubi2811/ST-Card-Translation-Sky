# Phân Tích Chuyên Sâu: Extension ST-Prompt-template (EJS SillyTavern)

Sau khi đọc và tìm hiểu kỹ tài liệu kỹ thuật cũng như mã nguồn của extension **ST-Prompt-template** (do tác giả **zonde306** phát triển), tôi đã tổng hợp toàn bộ cơ chế, cú pháp, API hệ thống và các tính năng nâng cao của thư viện này. Đây chính là "xương sống" vận hành các thẻ game RPG lớn trong SillyTavern.

---

## 1. Vòng Đời Xử Lý (Lifecycle) & Cơ Chế Hoạt Động

Extension hoạt động bằng cách can thiệp vào hai thời điểm quan trọng trong SillyTavern:

1. **Trước khi gửi Prompt đến LLM (Prompt Generation Phase):**
   - SillyTavern tổng hợp toàn bộ Context (System Prompt, Lorebooks kích hoạt, Character Bio, Lịch sử chat).
   - Extension quét toàn bộ Prompt, tìm kiếm các khối `<% ... %>` và thực thi mã JavaScript qua bộ biên dịch **EJS**.
   - Thay thế toàn bộ mã EJS bằng kết quả chuỗi đầu ra (hoặc chuỗi rỗng nếu chỉ xử lý logic ngầm), sau đó mới gửi Prompt "sạch" đến LLM.

2. **Khi hiển thị tin nhắn của LLM lên giao diện (Render Phase):**
   - Sau khi LLM hoàn thành việc phản hồi, extension quét văn bản tin nhắn.
   - Nếu trong tin nhắn của LLM có chứa mã EJS (do LLM sinh ra hoặc do định dạng thẻ trước đó), extension tiếp tục biên dịch EJS đó trên giao diện người dùng.
   - *Lưu ý:* Việc chạy EJS trên giao diện cho phép thay đổi giao diện HTML động, hoặc thực thi lệnh `/setvar` ngay khi AI trả tin nhắn (ví dụ: trừ máu trực tiếp khi AI viết câu tấn công).

---

## 2. API Tham Chiếu Chi Tiết (API Reference)

Đây là các hàm và biến tích hợp sẵn trong môi trường Sandbox của ST-Prompt-template:

### 2.1. Quản lý Biến số (Variables)

Hệ thống biến số được triển khai trên nền thư viện **Lodash** (`_.get` và `_.set`), hỗ trợ đọc/ghi lồng nhau dạng đường dẫn (ví dụ: `a.b.c`).

*   **`getvar(key, options = {})`**: Đọc giá trị biến.
    *   `key`: Tên biến cần đọc. Nếu truyền `null` sẽ lấy toàn bộ cây biến.
    *   `options`:
        *   `scope`: Phạm vi biến:
            *   `'global'`: Toàn cục (áp dụng cho mọi chat).
            *   `'local'`: Riêng biệt cho cuộc trò chuyện hiện tại.
            *   `'message'`: Gắn liền với tin nhắn cụ thể.
            *   `'cache'`: Đọc nhanh từ bộ nhớ đệm (Mặc định).
        *   `defaults`: Giá trị trả về mặc định nếu biến chưa tồn tại.
        *   `clone`: Nếu là `true`, trả về một bản sao sâu (deep clone) để tránh làm thay đổi đối tượng gốc.
    *   *Các hàm viết tắt tương đương:* `getLocalVar()`, `getGlobalVar()`, `getMessageVar()`.

*   **`setvar(key, value, options = {})`**: Ghi giá trị biến.
    *   `options`:
        *   `scope`: Phạm vi lưu trữ (`global`, `local`, `message`).
        *   `flags`: Điều kiện ghi:
            *   `'nx'`: Chỉ ghi nếu biến **chưa tồn tại**.
            *   `'xx'`: Chỉ ghi nếu biến **đã tồn tại**.
            *   `'n'`: Ghi đè bắt buộc (Mặc định).
        *   `merge`: Nếu `true`, sử dụng `_.merge` để gộp đối tượng cũ và mới thay vì ghi đè hoàn toàn.
    *   *Các hàm viết tắt tương đương:* `setLocalVar()`, `setGlobalVar()`, `setMessageVar()`.

*   **`incvar(key, value = 1, options = {})`** & **`decvar(key, value = 1, options = {})`**: Tăng / Giảm giá trị biến.
    *   Hỗ trợ giới hạn chặn trên/chặn dưới qua `options.max` và `options.min`.
    *   *Các hàm viết tắt tương đương:* `incLocalVar()`, `decLocalVar()`, v.v.

---

### 2.2. Tương tác với SillyTavern (System Functions)

*   **`execute(cmd)`**: Thực thi bất kỳ lệnh chéo (Slash Command) nào của SillyTavern.
    *   *Ví dụ:* `await execute('/sys Bạn vừa nhận một sát thương!')` hoặc `await execute('/bubble "Nhiệm vụ mới!"')`.
*   **`getwi(lorebook, title, data = {})`** (hoặc `getWorldInfo`): Nạp động nội dung của một Entry trong Lorebook.
    *   `lorebook`: Tên cuốn Lorebook (nếu để trống/null sẽ mặc định dùng Lorebook chính của thẻ).
    *   `title`: ID của entry hoặc Tên (comment) của entry.
    *   *Ví dụ:* `<%- await getwi(null, 'Quy tắc chiến đấu') %>`.
*   **`getchar(name, template, data = {})`** (hoặc `getChara`): Đọc và kết xuất định dạng mô tả của nhân vật.
*   **`getpreset(name, data = {})`** (hoặc `getPresetPrompt`): Lấy nội dung của Prompt Preset có sẵn.
*   **`define(name, value, merge = false)`**: Định nghĩa một hàm helper hoặc biến toàn cục dùng chung ngay trong EJS để gọi lại ở các entries khác.
    *   *Lưu ý:* Khi định nghĩa hàm, cần dùng `this` để truy xuất biến, ví dụ: `this.getvar('hp')`.

---

### 2.3. Trình Đọc Dữ Liệu Gốc (Raw Data Getters)

Các hàm này trả về dữ liệu thô (raw JSON) trước khi được render:
*   `getCharData(name)`: Trả về đối tượng dữ liệu thẻ nhân vật dạng JSON.
*   `getWorldInfoData(name)`: Lấy toàn bộ danh sách các Entries thô trong Lorebook dưới dạng mảng JSON.
*   `getWorldInfoActivatedData(name, keyword, condition)`: Lấy danh sách các Entries được kích hoạt bởi từ khóa cụ thể.

---

## 3. Cơ Chế Bơm Nội Dung Vào Tiêu Đề (Content Injection Tags)

Để điều khiển vị trí chèn nội dung của Lorebook Entry vào Prompt (mặc định SillyTavern sẽ dồn tất cả các entries đã kích hoạt thành một khối System Prompt lớn ở đầu), bạn có thể đặt tiền tố đặc biệt vào **Tiêu đề (Comment)** của Entry đó:

1.  **`[GENERATE:BEFORE]`**: Bơm nội dung của Entry này vào **đầu** của toàn bộ Prompt gửi đi.
2.  **`[GENERATE:AFTER]`**: Bơm nội dung vào **cuối** của Prompt gửi đi (Nằm sát dưới tin nhắn chat gần nhất).
3.  **`[RENDER:BEFORE]`** / **`[RENDER:AFTER]`**: Chỉ chèn nội dung khi hiển thị tin nhắn lên giao diện UI của trình duyệt, hoàn toàn không gửi đến LLM.
4.  **`[GENERATE:{idx}:BEFORE]`** / **`[GENERATE:{idx}:AFTER]`**: Chèn vào vị trí tin nhắn thứ `{idx}` trong lịch sử chat gửi đi (Bắt đầu từ `0`).
    *   *Ví dụ:* `[GENERATE:1:BEFORE]` sẽ chèn văn bản này vào ngay trước tin nhắn thứ 2 của cuộc trò chuyện.
5.  **`[InitialVariables]`**: Dành cho các entry chứa cấu trúc JSON. Hệ thống sẽ parse và nạp nó làm biến khởi tạo mặc định cho Chat session.

### 3.1. Bơm Theo Regex Tin Nhắn (`[GENERATE:REGEX:pattern]`)
*   If tiêu đề entry có dạng `[GENERATE:REGEX:chết|bị thương]`, entry này sẽ tự động được kích hoạt khi chat xuất hiện từ khóa "chết" hoặc "bị thương".
*   Khi kích hoạt qua Regex, EJS cung cấp sẵn các biến ngữ cảnh:
    *   `matched_message`: Nội dung tin nhắn khớp regex.
    *   `matched_message_index`: Vị trí tin nhắn khớp.
    *   `matched_message_role`: Vai trò người gửi (user/assistant).

---

## 4. Hệ Thống Tiêm Prompt Nâng Cao (`@INJECT`)

Mặc định, các World Info của SillyTavern được gộp chung thành một tin nhắn System duy nhất. Điều này khiến LLM dễ bị nhầm lẫn giữa **Thông tin bối cảnh (Knowledge)** và **Mệnh lệnh chỉ thị (Instructions)**. 

Để giải quyết vấn đề này, ST-Prompt-template giới thiệu cú pháp `@INJECT`. 

### 4.1. Cách cấu hình:
1. Đặt thuộc tính của Entry đó là **`enabled: false` (Vô hiệu hóa)** trong Lorebook để tránh bị nạp đúp.
2. Đặt **Tiêu đề (Comment)** của Entry theo cú pháp `@INJECT [các tham số]`.
3. Khi điều kiện kích hoạt được thỏa mãn, extension sẽ tạo một tin nhắn **độc lập** (User, Assistant, hoặc System) và tiêm vào vị trí được chỉ định thay vì gộp chung vào khối System lớn.

### 4.2. Các chế độ Tiêm:

*   **Chế độ 1: Tiêm theo vị trí tuyệt đối (`pos`)**
    *   Cú pháp: `@INJECT pos=vị_trí,role=vai_trò`
    *   *Ví dụ:* `@INJECT pos=-1,role=user` -> Tạo một tin nhắn User độc lập chèn vào **cuối cùng** của lịch sử chat.
    *   *Ví dụ:* `@INJECT pos=1,role=system` -> Chèn một tin nhắn System riêng biệt vào sau tin nhắn đầu tiên.

*   **Chế độ 2: Tiêm tương đối theo tin nhắn đích (`target`)**
    *   Cú pháp: `@INJECT target=vai_trò_đích,index=thứ_tự,at=before|after,role=vai_trò_chèn`
    *   *Ví dụ:* `@INJECT target=user,index=1,at=before,role=system` -> Chèn một tin nhắn System ngay trước tin nhắn đầu tiên của User.
    *   *Ví dụ:* `@INJECT target=assistant,index=-1,at=after,role=user` -> Chèn một tin nhắn User ngay sau tin nhắn cuối cùng của AI.

*   **Chế độ 3: Tiêm theo Regex nội dung (`regex`)**
    *   Cú pháp: `@INJECT regex='mẫu_regex',at=before|after,role=vai_trò_chèn`
    *   *Ví dụ:* `@INJECT regex='(chiến đấu|tấn công)',at=before,role=system` -> Chèn tin nhắn hướng dẫn hệ thống chiến đấu ngay trước tin nhắn có chứa từ khóa liên quan.

---

## 5. Mẹo Kỹ Thuật Khi Lập Trình Thẻ (SillyTavern Best Practices)

### 5.1. Ẩn khối mã EJS khỏi LLM bằng bộ lọc Regex
Để tránh việc các thẻ `<% ... %>` (được in trên giao diện chat cho người dùng xem) bị gửi ngược lại LLM trong lượt chat tiếp theo làm loãng Prompt, SillyTavern khuyến khích cấu hình một bộ lọc Regex (trong tab Regex của SillyTavern):
*   **Find Regex:** `/<%.*?%>/g`
*   **Replace String:** *(để trống)*
*   **Prompt Only:** `true` (Chỉ ẩn khi gửi prompt, vẫn hiển thị trên UI).

### 5.2. Định nghĩa biến khởi tạo (Global Init)
Tạo một entry với tiêu đề `[InitialVariables]` chứa JSON thô để cài đặt chỉ số ban đầu cho trò chơi:
```json
{
  "stat_data": {
    "hp_current": 100,
    "hp_max": 100,
    "gold": 500,
    "inventory": []
  }
}
```

### 5.3. Sử dụng `define` để tái sử dụng mã nguồn
Tại Entry 0 (Global Init chạy thường trực), bạn có thể khai báo các hàm toán học hay hàm xử lý chung:
```ejs
<%_
define('rollDice', function(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
});
_%>
```
Ở các entries phụ sau này, bạn chỉ cần gọi trực tiếp:
```ejs
<%_ var _result = rollDice(6); _%>
Bạn đổ xúc sắc được <%- _result %> điểm!
```
