/**
 * (bug 126) Test cho lõi "AI tự quyết" mới của EJS Studio.
 *
 * User báo kế hoạch "khá sơ sài và không thực hiện được tất cả yêu cầu", và nêu rõ EJS
 * không được đụng nhau. Hai nhóm test dưới đây khoá đúng hai thứ đó:
 *   - đo hiện trạng kích hoạt + gợi ý chuyển Constant sang từ khoá/điều kiện (tiết kiệm token);
 *   - bắt và tự vá xung đột giữa các khối EJS, đặc biệt là ca hỏng IM LẶNG.
 */
import { describe, it, expect } from 'vitest';
import {
  detectActivationMode, estimateEntryTokens, suggestReclassification,
  detectExistingStatusUi,
} from '../ejsPlanModel';
import {
  extractVarDecls, extractSetvarPaths, varNameFromPath,
  findCollisions, autopatchCollisions,
} from '../ejsCollision';
import type { LorebookEntry } from '../../../types';
import { DEFAULT_ENTRY_EXT } from '../../../types/lorebook.types';

function mkEntry(p: Partial<LorebookEntry> & { id: number }): LorebookEntry {
  return {
    id: p.id, keys: p.keys ?? [], secondary_keys: [], comment: p.comment ?? `#${p.id}`,
    content: p.content ?? '', constant: p.constant ?? false, selective: false,
    insertion_order: 100, enabled: p.enabled ?? true, position: 'before_char',
    use_regex: false, extensions: { ...DEFAULT_ENTRY_EXT },
  } as LorebookEntry;
}

describe('detectActivationMode — đo hiện trạng từ card, không tin AI khai', () => {
  it('tắt thì là tắt, dù có constant', () => {
    expect(detectActivationMode(mkEntry({ id: 1, enabled: false, constant: true }))).toBe('disabled');
  });
  it('constant nuốt keyword', () => {
    expect(detectActivationMode(mkEntry({ id: 2, constant: true, keys: ['a'] }))).toBe('constant');
  });
  it('có key → theo từ khoá', () => {
    expect(detectActivationMode(mkEntry({ id: 3, keys: ['Lâm Uyển'] }))).toBe('keyword');
  });
  it('bật, không constant, không key → chỉ controller gọi được', () => {
    expect(detectActivationMode(mkEntry({ id: 4 }))).toBe('conditional');
  });
});

describe('suggestReclassification — ba nhóm đúng như user mô tả', () => {
  const entries = [
    mkEntry({ id: 1, constant: true, comment: 'Quy tắc xưng hô', content: 'x'.repeat(400) }),
    mkEntry({ id: 2, constant: true, comment: 'NPC: Lâm Uyển', content: 'Thân thiết với người chơi. ' + 'y'.repeat(800) }),
    mkEntry({ id: 3, constant: true, comment: 'Cảnh giới tu luyện', content: 'Khi canh gioi đạt Kim Đan… ' + 'z'.repeat(600) }),
    mkEntry({ id: 4, keys: ['x'], comment: 'Đã theo từ khoá rồi' }),
  ];

  it('entry quy tắc bắt buộc → GIỮ Constant, không đề xuất', () => {
    const s = suggestReclassification(entries, ['canh gioi']);
    expect(s.find(r => r.name === 'Quy tắc xưng hô')).toBeUndefined();
  });

  it('entry gắn biến MVU → đề xuất kích hoạt theo điều kiện', () => {
    const s = suggestReclassification(entries, ['canh gioi']);
    const row = s.find(r => r.name === 'Cảnh giới tu luyện');
    expect(row?.suggested).toBe('conditional');
    expect(row?.reason).toContain('canh gioi');
  });

  it('entry không gắn biến → đề xuất theo từ khoá', () => {
    const s = suggestReclassification(entries, ['canh gioi']);
    expect(s.find(r => r.name === 'NPC: Lâm Uyển')?.suggested).toBe('keyword');
  });

  it('entry vốn không Constant → không đụng tới', () => {
    const s = suggestReclassification(entries, []);
    expect(s.find(r => r.name === 'Đã theo từ khoá rồi')).toBeUndefined();
  });

  it('sắp xếp nặng token trước để user duyệt cái đáng tiền nhất', () => {
    const s = suggestReclassification(entries, ['canh gioi']);
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s[0].tokensSaved).toBeGreaterThanOrEqual(s[s.length - 1].tokensSaved);
  });

  it('ước lượng token tính chữ Hán nặng hơn chữ Latin', () => {
    const han = estimateEntryTokens(mkEntry({ id: 9, content: '天'.repeat(100) }));
    const lat = estimateEntryTokens(mkEntry({ id: 9, content: 'a'.repeat(100) }));
    expect(han).toBeGreaterThan(lat);
  });
});

describe('detectExistingStatusUi — biết card đã có thanh trạng thái để khỏi tạo trùng', () => {
  it('bắt entry có khung HTML + đọc biến', () => {
    const r = detectExistingStatusUi([
      mkEntry({ id: 1, comment: 'Hiển thị', content: '<div class="bar"><%= getvar("stat_data.hp") %></div>' }),
    ]);
    expect(r.hasStatusUi).toBe(true);
    expect(r.places[0]).toContain('Hiển thị');
  });

  it('bắt theo tên dù nội dung không rõ ràng', () => {
    const r = detectExistingStatusUi([], [{ scriptName: 'Thanh trạng thái v2', replaceString: '<b>x</b>' }]);
    expect(r.hasStatusUi).toBe(true);
  });

  it('entry văn xuôi thường → không báo nhầm', () => {
    const r = detectExistingStatusUi([mkEntry({ id: 1, comment: 'Bối cảnh', content: 'Một ngôi làng nhỏ.' })]);
    expect(r.hasStatusUi).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ejsCollision — EJS không được đụng nhau', () => {
  it('bóc được khai báo biến kèm nguồn getvar', () => {
    const code = "@@preprocessing\n<%_\nif (typeof _x === 'undefined') var _x = getvar('stat_data.hp', { defaults: 0 });\n_%>";
    expect(extractVarDecls(code)).toEqual([{ varName: '_x', source: 'stat_data.hp' }]);
  });

  it('bóc được đường dẫn setvar', () => {
    expect(extractSetvarPaths("<%_ setvar('stat_data.a', 1); _%>")).toEqual(['stat_data.a']);
  });

  it('CHÍNH CA HỎNG IM LẶNG: hai khối cùng tên biến, khác nguồn getvar', () => {
    const blocks = [
      { name: 'Khối A', code: "<%_ if (typeof _x === 'undefined') var _x = getvar('stat_data.hp'); _%>" },
      { name: 'Khối B', code: "<%_ if (typeof _x === 'undefined') var _x = getvar('stat_data.canh gioi'); _%>" },
    ];
    const issues = findCollisions(blocks);
    const c = issues.find(i => i.code === 'ejs-var-conflict');
    expect(c).toBeTruthy();
    expect(c!.message).toContain('stat_data.hp');
    expect(c!.message).toContain('stat_data.canh gioi');
    expect(c!.autofixable).toBe(true);
  });

  it('cùng tên biến CÙNG nguồn → không phải xung đột', () => {
    const blocks = [
      { name: 'A', code: "<%_ var _x = getvar('stat_data.hp'); _%>" },
      { name: 'B', code: "<%_ var _x = getvar('stat_data.hp'); _%>" },
    ];
    expect(findCollisions(blocks).filter(i => i.code === 'ejs-var-conflict')).toEqual([]);
  });

  it('hai khối cùng setvar một đường dẫn → báo, và KHÔNG tự vá (máy không đủ căn cứ chọn chủ)', () => {
    const blocks = [
      { name: 'A', code: "<%_ setvar('stat_data.diem', 1); _%>" },
      { name: 'B', code: "<%_ setvar('stat_data.diem', 2); _%>" },
    ];
    const c = findCollisions(blocks).find(i => i.code === 'ejs-setvar-conflict');
    expect(c).toBeTruthy();
    expect(c!.autofixable).toBe(false);
  });

  it('trùng tên entry — kể cả với entry đã có sẵn trong card', () => {
    const c = findCollisions([
      { name: 'Bộ điều khiển', code: '<%_ _%>' },
      { name: 'bộ điều khiển', code: '<%_ _%>' },   // khác hoa thường vẫn là trùng
    ]);
    expect(c.some(i => i.code === 'ejs-name-conflict')).toBe(true);
  });

  it('tên biến suy từ đường dẫn là tất định và phân biệt được hai đường dẫn', () => {
    expect(varNameFromPath('stat_data.canh gioi')).toBe('_canh_gioi');
    expect(varNameFromPath('stat_data.hp')).toBe('_hp');
    expect(varNameFromPath('stat_data.canh gioi')).not.toBe(varNameFromPath('stat_data.hp'));
  });

  it('tự vá: đổi tên biến theo nguồn, vá xong hết xung đột', () => {
    const blocks = [
      { name: 'A', code: "<%_ var _x = getvar('stat_data.hp');\nif (_x > 5) { } _%>" },
      { name: 'B', code: "<%_ var _x = getvar('stat_data.canh gioi');\nif (_x === 'Kim Đan') { } _%>" },
    ];
    const { blocks: patched, fixed } = autopatchCollisions(blocks);
    expect(fixed.length).toBeGreaterThan(0);
    expect(findCollisions(patched).filter(i => i.code === 'ejs-var-conflict')).toEqual([]);
    // Khối B phải dùng tên mới ở CẢ khai báo lẫn chỗ so sánh.
    expect(patched[1].code).toContain('_canh_gioi');
    expect(patched[1].code).not.toMatch(/(?<![\w$])_x(?![\w$])/);
  });

  it('tự vá không ăn nhầm biến có tên chứa tên biến kia', () => {
    const blocks = [
      { name: 'A', code: "<%_ var _x = getvar('stat_data.hp'); _%>" },
      { name: 'B', code: "<%_ var _x = getvar('stat_data.mp');\nvar _x_khac = 1; _%>" },
    ];
    const { blocks: patched } = autopatchCollisions(blocks);
    expect(patched[1].code).toContain('_x_khac');
  });
});

describe('không đề xuất hạ cấp chính thanh trạng thái của card', () => {
  // Bắt được khi chạy thử live: entry "Thanh trạng thái của tôi" đọc getvar nên khớp luật
  // "gắn biến MVU" và bị đề xuất chuyển sang kích hoạt theo điều kiện — tức bảo user tắt
  // giao diện họ tự làm, mâu thuẫn với chính cơ chế phát hiện UI vốn sinh ra để bảo vệ nó.
  it('entry là giao diện thanh trạng thái → bỏ qua', () => {
    const entries = [
      mkEntry({ id: 1, constant: true, comment: 'Thanh trạng thái của tôi',
        content: '<div class="bar"><%= getvar("stat_data.hp") %></div>' }),
      mkEntry({ id: 2, constant: true, comment: 'NPC: Lâm Uyển', content: 'y'.repeat(400) }),
    ];
    const s = suggestReclassification(entries, ['hp']);
    expect(s.find(r => r.name === 'Thanh trạng thái của tôi')).toBeUndefined();
    expect(s.find(r => r.name === 'NPC: Lâm Uyển')).toBeTruthy();
  });
});
