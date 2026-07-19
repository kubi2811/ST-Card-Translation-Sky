/**
 * LorebookPage — Module 3: Lorebook Manager
 * Spec Phần 7: 2 tabs — Danh sách Entries / AI Sinh theo Batch
 * + Worldbook Config theo guide
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  BookOpen, Plus, Search, Trash2, Copy, GripVertical,
  ChevronDown, ChevronRight, X, Check, Filter,
  ToggleLeft, ToggleRight,
  Edit3, Layers, Zap, FileText, Globe, Lock, AlertTriangle, Gauge,
  Wand2, Pencil,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCardStore } from '../store/cardStore';
import { useSettingsStore } from '../store/settingsStore';
import { useToastStore } from '../store/toastStore';
import { BatchGeneratorPanel } from '../components/lorebook/BatchGeneratorPanel';
import { DocExtractPanel } from '../components/lorebook/DocExtractPanel';
import { WikiScraperPanel } from '../components/lorebook/WikiScraperPanel';
import { RAGDebugPanel } from '../components/lorebook/RAGDebugPanel';
import { LorebookCategorizationPanel } from '../components/lorebook/LorebookCategorizationPanel';
import { QualityHubPanel } from '../components/lorebook/QualityHubPanel';
import { LorebookRefinerPanel } from '../components/lorebook/LorebookRefinerPanel';
import { TokenBudgetWizard } from '../components/tokenBudget/TokenBudgetWizard';
import {
  ENTRY_CATEGORY_LABELS, getPreset, getStrategyLabel,
  type EntryCategory, type CardType,
} from '../lib/worldbook/worldbookConfig';
import type { LorebookEntry, LorebookEntryExt } from '../types';
import { DEFAULT_ENTRY_EXT } from '../types';
import { runSemanticDeduplication } from '../lib/ai/deduplicator';
import { t as ui, fmt } from '../i18n';

// ─── Constants ──────────────────────────────────────────────────────────────

const POSITION_LABELS: Record<number, string> = {
  0: '↑ Before Char', 1: '↓ After Char', 2: '📝 Top AN',
  3: '📝 Bot AN', 4: '@Depth', 5: '← Before Ex', 6: '→ After Ex', 7: '🔌 Outlet',
};

const SELECTIVE_LOGIC_LABELS: Record<number, string> = {
  0: 'AND ANY', 1: 'NOT ALL', 2: 'NOT ANY', 3: 'AND ALL',
};

const SORT_OPTIONS = [
  { value: 'display_index', label: ui.lbSortDisplay },
  { value: 'comment', label: ui.lbSortName },
  { value: 'insertion_order', label: 'Insertion Order' },
  { value: 'content_length', label: ui.lbSortLength },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

const estimateTokens = (text: string) => Math.ceil((text || '').length / 4);

// ─── Main Page ──────────────────────────────────────────────────────────────

export function LorebookPage() {
  const [activeTab, setActiveTab] = useState<'entries' | 'batch' | 'refiner' | 'doc' | 'wiki' | 'analysis' | 'quality' | 'tctrl'>('entries');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border bg-card/50 px-2 shrink-0">
        {[
          { id: 'entries' as const, label: ui.lbTabEntries, icon: BookOpen },
          { id: 'batch' as const, label: ui.lbTabBatch, icon: Zap },
          { id: 'refiner' as const, label: ui.lbTabRefiner, icon: Wand2 },
          { id: 'doc' as const, label: ui.lbTabDoc, icon: FileText },
          { id: 'wiki' as const, label: ui.lbTabWiki, icon: Globe },
          { id: 'analysis' as const, label: ui.lbTabAnalysis, icon: Filter },
          { id: 'quality' as const, label: ui.lbTabQuality, icon: Lock },
          { id: 'tctrl' as const, label: ui.lbTabTctrl, icon: Gauge },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'entries' && <EntriesTab />}
      {activeTab === 'batch' && <div className="flex-1 overflow-y-auto scrollbar-thin"><BatchGeneratorPanel /></div>}
      {activeTab === 'refiner' && <div className="flex-1 overflow-y-auto scrollbar-thin"><LorebookRefinerPanel /></div>}
      {activeTab === 'doc' && <div className="flex-1 overflow-y-auto scrollbar-thin"><DocExtractPanel /></div>}
      {activeTab === 'wiki' && <div className="flex-1 overflow-y-auto scrollbar-thin"><WikiScraperPanel /></div>}
      {activeTab === 'analysis' && <div className="flex-1 overflow-y-auto scrollbar-thin"><LorebookCategorizationPanel /></div>}
      {activeTab === 'quality' && <div className="flex-1 overflow-y-auto scrollbar-thin"><QualityHubPanel /></div>}
      {activeTab === 'tctrl' && <div className="flex-1 overflow-hidden"><TokenBudgetWizard /></div>}
    </div>
  );
}

function EntriesTab() {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const updateEntry = useCardStore(s => s.updateEntry);
  const deleteEntry = useCardStore(s => s.deleteEntry);
  const getNextEntryId = useCardStore(s => s.getNextEntryId);

  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card.data.character_book?.entries]);

  // ─── Đổi tên lorebook (character_book.name) ─────────────────────────
  const [renamingBook, setRenamingBook] = useState(false);
  const [bookNameDraft, setBookNameDraft] = useState('');

  const commitBookName = useCallback(() => {
    const next = bookNameDraft.trim();
    useCardStore.getState().updateCard(c => {
      // Thẻ có thể chưa có character_book (chưa thêm entry nào) → tạo rỗng để giữ được tên.
      if (!c.data.character_book) c.data.character_book = { name: next, entries: [] };
      else c.data.character_book.name = next;
    });
    setRenamingBook(false);
  }, [bookNameDraft]);

  // ─── Filter/Search/Sort state ───────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPosition, setFilterPosition] = useState<number | null>(null);
  const [filterEnabled, setFilterEnabled] = useState<boolean | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('display_index');
  const [showFilters, setShowFilters] = useState(false);

  // ─── Semantic Deduplication state ───────────────────────────────────
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupLogs, setDedupLogs] = useState<string[]>([]);
  const [showDedupPanel, setShowDedupPanel] = useState(false);

  const handleRunDeduplication = useCallback(async () => {
    const profile = useSettingsStore.getState().getActiveProfile();
    const params = useSettingsStore.getState().generationParams;

    if (!profile) {
      useToastStore.getState().warning(ui.lbNeedProfile);
      return;
    }
    if (!profile.enableSecondaryModel || !profile.secondaryModel) {
      useToastStore.getState().warning(ui.lbNeedSecondary);
      return;
    }

    setDedupRunning(true);
    setDedupLogs([ui.lbDedupStart]);

    try {
      const logger = (msg: string) => {
        setDedupLogs(prev => [...prev, msg]);
      };

      const result = await runSemanticDeduplication(entries, profile, params, logger);
      
      if (result.deletedIds.length > 0) {
        useCardStore.getState().updateCard(c => {
          if (c.data.character_book) {
            c.data.character_book.entries = result.mergedEntries;
          }
        });
        logger(fmt(ui.lbDedupDone, { count: result.deletedIds.length }));
      } else {
        logger(ui.lbDedupNoChange);
      }
    } catch (err) {
      setDedupLogs(prev => [...prev, fmt(ui.lbDedupErr, { msg: err instanceof Error ? err.message : String(err) })]);
    } finally {
      setDedupRunning(false);
    }
  }, [entries]);

  // ─── Editor state ───────────────────────────────────────────────────
  const [editingEntry, setEditingEntry] = useState<LorebookEntry | null>(null);

  // ─── Filtered + sorted entries ──────────────────────────────────────
  const filteredEntries = useMemo(() => {
    let result = [...entries];

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.comment.toLowerCase().includes(q) ||
        e.keys.some(k => k.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q)
      );
    }

    // Filter position
    if (filterPosition !== null) {
      result = result.filter(e => e.extensions.position === filterPosition);
    }

    // Filter enabled
    if (filterEnabled !== null) {
      result = result.filter(e => e.enabled === filterEnabled);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'comment': return a.comment.localeCompare(b.comment);
        case 'insertion_order': return a.insertion_order - b.insertion_order;
        case 'content_length': return b.content.length - a.content.length;
        default: return a.extensions.display_index - b.extensions.display_index;
      }
    });

    return result;
  }, [entries, searchQuery, filterPosition, filterEnabled, sortBy]);

  // ─── Stats ──────────────────────────────────────────────────────────
  const totalTokens = useMemo(() => entries.reduce((sum, e) => sum + estimateTokens(e.content), 0), [entries]);
  const enabledCount = useMemo(() => entries.filter(e => e.enabled).length, [entries]);

  // ─── Handlers ───────────────────────────────────────────────────────
  const handleAddEntry = useCallback(() => {
    const id = getNextEntryId();
    const entry: LorebookEntry = {
      id,
      keys: [],
      secondary_keys: [],
      comment: fmt(ui.lbNewEntryName, { id }),
      content: '',
      constant: false,
      selective: true,
      insertion_order: 100,
      enabled: true,
      position: 'before_char',
      use_regex: true,
      extensions: { ...DEFAULT_ENTRY_EXT, display_index: id },
    };
    addEntry(entry);
    setEditingEntry(entry);
  }, [getNextEntryId, addEntry]);

  const handleDuplicate = useCallback((entry: LorebookEntry) => {
    const id = getNextEntryId();
    const dup: LorebookEntry = {
      ...structuredClone(entry),
      id,
      comment: `${entry.comment} (Copy)`,
      extensions: { ...entry.extensions, display_index: id },
    };
    addEntry(dup);
  }, [getNextEntryId, addEntry]);

  const handleDelete = useCallback((id: number, comment: string) => {
    if (!confirm(fmt(ui.lbConfirmDelete, { name: comment }))) return;
    deleteEntry(id);
    if (editingEntry?.id === id) setEditingEntry(null);
  }, [deleteEntry, editingEntry]);

  const handleToggleEnabled = useCallback((id: number, current: boolean) => {
    updateEntry(id, { enabled: !current });
  }, [updateEntry]);

  const handleSaveEntry = useCallback((entry: LorebookEntry) => {
    updateEntry(entry.id, entry);
    setEditingEntry(null);
  }, [updateEntry]);

  // ─── Virtualized list ───────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  return (
    <div className="h-full flex overflow-hidden">
      {/* ═══════════ LEFT: ENTRY LIST ═══════════ */}
      <div className={`flex flex-col ${editingEntry ? 'w-1/2' : 'w-full'} transition-all border-r border-border`}>
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-border bg-card/50">
          <div className="flex items-center justify-between mb-3">
            {/* Tên lorebook (character_book.name) — bấm vào để đổi tên tại chỗ.
                Bỏ trống thì SillyTavern hiển thị theo tên thẻ, nên không ép nhập. */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <BookOpen className="w-5 h-5 text-primary shrink-0" />
              {renamingBook ? (
                <input
                  autoFocus
                  value={bookNameDraft}
                  // Bôi đen sẵn tên cũ để gõ là thay luôn, khỏi phải xoá tay.
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => setBookNameDraft(e.target.value)}
                  onBlur={commitBookName}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitBookName();
                    if (e.key === 'Escape') setRenamingBook(false);
                  }}
                  placeholder={ui.lbBookNamePh}
                  className="settings-input text-lg font-semibold py-1 max-w-md"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setBookNameDraft(card.data.character_book?.name ?? ''); setRenamingBook(true); }}
                  title={ui.lbRenameBookTip}
                  className="group flex items-center gap-1.5 min-w-0 text-left rounded px-1 -mx-1 hover:bg-muted/60 transition-colors"
                >
                  <h1 className="text-lg font-semibold truncate">
                    {card.data.character_book?.name?.trim() || 'Lorebook'}
                  </h1>
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => { setDedupLogs([]); setShowDedupPanel(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted/80 hover:text-foreground transition-colors text-muted-foreground">
                <Layers className="w-4 h-4 text-primary" /> {ui.lbDedupBtn}
              </button>
              <button onClick={handleAddEntry}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="w-4 h-4" /> {ui.lbAddEntry}
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={ui.lbSearchPh}
                className="settings-input pl-9 text-sm" />
            </div>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg border transition-colors ${showFilters ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              <Filter className="w-4 h-4" />
            </button>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}
              className="settings-input w-auto text-xs" title={ui.lbSortTitle}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="flex gap-3 mt-3 flex-wrap">
              <select value={filterPosition ?? ''} onChange={e => setFilterPosition(e.target.value ? Number(e.target.value) : null)}
                className="settings-input w-auto text-xs">
                <option value="">{ui.lbAnyPosition}</option>
                {Object.entries(POSITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={filterEnabled === null ? '' : String(filterEnabled)}
                onChange={e => setFilterEnabled(e.target.value === '' ? null : e.target.value === 'true')}
                className="settings-input w-auto text-xs">
                <option value="">{ui.lbAnyStatus}</option>
                <option value="true">{ui.lbOnFilter}</option>
                <option value="false">{ui.lbOffFilter}</option>
              </select>
              {(filterPosition !== null || filterEnabled !== null) && (
                <button onClick={() => { setFilterPosition(null); setFilterEnabled(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground">{ui.lbClearFilter}</button>
              )}
            </div>
          )}

          {/* Stats bar */}
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span><Layers className="w-3 h-3 inline mr-1" />{entries.length} entries</span>
            <span className="text-emerald-400/80">{fmt(ui.lbEnabledCount, { count: enabledCount })}</span>
            <span>~{totalTokens.toLocaleString()} tokens</span>
            {searchQuery && <span className="text-primary">{fmt(ui.lbResultCount, { count: filteredEntries.length })}</span>}
          </div>
        </div>

        {/* Virtualized list */}
        <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <BookOpen className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">{entries.length === 0 ? ui.lbNoEntry : ui.lbNoMatch}</p>
              {entries.length === 0 && (
                <button onClick={handleAddEntry} className="mt-3 text-sm text-primary hover:text-primary/80">
                  {ui.lbCreateFirst}
                </button>
              )}
            </div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
              {virtualizer.getVirtualItems().map(vi => {
                const entry = filteredEntries[vi.index];
                return (
                  <div key={entry.id} ref={virtualizer.measureElement} data-index={vi.index}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>
                    <EntryRow
                      entry={entry}
                      isActive={editingEntry?.id === entry.id}
                      onEdit={() => setEditingEntry(structuredClone(entry))}
                      onToggle={() => handleToggleEnabled(entry.id, entry.enabled)}
                      onDuplicate={() => handleDuplicate(entry)}
                      onDelete={() => handleDelete(entry.id, entry.comment)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RAG Debug (Sức khoẻ config đã gộp vào tab "Phân tích & Chất lượng" — bug #7) */}
        <div className="shrink-0 px-4 pb-3 space-y-2">
          <RAGDebugPanel />
        </div>
      </div>

      {/* ═══════════ RIGHT: ENTRY EDITOR DRAWER ═══════════ */}
      {editingEntry && (
        <EntryEditor
          entry={editingEntry}
          onChange={setEditingEntry}
          onSave={handleSaveEntry}
          onCancel={() => setEditingEntry(null)}
          onDelete={() => handleDelete(editingEntry.id, editingEntry.comment)} />
      )}

      {/* ═══════════ DEDUPLICATION DIALOG ═══════════ */}
      {showDedupPanel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg flex flex-col max-h-[80vh] shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-sm">{ui.lbDedupTitle}</h3>
              </div>
              <button onClick={() => { if (!dedupRunning) setShowDedupPanel(false); }}
                disabled={dedupRunning}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {ui.lbDedupDesc}
              </p>

              {dedupLogs.length > 0 && (
                <div className="bg-muted/40 border border-border/60 rounded-lg p-3 h-64 overflow-y-auto font-mono text-[10px] space-y-1.5 scrollbar-thin">
                  {dedupLogs.map((log, idx) => (
                    <div key={idx} className={log.includes('✅') ? 'text-emerald-400' : log.includes('⚠️') ? 'text-amber-400' : log.includes('❌') ? 'text-rose-400' : 'text-muted-foreground'}>
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-border bg-muted/10 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {dedupRunning ? ui.lbDedupAnalysing : ''}
              </span>
              <div className="flex gap-2">
                {!dedupRunning ? (
                  <>
                    <button onClick={handleRunDeduplication}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                      {ui.lbDedupStartBtn}
                    </button>
                    <button onClick={() => setShowDedupPanel(false)}
                      className="px-4 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      {ui.lbClose}
                    </button>
                  </>
                ) : (
                  <button disabled
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-medium cursor-not-allowed">
                    {ui.lbProcessing}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY ROW — virtualized list item
// ═══════════════════════════════════════════════════════════════════════════

function EntryRow({ entry, isActive, onEdit, onToggle, onDuplicate, onDelete }: {
  entry: LorebookEntry; isActive: boolean;
  onEdit: () => void; onToggle: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group ${
      isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
    }`} onClick={onEdit}>
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />

      {/* Toggle enabled */}
      <button onClick={e => { e.stopPropagation(); onToggle(); }}
        className="shrink-0" title={entry.enabled ? ui.lbToggleOff : ui.lbToggleOn}>
        {entry.enabled
          ? <ToggleRight className="w-5 h-5 text-emerald-400" />
          : <ToggleLeft className="w-5 h-5 text-muted-foreground/40" />}
      </button>

      {/* Status icons */}
      <div className="flex gap-0.5 shrink-0">
        {entry.constant && <span title="Constant" className="text-[10px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">C</span>}
        {entry.selective && <span title="Selective" className="text-[10px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">S</span>}
      </div>

      {/* Comment */}
      <span className={`flex-1 truncate text-sm ${entry.enabled ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
        {entry.comment || '(no name)'}
      </span>

      {/* Keys badges */}
      <div className="hidden sm:flex gap-1 shrink-0">
        {entry.keys.slice(0, 3).map((k, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground truncate max-w-[80px]">{k}</span>
        ))}
        {entry.keys.length > 3 && <span className="text-[10px] text-muted-foreground">+{entry.keys.length - 3}</span>}
      </div>

      {/* Meta */}
      <span className="text-[10px] text-muted-foreground/60 shrink-0 w-8 text-right" title="Insertion order">
        {entry.insertion_order}
      </span>
      <span className="text-[10px] text-muted-foreground/60 shrink-0 w-12 text-right" title="Content length">
        {entry.content.length > 999 ? `${(entry.content.length / 1000).toFixed(1)}k` : entry.content.length}
      </span>

      {/* Actions */}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={e => { e.stopPropagation(); onDuplicate(); }} className="p-1 text-muted-foreground hover:text-foreground" title={ui.lbDuplicate}>
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 text-muted-foreground hover:text-destructive" title={ui.lbDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY EDITOR DRAWER — right panel
// ═══════════════════════════════════════════════════════════════════════════

function EntryEditor({ entry, onChange, onSave, onCancel, onDelete }: {
  entry: LorebookEntry;
  onChange: (e: LorebookEntry) => void;
  onSave: (e: LorebookEntry) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [secKeyInput, setSecKeyInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<EntryCategory>('custom');
  const [cardType, setCardType] = useState<CardType>('single');

  const tokens = estimateTokens(entry.content);
  const strategy = getStrategyLabel(entry.constant, entry.selective);

  // Keyword validation warnings
  const keyWarnings = useMemo(() => {
    const warns: string[] = [];
    if (entry.keys.some(k => k.includes('，'))) warns.push(ui.lbWarnFullWidthComma);
    if (entry.keys.some(k => k.startsWith(' ') || k.endsWith(' '))) warns.push(ui.lbWarnTrimKey);
    if (!entry.constant && entry.selective && entry.keys.length === 0) warns.push(ui.lbWarnGreenNoKey);
    return warns;
  }, [entry.keys, entry.constant, entry.selective]);

  const update = useCallback((patch: Partial<LorebookEntry>) => {
    onChange({ ...entry, ...patch });
  }, [entry, onChange]);

  const updateExt = useCallback((patch: Partial<LorebookEntryExt>) => {
    onChange({ ...entry, extensions: { ...entry.extensions, ...patch } });
  }, [entry, onChange]);

  const addKey = useCallback((field: 'keys' | 'secondary_keys', input: string, setInput: (v: string) => void) => {
    const key = input.trim();
    if (!key || entry[field].includes(key)) return;
    update({ [field]: [...entry[field], key] });
    setInput('');
  }, [entry, update]);

  const removeKey = useCallback((field: 'keys' | 'secondary_keys', key: string) => {
    update({ [field]: entry[field].filter(k => k !== key) });
  }, [entry, update]);

  // Apply category preset
  const handleCategoryChange = useCallback((cat: EntryCategory) => {
    setSelectedCategory(cat);
    if (cat === 'custom') return;
    const preset = getPreset(cat, cardType);
    if (!preset) return;
    const d = preset.defaults;
    onChange({
      ...entry,
      constant: d.constant,
      selective: d.selective,
      insertion_order: d.insertion_order,
      position: d.position === 0 ? 'before_char' : 'after_char',
      extensions: {
        ...entry.extensions,
        position: d.position,
        depth: d.depth,
        role: d.role,
        scan_depth: d.scan_depth,
        exclude_recursion: true,
        prevent_recursion: true,
      },
    });
  }, [entry, cardType, onChange]);

  // Auto-sync position field based on extensions.position
  useEffect(() => {
    const newPosition = entry.extensions.position === 0 ? 'before_char' : 'after_char';
    if (entry.position !== newPosition) {
      onChange({ ...entry, position: newPosition });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.extensions.position]);

  return (
    <div className="w-1/2 flex flex-col bg-card border-l border-border">
      {/* Header */}
      <div className="shrink-0 px-5 py-3 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium truncate max-w-[200px]">{entry.comment || 'Untitled'}</h2>
        </div>
        <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
        {/* Category Selector */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="settings-label text-[10px]">{ui.lbCardType}</label>
              <div className="flex gap-2">
                <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                  <input type="radio" name="ed-cardType" checked={cardType === 'single'}
                    onChange={() => setCardType('single')} className="settings-checkbox" />
                  {ui.lbSingleChar}
                </label>
                <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                  <input type="radio" name="ed-cardType" checked={cardType === 'multi'}
                    onChange={() => setCardType('multi')} className="settings-checkbox" />
                  {ui.lbMultiChar}
                </label>
              </div>
            </div>
            <div>
              <label className="settings-label text-[10px]">{ui.lbEntryType}</label>
              <select value={selectedCategory} onChange={e => handleCategoryChange(e.target.value as EntryCategory)}
                className="settings-input text-xs py-1">
                {Object.entries(ENTRY_CATEGORY_LABELS).map(([key, { label, icon }]) => (
                  <option key={key} value={key}>{icon} {label}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Strategy indicator */}
          <div className={`flex items-center gap-2 text-xs ${strategy.color}`}>
            <span>{strategy.icon}</span>
            <span className="font-medium">{strategy.label}</span>
          </div>
        </div>

        {/* Comment */}
        <div>
          <label className="settings-label">{ui.lbEntryName}</label>
          <input type="text" value={entry.comment} onChange={e => update({ comment: e.target.value })}
            className="settings-input" placeholder={ui.lbEntryNamePh} />
        </div>

        {/* Toggles row */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={entry.enabled} onChange={e => update({ enabled: e.target.checked })}
              className="settings-checkbox" /> {ui.lbEnabled}
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={entry.constant} onChange={e => update({ constant: e.target.checked })}
              className="settings-checkbox" /> Constant
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={entry.selective} onChange={e => update({ selective: e.target.checked })}
              className="settings-checkbox" /> Selective
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={entry.use_regex} onChange={e => update({ use_regex: e.target.checked })}
              className="settings-checkbox" /> Regex
          </label>
        </div>

        {/* Keys */}
        <div>
          <label className="settings-label">{ui.lbKeys}</label>
          <div className="flex gap-2 mb-2">
            <input type="text" value={keyInput} onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKey('keys', keyInput, setKeyInput))}
              className="settings-input flex-1 text-xs" placeholder={ui.lbKeysPh} />
          </div>
          <div className="flex flex-wrap gap-1">
            {entry.keys.map((k, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs">
                {k}
                <button onClick={() => removeKey('keys', k)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          {/* Keyword warnings */}
          {keyWarnings.length > 0 && (
            <div className="mt-2 space-y-1">
              {keyWarnings.map((w, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] text-amber-400">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Secondary keys (only if selective) */}
        {entry.selective && (
          <div>
            <label className="settings-label">Secondary Keys</label>
            <div className="flex gap-2 mb-2">
              <input type="text" value={secKeyInput} onChange={e => setSecKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKey('secondary_keys', secKeyInput, setSecKeyInput))}
                className="settings-input flex-1 text-xs" placeholder="Secondary key" />
            </div>
            <div className="flex flex-wrap gap-1">
              {entry.secondary_keys.map((k, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-xs">
                  {k}
                  <button onClick={() => removeKey('secondary_keys', k)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="mt-2">
              <label className="settings-label">Selective Logic</label>
              <select value={entry.extensions.selectiveLogic} onChange={e => updateExt({ selectiveLogic: Number(e.target.value) as 0|1|2|3 })}
                className="settings-input text-xs">
                {Object.entries(SELECTIVE_LOGIC_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Content */}
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="settings-label mb-0">{ui.lbContent}</label>
            <span className="text-[10px] text-muted-foreground">~{tokens} tokens · {entry.content.length} chars</span>
          </div>
          <textarea value={entry.content} onChange={e => update({ content: e.target.value })}
            rows={12} className="settings-input font-mono text-xs leading-relaxed resize-y"
            placeholder={ui.lbContentPh} />
        </div>

        {/* Position + Order + Scan Depth */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="settings-label">{ui.lbPosition}</label>
            <select value={entry.extensions.position}
              onChange={e => updateExt({ position: Number(e.target.value) as LorebookEntryExt['position'] })}
              className="settings-input text-xs">
              {Object.entries(POSITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="settings-label">{ui.lbOrder}</label>
            <input type="number" value={entry.insertion_order}
              onChange={e => update({ insertion_order: parseInt(e.target.value) || 100 })}
              className="settings-input text-xs" min={0} />
          </div>
          <div>
            <label className="settings-label">{ui.lbScanDepth}</label>
            <input type="number" value={entry.extensions.scan_depth ?? 2}
              onChange={e => updateExt({ scan_depth: parseInt(e.target.value) || 2 })}
              className="settings-input text-xs" min={0} max={10} title={ui.lbScanDepthTitle} />
          </div>
        </div>

        {/* Depth + Role (only when position=4) */}
        {entry.extensions.position === 4 && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="settings-label">Depth</label>
              <input type="number" value={entry.extensions.depth}
                onChange={e => updateExt({ depth: parseInt(e.target.value) || 4 })}
                className="settings-input text-xs" min={0} max={100} />
            </div>
            <div>
              <label className="settings-label">Role</label>
              <select value={entry.extensions.role ?? ''} onChange={e => updateExt({ role: e.target.value === '' ? null : Number(e.target.value) as 0|1|2 })}
                className="settings-input text-xs">
                <option value="">Auto</option>
                <option value="0">System</option>
                <option value="1">User</option>
                <option value="2">Assistant</option>
              </select>
            </div>
          </div>
        )}

        {/* Outlet name (only when position=7) */}
        {entry.extensions.position === 7 && (
          <div>
            <label className="settings-label">Outlet Name</label>
            <input type="text" value={entry.extensions.outlet_name}
              onChange={e => updateExt({ outlet_name: e.target.value })}
              className="settings-input text-xs" placeholder="outlet_name" />
          </div>
        )}

        {/* ─── Recursion Lock (main section) ─── */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
          <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[11px] text-muted-foreground flex-1">
            {ui.lbRecursion1} <span className="text-emerald-400 font-medium">{ui.lbRecursion2}</span>
            <span className="text-muted-foreground/60 ml-1">{ui.lbRecursion3}</span>
          </span>
          <label className="flex items-center gap-1 text-[10px] cursor-pointer">
            <input type="checkbox" checked={entry.extensions.prevent_recursion}
              onChange={e => updateExt({ prevent_recursion: e.target.checked })} className="settings-checkbox" />
            {ui.lbPreventRecursion}
          </label>
          <label className="flex items-center gap-1 text-[10px] cursor-pointer">
            <input type="checkbox" checked={entry.extensions.exclude_recursion}
              onChange={e => updateExt({ exclude_recursion: e.target.checked })} className="settings-checkbox" />
            {ui.lbExcludeRecursion}
          </label>
        </div>

        {/* ─── Advanced Section ─── */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
            {ui.lbAdvanced}
            {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {showAdvanced && (
            <div className="px-4 pb-4 pt-3 border-t border-border space-y-3">
              {/* Probability & Budget */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="settings-label">{ui.lbProbability}</label>
                  <input type="number" value={entry.extensions.probability}
                    onChange={e => updateExt({ probability: parseInt(e.target.value) || 100 })}
                    className="settings-input text-xs" min={0} max={100} />
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer pt-5">
                  <input type="checkbox" checked={entry.extensions.ignore_budget}
                    onChange={e => updateExt({ ignore_budget: e.target.checked })} className="settings-checkbox" />
                  {ui.lbIgnoreBudget}
                </label>
              </div>

              {/* Group & Timing */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="settings-label">{ui.lbGroup}</label>
                  <input type="text" value={entry.extensions.group}
                    onChange={e => updateExt({ group: e.target.value })}
                    className="settings-input text-xs" placeholder={ui.lbGroupPh} />
                </div>
                <div>
                  <label className="settings-label">Group Weight</label>
                  <input type="number" value={entry.extensions.group_weight}
                    onChange={e => updateExt({ group_weight: parseInt(e.target.value) || 100 })}
                    className="settings-input text-xs" min={0} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="settings-label">Sticky</label>
                  <input type="number" value={entry.extensions.sticky}
                    onChange={e => updateExt({ sticky: parseInt(e.target.value) || 0 })}
                    className="settings-input text-xs" min={0} />
                </div>
                <div>
                  <label className="settings-label">Cooldown</label>
                  <input type="number" value={entry.extensions.cooldown}
                    onChange={e => updateExt({ cooldown: parseInt(e.target.value) || 0 })}
                    className="settings-input text-xs" min={0} />
                </div>
                <div>
                  <label className="settings-label">Delay</label>
                  <input type="number" value={entry.extensions.delay}
                    onChange={e => updateExt({ delay: parseInt(e.target.value) || 0 })}
                    className="settings-input text-xs" min={0} />
                </div>
              </div>

              {/* Vectorized */}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={entry.extensions.vectorized}
                  onChange={e => updateExt({ vectorized: e.target.checked })} className="settings-checkbox" />
                {ui.lbVectorized}
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 px-5 py-3 border-t border-border bg-muted/30 flex items-center gap-2">
        <button onClick={() => onSave(entry)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Check className="w-4 h-4" /> {ui.lbSave}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          {ui.lbCancel}
        </button>
        <div className="flex-1" />
        <button onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="w-4 h-4" /> {ui.lbDelete}
        </button>
      </div>
    </div>
  );
}
