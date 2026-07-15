/**
 * ─── P4 Roadmap Trợ Lý AI — Sub-agent Orchestrator ───
 * Xây TRÊN NỀN AI_ACTIONS sẵn có (không đập đi xây lại): mỗi sub-agent = persona prompt riêng +
 * WHITELIST action riêng (zod validate params). Orchestrator route intent theo heuristic — không
 * chắc chắn thì về 'general' (đủ quyền như cũ, zero regression). Action ngoài whitelist / params
 * sai schema bị CHẶN trước khi thực thi — thu nhỏ blast-radius của phản hồi AI lệch chuẩn.
 */
import { z } from 'zod';

export type AgentId = 'translator' | 'codefixer' | 'lorearchitect' | 'general';

export interface AgentDef {
  id: AgentId;
  label: string;
  /** Persona đính vào system prompt khi agent này được route. */
  personaPrompt: string;
  /** Action được phép — ngoài danh sách là CHẶN. */
  allowedActions: readonly string[];
}

const ALL_ACTIONS = [
  'CREATE_REGEX', 'EDIT_REGEX', 'PATCH_REGEX_REPLACE', 'INJECT_FUNCTION', 'DELETE_REGEX',
  'CREATE_ENTRY', 'EDIT_ENTRY', 'DELETE_ENTRY', 'CREATE_TAVERN_HELPER', 'VIEW_FULL_REGEX', 'RUN_SCRIPT',
] as const;

export const AGENT_DEFS: Record<AgentId, AgentDef> = {
  translator: {
    id: 'translator',
    label: 'Translator',
    personaPrompt: '[SUB-AGENT: TRANSLATOR] Lượt này tập trung DỊCH THUẬT/VIỆT HOÁ: bám nguyên tắc bảo toàn biến hệ thống + glossary; chỉ đề xuất action sửa entry/lorebook khi user yêu cầu áp bản dịch.',
    allowedActions: ['EDIT_ENTRY', 'CREATE_ENTRY', 'VIEW_FULL_REGEX'],
  },
  codefixer: {
    id: 'codefixer',
    label: 'CodeFixer',
    personaPrompt: '[SUB-AGENT: CODEFIXER] Lượt này tập trung SỬA CODE/REGEX/SCRIPT: chẩn đoán lỗi trước, giải thích ngắn, sửa TRIỆT ĐỂ giữ nguyên cấu trúc; code trả về phải qua được parse (không SyntaxError).',
    allowedActions: ['CREATE_REGEX', 'EDIT_REGEX', 'PATCH_REGEX_REPLACE', 'INJECT_FUNCTION', 'DELETE_REGEX', 'CREATE_TAVERN_HELPER', 'VIEW_FULL_REGEX', 'RUN_SCRIPT'],
  },
  lorearchitect: {
    id: 'lorearchitect',
    label: 'LoreArchitect',
    personaPrompt: '[SUB-AGENT: LORE ARCHITECT] Lượt này tập trung XÂY LOREBOOK/CỐT TRUYỆN: brainstorm 2-3 hướng, entry mới phải bám schema/biến MVU hiện có của card, keys chọn từ khoá thực sự xuất hiện trong hội thoại.',
    allowedActions: ['CREATE_ENTRY', 'EDIT_ENTRY', 'DELETE_ENTRY', 'VIEW_FULL_REGEX'],
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
const ACTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  CREATE_REGEX: z.object({ scriptName: z.string().min(1), findRegex: z.string(), replaceString: z.string() }).passthrough(),
  EDIT_REGEX: z.object({ scriptIndex: idx, field: z.string().min(1), newValue: z.any() }).passthrough(),
  PATCH_REGEX_REPLACE: z.object({ scriptIndex: idx }).passthrough()
    .refine(p => 'find' in p || 'appendToEnd' in p || 'prependToStart' in p, { message: 'cần find/appendToEnd/prependToStart' }),
  INJECT_FUNCTION: z.object({ scriptIndex: idx, functionCode: z.string().min(1) }).passthrough(),
  DELETE_REGEX: z.object({ scriptIndex: idx }).passthrough(),
  CREATE_ENTRY: z.object({ keys: z.union([z.string(), z.array(z.string())]), content: z.string().min(1) }).passthrough(),
  EDIT_ENTRY: z.object({ entryIndex: idx, field: z.string().min(1), newValue: z.any() }).passthrough(),
  DELETE_ENTRY: z.object({ entryIndex: idx }).passthrough(),
  CREATE_TAVERN_HELPER: z.object({ name: z.string().min(1), content: z.string().min(1) }).passthrough(),
  VIEW_FULL_REGEX: z.object({ scriptIndex: idx }).passthrough(),
  RUN_SCRIPT: z.object({ code: z.string().min(1) }).passthrough(),
};

export interface ActionCheck {
  ok: boolean;
  reason?: string;
}

/** Kiểm action theo whitelist của agent + schema zod. */
export function validateAgentAction(agentId: AgentId, actionName: string, params: Record<string, any>): ActionCheck {
  const def = AGENT_DEFS[agentId] || AGENT_DEFS.general;
  if (!def.allowedActions.includes(actionName)) {
    return { ok: false, reason: `Action ${actionName} ngoài phạm vi sub-agent ${def.label} (whitelist: ${def.allowedActions.join(', ')})` };
  }
  const schema = ACTION_SCHEMAS[actionName];
  if (!schema) return { ok: false, reason: `Action lạ: ${actionName}` };
  const parsed = schema.safeParse(params || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `Params ${actionName} sai schema: ${issue?.path?.join('.') || ''} ${issue?.message || ''}`.trim() };
  }
  return { ok: true };
}
