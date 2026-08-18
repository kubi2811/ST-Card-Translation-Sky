/**
 * src/lib/ai/jsonExtract.ts — Parse AI response JSON with fallback
 * Spec Phần 9.6: Extract JSON from AI responses (fenced, raw, or plain text)
 */

import type { AIResponse } from './copilotTypes';
import { AI_ACTION_TYPES, normalizeActionType } from '../../types/aiAgent.types';

/**
 * Parse AI response into structured AIResponse.
 * Tries in order: direct JSON, fenced JSON, regex JSON object, plain text fallback.
 */
export function parseAIResponseJSON(raw: string): AIResponse {
  const trimmed = raw.trim();

  // 1. Direct JSON parse
  try { return validateResponse(JSON.parse(trimmed)); } catch { /* continue */ }

  // 2. Fenced JSON (```json ... ```)
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) {
    try { return validateResponse(JSON.parse(fence[1].trim())); } catch { /* continue */ }
  }

  // 3. Extract JSON object from raw text
  const objMatch = trimmed.match(/\{[\s\S]+\}/);
  if (objMatch) {
    try { return validateResponse(JSON.parse(objMatch[0])); } catch { /* continue */ }
  }

  // 4. Fallback: treat as plain text message
  return {
    thought: '',
    message: raw,
    status: 'DONE',
    actions: [],
  };
}

function validateResponse(obj: unknown): AIResponse {
  if (typeof obj !== 'object' || obj === null) throw new Error('Not an object');
  const resp = obj as Record<string, unknown>;
  return {
    thought: typeof resp.thought === 'string' ? resp.thought : '',
    message: typeof resp.message === 'string' ? resp.message : '',
    status: resp.status === 'CONTINUE' ? 'CONTINUE' : 'DONE',
    ...splitActions(resp.actions),
  };
}

/**
 * (bug 236) CỬA VÀO DUY NHẤT của mọi action do AI phát ra — nên cũng là chỗ duy nhất chặn tên lạ.
 * Tên cũ (`add_regex`…) được quy về tên chuẩn; tên không tồn tại bị loại ra và ghi lại để vòng lặp
 * nói thật với AI, thay vì để nó rơi xuống executeAction rồi im lặng không làm gì.
 */
function splitActions(raw: unknown): Pick<AIResponse, 'actions' | 'droppedActionTypes'> {
  if (!Array.isArray(raw)) return { actions: [] };
  const actions: AIResponse['actions'] = [];
  const dropped: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    if (typeof a.type !== 'string') continue;
    const type = normalizeActionType(a.type);
    if (!type) { dropped.push(a.type); continue; }
    actions.push({ type, data: (a.data ?? {}) as never } as AIResponse['actions'][0]);
  }
  return dropped.length ? { actions, droppedActionTypes: dropped } : { actions };
}

/** Danh sách tên hợp lệ, để chỗ báo lỗi khỏi chép tay lần nữa. */
export const VALID_ACTION_TYPES = AI_ACTION_TYPES;
