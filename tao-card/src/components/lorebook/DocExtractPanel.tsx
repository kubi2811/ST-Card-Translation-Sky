/**
 * DocExtractPanel — Tab "Trích Xuất Tài Liệu" in Lorebook
 * Spec Phần 7.4: Drag-drop .txt, chunking, extraction pipeline
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  FileText, Upload, Play, Square,
  Loader2, Check, AlertCircle,
} from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { splitDocument, runDocumentExtraction, type DocExtractConfig, type DocExtractProgress } from '../../lib/ai/documentChunker';
import {
  ENTRY_CATEGORY_LABELS, getPreset, getStrategyLabel,
  type EntryCategory, type CardType,
} from '../../lib/worldbook/worldbookConfig';
import { DEFAULT_STEPS } from '../../lib/ai/worldbuildingDefaults';
import { safeSetItem } from '../../lib/safeStorage';
import { parseEpubToText, isEpubFile } from '../../lib/ai/epubParser';
import { useToastStore } from '../../store/toastStore';
import { t as ui, fmt } from '../../i18n';

const POSITION_LABELS: Record<number, string> = {
  0: '↑ Before Char', 1: '↓ After Char', 2: '📝 Top AN',
  3: '📝 Bot AN', 4: '@Depth', 5: '← Before Ex', 6: '→ After Ex', 7: '🔌 Outlet',
};

export function DocExtractPanel() {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const settings = useSettingsStore();

  // File state
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; text: string; chunks: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Config
  const [instructions, setInstructions] = useState('');
  const [useCardContext, setUseCardContext] = useState(true);
  const [defaultPosition, setDefaultPosition] = useState<0|1|2|3|4|5|6|7>(0);
  const [insertionOrderStart, setInsertionOrderStart] = useState(100);
  const [entryCategory, setEntryCategory] = useState<EntryCategory>('custom');
  const [cardType, setCardType] = useState<CardType>('single');
  // Số ký tự mỗi chunk (mặc định cũ 15k quá nhỏ — cho chỉnh; càng lớn càng ít call API
  // nhưng cần model có context lớn hơn). Nhớ giữa các phiên qua localStorage.
  const [chunkSize, setChunkSize] = useState<number>(() => {
    const v = Number(localStorage.getItem('doc-extract-chunk-size'));
    return v >= 2000 ? v : 30000;
  });

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<DocExtractProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const stoppedRef = useRef(false);
  // AbortController hủy call AI đang bay khi Dừng (stopped chỉ chặn call kế tiếp).
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Đổi kích thước chunk → lưu lại + cập nhật số chunk hiển thị
  useEffect(() => {
    safeSetItem('doc-extract-chunk-size', String(chunkSize));
    setFileInfo(prev => prev ? { ...prev, chunks: splitDocument(prev.text, { chunkSize }).length } : prev);
  }, [chunkSize]);

  const activeProfile = settings.profiles.find(p => p.id === settings.activeProfileId);

  const toastError = useToastStore(s => s.error);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ─── File handling ──────────────────────────────────────────────────

  /** Nạp text đã đọc xong vào state + báo số chunk (dùng chung cho mọi định dạng). */
  const acceptText = useCallback((file: File, text: string) => {
    const chunks = splitDocument(text, { chunkSize });
    setFileInfo({ name: file.name, size: file.size, text, chunks: chunks.length });
    addLog(fmt(ui.deLoaded, { name: file.name, kb: (file.size / 1024).toFixed(1), chunks: chunks.length, size: chunkSize.toLocaleString() }));
  }, [addLog, chunkSize]);

  const handleFile = useCallback(async (file: File) => {
    // .epub là ZIP chứa XHTML → phải giải nén lấy chữ trước, rồi mới đi tiếp luồng chunk như .txt.
    if (isEpubFile(file)) {
      addLog(ui.deEpubParsing);
      try {
        const text = await parseEpubToText(file);
        acceptText(file, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(fmt(ui.deEpubFailed, { err: msg }));
        toastError(msg);
      }
      return;
    }

    if (!file.name.match(/\.(txt|md|text)$/i)) {
      addLog(ui.deOnlyTxt);
      toastError(ui.deOnlyTxt);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => acceptText(file, reader.result as string);
    reader.onerror = () => {
      addLog(ui.deOnlyTxt);
      toastError(ui.deOnlyTxt);
    };
    reader.readAsText(file);
  }, [addLog, acceptText]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.text,.epub,application/epub+zip';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFile(file);
    };
    input.click();
  }, [handleFile]);

  // ─── Run extraction ─────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!fileInfo || !activeProfile) return;
    setIsRunning(true);
    setLogs([]);
    setProgress(null);
    stoppedRef.current = false;
    abortRef.current = new AbortController();

    const chunks = splitDocument(fileInfo.text, { chunkSize });
    const config: DocExtractConfig = {
      additionalInstructions: instructions,
      useCardContext,
      defaultPosition,
      insertionOrderStart,
      maxRetriesPerChunk: 2,
      category: entryCategory !== 'custom' ? entryCategory : undefined,
      cardType,
    };

    try {
      await runDocumentExtraction(chunks, config, {
        card: structuredClone(card),
        profile: activeProfile,
        generationParams: settings.generationParams,
        get stopped() { return stoppedRef.current; },
        signal: abortRef.current.signal,
        log: addLog,
        onProgress: setProgress,
        appendEntry: (entry) => addEntry(entry),
        deleteEntry: (id) => useCardStore.getState().deleteEntry(id),
        updateEntry: (id, patch) => useCardStore.getState().updateEntry(id, patch),
      });
    } catch (err) {
      addLog(fmt(ui.deError, { msg: err instanceof Error ? err.message : String(err) }));
    }
    setIsRunning(false);
  }, [fileInfo, activeProfile, instructions, useCardContext, defaultPosition, insertionOrderStart, card, settings.generationParams, addEntry, addLog, entryCategory, cardType, chunkSize]);

  return (
    <div className="space-y-5 p-5 max-w-2xl mx-auto">
      {/* Drop zone */}
      <div onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={handleFileInput}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
        }`}>
        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{fmt(ui.deDropHint, { ext: '.txt, .epub' })}</p>
      </div>

      {/* File info */}
      {fileInfo && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{fileInfo.name}</p>
            <p className="text-xs text-muted-foreground">
              {(fileInfo.size / 1024).toFixed(1)} KB · ~{fileInfo.chunks} chunks
            </p>
          </div>
          <button onClick={() => setFileInfo(null)} className="text-xs text-muted-foreground hover:text-foreground">{ui.deRemove}</button>
        </div>
      )}

      {/* Instructions */}
      <div>
        <label className="settings-label">{ui.deInstructions}</label>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
          rows={3} className="settings-input text-sm resize-y" disabled={isRunning}
          placeholder={ui.deInstructionsPh} />
      </div>

      {/* Chunk size — số ký tự mỗi lần quét (mỗi chunk = 1 call API) */}
      <div>
        <label className="settings-label">{ui.deChunkSize}</label>
        <input type="number" value={chunkSize} min={2000} max={500000} step={5000}
          onChange={e => setChunkSize(Math.max(2000, Number(e.target.value) || 30000))}
          className="settings-input" disabled={isRunning} />
        <p className="text-xs text-muted-foreground mt-1">
          {ui.deChunkHint}
          {fileInfo && <>{ui.deChunkDoc}<b>{fileInfo.chunks}</b>{ui.deChunkDoc2}<b>{fileInfo.chunks}</b>{ui.deChunkDoc3}</>}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={useCardContext} onChange={e => setUseCardContext(e.target.checked)}
          className="settings-checkbox" disabled={isRunning} />
        {ui.deUseCardContext}
      </label>

      {/* Entry Category Selector */}
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="settings-label">{ui.deCardType}</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name="de-cardType" checked={cardType === 'single'}
                  onChange={() => setCardType('single')} className="settings-checkbox" disabled={isRunning} />
                {ui.deSingleChar}
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name="de-cardType" checked={cardType === 'multi'}
                  onChange={() => setCardType('multi')} className="settings-checkbox" disabled={isRunning} />
                {ui.deMultiChar}
              </label>
            </div>
          </div>
          <div>
            <label className="settings-label">{ui.deEntryCategory}</label>
            <select value={entryCategory} onChange={e => setEntryCategory(e.target.value as EntryCategory)}
              className="settings-input text-xs" disabled={isRunning}>
              {Object.entries(ENTRY_CATEGORY_LABELS).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>
        </div>
        {entryCategory !== 'custom' && (() => {
          const preset = getPreset(entryCategory, cardType);
          if (!preset) return null;
          const s = getStrategyLabel(preset.defaults.constant, preset.defaults.selective);
          return (
            <div className={`flex items-center gap-1.5 text-xs ${s.color}`}>
              <span>{s.icon}</span>
              <span className="font-medium">{s.label}</span>
            </div>
          );
        })()}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="settings-label">{ui.deDefaultPosition}</label>
          <select value={defaultPosition} onChange={e => setDefaultPosition(Number(e.target.value) as 0|1|2|3|4|5|6|7)}
            className="settings-input" disabled={isRunning}>
            {Object.entries(POSITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="settings-label">{ui.deInsertionOrder}</label>
          <input type="number" value={insertionOrderStart}
            onChange={e => setInsertionOrderStart(parseInt(e.target.value) || 100)}
            className="settings-input" min={0} disabled={isRunning} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        {!isRunning ? (
          <button onClick={handleStart} disabled={!fileInfo || !activeProfile}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
            <Play className="w-4 h-4" /> {ui.deStart}
          </button>
        ) : (
          <button onClick={() => { stoppedRef.current = true; abortRef.current?.abort('stopped'); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 text-destructive text-sm">
            <Square className="w-4 h-4" /> {ui.deStop}
          </button>
        )}
      </div>

      {/* Quy trình bước đang chạy */}
      {activeProfile && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {fmt(ui.deSteps, { count: (activeProfile.steps || DEFAULT_STEPS).filter(s => s.enabled).length })}
          </h3>
          <div className="space-y-1.5 pt-1">
            {(activeProfile.steps || DEFAULT_STEPS).filter(s => s.enabled).map((step, idx) => {
              const isActive = isRunning && progress && progress.status === 'running' && progress.chunk === idx + 1;
              const isDone = isRunning && progress && progress.status === 'running' && progress.chunk > idx + 1;
              const isFinished = progress && progress.status === 'done';
              
              return (
                <div key={step.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center font-mono text-[9px] ${
                    isActive ? 'bg-primary text-primary-foreground font-bold animate-pulse' :
                    (isDone || isFinished) ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {idx + 1}
                  </span>
                  <span className={`${
                    isActive ? 'text-primary font-medium' :
                    (isDone || isFinished) ? 'text-muted-foreground line-through decoration-emerald-500/20 font-light' :
                    'text-muted-foreground'
                  }`}>
                    {step.name} {step.singleton && <span className="text-[10px] text-amber-500 font-normal opacity-85">(Singleton)</span>}
                  </span>
                  {isActive && <Loader2 className="w-3 h-3 animate-spin text-primary ml-auto" />}
                  {(isDone || isFinished) && <Check className="w-3 h-3 text-emerald-400 ml-auto" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              {progress.status === 'done' ? ui.deDone : fmt(ui.deProcessing, { chunk: progress.chunk, total: progress.totalChunks })}
            </span>
            <span className="text-foreground font-medium">{fmt(ui.deEntriesCreated, { count: progress.entriesCreated })}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round((progress.chunk / progress.totalChunks) * 100)}%` }} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            {progress.status === 'running' && <><Loader2 className="w-3 h-3 animate-spin text-primary" /> {ui.deRunning}</>}
            {progress.status === 'done' && <><Check className="w-3 h-3 text-emerald-400" /> {ui.deAllDone}</>}
            {progress.status === 'error' && <><AlertCircle className="w-3 h-3 text-destructive" /> {ui.deErrorShort}</>}
          </div>
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">
            Log ({logs.length})
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-thin px-4 py-2 space-y-0.5">
            {logs.map((log, i) => (
              <div key={i} className="text-xs font-mono text-muted-foreground leading-relaxed">{log}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
