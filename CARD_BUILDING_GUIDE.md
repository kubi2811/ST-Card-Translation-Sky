# Hướng Dẫn Xây Dựng Card Frontend — SillyTavern V3

> Tài liệu tham chiếu toàn diện cho việc tạo character card có UI tương tác.
> Phân tích từ các mẫu thực tế chạy mượt mà trên nền tảng SillyTavern.

---

## Mục Lục
1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [Cấu Trúc File JSON](#2-cấu-trúc-file-json)
3. [Regex Scripts — Core Engine](#3-regex-scripts--core-engine)
4. [Kiến Trúc UI: Single Regex vs Multi-Regex](#4-kiến-trúc-ui-single-regex-vs-multi-regex)
5. [first_mes — Splash Screen](#5-first_mes--splash-screen)
6. [Lorebook & EJS Preprocessing](#6-lorebook--ejs-preprocessing)
7. [State Management](#7-state-management)
8. [CSS Design System](#8-css-design-system)
9. [Layout 3 Pane](#9-layout-3-pane)
10. [Modal & Overlay System](#10-modal--overlay-system)
11. [Responsive Design](#11-responsive-design)
12. [MVU/Zod Configuration & Zod 4 Conventions](#12-mvuzod-configuration--zod-4-conventions)
13. [Communication: Iframe ↔ Parent](#13-communication-iframe--parent)
14. [External Dependencies](#14-external-dependencies)
15. [Encoding & Sửa Lỗi Tiếng Việt](#15-encoding--sửa-lỗi-tiếng-việt)
16. [Lỗi Thường Gặp & Khắc Phục](#16-lỗi-thường-gặp--khắc-phục)
17. [Checklist Tạo Card Mới](#17-checklist-tạo-card-mới)

---

## 1. Tổng Quan Kiến Trúc

Card frontend SillyTavern V3 hoạt động như một **ứng dụng web đơn trang (SPA)** được nhúng vào chat thông qua cơ chế regex. Toàn bộ HTML/CSS/JS nằm trong một trường `replaceString` duy nhất (hoặc tách nhỏ theo file trước khi build).

### Sơ Đồ Kiến Trúc

```
┌──────────────────────────────────────────────────┐
│ SillyTavern Chat Window                          │
│                                                  │
│  AI Message chứa keyword "<UpdateVariable>"      │
│       ↓ regex match                              │
│  ┌────────────────────────────────────────────┐   │
│  │ <iframe> (DOMPurify bypass via ```html```) │   │
│  │                                            │   │
│  │  ┌──────┬──────────┬────────┐              │   │
│  │  │ LEFT │  CENTER  │ RIGHT  │  ← 3 Pane   │   │
│  │  │ Pane │  (Chat)  │ Pane   │              │   │
│  │  └──────┴──────────┴────────┘              │   │
│  │                                            │   │
│  │  State: MVU Variables (Zod Core Schema)    │   │
│  │  DOM:   document.getElementById()          │   │
│  │  Comm:  triggerSlash() & eventOn()         │   │
│  └────────────────────────────────────────────┘   │
│                                                  │
│  Lorebook (~60 entries) → AI context/knowledge   │
└──────────────────────────────────────────────────┘
```

### Hai Mô Hình Card Chính

| Đặc điểm | Mô hình MVU/Zod (Khuyên Dùng) | Mô hình Self-contained |
|-----------|-----------------|-------------------------------------|
| State | MVU variables qua SillyTavern API | localStorage + IndexedDB |
| DOM Access | `window.getAllVariables()` + Lodash | `document.getElementById()` |
| Communication | `triggerSlash()`, `eventOn(Mvu.events...)` | `parent.*`, `fetch()` |
| Regex Scripts | 5-6 scripts chuyên biệt | **1 script duy nhất** |
| UI Injection | Nhiều regex nhỏ, mỗi cái 1 chức năng | 1 regex = toàn bộ ứng dụng |
| Complexity | Vừa phải, dễ đồng bộ AI | Rất cao, khó chia sẻ biến |
| Dùng khi | Muốn AI hiểu biến trạng thái | Card game thuần không tương tác AI |

---

## 2. Cấu Trúc File JSON

```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    "name": "Tên card",
    "first_mes": "... [khởi tạo] ... <StatusPlaceHolderImpl/>",
    "description": "",
    "personality": "",
    "scenario": "",
    "extensions": {
      "regex_scripts": [ ... ],
      "TavernHelper_scripts": [ ... ],
      "character_book": { "name": "World Name", "entries": [] }
    },
    "character_book": { "name": "World Name", "entries": [] }
  }
}
```

---

## 3. Regex Scripts — Core Engine

Để tránh bị DOMPurify lọc JavaScript, toàn bộ nội dung thay thế `replaceString` có chứa script phải được bọc trong codeblock Markdown ` ```html ... ``` `.

- **Bảo Vệ Prompt:** Các regex làm đẹp UI phải được đặt `markdownOnly: true` (hoặc `promptOnly: false`) để tránh gửi hàng ngàn dòng code giao diện vào prompt AI.
- **Ẩn Biến/Thẻ Update:** Dùng các regex có `promptOnly: true` để lọc bỏ các tag `<UpdateVariable>` và `<StatusPlaceHolderImpl/>` trước khi gửi prompt lên AI.

---

## 4. Kiến Trúc UI: Single Regex vs Multi-Regex

- **Multi-Regex (Cho Card MVU):** Phân chia công việc rõ ràng. Một script xóa biến khỏi prompt, một script render loading, một script render dashboard. Cách này giúp code gọn gàng, modular và dễ bảo trì.
- **Single-Regex (Cho Card Game SPA):** Bọc toàn bộ game engine và các sub-modal vào một regex duy nhất, AI chỉ cần in ra đúng một trigger key để kích hoạt toàn bộ view.

---

## 5. first_mes — Splash Screen

Trong `first_mes`, thay vì dán đống code HTML cồng kềnh làm phình file json, ta chỉ cần chèn từ khóa `[khởi tạo]` và thẻ `<StatusPlaceHolderImpl/>`. Regex "Khởi đầu" (có giới hạn `maxDepth: 1`) sẽ tìm `[khởi tạo]` và thay thế nó bằng HTML Form nhập liệu vô cùng mượt mà.

---

## 6. Lorebook & EJS Preprocessing

Sử dụng EJS Preprocessing (`@@preprocessing`) ở đầu nội dung của entry lorebook để kiểm soát việc nạp dữ liệu động:

```markdown
@@preprocessing
<% if (_.get(stat_data, 'Người_Chơi.Vị_Trí') === 'Thành Đô') { %>
Thành Đô là thủ phủ trù phú với tường thành kiên cố...
<% } else { %>
<!-- ẩn -->
<% } %>
```
Cách này giúp giảm đáng kể lượng token rác gửi lên AI khi người chơi không ở đúng vị trí cần thiết.

---

## 7. State Management

Trong kiến trúc MVU, biến trạng thái được đồng bộ qua API `getAllVariables()`.
Nếu cần lưu trữ các tài nguyên ảnh lớn hay các cài đặt tùy chỉnh ngoài phạm vi hiểu biết của AI, có thể kết hợp thêm `localStorage` hoặc thư viện `Dexie` (IndexedDB) bên trong Iframe.

---

## 8. CSS Design System

Để giao diện trông thật sang xịn mịn và tránh xung đột:
- **Bắt buộc:** Luôn đặt `body { margin: 0; padding: 0; }` để tránh vỡ thanh cuộn (scrollbar) của iframe SillyTavern. Bọc nội dung bằng một thẻ `.container` và set padding trên đó.
- **CSS Variables:** Sử dụng bảng màu thống nhất dạng HSL/Hex dịu mắt thay vì các màu chói nguyên bản.

```css
:root {
  --bg-color: #1e1e2e;
  --card-bg: #252538;
  --text-color: #cdd6f4;
  --primary: #cba6f7;
  --danger: #f38ba8;
}
```

---

## 9. Layout 3 Pane

Layout chia 3 bảng là tiêu chuẩn cho game dashboard:
- **Pane Trái (Width: ~300px):** Avatar, túi đồ, trang bị.
- **Pane Giữa (Flex-grow: 1):** Trung tâm lịch sử log hội thoại.
- **Pane Phải (Width: ~250px):** Bảng chỉ số chi tiết, cài đặt nhanh.

---

## 10. Modal & Overlay System

Sử dụng cấu trúc phân tầng `z-index` để quản lý hiển thị các lớp đè:
- Nền mờ (`.modal-overlay`): `z-index: 1000`.
- Hộp thoại nổi (`.modal-box`): `z-index: 1200` trở lên.
- Luôn hỗ trợ nút đóng modal rõ ràng ở góc phải và animation chuyển đổi trạng thái `transition: all 0.3s ease`.

---

## 11. Responsive Design

Bố cục responsive chuẩn cho màn hình điện thoại di động:
- Điểm ngắt khuyến nghị: `@media (max-width: 992px)`.
- Khi màn hình nhỏ hơn 992px, chuyển flex-direction của container thành `column` hoặc ẩn pane trái/phải thành sidebar dạng slide-in.

---

## 12. MVU/Zod Configuration & Zod 4 Conventions

### 12.1 Quy Tắc Zod 4 Sống Còn:
- **Ép Kiểu Tự Động:** Dùng `z.coerce.number()` thay thế cho `z.number()`.
- **Khởi Tạo Mặc Định:** Mọi trường dữ liệu và object lồng con phải được gán `.prefault(value)` thay vì `.default(value)`.
- **Giới Hạn Biên Độ:** Dùng `.transform(v => _.clamp(v, min, max))` thay vì `.min()/.max()`.
- **Dữ Liệu Khởi Tạo (`initvar`):** Đặt mảng `initvar` rỗng (`[]`) trong JSON config của card. Cấu hình thực tế nằm trong entry Worldbook `[initvar]Khởi tạo biến` dưới dạng YAML và ở trạng thái **disabled** (`enabled: false`).
- **Không Dùng:** `.strict()`, `.passthrough()`, hoặc `.optional()` ở gốc schema.

### 12.2 Đọc/Ghi Dữ Liệu:
- Đọc biến trong JS/EJS bằng tiền tố `stat_data.` kết hợp hàm an toàn Lodash:
  `const hp = _.get(vars, 'stat_data.Người_Chơi.HP', 100);`
- Khi AI xuất lệnh JSON Patch (replace, delta, insert, remove) để cập nhật biến, **đường dẫn path tuyệt đối không được chứa tiền tố `stat_data`**:
  `{"op": "replace", "path": "/Người_Chơi/HP", "value": 90}`

---

## 13. Communication: Iframe ↔ Parent

- **Chờ Đợi Khởi Tạo:** Bắt buộc sử dụng `await waitGlobalInitialized('Mvu')`.
- **Lắng Nghe Cập Nhật:**
  ```javascript
  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, updateUI);
  ```
- **Gửi Slash Command:** Gửi chỉ thị hoạt động lên SillyTavern bằng `triggerSlash(command)`.
- **An Toàn Khởi Tạo:** Bao bọc mã script của bạn trong `$(errorCatched(init))`.

---

## 14. External Dependencies

- Tải các thư viện bổ trợ (như FontAwesome, Dexie, Vis.js) qua link CDN ổn định (jsDelivr, cdnjs).
- Bổ sung fallback phòng trường hợp mất mạng hoặc CDN quá tải.

---

## 15. Encoding & Sửa Lỗi Tiếng Việt

- Đảm bảo lưu file JSON ở dạng `UTF-8` nguyên bản, không dùng mã hóa Unicode escape `\uXXXX` để viết tiếng Việt trực tiếp, giúp giảm bớt dung lượng card.
- Xử lý lỗi hiển thị Mojibake (nếu đọc dữ liệu từ nguồn cũ):
  `const fixedText = brokenText.encode('windows-1252').decode('utf-8');`

---

## 16. Lỗi Thường Gặp & Khắc Phục

- **Script trong Iframe không chạy:** Thiếu thẻ bọc Markdown ` ```html ... ``` ` làm DOMPurify xóa mất thẻ script.
- **Biến Zod bị reset hoặc báo undefined:** Thiếu `.prefault()` tại một trường con nào đó trong Schema.
- **Form khởi tạo xuất hiện liên tục:** Regex "Khởi đầu" thiếu giới hạn `maxDepth: 1` hoặc `findRegex` không đủ độc nhất.

---

## 17. Checklist Tạo Card Mới

- [ ] Thiết lập spec card v3 chuẩn.
- [ ] Zod schema đầy đủ `.prefault()` cho mọi field.
- [ ] Entry `[initvar]` ở chế độ **disabled**.
- [ ] Body CSS reset `margin: 0; padding: 0;`.
- [ ] Regex Dashboard cấu hình đúng `placement: [1, 2]`.
- [ ] Tránh escape trùng lặp dấu backslash (`\\`) trong regex.
