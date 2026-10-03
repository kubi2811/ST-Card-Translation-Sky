@PhatSiz

# UPDATE v2.59.0 : GIỮ NGUYÊN TÊN ENTRY EJS KHI CARD GHÉP TÊN LÚC CHẠY (NHỚ BẤM UPDATE)

Trả lời câu bạn hỏi về `技能体系_执行指令` → "Hệ Thống Kỹ Năng Thực Thi Chỉ Thị":

**1) Khi nào dịch tên entry EJS là ổn, khi nào là vỡ:**
- **Ổn**: code gọi entry bằng tên viết sẵn, ví dụ `getwi(null, '技能体系_执行指令')`. Chiến lược C dịch tên một lần rồi đồng bộ cả hai đầu (tên entry + chỗ gọi).
- **Vỡ**: code **ghép tên lúc chạy**, ví dụ `getwi(null, 模块 + '_执行指令')`, `` `${x}_执行指令` `` hay `e.comment.endsWith('_执行指令')`. Phần đầu tên đến từ biến lúc chạy nên không dịch khớp được. Trước đây tool không nhận ra trường hợp này: tên vẫn bị dịch và entry **không còn được gọi tới**, cũng không có lỗi nào báo.

**2) Tool giờ tự nhận ra và giữ nguyên:**
- Tool dò mọi lời gọi `getwi / activewi / getWorldInfo…` dùng tên ghép, cùng các phép so `.comment / .name` kiểu `endsWith / startsWith / includes`.
- Entry nào có tên chứa mảnh ghép (như `_执行指令`) thì **giữ nguyên tên gốc**. Mảnh ghép trong code cũng được giữ nguyên, và tool dặn AI không được đụng vào.
- Panel **Chiến lược C (EJS)** có khung vàng ghi rõ card ghép tên kiểu gì và những entry nào được giữ nguyên.
- Lỡ AI vẫn dịch mất mảnh ghép trong code thì nhật ký dịch sẽ cảnh báo đúng entry đó.

Card nào gọi bằng tên viết sẵn thì vẫn dịch tên bình thường như cũ.
