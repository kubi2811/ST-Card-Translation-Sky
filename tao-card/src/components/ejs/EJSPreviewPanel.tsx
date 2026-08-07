/**
 * EJSPreviewPanel — Live preview for EJS templates
 * Shows rendered output with mock variables, toggleable between raw/rendered views
 * References: EJS实战指南_2026_ZOD版.md "验证和调试"
 */

import { useState, useMemo } from 'react';
import {
  Eye, Plus, Trash2,
  ChevronDown, ChevronRight,
  Variable, Bookmark,
} from 'lucide-react';
import { parseEJS } from '../../lib/ejs/ejsParser';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';

import { EJS_SNIPPETS } from './ejsSnippets';
import { t as ui, fmt } from '../../i18n';
import { copyWithToast } from '../../lib/copyToClipboard';   // (bug 224) copy chạy được cả trong iframe của Hub
import { useToastStore } from '../../store/toastStore';

// ─── Mock Variable Manager ──────────────────────────────────────────────

interface MockVariable {
  key: string;
  value: string;
}

function MockVariableManager({ variables, onChange }: {
  variables: MockVariable[];
  onChange: (vars: MockVariable[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card/50">
      <button onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/30 transition-colors">
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Variable className="w-3 h-3 text-primary" />
        Mock Variables ({variables.length})
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5">
          {variables.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={v.key}
                onChange={e => {
                  const updated = [...variables];
                  updated[i] = { ...updated[i], key: e.target.value };
                  onChange(updated);
                }}
                placeholder="stat_data.X.Y"
                className="flex-1 min-w-0 px-2 py-1 text-[10px] font-mono rounded border border-border bg-background
                  focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <span className="text-[10px] text-muted-foreground">=</span>
              <input
                value={v.value}
                onChange={e => {
                  const updated = [...variables];
                  updated[i] = { ...updated[i], value: e.target.value };
                  onChange(updated);
                }}
                placeholder="value"
                className="w-20 px-2 py-1 text-[10px] font-mono rounded border border-border bg-background
                  focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <button onClick={() => onChange(variables.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-red-400 transition-colors p-0.5">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={() => onChange([...variables, { key: '', value: '' }])}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors">
            <Plus className="w-3 h-3" /> {ui.epAddMockVar}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Mock Worldbook Manager ─────────────────────────────────────────────

interface MockWorldbookEntry {
  comment: string;
  content: string;
}

function MockWorldbookManager({ entries, onChange }: {
  entries: MockWorldbookEntry[];
  onChange: (entries: MockWorldbookEntry[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="rounded-lg border border-border bg-card/50">
      <button onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/30 transition-colors">
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Bookmark className="w-3 h-3 text-amber-400" />
        Mock Worldbook ({entries.length})
        <span className="text-[9px] text-muted-foreground ml-auto">getwi() mock</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {entries.map((entry, i) => (
            <div key={i} className="space-y-1 p-2 rounded-md bg-muted/20 border border-border/50">
              <div className="flex items-center gap-1.5">
                <input
                  value={entry.comment}
                  onChange={e => {
                    const updated = [...entries];
                    updated[i] = { ...updated[i], comment: e.target.value };
                    onChange(updated);
                  }}
                  placeholder={ui.epEntryCommentPh}
                  className="flex-1 min-w-0 px-2 py-1 text-[10px] font-mono rounded border border-border bg-background
                    focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button onClick={() => onChange(entries.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-red-400 transition-colors p-0.5">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <textarea
                value={entry.content}
                onChange={e => {
                  const updated = [...entries];
                  updated[i] = { ...updated[i], content: e.target.value };
                  onChange(updated);
                }}
                placeholder={ui.epEntryContentPh}
                rows={2}
                className="w-full px-2 py-1 text-[10px] font-mono rounded border border-border bg-background
                  focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
              />
            </div>
          ))}
          <button onClick={() => onChange([...entries, { comment: '', content: '' }])}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors">
            <Plus className="w-3 h-3" /> {ui.epAddMockEntry}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function EJSPreviewPanel({ content, schema }: {
  content: string;
  schema: MVUZODSchema | null;
}) {
  const [viewMode, setViewMode] = useState<'rendered' | 'raw' | 'tokens'>('rendered');
  const [mockVariables, setMockVariables] = useState<MockVariable[]>(() => {
    // Auto-populate from schema if available
    if (!schema) return [{ key: 'stat_data.HP', value: '50' }];
    const vars: MockVariable[] = [];
    function collect(fields: MVUZODField[], prefix: string) {
      for (const f of fields) {
        const name = f.path.split('/').filter(Boolean).pop() ?? f.path;
        const path = prefix ? `${prefix}.${name}` : name;
        if (f.children?.length) {
          collect(f.children, path);
        } else {
          vars.push({
            key: `stat_data.${path}`,
            value: String(f.defaultValue ?? (f.type === 'number' ? '50' : 'Sample')),
          });
        }
      }
    }
    collect(schema.fields, '');
    return vars.slice(0, 10); // max 10 initially
  });

  const [mockWorldbook, setMockWorldbook] = useState<MockWorldbookEntry[]>([
    { comment: 'Danh sách kỹ năng', content: 'Kiếm thuật Lv.3\nPhòng thủ Lv.2' },
  ]);

  const tokens = useMemo(() => parseEJS(content), [content]);

  // Simulate rendering (with getwi() + getvar() support)
  const renderedOutput = useMemo(() => {
    const varMap = new Map(mockVariables.filter(v => v.key).map(v => [v.key, v.value]));
    const wbMap = new Map(mockWorldbook.filter(e => e.comment).map(e => [e.comment, e.content]));

    return tokens.map(token => {
      switch (token.type) {
        case 'literal':
          return token.value;
        case 'expression': {
          // Try to resolve getvar() calls
          const getvarMatch = token.value.match(/getvar\s*\(\s*['"]([^'"]+)['"]/);
          if (getvarMatch) {
            const path = getvarMatch[1];
            return varMap.get(path) ?? `{${path}}`;
          }
          return `<%= ${token.value} %>`;
        }
        case 'raw_expression':
          return `<%- ${token.value} %>`;
        case 'statement': {
          // Check for getwi() calls
          const getwiMatch = token.value.match(/getwi\s*\(\s*['"]([^'"]+)['"]\s*\)/);
          if (getwiMatch) {
            const name = getwiMatch[1];
            const content = wbMap.get(name);
            if (content) return content;
            return `[getwi: "${name}" not found]`;
          }

          // Check for print() calls
          const printMatch = token.value.match(/print\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/);
          if (printMatch) return printMatch[1];

          // Check for print(getwi()) pattern
          const printGetwiMatch = token.value.match(/print\s*\(\s*getwi\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/);
          if (printGetwiMatch) {
            const name = printGetwiMatch[1];
            return wbMap.get(name) ?? `[getwi: "${name}" not found]`;
          }

          // Check for conditional print
          if (token.value.includes('print(') || token.value.includes('print (')) {
            return ''; // Complex print — skip in simple preview
          }
          return ''; // Statements don't produce output
        }
        case 'directive':
          return ''; // @@preprocessing directive
        case 'comment':
          return ''; // Comments hidden
        default:
          return '';
      }
    }).join('');
  }, [tokens, mockVariables, mockWorldbook]);

  return (
    <div className="space-y-3">
      {/* View mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-0.5 p-0.5 rounded-md bg-muted/50">
          {(['rendered', 'raw', 'tokens'] as const).map(mode => (
            <button key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                viewMode === mode ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {mode === 'rendered' ? '👁 Rendered' : mode === 'raw' ? '</> Raw' : '🔬 Tokens'}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          {tokens.some(t => t.type === 'directive') && (
            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">@@preprocessing</span>
          )}
          <span>{tokens.length} tokens</span>
        </div>
      </div>

      {/* Mock variables */}
      <MockVariableManager variables={mockVariables} onChange={setMockVariables} />

      {/* Mock worldbook entries (getwi) */}
      <MockWorldbookManager entries={mockWorldbook} onChange={setMockWorldbook} />

      {/* Preview content */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
          <Eye className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-medium">
            {viewMode === 'rendered' ? ui.epAiWillSee : viewMode === 'raw' ? ui.epRawCode : ui.epTokenAnalysis}
          </span>
        </div>

        <div className="p-3 max-h-64 overflow-y-auto scrollbar-thin">
          {viewMode === 'rendered' && (
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {renderedOutput || <span className="text-muted-foreground italic">(no visible output — @@preprocessing mode)</span>}
            </pre>
          )}

          {viewMode === 'raw' && (
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {content}
            </pre>
          )}

          {viewMode === 'tokens' && (
            <div className="space-y-1">
              {tokens.map((token, i) => {
                const colors: Record<string, string> = {
                  literal: 'text-foreground/70 bg-transparent',
                  statement: 'text-blue-400 bg-blue-500/5',
                  expression: 'text-emerald-400 bg-emerald-500/5',
                  unescaped: 'text-amber-400 bg-amber-500/5',
                  comment: 'text-muted-foreground/50 bg-muted/20',
                  directive: 'text-violet-400 bg-violet-500/5',
                };

                return (
                  <div key={i} className={`px-2 py-1 rounded text-[10px] font-mono ${colors[token.type] ?? ''}`}>
                    <span className="text-muted-foreground/40 mr-2">{String(i).padStart(2, '0')}</span>
                    <span className="font-medium mr-1.5">[{token.type}]</span>
                    <span className="opacity-80">{token.value.slice(0, 120)}{token.value.length > 120 ? '...' : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Snippet library */}
      <SnippetLibrary />
    </div>
  );
}

// ─── Snippet Library ───────────────────────────────────────────────────

function SnippetLibrary() {
  const [expanded, setExpanded] = useState(false);
  const [selectedSnippet, setSelectedSnippet] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium hover:bg-muted/30 transition-colors">
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Bookmark className="w-3.5 h-3.5 text-primary" />
        {fmt(ui.epSnippets, { count: EJS_SNIPPETS.length })}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EJS_SNIPPETS.map(snippet => (
              <button key={snippet.id}
                onClick={() => setSelectedSnippet(selectedSnippet === snippet.id ? null : snippet.id)}
                className={`text-left p-2.5 rounded-lg border transition-all ${
                  selectedSnippet === snippet.id
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border hover:border-primary/20'
                }`}>
                <div className="text-[11px] font-medium">{snippet.label}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{snippet.description}</div>
              </button>
            ))}
          </div>

          {selectedSnippet && (
            <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-medium">
                  {EJS_SNIPPETS.find(s => s.id === selectedSnippet)?.label}
                </span>
                <button
                  onClick={() => {
                    const snippet = EJS_SNIPPETS.find(s => s.id === selectedSnippet);
                    if (snippet) void copyWithToast(snippet.code, 'đoạn mã', useToastStore.getState());
                  }}
                  className="text-[10px] text-primary hover:text-primary/80 transition-colors">
                  Copy
                </button>
              </div>
              <pre className="p-3 text-[10px] font-mono text-foreground/70 overflow-x-auto max-h-40 leading-relaxed whitespace-pre-wrap">
                {EJS_SNIPPETS.find(s => s.id === selectedSnippet)?.code}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
