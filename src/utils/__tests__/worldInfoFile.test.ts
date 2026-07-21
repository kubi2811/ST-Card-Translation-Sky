// (User 22/07 — bug 74) Xuất kèm file World Info rời để ST tự gắn lorebook.
//
// File này PHẢI giống hệt cái ST tự tạo qua "Import Card Lore", nếu không world sinh ra sẽ khác.
// Mọi assert dưới đây đối chiếu trực tiếp với `convertCharacterBook`
// (SillyTavern public/scripts/world-info.js:5498).
import { describe, it, expect } from 'vitest';
import { characterBookToWorldInfo, worldInfoFileName } from '../worldInfoFile';

const cardWith = (entries: unknown[], bookName = 'Thế Giới Tu Tiên') => ({
  data: {
    name: 'Lâm Hạo',
    extensions: { world: bookName },
    character_book: { name: bookName, entries },
  },
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: 0, keys: ['Lâm Hạo'], secondary_keys: [], comment: 'NPC chính',
  content: 'Nội dung', constant: false, selective: true, insertion_order: 100,
  enabled: true, position: 'before_char', extensions: {}, ...over,
});

describe('characterBookToWorldInfo — khớp hợp đồng convertCharacterBook của ST', () => {
  it('entries là OBJECT khoá theo uid, không phải mảng', () => {
    const wi = characterBookToWorldInfo(cardWith([entry(), entry({ id: 7 })]))!;
    expect(Array.isArray(wi.entries)).toBe(false);
    expect(Object.keys(wi.entries).sort()).toEqual(['0', '7']);
    expect(wi.entries['7'].uid).toBe(7);
  });

  it('đổi tên field đúng chuẩn ST: keys→key, secondary_keys→keysecondary, insertion_order→order', () => {
    const e = characterBookToWorldInfo(cardWith([entry({
      keys: ['a', 'b'], secondary_keys: ['c'], insertion_order: 42,
    })]))!.entries['0'];
    expect(e.key).toEqual(['a', 'b']);
    expect(e.keysecondary).toEqual(['c']);
    expect(e.order).toBe(42);
  });

  it('CỜ NGƯỢC NGHĨA: enabled:false → disable:true (đúng ca entry [initvar])', () => {
    const on = characterBookToWorldInfo(cardWith([entry({ enabled: true })]))!.entries['0'];
    const off = characterBookToWorldInfo(cardWith([entry({ enabled: false, comment: '[initvar]初始化' })]))!.entries['0'];
    expect(on.disable).toBe(false);
    expect(off.disable).toBe(true);
  });

  it('position: before_char→0, after_char→1, nhưng extensions.position được ưu tiên', () => {
    expect(characterBookToWorldInfo(cardWith([entry({ position: 'before_char' })]))!.entries['0'].position).toBe(0);
    expect(characterBookToWorldInfo(cardWith([entry({ position: 'after_char' })]))!.entries['0'].position).toBe(1);
    // extensions.position = 4 (atDepth) — dùng cho entry [mvu_update]
    expect(characterBookToWorldInfo(cardWith([
      entry({ position: 'before_char', extensions: { position: 4, depth: 0, role: 0 } }),
    ]))!.entries['0'].position).toBe(4);
  });

  it('entry thiếu id → ST gán theo thứ tự, ta làm y hệt', () => {
    const wi = characterBookToWorldInfo(cardWith([
      entry({ id: undefined }), entry({ id: undefined, comment: 'thứ hai' }),
    ]))!;
    expect(Object.keys(wi.entries).sort()).toEqual(['0', '1']);
    expect(wi.entries['1'].comment).toBe('thứ hai');
  });

  it('có đủ mặc định của ST cho field không ai set', () => {
    const e = characterBookToWorldInfo(cardWith([entry()]))!.entries['0'];
    expect(e.probability).toBe(100);
    expect(e.useProbability).toBe(true);
    expect(e.depth).toBe(4);       // DEFAULT_DEPTH
    expect(e.groupWeight).toBe(100); // DEFAULT_WEIGHT
    expect(e.role).toBe(0);          // SYSTEM
    expect(e.scanDepth).toBeNull();
    expect(e.caseSensitive).toBeNull();
  });

  it('addMemo bật theo việc CÓ comment hay không', () => {
    expect(characterBookToWorldInfo(cardWith([entry({ comment: 'X' })]))!.entries['0'].addMemo).toBe(true);
    expect(characterBookToWorldInfo(cardWith([entry({ comment: '' })]))!.entries['0'].addMemo).toBe(false);
  });

  it('giữ originalData như ST', () => {
    const wi = characterBookToWorldInfo(cardWith([entry()]))!;
    expect((wi.originalData as any).name).toBe('Thế Giới Tu Tiên');
  });

  it('KHÔNG đẻ ra file rỗng khi thẻ không có lorebook', () => {
    expect(characterBookToWorldInfo({ data: { name: 'X', extensions: {} } })).toBeNull();
    expect(characterBookToWorldInfo(cardWith([]))).toBeNull();
    expect(characterBookToWorldInfo(null)).toBeNull();
    expect(characterBookToWorldInfo({ data: 'rác' })).toBeNull();
  });

  it('tên file = <tên world>.json — đúng cái ST lưu', () => {
    expect(worldInfoFileName('Thế Giới Tu Tiên')).toBe('Thế Giới Tu Tiên.json');
    expect(worldInfoFileName('')).toBe('Lorebook.json');
  });

  it('nạp file này rồi import thẻ ⇒ ST gắn im lặng (mô phỏng checkEmbeddedWorld)', () => {
    const card = cardWith([entry()]);
    const wi = characterBookToWorldInfo(card)!;
    expect(wi).toBeTruthy();

    // User nạp file rời trước ⇒ world_names có tên đó
    const worldNames = [worldInfoFileName(card.data.extensions.world).replace(/\.json$/, '')];
    const worldName = card.data.extensions.world;
    // Đúng điều kiện ST: chỉ MỜI import khi world chưa tồn tại
    const stWouldPrompt = !worldName || !worldNames.includes(worldName);
    expect(stWouldPrompt).toBe(false); // ⇒ không popup, gắn thẳng
  });
});
