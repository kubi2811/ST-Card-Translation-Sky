// (User 23/07 — bug 93) "Nâng cấp Regex Lab có thêm preview, mà xem được giao diện như trên
// SillyTavern khi bọc ```html và ```".
//
// Card MVU gói giao diện trong khối fence Markdown; SillyTavern bóc fence rồi render HTML bên
// trong. Regex Lab trước giờ nhét NGUYÊN chuỗi (kể cả dấu fence) vào iframe nên user thấy chữ
// "```html" chình ình còn HTML thì hiển thị như văn bản.
import { describe, it, expect } from 'vitest';
import { stripHtmlFence, extractFenceBlocks } from '../stripHtmlFence';

// Ghép fence trong test để chính file test này không bị hiểu nhầm là khối markdown.
const F = '`'.repeat(3);

describe('stripHtmlFence — bóc fence y như SillyTavern', () => {
  it('CA CHÍNH: bóc khối ```html để lấy HTML thật', () => {
    const src = [`${F}html`, '<div class="bar">Xin chào</div>', F].join('\n');
    const r = stripHtmlFence(src);
    expect(r.hadFence).toBe(true);
    expect(r.unclosed).toBe(false);
    expect(r.html).toBe('<div class="bar">Xin chào</div>');
    expect(r.html).not.toContain(F);
  });

  it('bóc được cả tài liệu HTML đầy đủ (đúng thứ Auto Creator sinh ra)', () => {
    const src = [`${F}html`, '<!DOCTYPE html>', '<html><body>x</body></html>', F].join('\n');
    expect(stripHtmlFence(src).html).toContain('<!DOCTYPE html>');
    expect(stripHtmlFence(src).html.startsWith(F)).toBe(false);
  });

  it('THIẾU fence đóng → vẫn xem trước được NHƯNG bị đánh dấu (đây là lỗi bug 72)', () => {
    const src = [`${F}html`, '<div>chưa đóng</div>'].join('\n');
    const r = stripHtmlFence(src);
    expect(r.hadFence).toBe(true);
    expect(r.unclosed).toBe(true);
    expect(r.html).toContain('<div>chưa đóng</div>');
  });

  it('không có fence → trả nguyên văn (regex thay bằng HTML trần vẫn render được)', () => {
    const src = '<span class="thoai">Nói chuyện</span>';
    const r = stripHtmlFence(src);
    expect(r.hadFence).toBe(false);
    expect(r.html).toBe(src);
  });

  it('có chữ dẫn trước/sau khối fence → chỉ lấy phần trong fence', () => {
    const src = ['Trước khối:', `${F}html`, '<b>giao diện</b>', F, 'Sau khối.'].join('\n');
    const r = stripHtmlFence(src);
    expect(r.html).toBe('<b>giao diện</b>');
    expect(r.html).not.toContain('Trước khối');
  });

  it('nhiều khối fence → nối lại, ST cũng render lần lượt', () => {
    const src = [`${F}html`, '<i>A</i>', F, 'giữa', `${F}html`, '<i>B</i>', F].join('\n');
    const r = stripHtmlFence(src);
    expect(r.blockCount).toBe(2);
    expect(r.html).toContain('<i>A</i>');
    expect(r.html).toContain('<i>B</i>');
    expect(r.html).not.toContain('giữa');
  });

  it('fence trần (không ghi ngôn ngữ) và ```HTML hoa đều nhận', () => {
    expect(stripHtmlFence([F, '<p>x</p>', F].join('\n')).html).toBe('<p>x</p>');
    expect(stripHtmlFence([`${F}HTML`, '<p>y</p>', F].join('\n')).html).toBe('<p>y</p>');
  });

  it('giữ nguyên khoảng trắng và xuống dòng bên trong (CSS/JS cần)', () => {
    const inner = '<style>\n  .a { color: red; }\n</style>';
    expect(stripHtmlFence([`${F}html`, inner, F].join('\n')).html).toBe(inner);
  });

  it('extractFenceBlocks ghi đúng cờ closed cho từng khối', () => {
    const src = [`${F}html`, 'A', F, `${F}html`, 'B'].join('\n');
    const blocks = extractFenceBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].closed).toBe(true);
    expect(blocks[1].closed).toBe(false);
    expect(blocks[0].lang).toBe('html');
  });

  it('rác/rỗng không làm sập', () => {
    expect(() => stripHtmlFence('')).not.toThrow();
    expect(stripHtmlFence('').html).toBe('');
    expect(stripHtmlFence(null as unknown as string).hadFence).toBe(false);
  });
});
