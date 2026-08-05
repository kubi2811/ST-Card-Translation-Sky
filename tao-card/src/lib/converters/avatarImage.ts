/**
 * avatarImage.ts — (bug 217) CHUẨN HOÁ ẢNH ĐẠI DIỆN TRƯỚC KHI LƯU VÀO THẺ.
 * ─────────────────────────────────────────────────────────────────────────────
 * User báo: "import avatar vào app Tạo card, xong export ra lại thì ảnh hoặc file JSON dung lượng
 * lên tới ~30-40MB". File mẫu ở `bug/217/New_Character_v3.json` nói hết: file 3.35 MB thì riêng
 * field `avatar` đã 3.35 MB — tức 100%.
 *
 * Có HAI nguồn phình, phải chặn cả hai:
 *
 *  1. ẢNH KHÔNG HỀ ĐƯỢC XỬ LÝ. Cả đường "Chọn ảnh" lẫn đường import PNG đều `readAsDataURL(file)`
 *     rồi nhét thẳng vào `card.avatar` — ảnh 4K vài chục MB cũng vào nguyên xi, lại còn nở thêm
 *     33% vì base64. Thẻ nhân vật SillyTavern chỉ hiển thị avatar cỡ vài trăm pixel.
 *
 *  2. VÒNG LẶP LỒNG NHAU (nặng hơn nhiều). Import PNG thì `readAsDataURL(file)` đọc TOÀN BỘ file —
 *     gồm cả hai chunk metadata `ccv3`/`chara` mà lần export trước đã nhét base64 ảnh cũ vào đó.
 *     Nên `avatar` mới = base64 của (pixel + base64 ảnh cũ ×2). Export tiếp lại nhân 3.56 lần nữa.
 *     Vài vòng là chạm 30–40 MB đúng như user báo.
 *
 * Bộ này giải quyết cả hai: luôn VẼ LẠI QUA CANVAS (chỉ lấy pixel — mọi chunk metadata rơi rụng,
 * tự nhiên cắt đứt vòng lồng nhau) và thu nhỏ về kích thước hiển thị thật.
 */

/** Cạnh dài tối đa. Avatar thẻ nhân vật chuẩn là 400×600; 1024 đã dư cho màn Retina. */
export const AVATAR_MAX_EDGE = 1024;
/** Vượt ngưỡng này thì chuyển sang JPEG cho nhẹ (PNG lossless ảnh chụp rất nặng). */
export const AVATAR_PNG_BUDGET = 900_000;
/** Chất lượng JPEG khi phải nén. */
export const AVATAR_JPEG_QUALITY = 0.86;

export interface NormalizeResult {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  /** Đã phải thu nhỏ so với ảnh gốc chưa. */
  resized: boolean;
  /** Định dạng cuối. */
  mime: 'image/png' | 'image/jpeg';
}

/** Ước lượng số byte thật của một data URL base64 (bỏ phần tiền tố + phần đệm '='). */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return dataUrl.length;
  const b64 = dataUrl.slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** Kích thước sau khi co về vừa `maxEdge`, giữ nguyên tỉ lệ. Ảnh đã nhỏ thì giữ nguyên. */
export function fitWithin(w: number, h: number, maxEdge = AVATAR_MAX_EDGE): { w: number; h: number; resized: boolean } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge || longest === 0) return { w, h, resized: false };
  const k = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), resized: true };
}

/**
 * Đưa một File ảnh (hoặc PNG thẻ nhân vật) về data URL gọn nhẹ, an toàn để lưu vào `card.avatar`.
 *
 * Luôn đi qua canvas — đó chính là chỗ cắt đứt vòng lồng nhau: canvas chỉ biết tới PIXEL, mọi
 * chunk `tEXt` (kể cả base64 ảnh của vòng trước) đều bị bỏ lại.
 */
export async function normalizeAvatarFile(file: File | Blob): Promise<NormalizeResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không đọc được ảnh'));
      el.src = url;
    });

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const { w, h, resized } = fitWithin(srcW, srcH);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas');
    ctx.drawImage(img, 0, 0, w, h);

    // Thử PNG trước (giữ được nền trong suốt); quá nặng thì mới hạ xuống JPEG.
    let mime: 'image/png' | 'image/jpeg' = 'image/png';
    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrlBytes(dataUrl) > AVATAR_PNG_BUDGET) {
      const jpeg = canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY);
      if (dataUrlBytes(jpeg) < dataUrlBytes(dataUrl)) {
        dataUrl = jpeg;
        mime = 'image/jpeg';
      }
    }

    return { dataUrl, width: w, height: h, bytes: dataUrlBytes(dataUrl), resized, mime };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Câu thông báo ngắn cho user sau khi chuẩn hoá. */
export function describeNormalize(r: NormalizeResult, originalBytes: number): string {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(2) + ' MB';
  const kb = (n: number) => Math.round(n / 1024) + ' KB';
  const size = (n: number) => (n >= 1024 * 1024 ? mb(n) : kb(n));
  const saved = originalBytes > 0 && r.bytes < originalBytes
    ? ` (giảm ${Math.round((1 - r.bytes / originalBytes) * 100)}%)`
    : '';
  return `Ảnh đại diện: ${r.width}×${r.height}, ${size(r.bytes)}${saved}`;
}
