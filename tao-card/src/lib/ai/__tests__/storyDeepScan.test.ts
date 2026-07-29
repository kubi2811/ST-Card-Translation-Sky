/**
 * (bug 150) "Quét truyện bằng AI" — test phần THUẦN của pipeline nghiên cứu sâu:
 * chữ ký truyện (resume), gộp dữ kiện chống trùng, danh sách pass theo cấu hình,
 * digest bộ nhớ có trần, và map entry → LorebookEntry đúng chuẩn worldbook user cung cấp
 * (bug/150/chinh lorebook.txt: nhóm nào constant/depth/order bao nhiêu).
 */
import { describe, it, expect } from 'vitest';
import {
  storySig, addUniqueLines, buildPassList, initDeepState, canResume,
  findDossier, groupWorldFacts, capText, buildMemoryDigest,
  entryPlacement, toLorebookEntry, emptyMemory,
  type DeepScanOptions, type CharacterDossier, type WorldFact, type DeepEntry,
} from '../storyDeepScan';

describe('storySig — chữ ký truyện cho resume', () => {
  it('cùng truyện → cùng chữ ký; truyện khác → chữ ký khác', () => {
    const a = 'Ngày xửa ngày xưa có một tòa tháp.'.repeat(50);
    expect(storySig(a)).toBe(storySig(a));
    expect(storySig(a)).not.toBe(storySig(a + ' Chương mới.'));
  });
  it('khoảng trắng đầu/cuối không làm lệch chữ ký', () => {
    expect(storySig('  truyện  ')).toBe(storySig('truyện'));
  });
});

describe('addUniqueLines — gộp dữ kiện chống trùng', () => {
  it('bỏ dòng trùng (so sau chuẩn hoá hoa thường/khoảng trắng)', () => {
    const list = ['Hạ Đông là kiếm tu'];
    const added = addUniqueLines(list, ['  hạ đông   là kiếm tu ', 'Hạ Đông có mắt đỏ']);
    expect(added).toBe(1);
    expect(list).toHaveLength(2);
  });
  it('tôn trọng trần (cap) — không phình vô hạn', () => {
    const list: string[] = [];
    addUniqueLines(list, ['a', 'b', 'c', 'd'], 2);
    expect(list).toHaveLength(2);
  });
  it('bỏ dòng rỗng', () => {
    const list: string[] = [];
    expect(addUniqueLines(list, ['', '  ', 'x'])).toBe(1);
  });
});

describe('buildPassList — pass theo cấu hình', () => {
  it('mặc định có đủ 9 giai đoạn', () => {
    expect(buildPassList({}).map((p) => p.id)).toEqual([
      'structure', 'roster', 'characters', 'world', 'timeline', 'style', 'verify', 'synthesize', 'quality',
    ]);
  });
  it('tắt học văn phong / verify 0 vòng thì lược pass tương ứng', () => {
    const ids = buildPassList({ learnStyle: false, maxVerifyRounds: 0 }).map((p) => p.id);
    expect(ids).not.toContain('style');
    expect(ids).not.toContain('verify');
    expect(ids).toContain('synthesize');
  });
});

describe('canResume — chỉ resume khi cùng truyện + cùng cấu hình pass', () => {
  const story = 'Một truyện dài đủ để test resume.'.repeat(20);
  const opts: DeepScanOptions = {};
  it('cùng truyện + cùng cấu hình → resume được', () => {
    const st = initDeepState(story, opts, 3);
    expect(canResume(st, story, opts)).toBe(true);
  });
  it('truyện đổi → không resume', () => {
    const st = initDeepState(story, opts, 3);
    expect(canResume(st, story + 'thêm chương', opts)).toBe(false);
  });
  it('cấu hình pass đổi (tắt style) → không resume', () => {
    const st = initDeepState(story, opts, 3);
    expect(canResume(st, story, { learnStyle: false })).toBe(false);
  });
  it('null/undefined → không resume', () => {
    expect(canResume(null, story, opts)).toBe(false);
  });
});

describe('findDossier — tìm nhân vật theo tên/bí danh', () => {
  const chars: CharacterDossier[] = [
    { name: 'Triệu Hy Ngạn', aliases: ['Tiểu Triệu', 'Triệu ca'], role: 'chính', brief: '', facts: [] },
  ];
  it('trúng theo tên và theo bí danh, không phân biệt hoa thường', () => {
    expect(findDossier(chars, 'triệu hy ngạn')?.name).toBe('Triệu Hy Ngạn');
    expect(findDossier(chars, 'Tiểu Triệu')?.name).toBe('Triệu Hy Ngạn');
    expect(findDossier(chars, 'Người Lạ')).toBeUndefined();
  });
});

describe('groupWorldFacts — gộp theo chủ đề, khử fact trùng', () => {
  it('cùng topic+cat gộp một nhóm; fact trùng chỉ giữ một', () => {
    const facts: WorldFact[] = [
      { topic: 'Kiếm Tông', cat: 'faction', fact: 'Đứng đầu Lục tông' },
      { topic: 'kiếm tông', cat: 'faction', fact: 'đứng đầu lục tông' },
      { topic: 'Kiếm Tông', cat: 'faction', fact: 'Tông chủ là Tạ Vân Lưu' },
      { topic: 'Kiếm Tông', cat: 'location', fact: 'Nằm ở dãy Vạn Kiếm' },
    ];
    const groups = groupWorldFacts(facts);
    expect(groups).toHaveLength(2); // faction + location là 2 nhóm riêng
    const fac = groups.find((g) => g.cat === 'faction')!;
    expect(fac.facts).toHaveLength(2);
  });
});

describe('capText / buildMemoryDigest — digest có trần', () => {
  it('capText cắt theo dòng khi vượt trần', () => {
    const long = Array.from({ length: 100 }, (_, i) => `dòng ${i}`).join('\n');
    const capped = capText(long, 200);
    expect(capped.length).toBeLessThan(260);
    expect(capped).toContain('đã lược bớt');
  });
  it('digest chứa các mục chính và không vượt ngân sách quá xa', () => {
    const m = emptyMemory();
    m.overview = 'Truyện tu tiên, bối cảnh Âm Dương Đại Lục.';
    m.mainCharacter = 'Hạ Đông';
    m.characters = [{ name: 'Hạ Đông', aliases: [], role: 'chính', brief: '', facts: ['Kiếm tu thiên tài', 'Mắt đỏ khi vận công'] }];
    m.worldFacts = [{ topic: 'Linh căn', cat: 'system', fact: 'Ngũ hành Kim Mộc Thủy Hỏa Thổ' }];
    m.timeline = [{ time: 'Ngày 1', what: 'Hạ Đông nhập môn Kiếm Tông', chunk: 0 }];
    const digest = buildMemoryDigest(m, 5000);
    expect(digest).toContain('Hạ Đông');
    expect(digest).toContain('Linh căn');
    expect(digest).toContain('Ngày 1');
    expect(digest.length).toBeLessThanOrEqual(5100);
  });
});

describe('entryPlacement / toLorebookEntry — đúng chuẩn worldbook (chinh lorebook.txt)', () => {
  it('Group 1 (meta/system/mechanic/rule): constant, At Depth 0, role System, order 900', () => {
    for (const cat of ['meta', 'system', 'mechanic', 'rule'] as const) {
      const p = entryPlacement(cat);
      expect(p).toMatchObject({ constant: true, extPosition: 4, depth: 0, role: 0, order: 900 });
    }
  });
  it('Group 2 (worldview): constant, At Depth 4, order 800; timeline/style cũng constant ở depth 4', () => {
    expect(entryPlacement('worldview')).toMatchObject({ constant: true, extPosition: 4, depth: 4, order: 800 });
    expect(entryPlacement('timeline').constant).toBe(true);
    expect(entryPlacement('style').constant).toBe(true);
  });
  it('Group 3 (character): normal, After Char, order 200', () => {
    expect(entryPlacement('character')).toMatchObject({ constant: false, position: 'after_char', extPosition: 1, order: 200 });
  });
  it('Group 4 (faction) order 150 · Group 5 (location) order 100 — đều Before Char', () => {
    expect(entryPlacement('faction')).toMatchObject({ constant: false, extPosition: 0, order: 150 });
    expect(entryPlacement('location')).toMatchObject({ constant: false, extPosition: 0, order: 100 });
  });
  // (lõi lorebook) toLorebookEntry nay đi qua materializeEntry để dùng chung phần ống nước.
  // Chuỗi `position` của V3 là chỗ dễ lệch nhất khi nối: suy ngầm từ position số sẽ biến entry
  // @depth thành 'after_char'. Khoá lại để lần sau ai nối tiếp cũng không đổi ngầm.
  it('giữ ĐÚNG chuỗi position cũ sau khi dùng chung materializeEntry', () => {
    const meta: DeepEntry = { cat: 'meta', title: 'Hệ Thống', keys: [], content: '<Meta>…</Meta>', constant: true };
    const e = toLorebookEntry(meta, 1);
    expect(e.extensions.position, '@depth').toBe(4);
    expect(e.position, 'chuỗi V3 phải giữ before_char như trước').toBe('before_char');
    expect(e.use_regex, 'keys là chuỗi thường, không phải regex').toBe(false);
    expect(e.extensions.display_index).toBe(1);
  });

  it('toLorebookEntry: entry constant KHÔNG cần key; entry thường lấy keys (fallback = title); luôn chống đệ quy', () => {
    const constant: DeepEntry = { cat: 'worldview', title: 'Thế Giới Quan', keys: [], content: '<Worldview>…</Worldview>', constant: true };
    const ce = toLorebookEntry(constant, 1);
    expect(ce.constant).toBe(true);
    expect(ce.selective).toBe(false);
    expect(ce.keys).toEqual([]);
    expect(ce.extensions.prevent_recursion).toBe(true);
    expect(ce.extensions.exclude_recursion).toBe(true);

    const char: DeepEntry = { cat: 'character', title: 'Hạ Đông', keys: ['Hạ Đông', 'Tiểu Đông'], content: '<Character>…</Character>', constant: false };
    const ch = toLorebookEntry(char, 2);
    expect(ch.constant).toBe(false);
    expect(ch.keys).toEqual(['Hạ Đông', 'Tiểu Đông']);
    expect(ch.position).toBe('after_char');
    expect(ch.insertion_order).toBe(200);

    const noKeys: DeepEntry = { cat: 'location', title: 'Kiếm Minh Thành', keys: [], content: 'x', constant: false };
    expect(toLorebookEntry(noKeys, 3).keys).toEqual(['Kiếm Minh Thành']);
  });
});
