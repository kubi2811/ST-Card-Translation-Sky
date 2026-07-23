/**
 * (User 23/07 — bug 91) "Tạo thẻ từ truyện: nội dung đầu ra cũng như các nhân vật BẮT BUỘC
 * phải được dịch sang tiếng Việt."
 *
 * Prompt đã dặn dịch, nhưng dặn không phải là bảo đảm — model vẫn hay bê nguyên tên gốc.
 * Module này là lưới an toàn THUẦN LUẬT: đo xem đầu ra còn chữ Hán/Kanji/Hangul không, để
 * pipeline biết mà bắt AI làm lại thay vì đưa thẻ nửa Trung nửa Việt cho user.
 *
 * Không tự dịch — dịch máy tên riêng dễ ra sai hơn là để AI làm lại có yêu cầu rõ ràng.
 */

/** Hán (CJK Unified + mở rộng A) · Kana · Hangul. KHÔNG tính dấu câu toàn rộng. */
const CJK_CHAR = /[㐀-䶿一-鿿぀-ヿ가-힯]/;
const CJK_GLOBAL = new RegExp(CJK_CHAR.source, 'g');

/** Macro và chỗ giữ chỗ phải bỏ qua — chúng cố ý không dịch. */
const IGNORED = /\{\{[^}]*\}\}|<[^>]+>/g;

export function hasCjk(text: string): boolean {
  return CJK_CHAR.test(String(text ?? '').replace(IGNORED, ''));
}

/** Đếm số ký tự CJK còn sót (đã bỏ qua macro). */
export function countCjk(text: string): number {
  return (String(text ?? '').replace(IGNORED, '').match(CJK_GLOBAL) ?? []).length;
}

/** Lấy vài mẫu chữ Hán còn sót kèm ngữ cảnh — để báo cho user biết sót ở đâu. */
export function sampleCjk(text: string, max = 5): string[] {
  const clean = String(text ?? '').replace(IGNORED, ' ');
  const out: string[] = [];
  const seen = new Set<string>();
  // Gom các cụm CJK liền nhau thành một mẫu ("夏冬" chứ không phải "夏" rồi "冬").
  for (const m of clean.matchAll(new RegExp(`${CJK_CHAR.source}+`, 'g'))) {
    const word = m[0];
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

export interface CjkReport {
  clean: boolean;
  total: number;
  /** Từng chỗ dính, theo tên trường — để chỉ đúng cho user. */
  fields: { field: string; count: number; samples: string[] }[];
}

/** Quét một object phẳng (tên trường → nội dung) tìm chữ Hán còn sót. */
export function scanCjkResidue(parts: Record<string, string | string[] | undefined>): CjkReport {
  const fields: CjkReport['fields'] = [];
  let total = 0;

  for (const [field, raw] of Object.entries(parts)) {
    if (!raw) continue;
    const text = Array.isArray(raw) ? raw.join('\n') : raw;
    const n = countCjk(text);
    if (n === 0) continue;
    total += n;
    fields.push({ field, count: n, samples: sampleCjk(text) });
  }

  return { clean: total === 0, total, fields };
}

/**
 * Câu nhắc gửi lại cho AI khi phát hiện sót — nêu ĐÍCH DANH chữ còn sót thay vì nhắc chung
 * chung, vì nhắc chung thì model hay trả lại y nguyên.
 */
export function buildCjkRetryHint(report: CjkReport): string {
  if (report.clean) return '';
  const detail = report.fields
    .map(f => `- ${f.field}: còn ${f.count} ký tự (${f.samples.join(', ')})`)
    .join('\n');
  return `【LÀM LẠI — CÒN CHỮ HÁN/KANJI/HANGUL】Bản vừa rồi chưa dịch hết:
${detail}
Dịch TẤT CẢ những chỗ trên sang tiếng Việt (tên riêng chữ Hán → âm Hán Việt, tên Nhật → Romaji,
tên Hàn → Romanization). Giữ nguyên bố cục và các tag; chỉ giữ macro {{user}}, {{char}}.`;
}
