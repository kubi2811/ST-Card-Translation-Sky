/**
 * src/utils/chunkRetryPlan.ts — (bug 207) DỊCH LẠI NHẮM ĐÍCH + GỘP TIẾN TRÌNH CHUNK.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật của user: entry tavernHelper 236k chia 21 chunk, dịch xong 21/21, ghép lại thì cổng
 * cú pháp JS bắt "vỡ cú pháp → dịch lại". Vấn đề: khi MỌI Ô ĐỀU ĐẦY thì cơ chế resume của
 * engine coi là "không có gì để resume" ⇒ lượt "dịch lại" đó gọi AI lại TOÀN BỘ 21 chunk
 * (nhân verifySeams + residual check là hàng chục phút MỖI vòng, tối đa 3-8 vòng) — đúng cảm
 * giác "treo vô hạn", và đúng lời user: "thay vì dịch các chỗ lỗi thì lại dịch lại từ đầu".
 *
 * Cách sửa ở module này: TRƯỚC khi trả 'retry', KHOANH VÙNG chunk hỏng bằng máy rồi chỉ xoá
 * đúng các ô đó — lượt sau resume tự động chỉ dịch lại phần hỏng (1-2 call thay vì 21):
 *   • lỗi CÚ PHÁP: từ bug 203, chunk được cắt theo ranh giới AST nên đa số cell tự parse được;
 *     cell gốc parse sạch mà cell dịch parse vỡ ⇒ chính nó là thủ phạm.
 *   • lỗi CÒN CHỮ HÁN: đo tỉ lệ Hán sống sót TRÊN TỪNG CELL — cell nào >35% là cell chưa dịch
 *     (kể cả cell bị chốt an toàn trả về nguyên gốc).
 * Không khoanh được (lỗi nằm ở mối nối, dữ liệu chunk không đủ) ⇒ trả null, caller giữ hành vi
 * cũ (dịch lại cả field) — không bao giờ tệ hơn hiện trạng.
 *
 * Kèm mergeChunkProgress: chống ca "mảng thưa đè mảng đầy" — lượt chạy mới lỗi giữa chừng ném
 * ChunkError mang mảng toàn '' (vì lượt đó không resume), hook ghi đè thẳng lên 21 ô tốt trong
 * store ⇒ mất trắng. Gộp theo chỉ số: ô mới có chữ thì lấy mới, ô mới rỗng thì GIỮ ô cũ.
 */
import { jsParseErrorAny } from './scriptSafety';
import { stripUrlsForCjkCheck } from './cjk';

const HAN_RE_G = /[一-鿿㐀-䶿]/g;
const countHan = (s: string) => (stripUrlsForCjkCheck(s).match(HAN_RE_G) ?? []).length;

export interface ChunkRetryPlan {
  /** Chỉ số (0-based) các chunk cần dịch lại. */
  suspects: number[];
  reason: string;
}

/** Cell gốc parse sạch mà cell dịch parse vỡ ⇒ chunk đó làm hỏng cú pháp bản ghép. */
export function findSyntaxBrokenChunks(rawChunks: string[], doneChunks: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const done = doneChunks[i];
    if (!raw?.trim() || !done?.trim() || done === raw) continue;
    if (jsParseErrorAny(raw) !== null) continue;   // cell gốc không tự đứng được → không kết luận được
    if (jsParseErrorAny(done) !== null) out.push(i);
  }
  return out;
}

/** Cell còn >35% chữ Hán sống sót (hoặc bị trả về nguyên gốc) ⇒ cell chưa dịch. */
export function findCjkHeavyChunks(rawChunks: string[], doneChunks: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const done = doneChunks[i];
    if (!raw?.trim() || !done?.trim()) continue;
    const srcHan = countHan(raw);
    if (srcHan < 10) continue;
    if (done === raw || countHan(done) / srcHan > 0.35) out.push(i);
  }
  return out;
}

export interface ChunkProgressLike {
  rawChunks?: string[];
  completedChunks?: string[];
}

/**
 * Lập kế hoạch dịch lại NHẮM ĐÍCH cho một field đã đủ chunk. Trả null khi:
 * dữ liệu chunk không đủ/không khớp nhịp, còn ô trống (resume tự lo), không khoanh được
 * chunk hỏng, hoặc hỏng cả loạt (dịch lại cả field còn hơn).
 */
export function planTargetedChunkRetry(
  field: ChunkProgressLike,
  kind: 'syntax' | 'cjk',
): ChunkRetryPlan | null {
  const raw = field.rawChunks;
  const done = field.completedChunks;
  if (!raw?.length || !done?.length || raw.length !== done.length) return null;
  if (done.some(c => !c)) return null;   // đã có ô trống → đường resume sẵn có tự xử
  const suspects = kind === 'syntax'
    ? findSyntaxBrokenChunks(raw, done)
    : findCjkHeavyChunks(raw, done);
  if (suspects.length === 0) return null;
  if (suspects.length > Math.max(2, Math.floor(raw.length * 0.6))) return null; // hỏng quá nửa → thà dịch lại cả field
  return {
    suspects,
    reason: kind === 'syntax'
      ? `cell ${suspects.map(i => i + 1).join(', ')} vỡ cú pháp`
      : `cell ${suspects.map(i => i + 1).join(', ')} còn nguyên tiếng Trung`,
  };
}

/**
 * Gộp tiến trình chunk theo CHỈ SỐ — ô mới có nội dung thì lấy mới, ô mới rỗng thì giữ ô cũ.
 * Chỉ gộp khi hai mảng CÙNG NHỊP (cùng độ dài); lệch nhịp thì bản mới thắng (nhịp cắt đã đổi,
 * ô cũ không còn ứng với đoạn văn cũ — dán vào là ghép nhầm đoạn, bug 144).
 */
export function mergeChunkProgress(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] | undefined {
  if (!incoming?.length) return existing;
  if (!existing?.length || existing.length !== incoming.length) return incoming;
  return incoming.map((c, i) => (c && c.length > 0 ? c : (existing[i] ?? '')));
}
