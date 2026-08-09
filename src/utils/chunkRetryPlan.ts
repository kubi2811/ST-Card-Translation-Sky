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

/**
 * (bug 219) Cell còn SÓT chữ Hán — dù chỉ một chữ.
 *
 * Khác hẳn findCjkHeavyChunks: hàm kia đòi >35% Hán sống sót nên nó chỉ bắt được cell "chưa
 * dịch gì cả". Ca của user là 21 cell đều đã dịch tử tế, tổng còn 106 chữ Hán rải rác — mỗi
 * cell chỉ vài chữ trên hàng nghìn, tỉ lệ ~1%, nên bộ cũ trả về RỖNG và tool đành dịch lại cả
 * field 30k (rồi mất trắng khi chốt an toàn bắt lỗi). Đây là bộ dò đúng cho ca đó: cell nào
 * còn Hán thì chính nó là cell cần dịch lại, các cell sạch không tốn một lượt gọi API nào.
 */
export function findResidualCjkChunks(
  rawChunks: string[],
  doneChunks: string[],
  minHan = 1,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const done = doneChunks[i];
    if (!raw?.trim() || !done?.trim()) continue;
    // Nguồn vốn không có Hán ⇒ Hán trong bản dịch không phải "dịch sót" (tên riêng, thuật ngữ).
    if (countHan(raw) === 0) continue;
    if (countHan(done) >= minHan) out.push(i);
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
  kind: 'syntax' | 'cjk' | 'residual',
): ChunkRetryPlan | null {
  const raw = field.rawChunks;
  const done = field.completedChunks;
  if (!raw?.length || !done?.length || raw.length !== done.length) return null;
  if (done.some(c => !c)) return null;   // đã có ô trống → đường resume sẵn có tự xử
  const suspects = kind === 'syntax'
    ? findSyntaxBrokenChunks(raw, done)
    : kind === 'cjk'
      ? findCjkHeavyChunks(raw, done)
      : findResidualCjkChunks(raw, done);
  if (suspects.length === 0) return null;
  // (bug 219) 'residual' KHÔNG áp trần "hỏng quá nửa": chữ Hán sót thường rải khắp mọi cell, mà
  // dịch lại đúng những cell đó vẫn rẻ và AN TOÀN hơn dịch tươi cả field — cell nào sạch thì
  // giữ nguyên, không có đường nào để mất bản dịch cũ.
  if (kind !== 'residual' && suspects.length > Math.max(2, Math.floor(raw.length * 0.6))) return null;
  const list = suspects.map(i => i + 1).join(', ');
  return {
    suspects,
    reason: kind === 'syntax'
      ? `cell ${list} vỡ cú pháp`
      : kind === 'cjk'
        ? `cell ${list} còn nguyên tiếng Trung`
        : `cell ${list} còn sót chữ Hán`,
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

/* ═══════════ (bug 227) NHỊP CẮT ĐỔI GIỮA HAI LƯỢT — CHỖ SINH RA "22/21 CHUNK" ═══════════
 *
 * User: "báo lỗi 20k/30k chữ hán, 22/21 chunk, dịch lại từ chunk 22… sau đó tiếp tục dịch
 * toàn bộ 21 chunk lại từ đầu (dịch lại từ đầu lần thứ N)".
 *
 * Con số 22/21 không phải lỗi hiển thị — mảng ô THẬT SỰ dài 22 trong khi lượt này chỉ cắt ra
 * 21 mảnh. Nó tới từ hai chỗ nối nhau:
 *
 *  1. Cỡ chunk THÍCH ỨNG theo số lane API (apiClient tự chia nhỏ hơn khi pool nhiều lane) —
 *     nên cùng một entry, chạy lúc cấu hình khác là ra số mảnh khác: hôm nay 22, mai 21.
 *  2. Chỗ ghi tiến trình `onChunkComplete` chỉ biết NONG mảng ra cho đủ chỉ số vừa xong, không
 *     bao giờ CẮT phần thừa của lượt trước. Lượt mới ghi đủ ô 0..20, còn ô thứ 22 của lượt cũ
 *     nằm lại nguyên đó.
 *
 * Và cái ô thừa ấy là thuốc độc: lượt sau engine thấy `mảng cũ (22) > số mảnh (21)` nên kết
 * luận "nhịp cắt đã đổi" rồi VỨT HẾT bản dịch cũ, dịch lại từ đầu. Dịch xong lại ghi 21 ô, ô
 * thứ 22 vẫn còn ⇒ lượt sau lại vứt hết. Vòng lặp không có đáy, và người dùng thấy đúng cảnh
 * "dịch lại từ đầu lần thứ N" dù bấm Dừng hay Tiếp tục bao nhiêu lần.
 *
 * Hai hàm dưới đây chữa cả hai đầu: cắt mảng về đúng nhịp ngay lúc GHI, và lúc ĐỌC thì phân
 * biệt "nhịp cắt đổi thật" với "chỉ là mảng thừa đuôi".
 */

/**
 * Ép mảng ô về ĐÚNG `total` ô: dài thì cắt, ngắn thì đệm rỗng. Gọi ở mọi chỗ ghi tiến trình.
 */
export function normalizeChunkCells(cells: (string | undefined)[] | undefined, total: number): string[] {
  const n = Math.max(0, Math.floor(total) || 0);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(cells?.[i] ?? '');
  return out;
}

export interface ChunkResumeDecision {
  mode: 'fresh' | 'resume';
  /** Mảng ô đã chuẩn hoá về đúng số mảnh của LƯỢT NÀY. */
  cells: string[];
  reason: string;
}

/**
 * Quyết định dùng lại hay bỏ bản dịch cũ khi số mảnh thay đổi.
 *
 * Luật cũ: mảng cũ DÀI HƠN ⇒ coi như nhịp cắt đổi ⇒ vứt hết. Luật đó đúng ý định nhưng sai
 * bằng chứng: mảng dài hơn có thể chỉ vì đuôi thừa chưa ai dọn, trong khi 21 mảnh đầu vẫn
 * khớp từng ký tự với lượt này. Vứt đi là đốt lại toàn bộ tiền API cho thứ đã dịch xong.
 *
 * Luật mới: hỏi BẢN RAW. Có raw của lượt trước và tiền tố khớp ⇒ nhịp cắt KHÔNG đổi, chỉ cần
 * cắt/đệm cho đúng số ô rồi dịch tiếp phần trống. Raw lệch thật, hoặc không có raw để đối
 * chiếu mà số mảnh đã khác ⇒ mới bỏ (không đoán bừa: dán nhầm đoạn còn tệ hơn dịch lại).
 */
export function decideChunkResume(
  prevCells: string[] | undefined,
  prevRaw: string[] | undefined,
  newRaw: string[],
): ChunkResumeDecision {
  const total = newRaw.length;
  if (!prevCells?.length) return { mode: 'fresh', cells: normalizeChunkCells([], total), reason: 'chưa có bản dịch cũ' };

  const overlap = Math.min(prevRaw?.length ?? 0, total);
  if (overlap > 0) {
    for (let i = 0; i < overlap; i++) {
      if (prevRaw![i] !== newRaw[i]) {
        return { mode: 'fresh', cells: normalizeChunkCells([], total), reason: `mảnh gốc số ${i + 1} khác lượt trước — nhịp cắt đã đổi thật` };
      }
    }
    const note = prevCells.length > total
      ? `cắt bỏ ${prevCells.length - total} ô thừa của lượt trước`
      : prevCells.length < total
        ? `đệm thêm ${total - prevCells.length} ô mới`
        : 'nhịp cắt khớp';
    return { mode: 'resume', cells: normalizeChunkCells(prevCells, total), reason: note };
  }

  // Không có raw cũ để đối chiếu: chỉ dám dùng lại khi số ô trùng khít.
  if (prevCells.length !== total) {
    return { mode: 'fresh', cells: normalizeChunkCells([], total), reason: `không có mảnh gốc cũ để đối chiếu mà số mảnh đã đổi (${prevCells.length} → ${total})` };
  }
  return { mode: 'resume', cells: normalizeChunkCells(prevCells, total), reason: 'số mảnh trùng khít' };
}

/**
 * (bug 220) KHOANH CHUNK HỎNG THEO MỘT PHÉP THỬ BẤT KỲ.
 *
 * User: "tớ dịch tavern helper lớn nó bị lặp nghi bịa AI giống cái này 74 chunk, sai có 1 chunk
 * mà nó cứ dịch đi dịch lại toàn bộ 74 chunk."
 *
 * Bản 207 đã dạy engine khoanh vùng, nhưng chỉ cho HAI cổng: vỡ cú pháp và còn tiếng Trung.
 * Các cổng còn lại — nghi bịa code, lệch khối EJS, bản dịch quá ngắn — vẫn trả 'retry' trần,
 * và "retry" của một field đã đủ ô nghĩa là gọi AI lại TỪ ĐẦU cho từng ô một. Với bundle
 * webpack 765KB chia 74 mảnh thì một lỗi ở mảnh thứ 40 kéo theo 74 lượt gọi, lặp tới khi hết
 * lượt thử. Tiền và thời gian đổ vào 73 mảnh vốn đã đúng.
 *
 * Hàm này để mọi cổng đều khoanh được, bằng cách nhận VỊ TỪ thay vì tự biết cách kiểm: caller
 * (nơi đã có sẵn bộ dò của cổng đó) truyền vào phép thử, ở đây chỉ lo phần đối chiếu từng cặp
 * ô gốc/ô dịch và bỏ qua ô rỗng. Nhờ vậy module này không phải kéo theo bộ dò nào.
 */
export function findChunksFailing(
  rawChunks: string[] | undefined,
  doneChunks: string[] | undefined,
  isBad: (raw: string, done: string, index: number) => boolean,
): number[] {
  if (!rawChunks?.length || !doneChunks?.length || rawChunks.length !== doneChunks.length) return [];
  const out: number[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const done = doneChunks[i];
    if (!raw?.trim() || !done?.trim()) continue;
    // Ô trả về NGUYÊN bản gốc là ô chốt an toàn giữ lại — không phải ô hỏng.
    if (done === raw) continue;
    try {
      if (isBad(raw, done, i)) out.push(i);
    } catch {
      /* bộ dò ném thì coi như không kết luận được — thà bỏ sót còn hơn xoá nhầm ô đang tốt */
    }
  }
  return out;
}
