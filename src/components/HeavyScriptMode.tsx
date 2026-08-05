/**
 * ─── Script Nặng (Chia Phần) ───
 * (User 2026) Bundle Vue/webpack 3M+ ký tự dán nguyên khối → AI đọc thiếu/cắt cụt, treo UI.
 * Component này CHIA an toàn (utils/heavyScript) → dịch TUẦN TỰ từng phần qua translateText
 * (surgical, giữ code/biến), tiến trình "phần i/N", DỪNG/TIẾP đúng phần dang dở (resume qua
 * localStorage), dịch lại từng phần lỗi, GHÉP 1:1, dùng CHUNG glossary xuyên các phần.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { safeSetItem } from '../utils/safeStorage';
import { translateText, setExtraProviders } from '../utils/apiClient';
import { splitHeavyScript, mergeHeavyParts, HEAVY_SCRIPT_DEFAULT_THRESHOLD, type HeavyPart } from '../utils/heavyScript';
import { Layers, Play, Square, RefreshCw, Loader2, Check, X, ChevronDown, ChevronRight, Copy } from 'lucide-react';

type PartStatus = 'pending' | 'translating' | 'done' | 'error';

interface Props {
  /** Nội dung script gốc (từ ô dán của ExternalLinkTab). */
  source: string;
  /** Trả bản ghép hoàn chỉnh ra ngoài để hiển thị/áp dụng. */
  onMerged: (merged: string) => void;
}

/** Chữ ký nhẹ của source để biết resume có còn khớp không (đổi source → bỏ tiến trình cũ). */
function sourceSig(s: string): string {
  return `${s.length}:${s.slice(0, 64)}:${s.slice(-64)}`;
}

const LS_KEY = 'heavy-script-progress';

export default function HeavyScriptMode({ source, onMerged }: Props) {
  // (bug 213) selector hẹp — destructure trần từ useStore() là subscribe TOÀN store: mọi
  // set() (addLog/updateField suốt lượt dịch) đều kéo component này re-render dù chẳng liên quan.
  const proxy = useStore((s) => s.proxy);
  const providers = useStore((s) => s.providers);
  const translationConfig = useStore((s) => s.translationConfig);
  const addToast = useStore((s) => s.addToast);
  const ui = useUi();

  const [threshold, setThreshold] = useState(() => {
    const v = Number(localStorage.getItem('heavy-script-threshold'));
    return v > 0 ? v : HEAVY_SCRIPT_DEFAULT_THRESHOLD;
  });
  useEffect(() => { safeSetItem('heavy-script-threshold', String(threshold)); }, [threshold]);

  const [parts, setParts] = useState<HeavyPart[]>([]);
  const [results, setResults] = useState<(string | null)[]>([]);
  const [status, setStatus] = useState<PartStatus[]>([]);
  const [running, setRunning] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [expanded, setExpanded] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);

  const isHeavy = source.length > threshold;

  // Khôi phục tiến trình cũ khi source khớp chữ ký (resume qua reload).
  useEffect(() => {
    if (parts.length > 0) return;
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved && saved.sig === sourceSig(source) && Array.isArray(saved.results)) {
        const p = splitHeavyScript(source);
        if (p.length === saved.results.length) {
          setParts(p);
          setResults(saved.results);
          setStatus(saved.results.map((r: string | null) => (r ? 'done' : 'pending')));
        }
      }
    } catch { /* bỏ qua */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const persist = useCallback((res: (string | null)[]) => {
    try { safeSetItem(LS_KEY, JSON.stringify({ sig: sourceSig(source), results: res })); } catch { /* quota */ }
  }, [source]);

  /** Chia phần (xem trước danh sách trước khi dịch). */
  const doSplit = () => {
    const p = splitHeavyScript(source);
    setParts(p);
    setResults(new Array(p.length).fill(null));
    setStatus(new Array(p.length).fill('pending'));
    setActiveIdx(-1);
    addToast('success', fmt(ui.hsSplitDone, { n: p.length }));
  };

  /** Dịch 1 phần (dùng chung glossary). Trả bản dịch hoặc ném lỗi. */
  const translateOnePart = async (part: HeavyPart, signal: AbortSignal): Promise<string> => {
    setExtraProviders(providers); // bơm đủ pool → xoay lane như Dịch Card
    // fieldName chứa "replaceString" ⇒ translateText đi nhánh SURGICAL (giữ code/biến, chỉ dịch text hiển thị)
    return translateText(
      part.text,
      `HeavyScript replaceString phần ${part.index}/${parts.length}`,
      proxy,
      translationConfig.targetLanguage,
      translationConfig.sourceLanguage || 'auto',
      translationConfig.surgicalPrompt || undefined,
      undefined,
      signal,
      undefined,
      translationConfig.glossary, // GLOSSARY CHUNG xuyên tất cả các phần
    );
  };

  /** Dịch tuần tự từ phần đầu tiên chưa done (resume). */
  const runAll = async () => {
    if (parts.length === 0) { doSplit(); return; }
    setRunning(true);
    stopRef.current = false;
    const res = [...results];
    const stt = [...status];
    for (let i = 0; i < parts.length; i++) {
      if (stopRef.current) break;
      if (res[i]) continue; // đã dịch → bỏ qua (resume)
      setActiveIdx(i);
      stt[i] = 'translating'; setStatus([...stt]);
      const ctrl = new AbortController(); abortRef.current = ctrl;
      try {
        res[i] = await translateOnePart(parts[i], ctrl.signal);
        stt[i] = 'done';
      } catch (err: any) {
        if (ctrl.signal.aborted || stopRef.current) { stt[i] = res[i] ? 'done' : 'pending'; setStatus([...stt]); break; }
        stt[i] = 'error';
        addToast('error', fmt(ui.hsPartErr, { i: i + 1, msg: err?.message || String(err) }));
      }
      setResults([...res]); setStatus([...stt]); persist(res);
      onMerged(mergeHeavyParts(parts, res));
    }
    setActiveIdx(-1);
    setRunning(false);
    abortRef.current = null;
    if (res.every(r => r)) addToast('success', ui.hsAllDone);
  };

  const stop = () => { stopRef.current = true; abortRef.current?.abort('Dừng'); setRunning(false); };

  /** Dịch lại riêng 1 phần (không đụng các phần khác). */
  const retryOne = async (i: number) => {
    if (running) return;
    setRunning(true);
    setActiveIdx(i);
    const stt = [...status]; stt[i] = 'translating'; setStatus(stt);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const t = await translateOnePart(parts[i], ctrl.signal);
      const res = [...results]; res[i] = t; setResults(res);
      const s2 = [...status]; s2[i] = 'done'; setStatus(s2);
      persist(res); onMerged(mergeHeavyParts(parts, res));
    } catch (err: any) {
      if (!ctrl.signal.aborted) {
        const s2 = [...status]; s2[i] = 'error'; setStatus(s2);
        addToast('error', fmt(ui.hsPartErr, { i: i + 1, msg: err?.message || String(err) }));
      }
    } finally {
      setActiveIdx(-1); setRunning(false); abortRef.current = null;
    }
  };

  const doneCount = results.filter(Boolean).length;
  const totalChars = useMemo(() => parts.reduce((s, p) => s + p.chars, 0), [parts]);

  if (!isHeavy && parts.length === 0) return null; // dưới ngưỡng + chưa chia → ẩn hẳn

  return (
    <div style={{ padding: '14px 16px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-warning, #f59e0b)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Layers size={16} color="var(--accent-warning, #f59e0b)" />
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent-warning, #f59e0b)' }}>{ui.hsTitle}</h4>
        <button onClick={() => setExpanded(e => !e)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {/* Cảnh báo tự động khi vượt ngưỡng */}
      {isHeavy && parts.length === 0 && (
        <div style={{ fontSize: '0.72rem', lineHeight: 1.5, color: 'var(--text-secondary)', background: 'rgba(245,158,11,0.08)', padding: '8px 10px', borderRadius: 6, marginBottom: 8 }}>
          ⚠ {fmt(ui.hsWarn, { chars: source.length.toLocaleString(), threshold: threshold.toLocaleString() })}
        </div>
      )}

      {expanded && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{ui.hsThreshold}</label>
            <input type="number" value={threshold} min={10000} step={10000}
              onChange={e => setThreshold(Math.max(10000, Number(e.target.value) || HEAVY_SCRIPT_DEFAULT_THRESHOLD))}
              style={{ width: 110, padding: '3px 6px', fontSize: '0.72rem', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />

            {parts.length === 0 ? (
              <button className="btn btn-primary btn-sm" onClick={doSplit} disabled={!source.trim()}>
                <Layers size={13} /> {ui.hsSplitBtn}
              </button>
            ) : (
              <>
                {!running ? (
                  <button className="btn btn-primary btn-sm" onClick={runAll}>
                    <Play size={13} /> {doneCount > 0 && doneCount < parts.length ? ui.hsResume : ui.hsTranslateAll}
                  </button>
                ) : (
                  <button className="btn btn-sm" style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }} onClick={stop}>
                    <Square size={13} /> {ui.hsStop}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={doSplit} disabled={running} title={ui.hsResplitTip}>
                  <RefreshCw size={12} /> {ui.hsResplit}
                </button>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {running && activeIdx >= 0
                    ? fmt(ui.hsProgressActive, { i: activeIdx + 1, n: parts.length })
                    : fmt(ui.hsProgress, { done: doneCount, n: parts.length })}
                  {' · '}{totalChars.toLocaleString()} {ui.hsChars}
                </span>
              </>
            )}
          </div>

          {/* Danh sách phần (xem trước + trạng thái + dịch lại riêng) */}
          {parts.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {parts.map((p, i) => {
                const st = status[i] || 'pending';
                const color = st === 'done' ? '#4ade80' : st === 'error' ? '#f87171' : st === 'translating' ? '#f59e0b' : 'var(--text-muted)';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4, border: `1px solid ${st === 'translating' ? 'rgba(245,158,11,0.4)' : 'var(--border-subtle)'}` }}>
                    <span style={{ color, width: 16, textAlign: 'center' }}>
                      {st === 'done' ? <Check size={12} /> : st === 'error' ? <X size={12} /> : st === 'translating' ? <Loader2 size={12} className="spin" /> : '•'}
                    </span>
                    <span style={{ fontWeight: 600, minWidth: 64 }}>{fmt(ui.hsPartLabel, { i: p.index, n: parts.length })}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{p.chars.toLocaleString()} {ui.hsChars}</span>
                    <button onClick={() => retryOne(i)} disabled={running}
                      title={ui.hsRetryOne}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: running ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: running ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.68rem' }}>
                      <RefreshCw size={11} /> {ui.hsRetryOne}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {parts.length > 0 && doneCount === parts.length && (
            <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={13} /> {fmt(ui.hsMerged, { n: parts.length })}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                onClick={() => { navigator.clipboard.writeText(mergeHeavyParts(parts, results)); addToast('success', ui.hsCopied); }}>
                <Copy size={12} /> {ui.hsCopyMerged}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
