# Lõi Lorebook dùng chung — khảo sát, việc đã làm, việc còn lại

> Mục tiêu user đặt ra: *"xây dựng lõi thống nhất để áp dụng cho các tính năng tạo Lorebook.
> Đồng bộ hoá chất lượng cao cho tất cả, dễ nâng cấp toàn diện khi sửa lõi chung, nhưng vẫn giữ
> được tính độc lập và khả năng tạo ra các nội dung/góc nhìn xung đột, đa dạng cho từng trường
> hợp cụ thể."*

Viết sau bug 150 (`007e2c5`).

---

## 0. ĐÍNH CHÍNH — bản đầu của tài liệu này đã SAI

Bản đầu kết luận *"4/6 nơi sinh entry không dùng module chung nào"* và đề xuất một kiến trúc ba
tầng (~1.000 dòng giàn giáo) để sửa. **Kết luận đó dựa trên phép đo hỏng.**

Sai ở đâu: đo bằng cách grep vào `ai/autoCreatorPrompts.ts` và `wikiImport/entryGen.ts` — nhưng
hai file đó **chỉ dựng prompt**. Nơi sinh entry thật là `ai/autoCreatorPipeline.ts` và
`wikiImport/index.ts`. Đo đúng chỗ thì bức tranh ngược hẳn.

**Cổng ra chung đã tồn tại từ trước: `materializeEntry` trong `lib/converters/cardDefaults.ts`.**
Chín nơi đang gọi nó: Auto Creator, AI Sinh Batch, Cào wiki, Minh Nguyệt, agentLoop,
lorebookRefiner, documentChunker, systemEntriesBuilder, cardTemplates. Và nó **ép cứng**
`prevent_recursion` + `exclude_recursion` = true không ngoại lệ, kèm sẵn comment
`// ENFORCE: đệ quy luôn bật`.

Bài học: đừng đo độ phủ kiến trúc bằng grep tên file mà không xác minh file đó có đúng vai trò
mình tưởng không.

---

## 1. Hiện trạng thật

| Đường sinh entry | Qua `materializeEntry`? | Ghi chú |
|---|---|---|
| Auto Creator (`autoCreatorPipeline`) | ✅ | |
| AI Sinh Batch (`batchGenerator`) | ✅ | |
| Cào wiki (`wikiImport/index`) | ✅ | |
| Minh Nguyệt, agentLoop, lorebookRefiner, documentChunker, systemEntries, cardTemplates | ✅ | |
| Từ truyện (`storyDeepScan`, bug 150) | ✅ *(vừa nối — mục 2.2)* | trước đây tự chép |
| Xuất worldbook (`export/worldbookGenerator`) | ❌ | là bộ **xuất**, không sinh entry mới |

Hạ tầng chất lượng dùng chung cũng đã có sẵn (~2.300 dòng): `worldbookConfig`,
`entryGroupAnalyzer`, `lorebookCategorizer`, `worldbookHealthCheck`, `tagManager`,
`deduplicator`, `coherenceManager`.

**Kết luận: không cần xây lõi mới.** Lõi có rồi và được dùng rộng. Chỉ còn vài lỗ hổng cụ thể.

---

## 2. Việc ĐÃ LÀM

### 2.1. AI không còn được đè lên preset ở trường phụ thuộc cấu trúc thẻ

Lỗ hổng: `materializeEntry` xếp ưu tiên `ai.constant ?? preset...` — **AI thắng preset**. Trong
khi prompt vẫn ghi `CẤU HÌNH BẮT BUỘC: constant=true, selective=false` rồi tin AI làm đúng. Tức
là *nhờ vả* chứ không phải *ép*.

Vì sao đây là lỗi thật chứ không phải chuyện thẩm mỹ: `constant`/`selective` phụ thuộc **cấu trúc
thẻ**, không phụ thuộc nội dung entry. Cùng category `character_detail`:
- thẻ ĐƠN → `constant: true` (quy luật thép, luôn thường trú);
- thẻ NHIỀU nhân vật → `constant: false` (kích hoạt theo từ khoá).

AI chỉ nhìn thấy nội dung **một** entry, nó không biết thẻ này có mấy nhân vật cốt lõi. Hệ preset
thì biết. Để AI quyết là giao việc cho người không có dữ liệu để quyết.

Đã làm:
- `lockedFieldsOf(category)` trong `worldbookConfig.ts` — mặc định khoá `constant` + `selective`;
  riêng `secondary_explanation` khoá thêm `position`/`depth`/`role` vì **D0 chính là định nghĩa
  bởi ba trường đó** (AI đổi depth thì entry hết là D0, chỉ còn cái tên — hỏng âm thầm, vì entry
  vẫn hợp lệ và vẫn nạp được).
- `materializeEntry` tôn trọng khoá. Thứ tự mới:
  - trường bị khoá: **người dùng > preset** (bỏ qua AI)
  - trường tự do: **AI > người dùng > preset > mặc định**
- Khoá chỉ chặn **AI**, không chặn **người dùng** — `config.defaultDepth/Role/Position` vẫn thắng.
- `category: 'custom'` không khoá gì (user tự cầm lái).

### 2.2. `storyDeepScan` dùng chung phần ống nước, giữ riêng phần phân loại

Bug 150 tự dựng `LorebookEntry` từ đầu. Kết quả **đang đúng**, nhưng đó là bản chép của phần ống
nước — ai sửa `materializeEntry` sau này (thêm cờ ST mới, đổi cách đồng bộ `disable`/`enabled`)
thì "Tạo thẻ từ truyện" không được hưởng, và lệch dần một cách âm thầm. Đúng cái "dễ nâng cấp
toàn diện" mà user muốn.

**Điều KHÔNG gộp — và đây là phần quan trọng:** bảng phân loại. `storyDeepScan` dùng taxonomy
riêng bám chuẩn worldbook của user (`bug/150/chinh lorebook.txt`): Group 1-5 →
meta/worldview/timeline/character/faction/location, order 900/800/200/150/100. Taxonomy của
`worldbookConfig` thì xoay quanh thẻ đơn / nhiều nhân vật. **Hai bảng phục vụ hai mục đích khác
nhau; ép dùng chung là phá mất cái đúng của cả hai.**

Nên đã thêm `MaterializeConfig.placement`: caller tự quyết cơ học, bỏ qua cả preset lẫn AI, nhưng
vẫn hưởng ống nước chung (chống đệ quy, cờ `disable`, `DEFAULT_ENTRY_EXT`, `display_index`).

→ **Phần phân loại được phép khác nhau. Phần ống nước dùng chung.** Đó chính là "vừa thống nhất
vừa giữ độc lập" ở dạng cụ thể nhất, thay vì một tầng trừu tượng mới.

Một hồi quy suýt lọt, bị test bắt: chuỗi `position` của V3. `storyDeepScan` ghi `'before_char'`
cho entry @depth, còn `materializeEntry` suy ngầm ra `'after_char'`. Đã thêm
`placement.positionName` để caller giữ nguyên chuỗi của mình, và khoá lại bằng test.

### 2.3. `materializeEntry` từ chỗ 0 test → 12 test

Hàm dùng chung nhất trong toàn bộ đường sinh lorebook mà **trước đó không có một test nào**.
Nay phủ: ép chống đệ quy, khoá preset theo thẻ đơn/nhiều, D0 giữ nguyên định nghĩa, khoá không
chặn user, trường tự do vẫn để AI quyết, `custom` không khoá, cờ `disable`, đường `placement`.

---

## 3. Việc CÒN LẠI — chưa làm, và vì sao chưa

### 3.1. Provenance (nên làm khi gặp thật)

Chạy Auto Creator xong rồi chạy Cào wiki lên cùng một card → **đẻ entry trùng**, vì không gì cho
biết entry nào do đâu sinh ra. Đây là lỗ hổng thật, gây đau thật, và chưa nơi nào giải quyết.

Cách làm khi cần: thêm `source` + `topicKey` vào entry. Chạy lại cùng một tính năng thì cập nhật
đúng entry của chính nó; tính năng khác ghi vào cùng chủ đề thì không đè, mà đề xuất cho user
quyết. **Máy không bao giờ tự xoá lore của ai.**

Chưa làm vì: đụng dữ liệu card đã có (card cũ không mang provenance), cần đường di trú, và nên
thiết kế dựa trên ca hỏng thật thay vì tưởng tượng.

### 3.2. `perspective` — KHÔNG làm

Bản đầu đề xuất trường `perspective` để bộ kiểm nhất quán phân biệt "hai phe kể khác nhau về cùng
trận đánh" (lore hay, phải giữ) với "mâu thuẫn thật" (phải sửa).

Ý tưởng vẫn đúng về mặt khái niệm, **nhưng chưa có bằng chứng vấn đề này đã xảy ra.** Chưa thấy
báo cáo nào về việc bộ kiểm báo nhầm xung đột cố ý thành lỗi. Thêm trường vào mô hình dữ liệu vì
một vấn đề chưa xảy ra là cách chắc chắn để tự chuốc nợ. Khi nào gặp thật thì làm, lúc đó sẽ có
ca cụ thể để thiết kế cho đúng.

### 3.3. Kiến trúc ba tầng (lăng kính / sổ đăng ký / test tuân thủ / lint) — KHÔNG làm

Khoảng hơn 1.000 dòng giàn giáo để hình thức hoá một thứ **đang chạy tốt sẵn**. `materializeEntry`
đã là cổng ra chung; thêm một tầng trừu tượng lên trên nó chỉ đổi chỗ phức tạp chứ không giảm.
