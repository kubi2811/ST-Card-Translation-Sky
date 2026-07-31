/**
 * InitVarEditor — Visual editor for [InitVar] initial variables (YAML-based)
 * Supports multiple initvar sets for different game routes/openings
 * References: MVU_ZOD指南.md "第二步：初始化变量"
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Plus, Trash2, Copy, Star, StarOff, ChevronDown, ChevronRight,
  FileText, Check, X, Download, Layers, Wand2, Loader2, Save,
} from 'lucide-react';
import type { MVUZODSchema, MVUZODField, InitVarEntry, InitVarConfig } from '../../types/mvuzod.types';
import { v4 as uuid } from 'uuid';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import type { ChatMessage } from '../../types';
import { MVUZOD_INITVAR_PROMPT } from '../../prompts/modeMVUZOD';
import { parseSchemaInferenceResponse } from '../../lib/mvuzod/schemaInferencer';
import { emitYamlScalar } from '../../lib/mvuzod/yamlScalars';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildDefaultData(fields: MVUZODField[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const name = field.path.split('/').filter(Boolean).pop() ?? field.path;
    if (field.children?.length) {
      data[name] = buildDefaultData(field.children);
    } else {
      data[name] = field.defaultValue ?? getTypeDefault(field.type);
    }
  }
  return data;
}

function getTypeDefault(type: string): unknown {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'string': return '';
    case 'array': return [];
    case 'record': return {};
    case 'object': return {};
    default: return null;
  }
}

/**
 * (bug 174) Bộ ghi initvar THỨ BA của tool, và là bộ nguy hiểm nhất: giá trị ở đây do user gõ
 * TỰ DO vào ô text. Bản cũ không bọc nháy bất kỳ trường hợp nào — gõ 'Null', '0123', 'Yes' hay
 * để dư dấu cách là YAML đọc sai kiểu, còn gõ chuỗi có ': ' là vỡ cả cây biến.
 * Nay dùng chung luật với bên đọc (xem yamlScalars.ts).
 */
function toYamlLike(data: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (data === null || data === undefined) return `${pad}~`;
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return `${pad}${emitYamlScalar(data)}`;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return `${pad}[]`;
    return data.map(item => (typeof item === 'object' && item !== null
      ? `${pad}-\n${toYamlLike(item, indent + 1)}`
      : `${pad}- ${emitYamlScalar(item)}`)).join('\n');
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries.map(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        return `${pad}${k}:\n${toYamlLike(v, indent + 1)}`;
      }
      return `${pad}${k}: ${emitYamlScalar(v)}`;
    }).join('\n');
  }
  return `${pad}${emitYamlScalar(String(data))}`;
}

// ─── InitVar Entry Editor (single entry) ─────────────────────────────────

function InitVarEntryEditor({
  entry,
  schema,
  onUpdate,
  onDelete,
  onSetDefault,
}: {
  entry: InitVarEntry;
  schema: MVUZODSchema;
  onUpdate: (id: string, patch: Partial<InitVarEntry>) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(entry.label);

  const handleLabelSave = useCallback(() => {
    onUpdate(entry.id, { label: labelDraft.trim() || 'Unnamed' });
    setEditingLabel(false);
  }, [entry.id, labelDraft, onUpdate]);

  return (
    <div className={`rounded-xl border transition-colors ${
      entry.isDefault ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {editingLabel ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              autoFocus
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLabelSave(); if (e.key === 'Escape') setEditingLabel(false); }}
              className="flex-1 px-2 py-0.5 text-sm rounded border border-primary/30 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button onClick={handleLabelSave} className="text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={() => setEditingLabel(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => { setEditingLabel(true); setLabelDraft(entry.label); }}
            className="flex-1 text-left text-sm font-medium hover:text-primary transition-colors">
            {entry.label}
            {entry.isDefault && <span className="ml-2 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Mặc định</span>}
          </button>
        )}

        <div className="flex items-center gap-1">
          <button onClick={() => onSetDefault(entry.id)} title={entry.isDefault ? 'Đang là mặc định' : 'Đặt làm mặc định'}
            className={`p-1 rounded transition-colors ${entry.isDefault ? 'text-primary' : 'text-muted-foreground hover:text-amber-400'}`}>
            {entry.isDefault ? <Star className="w-3.5 h-3.5 fill-current" /> : <StarOff className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onDelete(entry.id)} className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Description */}
      {expanded && (
        <div className="px-4 pb-2">
          <input
            value={entry.description ?? ''}
            onChange={e => onUpdate(entry.id, { description: e.target.value })}
            placeholder="Mô tả (tùy chọn) — ví dụ: Route Normal, Route Hard..."
            className="w-full text-xs px-2 py-1 rounded border border-border bg-background/50 text-muted-foreground
              focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
          />
        </div>
      )}

      {/* Variable tree editor */}
      {expanded && (
        <div className="px-4 pb-4 pt-1">
          <div className="text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wider">Giá trị biến khởi tạo</div>
          <NestedEditor
            data={entry.data}
            fields={schema.fields}
            onChange={(newData) => onUpdate(entry.id, { data: newData })}
            depth={0}
          />
        </div>
      )}
    </div>
  );
}

// ─── Nested data editor (tree) ──────────────────────────────────────────

function NestedEditor({
  data,
  fields,
  onChange,
  depth,
}: {
  data: Record<string, unknown>;
  fields: MVUZODField[];
  onChange: (data: Record<string, unknown>) => void;
  depth: number;
}) {
  return (
    <div className={`space-y-1 ${depth > 0 ? 'ml-4 pl-3 border-l border-border/40' : ''}`}>
      {fields.map(field => {
        const name = field.path.split('/').filter(Boolean).pop() ?? field.path;
        const value = data[name];

        if (field.children?.length) {
          return (
            <NestedObjectEditor
              key={field.path}
              field={field}
              name={name}
              value={(value as Record<string, unknown>) ?? {}}
              onChange={newVal => onChange({ ...data, [name]: newVal })}
              depth={depth}
            />
          );
        }

        return (
          <div key={field.path} className="flex items-center gap-2 py-0.5">
            <label className="text-xs text-muted-foreground min-w-[120px] shrink-0 truncate" title={field.description || field.label}>
              {field.label || name}
            </label>
            <ValueEditor
              field={field}
              value={value}
              onChange={newVal => onChange({ ...data, [name]: newVal })}
            />
            {field.description && (
              <span className="text-[9px] text-muted-foreground/50 truncate max-w-[150px]" title={field.description}>
                {field.description}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NestedObjectEditor({
  field, name, value, onChange, depth,
}: {
  field: MVUZODField;
  name: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  return (
    <div>
      <button onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-primary transition-colors py-0.5">
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Layers className="w-3 h-3 text-primary/60" />
        {field.label || name}
        <span className="text-[9px] text-muted-foreground/50">({field.children?.length ?? 0} fields)</span>
      </button>
      {!collapsed && field.children && (
        <NestedEditor
          data={value}
          fields={field.children}
          onChange={onChange}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

function ValueEditor({ field, value, onChange }: {
  field: MVUZODField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={field.constraints.min}
          max={field.constraints.max}
          className="w-24 px-2 py-0.5 text-xs rounded border border-border bg-background font-mono
            focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      );
    case 'boolean':
      return (
        <button
          onClick={() => onChange(!value)}
          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
            value ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'
          }`}
        >
          {value ? 'true' : 'false'}
        </button>
      );
    case 'string':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          className="flex-1 min-w-[120px] px-2 py-0.5 text-xs rounded border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      );
    default:
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
          onChange={e => {
            try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); }
          }}
          className="flex-1 min-w-[120px] px-2 py-0.5 text-xs rounded border border-border bg-background font-mono
            focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      );
  }
}

// ─── <initvar> Block Generator ──────────────────────────────────────────

function generateInitvarBlock(data: Record<string, unknown>, label?: string): string {
  const yamlContent = toYamlLike(data);
  const lines: string[] = [];
  if (label) lines.push(`<!-- Route: ${label} -->`);
  lines.push('<UpdateVariable>');
  lines.push('<initvar>');
  lines.push(yamlContent);
  lines.push('</initvar>');
  lines.push('</UpdateVariable>');
  return lines.join('\n');
}

function generateWorldbookYAML(data: Record<string, unknown>): string {
  return toYamlLike(data);
}

// ─── Mode Info Banner ───────────────────────────────────────────────────

function ModeInfoBanner({ mode }: { mode: 'worldbook' | 'per_opening' }) {
  if (mode === 'worldbook') {
    return (
      <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 space-y-1">
        <p className="text-xs text-blue-400 font-medium">📚 Chế độ: Worldbook Entry (mặc định)</p>
        <ul className="text-[10px] text-blue-400/70 space-y-0.5">
          <li>• Tạo 1 entry <code>[initvar]Khởi tạo biến (Tắt)</code> trong worldbook</li>
          <li>• Entry này <strong>PHẢI DISABLED</strong> — MVU chỉ đọc entry disabled</li>
          <li>• Tất cả openings sẽ dùng chung bộ giá trị này</li>
          <li>• Phù hợp khi chỉ có 1 route hoặc tất cả route cùng giá trị ban đầu</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3 space-y-1">
      <p className="text-xs text-violet-400 font-medium">🎭 Chế độ: Per-Opening (mỗi mở đầu riêng)</p>
      <ul className="text-[10px] text-violet-400/70 space-y-0.5">
        <li>• Mỗi opening message chứa block <code>&lt;initvar&gt;</code> riêng</li>
        <li>• Block nằm trong <code>&lt;UpdateVariable&gt;</code> ở cuối opening</li>
        <li>• <strong>Ưu tiên cao hơn</strong> worldbook entry — có block thì bỏ qua entry</li>
        <li>• Phù hợp khi mỗi route có giá trị khởi tạo khác nhau</li>
      </ul>
    </div>
  );
}

// ─── Per-Opening Preview ────────────────────────────────────────────────

function PerOpeningPreview({ entries }: { entries: InitVarEntry[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5 text-violet-400" />
        Preview: Paste vào cuối mỗi Opening Message
      </h4>

      {entries.map(entry => {
        const block = generateInitvarBlock(entry.data, entry.label);
        return (
          <div key={entry.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{entry.label}</span>
                {entry.isDefault && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Mặc định</span>
                )}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(block);
                  setCopiedId(entry.id);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-muted/80 transition-colors"
              >
                {copiedId === entry.id ? (
                  <><Check className="w-3 h-3 text-emerald-400" /> Đã copy!</>
                ) : (
                  <><Copy className="w-3 h-3" /> Copy block</>
                )}
              </button>
            </div>
            <pre className="p-3 text-[10px] font-mono text-muted-foreground bg-muted/10 overflow-x-auto max-h-40 leading-relaxed">
              {block}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function InitVarEditor({ schema }: { schema: MVUZODSchema | null }) {
  const savedConfig = useCardStore(s => s.getMvuzodInitVar());
  const setMvuzodInitVar = useCardStore(s => s.setMvuzodInitVar);

  // Local state initialized from store (or empty)
  const [config, setConfigLocal] = useState<InitVarConfig>(() => {
    if (savedConfig) return structuredClone(savedConfig);
    return {
      entries: [],
      activeEntryId: null,
      initvarMode: 'worldbook',
    };
  });

  // Track if local state differs from saved
  const hasUnsaved = useMemo(() => {
    return JSON.stringify(config) !== JSON.stringify(savedConfig);
  }, [config, savedConfig]);

  // Save to card store
  const handleSaveToCard = useCallback(() => {
    setMvuzodInitVar(config);
  }, [config, setMvuzodInitVar]);

  // Wrapper that updates local state
  const setConfig = useCallback((updater: InitVarConfig | ((prev: InitVarConfig) => InitVarConfig)) => {
    setConfigLocal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
  }, []);

  const handleAddEntry = useCallback(() => {
    if (!schema) return;
    const id = uuid();
    const isFirst = config.entries.length === 0;
    const newEntry: InitVarEntry = {
      id,
      label: isFirst ? 'Mở đầu mặc định' : `Mở đầu ${config.entries.length + 1}`,
      data: buildDefaultData(schema.fields),
      isDefault: isFirst,
    };
    setConfig(prev => ({
      ...prev,
      entries: [...prev.entries, newEntry],
      activeEntryId: id,
    }));
  }, [schema, config.entries.length, setConfig]);

  const handleDuplicate = useCallback((sourceId: string) => {
    const source = config.entries.find(e => e.id === sourceId);
    if (!source) return;
    const id = uuid();
    const newEntry: InitVarEntry = {
      ...structuredClone(source),
      id,
      label: `${source.label} (bản sao)`,
      isDefault: false,
    };
    setConfig(prev => ({
      ...prev,
      entries: [...prev.entries, newEntry],
    }));
  }, [config.entries, setConfig]);

  const handleUpdate = useCallback((id: string, patch: Partial<InitVarEntry>) => {
    setConfig(prev => ({
      ...prev,
      entries: prev.entries.map(e => e.id === id ? { ...e, ...patch } : e),
    }));
  }, [setConfig]);

  const handleDelete = useCallback((id: string) => {
    setConfig(prev => {
      const filtered = prev.entries.filter(e => e.id !== id);
      if (filtered.length > 0 && !filtered.some(e => e.isDefault)) {
        filtered[0].isDefault = true;
      }
      return {
        ...prev,
        entries: filtered,
        activeEntryId: prev.activeEntryId === id ? (filtered[0]?.id ?? null) : prev.activeEntryId,
      };
    });
  }, [setConfig]);

  const handleSetDefault = useCallback((id: string) => {
    setConfig(prev => ({
      ...prev,
      entries: prev.entries.map(e => ({ ...e, isDefault: e.id === id })),
    }));
  }, [setConfig]);

  // ─── Generate Worldbook YAML preview ──────────────────────────────

  const yamlPreview = useMemo(() => {
    const defaultEntry = config.entries.find(e => e.isDefault);
    if (!defaultEntry) return '# Chưa có initvar nào. Nhấn "Thêm biến khởi tạo" để bắt đầu.';
    return `# [InitVar] ${defaultEntry.label}\n# Được tạo bởi Tavern Card Studio\n# Entry: [initvar]Khởi tạo biến (Tắt) (DISABLED)\n\n${generateWorldbookYAML(defaultEntry.data)}`;
  }, [config.entries]);

  const lorebookContent = useMemo(() => {
    const defaultEntry = config.entries.find(e => e.isDefault);
    if (!defaultEntry) return '';
    return JSON.stringify(defaultEntry.data, null, 2);
  }, [config.entries]);

  if (!schema) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
        <FileText className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Cần tạo Schema trước khi thiết lập biến khởi tạo.</p>
        <p className="text-xs text-muted-foreground/60">Quay lại tab "Schema Wizard" để tạo hoặc chọn template.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Mode switcher */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted/30">
        <button
          onClick={() => setConfig(prev => ({ ...prev, initvarMode: 'worldbook' }))}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-xs font-medium transition-all ${
            config.initvarMode === 'worldbook'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Worldbook Entry
          <span className="text-[9px] text-muted-foreground">(1 bộ chung)</span>
        </button>
        <button
          onClick={() => setConfig(prev => ({ ...prev, initvarMode: 'per_opening' }))}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-xs font-medium transition-all ${
            config.initvarMode === 'per_opening'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Per-Opening
          <span className="text-[9px] text-muted-foreground">(mỗi route riêng)</span>
        </button>
      </div>

      {/* Mode info */}
      <ModeInfoBanner mode={config.initvarMode} />

      {/* Entry list */}
      <div className="space-y-3">
        {config.entries.map(entry => (
          <InitVarEntryEditor
            key={entry.id}
            entry={entry}
            schema={schema}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
          />
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={handleAddEntry}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border
            text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {config.initvarMode === 'per_opening' ? 'Thêm route mở đầu' : 'Thêm biến khởi tạo'}
        </button>
        {config.entries.length > 0 && (
          <button onClick={() => handleDuplicate(config.entries[config.entries.length - 1].id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border
              text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="w-3.5 h-3.5" />
            Nhân bản
          </button>
        )}
        <AIInitVarButton schema={schema} onGenerated={(data) => {
          const id = uuid();
          const newEntry: InitVarEntry = {
            id,
            label: 'AI Generated',
            data,
            isDefault: config.entries.length === 0,
          };
          setConfig(prev => ({
            ...prev,
            entries: [...prev.entries, newEntry],
            activeEntryId: id,
          }));
        }} />
      </div>

      {/* ─── Save to Card Button ─────────────────────────────────────── */}
      {config.entries.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveToCard}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              hasUnsaved
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
            }`}
          >
            {hasUnsaved ? (
              <>
                <Save className="w-4 h-4" />
                💾 Lưu vào Card
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                ✅ Đã lưu
              </>
            )}
          </button>
          {hasUnsaved && (
            <span className="text-[10px] text-amber-400/80 animate-pulse">
              ⚠️ Có thay đổi chưa lưu — nhấn để lưu vào card
            </span>
          )}
        </div>
      )}

      {/* Preview — depends on mode */}
      {config.entries.length > 0 && config.initvarMode === 'worldbook' && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Preview: Worldbook Entry <code className="text-primary text-[10px]">[initvar]Khởi tạo biến (Tắt)</code>
            </h4>
            <div className="flex gap-1.5">
              <button
                onClick={() => navigator.clipboard.writeText(lorebookContent)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-muted/80 transition-colors">
                <Copy className="w-3 h-3" /> Copy JSON
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(yamlPreview)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-muted/80 transition-colors">
                <Download className="w-3 h-3" /> Copy YAML
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/20">
            <span className="text-[10px] text-amber-400">⚠️ Nhớ DISABLE entry này trong worldbook — MVU chỉ đọc entry disabled!</span>
          </div>
          <pre className="text-[10px] font-mono text-muted-foreground bg-muted/20 rounded-lg p-3 overflow-x-auto max-h-60 leading-relaxed">
            {yamlPreview}
          </pre>
        </div>
      )}

      {config.entries.length > 0 && config.initvarMode === 'per_opening' && (
        <PerOpeningPreview entries={config.entries} />
      )}
    </div>
  );
}

// ─── AI InitVar Generator ───────────────────────────────────────────────

function AIInitVarButton({
  schema,
  onGenerated,
}: {
  schema: MVUZODSchema;
  onGenerated: (data: Record<string, unknown>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useCardStore(s => s.card);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

      const schemaDesc = JSON.stringify(schema, null, 2);

      // ── Collect full card context ──
      const cardContext: string[] = [];
      if (card.data.name) cardContext.push(`CHARACTER NAME: ${card.data.name}`);
      if (card.data.description) cardContext.push(`DESCRIPTION:\n${card.data.description.slice(0, 2000)}`);
      if (card.data.personality) cardContext.push(`PERSONALITY:\n${card.data.personality.slice(0, 1000)}`);
      if (card.data.scenario) cardContext.push(`SCENARIO:\n${card.data.scenario.slice(0, 1500)}`);
      if (card.data.first_mes) cardContext.push(`FIRST MESSAGE (Opening):\n${card.data.first_mes.slice(0, 2000)}`);
      if (card.data.alternate_greetings?.length) {
        const altGreetings = card.data.alternate_greetings
          .map((g, i) => `--- Opening ${i + 2} ---\n${g.slice(0, 1000)}`)
          .join('\n');
        cardContext.push(`ALTERNATE OPENINGS:\n${altGreetings}`);
      }

      // ── Collect lorebook entries (more entries, more content) ──
      const entries = card.data.character_book?.entries ?? [];
      const sampleEntries = entries.slice(0, 50).map(e =>
        `Comment: ${e.comment}\nKeys: ${(e as { keys: string[] }).keys.join(',')}\nContent:\n${e.content.slice(0, 800)}`
      ).join('\n---\n');

      const userMessage = [
        `SCHEMA:\n${schemaDesc}`,
        '',
        `=== CARD CONTEXT (ĐỌC KỸ ĐỂ SUY LUẬN) ===\n${cardContext.join('\n\n')}`,
        '',
        `=== LOREBOOK (${entries.length} entries, mẫu ${Math.min(50, entries.length)}) ===\n${sampleEntries}`,
        '',
        `Hãy phân tích toàn bộ bối cảnh card + lorebook ở trên, rồi tạo giá trị khởi tạo CỤ THỂ và PHÙ HỢP nhất cho schema này. Đặc biệt chú ý opening message để biết cảnh bắt đầu ở đâu, nhân vật đang làm gì, ai có mặt.`,
      ].join('\n');

      const messages: ChatMessage[] = [
        { role: 'system', content: MVUZOD_INITVAR_PROMPT },
        { role: 'user', content: userMessage },
      ];

      const response = await callAI({
        profile: activeProfile,
        params: { ...params, useJsonResponseFormat: true },
        messages,
      });

      const parsed = parseSchemaInferenceResponse(response.text);
      const data = (parsed as Record<string, unknown>).initVarData as Record<string, unknown>;
      if (!data || typeof data !== 'object') throw new Error('AI không trả về initVarData hợp lệ.');
      onGenerated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [schema, card, onGenerated]);

  return (
    <div className="flex flex-col gap-1">
      <button onClick={handleGenerate} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500/80 to-primary/80
          text-white text-xs font-medium hover:from-violet-500 hover:to-primary transition-all
          disabled:opacity-50 disabled:cursor-wait">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {loading ? 'AI đang tạo...' : 'AI tạo giá trị'}
      </button>
      {error && <p className="text-[10px] text-red-400 max-w-xs">{error}</p>}
    </div>
  );
}
