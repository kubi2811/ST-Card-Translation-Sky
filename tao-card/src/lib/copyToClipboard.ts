/**
 * src/lib/copyToClipboard.ts — (bug 224) COPY PHẢI THẬT SỰ COPY, VÀ PHẢI NÓI THẬT KHI HỎNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "hầu hết các nút hiện nay không có tác dụng như nút copy trong schema".
 *
 * Nút copy KHÔNG thiếu handler — nó có `navigator.clipboard.writeText(...)`. Vấn đề là hai điều
 * cùng lúc:
 *
 *  1. Tạo Card CHẠY TRONG IFRAME của Hub. `navigator.clipboard.writeText` bị chặn trong iframe
 *     nếu iframe không được cấp `allow="clipboard-write"` — và Hub không cấp. API trả về một
 *     Promise BỊ TỪ CHỐI, không ném đồng bộ.
 *  2. Mọi chỗ gọi đều KHÔNG await, KHÔNG .catch(). Nên Promise rớt im lặng, còn dòng ngay sau
 *     đó vẫn chạy `setCopied(true)` ⇒ nút hiện "Đã copy!" trong khi clipboard trống trơn.
 *     Đúng cảm giác "nút không có tác dụng", mà lại còn tệ hơn: nó BÁO LÀ ĐÃ LÀM.
 *
 * Hàm này là một chỗ duy nhất, hai đường:
 *   • đường chuẩn: Clipboard API (cần secure context + quyền);
 *   • đường lùi: textarea ẩn + `document.execCommand('copy')` — cổ nhưng CHẠY ĐƯỢC trong iframe
 *     không có quyền clipboard, vì nó là "user-initiated copy" của chính document đó.
 * Cả hai hỏng ⇒ trả false để UI nói thật, không bao giờ báo thành công giả.
 */

export interface CopyResult {
  ok: boolean;
  /** Đường nào đã dùng — hiện trong log để chẩn đoán khi user báo lỗi. */
  via: 'clipboard-api' | 'exec-command' | 'none';
  error?: string;
}

/** Đường lùi: chỉ dùng DOM, chạy được trong iframe không có quyền clipboard. */
function copyViaExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Phải nằm trong luồng hiển thị mới select được, nhưng không được làm nhảy trang:
    // đặt ngoài khung nhìn thay vì display:none.
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy `text` vào clipboard. KHÔNG BAO GIỜ ném — luôn trả kết quả thật.
 * Gọi từ trong handler của một cú bấm (cả hai đường đều cần user gesture).
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  const value = String(text ?? '');
  if (!value) return { ok: false, via: 'none', error: 'không có gì để copy' };

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return { ok: true, via: 'clipboard-api' };
    }
  } catch (e) {
    // Bị chặn (iframe không có quyền / không phải secure context / tab mất focus) → thử đường lùi.
    if (copyViaExecCommand(value)) return { ok: true, via: 'exec-command' };
    return { ok: false, via: 'none', error: e instanceof Error ? e.message : String(e) };
  }

  if (copyViaExecCommand(value)) return { ok: true, via: 'exec-command' };
  return { ok: false, via: 'none', error: 'trình duyệt chặn cả hai đường copy' };
}

/**
 * Bản tiện dụng cho UI: tự bắn toast đúng sự thật. Trả về true/false để caller còn đổi nhãn nút.
 * `toast` truyền vào để module này không phụ thuộc store (test được, và dùng được ngoài React).
 */
export async function copyWithToast(
  text: string,
  what: string,
  toast: { success: (m: string) => void; error: (m: string) => void },
): Promise<boolean> {
  const r = await copyToClipboard(text);
  if (r.ok) {
    toast.success(`📋 Đã copy ${what} (${text.length.toLocaleString()} ký tự).`);
    return true;
  }
  toast.error(
    `Không copy được ${what}: ${r.error ?? 'trình duyệt chặn'}. `
    + 'Hãy bấm vào vùng code rồi Ctrl+A / Ctrl+C, hoặc dùng nút Tải xuống.',
  );
  return false;
}
