/**
 * (bug 192 · tích hợp vào Tạo Card) Suy cấu hình giao diện từ schema, rồi ghép payload.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai lớp lỗi ở đây đều hỏng ÂM THẦM trong quán rượu — giao diện vẫn hiện, chỉ là sai:
 *   • đường dẫn sai một chữ hoa ⇒ lệnh cập nhật biến của AI trượt êm, mất dữ liệu;
 *   • payload dính ký tự bị SillyTavern nuốt ⇒ vỡ cú pháp JS, trắng màn hình.
 * Nên phải kiểm bằng máy chứ không thể "mở ra nhìn thấy ổn".
 */
import { describe, it, expect } from 'vitest';
import type { MVUZODSchema, InitVarConfig } from '../../../types/mvuzod.types';
import type { FrontendKitOptions } from '../types';
import {
  flattenScalarFields, topLevelFields, buildPanels, buildPathTable, buildFormFields,
  buildHeaderSpec, buildDefaultStat, buildStfeConfig, serializeConfig,
  detectUpdateTag, suggestFormPaths, suggestBars, suggestNamePath, suggestScenarioPath,
  THEME_PRESETS,
} from '../schemaToConfig';
import {
  buildFrontend, mergeFrontendScripts, validateOptions, findBootTagClashes, SCRIPT_NAME_MAIN,
} from '../buildPayload';
// @ts-expect-error — module JS thuần dùng chung với bộ dựng dòng lệnh
import { scanPayload, simulateStDelivery } from '../payloadRules.js';

/** Schema rút gọn nhưng giữ đủ mọi hình dạng gây khó: object lồng, enum, mảng, cặp cur/max. */
const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: '/Thế Giới', type: 'object', label: 'Thế Giới', constraints: {}, defaultValue: {},
      children: [
        { path: '/Thế Giới/Ngày', type: 'number', label: 'Ngày', constraints: {}, defaultValue: 1 },
        { path: '/Thế Giới/Khu Vực', type: 'string', label: 'Khu Vực', constraints: {}, defaultValue: 'Làng đầu' },
        { path: '/Thế Giới/Bối Cảnh', type: 'string', label: 'Bối Cảnh', constraints: {}, defaultValue: '' },
      ],
    },
    {
      path: '/Nhân Vật', type: 'object', label: 'Nhân Vật', constraints: {}, defaultValue: {},
      children: [
        { path: '/Nhân Vật/Tên', type: 'string', label: 'Tên', constraints: {}, defaultValue: 'Vô Danh' },
        {
          path: '/Nhân Vật/Phả Hệ', type: 'string', label: 'Phả Hệ', defaultValue: 'Ignis',
          constraints: { enumValues: ['Ignis', 'Glacis', 'Umbra'] },
        },
        {
          path: '/Nhân Vật/VP', type: 'object', label: 'VP', constraints: {}, defaultValue: {},
          children: [
            { path: '/Nhân Vật/VP/Hiện Tại', type: 'number', label: 'Hiện Tại', constraints: {}, defaultValue: 100 },
            { path: '/Nhân Vật/VP/Tối Đa', type: 'number', label: 'Tối Đa', constraints: {}, defaultValue: 100 },
          ],
        },
      ],
    },
    {
      path: '/Kho Đồ', type: 'array', label: 'Kho Đồ', constraints: {}, defaultValue: [],
      children: [
        { path: '/Kho Đồ/Tên', type: 'string', label: 'Tên', constraints: {}, defaultValue: '' },
        { path: '/Kho Đồ/Số Lượng', type: 'number', label: 'Số Lượng', constraints: {}, defaultValue: 1 },
        { path: '/Kho Đồ/Mô Tả', type: 'string', label: 'Mô Tả', constraints: {}, defaultValue: '' },
        { path: '/Kho Đồ/Container', type: 'string', label: 'Container', constraints: {}, defaultValue: 'Balo' },
      ],
    },
  ],
} as unknown as MVUZODSchema;

const INITVAR: InitVarConfig = {
  entries: [{
    id: 'a', label: 'Mặc định', isDefault: true,
    data: {
      'Thế Giới': { 'Ngày': 1, 'Khu Vực': 'Làng đầu', 'Bối Cảnh': '' },
      'Nhân Vật': { 'Tên': 'Vô Danh', 'Phả Hệ': 'Ignis', 'VP': { 'Hiện Tại': 100, 'Tối Đa': 100 } },
      'Kho Đồ': [],
    },
  }],
  activeEntryId: 'a',
  initvarMode: 'worldbook',
};

const OPTS = (over: Partial<FrontendKitOptions> = {}): FrontendKitOptions => ({
  title: 'Thẻ Thử',
  subtitle: '',
  bootTag: 'GameBoot',
  updateTag: 'UpdateVariable',
  themeId: THEME_PRESETS[0].id,
  historyTurns: 14,
  formPaths: ['Nhân Vật.Tên', 'Nhân Vật.Phả Hệ'],
  chipPaths: ['Thế Giới.Khu Vực'],
  bars: [{ label: 'VP', cur: 'Nhân Vật.VP.Hiện Tại', max: 'Nhân Vật.VP.Tối Đa' }],
  namePath: 'Nhân Vật.Tên',
  scenarios: [{ id: 's1', title: 'Mở màn', desc: 'mô tả', seed: 'câu mồi' }],
  quickActions: ['Nhìn quanh.'],
  openingExtra: '',
  derive: [],
  scenarioPath: 'Thế Giới.Bối Cảnh',
  ...over,
});

describe('(bug 192) đi trong schema', () => {
  it('chỉ lấy trường LÁ vô hướng, bỏ qua bên trong mảng', () => {
    const dots = flattenScalarFields(SCHEMA).map(f => f.dotPath);
    expect(dots).toContain('Nhân Vật.VP.Hiện Tại');
    expect(dots).toContain('Thế Giới.Khu Vực');
    expect(dots.some(d => d.startsWith('Kho Đồ'))).toBe(false);
  });

  it('giữ nguyên chữ hoa và dấu tiếng Việt — sai một chữ là lệnh của AI trượt êm', () => {
    const f = flattenScalarFields(SCHEMA).find(x => x.label === 'Khu Vực');
    expect(f?.dotPath).toBe('Thế Giới.Khu Vực');
    expect(f?.pointer).toBe('/Thế Giới/Khu Vực');
  });

  it('nhóm cấp cao nhất đúng số lượng và thứ tự', () => {
    expect(topLevelFields(SCHEMA).map(f => f.label)).toEqual(['Thế Giới', 'Nhân Vật', 'Kho Đồ']);
  });
});

describe('(bug 192) sinh tab từ schema', () => {
  const panels = buildPanels(SCHEMA);

  it('luôn có tab nhật ký đứng đầu', () => {
    expect(panels[0].type).toBe('chat');
  });

  it('object thành tab bảng, mảng thành tab danh sách', () => {
    const types = panels.slice(1).map(p => p.type);
    expect(types).toEqual(['fields', 'fields', 'list']);
  });

  it('tab danh sách tự đoán đúng cột tên / số lượng / mô tả', () => {
    const list = panels.find(p => p.type === 'list')!;
    expect(list.path).toBe('Kho Đồ');
    expect(list.name).toBe('Tên');
    expect(list.tag).toBe('Số Lượng');
    expect(list.desc).toBe('Mô Tả');
  });

  it('mọi trường vô hướng đều xuất hiện ở đâu đó — không bỏ sót biến nào', () => {
    const shown = new Set(panels.flatMap(p => (p.fields || []).map(f => f.p)));
    for (const f of flattenScalarFields(SCHEMA)) expect(shown.has(f.dotPath), f.dotPath).toBe(true);
  });
});

describe('(bug 192) bảng đường dẫn hợp lệ gửi kèm mỗi lượt', () => {
  // Đo được khi chạy thật: không có bảng này thì mô hình bịa ra `/Thời gian`, MVU lặng lẽ
  // bỏ qua, và người chơi chỉ thấy chỉ số không nhúc nhích.
  const table = buildPathTable(SCHEMA).join('\n');

  it('liệt kê đường dẫn thật của trường vô hướng', () => {
    expect(table).toContain('/Nhân Vật/VP/Hiện Tại');
    expect(table).toContain('/Thế Giới/Khu Vực');
  });

  it('mảng được chỉ rõ cách thêm mới và các trường bắt buộc', () => {
    expect(table).toContain('/Kho Đồ/-');
    expect(table).toContain('Số Lượng');
  });

  it('nói rõ không có đường dẫn nào khác', () => {
    expect(table).toMatch(/không có đường dẫn nào khác/i);
  });
});

describe('(bug 192) biểu mẫu khởi tạo', () => {
  it('enum thành ô chọn kèm đủ lựa chọn, số thành ô số', () => {
    const form = buildFormFields(SCHEMA, ['Nhân Vật.Phả Hệ', 'Thế Giới.Ngày']);
    expect(form[0].type).toBe('select');
    expect(form[0].options).toEqual(['Ignis', 'Glacis', 'Umbra']);
    expect(form[1].type).toBe('number');
  });

  it('đường dẫn không có trong schema thì bỏ qua, không đẻ trường ma', () => {
    expect(buildFormFields(SCHEMA, ['Không.Có.Thật'])).toEqual([]);
  });
});

describe('(bug 192) bộ biến mặc định', () => {
  it('ưu tiên InitVar đang chọn — đó mới là nguồn sự thật của thẻ', () => {
    const stat = buildDefaultStat(SCHEMA, INITVAR);
    expect(stat).toEqual(INITVAR.entries[0].data);
  });

  it('chưa dựng InitVar thì dựng tạm từ schema, và MẢNG PHẢI TỒN TẠI', () => {
    // Thiếu mảng thì lệnh insert của AI ở lượt mở màn trượt êm, mất sạch vật phẩm khởi đầu.
    const stat = buildDefaultStat(SCHEMA, null) as Record<string, unknown>;
    expect(Array.isArray(stat['Kho Đồ'])).toBe(true);
    expect((stat['Nhân Vật'] as Record<string, Record<string, number>>)['VP']['Tối Đa']).toBe(100);
  });
});

describe('(bug 192) thanh đầu', () => {
  it('chip dùng mẫu một cặp ngoặc nhọn, không phải hai (hai là bị substituteParams ăn)', () => {
    const spec = buildHeaderSpec(SCHEMA, { namePath: 'Nhân Vật.Tên', chipPaths: ['Thế Giới.Khu Vực'], bars: [] });
    expect(spec.chips[0].tpl).toBe('{Thế Giới.Khu Vực}');
    expect(spec.chips[0].tpl).not.toContain('{{');
  });

  it('thanh chỉ số chỉ nhận cặp có thật trong schema', () => {
    const spec = buildHeaderSpec(SCHEMA, {
      namePath: '', chipPaths: [],
      bars: [{ label: 'VP', cur: 'Nhân Vật.VP.Hiện Tại', max: 'Nhân Vật.VP.Tối Đa' },
        { label: 'Ma', cur: 'Không.Có', max: 'Không.Có2' }],
    });
    expect(spec.bars).toHaveLength(1);
  });
});

describe('(bug 192) gợi ý mặc định', () => {
  it('dò đúng thẻ cập nhật biến của thẻ bài, bỏ qua thẻ HTML thường', () => {
    expect(detectUpdateTag(['xin chào <p>đoạn</p> <UpdateVariable>…</UpdateVariable>'])).toBe('UpdateVariable');
    expect(detectUpdateTag(['<StatusUpdate>a</StatusUpdate> <StatusUpdate>b</StatusUpdate>'])).toBe('StatusUpdate');
    expect(detectUpdateTag([''])).toBe('UpdateVariable');
  });

  it('gợi ý trường tên lên đầu biểu mẫu, không gợi ý chỉ số động', () => {
    const s = suggestFormPaths(SCHEMA);
    expect(s[0]).toBe('Nhân Vật.Tên');
    expect(s).not.toContain('Nhân Vật.VP.Hiện Tại');
  });

  it('nhận ra cặp hiện tại/tối đa làm thanh chỉ số', () => {
    expect(suggestBars(SCHEMA)).toEqual([{ label: 'VP', cur: 'Nhân Vật.VP.Hiện Tại', max: 'Nhân Vật.VP.Tối Đa' }]);
  });

  it('nhận ra trường tên và trường bối cảnh', () => {
    expect(suggestNamePath(SCHEMA)).toBe('Nhân Vật.Tên');
    expect(suggestScenarioPath(SCHEMA)).toBe('Thế Giới.Bối Cảnh');
  });
});

describe('(bug 192) cấu hình sinh ra chỉ chứa DỮ LIỆU', () => {
  const cfg = buildStfeConfig(SCHEMA, INITVAR, OPTS());

  it('tuần tự hoá được và đọc ngược lại y nguyên — không có hàm nào lọt vào', () => {
    const src = serializeConfig(cfg);
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(cfg)));
  });

  it('mã config không dính ký tự bị SillyTavern nuốt', () => {
    expect(scanPayload(serializeConfig(cfg), 'config')).toEqual([]);
  });
});

describe('(bug 192) ghép payload trong app', () => {
  const r = buildFrontend(SCHEMA, INITVAR, OPTS());

  it('không vi phạm luật payload nào', () => {
    expect(r.violations).toEqual([]);
  });

  it('hai script CHỈ tác động lên hiển thị — HTML không đi ngược vào prompt', () => {
    expect(r.scripts).toHaveLength(2);
    for (const s of r.scripts) {
      expect(s.markdownOnly, s.scriptName).toBe(true);
      expect(s.promptOnly, s.scriptName).toBe(false);
      expect(s.placement).toEqual([2]);
    }
  });

  it('mồi của màn chính bám ĐÚNG thẻ cập nhật biến do người dùng chọn', () => {
    const main = r.scripts.find(s => s.scriptName === SCRIPT_NAME_MAIN)!;
    expect(main.findRegex).toBe('^[\\s\\S]*<\\/UpdateVariable>[\\s\\S]*$');
    const r2 = buildFrontend(SCHEMA, INITVAR, OPTS({ updateTag: 'StatusUpdate' }));
    expect(r2.scripts.find(s => s.scriptName === SCRIPT_NAME_MAIN)!.findRegex)
      .toBe('^[\\s\\S]*<\\/StatusUpdate>[\\s\\S]*$');
  });

  // (bug 206) Đây là chính cái bệnh người chơi thấy: bấm Bắt đầu hành trình xong, lời kể của
  // AI và khối JSON cập nhật biến vẫn nằm chình ình phía trên khung giao diện.
  it('mồi nuốt TRỌN tin nhắn — lời kể và khối cập nhật biến không lọt ra ngoài giao diện', () => {
    const msg = [
      'Gió biển tạt vào mặt Tân Thuận khi con thuyền cập bến.',
      '<UpdateVariable>',
      '_.set("nhan_vat.the_luc", 12);',
      '</UpdateVariable>',
      'Phía xa, ngọn hải đăng bắt đầu sáng.',
    ].join('\n');

    for (const s of r.scripts) {
      const re = new RegExp(s.findRegex);
      if (!re.test(msg)) continue;
      const out = msg.replace(re, s.replaceString);
      expect(out).not.toContain('Gió biển tạt vào mặt');
      expect(out).not.toContain('ngọn hải đăng');
      expect(out).not.toContain('nhan_vat.the_luc');
    }
    // Ít nhất một trong hai màn phải khớp, không thì bài kiểm trên rỗng mà vẫn xanh.
    expect(r.scripts.some(s => new RegExp(s.findRegex).test(msg))).toBe(true);
  });

  // Neo `^` là thứ giữ cho regex chạy tuyến tính; mất nó là treo cứng trên payload 60k ký tự.
  it('mồi khớp trong tích tắc kể cả khi tin nhắn dài bằng cả một payload giao diện', () => {
    const huge = 'x'.repeat(60_000) + '\nkhông có thẻ mồi nào ở đây\n' + 'y'.repeat(60_000);
    const t0 = Date.now();
    for (const s of r.scripts) expect(new RegExp(s.findRegex).test(huge)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('first_mes đúng thẻ mở màn', () => {
    expect(r.firstMes).toBe('<GameBoot/>');
  });

  it('trợ thủ Tavern nhận ra đây là giao diện', () => {
    for (const html of [r.openingHtml, r.mainHtml]) {
      expect(['html>', '<head>', '<body'].some(t => html.includes(t))).toBe(true);
    }
  });

  it('payload sống nguyên vẹn qua đường giao hàng của SillyTavern, và biên dịch được', () => {
    const scriptOf = (h: string) => (h.match(/<script>([\s\S]*?)<\/script>/) || ['', ''])[1];
    for (const html of [r.openingHtml, r.mainHtml]) {
      const delivered = simulateStDelivery('```\n' + html + '\n```');
      expect(scriptOf(delivered)).toBe(scriptOf(html));
      expect(() => new Function(scriptOf(delivered))).not.toThrow();
    }
  });

  it('thẻ mở màn trùng thẻ cập nhật biến → chặn ngay, không để lọt', () => {
    const bad = buildFrontend(SCHEMA, INITVAR, OPTS({ bootTag: 'UpdateVariable' }));
    expect(bad.violations.join('\n')).toMatch(/trùng nhau/);
  });

  it('thẻ rỗng hoặc có ký tự lạ đều bị chặn', () => {
    expect(validateOptions(OPTS({ bootTag: '' })).join('\n')).toMatch(/Thẻ mở màn/);
    expect(validateOptions(OPTS({ updateTag: 'a b' })).join('\n')).toMatch(/Thẻ cập nhật biến/);
    expect(validateOptions(OPTS({ title: '  ' })).join('\n')).toMatch(/tên hiển thị/i);
    expect(validateOptions(OPTS())).toEqual([]);
  });

  it('thẻ mở màn đã có sẵn trong nội dung thẻ bài → cảnh báo, vì màn khởi tạo sẽ bung nhầm chỗ', () => {
    expect(findBootTagClashes('GameBoot', ['một đoạn có <GameBoot/> ở đây'])).toHaveLength(1);
    expect(findBootTagClashes('GameBoot', ['đoạn sạch'])).toEqual([]);
  });
});

describe('(bug 192) gắn vào thẻ: thứ tự script là sống còn', () => {
  const fresh = buildFrontend(SCHEMA, INITVAR, OPTS()).scripts;
  const existing = [
    { scriptName: '[AI] Loại bỏ khối UpdateVariable', findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm' },
    { scriptName: '[FE] Màn Chính', findRegex: 'cũ' },
  ] as unknown as Parameters<typeof mergeFrontendScripts>[0];

  it('script [FE] đứng ĐẦU — script xoá khối biến chạy trước là mất luôn giao diện', () => {
    const merged = mergeFrontendScripts(existing, fresh);
    expect(merged[0].scriptName).toMatch(/^\[FE\]/);
    expect(merged[1].scriptName).toMatch(/^\[FE\]/);
    expect(merged[2].scriptName).toBe('[AI] Loại bỏ khối UpdateVariable');
  });

  it('dựng lại lần hai không nhân đôi script — thay bản cũ', () => {
    const merged = mergeFrontendScripts(existing, fresh);
    expect(merged.filter(s => /^\[FE\]/.test(s.scriptName))).toHaveLength(2);
  });
});
