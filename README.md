# 🎴 SillyTavern Multitools

**Tiếng Việt** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

> **Bộ 5 công cụ giúp dịch & làm thẻ nhân vật SillyTavern — chạy hoàn toàn trên máy bạn.**
> Kết hợp của **Guillichan × Sky**.

Dành cho **dịch giả** và người làm card: dịch thẻ sang Tiếng Việt bằng AI mà **không làm vỡ code, regex, lorebook hay macro** `{{char}}` `{{user}}`.

Mọi thứ chạy trên máy bạn — **API key không gửi đi đâu cả**, không qua máy chủ trung gian nào.

> 🌐 **Ngôn ngữ & báo lỗi:** góc phải **header** (trên mọi công cụ) có nút **đổi ngôn ngữ giao diện — Tiếng Việt / English / 中文** và nút **🐞 Báo lỗi** (mở file Excel để cả nhóm cùng ghi lỗi). Dịch Card, Mod Card, Tạo Preset và phần chính của Tạo Card đã đủ 3 ngôn ngữ; các panel MVU-ZOD Studio nâng cao và Trích Card hiện vẫn tiếng Việt.

---

## 📦 Trong bộ có gì?

Mở app lên, bên trái là thanh chuyển giữa 5 công cụ. **Đổi qua lại thoải mái — việc đang chạy KHÔNG bị ngắt.**

| | Công cụ | Dùng để làm gì |
|---|---|---|
| 🌐 | **Dịch Card** | Dịch thẻ nhân vật sang Tiếng Việt. *Đây là công cụ chính.* |
| 🃏 | **Tạo Card** | Tạo thẻ mới từ truyện, làm Lorebook, Regex, biến MVU/ZOD, giao diện game. |
| 🎛️ | **Tạo Preset** | Tạo / chỉnh Preset & Regex Script cho SillyTavern bằng cách chat với AI. |
| 🛠️ | **Mod Card** | Sửa / mở rộng một thẻ có sẵn theo yêu cầu của bạn (viết thêm, đào sâu…). |
| 🔍 | **Trích Card** | Đọc truyện → tự trích ra nhân vật & Lorebook. |

---

## 🚀 Cài đặt lần đầu (làm 1 lần duy nhất)

### Bước 1 — Cài 2 phần mềm nền
- **[Node.js](https://nodejs.org/)** — chọn bản **20 trở lên** (tải về, cài như phần mềm bình thường, cứ Next → Next).
- **[Git](https://git-scm.com/downloads)** — cài mặc định, không cần đổi gì.

> Cài xong nên **khởi động lại máy** một lần cho chắc.

### Bước 2 — Tải mã nguồn về
Mở **Command Prompt** (bấm phím Windows → gõ `cmd` → Enter), rồi dán từng dòng:

```bash
cd C:\
git clone https://github.com/kubi2811/ST-Card-Translation-Sky.git
```

### Bước 3 — Chạy
Vào thư mục vừa tải, **bấm đúp file `start.bat`**.

- Lần đầu sẽ **tự cài thư viện** (hơi lâu, vài phút — cứ để yên, đừng tắt).
- Xong sẽ tự mở trình duyệt ở **http://localhost:5173**.
- Có vài **cửa sổ đen nhỏ** hiện ra — đó là 3 công cụ phụ đang chạy. **Đừng tắt chúng.**

> Những lần sau chỉ cần bấm đúp **`start.bat`** là xong.

---

## 🔄 Cập nhật phiên bản mới

**Cách 1 (dễ nhất):** trong app, bấm nút **"Cập nhật"** ở cột trái → chờ xong → **tắt hẳn app rồi chạy lại `start.bat`** (không phải chỉ bấm F5).

**Cách 2:** bấm đúp file **`update.bat`**.

<details>
<summary>⚠️ Nếu bấm Cập nhật bị lỗi / kẹt — bấm vào đây</summary>

<br>

Mở **Command Prompt** ngay trong thư mục cài đặt, chạy lần lượt:

```bash
git fetch origin main
git reset --hard origin/main
npm install
```

Rồi chạy lại `start.bat`. Cách này **luôn được**, và **không làm mất** thẻ đang dịch, tiến trình, hay file trong `dev_data`.

</details>

---

## 📖 Dịch một thẻ

### 1️⃣ Nhập API Key
Cột trái, mục **Cấu hình API** — khung **Provider #1 (chính)**:
- Chọn **Loại** (OpenAI Compatible / Anthropic / Google Gemini / Custom) và dán **Base URL**.
- Dán **API Key** — mỗi dòng (hoặc dấu phẩy) một key; càng nhiều key càng nhanh, key tự xoay vòng khi bị 429.
- Bấm **Load model** → chọn **Model chính**; bật **Model phụ** để entry ngắn đi model nhanh. Thêm **Provider bổ sung** để chạy song song nhiều nhà cung cấp.

> 💡 Số luồng chạy song song = Σ(số key × RPM) của **mọi** provider. App **tự canh đúng RPM**, không lo bị khoá.

### 2️⃣ Nạp thẻ → app tự gợi ý cấu hình
Kéo–thả `.json`/`.png` vào **Card Preview**, hoặc dán link rồi bấm Tải. Nạp xong, app **tự phân tích thẻ** và hiện **popup gợi ý**:
- Thẻ có **khung biến MVU** / script giao diện nặng → khuyên **⚡ Dịch nhẹ**; thẻ **lớn** → **🚀 Siêu tốc**; thẻ **gọn** → **📖 Đầy đủ**.
- Bấm **"✅ Dùng cấu hình gợi ý"** (áp 1 chạm) hoặc **"Giữ cấu hình hiện tại"**.

> Thẻ bạn đang dịch dở (mở lại) sẽ **tự khôi phục tiến trình** thay vì hỏi lại.

### 3️⃣ Chọn chế độ dịch (3 preset — sao ★ là chế độ khuyên cho thẻ này)

| Nút | Dịch gì | Khi nào |
|---|---|---|
| **⚡ Dịch nhẹ** | Chỉ phần người chơi **thấy** (từ khoá, lời mở đầu, tên card / tên mục Lorebook, regex hiển thị). Ruột thẻ + biến MVU giữ tiếng gốc | Thẻ có khung MVU / game UI nặng — nhanh gấp nhiều lần; AI vẫn đọc hiểu & trả lời tiếng Việt |
| **📖 Dịch đầy đủ** | Dịch trọn mọi phần | Thẻ thường, muốn Việt hoá 100% |
| **🚀 Dịch siêu tốc** | Đầy đủ + gom nhiều entry ngắn vào 1 lần gọi | Thẻ lớn / nhiều entry, muốn nhanh nhất |

### 4️⃣ Bấm **Dịch**
Trước khi dịch, app tự lo (không cần bạn làm gì):
- **📖 Bảng tên riêng (Pha 0):** quét tên nhân vật / thuật ngữ lặp lại, dịch **1 lượt** → mọi luồng dùng chung (hết cảnh 1 nhân vật mỗi chỗ một tên). Thẻ nhiều thuật ngữ tu tiên/võ hiệp còn được **tự nạp bộ thuật ngữ chuẩn**.
- **♻ Tái dùng bản dịch cũ:** nếu bạn từng dịch bản trước của thẻ, phần **nội dung không đổi** được bê thẳng bản dịch cũ sang (gắn nhãn ♻), chỉ dịch phần mới.

Trong lúc chạy: xem **panel luồng** (model nào đang dịch entry nào, RPM, **🧮 token thật vào/ra** từng model + tổng). **Tạm dừng / Dừng** bất cứ lúc nào; tiến trình **tự lưu**, đóng tab mở lại vẫn còn.

### 5️⃣ Nghiệm thu & Xuất
- **🩺 Kiểm Tra Tổng** (trong khung Export): 1 nút chạy **3 bộ kiểm** (sức khoẻ thẻ + kiểm sâu macro/ngoặc/HTML/JSON + đối chiếu card gốc) → phán quyết **ĐẠT / KHÔNG ĐẠT**; bấm dòng lỗi là **nhảy thẳng tới field** để sửa.
- **👁 Xem như SillyTavern** (nút trong Card Preview): xem lời mở đầu / greeting sau dịch **y như trong ST** — xem mục ✨ bên dưới.
- **Xuất** `.json` / `.png` (nhúng lại đúng ảnh thẻ gốc) → bỏ vào SillyTavern là chạy.

> ### ✅ Quy trình gợi ý cho dịch giả
> **Dịch xong → 🩺 Kiểm Tra Tổng (bắt lỗi tĩnh) → 👁 Xem như SillyTavern + 🧪 + ⇄ So 2 bản (bắt lỗi runtime) → sửa field lỗi → Xuất.**

---

## ✨ Những thứ đáng giá cho dịch giả

### 🔪 Dịch "phẫu thuật" — không làm vỡ thẻ
App **chỉ dịch phần chữ**, giữ nguyên tuyệt đối HTML/CSS/JS, regex, đường link, biến, và macro `{{char}}` `{{user}}` — thứ hay hỏng nhất khi dịch tay hoặc dùng AI thường. Có **guard tự sửa** khi phát hiện code bị chèn ký tự lạ.

### 👁 Xem như SillyTavern — thấy giao diện y như đang chơi ⭐
Nút **👁 Xem như SillyTavern** trong **Card Preview**. Render lời mở đầu / từng greeting sau khi áp macro + regex hiển thị của thẻ, trong iframe **cách ly an toàn** (mặc định script không chạy):
- **🧪 Chạy script + data test:** giả lập môi trường TavernHelper / MVU đúng như extension thật (JS-Slash-Runner) → **thanh trạng thái / game UI script-driven tự đổ số**, thấy giao diện đúng như trong ST mà không cần import. **Lỗi script hiện ngay + tra ra đúng regex/field của thẻ + nút ↪ nhảy tới field** để sửa bản dịch.
- **🎲 AI tạo data test:** thẻ chưa chơi (biến toàn "Chưa Biết") hoặc **không có `[initvar]`** → gọi AI điền **giá trị mẫu thực tế** cho biến (AI chỉ đổi giá trị, giữ nguyên tên biến) → thanh trạng thái hiện số thật.
- **⇄ So 2 bản:** Gốc | Đã dịch chạy **cạnh nhau** — cả 2 cùng lỗi = lỗi **có sẵn của thẻ**; chỉ bản Đã dịch lỗi = lỗi **do dịch**.

### ⚡ Đa luồng + 🧮 đếm token thật
Nhiều key × nhiều provider = nhiều luồng cùng lúc; luồng nào xong nhận mục mới ngay, vẫn **đúng RPM** (không lỗi 429). Panel + log cuối run hiện **token thật vào/ra** đọc từ chính API — biết chính xác đốt bao nhiêu (rất quý khi dùng key chung).

### ♻ Dịch bản update của thẻ — chỉ dịch phần thay đổi ⭐
Tác giả update bản gốc? Không phải dịch lại từ đầu. **Hai cách:**
- **Tự động:** nạp thẻ phiên bản mới, app tự quét cache các thẻ cũ, phần **nội dung không đổi** bê thẳng bản dịch cũ (nhãn ♻), chỉ còn phần mới cần dịch.
- **Thủ công — 🔀 So Sánh Card** (nút trên Card Preview): nạp 3 file **Card Raw** (gốc cũ), **Card Đã Dịch** (bản dịch cũ), **Card Final** (gốc mới) → **Gộp thông minh** → xem trước (♻ xanh = tái dùng, ✏️ vàng = cần dịch) → **Đưa sang Dịch Card** chỉ dịch phần mới. Còn xem được 3 phiên bản cạnh nhau, sửa trực tiếp, lọc "chỉ hiện chỗ khác nhau".

### 🧠 Nhớ & nhất quán
- **📖 Bảng tên riêng tự động** + **📚 bộ thuật ngữ Tu tiên/Võ hiệp** có sẵn (92 mục, tự nạp khi thẻ khớp) — tên & thuật ngữ nhất quán toàn thẻ.
- **Từ điển riêng (Glossary)** — ép AI dịch tên riêng, thuật ngữ đúng ý bạn (mục bạn nhập luôn thắng).
- **Bộ nhớ dịch** — câu giống nhau dịch giống nhau.
- **Đồng bộ biến MVU / EJS** — tên biến trong code và trong lorebook luôn khớp.

---

## 🧰 4 công cụ còn lại

<details>
<summary><b>🃏 Tạo Card</b> — làm thẻ mới từ đầu</summary>

<br>

Tạo thẻ từ truyện, sinh Lorebook hàng loạt, phòng thí nghiệm Regex, EJS Studio, và **MVUZOD Studio** (thiết kế biến số, giá trị khởi tạo, luật cập nhật, và **Game UI** — chat với AI để nó viết giao diện game, tự kiểm regex chạy đúng trước khi giao).

</details>

<details>
<summary><b>🎛️ Tạo Preset</b> — làm Preset & Regex</summary>

<br>

Chat với AI để thiết kế **Preset JSON** và **Regex Script JSON** cho SillyTavern, xem trước rồi tải về.

</details>

<details>
<summary><b>🛠️ Mod Card</b> — sửa / mở rộng thẻ có sẵn</summary>

<br>

Đưa thẻ vào + viết yêu cầu (ví dụ *"đổi bối cảnh"*, *"viết thêm 3 phần"*), AI sẽ phân tích rồi sửa từng phần. Có **chế độ Mở rộng / đào sâu**, xem **bảng so sánh trước–sau**; mục quá lớn thì **tự chia phần** để không bị cắt cụt.

</details>

<details>
<summary><b>🔍 Trích Card</b> — đọc truyện, trích ra nhân vật</summary>

<br>

Dán truyện dài vào, app tự chia đoạn để quét, trích ra **nhân vật + Lorebook**, rồi xuất thành file dùng được ngay.

</details>

---

## ❓ Lỗi thường gặp

**Bấm Cập nhật báo lỗi, không update được**
→ Xem mục [Cập nhật](#-cập-nhật-phiên-bản-mới) ở trên, dùng 3 lệnh tay.

**App báo `Failed to resolve import ...`**
→ Bản mới có thêm thư viện. Tắt hẳn app rồi chạy lại **`start.bat`** (nó tự cài). Vẫn lỗi thì chạy `npm install` trong thư mục cài đặt.

**Nạp thẻ xong app đơ vài giây**
→ Thẻ có Regex Script rất nặng (hàng trăm KB). Bình thường, cứ chờ. Nếu không cần dịch script thì bỏ tick nhóm **Regex** ở bước 3.

**Không kết nối được API / báo lỗi CORS**
→ Kiểm tra lại Base URL & Key, thử bật **CORS Proxy**, hoặc bấm **Test Connection** để xem lỗi cụ thể.

**Gemini báo lỗi 524 / timeout khi mở rộng một mục khổng lồ**
→ Một lượt gọi quá dài nên proxy hết giờ chờ. Dùng **"Chế độ Mở rộng"** cho cả mục (app tự chia phần), hoặc chọn một khối nhỏ hơn để đào sâu.

**Mấy cửa sổ đen nhỏ khi chạy `start.bat` là gì?**
→ Là 3 công cụ phụ (Tạo Card / Tạo Preset / Mod Card). **Đừng tắt** — tắt là mấy tool đó không vào được.

---

## 🔒 Riêng tư

- Chạy **100% trên máy bạn**. API key lưu trong trình duyệt của bạn, **không gửi về bất kỳ máy chủ nào** của chúng tôi.
- Thẻ và bản dịch cũng nằm trên máy bạn.

---

## 🛠 Dành cho người kỹ thuật

Vite + React + TypeScript · Zustand · Next.js (Mod Card) · Vitest.

```bash
npm install        # cài thư viện
npm run dev        # chạy Hub (cổng 5173)
npm run test:run   # chạy test
npm run build      # build production
```

Cổng: Hub/Dịch Card `5173` · Tạo Card `5174` · Tạo Preset `5175` · Mod Card `5176` · Trích Card (file tĩnh, không cần cổng).

Lịch sử thay đổi: xem [CHANGELOG.md](CHANGELOG.md).

---

## 📝 Giấy phép

MIT
