import React, { useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from '../utils/cardFields';
import { getDefaultTranslationPrompt } from '../utils/apiClient';
import { aiExtractGlossaryTerms } from '../utils/mvuSync';
import type { TranslationMode, LorebookStrategy, FieldGroupConfig, FieldGroup, GlossaryEntry } from '../types/card';
import { Languages, Settings2, FileJson, BookOpen, Plus, Trash2, Download, Upload, Bot, Loader2 } from 'lucide-react';
import MvuSyncPanel from './MvuSyncPanel';

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

export default function TranslateConfig() {
  const { translationConfig, setTranslationConfig, toggleFieldGroup, card, locale, proxy, addToast } = useStore();
  const t = useT();
  const groupLabels = useGroupLabels();
  const [isAutoExtractingGlossary, setIsAutoExtractingGlossary] = useState(false);

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

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <Languages size={16} style={{ color: 'var(--accent-warning)' }} />
          {t.translationSettings}
        </span>
      </div>
      <div className="section-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Source & Target Languages */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label className="label">Source Language</label>
            <select
              className="input"
              value={translationConfig.sourceLanguage || 'auto'}
              onChange={(e) => setTranslationConfig({ sourceLanguage: e.target.value })}
            >
              {SOURCE_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="label">{t.targetLanguage}</label>
            <select
              className="input"
              value={translationConfig.targetLanguage}
              onChange={(e) => setTranslationConfig({ targetLanguage: e.target.value })}
            >
              {TARGET_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
              <option value="custom">Custom...</option>
            </select>
            {translationConfig.targetLanguage === 'custom' && (
              <input
                className="input"
                style={{ marginTop: '6px' }}
                placeholder="Enter target language..."
                onChange={(e) => setTranslationConfig({ targetLanguage: e.target.value || 'custom' })}
              />
            )}
          </div>
        </div>

        {/* Skip already translated */}
        <label className="checkbox-wrapper">
          <input
            type="checkbox"
            checked={translationConfig.skipAlreadyTranslated}
            onChange={(e) => setTranslationConfig({ skipAlreadyTranslated: e.target.checked })}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t.skipAlreadyTranslated}</span>
        </label>

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

            {/* Translation Mode */}
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

            {/* Lorebook Strategy */}
            {translationConfig.fieldGroups.find((g: FieldGroupConfig) => g.id === 'lorebook')?.enabled && (
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

            {/* Custom Schema */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="label" style={{ marginBottom: 0 }}>{t.customSchema || 'Custom Format Schema'}</label>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                  <FileJson size={14} />
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
                          setTranslationConfig({ customSchema: JSON.stringify(parsed, null, 2) });
                        } catch (err) {
                          setTranslationConfig({ customSchema: evt.target?.result as string });
                        }
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <textarea
                className="input"
                style={{ width: '100%', minHeight: '80px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                placeholder={t.customSchemaDesc || "Optional: Provide a JSON schema, MVU rules, or Zod format. The AI will strictly follow this structure."}
                value={translationConfig.customSchema || ''}
                onChange={(e) => setTranslationConfig({ customSchema: e.target.value })}
              />
            </div>

            {/* Custom Translation Prompt */}
            <div>
              <label className="label" style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                <span>Custom Translation Prompt</span>
                {translationConfig.translationPrompt && (
                  <span 
                    style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', cursor: 'pointer' }}
                    onClick={() => setTranslationConfig({ translationPrompt: '' })}
                  >
                    Reset to Default
                  </span>
                )}
              </label>
              <textarea
                className="input"
                style={{ width: '100%', minHeight: '120px', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', whiteSpace: 'pre-wrap' }}
                placeholder="Leave empty to use the default prompt..."
                value={translationConfig.translationPrompt || getDefaultTranslationPrompt(translationConfig.sourceLanguage, translationConfig.targetLanguage)}
                onChange={(e) => {
                  // Only save if it differs from default
                  const defaultPrompt = getDefaultTranslationPrompt(translationConfig.sourceLanguage, translationConfig.targetLanguage);
                  if (e.target.value === defaultPrompt) {
                    setTranslationConfig({ translationPrompt: '' });
                  } else {
                    setTranslationConfig({ translationPrompt: e.target.value });
                  }
                }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                You can fully customize the strict rules. The target language and source language info is already applied. Leave empty to use the built-in default.
              </div>
            </div>

            {/* Chunk Size Control */}
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
                placeholder={locale === 'vi' ? '0 = Tự động (Tối đa 40k)' : '0 = Auto (Max 40k)'}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                {locale === 'vi' 
                  ? 'Ghi đè giới hạn cắt đoạn mặc định. Đặt 0 để tự động tính dựa trên Max Tokens của proxy. Dùng cho Regex/MVU lớn để tránh cắt ngang cấu trúc code.' 
                  : 'Override default chunking threshold. Set to 0 to auto-calculate based on proxy Max Tokens. Use large chunks for Regex/MVU to prevent breaking code structure.'}
              </div>
            </div>

            {/* ═══ Cross-field Context RAG ═══ */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={translationConfig.enableRAGContext}
                  onChange={(e) => setTranslationConfig({ enableRAGContext: e.target.checked })}
                />
                <div>
                  <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🧠 {locale === 'vi' ? 'Cross-field Context RAG' : 'Cross-field Context RAG'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: '2px' }}>
                    {locale === 'vi'
                      ? 'Tự động kéo context từ các field đã dịch trong cùng card → AI dịch nhất quán thuật ngữ, tên, văn phong.'
                      : 'Automatically pull context from already-translated fields → AI maintains consistent terminology, names, and style.'}
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
                        max={15}
                        value={translationConfig.ragMaxFields}
                        onChange={(e) => setTranslationConfig({ ragMaxFields: Math.max(2, Math.min(15, parseInt(e.target.value) || 5)) })}
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
                        max={8000}
                        step={500}
                        value={translationConfig.ragMaxChars}
                        onChange={(e) => setTranslationConfig({ ragMaxChars: Math.max(500, Math.min(8000, parseInt(e.target.value) || 3000)) })}
                        style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                    {locale === 'vi'
                      ? '💡 Số field càng cao → AI có nhiều context hơn nhưng tốn thêm token. Mặc định 5 field / 3000 ký tự là cân bằng tốt.'
                      : '💡 More fields = more context for AI but costs more tokens. Default 5 fields / 3000 chars is a good balance.'}
                  </div>
                </div>
              )}
            </div>

            {/* MVU Sync Panel (Chiến Lược B) */}
            <div style={{ marginTop: '8px' }}>
              <MvuSyncPanel />
            </div>
          </>
        )}
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
