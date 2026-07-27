// (Goal 101.2) Miền EJS của goalAgent — validator bám schema + sửa máy móc + đủ vòng với mock AI.
import { describe, it, expect } from 'vitest';
import { createEjsDomain, type EjsDraft } from '../ejsAgent';
import { executeGoalPlan, type AgentCallFn, type AgentPlan } from '../../ai/goalAgent';
import type { MVUZODSchema } from '../../../types/mvuzod.types';
import type { LorebookEntry } from '../../../types';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    { path: '/Người Chơi', type: 'object', label: 'Người Chơi', constraints: {}, defaultValue: {},
      children: [
        { path: '/Người Chơi/Cảnh Giới', type: 'string', label: 'Cảnh Giới', constraints: {}, defaultValue: 'Luyện Khí' },
        { path: '/Người Chơi/HP', type: 'number', label: 'HP', constraints: {}, defaultValue: 100 },
      ] },
  ],
} as unknown as MVUZODSchema;

const ENTRIES: LorebookEntry[] = [
  { id: 1, keys: ['bí cảnh'], secondary_keys: [], comment: 'Bí cảnh Kim Đan', content: 'x',
    constant: false, selective: false, insertion_order: 0, enabled: true, position: 'before_char',
    use_regex: false, extensions: {} as LorebookEntry['extensions'] },
];

const ctx = { schema: SCHEMA, entries: ENTRIES, characterName: 'Test' };

const draft = (over: Partial<EjsDraft>): EjsDraft => ({
  stepId: 's1', entryComment: 'EJS: Bộ điều khiển', strategy: 'activate',
  entryActions: [], explanation: '',
  code: `@@preprocessing\n<%_ var cg = getvar('stat_data.Người Chơi.Cảnh Giới', { defaults: 'Luyện Khí' }); _%>`,
  ...over,
});

describe('ejsAgent — parsePlan', () => {
  // (bug 126) HỢP ĐỒNG ĐỔI: kế hoạch giờ là BẢNG VIỆC `rows` (mỗi dòng một entry, có hiện
  // trạng/đề xuất/lý do) chứ không còn `steps` văn xuôi; và TRẦN 6 BƯỚC ĐÃ BỎ vì user muốn
  // ra kế hoạch cho cả card trong một lần thay vì phải chia nhỏ nhiều lượt.
  it('không còn chặn trần 6 bước — 9 dòng ra đủ 9', () => {
    const domain = createEjsDomain(ctx);
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`, action: 'create_ejs', target: 'lorebook',
      name: `Khối ${i}`, proposal: 'p', reason: 'r', requirement: `r${i}`,
    }));
    const plan = domain.parsePlan(JSON.stringify({ scope: 'ok', rows }));
    expect(plan.steps).toHaveLength(9);
  });

  it('dòng thiếu requirement không sinh bước (nhưng vẫn là dòng duyệt được trong bảng)', () => {
    const domain = createEjsDomain(ctx);
    const plan = domain.parsePlan(JSON.stringify({
      scope: 's',
      rows: [
        { id: 'a', action: 'reclassify', target: 'lorebook', name: 'Chỉ đổi chế độ', proposal: 'p', reason: 'r' },
        { id: 'b', action: 'create_ejs', target: 'lorebook', name: 'Cần sinh code', proposal: 'p', reason: 'r', requirement: 'r' },
      ],
    }));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toBe('b');
  });
});

describe('ejsAgent — validate', () => {
  const domain = createEjsDomain(ctx);

  it('code chuẩn bám schema → sạch', () => {
    expect(domain.validate([draft({})])).toEqual([]);
  });

  it('biến KHÔNG có trong schema → error ejs-var-unknown (đồng biến Phase 100)', () => {
    const bad = draft({ code: `@@preprocessing\n<%_ var x = getvar('stat_data.Nhân Vật.Sức Mạnh', { defaults: 1 }); _%>` });
    const issues = domain.validate([bad]);
    expect(issues.some((i) => i.code === 'ejs-var-unknown' && i.level === 'error')).toBe(true);
  });

  it('this.variables → error ejs-syntax (từ ejsParser)', () => {
    const bad = draft({ code: `@@preprocessing\n<%_ var x = this.variables.hp; _%>` });
    expect(domain.validate([bad]).some((i) => i.code === 'ejs-syntax')).toBe(true);
  });

  it('tag không cân → error; thiếu @@preprocessing → error riêng', () => {
    const bad = draft({ code: `@@preprocessing\n<%_ var a = 1;` });
    expect(domain.validate([bad]).some((i) => i.code === 'ejs-syntax')).toBe(true);
    const noDir = draft({ code: `<%_ var a = getvar('stat_data.Người Chơi.HP', { defaults: 1 }); _%>` });
    expect(domain.validate([noDir]).some((i) => i.code === 'ejs-missing-directive')).toBe(true);
  });

  // (bug 126) Kiểm trùng tên nay nằm trong bộ soát XUNG ĐỘT chung (ejs-name-conflict), soát
  // cả với entry EJS đã có sẵn trong card chứ không chỉ giữa các bước mới.
  it('2 bước trùng tên entry → error ejs-name-conflict', () => {
    const issues = domain.validate([draft({}), draft({ stepId: 's2' })]);
    expect(issues.some((i) => i.code === 'ejs-name-conflict')).toBe(true);
  });
});

describe('ejsAgent — autofixDeterministic (sửa máy móc không tốn call)', () => {
  const domain = createEjsDomain(ctx);

  it('tự thêm @@preprocessing + đổi tên trùng', () => {
    const items = [
      draft({ code: `<%_ var a = getvar('stat_data.Người Chơi.HP', { defaults: 1 }); _%>` }),
      draft({ stepId: 's2' }),
      draft({ stepId: 's3' }),
    ];
    const issues = domain.validate(items);
    const r = domain.autofixDeterministic!(items, issues);
    expect(r.items[0].code.startsWith('@@preprocessing')).toBe(true);
    const names = r.items.map((d) => d.entryComment);
    expect(new Set(names).size).toBe(3);
    expect(domain.validate(r.items)).toEqual([]);
  });
});

describe('ejsAgent — đủ vòng qua khung goalAgent với mock AI', () => {
  it('bước sinh code lệch schema → vòng sửa AI vá đúng biến → ok', async () => {
    const domain = createEjsDomain(ctx);
    const plan: AgentPlan = {
      scope: 'test', estCalls: 2,
      steps: [{ id: 's1', title: 'Controller', requirement: 'làm controller' }],
    };
    const badResp = JSON.stringify({
      explanation: 'v1', strategy: 'activate',
      controller: { entryComment: 'EJS: Controller', code: `@@preprocessing\n<%_ var x = getvar('stat_data.SAI.Đường', { defaults: 1 }); _%>` },
    });
    const goodResp = JSON.stringify({
      explanation: 'đã sửa', strategy: 'activate',
      controller: { entryComment: 'EJS: Controller', code: `@@preprocessing\n<%_ var x = getvar('stat_data.Người Chơi.HP', { defaults: 100 }); _%>` },
    });
    let fixCalls = 0;
    const call: AgentCallFn = async (messages) => {
      const last = messages[messages.length - 1].content;
      if (last.includes('NHIỆM VỤ BƯỚC NÀY')) return badResp;
      fixCalls++;
      return goodResp;
    };
    const r = await executeGoalPlan(plan, domain, call);
    expect(r.ok).toBe(true);
    expect(fixCalls).toBe(1);
    expect(r.items[0].code).toContain('Người Chơi.HP');
    // tên entry giữ nguyên sau sửa (không phá liên kết)
    expect(r.items[0].entryComment).toBe('EJS: Controller');
  });
});
