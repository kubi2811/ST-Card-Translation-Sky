// (bug 157) Bảng "Hướng dẫn sử dụng" chi tiết trong app Giới thiệu.
// Bộ render viết riêng cho hub (Tạo Card dùng Tailwind, bê sang là chữ đen trên nền đen).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderGuide, extractHeadings, filterGuide, headingId, foldVi } from '../guideMarkdown';

describe('(bug 157) render markdown cho hướng dẫn', () => {
  it('tiêu đề mang id để mục lục nhảy tới được', () => {
    expect(renderGuide('## Dịch Card')).toContain(`id="guide-${headingId('Dịch Card')}"`);
  });

  it('bảng dựng đúng, dòng ngăn |---| không thành hàng dữ liệu', () => {
    const h = renderGuide('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(h).toContain('<th>A</th>');
    expect(h).toContain('<td>1</td>');
    expect(h, 'dòng ngăn không được thành hàng').not.toContain('<td>---</td>');
  });

  it('danh sách có số và không số tách riêng', () => {
    expect(renderGuide('1. một\n2. hai')).toContain('<ol');
    expect(renderGuide('- một\n- hai')).toContain('<ul');
  });

  it('đậm, nghiêng, mã trong dòng', () => {
    const h = renderGuide('**đậm** và `mã` và *nghiêng*');
    expect(h).toContain('<strong>đậm</strong>');
    expect(h).toContain('ig-code">mã<');
    expect(h).toContain('<em>nghiêng</em>');
  });

  it('HTML trong tài liệu bị escape — không cho chèn thẻ lạ', () => {
    const h = renderGuide('Chữ <script>alert(1)</script> ở đây');
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
  });

  it('khối mã giữ nguyên nội dung, không bị hiểu thành markdown', () => {
    const h = renderGuide('```\n- không phải danh sách\n```');
    expect(h).toContain('ig-pre');
    expect(h).not.toContain('<ul');
  });
});

describe('(bug 157) mục lục + tìm kiếm', () => {
  const MD = '# Trên cùng\ntext\n## Dịch Card\nnội dung về dịch thẻ\n## Tạo Card\nnội dung khác';

  it('lấy đủ tiêu đề kèm cấp', () => {
    const h = extractHeadings(MD);
    expect(h.map(x => x.text)).toEqual(['Trên cùng', 'Dịch Card', 'Tạo Card']);
    expect(h[0].level).toBe(1);
    expect(h[1].level).toBe(2);
  });

  it('lọc theo MỤC, không theo dòng — dòng lẻ tách khỏi tiêu đề thì đọc không hiểu', () => {
    const out = filterGuide(MD, 'dịch thẻ');
    expect(out).toContain('## Dịch Card');
    expect(out, 'giữ cả tiêu đề của mục khớp').toContain('nội dung về dịch thẻ');
    expect(out).not.toContain('Tạo Card');
  });

  it('gõ KHÔNG DẤU vẫn tìm ra', () => {
    expect(filterGuide(MD, 'dich card')).toContain('Dịch Card');
    expect(foldVi('Dịch Đồ')).toBe('dich do');
  });

  it('không khớp gì → rỗng (để UI báo "không có mục nào khớp")', () => {
    expect(filterGuide(MD, 'zzz')).toBe('');
  });

  it('ô tìm trống → trả nguyên tài liệu', () => {
    expect(filterGuide(MD, '   ')).toBe(MD);
  });
});

// Chạy trên CHÍNH tài liệu thật — tài liệu hỏng thì bảng hướng dẫn hỏng theo.
describe('(bug 157) USER_GUIDE.md thật', () => {
  const MD = readFileSync(resolve(__dirname, '../../../USER_GUIDE.md'), 'utf-8');

  // Phần "tài liệu có phủ hết app/tính năng không" đã chuyển sang userGuideCoverage.test.ts và
  // siết chặt hơn: danh sách app lấy thẳng từ FLOWS (không chép tay, nên thêm app mới là đỏ), đòi
  // TIÊU ĐỀ chứ không chỉ "có nhắc tên", cộng danh sách từ khoá tính năng. Hai test cũ ở đây đã bị
  // thay hẳn — để lại thì thành hai nơi canh cùng một việc ở hai mức khắt khe khác nhau, sửa nhầm
  // chỗ là tưởng đã siết mà thực ra chưa.
  // Ở lại đây chỉ những gì thuộc về BỘ RENDER, vì đó là thứ file này kiểm.

  it('id tiêu đề không trùng nhau (mục lục nhảy đúng chỗ)', () => {
    const ids = extractHeadings(MD).map(h => h.id);
    expect(new Set(ids).size, 'có id trùng → bấm mục lục nhảy sai').toBe(ids.length);
  });

  it('render ra được, không rỗng', () => {
    expect(renderGuide(MD).length).toBeGreaterThan(4000);
  });
});
