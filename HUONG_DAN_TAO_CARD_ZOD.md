# 📖 HƯỚNG DẪN TẠO CARD SILLYTAVERN VỚI ZOD + MVU (TOÀN DIỆN)

> **File tham khảo chuẩn** — Mỗi khi cần tạo card, đọc file này.  
> Dựa trên phân tích các card hoạt động thực tế (working, public, có battle system).  
> Cập nhật: 2026-05-20

---

## MỤC LỤC

1. [Kiến Trúc Tổng Quan](#1-kiến-trúc-tổng-quan)
2. [Cấu Trúc JSON V3 Chuẩn](#2-cấu-trúc-json-v3-chuẩn)
3. [Character Info](#3-character-info)
4. [First Message & Khởi Tạo](#4-first-message--khởi-tạo)
5. [Lorebook & EJS Preprocessing](#5-lorebook--ejs-preprocessing)
6. [MVU Entries Hệ Thống](#6-mvu-entries-hệ-thống)
7. [TavernHelper Scripts](#7-tavernhelper-scripts)
8. [Zod Schema Chi Tiết & Quy Tắc Zod 4](#8-zod-schema-chi-tiết--quy-tắc-zod-4)
9. [Regex Scripts](#9-regex-scripts)
10. [Build Script](#10-build-script)
11. [Checklist & Troubleshooting](#11-checklist--troubleshooting)

---

## 1. KI KIẾN TRÚC TỔNG QUAN

Một character card SillyTavern hoàn chỉnh với MVU + Zod gồm **5 thành phần**:

```
Card JSON
├── 1. Character Info ──── name, description, personality, scenario, system_prompt
├── 2. First Message ───── first_mes (text "[khởi tạo]" → Regex thay bằng HTML)
├── 3. Lorebook ─────────── character_book → entries[] (worldbuilding + MVU rules)
│   ├── World Entries ──── Lore, nhân vật, bối cảnh, timeline...
│   └── MVU Entries ────── initvar, update rules, format rules, stat display, văn phong
├── 4. TavernHelper ────── MVU runtime + Zod Schema (2 scripts)
└── 5. Regex Scripts ───── 6 regex (ẩn biến, xóa update, làm đẹp, dashboard, khởi tạo)
```

### Luồng hoạt động khi chơi:

```
User bắt đầu chat
  → first_mes = "...nội dung...\n[khởi tạo]\n<StatusPlaceHolderImpl/>"
  → Regex "Khởi đầu" thay "[khởi tạo]" bằng HTML form nhập thông tin
  → Regex "Dashboard" thay <StatusPlaceHolderImpl/> bằng HTML bảng trạng thái
  → User điền form → gửi
  → MVU Zod Schema parse biến → lưu state
  → AI phản hồi kèm <UpdateVariable>...</UpdateVariable> + <StatusPlaceHolderImpl/>
  → Regex "Làm đẹp" biến HTML collapsible đẹp
  → Regex "Ẩn" biến khỏi prompt gửi AI
  → Entry "Danh sách biến" inject {{format_message_variable::stat_data}}
  → Regex "Dashboard" thay <StatusPlaceHolderImpl/> bằng HTML dashboard (cập nhật mỗi tin)
  → Hiển thị UI cho user
```

> 🔴 **QUAN TRỌNG:** `<StatusPlaceHolderImpl/>` **BẮT BUỘC** phải có trong `first_mes` VÀ trong mọi tin nhắn AI (do Lorebook entry "Nhấn mạnh định dạng xuất biến" ép AI xuất). Nếu thiếu tag này, Regex 4 không có gì để tìm → bảng trạng thái không hiện.

---

## 2. CẤU TRÚC JSON V3 CHUẨN

### 2.1 Mapping từ card hoạt động thực tế

Tuy cấu trúc JSON của SillyTavern có thể thay đổi qua các phiên bản, format an toàn nhất cho import là:

```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    // ═══ Character fields ═══
    "name": "Tên card",
    "description": "",
    "personality": "",
    "scenario": "",
    "first_mes": "...nội dung greeting...\n\n[khởi tạo]\n\n<StatusPlaceHolderImpl/>",
    "mes_example": "",
    "creatorcomment": "",
    "creator_notes": "",
    "system_prompt": "",
    "post_history_instructions": "",
    "tags": [],
    "creator": "",
    "character_version": "1.0",
    "alternate_greetings": [],
    "avatar": "none",
    "talkativeness": "0.5",
    "fav": false,
    "group_only": false,
    "create_date": "2026-01-01T00:00:00.000Z",

    // ═══ Lorebook (V3 native) ═══
    "character_book": {
      "name": "Tên World",
      "entries": [ ... ]       // ← PHẢI là Array []
    },

    // ═══ Extensions ═══
    "extensions": {
      "talkativeness": 0.5,
      "fav": false,
      "depth_prompt": { "prompt": "", "depth": 4, "role": "system" },
      "world": "",

      // TH Scripts
      "tavern_helper": {
        "scripts": [ ... ],    // ← MVU + Zod
        "variables": {}
      },

      // Hoặc (tùy bản ST)
      "TavernHelper_scripts": [ ... ],

      // Regex
      "regex_scripts": [ ... ],

      // Backup lorebook
      "character_book": {
        "name": "...",
        "entries": [ ... ]
      }
    }
  }
}
```

### 2.2 Vị Trí Đặt Từng Thành Phần (Bảng Tham Chiếu)

| Thành phần | Vị trí trong JSON | Format | Bắt buộc |
|-----------|-------------------|--------|----------|
| Character Book | `data.character_book` | `{ name, entries: [] }` | ✅ |
| Character Book (backup) | `data.extensions.character_book` | Giống trên | ⚠️ Nên có |
| TH Scripts (cách 1) | `data.extensions.tavern_helper.scripts` | `[{type,name,content,...}]` | ✅ |
| TH Scripts (cách 2) | `data.extensions.TavernHelper_scripts` | `[{type,name,content,...}]` | ✅ |
| Regex Scripts | `data.extensions.regex_scripts` | `[{scriptName,findRegex,...}]` | ✅ |
| Depth Prompt | `data.extensions.depth_prompt` | `{prompt,depth,role}` | ❌ |

> ⚠️ **ĐẶT LOREBOOK Ở CẢ HAI VỊ TRÍ** để tương thích mọi phiên bản SillyTavern.

---

## 3. CHARACTER INFO

| Field | Vai trò | Trong card MVU nâng cao |
|-------|---------|-------------------|
| `name` | Tên hiển thị | "Tên nhân vật" |
| `description` | Mô tả AI vai trò gì | (Để trống — dùng các entry lorebook thay thế) |
| `personality` | Tính cách AI | (Để trống) |
| `scenario` | Bối cảnh thế giới | (Để trống) |
| `system_prompt` | Prompt hệ thống | (Để trống — dùng lorebook thay) |
| `first_mes` | Tin nhắn đầu tiên | `"...\n[khởi tạo]\n<StatusPlaceHolderImpl/>"` |

> **Lưu ý:** Card MVU phức tạp thường để trống hầu hết các trường top-level. Toàn bộ logic được đặt trong **lorebook entries** (ở trạng thái `constant: true` và `enabled: true`) nhằm tối ưu hoá cấu trúc nạp prompt.

---

## 4. FIRST MESSAGE & KHỞI TẠO

### 4.1 Pattern chuẩn

```
first_mes = "...nội dung chào mừng, lore mở đầu...\n\n[khởi tạo]\n\n<StatusPlaceHolderImpl/>"
```

**Giải thích 2 tag bắt buộc:**

| Tag | Mục đích | Regex xử lý |
|-----|----------|-------------|
| `[khởi tạo]` | Được Regex 5 tìm và **thay thế** bằng HTML form nhập thông tin nhân vật | Regex 5 |
| `<StatusPlaceHolderImpl/>` | Được Regex 4 tìm và **thay thế** bằng HTML bảng trạng thái | Regex 4 |

> 🔴 **BẮT BUỘC:** `<StatusPlaceHolderImpl/>` **PHẢI** có trong `first_mes`. Nếu thiếu, bảng trạng thái sẽ KHÔNG hiện ở tin nhắn đầu tiên. Với các tin nhắn AI tiếp theo, Lorebook entry "Nhấn mạnh định dạng xuất biến" sẽ ép AI tự thêm `<StatusPlaceHolderImpl/>` vào cuối mỗi phản hồi → Regex 4 sẽ tìm thấy và render bảng.

---

## 5. LOREBOOK & EJS PREPROCESSING

### 5.1 Cấu Trúc Entry Lorebook Chuẩn

Mỗi entry trong mảng `character_book.entries` phải tuân thủ schema JSON V3:

```json
{
  "id": 1,
  "keys": ["từ khóa 1", "từ khóa 2"],
  "secondary_keys": [],
  "comment": "Tên hiển thị của entry",
  "content": "Nội dung...",
  "constant": false,
  "selective": true,
  "insertion_order": 50,
  "enabled": true,
  "position": "after_char",
  "use_regex": false,
  "extensions": {
    "position": 1,
    "exclude_recursion": false,
    "display_index": 1,
    "probability": 100,
    "useProbability": true,
    "depth": 4,
    "selectiveLogic": 0,
    "outlet_name": "",
    "group": "",
    "group_override": false,
    "group_weight": 100,
    "prevent_recursion": false,
    "delay_until_recursion": false,
    "scan_depth": null,
    "match_whole_words": null,
    "use_group_scoring": false,
    "case_sensitive": null,
    "automation_id": "",
    "role": 0,
    "vectorized": false,
    "sticky": 0,
    "cooldown": 0,
    "delay": 0,
    "match_persona_description": false,
    "match_character_description": false,
    "match_character_personality": false,
    "match_character_depth_prompt": false,
    "match_scenario": false,
    "match_creator_notes": false,
    "triggers": [],
    "ignore_budget": false
  }
}
```

### 5.2 Tối Ưu Hoá Context Bằng EJS Preprocessing (`@@preprocessing`)
Để giảm thiểu tiêu thụ token và tránh quá tải context của mô hình ngôn ngữ, chúng ta tích hợp khối lệnh xử lý EJS nâng cao vào bên trong nội dung (`content`) của entry:

- Dùng tag `@@preprocessing` để khai báo block lệnh xử lý đầu vào của EJS.
- Lọc động các entry lorebook dựa theo biến trạng thái (ví dụ: chỉ load thông tin địa điểm khi người chơi thực sự có mặt tại địa điểm đó).
- Cú pháp ví dụ:
  ```markdown
  @@preprocessing
  <% if (_.get(stat_data, 'Người_Chơi.Vị_Trí') === 'Hào Châu') { %>
  Hào Châu là một đô thị sầm uất tại khu vực miền Trung, là cứ điểm quan trọng...
  <% } else { %>
  <!-- skip -->
  <% } %>
  ```

---

## 6. MVU ENTRIES HỆ THỐNG

Đây là các lorebook entries **bắt buộc** để MVU engine hoạt động:

### 6.1 Entry: `[initvar]Khởi tạo biến` (enabled: FALSE)
Entry này chứa giá trị mặc định ban đầu định nghĩa theo cấu trúc Zod Schema bằng ngôn ngữ **YAML** (hoặc JSON). Nó được kịch bản MVU phân tích cục bộ ngay khi import card.

- **Comment:** `[initvar]Khởi tạo biến`
- **Enabled:** `false` (Bắt buộc tắt để không gửi cấu trúc rỗng này cho AI)
- **Content ví dụ (khớp cấu trúc Schema):**
  ```yaml
  Thiên_Hạ:
    Thời_Gian:
      Giờ: "Giờ Thìn (7h-9h)"
      Ngày: "Mùng một"
      Tháng: "Tháng Năm"
      Năm: "Chí Chính năm thứ mười một (1351)"
    Thời_Tiết: "Nóng bức oi ả"
    Thiên_Tai_Dịch_Bệnh: "Bình thường"
    Biến_Động_Thiên_Hạ: []
  Người_Chơi:
    Tên: "Chờ cập nhật"
    Tuổi: 20
    Giới_Tính: "Nam"
    Vị_Trí: "Hào Châu"
    Giai_Cấp_Nguyên_Triều: "Nam Nhân"
    Trạng_Thái: "Khỏe mạnh, bụng hơi đói"
    Tài_Sản_Chính:
      Bạc_Vụn: 0
      Muối_Trắng: 0
    Túi_Đồ: {}
  ```

### 6.2 Entry: `Danh sách biến số` (Stat Display)
Entry này hiển thị giá trị biến hiện tại cho AI đọc.
- **Enabled:** `true`
- **Position:** `after_char`
- **Insertion Order:** `999`
- **Content:**
  ```yaml
  ---
  <status_current_variables>
  {{format_message_variable::stat_data}}
  </status_current_variables>
  ```

### 6.3 Entry: `[mvu_update] Quy tắc cập nhật biến` (Update Rules)
Entry định nghĩa quy tắc logic cho AI biết khi nào và như thế nào để thay đổi các biến số.
- **Enabled:** `true`
- **Position:** `after_char`
- **Insertion Order:** `200` (được chèn trước prompt định dạng)
- **Content:**
  ```yaml
  ---
  quy_tắc_cập_nhật_biến:
    Người_Chơi:
      Trạng_Thái:
        type: string
        check: Cập nhật khi người chơi chịu đói khát, kiệt sức hoặc bị thương trong chiến đấu.
      Tài_Sản_Chính:
        Bạc_Vụn:
          type: number
          range: 0~9999
          check: Tăng khi bán vật phẩm hoặc hoàn thành nhiệm vụ, giảm ±(1~100) khi mua sắm, trả lộ phí.
  ```

### 6.4 Entry: `[mvu_update] Định dạng xuất biến` (Format Rules)
Entry dạy AI xuất các chỉ thị thay đổi theo cấu trúc JSON Patch (RFC 6902) mở rộng.
- **Content:**
  ```yaml
  ---
  định_dạng_xuất_biến:
    rule:
      - you must output the update analysis and the actual update commands at once in the end of the next reply
      - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:
        - replace: replace the value of existing paths (absolute set)
        - delta: update the value of existing number paths by a positive/negative delta value (numerical incremental adjust)
        - insert: insert new items into an object or array (using `-` as array index intends appending to the end)
        - remove: remove an existing path or item
      - don't update field names starting with `_` (readonly fields)
      - [History context check]: Before writing updates, scan prior messages for events reflecting these changes. If already processed, do NOT apply redundant updates.
    format: |-
      <UpdateVariable>
      <Analysis>$(IN ENGLISH, no more than 80 words)
      - ${calculate time passed: ...}
      - ${history check: check if the variable change was already processed in previous messages}
      - ${analyze every variable based on its corresponding check: ...}
      </Analysis>
      <JSONPatch>
      [
        { "op": "replace", "path": "/Người_Chơi/Vị_Trí", "value": "Hào Châu" },
        { "op": "delta", "path": "/Người_Chơi/Tài_Sản_Chính/Bạc_Vụn", "value": -10 },
        { "op": "insert", "path": "/Người_Chơi/Túi_Đồ/Bình nước", "value": { "Mô_Tả": "Bình nước bằng da dê", "Số_Lượng": 1 } },
        { "op": "remove", "path": "/Người_Chơi/Túi_Đồ/Lương khô" }
      ]
      </JSONPatch>
      </UpdateVariable>
  ```

---

## 7. TAVERNHELPER SCRIPTS

Để vận hành MVU + Zod tại runtime, card JSON bắt buộc phải đính kèm 2 script:

### 7.1 Script 1: MVU Runtime Engine
Script này chịu trách nhiệm load engine MVU.
- **Name:** `MVU`
- **Content:**
  ```javascript
  import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'
  ```

### 7.2 Script 2: MVU Zod Schema
Script này chứa định nghĩa Zod Schema cho dữ liệu của thẻ nhân vật.
- **Name:** `MVU Zod Schema`
- **Content:** (Xem chi tiết cú pháp tại Mục 8)

---

## 8. ZOD SCHEMA CHI TIẾT & QUY TẮC ZOD 4

Zod 4 cung cấp khả năng kiểm soát dữ liệu cực kỳ mạnh mẽ. Khi viết mã nguồn Zod Schema, bạn phải tuân thủ nghiêm ngặt các quy tắc kỹ thuật sau:

### 8.1 Các Quy Tắc Bắt Buộc Của Zod 4:
1. **Sử dụng `z.coerce.number()` thay cho `z.number()`:** Giúp tự động ép kiểu dữ liệu từ chuỗi text nhận được từ AI sang định dạng số nguyên/số thực một cách an toàn.
2. **Sử dụng `.prefault(value)` thay cho `.default(value)`:** Bắt buộc áp dụng `.prefault()` cho mọi trường trong Schema (kể cả object và array con) để đảm bảo dữ liệu luôn được khởi tạo cấu trúc mặc định, tránh crash runtime.
3. **Giới hạn biên độ bằng `.transform()`:** Thay vì sử dụng `.min()` hoặc `.max()` (gây lỗi ném biệt lệ khi vượt quá giới hạn làm đứng luồng), hãy dùng lodash `.transform(v => _.clamp(v, min, max))` để giới hạn khoảng giá trị an toàn.
4. **Ưu tiên `z.record()` thay vì `z.array()` cho danh sách động:** Khi lưu trữ túi đồ hoặc mạng lưới nhân vật, sử dụng `z.record(z.string(), z.object(...))` giúp AI cập nhật dữ liệu dễ dàng hơn qua JSON Patch.
5. **CẤM sử dụng `.strict()` hoặc `.passthrough()`:** Các phương thức kiểm soát này không tương thích với cơ chế xử lý của MVU.
6. **KHÔNG dùng `.optional()` cho các biến gốc:** Các trường dữ liệu chính của trạng thái game phải luôn có giá trị mặc định thay vì để `undefined`.
7. **Bảo toàn tính lũy đẳng (Idempotency):** Đảm bảo `Schema.parse(Schema.parse(x)) === Schema.parse(x)`.
8. **CDN import chuẩn:** Import duy nhất `registerMvuSchema` từ CDN của StageDog. Thư viện `z` và `_` (lodash) đã được inject toàn cục, tuyệt đối **không được** import lại chúng.

### 8.2 Ví Dụ Zod Schema Chuẩn Vị:

```javascript
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  // ==================== THẾ GIỚI ====================
  Thiên_Hạ: z.object({
    Thời_Gian: z.object({
      Giờ: z.string().prefault("Giờ Thìn (7h-9h)"),
      Ngày: z.string().prefault("Mùng một"),
      Năm: z.string().prefault("Chí Chính năm thứ mười một (1351)"),
    }).prefault({}),
    Thời_Tiết: z.string().prefault("Nóng bức oi ả"),
    Thiên_Tai_Dịch_Bệnh: z.enum([
      "Bình thường", "Nạn đói", "Dịch hạch", "Lũ lụt Hoàng Hà"
    ]).prefault("Bình thường"),
  }).prefault({}),

  // ==================== NGƯỜI CHƠI ====================
  Người_Chơi: z.object({
    Tên: z.string().prefault("Chờ cập nhật"),
    Tuổi: z.coerce.number().prefault(20),
    Giới_Tính: z.string().prefault("Nam"),
    Vị_Trí: z.string().prefault("Hào Châu"),
    Trạng_Thái: z.string().prefault("Khỏe mạnh, bụng hơi đói"),
    Tài_Sản_Chính: z.object({
      Bạc_Vụn: z.coerce.number().transform(v => Math.max(v, 0)).prefault(0),
      Muối_Trắng: z.coerce.number().transform(v => Math.max(v, 0)).prefault(0),
    }).prefault({}),
    Túi_Đồ: z.record(
      z.string().describe("Tên vật phẩm"),
      z.object({
        Mô_Tả: z.string().prefault("Chờ cập nhật"),
        Số_Lượng: z.coerce.number().prefault(1),
      }).prefault({})
    ).prefault({}),
  }).prefault({}),
}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});
```

---

## 9. REGEX SCRIPTS

Để làm đẹp giao diện hiển thị và lọc bỏ thông tin cập nhật khỏi prompt, cấu hình đúng 6 regex sau:

| # | Tên Script | findRegex | replaceString | promptOnly | markdownOnly | placement | minDepth / maxDepth |
|---|------------|-----------|---------------|------------|--------------|-----------|---------------------|
| 0 | Ẩn thanh trạng thái | `<StatusPlaceHolderImpl/>` | (Trống) | ✅ | ❌ | `[2]` | minDepth: 3 |
| 1 | Xóa cập nhật biến | `/<update(?:variable)?>(?:(?!.*<\\/update(?:variable)?>).*$|.*<\\/update(?:variable)?>)/gsi` | (Trống) | ✅ | ❌ | `[2]` | - |
| 2 | Đang cập nhật biến | `/<update(?:variable)?>(?!.*<\\/update(?:variable)?>)\\s*(.*)\\s*$/gsi` | HTML Box (Loading UI) | ❌ | ✅ | `[2]` | - |
| 3 | Cập nhật xong | `/<update(?:variable)?>\\s*(.*)\\s*<\\/update(?:variable)?>/gsi` | HTML Box (Completed UI) | ❌ | ✅ | `[2]` | - |
| 4 | Làm đẹp thanh trạng thái | `<StatusPlaceHolderImpl/>` | Codeblock HTML Dashboard | ❌ | ✅ | `[1, 2]` | - |
| 5 | Khởi đầu | `\[khởi tạo\]` | Codeblock HTML Form | ❌ | ✅ | `[1, 2]` | maxDepth: 1 |

---

## 10. BUILD SCRIPT

Sử dụng script Node.js tự động hoá để lắp ráp các file rời thành một file card JSON hoàn chỉnh. Tránh copy thủ công gây ra lỗi escape kí tự (`\\`).

```javascript
const fs = require('fs');
const path = require('path');

// Đọc và lắp ráp card JSON
const buildCard = () => {
  const zodSchemaContent = fs.readFileSync(path.join(__dirname, 'zod_schema.js'), 'utf-8');
  const dashboardHtmlContent = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf-8');
  
  const cardTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, 'template.json'), 'utf-8'));
  
  // Nạp mã Zod Schema vào TavernHelper script
  cardTemplate.data.extensions.TavernHelper_scripts.find(s => s.name === 'MVU Zod Schema').content = zodSchemaContent;
  
  // Nạp HTML vào Regex Dashboard
  cardTemplate.data.extensions.regex_scripts.find(r => r.scriptName === 'Làm đẹp thanh trạng thái').replaceString = `\`\`\`html\n${dashboardHtmlContent}\n\`\`\``;
  
  fs.writeFileSync(path.join(__dirname, 'FINAL_CARD.json'), JSON.stringify(cardTemplate, null, 2));
  console.log("Build card hoàn tất!");
};

buildCard();
```

---

## 11. CHECKLIST & TROUBLESHOOTING

### 11.1 Checklist trước khi nhập (Import):
- [ ] JSON card hợp lệ, đúng cấu trúc v3 (`spec_version: "3.0"`).
- [ ] `character_book.entries` là một mảng `[]`, không phải object.
- [ ] Mọi trường trong Zod Schema đều có `.prefault()`.
- [ ] Tên các trường Zod Schema dùng dấu gạch dưới (`_`) thay cho khoảng trắng để tránh lỗi JSON Patch path.
- [ ] File `[initvar]Khởi tạo biến` ở trạng thái **disabled** (`enabled: false`).
- [ ] Iframe HTML Reset margin/padding của body về `0` để tránh vỡ bố cục trên mobile.

### 11.2 Xử lý sự cố (Troubleshooting):
- **Bảng trạng thái không hiện ở tin nhắn đầu tiên:** Kiểm tra xem `first_mes` có chứa thẻ `<StatusPlaceHolderImpl/>` hay không và kiểm tra Regex 4 placement đã có `[1]` (phía user/greeting) chưa.
- **Lỗi validation crash tại runtime:** Đảm bảo kiểu dữ liệu AI trả về được chuyển đổi chính xác bằng `.coerce.number()` và không sử dụng các phương thức cấm như `.strict()`.
- **Mất thanh trạng thái khi chat kéo dài:** Đảm bảo Lorebook entry "Định dạng xuất biến" ép AI luôn xuất thẻ `<StatusPlaceHolderImpl/>` ở cuối mỗi câu trả lời.
