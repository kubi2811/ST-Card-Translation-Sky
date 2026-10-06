@PhatSiz

# UPDATE v2.62.0 : GIAO DIỆN THANH TRẠNG THÁI DỊCH XONG KHÔNG CÒN GÃY (NHỚ BẤM UPDATE)

Cảm ơn bạn gửi bản gốc + bản lỗi + bản đã sửa tay của thẻ Thần Hào — mình đối chiếu cả ba.

Có gì mới / đã fix:

**1) Màu phẩm chất mất hết (Tinh Anh, Sử Thi, Truyền Thuyết…):**
- Trước đây: class `q-精英` dịch thành `q-Tinh Anh` — dấu cách tách nó làm hai, CSS không khớp.
- Bây giờ: CSS được viết lại để khớp cả `q-Tinh-Anh` lẫn `q-Tinh Anh`, không phải sửa code của thẻ.

**2) Font bị dịch thành "Hắc Thể":** tên font không bao giờ bị dịch nữa (font Việt vẫn tự chèn lên trước). `<html lang="zh-CN">` tự đổi thành `vi`.

**3) "vô", "nễ", "niên/nguyệt/nhật", "thứ", "nhân", "thiên/vạn/ức", "nhất…lục":**
- Trước đây: chữ Hán đơn nằm giữa code bị AI phiên âm Hán-Việt, mỗi chỗ một kiểu ⇒ phép so sánh và regex ngày/đơn vị/số lần không khớp chữ AI viết lúc chơi.
- Bây giờ: các chữ này dịch theo **bảng cố định** — 无→Không, 你→Bạn, 年月日→Năm/Tháng/Ngày, 次→lần, 人→người, 千/万/亿→nghìn/vạn/trăm triệu, thứ trong tuần→Hai…Bảy/Chủ Nhật, 岁→tuổi…
- `[日号]` trong regex không còn thành `[Ngày mùng]` (khớp từng chữ cái) mà đúng nghĩa "Ngày hoặc ngày".

**Lưu ý:** cần **dịch lại** regex thanh trạng thái. Lỗi của chính thẻ (escape HTML, cộng thưởng 2 lần, thừa `</div>`…) thì bản sửa tay của bạn vẫn cần. Thứ tự ngày "Ngày 06 Tháng 10 Năm 2026" vs regex "2026 Năm 10 Tháng" thì tool không đảo được — vẫn cần hàm đọc ngày như bản sửa tay.
