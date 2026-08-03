/**
 * MVUZOD types — spec Phần 3B
 * Zod + JSON Patch cho TavernHelper RPG engine
 */

// ========== MVUZOD FIELD DEFINITION ==========

export interface MVUZODField {
  path: string;          // JSON Pointer: "/Người_Chơi/HP"
  type: 'string' | 'number' | 'boolean' | 'record' | 'array' | 'object';
  label: string;         // Hiển thị trong UI
  defaultValue: unknown;
  constraints: MVUZODConstraints;
  description?: string;  // Mô tả cho AI (đưa vào JSON Schema)
  children?: MVUZODField[];  // cho nested object
}

export interface MVUZODConstraints {
  min?: number;        // cho number
  max?: number;        // cho number
  coerce?: boolean;    // auto-convert type
  prefault?: unknown;  // giá trị thay thế khi AI trả về null/undefined
  readOnly?: boolean;  // AI không được ghi (biến bắt đầu _)
  hidden?: boolean;    // Ẩn khỏi AI hoàn toàn (private)
  clamp?: [number, number];   // [min, max] transform
  pattern?: string;    // regex validate cho string
  transform?: string;  // transform function name: 'clamp' | 'pickBy' | 'takeRight' | custom
  transformExpr?: string;  // custom transform expression (v => _.clamp(v, 0, 100))
  describe?: string;   // z.string().describe('mô tả') — hint cho record keys
  enumValues?: string[];  // z.enum([...]) values
  // Update rules fields (from reference repo)
  checkRules?: string[];   // check rules hướng dẫn AI update
  updateType?: string;     // type description cho update rules
  updateRange?: string;    // range description (e.g. "0~100")
  updateFormat?: string;   // format requirement (e.g. "YYYY-MM-DD HH:MM")
}

export interface MVUZODSchema {
  version: string;       // "1.0"
  fields: MVUZODField[];
  /**
   * (Goal 28/07) Quan hệ mềm giữa các chỉ số liên quan (cấp độ ↔ năng lượng, cảnh giới ↔ linh
   * lực, danh vọng ↔ ảnh hưởng…). AI bước mvuzod SUY từ mô tả ý tưởng/lore của user — KHÔNG
   * phải công thức của tool. Opening Form dùng để CẢNH BÁO MỀM khi giá trị nhập lệch xa mốc
   * lore, kèm căn cứ; không bao giờ chặn. Không đủ căn cứ thì mảng rỗng/vắng mặt.
   */
  statRelations?: StatRelation[];
}

// ========== STAT RELATIONS — ràng buộc mềm giữa chỉ số liên quan ==========

export interface StatRelationLandmark {
  /**
   * Mốc neo mà khoảng hợp lý áp dụng: giá trị enum ("Luyện Khí"), một con số (10),
   * hoặc một khoảng [1, 10]. Giá trị neo không khớp mốc nào ⇒ không cảnh báo (không bịa).
   */
  anchor: number | [number, number] | string;
  /** Khoảng "thường thấy" của trường phụ thuộc tại mốc này — KHÔNG phải giới hạn cứng. */
  plausibleMin?: number;
  plausibleMax?: number;
  /** Căn cứ lore của riêng mốc này — hiện nguyên văn trong cảnh báo cho người chơi. */
  note?: string;
}

export interface StatRelation {
  /** JSON pointer của trường neo, vd "/Nhân vật/Cảnh giới" (number hoặc enum). */
  anchorPath: string;
  /** JSON pointer của trường phụ thuộc, vd "/Nhân vật/Linh lực" (number, bộ đếm tự do). */
  dependentPath: string;
  /** Căn cứ tổng — trích/diễn đạt lại mô tả của user. Hiện trong cảnh báo. */
  basis: string;
  landmarks: StatRelationLandmark[];
}

// ========== JSON PATCH OPERATIONS (RFC 6902 mở rộng) ==========

export type JSONPatchOp =
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'delta'; path: string; value: number }    // Mở rộng: cộng/trừ số
  | { op: 'insert'; path: string; value: unknown }   // Object key hoặc array "-"
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; to: string };

export interface MVUZODPatchBlock {
  mvuzod_patch: JSONPatchOp[];
}

// ========== MVUZOD CONFIG (gắn vào CardExtensions) ==========

export interface MVUZODConfig {
  schema: MVUZODSchema;
  extractorRegex: string;          // Mặc định: /<UpdateVariable>([\s\S]+?)<\/UpdateVariable>/gi
  validationMode: 'strict' | 'lenient';
  stateHistoryMaxLength: number;   // default 20
  displayTemplate: string;         // EJS template hiển thị state cho user
  injectionTemplate: string;       // EJS template inject state vào prompt
}

// ========== VALIDATION RESULT ==========

export interface PatchValidationResult {
  success: boolean;
  appliedOps: number;
  errors: PatchValidationError[];
  newState: Record<string, unknown>;
}

export interface PatchValidationError {
  path: string;
  op: string;
  reason: string;
  fallbackApplied?: boolean;
  fallbackValue?: unknown;
}

// ========== SCHEMA INFERENCER ==========

export interface InferenceResult {
  proposedSchema: MVUZODSchema;
  inferenceReport: InferenceReport;
}

export interface InferenceReport {
  entryCount: number;
  detectedGroups: Array<{ name: string; count: number; sample: string[] }>;
  detectedEnums: Array<{ path: string; values: string[]; source: string }>;
  detectedNPCPattern: boolean;
  detectedCultivationSystem: boolean;
  suggestedFields: Array<{ path: string; reason: string; confidence: number }>;
  warnings: string[];
}

// ========== INITVAR — Initial Variable Definition ==========

export interface InitVarEntry {
  /** Unique ID within this initvar set */
  id: string;
  /** Human-readable label (e.g. "Mở đầu thường", "Mở đầu khó") */
  label: string;
  /** The initial variable state as a nested object */
  data: Record<string, unknown>;
  /** Whether this is the default initvar set */
  isDefault: boolean;
  /** Optional description shown in UI */
  description?: string;
}

export interface InitVarConfig {
  /** All available initvar sets (e.g. multiple game routes) */
  entries: InitVarEntry[];
  /** Which entry is currently active/previewed */
  activeEntryId: string | null;
  /** Mode: 'worldbook' = single disabled entry, 'per_opening' = <initvar> blocks in each opening */
  initvarMode: 'worldbook' | 'per_opening';
}

// ========== VARIABLE LIST GENERATOR ==========

export interface VariableListConfig {
  /** EJS template for rendering variables into a worldbook entry */
  displayTemplate: string;
  /** EJS template for injecting variables into AI prompt */
  injectionTemplate: string;
  /** Which variables to show/hide */
  visiblePaths: string[];
  /** Format for displaying values: 'raw' | 'formatted' | 'ejs' */
  displayFormat: 'raw' | 'formatted' | 'ejs';
  /** Generated worldbook entry comment */
  entryComment: string;
}

export interface GeneratedVariableEntry {
  comment: string;
  content: string;
  keys: string[];
  position: string;
  order: number;
  constant: boolean;
  description: string;
}

// ========== UPDATE VARIABLE TAG GENERATOR ==========

export interface UpdateVariableTemplate {
  /** Label for this template */
  label: string;
  /** The template text with JSON Patch sample */
  template: string;
  /** Which entry type this template applies to (rules, output format, etc.) */
  entryType: 'update_rules' | 'output_format' | 'custom';
}

// ========== GAME FRONTEND TYPES ==========

export interface GameFrontendConfig {
  /** Project name (used in file paths) */
  projectName: string;
  /** Whether to use React or vanilla TS */
  useReact: boolean;
  /** Components to generate */
  components: GameComponentType[];
  /** Opening form configuration */
  openingForm?: OpeningFormConfig;
}

export type GameComponentType =
  | 'game_screen'
  | 'opening_form'
  | 'title_screen'
  | 'click_to_start'
  | 'status_bar';

export interface OpeningFormConfig {
  fields: OpeningFormField[];
  /** Title shown on the form */
  title: string;
  /** Submit button text */
  submitText: string;
}

export interface OpeningFormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  defaultValue: string | number;
  options?: string[];  // for select type
  required: boolean;
  /** Maps to a path in the MVU schema */
  schemaPath?: string;
}

// ========== MVUZOD STUDIO TAB STATE ==========

export type MVUZODStudioTab =
  | 'wizard'
  | 'initvar'
  | 'varlist'
  | 'update'
  | 'patch'
  | 'script'
  | 'game'
  | 'frontend'
  | 'playground';

export interface MVUZODStudioState {
  activeTab: MVUZODStudioTab;
  schema: MVUZODSchema | null;
  initVarConfig: InitVarConfig;
  variableListConfig: VariableListConfig;
  gameFrontendConfig: GameFrontendConfig | null;
}
