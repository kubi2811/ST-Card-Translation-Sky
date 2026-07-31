/**
 * (bugNeedFix/179) Ctrl+V dán ảnh vào ô chat Trợ Lý AI.
 *
 * Bộ đọc clipboard nằm trong AiCompanionPanel.tsx (module scope). Test này canh HỢP ĐỒNG của nó
 * bằng cách đọc mã nguồn — thứ dễ vỡ khi refactor là: quên preventDefault khi có ảnh, hoặc chặn
 * cả lượt dán CHỮ, hoặc chỉ nối cho một trong hai tab.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../components/AiCompanionPanel.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');

function fnBody(): string {
  const i = SRC.indexOf('async function readImagesFromClipboard');
  expect(i, 'không tìm thấy readImagesFromClipboard').toBeGreaterThan(-1);
  const j = SRC.indexOf('\n}', i);
  return SRC.slice(i, j);
}

describe('Bộ đọc ảnh từ clipboard', () => {
  const body = fnBody();

  it('đọc từ clipboardData.items và chỉ lấy đúng file ảnh', () => {
    expect(body).toContain('clipboardData?.items');
    expect(body).toContain("it.kind === 'file'");
    expect(body).toContain("it.type.startsWith('image/')");
  });

  it('KHÔNG có ảnh thì trả null TRƯỚC khi preventDefault — dán chữ phải chạy như cũ', () => {
    const nullReturn = body.indexOf('return null');
    const prevent = body.indexOf('e.preventDefault()');
    expect(nullReturn).toBeGreaterThan(-1);
    expect(prevent).toBeGreaterThan(-1);
    expect(nullReturn).toBeLessThan(prevent);
  });

  it('có ảnh thì chặn dán mặc định, không để trình duyệt nhét thêm HTML vào ô chữ', () => {
    expect(body).toContain('e.preventDefault()');
  });

  it('đọc DataURL — đúng định dạng mà phần gửi ảnh cho model đang dùng', () => {
    expect(body).toContain('readAsDataURL');
    expect(body).toContain('isImage: true');
  });

  it('đặt tên có mốc giờ để dán nhiều tấm liên tiếp còn phân biệt được', () => {
    expect(body).toContain('anh-dan-');
    expect(body).toMatch(/imageFiles\.length > 1/);
  });

  it('nằm ở MODULE SCOPE (không phải trong một component) để cả hai tab dùng chung', () => {
    // Hàm khai báo ở cột 0 ⇒ ngoài mọi component.
    expect(SRC).toMatch(/\nasync function readImagesFromClipboard\(/);
  });
});

describe('Đã nối vào cả hai ô chat', () => {
  it('tab Chat: textarea chính có onPaste', () => {
    expect(SRC).toContain('onPaste={handlePasteInChat}');
    expect(SRC).toContain('const handlePasteInChat');
  });

  it('tab MVU: ô chat cũng có onPaste', () => {
    expect(SRC).toContain('onPaste={handlePasteInMvuChat}');
    expect(SRC).toContain('const handlePasteInMvuChat');
  });

  it('ảnh dán đi vào ĐÚNG danh sách đính kèm mà phần gửi ảnh đang đọc', () => {
    // Chat gửi ảnh từ attachedFiles, MVU gửi từ mvuAttachedFiles.
    expect(SRC).toContain('setAttachedFiles(prev => [...prev, ...loaded])');
    expect(SRC).toContain('setMvuAttachedFiles(prev => [...prev, ...loaded])');
    expect(SRC).toContain("attachedFiles.filter(f => f.isImage).map(f => f.content)");
    expect(SRC).toContain("mvuAttachedFiles.filter(f => f.isImage).map(f => f.content)");
  });
});

describe('Người dùng được cho biết là dán được', () => {
  const locales = ['vi', 'en', 'zh'] as const;
  for (const loc of locales) {
    it(`gợi ý Ctrl+V có trong ô nhập (${loc})`, () => {
      const s = readFileSync(resolve(__dirname, `../../i18n/ui/${loc}.ts`), 'utf-8');
      const line = s.split(/\r?\n/).find(l => l.trim().startsWith('acInputPh:'));
      expect(line, `${loc}.ts thiếu acInputPh`).toBeTruthy();
      expect(line!).toMatch(/Ctrl\+V/);
    });
  }
});
