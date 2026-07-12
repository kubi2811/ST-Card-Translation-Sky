'use client';

import { useState, useRef } from 'react';
import FileUploader from '@/components/FileUploader';
import ModRulesManager, { ModRule } from '@/components/ModRulesManager';
import VarRemapPanel from '@/components/VarRemapPanel';
import SubExpandPanel from '@/components/SubExpandPanel';
import ExtraProvidersPanel from '@/components/ExtraProvidersPanel';
import { CardV3 } from '@/types/card';
import { LLMConfig } from '@/lib/llm';
import { usePersistedState } from '@/lib/usePersistedState';
import { CardParser } from '@/lib/parser';
import { ModOrchestrator, extractSections, applyModification, buildLoreDigest, OrchestratorRule } from '@/lib/orchestrator';
import { scriptBrokeByMod } from '@/lib/scriptSafety';
import { useT } from '@/i18n/I18nProvider';
import { fmt } from '@/i18n';

interface AnalysisItem {
  section_id: string;
  label: string;
  status: string;
  reason: string;
  preview_change?: string;
}

interface AuditResult {
  consistency_score: number;
  summary: string;
  inconsistencies: { severity: string; dimension: string; description: string }[];
}

interface ValidationResult {
  status: 'PASS' | 'FAIL' | 'PASS_WITH_WARNINGS';
  stats?: { protected_fields_verified: number };
  issues?: { severity: string; category: string; description: string; fix: string }[];
}

export default function ModCardApp() {
  const t = useT();
  // Các state là "việc của user" → lưu localStorage để F5 / đóng tab không mất.
  const [card, setCard] = usePersistedState<CardV3 | null>('modcard.card', null);
  const [rules, setRules] = usePersistedState<ModRule[]>('modcard.rules', []);
  const [activeTab, setActiveTab] = usePersistedState<'upload' | 'workspace' | 'diff' | 'settings'>('modcard.activeTab', 'upload');

  const [llmConfig, setLlmConfig] = usePersistedState<LLMConfig>('modcard.llmConfig', {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-1.5-pro-latest',
    customUrl: ''
  });
  // Đa provider: các provider PHỤ chạy song song với llmConfig (rải call round-robin).
  const [extraProviders, setExtraProviders] = usePersistedState<LLMConfig[]>('modcard.extraProviders', []);

  const [scannedModels, setScannedModels] = useState<string[]>([]);
  const [isScanningModels, setIsScanningModels] = useState(false);
  const [customPrompt, setCustomPrompt] = usePersistedState<string>('modcard.customPrompt', '');
  const [expandMode, setExpandMode] = usePersistedState<boolean>('modcard.expandMode', false);
  const [expandIntensity, setExpandIntensity] = usePersistedState<string>('modcard.expandIntensity', 'vừa');
  const [manualModelInput, setManualModelInput] = useState(false);

  const handleProviderChange = (provider: 'openai' | 'anthropic' | 'gemini') => {
    let defaultModel = 'gemini-1.5-pro-latest';
    if (provider === 'openai') {
      defaultModel = 'gpt-4o';
    } else if (provider === 'anthropic') {
      defaultModel = 'claude-3-5-sonnet-20240620';
    }
    
    setLlmConfig(prev => ({
      ...prev,
      provider,
      model: defaultModel,
      customUrl: ''
    }));
    setScannedModels([]);
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<string>('');
  // Nút Dừng: hủy MỌI call đang chạy (abort in-flight) + cắt vòng lặp mod giữa chừng.
  const abortRef = useRef<AbortController | null>(null);
  // Cảnh báo script JS bị vỡ cú pháp sau khi mod (nạp vào ST sẽ liệt nút → cần kiểm tay).
  const [scriptWarnings, setScriptWarnings] = useState<string[]>([]);
  // Kết quả cũng lưu lại để xem lại sau khi F5.
  const [analysisResult, setAnalysisResult] = usePersistedState<AnalysisItem[] | null>('modcard.analysisResult', null);
  const [moddedCard, setModdedCard] = usePersistedState<CardV3 | null>('modcard.moddedCard', null);
  const [auditResult, setAuditResult] = usePersistedState<AuditResult | null>('modcard.auditResult', null);
  const [validationResult, setValidationResult] = usePersistedState<ValidationResult | null>('modcard.validationResult', null);
  const [isMvuCard, setIsMvuCard] = usePersistedState<boolean>('modcard.isMvuCard', false);
  const [mvuVariables, setMvuVariables] = usePersistedState<string[]>('modcard.mvuVariables', []);
  // Chế độ mod chỉ Lorebook (import LB riêng → mod → xuất LB riêng, không đụng cả thẻ).
  const [isLorebookOnly, setIsLorebookOnly] = usePersistedState<boolean>('modcard.isLorebookOnly', false);

  const handleCardLoaded = (loadedCard: CardV3, _raw?: string, isLorebook?: boolean) => {
    setCard(loadedCard);
    setIsLorebookOnly(!!isLorebook);
    const mvu = CardParser.detectMvuZod(loadedCard);
    setIsMvuCard(mvu);
    if (mvu) {
      setMvuVariables(CardParser.extractVariables(loadedCard));
    } else {
      setMvuVariables([]);
    }
    setActiveTab('workspace');
  };

  const handleScanModels = async () => {
    if (!llmConfig.apiKey) {
      alert(t.alertNeedKeyScan);
      return;
    }
    setIsScanningModels(true);
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: llmConfig.provider,
          apiKey: llmConfig.apiKey,
          customUrl: llmConfig.customUrl
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.alertScanFailed);
      }
      const data = await res.json();
      setScannedModels(data.models || []);
      if (data.models && data.models.length > 0) {
        setLlmConfig(prev => ({ ...prev, model: data.models[0] }));
      }
      alert(fmt(t.alertScanOk, { count: data.models?.length || 0 }));
    } catch (err: unknown) {
      console.error(err);
      alert(t.alertScanErrPrefix + (err as Error).message);
    } finally {
      setIsScanningModels(false);
    }
  };

  const runFullPipeline = async () => {
    if (!card || !llmConfig.apiKey) {
      alert(t.alertNeedCardKey);
      return;
    }

    setIsProcessing(true);
    setProcessStatus(t.stage1);
    setAnalysisResult(null);
    setModdedCard(null);
    setAuditResult(null);
    setValidationResult(null);
    setScriptWarnings([]);

    // Tạo AbortController mới cho lần chạy này → nút Dừng gọi abort() để cắt in-flight + vòng lặp.
    const ac = new AbortController();
    abortRef.current = ac;

    // Artificial delay to let user see initialization phase
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Merge Mod Rules and User Custom Prompt
    const activeRules: OrchestratorRule[] = rules.map(r => ({
      id: r.id,
      name: r.name,
      details: r.details,
      keywords: r.keywords,
      enabled: r.enabled
    }));
    
    if (customPrompt.trim()) {
      activeRules.push({
        id: 'USER_CUSTOM_PROMPT',
        name: 'Yêu cầu tùy chỉnh của người dùng',
        keywords: '',
        details: customPrompt,
        enabled: true
      });
    }

    if (activeRules.length === 0) {
      alert(t.alertNeedRule);
      setIsProcessing(false);
      return;
    }

    try {
      const orchestrator = new ModOrchestrator(llmConfig, extraProviders, ac.signal);
      
      // Step 2: Analyze
      setProcessStatus(t.stage2);
      const analysis = await orchestrator.analyze(card, activeRules);
      setAnalysisResult(analysis);

      // Step 3: Mod
      setProcessStatus(t.stage3);
      const sectionsToMod = analysis.filter((s: AnalysisItem) => s.status === 'NEEDS_MOD');
      const allSections = extractSections(card);
      
      let currentContext = '';
      let currentCard = JSON.parse(JSON.stringify(card));
      const moddedEntries: { index: number; content: string }[] = [];
      // Chế độ mở rộng: dựng lore digest 1 lần để mọi section bám lore toàn cảnh.
      const loreDigest = expandMode ? buildLoreDigest(card) : '';
      // Entry LỚN sẽ được chia phần trong orchestrator → báo tiến độ "phần i/N" để không tưởng bị treo.
      let curLabel = '';
      const modOpts = {
        expand: expandMode, intensity: expandIntensity, loreDigest,
        onChunkProgress: (done: number, total: number) => {
          if (total > 1) setProcessStatus(fmt(t.stage3Part, { verb: expandMode ? t.verbExpand : t.verbMod, label: String(curLabel), done, total }));
        },
      };
      const brokenScripts: string[] = []; // script JS bị vỡ cú pháp sau khi mod (để cảnh báo)

      for (const req of sectionsToMod) {
        if (ac.signal.aborted) throw new DOMException('Người dùng đã dừng', 'AbortError');
        curLabel = String(req.label);
        setProcessStatus(fmt(t.stage3Section, { verb: expandMode ? t.verbExpand : t.verbMod, label: String(req.label) }));
        const sectionData = allSections.find(s => s.section_id === req.section_id);
        if (sectionData) {
          const modded = await orchestrator.modSection(currentCard, sectionData, activeRules, currentContext, modOpts);
          currentCard = applyModification(currentCard, sectionData.field_path, modded);
          currentContext += `\n[Đã sửa ${String(req.label)}]:\n${modded}\n`;

          // Lưới an toàn: chỉ CẢNH BÁO cho script JS THUẦN (bỏ EJS `<% %>`) nếu gốc lành mà bản mod vỡ.
          if (sectionData.section_id.startsWith('script_') && !sectionData.content.includes('<%')
              && scriptBrokeByMod(sectionData.content, modded)) {
            brokenScripts.push(String(req.label));
          }

          if (sectionData.section_id.startsWith('entry_')) {
            moddedEntries.push({
              index: parseInt(sectionData.section_id.replace('entry_', '')),
              content: modded
            });
          }
        }
      }
      if (brokenScripts.length > 0) setScriptWarnings(brokenScripts);

      // Step 4: Keyword Sync
      if (moddedEntries.length > 0) {
        setProcessStatus(t.stage4Keyword);
        const syncResults = await orchestrator.syncKeywords(currentCard, activeRules, moddedEntries);
        syncResults.forEach((sync: { action: string; entry_index: number; formatted_key_string?: string }) => {
          if (sync.action === 'UPDATE' && sync.formatted_key_string) {
            const path = `data.character_book.entries[${sync.entry_index}].keys`;
            const keysArray = sync.formatted_key_string.split(',').map((k: string) => k.trim());
            currentCard = applyModification(currentCard, path, keysArray as unknown as string);
          }
        });
      }

      // Step 5: Consistency Audit
      setProcessStatus(t.stage4Audit);
      const audit = await orchestrator.auditConsistency(currentCard, activeRules);
      setAuditResult(audit);

      // Step 6: Validation
      setProcessStatus(t.stage5);
      const validation = await orchestrator.validateCard(card, currentCard, activeRules);
      setValidationResult(validation);
      
      setModdedCard(currentCard);
      setProcessStatus(t.stageDone);
      setActiveTab('diff');
    } catch (error: unknown) {
      const err = error as Error;
      if (err?.name === 'AbortError' || /đã dừng|aborted/i.test(err?.message || '')) {
        // Người dùng bấm Dừng — KHÔNG phải lỗi. Giữ nguyên kết quả các bước đã xong.
        setProcessStatus(t.stageStopped);
      } else {
        console.error(error);
        alert(t.alertProcessErrPrefix + err.message);
        setProcessStatus(t.stageError);
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  };

  /** Dừng pipeline mod: abort mọi call đang chạy + cắt vòng lặp giữa chừng. */
  const stopModding = () => {
    abortRef.current?.abort(new DOMException('Người dùng đã dừng', 'AbortError'));
    setProcessStatus(t.stageStopping);
  };

  const handleDownload = () => {
    if (!moddedCard) return;
    // Chế độ Lorebook: xuất RIÊNG lorebook (đúng format gốc), không phải cả thẻ.
    const isLB = isLorebookOnly || (moddedCard as CardV3).__lorebookOnly;
    const payload = isLB ? CardParser.unwrapLorebook(moddedCard) : moddedCard;
    const name = isLB
      ? ((moddedCard.data?.character_book?.name || moddedCard.data?.name || 'lorebook'))
      : (moddedCard.data?.name || 'card');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${isLB ? 'LOREBOOK_MODDED' : 'MODDED'}_${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-950 p-6 font-sans">
      <header className="max-w-6xl mx-auto mb-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-neutral-100 tracking-tight">
              SillyTavern Card Mod AI IDE
            </h1>
            <p className="text-neutral-300 mt-1 font-medium">{t.appSubtitle}</p>
          </div>
          <button 
            onClick={() => setActiveTab('settings')}
            className="text-sm font-bold text-neutral-200 hover:text-indigo-300 flex items-center gap-1"
          >
            {t.settingsBtn}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Cột trái: Quản lý File & Rules */}
        <div className="space-y-6">
          <div className="bg-neutral-900 p-4 rounded-lg shadow-sm border border-neutral-800">
            <h2 className="text-lg font-extrabold text-neutral-100 mb-3">{t.fileSection}</h2>
            {!card ? (
              <FileUploader onCardLoaded={handleCardLoaded} />
            ) : (
              <div className="p-3 bg-green-950/40 border border-green-700 rounded text-sm">
                <p className="font-bold text-green-200">{t.fileLoadedPrefix} {card.data?.name || t.fileUnnamed}</p>
                {isLorebookOnly && (
                  <span className="inline-block mt-1 mr-1 px-2 py-0.5 bg-amber-900/40 text-amber-200 border border-amber-700 rounded text-xs font-black">
                    {fmt(t.fileLorebookMode, { count: card.data?.character_book?.entries?.length || 0 })}
                  </span>
                )}
                {isMvuCard && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-purple-900/40 text-purple-200 border border-purple-700 rounded text-xs font-black animate-pulse">
                    {t.fileMvuZod}
                  </span>
                )}
                {!isLorebookOnly && (
                  <p className="text-green-200 text-xs mt-1 font-semibold truncate">
                    {card.data?.description?.substring(0, 80)}...
                  </p>
                )}
                <button
                  onClick={() => { setCard(null); setAnalysisResult(null); setIsMvuCard(false); setMvuVariables([]); setIsLorebookOnly(false); setActiveTab('upload'); }}
                  className="mt-3 text-xs text-red-600 hover:underline"
                >
                  {t.fileLoadAnother}
                </button>
              </div>
            )}
          </div>

          {isMvuCard && mvuVariables.length > 0 && (
            <div className="bg-neutral-900 p-4 rounded-lg shadow-sm border border-neutral-800">
              <h2 className="text-lg font-extrabold text-neutral-100 mb-1">{t.zodSection}</h2>
              <p className="text-xs text-neutral-300 font-semibold mb-2">
                {t.zodDesc}
              </p>
              <div className="max-h-40 overflow-y-auto border border-neutral-800 rounded p-2 bg-neutral-900 flex flex-wrap gap-1">
                {mvuVariables.map((v, i) => (
                  <span key={i} className="text-xs px-1.5 py-0.5 bg-indigo-950/40 border border-indigo-800 text-indigo-200 font-bold rounded">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isMvuCard && card && (
            <VarRemapPanel
              card={card}
              llmConfig={llmConfig}
              extraProviders={extraProviders}
              onApplied={(newCard, count) => {
                setModdedCard(newCard);
                setProcessStatus(fmt(t.zodRemapped, { count }));
                setActiveTab('diff');
              }}
            />
          )}

          <div className="bg-neutral-900 p-4 rounded-lg shadow-sm border border-neutral-800">
            <h2 className="text-lg font-extrabold text-neutral-100 mb-3">{t.modSection}</h2>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder={t.modPlaceholder}
              rows={4}
              className="w-full text-sm rounded-md border-neutral-700 shadow-sm border-2 p-2 bg-neutral-900 focus:bg-neutral-800 focus:ring-indigo-500 focus:border-indigo-500 transition-colors placeholder-neutral-500 text-neutral-100 font-medium"
            />
          </div>

          <ModRulesManager rules={rules} onChange={setRules} />

          {card && (
            <SubExpandPanel
              card={moddedCard || card}
              llmConfig={llmConfig}
              extraProviders={extraProviders}
              onApplied={(newCard) => {
                setModdedCard(newCard);
                setProcessStatus(t.subExpandDone);
                setActiveTab('diff');
              }}
            />
          )}

          <div className="bg-neutral-900 p-4 rounded-lg shadow-sm border border-neutral-800">
            <h3 className="font-extrabold text-neutral-100 mb-2">{t.orchSection}</h3>

            {/* Chế độ Mở rộng / đào sâu */}
            <div className="mb-3 p-2.5 rounded-md border border-amber-700 bg-amber-950/40">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={expandMode} onChange={e => setExpandMode(e.target.checked)} />
                <span className="text-sm font-bold text-amber-200">{t.expandMode}</span>
              </label>
              <p className="text-[11px] text-amber-200 mt-1 leading-snug">
                {t.expandModeDesc}
              </p>
              {expandMode && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-amber-200">{t.expandIntensityLabel}</span>
                  <select value={expandIntensity} onChange={e => setExpandIntensity(e.target.value)}
                    className="text-xs border border-amber-700 rounded px-2 py-1 bg-neutral-900 text-amber-200 font-bold">
                    <option value="nhẹ">{t.intensityLight}</option>
                    <option value="vừa">{t.intensityMedium}</option>
                    <option value="sâu">{t.intensityDeep}</option>
                  </select>
                </div>
              )}
            </div>

            {!isProcessing ? (
              <button
                onClick={runFullPipeline}
                disabled={!card || (rules.filter(r => r.enabled).length === 0 && !customPrompt.trim())}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg font-semibold shadow hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t.runBtn}
              </button>
            ) : (
              <button
                onClick={stopModding}
                className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold shadow hover:bg-red-700 transition-colors"
              >
                {t.stopBtn}
              </button>
            )}

            {isProcessing && (
              <div className="mt-3 p-2 bg-blue-950/40 text-blue-300 text-xs rounded border border-blue-800 animate-pulse">
                ⏳ {processStatus}
              </div>
            )}
            {!isProcessing && processStatus && (
              <div className="mt-3 p-2 bg-neutral-800 text-neutral-300 text-xs rounded border border-neutral-800">
                ℹ️ {processStatus}
              </div>
            )}
            {scriptWarnings.length > 0 && (
              <div className="mt-3 p-2 bg-red-950/40 text-red-300 text-xs rounded border border-red-700">
                ⚠️ <b>{fmt(t.scriptWarnBold, { count: scriptWarnings.length })}</b> {t.scriptWarnRest}
                <ul className="list-disc ml-4 mt-1">
                  {scriptWarnings.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Cột phải: Workspace & Diff Viewer */}
        <div className="lg:col-span-2">
          <div className="bg-neutral-900 rounded-lg shadow-sm border border-neutral-800 h-full flex flex-col">
            <div className="border-b px-4 py-3 flex gap-4 text-sm font-medium">
              <button 
                onClick={() => setActiveTab('workspace')}
                className={`pb-1 border-b-2 ${activeTab === 'workspace' ? 'border-indigo-600 text-indigo-300 font-bold' : 'border-transparent text-neutral-300 hover:text-neutral-100 font-semibold'}`}
              >
                {t.tabWorkspace}
              </button>
              <button 
                onClick={() => setActiveTab('diff')}
                className={`pb-1 border-b-2 ${activeTab === 'diff' ? 'border-indigo-600 text-indigo-300 font-bold' : 'border-transparent text-neutral-300 hover:text-neutral-100 font-semibold'}`}
              >
                {t.tabDiff}
              </button>
              <button 
                onClick={() => setActiveTab('settings')}
                className={`pb-1 border-b-2 ${activeTab === 'settings' ? 'border-indigo-600 text-indigo-300 font-bold' : 'border-transparent text-neutral-300 hover:text-neutral-100 font-semibold'}`}
              >
                {t.tabSettings}
              </button>
            </div>
            
            <div className="p-4 flex-1 bg-neutral-900 overflow-auto min-h-[500px]">
              {activeTab === 'upload' && !card && (
                <div className="h-full flex items-center justify-center text-neutral-300 font-semibold">
                  {t.needCardHint}
                </div>
              )}
              
              {activeTab === 'workspace' && (
                <div>
                  <h3 className="font-bold text-neutral-100 text-lg mb-3">{t.analysisTitle}</h3>
                  {!analysisResult ? (
                    <div className="text-neutral-300 font-medium text-sm">{t.analysisEmpty}</div>
                  ) : (
                    <div className="space-y-3">
                      {analysisResult.map((res: AnalysisItem, idx: number) => (
                        <div key={idx} className={`p-3 rounded border ${res.status === 'NEEDS_MOD' ? 'bg-orange-950/40 border-orange-700' : 'bg-neutral-800 border-neutral-700'}`}>
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-neutral-100">{String(res.label || res.section_id)}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-black ${res.status === 'NEEDS_MOD' ? 'bg-orange-200 text-orange-200' : 'bg-gray-300 text-neutral-100'}`}>
                              {String(res.status)}
                            </span>
                          </div>
                          <p className="text-sm text-neutral-100 mb-1"><strong>{t.analysisReason}</strong> {String(res.reason)}</p>
                          {res.status === 'NEEDS_MOD' && (
                            <p className="text-sm text-neutral-100"><strong>{t.analysisPreview}</strong> {String(res.preview_change)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'diff' && (
                <div className="h-full">
                  <h3 className="font-bold text-neutral-100 text-lg mb-3">{t.resultTitle}</h3>
                  {!moddedCard ? (
                    <div className="flex items-center justify-center text-neutral-300 font-semibold h-64">
                      {t.resultEmpty}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {auditResult && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className={`p-4 rounded-lg border ${auditResult.consistency_score >= 80 ? 'bg-green-950/40 border-green-700' : 'bg-red-950/40 border-red-700'}`}>
                            <div className="flex items-center justify-between">
                              <h4 className="font-black text-neutral-100">{t.auditTitle}</h4>
                              <span className="text-xl font-black text-neutral-100">{auditResult.consistency_score}/100</span>
                            </div>
                            <p className="text-sm mt-1 text-neutral-100 font-medium">{auditResult.summary}</p>
                            {auditResult.inconsistencies?.length > 0 && (
                              <ul className="mt-3 text-xs space-y-1">
                                {auditResult.inconsistencies.map((inc: { severity: string; dimension: string; description: string }, i: number) => (
                                  <li key={i} className="text-red-200 bg-red-900/40 p-2 rounded border border-red-800 font-medium">
                                    <strong>[{inc.severity}] {inc.dimension}:</strong> {inc.description}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {validationResult && (
                            <div className={`p-4 rounded-lg border ${validationResult.status === 'PASS' ? 'bg-green-950/40 border-green-700' : 'bg-orange-950/40 border-orange-700'}`}>
                              <div className="flex items-center justify-between">
                                <h4 className="font-black text-neutral-100">{t.validationTitle}</h4>
                                <span className={`text-sm px-2 py-0.5 rounded font-black ${validationResult.status === 'PASS' ? 'bg-green-200 text-green-200' : 'bg-orange-200 text-orange-200'}`}>
                                  {validationResult.status}
                                </span>
                              </div>
                              <p className="text-xs mt-1 text-neutral-100 font-semibold">
                                {fmt(t.validationVerified, { count: validationResult.stats?.protected_fields_verified || 0 })}
                              </p>
                              {validationResult.issues && validationResult.issues.length > 0 && (
                                <ul className="mt-3 text-xs space-y-1">
                                  {validationResult.issues.map((issue: { severity: string; category: string; description: string; fix: string }, i: number) => (
                                    <li key={i} className="text-orange-200 bg-orange-900/40 p-2 rounded border border-orange-800 font-medium">
                                      <strong>[{issue.severity}] {issue.category}:</strong> {issue.description} ({t.suggestLabel}: {issue.fix})
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="flex gap-4 mb-4">
                        <button
                          onClick={handleDownload}
                          className="px-4 py-2 bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 shadow"
                        >
                          {isLorebookOnly ? t.downloadLorebook : t.downloadJson}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="border rounded-md overflow-hidden flex flex-col">
                          <div className="bg-red-900/40 p-2 font-semibold text-red-300 border-b border-red-800 text-sm">{t.jsonBefore}</div>
                          <pre className="p-3 bg-neutral-900 text-xs overflow-auto flex-1 max-h-[500px]">
                            {JSON.stringify({
                              description: card?.data?.description,
                              personality: card?.data?.personality,
                              scenario: card?.data?.scenario,
                              first_mes: card?.data?.first_mes,
                            }, null, 2)}
                          </pre>
                        </div>
                        <div className="border rounded-md overflow-hidden flex flex-col">
                          <div className="bg-green-900/40 p-2 font-semibold text-green-300 border-b border-green-800 text-sm">{t.jsonAfter}</div>
                          <pre className="p-3 bg-neutral-900 text-xs overflow-auto flex-1 max-h-[500px]">
                            {JSON.stringify({
                              description: moddedCard?.data?.description,
                              personality: moddedCard?.data?.personality,
                              scenario: moddedCard?.data?.scenario,
                              first_mes: moddedCard?.data?.first_mes,
                            }, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="max-w-xl bg-neutral-900 p-6 rounded-xl border-2 border-neutral-700 shadow-inner">
                  <h3 className="font-black text-2xl text-neutral-100 mb-2 border-b-2 border-neutral-700 pb-2">{t.settingsTitle}</h3>
                  {/* (Bug #14) Trấn an user: không cần nút Lưu — mọi thay đổi tự lưu vào trình duyệt, F5 không mất. */}
                  <p className="text-xs text-emerald-300 font-semibold mb-5 flex items-center gap-1.5">
                    <span>💾</span> {t.settingsAutosave}
                  </p>
                  <div className="space-y-5">
                    {/* Provider */}
                    <div>
                      <label className="block text-sm font-black text-neutral-100">{t.cfgProvider}</label>
                      <select 
                        value={llmConfig.provider} 
                        onChange={e => handleProviderChange(e.target.value as 'gemini' | 'anthropic' | 'openai')}
                        className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 focus:border-indigo-600"
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="anthropic">Anthropic Claude</option>
                        <option value="openai">OpenAI / OpenRouter / Custom Proxy</option>
                      </select>
                    </div>

                    {/* Custom Proxy URL (Link Proxy) */}
                    <div>
                      <label className="block text-sm font-black text-neutral-100">{t.cfgBaseUrl}</label>
                      <input 
                        type="text" 
                        value={llmConfig.customUrl || ''} 
                        onChange={e => setLlmConfig({...llmConfig, customUrl: e.target.value})}
                        placeholder={
                          llmConfig.provider === 'openai' ? t.cfgBaseUrlPhOpenai :
                          llmConfig.provider === 'gemini' ? t.cfgBaseUrlPhGemini :
                          t.cfgBaseUrlPhAnthropic
                        }
                        className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 placeholder-neutral-500 focus:border-indigo-600"
                      />
                      <p className="text-xs text-neutral-200 font-semibold mt-1">{t.cfgBaseUrlHint}</p>
                    </div>

                    {/* API Key / Password (Mật khẩu Proxy) */}
                    <div>
                      <label className="block text-sm font-black text-neutral-100">{t.cfgApiKey}</label>
                      <input 
                        type="password" 
                        value={llmConfig.apiKey} 
                        onChange={e => setLlmConfig({...llmConfig, apiKey: e.target.value})}
                        placeholder={t.cfgApiKeyPh}
                        className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 placeholder-neutral-500 focus:border-indigo-600"
                      />
                      <p className="text-xs text-neutral-100 font-bold mt-1">
                        {t.cfgApiKeyNote}
                      </p>
                    </div>

                    {/* Scan button */}
                    <button
                      type="button"
                      onClick={handleScanModels}
                      disabled={isScanningModels || !llmConfig.apiKey}
                      className="w-full py-2.5 bg-indigo-700 text-white rounded-lg font-black hover:bg-indigo-800 disabled:opacity-50 transition-colors shadow-md text-sm cursor-pointer"
                    >
                      {isScanningModels ? t.cfgScanning : t.cfgScanBtn}
                    </button>

                    {/* Model */}
                    <div>
                      <div className="flex justify-between items-center">
                        <label className="block text-sm font-black text-neutral-100">{t.cfgModel}</label>
                        <button
                          type="button"
                          onClick={() => setManualModelInput(!manualModelInput)}
                          className="text-xs text-indigo-300 hover:text-indigo-200 font-black underline"
                        >
                          {manualModelInput ? t.cfgPickFromList : t.cfgTypeManually}
                        </button>
                      </div>

                      {manualModelInput ? (
                        <input 
                          type="text" 
                          value={llmConfig.model} 
                          onChange={e => setLlmConfig({...llmConfig, model: e.target.value})}
                          placeholder={t.cfgModelPh}
                          className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 placeholder-neutral-500 focus:border-indigo-600"
                        />
                      ) : (
                        <select
                          value={llmConfig.model}
                          onChange={e => setLlmConfig({...llmConfig, model: e.target.value})}
                          className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 focus:border-indigo-600 font-extrabold"
                        >
                          {scannedModels.length > 0 ? (
                            scannedModels.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))
                          ) : (
                            // Mẫu mặc định tùy theo Provider
                            llmConfig.provider === 'gemini' ? (
                              <>
                                <option value="gemini-1.5-pro-latest">gemini-1.5-pro-latest {t.cfgRecommended}</option>
                                <option value="gemini-1.5-flash-latest">gemini-1.5-flash-latest (Nhanh)</option>
                                <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
                              </>
                            ) : llmConfig.provider === 'openai' ? (
                              <>
                                <option value="gpt-4o">gpt-4o {t.cfgRecommended}</option>
                                <option value="gpt-4o-mini">gpt-4o-mini</option>
                                <option value="gpt-4-turbo">gpt-4-turbo</option>
                              </>
                            ) : (
                              <>
                                <option value="claude-3-5-sonnet-20240620">claude-3-5-sonnet-20240620 {t.cfgRecommended}</option>
                                <option value="claude-3-opus-20240229">claude-3-opus-20240229</option>
                                <option value="claude-3-haiku-20240307">claude-3-haiku-20240307</option>
                              </>
                            )
                          )}
                        </select>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t-2 border-neutral-700 pt-4">
                      {/* Max Output Tokens */}
                      <div>
                        <label className="block text-xs font-black text-neutral-100">{t.cfgMaxTokens}</label>
                        <input 
                          type="number" 
                          min={256}
                          max={16384}
                          value={llmConfig.maxOutputTokens || 4096}
                          onChange={e => setLlmConfig({...llmConfig, maxOutputTokens: parseInt(e.target.value) || 4096})}
                          className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 focus:border-indigo-600"
                        />
                      </div>

                      {/* Temperature */}
                      <div>
                        <label className="block text-xs font-black text-neutral-100">{t.cfgTemperature}</label>
                        <input 
                          type="number" 
                          min={0.0}
                          max={2.0}
                          step={0.1}
                          value={llmConfig.temperature !== undefined ? llmConfig.temperature : 0.2}
                          onChange={e => setLlmConfig({...llmConfig, temperature: parseFloat(e.target.value) || 0.2})}
                          className="mt-1 block w-full rounded-md border-2 border-neutral-700 shadow-sm p-2 text-neutral-100 font-bold bg-neutral-900 focus:border-indigo-600"
                        />
                      </div>
                    </div>

                    <ExtraProvidersPanel providers={extraProviders} onChange={setExtraProviders} />

                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
      </main>
    </div>
  );
}
