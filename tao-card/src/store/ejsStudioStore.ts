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
 * ─── (bugNeedFix/168 mục 1) NAY CÓ PERSIST, THEO TỪNG CARD ───
 * User: "Bảng kế hoạch bị mất khi F5… mỗi Card chỉ lưu dữ liệu của riêng mình, kể cả sau khi F5
 * — không được mất, không được lẫn sang Card khác."
 *
 * Lý lẽ cũ ở trên (không persist vì kế hoạch trỏ vào entry của card khác) chỉ đúng khi CHỈ CÓ
 * MỘT ngăn dùng chung. Giải đúng là ngăn riêng theo card — y hệt bug 155 đã làm cho Auto Creator:
 * `planByProject[projectId]`. Mỗi card lấy đúng ngăn của mình, không đụng ngăn card khác, nên
 * vừa sống qua F5 vừa không thể lẫn.
 *
 * Khoá là projectId (uuid), KHÔNG phải tên card: mọi card mới đều tên "New Character", khoá theo
 * tên là ba card mới dùng chung một ngăn.
 *
 * Hai thứ cố ý KHÔNG lưu: nhật ký chạy (drafts/progress/beforeAfter) và thông tin hoàn tác
 * (undo). Undo trỏ vào id entry của phiên trước; khôi phục nó sau F5 là mời user bấm hoàn tác
 * lên những entry có thể đã khác — hỏng hơn là không có.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

/**
 * Phần kế hoạch ĐÁNG GIỮ QUA F5 của một card.
 * Chỉ gồm thứ tốn tiền hoặc tốn công gõ: yêu cầu, bảng kế hoạch (một call AI thật), và các
 * quyết định duyệt/từ chối user đã bấm tay. Nhật ký chạy và undo cố ý bỏ ngoài.
 */
export interface PersistedPlan {
  goal: string;
  plan: EjsRichPlan | null;
  decisions: Record<string, RowDecision>;
  /** 'review' hoặc 'idle' — hai pha chạy dở không bao giờ được khôi phục (xem rehydrate). */
  phase: EjsPhase;
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
  /**
   * (bug 168 mục 1) Ngăn riêng của TỪNG card: projectId → phần đáng giữ của kế hoạch.
   * Đây là thứ được persist; `plan`/`goal`/`decisions` ở trên chỉ là bản đang mở.
   */
  planByProject: Record<string, PersistedPlan>;

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
  setPlan: (p: EjsRichPlan | null, cardKey: string | null) => void;
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
  /**
   * Gắn studio vào ĐÚNG card đang mở: cất bảng kế hoạch của card cũ vào ngăn của nó, rồi lấy
   * ngăn của card mới ra (chưa có thì trống). Truyền null (lúc app còn đang khởi động, chưa
   * biết card nào) thì KHÔNG làm gì — không thì mọi lần bootstrap là một lần xoá kế hoạch.
   */
  ensureCard: (projectId: string | null) => void;

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

/** Rút phần đáng giữ từ state hiện tại. */
const snapshot = (s: EjsStudioState): PersistedPlan => ({
  goal: s.goal,
  plan: s.plan,
  decisions: s.decisions,
  // Kế hoạch đã lên xong thì để user về đúng chỗ đang duyệt; còn lại coi như chưa bắt đầu.
  phase: s.plan ? 'review' : 'idle',
});

export const useEjsStudioStore = create<EjsStudioState>()(persist((set, get) => ({
  ...EMPTY,
  cardKey: '',
  planByProject: {},

  setGoal: (v) => set({ goal: v }),
  setPhase: (p) => set({ phase: p }),

  setPlan: (p, cardKey) => set(s => ({
    plan: p,
    // cardKey null nghĩa là chưa biết card nào (chưa lưu project) — giữ khoá cũ, đừng xoá.
    cardKey: cardKey || s.cardKey,
    // Kế hoạch mới → mọi dòng bắt đầu ở trạng thái ĐỒNG Ý; user chỉ cần bấm những dòng muốn bỏ.
    decisions: {},
    drafts: [],
    undo: null,
  runSummary: null,
    error: null,
    beforeAfter: [],
    testValues: {},
    simReport: null,
  })),

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

  // "Làm lại từ đầu" phải xoá cả NGĂN ĐÃ LƯU của card này — không thì F5 xong kế hoạch vừa
  // xoá lại hiện ra, đúng kiểu bug khó chịu nhất.
  reset: () => set(s => {
    const next = { ...s.planByProject };
    if (s.cardKey) delete next[s.cardKey];
    return { ...EMPTY, planByProject: next };
  }),

  resetRunOnly: () => set({
    drafts: [], progress: [], undo: null, error: null, phase: 'review',
    beforeAfter: [], simReport: null,
  }),

  ensureCard: (projectId) => set(s => {
    // Chưa biết card nào (app đang khởi động) ⇒ giữ nguyên, tuyệt đối không xoá.
    if (!projectId) return {};
    if (s.cardKey === projectId) return {};

    // Cất bảng của card cũ vào ngăn của nó trước khi rời đi.
    const saved = s.cardKey && (s.plan || s.goal.trim())
      ? { ...s.planByProject, [s.cardKey]: snapshot(s) }
      : s.planByProject;

    const mine = saved[projectId];
    return {
      ...EMPTY,
      planByProject: saved,
      cardKey: projectId,
      ...(mine ? { goal: mine.goal, plan: mine.plan, decisions: mine.decisions, phase: mine.phase } : {}),
    };
  }),

  acceptedIds: () => {
    const { plan, decisions } = get();
    const out = new Set<string>();
    for (const r of plan?.rows ?? []) {
      if (decisions[r.id] !== 'rejected') out.add(r.id);   // mặc định nhận
    }
    return out;
  },
}), {
  name: 'tcs.ejsstudio.v1',
  // Chỉ giữ thứ tốn tiền/tốn công: bảng kế hoạch + yêu cầu + quyết định, theo TỪNG card.
  // Nhật ký chạy, bản nháp, undo, kết quả mô phỏng đều là phù du — lưu chúng chỉ tạo ảo giác
  // rằng lượt chạy trước vẫn còn nguyên trong khi thẻ có thể đã đổi.
  partialize: (s) => ({
    planByProject: s.planByProject,
    cardKey: s.cardKey,
    goal: s.goal,
    plan: s.plan,
    decisions: s.decisions,
    phase: s.phase,
  }),
  onRehydrateStorage: () => (s) => {
    // F5 GIỮA LÚC ĐANG CHẠY: không còn call nào bay nữa, nhưng pha vẫn là 'planning'/'running'
    // ⇒ nút bị khoá vĩnh viễn, user tưởng treo. Hạ về đúng chỗ dùng được.
    if (!s) return;
    if (s.phase === 'planning' || s.phase === 'running') {
      s.phase = s.plan ? 'review' : 'idle';
    }
  },
}));
