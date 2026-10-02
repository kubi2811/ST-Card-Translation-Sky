@gogopikachu.

# UPDATE v2.55.0 : FIX LINK ẢNH BỊ VỠ KHI DỊCH CARD EJS (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Key EJS hết "ăn" vào link ảnh (bug 247):**
- Trước đây: tool ép tên key EJS đã dịch lên MỌI chữ Hán trùng tên, kể cả chữ nằm trong tên file ảnh. Ví dụ `变身状态agp4lq.png` bị đổi thành `Biến thân状态agp4lq.png` → ảnh mất hẳn.
- Bây giờ: tool tự nhận ra đâu là link (`https://…`, `//…`, `./…`) hoặc tên file (`.png .jpg .webp .gif .mp3 …`) và **giữ nguyên từng ký tự**. Chữ bình thường vẫn được đồng bộ key như cũ.
- AI cũng được dặn thêm: không được dịch chữ nằm trong link hay tên file.

**Lưu ý:** card đã dịch trước bản này thì cần dịch lại (hoặc sửa tay) các entry có link ảnh bị vỡ.
