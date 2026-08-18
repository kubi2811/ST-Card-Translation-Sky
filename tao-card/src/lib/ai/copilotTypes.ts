/**
 * src/lib/ai/copilotTypes.ts — AI Copilot Type Definitions
 * Spec Phần 9.2-9.6: Tool definitions, AI actions, response types, modes
 */

import type { ChatAttachment } from '../../types/aiAgent.types';

// (bug 236, gốc rễ) File này KHÔNG còn tự định nghĩa action/mode/response nữa — nó chỉ mở lại cửa
// cho code trong `lib/ai` khỏi phải đổi đường import. Nguồn duy nhất nằm ở `types/aiAgent.types.ts`.
export type { AIAction, AIActionType, AIActionPayloads, AIResponse, WorldbuildingMode } from '../../types/aiAgent.types';
export { AI_ACTION_TYPES, normalizeActionType } from '../../types/aiAgent.types';
import type { AIAction, WorldbuildingMode } from '../../types/aiAgent.types';

export const MODE_LABELS: Record<WorldbuildingMode, { label: string; description: string; icon: string }> = {
  genesis:              { label: 'Genesis',      description: 'Tạo cấu trúc mới từ đầu',        icon: '🌱' },
  evolution:            { label: 'Evolution',    description: 'Mở rộng entries hiện có',          icon: '🔄' },
  document_extraction:  { label: 'Doc Extract',  description: 'Trích xuất từ tài liệu',          icon: '📄' },
  discussion:           { label: 'Discussion',   description: 'Trò chuyện tự do',                icon: '💬' },
  mvuzod:               { label: 'MVUZOD',       description: 'Quản lý biến & schema',           icon: '⚙️' },
  regex:                { label: 'Regex',        description: 'Tạo/sửa regex scripts',           icon: '🔧' },
  game_dev:             { label: 'Game Dev',     description: 'Tạo game UI components',           icon: '🎮' },
};

// ═══════════════════════════════════════════════════════════════════════════
// COPILOT CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export interface CopilotMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: ChatAttachment[];
  timestamp: number;
  status?: 'pending' | 'success' | 'error';
  actions?: AIAction[];
  thought?: string;
}

export interface ActionDecision {
  action: AIAction;
  status: 'pending' | 'applied' | 'skipped';
}
