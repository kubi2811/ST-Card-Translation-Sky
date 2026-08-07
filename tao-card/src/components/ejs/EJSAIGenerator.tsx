/**
 * EJSAIGenerator — AI-Powered EJS Code Generator (Phase 2 Upgrade)
 * Nằm trong right panel của EJS Studio. Gọi AI sinh EJS code
 * và tự động tạo worldbook entry mới.
 *
 * Phase 2 additions:
 * - Entry picker: chọn entries cụ thể cho context
 * - Schema field picker: chọn fields cụ thể
 * - Iteration mode: gửi code hiện tại + feedback cho AI sửa
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Wand2, Loader2, Copy, Check, Plus,
  ChevronDown, Sparkles, AlertTriangle,
  BookPlus, RotateCcw, ListFilter, Columns3, Pencil,
  Zap, Shield, Undo2,
} from 'lucide-react';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { LorebookEntry, ChatMessage } from '../../types';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import { nextEntryId } from '../../lib/converters/cardDefaults';
import {
  EJS_SYSTEM_PROMPT,
  EJS_TEMPLATE_LABELS,
  buildEjsUserPrompt,
  parseEjsResponse,
  flattenAllFields,
  runEntryAnalysis,
  type EJSTemplateCategory,
  type EJSGenerationResult,
  type EntryAnalysis,
  type EjsStrategy,
} from '../../prompts/ejsPrompt';
import { t as ui, fmt } from '../../i18n';
import { copyWithToast } from '../../lib/copyToClipboard';   // (bug 224) copy chạy được cả trong iframe của Hub
import { useToastStore } from '../../store/toastStore';

/**
 * Nhãn hiển thị của 6 loại template. KHÔNG sửa `EJS_TEMPLATE_LABELS` trong prompts/
 * — file đó là vùng prompt AI; ở đây chỉ thay phần người dùng nhìn thấy.
 */
const CAT_UI: Record<string, { label: string; desc: string }> = {
  conditional_entry: { label: ui.egCatConditional, desc: ui.egCatConditionalDesc },
  dynamic_content:   { label: ui.egCatDynamic, desc: ui.egCatDynamicDesc },
  stat_reader:       { label: ui.egCatStatReader, desc: ui.egCatStatReaderDesc },
  multi_stage:       { label: ui.egCatMultiStage, desc: ui.egCatMultiStageDesc },
  variable_display:  { label: ui.egCatVarDisplay, desc: ui.egCatVarDisplayDesc },
  custom:            { label: ui.egCatCustom, desc: ui.egCatCustomDesc },
};


// ─── Props ──────────────────────────────────────────────────────────────────

interface EJSAIGeneratorProps {
  schema: MVUZODSchema | null;
  onInsertCode: (code: string) => void;
  currentEditorCode?: string; // Phase 2: for iteration mode
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function EJSAIGenerator({ schema, onInsertCode, currentEditorCode }: EJSAIGeneratorProps) {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const entries = useMemo(
    () => card.data.character_book?.entries ?? [],
    [card.data.character_book?.entries],
  );
  const characterName = card.data.name || 'Character';

  // State — Generation
  const [category, setCategory] = useState<EJSTemplateCategory>('conditional_entry');
  const [customInstructions, setCustomInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [result, setResult] = useState<EJSGenerationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedEntryId, setSavedEntryId] = useState<number | null>(null);
  const [showContext, setShowContext] = useState(false);

  // State — Phase 2: Smart context
  const [showEntryPicker, setShowEntryPicker] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set());
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [selectedFieldPaths, setSelectedFieldPaths] = useState<Set<string>>(new Set());

  // State — Phase 2: Iteration mode
  const [iterationMode, setIterationMode] = useState(false);
  const [iterationFeedback, setIterationFeedback] = useState('');

  // State — Phase 3: Smart Entry Analysis
  const [entryAnalysis, setEntryAnalysis] = useState<EntryAnalysis | null>(null);
  const [strategyOverride, setStrategyOverride] = useState<EjsStrategy | null>(null);
  const [appliedActions, setAppliedActions] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<Map<number, boolean> | null>(null);

  // Derived data
  const nonEjsEntries = useMemo(
    () => entries.filter(e => !e.content.trimStart().startsWith('@@preprocessing')),
    [entries],
  );

  const flatFields = useMemo(
    () => schema ? flattenAllFields(schema.fields) : [],
    [schema],
  );

  // Context summary
  const contextSummary = useMemo(() => {
    const schemaFields = schema?.fields?.length ?? 0;
    const ejsEntries = entries.filter(e => e.content.trimStart().startsWith('@@preprocessing')).length;
    const normalEntries = entries.length - ejsEntries;
    return { schemaFields, ejsEntries, normalEntries, characterName };
  }, [schema, entries, characterName]);

  // Auto-run analysis when conditional_entry is selected
  useEffect(() => {
    if (category === 'conditional_entry' && entries.length > 0) {
      const analysis = runEntryAnalysis(entries, schema);
      // eslint-disable-next-line
      setEntryAnalysis(analysis);
      setStrategyOverride(null); // Reset override when category changes
    } else {
      setEntryAnalysis(null);
    }
  }, [category, entries, schema]);

  const activeStrategy = strategyOverride ?? entryAnalysis?.recommendedStrategy ?? 'activate';

  // ─── Toggle Helpers ───
  const toggleEntryId = useCallback((id: number) => {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFieldPath = useCallback((path: string) => {
    setSelectedFieldPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // ─── Generate Handler ───
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    setSavedEntryId(null);
    setLoadingStatus(ui.egPreparing);

    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;

      if (!activeProfile?.apiKey) {
        throw new Error(ui.egNoApi);
      }

      setLoadingStatus(fmt(ui.egConnecting, { label: activeProfile.label }));

      const userPrompt = buildEjsUserPrompt(
        category,
        schema,
        entries,
        characterName,
        customInstructions,
        {
          selectedEntryIds: selectedEntryIds.size > 0 ? [...selectedEntryIds] : undefined,
          selectedFieldPaths: selectedFieldPaths.size > 0 ? [...selectedFieldPaths] : undefined,
          iterationCode: iterationMode ? currentEditorCode : undefined,
          iterationFeedback: iterationMode ? iterationFeedback : undefined,
        },
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: EJS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      setLoadingStatus(ui.egSending);

      // Call AI with retry
      const MAX_RETRIES = 2;

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        if (attempt > 1) {
          setLoadingStatus(fmt(ui.egRetrying, { attempt, total: MAX_RETRIES + 1 }));
        }

        try {
          let fullText = '';
          let isTruncated = true;
          let callCount = 0;
          const maxCalls = 3;
          let currentMessages = [...messages];

          while (isTruncated && callCount < maxCalls) {
            callCount++;
            if (callCount > 1) {
              setLoadingStatus(fmt(ui.egContinuing, { count: callCount }));
            }

            const response = await callAI({
              profile: activeProfile,
              params: {
                ...params,
                temperature: attempt > 1 ? 0.3 : params.temperature,
                useJsonResponseFormat: true,
              },
              messages: currentMessages,
            });

            fullText += response.text;
            const reason = response.finishReason;

            isTruncated = ['MAX_TOKENS', 'max_tokens', 'length'].includes(reason || '');

            if (isTruncated && response.text.trim()) {
              currentMessages = [
                ...currentMessages,
                { role: 'assistant', content: response.text },
                { role: 'user', content: 'Viết tiếp phần JSON bị bỏ dở. KHÔNG viết lại phần đã có.' },
              ];
            } else {
              isTruncated = false;
            }
          }

          setLoadingStatus(ui.egParsing);

          const parsed = parseEjsResponse(fullText);
          setResult(parsed);

          // Auto-save to worldbook entry (skip in iteration mode — just update editor)
          if (!iterationMode) {
            const newId = nextEntryId(entries);
            const newEntry: LorebookEntry = {
              id: newId,
              keys: ['@@ejs'],
              secondary_keys: [],
              comment: parsed.entryComment || `EJS: ${EJS_TEMPLATE_LABELS[category].label}`,
              content: parsed.code,
              constant: true,
              selective: false,
              insertion_order: 100,
              enabled: true,
              position: 'before_char',
              use_regex: false,
              extensions: {
                ...DEFAULT_ENTRY_EXT,
                position: 4,
                depth: 4,
                display_index: newId,
                exclude_recursion: true,
                prevent_recursion: true,
              },
            };

            addEntry(newEntry);
            setSavedEntryId(newId);
            setLoadingStatus(fmt(ui.egEntryCreated, { id: newId }));
          } else {
            setLoadingStatus(ui.egCodeFixed);
          }

          break; // Success
        } catch (e) {
          if (attempt > MAX_RETRIES) throw e;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoadingStatus('');
    } finally {
      setGenerating(false);
    }
  }, [category, schema, entries, characterName, customInstructions, addEntry,
    selectedEntryIds, selectedFieldPaths, iterationMode, currentEditorCode, iterationFeedback]);

  // ─── Handlers ───
  const handleCopy = useCallback(() => {
    if (!result?.code) return;
    void copyWithToast(result.code, 'code EJS', useToastStore.getState());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const handleInsert = useCallback(() => {
    if (!result?.code) return;
    onInsertCode(result.code);
  }, [result, onInsertCode]);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoadingStatus('');
    setSavedEntryId(null);
    setIterationMode(false);
    setIterationFeedback('');
  }, []);

  const catEntries = Object.entries(EJS_TEMPLATE_LABELS) as [EJSTemplateCategory, typeof EJS_TEMPLATE_LABELS[EJSTemplateCategory]][];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-xs font-semibold flex items-center gap-1.5 mb-2">
        <Wand2 className="w-3.5 h-3.5 text-primary" />
        AI EJS Generator
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium ml-auto">v2</span>
      </div>

      {/* Mode toggle: Generate vs Iterate */}
      {currentEditorCode && (
        <div className="flex gap-1">
          <button
            onClick={() => setIterationMode(false)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              !iterationMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="w-3 h-3" /> {ui.egCreate}
          </button>
          <button
            onClick={() => setIterationMode(true)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              iterationMode ? 'bg-amber-500/10 text-amber-400' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Pencil className="w-3 h-3" /> {ui.egFixCode}
          </button>
        </div>
      )}

      {/* Iteration mode feedback */}
      {iterationMode && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 space-y-1.5">
          <p className="text-[9px] text-amber-400 font-medium">
            {ui.egFixNote}
          </p>
          <textarea
            value={iterationFeedback}
            onChange={e => setIterationFeedback(e.target.value)}
            placeholder={ui.egFixPh}
            rows={2}
            className="w-full px-2 py-1.5 text-[10px] rounded-md border border-amber-500/20 bg-background
              focus:outline-none focus:ring-1 focus:ring-amber-500/30 resize-y placeholder:text-muted-foreground/40"
          />
        </div>
      )}

      {/* Template selector (hidden in iteration mode) */}
      {!iterationMode && (
        <div>
          <label className="text-[10px] font-medium text-muted-foreground block mb-1">{ui.egTemplateType}</label>
          <div className="space-y-1">
            {catEntries.map(([key, val]) => (
              <button
                key={key}
                onClick={() => setCategory(key)}
                disabled={generating}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] transition-all ${
                  category === key
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span>{val.emoji}</span>
                  <span className="font-medium">{CAT_UI[key]?.label ?? val.label}</span>
                </div>
                {category === key && (
                  <p className="text-[9px] text-muted-foreground mt-0.5 ml-5">{CAT_UI[key]?.desc ?? val.desc}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Smart Entry Analysis Panel (for conditional_entry) */}
      {!iterationMode && category === 'conditional_entry' && entryAnalysis && (
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[10px] font-semibold text-purple-400">{ui.egEntryAnalysis}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="rounded-md bg-background/50 p-1.5">
              <p className="text-[14px] font-bold text-foreground">{entryAnalysis.toggleableEntries.length}</p>
              <p className="text-[8px] text-muted-foreground">Toggleable</p>
            </div>
            <div className="rounded-md bg-background/50 p-1.5">
              <p className="text-[14px] font-bold text-foreground">{entryAnalysis.groups.length}</p>
              <p className="text-[8px] text-muted-foreground">{ui.egGroups}</p>
            </div>
            <div className="rounded-md bg-background/50 p-1.5">
              <p className="text-[14px] font-bold text-foreground">{entryAnalysis.npcEntries.length}</p>
              <p className="text-[8px] text-muted-foreground">NPC</p>
            </div>
          </div>

          {/* Strategy selector */}
          <div>
            <p className="text-[9px] text-muted-foreground mb-1">{fmt(ui.egStrategy, { name: entryAnalysis.recommendedStrategy })}</p>
            <div className="flex gap-1">
              <button
                onClick={() => setStrategyOverride('activate')}
                className={`flex-1 px-2 py-1 rounded text-[9px] font-medium transition-colors ${
                  activeStrategy === 'activate'
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'text-muted-foreground hover:text-foreground bg-muted/20'
                }`}
              >
                🅰️ Kích hoạt có ĐK
              </button>
              <button
                onClick={() => setStrategyOverride('getwi')}
                className={`flex-1 px-2 py-1 rounded text-[9px] font-medium transition-colors ${
                  activeStrategy === 'getwi'
                    ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                    : 'text-muted-foreground hover:text-foreground bg-muted/20'
                }`}
              >
                🅱️ getwi()
              </button>
            </div>
          </div>

          {/* Groups preview */}
          {entryAnalysis.groups.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground">{ui.egDetectedGroups}</p>
              {entryAnalysis.groups.slice(0, 5).map((g, i) => (
                <div key={i} className="flex items-center gap-1 text-[9px]">
                  <span className="text-purple-400">📁</span>
                  <span className="truncate flex-1" title={g.groupName}>{g.groupName}</span>
                  <span className="text-muted-foreground shrink-0">{g.entries.length} entries</span>
                </div>
              ))}
              {entryAnalysis.groups.length > 5 && (
                <p className="text-[8px] text-muted-foreground">{fmt(ui.egMoreGroups, { count: entryAnalysis.groups.length - 5 })}</p>
              )}
            </div>
          )}

          {entryAnalysis.suggestedControlVar && (
            <p className="text-[9px] text-muted-foreground">
              {ui.egControlVar} <code className="text-purple-400">{entryAnalysis.suggestedControlVar}</code>
            </p>
          )}
        </div>
      )}

      {/* Context summary + pickers */}
      <div>
        <button
          onClick={() => setShowContext(!showContext)}
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showContext ? <ChevronDown className="w-3 h-3" /> : <ChevronDown className="w-3 h-3 -rotate-90" />}
          Context ({contextSummary.schemaFields} fields, {contextSummary.normalEntries} entries)
          {(selectedEntryIds.size > 0 || selectedFieldPaths.size > 0) && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary ml-1">
              {selectedEntryIds.size > 0 ? `${selectedEntryIds.size} entries` : ''}
              {selectedEntryIds.size > 0 && selectedFieldPaths.size > 0 ? ' + ' : ''}
              {selectedFieldPaths.size > 0 ? `${selectedFieldPaths.size} fields` : ''}
            </span>
          )}
        </button>
        {showContext && (
          <div className="mt-1 space-y-2">
            <div className="rounded-md bg-muted/20 p-2 text-[9px] text-muted-foreground space-y-0.5">
              <p>🧩 Schema fields: {contextSummary.schemaFields}</p>
              <p>📝 Normal entries: {contextSummary.normalEntries}</p>
              <p>⚡ EJS entries: {contextSummary.ejsEntries}</p>
              <p>👤 Character: {contextSummary.characterName}</p>
            </div>

            {/* Entry picker */}
            <div>
              <button
                onClick={() => setShowEntryPicker(!showEntryPicker)}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                <ListFilter className="w-3 h-3" />
                {ui.egPickEntries}
                {selectedEntryIds.size > 0 && (
                  <span className="text-[8px] text-primary">({selectedEntryIds.size})</span>
                )}
              </button>
              {showEntryPicker && (
                <div className="mt-1 rounded-md border border-border max-h-32 overflow-y-auto scrollbar-thin">
                  {nonEjsEntries.length > 0 ? (
                    <>
                      <button
                        onClick={() => setSelectedEntryIds(new Set())}
                        className="w-full text-left px-2 py-1 text-[9px] text-muted-foreground hover:bg-muted/30 border-b border-border/50"
                      >
                        {ui.egDeselectAll}
                      </button>
                      {nonEjsEntries.map(e => (
                        <label key={e.id} className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/20 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEntryIds.has(e.id)}
                            onChange={() => toggleEntryId(e.id)}
                            className="w-3 h-3 rounded border-border"
                          />
                          <span className="text-[9px] truncate flex-1">
                            {e.comment || `#${e.id}`}
                          </span>
                          <span className="text-[8px] text-muted-foreground/50">
                            {e.keys.slice(0, 2).join(', ')}
                          </span>
                        </label>
                      ))}
                    </>
                  ) : (
                    <p className="text-[9px] text-muted-foreground/50 p-2">{ui.egNoEntries}</p>
                  )}
                </div>
              )}
            </div>

            {/* Field picker */}
            {schema && flatFields.length > 0 && (
              <div>
                <button
                  onClick={() => setShowFieldPicker(!showFieldPicker)}
                  className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <Columns3 className="w-3 h-3" />
                  {ui.egPickSchemaFields}
                  {selectedFieldPaths.size > 0 && (
                    <span className="text-[8px] text-primary">({selectedFieldPaths.size})</span>
                  )}
                </button>
                {showFieldPicker && (
                  <div className="mt-1 rounded-md border border-border max-h-32 overflow-y-auto scrollbar-thin">
                    <button
                      onClick={() => setSelectedFieldPaths(new Set())}
                      className="w-full text-left px-2 py-1 text-[9px] text-muted-foreground hover:bg-muted/30 border-b border-border/50"
                    >
                      {ui.egDeselectAll}
                    </button>
                    {flatFields.map(f => (
                      <label
                        key={f.path}
                        className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/20 cursor-pointer"
                        style={{ paddingLeft: `${8 + f.depth * 12}px` }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFieldPaths.has(f.path)}
                          onChange={() => toggleFieldPath(f.path)}
                          className="w-3 h-3 rounded border-border"
                        />
                        <span className="text-[9px] truncate flex-1">{f.label}</span>
                        <span className="text-[8px] text-muted-foreground/50">{f.type}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom instructions */}
      {!iterationMode && (
        <div>
          <label className="text-[10px] font-medium text-muted-foreground block mb-1">
            {ui.egDetailReq} {category !== 'custom' ? ui.egOptional : ui.egRequired}
          </label>
          <textarea
            value={customInstructions}
            onChange={e => setCustomInstructions(e.target.value)}
            disabled={generating}
            placeholder={
              category === 'conditional_entry'
                ? ui.egPhEntry
                : category === 'custom'
                ? ui.egPhCustom
                : ui.egPhExtra
            }
            rows={3}
            className="w-full px-2.5 py-1.5 text-[10px] rounded-lg border border-border bg-background
              focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y placeholder:text-muted-foreground/40"
          />
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={
          generating ||
          (!iterationMode && category === 'custom' && !customInstructions.trim()) ||
          (iterationMode && !currentEditorCode?.trim())
        }
        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium
          ${iterationMode
            ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500'
            : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500'
          } text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm`}
      >
        {generating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{loadingStatus || ui.egWorking}</span>
          </>
        ) : iterationMode ? (
          <>
            <Pencil className="w-3.5 h-3.5" />
            {ui.egFixWithAi}
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            {ui.egCreateWithAi}
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-400">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-2">
          {/* Strategy badge */}
          {result.strategy && (
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                result.strategy === 'getwi'
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                  : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              }`}>
                {result.strategy === 'getwi' ? '🅱️ getwi()' : '🅰️ activewi()'}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {fmt(ui.egWillDisable, { count: result.entryActions.filter(a => a.action === 'disable').length })}
              </span>
            </div>
          )}

          {/* Explanation */}
          {result.explanation && (
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5">
              <p className="text-[10px] text-emerald-400">{result.explanation}</p>
            </div>
          )}

          {/* Saved notification */}
          {savedEntryId !== null && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2 flex items-center gap-2">
              <BookPlus className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <p className="text-[10px] text-blue-400">
                {ui.egCreatedEntry} <strong>#{savedEntryId}</strong> — &quot;{result.entryComment}&quot;
              </p>
            </div>
          )}

          {/* Entry Actions Preview (for getwi strategy) */}
          {result.entryActions.length > 0 && !appliedActions && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 space-y-1.5">
              <p className="text-[10px] font-medium text-amber-400 flex items-center gap-1">
                <Shield className="w-3 h-3" />
                {fmt(ui.egEntriesToDisable, { count: result.entryActions.filter(a => a.action === 'disable').length })}
              </p>
              <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-0.5">
                {result.entryActions.filter(a => a.action === 'disable').slice(0, 30).map((action, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px]">
                    <span className="text-red-400">🔴</span>
                    <span className="text-muted-foreground truncate flex-1" title={action.comment}>
                      {action.comment}
                    </span>
                  </div>
                ))}
                {result.entryActions.filter(a => a.action === 'disable').length > 30 && (
                  <p className="text-[9px] text-muted-foreground">
                    {fmt(ui.egMoreEntries, { count: result.entryActions.filter(a => a.action === 'disable').length - 30 })}
                  </p>
                )}
              </div>
              <div className="flex gap-1 pt-1">
                <button
                  onClick={() => {
                    const updateEntry = useCardStore.getState().updateEntry;
                    // Save undo snapshot
                    const snapshot = new Map<number, boolean>();
                    for (const action of result.entryActions) {
                      if (action.action === 'disable') {
                        const entry = entries.find(e => e.comment === action.comment);
                        if (entry) {
                          snapshot.set(entry.id, entry.enabled);
                          updateEntry(entry.id, { enabled: false });
                        }
                      }
                    }
                    setUndoSnapshot(snapshot);
                    setAppliedActions(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                    bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                >
                  <Zap className="w-3 h-3" />
                  {ui.egApplyFull}
                </button>
              </div>
            </div>
          )}

          {/* Applied actions confirmation + Undo */}
          {appliedActions && (
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-2 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <p className="text-[10px] text-green-400 flex-1">
                {fmt(ui.egDisabled, { count: undoSnapshot?.size ?? 0 })}
              </p>
              {undoSnapshot && (
                <button
                  onClick={() => {
                    const updateEntry = useCardStore.getState().updateEntry;
                    for (const [id, wasEnabled] of undoSnapshot) {
                      updateEntry(id, { enabled: wasEnabled });
                    }
                    setUndoSnapshot(null);
                    setAppliedActions(false);
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium
                    text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <Undo2 className="w-3 h-3" />
                  {ui.egUndo}
                </button>
              )}
            </div>
          )}

          {/* Code preview */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border bg-muted/20 flex items-center gap-2">
              <span className="text-[10px] font-medium flex-1 truncate">
                {result.entryComment}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {fmt(ui.egLines, { count: result.code.split('\n').length })}
              </span>
            </div>
            <pre className="px-2.5 py-2 text-[9px] font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto scrollbar-thin bg-background/50">
              {result.code}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5">
            <button
              onClick={handleInsert}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium
                bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {ui.egInsertEditor}
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium
                bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? ui.egCopied : ui.egCopy}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-medium
                bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title={ui.egRegenerate}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
