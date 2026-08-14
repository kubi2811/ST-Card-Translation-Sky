import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { useIdleMemo } from '../hooks/useIdleMemo';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { 
  extractPotentialMvuKeys, 
  aiTranslateMvuKeys, 
  extractZodDescriptions, 
  extractSchemaContextFromCard, 
  extractMappingFromTranslatedSchemas, 
  type MvuKeyInfo,
  enforceExactConsistency,
  validateDictionaryConflicts,
  aiResolveMvuConflicts,
  recanonicalizeMvuInCard,
  recanonicalizeMvuInFields,
  enforceVariableCasing
} from '../utils/mvuSync';
import { isMvuCard, getMvuZodSummary } from '../utils/mvuDetector';
import { getLockedBookName, setLockedBookName, enforceLorebookRefs } from '../utils/lorebookRefSync';
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
// (bug 223) Thu hồi blob URL SAU khi trình duyệt đọc xong — revoke ngay sau click làm hụt file.
import { revokeSoon } from '../utils/downloadFile';

// (bugNeedFix/5) Trần số DÒNG render mỗi nhóm từ điển. Dict MVU có thể vài nghìn biến; render hết
// thành DOM khiến mở tab Chiến lược B / import dict đơ 10-50s. Phần vượt trần vẫn nằm trong dict
// (dịch dùng đủ), user gõ ô tìm kiếm để lọc tới đúng biến cần sửa.
const GROUP_ROW_CAP = 150;

export default function MvuSyncPanel() {
  // (bugNeedFix/39) selector hẹp + throttle fields — trước đây subscribe toàn store nên panel này
  // (mount trong sidebar khi mở Nâng cao) re-render theo TỪNG set() trong burst dịch.
  const card = useStore((s) => s.card);
  const fields = useThrottledStore((s) => s.fields, 200);
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const locale = useStore((s) => s.locale);
  const proxy = useStore((s) => s.proxy);
  const addToast = useStore((s) => s.addToast);
  const mvuKeyMetadata = useStore((s) => s.mvuKeyMetadata);
  const setMvuKeyMetadata = useStore((s) => s.setMvuKeyMetadata);
  const mvuDictionaryHistory = useStore((s) => s.mvuDictionaryHistory);
  const pushDictionaryHistory = useStore((s) => s.pushDictionaryHistory);
  const updateCard = useStore((s) => s.updateCard);
  const setFields = useStore((s) => s.setFields);
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
  
  const ui = useUi();
  const { enableMvuSync, mvuDictionary } = translationConfig;

  if (!card) return null;

  // ─── MVU Card Detection Summary ───
  // (bugNeedFix/37) HOÃN quét MVU/Zod ra idle tick: getMvuZodSummary chạy ~8 regex + brace-scan trên
  // TOÀN BỘ 199 entry + 692KB tavern_helper + 200KB regex — chạy đồng bộ ngay khi import card lớn là
  // 1 thủ phạm chính làm "trang không phản hồi". Giá trị chờ = summary rỗng (an toàn cho UI).
  const mvuSummary = useIdleMemo(
    () => getMvuZodSummary(card),
    [card],
    { isMvu: false, variableCount: 0, initvarCount: 0, jsonPatchEntries: 0, hasZodSchema: false, confidence: 0 } as ReturnType<typeof getMvuZodSummary>,
  );

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
      addToast('info', ui.msNoKeys);
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
      addToast('success', fmt(ui.msExtractedZod, { count: schemaMappingKeys.length }));
    } else if (added > 0) {
      addToast('success', fmt(ui.msAddedKeys, { count: added }));
    } else {
      addToast('info', ui.msKeysExist);
    }
  };

  // Quét key + gọi AI dịch tự động
  const autoExtractAndTranslate = async () => {
    const keyInfos = extractPotentialMvuKeys(card);
    const keys = keyInfos.map(ki => ki.key);
    if (keys.length === 0) {
      addToast('info', ui.msNoKeys);
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
        addToast('success', fmt(ui.msSyncedZod, { count: extractedCount }));
      } else {
        addToast('info', ui.msAllTranslated);
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
        addToast('success', fmt(ui.msAiFixed, { added, fixes: fixes.length }));
      } else {
        setTranslationConfig({ mvuDictionary: nextDict });
        addToast('success', fmt(ui.msAiTranslated, { added, total: keysNeedTranslation.length }));
      }
    } catch (err) {
      addToast('error', fmt(ui.msAiErr, { msg: err instanceof Error ? err.message : String(err) }));
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

      addToast('info', ui.msResolving);

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
        addToast('success', fmt(ui.msResolved, { count: fixedCount }));
      } else {
        addToast('info', ui.msNoResolve);
      }
    } catch (err) {
      addToast('error', fmt(ui.msResolveErr, { msg: err instanceof Error ? err.message : String(err) }));
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
    revokeSoon(url);
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
          addToast('success', fmt(ui.msImported, { count: newCount }));
        }
      } catch {
        addToast('error', ui.msImportBad);
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
  const groupMeta: Record<string, { titleKey: 'msGroupFieldName' | 'msGroupEnum' | 'msGroupLiteral' | 'msGroupUnknown'; icon: string }> = {
    field_name: { titleKey: 'msGroupFieldName', icon: '🏷️' },
    enum_value: { titleKey: 'msGroupEnum', icon: '🔢' },
    string_literal: { titleKey: 'msGroupLiteral', icon: '📝' },
    unknown: { titleKey: 'msGroupUnknown', icon: '❓' }
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
    addToast('success', fmt(ui.msDeleted, { count: selectedKeys.size }));
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
    addToast('success', fmt(ui.msReset, { count: selectedKeys.size }));
    setSelectedKeys(new Set());
  };

  const handleUndo = () => {
    if (mvuDictionaryHistory.length === 0) return;
    const prev = mvuDictionaryHistory[mvuDictionaryHistory.length - 1];
    setTranslationConfig({ mvuDictionary: prev });
    useStore.setState({
      mvuDictionaryHistory: mvuDictionaryHistory.slice(0, -1)
    });
    addToast('success', ui.msUndone);
  };

  const handleForceConsistency = () => {
    const { fixedDict, fixes } = enforceExactConsistency(mvuDictionary, mvuKeyMetadata);
    if (fixes.length > 0) {
      pushDictionaryHistory(mvuDictionary);
      setTranslationConfig({ mvuDictionary: fixedDict });
      addToast('success', fmt(ui.msFixedVariants, { count: fixes.length }));
    } else {
      addToast('info', ui.msConsistent);
    }
  };

  // (User yêu cầu 2026) ĐỒNG NHẤT TÊN BIẾN MVU — non-AI, quét CẢ card (đã bake) LẪN field (phiên dịch):
  // làm sạch dict về "Họ Tên" (bỏ _/-) rồi enforce lại mọi field code/lorebook → 1 dạng thống nhất.
  const handleUnifyMvuNames = () => {
    if (!card) return;
    const dict = translationConfig.mvuDictionary;
    if (!dict || Object.keys(dict).length === 0) {
      addToast('info', ui.msUnifyNoDict);
      return;
    }
    // 1. Field của phiên dịch hiện tại (bản dịch nằm ở fields, chưa bake vào card)
    const fieldRes = recanonicalizeMvuInFields(fields, dict, mvuKeyMetadata);
    // 2. Card (bản đã bake / thẻ import dịch trước bản vá) — dùng dict đã làm sạch ở bước 1, và
    // (bug 232) CẢ các biến thể dịch lệch vừa học được từ fields: ruột thẻ đã mất bản gốc nên tự
    // nó không bao giờ suy ra được "Tiền bạc" chính là 钱财.
    const cardRes = recanonicalizeMvuInCard(card, fieldRes.dictionary, fieldRes.variantAliases);
    const cleanDict = cardRes.dictionary;
    // 3. (User 2026 — "biến không đồng nhất") ÉP HOA/THƯỜNG theo dict vào TEXT các field đã dịch:
    // recanonicalize chỉ lo _/-/space; còn "Tiến trình" vs "Tiến Trình" (Kiểm tra tổng báo mvu
    // inconsistent) do casing lệch dict — enforceVariableCasing vốn chỉ chạy LÚC dịch, giờ chạy cả
    // ở nút này để card đã dịch xong/import lại cũng gom về đúng 1 dạng.
    let casingFixes = 0;
    const casedFields = fieldRes.fields.map((f) => {
      if (f.status !== 'done' || !f.translated) return f;
      const r = enforceVariableCasing(f.translated, cleanDict);
      if (r.fixes.length > 0 && r.text !== f.translated) {
        casingFixes += r.fixes.length;
        return { ...f, translated: r.text };
      }
      return f;
    });
    // (bug 76) Đếm CẢ mục từ điển bị đổi. Trước đây chỉ đếm số chỗ thay trong text nên khi nút
    // chỉ sửa từ điển thì toast báo "chuẩn hoá 0 chỗ" — user thấy nút như không làm gì, rồi ngay
    // sau đó lại thấy cảnh báo xung đột, không hiểu chuyện gì xảy ra.
    let dictChangedCount = 0;
    for (const k of new Set([...Object.keys(dict), ...Object.keys(cleanDict)])) {
      if (dict[k] !== cleanDict[k]) dictChangedCount++;
    }
    const total = fieldRes.fixCount + cardRes.fixCount + casingFixes + dictChangedCount;
    if (total > 0) {
      pushDictionaryHistory(dict);
      setTranslationConfig({ mvuDictionary: cleanDict });
      if (fieldRes.fixCount > 0 || casingFixes > 0) setFields(casedFields);
      if (cardRes.fixCount > 0) updateCard(cardRes.card);
      addToast('success', fmt(ui.msUnifyDone, { count: total }));
    } else {
      addToast('info', ui.msConsistent);
    }

    // (bug 76) Xung đột CÓ SẴN (AI dịch 2 biến khác nhau ra cùng một tên) thì nút này KHÔNG tự
    // sửa được — nói thẳng cho user biết là nó có từ trước, không phải nút vừa gây ra, và chỉ
    // đường sang nút "gọi AI dịch lại" ngay phía trên.
    const conflicts = validateDictionaryConflicts(cleanDict);
    if (conflicts.length > 0) {
      addToast('error', fmt(ui.msUnifyConflictLeft, { count: conflicts.length }));
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
            {ui.msTitle}
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
                {fmt(ui.msDetected, { vars: mvuSummary.variableCount, initvar: mvuSummary.initvarCount, patch: mvuSummary.jsonPatchEntries || 0, zod: mvuSummary.hasZodSchema ? '✓' : '✗', conf: (mvuSummary.confidence * 100).toFixed(0) })}
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
                  {fmt(ui.msConflictHeader, { count: conflicts.length })}
                </span>
              </div>
              <div style={{ maxHeight: '90px', overflowY: 'auto', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {conflicts.map((c, idx) => (
                  <div key={idx} style={{ opacity: 0.9 }}>
                    <code>"{c.key1}"</code> & <code>"{c.key2}"</code> {ui.msBothTranslate} <strong>"{c.sharedValue}"</strong>
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
                {ui.msResolveBtn}
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
              {ui.msExplain}
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
              {ui.msPasses}
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
              {ui.msPassesHint}
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
              📝 {ui.msCustomPrompt}
            </div>
            <textarea
              value={translationConfig.mvuTranslationPrompt || ''}
              onChange={(e) => setTranslationConfig({ mvuTranslationPrompt: e.target.value })}
              placeholder={ui.msCustomPromptPh}
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
              {ui.msExtractKeys}
            </button>
            <button
              className="btn btn-primary"
              onClick={autoExtractAndTranslate}
              disabled={isAutoTranslating}
              style={{ flex: 1, padding: '6px', fontSize: '0.75rem', minWidth: '100px' }}
            >
              {isAutoTranslating
                ? <><Loader2 size={14} className="spin" /> {ui.msTranslating}</>
                : <><Bot size={14} /> {ui.msAiExtract}</>
              }
            </button>
          </div>

          {/* (User 2026) Nút ĐỒNG NHẤT TÊN BIẾN MVU — non-AI, quét cả card + field về 1 dạng "Họ Tên" */}
          <button
            className="btn btn-secondary"
            onClick={handleUnifyMvuNames}
            title={ui.msUnifyTip}
            style={{
              width: '100%', marginBottom: '12px', padding: '7px', fontSize: '0.75rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.22)', color: '#4ade80',
            }}
          >
            <RefreshCw size={14} />
            {ui.msUnifyNames}
          </button>

          {/* Toolbar: Search + Stats + Undo + Exact Consistency + Import/Export */}
          {/* (User 2026) flexWrap + search minWidth:0 + nút flexShrink:0 → nút Import KHÔNG bị tràn/đẩy khỏi khung. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px', alignItems: 'center' }}>
            <div style={{
              flex: 1, minWidth: '120px', display: 'flex', alignItems: 'center',
              background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)', padding: '0 8px',
            }}>
              <Search size={12} color="var(--text-muted)" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={ui.msSearchPh}
                style={{
                  flex: 1, padding: '5px 6px', fontSize: '0.72rem',
                  background: 'transparent', border: 'none', outline: 'none',
                }}
              />
            </div>

            {mvuDictionaryHistory.length > 0 && (
              <button
                onClick={handleUndo}
                title={ui.msUndo}
                style={{
                  background: 'rgba(99,102,241,0.06)',
                  border: '1px solid rgba(99,102,241,0.18)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px', cursor: 'pointer', flexShrink: 0, color: '#818cf8',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Undo2 size={14} />
              </button>
            )}

            <button
              onClick={handleForceConsistency}
              title={ui.msForceConsistency}
              style={{
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.18)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', flexShrink: 0, color: '#4ade80',
                display: 'flex', alignItems: 'center',
              }}
            >
              <RefreshCw size={14} />
            </button>

            <button
              onClick={() => setShowStats(!showStats)}
              title={ui.msStats}
              style={{
                background: showStats ? 'rgba(99,102,241,0.1)' : 'none',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', flexShrink: 0, color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <BarChart3 size={14} />
            </button>
            <button
              onClick={exportDict}
              title={ui.msExportDict}
              style={{
                background: 'none', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', flexShrink: 0, color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Download size={14} />
            </button>
            <button
              onClick={importDict}
              title={ui.msImportDict}
              style={{
                background: 'none', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px', cursor: 'pointer', flexShrink: 0, color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Upload size={14} />
            </button>
            {/* (User 2026) 🔒 Khoá từ điển — cấm pipeline dịch tự thêm/sửa/dọn biến; chỉ DÙNG dict user. */}
            <button
              onClick={() => {
                const next = !translationConfig.mvuDictLocked;
                setTranslationConfig({ mvuDictLocked: next });
                addToast('info', next ? ui.msDictLockedToast : ui.msDictUnlockedToast);
              }}
              title={ui.msDictLockTip}
              style={{
                background: translationConfig.mvuDictLocked ? 'rgba(245,158,11,0.15)' : 'none',
                border: translationConfig.mvuDictLocked ? '1px solid rgba(245,158,11,0.5)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px', cursor: 'pointer', flexShrink: 0,
                color: translationConfig.mvuDictLocked ? '#fbbf24' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '0.68rem', fontWeight: 700,
              }}
            >
              {translationConfig.mvuDictLocked ? '🔒' : '🔓'} {ui.msDictLock}
            </button>
          </div>

          {/* ── (bugNeedFix/110) 🔒 KHOÁ TÊN WORLDBOOK ────────────────────────────────
              User: bảng trạng thái tra lorebook BẰNG TÊN. Tên sách nằm ở hai chỗ — field
              `character_book.name` và chuỗi trong script (`const WI_FILE='…'`) — hai lượt gọi AI
              khác nhau dịch, lệch một chữ ("mùa hè của em" vs "mùa hạ của em") là script không
              tìm thấy sách, biến không lên bảng. Chốt một tên ở đây thì mọi nơi dùng đúng nó. */}
          <WorldbookNameLockBox />

          {/* (User 2026) Badge trạng thái khoá */}
          {translationConfig.mvuDictLocked && (
            <div style={{
              padding: '6px 10px', marginBottom: '8px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.3)',
              color: '#fbbf24', fontSize: '0.7rem',
            }}>
              🔒 {ui.msDictLockedBadge}
            </div>
          )}

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
                <div style={{ color: 'var(--text-muted)' }}>{ui.msTotal}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-success)' }}>{filledCount}</div>
                <div style={{ color: 'var(--text-muted)' }}>{ui.msTranslatedLabel}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: emptyCount > 0 ? 'var(--accent-warning)' : 'var(--text-muted)' }}>{emptyCount}</div>
                <div style={{ color: 'var(--text-muted)' }}>{ui.msPending}</div>
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
                {fmt(ui.msSelected, { count: selectedKeys.size })}
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
                  {ui.msResetBtn}
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
                  {ui.msDeleteBtn}
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
              const groupTitle = ui[meta.titleKey];
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

                  {/* Group Content — (bugNeedFix/5) CAP số dòng render/nhóm: dict lớn (import cả nghìn
                      biến) mà render HẾT thành DOM → treo 10-50s khi mở tab. Chỉ vẽ GROUP_ROW_CAP dòng
                      đầu; phần còn lại vẫn nằm trong dict (dịch dùng đủ), tìm qua ô search. */}
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '8px', marginTop: '2px' }}>
                      {entries.slice(0, GROUP_ROW_CAP).map(([k, v]) => {
                        const keyInfo = keyInfoMap.get(k);
                        const isSelected = selectedKeys.has(k);
                        const confidence = mvuKeyMetadata[k]?.confidence;

                        const hasMeta = !!(
                          (confidence && confidenceBadgeStyle(confidence)) ||
                          (keyInfo?.sources && keyInfo.sources.length > 0) ||
                          keyInfo?.description
                        );
                        return (
                          // (User 2026) Hàng biến: DÒNG TRÊN = gốc | → | đã dịch NẰM CẠNH NHAU, cả 2 ô
                          // đều flex:1 + minWidth:0 nên CO vừa khung — hết cuộn ngang kéo qua kéo lại.
                          // Badges (nguồn/độ tin/loại) + mô tả dồn xuống DÒNG DƯỚI (wrap), không giành ngang.
                          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                              <button
                                onClick={() => toggleSelectKey(k)}
                                style={{
                                  background: 'none', border: 'none', color: 'var(--text-muted)', flexShrink: 0,
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px'
                                }}
                              >
                                {isSelected ? <CheckSquare size={13} color="var(--accent-primary)" /> : <Square size={13} />}
                              </button>
                              <input
                                type="text"
                                value={k}
                                readOnly
                                title={keyInfo?.description || k}
                                style={{
                                  flex: 1, minWidth: 0, padding: '5px 7px', fontSize: '0.72rem',
                                  background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                                  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                                  fontFamily: 'var(--font-mono, monospace)',
                                }}
                              />
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>→</span>
                              <input
                                type="text"
                                value={v}
                                onChange={(e) => updateEntry(k, e.target.value)}
                                placeholder={ui.msTranslationPh}
                                style={{
                                  flex: 1, minWidth: 0, padding: '5px 7px', fontSize: '0.72rem',
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
                                style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                            {hasMeta && (
                              <div style={{
                                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px',
                                paddingLeft: '25px', fontSize: '0.6rem',
                              }}>
                                {keyInfo?.keyType && keyTypeBadgeStyle(keyInfo.keyType) && (
                                  <span style={keyTypeBadgeStyle(keyInfo.keyType)!}>{keyTypeLabel(keyInfo.keyType)}</span>
                                )}
                                {keyInfo?.sources?.map(s => (
                                  <span key={s} style={sourceBadgeStyle(s)}>{s}</span>
                                ))}
                                {confidence && confidenceBadgeStyle(confidence) && (
                                  <span style={confidenceBadgeStyle(confidence)!}>{confidence}</span>
                                )}
                                {keyInfo?.description && (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', opacity: 0.7 }}>
                                    {keyInfo.description}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {entries.length > GROUP_ROW_CAP && (
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 2px' }}>
                          {fmt(ui.msRowCapHint, { shown: GROUP_ROW_CAP, total: entries.length })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredEntries.length === 0 && dictEntries.length > 0 && (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {ui.msNoResults}
              </div>
            )}
          </div>

          {/* Add new entry */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', alignItems: 'center' }}>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={ui.msOriginalKeyPh}
              style={{
                flex: 1, minWidth: 0, padding: '6px 8px', fontSize: '0.75rem',
                background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)'
              }}
              onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={ui.msTranslatedPh}
              style={{
                flex: 1, minWidth: 0, padding: '6px 8px', fontSize: '0.75rem',
                background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)'
              }}
              onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            />
            <button
              onClick={addEntry}
              style={{
                background: 'var(--accent-primary)', color: 'white',
                border: 'none', borderRadius: 'var(--radius-sm)', flexShrink: 0,
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

/* ═══════════════════════════════════════════════════════════════════════════
   (bugNeedFix/110) KHOÁ TÊN WORLDBOOK
   ───────────────────────────────────────────────────────────────────────────
   Bảng trạng thái của nhiều thẻ tra lorebook BẰNG TÊN:
       const WI_FILE='{ Mùa hè của em }';   // phải khớp tên sách trong thẻ
   Nhưng tên sách nằm ở HAI chỗ: field `data.character_book.name` và chuỗi trong script. Hai chỗ
   đó do hai lượt gọi AI KHÁC NHAU dịch, nên ra "Mùa hè của em" và "Mùa hạ của em" là chuyện bình
   thường — và script lập tức không tra được sách, biến không hiện.

   Khoá ở đây chốt MỘT tên duy nhất: pipeline không dịch lại tên sách nữa, đồng thời mọi tham
   chiếu trong regex/script bị ép về đúng tên đã chốt. Cùng tinh thần với khoá từ điển MVU.
   ═══════════════════════════════════════════════════════════════════════════ */
function WorldbookNameLockBox() {
  const card = useStore((s) => s.card);
  const fields = useThrottledStore((s) => s.fields, 300);
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const updateField = useStore((s) => s.updateField);
  const addToast = useStore((s) => s.addToast);

  const nameField = useMemo(
    () => fields.find((f) => /(?:^|\.)character_book\.name$/.test(f.path)),
    [fields],
  );
  const original = (nameField?.original
    || (card?.data as { character_book?: { name?: string } } | undefined)?.character_book?.name
    || '').trim();

  const lock = translationConfig.worldbookNameLock || {};
  const lockedValue = getLockedBookName(lock, original);
  const [draft, setDraft] = useState('');

  // Ô nhập theo sau dữ liệu thật khi user chưa gõ gì.
  const suggested = lockedValue || (nameField?.translated || '').trim() || original;
  const value = draft || suggested;

  if (!original) return null;

  const doLock = () => {
    const v = value.trim();
    if (!v) { addToast('error', 'Chưa có tên để khoá.'); return; }
    setTranslationConfig({ worldbookNameLock: setLockedBookName(lock, original, v) });
    // Áp ngay vào field tên sách để bản dịch đang làm dở cũng khớp.
    if (nameField && nameField.translated !== v) {
      updateField(nameField.path, { translated: v, status: 'done' });
    }
    // Ép mọi tham chiếu trong code về đúng tên vừa chốt — đây mới là chỗ chữa bệnh.
    const dict = { book: { [original]: v }, entry: {} };
    let fixed = 0;
    for (const f of useStore.getState().fields) {
      if (typeof f.translated !== 'string' || !f.translated) continue;
      if (f.group !== 'regex' && f.group !== 'tavern_helper' && f.group !== 'lorebook') continue;
      const r = enforceLorebookRefs(f.translated, dict);
      if (r.fixes.length > 0 && r.text !== f.translated) {
        updateField(f.path, { translated: r.text });
        fixed += r.fixes.length;
      }
    }
    addToast('success', fixed > 0
      ? `🔒 Đã khoá tên worldbook "${v}" và sửa ${fixed} chỗ trỏ sai trong script/regex.`
      : `🔒 Đã khoá tên worldbook "${v}". Mọi lượt dịch sau sẽ dùng đúng tên này.`);
  };

  const doUnlock = () => {
    setTranslationConfig({ worldbookNameLock: setLockedBookName(lock, original, '') });
    addToast('info', 'Đã bỏ khoá tên worldbook — lượt dịch sau sẽ tự dịch lại tên sách.');
  };

  return (
    <div style={{
      padding: '8px 10px', marginBottom: '8px',
      borderRadius: 'var(--radius-sm)',
      background: lockedValue ? 'rgba(56,189,248,0.08)' : 'var(--bg-primary)',
      border: lockedValue ? '1px solid rgba(56,189,248,0.35)' : '1px solid var(--border-subtle)',
      fontSize: '0.7rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontWeight: 700, color: lockedValue ? '#38bdf8' : 'var(--text-secondary)' }}>
        {lockedValue ? '🔒' : '🔓'} Khoá tên worldbook
        <span
          title={'Bảng trạng thái tra lorebook BẰNG TÊN sách. Tên sách nằm ở hai nơi — thẻ và chuỗi trong script '
            + '(const WI_FILE=…) — do hai lượt AI khác nhau dịch nên hay lệch một chữ ("mùa hè của em" vs "mùa hạ của em"), '
            + 'khiến script không tra được sách và biến không hiện. Chốt một tên ở đây: pipeline thôi dịch lại tên sách, '
            + 'và mọi tham chiếu trong regex/script bị ép về đúng tên này.'}
          style={{ cursor: 'help', opacity: 0.6, fontWeight: 400 }}
        >ⓘ</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
        Tên gốc: <b style={{ color: 'var(--text-primary)' }}>{original}</b>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tên worldbook sau khi dịch…"
          style={{
            flex: 1, minWidth: 0, padding: '4px 8px', fontSize: '0.7rem',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
          }}
        />
        <button
          onClick={doLock}
          style={{
            padding: '4px 10px', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer',
            background: 'rgba(56,189,248,0.15)', color: '#38bdf8',
            border: '1px solid rgba(56,189,248,0.4)', borderRadius: 'var(--radius-sm)', flexShrink: 0,
          }}
        >
          {lockedValue ? 'Cập nhật khoá' : 'Khoá tên này'}
        </button>
        {lockedValue && (
          <button
            onClick={doUnlock}
            style={{
              padding: '4px 8px', fontSize: '0.68rem', cursor: 'pointer',
              background: 'none', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', flexShrink: 0,
            }}
          >
            Bỏ khoá
          </button>
        )}
      </div>
      {lockedValue && (
        <div style={{ marginTop: 5, color: '#38bdf8' }}>
          Đang khoá: <b>{lockedValue}</b> — lượt dịch sau không gọi AI cho tên sách nữa, và script/regex được ép khớp tên này.
        </div>
      )}
    </div>
  );
}
