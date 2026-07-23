import { describe, it, expect } from 'vitest';
import {
  extractFormatTags,
  extractRegexTags,
  unwrapRegexBody,
  alignTags,
  buildTextTagMap,
  collectAnchoredTags,
  replaceTagInRegex,
  findFormatTagMismatches,
  enforceFormatTagSync,
  buildFormatTagPromptBlock,
  type FieldPair,
} from '../formatTagSync';

/**
 * (User 23/07 — việc 83) Thẻ bắt AI xuất ra khuôn cố định `<hồ sơ nhân vật>…</hồ sơ nhân vật>`,
 * regex bám mốc đó để làm đẹp. Mốc nằm ở HAI nơi (văn bản dạy AI + findRegex) do HAI lượt gọi AI
 * khác nhau dịch → ra hai chữ khác nhau → regex hết khớp, im lặng không chạy. Thẻ loại này
 * thường không phải MVU/EJS nên không có chiến lược nào canh giúp.
 */

const f = (o: Partial<FieldPair>): FieldPair => ({
  path: 'p', label: 'L', group: 'core', status: 'done', original: '', translated: '', ...o,
});

/** Thẻ mẫu: văn bản dạy xuất `<角色档案>`, regex bám đúng mốc đó. */
const cardFields = (textTrans: string, regexTrans: string): FieldPair[] => [
  f({
    path: 'data.description', group: 'core',
    original: 'Mỗi lượt PHẢI xuất ra:\n<角色档案>\n(yaml)\n</角色档案>',
    translated: textTrans,
  }),
  f({
    path: 'data.extensions.regex_scripts[0].findRegex', label: 'regex[0].findRegex', group: 'regex',
    original: '/<角色档案>([\\s\\S]*?)<\\/角色档案>/g',
    translated: regexTrans,
  }),
];

describe('extractFormatTags — bóc mốc, bỏ nhiễu cú pháp regex', () => {
  it('bóc mốc <…> kể cả thẻ đóng và thẻ tự đóng', () => {
    const t = extractFormatTags('<hồ sơ nhân vật>x</hồ sơ nhân vật><StatusPlaceHolderImpl/>');
    expect(t.map(x => x.name)).toEqual(['hồ sơ nhân vật', 'StatusPlaceHolderImpl']);
  });

  it('bóc mốc 【…】và […]', () => {
    expect(extractFormatTags('【trạng thái】và [khởi tạo]').map(x => x.name))
      .toEqual(expect.arrayContaining(['trạng thái', 'khởi tạo']));
  });

  it('LOẠI cú pháp regex — đây là chỗ probe ban đầu báo oan hàng loạt', () => {
    const names = extractFormatTags('[\\s\\S]*?  \\1  (a|b)  [^\\n]+').map(x => x.name);
    expect(names).toEqual([]);
  });

  it('loại số thuần và chuỗi quá ngắn/quá dài', () => {
    expect(extractFormatTags('[12] <a>').map(x => x.name)).toEqual([]);
  });

  it('giữ THỨ TỰ xuất hiện lần đầu, không trùng lặp', () => {
    const t = extractFormatTags('<beta><alpha><beta>');
    expect(t.map(x => x.name)).toEqual(['beta', 'alpha']);
  });

  it('tên 1 ký tự bị loại — gần như luôn là nhiễu regex chứ không phải mốc thật', () => {
    expect(extractFormatTags('<a><b>[c]').map(x => x.name)).toEqual([]);
  });
});

describe('unwrapRegexBody / extractRegexTags', () => {
  it('bỏ vỏ /…/flags và dấu escape', () => {
    expect(unwrapRegexBody('/<a>\\[x\\]<\\/a>/gsi')).toBe('<a>[x]</a>');
  });

  it('regex không có vỏ vẫn đọc được', () => {
    expect(extractRegexTags('<sanmingyue>').map(t => t.name)).toEqual(['sanmingyue']);
  });

  it('bóc đúng mốc trong regex thật của thẻ mẫu', () => {
    expect(extractRegexTags('/<角色档案>([\\s\\S]*?)<\\/角色档案>/g').map(t => t.name)).toEqual(['角色档案']);
  });
});

describe('alignTags — dóng mốc gốc ↔ dịch trong cùng một field', () => {
  it('cùng số lượng, cùng hình dạng → ghép theo thứ tự', () => {
    const m = alignTags('<角色档案>x</角色档案>', '<hồ sơ nhân vật>x</hồ sơ nhân vật>');
    expect(m.get('angle::角色档案')).toBe('hồ sơ nhân vật');
  });

  it('mốc KHÔNG đổi → không ghi vào bảng (không sinh việc thừa)', () => {
    expect(alignTags('<UpdateVariable>x</UpdateVariable>', '<UpdateVariable>y</UpdateVariable>').size).toBe(0);
  });

  it('AI thêm/bớt mốc (lệch số lượng) → KHÔNG ghép bừa', () => {
    expect(alignTags('<a>', '<x><y>').size).toBe(0);
  });

  it('không trộn lẫn hình dạng khác nhau', () => {
    const m = alignTags('<hoso>[trangthai]', '<hồ sơ>[trạng thái]');
    expect(m.get('angle::hoso')).toBe('hồ sơ');
    expect(m.get('square::trangthai')).toBe('trạng thái');
  });
});

describe('collectAnchoredTags — chỉ mốc do CHÍNH thẻ dạy ra mới được xét', () => {
  it('mốc có trong văn bản gốc → được neo', () => {
    expect(collectAnchoredTags([f({ original: 'xuất ra <角色档案>' })]).has('angle::角色档案')).toBe(true);
  });

  it('mốc chỉ có trong regex, không có trong văn bản → KHÔNG neo (StatusPlaceHolderImpl…)', () => {
    const anchored = collectAnchoredTags([
      f({ path: 'r', group: 'regex', original: '<StatusPlaceHolderImpl/>' }),
    ]);
    expect(anchored.has('angle::StatusPlaceHolderImpl')).toBe(false);
  });
});

describe('findFormatTagMismatches — CHÍNH CA BUG', () => {
  it('văn bản dịch thành A, regex dịch thành B → báo lệch, chuẩn là A', () => {
    const m = findFormatTagMismatches(cardFields(
      'Mỗi lượt PHẢI xuất ra:\n<hồ sơ nhân vật>\n(yaml)\n</hồ sơ nhân vật>',
      '/<Hồ Sơ Nhân Vật>([\\s\\S]*?)<\\/Hồ Sơ Nhân Vật>/g',
    ));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ original: '角色档案', inRegex: 'Hồ Sơ Nhân Vật', inText: 'hồ sơ nhân vật' });
    expect(m[0].fixedFindRegex).toContain('hồ sơ nhân vật');
  });

  it('regex KHÔNG dịch mốc trong khi văn bản đã dịch → vẫn báo lệch', () => {
    const m = findFormatTagMismatches(cardFields(
      '<hồ sơ nhân vật>\n(yaml)\n</hồ sơ nhân vật>',
      '/<角色档案>([\\s\\S]*?)<\\/角色档案>/g',
    ));
    expect(m).toHaveLength(1);
    expect(m[0].inRegex).toBe('角色档案');
    expect(m[0].inText).toBe('hồ sơ nhân vật');
  });

  it('hai bên dịch GIỐNG nhau → không báo gì', () => {
    expect(findFormatTagMismatches(cardFields(
      '<hồ sơ nhân vật>\n(yaml)\n</hồ sơ nhân vật>',
      '/<hồ sơ nhân vật>([\\s\\S]*?)<\\/hồ sơ nhân vật>/g',
    ))).toHaveLength(0);
  });

  it('KHÔNG báo oan mốc không nằm trong thẻ (StatusPlaceHolderImpl / UpdateVariable)', () => {
    const m = findFormatTagMismatches([
      f({ path: 'd', group: 'core', original: 'Xuất <角色档案>', translated: 'Xuất <hồ sơ>' }),
      f({
        path: 'r.findRegex', group: 'regex',
        original: '<StatusPlaceHolderImpl/>', translated: '<StatusPlaceHolderImpl/>',
      }),
    ]);
    expect(m).toHaveLength(0);
  });

  it('mốc không đổi ở cả hai bên → không sinh việc', () => {
    expect(findFormatTagMismatches([
      f({ path: 'd', group: 'core', original: '<UpdateVariable>', translated: '<UpdateVariable>' }),
      f({ path: 'r.findRegex', group: 'regex', original: '/<UpdateVariable>/g', translated: '/<UpdateVariable>/g' }),
    ])).toHaveLength(0);
  });

  it('field chưa dịch xong → bỏ qua', () => {
    const fields = cardFields('<hồ sơ>', '/<khác>/g');
    fields[1].status = 'pending';
    expect(findFormatTagMismatches(fields)).toHaveLength(0);
  });

  it('mảng rỗng → không nổ', () => {
    expect(findFormatTagMismatches([])).toEqual([]);
  });
});

describe('buildTextTagMap — nhiều field bất đồng thì lấy bản phổ biến nhất', () => {
  it('2 field dịch "A", 1 field dịch "B" → chọn A', () => {
    const map = buildTextTagMap([
      f({ path: '1', original: '<档案>', translated: '<hồ sơ>' }),
      f({ path: '2', group: 'lorebook', original: '<档案>', translated: '<hồ sơ>' }),
      f({ path: '3', group: 'lorebook', original: '<档案>', translated: '<Hồ Sơ>' }),
    ]);
    expect(map.get('angle::档案')).toBe('hồ sơ');
  });

  it('field regex KHÔNG được tính là văn bản dạy AI', () => {
    const map = buildTextTagMap([
      f({ path: 'r', group: 'regex', original: '<档案>', translated: '<sai>' }),
    ]);
    expect(map.size).toBe(0);
  });
});

describe('replaceTagInRegex — giữ nguyên vỏ regex và escape', () => {
  it('đổi tên mốc, giữ cờ và dấu escape', () => {
    expect(replaceTagInRegex('/<角色档案>([\\s\\S]*?)<\\/角色档案>/gsi', '角色档案', 'hồ sơ'))
      .toBe('/<hồ sơ>([\\s\\S]*?)<\\/hồ sơ>/gsi');
  });

  it('from rỗng hoặc trùng to → giữ nguyên', () => {
    expect(replaceTagInRegex('/<a>/g', '', 'x')).toBe('/<a>/g');
    expect(replaceTagInRegex('/<a>/g', 'a', 'a')).toBe('/<a>/g');
  });
});

describe('enforceFormatTagSync', () => {
  it('trả về findRegex đã vá', () => {
    const r = enforceFormatTagSync(cardFields(
      '<hồ sơ nhân vật>\n</hồ sơ nhân vật>',
      '/<Hồ Sơ Nhân Vật>([\\s\\S]*?)<\\/Hồ Sơ Nhân Vật>/g',
    ));
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].findRegex).toBe('/<hồ sơ nhân vật>([\\s\\S]*?)<\\/hồ sơ nhân vật>/g');
  });

  it('một findRegex lệch NHIỀU mốc → dồn hết vào một chuỗi, không mất bản vá nào', () => {
    const fields: FieldPair[] = [
      f({ path: 'd', group: 'core', original: '<档案>x<状态>', translated: '<hồ sơ>x<trạng thái>' }),
      f({
        path: 'r.findRegex', group: 'regex',
        original: '/<档案>.*<状态>/g', translated: '/<HOSO>.*<TRANGTHAI>/g',
      }),
    ];
    const r = enforceFormatTagSync(fields);
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].findRegex).toBe('/<hồ sơ>.*<trạng thái>/g');
  });

  it('không lệch → không có bản vá nào', () => {
    expect(enforceFormatTagSync(cardFields('<a>', '/<a>/g')).fixes).toHaveLength(0);
  });
});

describe('buildFormatTagPromptBlock', () => {
  it('liệt kê mốc để AI dịch regex theo đúng chữ trong văn bản', () => {
    const s = buildFormatTagPromptBlock(new Map([['angle::角色档案', 'hồ sơ nhân vật']]));
    expect(s).toContain('角色档案');
    expect(s).toContain('hồ sơ nhân vật');
    expect(s).toMatch(/escape|cờ/);
  });

  it('không có mốc nào → chuỗi rỗng, không làm phình prompt', () => {
    expect(buildFormatTagPromptBlock(new Map())).toBe('');
  });
});
