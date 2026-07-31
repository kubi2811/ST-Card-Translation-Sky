/**
 * EJSStudioPage — Upgraded 3-Panel EJS & Script Studio
 * Panel 1: Entry selector / File tree (left sidebar)
 * Panel 2: Code editor (center)
 * Panel 3: Preview + Analysis (right)
 *
 * Spec 8B + 8C + Reference: EJS实战指南_2026_ZOD版.md
 */

import { useState, useMemo, useCallback } from 'react';
import {
  ScrollText, FileCode, Microscope, ChevronDown, Eye,
  PanelLeftClose, PanelRightClose, BookOpen,
  Sparkles, Code2, Layers, Check, Bot, Library, Plus, Trash2
} from 'lucide-react';
import { useCardStore } from '../store/cardStore';
import { EJSEditor } from '../components/ejs/EJSEditor';
import { EJSPreviewPanel } from '../components/ejs/EJSPreviewPanel';
import { EJS_SNIPPETS } from '../components/ejs/ejsSnippets';
import { JSAnalyzerPanel } from '../components/ejs/JSAnalyzerPanel';
import { EJSAIGenerator } from '../components/ejs/EJSAIGenerator';
import { EJSAgentPanel } from '../components/ejs/EJSAgentPanel';
import { EJSTemplateLibrary } from '../components/ejs/EJSTemplateLibrary';
import type { MVUZODSchema } from '../types/mvuzod.types';
import type { TavernHelperScript } from '../types/tavernHelper.types';
import { isPreprocessingEntry } from '../lib/ejs/ejsParser';
import { t as ui, fmt } from '../i18n';

type ActiveView = 'ejs' | 'analyzer';
type RightPanel = 'preview' | 'analysis' | 'reference' | 'ai_generate' | 'library';
/** (Goal 101) 'agent' = AI tự quyết (mặc định); 'advanced' = studio 3 panel chỉnh tay cũ. */
type StudioMode = 'agent' | 'advanced';

const SAMPLE_EJS = `@@preprocessing
<%_
// Đọc biến từ stat_data (TavernHelper variables)
if (typeof _era === 'undefined') var _era = getvar('stat_data.Trạng thái thế giới.Thời đại hiện tại', { defaults: 'Đấu 1' });
if (typeof _sType === 'undefined') var _sType = getvar('stat_data.Trạng thái thế giới.Loại cảnh hiện tại', { defaults: 'Hàng ngày' });

// Kích hoạt/tắt entries theo era
// activateEntry(id, bool) hoặc setEntryEnabled(comment, bool)
_%>`;

const SAMPLE_JS = `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const schema = z.object({
  "Trạng thái thế giới": z.object({
    "Thời đại hiện tại": z.string().prefault('Chờ khởi tạo'),
    "Loại cảnh hiện tại": z.string().prefault('Hàng ngày'),
  }).prefault({}),
}).prefault({});

registerMvuSchema('stat_data', schema);

on("message_received", (msg) => {
  const patches = extractPatches(msg.content);
  // Apply patches to state...
});`;

// ─── Built-in function reference ────────────────────────────────────────

const BUILTIN_FUNCTIONS = [
  { group: ui.esGroupVars, funcs: [
    { name: 'getvar(key, opts)', desc: ui.esFnGetvar, example: "getvar('stat_data.HP', { defaults: 100 })" },
    { name: 'setvar(key, value)', desc: ui.esFnSetvar, example: "setvar('stat_data.HP', 80)" },
    { name: 'getMvuData(opts)', desc: ui.esFnGetMvuData, example: "Mvu.getMvuData({type:'message',message_id:'latest'})" },
  ]},
  { group: ui.esGroupOutput, funcs: [
    { name: 'print(text)', desc: ui.esFnPrint, example: "print('Hello World')" },
    { name: '<%= expr %>', desc: ui.esFnEq, example: "<%= getvar('stat_data.HP') %>" },
    { name: '<%- html %>', desc: ui.esFnRaw, example: "<%- '<b>Bold</b>' %>" },
  ]},
  { group: ui.esGroupWorldbook, funcs: [
    { name: 'getwi(comment)', desc: ui.esFnGetwi, example: "getwi('Kỹ năng')" },
    { name: 'activateEntry(id, bool)', desc: ui.esFnActivateEntry, example: "activateEntry(42, true)" },
    { name: 'setEntryEnabled(comment, bool)', desc: ui.esFnSetEntryEnabled, example: "setEntryEnabled('WB: Cổ đại', false)" },
    { name: 'setEntryContent(comment, text)', desc: ui.esFnSetEntryContent, example: "setEntryContent('Dynamic', 'text...')" },
  ]},
  { group: ui.esGroupInjection, funcs: [
    { name: 'injectPrompt(key, text, order)', desc: ui.esFnInjectPrompt, example: "injectPrompt('nhom', '...', 10) + <%- getPromptsInjected('nhom') %> — KHÔNG có position/depth; in tại chỗ thì dùng print()" },
  ]},
  { group: ui.esGroupChat, funcs: [
    { name: 'getChatMessages(idx, role)', desc: ui.esFnGetChatMessages, example: "getChatMessages(-1, 'assistant')" },
  ]},
  { group: ui.esGroupConstants, funcs: [
    { name: 'CHARS_COUNT', desc: ui.esFnCharsCount, example: 'CHARS_COUNT' },
    { name: 'CHAT_ID', desc: ui.esFnChatId, example: 'CHAT_ID' },
    { name: 'MESSAGE_ID', desc: ui.esFnMessageId, example: 'MESSAGE_ID' },
  ]},
];

// ─── Main Component ─────────────────────────────────────────────────────

export function EJSStudioPage() {
  const card = useCardStore(s => s.card);
  const updateEntry = useCardStore(s => s.updateEntry);
  const addTavernScript = useCardStore(s => s.addTavernScript);
  const updateTavernScript = useCardStore(s => s.updateTavernScript);
  const deleteTavernScript = useCardStore(s => s.deleteTavernScript);

  const [mode, setMode] = useState<StudioMode>('agent');
  const [activeView, setActiveView] = useState<ActiveView>('ejs');
  const [rightPanel, setRightPanel] = useState<RightPanel>('preview');
  const [ejsContent, setEjsContent] = useState(SAMPLE_EJS);
  const [jsContent, setJsContent] = useState(SAMPLE_JS);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedScriptIdx, setSelectedScriptIdx] = useState<number | null>(null);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  // Get schema from card
  const schema: MVUZODSchema | null = useMemo(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown> | undefined;
    return (ext?.mvuzod as Record<string, unknown>)?.schema as MVUZODSchema ?? null;
  }, [card.data.extensions]);

  // Find EJS entries & TavernHelper scripts
  const entries = useMemo(() => card.data.character_book?.entries ?? [], [card.data.character_book?.entries]);
  const ejsEntries = useMemo(() => entries.filter(e => isPreprocessingEntry(e.content)), [entries]);
  const scripts = useMemo(() => card.data.extensions?.tavern_helper?.scripts ?? [], [card.data.extensions]);

  // Handle entry selection
  const handleSelectEntry = useCallback((id: number) => {
    const entry = entries.find(e => e.id === id);
    if (entry) {
      setEjsContent(entry.content);
      setSelectedEntryId(id);
      setSelectedScriptIdx(null);
      setActiveView('ejs');
      setIsDirty(false);
    }
  }, [entries]);

  // Handle script selection
  const handleSelectScript = useCallback((idx: number) => {
    const script = scripts[idx] as TavernHelperScript | undefined;
    if (script) {
      // Load only the JS content field, not the entire script object
      setJsContent(script.content ?? '');
      setSelectedScriptIdx(idx);
      setSelectedEntryId(null);
      setActiveView('analyzer');
      setIsDirty(false);
    }
  }, [scripts]);

  // Save back to entry
  const handleSaveToEntry = useCallback(() => {
    if (selectedEntryId === null) return;
    updateEntry(selectedEntryId, { content: ejsContent });
    setIsDirty(false);
  }, [selectedEntryId, ejsContent, updateEntry]);

  // Save back to script — only update the content field
  const handleSaveToScript = useCallback(() => {
    if (selectedScriptIdx === null) return;
    updateTavernScript(selectedScriptIdx, { content: jsContent });
    setIsDirty(false);
  }, [selectedScriptIdx, jsContent, updateTavernScript]);

  // Add new script
  const handleAddScript = useCallback(() => {
    addTavernScript({
      type: 'script',
      enabled: true,
      name: `New Script ${scripts.length + 1}`,
      id: crypto.randomUUID(),
      content: '',
      info: '',
      button: { enabled: false, buttons: [] },
      data: {}
    });
  }, [addTavernScript, scripts.length]);

  // Delete script
  const handleDeleteScript = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this script?")) {
      deleteTavernScript(idx);
      if (selectedScriptIdx === idx) {
        setJsContent('');
        setSelectedScriptIdx(null);
        setIsDirty(false);
      } else if (selectedScriptIdx !== null && selectedScriptIdx > idx) {
        setSelectedScriptIdx(selectedScriptIdx - 1);
      }
    }
  }, [deleteTavernScript, selectedScriptIdx]);

  // Insert snippet
  const handleInsertSnippet = useCallback((code: string) => {
    setEjsContent(code);
    setActiveView('ejs');
    setIsDirty(true);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-2 shrink-0">
        <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/10">
          <ScrollText className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            EJS & Script Studio
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">v2.0</span>
          </h1>
          <p className="text-xs text-muted-foreground truncate">
            @@preprocessing • EJS templates • TavernHelper JS • Built-in functions
          </p>
        </div>

        {/* Mode toggle: AI tự quyết (mặc định) vs Nâng cao (chỉnh tay) */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/30 p-0.5">
          <button onClick={() => setMode('agent')}
            title="Chỉ cần gõ yêu cầu — AI tự lên kế hoạch, sinh code, tự kiểm và tự sửa"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
              mode === 'agent' ? 'bg-emerald-500/15 text-emerald-400 shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}>
            <Bot className="w-3 h-3" /> AI tự quyết
          </button>
          <button onClick={() => setMode('advanced')}
            title="Studio 3 panel đầy đủ: editor, preview, analyzer, template — chỉnh tay từng khối"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
              mode === 'advanced' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}>
            <Code2 className="w-3 h-3" /> Nâng cao
          </button>
        </div>

        {/* Panel toggles */}
        <div className="flex items-center gap-1">
          <button onClick={() => setShowLeftPanel(!showLeftPanel)}
            disabled={mode === 'agent'}
            title="Toggle left panel"
            className={`p-1.5 rounded-lg transition-colors ${showLeftPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}>
            <PanelLeftClose className="w-4 h-4" />
          </button>
          <button onClick={() => setShowRightPanel(!showRightPanel)}
            title="Toggle right panel"
            className={`p-1.5 rounded-lg transition-colors ${showRightPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}>
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border shrink-0" />

      {/* ═══ MODE: AI tự quyết (Goal 101 — mặc định) ═══ */}
      {mode === 'agent' && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <EJSAgentPanel
            schema={schema}
            onOpenInEditor={(code) => {
              setEjsContent(code);
              setSelectedEntryId(null);
              setActiveView('ejs');
              setIsDirty(true);
              setMode('advanced');
            }}
          />
        </div>
      )}

      {/* 3-Panel Layout (Nâng cao) */}
      {mode === 'advanced' && (
      <div className="flex-1 flex overflow-hidden">
        {/* ═══ LEFT PANEL: File Tree ═══ */}
        {showLeftPanel && (
          <div className="w-56 shrink-0 border-r border-border bg-card/30 flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border bg-muted/10">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Files
              </span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-3">
              {/* EJS Entries */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase px-1 mb-1 flex items-center gap-1">
                  <Code2 className="w-3 h-3" /> EJS Entries ({ejsEntries.length})
                </div>
                {ejsEntries.map(e => (
                  <button key={e.id}
                    onClick={() => handleSelectEntry(e.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-[10px] truncate transition-colors ${
                      selectedEntryId === e.id && activeView === 'ejs'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <FileCode className="w-3 h-3 shrink-0" />
                      <span className="truncate">{e.comment || `#${e.id}`}</span>
                    </div>
                  </button>
                ))}
                {ejsEntries.length === 0 && (
                  <p className="text-[9px] text-muted-foreground/50 px-2 py-1">{ui.esNoEjsEntry}</p>
                )}
              </div>

              {/* Scripts */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase px-1 mb-1 flex items-center gap-1 justify-between">
                  <div className="flex items-center gap-1">
                    <Layers className="w-3 h-3" /> TH Scripts ({scripts.length})
                  </div>
                  <button onClick={handleAddScript}
                    title="Add TH Script"
                    className="p-1 hover:bg-muted/80 rounded transition-colors text-primary">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {scripts.map((script, idx) => (
                  <div key={idx} className="group relative w-full flex items-center">
                    <button
                      onClick={() => handleSelectScript(idx)}
                      className={`flex-1 text-left px-2 py-1.5 rounded-md text-[10px] truncate transition-colors pr-6 ${
                        selectedScriptIdx === idx && activeView === 'analyzer'
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}>
                      <div className="flex items-center gap-1.5">
                        <Microscope className="w-3 h-3 shrink-0" />
                        <span className="truncate">{(script as TavernHelperScript).name || `Script #${idx + 1}`}</span>
                      </div>
                    </button>
                    <button onClick={(e) => handleDeleteScript(idx, e)}
                      title="Delete script"
                      className="absolute right-1 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {scripts.length === 0 && (
                  <p className="text-[9px] text-muted-foreground/50 px-2 py-1">{ui.esNoScript}</p>
                )}
              </div>

              {/* Snippets */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase px-1 mb-1 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> Snippets
                </div>
                {EJS_SNIPPETS.map(s => (
                  <button key={s.id}
                    onClick={() => handleInsertSnippet(s.code)}
                    className="w-full text-left px-2 py-1.5 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 shrink-0 text-amber-400/60" />
                      <span className="truncate">{s.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ CENTER PANEL: Code Editor ═══ */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Editor mode tabs */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
            <button onClick={() => setActiveView('ejs')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                activeView === 'ejs' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <FileCode className="w-3 h-3" /> EJS Editor
            </button>
            <button onClick={() => setActiveView('analyzer')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                activeView === 'analyzer' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <Microscope className="w-3 h-3" /> JS Analyzer
            </button>

            <div className="flex-1" />

            {/* Save button */}
            {activeView === 'ejs' && selectedEntryId !== null && isDirty && (
              <button onClick={handleSaveToEntry}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Check className="w-3 h-3" /> {fmt(ui.esSaveToEntry, { id: selectedEntryId })}
              </button>
            )}
            {activeView === 'analyzer' && selectedScriptIdx !== null && isDirty && (
              <button onClick={handleSaveToScript}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Check className="w-3 h-3" /> {ui.esSaveScript}{(scripts[selectedScriptIdx] as TavernHelperScript)?.name || `#${selectedScriptIdx + 1}`}
              </button>
            )}
          </div>

          {/* Editor content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
            {activeView === 'ejs' && (
              <EJSEditor
                content={ejsContent}
                onChange={(v) => { setEjsContent(v); setIsDirty(true); }}
                schema={schema}
              />
            )}
            {activeView === 'analyzer' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-background overflow-hidden">
                  <div className="px-4 py-2 border-b border-border bg-muted/20">
                    <span className="text-xs font-medium">TavernHelper Script (JS)</span>
                  </div>
                  <textarea
                    value={jsContent}
                    onChange={e => { setJsContent(e.target.value); setIsDirty(true); }}
                    rows={14}
                    spellCheck={false}
                    className="w-full px-4 py-3 bg-transparent text-xs font-mono resize-y
                      focus:outline-none leading-relaxed"
                    style={{ tabSize: 2 }}
                  />
                </div>
                <JSAnalyzerPanel code={jsContent} schema={schema} />
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT PANEL: Preview + Analysis ═══ */}
        {showRightPanel && (
          <div className="w-80 shrink-0 border-l border-border bg-card/30 flex flex-col overflow-hidden">
            {/* Right panel tabs */}
            <div className="flex gap-0.5 p-1.5 border-b border-border bg-muted/10 shrink-0">
              {([
                { id: 'preview', label: 'Preview', icon: Eye },
                { id: 'reference', label: 'Reference', icon: BookOpen },
                { id: 'ai_generate', label: 'AI Generate', icon: Bot },
                { id: 'library', label: 'Templates', icon: Library },
              ] as const).map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.id}
                    onClick={() => setRightPanel(t.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      rightPanel === t.id
                        ? t.id === 'ai_generate'
                          ? 'bg-emerald-500/10 text-emerald-400 shadow-sm'
                          : 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}>
                    <Icon className="w-3 h-3" /> {t.label}
                  </button>
                );
              })}
            </div>

            {/* Right panel content */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
              {rightPanel === 'preview' && (
                <EJSPreviewPanel content={activeView === 'ejs' ? ejsContent : jsContent} schema={schema} />
              )}
              {rightPanel === 'reference' && (
                <BuiltinReference />
              )}
              {rightPanel === 'ai_generate' && (
                <EJSAIGenerator
                  schema={schema}
                  currentEditorCode={activeView === 'ejs' ? ejsContent : undefined}
                  onInsertCode={(code) => {
                    setEjsContent(code);
                    setActiveView('ejs');
                    setIsDirty(true);
                  }}
                />
              )}
              {rightPanel === 'library' && (
                <EJSTemplateLibrary
                  onInsertCode={(code) => {
                    setEjsContent(code);
                    setActiveView('ejs');
                    setIsDirty(true);
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Built-in Function Reference ────────────────────────────────────────

function BuiltinReference() {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(BUILTIN_FUNCTIONS[0].group);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold flex items-center gap-1.5 mb-3">
        <BookOpen className="w-3.5 h-3.5 text-primary" />
        Built-in Functions Reference
      </div>

      {BUILTIN_FUNCTIONS.map(group => (
        <div key={group.group} className="rounded-lg border border-border overflow-hidden">
          <button onClick={() => setExpandedGroup(expandedGroup === group.group ? null : group.group)}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium hover:bg-muted/30 transition-colors">
            {expandedGroup === group.group ? <ChevronDown className="w-3 h-3" /> : <ChevronDown className="w-3 h-3 -rotate-90" />}
            {group.group}
            <span className="text-muted-foreground/50 ml-auto">{group.funcs.length}</span>
          </button>

          {expandedGroup === group.group && (
            <div className="px-3 pb-3 space-y-2">
              {group.funcs.map((func, i) => (
                <div key={i} className="rounded-md bg-muted/20 p-2">
                  <code className="text-[10px] font-mono text-primary block">{func.name}</code>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{func.desc}</p>
                  <code className="text-[9px] font-mono text-muted-foreground/60 mt-1 block bg-background/50 rounded px-1.5 py-0.5">
                    {func.example}
                  </code>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Warnings */}
      <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-1.5 mt-4">
        <p className="text-[10px] font-medium text-amber-400">{ui.esWarnTitle}</p>
        <p className="text-[9px] text-amber-400/80">{ui.esWarn1a} <code>this.variables</code> {ui.esWarn1b} <code>getvar()</code></p>
        <p className="text-[9px] text-amber-400/80">{ui.esWarn2a}<code>.</code>{ui.esWarn2b}<code>/</code>{ui.esWarn2c}</p>
        <p className="text-[9px] text-amber-400/80">{ui.esWarn3a} <strong>{ui.esWarn3b}</strong> {ui.esWarn3c}</p>
        <p className="text-[9px] text-amber-400/80">{ui.esWarn4a} <strong>{ui.esWarn4b}</strong> {ui.esWarn4c}</p>
      </div>
    </div>
  );
}
