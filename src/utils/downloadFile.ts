/**
 * src/utils/downloadFile.ts — (bug 223) TẢI FILE VỀ MÁY CHO ĐÚNG CÁCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "từ điển thuật ngữ bình thường hình như xuất không được nhỉ".
 *
 * Đúng là không được, và lỗi nằm ở MỘT DÒNG mà gần chục chỗ trong repo cùng viết sai:
 *
 *     a.click();
 *     URL.revokeObjectURL(url);   // ← thu hồi NGAY
 *
 * `a.click()` chỉ ĐẶT LỆNH tải; trình duyệt mới bắt đầu đọc blob ở vòng lặp sự kiện sau. Thu
 * hồi ngay dòng dưới là rút dữ liệu ra khỏi tay nó giữa chừng — đo được ngay trong tab đang
 * chạy: `fetch(url)` liền sau `revokeObjectURL` đã trả "Failed to fetch". Ai thắng cuộc đua
 * này tuỳ máy và tuỳ kích thước file, nên bệnh biểu hiện đúng kiểu "hình như", "lúc được lúc
 * không" — và với file từ điển bé thì hầu như luôn thua.
 *
 * Thẻ neo cũng nên NẰM TRONG trang lúc bấm: vài trình duyệt bỏ qua click trên phần tử rời.
 *
 * Gom về một chỗ để sửa một lần là mọi nút xuất trong tool cùng hết bệnh, và để không ai vô
 * tình viết lại kiểu cũ.
 */

/** Giữ blob sống đủ lâu cho trình duyệt đọc xong rồi mới trả bộ nhớ. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Tải một Blob về máy. Trả về false nếu môi trường không có DOM (test/worker).
 */
export function downloadBlob(fileName: string, blob: Blob): boolean {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // KHÔNG thu hồi ngay — xem phần đầu file. Một phút là quá đủ cho cả file thẻ mấy chục MB.
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* đã thu hồi */ } }, REVOKE_DELAY_MS);
  return true;
}

/**
 * Thu hồi blob URL SAU khi trình duyệt đã đọc xong — dùng cho các nút xuất đã tự dựng thẻ neo
 * từ trước. Có tên riêng để không ai vô tình viết lại `URL.revokeObjectURL(url)` ngay sau
 * `a.click()`: đó đúng là lỗi của bug 223.
 */
export function revokeSoon(url: string): void {
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* đã thu hồi */ } }, REVOKE_DELAY_MS);
}

/** Tải một chuỗi văn bản. `mime` mặc định JSON vì đó là thứ tool xuất nhiều nhất. */
export function downloadText(
  fileName: string,
  text: string,
  mime = 'application/json;charset=utf-8',
): boolean {
  return downloadBlob(fileName, new Blob([text], { type: mime }));
}

/**
 * Tên file an toàn trên Windows: bỏ ký tự cấm và khoảng trắng thừa.
 * Windows còn cấm cả tên trống, nên có `fallback`.
 */
export function safeFileName(raw: string, fallback = 'file'): string {
  const cleaned = String(raw || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned || fallback;
}

/** Hậu tố ngày-giờ cho tên file, để xuất nhiều lần không đè lên nhau. */
export function stampSuffix(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
