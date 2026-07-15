/**
 * ─── Chẻ file đính kèm lớn thành các PHẦN (part) cho Trợ Lý AI ───
 *
 * (User 2026 — bug 23: "Trợ Lý AI không đọc được hết dữ liệu, chỉ ~100k ký tự rồi cắt cụt")
 * BUG CŨ: handleFileUpload cắt `content.slice(0, 100000)` NGAY LÚC UPLOAD → phần sau 100k mất
 * VĨNH VIỄN, AI không bao giờ thấy — user tưởng AI "đọc thiếu" nhưng thực ra tool đã vứt dữ liệu.
 *
 * FIX: KHÔNG cắt. File > PART_SIZE được chẻ thành nhiều PHẦN tại RANH GIỚI DÒNG (không cắt giữa
 * dòng/giữa cấu trúc JSON-YAML nếu tránh được) — tổng các phần == file gốc 100%, không mất ký tự.
 * Mỗi phần thành 1 chip đính kèm riêng (gỡ được từng phần) và được dán nhãn "PHẦN i/N" trong ngữ
 * cảnh gửi AI, khớp với kỷ luật chunking trong SYSTEM_INSTRUCTION (bug 24): xử lý dứt điểm từng
 * phần, không tóm tắt, không cắt bớt.
 */

/** Cỡ 1 phần: ~90k ký tự — đủ nhỏ để cùng system prompt + lịch sử không vượt cửa sổ ngữ cảnh. */
export const ATTACH_PART_SIZE = 90_000;

/** Tổng ký tự đính kèm khuyến nghị cho 1 lượt gọi — vượt là cảnh báo user nên gỡ bớt phần. */
export const ATTACH_TOTAL_WARN = 360_000;

export interface AttachmentPart {
  content: string;
  /** Chỉ có khi file bị chẻ: phần thứ mấy / tổng số phần (1-based). */
  part?: { index: number; total: number };
}

/**
 * Chẻ `content` thành các phần ≤ maxLen, ưu tiên cắt tại ranh giới DÒNG (\n).
 * Dòng đơn lẻ dài hơn maxLen (JSON minify 1 dòng…) buộc phải cắt cứng giữa dòng.
 * Bảo toàn 100%: parts.join('') === content.
 */
export function splitAttachmentContent(content: string, maxLen: number = ATTACH_PART_SIZE): AttachmentPart[] {
  if (content.length <= maxLen) return [{ content }];

  const chunks: string[] = [];
  let rest = content;
  while (rest.length > maxLen) {
    // Tìm \n cuối cùng trong cửa sổ maxLen; chấp nhận lùi tối đa 20% (tránh phần quá lép).
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.8) cut = maxLen; else cut = cut + 1; // +1: giữ \n ở phần trước
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);

  return chunks.map((c, i) => ({ content: c, part: { index: i + 1, total: chunks.length } }));
}

/** Nhãn hiển thị cho chip/ngữ cảnh: "tên.json" hoặc "tên.json (PHẦN 2/5)". */
export function attachmentLabel(name: string, part?: { index: number; total: number }): string {
  return part ? `${name} (PHẦN ${part.index}/${part.total})` : name;
}
