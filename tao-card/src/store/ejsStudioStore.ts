/**
 * src/store/ejsStudioStore.ts — (bug 126) GIỮ BẢNG KẾ HOẠCH EJS QUA CHUYỂN TAB.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Khi đổi qua các mục khác của tool thì bảng kế hoạch không tự reset và mất, mà nên có
 * thêm nút để reset lại ban đầu khi người dùng muốn làm lại từ đầu."
 *
 * Nguyên nhân bản cũ: toàn bộ kế hoạch nằm trong useState của EJSAgentPanel. Panel bị unmount
 * khi user rời tab, React vứt state, kế hoạch bay mất — mà lên kế hoạch là một call AI thật,
 * mất là mất tiền. Nay state nằm ở store ngoài vòng đời component; panel chỉ đọc/ghi.
 *
 * Cố ý KHÔNG persist xuống localStorage: kế hoạch gắn chặt với card đang mở, khôi phục lại ở
 * phiên sau mà card đã khác thì mọi tên entry trong bảng đều trỏ vào hư không — nguy hiểm hơn
 * là mất. Sống trong phiên là đủ đúng với điều user cần.
 */
import { create } from 'zustand';
import type { EjsRichPlan } from '../lib/ejs/ejsPlanModel';
import type { EjsDraft } from '../lib/ejs/ejsAgent';
import type { SimulationReport } from '../lib/ejs/ejsTestMode';

export type EjsPhase = 'idle' | 'planning' | 'review' | 'running' | 'done';

/** Quyết định của user cho một dòng kế hoạch. */
export type RowDecision = 'accepted' | 'rejected';

export interface EjsUndoInfo {
  createdEntryIds: number[];
  /** id entry → trạng thái enabled TRƯỚC khi ta đụng vào. */
  changedEntries: Array<{ id: number; enabled: boolean; constant: boolean; keys: string[] }>;
  /** (Goal 28/07) entry bị SỬA NỘI DUNG (vá tham chiếu getwi) — content cũ để hoàn tác. */
  changedContents?: Array<{ id: number; content: string }>;
  /**
   * (bugNeedFix/147) Trường Character Definition bị AI sửa (description/personality/…) — bản cũ
   * để hoàn tác. Sửa mô tả nhân vật là đụng vào văn người ta viết, phải lùi lại được.
   */
  charEdits?: Array<{ field: string; before: string }>;
}

/** (Goal 28/07) Một mục "trước/sau" — user xem được máy đã đổi GÌ, không chỉ tên. */
export interface BeforeAfterItem {
  name: string;
  kind: 'created' | 'reclassified' | 'split' | 'ref_patched';
  /** Trạng thái/nội dung TRƯỚC (rút gọn). */
  before: string;
  /** Trạng thái/nội dung SAU (rút gọn). */
  after: string;
}

interface EjsStudioState {
  goal: string;
  phase: EjsPhase;
  plan: EjsRichPlan | null;
  /** rowId → quyết định. Dòng chưa có mặt ở đây coi như ĐÃ ĐỒNG Ý (mặc định nhận). */
  decisions: Record<string, RowDecision>;
  progress: string[];
  drafts: EjsDraft[];
  error: string | null;
  undo: EjsUndoInfo | null;
  /**
   * (bugNeedFix/147) Kết quả THẬT của lượt chạy: đếm số thay đổi đã vào thẻ + lý do các mục
   * không vào được. Trước đây chạy xong là banner "✅ Hoàn thành" vô điều kiện, dù card có thể
   * không đổi một chữ nào — user chỉ phát hiện lúc mang thẻ qua SillyTavern.
   */
  runSummary: { writes: number; blockedReasons: string[] } | null;
  /** Card mà kế hoạch này thuộc về — đổi card thì kế hoạch cũ vô nghĩa. */
  cardKey: string;

  /** (Goal 28/07) Trước/sau từng đối tượng đã đổi trong lượt chạy. */
  beforeAfter: BeforeAfterItem[];
  /** (Goal 28/07) Test mode: giá trị biến user đang thử (path → chuỗi nhập). */
  testValues: Record<string, string>;
  /** (Goal 28/07) Test mode: đoạn chat mẫu để so từ khoá. */
  testSampleText: string;
  /** (Goal 28/07) Kết quả mô phỏng gần nhất. */
  simReport: SimulationReport | null;

  setGoal: (v: string) => void;
  setPhase: (p: EjsPhase) => void;
  setPlan: (p: EjsRichPlan | null, cardKey: string) => void;
  setDecision: (rowId: string, d: RowDecision) => void;
  setAllDecisions: (d: RowDecision) => void;
  /** (Goal 28/07) Từ chối/đồng ý CẢ NHÓM — chỉ đụng đúng các row trong nhóm, không lan. */
  setDecisions: (rowIds: string[], d: RowDecision) => void;
  setBeforeAfter: (items: BeforeAfterItem[]) => void;
  pushBeforeAfter: (item: BeforeAfterItem) => void;
  setTestValue: (path: string, v: string) => void;
  setTestSampleText: (v: string) => void;
  setSimReport: (r: SimulationReport | null) => void;
  pushProgress: (line: string) => void;
  setProgress: (lines: string[]) => void;
  setDrafts: (d: EjsDraft[]) => void;
  setError: (e: string | null) => void;
  setUndo: (u: EjsUndoInfo | null) => void;
  setRunSummary: (r: { writes: number; blockedReasons: string[] } | null) => void;
  /** Nút "Làm lại từ đầu" — xoá sạch, kể cả ô yêu cầu. */
  reset: () => void;
  /** Bỏ kết quả chạy nhưng GIỮ kế hoạch, để user chạy lại sau khi sửa lựa chọn. */
  resetRunOnly: () => void;
  /** Đổi card → kế hoạch cũ trỏ vào entry của card khác, phải bỏ. */
  ensureCard: (cardKey: string) => void;

  acceptedIds: () => Set<string>;
}

const EMPTY = {
  goal: '',
  phase: 'idle' as EjsPhase,
  plan: null,
  decisions: {} as Record<string, RowDecision>,
  progress: [] as string[],
  drafts: [] as EjsDraft[],
  error: null,
  undo: null,
  runSummary: null,
  beforeAfter: [] as BeforeAfterItem[],
  testValues: {} as Record<string, string>,
  testSampleText: '',
  simReport: null as SimulationReport | null,
};

export const useEjsStudioStore = create<EjsStudioState>((set, get) => ({
  ...EMPTY,
  cardKey: '',

  setGoal: (v) => set({ goal: v }),
  setPhase: (p) => set({ phase: p }),

  setPlan: (p, cardKey) => set({
    plan: p,
    cardKey,
    // Kế hoạch mới → mọi dòng bắt đầu ở trạng thái ĐỒNG Ý; user chỉ cần bấm những dòng muốn bỏ.
    decisions: {},
    drafts: [],
    undo: null,
  runSummary: null,
    error: null,
    beforeAfter: [],
    testValues: {},
    simReport: null,
  }),

  setDecision: (rowId, d) => set(s => ({ decisions: { ...s.decisions, [rowId]: d } })),

  setDecisions: (rowIds, d) => set(s => {
    const next = { ...s.decisions };
    for (const id of rowIds) next[id] = d;
    return { decisions: next };
  }),

  setBeforeAfter: (items) => set({ beforeAfter: items }),
  pushBeforeAfter: (item) => set(s => ({ beforeAfter: [...s.beforeAfter, item] })),
  setTestValue: (path, v) => set(s => ({ testValues: { ...s.testValues, [path]: v } })),
  setTestSampleText: (v) => set({ testSampleText: v }),
  setSimReport: (r) => set({ simReport: r }),

  setAllDecisions: (d) => set(s => {
    const next: Record<string, RowDecision> = {};
    for (const r of s.plan?.rows ?? []) next[r.id] = d;
    return { decisions: next };
  }),

  pushProgress: (line) => set(s => ({ progress: [...s.progress, line] })),
  setProgress: (lines) => set({ progress: lines }),
  setDrafts: (d) => set({ drafts: d }),
  setError: (e) => set({ error: e }),
  setUndo: (u) => set({ undo: u }),
  setRunSummary: (r) => set({ runSummary: r }),

  reset: () => set({ ...EMPTY }),

  resetRunOnly: () => set({
    drafts: [], progress: [], undo: null, error: null, phase: 'review',
    beforeAfter: [], simReport: null,
  }),

  ensureCard: (cardKey) => {
    if (get().cardKey && get().cardKey !== cardKey) set({ ...EMPTY, cardKey });
    else if (!get().cardKey) set({ cardKey });
  },

  acceptedIds: () => {
    const { plan, decisions } = get();
    const out = new Set<string>();
    for (const r of plan?.rows ?? []) {
      if (decisions[r.id] !== 'rejected') out.add(r.id);   // mặc định nhận
    }
    return out;
  },
}));
