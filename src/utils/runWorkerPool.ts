/**
 * src/utils/runWorkerPool.ts — Pool worker LIÊN TỤC (thay "rào chắn đợt").
 * ──────────────────────────────────────────────────────────────────────────────
 * Vấn đề cũ: dispatch theo sliding-window `Promise.allSettled(window)` → phải CHỜ CẢ ĐỢT
 * `concurrency` việc xong mới sang đợt kế. 1 việc chậm (entry khổng lồ) chặn hết → luồng khác
 * ngồi không. Pool này mở đúng `concurrency` worker, worker nào xong là KÉO việc kế trong hàng
 * đợi NGAY (không đợi ai) → lấp chỗ trống liên tục, thời gian ≈ việc chậm nhất thay vì cộng dồn.
 *
 * RPM vẫn an toàn: helper này KHÔNG tự gọi API — mỗi `runOne` bên trong vẫn đi qua pickLane/
 * waitForRateLimitModel của apiClient (gate RPM per provider+model). Số worker = ngân sách RPM
 * (computePoolConcurrency) nên trần đồng thời không tăng — chỉ không còn đợi phí.
 *
 * Mirror mẫu đã chạy tốt sẵn trong repo: ejsSync.ts `runBatches`, aiVerify.ts, apiClient chunk-pool.
 */

export interface WorkerPoolOptions {
  /** Tổng số việc (chỉ số 0..total-1). */
  total: number;
  /** Số worker chạy song song (= computePoolConcurrency). */
  concurrency: number;
  /** Xử lý 1 việc theo index. TỰ bắt/log lỗi bên trong; ném lỗi 'Cancelled' để dừng cả pool. */
  runOne: (index: number) => Promise<void>;
  /** Trả true để NGỪNG kéo việc mới (vd checkAbort). Kiểm ở đầu mỗi vòng worker. */
  shouldStop?: () => boolean;
  /** Chờ khi đang tạm dừng; trả true nếu bị HỦY trong lúc chờ (vd waitForPause). */
  waitIfPaused?: () => Promise<boolean>;
  /** Gọi sau MỖI việc xong (để save cache định kỳ / cập nhật tiến độ). */
  onSettled?: (index: number) => void;
  /** Nghỉ tùy chọn (ms) sau mỗi việc trong 1 worker (requestDelay — thường 0). */
  betweenMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Chạy `total` việc qua `concurrency` worker liên tục.
 * @returns `{ cancelled }` — true nếu bị dừng/hủy giữa chừng (abort hoặc runOne ném 'Cancelled').
 */
export async function runWorkerPool(opts: WorkerPoolOptions): Promise<{ cancelled: boolean }> {
  const { total, concurrency, runOne, shouldStop, waitIfPaused, onSettled, betweenMs } = opts;
  if (total <= 0) return { cancelled: false };

  let next = 0;          // con trỏ hàng đợi dùng chung (JS đơn luồng → next++ không cần khoá)
  let cancelled = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (cancelled) return;
      if (shouldStop?.()) { cancelled = true; return; }
      if (waitIfPaused && (await waitIfPaused())) { cancelled = true; return; }
      if (cancelled) return; // có thể bị worker khác set trong lúc await pause

      const idx = next++;
      if (idx >= total) return; // hết hàng đợi → worker nghỉ

      // (User 2026 — bugNeedFix/39) NHẢ MAIN THREAD 1 macrotask trước mỗi việc. Không có dòng này,
      // hàng chục worker khởi động đồng loạt chỉ cách nhau MICROTASK boundary → toàn bộ phần chuẩn bị
      // ĐỒNG BỘ của mọi việc (build prompt/RAG/dict/surgical extract) dính thành MỘT long task duy
      // nhất hàng chục giây — browser không paint/không nhận input ⇒ "Trang không phản hồi" (luồng
      // So sánh 418 field done sẵn là ca nặng nhất). setTimeout(0) tách mỗi việc thành macrotask
      // riêng → UI luôn sống; chi phí ~1-4ms/việc, không ảnh hưởng tổng thời gian dịch (nghẽn thật
      // nằm ở chờ API).
      await new Promise<void>((r) => setTimeout(r, 0));
      if (cancelled || shouldStop?.()) { cancelled = true; return; }

      try {
        await runOne(idx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Cancelled' || shouldStop?.()) { cancelled = true; return; }
        // Lỗi khác của 1 việc: runOne đã tự log/đánh dấu — BỎ QUA để pool chạy tiếp.
      }

      onSettled?.(idx);
      if (betweenMs && betweenMs > 0) await sleep(betweenMs);
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return { cancelled };
}
