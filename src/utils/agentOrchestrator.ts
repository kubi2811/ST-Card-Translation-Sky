/**
 * ─── P4 Roadmap Trợ Lý AI — Sub-agent Orchestrator ───
 * Xây TRÊN NỀN AI_ACTIONS sẵn có (không đập đi xây lại): mỗi sub-agent = persona prompt riêng +
 * WHITELIST action riêng (zod validate params). Orchestrator route intent theo heuristic — không
 * chắc chắn thì về 'general' (đủ quyền như cũ, zero regression). Action ngoài whitelist / params
 * sai schema bị CHẶN trước khi thực thi — thu nhỏ blast-radius của phản hồi AI lệch chuẩn.
 */
import { z } from 'zod';
import { isRemovedRegexAction } from './aiActions';

export type AgentId = 'translator' | 'codefixer' | 'lorearchitect' | 'general';

export interface AgentDef {
  id: AgentId;
  label: string;
  /** Persona đính vào system prompt khi agent này được route. */
  personaPrompt: string;
  /** Action được phép — ngoài danh sách là CHẶN. */
  allowedActions: readonly string[];
}

// (bug 132) Nhóm action GHI regex (CREATE_REGEX/EDIT_REGEX/PATCH_REGEX_REPLACE/INJECT_FUNCTION/
// DELETE_REGEX) đã bị gỡ khỏi engine — chúng ghi vào bản GỐC trong khi tab Regex làm việc trên
// bản DỊCH, nên vừa không hiện ra vừa bị ghi đè lúc xuất thẻ. Xem chú thích ở utils/aiActions.ts.
// VIEW_FULL_REGEX (chỉ đọc) được giữ.
export const ALL_ACTIONS = [
  'CREATE_ENTRY', 'EDIT_ENTRY', 'DELETE_ENTRY', 'CREATE_TAVERN_HELPER', 'VIEW_FULL_REGEX', 'VIEW_FULL_ENTRY', 'RUN_SCRIPT',
] as const;

/** Tên action mà ENGINE thực sự cài đặt (utils/aiActions.ts). Nguồn sự thật của lớp bảo vệ. */
export type EngineAction = (typeof ALL_ACTIONS)[number];

export const AGENT_DEFS: Record<AgentId, AgentDef> = {
  translator: {
    id: 'translator',
    label: 'Translator',
    personaPrompt: '[SUB-AGENT: TRANSLATOR] Lượt này tập trung DỊCH THUẬT/VIỆT HOÁ: bám nguyên tắc bảo toàn biến hệ thống + glossary; chỉ đề xuất action sửa entry/lorebook khi user yêu cầu áp bản dịch.',
    allowedActions: ['EDIT_ENTRY', 'CREATE_ENTRY', 'VIEW_FULL_REGEX', 'VIEW_FULL_ENTRY'],
  },
  codefixer: {
    id: 'codefixer',
    label: 'CodeFixer',
    personaPrompt: '[SUB-AGENT: CODEFIXER] Lượt này tập trung SỬA CODE/REGEX/SCRIPT: chẩn đoán lỗi trước, giải thích ngắn, sửa TRIỆT ĐỂ giữ nguyên cấu trúc; code trả về phải qua được parse (không SyntaxError). Với REGEX: KHÔNG có action ghi thẳng vào thẻ — đưa code đã sửa trong code block và chỉ người dùng dán vào tab "Regex".',
    allowedActions: ['CREATE_TAVERN_HELPER', 'VIEW_FULL_REGEX', 'VIEW_FULL_ENTRY', 'RUN_SCRIPT'],
  },
  lorearchitect: {
    id: 'lorearchitect',
    label: 'LoreArchitect',
    personaPrompt: '[SUB-AGENT: LORE ARCHITECT] Lượt này tập trung XÂY LOREBOOK/CỐT TRUYỆN: brainstorm 2-3 hướng, entry mới phải bám schema/biến MVU hiện có của card, keys chọn từ khoá thực sự xuất hiện trong hội thoại.',
    allowedActions: ['CREATE_ENTRY', 'EDIT_ENTRY', 'DELETE_ENTRY', 'VIEW_FULL_REGEX', 'VIEW_FULL_ENTRY'],
  },
  general: {
    id: 'general',
    label: 'Trợ Lý',
    personaPrompt: '',
    allowedActions: ALL_ACTIONS,
  },
};

/* ─── Route intent (heuristic — mơ hồ thì về general, không đoán bừa) ─── */

const RE_CODE = /\b(regex|script|code|hàm|function|lỗi cú pháp|syntaxerror|sửa lỗi|fix|debug|javascript|\bjs\b|html|css)\b/i;
const RE_TRANSLATE = /\b(dịch|việt hoá|việt hóa|translate|翻译|bản dịch|thuật ngữ|glossary)\b/i;
const RE_LORE = /\b(lorebook|entry|world ?book|thế giới|cốt truyện|nhân vật mới|bối cảnh|tạo mục|worldinfo)\b/i;

export function routeIntent(text: string): AgentId {
  const t = text.slice(0, 600);
  // thứ tự ưu tiên: code (cụ thể nhất) > translate > lore
  if (RE_CODE.test(t)) return 'codefixer';
  if (RE_TRANSLATE.test(t)) return 'translator';
  if (RE_LORE.test(t)) return 'lorearchitect';
  return 'general';
}

/* ─── Zod schema từng action — params sai kiểu là CHẶN ─── */

const idx = z.number().int().min(0);

/**
 * ═══ (bug 236) BẢNG NÀY PHẢI ĐỦ MỌI ACTION — GIỜ LÀ LỖI BIÊN DỊCH NẾU THIẾU ═══
 *
 * User gửi ảnh: trợ lý bị chặn với "Action lạ: VIEW_FULL_ENTRY", nó xin lỗi, đổi cách viết khối
 * lệnh, gửi lại — và bị chặn y hệt. Lặp mãi.
 *
 * Gốc rễ: có HAI danh sách action phải khớp nhau mà không gì bắt chúng khớp.
 *   • `allowedActions` của từng sub-agent — VIEW_FULL_ENTRY CÓ trong cả bốn.
 *   • `ACTION_SCHEMAS` — VIEW_FULL_ENTRY KHÔNG có.
 * Cổng whitelist cho qua, xuống tới cổng schema thì `schema` là undefined ⇒ trả "Action lạ".
 * Nghĩa là VIEW_FULL_ENTRY bị chặn 100% số lần ở CẢ BỐN sub-agent, kể từ lúc lớp orchestrator ra
 * đời — cả tính năng "đọc trọn entry" của bug 166-2 chưa từng chạy được một lần nào.
 *
 * Tệ hơn cái lỗi là CÂU BÁO LỖI: "Action lạ" nói với trợ lý rằng app không biết action này, nên
 * trợ lý kết luận mình viết sai cú pháp và gửi lại đúng action đó bằng cách viết khác — vòng lặp
 * trong ảnh. Trong khi chính app lại đang IN VÀO NGỮ CẢNH câu "dùng VIEW_FULL_ENTRY với
 * entryIndex=… để đọc trọn" ở mỗi entry bị cắt. App dạy một đằng, chặn một nẻo.
 *
 * Chốt chặn để không tái diễn: kiểu `Record<EngineAction, …>` bắt buộc có ĐỦ khoá. Thêm một
 * action vào ALL_ACTIONS mà quên schema ⇒ `tsc` báo lỗi ngay, không đợi người dùng phát hiện.
 */
const ACTION_SCHEMAS: Record<EngineAction, z.ZodTypeAny> = {
  CREATE_ENTRY: z.object({ keys: z.union([z.string(), z.array(z.string())]), content: z.string().min(1) }).passthrough(),
  EDIT_ENTRY: z.object({ entryIndex: idx, field: z.string().min(1), newValue: z.any() }).passthrough(),
  DELETE_ENTRY: z.object({ entryIndex: idx }).passthrough(),
  CREATE_TAVERN_HELPER: z.object({ name: z.string().min(1), content: z.string().min(1) }).passthrough(),
  VIEW_FULL_REGEX: z.object({ scriptIndex: idx }).passthrough(),
  // Khớp đúng executeViewFullEntry: nhận entryIndex HOẶC name (tên = comment của entry), cần ít
  // nhất một trong hai. Cho phép cả hai vắng mặt là mở đường cho một lỗi khó hiểu ở tầng dưới.
  VIEW_FULL_ENTRY: z.object({ entryIndex: idx.optional(), name: z.string().min(1).optional() })
    .passthrough()
    .refine((v) => v.entryIndex !== undefined || !!v.name, {
      message: 'cần entryIndex (số) hoặc name (khớp comment của entry)',
    }),
  RUN_SCRIPT: z.object({ code: z.string().min(1) }).passthrough(),
};

/** Tham số BẮT BUỘC của từng action — nhét vào câu báo lỗi để trợ lý tự sửa được. */
const REQUIRED_PARAMS: Record<EngineAction, string> = {
  CREATE_ENTRY: 'keys (chuỗi hoặc mảng chuỗi) + content (chuỗi)',
  EDIT_ENTRY: 'entryIndex (số ≥ 0) + field (chuỗi) + newValue',
  DELETE_ENTRY: 'entryIndex (số ≥ 0)',
  CREATE_TAVERN_HELPER: 'name (chuỗi) + content (chuỗi)',
  VIEW_FULL_REGEX: 'scriptIndex (số ≥ 0)',
  VIEW_FULL_ENTRY: 'entryIndex (số ≥ 0) HOẶC name (khớp comment của entry)',
  RUN_SCRIPT: 'code (chuỗi)',
};

/** Action có được engine cài đặt không (khác với "sub-agent này có quyền dùng không"). */
export function isEngineAction(name: string): name is EngineAction {
  return (ALL_ACTIONS as readonly string[]).includes(name);
}

export interface ActionCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Kiểm action theo whitelist của agent + schema zod.
 *
 * (bug 236) CÂU BÁO LỖI PHẢI DẠY ĐƯỢC CÁCH SỬA. Bản cũ trả những câu cụt như "Action lạ: X" —
 * trợ lý đọc xong không biết phải làm gì khác ngoài gửi lại đúng thứ vừa bị chặn, nên nó lặp.
 * Nay mỗi nhánh từ chối đều kèm ĐƯỜNG ĐI TIẾP: hoặc danh sách action hợp lệ, hoặc tham số còn
 * thiếu. Ba nhánh từ chối cũng được tách bạch vì chúng là ba việc khác hẳn nhau:
 *   1. Engine KHÔNG có action này  → trợ lý bịa tên; đưa danh sách thật để nó chọn lại.
 *   2. Engine có nhưng sub-agent này không được phép → nói rõ agent nào đang chạy.
 *   3. Đúng action, sai tham số → chỉ đích danh tham số hỏng + tham số bắt buộc.
 */
export function validateAgentAction(agentId: AgentId, actionName: string, params: Record<string, any>): ActionCheck {
  const def = AGENT_DEFS[agentId] || AGENT_DEFS.general;

  // 1a. Nhóm action ghi regex ĐÃ GỠ CÓ CHỦ Ý (bug 132) — khác hẳn "engine không biết action này".
  //     Nói đúng bệnh + chỉ đường, nếu không trợ lý sẽ đi tìm cách viết khác cho một thứ đã bỏ.
  if (isRemovedRegexAction(actionName)) {
    return {
      ok: false,
      reason: `${actionName} đã được GỠ khỏi engine (nó ghi vào bản gốc trong khi tab "Regex" làm việc `
        + 'trên bản dịch, nên sửa kiểu đó vừa không hiện ra vừa bị ghi đè lúc xuất thẻ). '
        + 'Đừng tìm cách viết khác — hãy đưa đoạn regex đã sửa trong code block để người dùng tự dán vào tab "Regex".',
    };
  }

  // 1b. Không phải action của engine — đây mới đúng nghĩa "action lạ".
  if (!isEngineAction(actionName)) {
    return {
      ok: false,
      reason: `Engine không có action "${actionName}". Action hợp lệ: ${ALL_ACTIONS.join(', ')}. `
        + 'Hãy chọn một trong số đó, hoặc trả lời bằng lời thay vì dùng action.',
    };
  }

  // 2. Có thật, nhưng sub-agent đang chạy không được phép dùng.
  if (!def.allowedActions.includes(actionName)) {
    return {
      ok: false,
      reason: `Action ${actionName} nằm ngoài quyền của sub-agent "${def.label}" đang chạy lượt này `
        + `(được phép: ${def.allowedActions.join(', ')}).`,
    };
  }

  // 3. Đúng action, sai tham số.
  const parsed = ACTION_SCHEMAS[actionName].safeParse(params || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? `"${issue.path.join('.')}" ` : '';
    return {
      ok: false,
      reason: `${actionName} sai tham số: ${where}${issue?.message || 'không hợp lệ'}. `
        + `Cần: ${REQUIRED_PARAMS[actionName]}.`,
    };
  }
  return { ok: true };
}
