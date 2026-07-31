// (bugNeedFix/98) "chỉ tạo từ đầu đến cuối mà không có các bước kiểm tra chéo".
// Bước mô phỏng phải bắt được đúng những thứ kiểm tĩnh lọt: initvar thiếu biến schema đòi,
// lệnh cập nhật trỏ vào biến không có thật, EJS/status bar đọc biến chẳng ai khai báo.
import { describe, it, expect } from 'vitest';
import { simulateCard, parseInitVar, parseInitVarYaml, extractReadPaths, schemaLeafPaths } from '../simulateCard';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: 'Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        { path: 'Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: {} },
        { path: 'Người Chơi/Cảnh Giới', type: 'string', label: 'Cảnh Giới', defaultValue: 'Luyện Khí', constraints: {} },
      ],
    },
    {
      path: 'Thế Giới', type: 'object', label: 'Thế Giới', defaultValue: {}, constraints: {},
      children: [
        { path: 'Thế Giới/Ngày', type: 'number', label: 'Ngày', defaultValue: 1, constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

const INIT_YAML = `[initvar]
Người Chơi:
  HP: 100
  Cảnh Giới: Luyện Khí
Thế Giới:
  Ngày: 1`;

describe('Đọc initvar — YAML cũng phải đọc được (bản cũ chỉ chịu JSON nên bỏ qua im lặng)', () => {
  it('YAML lồng 2 tầng, khoá tiếng Việt có dấu cách', () => {
    const o = parseInitVarYaml('Người Chơi:\n  HP: 100\n  Cảnh Giới: Luyện Khí');
    expect(o).toEqual({ 'Người Chơi': { HP: 100, 'Cảnh Giới': 'Luyện Khí' } });
  });

  it('bỏ nhãn [initvar], nhận cả JSON lẫn YAML', () => {
    expect(parseInitVar('[initvar]\n{"a":{"b":1}}')).toEqual({ a: { b: 1 } });
    expect(parseInitVar(INIT_YAML)).toHaveProperty('Thế Giới');
  });

  it('kiểu dữ liệu: số, bool, chuỗi có nháy, rỗng, {} , danh sách', () => {
    const o = parseInitVarYaml([
      'so: 42', 'am: -3.5', 'dung: true', 'sai: false',
      'trong: ~', 'obj: {}', 'chuoi: "a: b"',
      'ds:', '  - x', '  - y',
    ].join('\n'));
    expect(o).toEqual({
      so: 42, am: -3.5, dung: true, sai: false,
      trong: null, obj: {}, chuoi: 'a: b', ds: ['x', 'y'],
    });
  });

  it('bỏ qua dòng comment', () => {
    expect(parseInitVarYaml('# ghi chú\na: 1  # cuối dòng')).toEqual({ a: 1 });
  });
});

describe('Đối chiếu initvar ↔ schema', () => {
  it('khớp hoàn toàn → không lỗi', () => {
    const r = simulateCard({ initVarContent: INIT_YAML, schema: SCHEMA });
    expect(r.ok).toBe(true);
    expect(r.stats.initVars).toBe(3);
    expect(r.stats.schemaLeaves).toBe(3);
    expect(r.stats.formWritesOk).toBe(3);
  });

  it('schema đòi biến mà initvar không có → LỖI (status bar sẽ hiện rỗng)', () => {
    const thieu = '[initvar]\nNgười Chơi:\n  HP: 100';
    const r = simulateCard({ initVarContent: thieu, schema: SCHEMA });
    expect(r.ok).toBe(false);
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('sim-missing-in-initvar');
    expect(r.stats.missingInInit).toBe(2);
  });

  it('initvar có biến schema không khai → cảnh báo (Zod sẽ cắt mất)', () => {
    const thua = INIT_YAML + '\nNgười Chơi lạ:\n  XYZ: 1';
    const r = simulateCard({ initVarContent: thua, schema: SCHEMA });
    expect(r.issues.map(i => i.code)).toContain('sim-extra-in-initvar');
  });

  it('initvar rỗng → lỗi rõ ràng thay vì im lặng', () => {
    const r = simulateCard({ initVarContent: '[initvar]', schema: SCHEMA });
    expect(r.issues.map(i => i.code)).toContain('sim-initvar-empty');
  });

  it('nhánh record (túi khoá động) không bị đòi phải liệt kê sẵn', () => {
    const withRecord = {
      version: '1.0',
      fields: [
        ...SCHEMA.fields,
        { path: 'NPC', type: 'record', label: 'NPC', defaultValue: {}, constraints: {}, children: [] },
      ],
    } as unknown as MVUZODSchema;
    const r = simulateCard({ initVarContent: INIT_YAML, schema: withRecord });
    expect(r.issues.map(i => i.code)).not.toContain('sim-missing-in-initvar');
    expect(schemaLeafPaths(withRecord).map(l => l.path)).not.toContain('NPC');
  });
});

describe('Chạy thật lệnh <UpdateVariable>', () => {
  it('lệnh trỏ đúng biến → áp được', () => {
    const r = simulateCard({
      initVarContent: INIT_YAML, schema: SCHEMA,
      updateContents: ["<UpdateVariable>\n_.set('Người Chơi.HP', 100, 80);//trúng đòn\n</UpdateVariable>"],
    });
    expect(r.stats.updateOpsApplied).toBe(1);
    expect(r.issues.map(i => i.code)).not.toContain('sim-update-bad-path');
  });

  it('lệnh trỏ vào biến KHÔNG có trong initvar → báo đích danh', () => {
    const r = simulateCard({
      initVarContent: INIT_YAML, schema: SCHEMA,
      updateContents: ["<UpdateVariable>\n_.set('Người Chơi.Nội Lực', 0, 50);//sai\n</UpdateVariable>"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('sim-update-bad-path');
  });
});

describe('EJS / status bar đọc biến có thật không', () => {
  it('nhặt được đường dẫn từ getvar, stat_data.a.b và stat_data["a b"]', () => {
    const paths = extractReadPaths(`
      <%= getvar('Người Chơi.HP') %>
      const x = stat_data['Thế Giới']['Ngày'];
      const y = stat_data.Người_Chơi.HP;
    `);
    expect(paths).toContain('Người Chơi.HP');
    expect(paths).toContain('Thế Giới.Ngày');
  });

  // (bug 174) Hai ca dưới trước đây viết getvar KHÔNG có tiền tố `stat_data.`. Đó là dạng mà
  // chính bộ sinh EJS của tool KHÔNG BAO GIỜ xuất ra (bridge/mvuzodToEjs.ts luôn ghép
  // `stat_data.${dotPath}`) và trong SillyTavern nó luôn trả về rỗng — tức test cũ khoá nhầm
  // một cú pháp sai. Nay viết đúng dạng thật, còn dạng thiếu tiền tố có ca riêng bên dưới.
  it('đọc biến không tồn tại → lỗi chỉ rõ script nào', () => {
    const r = simulateCard({
      initVarContent: INIT_YAML, schema: SCHEMA,
      readerSources: [{ name: 'Thanh trạng thái', content: "<%= getvar('stat_data.Người Chơi.Linh Thạch') %>" }],
    });
    expect(r.ok).toBe(false);
    const iss = r.issues.find(i => i.code === 'sim-reader-missing-var')!;
    expect(iss.message).toContain('Thanh trạng thái');
    expect(r.stats.ejsRefsMissing).toBe(1);
  });

  it('đọc biến có thật → sạch', () => {
    const r = simulateCard({
      initVarContent: INIT_YAML, schema: SCHEMA,
      readerSources: [{ name: 'Thanh trạng thái', content: "<%= getvar('stat_data.Người Chơi.HP') %> ngày <%= getvar('stat_data.Thế Giới.Ngày') %>" }],
    });
    expect(r.ok).toBe(true);
    expect(r.stats.ejsRefsChecked).toBe(2);
    expect(r.stats.ejsRefsMissing).toBe(0);
  });

  it('(bug 174) quên tiền tố stat_data. → báo đích danh, kèm cách sửa', () => {
    const r = simulateCard({
      initVarContent: INIT_YAML, schema: SCHEMA,
      readerSources: [{ name: 'Thanh trạng thái', content: "<%= getvar('Người Chơi.HP') %>" }],
    });
    const iss = r.issues.find(i => i.code === 'sim-reader-missing-prefix')!;
    expect(iss, 'đọc luôn ra rỗng mà không có lỗi đỏ nào — đúng loại lỗi im lặng').toBeTruthy();
    expect(iss.message).toContain("getvar('stat_data.Người Chơi.HP')");
  });
});

// ─── (bugNeedFix/111) Dòng nhãn nằm trước cây biến trong [initvar] ────────────────────────
import { stripInitVarPreamble } from '../simulateCard';
import { validateMvuCard as validateCard111 } from '../validateMvuCard';

const CA_USER = `[InitVar] Vui lòng không mở
'Thế Giới':
  'Ngày': 1
  'Khung Giờ': 'Sáng'
'Người Chơi':
  'Thiên Phú': 0`;

describe('bug 111: nhãn văn xuôi ở đầu [initvar] nuốt mất biến lớn đầu tiên', () => {
  it('cắt được nhãn, nội dung bắt đầu thẳng bằng cây biến', () => {
    const r = stripInitVarPreamble(CA_USER.replace(/\[InitVar\]/gi, ''));
    expect(r.removed).toEqual(['Vui lòng không mở']);
    expect(r.content.split('\n')[0].trim()).toBe("'Thế Giới':");
    expect(r.content.trimStart().startsWith('[')).toBe(false);
  });

  it('mô phỏng vẫn đọc RA ĐỦ biến dù thẻ còn dòng nhãn (không báo thiếu biến oan)', () => {
    const r = simulateCard({ initVarContent: CA_USER });
    expect(Object.keys(r.statData)).toEqual(['Thế Giới', 'Người Chơi']);
    expect(r.stats.initVars).toBe(3);
  });

  it('mô phỏng BÁO LỖI đích danh + nói rõ hậu quả jsonrepair', () => {
    const r = simulateCard({ initVarContent: CA_USER });
    const iss = r.issues.find(i => i.code === 'sim-initvar-preamble')!;
    expect(iss).toBeTruthy();
    expect(iss.level).toBe('error');
    expect(iss.message).toContain('Vui lòng không mở');
  });

  it('bộ kiểm hợp nhất cũng bắt (mã initvar-preamble)', () => {
    const r = validateCard111({
      entries: [{ comment: '[initvar]初始化', content: CA_USER, enabled: false }] as never,
    });
    expect(r.errors.map(e => e.code)).toContain('initvar-preamble');
  });

  it('thẻ đã đúng chuẩn thì không báo gì', () => {
    const ok = "'Thế Giới':\n  'Ngày': 1";
    expect(simulateCard({ initVarContent: ok }).issues.map(i => i.code))
      .not.toContain('sim-initvar-preamble');
    expect(validateCard111({ entries: [{ comment: '[initvar]', content: ok, enabled: false }] as never }
    ).errors.map(e => e.code)).not.toContain('initvar-preamble');
  });
});
