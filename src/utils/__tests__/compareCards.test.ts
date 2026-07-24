import { describe, it, expect } from 'vitest';
import {
  buildCompareGroups, valuesDiffer, planMerge,
  entryIdentity, planMergeTwoCard, promoteSuspects,
} from '../compareCards';
import type { FieldGroup, TranslationField } from '../../types/card';

const f = (path: string, group: FieldGroup, label = path): TranslationField => ({
  path, label, group, original: '', translated: '', status: 'pending', retries: 0,
});

describe('compareCards — buildCompareGroups', () => {
  it('union path của các slot lệch nhau, gom đủ không trùng', () => {
    const slotA = [f('data.name', 'core'), f('data.character_book.entries[0].content', 'lorebook')];
    const slotB = [f('data.name', 'core'), f('data.character_book.entries[1].content', 'lorebook')];
    const groups = buildCompareGroups([slotA, slotB]);

    const core = groups.find((g) => g.group === 'core');
    const lore = groups.find((g) => g.group === 'lorebook');
    expect(core?.entries.map((e) => e.path)).toEqual(['data.name']); // trùng path → 1
    expect(lore?.entries.map((e) => e.path)).toEqual([
      'data.character_book.entries[0].content',
      'data.character_book.entries[1].content',
    ]);
  });

  it('nhóm theo thứ tự chuẩn: core trước lorebook', () => {
    const slot = [f('data.character_book.entries[0].content', 'lorebook'), f('data.name', 'core')];
    const groups = buildCompareGroups([slot]);
    expect(groups.map((g) => g.group)).toEqual(['core', 'lorebook']);
  });

  it('sort path tự nhiên: entries[2] trước entries[10]', () => {
    const slot = [
      f('data.character_book.entries[10].content', 'lorebook'),
      f('data.character_book.entries[2].content', 'lorebook'),
      f('data.character_book.entries[1].content', 'lorebook'),
    ];
    const [lore] = buildCompareGroups([slot]);
    expect(lore.entries.map((e) => e.path)).toEqual([
      'data.character_book.entries[1].content',
      'data.character_book.entries[2].content',
      'data.character_book.entries[10].content',
    ]);
  });

  it('có nhãn tiếng Việt cho nhóm', () => {
    const [core] = buildCompareGroups([[f('data.name', 'core')]]);
    expect(core.label).toContain('Cốt lõi');
  });

  it('mảng rỗng → không nhóm', () => {
    expect(buildCompareGroups([])).toEqual([]);
    expect(buildCompareGroups([[]])).toEqual([]);
  });
});

describe('compareCards — valuesDiffer', () => {
  it('mọi giá trị giống → false', () => {
    expect(valuesDiffer(['a', 'a', 'a'])).toBe(false);
  });
  it('có giá trị khác → true', () => {
    expect(valuesDiffer(['a', 'b', 'a'])).toBe(true);
  });
  it('chỉ 1 slot có giá trị (còn lại thiếu) → false', () => {
    expect(valuesDiffer(['a', undefined, undefined])).toBe(false);
  });
  it('2 slot có, giống nhau, 1 thiếu → false', () => {
    expect(valuesDiffer(['a', undefined, 'a'])).toBe(false);
  });
  it('2 slot có, khác nhau → true', () => {
    expect(valuesDiffer(['a', undefined, 'b'])).toBe(true);
  });
});

describe('compareCards — planMerge (Gộp thông minh)', () => {
  const M = (o: Record<string, string>) => new Map(Object.entries(o));

  it('entry KHÔNG đổi + có bản dịch cũ → TÁI DÙNG', () => {
    const raw = M({ 'a': '你好', 'b': '世界' });
    const dich = M({ 'a': 'Xin chào', 'b': 'Thế giới' });
    const final = M({ 'a': '你好', 'b': '世界' });
    const p = planMerge(raw, dich, final);
    expect(p.counts).toEqual({ reused: 2, changed: 0, suspect: 0, total: 2 });
    expect(p.reused.get('a')).toBe('Xin chào');
    expect(p.reused.get('b')).toBe('Thế giới');
  });

  it('entry ĐỔI (tác giả sửa) → CẦN DỊCH, không tái dùng', () => {
    const raw = M({ 'a': '你好' });
    const dich = M({ 'a': 'Xin chào' });
    const final = M({ 'a': '你好世界' }); // tác giả sửa
    const p = planMerge(raw, dich, final);
    expect(p.changed.has('a')).toBe(true);
    expect(p.reused.size).toBe(0);
  });

  it('entry MỚI (không có trong Raw) → CẦN DỊCH', () => {
    const raw = M({ 'a': '你好' });
    const dich = M({ 'a': 'Xin chào' });
    const final = M({ 'a': '你好', 'c': '新内容' }); // c là mới
    const p = planMerge(raw, dich, final);
    expect(p.reused.has('a')).toBe(true);
    expect(p.changed.has('c')).toBe(true);
    expect(p.counts).toEqual({ reused: 1, changed: 1, suspect: 0, total: 2 });
  });

  it('KHÔNG đổi nhưng THIẾU bản dịch cũ → CẦN DỊCH (không thể tái dùng)', () => {
    const raw = M({ 'a': '你好' });
    const dich = M({}); // Đã Dịch thiếu 'a'
    const final = M({ 'a': '你好' });
    const p = planMerge(raw, dich, final);
    expect(p.changed.has('a')).toBe(true);
    expect(p.reused.size).toBe(0);
  });

  it('KHÔNG đổi nhưng bản dịch cũ RỖNG → CẦN DỊCH', () => {
    const p = planMerge(M({ 'a': '你好' }), M({ 'a': '   ' }), M({ 'a': '你好' }));
    expect(p.changed.has('a')).toBe(true);
  });

  it('chỉ khác CRLF/LF → coi như KHÔNG đổi (vẫn tái dùng)', () => {
    const raw = M({ 'a': 'dòng 1\r\ndòng 2' });
    const dich = M({ 'a': 'line 1\nline 2' });
    const final = M({ 'a': 'dòng 1\ndòng 2' }); // chỉ khác xuống dòng
    const p = planMerge(raw, dich, final);
    expect(p.reused.has('a')).toBe(true);
  });

  it('bảo thủ: chỉ khác khoảng trắng đuôi → coi là ĐỔI (an toàn, thà dịch lại)', () => {
    const raw = M({ 'a': '你好' });
    const dich = M({ 'a': 'Xin chào' });
    const final = M({ 'a': '你好 ' }); // thêm 1 space đuôi
    const p = planMerge(raw, dich, final);
    expect(p.changed.has('a')).toBe(true);
  });

  it('entry bị XOÁ ở Final (còn ở Raw) → bỏ qua, không tính', () => {
    const raw = M({ 'a': '你好', 'b': '世界' });
    const dich = M({ 'a': 'Xin chào', 'b': 'Thế giới' });
    const final = M({ 'a': '你好' }); // b bị xoá
    const p = planMerge(raw, dich, final);
    expect(p.counts.total).toBe(1);
    expect(p.reused.has('b')).toBe(false);
    expect(p.changed.has('b')).toBe(false);
  });
});


/* ══════════════════════════════════════════════════════════════════════════════
 * Gióng entry theo KEY HÁN + chế độ gộp 2 card (VI cũ + gốc mới)
 * ═════════════════════════════════════════════════════════════════════════════ */

/** map path→value ở scope module (helper `M` cũ nằm trong describe khác). */
const MM = (o: Record<string, string>) => new Map(Object.entries(o));

/** Dựng map path→value cho MỘT entry lorebook (đủ keys + content) tại chỉ số i. */
const E = (i: number, keys: string, content: string): Record<string, string> => ({
  [`data.character_book.entries[${i}].keys`]: keys,
  [`data.character_book.entries[${i}].content`]: content,
});
const merge = (...objs: Record<string, string>[]) => MM(Object.assign({}, ...objs));

describe('entryIdentity — danh tính entry theo key Hán', () => {
  it('lấy đúng tập key Hán, bỏ key tiếng Việt, sort ổn định', () => {
    const m = MM(E(3, '武魂, Võ hồn, 变异', 'nội dung'));
    const id = entryIdentity(m, 'data.character_book.entries[3].content');
    expect(id).toBe('变异 武魂::content'); // đã sort, đã loại 'Võ hồn'
  });

  it('cùng entry nhưng field khác nhau → danh tính KHÁC (không khớp nhầm)', () => {
    const m = MM({ ...E(0, '武魂', 'x'), 'data.character_book.entries[0].comment': 'y' });
    expect(entryIdentity(m, 'data.character_book.entries[0].content'))
      .not.toBe(entryIdentity(m, 'data.character_book.entries[0].comment'));
  });

  it('không có key Hán → chuỗi rỗng (người gọi lùi về khớp theo path)', () => {
    expect(entryIdentity(MM(E(0, 'Võ hồn, Biến dị', 'x')), 'data.character_book.entries[0].content')).toBe('');
    expect(entryIdentity(MM({ 'data.name': 'x' }), 'data.name')).toBe('');
  });
});

describe('planMerge 3 card — chịu được tác giả CHÈN entry vào giữa', () => {
  it('chèn 1 entry vào giữa: entry cũ phía sau vẫn TÁI DÙNG (nhờ khớp key Hán)', () => {
    // Gốc cũ: [A, B].  Bản dịch cũ khớp theo path.  Gốc mới: [A, MỚI, B] → B tụt từ [1] xuống [2].
    const raw = merge(E(0, '甲', '内容甲'), E(1, '乙', '内容乙'));
    const dich = merge(E(0, '甲, Giáp', 'Nội dung Giáp'), E(1, '乙, Ất', 'Nội dung Ất'));
    const final = merge(E(0, '甲', '内容甲'), E(1, '丙', '内容丙'), E(2, '乙', '内容乙'));

    const p = planMerge(raw, dich, final);
    // B (giờ ở [2]) phải tái dùng bản dịch cũ — trước đây khớp theo index sẽ trượt thành "đã đổi".
    expect(p.reused.get('data.character_book.entries[2].content')).toBe('Nội dung Ất');
    // Entry MỚI ở [1] phải vào diện cần dịch.
    expect(p.changed.has('data.character_book.entries[1].content')).toBe(true);
    expect(p.mode).toBe('3card');
    expect(p.suspect.size).toBe(0); // 3 card thì biết chắc, không đoán
  });
});

describe('planMergeTwoCard — chỉ có bản dịch cũ + gốc mới', () => {
  const viLong = 'Nội dung tiếng Việt đã dịch '.repeat(30);   // ~810 ký tự
  const zhLong = '中文内容'.repeat(70);                        // 280 ký tự → tỉ lệ ~2.9 (bình thường)

  it('entry MỚI (không tra ra bản dịch cũ) → cần dịch', () => {
    const dich = merge(E(0, '甲, Giáp', viLong));
    const final = merge(E(0, '甲', zhLong), E(1, '丙', zhLong));
    const p = planMergeTwoCard(dich, final);
    expect(p.changed.has('data.character_book.entries[1].content')).toBe(true);
    expect(p.reused.has('data.character_book.entries[0].content')).toBe(true);
    expect(p.mode).toBe('2card');
  });

  it('bản "dịch" cũ VẪN là tiếng Trung → cần dịch', () => {
    const dich = merge(E(0, '甲, Giáp', zhLong));  // chưa từng dịch
    const final = merge(E(0, '甲', zhLong));
    const p = planMergeTwoCard(dich, final);
    expect(p.changed.has('data.character_book.entries[0].content')).toBe(true);
  });

  it('tỉ lệ độ dài bình thường → tái dùng, KHÔNG nghi ngờ', () => {
    const p = planMergeTwoCard(merge(E(0, '甲, Giáp', viLong)), merge(E(0, '甲', zhLong)));
    expect(p.reused.has('data.character_book.entries[0].content')).toBe(true);
    expect(p.suspect.size).toBe(0);
  });

  it('tỉ lệ lệch (gốc dài ra vì tác giả sửa) → VẪN tái dùng nhưng vào diện NGHI NGỜ', () => {
    const zhMuchLonger = '中文内容'.repeat(300); // 1200 ký tự → tỉ lệ ~0.67, ngoài dải
    const p = planMergeTwoCard(merge(E(0, '甲, Giáp', viLong)), merge(E(0, '甲', zhMuchLonger)));
    const path = 'data.character_book.entries[0].content';
    expect(p.reused.has(path)).toBe(true);   // mặc định vẫn tái dùng
    expect(p.suspect.has(path)).toBe(true);  // nhưng tô vàng cho user tự quyết
    expect(p.changed.has(path)).toBe(false);
  });

  it('chuỗi NGẮN thì không phán đoán tỉ lệ (tránh kêu oan)', () => {
    const p = planMergeTwoCard(merge(E(0, '甲, Giáp', 'ngắn')), merge(E(0, '甲', '短')));
    expect(p.suspect.size).toBe(0);
  });

  it('chèn entry vào giữa cũng không làm lệch (khớp key Hán)', () => {
    const dich = merge(E(0, '甲, Giáp', viLong), E(1, '乙, Ất', viLong));
    const final = merge(E(0, '甲', zhLong), E(1, '丙', zhLong), E(2, '乙', zhLong));
    const p = planMergeTwoCard(dich, final);
    expect(p.reused.has('data.character_book.entries[2].content')).toBe(true); // 乙 tụt index vẫn khớp
    expect(p.changed.has('data.character_book.entries[1].content')).toBe(true); // 丙 là entry mới
  });
});

describe('promoteSuspects — nút "Đẩy hết sang dịch lại"', () => {
  it('chuyển toàn bộ nghi ngờ sang diện cần dịch, số đếm khớp', () => {
    const viLong = 'Nội dung tiếng Việt đã dịch '.repeat(30);
    const zhMuchLonger = '中文内容'.repeat(300);
    const p = planMergeTwoCard(merge(E(0, '甲, Giáp', viLong)), merge(E(0, '甲', zhMuchLonger)));
    expect(p.counts.suspect).toBe(1);

    const q = promoteSuspects(p);
    const path = 'data.character_book.entries[0].content';
    expect(q.changed.has(path)).toBe(true);
    expect(q.reused.has(path)).toBe(false);
    expect(q.counts.suspect).toBe(0);
    expect(q.counts.reused + q.counts.changed).toBe(p.counts.reused + p.counts.changed);
  });
});
