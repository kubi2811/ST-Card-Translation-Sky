import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

type AppState = ReturnType<typeof useStore.getState>;

/**
 * (User 2026 — bugNeedFix/36) Đăng ký store nhưng GIỚI HẠN TẦN SUẤT RE-RENDER.
 *
 * Bối cảnh: khi dịch card lớn (600+ trường, đa luồng), engine gọi updateField/addLog HÀNG NGHÌN lần
 * (mỗi trường/chunk/log 1 lần). Các panel tiến độ (TranslationPanel/LogPanel/ActiveCallsPanel) trước
 * đây `useStore()` KHÔNG selector nên subscribe TOÀN store → mỗi lần set() là re-render + filter/reduce
 * cả mảng 605 phần tử → main thread nghẽn → Chrome báo "trang không phản hồi".
 *
 * Hook này giữ NGUYÊN luồng dữ liệu của engine (engine vẫn đọc useStore.getState() ĐỒNG BỘ, mọi write
 * áp ngay) — chỉ CHẶN BỚT nhịp cập nhật UI: gộp mọi thay đổi trong `ms` mili-giây thành 1 lần render
 * (leading + trailing đảm bảo giá trị CUỐI luôn được vẽ). ~8-12 render/giây thay vì hàng nghìn.
 *
 * Selector nên trả về giá trị nhỏ/đã lọc; hook KHÔNG so sánh bằng — luôn nhận giá trị mới nhất khi flush.
 */
export function useThrottledStore<T>(selector: (s: AppState) => T, ms = 120): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [snap, setSnap] = useState<T>(() => selectorRef.current(useStore.getState()));
  const pendingRef = useRef<T>(snap);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushRef = useRef(0);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      lastFlushRef.current = Date.now();
      setSnap(pendingRef.current);
    };
    const unsub = useStore.subscribe((s: AppState) => {
      pendingRef.current = selectorRef.current(s);
      if (timerRef.current == null) {
        const elapsed = Date.now() - lastFlushRef.current;
        const wait = elapsed >= ms ? 0 : ms - elapsed;
        timerRef.current = setTimeout(flush, wait);
      }
    });
    // Đồng bộ 1 lần khi mount (store có thể đã đổi giữa lúc render và effect chạy).
    pendingRef.current = selectorRef.current(useStore.getState());
    setSnap(pendingRef.current);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);

  return snap;
}
