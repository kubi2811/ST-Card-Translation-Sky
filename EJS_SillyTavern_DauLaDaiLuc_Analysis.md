# Phân Tích Cấu Trúc EJS: Thẻ Nhân Vật "Đấu La Đại Lục 3.1"

Sau khi bạn yêu cầu đọc thêm thẻ `【Hoxilo】Đấu La Đại Lục 3.1.json`, tôi đã trích xuất và phân tích mã nguồn ngầm của nó. Nếu "Mùa Thu Tĩnh Lặng" sử dụng EJS để theo dõi sinh tồn và kết hợp với Regex để làm giao diện (Terminal UI), thì **"Đấu La Đại Lục" lại là một hệ sinh thái EJS thuần túy khổng lồ, biến SillyTavern thành một Game Engine Text-RPG hoàn chỉnh.**

Dưới đây là những kỹ thuật lập trình cực kỳ tinh vi mà tác giả đã sử dụng bằng EJS (thông qua ST-Prompt-Template):

---

## 1. Hệ Thống Biến Trạng Thái Đa Dạng (Khu vực 1)
Tác giả sử dụng EJS để liên tục đọc và quản lý một lượng lớn biến trạng thái người chơi và thế giới:
- **`_era` (Thời đại):** Hỗ trợ cả 3 phần của tiểu thuyết (Đấu 1, Đấu 2, Đấu 3).
- **`_period` & `_chapter`:** Theo dõi chính xác người chơi đang ở giai đoạn nào, chương cốt truyện nào.
- **`_area` & `_scene`:** Khu vực và bối cảnh hiện tại.
- **`_sType` (Loại cảnh):** Phân loại tình huống (Hàng ngày, Chiến đấu, Thi đấu, Liệp hồn, Mua sắm...).
- **`_soulLevel`:** Cấp bậc hồn lực của người chơi (Level).

## 2. Công Cụ Quét Ngữ Cảnh Thông Minh (Khu vực 2, 3, 4)
Đây là một kỹ thuật cực kỳ ấn tượng mà rất ít card làm được:
- **Tự động quét lịch sử chat:** EJS dùng hàm `getChatMessages()` để lấy 3 tin nhắn gần nhất của cả bạn và AI, gộp chúng lại thành một chuỗi văn bản lớn.
- **Từ điển Alias (Bí danh) khổng lồ:** Tác giả định nghĩa sẵn hàng trăm NPC và Địa điểm cho từng Thời đại. Ví dụ ở Đấu 1: "Đường Tam", "Tiểu Vũ", "Sử Lai Khắc"...
- **Kiểm tra sự hiện diện:** Mã EJS sẽ dò tìm xem trong 3 tin nhắn vừa qua có nhắc đến tên NPC hoặc Địa điểm nào trong từ điển không. Nếu có, nó tự động đánh dấu NPC/Địa điểm đó đang "có mặt" trong cảnh.

## 3. Hệ Thống Nạp Luật Chơi (Lorebook) Động
Thay vì nhồi nhét toàn bộ thế giới Đấu La Đại Lục vào đầu AI (sẽ gây tràn bộ nhớ và lú lẫn), EJS đóng vai trò như một người "nhắc tuồng", chỉ cung cấp thông tin khi thực sự cần thiết thông qua lệnh `await getwi()`:

### 3.1. Nạp bối cảnh theo Thời Đại
Tùy vào việc bạn chọn chơi ở Đấu 1, Đấu 2 hay Đấu 3, EJS sẽ chỉ nạp Cục diện thế giới, Bảng khoảng chương và Tổng cương niên biểu của đúng thời đại đó.

### 3.2. Nạp quy tắc theo Tình Huống (Trigger Rules)
EJS sẽ quét các từ khóa trong chat và tự động nạp các "Quy tắc cốt truyện" để ép AI viết đúng chuẩn:
- **Đánh giá Võ hồn:** Nếu nhắc đến "Võ hồn thức tỉnh", "Tiên thiên mãn hồn lực"... AI sẽ được nạp quy tắc về võ hồn.
- **Hồn thú & Hiến tế:** Nếu bạn là "Hồn thú" hoặc nhắc đến "Hiến tế", quy tắc hóa hình và hiến tế sẽ được nạp.
- **Quy tắc Chiến đấu:** Nếu loại cảnh (`_sType`) là Chiến đấu, hoặc có từ khóa "Phóng thích hồn kỹ", AI sẽ được nạp *Hướng dẫn miêu tả chiến đấu*.
- **Liệp hồn & Hấp thu hồn hoàn:** Nạp quy tắc tạo hồn thú và quy tắc sinh hồn kỹ.
- **Kinh tế:** Khi có từ khóa "Kim hồn tệ", "Đấu giá", AI sẽ được nạp *Hệ thống kinh tế*.

### 3.3. Hệ thống Sự Kiện / Đại Hội Độc Lập
Đấu La Đại Lục nổi tiếng với các giải đấu. EJS xử lý điều này cực mượt:
- Ở **Đấu 1**: Nhắc đến "Đại hội tinh anh" sẽ nạp luật thi đấu của Đấu 1.
- Ở **Đấu 2**: Hỗ trợ nạp luật cho "Khảo hạch tân sinh", "Hải Thần Duyên" (Xem mắt), "Đại hội đấu hồn".
- Ở **Đấu 3**: Hỗ trợ luật thi đấu "Ngũ Thần Chi Quyết", "Tinh Đẩu Chiến Võng", "Thí Thần Đại Trận".

---

## Tổng Kết

Nếu **Mùa Thu Tĩnh Lặng** thiên về mặt **Trình bày Giao diện (Frontend)** kết hợp theo dõi chỉ số, thì **Đấu La Đại Lục 3.1** là một đỉnh cao của xử lý **Logic Kịch bản (Backend)**. 

Bằng cách dùng EJS để đọc lịch sử chat, phân loại tình huống và điều khiển hệ thống Lorebook (World Info) tự động nạp nhả dữ liệu, tác giả đã tạo ra một Text-RPG thế giới mở cực kỳ trơn tru, nơi AI luôn hiểu chính xác nó cần làm gì ở mọi thời điểm, mọi bối cảnh, với mọi nhân vật mà không bao giờ bị quá tải bộ nhớ.
