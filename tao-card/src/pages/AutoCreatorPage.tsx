import { useState, useRef, useEffect } from 'react';
import {
  Wand2, Play, Pause, Square, RotateCcw, Eye, Check,
  CheckCircle2, Circle, Loader2, ChevronRight, ChevronDown,
  AlertTriangle, Settings2, Hash, BookOpen, User, Terminal,
  MessageSquare, Sparkles, SkipForward, Edit3, Zap, Moon, Cog,
  Maximize2, X, Wrench, PlayCircle,
  type LucideIcon
} from 'lucide-react';
import { useAutoCreatorStore } from '../store/autoCreatorStore';
import { useCardStore } from '../store/cardStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { runAutoCreatorPipeline, retrySingleStep, skipStep, applyStepPreview, runAutoRepair, runFullVerifyCycle } from '../lib/ai/autoCreatorPipeline';
import { runMinhNguyetPipeline, retryMnStep, skipMnStep } from '../lib/ai/minhNguyetPipeline';
import { AUTO_CREATOR_PRESETS } from '../lib/ai/autoCreatorPresets';
import { MINH_NGUYET_STEP_LABELS } from '../prompts/minhNguyetTemplates';
import type { AutoCreatorStep, MinhNguyetStep, AnyPipelineStep } from '../types';
import { cn } from '../lib/utils';
import { t as ui, fmt } from '../i18n';
import { PreviewTunerModal } from '../components/autocreator/PreviewTunerModal';
import { SingleThreadToggle } from '../components/shared/SingleThreadToggle';
import { WAND_MODES, type WandMode } from '../lib/ai/ideaPolish';
import { tuningUsable } from '../lib/ai/cardTuning';

// (User 19/07) Thứ tự hiển thị khớp thứ tự CHẠY mới: mvuzod trước regex (regex bám schema),
// game_ui sau mvuzod, final_check cuối cùng.
const STEP_DEFS: { id: AutoCreatorStep; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'basic_info', label: ui.acStepBasicInfo, icon: User, desc: 'Name, Description, Personality, Scenario' },
  { id: 'lorebook', label: 'Lorebook Entries', icon: BookOpen, desc: ui.acStepLorebookDesc },
  { id: 'mvuzod', label: 'MVUZOD Schema', icon: Hash, desc: ui.acStepMvuzodDesc },
  // (bug 215) User: "game ui và regex có thể hợp lại thành một". Hai bước này vốn là MỘT việc —
  // dựng lớp hiển thị của thẻ từ schema MVU: game_ui đẻ ra script giao diện (status bar / opening
  // form), regex đẻ ra script bám đúng tên biến của schema đó. Cả hai cùng phụ thuộc `mvuzod`,
  // cùng ghi vào `extensions.regex_scripts`, và tách ra chỉ tổ bắt user tick hai ô cho một việc.
  //
  // GỘP Ở LỚP TRÌNH BÀY, không đụng pipeline: hai bước vẫn chạy tuần tự đúng thứ tự cũ (game_ui
  // rồi regex) nên DAG, phần chạy lại từng bước, và mọi config đã lưu của user đều còn nguyên.
  { id: 'game_ui', label: 'Giao diện & Regex', icon: Settings2, desc: 'Status bar / Opening form + bộ regex bám tên biến schema' },
  { id: 'regex', label: 'Regex Scripts', icon: Settings2, desc: ui.acStepRegexDesc },
  { id: 'system_prompt', label: 'System Prompt', icon: Terminal, desc: ui.acStepSysPromptDesc },
  { id: 'first_message', label: 'First Message', icon: MessageSquare, desc: ui.acStepFirstMesDesc },
  { id: 'mes_example', label: 'Message Examples', icon: MessageSquare, desc: ui.acStepMesExampleDesc },
  { id: 'final_check', label: ui.acStepFinalCheck, icon: CheckCircle2, desc: ui.acStepFinalCheckDesc },
];

/**
 * (bug 215) BƯỚC GỘP Ở LỚP TRÌNH BÀY — khoá là bước "chủ" (hiện thẻ), giá trị là các bước bị gộp
 * vào nó. Bước con không hiện thẻ riêng, không hiện dòng tiến trình riêng; tick/bỏ tick ở thẻ chủ
 * là áp cho cả cụm. Pipeline không hề biết tới chuyện gộp này.
 */
const MERGED_STEPS: Partial<Record<AutoCreatorStep, AutoCreatorStep[]>> = {
  game_ui: ['regex'],
};
/** Các bước ĐANG bị gộp vào bước khác — bỏ qua khi liệt kê. */
const MERGED_CHILDREN = new Set<AutoCreatorStep>(
  Object.values(MERGED_STEPS).flat() as AutoCreatorStep[],
);
/** Cụm của một bước chủ: chính nó + các bước con (dùng cho tick chung, gộp trạng thái). */
const stepGroup = (step: AutoCreatorStep): AutoCreatorStep[] => [step, ...(MERGED_STEPS[step] ?? [])];

/** Nhãn hiển thị của preset. Giữ `AUTO_CREATOR_PRESETS` nguyên vẹn (config là dữ liệu). */
const PRESET_UI: Record<string, { label: string; desc: string }> = {
  romance_simple: { label: ui.acPresetRomance, desc: ui.acPresetRomanceDesc },
  rpg_complex:    { label: ui.acPresetRpg, desc: ui.acPresetRpgDesc },
  slice_of_life:  { label: ui.acPresetSol, desc: ui.acPresetSolDesc },
  wuxia_xianxia:  { label: ui.acPresetWuxia, desc: ui.acPresetWuxiaDesc },
  multi_char:     { label: ui.acPresetMulti, desc: ui.acPresetMultiDesc },
  mn_romance:     { label: ui.acPresetMnRomance, desc: ui.acPresetMnRomanceDesc },
  mn_deep_character: { label: ui.acPresetMnDeep, desc: ui.acPresetMnDeepDesc },
  mn_large_world: { label: ui.acPresetMnWorld, desc: ui.acPresetMnWorldDesc },
};

/**
 * Nhãn hiển thị của các bước Minh Nguyệt.
 * KHÔNG i18n hoá `MINH_NGUYET_STEP_LABELS.label` — chuỗi đó đi thẳng vào prompt AI
 * (lib/ai/minhNguyetPipeline.ts). Ở đây chỉ thay phần người dùng nhìn thấy; `icon`
 * vẫn lấy từ bảng gốc.
 */
const MN_UI: Record<string, { label: string; desc: string }> = {
  worldview:             { label: ui.mnWorldview, desc: ui.mnWorldviewDesc },
  character_basic:       { label: ui.mnCharacterBasic, desc: ui.mnCharacterBasicDesc },
  color_palette:         { label: ui.mnColorPalette, desc: ui.mnColorPaletteDesc },
  three_faces:           { label: ui.mnThreeFaces, desc: ui.mnThreeFacesDesc },
  secondary_explanation: { label: ui.mnSecondaryExplanation, desc: ui.mnSecondaryExplanationDesc },
  wardrobe:              { label: ui.mnWardrobe, desc: ui.mnWardrobeDesc },
  nsfw_palette:          { label: ui.mnNsfwPalette, desc: ui.mnNsfwPaletteDesc },
  npc_creation:          { label: ui.mnNpcCreation, desc: ui.mnNpcCreationDesc },
  character_overview:    { label: ui.mnCharacterOverview, desc: ui.mnCharacterOverviewDesc },
  opening:               { label: ui.mnOpening, desc: ui.mnOpeningDesc },
};

export function AutoCreatorPage() {
  const store = useAutoCreatorStore();
  // (bug 155-2) Cấu hình Auto Creator phải theo TỪNG CARD. Trước đây chỉ có MỘT bản dùng chung
  // nên mở card khác vẫn thấy ý tưởng / quy tắc / schema của card trước — rồi vô tình tạo card
  // mới bằng dữ liệu card cũ. Gắn theo project đang mở; đổi card là tự cất bản cũ, lấy bản mới.
  const currentProjectId = useCardStore(s => s.currentProjectId);
  useEffect(() => {
    useAutoCreatorStore.getState().bindProject(currentProjectId);
  }, [currentProjectId]);
  const settings = useSettingsStore();
  const activeProfile = settings.getActiveProfile();
  const isMinhNguyet = store.config.pipelineMethod === 'minh_nguyet';
  
  const [expandedStep, setExpandedStep] = useState<AnyPipelineStep | null>(null);
  const [showPromptOverride, setShowPromptOverride] = useState<AutoCreatorStep | null>(null);
  const [showMnPromptOverride, setShowMnPromptOverride] = useState<MinhNguyetStep | null>(null);
  const [ideaExpanded, setIdeaExpanded] = useState(false); // ô "Ý tưởng của bạn" phóng to toàn màn hình
  const [isPolishing, setIsPolishing] = useState(false);   // (bug 137) đũa thần đang chạy
  const [wandMenuOpen, setWandMenuOpen] = useState(false); // (bug 185) menu 3 chế độ đũa thần
  const [tunerOpen, setTunerOpen] = useState(false);       // (bug 141) wizard Xem trước & Tinh chỉnh

  /**
   * (bug 137 → 185) CÂY ĐŨA THẦN — nay 3 chế độ: polish (sắp xếp 1-1), world (phác thảo thế
   * giới), enrich (làm giàu). Chốt chặn máy dùng CHUNG: mọi TÊN RIÊNG và CON SỐ của bản gốc
   * phải còn nguyên trong bản mới — hai chế độ mới được THÊM nhưng không được LÀM RƠI; rơi cái
   * nào là TỪ CHỐI bản đó, giữ nguyên văn của user và nói rõ vì sao.
   */
  const handlePolishIdea = async (mode: WandMode = 'polish') => {
    const toast = useToastStore.getState();
    if (!activeProfile) { toast.warning(ui.acNeedProfile); return; }
    const original = store.config.idea;
    setWandMenuOpen(false);
    setIsPolishing(true);
    try {
      const { callAI } = await import('../lib/ai/client');
      const { buildWandMessages, parseIdeaPolishResponse, verifyIdeaPolish, WAND_MODES } = await import('../lib/ai/ideaPolish');
      const { buildWandStyleContext, recordWandRun } = await import('../lib/ai/wandMemory');
      const modeLabel = WAND_MODES.find(m => m.id === mode)?.label ?? 'Đũa thần';
      // (bug 185) Hồ sơ học từ các lần trước — AI thích nghi với cách user tổ chức ý tưởng.
      const styleContext = buildWandStyleContext();

      // (bugNeedFix/145) Rơi chi tiết thì THỬ LẠI có chỉ đích danh, chứ không bắt user tự bấm
      // lại — lần sau AI cũng hỏng y hệt nếu không ai nói nó sai chỗ nào. Chỉ khi lượt sửa
      // cũng rơi mới chịu thua và giữ nguyên văn gốc.
      let polishedIdea = '';
      let suggestedRules: string[] = [];
      let dropped: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await callAI({
          profile: activeProfile,
          params: {
            ...settings.generationParams,
            // polish là việc biên tập — lạnh; world/enrich là việc sáng tác — cần nhiệt.
            temperature: mode === 'polish' ? 0.2 : 0.7,
            useJsonResponseFormat: true, stream: false,
          },
          messages: buildWandMessages(mode, original, {
            droppedLastTime: attempt > 0 ? dropped : undefined,
            styleContext,
          }),
          label: attempt === 0 ? modeLabel : `${modeLabel} (bù chi tiết rơi)`,
        });
        const parsed = parseIdeaPolishResponse(res.text);
        const check = verifyIdeaPolish(original, parsed.polishedIdea);
        if (check.ok) {
          polishedIdea = parsed.polishedIdea;
          suggestedRules = parsed.suggestedRules;
          dropped = [];
          break;
        }
        dropped = check.dropped;
      }
      if (!polishedIdea) {
        toast.error(fmt(ui.acPolishDropped, { tokens: dropped.slice(0, 4).join(', ') }));
        return;   // ý gốc vỡ cả hai lượt → giữ nguyên văn gốc, không âm thầm đổi ý user
      }
      store.setIdea(polishedIdea);
      // (bug 185) Ghi dấu vết CẤU TRÚC (không lưu nguyên văn) để lần sau AI có hồ sơ mà thích nghi.
      recordWandRun(mode, original, polishedIdea);
      // (bug 142 — 137↔141) Đũa thần ĐỔI văn bản ý tưởng ⇒ bản schema đã duyệt ở "Xem trước &
      // Tinh chỉnh" (nếu có) hết hiệu lực theo thiết kế ideaSig. Nói thẳng thay vì để user
      // chạy pipeline rồi mới thấy log "bị bỏ qua".
      if (store.config.tuning?.confirmed) {
        toast.info(ui.acPolishTuningReset);
      }
      if (suggestedRules.length > 0) {
        const cur = store.config.userRules.trim();
        const fresh = suggestedRules.filter(r => !cur.includes(r.replace(/^[-•\s]+/, '').slice(0, 40)));
        if (fresh.length > 0) {
          store.setUserRules([cur, `--- Quy tắc rút từ ý tưởng (đũa thần) ---`, ...fresh.map(r => r.startsWith('-') ? r : `- ${r}`)]
            .filter(Boolean).join('\n'));
        }
      }
      toast.success(fmt(ui.acPolishDone, { rules: suggestedRules.length }));
    } catch (e) {
      toast.error(`${ui.acPolishFail}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsPolishing(false);
    }
  };
  const [repairing, setRepairing] = useState(false); // (việc 82) đang chạy vòng vá lỗi
  const [verifying, setVerifying] = useState(false); // (bugNeedFix/98) đang chạy kiểm + mô phỏng
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [store.logs]);

  const handleStart = async () => {
    if (!activeProfile) { useToastStore.getState().warning(ui.acNeedProfile); return; }
    if (!store.config.idea.trim()) { useToastStore.getState().warning(ui.acNeedIdea); return; }
    if (store.isPaused) { store.setPaused(false); return; }
    if (!store.isRunning && store.currentStep) { store.resetPipeline(); }
    
    if (isMinhNguyet) {
      await runMinhNguyetPipeline({ profile: activeProfile, generationParams: settings.generationParams });
    } else {
      await runAutoCreatorPipeline({ profile: activeProfile, generationParams: settings.generationParams });
    }
  };

  const handleRetry = async (step: AutoCreatorStep) => {
    if (!activeProfile) return;
    await retrySingleStep(step, { profile: activeProfile, generationParams: settings.generationParams });
  };

  /**
   * (User 22/07 — việc 82) Vá hết lỗi cơ học mà Kiểm tra tổng thể vừa liệt kê.
   * Không gọi AI nên không cần profile — chạy được cả khi chưa cấu hình khoá API.
   */
  const handleAutoRepair = async () => {
    const toast = useToastStore.getState();
    setRepairing(true);
    try {
      const r = await runAutoRepair();
      if (r.before === 0) toast.success(ui.acRepairClean);
      else if (r.after === 0) toast.success(fmt(ui.acRepairDone, { n: r.fixedCount }));
      else toast.info(fmt(ui.acRepairPartial, { n: r.fixedCount, left: r.after }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRepairing(false);
    }
  };

  /**
   * (bugNeedFix/98) Retry TỔNG: kiểm tra → vá → mô phỏng MVU/EJS. Không gọi AI.
   * Dùng khi vừa sửa tay một biến/hàm/giá trị ở đâu đó và muốn biết ngay còn khớp nhau không.
   */
  const handleFullVerify = async () => {
    const toast = useToastStore.getState();
    setVerifying(true);
    try {
      const r = await runFullVerifyCycle();
      if (r.after === 0) toast.success('Sạch hoàn toàn — kiểm tra, vá và mô phỏng đều qua.');
      else if (!r.simOk) toast.error(`Mô phỏng còn lỗi — xem console. Đã vá ${r.fixedCount} chỗ, còn ${r.after} vấn đề.`);
      else toast.info(`Đã vá ${r.fixedCount} chỗ, còn ${r.after} vấn đề — xem console.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  };

  const handleMnRetry = async (step: MinhNguyetStep) => {
    if (!activeProfile) return;
    await retryMnStep(step, { profile: activeProfile, generationParams: settings.generationParams });
  };

  const renderMethodSelector = () => (
    <div className="flex items-center gap-2 p-1 rounded-xl bg-muted/50 border border-border">
      <button
        className={cn(
          'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all',
          !isMinhNguyet
            ? 'bg-background shadow-sm border border-border text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => store.setPipelineMethod('standard')}
        disabled={store.isRunning}
      >
        <Cog className="w-3.5 h-3.5" />
        Standard
      </button>
      <button
        className={cn(
          'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all',
          isMinhNguyet
            ? 'bg-gradient-to-r from-violet-500/10 to-blue-500/10 shadow-sm border border-violet-500/20 text-violet-400'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => store.setPipelineMethod('minh_nguyet')}
        disabled={store.isRunning}
      >
        <Moon className="w-3.5 h-3.5" />
        {ui.acMinhNguyet}
      </button>
    </div>
  );

  const renderPresetSelector = () => (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <Zap className="w-3.5 h-3.5" /> {ui.acQuickPreset}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {AUTO_CREATOR_PRESETS.map(p => (
          <button
            key={p.id}
            className={cn(
              "px-2.5 py-1.5 text-xs rounded-lg border transition-all",
              store.config.presetId === p.id
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
            )}
            onClick={() => {
              store.applyPreset({ ...p.config, presetId: p.id });
            }}
            disabled={store.isRunning}
            title={PRESET_UI[p.id]?.desc ?? p.description}
          >
            {p.icon} {PRESET_UI[p.id]?.label ?? p.label.replace(/^[^\s]+\s/, '')}
          </button>
        ))}
      </div>
    </div>
  );

  const renderStepConfig = (step: AutoCreatorStep) => {
    // (bug 215) Bước bị gộp không có thẻ riêng — cấu hình của nó nằm trong thẻ chủ.
    if (MERGED_CHILDREN.has(step)) return null;

    const isExpanded = expandedStep === step;
    const group = stepGroup(step);
    const isSelected = store.config.selectedSteps.includes(step);
    const { stepConfigs } = store.config;
    const isPromptOverrideOpen = showPromptOverride === step;
    const currentConfig = stepConfigs[step] as unknown as Record<string, unknown>;

    /** Tick ở thẻ chủ áp cho CẢ CỤM — user chỉ thấy một việc thì chỉ phải bấm một lần. */
    const toggleGroup = () => {
      const want = !isSelected;
      for (const s of group) {
        if (store.config.selectedSteps.includes(s) !== want) store.toggleStep(s);
      }
    };

    return (
      <div key={step} className={cn("border rounded-xl transition-all overflow-hidden", isSelected ? "border-primary/30 bg-primary/5" : "border-border bg-card opacity-70")}>
        <div className="flex items-center px-3 py-2 cursor-pointer" onClick={toggleGroup}>
          <input type="checkbox" className="w-4 h-4 rounded border-border text-primary cursor-pointer mr-3" checked={isSelected} onChange={toggleGroup} onClick={(e) => e.stopPropagation()} disabled={store.isRunning} />
          <div className="flex-1 flex items-center gap-2">
            {(() => { const Icon = STEP_DEFS.find(s => s.id === step)?.icon || Circle; return <Icon className="w-4 h-4 text-muted-foreground" />; })()}
            <div>
              <div className="text-sm font-medium">{STEP_DEFS.find(s => s.id === step)?.label}</div>
              <div className="text-[10px] text-muted-foreground">{STEP_DEFS.find(s => s.id === step)?.desc}</div>
            </div>
          </div>
          <button className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors" onClick={(e) => { e.stopPropagation(); setExpandedStep(isExpanded ? null : step); }}>
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {isExpanded && (
          <div className="px-10 py-3 border-t border-border/50 bg-background/50 text-xs space-y-3">
            {step === 'basic_info' && (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.basic_info.includePersonality} onChange={(e) => store.updateStepConfig('basic_info', { includePersonality: e.target.checked })} disabled={store.isRunning} /> {ui.acIncludePersonality}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.basic_info.includeScenario} onChange={(e) => store.updateStepConfig('basic_info', { includeScenario: e.target.checked })} disabled={store.isRunning} /> {ui.acIncludeScenario}</label>
                <div className="flex items-center gap-2">
                  <span>{ui.acLanguage}</span>
                  <select className="border rounded px-2 py-1 bg-background" value={stepConfigs.basic_info.language} onChange={(e) => store.updateStepConfig('basic_info', { language: e.target.value as 'vi' | 'en' | 'zh' | 'ja' })} disabled={store.isRunning}>
                    <option value="vi">Tiếng Việt</option><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option>
                  </select>
                </div>
              </>
            )}

            {step === 'lorebook' && (
              <>
                {/* (User 2026) totalEntries = TỐI ĐA; minEntries = TỐI THIỂU (0 = không ép sàn).
                    AI trả thiếu/trùng bị loại → pipeline tự nối batch bù tới khi đạt tối thiểu. */}
                <SliderControl label={`${ui.acTotalEntries} (tối đa)`} value={stepConfigs.lorebook.totalEntries} min={1} max={100} step={5} hardMax={2000} onChange={(v) => store.updateStepConfig('lorebook', { totalEntries: v, minEntries: Math.min(stepConfigs.lorebook.minEntries ?? 0, v) })} disabled={store.isRunning} />
                <SliderControl label="Entry tối thiểu (0 = không ép)" value={stepConfigs.lorebook.minEntries ?? 0} min={0} max={stepConfigs.lorebook.totalEntries} step={5} hardMax={stepConfigs.lorebook.totalEntries} onChange={(v) => store.updateStepConfig('lorebook', { minEntries: v })} disabled={store.isRunning} />
                {/* (bug 215) Ngân sách token mỗi entry — user xin "lorebook thì cho chỉnh mỗi
                    entries bao nhiêu token". batchGenerator vốn đã biết dùng con số này (bơm chỉ
                    dẫn độ dài vào prompt + tự co số entry mỗi lô khi chạm trần output). */}
                <SliderControl
                  label="Token mỗi entry (0 = để AI tự quyết)"
                  value={stepConfigs.lorebook.tokensPerEntry ?? 0}
                  min={0} max={2000} step={50} hardMax={20000}
                  onChange={(v) => store.updateStepConfig('lorebook', { tokensPerEntry: v })}
                  disabled={store.isRunning}
                  hint="≈ 150–400: entry tra cứu ngắn gọn · 800–1500: entry mô tả sâu. Đặt cao thì lô tự co lại để không chạm trần output."
                />
                <SliderControl label="Entries / Batch" value={stepConfigs.lorebook.entriesPerBatch} min={1} max={10} hardMax={50} onChange={(v) => store.updateStepConfig('lorebook', { entriesPerBatch: v })} disabled={store.isRunning} />
                <SliderControl label={ui.acConcurrentBatches} value={stepConfigs.lorebook.concurrentBatches} min={1} max={5} hardMax={24} onChange={(v) => store.updateStepConfig('lorebook', { concurrentBatches: v })} disabled={store.isRunning} />
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.lorebook.useWebSearch} onChange={(e) => store.updateStepConfig('lorebook', { useWebSearch: e.target.checked })} disabled={store.isRunning} /> Web Search (RAG)</label>
              </>
            )}

            {/* (bug 215) Thẻ GỘP "Giao diện & Regex": phần giao diện (không tốn AI, dựng từ
                schema) đứng trên, phần regex (tốn AI) đứng dưới, ngăn bằng một đường kẻ. */}
            {step === 'game_ui' && (
              <>
                <div className="flex items-center gap-2">
                  <span>{ui.acGameUiComponent}</span>
                  <select className="border rounded px-2 py-1 bg-background" value={stepConfigs.game_ui.component} onChange={(e) => store.updateStepConfig('game_ui', { component: e.target.value as 'status_bar' | 'opening_form' | 'full_set' })} disabled={store.isRunning}>
                    <option value="full_set">{ui.acGameUiFullSet}</option>
                    <option value="status_bar">{ui.acGameUiStatusBar}</option>
                    <option value="opening_form">{ui.acGameUiOpeningForm}</option>
                  </select>
                </div>
                <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Regex Scripts</div>
                  <SliderControl
                    label={ui.acRegexCount} value={stepConfigs.regex.count}
                    min={1} max={10} hardMax={100}
                    onChange={(v) => store.updateStepConfig('regex', { count: v })}
                    disabled={store.isRunning}
                    hint="Bộ regex do AI viết, bám đúng tên biến trong schema MVU."
                  />
                </div>
              </>
            )}

            {step === 'final_check' && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.final_check.useAiReview} onChange={(e) => store.updateStepConfig('final_check', { useAiReview: e.target.checked })} disabled={store.isRunning} /> {ui.acFinalCheckUseAi}</label>
            )}

            {step === 'mvuzod' && (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.mvuzod.createInitVar} onChange={(e) => store.updateStepConfig('mvuzod', { createInitVar: e.target.checked })} disabled={store.isRunning} /> {ui.acCreateInitVar}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.mvuzod.createVarList} onChange={(e) => store.updateStepConfig('mvuzod', { createVarList: e.target.checked })} disabled={store.isRunning} /> {ui.acCreateVarList}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.mvuzod.createUpdateRules} onChange={(e) => store.updateStepConfig('mvuzod', { createUpdateRules: e.target.checked })} disabled={store.isRunning} /> {ui.acCreateUpdateRules}</label>
              </>
            )}

            {step === 'system_prompt' && (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.system_prompt.includeDepthPrompt} onChange={(e) => store.updateStepConfig('system_prompt', { includeDepthPrompt: e.target.checked })} disabled={store.isRunning} /> {ui.acIncludeDepthPrompt}</label>
                {stepConfigs.system_prompt.includeDepthPrompt && (
                  <div className="flex items-center gap-2 mt-1"><span>Depth:</span><input type="number" min="0" max="100" title="Độ sâu chèn Depth prompt — không còn bị chặn ở 10" className="border rounded px-2 py-1 w-16 bg-background" value={stepConfigs.system_prompt.depthValue} onChange={(e) => store.updateStepConfig('system_prompt', { depthValue: parseInt(e.target.value) || 4 })} disabled={store.isRunning} /></div>
                )}
              </>
            )}

            {step === 'first_message' && (
              <SliderControl label="Alternate Greetings" value={stepConfigs.first_message.alternateGreetings} min={0} max={5} hardMax={50} onChange={(v) => store.updateStepConfig('first_message', { alternateGreetings: v })} disabled={store.isRunning} />
            )}

            {step === 'mes_example' && (
              <SliderControl label={ui.acExampleCount} value={stepConfigs.mes_example.exampleCount} min={1} max={5} hardMax={50} onChange={(v) => store.updateStepConfig('mes_example', { exampleCount: v })} disabled={store.isRunning} />
            )}

            {/* v3: Prompt Override */}
            <div className="pt-2 border-t border-border/30">
              <button className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors" onClick={() => setShowPromptOverride(isPromptOverrideOpen ? null : step)}>
                <Edit3 className="w-3 h-3" /> {isPromptOverrideOpen ? ui.acHide : 'Custom Prompt'}
              </button>
              {isPromptOverrideOpen && (
                <div className="mt-2 space-y-2">
                  <select className="border rounded px-2 py-1 bg-background text-[10px] w-full" value={(currentConfig.promptMode as string) || 'default'} onChange={(e) => store.updateStepConfig(step, { promptMode: e.target.value } as never)} disabled={store.isRunning}>
                    <option value="default">{ui.acPromptDefault}</option>
                    <option value="append">{ui.acPromptAppend}</option>
                    <option value="replace">{ui.acPromptReplace}</option>
                  </select>
                  {(currentConfig.promptMode as string) !== 'default' && (
                    <textarea className="w-full h-20 p-2 text-[10px] rounded border border-border bg-card resize-none focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder={ui.acPromptOverridePh} value={(currentConfig.promptOverride as string) || ''} onChange={(e) => store.updateStepConfig(step, { promptOverride: e.target.value } as never)} disabled={store.isRunning} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'running': return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      case 'error': return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case 'skipped': return <SkipForward className="w-4 h-4 text-muted-foreground" />;
      default: return <Circle className="w-4 h-4 text-muted-foreground/30" />;
    }
  };

  const renderPreviewCard = (step: AutoCreatorStep) => {
    const preview = store.stepPreviews[step];
    const status = store.stepStatuses[step];
    if (!preview || status !== 'done' || store.config.autoApplyAll) return null;

    return (
      <div className="mt-2 p-3 rounded-lg bg-card border border-primary/20 text-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium flex items-center gap-1"><Eye className="w-3 h-3" /> Preview</span>
          <span className="text-muted-foreground">~{preview.tokenEstimate} tokens</span>
        </div>
        <pre className="p-2 bg-muted/50 rounded text-[10px] max-h-32 overflow-auto whitespace-pre-wrap font-mono">
          {typeof preview.parsedData === 'string' ? preview.parsedData : JSON.stringify(preview.parsedData, null, 2).slice(0, 500)}
        </pre>
        <div className="flex items-center gap-1.5">
          <button onClick={() => applyStepPreview(step)} className="px-2 py-1 bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/30 rounded flex items-center gap-1 transition-colors"><Check className="w-3 h-3" /> Apply</button>
          <button onClick={() => handleRetry(step)} className="px-2 py-1 bg-amber-500/20 text-amber-600 hover:bg-amber-500/30 rounded flex items-center gap-1 transition-colors"><RotateCcw className="w-3 h-3" /> Retry</button>
          <button onClick={() => skipStep(step)} className="px-2 py-1 bg-zinc-500/20 text-zinc-600 hover:bg-zinc-500/30 rounded flex items-center gap-1 transition-colors"><SkipForward className="w-3 h-3" /> Skip</button>
        </div>
      </div>
    );
  };

  const renderMnStepConfig = (step: MinhNguyetStep) => {
    const meta = MINH_NGUYET_STEP_LABELS[step];
    if (!meta) return null;
    const isExpanded = expandedStep === step;
    const isSelected = store.config.selectedMnSteps.includes(step);
    const { mnStepConfigs } = store.config;
    const isPromptOverrideOpen = showMnPromptOverride === step;
    const currentConfig = mnStepConfigs[step] as unknown as Record<string, unknown>;
    const isOptional = ['three_faces', 'nsfw_palette', 'npc_creation'].includes(step);

    return (
      <div key={step} className={cn("border rounded-xl transition-all overflow-hidden", isSelected ? "border-violet-500/30 bg-violet-500/5" : "border-border bg-card opacity-60")}>
        <div className="flex items-center px-3 py-2 cursor-pointer" onClick={() => store.toggleMnStep(step)}>
          <input type="checkbox" className="w-4 h-4 rounded border-border text-violet-500 cursor-pointer mr-3" checked={isSelected} onChange={() => store.toggleMnStep(step)} onClick={(e) => e.stopPropagation()} disabled={store.isRunning} />
          <div className="flex-1 flex items-center gap-2">
            <span className="text-sm">{meta.icon}</span>
            <div>
              <div className="text-sm font-medium">
                {MN_UI[step]?.label ?? meta.label}
                {isOptional && <span className="ml-1 text-[10px] text-muted-foreground font-normal">{ui.acOptional}</span>}
              </div>
              <div className="text-[10px] text-muted-foreground">{MN_UI[step]?.desc ?? meta.desc}</div>
            </div>
          </div>
          <button className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors" onClick={(e) => { e.stopPropagation(); setExpandedStep(isExpanded ? null : step); }}>
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {isExpanded && (
          <div className="px-10 py-3 border-t border-border/50 bg-background/50 text-xs space-y-3">
            {step === 'npc_creation' && (
              <SliderControl label={ui.acNpcCount} value={currentConfig.npcCount as number} min={1} max={10} hardMax={100} onChange={(v) => store.updateMnStepConfig('npc_creation', { npcCount: v })} disabled={store.isRunning} />
            )}
            
            {step === 'opening' && (
              <SliderControl label="Alternate Greetings" value={currentConfig.alternateGreetings as number} min={0} max={5} hardMax={50} onChange={(v) => store.updateMnStepConfig('opening', { alternateGreetings: v })} disabled={store.isRunning} />
            )}

            <div className="pt-2 border-t border-border/30">
              <button className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors" onClick={() => setShowMnPromptOverride(isPromptOverrideOpen ? null : step)}>
                <Edit3 className="w-3 h-3" /> {isPromptOverrideOpen ? ui.acHide : 'Custom Prompt'}
              </button>
              {isPromptOverrideOpen && (
                <div className="mt-2 space-y-2">
                  <select className="border rounded px-2 py-1 bg-background text-[10px] w-full" value={(currentConfig.promptMode as string) || 'default'} onChange={(e) => store.updateMnStepConfig(step, { promptMode: e.target.value } as never)} disabled={store.isRunning}>
                    <option value="default">{ui.acPromptDefault}</option>
                    <option value="append">{ui.acPromptAppend}</option>
                    <option value="replace">{ui.acPromptReplace}</option>
                  </select>
                  {(currentConfig.promptMode as string) !== 'default' && (
                    <textarea className="w-full h-20 p-2 text-[10px] rounded border border-border bg-card resize-none focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder={ui.acPromptOverridePh} value={(currentConfig.promptOverride as string) || ''} onChange={(e) => store.updateMnStepConfig(step, { promptOverride: e.target.value } as never)} disabled={store.isRunning} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden bg-background">
      {/* ─── CỘT TRÁI ─── */}
      <div className="w-full md:w-[45%] lg:w-[40%] flex flex-col border-r border-border shrink-0">
        <div className="p-4 border-b border-border flex items-center gap-2 shrink-0 bg-card/50">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Wand2 className="w-4 h-4 text-primary" /></div>
          <div>
            <h2 className="font-bold flex items-center gap-1.5">Auto Creator <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-normal">v3</span></h2>
            <p className="text-[10px] text-muted-foreground">{ui.acTagline}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
          {renderMethodSelector()}
          {renderPresetSelector()}

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">{ui.acYourIdea}</span>
              <span className="flex items-center gap-1">
                {/* (bug 137 → 185) Cây đũa thần: bấm mở menu 3 chế độ — Sắp xếp 1-1 / Phác thảo
                    thế giới / Làm giàu ý tưởng. Cả ba đều qua chung chốt "không làm rơi ý gốc". */}
                <span className="relative">
                  <button
                    type="button"
                    onClick={() => setWandMenuOpen(v => !v)}
                    disabled={isPolishing || store.isRunning || !store.config.idea.trim() || !activeProfile}
                    title={ui.acPolishTip}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg border border-purple-500/40 text-[10px] font-normal normal-case tracking-normal text-purple-300 hover:bg-purple-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isPolishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} {ui.acPolishBtn}
                    <ChevronDown className="w-2.5 h-2.5" />
                  </button>
                  {wandMenuOpen && (
                    <>
                      {/* Lớp lót bắt click ra ngoài — không đóng được menu là bug UI kinh điển.
                          preventDefault BẮT BUỘC: cả cụm này nằm trong <label>, mà click vào phần
                          KHÔNG tương tác bên trong label sẽ bị trình duyệt chuyển tiếp thành click
                          lên nút labelable đầu tiên — chính là nút đũa thần → menu đóng xong mở
                          lại ngay như chưa hề bấm. */}
                      <div className="fixed inset-0 z-30"
                        onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setWandMenuOpen(false); }} />
                      <div className="absolute right-0 top-full mt-1 z-40 w-72 rounded-xl border border-border bg-card shadow-xl p-1 normal-case tracking-normal font-normal text-left">
                        {WAND_MODES.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => void handlePolishIdea(m.id)}
                            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-purple-500/10 transition-colors"
                          >
                            <span className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                              <span>{m.icon}</span>{m.label}
                            </span>
                            <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">{m.desc}</span>
                          </button>
                        ))}
                        <p className="px-2.5 py-1.5 text-[9px] text-muted-foreground/70 leading-snug border-t border-border/60 mt-1">
                          Cả 3 chế độ đều giữ nguyên ý gốc (tên riêng, con số được máy kiểm lại).
                          Phần AI tự thêm được đánh dấu ✚ để bạn phân biệt. Đũa thần cũng nhớ cách
                          bạn tổ chức ý tưởng qua các lần dùng để lần sau bám phong cách của bạn hơn.
                        </p>
                      </div>
                    </>
                  )}
                </span>
                {/* Ô ý tưởng thường rất dài — cho mở rộng ra toàn màn hình để dễ soạn/sửa. */}
                <button
                  type="button"
                  onClick={() => setIdeaExpanded(true)}
                  title={ui.acIdeaExpandTip}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10px] font-normal normal-case tracking-normal text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Maximize2 className="w-3 h-3" /> {ui.acIdeaExpand}
                </button>
              </span>
            </label>
            <textarea className="w-full h-28 p-3 text-sm rounded-xl border border-border bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-50" placeholder={ui.acIdeaPh} value={store.config.idea} onChange={(e) => store.setIdea(e.target.value)} disabled={store.isRunning} />
            <p className="text-[10px] text-muted-foreground/70 text-right">{ui.acIdeaChars.replace('{n}', String(store.config.idea.length))}</p>
          </div>

          {/* (Goal 104b) LOẠI THẺ — thẻ nhân vật vs game/thế giới. Đây không phải chuyện lời văn:
              nó đổi hẳn đối tượng mà mọi bước AI viết về, và chế độ game bỏ luôn System prompt. */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loại thẻ</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { kind: 'character' as const, icon: '👤', title: 'Thẻ nhân vật', desc: 'Trò chuyện/nhập vai với một nhân vật cụ thể.' },
                { kind: 'game_world' as const, icon: '🌍', title: 'Game / Thế giới', desc: 'Người chơi bước vào thế giới, AI làm quản trò. Bỏ System prompt.' },
              ]).map(o => {
                const active = store.config.cardKind === o.kind;
                return (
                  <button key={o.kind} disabled={store.isRunning}
                    onClick={() => store.setCardKind(o.kind)}
                    className={cn(
                      'text-left p-3 rounded-xl border transition-colors disabled:opacity-50',
                      active ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40',
                    )}>
                    <div className="text-xs font-medium flex items-center gap-1.5">
                      <span>{o.icon}</span>{o.title}
                      {active && <Check className="w-3 h-3 text-primary ml-auto" />}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{o.desc}</p>
                  </button>
                );
              })}
            </div>
            {store.config.cardKind === 'game_world' && (
              <p className="text-[10px] text-amber-400/90">
                🌍 Chế độ game: mọi bước viết theo hướng thế giới vận hành (luật chơi, phe phái, vòng lặp chơi,
                NPC là dân cư có chỉ số) và bước <strong>System prompt đã được bỏ</strong> — luật chơi sống trong
                lorebook + entry [mvu_update] + giao diện, không bị preset của người chơi đè.
              </p>
            )}
          </div>

          {/* (User 19/07) Yêu cầu / quy tắc TOÀN CỤC cho AI — áp cho MỌI bước pipeline */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">{ui.acUserRules}</label>
            <textarea className="w-full h-20 p-3 text-sm rounded-xl border border-border bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-50" placeholder={ui.acUserRulesPh} value={store.config.userRules} onChange={(e) => store.setUserRules(e.target.value)} disabled={store.isRunning} />
            <p className="text-[10px] text-muted-foreground/70">{ui.acUserRulesDesc}</p>
          </div>

          {/* (bug 126) THÔNG BÁO: EJS Studio đã áp chính sách EJS sang đây.
              User yêu cầu "khi bấm nút áp dụng vào Auto Creator thì ở mục Auto Creator cần có
              thông báo để người dùng biết tính năng này đã áp dụng" — không có banner thì họ
              bấm xong chẳng biết nó có ăn hay không. Kèm nút Gỡ để không bị dính vĩnh viễn. */}
          {store.config.appliedEjsPolicy && (
            <div className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <Wand2 className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-purple-200">
                    Đã áp chính sách EJS từ EJS Studio
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Lấy từ card “{store.config.appliedEjsPolicy.sourceCard}” — {store.config.appliedEjsPolicy.rowCount} mục
                    {store.config.appliedEjsPolicy.summary.reclassify > 0 && `, ${store.config.appliedEjsPolicy.summary.reclassify} mục đổi chế độ kích hoạt`}
                    {store.config.appliedEjsPolicy.summary.createEjs > 0 && `, ${store.config.appliedEjsPolicy.summary.createEjs} khối EJS`}
                    {store.config.appliedEjsPolicy.summary.tokensSaved > 0 && ` (~${store.config.appliedEjsPolicy.summary.tokensSaved} token/lượt tiết kiệm ở card nguồn)`}.
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 mt-1">
                    Chính sách này được bơm thêm vào bước <b>Lorebook</b> và <b>MVUZOD</b> khi tạo card mới —
                    cộng thêm chứ không thay thế cấu hình bạn đã áp từ “AI Sinh Theo Batch”.
                  </p>
                </div>
                <button
                  onClick={() => { store.clearEjsPolicy(); useToastStore.getState().info('Đã gỡ chính sách EJS khỏi Auto Creator.'); }}
                  disabled={store.isRunning}
                  className="shrink-0 px-2 py-1 rounded text-[10px] border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">
                  Gỡ
                </button>
              </div>
            </div>
          )}

          {/* (bug 134) THÔNG BÁO: đang chạy theo cấu hình "AI Sinh Theo Batch".
              User: "hiển thị thông báo ở Auto Creator khi sử dụng, trước đó bạn đã làm nhưng
              chưa hiển thị" — đúng, vì bản cũ chỉ ghi giá trị vào các ô cấu hình rồi thôi, ở
              đây không có gì cho biết cấu hình đó từ đâu tới. Nay công tắc bật là banner hiện,
              tắt là mất; gỡ ngay tại đây cũng được. */}
          {store.config.appliedBatchPreset && (
            <div className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-3">
              <div className="flex items-start gap-2">
                <Wand2 className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-purple-200">{ui.acBatchPresetBanner}</div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fmt(ui.acBatchPresetDetail, {
                      tab: store.config.appliedBatchPreset.tabLabel,
                      total: store.config.appliedBatchPreset.summary.totalEntries,
                      per: store.config.appliedBatchPreset.summary.entriesPerBatch,
                      conc: store.config.appliedBatchPreset.summary.concurrentBatches,
                      prompt: store.config.appliedBatchPreset.summary.hasPrompt ? ui.acBatchPresetPrompt : '',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => { store.clearBatchPreset(); useToastStore.getState().info(ui.bgUnappliedAcToast); }}
                  disabled={store.isRunning}
                  className="shrink-0 px-2 py-1 rounded text-[10px] border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">
                  Gỡ
                </button>
              </div>
            </div>
          )}

          {/* v3: Auto Apply toggle */}
          <div className="flex items-center justify-between px-1">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Eye className="w-3.5 h-3.5" /> {ui.acPreviewBeforeApply}
            </label>
            <button className={cn("relative w-10 h-5 rounded-full transition-colors", !store.config.autoApplyAll ? "bg-primary" : "bg-muted")} onClick={() => store.setAutoApplyAll(!store.config.autoApplyAll)} disabled={store.isRunning}>
              <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", !store.config.autoApplyAll ? "translate-x-5" : "translate-x-0.5")} />
            </button>
          </div>

          {isMinhNguyet ? (
            <>
              {/* MN Config */}
              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Moon className="w-3.5 h-3.5" /> {ui.acMnConfig}
                </label>
                <div className="space-y-2 p-3 rounded-lg border bg-card text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{ui.acWorldviewPath}</span>
                    <select
                      className="border rounded px-2 py-1 bg-background text-xs"
                      value={store.config.mnConfig.worldviewPath}
                      onChange={(e) => store.updateMnConfig({ worldviewPath: e.target.value as 'real_background' | 'small_world' | 'large_world' })}
                      disabled={store.isRunning}
                    >
                      <option value="real_background">{ui.acPathA}</option>
                      <option value="small_world">{ui.acPathB}</option>
                      <option value="large_world">{ui.acPathC}</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{ui.acMnCardType}</span>
                    <select
                      className="border rounded px-2 py-1 bg-background text-xs"
                      value={store.config.mnConfig.cardType}
                      onChange={(e) => store.updateMnConfig({ cardType: e.target.value as 'single' | 'multi' })}
                      disabled={store.isRunning}
                    >
                      <option value="single">{ui.acSingleChar}</option>
                      <option value="multi">{ui.acMultiChar}</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Auto Tag</span>
                    <button
                      className={cn('w-8 h-4 rounded-full transition-colors', store.config.mnConfig.autoTag ? 'bg-primary' : 'bg-muted')}
                      onClick={() => store.updateMnConfig({ autoTag: !store.config.mnConfig.autoTag })}
                      disabled={store.isRunning}
                    >
                      <div className={cn('w-3 h-3 rounded-full bg-white shadow transition-transform', store.config.mnConfig.autoTag ? 'translate-x-4' : 'translate-x-0.5')} />
                    </button>
                  </div>
                </div>
              </div>

              {/* MN Steps */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">{ui.acMnSteps}</label>
                <div className="space-y-1.5">
                  {Object.keys(MINH_NGUYET_STEP_LABELS).map(stepId => renderMnStepConfig(stepId as MinhNguyetStep))}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">{ui.acCardSteps}</label>
              <div className="space-y-1.5">{STEP_DEFS.map(s => renderStepConfig(s.id))}</div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-card/50 shrink-0">
          {!activeProfile && (
            <div className="text-center p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center justify-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4" /> {ui.acNoProfile}
            </div>
          )}
          {/* (bugNeedFix/183) Ngay cạnh nút chạy: bước lorebook/batch của pipeline cũng chạy
              song song, cùng chứng "một nhân vật 7-8 entry giống nhau". */}
          <div className="flex justify-end mb-2">
            <SingleThreadToggle />
          </div>
          {/* (bug 141) "Xem trước & Tinh chỉnh" đứng TRƯỚC nút tạo — duyệt schema + giao diện
              rồi mới chạy; card ra lò áp đúng 100% bản đã chốt. Nút tạo thường vẫn còn cho ai
              muốn đi nhanh. */}
          {!store.isRunning && (
            <button onClick={() => setTunerOpen(true)}
              disabled={!activeProfile || !store.config.idea.trim()}
              className="w-full mb-2 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border border-primary/50 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Eye className="w-4 h-4" /> {ui.acTunerBtn}
              {store.config.tuning?.confirmed && tuningUsable(store.config.tuning, store.config.idea) && (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px]">{ui.acTunerLocked}</span>
              )}
            </button>
          )}
          <button onClick={handleStart} disabled={!activeProfile || !store.config.idea.trim() || (store.isRunning && !store.isPaused)}
            className={cn("w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-sm",
              store.isRunning && !store.isPaused ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow")}>
            {store.isBlueprintLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> {ui.acAnalysing}</> :
              store.isPaused ? <><Play className="w-5 h-5 fill-current" /> {ui.acResume}</> :
              store.isRunning ? <><Loader2 className="w-5 h-5 animate-spin" /> {ui.acRunning}</> :
              store.currentStep ? <><RotateCcw className="w-5 h-5" /> {ui.acRestart}</> :
              <><Sparkles className="w-5 h-5" /> {ui.acStart}</>}
          </button>
        </div>
      </div>

      {/* ─── CỘT PHẢI ─── */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/10 relative">
        {!store.currentStep && store.logs.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-muted-foreground/50 pointer-events-none">
            <Wand2 className="w-16 h-16 mb-4 opacity-20" />
            <p className="font-medium">{ui.acNoProgress}</p>
            <p className="text-xs mt-1">{ui.acConfigureLeft}</p>
          </div>
        )}

        {/* Blueprint status */}
        {store.blueprint && (
          <div className="p-3 border-b border-border bg-primary/5 flex items-center gap-3 text-xs shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">Blueprint:</span> {store.blueprint.characterProfile.name} • {store.blueprint.worldStructure.genre} • {store.blueprint.estimatedComplexity}
              <span className="text-muted-foreground ml-2">{store.blueprint.suggestedEntryTopics.length} topics, {store.blueprint.suggestedVariables.length} vars</span>
            </div>
          </div>
        )}

        {/* Stepper */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 border-b border-border bg-card/50 min-h-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            {isMinhNguyet ? ui.acMnProgress : ui.acProgress}
          </h3>
          <div className="space-y-3">
            {isMinhNguyet ? (
              store.config.selectedMnSteps.map((step, idx) => {
                const status = store.mnStepStatuses[step];
                const meta = MINH_NGUYET_STEP_LABELS[step];
                const isActive = store.currentStep === step;
                const result = store.mnStepResults[step];
                return (
                  <div key={step} className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
                    isActive ? 'bg-violet-500/10 ring-1 ring-violet-500/30' : 'bg-card/50'
                  )}>
                    <div className="text-xs text-muted-foreground w-4">{idx + 1}</div>
                    {renderStatusIcon(status)}
                    <span className="text-sm">{meta?.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className={cn('text-xs font-medium', isActive && 'text-violet-400')}>{MN_UI[step]?.label ?? meta?.label}</span>
                      {result && <span className="text-[10px] text-muted-foreground ml-2">{result}</span>}
                    </div>
                    {status === 'error' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleMnRetry(step)} className="p-1 rounded hover:bg-amber-500/20 text-amber-500"><RotateCcw className="w-3 h-3" /></button>
                        <button onClick={() => skipMnStep(step)} className="p-1 rounded hover:bg-muted text-muted-foreground"><SkipForward className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              // (bug 215) Bước bị gộp không có DÒNG RIÊNG — nếu không thì bên trái user thấy một
              // việc mà bên phải lại đếm thành hai, số thứ tự cũng lệch với danh sách cấu hình.
              store.config.selectedSteps.filter(s => !MERGED_CHILDREN.has(s)).map((step, idx) => {
              const group = stepGroup(step).filter(s => store.config.selectedSteps.includes(s));
              // Trạng thái của CẢ CỤM: lỗi ở bất kỳ bước con nào là lỗi; xong hết mới là xong;
              // còn cái nào đang chạy thì cụm đang chạy.
              const groupStatuses = group.map(s => store.stepStatuses[s]);
              const status = groupStatuses.includes('error') ? 'error'
                : groupStatuses.includes('running') ? 'running'
                : groupStatuses.every(st => st === 'done') ? 'done'
                : groupStatuses.find(st => st && st !== 'pending') ?? store.stepStatuses[step];
              const def = STEP_DEFS.find(s => s.id === step);
              const isActive = group.includes(store.currentStep as AutoCreatorStep);

              return (
                <div key={step}>
                  <div className={cn("flex items-start gap-3 transition-opacity", status === 'pending' ? 'opacity-40' : 'opacity-100')}>
                    <div className="mt-0.5">{renderStatusIcon(status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm font-medium", isActive ? "text-primary" : "")}>{idx + 1}. {def?.label}</div>
                      {store.stepResults[step] && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{store.stepResults[step]}</div>
                      )}
                    </div>
                    {/* v3: Step action buttons */}
                    {status === 'error' && !store.isRunning && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleRetry(step)} className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-600 hover:bg-amber-500/30 rounded transition-colors">Retry</button>
                        <button onClick={() => skipStep(step)} className="px-1.5 py-0.5 text-[10px] bg-zinc-500/20 text-zinc-500 hover:bg-zinc-500/30 rounded transition-colors">Skip</button>
                      </div>
                    )}
                  </div>
                  {renderPreviewCard(step)}
                </div>
              );
            })
            )}
          </div>
        </div>

        {/* Console */}
        <div className="flex-1 flex flex-col min-h-0 bg-black/90 text-zinc-300 font-mono text-[11px] md:text-xs">
          <div className="p-2 border-b border-white/10 bg-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /><span>Pipeline Console</span></div>
            {store.isRunning && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => store.setPaused(true)} className="px-2 py-1 bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 rounded flex items-center gap-1 transition-colors"><Pause className="w-3 h-3" /> {ui.acPause}</button>
                <button onClick={() => store.stopPipeline()} title="Dừng DỨT HẲN: hủy cả request AI đang bay, không chỉ dừng giữa các bước" className="px-2 py-1 bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded flex items-center gap-1 transition-colors"><Square className="w-3 h-3" /> {ui.acStop}</button>
              </div>
            )}
            {!store.isRunning && (
              <div className="flex items-center gap-1.5">
                {/* (bugNeedFix/98) RETRY TỔNG — luôn bấm được, kể cả khi console chưa có log nào
                    (vừa mở lại app, hay vừa sửa tay một biến/hàm ở đâu đó). Chạy trọn vòng
                    kiểm tra → vá cơ học → MÔ PHỎNG MVU/EJS, không gọi AI nên bấm bao nhiêu
                    lần cũng được. */}
                <button
                  onClick={handleFullVerify}
                  disabled={repairing || verifying}
                  className="px-2 py-1 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 disabled:opacity-50 rounded flex items-center gap-1 transition-colors"
                  title="Chạy lại TOÀN BỘ: kiểm tra tổng thể → vá lỗi cơ học → mô phỏng nạp biến MVU và đối chiếu EJS. Không tốn API. Dùng mỗi khi bạn vừa sửa tay biến/hàm/giá trị ở bất kỳ đâu."
                >
                  <PlayCircle className="w-3 h-3" /> {verifying ? 'Đang kiểm & mô phỏng…' : 'Kiểm & Mô phỏng lại'}
                </button>
                {/* (User 22/07 — việc 82) Kiểm tra tổng thể xong ra một đống lỗi cơ học mà user
                    phải tự sửa tay. Nút này chạy vòng vá tất định cho tới khi hết vá được. */}
                <button
                  onClick={handleAutoRepair}
                  disabled={repairing || verifying}
                  className="px-2 py-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 rounded flex items-center gap-1 transition-colors"
                  title={ui.acRepairAllHint}
                >
                  <Wrench className="w-3 h-3" /> {repairing ? ui.acRepairing : ui.acRepairAll}
                </button>
                {store.logs.length > 0 && (
                  <button onClick={() => store.resetPipeline()} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 transition-colors"><RotateCcw className="w-3 h-3" /> Reset</button>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
            {store.logs.map(log => {
              const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
              let colorClass = 'text-zinc-300';
              if (log.level === 'error') colorClass = 'text-red-400';
              if (log.level === 'success') colorClass = 'text-emerald-400';
              if (log.level === 'warning') colorClass = 'text-amber-400';
              return (
                <div key={log.id} className="leading-relaxed">
                  <span className="text-zinc-500">{time}</span>{' '}
                  <span className="text-zinc-400">[{log.step}]</span>{' '}
                  <span className={colorClass}>{log.message}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* Ô "Ý tưởng của bạn" phóng to — sửa trực tiếp vào store nên đóng lại là giữ nguyên nội dung. */}
      {ideaExpanded && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setIdeaExpanded(false)}
        >
          <div
            className="w-full max-w-4xl h-[80vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">{ui.acYourIdea}</h3>
              <button
                type="button"
                onClick={() => setIdeaExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={ui.acIdeaCollapse}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              autoFocus
              className="flex-1 w-full p-4 text-sm bg-transparent resize-none focus:outline-none placeholder:text-muted-foreground/50 disabled:opacity-50 scrollbar-thin"
              placeholder={ui.acIdeaPh}
              value={store.config.idea}
              onChange={(e) => store.setIdea(e.target.value)}
              disabled={store.isRunning}
              onKeyDown={(e) => { if (e.key === 'Escape') setIdeaExpanded(false); }}
            />
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border shrink-0">
              <span className="text-[11px] text-muted-foreground">{ui.acIdeaChars.replace('{n}', String(store.config.idea.length))}</span>
              <button
                type="button"
                onClick={() => setIdeaExpanded(false)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
              >
                {ui.acIdeaCollapse}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* (bug 141) Wizard Xem trước & Tinh chỉnh — trạng thái nằm trong config (persist). */}
      <PreviewTunerModal open={tunerOpen} onClose={() => setTunerOpen(false)} onStart={handleStart} />
    </div>
  );
}

/**
 * ═══ Reusable slider ═══
 *
 * (bug 215) Thanh trượt CÓ TRẦN CỨNG là điều user phàn nàn: "không hạn chế max là bao nhiêu
 * giống hiện tại". `<input type="range">` không cho vượt `max` bằng bất kỳ cách nào, nên muốn
 * 200 entry lorebook hay 30 regex là chịu.
 *
 * Cách chữa giữ được cả hai mặt: thanh trượt vẫn phụ trách khoảng THƯỜNG DÙNG (kéo nhanh, trực
 * quan), cạnh nó là ô SỐ nhập tay không trần — gõ bao nhiêu cũng được, chỉ chặn số âm và một
 * trần an toàn rất rộng để lỡ gõ nhầm 999999 thì không treo máy.
 * Khi giá trị vượt quá `max` của thanh trượt, thanh tự nới trần để con trỏ không dính mép.
 */
function SliderControl({ label, value, min, max, step = 1, onChange, disabled, hardMax = 100_000, hint }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; disabled: boolean;
  /** Trần an toàn cho ô nhập tay (chống gõ nhầm), KHÔNG phải trần tính năng. */
  hardMax?: number;
  hint?: string;
}) {
  // Vượt trần thanh trượt thì nới thanh ra cho khớp — nếu không con trỏ kẹt ở mép phải.
  const sliderMax = Math.max(max, value);
  const clampTyped = (raw: number) => Math.max(min, Math.min(hardMax, Math.round(raw)));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span>{label}:</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={hardMax}
            step={step}
            disabled={disabled}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onChange(clampTyped(n));
            }}
            title={`Gõ thẳng số bạn muốn — không bị giới hạn ở ${max}`}
            className="w-20 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-xs font-medium text-primary"
          />
          {value > max && <span className="text-[10px] text-amber-400" title="Đang vượt khoảng khuyến nghị">⚠</span>}
        </div>
      </div>
      <input
        type="range" min={min} max={sliderMax} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        disabled={disabled}
        className="w-full accent-primary"
      />
      {hint && <div className="text-[10px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}
