// ─── Tab native "Dịch Script" (Phase B) ───
// Dịch bundle JS TavernHelper (1-3MB) Trung→Việt ngay trong app chính: dùng chung pool
// provider/API key + engine đa luồng của Dịch Card, không cần cấu hình lại gì.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import ActiveCallsPanel from '../components/ActiveCallsPanel';
import type { GlossaryEntry } from '../types/card';
import type { CJKToken } from '../utils/surgical';
import { runScriptGlossaryPhase } from './glossaryPhase';
import { runScriptTranslation, scanStats, extractInWorker, beautifyInWorker, type WorkerStats } from './pipeline';
import type { ScriptProgress, ScriptTranslateReport, ScriptTranslateOptions } from './types';
import {
  loadOpts, saveOpts, loadGlossary, saveGlossary,
  sourceSig, saveTokenMap, loadTokenMap, deleteTokenMap, type TokenMap,
} from './persist';
import { isTranslatableToken } from './tokenBatcher';

export default function ScriptTranslateFlow() {
  const ui = useUi();
  const proxy = useStore((s) => s.proxy);
  const providers = useStore((s) => s.providers);
  const tc = useStore((s) => s.translationConfig);

  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('');
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [opts, setOpts] = useState<ScriptTranslateOptions>(() => loadOpts());
  const [glossary, setGlossary] = useState<GlossaryEntry[]>(() => loadGlossary());
  const [glossaryBusy, setGlossaryBusy] = useState(false);
  const [progress, setProgress] = useState<ScriptProgress>({ stage: 'idle' });
  const [report, setReport] = useState<ScriptTranslateReport | null>(null);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resumeInfo, setResumeInfo] = useState<number>(0); // số token khôi phục từ cache

  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const tokensRef = useRef<CJKToken[]>([]);
  const lastSaveRef = useRef(0);

  useEffect(() => { saveOpts(opts); }, [opts]);
  useEffect(() => { saveGlossary(glossary); }, [glossary]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const deps = useMemo(() => ({
    proxy, providers, glossary,
    nameStyle: tc.nameStyle, fandomMode: tc.fandomMode, fandomName: tc.fandomName || '',
  }), [proxy, providers, glossary, tc.nameStyle, tc.fandomMode, tc.fandomName]);

  // ─── Nạp file / dán ───
  const acceptSource = useCallback(async (text: string, name: string) => {
    setSource(text);
    setFileName(name);
    setReport(null);
    setOutput('');
    setErrorMsg('');
    setResumeInfo(0);
    try {
      setStats(await scanStats(text));
      const saved = await loadTokenMap(sourceSig(text));
      if (saved) setResumeInfo(Object.keys(saved).length);
    } catch { setStats(null); }
  }, []);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    void acceptSource(text, f.name);
  }, [acceptSource]);

  // ─── Pha 0 ───
  const runPha0 = useCallback(async () => {
    if (!source || glossaryBusy) return;
    setGlossaryBusy(true);
    setErrorMsg('');
    try {
      let working = source;
      if (opts.beautify && stats?.looksMinified) {
        try { working = await beautifyInWorker(source); } catch { /* dịch bản gốc */ }
      }
      const { tokens } = await extractInWorker(working);
      const entries = await runScriptGlossaryPhase(tokens, deps);
      setGlossary((prev) => {
        const seen = new Set(prev.map((g) => g.source));
        return [...prev, ...entries.filter((e) => !seen.has(e.source))];
      });
    } catch (e) {
      setErrorMsg((e as Error)?.message || String(e));
    } finally {
      setGlossaryBusy(false);
    }
  }, [source, opts.beautify, stats, deps, glossaryBusy]);

  // ─── Chạy dịch ───
  const persistTokens = useCallback((sig: string, tokens?: CJKToken[]) => {
    if (tokens) tokensRef.current = tokens; // pipeline đẩy token qua callback từng lô
    const now = Date.now();
    if (now - lastSaveRef.current < 4000) return; // throttle 4s — map MB, đừng dội fs
    lastSaveRef.current = now;
    const map: TokenMap = {};
    for (const t of tokensRef.current) if (t.translated) map[t.id] = t.translated;
    void saveTokenMap(sig, map);
  }, []);

  const handleRun = useCallback(async () => {
    if (!source || running) return;
    setRunning(true);
    setPaused(false);
    setErrorMsg('');
    setReport(null);
    setOutput('');
    const ctl = new AbortController();
    abortRef.current = ctl;
    const sig = sourceSig(source);
    try {
      const preTranslated = (await loadTokenMap(sig)) || undefined;
      const result = await runScriptTranslation(
        source, opts, deps,
        {
          signal: ctl.signal,
          isPaused: () => pausedRef.current,
          onTokensUpdated: (tokens) => persistTokens(sig, tokens),
        },
        (p) => setProgress(p),
        preTranslated,
      );
      tokensRef.current = result.tokens;
      // Lưu chốt lần cuối (không throttle) để resume/dịch-lại chính xác tuyệt đối
      lastSaveRef.current = 0;
      persistTokens(sig);
      setOutput(result.output);
      setReport(result.report);
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      if (msg !== 'Cancelled') setErrorMsg(msg);
      setProgress({ stage: msg === 'Cancelled' ? 'idle' : 'error' });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [source, running, opts, deps, persistTokens]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/javascript;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (fileName || 'script.txt').replace(/(\.[^.]+)?$/, '.vi$1') || 'script.vi.js';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, [output, fileName]);

  const handleClearProgress = useCallback(() => {
    if (!source) return;
    void deleteTokenMap(sourceSig(source));
    setResumeInfo(0);
  }, [source]);

  const stageLabel: Record<string, string> = {
    idle: '', beautify: ui.scrTrStBeautify, extract: ui.scrTrStExtract, translate: ui.scrTrStTranslate,
    reinsert: ui.scrTrStReinsert, regex: ui.scrTrStRegex, validate: ui.scrTrStValidate,
    done: ui.scrTrStDone, error: ui.scrTrStError,
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 22px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>📜 {ui.railScriptTranslate}</h2>
        <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-muted, #b6b2c9)' }}>{ui.scrTrIntro}</p>
      </div>

      {/* ─── 1. Input ─── */}
      <section style={card}>
        <h3 style={cardTitle}>1 · {ui.scrTrInputTitle}</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ ...btn, cursor: 'pointer' }}>
            📂 {ui.scrTrPickFile}
            <input type="file" accept=".js,.txt,.mjs" style={{ display: 'none' }}
              onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {fileName && <span style={{ fontSize: '0.85rem' }}>📄 {fileName}</span>}
          {stats && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #b6b2c9)' }}>
              {fmt(ui.scrTrStats, {
                kb: Math.round(stats.chars / 1024).toLocaleString(),
                cjk: stats.cjkChars.toLocaleString(),
                pct: stats.chars ? ((stats.cjkChars / stats.chars) * 100).toFixed(1) : '0',
              })}
              {stats.looksMinified ? ` · ${ui.scrTrMinified}` : ''}
            </span>
          )}
        </div>
        <textarea
          value={source.length > 200_000 ? source.slice(0, 200_000) : source}
          readOnly={source.length > 200_000}
          onChange={(e) => { void acceptSource(e.target.value, fileName || 'pasted.js'); }}
          placeholder={ui.scrTrPastePh}
          style={{ ...mono, width: '100%', height: 120, marginTop: 10 }}
        />
        {source.length > 200_000 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #b6b2c9)', marginTop: 4 }}>{ui.scrTrBigFileNote}</div>
        )}
        {resumeInfo > 0 && (
          <div style={{ fontSize: '0.8rem', color: '#4ecdc4', marginTop: 6 }}>
            💾 {fmt(ui.scrTrResumeFound, { n: resumeInfo.toLocaleString() })}
            <button onClick={handleClearProgress} style={{ ...btn, marginLeft: 10, fontSize: '0.72rem', padding: '3px 8px' }}>
              {ui.scrTrResumeClear}
            </button>
          </div>
        )}
      </section>

      {/* ─── 2. Tuỳ chọn ─── */}
      <section style={card}>
        <h3 style={cardTitle}>2 · {ui.scrTrOptsTitle}</h3>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label title={ui.scrTrBeautifyTip} style={checkLabel}>
            <input type="checkbox" checked={opts.beautify} onChange={(e) => setOpts({ ...opts, beautify: e.target.checked })} />
            ✨ {ui.scrTrBeautify}
          </label>
          <label title={ui.scrTrNsfwTip} style={checkLabel}>
            <input type="checkbox" checked={opts.nsfw} onChange={(e) => setOpts({ ...opts, nsfw: e.target.checked })} />
            🔞 {ui.scrTrNsfw}
          </label>
          <label title={ui.scrTrRegexAltTip} style={checkLabel}>
            <input type="checkbox" checked={opts.regexAlternation} onChange={(e) => setOpts({ ...opts, regexAlternation: e.target.checked })} />
            🧩 {ui.scrTrRegexAlt}
          </label>
          <label title={ui.scrTrSourcemapTip} style={{ ...checkLabel, opacity: 0.55, cursor: 'not-allowed' }}>
            <input type="checkbox" checked={false} disabled />
            🗺️ {ui.scrTrSourcemap}
          </label>
        </div>
      </section>

      {/* ─── 3. Pha 0: bảng tên ─── */}
      <section style={card}>
        <h3 style={cardTitle}>3 · {ui.scrTrPha0Title}</h3>
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-muted, #b6b2c9)' }}>{ui.scrTrPha0Desc}</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void runPha0()} disabled={!source || glossaryBusy || running} style={btn}>
            {glossaryBusy ? `⏳ ${ui.scrTrPha0Running}` : `🏷️ ${ui.scrTrPha0Btn}`}
          </button>
          <button onClick={() => setGlossary((g) => [...g, { source: '', target: '' }])} style={btn}>➕ {ui.scrTrPha0Add}</button>
          {glossary.length > 0 && (
            <button onClick={() => setGlossary([])} style={{ ...btn, color: '#ffb4a6' }}>🗑️ {ui.scrTrPha0Clear}</button>
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #b6b2c9)' }}>{fmt(ui.scrTrPha0Count, { n: glossary.length })}</span>
        </div>
        {glossary.length > 0 && (
          <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {glossary.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input value={g.source} placeholder="中文" style={{ ...mono, flex: 1 }}
                  onChange={(e) => setGlossary((prev) => prev.map((x, j) => j === i ? { ...x, source: e.target.value } : x))} />
                <span style={{ alignSelf: 'center' }}>→</span>
                <input value={g.target} placeholder="Tiếng Việt" style={{ ...mono, flex: 1 }}
                  onChange={(e) => setGlossary((prev) => prev.map((x, j) => j === i ? { ...x, target: e.target.value } : x))} />
                <button onClick={() => setGlossary((prev) => prev.filter((_, j) => j !== i))} style={{ ...btn, padding: '2px 8px' }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── 4. Chạy ─── */}
      <section style={card}>
        <h3 style={cardTitle}>4 · {ui.scrTrRunTitle}</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!running ? (
            <button onClick={() => void handleRun()} disabled={!source} style={{ ...btn, fontWeight: 700, borderColor: '#38bdf8', color: '#38bdf8' }}>
              ▶️ {ui.scrTrRunBtn}
            </button>
          ) : (
            <>
              <button onClick={() => setPaused((p) => !p)} style={btn}>{paused ? `▶️ ${ui.scrTrResume}` : `⏸️ ${ui.scrTrPause}`}</button>
              <button onClick={handleStop} style={{ ...btn, color: '#ffb4a6' }}>⏹️ {ui.scrTrStopBtn}</button>
            </>
          )}
          {progress.stage !== 'idle' && (
            <span style={{ fontSize: '0.88rem' }}>
              {stageLabel[progress.stage]}
              {progress.stage === 'translate' && progress.total ? ` — ${fmt(ui.scrTrBatchProgress, { done: progress.done ?? 0, total: progress.total })}` : ''}
              {progress.note ? ` (${progress.note})` : ''}
            </span>
          )}
        </div>
        {errorMsg && <div style={{ marginTop: 8, color: '#ffb4a6', fontSize: '0.85rem' }}>❌ {errorMsg}</div>}
        {running && <div style={{ marginTop: 12 }}><ActiveCallsPanel /></div>}
      </section>

      {/* ─── 5. Kết quả ─── */}
      {report && (
        <section style={card}>
          <h3 style={cardTitle}>5 · {ui.scrTrResultTitle}</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.86rem', lineHeight: 1.9 }}>
            <li>{report.parseOk ? '✅' : report.parseOkBefore ? '❌' : '⚠️'} {ui.scrTrRepParse}
              {!report.parseOk && report.parseError ? ` — ${report.parseError}` : ''}
              {!report.parseOkBefore ? ` (${ui.scrTrRepParseOrigBroken})` : ''}</li>
            <li>{report.parityOk ? '✅' : '⚠️'} {ui.scrTrRepParity}{report.parityDetail ? ` — ${report.parityDetail}` : ''}</li>
            <li>{report.residualTokens === 0 ? '✅' : '⚠️'} {fmt(ui.scrTrRepResidual, { n: report.residualTokens, total: report.tokenTotal })}
              {report.residualSamples.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.scrTrRepResidualList}</summary>
                  <pre style={{ ...mono, maxHeight: 120, overflow: 'auto' }}>{report.residualSamples.join('\n')}</pre>
                </details>
              )}
            </li>
            <li>🔒 {fmt(ui.scrTrRepPreserved, { n: report.preservedTokens })}</li>
            <li>🧩 {fmt(ui.scrTrRepRegex, { changed: report.regexChanged, reverted: report.regexReverted })}</li>
            <li>🈶 {fmt(ui.scrTrRepCjk, { in: report.cjkCharsIn.toLocaleString(), out: report.cjkCharsOut.toLocaleString() })}</li>
            <li>⏱️ {fmt(ui.scrTrRepTime, { s: Math.round(report.durationMs / 1000) })} · {Math.round(report.bytesIn / 1024)}KB → {Math.round(report.bytesOut / 1024)}KB</li>
          </ul>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={handleDownload} disabled={!output} style={{ ...btn, fontWeight: 700, borderColor: '#22c55e', color: '#22c55e' }}>
              💾 {ui.scrTrDownload}
            </button>
            <button onClick={() => { void navigator.clipboard.writeText(output); }} disabled={!output} style={btn}>📋 {ui.scrTrCopy}</button>
            {report.residualTokens > 0 && !running && (
              <button onClick={() => void handleRun()} style={btn}>🔁 {ui.scrTrRetryFailed}</button>
            )}
          </div>
          {output && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.8rem' }}>{ui.scrTrPreview}</summary>
              <pre style={{ ...mono, maxHeight: 260, overflow: 'auto' }}>
                {output.slice(0, 4000)}
                {output.length > 8000 ? `\n\n… (${ui.scrTrPreviewSkip}) …\n\n` : '\n'}
                {output.length > 4000 ? output.slice(-2000) : ''}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--bg-secondary, #16161e)',
  border: '1px solid var(--border-subtle, #2a2a3e)',
  borderRadius: 12,
  padding: '14px 16px',
};
const cardTitle: React.CSSProperties = { margin: '0 0 10px', fontSize: '0.95rem' };
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', fontSize: '0.82rem', fontWeight: 600,
  border: '1px solid var(--border-subtle, #2a2a3e)', borderRadius: 7,
  background: 'var(--bg-elevated, #252536)', color: 'var(--text-secondary, #d6d3e4)', cursor: 'pointer',
};
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', cursor: 'pointer' };
const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)', fontSize: '0.78rem',
  background: 'var(--bg-primary, #0f0f14)', color: 'var(--text-secondary, #d6d3e4)',
  border: '1px solid var(--border-subtle, #2a2a3e)', borderRadius: 7, padding: '6px 8px',
};
