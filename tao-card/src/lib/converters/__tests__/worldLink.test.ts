// (User 22/07 — bug 73) "Lúc import card vào ST thì hay bị tách riêng lorebook với card,
// phải tự đi add lại vào."
//
// Đọc mã nguồn SillyTavern (public/scripts/world-info.js, checkEmbeddedWorld):
//     const worldName = characters[chid]?.data?.extensions?.world;
//     if (!accountStorage.getItem(checkKey) && (!worldName || !world_names.includes(worldName))) { … }
// → `data.extensions.world` là sợi dây duy nhất buộc nhân vật với world. App này trước giờ
// chưa từng ghi field đó (chỉ khởi tạo world: ''), nên card xuất ra luôn rời lorebook.
//
// Test đi qua ĐÚNG hàm xuất thật (exportCardV3 / exportCardV2Compat) chứ không test util
// riêng lẻ — vì bug gốc chính là hàm xuất quên gọi util.
import { describe, it, expect } from 'vitest';
import { exportCardV3, exportCardV2Compat } from '../lorebookConvert';
import { createEmptyCard } from '../cardDefaults';
import type { CharacterCardV3 } from '../../../types';

function cardWith(bookName: string | undefined, charName: string, world?: string): CharacterCardV3 {
  const c = createEmptyCard();
  c.data.name = charName;
  c.data.character_book = {
    ...(bookName === undefined ? {} : { name: bookName }),
    entries: [],
  } as CharacterCardV3['data']['character_book'];
  if (world !== undefined) c.data.extensions.world = world;
  return c;
}

const parsed = (json: string) => JSON.parse(json) as Record<string, any>;

describe('bug 73 — card xuất ra phải tự gắn lorebook vào nhân vật', () => {
  it('exportCardV3 ghi extensions.world khớp tên sách', () => {
    const out = parsed(exportCardV3(cardWith('Thế Giới Tu Tiên', 'Lâm Hạo')));
    expect(out.data.extensions.world).toBe('Thế Giới Tu Tiên');
    expect(out.data.character_book.name).toBe('Thế Giới Tu Tiên');
  });

  it('exportCardV2Compat (chunk chara của PNG) cũng mang sợi dây world', () => {
    const out = parsed(exportCardV2Compat(cardWith('Thế Giới Tu Tiên', 'Lâm Hạo')));
    expect(out.data.extensions.world).toBe('Thế Giới Tu Tiên');
  });

  it('tên sách mặc định "New Character" bị đổi thành tên riêng — không ghi đè world card khác', () => {
    // createEmptyCard để sẵn character_book.name = 'New Character'; hai card khác nhau mà cùng
    // tên sách thì ST cảnh báo "It will overwrite the World/Lorebook with the same name".
    const a = parsed(exportCardV3(cardWith('New Character', 'Lâm Hạo')));
    const b = parsed(exportCardV3(cardWith('New Character', 'Tô Vân')));
    expect(a.data.character_book.name).toBe("Lâm Hạo's Lorebook");
    expect(b.data.character_book.name).toBe("Tô Vân's Lorebook");
    expect(a.data.character_book.name).not.toBe(b.data.character_book.name);
    expect(a.data.extensions.world).toBe(a.data.character_book.name);
  });

  it('sách chưa có tên → vẫn đặt được tên và gắn world', () => {
    const out = parsed(exportCardV3(cardWith(undefined, 'Vô Danh')));
    expect(out.data.character_book.name).toBe("Vô Danh's Lorebook");
    expect(out.data.extensions.world).toBe("Vô Danh's Lorebook");
  });

  it('KHÔNG đụng world NGOÀI mà thẻ gốc cố ý trỏ tới', () => {
    const src = cardWith('Sách Của Thẻ', 'Lâm Hạo', 'World Riêng Của Tôi');
    const out = parsed(exportCardV3(src));
    expect(out.data.extensions.world).toBe('World Riêng Của Tôi');
  });

  it('card không có lorebook nhúng → không đẻ ra world ma', () => {
    const c = createEmptyCard();
    c.data.name = 'Trơ Trọi';
    c.data.character_book = undefined as unknown as CharacterCardV3['data']['character_book'];
    const out = parsed(exportCardV3(c));
    expect(out.data.extensions.world).toBe('');
  });

  it('xuất không làm hỏng thẻ gốc trong store (chỉ đụng bản sao)', () => {
    const src = cardWith('New Character', 'Lâm Hạo');
    exportCardV3(src);
    expect(src.data.character_book!.name).toBe('New Character');
    expect(src.data.extensions.world).toBe('');
  });
});
