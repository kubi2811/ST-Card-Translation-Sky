/**
 * src/store/gameStudioStore.ts — Phiên chat Game UI Studio
 * ──────────────────────────────────────────────────────────────────────────────
 * Zustand module-level → sống qua chuyển tab MVUZOD (không mất khi component unmount).
 * Nút Dừng theo chuẩn dự án: setStopped bật cờ VÀ abort() call đang chạy (như batchRunStore).
 */
import { create } from 'zustand';
import type { DraftScript, ValidationReport } from '../lib/mvuzod/gameUiValidator';

export type StudioRole = 'user' | 'assistant' | 'system-note';

export interface StudioActionSummary {
  kind: 'write' | 'edit' | 'regex';
  label: string;   // "✍️ status_bar 14.2KB", "✏️ 3 chỗ sửa", "🔧 1 regex"
}

export interface StudioMessage {
  id: string;
  role: StudioRole;
  content: string;
  actions?: StudioActionSummary[];
  tone?: 'ok' | 'error' | 'info';  // cho system-note (xanh/đỏ)
}

export interface StudioComponent {
  name: string;
  html: string;
  updatedAt: number;
}

export type StudioPhase = 'idle' | 'thinking' | 'validating' | 'done';

interface GameStudioState {
  messages: StudioMessage[];
  components: Record<string, StudioComponent>;
  regexDraft: DraftScript[];
  sampleOutput: string;
  validation: ValidationReport | null;
  /** Schema/initvar context đã dùng để sinh regexDraft. Khác context hiện tại thì cấm Apply. */
  draftContextKey: string | null;
  phase: StudioPhase;
  status: string | null;          // dòng trạng thái tạm ("AI đang nghĩ (lượt 2)…")
  abort: AbortController | null;
  stopped: boolean;

  appendMessage: (msg: StudioMessage) => void;
  upsertComponent: (id: string, name: string, html: string) => void;
  /** (bug #42) Thay TOÀN BỘ components một phát — dùng cho hoàn nguyên khi bản sửa làm lỗi nở ra. */
  setComponentsBulk: (components: Record<string, StudioComponent>) => void;
  removeComponent: (id: string) => void;
  setRegexDraft: (scripts: DraftScript[]) => void;
  setSampleOutput: (s: string) => void;
  setValidation: (r: ValidationReport | null) => void;
  setDraftContextKey: (key: string | null) => void;
  setPhase: (p: StudioPhase) => void;
  setStatus: (s: string | null) => void;
  beginTurn: () => AbortController;  // arm AbortController mới, clear stopped
  stop: () => void;                  // bật cờ + abort in-flight
  resetSession: () => void;
}

export const useGameStudioStore = create<GameStudioState>((set, get) => ({
  messages: [],
  components: {},
  regexDraft: [],
  sampleOutput: '',
  validation: null,
  draftContextKey: null,
  phase: 'idle',
  status: null,
  abort: null,
  stopped: false,

  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  upsertComponent: (id, name, html) =>
    set((s) => ({ components: { ...s.components, [id]: { name, html, updatedAt: Date.now() } } })),
  setComponentsBulk: (components) => set({ components: { ...components } }),
  removeComponent: (id) =>
    set((s) => { const c = { ...s.components }; delete c[id]; return { components: c }; }),
  setRegexDraft: (scripts) => set({ regexDraft: scripts }),
  setSampleOutput: (sampleOutput) => set({ sampleOutput }),
  setValidation: (validation) => set({ validation }),
  setDraftContextKey: (draftContextKey) => set({ draftContextKey }),
  setPhase: (phase) => set({ phase }),
  setStatus: (status) => set({ status }),
  beginTurn: () => {
    const ac = new AbortController();
    set({ abort: ac, stopped: false, phase: 'thinking' });
    return ac;
  },
  stop: () => {
    set({ stopped: true });
    get().abort?.abort(new DOMException('Người dùng đã dừng', 'AbortError'));
    set({ phase: 'idle', status: null });
  },
  resetSession: () =>
    set({ messages: [], components: {}, regexDraft: [], sampleOutput: '', validation: null, draftContextKey: null, phase: 'idle', status: null, abort: null, stopped: false }),
}));
