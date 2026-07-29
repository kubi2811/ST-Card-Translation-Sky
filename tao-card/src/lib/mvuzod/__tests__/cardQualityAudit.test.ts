// (bug 135) Bộ soát chất lượng card MVU/EJS — kiểm trên CHÍNH 2 card thật user gửi (bug/135)
// và trên ca dựng sẵn. Card thật nằm ngoài git (thư mục bug/ bị gitignore) nên phần đó skipIf.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { auditCardQuality, extractComparedStrings, foldVi, collectLeafFields } from '../cardQualityAudit';
import { repairQualityIssues } from '../../ai/cardAutoRepair';
import type { CharacterCardV3 } from '../../../types';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { LorebookEntry } from '../../../types';

const mkEntry = (o: Partial<LorebookEntry>): LorebookEntry => ({
  id: o.id ?? 1, keys: o.keys ?? [], secondary_keys: [], comment: o.comment ?? 'E',
  content: o.content ?? '', constant: o.constant ?? false, selective: false,
  insertion_order: o.insertion_order ?? 100, enabled: o.enabled ?? true,
  position: o.position ?? 'before_char', use_regex: false,
  extensions: (o.extensions ?? {}) as LorebookEntry['extensions'],
  ...o,
} as LorebookEntry);

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        {
          path: '/Người Chơi/Phả Hệ', type: 'string', label: 'Phả Hệ', defaultValue: 'Chưa thức tỉnh',
          constraints: { enumValues: ['Chưa thức tỉnh', 'Ignis', 'Glacis', 'Umbra'] },
        },
        { path: '/Người Chơi/VP', type: 'number', label: 'VP', defaultValue: 100, constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

describe('(bug 135) trợ giúp', () => {
  it('extractComparedStrings chỉ lấy chuỗi trong phép SO SÁNH, bỏ chuỗi để in', () => {
    const code = `<%_ if (_ph === 'Ignis') { print('Bạn thuộc hệ hoả'); } _%>`;
    const got = extractComparedStrings(code);
    expect(got).toContain('Ignis');
    expect(got).not.toContain('Bạn thuộc hệ hoả');
  });

  it('foldVi so được "Sơ Thức" với "sơ thức"; collectLeafFields lấy đúng lá', () => {
    expect(foldVi('Sơ Thức')).toBe(foldVi('sơ thức'));
    expect(collectLeafFields(SCHEMA).map(f => f.label)).toEqual(['Phả Hệ', 'VP']);
  });
});

describe('(bug 135) EJS so chuỗi với enum schema', () => {
  it('so giá trị KHÔNG có trong enum → lỗi, kèm gợi ý giá trị đúng (ca Card 1: "Chưa rõ")', () => {
    const issues = auditCardQuality({
      schema: SCHEMA,
      entries: [mkEntry({
        comment: 'EJS: Cơ chế chiến đấu theo Phả Hệ',
        content: `@@preprocessing\n<%_ var _ph = getvar('stat_data.Người Chơi.Phả Hệ');\n`
          + `if (_ph === 'Chưa rõ') { } else if (_ph === 'Ignis') { } _%>`,
      })],
    });
    const mismatch = issues.filter(i => i.code === 'ejs-enum-mismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].level).toBe('error');
    expect(mismatch[0].message).toContain('Chưa rõ');
    expect(mismatch[0].message).toContain('Chưa thức tỉnh');   // gợi ý đúng
    expect(mismatch[0].autofixable).toBe(true);
  });

  it('phủ gần đủ nhánh nhưng thiếu vài giá trị → cảnh báo (không phải lỗi)', () => {
    const issues = auditCardQuality({
      schema: SCHEMA,
      entries: [mkEntry({
        comment: 'EJS phân nhánh',
        content: `@@preprocessing\n<%_ var _p = getvar('Phả Hệ');\n`
          + `if (_p === 'Chưa thức tỉnh') {} else if (_p === 'Ignis') {} else if (_p === 'Glacis') {} _%>`,
      })],
    });
    const cov = issues.filter(i => i.code === 'ejs-enum-coverage');
    expect(cov).toHaveLength(1);
    expect(cov[0].level).toBe('warning');
    expect(cov[0].message).toContain('Umbra');
  });

  it('EJS phủ ĐỦ enum → không báo gì', () => {
    const issues = auditCardQuality({
      schema: SCHEMA,
      entries: [mkEntry({
        comment: 'EJS đủ nhánh',
        content: `@@preprocessing\n<%_ var _p = getvar('Phả Hệ');\n`
          + `if (_p === 'Chưa thức tỉnh') {} else if (_p === 'Ignis') {} else if (_p === 'Glacis') {} else if (_p === 'Umbra') {} _%>`,
      })],
    });
    expect(issues.filter(i => i.code.startsWith('ejs-enum'))).toEqual([]);
  });
});

describe('(bug 135) entry không có đường kích hoạt', () => {
  it('tắt + không key + không constant + không EJS nào bật → entry CHẾT (ca 3 entry Lễ Hội Card 2)', () => {
    const issues = auditCardQuality({
      entries: [mkEntry({ comment: 'Lễ Hội: Hội Băng Glacis', content: 'Mô tả lễ hội…', enabled: false, keys: [] })],
    });
    const dead = issues.filter(i => i.code === 'dead-entry');
    expect(dead).toHaveLength(1);
    expect(dead[0].autofixable).toBe(true);
  });

  it('[initvar] tắt là ĐÚNG CHUẨN — không được báo', () => {
    const issues = auditCardQuality({
      entries: [mkEntry({ comment: '[initvar]初始化', content: 'HP: 100', enabled: false, keys: [''] })],
    });
    expect(issues.filter(i => i.code === 'dead-entry' || i.code === 'orphan-disabled')).toEqual([]);
  });

  it('entry tắt nhưng có controller EJS gọi tên → KHÔNG báo (đúng mô hình conditional)', () => {
    const issues = auditCardQuality({
      entries: [
        mkEntry({ id: 1, comment: 'Bí cảnh Kim Đan', content: 'lore', enabled: false, keys: [] }),
        mkEntry({ id: 2, comment: 'Controller', content: `@@preprocessing\n<%_ await activewi('Bí cảnh Kim Đan', true); _%>` }),
      ],
    });
    expect(issues.filter(i => i.code === 'dead-entry')).toEqual([]);
  });
});

describe('(bug 135) schema + cấu hình entry', () => {
  it('biến số có defaultValue kiểu chuỗi → lỗi (so sánh sẽ so theo chữ)', () => {
    const schema = {
      version: '1.0',
      fields: [{ path: '/VP', type: 'number', label: 'VP', defaultValue: '100', constraints: {} }],
    } as unknown as MVUZODSchema;
    const issues = auditCardQuality({ schema, entries: [] });
    expect(issues.filter(i => i.code === 'number-default-string')).toHaveLength(1);
  });

  it('nhiều entry cùng (order, position) → cảnh báo thứ tự không xác định', () => {
    const issues = auditCardQuality({
      entries: [
        mkEntry({ id: 1, comment: 'A', insertion_order: 200, extensions: { position: 4 } as never }),
        mkEntry({ id: 2, comment: 'B', insertion_order: 200, extensions: { position: 4 } as never }),
      ],
    });
    expect(issues.filter(i => i.code === 'order-position-clash')).toHaveLength(1);
  });

  it('entry bảng biến (constant) chứa VÍ DỤ UpdateVariable giá trị cứng → lỗi (ca Card 2)', () => {
    const issues = auditCardQuality({
      entries: [mkEntry({
        comment: 'Danh sách biến', constant: true,
        content: '<UpdateVariable><Analysis>x</Analysis><JSONPatch>[{"op":"replace","path":"/VP","value":15}]</JSONPatch></UpdateVariable>',
      })],
    });
    expect(issues.filter(i => i.code === 'varlist-example-content')).toHaveLength(1);
  });
});

describe('(bug 135) repairQualityIssues — vá được thì vá, không xoá nội dung', () => {
  const mkCard = (entries: LorebookEntry[], schema?: MVUZODSchema): CharacterCardV3 => ({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: 'T', character_book: { name: 'wb', entries },
      extensions: schema ? { mvuzod: { schema } } : {},
    },
  } as unknown as CharacterCardV3);

  it('EJS so "Chưa rõ" → tự đổi thành "Chưa thức tỉnh"; audit lại sạch mismatch', () => {
    const card = mkCard([mkEntry({
      comment: 'EJS chiến đấu',
      content: `@@preprocessing\n<%_ var phaHe = getvar('stat_data.Người Chơi.Phả Hệ', { defaults: '' });\n`
        + `if (phaHe !== '' && phaHe !== 'Chưa rõ') { } _%>`,
    })], SCHEMA);
    const r = repairQualityIssues(card, SCHEMA);
    expect(r.fixed.some(f => f.id === 'ejs-enum-mismatch')).toBe(true);
    const newContent = String(r.card.data.character_book!.entries[0].content);
    expect(newContent).toContain(`'Chưa thức tỉnh'`);
    expect(newContent).not.toContain(`'Chưa rõ'`);
    const after = auditCardQuality({ entries: r.card.data.character_book!.entries as never, schema: SCHEMA });
    expect(after.filter(i => i.code === 'ejs-enum-mismatch')).toEqual([]);
  });

  it('entry chết → bật lại + đặt keys từ tên, KHÔNG xoá nội dung', () => {
    const card = mkCard([mkEntry({ comment: 'Lễ Hội: Hội Băng Glacis', content: 'Mô tả lễ hội băng…', enabled: false, keys: [] })]);
    const r = repairQualityIssues(card, null);
    const e = r.card.data.character_book!.entries[0];
    expect(r.fixed.some(f => f.id === 'dead-entry')).toBe(true);
    expect(e.enabled).toBe(true);
    expect(e.keys).toContain('Hội Băng Glacis');
    expect(e.content).toBe('Mô tả lễ hội băng…');   // nội dung nguyên vẹn
  });

  it('default chuỗi của biến số → ép về số trong schema của card', () => {
    const schema = {
      version: '1.0',
      fields: [{ path: '/VP', type: 'number', label: 'VP', defaultValue: '100', constraints: {} }],
    } as unknown as MVUZODSchema;
    const r = repairQualityIssues(mkCard([], schema), schema);
    expect(r.fixed.some(f => f.id === 'number-default-string')).toBe(true);
    const ext = r.card.data.extensions as unknown as { mvuzod: { schema: MVUZODSchema } };
    expect(ext.mvuzod.schema.fields[0].defaultValue).toBe(100);
  });

  it('order trùng → giãn ra, mỗi entry một số; số entry KHÔNG đổi', () => {
    const card = mkCard([
      mkEntry({ id: 1, comment: 'A', insertion_order: 200, extensions: { position: 4 } as never }),
      mkEntry({ id: 2, comment: 'B', insertion_order: 200, extensions: { position: 4 } as never }),
      mkEntry({ id: 3, comment: 'C', insertion_order: 200, extensions: { position: 4 } as never }),
    ]);
    const r = repairQualityIssues(card, null);
    const orders = r.card.data.character_book!.entries.map(e => e.insertion_order);
    expect(new Set(orders).size).toBe(3);
    expect(r.card.data.character_book!.entries).toHaveLength(3);
  });
});

/* ═══ (bug 148) Ba lớp lỗi đo được trên card v3 thật của user ═══ */

describe('(bug 148) getvar thiếu tiền tố stat_data — lỗi im lặng', () => {
  it('biến CÓ THẬT trong schema mà quên tiền tố → lỗi, gợi ý đúng đường dẫn', () => {
    const issues = auditCardQuality({
      schema: SCHEMA,
      entries: [mkEntry({
        comment: '[EJS] Inject Bối Cảnh',
        content: `@@preprocessing\n<%_ var vp = getvar('Người Chơi.VP', { defaults: 100 }); _%>`,
      })],
    });
    const miss = issues.filter(i => i.code === 'ejs-missing-statdata');
    expect(miss).toHaveLength(1);
    expect(miss[0].level).toBe('error');
    expect(miss[0].message).toContain('stat_data.Người Chơi.VP');
    expect(miss[0].autofixable).toBe(true);
  });

  it('viết ĐÚNG tiền tố → không báo; biến KHÔNG thuộc schema (biến chat) cũng không báo oan', () => {
    const ok = auditCardQuality({
      schema: SCHEMA,
      entries: [mkEntry({ comment: 'A', content: `@@preprocessing\n<%_ var vp = getvar('stat_data.Người Chơi.VP'); _%>` })],
    });
    expect(ok.filter(i => i.code === 'ejs-missing-statdata')).toEqual([]);

    const chatVar = auditCardQuality({
      schema: SCHEMA,
      entries: [mkEntry({ comment: 'B', content: `@@preprocessing\n<%_ var x = getvar('my_chat_flag'); _%>` })],
    });
    expect(chatVar.filter(i => i.code === 'ejs-missing-statdata')).toEqual([]);
  });

  it('vá tự động: thêm tiền tố vào đúng lời gọi, audit lại sạch', () => {
    const card = {
      spec: 'chara_card_v3', spec_version: '3.0',
      data: {
        name: 'T',
        character_book: { name: 'wb', entries: [mkEntry({
          comment: 'EJS', content: `@@preprocessing\n<%_ var vp = getvar('Người Chơi.VP', { defaults: 100 }); _%>`,
        })] },
        extensions: { mvuzod: { schema: SCHEMA } },
      },
    } as unknown as CharacterCardV3;
    const r = repairQualityIssues(card, SCHEMA);
    expect(r.fixed.some(f => f.id === 'ejs-missing-statdata')).toBe(true);
    const content = String(r.card.data.character_book!.entries[0].content);
    expect(content).toContain(`getvar('stat_data.Người Chơi.VP'`);
    expect(auditCardQuality({ entries: r.card.data.character_book!.entries as never, schema: SCHEMA })
      .filter(i => i.code === 'ejs-missing-statdata')).toEqual([]);
  });
});

describe('(bug 148) tên biến JS có dấu tiếng Việt', () => {
  it('báo cảnh báo và vá được sang ASCII, đổi đồng bộ mọi chỗ dùng', () => {
    const content = `@@preprocessing\n<%_ var _nhân_vật_vp = 5;\nif (_nhân_vật_vp > 3) { } _%>`;
    const issues = auditCardQuality({ entries: [mkEntry({ comment: 'EJS', content })] });
    expect(issues.filter(i => i.code === 'ejs-nonascii-var')).toHaveLength(1);

    const card = {
      spec: 'chara_card_v3', spec_version: '3.0',
      data: { name: 'T', character_book: { name: 'wb', entries: [mkEntry({ comment: 'EJS', content })] }, extensions: {} },
    } as unknown as CharacterCardV3;
    const r = repairQualityIssues(card, null);
    const out = String(r.card.data.character_book!.entries[0].content);
    expect(out).not.toContain('_nhân_vật_vp');
    expect(out).toContain('_nhan_vat_vp');
    expect((out.match(/_nhan_vat_vp/g) ?? []).length).toBe(2);   // cả khai báo lẫn chỗ dùng
  });
});

describe('(bug 148) trùng nội dung entry + trùng từ khoá', () => {
  const VP_A = 'Veil Point (VP) là năng lượng để dùng năng lực Shard. Dùng quá nhiều VP dẫn tới Shard Collapse, nhân vật kiệt sức và mất kiểm soát năng lực trong nhiều giờ liền.';
  const VP_B = 'VP tức Veil Point chính là nguồn năng lượng cho năng lực Shard. Tiêu hao VP quá mức sẽ gây Shard Collapse khiến nhân vật kiệt sức, mất kiểm soát năng lực suốt nhiều giờ.';

  it('nội dung gần nhau VÀ chung từ khoá → cảnh báo gộp (ca entry 8/15 card thật)', () => {
    const issues = auditCardQuality({
      entries: [
        mkEntry({ id: 1, comment: 'Cơ chế VP', content: VP_A, keys: ['VP', 'Veil Point'] }),
        mkEntry({ id: 2, comment: 'Shard Collapse', content: VP_B, keys: ['VP', 'Shard Collapse'] }),
      ],
    });
    const dup = issues.filter(i => i.code === 'duplicate-entry-content');
    expect(dup).toHaveLength(1);
    expect(dup[0].message).toContain('vp');
    expect(dup[0].autofixable, 'gộp lore phải do người quyết, máy không tự xoá').toBe(false);
  });

  it('nội dung giống nhưng KHÔNG chung từ khoá → không báo (không bật cùng lúc, không tốn token)', () => {
    const issues = auditCardQuality({
      entries: [
        mkEntry({ id: 1, comment: 'A', content: VP_A, keys: ['alpha'] }),
        mkEntry({ id: 2, comment: 'B', content: VP_B, keys: ['beta'] }),
      ],
    });
    expect(issues.filter(i => i.code === 'duplicate-entry-content')).toEqual([]);
  });

  it('hai entry khác hẳn nội dung dù chung từ khoá → không báo', () => {
    const issues = auditCardQuality({
      entries: [
        mkEntry({ id: 1, comment: 'Địa lý', content: 'Thành Vọng Nguyệt nằm bên bờ sông Lam, nổi tiếng với chợ đêm và những lò rèn cổ truyền lâu đời nhất vùng.', keys: ['thành'] }),
        mkEntry({ id: 2, comment: 'Ẩm thực', content: 'Món bánh cuốn Vọng Nguyệt làm từ gạo nếp nương, ăn kèm nước chấm pha từ mắm cá suối và ớt rừng thơm nồng.', keys: ['thành'] }),
      ],
    });
    expect(issues.filter(i => i.code === 'duplicate-entry-content')).toEqual([]);
  });
});

/* ─── Đối chiếu trên CARD THẬT của user (bug/135) — file nằm ngoài git ─── */
const BUG_DIR = path.resolve(process.cwd(), '..', 'bug', '135');
const hasCards = fs.existsSync(path.join(BUG_DIR, 'Card 1.json'));

describe.skipIf(!hasCards)('(bug 135) chạy trên 2 card thật user gửi', () => {
  const load = (f: string) => {
    const raw = JSON.parse(fs.readFileSync(path.join(BUG_DIR, f), 'utf-8'));
    const data = raw.data ?? raw;
    return {
      entries: (data.character_book?.entries ?? []) as LorebookEntry[],
      schema: (data.extensions?.mvuzod?.schema ?? null) as MVUZODSchema | null,
    };
  };

  it('Card 1: bắt đúng bug EJS so "Chưa rõ" mà Claude Web nêu', () => {
    const issues = auditCardQuality(load('Card 1.json'));
    const mismatch = issues.filter(i => i.code === 'ejs-enum-mismatch');
    expect(mismatch.length).toBeGreaterThan(0);
    expect(mismatch.some(i => i.message.includes('Chưa rõ'))).toBe(true);
  });

  it('Card 2: bắt đúng 3 entry Lễ Hội chết + entry bảng biến chứa ví dụ', () => {
    const issues = auditCardQuality(load('Card 2.json'));
    const dead = issues.filter(i => i.code === 'dead-entry');
    expect(dead.length).toBeGreaterThanOrEqual(3);
    expect(dead.some(i => /Lễ Hội/i.test(i.where ?? ''))).toBe(true);
  });

  // (bug 148) Card v3 — bản "hoàn thiện" dùng Preset Nhanh áp dụng tất cả.
  const V3 = path.resolve(process.cwd(), '..', 'bug', '148', 'Hệ_Thống_Quản_Trò_Eldran_v3.json');
  const hasV3 = fs.existsSync(V3);

  it.skipIf(!hasV3)('card v3: bắt đúng 6 lời gọi getvar thiếu stat_data ở entry Inject Bối Cảnh', () => {
    const raw = JSON.parse(fs.readFileSync(V3, 'utf-8'));
    const data = raw.data ?? raw;
    const issues = auditCardQuality({
      entries: (data.character_book?.entries ?? []) as LorebookEntry[],
      schema: (data.extensions?.mvuzod?.schema ?? null) as MVUZODSchema | null,
    });
    const miss = issues.filter(i => i.code === 'ejs-missing-statdata');
    expect(miss.length).toBeGreaterThanOrEqual(6);
    expect(miss.every(i => /Bối Cảnh/i.test(i.where ?? ''))).toBe(true);
    expect(miss.some(i => i.message.includes('stat_data.Thế Giới.Ngày'))).toBe(true);
    // Hai entry EJS còn lại viết ĐÚNG — không được báo oan.
    expect(miss.some(i => /Cảnh Báo Sinh Tồn|Bộ điều khiển/i.test(i.where ?? ''))).toBe(false);
  });

  it.skipIf(!hasV3)('card v3: bắt tên biến có dấu ở entry Cảnh Báo Sinh Tồn', () => {
    const raw = JSON.parse(fs.readFileSync(V3, 'utf-8'));
    const data = raw.data ?? raw;
    const issues = auditCardQuality({
      entries: (data.character_book?.entries ?? []) as LorebookEntry[],
      schema: (data.extensions?.mvuzod?.schema ?? null) as MVUZODSchema | null,
    });
    const nonAscii = issues.filter(i => i.code === 'ejs-nonascii-var');
    expect(nonAscii.length).toBeGreaterThan(0);
    expect(nonAscii.some(i => i.message.includes('_nhân_vật_vp_hiện_tại'))).toBe(true);
  });

  it.skipIf(!hasV3)('card v3: VÁ xong thì các lỗi tự động biến mất, số entry KHÔNG đổi', () => {
    const raw = JSON.parse(fs.readFileSync(V3, 'utf-8'));
    const card = (raw.data ? raw : { data: raw }) as CharacterCardV3;
    const schema = (card.data.extensions as never as { mvuzod?: { schema?: MVUZODSchema } })?.mvuzod?.schema ?? null;
    const before = card.data.character_book!.entries.length;
    const r = repairQualityIssues(card, schema);
    const after = auditCardQuality({ entries: r.card.data.character_book!.entries as never, schema });
    expect(after.filter(i => i.code === 'ejs-missing-statdata')).toEqual([]);
    expect(after.filter(i => i.code === 'ejs-nonascii-var')).toEqual([]);
    expect(r.card.data.character_book!.entries).toHaveLength(before);   // không xoá lore
  });

  it('không báo bừa: mọi lỗi đều trỏ vào entry/biến CÓ THẬT trong card', () => {
    for (const f of ['Card 1.json', 'Card 2.json']) {
      const { entries, schema } = load(f);
      const names = new Set(entries.map(e => String(e.comment || `#${e.id}`)));
      const varPaths = new Set(collectLeafFields(schema).map(x => String(x.path ?? '')));
      for (const i of auditCardQuality({ entries, schema })) {
        if (!i.where) continue;
        expect(names.has(i.where) || varPaths.has(i.where), `${f}: "${i.where}" không có thật`).toBe(true);
      }
    }
  });
});
