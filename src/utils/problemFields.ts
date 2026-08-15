/**
 * src/utils/problemFields.ts — (bug 211) GOM "MỤC CHƯA ĐẠT" VỀ MỘT DANH SÁCH DUY NHẤT.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "lỗi tự động bỏ qua khi dịch không được, và dịch bị sót tiếng Trung… vài chục entry
 * thì không thể bấm từng cái, lâu quá."
 *
 * Cái khó của bug này là "chưa đạt" nằm rải ở BA trạng thái khác nhau, mà UI chỉ đếm hai:
 *   - `error`   — đỏ, thấy được, đã có nút thử lại;
 *   - `skipped` — vàng, thấy được, đã có nút dịch lại;
 *   - `done` nhưng CÒN CHỮ HÁN — cái này mới là thủ phạm chính: mọi chốt an toàn khi bó tay
 *     đều trả về BẢN GỐC rồi đánh dấu XONG (keptOriginalOnPurpose), và các ca dịch sót lơ thơ
 *     cũng mang mác XONG. Nhìn bảng đếm thì "0 Lỗi" mà thẻ xuất ra vẫn đầy tiếng Trung.
 *
 * Hàm này trả về danh sách hợp nhất + số đếm theo loại, để UI treo MỘT nút "dịch lại tất cả
 * mục chưa đạt" thay vì bắt user dò tay từng entry. Dùng chung bộ quét chữ Hán của việc 80
 * (đã trừ link/CSS giữ nguyên/lorebook_keys) nên không bao giờ lệch định nghĩa "sót".
 */

import { scanFieldsForResidualCjk, type ResidualCjkHit, type ScanOptions } from './residualCjkScan';

/** Field tối thiểu — mở rộng ScannableField với hai cờ mà bộ gom cần. */
export interface ProblemScanField {
  path: string;
  label: string;
  group: string;
  status: string;
  original: string;
  translated?: string;
  keptOriginalOnPurpose?: boolean;
}

export type ProblemKind = 'error' | 'skipped' | 'residual';

export interface ProblemField {
  path: string;
  label: string;
  kind: ProblemKind;
  /** Có khi kind='residual' — dùng dựng câu nhắc "chỗ này còn sót" cho lượt dịch lại. */
  residual?: ResidualCjkHit;
}

export interface ProblemSummary {
  problems: ProblemField[];
  counts: { error: number; skipped: number; residual: number; total: number };
}

/**
 * Gom mọi field chưa đạt. `ignored` (user chủ động không dịch) và pending/translating không tính.
 * Field `keptOriginalOnPurpose` KHÔNG cần nhánh riêng: bản "dịch" của nó chính là bản gốc đầy
 * chữ Hán nên bộ quét residual tóm được — một định nghĩa "sót" duy nhất, khỏi hai nguồn sự thật.
 */
export function collectProblemFields(
  fields: ProblemScanField[],
  opts: ScanOptions = {},
): ProblemSummary {
  const problems: ProblemField[] = [];
  const byPath = new Map<string, ProblemField>();

  const residualHits = scanFieldsForResidualCjk(fields, opts);
  /* ═══ (bug 237) BỎ QUA MÀ KHÔNG CÒN CHỮ NGUỒN THÌ KHÔNG PHẢI "CHƯA ĐẠT" ═══
   * Bản cũ đẩy MỌI field 'skipped' vào danh sách, bất kể còn ký tự hệ chữ nguồn hay không.
   * Chạy thật thẻ 237: `data.name` = "Counterfeit" và `tavernHelper[0].content` =
   * `import 'https://…/bundle.js'` — cả hai KHÔNG có một chữ Hán nào — bị lôi vào, mỗi cái đốt
   * 5 lượt gọi AI, rồi in dòng đỏ "✗ vẫn chưa đạt sau 5 lượt". Trong khi đó ba entry lorebook
   * còn nguyên 2.975 chữ Hán phải xếp hàng chờ.
   *
   * Hại thật sự không phải mấy lượt gọi phí, mà là DẤU ✗ MẤT NGHĨA: user thấy "thất bại" trên
   * một cái tên riêng không có gì để dịch thì lần sau sẽ bỏ qua cả dấu ✗ thật — đúng cái cách
   * lớp bug 234 ẩn mình.
   *
   * Nên 'skipped' chỉ vào danh sách khi bộ quét chữ Hán sót cũng gọi tên nó. Muốn soi lại MỌI
   * mục bị máy tự bỏ (kể cả loại sạch) thì đã có chip lọc "Bỏ qua" riêng của bug 176 — hai việc
   * khác nhau, không nên nhét vào một nút.
   * `error` thì giữ nguyên: lỗi mạng là lỗi thật, không phụ thuộc còn chữ Hán hay không. */
  const residualPaths = new Set(residualHits.map(h => h.path));
  for (const f of fields || []) {
    if (f.status === 'error') problems.push({ path: f.path, label: f.label, kind: 'error' });
    else if (f.status === 'skipped' && residualPaths.has(f.path)) {
      problems.push({ path: f.path, label: f.label, kind: 'skipped' });
    }
  }
  for (const p of problems) byPath.set(p.path, p);

  for (const h of residualHits) {
    /* (bug 234) Bộ quét nay soi cả field 'skipped' (bản "dịch" của nó chính là bản gốc tiếng
     * Trung). Một field như thế khớp CẢ HAI nguồn, nên nếu cứ push thêm là nó bị đếm hai lần —
     * bảng "chưa đạt" phồng lên gấp đôi và user không hiểu con số ở đâu ra.
     * Chỉ giữ MỘT dòng cho mỗi field, nhưng gắn kèm chứng cứ đoạn còn sót vào dòng đã có để lượt
     * dịch lại vẫn được nhắc đích danh chỗ nào chưa dịch. */
    const existing = byPath.get(h.path);
    if (existing) { existing.residual = h; continue; }
    const p: ProblemField = { path: h.path, label: h.label, kind: 'residual', residual: h };
    problems.push(p);
    byPath.set(h.path, p);
  }

  const counts = {
    error: problems.filter(p => p.kind === 'error').length,
    skipped: problems.filter(p => p.kind === 'skipped').length,
    residual: problems.filter(p => p.kind === 'residual').length,
    total: problems.length,
  };
  return { problems, counts };
}
