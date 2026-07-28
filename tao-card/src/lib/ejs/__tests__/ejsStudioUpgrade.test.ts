// (Goal 28/07) Đại nâng cấp EJS Studio — test các mô-đun TẤT ĐỊNH:
// nhóm kế hoạch, vá tham chiếu, test mode, rà xung đột, ước token, luật MVU, tách entry.
import { describe, it, expect } from 'vitest';
import type { LorebookEntry } from '../../../types';
import { groupPlanRows, extractIfElseChains } from '../ejsPlanGroups';
import { scanBrokenRefs, rewriteRefs, fuzzyRepairMapping } from '../ejsRefIntegrity';
import { proposeTestValues, simulateActivation } from '../ejsTestMode';
import { findActivationOverlaps, scanKeywordOverlap } from '../ejsCollision';
import {
  isMvuCriticalEntry, suggestReclassification, estimateRowTokensDelta, estimateEntryTokens,
  type EjsPlanRow,
} from '../ejsPlanModel';
import { parseSplitResponse } from '../ejsSplit';
import { buildEjsPolicy } from '../ejsPolicy';
import { validateWorldbookEjs } from '../stptApi';

const mkEntry = (o: Partial<LorebookEntry>): LorebookEntry => ({
  id: o.id ?? 1, keys: o.keys ?? [], secondary_keys: [], comment: o.comment ?? 'E',
  content: o.content ?? '', constant: o.constant ?? false, selective: false,
  insertion_order: 100, enabled: o.enabled ?? true, position: 'before_char',
  use_regex: false, extensions: {} as LorebookEntry['extensions'],
  ...o,
} as LorebookEntry);

const mkRow = (o: Partial<EjsPlanRow>): EjsPlanRow => ({
  id: o.id ?? 'r1', action: o.action ?? 'create_ejs', target: o.target ?? 'lorebook',
  name: o.name ?? 'X', currentMode: o.currentMode ?? null, proposedMode: o.proposedMode ?? null,
  proposal: '', reason: '', requirement: o.requirement ?? '', ...o,
});

// ═══ 1. Nhóm kế hoạch — đúng 3 tiêu chí, ngoài ra độc lập ═══════════════════

describe('groupPlanRows — gom nhóm theo liên quan', () => {
  it('cùng đọc một biến MVU → chung nhóm; mục không dính gì → nhóm riêng', () => {
    const rows = [
      mkRow({ id: 'a', name: 'Controller cảnh giới', varsUsed: ['stat_data.Cảnh giới'] }),
      mkRow({ id: 'b', name: 'Hiển thị cảnh giới', varsUsed: ['Cảnh giới'] }),  // khác tiền tố vẫn khớp
      mkRow({ id: 'c', name: 'NPC bà bán bánh', varsUsed: [] }),
    ];
    const groups = groupPlanRows(rows, []);
    const big = groups.find(g => g.rowIds.length > 1)!;
    expect(big.rowIds.sort()).toEqual(['a', 'b']);
    expect(big.reasons.join(' ')).toContain('cùng dùng biến');
    expect(groups.find(g => g.rowIds.length === 1)!.rowIds).toEqual(['c']);
  });

  it('entry getwi tới entry của mục khác → chung nhóm', () => {
    const entries = [
      mkEntry({ id: 1, comment: 'Tổng quan môn phái', content: `<%_ var x = await getwi(null, 'Bí sử môn phái'); _%>` }),
      mkEntry({ id: 2, comment: 'Bí sử môn phái', content: 'lore' }),
    ];
    const rows = [
      mkRow({ id: 'a', name: 'Tổng quan môn phái', action: 'edit_content' }),
      mkRow({ id: 'b', name: 'Bí sử môn phái', action: 'reclassify', currentMode: 'constant', proposedMode: 'keyword' }),
      mkRow({ id: 'c', name: 'Chợ đêm' }),
    ];
    const groups = groupPlanRows(rows, entries);
    const big = groups.find(g => g.rowIds.length > 1)!;
    expect(big.rowIds.sort()).toEqual(['a', 'b']);
    expect(big.reasons.join(' ')).toContain('tham chiếu');
  });

  it('cùng chuỗi if/else-if trong controller có sẵn → chung nhóm', () => {
    const controller = mkEntry({
      id: 9, comment: 'Bộ điều khiển', content: `@@preprocessing
<%_
var _cg = getvar('stat_data.Cảnh giới');
if (_cg === 'Luyện Khí') { await activewi('Lore Luyện Khí', true); }
else if (_cg === 'Trúc Cơ') { await activewi('Lore Trúc Cơ', true); }
_%>`,
    });
    const rows = [
      mkRow({ id: 'a', name: 'Lore Luyện Khí', action: 'edit_content' }),
      mkRow({ id: 'b', name: 'Lore Trúc Cơ', action: 'edit_content' }),
      mkRow({ id: 'c', name: 'Lore Kim Đan', action: 'edit_content' }),
    ];
    // rows a,b không khai varsUsed → chỉ tiêu chí chuỗi if/else-if gom được chúng.
    const groups = groupPlanRows(rows, [controller]);
    const big = groups.find(g => g.rowIds.includes('a'))!;
    expect(big.rowIds).toContain('b');
    expect(big.rowIds).not.toContain('c');
    expect(big.reasons.join(' ')).toContain('if/else-if');
  });

  it('các nhóm RỜI NHAU — từ chối nhóm này không thể đụng mục nhóm khác', () => {
    const rows = [
      mkRow({ id: 'a', varsUsed: ['x'] }), mkRow({ id: 'b', varsUsed: ['x'] }),
      mkRow({ id: 'c', varsUsed: ['y'] }), mkRow({ id: 'd', varsUsed: ['y'] }),
    ];
    const groups = groupPlanRows(rows, []);
    const all = groups.flatMap(g => g.rowIds);
    expect(all.sort()).toEqual(['a', 'b', 'c', 'd']);           // đủ mặt
    expect(new Set(all).size).toBe(all.length);                  // không mục nào ở 2 nhóm
  });

  it('extractIfElseChains bóc đúng tên trong một chuỗi', () => {
    const chains = extractIfElseChains(
      `if (a > 1) { await activewi('A', true); } else if (a > 2) { await activewi('B', true); }
       if (b) { await activewi('C', true); }`,
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].sort()).toEqual(['a', 'b']);
  });
});

// ═══ 2. Tham chiếu getwi/activewi — quét gãy + vá ═══════════════════════════

describe('ejsRefIntegrity — tham chiếu không được gãy', () => {
  it('bắt tham chiếu trỏ vào entry không tồn tại; không báo bừa cái còn sống', () => {
    const blocks = [
      { name: 'Ctl', code: `await activewi('Còn Sống', true); await getwi(null, 'Đã Xoá');` },
    ];
    const broken = scanBrokenRefs(blocks, ['Còn Sống']);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ from: 'Ctl', ref: 'Đã Xoá', kind: 'getwi' });
  });

  it('vá đổi tên 1→1 và tách 1→N (getwi nối nội dung, activewi bật đủ các phần)', () => {
    const code = `<%_
if (x) { await activewi('Sự kiện năm', true); }
var t = await getwi(null, 'Sự kiện năm');
_%>`;
    const { code: out, changes } = rewriteRefs(code, new Map([
      ['Sự kiện năm', ['Sự kiện tháng 3', 'Sự kiện tháng 7']],
    ]));
    expect(changes.length).toBe(2);
    // activewi: bật đủ 2 phần trong MỘT biểu thức (đứng được sau if không ngoặc).
    expect(out).toContain(`(await activewi('Sự kiện tháng 3', true), await activewi('Sự kiện tháng 7', true))`);
    // getwi: nối nội dung 2 phần — ngữ nghĩa như đọc entry gốc.
    expect(out).toContain(`(await getwi(null, 'Sự kiện tháng 3'))`);
    expect(out).toContain(`+ '\\n' +`);
    expect(out).not.toContain(`'Sự kiện năm'`);
    // Code sau vá vẫn hợp lệ theo đúng máy kiểm của extension.
    expect(validateWorldbookEjs(out).ok).toBe(true);
  });

  it('fuzzyRepairMapping chỉ vá khi khớp không phân biệt hoa-thường với ĐÚNG MỘT entry', () => {
    const map = fuzzyRepairMapping(
      [
        { from: 'C', ref: 'lore   luyện khí', kind: 'getwi' },
        { from: 'C', ref: 'Hoàn Toàn Lạ', kind: 'getwi' },
      ],
      ['Lore Luyện Khí', 'Khác'],
    );
    expect(map.get('lore   luyện khí')).toEqual(['Lore Luyện Khí']);
    expect(map.has('Hoàn Toàn Lạ')).toBe(false);   // không đoán mò
  });
});

// ═══ 3. Test mode — đề xuất giá trị + mô phỏng ══════════════════════════════

describe('ejsTestMode — thử điều kiện ngay trong tool', () => {
  const CTL = `@@preprocessing
<%_
var _cg = getvar('stat_data.Cảnh giới');
var _hp = getvar('stat_data.HP', { defaults: 100 });
if (_cg === 'Kim Đan') { await activewi('Bí cảnh Kim Đan', true); }
if (_hp <= 30) { await activewi('Trạng thái trọng thương', true); }
_%>`;

  it('proposeTestValues bóc mốc từ chính điều kiện: enum + số tại mốc và 2 phía ranh giới', () => {
    const props = proposeTestValues([CTL]);
    const cg = props.find(p => p.path === 'stat_data.Cảnh giới')!;
    expect(cg.values).toContain('Kim Đan');
    const hp = props.find(p => p.path === 'stat_data.HP')!;
    expect(hp.values).toEqual(expect.arrayContaining([30, 29, 31]));
    expect(hp.fromConditions.join(' ')).toContain('<= 30');
  });

  it('mô phỏng: giá trị đạt điều kiện thì entry được bật, không đạt thì không — kể cả activewi sau await', async () => {
    const entries = [
      mkEntry({ id: 1, comment: 'Bí cảnh Kim Đan', enabled: false }),
      mkEntry({ id: 2, comment: 'Trạng thái trọng thương', enabled: false }),
      mkEntry({ id: 3, comment: 'Luật thế giới', constant: true }),
      mkEntry({ id: 4, comment: 'NPC Lão Trương', keys: ['lão trương'] }),
    ];
    const hit = await simulateActivation(
      [{ name: 'Ctl', code: CTL }], entries,
      { 'stat_data.Cảnh giới': 'Kim Đan', 'stat_data.HP': 10 },
      'người chơi hỏi thăm Lão Trương',
    );
    const by = (n: string) => hit.results.find(r => r.entry === n)!;
    expect(by('Bí cảnh Kim Đan').activated).toBe(true);
    // HP 10 ≤ 30 — activewi thứ hai nằm SAU await đầu tiên, vẫn phải được ghi nhận.
    expect(by('Trạng thái trọng thương').activated).toBe(true);
    expect(by('Luật thế giới').activated).toBe(true);
    expect(by('NPC Lão Trương').activated).toBe(true);
    expect(by('NPC Lão Trương').via).toContain('lão trương');

    const miss = await simulateActivation(
      [{ name: 'Ctl', code: CTL }], entries,
      { 'stat_data.Cảnh giới': 'Luyện Khí', 'stat_data.HP': 90 }, '',
    );
    expect(miss.results.find(r => r.entry === 'Bí cảnh Kim Đan')!.activated).toBe(false);
    expect(miss.results.find(r => r.entry === 'NPC Lão Trương')!.activated).toBe(false);
  });

  it('biến chưa nhập → báo missingVars; code lỗi → báo errors, không nuốt', async () => {
    const r = await simulateActivation(
      [{ name: 'Bad', code: `<%_ var a = getvar('x.y'); notAFunction(); _%>` }],
      [], {},
    );
    expect(r.missingVars).toContain('x.y');
    expect(r.errors.join(' ')).toContain('Bad');
  });
});

// ═══ 4. Rà xung đột — có thì báo, sạch thì im ═══════════════════════════════

describe('xung đột kích hoạt + từ khoá', () => {
  it('hai khối cùng bật một entry → cảnh báo; sạch → không có gì', () => {
    const dirty = findActivationOverlaps([
      { name: 'A', code: `await activewi('Chung', true);` },
      { name: 'B', code: `await activewi('Chung', true);` },
      { name: 'C', code: `await activewi('Riêng', true);` },
    ]);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].message).toContain('Chung');
    expect(findActivationOverlaps([{ name: 'A', code: `await activewi('Một mình', true);` }])).toEqual([]);
  });

  it('key trùng hệt và key bao nhau giữa 2 entry → cảnh báo; card sạch → []', () => {
    const warns = scanKeywordOverlap([
      { comment: 'A', keys: ['kiếm khí'] },
      { comment: 'B', keys: ['kiếm khí'] },
      { comment: 'C', keys: ['kiếm'] },
    ]);
    expect(warns.join(' ')).toContain('kiếm khí');
    expect(warns.some(w => w.includes('nằm TRONG'))).toBe(true);
    expect(scanKeywordOverlap([{ comment: 'A', keys: ['rồng'] }, { comment: 'B', keys: ['phượng'] }])).toEqual([]);
  });
});

// ═══ 5. Entry MVU + ước token ═══════════════════════════════════════════════

describe('luật MVU + ước token', () => {
  it('isMvuCriticalEntry nhận diện initvar/quy tắc/EJS/UpdateVariable; lore thường thì không', () => {
    expect(isMvuCriticalEntry(mkEntry({ comment: '[initvar]初始化' }))).toBe(true);
    expect(isMvuCriticalEntry(mkEntry({ comment: 'Quy tắc cập nhật biến' }))).toBe(true);
    expect(isMvuCriticalEntry(mkEntry({ comment: 'Ctl', content: '@@preprocessing\n<%_ x _%>' }))).toBe(true);
    expect(isMvuCriticalEntry(mkEntry({ comment: 'Định dạng', content: 'Dùng <UpdateVariable>…</UpdateVariable>' }))).toBe(true);
    expect(isMvuCriticalEntry(mkEntry({ comment: 'Thành Vọng Nguyệt', content: 'Một toà thành cổ.' }))).toBe(false);
  });

  it('suggestReclassification KHÔNG đề xuất hạ cấp entry MVU dù nó đang Constant', () => {
    const sugg = suggestReclassification([
      mkEntry({ id: 1, comment: 'Quy tắc cập nhật biến', constant: true, content: 'x'.repeat(400) }),
      mkEntry({ id: 2, comment: 'Chuyện phiếm trong thành', constant: true, content: 'y'.repeat(400) }),
    ]);
    expect(sugg.some(s => s.name === 'Quy tắc cập nhật biến')).toBe(false);
    expect(sugg.some(s => s.name === 'Chuyện phiếm trong thành')).toBe(true);
  });

  it('estimateRowTokensDelta: rời constant âm, về constant dương, tách chia theo phần, tạo khối +overhead', () => {
    const e = mkEntry({ content: 'a'.repeat(400) });          // ~100 token
    const t = estimateEntryTokens(e);
    expect(estimateRowTokensDelta(mkRow({ action: 'reclassify', currentMode: 'constant', proposedMode: 'keyword' }), e)).toBe(-t);
    expect(estimateRowTokensDelta(mkRow({ action: 'reclassify', currentMode: 'keyword', proposedMode: 'constant' }), e)).toBe(t);
    expect(estimateRowTokensDelta(
      mkRow({ action: 'split_entry', currentMode: 'constant', splitInto: [
        { name: 'A', mode: 'keyword', criterion: '' }, { name: 'B', mode: 'keyword', criterion: '' },
      ] }), e,
    )).toBe(-Math.round(t / 2));
    expect(estimateRowTokensDelta(mkRow({ action: 'create_ejs' }), undefined)).toBeGreaterThan(0);
  });
});

// ═══ 6. Tách entry — validate không rơi chữ ═════════════════════════════════

describe('parseSplitResponse — tách phải đủ phần, không rơi dữ kiện', () => {
  const original = mkEntry({
    comment: 'Sự kiện trong năm',
    content: 'Tháng ba có lễ hội hoa đăng rực rỡ khắp thành.\nTháng bảy tổ chức đại hội võ lâm ở núi Bắc.',
  });
  const row = mkRow({
    action: 'split_entry', name: 'Sự kiện trong năm',
    splitInto: [
      { name: 'Lễ hội hoa đăng', mode: 'keyword', criterion: 'tháng 3' },
      { name: 'Đại hội võ lâm', mode: 'keyword', criterion: 'tháng 7' },
    ],
  });

  it('tách hợp lệ: đủ phần, giữ đủ dòng → không cảnh báo mất chữ', () => {
    const r = parseSplitResponse(JSON.stringify({
      parts: [
        { comment: 'Lễ hội hoa đăng', content: 'Tháng ba có lễ hội hoa đăng rực rỡ khắp thành.', mode: 'keyword', keys: ['hoa đăng', 'tháng ba'] },
        { comment: 'Đại hội võ lâm', content: 'Tháng bảy tổ chức đại hội võ lâm ở núi Bắc.', mode: 'keyword', keys: ['võ lâm'] },
      ],
    }), original, row);
    expect(r.parts).toHaveLength(2);
    expect(r.warnings.filter(w => w.includes('KHÔNG thấy'))).toEqual([]);
  });

  it('AI trả 1 phần → ném lỗi, entry gốc giữ nguyên; rơi dòng → cảnh báo; keyword không key → cảnh báo', () => {
    expect(() => parseSplitResponse(JSON.stringify({ parts: [{ comment: 'A', content: 'x', mode: 'keyword', keys: [] }] }), original, row))
      .toThrow(/cần ≥ 2/);
    const dropped = parseSplitResponse(JSON.stringify({
      parts: [
        { comment: 'A', content: 'Tháng ba có lễ hội hoa đăng rực rỡ khắp thành.', mode: 'keyword', keys: ['hoa đăng'] },
        { comment: 'B', content: 'Chỉ còn một phần nhỏ.', mode: 'keyword', keys: [] },
      ],
    }), original, row);
    expect(dropped.warnings.some(w => w.includes('KHÔNG thấy'))).toBe(true);
    expect(dropped.warnings.some(w => w.includes('KHÔNG có key'))).toBe(true);
  });
});

// ═══ 7. (Rà soát 129+130) Chính sách Auto Creator học được cả bài học TÁCH ═══

describe('buildEjsPolicy — chưng cất split_entry + tính đủ token tiết kiệm', () => {
  it('dòng tách sinh nguyên tắc "không gộp" và tokensSaved gộp cả tokensDelta âm của tách', () => {
    const splitRow = mkRow({
      id: 's1', action: 'split_entry', name: 'Sự kiện trong năm', currentMode: 'constant',
      splitInto: [
        { name: 'Lễ hội hoa đăng', mode: 'keyword', criterion: 'tháng 3' },
        { name: 'Đại hội võ lâm', mode: 'keyword', criterion: 'tháng 7' },
      ],
      tokensDelta: -120,
    });
    const plan = { scope: '', rows: [splitRow], notes: [], warnings: [], estCalls: 2 };
    const policy = buildEjsPolicy(plan, new Set(['s1']), 'Card nguồn', 'tách bớt entry gộp', '2026-07-28T00:00:00Z');
    expect(policy.directive).toContain('KHÔNG GỘP');
    expect(policy.directive).toContain('Sự kiện trong năm');
    expect(policy.directive).toContain('tháng 3');
    expect(policy.summary.tokensSaved).toBe(120);
  });
});
