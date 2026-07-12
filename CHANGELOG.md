# Changelog — SillyTavern Multitools

> Cách cập nhật: mở thư mục cài đặt, chạy `git pull origin main`, rồi **tắt hẳn và chạy lại `start.bat`** (không chỉ F5).

## v1.78.0 — 📚 Bộ thuật ngữ Tu tiên / Võ hiệp có sẵn
- **1 nút trong mục Từ điển** nạp **92 thuật ngữ chuẩn cộng đồng convert**: tu luyện/linh khí/đan điền, đủ thang cảnh giới (Luyện Khí → Trúc Cơ → Kim Đan → Nguyên Anh → … → Độ Kiếp), công pháp/pháp bảo/đan dược, danh xưng (sư tôn/đạo hữu/tiền bối), tông môn/giang hồ, võ học (nội công/khinh công/kiếm pháp…).
- Nguyên tắc chọn: chỉ thuật ngữ **một nghĩa rõ ràng** (bỏ mục mơ hồ kiểu 炼器/炼气 trùng âm); cảnh giới viết Hoa, danh từ chung viết thường.
- **Mục bạn tự nhập luôn thắng** (merge qua cùng cơ chế với Pha 0); nút hiện số mục còn thiếu `(92)`, nạp đủ thì thành `✓` và tự khoá.
- Không tốn token: từ điển to nhưng mỗi prompt chỉ nhận mục **thật sự xuất hiện** trong đoạn đang dịch (cơ chế lọc từ v1.74).
- +2 test (191 tổng, có test khoá chất lượng bộ: source thuần Hán không trùng, target sạch không còn Hán).

## v1.77.0 — 🩺 Kiểm tra tổng: nghiệm thu 1 nút trước khi xuất
> Trước đây muốn nghiệm thu bản dịch phải tự đi 3 nơi: khối Sức khoẻ thẻ, panel Kiểm Tra Lỗi Dịch, panel So sánh card — người mới không biết mà bấm.
- **1 nút "🩺 Kiểm tra tổng" ngay trong khung Export**, chạy cả 3 bộ kiểm (đều tại máy, **0 call AI**):
  1. **Sức khoẻ thẻ** (đã chạy passive từ trước): trường lỗi/chưa xong, script vỡ cú pháp, chữ Hán trong code, thuật ngữ Từ điển chưa áp.
  2. **Kiểm sâu từng field** (`verifyFields` — trước giờ nằm trong panel Kiểm Tra Lỗi Dịch): macro hỏng, lệch ngoặc/thẻ HTML/JSON, cắt cụt cấu trúc, tên hàm bị dịch, chèn code lạ… 15 loại.
  3. **Đối chiếu card gốc** (`quickVerify`): macro/biến/Zod/EJS có trong card gốc mà MẤT trong card xuất.
- **Kết quả gộp 1 chỗ:** phán quyết **ĐẠT / KHÔNG ĐẠT (N lỗi nặng)** + 1 danh sách xếp theo mức độ, mỗi dòng có badge nguồn (KIỂM SÂU / SO CARD GỐC), **bấm dòng nào nhảy thẳng tới field đó** trong Field Editor để sửa; kiểm sâu trùng mục CJK với sức khoẻ thẻ thì tự khử trùng lặp, không báo đúp.
- **Báo cáo tải về (.md)** giờ gồm luôn kết quả kiểm sâu + đối chiếu (trước chỉ có phần sức khoẻ thẻ).
- Panel Kiểm Tra Lỗi Dịch vẫn nguyên cho ai cần sửa bằng AI — Kiểm tra tổng dùng chung linh kiện, không nhân đôi logic.
- Verify live bằng card Tuhu (cache dịch từ đời code cũ): 1 click ra "❌ còn 16 lỗi nặng — 23 vấn đề nội dung · 0 vấn đề macro/biến", danh sách chỉ đúng các script vỡ/macro hỏng đời cũ, nhảy field hoạt động.

## v1.76.0 — Đếm token THẬT (đọc từ usage của API) 🧮
> Trước giờ chỉ có ETA ước lượng theo ký tự — dùng key chung không biết mình thật sự đốt bao nhiêu.
- **Đọc usage thật từ chính response API** ở cả 3 loại provider, cả stream lẫn non-stream:
  - OpenAI-compatible: `usage.prompt_tokens/completion_tokens` (chunk SSE cuối hoặc body).
  - Gemini: `usageMetadata` (tích lũy theo chunk — lấy bản cuối; token "suy nghĩ" tính vào ra).
  - Claude: `message_start.usage.input_tokens` + `message_delta.usage.output_tokens`.
- **Hiển thị:**
  - Panel "Luồng đang chạy": chip **🧮 tổng vào · ra** realtime ở header + ô token riêng từng lane (provider+model) cạnh RPM.
  - Dịch xong: log **"🧮 Token cả lượt dịch: X vào / Y ra, N call"** kèm chi tiết từng model — biết ngay model nào ăn nhiều (và thấy luôn system prompt chiếm bao nhiêu).
- **Trung thực với số liệu:** API/proxy nào strip mất usage thì call đó ước lượng từ ký tự (CJK ≈ 1 token/ký tự, Latin ≈ 4 ký tự/token) và toàn bộ số hiện kèm dấu **"~"** + ghi rõ bao nhiêu call là ước — không trộn số đo với số đoán mà không nói.
- Không hiện tiền: user chủ yếu dùng proxy/key chung, bảng giá thật không có — hiện số tiền đoán mò còn hại hơn không hiện.
- +4 test (189 tổng). Verify live full run card AI帝国1.1: 16 call đều trả usage thật (không có "~"), tổng 199.4K vào / 15.6K ra, panel + log khớp nhau.

## v1.75.0 — Dịch bản update của card: chỉ dịch phần thay đổi ♻
> Card Trung update liên tục (V2.2 → V2.3) mà cache tiến trình key theo đúng tên file — đổi tên là mất sạch, phải dịch lại từ đầu dù bản update chỉ đổi 10-20% nội dung. Từ nay hết.
- **Nạp card mới không có cache trùng tên → app tự quét cache tiến trình của các card CŨ** (20 cache gần nhất), field nào **nội dung gốc không đổi** thì bê thẳng bản dịch cũ sang (đánh dấu done): chỉ còn phần mới/đã sửa cần dịch.
- **Match theo NỘI DUNG, không phải vị trí** — bản update hay chèn/đảo entry lorebook làm path xô lệch, match nội dung + nhóm + loại entry thì vẫn khớp (an toàn tuyệt đối như cơ chế "Bộ nhớ dịch" trong-run: trùng hệt mới bê, không thể sai ngữ cảnh). Hai cache cùng có 1 nội dung → bản MỚI hơn thắng.
- **Kèm từ điển:** nguồn khớp nhiều nhất (≥3 field) chính là phiên bản cũ của card → merge từ điển biến MVU/EJS của nó để **tên biến 2 phiên bản khớp nhau** (Chiến lược B không dịch lại biến đã có).
- **Field Editor gắn badge ♻ (tên card nguồn)** cho từng field tái dùng — biết ngay bản dịch bê từ đâu, không ưng thì bấm dịch lại field đó.
- Dùng chung công tắc **Bộ nhớ dịch** (đang bật sẵn) — tắt là tắt cả tái dùng phiên bản.
- **Fix kèm:** khôi phục cache tiến trình giờ **đợi parse xong hẳn** mới chạy — trước đây chờ cứng 500ms, card lớn parse qua worker lâu hơn là trượt khôi phục (race có thật từ trước).
- +7 test (185 tổng). Verify live: nạp lại chính card Tuhu dưới tên "Tuhu_V2.3.png" → log "♻ Tái dùng 81/123 bản dịch từ Tuhu_V2.2.png", progress nhảy thẳng 66%, first message hiện tiếng Việt, 6 biến MVU merge về, badge ♻ hiện trong Field Editor.

## v1.74.0 — Pha 0: Bảng tên riêng tự động 📖
> Điểm yếu cố hữu của dịch đa luồng: 2 entry do 2 luồng khác nhau dịch, cùng nhân vật `叶凡` chỗ ra "Diệp Phàm", chỗ ra "Ye Fan". Từ nay hết.
- **Bấm Start là app tự xây bảng tên trước khi dịch:**
  1. Quét **cục bộ, 0 token** các cụm Hán lặp lại (≥3 lần) trong đúng những field sắp dịch + toàn bộ keyword lorebook + tên card (lọc hư từ, khử cụm con, ưu tiên keyword).
  2. Gửi **1 lượt gọi AI duy nhất** dịch cả bảng — tên người/địa danh/tông môn theo âm Hán-Việt (叶凡→Diệp Phàm, 青云宗→Thanh Vân Tông), thuật ngữ theo nghĩa chuẩn (金丹→Kim Đan); AI tự loại từ thông dụng.
  3. Nạp kết quả vào **Từ điển thuật ngữ** → mọi luồng dịch song song dùng chung ⇒ tên nhất quán toàn card.
- **An toàn:** mục user tự nhập LUÔN thắng; field schema/biến MVU không đưa vào quét (đã có từ điển MVU riêng — không giẫm chân); Pha 0 lỗi/timeout thì bỏ qua và dịch tiếp bình thường, không bao giờ chặn run; chạy tiếp (Continue) không gọi lại nếu bảng đã đủ.
- **Tối ưu prompt:** từ điển > 8 mục giờ chỉ nhét vào mỗi prompt những mục **thật sự xuất hiện** trong đoạn đang dịch — đỡ phình token, model không áp tên không liên quan (từ điển nhỏ nhập tay giữ nguyên hành vi cũ).
- Toggle "📖 Tự xây bảng tên riêng (Pha 0)" trong mục Từ điển, mặc định BẬT. i18n VI/EN/中文.
- +13 test (178 tổng). Verify live bằng card AI帝国1.1: quét ra 28 ứng viên → AI giữ đúng 2 tên thật (中国→Trung Quốc, 帝国→Đế Quốc), log Pha 0 hiện đủ 2 bước, dịch chạy tiếp bình thường.

## v1.73.0 — Popup gợi ý cấu hình sau khi import card 💬★
- **Nạp card mới xong → popup hiện ngay giữa màn hình:** preset khuyên dùng (★ ⚡ Dịch nhẹ / 📖 Đầy đủ / 🚀 Siêu tốc) + **dòng giải thích vì sao**, kèm 2 nút:
  - **✅ Dùng cấu hình gợi ý** — áp toàn bộ setting khuyên dùng ngay 1 chạm (bật/tắt nhóm field, MVU sync, chế độ phẫu thuật, chiến lược lorebook… đúng y như bấm nút preset tương ứng), có toast xác nhận. Không tự bấm Start — user vẫn chủ động khi nào dịch.
  - **Giữ cấu hình hiện tại** — đóng popup, không đổi bất kỳ setting nào.
- **Không quấy rầy:** card khôi phục tiến trình dịch cũ (đã có field xong/lỗi) hoặc đang ở Mod Mode thì popup **không hiện**; mỗi card chỉ hỏi 1 lần, nạp card khác lại hỏi cho card đó.
- Kỹ thuật: logic áp preset gom về 1 hook `usePresetApply` dùng chung cho 3 nút preset + popup (hết cảnh copy 2 nơi); preset đang chọn chuyển vào store (`st-preset-active-id`) để nút và popup đồng bộ highlight. Đã verify live cả 2 nút bằng card AI帝国1.1 (popup nhận diện MVU → khuyên ⚡ Dịch nhẹ; bấm Dùng → config áp đúng + nút preset sáng viền).

## v1.72.0 — Tự phân tích card khi import → gợi ý chế độ dịch 🔍★
- **Nạp card xong, app tự quét và khuyên nên dịch kiểu gì** — người mới không cần biết gì cũng chọn đúng:
  - Card có **khung biến MVU** (`[initvar]`/`[mvu_update]`/stat_data/registerMvuSchema) hoặc **script giao diện nặng** → khuyên **⚡ Dịch nhẹ** (an toàn logic tuyệt đối — bài học từ bug #4).
  - Card **lớn / nhiều entry** → khuyên **🚀 Dịch siêu tốc** (gom call, nhanh mà vẫn đủ).
  - Card **gọn nhẹ** → khuyên **📖 Dịch đầy đủ** (dịch trọn, không tốn bao nhiêu).
- Hiển thị: **sao ★ vàng** trên nút preset được khuyên + **dòng giải thích vì sao** ngay dưới hàng preset (kèm hướng dẫn khi nào nên chọn chế độ khác). Có i18n VI/EN/中文.
- +6 test cho bộ phân tích (165 test tổng). Đã verify live bằng chính card AI帝国1.1: nhận diện đúng MVU → gợi ý ⚡ Dịch nhẹ.

## v1.71.0 — Sửa bug #4: Dịch nhẹ làm vỡ MVU ("card không hỗ trợ 额外模型解析") 🧩
> Từ báo lỗi #4: card `AI帝国1.1` dịch bằng **⚡ Dịch nhẹ** xong, vào SillyTavern chơi thì popup MVU lỗi lặp: *"当前角色卡不支持额外模型解析"*.
- **Gốc rễ (đã mổ xẻ diff 2 card):** Chiến lược B dịch **tên biến MVU** ra tiếng Việt **có dấu cách** (`叙事` → `Tự Sự`) rồi áp từ điển lên **cả card** — kể cả script Zod schema không nằm trong diện dịch. Trong JavaScript, key tiếng Trung không quote (`叙事:`) là hợp lệ, nhưng **key có dấu cách (`Tự Sự:`) là lỗi cú pháp** → script schema chết ngay khi nạp → `registerMvuSchema` không chạy → framework MVU kết luận "card không hỗ trợ".
- **Fix 1 — Dịch nhẹ đúng nghĩa:** preset ⚡ Dịch nhẹ giờ **không đổi tên biến MVU nữa**. Chỉ dịch phần **người chơi nhìn thấy** (keyword để gõ tiếng Việt vẫn kích hoạt entry, lời mở đầu, tên card, tên/comment entry, regex hiển thị); **ruột card — content, script, tên biến — giữ nguyên 100%** tiếng gốc. AI tự đọc tiếng Trung và trả lời tiếng Việt; logic/MVU không bao giờ bị đụng.
- **Fix 2 — guard cho MỌI chế độ (kể cả Dịch đầy đủ):** tên biến MVU dịch ra **tự thay dấu cách bằng `_`** (`Tự_Sự`, `Độ_Hảo_Cảm`) khi tên gốc là identifier; enum value có dấu cách trong nguyên bản (luôn nằm trong nháy) giữ nguyên. Prompt dịch tên biến cũng được dạy đặt tên nối `_` ngay từ đầu.
- +5 test hồi quy lấy fixture từ chính schema card lỗi (159 test tổng).

## v1.70.0 — Audit đợt 4: thân thiện người mới 🤝
- **Fix ô API Key không Enter được:** trước đây bấm Enter để nhập key thứ 2 là dấu xuống dòng bị "nuốt" ngay (ô bị chuẩn hoá sau mỗi phím gõ). Giờ gõ tự nhiên, mỗi dòng 1 key — áp dụng cho cả ô key của Provider bổ sung.
- **Khối API chính = card "Provider #1 (chính)"** viền xanh **đồng bộ giao diện** với Provider bổ sung bên dưới (Loại + Base URL 2 cột → API Key → Load model → Model chính + RPM → Model phụ + RPM + Ngưỡng). Hai mục ngang hàng về logic thì nhìn cũng phải ngang hàng.
- **3 nút preset sáng viền nút đang chọn** (⚡ Dịch nhẹ / 📖 Dịch đầy đủ / 🚀 Dịch siêu tốc) — nhìn phát biết đang ở chế độ nào, nhớ qua reload.
- **Bố cục:** sidebar rộng hơn (360→400px); khung nội dung chính **kéo sát cạnh phải** màn hình (bỏ trần 1200px, hết dư khoảng trống).
- **Mặc định tốt hơn cho người mới** (ai đã tự chỉnh thì giữ nguyên):
  - **Dịch phẫu thuật BẬT sẵn** — chỉ trích chuỗi CJK trong code/regex để dịch, giữ 100% cấu trúc; trước đây tắt mặc định là nguồn vỡ regex phổ biến nhất.
  - **Ngưỡng ký tự = 10.000** — khi có model phụ, entry ngắn tự đi model phụ cho nhanh (0 = tắt như cũ).

## v1.69.0 — Audit đợt 3: khử code trùng lặp 🧬
> Dọn nợ kỹ thuật — **không đổi hành vi dịch**, để về sau sửa 1 chỗ là mọi nơi hưởng, không còn cảnh "fix nơi này quên nơi kia".
- **Gom hàm đếm/lọc CJK về 1 file** (`utils/cjk.ts`): trước đây `stripUrlsForCjkCheck` (bỏ URL trước khi đếm chữ Hán sót) bị **đúp 3 nơi** và regex đếm CJK đúp 2 nơi. Tiện thể bắt được **typo ở 1 bản đúp** khiến không bỏ được đường dẫn tương đối `./x` — đúng minh chứng vì sao code đúp nguy hiểm.
- **Gom logic chia lô lorebook về 1 hàm** (`utils/batchSplit.ts`) dùng chung cho pipeline **Dịch** và **Mod**: trước đây đúp nguyên khối ~200 dòng ở 2 nơi và bản Mod đã lệch (thiếu các cải tiến mới). Hai pipeline giờ chỉ khác nhau ở tham số truyền vào (Dịch: tách theo model + isolate entry dài + smart-packing; Mod: đếm theo bản đã mod).
- `useTranslation.ts` gọn đi ~120 dòng. **+14 test mới** khoá hành vi (154 test tổng) — mọi test cũ pass nguyên vẹn.

## v1.68.0 — Audit đợt 2: giao diện phân tầng Cơ bản / Nâng cao 🎛️
> Mục tiêu: người mới chỉ cần **API key → bấm 1 preset → Start**; dân chuyên vẫn còn đủ đồ chơi trong "Nâng cao".
- **3 nút preset lên ĐẦU:** ⚡ Dịch nhẹ / 📖 Dịch đầy đủ / 🚀 Dịch siêu tốc giờ nằm **trên cùng mục Cấu hình dịch** trong khung nổi bật (trước đây chìm giữa sidebar, thứ quan trọng nhất lại khó thấy nhất).
- **Nút "⚙ Cài đặt nâng cao":** toàn bộ setting chuyên sâu — Model Routing, Custom Schema, Custom System Prompt, Chunk Size + AI Chunk Verification, RAG, Translation Memory, Dịch phẫu thuật, CSS CJK, Chiến lược B (MVU) / C (EJS) — được **gấp lại, mặc định đóng** (nhớ trạng thái mở/đóng). Preset đã tự lo các cờ quan trọng nên người dùng thường không cần mở.
- **Phần API gọn hơn:** CORS Proxy + Expert Mode dời vào mục **Advanced Settings** có sẵn (chung chỗ với sampler/timeout). Tầng cơ bản của API chỉ còn: provider, Base URL, key, model, RPM, model phụ, provider bổ sung, Test Connection.
- Tầng cơ bản sau dọn dẹp: **API → Preset → Ngôn ngữ/nhóm trường → Chiến lược Lorebook → Start.** Không đổi bất kỳ hành vi dịch nào — chỉ sắp xếp lại giao diện.

## v1.67.0 — Audit đợt 1: dọn nút chết + đa luồng triệt để 🧹⚡
> Đợt 1 của cuộc tổng rà soát code Dịch Card (mục tiêu: dễ dùng, ít setup, nhanh nhất có thể).
- **Gỡ 2 nút CHẾT** khỏi giao diện (chỉnh không có tác dụng, gây hiểu lầm):
  - Radio **"Translation Mode: Field-by-field / Batch"** — không một dòng code nào đọc nó; chế độ hàng loạt thật do "Chiến lược Lorebook" quyết định.
  - Ô **"Số chunk song song"** — engine luôn tự tính theo tổng ngân sách RPM của pool, chỉnh gì cũng bị lờ.
- **Chiến lược Lorebook "Từng entry riêng" giờ chạy ĐA LUỒNG:** trước đây chọn chế độ này là 74 entry dịch **tuần tự từng cái** (rất chậm). Nay các entry độc lập chạy **song song qua pool** — mỗi entry vẫn 1 call riêng với prompt y hệt ⇒ **chất lượng không đổi, chỉ nhanh hơn nhiều lần**. Entry MVU-critical (initvar/controller/mvu_logic) vẫn dịch tuần tự để giữ đồng bộ tên biến; thứ tự giữa nhóm keys ↔ content giữ nguyên.
- **Mặc định mới = "Hàng loạt":** người dùng mới (chưa từng chỉnh) mặc định dùng chiến lược Hàng loạt (đa luồng + gộp call — nhanh nhất); ai đã tự chọn thì giữ nguyên lựa chọn. Preset **⚡ Dịch nhẹ** và **📖 Dịch đầy đủ** giờ cũng chốt Hàng loạt như 🚀 Siêu tốc.
- **Fix:** bấm preset Dịch nhẹ rồi **F5 bị mất** cờ "bỏ content to" (thiếu handler lưu localStorage riêng) → giờ giữ đúng qua reload.

## v1.66.0 — Chunk thích ứng theo số lane + panel hiện "▶ đang chạy" 📊⚡
### ⚡ Chunk thích ứng theo số lane (tận dụng provider rảnh khi dịch field lớn)
- **Trước:** 1 field lớn (vd 148 KB) chia cố định ~10 phần → dù pool có 72 lane thì cũng chỉ dùng được ~10 lane, 62 lane ngồi không suốt lúc dịch field đó.
- **Nay:** field **văn bản** rất lớn tự chia **nhỏ hơn** (tới **sàn 8.000 ký tự/phần**) khi pool còn dư lane → phủ nhiều lane hơn, dịch song song **nhanh hơn nhiều**. Chỉ chia thêm khi *số lane > số phần mặc định*; **không** áp cho regex/TavernHelper (chia nhỏ code dễ vỡ cấu trúc); giữ nguyên nếu bạn tự đặt "Ngưỡng ký tự".
- Kết hợp với HEDGE (1.65): field lớn vừa dùng nhiều lane hơn, vừa được cứu tail-latency.

### 📊 Panel luồng: hiện số call ĐANG CHẠY ("▶ N")
- **Vấn đề:** thanh RPM đo theo **cửa sổ 60 giây tính từ lúc BẮT ĐẦU** call. Call chạy >60s rơi khỏi cửa sổ → lane hiện **0/17** dù **vẫn đang chạy** → trông như rảnh rỗi, khó biết bận hay không.
- **Sửa:** mỗi lane giờ hiện **"▶ N"** = số call **đang chạy** ngay lúc đó (xanh khi >0, xám khi 0), kèm **RPM nhỏ** bên cạnh. Nhìn ▶ là biết ngay lane bận hay rảnh, không bị RPM đánh lừa nữa. Thanh tiến trình cũng chạy theo số call đang chạy.

## v1.65.0 — HEDGE: chunk chậm không còn "kéo lê" cả field ⚡🎯
- **Vấn đề (bạn hỏi):** dịch 1 field lớn chia ~15 chunk song song, có 3 chunk kẹt **400s+** trên 1 provider, còn các provider khác **đứng đợi** không chạy. Vì sao? Cả 15 chunk đã phát hết (12 xong + 3 kẹt), **không còn việc để giao** cho provider rảnh, mà chunk đang kẹt thì **không được chạy lại** trên lane khác → cả field phải chờ chunk chậm nhất (timeout 1 chunk có thể tới ~25 phút).
- **Sửa — HEDGE (bản dự phòng, "the tail at scale"):** khi 1 chunk chạy **> 150 giây** (nghi lane/proxy nghẽn), hệ thống tự **bắn thêm 1 bản trên lane KHÁC** (pickLane né lane đang lỗi/nghẽn ⇒ rơi vào provider đang **rảnh**), rồi **lấy bản nào xong trước, huỷ bản kia**. Chunk kẹt 400s giờ được "cứu" bởi provider rảnh trong ~1-2 phút thay vì chờ mãi.
- **Tiết kiệm:** chỉ hedge **1 lần/chunk** và **chỉ khi vượt ngưỡng 150s** ⇒ chunk bình thường (xong trong ~40-100s) **không** tốn call kép.
- Kết hợp sẵn với: retry→flash (1.59) + đèn đỏ/nghỉ 15s cho lane lỗi (1.64) → provider rảnh luôn được tận dụng.

## v1.64.4 — Sửa TIẾP nút "Re-translate All" (bản 1.64.1 vẫn hỏng) 🔁
- **Triệu chứng:** bấm Re-translate All → hiện *"All fields are already translated or skipped"* và báo hoàn thành, **không** dịch lại từ đầu (vẫn 88/88).
- **Gốc rễ (mới):** bản 1.64.1 đã xoá bản dịch trong store, nhưng hàm dịch lại đọc `store.fields` từ **bản chụp React cũ** (stale closure) — chưa kịp cập nhật ⇒ vẫn thấy toàn field `done` rồi **gộp lại** ⇒ 0 field cần dịch ⇒ báo "đã dịch hết".
- **Sửa:** thêm chế độ **freshStart** — khi Re-translate All, bước chuẩn bị **BỎ QUA hẳn** danh sách field cũ, **trích lại từ thẻ** (mọi field `pending`) và dịch từ **0/N**. Không còn phụ thuộc bản chụp cũ.

## v1.64.3 — Ô Gốc và ô Dịch trong Field Editor cao bằng nhau 📐
- **Bug:** mỗi hàng, ô **ORIGINAL** và ô **TRANSLATED** cao–thấp lệch nhau → nhìn rối. Nguyên nhân: ô Gốc là `<div>` (cao theo nội dung, cap 120px), ô Dịch là `<textarea rows>` (cao theo số dòng gốc, tới ~172px) — hai công thức khác nhau.
- **Sửa:** cả hai ô giờ dùng **chung một chiều cao** (2–8 dòng × 20px) nên **luôn thẳng hàng, cao bằng nhau**. Vẫn kéo giãn tay được nếu muốn xem dài hơn. Đã đo kiểm live: mọi hàng (kể cả nội dung nhiều dòng) ô Gốc = ô Dịch từng pixel.

## v1.64.2 — Hết giật màn hình xuống mỗi khi dịch xong 1 entry 🧷
- **Bug:** đang dịch, cứ xong 1 entry là **view bị kéo xuống** khung log (khó theo dõi Card Preview / Field Editor / chỗ khác).
- **Nguyên nhân:** hộp log tự cuộn bằng `scrollIntoView()` — lệnh này khiến trình duyệt cuộn **cả trang** để đưa hộp log vào tầm nhìn, mỗi khi thêm 1 dòng log (mỗi entry xong).
- **Sửa:** hộp log giờ **chỉ tự cuộn bên trong khung của nó** (đặt `scrollTop`, không đụng scroll trang), và **chỉ dính đáy khi bạn đang ở cuối log** — cuộn lên đọc lịch sử hoặc nhìn chỗ khác thì trang **đứng yên**, không giật nữa.

## v1.64.1 — Sửa nút "Re-translate All" không dịch lại từ đầu 🔁
- **Bug:** bấm Cancel rồi **Re-translate All** → vẫn dịch tiếp từ chỗ cũ (vd 88/123). Nguyên nhân: nút chỉ gọi lại Start, mà app **giữ field đã dịch** (thiết kế resume) + **cache tiến trình trên đĩa tự khôi phục** ⇒ hoá ra là "Continue" trá hình.
- **Sửa:** bấm nút giờ sẽ **hỏi xác nhận** rồi **xoá sạch** bản dịch cũ của thẻ (cả cache trên đĩa + từ điển biến MVU) và dịch lại **từ đầu thật sự** (0/N).
- Muốn dịch tiếp chỗ dở thì dùng nút **Continue Translation** như cũ.

## v1.64.0 — Nút "🚀 Dịch siêu tốc" + đèn đỏ lane lỗi 🚀🔴
### 🚀 Dịch siêu tốc (nút thứ 3 cạnh Dịch nhẹ / Dịch đầy đủ)
- **Gom entry thông minh (bin-packing):** entry **NGẮN** được dồn chung **1 call API** (tối đa **12 entry & 10.000 ký tự/lô**, sắp giảm dần rồi nhét First-Fit) và **đi model PHỤ (flash)** — flash RPM cao gấp mấy lần pro và dư sức dịch entry ngắn. Entry **DÀI (>8K ký tự)** để **riêng 1 call, đi model CHÍNH (pro)** — nội dung khó cần chất lượng.
- Kết quả: card nhiều entry ngắn giảm **hàng chục lần số call**; pro rảnh lo phần khó, flash gánh số lượng — đúng sở trường từng model (khớp combo 3.1-pro + 3-flash của bạn). Các lô vẫn chạy **đa luồng** qua pool như cũ.
- An toàn: nhóm schema MVU (`initvar`/`controller`/`mvu_logic`) vẫn dịch **1-1** như cũ; ngưỡng 10K ký tự/lô để bản dịch (giãn ~3×) không vượt trần output của model.
- Bấm nút là tự bật: mọi nhóm + chế độ hàng loạt lorebook + gom thông minh + đồng bộ MVU. (Có i18n VI/EN/中文.)

### 🔴 Đèn đỏ lane lỗi (API dùng chung nghẽn ngoài RPM)
- Call **fail** (429/5xx/timeout/mạng) → lane (provider+model) đó tự **nghỉ 15 giây** — call tiếp theo tự dồn sang lane khác, không đập tiếp vào proxy đang nghẽn; call **thành công** thì tự reset.
- Panel luồng hiện huy hiệu **"⚠ lỗi ×N"** ngay trên hàng lane; **fail ≥5 lần liên tiếp → tên model tô ĐỎ đậm** để bạn biết lane đó đang chết dù RPM chưa chạm trần.
- *Kỹ thuật:* +6 test bin-packing (146 test tổng). tsc + build xanh.

## v1.63.0 — Sửa bug #3: dịch tới TavernHelper rồi "nằm im" 🧊
> Từ báo lỗi #3: card `Tuhu_V2.2` — "dịch tới một số mục rồi nằm im, không dịch tiếp".
- **Gốc rễ:** script TavernHelper `ERA变量框架1.4.11` nặng **148 KB** (6748 chữ Hán), bị chia ~10 chunk. Bộ gác schema cũ kiểm **"còn BẤT KỲ 1 chữ Hán → dịch lại CẢ field"**. Vì JS chứa nhiều chữ Hán trong string data/comment mà AI giữ lại hợp lệ, bộ gác **luôn fail → re-dịch cả 148 KB tới 3 lần** = mất 30–45 phút cho **một** field (xử lý tuần tự nên nghẽn cả bản dịch) → nhìn như "treo", rồi báo *"Schema translation failed (Chinese characters remaining)"*.
- **Sửa:** bộ gác TavernHelper nay dùng **tỷ lệ chữ Hán sống sót** (dùng chung `detectResidualCjk` với bug #1) — **chỉ dịch lại khi CHƯA DỊCH thật** (>35% chữ Hán còn nguyên = echo / dở nửa chừng), bỏ qua vài chữ Hán còn sót trong code/data. Không còn re-dịch phí cả 148 KB.
- **Lưới an toàn:** vòng dịch từng field nay **giới hạn số lần thử lại** — dù có tình huống bất ngờ, 1 field cũng **không thể kẹt vô hạn** làm treo cả bản dịch (luôn đi tiếp field kế).
- Guard `initvar`/`controller` vẫn giữ nghiêm nhưng **thôi đếm nhầm dấu ngoặc 【】/fullwidth** là "chữ Hán" (cùng lớp bug #2).
- *Kỹ thuật:* +2 test hồi quy (script JS giữ vài chữ Hán → không re-dịch; echo → dịch lại). tsc + **140 test** + build xanh.

## v1.62.0 — Nút "🐞 Báo lỗi" trên header 🐞
- Thêm nút **"Báo lỗi"** (viền đỏ) ở **header trên cùng bên phải**, cạnh nút đổi ngôn ngữ. Bấm → mở **file Excel báo lỗi (OneDrive)** ở tab mới để mọi người cùng ghi bug.
- Có i18n: **Báo lỗi / Report a bug / 报告错误**. Link nằm ở hằng `BUG_REPORT_URL` trong `AppHub.tsx` (dễ đổi sau này).

## v1.61.0 — Sửa nốt 2 báo oan còn lại ở Kiểm tra lỗi dịch 🧯
> Sau khi sửa Template Literal (1.60), chạy Verify live lại thì thấy panel còn 2 loại báo oan **cùng họ** — flag thứ không cần dịch / không phải lỗi. Sửa nốt cho panel đáng tin.
- **"còn tiếng Trung" đếm cả dấu ngoặc 【】《》 là "chữ Hán":** hàm `countCJK` gộp cả dải dấu câu CJK (`U+3000–303F`) và fullwidth (`U+FF00–FFEF`) → dấu ngoặc `【】` giữ nguyên (đúng) bị đếm là "chữ chưa dịch", báo "36 CJK còn lại" / "2 CJK còn lại". Nay **chỉ đếm CHỮ thật** (ideograph Hán + kana Nhật + hangul Hàn), bỏ dấu câu/fullwidth.
- **"Code structure corrupted" so ngoặc `{ }` với 0:** `replaceString`/template literal là **đoạn fragment**, độ sâu ngoặc vốn có thể lệch (bản gốc `开局` đã lệch -1 do `${...}` nội suy). Check cũ ép "phải = 0" → báo oan. Nay **so với độ sâu ngoặc của BẢN GỐC**, chỉ báo khi bản dịch lệch **khác** gốc.
- *Kiểm chứng live:* chạy lại nút **Verify** trên chính card báo lỗi → **6 issue giảm còn 1** (5 báo oan biến mất; còn đúng 1 chênh lệch ngoặc `[]` thật ở 1 entry — verify làm đúng việc).
- *Kỹ thuật:* export `countCJK` + 4 test hồi quy (`【】`→0, `开局`→2, kana/hangul đếm đúng). tsc + **138 test** + build xanh.

## v1.60.0 — Sửa bug #2: Kiểm tra lỗi dịch báo oan "Template Literal" 🧯
> Từ báo lỗi #2: panel **Kiểm tra lỗi dịch** ở mục template literal báo lỗi loạn — "không so cái đã dịch mà đi so chỗ chẳng liên quan", và báo cả cho thứ không cần dịch.
- **Gốc rễ:** bộ kiểm cũ dùng regex `${[^}]+}` **không parse được `${}` lồng nhau** (template literal HTML phức tạp) nên trích cụt; rồi **ghép cặp đoán mò** — lấy *bất kỳ* `${...}` nào ở bản dịch không trùng gốc và tuyên bố "gốc `${bodyStateStr…}` đã dịch thành `${enemies[k]['Loại']…}`" dù hai cái chẳng liên quan. Nó cũng không phân biệt **chuỗi literal** (`'怪物'`→`'Quái Vật'` là ĐÚNG) với **biến MVU đổi tên có chủ đích** (`类型`→`Loại`), nên báo "chưa dịch / dịch sai" oan cho hàng loạt thứ đúng.
- **Sửa:** trích `${...}` **cân bằng ngoặc** (chịu được lồng nhau), và **chỉ soi biến JS THUẦN** (định danh/thuộc tính/index/gọi rỗng — không literal, không ternary, không HTML, không chữ Hán). Chỉ khi một biến thuần ở gốc **mất hẳn** khỏi bản dịch mới cảnh báo (warning). Bỏ hoàn toàn kiểu ghép cặp đoán mò.
- *Kết quả:* các ca trong ảnh báo lỗi (`'怪物'`→`'Quái Vật'`, `enemies[k].类型`→`['Loại']`, `_.get(edata, '基础信息…')`→`'Thông tin cơ bản…'`) **không còn bị báo lỗi**; biến JS bị xoá thật vẫn bắt được.
- *Kỹ thuật:* tách logic ra 3 hàm thuần (`extractBalancedInterpolations`, `isPureCodeInterpolation`, `findMissingCodeInterpolations`) + 9 test hồi quy lấy đúng fixture từ ảnh báo lỗi. tsc + **134 test** + build xanh.

## v1.59.0 — Tăng tốc: retry đẩy xuống model phụ (flash) ⚡
> Từ quan sát live khi dịch card MVU nặng: model chính (pro) RPM thấp (vd 3/phút) + là model *thinking* nên mỗi call chậm; các entry `initvar`/`controller` phải thử lại nhiều lần trên đúng lane pro chậm đó, trong khi **RPM của model phụ (flash) ngồi không** (0/17). 1 card 83 field mất ~40 phút.
- **Sửa:** mỗi lần **thử lại** 1 field (bộ gác chữ Hán bắt còn tiếng Trung, kết quả rỗng/ngắn, hoặc lỗi mạng/timeout) nay **tự chọn lane model phụ (flash)** thay vì xếp hàng lại lane pro. Lượt **đầu tiên vẫn dùng pro** để giữ chất lượng; chỉ phần *retry* mới xuống flash.
- **Lợi:** (a) tận dụng phần RPM flash đang rảnh (flash thường 5–6× RPM của pro), (b) chừa lane pro cho lượt đầu của các field khác → giảm nghẽn ở đuôi. Không tăng tổng RPM (vẫn qua rate-limit từng model), chỉ hết "chờ phí".
- *An toàn:* nếu provider không bật model phụ → giữ nguyên pro (no-op). Bộ rate-limit vẫn đếm theo thời điểm bắt đầu nên call chồng nhau đúng trần/phút. tsc + 125 test + build xanh.
- *Đòn config bổ sung (không cần cập nhật):* đặt **"Ngưỡng ký tự"** > 0 để entry ngắn/vừa đi flash ngay từ lượt đầu — nhanh hơn nữa nếu bạn chấp nhận flash cho phần văn xuôi.

## v1.58.0 — Sửa bug #1: field "DONE" nhưng vẫn tiếng Trung 🛑
> Từ báo lỗi #1 (user tải thẻ về, dịch ra vẫn còn nguyên đoạn tiếng Trung). Đã lấy thẻ gốc + thẻ đã dịch trong báo lỗi, trích nội dung 2 bên ra so, và tìm ra gốc rễ.
- **Gốc rễ:** khi dịch, AI đôi lúc **trả lại nguyên văn tiếng Trung** (echo) — hay gặp khi nội dung khó/bị model từ chối, hoặc **model phụ (flash)** trả lại y nguyên input. Field lúc đó dài **xấp xỉ nguồn** (tỉ lệ ~100%, đúng như badge "DONE 104%" trong ảnh báo lỗi) nên **lọt hết** các bộ kiểm độ dài và bị đánh dấu **DONE dù chưa dịch**. Bộ gác chữ Hán cũ **chỉ soi field schema** (initvar/tavern_helper…), **không soi** content/lorebook/mở đầu/mô tả — nên chúng lọt lưới.
- **Sửa:** thêm **"Bộ gác chữ Hán sót"** cho mọi field văn bản thường. Bản dịch tốt zh→vi gần như **0% chữ Hán** (chỉ vài danh từ riêng ≈ vài %); nếu bản dịch **còn > 35% số chữ Hán của nguồn** → coi là **chưa dịch** → **tự thử lại** (tới hết số lần retry); vẫn còn thì **đánh dấu LỖI (đỏ)** thay vì DONE giả, để bạn thấy & dịch lại đúng chỗ đó.
- **Không bắt nhầm:** bỏ qua danh từ riêng giữ lại (vài %), key Lorebook merge (cố ý giữ key gốc + thêm key dịch), field code (regex/tavern_helper — chữ Hán trong code/URL là hợp lệ, đã có bộ gác riêng), và chữ Hán trong URL/đường dẫn import. Đã đối chiếu trên chính thẻ trong báo lỗi: **0 field tốt bị bắt nhầm**, chỉ đúng ca echo bị chặn.
- *Kỹ thuật:* logic tách ra `detectResidualCjk()` (thuần, test được) + 7 test hồi quy lấy fixture từ thẻ báo lỗi thật. tsc + **125 test** + build xanh.

## v1.56.4 — Dịch Card đã dịch xong EN + 中文 (Đợt 4) 🌏
> Tiếp nối v1.56.3. **Dịch Card** — công cụ chính, cũng là công cụ nặng nhất — giờ đổi ngôn ngữ theo nút VI/EN/中文 trên header.
- **Toàn bộ 20 panel** đã có tiếng Anh & tiếng Trung: cấu hình dịch, bảng trường (Field Editor), tiến trình + nhật ký, xuất thẻ + sức khoẻ thẻ, cấu hình API/provider, Regex Manager, Kiểm tra lỗi (Verify), Chiến lược B (MVU) & C (EJS), So Sánh Card, EJS Creator, Trợ Lý AI và trình chuyển đổi MVU-Zod 7 bước.
- **Bản Tiếng Việt giữ nguyên 100%.** Đã mở trình duyệt đối chiếu: nhãn tiếng Anh quen thuộc vẫn y hệt, chuỗi tiếng Việt vẫn đúng chỗ, 0 lỗi console.
- **237 chỗ `isVi` biến mất khỏi mã nguồn.** Trước đây app có 237 chỗ viết `isVi ? 'tiếng Việt' : 'English'`, nhưng nhánh tiếng Việt **chưa bao giờ chạy** (mặc định là `en`). Giờ chúng thành key i18n thật — bản VI vẫn hiện đúng chuỗi tiếng Anh cũ, còn 中文 thì có bản dịch riêng.
- **Sửa 1 bug thật gặp dọc đường:** ở panel Provider, dòng báo lỗi được tô đỏ bằng cách kiểm tra `chuỗi.startsWith('Lỗi')` — tức là dùng chữ hiển thị làm logic. Dịch sang tiếng Anh/Trung là mất luôn màu đỏ báo lỗi. Đã thay bằng cờ trạng thái riêng.
- *An toàn:* **không đụng prompt AI**. Chừa nguyên các chuỗi vốn là **logic**, dịch vào là hỏng: `targetLanguage === 'Tiếng Việt'` (quyết định hậu tố file xuất), `keys` của Lorebook bị so khớp bằng `includes()`, tiền tố tên tài liệu RAG. Cũng chừa mọi **dữ liệu ghi thẳng vào thẻ của bạn**: tên/comment/nội dung entry Lorebook mặc định, tên & mô tả regex preset, template EJS, văn bản mẫu.
- Các nhãn kỹ thuật của SillyTavern (`findRegex`, `replaceString`, `MarkdownOnly`, `Before`/`After`, `原Key`/`译Key`) giữ nguyên ở mọi ngôn ngữ.
- *Kỹ thuật:* 12 commit nhỏ, mỗi commit tsc + 108 test + build xanh mới push. Key được **kiểm bằng TypeScript** (thiếu key ở `vi`/`zh` = lỗi biên dịch) + test key-parity và placeholder-parity.
- **Tiếp theo:** Tạo Card (đợt lớn nhất) → Trích Card.

## v1.56.3 — Tạo Preset đã dịch xong EN + 中文 (Đợt 3) 🎛️
> Tiếp nối v1.56.2. **Tạo Preset** giờ đổi ngôn ngữ theo nút VI/EN/中文 trên header của Hub.
- **Toàn bộ giao diện Tạo Preset** đã có tiếng Anh & tiếng Trung: 4 bước (Tham số, Khối Prompts, Regex Scripts, Xuất bản JSON), bảng **Cài đặt** (API + Hành vi AI), và khung chat **ST Studio**.
- **Bản Tiếng Việt giữ nguyên 100%** — đã mở trình duyệt đối chiếu cả 4 bước, không lệch một chữ.
- **⚠️ Nội dung preset MẶC ĐỊNH không bị dịch.** Các khối như `impersonation_prompt`, `continue_nudge_prompt`, `"🎭 Đạo Diễn Hệ Thống"`… **đi thẳng vào file preset bạn xuất ra**, nên dù chọn EN hay 中文, file xuất ra vẫn y hệt bản gốc tiếng Việt. Đây là cố ý.
- *An toàn:* **không đụng prompt AI**. Chừa nguyên các đoạn văn bản gửi cho AI trong khung chat: mẫu **"📋 Mẫu lịch trình"**, khối `[FILE PRESET MẪU ĐÍNH KÈM…]`, và 2 câu gợi ý khi bấm "Tạo Preset"/"Tạo Regex". Cũng chừa `contextBuilder` (dựng ngữ cảnh cho AI) và chuỗi `"Người dùng đã dừng"` (bị so bằng logic ở chỗ khác).
- Tên trường của SillyTavern (`MarkdownOnly`, `PromptOnly`, `RunOnEdit`, `findRegex`, `replaceString`, `Before`/`After`) giữ nguyên ở mọi ngôn ngữ — dịch ra là không tra cứu được nữa.
- *Kỹ thuật:* thêm `preset-tool/src/i18n/{en,vi,zh}` — `en` là **nguồn của kiểu**, thiếu key ở `vi`/`zh` là **lỗi biên dịch**. App thuần client nên ngôn ngữ chốt 1 lần lúc nạp (`?lang=` do Hub truyền → `localStorage` → mặc định `vi`), không có nguy cơ lệch hydration. tsc + build sạch; 108 test ở app gốc vẫn xanh.
- **Tiếp theo:** Dịch Card → Tạo Card → Trích Card.

## v1.56.2 — Mod Card đã dịch xong EN + 中文 (Đợt 2) 🛠️
> Tiếp nối v1.56.0. **Mod Card** giờ đổi ngôn ngữ theo nút VI/EN/中文 trên header của Hub.
- **Toàn bộ giao diện Mod Card** đã có tiếng Anh & tiếng Trung: màn chính, bảng Diff, tab Cài đặt, và 5 panel con (tải thẻ, Mod Rules, đổi biến MVU-Zod, Đào sâu 1 phần, Provider bổ sung).
- **Bản Tiếng Việt giữ nguyên 100%** — đã đối chiếu ảnh chụp trước/sau, không lệch một chữ.
- *An toàn:* **không đụng prompt AI**, và chừa nguyên các chuỗi vốn là "logic" — dịch vào là hỏng: mức đào sâu `nhẹ/vừa/sâu` (vừa lưu cấu hình vừa đi vào prompt), thông báo huỷ `"Người dùng đã dừng"` (bị so bằng regex ở chỗ khác), tên rule `"Yêu cầu tùy chỉnh của người dùng"` (nhồi vào prompt), và đoạn `[Đã sửa …]` (ngữ cảnh gửi cho AI).
- *Kỹ thuật:* Mod Card chạy Next.js — ngôn ngữ được đọc ở **server** (`?lang=` do Hub truyền xuống) rồi bơm xuống cây client, nên **không lệch hydration, không nháy ngôn ngữ**. Đã kiểm bằng trình duyệt thật: VI/中文 đều đúng, 0 lỗi console. tsc + build sạch.
- **Tiếp theo:** Tạo Preset → Dịch Card → Tạo Card → Trích Card.

## v1.56.0 — Nút đổi ngôn ngữ VI / EN / 中文 (Đợt 1: hạ tầng) 🌐
> Thêm nút chuyển ngôn ngữ giao diện ở **góc trên bên phải** header. Bấm là **lưu + tải lại trang**, và chỉ nạp **đúng 1 bộ chuỗi** của ngôn ngữ đó → **app không nặng thêm**.
- **⚠️ Chọn "VI" = giao diện GIỮ NGUYÊN 100% như trước.** Các nhãn tiếng Anh quen thuộc ("API Configuration", "Expert Mode"…) **không bị đổi**, đúng như đã hứa — user cũ không phải làm quen lại. (Kỹ thuật: có test tự động khoá điều này lại, ai sửa nhầm là hỏng test ngay.)
- **中文**: đã dịch xong **~293 nhãn chính** + toàn bộ vỏ Hub (thanh 5 công cụ, thanh công cụ, màn chờ server).
- **Đây mới là ĐỢT 1 (hạ tầng).** App có ~3.500 chuỗi nên phải dịch dần cho chắc, không làm ẩu một lần. Vì vậy **chọn EN / 中文 lúc này vẫn sẽ thấy tiếng Việt ở một số chỗ** — sẽ hết dần qua các đợt sau: **Mod Card → Tạo Preset → Dịch Card → Tạo Card → Trích Card**.
- Ngôn ngữ được truyền xuống các tool con qua `?lang=` (sẵn sàng cho các đợt sau). Nút EN/VI cũ ở thanh bên đã được thay bằng nút mới trên header.
- *Ghi chú nhỏ:* nếu trước đây bạn từng tự bấm sang "VI" ở thanh bên (ít người dùng), giao diện nay sẽ về đúng bộ mặt mặc định quen thuộc.
- *Kỹ thuật:* tách `i18n/locales/{en,vi,zh}` + `i18n/ui/{vi,en,zh}` thành chunk riêng (Vite code-split, chỉ tải chunk đang dùng); key được **kiểm bằng TypeScript** (thiếu key = lỗi biên dịch) + **11 test** (khoá hợp đồng "VI = hôm nay", key parity, giữ nguyên placeholder `{count}`, và chạy thật đường boot). Không đụng prompt AI. tsc + 108 test + build sạch.

## v1.55.6 — So Sánh Card: "Gộp thông minh" — tái dùng bản dịch cũ khi card update ⚡
> Tình huống: card **đã dịch xong**, rồi **tác giả update bản gốc** (thêm/sửa vài chỗ). Trước đây phải **dịch lại cả card**. Nay chỉ dịch đúng **phần mới**.
- **Nút "🔀 Gộp thông minh"** (hiện khi đủ 3 card: Raw / Đã Dịch / Final). Bấm → tool **so từng entry** giữa **Card Raw (gốc cũ)** và **Card Final (gốc mới)**:
  - Entry **KHÔNG đổi** → **tái dùng bản dịch cũ** (lấy từ Card Đã Dịch). Giữ nguyên **regex/code** đang chạy tốt → **không dịch lại → không đẻ lỗi**.
  - Entry **mới / bị tác giả sửa** → **chừa nguyên ngữ** để dịch.
- **Xem trước ngay tại cột Card Final:** ô **♻ tái dùng** (xanh, hiện bản dịch cũ) / ô **✏️ cần dịch** (vàng, hiện nguyên ngữ mới), kèm bộ đếm **"Tái dùng X · Cần dịch Y / tổng"**.
- **"➡️ Đưa sang Dịch Card":** bê thẳng Card Final sang màn dịch chính — **X mục tái dùng đánh dấu ĐÃ DỊCH (khoá, bỏ qua)** + **Y mục mới CHỜ DỊCH**. Bấm **Dịch** → engine đa luồng **chỉ chạy Y mục mới** → xong nhanh, rồi Xuất card như thường. (Hoặc **"⬇️ Xuất Final"** để tải thẳng file đã gộp.)
- **An toàn:** so sánh **bảo thủ** — chỉ bỏ qua khác biệt xuống dòng CRLF/LF; mọi thay đổi nội dung thật đều tính là "cần dịch" (thà dịch lại còn hơn tái dùng nhầm bản dịch cho nội dung đã đổi). Hoàn toàn **không tốn AI** (chỉ so chuỗi). +8 unit test cho logic gộp. tsc + 97 test + build sạch.

## v1.55.4 — MỚI: "So Sánh Card" — soi 3 phiên bản cùng 1 card cạnh nhau 🔀
> Thêm chế độ so sánh cùng 1 card ở nhiều phiên bản để **xem mình đã dịch thế nào** và **đối chiếu các bản dịch khác nhau**.
- **Nút "🔀 So Sánh Card"** ở sidebar Dịch Card (luôn dùng được, không cần card đang mở). Bấm vào mở màn hình so sánh: **3 cột** — **Card Raw** (gốc), **Card Đã Dịch**, **Card Final** — mỗi cột nạp 1 file card riêng (.json / .png, kéo-thả hoặc bấm chọn). Nạp **1–3 cột đều được**.
- **Gióng thẳng hàng theo từng entry**, gom theo nhóm dễ đọc: Cốt lõi (tên/mô tả/tính cách), Lời mở đầu & hội thoại mẫu, Lorebook (nội dung), Từ khoá Lorebook, System Prompt, Depth Prompt, Script TavernHelper (MVU…), Regex Scripts. Mục nào 1 card không có thì hiện "(không có mục này)".
- **Sửa trực tiếp + Lưu từng ô:** gõ vào ô entry rồi bấm **Lưu** (hoặc Ctrl+Enter) → ghi thẳng vào card đó (trong bộ nhớ). Ô đã sửa mà **chưa lưu** hiện **chấm vàng nổi bật**. Mỗi cột có **Lưu tất cả** và **Xuất JSON** (kèm **Xuất PNG** nếu nạp từ PNG — giữ ảnh gốc).
- **Tiện dụng:** ô **tìm nhanh** theo tên/đường dẫn entry; toggle **"Chỉ hiện entry khác nhau"** để soi đúng chỗ dịch lệch; cảnh báo khi đóng mà còn ô chưa lưu; gập/mở từng nhóm.
- **An toàn:** hoàn toàn **offline, không tốn AI/quota**; **tách biệt** với phiên dịch chính (không đụng card đang dịch). +14 unit test (parse card độc lập + gióng hàng/nhóm/lọc khác nhau). tsc + 89 test + build sạch.

## v1.55.3 — Dịch Card nhanh hơn: đa luồng bỏ "đợi cả đợt" (pool liên tục) ⚡
> User góp ý: đa luồng đang tốt, nhưng chia việc theo **đợt** — mở ~155 luồng rồi **chờ CẢ 155 xong** mới sang đợt kế. Có 1 entry khổng lồ chạy rất lâu (ảnh: **7229 giây**) → **154 luồng còn lại ngồi không** đợi 1 thằng. Muốn: luồng nào xong là **nhận entry mới chạy tiếp ngay**, vẫn đúng RPM.
- **Đổi cơ chế chia việc → "pool liên tục":** thay vì "một đợt N việc → chờ hết đợt → đợt kế", nay mở đúng N luồng và **luồng nào rảnh là KÉO entry kế trong hàng đợi NGAY**, không đợi luồng chậm. ⇒ tổng thời gian ≈ **entry chậm nhất** thay vì **cộng dồn theo đợt**; khi có entry to/chậm, tăng tốc rõ rệt (các luồng không còn thời gian chết).
- **RPM vẫn TUYỆT ĐỐI an toàn:** cơ chế giới hạn RPM **không đổi** — mỗi lượt gọi vẫn đi qua đúng bộ điều nhịp RPM cũ (theo từng provider+model). Số luồng chạy đồng thời vẫn = ngân sách RPM như trước (không tăng), chỉ **lấp chỗ trống** thay vì để trống.
- **Áp cho:** dịch **Lorebook**, chế độ **Mod**, và **Regex** (regex trước đây chạy **tuần tự** từng script — nay cũng chạy song song trong pool, vẫn đúng RPM).
- **Chất lượng giữ nguyên:** đối chiếu chéo lô, kiểm biến MVU, chống dịch trùng 1 mục — không đổi. Nút **Dừng** cắt ngay, **Tạm dừng/Tiếp** đúng (thực ra **nhạy hơn** vì kiểm ở đầu mỗi việc, không phải chờ hết đợt).
- *Kỹ thuật:* thêm `src/utils/runWorkerPool.ts` (mirror mẫu pool đã chạy tốt sẵn trong `ejsSync`/`aiVerify`) + **10 unit test** chứng minh: mỗi việc chạy đúng 1 lần, không vượt số luồng, **1 việc chậm KHÔNG chặn việc khác**, dừng/hủy đúng. Bỏ 2 chỗ `Promise.allSettled(window)` (rào chắn). tsc + 75 test + build sạch.

## v1.55.2 — Dịch Card: sửa UI panel "Kiểm Tra Lỗi Dịch" khó đọc/khó cuộn
> User báo: danh sách lỗi ở panel **Kiểm Tra Lỗi Dịch** bị **set cứng chiều dọc**, cụt, không cuộn được / khó đọc nội dung bug.
- **Nguyên nhân:** mỗi danh sách lỗi bọc trong ô cuộn **cao cố định 300–450px** lồng bên trong trang → tạo **thanh cuộn con tí hon** (chỉ thấy 2–3 dòng), lại chồng với cuộn trang → rối, tưởng bị cụt.
- **Sửa:** bỏ giới hạn chiều cao — danh sách lỗi nay **chảy tự nhiên theo trang**, chỉ cần **cuộn trang 1 lần là đọc hết**, áp cho cả 5 danh sách (Quét Regex, kết quả sửa Regex, lỗi Field, lỗi Thẻ, biến mồ côi). Dùng bộ lọc mức độ/nhóm để thu gọn khi lỗi nhiều.
- Ô xem **ORIGINAL / CURRENT** khi bung 1 lỗi tăng từ **80px → 260px** để đọc trọn nội dung đoạn bị lỗi.

## v1.55.1 — SỬA Mod Card lỗi "JSON parse failed" ở bước Phân tích thẻ
> User báo Mod Card báo lỗi đỏ *`JSON parse failed: Unexpected token 'U', "[USER_CUSTOM_PROMPT]"... is not valid JSON`* ngay giai đoạn **Phân tích thẻ (Analyze Phase)** → cả pipeline dừng, "vẫn lỗi cũ" dù thử lại.
- **Nguyên nhân (không phải AI trả sai):** AI **đã xuất JSON đúng** — nằm trong khối ` ```json ` ở cuối, **sau** phần phân tích 5 bước bằng văn xuôi (Chain-of-Thought). Nhưng bộ tách cũ dùng `match(/\[...\]/)` **tham lam**: vơ từ dấu `[` **ĐẦU TIÊN** trong văn xuôi (vd `[USER_CUSTOM_PROMPT]`, `[MODULE 1]`, `[name]`) tới dấu `]` **CUỐI** → dính cả prose lẫn JSON → `JSON.parse` vỡ.
- **Sửa:** thay bằng **bộ tách JSON bền vững**: (1) ưu tiên khối ` ```json ` (lấy khối cuối); (2) nếu không có, **quét cân bằng ngoặc CÓ HIỂU CHUỖI** — bỏ qua `[` `]` nằm trong `"..."` (vd `"[Đoạn 3]"` trong nội dung), thử parse, lấy khối hợp lệ đầu tiên (ngoặc trong văn xuôi tự parse-fail nên bị bỏ qua). Đã **kiểm trên đúng phản hồi bị lỗi của user** → ra mảng 2 mục đúng.
- **Áp cho toàn bộ 5 chỗ đọc JSON của Mod Card** (Analyze, Đồng bộ Keyword, Kiểm tính nhất quán, Validate ×2) — cùng một loại bệnh, sửa dứt điểm cả cụm.
- *Lưu ý riêng:* lỗi **524 (Gemini API)** khi bấm "Đào sâu 1 phần" trên entry khổng lồ là **vấn đề KHÁC** (proxy hết giờ vì 1 call quá dài) — sẽ xử lý riêng; tạm thời cứ dùng **"Chế độ Mở rộng"** cho cả section (đã tự chia phần từ 1.54.0) hoặc chọn 1 khối nhỏ để đào sâu.

## v1.55.0 — Game UI "đập đi xây lại": CHAT với AI để tạo giao diện game 🎮
> Theo yêu cầu client (Guillichan): *"Vào Tạo Card → MVUZOD → Game UI. Đập đi xây lại hết. Biến nó thành dạng chat với AI. Suy nghĩ cơ chế nào để nó làm một regex thật sự xịn."* — Đây là bản hoàn chỉnh (kết hợp lõi kiểm ở 1.54.3).
- **Giao diện mới hoàn toàn — hội thoại 2 cột:** Bên trái là **khung chat**; bạn cứ nói ý muốn ("làm status bar hiện máu dạng thanh đỏ + ô vàng", "thêm khung nhân vật"…), AI viết code và **chỉnh dần qua trò chuyện** — **không phải bấm Tạo lại từ đầu** như bản cũ (đỡ tốn lượt gọi, kết quả không nhảy lung tung). Bên phải là **Preview trực tiếp** + tab **Regex** (xem script + trạng thái kiểm) + tab **Sample** (đoạn văn mẫu, sửa tay được).
- **Cơ chế "regex xịn thật sự" (điểm cốt lõi client hỏi):** mỗi lần AI viết/sửa, hệ thống **tự chạy regex lên một đoạn văn AI mẫu để CHỨNG MINH nó match** — kiểm 3 tầng tự động: (1) cú pháp regex + JS hợp lệ; (2) **MATCH THẬT** + đủ mọi nhóm `$1..$9` code dùng (bắt cả lỗi kinh điển "quên bật chế độ nhiều dòng"); (3) biến trong code **phải có thật trong schema** (chống AI bịa biến). Lỗi ở tầng nào → **AI tự sửa, tối đa 3 vòng**, rồi mới giao. Không còn cảnh "regex nhìn đẹp mà dán vào không chạy".
- **Nút "⚡ Tạo nhanh (không AI)":** dựng ngay một bộ giao diện nền từ template — **tức thì, $0, không tốn API** — để bạn có cái sẵn rồi nhờ AI chỉnh cho đẹp/đúng ý.
- **Tiện dụng:** nút **Dừng** cắt ngang giữa chừng (không vỡ phiên, nhắn tiếp được); **đổi tab rồi quay lại vẫn giữ nguyên** cuộc trò chuyện + kết quả; nút **Apply vào thẻ** chỉ bật khi regex đã **qua kiểm** (khỏi lỡ tay dán đồ hỏng); **Phiên mới** để làm lại từ đầu.
- **Tối ưu cho Gemini** (model chính của bạn): tận dụng context lớn (nhét đủ schema + toàn bộ code hiện tại mỗi lượt, không cắt xén) và cho phép **output dài 60k+** — chính là lý do bản cũ hay bị **cắt cụt** giữa chừng.
- *Kỹ thuật:* 5 file mới (`gameUiValidator`, `gameUiXml`, `gameStudioStore`, `gameUiStudioPrompt`, `gameUiAgent`, `GameUiStudio`), output AI theo **XML** (không JSON — bền hơn với HTML lớn), mọi call nhận **AbortSignal**. **44 test** xanh, tsc + build sạch. (Bản cũ `GameFrontendPreview` tạm giữ trong repo, sẽ gỡ ở bản dọn sau khi bạn xác nhận chạy ổn.)

## v1.54.3 — Nội bộ: bộ kiểm regex 4 tầng cho Game UI (1/3)
> Bước 1 của việc "đập đi xây lại Game UI" (Tạo Card → MVUZOD) thành dạng **chat với AI**. Bản này chỉ thêm **lõi kiểm tra**, chưa đổi giao diện.
- **`gameUiValidator.ts`** — chuỗi kiểm deterministic để AI tự sửa regex (đây là "cơ chế regex xịn" client yêu cầu):
  - **V1 Cú pháp:** `findRegex` biên dịch được, JS trong replaceString parse sạch, field enum đúng luật ST (placement 1..5, không markdownOnly+promptOnly cùng true).
  - **V2 MATCH THẬT:** `findRegex` **phải khớp** một đoạn văn AI mẫu + **đủ mọi nhóm `$1..$9`** mà replaceString dùng → regex được *chứng minh ăn* trước khi giao (bắt được cả lỗi quên flag `s` cho status block nhiều dòng).
  - **V4 Khớp schema:** biến MVU trong code phải có thật trong schema (chống bịa biến).
- **19 test** phủ đủ ca (regex vỡ, quên flag, thiếu nhóm, biến bịa, pass hoàn chỉnh…). tsc tao-card sạch.

## v1.54.2 — SỬA lỗi "Failed to resolve import acorn" sau cập nhật (deps không đồng bộ)
> Nối tiếp 1.54.1. Sau khi cập nhật, một số máy báo `Failed to resolve import "acorn"` (hoặc module khác) → app không mở.
- **Nguyên nhân:** `start.bat` và `update.bat` cũ chỉ chạy `npm install` **khi thiếu `node_modules`**. Khi cập nhật kéo về **thư viện MỚI** (vd `acorn` cho lưới an toàn cú pháp), `node_modules` đã tồn tại → **bỏ qua cài** → thiếu thư viện → Vite báo lỗi import.
- **Sửa:** `start.bat` + `update.bat` nay **LUÔN `npm install`** (Hub + cả 3 tool con) mỗi lần chạy để thư viện luôn khớp với code mới (dùng `--no-audit --no-fund` cho nhanh). `update.bat` cũng chuyển sang `git fetch + git reset --hard origin/main` (đồng bộ cứng, không kẹt package-lock) và cài deps cho cả 4 app.
- **⚠️ Máy đang lỗi cần chạy TAY 1 lần** (vì bản sửa nằm trong file .bat, phải cập nhật mới có): mở thư mục cài đặt, chạy
  `git fetch origin main && git reset --hard origin/main && npm install`
  rồi chạy lại `start.bat`. Từ lần sau, cập nhật + khởi động sẽ tự cài thư viện đúng.

## v1.54.1 — SỬA nút Cập nhật bị kẹt mãi (lỗi package-lock)
> Nhiều máy bấm Cập nhật báo lỗi *"Your local changes to package-lock.json would be overwritten by merge"* → **không update được nữa**.
- **Nguyên nhân:** mỗi lần cập nhật, bước `npm install` **tự sửa `package-lock.json`** (file được git track). Lần sau, `git pull` gặp thay đổi cục bộ đó → **từ chối merge** → cập nhật kẹt vĩnh viễn.
- **Sửa:** đổi lệnh cập nhật từ `git pull origin main` → **`git fetch origin main && git reset --hard origin/main`** (cả Hub lẫn Tạo Card). Đồng bộ **CỨNG** về đúng bản trên GitHub → **luôn chạy được**, không kẹt vì package-lock. Dữ liệu user **không-track** (thẻ đang dịch, cache, progress, file trong `dev_data`…) **vẫn được giữ nguyên**.
- **⚠️ Máy đang kẹt cần làm TAY 1 LẦN** (vì bản sửa này nằm trong file cấu hình, phải cập nhật được mới có): mở thư mục cài đặt, chạy `git fetch origin main && git reset --hard origin/main` rồi **tắt hẳn + chạy lại `start.bat`**. Sau lần đó, nút **Cập nhật** trong app sẽ tự chạy được mãi.

## v1.54.0 — Mod Card: sửa lỗi entry quá lớn "chả làm được gì"
> Theo phản hồi user: mod/mở rộng một entry rất dài (vd "quy tắc tiên tử sa đọa 2" ~115.000 ký tự) thì báo lỗi, không ra kết quả.
- **Nguyên nhân:** Mod Card gửi **cả entry trong 1 lần gọi AI**. Với entry cả trăm nghìn ký tự — nhất là chế độ **Mở rộng** (output còn dài hơn input) — kết quả bị **cắt cụt** quá giới hạn output của model → nội dung vỡ / rỗng → "chả làm được gì".
- **Sửa:** entry **narrative** quá lớn (> ~8.000 ký tự) nay tự **CHIA PHẦN** (cắt ở ranh giới đoạn → dòng, **không mất nội dung** — đã kiểm trên đúng file của user), **mod/mở rộng TỪNG PHẦN** (đưa đuôi phần trước làm ngữ cảnh để giữ mạch) rồi **ghép lại**. Mỗi phần gọn nên không còn bị cắt cụt.
- **UI:** hiển thị tiến độ **"phần i/N"** cho entry lớn (biết là đang chạy, không phải treo). Nút **⏹ Dừng** vẫn cắt được giữa chừng.
- **Code/EJS KHÔNG bị chia** (chia dễ vỡ cấu trúc) — giữ gọi 1 lần như cũ. Kiểm trên file thật: entry 115k → 17 phần (≤7.952 ký tự/phần), 23k → 4 phần, không mất chữ. tsc mod-card sạch.

## v1.53.0 — Nâng cấp RAG: ngữ cảnh rộng/sâu hơn (Dịch Card)
> Theo yêu cầu: nâng cấp hệ thống RAG. Hệ thống vốn đã mạnh (TF-IDF + tiered retrieval + glossary + translation memory, chạy client-side không tốn API) → đợt này **bồi thêm chiều SÂU** mà không phá nguyên tắc đó.
- **Kích hoạt entry Lorebook theo KEYWORD (mới).** Khi dịch một field mà nội dung **nhắc tới keyword** của một entry Lorebook **khác** (đã dịch xong) → tự kéo **nội dung entry đó** vào ngữ cảnh (đúng cách SillyTavern trigger lorebook). Nhờ vậy đoạn văn nhắc "李明" sẽ được dịch kèm định nghĩa/tên đã chốt của 李明 → **tên riêng & thuật ngữ nhất quán hơn**, không bịa bản dịch khác.
- **Nới ngân sách ngữ cảnh** cho field tường thuật + lorebook (thêm vài field liên quan + ký tự mỗi lần dịch) để có chỗ chứa lore liên quan. Code/regex vốn đã có ngân sách lớn nên giữ nguyên.
- Vẫn **hoàn toàn client-side, không thêm call API**. Kỹ thuật: hàm thuần `findKeywordTriggeredEntries` (khớp keyword gốc → content đã dịch) đưa vào tier "must-include"; **+6 test**. Build + 66 test xanh.

## v1.52.0 — "Bảo vệ CSS khỏi CJK": sửa "Giữ nguyên" bị dịch + mặc định "Dịch"
> Theo phản hồi user: chọn *Giữ nguyên* mà CJK trong CSS vẫn bị dịch.
- **Sửa lỗi "Giữ nguyên" không tuân theo.** Bộ chặn cũ chỉ bắt CJK **ngay sau dấu `(`** và **bắt buộc có phần đuôi** (`func(商 10px)`) → **sót** các biến thể: `drop-shadow(商)`, `blur(商)`, `filter: drop-shadow(10px 商)`… nên chúng lọt ra và **vẫn bị dịch**. Nay chặn CJK ở **bất kỳ đâu trong ngoặc hàm** và giữ **toàn bộ đối số** → khôi phục nguyên văn (kể cả `10px`).
- **Đổi mặc định sang "Dịch (Translate)".** Người dùng mới sẽ mặc định *cho phép dịch* CJK trong CSS; **cấu hình đã lưu của người cũ giữ nguyên** (không tự đổi).
- Thêm **7 test** round-trip cho mask/unmask (preserve ẩn đúng + khôi phục y hệt; translate không đụng gì). 60 test xanh, tsc sạch.

## v1.51.1 — Nội bộ: tách monolith (bước 1) — cụm chunking ra riêng
> Không đổi hành vi app. Bắt đầu "tách dần" các file lõi quá lớn để dễ bảo trì (đã có bộ test làm lưới an toàn).
- Tách cụm **cắt văn bản dài** — `chunkText` + 8 hàm dò *ranh giới an toàn* (`isSafeBoundary`, `findSafeBoundary`, `isInside{FunctionBody,ScriptOrStyle,StringLiteral,RegexLiteral,HtmlTag,CssAtRule,Url}`, `countUnescapedBackticks`) — từ `apiClient.ts` ra **`src/utils/chunking.ts`** (~465 dòng). `apiClient.ts` **4362 → 3897 dòng**.
- **An toàn**: cụm này thuần tuý (chỉ xử lý chuỗi, không gọi API/không đụng store) + `chunkText` đã có test riêng. `apiClient` **re-export** `chunkText` nên mọi file khác `import { chunkText } from './apiClient'` **giữ nguyên**, không phải sửa. `npm run build` + **53 test** xanh, tsc sạch.
- Đây là bước tách đầu; các mảng khác (streaming, pool/rate-limit, prompt-build) có thể tách dần sau theo cùng cách.

## v1.51.0 — Nhật ký gom theo giai đoạn (Dịch Card)
> Dễ theo dõi hơn: nhật ký dài giờ chia nhóm gấp/mở được thay vì một dòng chảy phẳng.
- **Gom log theo giai đoạn**: **🔧 Chuẩn bị** (sắp xếp + Chiến lược B/C) → **🌐 Dịch** (vòng lặp từng trường) → **🔍 Kiểm tra** (hậu kiểm MVU/EJS). Mỗi nhóm có tiêu đề **bấm để thu gọn/mở** + đếm số dòng.
- **Không phá gì cũ**: bộ lọc theo loại (✓/✗/!/↻…) vẫn chạy như trước; ca chỉ có 1 giai đoạn thì hiển thị **phẳng như cũ** (không thêm tiêu đề thừa).
- Kỹ thuật: thêm `LogPhase` + `addLog` tự đóng dấu giai đoạn theo `logPhase` hiện tại; chỉ đặt **3 mốc** `setLogPhase` ở ranh giới giai đoạn trong `useTranslation` (không đụng ~50 chỗ ghi log). 53 test xanh, tsc sạch.

## v1.50.0 — Bảng "Sức khoẻ thẻ" bấm-để-nhảy-tới-trường (Dịch Card)
> Dễ theo dõi hơn: từ danh sách vấn đề, một cú bấm là tới đúng chỗ cần sửa — không phải tự dò.
- **Bấm 1 dòng vấn đề** trong "🩺 Sức khoẻ thẻ" → **nhảy thẳng tới trường** đó:
  - **Trường thường**: tự chuyển đúng **tab**, xoá ô Tìm, **cuộn** danh sách (kể cả list ảo hoá) tới đúng dòng và **tô sáng ~2.6s**; hoạt động ở cả chế độ Table lẫn Diff.
  - **Trường REGEX**: mở **panel Quản lý Regex** và **chọn đúng script** chứa trường đó (regex nằm ở view riêng, không chung bảng field — nay vẫn tới được).
- Kỹ thuật: thêm tín hiệu tạm `jumpToFieldPath` trong store; ExportPanel phát, FieldEditor (trường thường) + RegexManagerPanel (regex) tiêu thụ; cuộn bằng `virtualizer.scrollToIndex`. Build + 53 test xanh.

## v1.49.0 — Đồng bộ nốt: Dừng ở Tạo Preset + cảnh báo JS ở Tạo Card
> Khép lại việc "nút Dừng cắt được việc đang chạy" + "lưới an toàn cú pháp" trên cả 5 app.
- **Tạo Preset — nút ⏹ Dừng cho trợ lý chat.** Khi AI đang trả lời, nút Gửi chuyển thành **nút Dừng đỏ** — bấm là **hủy call đang chạy ngay** (trước chỉ chờ hết timeout 180s). Bấm Dừng → hiện "⏹ Đã dừng theo yêu cầu", không retry. (Kỹ thuật: luồn `AbortSignal` qua `callAI`/`fetchWithTimeout`.)
- **Tạo Card — kiểm cú pháp JS của game HTML.** Ngoài `autoFixGameHtml` (sửa cấu trúc thẻ), nay còn **biên dịch thử** từng `<script>` (bằng `new Function`, không chạy): nếu vỡ cú pháp → hiện **badge đỏ "N/M script vỡ JS"** cạnh preview để biết mà sửa trước khi dùng.
- Sau đợt này, **cả 5 app** đều: (a) nút Dừng cắt được việc đang chạy, (b) có lưới cảnh báo/vá cú pháp script ở nơi thực sự sinh/sửa code.

## v1.48.0 — Lưới an toàn cú pháp <script> dùng chung (Dịch Card + Mod Card)
> Gom một mối + mở rộng cảnh báo "script vỡ" sang Mod Card.
- **Dịch Card — gom về 1 util `scriptSafety.ts`.** Logic *trích thân `<script>` + parse acorn* trước đây **lặp** ở `surgical.ts` (để tự vá) và `cardHealth.ts` (để cảnh báo). Nay gộp thành một nguồn (`extractScriptBodies` / `jsParseError` / `isJsSyntaxOk` / `checkHtmlScripts`), hai chỗ dùng chung → bớt lệch/bug. Hành vi giữ nguyên (test surgical trên card lỗi thật vẫn xanh).
- **Mod Card — thêm cảnh báo script vỡ.** Sau khi mod, nếu một **script JS** (bỏ qua EJS `<% %>`) **gốc chạy được mà bản mod vỡ cú pháp** → hiện hộp cảnh báo đỏ liệt kê tên script để kiểm tay ở Bảng Diff (nạp vào SillyTavern kiểu này dễ *liệt nút*). Chỉ **cảnh báo**, không tự sửa code sáng tạo của AI. Dùng `new Function` để kiểm cú pháp (0 phụ thuộc — Mod Card không có acorn).
- +4 test cho `scriptSafety` (tổng **53 test** xanh). tsc Dịch Card + Mod Card sạch.

## v1.47.2 — Nội bộ: nốt test JSON Patch + gitignore fixtures
- Thêm **6 test** cho `extractJsonPatches` / `hasJsonPatchOps` (trích JSON Patch khoan dung từ entry `[mvu_update]`) — hoàn tất phần "test lõi" còn thiếu (nay **49 test**).
- Gitignore các file thẻ-test/fixture trong `dev_data/` (card lỗi dùng cho test surgical chạy local, không commit vào repo; file đã tracked trước đó vẫn giữ).

## v1.47.1 — Đợt 6/6 (nội bộ): Dọn cấu hình chết + chốt kế hoạch
> Đợt cuối, không đổi hành vi app.
- **Dọn 2 field cấu hình thừa** khỏi `type`/`store`/`i18n`: *"Số batch gửi song song"* (`concurrentBatches`) và *"Số mục mỗi đợt — lorebook"* (`lorebookBatchSize`). Chúng đã bị bỏ khỏi UI + engine từ trước (đa luồng theo RPM tự quyết số luồng), chỉ còn sót trong kiểu dữ liệu + localStorage → nay xoá cho gọn. `tsc` xác nhận không còn nơi nào dùng.
- **Hoãn** việc tách nhỏ các file lõi quá lớn (`apiClient.ts`/`useTranslation.ts` ~4k dòng): đây là refactor rủi ro cao, nên làm trong một phiên riêng có kiểm thử đầy đủ (giờ đã có bộ test lõi từ Đợt 1 làm lưới an toàn) thay vì gộp vội vào cuối.
- **Chốt kế hoạch 6 đợt rà soát & nâng cấp**: test lõi → nút Dừng cắt in-flight → sức khoẻ thẻ + báo cáo → kiểm nhất quán thuật ngữ → bộ nhớ dịch dedupe → dọn dẹp.

## v1.47.0 — Đợt 5/6: Bộ nhớ dịch trong-thẻ (dedupe → nhanh hơn)
> NHANH HƠN cho thẻ có nhiều đoạn lặp: bỏ hẳn lượt gọi AI thừa cho các trường trùng nội dung.
- **Tái dùng bản dịch cho trường trùng.** Khi một trường chuẩn bị dịch mà **đã có trường khác giống hệt** (cùng nội dung gốc + cùng nhóm + cùng loại) dịch xong → copy thẳng bản dịch, **không gọi AI** (log `♻️ Tái dùng bản dịch…`). Với thẻ nhiều key/câu mẫu lặp, tiết kiệm kha khá lượt gọi + thời gian.
- **An toàn tuyệt đối:** chỉ copy giữa 2 trường **giống hệt nhau về nội dung & kiểu**, nên bản dịch luôn đúng ngữ cảnh — không thể sinh bản dịch sai.
- Khác với **"Bộ nhớ dịch xuyên thẻ" (IndexedDB) đã có sẵn**: cái cũ là *gợi ý mềm* (tương đồng) cho trường DÀI giữa các thẻ và không bỏ lượt gọi; cái mới bỏ hẳn lượt gọi cho trường **trùng khít trong CÙNG thẻ** (kể cả trường ngắn mà bộ nhớ cũ bỏ qua). Hai cơ chế bổ trợ nhau, không trùng.
- Tôn trọng tuỳ chọn *"Bỏ qua trường đã dịch"* (tắt = dịch mới toàn bộ). Kỹ thuật: util thuần `translationReuse.ts` + **5 test** (tổng 43 xanh). tsc sạch.

## v1.46.0 — Đợt 4/6: Kiểm độ nhất quán thuật ngữ (dựa trên Từ điển sẵn có)
> Rà soát cho thấy Dịch Card **đã có sẵn**: nút 🤖 tự trích Từ điển thuật ngữ từ thẻ, và cơ chế bơm Từ điển ("MANDATORY TERMINOLOGY") vào MỌI lần dịch. Vì vậy đợt này **không dựng lại** phần đó (tránh trùng) mà tận dụng để soi chất lượng.
- **"🩺 Sức khoẻ thẻ" kiểm thêm độ nhất quán thuật ngữ.** Nếu một trường đã dịch xong nhưng **vẫn còn nguyên tên gốc** mà Từ điển yêu cầu đổi (vd còn `李明` thay vì `Lý Minh`) → cảnh báo *"trường lệch thuật ngữ"* kèm danh sách cặp `gốc→dịch` chưa áp, và chỉ rõ ở trường nào. Đây là mức cảnh báo (không chặn xuất) vì đôi khi giữ tên gốc là cố ý.
- **Báo cáo dịch (.md)** thêm dòng "Thuật ngữ chưa áp bản dịch: N".
- Vì Từ điển vốn được bơm vào **từng phần** khi cắt entry lớn dịch song song, nên tên/thuật ngữ giữa các phần vốn đã nhất quán — kiểm tra mới này chỉ để bắt trường hợp sót.
- Kỹ thuật: mở rộng `cardHealth.ts` (nhận thêm `glossary`), **+4 test** (tổng 38 test xanh). tsc sạch.

## v1.45.0 — Đợt 3/6: "Sức khoẻ thẻ" + báo cáo dịch (Dịch Card)
> Giúp DỄ THEO DÕI hơn: phát hiện lỗi nội dung *trước khi* nạp thẻ vào SillyTavern, thay vì phát hiện muộn khi nút bấm đã liệt.
- **🩺 Sức khoẻ thẻ (ở khung Xuất).** Khi có bản dịch, tự quét NỘI DUNG (không chỉ trạng thái trường) và báo ngay:
  - **Script vỡ cú pháp**: `<script>` gốc chạy được mà bản dịch parse hỏng (acorn) → cảnh báo đỏ (đây chính là loại lỗi làm "nút bấm liệt").
  - **Chữ Hán còn trong field code** (`json_patch`/`initvar`/`controller`) → lỗi nặng.
  - **Trường lỗi / chưa xong** và **trường còn sót chữ Hán** (mức ghi chú, phòng khi là tên riêng giữ cố ý).
  - Xanh = *an toàn để xuất*; đỏ = *còn N vấn đề nặng nên sửa trước* + nút "Xem chi tiết" liệt kê từng chỗ (tên trường + mô tả + đường dẫn).
- **📄 Xuất báo cáo dịch (.md).** Một nút tải file Markdown tổng hợp: số trường đã dịch/lỗi/bỏ qua + toàn bộ danh sách vấn đề — tiện lưu lại hoặc gửi cho người khác.
- Kỹ thuật: thêm util thuần `cardHealth.ts` (tái dùng acorn + `checkCodeFieldForCjk`), **8 test** khoá lại logic quét. Log hiện đã có bộ lọc theo loại (✓/✗/!/↻…) nên **chưa** gom thêm theo giai đoạn để tránh trùng.

## v1.44.0 — Đợt 2/6: Nút Dừng cắt luôn call AI đang chạy (Mod Card + Tạo Card)
> Đợt này rà soát khả năng "dừng" trên cả 5 app và vá các chỗ nút Dừng chưa thật sự cắt được call AI đang chạy (giống bug đã sửa cho Dịch Card trước đây).
- **Mod Card — thêm nút ⏹ Dừng.** Trước: bấm "Chạy Mod" là chạy hết mọi bước (phân tích → mod từng section → đồng bộ → kiểm định), **không có cách nào dừng**. Nay: khi đang chạy, nút chuyển thành **⏹ Dừng** — bấm là hủy call đang chạy ngay lập tức và cắt vòng lặp; các bước đã xong vẫn giữ nguyên, báo "Đã dừng theo yêu cầu" (không phải lỗi). (Kỹ thuật: luồng `AbortController` → `signal` xuyên `fetchLLM`/orchestrator.)
- **Tạo Card (sinh Lorebook hàng loạt) — nút Dừng nay hủy tức thì.** Trước: Dừng chỉ có tác dụng **giữa các đợt** (call đang chạy vẫn phải chờ xong, tối đa tới 30 phút/timeout). Nay: bấm Dừng **abort luôn call đang chạy**, không tốn thêm token chờ.
- **Kết quả rà soát (không sửa thừa):** Dịch Card (streaming + `readChunkOrAbort`) và Trích Card vốn đã cắt in-flight đúng → giữ nguyên. Tạo Preset là trợ lý chat 1-lượt (non-stream, có timeout) → không cần nút dừng riêng. **Không** nhân bản "lưới vá cú pháp acorn" của Dịch Card sang Mod/Tạo Card vì các app đó **không có bước ghép-lại-token** dễ gây vỡ JS như Dịch Card — thêm vào sẽ là logic trùng/thừa.

## v1.43.1 — Nội bộ (Đợt 1/6): Bộ test tự động cho phần lõi Dịch Card
> Đây là đợt đầu trong kế hoạch rà soát & nâng cấp 6 đợt. Đợt này **không đổi hành vi app** — chỉ thêm lưới an toàn để những bug đã sửa gần đây (treo trang, nút Dừng, vỡ code JS regex) không tái phát khi chỉnh sửa sau này.
- **Thêm `vitest`** vào app gốc (config + script `npm test` / `npm run test:run`); build production (`tsc`) đã loại trừ file test nên không ảnh hưởng.
- **26 test** phủ các hàm lõi thuần (không gọi API):
  - `chunkText` — bất biến cốt lõi **không mất/thêm ký tự** khi cắt entry lớn để dịch song song (join các phần == văn bản gốc), tôn trọng HARD_CAP 15k.
  - `computePoolConcurrency` — công thức số luồng = Σ (RPM chính + phụ) × số key, khử trùng key, trần cứng 512 (khoá lại logic task #35).
  - `surgical` (lưới vá cú pháp v1.43.0) — **regression trên đúng card lỗi thật** của client (`dev_data/`): xác nhận vá được ≥1 chỗ và **mọi `<script>` parse sạch bằng acorn**; thêm test detector không bọc `['…']` cho văn xuôi trong chuỗi.
  - `mvuValidator` — phát hiện chữ Hán còn sót trong field code + dựng từ điển tên entry (gốc→Việt) — nền cho "bảng sức khoẻ thẻ" ở đợt sau.
- **Đã tự kiểm test có tác dụng**: tắt thử 1 dòng guard của v1.43.0 → đúng 1 test chuyển đỏ; bật lại → xanh trở lại.

## v1.43.0 — Dịch Card: FIX TRIỆT ĐỂ dịch regex/HTML làm vỡ code JS
Client báo: dịch regex chứa HTML hay bị hỏng — bản dịch bị "chèn ký tự `['  ']`", `SyntaxError: Unexpected identifier`, **cả file JS sập, nút bấm liệt hoàn toàn**.
- **Điều tra trên đúng card lỗi** (diff bản gốc vs bản dịch): thủ phạm KHÔNG phải AI mà là bộ ghép của "dịch phẫu thuật" (surgical) **nhận nhầm ngữ cảnh**:
  1. Văn xuôi đánh số trong chuỗi (`sysPrompt+='1. 回答…'`) → tưởng `1.` là **đường dẫn biến** → bọc `['bản dịch']` → dấu `'` chèn vào giữa chuỗi đang mở → vỡ. (Tìm thấy 17+ chỗ.)
  2. Chữ trong chuỗi (`'人，统领:'`) → tưởng là **key object** → bọc thêm cặp nháy `'thống lĩnh'` trong chuỗi → vỡ.
- **Sửa tầng 1 — CHẶN GỐC** (không sinh lỗi nữa): bộ nhận diện nay loại trừ (a) chữ số đứng trước dấu chấm ("1./2./3." là danh sách, JS không viết `1.prop`), (b) có khoảng trắng sau dấu chấm (`obj.prop` luôn viết liền), (c) **đang ở trong chuỗi string** (đếm nháy chưa đóng) — trong chuỗi thì mọi kiểu bọc đều sai, chỉ thay chữ thuần tuý. Code thật (`wd.时势?.标题`, `${obj.中文}`) vẫn được bọc bracket đúng như cũ.
- **Sửa tầng 2 — LƯỚI AN TOÀN + TỰ VÁ** (bắt mọi mẫu lọt): sau khi ghép xong, **parse cú pháp từng `<script>`** bằng acorn (chỉ parse, không chạy code). Nếu script gốc lành mà bản dịch vỡ → lấy **vị trí lỗi chính xác** → tự revert đúng mẫu hỏng gần đó (bracket-bọc-câu-văn / cặp-nháy-thừa) → parse lại, lặp tới khi sạch. Chỉ giữ bản vá khi cú pháp lành 100%; không đụng vào bracket-wrap MVU hợp lệ.
- **Đã test trên đúng card lỗi của client**: tự vá **19 chỗ**, script compile lành trở lại (nút bấm sống lại) — không cần gọi thêm API nào.
- Nút "Quét & Sửa Regex (AI)" nhờ đó cũng đỡ việc: lỗi cú pháp kiểu này giờ được chặn/vá tự động ngay trong lúc dịch, không cần chạy quét lại.

## v1.42.3 — Toàn bộ: tăng cỡ chữ nền (khỏi phải zoom 125%)
- Base `html { font-size }` của **cả 5 app** (Dịch/Tạo Card/Tạo Preset/Mod Card/Trích Card) tăng **14px → 16px**. Vì UI dùng `rem` nên mọi chữ to lên đồng đều ~14% → dễ đọc mà không cần zoom Chrome 125%.
- Không dùng `zoom` (tránh double-scale iframe/vỡ layout); chỉ nâng base font-size nên layout co giãn tự nhiên.
- Có thể chỉnh thêm 17–18px nếu muốn to hơn nữa.

## v1.42.2 — Hub: ghi công tác giả dưới tiêu đề
- Thêm dòng nhỏ dưới "Silly Tavern Multitools": **"✦ Kết hợp của Guillichan × Sky"** — tên hai tác giả phối màu gradient (tím→teal) khớp phong cách tiêu đề, chữ nhỏ gọn không chiếm chỗ.

## v1.42.1 — Dịch Card: sửa nút Dừng/Hủy không dừng call đang treo
- **Triệu chứng**: bấm **Tạm dừng** hoặc **Hủy** nhưng các call AI đang chạy **không dừng** (monitor thấy call treo cả trăm giây), rõ nhất ở giai đoạn **Chiến lược B/C** (dựng từ điển MVU/EJS).
- **Nguyên nhân**: khi proxy **treo** (nhận request nhưng không gửi dữ liệu về), vòng đọc stream `reader.read()` **block vô hạn** chờ dữ liệu. Lệnh abort native của fetch **không cắt được** một `read()` đang kẹt như vậy → call không kết thúc, `finally` không chạy nên vẫn hiện "đang chạy", Dừng/Hủy vô hiệu.
- **Sửa**: thêm `readChunkOrAbort()` — mỗi lần đọc stream được **RACE với tín hiệu Dừng/timeout**; ngay khi bấm Dừng/Hủy (hoặc quá giờ), read đang kẹt bị **reject tức thì** → thoát vòng, kết thúc call, giải phóng. Áp cho **cả 3** loại API (OpenAI-compat, Gemini, Anthropic). Các nút vốn đã gọi đúng `pauseTranslation`/`cancelTranslation` (abort `AbortController`); vấn đề chỉ ở chỗ read stream không phản hồi abort — nay đã xử lý.
- Giai đoạn Chiến lược B/C vốn đã bắt `AbortError` êm (chuyển "tạm dừng"/"đã hủy") nên sau fix, bấm Dừng/Hủy lúc đang dựng từ điển cũng dừng sạch.

## v1.42.0 — Tạo Card: sinh Lorebook BÁM SCHEMA biến (võ lực/trí lực…)
Client báo: sinh batch Lorebook **không dựa theo schema** — vd NPC có chỉ số võ lực/trí lực trong schema nhưng entry tạo ra chẳng liên quan.
- **Nguyên nhân**: code ĐÃ hỗ trợ inject schema (`config.schemaContext`), nhưng (1) tuỳ chọn "bám schema" trong bảng tạo tay **mặc định TẮT**, và (2) luồng **Tạo tự động** (autoCreatorPipeline) **không truyền schema** vào.
- **Sửa**:
  - Bảng tạo tay (`BatchGeneratorPanel`): tuỳ chọn bám schema **mặc định BẬT** (thẻ có schema thì tự dùng; không có thì tự bỏ qua).
  - Luồng Tạo tự động: **build + truyền `schemaContext`** từ `card.data.extensions.mvuzod.schema`.
  - Prompt mạnh hơn (`schemaContextBuilder` + `schemaAddon`): entry mô tả **NHÂN VẬT/NPC BẮT BUỘC gán giá trị cụ thể** cho các chỉ số CÓ TRONG schema (vd "Võ lực: 85, Trí lực: 60"), **dùng đúng tên biến**, không bịa biến ngoài schema, không viết code EJS.
  - Refiner đã bám schema sẵn; luồng "fill entry thiếu" (verifier) kế thừa qua `...config` nên cũng bám schema.

## v1.41.1 — Dịch Card: dịch "phẫu thuật" (surgical) chạy tối đa RPM
Surgical = cơ chế dịch cho field **regex/code**: rút riêng các đoạn chữ Trung ra dịch rồi ghép lại **theo id**, giữ nguyên 100% cấu trúc code (khác với chia chunk cho entry).
- Trước đây surgical **kẹt cứng 4 batch song song** (`PARALLEL_CONCUR = 4`) + giãn khởi động **2000ms** — dù RPM/key nhiều tới đâu cũng chỉ 4 luồng.
- Nay: `PARALLEL_CONCUR = max(4, computePoolConcurrency(config))` → **số batch song song = tổng RPM mọi key × provider** (tối thiểu 4, giữ hành vi cũ cho cấu hình nhỏ); giãn khởi động **2000ms → 150ms** (pickLane đã pace theo RPM nên không cần giãn tay 2s).
- **An toàn không đổi**: mỗi batch đi qua `callProvider → pickLane` nên vẫn **gate RPM** (không 429); các batch **độc lập**, ghép **theo id** nên kết quả không phụ thuộc thứ tự hoàn thành → chất lượng giữ nguyên; nút Dừng vẫn hủy sạch (qua `signal` sẵn có).
- Kết quả: card **nhiều regex/code** dịch **nhanh hơn nhiều** (không còn nút thắt 4 luồng), đồng bộ với cơ chế đa luồng RPM của entry.

## v1.41.0 — Dịch Card: mục/entry LỚN → cắt phần & dịch SONG SONG
Vấn đề: có card entry rất lớn, 1 call Gemini Pro **rất lâu và kém chính xác**.
- **Cắt phần cho entry lớn**: mục >**15.000 ký tự** được cắt thành nhiều phần ~15k tại **ranh giới an toàn** (không cắt giữa code/tag), rồi **dịch SONG SONG** qua pool đa-luồng và **ghép lại** (có `verifySeams` kiểm mối nối). Ví dụ entry 90k → ~6 phần chạy cùng lúc. Mục ≤15k vẫn dịch 1 lần như cũ. (Theo feedback user: 12–15k/lần call cho kết quả tốt nhất.)
- **Kết hợp đa luồng RPM**: các phần của 1 entry chia sẻ **chung ngân sách RPM** với các entry khác (qua `pickLane`/rate-limiter) → không vượt 429; tự cân giữa "nhiều entry song song" và "nhiều phần song song trong 1 entry".
- **Giao diện hiện tiến trình chia phần**: log `🔗 Mục lớn "…" (90.000 ký tự) → chia ~6 phần, dịch SONG SONG`; và ở dòng field: `🔗 Mục lớn — chia 6 phần, đang dịch SONG SONG (đã xong 3/6 phần)`. Trước đây FE chỉ hiện chi tiết chunk khi >100k nên entry 90k không thấy gì — nay bám theo số phần thật engine báo.
- **An toàn**: bấm Dừng vẫn hủy sạch mọi phần; nếu lỗi giữa chừng, các phần đã xong được lưu để **chạy tiếp** (resume) thay vì dịch lại từ đầu. Chunk size code-heavy vẫn giữ 12k cho an toàn.
- *Đánh đổi*: các phần dịch song song không thấy bản dịch của phần trước (chỉ thấy ranh giới gốc) nên thuật ngữ có thể lệch nhẹ giữa các phần — được bù bằng `verifySeams` + từ điển MVU + glossary. Đổi lại tốc độ nhanh hơn nhiều cho entry lớn.

## v1.40.2 — Dịch Card: log dễ đọc, tường minh (#8b + dò log)
- **#8b — log bộ "AI tự sửa lỗi"**: khi một bản-sửa của AI bị loại, log cũ ghi `❌ Rejected … Fix worsened severity score: 3 → 522` rất khó hiểu (dễ tưởng tool làm hỏng). Nay ghi rõ tiếng Việt, đúng bản chất **an toàn**: `🛡️ Giữ bản gốc cho "…": bản AI sửa lại còn NHIỀU LỖI HƠN bản gốc (điểm lỗi 3 → 522). KHÔNG áp dụng để không làm hỏng thẻ.` Toàn bộ lý do loại bản sửa (ngắn/dài bất thường, mất macro, lệch ngoặc, hỏng regex…) đều Việt hoá + nói rõ "giữ bản gốc". Dòng tổng kết: "đã áp dụng N bản sửa tốt · giữ nguyên M mục".
- **Dò log Dịch Card**: Việt hoá + làm rõ ~50 dòng log hay gặp — *Đang dịch / Xong lô / Đã dừng dịch / Tiếp tục / Kiểm tra lô / mục bị trống → thử lại / dịch RIÊNG từng mục*, các *Chiến lược B (đồng bộ biến MVU)* & *C (đồng bộ EJS)*, đối chiếu chéo lô, và log tổng kết "🎉 Dịch xong: X thành công, Y lỗi". (Log dev trong console giữ nguyên.)

## v1.40.1 — Tạo Card: nút Dừng cho "Tạo thẻ từ truyện" (#9.4)
- **#9.4 — Dừng hẳn**: thêm `AbortController` + nút **"■ Dừng"** (hiện khi đang quét/tạo). Truyền `signal` xuống `scanCharacters` / `generateCardFromStory` / `generateCardsForMany` → `callAI` huỷ fetch ngay, loop kết thúc, không chạy nền. Trước đây truyền `undefined` nên không dừng được.
- **#9.3 — giữ input khi đổi tab**: kiểm tra thấy trang này **đã** dùng `usePersistedState` cho toàn bộ truyện/tuỳ chọn/roster/thẻ (localStorage) — đổi tab/F5 không mất. Giữ nguyên.
- *(Còn #9.1 web-search rộng hơn + #9.2 bỏ ép JSON: cần bạn chỉ rõ thao tác/feature cụ thể để sửa đúng, tránh phá parser JSON của các phần MVU/Zod/EJS đang cần JSON — xem ghi chú khi bạn về.)*

## v1.40.0 — Tạo Card: ép tiếng Việt (#8a) + đa luồng tối đa RPM (#11)
- **#8a — Tạo thẻ từ truyện ra tiếng Việt**: truyện gốc thường tiếng Trung → model hay chép nguyên văn. Thêm `LANGUAGE_RULE` bắt buộc: TOÀN BỘ thành phẩm phải là **tiếng Việt tự nhiên**, dịch tên riêng (Hán→Hán Việt, Nhật→Romaji, Hàn→Romanization), rà soát xoá mọi chữ Hán/Kanji/Hangul sót; chỉ giữ macro `{{user}}`/`{{char}}`.
- **#11 — Đa luồng chạy tối đa RPM (Tạo Card)**: thêm `computePoolConcurrency(profile)` (= Σ pool: RPM chính+phụ × số key). Thay các trần cứng cũ (`Math.min(8/4/24/10)`) ở: tạo thẻ nhiều nhân vật, quét nhân vật, sinh Lorebook hàng loạt, refiner Lorebook, wiki scraper. `RPMLimiter` (chốt-giờ-bắt-đầu) sẵn có ở client.ts giữ không vượt 429.
- **Rà soát #11 các app khác**: Trích Card đã có (v1.36.2); Tạo Preset là chat tuần tự nên chỉ round-robin key (không có gì để song song); Mod Card là thao tác mod đơn/tuần tự theo thiết kế.

## v1.39.1 — Dịch Card: gọn giao diện API cấu hình chính (như provider)
Vì cấu hình chính nay hành xử y như 1 provider (đa key + RPM riêng), gom UI cho gọn:
- **Gộp "API Key" + "API Key Rotation" → MỘT ô** đa key: mỗi dòng hoặc dấu phẩy 1 key. Key đầu = key chính, còn lại xoay vòng; engine nhân RPM theo tổng số key (như provider). Bỏ khối "API Key Rotation" xổ ra riêng.
- **Gom phần RPM**: RPM model chính 1 hàng (kèm chú "× số key = số luồng"); khi bật Model phụ thì Model phụ / RPM phụ / Ngưỡng ký tự nằm gọn trên **1 hàng grid** (như ProviderCard).
- Không đổi logic/dữ liệu (vẫn `apiKey` + `apiKeys[]`), chỉ gọn giao diện.

## v1.39.0 — Dịch Card: Lorebook dịch từng-mục-song-song + Dừng hẳn (#2,#6,#7,#10)
- **#6/#7 — hết trộn/đè bản dịch**: chế độ Lorebook "Hàng loạt" trước đây gộp nhiều mục vào **1 call AI** rồi gán kết quả **theo chỉ số** — nếu AI trả sai thứ tự/số lượng thì mục này nhận nhầm bản dịch của mục kia ("dịch đè"), và khi 1 mục lỗi thì **retry cả nhóm** (dịch lại mục đã xong). Nay **mỗi mục là 1 request riêng**, đi qua `translateSingleField` (có khoá `inFlightPaths` chống 2 luồng ghi cùng field, chunk + resume, retry riêng từng mục). Không còn prompt gộp → không thể trộn/đè.
- **Tốc độ** vẫn cao nhờ **đa luồng RPM (#1)** dispatch nhiều mục song song (số luồng = tổng RPM mọi key × provider).
- **#10** — bỏ ô **"Số mục mỗi đợt"** (và "Số batch gửi song song" ở 1.37.0); số luồng tự tính theo RPM.
- **#2 — Dừng/Hủy dừng HẲN**: (a) đầu `translateSingleField` chặn set trạng thái "đang dịch" nếu đã bấm Dừng (tránh task nền set lại sau khi đã reset); (b) thêm bộ **quét dọn nhiều lần** trong ~2.6s sau khi Dừng/Hủy để đưa mọi mục "đang dịch" còn sót về "chờ". Đã test: sau khi Hủy, log ngừng hẳn (không dịch nền), không mục nào kẹt "đang dịch".
- Đã test live với API thật (gemini-3-flash): xác nhận per-entry (không còn "Batch translating N entries"), Hủy dừng sạch.

## v1.38.0 — Trích Card: đổi vai nhanh + cờ đệ quy mặc định + xuất LB nhân vật
- **#3 Đổi vai Chính/Phụ**: ở mục 3, **bấm vào badge vai** (★Chính / Phụ / vai?) của nhân vật để đổi qua lại — đang Chính → Phụ, còn lại → Chính. Cập nhật ngay, giữ khi sắp xếp.
- **#4 Mặc định chống đệ quy**: mọi entry Lorebook xuất ra (LB chuẩn + character_book nhúng) nay mặc định **`excludeRecursion:true`** (Non-recursable) **+ `preventRecursion:true`** (Ngăn đệ quy tiếp theo).
- **#5 Xuất Lorebook nhân vật**: thêm nút **"Tải Lorebook nhân vật .json"** ở mục 7 — xuất riêng một Lorebook chỉ gồm các nhân vật đã tạo ở mục 4 (mỗi người 1 entry, kích hoạt theo tên + tên gốc + biệt danh), **không cần** làm bước Lorebook bối cảnh/vật phẩm.

## v1.37.0 — Dịch Card: đa luồng chạy tối đa RPM (mọi key × provider)
- **Số luồng song song** nay tự tính = **tổng ngân sách RPM toàn pool**: mỗi provider (config chính + provider phụ), **mỗi API key** đóng góp `(RPM model chính + RPM model phụ)`. Ví dụ: config chính 4 key + provider phụ 2 key, mỗi key 5+20 rpm → **(5+20)×4 + (5+20)×2 = 150 luồng**.
- **Sửa**: trước đây thêm key vào *cấu hình chính* không tăng tốc vì số luồng lấy từ ô "Số batch gửi song song" (mặc định 6). Nay engine (`computePoolConcurrency`) cộng thẳng theo key×RPM → thêm key = chạy hết công suất.
- Bỏ ô nhập **"Số batch gửi song song"** (tự tính, không cần chỉnh tay). Provider = phân biệt nguồn AI (Google/Amazon…); mỗi key = nhân công suất.
- An toàn 429: `pickLane` vẫn **chờ đúng nhịp RPM** theo từng (provider, model) nên luồng cao cỡ nào cũng không vượt RPM user nhập. Trần cứng 512 chỉ để chặn gõ nhầm.
- (Áp cho cả luồng dịch Lorebook hàng loạt lẫn EJS; các mục #6/#7/#10 còn lại của batch sẽ xử lý tiếp.)

## v1.36.5 — Dịch Card: tải thẻ qua link Discord (tự sửa link webp)
- **Vấn đề**: dán link ảnh thẻ dạng `media.discordapp.net/...&format=webp&width=&height=` thì tải về là **WEBP đã resize** → Discord đã **re-encode ảnh, xoá mất chunk `tEXt` (chara/ccv3)** chứa dữ liệu thẻ trong PNG. Kể cả tải được cũng chỉ ra ảnh rỗng, không có thẻ. (Không phải lỗi app — do link proxy của Discord.)
- **Sửa**: khi phát hiện link Discord, tự **chuẩn hoá** trước khi tải: đổi host `media.discordapp.net → cdn.discordapp.com` (file gốc), **bỏ** `format/width/height/quality`, chỉ giữ chữ ký `ex/is/hm`. `cdn` trả **PNG gốc còn nguyên thẻ** và có CORS (`Access-Control-Allow-Origin: *`) nên trình duyệt tải được.
- Link không phải Discord giữ nguyên. Có ghi log khi đã chuẩn hoá.
- Đã test end-to-end: dán đúng link webp của client → nạp đủ thẻ (spec chara_card_v3, 307 mục Lorebook, 939 field dịch).

## v1.36.4 — Trích Card: HOTFIX treo trang khi tải (regression 1.36.2)
- **Triệu chứng**: import truyện xong không hiện nội dung, không đếm ký tự, các nút không phản hồi.
- **Nguyên nhân**: v1.36.2 thêm `const POOL_CONC_CAP` (top-level) đặt SAU đoạn init gọi `applyProfileToFields()→updatePoolStatus()→poolConcurrency()`. Vì `const` không được hoisted (TDZ), lúc init chạy tới đã ném `ReferenceError: Cannot access 'POOL_CONC_CAP' before initialization` → **toàn bộ init dừng** → không gắn được listener (file input, ô đếm ký tự, các nút…).
- **Sửa**: bỏ hằng số top-level, **inline thẳng số 64** trong `poolConcurrency` → hết TDZ.
- Đã test lại: load không còn lỗi console; `poolStatus` render; nhập/import văn bản đếm ký tự đúng; nút Xóa/Làm lại, Quét hoạt động.
- ⚠️ Ai đang chạy **1.36.2 hoặc 1.36.3** cập nhật ngay (2 bản đó dính lỗi này).

## v1.36.3 — Trích Card: nút "Xóa / Làm lại" ở mục 4 & 5
Theo báo cáo client (PhatSiz): bấm tạo lại thì tool chỉ *"Tiếp tục tạo — bỏ qua các mục đã tạo"* nên cứ hiện kết quả cũ, không có cách làm lại từ đầu.
- Thêm nút **"🗑 Xóa / Làm lại"** cạnh nút chính ở **mục 4 (Tạo thẻ)** và **mục 5 (Tạo Lorebook)**.
- Mục 4: reset cache đã tạo (`genDone`/`genSelKey`) + xóa ô kết quả + log → lần bấm tới tạo lại toàn bộ.
- Mục 5: reset trạng thái trích (`wbState`) + kết quả + log → tạo lại từ đoạn đầu.
- Có chặn khi đang chạy tác vụ (bấm sẽ nhắc dừng trước).

## v1.36.2 — Trích Card: mở full luồng theo RPM + chờ nhịp chống 429
- **Bỏ trần 20** → số luồng song song = **đúng tổng RPM của model đang dùng** (trần cứng 64 chỉ để chặn gõ nhầm). Mỗi API key thêm vào là cộng thẳng luồng: flash RPM 17 × 3 key → **51 luồng bắn cùng lúc**.
- Bước **Quét** chỉ tính RPM **model phụ** (flash) cho số luồng (đúng "17+17+17"); model chính vẫn được dùng làm **dự phòng** khi flash cạn quota. Bước **Tạo thẻ** dùng ngân sách chung 2 model.
- **Chờ nhịp RPM (`acquireConn`)**: khi mọi lane đã đầy quota trong 60s, lane **chờ** tới khi có slot thay vì bắn bừa. Nhờ đó luồng có thể rất cao mà **tổng call/phút vẫn không vượt RPM** → hạn chế 429. (RPM=0 = không giới hạn → chạy tự do như cũ.)

## v1.36.1 — Trích Card: số luồng song song bám theo RPM
- **Sửa lỗi kẹt 4 luồng**: `poolConcurrency` trước tính số luồng = (provider × số key × số model), **bỏ qua RPM** — nên đặt RPM 17 cho flash mà vẫn chỉ chạy 4 luồng.
- Nay số luồng = **ngân sách RPM của (các) model dùng cho tác vụ** (sàn = số lane cũ, trần 20). Ví dụ: model phụ flash RPM 17, 1 key → ~17 luồng; 2 key → chạm trần 20.
- Bước **Quét** truyền `tier` model phụ (flash) vào để số luồng phản ánh đúng lane flash; bước **Tạo thẻ** dùng ngân sách chung. RPM=0 (không đặt) → giữ hành vi cũ.

## v1.36.0 — Trích Card: sắp xếp + quét trùng lặp & tự gộp nhân vật
Theo đề xuất client (PhatSiz) cho bước 3 (Chọn nhân vật):
- **Sắp xếp danh sách**: ô chọn *Số lần xuất hiện (mặc định)* · *Tên A→Z* · *Vai (Chính→Phụ→NPC)*. Nhớ lựa chọn.
- **Quét trùng lặp tự động** (nút "🔍 Quét trùng & gợi ý gộp") — làm 2 tầng:
  1. **Deterministic** (không tốn API): gộp các nhân vật CHẮC CHẮN trùng — cùng tên gốc, cùng tên Việt, hoặc đã chung biệt danh.
  2. **AI**: gửi danh sách (tên/tên Việt/vai/mô tả) cho AI nhận diện **cùng một người dù tên khác hẳn** (biệt danh), giữ riêng các giai đoạn "(Thiếu niên)/(Trưởng thành)".
- Kết quả hiện thành **nhóm nghi trùng để bạn DUYỆT** — bấm **"Gộp nhóm"** từng nhóm, **"Gộp tất cả"**, hoặc **"Bỏ qua"**. Không tự gộp bừa.
- Gộp giữ **vai/giới tính cao nhất**, **cộng số lần xuất hiện**, tên phụ thành biệt danh; vẫn có nút **"Tách"** để hoàn tác.

## v1.35.0 — Mod Card: mod riêng Lorebook (không cần cả thẻ)
Theo yêu cầu client (*add cả card vào ST bị lag → muốn mod & xuất riêng Lorebook*):
- **Tải thẳng 1 file Lorebook** (JSON có `entries` — cả format ST `{entries:{...}}` lẫn array). Tool **tự nhận diện** card hay lorebook khi tải.
- Chạy **đầy đủ chức năng mod** trên các mục lorebook (mở rộng/đào sâu, rule, prompt tùy chỉnh, đồng bộ từ khóa).
- **Xuất RIÊNG Lorebook** (nút "⬇️ Tải Lorebook JSON") — **giữ đúng format gốc** (object/array, field `key`/`keys`, `uid` đều bảo toàn; chỉ nội dung/từ khóa được mod thay đổi) → import thẳng vào Worldbook của ST, không phải add cả thẻ.
- Có badge **"📖 Chế độ Mod LOREBOOK"** khi đang ở mode này.
- *Lưu ý:* đổi tên biến MVU-Zod cần schema (nằm trong script của thẻ) nên với lorebook rời không có sẵn — dùng mở rộng/rule/prompt tùy chỉnh (các chức năng chính) vẫn đủ.

## v1.34.0 — Trích Card: model riêng cho Quét vs Tạo thẻ
Theo yêu cầu client (*"scan bằng flash cho nhanh, model scan với tạo khác nhau"*):
- Thêm toggle **"⚡ Quét bằng model phụ (flash — nhanh)"** ở bước 3. Bật → **bước Quét** dùng **model phụ** của mỗi provider (thường là flash, nhanh & rẻ); **bước Tạo thẻ** vẫn dùng **model chính** (pro/chất lượng).
- Tận dụng đúng cặp **model chính/phụ** đã có ở mục **Pool đa-luồng** — không thêm rối. Cách dùng: đặt Model chính = model tốt, Model phụ = flash cho từng provider, bật toggle → xong.
- Vẫn giữ nguyên **đa-luồng + đa-provider + rate-limit** (engine thêm tham số `tier` để ép model phụ khi quét, fallback model chính nếu phụ hết RPM/không có).

## v1.33.1 — Trích Card: gọn lại câu log retry
- Log retry trước đây đọc kỳ (*"gặp lỗi **HTTP** Bị lọc"* — chữ "HTTP" đứng trước "Bị lọc"/"Timeout" nghe sai vì đó không phải mã HTTP). Nay gọn và đúng: **"Đoạn 3: Bị lọc → thử lại sau 4.5s (lần 3)"**. Lỗi HTTP theo mã hiện đầy đủ **"HTTP 503"**.
- Nhắc lại ý nghĩa nhãn: **Bị lọc** = API trả rỗng / bị bộ lọc an toàn chặn (thường do nội dung nhạy cảm) · **Timeout** = quá 180s không phản hồi (proxy chậm/treo) · **Lỗi mạng** = mất kết nối. Đây là log *đang thử lại*, chỉ khi hết lượt mới bỏ đoạn.

## v1.33.0 — Đồng bộ retry chống "API kẹt" cho cả 5 app
Áp cơ chế retry (như đã làm cho Trích Card) sang 4 app còn lại — API kẹt/treo/timeout/5xx thì **cứ thử lại**, lỗi không sửa được thì dừng ngay:
- **Dịch Card:** thêm **TIMEOUT** cho request dịch (OpenAI/Claude/Gemini) — proxy chết/treo sẽ bị **abort → thử lại** thay vì kẹt vĩnh viễn (trước đây fetch không có timeout nên treo là đứng luôn). `maxRetries` mặc định **3→5**. (429/5xx/rỗng vốn đã retry.)
- **Tạo Card:** trước chỉ thử lại khi có **≥2 API key**; nay **retry cả khi 1 key**, và bắt thêm timeout/504/mạng/quá tải, có backoff.
- **Preset:** trước **không có retry** nào; nay thêm hẳn **retry + timeout** (xoay provider mỗi lần thử).
- **Mod Card:** tăng lượt (3→5) + bắt thêm timeout tiếng Việt/rỗng.
- Tất cả: lỗi **không sửa được** (sai API key, HTTP 400/401) **dừng ngay**, không thử lại vô ích.

## v1.32.2 — Trích Card: tăng retry + tối ưu bộ lọc NSFW
Theo log client (đoạn bị **timeout** và đoạn bị **bộ lọc chặn (trả rỗng)** đều **fail luôn không thử lại**):
- **Timeout nay được thử lại:** trước đây thông báo timeout tiếng Việt ("Yêu cầu quá hạn…") **không khớp** điều kiện retry (chỉ khớp "timeout"/tiếng Trung) → bỏ luôn. Nay khớp → **thử lại**.
- **Response RỖNG do bộ lọc an toàn nay được thử lại:** trước đây rỗng = bỏ đoạn ngay. Nay coi là lỗi tạm thời → thử lại; vì chạy qua **pool** nên mỗi lần thử **đổi lane/model khác** → nội dung NSFW thường lọt ở model khác. `chat()` cũng ném lỗi khi content rỗng (không chỉ null) để bắt trọn trường hợp bị lọc.
- **Số lượt retry 3 → 6**, backoff ngắn lại (1.5s→tối đa 10s).
- **Framing chống-từ-chối:** prompt quét nhân vật & trích Lorebook (khi bật NSFW) đổi thành "tác vụ TRÍCH XUẤT SIÊU DỮ LIỆU trung lập, chỉ liệt kê tên/thiết lập, KHÔNG từ chối, KHÔNG chèn cảnh báo" → giảm tỉ lệ model từ chối.
- **Không phí lượt:** lỗi không sửa được (sai API key, HTTP 400/401) vẫn **dừng ngay**, không thử lại vô ích.

## v1.32.1 — Trích Card: quét kèm giới tính + phân loại vai (Chính/Phụ/NPC)
Nâng cấp nút **"Kèm mô tả danh tính khi quét"** (bước 3, theo feedback client): mỗi nhân vật quét ra nay có thêm
- **Giới tính**: badge **♂** (nam) / **♀** (nữ);
- **Vai trò/tầm quan trọng**: **★ Chính** (nhân vật trung tâm / nam–nữ chính) · **Phụ** (nhân vật phụ có vai) · **NPC** (vai mờ / người qua đường).

Hiển thị badge ngay cạnh tên trên thẻ nhân vật → **nhìn phát biết ngay ai chính ai phụ**, khỏi cần đọc truyện, để quyết định tạo thẻ chi tiết hay đơn giản (cho NPC phụ). Nhân vật xuất hiện ở nhiều đoạn thì **lấy vai cao nhất** (Chính > Phụ > NPC). Thông tin được lưu/tải cùng phiên truyện.

## v1.32.0 — Trích Card: fix thay {{user}} + NSFW/Jailbreak cho bước quét
- **Fix bug thay {{user}} không nhất quán** (lúc được lúc không): trước đây chỉ **dặn AI** thay tên nhân vật thành `{{user}}` trong prompt, AI không tuân thủ ổn định → nhiều chỗ (header, tên gốc, trong thân thẻ, thẻ nhân vật khác nhắc tới) vẫn để nguyên tên. Nay **thay DETERMINISTIC** sau khi sinh: mọi lần xuất hiện của tên (kèm biệt danh nếu khớp nhân vật đã quét) → `{{user}}`, ở **cả header + key + toàn thân thẻ + luồng Sửa**, có **biên ký tự** nên không thay lẹm phần chữ dính (vd "Trần Duyệtxyz" giữ nguyên).
- **Bước 3 (Quét nhân vật) nay có NSFW/Jailbreak/Gomorrah**: thêm 3 toggle **đồng bộ 2 chiều** với bước 4 (đổi bên nào cũng cập nhật bên kia + lưu). Prompt quét nay **áp NSFW** khi bật → quét truyện NSFW **không bỏ sót nhân vật** vì nội dung nhạy cảm. (Jailbreak/Gomorrah vốn đã áp cho bước quét qua system prompt chung, nay hiển thị/điều khiển được ngay ở bước 3.)

## v1.31.1 — Trích Card: thiết kế lại UI pool cho dễ dùng
Bỏ cách quản lý pool bằng "gộp nhiều Cấu hình API" (rối). Nay:
- **Nút "➕ Thêm provider"** → mở **popup đầy đủ** (tên, định dạng, Base URL, đa-key, model chính + RPM, model phụ + RPM, ngưỡng ký tự) → **Lưu** hiện thành **1 dòng** "Provider 2/3…" với chấm xanh (đủ) / đỏ (thiếu).
- **Bấm vào dòng** để mở lại popup **sửa**; mỗi dòng có nút **Xóa**.
- **Provider 1** = cấu hình chính phía trên (model phụ/RPM/ngưỡng của P1 chỉnh ngay trong mục Pool).
- Engine đa-luồng (round-robin, rate-limit, model chính/phụ, đa-key) **giữ nguyên** — đã test lại trên trình duyệt: thêm/sửa/xóa provider, round-robin P1→P2, xoay key, trạng thái pool cập nhật đúng.

## v1.31.0 — Trích Card: full pool đa-provider + đa luồng (như Dịch Card)
Trước đây Trích Card chỉ có **đa-key**. Nay có **đầy đủ** như Dịch Card:
- **Đa provider chạy song song:** mỗi **Cấu hình API** (hệ chuyển đổi sẵn có) = 1 provider. Vào mục **"🔀 Pool đa-luồng"**, bật **"Gộp cấu hình NÀY vào POOL"** ở **≥2 cấu hình** → engine rải call **round-robin**, chạy **song song** nhiều provider. Áp cho: **quét nhân vật**, **tạo thẻ hàng loạt**, **trích Lorebook** (3 bước nặng nhất).
- **Model chính/phụ theo NGƯỠNG KÝ TỰ:** mỗi provider đặt được model phụ (rẻ/nhanh) + ngưỡng ký tự — entry ngắn hơn ngưỡng → tự dùng model phụ.
- **RPM riêng mỗi provider** (× số key), rate-limit trượt 60s tách theo (provider, model) → không đụng hạn mức nhau; **đa-key xoay vòng** theo từng provider.
- **Số luồng song song** tự tính theo tổng (provider × key). Chỉ 1 cấu hình → chạy tuần tự có stream như cũ.
- *Kỹ thuật:* toàn bộ call giờ resolve "lane" (provider+model+key) mỗi lần gọi; continuation dùng cờ per-call (an toàn khi song song). Engine đã test round-robin/threshold/rate-limit/runPool trên trình duyệt.

## v1.30.0 — 4 fix theo báo lỗi client (Dịch Card + Tạo Card)
**Dịch Card:**
- **Ngưỡng model phụ đo bằng SỐ KÝ TỰ** (không phải token). Trước đây path đa-provider quy đổi token ≈ ký tự/4, nên đặt ngưỡng 800 thì entry ~2.200 ký tự (~550 token) vẫn lọt → bị dịch bằng model phụ (flash) ngoài ý muốn. Nay so thẳng số ký tự; nhãn đổi thành "Ngưỡng ký tự".
- **Làm rõ 2 nút sửa** trong Kiểm Tra Lỗi Dịch: 🟢 **Sửa nhanh** = hàm của app (tức thì, KHÔNG tốn API); 🟣 **AI Sửa** = gọi AI cho lỗi phức tạp (tốn quota). Thêm dòng chú thích + tooltip cho từng nút.

**Tạo Card (MVUZOD Studio):**
- **Import/Paste nhận cả Zod schema `.js`** (định dạng gốc `import { registerMvuSchema }...; export const Schema = z.object({...})`), không chỉ JSON. Trước đây dán file schema `.js` báo lỗi "Unexpected token 'z'"; file input cũng chỉ hiện `.json`. Nay tự nhận diện Zod-code → parse đúng (đã test 2 file mẫu ra 17 fields), và mở rộng chọn `.js/.ts/.txt`.
- **Entry `[initvar]` nhúng vào card có `disable=true`** (field ST-native). Trước chỉ đặt `enabled=false` mà thiếu `disable`, khiến SillyTavern coi entry là **bật**. *(Cần kiểm tra lại trong ST để xác nhận.)*

## v1.29.1 — Dịch Card: chống giật khi dịch card lớn (giới hạn log)
- Mảng log trong bộ nhớ trước đây **phình vô hạn** (mỗi field/chunk/retry thêm 1 dòng → hàng nghìn dòng với card lớn). Mỗi lần thêm phải copy + lọc cả mảng → **O(n²)**, khiến app **giật dần** về cuối lượt dịch và ăn RAM. Nay **giữ tối đa 800 dòng gần nhất** (panel vốn chỉ hiển thị 300 dòng cuối) → mượt đều, RAM ổn định.

## v1.29.0 — Dịch Card: gọn hiển thị lỗi 5xx + tự retry (không skip)
Sửa 2 vấn đề user báo khi proxy trả lỗi **524 (Cloudflare timeout)**:
- **Hiển thị lỗi bị xổ dài:** trước đây nhồi nguyên trang HTML lỗi của Cloudflare vào dòng lỗi → xổ dài cả màn hình. Nay message lỗi HTTP được **rút gọn ở nguồn** (trang HTML → chỉ lấy tiêu đề, vd `524: A timeout occurred`), cộng **line-clamp 3 dòng** + tooltip đầy đủ khi rê chuột.
- **Gặp 524 là skip luôn, không thử lại:** trước đây chỉ field lớn (chia chunk) mới auto-retry ở cấp field; field nhỏ gặp lỗi tạm thời là bỏ qua ngay. Nay **mọi lỗi tạm thời** (5xx/timeout/mất mạng) đều **tự thử lại** (kể cả field nhỏ), có log rõ + **backoff tăng dần** để proxy/CDN kịp hồi.

## v1.28.0 — Dịch Card: quy tắc phiên âm tên riêng tiếng Hàn (áp cho A/B/C)
Theo yêu cầu client (PhatSiz), bổ sung **quy tắc phiên âm DANH TỪ RIÊNG** đầy đủ 4 nhóm, đặc biệt **tiếng Hàn** (trước đây thiếu):
- **Trung** → âm Hán Việt cho tên riêng (vd 李明 → Lý Minh), không dùng Pinyin.
- **Nhật** → Romaji (vd 田中 → Tanaka), không dùng Hán Việt.
- **Hàn (MỚI)** → Standard Revised Romanization (vd 金泰亨 → Kim Tae-hyung, 濟州島 → Đảo Jeju, 仁川 → Incheon), **không** dùng Hán Việt kể cả khi viết bằng Hanja.
- **Tây/Fantasy** phiên âm sang CJK (vd 维拉→Vera, 亚瑟→Arthur) → khôi phục chữ Latin gốc.

Áp dụng cho **cả 3 chiến lược dịch**: **A** (dịch chính), **B** (Sync MVU — dịch tên biến), **C** (Sync EJS — dịch tên entry/keyword). Gom 4 rule vào 1 hằng số dùng chung (`PROPER_NOUN_RULES`) để về sau sửa 1 nơi là đồng bộ mọi chiến lược.

## v1.27.0 — Audit: củng cố bảo mật + độ bền (không đổi tính năng)
Rà soát toàn bộ Project + 5 app, sửa các điểm rủi ro/nợ kỹ thuật:
- **Bảo mật dev-server (chống CSRF):** các endpoint gây side-effect (`/api/update`, `/api/downgrade`, `/api/dump-config`, `/api/debug-log`, `/api/progress/save|delete`, `/api-proxy/custom`) nay **chỉ chấp nhận request same-origin**. Trước đây một website bất kỳ đang mở trong cùng trình duyệt có thể lén gọi `git reset --hard` (mất việc chưa commit) — nay bị chặn.
- **Chống vỡ khi tràn localStorage:** bọc an toàn mọi `localStorage.setItem` (chat dài / file đính kèm lớn vượt ~5MB trước đây ném lỗi làm **vỡ giao diện**, nay chỉ cảnh báo nhẹ và tiếp tục).
- **Vệ sinh repo:** gỡ thư mục rác `_dev-scratch/` (19 file) khỏi git + thêm vào `.gitignore`.
- **Build:** gỡ 1 cảnh báo `INEFFECTIVE_DYNAMIC_IMPORT` (bỏ dynamic-import thừa của `apiClient` trong `aiVerify`); cảnh báo còn lại ở `surgical` là do circular-dep, giữ nguyên có chủ đích.

## v1.26.0 — Hub tự quét cập nhật 30' + fix export nhiều nhân vật + tooltip nút
- **Hub tự kiểm tra cập nhật mỗi 30 phút**: nếu có commit mới hơn lần bạn đã bỏ qua → tự bật popup báo. Không làm phiền lặp lại cùng một bản; không đè lúc đang cập nhật.
- **[Trích Card] Fix xuất thẻ nhiều nhân vật** (feedback PhatSiz): trước đây tạo 39 nhân vật 1 lượt thì cả 39 bị **nhồi hết vào ô Mô tả** của 1 thẻ. Nay **mỗi nhân vật thành 1 mục Lorebook riêng**, kích hoạt theo **tên + tên gốc + biệt danh**, để test/bật từng nhân vật độc lập. Ô Mô tả dùng bối cảnh chung (nếu có) hoặc ghi chú danh sách. Thẻ 1 nhân vật giữ nguyên như cũ.
- **[Trích Card] Tooltip chú thích 6 nút "Nội dung cần tạo"**: mỗi nút có icon **ⓘ** — rê chuột hoặc bấm để xem giải thích nút đó tạo ra gì (gồm cả "Quần tượng nhân vật phụ").

## v1.25.0 — Đa provider/đa key cho 3 app còn lại (Preset + Mod + Trích Card)
Hoàn tất áp logic **đa provider** (từ Dịch Card) cho **cả 5 app**:
- **Mod Card**: mục **"🔀 Provider bổ sung (chạy song song)"** trong Cài đặt — thêm provider phụ (key/model riêng) → orchestrator **rải call round-robin** nhiều provider cùng lúc cho các bước mod (mod nhiều call/lần → rải tải rõ rệt).
- **Preset**: thêm **provider phụ** trong ⚙ Cài đặt → mỗi lượt chat **xoay vòng** provider (rải rate-limit qua nhiều account). Chat tuần tự nên **tăng sức chứa**, không tăng tốc song song.
- **Trích Card**: ô API key nhận **nhiều key** (mỗi dòng hoặc cách nhau bằng dấu phẩy) → **xoay vòng key** mỗi call (kể cả nút quét model). Chạy tuần tự nên đây là cách rải quota thực tế cho app này.

## v1.24.0 — Đa provider (Tạo Card)
- Tick **"🔀 Gộp vào POOL đa-provider"** ở ≥2 profile (Cài đặt) → engine **rải call round-robin** nhiều provider cùng lúc. Mỗi profile giữ **đa-key + RPM riêng**, rate-limit **tách theo provider**. 1 profile = như cũ.

## v1.23.1 — Thiết kế lại giao diện cấu hình Provider (Dịch Card)
- Bố cục **2 field/hàng** gọn hơn, mỗi provider có nút **"🔄 Load model"** (quét model từ proxy) + gợi ý datalist. Bớt rối, dễ quan sát.

## v1.23.0 — Dịch Card: Regex — gộp Quét+Sửa thành 1 nút
- **1 nút "Quét & Sửa Regex (AI)"** chạy 4 giai đoạn: (1) quét + lập plan có **thinking** (xử lý ca đặc biệt map / tiếng Trung) → (2) chia **chunk** (phủ hết, không sót) + so sánh gốc↔dịch **song song nhiều chunk** → (3) **sửa chỉ phần lỗi** (dấu thừa/format, tự kiểm ngoặc + regex hợp lệ) → (4) **kiểm mốc chunk** chống sót.
- Output đổi sang **XML** → hết lỗi "chunk lỗi định dạng JSON".

## v1.22.1 — Fix Mod Card treo
- Call AI trong Mod Card trước **không có timeout + không retry** → 1 call đứng là treo cả pipeline. Nay: **timeout 180s/call** + **auto-retry 3 lần** (backoff, xoay key) cho lỗi tạm thời.

## v1.22.0 — Mod Card: Mở rộng/đào sâu + output XML
- **Chế độ Mở rộng/đào sâu**: thay vì làm theo nghĩa đen, AI đọc **toàn cảnh lorebook**, **bổ sung 3-4 phần** mở rộng, viết chi tiết & bám lore. Chọn mức **nhẹ / vừa / sâu**.
- **"Đào sâu 1 phần"**: mở rộng đúng **một sub-block** (vd `<Appearance>`) trong 1 section, giữ nguyên phần còn lại; xem trước/sửa rồi áp.
- **Sửa độ bền**: output mod script/entry dài chuyển từ JSON sang **XML** → hết lỗi vỡ với card bự.

## v1.21.0 — Mod Card: Mod biến MVU-Zod
- Chế độ **"Mod biến MVU-Zod"**: gom biến trong schema → AI **đổi tên/nghĩa** theo yêu cầu → duyệt bảng old→new → **áp đồng bộ** khắp schema/getvar/initvar/mvu_update (không đụng văn xuôi & runtime MVU).

## v1.20.0 — Đa provider (Dịch Card)
- **Cấu hình nhiều provider**: mỗi provider có bộ **key riêng** + **model chính/phụ** + **RPM sửa tự do** + **ngưỡng token**.
- Engine **rải call đều, chạy song song** nhiều provider → dịch nhanh hơn nhiều. Mỗi provider có RPM + xoay key **độc lập** (không đụng nhau); hết quota 1 key thì tự nhảy key kế của đúng provider đó.
- **Model phụ theo token**: entry ngắn hơn ngưỡng → dùng model phụ cho nhanh.
- **Chất lượng giữ như 1 provider** (tên riêng/biến vẫn nhất quán toàn card).
- Panel "Luồng đang chạy" hiện **RPM tách theo từng provider**. Cấu hình **tự lưu**.

## v1.19.2 — Chọn trường bỏ dịch trước khi Start (Dịch Card)
- Nút **"Xem/chọn trường (bỏ dịch)"**: liệt kê mọi trường **trước khi dịch** để **bỏ tick** trường muốn **tự dịch tay** (không gọi API) — gõ bản dịch thẳng vào ô.

## v1.19.1 — UI luồng chạy trực quan (Dịch Card)
- Panel "Luồng đang chạy" hiện thêm **% hoàn thành tổng** + **badge provider** (Gemini/OpenAI/Claude) cho mỗi call.

## v1.19.0 — EJS chạy đa luồng (Dịch Card)
- Card EJS bự (nghìn keyword) trước bị **sót, phải chạy 2–3 lần**. Nay **chia lô nhỏ + chạy song song + tự dịch lại phần sót** → xong trong 1 lượt, nhanh hơn.

## v1.18.2 — Sửa nút Cập nhật báo nhầm
- Nút Cập nhật trước báo nhầm **"đã mới nhất"** dù không kiểm tra được. Nay **báo đúng lý do** (chưa cấu hình git / lỗi mạng / tải ZIP) + cách xử lý.

## v1.18.1 — Sửa cột cấu hình bị cắt
- Cột cấu hình (Chiến Lược A/B/C) bị **cắt mất phần đáy** dưới header → đã sửa, thấy đủ.

## v1.18.0 — Không mất việc khi F5/tắt tab
- **Mod Card** và trang **Tạo thẻ từ truyện** nay **tự lưu** — F5 / đóng tab / mở lại không mất việc.

## v1.17.0 — Dễ nhìn hơn (toàn bộ 5 app)
- **Làm sáng chữ mờ** khó đọc; **phóng to** chữ/nút/logo nhỏ (header, thanh công cụ, rail).

## v1.16.0 — Header chung + đồng nhất giao diện
- Thêm **header "Silly Tavern Multitools"** trên cả 5 app.
- **Đồng nhất font (Inter) + cỡ chữ** giữa 5 app.

## v1.15.0 — Thêm app thứ 5 "Trích Card"
- Công cụ **trích xuất thẻ nhân vật** (NovalCard) thêm vào hub.

## v1.14.0 — "Tạo thẻ từ truyện" đầy đủ (Tạo Card)
- Quét truyện dài (chia đoạn), chọn **nhiều nhân vật** tạo hàng loạt, **thay {{user}}** vào 1 nhân vật + thiết lập bổ sung, mẫu thẻ, world entries, lọc bỏ entry vụn vặt.

## v1.13.1 — Nút Cập nhật
- Chuyển nút **Cập nhật** xuống dưới danh sách app + tạo hiệu ứng **neon** nổi bật.
