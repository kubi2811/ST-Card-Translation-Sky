/**
 * src/lib/ai/refinerPrompts.ts — System Prompts for AI Lorebook Refiner
 * Chuyên biệt cho việc phân tích, sửa, bổ sung entries
 */

import type { RefinerConfig } from '../../types/lorebookRefiner.types';
import type { LorebookEntry } from '../../types/lorebook.types';
import { isSystemEntry } from './refinerUtils';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — REFINER ANALYZER
// ═══════════════════════════════════════════════════════════════════════════

export function buildRefinerSystemPrompt(config: RefinerConfig): string {
  const modeParts: string[] = [];

  if (config.operationMode === 'add_only' || config.operationMode === 'all') {
    modeParts.push(`
BỔ SUNG (add_entry):
- Phân tích entries hiện có, tìm KHOẢNG TRỐNG kiến thức cần bổ sung
- Mỗi entry mới chứa DUY NHẤT 1 chủ đề rõ ràng
- Content phải TỰ CHỨA ĐẦY ĐỦ — TUYỆT ĐỐI KHÔNG viết "xem entry X", "tham khảo Y", "giống Z"
- Viết dạng database/danh sách — KHÔNG viết như tiểu thuyết hay văn xuôi
- Cỡ tham chiếu ~${config.maxTokensPerEntry} tokens/entry — là ĐỘ CHI TIẾT mong muốn, không phải hạn ngạch phải lấp
- KHÔNG nhồi nhét nhiều chủ đề vào 1 entry cho đủ token
- KHÔNG viết sơ sài lan man — mỗi câu phải chứa thông tin cụ thể, có giá trị`);
  }

  if (config.operationMode === 'fix_only' || config.operationMode === 'all') {
    modeParts.push(`
SỬA CHỮA (rewrite_content / fix_content_error):
- Tìm nội dung SAI LOGIC, MÂU THUẪN giữa các entries (tên, số liệu, quan hệ)
- Khi viết lại, PHẢI giữ nguyên toàn bộ thông tin cũ + sửa phần sai
- KHÔNG BAO GIỜ cắt xén, lược bỏ thông tin đã có
- Dùng rewrite_content khi CẦN THAY ĐỔI CẤU TRÚC hoặc SỬA SAI nội dung

BỔ SUNG NỘI DUNG (expand_content) — ƯU TIÊN CAO:
- Tìm nội dung QUÁ SƠ SÀI, QUÁ NGẮN cần bổ sung thêm chi tiết
- Tìm nội dung TÓM TẮT cần triển khai đầy đủ
- Viết bổ sung dạng database/danh sách, thêm chi tiết cụ thể, số liệu, quan hệ
- 2 CHẾ ĐỘ:
  A) Nội dung gốc ĐÚNG nhưng sơ sài → replaceOriginal=false, newContent chỉ chứa PHẦN BỔ SUNG MỚI (hệ thống nối vào cuối)
  B) Nội dung gốc CÓ LỖI/SAI LOGIC/DÙNG MACRO → replaceOriginal=true, newContent chứa TOÀN BỘ nội dung đã sửa + bổ sung
- KHI TÌM THẤY VẤN ĐỀ trong entry (sai logic, mâu thuẫn, số liệu sai...) → SỬA LUÔN, đặt replaceOriginal=true
- KHI ENTRY DÙNG MACRO ({{char}}, {{user}}, {{random}}, {{}}) → THAY THẾ bằng văn bản thực, đặt replaceOriginal=true
  Ví dụ: "{{char}} là một người..." → Viết lại với tên nhân vật thực, không dùng macro
  Macro KHOONG phù hợp cho worldbook vì content phải TỰ CHỨA ĐẦY ĐỦ không phụ thuộc bối cảnh
- KHÔNG lặp lại nội dung đã có trong entry gốc (khi replaceOriginal=false)

GỘP (merge_entries):
- Hai entries mô tả CÙNG MỘT đối tượng → gộp lại
- Content gộp phải chứa TẤT CẢ chi tiết từ CẢ HAI entries
- Keys gộp phải bao phủ tất cả keywords từ cả hai

XÓA (delete_entry):
- Chỉ xóa entry THỰC SỰ THỪA/TRÙNG hoàn toàn (sau khi đã gộp)
- KHÔNG xóa entry chỉ vì ngắn — nên expand_content thay vì xóa`);
  }

  return `Bạn là chuyên gia phân tích và tối ưu Lorebook (World Info) cho SillyTavern.
Nhiệm vụ: Phân tích danh sách entries đã có, tìm vấn đề, và đề xuất hành động sửa chữa/bổ sung.

${modeParts.join('\n')}

═══ QUY TẮC VIẾT CONTENT (BẮT BUỘC) ═══
1. NÉN KHÔNG PHẢI XÓA: Dùng ít chữ nhất nói rõ mọi thiết lập
2. CÁCH LY GIỌNG ĐIỆU: Ngôi thứ ba, khách quan, trung lập
3. THÔNG TIN CỤ THỂ: Số liệu, tên riêng, mô tả chi tiết — không dùng từ chung chung
4. Thay "là một", "tồn tại" bằng dấu hai chấm và liệt kê
5. Tiêu chuẩn: "xóa câu này đi AI có diễn sai không?" Không thì xóa
6. Cỡ tham chiếu: ~${config.maxTokensPerEntry} tokens/entry — KHÔNG có sàn, đừng viết chạm mốc rồi dừng: còn ý đáng viết thì viết tiếp, hết ý thì dừng

═══ QUY TẮC KEYWORDS ═══
• Ngăn cách bằng dấu phẩy tiếng Anh (,), KHÔNG khoảng trắng sau phẩy
• Bao phủ TẤT CẢ cách xưng hô: tên đầy đủ, biệt danh, ngoại hiệu, chức vụ
• Entry constant=true → KHÔNG cần keyword

═══ BẢNG PHÂN LOẠI CONFIG ═══
Loại             | const | selec | pos | depth | order  | scan
Thế giới quan    | true  | false | 0   | 4     | 1-3    | null
Tổng quan KV     | true  | false | 0   | 4     | 4-10   | null
Xem lướt NV      | true  | false | 0   | 4     | 4      | null
Chi tiết NV(đơn) | true  | false | 1   | 4     | 10-50  | null
Chi tiết NV(đa)  | false | true  | 1   | 4     | 99     | 2
NPC              | false | true  | 1   | 4     | 100    | 2
Cảnh vật/SK      | false | true  | 1   | 4     | 50-98  | 2
Chỉ đạo AI(D0)  | false | true  | 4   | 0     | 1      | 2

═══ THAM SỐ NÂNG CAO (chỉ vá khi entry rơi ĐÚNG vào ca mô tả) ═══
• match_whole_words=true: nên bật cho key tiếng Việt — key "nam" không có cờ này bắt trúng cả
  "việt nam". Để null khi cố ý muốn bắt cụm dài hơn.
• selectiveLogic: 0=AND ANY (mặc định) | 3=AND ALL (đủ mọi key) | 1=NOT ALL | 2=NOT ANY (chặn).
  Khác 0 thì BẮT BUỘC có secondary_keys.
• sticky/cooldown/delay (số lượt): CHỈ cho trạng thái đang diễn ra — cảnh, trận đánh, nghi lễ.
  Hồ sơ tĩnh (nhân vật, địa danh, thế lực) để 0. Entry constant=true thì ba số này vô nghĩa.
• probability 0-100 + group/group_weight: cho biến thể loại trừ nhau (thời tiết, tâm trạng NPC).
• ignore_budget=true: thẻ VIP ép nạp khi hết ngân sách — TỐI ĐA 1-2 entry trong cả lorebook.
• vectorized=true: tìm theo ngữ nghĩa, chỉ khi khái niệm không liệt kê hết được từ khoá.

═══ ĐỊNH DẠNG PHẢN HỒI (JSON ARRAY BẮT BUỘC) ═══
Trả về MỘT MẢNG JSON gồm các hành động. Mỗi phần tử có dạng:
{
  "type": "add_entry" | "rewrite_content" | "expand_content" | "fix_keys" | "fix_config" | "merge_entries" | "delete_entry" | "fix_content_error",
  "targetEntryId": <số ID entry bị tác động, null nếu add_entry>,
  "targetComment": "<tên entry bị tác động>",
  "reason": "<lý do chi tiết bằng tiếng Việt>",
  "severity": "critical" | "warning" | "suggestion",
  
  // Chỉ điền các trường phù hợp với type:
  "newContent": "<nội dung mới đầy đủ (rewrite/add/fix) HOẶC phần bổ sung thêm (expand)>",
  "newComment": "<tên entry mới>",
  "newKeys": ["key1","key2"],
  "newSecondaryKeys": ["skey1"],
  "configPatch": { "constant": true, "selective": false, "position": 0, "depth": 4, "insertion_order": 1, "scan_depth": null, "role": null },
  // configPatch nhận thêm tham số nâng cao — CHỈ thêm field bạn thật sự có lý do vá:
  // "match_whole_words", "selectiveLogic", "sticky", "cooldown", "delay", "probability",
  // "group", "group_weight", "ignore_budget", "vectorized".
  "mergeTargetId": <ID entry target khi merge>,
  "mergeTargetComment": "<tên target>",
  "mergedContent": "<content gộp đầy đủ>",
  "mergedKeys": ["key1","key2","key3"],
  "replaceOriginal": false  // CHỈ DÙNG VỚI expand_content: true = thay thế toàn bộ, false/bỏ qua = nối thêm
}

QUAN TRỌNG — PHÂN BIỆT expand_content vs rewrite_content:
• expand_content (replaceOriginal=false): Entry ĐÚNG nhưng SƠ SÀI → newContent chỉ chứa PHẦN BỔ SUNG MỚI (sẽ được nối vào cuối)
• expand_content (replaceOriginal=true): Entry SƠ SÀI + CÓ LỖI hoặc DÙNG MACRO → newContent chứa TOÀN BỘ nội dung đã sửa + bổ sung
• rewrite_content: Entry cần CẤU TRÚC LẠI HOÀN TOÀN (thay đổi cấu trúc, tách/gộp...) → newContent chứa TOÀN BỘ thay thế
• ƯU TIÊN expand_content cho entry sơ sài, rewrite_content chỉ khi cần cấu trúc lại hoàn toàn

MACRO TRONG WORLDBOOK:
• {{char}}, {{user}}, {{random::}}, {{//}}, {{roll}} — ĐÂY LÀ MACRO, KHÔNG PHÙ HỢP cho content worldbook
• Nếu thấy entry dùng macro → dùng expand_content với replaceOriginal=true, thay macro bằng tên thực/văn bản cụ thể

CHỈ trả về MỘT MẢNG JSON. KHÔNG markdown. KHÔNG code block. KHÔNG giải thích.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// USER MESSAGE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export function buildRefinerUserMessage(
  entries: LorebookEntry[],
  batchEntries: LorebookEntry[],
  config: RefinerConfig,
  batchIndex: number,
  totalBatches: number,
  schemaContext?: string,
): string {
  const parts: string[] = [];

  // User instruction
  if (config.userInstruction.trim()) {
    parts.push(`### YÊU CẦU TỪ NGƯỜI DÙNG\n${config.userInstruction.trim()}`);
  }

  // Full lorebook summary (compact) — cho AI biết toàn cảnh
  if (entries.length > 0) {
    const summary = entries.map(e => {
      const cfg = e.constant ? '🔵const' : e.selective ? '🟢sel' : '⚪none';
      const pos = e.extensions.position;
      const tokens = Math.ceil(e.content.length / 4);
      const sysTag = isSystemEntry(e) ? ' 🔒SYSTEM' : '';
      return `  #${e.id} "${e.comment}" [${e.keys.slice(0, 4).join(',')}] ${cfg} pos=${pos} ord=${e.insertion_order} ~${tokens}tk${sysTag}`;
    }).join('\n');
    parts.push(`### TOÀN BỘ ENTRIES HIỆN CÓ (${entries.length} entries)\n⚠️ Entries đánh dấu 🔒SYSTEM là entries hệ thống (EJS/MVU) — KHÔNG ĐƯỢC sửa/xóa/gộp.\n${summary}`);
  }

  // Chi tiết entries trong batch này
  const batchDetails = batchEntries.map(e => {
    return `--- ENTRY #${e.id}: "${e.comment}" ---
Keys: [${e.keys.join(',')}]
Secondary Keys: [${e.secondary_keys.join(',')}]
Constant: ${e.constant}, Selective: ${e.selective}
Position: ${e.extensions.position}, Depth: ${e.extensions.depth}, Order: ${e.insertion_order}
Role: ${e.extensions.role}, Scan Depth: ${e.extensions.scan_depth}
Exclude Recursion: ${e.extensions.exclude_recursion}, Prevent Recursion: ${e.extensions.prevent_recursion}
Content (${Math.ceil(e.content.length / 4)} tokens):
${e.content}`;
  }).join('\n\n');
  parts.push(`### CHI TIẾT ENTRIES BATCH ${batchIndex}/${totalBatches} (${batchEntries.length} entries)\n${batchDetails}`);

  // Schema context
  if (schemaContext) {
    parts.push(`### SCHEMA BIẾN (MVUZOD)\n${schemaContext}`);
  }

  // Constraints
  parts.push(`### RÀNG BUỘC
- Token target mỗi entry: ${config.maxTokensPerEntry} tokens (entry có ít hơn ${Math.round(config.maxTokensPerEntry * 0.5)} tokens nên dùng expand_content để bổ sung)
- Chế độ: ${config.operationMode === 'add_only' ? 'CHỈ bổ sung mới' : config.operationMode === 'fix_only' ? 'CHỈ sửa/xóa/bổ sung nội dung' : 'Bổ sung + Sửa + Xóa + Expand'}
${config.fixCoherenceIssues ? '- Kiểm tra TÍNH NHẤT QUÁN giữa tất cả entries' : ''}
${config.fixKeywordIssues ? '- Kiểm tra KEYWORDS đúng format, đủ bao phủ' : ''}
${config.fixConfigIssues ? '- Kiểm tra CONFIG đúng theo bảng phân loại' : ''}
- Phân tích kỹ ${batchEntries.length} entries trong batch này, nhưng THAM CHIẾU toàn bộ ${entries.length} entries để đảm bảo nhất quán.
- ƯU TIÊN expand_content cho entries sơ sài (ít hơn ${Math.round(config.maxTokensPerEntry * 0.5)} tokens) thay vì rewrite_content.`);

  return parts.join('\n\n');
}
