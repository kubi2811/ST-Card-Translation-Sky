/**
 * ejsPresetVerify.ts — (bug 159-9) XÁC MINH PRESET NHANH ĐÃ THẬT SỰ ĐƯỢC ÁP.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "hệ thống liệt kê 20 tính năng… thực tế chỉ triển khai được 7/20… Cần có bước kiểm tra
 * tổng thể để xác minh mỗi tính năng đã chọn có tồn tại đoạn code/logic tương ứng trong Preset
 * xuất ra hay chưa, tránh tình trạng đã tick chọn nhưng không có tác dụng thực tế."
 *
 * Vì sao hụt: mỗi preset KHÔNG tự sinh mã — nó dựng một YÊU CẦU bằng lời rồi AI mới viết mã.
 * Chọn cả 20 là dồn 20 yêu cầu vào một lượt; AI làm được vài cái rồi bỏ phần còn lại, mà giao
 * diện vẫn hiện "đã bật" cho cả 20. Đó là hỏng âm thầm: không lỗi nào, chỉ là thiếu.
 *
 * Nên phép kiểm ở đây KHÔNG đoán chất lượng mã — nó chỉ trả lời một câu rất hẹp nhưng đủ hữu ích:
 * *sau khi áp, trong thẻ có dấu vết của tính năng này hay không?* Mỗi preset khai vài DẤU HIỆU
 * (regex trên nội dung entry). Không thấy dấu hiệu nào ⇒ báo thiếu đích danh để chạy lại đúng cái
 * đó, thay vì bắt user tự dò 20 tính năng bằng mắt.
 */

export interface VerifySource {
  /** Nội dung mọi entry lorebook sau khi áp (kể cả entry mới sinh). */
  entryContents: string[];
  /** replaceString của regex script — vài tính năng sinh mã ở đây. */
  regexContents?: string[];
}

export interface PresetVerifyRow {
  id: string;
  title: string;
  /** true = tìm thấy dấu vết trong thẻ. */
  applied: boolean;
  /** Dấu hiệu đã khớp (để user tự soi lại nếu muốn). */
  matched: string[];
}

export interface PresetVerifyResult {
  rows: PresetVerifyRow[];
  appliedCount: number;
  missing: PresetVerifyRow[];
  summary: string;
}

/**
 * DẤU HIỆU của từng preset. Cố tình đặt LỎNG (nhiều lựa chọn thay thế, không phân biệt hoa
 * thường): mục tiêu là bắt ca "hoàn toàn không có gì", không phải chấm điểm cách viết. Dấu hiệu
 * quá chặt sẽ báo thiếu oan mỗi khi AI diễn đạt hơi khác — mà báo oan thì user sẽ bỏ qua cả bảng.
 */
export const PRESET_SIGNALS: Record<string, RegExp[]> = {
  'save-tokens':      [/@@activate_?if|activewi\s*\(/i, /getvar\s*\(\s*['"]stat_data/i],
  'conditional-lore': [/<%[^%]*if\s*\(/i, /getvar\s*\(\s*['"]stat_data/i],
  'keyword-npc':      [/activewi\s*\(/i],
  'status-display':   [/<%=|<%-/, /getvar\s*\(\s*['"]stat_data/i],
  'persona-phase':    [/<%[^%]*if\s*\([^)]*(>=|<=|>|<)/i],
  'split-bloated':    [/@@activate_?if|activewi\s*\(/i],
  'mvu-sanitize':     [/\|\|\s*(0|''|""|\[\]|\{\})/, /typeof\s|Number\s*\(|String\s*\(/i],
  'mvu-summary':      [/<%[^%]*(reduce|forEach|map)\s*\(/i],
  'mvu-watchdog':     [/(chưa xác định|thiếu|cảnh báo|watchdog)/i],
  'mvu-delta':        [/(delta|thay đổi|trước đó|_prev|lastValue)/i],
  'ui-hud':           [/<div|<span/i, /getvar\s*\(\s*['"]stat_data/i],
  'ui-panel':         [/<details|<div[^>]*class/i],
  'ctx-compress':     [/(rút gọn|tóm tắt|slice\s*\(|substring\s*\()/i],
  'data-cleanup':     [/(trim\s*\(|filter\s*\(|Boolean\))/i],
  'dyn-random':       [/(Math\.random|ngẫu nhiên|random)/i],
  'dyn-timing':       [/(getvar\s*\(\s*['"]stat_data[^'"]*(giờ|ngày|thời|time|day|hour))/i],
  'orch-dynkeys':     [/activewi\s*\(|setvar\s*\(/i],
  'orch-inject':      [/@@(inject|preprocessing)|getwi\s*\(/i],
  'orch-postfix':     [/@@(postprocessing|after)/i],
};

/**
 * @param selectedIds id preset user đã chọn (hoặc cả 20 khi bấm "Áp dụng TẤT CẢ").
 * @param titles      id → tiêu đề, để câu báo đọc được tên thay vì mã.
 */
export function verifyPresetsApplied(
  selectedIds: string[],
  titles: Record<string, string>,
  src: VerifySource,
): PresetVerifyResult {
  const haystack = [...src.entryContents, ...(src.regexContents ?? [])].join('\n');

  const rows: PresetVerifyRow[] = selectedIds
    // 'full-suite' chỉ là nút gộp, bản thân nó không sinh mã gì để mà soi.
    .filter(id => id !== 'full-suite')
    .map(id => {
      const signals = PRESET_SIGNALS[id];
      if (!signals?.length) {
        // Chưa khai dấu hiệu ⇒ KHÔNG kết luận là thiếu. Thà không biết còn hơn báo oan.
        return { id, title: titles[id] ?? id, applied: true, matched: ['(chưa có dấu hiệu để soi)'] };
      }
      const matched = signals.filter(re => re.test(haystack)).map(re => String(re));
      return { id, title: titles[id] ?? id, applied: matched.length > 0, matched };
    });

  const missing = rows.filter(r => !r.applied);
  const appliedCount = rows.length - missing.length;
  return {
    rows,
    appliedCount,
    missing,
    summary: missing.length === 0
      ? `Đã kiểm ${rows.length}/${rows.length} tính năng — tính năng nào cũng có dấu vết trong thẻ.`
      : `${appliedCount}/${rows.length} tính năng có dấu vết trong thẻ. ${missing.length} tính năng chưa thấy gì: `
        + `${missing.slice(0, 8).map(m => m.title).join(' · ')}${missing.length > 8 ? ' …' : ''}`
        + ' — hãy chạy lại riêng những cái này.',
  };
}
