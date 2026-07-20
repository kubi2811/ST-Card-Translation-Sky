// ─── Tab native "Dịch Preset" (Phase C) ───
// Dịch preset SillyTavern (JSON, 250+ prompts) ngay trong app chính — dùng chung pool
// provider/API key của Dịch Card. Tag/biến đổi tên DETERMINISTIC theo từ điển Pha 0.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import ActiveCallsPanel from '../components/ActiveCallsPanel';
import { parsePresetJSON } from '../utils/presetParser';
import type { STPreset } from '../types/card';
import { buildInventory } from './inventory';
import { runPresetDictionaryPhase } from './dictionaryPhase';
import { runPresetTranslation, type PresetUnit } from './presetPipeline';
import type { PresetDict, PresetInventory, PresetProgress, PresetTranslateOptions, PresetTranslateReport } from './types';
import { emptyPresetDict } from './types';
import {
  loadOpts, saveOpts, loadDict, saveDict,
  presetSig, saveUnitMap, loadUnitMap, deleteUnitMap, unitsToMap,
} from './persist';

export default function PresetTranslateFlow() {
  const ui = useUi();
  const proxy = useStore((s) => s.proxy);
  const providers = useStore((s) => s.providers);
  const tc = useStore((s) => s.translationConfig);

  const [rawJson, setRawJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [preset, setPreset] = useState<STPreset | null>(null);
  const [inventory, setInventory] = useState<PresetInventory | null>(null);
  const [opts, setOpts] = useState<PresetTranslateOptions>(() => loadOpts());
  const [dict, setDict] = useState<PresetDict>(() => loadDict());
  const [dictBusy, setDictBusy] = useState(false);
  const [progress, setProgress] = useState<PresetProgress>({ stage: 'idle' });
  const [report, setReport] = useState<PresetTranslateReport | null>(null);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resumeInfo, setResumeInfo] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const lastSaveRef = useRef(0);

  useEffect(() => { saveOpts(opts); }, [opts]);
  useEffect(() => { saveDict(dict); }, [dict]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  // Inventory phụ thuộc dict (quyết regex auto/manual) → tính lại khi dict đổi
  useEffect(() => {
    if (preset) setInventory(buildInventory(preset, dict));
  }, [preset, dict]);

  const deps = useMemo(() => ({
    proxy, providers, glossary: dict.names,
    nameStyle: tc.nameStyle, fandomMode: tc.fandomMode, fandomName: tc.fandomName || '',
  }), [proxy, providers, dict.names, tc.nameStyle, tc.fandomMode, tc.fandomName]);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    setFileName(f.name);
    setReport(null);
    setOutput('');
    setErrorMsg('');
    setResumeInfo(0);
    try {
      const p = parsePresetJSON(JSON.parse(text));
      if (!p) { setErrorMsg(ui.psTrNotPreset); setPreset(null); setRawJson(''); return; }
      setRawJson(text);
      setPreset(p);
      const saved = await loadUnitMap(presetSig(text));
      if (saved) setResumeInfo(Object.keys(saved).length);
    } catch {
      setErrorMsg(ui.psTrBadJson);
      setPreset(null);
      setRawJson('');
    }
  }, [ui]);

  const runDict = useCallback(async () => {
    if (!preset || dictBusy) return;
    setDictBusy(true);
    setErrorMsg('');
    try {
      const d = await runPresetDictionaryPhase(preset, deps);
      setDict((prev) => ({
        tags: { ...d.tags, ...prev.tags },      // user đã sửa tay thì giữ bản của user
        vars: { ...d.vars, ...prev.vars },
        names: [...prev.names, ...d.names.filter((n) => !prev.names.some((x) => x.source === n.source))],
      }));
    } catch (e) {
      setErrorMsg((e as Error)?.message || String(e));
    } finally {
      setDictBusy(false);
    }
  }, [preset, deps, dictBusy]);

  const persistUnits = useCallback((sig: string, units: PresetUnit[]) => {
    const now = Date.now();
    if (now - lastSaveRef.current < 4000) return;
    lastSaveRef.current = now;
    void saveUnitMap(sig, unitsToMap(units));
  }, []);

  const handleRun = useCallback(async () => {
    if (!rawJson || running) return;
    setRunning(true);
    setPaused(false);
    setErrorMsg('');
    setReport(null);
    setOutput('');
    const ctl = new AbortController();
    abortRef.current = ctl;
    const sig = presetSig(rawJson);
    try {
      const preTranslated = (await loadUnitMap(sig)) || undefined;
      const result = await runPresetTranslation(
        rawJson, opts, dict, deps,
        {
          signal: ctl.signal,
          isPaused: () => pausedRef.current,
          onUnitsUpdated: (units) => persistUnits(sig, units),
        },
        (p) => setProgress(p),
        preTranslated,
      );
      setOutput(result.outputJson);
      setReport(result.report);
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      if (msg !== 'Cancelled') setErrorMsg(msg);
      setProgress({ stage: msg === 'Cancelled' ? 'idle' : 'error' });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [rawJson, running, opts, dict, deps, persistUnits]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (fileName || 'preset.json').replace(/\.json$/i, '') + '.vi.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, [output, fileName]);

  const stageLabel: Record<string, string> = {
    idle: '', parse: ui.psTrStParse, translate: ui.psTrStTranslate, consistency: ui.psTrStConsistency,
    regex: ui.psTrStRegex, scripts: ui.psTrStScripts, validate: ui.psTrStValidate, done: ui.psTrStDone, error: ui.psTrStError,
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 22px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>🈶 {ui.railPresetTranslate}</h2>
        <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-muted, #b6b2c9)' }}>{ui.psTrIntro}</p>
      </div>

      {/* ─── 1. Nạp preset ─── */}
      <section style={card}>
        <h3 style={cardTitle}>1 · {ui.psTrInputTitle}</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ ...btn, cursor: 'pointer' }}>
            📂 {ui.psTrPickFile}
            <input type="file" accept=".json" style={{ display: 'none' }}
              onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {fileName && <span style={{ fontSize: '0.85rem' }}>📄 {fileName}</span>}
        </div>
        {inventory && (
          <div style={{ marginTop: 10, fontSize: '0.84rem', lineHeight: 1.8 }}>
            {fmt(ui.psTrInvSummary, {
              prompts: inventory.promptCount,
              names: inventory.translateNameCount,
              contents: inventory.translateContentCount,
              regex: inventory.regexRows.length,
              scripts: inventory.helperScripts.length,
              cjk: inventory.totalCjkChars.toLocaleString(),
            })}
            {inventory.helperScripts.length > 0 && (
              <div style={{ color: 'var(--text-muted, #b6b2c9)', fontSize: '0.78rem' }}>
                {inventory.helperScripts.map((h) => `📜 ${h.name} (${Math.round(h.size / 1024)}KB)`).join(' · ')}
              </div>
            )}
          </div>
        )}
        {resumeInfo > 0 && (
          <div style={{ fontSize: '0.8rem', color: '#4ecdc4', marginTop: 6 }}>
            💾 {fmt(ui.psTrResumeFound, { n: resumeInfo })}
            <button onClick={() => { void deleteUnitMap(presetSig(rawJson)); setResumeInfo(0); }}
              style={{ ...btn, marginLeft: 10, fontSize: '0.72rem', padding: '3px 8px' }}>
              {ui.scrTrResumeClear}
            </button>
          </div>
        )}
      </section>

      {/* ─── 2. Tùy chọn ─── */}
      <section style={card}>
        <h3 style={cardTitle}>2 · {ui.scrTrOptsTitle}</h3>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label title={ui.scrTrNsfwTip} style={checkLabel}>
            <input type="checkbox" checked={opts.nsfw} onChange={(e) => setOpts({ ...opts, nsfw: e.target.checked })} />
            🔞 {ui.scrTrNsfw}
          </label>
          <label title={ui.psTrEmbedTip} style={checkLabel}>
            <input type="checkbox" checked={opts.translateEmbeddedScripts}
              onChange={(e) => setOpts({ ...opts, translateEmbeddedScripts: e.target.checked })} />
            📜 {ui.psTrEmbed}
          </label>
        </div>
      </section>

      {/* ─── 3. Từ điển Pha 0 (tag + biến + tên) ─── */}
      <section style={card}>
        <h3 style={cardTitle}>3 · {ui.psTrDictTitle}</h3>
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-muted, #b6b2c9)' }}>{ui.psTrDictDesc}</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void runDict()} disabled={!preset || dictBusy || running} style={btn}>
            {dictBusy ? `⏳ ${ui.scrTrPha0Running}` : `🏷️ ${ui.psTrDictBtn}`}
          </button>
          {(Object.keys(dict.tags).length + Object.keys(dict.vars).length + dict.names.length) > 0 && (
            <button onClick={() => setDict(emptyPresetDict())} style={{ ...btn, color: '#ffb4a6' }}>🗑️ {ui.scrTrPha0Clear}</button>
          )}
        </div>
        <DictEditor title={`🏷️ ${ui.psTrDictTags}`} entries={dict.tags}
          onChange={(tags) => setDict({ ...dict, tags })} phSrc="正文" phDst="Chính văn" />
        <DictEditor title={`🔧 ${ui.psTrDictVars}`} entries={dict.vars}
          onChange={(vars) => setDict({ ...dict, vars })} phSrc="美型化" phDst="beautify" />
        {dict.names.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>👤 {fmt(ui.psTrDictNames, { n: dict.names.length })}</summary>
            <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {dict.names.map((g, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <input value={g.source} style={{ ...mono, flex: 1 }}
                    onChange={(e) => setDict((d) => ({ ...d, names: d.names.map((x, j) => j === i ? { ...x, source: e.target.value } : x) }))} />
                  <span style={{ alignSelf: 'center' }}>→</span>
                  <input value={g.target} style={{ ...mono, flex: 1 }}
                    onChange={(e) => setDict((d) => ({ ...d, names: d.names.map((x, j) => j === i ? { ...x, target: e.target.value } : x) }))} />
                  <button onClick={() => setDict((d) => ({ ...d, names: d.names.filter((_, j) => j !== i) }))} style={{ ...btn, padding: '2px 8px' }}>✕</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ─── 4. Regex cần chú ý ─── */}
      {inventory && inventory.regexRows.some((r) => r.decision === 'manual') && (
        <section style={card}>
          <h3 style={cardTitle}>⚠️ {ui.psTrRegexManualTitle}</h3>
          <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-muted, #b6b2c9)' }}>{ui.psTrRegexManualDesc}</p>
          <div style={{ maxHeight: 160, overflow: 'auto', fontSize: '0.76rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {inventory.regexRows.filter((r) => r.decision === 'manual').map((r) => (
              <div key={r.idx} style={{ display: 'flex', gap: 8 }}>
                <span style={{ flexShrink: 0, fontWeight: 600 }}>{r.scriptName}</span>
                <code style={{ ...mono, padding: '1px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.findRegex.slice(0, 80)}
                </code>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── 5. Chạy ─── */}
      <section style={card}>
        <h3 style={cardTitle}>4 · {ui.scrTrRunTitle}</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!running ? (
            <button onClick={() => void handleRun()} disabled={!rawJson} style={{ ...btn, fontWeight: 700, borderColor: '#f472b6', color: '#f472b6' }}>
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
              {(progress.stage === 'translate' || progress.stage === 'scripts') && progress.total
                ? ` — ${fmt(ui.scrTrBatchProgress, { done: progress.done ?? 0, total: progress.total })}` : ''}
              {progress.note ? ` (${progress.note})` : ''}
            </span>
          )}
        </div>
        {errorMsg && <div style={{ marginTop: 8, color: '#ffb4a6', fontSize: '0.85rem' }}>❌ {errorMsg}</div>}
        {running && <div style={{ marginTop: 12 }}><ActiveCallsPanel /></div>}
      </section>

      {/* ─── 6. Kết quả ─── */}
      {report && (
        <section style={card}>
          <h3 style={cardTitle}>5 · {ui.scrTrResultTitle}</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.86rem', lineHeight: 1.9 }}>
            <li>{report.structureOk ? '✅' : '❌'} {ui.psTrRepStructure}
              {report.structureErrors.length > 0 && (
                <pre style={{ ...mono, maxHeight: 100, overflow: 'auto' }}>{report.structureErrors.join('\n')}</pre>
              )}
            </li>
            <li>{report.macroParityOk ? '✅' : '⚠️'} {ui.psTrRepMacro}
              {report.macroParityErrors.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.psTrRepMacroList}</summary>
                  <pre style={{ ...mono, maxHeight: 120, overflow: 'auto' }}>{report.macroParityErrors.join('\n')}</pre>
                </details>
              )}
            </li>
            <li>{report.unitsFailed === 0 ? '✅' : '⚠️'} {fmt(ui.psTrRepUnits, { n: report.unitsFailed, total: report.unitsTotal })}</li>
            <li>🧩 {fmt(ui.psTrRepRegex, { changed: report.regexChanged, reverted: report.regexReverted, manual: report.regexManual.length })}</li>
            <li>📜 {fmt(ui.psTrRepScripts, { n: report.scriptsTranslated })}</li>
            <li>⏱️ {fmt(ui.scrTrRepTime, { s: Math.round(report.durationMs / 1000) })} · {Math.round(report.bytesIn / 1024)}KB → {Math.round(report.bytesOut / 1024)}KB</li>
          </ul>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={handleDownload} disabled={!output} style={{ ...btn, fontWeight: 700, borderColor: '#22c55e', color: '#22c55e' }}>
              💾 {ui.psTrDownload}
            </button>
            <button onClick={() => { void navigator.clipboard.writeText(output); }} disabled={!output} style={btn}>📋 {ui.scrTrCopy}</button>
            {report.unitsFailed > 0 && !running && (
              <button onClick={() => void handleRun()} style={btn}>🔁 {ui.scrTrRetryFailed}</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Editor 1 bảng key→value đơn giản (tags / vars). */
function DictEditor({ title, entries, onChange, phSrc, phDst }: {
  title: string;
  entries: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  phSrc: string;
  phDst: string;
}) {
  const rows = Object.entries(entries);
  const set = (i: number, k: string, v: string) => {
    const next: Record<string, string> = {};
    rows.forEach(([rk, rv], j) => {
      if (j === i) { if (k.trim()) next[k] = v; }
      else next[rk] = rv;
    });
    onChange(next);
  };
  return (
    <details open={rows.length > 0} style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>{title} ({rows.length})</summary>
      <div style={{ maxHeight: 180, overflow: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <input value={k} placeholder={phSrc} style={{ ...mono, flex: 1 }} onChange={(e) => set(i, e.target.value, v)} />
            <span style={{ alignSelf: 'center' }}>→</span>
            <input value={v} placeholder={phDst} style={{ ...mono, flex: 1 }} onChange={(e) => set(i, k, e.target.value)} />
            <button onClick={() => { const n = { ...entries }; delete n[k]; onChange(n); }} style={{ ...btn, padding: '2px 8px' }}>✕</button>
          </div>
        ))}
        <button onClick={() => onChange({ ...entries, '': '' })} style={{ ...btn, alignSelf: 'flex-start', fontSize: '0.74rem', padding: '3px 10px' }}>➕</button>
      </div>
    </details>
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
