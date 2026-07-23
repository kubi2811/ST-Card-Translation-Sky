import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/** Object thường (không phải mảng/null/Date…) — chỉ loại này mới đáng merge thêm khoá mới. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * Gộp giá trị ĐÃ LƯU với giá trị mặc định.
 *
 * (User 23/07 — việc 89) Bản cũ trả về giá trị đã lưu NGUYÊN KHỐI. Hệ quả: mỗi lần thêm một
 * tuỳ chọn mới vào object mặc định, người đã dùng tool từ trước KHÔNG BAO GIỜ nhận được nó —
 * localStorage của họ thiếu khoá đó nên nó mãi là `undefined`. Đúng cái bẫy làm "Tạo thẻ từ
 * truyện" chạy xong mà không ra lorebook nào: `withWorldEntries` thiếu ở cả default lẫn bản đã
 * lưu, luôn falsy, nên prompt không hề yêu cầu world entries.
 *
 * Nay: khoá nào bản lưu ĐÃ CÓ thì giữ nguyên lựa chọn của user; khoá nào mới thêm thì lấy mặc
 * định. Chỉ merge NÔNG và chỉ cho object thường — mảng/chuỗi/số giữ nguyên hành vi cũ, vì merge
 * mảng sẽ làm user không xoá được phần tử.
 */
export function mergePersisted<T>(stored: unknown, initial: T): T {
  // `JSON.parse("null")` ra null — không chặn thì state thành null và mọi chỗ đọc `.x` sẽ nổ.
  if (stored === undefined || stored === null) return initial;
  if (!isPlainObject(stored) || !isPlainObject(initial)) return stored as T;
  return { ...initial, ...stored } as T;
}

/**
 * useState tự lưu/khôi phục qua localStorage — để F5 / đóng tab / mở lại KHÔNG mất việc.
 * (Vite, không SSR nên có thể đọc localStorage ngay khi khởi tạo.)
 */
export function usePersistedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return mergePersisted(JSON.parse(raw), initial);
    } catch { /* hỏng → dùng initial */ }
    return initial;
  });

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; } // giá trị đầu đã từ localStorage
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch { /* quota — bỏ qua */ }
  }, [key, state]);

  return [state, setState];
}
