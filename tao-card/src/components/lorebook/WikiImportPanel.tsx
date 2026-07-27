/**
 * WikiImportPanel — UI của bộ Wiki Importer MỚI (bug 120/121/122), thay WikiScraperPanel cũ.
 * Input đúng yêu cầu 121: URL, số entry, token/entry, auto-expand, depth, maxPages, canon-only.
 * Tiến trình thời gian thực: trang đã cào/hàng đợi/ETA, entry đã tạo; Pause/Resume/Stop;
 * resume sau F5 nhờ CrawlState persist trong localStorage.
 */
import { useRef, useState } from 'react';
import { Globe, Play, Pause, Square, RotateCcw } from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToastStore } from '../../store/toastStore';
import { runWikiImport, loadCrawlState, clearCrawlState } from '../../lib/wikiImport';
import type { CrawlProgress } from '../../lib/wikiImport/types';
import { usePersistedState } from '../../lib/usePersistedState';
import { t as ui, fmt } from '../../i18n';

interface PanelConfig {
  url: string;
  totalEntries: number;
  tokensPerEntry: number;
  autoExpand: boolean;
  maxDepth: number;
  maxPages: number;
  canonOnly: boolean;
  concurrentBatches: number;
  extraInstructions: string;
}

const DEFAULTS: PanelConfig = {
  url: '', totalEntries: 20, tokensPerEntry: 250, autoExpand: true,
  maxDepth: 2, maxPages: 60, canonOnly: false, concurrentBatches: 3, extraInstructions: '',
};

export function WikiImportPanel() {
  const card = useCardStore((s) => s.card);
  const addEntry = useCardStore((s) => s.addEntry);
  const settings = useSettingsStore();
  const toast = useToastStore.getState();

  const [cfg, setCfg] = usePersistedState<PanelConfig>('wikiImport.cfg', DEFAULTS);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);

  const set = (patch: Partial<PanelConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const log = (msg: string) => setLogs((l) => [...l.slice(-400), msg]);
  const hasResume = cfg.url.trim() ? !!loadCrawlState(cfg.url.trim()) : false;

  const start = async () => {
    const profile = settings.getActiveProfile();
    if (!profile) { toast.warning(ui.wiNeedProfile); return; }
    const url = cfg.url.trim();
    if (!url) { toast.warning(ui.wiNeedUrl); return; }

    setRunning(true); setPaused(false); pausedRef.current = false; setLogs([]);
    abortRef.current = new AbortController();
    try {
      const r = await runWikiImport(
        {
          url, totalEntries: cfg.totalEntries, tokensPerEntry: cfg.tokensPerEntry,
          autoExpand: cfg.autoExpand, maxDepth: cfg.maxDepth, maxPages: cfg.maxPages,
          canonOnly: cfg.canonOnly, concurrentBatches: cfg.concurrentBatches,
          extraInstructions: cfg.extraInstructions,
          defaultPosition: 1, insertionOrderStart: 100,
        },
        { card, profile, generationParams: settings.generationParams, appendEntry: addEntry },
        {
          signal: abortRef.current.signal,
          isPaused: () => pausedRef.current,
          log,
          onProgress: setProgress,
        },
      );
      toast.success(fmt(ui.wiDone, { entries: r.entriesCreated, pages: r.pagesCrawled }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'Cancelled') { log(ui.wiStopped); toast.info(ui.wiStoppedResume); }
      else { log(`❌ ${msg}`); toast.error(msg); }
    } finally {
      setRunning(false); setPaused(false); pausedRef.current = false;
    }
  };

  const stop = () => abortRef.current?.abort();
  const togglePause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); };
  const resetResume = () => { clearCrawlState(cfg.url.trim()); log(ui.wiResumeCleared); };

  const num = (v: string, min: number, max: number, dflt: number) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold">{ui.wiTitle}</h2>
        <span className="text-xs text-muted-foreground">{ui.wiSubtitle}</span>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div>
          <label className="text-xs font-semibold">{ui.wiUrlLabel}</label>
          <input value={cfg.url} onChange={(e) => set({ url: e.target.value })} disabled={running}
            placeholder="https://onepiece.fandom.com/wiki/Monkey_D._Luffy · https://baike.baidu.com/item/原神 · …"
            className="settings-input w-full text-sm mt-1" />
          <div className="text-[11px] text-muted-foreground mt-1">{ui.wiUrlHint}</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs" title={ui.wiEntriesTip}>{ui.wiEntries}</label>
            <input type="number" min={1} max={200} value={cfg.totalEntries} disabled={running}
              onChange={(e) => set({ totalEntries: num(e.target.value, 1, 200, 20) })}
              className="settings-input w-full text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs" title={ui.wiTokensTip}>{ui.wiTokens}</label>
            <input type="number" min={0} max={2000} step={50} value={cfg.tokensPerEntry} disabled={running}
              onChange={(e) => set({ tokensPerEntry: num(e.target.value, 0, 2000, 250) })}
              className="settings-input w-full text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs" title={ui.wiDepthTip}>{ui.wiDepth}</label>
            <input type="number" min={1} max={4} value={cfg.maxDepth} disabled={running}
              onChange={(e) => set({ maxDepth: num(e.target.value, 1, 4, 2) })}
              className="settings-input w-full text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs" title={ui.wiMaxPagesTip}>{ui.wiMaxPages}</label>
            <input type="number" min={1} max={500} value={cfg.maxPages} disabled={running}
              onChange={(e) => set({ maxPages: num(e.target.value, 1, 500, 60) })}
              className="settings-input w-full text-sm mt-1" />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-1.5" title={ui.wiAutoExpandTip}>
            <input type="checkbox" checked={cfg.autoExpand} disabled={running}
              onChange={(e) => set({ autoExpand: e.target.checked })} /> {ui.wiAutoExpand}
          </label>
          <label className="flex items-center gap-1.5" title={ui.wiCanonTip}>
            <input type="checkbox" checked={cfg.canonOnly} disabled={running}
              onChange={(e) => set({ canonOnly: e.target.checked })} /> {ui.wiCanonOnly}
          </label>
          <label className="flex items-center gap-1.5" title={ui.wiBatchesTip}>
            {ui.wiBatches}
            <input type="number" min={1} max={8} value={cfg.concurrentBatches} disabled={running}
              onChange={(e) => set({ concurrentBatches: num(e.target.value, 1, 8, 3) })}
              className="settings-input w-16 text-sm" />
          </label>
        </div>

        <div>
          <label className="text-xs">{ui.wiExtra}</label>
          <textarea value={cfg.extraInstructions} disabled={running} rows={2}
            onChange={(e) => set({ extraInstructions: e.target.value })}
            placeholder={ui.wiExtraPh}
            className="settings-input w-full text-sm mt-1" />
        </div>

        <div className="flex items-center gap-2">
          {!running && (
            <button onClick={start}
              className="px-4 py-2 rounded-md font-semibold text-white bg-primary flex items-center gap-2">
              <Play className="w-4 h-4" /> {hasResume ? ui.wiResume : ui.wiStart}
            </button>
          )}
          {running && (
            <>
              <button onClick={togglePause} className="px-3 py-2 rounded-md bg-amber-500/20 text-amber-500 flex items-center gap-1.5">
                <Pause className="w-4 h-4" /> {paused ? ui.wiContinue : ui.wiPause}
              </button>
              <button onClick={stop} className="px-3 py-2 rounded-md bg-red-500/20 text-red-500 flex items-center gap-1.5">
                <Square className="w-4 h-4" /> {ui.wiStop}
              </button>
            </>
          )}
          {!running && hasResume && (
            <button onClick={resetResume} className="px-3 py-2 rounded-md border border-border text-xs flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> {ui.wiResetResume}
            </button>
          )}
        </div>
      </div>

      {progress && (
        <div className="rounded-xl border border-border p-3 text-sm space-y-1">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>📄 {fmt(ui.wiProgPages, { n: progress.pagesCrawled })}</span>
            <span>🧺 {fmt(ui.wiProgQueue, { n: progress.pagesQueued })}</span>
            {progress.pagesDead > 0 && <span>💀 {fmt(ui.wiProgDead, { n: progress.pagesDead })}</span>}
            {progress.phase === 'generate' && (
              <span>📘 {progress.entriesCreated}/{progress.entriesTarget} entries</span>
            )}
            {progress.etaSeconds !== null && progress.etaSeconds > 0 && (
              <span>⏳ ~{progress.etaSeconds}s</span>
            )}
          </div>
          {progress.note && <div className="text-[11px] text-muted-foreground truncate">{progress.note}</div>}
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-xl border border-border bg-black/70 text-zinc-300 font-mono text-[11px] p-3 max-h-72 overflow-y-auto scrollbar-thin space-y-0.5">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
