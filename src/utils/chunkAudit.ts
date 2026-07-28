/**
 * src/utils/chunkAudit.ts — (bugNeedFix/144) SOI & GHÉP LẠI CHUNK cho entry lớn.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "entry lớn tầm 10 20 chunk, đôi khi chỉ có 1-2 chunk bị lỗi… khi nối đôi khi bị thiếu
 * hụt các chunk dù chúng đã được dịch, không có nút kiểm tra thiếu chunk hay sai chunk nào,
 * cũng không có nút để tự động nối chunk lại, mà chỉ có nút dịch lại từ đầu cả entry, rất mất
 * thời gian."
 *
 * Ba việc tách hẳn ra khỏi React để test được và để nút bấm nào cũng dùng chung một thước:
 *   1. auditChunks()  — soi từng chunk, chỉ đích danh chunk nào thiếu/nghi sai VÀ vì sao.
 *   2. joinChunks()   — ghép lại đúng quy tắc engine đang dùng (HTML/code nối liền, văn xuôi
 *                       cách dòng), để nút "Ghép lại" cho ra đúng thứ engine sẽ cho.
 *   3. summarizeAudit() — câu tóm tắt tiếng Việt cho thanh trạng thái.
 *
 * Vì sao cần soi bằng MÁY trước khi nhờ AI: trong 20 chunk thì phần lớn lỗi là loại đo được
 * (rỗng, còn nguyên tiếng Trung, dài bất thường so với gốc) — bắt bằng máy thì tức thì và
 * miễn phí, chỉ những chunk máy không chắc mới đáng tốn một lượt gọi AI.
 */

/** Ký tự Hán/Nhật/Hàn — dùng để biết chunk đã thật sự được dịch chưa. */
const CJK_RE = /[一-鿿㐀-䶿぀-ヿ가-힯]/g;

export type ChunkIssueKind =
  | 'missing'        // chưa dịch / rỗng
  | 'untranslated'   // dịch xong nhưng vẫn nguyên chữ Hán ⇒ nhiều khả năng là bản gốc chép lại
  | 'too-short'      // ngắn bất thường so với chunk gốc ⇒ nghi bị cắt cụt
  | 'too-long';      // dài bất thường ⇒ nghi AI lặp lại/bịa thêm

export interface ChunkIssue {
  index: number;          // 0-based
  kind: ChunkIssueKind;
  detail: string;         // câu tiếng Việt nói rõ vì sao
}

export interface ChunkAudit {
  total: number;
  okCount: number;
  issues: ChunkIssue[];
  /** Chỉ số các chunk nên dịch lại (0-based, đã sắp tăng dần, không trùng). */
  suspectIndices: number[];
}

export interface AuditOptions {
  /** Tỉ lệ độ dài tối thiểu bản dịch / bản gốc trước khi coi là bị cắt cụt. */
  minRatio?: number;
  /** Tỉ lệ tối đa trước khi coi là phình bất thường. */
  maxRatio?: number;
  /** Tỉ lệ CJK còn sót tối đa (so với chunk gốc) trước khi coi là chưa dịch. */
  maxResidualCjk?: number;
}

/**
 * Khoảng độ dài HỢP LÝ của bản dịch so với bản gốc, tính theo mật độ chữ Hán của gốc.
 *
 * Đo trên văn bản thật: một câu tiếng Trung dịch sang tiếng Việt DÀI GẤP ~2,5-3 LẦN tính theo
 * ký tự, vì mỗi chữ Hán gánh nguyên một từ. Nếu áp một ngưỡng cố định kiểu "dài quá 2,5 lần là
 * bất thường" thì gần như CHUNK NÀO CŨNG bị báo oan và nút soi lỗi thành vô dụng. Ngược lại,
 * gốc là tiếng Anh/Việt thì độ dài xê xích quanh 1 lần, lúc đó mới siết chặt lại được.
 */
export function expectedRatioRange(src: string): { min: number; max: number } {
  const cjk = (src.match(CJK_RE) ?? []).length;
  const density = src.length > 0 ? cjk / src.length : 0;
  if (density > 0.3) return { min: 0.8, max: 6 };    // gốc chữ Hán ⇒ bản dịch nở ra là bình thường
  return { min: 0.35, max: 2.5 };                     // gốc hệ Latin ⇒ độ dài phải xấp xỉ
}

/**
 * Soi từng chunk. `raw[i]` là chunk gốc, `done[i]` là bản dịch (có thể thiếu/rỗng).
 * Chỉ so bằng những dấu hiệu ĐO ĐƯỢC — không đoán mò về nội dung.
 */
export function auditChunks(
  raw: string[],
  done: (string | undefined)[],
  opts: AuditOptions = {},
): ChunkAudit {
  const maxResidualCjk = opts.maxResidualCjk ?? 0.3;

  const total = raw.length;
  const issues: ChunkIssue[] = [];

  for (let i = 0; i < total; i++) {
    const src = raw[i] ?? '';
    const out = done[i] ?? '';

    if (!out.trim()) {
      issues.push({ index: i, kind: 'missing', detail: 'Chưa có bản dịch (rỗng) — phần này sẽ biến mất khi ghép.' });
      continue;
    }
    if (!src.trim()) continue;   // gốc rỗng thì không có gì để so

    const srcCjk = (src.match(CJK_RE) ?? []).length;
    const outCjk = (out.match(CJK_RE) ?? []).length;
    if (srcCjk > 20 && outCjk / srcCjk > maxResidualCjk) {
      issues.push({
        index: i,
        kind: 'untranslated',
        detail: `Còn ${outCjk} chữ Hán (gốc ${srcCjk}) — nhiều khả năng chunk này bị giữ nguyên bản gốc chứ chưa dịch.`,
      });
      continue;
    }

    const range = expectedRatioRange(src);
    const minRatio = opts.minRatio ?? range.min;
    const maxRatio = opts.maxRatio ?? range.max;
    const ratio = out.length / src.length;
    if (ratio < minRatio) {
      issues.push({
        index: i,
        kind: 'too-short',
        detail: `Bản dịch chỉ bằng ${Math.round(ratio * 100)}% độ dài gốc — nghi bị cắt cụt giữa chừng.`,
      });
    } else if (ratio > maxRatio) {
      issues.push({
        index: i,
        kind: 'too-long',
        detail: `Bản dịch dài gấp ${ratio.toFixed(1)} lần gốc — nghi AI lặp lại đoạn hoặc thêm nội dung.`,
      });
    }
  }

  const suspectIndices = [...new Set(issues.map(x => x.index))].sort((a, b) => a - b);
  return { total, okCount: total - suspectIndices.length, issues, suspectIndices };
}

/**
 * Ghép chunk lại ĐÚNG quy tắc engine dùng khi dịch xong (xem apiClient.translateText):
 * HTML và code nối LIỀN (thêm dấu cách/xuống dòng là phá cấu trúc), văn xuôi cách một dòng trống.
 * Nhờ dùng chung quy tắc, nút "Ghép lại" cho ra đúng thứ engine sẽ cho — không phải bản gần đúng.
 */
export function joinChunks(chunks: string[], originalText: string): string {
  const isHtml = /<[a-z][^>]*>/i.test(originalText) && /<\/[a-z]+>/i.test(originalText);
  const isCodeHeavy = /\b(function|const|let|var|=>|return)\b/.test(originalText)
    && (originalText.match(/[{};]/g) ?? []).length > 20;
  return chunks.join(isHtml || isCodeHeavy ? '' : '\n\n');
}

/** Câu tóm tắt cho thanh trạng thái — nói thẳng còn bao nhiêu chunk có vấn đề. */
export function summarizeAudit(a: ChunkAudit): string {
  if (a.total === 0) return 'Entry này không chia chunk.';
  if (a.suspectIndices.length === 0) return `Đủ và sạch: ${a.total}/${a.total} chunk đều có bản dịch hợp lý.`;
  const byKind = new Map<ChunkIssueKind, number>();
  for (const it of a.issues) byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + 1);
  const label: Record<ChunkIssueKind, string> = {
    missing: 'thiếu bản dịch',
    untranslated: 'còn nguyên tiếng Trung',
    'too-short': 'nghi cắt cụt',
    'too-long': 'nghi lặp/thừa',
  };
  const parts = [...byKind.entries()].map(([k, n]) => `${n} ${label[k]}`);
  return `${a.suspectIndices.length}/${a.total} chunk cần xem lại (${parts.join(', ')}) — chunk số ${a.suspectIndices.map(i => i + 1).join(', ')}.`;
}
