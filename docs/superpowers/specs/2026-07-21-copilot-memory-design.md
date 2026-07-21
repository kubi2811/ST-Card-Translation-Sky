# Bộ nhớ cho Copilot (Tạo Card) — Thiết kế

Ngày: 2026-07-21 · Phạm vi: `tao-card` · Trạng thái: chờ duyệt

## 1. Vấn đề

User muốn Copilot bên Tạo Card "có bộ nhớ, tải file, đọc tài liệu, tra cứu giống Trợ Lý AI bên app dịch".

Khảo sát code cho thấy **3/4 năng lực đã có**:

| Năng lực | Trạng thái |
|---|---|
| Tải file | ✅ `ChatAttachment` (CopilotPanel) |
| Đọc tài liệu | ✅ `documentChunker.ts` + `documentChunks` trong `agentLoop` |
| Tra cứu | ✅ `toolsEngine`: `web_search`, `search_lorebook`, `read_lorebook_entry`, `get_recent_messages` |
| **Bộ nhớ** | ❌ `store/memoryStore.ts` **viết xong nhưng KHÔNG file nào import — dead code** |

Vậy đây là việc **nối dây**, không phải xây hạ tầng mới.

`memoryStore` đã có đủ API: `addMemory`, `updateMemory`, `deleteMemory`, `toggleMemory`,
`getVisibleMemories({projectId, sessionId})`, `searchMemory(query, ctx)`, `pruneMemory(days)`,
`setPassword` (mã hoá qua `cryptoUtils`), index MiniSearch, 3 scope `global | project | session`.

## 2. Yêu cầu đã chốt

- Surface: **Copilot drawer** (có mặt mọi trang), KHÔNG phải Game UI Studio.
- Cần cả 3 scope: **project** (về thẻ đang làm), **global** (thói quen của user), **session** (chat dài).
- Cần **panel sửa tay**: thêm/sửa/xoá/tắt-bật từng mục.
- Cơ chế ghi: **AI đề xuất → user duyệt → mới lưu**. AI không bao giờ tự ghi thẳng.

Ngoài phạm vi (tách sau): cải thiện chất lượng sinh code/HTML của Game UI Studio.

## 3. Kiến trúc & luồng dữ liệu

```
User gửi tin
  ↓
① TRUY HỒI  searchMemory(tin, { projectId, sessionId }) → tối đa N mục
  ↓
② CHÈN      buildCopilotSystemPrompt(...) + khối "ĐIỀU ĐÃ BIẾT"
            (3 mục tách bạch: Thói quen / Về thẻ này / Trong phiên này)
  ↓
③ AI trả lời — có thể gọi tool `propose_memory`
  ↓
④ ĐỀ XUẤT   thẻ trong chat: "💡 Ghi nhớ điều này?" + nội dung + scope
            [Đồng ý] → addMemory()   ·   [Bỏ qua] → biến mất, không ghi
```

### Quyết định nền

**QĐ1 — `projectId` = `cardStore.currentProjectId`, KHÔNG dùng tên thẻ.**
Đã xác minh `currentProjectId: string | null` tồn tại và độc lập với tên (có `renameProject(id, name)`
riêng). Dùng tên thì đổi tên thẻ là mất sạch ký ức.
*Ca biên:* `currentProjectId === null` (dự án chưa lưu) → đề xuất scope `project` bị **vô hiệu hoá**
kèm gợi ý "lưu dự án trước"; scope `global`/`session` vẫn dùng bình thường.

**QĐ2 — AI không có đường ghi thẳng.**
Tool đặt tên `propose_memory` (không phải `save_memory`) và chỉ trả về *đề xuất*. Lệnh `addMemory()`
duy nhất được gọi từ handler của nút Đồng ý. Kể cả AI bịa/lỗi cũng không thể nhét vào kho.

**QĐ3 — Ký ức là kênh riêng, không trộn vào lịch sử chat.**
Chèn thành khối tách bạch có nhãn scope trong system prompt, để truy vết được câu trả lời chịu ảnh
hưởng của ký ức nào.

**QĐ4 — Tắt/bật thay vì chỉ xoá.**
Ký ức `global` áp cho MỌI thẻ; một mục sai kiểu "user thích văn phong cổ trang" sẽ âm thầm bẻ mọi thẻ
hiện đại về sau và rất khó truy. `toggleMemory` (có sẵn) cho phép tắt tạm để khoanh vùng thủ phạm
nhanh, không mất dữ liệu.

## 4. Thành phần

| Việc | File | Loại |
|---|---|---|
| Truy hồi + dựng khối "ĐIỀU ĐÃ BIẾT" | `lib/ai/memoryContext.ts` | **mới** |
| Tool `propose_memory` | `lib/toolsEngine.ts` | sửa |
| Chèn khối ký ức vào system prompt | `lib/ai/agentLoop.ts` (~dòng 62) | sửa |
| Thẻ duyệt đề xuất trong chat | `components/copilot/MemoryProposalCard.tsx` | **mới** |
| Render thẻ duyệt + nối `addMemory` | `components/copilot/CopilotPanel.tsx` | sửa |
| Panel quản lý ký ức (CRUD + tắt/bật) | `components/copilot/MemoryPanel.tsx` | **mới** |
| Nén chat dài → ký ức session | `lib/ai/memorySummarizer.ts` | **mới** |

`memoryStore.ts` **không đổi** — API đã đủ.

### Ranh giới

- `memoryContext.ts`: thuần hàm, vào `(query, ctx)` ra `string` khối prompt. Không đụng UI, không gọi AI → test dễ.
- `memorySummarizer.ts`: vào mảng tin nhắn, ra 1 chuỗi tóm lược. Gọi AI nhưng không đụng store.
- Ghi vào store **chỉ ở** handler nút Đồng ý và panel. Một đường ghi duy nhất, dễ soát.

## 5. Nén chat dài (session)

Khi số lượt vượt ngưỡng (đề xuất **20 lượt**), gọi `memorySummarizer` tóm lược các lượt cũ thành 1 mục
scope `session`, rồi lượt sau chỉ gửi tóm lược + N lượt gần nhất.

Đây là ca **duy nhất** AI được ghi mà không hỏi — vì tóm lược session hết chat là bỏ, không lan sang thẻ
khác. (User đã chọn "AI đề xuất – duyệt" cho phần nhớ lâu dài; ràng buộc đó vẫn giữ nguyên cho
`project`/`global`.)

## 6. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| `searchMemory` ném lỗi | Nuốt lỗi, trả khối rỗng — chat vẫn chạy, chỉ mất ký ức lượt đó |
| Kho ký ức rỗng | Không chèn khối "ĐIỀU ĐÃ BIẾT" (không tốn token thừa) |
| `currentProjectId === null` | Vô hiệu hoá đề xuất scope `project`, hiện gợi ý lưu dự án |
| AI gọi `propose_memory` sai định dạng | Bỏ qua đề xuất + báo AI qua `[System Tool Error]` (cơ chế sẵn có) |
| Tóm lược session thất bại | Giữ nguyên lịch sử chat, log cảnh báo, không chặn chat |
| Ký ức quá nhiều | Cắt top-N theo điểm liên quan; `pruneMemory` dọn mục lâu không dùng |

## 7. Kiểm thử

Chạy bằng vitest (đã có sẵn, 69 test đang pass).

**`memoryContext.test.ts`**
- Kho rỗng → trả chuỗi rỗng, không có nhãn thừa
- Ký ức bị `disabled` → KHÔNG xuất hiện trong khối
- Ký ức `project` của thẻ A → không lọt sang thẻ B
- 3 scope hiển thị đúng nhãn, đúng nhóm
- Vượt top-N → cắt đúng số lượng

**`memorySummarizer.test.ts`**
- Dưới ngưỡng → không tóm lược
- Vượt ngưỡng → tóm lược đúng phần cũ, giữ N lượt gần nhất
- AI lỗi → trả null, không ném ra ngoài

**Kiểm tay:** ký ức global sai bẻ thẻ khác → tắt mục đó → hỏi lại thấy hết ảnh hưởng (xác nhận QĐ4 dùng được thật).

## 8. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| MiniSearch tìm theo từ khoá, trượt nghĩa gần ("văn phong" vs "giọng văn") | Chấp nhận ở bản này. Nếu trượt nhiều thì nâng riêng khâu tìm kiếm sau — rẻ hơn ôm cả hệ RAG thứ hai |
| Ký ức global sai lan âm thầm | QĐ4 tắt/bật từng mục + panel liệt kê minh bạch |
| Token phình do chèn ký ức | Top-N + bỏ khối khi rỗng + `pruneMemory` |

### Phát hiện khi triển khai — BẪY `accessedAt` (chưa kích hoạt)

Điều tra trong lúc làm cho thấy: **không có chỗ nào trong `memoryStore` từng ghi `accessedAt`.**
`addMemory` không set, `updateMemory` chỉ set `updatedAt`, `searchMemory`/`getVisibleMemories` là hàm
thuần đọc. Trong khi `pruneMemory` lại dùng `const lastAccess = m.accessedAt || m.updatedAt;`

Hệ quả NẾU có ai đó nối `pruneMemory` vào app: một ký ức được nạp vào prompt mỗi ngày nhưng không sửa
nội dung sẽ bị xoá sau 30 ngày — đúng loại "dọn nhầm thứ đang hữu ích".

**Hiện chưa gây hại** vì `pruneMemory` được định nghĩa nhưng **không nơi nào gọi**. Cố ý không sửa ở
bản này (spec chốt: không đụng `memoryStore.ts`).

Nếu sau này bật `pruneMemory`, PHẢI xử lý trước:
1. Thêm action riêng `touchMemory(id)` — KHÔNG tái dụng `updateMemory` vì nó luôn ghi đè `updatedAt`,
   sẽ làm mờ ranh giới "sửa nội dung" vs "vừa đọc".
2. Gọi `touchMemory` cho các ký ức thực sự được chèn vào prompt (ở `agentLoop`).
3. Lưu ý `searchMemory` trả object dựng từ `storeFields` của MiniSearch, KHÔNG phải object trong
   `state.memories` — phải cập nhật theo `id`, mutate object trả về sẽ chỉ đổi bản copy trong index.

## 9. Không làm (YAGNI)

- Không port `ragEngine`/`memoryStore` từ app dịch sang (sẽ thành 2 hệ chồng nhau, phải migrate).
- Không làm embedding/vector search ở bản này.
- Không đụng Game UI Studio.
- Không sửa `memoryStore.ts`.
