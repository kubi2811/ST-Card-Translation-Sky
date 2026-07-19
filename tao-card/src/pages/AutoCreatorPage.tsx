import { useState, useRef, useEffect } from 'react';
import {
  Wand2, Play, Pause, Square, RotateCcw, Eye, Check,
  CheckCircle2, Circle, Loader2, ChevronRight, ChevronDown,
  AlertTriangle, Settings2, Hash, BookOpen, User, Terminal,
  MessageSquare, Sparkles, SkipForward, Edit3, Zap, Moon, Cog,
  Maximize2, X,
  type LucideIcon
} from 'lucide-react';
import { useAutoCreatorStore } from '../store/autoCreatorStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { runAutoCreatorPipeline, retrySingleStep, skipStep, applyStepPreview } from '../lib/ai/autoCreatorPipeline';
import { runMinhNguyetPipeline, retryMnStep, skipMnStep } from '../lib/ai/minhNguyetPipeline';
import { AUTO_CREATOR_PRESETS } from '../lib/ai/autoCreatorPresets';
import { MINH_NGUYET_STEP_LABELS } from '../prompts/minhNguyetTemplates';
import type { AutoCreatorStep, MinhNguyetStep, AnyPipelineStep } from '../types';
import { cn } from '../lib/utils';
import { t as ui } from '../i18n';

const STEP_DEFS: { id: AutoCreatorStep; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'basic_info', label: ui.acStepBasicInfo, icon: User, desc: 'Name, Description, Personality, Scenario' },
  { id: 'lorebook', label: 'Lorebook Entries', icon: BookOpen, desc: ui.acStepLorebookDesc },
  { id: 'regex', label: 'Regex Scripts', icon: Settings2, desc: ui.acStepRegexDesc },
  { id: 'mvuzod', label: 'MVUZOD Schema', icon: Hash, desc: ui.acStepMvuzodDesc },
  { id: 'system_prompt', label: 'System Prompt', icon: Terminal, desc: ui.acStepSysPromptDesc },
  { id: 'first_message', label: 'First Message', icon: MessageSquare, desc: ui.acStepFirstMesDesc },
  { id: 'mes_example', label: 'Message Examples', icon: MessageSquare, desc: ui.acStepMesExampleDesc },
];

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
  const settings = useSettingsStore();
  const activeProfile = settings.getActiveProfile();
  const isMinhNguyet = store.config.pipelineMethod === 'minh_nguyet';
  
  const [expandedStep, setExpandedStep] = useState<AnyPipelineStep | null>(null);
  const [showPromptOverride, setShowPromptOverride] = useState<AutoCreatorStep | null>(null);
  const [showMnPromptOverride, setShowMnPromptOverride] = useState<MinhNguyetStep | null>(null);
  const [ideaExpanded, setIdeaExpanded] = useState(false); // ô "Ý tưởng của bạn" phóng to toàn màn hình
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
    const isExpanded = expandedStep === step;
    const isSelected = store.config.selectedSteps.includes(step);
    const { stepConfigs } = store.config;
    const isPromptOverrideOpen = showPromptOverride === step;
    const currentConfig = stepConfigs[step] as unknown as Record<string, unknown>;

    return (
      <div key={step} className={cn("border rounded-xl transition-all overflow-hidden", isSelected ? "border-primary/30 bg-primary/5" : "border-border bg-card opacity-70")}>
        <div className="flex items-center px-3 py-2 cursor-pointer" onClick={() => store.toggleStep(step)}>
          <input type="checkbox" className="w-4 h-4 rounded border-border text-primary cursor-pointer mr-3" checked={isSelected} onChange={() => store.toggleStep(step)} onClick={(e) => e.stopPropagation()} disabled={store.isRunning} />
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
                <SliderControl label={`${ui.acTotalEntries} (tối đa)`} value={stepConfigs.lorebook.totalEntries} min={5} max={100} step={5} onChange={(v) => store.updateStepConfig('lorebook', { totalEntries: v, minEntries: Math.min(stepConfigs.lorebook.minEntries ?? 0, v) })} disabled={store.isRunning} />
                <SliderControl label="Entry tối thiểu (0 = không ép)" value={stepConfigs.lorebook.minEntries ?? 0} min={0} max={stepConfigs.lorebook.totalEntries} step={5} onChange={(v) => store.updateStepConfig('lorebook', { minEntries: v })} disabled={store.isRunning} />
                <SliderControl label="Entries / Batch" value={stepConfigs.lorebook.entriesPerBatch} min={1} max={10} onChange={(v) => store.updateStepConfig('lorebook', { entriesPerBatch: v })} disabled={store.isRunning} />
                <SliderControl label={ui.acConcurrentBatches} value={stepConfigs.lorebook.concurrentBatches} min={1} max={5} onChange={(v) => store.updateStepConfig('lorebook', { concurrentBatches: v })} disabled={store.isRunning} />
                <label className="flex items-center gap-2"><input type="checkbox" checked={stepConfigs.lorebook.useWebSearch} onChange={(e) => store.updateStepConfig('lorebook', { useWebSearch: e.target.checked })} disabled={store.isRunning} /> Web Search (RAG)</label>
              </>
            )}

            {step === 'regex' && (
              <SliderControl label={ui.acRegexCount} value={stepConfigs.regex.count} min={1} max={10} onChange={(v) => store.updateStepConfig('regex', { count: v })} disabled={store.isRunning} />
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
                  <div className="flex items-center gap-2 mt-1"><span>Depth:</span><input type="number" min="0" max="10" className="border rounded px-2 py-1 w-16 bg-background" value={stepConfigs.system_prompt.depthValue} onChange={(e) => store.updateStepConfig('system_prompt', { depthValue: parseInt(e.target.value) || 4 })} disabled={store.isRunning} /></div>
                )}
              </>
            )}

            {step === 'first_message' && (
              <SliderControl label="Alternate Greetings" value={stepConfigs.first_message.alternateGreetings} min={0} max={5} onChange={(v) => store.updateStepConfig('first_message', { alternateGreetings: v })} disabled={store.isRunning} />
            )}

            {step === 'mes_example' && (
              <SliderControl label={ui.acExampleCount} value={stepConfigs.mes_example.exampleCount} min={1} max={5} onChange={(v) => store.updateStepConfig('mes_example', { exampleCount: v })} disabled={store.isRunning} />
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
              <SliderControl label={ui.acNpcCount} value={currentConfig.npcCount as number} min={1} max={10} onChange={(v) => store.updateMnStepConfig('npc_creation', { npcCount: v })} disabled={store.isRunning} />
            )}
            
            {step === 'opening' && (
              <SliderControl label="Alternate Greetings" value={currentConfig.alternateGreetings as number} min={0} max={5} onChange={(v) => store.updateMnStepConfig('opening', { alternateGreetings: v })} disabled={store.isRunning} />
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
              {/* Ô ý tưởng thường rất dài — cho mở rộng ra toàn màn hình để dễ soạn/sửa. */}
              <button
                type="button"
                onClick={() => setIdeaExpanded(true)}
                title={ui.acIdeaExpandTip}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10px] font-normal normal-case tracking-normal text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Maximize2 className="w-3 h-3" /> {ui.acIdeaExpand}
              </button>
            </label>
            <textarea className="w-full h-28 p-3 text-sm rounded-xl border border-border bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-50" placeholder={ui.acIdeaPh} value={store.config.idea} onChange={(e) => store.setIdea(e.target.value)} disabled={store.isRunning} />
            <p className="text-[10px] text-muted-foreground/70 text-right">{ui.acIdeaChars.replace('{n}', String(store.config.idea.length))}</p>
          </div>

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
              store.config.selectedSteps.map((step, idx) => {
              const status = store.stepStatuses[step];
              const def = STEP_DEFS.find(s => s.id === step);
              const isActive = store.currentStep === step;
              
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
                <button onClick={() => { store.setIsRunning(false); store.setPaused(false); }} className="px-2 py-1 bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded flex items-center gap-1 transition-colors"><Square className="w-3 h-3" /> {ui.acStop}</button>
              </div>
            )}
            {!store.isRunning && store.logs.length > 0 && (
              <button onClick={() => store.resetPipeline()} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 transition-colors"><RotateCcw className="w-3 h-3" /> Reset</button>
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
    </div>
  );
}

// ═══ Reusable slider ═══
function SliderControl({ label, value, min, max, step = 1, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between"><span>{label}:</span><span className="font-medium text-primary">{value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseInt(e.target.value))} disabled={disabled} className="w-full accent-primary" />
    </div>
  );
}
