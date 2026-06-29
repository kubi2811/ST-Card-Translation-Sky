# ST Card Translator Sky Fix

> Công cụ dịch **thẻ nhân vật (character card) của SillyTavern** sang Tiếng Việt (và nhiều ngôn ngữ khác) bằng AI — giữ nguyên HTML/CSS/JS, regex, lorebook, macro `{{char}}` `{{user}}`. Chạy hoàn toàn trên máy bạn.

Hỗ trợ mọi nhà cung cấp AI tương thích OpenAI: **OpenAI, Claude (Anthropic), Gemini, DeepSeek, Qwen**, hoặc proxy/local tự host.

---

## 🚀 Cài đặt nhanh (lần đầu)

Cần cài **[Node.js 18+](https://nodejs.org/)** (khuyến nghị 20+). Sau đó:

```bash
# 1. Vào thư mục dự án
cd d-ch-card-sillytarven

# 2. Cài thư viện (chỉ làm 1 lần)
npm install

# 3. Chạy app
npm run dev
```

Mở trình duyệt tại **http://localhost:5173** → xong.

> 💡 Trên Windows có thể bấm đúp file **`start.bat`** để chạy nhanh không cần gõ lệnh.

Những lần sau chỉ cần `npm run dev` (hoặc `start.bat`).

---

## 📖 Hướng dẫn sử dụng (5 bước)

### Bước 1 — Cấu hình AI (cột trái, mục "API Configuration")
1. Chọn **AI Provider**: OpenAI / Anthropic / Google (Gemini) / Custom.
2. Nhập **API Base URL** và **API Key** của bạn.
3. Chọn **Model** (bấm **Scan Models** để lấy danh sách, hoặc tự gõ tên model).
4. Bấm **Test Connection** → thấy báo xanh là OK.

> Nếu dùng key của bên thứ ba / local mà bị chặn CORS, để bật **CORS Proxy** (request sẽ đi qua dev server).

### Bước 2 — Chọn ngôn ngữ & nội dung cần dịch (mục "Translation Settings")
- **Source / Target Language**: mặc định dịch sang **Tiếng Việt**.
- Tick chọn các **nhóm trường** muốn dịch: Core, Messages, Lorebook, System, Regex Scripts, TavernHelper…
- Vài tuỳ chọn hữu ích: **Bỏ qua trường đã đúng ngôn ngữ đích**, **Jailbreak** (cho card NSFW), **Dịch Bạch Miêu** (sát nghĩa, không thêm thắt văn phong).

> ⚠️ **Lưu ý về Regex Scripts:** một số card có script regex rất nặng (hàng trăm KB). Bật nhóm này với card lớn có thể khiến trang xử lý lâu hơn vài giây — đây là bình thường, cứ chờ.

### Bước 3 — Nạp Character Card (mục "Character Card")
- **Kéo–thả** file `.json` hoặc `.png` (card SillyTavern có nhúng dữ liệu) vào ô upload, hoặc bấm để chọn file.
- Hoặc dán **link** card (JSON/PNG) rồi bấm **Tải**.
- App sẽ hiện tên card + thống kê (số lorebook, regex, greetings…).

### Bước 4 — Dịch
- Bấm **Start Translation**.
- Theo dõi tiến trình real-time ở **log panel** (lọc theo Success / Error / Retry / Warning…).
- Có thể **Pause / Resume / Cancel** bất cứ lúc nào. Tiến trình được **tự lưu** (đóng tab mở lại vẫn còn).

### Bước 5 — Kiểm tra & Xuất
- Xem lại bản dịch trong **Field Editor**, sửa tay nếu cần.
- Dùng **Verify Panel** để app tự rà lỗi (cấu trúc, độ dài, regex…).
- Bấm **Download** để tải về:
  - File **`.json`** đã dịch, hoặc
  - File **`.png`** (nhúng lại bản dịch vào đúng ảnh card gốc) — bỏ thẳng vào SillyTavern là dùng được.

---

## ✨ Tính năng chính

- **Đa nhà cung cấp AI** — OpenAI, Claude, Gemini, DeepSeek, Qwen, proxy tùy chỉnh.
- **Dịch "phẫu thuật" (surgical)** — chỉ dịch phần chữ CJK, **giữ nguyên** HTML/CSS/JS, URL, regex, biến, macro `{{char}}` `{{user}}`.
- **Hỗ trợ Worldbook / Lorebook / Regex / TavernHelper / Depth Prompt / MVU-Zod.**
- **Pause / Resume / Cancel** + tự lưu tiến trình (IndexedDB).
- **Auto-retry thông minh** — exponential backoff, retry khi bản dịch quá ngắn.
- **Field Editor + Verify Panel** — xem, sửa, rà lỗi trước khi xuất.
- **Trợ lý AI tích hợp**, công cụ tạo/đồng bộ EJS & MVU-Zod.
- **Giao diện song ngữ** EN ↔ VI, chạy 100% client-side.

---

## ⚙️ Cài đặt nâng cao

| Tùy chọn | Mặc định | Mô tả |
|-----------|----------|-------|
| Request Timeout | 60000ms | Thời gian chờ tối đa mỗi request |
| Retry Delay | 1000ms | Độ trễ cơ bản khi retry (tăng dần) |
| Max Retries | 3 | Số lần thử lại tối đa khi lỗi |
| Min Response Ratio | 15% | Tự retry nếu bản dịch ngắn hơn % này |
| Request Delay | 500ms | Thời gian chờ giữa các request |
| Chunk Size | 12000 ký tự | Kích thước mỗi khối khi dịch trường lớn |

---

## 🛠 Tech Stack

**Vite 8** + **React 19** + **TypeScript** · **Zustand** (state) · **TailwindCSS v4** · **@tanstack/react-virtual** · **Web Worker** (parse card lớn) · **Monaco Editor**.

---

## ❓ Hỏi nhanh

- **Nạp card xong app xử lý lâu / nặng?** Thường do card có Regex Scripts rất lớn. Cứ chờ; nếu không cần dịch script, tắt nhóm **Regex Scripts** ở Bước 2.
- **Không kết nối được API?** Kiểm tra Base URL/Key, thử bật **CORS Proxy**, hoặc bấm **Test Connection** để xem lỗi cụ thể.
- **Đang dịch lỡ đóng tab?** Mở lại và nạp đúng card cũ — tiến trình đã lưu sẽ được khôi phục.

---

## 📝 License

MIT
