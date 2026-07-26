/**
 * src/utils/imeDraft.ts — (bugNeedFix/107) LOGIC Ô NHẬP CHỊU ĐƯỢC BỘ GÕ TIẾNG VIỆT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật: ô "Bản dịch" trong bảng Chỉnh Sửa Trường. Gõ "Tân Thuận" ra "Taân Thuaâận",
 * bấm Backspace/Space thì con trỏ nhảy về cuối dòng.
 *
 * Vì sao: ô đó là controlled input ghi THẲNG vào store sau MỖI phím. Bộ gõ tiếng Việt
 * (Unikey/Telex, hoặc IME nói chung) không gửi từng ký tự rời — nó TỔ HỢP: gõ "aa" rồi mới
 * thành "â". Trong lúc tổ hợp, React re-render và gán lại `value` từ store ⇒ trình duyệt mất
 * ngữ cảnh tổ hợp (ký tự bị nhân đôi) và đặt lại con trỏ về cuối.
 *
 * Cách sửa chuẩn — tách "bản nháp" khỏi "giá trị đã lưu":
 *   • Trong lúc gõ: giữ chữ ở state cục bộ, KHÔNG đẩy lên store ⇒ không re-render cắt ngang.
 *   • Đang tổ hợp (composition) thì tuyệt đối không commit.
 *   • Commit khi: gõ xong tổ hợp + im được `COMMIT_DELAY_MS`, hoặc khi rời ô (blur).
 *   • Giá trị đổi TỪ BÊN NGOÀI (dịch xong, retry, hoàn tác) vẫn phải nạp vào ô — nhưng chỉ
 *     khi user không đang sửa dở, để không giật mất chữ đang gõ.
 * File này giữ phần LOGIC thuần để test được không cần DOM; phần gắn sự kiện nằm ở component.
 */

export const COMMIT_DELAY_MS = 400;

export interface DraftState {
  /** Chữ đang hiện trong ô. */
  draft: string;
  /** User đã sửa mà chưa commit? */
  dirty: boolean;
  /** Bộ gõ đang tổ hợp ký tự? */
  composing: boolean;
}

export function createDraftState(initial: string): DraftState {
  return { draft: initial ?? '', dirty: false, composing: false };
}

/** User gõ một phím (hoặc IME chèn chữ). */
export function onType(s: DraftState, value: string): DraftState {
  return { ...s, draft: value, dirty: true };
}

/** Bộ gõ bắt đầu tổ hợp — từ đây tới compositionend không được commit. */
export function onCompositionStart(s: DraftState): DraftState {
  return { ...s, composing: true };
}

/** Bộ gõ kết thúc tổ hợp: lấy giá trị chốt của trình duyệt làm chuẩn. */
export function onCompositionEnd(s: DraftState, value: string): DraftState {
  return { draft: value, dirty: true, composing: false };
}

/** Có được phép commit lên store lúc này không? */
export function canCommit(s: DraftState): boolean {
  return s.dirty && !s.composing;
}

/** Đã commit xong: hết "dirty", chữ trong ô giữ nguyên. */
export function afterCommit(s: DraftState): DraftState {
  return { ...s, dirty: false };
}

/**
 * Giá trị bên ngoài (store) đổi — quyết định có nạp đè vào ô hay không.
 * Quy tắc: user đang sửa dở (dirty) hoặc đang tổ hợp ⇒ KHÔNG đè, kẻo mất chữ đang gõ.
 */
export function onExternalChange(s: DraftState, external: string): DraftState {
  if (s.dirty || s.composing) return s;
  if (s.draft === external) return s;
  return { ...s, draft: external ?? '' };
}
