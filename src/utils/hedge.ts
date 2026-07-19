/**
 * ─── HEDGE: đua 2 bản khi lượt gọi quá chậm (tail-latency) ───
 *
 * (User 2026 — "Trợ Lý AI lâu quá, có xoay key sau 15s như bên dịch không?") Logic này trước đây nằm
 * CHÔN trong translateText nên chỉ Dịch Card được hưởng; Trợ Lý AI gặp lane treo (proxy nghẽn / key bị
 * bóp) là ngồi chờ vô hạn. Tách ra thuần tuý (không đụng mạng/API) để dùng chung + test được.
 *
 * Cách chạy: bắn bản A; nếu quá `hedgeAfterMs` mà A chưa xong → bắn thêm bản B (caller cho `spawn`
 * chọn LANE KHÁC: key/provider khác) → lấy bản nào THÀNH CÔNG trước, HUỶ bản còn lại.
 * A lỗi TRƯỚC ngưỡng → ném luôn cho tầng trên retry (hedge lúc này vô ích, chỉ tốn quota).
 * Chỉ bắn thêm 1 lần và chỉ khi vượt ngưỡng ⇒ lượt gọi bình thường KHÔNG tốn call kép.
 */
export interface HedgeAttempt<T> {
  /** Promise của lượt gọi. */
  p: Promise<T>;
  /** Huỷ lượt gọi này (khi bản kia đã thắng, hoặc cả 2 hỏng). */
  abort: (reason?: string) => void;
}

export async function hedgedRace<T>(
  spawn: () => HedgeAttempt<T>,
  hedgeAfterMs: number,
  onHedge?: () => void,
  /**
   * (Bug "Aborted" 2026) Hỏi TẠI THỜI ĐIỂM chạm ngưỡng: có đáng bắn bản dự phòng không?
   * Trả false (vd: bản A ĐANG stream dữ liệu về đều — chỉ là câu trả lời dài) → không bắn B,
   * chờ A chạy nốt. Hedge vốn để cứu lane KHÔNG PHẢN HỒI, không phải để chạy đua với lane khoẻ
   * (bắn đôi lúc đó chỉ tốn quota + tự giết bản đang chạy tốt).
   */
  shouldHedge?: () => boolean,
): Promise<T> {
  const a = spawn();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((res) => { timer = setTimeout(() => res('slow'), hedgeAfterMs); });
  const first = await Promise.race([
    a.p.then((r) => ({ k: 'ok' as const, r })).catch((e: unknown) => ({ k: 'err' as const, e })),
    slow.then(() => ({ k: 'slow' as const })),
  ]);
  if (timer) clearTimeout(timer);

  if (first.k === 'ok') return first.r;
  if (first.k === 'err') throw first.e;

  // A đang stream bình thường (đã có dữ liệu về) → khỏi hedge, chờ A xong.
  if (shouldHedge && !shouldHedge()) return a.p;

  // A vẫn chạy sau ngưỡng → bắn B trên lane khác, đua lấy bản THÀNH CÔNG trước.
  onHedge?.();
  const b = spawn();
  const firstSuccess = new Promise<T>((resolve, reject) => {
    let remaining = 2;
    let firstErr: unknown;
    const onErr = (e: unknown) => {
      if (firstErr === undefined) firstErr = e;
      if (--remaining === 0) reject(firstErr);
    };
    a.p.then(resolve, onErr);
    b.p.then(resolve, onErr);
  });

  try {
    const winner = await firstSuccess;
    a.abort('hedge: bản kia đã xong');
    b.abort('hedge: bản kia đã xong');
    return winner;
  } catch (err) {
    a.abort('hedge: cả hai hỏng');
    b.abort('hedge: cả hai hỏng');
    throw err;
  }
}
