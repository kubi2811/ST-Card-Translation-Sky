// ─── Cầu nối từ điển: Dịch Card ➡️ Dịch Script (module lá, không import gì của app) ───
// Hai tab là 2 component sống song song trong CÙNG một trang (flow native), mỗi bên giữ
// bảng từ điển riêng. Nút "gửi sang" bên Dịch Card phải làm được cả 2 việc:
//   1) Tab Dịch Script ĐANG mounted → cập nhật NGAY (qua CustomEvent), user chuyển tab là thấy.
//   2) Tab Dịch Script chưa mở lần nào → ghi vào localStorage để lát nữa mở lên vẫn có.
import type { GlossaryEntry } from '../types/card';

export const GLOSSARY_PUSH_EVENT = 'st-glossary-push-to-script';

export interface GlossaryPushDetail {
  entries: GlossaryEntry[];
}

/** Bên Dịch Card gọi. Trả về true nếu có ít nhất 1 tab Script đang nghe (đã nhận trực tiếp). */
export function pushGlossaryToScript(entries: GlossaryEntry[]): boolean {
  let received = false;
  const detail: GlossaryPushDetail = { entries };
  const ev = new CustomEvent<GlossaryPushDetail & { ack?: () => void }>(GLOSSARY_PUSH_EVENT, {
    detail: { ...detail, ack: () => { received = true; } },
  });
  window.dispatchEvent(ev);
  return received;
}

/** Bên Dịch Script gọi trong useEffect. Trả hàm huỷ đăng ký. */
export function onGlossaryPush(handler: (entries: GlossaryEntry[]) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<GlossaryPushDetail & { ack?: () => void }>).detail;
    if (!detail?.entries) return;
    detail.ack?.();          // báo cho bên gửi biết đã có người nhận trực tiếp
    handler(detail.entries);
  };
  window.addEventListener(GLOSSARY_PUSH_EVENT, listener);
  return () => window.removeEventListener(GLOSSARY_PUSH_EVENT, listener);
}
