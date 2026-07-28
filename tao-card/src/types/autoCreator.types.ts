import type { EntryCategory, CardType } from '../lib/worldbook/worldbookConfig';
import type { MVUZODSchema } from './mvuzod.types';

// ═══ Phương pháp Pipeline ═══
export type PipelineMethod = 'standard' | 'minh_nguyet';

/** (Goal 104b) Loại thẻ đang tạo — quyết định prompt của MỌI bước, không chỉ lời văn. */
export type CardKind = 'character' | 'game_world';

// ═══ Các bước pipeline — Standard ═══
// (User 19/07) Thứ tự CHẠY do ALL_STEPS trong autoCreatorStore quyết định — mvuzod nay chạy
// TRƯỚC regex để regex bám đúng tên biến schema; game_ui sau mvuzod; final_check cuối cùng.
export type AutoCreatorStep =
  | 'basic_info'        // Name, Description, Personality, Scenario
  | 'lorebook'          // Lorebook entries
  | 'mvuzod'            // MVUZOD schema + system entries
  | 'game_ui'           // (User 19/07) Game UI programmatic: status bar + form thiết lập từ schema
  | 'regex'             // Regex scripts (bám schema MVU nếu có)
  | 'system_prompt'     // System prompt + Depth prompt
  | 'first_message'     // First message + alternate greetings
  | 'mes_example'       // Message examples
  | 'final_check';      // (User 19/07) Kiểm tra tổng thể toàn card cuối pipeline

// ═══ Các bước pipeline — Minh Nguyệt ═══
export type MinhNguyetStep =
  | 'worldview'              // Thế giới quan (Đường A/B/C)
  | 'character_basic'        // Nhân vật cơ sở
  | 'color_palette'          // Bảng điều sắc tính cách
  | 'three_faces'            // Ba diện tính (tùy chọn)
  | 'secondary_explanation'  // Tái diễn giải
  | 'wardrobe'               // Tủ quần áo
  | 'nsfw_palette'           // Bảng NSFW (tùy chọn)
  | 'npc_creation'           // Tạo NPC (tùy chọn)
  | 'character_overview'     // Xem lướt nhân vật
  | 'opening';               // Khai bạch

/** Union step type cho cả 2 phương pháp */
export type AnyPipelineStep = AutoCreatorStep | MinhNguyetStep;

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

/** v3: Mỗi bước có 3 phase: generate → preview → apply */
export type StepPhase = 'idle' | 'generating' | 'previewing' | 'applied' | 'error';

// ═══ Prompt override ═══
export type PromptMode = 'default' | 'append' | 'replace';

// ═══ Đường thế giới quan (Minh Nguyệt) ═══
export type WorldviewPath = 'real_background' | 'small_world' | 'large_world';

// ═══ Config từng bước (user tùy chỉnh) ═══
export interface LorebookStepConfig {
  totalEntries: number;        // Tổng số entry muốn tạo (5-100, default 20) — đóng vai trò TRẦN (tối đa)
  /**
   * (User 2026) SÀN số entry: pipeline tiếp tục chạy batch bù cho tới khi đạt ÍT NHẤT chừng này entry
   * (AI đôi khi trả thiếu). 0/undefined = không ép sàn (hành vi cũ). Luôn ≤ totalEntries.
   */
  minEntries?: number;
  entriesPerBatch: number;     // Entries mỗi batch (1-10, default 5)
  concurrentBatches: number;   // Batch song song (1-5, default 1)
  category: EntryCategory;     // Loại entry
  cardType: CardType;          // Thẻ đơn/nhiều NV
  useWebSearch: boolean;       // Có dùng web search không
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface RegexStepConfig {
  count: number;               // Số regex scripts (1-10, default 3)
  types: string[];             // Loại regex muốn tạo
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface MvuzodStepConfig {
  autoDetect: boolean;         // Tự phân tích lorebook → schema
  createInitVar: boolean;      // Tạo entry [initvar]
  createVarList: boolean;      // Tạo entry biến list
  createUpdateRules: boolean;  // Tạo entry update rules
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface BasicInfoStepConfig {
  includePersonality: boolean; // default true
  includeScenario: boolean;    // default true
  language: 'vi' | 'en' | 'zh' | 'ja'; // Ngôn ngữ content
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface SystemPromptStepConfig {
  includeDepthPrompt: boolean; // default true
  depthValue: number;          // default 4
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface FirstMessageStepConfig {
  alternateGreetings: number;  // Số alternate greetings (0-5, default 2)
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface MesExampleStepConfig {
  exampleCount: number;        // Số ví dụ hội thoại (1-5, default 2)
  promptOverride?: string;
  promptMode: PromptMode;
}

/** (User 19/07) Game UI programmatic — sinh status bar / form thiết lập từ schema, $0 không tốn AI. */
export interface GameUiStepConfig {
  component: 'status_bar' | 'opening_form' | 'full_set';
  themeId?: string;
}

/** (User 19/07) Kiểm tra tổng thể cuối pipeline. */
export interface FinalCheckStepConfig {
  /** Gọi thêm 1 lượt AI đọc báo cáo + nhận xét tổng thể (tắt = chỉ kiểm deterministic). */
  useAiReview: boolean;
}

// ═══ Config Minh Nguyệt Global ═══
export interface MinhNguyetGlobalConfig {
  worldviewPath: WorldviewPath;    // Đường A/B/C
  cardType: CardType;              // Thẻ đơn/nhiều NV
  includeThreeFaces: boolean;      // Có ba diện tính không
  includeNsfw: boolean;            // Có bảng NSFW không
  includeNpc: boolean;             // Có NPC không
  autoTag: boolean;                // Tự động gán tag <tên_idN>
  npcCount?: number;
  alternateGreetings?: number;
  promptMode?: PromptMode;
}

// ═══ Config Minh Nguyệt cho từng bước ═══
export interface MnBaseStepConfig {
  promptOverride?: string;
  promptMode: PromptMode;
}

export interface MnNpcStepConfig extends MnBaseStepConfig {
  npcCount: number;
}

export interface MnOpeningStepConfig extends MnBaseStepConfig {
  alternateGreetings: number;
}

export interface MnStepConfigs {
  worldview: MnBaseStepConfig;
  character_basic: MnBaseStepConfig;
  color_palette: MnBaseStepConfig;
  three_faces: MnBaseStepConfig;
  secondary_explanation: MnBaseStepConfig;
  wardrobe: MnBaseStepConfig;
  nsfw_palette: MnBaseStepConfig;
  npc_creation: MnNpcStepConfig;
  character_overview: MnBaseStepConfig;
  opening: MnOpeningStepConfig;
}

// ═══ Config tổng thể ═══
export interface AutoCreatorConfig {
  idea: string;                          // Ý tưởng chính
  /**
   * (User 19/07) Yêu cầu / quy tắc TOÀN CỤC cho AI về card — áp cho MỌI bước pipeline
   * (vd "Không NSFW", "Văn phong cổ trang", "Mọi tên riêng dùng Hán-Việt").
   */
  userRules: string;
  /**
   * (Goal 104b — yêu cầu gốc của user) Thẻ này là THẺ NHÂN VẬT truyền thống, hay là một
   * GAME / THẾ GIỚI hoàn chỉnh? Hai thứ này viết khác hẳn nhau:
   *  - 'character': mô tả một con người — tính cách, ngoại hình, quan hệ.
   *  - 'game_world': mô tả một THẾ GIỚI VẬN HÀNH ĐƯỢC — luật chơi, hệ thống, vòng lặp
   *    gameplay, người chơi là nhân vật chính, AI đóng vai quản trò/narrator.
   * Chế độ game_world cũng BỎ System prompt theo yêu cầu: luật chơi sống trong lorebook +
   * entry [mvu_update] + giao diện, không nhét vào system prompt (dễ bị preset của user đè).
   */
  cardKind: CardKind;
  pipelineMethod: PipelineMethod;        // 'standard' | 'minh_nguyet'
  selectedSteps: AutoCreatorStep[];      // Các bước đã bật — Standard
  selectedMnSteps: MinhNguyetStep[];     // Các bước đã bật — Minh Nguyệt
  autoApplyAll: boolean;                 // true = apply ngay, false = dừng ở preview
  presetId?: string;                     // Preset đang dùng
  stepConfigs: {
    basic_info: BasicInfoStepConfig;
    lorebook: LorebookStepConfig;
    regex: RegexStepConfig;
    mvuzod: MvuzodStepConfig;
    game_ui: GameUiStepConfig;
    final_check: FinalCheckStepConfig;
    system_prompt: SystemPromptStepConfig;
    first_message: FirstMessageStepConfig;
    mes_example: MesExampleStepConfig;
  };
  mnConfig: MinhNguyetGlobalConfig;      // Config chung cho Minh Nguyệt
  mnStepConfigs: MnStepConfigs;          // Config riêng cho từng bước Minh Nguyệt
  /** (bug 126) Chính sách EJS được EJS Studio áp sang — xem AppliedEjsPolicy. */
  appliedEjsPolicy?: AppliedEjsPolicy;
  /** (bug 134) Cấu hình "AI Sinh Theo Batch" đang được áp — xem AppliedBatchPreset. */
  appliedBatchPreset?: AppliedBatchPreset;
  /** (bug 141) Trạng thái "Xem trước & Tinh chỉnh" (schema + giao diện đã duyệt) — xem CardTuning. */
  tuning?: CardTuning;
}

/**
 * (bug 141) "XEM TRƯỚC & TINH CHỈNH" — schema MVU + giao diện được duyệt TRƯỚC khi tạo card.
 * Nằm trong config (được persist) nên thoát giữa chừng quay lại vẫn còn — đúng yêu cầu
 * "toàn bộ 3 bước này nên được lưu tạm và có thể thoát giữa chừng".
 */
export interface CardTuning {
  /** Schema đang chỉnh (Bước 1) — bản sẽ được dùng khi confirmed. */
  schema: MVUZODSchema;
  /** Bản AI đề xuất ban đầu — nút "Reset về bản AI đưa". */
  originalSchema: MVUZODSchema;
  /** Theme giao diện chọn ở Bước 2. */
  themeId?: string;
  /** Đang ở bước nào của wizard (1..3) — thoát giữa chừng vào lại đúng chỗ. */
  step: 1 | 2 | 3;
  /** Đã bấm xác nhận ở Bước 3 — pipeline PHẢI dùng đúng 100% schema+theme này. */
  confirmed: boolean;
  /** Chữ ký ý tưởng lúc sinh schema — ý tưởng đổi thì tuning cũ không còn giá trị. */
  ideaSig: string;
}

/**
 * (bug 134) CẤU HÌNH "AI SINH THEO BATCH" đang áp cho Auto Creator.
 *
 * User: "Nút Áp dụng vào Auto Creator của AI Sinh Theo Batch nên đổi thành bật/tắt (toggle)
 * thay vì nút bấm — vì không rõ khi Reset trang thì nó có tắt hay không. Đổi thành toggle sẽ
 * thấy rõ trạng thái hiện tại đang bật hay tắt."
 *
 * Nút bấm một lần thì trạng thái tan vào các ô cấu hình rời rạc, không ai biết nó còn hiệu lực
 * hay đã bị Reset xoá. Ghi thành MỘT khối có tên: bật thì thấy, tắt thì trả cấu hình về nguyên
 * trạng đã lưu. `previousConfig` chính là bản chụp TRƯỚC khi áp, để tắt là hoàn nguyên đúng
 * những gì mình đã đụng — không đoán, không để lại rác.
 */
export interface AppliedBatchPreset {
  appliedAt: string;
  /** Tab (loại nội dung) của AI Sinh Theo Batch lúc áp — hiện trong banner. */
  tabLabel: string;
  summary: { totalEntries: number; entriesPerBatch: number; concurrentBatches: number; hasPrompt: boolean };
  /** Bản chụp cấu hình lorebook TRƯỚC khi áp — dùng để tắt toggle là trả về như cũ. */
  previousConfig: Partial<LorebookStepConfig>;
}

/**
 * (bug 126) CHÍNH SÁCH EJS do EJS Studio áp sang Auto Creator.
 *
 * User muốn: sau khi duyệt kế hoạch EJS cho một card đã hoàn chỉnh, bấm một nút để Auto Creator
 * làm theo cùng cách đó cho các card sau, và Auto Creator phải BÁO cho biết là đã áp.
 *
 * Cố ý tách riêng field này thay vì ghi đè `stepConfigs.lorebook.promptOverride`: nút "Áp dụng
 * sang Auto Creator" của AI Sinh Theo Batch đã dùng promptOverride rồi. Hai nút ghi hai chỗ
 * khác nhau thì bấm cả hai vẫn cộng hưởng, không cái nào xoá cái nào.
 */
export interface AppliedEjsPolicy {
  /** ISO time — banner hiện "áp lúc nào" để user biết còn mới hay đã cũ. */
  appliedAt: string;
  /** Card đã lấy chính sách này ra. */
  sourceCard: string;
  /** Yêu cầu gốc user gõ ở EJS Studio. */
  goal: string;
  /** Số dòng kế hoạch đã duyệt. */
  rowCount: number;
  summary: { reclassify: number; createEjs: number; character: number; tokensSaved: number };
  /** Chỉ dẫn bơm thêm vào prompt các bước liên quan của Auto Creator. */
  directive: string;
}

// ═══ Step Preview (v3) ═══
export interface StepPreview {
  rawOutput: string;           // JSON thô từ AI
  parsedData: unknown;         // Đã parse
  editedData?: unknown;        // User đã chỉnh sửa (nếu có)
  tokenEstimate?: number;      // Ước lượng token
}

// ═══ Card Blueprint (Phase 0) ═══
export interface CardBlueprint {
  characterProfile: {
    name: string;
    origin: string;
    appearance: string;
    personality: string;
    abilities: string[];
    relationships: string[];
  };
  worldStructure: {
    genre: string;
    setting: string;
    systems: string[];         // ma thuật, RPG, chiến đấu...
    factions: string[];
  };
  suggestedEntryTopics: BlueprintEntryTopic[];
  suggestedVariables: BlueprintVariable[];
  toneAndStyle: {
    narrativeVoice: string;    // ngôi kể
    language: string;
    mood: string;
  };
  estimatedComplexity: 'simple' | 'medium' | 'complex';
  /** (bug 116) 2-4 bối cảnh mở đầu sinh từ ý tưởng — Opening Form cho người chơi chọn 1. */
  openingScenarios?: Array<{ title: string; desc: string }>;
}

export interface BlueprintEntryTopic {
  category: 'worldview' | 'character' | 'npc' | 'location' | 'system' | 'event';
  title: string;
  description: string;
  priority: number;            // 1-10
  suggestedPosition: number;   // SillyTavern position
  suggestedConstant: boolean;
}

export interface BlueprintVariable {
  path: string;                // e.g. "/角色/HP"
  type: 'number' | 'string' | 'boolean';
  defaultValue: unknown;
  description: string;
  group: string;               // e.g. "角色", "世界"
}

// ═══ Preset ═══
export interface AutoCreatorPreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  config: Partial<AutoCreatorConfig>;
}

// ═══ Log entry ═══
export interface PipelineLog {
  id: string;
  timestamp: number;
  step: AnyPipelineStep | 'system' | 'blueprint';
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
