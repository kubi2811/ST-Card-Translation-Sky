/**
 * lorebookRefiner.types.ts — AI Lorebook Refiner Types
 * Phân tích, bổ sung, sửa, xóa entries bằng AI — đảm bảo nhất quán & không xung đột
 */

import type { AdvancedEntryHints } from './aiAgent.types';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export interface RefinerConfig {
  /** Yêu cầu/hướng dẫn từ người dùng */
  userInstruction: string;
  /** Giới hạn token tối đa cho content mỗi entry (100-10000) */
  maxTokensPerEntry: number;
  /** Số batch xử lý song song (1-10) */
  concurrentBatches: number;
  /** Số entries phân tích mỗi batch (3-20) */
  entriesPerBatch: number;
  /** Tổng số entries tối đa xử lý (0 = tất cả) */
  maxEntriesToProcess: number;
  /** Chế độ hoạt động */
  operationMode: RefinerOperationMode;
  /** Tự động áp dụng hay chỉ preview */
  autoApply: boolean;

  // ── Fix toggles ──
  fixDuplicateUids: boolean;
  fixSchemaConflicts: boolean;
  fixRegexConflicts: boolean;
  fixCoherenceIssues: boolean;
  fixKeywordIssues: boolean;
  fixConfigIssues: boolean;

  /** Override model (để trống = dùng profile mặc định) */
  modelOverride?: string;
}

export type RefinerOperationMode =
  | 'add_only'      // Chỉ bổ sung entries mới
  | 'fix_only'      // Chỉ sửa/xóa entries có vấn đề
  | 'all';           // Cả bổ sung + sửa

export const REFINER_MODE_LABELS: Record<RefinerOperationMode, { label: string; icon: string; desc: string }> = {
  add_only:  { label: 'Chỉ bổ sung',     icon: '➕', desc: 'Thêm entries mới dựa trên phân tích thiếu sót' },
  fix_only:  { label: 'Sửa & Bổ sung',   icon: '🔧', desc: 'Sửa lỗi, bổ sung nội dung sơ sài, gộp trùng, xóa thừa' },
  all:       { label: 'Toàn diện',        icon: '⚡', desc: 'Bổ sung mới + sửa + mở rộng nội dung — tối ưu toàn bộ lorebook' },
};

export const DEFAULT_REFINER_CONFIG: RefinerConfig = {
  userInstruction: '',
  maxTokensPerEntry: 500,
  concurrentBatches: 2,
  entriesPerBatch: 8,
  maxEntriesToProcess: 0,
  operationMode: 'all',
  autoApply: false,
  fixDuplicateUids: true,
  fixSchemaConflicts: true,
  fixRegexConflicts: true,
  fixCoherenceIssues: true,
  fixKeywordIssues: true,
  fixConfigIssues: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export type RefinerActionType =
  | 'add_entry'          // Bổ sung entry mới
  | 'rewrite_content'    // Viết lại content entry (bổ sung chi tiết, sửa lỗi)
  | 'expand_content'     // Bổ sung thêm nội dung cho entry sơ sài (giữ nguyên nội dung cũ + thêm mới)
  | 'fix_keys'           // Sửa keywords
  | 'fix_config'         // Sửa position/order/depth/constant/selective
  | 'fix_uid'            // Sửa UID trùng
  | 'merge_entries'      // Gộp 2 entries trùng
  | 'delete_entry'       // Xóa entry thừa/trùng
  | 'fix_content_error'; // Sửa lỗi nội dung (sai logic, mâu thuẫn...)

export const REFINER_ACTION_LABELS: Record<RefinerActionType, { label: string; icon: string }> = {
  add_entry:         { label: 'Thêm entry mới',    icon: '➕' },
  rewrite_content:   { label: 'Viết lại nội dung', icon: '✏️' },
  expand_content:    { label: 'Bổ sung nội dung',  icon: '📝' },
  fix_keys:          { label: 'Sửa từ khóa',       icon: '🔑' },
  fix_config:        { label: 'Sửa cấu hình',      icon: '⚙️' },
  fix_uid:           { label: 'Sửa UID trùng',      icon: '🆔' },
  merge_entries:     { label: 'Gộp entries',        icon: '🔗' },
  delete_entry:      { label: 'Xóa entry thừa',     icon: '🗑️' },
  fix_content_error: { label: 'Sửa lỗi nội dung',  icon: '🔧' },
};

export type RefinerSeverity = 'critical' | 'warning' | 'suggestion';

export interface RefinerAction {
  /** ID duy nhất cho action (auto-gen) */
  id: string;
  type: RefinerActionType;
  /** ID entry bị tác động (undefined cho add_entry) */
  targetEntryId?: number;
  /** Comment/tên entry bị tác động */
  targetComment?: string;
  /** Lý do AI đưa ra */
  reason: string;
  severity: RefinerSeverity;

  // ── Data cho từng loại action ──
  /** Nội dung mới (cho rewrite/add/fix_content_error/expand_content) */
  newContent?: string;
  /** Keywords mới (cho fix_keys/add) */
  newKeys?: string[];
  newSecondaryKeys?: string[];
  /** Comment mới (cho add/merge) */
  newComment?: string;
  /** Config patch (cho fix_config) */
  configPatch?: Partial<EntryConfigPatch>;
  /** UID mới (cho fix_uid) */
  newUid?: number;
  /** ID target khi merge */
  mergeTargetId?: number;
  /** Comment của target khi merge */
  mergeTargetComment?: string;
  /** Content sau merge */
  mergedContent?: string;
  /** Keys sau merge */
  mergedKeys?: string[];
  /** Nếu true, expand_content sẽ THAY THẾ toàn bộ nội dung thay vì nối thêm (dùng khi cần sửa + bổ sung) */
  replaceOriginal?: boolean;

  // ── Tracking ──
  applied: boolean;
  skipped: boolean;
}

/**
 * (Tawa 2.0) Kế thừa `AdvancedEntryHints` để refiner vá được ĐÚNG BỘ tham số mà batch sinh ra —
 * trước đây refiner chỉ chạm được 7 field cơ bản, nên mọi sticky/group/ignore_budget do batch đặt
 * đều nằm ngoài tầm sửa của nó.
 */
export interface EntryConfigPatch extends AdvancedEntryHints {
  constant: boolean;
  selective: boolean;
  position: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  depth: number;
  role: 0 | 1 | 2 | null;
  insertion_order: number;
  scan_depth: number | null;
  exclude_recursion: boolean;
  prevent_recursion: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS & REPORT
// ═══════════════════════════════════════════════════════════════════════════

export type RefinerPhase =
  | 'idle'
  | 'pre_analysis'   // Phase 1: Local scan
  | 'ai_analysis'    // Phase 2: AI batch analysis
  | 'preview'        // Chờ user xem preview
  | 'applying'       // Phase 4: Apply actions
  | 'done'
  | 'error'
  | 'stopped';

export interface RefinerProgress {
  phase: RefinerPhase;
  currentBatch: number;
  totalBatches: number;
  actionsFound: number;
  actionsApplied: number;
  message: string;
}

export interface RefinerReport {
  totalAnalyzed: number;
  actionsProposed: number;
  actionsApplied: number;
  actionsSkipped: number;
  uidFixed: number;
  entriesAdded: number;
  entriesModified: number;
  entriesDeleted: number;
  entriesMerged: number;
  duration: number; // ms
}
