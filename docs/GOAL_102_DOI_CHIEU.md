# Goal 102 — Đối chiếu yêu cầu gốc (ảnh Excel) ↔ kết quả (v2.13.0)

Nguồn yêu cầu: **ảnh chụp file Excel** user đính kèm trong lệnh `/goal` ngày 25/07/2026
(dòng 108, cột goal **#102**, người giao **guillichan**, ngày giao 24/07/2026). Nguyên văn
nội dung ô goal trong ảnh:

> lập một plan để cải thiện toàn bộ chức năng, cấu trúc của phần lorebook trong app tạo card
> hãy gộp những thứ đúng ra không nên tách riêng ra, cải thiện độ giật lag và thêm các nút các
> tiện lợi để dễ dàng thao tác với các entries hơn, sửa tất cả các lỗi đang có và tiềm năng,
> cải thiện phần tạo ai sinh batch về prompt lẫn chức năng cũng như thêm có thể dùng đa luồng
> (người dùng nhập nhiều key để đẩy nhanh tốc độ tạo entries) nhưng hãy thiết kế để tránh nó
> tạo trùng nhưng entries vô dụng, những thứ máy móc như là một game, làm tương tự với các
> chức năng khác trong lorebook nhưng mỗi cái nó phải phục vụ cho mục đích của chức năng đó,
> cải thiện prompt để tạo entries tốt hơn, cải thiện việc trích xuất tài liệu để hay gì phải
> chọn cái nào để tạo cái gì thì app tự quyết định và làm cho mọi chức năng tạo entries điều
> có thể do ai tự quyết định mọi thông số miễn nó phù hợp và không gây lỗi cũng như nếu có
> schema thì tạo theo schema

Thực hiện theo Phase 102 của plan tổng (`~/.claude/plans/linear-hugging-muffin.md`).
Kết quả: commit `00a790b` (v2.13.0), 25/07/2026.

## Bảng đối chiếu từng ý

| # | Yêu cầu trong ảnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Gộp những thứ không nên tách riêng | LorebookPage 8 tab → 2 tầng: `[Entries]` + `[Tạo tự động (AI)]`; 7 panel cũ vào menu "Nâng cao", không xoá gì | `src/pages/LorebookPage.tsx` |
| 2 | Cải thiện độ giật lag | Search dùng `useDeferredValue` (trước đây mỗi phím quét content mọi entry); danh sách đã virtualize (`@tanstack/react-virtual`) | `LorebookPage.tsx` (EntriesTab) |
| 3 | Thêm nút tiện lợi thao tác entries | Tick chọn nhiều + thanh Bật/Tắt/Xoá hàng loạt + "Chọn tất cả (theo bộ lọc)" — đã bấm thử live | `LorebookPage.tsx` (bulk bar + EntryRow checkbox) |
| 4 | Sửa lỗi đang có & tiềm năng | Lỗi thật khi chạy thật: crash `params.stop` settings đời cũ (fix v2.12.0, cả 3 nhánh provider). Chặn tiềm năng: kẹp biên thông số AI trả (trần 200 entry, token 80–800), chốt hoàn nguyên mọi vòng AI sửa, run state trong store (chuyển tab không mất tiến trình) | `client.ts`, `lorebookAgent.ts` (clamp), `batchRunStore` |
| 5 | Cải thiện AI sinh batch (prompt + chức năng) | Pha KẾ HOẠCH duyệt trước (khung goalAgent); prompt nhận danh sách tiêu đề đánh số + tài liệu nguồn + schema | `lib/ai/lorebookAgent.ts` |
| 6 | Đa luồng nhiều key NHƯNG không trùng/vô dụng/máy móc như game | Gốc rễ: các luồng song song không biết nhau → **kế hoạch tiêu-đề-trước**: AI liệt kê sẵn tiêu đề từng entry, đánh số toàn cục; chỉ thị chia-phần-luồng trong `batchGenerator` modulo lên danh sách này. Chạy thật: 7/7 entry đúng danh sách, **0 entry trùng bị dedup loại** | `buildBucketTopicPrompt` + `batchGenerator.ts` (lane directive) |
| 7 | Các chức năng khác giữ đúng mục đích riêng | 7 panel giữ nguyên vai trò trong "Nâng cao"; Trích tài liệu/Wiki thêm vai trò NGUỒN cho agent | `LorebookPage.tsx` |
| 8 | Cải thiện prompt tạo entries tốt hơn | Bucket list + tài liệu + schema addon + luật user đặt cuối prompt (trọng lượng cao nhất) — cộng dồn lên anti-data-loss/token-budget có sẵn | `lorebookAgent.ts`, `batchGenerator.ts` |
| 9 | Trích tài liệu: app tự quyết chọn gì tạo gì | Ô dán tài liệu ở tầng 1 — AI tự trích thực thể CÓ THẬT trong tài liệu thành danh sách tiêu đề, user chỉ duyệt | `LorebookAgentPanel.tsx` + `buildLorebookPlanMessages` |
| 10 | Mọi thông số do AI tự quyết, miễn phù hợp không gây lỗi | AI tự quyết totalEntries/minEntries/tokensPerEntry/cardType/lô + autoConfig từng entry (constant/selective/position/order); mọi giá trị bị kẹp biên an toàn | `parseLorebookPlan` (clamp) + `autoConfig` |
| 11 | Có schema thì tạo theo schema | Nợ #48 trả xong: schemaContext bơm vào prompt + validator soi đúng entry bucket nhân vật/NPC thiếu chỉ số (`lb-schema-miss`) → AI bổ sung có chốt hội tụ (bản sửa thiếu chỉ số/mất nội dung là bỏ) | `validateLorebookRun` + `fixSchemaMissEntries` + 13 test |

## Kiểm chứng

- `tsc` sạch; **321/321 vitest** (13 test mới cho lorebookAgent); `vite build` OK.
- **Chạy thật bằng API trên Hub (25/07/2026)**: yêu cầu lorebook tu tiên + schema NPC
  (Võ Lực/Trí Lực/Hảo Cảm) → AI lên kế hoạch 7 entry / 3 nhóm tiêu đề cụ thể → duyệt →
  3 batch → 7/7 entry đúng danh sách, 0 trùng; NPC "Trưởng lão Mặc" gán đủ 3 chỉ số;
  autoConfig đúng chuẩn (NPC → selective, order 100); kiểm tự động sạch; console 0 lỗi.
- Nút hàng loạt (chọn 2 entry → Tắt → Bật) test sống OK.
