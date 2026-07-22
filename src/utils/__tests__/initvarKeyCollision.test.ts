// (User 22/07 — bug 77) MVU báo "变量更新失败" trên thẻ ĐÃ DỊCH, dù thẻ có ĐỦ 5 entry hệ thống
// (nên đây KHÔNG phải bug 75 — bug 75 là thẻ Auto Creator thiếu entry định dạng đầu ra).
//
// Đo thật trên bugNeedFix/1:
//   [initvar] bản gốc : 36 khoá distinct
//   [initvar] bản dịch: 35 khoá distinct   ← mất hẳn 1 field
// Thủ phạm: 口 và 臀 CÙNG dịch thành "Miệng" (臀 đúng ra là "Mông" — 0 lần xuất hiện).
// Hai khoá YAML anh em trùng tên ⇒ node sau đè node trước ⇒ stat_data mất field ⇒ mọi
// JSONPatch trỏ vào đường dẫn đó thất bại.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractYamlKeys, findSiblingCollisions, compareInitvarKeys } from '../initvarKeyCollision';

describe('extractYamlKeys — dựng cây khoá theo thụt lề', () => {
  it('gắn đúng node cha cho từng khoá', () => {
    const keys = extractYamlKeys(['主角:', '  基础信息:', '    口: 小', '    臀: 翘'].join('\n'));
    expect(keys.map(k => `${k.parentPath}|${k.name}`)).toEqual([
      '|主角', '主角|基础信息', '主角/基础信息|口', '主角/基础信息|臀',
    ]);
  });

  it('bỏ qua dòng trống, chú thích và dấu --- mở đầu YAML', () => {
    expect(extractYamlKeys('---\n# ghi chú\n\na: 1').map(k => k.name)).toEqual(['a']);
  });
});

describe('findSiblingCollisions — chỉ tính khoá CÙNG CHA', () => {
  it('CA THẬT: 口 và 臀 cùng ra "Miệng" ⇒ báo va chạm', () => {
    const yaml = ['Nhân Vật Chính:', '  Thông Tin:', '    Miệng: nhỏ', '    Miệng: cong'].join('\n');
    const cols = findSiblingCollisions(yaml);
    expect(cols).toHaveLength(1);
    expect(cols[0].name).toBe('Miệng');
    expect(cols[0].count).toBe(2);
  });

  it('KHÔNG báo khi trùng tên nhưng KHÁC CHA (hoàn toàn hợp lệ trong YAML)', () => {
    // "Tên" xuất hiện dưới hai nhân vật khác nhau — không hề va chạm
    const yaml = [
      'Nhân Vật Chính:', '  Tên: A',
      'Kẻ Địch:', '  Tên: B',
    ].join('\n');
    expect(findSiblingCollisions(yaml)).toHaveLength(0);
  });

  it('YAML sạch → không báo gì', () => {
    expect(findSiblingCollisions('a:\n  b: 1\n  c: 2')).toHaveLength(0);
  });
});

describe('compareInitvarKeys — chỉ báo va chạm DO DỊCH gây ra', () => {
  const orig = ['主角:', '  基础信息:', '    口: 小', '    臀: 翘'].join('\n');

  it('CA THẬT: dịch làm mất 1 field ⇒ báo lỗi + đếm đúng số field mất', () => {
    const tr = ['Nhân Vật Chính:', '  Thông Tin:', '    Miệng: nhỏ', '    Miệng: cong'].join('\n');
    const r = compareInitvarKeys(orig, tr);
    expect(r.introduced).toHaveLength(1);
    expect(r.introduced[0].name).toBe('Miệng');
    expect(r.origDistinct).toBe(4);
    expect(r.transDistinct).toBe(3);
    expect(r.lostFields).toBe(1);
  });

  it('dịch ĐÚNG (口→Miệng, 臀→Mông) ⇒ không báo gì, không mất field', () => {
    const tr = ['Nhân Vật Chính:', '  Thông Tin:', '    Miệng: nhỏ', '    Mông: cong'].join('\n');
    const r = compareInitvarKeys(orig, tr);
    expect(r.introduced).toHaveLength(0);
    expect(r.lostFields).toBe(0);
  });

  it('bản GỐC vốn đã trùng khoá ⇒ xếp vào preexisting, KHÔNG đổ lỗi cho bản dịch', () => {
    const dupOrig = ['主角:', '  口: a', '  口: b'].join('\n');
    const dupTr = ['Nhân Vật Chính:', '  Miệng: a', '  Miệng: b'].join('\n');
    const r = compareInitvarKeys(dupOrig, dupTr);
    expect(r.introduced).toHaveLength(0);
    expect(r.preexisting).toHaveLength(1);
  });

  it('rác/rỗng không làm sập', () => {
    expect(() => compareInitvarKeys('', '')).not.toThrow();
    expect(compareInitvarKeys('', '').lostFields).toBe(0);
  });
});

// ─── Test tích hợp trên CẶP THẺ THẬT của user (chỉ chạy khi fixture còn ở bugNeedFix) ───
// Đây là bằng chứng gốc của bug 77: cùng một thẻ, bản gốc và bản do tool dịch ra.
const RAW = fileURLToPath(new URL('../../../bugNeedFix/1/_raw.json', import.meta.url));
const TR = fileURLToPath(new URL('../../../bugNeedFix/1/_tr.json', import.meta.url));
const hasFixture = fs.existsSync(RAW) && fs.existsSync(TR);

const initvarOf = (p: string): string => {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const e of (j?.data?.character_book?.entries ?? [])) {
    const cm = String(e?.comment ?? '');
    if (/initvar/i.test(cm) || cm.includes('初始化')) return String(e?.content ?? '');
  }
  return '';
};

describe.skipIf(!hasFixture)('bug 77 trên THẺ THẬT (bugNeedFix/1)', () => {
  it('bắt được đúng field bị nuốt mất do dịch trùng tên', () => {
    const r = compareInitvarKeys(initvarOf(RAW), initvarOf(TR));

    // Bản dịch mất khoá so với bản gốc — đây chính là field MVU không tìm thấy lúc chạy.
    expect(r.transDistinct).toBeLessThan(r.origDistinct);
    expect(r.lostFields).toBeGreaterThan(0);

    // Và bộ dò phải chỉ ra được thủ phạm, không chỉ báo con số.
    expect(r.introduced.length).toBeGreaterThan(0);
    expect(r.introduced.some(c => c.name === 'Miệng')).toBe(true);
  });

  it('bản GỐC vốn không có va chạm nào — lỗi hoàn toàn do bước dịch', () => {
    const raw = initvarOf(RAW);
    expect(raw.length).toBeGreaterThan(0);
    expect(findSiblingCollisions(raw)).toHaveLength(0);
  });
});
