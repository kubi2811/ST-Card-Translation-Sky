# Đại nâng cấp EJS Studio (nối tiếp bug 126) — 2026-07-28

## 9 yêu cầu của user → thiết kế

1. **Nhóm các mục kế hoạch theo liên quan** — 3 tiêu chí: cùng đọc/ghi 1 biến MVU; getwi()
   tới nhau; cùng chuỗi if/else-if. Ngoài ra là độc lập. Từ chối nhóm chỉ ảnh hưởng nhóm đó;
   trong nhóm vẫn duyệt từng entry.
   → `ejsPlanGroups.ts` (mới): union-find tất định trên rows, cạnh = 3 tiêu chí trên
   (biến từ `varsUsed` + getvar/setvar bóc từ nội dung entry đích; getwi/activewi giữa các
   entry; chuỗi `if/else if` bóc từ controller có sẵn). Nhóm là DISJOINT nên từ chối không
   lan. UI: khung nhóm + nút Từ chối cả nhóm; nút từng dòng giữ nguyên.

2. **Tách 1 entry → N entry** khi các phần có điều kiện kích hoạt khác nhau và độc lập —
   không tách nội dung luôn đi cùng nhau; tham chiếu getwi tới entry bị tách phải được cập
   nhật, không gãy link; việc tách phải nằm TRONG bảng kế hoạch để duyệt trước.
   → PlanAction mới `split_entry` + `EjsPlanRow.splitInto[{name, mode, criterion}]`;
   prompt dạy luật tách; thực thi ở `ejsSplit.ts` (1 call AI/row trả JSON các entry con,
   validate rồi mới áp); entry gốc TẮT đi (không xoá — còn hoàn tác); mapping cũ→mới đưa
   cho bộ vá tham chiếu.

3. **"Tiết kiệm Token" không áp vào entry MVU** → `isMvuCriticalEntry` ([initvar], quy tắc
   cập nhật, danh sách biến, khối EJS/@@preprocessing, entry chứa <UpdateVariable>/stat_data
   khởi tạo): suggestReclassification bỏ qua; PLAN_SYSTEM cấm; parseRichPlan lọc dòng
   reclassify trỏ vào entry MVU + warning nói rõ.

4. **Tính năng MVU mới** → 4 Quick Preset: 🧹 Chuẩn hoá dữ liệu (sửa GIÁ TRỊ lệch schema,
   không sửa schema), 📝 Tóm tắt trạng thái cho AI, 🚨 Cảnh báo ngưỡng, 📈 Diễn giải
   thay đổi chỉ số giữa các lượt.

5. **Xem trước/sau khi chạy xong** → panel Hoàn thành hiện bảng before/after từng đối
   tượng (chế độ kích hoạt cũ→mới, nội dung cũ→mới/các phần tách), không chỉ tên.

6. **Test mode trong tool** → `ejsTestMode.ts`: `proposeTestValues` bóc tất định các mốc
   so sánh trong code (getvar path + literal) để đề xuất giá trị thử; `simulateActivation`
   chạy scriptlet trong sandbox (stub getvar/activewi/getwi/setvar) + so key với văn bản
   mẫu → bảng entry nào kích hoạt/không, vì sao. UI nhập giá trị + nút Chạy thử.

7. **Rà xung đột sau khi sinh kế hoạch, vá khi thật sự có lỗi** → mở rộng quét: key trùng/
   bao nhau giữa các entry (cảnh báo trong plan.warnings); 2 khối cùng activewi 1 entry
   (cảnh báo mức warning — có thể cố ý); giữ autopatch tất định sẵn có cho trùng tên/biến.
   Sạch thì báo sạch, không bịa lỗi để vá.

8. **Kiểm getwi()/tham chiếu sau khi chạy** → `ejsRefIntegrity.ts`: quét toàn lorebook
   (+ draft mới) tìm getwi/activewi trỏ tên không tồn tại; vá tất định theo mapping
   (đổi tên do autopatch, tách entry: getwi → nối nội dung các phần, activewi → kích hoạt
   lần lượt các phần bằng biểu thức phẩy); không đoán mò tên — chỉ vá khi có mapping hoặc
   khớp không phân biệt hoa-thường/khoảng trắng; còn lại báo lỗi rõ.

9. **Ước token tăng/giảm trong bảng kế hoạch** → tokensDelta từng dòng (reclassify khỏi
   constant: −token(entry); tách entry constant: −token×(N−1)/N; tạo khối EJS: +40 ước
   lượng; sửa nội dung: 0) + tổng hiển thị trên header bảng trước khi duyệt.

## Nguyên tắc chung
- Máy làm được thì máy làm tất định (nhóm, quét, vá, ước token, mô phỏng) — AI chỉ dùng cho
  việc cần hiểu nội dung (kế hoạch, chia nội dung entry khi tách).
- Mọi thay đổi card đều nằm trong snapshot hoàn tác sẵn có.
- Test: unit cho từng mô-đun tất định + giữ xanh ejsPlan126/ejsPolicy127.
