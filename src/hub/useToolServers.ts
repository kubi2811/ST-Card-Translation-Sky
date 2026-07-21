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
  /** auto=true khi do bấm tab (tự khởi động); false = user bấm nút Khởi động tường minh */
  start: (id: string, auto?: boolean) => Promise<void>;
  stop: (id: string) => Promise<boolean>;
  /** Lỗi thao tác gần nhất theo tool (start/stop fail) — UI hiện băng đỏ, tự tắt sau 8s */
  opError: Record<string, string | undefined>;
  clearOpError: (id: string) => void;
}

export const useToolServers = create<ToolServersState>((set, get) => ({
  status: {},
  pending: {},
  opError: {},
  clearOpError: (id) => set((s) => ({ opError: { ...s.opError, [id]: undefined } })),

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

  start: async (id, auto = false) => {
    const { pending, status } = get();
    if (pending[id]) return;
    set({ pending: { ...pending, [id]: 'start' }, opError: { ...get().opError, [id]: undefined } });
    // Optimistic: hiện "đang khởi động" NGAY để bấm tab là thấy phản hồi tức thì.
    const cur = status[id];
    if (cur) set({ status: { ...status, [id]: { ...cur, phase: 'starting', lastError: null, startedAt: Date.now() } } });
    let err = '';
    try {
      const res = await fetch('/api/tools/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, auto }),
      });
      // PHẢI đọc kết quả: start fail mà im lặng thì effect auto-start cứ 2-8s lại spawn
      // một lần nữa (loop vô hình, user không thấy lỗi gì).
      const data = await res.json().catch(() => null);
      if (data && data.ok === false) err = String(data.error || 'START_FAILED');
    } catch (e) { err = (e as Error)?.message || 'START_FAILED'; }
    set((s) => ({
      pending: { ...s.pending, [id]: undefined },
      opError: { ...s.opError, [id]: err || undefined },
      // Không có phản hồi tốt → gỡ trạng thái "starting" lạc quan để UI không quay mãi
      status: err && s.status[id] ? { ...s.status, [id]: { ...s.status[id], phase: 'error', lastError: err } } : s.status,
    }));
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
      // detail = lý do người-đọc-được từ free-ports (vd "port bị obs64 giữ, KHÔNG phải node")
      error = [data?.error, data?.detail].filter(Boolean).join(' — ');
    } catch (e: any) { error = e?.message || String(e); }
    set((s) => ({
      pending: { ...s.pending, [id]: undefined },
      opError: { ...s.opError, [id]: ok ? undefined : (error || 'STOP_FAILED') },
    }));
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
