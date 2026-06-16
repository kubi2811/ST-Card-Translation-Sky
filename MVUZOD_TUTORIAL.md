# 📖 HƯỚNG DẪN THỰC HÀNH: TÍCH HỢP HỆ THỐNG MVU-ZOD TOÀN DIỆN

> **Tài liệu thực hành chuyên sâu** — Cập nhật: 2026-06-15  
> Tài liệu này tập trung vào việc hướng dẫn chi tiết quy trình thiết kế, lập trình và cấu hình biến trạng thái (State Management) với kiến trúc MVU (Magic Variable Update) và Zod Schema trong SillyTavern.

---

## MỤC LỤC

1. [Khái Niệm Cơ Bản](#1-khái-niệm-cơ-bản)
2. [Quy Tắc Viết Zod Schema (Chuẩn Zod 4)](#2-quy-tắc-viết-zod-schema-chuẩn-zod-4)
3. [Quy Tắc Biến Khởi Tạo (`initvar`) và Cập Nhật](#3-quy-tắc-biến-khởi-tạo-initvar-và-cập-nhật)
4. [Cấu Hình Worldbook Entry (Lorebook) Chi Tiết](#4-cấu-hình-worldbook-entry-lorebook-chi-tiết)
5. [Cấu Hìn Regex Scripts Tối Giản Mới](#5-cấu-hình-regex-scripts-tối-giản-mới)
6. [Đồng Bộ Hóa Trạng Thái Lên Frontend UI](#6-đồng-bộ-hóa-trạng-thái-lên-frontend-ui)
7. [Tương Tác: Gửi Lệnh Từ Frontend](#7-tương-tác-gửi-lệnh-từ-frontend)
8. [Checklist Xử Lý Sự Cố (Troubleshooting)](#8-checklist-xử-lý-sự-cố-troubleshooting)

---

## 1. KHÁI NIỆM CƠ BẢN

Hệ thống **MVU-Zod** hoạt động dựa trên ba trụ cột chính để quản lý trạng thái của cuộc trò chuyện hoặc trò chơi nhập vai (RPG) trong SillyTavern:
* **Zod Schema**: Lược đồ cấu trúc dữ liệu nghiêm ngặt chạy trực tiếp tại runtime để xác thực và chuẩn hóa trạng thái (ví dụ: HP, Vàng, Túi đồ, trạng thái NPC).
* **JSON Patch (RFC 6902) & MVU**: Định dạng giúp AI chỉ cần xuất ra các chỉ thị thay đổi dưới dạng một mảng các toán tử JSON (thay vì ghi đè toàn bộ dữ liệu). MVU engine sẽ parse mảng này và cập nhật an toàn vào biến trạng thái của SillyTavern.
* **Dynamic Frontend**: Một giao diện HTML được kết nối trực tiếp với biến trạng thái để tự động vẽ lại (re-render) mỗi khi có sự thay đổi.

---

## 2. QUY TẮC VIẾT ZOD SCHEMA (CHUẨN ZOD 4)

Đặt định nghĩa schema trong một script phụ trợ của TavernHelper (`MVU Zod Schema`). Tuân thủ nghiêm ngặt các quy tắc Zod 4 sau để tránh crash game:

### 2.1 Quy Tắc Thiết Kế Schema Bắt Buộc:
1. **Dùng `z.coerce.number()` thay cho `z.number()`**: AI thường sinh số dưới dạng chuỗi (ví dụ: `"50"`). `z.coerce` tự động ép kiểu dữ liệu thành số an toàn.
2. **Dùng `.prefault(value)` thay cho `.default(value)`**: Bắt buộc áp dụng `.prefault()` cho mọi trường trong Schema (kể cả object và array con) để đảm bảo dữ liệu luôn được khởi tạo cấu trúc mặc định, tránh lỗi đọc thuộc tính từ `undefined`.
3. **Giới hạn biên độ bằng `.transform()`**: Thay vì sử dụng `.min()` hoặc `.max()` (gây crash validation nếu AI nạp giá trị lố biên), hãy dùng lodash `.transform(v => _.clamp(v, min, max))` để giới hạn khoảng giá trị một cách êm ái.
4. **Ưu tiên `z.record()` cho danh sách động**: Đối với các thuộc tính như túi đồ hoặc danh sách kỹ năng, hãy dùng `z.record(z.string(), z.object({...}))` thay vì `z.array()`. Điều này giúp AI dễ dàng thao tác cập nhật trực tiếp qua path của JSON Patch mà không bị lệch chỉ số mảng.
5. **CẤM sử dụng `.strict()` hoặc `.passthrough()`**: Các phương thức kiểm soát này không tương thích với cơ chế xử lý của MVU.
6. **KHÔNG dùng `.optional()` cho các biến gốc**: Các trường dữ liệu chính của trạng thái game phải luôn được định nghĩa giá trị mặc định rõ ràng để AI luôn có dữ liệu nền đọc được.
7. **Bảo toàn tính lũy đẳng (Idempotency)**: Đảm bảo `Schema.parse(Schema.parse(x)) === Schema.parse(x)`.
8. **CDN import chuẩn**: Import duy nhất `registerMvuSchema` từ CDN của StageDog. Thư viện `z` và `_` (lodash) đã được inject toàn cục, tuyệt đối **không được** import lại chúng.

### 2.2 Mã Nguồn Script Zod Schema Chuẩn:

```javascript
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  Người_Chơi: z.object({
    Tên: z.string().prefault("Chờ cập nhật"),
    HP: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(100),
    Max_HP: z.coerce.number().transform(v => _.clamp(v, 1, 200)).prefault(100),
    Vàng: z.coerce.number().transform(v => Math.max(v, 0)).prefault(0),
    Túi_Đồ: z.record(
      z.string().describe("Tên vật phẩm"),
      z.object({
        Mô_Tả: z.string().prefault("Không rõ công dụng"),
        Số_Lượng: z.coerce.number().prefault(1),
      }).prefault({})
    ).transform(data => _.pickBy(data, ({Số_Lượng}) => Số_Lượng > 0)).prefault({}), // Tự xóa vật phẩm khi số lượng về 0
  }).prefault({}),
}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});
```

---

## 3. QUY TẮC BIẾN KHỞI TẠO (`initvar`) VÀ CẬP NHẬT

### 3.1 Khai Báo Biến Khởi Tạo Trong Worldbook
* Tạo một entry trong Worldbook có tên là `[initvar]Khởi tạo biến` (hoặc tương đương).
* Đặt trạng thái của entry này là **disabled** (`enabled: false`) để tránh gửi dữ liệu rác vào AI.
* Nội dung entry là dữ liệu khởi tạo định dạng **YAML** khớp cấu trúc Zod Schema.

### 3.2 Giao Thức Cập Nhật Biến JSON Patch
AI sẽ xuất ra lệnh cập nhật ở dạng mảng JSON Patch tại cuối câu trả lời. Hệ thống hỗ trợ **5 toán tử** cốt lõi sau:
* **`replace`**: Thay thế giá trị tuyệt đối (String, Boolean, Enum hoặc thiết lập số tuyệt đối).
  ```json
  { "op": "replace", "path": "/Người_Chơi/HP", "value": 85 }
  ```
* **`delta`**: Tăng giảm số tương đối (cộng thêm hoặc trừ bớt một khoảng trị số).
  ```json
  { "op": "delta", "path": "/Người_Chơi/HP", "value": -15 }
  ```
* **`insert`**: Thêm thuộc tính mới hoặc chèn phần tử vào mảng/record (dùng `-` ở cuối path để push vào mảng).
  ```json
  { "op": "insert", "path": "/Người_Chơi/Túi_Đồ/Bản đồ", "value": { "Mô_Tả": "Bản đồ cổ", "Số_Lượng": 1 } }
  ```
* **`remove`**: Xóa thuộc tính hoặc phần tử tại đường dẫn chỉ định.
  ```json
  { "op": "remove", "path": "/Người_Chơi/Túi_Đồ/Lương khô" }
  ```
* **`move`**: Di chuyển giá trị từ một đường dẫn nguồn sang một đường dẫn đích.
  ```json
  { "op": "move", "from": "/Người_Chơi/Vàng", "to": "/NPC_Trưởng_Thôn/Hối_Lộ" }
  ```

> ⚠️ **ĐƯỜNG DẪN PATH TRONG JSON PATCH KHÔNG CÓ `stat_data`**:  
> AI xuất: `{"op": "replace", "path": "/Người_Chơi/HP", "value": 85}` (Không dùng `/stat_data/Người_Chơi/HP`).  
> 
> 🔒 **Biến chỉ đọc (Readonly)**: Các biến có tên bắt đầu bằng dấu gạch dưới `_` (ví dụ: `_id_tầng`) là readonly, AI tuyệt đối không được sửa đổi.  
> 
> 👁️ **Biến ẩn (Private)**: Các biến bắt đầu bằng ký tự `$` (ví dụ: `$dữ_liệu_ẩn`) sẽ bị ẩn hoàn toàn khỏi prompt gửi lên AI, chỉ dùng để lưu trữ dữ liệu hệ thống hoặc frontend.

### 3.3 Thiết Lập Nâng Cao: Lọc Biến Số Bằng EJS (EJS Variable Filtering)
Khi card nhân vật có cấu trúc dữ liệu biến trạng thái quá lớn (như RPG chứa hàng chục NPC, nhiều khu vực bản đồ và trang bị), việc gửi toàn bộ biến trạng thái cho AI ở mỗi lượt chat sẽ gây lãng phí token nghiêm trọng và làm loãng sự chú ý của AI.

Chúng ta có thể sử dụng mã **EJS** trong nội dung của entry `Danh sách biến` để chỉ xuất ra những thuộc tính thực sự cần thiết theo bối cảnh câu chuyện (Ví dụ lọc NPC đang có mặt hoặc các chỉ số chiến đấu khi vào cảnh chiến đấu):

```ejs
<%_
(function() {
  var statData = getvar('stat_data');
  if (!statData) {
    print('{}');
    return;
  }

  var output = {};
  var currentLoc = _.get(statData, 'Người_Chơi.Vị_Trí', 'Tân Thủ Thôn');
  var isCombat = currentLoc.includes('Chiến trường') || currentLoc.includes('Phụ bản');

  /* ─── 1. Bối cảnh thế giới ─── */
  if (statData['Thiên_Hạ']) {
    output['Thiên_Hạ'] = statData['Thiên_Hạ'];
  }

  /* ─── 2. Lọc thông tin người chơi ─── */
  if (statData['Người_Chơi']) {
    var player = statData['Người_Chơi'];
    var pOut = {};
    pOut['Tên'] = player['Tên'];
    
    // Chỉ xuất HP, Max_HP khi ở trạng thái chiến đấu
    if (isCombat) {
      pOut['HP'] = player['HP'];
      pOut['Max_HP'] = player['Max_HP'];
    }
    
    // Chỉ xuất túi đồ nếu có vật phẩm
    if (player['Túi_Đồ'] && Object.keys(player['Túi_Đồ']).length > 0) {
      pOut['Túi_Đồ'] = player['Túi_Đồ'];
    }
    output['Người_Chơi'] = pOut;
  }

  /* ─── 3. NPC có mặt (Chỉ hiển thị các NPC có thuộc tính Có_Mặt: true) ─── */
  if (statData['Danh_Sách_NPC']) {
    var npcOut = {};
    for (var npcName in statData['Danh_Sách_NPC']) {
      var npc = statData['Danh_Sách_NPC'][npcName];
      if (npc && _.get(npc, 'Có_Mặt') === true) {
        npcOut[npcName] = {
          'Thân_Phận': _.get(npc, 'Thân_Phận'),
          'Hành_Động': _.get(npc, 'Hành_Động')
        };
      }
    }
    if (Object.keys(npcOut).length > 0) {
      output['NPC_Có_Mặt'] = npcOut;
    }
  }

  print(JSON.stringify(output, null, 2));
})();
_%>
```

---

## 4. CẤU HÌNH WORLDBOOK ENTRY (LOREBOOK) CHI TIẾT

Cơ chế Worldbook quyết định khi nào các thiết lập được gửi vào ngữ cảnh của AI. Cấu hình đúng các tham số kỹ thuật dưới đây là bắt buộc để hệ thống vận hành trơn tru:

### 4.1 Chiến Lược Kích Hoạt (Strategy)
* **Constant (Hằng số / Đèn xanh dương)**: Luôn luôn xuất hiện trong bộ nhớ mà không cần từ khóa kích hoạt.
  * *Áp dụng*: Dùng cho thiết lập thế giới quan, quy tắc trò chơi, và **toàn bộ hồ sơ nhân vật của Card đơn nhân vật** (ngăn ngừa hiện tượng OOC khi thiếu từ khóa).
* **Selective (Thông thường / Đèn xanh lá)**: Chỉ kích hoạt và chèn vào prompt khi phát hiện các từ khóa chính (`Primary Keywords`) xuất hiện trong đoạn chat gần đây.
  * *Áp dụng*: Dùng cho hồ sơ chi tiết các nhân vật phụ (NPC), mô tả cảnh vật hoặc vật phẩm đặc thù trong Card đa nhân vật.

### 4.2 Vị Trí Chèn (Position) & Độ Sâu (Depth)
* **Vị trí chèn**:
  * **`before_character_definition` (Order 1 - 10)**: Chèn trước mô tả nhân vật. Thường dùng cho thiết lập thế giới quan, thời tiết, hoặc các biến trạng thái khởi đầu.
  * **`after_character_definition` (Order 99 - 100)**: Chèn sau mô tả nhân vật. Thường dùng cho các entry hồ sơ nhân vật phụ, kỹ năng, trang bị và bộ điều khiển động EJS Preprocessing.
  * **`at_depth` (Depth 0, System, Order 1 - 2)**: Chèn trực tiếp làm luật hệ thống ở cuối ngữ cảnh. Dùng cho entry `[mvu_update]Định dạng xuất biến` để AI luôn nhớ định dạng xuất JSON Patch ở lượt trả lời hiện tại.
* **Độ sâu (Depth)**: Khoảng cách từ tin nhắn mới nhất ngược về quá khứ (ví dụ: `Depth 0` là ngay sát tin nhắn cuối cùng, có độ ưu tiên cao nhất; `Depth 4` là lùi về sau 4 tin nhắn làm nền tảng). Trong cấu hình MVU, các luật cập nhật và định dạng xuất phải nằm ở `Depth 0` để AI luôn ghi nhớ luật trước khi viết phản hồi.

### 4.3 Chặn Đệ Quy An Toàn (Recursion Toggles)
Để tối ưu hóa token và ngăn chặn vòng lặp vô tận (entry A kích hoạt từ khóa của entry B, B lại kích hoạt ngược lại A):
* Bật đồng thời cả hai tùy chọn sau cho tất cả các entry thông thường:
  * **Không đệ quy** (`Non-recursable` / `exclude_recursion: true`): Chặn chiều đến (ngăn các entry khác quét trúng từ khóa trong nội dung của entry này).
  * **Ngăn đệ quy tiếp diễn** (`Prevent further recursion` / `prevent_recursion: true`): Chặn chiều đi (ngăn hệ thống tiếp tục quét nội dung của entry này để kích hoạt thêm các entry khác).
* *Lưu ý*: Hãy tắt hai thuộc tính này ở **Bộ điều khiển EJS Preprocessing** để EJS có thể tự do gọi và nạp nội dung từ các entry Worldbook khác thông qua lệnh `getwi`.

### 4.4 Các Thuộc Tính Nâng Cao
* **Prioritize (Ưu tiên tuyệt đối)**: Khi bộ nhớ (Context) bị đầy, các mục thông thường sẽ bị cắt bỏ, nhưng mục có dấu tích này sẽ được giữ lại bằng mọi giá. Bật cho các luật lệ cốt lõi hoặc trạng thái nhân vật.
* **Sticky (Độ dính)**: Số lượt chat mà entry này tiếp tục được duy trì trong bộ nhớ sau khi từ khóa kích hoạt biến mất. Ví dụ đặt `Sticky: 5` khi nhân vật đi vào trạng thái "Bị thương" để AI nhớ liên tục trong 5 lượt tiếp theo dù không còn nhắc lại từ khóa "bị thương".
* **Cooldown (Thời gian hồi)**: Số lượt chat tối thiểu mà entry này không thể kích hoạt lại sau khi vừa hết thời gian Sticky. Rất hữu ích cho các sự kiện ngẫu nhiên hoặc biến cố đặc biệt tránh lặp lại liên tục.
* **Ignore Budget**: Bỏ qua giới hạn ngân sách tối đa dành cho Worldbook trong cài đặt SillyTavern, đảm bảo thông tin quan trọng luôn được chèn vào prompt bất kể dung lượng bộ nhớ hiện tại.

---

## 5. CẤU HÌNH REGEX SCRIPTS TỐI GIẢN MỚI

> ⚠️ **QUY CHUẨN THAY THẾ MỚI**: Trong kiến trúc hiện đại, chúng ta **CẤM** nhúng mã nguồn HTML Dashboard hoặc HTML Form khởi tạo khổng lồ vào trong `replaceString` của Regex. Điều này gây khó bảo trì và dễ vỡ ký tự escape.  
> Việc render UI hoàn toàn do MVU runtime (`bundle.js`) quản lý. Regex chỉ đóng vai trò ẩn thẻ cập nhật gốc và tạo thẻ neo cho UI.

Thiết lập đúng **4 Regex lõi** sau trong mục `regex_scripts` của card:

### 1. Ẩn thanh trạng thái khởi tạo / Tạo thẻ neo
* **findRegex**: `[\r\n]*<StatusPlaceHolderImpl\/>`
* **replaceString**: `<style>.StatusPlaceHolderImpl { display: none; }</style><div class="StatusPlaceHolderImpl"><StatusPlaceHolderImpl/></div>`
* **Cấu hình**: `PromptOnly: False | MarkdownOnly: False | RunOnEdit: True | MinDepth: 0 | MaxDepth: 0 | Placement: [1]` (Bọc thẻ neo để runtime tìm thấy và mount UI động).

### 2. Ẩn thẻ Update gốc khỏi Prompt gửi AI
* **findRegex**: `[\r\n]*<UpdateVariable[^>]*>.*?</UpdateVariable>`
* **replaceString**: `<span style="display:none;">$&</span>`
* **Cấu hình**: `PromptOnly: True | MarkdownOnly: False | RunOnEdit: True | MinDepth: 3 | MaxDepth: 0 | Placement: [2]` (Ngăn AI đọc lại các lệnh update cũ của các lượt trước để tránh ảo giác lặp lại lệnh cũ).

### 3. Hiển Thị Loading Cập Nhật
* **findRegex**: `<UpdateVariable>(.*?)</UpdateVariable>`
* **replaceString**: `<div class="mvu-loading" style="padding: 10px; background: #0f0f12; color: #f59e0b; border: 1px solid #d97706; border-radius: 6px; font-family: monospace;">⏳ Đang phân tích và cập nhật chỉ số trạng thái...</div>`
* **Cấu hình**: `PromptOnly: False | MarkdownOnly: True | RunOnEdit: False | Enabled: True | Placement: [2]` (Hiển thị UI thông báo trong lúc tin nhắn đang stream).

### 4. Hiển Thị Hoàn Thành Cập Nhật
* **findRegex**: `<UpdateVariable>(.*?)</UpdateVariable>`
* **replaceString**: `<div class="mvu-done" style="padding: 10px; background: #0f172a; color: #10b981; border: 1px solid #059669; border-radius: 6px; font-family: monospace;">✅ Cập nhật biến số hoàn tất.</div>`
* **Cấu hình**: `PromptOnly: False | MarkdownOnly: True | RunOnEdit: False | Enabled: True | Placement: [2]` (Thay thế thông báo loading khi AI đã hoàn tất phản hồi câu chat).

---

## 6. ĐỒNG BỘ HÓA TRẠNG THÁI LÊN FRONTEND UI

UI Frontend (HTML/CSS/JS) chạy trong Iframe cần giao tiếp với MVU Engine thông qua cơ chế bất đồng bộ:

### 6.1 Lắng Nghe Sự Kiện Cập Nhật Biến
Bắt buộc phải chờ khởi tạo Mvu toàn cục, sau đó đăng ký lắng nghe sự kiện `VARIABLE_UPDATE_ENDED` để tự động render lại giao diện mỗi khi biến số thay đổi:

```html
<script type="module">
  async function init() {
    // 1. Đợi module MVU toàn cục khởi tạo xong
    await waitGlobalInitialized('Mvu');
    
    // 2. Vẽ UI lần đầu tiên
    renderUI();
    
    // 3. Đăng ký sự kiện lắng nghe cập nhật biến
    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {
      renderUI();
    });
  }

  function renderUI() {
    const vars = getAllVariables();
    if (!vars) return;

    // Sử dụng _.get để truy xuất an toàn, tránh lỗi đọc từ undefined
    const hp = _.get(vars, 'stat_data.Người_Chơi.HP', 100);
    const maxHp = _.get(vars, 'stat_data.Người_Chơi.Max_HP', 100);
    const gold = _.get(vars, 'stat_data.Người_Chơi.Vàng', 0);

    document.getElementById('hp-display').textContent = `${hp}/${maxHp}`;
    document.getElementById('hp-bar-fill').style.width = `${(hp / maxHp) * 100}%`;
    document.getElementById('gold-display').textContent = gold;
  }

  // Chú ý: Tất cả comment trong script JS/HTML của frontend bắt buộc dùng dạng /**/
  // Tuyệt đối không dùng comment một dòng // vì có thể gây lỗi cú pháp khi nạp qua chuỗi.
  $(errorCatched(init));
</script>
```

---

## 7. TƯƠNG TÁC: GỬI LỆNH TỪ FRONTEND

Để gửi lệnh hoặc hành động từ các nút bấm trên giao diện Frontend trở lại màn hình chat SillyTavern, sử dụng hàm helper `triggerSlash()`:

```javascript
function useHealthPotion() {
  const vars = getAllVariables();
  const hp = _.get(vars, 'stat_data.Người_Chơi.HP', 100);
  const maxHp = _.get(vars, 'stat_data.Người_Chơi.Max_HP', 100);

  if (hp >= maxHp) {
    toastr.warning("Máu của bạn đã đầy!");
    return;
  }

  // Gửi lệnh hệ thống yêu cầu AI ghi nhận hành động uống thuốc và cộng lại HP
  if (typeof triggerSlash === 'function') {
    triggerSlash('/sys Bạn vừa sử dụng 1 bình Dược phẩm hồi máu! Hãy miêu tả hành động này và hồi phục 30 HP.');
  }
}
```

---

## 8. CHECKLIST XỬ LÝ SỰ CỐ (TROUBLESHOOTING)

### 🔴 Lỗi: Thanh trạng thái (Status Bar) không hiển thị ở tin nhắn đầu tiên (Greeting)
* **Nguyên nhân**: Thiếu thẻ neo hoặc cấu hình Regex sai.
* **Cách sửa**: 
  1. Đảm bảo cuối trường `first_mes` của nhân vật có chèn thẻ neo `<StatusPlaceHolderImpl/>`.
  2. Kiểm tra Regex số 1 (`Ẩn thanh trạng thái khởi tạo`) đã được bật (`Enabled: True`) và có Placement là `[1]` chưa.

### 🔴 Lỗi: Trò chơi bị treo hoặc thông báo đỏ "Lỗi khởi tạo biến"
* **Nguyên nhân**: Lỗi cú pháp YAML trong entry `[initvar]` hoặc cấu trúc Zod Schema bị sai kiểu dữ liệu.
* **Cách sửa**:
  1. Kiểm tra lại tệp YAML khởi tạo có bị thừa khoảng trắng thụt lề hay sai dấu hai chấm (`:`) không.
  2. Đảm bảo mọi đối tượng lồng nhau trong Schema đều có đuôi `.prefault({...})` để tránh trường hợp biến cha chưa tồn tại khi truy cập biến con.
  3. Đảm bảo không sử dụng các phương thức cấm như `.strict()` hoặc `.passthrough()`.

### 🔴 Lỗi: AI liên tục sinh ra các lệnh cập nhật biến lặp đi lặp lại của các lượt chat trước
* **Nguyên nhân**: AI đọc được các thẻ `<UpdateVariable>` cũ trong lịch sử chat gửi lên.
* **Cách sửa**: Kiểm tra xem Regex số 2 (`Ẩn thẻ Update gốc khỏi Prompt gửi AI`) đã được bật và đặt `MinDepth: 3` và `PromptOnly: True` chưa. Điều này giúp ẩn đi toàn bộ các lệnh cũ khỏi context của AI.

### 🔴 Lỗi: Dữ liệu mảng bị trùng lặp phần tử khi cập nhật bằng JSON Patch
* **Nguyên nhân**: Sử dụng kiểu mảng `z.array()` khiến JSON Patch khó định vị phần tử cụ thể.
* **Cách sửa**: Thay thế toàn bộ bằng cấu trúc `z.record(z.string(), z.object(...))` (sử dụng Tên vật phẩm hoặc ID làm khóa). Thao tác này giúp JSON Patch thực hiện lệnh `replace`, `insert` hoặc `remove` trực tiếp lên khóa cụ thể mà không lo trùng lặp.
