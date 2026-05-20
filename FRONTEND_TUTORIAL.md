# Hướng Dẫn Thực Hành: Xếp Hạng & Thiết Kế Giao Diện Frontend (Thẻ SillyTavern)

Tài liệu này tập trung vào cách hiển thị UI đẹp, mượt mà, đồng thời nhúng an toàn HTML/CSS/JS phức tạp vào bên trong cửa sổ Chat của SillyTavern (cả hai mô hình: **Self-contained SPA** và **MVU/Zod**) mà không làm ảnh hưởng tính năng sinh văn bản của AI.

---

## 1. Cơ Chế Nhúng Giao Diện (Bypass DOMPurify)

SillyTavern mặc định chặn (sanitize) JavaScript và một số thẻ HTML lạ bằng thư viện DOMPurify. Để chạy được script và hiển thị UI tùy biến trong Chat, chúng ta sử dụng kỹ thuật bọc Markdown Code Block kết hợp cấu hình Regex.

### Cấu Hình Regex Trong Thẻ (Tag)
1. Truy cập tab **Extensions -> Regex** (hoặc chỉnh sửa mảng `extensions.regex_scripts` trong card JSON).
2. Thiết lập regex khớp với keyword hiển thị UI (ví dụ: `<UpdateVariable>` hoặc các keyword tùy chọn).
3. Đặt `markdownOnly: true` để chỉ hiển thị UI ra mắt người chơi (HTML được render trong iframe), tuyệt đối **không gửi HTML này vào AI Prompt**.
4. Đặt `placement`: Chọn mức độ 2 (Chỉ kích hoạt regex trên câu trả lời của AI).

### Kỹ Thuật "Bọc Bằng Markdown Code Block"
Toàn bộ mã nguồn HTML (`<!DOCTYPE html>...`) phải được bọc trong fenced code block (```html ... ```) bên dưới thuộc tính thay thế của Regex (replaceString) để lừa DOMPurify render nó dưới dạng một iframe an toàn.

```html
// Mẫu chuỗi thay thế của Regex:
Nhấn vào nút bên dưới để mở giao diện:
```html
<!DOCTYPE html>
<html lang="vi-VN">
<head>
    <meta charset="UTF-8">
    <style>
       body { margin: 0; padding: 0; background: #1e1e2e; color: #cdd6f4; }
       .btn-primary { color: #ffffff; background: #89b4fa; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; }
    </style>
</head>
<body>
    <button class="btn-primary" id="btn-test">Test API</button>
    <script type="module">
      async function init() {
          console.log("Iframe JS Load thành công do đã được bypass DOMPurify.");
      }
      $(errorCatched(init));
    </script>
</body>
</html>
```
```

---

## 2. Liên Kết Frontend Với Hệ Thống Biến MVU/Zod

Đối với các thẻ nhân vật nâng cao sử dụng mô hình MVU/Zod, Frontend UI cần đọc trạng thái thực tế từ hệ thống biến cốt lõi của SillyTavern thay vì tự quản lý dữ liệu.

### 2.1 Khởi Tạo An Toàn & Lắng Nghe Sự Kiện
Quy trình khởi tạo giao diện bắt buộc phải đợi hệ thống MVU sẵn sàng trước khi truy xuất dữ liệu:

1. **Chờ đợi MVU khởi tạo:** Dùng `await waitGlobalInitialized('Mvu')`.
2. **Khai báo hàm init với errorCatched:** Bao bọc toàn bộ code khởi tạo bằng `$(errorCatched(init))` để bắt lỗi run-time.
3. **Đăng ký lắng nghe cập nhật biến:** Dùng sự kiện `Mvu.events.VARIABLE_UPDATE_ENDED` để đồng bộ lại UI khi AI thay đổi dữ liệu.

### 2.2 Đọc Biến Bằng Tiền Tố `stat_data.`
Hệ thống lưu trữ các biến trạng thái trong không gian `stat_data`. Để tránh lỗi trỏ null khi một biến chưa được khởi tạo, ta sử dụng thư viện Lodash (`_`) đã được import sẵn toàn cục:
- Sử dụng cú pháp `_.get(vars, 'stat_data.Nhân_vật.HP', default_value)`.
- *Lưu ý:* Khi AI xuất các lệnh cập nhật JSON Patch (RFC 6902), đường dẫn **không có** tiền tố `stat_data` (ví dụ: `/Nhân_vật/HP`), nhưng khi EJS hay Frontend truy cập biến thì **bắt buộc phải có** tiền tố `stat_data.`.

### 2.3 Giao Tiếp & Gửi Hành Động (Trigger Action)
Khi người dùng tương tác trên UI (ví dụ: bấm nút tấn công, mua đồ), Frontend gửi lệnh thông qua hàm `triggerSlash(command)` để ra lệnh cho AI. 

Mẫu tích hợp MVU hoàn chỉnh cho Frontend:

```html
<!DOCTYPE html>
<html lang="vi-VN">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg-color: #1e1e2e;
    --card-bg: #252538;
    --text-color: #cdd6f4;
    --primary: #cba6f7;
    --danger: #f38ba8;
  }
  /* BẮT BUỘC: reset margin/padding body bằng 0 để tránh vỡ thanh cuộn iframe */
  body { 
    margin: 0; 
    padding: 0; 
    background-color: var(--bg-color); 
    color: var(--text-color);
    font-family: 'Inter', sans-serif;
  }
  .container {
    padding: 15px;
  }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 15px;
    background: var(--card-bg);
    padding: 12px;
    border-radius: 8px;
  }
  .hp-bar {
    flex-grow: 1;
    height: 10px;
    background: #313244;
    border-radius: 5px;
    overflow: hidden;
  }
  .hp-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--danger), #fab387);
    width: 0%;
    transition: width 0.4s ease;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="status-bar">
      <div><strong id="char-name">Đang tải...</strong></div>
      <div class="hp-bar">
        <div class="hp-fill" id="hp-fill"></div>
      </div>
      <span id="hp-text">0/0</span>
      <button class="btn-action" id="btn-attack">⚔️ Tấn Công</button>
    </div>
  </div>

  <script type="module">
    // Khởi tạo không đồng bộ
    async function init() {
      // 1. Chờ đợi hệ thống MVU toàn cục sẵn sàng
      await waitGlobalInitialized('Mvu');
      
      // 2. Render dữ liệu lần đầu
      populateCharacterData();
      
      // 3. Đăng ký sự kiện lắng nghe cập nhật biến từ AI
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, populateCharacterData);

      // 4. Gắn sự kiện click gửi hành động về chat
      document.getElementById('btn-attack').addEventListener('click', () => {
        const cmd = '/sys Bạn tấn công quái vật! Hãy mô tả diễn biến chiến đấu và trừ HP của bạn.';
        if (typeof triggerSlash === 'function') {
          triggerSlash(cmd);
        }
      });
    }

    // Đọc biến từ hệ thống MVU và cập nhật DOM
    function populateCharacterData() {
      const vars = getAllVariables();
      if (!vars) return;

      // Dùng _.get với tiền tố stat_data để lấy biến an toàn
      const name = _.get(vars, 'stat_data.Nhân_vật.Tên', 'Vô Danh');
      const hp = _.get(vars, 'stat_data.Nhân_vật.HP', 100);
      const maxHp = _.get(vars, 'stat_data.Nhân_vật.Max_HP', 100);

      document.getElementById('char-name').textContent = name;
      document.getElementById('hp-text').textContent = `${hp}/${maxHp}`;
      document.getElementById('hp-fill').style.width = `${_.clamp((hp / maxHp) * 100, 0, 100)}%`;
    }

    // Thực thi khởi tạo an toàn
    $(errorCatched(init));
  </script>
</body>
</html>
```

---

## 3. Layout Chuẩn Cho Thẻ Game (Self-Contained SPA)

Nếu bạn xây dựng một thẻ game tự vận hành logic mà không dùng biến MVU (lưu trữ qua `localStorage` hoặc `IndexedDB/Dexie.js`), sử dụng mô hình **3-Pane Flex Layout** (Trái - Giữa - Phải) để tận dụng không gian hiển thị.

```html
<style>
.st-card-game-panel {
    display: flex;
    width: 100%;
    height: 100dvh; /* 100dvh chống tràn thanh địa chỉ mobile */
    overflow: hidden;
    color: #e5e9f0;
    background-color: #2e3440;
}

.pane-left {
    width: 300px;
    flex-shrink: 0;
    padding: 15px;
    overflow-y: auto;
    border-right: 1px solid #4c566a;
}

.pane-center {
    flex-grow: 1;
    padding: 15px;
    overflow-y: auto;
}

.pane-right {
    width: 250px;
    flex-shrink: 0;
    padding: 15px;
    border-left: 1px solid #4c566a;
}

/* Quy tắc responsive khuyên dùng (992px) */
@media (max-width: 992px) {
    .st-card-game-panel {
        flex-direction: column;
    }
    .pane-left, .pane-right {
        width: 100%;
        height: auto;
        border: none;
        border-bottom: 1px solid #4c566a;
    }
}
</style>
```

---

## 4. Hệ Thống Pop-up / Overlay (Z-index Hierarchy)

Khi thiết kế hộp thoại (Dialog) hoặc bảng thông báo (Modal) trong Iframe, bạn cần quản lý chặt chẽ thứ tự hiển thị (`z-index`) để tránh xung đột với các thành phần nền:

- **Modal Overlay (Nền mờ):** Đặt `z-index: 1000` đến `2000` tùy theo độ sâu.
- **Hộp thoại khẩn cấp/Cảnh báo:** Đặt `z-index: 6000` để nổi lên trên cùng.
- Tránh truy cập `parent.document` trực tiếp vì lý do bảo mật Cross-Origin, hãy sử dụng cơ chế xử lý nội bộ iframe của bạn.

```html
<style>
.modal-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background-color: rgba(0,0,0,0.85);
    z-index: 1000;
    display: none; 
    justify-content: center;
    align-items: center;
}
.modal-box {
    background: #3b4252;
    padding: 20px;
    border-radius: 12px;
    border: 2px solid #88c0d0;
    width: 400px;
    max-width: 90%;
    transform: scale(0.8);
    transition: transform 0.2s ease;
}
.modal-overlay.active { display: flex; }
.modal-overlay.active .modal-box { transform: scale(1); }
</style>
```

---

## 5. Quy Tắc Thiết Kế Giao Diện Premium

Để đảm bảo giao diện đạt chuẩn agency-level, bắt mắt người dùng ngay từ cái nhìn đầu tiên:

1. **Không Dùng Padding Cho Body:** Thiết lập `body { margin: 0; padding: 0; }` là bắt buộc. Nếu muốn tạo khoảng cách lề cho trang, hãy bọc nội dung bằng một thẻ `.container` hoặc `.wrapper` rồi set padding trên đó.
2. **Harmonious Color Palette (Sử dụng CSS Variables):** Định nghĩa bảng màu rõ ràng theo phong cách tối (Dark theme mặc định) hoặc hỗ trợ chuyển đổi theme. Tránh dùng các màu nguyên bản (Red, Green, Blue lòe loẹt), hãy dùng các tông màu dịu hơn dạng HSL/Hex (ví dụ: `#a6e3a1` cho green, `#f38ba8` cho red).
3. **Phông Chữ Hiện Đại (Typography):** Import font chữ từ Google Fonts (như Inter, Outfit, Lora) thay vì phông chữ mặc định của hệ thống.
4. **Micro-animations:** Thêm các hiệu ứng di chuột (hover transition), thay đổi trạng thái tiến trình mượt mà (`transition: all 0.3s ease`).
5. **Không Sử Dụng Placeholders:** Các hình ảnh minh họa hoặc biểu tượng phải là tài sản có thật, link CDN hoạt động, hoặc sử dụng các biểu tượng unicode/FontAwesome.
