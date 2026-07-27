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

export type EjsPhase = 'idle' | 'planning' | 'review' | 'running' | 'done';

/** Quyết định của user cho một dòng kế hoạch. */
export type RowDecision = 'accepted' | 'rejected';

export interface EjsUndoInfo {
  createdEntryIds: number[];
  /** id entry → trạng thái enabled TRƯỚC khi ta đụng vào. */
  changedEntries: Array<{ id: number; enabled: boolean; constant: boolean; keys: string[] }>;
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
  /** Card mà kế hoạch này thuộc về — đổi card thì kế hoạch cũ vô nghĩa. */
  cardKey: string;

  setGoal: (v: string) => void;
  setPhase: (p: EjsPhase) => void;
  setPlan: (p: EjsRichPlan | null, cardKey: string) => void;
  setDecision: (rowId: string, d: RowDecision) => void;
  setAllDecisions: (d: RowDecision) => void;
  pushProgress: (line: string) => void;
  setProgress: (lines: string[]) => void;
  setDrafts: (d: EjsDraft[]) => void;
  setError: (e: string | null) => void;
  setUndo: (u: EjsUndoInfo | null) => void;
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
    error: null,
  }),

  setDecision: (rowId, d) => set(s => ({ decisions: { ...s.decisions, [rowId]: d } })),

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

  reset: () => set({ ...EMPTY }),

  resetRunOnly: () => set({ drafts: [], progress: [], undo: null, error: null, phase: 'review' }),

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
