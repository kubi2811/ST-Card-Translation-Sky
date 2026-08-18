/**
 * AI Agent types — spec Phần 3A (Client-Agent Loop)
 * + modeRegex.ts (mode regex) + spec 9C (CreateTavernScriptAction)
 */

import type { LorebookEntry, LorebookEntryExt } from './lorebook.types';
import type { RegexScript } from './regex.types';
import type { TavernHelperScript } from './tavernHelper.types';

// ═══════════════════════════════════════════════════════════════════════════
// AI ACTIONS — MỘT DANH SÁCH DUY NHẤT
// ═══════════════════════════════════════════════════════════════════════════
/**
 * (bug 236, gốc rễ) Trước đây có BA danh sách action sống song song:
 *   1. union `AIAction` ở file này — 11 action, payload dẹt (`target_comment` nằm ngoài `data`);
 *   2. union `AIAction` ở `lib/ai/copilotTypes.ts` — 15 action, payload lồng trong `data`;
 *   3. một CHUỖI liệt kê trong `copilotPrompts.ts` — 11 tên, thiếu 4 cái tool thật sự chạy được.
 *
 * Cùng tên `AIAction`, khác hình dạng: `update_entry` bản 1 là `{target_comment, data}`, bản 2 là
 * `{data:{id, patch}}`. Danh sách (3) mới là thứ AI thực sự đọc, nên AI không bao giờ biết nó có
 * `create_tavern_script`/`generate_game_ui`, còn khi nó tự nghĩ ra một tên ngoài danh sách thì
 * không lớp nào bắt được — đó chính là ca "action lạ VIEW_FULL_ENTRY" của bug 236.
 *
 * Nay chỉ còn MỘT nguồn: bản đồ payload dưới đây. Tên action là `keyof` bản đồ đó, mảng runtime
 * `AI_ACTION_TYPES` bị `satisfies` chặn không cho chứa tên lạ, và lời nhắc gửi cho AI được SINH RA
 * từ chính mảng ấy (`buildActionListForPrompt`) — không còn chỗ nào để chép tay cho lệch nữa.
 */
export interface AIActionPayloads {
  /** Tạo entry lorebook mới. */
  create_entry: AIGeneratedEntry;
  /** Vá một entry đã có theo id. */
  update_entry: { id: number; patch: Partial<LorebookEntry & LorebookEntryExt> };
  /** Xoá entry theo id (`comment` chỉ để hiển thị lại cho người dùng xác nhận). */
  delete_entry: { id: number; comment?: string };
  /** Ghi thẳng vào một trường của thẻ theo đường dẫn (vd `data.description`). */
  update_field: { path: string; value: unknown };
  /** Thêm regex script. */
  add_regex_script: Omit<RegexScript, 'id'>;
  /** Vá regex script đã có. */
  update_regex_script: { id: string; patch: Partial<RegexScript> };
  /** Xoá regex script. */
  delete_regex_script: { id: string };
  /** Nhờ client tải một trang wiki/fandom rồi đưa nội dung về lượt sau. */
  fetch_fandom_data: { url: string };
  /** Xin mảnh tiếp theo của tài liệu đang đọc. */
  read_document: { chunk_index: number };
  /** Đặt một biến TavernHelper. */
  set_variable: { key: string; value: unknown };
  /** Tạo TavernHelper script — spec 9C Bước 5 (MVU import + registerMvuSchema). */
  create_tavern_script: Omit<TavernHelperScript, 'id'>;
  /** Sinh một mảnh giao diện game (HTML/CSS/script). */
  generate_game_ui: { component: string; html: string; css: string; script: string };
  /** Chưa xong việc, xin thêm một lượt nữa. */
  continue_signal: { reason: string };
  /** Ghi nhớ dài hạn — KHÔNG áp lên thẻ, xem cách xử lý ở agentLoop. */
  save_memory: { scope: 'global' | 'project' | 'session'; key: string; value: string };
  /** Gọi một tool đã đăng ký trong toolsEngine. */
  tool_call: { tool: string; args: Record<string, unknown> };
}

export type AIActionType = keyof AIActionPayloads;

export type AIAction = {
  [K in AIActionType]: { type: K; data: AIActionPayloads[K] };
}[AIActionType];

/** Danh sách runtime — thứ tự này cũng là thứ tự đọc trong lời nhắc. */
export const AI_ACTION_TYPES = [
  'create_entry', 'update_entry', 'delete_entry', 'update_field',
  'add_regex_script', 'update_regex_script', 'delete_regex_script',
  'fetch_fandom_data', 'read_document', 'set_variable',
  'create_tavern_script', 'generate_game_ui', 'continue_signal',
  'save_memory', 'tool_call',
] as const satisfies readonly AIActionType[];

/**
 * Thêm action vào `AIActionPayloads` mà quên khai vào `AI_ACTION_TYPES` thì dòng dưới KHÔNG biên
 * dịch được — lời nhắc sinh ra từ mảng đó, thiếu tên là AI không bao giờ biết tool ấy tồn tại.
 */
export type ActionTypesAreComplete =
  Exclude<AIActionType, (typeof AI_ACTION_TYPES)[number]> extends never
    ? true
    : ['THIẾU trong AI_ACTION_TYPES:', Exclude<AIActionType, (typeof AI_ACTION_TYPES)[number]>];
export const ACTION_TYPES_ARE_COMPLETE: ActionTypesAreComplete = true;

/**
 * Tên cũ mà lời nhắc đời trước từng dạy, và model vẫn còn nhại lại. Quy về tên chuẩn ở MỘT chỗ
 * (`normalizeActionType`) thay vì rải `case 'add_regex': case 'add_regex_script':` khắp nơi.
 */
const LEGACY_ACTION_ALIASES: Record<string, AIActionType> = {
  add_regex: 'add_regex_script',
  update_regex: 'update_regex_script',
  delete_regex: 'delete_regex_script',
};

/** Trả về tên chuẩn, hoặc null nếu đây là action không tồn tại. */
export function normalizeActionType(raw: string): AIActionType | null {
  const t = String(raw ?? '').trim();
  if ((AI_ACTION_TYPES as readonly string[]).includes(t)) return t as AIActionType;
  return LEGACY_ACTION_ALIASES[t] ?? null;
}

// ========== AI RESPONSE ==========

export interface AIResponse {
  thought?: string;   // Tư duy nội bộ — hiển thị dạng ThoughtBubble thu gọn
  message: string;    // Lời thoại trả lời người dùng (markdown OK)
  status: 'CONTINUE' | 'DONE';
  actions: AIAction[];
  /**
   * (bug 236) Tên action AI phát ra mà KHÔNG có thật — do bộ đọc JSON lọc bỏ, không phải model gửi.
   * Trước đây action lạ lọt xuống tận `executeAction`, không khớp case nào nên im lặng không làm gì,
   * trong khi vòng lặp vẫn báo với AI là "applied successfully" → AI tin là xong, không thấy kết quả,
   * hỏi lại → lặp vô tận. Nay lọc ở cửa vào và nói thật một lần cho AI biết tên nào không tồn tại.
   */
  droppedActionTypes?: string[];
}

// ========== AI GENERATED ENTRY (Batch) ==========

/**
 * (Tawa 2.0) THAM SỐ ST NÂNG CAO mà AI được phép đề xuất.
 *
 * Tách riêng khỏi `AIGeneratedEntry` vì hai đường dùng chung: batch sinh entry MỚI, và refiner
 * vá config entry ĐÃ CÓ (`EntryConfigPatch`). Mọi giá trị đều đi qua `advancedExtFromAi()` để kẹp
 * miền trước khi vào thẻ — xem lý do ở đó.
 */
export interface AdvancedEntryHints {
  /** Logic ghép keys: 0=AND ANY (mặc định), 1=NOT ALL, 2=NOT ANY, 3=AND ALL. */
  selectiveLogic?: 0 | 1 | 2 | 3;
  /** Chỉ khớp trọn từ. Với tiếng Việt nên true — key "nam" đang bắt trúng cả "việt nam". */
  match_whole_words?: boolean | null;
  /** Phân biệt hoa thường. Gần như luôn là false/null. */
  case_sensitive?: boolean | null;
  /** Tìm theo ngữ nghĩa thay vì khớp chữ. */
  vectorized?: boolean;
  /** Dính lại thêm N lượt sau khi kích hoạt (trạng thái cảnh/sự kiện đang diễn ra). */
  sticky?: number;
  /** Hết dính thì nghỉ N lượt mới được kích hoạt lại (sự kiện không nên lặp). */
  cooldown?: number;
  /** Thấy từ khoá rồi vẫn chờ N lượt mới nạp. */
  delay?: number;
  /** Thẻ VIP: ép nạp kể cả khi ngân sách World Info đã cạn. Dùng RẤT hạn chế. */
  ignore_budget?: boolean;
  /** Xác suất nạp (0-100) — dùng cho sự kiện ngẫu nhiên. */
  probability?: number;
  /** Tên nhóm loại trừ: các entry cùng group chỉ một cái được chọn mỗi lượt. */
  group?: string;
  /** Trọng số bốc thăm trong group (mặc định 100). */
  group_weight?: number;
}

export interface AIGeneratedEntry extends AdvancedEntryHints {
  comment: string;         // BẮT BUỘC — tên/nhãn entry
  keys: string[];          // BẮT BUỘC — 2-6 từ khoá kích hoạt
  secondary_keys?: string[];
  content: string;         // BẮT BUỘC — nội dung thuần túy ngôi thứ ba
  constant?: boolean;      // default false
  selective?: boolean;     // default true
  insertion_order?: number;
  // ── AI Auto-Config per entry ──
  position?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;  // vị trí inject trong prompt
  depth?: number;                                // depth cho position=4 (@depth)
  role?: 0 | 1 | 2 | null;                      // 0=system, 1=user, 2=assistant
  scan_depth?: number | null;                    // quét bao nhiêu tin nhắn
  category_hint?: string;                        // gợi ý loại entry (worldview, npc, scene...)
  // Tham số ST nâng cao: xem AdvancedEntryHints ở trên.
}

// ========== WORLDBUILDING MODES ==========

/**
 * (bug 236, gốc rễ) Union này từng có SÁU mode, còn bản trong `copilotTypes.ts` có BẢY — cùng tên,
 * khác nội dung. `chatStore` dùng bản sáu nên không lưu nổi phiên `game_dev`. Nay chỉ còn một bản;
 * hai bảng nhãn bên dưới khai kiểu `Record<WorldbuildingMode, …>` nên thêm mode mới là tsc bắt
 * phải điền đủ cả hai.
 */
export type WorldbuildingMode =
  | 'genesis'
  | 'evolution'
  | 'document_extraction'
  | 'discussion'
  | 'mvuzod'
  | 'regex'
  | 'game_dev';

export const WORLDBUILDING_MODE_LABELS: Record<WorldbuildingMode, string> = {
  genesis: '🌱 Khởi Tạo',
  evolution: '🔄 Mở Rộng',
  document_extraction: '📄 Trích Xuất Tài Liệu',
  discussion: '💬 Thảo Luận',
  mvuzod: '🛠 MVUZOD',
  regex: '🧩 Regex Lab',
  game_dev: '🎮 Game Dev',
};

export const WORLDBUILDING_MODE_DESCRIPTIONS: Record<WorldbuildingMode, string> = {
  genesis: 'Tạo mới từ ý tưởng sơ khai',
  evolution: 'Chỉnh sửa, mở rộng, cào Wiki',
  document_extraction: 'Đọc file .txt, tạo Lorebook',
  discussion: 'Hỏi đáp, lên ý tưởng',
  mvuzod: 'Tạo Zod schema + JSON Patch scripts',
  regex: 'Tạo/sửa Regex Scripts',
  game_dev: 'Tạo giao diện game (HTML/CSS/script)',
};

// ========== CHAT MESSAGE ==========

export interface ChatAttachment {
  type: 'image' | 'file';
  mimeType: string;
  name: string;
  data: string; // Base64 cho ảnh, hoặc Text thuần cho file
  previewUrl?: string; // Dùng cho UI
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: ChatAttachment[];
}
