import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * (User 23/07 — việc 85 + 86) Trích Card → Nhập tiểu thuyết:
 *   85. "cứ nhập vào là bị đơ không bấm được chỗ nào cả"
 *   86. "chỉ nhập được bằng file txt, hãy cho nó nhập các file khác như epub"
 *
 * Đo thật trong trình duyệt trên truyện tiếng Trung — thủ phạm KHÔNG phải phần giải mã:
 *      2MB  → giải mã 4 lần   44ms  ·  gán vào <textarea>   991ms
 *      8MB  →                179ms  ·                      3.645ms
 *     20MB  →                605ms  ·                      8.549ms
 * Nhồi cả pho tiểu thuyết vào <textarea> làm main thread đứng ~9 giây.
 * Sau khi sửa (đo lại trong trình duyệt): 20MB tổng 78ms, chặn main thread lâu nhất 5ms.
 *
 * File này là HTML tĩnh tự chứa — không bundler, không type-check, không lint. Test soi thẳng
 * nội dung để giữ những bất biến đã phải trả giá mới tìm ra.
 */

const HTML = fs.readFileSync(
  path.resolve(__dirname, '../../../public/apps/novalcard-vi.html'),
  'utf8',
);

describe('việc 85 — nhập file không được làm đơ trang', () => {
  it('văn bản lớn nằm trong biến JS, textarea chỉ là bản xem trước', () => {
    expect(HTML).toContain('let novelFullText = null');
    expect(HTML).toMatch(/const NOVEL_INLINE_LIMIT\s*=\s*\d+/);
    expect(HTML).toMatch(/function getNovelText\(\)/);
    expect(HTML).toMatch(/function setNovelText\(/);
  });

  it('MỌI chỗ đọc nội dung truyện đi qua getNovelText, không còn đọc thẳng textarea', () => {
    // Chỉ được phép còn lại các thao tác DOM: khai báo, gán trong setNovelText/novelClear,
    // addEventListener, readOnly, và biến `ta`.
    const offenders = HTML.split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => /\$\("novel"\)\.value/.test(l))
      .filter(({ l }) =>
        !/function getNovelText/.test(l) &&
        !/\$\("novel"\)\.value\s*=\s*""/.test(l) &&
        !/dùng thay cho/.test(l));
    expect(offenders.map(o => `${o.n}: ${o.l.trim()}`)).toEqual([]);
  });

  it('đoán encoding trên MẪU rồi giải mã toàn bộ ĐÚNG 1 LẦN (không phải 4 lần cả file)', () => {
    expect(HTML).toMatch(/const sample\s*=\s*bytes\.subarray\(/);
    // Bản cũ đẩy cả 4 encoding qua `push(...)` rồi sort — không được còn dấu vết đó.
    expect(HTML).not.toMatch(/push\("gb18030","gb18030"\)/);
    expect(HTML).toMatch(/if\(bad===0\) break;/);
  });

  it('vẫn giữ nhận diện BOM UTF-16/UTF-8 (file Notepad rất hay gặp)', () => {
    expect(HTML).toContain('0xFF && bytes[1]===0xFE');
    expect(HTML).toContain('0xEF && bytes[1]===0xBB');
  });

  it('có nhường nhịp cho trình duyệt vẽ lại nên không bao giờ trông như treo', () => {
    expect(HTML).toMatch(/const uiTick\s*=/);
    expect(HTML).toMatch(/await uiTick\(\)/);
  });

  it('có nút Xoá văn bản để quay lại gõ tay khi đang ở chế độ văn bản lớn', () => {
    expect((HTML.match(/id="novelClear"/g) || []).length).toBe(1);
    expect(HTML).toMatch(/\$\("novelClear"\)\.onclick/);
  });

  it('user tự gõ thì textarea trở lại làm nguồn chân lý', () => {
    expect(HTML).toMatch(/addEventListener\("input",\(\)=>\{\s*novelFullText=null/);
  });
});

describe('việc 86 — đọc được file .epub', () => {
  it('ô chọn file nhận .epub và nói rõ trong phần hướng dẫn', () => {
    expect(HTML).toMatch(/id="file"[^>]*accept="[^"]*\.epub/);
    expect(HTML).toMatch(/<b>\.epub<\/b>/);
  });

  it('đọc ZIP bằng API sẵn có của trình duyệt — file tĩnh này không cài được thư viện', () => {
    expect(HTML).toContain('DecompressionStream("deflate-raw")');
    expect(HTML).toMatch(/function zipOpen\(/);
    expect(HTML).toMatch(/async function zipRead\(/);
    expect(HTML).toMatch(/async function parseEpubToText\(/);
  });

  it('theo ĐÚNG thứ tự spine, không phải thứ tự file trong zip (c10 đứng trước c2)', () => {
    expect(HTML).toMatch(/<itemref\\b\[\^>\]\*>/);
    expect(HTML).toContain('idref');
  });

  it('BỎ QUA ảnh/font — light novel rất nhiều ảnh, giải nén là phí thời gian', () => {
    expect(HTML).toMatch(/if\(!\/html\|xml\/\.test\(type\)\) continue;/);
  });

  it('bắt được DRM và epub toàn ảnh scan, báo lỗi bằng tiếng Việt', () => {
    expect(HTML).toContain('META-INF/encryption.xml');
    expect(HTML).toMatch(/DRM/);
    expect(HTML).toMatch(/toàn ảnh scan/);
  });

  it('lỗi đọc file hiện ra ô thông báo chứ không văng exception im lặng', () => {
    expect(HTML).toMatch(/Đọc file thất bại/);
  });
});
