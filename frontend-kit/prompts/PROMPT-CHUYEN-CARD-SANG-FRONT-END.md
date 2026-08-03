# Prompt: biến một card SillyTavern thành card có giao diện front-end

> **Cách dùng.** Dán toàn bộ phần dưới dấu gạch ngang vào Claude Web (hoặc agent khác),
> đính kèm **file JSON card của bạn**. Không cần đính kèm card mẫu — mọi thứ cần biết đã
> nằm trong prompt này rồi, kể cả những cái bẫy chỉ lộ ra khi chạy thật.
>
> Dùng được cho card **normal**, **MVU/MVUZOD**, và **EJS**.

---

## VAI TRÒ

Bạn là kỹ sư front-end làm giao diện HTML/CSS/JS nhúng trong SillyTavern. Nhiệm vụ: đọc
card JSON tôi đính kèm, rồi trả về **card JSON đã có giao diện front-end hoàn chỉnh**, theo
đúng kiến trúc mô tả bên dưới. Giữ nguyên toàn bộ nội dung roleplay, lorebook, biến, EJS —
chỉ **thêm** giao diện.

Làm hết trong một lượt. Chỗ nào trong card không đủ rõ thì tự chọn phương án hợp lý nhất
dựa trên những gì đọc được, rồi **liệt kê tất cả giả định ở cuối** để tôi kiểm lại. Tuyệt
đối không bịa cấu trúc biến không có căn cứ trong file.

---

## BƯỚC 0 — ĐỌC CARD, TRẢ LỜI 5 CÂU NÀY TRƯỚC

Viết ngắn gọn ở đầu câu trả lời:

1. **Card thuộc loại nào?** normal (không có biến) / MVU / MVUZOD / EJS.
2. **Thẻ cập nhật biến TÊN GÌ?** Đọc trong `data.character_book.entries` (tìm entry có
   `[mvu_update]`, "định dạng đầu ra", hoặc format mẫu) và trong
   `data.post_history_instructions`. Card khác nhau dùng thẻ khác nhau — **cấm đoán, cấm
   chép tên thẻ của card khác**. Card không có biến thì bỏ qua, xem BIẾN THỂ A ở cuối.
3. **Cú pháp cập nhật biến là gì?** `<JSONPatch>` với op replace/delta/insert/remove/move,
   hay lệnh `_.set(...)`, hay kiểu khác.
4. **Cây biến gồm những gì?** Liệt kê đường dẫn đầy đủ từ schema
   (`data.extensions.tavern_helper.scripts` có `registerMvuSchema`, hoặc entry `[initvar]`).
5. **Giá trị khởi tạo mặc định là gì?** Chép nguyên entry `[initvar]` — sẽ cần ở bước 3.

---

## KIẾN TRÚC BẮT BUỘC

### Một tin nhắn duy nhất

Cả ván chơi chỉ dùng **lầu 0**. Văn bản của lầu 0 luôn là lượt trả lời mới nhất của AI.
Không tạo thêm tin nhắn nào trong chat gốc.

### Hai regex script, đều chỉ tác động lên hiển thị

Thêm vào **ĐẦU** mảng `data.extensions.regex_scripts`:

```json
{
  "scriptName": "[FE] Màn Khởi Tạo",
  "findRegex": "<TênThẻMởMàn\\s*/>",
  "replaceString": "```\n<!DOCTYPE html>…toàn bộ trang biểu mẫu…\n```",
  "placement": [2], "markdownOnly": true, "promptOnly": false,
  "disabled": false, "runOnEdit": true, "substituteRegex": 0, "trimStrings": []
}
```

```json
{
  "scriptName": "[FE] Màn Chính",
  "findRegex": "</THẺ_CẬP_NHẬT_BIẾN_CỦA_CARD_NÀY>",
  "replaceString": "</THẺ_CẬP_NHẬT_BIẾN_CỦA_CARD_NÀY>\n```\n<!DOCTYPE html>…toàn bộ giao diện chính…\n```",
  "placement": [2], "markdownOnly": true, "promptOnly": false,
  "disabled": false, "runOnEdit": true, "substituteRegex": 0, "trimStrings": []
}
```

Và đặt `data.first_mes` = `"<TênThẻMởMàn/>"` (chọn tên riêng, đừng trùng thẻ nào đang có).

**THỨ TỰ LÀ SỐNG CÒN.** SillyTavern áp regex hiển thị lần lượt trên cùng một chuỗi. Nhiều
card đã có sẵn script xoá khối cập nhật biến khi hiển thị. Nếu script xoá đó chạy **trước**
"[FE] Màn Chính" thì tới lượt nó chẳng còn gì để bắt ⇒ **không bao giờ có giao diện**. Nên
hai script `[FE]` phải đứng đầu mảng.

Giữ nguyên `replaceString` của Màn Chính **bắt đầu bằng chính thẻ đóng đó** rồi mới tới
khối HTML, để script xoá chạy sau vẫn dọn được phần thô.

### Khung chat nhúng phải gọi thẳng SillyTavern

Trong JS của giao diện chính:

```js
const reply = await generate({
  user_input: userText,
  should_stream: true,
  should_silence: true,
  overrides: { chat_history: { prompts: nhatKyCuaApp } },   // app tự cầm lịch sử
  injects: [{ role: 'system', content: anhChupTrangThai, position: 'in_chat', depth: 0, should_scan: true }],
});
```

Nhận chữ chảy về:

```js
eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, (full, genId) => { … });
```

**Cấm** dùng `triggerSlash('/send …')`, cấm ghi vào ô nhập của chat gốc, cấm
`createChatMessages` cho từng lượt. `generate` không tạo tin nhắn nào — đó chính là điều
làm nên "chat thật trong giao diện".

### Biến MVU phải TỰ tay áp

MagVarUpdate chỉ móc vào `MESSAGE_SENT` / `MESSAGE_RECEIVED`, mà `generate` không phát hai
sự kiện đó. Nên sau mỗi lượt:

```js
const cu  = Mvu.getMvuData({ type: 'message', message_id: 0 });
const moi = await Mvu.parseMessage(replyText, cu);
await Mvu.replaceMvuData(moi, { type: 'message', message_id: 0 });
```

Rồi ghi lượt trả lời xuống lầu 0 để lần sau mở lại còn dựng đúng màn hình:

```js
await setChatMessages([{ message_id: 0, message: replyText }], { refresh: 'none' });
```

`refresh:'none'` khi đang chơi (khỏi nạp lại iframe, khỏi mất mạch streaming);
`refresh:'all'` **chỉ** ở lượt mở màn, vì đó chính là lúc cần đổi từ biểu mẫu sang giao diện chính.

### Lưu trạng thái vào BIẾN CHAT, không dùng IndexedDB

```js
const table = getVariables({ type: 'chat' });
table.__fe = { log, ui, started };          // đặt dưới một khoá riêng, đừng đổ ra gốc
replaceVariables(table, { type: 'chat' });
```

Biến chat nằm trong chính file chat nên sống qua F5, thoát thẻ, tắt SillyTavern, và đi theo
khi xuất chat sang máy khác. IndexedDB thì mất khi xoá cache trình duyệt.

Phải lưu **cả bốn** thứ: nhật ký hội thoại, tab đang mở, khung chat đang đóng hay mở, và
**chữ người chơi đang gõ dở**.

---

## BƯỚC 3 — BỘ MẶC ĐỊNH CỦA BIẾN (đừng bỏ qua)

Đo được trên SillyTavern thật: lúc vừa mở thẻ ra, biến của lầu 0 vẫn **rỗng** — MVU chưa
chạy khởi tạo initvar vì nó chờ sự kiện tin nhắn, mà lầu mở màn thì chưa có sự kiện nào.

Nếu màn khởi tạo cứ thế ghi hồ sơ lên một object rỗng thì mọi **mảng** (kho đồ, kỹ năng,
quan hệ) sẽ **không tồn tại**, và lệnh `insert` của AI ở ngay lượt sau sẽ trượt — mất sạch
vật phẩm khởi đầu mà không báo gì.

Nên: chép nguyên `[initvar]` vào một hằng `defaultStat` trong code, và lúc bắt đầu thì
`deepDefaults(defaultStat, stateHienCo)` trước khi ghi hồ sơ lên.

---

## BƯỚC 4 — VÁ KHỐI CẬP NHẬT BIẾN CỦA AI

Đo với Gemini 3.1 Pro, lượt chạy thật đầu tiên sai **cùng lúc ba chỗ**: thiếu hẳn cặp thẻ
`<JSONPatch>`, dùng `"op": "add"` thay vì `"insert"`, và viết `/Kho đồ/0` trong khi biến
tên là `/Kho Đồ`. MVU bỏ qua sạch, không một lời phàn nàn.

Nên viết một hàm `normalizeUpdateBlock(text, stat)` làm bốn việc:

1. Không có `<JSONPatch>` nhưng có mảng JSON trần → bọc lại.
2. Đổi tên thao tác theo bảng đồng nghĩa:
   `add|append|push|create → insert` · `set|update|assign → replace` ·
   `delete|unset → remove` · `increment|inc → delta`.
3. Dò **khoá thật** trong `stat_data` để sửa hoa/thường và dấu tiếng Việt của từng đoạn
   đường dẫn (so sánh sau khi bỏ dấu + hạ chữ thường). Chỉ số vượt độ dài mảng thì đổi
   thành `-`.
4. Đường dẫn có gốc **không tồn tại** trong `stat_data` ⇒ AI bịa biến ⇒ **báo ra màn hình**,
   đừng im lặng.

Và trong ảnh chụp trạng thái gửi kèm mỗi lượt, hãy liệt kê thẳng **bảng đường dẫn hợp lệ**
của card. Rẻ hơn nhiều so với việc người chơi ngồi đoán vì sao chỉ số không nhúc nhích.

---

## ⚠️ BỐN LUẬT VIẾT CODE — VI PHẠM LÀ HỎNG ÂM THẦM

Payload bị nhét vào `replaceString` của regex, nên SillyTavern **sửa nội dung của bạn** trên
đường ra iframe. Cả bốn lỗi dưới đây đều **không sinh lỗi đỏ nào**: giao diện vẫn hiện, chỉ
là sai hoặc trắng trơn.

**Luật 1 — không để dấu đô-la đứng trước chữ số, cũng không đứng trước dấu bé hơn.**
`regex/engine.js:422` chạy `replaceAll(/\$(\d+)|\$<([^>]+)>/g, …)` lên chuỗi thay thế.
`str.replace(re, '<b>$1</b>')` sẽ mất `$1`. Viết `str.replace(re, (m, a) => '<b>' + a + '</b>')`.

**Luật 2 — không để hai dấu ngoặc nhọn liền nhau** (trừ macro cố ý), vì cuối cùng ST còn
chạy `substituteParams` lên toàn bộ chuỗi.

**Luật 3 — không viết thực thể HTML thẳng vào code.** Showdown escape dấu và trong khối
code, `script.js:1889` đổi ngược lại, trình duyệt giải mã nốt ⇒ thực thể thành ký tự thật.
Lỗi thật đã gặp: thực thể của dấu nháy đơn biến thành **ba dấu nháy liền nhau** ⇒
`SyntaxError` ⇒ trắng màn hình. Viết:

```js
var A = String.fromCharCode(38);
var ENT = { lt: A + 'lt;', gt: A + 'gt;', quot: A + 'quot;', apos: A + '#39;' };
```

**Luật 4 — không để cụm ba dấu huyền ở BẤT KỲ ĐÂU trong payload.** `script.js:1844` dùng
một regex bọc `<q>` quanh mọi cặp nháy kép, và dùng khối ba dấu huyền để che vùng an toàn.
Cụm thứ ba làm khối che **đóng sớm**, và toàn bộ phần sau bị bọc `<q>` giữa các cặp nháy
kép trong JS ⇒ vỡ cú pháp. Cần thì dựng bằng `String.fromCharCode(96,96,96)`.

**Luật 5 — payload không được chứa nguyên văn thẻ mồi của script kia.** Nếu trang biểu mẫu
có nhắc chuỗi `</ThẻCậpNhậtBiến>` (kể cả trong chú thích), thì script "[FE] Màn Chính" sẽ
khớp ngay vào đó và nhồi cả màn hình chính vào giữa trang biểu mẫu.

**Tự kiểm trước khi trả về.** Quét payload bằng bốn biểu thức này, phải ra **rỗng** hết:

```
/\$\d/        /\$</        /\{\{(?!user\}\}|char\}\})/        /```/
/&(?:[a-zA-Z]{2,8}|#\d{2,5});/
```

---

## GIAO DIỆN CẦN CÓ NHỮNG GÌ

**Màn Khởi Tạo** — biểu mẫu nhập hồ sơ:
- các trường bám đúng schema của card (dropdown lấy từ `z.enum`, số có min/max);
- vài lựa chọn bối cảnh mở màn dạng thẻ bấm;
- một ô ghi chú tự do;
- lưu bản nháp vào biến chat sau mỗi lần gõ, để lỡ tải lại không mất;
- nút "Bắt đầu ván chơi" làm đúng 5 việc, theo thứ tự:
  1. lấp bộ mặc định rồi ghi **thẳng** giá trị biểu mẫu vào `stat_data` (không nhờ AI đặt hộ
     — nhờ AI thì gần như lượt nào cũng sai vài trường);
  2. `generate` với lời nhắc mở màn;
  3. áp khối cập nhật biến;
  4. lưu nhật ký;
  5. `setChatMessages([{message_id: 0, message: reply}], {refresh: 'all'})`.

**Màn Chính** — một màn hình duy nhất gồm:
- thanh đầu: tên nhân vật, các chip trạng thái, thanh chỉ số dạng bar;
- dải tab cho từng nhóm biến (nhân vật / kho đồ / kỹ năng / quan hệ / thế giới…),
  **mọi trường trong schema đều phải xuất hiện ở đâu đó**;
- **khung chat nhúng**: danh sách lời kể, ô nhập, nút Gửi / Dừng / Kể lại lượt này /
  Chơi lại từ đầu, vài nút hành động gợi ý;
- khung chat **thu gọn / mở lại được**, và trạng thái đó phải được lưu;
- lượt lỗi thì trả chữ về ô nhập và gỡ bong bóng vừa thêm, đừng để nhật ký lệch.

Self-contained: không phụ thuộc file ngoài (CDN công khai thì được, nhưng không cần).

---

## ĐẦU RA

1. **File JSON card hoàn chỉnh** — dựa trên card tôi gửi, thêm 2 regex script `[FE]` ở đầu
   mảng, sửa `first_mes`, giữ nguyên mọi thứ khác.
2. **Bản tóm tắt**: trả lời 5 câu ở BƯỚC 0; liệt kê **trường biến nào đã lên UI, trường nào
   chưa và vì sao**; xác nhận đã tự quét 5 biểu thức ở trên và đều rỗng.
3. **Danh sách giả định** đã đưa ra.

---

## BIẾN THỂ A — card KHÔNG có hệ biến (normal)

Không có thẻ cập nhật biến thì không có mồi cho "[FE] Màn Chính". Làm thế này:

- Bảo AI kết mỗi lượt bằng một thẻ do bạn tự đặt, VD `<Scene/>`, qua
  `data.post_history_instructions`.
- `findRegex` của Màn Chính = `<Scene\s*/>`.
- Bỏ hết phần MVU; trạng thái game (nếu muốn có) do chính app quản trong biến chat.

## BIẾN THỂ B — card EJS

EJS chạy ở tầng dựng prompt, front-end chạy ở tầng hiển thị — **không đụng nhau**, giữ
nguyên toàn bộ entry EJS. Hai điều cần để ý:

- Entry EJS đọc biến qua `getvar('stat_data.…')`; vì app ghi biến vào lầu 0 nên chúng đọc
  đúng, không cần sửa gì.
- Nếu có entry gọi `activateRegex('tên script')`, kiểm lại tên đó **có thật** trong
  `regex_scripts` không. Card tôi từng gặp gọi tới một script không tồn tại, nằm trong
  try/catch nên nuốt lỗi im lặng suốt.
