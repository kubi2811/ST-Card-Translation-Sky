# CLAUDE.md — quy trình sửa bug của repo này

## Nguồn bug
- Danh sách bug nằm trong file Excel "Bug List - Multitool SillyTavern" trên OneDrive của chủ repo
  (cột: STT · Link Discord Bug · Ngày báo · Đã fix chưa · Miêu tả + Prompt cho AI · Ai báo).
  Số bug trong commit (`bug 247`) = cột **STT** của file đó.
- Link Discord trong file cần đăng nhập — không mở được; nếu bug chỉ có link mà không có mô tả,
  hỏi chủ repo dán nội dung/ảnh.
- Trước khi sửa: đọc code + `git log --grep` để xem bug đã sửa chưa (sheet hay chậm hơn code).
  Cách sửa user đề xuất không hợp lý thì nói thẳng và đưa cách triệt để hơn.

## Sau MỖI bug sửa xong — bản tin Discord
- Lưu ở `discord-updates/v<APP_VERSION>/bug-<STT>-<tên-người-báo>.md`, **một file = một tin nhắn
  cho một người báo**, dưới 2000 ký tự. Cập nhật bảng trong `README.md` của thư mục đó.
- Định dạng (theo mẫu bản tin v1.99.6 của chủ repo):
  ```
  @<tên người báo>

  # UPDATE v<version> : <TÓM TẮT IN HOA> (NHỚ BẤM UPDATE)

  Có gì mới / đã fix:

  **1) <Tiêu đề phần>:**
  - Trước đây: … (người dùng gặp gì)
  - Bây giờ: … (giải thích dễ hiểu, không thuật ngữ code)
  ```
- Bug chưa đóng hẳn thì ghi rõ cần người báo gửi gì thêm.

## API key để chạy thử
- Key/endpoint test nằm trong `apiKey/` (đã gitignore — **TUYỆT ĐỐI không commit, không chép key
  vào commit/code/bản tin**). Hiện có `apiKey/test-endpoint.env` (TEST_BASE_URL, TEST_API_KEY;
  cổng OpenAI-compatible, `GET /models` để xem model).
- Chạy engine dịch thật bằng vitest trong `_dev-scratch/` (gitignore), ví dụ:
  `NODE_USE_ENV_PROXY=1 LIVE_MODEL=gcli-gemini-3.8-flash LIVE_WHICH=regex6 npx vitest run -c _dev-scratch/vitest.live.config.ts`
  (Node ≥ 22.21 cần `NODE_USE_ENV_PROXY=1` để đi qua proxy của môi trường cloud).

## Code & commit
- Mỗi bug một commit, tiêu đề theo quy ước `fix(<app>): bug <STT> — …` với app là
  `dich-card` / `tao-card` / `dich-script` / `preset-tool` … (test `versionApps` đọc tiêu đề commit).
  Thân commit viết tiếng Việt: user báo gì → gốc rễ → sửa gì → đo/kiểm thế nào.
- Bump `APP_VERSION` trong `src/version.ts` khi phát hành bản sửa.
- Kiểm tra trước khi push: `npx tsc --noEmit -p .` + `npx vitest run` (app chính);
  `cd tao-card && npx tsc -b && npx vitest run` (Tạo Card). Test mới phải đỏ trên code cũ.
- Một số file dùng CRLF (vd `src/utils/aiVerify.ts`) — giữ nguyên kiểu xuống dòng khi sửa.
