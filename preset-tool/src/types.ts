export interface PromptBlock {
  identifier: string;
  name: string;
  system_prompt: boolean;
  role: 'system' | 'user' | 'assistant';
  content?: string;
  enabled: boolean;
  injection_position: number;
  injection_depth: number;
  injection_order: number;
  forbid_overrides: boolean;
  injection_trigger?: string[];
  marker?: boolean;
}

export interface SillyTavernPreset {
  temperature: number;
  frequency_penalty: number;
  presence_penalty: number;
  top_p: number;
  top_k: number;
  top_a: number;
  min_p: number;
  repetition_penalty: number;
  openai_max_context: number;
  openai_max_tokens: number;
  wrap_in_quotes: boolean;
  names_behavior: number;
  send_if_empty: string;
  impersonation_prompt: string;
  new_chat_prompt: string;
  new_group_chat_prompt: string;
  new_example_chat_prompt: string;
  continue_nudge_prompt: string;
  bias_preset_selected: string;
  max_context_unlocked: boolean;
  wi_format: string;
  scenario_format: string;
  personality_format: string;
  group_nudge_prompt: string;
  stream_openai: boolean;
  prompts: PromptBlock[];
}

export interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: number;
  minDepth: number | null;
  maxDepth: number | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isLoading?: boolean;
  extractedJSONs?: {
    type: 'preset' | 'prompt' | 'prompts' | 'regex' | 'unknown';
    data: unknown;
    name: string;
  }[];
}

/** Provider PHỤ (xoay vòng cùng provider chính) — chỉ field nhận diện provider. */
export interface ExtraProvider {
  enabled: boolean;
  useProxy: boolean;
  apiKey: string;
  proxyUrl: string;
  proxyKey: string;
  selectedModel: string;
}

export interface APISettings {
  useProxy: boolean;
  apiKey: string;
  proxyUrl: string;
  proxyKey: string;
  selectedModel: string;
  temperature: number;
  maxTokens: number;
  keepContext: boolean;
  systemPromptAddition: string;
  customModels: string[];
  // Đa provider: rải call round-robin cùng provider chính (mỗi lượt chat đổi provider → rải
  // rate-limit qua nhiều account). Chat tuần tự nên chỉ tăng sức chứa, không tăng tốc song song.
  extraProviders?: ExtraProvider[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  preset: SillyTavernPreset;
  regexes: RegexScript[];
}

export type WorkspaceStep = 'parameters' | 'prompts' | 'template' | 'regex' | 'export';
export type AppMode = 'preset' | 'regex';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export type ActionType =
  | 'prompt_added'
  | 'prompt_updated'
  | 'prompt_deleted'
  | 'regex_added'
  | 'regex_updated'
  | 'regex_deleted'
  | 'params_updated';

export interface ActionLogEntry {
  id: string;
  type: ActionType;
  timestamp: number;
  itemName: string;
  itemId: string;
  details?: string;
}
