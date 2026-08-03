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

export interface RegexPreset {
  id: string;
  name: string;
  find: string;
  replace: string;
  flags: string;
  description: string;
  isCustom?: boolean;
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
  /**
   * (bugNeedFix/95) Dấu vân tay "dòng|thông điệp" của lỗi cú pháp JS ở lần dịch TRƯỚC.
   * Dịch lại mà ra ĐÚNG lỗi cũ ⇒ lỗi tất định (nội dung/từ điển), thử lại bao nhiêu lần cũng
   * thế → dừng ngay thay vì đốt hết lượt retry (user từng mất 1-2 tiếng cho một field Zod).
   */
  lastJsErrorFingerprint?: string;
  /** (bug 198) Vân tay LÝ DO của cổng mềm gần nhất — cùng lý do hai lượt liền thì thôi dịch lại. */
  lastSoftGateFingerprint?: string;
  /**
   * (bug 203) Field này GIỮ NGUYÊN BẢN GỐC LÀ CÓ CHỦ Ý — chốt an toàn đã quyết định thà để
   * code tiếng Trung chạy được còn hơn nhét bản dịch làm vỡ script.
   *
   * Có cờ này vì bộ quét "chữ Trung sót" nhìn thấy một field toàn chữ Hán thì lôi đi dịch lại
   * thêm 2 lượt nữa — mà đường dịch lại đó KHÔNG có chốt cú pháp. Tức là chính cái chốt vừa
   * cứu script lại bị bước sau vô hiệu hoá, vừa đốt token vừa có thể ghi code vỡ vào thẻ.
   */
  keptOriginalOnPurpose?: boolean;
  /** Previous translation for updating/merging */
  previousTranslation?: string;
  /** MVU entry classification for per-type translation strategy */
  entryType?: 'initvar' | 'mvu_logic' | 'rules' | 'narrative' | 'controller' | 'json_patch' | 'replaceString';
  /** Surgical result state if field was processed using surgical translate */
  surgicalResult?: { type: 'success' | 'fallback'; info?: string };
  /** Bản dịch bê từ cache phiên bản card cũ (tên file cache nguồn, ví dụ "Tuhu_V2.2.png") */
  reusedFrom?: string;
  /** Chunk-level resume: successfully translated chunks from a previous attempt */
  completedChunks?: string[];
  /** Chunk-level resume: raw chunks for this field (unmasked) */
  rawChunks?: string[];
  /** Chunk-level resume: total number of chunks for this field */
  totalChunks?: number;
  /** Chunk-level resume: index of the chunk that failed (resume from here) */
  failedChunkIndex?: number;
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
  | 'tavern_helper'
  | 'mythic';

export interface FieldGroupConfig {
  id: FieldGroup;
  label: string;
  description: string;
  enabled: boolean;
}

/* ─── SillyTavern Preset Types ─── */

export interface PresetPromptEntry {
  identifier: string;
  name: string;
  enabled: boolean;
  role: 'system' | 'user' | 'assistant';
  content: string;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  system_prompt?: boolean;
  marker?: boolean;
  forbid_overrides?: boolean;
}

export interface STPreset {
  // AI Parameters
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  top_a?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  openai_max_tokens?: number;
  openai_max_context?: number;
  max_context_unlocked?: boolean;
  stream_openai?: boolean;
  // Prompt chain
  prompts?: PresetPromptEntry[];
  prompt_order?: Array<{ identifier: string; enabled: boolean }>;
  // System prompts
  impersonation_prompt?: string;
  new_chat_prompt?: string;
  new_example_chat_prompt?: string;
  continue_nudge_prompt?: string;
  group_nudge_prompt?: string;
  // Other settings
  names_behavior?: number;
  wi_format?: string;
  personality_format?: string;
  scenario_format?: string;
  // Catch-all
  [key: string]: unknown;
}

export interface SavedPreset {
  id: string;
  name: string;
  fileName: string;
  preset: STPreset;
  importedAt: number;
  lastUsedAt?: number;
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
  /** Top P (nucleus sampling) — from preset */
  topP: number;
  /** Top K sampling — from preset */
  topK: number;
  /** Min P sampling — from preset */
  minP: number;
  /** Frequency penalty — from preset */
  frequencyPenalty: number;
  /** Presence penalty — from preset */
  presencePenalty: number;
  /** Repetition penalty — from preset */
  repetitionPenalty: number;
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
  /** Rate limit for primary model (requests/minute). Default 5. */
  primaryModelRpm: number;
  /** Secondary model name (e.g. gemini-2.0-flash) — runs ONLY entries shorter than the threshold. */
  secondaryModel: string;
  /** Rate limit for secondary model (requests/minute). Default 17. */
  secondaryModelRpm: number;
  /**
   * (User yêu cầu 2026) Bật model phụ. Model phụ CHỈ chạy entry có số ký tự ≤ `secondaryModelThreshold`.
   * KHÔNG còn là "overflow/fallback khi model chính bận/treo" — entry dài LUÔN đi model chính.
   * Cần `secondaryModelThreshold > 0` mới có tác dụng (không ngưỡng ⇒ model phụ không chạy gì).
   */
  enableSecondaryModel: boolean;
  /** Ngưỡng ký tự: entry NGẮN HƠN/BẰNG số này → đi model phụ; dài hơn → model chính. 0 = tắt model phụ. */
  secondaryModelThreshold: number;
}

/**
 * Cấu hình 1 provider PHỤ (ngoài `proxy` = provider chính #1). Engine gộp `proxy` + tất cả
 * ProviderConfig đang `enabled` thành pool, rải call round-robin để chạy song song nhiều provider.
 * Chỉ chứa field ĐẶC THÙ provider — các thiết lập toàn cục (sampling, prompt, timeout, CORS…) lấy
 * chung từ `proxy`. Khi dịch, lane của provider phụ = { ...proxy, ...(field dưới đây) }.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  provider: AIProvider;
  proxyUrl: string;
  apiKey: string;
  apiKeys: string[];
  model: string;
  primaryModelRpm: number;
  enableSecondaryModel: boolean;
  secondaryModel: string;
  secondaryModelRpm: number;
  secondaryModelThreshold: number;
}

export type ConnectionStatus = 'untested' | 'connected' | 'failed';

/* ─── Translation Config ─── */

export type TranslationMode = 'field' | 'batch';
export type LorebookStrategy = 'single' | 'batch';

export type ExportKeyMode = 'merge' | 'translated_only' | 'original_only';

export interface GlossaryEntry {
  source: string;
  target: string;
  /**
   * (Fix bug #10) true = mục do CÔNG CỤ tự sinh cho card hiện tại (Pha 0 bảng tên riêng, tự nạp
   * bộ thuật ngữ theo card…) — sẽ bị DỌN khi gỡ card / xoá cache để card mới không dính tên card
   * cũ. Mục user tự gõ / import / bấm nạp preset KHÔNG có cờ này ⇒ giữ nguyên qua các card.
   */
  auto?: boolean;
  /**
   * NGUỒN GỐC của mục (để visualize "bộ rule của thẻ"): 'name' = Pha 0 quét tên riêng;
   * 'harvest' = HỌC được trong khi dịch (biệt danh/alias từ keyword lorebook + tên); 'preset' =
   * nạp bộ thuật ngữ có sẵn; 'manual'/thiếu = user tự gõ/import. Chỉ để hiển thị, không đổi logic dịch.
   */
  origin?: 'name' | 'harvest' | 'preset' | 'manual';
}

export type ModPreset = 'none' | 'ntr_to_ntl';

/** (User 2026) Kiểu phiên âm TÊN RIÊNG — xem TranslationConfig.nameStyle + utils/masterPrompt. */
export type NameStyle = 'hanviet' | 'romaji' | 'keep';

export interface TranslationConfig {
  sourceLanguage: string;
  targetLanguage: string;
  translationPrompt: string;
  mode: TranslationMode;
  lorebookStrategy: LorebookStrategy;
  /**
   * (User yêu cầu khôi phục) Bật = GỘP nhiều entry lorebook vào MỘT lần gọi AI (batch thủ công),
   * số entry mỗi lô = `lorebookBatchSize`. Tắt = mỗi entry 1 request (an toàn nhất, mặc định).
   * Dù bật hay tắt, các lô/entry vẫn chạy ĐA LUỒNG song song qua pool RPM.
   * Lưu ý an toàn: `splitLorebookBatches` vẫn tự chia nhỏ lô nếu tổng ký tự vượt trần token
   * (maxBatchChars / softCharCap) — batchSize chỉ là mức TRẦN số entry / lô.
   */
  lorebookManualBatch: boolean;
  /** Số entry gộp mỗi lô khi `lorebookManualBatch` bật (2..50). */
  lorebookBatchSize: number;
  skipAlreadyTranslated: boolean;
  /**
   * Preset "Dịch nhẹ": bật nhóm core/lorebook để LẤY tên card + tên/comment lorebook,
   * nhưng bỏ qua content TO (description/personality/scenario + thân entry) ngay khi
   * prepareFields trích field. Làm ở đây (không phải lúc bấm nút) để không phụ thuộc
   * việc field đã parse xong hay chưa.
   */
  lightSkipContent: boolean;
  /**
   * Preset "Dịch siêu tốc": gom entry theo BIN-PACKING thông minh — entry NGẮN dồn chung
   * một call (đi model phụ/flash cho nhanh), entry DÀI để riêng (đi model chính/pro).
   * Giảm mạnh số call API mà vẫn chạy đa luồng qua pool.
   */
  smartBatchPacking: boolean;
  fieldGroups: FieldGroupConfig[];
  customSchema?: string;
  exportKeyMode: ExportKeyMode; // How to handle lorebook keys on export
  glossary: GlossaryEntry[]; // Terminology pairs for consistent translation
  /**
   * Pha 0 — Bảng tên riêng tự động: trước khi dịch, đếm tên/thuật ngữ Hán lặp lại trong
   * các field sắp dịch + keyword lorebook, gửi 1 lượt gọi AI dịch cả bảng rồi merge vào
   * glossary → mọi luồng dịch song song dùng chung, tên nhất quán toàn card.
   */
  autoNameGlossary: boolean;
  /**
   * (User 2026) KIỂU TÊN RIÊNG khi dịch — ảnh hưởng Pha 0 (bảng tên) + prompt chính:
   * 'hanviet' (mặc định VN) = tên Trung→Hán-Việt; 'romaji' = tên nhân vật→phiên âm quốc tế
   * (Nhật→Romaji, Trung→Pinyin); 'keep' = giữ dạng gốc/quốc tế. Tên phương Tây LUÔN khôi phục Latin.
   */
  nameStyle: NameStyle;
  /**
   * (User 19/07) 🎌 CHẾ ĐỘ ĐỒNG NHÂN (fanfic/doujin của một tác phẩm có sẵn).
   * Card đồng nhân thường là card TIẾNG TRUNG viết về IP Nhật/Hàn/phương Tây — tên nhân vật viết
   * bằng Hán tự nhưng PHẢI đọc theo âm gốc của tác phẩm (雪ノ下雪乃 → Yukinoshita Yukino), TUYỆT
   * ĐỐI KHÔNG Hán-Việt hoá ("Tuyết Nãi"). Bật cờ này sẽ: (1) ép khối luật tên chống Hán-Việt hoá
   * ở MỌI tầng prompt, (2) đổi persona Pha 0 (bảng tên) sang "chuyên gia fandom" thay vì "thẻ tu
   * tiên Trung", (3) KHÔNG tự nạp bộ thuật ngữ Tu tiên/Võ hiệp (bộ này kéo tên về Hán-Việt),
   * (4) khoá bảng tên đã chốt khỏi bị cơ chế hậu kỳ ghi đè ngược.
   */
  fandomMode: boolean;
  /** Tên tác phẩm gốc (vd "Oregairu", "Genshin Impact") — giúp AI tra đúng tên chính tắc. */
  fandomName: string;
  enableMvuSync: boolean; // Enable Strategy B (Sync MVU Variables)
  /**
   * (User 23/07) Chiến lược A — card dùng **Mythic** (Auto Database).
   *
   * Card Mythic kích hoạt entry bằng AGENT NGỮ NGHĨA chứ không bằng keyword: mỗi entry mang
   * một khối JSON trong `comment` với `description` + `triggerWhen`, và script Agent đọc hai
   * field đó để quyết định nạp entry nào. Người chơi chat tiếng Việt mà `triggerWhen` còn
   * tiếng Trung ⇒ Agent không khớp ⇒ entry không bao giờ được nạp ⇒ card như chết.
   *
   * B và C không đụng tới hai field này (chúng nằm trong JSON nhúng trong HTML comment).
   * Bật A để dịch chúng và TÍNH LẠI hash (sourceHash/sourceSkillHash) — giữ hash cũ thì
   * script coi entry đã bị sửa ngoài. Chạy độc lập hoặc song song với B/C đều được.
   */
  enableMythicSync: boolean;
  mvuDictionary: Record<string, string>; // Dictionary for Strategy B
  /**
   * (User 2026) 🔒 KHOÁ từ điển MVU: khi bật, PIPELINE DỊCH TỰ ĐỘNG bị cấm ghi vào mvuDictionary
   * (không auto-extract/AI-dịch biến/merge/sweep/dọn) — chỉ DÙNG từ điển user đã chốt. Thao tác TAY
   * trong panel Chiến lược B (user tự bấm) vẫn cho phép.
   */
  mvuDictLocked: boolean;
  /**
   * (bugNeedFix/110) 🔒 KHOÁ TÊN WORLDBOOK: bản dịch tên sách được CHỐT một lần, mọi nơi dùng đúng nó.
   * Tên sách nằm ở HAI chỗ — field `character_book.name` và chuỗi trong script bảng trạng thái
   * (`const WI_FILE='…'`) — do hai lượt gọi AI khác nhau dịch, nên lệch một chữ ("mùa hè của em"
   * vs "mùa hạ của em") là script không tìm thấy sách, biến không lên bảng.
   * Dạng: { tên sách GỐC: tên đã CHỐT }. Rỗng = chưa khoá gì, hành vi như cũ.
   */
  worldbookNameLock: Record<string, string>;
  enableRAGContext: boolean; // Enable Cross-field Context RAG for consistency
  ragMaxFields: number; // Max context fields to include (default: 5)
  ragMaxChars: number; // Max total chars for RAG context (default: 3000)
  chunkSize: number; // Tùy chỉnh kích thước chia chunk (số ký tự)
  parallelChunks: number; // Số chunk dịch song song (1 = tuần tự, 2+ = song song)
  enableJailbreak: boolean; // Enable Catbox Jailbreak for NSFW cards
  enableGomorrahNsfwRules?: boolean; // Enable Gomorrah NSFW Protection Rules (content quality optimization)
  enableObjectiveMode: boolean; // Enable Bạch miêu (objective translation)
  surgicalMode: boolean; // Extract and translate only CJK substrings for code-heavy fields
  surgicalPrompt: string; // Custom instructions for surgical translation prompt
  enableModMode: boolean; // Enable custom user mod instructions for translation
  modInstructions: string; // The custom instructions provided by the user
  enablePatchMode: boolean; // Patch mode: AI outputs find/replace patches instead of full content (regex fields only)
  enableMvuConversion: boolean; // Also convert the card to MVU-Zod during modding
  enableModelRouting: boolean; // Enable custom model routing per group/entry
  groupModelRouting: Record<string, string>; // Map of FieldGroup to model string
  entryModelRouting: Record<string, string>; // Map of field path to model string
  modPreset?: ModPreset;
  enableModThinking: boolean;
  enableEjsThinking: boolean;
  enableEjsSync: boolean;             // Enable Strategy C (EJS Entry Name & Keyword Sync)
  ejsEntryNameDict: Record<string, string>;  // EJS getwi() entry name → translated name
  ejsKeywordDict: Record<string, string>;    // EJS keyword/alias → translated
  ejsDecoratorPreserve: boolean;       // Auto-detect & protect EJS decorators (@@, [GENERATE:], @INJECT)
  enableChunkVerification: boolean;     // Enable AI-powered chunk verification (compare original vs translated)
  enableTranslationMemory: boolean;    // Enable Translation Memory (persistent cross-session term/translation cache)
  mvuScanPasses: number;               // Số lần quét biến MVU (Strategy B), mỗi pass chỉ dịch biến mới
  ejsScanPasses: number;               // Số lần quét biến EJS (Strategy C), mỗi pass chỉ dịch biến mới
  mvuTranslationPrompt: string;        // Custom prompt for Strategy B variable name translation (replaces hardcoded rules)
  ejsTranslationPrompt: string;        // Custom prompt for Strategy C entry/keyword name translation (replaces hardcoded rules)
  cssCjkHandling: 'preserve' | 'translate'; // How to handle CJK chars found inside CSS values
}

/* ─── Log Entry ─── */

export type LogLevel = 'success' | 'error' | 'warning' | 'info' | 'active' | 'retry';
export type LogFilter = 'all' | LogLevel;

/** Giai đoạn của tiến trình — để gom log thành nhóm gấp/mở được (Chuẩn bị → Dịch → Kiểm tra). */
export type LogPhase = 'prepare' | 'translate' | 'verify' | 'other';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  /** Giai đoạn khi dòng log được ghi (addLog tự đóng dấu theo logPhase hiện tại). */
  phase?: LogPhase;
}
