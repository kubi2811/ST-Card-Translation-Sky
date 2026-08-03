# Cơ chế Front-End cho card SillyTavern — giải thích dễ hiểu

> Đây là bản giải thích cho người đọc, không phải prompt. Muốn nhờ AI làm giúp thì dùng
> file `PROMPT-CHUYEN-CARD-SANG-FRONT-END.md` bên cạnh.
>
> Mọi con số và mọi cái bẫy trong file này đều **đo được trên SillyTavern thật**, không
> phải suy từ tài liệu. Chỗ nào là đo, chỗ nào là suy — đều ghi rõ.

---

## 1. Ý tưởng trong một câu

> Tin nhắn của SillyTavern chỉ là cái hộp. Cái người chơi nhìn thấy là một trang web
> hoàn chỉnh do regex của thẻ tráo vào chỗ tin nhắn đó, và trang web ấy tự gọi AI lấy.

Card mẫu "Sân Khấu Quỷ Bí" làm đúng như vậy: `first_mes` của nó vỏn vẹn một dòng
`<开局>…</开局>`, còn giao diện thật nằm trong `replaceString` của một regex script —
riêng script màn hình chính đã nặng **2,66 MB**.

---

## 2. Bốn mảnh ghép

### Mảnh 1 — Regex tráo màn hình

Thẻ có **hai** regex script, cả hai đều chỉ tác động lên *hiển thị*:

| Script | Bắt cái gì | Thay bằng |
|---|---|---|
| Màn Khởi Tạo | thẻ đánh dấu trong `first_mes`, VD `<EldranBoot/>` | cả trang HTML biểu mẫu |
| Màn Chính | thẻ đóng khối cập nhật biến, VD `</UpdateVariable>` | cả trang HTML giao diện game |

Cấu hình bắt buộc của cả hai:

```json
{ "placement": [2], "markdownOnly": true, "promptOnly": false }
```

`markdownOnly: true` = chỉ chạy ở luồng hiển thị. `promptOnly: false` = **không bao giờ**
lọt vào prompt gửi cho AI. Thiếu cặp cờ này thì mỗi lượt bạn nhét vài trăm nghìn token
HTML ngược vào ngữ cảnh.

**Chuyển màn hoạt động thế nào.** Không có "router" nào cả. Lúc mở thẻ, lầu 0 chứa
`<EldranBoot/>` → regex thứ nhất khớp → hiện biểu mẫu. Bấm "Bắt đầu", app ghi đè nội dung
lầu 0 bằng lượt trả lời của AI (có chứa `</UpdateVariable>`) → giờ regex thứ nhất không
khớp nữa, regex thứ hai khớp → hiện giao diện chính. **Đổi màn hình = đổi nội dung tin nhắn.**

### Mảnh 2 — Khung chat nhúng nói thẳng với SillyTavern

Đây là chỗ khác biệt thật sự so với "dán chữ từ form vào khung chat gốc".

```js
const reply = await generate({
  user_input: 'điều người chơi vừa gõ',
  should_stream: true,
  overrides: { chat_history: { prompts: nhatKyCuaApp } },
  injects: [{ role: 'system', content: anhChupTrangThai, position: 'in_chat', depth: 0 }],
});
```

`generate` chạy **đúng pipeline sinh của SillyTavern** — preset đang bật, world info,
lorebook, EJS, tất cả — nhưng **không tạo tin nhắn nào trong chat gốc**. Đo được: chơi
xong mấy lượt, `SillyTavern.getContext().chat.length` vẫn bằng **1**.

Chữ chảy về theo sự kiện:

```js
eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, (full, genId) => { … });
```

### Mảnh 3 — Biến MVU phải TỰ tay áp

**Đây là chỗ dễ sai nhất và không tài liệu nào nói.**

Đọc thẳng `bundle.js` của MagVarUpdate: nó chỉ móc vào `tavern_events.MESSAGE_SENT` và
`MESSAGE_RECEIVED`. Mà `generate` **không phát hai sự kiện đó**. Nghĩa là đi đường này thì
MVU sẽ không bao giờ tự cập nhật biến.

Nên app phải tự gọi, bằng API công khai của chính extension:

```js
const cu  = Mvu.getMvuData({ type: 'message', message_id: 0 });
const moi = await Mvu.parseMessage(vanBanAiTraVe, cu);
await Mvu.replaceMvuData(moi, { type: 'message', message_id: 0 });
```

### Mảnh 4 — Lưu trạng thái

| Thứ cần giữ | Cất ở đâu | Sống qua được |
|---|---|---|
| Chỉ số game (`stat_data`) | biến của lầu 0 | mọi thứ, đi kèm file chat |
| Nhật ký hội thoại, tab đang mở, khung chat đóng/mở, chữ đang gõ dở | **biến chat** (`getVariables({type:'chat'})`) | F5, thoát thẻ, tắt SillyTavern, copy file chat sang máy khác |

Card mẫu dùng IndexedDB (Dexie) cho nhật ký. Nó chạy được, nhưng IndexedDB nằm ở trình
duyệt: xoá cache là mất, đổi máy là mất, xuất file chat mang đi cũng không mang theo được.
**Biến chat nằm trong chính file chat** nên chắc hơn hẳn — bộ này chọn biến chat.

---

## 3. Bốn cái bẫy đã đo được (và mất bao lâu để tìm ra)

Bốn lỗi dưới đây đều **không có lỗi đỏ nào** ở tầng SillyTavern. Giao diện cứ hiện ra,
chỉ là sai. Đó là lý do phải chạy thật chứ không thể chỉ đọc code mà xong.

### Bẫy 1 — SillyTavern ăn mất `$1` và `{{…}}` trong code của bạn

`regex/engine.js:419-444`: trước khi chèn, ST chạy
`replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, …)` rồi `substituteParams(...)`.

Nên trong JS của bạn:
- `str.replace(re, '<b>$1</b>')` → `$1` **bốc hơi**, thành `<b></b>`.
  Phải viết `str.replace(re, (m, a) => '<b>' + a + '</b>')`.
- mọi macro hai ngoặc nhọn cũng bị nuốt.

### Bẫy 2 — Thực thể HTML viết thẳng sẽ bị giải mã

Đường đi: showdown escape dấu và trong khối code → `script.js:1889` cố ý đổi ngược
`&amp;` về `&` → trình duyệt giải mã nốt.

Hậu quả thật đã gặp: hàm `esc()` của tôi biến thành vô dụng, và thực thể của dấu nháy đơn
biến thành **ba dấu nháy liền nhau** ⇒ `SyntaxError` ⇒ **cả giao diện trắng trơn**.

Cách viết đúng:

```js
var A = String.fromCharCode(38);          // dấu và
var ENT = { lt: A + 'lt;', gt: A + 'gt;', quot: A + 'quot;', apos: A + '#39;' };
```

### Bẫy 3 — Ba dấu huyền lạc trong code làm vỡ nửa sau giao diện

`script.js:1844` có một regex bọc `<q>` quanh mọi cặp nháy kép, và nó dùng các nhánh
`` ```…``` ``, `` ``…`` ``, `` `…` `` để **che** những vùng không được đụng tới.

Payload của bạn được bọc trong một khối ba dấu huyền. Nếu bên trong code có thêm **một cụm
ba dấu huyền nữa** (của tôi là `.replace(/^\s*```[a-zA-Z]*$/gm, '')`), khối che **đóng sớm
tại đó**, và toàn bộ phần sau bị bọc `<q>` quanh từng cặp nháy kép:

```js
// mình viết:
querySelector('[data-field="' + f.key + '"]')
// tới trình duyệt thành:
querySelector('[data-field=<q>"' + f.key + '"</q>]')
```

⇒ vỡ cú pháp ⇒ giao diện trắng. Dựng nó bằng `String.fromCharCode(96,96,96)`.

### Bẫy 4 — Payload chứa nguyên văn thẻ mồi của script kia

Docblock của tôi có nhắc tên thẻ `</UpdateVariable>`. Script "Màn Chính" chạy ngay sau
script "Màn Khởi Tạo", thấy cái thẻ đó **nằm trong chú thích vừa được chèn vào**, và nhồi
nguyên màn hình chính vào giữa một khối chú thích JS. Hai màn hình chồng lên nhau.

> Cả bốn bẫy giờ đã có bộ quét chặn ngay ở khâu dựng (`frontend-kit/lib.mjs → PAYLOAD_RULES`
> và `scanTriggers`). Đừng gỡ chúng đi.

---

## 4. Ba chỗ AI hay làm sai (đo bằng Gemini 3.1 Pro)

Lượt chạy thật đầu tiên, mô hình sai **cùng lúc ba chỗ** trong khối cập nhật biến:

| Sai | Nó viết | Phải là |
|---|---|---|
| thiếu hẳn cặp thẻ | `<UpdateVariable>[…]</UpdateVariable>` | phải có `<JSONPatch>` bọc mảng |
| tên thao tác | `"op": "add"` | `"op": "insert"` |
| hoa/thường đường dẫn | `/Kho đồ/0` | `/Kho Đồ/-` |

MVU bỏ qua sạch, **không một lời phàn nàn**: giao diện lên đẹp, chỉ có điều vật phẩm, kỹ
năng, quan hệ khởi đầu biến mất hết.

Lượt sau nó lại **bịa hẳn một biến không tồn tại** (`/Thời gian`), và đồng hồ đứng im.

Nên runtime có `normalizeUpdateBlock()`: bọc lại thẻ thiếu, đổi tên thao tác theo bảng
đồng nghĩa, dò tên biến thật để sửa hoa/thường và dấu, và **báo ra màn hình** khi AI ghi
vào biến không có trong thẻ — thay vì để người chơi ngồi đoán vì sao chỉ số không nhúc nhích.

---

## 5. Điều kiện để chạy được

1. Bật extension **Trợ Thủ Tavern** (JS-Slash-Runner).
2. Bật **script nhúng của thẻ** (biểu tượng Trợ Thủ Tavern → tab Script) — thẻ cần MVU.
3. Cho phép **regex của thẻ** chạy (SillyTavern hỏi lúc import; hoặc Settings → Regex).
4. `Settings → User Settings → Encode Tags` phải **tắt** (mặc định đã tắt). Bật lên thì mọi
   dấu bé hơn bị escape và bạn sẽ thấy code HTML hiện ra dưới dạng chữ.

Thiếu (2) thì giao diện vẫn chạy nhưng chỉ số đứng yên — bộ này sẽ hiện đúng câu cảnh báo
đó chứ không im lặng.

---

## 6. So sánh nhanh với card mẫu

| | Sân Khấu Quỷ Bí | Bộ này (STFE) |
|---|---|---|
| Tráo màn hình bằng regex hiển thị | ✅ | ✅ |
| Khung chat nhúng gọi thẳng `generate` | ✅ | ✅ |
| Nhật ký lưu ở | IndexedDB (Dexie) | biến chat (đi theo file chat) |
| Biến MVU | tự quản, có thêm một lượt gọi AI riêng để tính biến | gọi thẳng `Mvu.parseMessage` |
| Vá khi AI xuất sai định dạng | không | có, và báo ra màn hình |
| Cỡ payload | 2,66 MB | ~58 KB |
| Đổi sang card khác | phải sửa trong khối 2,66 MB | viết lại **một** file config |
