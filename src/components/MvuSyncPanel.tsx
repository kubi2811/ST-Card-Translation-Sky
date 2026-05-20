import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { extractPotentialMvuKeys, aiTranslateMvuKeys, extractZodDescriptions, type MvuKeyInfo } from '../utils/mvuSync';
import { isMvuCard, getMvuZodSummary } from '../utils/mvuDetector';
import { Settings, Plus, Trash2, Wand2, Info, Loader2, Bot, Search, Download, Upload, BarChart3, Zap, AlertTriangle } from 'lucide-react';

export default function MvuSyncPanel() {
  const { card, translationConfig, setTranslationConfig, locale, proxy, addToast } = useStore();
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStats, setShowStats] = useState(false);
  const isVi = locale === 'vi';

  const { enableMvuSync, mvuDictionary } = translationConfig;

  if (!card) return null;

  // ─── MVU Card Detection Summary ───
  const mvuSummary = useMemo(() => getMvuZodSummary(card), [card]);

  const toggleSync = () => setTranslationConfig({ enableMvuSync: !enableMvuSync });

  const addEntry = () => {
    if (newKey.trim() && newValue.trim()) {
      setTranslationConfig({
        mvuDictionary: {
          ...mvuDictionary,
          [newKey.trim()]: newValue.trim(),
        },
      });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeEntry = (key: string) => {
    const nextDict = { ...mvuDictionary };
    delete nextDict[key];
    setTranslationConfig({ mvuDictionary: nextDict });
  };

  const updateEntry = (key: string, value: string) => {
    setTranslationConfig({
      mvuDictionary: {
        ...mvuDictionary,
        [key]: value,
      },
    });
  };

  const autoExtract = () => {
    const keyInfos = extractPotentialMvuKeys(card);
    if (keyInfos.length === 0) {
      addToast('info', isVi ? 'Không tìm thấy key MVU nào.' : 'No MVU keys found.');
      return;
    }
    const nextDict = { ...mvuDictionary };
    let added = 0;
    keyInfos.forEach(ki => {
      if (!(ki.key in nextDict)) {
        nextDict[ki.key] = '';
        added++;
      }
    });
    
    if (added > 0) {
      setTranslationConfig({ mvuDictionary: nextDict });
      addToast('success', isVi ? `Đã thêm ${added} key mới.` : `Added ${added} new keys.`);
    } else {
      addToast('info', isVi ? 'Các key đều đã có sẵn.' : 'Keys already exist.');
    }
  };

  // Quét key + gọi AI dịch tự động
  const autoExtractAndTranslate = async () => {
    const keyInfos = extractPotentialMvuKeys(card);
    const keys = keyInfos.map(ki => ki.key);
    if (keys.length === 0) {
      addToast('info', isVi ? 'Không tìm thấy key MVU nào.' : 'No MVU keys found.');
      return;
    }

    // Lọc keys chưa có hoặc chưa có bản dịch
    const keysNeedTranslation = keys.filter(k => !(k in mvuDictionary) || !mvuDictionary[k]);
    if (keysNeedTranslation.length === 0) {
      addToast('info', isVi ? 'Tất cả key đều đã có bản dịch.' : 'All keys already have translations.');
      return;
    }

    setIsAutoTranslating(true);
    try {
      let schemaContext = translationConfig.customSchema || '';
      if (!schemaContext.trim() && card?.data?.extensions?.tavern_helper) {
        const th = card.data.extensions.tavern_helper as any;
        let scripts: any[] = [];
        if (Array.isArray(th)) {
          for (const item of th) {
            if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
              scripts.push(...item[1]);
            } else if (item && typeof item === 'object' && !Array.isArray(item) && item.content) {
              scripts.push(item);
            }
          }
        } else if (th?.scripts && Array.isArray(th.scripts)) {
          scripts = th.scripts;
        }
        schemaContext = scripts.map((s: any) => s.content || '').join('\n\n');
      }

      // Extract Zod descriptions for richer context
      let keyDescriptions: Record<string, string> = {};
      if (schemaContext) {
        keyDescriptions = extractZodDescriptions(schemaContext);
      }

      const translations = await aiTranslateMvuKeys(
        keysNeedTranslation,
        translationConfig.targetLanguage,
        proxy,
        undefined,
        schemaContext,
        keyDescriptions
      );

      const nextDict = { ...mvuDictionary };
      let added = 0;
      for (const [k, v] of Object.entries(translations)) {
        if (v && v.trim() && k !== v) {
          nextDict[k] = v;
          added++;
        }
      }

      // Also add keys that AI couldn't translate (empty value for manual input)
      for (const k of keysNeedTranslation) {
        if (!(k in nextDict)) {
          nextDict[k] = '';
        }
      }

      setTranslationConfig({ mvuDictionary: nextDict });
      addToast('success', isVi
        ? `AI đã dịch ${added}/${keysNeedTranslation.length} tên biến.`
        : `AI translated ${added}/${keysNeedTranslation.length} variable names.`
      );
    } catch (err) {
      addToast('error', isVi
        ? `Lỗi AI: ${err instanceof Error ? err.message : String(err)}`
        : `AI Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsAutoTranslating(false);
    }
  };

  // ─── Import/Export Dictionary ───
  const exportDict = () => {
    const json = JSON.stringify(mvuDictionary, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mvu_dictionary.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDict = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (typeof imported === 'object' && imported !== null) {
          const merged = { ...mvuDictionary, ...imported };
          setTranslationConfig({ mvuDictionary: merged });
          const newCount = Object.keys(imported).length;
          addToast('success', isVi ? `Đã nhập ${newCount} key.` : `Imported ${newCount} keys.`);
        }
      } catch {
        addToast('error', isVi ? 'File JSON không hợp lệ.' : 'Invalid JSON file.');
      }
    };
    input.click();
  };

  const dictEntries = Object.entries(mvuDictionary);
  const filledCount = dictEntries.filter(([, v]) => v.trim()).length;
  const emptyCount = dictEntries.length - filledCount;

  // ─── Enriched key info for source badges ───
  const keyInfoMap = useMemo(() => {
    const infos = extractPotentialMvuKeys(card);
    const map = new Map<string, MvuKeyInfo>();
    for (const ki of infos) {
      map.set(ki.key, ki);
    }
    return map;
  }, [card]);

  // ─── Filtered entries ───
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return dictEntries;
    const q = searchQuery.toLowerCase();
    return dictEntries.filter(([k, v]) => 
      k.toLowerCase().includes(q) || v.toLowerCase().includes(q)
    );
  }, [dictEntries, searchQuery]);

  // ─── Source badge colors ───
  const sourceBadgeStyle = (source: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; color: string }> = {
      zod: { bg: 'rgba(99,102,241,0.1)', color: '#818cf8' },
      yaml: { bg: 'rgba(34,197,94,0.1)', color: '#4ade80' },
      macro: { bg: 'rgba(245,158,11,0.1)', color: '#fbbf24' },
      datavar: { bg: 'rgba(236,72,153,0.1)', color: '#f472b6' },
      enum: { bg: 'rgba(168,85,247,0.1)', color: '#c084fc' },
      bracket: { bg: 'rgba(14,165,233,0.1)', color: '#38bdf8' },
      comparison: { bg: 'rgba(251,146,60,0.1)', color: '#fb923c' },
      lodash: { bg: 'rgba(20,184,166,0.1)', color: '#2dd4bf' },
    };
    const c = colors[source] || { bg: 'rgba(148,163,184,0.1)', color: '#94a3b8' };
    return {
      padding: '0 4px',
      borderRadius: '3px',
      fontSize: '0.55rem',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      background: c.bg,
      color: c.color,
      letterSpacing: '0.5px',
    };
  };

  const keyTypeBadgeStyle = (kt?: string): React.CSSProperties | null => {
    if (!kt) return null;
    const colors: Record<string, { bg: string; color: string; label: string }> = {
      field_name: { bg: 'rgba(34,197,94,0.08)', color: '#22c55e', label: 'FIELD' },
      enum_value: { bg: 'rgba(168,85,247,0.08)', color: '#a855f7', label: 'ENUM' },
      string_literal: { bg: 'rgba(251,146,60,0.08)', color: '#f97316', label: 'STR' },
    };
    const c = colors[kt];
    if (!c) return null;
    return {
      padding: '0 4px',
      borderRadius: '3px',
      fontSize: '0.5rem',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      background: c.bg,
      color: c.color,
      letterSpacing: '0.5px',
      border: `1px solid ${c.color}20`,
    };
  };
  const keyTypeLabel = (kt?: string) => {
    const labels: Record<string, string> = { field_name: 'FIELD', enum_value: 'ENUM', string_literal: 'STR' };
    return kt ? labels[kt] || '' : '';
  };

  return (
    <div style={{
      marginBottom: '16px',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-secondary)',
      overflow: 'hidden'
    }}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          background: isExpanded ? 'rgba(0,0,0,0.02)' : 'transparent',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Settings size={16} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
            {isVi ? 'Chiến Lược B (Đồng bộ Biến MVU/Zod)' : 'Strategy B (Sync MVU Variables)'}
          </span>
          {dictEntries.length > 0 && (
            <span style={{
              padding: '1px 6px', borderRadius: '8px', fontSize: '0.6rem', fontWeight: 700,
              background: filledCount === dictEntries.length ? 'rgba(106,240,138,0.1)' : 'rgba(240,196,106,0.1)',
              color: filledCount === dictEntries.length ? 'var(--accent-success)' : 'var(--accent-warning)',
            }}>
              {filledCount}/{dictEntries.length}
            </span>
          )}
          {mvuSummary.isMvu && !enableMvuSync && (
            <span style={{
              padding: '1px 6px', borderRadius: '8px', fontSize: '0.55rem', fontWeight: 700,
              background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
              display: 'flex', alignItems: 'center', gap: '3px',
            }}>
              <AlertTriangle size={10} /> MVU
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
            <input 
              type="checkbox" 
              checked={enableMvuSync} 
              onChange={toggleSync} 
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 16px 16px 16px', borderTop: '1px solid var(--border-subtle)' }}>
          {/* MVU Detection Banner */}
          {mvuSummary.isMvu && (
            <div style={{
              margin: '12px 0 8px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.15)',
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <Zap size={14} color="#818cf8" style={{ flexShrink: 0 }} />
              <span>
                {isVi 
                  ? `Phát hiện: ${mvuSummary.variableCount} biến, ${mvuSummary.initvarCount} initvar, Patch: ${mvuSummary.jsonPatchEntries || 0}, Zod: ${mvuSummary.hasZodSchema ? '✓' : '✗'}, Conf: ${(mvuSummary.confidence * 100).toFixed(0)}%`
                  : `Detected: ${mvuSummary.variableCount} vars, ${mvuSummary.initvarCount} initvar, Patch: ${mvuSummary.jsonPatchEntries || 0}, Zod: ${mvuSummary.hasZodSchema ? '✓' : '✗'}, Conf: ${(mvuSummary.confidence * 100).toFixed(0)}%`}
              </span>
            </div>
          )}

          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginTop: '12px',
            marginBottom: '16px',
            display: 'flex',
            gap: '6px',
            alignItems: 'flex-start'
          }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              {isVi 
                ? 'Đổi tên biến hệ thống để thẻ MVU vẫn hoạt động sau khi dịch. Bật ON → khi dịch, AI sẽ TỰ ĐỘNG quét key và dịch tên biến.' 
                : 'Rename system variables to keep MVU cards functional after translation. ON → AI will AUTO-DETECT keys and translate variable names during translation.'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={autoExtract} style={{ flex: 1, padding: '6px', fontSize: '0.75rem', minWidth: '100px' }}>
              <Wand2 size={14} />
              {isVi ? 'Quét Key' : 'Extract Keys'}
            </button>
            <button
              className="btn btn-primary"
              onClick={autoExtractAndTranslate}
              disabled={isAutoTranslating}
              style={{ flex: 1, padding: '6px', fontSize: '0.75rem', minWidth: '100px' }}
            >
              {isAutoTranslating
                ? <><Loader2 size={14} className="spin" /> {isVi ? 'Đang dịch...' : 'Translating...'}</>
                : <><Bot size={14} /> {isVi ? 'AI Quét + Dịch Key' : 'AI Extract + Translate'}</>
              }
            </button>
          </div>

          {/* Toolbar: Search + Stats + Import/Export */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', alignItems: 'center' }}>
            <div style={{ 
              flex: 1, display: 'flex', alignItems: 'center', 
              background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)', padding: '0 8px',
            }}>
              <Search size={12} color="var(--text-muted)" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={isVi ? 'Tìm kiếm biến...' : 'Search variables...'}
                style={{
                  flex: 1, padding: '5px 6px', fontSize: '0.72rem',
                  background: 'transparent', border: 'none', outline: 'none',
                }}
              />
            </div>
            <button
              onClick={() => setShowStats(!showStats)}
              title={isVi ? 'Thống kê' : 'Statistics'}
              style={{
                background: showStats ? 'rgba(99,102,241,0.1)' : 'none',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <BarChart3 size={14} />
            </button>
            <button
              onClick={exportDict}
              title={isVi ? 'Xuất từ điển' : 'Export dictionary'}
              style={{
                background: 'none', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Download size={14} />
            </button>
            <button
              onClick={importDict}
              title={isVi ? 'Nhập từ điển' : 'Import dictionary'}
              style={{
                background: 'none', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Upload size={14} />
            </button>
          </div>

          {/* Stats Panel */}
          {showStats && (
            <div style={{
              padding: '10px 12px',
              marginBottom: '10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.72rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{dictEntries.length}</div>
                <div style={{ color: 'var(--text-muted)' }}>{isVi ? 'Tổng' : 'Total'}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-success)' }}>{filledCount}</div>
                <div style={{ color: 'var(--text-muted)' }}>{isVi ? 'Đã dịch' : 'Translated'}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: emptyCount > 0 ? 'var(--accent-warning)' : 'var(--text-muted)' }}>{emptyCount}</div>
                <div style={{ color: 'var(--text-muted)' }}>{isVi ? 'Chưa dịch' : 'Pending'}</div>
              </div>
            </div>
          )}

          {/* Dictionary entries */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto' }}>
            {filteredEntries.map(([k, v]) => {
              const keyInfo = keyInfoMap.get(k);
              return (
                <div key={k} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="text"
                        value={k}
                        readOnly
                        title={keyInfo?.description || k}
                        style={{
                          flex: 1, padding: '5px 7px', fontSize: '0.72rem',
                          background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono, monospace)',
                        }}
                      />
                      {keyInfo?.sources && keyInfo.sources.length > 0 && (
                        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                          {keyInfo.keyType && keyTypeBadgeStyle(keyInfo.keyType) && (
                            <span style={keyTypeBadgeStyle(keyInfo.keyType)!}>{keyTypeLabel(keyInfo.keyType)}</span>
                          )}
                          {keyInfo.sources.map(s => (
                            <span key={s} style={sourceBadgeStyle(s)}>{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {keyInfo?.description && (
                      <div style={{ 
                        fontSize: '0.6rem', color: 'var(--text-muted)', paddingLeft: '7px',
                        fontStyle: 'italic', opacity: 0.7,
                      }}>
                        {keyInfo.description}
                      </div>
                    )}
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>→</span>
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => updateEntry(k, e.target.value)}
                    placeholder={isVi ? 'Bản dịch (VD: Độ Hảo Cảm)' : 'Translation'}
                    style={{
                      flex: 1, padding: '5px 7px', fontSize: '0.72rem',
                      background: v ? 'var(--bg-primary)' : 'rgba(240,196,106,0.06)',
                      border: `1px solid ${v ? 'var(--border-subtle)' : 'rgba(240,196,106,0.3)'}`,
                      borderRadius: 'var(--radius-sm)',
                      outline: 'none',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                    autoFocus={v === ''}
                  />
                  <button
                    onClick={() => removeEntry(k)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', padding: '4px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
            {filteredEntries.length === 0 && dictEntries.length > 0 && (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {isVi ? 'Không tìm thấy kết quả' : 'No results found'}
              </div>
            )}
          </div>

          {/* Add new entry */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', alignItems: 'center' }}>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={isVi ? 'Key gốc' : 'Original Key'}
              style={{
                flex: 1, padding: '6px 8px', fontSize: '0.75rem',
                background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)'
              }}
              onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={isVi ? 'Dịch' : 'Translated'}
              style={{
                flex: 1, padding: '6px 8px', fontSize: '0.75rem',
                background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)'
              }}
              onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            />
            <button
              onClick={addEntry}
              style={{
                background: 'var(--accent-primary)', color: 'white',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              disabled={!newKey.trim() || !newValue.trim()}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
