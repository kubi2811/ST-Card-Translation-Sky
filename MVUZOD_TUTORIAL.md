# Hướng Dẫn Thực Hành: Tích Hợp Hệ Thống MVU/Zod

Tài liệu này tập trung **hoàn toàn** vào phần định nghĩa trạng thái (State Management) với kiến trúc MVU (Magic Variable Update) và Zod Schema trong SillyTavern, áp dụng các chuẩn kỹ thuật mới nhất.

---

## 1. Khái Niệm Cơ Bản
- **Zod Schema**: Lược đồ cấu trúc dữ liệu nghiêm ngặt để SillyTavern xác thực trạng thái (HP, Vàng, Túi đồ, NPC...).
- **JSON Patch (RFC 6902) & MVU**: Định dạng để AI trả về chỉ thị thay đổi dưới dạng một mảng JSON các thao tác. MVU engine sẽ parse mảng này và cập nhật an toàn vào biến trạng thái của SillyTavern.

---

## 2. Quy Tắc Viết Zod Schema (Chuẩn Zod 4)

Đặt định nghĩa schema trong một script phụ trợ của TavernHelper (`MVU Zod Schema`). Tuân thủ nghiêm ngặt các quy tắc Zod 4 sau để tránh crash game:

### 2.1 Quy Tắc Thiết Kế Schema Bắt Buộc:
1. **Dùng `z.coerce.number()` thay cho `z.number()`:** AI thường sinh số dưới dạng chuỗi (ví dụ: `"50"`). `z.coerce.number()` tự động chuyển đổi kiểu dữ liệu thành số an toàn.
2. **Dùng `.prefault(value)` thay cho `.default(value)`:** Bắt buộc áp dụng `.prefault()` cho mọi trường trong Schema (kể cả object và array con) để đảm bảo dữ liệu luôn được khởi tạo cấu trúc mặc định, tránh lỗi `undefined`.
3. **Giới hạn biên độ bằng `.transform()`:** Thay vì sử dụng `.min()` hoặc `.max()` (gây crash validation nếu AI nạp giá trị lố biên), hãy dùng lodash `.transform(v => _.clamp(v, min, max))` để giới hạn khoảng giá trị một cách êm ái.
4. **Ưu tiên `z.record()` cho danh sách động:** Ví dụ như túi đồ, hãy dùng `z.record(z.string(), z.object({...}))` thay vì `z.array()`. Điều này giúp AI thao tác cập nhật dễ dàng hơn qua JSON Patch path.
5. **CẤM sử dụng `.strict()` hoặc `.passthrough()`:** Các phương thức kiểm soát này không tương thích với cơ chế xử lý của MVU.
6. **KHÔNG dùng `.optional()` cho các biến gốc:** Các trường dữ liệu chính của trạng thái game phải luôn được định nghĩa giá trị mặc định rõ ràng.
7. **Bảo toàn tính lũy đẳng (Idempotency):** Đảm bảo `Schema.parse(Schema.parse(x)) === Schema.parse(x)`.
8. **CDN import chuẩn:** Import duy nhất `registerMvuSchema` từ CDN của StageDog. Thư viện `z` và `_` (lodash) đã được inject toàn cục, tuyệt đối **không được** import lại chúng.

### 2.2 Mã Nguồn Script Zod Schema Chuẩn:

```javascript
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  Người_Chơi: z.object({
    Tên: z.string().prefault("Chờ cập nhật"),
    HP: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(100),
    Max_HP: z.coerce.number().transform(v => _.clamp(v, 1, 100)).prefault(100),
    Vàng: z.coerce.number().transform(v => Math.max(v, 0)).prefault(0),
    Túi_Đồ: z.record(
      z.string().describe("Tên vật phẩm"),
      z.object({
        Mô_Tả: z.string().prefault("Không rõ"),
        Số_Lượng: z.coerce.number().prefault(1),
      }).prefault({})
    ).prefault({}),
  }).prefault({}),
}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});
```

---

## 3. Quy Tắc Biến Khởi Tạo (`initvar`) và Cập Nhật

### 3.1 Khai Báo Biến Khởi Tạo Trong Worldbook
- Tạo một entry trong Worldbook có tên là `[initvar]Khởi tạo biến đừng bật` (hoặc tương đương).
- Đặt trạng thái của entry này là **disabled** (`enabled: false`) để tránh gửi dữ liệu rác vào AI.
- Nội dung entry là dữ liệu khởi tạo định dạng **YAML** khớp 100% với cấu trúc Zod Schema.

### 3.2 Giao Thức Cập Nhật Biến JSON Patch
AI sẽ xuất ra lệnh cập nhật ở dạng mảng JSON Patch:
- **`replace`:** Thay thế giá trị tuyệt đối (String, Boolean, Enum hoặc thiết lập số tuyệt đối).
- **`delta`:** Tăng giảm số tương đối (cộng thêm hoặc trừ bớt, ví dụ: `value: -5`).
- **`insert`:** Thêm thuộc tính mới hoặc chèn phần tử vào mảng (dùng `-` ở cuối path để push vào mảng).
- **`remove`:** Xóa thuộc tính hoặc phần tử.

> ⚠️ **ĐƯỜNG DẪN PATH TRONG JSON PATCH KHÔNG CÓ `stat_data`:**
> AI xuất: `{"op": "replace", "path": "/Người_Chơi/HP", "value": 85}` (Không dùng `/stat_data/Người_Chơi/HP`).
>
> 🔒 **Biến chỉ đọc (Readonly):** Các biến có tên bắt đầu bằng dấu gạch dưới `_` (ví dụ: `_biến`) là readonly, AI tuyệt đối không được sửa đổi.

---

## 4. Đồng Bộ Hóa Trạng Thái Lên Frontend UI

Frontend UI nằm trong Iframe cần truy xuất dữ liệu từ SillyTavern để vẽ giao diện.

### 4.1 Đọc Biến Trạng Thái
Để lấy giá trị biến tại thời điểm hiện tại:
- Gọi `getAllVariables()` để lấy đối tượng biến.
- **Bắt buộc sử dụng tiền tố `stat_data.`** khi đọc biến bằng Lodash:
  `const hp = _.get(vars, 'stat_data.Người_Chơi.HP', 100);`

### 4.2 Lắng Nghe Cập Nhật Thời Gian Thực
Đăng ký lắng nghe sự kiện cập nhật để vẽ lại UI khi AI thay đổi biến:

```html
<script type="module">
  async function init() {
    // 1. Đợi module MVU toàn cục khởi tạo xong
    await waitGlobalInitialized('Mvu');
    
    // 2. Render dữ liệu lần đầu
    renderUI();
    
    // 3. Lắng nghe sự kiện kết thúc cập nhật biến
    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, renderUI);
  }

  function renderUI() {
    const vars = getAllVariables();
    if (!vars) return;

    const hp = _.get(vars, 'stat_data.Người_Chơi.HP', 100);
    const maxHp = _.get(vars, 'stat_data.Người_Chơi.Max_HP', 100);

    document.getElementById('hp-display').textContent = `${hp}/${maxHp}`;
    document.getElementById('hp-bar-fill').style.width = `${(hp / maxHp) * 100}%`;
  }

  // Khởi tạo an toàn bắt lỗi runtime
  $(errorCatched(init));
</script>
```

---

## 5. Tương Tác: Gửi Lệnh Từ Frontend
Vì UI của bạn nằm trong Iframe, để tương tác với thế giới game hoặc thay đổi trạng thái, hãy dùng helper `triggerSlash()` để gửi các slash commands:

```javascript
// Gửi hành động về chat để AI mô tả và trừ HP
function handlePlayerAttack() {
  if (typeof triggerSlash === 'function') {
    triggerSlash('/sys Bạn vừa kích hoạt chiêu thức Tấn Công! Hãy mô tả kết quả và trừ 10 HP của quái vật.');
  }
}
```
Khi AI sinh câu trả lời tiếp theo, nó sẽ kèm theo lệnh JSON Patch cập nhật biến, hệ thống MVU sẽ tự động bắt lấy, cập nhật state và kích hoạt event vẽ lại UI cho người chơi.
