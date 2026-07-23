/**
 * RegexLabPage — Module: Regex Lab (Phase 5)
 * Spec Phần 4.2: 2 cột — Editor (trái) + Live Preview (phải)
 * + Regex Copilot integration via buildRegexContext (Phase 11+)
 * + Iframe sandbox HTML preview, structure analysis, validation (Guide §5)
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Puzzle, Plus, Trash2, Copy, ChevronDown, ChevronRight, X, Check,
  ToggleLeft, ToggleRight, GripVertical, AlertTriangle,
  Eye, Code, Layers, FileCode, Braces, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useCardStore } from '../store/cardStore';
import { cn } from '../lib/utils';
import { applyRegex, applyAllRegex, validateRegex } from '../lib/regexEngine/applyRegex';
import { analyzeReplaceString, structureSummary } from '../lib/regexEngine/regexInjector';
import { renderSafeHtml, processCaptureGroups } from '../lib/regexEngine/renderSafeHtml';
import { stripHtmlFence } from '../lib/regexEngine/stripHtmlFence';
import { validateReplaceString } from '../lib/regexEngine/regexValidator';
import type { RegexScript, RegexPlacement } from '../types';
import { PLACEMENT_LABELS, SUBSTITUTE_REGEX_LABELS } from '../types';
import { t as ui, fmt } from '../i18n';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SCRIPT: Omit<RegexScript, 'id'> = {
  scriptName: '',
  findRegex: '',
  replaceString: '',
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: false,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
};

const SAMPLE_TEXTS: Record<string, string> = {
  ai_output: `*Cô ấy mỉm cười nhẹ, đôi mắt lấp lánh dưới ánh trăng.*\n\n"Em rất vui được gặp anh ở đây," cô ấy nói với giọng nhẹ nhàng.\n\n<UpdateVariable>\n[{"op":"replace","path":"/Trạng thái thế giới/Loại cảnh hiện tại","value":"Xã giao"}]\n</UpdateVariable>\n\n<details>\n<summary>Thinking...</summary>\nNhân vật đang trong trạng thái vui vẻ.\n</details>`,
  user_input: `{{user}}: Xin chào {{char}}! Hôm nay bạn thế nào?`,
  world_info: `[Khu vực: Rừng Cấm] Đây là khu rừng nguy hiểm, nơi cư ngụ của nhiều quái vật cấp S. Người chơi cần cẩn thận.`,
};

// ─── Main Page ──────────────────────────────────────────────────────────────

export function RegexLabPage() {
  const card = useCardStore(s => s.card);
  const updateCard = useCardStore(s => s.updateCard);

  const scripts = card.data.extensions.regex_scripts;

  const [selectedId, setSelectedId] = useState<string | null>(scripts[0]?.id ?? null);
  const [previewText, setPreviewText] = useState(SAMPLE_TEXTS.ai_output);
  const [previewSource, setPreviewSource] = useState<'ai_output' | 'user_input' | 'world_info'>('ai_output');

  const selectedScript = useMemo(() => scripts.find(s => s.id === selectedId) ?? null, [scripts, selectedId]);

  // ─── Script CRUD ────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    const id = uuidv4();
    updateCard(c => {
      c.data.extensions.regex_scripts.push({ ...DEFAULT_SCRIPT, id, scriptName: `Script #${c.data.extensions.regex_scripts.length + 1}` });
    });
    setSelectedId(id);
  }, [updateCard]);

  const handleDuplicate = useCallback((script: RegexScript) => {
    const id = uuidv4();
    updateCard(c => {
      c.data.extensions.regex_scripts.push({ ...structuredClone(script), id, scriptName: `${script.scriptName} (Copy)` });
    });
    setSelectedId(id);
  }, [updateCard]);

  const handleDelete = useCallback((id: string) => {
    const name = scripts.find(s => s.id === id)?.scriptName;
    if (!confirm(fmt(ui.rlConfirmDelete, { name: name ?? '' }))) return;
    updateCard(c => {
      c.data.extensions.regex_scripts = c.data.extensions.regex_scripts.filter(s => s.id !== id);
    });
    if (selectedId === id) setSelectedId(scripts.find(s => s.id !== id)?.id ?? null);
  }, [scripts, selectedId, updateCard]);

  const handleToggle = useCallback((id: string) => {
    updateCard(c => {
      const s = c.data.extensions.regex_scripts.find(s => s.id === id);
      if (s) s.disabled = !s.disabled;
    });
  }, [updateCard]);

  const handleUpdateScript = useCallback((id: string, patch: Partial<RegexScript>) => {
    updateCard(c => {
      const idx = c.data.extensions.regex_scripts.findIndex(s => s.id === id);
      if (idx !== -1) {
        c.data.extensions.regex_scripts[idx] = { ...c.data.extensions.regex_scripts[idx], ...patch };
      }
    });
  }, [updateCard]);

  // ─── Preview ────────────────────────────────────────────────────────

  const [previewMode, setPreviewMode] = useState<'all' | 'selected' | 'upto'>('selected');
  const activePreviewMode = selectedScript ? previewMode : 'all';
  const [outputTab, setOutputTab] = useState<'rendered' | 'template' | 'structure' | 'raw'>('rendered');

  // Auto-switch to 'selected' when clicking a different script
  const handleSelectScript = useCallback((id: string) => {
    setSelectedId(id);
    setPreviewMode('selected');
  }, []);

  const previewResult = useMemo(() => {
    if (activePreviewMode === 'selected' && selectedScript) {
      const res = applyRegex(selectedScript, previewText);
      return {
        result: res.result,
        steps: [{ scriptName: selectedScript.scriptName, matchCount: res.matchCount, error: res.error }]
      };
    }
    if (activePreviewMode === 'upto' && selectedScript) {
      const idx = scripts.findIndex(s => s.id === selectedScript.id);
      const subScripts = idx !== -1 ? scripts.slice(0, idx + 1) : scripts;
      return applyAllRegex(subScripts, previewText);
    }
    return applyAllRegex(scripts, previewText);
  }, [scripts, previewText, activePreviewMode, selectedScript]);

  // Structure analysis of the current result
  const resultStructure = useMemo(
    () => analyzeReplaceString(previewResult.result),
    [previewResult.result],
  );

  // (User 23/07 - bug 93) BOC FENCE truoc khi render. Card MVU goi giao dien trong khoi
  // ```html ... ``` va SillyTavern boc fence roi moi render. Truoc day Regex Lab nhet NGUYEN
  // chuoi (ke ca dau fence) vao iframe nen user thay chu "```html" chinh inh, phan HTML thi
  // hien nhu van ban - khong xem truoc duoc giao dien that.
  const previewFence = useMemo(
    () => stripHtmlFence(processCaptureGroups(previewResult.result)),
    [previewResult.result],
  );
  const iframeSrcDoc = useMemo(() => renderSafeHtml(previewFence.html), [previewFence.html]);

  // Safe HTML for template preview - only for selectedScript (with capture groups processed with dummy values)
  const templateFence = useMemo(
    () => (selectedScript ? stripHtmlFence(processCaptureGroups(selectedScript.replaceString)) : null),
    [selectedScript],
  );
  const templateIframeSrcDoc = useMemo(
    () => (templateFence ? renderSafeHtml(templateFence.html) : ''),
    [templateFence],
  );

  const handlePreviewSourceChange = useCallback((source: 'ai_output' | 'user_input' | 'world_info') => {
    setPreviewSource(source);
    setPreviewText(SAMPLE_TEXTS[source]);
  }, []);

  return (
    <div className="h-full flex overflow-hidden">
      {/* ═══════════ LEFT COLUMN: Script List + Editor ═══════════ */}
      <div className="w-1/2 flex flex-col border-r border-border">
        {/* Header */}
        <div className="shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">Regex Lab</h1>
            <span className="text-xs text-muted-foreground">({scripts.length})</span>
          </div>
          <button onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> {ui.rlAdd}
          </button>
        </div>

        {/* Script list */}
        <div className="shrink-0 max-h-[200px] overflow-y-auto scrollbar-thin border-b border-border">
          {scripts.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {ui.rlNoScript} <button onClick={handleAdd} className="text-primary hover:underline">{ui.rlCreateNew}</button>
            </div>
          ) : (
            scripts.map(s => (
              <div key={s.id} onClick={() => handleSelectScript(s.id)}
                className={`flex items-center gap-2 px-4 py-2 border-b border-border/50 cursor-pointer group transition-colors ${
                  s.id === selectedId ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/30'
                }`}>
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                <button onClick={e => { e.stopPropagation(); handleToggle(s.id); }} className="shrink-0">
                  {s.disabled
                    ? <ToggleLeft className="w-5 h-5 text-muted-foreground/40" />
                    : <ToggleRight className="w-5 h-5 text-emerald-400" />}
                </button>
                <span className={`flex-1 text-sm truncate ${s.disabled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {s.scriptName || 'Untitled'}
                </span>
                {/* Structure indicator badges */}
                {s.replaceString && (() => {
                  const struct = analyzeReplaceString(s.replaceString);
                  return (
                    <div className="flex gap-0.5 shrink-0">
                      {struct.hasStyle && <span className="px-1 py-0.5 rounded bg-violet-500/15 text-[9px] text-violet-400" title="Has CSS">CSS</span>}
                      {struct.hasScript && <span className="px-1 py-0.5 rounded bg-amber-500/15 text-[9px] text-amber-400" title="Has JS">JS</span>}
                      {struct.hasEjs && <span className="px-1 py-0.5 rounded bg-cyan-500/15 text-[9px] text-cyan-400" title="Has EJS">EJS</span>}
                    </div>
                  );
                })()}
                <div className="flex gap-0.5 shrink-0">
                  {s.placement.map(p => (
                    <span key={p} className="px-1 py-0.5 rounded bg-muted text-[9px] text-muted-foreground">{p}</span>
                  ))}
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={e => { e.stopPropagation(); handleDuplicate(s); }} className="p-1 text-muted-foreground hover:text-foreground" title="Copy">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(s.id); }} className="p-1 text-muted-foreground hover:text-destructive" title={ui.rlDelete}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Script editor */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {selectedScript ? (
            <RegexEditor script={selectedScript} onUpdate={patch => handleUpdateScript(selectedScript.id, patch)} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {ui.rlPickScript}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ RIGHT COLUMN: Live Preview ═══════════ */}
      <div className="w-1/2 flex flex-col">
        <div className="shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium">Live Preview</h2>
          </div>
          <div className="flex gap-1">
            {(['ai_output', 'user_input', 'world_info'] as const).map(src => (
              <button key={src} onClick={() => handlePreviewSourceChange(src)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  previewSource === src ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {src === 'ai_output' ? 'AI Output' : src === 'user_input' ? 'User Input' : 'World Info'}
              </button>
            ))}
          </div>
        </div>

        {/* Input text */}
        <div className="shrink-0 border-b border-border">
          <div className="px-4 py-1.5 bg-muted/30 text-xs text-muted-foreground font-medium flex items-center gap-1">
            <Code className="w-3 h-3" /> {ui.rlOriginalText}
          </div>
          <textarea value={previewText} onChange={e => setPreviewText(e.target.value)}
            rows={6} className="w-full px-4 py-2 bg-background text-xs font-mono leading-relaxed resize-none outline-none border-none" />
        </div>

        {/* Pipeline steps */}
        {previewResult.steps.length > 0 && (
          <div className="shrink-0 border-b border-border px-4 py-2 bg-muted/20">
            <div className="flex items-center gap-1 mb-1">
              <Layers className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-medium">Pipeline</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {previewResult.steps.map((step, i) => (
                <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${
                  step.error ? 'bg-destructive/10 text-destructive' :
                  step.matchCount > 0 ? 'bg-emerald-500/10 text-emerald-400' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step.error ? <AlertTriangle className="w-3 h-3" /> : step.matchCount > 0 ? <Check className="w-3 h-3" /> : null}
                  {step.scriptName || `Script ${i + 1}`}
                  {!step.error && <span className="opacity-60">({step.matchCount})</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Output — Tabbed: Rendered | Structure | Raw */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-4 py-1.5 bg-muted/30 text-[11px] text-muted-foreground font-medium flex items-center justify-between sticky top-0 z-10 shrink-0">
            <div className="flex items-center gap-2">
              {/* Output tab switcher */}
              <button onClick={() => setOutputTab('rendered')}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors",
                  (outputTab === 'template' && !selectedScript ? 'rendered' : outputTab) === 'rendered'
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                <Eye className="w-3 h-3" /> Rendered
              </button>
              {selectedScript && (
                <button onClick={() => setOutputTab('template')}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors",
                    outputTab === 'template' ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                  )}>
                  <Layers className="w-3 h-3" /> {ui.rlHtmlTemplate}
                </button>
              )}
              <button onClick={() => setOutputTab('structure')}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors",
                  (outputTab === 'template' && !selectedScript ? 'rendered' : outputTab) === 'structure'
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                <Braces className="w-3 h-3" /> Structure
              </button>
              <button onClick={() => setOutputTab('raw')}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors",
                  (outputTab === 'template' && !selectedScript ? 'rendered' : outputTab) === 'raw'
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                <FileCode className="w-3 h-3" /> Raw
              </button>
            </div>
            {/* Preview mode buttons */}
            <div className="flex gap-1">
              <button
                onClick={() => setPreviewMode('all')}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                  activePreviewMode === 'all' ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {ui.rlAllPipeline}
              </button>
              {selectedScript && (
                <>
                  <button
                    onClick={() => setPreviewMode('selected')}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                      activePreviewMode === 'selected' ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {ui.rlOnlySelected}
                  </button>
                  <button
                    onClick={() => setPreviewMode('upto')}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                      activePreviewMode === 'upto' ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {ui.rlUpToSelected}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {/* ── TAB: Rendered (iframe sandbox) ── */}
            {(outputTab === 'template' && !selectedScript ? 'rendered' : outputTab) === 'rendered' && (
              <div className="h-full relative">
                {previewResult.result === previewText && (
                  <div className="absolute top-2 right-2 z-20 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400" /> {ui.rlNoChange}
                  </div>
                )}
                {/* (bug 93) Trang thai fence — cho user biet dang xem dung thu ST se render */}
                {previewFence.hadFence && !previewFence.unclosed && (
                  <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/25 text-[10px] text-emerald-400"
                       title={ui.rlFenceOkTip}>
                    {ui.rlFenceOk}
                  </div>
                )}
                {previewFence.unclosed && (
                  <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 flex items-center gap-1"
                       title={ui.rlFenceUnclosedTip}>
                    <AlertTriangle className="w-3 h-3" /> {ui.rlFenceUnclosed}
                  </div>
                )}
                <iframe
                  key={`${selectedId}-${activePreviewMode}-rendered`}
                  title="Regex HTML Preview"
                  srcDoc={iframeSrcDoc}
                  sandbox="allow-scripts"
                  style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '240px',
                    border: 'none',
                    background: '#0f0f12',
                  }}
                />
              </div>
            )}

            {/* ── TAB: HTML Template ── */}
            {outputTab === 'template' && selectedScript && (
              <div className="h-full">
                <iframe
                  key={`${selectedScript.id}-template`}
                  title="Regex HTML Template Preview"
                  srcDoc={templateIframeSrcDoc}
                  sandbox="allow-scripts"
                  style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '240px',
                    border: 'none',
                    background: '#0f0f12',
                  }}
                />
              </div>
            )}

            {/* ── TAB: Structure analysis ── */}
            {(outputTab === 'template' && !selectedScript ? 'rendered' : outputTab) === 'structure' && (
              <div className="px-4 py-3 space-y-3">
                {/* Summary line */}
                <div className="px-3 py-2 rounded-lg bg-muted/30 border border-border text-xs font-mono text-muted-foreground">
                  {structureSummary(resultStructure)}
                </div>

                {/* HTML zones */}
                {resultStructure.htmlZones.length > 0 && (
                  <StructureSection title="HTML Zones" count={resultStructure.htmlZones.length} color="text-blue-400">
                    {resultStructure.htmlZones.map((z, i) => (
                      <ZoneBlock key={i} zone={z} label={`HTML #${i + 1}`} />
                    ))}
                  </StructureSection>
                )}

                {/* Style zones */}
                {resultStructure.styleZones.length > 0 && (
                  <StructureSection title="Style Blocks" count={resultStructure.styleZones.length} color="text-violet-400">
                    {resultStructure.styleZones.map((z, i) => (
                      <ZoneBlock key={i} zone={z} label={`<style> #${i + 1}`} />
                    ))}
                  </StructureSection>
                )}

                {/* Script zones */}
                {resultStructure.scriptZones.length > 0 && (
                  <StructureSection title="Script Blocks" count={resultStructure.scriptZones.length} color="text-amber-400">
                    {resultStructure.scriptZones.map((z, i) => (
                      <ZoneBlock key={i} zone={z} label={`<script> #${i + 1}`} />
                    ))}
                  </StructureSection>
                )}

                {/* EJS blocks */}
                {resultStructure.ejsBlocks.length > 0 && (
                  <StructureSection title="EJS Blocks" count={resultStructure.ejsBlocks.length} color="text-cyan-400">
                    {resultStructure.ejsBlocks.map((z, i) => (
                      <ZoneBlock key={i} zone={z} label={`<% %> #${i + 1}`} />
                    ))}
                  </StructureSection>
                )}

                {/* Functions */}
                {resultStructure.functions.length > 0 && (
                  <div>
                    <h4 className="text-[11px] text-muted-foreground font-medium mb-1.5">
                      Functions ({resultStructure.functions.length})
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {resultStructure.functions.map((fn, i) => (
                        <span key={i} className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-[10px] font-mono">
                          {fn.name}({fn.params.join(', ')})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Capture groups */}
                {resultStructure.captureGroups.length > 0 && (
                  <div>
                    <h4 className="text-[11px] text-muted-foreground font-medium mb-1.5">Capture Groups</h4>
                    <div className="flex gap-1.5">
                      {resultStructure.captureGroups.map(g => (
                        <span key={g} className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">{g}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* jQuery ready */}
                {resultStructure.jqueryReadyBlocks.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
                    <Check className="w-3 h-3" /> jQuery $(document).ready() detected
                  </div>
                )}
              </div>
            )}

            {/* ── TAB: Raw text ── */}
            {(outputTab === 'template' && !selectedScript ? 'rendered' : outputTab) === 'raw' && (
              <div className="px-4 py-3">
                <pre className="text-xs font-mono bg-background border border-border rounded-lg p-3 whitespace-pre-wrap text-muted-foreground overflow-x-auto">
                  {previewResult.result}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURE DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function StructureSection({ title, count, color, children }: {
  title: string; count: number; color: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[11px] font-medium mb-1.5 ${color} hover:opacity-80 transition-opacity`}>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title} ({count})
      </button>
      {open && <div className="space-y-1.5 ml-2">{children}</div>}
    </div>
  );
}

function ZoneBlock({ zone, label }: { zone: { content: string }; label: string }) {
  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="px-2 py-1 bg-muted/30 text-[9px] text-muted-foreground font-medium">{label}</div>
      <pre className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap max-h-[120px] overflow-y-auto scrollbar-thin">
        {zone.content.length > 500 ? zone.content.slice(0, 500) + '\n...' : zone.content}
      </pre>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// REGEX EDITOR — left panel bottom
// ═══════════════════════════════════════════════════════════════════════════

function RegexEditor({ script, onUpdate }: {
  script: RegexScript;
  onUpdate: (patch: Partial<RegexScript>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [trimInput, setTrimInput] = useState('');
  const validation = useMemo(() => validateRegex(script.findRegex), [script.findRegex]);

  // Structure analysis & validation for replaceString
  const replaceStructure = useMemo(
    () => script.replaceString ? analyzeReplaceString(script.replaceString) : null,
    [script.replaceString],
  );
  const replaceValidation = useMemo(
    () => script.replaceString ? validateReplaceString(script.replaceString) : null,
    [script.replaceString],
  );

  const togglePlacement = useCallback((p: RegexPlacement) => {
    const current = script.placement;
    if (current.includes(p)) {
      onUpdate({ placement: current.filter(v => v !== p) });
    } else {
      onUpdate({ placement: [...current, p].sort() });
    }
  }, [script.placement, onUpdate]);

  return (
    <div className="p-5 space-y-4">
      {/* Script name */}
      <div>
        <label className="settings-label">{ui.rlScriptName}</label>
        <input type="text" value={script.scriptName} onChange={e => onUpdate({ scriptName: e.target.value })}
          className="settings-input" placeholder={ui.rlScriptNamePh} />
      </div>

      {/* Find regex */}
      <div>
        <label className="settings-label">Find Regex</label>
        <input type="text" value={script.findRegex} onChange={e => onUpdate({ findRegex: e.target.value })}
          className={`settings-input font-mono text-xs ${!validation.valid && script.findRegex ? 'border-destructive/50 focus:ring-destructive/30' : ''}`}
          placeholder={ui.rlFindPh} />
        {!validation.valid && script.findRegex && (
          <p className="text-xs text-destructive mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {validation.error}
          </p>
        )}
      </div>

      {/* Replace string */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="settings-label mb-0">Replace String</label>
          {/* Validation badge */}
          {replaceValidation && (
            <span className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
              replaceValidation.valid
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-destructive/10 text-destructive"
            )}>
              {replaceValidation.valid
                ? <><CheckCircle2 className="w-3 h-3" /> Valid</>
                : <><XCircle className="w-3 h-3" /> {replaceValidation.jsIssues.length + replaceValidation.htmlIssues.length} issues</>}
            </span>
          )}
        </div>
        <textarea value={script.replaceString} onChange={e => onUpdate({ replaceString: e.target.value })}
          rows={4} className="settings-input font-mono text-xs leading-relaxed resize-y"
          placeholder={ui.rlReplacePh} />

        {/* Structure summary */}
        {replaceStructure && (
          <div className="mt-1.5 px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/50 text-[10px] text-muted-foreground font-mono">
            {structureSummary(replaceStructure)}
          </div>
        )}

        {/* Validation issues */}
        {replaceValidation && !replaceValidation.valid && (
          <div className="mt-1.5 space-y-1">
            {[...replaceValidation.jsIssues, ...replaceValidation.htmlIssues].map((issue, i) => (
              <p key={i} className={`text-[10px] flex items-center gap-1 ${
                issue.type === 'error' ? 'text-destructive' : 'text-amber-400'
              }`}>
                {issue.type === 'error'
                  ? <XCircle className="w-3 h-3 shrink-0" />
                  : <AlertCircle className="w-3 h-3 shrink-0" />}
                {issue.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Placement */}
      <div>
        <label className="settings-label">{ui.rlPlacement}</label>
        <div className="flex flex-wrap gap-1.5">
          {([1, 2, 3, 4, 5] as RegexPlacement[]).map(p => (
            <button key={p} onClick={() => togglePlacement(p)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                script.placement.includes(p)
                  ? 'bg-primary/15 text-primary border border-primary/25'
                  : 'bg-muted text-muted-foreground border border-border hover:text-foreground'
              }`}>
              {PLACEMENT_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={script.markdownOnly} onChange={e => onUpdate({ markdownOnly: e.target.checked })}
            className="settings-checkbox" /> Markdown Only
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={script.promptOnly} onChange={e => onUpdate({ promptOnly: e.target.checked })}
            className="settings-checkbox" /> Prompt Only
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={script.runOnEdit} onChange={e => onUpdate({ runOnEdit: e.target.checked })}
            className="settings-checkbox" /> Run on Edit
        </label>
        <div>
          <label className="settings-label mb-0">Substitute Regex</label>
          <select value={script.substituteRegex} onChange={e => onUpdate({ substituteRegex: Number(e.target.value) as 0|1|2 })}
            className="settings-input text-xs mt-1">
            {Object.entries(SUBSTITUTE_REGEX_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {/* Trim strings */}
      <div>
        <label className="settings-label">Trim Strings</label>
        <div className="flex gap-2 mb-2">
          <input type="text" value={trimInput} onChange={e => setTrimInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && trimInput.trim()) {
                e.preventDefault();
                onUpdate({ trimStrings: [...script.trimStrings, trimInput.trim()] });
                setTrimInput('');
              }
            }}
            className="settings-input flex-1 text-xs" placeholder="String to trim, Enter to add" />
        </div>
        {script.trimStrings.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {script.trimStrings.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground font-mono">
                {t}
                <button onClick={() => onUpdate({ trimStrings: script.trimStrings.filter((_, j) => j !== i) })} className="hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Advanced */}
      <div className="rounded-lg border border-border overflow-hidden">
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
          Depth Filter
          {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 pt-3 border-t border-border grid grid-cols-2 gap-3">
            <div>
              <label className="settings-label">Min Depth</label>
              <input type="number" value={script.minDepth ?? ''} placeholder="null"
                onChange={e => onUpdate({ minDepth: e.target.value ? parseInt(e.target.value) : null })}
                className="settings-input text-xs" min={0} />
            </div>
            <div>
              <label className="settings-label">Max Depth</label>
              <input type="number" value={script.maxDepth ?? ''} placeholder="null"
                onChange={e => onUpdate({ maxDepth: e.target.value ? parseInt(e.target.value) : null })}
                className="settings-input text-xs" min={0} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
