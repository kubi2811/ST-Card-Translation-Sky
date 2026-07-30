/**
 * (bugNeedFix/168 mục 1) "Bảng kế hoạch bị mất khi F5… mỗi Card chỉ lưu dữ liệu của riêng mình,
 * kể cả sau khi F5 — không được mất, không được lẫn sang Card khác."
 *
 * Ba điều đó là ba nhóm test dưới đây. Test chạy trên chính store thật (zustand persist với
 * localStorage của jsdom), không mô phỏng lại logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Bộ test của repo chạy môi trường node (không jsdom) — dựng localStorage tối thiểu ngay đây
// thay vì kéo thêm phụ thuộc.
// HAI ĐIỀU KIỆN, thiếu cái nào là persist im lặng tắt hẳn:
//   • phải đặt TRƯỚC khi nạp store (persist chốt storage ngay lúc create);
//   • phải nằm trên `window`, không chỉ globalThis — zustand đọc đúng `window.localStorage`,
//     đọc hụt là nó bỏ qua middleware và chỉ console.warn.
const mem = new Map<string, string>();
const shim = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;
const g = globalThis as unknown as { localStorage: Storage; window: { localStorage: Storage } };
g.localStorage = shim;
g.window = { ...(g.window ?? {}), localStorage: shim };

const { useEjsStudioStore } = await import('../ejsStudioStore');
type EjsRichPlan = import('../../lib/ejs/ejsPlanModel').EjsRichPlan;

const CARD_A = 'uuid-card-a';
const CARD_B = 'uuid-card-b';

function plan(name: string): EjsRichPlan {
  return {
    scope: `kế hoạch của ${name}`,
    rows: [{
      id: 'r1', action: 'create_ejs', target: 'lorebook', name,
      currentMode: null, proposedMode: null, proposal: 'p', reason: 'r', requirement: 'req',
    }],
    notes: [], warnings: [], estCalls: 2,
  } as EjsRichPlan;
}

const st = () => useEjsStudioStore.getState();

beforeEach(() => {
  localStorage.clear();
  useEjsStudioStore.setState({
    goal: '', phase: 'idle', plan: null, decisions: {}, progress: [], drafts: [],
    error: null, undo: null, runSummary: null, beforeAfter: [], testValues: {},
    testSampleText: '', simReport: null, cardKey: '', planByProject: {},
  });
});

describe('Không được mất — kế hoạch sống qua F5', () => {
  it('ghi xuống localStorage dưới khoá riêng của app', () => {
    st().ensureCard(CARD_A);
    st().setGoal('làm thanh trạng thái');
    st().setPlan(plan('Entry A'), CARD_A);

    const raw = localStorage.getItem('tcs.ejsstudio.v1');
    expect(raw).toBeTruthy();
    expect(raw!).toContain('Entry A');
    expect(raw!).toContain('làm thanh trạng thái');
  });

  it('quyết định duyệt/từ chối user bấm tay cũng được giữ', () => {
    st().ensureCard(CARD_A);
    st().setPlan(plan('Entry A'), CARD_A);
    st().setDecision('r1', 'rejected');
    expect(localStorage.getItem('tcs.ejsstudio.v1')!).toContain('rejected');
  });

  it('KHÔNG giữ nhật ký chạy và undo — chúng trỏ vào id entry của phiên trước', () => {
    st().ensureCard(CARD_A);
    st().setPlan(plan('Entry A'), CARD_A);
    st().pushProgress('đã tạo entry #77');
    st().setUndo({ createdEntryIds: [77], changedEntries: [] });

    const raw = localStorage.getItem('tcs.ejsstudio.v1')!;
    expect(raw).not.toContain('đã tạo entry #77');
    expect(raw).not.toContain('createdEntryIds');
  });
});

describe('Không được lẫn — mỗi card một ngăn riêng', () => {
  it('đổi card: kế hoạch card A không tràn sang card B', () => {
    st().ensureCard(CARD_A);
    st().setGoal('yêu cầu của A');
    st().setPlan(plan('Entry A'), CARD_A);

    st().ensureCard(CARD_B);
    expect(st().plan).toBeNull();
    expect(st().goal).toBe('');
  });

  it('quay lại card A thì kế hoạch của A hiện lại nguyên vẹn', () => {
    st().ensureCard(CARD_A);
    st().setGoal('yêu cầu của A');
    st().setPlan(plan('Entry A'), CARD_A);
    st().setDecision('r1', 'rejected');

    st().ensureCard(CARD_B);
    st().setGoal('yêu cầu của B');
    st().setPlan(plan('Entry B'), CARD_B);

    st().ensureCard(CARD_A);
    expect(st().goal).toBe('yêu cầu của A');
    expect(st().plan?.rows[0].name).toBe('Entry A');
    expect(st().decisions.r1).toBe('rejected');

    // và B vẫn còn nguyên ngăn của nó.
    st().ensureCard(CARD_B);
    expect(st().plan?.rows[0].name).toBe('Entry B');
  });

  it('projectId null (app đang khởi động, chưa biết card) KHÔNG được xoá gì', () => {
    st().ensureCard(CARD_A);
    st().setPlan(plan('Entry A'), CARD_A);

    st().ensureCard(null);
    expect(st().plan?.rows[0].name).toBe('Entry A');
    expect(st().cardKey).toBe(CARD_A);
  });

  it('setPlan với cardKey null không làm mất khoá card đang gắn', () => {
    st().ensureCard(CARD_A);
    st().setPlan(plan('Entry A'), null);
    expect(st().cardKey).toBe(CARD_A);
  });
});

describe('Reset phải xoá thật', () => {
  it('"Làm lại từ đầu" xoá cả ngăn đã lưu — F5 xong không sống dậy', () => {
    st().ensureCard(CARD_A);
    st().setGoal('yêu cầu của A');
    st().setPlan(plan('Entry A'), CARD_A);

    st().reset();
    expect(st().plan).toBeNull();
    expect(st().planByProject[CARD_A]).toBeUndefined();
    expect(localStorage.getItem('tcs.ejsstudio.v1')!).not.toContain('Entry A');
  });

  it('reset card A không đụng ngăn của card B', () => {
    st().ensureCard(CARD_A);
    st().setPlan(plan('Entry A'), CARD_A);
    st().ensureCard(CARD_B);
    st().setPlan(plan('Entry B'), CARD_B);

    // Đang ở B mà reset thì chỉ B mất; ngăn của A vẫn còn.
    st().reset();
    expect(st().planByProject[CARD_A]?.plan?.rows[0].name).toBe('Entry A');
  });
});
