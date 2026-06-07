import React, { useState, useMemo } from 'react';

import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { TARGET_LANGUAGES, SOURCE_LANGUAGES, extractTranslatableFields } from '../utils/cardFields';
import { getDefaultTranslationPrompt, getModelSuggestions } from '../utils/apiClient';
import { aiExtractGlossaryTerms } from '../utils/mvuSync';
import type { TranslationMode, LorebookStrategy, FieldGroupConfig, FieldGroup, GlossaryEntry } from '../types/card';
import { Languages, Settings2, FileJson, BookOpen, Plus, Trash2, Download, Upload, Bot, Loader2, Save, RotateCcw, CheckCircle, Zap } from 'lucide-react';
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
  const { translationConfig, setTranslationConfig, toggleFieldGroup, card, locale, proxy, addToast, fields, deleteCurrentCardCache, deleteAllCaches, scannedModels, resetTranslationConfig } = useStore();

  const allAvailableFields = useMemo(() => {
    if (!card) return [];
    const groups: FieldGroup[] = ['core', 'messages', 'system', 'creator', 'lorebook', 'lorebook_keys', 'regex', 'depth_prompt', 'tavern_helper'];
    return extractTranslatableFields(card, groups);
  }, [card]);

  const handleApplyToAllSimilar = (currentValue: string, fieldPath: string, groupId: string) => {
    const baseKey = getFieldBaseKey(fieldPath);
    const targetFields = allAvailableFields.filter(f => f.group === groupId && getFieldBaseKey(f.path) === baseKey);
    
    const newEntryRouting = { ...translationConfig.entryModelRouting };
    targetFields.forEach(f => {
      newEntryRouting[f.path] = currentValue;
    });
    
    setTranslationConfig({ entryModelRouting: newEntryRouting });
    addToast('success', locale === 'vi' 
      ? `Đã áp dụng model cho tất cả các trường ${baseKey}` 
      : `Applied model to all ${baseKey} fields`
    );
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
  };

  const exportGlossary = () => {
    const json = JSON.stringify(translationConfig.glossary.filter(g => g.source.trim() || g.target.trim()), null, 2);
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
          newEntries.push({ source: source.trim(), target: target.trim() });
          added++;
        }
      }
      
      if (added > 0) {
        setTranslationConfig({ glossary: [...translationConfig.glossary, ...newEntries] });
        addToast('success', locale === 'vi' 
          ? `AI đã trích xuất thành công ${added} thuật ngữ mới.` 
          : `AI successfully extracted ${added} new terms.`);
      } else {
        addToast('info', locale === 'vi' 
          ? 'Không tìm thấy thuật ngữ mới nào.' 
          : 'No new terms found.');
      }
    } catch (err) {
      addToast('error', locale === 'vi'
        ? `Lỗi AI: ${err instanceof Error ? err.message : String(err)}`
        : `AI Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAutoExtractingGlossary(false);
    }
  };
  const isModMode = translationConfig.enableModMode;

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <Languages size={16} style={{ color: isModMode ? '#9b59b6' : 'var(--accent-warning)' }} />
          {isModMode ? t.modPanel : t.translationSettings}
        </span>
      </div>
      <div className="section-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

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
                      {locale === 'vi' ? 'Chưa lưu' : 'Unsaved'}
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
                  {locale === 'vi' ? '⚠ Lưu yêu cầu trước khi áp dụng' : '⚠ Save instructions before applying'}
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
                    🧠 {locale === 'vi' ? 'Bật Chế Độ Thinking Cho Mod' : 'Enable Mod Thinking Mode'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', display: 'block', marginTop: '2px' }}>
                    {locale === 'vi' 
                      ? 'AI sẽ suy nghĩ logic 5 bước (Kiểm kê biến, dịch chuyển ngữ nghĩa, an toàn EJS...) để tránh hỏng card.' 
                      : 'AI will perform a 5-step logical reasoning (variable audit, semantic shift, EJS safety...) to avoid card break.'}
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
                {locale === 'vi' ? 'Bật Jailbreak (Phá màng lọc đạo đức, dùng cho card NSFW)' : 'Enable Jailbreak (Bypass safety filters for NSFW)'}
              </span>
            </label>

            {/* Objective Mode */}
            <label className="checkbox-wrapper" style={{ marginTop: '-4px' }}>
              <input type="checkbox" checked={translationConfig.enableObjectiveMode !== false} onChange={(e) => setTranslationConfig({ enableObjectiveMode: e.target.checked })} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                {locale === 'vi' ? 'Dịch Bạch Miêu (Sát nghĩa, không thêm thắt văn phong)' : 'Objective Mode (Literal translation, no embellishments)'}
              </span>
            </label>
          </>
        )}

        {/* ═══ Glossary / Terminology Database ═══ */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label className="label" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <BookOpen size={13} />
              {locale === 'vi' ? 'Bảng thuật ngữ' : 'Glossary'}
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
            {locale === 'vi'
              ? 'Thêm cặp thuật ngữ bắt buộc. AI sẽ dùng chính xác bản dịch này khi gặp từ gốc.'
              : 'Add mandatory term pairs. The AI will use these exact translations when it encounters the source term.'}
          </div>

          {/* Glossary entries */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {translationConfig.glossary.map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  className="input"
                  placeholder={locale === 'vi' ? 'Từ gốc' : 'Source term'}
                  value={entry.source}
                  onChange={(e) => updateGlossaryEntry(idx, 'source', e.target.value)}
                  style={{ flex: 1, fontSize: '0.78rem', padding: '4px 8px' }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>→</span>
                <input
                  className="input"
                  placeholder={locale === 'vi' ? 'Bản dịch' : 'Translation'}
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
              {locale === 'vi' ? 'Thêm thuật ngữ' : 'Add Term'}
            </button>
            <button
              onClick={autoExtractGlossary}
              disabled={isAutoExtractingGlossary || !card}
              title={!card ? (locale === 'vi' ? 'Cần tải thẻ nhân vật trước' : 'Load a card first') : ''}
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
                <><Loader2 size={12} className="spin" /> {locale === 'vi' ? 'Đang quét...' : 'Extracting...'}</>
              ) : (
                <><Bot size={12} /> {locale === 'vi' ? 'AI Quét Thuật Ngữ' : 'AI Extract Terms'}</>
              )}
            </button>
          </div>
        </div>

        {/* Fields & mode only shown when a card is loaded */}
        {card && (
          <>
            {/* Field Groups */}
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
                    <label className="label" style={{ marginBottom: '12px', fontSize: '0.8rem', fontWeight: 600 }}>{t.groupModels || 'Model theo nhóm'}</label>
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
                                title={isExpanded ? "Thu gọn mục nhỏ" : "Hiển thị mục nhỏ"}
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
                                        data-tooltip={locale === 'vi' ? `Áp dụng cho tất cả ${lastKey}` : `Apply to all ${lastKey}`}
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

            {/* Translation Mode — only in translate mode */}
            {!isModMode && (
            <div>
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                <Settings2 size={12} />
                {t.translationMode}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <RadioOption
                  name="mode"
                  value="field"
                  checked={translationConfig.mode === 'field'}
                  onChange={() => setTranslationConfig({ mode: 'field' as TranslationMode })}
                  label={t.fieldByField}
                  desc={t.fieldByFieldDesc}
                />
                <RadioOption
                  name="mode"
                  value="batch"
                  checked={translationConfig.mode === 'batch'}
                  onChange={() => setTranslationConfig({ mode: 'batch' as TranslationMode })}
                  label={t.batchMode}
                  desc={t.batchModeDesc}
                />
              </div>
            </div>
            )}

            {/* Lorebook Strategy — only in translate mode */}
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
                    label={`${t.batchEntries} (${translationConfig.lorebookBatchSize})`}
                    desc={t.batchEntriesDesc}
                  />
                </div>
                {translationConfig.lorebookStrategy === 'batch' && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <label className="label">{t.entriesPerBatch}</label>
                      <input
                        className="input"
                        type="number"
                        min={2}
                        max={50}
                        value={translationConfig.lorebookBatchSize}
                        onChange={(e) => setTranslationConfig({ lorebookBatchSize: parseInt(e.target.value) || 5 })}
                      />
                    </div>
                    <div>
                      <label className="label">{t.concurrentBatches}</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={10}
                        value={translationConfig.concurrentBatches}
                        onChange={(e) => setTranslationConfig({ concurrentBatches: parseInt(e.target.value) || 1 })}
                      />
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {t.concurrentBatchesHint}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

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
                      {locale === 'vi' ? 'Chưa lưu' : 'Unsaved'}
                    </span>
                  )}
                  {schemaSaved && !schemaDirty && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 6px',
                      background: 'rgba(80,200,120,0.15)', borderRadius: 'var(--radius-sm)',
                      color: '#50c878', fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: '3px',
                    }}>
                      <CheckCircle size={10} /> {locale === 'vi' ? 'Đã lưu!' : 'Saved!'}
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
                    <Save size={11} /> {locale === 'vi' ? 'Lưu' : 'Save'}
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
                  ? "Nếu bạn dán Zod Schema vào đây, hệ thống sẽ dùng luôn Schema này để biến thẻ thành MVU-Zod (Bỏ qua bước AI tự sinh)."
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
                  {isModMode ? (locale === 'vi' ? 'Prompt Hệ Thống Bổ Sung (Mod)' : 'Additional System Prompt (Mod)') : (locale === 'vi' ? 'Prompt Dịch Tuỳ Chỉnh' : 'Custom Translation Prompt')}
                  {promptDirty && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 6px',
                      background: 'rgba(255,180,0,0.15)', borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent-warning)', fontWeight: 600,
                    }}>
                      {locale === 'vi' ? 'Chưa lưu' : 'Unsaved'}
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
                      <CheckCircle size={10} /> {locale === 'vi' ? 'Đã lưu!' : 'Saved!'}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {(translationConfig.translationPrompt || promptDirty) && (
                    <span 
                      style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                      onClick={resetPrompt}
                      title={locale === 'vi' ? 'Khôi phục prompt mặc định' : 'Reset to default prompt'}
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
                    <Save size={11} /> {locale === 'vi' ? 'Lưu' : 'Save'}
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
                placeholder={locale === 'vi' ? 'Để trống để dùng prompt mặc định...' : 'Leave empty to use the default prompt...'}
                value={promptDraft || defaultPrompt}
                onChange={(e) => setPromptDraft(e.target.value === defaultPrompt ? '' : e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); savePrompt(); } }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                {locale === 'vi'
                  ? 'Tùy chỉnh prompt dịch. Nhấn Save (hoặc Ctrl+S) để áp dụng. Prompt được lưu tự động vào bộ nhớ trình duyệt.'
                  : 'Customize the translation prompt. Press Save (or Ctrl+S) to apply. The prompt is persisted in browser storage.'}
              </div>
            </div>

            {/* Chunk Size Control — only in translate mode */}
            {!isModMode && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="label" style={{ marginBottom: '6px' }}>
                {locale === 'vi' ? 'Kích thước chia nhỏ (Chunk Size)' : 'Chunk Size Limit'}
              </label>
              <input
                className="input"
                type="number"
                min={1000}
                max={2000000}
                step={1000}
                value={translationConfig.chunkSize || 0}
                onChange={(e) => setTranslationConfig({ chunkSize: parseInt(e.target.value) || 0 })}
                placeholder={locale === 'vi' ? '0 = Tự động (50k mỗi chunk)' : '0 = Auto (50k per chunk)'}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                {locale === 'vi' 
                  ? 'Ghi đè giới hạn cắt đoạn mặc định. Đặt 0 để tự động tính dựa trên Max Tokens của proxy. Dùng cho Regex/MVU lớn để tránh cắt ngang cấu trúc code.' 
                  : 'Override default chunking threshold. Set to 0 to auto-calculate based on proxy Max Tokens. Use large chunks for Regex/MVU to prevent breaking code structure.'}
              </div>

              {/* Parallel Chunks */}
              <div style={{ marginTop: '10px' }}>
                <label className="label" style={{ marginBottom: '6px' }}>
                  {locale === 'vi' ? '⚡ Dịch song song (Parallel Chunks)' : '⚡ Parallel Chunks'}
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={translationConfig.parallelChunks || 1}
                  onChange={(e) => setTranslationConfig({ parallelChunks: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                  {locale === 'vi' 
                    ? '1 = tuần tự (mặc định, tốt cho văn bản cần nhất quán). 2-5 = dịch nhiều chunk cùng lúc, nhanh gấp bội cho card Regex lớn. ⚠️ Mỗi chunk chạy song song sẽ không có context từ chunk trước.' 
                    : '1 = sequential (default, best for narrative consistency). 2-5 = translate multiple chunks simultaneously, much faster for large Regex cards. ⚠️ Parallel chunks lack context from previous chunks.'}
                </div>
              </div>

              {/* AI Chunk Verification */}
              <div style={{ marginTop: '10px' }}>
                <label className="checkbox-wrapper">
                  <input
                    type="checkbox"
                    checked={translationConfig.enableChunkVerification || false}
                    onChange={(e) => setTranslationConfig({ enableChunkVerification: e.target.checked })}
                  />
                  <span>{locale === 'vi' ? '🔍 AI xác minh chunk (so sánh gốc ↔ dịch)' : '🔍 AI Chunk Verification (compare original ↔ translated)'}</span>
                </label>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                  {locale === 'vi' 
                    ? 'Sau mỗi chunk dịch xong, AI sẽ so sánh bản gốc với bản dịch để phát hiện: code bị hỏng (backticks, brackets), nội dung bị thiếu/cắt, và cấu trúc bị sai lệch. Tự động sửa lỗi nếu phát hiện. ⚠️ Tốn thêm 1 API call/chunk.' 
                    : 'After each chunk is translated, AI verifies structural integrity by comparing original vs translated: detects broken code (backticks, brackets), missing content, and structural corruption. Auto-repairs if issues found. ⚠️ Costs 1 extra API call per chunk.'}
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
                    🧠 {locale === 'vi' ? 'Cross-field Context RAG v2 (TF-IDF)' : 'Cross-field Context RAG v2 (TF-IDF)'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {locale === 'vi'
                      ? 'TF-IDF + Tiered Retrieval: kéo context thông minh từ field đã dịch, ưu tiên cấu trúc (schema/biến MVU), fuzzy glossary matching.'
                      : 'TF-IDF + Tiered Retrieval: smart context from translated fields, structural priority (schema/MVU vars), fuzzy glossary matching.'}
                  </span>
                </div>
              </label>

              {translationConfig.enableRAGContext && (
                <div style={{ marginTop: '8px', marginLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label className="label" style={{ fontSize: '0.7rem' }}>
                        {locale === 'vi' ? 'Số field context tối đa' : 'Max context fields'}
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
                        {locale === 'vi' ? 'Max ký tự context' : 'Max context chars'}
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
                    {locale === 'vi'
                      ? '💡 Budget tự động theo loại field (narrative: 3K, code: 6-8K). Đặt giá trị ở đây để ghi đè auto. 0 = tự động. Gemini 2.5 Pro: 1M tokens → 20K chars ≈ 2% budget.'
                      : '💡 Budget auto-scales by field type (narrative: 3K, code: 6-8K). Set a value here to override auto. 0 = auto. Gemini 2.5 Pro: 1M tokens → 20K chars ≈ 2% budget.'}
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
                    💾 {locale === 'vi' ? 'Translation Memory (Cross-session)' : 'Translation Memory (Cross-session)'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {locale === 'vi'
                      ? 'Lưu bản dịch vào bộ nhớ vĩnh viễn. Khi dịch card mới, AI sẽ tham khảo bản dịch cũ tương tự để nhất quán. Tự động xóa sạch khi load card mới.'
                      : 'Persist translations to permanent memory. When translating new cards, AI references similar past translations for consistency. Auto-clears on card load.'}
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
                    ✂️ {locale === 'vi' ? 'Surgical CJK Translation' : 'Surgical CJK Translation'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {locale === 'vi'
                      ? 'Dịch an toàn cho các field có chứa code (EJS/Regex). Chỉ bóc tách chữ CJK để dịch, giữ nguyên 100% cấu trúc code.'
                      : 'Safe translation for code-heavy fields (EJS/Regex). Extracts only CJK strings for translation, preserving 100% of code structure.'}
                  </span>
                </div>
              </label>
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
          </>
        )}

        {/* ═══ Cache Management ═══ */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '4px' }}>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px', fontWeight: 600 }}>
            💾 {locale === 'vi' ? 'Quản lý Cache Dịch' : 'Translation Cache'}
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {card && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  if (confirm(locale === 'vi' ? 'Bạn có chắc chắn muốn đặt lại thẻ này và xóa cache dịch của nó không? Hành động này không thể hoàn tác.' : 'Are you sure you want to reset this card and delete its translation cache? This cannot be undone.')) {
                    await deleteCurrentCardCache();
                    addToast('success', locale === 'vi' ? 'Đã xóa thành công cache dịch của thẻ này' : 'Translation cache cleared successfully');
                  }
                }}
                style={{ width: '100%', fontSize: '0.75rem', borderColor: 'var(--accent-warning)', color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              >
                <RotateCcw size={12} /> {locale === 'vi' ? 'Đặt lại thẻ & Xóa cache thẻ này' : 'Reset card & Clear this cache'}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (confirm(locale === 'vi' ? 'Bạn có chắc chắn muốn xóa toàn bộ cache dịch của tất cả các thẻ không? Hành động này không thể hoàn tác.' : 'Are you sure you want to delete all translation caches for all cards? This cannot be undone.')) {
                  await deleteAllCaches();
                  addToast('success', locale === 'vi' ? 'Đã xóa thành công toàn bộ cache dịch' : 'All translation caches cleared successfully');
                }
              }}
              style={{ width: '100%', fontSize: '0.75rem', borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            >
              <Trash2 size={12} /> {locale === 'vi' ? 'Xóa toàn bộ cache dịch' : 'Clear all translation caches'}
            </button>
          </div>
        </div>

        {/* ─── Settings Management ─── */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '4px' }}>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px', fontWeight: 600 }}>
            ⚙️ {locale === 'vi' ? 'Quản lý Cài đặt' : 'Settings Management'}
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
