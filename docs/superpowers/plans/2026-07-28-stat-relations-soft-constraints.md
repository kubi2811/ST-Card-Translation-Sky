# Ràng buộc mềm giữa các chỉ số liên quan (Opening Form) — 2026-07-28

## Yêu cầu của user (goal)

- "Level/Energy" chỉ là TÊN TƯỢNG TRƯNG cho khái niệm cấp độ / năng lượng của MỌI thế giới
  (fantasy, tu tiên…) — áp cho bất kỳ tên trường nào thế giới của user định nghĩa.
- Vấn đề: chọn Level thấp (10) vẫn nhập được Energy 99999 — không có ràng buộc logic nào
  giữa các trường liên quan.
- AI phải TỰ SUY khoảng hợp lý từ MÔ TẢ Ý TƯỞNG của user. CẤM công thức cứng
  ("Max Energy = Level × hằng số") và CẤM chia block cố định ("Level 1-10 → 10-100…") —
  những thứ đó làm thế giới thành game phổ thông.
- Mô tả của user không đủ căn cứ → AI KHÔNG ĐƯỢC bịa công thức lấp chỗ trống.
- CẢNH BÁO MỀM, không bao giờ chặn: user nhập tự do; giá trị lệch so với Level đã chọn thì
  hiện cảnh báo KÈM CĂN CỨ cụ thể AI dựa vào (ví dụ: "Energy 99999 có vẻ cao bất thường so
  với Level 10 — dựa theo mô tả cảnh giới trong World Book, mức này tương ứng khoảng Level
  100+"). User được quyền giữ nguyên (nhân vật thiên tài, vật phẩm bị nguyền…).
- Gỡ MỘT PHẦN fix bug 113: trường liên quan kiểu bộ đếm phải giữ Ô NHẬP SỐ TỰ DO, không
  slider trần cứng, không khoá max.
- Quét tổng: áp cho MỌI cặp chỉ số liên quan logic (level↔tiền/tài sản, level↔năm tu luyện/
  kinh nghiệm, danh vọng↔ảnh hưởng…), không chỉ Level-Energy.

## Thiết kế

Dữ liệu suy luận phải có SẴN lúc tạo card (form chạy trong iframe SillyTavern, không gọi AI
được lúc người chơi nhập). Vậy: AI của bước mvuzod (đang thấy ý tưởng + toàn bộ lorebook)
sinh thêm `statRelations` gắn vào schema; form nhúng bảng đó thành JS kiểm tra mềm.

### 1. Kiểu dữ liệu (`mvuzod.types.ts`)

```ts
interface StatRelationLandmark {
  anchor: number | [number, number] | string;  // mốc neo: số, khoảng, hoặc giá trị enum (tên cảnh giới)
  plausibleMin?: number;   // khoảng "thường thấy" cho trường phụ thuộc tại mốc này
  plausibleMax?: number;
  note?: string;           // căn cứ lore của riêng mốc này — hiện trong cảnh báo
}
interface StatRelation {
  anchorPath: string;      // trường neo (vd /Nhân vật/Cảnh giới)
  dependentPath: string;   // trường phụ thuộc (vd /Nhân vật/Linh lực)
  basis: string;           // căn cứ tổng — trích/diễn đạt lại mô tả của user, hiện trong cảnh báo
  landmarks: StatRelationLandmark[];
}
MVUZODSchema.statRelations?: StatRelation[]
```

Đây KHÔNG phải công thức: mốc chỉ tồn tại khi lore CÓ NÓI tới; giá trị neo không khớp mốc
nào → không cảnh báo gì (không bịa). Khoảng plausible là "thường thấy", không phải giới hạn.

### 2. `normalizeSchema.ts` — chốt chặn tại biên

- `normalizeStatRelations`: bỏ relation trỏ path không tồn tại / thiếu basis / không còn
  landmark hợp lệ (landmark phải có ít nhất plausibleMin hoặc plausibleMax là số);
  dedupe theo cặp path; anchor phải là number|string|[number,number].
- Trường phụ thuộc (dependentPath) kiểu number: XOÁ `constraints.max`/`clamp` (giữ min) —
  gỡ một phần bug 113 đúng yêu cầu: không để Zod/slider kẹp giá trị user đã cố ý giữ.

### 3. Prompt bước mvuzod (`autoCreatorPrompts.ts`)

Thêm `statRelations` vào định dạng JSON + khối luật nhắc đúng ràng buộc user:
chỉ tạo khi có căn cứ thật trong ý tưởng/lore; cấm công thức toán và block đều tăm tắp;
basis/note phải nêu căn cứ (sẽ hiện nguyên văn cho người chơi); không đủ căn cứ → mảng rỗng;
trường phụ thuộc khai như bộ đếm (không max); đây là cảnh báo mềm.

### 4. Form (`programmaticRegexBuilder.ts`)

- Trường số là dependent của relation → LUÔN ô nhập số tự do (kể cả schema có max),
  kèm `<div id="…-warn">` ẩn sẵn dưới ô.
- Nhúng `STCS_RELATIONS` (đã đổi path → inputId/label lúc build; relation nào có trường
  không nhập được trên form thì bỏ).
- JS runtime: `stcsRelationCheck()` — đọc form, tìm landmark khớp giá trị neo, giá trị phụ
  thuộc ngoài khoảng → hiện cảnh báo vàng: giá trị + so với neo + căn cứ (note/basis) +
  "bạn có thể giữ nguyên nếu đó là chủ đích". Gắn `oninput` vào ô neo/phụ thuộc, bọc
  `selectCard` (neo enum) và `goToPage` (đổ cảnh báo vào trang Tổng kết). `onConfirm`
  KHÔNG đổi — không bao giờ chặn.

### 5. Test

- `normalizeSchema.test.ts`: relation bẩn bị lọc, max của dependent bị gỡ, relation sạch đi xuyên normalize.
- Tách harness DOM giả của `openingFormLive.test.ts` ra `liveFormHarness.ts` dùng chung.
- `statRelationsLive.test.ts` (chạy JS thật trong sandbox): nhập lệch → warn hiện đúng căn cứ;
  trong khoảng → warn ẩn; neo không khớp mốc nào → không cảnh báo; Xác nhận vẫn ghi đúng
  giá trị "vô lý" user giữ (soft, không chặn); trường dependent có max vẫn là input number tự do.

## Quyết định & lý do

- Gắn statRelations vào schema (không thêm tham số hàm): normalize spread `...s` nên dữ liệu
  tự chảy qua pipeline → game_ui, không đổi chữ ký hàm nào.
- Sinh ở bước mvuzod chứ không phải blueprint: bước này thấy cả lorebook (mô tả cảnh giới
  nằm ở đó) — đúng chỗ có căn cứ.
- Mốc số khớp CHÍNH XÁC hoặc theo khoảng [lo,hi]; không nội suy giữa các mốc — nội suy chính
  là công thức, thứ user cấm.
