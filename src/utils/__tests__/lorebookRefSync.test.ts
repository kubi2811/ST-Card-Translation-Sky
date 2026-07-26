import { describe, it, expect } from 'vitest';
import {
  extractLorebookRefs,
  buildLorebookRefDictionary,
  enforceLorebookRefs,
  validateLorebookRefs,
  collectLorebookIdentity,
  buildLorebookRefPromptBlock,
} from '../lorebookRefSync';
import { buildEntryNameDictionary } from '../mvuValidator';

/**
 * (User 2026 — việc 81) Script/regex trỏ lorebook bằng TÊN SÁCH, TÊN ENTRY hoặc UID.
 * Tên sách và tên entry đều là field ĐƯỢC DỊCH, nhưng chuỗi nằm trong code lại do một lượt
 * gọi AI khác dịch → ra chữ khác → script tìm không thấy entry, im lặng không chạy.
 */

describe('extractLorebookRefs — coi mỗi tham chiếu là MỘT key', () => {
  it('bắt tên SÁCH ở hàm TavernHelper', () => {
    const refs = extractLorebookRefs("const es = await getLorebookEntries('主世界书');");
    expect(refs).toEqual([{ kind: 'book', value: '主世界书', via: 'hàm thao tác sách' }]);
  });

  it('bắt tên ENTRY ở so sánh comment — dạng phổ biến nhất của card thật', () => {
    const refs = extractLorebookRefs("entries.find(e => e.comment === '开场白')");
    expect(refs).toContainEqual({ kind: 'entry', value: '开场白', via: 'so sánh comment/name' });
  });

  it('bắt cả khi viết ngược vế', () => {
    const refs = extractLorebookRefs("if ('开场白' === entry.comment) {}");
    expect(refs.some(r => r.kind === 'entry' && r.value === '开场白')).toBe(true);
  });

  it('bắt .comment.includes(...)', () => {
    const refs = extractLorebookRefs("es.filter(e => e.comment.includes('状态栏'))");
    expect(refs.some(r => r.kind === 'entry' && r.value === '状态栏')).toBe(true);
  });

  it('bắt getwi(null, "entry") — kiểu EJS cũ', () => {
    const refs = extractLorebookRefs("await getwi(null, '世界观设定')");
    expect(refs).toContainEqual({ kind: 'entry', value: '世界观设定', via: 'đối số entry của getwi/activewi' });
  });

  it('getwi("sách", "entry") → tách đúng đối số nào là sách, đối số nào là entry', () => {
    const refs = extractLorebookRefs("getwi('主世界书', '开场白')");
    expect(refs).toContainEqual({ kind: 'book', value: '主世界书', via: 'đối số sách của getwi' });
    expect(refs).toContainEqual({ kind: 'entry', value: '开场白', via: 'đối số entry của getwi/activewi' });
  });

  it('bắt activewi(..., "entry", true)', () => {
    const refs = extractLorebookRefs("activewi(null, '隐藏设定', true)");
    expect(refs.some(r => r.kind === 'entry' && r.value === '隐藏设定')).toBe(true);
  });

  it('bắt uid', () => {
    const refs = extractLorebookRefs('entries.find(e => e.uid === 12)');
    expect(refs).toContainEqual({ kind: 'uid', value: '12', via: 'so sánh uid' });
  });

  it('bắt gán comment khi tạo entry mới', () => {
    const refs = extractLorebookRefs("createLorebookEntries('书', [{ comment: '新条目', content: 'x' }])");
    expect(refs.some(r => r.kind === 'book' && r.value === '书')).toBe(true);
    expect(refs.some(r => r.kind === 'entry' && r.value === '新条目')).toBe(true);
  });

  it('không trùng lặp khi cùng một tham chiếu xuất hiện nhiều lần', () => {
    const refs = extractLorebookRefs("a(e.comment === '开场白'); b(e.comment === '开场白');");
    expect(refs.filter(r => r.value === '开场白')).toHaveLength(1);
  });

  it('code không đụng lorebook → không bắt gì', () => {
    expect(extractLorebookRefs("const x = 'hello'; console.log(x);")).toEqual([]);
  });

  it('text rỗng/không phải chuỗi → không nổ', () => {
    expect(extractLorebookRefs('')).toEqual([]);
    expect(extractLorebookRefs(null as unknown as string)).toEqual([]);
  });
});

describe('buildEntryNameDictionary — GỐC của bug: card thật dùng .comment chứ không .name', () => {
  it('đọc được entry .comment (trước đây bỏ sót → từ điển RỖNG)', () => {
    const dict = buildEntryNameDictionary([
      { path: 'data.character_book.entries[0].comment', original: '开场白', translated: 'Lời mở đầu', status: 'done' },
    ]);
    expect(dict['开场白']).toBe('Lời mở đầu');
  });

  it('vẫn đọc .name như cũ', () => {
    const dict = buildEntryNameDictionary([
      { path: 'data.character_book.entries[1].name', original: '设定', translated: 'Thiết Lập', status: 'done' },
    ]);
    expect(dict['设定']).toBe('Thiết Lập');
  });

  it('không lấy field chưa dịch xong hoặc dịch y hệt bản gốc', () => {
    const dict = buildEntryNameDictionary([
      { path: 'data.character_book.entries[0].comment', original: 'A', translated: 'B', status: 'pending' },
      { path: 'data.character_book.entries[1].comment', original: 'C', translated: 'C', status: 'done' },
    ]);
    expect(Object.keys(dict)).toHaveLength(0);
  });
});

describe('buildLorebookRefDictionary', () => {
  it('tách đúng tên sách và tên entry', () => {
    const d = buildLorebookRefDictionary([
      { path: 'data.character_book.name', original: '主世界书', translated: 'Sách Thế Giới Chính', status: 'done' },
      { path: 'data.character_book.entries[0].comment', original: '开场白', translated: 'Lời mở đầu', status: 'done' },
      { path: 'data.description', original: '别的', translated: 'Khác', status: 'done' },
    ]);
    expect(d.book).toEqual({ '主世界书': 'Sách Thế Giới Chính' });
    expect(d.entry).toEqual({ '开场白': 'Lời mở đầu' });
  });
});

describe('enforceLorebookRefs — ép chuỗi trong code khớp tên đã dịch', () => {
  const dict = {
    book: { '主世界书': 'Sách Thế Giới Chính' },
    entry: { '开场白': 'Lời mở đầu', '状态栏': 'Bảng trạng thái' },
  };

  it('sửa tên sách trong lời gọi hàm', () => {
    const r = enforceLorebookRefs("await getLorebookEntries('主世界书');", dict);
    expect(r.text).toBe("await getLorebookEntries('Sách Thế Giới Chính');");
    expect(r.fixes[0]).toMatchObject({ kind: 'book', from: '主世界书', to: 'Sách Thế Giới Chính' });
  });

  it('sửa tên entry trong so sánh comment', () => {
    const r = enforceLorebookRefs("es.find(e => e.comment === '开场白')", dict);
    expect(r.text).toContain("e.comment === 'Lời mở đầu'");
  });

  it('sửa nhiều tham chiếu khác nhau trong cùng một script', () => {
    const src = "const b = await getLorebookEntries('主世界书');\nconst a = b.find(e => e.comment === '开场白');\nconst s = b.filter(e => e.comment.includes('状态栏'));";
    const r = enforceLorebookRefs(src, dict);
    expect(r.text).toContain('Sách Thế Giới Chính');
    expect(r.text).toContain('Lời mở đầu');
    expect(r.text).toContain('Bảng trạng thái');
    expect(r.fixes).toHaveLength(3);
  });

  it('KHÔNG đụng chuỗi trùng tên nằm ngoài vị trí tham chiếu (không thay mù toàn văn)', () => {
    const src = "const label = '开场白'; // ghi chú\nes.find(e => e.comment === '开场白')";
    const r = enforceLorebookRefs(src, dict);
    expect(r.text).toContain("const label = '开场白';");
    expect(r.text).toContain("e.comment === 'Lời mở đầu'");
  });

  it('KHÔNG bao giờ đổi uid (số, không dịch)', () => {
    const r = enforceLorebookRefs('es.find(e => e.uid === 12)', dict);
    expect(r.text).toBe('es.find(e => e.uid === 12)');
    expect(r.fixes).toHaveLength(0);
  });

  it('giữ nguyên loại nháy đang dùng', () => {
    expect(enforceLorebookRefs('getLorebookEntries("主世界书")', dict).text)
      .toBe('getLorebookEntries("Sách Thế Giới Chính")');
    expect(enforceLorebookRefs('getLorebookEntries(`主世界书`)', dict).text)
      .toBe('getLorebookEntries(`Sách Thế Giới Chính`)');
  });

  it('từ điển rỗng → trả nguyên văn, không fix gì', () => {
    const r = enforceLorebookRefs("getLorebookEntries('主世界书')", { book: {}, entry: {} });
    expect(r.text).toBe("getLorebookEntries('主世界书')");
    expect(r.fixes).toHaveLength(0);
  });

  it('tham chiếu không có trong từ điển → để nguyên, không bịa', () => {
    const r = enforceLorebookRefs("getLorebookEntries('未知书')", dict);
    expect(r.text).toContain('未知书');
  });
});

describe('validateLorebookRefs — soi tham chiếu trỏ vào hư không', () => {
  const card = {
    data: {
      character_book: {
        name: 'Sách Thế Giới Chính',
        entries: [
          { comment: 'Lời mở đầu', uid: 3 },
          { comment: 'Bảng trạng thái', uid: 4 },
        ],
      },
    },
  };

  it('tham chiếu khớp entry có thật → không báo', () => {
    const r = validateLorebookRefs(card, [{ text: "es.find(e => e.comment === 'Lời mở đầu')", source: 'script A' }]);
    expect(r.mismatches).toHaveLength(0);
    expect(r.checked).toBe(1);
  });

  it('tham chiếu còn tên gốc chưa đồng bộ → BÁO LỖI (trước đây im lặng)', () => {
    const r = validateLorebookRefs(card, [{ text: "es.find(e => e.comment === '开场白')", source: 'script A' }]);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ kind: 'entry', value: '开场白', source: 'script A' });
  });

  it('chỉ lệch hoa/thường → gợi ý luôn tên đúng', () => {
    const r = validateLorebookRefs(card, [{ text: "e.comment === 'lời mở đầu'", source: 'S' }]);
    expect(r.mismatches[0].suggestion).toBe('Lời mở đầu');
  });

  it('tên SÁCH sai → báo', () => {
    const r = validateLorebookRefs(card, [{ text: "getLorebookEntries('主世界书')", source: 'S' }]);
    expect(r.mismatches.some(m => m.kind === 'book')).toBe(true);
  });

  it('uid có thật → không báo; uid không có → báo', () => {
    expect(validateLorebookRefs(card, [{ text: 'e.uid === 3', source: 'S' }]).mismatches).toHaveLength(0);
    expect(validateLorebookRefs(card, [{ text: 'e.uid === 99', source: 'S' }]).mismatches).toHaveLength(1);
  });

  it('card KHÔNG dùng uid → không báo oan tham chiếu uid', () => {
    const noUid = { data: { character_book: { name: 'B', entries: [{ comment: 'X' }] } } };
    expect(validateLorebookRefs(noUid, [{ text: 'e.uid === 7', source: 'S' }]).mismatches).toHaveLength(0);
  });
});

describe('buildLorebookRefPromptBlock — dạy AI coi chuỗi trong code là khoá tra cứu', () => {
  it('liệt kê cả tên sách lẫn tên entry, nhắc không đổi uid', () => {
    const out = buildLorebookRefPromptBlock({
      book: { '主世界书': 'Sách Chính' },
      entry: { '开场白': 'Lời mở đầu' },
    });
    expect(out).toContain('主世界书');
    expect(out).toContain('Sách Chính');
    expect(out).toContain('开场白');
    expect(out).toMatch(/uid/i);
  });

  it('chưa có gì để dặn → trả chuỗi rỗng (không làm phình prompt)', () => {
    expect(buildLorebookRefPromptBlock({ book: {}, entry: {} })).toBe('');
  });
});

describe('collectLorebookIdentity', () => {
  it('gom cả comment lẫn name, cả tên sách và uid', () => {
    const id = collectLorebookIdentity({
      data: { character_book: { name: 'B', entries: [{ comment: 'C', name: 'N', uid: 1 }] } },
    });
    expect(id.bookNames.has('B')).toBe(true);
    expect(id.entryNames.has('C')).toBe(true);
    expect(id.entryNames.has('N')).toBe(true);
    expect(id.uids.has('1')).toBe(true);
  });

  it('card không có lorebook → tập rỗng, không nổ', () => {
    const id = collectLorebookIdentity({});
    expect(id.entryNames.size).toBe(0);
  });
});

// ─── (bugNeedFix/110) Khoá tên worldbook + hằng số WI_FILE ────────────────────────────────
import { getLockedBookName, setLockedBookName } from '../lorebookRefSync';

describe('bug 110: hằng số tên sách trong script bảng trạng thái', () => {
  const dict = { book: { 'Mùa hè của em': 'Mùa hè của em (VI)' }, entry: {} };

  it('const WI_FILE = "…" được ép khớp (bản cũ chỉ soi đối số hàm nên bỏ lọt)', () => {
    const src = "const WI_FILE='Mùa hè của em';  // Vui lòng thay bằng tên tệp";
    const r = enforceLorebookRefs(src, dict);
    expect(r.text).toContain("'Mùa hè của em (VI)'");
    expect(r.fixes[0].via).toContain('hằng số');
  });

  it('nhận cả BOOK_NAME / LOREBOOK_NAME / WORLDBOOK', () => {
    for (const name of ['BOOK_NAME', 'LOREBOOK_NAME', 'WORLDBOOK']) {
      const r = enforceLorebookRefs(`let ${name} = "Mùa hè của em";`, dict);
      expect(r.text).toContain('Mùa hè của em (VI)');
    }
  });

  it('không đụng hằng số khác trùng nội dung', () => {
    const r = enforceLorebookRefs("const TITLE = 'Mùa hè của em';", dict);
    expect(r.text).toBe("const TITLE = 'Mùa hè của em';");
  });
});

describe('bug 110: khoá tên worldbook', () => {
  it('chốt rồi thì tra ra đúng tên đã chốt', () => {
    const lock = setLockedBookName({}, 'Mùa hè của em', 'Mùa hè của em (bản Việt)');
    expect(getLockedBookName(lock, 'Mùa hè của em')).toBe('Mùa hè của em (bản Việt)');
  });

  it('tra bỏ qua khoảng trắng thừa và hoa/thường', () => {
    const lock = setLockedBookName({}, 'Mùa hè của em', 'X');
    expect(getLockedBookName(lock, '  Mùa   hè của em ')).toBe('X');
    expect(getLockedBookName(lock, 'MÙA HÈ CỦA EM')).toBe('X');
  });

  it('đặt giá trị rỗng = bỏ khoá', () => {
    let lock = setLockedBookName({}, 'A B', 'X');
    lock = setLockedBookName(lock, 'A B', '');
    expect(getLockedBookName(lock, 'A B')).toBeUndefined();
  });

  it('khoá ĐÈ lên bản dịch của lượt hiện tại (đó là mục đích của khoá)', () => {
    const d = buildLorebookRefDictionary(
      [{ path: 'data.character_book.name', original: 'Mùa hè của em', translated: 'Mùa hạ của em', status: 'done' }],
      { 'Mùa hè của em': 'Mùa hè của em' },
    );
    expect(d.book['Mùa hè của em']).toBe('Mùa hè của em');
  });

  it('không có khoá thì giữ nguyên hành vi cũ', () => {
    const d = buildLorebookRefDictionary(
      [{ path: 'data.character_book.name', original: 'Mùa hè của em', translated: 'Mùa hạ của em', status: 'done' }],
    );
    expect(d.book['Mùa hè của em']).toBe('Mùa hạ của em');
  });
});
