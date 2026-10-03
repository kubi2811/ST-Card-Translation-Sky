/**
 * src/utils/heavyScriptJob.ts — (bug 239) LƯỢT DỊCH "SCRIPT NẶNG" CHẠY NỀN, KHÔNG PHỤ THUỘC PANEL.
 * ─────────────────────────────────────────────────────────────────────────────
 * User (gogopikachu): "khi thoát regex manager để về với màn hình chính thì lệnh dịch sẽ mặc định
 * ngừng, còn khi dịch link ngoài với t/h phải chia chunk (trên 100k chữ) thì tiến độ không thể quan
 * sát được… cũng không thể kiểm tra tình trạng chunk, độ match, số lượng chữ Hán còn lại."
 *
 * GỐC RỄ: vòng dịch từng phần trước đây nằm TRONG component HeavyScriptMode — danh sách phần, kết
 * quả, trạng thái đều là useState. Đóng Regex Manager là component unmount:
 *   • vòng lặp async vẫn chạy mù phía sau, nhưng mọi setState rơi vào hư không;
 *   • bản ghép (onMerged) đổ vào state của ExternalLinkTab — cũng đã unmount ⇒ mất;
 *   • mở lại thì component mới dựng lại từ localStorage, KHÔNG biết vòng cũ còn sống, hiện nút
 *     "Dịch tiếp" — bấm vào là hai vòng cùng dịch một file, ghi đè lên nhau.
 * Với người dùng, mọi thứ trông y như "thoát ra là dừng".
 *
 * Ở đây vòng dịch và toàn bộ trạng thái chuyển ra một store cấp module. Panel chỉ còn là chỗ NHÌN
 * và BẤM: đóng/mở bao nhiêu lần cũng thấy đúng một lượt đang chạy, đúng phần đang dịch.
 */
import { create } from 'zustand';
import { useStore } from '../store';
import { translateText, setExtraProviders } from './apiClient';
import { splitHeavyScript, mergeHeavyParts, type HeavyPart } from './heavyScript';
import { countResidualHan } from './residualCjkScan';
import { auditChunks } from './chunkAudit';
import { safeSetItem } from './safeStorage';
import { acquireKeepAlive, releaseKeepAlive } from './keepAlive';
import { noteActivity } from './translateActivity';

export type HeavyPartStatus = 'pending' | 'translating' | 'done' | 'error';

export interface HeavyPartInfo {
  status: HeavyPartStatus;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Chữ Hán trong bản GỐC của phần (đã bỏ link + CSS giữ nguyên). */
  srcHan: number;
  /** Chữ Hán CÒN LẠI trong bản dịch — thước đo "dịch sót". */
  leftHan?: number;
  /** Độ dài bản dịch / bản gốc. */
  ratio?: number;
  /** Lời nhận xét của bộ soi chunk (cắt cụt, phình, chưa dịch…). Rỗng = khớp. */
  verdict?: string;
}

/** Tiền tố `fieldName` của mọi lượt gọi thuộc chế độ này — nhật ký tiến độ lọc theo nó.
 *  Phải chứa "replaceString" để translateText đi nhánh SURGICAL (giữ code/biến). */
export const HEAVY_FIELD_PREFIX = 'HeavyScript replaceString';
const LS_KEY = 'heavy-script-progress';

/** Chữ ký nhẹ của source để biết tiến trình cũ có còn khớp không (đổi source → bỏ). */
export function heavySourceSig(s: string): string {
  return `${s.length}:${s.slice(0, 64)}:${s.slice(-64)}`;
}

function measurePart(src: string, out: string | null): Pick<HeavyPartInfo, 'leftHan' | 'ratio' | 'verdict'> {
  if (!out) return {};
  const css = useStore.getState().translationConfig.cssCjkHandling || 'preserve';
  const audit = auditChunks([src], [out]);
  return {
    leftHan: countResidualHan(out, css),
    ratio: src.length > 0 ? out.length / src.length : 1,
    verdict: audit.issues[0]?.detail,
  };
}

interface HeavyJobState {
  sig: string;
  parts: HeavyPart[];
  results: (string | null)[];
  info: HeavyPartInfo[];
  running: boolean;
  activeIdx: number;
  startedAt?: number;
  /** Bản ghép hiện tại (phần chưa dịch giữ nguyên gốc). */
  merged: string;

  /** Chia phần mới cho `source` (xoá tiến trình cũ). */
  split: (source: string) => number;
  /** Nạp lại tiến trình đã lưu nếu khớp `source`. Không đụng gì khi đang chạy. */
  restore: (source: string) => void;
  runAll: () => Promise<void>;
  retryOne: (i: number) => Promise<void>;
  stop: () => void;
  /** Bỏ hẳn lượt hiện tại (khi người dùng đổi sang script khác). */
  reset: () => void;
}

let abortCtrl: AbortController | null = null;
let stopFlag = false;
/** Token chống hai vòng chạy cùng lúc: vòng nào không còn khớp token thì tự thoát. */
let runToken = 0;

function persist(sig: string, results: (string | null)[]): void {
  try { safeSetItem(LS_KEY, JSON.stringify({ sig, results })); } catch { /* quota */ }
}

function infoFor(parts: HeavyPart[], results: (string | null)[]): HeavyPartInfo[] {
  const css = useStore.getState().translationConfig.cssCjkHandling || 'preserve';
  return parts.map((p, i) => ({
    status: results[i] ? 'done' : 'pending',
    srcHan: countResidualHan(p.text, css),
    ...measurePart(p.text, results[i]),
  }));
}

/** Dịch một phần — dùng chung glossary + từ điển MVU của thẻ, như các field khác. */
async function translatePart(part: HeavyPart, total: number, signal: AbortSignal): Promise<string> {
  const st = useStore.getState();
  setExtraProviders(st.providers); // bơm đủ pool → xoay lane như Dịch Card
  const cfg = st.translationConfig;
  return translateText(
    part.text,
    `${HEAVY_FIELD_PREFIX} phần ${part.index}/${total}`,
    st.proxy,
    cfg.targetLanguage,
    cfg.sourceLanguage || 'auto',
    cfg.surgicalPrompt || undefined,
    undefined,
    signal,
    undefined,
    cfg.glossary, // GLOSSARY CHUNG xuyên tất cả các phần
    undefined,
    undefined,
    // (bug 238) Trước đây KHÔNG truyền từ điển MVU: tên biến trong link ngoài bị dịch tự do,
    // lệch với tên đã thống nhất trong thẻ. Bật đồng bộ MVU thì áp như mọi field khác.
    cfg.enableMvuSync ? cfg.mvuDictionary : undefined,
  );
}

export const useHeavyScriptJob = create<HeavyJobState>((set, get) => {
  const updatePart = (i: number, patch: Partial<HeavyPartInfo>) => {
    const info = get().info.slice();
    info[i] = { ...info[i], ...patch };
    set({ info });
  };

  const translateIndex = async (i: number, token: number): Promise<'ok' | 'error' | 'stopped'> => {
    const { parts } = get();
    const part = parts[i];
    updatePart(i, { status: 'translating', error: undefined, startedAt: Date.now(), finishedAt: undefined });
    set({ activeIdx: i });
    noteActivity(HEAVY_FIELD_PREFIX, 'info', `Bắt đầu phần ${part.index}/${parts.length} (${part.chars.toLocaleString()} ký tự).`);
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    try {
      const out = await translatePart(part, parts.length, ctrl.signal);
      if (token !== runToken) return 'stopped';
      const results = get().results.slice();
      results[i] = out;
      const m = measurePart(part.text, out);
      set({ results, merged: mergeHeavyParts(parts, results) });
      updatePart(i, { status: 'done', finishedAt: Date.now(), ...m });
      persist(get().sig, results);
      noteActivity(HEAVY_FIELD_PREFIX, m.leftHan ? 'warning' : 'success',
        `Xong phần ${part.index}/${parts.length}`
        + (m.leftHan ? ` — còn ${m.leftHan} chữ Hán chưa dịch` : ' — sạch chữ Hán')
        + (m.verdict ? ` · ${m.verdict}` : '') + '.');
      return 'ok';
    } catch (err: any) {
      if (ctrl.signal.aborted || stopFlag || token !== runToken) {
        updatePart(i, { status: get().results[i] ? 'done' : 'pending', startedAt: undefined });
        return 'stopped';
      }
      const msg = err?.message || String(err);
      updatePart(i, { status: 'error', error: msg, finishedAt: Date.now() });
      noteActivity(HEAVY_FIELD_PREFIX, 'error', `Phần ${part.index}/${parts.length} lỗi: ${msg}`);
      useStore.getState().addToast('error', `Script nặng — phần ${part.index} lỗi: ${msg}`);
      return 'error';
    } finally {
      if (abortCtrl === ctrl) abortCtrl = null;
    }
  };

  /** Giữ tab sống trong lúc chạy nền (bug 241: giữ theo TÊN — xong việc này không tắt việc khác). */
  const withKeepAlive = async (fn: () => Promise<void>) => {
    acquireKeepAlive('heavy-script');
    try { await fn(); } finally { releaseKeepAlive('heavy-script'); }
  };

  return {
    sig: '',
    parts: [],
    results: [],
    info: [],
    running: false,
    activeIdx: -1,
    merged: '',

    split: (source) => {
      if (get().running) return get().parts.length;
      const parts = splitHeavyScript(source);
      const results = new Array(parts.length).fill(null);
      set({ sig: heavySourceSig(source), parts, results, info: infoFor(parts, results), activeIdx: -1, merged: source, startedAt: undefined });
      persist(heavySourceSig(source), results);
      return parts.length;
    },

    restore: (source) => {
      const st = get();
      const sig = heavySourceSig(source);
      if (st.running || st.sig === sig) return;
      try {
        const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (saved && saved.sig === sig && Array.isArray(saved.results)) {
          const parts = splitHeavyScript(source);
          if (parts.length === saved.results.length) {
            set({ sig, parts, results: saved.results, info: infoFor(parts, saved.results), activeIdx: -1, merged: mergeHeavyParts(parts, saved.results) });
          }
        }
      } catch { /* bỏ qua */ }
    },

    runAll: async () => {
      if (get().running || get().parts.length === 0) return;
      const token = ++runToken;
      stopFlag = false;
      set({ running: true, startedAt: Date.now() });
      const total = get().parts.length;
      const todo = get().results.filter(r => !r).length;
      noteActivity(HEAVY_FIELD_PREFIX, 'info', todo < total
        ? `Dịch tiếp: còn ${todo}/${total} phần.`
        : `Bắt đầu dịch ${total} phần.`);
      await withKeepAlive(async () => {
        for (let i = 0; i < total; i++) {
          if (stopFlag || token !== runToken) break;
          if (get().results[i]) continue; // đã dịch → bỏ qua (resume)
          const r = await translateIndex(i, token);
          if (r === 'stopped') break;
        }
      });
      if (token !== runToken) return;
      set({ running: false, activeIdx: -1 });
      const left = get().results.filter(r => !r).length;
      if (stopFlag) {
        noteActivity(HEAVY_FIELD_PREFIX, 'warning', `Đã dừng — còn ${left} phần chưa dịch, bấm "Dịch tiếp" để chạy nốt.`);
      } else if (left === 0) {
        const han = get().info.reduce((s, x) => s + (x.leftHan || 0), 0);
        noteActivity(HEAVY_FIELD_PREFIX, han ? 'warning' : 'success',
          `Đủ ${total}/${total} phần — đã ghép.` + (han ? ` Còn tổng ${han} chữ Hán: bấm "Dịch lại" ở phần còn sót.` : ''));
        useStore.getState().addToast('success', 'Script nặng: đã dịch xong và ghép đủ các phần.');
      } else {
        noteActivity(HEAVY_FIELD_PREFIX, 'error', `Xong lượt nhưng ${left} phần lỗi — bấm "Dịch lại" ở từng phần.`);
      }
    },

    retryOne: async (i) => {
      if (get().running || !get().parts[i]) return;
      const token = ++runToken;
      stopFlag = false;
      set({ running: true });
      await withKeepAlive(async () => { await translateIndex(i, token); });
      if (token !== runToken) return;
      set({ running: false, activeIdx: -1 });
    },

    stop: () => {
      stopFlag = true;
      abortCtrl?.abort('Dừng');
      runToken++;
      const info = get().info.map((x, i) => x.status === 'translating'
        ? { ...x, status: (get().results[i] ? 'done' : 'pending') as HeavyPartStatus, startedAt: undefined }
        : x);
      set({ running: false, activeIdx: -1, info });
      noteActivity(HEAVY_FIELD_PREFIX, 'warning', 'Đã dừng theo yêu cầu.');
    },

    reset: () => {
      if (get().running) get().stop();
      set({ sig: '', parts: [], results: [], info: [], activeIdx: -1, merged: '', startedAt: undefined });
    },
  };
});
