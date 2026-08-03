# frontend-kit — bộ dựng giao diện front-end cho card SillyTavern (bug 192)

Biến một character card thành một **ứng dụng** chạy trong tin nhắn: có màn khởi tạo, có
màn chính với bảng chỉ số, và có **khung chat nhúng nói thẳng với SillyTavern** — người
chơi không đụng tới khung chat gốc.

Cơ chế rút từ card mẫu "Sân Khấu Quỷ Bí", nhưng viết lại gọn hơn 45 lần (58 KB so với
2,66 MB) và tách hẳn phần chung khỏi phần riêng của từng card.

## Đã có sẵn trong app

Từ bug 192 (phần tích hợp), cơ chế này là một **tab trong Tạo Card**:
`MVUZOD Studio → Front-End`. Tab đó suy toàn bộ cấu hình từ schema + InitVar của thẻ đang
mở, xem trước được, và bấm một nút là gắn hai regex script vào thẻ.

Thư mục `frontend-kit/` này giờ chỉ còn là **đường dòng lệnh** cho thẻ mẫu Eldran và cho
việc gỡ lỗi. Nguồn thật nằm trong app: `tao-card/src/lib/frontendKit/`.

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

Nguồn DUY NHẤT nằm trong app (Vite nạp bằng `?raw`, Node đọc bằng `fs` — một bản, không chép):

```
tao-card/src/lib/frontendKit/
  assets/runtime.js       lõi CHUNG: lưu trạng thái, gọi generate, áp biến MVU, vá khối cập nhật
  assets/theme.css        khung giao diện chung
  assets/opening.js       màn khởi tạo, dựng từ cấu hình
  assets/main.js          màn chính: thanh chỉ số + tab + khung chat nhúng
  assets/examples/eldran.config.js   cấu hình viết tay của thẻ mẫu (đường dòng lệnh)
  payloadRules.js         5 luật payload + mô phỏng đường giao hàng của SillyTavern
  presetBuilder.js        2 preset Chat Completion
  schemaToConfig.ts       suy cấu hình từ schema MVUZOD  ⟵ phần tích hợp
  buildPayload.ts         ghép payload + kiểm + dựng regex script
  types.ts                hợp đồng giữa app và bộ front-end
tao-card/src/components/mvuzod/FrontendStudio.tsx   tab Front-End

frontend-kit/
  lib.mjs      lớp vỏ Node, import thẳng từ app
  presets.mjs  lớp vỏ Node
  build.mjs    dựng thẻ mẫu Eldran ra file
  harness/     bàn thử ngoài SillyTavern
  prompts/     prompt tái sử dụng cho thẻ khác + giải thích cơ chế
```

## Kiểm

- `tao-card/src/lib/regexEngine/__tests__/frontendKit192.test.ts` — 22 phép kiểm, nạp
  **chính** `runtime.js` vào một `window` giả rồi gọi hàm thật (không chép tay logic).
- `tao-card/src/lib/frontendKit/__tests__/frontendKit.test.ts` — 33 phép kiểm cho phần
  tích hợp: suy tab/biểu mẫu/bảng đường dẫn từ schema, và payload sống sót qua đường giao
  hàng của SillyTavern.
- Đã chạy thật trên SillyTavern ở `G:/SillyTavern`: mở màn bằng API thật, chơi một lượt
  trong khung chat nhúng, F5 toàn bộ ST, thoát thẻ rồi vào lại — nhật ký, tab đang mở, chữ
  gõ dở, kho đồ, kỹ năng đều còn nguyên, và chat gốc vẫn đúng **1 tin nhắn**.

## Đọc trước khi sửa

`prompts/CO-CHE-FRONT-END-GIAI-THICH.md` — bốn cái bẫy của SillyTavern làm hỏng payload
**âm thầm** (không lỗi đỏ nào), và ba chỗ mô hình hay xuất sai khối cập nhật biến. Tất cả
đều đo được khi chạy thật, không phải suy từ tài liệu.

Bộ quét trong `lib.mjs` chặn cả bốn ngay ở khâu dựng. **Đừng gỡ nó.**
