/**
 * (bug 162 phần 1 + mục 3.7) TỰ SỬA LỖI, VÀ CHỐT "TẮT TAY + activewi".
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần 1 — user: "sau khi tạo EJS xong, nếu có lỗi thì tool báo yêu cầu người dùng tự sửa tay —
 * nhưng với người mới, không phải ai cũng biết cách sửa, dễ làm hỏng cả Card khi cố tự sửa".
 * Bản cũ có vòng tự sửa nhưng: (a) mỗi vòng gửi lại prompt Y HỆT nên vòng 2 là bản sao vòng 1,
 * (b) một vòng không giảm được TỔNG số lỗi là dừng hẳn, (c) kết thúc bằng danh sách lỗi kỹ thuật.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeGoalPlan, type GoalAgentDomain, type AgentIssue, type AgentPlan } from '../../ai/goalAgent';
import {
  entriesNeedingLiveActivationCheck, liveActivationCheckHint, findOrphanConditionalEntries,
  type EjsPlanRow,
} from '../ejsPlanModel';

// ── Domain giả tối giản: mỗi item là một chuỗi, "lỗi" là item còn chứa chữ 'BAD' ──
interface Item { key: string; code: string }

const PLAN: AgentPlan = { scope: 's', steps: [{ id: 'a', title: 'A', requirement: 'r' }], estCalls: 1 };

function makeDomain(over: Partial<GoalAgentDomain<Item>> = {}): GoalAgentDomain<Item> {
  return {
    name: 'test',
    buildPlanMessages: () => [{ role: 'user', content: 'plan' }],
    parsePlan: () => ({ scope: 's', steps: [{ id: 'a', title: 'A', requirement: 'r' }], estCalls: 1 }),
    buildStepMessages: () => [{ role: 'user', content: 'step' }],
    parseStepOutput: (raw, step) => ({ key: step.id, code: raw }),
    validate: (items) => items.flatMap<AgentIssue>((it) =>
      it.code.includes('BAD') ? [{ level: 'error', code: 'bad', message: 'còn BAD', where: it.key }] : []),
    buildFixMessages: () => [{ role: 'user', content: 'fix' }],
    parseFixOutput: (raw, item) => ({ ...item, code: raw }),
    itemKey: (it) => it.key,
    ...over,
  };
}

describe('(bug 162 phần 1) vòng sửa phải THÍCH NGHI, không lặp lại y nguyên', () => {
  it('prompt sửa lần 2 biết đây là lần thử thứ mấy và lần trước đã thử gì', async () => {
    const seen: Array<{ round?: number; hasPrev: boolean }> = [];
    const domain = makeDomain({
      buildFixMessages: (_item, _issues, attempt) => {
        seen.push({ round: attempt?.round, hasPrev: !!attempt?.previousAttempt });
        return [{ role: 'user', content: 'fix' }];
      },
    });
    // Model thật nhận prompt khác thì trả text khác — nên mock trả bản KHÁC nhau mỗi lần mà vẫn
    // còn lỗi. (Trả y nguyên bản cũ là ca riêng, kiểm ở test "trả về đúng bản cũ" bên dưới.)
    let k = 0;
    const call = vi.fn(async () => `BAD lần ${++k}`);
    await executeGoalPlan(PLAN, domain, call, { maxFixRounds: 3 });

    expect(seen.length, 'phải thử sửa ít nhất 2 lần').toBeGreaterThanOrEqual(2);
    expect(seen[0].round).toBe(1);
    expect(seen[0].hasPrev, 'lần đầu chưa có bản trước').toBe(false);
    expect(seen[1].round, 'lần 2 phải biết mình là lần 2').toBe(2);
    expect(seen[1].hasPrev, 'lần 2 phải nhận được bản đã thử ở lần 1').toBe(true);
  });

  it('sửa được thì hết lỗi và ok = true', async () => {
    const domain = makeDomain();
    let n = 0;
    const call = vi.fn(async () => (++n === 1 ? 'BAD' : 'ĐÃ SỬA'));
    const r = await executeGoalPlan(PLAN, domain, call, { maxFixRounds: 2 });
    expect(r.ok).toBe(true);
    expect(r.items[0].code).toBe('ĐÃ SỬA');
  });
});

describe('(bug 162 phần 1) sửa không nổi thì BỎ mục đó, không trao việc cho user', () => {
  it('trả về đúng bản cũ cho mọi mục còn lỗi → dừng ngay, đừng đốt call vô ích', async () => {
    const domain = makeDomain();
    const call = vi.fn(async () => 'BAD');   // y nguyên mỗi lần
    const r = await executeGoalPlan(PLAN, domain, call, { maxFixRounds: 5 });
    expect(r.fixRounds, 'không được thử hết 5 vòng khi model lặp lại y nguyên').toBe(1);
    expect(r.log.join('\n')).toMatch(/trả về đúng bản cũ/);
  });

  it('domain cho phép bỏ → trả về danh sách đã bỏ, không còn lỗi', async () => {
    const domain = makeDomain({ canDropItems: true });
    const call = vi.fn(async () => 'BAD');
    const r = await executeGoalPlan(PLAN, domain, call, { maxFixRounds: 2 });
    expect(r.dropped, 'phải nêu rõ đã bỏ mục nào').toEqual(['a']);
    expect(r.items.length, 'mục lỗi bị gỡ khỏi kết quả').toBe(0);
    expect(r.ok, 'sau khi bỏ thì không còn lỗi treo').toBe(true);
    expect(r.log.join('\n')).toMatch(/bỏ 1 mục không tự sửa được/i);
  });

  it('domain KHÔNG cho bỏ → giữ nguyên hành vi cũ (báo lỗi còn lại)', async () => {
    const domain = makeDomain({ canDropItems: false });
    const call = vi.fn(async () => 'BAD');
    const r = await executeGoalPlan(PLAN, domain, call, { maxFixRounds: 1 });
    expect(r.ok).toBe(false);
    expect(r.dropped ?? []).toEqual([]);
    expect(r.items.length).toBe(1);
  });

  it('lỗi NỞ RA thì vẫn hoàn nguyên và dừng — không bỏ chốt chống "3 lỗi thành 500"', async () => {
    // validate đếm số chữ BAD → bản mới nhiều BAD hơn là nở ra.
    const domain = makeDomain({
      validate: (items) => items.flatMap<AgentIssue>((it) =>
        (it.code.match(/BAD/g) ?? []).map(() => ({ level: 'error' as const, code: 'bad', message: 'BAD', where: it.key }))),
    });
    let n = 0;
    const call = vi.fn(async () => (++n === 1 ? 'BAD' : 'BAD BAD BAD'));
    const r = await executeGoalPlan(PLAN, domain, call, { maxFixRounds: 3 });
    expect(r.items[0].code, 'phải giữ bản CŨ, không nhận bản làm lỗi nở ra').toBe('BAD');
    expect(r.log.join('\n')).toMatch(/NỞ từ 1 lên 3/);
  });
});

// ── Mục 3.7 ──
const row = (name: string, mode: EjsPlanRow['proposedMode']): EjsPlanRow => ({
  id: name, action: 'reclassify', target: 'lorebook', name,
  currentMode: 'constant', proposedMode: mode,
  proposal: 'p', reason: 'r', requirement: 'q',
});

describe('(bug 162 mục 3.7) entry TẮT TAY cũng phải có chỗ bật nó', () => {
  it('tắt tay mà không controller nào gọi activewi → bị bắt (bản cũ bỏ sót ca này)', () => {
    // Đúng hai entry user nêu: chuyển hẳn sang Tắt thủ công, dựa vào activewi.
    const orphans = findOrphanConditionalEntries(
      [row('Cấp Hiệu Trấn Minh', 'disabled'), row('Shard Collapse Mechanic', 'disabled')],
      ['<% /* controller không nhắc tên nào */ %>'],
    );
    expect(orphans).toEqual(['Cấp Hiệu Trấn Minh', 'Shard Collapse Mechanic']);
  });

  it('có controller bật đúng tên → không báo oan', () => {
    const orphans = findOrphanConditionalEntries(
      [row('Cấp Hiệu Trấn Minh', 'disabled')],
      [`<% await activewi('Cấp Hiệu Trấn Minh', true) %>`],
    );
    expect(orphans).toEqual([]);
  });

  it('nêu đúng entry cần user xác nhận trong chat thật', () => {
    const names = entriesNeedingLiveActivationCheck([row('A', 'disabled'), row('B', 'keyword')]);
    expect(names, 'chỉ entry TẮT TAY mới cần kiểm live').toEqual(['A']);
  });

  it('hướng dẫn kiểm phải cụ thể và NÓI RÕ tool không kiểm được phần nào', () => {
    const hint = liveActivationCheckHint(['A']).join('\n');
    expect(hint).toMatch(/chỉ chat thật mới xác nhận được/i);
    expect(hint).toContain('World Info');
    expect(hint, 'phải có phương án B khi activewi không thắng').toMatch(/kích hoạt theo từ khoá/);
  });

  it('không có entry tắt tay → im lặng, không làm ồn', () => {
    expect(liveActivationCheckHint([])).toEqual([]);
  });
});
