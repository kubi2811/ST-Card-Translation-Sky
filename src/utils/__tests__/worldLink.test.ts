// (User 22/07 — bug 73) "Lúc import card vào ST thì hay bị tách riêng lorebook với card,
// phải tự đi add lại vào."
//
// Bằng chứng file thật (soi bằng python trên card của user):
//   Long Tộc v8.1 (thật, chạy được):  book.name === ext.world   ← khớp
//   _tr.json (Dịch Card xuất ra):      book.name = "Chiến Cơ Ánh Sáng (6.5)" (đã dịch)
//                                      ext.world = "光之战姬 (6.5)"          (còn tiếng Trung)
// Cả app không có dòng nào ghi data.extensions.world → mọi card dịch đều đứt sợi dây.
import { describe, it, expect } from 'vitest';
import { syncEmbeddedWorldLink, isGenericBookName } from '../worldLink';

const mk = (book: unknown, world?: string, name = 'Nhân Vật') => ({
  data: {
    name,
    extensions: world === undefined ? {} : { world },
    ...(book === undefined ? {} : { character_book: book }),
  },
} as Record<string, unknown>);

describe('syncEmbeddedWorldLink — nối lại lorebook nhúng với nhân vật', () => {
  it('CA BUG THẬT: book.name đã dịch, ext.world còn tiếng Trung → nối lại', () => {
    const original = mk({ name: '光之战姬 (6.5)', entries: [] }, '光之战姬 (6.5)');
    const exported = mk({ name: 'Chiến Cơ Ánh Sáng (6.5)', entries: [] }, '光之战姬 (6.5)');

    const r = syncEmbeddedWorldLink(exported, original);

    expect(r.relinkedWorld).toBe(true);
    expect((r.card as any).data.extensions.world).toBe('Chiến Cơ Ánh Sáng (6.5)');
    expect((r.card as any).data.character_book.name).toBe('Chiến Cơ Ánh Sáng (6.5)');
  });

  it('card thật đã khớp sẵn → không đụng gì', () => {
    const c = mk({ name: 'Sách Thế Giới Long Tộc', entries: [] }, 'Sách Thế Giới Long Tộc');
    const r = syncEmbeddedWorldLink(c, c);
    expect(r.relinkedWorld).toBe(false);
    expect(r.renamedBook).toBe(false);
    expect((r.card as any).data.extensions.world).toBe('Sách Thế Giới Long Tộc');
  });

  it('chưa có ext.world → set theo tên sách (ST sẽ gắn đúng sau khi import lore)', () => {
    const c = mk({ name: 'Thế Giới Tu Tiên', entries: [] });
    const r = syncEmbeddedWorldLink(c, c);
    expect(r.relinkedWorld).toBe(true);
    expect((r.card as any).data.extensions.world).toBe('Thế Giới Tu Tiên');
  });

  it('KHÔNG đụng world NGOÀI mà user cố ý trỏ tới', () => {
    // Gốc: sách tên A nhưng world trỏ sang B ⇒ user dùng world riêng, không phải sách nhúng.
    const original = mk({ name: 'Sách A', entries: [] }, 'World Riêng Của Tôi');
    const exported = mk({ name: 'Sách A đã dịch', entries: [] }, 'World Riêng Của Tôi');
    const r = syncEmbeddedWorldLink(exported, original);
    expect(r.keptExternalWorld).toBe(true);
    expect(r.relinkedWorld).toBe(false);
    expect((r.card as any).data.extensions.world).toBe('World Riêng Của Tôi');
  });

  it('tên sách chung chung → đổi thành tên riêng theo nhân vật (tránh ghi đè card khác)', () => {
    for (const generic of ['New Character', 'Imported Lorebook', 'Game Master', 'Narrator', '']) {
      const c = mk({ name: generic, entries: [] }, undefined, 'Lâm Hạo');
      const r = syncEmbeddedWorldLink(c, c);
      expect(r.renamedBook, `"${generic}" phai bi doi ten`).toBe(true);
      expect((r.card as any).data.character_book.name).toBe("Lâm Hạo's Lorebook");
      expect((r.card as any).data.extensions.world).toBe("Lâm Hạo's Lorebook");
    }
  });

  it('thiếu hẳn character_book.name → vẫn đặt được tên', () => {
    const c = mk({ entries: [] }, undefined, 'Vô Danh');
    const r = syncEmbeddedWorldLink(c, c);
    expect((r.card as any).data.character_book.name).toBe("Vô Danh's Lorebook");
  });

  it('card KHÔNG có lorebook nhúng → không tạo ra world ma', () => {
    const c = mk(undefined, undefined, 'Trơ Trọi');
    const r = syncEmbeddedWorldLink(c, c);
    expect(r.relinkedWorld).toBe(false);
    expect(r.worldName).toBe('');
    expect((r.card as any).data.extensions.world).toBeUndefined();
  });

  it('chạy 2 lần cho kết quả y hệt (idempotent)', () => {
    const original = mk({ name: '原名', entries: [] }, '原名');
    const once = syncEmbeddedWorldLink(mk({ name: 'Tên Mới', entries: [] }, '原名'), original);
    const twice = syncEmbeddedWorldLink(once.card, original);
    expect(twice.relinkedWorld).toBe(false);
    expect((twice.card as any).data.extensions.world).toBe('Tên Mới');
  });

  it('rác/null không làm sập', () => {
    expect(() => syncEmbeddedWorldLink(null)).not.toThrow();
    expect(() => syncEmbeddedWorldLink({} as any)).not.toThrow();
    expect(() => syncEmbeddedWorldLink({ data: 'khong phai object' } as any)).not.toThrow();
  });

  it('isGenericBookName phân biệt đúng', () => {
    expect(isGenericBookName('New Character')).toBe(true);
    expect(isGenericBookName('  imported lorebook ')).toBe(true);
    expect(isGenericBookName('')).toBe(true);
    expect(isGenericBookName('Sách Thế Giới Long Tộc')).toBe(false);
  });
});
