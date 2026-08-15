/**
 * (bug 235) GHÉP ENTRY BẰNG TÊN DO AI — thay cho ghép bằng chỗ ngồi.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "so bằng UID nó sai bét nhè… Đầu tiên là so sánh xem các entry có tên gốc tiếng Trung
 * của bản raw nếu dịch ra sẽ giống các tên entry nào của bản đã dịch. Sau đó tới khâu so sánh
 * nội dung… AI tự phát hiện entry lorebook/schema/regex/script nào có thể tái sử dụng lại được."
 *
 * Test khoá bốn thứ, theo đúng thứ tự rủi ro:
 *  1. Gom đơn vị đúng — nhãn của script TavernHelper có tới bốn dạng path, gom sai là hỏng từ gốc.
 *  2. Tầng luật chỉ nhận bằng chứng CHẮC, và tuyệt đối không ghép chéo loại.
 *  3. Kết quả AI phải qua kiểm máy: id bịa, ghép chéo loại, ghép hai-đối-một đều bị chặn.
 *  4. Im lặng KHÔNG BAO GIỜ được hiểu là "giống" — mặc định phải là dịch lại.
 */
import { describe, it, expect } from 'vitest';
import {
  parseUnitLabel, collectMatchUnits, matchUnitsByRule,
  buildNameMatchMessages, parseNameMatchResponse,
  buildContentVerdictMessages, parseContentVerdictResponse,
  defaultReuse, buildFieldReusePlan, batchContentJobs,
  CONTENT_SAMPLE,
  type UnitScanField, type MatchUnit, type ContentJob, type MatchRow,
} from '../aiEntryMatch';

const f = (path: string, label: string, group: string, original: string): UnitScanField =>
  ({ path, label, group, original });

/* ─── Hai thẻ mẫu: bản ĐÃ DỊCH cũ (tiếng Việt) và bản RAW MỚI (tiếng Trung) ───
 * Cố ý dựng đúng ca làm lối cũ gãy: tác giả ĐẢO THỨ TỰ entry và CHÈN một entry mới vào giữa,
 * nên chỗ ngồi (entries[i]) của hai bên không còn ứng nhau ở bất cứ đâu. */
const OLD_FIELDS: UnitScanField[] = [
  f('data.character_book.entries[0].comment', 'lorebook[0].comment', 'lorebook', 'Chiến đấu'),
  f('data.character_book.entries[0].content', 'lorebook[0].content', 'lorebook', 'Quy tắc chiến đấu và trang bị.'),
  f('data.character_book.entries[1].comment', 'lorebook[1].comment', 'lorebook', 'Đạo cụ'),
  f('data.character_book.entries[1].content', 'lorebook[1].content', 'lorebook', 'Quy tắc vật phẩm và đạo cụ.'),
  f('data.extensions.regex_scripts[0].scriptName', 'regex[0].scriptName (Bảng)', 'regex', 'Bảng trạng thái'),
  f('data.extensions.regex_scripts[0].replaceString', 'regex[0].replaceString (Bảng)', 'regex', '<div>Máu: {{v}}</div>'),
];

const NEW_FIELDS: UnitScanField[] = [
  // Đảo thứ tự: 道具 lên trước 战斗, và chèn thêm một entry HOÀN TOÀN MỚI ở giữa.
  f('data.character_book.entries[0].comment', 'lorebook[0].comment', 'lorebook', '道具'),
  f('data.character_book.entries[0].content', 'lorebook[0].content', 'lorebook', '物品与道具规则。'),
  f('data.character_book.entries[1].comment', 'lorebook[1].comment', 'lorebook', '天气系统'),
  f('data.character_book.entries[1].content', 'lorebook[1].content', 'lorebook', '天气影响战斗判定。'),
  f('data.character_book.entries[2].comment', 'lorebook[2].comment', 'lorebook', '战斗'),
  f('data.character_book.entries[2].content', 'lorebook[2].content', 'lorebook', '战斗与装备规则。'),
  f('data.extensions.regex_scripts[0].scriptName', 'regex[0].scriptName (状态栏)', 'regex', '状态栏'),
  f('data.extensions.regex_scripts[0].replaceString', 'regex[0].replaceString (状态栏)', 'regex', '<div>血量: {{v}}</div>'),
];

describe('(bug 235) gom đơn vị tái dùng', () => {
  it('đọc nhãn ra đúng loại + số thứ tự, kể cả khi nhãn có đuôi [initvar] / (tên script)', () => {
    expect(parseUnitLabel('lorebook[12].content [initvar]')).toEqual({ kind: 'lorebook', index: 12, field: 'content' });
    expect(parseUnitLabel('regex[3].replaceString (Bảng trạng thái)')).toEqual({ kind: 'regex', index: 3, field: 'replaceString' });
    expect(parseUnitLabel('tavernHelper[0].content (MVU)')).toEqual({ kind: 'script', index: 0, field: 'content' });
    expect(parseUnitLabel('description')).toBeNull();
  });

  it('gom mọi field rời của một entry về một đơn vị, lấy comment làm TÊN', () => {
    const units = collectMatchUnits(OLD_FIELDS);
    const lb0 = units.find((u) => u.id === 'lorebook[0]')!;
    expect(lb0.name).toBe('Chiến đấu');
    expect(lb0.content).toBe('Quy tắc chiến đấu và trang bị.');
    expect(lb0.paths).toHaveLength(2);
  });

  it('script TavernHelper gom đúng dù path ở dạng tuple lạ — vì đọc NHÃN chứ không đọc path', () => {
    const units = collectMatchUnits([
      f('data.extensions.TavernHelper[3][1][0].name', 'tavernHelper[0].name (MVU)', 'tavern_helper', 'MVU'),
      f('data.extensions.TavernHelper[3][1][0].content', 'tavernHelper[0].content (MVU)', 'tavern_helper', 'const x = 1;'),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe('script');
    expect(units[0].name).toBe('MVU');
  });

  it('đơn vị không có cả tên lẫn nội dung thì bỏ — gửi cho AI chỉ làm nhiễu', () => {
    const units = collectMatchUnits([f('x.entries[9].keys', 'lorebook[9].keys', 'lorebook_keys', '')]);
    expect(units).toHaveLength(0);
  });
});

describe('(bug 235) tầng luật — chỉ nhận bằng chứng chắc chắn', () => {
  const oldU = collectMatchUnits(OLD_FIELDS);
  const newU = collectMatchUnits(NEW_FIELDS);

  it('hai thẻ khác ngôn ngữ, không key Hán, không tên trùng ⇒ luật KHÔNG ghép được gì', () => {
    const r = matchUnitsByRule(oldU, newU);
    expect(r.pairs).toHaveLength(0);
    expect(r.restNew).toHaveLength(4);   // đúng phần phải nhờ AI
  });

  it('key Hán trùng thì ghép ngay, không cần AI', () => {
    const o = collectMatchUnits([
      ...OLD_FIELDS,
      f('data.character_book.entries[0].keys', 'lorebook[0].keys', 'lorebook_keys', '战斗, chiến đấu'),
    ]);
    const n = collectMatchUnits([
      ...NEW_FIELDS,
      f('data.character_book.entries[2].keys', 'lorebook[2].keys', 'lorebook_keys', '战斗'),
    ]);
    const r = matchUnitsByRule(o, n);
    const p = r.pairs.find((x) => x.method === 'key-han');
    expect(p).toBeDefined();
    expect(p!.oldId).toBe('lorebook[0]');
    expect(p!.newId).toBe('lorebook[2]');   // chỗ ngồi lệch hẳn — vẫn ghép đúng
  });

  it('TUYỆT ĐỐI không ghép chéo loại: một regex không thể là một entry lorebook', () => {
    const o = collectMatchUnits([f('a', 'lorebook[0].comment', 'lorebook', 'Bảng trạng thái')]);
    const n = collectMatchUnits([f('b', 'regex[0].scriptName', 'regex', 'Bảng trạng thái')]);
    expect(matchUnitsByRule(o, n).pairs).toHaveLength(0);
  });

  it('tên trùng ở NHIỀU mục thì bỏ hết — không biết chọn cái nào', () => {
    const o = collectMatchUnits([
      f('a1', 'lorebook[0].comment', 'lorebook', 'Nhân vật'),
      f('a2', 'lorebook[1].comment', 'lorebook', 'Nhân vật'),
    ]);
    const n = collectMatchUnits([f('b1', 'lorebook[0].comment', 'lorebook', 'Nhân vật')]);
    expect(matchUnitsByRule(o, n).pairs).toHaveLength(0);
  });
});

describe('(bug 235) tầng AI ghép tên — kết quả phải qua kiểm máy', () => {
  const oldU = collectMatchUnits(OLD_FIELDS);
  const newU = collectMatchUnits(NEW_FIELDS);

  it('prompt nêu rõ A là bản raw mới, B là bản đã dịch, và liệt kê đủ hai bên', () => {
    const { system, user } = buildNameMatchMessages(oldU, newU);
    expect(system).toContain('DANH SÁCH A');
    expect(system).toContain('mỗi mục B chỉ được dùng cho MỘT mục A');
    expect(user).toContain('lorebook[2] [lorebook] · tên: 战斗');
    expect(user).toContain('lorebook[0] [lorebook] · tên: Chiến đấu');
  });

  it('ghép đúng qua chỗ ngồi lệch — đây là điều lối cũ không làm được', () => {
    const pairs = parseNameMatchResponse(JSON.stringify({
      pairs: [
        { a: 'lorebook[2]', b: 'lorebook[0]', tin: 'cao', vi_sao: '战斗 dịch là Chiến đấu.' },
        { a: 'lorebook[0]', b: 'lorebook[1]', tin: 'cao', vi_sao: '道具 dịch là Đạo cụ.' },
        { a: 'regex[0]', b: 'regex[0]', tin: 'vua', vi_sao: '状态栏 là Bảng trạng thái.' },
      ],
    }), oldU, newU);
    expect(pairs).toHaveLength(3);
    expect(pairs.find((p) => p.newId === 'lorebook[2]')!.oldId).toBe('lorebook[0]');
    expect(pairs.find((p) => p.newId === 'lorebook[0]')!.oldId).toBe('lorebook[1]');
  });

  it('entry tác giả MỚI THÊM không bị ghép bừa cho đủ', () => {
    const pairs = parseNameMatchResponse(JSON.stringify({
      pairs: [{ a: 'lorebook[2]', b: 'lorebook[0]', tin: 'cao', vi_sao: '' }],
    }), oldU, newU);
    expect(pairs.some((p) => p.newId === 'lorebook[1]')).toBe(false);  // 天气系统 là entry mới
  });

  it('AI bịa id không có thật ⇒ bỏ cặp đó', () => {
    const pairs = parseNameMatchResponse(JSON.stringify({
      pairs: [{ a: 'lorebook[99]', b: 'lorebook[0]', tin: 'cao', vi_sao: '' }],
    }), oldU, newU);
    expect(pairs).toHaveLength(0);
  });

  it('AI ghép chéo loại ⇒ bỏ cặp đó', () => {
    const pairs = parseNameMatchResponse(JSON.stringify({
      pairs: [{ a: 'regex[0]', b: 'lorebook[0]', tin: 'cao', vi_sao: '' }],
    }), oldU, newU);
    expect(pairs).toHaveLength(0);
  });

  it('hai mục A cùng đòi một mục B ⇒ chỉ giữ cặp tin cậy CAO hơn, cặp kia bỏ hẳn', () => {
    const pairs = parseNameMatchResponse(JSON.stringify({
      pairs: [
        { a: 'lorebook[0]', b: 'lorebook[0]', tin: 'thap', vi_sao: 'đoán' },
        { a: 'lorebook[2]', b: 'lorebook[0]', tin: 'cao', vi_sao: 'chắc' },
      ],
    }), oldU, newU);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].newId).toBe('lorebook[2]');
  });

  it('AI trả rác / không có JSON ⇒ ném lỗi để lượt gọi biết mà thử lại', () => {
    expect(() => parseNameMatchResponse('xin lỗi tôi không hiểu', oldU, newU)).toThrow();
  });
});

describe('(bug 235) tầng so nội dung — im lặng không bao giờ là "giống"', () => {
  const jobs: ContentJob[] = [
    { newId: 'lorebook[0]', name: '道具', rawContent: '物品与道具规则。', oldTranslated: 'Quy tắc vật phẩm và đạo cụ.' },
    { newId: 'lorebook[2]', name: '战斗', rawContent: '战斗与装备规则。新增：护甲穿透。', oldTranslated: 'Quy tắc chiến đấu và trang bị.' },
  ];

  it('prompt cấm chọn "giong" cho chắc việc, và nói rõ hậu quả', () => {
    const { system } = buildContentVerdictMessages(jobs);
    expect(system).toContain('TUYỆT ĐỐI đừng chọn "giong"');
    expect(system).toContain('TÁI DÙNG');
  });

  it('đọc đúng phán quyết từng mục', () => {
    const out = parseContentVerdictResponse(JSON.stringify({
      ket_qua: [
        { id: 'lorebook[0]', ket_luan: 'giong', ghi_chu: 'Cùng nội dung.' },
        { id: 'lorebook[2]', ket_luan: 'khac', ghi_chu: 'Thêm quy tắc xuyên giáp.' },
      ],
    }), jobs);
    expect(out.find((x) => x.newId === 'lorebook[0]')!.verdict).toBe('giong');
    expect(out.find((x) => x.newId === 'lorebook[2]')!.verdict).toBe('khac');
  });

  it('mục AI QUÊN trả lời ⇒ mặc định "khong-chac", KHÔNG phải "giong"', () => {
    const out = parseContentVerdictResponse(JSON.stringify({
      ket_qua: [{ id: 'lorebook[0]', ket_luan: 'giong', ghi_chu: '' }],
    }), jobs);
    const missing = out.find((x) => x.newId === 'lorebook[2]')!;
    expect(missing.verdict).toBe('khong-chac');
    expect(missing.note).toMatch(/dịch lại cho an toàn/);
  });

  it('phán quyết lạ ⇒ quy về "khong-chac"', () => {
    const out = parseContentVerdictResponse(JSON.stringify({
      ket_qua: [{ id: 'lorebook[0]', ket_luan: 'có lẽ giống', ghi_chu: '' }],
    }), jobs);
    expect(out[0].verdict).toBe('khong-chac');
  });

  it('chỉ "giong" mới tái dùng mặc định', () => {
    expect(defaultReuse('giong')).toBe(true);
    expect(defaultReuse('khac')).toBe(false);
    expect(defaultReuse('khong-chac')).toBe(false);
  });

  it('nội dung dài bị cắt nhưng giữ CẢ đầu lẫn cuối — tác giả hay sửa ở cuối entry', () => {
    const long = 'A'.repeat(CONTENT_SAMPLE) + 'ĐUÔI_ĐẶC_BIỆT';
    const { user } = buildContentVerdictMessages([
      { newId: 'lorebook[0]', name: 'x', rawContent: long, oldTranslated: 'ngắn' },
    ]);
    expect(user).toContain('ĐUÔI_ĐẶC_BIỆT');
    expect(user).toContain('cắt bớt');
  });
});

describe('(bug 235) dựng kế hoạch tái dùng ở mức field', () => {
  const oldU = collectMatchUnits(OLD_FIELDS);
  const newU = collectMatchUnits(NEW_FIELDS);
  const rowOf = (newId: string, oldId: string, reuse: boolean): MatchRow => ({
    pair: { oldId, newId, method: 'ai-ten', confidence: 'cao', why: '' },
    newName: newU.find((u) => u.id === newId)?.name ?? '',
    oldName: oldU.find((u) => u.id === oldId)?.name ?? '',
    verdict: reuse ? 'giong' : 'khac', note: '', reuse,
  });

  it('đắp bản dịch cũ vào ĐÚNG path của bản mới, ghép theo TÊN FIELD', () => {
    const plan = buildFieldReusePlan([rowOf('lorebook[2]', 'lorebook[0]', true)], OLD_FIELDS, NEW_FIELDS);
    expect(plan.reused.get('data.character_book.entries[2].content')).toBe('Quy tắc chiến đấu và trang bị.');
    expect(plan.reused.get('data.character_book.entries[2].comment')).toBe('Chiến đấu');
    expect(plan.counts.units).toBe(1);
  });

  it('cặp người dùng BỎ TICK thì không đắp gì', () => {
    const plan = buildFieldReusePlan([rowOf('lorebook[2]', 'lorebook[0]', false)], OLD_FIELDS, NEW_FIELDS);
    expect(plan.reused.size).toBe(0);
    expect(plan.counts.skipped).toBe(1);
  });

  it('field bên mới KHÔNG có ở bên cũ thì bỏ qua, không dán nhầm sang ô khác', () => {
    const newer = [...NEW_FIELDS, f('data.character_book.entries[2].secondary_keys', 'lorebook[2].secondary_keys', 'lorebook_keys', '装备')];
    const plan = buildFieldReusePlan([rowOf('lorebook[2]', 'lorebook[0]', true)], OLD_FIELDS, newer);
    expect(plan.reused.has('data.character_book.entries[2].secondary_keys')).toBe(false);
  });

  it('regex cũng tái dùng được — đúng thứ user liệt kê', () => {
    const plan = buildFieldReusePlan([rowOf('regex[0]', 'regex[0]', true)], OLD_FIELDS, NEW_FIELDS);
    expect(plan.reused.get('data.extensions.regex_scripts[0].replaceString')).toBe('<div>Máu: {{v}}</div>');
  });
});

describe('(bug 235) chia lô gọi API', () => {
  const mk = (id: string, n: number): ContentJob =>
    ({ newId: id, name: id, rawContent: 'x'.repeat(n), oldTranslated: 'y'.repeat(n) });

  it('cắt lô theo TỔNG KÝ TỰ chứ không chỉ theo số mục', () => {
    // Mỗi mục tốn tối đa 2×CONTENT_SAMPLE = 5.000 ký tự sau khi cắt mẫu ⇒ trần 24.000 chặn ở mục thứ 5.
    const jobs = Array.from({ length: 6 }, (_, i) => mk(`u${i}`, 9000));
    const batches = batchContentJobs(jobs, 24_000, 99);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0].length).toBeLessThanOrEqual(5);
    expect(batches.flat()).toHaveLength(6);
  });

  it('chi phí tính trên phần ĐÃ CẮT MẪU — một entry khổng lồ không tự nó làm vỡ cửa sổ ngữ cảnh', () => {
    // Đây là lý do sample() tồn tại: entry 500.000 ký tự vẫn chỉ tốn bằng một entry 2.500 ký tự,
    // nên nó KHÔNG cần phải đứng riêng một lô và cũng không đẩy mục khác ra ngoài.
    const batches = batchContentJobs([mk('huge', 500_000), mk('small', 10)], 24_000, 8);
    expect(batches).toHaveLength(1);
    expect(batches.flat()).toHaveLength(2);
  });

  it('không mục nào bị bỏ rơi dù trần nhỏ đến đâu', () => {
    const jobs = Array.from({ length: 7 }, (_, i) => mk(`u${i}`, 9000));
    const batches = batchContentJobs(jobs, 1, 8);
    expect(batches.flat().map((j) => j.newId)).toEqual(jobs.map((j) => j.newId));
  });

  it('trần số mục mỗi lô được tôn trọng', () => {
    const jobs = Array.from({ length: 20 }, (_, i) => mk(`u${i}`, 10));
    const batches = batchContentJobs(jobs, 1_000_000, 8);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(8);
    expect(batches.flat()).toHaveLength(20);
  });
});
