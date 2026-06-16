# HƯỚNG DẪN SƠ LƯỢC VỀ MVU - ZOD

## 1. TỔNG QUAN HỆ THỐNG

### 1.1. Giới thiệu

MVUZOD là một module mở rộng nâng cao dành cho SillyTavern, được thiết kế để thay thế cơ chế cập nhật biến vĩ mô (Macro Variable Updater - MVU) thế hệ cũ. Trong khi các hệ thống MVU truyền thống dựa vào việc **phân tích cú pháp chuỗi** thông qua Biểu thức chính quy (Regular Expressions - Regex) để trích xuất lệnh, MVUZOD chuyển đổi mô hình tương tác sang dạng đầu ra có cấu trúc (Structured Output).

Hệ thống này tích hợp **hai công nghệ cốt lõi**: **Zod** cho việc xác thực lược đồ dữ liệu (Schema Validation) và **JSON Patch (RFC 6902) mở rộng** cho việc thao tác dữ liệu trạng thái (State Manipulation). Mục tiêu của MVUZOD là đảm bảo tính toàn vẹn dữ liệu, loại bỏ các lỗi cú pháp do ảo giác của Mô hình Ngôn ngữ Lớn (AI) và cung cấp khả năng quản lý các cấu trúc dữ liệu phức tạp như Mảng (Array), Bản ghi (Record) và Đối tượng lồng nhau (Nested Objects).

### 1.2. Hạn chế của kiến trúc MVU truyền thống (Legacy MVU)

Các hệ thống MVU dựa trên Regex hoạt động theo cơ chế **so khớp mẫu (pattern matching)**. Người dùng hoặc hệ thống yêu cầu AI xuất ra các chuỗi văn bản cụ thể, ví dụ: `_.set(variable, value)`.

* **Vấn đề về cú pháp:** AI thường xuyên gặp lỗi khi sinh ra các ký tự thoát (escape characters), dấu ngoặc hoặc định dạng chuỗi không chuẩn, dẫn đến việc Regex không thể bắt được lệnh.  
* **Xử lý kiểu dữ liệu:** MVU truyền thống xử lý dữ liệu chủ yếu dưới dạng chuỗi (String). Các phép toán trên danh sách (List/Array) thường dẫn đến việc nối chuỗi sai lệch thay vì thao tác trên phần tử.  
* **Rủi ro vận hành:** Việc ghi đè dữ liệu thiếu kiểm soát (Uncontrolled Overwrite) có thể làm hỏng trạng thái của phiên làm việc (Session State).

---

## 2. KIẾN TRÚC KỸ THUẬT CỦA MVUZOD

MVUZOD không chỉ là một bản cập nhật mà là sự tái cấu trúc hoàn toàn phương thức giao tiếp giữa Frontend (SillyTavern) và Backend (AI API) trong việc quản lý trạng thái.

### 2.1. Zod: Lớp xác thực lược đồ (Schema Validation Layer)

Trong kiến trúc phần mềm hướng dữ liệu, việc đảm bảo đầu vào tuân thủ một định dạng nhất định là tối quan trọng. Zod là một thư viện TypeScript được sử dụng để định nghĩa và xác thực lược đồ (Schema) tại thời điểm chạy (Runtime).

#### 2.1.1. Cơ chế hoạt động

Thay vì gửi các hướng dẫn bằng ngôn ngữ tự nhiên mơ hồ, hệ thống cung cấp cho AI một định nghĩa lược đồ JSON (JSON Schema) nghiêm ngặt. Zod đóng vai trò là "người gác cổng" (Gatekeeper), thực hiện các nhiệm vụ:

1. **Định nghĩa cấu trúc (Structure Definition):** Quy định rõ ràng các trường dữ liệu, kiểu dữ liệu (String, Number, Boolean, Object, Record) bắt buộc.  
2. **Kiểm tra ràng buộc logic (Logic Validation):** Đảm bảo dữ liệu thỏa mãn các điều kiện ngữ nghĩa qua các hàm biến đổi (transform) và giá trị mặc định phòng ngừa (prefault).
3. **Xử lý lỗi (Error Handling):** Nếu đầu ra của AI vi phạm lược đồ, Zod sẽ từ chối dữ liệu hoặc kích hoạt giá trị mặc định an toàn để bảo vệ game state không bị crash.

#### 2.1.2. Đặc tả Lược đồ (Schema Specification)

Dưới đây là mô tả kỹ thuật về một lược đồ Zod điển hình được sử dụng trong MVUZOD để điều hướng hành vi của AI:

```javascript
// Lược đồ quy định cấu trúc dữ liệu của thẻ nhân vật
const Schema = z.object({
  // Quyền đọc-ghi thông thường của AI
  Người_Chơi: z.object({
    Tên: z.string().prefault("Chờ cập nhật"),
    HP: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(100),
    Túi_Đồ: z.record(
      z.string().describe("Tên vật phẩm"),
      z.object({
        Mô_Tả: z.string().prefault("Không rõ"),
        Số_Lượng: z.coerce.number().prefault(1),
      }).prefault({})
    ).prefault({}),
  }).prefault({}),
  
  // Biến chỉ đọc của AI (ReadOnly)
  _phiên_bản: z.coerce.number().prefault(1.0),
  
  // Biến ẩn hoàn toàn khỏi AI (Private)
  $dữ_liệu_hệ_thống: z.string().prefault(""),
}).prefault({});
```

### 2.2. JSON Patch: Giao thức thao tác dữ liệu (Data Manipulation Protocol)

MVUZOD tuân thủ tiêu chuẩn **RFC 6902 (JSON Patch)** mở rộng, một định dạng chuẩn quốc tế để mô tả chuỗi các thay đổi áp dụng lên một tài liệu JSON.

#### 2.2.1. Nguyên lý Delta Update

Thay vì gửi **toàn bộ trạng thái** mới của đối tượng (Full State Transfer), JSON Patch chỉ truyền tải các **chỉ thị thay đổi** (Delta). Điều này tối ưu hóa băng thông và giảm thiểu rủi ro ghi đè nhầm các dữ liệu không liên quan.

#### 2.2.2. Các toán tử nguyên tử (Atomic Operations)

Hệ thống hỗ trợ 5 toán tử cốt lõi sau, được AI trả về dưới dạng mảng JSON:

**A. Toán tử replace (Thay thế)**
* **Chức năng:** Thay đổi giá trị của một nút (node) cụ thể trong cây dữ liệu JSON.
* **Cú pháp JSON:**
  ```json
  { "op": "replace", "path": "/Người_Chơi/HP", "value": 75 }
  ```

**B. Toán tử delta (Tăng giảm tương đối)**
* **Chức năng:** Cộng thêm hoặc trừ bớt một giá trị số vào đường dẫn đích mà không cần biết giá trị cũ.
* **Cú pháp JSON:**
  ```json
  { "op": "delta", "path": "/Người_Chơi/HP", "value": -15 }
  ```

**C. Toán tử insert (Chèn/Thêm mới)**
* **Chức năng:** Thêm một thuộc tính mới vào Object hoặc chèn một phần tử vào Array.
* **Cú pháp JSON (Thêm vật phẩm vào túi đồ dạng Record):**
  ```json
  { "op": "insert", "path": "/Người_Chơi/Túi_Đồ/Bản đồ", "value": { "Mô_Tả": "Bản đồ da dê", "Số_Lượng": 1 } }
  ```
* **Cú pháp JSON (Đẩy phần tử vào cuối mảng):**
  ```json
  { "op": "insert", "path": "/Mảng_Sự_Kiện/-", "value": "Sự kiện mới" }
  ```

**D. Toán tử remove (Loại bỏ)**
* **Chức năng:** Xóa một khóa khỏi Object hoặc loại bỏ một phần tử khỏi Array tại chỉ số xác định.
* **Cú pháp JSON:**
  ```json
  { "op": "remove", "path": "/Người_Chơi/Túi_Đồ/Thức ăn" }
  ```

**E. Toán tử move (Di chuyển)**
* **Chức năng:** Di chuyển một giá trị từ một đường dẫn nguồn sang một đường dẫn đích.
* **Cú pháp JSON:**
  ```json
  { "op": "move", "from": "/Người_Chơi/Bạc", "to": "/NPC/Trưởng_Thôn/Bạc" }
  ```

---

## 3. PHÂN TÍCH SO SÁNH: MVU vs. MVUZOD

Bảng dưới đây phân tích sự khác biệt về mặt kỹ thuật và hiệu năng giữa hai phương pháp.

| Tham số kỹ thuật | MVU Truyền thống (Regex-based) | MVUZOD (Schema & Patch-based) |
| :--- | :--- | :--- |
| **Giao thức Giao tiếp** | Giả lập mã nguồn (`_.set(...)`). Phụ thuộc vào khả năng sinh mã của AI. | Khối dữ liệu JSON Patch (`[{ "op": ... }]`). Tuân thủ RFC 6902 mở rộng. |
| **Độ tin cậy cú pháp** | Thấp. Nhạy cảm với các ký tự đặc biệt, xuống dòng, và khoảng trắng thừa. | Rất cao. Zod thực thi xác thực kiểu mạnh (Strong Typing) trước khi xử lý. |
| **Quản lý Cấu trúc dữ liệu** | Hạn chế. Thường chỉ xử lý tốt các kiểu dữ liệu nguyên thủy (Primitive types). Gặp khó khăn với Mảng/Object. | Mạnh mẽ. Hỗ trợ thao tác sâu vào các cấu trúc lồng nhau (Nested JSON), Bản ghi (Record), Mảng đa chiều. |
| **Cơ chế cập nhật** | Ghi đè (Overwrite) hoặc nối chuỗi (Concatenation). | Thao tác chính xác (Atomic Operations): Thay thế, Tăng giảm, Thêm, Xóa, Di chuyển tại vị trí cụ thể. |
| **Overhead (Token)** | Thấp hơn do cú pháp ngắn gọn. | Cao hơn do cấu trúc JSON chi tiết. Tuy nhiên, đánh đổi này mang lại sự ổn định hệ thống tuyệt đối. |

---

## 4. TRIỂN KHAI THỰC TẾ VÀ VÍ DỤ NÂNG CAO

### 4.1. Kịch bản quản lý Kho vật phẩm (Inventory Management)

Giả định tình huống: Người chơi nhận được vật phẩm "Bản đồ cổ".

**Phương pháp MVU Cũ (Rủi ro cao):**
AI có thể sinh ra lệnh:
```javascript
_.set('Túi_Đồ', 'Túi_Đồ + ", Bản đồ cổ"');
```
* **Phân tích lỗi:** Nếu `Túi_Đồ` ban đầu là một mảng hoặc đối tượng, lệnh trên có thể làm biến đổi kiểu dữ liệu thành chuỗi thô, phá vỡ cấu trúc và gây crash cho frontend.

**Phương pháp MVUZOD (Chuẩn hóa):**
AI trả về cấu trúc JSON Patch:
```json
[
  {
    "op": "insert",
    "path": "/Người_Chơi/Túi_Đồ/Bản đồ cổ",
    "value": { "Mô_Tả": "Bản đồ chỉ đường cổ xưa", "Số_Lượng": 1 }
  }
]
```
* **Phân tích kỹ thuật:** Thao tác này chèn an toàn một cặp key-value mới vào bản ghi `Túi_Đồ`, bảo toàn kiểu dữ liệu dạng đối tượng lồng nhau, giúp frontend dễ dàng lặp qua để hiển thị.

### 4.2. Kịch bản thay đổi trạng thái nhân vật (Character State Mutation)

Giả định tình huống: Nhân vật bị tấn công, giảm HP và thay đổi trạng thái sang "Bị thương".

**Triển khai MVUZOD:**
```json
[
  { "op": "delta", "path": "/Người_Chơi/HP", "value": -25 },
  { "op": "replace", "path": "/Người_Chơi/Trạng_Thái", "value": "Bị thương" }
]
```
* **Phân tích:** Việc sử dụng JSON Patch cho phép thực hiện cập nhật hàng loạt (Batch Update) một cách nguyên tử. Nếu giá trị HP sau khi trừ vượt quá giới hạn dưới (ví dụ âm), hàm `.transform` của Zod Schema sẽ tự động kẹp lại giá trị về `0` một cách an toàn mà không làm sập tiến trình.

---

## 5. KẾT LUẬN VÀ KHUYẾN NGHỊ KỸ THUẬT

Việc chuyển đổi sang MVUZOD là một bước tiến bắt buộc để nâng cấp SillyTavern từ một giao diện Chatbot đơn thuần thành một RPG Engine (Role-Playing Game Engine) hoàn chỉnh.

**Các lợi ích kỹ thuật cốt lõi:**
1. **Loại bỏ tính bất định:** Thay thế cơ chế "dự đoán" của Regex bằng cơ chế "xác thực" của Zod.  
2. **Quản lý trạng thái phức tạp:** Cho phép xây dựng các hệ thống kinh tế (Economy), nhiệm vụ (Quest Logs), và kỹ năng (Skill Trees) với độ sâu dữ liệu cao thông qua JSON Patch.  
3. **Toàn vẹn dữ liệu:** Đảm bảo dữ liệu đầu ra luôn đúng định dạng (Type Safety) và ngữ nghĩa.
