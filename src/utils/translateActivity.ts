/**
 * src/utils/translateActivity.ts — (bug 240) NHẬT KÝ TIẾN ĐỘ THEO TỪNG FIELD, SỐNG NGOÀI REACT.
 * ─────────────────────────────────────────────────────────────────────────────
 * User (gogopikachu): "đang dịch link ngoài trong regex manager thì vẫn thấy tool call api, nhưng
 * các báo cáo cụ thể lại không được thể hiện trong UI chính… chỉ quan sát được bằng F12 nhưng
 * không hề có đánh dấu đang dịch phần nào."
 *
 * apiClient bắn sự kiện qua `setTranslateProgressReporter`; ở đây gom lại theo `fieldName` thành
 * một store zustand nhỏ. Để riêng khỏi store chính vì hai lẽ:
 *   • nhật ký này nóng (mỗi mảnh một dòng) — nhét vào store chính là kéo cả app re-render;
 *   • nó phải sống khi panel đóng: người dùng thoát Regex Manager rồi quay lại vẫn thấy đủ.
 */
import { create } from 'zustand';
import { setTranslateProgressReporter, type TranslateProgressEvent } from './apiClient';

/** Mỗi field giữ tối đa chừng này dòng — entry 74 mảnh, mỗi mảnh vài dòng, vẫn dư. */
const MAX_EVENTS_PER_FIELD = 300;
/** Giữ nhật ký của chừng này field gần nhất; field cũ hơn bị bỏ để không phình bộ nhớ. */
const MAX_FIELDS = 40;

interface ActivityState {
  byField: Record<string, TranslateProgressEvent[]>;
  push: (ev: TranslateProgressEvent) => void;
  clear: (fieldName: string) => void;
}

export const useTranslateActivity = create<ActivityState>((set) => ({
  byField: {},
  push: (ev) => set((s) => {
    const prev = s.byField[ev.fieldName] || [];
    const next = prev.length >= MAX_EVENTS_PER_FIELD
      ? [...prev.slice(prev.length - MAX_EVENTS_PER_FIELD + 1), ev]
      : [...prev, ev];
    const byField = { ...s.byField, [ev.fieldName]: next };
    const names = Object.keys(byField);
    if (names.length > MAX_FIELDS) {
      // Bỏ field có dòng mới nhất cũ nhất.
      const lastAt = (n: string) => byField[n][byField[n].length - 1]?.at || 0;
      names.sort((a, b) => lastAt(a) - lastAt(b));
      for (const n of names.slice(0, names.length - MAX_FIELDS)) delete byField[n];
    }
    return { byField };
  }),
  clear: (fieldName) => set((s) => {
    if (!(fieldName in s.byField)) return s;
    const byField = { ...s.byField };
    delete byField[fieldName];
    return { byField };
  }),
}));

/** Ghi một dòng từ phía app (không qua apiClient) — vd "bắt đầu phần 3/12". */
export function noteActivity(fieldName: string, level: TranslateProgressEvent['level'], message: string): void {
  useTranslateActivity.getState().push({ fieldName, kind: 'note', level, message, at: Date.now() });
}

// Cắm kênh ngay khi module được nạp — một chỗ duy nhất trong app làm việc này.
setTranslateProgressReporter((ev) => useTranslateActivity.getState().push(ev));
