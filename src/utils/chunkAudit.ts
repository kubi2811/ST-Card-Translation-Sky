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

import { stripUrlsForCjkCheck } from './cjk';

/** Ký tự Hán/Nhật/Hàn — dùng để biết chunk đã thật sự được dịch chưa. */
const CJK_RE = /[一-鿿㐀-䶿぀-ヿ가-힯]/g;

/**
 * (bug 234) Đếm CJK SAU khi bỏ link — dùng chung định nghĩa với bộ quét chữ Hán sót của app.
 * Trước đây bảng soi chunk đếm trên text thô. Chừng nào luật còn là "sót >30% mới báo" thì vài
 * chữ Hán trong `import('https://cdn.com/骰子系统/x.js')` chìm nghỉm, không ai thấy. Nay luật siết
 * xuống "sót 1 chữ cũng nói", nếu vẫn đếm cả link thì chunk nào có link Trung cũng bị báo oan
 * đời đời — đúng lớp lỗi "báo động giả dạy người ta bỏ qua cảnh báo thật" đã trả giá ở bug 154.
 */
function countCjkNoUrl(text: string): number {
  return (stripUrlsForCjkCheck(text || '').match(CJK_RE) ?? []).length;
}

export type ChunkIssueKind =
  | 'missing'        // chưa dịch / rỗng
  | 'untranslated'   // dịch xong nhưng vẫn nguyên chữ Hán ⇒ nhiều khả năng là bản gốc chép lại
  | 'too-short'      // ngắn bất thường so với chunk gốc ⇒ nghi bị cắt cụt
  | 'too-long';      // dài bất thường ⇒ nghi AI lặp lại/bịa thêm

export interface ChunkIssue {
  index: number;          // 0-based
  kind: ChunkIssueKind;
  detail: string;         // câu tiếng Việt nói rõ vì sao
  /**
   * (bug 234) 'block' = ghép lúc này chắc chắn ra bản hỏng (thiếu chunk, chunk chép nguyên văn,
   * cắt cụt) ⇒ chặn nút Ghép. 'warn' = có tì vết nhưng ghép vẫn dùng được (sót lơ thơ vài chữ
   * Hán) ⇒ vẫn cho ghép, chỉ nói rõ, rồi để bộ vá chữ Hán sót ở cuối lượt lo nốt.
   * Phân biệt hai mức là để tránh cái bẫy ngược: chặn cứng mọi thứ thì một chunk AI chữa mãi
   * không xong sẽ khoá luôn cả entry, người dùng không ghép nổi.
   */
  severity: 'block' | 'warn';
}

export interface ChunkAudit {
  total: number;
  okCount: number;
  issues: ChunkIssue[];
  /** Chỉ số các chunk nên dịch lại (0-based, đã sắp tăng dần, không trùng). */
  suspectIndices: number[];
  /** (bug 234) Chunk mà ghép lúc này là ra bản hỏng — nút Ghép phải từ chối. */
  blockingIndices: number[];
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
      issues.push({ index: i, kind: 'missing', severity: 'block', detail: 'Chưa có bản dịch (rỗng) — phần này sẽ biến mất khi ghép.' });
      continue;
    }
    if (!src.trim()) continue;   // gốc rỗng thì không có gì để so

    const srcCjk = countCjkNoUrl(src);
    const outCjk = countCjkNoUrl(out);

    /* ═══ (bug 234) HAI LỖ LÀM BẢNG SOI CHUNK BÁO "SẠCH" CHO CHUNK CÒN TIẾNG TRUNG ═══
     * Luật cũ là MỘT dòng: `srcCjk > 20 && outCjk / srcCjk > 0.3`.
     *   (a) `srcCjk > 20` — chunk gốc ít chữ Hán thì KHÔNG BAO GIỜ được kiểm chữ sót. Chunk
     *       "boss骇爪 / 装备" bị AI trả về y nguyên vẫn lọt.
     *   (b) `> 0.3` — sót dưới 30% cũng lọt. Chunk gốc 3.000 chữ Hán còn sót 60 chữ = 2% ⇒ sạch.
     * Lọt cả hai thì chunk rơi xuống phép so ĐỘ DÀI, mà chép nguyên văn cho ratio đúng 1.0 —
     * nằm gọn trong khoảng "hợp lý" [0.8, 6]. Kết quả: nhãn XANH "Đủ và sạch", rồi nút Ghép lại
     * đóng dấu status='done' cho một field đầy tiếng Trung.
     *
     * Nay tách làm ba luật, từ nặng đến nhẹ, và bỏ hẳn sàn `srcCjk > 20`. */
    if (srcCjk > 0 && outCjk > 0) {
      // 1. Chép nguyên văn — chắc chắn chưa dịch, không cần bàn tỉ lệ.
      if (out.trim() === src.trim()) {
        issues.push({
          index: i,
          kind: 'untranslated',
          severity: 'block',
          detail: `Bản dịch GIỐNG HỆT bản gốc (${outCjk} chữ Hán) — chunk này chưa hề được dịch.`,
        });
        continue;
      }
      // 2. Sót nhiều — nghi giữ nguyên phần lớn.
      if (outCjk / srcCjk > maxResidualCjk) {
        issues.push({
          index: i,
          kind: 'untranslated',
          severity: 'block',
          detail: `Còn ${outCjk} chữ Hán (gốc ${srcCjk}) — nhiều khả năng chunk này bị giữ nguyên bản gốc chứ chưa dịch.`,
        });
        continue;
      }
      // 3. Sót lơ thơ — vẫn PHẢI nói ra. Đây là ca user báo ở bug 234: dịch được 98% rồi để lại
      //    mấy cái tiêu đề Hán, cũ thì im lặng cho qua nên "ghép lại" là chốt luôn cái sai.
      //    Chỉ 'warn': ghép vẫn cho ra bản dùng được, và bộ vá chữ Hán sót ở cuối lượt sẽ dọn nốt.
      issues.push({
        index: i,
        kind: 'untranslated',
        severity: 'warn',
        detail: `Còn ${outCjk} chữ Hán chưa dịch (gốc ${srcCjk}) — dịch sót, cần vá trước khi xuất thẻ.`,
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
        severity: 'block',
        detail: `Bản dịch chỉ bằng ${Math.round(ratio * 100)}% độ dài gốc — nghi bị cắt cụt giữa chừng.`,
      });
    } else if (ratio > maxRatio) {
      issues.push({
        index: i,
        kind: 'too-long',
        severity: 'block',
        detail: `Bản dịch dài gấp ${ratio.toFixed(1)} lần gốc — nghi AI lặp lại đoạn hoặc thêm nội dung.`,
      });
    }
  }

  const suspectIndices = [...new Set(issues.map(x => x.index))].sort((a, b) => a - b);
  const blockingIndices = [...new Set(issues.filter(x => x.severity === 'block').map(x => x.index))].sort((a, b) => a - b);
  return { total, okCount: total - suspectIndices.length, issues, suspectIndices, blockingIndices };
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

/* ═══════ (bug 226) TỰ GHÉP LẠI SAU KHI TAB BỊ GIẾT GIỮA KHÂU GHÉP ═══════
 *
 * User: "nếu trong quá trình ghép lại 21/21 chunk đã được duyệt tự động mà bị tắt do lỗi tự
 * động ngắt kết nối thì việc ghép sẽ không bao giờ được hoàn thành tự động (tool sẽ lấy bản
 * gốc và bê y nguyên qua, từ đó báo lỗi 30k chữ Hán chưa được dịch), tuy nhiên bản dịch thực
 * chất vẫn còn và được lưu trong bộ nhớ. Lúc này bấm nút ghép lại thủ công thì từ 30k chữ Hán
 * xuống còn 100-200."
 *
 * Bản vá 222 đã lo ca "khâu hậu xử lý ném lỗi" — `translateText` không ném nữa khi đã đủ chunk.
 * Nhưng nó không lo được ca này: tab bị TRÌNH DUYỆT giết, không có mã nào của tool chạy để mà
 * cứu. Mở lại, `completedChunks` còn nguyên trong bộ nhớ đã lưu, còn `translated` thì vẫn là
 * bản gốc — và bộ quét chữ Hán đọc đúng cái bản gốc ấy rồi kết luận "chưa dịch 30k chữ".
 *
 * Nên phép ghép phải chạy lại ở LÚC MỞ LẠI PHIÊN, tự động, bằng đúng `joinChunks` mà nút thủ
 * công dùng. Điều kiện nhận rất chặt — chỉ ghép khi chắc chắn TỐT HƠN thứ đang có:
 *   • đủ cell, không cell nào rỗng;
 *   • và bản ghép hoặc thay cho chỗ trống, hoặc thay cho bản gốc bê nguyên, hoặc ít chữ Hán
 *     hơn hẳn bản đang giữ.
 * Không thoả thì để nguyên: thà người dùng bấm tay còn hơn tự động ghi đè bản đang tốt.
 */

/** Mục tối thiểu mà bộ tự-ghép cần — khai hẹp để test khỏi dựng cả TranslationField. */
export interface JoinableField {
  path: string;
  label: string;
  original: string;
  translated?: string;
  completedChunks?: string[];
  totalChunks?: number;
  keptOriginalOnPurpose?: boolean;
}

export interface AutoJoinPlan {
  path: string;
  label: string;
  joined: string;
  /** Số chữ Hán trước / sau khi ghép — để log nói được con số thật. */
  hanBefore: number;
  hanAfter: number;
  reason: 'chưa có bản dịch' | 'đang là bản gốc' | 'bản ghép sạch hơn';
}

/**
 * Lập danh sách mục nên tự ghép. KHÔNG tự ghi — caller quyết định, để test kiểm được phép
 * quyết định tách khỏi việc chạm vào store.
 */
export function planAutoJoin(fields: JoinableField[]): AutoJoinPlan[] {
  const out: AutoJoinPlan[] = [];
  for (const f of fields || []) {
    if (f.keptOriginalOnPurpose) continue;              // giữ nguyên bản gốc là CÓ CHỦ Ý
    const cells = f.completedChunks;
    const total = f.totalChunks ?? cells?.length ?? 0;
    if (!cells?.length || total <= 1 || cells.length !== total) continue;
    if (cells.some((c) => !c || !c.trim())) continue;   // còn ô trống ⇒ chưa đủ để ghép

    const joined = joinChunks(cells, f.original);
    if (!joined.trim()) continue;

    const cur = f.translated ?? '';
    const hanAfter = countHanForAudit(joined);
    let reason: AutoJoinPlan['reason'] | null = null;
    if (!cur.trim()) reason = 'chưa có bản dịch';
    else if (cur === f.original) reason = 'đang là bản gốc';
    else if (countHanForAudit(cur) > hanAfter) reason = 'bản ghép sạch hơn';
    if (!reason) continue;

    out.push({ path: f.path, label: f.label, joined, hanBefore: countHanForAudit(cur), hanAfter, reason });
  }
  return out;
}

/** Đếm chữ Hán cho phép so sánh trên — dùng chung thước với phần còn lại của file. */
function countHanForAudit(s: string): number {
  return ((s || '').match(/[一-鿿㐀-䶿]/g) || []).length;
}
