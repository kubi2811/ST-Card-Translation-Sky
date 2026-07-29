# HƯỚNG DẪN SỬ DỤNG TOÀN DIỆN: TAVERN CARD STUDIO

Chào mừng bạn đến với **Tavern Card Studio (SillyLore AI Studio)** — Công cụ chuyên biệt tối thượng giúp thiết kế, tối ưu hóa và đồng bộ thẻ nhân vật (Character Cards) chuẩn định dạng V3 cho SillyTavern.

Tài liệu này sẽ hướng dẫn bạn chi tiết từng bước cách sử dụng các tính năng từ cơ bản đến nâng cao trong hệ thống, bao gồm cẩm nang viết thẻ, xây dựng hệ thống RPG động qua MVUZOD, viết kịch bản Regex, EJS Preprocessing, cào Fandom Wiki và đồng bộ thời gian thực với SillyTavern.

---

## 📌 MỤC LỤC

1. [Giới Thiệu & Cài Đặt](#1-giới-thiệu--cài-đặt)
2. [⚙️ Cài Đặt AI & Đồng Bộ (SettingsPage)](#2-cài-đặt-ai--đồng-bộ-settingspage)
3. [📝 Trình Biên Tập Thẻ (CardEditorPage)](#3-trình-biên-tập-thẻ-cardeditorpage)
4. [📚 Quản Lý Sổ Tay Tri Thức (LorebookPage)](#4-quản-lý-sổ-tay-tri-thức-lorebookpage)
5. [🪄 Trình Tạo Thẻ Tự Động (AutoCreatorPage)](#5-trình-tạo-thẻ-tự-động-autocreatorpage)
6. [🧩 Phòng Thí Nghiệm Biểu Thức (RegexLabPage)](#6-phòng-thí-nghiệm-biểu-thức-regexlabpage)
7. [🛠 Xưởng Biến RPG Động (MVUZOD Studio)](#7-xưởng-biến-rpg-động-mvuzod-studio)
8. [📜 Phòng Thiết Kế Mẫu EJS (EJS Studio)](#8-phòng-thiết-kế-mẫu-ejs-ejs-studio)
9. [🕸 Bộ Thu Thập Wiki (Wiki Collector)](#9-bộ-thu-thập-wiki-wiki-collector)
10. [📤 Quy Trình Xuất Bản & Khắc Phục Sự Cố](#10-quy-trình-xuất-bản--khắc-phục-sự-cố)
11. [🆕 Tính Năng Bổ Sung (bản mới)](#11-tính-năng-bổ-sung-bản-mới)

---

## 1. GIỚI THIỆU & CÀI ĐẶT

### Tavern Card Studio là gì?
Tavern Card Studio là một nền tảng Web All-in-One được phát triển để giải quyết các khó khăn lớn nhất khi viết thẻ nhân vật AI:
*   **Tránh phân tán Attention (Sự chú ý):** Chuyển các thiết lập tĩnh khổng lồ từ đầu thẻ vào Worldbook (Lorebook) một cách khoa học.
*   **Cơ chế RPG Động:** Quản lý biến trạng thái (HP, MP, Vị trí, Mối quan hệ) bằng chuẩn dữ liệu nghiêm ngặt **Zod 4** và cơ chế cập nhật gia số **JSON Patch (RFC 6902)**.
*   **Tạo Thẻ Bằng AI:** Tích hợp pipeline tạo nhân vật chuẩn (7 bước) và quy trình chuyên sâu **Minh Nguyệt Thu Thanh** (10 bước).
*   **Đồng bộ thời gian thực:** Đẩy trực tiếp thiết kế từ studio sang SillyTavern đang chạy chỉ bằng 1 cú click chuột.

### Yêu Cầu Hệ Thống & Cài Đặt
1.  **Môi trường:** Máy tính đã cài đặt **Node.js** (Khuyến nghị phiên bản LTS v18 trở lên).
2.  **Khởi tạo dự án:**
    *   Mở Terminal tại thư mục dự án và chạy lệnh cài đặt thư viện:
        ```bash
        npm install
        ```
    *   Khởi chạy môi trường phát triển (Local Dev Server):
        ```bash
        npm run dev
        ```
    *   Mở trình duyệt và truy cập địa chỉ mặc định: [http://localhost:5173](http://localhost:5173)

---

## 2. ⚙️ CÀI ĐẶT AI & ĐỒNG BỘ (SettingsPage)

Trang Cài đặt là trái tim vận hành toàn bộ các dịch vụ AI và các cổng kết nối dữ liệu đến SillyTavern. Trang này được chia làm 3 phân vùng chính: **Kết nối AI**, **Cài đặt Pipeline**, và **Đồng bộ SillyTavern**.

### 2.1 Kết Nối AI (Proxy Profiles)
Hệ thống cho phép bạn tạo nhiều cấu hình kết nối AI khác nhau (Profiles) phù hợp với từng nhà cung cấp:
*   **Các Provider hỗ trợ:** OpenAI-compatible (các proxy trung gian), Claude (Anthropic), Gemini (Google AI), và Custom Endpoint.
*   **Model Scanning:** Sau khi nhập API URL và API Key, hãy nhấn nút **Quét danh sách Model** để tải danh sách các dòng model khả dụng trên server về lưu vào cache local.
*   **Chiến lược Phân Vùng Đa Model (Pro & Flash):**
    *   *Model chính (Primary Model - Pro):* Dùng để xử lý các tác vụ phức tạp đòi hỏi tư duy logic cao, lập luận nhân thiết (như tạo cốt truyện, tính cách chiều sâu). Ví dụ: `gemini-3.1-pro-preview`, `claude-3-5-sonnet`.
    *   *Model phụ (Secondary Model - Flash):* Kích hoạt qua tùy chọn "Kích hoạt Model phụ". Dùng cho các tác vụ mang tính chất lặp lại, xử lý dữ liệu số lượng lớn cần tốc độ nhanh và chi phí rẻ (như dọn trùng lặp ngữ nghĩa, dịch thuật, phân loại entry). Ví dụ: `gemini-3.5-flash`, `gemini-3-flash`.

> [!TIP]
> **mixMode (Dual Model Processing):** Bật tùy chọn này giúp hệ thống tự động điều phối: Tác vụ tư duy gửi cho Model Pro, tác vụ cấu hình kỹ thuật gửi cho Model Flash chạy song công. Giúp đẩy nhanh tốc độ sinh thẻ lên gấp **3 lần** mà vẫn đảm bảo độ sâu chất lượng.

### 2.2 Tham Số Sinh (Generation Params)
*   **Temperature (Nhiệt độ):** Khuyến nghị `1.1` cho viết nhân thiết sáng tạo; giảm xuống `0.3 - 0.5` khi cần AI trả cấu trúc JSON/Zod chính xác.
*   **Top-P, Top-K:** Giới hạn phạm vi từ vựng sáng tạo của AI.
*   **Min Tokens:** Ép AI viết dài (mặc định `4000` tokens). Khi kết hợp với **Giao thức Ép Hoàn Thiện (Completeness Protocol)**, AI sẽ không bao giờ trả về nội dung tóm tắt hay các đoạn giữ chỗ (placeholder) vô nghĩa.

### 2.3 Quản Lý Quy Trình (Pipeline Steps)
Trong tab *Quy trình trích xuất*, bạn có thể chỉnh sửa trực tiếp 5 bước mặc định của quy trình sinh Worldbook hoặc khôi phục về mặc định. Bạn có thể thêm bước mới, bật/tắt, viết lại chỉ thị Prompt và kéo thả sắp xếp lại thứ tự ưu tiên.

### 2.4 Trợ lý Baka & Hướng Dẫn Tổng
*   **Master Instruction:** Chứa cẩm nang hướng dẫn cấu hình kỹ thuật Worldbook chuẩn để AI đọc và làm theo.
*   **Nút "Trợ lý đọc hướng dẫn":** Khi bấm nút này, hệ thống sẽ gửi Master Instruction cho AI đọc. AI sẽ tóm tắt lại thành các quy tắc cốt lõi bằng giọng điệu "Baka" siêu dễ thương (e.g. *oii~, baka nya~ 🌸*) và lưu vào bộ nhớ đệm `aiPipelineMemory` để điều hướng các lượt sinh thẻ tiếp theo.

### 2.5 Kết Nối Đồng Bộ SillyTavern (Tavern Helper Sync)
Dịch vụ đồng bộ hỗ trợ **3 chế độ kết nối** để đẩy dữ liệu card trực tiếp sang SillyTavern mà không cần export/import thủ công:

| Chế độ | Cách kết nối | Ưu điểm / Nhược điểm |
| :--- | :--- | :--- |
| **REST API** | Nhập URL gốc của SillyTavern (e.g., `http://localhost:8000`). Nhấn **Kết nối**. | • Cực kỳ đơn giản, không cần cài đặt thêm phần mềm.<br>• Chỉ hoạt động khi SillyTavern mở cổng API không khóa mật khẩu. |
| **WebSocket** | Nhập WebSocket URL của Tavern Helper (e.g., `ws://localhost:5001`). Bật **Auto-reconnect**. | • Kết nối hai chiều thời gian thực.<br>• Tốc độ truyền tải tức thì.<br>• Cần Tavern Helper chạy socket server ở cổng chỉ định. |
| **Server Plugin** | 1. Sao chép thư mục `public/st-plugins/card-sync/` vào thư mục `SillyTavern/plugins/card-sync/`.<br>2. Sửa file `SillyTavern/config.yaml`, đặt `enableServerPlugins: true`.<br>3. Khởi động lại SillyTavern.<br>4. Nhập Endpoint: `http://localhost:8000/api/plugins/card-sync`. | • Phương thức chính quy, an toàn nhất.<br>• Tự động ghi đè hoặc tạo mới file JSON nhân vật trực tiếp trên ổ đĩa máy chủ SillyTavern.<br>• Tránh được các lỗi chặn CORS trình duyệt. |

*   **Auto-sync khi lưu:** Khi bật tính năng này, bất cứ khi nào bạn nhấn nút **Lưu (Save)** trong Card Editor, hệ thống sẽ tự động thực hiện quá trình push dữ liệu đồng bộ sang SillyTavern.
*   **Sync Log:** Bảng theo dõi lịch sử kết nối hiển thị các log chi tiết (thời gian, trạng thái thành công/thất bại, thông điệp lỗi từ API) giúp bạn dễ dàng debug khi gặp sự cố ngắt kết nối.

---

## 3. 📝 TRÌNH BIÊN TẬP THẺ (CardEditorPage)

Trình biên tập thẻ (Card Editor) cung cấp giao diện trực quan để bạn điền các trường dữ liệu theo đặc tả thẻ nhân vật định dạng V2/V3 mới nhất.

### 3.1 Quản Lý Dự Án & Snapshot
*   **Auto-save:** Hệ thống tự động lưu mọi thay đổi vào bộ nhớ đĩa cục bộ và `localStorage` sau **1.2 giây** kể từ khi bạn ngừng gõ (nhằm tránh mất mát dữ liệu khi mất điện hoặc trình duyệt reload).
*   **Snapshot (Lịch sử phiên bản):** Mỗi lần lưu thẻ thành công, hệ thống sẽ tạo một snapshot. Bạn có thể xem danh sách các mốc thời gian trước đó và thực hiện phục hồi (Undo/Rollback) về trạng thái cũ nếu lỡ tay xóa nhầm.

### 3.2 Hướng Dẫn Điền Các Trường Nhân Thiết
*   **Name (Tên nhân vật):** Tên định danh hiển thị trên khung chat.
*   **Description (Mô tả hệ thống):**
    > [!IMPORTANT]
    > Đối với các thẻ nhân vật nâng cao sử dụng hệ thống Zod + MVU, hãy **để trống** hoặc viết cực kỳ ngắn gọn vai trò của nhân vật tại trường này. Toàn bộ thiết lập chi tiết về ngoại hình, tiểu sử và tính cách của nhân vật nên được đưa vào **Lorebook (Worldbook)** ở chế độ Thường trú (Constant: True). Điều này giúp giải phóng sự chú ý của AI, tránh bị loạn context khi chat.
*   **Personality & Scenario:** Dùng để định hình bối cảnh giao tiếp hiện tại của nhân vật.
*   **System Prompt & Depth Prompt:** Các chỉ thị hệ thống điều hướng AI diễn vai.
*   **First Message (Lời mở đầu) & Alternate Greetings:**
    *   Tin nhắn đầu tiên cực kỳ quan trọng để khởi tạo UI và trạng thái biến.
    *   **Neo Giao Diện:** Ở cuối tin nhắn mở đầu, bạn **bắt buộc** phải đặt thẻ tự đóng `<StatusPlaceHolderImpl/>`. Thẻ này là nơi hệ thống Regex của SillyTavern sẽ tìm đến để vẽ khung giao diện chỉ số HUD của game lên màn hình.
    *   **Khởi tạo biến:** Nếu muốn khởi tạo giá trị biến tùy biến riêng cho từng greeting khác nhau, hãy nhúng khối XML trực tiếp phía trên thẻ neo:
        ```xml
        <UpdateVariable>
        [
          { "op": "replace", "path": "/Người_Chơi/Vị_Trí", "value": "Thôn nhỏ ngoại vi" }
        ]
        </UpdateVariable>
        <StatusPlaceHolderImpl/>
        ```
*   **Message Examples:** Các đoạn hội thoại mẫu theo cấu trúc `<START>` để AI học văn phong, khẩu khí của nhân vật.
*   **Tags & Creator Notes:** Thêm nhãn phân loại và ghi chú của tác giả viết thẻ.

### 3.3 Giao Diện Xuất Bản (Export Wizard)
Bấm nút **Xuất bản Card** ở góc trên cùng bên phải để mở Wizard:
1.  **Xuất file JSON:** Xuất ra file dữ liệu thô định dạng `.json` chuẩn `chara_card_v3`.
2.  **Xuất file PNG (Nhúng thẻ):** Bạn có thể tải lên một ảnh chân dung nhân vật (định dạng PNG). Hệ thống sẽ tự động mã hóa toàn bộ dữ liệu JSON của thẻ nhân vật và nhúng ẩn vào siêu dữ liệu (metadata/EXIF) của bức ảnh. File ảnh tải về vừa có thể xem được, vừa có thể kéo thả trực tiếp vào SillyTavern để nhận diện nhân vật ngay lập tức.

---

## 4. 📚 QUẢN LÝ SỔ TAY TRI THỨC (LorebookPage)

Lorebook (Worldbook) là nơi chứa toàn bộ tri thức của nhân vật và bối cảnh thế giới quan. Hệ thống quản lý Lorebook được thiết kế dưới dạng Workspace đa nhiệm với các tab công cụ chuyên biệt.

### 4.1 Danh Sách Entries & Trình Biên Tập Chi Tiết
Giao diện danh sách được tối ưu bằng bộ ảo hóa danh sách (**Virtualized List**) giúp hiển thị mượt mà hàng ngàn entries mà không bị giật lag trình duyệt.
*   **Bộ lọc thông minh:** Tìm kiếm nhanh theo tên (comment), lọc theo Vị trí tiêm (position), lọc trạng thái hoạt động (enabled/disabled), và sắp xếp theo Thứ tự hiển thị, Độ dài nội dung hay Insertion Order.
*   **Cấu hình kỹ thuật của 1 Entry:**
    *   *Constant (Thường trú - Đèn xanh dương):* Entry luôn luôn xuất hiện trong context của AI bất kể có từ khóa nào xuất hiện hay không.
    *   *Selective (Kích hoạt - Đèn xanh lá):* Entry chỉ được nạp vào context khi trong tin nhắn chat gần đây xuất hiện các từ khóa kích hoạt (keywords) được cấu hình.
    *   *Position (Vị trí tiêm):* Nơi chèn entry vào Prompt gửi AI. Gồm các vị trí quan trọng như `before_char` (trước định nghĩa nhân vật), `after_char` (sau định nghĩa nhân vật), và `at_depth` (độ sâu cụ thể tại cuối context).
    *   *Order (Thứ tự chèn):* Số thứ tự ưu tiên. Số càng lớn thì entry càng nằm gần đáy context (được AI chú ý nhiều hơn).
    *   *Chặn đệ quy an toàn:* Bắt buộc phải tích chọn **Không đệ quy (exclude_recursion)** và **Ngăn đệ quy tiếp diễn (prevent_recursion)** trên mọi entry mô tả tĩnh để tránh tình trạng kích hoạt chéo lặp vô hạn làm bùng nổ token.

### 4.2 Dọn Trùng Lặp Ngữ Nghĩa (Semantic Deduplication)
Nằm tại thanh công cụ của tab *Danh sách Entries*. Khi bạn bấm **Dọn trùng lặp ngữ nghĩa**:
1.  Hệ thống sẽ chạy thuật toán so khớp từ khóa và ngữ nghĩa cục bộ để gom các entry có khả năng trùng lặp vào các cụm (clusters) từ 2 đến 6 mục.
2.  Gửi các cụm này lên **Model phụ (Secondary Model - Flash)** để phân tích sâu.
3.  AI sẽ tự động hòa trộn nội dung các mục trùng lặp, gom các từ khóa kích hoạt lại với nhau và tạo ra một entry hợp nhất hoàn hảo, đồng thời xóa bỏ các entry cũ thừa thãi.

### 4.3 Worldbook Health Check (Kiểm tra sức khỏe Worldbook)
Bảng kiểm tra sức khỏe chạy ngầm ở góc dưới danh sách entries và sẽ cảnh báo màu vàng/đỏ khi phát hiện cấu hình lỗi:
*   **Lỗi chưa bật chặn đệ quy:** Cảnh báo các entry chưa bật chặn đệ quy.
*   **Lỗi phân bổ loại card:**
    *   *Thẻ đơn nhân vật:* Cảnh báo nếu bạn đặt các entry quan trọng như ngoại hình, tính cách của nhân vật chính ở dạng đèn xanh lá (Selective) thay vì đèn xanh dương (Constant).
    *   *Thẻ đa nhân vật:* Cảnh báo nếu các thông tin riêng của nhân vật phụ lại để đèn xanh dương (Constant) làm loãng context của nhân vật chính.
*   **Lỗi vị trí tiêm:** Cảnh báo nếu cấu hình vị trí `at_depth` có độ sâu lớn hơn 0 mà không có vai trò phù hợp.

### 4.4 RAG Debug (Giả lập kích hoạt từ khóa)
*   Nhập thử một câu chat giả lập của người dùng hoặc phản hồi của AI vào ô kiểm thử.
*   Nhấn **Chạy kiểm tra**. Hệ thống sẽ quét toàn bộ danh sách từ khóa kích hoạt của Lorebook và hiển thị trực quan danh sách các entry nào sẽ được nạp (inject) vào context tại lượt chat đó, giúp bạn tinh chỉnh hệ thống từ khóa tránh bị sót hoặc bị nạp quá nhiều.

### 4.5 AI Sinh theo Batch (BatchGeneratorPanel)
Tab thứ 2 giúp bạn sinh nhanh hàng loạt entries trong vài giây:
*   Nhập mô tả tổng quan về thế giới hoặc danh sách các nhân vật, địa danh cần viết.
*   Thiết lập số lượng entry mong muốn sinh ra trong một lượt.
*   Hệ thống sẽ chia nhỏ yêu cầu, chạy đa luồng thông qua API Rate Limiter để sinh hàng loạt entries sạch lỗi, tự động điền sẵn từ khóa kích hoạt phù hợp và phân loại nhóm tương ứng.

### 4.6 Trích Xuất Tài Liệu (DocExtractPanel)
*   Tải lên một file tài liệu cốt truyện thô dạng `.txt`.
*   Thiết lập kích thước cắt đoạn (chunk size) để tránh vượt quá context AI.
*   AI sẽ đọc từng phân đoạn tài liệu, phân tích thông tin về nhân vật, vật phẩm hay địa danh xuất hiện trong đoạn đó và tự động trích xuất chúng thành các entry Lorebook hoàn chỉnh.

### 4.7 Cào Wiki (WikiScraperPanel)
Công cụ cào dữ liệu tối tân từ các trang wiki/fandom:
1.  **Crawl Navigation:** Nhập link trang chủ Wiki (ví dụ: Fandom Wiki của một bộ anime). Hệ thống sẽ tự động quét cấu trúc menu điều hướng 3 lớp để lấy danh sách toàn bộ các trang nội dung.
2.  **Chọn Trang & Bộ lọc META:** Chọn các trang bạn muốn thu thập tri thức. Bạn có thể bật **Bộ lọc META** để tự động loại bỏ các trang rác không chứa thông tin nhân vật (e.g., các trang về tập phim, nhạc phim - OST, diễn viên lồng tiếng - Seiyuu, lịch sử biên tập của wiki).
3.  **Sinh tự động:** Dữ liệu sau khi lọc được đưa vào pipeline AI để tạo ra hàng loạt entry Lorebook chuẩn hóa cấu trúc.

### 4.8 Phân Tích & Tối Ưu Cấu Trúc (LorebookCategorizationPanel)
Giúp bạn rà soát lại toàn bộ cấu trúc Lorebook theo hệ thống phân loại 5 Nhóm (OrderLorebook) của SillyTavern:

```
[Nhóm 1: Hệ thống sức mạnh] (Order: 900, Position: D0 system)
             ↓
[Nhóm 2: Thế giới quan vĩ mô] (Order: 800, Position: before_char constant)
             ↓
[Nhóm 3: Nhân vật chính/phụ] (Order: 200/99, Position: after_char selective)
             ↓
[Nhóm 4: Phe phái, tổ chức] (Order: 150, Position: after_char selective)
             ↓
[Nhóm 5: Địa điểm, khu vực] (Order: 100, Position: after_char selective)
```

Bạn có thể nhấn nút **Tối ưu hóa bằng AI**. AI sẽ quét toàn bộ danh sách, tự động điều chỉnh lại `position`, `order`, và `keys` của từng entry cho đúng với vai trò của nó để đạt hiệu năng token tối ưu nhất.

### 4.9 Chất lượng MN (QualityCheckPanel)
Rà soát chất lượng Lorebook theo quy chuẩn "Minh Nguyệt Thu Thanh":
*   **Kiểm tra Bát Cổ:** Xác thực cấu trúc của các entry nhân thiết có đủ các trường cốt lõi hay không.
*   **Kiểm tra Tag cấu trúc `<tên_idN>`:** Đảm bảo các thẻ phân đoạn dạng XML đúng chuẩn của phương pháp Minh Nguyệt.
*   **Kiểm tra Bảng điều sắc:** Xác minh sự hiện diện của bảng màu tính cách giúp định hướng sắc thái diễn vai của AI.

### 4.10 Sinh EJS Điều Khiển (TCTRL)
Công cụ tự động phân tích và sinh mã EJS (macro) để điều khiển động việc kích hoạt và nạp các entry trong Lorebook (`@@TCTRL`):
*   **Budget Worldbook (Token Control):** Cung cấp thanh trượt cấu hình tỷ lệ token tối đa được phép nạp vào context cho Lorebook (ví dụ từ 10% đến 80%). Cơ chế này tự động tính toán dung lượng khả dụng dựa trên độ dài chat history thực tế để tránh lỗi tràn context.
*   **Batch song song:** Cho phép AI xử lý tối ưu đồng thời nhiều entry (1, 2, 3, 5, hoặc 10 entry song song). Hệ thống tích hợp rate limiter tự động điều tiết tốc độ để tránh bị chặn IP bởi các provider AI.
*   **Báo cáo ước tính:** Hiển thị chi tiết số lượng entry cần tối ưu, số token dự kiến, số batches và thời gian chạy ước tính để người dùng dễ dàng theo dõi.

---

## 5. 🪄 TRÌNH TẠO THẺ TỰ ĐỘNG (AutoCreatorPage)

Nếu bạn không muốn tự tay viết thẻ từ số 0, Auto Creator sẽ là trợ thủ đắc lực giúp bạn dựng khung nhân vật hoàn chỉnh chỉ qua một vài câu lệnh mô tả ý tưởng ban đầu.

### 5.1 Chọn Chế Độ Tạo Thẻ (Pipeline Selection)
Hệ thống cung cấp hai quy trình sinh thẻ chuyên sâu:

#### A. Standard Pipeline (Quy trình chuẩn 7 bước)
Phù hợp với các thẻ nhân vật phong cách phương Tây, thẻ game nhập vai thông thường hoặc thẻ đồng hành đơn giản:
1.  **Blueprint:** Sinh phác thảo nhân vật cơ bản.
2.  **System Prompt:** Thiết lập chỉ thị diễn vai cho AI.
3.  **First Message:** Viết lời thoại chào sân mở đầu câu chuyện.
4.  **Message Examples:** Tạo các mẫu thoại đối đáp.
5.  **Lorebook:** Tạo các tri thức nền tảng trong worldbook.
6.  **Regex:** Tạo biểu thức chính quy định dạng hiển thị.
7.  **Review:** Rà soát và đóng gói thẻ.

#### B. Minh Nguyệt Pipeline (Quy trình chuyên sâu 10 bước)
Quy trình viết thẻ đỉnh cao theo phong cách viết card Trung Quốc cổ điển/hiện đại, tập trung sâu vào cốt cách, tủ quần áo, nội tâm và thần thái:
1.  **Tổng hợp nhân vật:** Phác thảo ngoại hình bạch miêu và cốt cách.
2.  **Điều sắc:** Thiết lập bảng màu tính cách chi tiết.
3.  **Tính cách:** Khai triển 12 hành vi và giới hạn đỏ (lòng tự tôn).
4.  **Tủ quần áo:** Thiết kế chi tiết trang phục theo 4 mùa và hoàn cảnh đặc biệt.
5.  **Ba diện tính:** Phân tích ba mặt tính cách của nhân vật.
6.  **Thế giới quan:** Xây dựng hệ thống quy luật thế giới bao quanh nhân vật.
7.  **NPC:** Dựng các mối quan hệ xã hội xung quanh.
8.  **Khai bạch (First Message):** Viết tin nhắn mở đầu giàu chất văn học.
9.  **NSFW:** Hồ sơ hành vi phòng the và phản ứng sinh lý chi tiết (nếu bật chế độ NSFW).
10. **Worldbook:** Chuyển đổi toàn bộ thông tin trên thành các entry Lorebook phân nhóm khoa học.

### 5.2 Cách Vận Hành Pipeline
1.  **Chọn Preset:** Chọn một preset có sẵn ở danh sách bên trái (ví dụ: *Waifu*, *RPG Game Master*, *Yandere Companion*) để hệ thống tự điền các thiết lập mẫu, hoặc bạn có thể chọn *Custom* để tự cấu hình.
2.  **Nhấn "Bắt đầu sinh thẻ":**
    *   Hệ thống sẽ chạy qua từng bước của quy trình.
    *   Mỗi bước sau khi AI sinh xong sẽ được hiển thị ở chế độ **Xem trước (Preview)**.
3.  **Các lựa chọn tại mỗi bước:**
    *   **Apply (Áp dụng):** Chấp nhận kết quả của bước này và cho phép AI chuyển sang sinh bước tiếp theo.
    *   **Retry (Sinh lại):** Yêu cầu AI viết lại bước này. Bạn có thể nhập thêm chỉ dẫn bổ sung vào ô chat bên dưới để AI sửa đổi theo ý muốn.
    *   **Skip (Bỏ qua):** Bỏ qua bước này nếu bạn muốn tự tay viết phần đó sau.
4.  **Smart Retry:** Nếu AI trả về kết quả bị lỗi cú pháp XML/JSON hoặc bị mất thẻ neo, hệ thống sẽ tự động gửi kèm log lỗi của trình duyệt và yêu cầu AI tự sửa đổi ở lượt sinh kế tiếp.
5.  **Console Log:** Khung hiển thị nhật ký thời gian thực nằm phía dưới giúp bạn theo dõi chi tiết AI đang làm việc đến đâu, latency bao nhiêu và có gặp lỗi kết nối hay không.

---

## 6. 🧩 PHÒNG THÍ NGHIỆM BIỂU THỨC (RegexLabPage)

Regex Scripts trong SillyTavern là một công cụ cực kỳ mạnh mẽ dùng để can thiệp vào văn bản hiển thị hoặc prompt gửi đi bằng biểu thức chính quy. Regex Lab cung cấp môi trường lập trình và kiểm thử Regex chuyên sâu hàng đầu hiện nay.

### 6.1 Giao Diện 2 Cột Chuyên Nghiệp
*   **Cột Trái (Editor):** Nơi chỉnh sửa chi tiết các thuộc tính của một `RegexScript`:
    *   *findRegex:* Chuỗi tìm kiếm. Khuyến nghị viết dưới dạng chuỗi chính quy có cờ (flags) để tối ưu, ví dụ: `/pattern/gsi` (`g` = toàn bộ, `i` = không phân biệt hoa thường, `s` = khớp cả dấu xuống dòng).
    *   *replaceString:* Chuỗi thay thế. Hỗ trợ các biến capture group dạng `$1`, `$2` và các biến macro SillyTavern như `{{char}}`, `{{user}}`. Hỗ trợ nhúng mã HTML/CSS và EJS Preprocessing động.
    *   *Placement (Vị trí áp dụng):* 1 = User Input, 2 = AI Output (Khuyên dùng), 3 = Slash Commands, 4 = World Info, 5 = Reasoning.
    *   *markdownOnly vs promptOnly (Quyết định hướng đi của văn bản):*
        *   `markdownOnly: true` (Chỉ hiển thị): Regex chỉ chạy khi vẽ giao diện lên màn hình của người dùng. AI trong lịch sử chat vẫn nhìn thấy các thẻ XML/JSON thô gốc để đảm bảo logic cập nhật không bị vỡ.
        *   `promptOnly: true` (Chỉ gửi AI): Regex chỉ chạy khi đóng gói prompt gửi lên server AI. Người dùng vẫn thấy các thẻ thô trên màn hình chat để theo dõi, nhưng AI sẽ không bị rối mắt bởi các đoạn mã giao diện thừa.
        *   `markdownOnly: false, promptOnly: false`: Thay thế thực sự trên cả 2 chiều.
    *   *Depth Filter (Độ sâu tin nhắn):* Giới hạn chỉ chạy Regex cho tin nhắn ở độ sâu cụ thể. Ví dụ: đặt `minDepth: 0` và `maxDepth: 0` để chỉ định dạng cho tin nhắn AI mới nhất, tránh chạy lại các tin nhắn cũ gây giật lag trang chat.
*   **Cột Phải (Live Preview):** Hiển thị kết quả chạy Regex ngay lập tức trên văn bản mẫu với 4 tab xem:
    *   *Rendered HTML:* Vẽ thử giao diện thực tế bên trong một **Iframe Sandbox** cách ly an toàn để bạn tương tác thử với các nút bấm, bảng biểu vừa tạo.
    *   *Template:* Hiển thị mã nguồn HTML thô sau khi đã chạy Regex thay thế.
    *   *Structure:* Phân tích chi tiết các nhóm bắt được (capture groups) và kiểm tra xem cú pháp HTML có bị lỗi thẻ đóng/mở hay không.
    *   *Raw text:* Hiển thị văn bản dạng text thô.

### 6.2 Regex Copilot
Nếu bạn không rành về cú pháp Regex, hãy mô tả ý tưởng của mình bằng tiếng Việt vào ô **Regex Copilot** (ví dụ: *"Hãy tìm các đoạn văn bản nằm giữa thẻ \<note\> và \</note\> rồi render thành một khung ghi chú màu viền tím nhạt"*). AI sẽ tự động phân tích yêu cầu và viết ra mã Regex chuẩn xác (gồm cả `findRegex` và `replaceString` chứa HTML/CSS) để bạn nạp trực tiếp vào editor.

### 6.3 Thư Viện 10 Patterns Thực Tế (A - J)
Dưới đây là danh sách các Regex mẫu được tích hợp sẵn trong thư viện để bạn sử dụng ngay:

#### Pattern A: HTML Widget Renderer
*   **Mục đích:** Tìm các thẻ XML đặc biệt và vẽ chúng thành giao diện bảng biểu bắt mắt trên màn hình chat.
*   **findRegex:** `"<StatusPlaceHolderImpl/>"`
*   **replaceString:**
    ```html
    ```html
    <div style="border:1px solid #4a5568; border-radius:8px; padding:12px; background:#1a202c; color:#e2e8f0; font-family:'Noto Serif SC',serif; margin:8px 0">
      <strong style="color:#f6c90e">📊 TRẠNG THÁI {{char}}</strong>
      <!-- Code HTML/EJS đọc chỉ số ở đây -->
    </div>
    ```
    ```
*   **Thiết lập:** `markdownOnly: true`, `promptOnly: false`.

#### Pattern B: MVUZOD Variable Update Beautifier
Dùng bộ 3 script này để xử lý khối cập nhật biến động của MVUZOD:
*   **B-1 (Block hoàn chỉnh):**
    *   *findRegex:* `"/<UpdateVariable>\s*([\s\S]*?)\s*<\/UpdateVariable>/gsi"`
    *   *replaceString:* Vẽ một bảng Accordion gấp gọn hiển thị các biến số vừa được thay đổi dưới dạng so sánh Diff đẹp mắt.
*   **B-2 (Đang stream):**
    *   *findRegex:* `"/<UpdateVariable>(?!.*<\/UpdateVariable>)\s*([\s\S]*)\s*$/gsi"`
    *   *replaceString:* Hiển thị một icon xoay tròn (loading spinner) thông báo hệ thống đang tính toán cập nhật chỉ số.
*   **B-3 (Ẩn khỏi AI):**
    *   *findRegex:* `"/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gm"`
    *   *replaceString:* `""` (chuỗi rỗng để xóa sạch).
    *   *Thiết lập:* `markdownOnly: false`, `promptOnly: true` (Xóa khối cập nhật biến khỏi lịch sử chat gửi lên AI ở lượt tiếp theo để tránh AI học lặp lại cấu trúc thô).

#### Pattern C: Thought Chain Hider (Ẩn chuỗi suy luận)
*   **Mục đích:** Ẩn các đoạn suy nghĩ nội tâm của AI nằm giữa thẻ `<thinking>` hoặc `<logic_check>` khỏi mắt người dùng để giữ giao diện chat sạch sẽ, nhưng vẫn giữ lại trong context để AI không bị mất trí nhớ logic.
*   **findRegex:** `"/(<logic_check>[\s\S]*?<\/logic_check>)/gm"`
*   **replaceString:** `""` (xóa trắng).
*   **Thiết lập:** `markdownOnly: true`, `promptOnly: false`.

#### Pattern D: Multi-Tag Cleaner
*   **Mục đích:** Dọn dẹp nhanh nhiều loại thẻ XML bổ trợ một lúc.
*   **findRegex:** `"/<(Map|WorldState|command|MapUpdate|audio)>[\s\S]*?<\/\1>/gi"`
*   **replaceString:** `""`.
*   **Thiết lập:** `markdownOnly: true`.

#### Pattern E: Text Styling (Tô màu lời thoại / hành động)
*   **E-1 (Tô màu thoại):** Khớp chữ trong dấu ngoặc kép `""` và tô màu vàng sáng `#f6c90e`.
    *   *findRegex:* `"/"([^"\n]+?)"/g"`
    *   *replaceString:* `"<span style=\"color:#f6c90e\">\"$1\"</span>"`
*   **E-2 (Tô màu hành động):** Khớp chữ trong dấu sao `*...*` và in nghiêng màu xám nhạt `#a0aec0`.
    *   *findRegex:* `"/\*((?!\*)[^\n]+?)\*/g"`
    *   *replaceString:* `"<em style=\"color:#a0aec0;font-style:italic\">*$1*</em>"`
*   **E-3 (Tô màu suy nghĩ):** Khớp chữ trong dấu ngoặc đơn `(...)` và in nghiêng màu xám đậm.
    *   *findRegex:* `"/\(([^\n\(\)]+?)\)/g"`
    *   *replaceString:* `"<span style=\"color:#6b7280;font-style:italic\">($1)</span>"`

#### Pattern F: Conditional Depth Filter
*   **Mục đích:** Chỉ áp dụng hiệu ứng Regex lên tin nhắn mới nhất để tối ưu hiệu năng render của SillyTavern.
*   **findRegex:** `"/^(---\n[\s\S]+)$/m"`
*   **replaceString:** `"<div class=\"new-message\">$1</div>"`
*   **Thiết lập:** `minDepth: 0`, `maxDepth: 0`.

#### Pattern G: Variable Substitution (Thay thế vĩ mô)
*   **Mục đích:** Thay thế các macro tên nhân vật trước khi chạy regex.
*   **findRegex:** `"/{{char}}/g"`
*   **replaceString:** `"<strong style=\"color:#f6c90e\">{{char}}</strong>"`
*   **Thiết lập:** `substituteRegex: 1` (Bật tính năng thay thế macro thô).

#### Pattern H: Minh Nguyệt Tag Beautifier
*   **Mục đích:** Tìm các thẻ XML định danh nhân thiết của phương pháp Minh Nguyệt (ví dụ: `<Lâm_Tiêu_id5>`) và vẽ thành khung nhãn tag có đường viền màu tím sang trọng.
*   **findRegex:** `"/<([^>]+_id(\d+))>([\s\S]*?)<\/ \1>/gsi"`
*   **replaceString:**
    ```html
    <div style="border-left:3px solid rgba(139,92,246,0.5); padding:4px 8px; margin:4px 0">
      <span style="font-size:10px; color:#8b5cf6; opacity:0.7">🏷 $1</span>
      <div>$3</div>
    </div>
    ```

#### Pattern I: Minh Nguyệt Color Palette Widget
*   **Mục đích:** Vẽ bảng phối màu tính cách của nhân vật thành giao diện dải màu Gradient chuyển sắc quyến rũ.
*   **findRegex:** `"/\\[(?:Bảng điều sắc|Color Palette|调色盘)\\]([\s\S]*?)(?=\\[|$)/gsi"`
*   **replaceString:**
    ```html
    <div style="background:linear-gradient(135deg,#1a1025,#2d1b4e); border:1px solid rgba(139,92,246,0.3); border-radius:12px; padding:12px; margin:8px 0">
      <div style="color:#c4b5fd; font-size:0.85em; font-weight:600; margin-bottom:8px">🎨 Bảng Điều Sắc Tính Cách</div>
      <div style="color:#e2e8f0; font-size:0.85em; white-space:pre-wrap">$1</div>
    </div>
    ```

#### Pattern J: Minh Nguyệt Hiding Internal Tags
*   **Mục đích:** Xóa bỏ hoàn toàn các thẻ mở/đóng XML mang ID nhân thiết khỏi màn hình chat của người dùng nhưng vẫn giữ lại nguyên vẹn nội dung chữ bên trong.
*   **findRegex:** `"/<[^>]+_id\d+>|<\/[^>]+_id\d+>/g"`
*   **replaceString:** `""` (thay bằng chuỗi rỗng).
*   **Thiết lập:** `markdownOnly: true`, `promptOnly: false`.

---

## 7. 🛠 XƯỞNG BIẾN RPG ĐỘNG (MVUZOD Studio)

MVUZOD Studio là môi trường lập trình trực quan giúp biến thẻ SillyTavern tĩnh thành một trò chơi nhập vai (RPG) thực thụ với hệ thống chỉ số tự động cập nhật sau mỗi lượt chat.

### 7.1 Schema Wizard (Thiết Kế Cấu Trúc Biến)
*   **Zod Schema:** Bạn định nghĩa cấu trúc dữ liệu của game tại đây. Zod sẽ đảm bảo AI chỉ được phép cập nhật các giá trị hợp lệ (tránh tình trạng AI tự sinh ra các biến kỳ lạ hoặc cập nhật sai kiểu dữ liệu).
*   **Các kiểu dữ liệu hỗ trợ:**
    *   `String:` Chuỗi chữ (ví dụ: Tên khu vực, Danh hiệu).
    *   `Number:` Số nguyên/số thực (ví dụ: HP, Cấp độ, Vàng). Bạn có thể cấu hình giá trị nhỏ nhất (Min) và lớn nhất (Max) để ngăn chỉ số HP vượt quá 100 hoặc tụt xuống dưới 0.
    *   `Boolean:` Đúng/Sai (ví dụ: Đã mở khóa rương, Trạng thái chiến đấu).
    *   `Enum:` Danh sách lựa chọn cố định (ví dụ: Cảnh hiện tại gồm: "Xã giao", "Khám phá", "Chiến đấu").
    *   `Array / Object:` Mảng hoặc đối tượng phức tạp để lưu trữ túi đồ (Inventory) hoặc chỉ số chi tiết của NPC.

### 7.2 InitVar Editor (Thiết Lập Khởi Tạo)
*   Hiển thị danh sách các biến trong Schema dưới dạng giao diện điền thông tin trực quan.
*   Nhập các giá trị ban đầu cho trò chơi (ví dụ: Khởi đầu game với `HP = 100`, `Vàng = 10`, `Túi đồ = ["Kiếm gỗ", "Bánh mì"]`).
*   **Đồng bộ thời gian thực & Xác thực Zod:** Mọi giá trị bạn điền sẽ được tự động đồng bộ ngay lập tức với Card Store (`card.data.variables`) và đi qua lớp xác thực Zod Schema để đảm bảo tính hợp lệ, loại bỏ hoàn toàn lỗi mất dữ liệu khi chuyển tab.

### 7.3 Biến Số (Variable List Generator)
*   Quản lý danh sách các biến hiển thị cho AI đọc dưới dạng Worldbook Entry `[variables]`.
*   Hỗ trợ 2 phương thức sinh:
    *   **Tạo tự động:** Sinh nhanh dựa trên các template preset có sẵn (ví dụ: EJS `getvar`).
    *   **Tạo bằng AI:** Sử dụng mô hình AI quét Zod Schema kết hợp thông tin nhân vật để tự động thiết kế một Bảng trạng thái (Status Panel) bằng Markdown trực quan, chia bố cục khoa học và gắn emoji sinh động, giúp AI dễ dàng theo dõi thông tin game.

### 7.4 Update Rules (Quy Tắc Cập Nhật Biến)
*   Thiết lập và quản lý entry Lorebook đặc biệt `[mvu_update]`, chứa chỉ thị ép AI phải trả về khối lệnh JSON Patch nằm giữa thẻ `<UpdateVariable>...</UpdateVariable>` ở cuối mỗi câu thoại khi có biến động chỉ số.
*   Hỗ trợ 2 phương thức sinh:
    *   **Tạo tự động:** Sinh nhanh tập hợp quy tắc cập nhật thô.
    *   **Tạo bằng AI (Tiếng Việt thuần túy):** AI sẽ đọc hiểu bối cảnh nhân vật để tự động viết bản quy tắc cập nhật bằng tiếng Việt, kèm theo ví dụ XML `<UpdateVariable>` chứa mảng JSON Patch được cá nhân hóa sát theo cốt truyện (ví dụ: bối cảnh Tu Tiên sẽ ví dụ về Linh lực, bối cảnh RPG sẽ ví dụ về HP/Vàng).

### 7.5 Patch Simulator (Giả Lập Cập Nhật)
*   Nạp thử giá trị biến hiện tại của bạn.
*   Nhập một đoạn mã JSON Patch thử nghiệm (ví dụ: `[{"op": "replace", "path": "/Vàng", "value": 50}]`).
*   Nhấn **Chạy thử**. Hệ thống sẽ kiểm tra xem cú pháp patch có hợp lệ với định dạng RFC 6902 hay không, và kết quả sau khi áp dụng có vượt qua được lớp bảo vệ của Zod Schema hay không. Nếu có lỗi (ví dụ: Vàng bị chuyển thành chuỗi chữ thay vì số), hệ thống sẽ báo đỏ chi tiết lỗi tại dòng nào.

### 7.6 Script Output (Trích Xuất Mã Nguồn)
Nơi hiển thị và cho phép bạn sao chép 2 đoạn script cốt lõi để nạp vào SillyTavern:
1.  **Tavern Helper Runtime Script:** Đoạn mã JavaScript chịu trách nhiệm lắng nghe sự kiện chat, bắt khối thẻ `<UpdateVariable>`, phân tích cú pháp JSON Patch và thực hiện thay đổi giá trị biến thực tế trên SillyTavern.
2.  **Schema Script:** Đoạn mã định nghĩa Zod Schema dưới dạng chuỗi nén để nạp vào cấu hình hệ thống.

### 7.7 Game UI Preview (Giao Diện Game)
*   Hệ thống tự động biên dịch thiết lập biến của bạn thành một giao diện HUD hoàn chỉnh (sử dụng mã HTML/CSS hiện đại).
*   Giao diện HUD này hiển thị các thanh máu (HP bar) màu đỏ co giãn động, bảng danh sách túi đồ dạng lưới bento sắc nét và bảng trạng thái nhân vật. Bạn có thể tương tác thử để xem giao diện phản hồi ra sao khi chỉ số thay đổi.

### 7.8 Playground (Kiểm Thử Chat Tương Tác)
*   Cung cấp một khung chat giả lập.
*   Bạn có thể nhập câu thoại đóng vai của người chơi (ví dụ: *"Tôi đi vào rừng và nhặt được 5 đồng tiền vàng"*).
*   Hệ thống sẽ giả lập AI phản hồi kèm theo khối `<UpdateVariable>` cập nhật biến số. Bạn sẽ nhìn thấy ngay lập tức thanh chỉ số HUD trên màn hình chat tăng từ `Vàng = 10` lên `Vàng = 15` một cách mượt mà nhờ hiệu ứng chuyển cảnh động.

---

## 8. 📜 PHÒNG THIẾT KẾ MẪU EJS (EJS Studio)

EJS Preprocessing trong SillyTavern cho phép bạn can thiệp sâu vào nội dung Lorebook trước khi gửi tới AI bằng cú pháp lập trình Embedded JavaScript.

### 8.1 Ứng Dụng Thực Tế Của EJS
*   **Nạp cảnh động:** Chỉ chèn mô tả "Rừng sâu" vào context của AI khi biến vị trí hiện tại của người chơi trong MVU thực sự là "Rừng sâu".
*   **Kiểm tra điều kiện:** Ẩn mô tả căn phòng bí mật nếu người chơi chưa mở khóa chìa khóa trong túi đồ.
*   **Tránh spam token:** Giảm thiểu tối đa việc nạp các thông tin không liên quan vào context chat.

### 8.2 Soạn Thảo & Kiểm Thử EJS
*   **Trình soạn thảo EJS Studio:** Hỗ trợ viết code EJS trực quan.
*   **Sử dụng biến hệ thống:** Bạn có thể gọi các hàm bổ trợ của Tavern Helper như `getvar('stat_data.Người_Chơi.HP')` để lấy chỉ số máu thời gian thực của người chơi, hoặc dùng `getChatMessages()` để phân tích lịch sử chat.
*   **Khung Live Preview:** Nhập thử các trạng thái biến giả lập ở khung bên cạnh. Hệ thống sẽ biên dịch mã EJS thời gian thực và hiển thị chính xác văn bản thô cuối cùng sẽ được gửi vào đầu AI trông như thế nào.

---

## 9. 🕸 BỘ THU THẬP WIKI (Wiki Collector)

Wiki Collector (WikiPage) là cánh cổng kết nối studio với kho tri thức khổng lồ Fandom Wiki của các tác phẩm anime, manga, game hay tiểu thuyết.

### 9.1 Quy Trình Thu Thập Dữ Liệu
1.  **Nhập URL nguồn:** Điền URL trang chủ của một Fandom Wiki bất kỳ (e.g., `https://genshin-impact.fandom.com/wiki/Genshin_Impact_Wiki`).
2.  **Crawl Navigation Tree:** Hệ thống sử dụng động cơ thu thập 3 lớp (MediaWiki API chính quy, trích xuất biến cấu trúc HTML, và phân tích DOM cây điều hướng của thanh sidebar wiki) để lập bản đồ liên kết toàn bộ các trang nội dung.
3.  **Lọc Nội Dung (META Filter):**
    *   Hệ thống phân phối bộ lọc tự động loại bỏ **13 danh mục thông tin rác** không cần thiết cho nhân thiết (gồm: Lịch sử tác phẩm, danh sách tập phim, danh sách nhạc phim - OST, thư viện ảnh ngoài lề, diễn viên lồng tiếng, đánh giá của báo chí, v.v.).
    *   Giúp bạn chỉ tập trung vào cào các trang: Hồ sơ nhân vật, thuộc tính kỹ năng, mô tả địa danh thế giới quan.
4.  **Chuyển đổi:** Toàn bộ nội dung cào về được tự động chia nhỏ theo dung lượng thẻ nhớ (Chunked Memory) và gửi trực tiếp vào trình biên tập Lorebook để xây dựng sổ tay tri thức sạch sẽ.

---

## 10. QUY TRÌNH XUẤT BẢN & KHẮC PHỤC SỰ CỐ

### 10.1 Quy Trình Đưa Card Vào Sử Dụng
Để sử dụng thẻ nhân vật sau khi thiết kế xong trên Studio:
1.  **Cách 1 (Khuyên dùng - Sync Service):** Bật tùy chọn **Auto-sync khi lưu** ở trang Settings. Nhấn nút **Lưu (Save)** trong Card Editor. Card sẽ được tự động push thẳng vào thư mục nhân vật của SillyTavern đang chạy ở local. Bạn chỉ cần tải lại trang chat SillyTavern là xong.
2.  **Cách 2 (Thủ công):** Nhấn **Xuất bản Card** trong Card Editor → Chọn **Tải về file PNG**. Kéo thả bức ảnh PNG này vào giao diện SillyTavern của bạn.

---

### 10.2 Hướng Dẫn Khắc Phục Sự Cố (Troubleshooting)

#### 🐞 Sự cố 1: Không kết nối được với SillyTavern Sync Service
*   **Triệu chứng:** Nút kết nối báo màu đỏ kèm thông báo lỗi "Connection error" hoặc "Failed to fetch".
*   **Nguyên nhân & Cách xử lý:**
    1.  *Chưa bật cổng API trên SillyTavern:* Mở SillyTavern, vào mục Cài đặt (Settings) -> Khác (Extensions/API) và đảm bảo bạn đã tích chọn **Bật API** (API Port mặc định là `8000`).
    2.  *Lỗi chặn CORS của Trình duyệt:* Trình duyệt web chặn kết nối từ trang studio (`localhost:5173`) sang cổng SillyTavern (`localhost:8000`).
        *   👉 *Cách xử lý triệt để:* Hãy chuyển sang chế độ kết nối **Server Plugin**. Làm theo đúng hướng dẫn cài đặt plugin `card-sync` tại Mục 2.5 để đẩy dữ liệu qua endpoint nội bộ của máy chủ, tránh hoàn toàn cơ chế chặn CORS của trình duyệt.

#### 🐞 Sự cố 2: AI bị "loạn nhân thiết" hoặc OOC (Out Of Character)
*   **Triệu chứng:** Nhân vật chat không đúng tính cách, quên các thiết lập bối cảnh lớn, hoặc trả lời giống như một con robot trợ lý thông thường.
*   **Nguyên nhân & Cách xử lý:**
    1.  *Cấu hình sai chế độ Worldbook:* Bạn đang đặt thông tin cốt lõi của nhân vật chính (ngoại hình, cốt cách) ở trạng thái **Selective (Đèn xanh lá)**. Do đó, khi người dùng chat không chứa từ khóa kích hoạt, các thông tin này bị biến mất khỏi context của AI.
        *   👉 *Cách xử lý:* Vào Lorebook, chọn các entry nhân thiết của nhân vật chính và đổi chiến lược kích hoạt thành **Constant (Đèn xanh dương - Thường trú)**.
    2.  *Chưa bật chặn đệ quy:* Các entry Lorebook kích hoạt chéo lẫn nhau vô hạn làm tràn context.
        *   👉 *Cách xử lý:* Chạy công cụ **Worldbook Health Check** trong tab Entries để quét và tự động sửa các lỗi thiếu tích chọn *exclude_recursion* và *prevent_recursion*.

#### 🐞 Sự cố 3: Biến số RPG không cập nhật hoặc AI sinh lỗi Zod Schema Validation
*   **Triệu chứng:** AI trả về khối `<UpdateVariable>` nhưng giao diện HUD không thay đổi chỉ số, hoặc trong tab console hiển thị lỗi validate Zod.
*   **Nguyên nhân & Cách xử lý:**
    1.  *AI sinh sai kiểu dữ liệu:* Bạn định nghĩa biến HP kiểu số (`Number`), nhưng AI lại trả về chuỗi chữ (ví dụ: `[{"op": "replace", "path": "/HP", "value": "chín mươi"}]`). Lớp Zod Schema sẽ chặn cập nhật này lại để bảo vệ hệ thống không bị lỗi crash code.
        *   👉 *Cách xử lý:* Kiểm tra lại nội dung hướng dẫn trong entry `[mvu_update]`. Hãy viết mô tả thật rõ ràng và đưa ra ví dụ cụ thể cho AI hiểu là chỉ được phép cập nhật giá trị số thô (raw number) không bọc ngoặc kép.
    2.  *Sử dụng Regex tham lam (Greedy) nuốt mất thẻ đóng:* Regex Beautifier của bạn được viết dạng `.*` thay vì `.*?` nên nó đã nuốt mất thẻ đóng `</UpdateVariable>` khi AI trả về nhiều khối cập nhật.
        *   👉 *Cách xử lý:* Sửa lại Regex trong Regex Lab đúng theo mẫu Pattern B-1: `/<UpdateVariable>\s*([\s\S]*?)\s*<\/UpdateVariable>/gsi` (luôn dùng toán tử lười biếng `.*?` khi bắt nội dung giữa hai thẻ XML).

---
*Chúc bạn có những trải nghiệm thiết kế thẻ tuyệt vời cùng Tavern Card Studio! Nếu gặp bất kỳ khó khăn nào khác, hãy tham khảo tài liệu [ARCHITECTURE.md](file:///e:/tooltaocrd/ARCHITECTURE.md) của dự án để biết thêm chi tiết về cấu trúc mã nguồn.*

---

## 11. 🆕 TÍNH NĂNG BỔ SUNG (bản mới)

> Mục này gom các tính năng thêm sau khi 10 mục trên được viết. Có một bài kiểm tự động
> canh mục này: thêm tính năng lớn vào tool mà quên ghi vào đây thì bộ test sẽ báo đỏ.

### 11.1 🪄 Đũa thần ý tưởng (ô "Ý tưởng của bạn")

Gõ ý tưởng lộn xộn một mạch rồi bấm biểu tượng đũa thần. Công cụ sẽ:

*   **Sắp xếp lại** ý tưởng thành các phần có tiêu đề (`## Nhân vật chính`, `## Thế giới & bối cảnh`,
    `## Hệ thống sức mạnh`…) — chỉ đổi cách trình bày, **không thêm bớt ý** của bạn.
*   **Rút quy tắc** từ chính ý tưởng đó và điền vào ô "Yêu cầu/Quy tắc cho AI".

Có một chốt chặn máy: mọi **tên riêng** và **con số nội dung** trong bản gốc phải còn nguyên trong
bản sắp xếp. Nếu AI làm rơi, công cụ sẽ nói đích danh cái bị rơi rồi bắt AI làm lại; vẫn rơi thì
**giữ nguyên văn của bạn** chứ không âm thầm đổi ý. Riêng số thứ tự mục lục ("1.", "2.1") thì không
tính — chúng là định dạng, và việc của đũa thần đúng là thay chúng bằng tiêu đề.

### 11.2 🔍 Xem trước & Tinh chỉnh (trước khi bấm Tạo Card)

Một wizard 3 bước chạy trước khi pipeline khởi động:

1.  **Schema** — AI quét ý tưởng và đề xuất bộ biến MVU. Bạn sửa trực tiếp từng biến (tên, phạm vi,
    enum, giá trị mặc định, xoá bớt, viết ràng buộc riêng), hoặc nhờ copilot mini sửa hộ. Có nút
    reset về bản AI đưa.
2.  **Giao diện** — công cụ dựng sẵn vài phương án Opening Form + thanh trạng thái **từ chính schema
    bạn vừa chốt** (không tốn lượt gọi AI nào), xem trước rồi chọn một.
3.  **Xác nhận** — card tạo ra sẽ dùng **đúng 100%** schema + giao diện đã chốt.

Trạng thái được lưu lại, thoát giữa chừng vào lại vẫn đúng chỗ. Lưu ý: đổi nội dung ý tưởng sẽ làm
bản đã duyệt hết hiệu lực (vì schema cũ nói về một thế giới khác).

### 11.3 🎨 Nhờ AI tạo giao diện (Bước 2)

Ngoài các mẫu dựng sẵn, bạn có thể tả phong cách mình muốn — tông màu chủ đạo, không khí (u ám /
tươi sáng / cổ trang / công nghệ), thời đại — và AI sẽ phối bảng màu + chọn font cho vừa thế giới
của thẻ. Chưa ưng thì tả tiếp để **chỉnh đúng chỗ đó** (AI nhớ bản nó vừa làm, không vẽ lại từ đầu).

AI **chỉ quyết phần thẩm mỹ**; khung HTML của Opening Form và thanh trạng thái vẫn do công cụ dựng
như các mẫu có sẵn. Nhờ vậy giao diện AI tạo ra không bao giờ làm hỏng đường ghi/đọc biến. Nếu bảng
màu làm chữ chìm vào nền, công cụ sẽ cảnh báo trước khi bạn chốt.

### 11.4 ⚡ Preset Nhanh trong EJS Studio

Dành cho người chưa biết gì về EJS: mỗi preset là một yêu cầu dựng sẵn, **tự bám vào thẻ của bạn**
(có schema chưa, biến nào, đã có thanh trạng thái riêng chưa) và nêu rõ công dụng khi đưa vào thẻ.
Bấm một preset là ô "Bạn muốn EJS làm gì?" được điền sẵn; bạn xem lại rồi bấm Lên kế hoạch.

Có cả preset **áp dụng tất cả tính năng EJS** cho những ai muốn làm một lượt cho cả thẻ. Preset nào
không dùng được với thẻ hiện tại sẽ bị làm mờ kèm lý do (ví dụ: thẻ chưa có schema biến MVU).

### 11.5 📖 Tạo thẻ từ truyện — 🔬 Quét truyện bằng AI (pipeline nghiên cứu sâu)

Nạp **nhiều file truyện** cùng lúc (.txt / .md / .epub, tự xếp theo tên chương) hoặc dán thẳng vào ô.
Trang có hai chế độ:

*   **🔬 Quét truyện bằng AI (mặc định):** AI **đọc và nghiên cứu toàn bộ tác phẩm** theo nhiều
    lượt thay vì chỉ quét một lần — truyện dài được tự chia thành nhiều đoạn (batch), chạy song song:
    1.  **Đọc lần 1** — cấu trúc truyện, chương/hồi, bối cảnh, thực thể, nhận diện nhân vật chính.
    2.  **Đọc lần 2** — lập danh sách nhân vật đầy đủ + phân vai chính/phụ.
    3.  **Đọc lần 3** — phân tích chi tiết TỪNG nhân vật; thông tin rải rác ở nhiều chương được
        gom về một hồ sơ (ngoại hình, tính cách, năng lực, cách xưng hô, quan hệ, phát triển tâm lý).
    4.  **Đọc lần 4** — thu thập toàn bộ thiết lập thế giới: hệ thống sức mạnh, cơ chế, luật lệ,
        địa danh, phe phái, vật phẩm, lịch sử, văn hoá, tiền tệ, thuật ngữ riêng…
    5.  **Đọc lần 5** — dựng **dòng thời gian chi tiết**; truyện không ghi ngày cụ thể thì dùng mốc
        tương đối ("Ngày 1", "Sau sự kiện X"), tuyệt đối không bịa.
    6.  **Học văn phong tác giả** — phân tích nhịp kể, câu chữ, hội thoại, sắc thái… thành
        **Style Profile** (entry thường trú) để AI viết tiếp gần giọng nguyên tác.
    7.  **Đọc đối chiếu** — AI cầm bộ nhớ nghiên cứu đọc lại truyện để bổ sung phần thiếu và soát
        mâu thuẫn giữa các chương; **lặp nhiều vòng đến khi không còn thông tin mới** (số vòng tối
        đa chỉnh được).
    8.  **Tổng hợp** — tạo **Character Card** cho nhân vật chính (hoặc nhân vật bạn chỉ định) +
        **Lorebook đầy đủ**: mỗi chủ đề một entry riêng (Thế giới quan, Meta, Hệ thống, Luật lệ,
        Nhân vật, Phe phái, Địa danh, Timeline, Văn phong…), tự gắn keys/alias để liên kết nhau,
        và tự xếp đúng nhóm chuẩn worldbook (constant/depth/order).
    9.  **Kiểm tra trùng lặp & nhất quán** — khử entry trùng rồi chạy một lượt soát mâu thuẫn.

    Trong lúc chạy bạn thấy rõ **từng giai đoạn, số đoạn đã quét, số lượt gọi AI, số dữ kiện, số
    entry**; có thể **⏸ Tạm dừng / ▶ Tiếp tục** bất kỳ lúc nào — tiến trình tự lưu, F5 không mất.
    Dữ liệu truyện không nói rõ được đánh dấu "chưa xác định" thay vì bịa; nhân vật chính của truyện
    **không bao giờ bị nhầm thành {{user}}** — chỉ khi bạn chủ động điền ô "Nhân vật thành {{user}}"
    thì người đó mới được thay bằng người chơi.

*   **⚡ Quét nhanh (cũ):** flow một lượt như trước — quét roster, tick nhân vật, sinh thẻ — cho
    truyện ngắn hoặc khi cần thẻ gấp. Có tuỳ chọn **học văn phong tác giả** để thẻ giữ giọng gốc.

### 11.6 🕘 Danh sách phiên bản (nút lịch sử ở đầu trang)

Trước đây có hai nút mũi tên: một để cập nhật, một để hạ **đúng một bản mỗi lần** — muốn về bản của
tuần trước phải bấm cả chục lần. Nay gộp thành một nút mở **danh sách phiên bản**:

*   Xem toàn bộ các bản gần đây, biết rõ mình **đang ở bản nào** và cách bản mới nhất bao nhiêu bản.
*   Mỗi dòng có nút **Log** để đọc nội dung bản cập nhật đó ngay tại chỗ.
*   Bấm một lần để nhảy **thẳng** tới bất kỳ bản nào (lên bản mới hoặc quay về bản cũ).

Dữ liệu của bạn — thẻ, cache, tiến độ dịch — **không bị đụng tới** khi đổi phiên bản.
