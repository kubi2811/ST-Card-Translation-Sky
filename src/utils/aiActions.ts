// ═══════════════════════════════════════════════════════════════════════════════
// AI Actions Engine — Parse & Execute structured actions from AI responses
// ═══════════════════════════════════════════════════════════════════════════════

import type { CharacterCard, CharacterBookEntry, TavernHelperScript } from '../types/card';
import { injectCustomTavernHelperScript } from './mvuGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType =
  | 'CREATE_ENTRY'
  | 'EDIT_ENTRY'
  | 'DELETE_ENTRY'
  | 'CREATE_TAVERN_HELPER'
  | 'VIEW_FULL_REGEX'
  | 'RUN_SCRIPT';

/**
 * ═══ (bug 132) NHÓM ACTION GHI REGEX ĐÃ BỊ GỠ ═══
 * User: "Lệnh <AI_ACTION> import/chỉnh sửa nội dung regex trong Trợ lý A.I không hoạt động.
 * Đề xuất nên xoá bỏ luôn lệnh này."
 *
 * Đúng — và lý do nó không bao giờ chạy đúng là LỖI THIẾT KẾ chứ không phải lỗi vặt sửa được:
 * trong app này regex có HAI nguồn sự thật khác nhau.
 *   • `card.data.extensions.regex_scripts` — bản GỐC của thẻ.
 *   • `fields` (group 'regex') — bản DỊCH, là thứ tab "Regex" hiển thị và là thứ được ghi
 *     ngược vào thẻ lúc xuất file (applyTranslationsToCard).
 * Các action này ghi vào NHÁNH THỨ NHẤT. Hệ quả: người dùng bấm xác nhận, tool báo "đã sửa",
 * nhưng tab Regex không đổi một chữ (nó đọc `fields`) — và đến lúc xuất thì `fields` ghi đè
 * lên đúng chỗ vừa sửa, xoá sạch việc AI vừa làm. Tức là action vừa VÔ HÌNH vừa BỊ MẤT.
 *
 * Sửa cho "chạy" nghĩa là phải cho AI ghi song song vào cả hai nhánh và giữ ánh xạ index khớp
 * qua mọi thao tác thêm/xoá script — rủi ro hỏng dữ liệu cao hơn nhiều so với lợi ích, trong
 * khi tab "Regex" đã có sẵn đủ đồ nghề (dịch lại từng dòng, AI Quét & Sửa, áp vào thẻ).
 * Nên: gỡ hẳn, và khi model cũ vẫn trả về các action này thì BÁO RÕ + chỉ đường, không im lặng.
 *
 * VIEW_FULL_REGEX được GIỮ: nó chỉ ĐỌC, không đụng vào thẻ, và giúp AI đọc trọn replaceString
 * để tư vấn/nêu code cho người dùng tự dán.
 */
export const REMOVED_REGEX_ACTIONS = [
  'CREATE_REGEX', 'EDIT_REGEX', 'PATCH_REGEX_REPLACE', 'DELETE_REGEX', 'INJECT_FUNCTION',
] as const;

export function isRemovedRegexAction(name: string): boolean {
  return (REMOVED_REGEX_ACTIONS as readonly string[]).includes(name);
}

export interface AiAction {
  action: ActionType;
  params: Record<string, any>;
  reasoning?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  newCard?: CharacterCard;
  /** For VIEW_FULL_REGEX — content to feed back to AI */
  viewContent?: string;
  /** For RUN_SCRIPT — script code that needs user confirmation before execution */
  pendingScript?: {
    code: string;
    language: string;
    description: string;
  };
}

export interface ParsedResponse {
  /** Text content for chat display (with action blocks stripped) */
  textContent: string;
  /** Extracted actions to execute */
  actions: AiAction[];
}

// ─── Parse AI Actions from Response ───────────────────────────────────────────

const ACTION_BLOCK_RE = /<AI_ACTION>\s*([\s\S]*?)\s*<\/AI_ACTION>/gi;

/**
 * Parse structured action blocks from an AI response string.
 *
 * AI embeds actions in `<AI_ACTION>{ ... }</AI_ACTION>` blocks.
 * Everything outside those blocks is returned as `textContent` for display.
 */
export function parseAiActions(response: string): ParsedResponse {
  const actions: AiAction[] = [];
  const removed: string[] = [];
  let textContent = response;

  // Extract all action blocks
  let match: RegExpExecArray | null;
  const regex = new RegExp(ACTION_BLOCK_RE.source, ACTION_BLOCK_RE.flags);

  while ((match = regex.exec(response)) !== null) {
    const rawJson = match[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed.action === 'string') {
        // (bug 132) Action ghi regex đã bị gỡ — KHÔNG đẩy vào hàng thực thi, nhưng cũng KHÔNG
        // nuốt im lặng: gom lại để báo cho người dùng biết AI vừa định làm gì và làm ở đâu.
        if (isRemovedRegexAction(parsed.action)) {
          removed.push(parsed.action);
          continue;
        }
        actions.push({
          action: parsed.action as ActionType,
          params: parsed.params || {},
          reasoning: parsed.reasoning,
        });
      }
    } catch (err) {
      console.warn('[aiActions] Failed to parse action block:', rawJson, err);
    }
  }

  // Strip action blocks from display text
  textContent = response.replace(ACTION_BLOCK_RE, '').trim();

  // Clean up multiple consecutive newlines left by removal
  textContent = textContent.replace(/\n{3,}/g, '\n\n');

  // (bug 132) Nói thẳng thay vì để người dùng ngồi chờ một thay đổi không bao giờ tới.
  if (removed.length > 0) {
    const uniq = [...new Set(removed)];
    textContent += `\n\n> ⚠️ Trợ lý vừa định dùng ${uniq.join(', ')} để ghi thẳng vào regex của thẻ. ` +
      `Nhóm lệnh này **đã được gỡ** vì nó ghi vào bản gốc trong khi tab **Regex** làm việc trên bản dịch — ` +
      `sửa kiểu đó vừa không hiện ra, vừa bị ghi đè lúc xuất thẻ.\n` +
      `> Cách làm đúng: mở tab **Regex**, chọn script rồi dùng **Dịch lại** / **AI Quét & Sửa**, ` +
      `hoặc chép đoạn code trợ lý đưa ở trên vào ô nội dung của script.`;
  }

  return { textContent, actions };
}

// ─── Execute Actions ──────────────────────────────────────────────────────────

/**
 * Execute a single AI action against the card.
 * Returns a new card (immutable update) on success.
 */
export function executeAction(
  action: AiAction,
  card: CharacterCard,
): ActionResult {
  try {
    switch (action.action) {
      case 'CREATE_ENTRY':
        return executeCreateEntry(action.params, card);
      case 'EDIT_ENTRY':
        return executeEditEntry(action.params, card);
      case 'DELETE_ENTRY':
        return executeDeleteEntry(action.params, card);
      case 'CREATE_TAVERN_HELPER':
        return executeCreateTavernHelper(action.params, card);
      case 'VIEW_FULL_REGEX':
        return executeViewFullRegex(action.params, card);
      case 'RUN_SCRIPT':
        return executeRunScript(action.params);
      default:
        // (bug 132) Chốt chặn cuối: dù lọt qua đường nào thì cũng không được ghi vào regex.
        if (isRemovedRegexAction(action.action)) {
          return {
            success: false,
            message: `${action.action} đã được gỡ — sửa regex ở tab "Regex" (Dịch lại / AI Quét & Sửa), ` +
              'vì tab đó làm việc trên bản dịch, còn action này ghi vào bản gốc rồi bị ghi đè lúc xuất thẻ.',
          };
        }
        return { success: false, message: `Action không xác định: ${action.action}` };
    }
  } catch (err: any) {
    return { success: false, message: `Lỗi thực thi ${action.action}: ${err.message}` };
  }
}

// ─── Action Implementations ───────────────────────────────────────────────────

function ensureCardStructure(card: CharacterCard): CharacterCard {
  const c = JSON.parse(JSON.stringify(card)) as CharacterCard;
  if (!c.data) c.data = {};
  if (!c.data.extensions) c.data.extensions = {};
  if (!c.data.character_book) c.data.character_book = { entries: [] };
  if (!Array.isArray(c.data.character_book.entries)) c.data.character_book.entries = [];
  if (!Array.isArray(c.data.extensions.regex_scripts)) c.data.extensions.regex_scripts = [];
  return c;
}

/** CREATE_ENTRY — Create a new lorebook entry */
function executeCreateEntry(params: Record<string, any>, card: CharacterCard): ActionResult {
  const { keys, comment, content, position, constant, name, secondary_keys, enabled, insertion_order } = params;
  if (!content && !keys) {
    return { success: false, message: 'CREATE_ENTRY cần ít nhất keys hoặc content' };
  }

  const c = ensureCardStructure(card);

  const newEntry: CharacterBookEntry = {
    id: Date.now(),
    keys: Array.isArray(keys) ? keys : (typeof keys === 'string' ? keys.split(',').map((k: string) => k.trim()).filter(Boolean) : []),
    secondary_keys: Array.isArray(secondary_keys) ? secondary_keys : [],
    comment: comment || 'Tạo từ Trợ lý AI',
    content: content || '',
    name: name || '',
    enabled: enabled !== false,
    insertion_order: insertion_order ?? 10,
    position: position || 'before_char',
    constant: constant ?? false,
    selective: true,
  };

  c.data!.character_book!.entries.push(newEntry);

  return {
    success: true,
    message: `Đã tạo Lorebook entry "${newEntry.comment}" với ${newEntry.keys.length} keys`,
    newCard: c,
  };
}

/** EDIT_ENTRY — Edit an existing lorebook entry */
function executeEditEntry(params: Record<string, any>, card: CharacterCard): ActionResult {
  const { entryIndex, field, newValue } = params;
  if (entryIndex === undefined || !field) {
    return { success: false, message: 'EDIT_ENTRY cần entryIndex và field' };
  }

  const c = ensureCardStructure(card);
  const entries = c.data!.character_book!.entries;

  if (entryIndex < 0 || entryIndex >= entries.length) {
    return { success: false, message: `Entry index ${entryIndex} không hợp lệ (có ${entries.length} entries)` };
  }

  const entry = entries[entryIndex];
  const oldValue = (entry as any)[field];

  if (field === 'keys' || field === 'secondary_keys') {
    (entry as any)[field] = Array.isArray(newValue) ? newValue : String(newValue).split(',').map((k: string) => k.trim());
  } else {
    (entry as any)[field] = newValue;
  }

  return {
    success: true,
    message: `Đã sửa lorebook[${entryIndex}].${field} (${typeof oldValue === 'string' ? oldValue.slice(0, 30) : '...'} → ${typeof newValue === 'string' ? newValue.slice(0, 30) : '...'})`,
    newCard: c,
  };
}

/** DELETE_ENTRY — Delete a lorebook entry */
function executeDeleteEntry(params: Record<string, any>, card: CharacterCard): ActionResult {
  const { entryIndex } = params;
  if (entryIndex === undefined) {
    return { success: false, message: 'DELETE_ENTRY cần entryIndex' };
  }

  const c = ensureCardStructure(card);
  const entries = c.data!.character_book!.entries;

  if (entryIndex < 0 || entryIndex >= entries.length) {
    return { success: false, message: `Entry index ${entryIndex} không hợp lệ` };
  }

  const removed = entries.splice(entryIndex, 1)[0];
  return {
    success: true,
    message: `Đã xóa lorebook entry "${removed.comment || removed.name || `#${entryIndex}`}"`,
    newCard: c,
  };
}

/** CREATE_TAVERN_HELPER — Create a new TavernHelper script */
function executeCreateTavernHelper(params: Record<string, any>, card: CharacterCard): ActionResult {
  const { name, content, info } = params;
  if (!content) {
    return { success: false, message: 'CREATE_TAVERN_HELPER cần content' };
  }

  const c = ensureCardStructure(card);

  const newScript: TavernHelperScript = {
    name: name || 'Script mới từ AI',
    content,
    enabled: true,
    info: info || 'Tạo bởi Trợ lý AI',
  };

  if (!c.data!.extensions) c.data!.extensions = {};
  injectCustomTavernHelperScript(c.data!.extensions, newScript);

  return {
    success: true,
    message: `Đã tạo TavernHelper script "${newScript.name}"`,
    newCard: c,
  };
}

/** VIEW_FULL_REGEX — Return full replaceString content for AI to analyze */
function executeViewFullRegex(params: Record<string, any>, card: CharacterCard): ActionResult {
  const { scriptIndex } = params;
  if (scriptIndex === undefined) {
    return { success: false, message: 'VIEW_FULL_REGEX cần scriptIndex' };
  }

  const scripts = card.data?.extensions?.regex_scripts || [];
  if (scriptIndex < 0 || scriptIndex >= scripts.length) {
    return { success: false, message: `Script index ${scriptIndex} không hợp lệ` };
  }

  const script = scripts[scriptIndex];
  const fullContent = [
    `=== REGEX SCRIPT #${scriptIndex}: "${script.scriptName}" ===`,
    `findRegex: ${script.findRegex}`,
    `disabled: ${script.disabled}`,
    `placement: ${JSON.stringify(script.placement)}`,
    `markdownOnly: ${script.markdownOnly}`,
    `promptOnly: ${script.promptOnly}`,
    `runOnEdit: ${script.runOnEdit}`,
    `substituteRegex: ${script.substituteRegex}`,
    `--- replaceString (full, ${(script.replaceString || '').length} chars) ---`,
    script.replaceString || '(empty)',
    `--- trimStrings ---`,
    JSON.stringify(script.trimStrings || []),
  ].join('\n');

  return {
    success: true,
    message: `Đã lấy full nội dung regex[${scriptIndex}]`,
    viewContent: fullContent,
  };
}

/** RUN_SCRIPT — Return script for user confirmation before execution */
function executeRunScript(params: Record<string, any>): ActionResult {
  const { code, language, description } = params;
  if (!code) {
    return { success: false, message: 'RUN_SCRIPT cần code' };
  }

  return {
    success: true,
    message: `Script "${description || 'AI Script'}" đang chờ xác nhận từ người dùng`,
    pendingScript: {
      code,
      language: language || 'javascript',
      description: description || 'Script được tạo bởi AI',
    },
  };
}

/**
 * Generate a human-readable summary of an action for the confirmation UI.
 */
export function describeAction(action: AiAction): {
  title: string;
  type: 'create' | 'edit' | 'delete' | 'view' | 'run';
  color: string;
  icon: string;
  details: string[];
} {
  switch (action.action) {
    case 'CREATE_ENTRY':
      return {
        title: 'Tạo Lorebook Entry',
        type: 'create',
        color: '#6366f1',
        icon: '📖',
        details: [
          `Keys: ${(action.params.keys || []).join(', ')}`,
          `Comment: ${action.params.comment || '(mặc định)'}`,
          `Content: ${(action.params.content || '').slice(0, 100)}${(action.params.content || '').length > 100 ? '...' : ''}`,
        ],
      };
    case 'DELETE_ENTRY':
      return {
        title: `Xóa Entry #${action.params.entryIndex}`,
        type: 'delete',
        color: '#ef4444',
        icon: '🗑️',
        details: [],
      };
    case 'EDIT_ENTRY':
      return {
        title: `Sửa Entry #${action.params.entryIndex}`,
        type: 'edit',
        color: '#f59e0b',
        icon: '✏️',
        details: [
          `Trường: ${action.params.field}`,
        ],
      };
    case 'CREATE_TAVERN_HELPER':
      return {
        title: 'Tạo TavernHelper Script',
        type: 'create',
        color: '#10b981',
        icon: '⚙️',
        details: [
          `Tên: ${action.params.name || 'Script mới'}`,
        ],
      };
    case 'VIEW_FULL_REGEX':
      return {
        title: `Xem full Regex #${action.params.scriptIndex}`,
        type: 'view',
        color: '#3b82f6',
        icon: '👁',
        details: [],
      };
    case 'RUN_SCRIPT':
      return {
        title: 'Chạy Script',
        type: 'run',
        color: '#ef4444',
        icon: '▶️',
        details: [
          `Ngôn ngữ: ${action.params.language || 'javascript'}`,
          `Mô tả: ${action.params.description || 'Script từ AI'}`,
        ],
      };
    default:
      return {
        title: action.action,
        type: 'view',
        color: '#6b7280',
        icon: '❓',
        details: [],
      };
  }
}
