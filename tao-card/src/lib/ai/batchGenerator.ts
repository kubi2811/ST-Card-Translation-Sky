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
import { cascadeSearch, searchFailureReasons } from './webScraper';
import { getProfileExtractionContext } from './worldbuildingDefaults';
import { tag, allTags } from './storyToCard';
import {
  checkEntryBudget, planBatch, buildLengthDirective,
} from './tokenBudget';

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
   mạnh mẽ, tính tình lạnh lùng" là CHƯA ĐẠT — viết cho đủ chất ngay từ đầu.

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
  // Nói bằng BA cách (token / ký tự / cấu trúc) vì mô hình không tự đếm được token của chính nó.
  // (User 2026) KHÔNG kèm sàn: hễ nêu một mức tối thiểu là mô hình viết vừa chạm mốc rồi dừng bút,
  // và mỗi entry hụt lại kéo theo một lượt bắt viết lại. Xem tokenBudget.ts.
  return buildLengthDirective(tokensPerEntry ?? 0);
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
  /** (bug 191) Danh sách chủ đề ĐƯỢC GIAO từ kế hoạch chung — chia phần tất định, thay lane-modulo. */
  assignedTitles?: string[],
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

  // (bug 191) CHIA PHẦN THEO KẾ HOẠCH — cách chống trùng mạnh nhất: mỗi batch nhận một danh
  // sách chủ đề RIÊNG đã được lượt lập kế hoạch chia sẵn, không batch nào được viết ngoài phần
  // của mình → hai luồng song song không thể cùng viết một thực thể. Lane-modulo bên dưới chỉ
  // còn là lưới dự phòng khi lượt lập kế hoạch hỏng.
  if (assignedTitles && assignedTitles.length > 0) {
    parts.push(`### 📌 PHẦN VIỆC ĐƯỢC GIAO CHO BATCH NÀY (từ kế hoạch chung — BẮT BUỘC)
Kế hoạch tổng đã chia chủ đề cho từng batch để các luồng song song không giẫm nhau.
Batch này CHỈ được viết entry cho ĐÚNG các chủ đề sau, mỗi chủ đề MỘT entry:
${assignedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}
TUYỆT ĐỐI không viết chủ đề ngoài danh sách. Chủ đề nào vi phạm quy tắc của người dùng thì BỎ QUA
(không thay bằng chủ đề tự nghĩ). Tên entry (comment) đặt đúng theo chủ đề được giao.`);
  }

  // (việc 90) CHỐNG TRÙNG TỪ GỐC. Các batch trong cùng một vòng chạy SONG SONG và đều nhận
  // ngữ cảnh y hệt nhau (trạng thái thẻ TRƯỚC vòng) — không luồng nào thấy anh em đang viết gì,
  // nên ba luồng cùng chọn một nhân vật là chuyện tất nhiên. Bộ lọc trùng chỉ dọn được phần
  // ngọn (và dọn xong thì phí trắng lượt gọi API đó). Chia phần TRƯỚC bằng một quy tắc tất định
  // mà model theo được: mỗi luồng chỉ nhận các mục cách nhau đúng `lane.total` trong danh sách.
  // (bug 191) Đã có kế hoạch chia phần thì bỏ đoạn này — hai lệnh chia phần chồng nhau chỉ gây nhiễu.
  if (!assignedTitles?.length && lane && lane.total > 1) {
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

/**
 * (bug 134) Phản hồi này có dấu hiệu BỊ CẮT GIỮA CHỪNG không — đo bằng chính cấu trúc văn bản.
 * Không thể chỉ trông vào `finishReason`: rất nhiều provider (nhất là khi đi qua proxy) không
 * trả trường đó, nên tool im lặng thử lại y nguyên và lỗi lặp mãi đúng như user gặp.
 */
export function looksTruncated(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  let inStr = false, esc = false, depth = 0;
  for (const c of t) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return inStr || depth > 0;
}

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
    if (end === -1) {
      // (bug 134) Object CUỐI bị cụt. Bản cũ `break` bỏ luôn — mà khi lô chỉ có 1-2 entry
      // content dài (bảng phả hệ, danh sách kỹ năng…) thì entry cụt ĐÓ chính là toàn bộ lô,
      // nên cả batch thành "không đọc được JSON". Thử VÁ ĐUÔI: đóng chuỗi/ngoặc còn hở rồi
      // parse lại; phần chữ đã nhận được vẫn là nội dung thật của entry.
      const tail = closeTruncatedObject(text.slice(i));
      if (tail) {
        try {
          const obj = JSON.parse(tail);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj as Record<string, unknown>);
        } catch { /* vá không cứu được — chịu */ }
      }
      break;
    }
    try {
      const obj = JSON.parse(text.substring(i, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj as Record<string, unknown>);
    } catch { /* object hỏng — bỏ qua */ }
    i = end + 1;
  }
  return out;
}

/**
 * (bug 134) Vá một object JSON bị cắt giữa chừng thành object đóng kín:
 * cắt bỏ phần đuôi dở dang (khoá viết dở, dấu phẩy treo), đóng chuỗi đang mở, rồi đóng đủ
 * `}`/`]`. Trả null khi không còn gì đáng cứu.
 */
function closeTruncatedObject(src: string): string | null {
  let body = src;

  // 1. Đuôi kết thúc bằng dấu escape lẻ (`…\`) thì bỏ đi — nếu không, đóng nháy vào sẽ biến
  //    nó thành `\"` và chuỗi lại hở tiếp.
  const trailingSlashes = body.match(/\\+$/)?.[0].length ?? 0;
  if (trailingSlashes % 2 === 1) body = body.slice(0, -1);

  // 2. Quét trạng thái: đang trong chuỗi? còn ngoặc nào hở?
  let inStr = false, esc = false;
  const closers: string[] = [];
  for (const c of body) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') closers.push('}');
    else if (c === '[') closers.push(']');
    else if (c === '}' || c === ']') closers.pop();
  }
  if (closers.length === 0) return null;   // không có gì hở → không phải ca bị cắt

  // 3. Chuỗi đang mở thì ĐÓNG LẠI, giữ trọn phần chữ đã nhận được. Đây là điểm mấu chốt:
  //    chỗ bị cắt gần như luôn nằm giữa `content` — mà content chính là thứ đáng cứu nhất.
  //    Ký tự điều khiển thô (xuống dòng thật) trong chuỗi làm JSON.parse trượt, nên escape lại.
  if (inStr) {
    const q = body.lastIndexOf('"');
    const head = body.slice(0, q + 1);
    const tail = body.slice(q + 1)
      .replace(/[ -]/g, (m) => (m === '\n' ? '\\n' : m === '\t' ? '\\t' : m === '\r' ? '\\r' : ''));
    body = head + tail + '"';
  } else {
    // 4. Không ở trong chuỗi: bỏ phần đuôi dở dang — dấu phẩy treo, khoá chưa có giá trị,
    //    hoặc token viết dở (`tru`, `12.`).
    body = body
      .replace(/,\s*$/, '')
      .replace(/,?\s*"[^"]*"\s*:\s*$/, '')
      .replace(/,?\s*"[^"]*"\s*$/, '')
      .replace(/:\s*[A-Za-z0-9.+-]*$/, (m) => (/:\s*(true|false|null|-?\d+(\.\d+)?)$/.test(m) ? m : ''))
      .replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  }
  if (!/[:{]/.test(body)) return null;   // chẳng còn cặp khoá-giá trị nào thì thôi

  return body + closers.reverse().join('');
}

/**
 * (bug 134) NHÃN và TỪ KHOÁ suy được thì đừng vứt cả lô.
 *
 * User báo Auto Creator liên tục "Batch X — không đọc được JSON", log cho thấy AI trả về
 * `[{ "keys": [...], "content": "<System>…"` — JSON HỢP LỆ nhưng entry thiếu `comment`.
 * Luật cũ đòi đủ CẢ BA (comment + keys + content) mới nhận, thiếu một là loại; loại hết thì
 * validateEntries trả null và cả batch bị coi như "không đọc được JSON" rồi thử lại — thử lại
 * cũng ra y hệt, nên vòng lặp lỗi kéo dài đúng như user mô tả.
 *
 * Thứ THẬT SỰ đáng giá của một entry là `content` — nhãn và từ khoá suy lại được:
 *   • comment ← name/title/entryName → keys[0] → dòng đầu của content
 *   • keys    ← comment (tách cụm) — thà có key thô còn hơn mất nguyên entry
 * Vẫn giữ đủ chặt để không bắt nhầm object linh tinh: `content` phải là chuỗi có thực chất.
 */
const MIN_CONTENT_CHARS = 20;

function deriveComment(e: Record<string, unknown>): string {
  for (const k of ['comment', 'name', 'title', 'entryName', 'entry_name', 'label']) {
    const v = e[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  const keys = Array.isArray(e.keys) ? e.keys.filter(x => typeof x === 'string' && x.trim()) : [];
  if (keys.length) return String(keys[0]).trim().slice(0, 120);
  // Dòng đầu content, bỏ ký tự trang trí markdown/tag mở đầu.
  const first = String(e.content ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '';
  const cleaned = first
    .replace(/^[<[#*\-•\s]+/, '')          // bullet/heading/thẻ mở đầu
    .replace(/[>\]*_\s]+$/, '')             // đuôi trang trí: **, __, >, ]
    .replace(/[:：]\s*$/, '')
    .trim();
  return cleaned.slice(0, 120) || 'Entry không tên';
}

function deriveKeys(e: Record<string, unknown>, comment: string): string[] {
  const raw = Array.isArray(e.keys) ? e.keys
    : typeof e.keys === 'string' ? String(e.keys).split(',')
    : [];
  const keys = raw.map(k => String(k).trim()).filter(Boolean);
  if (keys.length) return keys;
  // Không có key nào: dùng chính nhãn entry. Entry sẽ kích hoạt theo tên nó — thô nhưng dùng
  // được, và người dùng sửa được trong Lorebook; mất hẳn entry thì không sửa được gì.
  return comment ? [comment] : [];
}

function validateEntries(arr: unknown[]): AIGeneratedEntry[] | null {
  const valid: AIGeneratedEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.content !== 'string' || e.content.trim().length < MIN_CONTENT_CHARS) continue;
    const comment = deriveComment(e);
    const keys = deriveKeys(e, comment);
    if (!comment || keys.length === 0) continue;
    valid.push({
      comment,
      keys,
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

// ═══════════════════════════════════════════════════════════════════════════
// (bug 191) LƯỢT LẬP KẾ HOẠCH CHỦ ĐỀ — chống trùng TỪ GỐC cho batch song song
// ═══════════════════════════════════════════════════════════════════════════

/** Bóc danh sách tiêu đề từ output lượt lập kế hoạch (tag <t> chuẩn; rớt tag thì đọc theo dòng). */
export function parsePlannedTitles(text: string): string[] {
  const block = tag(text, 'titles') || text;
  let titles = allTags(block, 't').map(s => s.trim()).filter(Boolean);
  if (titles.length === 0) {
    titles = block.split('\n')
      .map(s => s.replace(/^[\s\d.\-•+*)]+/, '').trim())
      .filter(s => s.length > 1 && s.length <= 120 && !s.startsWith('<'));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    const k = t.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * MỘT lượt AI (model phụ nếu có — việc máy móc) lập DANH SÁCH TIÊU ĐỀ entry cho cả kế hoạch,
 * để vòng chạy chia phần cho từng batch. Vì sao đáng một lượt gọi: các batch song song không
 * nhìn thấy nhau, cùng nhận ngữ cảnh y hệt → cùng chọn thực thể "nổi bật nhất" là tất nhiên;
 * bộ lọc trùng chỉ dọn phần ngọn và mỗi entry bị loại là một phần lượt gọi phí trắng. Chia đề
 * TRƯỚC thì trùng không thể xảy ra theo thiết kế, và danh sách còn giúp entry "tuân theo thiết
 * lập" hơn (đúng category, đúng chủ đề user yêu cầu, né thứ user cấm ngay từ kế hoạch).
 */
async function planEntryTitles(
  config: BatchGenConfig,
  ctx: BatchRunContext,
  profile: ProxyProfile,
): Promise<string[]> {
  const spare = Math.ceil(config.totalEntries * 0.25); // dư 25% để bù entry bị loại/sơ sài
  const want = Math.min(400, config.totalEntries + spare);
  const catLabel = config.category && config.category !== 'custom'
    ? ENTRY_CATEGORY_LABELS[config.category]?.label ?? '' : '';
  const existing = (ctx.card.data.character_book?.entries ?? []).map(e => e.comment).filter(Boolean);
  const sys = `Bạn là kiến trúc sư Lorebook cho SillyTavern. Nhiệm vụ DUY NHẤT: lập DANH SÁCH TIÊU ĐỀ entry (chưa viết nội dung) cho kế hoạch sinh lorebook.
QUY TẮC:
1. Đúng ${want} tiêu đề, mỗi tiêu đề là MỘT thực thể/chủ đề riêng biệt, cụ thể (tên riêng khi có thể), KHÔNG trùng nhau, KHÔNG trùng danh sách "Entry đã có".
2. ${catLabel ? `Mọi tiêu đề phải thuộc đúng loại nội dung: ${catLabel}.` : 'Bám sát yêu cầu nội dung của người dùng.'}
3. Phủ RỘNG và ĐỀU: từ thực thể trung tâm tới chi tiết phụ, không dồn hết vào vài chủ đề nổi bật nhất.
4. Tiêu đề bằng cùng ngôn ngữ với thẻ (thẻ tiếng Việt → tiêu đề tiếng Việt), ngắn gọn (≤ 60 ký tự).
${config.userRules?.trim() ? `5. QUY TẮC BẮT BUỘC từ người dùng (thắng mọi điều trên): ${config.userRules.trim()} — chủ đề vi phạm thì KHÔNG đưa vào danh sách.` : ''}
CHỈ xuất đúng khối sau, không viết gì ngoài:
<titles>
<t>tiêu đề 1</t>
<t>tiêu đề 2</t>
…
</titles>`;
  const userParts: string[] = [];
  if (config.useCardContext) {
    userParts.push(`### Ngữ cảnh thẻ\nTên: ${ctx.card.data.name}\n${ctx.card.data.description.slice(0, 800)}`);
  }
  if (config.schemaContext) userParts.push(`### Schema biến (MVUZOD)\n${config.schemaContext.slice(0, 1500)}`);
  userParts.push(`### Yêu cầu nội dung\n${config.topicPrompt}`);
  if (existing.length) userParts.push(`### Entry đã có (KHÔNG lập lại)\n${existing.map(t => `- ${t}`).join('\n')}`);
  userParts.push(`Hãy lập đúng ${want} tiêu đề.`);
  const raw = await callAI({
    profile,
    params: { ...ctx.generationParams, useJsonResponseFormat: false },
    messages: [{ role: 'system', content: sys }, { role: 'user', content: userParts.join('\n\n') }],
    signal: ctx.signal,
    useSecondary: true,
  });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const existingSet = new Set(existing.map(norm));
  return parsePlannedTitles(raw.text).filter(t => !existingSet.has(norm(t))).slice(0, want);
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
  // (bug 194-3 / 196) CỠ LÔ VÀ max_tokens PHẢI SUY TỪ NGÂN SÁCH, không để một con số cố định
  // trong Settings quyết định hộ. Lô chạm trần output thì mô hình KHÔNG cắt, KHÔNG cảnh báo — nó
  // TỰ NÉN mỗi entry cho vừa chỗ. Đó là kiểu hỏng im lặng, và là lý do "luôn chỉ ra một nửa".
  // Với 3000-5000 token/entry (bug 196) thì một lô 6 entry cần ~30.000 token, gấp bảy lần trần
  // mặc định 4096 — không đời nào ra đủ nếu không rút lô và nâng trần.
  const budgetPlan = planBatch(
    config.tokensPerEntry ?? 0,
    config.entriesPerBatch,
    Math.max(ctx.generationParams.max_tokens || 0, 8192),
  );
  if (config.tokensPerEntry && config.tokensPerEntry > 0) {
    if (budgetPlan.reduced) {
      ctx.log(
        `📐 Ngân sách ${config.tokensPerEntry} token/entry → rút lô từ ${config.entriesPerBatch} xuống ` +
        `${budgetPlan.entriesPerBatch} entry và nâng trần output lên ${budgetPlan.maxTokens} token. ` +
        `Nhồi cả lô vào một lời gọi thì AI tự nén cho vừa, entry nào cũng ngắn.`,
      );
    }
    config = { ...config, entriesPerBatch: budgetPlan.entriesPerBatch };
  }
  let totalBatches = Math.ceil(config.totalEntries / config.entriesPerBatch);
  const plannedBatches = totalBatches;
  const wantMin = Math.max(0, Math.min(config.minEntries ?? 0, config.totalEntries));
  // #11 — Số luồng song song = tổng ngân sách RPM toàn pool (mỗi provider × key × RPM chính+phụ).
  // RPM limiter (chốt-giờ-bắt-đầu) ở client.ts đảm bảo không vượt trần 429 dù luồng cao.
  // (bug 191) "Số batch song song" của user TRƯỚC ĐÂY BỊ BỎ QUA hoàn toàn ở đây — đặt 2 hay 24
  // đều chạy theo ngân sách pool, tức thiết lập là đồ trang trí. Nay nó là TRẦN user tự đặt
  // (đặt thấp khi muốn entry mạch lạc nối tiếp nhau, đặt cao để chạy nhanh); trần thực tế vẫn
  // không vượt ngân sách RPM của pool.
  const userCap = config.concurrentBatches && config.concurrentBatches > 0
    ? config.concurrentBatches : Number.POSITIVE_INFINITY;
  const concurrency = Math.max(1, Math.min(computePoolConcurrency(ctx.profile), totalBatches, userCap));
  let created = 0;
  // (bug 71) Entry bị dedup loại trước đây MẤT TRẮNG: số batch cố định nên không sinh bù,
  // kế hoạch 20 entry thực tế còn 6-10. Nay đếm để nối batch bù đúng phần đã rơi.
  let droppedDup = 0;
  // (bug 194) Đo token THẬT của những entry đã nhận, để báo cho user con số thay vì lời hứa.
  let tokenSum = 0, tokenCount = 0;
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

  // (bug 191) LẬP KẾ HOẠCH TIÊU ĐỀ trước khi sinh — mỗi batch nhận phần đề riêng, các luồng
  // song song không thể cùng viết một thực thể. Kế hoạch hỏng thì rơi về lane-modulo như cũ.
  let pendingTitles: string[] = [];
  if (totalBatches > 1 && !ctx.stopped) {
    try {
      ctx.log('🧭 Lập kế hoạch chủ đề (1 lượt AI) để chia phần cho các batch — chống trùng từ gốc...');
      pendingTitles = await planEntryTitles(config, ctx, profile);
      if (pendingTitles.length > 0) {
        ctx.log(`🧭 Kế hoạch: ${pendingTitles.length} chủ đề. Ví dụ: ${pendingTitles.slice(0, 5).join(' · ')}${pendingTitles.length > 5 ? ' …' : ''}`);
      } else {
        ctx.log('⚠️ Lượt lập kế hoạch không ra chủ đề nào — dùng cách chia phần dự phòng (đánh số theo luồng).');
      }
    } catch (err) {
      if (ctx.stopped || (err instanceof DOMException && err.name === 'AbortError')) {
        ctx.onProgress({ batch: 0, totalBatches, created, total: config.totalEntries, status: 'stopped' });
        return;
      }
      ctx.log(`⚠️ Lập kế hoạch lỗi (${err instanceof Error ? err.message : String(err)}) — dùng cách chia phần dự phòng.`);
    }
  }

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
      // (bug 191) Nhận phần đề từ kế hoạch chung — splice chạy ĐỒNG BỘ (trước await đầu tiên
      // của callback) nên các batch trong vòng không giành trùng đề của nhau.
      const assignedTitles = pendingTitles.length > 0 ? pendingTitles.splice(0, countThisBatch) : undefined;

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
            // (bug 191) Nói rõ VÌ SAO không có kết quả — "không tìm thấy" và "mọi đường fetch
            // đều bị chặn CORS" là hai chuyện khác hẳn nhau, user cần biết mình đang gặp cái nào.
            const why = searchFailureReasons();
            ctx.log(`⚠️ [Batch ${i}] Web Search: Không tìm thấy dữ liệu liên quan (đã thử cả query nới rộng).`
              + (why.length ? ` Đường fetch cuối: ${why.slice(0, 4).join(' · ')}` : ''));
          }
        } catch (webErr) {
          ctx.log(`⚠️ [Batch ${i}] Web Search lỗi: ${webErr instanceof Error ? webErr.message : String(webErr)}`);
        }
      }

      const userMessage = buildBatchUserMessage(config, ctx.card, seen, ragCtx.injectionText, coherenceCtx, webInjection, countThisBatch, i, totalBatches, createdEntries,
        { index: i - roundStart + 1, total: batchIndices.length }, assignedTitles);
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

      return { batchIndex: i, countThisBatch, messages, assignedTitles };
    }))).filter((t): t is NonNullable<typeof t> => t !== null);

    if (tasks.length === 0) break;

    // Execute all tasks in this round
    const results = await Promise.all(tasks.map(async (task) => {
      let result: AIGeneratedEntry[] | null = null;
      // (bug 134) Lô bị cắt vì quá dài mà thử lại Y NGUYÊN thì lần nào cũng cắt — đúng cảnh
      // "lỗi liên tục". Mỗi lần thử lại vì bị cắt sẽ HẠ số entry của lô xuống một nửa.
      let askCount = task.countThisBatch;
      let messages = task.messages;
      for (let attempt = 0; attempt <= config.maxRetriesPerBatch; attempt++) {
        if (ctx.stopped) return { batchIndex: task.batchIndex, entries: null };
        try {
          ctx.log(`📡 Batch ${task.batchIndex}/${totalBatches} — gọi AI${attempt > 0 ? ` (thử lại ${attempt}${askCount !== task.countThisBatch ? `, rút còn ${askCount} entry` : ''})` : ''}...`);
          const raw = await callAI({
            profile,
            // (bugNeedFix/96) KHÔNG ép chế độ "chỉ trả JSON object": prompt ở đây đòi một
            // MẢNG entry, mà chế độ đó của provider CẤM mảng ở cấp cao nhất — model buộc phải
            // bọc lung tung hoặc trả một object, rồi tool báo "không phải JSON array" hàng loạt.
            params: {
              ...ctx.generationParams,
              // (bug 194) Trần output đi theo ngân sách của lô này, không dùng con số chung.
              max_tokens: Math.max(ctx.generationParams.max_tokens || 0, budgetPlan.maxTokens),
              useJsonResponseFormat: false,
            },
            messages,
            signal: ctx.signal,
          });
          result = tryExtractJsonArray(raw.text);
          if (result) break;
          // (bugNeedFix/96) Nói rõ AI đã trả về CÁI GÌ — trước đây chỉ báo "không phải JSON
          // array" nên không ai biết vì sao, cứ thử lại mù rồi bỏ batch.
          // (bug 134) Nhận diện "bị cắt" bằng CẤU TRÚC nữa, không chỉ finishReason — nhiều
          // provider không trả trường đó nên trước giờ luôn báo nhầm thành "JSON sai".
          const cutOff = ['length', 'MAX_TOKENS', 'max_tokens'].includes(raw.finishReason || '')
            || looksTruncated(raw.text);
          const peek = (raw.text || '').trim().replace(/\s+/g, ' ').slice(0, 160) || '(rỗng)';
          ctx.log(
            `⚠️ Batch ${task.batchIndex} — không đọc được JSON` +
            (cutOff ? ' (output BỊ CẮT giữa chừng — output dài quá giới hạn token của model)' : '') +
            `. AI trả về: «${peek}${(raw.text || '').length > 160 ? '…' : ''}» → thử lại...`,
          );
          if (cutOff && askCount > 1) {
            const next = Math.max(1, Math.floor(askCount / 2));
            // Sửa TRỰC TIẾP con số trong lời nhắc: prompt tự nó nêu "hãy tạo N entry".
            messages = messages.map((m, i) => i === messages.length - 1
              ? { ...m, content: `${m.content}\n\n[ĐIỀU CHỈNH]: Lần trước output bị cắt vì quá dài. Lần này CHỈ tạo ${next} entry (thay vì ${askCount}), nội dung vẫn đủ chất nhưng gọn hơn.` }
              : m);
            askCount = next;
          }
        } catch (err) {
          // Người dùng bấm Dừng → abort: thoát ngay, KHÔNG coi là lỗi/thử lại.
          if (ctx.stopped || (err instanceof DOMException && err.name === 'AbortError')) {
            return { batchIndex: task.batchIndex, entries: null };
          }
          ctx.log(`⚠️ Batch ${task.batchIndex} — lỗi: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return { batchIndex: task.batchIndex, entries: result, assignedTitles: task.assignedTitles };
    }));

    // Process results sequentially (for dedup ordering safety)
    for (const { batchIndex, entries: result, assignedTitles } of results) {
      if (ctx.stopped) break;

      if (!result) {
        // (bug 191) Batch hỏng thì TRẢ phần đề được giao về pool — batch bù sau này nhận lại,
        // không thì các chủ đề đó biến mất khỏi kế hoạch trong im lặng.
        if (assignedTitles?.length) pendingTitles.push(...assignedTitles);
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
        // (User 2026) SÀN ĐỘ DÀI ĐÃ BỊ BỎ. Bản trước loại thẳng entry dưới 45% ngân sách và bắt
        // AI viết lại tối đa 2 lượt cho entry dưới 85% — cộng lại thành đúng cái vòng lặp user
        // than: mỗi entry hụt đẻ thêm vài lời gọi AI, mà bản thân cái sàn lại dạy mô hình viết
        // vừa chạm mốc rồi dừng. Nay ngân sách chỉ là ĐỊNH HƯỚNG trong lời nhắc; ở đây chỉ ĐO để
        // báo cáo cho user, không entry nào bị loại hay bị bắt viết lại vì ngắn.
        if (config.tokensPerEntry && config.tokensPerEntry > 0) {
          const chk = checkEntryBudget(ai.content || '', config.tokensPerEntry);
          tokenSum += chk.actual; tokenCount++;
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
  // (bug 194) Báo con số ĐO ĐƯỢC, không phải lời hứa. Trước đây tool không hề đếm token thật, nên
  // chuyện "luôn chỉ ra một nửa" là vô hình với chính nó — user phải tự phát hiện rồi đi báo bug.
  if (tokenCount > 0 && config.tokensPerEntry) {
    const avg = Math.round(tokenSum / tokenCount);
    const pct = Math.round((avg / config.tokensPerEntry) * 100);
    ctx.log(
      `📏 Độ dài THỰC ĐO: trung bình ${avg} token/entry so với ngân sách ${config.tokensPerEntry} (${pct}%).`
      + (pct < 70
        ? ' Ngắn hơn ngân sách khá nhiều — thủ phạm thường là trần output của model: nâng trần trong Cài đặt, hoặc giảm số entry mỗi lô rồi chạy lại.'
        : ''),
    );
  }
}
