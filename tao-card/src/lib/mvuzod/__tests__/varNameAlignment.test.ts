// (User 22/07 — bug 78) "Nhập Opening Form không cập nhật vào trình quản lý biến + biến không
// cập nhật vào thanh trạng thái." Form nhập được, Status Bar hiện — nhưng không cái nào chạm
// tới biến.
//
// Đo trên thẻ thật (bugNeedFix/41), bốn nơi khai báo biến KHÔNG cặp nào giao nhau:
//   Schema Zod      : Player > Name, CurrentVP        (cây, tiếng Anh)
//   Entry [initvar] : "Player/Name:"                  ← khoá PHẲNG có dấu /
//   Opening Form    : "Cấp Tầng Hiện Tại"             ← NHÃN tiếng Việt, không phải tên biến
//   Status Bar      : 0 data-var
import { describe, it, expect } from 'vitest';
import { nestFlatInitvarKeys } from '../nestFlatInitvar';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../normalizeSchema';

describe('bug 78a — initvar phẳng phải dựng lại thành cây YAML', () => {
  it('CA THẬT: "Player/Name:" → Player > Name', () => {
    const flat = [
      'Player/Name: "Eldran Wanderer"',
      'Player/CurrentVP: 150',
      'Guild/Rank: "F"',
    ].join('\n');
    const out = nestFlatInitvarKeys(flat);
    expect(out).toContain('Player:');
    expect(out).toContain('  Name: "Eldran Wanderer"');
    expect(out).toContain('  CurrentVP: 150');
    expect(out).toContain('Guild:');
    expect(out).toContain('  Rank: "F"');
    // và KHÔNG còn khoá nào mang dấu /
    expect(out).not.toMatch(/^\s*\S*\/\S*:/m);
  });

  it('gom đúng nhánh, không đẻ ra Player hai lần', () => {
    const out = nestFlatInitvarKeys('Player/A: 1\nPlayer/B: 2');
    expect(out.match(/^Player:/gm)).toHaveLength(1);
  });

  it('giữ dòng đầu [initvar] và chú thích', () => {
    const out = nestFlatInitvarKeys('[initvar]\nPlayer/Name: "X"');
    expect(out.startsWith('[initvar]')).toBe(true);
  });

  it('KHÔNG đụng initvar vốn đã đúng dạng cây', () => {
    const nested = 'Player:\n  Name: "X"\n  CurrentVP: 150';
    expect(nestFlatInitvarKeys(nested)).toBe(nested);
  });

  it('rác/rỗng không làm sập', () => {
    expect(() => nestFlatInitvarKeys('')).not.toThrow();
    expect(nestFlatInitvarKeys('')).toBe('');
  });
});

describe('bug 78b — Opening Form phải ghi TÊN BIẾN, không phải nhãn hiển thị', () => {
  // Đúng dạng schema thật: path là tên biến (Anh), label là chữ hiển thị (Việt)
  const schema = normalizeMVUZODSchema({
    version: '1.0',
    fields: [
      { path: '/Player', type: 'object', label: 'Thông tin Người Chơi', constraints: {}, defaultValue: {},
        children: [
          { path: '/Player/Name', type: 'string', label: 'Tên Người Chơi', constraints: {}, defaultValue: '' },
          { path: '/Player/CurrentVP', type: 'number', label: 'Veil Point (VP) Hiện Thời', constraints: {}, defaultValue: 0 },
        ] },
    ],
  });

  const formJs = () => {
    const r = buildProgrammaticRegex({ schema, component: 'opening_form', gameName: 'T' });
    return r.scripts.map(s => String(s.replaceString)).join('\n');
  };

  it('mappings dùng path (Player/Name), KHÔNG dùng nhãn tiếng Việt', () => {
    const js = formJs();
    expect(js).toContain('"Player"');
    expect(js).toContain('"Name"');
    expect(js).toContain('"CurrentVP"');
    // Nhãn hiển thị không được lọt vào đường dẫn biến
    expect(js).not.toContain('"Thông tin Người Chơi"');
    expect(js).not.toContain('"Veil Point (VP) Hiện Thời"');
  });

  it('tên biến của form KHỚP tên biến trong schema', () => {
    const js = formJs();
    const paths = [...js.matchAll(/"path"\s*:\s*\[([^\]]+)\]/g)]
      .flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
    expect(paths.length).toBeGreaterThan(0);
    const schemaNames = new Set(['Player', 'Name', 'CurrentVP']);
    for (const p of paths) {
      expect(schemaNames.has(p), `"${p}" khong co trong schema`).toBe(true);
    }
  });
});
