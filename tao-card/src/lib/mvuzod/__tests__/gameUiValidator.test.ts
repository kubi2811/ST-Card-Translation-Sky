import { describe, it, expect } from 'vitest';
import {
  validateRegexDraft, parseFindRegex, buildRenderableHtml, collectSchemaVarNames, collectInitVarNames, reportToXml,
  type DraftScript,
} from '../gameUiValidator';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

function mk(o: Partial<DraftScript>): DraftScript {
  return {
    scriptName: 'test', findRegex: '/<x>([\\s\\S]*?)<\\/x>/s', replaceString: '<div>$1</div>',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    ...o,
  } as DraftScript;
}
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe('parseFindRegex', () => {
  it('tách /pattern/flags', () => {
    const p = parseFindRegex('/<x>(.*?)<\\/x>/s');
    expect(p).not.toBeNull();
    expect(p!.flags).toBe('s');
  });
  it('regex vỡ → null', () => {
    expect(parseFindRegex('/[unclosed/')).toBeNull();
  });
  it('plain string coi như pattern literal', () => {
    expect(parseFindRegex('hello')).not.toBeNull();
  });
});

describe('validateRegexDraft — V1 cú pháp', () => {
  it('regex vỡ → REGEX_SYNTAX error, ok=false', () => {
    const r = validateRegexDraft([mk({ findRegex: '/[bad/' })], '<x>a</x>');
    expect(codes(r)).toContain('REGEX_SYNTAX');
    expect(r.ok).toBe(false);
  });
  it('JS trong replaceString vỡ → SCRIPT_SYNTAX', () => {
    const r = validateRegexDraft([mk({ replaceString: "<div>$1</div><script>var a = 'x' 'y';</script>" })], '<x>a</x>');
    expect(codes(r)).toContain('SCRIPT_SYNTAX');
  });
  it('placement ngoài 1..5 → PLACEMENT', () => {
    expect(codes(validateRegexDraft([mk({ placement: [9] as unknown as DraftScript['placement'] })], '<x>a</x>'))).toContain('PLACEMENT');
  });
  it('placement rỗng → PLACEMENT', () => {
    expect(codes(validateRegexDraft([mk({ placement: [] })], '<x>a</x>'))).toContain('PLACEMENT');
  });
  it('markdownOnly & promptOnly cùng true → MEANINGLESS_FLAGS', () => {
    expect(codes(validateRegexDraft([mk({ markdownOnly: true, promptOnly: true })], '<x>a</x>'))).toContain('MEANINGLESS_FLAGS');
  });
});

describe('validateRegexDraft — V2 match thật (điểm ăn tiền)', () => {
  it('QUÊN flag dotAll trên status block nhiều dòng → NO_MATCH', () => {
    const r = validateRegexDraft(
      [mk({ findRegex: '/<x>(.*?)<\\/x>/' })],   // thiếu "s"
      '<x>\nhp: 5\nmp: 3\n</x>',                    // nhiều dòng
    );
    expect(codes(r)).toContain('NO_MATCH');
    expect(r.ok).toBe(false);
  });
  it('có flag s → match OK, không NO_MATCH', () => {
    const r = validateRegexDraft([mk({ findRegex: '/<x>([\\s\\S]*?)<\\/x>/s' })], '<x>\nhp: 5\n</x>');
    expect(codes(r)).not.toContain('NO_MATCH');
  });
  it('replaceString dùng $2 nhưng regex chỉ 1 nhóm → MISSING_GROUP', () => {
    const r = validateRegexDraft([mk({ replaceString: '<div>$1 $2</div>' })], '<x>a</x>');
    expect(codes(r)).toContain('MISSING_GROUP');
  });
  it('không có sampleOutput → NO_SAMPLE (warn), không chặn cứng', () => {
    const r = validateRegexDraft([mk({})], '');
    expect(codes(r)).toContain('NO_SAMPLE');
  });
});

describe('validateRegexDraft — V4 đồng biến schema + initvar', () => {
  // Trước đây UNKNOWN_VAR chỉ là 'warn' nên report vẫn ok=true → vòng tự sửa KHÔNG chạy,
  // widget dùng biến bịa vẫn được báo "✅ qua kiểm" rồi render ra undefined ("bảng không
  // ăn biến"). Nay phải là ERROR để chặn và bắt AI sửa.
  it('biến bịa không có trong schema/initvar → UNKNOWN_VAR là ERROR và CHẶN', () => {
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::fakevar}}</div>' })],
      '<x>a</x>', ['hp', 'mp'],
    );
    expect(codes(r)).toContain('UNKNOWN_VAR');
    expect(r.issues.find((i) => i.code === 'UNKNOWN_VAR')?.level).toBe('error');
    expect(r.ok).toBe(false); // phải chặn để kích hoạt vòng tự sửa
  });
  it('biến có trong schema → không cảnh báo', () => {
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::hp}}</div>' })],
      '<x>a</x>', ['hp', 'mp'],
    );
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
  });
  it('biến CHỈ có trong initvar (không có trong schema) → hợp lệ, không báo bịa', () => {
    const allowed = [...collectSchemaVarNames(null), ...collectInitVarNames({
      entries: [{ data: { 'Người Chơi': { 'Máu': 100, 'Vàng': 5 } } }],
    })];
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::Máu}}</div>' })],
      '<x>a</x>', allowed,
    );
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
  });
});

describe('collectInitVarNames — gom biến từ initvar lồng nhau', () => {
  it('lấy cả leaf name lẫn full path, mọi cấp', () => {
    const names = collectInitVarNames({
      entries: [{ data: { 'Người Chơi': { 'Máu': 100, 'Túi Đồ': { 'Vàng': 5 } } } }],
    });
    expect(names).toContain('Người Chơi');
    expect(names).toContain('Máu');
    expect(names).toContain('Vàng');
    expect(names).toContain('Người Chơi.Túi Đồ.Vàng');
  });
  it('initvar rỗng/null → mảng rỗng, không crash', () => {
    expect(collectInitVarNames(null)).toEqual([]);
    expect(collectInitVarNames({ entries: [] })).toEqual([]);
  });
});

describe('tên biến Unicode (Việt/Trung) — \\w cũ làm đứt tên', () => {
  it('{{getvar::Máu}} khớp đúng biến "Máu", không báo bịa', () => {
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::Máu}}</div>' })],
      '<x>a</x>', ['Máu', 'Thể Lực'],
    );
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
  });
  it('tên biến có KHOẢNG TRẮNG: {{getvar::Thể Lực}} vẫn khớp', () => {
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::Thể Lực}}</div>' })],
      '<x>a</x>', ['Máu', 'Thể Lực'],
    );
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
  });
  it("stat_data['Thế Giới.Chương'] lấy leaf 'Chương'", () => {
    const r = validateRegexDraft(
      [mk({ replaceString: "<div>${stat_data['Thế Giới.Chương']}</div>" })],
      '<x>a</x>', ['Chương'],
    );
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
  });
  it('biến Unicode BỊA vẫn bị bắt (không phải cứ Unicode là cho qua)', () => {
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::Biến Bịa}}</div>' })],
      '<x>a</x>', ['Máu'],
    );
    expect(codes(r)).toContain('UNKNOWN_VAR');
  });
});

describe('NO_VAR_BOUND — widget không bind biến nào', () => {
  it('widget dài mà không tham chiếu biến MVU nào → cảnh báo bảng chết', () => {
    const longHardcoded = '<div class="stat">' + 'HP: 100 / MP: 50 / Vàng: 999 '.repeat(12) + '</div>';
    const r = validateRegexDraft([mk({ replaceString: longHardcoded })], '<x>a</x>', ['hp', 'mp']);
    expect(codes(r)).toContain('NO_VAR_BOUND');
  });
});

describe('case PASS hoàn chỉnh', () => {
  it('regex đúng + match + nhóm đủ + biến hợp lệ → ok=true, không issue error', () => {
    const r = validateRegexDraft(
      [mk({ findRegex: '/<status>([\\s\\S]*?)<\\/status>/s', replaceString: '<div class="hp">HP: $1</div>' })],
      '<status>\n95\n</status>', ['hp'],
    );
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
});

describe('buildRenderableHtml + collectSchemaVarNames + reportToXml', () => {
  it('thế $1 bằng capture thật', () => {
    const html = buildRenderableHtml(mk({ findRegex: '/<x>([\\s\\S]*?)<\\/x>/s', replaceString: '<b>$1</b>' }), '<x>HELLO</x>');
    expect(html).toBe('<b>HELLO</b>');
  });
  it('không match → null (không dựng preview được)', () => {
    expect(buildRenderableHtml(mk({ findRegex: '/<z>(.*?)<\\/z>/' }), '<x>a</x>')).toBeNull();
  });
  it('collectSchemaVarNames gom label + leaf path', () => {
    const schema = { fields: [{ path: '/stats/hp', label: 'Máu', children: [] }] } as unknown as MVUZODSchema;
    const names = collectSchemaVarNames(schema);
    expect(names).toContain('hp');
    expect(names).toContain('Máu');
  });
  it('reportToXml bọc issue trong <validation_report>', () => {
    const xml = reportToXml(validateRegexDraft([mk({ findRegex: '/[bad/' })], '<x>a</x>'));
    expect(xml).toContain('<validation_report>');
    expect(xml).toContain('REGEX_SYNTAX');
    expect(xml).toContain('<verdict>FAIL');
  });
});
