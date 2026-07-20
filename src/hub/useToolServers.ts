// ─── Store trạng thái server tool con (client, cho rail + màn chờ iframe) ───
// Zustand store RIÊNG, tách khỏi src/store.ts để không đụng gì tới state Dịch Card.
// Poll /api/tools/status: 2s khi có tool đang khởi động / thao tác dở, 8s khi yên —
// đủ nhạy lúc chờ server lên mà không spam dev server lúc nhàn rỗi.
import { create } from 'zustand';
import { TOOL_SERVERS, type ToolStatus } from './toolCatalog';

interface ToolServersState {
  status: Record<string, ToolStatus>;
  /** Thao tác đang bay (start/stop) — để disable nút + poll nhanh */
  pending: Record<string, 'start' | 'stop' | undefined>;
  refresh: () => Promise<void>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<boolean>;
}

export const useToolServers = create<ToolServersState>((set, get) => ({
  status: {},
  pending: {},

  refresh: async () => {
    try {
      const res = await fetch('/api/tools/status', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.ok || !Array.isArray(data.tools)) return;
      const map: Record<string, ToolStatus> = {};
      for (const t of data.tools as ToolStatus[]) map[t.id] = t;
      set({ status: map });
    } catch { /* hub dev server đang restart — lần poll sau sẽ tự khỏi */ }
  },

  start: async (id) => {
    const { pending, status } = get();
    if (pending[id]) return;
    set({ pending: { ...pending, [id]: 'start' } });
    // Optimistic: hiện "đang khởi động" NGAY để bấm tab là thấy phản hồi tức thì.
    const cur = status[id];
    if (cur) set({ status: { ...status, [id]: { ...cur, phase: 'starting', lastError: null, startedAt: Date.now() } } });
    try {
      await fetch('/api/tools/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch { /* status poll sẽ phản ánh thực tế */ }
    set((s) => ({ pending: { ...s.pending, [id]: undefined } }));
    void get().refresh();
  },

  stop: async (id) => {
    const { pending } = get();
    if (pending[id]) return false;
    set({ pending: { ...pending, [id]: 'stop' } });
    let ok = false;
    let error = '';
    try {
      const res = await fetch('/api/tools/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      ok = !!data?.ok;
      error = data?.error || '';
    } catch (e: any) { error = e?.message || String(e); }
    set((s) => {
      const cur = s.status[id];
      return {
        pending: { ...s.pending, [id]: undefined },
        status: cur && !ok ? { ...s.status, [id]: { ...cur, lastError: error || cur.lastError } } : s.status,
      };
    });
    void get().refresh();
    return ok;
  },
}));

/** id có trong catalog → tab này có server để quản lý; không có (novalcard, flow native) → luôn "sáng". */
export const hasToolServer = (id: string | undefined): boolean =>
  !!id && TOOL_SERVERS.some((t) => t.id === id);

// ─── Poll nền: 1 interval module-level, tick 2s, thưa lại 8s khi mọi thứ yên ───
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastFetch = 0;

export function ensureToolServerPolling(): void {
  if (pollTimer) return;
  void useToolServers.getState().refresh();
  lastFetch = Date.now();
  pollTimer = setInterval(() => {
    const { status, pending } = useToolServers.getState();
    const busy =
      Object.values(pending).some(Boolean) ||
      Object.values(status).some((t) => t.phase === 'starting');
    const interval = busy ? 2000 : 8000;
    if (Date.now() - lastFetch >= interval) {
      lastFetch = Date.now();
      void useToolServers.getState().refresh();
    }
  }, 2000);
}
