import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { detectEjsCard, extractEjsEntryNames, extractEjsKeywords, extractAllDecorators, aiTranslateEjsEntries, enforceEjsDictConsistency, autoFixEjsEntryNames, autoFixEjsKeywords, enforceEjsCovariance, enforceEjsKeywordCasing, autoFixEjsKeywordsExtended, detectEjsConflicts, aiResolveEjsConflicts } from '../utils/ejsSync';
import { Settings, Plus, Trash2, Wand2, Loader2, Search, Download, Upload, Shield, Zap, Hash, BookOpen, Eye } from 'lucide-react';

export default function EjsSyncPanel() {
  // (bugNeedFix/39) selector hẹp + throttle fields — trước đây subscribe toàn store lúc dịch.
  const card = useStore((s) => s.card);
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const proxy = useStore((s) => s.proxy);
  const addToast = useStore((s) => s.addToast);
  const fields = useThrottledStore((s) => s.fields, 200);
  const updateField = useStore((s) => s.updateField);
  const addLog = useStore((s) => s.addLog);
  const saveTranslationCache = useStore((s) => s.saveTranslationCache);
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [activeTab, setActiveTab] = useState<'entries' | 'keywords' | 'decorators'>('entries');
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [isResolvingConflicts, setIsResolvingConflicts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const ui = useUi();

  const { enableEjsSync, ejsDecoratorPreserve } = translationConfig;
  const ejsEntryNameDict = translationConfig.ejsEntryNameDict || {};
  const ejsKeywordDict = translationConfig.ejsKeywordDict || {};

  if (!card) return null;

  // ─── EJS Detection Summary (only scan when enabled to avoid crashes) ───
  const ejsDetection = useMemo(() => {
    if (!enableEjsSync) return { isEjs: false, confidence: 0, ejsBlockCount: 0, entryWithEjsCount: 0, hasGetwi: false, hasActivewi: false, hasDefine: false, hasGetChatMessages: false, hasExecute: false, hasDecorators: false, reasons: [] };
    try { return detectEjsCard(card); } catch { return { isEjs: false, confidence: 0, ejsBlockCount: 0, entryWithEjsCount: 0, hasGetwi: false, hasActivewi: false, hasDefine: false, hasGetChatMessages: false, hasExecute: false, hasDecorators: false, reasons: [] }; }
  }, [card, enableEjsSync]);
  const ejsEntryRefs = useMemo(() => {
    if (!enableEjsSync) return [];
    try { return extractEjsEntryNames(card); } catch { return []; }
  }, [card, enableEjsSync]);
  const ejsKeywords = useMemo(() => {
    if (!enableEjsSync) return [];
    try { return extractEjsKeywords(card); } catch { return []; }
  }, [card, enableEjsSync]);
  const ejsDecorators = useMemo(() => {
    if (!enableEjsSync) return [];
    try { return extractAllDecorators(card); } catch { return []; }
  }, [card, enableEjsSync]);

  const toggleSync = () => setTranslationConfig({ enableEjsSync: !enableEjsSync });

  // ─── Entry Name Dict CRUD ───
  const addEntryName = () => {
    if (newKey.trim() && newValue.trim()) {
      setTranslationConfig({
        ejsEntryNameDict: { ...ejsEntryNameDict, [newKey.trim()]: newValue.trim() },
      });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeEntryName = (key: string) => {
    const next = { ...ejsEntryNameDict };
    delete next[key];
    setTranslationConfig({ ejsEntryNameDict: next });
  };

  const updateEntryName = (key: string, value: string) => {
    setTranslationConfig({ ejsEntryNameDict: { ...ejsEntryNameDict, [key]: value } });
  };

  // ─── Keyword Dict CRUD ───
  const addKeyword = () => {
    if (newKey.trim() && newValue.trim()) {
      setTranslationConfig({
        ejsKeywordDict: { ...ejsKeywordDict, [newKey.trim()]: newValue.trim() },
      });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeKeyword = (key: string) => {
    const next = { ...ejsKeywordDict };
    delete next[key];
    setTranslationConfig({ ejsKeywordDict: next });
  };

  const updateKeyword = (key: string, value: string) => {
    setTranslationConfig({ ejsKeywordDict: { ...ejsKeywordDict, [key]: value } });
  };

  // ─── (User 2026) ÁP từ điển vào bản dịch (non-AI) ───
  // Sau khi user EDIT dict trong panel: quét mọi field đã dịch, chạy lại đủ 5 pass ép dict
  // (entry name, keyword trong khối, covariance, casing, keyword ngoài khối) → bản dịch đồng
  // nhất theo dict MỚI mà không tốn call AI. Dùng cả cho card cũ import lại (câu hỏi #4 user).
  const applyDictToTranslation = () => {
    const kwDict = ejsKeywordDict;
    const enDict = ejsEntryNameDict;
    if (Object.keys(kwDict).length === 0 && Object.keys(enDict).length === 0) {
      addToast('info', ui.esApplyNoDict);
      return;
    }
    let changedFields = 0;
    let totalFixes = 0;
    for (const f of fields) {
      if (f.status !== 'done' || !f.translated) continue;
      let text = f.translated;
      let fixes = 0;
      if (Object.keys(enDict).length > 0) {
        const r1 = autoFixEjsEntryNames(text, enDict);
        text = r1.text; fixes += r1.fixes.length;
      }
      if (Object.keys(kwDict).length > 0) {
        const r2 = autoFixEjsKeywords(text, kwDict);
        text = r2.text; fixes += r2.fixes.length;
      }
      const r3 = enforceEjsCovariance(text, enDict, kwDict);
      text = r3.text; fixes += r3.fixes.length;
      const r4 = enforceEjsKeywordCasing(text, enDict, kwDict);
      text = r4.text; fixes += r4.fixes.length;
      if (Object.keys(kwDict).length > 0) {
        const r5 = autoFixEjsKeywordsExtended(text, kwDict);
        text = r5.text; fixes += r5.fixes.length;
      }
      if (text !== f.translated) {
        updateField(f.path, { translated: text });
        changedFields++;
        totalFixes += Math.max(fixes, 1);
        addLog('info', `📥 EJS dict → "${f.label}": ${fixes} chỗ`);
      }
    }
    if (changedFields > 0) {
      saveTranslationCache();
      addToast('success', fmt(ui.esApplyDone, { fields: changedFields, fixes: totalFixes }));
    } else {
      addToast('info', ui.esApplyNone);
    }
  };

  // ─── Auto Extract + AI Translate ───
  const autoExtractAndTranslate = async () => {
    setIsAutoTranslating(true);
    try {
      const newEntryNames = ejsEntryRefs.map(r => r.name).filter(n => !(n in ejsEntryNameDict));
      const newKws = ejsKeywords.map(k => k.keyword).filter(k => !(k in ejsKeywordDict));

      if (newEntryNames.length === 0 && newKws.length === 0) {
        addToast('info', ui.esAllMapped);
        return;
      }

      // Build EJS context
      const ejsContext = (card.data?.character_book?.entries || [])
        .filter((e: any) => e.content && /<%[\s\S]*?%>/.test(e.content))
        .map((e: any) => e.content)
        .join('\n\n')
        .slice(0, 3000);

      const { entryTranslations, keywordTranslations } = await aiTranslateEjsEntries(
        newEntryNames,
        newKws,
        translationConfig.targetLanguage,
        proxy,
        undefined,
        ejsContext,
        translationConfig.ejsTranslationPrompt,
      );

      let mergedEntries = { ...ejsEntryNameDict, ...entryTranslations };
      let mergedKws = { ...ejsKeywordDict, ...keywordTranslations };

      const addedE = Object.keys(entryTranslations).length;
      const addedK = Object.keys(keywordTranslations).length;

      // (User 2026) TỰ ĐỘNG bắt "khác từ nhưng dịch ra cùng nghĩa" (vd 父女 & 父子 → "Cha con")
      // ngay sau khi dịch — port cơ chế dedup của Chiến lược B: gọi AI dịch lại đúng các key đụng độ.
      let dedupNote = '';
      const preConflicts = [...detectEjsConflicts(mergedEntries), ...detectEjsConflicts(mergedKws)];
      if (preConflicts.length > 0) {
        const res = await aiResolveEjsConflicts(
          mergedEntries, mergedKws, translationConfig.targetLanguage, proxy,
          undefined, ejsContext, translationConfig.ejsTranslationPrompt,
        );
        mergedEntries = res.fixedEntryDict;
        mergedKws = res.fixedKeywordDict;
        if (res.fixedCount > 0) dedupNote = ' · ' + fmt(ui.esDedupFixed, { count: res.fixedCount });
      }

      setTranslationConfig({ ejsEntryNameDict: mergedEntries, ejsKeywordDict: mergedKws });
      addToast('success', fmt(ui.esTranslated, { entries: addedE, keywords: addedK }) + dedupNote);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', `AI translate failed: ${msg}`);
    } finally {
      setIsAutoTranslating(false);
    }
  };

  // ─── AI sửa dịch trùng nghĩa (nút tay — dùng cho từ điển đã dịch trước / import lại) ───
  const resolveConflicts = async () => {
    const conflicts = [...detectEjsConflicts(ejsEntryNameDict), ...detectEjsConflicts(ejsKeywordDict)];
    if (conflicts.length === 0) {
      addToast('info', ui.esDedupNone);
      return;
    }
    setIsResolvingConflicts(true);
    try {
      const ejsContext = (card.data?.character_book?.entries || [])
        .filter((e: any) => e.content && /<%[\s\S]*?%>/.test(e.content))
        .map((e: any) => e.content).join('\n\n').slice(0, 3000);
      const res = await aiResolveEjsConflicts(
        ejsEntryNameDict, ejsKeywordDict, translationConfig.targetLanguage, proxy,
        undefined, ejsContext, translationConfig.ejsTranslationPrompt,
      );
      setTranslationConfig({ ejsEntryNameDict: res.fixedEntryDict, ejsKeywordDict: res.fixedKeywordDict });
      addToast(res.fixedCount > 0 ? 'success' : 'info', fmt(ui.esDedupFixed, { count: res.fixedCount }));
    } catch (err) {
      addToast('error', `AI dedup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsResolvingConflicts(false);
    }
  };

  // ─── Auto Extract Only (no AI) ───
  const autoExtractOnly = () => {
    let added = 0;
    const nextEntries = { ...ejsEntryNameDict };
    for (const ref of ejsEntryRefs) {
      if (!(ref.name in nextEntries)) {
        nextEntries[ref.name] = '';
        added++;
      }
    }
    const nextKws = { ...ejsKeywordDict };
    for (const kw of ejsKeywords) {
      if (!(kw.keyword in nextKws)) {
        nextKws[kw.keyword] = '';
        added++;
      }
    }
    if (added > 0) {
      setTranslationConfig({ ejsEntryNameDict: nextEntries, ejsKeywordDict: nextKws });
      addToast('success', fmt(ui.esAdded, { count: added }));
    } else {
      addToast('info', ui.esAllExist);
    }
  };

  // ─── Import / Export ───
  const exportDict = () => {
    const data = JSON.stringify({ ejsEntryNameDict, ejsKeywordDict }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ejs-sync-dict.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDict = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.ejsEntryNameDict) {
          setTranslationConfig({ ejsEntryNameDict: { ...ejsEntryNameDict, ...data.ejsEntryNameDict } });
        }
        if (data.ejsKeywordDict) {
          setTranslationConfig({ ejsKeywordDict: { ...ejsKeywordDict, ...data.ejsKeywordDict } });
        }
        addToast('success', ui.esImportOk);
      } catch {
        addToast('error', ui.esImportBad);
      }
    };
    input.click();
  };

  // ─── Filter ───
  const currentDict = activeTab === 'entries' ? ejsEntryNameDict : ejsKeywordDict;
  const filteredEntries = Object.entries(currentDict || {}).filter(([k, v]) =>
    !searchQuery || k.toLowerCase().includes(searchQuery.toLowerCase()) || (v || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const entryCount = Object.keys(ejsEntryNameDict).length;
  const kwCount = Object.keys(ejsKeywordDict).length;
  const totalCount = entryCount + kwCount;
  const translatedCount = Object.values(ejsEntryNameDict).filter(v => v.trim()).length +
    Object.values(ejsKeywordDict).filter(v => v.trim()).length;

  return (
    <div className="config-section" style={{ borderLeft: enableEjsSync ? '3px solid var(--color-info)' : undefined }}>
      {/* ─── Header ─── */}
      <div
        className="config-section-header"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <Settings size={16} style={{ color: 'var(--color-info)' }} />
        <span style={{ fontWeight: 600 }}>
          {ui.esTitle}
        </span>

        {/* Toggle */}
        <label className="toggle-switch" style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={enableEjsSync} onChange={toggleSync} />
          <span className="slider"></span>
        </label>

        {/* Badge */}
        {totalCount > 0 && (
          <span className="badge badge-info" style={{ fontSize: 11 }}>
            {translatedCount}/{totalCount}
          </span>
        )}
      </div>

      {isExpanded && enableEjsSync && (
        <div className="config-section-body" style={{ padding: '12px 16px' }}>
          {/* ─── EJS Detection Banner ─── */}
          <div style={{
            background: ejsDetection.isEjs ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <Zap size={14} />
            <span>
              {ejsDetection.isEjs ? (
                <>
                  <strong>EJS card detected</strong> — {ejsDetection.ejsBlockCount} blocks, {ejsDetection.entryWithEjsCount} entries with EJS
                  {ejsDetection.hasGetwi && ', getwi()'}
                  {ejsDetection.hasActivewi && ', activewi()'}
                  {ejsDetection.hasDefine && ', define()'}
                  {ejsDetection.hasDecorators && ', decorators'}
                </>
              ) : (
                <>{ui.esNoEjs}</>
              )}
            </span>
          </div>

          {/* ─── Action Buttons ─── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={autoExtractOnly} title="Extract entry names + keywords (no AI)">
              <Search size={13} /> {ui.esScan}
            </button>
            <button
              className="btn btn-sm btn-accent"
              onClick={autoExtractAndTranslate}
              disabled={isAutoTranslating}
              title="Scan + AI translate"
            >
              {isAutoTranslating ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
              {ui.esScanTranslate}
            </button>
            <button className="btn btn-sm" onClick={exportDict} title="Export dictionaries">
              <Download size={13} />
            </button>
            <button className="btn btn-sm" onClick={importDict} title="Import dictionaries">
              <Upload size={13} />
            </button>
            {/* (User 2026) Đồng nhất từ điển EJS — non-AI: làm sạch value + gom cụm gần-giống về 1 dạng.
                Keyword dict thêm PRUNE theo quy luật (bỏ văn xuôi/mảnh code/identifier lỡ vào từ scan cũ)
                + báo ĐỤNG ĐỘ (2 key → cùng 1 value). Entry name KHÔNG prune (tên dài/[prefix] hợp lệ). */}
            <button
              className="btn btn-sm"
              title={ui.esUnifyTip}
              style={{ color: '#4ade80', borderColor: 'rgba(34,197,94,0.3)' }}
              onClick={() => {
                const kwRes = enforceEjsDictConsistency(ejsKeywordDict, { pruneInvalidKeywords: true });
                const enRes = enforceEjsDictConsistency(ejsEntryNameDict);
                const total = kwRes.fixes.length + enRes.fixes.length;
                if (total > 0) {
                  setTranslationConfig({ ejsKeywordDict: kwRes.fixedDict, ejsEntryNameDict: enRes.fixedDict });
                  addToast('success', fmt(ui.esUnifyDone, { count: total }));
                  // Đưa chi tiết (prune/đụng độ) ra console cho user soi khi cần
                  console.log('[EJS Đồng nhất]', [...kwRes.fixes, ...enRes.fixes]);
                } else {
                  addToast('info', ui.esUnifyNone);
                }
              }}
            >
              🔗 {ui.esUnify}
            </button>
            {/* (User 2026) AI SỬA DỊCH TRÙNG NGHĨA — port cơ chế dedup của Chiến lược B: khi ≥2 key
                gốc khác nhau ra CÙNG 1 bản dịch (vd 父女 & 父子 → "Cha con"), gọi AI dịch lại đúng
                các key đó cho khác nhau. Badge = số nhóm đụng độ đang có. */}
            {(() => {
              const nConflicts = detectEjsConflicts(ejsEntryNameDict).length + detectEjsConflicts(ejsKeywordDict).length;
              return (
                <button
                  className="btn btn-sm"
                  title={ui.esDedupTip}
                  disabled={isResolvingConflicts}
                  style={{ color: nConflicts > 0 ? '#f59e0b' : '#9ca3af', borderColor: nConflicts > 0 ? 'rgba(245,158,11,0.4)' : 'rgba(120,120,120,0.3)' }}
                  onClick={resolveConflicts}
                >
                  {isResolvingConflicts ? <Loader2 size={13} className="spin" /> : '🔍'} {ui.esDedup}
                  {nConflicts > 0 && (
                    <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 4, padding: '0 4px' }}>
                      {nConflicts}
                    </span>
                  )}
                </button>
              );
            })()}
            {/* (User 2026) ÁP từ điển vào bản dịch — non-AI: sau khi EDIT dict trong panel (input sửa
                trực tiếp được), bấm nút này để quét lại MỌI field đã dịch và ép theo dict mới. */}
            <button
              className="btn btn-sm"
              title={ui.esApplyTip}
              style={{ color: '#38bdf8', borderColor: 'rgba(56,189,248,0.3)' }}
              onClick={applyDictToTranslation}
            >
              📥 {ui.esApply}
            </button>
          </div>

          {/* EJS Scan Passes Control */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: 12,
            fontSize: 13,
          }}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {ui.esPasses}
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={translationConfig.ejsScanPasses || 1}
              onChange={(e) => setTranslationConfig({ ejsScanPasses: Math.max(1, Math.min(5, parseInt(e.target.value) || 1)) })}
              style={{
                width: 48,
                padding: '2px 6px',
                fontSize: 12,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                textAlign: 'center' as const,
              }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {ui.esPassesHint}
            </span>
          </div>

          {/* ─── Custom Translation Prompt ─── */}
          <div style={{
            marginBottom: 12,
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-primary)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              📝 {ui.esCustomPrompt}
            </div>
            <textarea
              value={translationConfig.ejsTranslationPrompt || ''}
              onChange={(e) => setTranslationConfig({ ejsTranslationPrompt: e.target.value })}
              placeholder={ui.esCustomPromptPh}
              style={{
                width: '100%',
                minHeight: 48,
                maxHeight: 120,
                padding: '6px 10px',
                fontSize: 12,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                resize: 'vertical' as const,
                outline: 'none',
              }}
            />
          </div>

          {/* ─── Decorator Preserve Toggle ─── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13 }}>
            <Shield size={14} style={{ color: 'var(--color-info)' }} />
            <span>{ui.esProtectDecorators}</span>
            <label className="toggle-switch" style={{ marginLeft: 'auto' }}>
              <input
                type="checkbox"
                checked={ejsDecoratorPreserve}
                onChange={() => setTranslationConfig({ ejsDecoratorPreserve: !ejsDecoratorPreserve })}
              />
              <span className="slider"></span>
            </label>
          </div>

          {/* ─── Tabs ─── */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <button
              className={`btn btn-xs ${activeTab === 'entries' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('entries')}
            >
              <BookOpen size={12} /> Entry Names ({entryCount})
            </button>
            <button
              className={`btn btn-xs ${activeTab === 'keywords' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('keywords')}
            >
              <Hash size={12} /> Keywords ({kwCount})
            </button>
            <button
              className={`btn btn-xs ${activeTab === 'decorators' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('decorators')}
            >
              <Eye size={12} /> Decorators ({ejsDecorators.length})
            </button>
          </div>

          {/* ─── Search ─── */}
          {activeTab !== 'decorators' && (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: 8, opacity: 0.5 }} />
              <input
                type="text"
                className="input input-sm"
                style={{ paddingLeft: 28, width: '100%' }}
                placeholder={ui.esSearchPh}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          {/* ─── Dictionary Table (Entries / Keywords) ─── */}
          {activeTab !== 'decorators' && (
            <>
              <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 8 }}>
                {filteredEntries.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', opacity: 0.6, fontSize: 13 }}>
                    {ui.esNoData}
                  </div>
                ) : (
                  <table className="dict-table" style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: '40%' }}>Original</th>
                        <th style={{ width: '40%' }}>{ui.esTranslatedCol}</th>
                        <th style={{ width: '20%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map(([key, value]) => (
                        <tr key={key}>
                          <td style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{key}</td>
                          <td>
                            <input
                              type="text"
                              className="input input-xs"
                              value={value}
                              onChange={(e) =>
                                activeTab === 'entries'
                                  ? updateEntryName(key, e.target.value)
                                  : updateKeyword(key, e.target.value)
                              }
                              style={{ width: '100%', fontSize: 11 }}
                              placeholder="..."
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn btn-xs btn-ghost"
                              onClick={() =>
                                activeTab === 'entries' ? removeEntryName(key) : removeKeyword(key)
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ─── Add Row ─── */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <input
                  type="text"
                  className="input input-sm"
                  placeholder="Original"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <input
                  type="text"
                  className="input input-sm"
                  placeholder={ui.esTranslatedCol}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  style={{ flex: 1, fontSize: 12 }}
                  onKeyDown={(e) => e.key === 'Enter' && (activeTab === 'entries' ? addEntryName() : addKeyword())}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={activeTab === 'entries' ? addEntryName : addKeyword}
                >
                  <Plus size={13} />
                </button>
              </div>
            </>
          )}

          {/* ─── Decorators View (Read-only) ─── */}
          {activeTab === 'decorators' && (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {ejsDecorators.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', opacity: 0.6, fontSize: 13 }}>
                  {ui.esNoDecorators}
                </div>
              ) : (
                <table className="dict-table" style={{ width: '100%', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Decorator</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ejsDecorators.map((dec, i) => (
                      <tr key={i}>
                        <td>
                          <span className="badge badge-sm" style={{
                            background: dec.type === 'render' ? 'var(--color-success-bg)' :
                              dec.type === 'inject' ? 'var(--color-warning-bg)' :
                                dec.type === 'generate' ? 'var(--color-info-bg)' : 'var(--bg-secondary)',
                            fontSize: 10,
                          }}>
                            {dec.type}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>
                          {dec.line.slice(0, 60)}{dec.line.length > 60 ? '...' : ''}
                        </td>
                        <td style={{ fontSize: 10, opacity: 0.7 }}>{dec.foundIn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ─── Stats ─── */}
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8, display: 'flex', gap: 12 }}>
            <span>📊 {ui.esEntryNames}: {entryCount} ({Object.values(ejsEntryNameDict).filter(v => v.trim()).length} {ui.esTranslatedWord})</span>
            <span>🏷️ Keywords: {kwCount} ({Object.values(ejsKeywordDict).filter(v => v.trim()).length} {ui.esTranslatedWord})</span>
            <span>🛡️ Decorators: {ejsDecorators.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
