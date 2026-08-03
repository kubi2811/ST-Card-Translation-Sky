/**
 * BatchGeneratorPanel — Tab "AI Sinh theo Batch" in Lorebook
 * Spec Phần 7.3.2: Config form + progress bar + log
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { VI_CHARS_PER_TOKEN } from '../../lib/ai/tokenBudget';
import { usePersistedState } from '../../lib/usePersistedState';
import {
  Play, Pause, Square, ChevronDown, ChevronRight,
  Zap, AlertCircle, Check, Loader2,
} from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useBatchRunStore } from '../../store/batchRunStore';
import { useAutoCreatorStore } from '../../store/autoCreatorStore';
import { useToastStore } from '../../store/toastStore';
import { runBatchGeneration, type BatchGenConfig } from '../../lib/ai/batchGenerator';
import { CompletionCriteriaPanel } from './CompletionCriteriaPanel';
import type { CompletionCriteria, VerificationReport } from '../../lib/completionVerifier/criteria';
import { DEFAULT_CRITERIA } from '../../lib/completionVerifier/criteria';
import { runWithVerification } from '../../lib/completionVerifier/verifier';
import {
  getPreset, getStrategyLabel, keywordHintUi,
  type EntryCategory, type CardType,
} from '../../lib/worldbook/worldbookConfig';
import { buildSchemaContextForBatch, getSchemaPreviewSummary } from '../../lib/mvuzod/schemaContextBuilder';
import { SingleThreadToggle } from '../shared/SingleThreadToggle';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import { t as ui, fmt } from '../../i18n';

const POSITION_LABELS: Record<number, string> = {
  0: '↑ Before Char', 1: '↓ After Char', 2: '📝 Top AN',
  3: '📝 Bot AN', 4: '@Depth', 5: '← Before Ex', 6: '→ After Ex', 7: '🔌 Outlet',
};

export function BatchGeneratorPanel() {
  const addEntry = useCardStore(s => s.addEntry);
  const card = useCardStore(s => s.card);
  const settings = useSettingsStore();

  // ─── Config state ───────────────────────────────────────────────────
  type TabKey = 'main_char' | 'multi_char' | 'worldview' | 'region' | 'scene' | 'secondary' | 'custom';

  interface TabData {
    id: TabKey;
    label: string;
    icon: string;
    cardType: CardType;
    category: EntryCategory;
    placeholder: string;
  }

  const TABS: TabData[] = useMemo(() => [
    { id: 'main_char', label: ui.tabMainChar, icon: '👑', cardType: 'single', category: 'character_detail', placeholder: ui.bgPhMainChar },
    { id: 'multi_char', label: ui.tabNpc, icon: '👥', cardType: 'multi', category: 'npc', placeholder: ui.bgPhNpc },
    { id: 'worldview', label: ui.tabWorldview, icon: '🌍', cardType: 'single', category: 'worldview', placeholder: ui.bgPhWorldview },
    { id: 'region', label: ui.tabRegion, icon: '🗺', cardType: 'single', category: 'region_overview', placeholder: ui.bgPhRegion },
    { id: 'scene', label: ui.tabScene, icon: '🏞', cardType: 'single', category: 'scene', placeholder: ui.bgPhScene },
    { id: 'secondary', label: ui.tabDirective, icon: '🎯', cardType: 'single', category: 'secondary_explanation', placeholder: ui.bgPhDirective },
    { id: 'custom', label: ui.tabCustom, icon: '⚙️', cardType: 'single', category: 'custom', placeholder: ui.bgPhCustom },
  ], []);

  const [activeTab, setActiveTab] = useState<TabKey>('main_char');
  // (User 2026 — "AI Sinh Theo Batch không lưu setting") TẤT CẢ thiết lập + ô nhập prompt nay dùng
  // usePersistedState → giữ nguyên khi chuyển tab / đổi trang / F5 / mở lại app. Trước đây là useState
  // thuần nên rời panel một cái là mất sạch, phải gõ lại từ đầu mỗi lần sinh batch.
  const [prompts, setPrompts] = usePersistedState<Record<TabKey, string>>('bgen.prompts', {
    main_char: '', multi_char: '', worldview: '', region: '', scene: '', secondary: '', custom: ''
  });

  const [useCardContext, setUseCardContext] = usePersistedState('bgen.useCardContext', true);
  const [useWebSearch, setUseWebSearch] = usePersistedState('bgen.useWebSearch', false);
  // Mặc định BẬT: nếu card có schema biến (MVU-ZOD, vd võ lực/trí lực), entry sinh ra sẽ bám theo
  // các chỉ số đó. Nếu card không có schema thì tự bỏ qua (mvuzodSchema=null → không inject).
  const [useSchemaContext, setUseSchemaContext] = usePersistedState('bgen.useSchemaContext', true);
  const [autoConfig, setAutoConfig] = usePersistedState('bgen.autoConfig', true);
  const [totalEntries, setTotalEntries] = usePersistedState('bgen.totalEntries', 10);
  const [entriesPerBatch, setEntriesPerBatch] = usePersistedState('bgen.entriesPerBatch', 5);
  const [concurrentBatches, setConcurrentBatches] = usePersistedState('bgen.concurrentBatches', 1);
  const [tokensPerEntry, setTokensPerEntry] = usePersistedState('bgen.tokensPerEntry', 200);
  const [defaultPosition, setDefaultPosition] = usePersistedState<0|1|2|3|4|5|6|7>('bgen.defaultPosition', 0);
  const [insertionOrderMode, setInsertionOrderMode] = usePersistedState<'same' | 'increment'>('bgen.insertionOrderMode', 'increment');
  const [insertionOrderStart, setInsertionOrderStart] = usePersistedState('bgen.insertionOrderStart', 100);
  const [showAdvanced, setShowAdvanced] = usePersistedState('bgen.showAdvanced', false);
  const [maxRetries, setMaxRetries] = usePersistedState('bgen.maxRetries', 2);
  const [maxConsecErrors, setMaxConsecErrors] = usePersistedState('bgen.maxConsecErrors', 3);
  const [modelOverride, setModelOverride] = usePersistedState('bgen.modelOverride', '');

  // ─── Run state (persistent store → không mất khi chuyển tab/trang giữa chừng) ───
  const isRunning = useBatchRunStore(s => s.isRunning);
  const isPaused = useBatchRunStore(s => s.isPaused);
  const progress = useBatchRunStore(s => s.progress);
  const logs = useBatchRunStore(s => s.logs);
  const addLog = useBatchRunStore(s => s.addLog);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ─── Completion Verification state ──────────────────────────────────
  // (User 19/07 — "Tiêu chí hoàn thành vẫn chưa lưu") Đây là setting DUY NHẤT còn dùng useState
  // thường trong panel — 17 cái kia đã persist đợt trước nhưng criteria bị sót → rời tab là reset
  // về DEFAULT_CRITERIA. Lưu nguyên object 1 key + spread default để thêm field mới không vỡ bản lưu cũ.
  const [criteriaSaved, setCriteriaSaved] = usePersistedState<CompletionCriteria>('bgen.criteria', DEFAULT_CRITERIA);
  const criteria = useMemo<CompletionCriteria>(() => ({ ...DEFAULT_CRITERIA, ...criteriaSaved }), [criteriaSaved]);
  const setCriteria = setCriteriaSaved;
  const [verifyReport, setVerifyReport] = useState<VerificationReport | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // (User 19/07) Nút Lưu tường minh: mọi setting vốn tự lưu qua usePersistedState, nhưng user
  // muốn một nút bấm để CHẮC CHẮN — ghi lại toàn bộ một lần nữa + toast xác nhận.
  const handleSaveSettings = useCallback(() => {
    try {
      localStorage.setItem('bgen.criteria', JSON.stringify(criteria));
      localStorage.setItem('bgen.prompts', JSON.stringify(prompts));
      useToastStore.getState().success(ui.bgSavedToast);
    } catch {
      useToastStore.getState().error(ui.bgSaveFailToast);
    }
  }, [criteria, prompts]);

  // (User 19/07) Bơm cấu hình AI Sinh Theo Batch vào bước Lorebook của Auto Creator:
  // map các field trùng khái niệm; minEntries lấy từ Tiêu chí hoàn thành (nếu bật).
  // (bug 134) Đổi từ NÚT BẤM sang CÔNG TẮC. User: "không rõ khi Reset trang thì cái AI Sinh
  // Theo Batch có tắt hay không" — đúng, vì nút bấm ghi giá trị vào vài ô cấu hình rời rạc rồi
  // biến mất, chẳng còn dấu vết nào để biết nó đang có hiệu lực. Nay trạng thái nằm ở MỘT khối
  // `appliedBatchPreset`: bật thì cả hai màn đều hiện, tắt thì trả cấu hình về đúng bản chụp.
  const appliedBatch = useAutoCreatorStore(s => s.config.appliedBatchPreset);

  const handleToggleAutoCreator = useCallback(() => {
    const store = useAutoCreatorStore.getState();
    if (store.config.appliedBatchPreset) {
      store.clearBatchPreset();
      useToastStore.getState().info(ui.bgUnappliedAcToast);
      return;
    }
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v) || lo));
    const tab = TABS.find(t => t.id === activeTab)!;
    const total = clamp(totalEntries, 5, 100);
    const prev = store.config.stepConfigs.lorebook;
    const patch = {
      totalEntries: total,
      minEntries: criteria.enabled ? clamp(criteria.minEntryCount ?? 0, 0, total) : 0,
      entriesPerBatch: clamp(entriesPerBatch, 1, 10),
      concurrentBatches: clamp(concurrentBatches, 1, 5),
      useWebSearch,
      category: tab.category,
      cardType: tab.cardType,
      promptOverride: prompts[activeTab]?.trim() || undefined,
      promptMode: (prompts[activeTab]?.trim() ? 'append' : 'default') as 'append' | 'default',
    };
    // Chụp ĐÚNG những khoá mình sắp ghi đè — tắt là hoàn nguyên chừng đó, không đụng phần khác.
    const previousConfig = Object.fromEntries(
      Object.keys(patch).map(k => [k, (prev as unknown as Record<string, unknown>)[k]]),
    ) as Partial<typeof prev>;

    store.applyBatchPreset({
      appliedAt: new Date().toISOString(),
      tabLabel: tab.label,
      summary: {
        totalEntries: patch.totalEntries,
        entriesPerBatch: patch.entriesPerBatch,
        concurrentBatches: patch.concurrentBatches,
        hasPrompt: !!patch.promptOverride,
      },
      previousConfig,
    }, patch);
    useToastStore.getState().success(ui.bgAppliedAcToast);
  }, [TABS, activeTab, totalEntries, entriesPerBatch, concurrentBatches, useWebSearch, prompts, criteria]);

  const totalBatches = useMemo(() => Math.ceil(totalEntries / entriesPerBatch), [totalEntries, entriesPerBatch]);
  const totalRounds = useMemo(() => Math.ceil(totalBatches / concurrentBatches), [totalBatches, concurrentBatches]);
  const activeProfile = useMemo(() => settings.profiles.find(p => p.id === settings.activeProfileId), [settings.profiles, settings.activeProfileId]);

  // Read MVUZOD schema from card store
  const mvuzodSchema = useMemo<MVUZODSchema | null>(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown>;
    if (ext?.mvuzod) {
      return (ext.mvuzod as Record<string, unknown>).schema as MVUZODSchema ?? null;
    }
    return null;
  }, [card.data.extensions]);

  const schemaPreview = useMemo(() => {
    if (!mvuzodSchema) return null;
    return getSchemaPreviewSummary(mvuzodSchema);
  }, [mvuzodSchema]);

  // ─── Handlers ───────────────────────────────────────────────────────

  const handleStart = useCallback(async (runAll: boolean) => {
    if (!activeProfile) {
      addLog(ui.wsNoProfile);
      return;
    }

    const tabsToRun = runAll
      ? TABS.filter(t => prompts[t.id].trim().length > 0)
      : [TABS.find(t => t.id === activeTab)!].filter(t => prompts[t.id].trim().length > 0);

    if (tabsToRun.length === 0) {
      addLog(ui.bgNeedPrompt);
      return;
    }

    const run = useBatchRunStore.getState();
    run.beginRun();
    run.setIsRunning(true);

    try {
      for (let i = 0; i < tabsToRun.length; i++) {
        if (useBatchRunStore.getState().stopped) break;
        
        const tab = tabsToRun[i];
        if (tabsToRun.length > 1) {
          addLog(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${fmt(ui.wsRunTab, { label: tab.label, i: i + 1, total: tabsToRun.length })}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        }
        
        const config: BatchGenConfig = {
          topicPrompt: prompts[tab.id].trim(),
          useCardContext,
          useWebSearch,
          totalEntries,
          entriesPerBatch,
          defaultPosition,
          insertionOrderMode,
          insertionOrderStart,
          maxRetriesPerBatch: maxRetries,
          maxConsecutiveErrors: maxConsecErrors,
          modelOverride: modelOverride || undefined,
          concurrentBatches,
          category: tab.category !== 'custom' ? tab.category : undefined,
          cardType: tab.cardType,
          autoConfig,
          tokensPerEntry: tokensPerEntry > 0 ? tokensPerEntry : undefined,
          schemaContext: useSchemaContext && mvuzodSchema
            ? buildSchemaContextForBatch(mvuzodSchema)
            : undefined,
        };

        await runBatchGeneration(config, {
          card: structuredClone(useCardStore.getState().card),
          profile: activeProfile,
          generationParams: settings.generationParams,
          get paused() { return useBatchRunStore.getState().isPaused; },
          get stopped() { return useBatchRunStore.getState().stopped; },
          get signal() { return useBatchRunStore.getState().abort?.signal; },
          log: addLog,
          onProgress: run.setProgress,
          appendEntry: (entry) => { addEntry(entry); },
        });

        // Run verification after batch if enabled
        if (criteria.enabled && !useBatchRunStore.getState().stopped) {
          setIsVerifying(true);
          addLog(`\n${fmt(ui.wsStartVerify, { label: tab.label })}`);
          const report = await runWithVerification(config, criteria, {
            card: structuredClone(useCardStore.getState().card),
            profile: activeProfile,
            generationParams: settings.generationParams,
            get stopped() { return useBatchRunStore.getState().stopped; },
            get signal() { return useBatchRunStore.getState().abort?.signal; },
            log: addLog,
            onReport: setVerifyReport,
            appendEntry: (entry) => { addEntry(entry); },
          });
          setVerifyReport(report);
          setIsVerifying(false);
        }
      }
    } catch (err) {
      addLog(fmt(ui.wsFatal, { msg: err instanceof Error ? err.message : String(err) }));
    }
    
    useBatchRunStore.getState().setIsRunning(false);
    setIsVerifying(false);
  }, [activeProfile, prompts, activeTab, TABS, useCardContext, useWebSearch, useSchemaContext, mvuzodSchema, totalEntries, entriesPerBatch, concurrentBatches,
      defaultPosition, insertionOrderMode, insertionOrderStart, maxRetries,
      maxConsecErrors, modelOverride, autoConfig, tokensPerEntry, settings.generationParams, addEntry, addLog, criteria]);

  const handlePause = useCallback(() => {
    const run = useBatchRunStore.getState();
    const next = !run.isPaused;
    run.setPaused(next);
    addLog(next ? ui.wsPause : ui.wsResume);
  }, [addLog]);

  const handleStop = useCallback(() => {
    useBatchRunStore.getState().setStopped(true);
    addLog(ui.wsStopping);
  }, [addLog]);

  // ─── Render ─────────────────────────────────────────────────────────

  const progressPercent = progress ? Math.round((progress.created / progress.total) * 100) : 0;

  return (
    <div className="space-y-5 p-5 max-w-2xl mx-auto">
      {/* Category Tabs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="settings-label text-sm mb-1 flex-1">{ui.bgPickTab}</label>
          {/* (bugNeedFix/183) Batch song song không nhìn thấy nhau ⇒ entry trùng na ná. */}
          <SingleThreadToggle />
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                  : prompts[tab.id].trim()
                    ? 'bg-emerald-600/10 border-emerald-500/50 text-emerald-400 opacity-80'
                    : 'bg-muted border-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
              disabled={isRunning}
            >
              <span>{tab.icon}</span> {tab.label}
              {prompts[tab.id].trim() && activeTab !== tab.id && <Check className="w-3 h-3 ml-1" />}
            </button>
          ))}
        </div>

        {/* Active Tab Textarea */}
        <div className="bg-muted/10 border border-border rounded-xl p-4 space-y-3 mt-1">
          <textarea
            value={prompts[activeTab]}
            onChange={e => setPrompts(p => ({ ...p, [activeTab]: e.target.value }))}
            rows={4}
            className="settings-input text-sm resize-y"
            disabled={isRunning}
            placeholder={TABS.find(t => t.id === activeTab)?.placeholder}
          />
          
          {/* Preset Info */}
          {(() => {
            const tab = TABS.find(t => t.id === activeTab);
            if (!tab || tab.category === 'custom') return null;
            const preset = getPreset(tab.category, tab.cardType);
            if (!preset) return null;
            const s = getStrategyLabel(preset.defaults.constant, preset.defaults.selective);
            return (
              <div className="text-xs space-y-1 text-muted-foreground pt-2 border-t border-border/50">
                <div className={`flex items-center gap-1.5 ${s.color}`}>
                  <span>{s.icon}</span>
                  <span className="font-medium">{s.label}</span>
                </div>
                <p className="text-[10px]">
                  pos={preset.defaults.position === 0 ? 'before_char' : preset.defaults.position === 1 ? 'after_char' : `@D${preset.defaults.depth}`}
                  {' · '}order={preset.defaults.insertion_order}
                  {preset.defaults.scan_depth !== null && ` · scan=${preset.defaults.scan_depth}`}
                  {ui.wsRecursive}
                </p>
                <p className="text-[10px] text-muted-foreground/60">{ui.wsKeywords}{keywordHintUi(preset.keywordHint)}</p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Context toggles */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={useCardContext} onChange={e => setUseCardContext(e.target.checked)}
            className="settings-checkbox" disabled={isRunning} />
          {ui.wsUseCardContext}
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer text-blue-400">
          <input type="checkbox" checked={useWebSearch} onChange={e => setUseWebSearch(e.target.checked)}
            className="settings-checkbox" disabled={isRunning} />
          {ui.wsWebSearch}
        </label>

        {/* Schema-aware toggle — only show when schema exists */}
        {mvuzodSchema && schemaPreview && (
          <div className={`rounded-lg border p-3 space-y-1.5 transition-colors ${
            useSchemaContext
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-border/50 bg-muted/10'
          }`}>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={useSchemaContext} onChange={e => setUseSchemaContext(e.target.checked)}
                className="settings-checkbox" disabled={isRunning} />
              <span className={`font-medium ${useSchemaContext ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                {ui.bgSchemaMode}
              </span>
            </label>
            <p className={`text-[10px] ml-6 ${useSchemaContext ? 'text-emerald-400/70' : 'text-muted-foreground/60'}`}>
              {ui.bgSchemaCurrent}{schemaPreview.summary}
            </p>
            {useSchemaContext && (
              <p className="text-[10px] ml-6 text-muted-foreground">
                {ui.bgSchemaHint}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Entries config */}
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="settings-label">{ui.wsTotalEntries}</label>
          <input type="number" value={totalEntries} onChange={e => setTotalEntries(Math.max(1, parseInt(e.target.value) || 1))}
            className="settings-input" min={1} max={500} disabled={isRunning} />
        </div>
        <div>
          <label className="settings-label">Entries / Batch</label>
          <input type="number" value={entriesPerBatch} onChange={e => setEntriesPerBatch(Math.max(1, parseInt(e.target.value) || 1))}
            className="settings-input" min={1} max={20} disabled={isRunning} />
        </div>
        <div>
          <label className="settings-label">Tokens / Entry</label>
          {/* (bug 196) Trần cũ 2000 chặn thẳng yêu cầu 3000-5000 token/entry của user. */}
          <input type="number" value={tokensPerEntry} onChange={e => setTokensPerEntry(Math.max(0, Math.min(6000, parseInt(e.target.value) || 0)))}
            className="settings-input" min={0} max={6000} step={50} disabled={isRunning}
            title={ui.bgTokensPerEntry} />
        </div>
        <div>
          {/* (bug 191) Thiết lập này giờ được TÔN TRỌNG thật: là trần số batch chạy cùng lúc
              (trước đây engine bỏ qua nó và luôn chạy hết ngân sách RPM của pool). */}
          <label className="settings-label" title={ui.bgConcurrentTip}>{ui.bgConcurrentLabel}</label>
          <input type="number" value={concurrentBatches} onChange={e => setConcurrentBatches(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
            className="settings-input" min={1} max={24} disabled={isRunning} title={ui.bgConcurrentTip} />
        </div>
      </div>

      {/* Token budget hint */}
      {tokensPerEntry > 0 && (
        <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400/80">
          {ui.bgTokensLine}<span className="font-medium text-amber-400">{tokensPerEntry}</span>{ui.bgTokensLine2}
          <span className="font-medium">{Math.round(tokensPerEntry * VI_CHARS_PER_TOKEN)}</span>{ui.bgTokensLine3}
          {tokensPerEntry <= 100 && ui.bgTokensShort}
          {tokensPerEntry > 100 && tokensPerEntry <= 300 && ui.bgTokensMedium}
          {tokensPerEntry > 300 && ui.bgTokensLong}
          {tokensPerEntry >= 1500 && (
            <span className="block mt-1">
              💡 Entry dài: tool sẽ tự rút số entry mỗi lô và nâng trần output cho vừa — số lượt gọi AI
              sẽ tăng. Nếu vẫn hụt, nâng trần output của model trong Cài đặt.
            </span>
          )}
        </div>
      )}

      {/* Calculated batches */}
      <div className="px-3 py-2 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
        {ui.wsWillCall}<span className="text-foreground font-medium">{totalBatches}</span>{ui.wsWillCall2}
        {concurrentBatches > 1 && (
          <> (<span className="text-foreground font-medium">{totalRounds}</span>{ui.wsRounds}{concurrentBatches}{ui.wsRoundsParallel}</>)}
      </div>

      {/* AI Auto-Config Toggle */}
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={autoConfig} onChange={e => setAutoConfig(e.target.checked)}
            className="settings-checkbox" disabled={isRunning} />
          <span className="font-medium text-violet-400">{ui.wsAutoConfig}</span>
        </label>
        {autoConfig && (
          <p className="text-[10px] text-muted-foreground ml-6">
            {ui.wsAutoConfigHint}<code className="px-1 py-0.5 rounded bg-muted">insertion_order</code>,{' '}
            <code className="px-1 py-0.5 rounded bg-muted">position</code>,{' '}
            <code className="px-1 py-0.5 rounded bg-muted">depth</code>,{' '}
            <code className="px-1 py-0.5 rounded bg-muted">constant/selective</code>{' '}
            {ui.bgAutoConfigHint2}
          </p>
        )}
      </div>

      {/* Position & Insertion Order — chỉ hiện khi tắt autoConfig */}
      {!autoConfig && (
        <>
          {/* Position */}
          <div>
            <label className="settings-label">{ui.wsDefaultPosition}</label>
            <select value={defaultPosition} onChange={e => setDefaultPosition(Number(e.target.value) as 0|1|2|3|4|5|6|7)}
              className="settings-input" disabled={isRunning}>
              {Object.entries(POSITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {/* Insertion order */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="settings-label">Insertion Order</label>
              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" name="ioMode" checked={insertionOrderMode === 'same'} disabled={isRunning}
                    onChange={() => setInsertionOrderMode('same')} className="settings-checkbox" /> {ui.wsKeepOrder}
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" name="ioMode" checked={insertionOrderMode === 'increment'} disabled={isRunning}
                    onChange={() => setInsertionOrderMode('increment')} className="settings-checkbox" /> {ui.wsIncrementOrder}
                </label>
              </div>
            </div>
            <div>
              <label className="settings-label">{ui.wsStartFrom}</label>
              <input type="number" value={insertionOrderStart}
                onChange={e => setInsertionOrderStart(parseInt(e.target.value) || 100)}
                className="settings-input" min={0} disabled={isRunning} />
            </div>
          </div>
        </>
      )}

      {/* Advanced */}
      <div className="rounded-xl border border-border overflow-hidden">
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
          {ui.wsAdvanced}
          {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 pt-3 border-t border-border space-y-3">
            <div>
              <label className="settings-label">{ui.wsModelOverride}</label>
              <input type="text" value={modelOverride} onChange={e => setModelOverride(e.target.value)}
                className="settings-input text-xs font-mono" placeholder="gpt-4o-mini" disabled={isRunning} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="settings-label">Max Retries / Batch</label>
                <input type="number" value={maxRetries} onChange={e => setMaxRetries(parseInt(e.target.value) || 2)}
                  className="settings-input" min={0} max={5} disabled={isRunning} />
              </div>
              <div>
                <label className="settings-label">Max Consecutive Errors</label>
                <input type="number" value={maxConsecErrors} onChange={e => setMaxConsecErrors(parseInt(e.target.value) || 3)}
                  className="settings-input" min={1} max={10} disabled={isRunning} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Completion Criteria */}
      <CompletionCriteriaPanel
        criteria={criteria}
        onChange={setCriteria}
        report={verifyReport}
        isVerifying={isVerifying}
      />

      {/* (User 19/07) Nút Lưu tường minh + nút Áp dụng cấu hình sang Auto Creator.
          Mọi setting vốn đã TỰ lưu (usePersistedState) — nút Lưu ghi lại lần nữa và báo toast
          để bạn yên tâm là đã nằm trong máy; nút Áp dụng bơm cấu hình tương ứng vào bước
          Lorebook của Auto Creator (tab 🪄), khỏi phải chỉnh 2 nơi. */}
      <div className="flex flex-wrap gap-2">
        <button onClick={handleSaveSettings}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/50 bg-emerald-600/15 text-emerald-400 text-sm font-medium hover:bg-emerald-600/25 transition-colors">
          💾 {ui.bgSaveBtn}
        </button>
        {/* (bug 134) CÔNG TẮC, không phải nút bấm: nhìn là biết đang bật hay tắt. */}
        <button onClick={handleToggleAutoCreator}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
            appliedBatch
              ? 'border-purple-400 bg-purple-600/30 text-purple-200'
              : 'border-purple-500/50 bg-purple-600/15 text-purple-400 hover:bg-purple-600/25'
          }`}
          title={appliedBatch ? ui.bgApplyAcOnTip : ui.bgApplyAcTip}>
          <span className={`inline-flex items-center w-8 h-4 rounded-full px-0.5 transition-colors ${appliedBatch ? 'bg-purple-400/80 justify-end' : 'bg-muted-foreground/30 justify-start'}`}>
            <span className="w-3 h-3 rounded-full bg-white/90" />
          </span>
          🪄 {ui.bgApplyAcBtn}
          <span className="text-[10px] opacity-80">{appliedBatch ? ui.bgApplyAcOn : ui.bgApplyAcOff}</span>
        </button>
      </div>
      {appliedBatch && (
        <p className="text-[11px] text-purple-300/90">
          {fmt(ui.bgApplyAcActiveNote, {
            tab: appliedBatch.tabLabel,
            total: appliedBatch.summary.totalEntries,
            per: appliedBatch.summary.entriesPerBatch,
          })}
        </p>
      )}

      {/* Control buttons */}
      <div className="flex gap-2">
        {!isRunning ? (
          <>
            <button onClick={() => handleStart(false)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/50 font-medium text-sm hover:bg-blue-600/30 transition-colors">
              <Play className="w-4 h-4" /> {ui.wsRunCurrent}
            </button>
            <button onClick={() => handleStart(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
              <Zap className="w-4 h-4" /> {ui.wsRunAll}
            </button>
          </>
        ) : (
          <>
            <button onClick={handlePause}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm hover:bg-muted transition-colors">
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {isPaused ? ui.wsResumeBtn : ui.wsPauseBtn}
            </button>
            <button onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 text-destructive text-sm hover:bg-destructive/20 transition-colors">
              <Square className="w-4 h-4" /> {ui.wsStopBtn}
            </button>
          </>
        )}
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              Batch {progress.batch}/{progress.totalBatches}
            </span>
            <span className="text-foreground font-medium">
              {progress.created}/{progress.total} entries
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            {progress.status === 'running' && <><Loader2 className="w-3 h-3 animate-spin text-primary" /> {ui.bgRunning}</>}
            {progress.status === 'paused' && <><Pause className="w-3 h-3 text-amber-400" /> {ui.wsPaused}</>}
            {progress.status === 'done' && <><Check className="w-3 h-3 text-emerald-400" /> {ui.wsDone}</>}
            {progress.status === 'error' && <><AlertCircle className="w-3 h-3 text-destructive" /> {ui.wsError}</>}
            {progress.status === 'stopped' && <><Square className="w-3 h-3 text-muted-foreground" /> {ui.wsStopped}</>}
          </div>
        </div>
      )}

      {/* Summary banner */}
      {progress && (progress.status === 'done' || progress.status === 'stopped') && (
        <div className={`rounded-xl p-4 border text-sm ${
          progress.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-muted border-border text-muted-foreground'
        }`}>
          {progress.status === 'done'
            ? fmt(ui.wsDoneMsg, { created: progress.created, total: progress.total })
            : fmt(ui.wsStoppedMsg, { created: progress.created, total: progress.total })}
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">
            Log ({logs.length})
          </div>
          <div className="max-h-60 overflow-y-auto scrollbar-thin px-4 py-2 space-y-0.5">
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
