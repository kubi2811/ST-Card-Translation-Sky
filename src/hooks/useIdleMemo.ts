import { useEffect, useRef, useState } from 'react';

/**
 * (User 2026 — bugNeedFix/37) useMemo phiên bản HOÃN: tính `compute` trong requestIdleCallback thay vì
 * NGAY trong render tick.
 *
 * Bối cảnh: import card lớn (JSON 1.37MB, tavern_helper 692KB, 199 entry) → setCard kích 1 render tick,
 * trong đó NHIỀU component cùng useMemo([card]) chạy quét nặng ĐỒNG BỘ (extract field, acorn parse,
 * quét MVU/Zod, chấm điểm preset…) — cộng dồn nhiều giây trên 1 core ⇒ Chrome báo "trang không phản
 * hồi" dù RAM/CPU tổng còn dư. Hook này cho render tick hoàn thành + vẽ UI TRƯỚC, rồi mới tính từng
 * việc nặng lúc máy rảnh — mỗi việc 1 tick riêng, không còn dồn 1 cục.
 *
 * - `enabled=false` → giữ nguyên giá trị hiện có, không tính (vd: đang dịch thì đừng quét lại).
 * - `initial` trả về ngay trong lúc chờ tính.
 * - compute mới nhất luôn được dùng (ref), deps quyết định KHI NÀO tính lại.
 */
export function useIdleMemo<T>(
  compute: () => T,
  deps: unknown[],
  initial: T,
  enabled = true,
): T {
  const [val, setVal] = useState<T>(initial);
  const computeRef = useRef(compute);
  computeRef.current = compute;

  useEffect(() => {
    if (!enabled) return; // giữ giá trị cũ
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      try { setVal(computeRef.current()); } catch (e) { console.warn('[useIdleMemo] compute lỗi:', e); }
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const id = w.requestIdleCallback
      ? w.requestIdleCallback(run, { timeout: 2500 })
      : (setTimeout(run, 60) as unknown as number);
    return () => {
      cancelled = true;
      if (w.requestIdleCallback && w.cancelIdleCallback) w.cancelIdleCallback(id);
      else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return val;
}
