import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { 
  extractPotentialMvuKeys, 
  aiTranslateMvuKeys, 
  extractZodDescriptions, 
  extractSchemaContextFromCard, 
  extractMappingFromTranslatedSchemas, 
  type MvuKeyInfo,
  enforceExactConsistency,
  validateDictionaryConflicts,
  aiResolveMvuConflicts
} from '../utils/mvuSync';
import { isMvuCard, getMvuZodSummary } from '../utils/mvuDetector';
import { 
  Settings, 
  Plus, 
  Trash2, 
  Wand2, 
  Info, 
  Loader2, 
  Bot, 
  Search, 
  Download, 
  Upload, 
  BarChart3, 
  Zap, 
  AlertTriangle,
  Undo2,
  CheckSquare,
  Square,
  RefreshCw,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

export default function MvuSyncPanel() {
  const { 
    card, 
    fields, 
    translationConfig, 
    setTranslationConfig, 
    locale, 
    proxy, 
    addToast,
    mvuKeyMetadata,
    setMvuKeyMetadata,
    mvuDictionaryHistory,
    pushDictionaryHistory
  } = useStore();
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [isResolvingConflicts, setIsResolvingConflicts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    field_name: false,
    enum_value: false,
    string_literal: false,
    unknown: false
  });
  
  const isVi = locale === 'vi';
  const { enableMvuSync, mvuDictionary } = translationConfig;

  if (!card) return null;

  // ─── MVU Card Detection Summary ───
  const mvuSummary = useMemo(() => getMvuZodSummary(card), [card]);

  const toggleSync = () => setTranslationConfig({ enableMvuSync: !enableMvuSync });

  const addEntry = () => {
    if (newKey.trim() && newValue.trim()) {
      const key = newKey.trim();
      const val = newValue.trim();
      
      pushDictionaryHistory(mvuDictionary);
      const nextDict = {
        ...mvuDictionary,
        [key]: val,
      };
      
      const nextMetadata = { ...mvuKeyMetadata };
      nextMetadata[key] = {
        sources: ['manual'],
        confidence: 'manual',
        occurrences: 1
      };
      
      setMvuKeyMetadata(nextMetadata);
      setTranslationConfig({ mvuDictionary: nextDict });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeEntry = (key: string) => {
    pushDictionaryHistory(mvuDictionary);
    const nextDict = { ...mvuDictionary };
    delete nextDict[key];
    const nextMetadata = { ...mvuKeyMetadata };
    delete nextMetadata[key];
    
    setMvuKeyMetadata(nextMetadata);
    setTranslationConfig({ mvuDictionary: nextDict });
    
    // Deselect if removed
    if (selectedKeys.has(key)) {
      const nextSelected = new Set(selectedKeys);
      nextSelected.delete(key);
      setSelectedKeys(nextSelected);
    }
  };

  const updateEntry = (key: string, value: string) => {
    pushDictionaryHistory(mvuDictionary);
    
    const nextDict = {
      ...mvuDictionary,
      [key]: value,
    };
    
    const nextMetadata = { ...mvuKeyMetadata };
    if (!nextMetadata[key]) {
      nextMetadata[key] = {
        sources: ['manual'],
        confidence: 'manual',
        occurrences: 1
      };
    } else {
      nextMetadata[key] = {
        ...nextMetadata[key],
        confidence: 'manual'
      };
    }
    
    setMvuKeyMetadata(nextMetadata);
    setTranslationConfig({ mvuDictionary: nextDict });
  };

  const autoExtract = () => {
    const keyInfos = extractPotentialMvuKeys(card);
    if (keyInfos.length === 0) {
      addToast('info', isVi ? 'Không tìm thấy key MVU nào.' : 'No MVU keys found.');
      return;
    }
    
    // Extract direct mappings from translated schemas if possible
    const schemaMappings = extractMappingFromTranslatedSchemas(card, fields);
    const schemaMappingKeys = Object.keys(schemaMappings);
    
    pushDictionaryHistory(mvuDictionary);
    const nextDict = { ...mvuDictionary, ...schemaMappings };
    const nextMetadata = { ...mvuKeyMetadata };
    let added = 0;
    
    // Schema mappings gets 'schema' confidence
    for (const k of schemaMappingKeys) {
      if (!(k in mvuDictionary)) {
        added++;
      }
      nextMetadata[k] = {
        sources: ['zod'],
        confidence: 'schema',
        occurrences: 1
      };
    }
    
    keyInfos.forEach(ki => {
      if (!(ki.key in nextDict)) {
        nextDict[ki.key] = '';
        added++;
      }
      if (!nextMetadata[ki.key]) {
        nextMetadata[ki.key] = {
          sources: ki.sources,
          keyType: ki.keyType,
          description: ki.description,
          occurrences: ki.occurrences,
          confidence: 'ai'
        };
      }
    });
    
    setMvuKeyMetadata(nextMetadata);
    setTranslationConfig({ mvuDictionary: nextDict });
    
    if (schemaMappingKeys.length > 0) {
      addToast('success', isVi 
        ? `Đã quét và tự động trích xuất ${schemaMappingKeys.length} biến từ Zod Schema đã dịch.` 
        : `Extracted ${schemaMappingKeys.length} variables from translated Zod Schema.`);
    } else if (added > 0) {
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

    // 1. Try to extract exact mappings from translated Zod schema first
    const schemaMappings = extractMappingFromTranslatedSchemas(card, fields);
    const schemaMappingKeys = Object.keys(schemaMappings);
    let currentDict = { ...mvuDictionary };
    let extractedCount = 0;
    
    const nextMetadata = { ...mvuKeyMetadata };
    if (schemaMappingKeys.length > 0) {
      pushDictionaryHistory(currentDict);
      for (const [k, v] of Object.entries(schemaMappings)) {
        if (v && v.trim() && k !== v && currentDict[k] !== v) {
          currentDict[k] = v;
          extractedCount++;
          nextMetadata[k] = {
            sources: ['zod'],
            confidence: 'schema',
            occurrences: 1
          };
        }
      }
      if (extractedCount > 0) {
        setMvuKeyMetadata(nextMetadata);
        setTranslationConfig({ mvuDictionary: currentDict });
      }
    }

    // 2. Filter keys that still need translation
    const keysNeedTranslation = keys.filter(k => !(k in currentDict) || !currentDict[k]);
    if (keysNeedTranslation.length === 0) {
      if (extractedCount > 0) {
        addToast('success', isVi
          ? `Đã đồng bộ ${extractedCount} biến từ Zod Schema đã dịch. Tất cả key khác đã có bản dịch.`
          : `Synced ${extractedCount} variables from translated Zod Schema. All other keys already translated.`
        );
      } else {
        addToast('info', isVi ? 'Tất cả key đều đã có bản dịch.' : 'All keys already have translations.');
      }
      return;
    }

    setIsAutoTranslating(true);
    try {
      let schemaContext = translationConfig.customSchema || '';
      if (!schemaContext.trim()) {
        schemaContext = extractSchemaContextFromCard(card);
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
        keyDescriptions,
        undefined,
        undefined,
        translationConfig.mvuTranslationPrompt,
      );

      pushDictionaryHistory(currentDict);
      const nextDict = { ...currentDict };
      let added = 0;
      for (const [k, v] of Object.entries(translations)) {
        if (v && v.trim() && k !== v) {
          nextDict[k] = v;
          added++;
          nextMetadata[k] = {
            ...nextMetadata[k],
            confidence: 'ai'
          };
        }
      }

      // Also add keys that AI couldn't translate (empty value for manual input)
      for (const k of keysNeedTranslation) {
        if (!(k in nextDict)) {
          nextDict[k] = '';
        }
      }

      setMvuKeyMetadata(nextMetadata);
      
      // Enforce exact consistency after AI translation
      const { fixedDict, fixes } = enforceExactConsistency(nextDict, nextMetadata);
      if (fixes.length > 0) {
        setTranslationConfig({ mvuDictionary: fixedDict });
        addToast('success', isVi 
          ? `Đã dịch ${added} biến và sửa ${fixes.length} biến thể.` 
          : `AI translated ${added} variables and fixed ${fixes.length} variants.`);
      } else {
        setTranslationConfig({ mvuDictionary: nextDict });
        addToast('success', isVi
          ? `AI đã dịch ${added}/${keysNeedTranslation.length} tên biến.`
          : `AI translated ${added}/${keysNeedTranslation.length} variable names.`
        );
      }
    } catch (err) {
      addToast('error', isVi
        ? `Lỗi AI: ${err instanceof Error ? err.message : String(err)}`
        : `AI Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsAutoTranslating(false);
    }
  };

  const handleResolveConflicts = async () => {
    if (conflicts.length === 0) return;
    setIsResolvingConflicts(true);
    try {
      let schemaContext = translationConfig.customSchema || '';
      if (!schemaContext.trim()) {
        schemaContext = extractSchemaContextFromCard(card);
      }
      let keyDescriptions: Record<string, string> = {};
      if (schemaContext) {
        keyDescriptions = extractZodDescriptions(schemaContext);
      }

      addToast('info', isVi ? 'Đang gọi AI giải quyết xung đột bản dịch...' : 'Calling AI to resolve translation conflicts...');

      const { fixedDict, fixedCount } = await aiResolveMvuConflicts(
        mvuDictionary,
        translationConfig.targetLanguage,
        proxy,
        undefined,
        schemaContext,
        keyDescriptions
      );

      if (fixedCount > 0) {
        pushDictionaryHistory(mvuDictionary);
        
        // Update metadata for fixed keys
        const nextMetadata = { ...mvuKeyMetadata };
        const conflictedKeys = Array.from(new Set(conflicts.flatMap(c => [c.key1, c.key2])));
        for (const k of conflictedKeys) {
          if (fixedDict[k] && fixedDict[k] !== mvuDictionary[k]) {
            nextMetadata[k] = {
              ...nextMetadata[k],
              confidence: 'ai'
            };
          }
        }
        
        setMvuKeyMetadata(nextMetadata);
        setTranslationConfig({ mvuDictionary: fixedDict });
        addToast('success', isVi
          ? `Đã giải quyết ${fixedCount} xung đột tên biến.`
          : `Resolved ${fixedCount} variable conflicts.`
        );
      } else {
        addToast('info', isVi
          ? 'Không tìm thấy thay đổi nào mới hoặc không thể tự động giải quyết.'
          : 'No changes found or could not resolve automatically.'
        );
      }
    } catch (err) {
      addToast('error', isVi
        ? `Lỗi giải quyết xung đột: ${err instanceof Error ? err.message : String(err)}`
        : `Conflict resolution error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsResolvingConflicts(false);
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
          pushDictionaryHistory(mvuDictionary);
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
  // Only scan the card when there are dictionary entries to badge. On a fresh import
  // the dictionary is empty, so running extractPotentialMvuKeys (which scans every
  // script/lorebook entry — 700ms+ on large cards) would be pure wasted work that
  // freezes the UI right after the card loads.
  const hasDictEntries = dictEntries.length > 0;
  const keyInfoMap = useMemo(() => {
    const map = new Map<string, MvuKeyInfo>();
    if (!hasDictEntries) return map;
    const infos = extractPotentialMvuKeys(card);
    for (const ki of infos) {
      map.set(ki.key, ki);
    }
    return map;
  }, [card, hasDictEntries]);

  // ─── Filtered entries ───
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return dictEntries;
    const q = searchQuery.toLowerCase();
    return dictEntries.filter(([k, v]) => 
      k.toLowerCase().includes(q) || v.toLowerCase().includes(q)
    );
  }, [dictEntries, searchQuery]);

  // ─── Grouped entries ───
  const groupedEntries = useMemo(() => {
    const groups: Record<string, [string, string][]> = {
      field_name: [],
      enum_value: [],
      string_literal: [],
      unknown: []
    };
    for (const [k, v] of filteredEntries) {
      const info = keyInfoMap.get(k);
      const kt = info?.keyType || mvuKeyMetadata[k]?.keyType || 'unknown';
      if (groups[kt]) {
        groups[kt].push([k, v]);
      } else {
        groups['unknown'].push([k, v]);
      }
    }
    return groups;
  }, [filteredEntries, keyInfoMap, mvuKeyMetadata]);

  // ─── Conflict validation ───
  const conflicts = useMemo(() => validateDictionaryConflicts(mvuDictionary), [mvuDictionary]);

  // ─── Source badge colors ───
  const sourceBadgeStyle = (source: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; color: string }> = {
      zod: { bg: 'rgba(99,102,241,0.08)', color: '#818cf8' },
      yaml: { bg: 'rgba(34,197,94,0.08)', color: '#4ade80' },
      macro: { bg: 'rgba(245,158,11,0.08)', color: '#fbbf24' },
      datavar: { bg: 'rgba(236,72,153,0.08)', color: '#f472b6' },
      enum: { bg: 'rgba(168,85,247,0.08)', color: '#c084fc' },
      bracket: { bg: 'rgba(14,165,233,0.08)', color: '#38bdf8' },
      comparison: { bg: 'rgba(251,146,60,0.08)', color: '#fb923c' },
      lodash: { bg: 'rgba(20,184,166,0.08)', color: '#2dd4bf' },
    };
    const c = colors[source] || { bg: 'rgba(148,163,184,0.08)', color: '#94a3b8' };
    return {
      padding: '0px 4px',
      borderRadius: '3px',
      fontSize: '0.52rem',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      background: c.bg,
      color: c.color,
      letterSpacing: '0.3px',
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
      padding: '0px 4px',
      borderRadius: '3px',
      fontSize: '0.52rem',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      background: c.bg,
      color: c.color,
      letterSpacing: '0.3px',
      border: `1px solid ${c.color}15`,
    };
  };
  const keyTypeLabel = (kt?: string) => {
    const labels: Record<string, string> = { field_name: 'FIELD', enum_value: 'ENUM', string_literal: 'STR' };
    return kt ? labels[kt] || '' : '';
  };

  // ─── Confidence Badge Styling ───
  const confidenceBadgeStyle = (conf?: string): React.CSSProperties | null => {
    if (!conf) return null;
    const colors: Record<string, { bg: string; color: string; label: string }> = {
      schema: { bg: 'rgba(34, 197, 94, 0.08)', color: '#22c55e', label: 'SCHEMA' },
      manual: { bg: 'rgba(14, 165, 233, 0.08)', color: '#0ea5e9', label: 'MANUAL' },
      ai: { bg: 'rgba(245, 158, 11, 0.08)', color: '#fbbf24', label: 'AI' },
      progressive: { bg: 'rgba(100, 116, 139, 0.08)', color: '#94a3b8', label: 'PROG' }
    };
    const c = colors[conf] || { bg: 'rgba(148,163,184,0.08)', color: '#94a3b8', label: 'UNKNOWN' };
    return {
      padding: '0px 4px',
      borderRadius: '3px',
      fontSize: '0.52rem',
      fontWeight: 700,
      background: c.bg,
      color: c.color,
      letterSpacing: '0.3px',
      border: `1px solid ${c.color}15`
    };
  };

  // ─── Group display metadata ───
  const groupMeta: Record<string, { vi: string; en: string; icon: string }> = {
    field_name: { vi: 'Tên trường (Fields)', en: 'Field Names', icon: '🏷️' },
    enum_value: { vi: 'Giá trị Enum (Enums)', en: 'Enum Values', icon: '🔢' },
    string_literal: { vi: 'Hằng chuỗi (Literals)', en: 'String Literals', icon: '📝' },
    unknown: { vi: 'Chưa phân loại (Unknown)', en: 'Unknown / Other', icon: '❓' }
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  // ─── Selection Helpers ───
  const toggleSelectKey = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedKeys(next);
  };

  const toggleSelectGroup = (keysInGroup: [string, string][]) => {
    const next = new Set(selectedKeys);
    const allSelected = keysInGroup.every(([k]) => next.has(k));
    for (const [k] of keysInGroup) {
      if (allSelected) {
        next.delete(k);
      } else {
        next.add(k);
      }
    }
    setSelectedKeys(next);
  };

  const handleBulkDelete = () => {
    if (selectedKeys.size === 0) return;
    pushDictionaryHistory(mvuDictionary);
    const nextDict = { ...mvuDictionary };
    const nextMetadata = { ...mvuKeyMetadata };
    for (const k of selectedKeys) {
      delete nextDict[k];
      delete nextMetadata[k];
    }
    setTranslationConfig({ mvuDictionary: nextDict });
    setMvuKeyMetadata(nextMetadata);
    addToast('success', isVi ? `Đã xóa ${selectedKeys.size} khóa.` : `Deleted ${selectedKeys.size} keys.`);
    setSelectedKeys(new Set());
  };

  const handleBulkReset = () => {
    if (selectedKeys.size === 0) return;
    pushDictionaryHistory(mvuDictionary);
    const nextDict = { ...mvuDictionary };
    const nextMetadata = { ...mvuKeyMetadata };
    for (const k of selectedKeys) {
      nextDict[k] = '';
      if (nextMetadata[k]) {
        nextMetadata[k] = { ...nextMetadata[k], confidence: 'manual' };
      }
    }
    setTranslationConfig({ mvuDictionary: nextDict });
    setMvuKeyMetadata(nextMetadata);
    addToast('success', isVi ? `Đã đặt lại ${selectedKeys.size} khóa.` : `Reset ${selectedKeys.size} keys.`);
    setSelectedKeys(new Set());
  };

  const handleUndo = () => {
    if (mvuDictionaryHistory.length === 0) return;
    const prev = mvuDictionaryHistory[mvuDictionaryHistory.length - 1];
    setTranslationConfig({ mvuDictionary: prev });
    useStore.setState({
      mvuDictionaryHistory: mvuDictionaryHistory.slice(0, -1)
    });
    addToast('success', isVi ? 'Đã hoàn tác thay đổi.' : 'Undid last change.');
  };

  const handleForceConsistency = () => {
    const { fixedDict, fixes } = enforceExactConsistency(mvuDictionary, mvuKeyMetadata);
    if (fixes.length > 0) {
      pushDictionaryHistory(mvuDictionary);
      setTranslationConfig({ mvuDictionary: fixedDict });
      addToast('success', isVi 
        ? `Đã sửa ${fixes.length} biến thể viết hoa/chính tả.` 
        : `Fixed ${fixes.length} case/spelling variants.`);
    } else {
      addToast('info', isVi ? 'Từ điển đã hoàn toàn nhất quán.' : 'Dictionary is fully consistent.');
    }
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

          {/* Conflict Warning Banner */}
          {conflicts.length > 0 && (
            <div style={{
              margin: '12px 0 8px',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.18)',
              fontSize: '0.72rem',
              color: '#f87171',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                <AlertTriangle size={14} />
                <span>
                  {isVi 
                    ? `Phát hiện ${conflicts.length} xung đột bản dịch (trùng tên dịch):` 
                    : `Detected ${conflicts.length} translation conflict(s) (same translation name):`}
                </span>
              </div>
              <div style={{ maxHeight: '90px', overflowY: 'auto', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {conflicts.map((c, idx) => (
                  <div key={idx} style={{ opacity: 0.9 }}>
                    <code>"{c.key1}"</code> & <code>"{c.key2}"</code> {isVi ? 'đều dịch thành' : 'both translate to'} <strong>"{c.sharedValue}"</strong>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-secondary"
                disabled={isResolvingConflicts || isAutoTranslating}
                onClick={(e) => {
                  e.stopPropagation();
                  handleResolveConflicts();
                }}
                style={{
                  marginTop: '8px',
                  padding: '4px 8px',
                  fontSize: '0.7rem',
                  alignSelf: 'flex-start',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
              >
                {isResolvingConflicts ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <Bot size={12} />
                )}
                {isVi ? 'Gọi AI dịch lại từ xung đột' : 'Call AI to re-translate conflicts'}
              </button>
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

          {/* MVU Scan Passes Control */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
            fontSize: '0.75rem',
          }}>
            <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {isVi ? '🔄 Số lần quét biến:' : '🔄 Scan passes:'}
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={translationConfig.mvuScanPasses || 1}
              onChange={(e) => setTranslationConfig({ mvuScanPasses: Math.max(1, Math.min(5, parseInt(e.target.value) || 1)) })}
              style={{
                width: '48px',
                padding: '3px 6px',
                fontSize: '0.75rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
              {isVi ? '(1-5, mỗi pass chỉ dịch biến mới)' : '(1-5, each pass translates new vars only)'}
            </span>
          </div>

          {/* ─── Custom Translation Prompt ─── */}
          <div style={{
            marginBottom: '12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-primary)',
            overflow: 'hidden',
          }}>
            <div
              style={{
                padding: '6px 10px',
                fontSize: '0.72rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'default',
              }}
            >
              📝 {isVi ? 'Custom Prompt (tuỳ chỉnh cách dịch biến)' : 'Custom Prompt (variable translation rules)'}
            </div>
            <textarea
              value={translationConfig.mvuTranslationPrompt || ''}
              onChange={(e) => setTranslationConfig({ mvuTranslationPrompt: e.target.value })}
              placeholder={isVi
                ? 'Ví dụ: Không dùng Hán Việt, dịch tên nhân vật sang tiếng Việt tự nhiên. Tên Nhật → Romaji...'
                : 'Example: Do not use Sino-Vietnamese. Translate character names naturally. Japanese names → Romaji...'}
              style={{
                width: '100%',
                minHeight: '52px',
                maxHeight: '120px',
                padding: '6px 10px',
                fontSize: '0.72rem',
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                resize: 'vertical',
                outline: 'none',
              }}
            />
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

          {/* Toolbar: Search + Stats + Undo + Exact Consistency + Import/Export */}
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

            {mvuDictionaryHistory.length > 0 && (
              <button
                onClick={handleUndo}
                title={isVi ? 'Hoàn tác' : 'Undo'}
                style={{
                  background: 'rgba(99,102,241,0.06)',
                  border: '1px solid rgba(99,102,241,0.18)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px', cursor: 'pointer', color: '#818cf8',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Undo2 size={14} />
              </button>
            )}

            <button
              onClick={handleForceConsistency}
              title={isVi ? 'Chuẩn hóa tính nhất quán 100%' : 'Force 100% exact consistency'}
              style={{
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.18)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', color: '#4ade80',
                display: 'flex', alignItems: 'center',
              }}
            >
              <RefreshCw size={14} />
            </button>

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

          {/* Bulk Actions Toolbar */}
          {selectedKeys.size > 0 && (
            <div style={{
              padding: '8px 12px',
              marginBottom: '10px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
            }}>
              <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                {isVi ? `Đang chọn ${selectedKeys.size} mục` : `Selected ${selectedKeys.size} items`}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={handleBulkReset} 
                  style={{
                    background: 'none', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)', padding: '3px 8px', cursor: 'pointer',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {isVi ? 'Đặt lại' : 'Reset'}
                </button>
                <button 
                  onClick={handleBulkDelete}
                  style={{
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: 'var(--radius-xs)', padding: '3px 8px', cursor: 'pointer',
                    color: '#f87171', display: 'flex', alignItems: 'center', gap: '3px'
                  }}
                >
                  <Trash2 size={12} />
                  {isVi ? 'Xóa' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          {/* Dictionary entries grouped by category */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '380px', overflowY: 'auto' }}>
            {Object.entries(groupedEntries).map(([groupName, entries]) => {
              if (entries.length === 0) return null;
              
              const meta = groupMeta[groupName] || groupMeta.unknown;
              const isCollapsed = collapsedGroups[groupName];
              const groupTitle = isVi ? meta.vi : meta.en;
              const allSelected = entries.every(([k]) => selectedKeys.has(k));
              const someSelected = entries.some(([k]) => selectedKeys.has(k)) && !allSelected;

              return (
                <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* Group Header */}
                  <div 
                    onClick={() => toggleGroup(groupName)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 6px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectGroup(entries);
                        }}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 2px'
                        }}
                      >
                        {allSelected ? (
                          <CheckSquare size={13} color="var(--accent-primary)" />
                        ) : someSelected ? (
                          <div style={{
                            width: '13px', height: '13px', border: '1px solid var(--accent-primary)',
                            borderRadius: '2px', background: 'var(--accent-primary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}>
                            <div style={{ width: '7px', height: '1px', background: 'white' }} />
                          </div>
                        ) : (
                          <Square size={13} />
                        )}
                      </button>
                      <span style={{ fontSize: '0.62rem', marginRight: '2px' }}>{meta.icon}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {groupTitle}
                      </span>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                        ({entries.length})
                      </span>
                    </div>
                    <div>
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </div>
                  </div>

                  {/* Group Content */}
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '8px', marginTop: '2px' }}>
                      {entries.map(([k, v]) => {
                        const keyInfo = keyInfoMap.get(k);
                        const isSelected = selectedKeys.has(k);
                        const confidence = mvuKeyMetadata[k]?.confidence;

                        return (
                          <div key={k} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                            <button
                              onClick={() => toggleSelectKey(k)}
                              style={{
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px'
                              }}
                            >
                              {isSelected ? <CheckSquare size={13} color="var(--accent-primary)" /> : <Square size={13} />}
                            </button>
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
                                {confidence && confidenceBadgeStyle(confidence) && (
                                  <span style={confidenceBadgeStyle(confidence)!}>{confidence}</span>
                                )}
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
                    </div>
                  )}
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
