/**
 * (bug 162) GÓI TỔNG PHẢI GỒM ĐỦ 19 PRESET, VÀ PRESET LẺ PHẢI TỰ CHẠY ĐƯỢC.
 * ─────────────────────────────────────────────────────────────────────────────
 * User đếm ra "gói Áp dụng cho tất cả mới chỉ ghi nhận 7/19 preset con" — đếm đúng: bản cũ liệt kê
 * TAY đúng 7 mục trong khi có 19 preset. Đó là hệ quả tất yếu của hai nguồn sự thật song song: thêm
 * preset con thì phải nhớ sửa cả gói tổng, và không ai nhớ.
 * Nay gói tổng dựng TỪ chính danh sách preset con, nên bài test dưới đây canh đúng cái bất biến đó:
 * thêm preset thứ 20 mà gói tổng không có nó thì đỏ ngay.
 */
import { describe, it, expect } from 'vitest';
import {
  QUICK_PRESETS, individualPresets, fullSuiteBreakdown, EJS_HOUSE_RULES,
  type PresetCardContext,
} from '../ejsQuickPresets';
import type { LorebookEntry } from '../../../types/lorebook.types';
import { DEFAULT_ENTRY_EXT } from '../../../types/lorebook.types';

// LƯU Ý: detectActivationMode() đọc `enabled` và `keys` (không phải `disable`/`key`) — fixture dùng
// sai tên trường thì mọi entry đều bị coi là 'disabled' và preset nào cũng báo "không có gì để làm".
function entry(name: string, content: string, constant = false): LorebookEntry {
  return {
    uid: Math.floor(Math.random() * 1e9), comment: name, content,
    keys: constant ? [] : [name], key: constant ? [] : [name],
    keysecondary: [], constant, enabled: true, disable: false,
    order: 100, position: 0, depth: 4, probability: 100, useProbability: true,
    selective: true, addMemo: true, excludeRecursion: true, preventRecursion: true,
    extensions: { ...DEFAULT_ENTRY_EXT },
  } as unknown as LorebookEntry;
}

/** Một đoạn dài, nhiều phần rõ rệt → đủ điều kiện cho preset tách entry. */
const BLOATED = [
  '## Vùng Bắc', 'Thành trì băng giá, dân cư sống bằng nghề săn. '.repeat(12),
  '## Vùng Nam', 'Sa mạc nóng bỏng, các bộ tộc du mục tranh giành giếng nước. '.repeat(12),
  '## Vùng Đông', 'Rừng rậm nguyên sinh, có tộc người ẩn cư biết dùng độc. '.repeat(12),
  '## Vùng Tây', 'Bờ biển thương mại, hải cảng lớn nhất lục địa. '.repeat(12),
].join('\n');

/** Card đầy đủ: có entry Constant, entry phình, schema, regex → mọi preset đều áp được. */
const richCtx: PresetCardContext = {
  entries: [
    entry('Thế giới', 'Bối cảnh chung của thế giới, luật lệ cơ bản. '.repeat(8), true),
    entry('Quy tắc xưng hô', 'Cách các nhân vật gọi nhau trong thế giới này. '.repeat(8), true),
    entry('World Regions', BLOATED),
    entry('Hệ thống Phả Hệ Shard', BLOATED.replace(/Vùng/g, 'Phả Hệ')),
    entry('Ignis', 'Phả hệ Ignis: lửa, tính cách nóng, có nhiều chi tiết riêng.'),
    entry('Glacis', 'Phả hệ Glacis: băng, lạnh lùng, cũng nhiều chi tiết.'),
    entry('Thành Bắc', 'Một thành phố phía bắc, dân cư đông.'),
  ],
  schema: {
    fields: [
      { path: 'Máu', type: 'number' }, { path: 'Vị Trí', type: 'string' },
      { path: 'Cảnh Giới', type: 'string' }, { path: 'VP', type: 'number' },
    ],
  } as unknown as PresetCardContext['schema'],
  regexScripts: [{ scriptName: 'r1', findRegex: '/a/', replaceString: 'b' }] as unknown as PresetCardContext['regexScripts'],
  tavernScripts: [],
};

describe('(bug 162 phần 2) 19 preset lẻ + 1 gói tổng', () => {
  it('đúng 19 preset lẻ và đúng 1 gói tổng — tổng 20', () => {
    expect(individualPresets().length).toBe(19);
    expect(QUICK_PRESETS.filter((p) => p.group === 'all').length).toBe(1);
    expect(QUICK_PRESETS.length).toBe(20);
  });

  it('gói tổng NHẮC TÊN đủ 19 preset con (không còn 7/19)', () => {
    const suite = QUICK_PRESETS.find((p) => p.group === 'all')!;
    const goal = suite.build(richCtx).goal;
    const missing = individualPresets().filter((p) => !goal.includes(`[preset: ${p.id}]`));
    expect(missing.map((p) => p.id),
      'preset con không xuất hiện trong gói tổng → chạy gói tổng sẽ bỏ mất việc của nó',
    ).toEqual([]);
  });

  it('gói tổng ghi rõ áp được bao nhiêu / bỏ cái nào và VÌ SAO', () => {
    const suite = QUICK_PRESETS.find((p) => p.group === 'all')!;
    const r = suite.build(richCtx);
    expect(r.notes.some((n) => /áp \d+\/\d+ preset con/.test(n))).toBe(true);
    // Card đủ điều kiện → không bỏ preset nào.
    expect(fullSuiteBreakdown(richCtx).skipped).toEqual([]);
  });

  it('card KHÔNG có schema: bỏ các preset cần biến, nhưng NÓI RÕ lý do chứ không im lặng', () => {
    const ctx: PresetCardContext = { ...richCtx, schema: null };
    const { applied, skipped } = fullSuiteBreakdown(ctx);
    expect(skipped.length, 'phải có preset bị bỏ vì thiếu schema').toBeGreaterThan(0);
    for (const s of skipped) expect(s.reason.length, `preset ${s.id} bị bỏ mà không có lý do`).toBeGreaterThan(10);
    expect(applied.length, 'vẫn còn preset chạy được (từ khoá, tách entry…)').toBeGreaterThan(0);

    const suite = QUICK_PRESETS.find((p) => p.group === 'all')!;
    const r = suite.build(ctx);
    expect(r.blockers, 'còn preset chạy được thì KHÔNG được chặn cả gói').toEqual([]);
    for (const s of skipped) expect(r.notes.join('\n')).toContain(s.title);
  });

  it('card rỗng thì chặn, kèm lời giải thích', () => {
    const suite = QUICK_PRESETS.find((p) => p.group === 'all')!;
    const r = suite.build({ ...richCtx, entries: [] });
    expect(r.blockers.length).toBeGreaterThan(0);
  });
});

describe('(bug 162 phần 2) mỗi preset lẻ phải TỰ CHẠY ĐƯỢC một mình', () => {
  for (const p of individualPresets()) {
    it(`${p.id} — dựng được, không ném lỗi, goal không rỗng`, () => {
      const r = QUICK_PRESETS.find((q) => q.id === p.id)!.build(richCtx);
      expect(r.goal.trim().length, 'goal rỗng thì AI không có việc gì để làm').toBeGreaterThan(80);
      expect(r.blockers, `${p.id} bị chặn trên card đầy đủ → không độc lập được`).toEqual([]);
      expect(Array.isArray(r.notes)).toBe(true);
    });
  }

  it('không preset nào BỊ CHẶN vì đòi preset khác chạy trước', () => {
    // Chốt vào `blockers` chứ không vào `goal`: blockers là thứ thật sự làm preset không chạy được.
    // (Soi goal bằng từ khoá thì bắt cả câu PHỦ ĐỊNH kiểu "không đòi chạy preset khác trước" —
    // đúng câu mà bản vá vừa thêm vào để nói rõ nó KHÔNG phụ thuộc.)
    const ctxNoUi: PresetCardContext = { ...richCtx, regexScripts: [], tavernScripts: [] };
    for (const ctx of [richCtx, ctxNoUi]) {
      for (const p of individualPresets()) {
        const blockers = QUICK_PRESETS.find((q) => q.id === p.id)!.build(ctx).blockers;
        const dep = blockers.find((b) => /chạy preset|preset ".*" trước/i.test(b));
        expect(dep, `${p.id} bị chặn vì đòi preset khác chạy trước: ${dep}`).toBeUndefined();
      }
    }
  });
});

describe('(bug 162 mục 3.3–3.6) quy ước chung áp cho CẢ preset chạy lẻ', () => {
  it('mọi preset lẻ đều mang bộ quy ước', () => {
    for (const p of individualPresets()) {
      const goal = QUICK_PRESETS.find((q) => q.id === p.id)!.build(richCtx).goal;
      expect(goal, `${p.id} thiếu quy ước chung → chạy lẻ ra kết quả lệch chuẩn so với chạy gói`)
        .toContain('QUY ƯỚC CHUNG CHO MỌI KHỐI EJS');
    }
  });

  it('gói tổng cũng có quy ước, và KHÔNG bị nối lồng 19 lần', () => {
    const goal = QUICK_PRESETS.find((p) => p.group === 'all')!.build(richCtx).goal;
    const n = (goal.match(/QUY ƯỚC CHUNG CHO MỌI KHỐI EJS/g) ?? []).length;
    expect(n, 'nối lồng nhiều lần là phình prompt vô ích').toBe(1);
  });

  it('3.3 — cấm tạo hai entry điều khiển gần trùng tên', () => {
    expect(EJS_HOUSE_RULES.join('\n')).toContain('Mapping Ngữ cảnh');
    expect(EJS_HOUSE_RULES.join('\n')).toMatch(/không tạo hai entry điều khiển/i);
  });

  it('3.4 — chốt MỘT quy ước default, nêu đúng ba kiểu đang lẫn lộn', () => {
    const s = EJS_HOUSE_RULES.join('\n');
    expect(s).toContain('Chưa rõ');
    expect(s).toContain('Chưa xác định');
    expect(s).toMatch(/biến SỐ\s*: mặc định 0/);
  });

  it('3.5 — buộc ép kiểu số, cấm default dạng chuỗi', () => {
    const s = EJS_HOUSE_RULES.join('\n');
    expect(s).toContain('Number(getvar');
    expect(s).toContain(`'100'`);
  });

  it('3.6 — tách đều, cấm dồn vào entry "Khác"', () => {
    const s = EJS_HOUSE_RULES.join('\n');
    expect(s).toMatch(/tách ĐỀU/i);
    expect(s).toContain('Khác');
    expect(s).toMatch(/giữ NGUYÊN VĂN/i);
  });
});

describe('(bug 162 mục 3.2) phải rà HẾT entry, chỉ miễn bộ máy MVU', () => {
  const goal = QUICK_PRESETS.find((p) => p.group === 'all')!.build(richCtx).goal;

  it('nêu rõ số entry và bắt xét từng entry', () => {
    expect(goal).toContain(`${richCtx.entries.length} entry`);
    expect(goal).toMatch(/TỪNG entry/);
  });

  it('miễn trừ đúng nhóm MVU, không miễn trừ lore', () => {
    expect(goal).toContain('[initvar]');
    expect(goal).toMatch(/quy tắc cập nhật biến/);
    expect(goal).toMatch(/danh sách biến/);
  });

  it('entry xét rồi mà giữ nguyên cũng phải ghi lý do — chống nhầm "bỏ sót" với "đã xét"', () => {
    expect(goal).toMatch(/giữ nguyên thì ghi vào ghi chú/i);
  });
});
