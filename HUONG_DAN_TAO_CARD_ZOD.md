# 📖 CẨM NANG TOÀN DIỆN: TẠO CARD SILLYTAVERN VỚI ZOD + MVU

> **Tài liệu tham khảo kỹ thuật chuẩn** — Cập nhật: 2026-06-15  
> Tích hợp đầy đủ các đặc tả API, quy tắc Zod 4, tiêu chuẩn cấu hình Worldbook, Regex tối giản mới, và checklist rà soát chất lượng (QC) từ Kho Kiến Thức Viết Card.

---

## MỤC LỤC

1. [Kiến Trúc Tổng Quan](#1-kiến-trúc-tổng-quan)
2. [Cấu Trúc JSON V3 Chuẩn & Sơ Đồ Tiêm](#2-cấu-trúc-json-v3-chuẩn--sơ-đồ-tiêm)
3. [Character Info (Trường Đầu Cấp)](#3-character-info-trường-đầu-cấp)
4. [First Message & Khởi Tạo Trạng Thái](#4-first-message--khởi-tạo-trạng-thái)
5. [Quy Tắc Cấu Hình Worldbook (Lorebook) Chi Tiết](#5-quy-tắc-cấu-hình-worldbook-lorebook-chi-tiết)
6. [Bộ Điều Khiển Nội Dung Động EJS Preprocessing](#6-bộ-điều-khiển-nội-dung-động-ejs-preprocessing)
7. [MVU Entries Hệ Thống & Tiền Tố Biến Số](#7-mvu-entries-hệ-thống--tiền-tố-biến-số)
8. [TavernHelper Scripts (Logic Engine)](#8-tavernhelper-scripts-logic-engine)
9. [Quy Tắc Viết Zod Schema & Chuẩn Zod 4](#9-quy-tắc-viết-zod-schema--chuẩn-zod-4)
10. [Cấu Hình Regex Scripts Tối Giản Mới](#10-cấu-hình-regex-scripts-tối-giản-mới)
11. [Build Script Tự Động Lắp Ráp Card](#11-build-script-tự-động-lắp-ráp-card)
12. [Checklist Tự Kiểm Giao Diện Frontend](#12-checklist-tự-kiểm-giao-diện-frontend)
13. [Tiêu Chuẩn Rà Soát Văn Phong & Nhân Thiết (Writing QC)](#13-tiêu-chuẩn-rà-soát-văn-phong--nhân-thiết-writing-qc)
14. [Xử Lý Sự Cố (Troubleshooting)](#14-xử-lý-sự-cố-troubleshooting)

---

## 1. KIẾN TRÚC TỔNG QUAN

Hệ thống MVU-Zod chuyển đổi mô hình quản lý biến trong SillyTavern từ việc **phân tích cú pháp chuỗi Regex thô** sang **đầu ra có cấu trúc (Structured Output)** dựa trên:
- **Zod 4:** Lớp xác thực kiểu dữ liệu nghiêm ngặt tại runtime (Type Safety).
- **JSON Patch (RFC 6902):** Giao thức cập nhật trạng thái dạng gia số (Delta Update) thay vì ghi đè toàn bộ context.
- **Dynamic Frontend:** Giao diện HTML vẽ động dựa vào trạng thái biến thời gian thực, mount trực tiếp qua thẻ giữ chỗ.

```
                  ┌─────────────────────────────────────┐
                  │          Người dùng gửi Chat        │
                  └──────────────────┬──────────────────┘
                                     │
                        (Thay các Macro biến số)
                                     ▼
                  ┌─────────────────────────────────────┐
                  │    AI đọc Prompt kèm Danh sách biến │
                  └──────────────────┬──────────────────┘
                                     │
                        (AI suy nghĩ & sinh câu trả lời)
                                     ▼
                  ┌─────────────────────────────────────┐
                  │  AI phản hồi + Khối <UpdateVariable> │
                  └──────────────────┬──────────────────┘
                                     │
            (MVU Engine bắt JSON Patch & cập nhật biến qua Zod Schema)
                                     ▼
                  ┌─────────────────────────────────────┐
                  │   Event VARIABLE_UPDATE_ENDED kích   │
                  │   hoạt Frontend render lại UI       │
                  └─────────────────────────────────────┘
```

---

## 2. CẤU TRÚC JSON V3 CHUẨN & SƠ ĐỒ TIÊM

Để card nhân vật có khả năng tương thích cao trên mọi phiên bản SillyTavern, cấu trúc JSON cần bọc trong định dạng `chara_card_v3`.

### 2.1 Cấu Trúc JSON Phân Cấp
```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    "name": "Tên nhân vật",
    "description": "Thường để trống hoặc mô tả ngắn gọn vai trò",
    "personality": "",
    "scenario": "",
    "first_mes": "Nội dung mở đầu...\n\n<StatusPlaceHolderImpl/>",
    "character_book": {
      "name": "Tên Worldbook",
      "entries": []
    },
    "extensions": {
      "regex_scripts": [],
      "tavern_helper": {
        "scripts": [],
        "variables": {}
      },
      "TavernHelper_scripts": [],
      "character_book": {
        "name": "Tên Worldbook (Dự phòng)",
        "entries": []
      }
    }
  }
}
```

### 2.2 Bảng Ánh Xạ Vị Trí Tiêm
| Thành phần | Vị trí chính xác trong JSON | Định dạng dữ liệu |
|---|---|---|
| **Worldbook** | `data.character_book` VÀ `data.extensions.character_book` | `{ name: string, entries: Entry[] }` |
| **TH Scripts** | `data.extensions.tavern_helper.scripts` VÀ `data.extensions.TavernHelper_scripts` | Mảng chứa mã nguồn Runtime và Zod Schema |
| **Regex Scripts**| `data.extensions.regex_scripts` | Mảng cấu hình các biểu thức chính quy |

---

## 3. CHARACTER INFO (TRƯỜNG ĐẦU CẤP)

Đối với card Zod + MVU nâng cao, các trường thông tin đầu cấp (`description`, `personality`, `scenario`, `system_prompt`) thường được **để trống** hoặc viết cực kỳ tối giản. Toàn bộ thiết lập thế giới quan, tính cách chi tiết được đưa vào **Lorebook (Worldbook)** ở trạng thái thường trú (constant: true).
- **Lợi ích:** AI dễ dàng tập trung sự chú ý (attention) vào dòng trạng thái và các chỉ thị cập nhật động thay vì bị phân tán bởi các khối văn bản tĩnh quá lớn ở đầu cấp.

---

## 4. FIRST MESSAGE & KHỞI TẠO TRẠNG THÁI

Tin nhắn đầu tiên (`first_mes`) và các tin nhắn thay thế (`alternate_greetings`) phải tuân thủ cấu trúc khởi tạo:
- Cuối tin nhắn bắt buộc phải chèn thẻ `<StatusPlaceHolderImpl/>`. Thẻ này đóng vai trò là "mỏ neo" để MVU runtime tìm kiếm và vẽ giao diện thanh trạng thái lên màn hình chat.
- Nếu muốn khởi tạo giá trị ban đầu tùy biến theo từng lời mở đầu khác nhau, có thể nhúng khối cập nhật gia tốc trực tiếp vào greeting:
  ```xml
  <UpdateVariable>
  [
    { "op": "replace", "path": "/Người_Chơi/Vị_Trí", "value": "Thôn nhỏ ngoại vi" }
  ]
  </UpdateVariable>
  <StatusPlaceHolderImpl/>
  ```

---

## 5. QUY TẮC CẤU HÌNH WORLDBOOK (LOREBOOK) CHI TIẾT

Cấu hình sai Worldbook là nguyên nhân hàng đầu khiến AI bị "loạn thiết lập" hoặc làm bùng nổ số lượng token sử dụng.

### 5.1 Phân Biệt Cấu Hình Theo Loại Card
- **Card đơn nhân vật (Chỉ có 1 nhân vật cốt lõi):**
  - **Quy tắc vàng:** Toàn bộ các entry mô tả nhân vật này (nền tảng, ngoại hình, tính cách, kỹ năng, NSFW) **bắt buộc phải đặt ở trạng thái Thường trú (Constant: True, đèn xanh dương)**.
  - **CẤM TUYỆT ĐỐI** chuyển các mảnh thiết lập của card đơn nhân vật thành dạng kích hoạt bằng từ khóa (Selective: True, đèn xanh lá), vì điều này sẽ làm AI bị mất một phần thiết lập khi từ khóa không xuất hiện, dẫn đến OOC (Out Of Character).
- **Card đa nhân vật (Có từ 2 nhân vật cốt lõi trở lên):**
  - **Thiết lập chung / thế giới quan:** Đèn xanh dương (thường trú).
  - **Hồ sơ chi tiết từng nhân vật:** Đèn xanh lá (kích hoạt bằng từ khóa). Từ khóa xanh lá bao gồm: Họ tên đầy đủ, tên gọi thân mật, biệt danh, cách gọi khác.

### 5.2 Cấu Hình Kích Hoạt, Vị Trí & Thứ Tự Khuyến Nghị
- **Tất cả các entry Worldbook** (bao gồm cả đèn xanh dương và xanh lá) đều phải bật đồng thời hai chế độ chặn đệ quy:
  - **Không đệ quy** (`exclude_recursion: true`)
  - **Ngăn đệ quy tiếp diễn** (`prevent_recursion: true`)
  *(Ngoại trừ Bộ điều khiển EJS Preprocessing động)*.

- **Khung phân bổ vị trí & thứ tự (Order):**
  1. **Thế giới quan & Bối cảnh vĩ mô:** Vị trí `World Info before` (Trước định nghĩa nhân vật), Kích hoạt: Xanh dương, Thứ tự: `1 ~ 3`.
  2. **Tổng quan nhân vật:** Vị trí `World Info before`, Kích hoạt: Xanh dương, Thứ tự: `4`.
  3. **Chi tiết cảnh & Sự kiện:** Vị trí `World Info after` (Sau định nghĩa nhân vật), Kích hoạt: Xanh lá, Thứ tự: `50 ~ 98`.
  4. **Hồ sơ chi tiết nhân vật cốt lõi:** Vị trí `World Info after`, Kích hoạt: Xanh dương (nếu card đơn) hoặc Xanh lá (nếu card đa), Thứ tự: `99`.
  5. **NPC phụ:** Vị trí `World Info after`, Kích hoạt: Xanh lá, Thứ tự: `100`.
  6. **Bộ điều khiển EJS Preprocessing:** Vị trí `World Info after`, Kích hoạt: Xanh dương, Thứ tự: `100`, **Tắt ngăn đệ quy**.
  7. **Tái diễn giải (Prompt Steering):** Vị trí `at_depth` với `depth: 0`, `role: system`, Kích hoạt: Xanh lá (từ khóa là tên nhân vật), Thứ tự: `1` hoặc `2`. Dùng để điều chỉnh hành vi AI cực mạnh ở cuối context.

### 5.3 Bảng Ánh Xạ Tham Số Khi Cấu Hình Qua API (`LorebookToolCall`)
Khi sử dụng mã nguồn hoặc tool để chỉnh sửa thuộc tính của entry, hãy ánh xạ theo bảng sau:
```javascript
// Thường trú (Đèn xanh dương)
strategy: { type: "constant" }

// Kích hoạt từ khóa (Đèn xanh lá)
strategy: { type: "selective", keys: ["Tiểu_Vũ", "Lâm_Tiểu_Vũ"] }

// Vị trí trước định nghĩa
position: { type: "before_character_definition", order: 4 }

// Vị trí sau định nghĩa
position: { type: "after_character_definition", order: 99 }

// Vị trí D0 (Bánh răng D độ sâu 0)
position: { type: "at_depth", depth: 0, role: "system", order: 1 }

// Cấu hình đệ quy an toàn
recursion: { prevent_incoming: true, prevent_outgoing: true }

// Vô hiệu hoá entry (dành cho [initvar] hoặc các entry nạp động qua EJS)
enabled: false
```

---

## 6. BỘ ĐIỀU KHIỂN NỘI DUNG ĐỘNG EJS PREPROCESSING

EJS Preprocessing (`@@preprocessing`) kết hợp với `getwi` là kỹ thuật tối thượng để nạp động các thiết lập cảnh, vật phẩm hoặc nhân vật phụ dựa vào trạng thái biến MVU thực tế. Các entry được nạp động nên để ở trạng thái **disabled (`enabled: false`)** trong worldbook để tránh bị nạp chồng chéo ngoài ý muốn.

### 6.1 Cấu Trúc Script Mẫu
Đặt khối code sau vào nội dung (`content`) của entry bộ điều khiển EJS:
```ejs
@@preprocessing
<%
/* 1. Đọc các biến trạng thái MVU */
const currentLoc = getvar('stat_data.Người_Chơi.Vị_Trí', { defaults: 'Tân Thủ Thôn' });
const presentNPCs = getvar('stat_data.NPC_Có_Mặt', { defaults: {} });
const userMsg = getChatMessages(-1, -1, 'user');
const userText = userMsg.length > 0 ? userMsg[userMsg.length - 1].message : '';

/* Bỏ qua lượt 0 (lời mở đầu) */
if (!isFloorZero) {
%>

/* 2. Nạp bản đồ/bối cảnh dựa theo vị trí hiện tại */
<% if (currentLoc.includes('Hào Châu')) { %>
<%- await getwi('Bối_Cảnh_Hào_Châu') %>
<% } else if (currentLoc.includes('Tân Thủ Thôn')) { %>
<%- await getwi('Bối_Cảnh_Tân_Thủ_Thôn') %>
<% } %>

/* 3. Nạp hồ sơ NPC đang có mặt hoặc được nhắc tới */
<%
const detectedNPCs = new Set();
// Duyệt qua biến danh sách NPC có mặt
if (presentNPCs && typeof presentNPCs === 'object') {
  Object.keys(presentNPCs).forEach(name => detectedNPCs.add(name));
}
// Quét văn bản chat gần nhất để tự động phát hiện NPC khác
if (userText.includes('Trưởng thôn')) detectedNPCs.add('NPC_Trưởng_Thôn');
if (userText.includes('Tiểu Nhị')) detectedNPCs.add('NPC_Tiểu_Nhị');
%>

<% for (const npcName of detectedNPCs) { %>
<%- await getwi(npcName) %>
<% } %>

<% } %>
```
- **Cấu hình entry EJS này:** Đèn xanh dương (constant), Thứ tự: `100`, Vị trí: `after_char`, **Không bật chặn đệ quy** (để EJS có thể tự do gọi hàm nạp từ các entry khác).

---

## 7. MVU ENTRIES HỆ THỐNG & TIỀN TỐ BIẾN SỐ

Hệ thống MVU-Zod yêu cầu 4 entry hệ thống bắt buộc trong Worldbook:

### 7.1 Entry: `[initvar]Khởi tạo biến`
- **Keys:** `[initvar]`
- **Enabled:** `false` (Bắt buộc tắt)
- **Position:** `before_char`, Order: `10`
- **Content:** Chứa mã khởi tạo định dạng **YAML** khớp cấu trúc Zod Schema.

### 7.2 Entry: `Danh sách biến`
- **Keys:** `Danh sách biến` (Không thêm tiền tố `[mvu_update]`)
- **Enabled:** `true`
- **Position:** `before_char` (hoặc `after_char`), Order: `200`

#### Cách 1: Thiết lập cơ bản (Dành cho card nhỏ/trung bình)
- **Content:**
  ```yaml
  ---
  <status_current_variables>
  {{format_message_variable::stat_data}}
  </status_current_variables>
  ```

#### Cách 2: Thiết lập nâng cao - Lọc biến số bằng EJS (Dành cho card lớn/RPG phức tạp)
Khi card có cấu trúc biến rất lớn (chứa hàng chục NPC, nhiều loại trang bị, tiền tệ theo thời kỳ), việc gửi toàn bộ biến cho AI đọc ở mỗi lượt chat sẽ gây lãng phí token và làm loãng ngữ cảnh. 
Chúng ta có thể thay thế nội dung tĩnh trên bằng một khối **EJS Script** để tự động lọc và chỉ in ra các biến số thực sự cần thiết theo ngữ cảnh hiện tại (như cách card Đấu La Đại Lục 3.1 của Hoxilo triển khai):
- **Content:**
  ```ejs
  <%_
  (function() {
    var statData = getvar('stat_data');
    if (!statData) {
      print('{}');
      return;
    }

    var output = {};
    var sType = _.get(statData, 'Người_Chơi.Trạng_Thái_Tu_Luyện.Loại_Cảnh_Hiện_Tại', 'Hàng ngày');
    var isCombat = (sType === 'Chiến đấu' || sType === 'Thi đấu' || sType === 'Săn bắt');

    /* ─── 1. Thông tin thế giới ─── */
    if (statData['Thiên_Hạ']) {
      output['Thiên_Hạ'] = statData['Thiên_Hạ'];
    }

    /* ─── 2. Người chơi (Lọc theo cảnh) ─── */
    if (statData['Người_Chơi']) {
      var player = statData['Người_Chơi'];
      var pOut = {};
      
      // Luôn xuất ra thông tin cơ bản
      pOut['Tên'] = player['Tên'];
      pOut['Tuổi'] = player['Tuổi'];
      
      // Chỉ xuất chỉ số HP và chiến đấu khi vào cảnh chiến đấu
      if (isCombat) {
        pOut['HP'] = player['HP'];
        pOut['Max_HP'] = player['Max_HP'];
      }
      
      // Chỉ xuất túi đồ nếu túi đồ không trống
      if (player['Túi_Đồ'] && Object.keys(player['Túi_Đồ']).length > 0) {
        pOut['Túi_Đồ'] = player['Túi_Đồ'];
      }
      output['Người_Chơi'] = pOut;
    }

    /* ─── 3. NPC có mặt (Chỉ xuất các NPC có thuộc tính Có_Mặt: true) ─── */
    if (statData['Danh_Sách_NPC']) {
      var npcOut = {};
      for (var npcName in statData['Danh_Sách_NPC']) {
        var npc = statData['Danh_Sách_NPC'][npcName];
        if (npc && _.get(npc, 'Thông_Tin_Cơ_Bản.Có_Mặt_Hay_Không') === true) {
          npcOut[npcName] = {
            'Thân_Phận': _.get(npc, 'Thông_Tin_Cơ_Bản.Thân_Phận'),
            'Hành_Động_Hiện_Tại': _.get(npc, 'Thông_Tin_Cơ_Bản.Hành_Động_Hiện_Tại'),
            'Thái_Độ': _.get(npc, 'Mối_Quan_Hệ.Thái_Độ_Với_Người_Chơi')
          };
        }
      }
      if (Object.keys(npcOut).length > 0) {
        output['NPC_Có_Mặt'] = npcOut;
      }
    }

    print(JSON.stringify(output, null, 2));
  })();
  _%>
  ```


### 7.3 Entry: `[mvu_update]Quy tắc cập nhật biến`
- **Keys:** `[mvu_update]`, `quy_tắc_cập_nhật`
- **Enabled:** `true`
- **Position:** `before_char`, Order: `200`
- **Content:** Chỉ định rõ cho AI kiểu dữ liệu và điều kiện kích hoạt thay đổi của từng trường.

### 7.4 Entry: `[mvu_update]Định dạng xuất biến`
- **Keys:** `[mvu_update]`, `định_dạng_xuất`
- **Enabled:** `true`
- **Position:** `after_char` (Gemini: depth `0`, Claude: depth `4`), Order: `200`
- **Content:** Hướng dẫn AI xuất JSON Patch. Bắt buộc hỗ trợ đầy đủ **5 toán tử** sau:
  ```yaml
  ---
  định_dạng_xuất_biến:
    rule:
      - you must output the update analysis and the actual update commands at once in the end of the next reply
      - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects:
        - replace: replace the value of existing paths (absolute set)
        - delta: update the value of existing number paths by a positive/negative delta value (numerical incremental adjust)
        - insert: insert new items into an object or array (using `-` as array index intends appending to the end)
        - remove: remove an existing path or item
        - move: move a variable value from one path to another
      - don't update field names starts with `_` as they are readonly, such as `_biến`
    format: |-
      <UpdateVariable>
      <Analysis>$(IN ENGLISH, no more than 80 words)
      - ${calculate time passed: ...}
      - ${decide whether dramatic updates are allowed: yes/no}
      - ${analyze every variable based on its corresponding check: ...}
      </Analysis>
      <JSONPatch>
      [
        { "op": "replace", "path": "/Người_Chơi/Vị_Trí", "value": "Hào Châu" },
        { "op": "delta", "path": "/Người_Chơi/HP", "value": -15 },
        { "op": "insert", "path": "/Người_Chơi/Túi_Đồ/Bản đồ", "value": { "Mô_Tả": "Bản đồ da dê cũ", "Số_Lượng": 1 } },
        { "op": "remove", "path": "/Người_Chơi/Túi_Đồ/Lương khô" },
        { "op": "move", "from": "/Người_Chơi/Tài_Sản", "to": "/NPC_Trưởng_Thôn/Hối_Lộ" }
      ]
      </JSONPatch>
      </UpdateVariable>
  ```
  > ⚠️ **Đường dẫn trong JSON Patch:** Sử dụng dấu gạch chéo `/` phân đoạn và **KHÔNG** chứa tiền tố `stat_data` (ví dụ: `/Người_Chơi/HP` thay vì `/stat_data/Người_Chơi/HP`).

### 7.5 Quy Tắc Tiền Tố Biến Số (Đọc-Ghi của AI)
Bằng cách đặt tên khóa trong Zod Schema, bạn quyết định quyền hạn tương tác của AI:
1. **Không có tiền tố (Ví dụ: `độ_hảo_cảm`):** AI có quyền đọc và xuất lệnh JSON Patch để sửa đổi.
2. **Tiền tố `_` (Ví dụ: `_id_tầng`, `_phiên_bản`):** AI được phép đọc để lấy thông tin nhưng **CẤM** xuất lệnh sửa đổi (Read-only).
3. **Tiền tố `$` (Ví dụ: `$dữ_liệu_hậu_trường`):** Ẩn hoàn toàn khỏi prompt gửi lên AI. Chỉ có scripts frontend hoặc hệ thống mới đọc ghi được (Private).

---

## 8. TAVERNHELPER SCRIPTS (LOGIC ENGINE)

TavernHelper chạy 2 script cốt lõi độc lập tại runtime:

### 8.1 Script 1: `MVU` (Runtime Engine)
Script này tải thư viện xử lý MVU từ CDN toàn cục.
- **Tên script:** `MVU`
- **Mã nguồn:**
  ```javascript
  import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'
  ```

### 8.2 Script 2: `MVU Zod Schema` (Lược đồ dữ liệu)
Chứa định nghĩa cấu trúc dữ liệu và đăng ký với MVU engine.
- **Tên script:** `MVU Zod Schema`
- **Mã nguồn:** Định nghĩa theo chuẩn Zod 4 (Xem chi tiết ở Mục 9).

---

## 9. QUY TẮC VIẾT ZOD SCHEMA & CHUẨN ZOD 4

Zod 4 kiểm soát chặt chẽ kiểu dữ liệu đầu vào. Hãy tuân thủ các quy tắc sau để tránh crash game:

### 9.1 Các Chỉ Thị Thiết Kế Bắt Buộc
1. **Bắt buộc dùng `z.coerce.number()` / `z.coerce.boolean()` / `z.coerce.string()`:** AI thường trả về số dưới dạng chuỗi (ví dụ `"45"`). Việc dùng `z.coerce` đảm bảo tự động ép kiểu dữ liệu an toàn mà không gây crash validation.
2. **Luôn sử dụng `.prefault(value)` thay cho `.default(value)`:** Đây là điểm đặc thù của MVU-Zod. Mọi trường, kể cả các đối tượng lồng nhau (`z.object({...}).prefault({})`) hay bản ghi (`z.record().prefault({})`), đều phải có `.prefault` để đảm bảo luôn tồn tại một cấu trúc dữ liệu cơ sở mặc định, tránh lỗi đọc thuộc tính từ `undefined`.
3. **Giới hạn biên độ số bằng `.transform()`:** Thay vì dùng `.min(0).max(100)` (gây văng lỗi nghiêm trọng nếu AI xuất số vượt quá giới hạn), hãy dùng lodash transform để ép biên một cách êm ái:
   `z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(100)`
4. **Ưu tiên sử dụng `z.record()` cho danh sách động:**
   - **Sai:** Dùng `z.array(z.object({...}))` cho túi đồ (AI rất khó cập nhật chính xác chỉ số phần tử thông qua JSON Patch `/túi_đồ/0/số_lượng`).
   - **Đúng:** Dùng `z.record(z.string().describe("tên_vật_phẩm"), z.object({...}))`. Khi đó AI có thể dễ dàng cập nhật trực tiếp qua path `/túi_đồ/Băng_dán/số_lượng`.
5. **CẤM sử dụng các hàm kiểm tra nghiêm ngặt `.strict()` hoặc `.passthrough()`:** Các phương thức này sẽ chặn đứng luồng xử lý động của MVU.
6. **Không import thêm thư viện `zod` hoặc `lodash`:** Các đối tượng `z` và `_` đã được MVU runtime chèn sẵn vào môi trường toàn cục. Việc khai báo import lại các thư viện này sẽ gây lỗi trùng lặp.

### 9.2 Ví Dụ Zod Schema Chuẩn Mẫu
```javascript
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  // ==================== TRẠNG THÁI CHUNG ====================
  Thiên_Hạ: z.object({
    Thời_Gian: z.object({
      Giờ: z.string().prefault("Giờ Thìn (7h-9h)"),
      Ngày: z.string().prefault("Mùng một"),
      Năm: z.string().prefault("Chí Chính năm thứ mười một (1351)"),
    }).prefault({}),
    Thời_Tiết: z.string().prefault("Nóng bức oi ả"),
    _phiên_bản: z.coerce.number().prefault(1.0), // AI chỉ đọc, không được sửa
  }).prefault({}),

  // ==================== THÔNG TIN NGƯỜI CHƠI ====================
  Người_Chơi: z.object({
    Tên: z.string().prefault("Chờ cập nhật"),
    HP: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(100),
    Max_HP: z.coerce.number().transform(v => _.clamp(v, 1, 150)).prefault(100),
    Túi_Đồ: z.record(
      z.string().describe("Tên vật phẩm"),
      z.object({
        Mô_Tả: z.string().prefault("Không rõ công dụng"),
        Số_Lượng: z.coerce.number().prefault(1),
      }).prefault({})
    ).transform(data => _.pickBy(data, ({Số_Lượng}) => Số_Lượng > 0)).prefault({}), // Tự xóa vật phẩm khi số lượng về 0
  }).prefault({}),
}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});
```

---

## 10. CẤU HÌNH REGEX SCRIPTS TỐI GIẢN MỚI

> ⚠️ **QUY CHUẨN THAY THẾ MỚI:** Trong thiết kế hiện tại, chúng ta **KHÔNG NHÚNG** mã nguồn HTML dashboard hay HTML Form khởi tạo khổng lồ vào trong mục `replaceString` của Regex nữa. Việc này được xử lý hoàn toàn tự động ở phía MVU runtime.

Bạn chỉ cần thiết lập **4 Regex lõi** sau trong `regex_scripts`:

### 1. Ẩn thanh trạng thái khởi tạo
- **findRegex:** `[\r\n]*<StatusPlaceHolderImpl\/>`
- **replaceString:** `<style>.StatusPlaceHolderImpl { display: none; }</style><div class="StatusPlaceHolderImpl"><StatusPlaceHolderImpl/></div>`
- **Cấu hình:** `PromptOnly: False | MarkdownOnly: False | RunOnEdit: True | MinDepth: 0 | MaxDepth: 0 | Placement: [1]` (Bọc thẻ neo để runtime chèn dashboard dynamic).

### 2. Ẩn thẻ Update gốc khỏi Prompt gửi AI
- **findRegex:** `[\r\n]*<UpdateVariable[^>]*>.*?</UpdateVariable>`
- **replaceString:** `<span style="display:none;">$&</span>`
- **Cấu hình:** `PromptOnly: True | MarkdownOnly: False | RunOnEdit: True | MinDepth: 3 | MaxDepth: 0 | Placement: [2]` (Ngăn không cho AI đọc lại các lệnh update của các lượt trước để tránh ảo giác lặp).

### 3. Loading Cập Nhật
- **findRegex:** `<UpdateVariable>(.*?)</UpdateVariable>`
- **replaceString:** `<div class="mvu-loading" style="padding: 10px; background: #0f0f12; color: #f59e0b; border: 1px solid #d97706; border-radius: 6px; font-family: monospace;">⏳ Đang phân tích và cập nhật chỉ số trạng thái...</div>`
- **Cấu hình:** `PromptOnly: False | MarkdownOnly: True | RunOnEdit: False | Enabled: True | Placement: [2]` (Hiển thị UI chờ trong quá trình stream tin nhắn).

### 4. Hoàn Thành Cập Nhật
- **findRegex:** `<UpdateVariable>(.*?)</UpdateVariable>`
- **replaceString:** `<div class="mvu-done" style="padding: 10px; background: #0f172a; color: #10b981; border: 1px solid #059669; border-radius: 6px; font-family: monospace;">✅ Cập nhật biến số hoàn tất.</div>`
- **Cấu hình:** `PromptOnly: False | MarkdownOnly: True | RunOnEdit: False | Enabled: True | Placement: [2]` (Hiển thị thông báo sau khi AI hoàn thành phản hồi).

---

## 11. BUILD SCRIPT TỰ ĐỘNG LẮP RÁP CARD

Để tránh các lỗi cú pháp escape dấu gạch chéo ngược (`\\`) khi nhập dữ liệu thủ công vào JSON, hãy sử dụng Build Script tự động hóa bằng Node.js:

```javascript
const fs = require('fs');
const path = require('path');

const buildCard = () => {
  const schemaPath = path.join(__dirname, 'schema_zod.js');
  const templatePath = path.join(__dirname, 'template.json');
  const outputPath = path.join(__dirname, 'FINAL_CARD.json');

  if (!fs.existsSync(schemaPath) || !fs.existsSync(templatePath)) {
    console.error("Thiếu file schema_zod.js hoặc template.json!");
    return;
  }

  const zodSchemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const cardTemplate = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

  // Tiêm Zod Schema vào đúng TavernHelper Script
  const helperScripts = cardTemplate.data.extensions.TavernHelper_scripts || cardTemplate.data.extensions.tavern_helper.scripts;
  const targetScript = helperScripts.find(s => s.name === 'MVU Zod Schema');
  
  if (targetScript) {
    targetScript.content = zodSchemaContent;
  } else {
    console.warn("Không tìm thấy script 'MVU Zod Schema' để tiêm.");
  }

  fs.writeFileSync(outputPath, JSON.stringify(cardTemplate, null, 2), 'utf-8');
  console.log("🚀 Lắp ráp card hoàn tất thành công! Đầu ra tại FINAL_CARD.json");
};

buildCard();
```

---

## 12. CHECKLIST TỰ KIỂM GIAO DIỆN FRONTEND

Khi thiết kế giao diện thanh trạng thái Frontend (HTML/CSS/JS) chèn trong Iframe, bạn phải tuân thủ nghiêm ngặt checklist sau:

- [ ] **Reset CSS bắt buộc:** Thẻ `body` phải có thuộc tính `margin: 0; padding: 0;` (Nghiêm cấm đặt padding cho body khác 0 để tránh vỡ giao diện trên thiết bị di động). Mọi khoảng trống đệm nếu có phải đặt ở `margin` của container ngoài cùng.
- [ ] **Tải JQuery chuẩn:** Sử dụng hàm nạp mặc định `$(function() { init(); });` (CẤM sử dụng sự kiện `DOMContentLoaded`).
- [ ] **Khởi tạo MVU an toàn:** Bắt buộc phải chờ khởi tạo `await waitGlobalInitialized('Mvu')` và bọc hàm khởi động trong `$(errorCatched(init))`.
- [ ] **Lắng nghe sự kiện cập nhật:** Bắt buộc phải có hàm lắng nghe sự kiện cập nhật biến số để tự động vẽ lại giao diện khi biến số thay đổi:
  ```javascript
  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => renderUI());
  ```
- [ ] **Truy cập đường dẫn an toàn:** Toàn bộ việc lấy biến số phải gọi `getAllVariables()`, bắt đầu bằng tiền tố `'stat_data.'`, và dùng hàm `_.get()` của Lodash để truy cập phòng thủ (tránh crash lỗi khi biến lồng nhau chưa được tạo):
  `const level = _.get(vars, 'stat_data.Người_Chơi.HP', 100);`
- [ ] **Quy chuẩn chú thích:** Toàn bộ chú thích trong tệp JavaScript/HTML Frontend bắt buộc phải dùng định dạng `/* */` (Nghiêm cấm dùng chú thích `//`).
- [ ] **Hạn chế layout:** Tránh dùng đơn vị chiều cao `vh` và hạn chế dùng `position: absolute` để đảm bảo giao diện thích ứng linh hoạt theo độ rộng của khung chứa (responsive container).

---

## 13. TIÊU CHUẨN RÀ SOÁT VĂN PHONG & NHÂN THIẾT (WRITING QC)

Kiểm soát chất lượng văn phong thiết kế nhân vật trong các entry Worldbook:

### 13.1 Phân Hóa Đặc Trưng Ngoại Hình
- Loại bỏ các mô tả mang tính hiển nhiên (ví dụ: nhân vật bối cảnh Á mà ghi "tóc đen mắt đen", nhân vật 18 tuổi ghi "trẻ trung").
- Loại bỏ các tính từ sáo rỗng "mỹ nhân vạn năng" (xinh đẹp tinh xảo, làn da trắng trẻo, mắt đào lấp lánh).
- **Quy chuẩn kiểm tra:** Nếu ẩn tên nhân vật đi, người đọc có thể nhận dạng ra nhân vật qua đặc trưng ngoại hình cụ thể hay không (ví dụ: "tóc buộc đuôi ngựa màu xanh lục bảo, mắt hổ phách, nốt ruồi dưới khóe mắt trái" - Hợp lệ).

### 13.2 Loại Bỏ Lối Viết Khuôn Sáo Của AI
- **Từ mơ hồ:** Loại bỏ/hạn chế tối đa các từ "dường như", "gần như", "như thể", "giống như".
- **So sánh cũ mòn:** Xóa bỏ "như con thú nhỏ", "như thỏ con", "mặt hồ lòng dậy sóng lăn tăn", "hòn đá ném xuống mặt hồ phẳng lặng".
- **Biểu cảm rập khuôn:** Thay thế các mô tả sáo rỗng "khóe môi khẽ cong lên", "trong mắt thoáng qua tia phức tạp", "đầu ngón tay hơi trắng bệch" bằng các biểu đạt hành vi chân thực, trực quan.
- **Tính từ cực đoan:** Xóa bỏ "xấu hổ cực độ", "vô cùng sợ hãi", "vạn niệm đều tắt".

### 13.3 Nguyên Tắc Tuyệt Đối Không Độ (Zero-Degree Writing)
- Không đưa các đánh giá chủ quan của tác giả vào mô tả nhân vật.
- Sử dụng phương pháp **Bạch miêu (Tả thực trực tiếp)**: Tả hành vi cụ thể thay cho việc dán nhãn tính cách (ví dụ: Thay vì ghi "Cô ấy rất dịu dàng, lương thiện" hãy viết "Cô ấy thường mang đồ ăn thừa cho mèo hoang, sẵn sàng nhường ô cho người lạ dưới trời mưa").
- **Độ tinh khiết ngữ liệu:** Các mẫu hội thoại (`mes_example` hoặc thoại mẫu trong lorebook) bắt buộc chỉ chứa **thoại thuần**, cấm trộn lẫn hoạt động tâm lý, miêu tả biểu cảm hay mô tả động tác của nhân vật vào trong ngoặc thoại.

### 13.4 Cấu Trúc Tam Diện Tính (Three-Dimensional Personality)
Mỗi khía cạnh tính cách của nhân vật trong lorebook phải được xây dựng qua 5 yếu tố rõ ràng:
1. **Điều kiện kích hoạt:** Khi nào tính cách này trỗi dậy?
2. **Trạng thái năng lượng:** Hành vi, biểu cảm đặc trưng.
3. **Ngữ liệu mẫu:** Các câu thoại đặc trưng cho khía cạnh đó.
4. **Mô thức hành vi cơ thể:** Thói quen cơ học của cơ thể.
5. **Chức năng tâm lý:** Khía cạnh này bảo vệ nhân vật khỏi áp lực gì?

---

## 14. XỬ LÝ SỰ CỐ (TROUBLESHOOTING)

- **Bảng trạng thái không hiển thị ở tin nhắn đầu tiên:**
  - Kiểm tra xem trường `first_mes` của card đã có tag neo `<StatusPlaceHolderImpl/>` chưa.
  - Kiểm tra xem Regex Script số 1 (Ẩn thanh trạng thái khởi tạo) đã được bật (`Enabled: True`) và cấu hình đúng placement `[1]` chưa.
- **Validation lỗi liên tục khiến engine dừng hoạt động:**
  - Kiểm tra xem tất cả các trường biến số trong Schema có bị gán kiểu dữ liệu cứng không. Hãy chuyển hết sang `z.coerce`.
  - Đảm bảo tất cả các Object cha/con lồng nhau đều được gắn đuôi khởi tạo mặc định `.prefault({...})`.
- **Dữ liệu mảng bị trùng lặp hoặc lộn xộn:**
  - Tránh dùng `z.array()` cho các danh sách động có thể cập nhật. Hãy thiết kế lại trường đó dưới dạng `z.record(z.string(), z.object(...))` để JSON Patch thao tác trực tiếp lên các key cố định.
- **AI không chịu xuất khối cập nhật `<UpdateVariable>`:**
  - Kích hoạt entry `[mvu_update]Nhấn mạnh định dạng xuất biến` (Thứ tự 200, depth 0) để ép AI bắt buộc phải sinh thẻ mở/đóng ở cuối mỗi câu trả lời.
