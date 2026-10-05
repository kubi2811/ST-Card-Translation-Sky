@PhatSiz — bug 254 (từ điển MVU: `鞋子_tag` → "Giày tag") ✅ đã sửa ở **v2.60.1**

**Có ổn không?** Trước bản này thì *thường* vẫn chạy, nhưng có một trường hợp hỏng âm thầm:
- Nếu card ghi tên biến đầy đủ ở mọi nơi (`stat_data.服装.鞋子_tag`) → tool thay đồng loạt, "Giày tag" vẫn khớp.
- Nhưng loạt key cùng đuôi `_tag` (giày / phụ kiện / áo lót / quần lót) rất hay được script **ghép bằng code**: `data[部位 + '_tag']`. Sau dịch `部位` thành "Giày", chuỗi `'_tag'` trong code giữ nguyên → script tìm `Giày_tag`, còn biến thật là `Giày tag` → tag không hiện / không cập nhật, không báo lỗi gì.

**Vì sao ra dấu cách:** từ bug #8 tool đổi `_` → dấu cách cho mọi tên biến tiếng Việt (AI hay nối bậy `Lưu_Tam_Bảo`). Luật đó ăn luôn cả đuôi code `_tag` dù prompt đã dặn AI giữ dấu của nguồn.

**Giờ:**
• Key nguồn có đuôi code ASCII (`鞋子_tag`, `场景_sfw`, `好感_max`…) → bản dịch giữ **đúng đuôi**: `Giày_tag`, `Phụ Kiện_tag`, `Áo Lót_tag`. Phần thân tiếng Việt vẫn dùng dấu cách như cũ.
• Có cả `鞋子` → "Giày" thì `鞋子_tag` **luôn** là "Giày" + "_tag" — ghép key động mới ra đúng tên. Mục bạn tự sửa tay thì tool để nguyên.
• Lượt quét `_` → dấu cách không còn phá đuôi code nữa (`Lưu_Tam_Bảo` vẫn về `Lưu Tam Bảo`).

**Card đã dịch rồi:** mở lại, từ điển tự chuẩn về `Giày_tag`; bấm **"Đồng nhất tên biến MVU"** để tool sửa lại "Giày tag" trong script/regex/lorebook theo từ điển mới (hoặc dịch lại các entry code cho chắc).

Kiểm tra nhanh card có ghép key động không: tìm `'_tag'` hoặc `}_tag` trong script của card gốc.
