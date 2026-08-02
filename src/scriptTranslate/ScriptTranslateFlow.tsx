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
  runSig, saveTokenMap, loadTokenMap, deleteTokenMap, tokensToMap,
} from './persist';
import { parseGlossaryJson, mergeGlossaries, countUsable, hasNewEntries, glossaryToJson } from '../utils/glossaryIO';
import { onGlossaryPush } from '../utils/glossaryBridge';
import { checkDictCoverage, type DataKeyInfo } from './astExtract';

export default function ScriptTranslateFlow() {
  const ui = useUi();
  const proxy = useStore((s) => s.proxy);
  const providers = useStore((s) => s.providers);
  const tc = useStore((s) => s.translationConfig);
  const addToast = useStore((s) => s.addToast);
  /** Từ điển của thẻ đang mở bên Dịch Card — nguồn để "mượn" sang đây */
  const cardGlossary = useStore((s) => s.translationConfig.glossary);

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
  /** (bug 187 — Hạng mục B) Khoá dữ liệu CJK của script hiện tại — nền của cổng chặn Từ Điển. */
  const [analysis, setAnalysis] = useState<{ mode: 'ast' | 'regex'; dataKeys: DataKeyInfo[] } | null>(null);
  /** (bug 187 — Hạng mục F) User chủ động vượt chặn export sau khi verifier báo đỏ. */
  const [forceExport, setForceExport] = useState(false);
  /** Kết quả lần nhập/mượn từ điển gần nhất — hiện ngay dưới hàng nút, tự tắt sau 6s */
  const [glsNote, setGlsNote] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!glsNote) return;
    const t = setTimeout(() => setGlsNote(null), 6000);
    return () => clearTimeout(t);
  }, [glsNote]);

  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const tokensRef = useRef<CJKToken[]>([]);
  const lastSaveRef = useRef(0);

  /** Bản mới nhất của bảng tên — để hàm gộp đọc mà không dính stale closure */
  const glossaryRef = useRef<GlossaryEntry[]>(glossary);

  useEffect(() => { saveOpts(opts); }, [opts]);
  useEffect(() => { saveGlossary(glossary); glossaryRef.current = glossary; }, [glossary]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  // Sig tiến độ phụ thuộc cờ beautify → user lật toggle thì tra lại map tương ứng
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    void loadTokenMap(runSig(source, opts.beautify)).then((m) => {
      if (!cancelled) setResumeInfo(m ? Object.keys(m).length : 0);
    });
    return () => { cancelled = true; };
  }, [opts.beautify, source]);

  const deps = useMemo(() => ({
    proxy, providers, glossary,
    nameStyle: tc.nameStyle, fandomMode: tc.fandomMode, fandomName: tc.fandomName || '',
  }), [proxy, providers, glossary, tc.nameStyle, tc.fandomMode, tc.fandomName]);

  // ─── Nạp file / dán ───
  const beautifyRef = useRef(opts.beautify);
  useEffect(() => { beautifyRef.current = opts.beautify; }, [opts.beautify]);
  const scanSeq = useRef(0);

  const acceptSource = useCallback(async (text: string, name: string) => {
    setSource(text);
    setFileName(name);
    setReport(null);
    setOutput('');
    setErrorMsg('');
    setResumeInfo(0);
    setAnalysis(null);
    setForceExport(false);
    // Gõ/dán liên tục → chỉ lần quét CUỐI được ghi kết quả (chống dội worker + fetch mỗi phím)
    const seq = ++scanSeq.current;
    await new Promise((r) => setTimeout(r, 350));
    if (seq !== scanSeq.current) return;
    try {
      const st = await scanStats(text);
      if (seq !== scanSeq.current) return;
      setStats(st);
      const saved = await loadTokenMap(runSig(text, beautifyRef.current));
      if (seq === scanSeq.current && saved) setResumeInfo(Object.keys(saved).length);
      // (bug 187 — Hạng mục B) Quét khoá dữ liệu NGAY khi nạp — cổng chặn cần biết trước khi
      // user bấm Dịch. Chạy trong worker nên file MB không đơ trang. Danh sách khoá không phụ
      // thuộc cờ beautify (prettier không đổi ngữ nghĩa AST) nên quét trên bản gốc là đủ.
      if (text.trim()) {
        const ex = await extractInWorker(text);
        if (seq === scanSeq.current) setAnalysis({ mode: ex.extractMode, dataKeys: ex.dataKeys });
      }
    } catch { setStats(null); }
  }, []);

  // (bug 187 — Hạng mục B) Coverage Từ Điển: tính lại mỗi khi bảng tên đổi. Rẻ — danh sách
  // khoá đã gọn, không đụng lại file nguồn.
  const coverage = useMemo(
    () => (analysis && opts.keyMode === 'rename' ? checkDictCoverage(analysis.dataKeys, glossary) : null),
    [analysis, glossary, opts.keyMode],
  );
  const keyGateBlocked = opts.keyMode === 'rename' && !!coverage && coverage.missing.length > 0;

  /** Đổ các khoá còn thiếu vào bảng (target trống) — user điền tay hoặc để Pha 0 AI đề xuất. */
  const addMissingKeys = useCallback(() => {
    if (!coverage) return;
    const have = new Set(glossaryRef.current.map((g) => g.source.trim()));
    const rows = coverage.missing.filter((m) => !have.has(m.name)).map((m) => ({ source: m.name, target: '' }));
    if (rows.length) {
      glossaryRef.current = [...glossaryRef.current, ...rows];
      setGlossary(glossaryRef.current);
    }
  }, [coverage]);

  // ─── Nhập / mượn từ điển ───
  /**
   * Gộp danh sách mục vào bảng tên hiện tại + báo kết quả bằng toast.
   * Tính merge NGOÀI updater của setState (đọc qua ref): updater có thể bị React gọi
   * nhiều lần (StrictMode / concurrent) nên lấy số liệu từ trong đó là không đáng tin.
   */
  const mergeIntoGlossary = useCallback((incoming: GlossaryEntry[], sourceLabel: string) => {
    const r = mergeGlossaries(glossaryRef.current, incoming);
    glossaryRef.current = r.merged;
    setGlossary(r.merged);
    // Phản hồi hiện NGAY TRONG PANEL này, không dùng toast: toast sống trong <App/> của tab
    // Dịch Card — đang bị display:none khi user đứng ở đây nên user sẽ chẳng thấy gì.
    const parts = [
      r.added > 0 ? fmt(ui.scrTrGlsImported, { n: r.added, from: sourceLabel }) : ui.scrTrGlsNothingNew,
      r.conflicts > 0 ? fmt(ui.scrTrGlsConflicts, { n: r.conflicts }) : '',
    ].filter(Boolean);
    setGlsNote({ text: parts.join(' '), ok: r.added > 0 });
  }, [ui]);

  /** Nhập từ FILE .json (bộ xuất ra từ Dịch Card dùng được thẳng) */
  const importGlossaryFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    try {
      const entries = parseGlossaryJson(await f.text());
      mergeIntoGlossary(entries, f.name);
    } catch (e) {
      const code = (e as Error)?.message;
      setGlsNote({ text: code === 'BAD_JSON' ? ui.scrTrGlsBadJson : ui.scrTrGlsNoEntries, ok: false });
    }
  }, [mergeIntoGlossary, ui]);

  /** Mượn thẳng từ điển của thẻ đang mở bên Dịch Card (không cần xuất/nhập file) */
  const importFromCard = useCallback(() => {
    if (countUsable(cardGlossary) === 0) { setGlsNote({ text: ui.scrTrGlsCardEmpty, ok: false }); return; }
    mergeIntoGlossary(cardGlossary, ui.railTranslate);
  }, [cardGlossary, mergeIntoGlossary, ui]);

  const exportGlossaryFile = useCallback(() => {
    const blob = new Blob([glossaryToJson(glossary)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'glossary-script.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, [glossary]);

  // Nhận từ điển do bên Dịch Card "gửi sang" (nút ➡️ bên đó) khi tab này đang mở sẵn
  useEffect(() => onGlossaryPush((entries) => mergeIntoGlossary(entries, ui.railTranslate)), [mergeIntoGlossary, ui]);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    void acceptSource(text, f.name);
    // Vừa nạp script mà bên Dịch Card đang có từ điển CHƯA có ở đây → hỏi mượn luôn.
    // Chỉ hỏi khi thật sự có mục mới, nên trả lời "Không" một lần rồi thôi cũng không bị hỏi lại.
    if (countUsable(cardGlossary) > 0 && hasNewEntries(glossary, cardGlossary)) {
      const n = countUsable(cardGlossary);
      // Đợi 1 nhịp cho giao diện kịp vẽ tên file rồi mới bật hộp thoại
      setTimeout(() => {
        if (window.confirm(fmt(ui.scrTrGlsAskImport, { n }))) importFromCard();
      }, 120);
    }
  }, [acceptSource, cardGlossary, glossary, importFromCard, ui]);

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
  const persistTokens = useCallback((sig: string, tokens?: CJKToken[], force = false) => {
    if (tokens) tokensRef.current = tokens; // pipeline đẩy token qua callback từng lô
    const now = Date.now();
    if (!force && now - lastSaveRef.current < 4000) return; // throttle 4s — map MB, đừng dội fs
    lastSaveRef.current = now;
    const map = tokensToMap(tokensRef.current);
    // KHÔNG bao giờ ghi map rỗng đè lên tiến độ tốt (vd run vỡ ngay trước lô đầu tiên)
    if (Object.keys(map).length === 0) return;
    void saveTokenMap(sig, map);
  }, []);

  const handleRun = useCallback(async () => {
    if (!source || running) return;
    setRunning(true);
    setPaused(false);
    setErrorMsg('');
    setReport(null);
    setOutput('');
    setForceExport(false);
    tokensRef.current = [];
    const ctl = new AbortController();
    abortRef.current = ctl;
    const sig = runSig(source, opts.beautify);
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
      setOutput(result.output);
      setReport(result.report);
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      if (msg !== 'Cancelled') setErrorMsg(msg);
      setProgress({ stage: msg === 'Cancelled' ? 'idle' : 'error' });
    } finally {
      // Lưu chốt KHÔNG throttle ở mọi lối ra (xong / Dừng / lỗi) — mấy lô cuối cùng
      // trong cửa sổ throttle 4s không được phép bay màu khi user bấm Dừng.
      persistTokens(sig, undefined, true);
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
    void deleteTokenMap(runSig(source, opts.beautify));
    setResumeInfo(0);
  }, [source, opts.beautify]);

  const stageLabel: Record<string, string> = {
    idle: '', beautify: ui.scrTrStBeautify, extract: ui.scrTrStExtract, translate: ui.scrTrStTranslate,
    reinsert: ui.scrTrStReinsert, regex: ui.scrTrStRegex, validate: ui.scrTrStValidate,
    verify: ui.scrTrStVerify, done: ui.scrTrStDone, error: ui.scrTrStError,
  };

  // (bug 187 — Hạng mục F/C) Cổng export: kiểm AST đỏ, hoặc còn khoá Hán ở chế độ đổi-theo-dict
  // → chặn nút tải chính; user vẫn có đường vượt TƯỜNG MINH (không bao giờ chặn chết).
  const vf = report?.astVerify;
  const exportBlockReason = !report ? '' :
    vf?.hardFail ? ui.scrTrExportBlockedHard :
    (report.keyMode === 'rename' && (vf?.cjkGroups.dataKey.length ?? 0) > 0) ? ui.scrTrExportBlockedKeys : '';
  const exportBlocked = !!exportBlockReason && !forceExport;

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
          <label style={{ ...tint(C.import), cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.45 : 1 }}>
            📂 {ui.scrTrPickFile}
            <input type="file" accept=".js,.txt,.mjs" style={{ display: 'none' }} disabled={running}
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
          readOnly={source.length > 200_000 || running}
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

        {/* (bug 187 — Hạng mục B) Số phận khoá dữ liệu: user PHẢI chọn, tool không đoán được
            card của họ đã đổi biến hay chưa — và chọn sai hướng nào cũng hỏng theo hướng đó. */}
        {source && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${keyGateBlocked ? 'rgba(239,68,68,0.45)' : 'var(--border-subtle, #2a2a3e)'}`,
            background: keyGateBlocked ? 'rgba(239,68,68,0.07)' : 'var(--bg-primary, #0f0f14)',
          }}>
            <div style={{ fontSize: '0.84rem', fontWeight: 700, marginBottom: 6 }}>🔑 {ui.scrTrKeyModeTitle}</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
              <label title={ui.scrTrKeyModeRenameTip} style={checkLabel}>
                <input type="radio" name="keyMode" checked={opts.keyMode === 'rename'}
                  onChange={() => setOpts({ ...opts, keyMode: 'rename' })} />
                📖 {ui.scrTrKeyModeRename}
              </label>
              <label title={ui.scrTrKeyModeKeepTip} style={checkLabel}>
                <input type="radio" name="keyMode" checked={opts.keyMode === 'keep'}
                  onChange={() => setOpts({ ...opts, keyMode: 'keep' })} />
                🈶 {ui.scrTrKeyModeKeep}
              </label>
            </div>
            {!analysis ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #b6b2c9)' }}>⏳ {ui.scrTrAnalyzing}</div>
            ) : analysis.dataKeys.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #b6b2c9)' }}>✅ {ui.scrTrKeyCoverageNone}</div>
            ) : opts.keyMode === 'rename' && coverage ? (
              <>
                <div style={{ fontSize: '0.8rem' }}>
                  {fmt(ui.scrTrKeyCoverage, { total: coverage.total, covered: coverage.covered, missing: coverage.missing.length })}
                </div>
                {coverage.missing.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: '0.76rem', color: '#ffb4a6' }}>{ui.scrTrKeyMissingTitle}</div>
                    <div style={{ ...mono, maxHeight: 90, overflow: 'auto', marginTop: 4, fontSize: '0.74rem' }}>
                      {coverage.missing.map((m) => `${m.name} (×${m.count})`).join(' · ')}
                    </div>
                    <button onClick={addMissingKeys} style={{ ...tint(C.import), marginTop: 6, fontSize: '0.76rem', padding: '4px 10px' }}>
                      ➕ {fmt(ui.scrTrKeyAddMissing, { n: coverage.missing.length })}
                    </button>
                  </div>
                )}
                {coverage.collisions.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.76rem', color: '#fbbf24', marginTop: 4 }}>
                    {fmt(ui.scrTrKeyCollision, { sources: c.sources.join(' + '), target: c.target })}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #b6b2c9)' }}>
                🈶 {fmt(ui.scrTrKeyKeepCount, { n: analysis.dataKeys.length })}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Hành động chính của khối — vàng vì có tốn lượt AI */}
          <button
            onClick={() => void runPha0()}
            disabled={!source || glossaryBusy || running}
            style={{ ...tint(C.ai, true), opacity: (!source || glossaryBusy || running) ? 0.45 : 1 }}
          >
            {glossaryBusy ? `⏳ ${ui.scrTrPha0Running}` : `🏷️ ${ui.scrTrPha0Btn}`}
          </button>
          <button onClick={() => setGlossary((g) => [...g, { source: '', target: '' }])} style={btn}>➕ {ui.scrTrPha0Add}</button>
          {/* Mượn thẳng từ điển của thẻ đang mở bên Dịch Card — tím = màu tab Dịch Card */}
          <button
            onClick={importFromCard}
            disabled={running}
            title={fmt(ui.scrTrGlsFromCardTip, { n: countUsable(cardGlossary) })}
            style={{ ...tint(C.card, true), opacity: running ? 0.45 : 1 }}
          >
            🔗 {ui.scrTrGlsFromCard}
            {countUsable(cardGlossary) > 0 && (
              <span style={{
                marginLeft: 2, padding: '1px 7px', borderRadius: 9, fontSize: '0.7rem', fontWeight: 700,
                background: C.card, color: '#fff',
              }}>{countUsable(cardGlossary)}</span>
            )}
          </button>
          {/* Nhập file .json — dùng thẳng được bộ xuất ra từ Dịch Card */}
          <label style={{ ...tint(C.import), cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.45 : 1 }} title={ui.scrTrGlsImportTip}>
            📥 {ui.scrTrGlsImport}
            <input type="file" accept=".json" style={{ display: 'none' }} disabled={running}
              onChange={(e) => { void importGlossaryFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {glossary.length > 0 && (
            <>
              <button onClick={exportGlossaryFile} title={ui.scrTrGlsExportTip} style={tint(C.export)}>📤 {ui.scrTrGlsExport}</button>
              <button onClick={() => setGlossary([])} style={tint(C.danger)}>🗑️ {ui.scrTrPha0Clear}</button>
            </>
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #b6b2c9)' }}>{fmt(ui.scrTrPha0Count, { n: glossary.length })}</span>
        </div>
        {glsNote && (
          <div style={{
            marginTop: 8, padding: '6px 10px', borderRadius: 7, fontSize: '0.8rem',
            background: glsNote.ok ? 'rgba(34,197,94,0.12)' : 'rgba(255,180,166,0.10)',
            border: `1px solid ${glsNote.ok ? 'rgba(34,197,94,0.35)' : 'rgba(255,180,166,0.30)'}`,
            color: glsNote.ok ? '#22c55e' : '#ffb4a6',
          }}>
            {glsNote.ok ? '✅' : 'ℹ️'} {glsNote.text}
          </div>
        )}
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
            // (review 187) Chặn thêm lúc CHƯA phân tích xong khoá (analysis null) — không thì
            // trong cửa sổ vài giây quét file lớn, nút mở toang và cổng Từ Điển bị lách.
            <button
              onClick={() => void handleRun()}
              disabled={!source || glossaryBusy || keyGateBlocked || (!!source && !analysis)}
              title={glossaryBusy ? ui.scrTrPha0Running
                : keyGateBlocked && coverage ? fmt(ui.scrTrKeyGateBlocked, { n: coverage.missing.length })
                : source && !analysis ? ui.scrTrAnalyzing : undefined}
              style={{ ...tint(C.import, true), opacity: (!source || glossaryBusy || keyGateBlocked || !analysis) ? 0.45 : 1 }}
            >
              ▶️ {ui.scrTrRunBtn}
            </button>
          ) : (
            <>
              <button onClick={() => setPaused((p) => !p)} style={btn}>{paused ? `▶️ ${ui.scrTrResume}` : `⏸️ ${ui.scrTrPause}`}</button>
              <button onClick={handleStop} style={tint(C.danger)}>⏹️ {ui.scrTrStopBtn}</button>
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
        {keyGateBlocked && coverage && !running && (
          <div style={{ marginTop: 8, color: '#ffb4a6', fontSize: '0.8rem' }}>
            ⛔ {fmt(ui.scrTrKeyGateBlocked, { n: coverage.missing.length })}
          </div>
        )}
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
            {/* (bug 151) Nói RÕ chữ Hán còn lại nằm ở đâu, kèm cách đổi. Trước đây dòng này chỉ
                đếm token nên "0/82 chưa dịch" đứng cạnh "còn 247 ký tự Trung" trông như mâu thuẫn. */}
            <li>🔒 {fmt(ui.scrTrRepPreserved, { n: report.preservedTokens, cjk: report.preservedCjkChars })}
              {report.preservedSamples.length > 0 && (
                <div style={{ fontSize: '0.76rem', opacity: 0.75, marginTop: 2 }}>
                  {fmt(ui.scrTrRepPreservedHint, { names: report.preservedSamples.join(', ') })}
                </div>
              )}
            </li>
            {report.dictRenamed > 0 && (
              <li>📖 {fmt(ui.scrTrRepDictRenamed, { n: report.dictRenamed })}</li>
            )}
            <li>🧩 {fmt(ui.scrTrRepRegex, { changed: report.regexChanged, reverted: report.regexReverted })}</li>
            {/* (bug 187 — Hạng mục A) Cơ chế trích token đã dùng — fallback regex phải NÓI RA. */}
            {report.extractMode && (
              <li>{report.extractMode === 'ast' ? `🌳 ${ui.scrTrExtractAst}` : `⚠️ ${ui.scrTrExtractRegex}`}</li>
            )}
            {/* (bug 187 — Hạng mục F) 4 phép kiểm AST gốc ↔ dịch. */}
            {vf && (
              <li>
                {vf.hardFail ? (
                  <div style={{ color: '#ffb4a6' }}>
                    ❌ {ui.scrTrVfFailTitle}
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                      {vf.hardFailReasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                    {(vf.identDiffs.length > 0 || vf.literalDiffs.length > 0 || vf.regexDiffs.length > 0 || vf.structuralDiffs.length > 0) && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.scrTrVfDetailList}</summary>
                        <pre style={{ ...mono, maxHeight: 160, overflow: 'auto' }}>
                          {[...vf.structuralDiffs, ...vf.identDiffs, ...vf.literalDiffs, ...vf.regexDiffs]
                            .slice(0, 40)
                            .map((d) => fmt(ui.scrTrCjkDetailLine, { line: d.line, ctx: `${d.before} → ${d.after}` }))
                            .join('\n')}
                        </pre>
                      </details>
                    )}
                  </div>
                ) : (
                  <>✅ {fmt(ui.scrTrVfPass, { up: vf.regexUpgrades > 0 ? fmt(ui.scrTrVfUpgrades, { n: vf.regexUpgrades }) : '' })}
                    {vf.mode === 'text-only' && <span style={{ color: '#fbbf24' }}> — {ui.scrTrVfTextOnly}</span>}
                  </>
                )}
              </li>
            )}
            {vf && vf.renamesOffDict > 0 && (
              <li style={{ color: '#fbbf24' }}>
                ⚠️ {fmt(ui.scrTrVfOffDict, { n: vf.renamesOffDict })}
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.scrTrVfOffDictList}</summary>
                  <pre style={{ ...mono, maxHeight: 120, overflow: 'auto' }}>
                    {vf.keyRenames.filter((k) => !k.inDict).slice(0, 40).map((k) => `${k.from} → ${k.to} (×${k.count})`).join('\n')}
                  </pre>
                </details>
              </li>
            )}
            {/* (bug 187 — Hạng mục C) CJK còn lại tách theo BẢN CHẤT — hết thời một con số gộp. */}
            {vf && (
              <li>
                🈶 {ui.scrTrCjkTitle}
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {vf.cjkGroups.alternationChars === 0 && vf.cjkGroups.dataKey.length === 0 &&
                    vf.cjkGroups.prose.length === 0 && vf.cjkGroups.regexNoAlt.length === 0 &&
                    vf.cjkGroups.keptIdentifiers === 0 && <li>✅ {ui.scrTrCjkClean}</li>}
                  {vf.cjkGroups.alternationChars > 0 && (
                    <li style={{ opacity: 0.75 }}>{fmt(ui.scrTrCjkAlt, { n: vf.cjkGroups.alternationChars })}</li>
                  )}
                  {vf.cjkGroups.keptIdentifiers > 0 && (
                    <li style={{ opacity: 0.75 }}>{fmt(ui.scrTrCjkKept, { n: vf.cjkGroups.keptIdentifiers })}</li>
                  )}
                  {vf.cjkGroups.dataKey.length > 0 && (
                    // Chế độ 'keep': user CHỦ ĐỘNG giữ khoá Hán — hiện trung tính, đừng dọa đỏ.
                    <li style={report.keyMode === 'keep' ? { opacity: 0.75 } : { color: '#ffb4a6' }}>
                      {report.keyMode === 'keep'
                        ? `🔒 ${fmt(ui.scrTrCjkDataKeyKept, { n: vf.cjkGroups.dataKey.length })}`
                        : `🔴 ${fmt(ui.scrTrCjkDataKey, { n: vf.cjkGroups.dataKey.length })}`}
                      <details style={{ marginTop: 2 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.scrTrCjkList}</summary>
                        <pre style={{ ...mono, maxHeight: 140, overflow: 'auto' }}>
                          {vf.cjkGroups.dataKey.map((d) => fmt(ui.scrTrCjkDetailLine, { line: d.line, ctx: `${d.text} — ${d.context}` })).join('\n')}
                        </pre>
                      </details>
                    </li>
                  )}
                  {vf.cjkGroups.prose.length > 0 && (
                    <li style={{ color: '#fbbf24' }}>
                      🟡 {fmt(ui.scrTrCjkProse, { n: vf.cjkGroups.prose.length })}
                      <details style={{ marginTop: 2 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.scrTrCjkList}</summary>
                        <pre style={{ ...mono, maxHeight: 140, overflow: 'auto' }}>
                          {vf.cjkGroups.prose.map((d) => fmt(ui.scrTrCjkDetailLine, { line: d.line, ctx: `${d.text} — ${d.context}` })).join('\n')}
                        </pre>
                      </details>
                    </li>
                  )}
                  {vf.cjkGroups.regexNoAlt.length > 0 && (
                    <li style={{ color: '#fbbf24' }}>
                      🟠 {fmt(ui.scrTrCjkRegexNoAlt, { n: vf.cjkGroups.regexNoAlt.length })}
                      <details style={{ marginTop: 2 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.78rem' }}>{ui.scrTrCjkList}</summary>
                        <pre style={{ ...mono, maxHeight: 140, overflow: 'auto' }}>
                          {vf.cjkGroups.regexNoAlt.map((d) => fmt(ui.scrTrCjkDetailLine, { line: d.line, ctx: `${d.text} — ${d.context}` })).join('\n')}
                        </pre>
                      </details>
                    </li>
                  )}
                </ul>
              </li>
            )}
            {/* (bug 187 — Hạng mục D) Nhật ký retry — lỗi API/echo thiếu không bị nuốt nữa. */}
            {report.retryLog && report.retryLog.length > 0 && (
              <li>
                <details>
                  <summary style={{ cursor: 'pointer' }}>📋 {fmt(ui.scrTrRetryLogTitle, { n: report.retryLog.length })}</summary>
                  <pre style={{ ...mono, maxHeight: 180, overflow: 'auto', marginTop: 4 }}>{report.retryLog.join('\n')}</pre>
                </details>
              </li>
            )}
            <li>🈶 {fmt(ui.scrTrRepCjk, { in: report.cjkCharsIn.toLocaleString(), out: report.cjkCharsOut.toLocaleString() })}</li>
            {/* (bug 160) Số dòng phình ra = có xuống dòng bị chèn vào giữa chuỗi JS. Nói thẳng
                nguyên nhân, đừng để user chỉ thấy "Unterminated string constant". */}
            {report.linesIn !== undefined && report.linesOut !== undefined && report.linesOut > report.linesIn && (
              <li>⚠️ {fmt(ui.scrTrRepLineBloat, { in: report.linesIn, out: report.linesOut })}</li>
            )}
            <li>⏱️ {fmt(ui.scrTrRepTime, { s: Math.round(report.durationMs / 1000) })} · {Math.round(report.bytesIn / 1024)}KB → {Math.round(report.bytesOut / 1024)}KB</li>
          </ul>
          {/* (bug 187 — Hạng mục C/F) Kiểm đỏ thì chặn export — nhưng chặn TƯỜNG MINH kèm đường
              vượt có chủ đích, không chặn chết (verifier cũng có thể sai ở mẫu chưa lường). */}
          {!!exportBlockReason && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem',
              border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.07)', color: '#ffb4a6',
            }}>
              ⛔ {exportBlockReason}
              {!forceExport && (
                <button onClick={() => setForceExport(true)} style={{ ...btn, marginLeft: 10, fontSize: '0.72rem', padding: '3px 8px' }}>
                  {ui.scrTrExportForce}
                </button>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={handleDownload} disabled={!output || exportBlocked} style={{ ...tint(C.export, true), opacity: output && !exportBlocked ? 1 : 0.45 }}>
              💾 {ui.scrTrDownload}
            </button>
            <button onClick={() => { void navigator.clipboard.writeText(output); }} disabled={!output || exportBlocked} style={btn}>📋 {ui.scrTrCopy}</button>
            {/* (review 187) Nút Dịch lại cũng phải tôn trọng cổng Từ Điển — pipeline có tường
                chặn riêng rồi, nhưng nút mở toang trong khi nút Chạy xám là đánh đố user. */}
            {report.residualTokens > 0 && !running && !keyGateBlocked && (
              <button onClick={() => void handleRun()} style={tint(C.ai)}>🔁 {ui.scrTrRetryFailed}</button>
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

/**
 * Nút CÓ MÀU theo chức năng — nhìn phát biết ngay nút nào làm gì, thay vì một dãy nút xám
 * giống hệt nhau. `strong` dành cho hành động chính của khối (nền đậm hơn, chữ đậm hơn).
 */
const tint = (color: string, strong = false): React.CSSProperties => ({
  ...btn,
  border: `1px solid ${color}${strong ? '99' : '55'}`,
  background: `${color}${strong ? '26' : '14'}`,
  color,
  fontWeight: strong ? 700 : 600,
});

/** Màu theo chức năng, dùng chung cả trang cho nhất quán */
const C = {
  ai: '#f59e0b',        // hành động tốn lượt AI (vàng — nhắc user là có chi phí)
  card: '#7c6af0',      // liên quan tab Dịch Card (tím — đúng màu tab đó)
  import: '#38bdf8',    // nhập vào (xanh dương — màu tab Dịch Script)
  export: '#22c55e',    // xuất ra / tải về (xanh lá)
  danger: '#ef4444',    // xoá (đỏ)
} as const;
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', cursor: 'pointer' };
const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)', fontSize: '0.78rem',
  background: 'var(--bg-primary, #0f0f14)', color: 'var(--text-secondary, #d6d3e4)',
  border: '1px solid var(--border-subtle, #2a2a3e)', borderRadius: 7, padding: '6px 8px',
};
