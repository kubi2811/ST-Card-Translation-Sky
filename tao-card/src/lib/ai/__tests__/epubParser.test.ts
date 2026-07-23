import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseEpubToText, isEpubFile } from '../epubParser';

/** Dựng một file .epub tối thiểu nhưng ĐÚNG chuẩn để test thật, không mock. */
async function makeEpub(opts: {
  chapters: { name: string; html: string }[];
  spineOrder?: string[];
  withImage?: boolean;
  encrypted?: boolean;
}): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`,
  );

  const order = opts.spineOrder ?? opts.chapters.map(c => c.name);
  const manifest = opts.chapters
    .map(c => `<item id="${c.name}" href="${c.name}" media-type="application/xhtml+xml"/>`)
    .join('');
  const spine = order.map(n => `<itemref idref="${n}"/>`).join('');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>${manifest}<item id="img" href="pic.jpg" media-type="image/jpeg"/></manifest>
      <spine>${spine}</spine>
    </package>`,
  );

  for (const c of opts.chapters) zip.file(`OEBPS/${c.name}`, c.html);
  if (opts.withImage) zip.file('OEBPS/pic.jpg', new Uint8Array(50_000)); // ảnh giả 50KB
  if (opts.encrypted) zip.file('META-INF/encryption.xml', '<encryption/>');

  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'test.epub', { type: 'application/epub+zip' });
}

const ch = (title: string, body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>
   <style>.x{color:red}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

describe('isEpubFile', () => {
  it('nhận .epub theo đuôi file', () => {
    expect(isEpubFile(new File([], 'a.epub'))).toBe(true);
    expect(isEpubFile(new File([], 'A.EPUB'))).toBe(true);
  });
  it('nhận theo MIME kể cả đuôi lạ', () => {
    expect(isEpubFile(new File([], 'a.bin', { type: 'application/epub+zip' }))).toBe(true);
  });
  it('không nhận .txt', () => {
    expect(isEpubFile(new File([], 'a.txt'))).toBe(false);
  });
});

describe('parseEpubToText', () => {
  it('trích text từ nhiều chapter, bỏ hết thẻ HTML', async () => {
    const file = await makeEpub({
      chapters: [
        { name: 'c1.xhtml', html: ch('Chương 1', 'Nội dung một.') },
        { name: 'c2.xhtml', html: ch('Chương 2', 'Nội dung hai.') },
      ],
    });
    const text = await parseEpubToText(file);
    expect(text).toContain('Chương 1');
    expect(text).toContain('Nội dung một.');
    expect(text).toContain('Nội dung hai.');
    expect(text).not.toContain('<p>');
    expect(text).not.toContain('xmlns');
  });

  it('giữ ĐÚNG THỨ TỰ chapter theo spine, không phải thứ tự alphabet', async () => {
    const file = await makeEpub({
      chapters: [
        { name: 'b.xhtml', html: ch('Sau', 'phần sau') },
        { name: 'a.xhtml', html: ch('Trước', 'phần trước') },
      ],
      spineOrder: ['b.xhtml', 'a.xhtml'], // spine nói b trước a
    });
    const text = await parseEpubToText(file);
    expect(text.indexOf('phần sau')).toBeLessThan(text.indexOf('phần trước'));
  });

  it('KHÔNG đọc ảnh/font (bỏ qua media cho nhanh)', async () => {
    const file = await makeEpub({
      chapters: [{ name: 'c1.xhtml', html: ch('T', 'chữ') }],
      withImage: true,
    });
    const text = await parseEpubToText(file);
    expect(text).toContain('chữ');
    expect(text.length).toBeLessThan(5_000); // ảnh 50KB không lọt vào text
  });

  it('loại bỏ nội dung <style> và <script>', async () => {
    const file = await makeEpub({
      chapters: [{
        name: 'c1.xhtml',
        html: `<html><head><style>.a{color:red}</style></head><body><script>var x=1;</script><p>chỉ chữ này</p></body></html>`,
      }],
    });
    const text = await parseEpubToText(file);
    expect(text).toContain('chỉ chữ này');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x');
  });

  it('file có DRM → báo lỗi rõ ràng, không trả text rỗng im lặng', async () => {
    const file = await makeEpub({
      chapters: [{ name: 'c1.xhtml', html: ch('T', 'x') }],
      encrypted: true,
    });
    await expect(parseEpubToText(file)).rejects.toThrow(/DRM|mã hoá/i);
  });

  it('file không phải zip → báo lỗi, không nổ ra ngoài dạng khó hiểu', async () => {
    const bad = new File(['day khong phai zip'], 'x.epub');
    await expect(parseEpubToText(bad)).rejects.toThrow(/không đọc được|hỏng/i);
  });

  it('epub rỗng (không chapter nào có chữ) → báo lỗi thay vì trả chuỗi rỗng', async () => {
    const file = await makeEpub({
      chapters: [{ name: 'c1.xhtml', html: '<html><body></body></html>' }],
    });
    await expect(parseEpubToText(file)).rejects.toThrow(/không có nội dung/i);
  });
});
