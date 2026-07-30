/**
 * ejsPresetAttribution.ts — (bug 162 mục 3.1) DÒNG KẾ HOẠCH NÀY DO PRESET NÀO SINH RA?
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "mỗi thay đổi hiện chỉ có mũi tên nhỏ kiểu 'Luôn bật → Theo từ khoá' hoặc nhãn
 * 'Tách'/'Tạo mới' — không ghi rõ mục đó đang áp đúng Preset Nhanh nào trong 19 preset đã có, nên
 * phải tự đoán qua icon hay nội dung lý do."
 *
 * Đúng: bảng kế hoạch vốn không mang thông tin này, vì bấm preset chỉ đổ ra một chuỗi goal rồi AI
 * dựng kế hoạch từ đó — danh tính preset rơi mất ngay ở bước đầu.
 *
 * NGUYÊN TẮC CỦA FILE NÀY: THÀ KHÔNG GẮN NHÃN CHỨ KHÔNG GẮN SAI.
 * Nhãn sai còn tệ hơn không có nhãn — user sẽ đi tìm hiểu sai preset, rồi kết luận sai về công cụ.
 * Nên chỉ hai đường được phép gắn:
 *   1. Chạy MỘT preset → mọi dòng thuộc đúng preset đó. Không suy luận gì, chắc chắn đúng.
 *   2. Chạy gói tổng → suy từ CHÍNH loại thay đổi của dòng (action + chuyển đổi chế độ kích hoạt),
 *      vì mỗi loại thay đổi chỉ do một preset phụ trách. Loại nào không thuộc về ai rõ ràng thì để
 *      TRỐNG, không đoán.
 */
import type { EjsPlanRow, ActivationMode } from './ejsPlanModel';
import { QUICK_PRESETS } from './ejsQuickPresets';

export interface PresetLabel { presetId: string; presetTitle: string }

const titleOf = (id: string): string => QUICK_PRESETS.find((p) => p.id === id)?.title ?? id;

/**
 * Suy preset từ loại thay đổi — chỉ dùng khi chạy GÓI TỔNG.
 * Bảng dưới đây bám vào việc mỗi preset phụ trách một loại thao tác riêng:
 *   • hạ entry "Luôn bật" xuống nhẹ hơn      → save-tokens
 *   • chuyển sang kích hoạt bằng từ khoá     → keyword-npc
 *   • tắt sẵn, để controller bật bằng activewi → conditional-lore
 *   • tách entry gộp                          → split-bloated
 * Trả null khi không chắc.
 */
export function inferPresetFromRow(row: EjsPlanRow): string | null {
  if (row.action === 'split_entry') return 'split-bloated';
  if (row.action === 'reclassify') {
    const from: ActivationMode | null = row.currentMode;
    const to: ActivationMode | null = row.proposedMode;
    if (!to) return null;
    if (to === 'conditional' || to === 'disabled') return 'conditional-lore';
    if (to === 'keyword') return from === 'constant' ? 'save-tokens' : 'keyword-npc';
    return null;
  }
  // create_ejs / edit_content / edit_character: một dòng "tạo khối EJS" có thể đến từ rất nhiều
  // preset khác nhau (bảng trạng thái, khối biến, giọng điệu, watchdog…). Không có căn cứ tất định
  // nào để phân biệt, nên KHÔNG đoán.
  return null;
}

/**
 * Gắn nhãn preset cho từng dòng kế hoạch.
 * @param activePresetIds preset user đã chọn. Đúng 1 phần tử ⇒ gán thẳng cho mọi dòng.
 */
export function attributePlanRows(rows: EjsPlanRow[], activePresetIds: string[]): EjsPlanRow[] {
  const ids = activePresetIds.filter(Boolean);

  return rows.map((r) => {
    // Đường 0 (bug 168 mục 2) — AI TỰ KHAI, ưu tiên tuyệt đối.
    // Prompt đã dạy AI đọc dấu [preset: mã] ở đầu mỗi mục và khai lại theo từng dòng, và
    // parseRichPlan chỉ nhận mã CÓ THẬT trong yêu cầu. Lời khai đó đáng tin hơn mọi suy luận
    // phía client, nên tới đây thì giữ nguyên — trước đây nhánh dưới ghi đè undefined lên nó,
    // đúng là lý do phần lớn dòng về lại trắng nhãn.
    if (r.presetId) return { ...r, presetTitle: r.presetTitle || titleOf(r.presetId) };

    // Đường 1: chạy đúng MỘT preset lẻ → mọi dòng còn lại đều của nó, không cần suy luận.
    if (ids.length === 1 && ids[0] !== 'full-suite') {
      return { ...r, presetId: ids[0], presetTitle: titleOf(ids[0]) };
    }

    // Đường 2: gói tổng (hoặc nhiều preset cùng lúc) → suy từ loại thay đổi, không chắc thì để trống.
    const guess = inferPresetFromRow(r);
    if (!guess) return { ...r, presetId: undefined, presetTitle: undefined };
    // Chọn nhiều preset lẻ mà loại thay đổi lại không thuộc preset nào đã chọn thì đừng gán —
    // gán vào một preset user KHÔNG chọn là nói sai về việc đang chạy.
    if (ids.length > 1 && !ids.includes(guess)) return { ...r, presetId: undefined, presetTitle: undefined };
    return { ...r, presetId: guess, presetTitle: titleOf(guess) };
  });
}
