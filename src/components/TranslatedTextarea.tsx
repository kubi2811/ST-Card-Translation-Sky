/**
 * TranslatedTextarea — (bugNeedFix/107) Ô "Bản dịch" gõ được tiếng Việt tử tế.
 * ─────────────────────────────────────────────────────────────────────────────
 * Trước đây ô này ghi thẳng vào store sau MỖI phím. Bộ gõ tiếng Việt (Unikey/Telex) tổ hợp
 * nhiều phím mới ra một chữ ("aa" → "â"); React re-render giữa chừng làm hỏng tổ hợp
 * ⇒ "Tân Thuận" thành "Taân Thuaâận", và con trỏ bị đặt lại về cuối khi bấm Backspace/Space.
 *
 * Ở đây tách bản nháp khỏi giá trị đã lưu (xem src/utils/imeDraft.ts):
 *   • gõ → chỉ đổi state cục bộ, không đụng store ⇒ không có re-render cắt ngang;
 *   • đang tổ hợp (composition) → tuyệt đối không commit;
 *   • commit khi im phím COMMIT_DELAY_MS hoặc khi rời ô (blur) — nên bấm Xuất ngay cũng không mất;
 *   • giá trị đổi từ ngoài (dịch xong / hoàn tác) vẫn nạp vào ô, trừ khi user đang sửa dở.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COMMIT_DELAY_MS, createDraftState, onType, onCompositionStart, onCompositionEnd,
  canCommit, afterCommit, onExternalChange, type DraftState,
} from '../utils/imeDraft';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
}

export function TranslatedTextarea({ value, onCommit, placeholder, style, className, disabled }: Props) {
  const [state, setState] = useState<DraftState>(() => createDraftState(value));
  const stateRef = useRef(state);
  stateRef.current = state;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const s = stateRef.current;
    if (!canCommit(s)) return;
    onCommitRef.current(s.draft);
    setState(afterCommit(s));
  }, []);

  const scheduleCommit = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, COMMIT_DELAY_MS);
  }, [flush]);

  // Giá trị bên ngoài đổi (dịch xong, retry, hoàn tác) → nạp vào ô nếu user không đang sửa dở.
  useEffect(() => {
    setState((s) => onExternalChange(s, value));
  }, [value]);

  // Rời trang / gỡ component mà còn chữ chưa lưu → lưu nốt, không để mất công gõ.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const s = stateRef.current;
    if (canCommit(s)) onCommitRef.current(s.draft);
  }, []);

  return (
    <textarea
      value={state.draft}
      placeholder={placeholder}
      style={style}
      className={className}
      disabled={disabled}
      onChange={(e) => {
        setState((s) => onType(s, e.target.value));
        scheduleCommit();
      }}
      onCompositionStart={() => setState(onCompositionStart)}
      onCompositionEnd={(e) => {
        setState((s) => onCompositionEnd(s, (e.target as HTMLTextAreaElement).value));
        scheduleCommit();
      }}
      onBlur={flush}
    />
  );
}
