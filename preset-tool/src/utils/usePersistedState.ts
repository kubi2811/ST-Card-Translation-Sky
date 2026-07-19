import { useState, useEffect } from 'react';

/**
 * useState nhưng LƯU vào localStorage — dùng cho những ô nhập mà mất là tiếc:
 * đổi tab trong workspace là component bị unmount, không lưu thì gõ lại từ đầu.
 *
 * setItem được bọc try/catch: localStorage đầy (quota) thì chỉ mất phần lưu, KHÔNG làm vỡ app.
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* hết chỗ hoặc chế độ riêng tư — bỏ qua, không chặn thao tác của người dùng */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
