/**
 * (bugNeedFix/146) HƯỚNG DẪN SỬ DỤNG PHẢI THEO KỊP TÍNH NĂNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Hướng Dẫn Sử Dụng (Studio V2.0) cũng nên được cập nhật lại, cho thêm tính năng tự
 * động cập nhật Hướng dẫn sử dụng khi tool có thêm tính năng mới hay nâng cấp cái gì đó."
 *
 * "Tự động VIẾT hộ" thì không làm được tử tế — máy không biết tính năng dùng ra sao, và để AI
 * bịa vào tài liệu chính thức thì còn hại hơn thiếu. Thứ làm được và có ích thật là TỰ ĐỘNG
 * PHÁT HIỆN THIẾU: mỗi tính năng lớn phải để lại dấu vết trong USER_GUIDE.md, thiếu là test đỏ
 * ngay lúc thêm tính năng — người thêm biết liền thay vì để tài liệu mục ruỗng dần.
 *
 * Thêm tính năng mới: thêm một dòng vào FEATURES rồi viết mục tương ứng trong USER_GUIDE.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const guide = readFileSync(resolve(__dirname, '../../../../USER_GUIDE.md'), 'utf-8');
const norm = guide.toLowerCase();

/** [tên tính năng, các từ khoá — chỉ cần MỘT từ khoá có mặt là coi như đã ghi]. */
const FEATURES: Array<[string, string[]]> = [
  ['Cài đặt AI / đa provider',        ['settingspage', 'cài đặt ai']],
  ['Trình biên tập thẻ',              ['cardeditorpage', 'trình biên tập']],
  ['Sổ tay tri thức (Lorebook)',      ['lorebookpage', 'sổ tay tri thức']],
  ['Trình tạo thẻ tự động',           ['autocreatorpage', 'tạo thẻ tự động']],
  ['Phòng thí nghiệm Regex',          ['regexlabpage', 'biểu thức']],
  ['MVUZOD Studio',                   ['mvuzod']],
  ['EJS Studio',                      ['ejs studio']],
  ['Wiki Collector',                  ['wiki']],
  ['Xuất bản & khắc phục sự cố',      ['xuất bản', 'khắc phục']],
  // ── Tính năng thêm sau khi tài liệu bản đầu được viết ──
  ['Xem trước & Tinh chỉnh (bug 141)', ['xem trước & tinh chỉnh', 'xem trước và tinh chỉnh']],
  ['Đũa thần ý tưởng (bug 137)',       ['đũa thần']],
  ['Nhờ AI tạo giao diện (bug 145)',   ['ai tạo giao diện', 'nhờ ai tạo giao diện']],
  ['Preset Nhanh EJS (bug 126)',       ['preset nhanh']],
  ['Tạo thẻ từ truyện (bug 136)',      ['tạo thẻ từ truyện', 'từ truyện']],
  ['Danh sách phiên bản (bug 146)',    ['danh sách phiên bản', 'phiên bản']],
];

describe('USER_GUIDE.md phủ hết tính năng lớn', () => {
  it('tài liệu tồn tại và đủ dài', () => {
    expect(guide.length).toBeGreaterThan(2000);
  });

  for (const [name, keys] of FEATURES) {
    it(`có ghi: ${name}`, () => {
      const hit = keys.some(k => norm.includes(k.toLowerCase()));
      expect(hit, `USER_GUIDE.md chưa nhắc tới "${name}" (tìm: ${keys.join(' / ')}). `
        + 'Thêm tính năng thì phải viết vào hướng dẫn — đây chính là chốt chặn cho việc đó.').toBe(true);
    });
  }

  it('mục lục liệt kê đủ các mục lớn (không sót mục nào)', () => {
    // Đối chiếu bằng SỐ MỤC — bền hơn so khớp tên (tên có emoji, dấu, viết hoa khác nhau).
    const sectionNums = [...guide.matchAll(/^##\s+(\d+)\./gm)].map(m => m[1]);
    const tocNums = [...guide.matchAll(/^\s*(\d+)\.\s+\[/gm)].map(m => m[1]);
    const missing = sectionNums.filter(n => !tocNums.includes(n));
    expect(missing, `Có mục ${missing.join(', ')} trong tài liệu nhưng CHƯA có trong mục lục.`).toEqual([]);
    expect(sectionNums.length).toBeGreaterThanOrEqual(10);
  });
});
