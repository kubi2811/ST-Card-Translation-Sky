/* ─── Live AI Call Monitor ───
 * A tiny pub/sub registry that tracks every in-flight AI request so the UI can
 * show, in real time: which model is translating which entry, how many requests
 * are running concurrently (threads), and which API key each one is using.
 *
 * callProvider() (apiClient.ts) is the single chokepoint for all AI calls, so it
 * registers each call here on start and removes it on finish. React components
 * subscribe via useSyncExternalStore.
 */

export interface ActiveCall {
  id: string;
  /** The model actually used for this call (after primary/secondary routing). */
  model: string;
  /** Provider used for this call (openai / anthropic / google / custom). */
  provider?: string;
  /** Provider CONFIG id (default / <uuid>) — để map đúng dòng lane ở panel (đếm call đang chạy). */
  providerId?: string;
  /** Human label for which API key is used, e.g. "Key #2". */
  keyLabel: string;
  /** What this call is translating, e.g. "lorebook[3].content" or "MVU vars 26-50". */
  label: string;
  startedAt: number;
}

type Listener = () => void;

const _active = new Map<string, ActiveCall>();
const _listeners = new Set<Listener>();
let _snapshot: ActiveCall[] = [];
let _completed = 0;
/** Peak number of concurrent in-flight calls observed this run. */
let _peakConcurrency = 0;

function _emit() {
  _snapshot = Array.from(_active.values());
  if (_active.size > _peakConcurrency) _peakConcurrency = _active.size;
  _listeners.forEach((l) => l());
}

/* ─── Token thật (đọc từ usage/usageMetadata của response) ───
 * Gom theo lane (providerId|model) cho panel + tổng cho log cuối run. Provider nào không
 * trả usage (proxy strip mất) thì callProvider ước lượng từ ký tự và đánh dấu estimated —
 * số hiển thị kèm "~" để user biết là ước chứ không phải đo. */

export interface LaneTokenStats {
  providerId: string;
  model: string;
  calls: number;
  input: number;
  output: number;
  /** Số call phải ƯỚC LƯỢNG token từ ký tự (API không trả usage). */
  estimatedCalls: number;
}

export interface TokenTotals {
  calls: number;
  input: number;
  output: number;
  estimatedCalls: number;
  lanes: LaneTokenStats[];
}

const _tokenLanes = new Map<string, LaneTokenStats>();
let _tokenSnapshot: TokenTotals = { calls: 0, input: 0, output: 0, estimatedCalls: 0, lanes: [] };

function _rebuildTokenSnapshot() {
  const lanes = Array.from(_tokenLanes.values());
  _tokenSnapshot = {
    calls: lanes.reduce((s, l) => s + l.calls, 0),
    input: lanes.reduce((s, l) => s + l.input, 0),
    output: lanes.reduce((s, l) => s + l.output, 0),
    estimatedCalls: lanes.reduce((s, l) => s + l.estimatedCalls, 0),
    lanes,
  };
}

/**
 * Ước lượng token khi API không trả usage: CJK ≈ 1 token/ký tự, còn lại ≈ 4 ký tự/token.
 * Thô nhưng đủ để tổng không "thủng lỗ" — luôn đánh dấu estimated khi dùng.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

export const CallMonitor = {
  start(call: ActiveCall) {
    _active.set(call.id, call);
    _emit();
  },
  end(id: string) {
    if (_active.delete(id)) {
      _completed++;
      _emit();
    }
  },
  /** Ghi token cho 1 call thành công (callProvider gọi sau khi có kết quả). */
  recordTokens(rec: { providerId?: string; model: string; input: number; output: number; estimated: boolean }) {
    const key = `${rec.providerId || 'default'}|${rec.model}`;
    let lane = _tokenLanes.get(key);
    if (!lane) {
      lane = { providerId: rec.providerId || 'default', model: rec.model, calls: 0, input: 0, output: 0, estimatedCalls: 0 };
      _tokenLanes.set(key, lane);
    }
    lane.calls++;
    lane.input += Math.max(0, rec.input | 0);
    lane.output += Math.max(0, rec.output | 0);
    if (rec.estimated) lane.estimatedCalls++;
    _rebuildTokenSnapshot();
    _emit();
  },
  getTokenTotals(): TokenTotals {
    return _tokenSnapshot;
  },
  /** Reset counters at the start of a translation run (active calls are left intact). */
  reset() {
    _completed = 0;
    _peakConcurrency = _active.size;
    _tokenLanes.clear();
    _rebuildTokenSnapshot();
    _emit();
  },
  subscribe(listener: Listener): () => void {
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  },
  /** Stable snapshot for useSyncExternalStore — same reference until the next change. */
  getSnapshot(): ActiveCall[] {
    return _snapshot;
  },
  getCompleted(): number {
    return _completed;
  },
  getPeakConcurrency(): number {
    return _peakConcurrency;
  },
};
