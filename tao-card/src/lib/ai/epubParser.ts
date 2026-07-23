/**
 * ─── Trích text thuần từ file .epub ───
 *
 * File .epub thực chất là một ZIP chứa các chương dưới dạng XHTML. Ta chỉ cần CHỮ, nên:
 * - Dùng jszip giải nén (nhẹ, chạy thẳng trên trình duyệt). Không dùng epubjs vì nó kèm cả
 *   bộ render/phân trang — thừa và nặng cho việc chỉ lấy text.
 * - BỎ QUA hoàn toàn ảnh/font/audio: light novel hay kèm hàng chục MB ảnh, đọc vào chỉ tổ chậm.
 * - Đọc thứ tự chương theo `spine` trong file .opf, KHÔNG theo tên file (tên thường là
 *   c10 < c2 khi sắp alphabet → truyện lộn xộn).
 */
import JSZip from 'jszip';

/** File này có phải .epub không (xét cả đuôi lẫn MIME). */
export function isEpubFile(file: File): boolean {
  return /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
}

/** Chỉ đọc các file text của sách; ảnh/font/audio/video bỏ qua cho nhanh. */
const TEXT_DOC_RE = /\.(xhtml|html|htm|xml)$/i;

/** Bóc thẻ HTML lấy chữ. Ưu tiên DOMParser (chuẩn), fallback regex khi không có DOM. */
function htmlToText(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // style/script chứa CSS/JS — không phải nội dung sách.
      doc.querySelectorAll('style, script').forEach((el) => el.remove());
      return doc.body?.textContent ?? '';
    } catch {
      /* rơi xuống fallback */
    }
  }
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ');
}

/** Gọn khoảng trắng nhưng GIỮ xuống dòng đoạn (đọc dễ hơn, chunk cũng cắt đẹp hơn). */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** Lấy giá trị một attribute trong đoạn tag XML. */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : '';
}

/**
 * Đọc thứ tự chương từ `spine` của file .opf.
 *
 * Cố ý DÙNG REGEX chứ không DOMParser: .opf là XML máy sinh, cấu trúc đơn giản và đoán được;
 * đổi lại hàm chạy được ở MỌI môi trường (kể cả worker/node không có DOM) thay vì âm thầm
 * trả về rỗng rồi tụt xuống sắp theo tên file — mà sắp theo tên thì c10 đứng trước c2.
 */
function readSpineOrder(opfXml: string, opfDir: string): string[] {
  try {
    // id -> href (chỉ giữ tài liệu chữ, gạt ảnh/font ngay từ đây)
    const hrefById = new Map<string, string>();
    for (const tag of opfXml.match(/<item\b[^>]*>/gi) ?? []) {
      const id = attr(tag, 'id');
      const href = attr(tag, 'href');
      const media = attr(tag, 'media-type');
      if (id && href && (media.includes('html') || media.includes('xml'))) {
        hrefById.set(id, href);
      }
    }

    const out: string[] = [];
    for (const tag of opfXml.match(/<itemref\b[^>]*>/gi) ?? []) {
      const href = hrefById.get(attr(tag, 'idref'));
      if (href) out.push(opfDir ? `${opfDir}/${href}` : href);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Trích toàn bộ chữ trong file .epub thành MỘT chuỗi plain text.
 * Ném lỗi có thông điệp tiếng Việt rõ ràng khi file hỏng / có DRM / rỗng.
 */
export async function parseEpubToText(file: File): Promise<string> {
  let zip: JSZip;
  try {
    // Đọc sang ArrayBuffer trước rồi mới nạp: JSZip xử lý ArrayBuffer đồng nhất ở mọi môi
    // trường, còn truyền thẳng File thì tuỳ runtime mà lúc được lúc không.
    const buf = await file.arrayBuffer();
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('File .epub hỏng hoặc không đọc được (không phải file nén hợp lệ).');
  }

  // EPUB có DRM thì nội dung bị mã hoá — giải nén ra cũng chỉ là rác, báo sớm cho user.
  if (zip.file('META-INF/encryption.xml')) {
    throw new Error('File .epub có DRM (bị mã hoá) nên không đọc được nội dung. Hãy dùng bản không khoá DRM.');
  }

  // Thứ tự chương chuẩn nằm trong .opf mà container.xml trỏ tới.
  let order: string[] = [];
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (containerXml) {
    try {
      const rootfileTag = containerXml.match(/<rootfile\b[^>]*>/i)?.[0] ?? '';
      const opfPath = attr(rootfileTag, 'full-path');
      if (opfPath) {
        const opfXml = await zip.file(opfPath)?.async('string');
        if (opfXml) {
          const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
          order = readSpineOrder(opfXml, opfDir);
        }
      }
    } catch {
      /* không đọc được spine → dùng thứ tự file bên dưới */
    }
  }

  // Không có spine (epub dựng ẩu) → lấy mọi tài liệu chữ, sắp theo tên cho ổn định.
  if (order.length === 0) {
    order = Object.keys(zip.files)
      .filter((p) => TEXT_DOC_RE.test(p) && !p.startsWith('META-INF/'))
      .sort();
  }

  const parts: string[] = [];
  for (const path of order) {
    const entry = zip.file(path);
    if (!entry || entry.dir) continue;
    try {
      const raw = await entry.async('string');
      const text = tidy(htmlToText(raw));
      if (text) parts.push(text);
    } catch {
      // 1 chương lỗi không nên làm hỏng cả quyển — bỏ qua chương đó.
      console.warn('[epub] bỏ qua chương không đọc được:', path);
    }
  }

  const result = tidy(parts.join('\n\n'));
  if (!result) {
    throw new Error('File .epub không có nội dung chữ nào đọc được (có thể sách toàn ảnh scan).');
  }
  return result;
}
