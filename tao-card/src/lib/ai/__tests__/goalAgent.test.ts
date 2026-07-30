// (Goal 101.1) Khung agent dùng chung — kiểm bằng domain giả, không đốt API.
// Trọng tâm: luật HỘI TỤ học từ nợ #42 — vòng sửa làm lỗi nở ra phải bị hoàn nguyên.
import { describe, it, expect } from 'vitest';
import {
  planGoal, executeGoalPlan,
  type AgentCallFn, type AgentIssue, type AgentPlan, type GoalAgentDomain,
} from '../goalAgent';

interface ToyItem { key: string; value: string }

/** Domain đồ chơi: item "lỗi" khi value chứa 'BAD'. */
function makeToyDomain(overrides: Partial<GoalAgentDomain<ToyItem>> = {}): GoalAgentDomain<ToyItem> {
  return {
    name: 'Toy',
    buildPlanMessages: (goal) => [{ role: 'user', content: `plan:${goal}` }],
    parsePlan: (raw) => JSON.parse(raw) as AgentPlan,
    buildStepMessages: (step) => [{ role: 'user', content: `step:${step.id}` }],
    parseStepOutput: (raw, step) => ({ key: step.id, value: raw }),
    validate: (items): AgentIssue[] =>
      items.filter((it) => it.value.includes('BAD'))
        .map((it) => ({ level: 'error', code: 'toy-bad', message: 'giá trị BAD', where: it.key })),
    buildFixMessages: (item) => [{ role: 'user', content: `fix:${item.key}` }],
    parseFixOutput: (raw, item) => ({ ...item, value: raw }),
    itemKey: (it) => it.key,
    ...overrides,
  };
}

/** Mock AI: map prompt → câu trả lời (theo thứ tự gọi cho phép mô phỏng vòng sửa). */
function makeCall(script: Record<string, string[] | string>): { call: AgentCallFn; calls: string[] } {
  const used: Record<string, number> = {};
  const calls: string[] = [];
  const call: AgentCallFn = async (messages) => {
    const prompt = messages[messages.length - 1].content;
    calls.push(prompt);
    const entry = script[prompt];
    if (entry === undefined) throw new Error(`mock thiếu câu trả lời cho: ${prompt}`);
    if (typeof entry === 'string') return entry;
    const idx = Math.min(used[prompt] ?? 0, entry.length - 1);
    used[prompt] = (used[prompt] ?? 0) + 1;
    return entry[idx];
  };
  return { call, calls };
}

const PLAN_2_STEPS = JSON.stringify({
  scope: 'làm 2 việc',
  steps: [
    { id: 's1', title: 'Việc 1', requirement: 'r1' },
    { id: 's2', title: 'Việc 2', requirement: 'r2' },
  ],
  estCalls: 3,
});

describe('planGoal', () => {
  it('trả kế hoạch parse được từ domain', async () => {
    const { call } = makeCall({ 'plan:mục tiêu': PLAN_2_STEPS });
    const plan = await planGoal('mục tiêu', makeToyDomain(), call);
    expect(plan.steps).toHaveLength(2);
    expect(plan.scope).toBe('làm 2 việc');
  });

  it('kế hoạch 0 bước → báo lỗi rõ thay vì chạy rỗng', async () => {
    const { call } = makeCall({ 'plan:x': JSON.stringify({ scope: 's', steps: [], estCalls: 1 }) });
    await expect(planGoal('x', makeToyDomain(), call)).rejects.toThrow(/không có bước/);
  });
});

describe('executeGoalPlan — luồng chuẩn', () => {
  it('mọi bước sạch → ok, không tốn vòng sửa', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    const { call } = makeCall({ 'step:s1': 'ok1', 'step:s2': 'ok2' });
    const r = await executeGoalPlan(plan, makeToyDomain(), call);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.value)).toEqual(['ok1', 'ok2']);
    expect(r.fixRounds).toBe(0);
  });

  it('bước lỗi → vòng sửa AI vá được → ok', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    const { call, calls } = makeCall({
      'step:s1': 'ok1',
      'step:s2': 'BAD output',
      'fix:s2': 'đã sửa sạch',
    });
    const r = await executeGoalPlan(plan, makeToyDomain(), call);
    expect(r.ok).toBe(true);
    expect(r.items[1].value).toBe('đã sửa sạch');
    expect(r.fixRounds).toBe(1);
    // chỉ item lỗi bị gửi đi sửa — item sạch không tốn call
    expect(calls.filter((c) => c.startsWith('fix:'))).toEqual(['fix:s2']);
  });
});

describe('executeGoalPlan — luật hội tụ #42', () => {
  it('vòng sửa làm lỗi NỞ RA → hoàn nguyên bản trước + dừng, không lấy bản tệ hơn', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    // s2 lỗi; AI "sửa" trả về bản còn tệ hơn làm CẢ s1 cũng hỏng (mô phỏng 3→500)
    const domain = makeToyDomain({
      parseFixOutput: () => ({ key: 's2', value: 'BAD BAD' }),
      validate: (items): AgentIssue[] => {
        const issues: AgentIssue[] = [];
        for (const it of items) {
          const n = (it.value.match(/BAD/g) ?? []).length;
          for (let i = 0; i < n; i++) issues.push({ level: 'error', code: 'toy-bad', message: 'BAD', where: it.key });
        }
        return issues;
      },
    });
    const { call } = makeCall({ 'step:s1': 'ok1', 'step:s2': 'BAD', 'fix:s2': 'không quan trọng' });
    const r = await executeGoalPlan(plan, domain, call);
    expect(r.ok).toBe(false);
    // giữ BẢN CŨ (1 lỗi), không nhận bản 2 lỗi
    expect(r.items[1].value).toBe('BAD');
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(1);
    expect(r.log.some((l) => l.includes('hoàn nguyên'))).toBe(true);
  });

  // (bug 162 phần 1) HỢP ĐỒNG NÀY ĐÃ ĐỔI CÓ CHỦ Ý — ghi lại để sau này không ai tưởng là hồi quy.
  // Luật cũ: một vòng không GIẢM được tổng số lỗi ⇒ dừng ngay (tiết kiệm call).
  // Vấn đề: vòng 2 mới là vòng ĐẦU TIÊN prompt sửa có phản hồi (bản đã thử + lỗi vẫn còn), nên dừng
  // ở đó là chặn đúng lúc nó bắt đầu có cơ hội khá lên — và đó là lý do tính năng luôn kết thúc
  // bằng "còn N lỗi, tự sửa tay đi", việc mà user nói người mới không làm được.
  // Luật mới: chỉ dừng khi model trả về Y NGUYÊN bản cũ cho mọi mục còn lỗi (lúc đó thử thêm thật
  // sự vô ích). Chốt "lỗi NỞ RA ⇒ hoàn nguyên + dừng" vẫn giữ nguyên — xem test ngay phía trên.
  it('trả về Y NGUYÊN bản cũ → dừng sau 1 vòng, không đốt hết maxFixRounds', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    const { call, calls } = makeCall({ 'step:s1': 'ok', 'step:s2': 'BAD', 'fix:s2': 'BAD' });
    const r = await executeGoalPlan(plan, makeToyDomain(), call, { maxFixRounds: 3 });
    expect(r.ok).toBe(false);
    expect(calls.filter((c) => c === 'fix:s2')).toHaveLength(1);
    expect(r.log.some((l) => l.includes('trả về đúng bản cũ'))).toBe(true);
  });

  it('bản mới KHÁC nhưng chưa hết lỗi → vẫn thử tiếp (đây là chỗ "tự sửa" thật sự diễn ra)', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    // Mỗi lần sửa trả một bản khác — đúng như model thật khi prompt đã đổi.
    let k = 0;
    const call: AgentCallFn = async (msgs) => {
      const text = msgs.map((m) => m.content).join('\n');
      if (text.includes('plan')) return PLAN_2_STEPS;
      if (text.includes('fix')) return `BAD khác ${++k}`;
      return text.includes('s1') ? 'ok' : 'BAD';
    };
    const r = await executeGoalPlan(plan, makeToyDomain(), call, { maxFixRounds: 3 });
    expect(r.fixRounds, 'phải thử hết số vòng cho phép thay vì bỏ ngang').toBe(3);
    expect(r.ok).toBe(false);
  });

  it('autofixDeterministic sửa được hết → không tốn call AI sửa nào', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    const domain = makeToyDomain({
      autofixDeterministic: (items) => ({
        items: items.map((it) => ({ ...it, value: it.value.replace(/BAD/g, 'OK') })),
        fixed: ['thay BAD bằng OK'],
      }),
    });
    const { call, calls } = makeCall({ 'step:s1': 'ok', 'step:s2': 'BAD' });
    const r = await executeGoalPlan(plan, domain, call);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.startsWith('fix:'))).toBe(false);
  });
});

describe('executeGoalPlan — dừng theo yêu cầu', () => {
  it('signal abort giữa chừng → ném AbortError, không chạy tiếp bước sau', async () => {
    const plan = JSON.parse(PLAN_2_STEPS) as AgentPlan;
    const ac = new AbortController();
    const call: AgentCallFn = async (messages) => {
      const prompt = messages[messages.length - 1].content;
      if (prompt === 'step:s1') { ac.abort(); return 'ok1'; }
      throw new Error('không được gọi tới đây');
    };
    await expect(executeGoalPlan(plan, makeToyDomain(), call, { signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
