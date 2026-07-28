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
