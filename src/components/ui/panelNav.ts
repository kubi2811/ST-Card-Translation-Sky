/**
 * panelNav.ts — (bug 165) Điều hướng tới panel đang nằm trong TAB.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao cần: trước đại tu, mọi panel ở cột phải đều được mount cùng lúc, nên nhảy tới một panel chỉ
 * là `document.getElementById(id).scrollIntoView()`. Sau khi bọc vào tab thì panel không active KHÔNG
 * TỒN TẠI trong DOM ⇒ `getElementById` trả null và lệnh nhảy IM LẶNG không làm gì. Đó chính là cái
 * bug 165 dặn phải giữ ("khi có tín hiệu nhảy tới trường phải tự động chuyển sang đúng tab trước khi
 * cuộn tới").
 *
 * Cách làm: tách thành hai bước — YÊU CẦU panel (App đổi tab) rồi mới cuộn, chờ đủ frame để React
 * kịp mount. Không dùng store để khỏi phải sửa `src/store.ts` (bug 165 cấm), và không dùng
 * `window.*` để khỏi rò biến toàn cục.
 */

type Listener = (anchorId: string) => void;

const listeners = new Set<Listener>();

/** App đăng ký để biết cần bật tab nào. Trả về hàm gỡ đăng ký. */
export function onPanelRequest(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Yêu cầu hiển thị panel chứa `anchorId` (không cuộn). */
export function requestPanel(anchorId: string): void {
  for (const fn of listeners) fn(anchorId);
}

/**
 * Bật đúng tab rồi cuộn tới panel, kèm nháy viền cho người dùng thấy đích.
 * Chờ HAI frame: frame 1 để React xử lý setState đổi tab, frame 2 để phần tử đã có trong DOM.
 * Vẫn có nhánh dự phòng bằng setTimeout — panel lazy có thể còn đang tải chunk, lúc đó hai frame
 * chưa đủ và nếu bỏ qua thì lệnh nhảy lại im lặng thất bại như cũ.
 */
export function jumpToAnchor(anchorId: string, highlight = true): void {
  requestPanel(anchorId);

  const doScroll = (): boolean => {
    const el = document.getElementById(anchorId);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (highlight) {
      el.style.transition = 'box-shadow 0.3s ease';
      el.style.boxShadow = '0 0 0 3px var(--accent-primary)';
      el.style.borderRadius = 'var(--radius-md)';
      setTimeout(() => { el.style.boxShadow = ''; }, 1800);
    }
    return true;
  };

  nextFrame(() => {
    nextFrame(() => {
      if (doScroll()) return;
      // Chunk lazy chưa về — thử lại vài nhịp rồi bỏ.
      let tries = 0;
      const timer = setInterval(() => {
        if (doScroll() || ++tries >= 20) clearInterval(timer);
      }, 100);
    });
  });
}

/**
 * Chờ một frame. Lùi về setTimeout khi không có requestAnimationFrame — app luôn chạy trong trình
 * duyệt nên nhánh này không dùng tới ở thực tế, nhưng nhờ nó mà module test được ngoài DOM, và cũng
 * không nổ nếu sau này có ai gọi trong worker/SSR.
 */
function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb);
  else setTimeout(cb, 16);
}
