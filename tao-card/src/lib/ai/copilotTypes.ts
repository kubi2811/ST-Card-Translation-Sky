/**
 * src/lib/ai/copilotTypes.ts — AI Copilot Type Definitions
 * Spec Phần 9.2-9.6: Tool definitions, AI actions, response types, modes
 */

import type { ChatAttachment } from '../../types/aiAgent.types';

export type WorldbuildingMode = 'genesis' | 'evolution' | 'document_extraction' | 'discussion' | 'mvuzod' | 'regex' | 'game_dev';

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
// AI ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export type AIAction =
  | { type: 'create_entry'; data: { comment: string; keys: string[]; content: string; [k: string]: unknown } }
  | { type: 'update_entry'; data: { id: number; patch: Record<string, unknown> } }
  | { type: 'delete_entry'; data: { id: number; comment?: string } }
  | { type: 'update_field'; data: { path: string; value: unknown } }
  | { type: 'add_regex_script'; data: Record<string, unknown> }
  | { type: 'update_regex_script'; data: { id: string; patch: Record<string, unknown> } }
  | { type: 'delete_regex_script'; data: { id: string } }
  | { type: 'fetch_fandom_data'; data: { url: string } }
  | { type: 'read_document'; data: { chunk_index: number } }
  | { type: 'set_variable'; data: { key: string; value: unknown } }
  | { type: 'create_tavern_script'; data: { name: string; code: string; type: 'schema' | 'event' | 'ui' | 'init' } }
  | { type: 'generate_game_ui'; data: { component: string; html: string; css: string; script: string } }
  | { type: 'continue_signal'; data: { reason: string } }
  | { type: 'save_memory'; data: { scope: 'global' | 'project' | 'session'; key: string; value: string } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, unknown> } };

export interface AIResponse {
  thought?: string;
  message: string;
  status: 'CONTINUE' | 'DONE';
  actions: AIAction[];
}

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
