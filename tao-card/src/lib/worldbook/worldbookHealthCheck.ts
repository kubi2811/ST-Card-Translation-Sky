/**
 * worldbookHealthCheck.ts — Kiểm tra cấu hình Worldbook theo guide
 * Quét toàn bộ entries, trả về danh sách cảnh báo + auto-fix suggestions
 */

import type { LorebookEntry } from '../../types/lorebook.types';
import type { CardType } from './worldbookConfig';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthWarning {
  entryId: number;
  comment: string;
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  autoFixable: boolean;
  fix?: {
    // Entry-level patches
    id?: number;
    keys?: string[];
    secondary_keys?: string[];
    constant?: boolean;
    selective?: boolean;
    insertion_order?: number;
    // Extension-level patches (flat — merged into entry.extensions)
    extensions?: Record<string, unknown>;
  };
}

export interface HealthReport {
  errors: number;
  warnings: number;
  infos: number;
  items: HealthWarning[];
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Phát hiện dấu phẩy full-width (，) trong keys */
function hasFullWidthComma(keys: string[]): boolean {
  return keys.some(k => k.includes('，'));
}

/** Phát hiện khoảng trắng sau dấu phẩy trong keys (phải check raw string) */
function hasSpaceAfterComma(keys: string[]): boolean {
  // Trường hợp keys đã được tách thành array → check key bắt đầu/kết thúc bằng space
  return keys.some(k => k.startsWith(' ') || k.endsWith(' '));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

export async function checkWorldbookHealth(
  entries: LorebookEntry[],
  cardType: CardType,
): Promise<HealthReport> {
  const items: HealthWarning[] = [];
  const seenIds = new Set<number>();
  let currentMaxId = entries.length > 0 ? Math.max(...entries.map(e => e.id)) : 0;

  for (const entry of entries) {
    // ─── 0. Check duplicate UID ──────────────────────────────────────
    if (seenIds.has(entry.id)) {
      currentMaxId++;
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'error',
        code: 'DUPLICATE_UID',
        message: `Bị trùng mã UID (${entry.id}) với mục khác. Gây lỗi khi xóa hoặc cập nhật.`,
        autoFixable: true,
        fix: { 
          id: currentMaxId,
          extensions: { display_index: currentMaxId }
        },
      });
    } else {
      seenIds.add(entry.id);
    }

    if (!entry.enabled) continue; // Skip disabled entries

    const ext = entry.extensions;

    // ─── 1. Đệ quy chưa bật ─────────────────────────────────────────
    if (!ext.exclude_recursion || !ext.prevent_recursion) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'error',
        code: 'RECURSION_OFF',
        message: 'Đệ quy chưa bật đầy đủ. Guide: TẤT CẢ entries phải bật exclude_recursion + prevent_recursion.',
        autoFixable: true,
        fix: { extensions: { exclude_recursion: true, prevent_recursion: true } },
      });
    }

    // ─── 2. Thẻ đơn + entry nhân vật dùng selective (quy luật thép) ──
    // Heuristic: nếu comment chứa "_Tính cách", "_Ngoại hình", "_Bối cảnh",
    // "_NSFW", "_Thông tin" và cardType=single → phải constant
    if (cardType === 'single' && !entry.constant && isCharacterDetailEntry(entry)) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'error',
        code: 'SINGLE_CARD_NOT_CONSTANT',
        message: 'Thẻ nhân vật đơn: entry nhân vật PHẢI constant=true (quy luật thép). Đang để selective.',
        autoFixable: true,
        fix: { constant: true, selective: false },
      });
    }

    // ─── 3. Keywords dùng dấu phẩy full-width ────────────────────────
    if (hasFullWidthComma(entry.keys) || hasFullWidthComma(entry.secondary_keys)) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'error',
        code: 'FULLWIDTH_COMMA',
        message: 'Keywords dùng dấu phẩy full-width (，). Phải dùng dấu phẩy tiếng Anh (,).',
        autoFixable: true,
        fix: {
          keys: entry.keys.flatMap(k => k.split('，')).map(k => k.trim()).filter(Boolean),
          secondary_keys: entry.secondary_keys.flatMap(k => k.split('，')).map(k => k.trim()).filter(Boolean),
        },
      });
    }

    // ─── 4. Keywords có khoảng trắng thừa ────────────────────────────
    if (hasSpaceAfterComma(entry.keys) || hasSpaceAfterComma(entry.secondary_keys)) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'warning',
        code: 'KEYWORD_SPACE',
        message: 'Keywords có khoảng trắng thừa (đầu/cuối). Có thể làm keyword không kích hoạt.',
        autoFixable: true,
        fix: {
          keys: entry.keys.map(k => k.trim()),
          secondary_keys: entry.secondary_keys.map(k => k.trim()),
        },
      });
    }

    // ─── 5. Entry xanh lá không có keyword ───────────────────────────
    if (!entry.constant && entry.selective && entry.keys.length === 0) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'error',
        code: 'SELECTIVE_NO_KEYS',
        message: 'Entry xanh lá (selective) nhưng không có keyword. Entry sẽ KHÔNG BAO GIỜ được kích hoạt.',
        autoFixable: false,
      });
    }

    // ─── 6. Insertion order bất hợp lý ───────────────────────────────
    // Worldview ở after_char hoặc NPC ở before_char
    if (entry.constant && ext.position === 1 && entry.insertion_order <= 3) {
      // Có thể là worldview đặt sai vị trí (after_char thay vì before_char)
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'warning',
        code: 'POSITION_MISMATCH',
        message: `Entry thường trú (order=${entry.insertion_order}) ở after_char. Thế giới quan nên đặt ở before_char (position 0).`,
        autoFixable: true,
        fix: { extensions: { position: 0 } },
      });
    }

    // ─── 7. D0 entry không set role=system ───────────────────────────
    if (ext.position === 4 && ext.depth === 0 && ext.role !== 0) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'warning',
        code: 'D0_NOT_SYSTEM',
        message: 'Entry D0 (depth=0) nên set role=system để có hiệu quả chỉ đạo tốt nhất.',
        autoFixable: true,
        fix: { extensions: { role: 0 } },
      });
    }

    // ─── 8. D1+ entry tồn tại ────────────────────────────────────────
    if (ext.position === 4 && ext.depth > 0) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'error',
        code: 'DEPTH_NOT_ZERO',
        message: `Entry @depth=${ext.depth}. Guide: KHÔNG dùng D1+ — chỉ D0 mới an toàn. D1+ phá vỡ lịch sử chat.`,
        autoFixable: true,
        fix: { extensions: { depth: 0, role: 0 } },
      });
    }

    // ─── 9. scan_depth=null cho entry xanh lá ────────────────────────
    if (!entry.constant && entry.selective && ext.scan_depth === null) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'info',
        code: 'SCAN_DEPTH_NULL',
        message: 'Entry xanh lá chưa set scan_depth. Khuyến nghị đặt 2 (quét 2 tin nhắn gần nhất).',
        autoFixable: true,
        fix: { extensions: { scan_depth: 2 } },
      });
    }

    // ─── 10. Keyword chỉ có 1 từ khóa cho NPC/character ─────────────
    if (!entry.constant && entry.selective && entry.keys.length === 1) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'info',
        code: 'FEW_KEYWORDS',
        message: 'Chỉ có 1 keyword. Guide: nên bao phủ tất cả cách gọi (tên đầy đủ, biệt danh, ngoại hiệu, chức vụ).',
        autoFixable: false,
      });
    }

    // ─── 11. (Tawa 2.0) sticky/cooldown/delay trên entry THƯỜNG TRÚ ──
    // Ba số này đếm theo lượt KỂ TỪ KHI ENTRY ĐƯỢC KÍCH HOẠT. Entry constant luôn nằm sẵn trong
    // context, không có "lúc kích hoạt" nào để đếm — đặt vào chỉ làm file rối, không đổi hành vi.
    if (entry.constant && (ext.sticky > 0 || ext.cooldown > 0 || ext.delay > 0)) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'info',
        code: 'TIMING_ON_CONSTANT',
        message: `Entry thường trú (constant) mà đặt sticky=${ext.sticky}/cooldown=${ext.cooldown}/delay=${ext.delay}. Ba số này chỉ có tác dụng với entry kích hoạt theo từ khoá.`,
        autoFixable: true,
        fix: { extensions: { sticky: 0, cooldown: 0, delay: 0 } },
      });
    }

    // ─── 12. (Tawa 2.0) selectiveLogic khác AND ANY mà không có key phụ ──
    // AND ALL / NOT ALL / NOT ANY đều so trên TẬP key phụ. Thiếu tập đó thì luật hoặc vô hiệu,
    // hoặc tệ hơn: chặn sạch không cho entry nổ lần nào — hỏng im lặng đúng nghĩa.
    if (ext.selectiveLogic !== 0 && entry.secondary_keys.length === 0) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'warning',
        code: 'LOGIC_NO_SECONDARY',
        message: `selectiveLogic=${ext.selectiveLogic} (khác AND ANY) nhưng không có secondary key nào để so — entry có thể không bao giờ kích hoạt.`,
        autoFixable: true,
        fix: { extensions: { selectiveLogic: 0 } },
      });
    }

    // ─── 13. (Tawa 2.0) Key ngắn mà không khớp trọn từ ───────────────
    // Ca kinh điển của tiếng Việt: key "nam" bắt trúng "việt nam", "nam châm", "giám đốc nam".
    if (!entry.constant && ext.match_whole_words !== true) {
      const shortKeys = entry.keys.filter(k => !k.includes(' ') && k.trim().length > 0 && k.trim().length <= 4);
      if (shortKeys.length > 0) {
        items.push({
          entryId: entry.id,
          comment: entry.comment,
          level: 'info',
          code: 'SHORT_KEY_PARTIAL_MATCH',
          message: `Key ngắn (${shortKeys.join(', ')}) mà chưa bật "khớp trọn từ" — dễ nổ nhầm khi nằm trong từ khác.`,
          autoFixable: true,
          fix: { extensions: { match_whole_words: true } },
        });
      }
    }

    // ─── 14. (Tawa 2.0) probability < 100 mà quên bật useProbability ──
    if (ext.probability < 100 && !ext.useProbability) {
      items.push({
        entryId: entry.id,
        comment: entry.comment,
        level: 'warning',
        code: 'PROBABILITY_IGNORED',
        message: `Đặt probability=${ext.probability} nhưng useProbability=false — SillyTavern bỏ qua con số này, entry vẫn nạp 100%.`,
        autoFixable: true,
        fix: { extensions: { useProbability: true } },
      });
    }
  }

  // ─── 15. (Tawa 2.0) Lạm dụng thẻ VIP ignore_budget ────────────────
  // ignore_budget ép entry vào context KỂ CẢ khi ngân sách World Info đã cạn. Vài cái thì tiện,
  // nhiều cái thì chính nó ăn hết cửa sổ context và AI quên sạch lịch sử chat — đúng thứ ngân
  // sách sinh ra để chặn.
  const vip = entries.filter(e => e.enabled && e.extensions.ignore_budget);
  if (vip.length > 3) {
    for (const e of vip) {
      items.push({
        entryId: e.id,
        comment: e.comment,
        level: 'warning',
        code: 'IGNORE_BUDGET_ABUSE',
        message: `${vip.length} entry đang bật ignore_budget (thẻ VIP). Nên giữ tối đa 2-3 cho luật tuyệt đối/persona — nhiều hơn là tự làm tràn context.`,
        autoFixable: false,
      });
    }
  }

  // ─── 16. Minh Nguyệt: Bát cổ + Tag (nếu có qualityChecker) ────
  try {
    const { runQualityCheck } = await import('../validation/qualityChecker');
    const qReport = runQualityCheck(entries);

    // Chuyển quality issues thành health warnings
    for (const issue of qReport.issues) {
      // Chỉ lấy error/warning, skip info để tránh quá nhiều noise
      if (issue.level === 'info') continue;

      items.push({
        entryId: issue.entryId ?? -1,
        comment: issue.entryComment ?? '',
        level: issue.level,
        code: `MN_${issue.category.toUpperCase()}_${issue.id.split('_')[0]}`,
        message: `[Minh Nguyệt] ${issue.message}`,
        autoFixable: false,
      });
    }
  } catch {
    // qualityChecker import failed — skip silently
  }

  return {
    errors: items.filter(i => i.level === 'error').length,
    warnings: items.filter(i => i.level === 'warning').length,
    infos: items.filter(i => i.level === 'info').length,
    items,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HEURISTIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Heuristic: entry này có phải là chi tiết nhân vật không? */
function isCharacterDetailEntry(entry: LorebookEntry): boolean {
  const c = entry.comment.toLowerCase();
  const detailPatterns = [
    '_tính cách', '_ngoại hình', '_bối cảnh', '_nsfw',
    '_thông tin', '_cơ bản', '_personality', '_appearance',
    '_background', '_detail', '_skills', '_kỹ năng',
  ];
  // Nếu comment chứa pattern chia nhỏ nhân vật → đây là entry nhân vật
  if (detailPatterns.some(p => c.includes(p))) return true;

  // Nếu entry ở after_char (pos 1) với order 10-99 và có nội dung dài → có thể là nhân vật
  if (entry.extensions.position === 1 &&
      entry.insertion_order >= 10 &&
      entry.insertion_order < 100 &&
      entry.content.length > 200) {
    return true;
  }

  return false;
}
