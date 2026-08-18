/**
 * AI Agent types — spec Phần 3A (Client-Agent Loop)
 * + modeRegex.ts (mode regex) + spec 9C (CreateTavernScriptAction)
 */

import type { LorebookEntry, LorebookEntryExt } from './lorebook.types';
import type { RegexScript } from './regex.types';
import type { TavernHelperScript } from './tavernHelper.types';

// ========== AI RESPONSE ==========

export interface AIResponse {
  thought: string;    // Tư duy nội bộ — hiển thị dạng ThoughtBubble thu gọn
  message: string;    // Lời thoại trả lời người dùng (markdown OK)
  status: 'CONTINUE' | 'DONE';
  actions: AIAction[];
}

// ========== AI ACTIONS ==========

export type AIAction =
  | CreateEntryAction
  | UpdateEntryAction
  | DeleteEntryAction
  | UpdateFieldAction
  | AddRegexAction
  | UpdateRegexAction
  | DeleteRegexAction
  | FetchFandomAction
  | ReadDocumentAction
  | SetVariableAction
  | CreateTavernScriptAction;

export interface CreateEntryAction {
  type: 'create_entry';
  data: AIGeneratedEntry;
}

export interface UpdateEntryAction {
  type: 'update_entry';
  target_comment: string;
  data: Partial<LorebookEntry & LorebookEntryExt>;
}

export interface DeleteEntryAction {
  type: 'delete_entry';
  target_comment: string;
}

export interface UpdateFieldAction {
  type: 'update_field';
  path: string;
  value: string | number | boolean | string[];
}

export interface AddRegexAction {
  type: 'add_regex';
  data: Omit<RegexScript, 'id'>;
}

export interface UpdateRegexAction {
  type: 'update_regex';
  id: string;
  patch: Partial<RegexScript>;
}

export interface DeleteRegexAction {
  type: 'delete_regex';
  id: string;
}

export interface FetchFandomAction {
  type: 'fetch_fandom_data';
  url: string;
}

export interface ReadDocumentAction {
  type: 'read_document';
  chunk_index: number;
}

export interface SetVariableAction {
  type: 'set_variable';
  key: string;
  value: unknown;
}

/** Tạo TavernHelper script — spec 9C Bước 5 (MVU import + registerMvuSchema) */
export interface CreateTavernScriptAction {
  type: 'create_tavern_script';
  data: Omit<TavernHelperScript, 'id'>;
}

// ========== AI GENERATED ENTRY (Batch) ==========

export interface AIGeneratedEntry {
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
}

// ========== WORLDBUILDING MODES ==========

export type WorldbuildingMode =
  | 'genesis'
  | 'evolution'
  | 'document_extraction'
  | 'discussion'
  | 'mvuzod'
  | 'regex';

export const WORLDBUILDING_MODE_LABELS: Record<WorldbuildingMode, string> = {
  genesis: '🌱 Khởi Tạo',
  evolution: '🔄 Mở Rộng',
  document_extraction: '📄 Trích Xuất Tài Liệu',
  discussion: '💬 Thảo Luận',
  mvuzod: '🛠 MVUZOD',
  regex: '🧩 Regex Lab',
};

export const WORLDBUILDING_MODE_DESCRIPTIONS: Record<WorldbuildingMode, string> = {
  genesis: 'Tạo mới từ ý tưởng sơ khai',
  evolution: 'Chỉnh sửa, mở rộng, cào Wiki',
  document_extraction: 'Đọc file .txt, tạo Lorebook',
  discussion: 'Hỏi đáp, lên ý tưởng',
  mvuzod: 'Tạo Zod schema + JSON Patch scripts',
  regex: 'Tạo/sửa Regex Scripts',
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
  // Tham số ST nâng cao: xem AdvancedEntryHints ở trên.
/**
 * (bug 236, gốc rễ) Union này từng có SÁU mode, còn bản trong `copilotTypes.ts` có BẢY — cùng tên,
 * khác nội dung. `chatStore` dùng bản sáu nên không lưu nổi phiên `game_dev`. Nay chỉ còn một bản;
 * hai bảng nhãn bên dưới khai kiểu `Record<WorldbuildingMode, …>` nên thêm mode mới là tsc bắt
 * phải điền đủ cả hai.
 */
