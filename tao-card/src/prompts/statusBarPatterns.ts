/**
 * src/prompts/statusBarPatterns.ts — (bug 224) BẢNG TRẠNG THÁI CỦA CARD MVUZOD THẬT.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "nghiên cứu thật kỹ việc tạo bảng trạng thái của các card mvuzod của sillytarven".
 *
 * Tài liệu này KHÔNG suy từ tài liệu hướng dẫn — nó rút ra từ 25 thẻ THẬT có bảng trạng thái
 * nằm trong repo (bug/116, bug/135, bug/148, bug/153, bug/118…), bằng cách đọc `regex_scripts`
 * của từng thẻ và đo: mồi bắt cái gì, chuỗi thay thế dài bao nhiêu, dùng cờ gì, đặt ở luồng nào.
 *
 * Năm MẪU đo được, xếp theo mức hay gặp:
 *
 *  A. MỒI NEO TỰ ĐÓNG — `<StatusPlaceHolderImpl/>` → cả trang bảng trạng thái.
 *     Thấy ở bug/135 Card 1 & 2, bug/148 Eldran, bug/116 One Piece. Chuỗi thay thế 18–70 nghìn
 *     ký tự. Đây là mẫu mà chính Auto Creator của tool sinh ra, và là mẫu ĐÁNG TIN NHẤT: mồi
 *     không phụ thuộc AI viết đúng format nội dung, chỉ cần nó nhả đúng MỘT thẻ neo. Bảng đọc
 *     biến bằng JS trong iframe (mvuData/mvuGet) chứ không qua nhóm bắt — KHÔNG phải EJS: EJS
 *     chạy lúc dựng prompt, xong trước khi widget tồn tại.
 *     ⚠️ Bắt buộc: phải có chỗ DẠY AI nhả thẻ neo (world info/prompt), không thì bảng không hiện.
 *
 *  B. THẺ BỌC NỘI DUNG — `/<battle_panel>([\s\S]*?)<\/battle_panel>/gs` → HTML dùng `$1`.
 *     Thấy ở bug/116 (battle_panel, island_info), bug/118 (erii_theater, scene_card, meanwhile).
 *     Chuỗi thay thế 2–36 nghìn. Nội dung do AI viết bên trong thẻ; bảng chỉ làm đẹp.
 *
 *  C. NHIỀU NHÓM BẮT TỪ VĂN BẢN CÓ CẤU TRÚC — `<状态面板>…<诗词意境>([\s\S]*?)</诗词意境>…`
 *     Thấy ở bug/153 (trình phát nhạc, 33–59 nghìn ký tự). Mỗi ô trong bảng là một nhóm bắt.
 *     Mạnh nhưng GIÒN: AI đổi thứ tự dòng là mất khớp — nên chỉ dùng khi format được khoá cứng.
 *
 *  D. THANH LỰA CHỌN — `<options>…>选项一：([^>]+?)…` → dãy nút bấm.
 *     Thấy ở bug/118, bug/153 (story_options, branches). 4–33 nghìn ký tự.
 *
 *  E. LÀM ĐẸP KHỐI TƯ DUY — `/^([\s\S]*?<\/think(?:ing)?>)/i` → `<details>` thu gọn.
 *     Thấy ở bug/116, bug/153. Ăn từ ĐẦU tin nhắn tới thẻ đóng, nên vẫn bắt được khi preset
 *     mồi sẵn thẻ mở (đúng ca bug 212).
 *
 * Ba mẹo cú pháp đo được ở các thẻ tốt nhất:
 *  • `(?!.*<tag>)` — chỉ khớp lần XUẤT HIỆN CUỐI (bug/153 dùng cho trình phát: tin nhắn dài có
 *    nhiều khối, chỉ khối cuối là trạng thái hiện hành);
 *  • luôn `[\s\S]*?` chứ không `.*?` — bảng trạng thái luôn nhiều dòng, `.` không ăn xuống dòng;
 *  • `markdownOnly=true` + `promptOnly=false` + `placement=[2]` — bảng chỉ sống ở lớp HIỂN THỊ,
 *    không bao giờ đi ngược vào prompt (nếu lọt vào prompt thì AI học theo và nhả HTML).
 */

export const STATUS_BAR_PATTERNS = `═══ BẢNG TRẠNG THÁI: NĂM MẪU RÚT TỪ 25 THẺ MVUZOD THẬT ═══
(Đo từ regex_scripts của thẻ thật, không phải suy từ tài liệu.)

A. MỒI NEO TỰ ĐÓNG (đáng tin nhất — dùng mặc định cho bảng trạng thái đầy đủ)
   findRegex : <StatusPlaceHolderImpl/>
   replace   : cả trang bảng (đo thật: 18.000–70.000 ký tự), đọc biến bằng JS trong <script>:
               var d = mvuData(); rồi mvuGet(d,'Nhóm.Biến','—') — KHÔNG dùng {{getvar::}}
               (macro đó đọc kho biến CHAT, không phải stat_data của MVU)
   Vì sao tốt: mồi KHÔNG phụ thuộc AI viết đúng format nội dung — nó chỉ cần nhả một thẻ neo.
   Bắt buộc kèm: một chỗ DẠY AI nhả thẻ neo đó mỗi lượt (world info), không thì bảng không hiện.

B. THẺ BỌC NỘI DUNG (khi nội dung do AI viết, bảng chỉ làm đẹp)
   findRegex : /<battle_panel>([\\s\\S]*?)<\\/battle_panel>/gs
   replace   : HTML dùng $1 làm ruột
   Dùng cho: panel chiến đấu, thẻ bối cảnh, tiểu kịch, ghi chú — nội dung tự do.

C. NHIỀU NHÓM BẮT TỪ FORMAT KHOÁ CỨNG (mạnh nhưng GIÒN)
   findRegex : /<状态面板>[\\s\\S]*?<mục A>\\s*([\\s\\S]*?)\\s*<\\/mục A>[\\s\\S]*?<mục B>\\s*([\\s\\S]*?)/gs
   replace   : mỗi ô bảng là một $n
   Chỉ dùng khi format đã được khoá cứng trong prompt. AI đổi thứ tự dòng là mất khớp.

D. THANH LỰA CHỌN → DÃY NÚT
   findRegex : /<options>[\\s\\S]*?>lựa chọn 1:\\s*([^>]+?)[\\s\\S]*?>lựa chọn 2:\\s*([^>]+?)/gs
   replace   : các <button> gửi lại lựa chọn

E. LÀM ĐẸP KHỐI TƯ DUY
   findRegex : /^([\\s\\S]*?<\\/think(?:ing)?>)/i
   replace   : <details><summary>…</summary>$1</details>
   Neo ^ + ăn tới thẻ ĐÓNG nên vẫn bắt được khi preset mồi sẵn thẻ mở.

BA MẸO CÚ PHÁP (đo ở các thẻ tốt nhất):
1. \`(?!.*<tag>)\` để chỉ khớp lần xuất hiện CUỐI — tin nhắn dài có nhiều khối, chỉ khối cuối
   là trạng thái hiện hành. Vd: /<panel>(?!.*<panel>)([\\s\\S]*?)<\\/panel>/gs
2. LUÔN \`[\\s\\S]*?\` chứ không \`.*?\` — bảng trạng thái luôn nhiều dòng.
3. LUÔN markdownOnly=true, promptOnly=false, placement=[2]. Bảng chỉ sống ở lớp HIỂN THỊ; lọt
   vào prompt là AI học theo rồi tự nhả HTML.

CHỌN MẪU NÀO:
• Bảng trạng thái đầy đủ bám biến MVU  → A (kèm nhắc AI nhả thẻ neo)
• Khối nội dung AI viết, chỉ cần đẹp   → B
• Format đã khoá cứng, cần tách ô      → C
• Menu hành động                        → D
• Thu gọn chuỗi tư duy                  → E`;
