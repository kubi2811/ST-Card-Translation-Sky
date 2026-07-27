/**
 * (Quét tổng sau bug 125/128) THƯ VIỆN TEMPLATE EJS phải qua CÙNG bộ kiểm với code AI sinh.
 *
 * Vết sót bắt được khi quét: ejsSnippets.ts còn 18 lời gọi setEntryEnabled — API không tồn tại
 * trong ST-Prompt-template (gốc bug 125). User bấm "chèn template" trong EJS Studio là tự tay
 * nhét lỗi đỏ vào thẻ, dù mọi đường sinh AI đã được chặn. Kèm theo: snippet getwi() thiếu await
 * — chạy không lỗi nhưng in ra "[object Promise]" thay vì nội dung entry.
 *
 * Test này duyệt TOÀN BỘ thư viện qua validateWorldbookEjs — thêm template mới mà dạy API bịa
 * hay quên await là fail ngay ở CI, không đợi user báo.
 */
import { describe, it, expect } from 'vitest';
import { EJS_SNIPPETS, EJS_ADVANCED_TEMPLATES } from '../../../components/ejs/ejsSnippets';
import { validateWorldbookEjs } from '../stptApi';

const ALL = [
  ...EJS_SNIPPETS.map(s => ({ id: s.id, code: s.code })),
  ...EJS_ADVANCED_TEMPLATES.map(s => ({ id: s.id, code: s.code })),
];

describe('thư viện template EJS — sạch API bịa, đúng cú pháp', () => {
  it('có template để kiểm (thư viện không rỗng)', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(15);
  });

  for (const t of ALL) {
    it(`template "${t.id}" qua bộ kiểm dùng chung`, () => {
      const r = validateWorldbookEjs(t.code);
      expect(r.problems, t.id).toEqual([]);
    });
  }

  it('không còn bất kỳ setEntryEnabled nào trong thư viện', () => {
    for (const t of ALL) {
      expect(t.code, t.id).not.toContain('setEntryEnabled');
    }
  });

  it('mọi lời gọi getwi/activewi đều có await', () => {
    for (const t of ALL) {
      const bare = [...t.code.matchAll(/(await\s+)?\b(activewi|getwi)\s*\(/g)].filter(m => !m[1]);
      expect(bare, t.id).toEqual([]);
    }
  });
});
