# frontend-kit — bộ dựng giao diện front-end cho card SillyTavern (bug 192)

Biến một character card thành một **ứng dụng** chạy trong tin nhắn: có màn khởi tạo, có
màn chính với bảng chỉ số, và có **khung chat nhúng nói thẳng với SillyTavern** — người
chơi không đụng tới khung chat gốc.

Cơ chế rút từ card mẫu "Sân Khấu Quỷ Bí", nhưng viết lại gọn hơn 45 lần (58 KB so với
2,66 MB) và tách hẳn phần chung khỏi phần riêng của từng card.

## Dùng

```bash
node frontend-kit/build.mjs
```

Xuất ra `bug/192/output/`: 1 card + 2 preset.

```bash
node frontend-kit/harness/serve.mjs      # http://127.0.0.1:8791/opening  và  /main
```

Bàn thử chạy **chính** payload vừa nhét vào card, kèm bộ giả lập API SillyTavern — bấm
được, gửi lượt được, xem được biến đổi, không cần API key và không đụng chat thật.

## Cấu trúc

```
src/runtime.js          lõi CHUNG: lưu trạng thái, gọi generate, áp biến MVU, vá khối cập nhật
src/theme.css           khung giao diện chung
src/opening.js          màn khởi tạo, dựng từ config
src/main.js             màn chính: thanh chỉ số + tab + khung chat nhúng
src/eldran.config.js    ⟵ FILE DUY NHẤT dính tới card. Port sang card khác = viết lại file này
lib.mjs                 ghép trang, quét luật payload, mô phỏng đường giao hàng của ST
presets.mjs             2 preset Chat Completion
build.mjs               dựng + gắn vào card
harness/                bàn thử ngoài SillyTavern
prompts/                prompt tái sử dụng cho card khác + giải thích cơ chế
```

## Kiểm

- `tao-card/src/lib/regexEngine/__tests__/frontendKit192.test.ts` — 22 phép kiểm, nạp
  **chính** `runtime.js` vào một `window` giả rồi gọi hàm thật (không chép tay logic).
- Đã chạy thật trên SillyTavern ở `G:/SillyTavern`: mở màn bằng API thật, chơi một lượt
  trong khung chat nhúng, F5 toàn bộ ST, thoát thẻ rồi vào lại — nhật ký, tab đang mở, chữ
  gõ dở, kho đồ, kỹ năng đều còn nguyên, và chat gốc vẫn đúng **1 tin nhắn**.

## Đọc trước khi sửa

`prompts/CO-CHE-FRONT-END-GIAI-THICH.md` — bốn cái bẫy của SillyTavern làm hỏng payload
**âm thầm** (không lỗi đỏ nào), và ba chỗ mô hình hay xuất sai khối cập nhật biến. Tất cả
đều đo được khi chạy thật, không phải suy từ tài liệu.

Bộ quét trong `lib.mjs` chặn cả bốn ngay ở khâu dựng. **Đừng gỡ nó.**
