/* ─── SillyTavern Character Card Types ─── */

export interface CharacterBookEntry {
  id?: number;
  keys: string[];
  secondary_keys?: string[];
  comment: string;
  content: string;
  name?: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order?: number;
  enabled?: boolean;
  position?: string;
  use_regex?: boolean;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: CharacterBookEntry[];
  [key: string]: unknown;
}

export interface RegexScript {
  id?: string | number;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings?: string[];
  placement?: string[];
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: boolean;
  minDepth?: number;
  maxDepth?: number;
  [key: string]: unknown;
}

export interface TavernHelperScript {
  name?: string;
  content: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface DepthPrompt {
  prompt: string;
  depth?: number;
  role?: string;
  [key: string]: unknown;
}

export interface CardExtensions {
  depth_prompt?: DepthPrompt;
  regex_scripts?: RegexScript[];
  world?: string;
  tavern_helper?: { scripts?: TavernHelperScript[]; [key: string]: unknown };
  TavernHelper_scripts?: TavernHelperScript[];
  cm_manager?: unknown;
  [key: string]: unknown;
}

export interface CardData {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  system_prompts?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  group_only_greetings?: string[];
  character_book?: CharacterBook;
  extensions?: CardExtensions;
  tags?: string[];
  creator?: string;
  character_version?: string;
  [key: string]: unknown;
}

export interface CharacterCard {
  // Root level fields
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creatorcomment?: string;
  avatar?: string;
  spec?: string;
  spec_version?: string;
  create_date?: string;
  talkativeness?: string | number;
  fav?: boolean | string;
  tags?: string[];
  data?: CardData;
  [key: string]: unknown;
}

/* ─── Translation Types ─── */

export type TranslationStatus = 'pending' | 'translating' | 'done' | 'error' | 'skipped' | 'ignored';

export interface TranslationField {
  /** Unique path, e.g. "data.character_book.entries[2].content" */
  path: string;
  /** Human-readable label */
  label: string;
  /** Group this field belongs to */
  group: FieldGroup;
  /** Original text */
  original: string;
  /** Translated text */
  translated: string;
  /** Current status */
  status: TranslationStatus;
  /** Error message if failed */
  error?: string;
  /** Retry count */
  retries: number;
  /** Previous translation for updating/merging */
  previousTranslation?: string;
  /** MVU entry classification for per-type translation strategy */
  entryType?: 'initvar' | 'mvu_logic' | 'rules' | 'narrative' | 'controller' | 'json_patch';
}

export type FieldGroup =
  | 'core'
  | 'messages'
  | 'system'
  | 'creator'
  | 'lorebook'
  | 'lorebook_keys'
  | 'regex'
  | 'depth_prompt'
  | 'tavern_helper';

export interface FieldGroupConfig {
  id: FieldGroup;
  label: string;
  description: string;
  enabled: boolean;
}

/* ─── Provider / Proxy Types ─── */

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'custom';

export interface ProxySettings {
  provider: AIProvider;
  proxyUrl: string;
  apiKey: string;
  apiKeys: string[]; // Multiple API keys for rotation
  model: string;
  maxTokens: number;
  temperature: number;
  requestDelay: number;
  retryDelay: number;
  requestTimeout: number;
  maxRetries: number;
  minResponseRatio: number;
  systemPromptPrefix: string;
  /** Route API calls through the Vite dev-server proxy to bypass CORS */
  useCorsProxy: boolean;
  /** Use streaming (SSE) instead of waiting for full response */
  useStream: boolean;
  /** Enable expert mode: AI uses <thought_process>/<translation> XML reasoning for higher quality */
  expertMode: boolean;
}

export type ConnectionStatus = 'untested' | 'connected' | 'failed';

/* ─── Translation Config ─── */

export type TranslationMode = 'field' | 'batch';
export type LorebookStrategy = 'single' | 'batch';

export type ExportKeyMode = 'merge' | 'translated_only' | 'original_only';

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslationConfig {
  sourceLanguage: string;
  targetLanguage: string;
  translationPrompt: string;
  mode: TranslationMode;
  lorebookStrategy: LorebookStrategy;
  lorebookBatchSize: number;
  concurrentBatches: number;
  skipAlreadyTranslated: boolean;
  fieldGroups: FieldGroupConfig[];
  customSchema?: string;
  exportKeyMode: ExportKeyMode; // How to handle lorebook keys on export
  glossary: GlossaryEntry[]; // Terminology pairs for consistent translation
  enableMvuSync: boolean; // Enable Strategy B (Sync MVU Variables)
  mvuDictionary: Record<string, string>; // Dictionary for Strategy B
  enableRAGContext: boolean; // Enable Cross-field Context RAG for consistency
  ragMaxFields: number; // Max context fields to include (default: 5)
  ragMaxChars: number; // Max total chars for RAG context (default: 3000)
  chunkSize: number; // Tùy chỉnh kích thước chia chunk (số ký tự)
  enableJailbreak: boolean; // Enable Catbox Jailbreak for NSFW cards
  enableObjectiveMode: boolean; // Enable Bạch miêu (objective translation)
}

/* ─── Log Entry ─── */

export type LogLevel = 'success' | 'error' | 'warning' | 'info' | 'active' | 'retry';
export type LogFilter = 'all' | LogLevel;

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
}
