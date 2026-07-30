# Kiểm kê hệ thống Dịch Card (bug 164)

Quy trình bug 164 yêu cầu: **trước khi sửa dòng code nào**, liệt kê đã đọc file nào, và với mỗi hạng
mục 0–8 kết luận "đã đủ" hoặc "lỗ hổng cụ thể tại `<file>`:`<hàm>`". Đây là bản kết luận đó.

## Đã đọc

| File | Dòng | Đọc để trả lời |
|---|---:|---|
| `src/utils/masterPrompt.ts` | 1227 | HM1 (`fieldGroupToFieldType`), HM2 (luật EJS), HM0 (danh sách tên hàm) |
| `src/utils/ejsSync.ts` | 1834 | HM0 (đồng bộ tên mục qua getwi/activewi) |
| `src/utils/macroResolver.ts` | 144 | HM0 (bộ macro thật app hỗ trợ) |
| `src/utils/stPreview.ts` | 516 | HM0 (`TH_FUNCTION_NAMES`) |
| `src/hooks/useTranslation.ts` | 5046 | HM3 (A/B/C), HM6 (gọi ghi TM lúc đa luồng) |
| `src/utils/runWorkerPool.ts` · `loopController.ts` | 82 · 202 | HM3 (đa luồng) |
| `src/presetTranslate/regexScriptPass.ts` | 62 | HM4 |
| `src/components/StPreviewModal.tsx` · `CardPreview.tsx` | 277 · — | HM5 |
| `src/utils/translationMemory.ts` | 272 | HM6 |
| `src/presetTranslate/consistencyPass.ts` | 54 | HM0, HM7 |
| `src/presetTranslate/macroGuard.ts` | 69 | HM7 |
| `src/presetTranslate/presetLabelSync.ts` | 310 | HM0 |
| `src/components/VerifyPanel.tsx` · `src/utils/aiVerify.ts` | 1297 · — | HM5, HM7 |

## Kết luận từng hạng mục

### HM0 — Phân loại nội dung & đồng bộ Nhóm B → **3 lỗ hổng**

**0-A. `consistencyPass.ts:21-22` — `applyVarRenames` chỉ phủ 2 trong 7 macro.**
Bộ macro app tự khai (và `macroResolver.ts:47-99` xử đủ) gồm 7: `setvar`, `getvar`, `addvar`,
`incvar`, `decvar`, `setglobalvar`, `getglobalvar`. Nhưng hàm đổi tên tất định chỉ thay
`{{setvar::X}}` và `{{getvar::X}}`. Hệ quả: biến được dịch thì vế `setvar` đổi tên còn
`{{addvar::好感度::1}}` giữ nguyên chữ Hán ⇒ chỗ ghi và chỗ tăng trỏ vào **hai biến khác nhau**,
chạy không lỗi mà số liệu sai. Đúng ví dụ mà bug 164 nêu sẵn ("1 loại macro không nằm trong
`applyVarRenames`").

**0-B. `TH_FUNCTION_NAMES` KHÔNG phải nguồn tham chiếu duy nhất — vì nó không được export.**
`stPreview.ts:190` khai nó là `const` cục bộ, chỉ nội suy vào chuỗi HTML preview (dòng 236, 337).
Không file nào khác dùng được. Trong khi đó `masterPrompt.ts:512-516` **liệt kê tay** ~10 tên, và 3
tên trong đó **không tồn tại** trong API thật: `setVariable`, `getVariable`, `sendMessage` (tên thật
là `setVariables` / `getVariables`; không có `sendMessage`). Tức là đang dạy AI bảo vệ một tập nhỏ và
sai một phần, đúng cái mà bug 164 cấm ("không được tự liệt kê tay 1 danh sách khác trùng lặp hoặc
thiếu sót").

**0-C. `macroGuard.ts:15-16` — hàng rào phát hiện lệch cũng mù 5 macro đó.**
`SETVAR_RE`/`GETVAR_RE` chỉ khớp `{{setvar::`/`{{getvar::`. `{{setglobalvar::` không khớp
`{{setvar::` (khác chuỗi), nên 5 macro kia không được đếm. Cộng với 0-A thì lỗi **im lặng kép**:
rename không xảy ra, và hàng rào cũng không báo.

### HM1 — Độ phủ `fieldGroupToFieldType` → **đã đủ**
`FieldGroup` có 10 giá trị; hàm xử tường minh 9, thiếu `'mythic'` nên rơi vào `default: 'mixed'`.
Nhưng đó là kết quả **đúng và an toàn**: `mixed` được tính là field code (`masterPrompt.ts:807`) và
vẫn nhận lớp phiên âm tên riêng (`:848`), còn nội dung mythic là `description`/`triggerWhen` — văn
xuôi mà Agent phải đọc để kích hoạt entry. Không sửa hành vi; chỉ khai tường minh `case 'mythic'`
kèm ghi chú để người sau không phải suy.

### HM2 — Luật dịch EJS → **đã đủ về luật, bổ sung 2 ví dụ lỗi THẬT**
`RULE E3` + `C3.1` + `C3.3` đã phủ: đồng bộ getvar/setvar ↔ khoá JSON, tiền tố `stat_data`, chuyển
dot → bracket khi tên có dấu cách, cấm để CJK trong string literal. Không viết lại.
Nhưng bug 164 cho phép bổ sung few-shot **khi có ví dụ lỗi thật**, và session này có đúng hai:
- **bug 161**: AI trả `'Đồng thời trả vềJSONđối tượng, 'bao gồm':\n'` — tự thêm dấu nháy vào giữa
  chuỗi đang mở ⇒ vỡ cả `<script>`, mọi nút liệt. Luật cũ có câu "PRESERVE the quote characters"
  nhưng không có ví dụ, và model vẫn vi phạm.
- **bug 166-1**: `hiện tạiNSFWchi tiết` — dính chữ ở ranh giới CJK↔Latin.
Cả hai đã có lưới tất định chặn ở tầng code; thêm few-shot để giảm số lần phải nhờ lưới.

### HM3 — Đa luồng + 3 chiến lược A/B/C → **đã đủ, không đụng**
Không hạng mục nào trong đợt này đổi cấu trúc field type hay hợp đồng input/output mà A/B/C phụ
thuộc. Các bản vá đều là: thêm macro vào bộ rename/guard (chỉ đường Dịch Preset), export một hằng,
thêm few-shot vào prompt, thêm gợi ý UI, sửa một race trong TM. Giữ nguyên multi-pass và cơ chế
dùng lại từ điển.

### HM4 — Dịch regex → **đã đủ**
`regexScriptPass.ts:29-62` chỉ đổi khi **mọi** cụm CJK trong `findRegex` được từ điển phủ trọn
(`runCoveredByDict`), còn lại giữ nguyên + báo `manual`; và sau khi thay thì `new RegExp` lại, fail
thì hoàn nguyên. Không tìm được ca lỗi thật để vá.

### HM5 — Xem/mô phỏng HTML sau dịch → **1 lỗ hổng**
`StPreviewModal` chỉ mở bằng **một nút bấm tay** trong `CardPreview.tsx:62`. Không có chỗ nào tự mở
hay gợi ý mở sau khi một lượt dịch hoàn tất — đúng câu hỏi của bug 164.
Phần "phát hiện vỡ cấu trúc HTML" thì **đã có**: `aiVerify.ts:604-626` so cân bằng thẻ mở/đóng và
phát ra issue `html_broken`, VerifyPanel hiện nó. Nên chỗ thiếu chỉ là **đường dẫn người dùng tới
nó**: sau khi dịch xong không ai mời họ xem.

### HM6 — Glossary / Translation Memory → **2 lỗ hổng**
**6-A. `translationMemory.ts:45-53` — băm chỉ 200 ký tự đầu.**
Bug 164 ghi "match theo HASH CHÍNH XÁC (không match theo tiền tố — đã được đáp ứng sẵn)". Kiểm lại
thì **không đúng**: `simpleHash` lấy `text.slice(0, 200)`, nên hai đoạn dài khác nhau mà giống 200 ký
tự đầu sẽ **cùng hash** ⇒ `lookupTranslationMemory` trả `similarity: 1.0` cho một bản dịch KHÔNG
phải của nó. Mức nguy hại: vừa — hit chỉ được nạp vào prompt làm **tư liệu tham khảo**
(`useTranslation.ts:448-450`), không tự áp làm bản dịch, nên đây là gợi ý sai lệch chứ không phải
hỏng dữ liệu. Vẫn nên sửa vì gần như miễn phí.

**6-B. `translationMemory.ts:60-65` — race mất bản ghi khi ghi đa luồng.**
`ensureLoaded()` không chống gọi trùng: hai lượt ghi song song lúc `memoryCache === null` đều await
`IDB.get` và mỗi lượt nhận **một mảng riêng**; lượt nào gán `memoryCache` sau sẽ xoá bản ghi của
lượt trước. Trong vòng dịch, `storeTranslation` được gọi mỗi khi một field xong — chạy đa luồng thì
nhiều field xong gần như cùng lúc, nên đây là ca thường gặp chứ không phải hiếm.

**Glossary chỉ áp cho Nhóm B**: đúng. Ở đường card, từ điển tác động qua `mvuDictionary` trong
`surgical.ts` và chỉ chạm token CJK; tên hàm/decorator là ASCII nên không nằm trong tập token, không
thể bị glossary đụng tới.

### HM7 — Kiểm tra tổng thể bước cuối → **đã đủ, trừ phần trùng với 0-C**
`aiVerify.ts` đã có các nhóm kiểm tất định chạy bằng code (không nhờ AI tự soát):
`html_broken`, `bracket_mismatch`, `macro_damaged`, `json_broken`, `mvu_inconsistent`,
`regex_broken`, `code_splice`, `structural_truncation`, `css_class_sync`, `function_signature`,
`key_collision`. `macroGuard.validateMacroParity` đối chiếu **từng tên biến** qua bảng rename, kể cả
bắt biến AI bịa thêm. Lỗ hổng duy nhất là 5 macro ở 0-C.

### HM8 — Trường hợp đặc biệt → **đã đủ**
Tên riêng đã dịch được hiện cho user xem lại ở `GlossaryVizPanel` (kèm nhãn kiểu phiên âm đang dùng).
Link/ảnh không bị dịch: `apiClient.ts` `maskUrls()` che URL trước khi gửi AI và khôi phục sau.

## Phạm vi sẽ sửa

Chỉ 6 chỗ có bằng chứng ở trên, không refactor phần đang chạy tốt:

1. `consistencyPass.ts` — `applyVarRenames` phủ đủ 7 macro (0-A).
2. `macroGuard.ts` — đếm đủ 7 macro (0-C).
3. `stPreview.ts` + `masterPrompt.ts` — export whitelist, prompt lấy tên từ đó, bỏ 3 tên bịa (0-B).
4. `masterPrompt.ts` — thêm 2 few-shot lỗi thật của bug 161 và 166-1 (HM2).
5. `translationMemory.ts` — băm toàn văn + chống race `ensureLoaded` (6-A, 6-B).
6. `CardPreview.tsx` — gợi ý mở preview sau khi dịch xong, kèm số lỗi `html_broken` đã phát hiện
   (HM5). Giữ inline style theo CSS variables vì bug 165 (đại tu giao diện) chưa chạy.

`fieldGroupToFieldType` chỉ thêm `case 'mythic'` tường minh — **không đổi hành vi**.
