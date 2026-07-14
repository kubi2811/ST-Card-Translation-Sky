import React, { useState, useMemo } from 'react';

import { useStore } from '../store';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { TARGET_LANGUAGES, SOURCE_LANGUAGES, extractTranslatableFields } from '../utils/cardFields';
import { getDefaultTranslationPrompt, getModelSuggestions } from '../utils/apiClient';
import { aiExtractGlossaryTerms } from '../utils/mvuSync';
import type { LorebookStrategy, FieldGroupConfig, FieldGroup, GlossaryEntry, NameStyle } from '../types/card';
import { Languages, FileJson, BookOpen, Plus, Trash2, Download, Upload, Bot, Loader2, Save, RotateCcw, CheckCircle, Zap } from 'lucide-react';
import { recommendPreset } from '../utils/presetRecommend';
import { GLOSSARY_PRESETS } from '../utils/glossaryPresets';
import { mergeGlossary } from '../utils/nameGlossary';
import { estimateLorebookBatchLoad } from '../utils/estimateBatchTokens';
import { usePresetApply } from '../hooks/usePresetApply';
import MvuSyncPanel from './MvuSyncPanel';
import EjsSyncPanel from './EjsSyncPanel';

/** Map field group IDs to i18n keys */
function useGroupLabels() {
  const t = useT();
  const map: Record<FieldGroup, { label: string; desc: string }> = {
    core: { label: t.groupCore, desc: t.groupCoreDesc },
    messages: { label: t.groupMessages, desc: t.groupMessagesDesc },
    system: { label: t.groupSystem, desc: t.groupSystemDesc },
    creator: { label: t.groupCreator, desc: t.groupCreatorDesc },
    lorebook: { label: t.groupLorebook, desc: t.groupLorebookDesc },
    lorebook_keys: { label: t.groupLorebookKeys, desc: t.groupLorebookKeysDesc },
    regex: { label: t.groupRegex, desc: t.groupRegexDesc },
    depth_prompt: { label: t.groupDepthPrompt, desc: t.groupDepthPromptDesc },
    tavern_helper: { label: t.groupTavernHelper, desc: t.groupTavernHelperDesc },
  };
  return map;
}

const getFieldBaseKey = (path: string) => {
  const lastPart = path.split('.').pop() || '';
  return lastPart.replace(/\[\d+\]$/, '');
};

export default function TranslateConfig() {
  const { translationConfig, setTranslationConfig, toggleFieldGroup, card, proxy, addToast, fields, setFields, deleteCurrentCardCache, deleteAllCaches, scannedModels, resetTranslationConfig, activePresetId } = useStore();
  const ui = useUi();

  const allAvailableFields = useMemo(() => {
    if (!card) return [];
    const groups: FieldGroup[] = ['core', 'messages', 'system', 'creator', 'lorebook', 'lorebook_keys', 'regex', 'depth_prompt', 'tavern_helper'];
    return extractTranslatableFields(card, groups);
  }, [card]);

  // (User yêu cầu) Ước lượng tải token cho chế độ gộp nhiều entry/lô — hiển thị cảnh báo trước khi chạy.
  const batchLoadEstimate = useMemo(() => {
    if (!translationConfig.lorebookManualBatch || translationConfig.lorebookStrategy !== 'batch') return null;
    const loreTexts = allAvailableFields.filter(f => f.group === 'lorebook').map(f => f.original);
    if (loreTexts.length === 0) return null;
    return estimateLorebookBatchLoad(loreTexts, translationConfig.lorebookBatchSize, proxy.maxTokens || 65536);
  }, [allAvailableFields, translationConfig.lorebookManualBatch, translationConfig.lorebookStrategy, translationConfig.lorebookBatchSize, proxy.maxTokens]);

  const handleApplyToAllSimilar = (currentValue: string, fieldPath: string, groupId: string) => {
    const baseKey = getFieldBaseKey(fieldPath);
    const targetFields = allAvailableFields.filter(f => f.group === groupId && getFieldBaseKey(f.path) === baseKey);
    
    const newEntryRouting = { ...translationConfig.entryModelRouting };
    targetFields.forEach(f => {
      newEntryRouting[f.path] = currentValue;
    });
    
    setTranslationConfig({ entryModelRouting: newEntryRouting });
    addToast('success', fmt(ui.tcToastModelAll, { key: baseKey }));
  };

  const t = useT();
  const groupLabels = useGroupLabels();
  const modelSuggestions = [
    ...scannedModels,
    ...getModelSuggestions(proxy.provider).filter(s => !scannedModels.includes(s))
  ];
  const [isAutoExtractingGlossary, setIsAutoExtractingGlossary] = useState(false);
  const defaultPrompt = getDefaultTranslationPrompt(translationConfig.sourceLanguage, translationConfig.targetLanguage);
  const [promptDraft, setPromptDraft] = useState<string>(translationConfig.translationPrompt || '');
  const [schemaDraft, setSchemaDraft] = useState<string>(translationConfig.customSchema || '');
  const [modInstructionsDraft, setModInstructionsDraft] = useState<string>(translationConfig.modInstructions || '');
  const [promptSaved, setPromptSaved] = useState(false);
  const [schemaSaved, setSchemaSaved] = useState(false);
  const [modInstructionsSaved, setModInstructionsSaved] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Track whether drafts differ from saved values
  const promptDirty = promptDraft !== (translationConfig.translationPrompt || '');
  const schemaDirty = schemaDraft !== (translationConfig.customSchema || '');
  const modInstructionsDirty = modInstructionsDraft !== (translationConfig.modInstructions || '');

  const savePrompt = () => {
    const defaultP = getDefaultTranslationPrompt(translationConfig.sourceLanguage, translationConfig.targetLanguage);
    if (promptDraft === defaultP || !promptDraft.trim()) {
      setTranslationConfig({ translationPrompt: '' });
      setPromptDraft('');
    } else {
      setTranslationConfig({ translationPrompt: promptDraft });
    }
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 2000);
  };

  const resetPrompt = () => {
    setTranslationConfig({ translationPrompt: '' });
    setPromptDraft('');
  };

  const saveSchema = () => {
    setTranslationConfig({ customSchema: schemaDraft });
    setSchemaSaved(true);
    setTimeout(() => setSchemaSaved(false), 2000);
  };

  const saveModInstructions = () => {
    setTranslationConfig({ modInstructions: modInstructionsDraft });
    setModInstructionsSaved(true);
    setTimeout(() => setModInstructionsSaved(false), 2000);
  };

  const updateGlossaryEntry = (index: number, field: 'source' | 'target', value: string) => {
    const updated = [...translationConfig.glossary];
    updated[index] = { ...updated[index], [field]: value };
    setTranslationConfig({ glossary: updated });
  };

  const addGlossaryEntry = () => {
    setTranslationConfig({ glossary: [...translationConfig.glossary, { source: '', target: '' }] });
  };

  const removeGlossaryEntry = (index: number) => {
    const updated = translationConfig.glossary.filter((_, i) => i !== index);
    setTranslationConfig({ glossary: updated });
    setSelectedGlossary((prev) => {
      const next = new Set<number>();
      for (const i of prev) { if (i < index) next.add(i); else if (i > index) next.add(i - 1); }
      return next;
    });
  };

  // (User 2026) XOÁ NHIỀU MỤC 1 LẦN — tick chọn từng dòng (hoặc chọn tất cả) rồi xoá 1 phát,
  // thay vì bấm thùng rác từng dòng với từ điển hàng trăm mục.
  const [selectedGlossary, setSelectedGlossary] = useState<Set<number>>(new Set());
  const toggleGlossarySelected = (idx: number) => {
    setSelectedGlossary((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  const removeSelectedGlossary = () => {
    if (selectedGlossary.size === 0) return;
    const updated = translationConfig.glossary.filter((_, i) => !selectedGlossary.has(i));
    setTranslationConfig({ glossary: updated });
    setSelectedGlossary(new Set());
  };
  const removeAllGlossary = () => {
    if (translationConfig.glossary.length === 0) return;
    if (!window.confirm(fmt(ui.tcGlsDelAllConfirm, { count: translationConfig.glossary.length }))) return;
    setTranslationConfig({ glossary: [] });
    setSelectedGlossary(new Set());
  };

  const exportGlossary = () => {
    const json = JSON.stringify(
      translationConfig.glossary.filter(g => g.source.trim() || g.target.trim()).map(({ source, target }) => ({ source, target })),
      null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glossary.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importGlossary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target?.result as string) as GlossaryEntry[];
        if (Array.isArray(imported)) {
          setTranslationConfig({ glossary: [...translationConfig.glossary, ...imported] });
        }
      } catch {
        // silently fail
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const autoExtractGlossary = async () => {
    if (!card) return;
    setIsAutoExtractingGlossary(true);
    try {
      const extracted = await aiExtractGlossaryTerms(card, translationConfig.targetLanguage, proxy);
      
      const newEntries: GlossaryEntry[] = [];
      let added = 0;
      
      // Avoid duplicates
      const existingSources = new Set(translationConfig.glossary.map(g => g.source.trim().toLowerCase()));
      
      for (const [source, target] of Object.entries(extracted)) {
        if (source.trim() && !existingSources.has(source.trim().toLowerCase())) {
          // (Fix bug #10) trích từ card hiện tại → đánh dấu auto để dọn khi gỡ card/xoá cache.
          newEntries.push({ source: source.trim(), target: target.trim(), auto: true, origin: 'name' });
          added++;
        }
      }
      
      if (added > 0) {
        setTranslationConfig({ glossary: [...translationConfig.glossary, ...newEntries] });
        addToast('success', fmt(ui.tcToastGlossaryOk, { count: added }));
      } else {
        addToast('info', ui.tcToastGlossaryNone);
      }
    } catch (err) {
      addToast('error', fmt(ui.tcToastAiErr, { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsAutoExtractingGlossary(false);
    }
  };
  const isModMode = translationConfig.enableModMode;
  // (Audit đợt 2) Gấp setting chuyên sâu vào mục "Nâng cao" — nhớ trạng thái qua LS.
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    try { return localStorage.getItem('st-tc-show-advanced') === '1'; } catch { return false; }
  });
  // 🔍 Phân tích card khi import → gợi ý preset phù hợp (MVU/script nặng → nhẹ; to → siêu tốc; gọn → đầy đủ).
  const recommendation = useMemo(() => (card ? recommendPreset(card) : null), [card]);
  const recStar = (id: string) => recommendation?.preset === id
    ? <span title={ui.tcRecBadge} style={{ marginLeft: 4, color: '#facc15', fontWeight: 800 }}>★</span>
    : null;
  const recMsgKey = recommendation
    ? ({ mvu: 'tcRecMvu', script: 'tcRecScript', big: 'tcRecBig', small: 'tcRecSmall' } as const)[recommendation.reason]
    : null;

  // Preset đang chọn — nằm trong store (LS) để nút preset + popup gợi ý đồng bộ highlight.
  const applyPreset = usePresetApply();
  const presetBtnStyle = (id: string): React.CSSProperties => activePresetId === id
    ? {
        border: '2px solid var(--accent-primary)',
        background: 'rgba(124,106,240,0.18)',
        color: 'var(--text-primary)',
        fontWeight: 700,
        boxShadow: '0 0 8px rgba(124,106,240,0.35)',
      }
    : { border: '1px solid var(--border-default)' };

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <Languages size={16} style={{ color: isModMode ? '#9b59b6' : 'var(--accent-warning)' }} />
          {isModMode ? t.modPanel : t.translationSettings}
        </span>
      </div>
      <div className="section-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* ═══ PRESET NHANH — 3 nút dùng chung logic usePresetApply với popup gợi ý sau import.
            Sao ★ = preset được bộ phân tích card khuyên dùng; viền sáng = preset đang chọn. ═══ */}
        {card && !isModMode && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(124,106,240,0.35)',
            background: 'rgba(124,106,240,0.06)',
          }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, marginBottom: '6px' }}>
              {ui.tcPresetLabel}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" style={presetBtnStyle('light')} title={ui.tcPresetLightHint}
                onClick={() => applyPreset('light')}>
                {ui.tcPresetLight}{recStar('light')}
              </button>
              <button type="button" className="btn btn-sm" style={presetBtnStyle('full')}
                onClick={() => applyPreset('full')}>
                {ui.tcPresetFull}{recStar('full')}
              </button>
              <button type="button" className="btn btn-sm" style={presetBtnStyle('turbo')} title={ui.tcPresetTurboHint}
                onClick={() => applyPreset('turbo')}>
                {ui.tcPresetTurbo}{recStar('turbo')}
              </button>
            </div>
            {recommendation && recMsgKey && (
              <div style={{ marginTop: 8, fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.5, borderTop: '1px dashed var(--border-subtle)', paddingTop: 6 }}>
                {ui[recMsgKey]}
              </div>
            )}
          </div>
        )}

        {/* ═══ Mode Switch: Mod Mode toggle — always visible at the top ═══ */}
        <div style={{
          padding: '10px 12px',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${isModMode ? 'rgba(155,89,182,0.3)' : 'var(--border-subtle)'}`,
          background: isModMode ? 'rgba(155,89,182,0.06)' : 'transparent',
          transition: 'all 0.2s',
        }}>
          <label className="checkbox-wrapper" style={{ marginBottom: isModMode ? '10px' : 0 }}>
            <input
              type="checkbox"
              checked={translationConfig.enableModMode}
              onChange={(e) => setTranslationConfig({ enableModMode: e.target.checked })}
            />
            <div>
              <span style={{ color: isModMode ? '#9b59b6' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                🔧 {t.modMode}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                {t.modModeDesc}
              </span>
            </div>
          </label>

          {isModMode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {t.modInstructions}
                  {modInstructionsDirty && (
                    <span style={{ fontSize: '0.6rem', padding: '1px 6px', background: 'rgba(255,180,0,0.15)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-warning)', fontWeight: 600 }}>
                      {ui.tcUnsaved}
                    </span>
                  )}
                  {modInstructionsSaved && !modInstructionsDirty && (
                    <span style={{ fontSize: '0.6rem', padding: '1px 6px', background: 'rgba(80,200,120,0.15)', borderRadius: 'var(--radius-sm)', color: '#50c878', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <CheckCircle size={10} /> {t.modSaved}
                    </span>
                  )}
                </span>
                <button
                  onClick={saveModInstructions}
                  disabled={!modInstructionsDirty}
                  style={{
                    padding: '2px 10px', fontSize: '0.7rem', fontWeight: 600,
                    border: '1px solid #9b59b6', borderRadius: 'var(--radius-sm)',
                    background: modInstructionsDirty ? '#9b59b6' : 'transparent',
                    color: modInstructionsDirty ? 'white' : 'var(--text-muted)',
                    cursor: modInstructionsDirty ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', gap: '4px',
                    transition: 'all 0.15s', opacity: modInstructionsDirty ? 1 : 0.5,
                  }}
                >
                  <Save size={11} /> {t.modSave}
                </button>
              </label>
              <textarea
                className="input"
                style={{
                  width: '100%', minHeight: '80px', fontFamily: 'inherit', fontSize: '0.8rem',
                  resize: 'vertical',
                  borderColor: modInstructionsDirty ? '#9b59b6' : undefined,
                }}
                placeholder={t.modInstructionsPlaceholder}
                value={modInstructionsDraft}
                onChange={(e) => setModInstructionsDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveModInstructions(); } }}
              />
              {modInstructionsDirty && translationConfig.modInstructions?.trim() && (
                <span style={{ fontSize: '0.6rem', color: 'var(--accent-warning)' }}>
                  {ui.tcSaveBeforeApply}
                </span>
              )}

              {/* Dropdown Mod Preset */}
              <div style={{ marginTop: '6px' }}>
                <label className="label" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {t.modPreset}
                </label>
                <select
                  className="input"
                  style={{ width: '100%', fontSize: '0.8rem', padding: '4px 8px' }}
                  value={translationConfig.modPreset || 'none'}
                  onChange={(e) => setTranslationConfig({ modPreset: e.target.value as any })}
                >
                  <option value="none">{t.modPresetNone}</option>
                  <option value="ntr_to_ntl">{t.modPresetNtrToNtl}</option>
                </select>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', display: 'block', marginTop: '2px' }}>
                  {t.modPresetDesc}
                </span>
              </div>

              {/* Mod Thinking Mode toggle */}
              <label className="checkbox-wrapper" style={{ marginTop: '6px' }}>
                <input
                  type="checkbox"
                  checked={translationConfig.enableModThinking || false}
                  onChange={(e) => setTranslationConfig({ enableModThinking: e.target.checked })}
                />
                <div>
                  <span style={{ color: translationConfig.enableModThinking ? '#9b59b6' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', fontWeight: 500 }}>
                    🧠 {ui.tcModThinking}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', display: 'block', marginTop: '2px' }}>
                    {ui.tcModThinkingDesc}
                  </span>
                </div>
              </label>

              {/* Patch Mode toggle */}
              <label className="checkbox-wrapper" style={{ marginTop: '6px' }}>
                <input
                  type="checkbox"
                  checked={translationConfig.enablePatchMode || false}
                  onChange={(e) => setTranslationConfig({ enablePatchMode: e.target.checked })}
                />
                <div>
                  <span style={{ color: translationConfig.enablePatchMode ? '#9b59b6' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' }}>
                    🩹 {t.patchMode}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', display: 'block', marginTop: '2px' }}>
                    {t.patchModeDesc}
                  </span>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* ═══ TRANSLATION-ONLY SETTINGS — hidden when Mod mode is active ═══ */}
        {!isModMode && (
          <>
            {/* Source & Target Languages */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label className="label">Source Language</label>
                <select className="input" value={translationConfig.sourceLanguage || 'auto'} onChange={(e) => setTranslationConfig({ sourceLanguage: e.target.value })}>
                  {SOURCE_LANGUAGES.map((l) => (<option key={l.value} value={l.value}>{l.label}</option>))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">{t.targetLanguage}</label>
                <select className="input" value={translationConfig.targetLanguage} onChange={(e) => setTranslationConfig({ targetLanguage: e.target.value })}>
                  {TARGET_LANGUAGES.map((l) => (<option key={l.value} value={l.value}>{l.label}</option>))}
                  <option value="custom">Custom...</option>
                </select>
                {translationConfig.targetLanguage === 'custom' && (
                  <input className="input" style={{ marginTop: '6px' }} placeholder="Enter target language..." onChange={(e) => setTranslationConfig({ targetLanguage: e.target.value || 'custom' })} />
                )}
              </div>
            </div>

            {/* Skip already translated */}
            <label className="checkbox-wrapper">
              <input type="checkbox" checked={translationConfig.skipAlreadyTranslated} onChange={(e) => setTranslationConfig({ skipAlreadyTranslated: e.target.checked })} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t.skipAlreadyTranslated}</span>
            </label>

            {/* Jailbreak */}
            <label className="checkbox-wrapper" style={{ marginTop: '-4px' }}>
              <input type="checkbox" checked={translationConfig.enableJailbreak || false} onChange={(e) => setTranslationConfig({ enableJailbreak: e.target.checked })} />
              <span style={{ color: 'var(--accent-danger)', fontSize: '0.8rem', fontWeight: 500 }}>
                {ui.tcJailbreak}
              </span>
            </label>

            {/* Gomorrah NSFW Protection Rules */}
            <label className="checkbox-wrapper" style={{ marginTop: '-4px' }}>
              <input type="checkbox" checked={translationConfig.enableGomorrahNsfwRules || false} onChange={(e) => setTranslationConfig({ enableGomorrahNsfwRules: e.target.checked })} />
              <span style={{ color: 'rgba(200,100,200,0.8)', fontSize: '0.8rem', fontWeight: 500 }}>
                {ui.tcGomorrah}
              </span>
            </label>

            {/* Objective Mode */}
            <label className="checkbox-wrapper" style={{ marginTop: '-4px' }}>
              <input type="checkbox" checked={translationConfig.enableObjectiveMode !== false} onChange={(e) => setTranslationConfig({ enableObjectiveMode: e.target.checked })} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                {ui.tcObjective}
              </span>
            </label>
          </>
        )}

        {/* ═══ Glossary / Terminology Database ═══ */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label className="label" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <BookOpen size={13} />
              {ui.tcGlossary}
              {translationConfig.glossary.filter(g => g.source.trim()).length > 0 && (
                <span style={{
                  fontSize: '0.6rem', padding: '1px 5px',
                  background: 'rgba(124,106,240,0.1)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent-primary)', fontWeight: 600,
                }}>
                  {translationConfig.glossary.filter(g => g.source.trim()).length}
                </span>
              )}
            </label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <label style={{
                cursor: 'pointer', padding: '2px 6px', fontSize: '0.65rem',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px',
              }}>
                <Upload size={10} /> Import
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={importGlossary} />
              </label>
              {translationConfig.glossary.length > 0 && (
                <button
                  onClick={exportGlossary}
                  style={{
                    padding: '2px 6px', fontSize: '0.65rem', cursor: 'pointer',
                    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-muted)', background: 'transparent',
                    display: 'flex', alignItems: 'center', gap: '3px',
                  }}
                >
                  <Download size={10} /> Export
                </button>
              )}
            </div>
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            {ui.tcGlossaryDesc}
          </div>

          {/* Pha 0: tự xây bảng tên riêng ngay khi bấm Start (1 lượt gọi AI) */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer', marginBottom: '8px' }}>
            <input
              type="checkbox"
              checked={translationConfig.autoNameGlossary}
              onChange={(e) => setTranslationConfig({ autoNameGlossary: e.target.checked })}
              style={{ marginTop: '2px' }}
            />
            <span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{ui.tcAutoGlossary}</span>
              <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {ui.tcAutoGlossaryHint}
              </span>
            </span>
          </label>

          {/* (User 2026) Kiểu tên riêng — Hán-Việt / Romaji-Quốc tế / Giữ nguyên. Tên phương Tây luôn khôi phục. */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{ui.tcNameStyle}</span>
              <select
                className="input"
                value={translationConfig.nameStyle}
                onChange={(e) => setTranslationConfig({ nameStyle: e.target.value as NameStyle })}
                style={{ flex: 1, fontSize: '0.75rem', padding: '5px 8px', cursor: 'pointer' }}
              >
                <option value="hanviet">{ui.tcNameStyleHanviet}</option>
                <option value="romaji">{ui.tcNameStyleRomaji}</option>
                <option value="keep">{ui.tcNameStyleKeep}</option>
              </select>
            </div>
            <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.45, marginTop: '4px' }}>
              {ui.tcNameStyleHint}
            </span>
          </div>

          {/* (User 2026) Thanh xoá hàng loạt — tick chọn nhiều dòng xoá 1 phát / xoá tất cả (có xác nhận) */}
          {translationConfig.glossary.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} title={ui.tcGlsSelectAllTip}>
                <input
                  type="checkbox"
                  checked={selectedGlossary.size > 0 && selectedGlossary.size === translationConfig.glossary.length}
                  onChange={(e) =>
                    setSelectedGlossary(e.target.checked ? new Set(translationConfig.glossary.map((_, i) => i)) : new Set())
                  }
                />
                {ui.tcGlsSelectAll}
              </label>
              <button
                onClick={removeSelectedGlossary}
                disabled={selectedGlossary.size === 0}
                title={ui.tcGlsDelSelectedTip}
                style={{
                  padding: '3px 10px', fontSize: '0.68rem', fontWeight: 600, borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(240,100,100,0.4)', background: 'transparent',
                  color: 'var(--accent-danger)', cursor: selectedGlossary.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedGlossary.size === 0 ? 0.5 : 1,
                }}
              >
                🗑 {fmt(ui.tcGlsDelSelected, { count: selectedGlossary.size })}
              </button>
              <button
                onClick={removeAllGlossary}
                title={ui.tcGlsDelAllTip}
                style={{
                  padding: '3px 10px', fontSize: '0.68rem', fontWeight: 600, borderRadius: 'var(--radius-sm)',
                  border: 'none', background: 'var(--accent-danger)', color: '#fff', cursor: 'pointer', marginLeft: 'auto',
                }}
              >
                {ui.tcGlsDelAll}
              </button>
            </div>
          )}

          {/* Glossary entries */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {translationConfig.glossary.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={selectedGlossary.has(idx)}
                  onChange={() => toggleGlossarySelected(idx)}
                  style={{ flexShrink: 0, cursor: 'pointer' }}
                  title={ui.tcGlsPickTip}
                />
                <input
                  className="input"
                  placeholder={ui.tcGlossarySrc}
                  value={entry.source}
                  onChange={(e) => updateGlossaryEntry(idx, 'source', e.target.value)}
                  style={{ flex: 1, fontSize: '0.78rem', padding: '4px 8px' }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>→</span>
                <input
                  className="input"
                  placeholder={ui.tcGlossaryTgt}
                  value={entry.target}
                  onChange={(e) => updateGlossaryEntry(idx, 'target', e.target.value)}
                  style={{ flex: 1, fontSize: '0.78rem', padding: '4px 8px' }}
                />
                <button
                  onClick={() => removeGlossaryEntry(idx)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--accent-danger)', padding: '4px', flexShrink: 0,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button
              onClick={addGlossaryEntry}
              style={{
                flex: 1, padding: '5px',
                border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                background: 'transparent', cursor: 'pointer',
                color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                transition: 'all 0.15s',
              }}
            >
              <Plus size={12} />
              {ui.tcAddTerm}
            </button>
            <button
              onClick={autoExtractGlossary}
              disabled={isAutoExtractingGlossary || !card}
              title={!card ? ui.tcNeedCard : ''}
              style={{
                flex: 1, padding: '5px',
                border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-primary)', cursor: (!card || isAutoExtractingGlossary) ? 'not-allowed' : 'pointer',
                color: 'white', fontSize: '0.7rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                transition: 'all 0.15s',
                opacity: (!card || isAutoExtractingGlossary) ? 0.6 : 1,
              }}
            >
              {isAutoExtractingGlossary ? (
                <><Loader2 size={12} className="spin" /> {ui.tcExtracting}</>
              ) : (
                <><Bot size={12} /> {ui.tcExtractTerms}</>
              )}
            </button>
          </div>
          {/* Bộ thuật ngữ có sẵn (tu tiên/võ hiệp) — nạp 1 nút, mục user đã có luôn thắng */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            {GLOSSARY_PRESETS.map((preset) => {
              const have = new Set(translationConfig.glossary.map(g => g.source.trim()));
              const remaining = preset.entries.filter(e => !have.has(e.source)).length;
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    const { merged, added } = mergeGlossary(translationConfig.glossary, preset.entries.map(e => ({ ...e, origin: 'preset' as const })));
                    setTranslationConfig({ glossary: merged });
                    addToast('success', fmt(ui.gpLoadedToast, { count: added }));
                  }}
                  disabled={remaining === 0}
                  title={ui.gpXianxiaHint}
                  style={{
                    flex: 1, padding: '5px',
                    border: '1px dashed rgba(56,189,248,0.5)', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(56,189,248,0.06)', cursor: remaining === 0 ? 'default' : 'pointer',
                    color: 'var(--accent-secondary)', fontSize: '0.7rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                    opacity: remaining === 0 ? 0.5 : 1,
                  }}
                >
                  📚 {ui[preset.nameKey]}{remaining === 0 ? ` ✓` : ` (${remaining})`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fields & mode only shown when a card is loaded */}
        {card && (
          <>
            {/* Field Groups — preset nhanh đã dời LÊN ĐẦU section (audit đợt 2) */}
            <div>
              <label className="label" style={{ marginBottom: '8px' }}>{t.fieldsToTranslate}</label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {translationConfig.fieldGroups.map((group: FieldGroupConfig) => {
                  const labels = groupLabels[group.id];
                  return (
                    <label key={group.id} className="checkbox-wrapper">
                      <input
                        type="checkbox"
                        checked={group.enabled}
                        onChange={() => toggleFieldGroup(group.id)}
                      />
                      <div>
                        <span style={{ color: 'var(--text-primary)' }}>{labels?.label || group.label}</span>
                        <span
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: '0.7rem',
                            marginLeft: '6px',
                          }}
                        >
                          {labels?.desc || group.description}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Lorebook Strategy — dời lên trên (audit đợt 2), thuộc tầng CƠ BẢN */}
            {!isModMode && translationConfig.fieldGroups.find((g: FieldGroupConfig) => g.id === 'lorebook')?.enabled && (
              <div>
                <label className="label" style={{ marginBottom: '6px' }}>{t.lorebookStrategy}</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <RadioOption
                    name="lore"
                    value="single"
                    checked={translationConfig.lorebookStrategy === 'single'}
                    onChange={() => setTranslationConfig({ lorebookStrategy: 'single' as LorebookStrategy })}
                    label={t.individualEntries}
                    desc={t.individualEntriesDesc}
                  />
                  <RadioOption
                    name="lore"
                    value="batch"
                    checked={translationConfig.lorebookStrategy === 'batch'}
                    onChange={() => setTranslationConfig({ lorebookStrategy: 'batch' as LorebookStrategy })}
                    label={t.batchEntries}
                    desc={t.batchEntriesDesc}
                  />
                </div>
                {translationConfig.lorebookStrategy === 'batch' && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {/* (User yêu cầu khôi phục) Toggle gộp nhiều entry / 1 lần gọi + field số entry/batch */}
                    <label className="checkbox-wrapper" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={translationConfig.lorebookManualBatch}
                        onChange={(e) => setTranslationConfig({ lorebookManualBatch: e.target.checked })}
                      />
                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{ui.tcManualBatch}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem', display: 'block', marginTop: '2px' }}>
                          {ui.tcManualBatchHint}
                        </span>
                      </div>
                    </label>

                    {translationConfig.lorebookManualBatch ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px' }}>
                        <label className="label" style={{ fontSize: '0.7rem' }}>{ui.tcEntriesPerBatch}</label>
                        <input
                          className="input"
                          type="number"
                          min={2}
                          max={50}
                          style={{ maxWidth: '140px' }}
                          value={translationConfig.lorebookBatchSize}
                          onChange={(e) => setTranslationConfig({ lorebookBatchSize: Math.max(2, Math.min(50, parseInt(e.target.value) || 5)) })}
                        />
                        {batchLoadEstimate && (
                          <div style={{
                            fontSize: '0.64rem', lineHeight: 1.5, marginTop: '2px', padding: '5px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${batchLoadEstimate.verdict === 'danger' ? 'rgba(255,90,90,0.4)' : batchLoadEstimate.verdict === 'warn' ? 'rgba(255,180,0,0.4)' : 'rgba(80,200,120,0.35)'}`,
                            background: batchLoadEstimate.verdict === 'danger' ? 'rgba(255,90,90,0.08)' : batchLoadEstimate.verdict === 'warn' ? 'rgba(255,180,0,0.07)' : 'rgba(80,200,120,0.06)',
                            color: 'var(--text-secondary)',
                          }}>
                            {batchLoadEstimate.verdict === 'danger' ? '⚠️ ' : batchLoadEstimate.verdict === 'warn' ? 'ℹ️ ' : '✅ '}
                            {fmt(ui.tcBatchTokenEst, {
                              size: translationConfig.lorebookBatchSize,
                              tokens: batchLoadEstimate.estOutputTokens.toLocaleString(),
                              pct: Math.round(batchLoadEstimate.ratio * 100),
                              limit: batchLoadEstimate.outputLimit.toLocaleString(),
                            })}
                            {batchLoadEstimate.verdict !== 'safe' && ' ' + fmt(ui.tcBatchTokenRec, { rec: batchLoadEstimate.recommendedBatchSize })}
                          </div>
                        )}
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{ui.tcManualBatchParallel}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        {ui.tcBatchHint1} <b>{ui.tcBatchHint2}</b> {ui.tcBatchHint3}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ═══ (Audit đợt 2) NÂNG CAO — gấp toàn bộ setting chuyên sâu lại. Preset đã tự lo
                các cờ quan trọng; người dùng thường không cần mở mục này. ═══ */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const nv = !showAdvanced;
                setShowAdvanced(nv);
                try { localStorage.setItem('st-tc-show-advanced', nv ? '1' : '0'); } catch { /* quota */ }
              }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.78rem' }}
            >
              ⚙️ {ui.tcAdvancedToggle} {showAdvanced ? '▾' : '▸'}
            </button>

            {showAdvanced && (<>
            {/* Model Routing */}
            <div style={{ marginTop: '16px', marginBottom: '16px' }}>
              <label className="checkbox-wrapper" style={{ marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={translationConfig.enableModelRouting}
                  onChange={(e) => setTranslationConfig({ enableModelRouting: e.target.checked })}
                />
                <div>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t.enableModelRouting || 'Enable Model Routing'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>
                    {t.modelRoutingDesc || 'Override global model for specific groups or entries.'}
                  </span>
                </div>
              </label>

              {translationConfig.enableModelRouting && (
                <div style={{ marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                  <datalist id="model-suggestions-list">
                    {modelSuggestions.map(s => <option key={s} value={s} />)}
                  </datalist>

                  {/* Group & Entry Routing */}
                  <div style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                    <label className="label" style={{ marginBottom: '12px', fontSize: '0.8rem', fontWeight: 600 }}>{t.groupModels || ui.tcGroupModels}</label>
                    {translationConfig.fieldGroups.map(group => {
                      const labels = groupLabels[group.id];
                      const groupFields = allAvailableFields.filter(f => f.group === group.id);
                      const isExpanded = !!expandedGroups[group.id];

                      return (
                        <div key={group.id} style={{ marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {groupFields.length > 0 ? (
                              <button
                                onClick={() => setExpandedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                                className="btn btn-ghost"
                                style={{ padding: '2px 4px', minHeight: 'auto', height: 'auto', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                                title={isExpanded ? ui.tcCollapseSub : ui.tcExpandSub}
                              >
                                <span style={{ 
                                  fontSize: '0.65rem', 
                                  transform: isExpanded ? 'rotate(90deg)' : 'none', 
                                  transition: 'transform 0.15s', 
                                  display: 'inline-block' 
                                }}>▶</span>
                              </button>
                            ) : (
                              <div style={{ width: '18px' }} />
                            )}
                            <span style={{ flex: '0 0 120px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {labels?.label || group.label}
                            </span>
                            <input
                              type="text"
                              list="model-suggestions-list"
                              placeholder={t.globalModel || 'Global Model'}
                              value={translationConfig.groupModelRouting[group.id] || ''}
                              onChange={(e) => setTranslationConfig({
                                groupModelRouting: { ...translationConfig.groupModelRouting, [group.id]: e.target.value }
                              })}
                              className="input"
                              style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem' }}
                            />
                          </div>

                          {/* Nested small fields */}
                          {isExpanded && groupFields.length > 0 && (
                            <div style={{ marginLeft: '22px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '1px dashed rgba(255,255,255,0.1)', paddingLeft: '12px' }}>
                              {groupFields.map(field => {
                                const lastKey = getFieldBaseKey(field.path);
                                const matchingFields = groupFields.filter(f => getFieldBaseKey(f.path) === lastKey && f.path !== field.path);
                                return (
                                  <div key={field.path} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span
                                      style={{ flex: '0 0 160px', fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      title={field.label}
                                    >
                                      {field.label}
                                    </span>
                                    <input
                                      type="text"
                                      list="model-suggestions-list"
                                      placeholder={translationConfig.groupModelRouting[group.id] || t.globalModel || 'Model chung'}
                                      value={translationConfig.entryModelRouting[field.path] || ''}
                                      onChange={(e) => setTranslationConfig({
                                        entryModelRouting: { ...translationConfig.entryModelRouting, [field.path]: e.target.value }
                                      })}
                                      className="input"
                                      style={{ flex: 1, padding: '3px 6px', fontSize: '0.7rem', height: '24px' }}
                                    />
                                    {matchingFields.length > 0 && (
                                      <button
                                        onClick={() => handleApplyToAllSimilar(translationConfig.entryModelRouting[field.path] || '', field.path, group.id)}
                                        className="btn btn-secondary tooltip"
                                        data-tooltip={fmt(ui.tcApplyAllTooltip, { key: lastKey })}
                                        style={{ padding: '3px 6px', height: '24px', minHeight: 'auto', display: 'flex', alignItems: 'center', borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                                      >
                                        <Zap size={10} />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Custom Schema — shared between modes */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="label" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {t.customSchema || 'Custom Format Schema'}
                  {schemaDirty && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 6px',
                      background: 'rgba(255,180,0,0.15)', borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent-warning)', fontWeight: 600,
                    }}>
                      {ui.tcUnsaved}
                    </span>
                  )}
                  {schemaSaved && !schemaDirty && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 6px',
                      background: 'rgba(80,200,120,0.15)', borderRadius: 'var(--radius-sm)',
                      color: '#50c878', fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: '3px',
                    }}>
                      <CheckCircle size={10} /> {ui.tcSaved}
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                    <FileJson size={12} />
                    {t.uploadJson || 'Upload JSON'}
                    <input
                      type="file"
                      accept=".json,.txt"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          try {
                            const content = evt.target?.result as string;
                            const parsed = JSON.parse(content);
                            setSchemaDraft(JSON.stringify(parsed, null, 2));
                          } catch {
                            setSchemaDraft(evt.target?.result as string || '');
                          }
                        };
                        reader.readAsText(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    onClick={saveSchema}
                    disabled={!schemaDirty}
                    style={{
                      padding: '2px 10px', fontSize: '0.7rem', fontWeight: 600,
                      border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-sm)',
                      background: schemaDirty ? 'var(--accent-primary)' : 'transparent',
                      color: schemaDirty ? 'white' : 'var(--text-muted)',
                      cursor: schemaDirty ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: '4px',
                      transition: 'all 0.15s',
                      opacity: schemaDirty ? 1 : 0.5,
                    }}
                  >
                    <Save size={11} /> {ui.tcSave}
                  </button>
                </div>
              </div>
              <textarea
                className="input"
                style={{
                  width: '100%', minHeight: '80px', fontFamily: 'monospace', fontSize: '0.8rem',
                  resize: 'vertical',
                  borderColor: schemaDirty ? 'var(--accent-warning)' : undefined,
                }}
                placeholder={translationConfig.enableMvuConversion
                  ? ui.tcSchemaMvuPh
                  : (t.customSchemaDesc || "Optional: Provide a JSON schema, MVU rules, or Zod format. The AI will strictly follow this structure.")}
                value={schemaDraft}
                onChange={(e) => setSchemaDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveSchema(); } }}
              />
            </div>

            {/* Custom System Prompt — available in both translate and mod mode */}
            <div>
              <label className="label" style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isModMode ? ui.tcPromptMod : ui.tcPromptCustom}
                  {promptDirty && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 6px',
                      background: 'rgba(255,180,0,0.15)', borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent-warning)', fontWeight: 600,
                    }}>
                      {ui.tcUnsaved}
                    </span>
                  )}
                  {promptSaved && !promptDirty && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 6px',
                      background: 'rgba(80,200,120,0.15)', borderRadius: 'var(--radius-sm)',
                      color: '#50c878', fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: '3px',
                      animation: 'fadeIn 0.2s',
                    }}>
                      <CheckCircle size={10} /> {ui.tcSaved}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {(translationConfig.translationPrompt || promptDirty) && (
                    <span 
                      style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                      onClick={resetPrompt}
                      title={ui.tcResetPromptTitle}
                    >
                      <RotateCcw size={10} /> Reset
                    </span>
                  )}
                  <button
                    onClick={savePrompt}
                    disabled={!promptDirty}
                    style={{
                      padding: '2px 10px', fontSize: '0.7rem', fontWeight: 600,
                      border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-sm)',
                      background: promptDirty ? 'var(--accent-primary)' : 'transparent',
                      color: promptDirty ? 'white' : 'var(--text-muted)',
                      cursor: promptDirty ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: '4px',
                      transition: 'all 0.15s',
                      opacity: promptDirty ? 1 : 0.5,
                    }}
                  >
                    <Save size={11} /> {ui.tcSave}
                  </button>
                </div>
              </label>
              <textarea
                className="input"
                style={{
                  width: '100%', minHeight: '120px', fontFamily: 'monospace', fontSize: '0.75rem',
                  resize: 'vertical', whiteSpace: 'pre-wrap',
                  borderColor: promptDirty ? 'var(--accent-warning)' : undefined,
                }}
                placeholder={ui.tcPromptPh}
                value={promptDraft || defaultPrompt}
                onChange={(e) => setPromptDraft(e.target.value === defaultPrompt ? '' : e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); savePrompt(); } }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                {ui.tcPromptDesc}
              </div>
            </div>

            {/* Chunk Size Control — only in translate mode */}
            {!isModMode && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="label" style={{ marginBottom: '6px' }}>
                {ui.tcChunkSize}
              </label>
              <input
                className="input"
                type="number"
                min={1000}
                max={2000000}
                step={1000}
                value={translationConfig.chunkSize || 0}
                onChange={(e) => setTranslationConfig({ chunkSize: parseInt(e.target.value) || 0 })}
                placeholder={ui.tcChunkSizePh}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                {ui.tcChunkSizeDesc}
              </div>

              {/* (Audit đợt 1) Đã GỠ ô "Số chunk song song" (parallelChunks): knob CHẾT — engine luôn
                  dùng computePoolConcurrency(pool) (tổng ngân sách RPM mọi provider), chỉnh gì cũng bị lờ. */}

              {/* AI Chunk Verification */}
              <div style={{ marginTop: '10px' }}>
                <label className="checkbox-wrapper">
                  <input
                    type="checkbox"
                    checked={translationConfig.enableChunkVerification || false}
                    onChange={(e) => setTranslationConfig({ enableChunkVerification: e.target.checked })}
                  />
                  <span>{ui.tcChunkVerify}</span>
                </label>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                  {ui.tcChunkVerifyDesc}
                </div>
              </div>
            </div>
            )}

            {/* ═══ Cross-field Context RAG — shared between modes ═══ */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={translationConfig.enableRAGContext}
                  onChange={(e) => setTranslationConfig({ enableRAGContext: e.target.checked })}
                />
                <div>
                  <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🧠 {ui.tcRag}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {ui.tcRagDesc}
                  </span>
                </div>
              </label>

              {translationConfig.enableRAGContext && (
                <div style={{ marginTop: '8px', marginLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label className="label" style={{ fontSize: '0.7rem' }}>
                        {ui.tcRagMaxFields}
                      </label>
                      <input
                        className="input"
                        type="number"
                        min={2}
                        max={25}
                        value={translationConfig.ragMaxFields}
                        onChange={(e) => setTranslationConfig({ ragMaxFields: Math.max(2, Math.min(25, parseInt(e.target.value) || 5)) })}
                        style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="label" style={{ fontSize: '0.7rem' }}>
                        {ui.tcRagMaxChars}
                      </label>
                      <input
                        className="input"
                        type="number"
                        min={500}
                        max={20000}
                        step={500}
                        value={translationConfig.ragMaxChars}
                        onChange={(e) => setTranslationConfig({ ragMaxChars: Math.max(500, Math.min(20000, parseInt(e.target.value) || 3000)) })}
                        style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                    {ui.tcRagBudget}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ Translation Memory — persistent cross-session ═══ */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={translationConfig.enableTranslationMemory}
                  onChange={(e) => setTranslationConfig({ enableTranslationMemory: e.target.checked })}
                />
                <div>
                  <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    💾 {ui.tcTm}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {ui.tcTmDesc}
                  </span>
                </div>
              </label>
            </div>

            {/* ═══ Surgical CJK Translation Mode — only in translate mode ═══ */}
            {!isModMode && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={translationConfig.surgicalMode}
                  onChange={(e) => setTranslationConfig({ surgicalMode: e.target.checked })}
                />
                <div>
                  <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    ✂️ {ui.tcSurgical}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {ui.tcSurgicalDesc}
                  </span>
                </div>
              </label>

            </div>
            )}

            {/* ═══ CSS CJK Protection — Xử lý ký tự Hán trong CSS ═══ */}
            {!isModMode && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="label" style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                🛡️ {ui.tcCssCjk}
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => setTranslationConfig({ cssCjkHandling: 'preserve' })}
                  style={{
                    flex: 1, padding: '6px 10px', fontSize: '0.72rem', fontWeight: 600,
                    border: translationConfig.cssCjkHandling === 'preserve' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    background: translationConfig.cssCjkHandling === 'preserve' ? 'rgba(124,106,240,0.12)' : 'transparent',
                    color: translationConfig.cssCjkHandling === 'preserve' ? 'var(--accent-primary)' : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {ui.tcCssPreserve}
                </button>
                <button
                  onClick={() => setTranslationConfig({ cssCjkHandling: 'translate' })}
                  style={{
                    flex: 1, padding: '6px 10px', fontSize: '0.72rem', fontWeight: 600,
                    border: translationConfig.cssCjkHandling === 'translate' ? '1px solid var(--accent-success, #10b981)' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    background: translationConfig.cssCjkHandling === 'translate' ? 'rgba(16,185,129,0.12)' : 'transparent',
                    color: translationConfig.cssCjkHandling === 'translate' ? 'var(--accent-success, #10b981)' : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {ui.tcCssTranslate}
                </button>
              </div>
              <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: '1.4' }}>
                {ui.tcCssCjkDesc}
              </div>
            </div>
            )}

            {/* ═══ Mod Mode settings are now at the top of the section ═══ */}

            {/* MVU Sync Panel (Chiến Lược B) */}
            <div style={{ marginTop: '8px' }}>
              <MvuSyncPanel />
            </div>

            {/* EJS Sync Panel (Chiến Lược C) — ngay dưới Strategy B */}
            <div style={{ marginTop: '8px' }}>
              <EjsSyncPanel />
            </div>
            </>)}{/* hết khối NÂNG CAO */}
          </>
        )}

        {/* ═══ Cache Management ═══ */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '4px' }}>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px', fontWeight: 600 }}>
            💾 {ui.tcCacheTitle}
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {card && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  if (confirm(ui.tcCacheResetConfirm)) {
                    await deleteCurrentCardCache();
                    addToast('success', ui.tcCacheResetOk);
                  }
                }}
                style={{ width: '100%', fontSize: '0.75rem', borderColor: 'var(--accent-warning)', color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              >
                <RotateCcw size={12} /> {ui.tcCacheResetBtn}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (confirm(ui.tcCacheAllConfirm)) {
                  await deleteAllCaches();
                  addToast('success', ui.tcCacheAllOk);
                }
              }}
              style={{ width: '100%', fontSize: '0.75rem', borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            >
              <Trash2 size={12} /> {ui.tcCacheAllBtn}
            </button>
          </div>
        </div>

        {/* ─── Settings Management ─── */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '4px' }}>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px', fontWeight: 600 }}>
            ⚙️ {ui.tcSettingsMgmt}
          </label>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (confirm(t.confirmResetTranslation)) {
                resetTranslationConfig();
                setPromptDraft('');
                setSchemaDraft('');
                setModInstructionsDraft('');
                addToast('success', t.translationConfigResetSuccess);
              }
            }}
            style={{ width: '100%', fontSize: '0.75rem', borderColor: 'var(--accent-warning)', color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
          >
            <RotateCcw size={12} /> {t.resetTranslationConfig}
          </button>
        </div>
      </div>
    </div>
  );
}

function RadioOption({
  name,
  value,
  checked,
  onChange,
  label,
  desc,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  desc: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        background: checked ? 'rgba(124, 106, 240, 0.08)' : 'transparent',
        border: checked ? '1px solid rgba(124, 106, 240, 0.2)' : '1px solid transparent',
        transition: 'all 0.15s',
        fontSize: '0.85rem',
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        style={{ accentColor: 'var(--accent-primary)' }}
      />
      <div>
        <span style={{ color: 'var(--text-primary)' }}>{label}</span>
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.7rem',
            marginLeft: '6px',
          }}
        >
          — {desc}
        </span>
      </div>
    </label>
  );
}
