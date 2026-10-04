@PhatSiz

# UPDATE v2.60.0 : FONT TIẾNG VIỆT CHO REGEX — HẾT CHỮ LỒI LÕM (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Dịch regex xong là có font hiển thị đủ tiếng Việt (bug 252):**
- Trước đây: các font Trung/Nhật hay dùng trong card (Noto Serif SC, 霞鹜文楷/LXGW WenKai, Ma Shan Zheng, ZCOOL, 微软雅黑…) thiếu phần lớn chữ có dấu tiếng Việt. Chữ thiếu bị trình duyệt mượn tạm từ font khác, nên trong cùng một từ có chữ đậm chữ nhạt, chữ to chữ nhỏ. Bộ đổi font cũ chỉ biết vài font Windows, và còn có thể làm vỡ script.
- Bây giờ: tool tự **chèn font hỗ trợ đủ tiếng Việt lên trước font gốc**, chọn theo đúng kiểu chữ:
  - Font có chân (宋体, Noto Serif SC…) → **Noto Serif**
  - Font không chân (黑体, 微软雅黑, PingFang…) → **Be Vietnam Pro**
  - Thư pháp / viết tay (楷体, 霞鹜文楷, Ma Shan Zheng…) → **Lora**
- Font gốc vẫn giữ phía sau làm dự phòng, nên giao diện gốc không bị phá. Tool tự nạp font từ Google Fonts, nên máy Mac hay điện thoại cũng hiển thị giống nhau.
- Áp cho CSS, `style="…"` và cả font đặt trong code JS. Không bao giờ làm vỡ dấu nháy của script.

Đã chạy thử thật: regex dùng `Noto Serif SC` và `LXGW WenKai` sau khi dịch hiển thị tiếng Việt bằng Noto Serif / Lora.
