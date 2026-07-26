/**
 * src/lib/ai/batchGenerator.ts — Batch Lorebook Generator Pipeline
 * Spec Phần 7.3: BatchGenConfig, system prompt, user message builder, runBatchGeneration
 */

import type { ProxyProfile, GenerationParams, ChatMessage, AIGeneratedEntry, CharacterCardV3, LorebookEntry } from '../../types';
import { callAI, computePoolConcurrency } from './client';
import { materializeEntry, nextEntryId } from '../converters/cardDefaults';
import { TFIDFIndex } from '../rag/tfidfIndexer';
import { buildRAGContext } from '../rag/ragContextBuilder';
import { isDuplicateEntry } from './deduplicator';
import { checkAntiSummarization } from '../completionVerifier/antiSummarization';
import { buildCoherenceContext } from './coherenceManager';
import type { EntryCategory, CardType } from '../worldbook/worldbookConfig';
import { getPreset, ENTRY_CATEGORY_LABELS } from '../worldbook/worldbookConfig';
import { cascadeSearch } from './webScraper';
import { getProfileExtractionContext } from './worldbuildingDefaults';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export interface BatchGenConfig {
  topicPrompt: string;
  useCardContext: boolean;
  totalEntries: number;
  /** (User 2026) SÀN entry: chưa đạt thì nối batch bù (0/undefined = không ép, hành vi cũ). */
  minEntries?: number;
  entriesPerBatch: number;
  defaultPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  defaultDepth?: number;
  defaultRole?: 0 | 1 | 2;
  insertionOrderMode: 'same' | 'increment';
  insertionOrderStart: number;
  maxRetriesPerBatch: number;
  maxConsecutiveErrors: number;
  modelOverride?: string;
  concurrentBatches?: number;  // số batch gọi song song (mặc định 1)
  category?: EntryCategory;    // loại entry theo guide worldbook
  cardType?: CardType;         // thẻ đơn vs nhiều nhân vật
  useWebSearch?: boolean;      // Kích hoạt SOTA Web Search
  autoConfig?: boolean;        // true = AI tự quyết order/position/depth per entry
  schemaContext?: string;      // MVUZOD schema context — inject vào prompt khi có schema
  tokensPerEntry?: number;     // Số token mục tiêu cho mỗi entry (0 = không giới hạn)
  /**
   * (User 23/07 — việc 90) YÊU CẦU/QUY TẮC TOÀN CỤC của user.
   * Trước đây bước lorebook KHÔNG hề nhận cái này: `callAIAndExtract` của pipeline mới là chỗ
   * bơm userRules, mà batchGenerator gọi `callAI` THẲNG nên đi vòng qua nó. Hệ quả đúng như user
   * báo: gõ "không tạo nhân vật/NPC" mà bước sinh lorebook — bước tạo ra NHIỀU entry nhất —
   * vẫn đẻ hàng loạt nhân vật, vì nó chưa bao giờ đọc được câu đó.
   */
  userRules?: string;
}

export interface BatchProgress {
  batch: number;
  totalBatches: number;
  created: number;
  total: number;
  status: 'running' | 'paused' | 'done' | 'error' | 'stopped';
}

export interface BatchRunContext {
  card: CharacterCardV3;
  profile: ProxyProfile;
  generationParams: GenerationParams;
  // Control
  paused: boolean;
  stopped: boolean;
  signal?: AbortSignal;   // hủy call AI đang chạy khi bấm Dừng
  // Callbacks
  log: (message: string) => void;
  onProgress: (progress: BatchProgress) => void;
  appendEntry: (entry: LorebookEntry) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const BATCH_SYSTEM_PROMPT = `Bạn là trợ lý chuyên tạo Lorebook (World Info) cho SillyTavern.
Nhiệm vụ: dựa trên YÊU CẦU và NGỮ CẢNH NHÂN VẬT, tạo các mục Lorebook MỚI,
KHÔNG TRÙNG LẶP với danh sách "Entries đã có".

--- QUY TẮC VIẾT CONTENT (ANTI-DATA-LOSS PROTOCOL) ---
1. VIẾT ĐẦY ĐỦ: Mỗi entry phải chứa thông tin hoàn chỉnh, không viết tắt,
   không lược bỏ, không viết "xem thêm ở entry khác".
2. CÁCH LY GIỌNG ĐIỆU: Trường "content" viết ở ngôi thứ ba, khách quan, trung lập.
   Viết theo định dạng database (YAML/danh sách), KHÔNG viết như tiểu thuyết.
3. KHÔNG TRÙNG LẶP: Không tạo lại các chủ đề đã có trong danh sách "Entries đã có".
4. KHÔNG TÓM TẮT: Không dùng "...", "[rút gọn]", "v.v.", "tương tự entry X".
5. THÔNG TIN CỤ THỂ: Ghi đầy đủ số liệu, tên riêng, mô tả chi tiết.
6. NÉN KHÔNG PHẢI XÓA: Dùng ít chữ nhất để nói rõ mọi thiết lập.
   Thay "là một", "tồn tại", "được cấu thành từ" bằng dấu hai chấm và liệt kê.
7. ĐỦ CHẤT, KHÔNG SƠ SÀI: mỗi entry NHÂN VẬT phải nêu được ít nhất — lai lịch/xuất thân,
   ngoại hình nhận diện, tính cách qua HÀNH VI cụ thể (không chỉ tính từ suông), năng lực/vai trò,
   và quan hệ với các thực thể khác. Entry chỉ vài dòng chung chung kiểu "X là một kiếm khách
   mạnh mẽ, tính tình lạnh lùng" sẽ BỊ LOẠI và bạn phải sinh lại — viết đủ ngay từ đầu.

--- HƯỚNG DẪN KỸ THUẬT SILLYTAVERN ---
• keys: Bao phủ TẤT CẢ cách xưng hô có thể:
  - Nhân vật/NPC: tên đầy đủ, biệt danh, ngoại hiệu, chức vụ
  - Cảnh vật: tên địa danh, tên gọi khác, hành động liên quan
  - Thế lực: tên đầy đủ, viết tắt, địa danh trụ sở
  - Mỗi key là MỘT phần tử riêng của mảng "keys". KHÔNG gộp nhiều key thành một chuỗi có dấu phẩy.
  - Key phải CÙNG NGÔN NGỮ với nội dung thẻ (thẻ tiếng Việt → key tiếng Việt), vì người chơi
    gõ chữ gì thì key phải đúng chữ đó.
  - Khoảng trắng BÊN TRONG key là BẮT BUỘC khi từ có nhiều tiếng: "giao hàng" ĐÚNG,
    "giao_hàng"/"giaohang" SAI. TUYỆT ĐỐI không dùng _ hay - để nối chữ.
• constant: true cho entry thường trú (thế giới quan, bối cảnh, nhân vật thẻ đơn)
• selective: true cho entry tải theo nhu cầu (NPC, cảnh vật, sự kiện)
• insertion_order: worldview=1-3, overview=4, character=10-50, scene=50-98, NPC=100

CHỈ trả về MỘT MẢNG JSON hợp lệ. KHÔNG thêm giải thích, KHÔNG markdown, KHÔNG code block.`;

// ─── TOKEN BUDGET ADDON (inject khi tokensPerEntry > 0) ──────────────────

function buildTokenBudgetDirective(tokensPerEntry: number | undefined): string {
  if (!tokensPerEntry || tokensPerEntry <= 0) return '';
  return `\n\n--- NGÂN SÁCH TOKEN MỖI ENTRY (BẮT BUỘC TUÂN THỦ) ---
Mỗi entry PHẢI có content dài KHOẢNG ${tokensPerEntry} tokens (≈ ${Math.round(tokensPerEntry * 3.5)} ký tự tiếng Việt).
• Nếu ${tokensPerEntry} ≤ 100: Viết NGẮN GỌN, chỉ thông tin cốt lõi, dạng liệt kê.
• Nếu ${tokensPerEntry} = 100–300: Viết VỪA PHẢI, đủ chi tiết chính + 1-2 chi tiết phụ.
• Nếu ${tokensPerEntry} ≥ 300: Viết CHI TIẾT ĐẦY ĐỦ, bao gồm mô tả sâu, ví dụ cụ thể, quan hệ liên kết.
[LỆNH]: Mỗi entry KHÔNG ĐƯỢC ngắn hơn ${Math.round(tokensPerEntry * 0.7)} tokens và KHÔNG ĐƯỢC dài hơn ${Math.round(tokensPerEntry * 1.3)} tokens.`;
}

// ─── TIẾT KIỆM TOKEN KHI SINH SỐ LƯỢNG LỚN ──────────────────────────────
/**
 * (User 21/07) Entry `constant=true` được nhồi vào MỌI lượt chat, không cần từ khoá.
 * Sinh 40 entry mà để constant hết thì mỗi lượt chat gánh cả 40 entry → cháy context,
 * đắt và làm loãng prompt. Batch càng lớn thì càng phải khắt khe: chỉ vài entry nền
 * móng mới được thường trú, phần còn lại để "ngủ" và chỉ bật khi người chơi nhắc tới.
 */
function buildLargeBatchBudgetDirective(entryCount: number): string {
  if (!entryCount || entryCount < 10) return '';
  const maxConstant = entryCount >= 30 ? 5 : entryCount >= 20 ? 4 : 3;
  return `\n\n--- TIẾT KIỆM TOKEN CHO LÔ LỚN (${entryCount} entries) — BẮT BUỘC ---
Entry constant=true bị nhồi vào MỌI lượt chat dù người chơi không nhắc tới. ${entryCount} entry
mà để constant hết thì mỗi lượt chat phải gánh toàn bộ → cháy context, tốn tiền, loãng prompt.
• TỐI ĐA ${maxConstant} entry được constant=true — chỉ dành cho nền móng KHÔNG THỂ THIẾU
  (thế giới quan tổng, luật chơi cốt lõi, nhân vật chính của thẻ đơn).
• TẤT CẢ entry còn lại: constant=false, selective=true → "ngủ" cho tới khi khớp từ khoá.
• Vì vậy keys của nhóm ngủ phải ĐẶC BIỆT ĐẦY ĐỦ (tên, biệt danh, chức vụ, địa danh, cách gọi
  tắt người chơi hay dùng) — key thiếu thì entry ngủ mãi, coi như mất trắng.`;
}

// ─── AUTO-CONFIG ADDON (chỉ inject khi autoConfig=true) ──────────────────

export const AUTO_CONFIG_ADDON = `

--- AUTO-CONFIG PER ENTRY (QUAN TRỌNG — ĐỌC KỸ) ---

Ngoài comment/keys/content, bạn PHẢI trả thêm config cho MỖI entry. Dưới đây là BẢNG PHÂN LOẠI CHUẨN:

═══ 7 LOẠI ENTRY & CẤU HÌNH TƯƠNG ỨNG ═══

1. THẾ GIỚI QUAN / BỐI CẢNH (Tổng cương thế giới)
   → constant=true, selective=false
   → position=0 (before_char), depth=4
   → insertion_order=1-3
   → scan_depth=null (constant không cần scan)
   Nội dung: Tên thế giới, quy tắc cốt lõi, khu vực lớn. Viết dạng YAML/database.
   Luôn thường trú (đèn xanh dương). Dùng ít chữ nhất nói rõ mọi thiết lập.

2. TỔNG QUAN KHU VỰC (Xem lướt)
   → constant=true, selective=false
   → position=0 (before_char), depth=4
   → insertion_order=4-10
   → scan_depth=null
   Nội dung: Liệt kê khu vực + 1 câu định vị. KHÔNG triển khai chi tiết.

3. XEM LƯỚT NHÂN VẬT (Character Overview)
   → constant=true, selective=false
   → position=0 (before_char), depth=4
   → insertion_order=4
   → scan_depth=null
   Nội dung: Giới thiệu vắn tắt tất cả nhân vật. Luôn thường trú.

4. CHI TIẾT NHÂN VẬT CỐT LÕI
   Thẻ đơn (1 nhân vật):
     → constant=true, selective=false ← QUY LUẬT THÉP: thẻ đơn = toàn bộ đèn xanh dương
     → position=1 (after_char), depth=4
     → insertion_order=10-50 (cơ bản=10, ngoại hình=20, tính cách=30, bối cảnh=40, NSFW=50)
     → scan_depth=null
   Thẻ nhiều nhân vật (2+ nhân vật):
     → constant=false, selective=true ← đèn xanh lá, chỉ tải khi nhắc đến
     → position=1 (after_char), depth=4
     → insertion_order=99
     → scan_depth=2

5. NPC (Vai phụ)
   → constant=false, selective=true
   → position=1 (after_char), depth=4
   → insertion_order=100
   → scan_depth=2
   Từ khóa: Tên đầy đủ, biệt danh, ngoại hiệu, chức vụ, tất cả cách gọi có thể.
   Ví dụ: "Vương Tĩnh,Cô giáo Vương,Giáo viên chủ nhiệm"

6. CẢNH VẬT / SỰ KIỆN / ĐỊA DANH
   → constant=false, selective=true
   → position=1 (after_char), depth=4
   → insertion_order=50-98
   → scan_depth=2
   Từ khóa: Tên cảnh vật, tên khu vực, tên gọi khác, hành động liên quan.
   Ví dụ: "Thư viện,Thư viện trường,Mượn sách"

7. GIẢI THÍCH LẦN HAI / CHỈ ĐẠO AI (D0)
   → constant=false, selective=true
   → position=4 (@depth), depth=0, role=0 (system)
   → insertion_order=1
   → scan_depth=2
   Nội dung: Điều chỉnh hành vi AI cho nhân vật cụ thể. D0 = vị trí AI đọc cuối cùng = sức ảnh hưởng mạnh nhất.
   Từ khóa: Tên nhân vật cần điều chỉnh.

═══ QUY TẮC THIẾT KẾ TỪ KHÓA ═══
• Ngăn cách bằng dấu phẩy tiếng Anh (,), KHÔNG có khoảng trắng sau phẩy
• Bao phủ TẤT CẢ cách xưng hô: tên đầy đủ, biệt danh, ngoại hiệu, chức vụ, tên gọi khác
• Thế lực: tên đầy đủ, viết tắt, địa danh trụ sở
• NPC: tên đầy đủ, biệt danh, ngoại hiệu, chức vụ
• Cảnh vật: tên địa danh, tên gọi khác, hành động liên quan
• Entry thường trú (constant=true) → KHÔNG cần từ khóa

═══ QUY TẮC VIẾT CONTENT ═══
• Dùng định dạng database (YAML/danh sách), KHÔNG viết như tiểu thuyết
• NÉN KHÔNG PHẢI XÓA: dùng ít chữ nhất nói rõ mọi thiết lập
• Thay "là một", "tồn tại", "được cấu thành từ" bằng dấu hai chấm và liệt kê
• Tiêu chuẩn: xóa câu này đi AI có diễn sai không? Không thì xóa
• KHÔNG viết đánh giá chủ quan ("hùng mạnh", "bí ẩn"), KHÔNG viết hình ảnh tu từ

═══ BẢNG TÓM TẮT NHANH ═══
Loại             | const | selec | pos | depth | order  | scan
Thế giới quan    | true  | false | 0   | 4     | 1-3    | null
Tổng quan KV     | true  | false | 0   | 4     | 4-10   | null
Xem lướt NV      | true  | false | 0   | 4     | 4      | null
Chi tiết NV(đơn) | true  | false | 1   | 4     | 10-50  | null
Chi tiết NV(đa)  | false | true  | 1   | 4     | 99     | 2
NPC              | false | true  | 1   | 4     | 100    | 2
Cảnh vật/SK      | false | true  | 1   | 4     | 50-98  | 2
Chỉ đạo AI(D0)  | false | true  | 4   | 0     | 1      | 2

JSON FORMAT BẮT BUỘC:
[{
  "comment": "Tên entry",
  "keys": ["từ khóa 1","từ khóa 2"],
  "content": "Nội dung dạng database...",
  "constant": true/false,
  "selective": true/false,
  "insertion_order": number,
  "position": 0|1|4,
  "depth": 4,
  "role": null,
  "scan_depth": 2|null
}, ...]
`;

// ─── CATEGORY DIRECTIVE (inject khi user chọn tab loại nội dung) ────────

function buildCategoryDirective(category: EntryCategory | undefined, cardType: CardType | undefined): string {
  if (!category || category === 'custom') return '';

  const catLabel = ENTRY_CATEGORY_LABELS[category];
  const preset = getPreset(category, cardType ?? 'single');
  if (!catLabel || !preset) return '';

  const ct = cardType ?? 'single';

  // Quy tắc riêng cho từng category
  const categoryRules: Record<string, string> = {
    character_detail: ct === 'single'
      ? `MỤC ĐÍCH: Viết CHI TIẾT về NHÂN VẬT CHÍNH (nhân vật cốt lõi duy nhất).
CÁCH CHIA ENTRY: Chia nhỏ thành các khía cạnh — ngoại hình, tính cách, bối cảnh, kỹ năng, mối quan hệ, NSFW (nếu có). Mỗi entry = 1 khía cạnh.
CẤU HÌNH BẮT BUỘC: constant=true, selective=false (QUY LUẬT THÉP thẻ đơn), position=1, depth=4
TỪ KHÓA: Thẻ đơn thường trú → KHÔNG cần keyword (keys=[] hoặc [tên NV]).
INSERTION_ORDER: cơ bản=10, ngoại hình=20, tính cách=30, bối cảnh=40, NSFW=50`
      : `MỤC ĐÍCH: Viết CHI TIẾT về MỘT NHÂN VẬT CỐT LÕI (trong thẻ nhiều nhân vật).
CÁCH CHIA ENTRY: Chia nhỏ thành các khía cạnh — ngoại hình, tính cách, bối cảnh, kỹ năng. Mỗi entry = 1 khía cạnh.
CẤU HÌNH BẮT BUỘC: constant=false, selective=true (thẻ nhiều NV), position=1, depth=4
TỪ KHÓA BẮT BUỘC: Tên đầy đủ, biệt danh, ngoại hiệu — bao phủ TẤT CẢ cách gọi.
INSERTION_ORDER: 99`,
    npc: `MỤC ĐÍCH: Tạo các NPC (nhân vật phụ / vai phụ). MỖI entry = 1 NPC riêng biệt.
NỘI DUNG MỖI NPC: Ngoại hình, tính cách, vai trò, mối quan hệ với nhân vật chính, thói quen, cách nói chuyện.
CẤU HÌNH BẮT BUỘC: constant=false, selective=true, position=1, depth=4
TỪ KHÓA BẮT BUỘC: Tên đầy đủ, biệt danh, ngoại hiệu, chức vụ — bao phủ TẤT CẢ cách gọi.
INSERTION_ORDER: 100`,
    worldview: `MỤC ĐÍCH: Mô tả THẾ GIỚI QUAN / BỐI CẢNH tổng cương.
NỘI DUNG: Tên thế giới, quy tắc cốt lõi, hệ thống sức mạnh, cấu trúc xã hội, lịch sử tóm tắt.
CÁCH CHIA: Chia thành tổng cương chung, hệ thống phép thuật/sức mạnh, cấu trúc xã hội/chính trị, lịch sử.
CẤU HÌNH BẮT BUỘC: constant=true, selective=false, position=0 (before_char), depth=4
TỪ KHÓA: Thường trú → KHÔNG cần keyword.
INSERTION_ORDER: 1-3`,
    region_overview: `MỤC ĐÍCH: Mô tả ĐỊA LÝ / KHU VỰC. MỖI entry = 1 khu vực/địa danh.
NỘI DUNG: Tên khu vực, vị trí, đặc điểm, cư dân, nguy hiểm, tài nguyên, mối liên hệ với khu vực khác.
CẤU HÌNH BẮT BUỘC: constant=true, selective=false, position=0 (before_char), depth=4
TỪ KHÓA: Thường trú → KHÔNG cần keyword.
INSERTION_ORDER: 4-10`,
    scene: `MỤC ĐÍCH: Mô tả CẢNH VẬT / SỰ KIỆN / ĐỊA DANH cụ thể. MỖI entry = 1 cảnh/sự kiện.
NỘI DUNG: Mô tả chi tiết cảnh vật, bầu không khí, điều kiện kích hoạt (nếu sự kiện), hậu quả, nhân vật liên quan.
CẤU HÌNH BẮT BUỘC: constant=false, selective=true, position=1 (after_char), depth=4
TỪ KHÓA BẮT BUỘC: Tên cảnh/sự kiện, tên gọi khác, hành động liên quan.
INSERTION_ORDER: 50-98`,
    secondary_explanation: `MỤC ĐÍCH: Tạo entry CHỈ ĐẠO AI (D0) — điều chỉnh hành vi AI cho nhân vật cụ thể.
NỘI DUNG: Quy tắc viết, văn phong yêu cầu, hành vi AI phải tuân theo. KHÔNG miêu tả nhân vật — chỉ chỉ đạo AI.
CẤU HÌNH BẮT BUỘC: constant=false, selective=true, position=4 (@depth), depth=0, role=0 (system)
TỪ KHÓA BẮT BUỘC: Tên nhân vật cần điều chỉnh.
INSERTION_ORDER: 1
ĐẶC BIỆT: D0 = vị trí AI đọc CUỐI CÙNG = sức ảnh hưởng MẠNH NHẤT.`,
    character_overview: `MỤC ĐÍCH: Giới thiệu vắn tắt TẤT CẢ nhân vật. Mỗi nhân vật = 1-2 câu định vị.
CẤU HÌNH BẮT BUỘC: constant=true, selective=false, position=0, depth=4
INSERTION_ORDER: 4`,
  };

  const rules = categoryRules[category] || `MỤC ĐÍCH: Tạo entries loại "${catLabel.label}".
CẤU HÌNH MẶC ĐỊNH: constant=${preset.defaults.constant}, selective=${preset.defaults.selective}, position=${preset.defaults.position}, depth=${preset.defaults.depth}`;

  return `

═══ LOẠI NỘI DUNG BẮT BUỘC: ${catLabel.icon} ${catLabel.label.toUpperCase()} ═══
[LỆNH TUYỆT ĐỐI]: Bạn PHẢI tạo ĐÚNG loại entry "${catLabel.label}" theo yêu cầu dưới đây.
TUYỆT ĐỐI KHÔNG tạo entry loại khác. Mọi entry trong mảng JSON trả về PHẢI thuộc loại "${catLabel.label}".

${rules}

Nếu người dùng yêu cầu nội dung mâu thuẫn với loại "${catLabel.label}", hãy DIỄN GIẢI yêu cầu đó theo góc nhìn của loại "${catLabel.label}".
Ví dụ: Nếu chọn tab NPC nhưng yêu cầu "Tạo thế giới", hãy tạo các NPC SỐNG TRONG thế giới đó, KHÔNG tạo entry thế giới quan.
`;
}


// ═══════════════════════════════════════════════════════════════════════════
// USER MESSAGE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a rich summary of previously created entries grouped by category/theme.
 * This helps the AI understand what was already built in earlier batches
 * so it can create complementary, non-overlapping content.
 */
function buildPreviousBatchSummary(
  entries: Array<{ comment: string; keys: string[]; content: string; constant?: boolean; selective?: boolean }>,
): string {
  if (entries.length === 0) return '';

  // Group entries by inferred category
  const groups: Record<string, Array<{ comment: string; keys: string[]; contentSnippet: string }>> = {};
  for (const e of entries) {
    // Infer category from entry properties
    let cat = 'Khác';
    if (e.constant && !e.selective) {
      cat = '🌍 Thế giới quan / Bối cảnh (thường trú)';
    } else if (!e.constant && e.selective) {
      // Check content hints
      const lowerComment = e.comment.toLowerCase();
      if (lowerComment.includes('npc') || lowerComment.includes('nhân vật phụ')) {
        cat = '👥 NPC / Nhân vật phụ';
      } else if (lowerComment.includes('cảnh') || lowerComment.includes('sự kiện') || lowerComment.includes('địa danh')) {
        cat = '🏞 Cảnh vật / Sự kiện';
      } else {
        cat = '📄 Entry theo ngữ cảnh';
      }
    } else if (e.constant) {
      cat = '👑 Nhân vật chính (thường trú)';
    }
    if (!groups[cat]) groups[cat] = [];
    // Truncate content to ~100 chars for summary
    const snippet = e.content.length > 120 ? e.content.slice(0, 120) + '…' : e.content;
    groups[cat].push({ comment: e.comment, keys: e.keys, contentSnippet: snippet });
  }

  const sections = Object.entries(groups).map(([cat, items]) => {
    const listing = items.map(it =>
      `  • "${it.comment}" [keys: ${it.keys.slice(0, 4).join(',')}] — ${it.contentSnippet}`
    ).join('\n');
    return `[${cat}] (${items.length} entries):\n${listing}`;
  });

  return sections.join('\n\n');
}

function buildBatchUserMessage(
  config: BatchGenConfig,
  card: CharacterCardV3,
  seen: Array<{ comment: string; keys: string[] }>,
  ragInjection: string,
  coherenceInjection: string,
  webInjection: string,
  countThisBatch: number,
  batchIndex: number,
  totalBatches: number,
  previouslyCreatedEntries: Array<{ comment: string; keys: string[]; content: string; constant?: boolean; selective?: boolean }>,
  /** (việc 90) Luồng thứ mấy trong vòng chạy song song — để chia phần, tránh các luồng đụng nhau. */
  lane?: { index: number; total: number },
): string {
  const parts: string[] = [];

  if (config.useCardContext) {
    parts.push(`### Ngữ cảnh nhân vật
Tên: ${card.data.name}
Description: ${card.data.description.slice(0, 1000)}
Personality: ${card.data.personality.slice(0, 500)}
Scenario: ${card.data.scenario.slice(0, 500)}`);
  }

  // Inject schema context khi có MVUZOD schema
  if (config.schemaContext) {
    parts.push(`### Schema biến (MVUZOD)\n${config.schemaContext}`);
  }

  // Inject category context — nói rõ loại nội dung yêu cầu
  if (config.category && config.category !== 'custom') {
    const catLabel = ENTRY_CATEGORY_LABELS[config.category];
    if (catLabel) {
      parts.push(`### ⚠️ LOẠI NỘI DUNG YÊU CẦU: ${catLabel.icon} ${catLabel.label}
Bạn PHẢI tạo ĐÚNG loại entry "${catLabel.label}". TUYỆT ĐỐI KHÔNG tạo entry loại khác.`);
    }
  }

  parts.push(`### Yêu cầu nội dung
${config.topicPrompt}`);

  // Token budget instruction in user message too for reinforcement
  if (config.tokensPerEntry && config.tokensPerEntry > 0) {
    parts.push(`### 📏 Độ dài mỗi entry: ~${config.tokensPerEntry} tokens (≈ ${Math.round(config.tokensPerEntry * 3.5)} ký tự)`);
  }

  // Rich context about previously created entries from earlier batches
  if (previouslyCreatedEntries.length > 0 && batchIndex > 1) {
    const batchSummary = buildPreviousBatchSummary(previouslyCreatedEntries);
    parts.push(`### 📋 TÓM TẮT CÁC BATCH TRƯỚC (${previouslyCreatedEntries.length} entries đã tạo)
Dưới đây là tổng quan các entries đã được sinh từ các batch TRƯỚC ĐÓ. Hãy ĐỌC KỸ để:
1. KHÔNG tạo lại nội dung trùng lặp
2. MỞ RỘNG và BỔ SUNG thêm chi tiết mới, góc nhìn mới
3. DUY TRÌ tính nhất quán về tên, số liệu, mối quan hệ
4. LIÊN KẾT với entries đã có (nếu phù hợp)

${batchSummary}`);
  }

  if (seen.length > 0) {
    const existingList = seen.map(e => `- "${e.comment}" — keys: [${e.keys.join(', ')}]`).join('\n');
    parts.push(`### Entries đã có (KHÔNG tạo lại)
${existingList}`);
  }

  parts.push(`### RAG Context (KHÔNG tạo lại các entry này)
${ragInjection ? `\n[NGỮ CẢNH RAG LỊCH SỬ]:\n${ragInjection}` : ''}
${coherenceInjection ? `\n[TÍNH NHẤT QUÁN COHERENCE]:\n${coherenceInjection}` : ''}
${webInjection ? `\n[KIẾN THỨC TỪ WEB (LIVE)]:\n<web_search_results>\n${webInjection}\n</web_search_results>` : ''}

[SỐ LƯỢNG YÊU CẦU LẦN NÀY]: Hãy sinh ra đúng ${countThisBatch} entries hợp lệ (batch ${batchIndex}/${totalBatches}).`);

  // (việc 90) CHỐNG TRÙNG TỪ GỐC. Các batch trong cùng một vòng chạy SONG SONG và đều nhận
  // ngữ cảnh y hệt nhau (trạng thái thẻ TRƯỚC vòng) — không luồng nào thấy anh em đang viết gì,
  // nên ba luồng cùng chọn một nhân vật là chuyện tất nhiên. Bộ lọc trùng chỉ dọn được phần
  // ngọn (và dọn xong thì phí trắng lượt gọi API đó). Chia phần TRƯỚC bằng một quy tắc tất định
  // mà model theo được: mỗi luồng chỉ nhận các mục cách nhau đúng `lane.total` trong danh sách.
  if (lane && lane.total > 1) {
    parts.push(`### 🚦 BẠN LÀ LUỒNG ${lane.index}/${lane.total} ĐANG CHẠY SONG SONG
Có ${lane.total} luồng cùng sinh entry CÙNG LÚC trên cùng ngữ cảnh này. Các luồng kia KHÔNG nhìn
thấy kết quả của bạn và bạn cũng không thấy của họ — nếu ai cũng chọn thực thể "nổi bật nhất"
thì sẽ ra nhiều entry trùng nhau về CÙNG một nhân vật.

CHIA PHẦN (bắt buộc): trong "DANH SÁCH THỰC THỂ BẮT BUỘC PHỦ" ở trên, đánh số từ 1, bạn CHỈ được
lấy các mục số ${lane.index}, ${lane.index + lane.total}, ${lane.index + lane.total * 2}, … (cách đều ${lane.total} mục).
Nếu phần của bạn đã hết hoặc danh sách không có, hãy chọn thực thể ÍT NỔI BẬT hơn, tránh nhân vật
chính và những cái tên hiển nhiên nhất — để dành chúng cho luồng khác.`);
  }

  // (việc 90) Luật của user đặt CUỐI CÙNG — phần model đọc sau chót có trọng lượng cao nhất, và
  // nó phải thắng mọi gợi ý chủ đề ở trên (blueprint hay đề xuất bao nhiêu nhân vật mà user bảo
  // đừng tạo nhân vật thì KHÔNG tạo).
  if (config.userRules?.trim()) {
    parts.push(`### ⛔ QUY TẮC BẮT BUỘC TỪ NGƯỜI DÙNG — ƯU TIÊN CAO NHẤT, THẮNG MỌI YÊU CẦU Ở TRÊN
${config.userRules.trim()}

Nếu quy tắc trên MÂU THUẪN với danh sách chủ đề/thực thể gợi ý phía trên thì NGHE THEO QUY TẮC NÀY:
bỏ hẳn những mục vi phạm, KHÔNG tạo entry cho chúng, và dùng phần hạn ngạch đó cho loại nội dung
mà quy tắc CHO PHÉP. Thà trả về ít entry hơn còn hơn tạo thứ user đã cấm.`);
  }

  return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON ARRAY EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

export function tryExtractJsonArray(text: string): AIGeneratedEntry[] | null {
  const t = text.trim();
  // (bugNeedFix/96) LUẬT CHUNG cho mọi bước bóc bên dưới: chỉ TRẢ VỀ khi thật sự bóc được
  // entry hợp lệ. Trước đây các nhánh viết `return validateEntries(...)` nên khi bắt nhầm một
  // mảng KHÔNG phải entry (ví dụ mảng "keys" nằm bên trong một entry trần) thì hàm trả null
  // và THOÁT LUÔN — các cách bóc còn lại không bao giờ được chạy. Đó là lý do một entry trần
  // hay NDJSON đều bị báo "AI trả về không phải JSON array".
  const ok = (v: AIGeneratedEntry[] | null) => (v && v.length > 0 ? v : null);

  // Try raw parse first
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const v = ok(validateEntries(parsed));
      if (v) return v;
    }
  } catch { /* continue */ }

  // Try extracting from code fence
  const fenceMatch = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) {
        const v = ok(validateEntries(parsed));
        if (v) return v;
      }
    } catch { /* continue */ }
  }

  // Try finding array by finding first [ and last ]
  const firstBracket = t.indexOf('[');
  const lastBracket = t.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      const parsed = JSON.parse(t.substring(firstBracket, lastBracket + 1));
      if (Array.isArray(parsed)) {
        const v = ok(validateEntries(parsed));
        if (v) return v;
      }
    } catch { /* continue */ }
  }
  
  // Try finding array by finding first [ and the FIRST ] that successfully parses
  // (In case the model outputs something like: [ {...} ] Note: [...])
  if (firstBracket !== -1) {
    let currentClosing = t.indexOf(']', firstBracket);
    while (currentClosing !== -1) {
      try {
        const parsed = JSON.parse(t.substring(firstBracket, currentClosing + 1));
        if (Array.isArray(parsed)) {
          const v = ok(validateEntries(parsed));
          if (v) return v;
        }
      } catch { /* thử dấu ] kế tiếp */ }
      // LUÔN tiến sang dấu ] kế tiếp — kể cả khi parse được nhưng không phải entry hợp lệ.
      // (Nếu chỉ tiến trong nhánh catch thì trường hợp "parse OK + validate trượt" sẽ lặp vô hạn.)
      currentClosing = t.indexOf(']', currentClosing + 1);
    }
  }

  // Try extracting from an object wrapper { "entries": [...] }
  try {
    const firstBrace = t.indexOf('{');
    const lastBrace = t.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(t.substring(firstBrace, lastBrace + 1));
      if (parsed && typeof parsed === 'object') {
        // Chỉ return khi validate ĐƯỢC — nếu không (vd bắt nhầm object entry đơn mà `keys`
        // là mảng), để rơi xuống bước cứu vớt bên dưới thay vì trả null sớm.
        for (const arr of Object.values(parsed).filter(Array.isArray)) {
          const v = validateEntries(arr as unknown[]);
          if (v) return v;
        }
        // (bugNeedFix/96) MỘT ENTRY TRẦN, không bọc mảng. Xảy ra khi provider bật chế độ
        // "bắt buộc trả JSON object" — chế độ đó CẤM mảng ở cấp cao nhất nên model đành trả
        // một object entry. Trước đây rơi thẳng vào "AI trả về không phải JSON array".
        const single = validateEntries([parsed]);
        if (single) return single;
      }
    }
  } catch { /* continue */ }

  // (bugNeedFix/96) NDJSON — mỗi dòng một object entry (một số model trả kiểu này khi bị ép JSON).
  {
    const lines = t.split('\n').map(l => l.trim()).filter(l => l.startsWith('{') && l.endsWith('}'));
    if (lines.length > 0) {
      const objs: unknown[] = [];
      for (const l of lines) { try { objs.push(JSON.parse(l)); } catch { /* bỏ dòng hỏng */ } }
      if (objs.length > 0) {
        const v = validateEntries(objs);
        if (v) return v;
      }
    }
  }

  // (Fix bug #6) CỨU VỚT KHI JSON BỊ CẮT CỤT: model chạm giới hạn token giữa mảng → mảng
  // không đóng `]`, mọi cách parse trên đều fail → trước đây trả null → log "không trả về
  // JSON" → retry hoài (giống treo). Ở đây quét từng object `{...}` cân bằng ngoặc (tôn trọng
  // chuỗi/escape) và parse riêng, thu lại các entry hoàn chỉnh. Chỉ 1 entry cuối bị cụt là bỏ,
  // phần trước vẫn dùng được → không còn "trả về không phải JSON".
  const salvaged = salvageObjects(t);
  if (salvaged.length > 0) {
    const v = validateEntries(salvaged);
    if (v) return v;
  }

  return null;
}

/**
 * Quét các object JSON `{...}` cân bằng ngoặc trong 1 chuỗi (bỏ qua ngoặc nằm trong chuỗi
 * "..." và escape). Object nào parse được thì thu lại — dùng để cứu mảng JSON bị cắt cụt.
 */
function salvageObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] !== '{') { i++; continue; }
    // Tìm `}` khớp với `{` tại i
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < n; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { if (inStr) esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) break; // object cuối bị cụt — dừng
    try {
      const obj = JSON.parse(text.substring(i, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj as Record<string, unknown>);
    } catch { /* object hỏng — bỏ qua */ }
    i = end + 1;
  }
  return out;
}

function validateEntries(arr: unknown[]): AIGeneratedEntry[] | null {
  const valid: AIGeneratedEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.comment !== 'string' || !Array.isArray(e.keys) || typeof e.content !== 'string') continue;
    if (!e.comment.trim() || !e.content.trim() || e.keys.length === 0) continue;
    valid.push({
      comment: e.comment,
      keys: e.keys.map(String),
      secondary_keys: Array.isArray(e.secondary_keys) ? e.secondary_keys.map(String) : undefined,
      content: e.content,
      constant: typeof e.constant === 'boolean' ? e.constant : undefined,
      selective: typeof e.selective === 'boolean' ? e.selective : undefined,
      insertion_order: typeof e.insertion_order === 'number' ? e.insertion_order : undefined,
      // AI Auto-Config per entry
      position: typeof e.position === 'number' && [0,1,2,3,4,5,6,7].includes(e.position)
        ? e.position as AIGeneratedEntry['position'] : undefined,
      depth: typeof e.depth === 'number' ? e.depth : undefined,
      role: typeof e.role === 'number' && [0,1,2].includes(e.role)
        ? e.role as AIGeneratedEntry['role'] : (e.role === null ? null : undefined),
      scan_depth: typeof e.scan_depth === 'number' ? e.scan_depth : undefined,
      category_hint: typeof e.category_hint === 'string' ? e.category_hint : undefined,
    });
  }
  return valid.length > 0 ? valid : null;
}

// (Old simple checks replaced by deduplicator.ts and completionVerifier/antiSummarization.ts)

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runBatchGeneration(config: BatchGenConfig, ctx: BatchRunContext) {
  if (!ctx.card.data.character_book) {
    ctx.card.data.character_book = { name: ctx.card.data.name, entries: [] };
  }
  if (!ctx.card.data.character_book.entries) {
    ctx.card.data.character_book.entries = [];
  }
  
  // (User 2026 — min/max entry) totalEntries là TRẦN; minEntries là SÀN — chưa đạt sàn thì nối batch
  // bù ở cuối (let vì có thể tăng). Trần an toàn 2× kế hoạch để không lặp vô hạn khi AI trả rỗng mãi.
  let totalBatches = Math.ceil(config.totalEntries / config.entriesPerBatch);
  const plannedBatches = totalBatches;
  const wantMin = Math.max(0, Math.min(config.minEntries ?? 0, config.totalEntries));
  // #11 — Số luồng song song = tổng ngân sách RPM toàn pool (mỗi provider × key × RPM chính+phụ).
  // RPM limiter (chốt-giờ-bắt-đầu) ở client.ts đảm bảo không vượt trần 429 dù luồng cao.
  const concurrency = Math.max(1, Math.min(computePoolConcurrency(ctx.profile), totalBatches));
  let created = 0;
  // (bug 71) Entry bị dedup loại trước đây MẤT TRẮNG: số batch cố định nên không sinh bù,
  // kế hoạch 20 entry thực tế còn 6-10. Nay đếm để nối batch bù đúng phần đã rơi.
  let droppedDup = 0;
  let consecutiveErrors = 0;
  const seen: Array<{ comment: string; keys: string[] }> = (
    ctx.card.data.character_book?.entries ?? []
  ).map(e => ({ comment: e.comment, keys: e.keys }));
  // Track entries created in THIS run (with content) for rich batch summary
  const createdEntries: Array<{ comment: string; keys: string[]; content: string; constant?: boolean; selective?: boolean }> = [];

  const profile = config.modelOverride
    ? { ...ctx.profile, selectedModel: config.modelOverride }
    : ctx.profile;

  ctx.log(`🚀 Bắt đầu sinh ${config.totalEntries} entries trong ${totalBatches} batches` +
    (concurrency > 1 ? ` (${concurrency} song song)` : ''));

  // Initialize RAG index
  const ragIndex = new TFIDFIndex();
  ragIndex.indexWithSource(ctx.card.data.character_book?.entries ?? []);
  ctx.log(`📊 RAG index: ${ragIndex.size} entries đã index`);
  let entriesSinceLastRebuild = 0;

  // Process batches in rounds of `concurrency`
  for (let roundStart = 1; roundStart <= totalBatches; roundStart += concurrency) {
    if (ctx.stopped) { ctx.log('⏹ Đã dừng.'); break; }
    while (ctx.paused) { await sleep(300); }

    const roundEnd = Math.min(roundStart + concurrency - 1, totalBatches);
    const batchIndices: number[] = [];
    for (let i = roundStart; i <= roundEnd; i++) batchIndices.push(i);

    // Build tasks for this round
    const tasks = (await Promise.all(batchIndices.map(async i => {
      const countThisBatch = Math.min(config.entriesPerBatch, config.totalEntries - created - (i - roundStart) * config.entriesPerBatch);
      if (countThisBatch <= 0) return null;

      const ragCtx = buildRAGContext(config.topicPrompt, ragIndex, { topK: 8, includeNegatives: true });
      const coherenceCtx = buildCoherenceContext(ctx.card.data.character_book?.entries ?? []);
      
      let webInjection = '';
      if (config.useWebSearch) {
        // Build smarter search queries:
        // - Base: topic prompt (user's description)
        // - Context: card name + category cho search chính xác hơn
        const categoryLabel = config.category && config.category !== 'custom'
          ? ENTRY_CATEGORY_LABELS[config.category]?.label ?? ''
          : '';
        const cardName = ctx.card.data.name || '';
        
        // Tạo search query thông minh hơn
        const baseQuery = config.topicPrompt.slice(0, 100).trim();
        const contextParts = [baseQuery, cardName, categoryLabel].filter(Boolean);
        const searchQuery = contextParts.join(' ').trim();
        
        ctx.log(`🌐 [Batch ${i}] Đang tìm kiếm web: "${searchQuery.slice(0, 60)}..."...`);
        try {
          let searchResults = await cascadeSearch(searchQuery, ctx.profile.webSearchProxyUrl);
          // (#43 — "web search tìm rộng hơn") Query dài ghép cả tên card + category dễ thành
          // chuỗi quá đặc thù → 0 kết quả. Không thấy gì thì TỰ NỚI: thử lại chỉ với vài từ
          // khoá đầu của chủ đề, thay vì bỏ cuộc luôn.
          if (searchResults.length === 0) {
            const broad = baseQuery.split(/\s+/).slice(0, 5).join(' ').trim();
            if (broad && broad !== searchQuery) {
              ctx.log(`🔎 [Batch ${i}] Không thấy gì — nới query rộng hơn: "${broad}"...`);
              searchResults = await cascadeSearch(broad, ctx.profile.webSearchProxyUrl);
            }
          }
          if (searchResults.length > 0) {
            webInjection = searchResults.map(r => `[${r.source}] ${r.url}\n${r.content}`).join('\n\n---\n\n');
            ctx.log(`✅ [Batch ${i}] Web Search: ${searchResults.length} nguồn — ${searchResults.map(r => r.source).join(', ')}`);
          } else {
            ctx.log(`⚠️ [Batch ${i}] Web Search: Không tìm thấy dữ liệu liên quan (đã thử cả query nới rộng).`);
          }
        } catch (webErr) {
          ctx.log(`⚠️ [Batch ${i}] Web Search lỗi: ${webErr instanceof Error ? webErr.message : String(webErr)}`);
        }
      }

      const userMessage = buildBatchUserMessage(config, ctx.card, seen, ragCtx.injectionText, coherenceCtx, webInjection, countThisBatch, i, totalBatches, createdEntries,
        { index: i - roundStart + 1, total: batchIndices.length });
      const schemaAddon = config.schemaContext
        ? '\n\n--- SCHEMA-AWARE MODE (BẮT BUỘC) ---\nCard này có hệ biến MVU-ZOD (xem "### Schema biến" ở trên). Entry mô tả NHÂN VẬT/NPC PHẢI gán giá trị cụ thể cho các chỉ số của nhân vật có trong schema (vd võ lực/trí lực/thể lực… → ghi rõ từng con số). Entry địa điểm/vật phẩm/thế lực thì đề cập các biến liên quan tương ứng. Dùng ĐÚNG TÊN biến trong schema, KHÔNG bịa biến ngoài schema, KHÔNG viết code EJS/getvar trong content (chỉ ghi giá trị bằng ngôn ngữ tự nhiên).'
        : '';
      const categoryDirective = buildCategoryDirective(config.category, config.cardType);
      const tokenBudgetDirective = buildTokenBudgetDirective(config.tokensPerEntry);
      // Lô lớn → ép phần lớn entry "ngủ", chỉ bật theo từ khoá, cho khỏi cháy context mỗi lượt chat.
      const largeBatchDirective = buildLargeBatchBudgetDirective(config.totalEntries ?? 0);
      const messages: ChatMessage[] = [
        { role: 'system', content: BATCH_SYSTEM_PROMPT + tokenBudgetDirective + largeBatchDirective + (config.autoConfig ? AUTO_CONFIG_ADDON : '\n\nCHỈ trả về MỘT MẢNG JSON hợp lệ:\n[{"comment":"...","keys":["..."],"content":"..."},...  ]') + categoryDirective + schemaAddon + getProfileExtractionContext(profile) },
        { role: 'user', content: userMessage + '\n\n[LỆNH CUỐI CÙNG]: TUYỆT ĐỐI CHỈ TRẢ VỀ MẢNG JSON. KHÔNG markdown, KHÔNG text giải thích, KHÔNG code block. Xoá mọi format Markdown đi, chỉ xuất đúng chuẩn mảng JSON (Bắt đầu bằng `[` và kết thúc bằng `]`).' },
      ];

      return { batchIndex: i, countThisBatch, messages };
    }))).filter((t): t is NonNullable<typeof t> => t !== null);

    if (tasks.length === 0) break;

    // Execute all tasks in this round
    const results = await Promise.all(tasks.map(async (task) => {
      let result: AIGeneratedEntry[] | null = null;
      for (let attempt = 0; attempt <= config.maxRetriesPerBatch; attempt++) {
        if (ctx.stopped) return { batchIndex: task.batchIndex, entries: null };
        try {
          ctx.log(`📡 Batch ${task.batchIndex}/${totalBatches} — gọi AI${attempt > 0 ? ` (thử lại ${attempt})` : ''}...`);
          const raw = await callAI({
            profile,
            // (bugNeedFix/96) KHÔNG ép chế độ "chỉ trả JSON object": prompt ở đây đòi một
            // MẢNG entry, mà chế độ đó của provider CẤM mảng ở cấp cao nhất — model buộc phải
            // bọc lung tung hoặc trả một object, rồi tool báo "không phải JSON array" hàng loạt.
            params: { ...ctx.generationParams, useJsonResponseFormat: false },
            messages: task.messages,
            signal: ctx.signal,
          });
          result = tryExtractJsonArray(raw.text);
          if (result) break;
          // (bugNeedFix/96) Nói rõ AI đã trả về CÁI GÌ — trước đây chỉ báo "không phải JSON
          // array" nên không ai biết vì sao, cứ thử lại mù rồi bỏ batch.
          const cutOff = ['length', 'MAX_TOKENS', 'max_tokens'].includes(raw.finishReason || '');
          const peek = (raw.text || '').trim().replace(/\s+/g, ' ').slice(0, 160) || '(rỗng)';
          ctx.log(
            `⚠️ Batch ${task.batchIndex} — không đọc được JSON` +
            (cutOff ? ' (output BỊ CẮT do chạm giới hạn token — hãy giảm "số entry mỗi lô" hoặc tăng max tokens)' : '') +
            `. AI trả về: «${peek}${(raw.text || '').length > 160 ? '…' : ''}» → thử lại...`,
          );
        } catch (err) {
          // Người dùng bấm Dừng → abort: thoát ngay, KHÔNG coi là lỗi/thử lại.
          if (ctx.stopped || (err instanceof DOMException && err.name === 'AbortError')) {
            return { batchIndex: task.batchIndex, entries: null };
          }
          ctx.log(`⚠️ Batch ${task.batchIndex} — lỗi: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return { batchIndex: task.batchIndex, entries: result };
    }));

    // Process results sequentially (for dedup ordering safety)
    for (const { batchIndex, entries: result } of results) {
      if (ctx.stopped) break;

      if (!result) {
        ctx.log(`❌ Batch ${batchIndex} thất bại sau ${config.maxRetriesPerBatch + 1} lần thử.`);
        consecutiveErrors++;
        if (consecutiveErrors >= config.maxConsecutiveErrors) {
          ctx.log(`🛑 Dừng: ${config.maxConsecutiveErrors} lỗi liên tiếp.`);
          ctx.onProgress({ batch: totalBatches, totalBatches, created, total: config.totalEntries, status: 'error' });
          return;
        }
        continue;
      }
      consecutiveErrors = 0;

      let batchCreated = 0;
      for (const ai of result) {
        // 3-layer duplicate check
        const dupCheck = isDuplicateEntry(ai, ctx.card.data.character_book?.entries ?? [], ragIndex);
        if (dupCheck.isDuplicate) {
          droppedDup++;   // ghi nợ để cuối vòng nối batch bù đúng phần đã rơi
          ctx.log(`⏭️ Bỏ qua "${ai.comment}" — trùng với "${dupCheck.conflictWith}" (${dupCheck.reason})`);
          continue;
        }

        // (User 23/07 — việc 90) "Nội dung entry của các nhân vật hơi ngắn và sơ sài."
        // checkAntiSummarization chỉ dò TÍN HIỆU tóm tắt ("v.v.", "…") và so tỉ lệ với bản CŨ —
        // sinh mới thì không có bản cũ để so, nên entry 40 ký tự vẫn lọt êm, chỉ ghi một dòng
        // cảnh báo rồi vẫn nhận. Thêm SÀN TUYỆT ĐỐI: dưới sàn thì LOẠI và ghi nợ để vòng sau
        // sinh bù (dùng chung cơ chế bù với entry bị loại vì trùng).
        const minChars = config.tokensPerEntry && config.tokensPerEntry > 0
          ? Math.round(config.tokensPerEntry * 3.5 * 0.6)   // 60% ngân sách đã hứa với user
          : 200;                                            // không đặt ngân sách → sàn tối thiểu
        const contentLen = (ai.content || '').trim().length;
        if (contentLen < minChars) {
          droppedDup++;
          ctx.log(`⏭️ Bỏ qua "${ai.comment}" — nội dung quá sơ sài (${contentLen}/${minChars} ký tự), sẽ sinh bù.`);
          continue;
        }

        // Enhanced anti-summarization check
        const sumCheck = checkAntiSummarization(ai.content);
        if (sumCheck.isSummarized) {
          ctx.log(`⚠️ "${ai.comment}" có dấu hiệu tóm tắt (score: ${sumCheck.score.toFixed(2)}): ${sumCheck.warnings.join('; ')}`);
        }

        // Calculate insertion order
        const insertionOrder = config.insertionOrderMode === 'increment'
          ? config.insertionOrderStart + created
          : config.insertionOrderStart;

        const id = nextEntryId(ctx.card.data.character_book?.entries ?? []);
        const entry = materializeEntry(
          { ...ai, insertion_order: insertionOrder },
          {
            category: config.category,
            cardType: config.cardType,
            defaultPosition: config.defaultPosition,
            defaultDepth: config.defaultDepth,
            defaultRole: config.defaultRole,
            insertionOrderStart: insertionOrder,
          },
          id,
        );

        ctx.appendEntry(entry);
        ctx.card.data.character_book!.entries.push(entry);
        seen.push({ comment: entry.comment, keys: entry.keys });
        createdEntries.push({
          comment: entry.comment,
          keys: entry.keys,
          content: entry.content,
          constant: entry.constant,
          selective: entry.selective,
        });
        created++;
        batchCreated++;
        entriesSinceLastRebuild++;
        ctx.log(`✅ Batch ${batchIndex} · "${entry.comment}" (${entry.keys.join(', ')})`);
      }

      // Batch rebuild RAG index every 10 entries (spec optimization)
      if (entriesSinceLastRebuild >= 10) {
        ragIndex.indexWithSource(ctx.card.data.character_book?.entries ?? []);
        entriesSinceLastRebuild = 0;
        ctx.log(`🔄 RAG index rebuilt (${ragIndex.size} entries)`);
      }

      ctx.onProgress({ batch: batchIndex, totalBatches, created, total: config.totalEntries, status: 'running' });
      ctx.log(`📊 Batch ${batchIndex} hoàn thành: +${batchCreated} entries (tổng: ${created}/${config.totalEntries})`);
    }

    if (consecutiveErrors >= config.maxConsecutiveErrors) break;

    // (User 2026 — SÀN entry) Sắp hết batch kế hoạch mà CHƯA đạt tối thiểu (AI trả thiếu / trùng bị
    // loại) → nối thêm batch bù. Trần an toàn = 2× kế hoạch để không lặp vô hạn khi AI cạn ý.
    // Mục tiêu = SÀN user đặt, hoặc bù đúng số entry bị dedup ăn mất (không vượt trần totalEntries).
    const target = Math.min(config.totalEntries, Math.max(wantMin, created + droppedDup));
    if (target > 0 && roundStart + concurrency > totalBatches && created < target && !ctx.stopped) {
      const safetyCap = Math.max(plannedBatches * 3, plannedBatches + 6);
      const needed = Math.ceil((target - created) / config.entriesPerBatch);
      const nextTotal = Math.min(totalBatches + needed, safetyCap);
      if (nextTotal > totalBatches) {
        ctx.log(`➕ Mới ${created}/${target} entries (${droppedDup} bị loại trùng) → nối thêm ${nextTotal - totalBatches} batch bù (trần an toàn ${safetyCap}).`);
        totalBatches = nextTotal;
      } else if (created < target) {
        ctx.log(`⚠️ Đã chạm trần an toàn ${safetyCap} batch mà mới ${created}/${target} — dừng để không lặp vô hạn.`);
      }
    }
  }

  ctx.onProgress({ batch: totalBatches, totalBatches, created, total: config.totalEntries, status: ctx.stopped ? 'stopped' : 'done' });
  ctx.log(`\n🏁 Hoàn thành: ${created}/${config.totalEntries} entries đã tạo${wantMin > 0 ? ` (tối thiểu yêu cầu: ${wantMin})` : ''}.`);
}
