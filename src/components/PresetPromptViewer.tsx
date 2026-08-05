import { useState, useMemo, useCallback } from 'react';
import { X, Search, Check, ToggleLeft, ToggleRight, Save, Edit3 } from 'lucide-react';
import { useStore } from '../store';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import type { PresetPromptEntry } from '../types/card';
import { getAllPrompts } from '../utils/presetParser';
import { savePresetToLibrary } from '../utils/presetLibrary';

interface Props {
  onClose: () => void;
}

const ROLE_COLORS: Record<string, string> = {
  system: '#6366f1',
  user: '#22c55e',
  assistant: '#f59e0b',
};

export default function PresetPromptViewer({ onClose }: Props) {
  const t = useT();
  const ui = useUi();
  // (bug 213) selector hẹp — destructure trần từ useStore() là subscribe TOÀN store: mọi
  // set() (addLog/updateField suốt lượt dịch) đều kéo component này re-render dù chẳng liên quan.
  const activePreset = useStore((s) => s.activePreset);
  const setActivePreset = useStore((s) => s.setActivePreset);
  const addToast = useStore((s) => s.addToast);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [dirty, setDirty] = useState(false);

  const allPrompts = useMemo(() => {
    if (!activePreset) return [];
    return getAllPrompts(activePreset.preset);
  }, [activePreset]);

  const filteredPrompts = useMemo(() => {
    return allPrompts.filter(p => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (p.name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [allPrompts, roleFilter, searchQuery]);

  const enabledCount = allPrompts.filter(p => p.enabled !== false).length;

  // ─── Edit functions ───
  const togglePromptEnabled = useCallback((identifier: string) => {
    if (!activePreset) return;
    const updated = JSON.parse(JSON.stringify(activePreset));
    const prompt = updated.preset.prompts?.find((p: PresetPromptEntry) => p.identifier === identifier);
    if (prompt) {
      prompt.enabled = !prompt.enabled;
    }
    // Also update prompt_order if it exists
    if (Array.isArray(updated.preset.prompt_order)) {
      for (const item of updated.preset.prompt_order) {
        if (item && typeof item === 'object') {
          if (Array.isArray(item.order)) {
            const entry = item.order.find((e: any) => e.identifier === identifier);
            if (entry) entry.enabled = prompt?.enabled ?? !entry.enabled;
          } else if (item.identifier === identifier) {
            item.enabled = prompt?.enabled ?? !item.enabled;
          }
        }
      }
    }
    setActivePreset(updated);
    setDirty(true);
  }, [activePreset, setActivePreset]);

  const startEditing = useCallback((prompt: PresetPromptEntry) => {
    setEditingId(prompt.identifier);
    setEditContent(prompt.content || '');
    setEditName(prompt.name || '');
    setExpandedId(prompt.identifier);
  }, []);

  const saveEdit = useCallback(() => {
    if (!activePreset || !editingId) return;
    const updated = JSON.parse(JSON.stringify(activePreset));
    const prompt = updated.preset.prompts?.find((p: PresetPromptEntry) => p.identifier === editingId);
    if (prompt) {
      prompt.content = editContent;
      prompt.name = editName;
    }
    setActivePreset(updated);
    setEditingId(null);
    setDirty(true);
  }, [activePreset, editingId, editContent, editName, setActivePreset]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent('');
    setEditName('');
  }, []);

  const saveToLibrary = useCallback(async () => {
    if (!activePreset) return;
    try {
      await savePresetToLibrary(activePreset);
      setDirty(false);
      addToast('success', t.presetSaved || 'Preset saved!');
    } catch {
      addToast('error', 'Failed to save preset');
    }
  }, [activePreset, addToast, t]);

  if (!activePreset) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '900px',
        maxHeight: '90vh',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {t.presetPromptChain}: "{activePreset.name}"
            </h2>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {t.presetSummary
                .replace('{enabled}', String(enabledCount))
                .replace('{total}', String(allPrompts.length))}
              <span style={{ color: '#22c55e', marginLeft: '8px', fontSize: '0.6rem' }}>
                {ui.ppvEnabledHint}
              </span>
              {dirty && <span style={{ color: 'var(--accent-warning)', marginLeft: '8px', fontWeight: 600 }}>{ui.ppvDirty}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {dirty && (
              <button
                onClick={saveToLibrary}
                style={{
                  background: 'var(--accent-primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Save size={13} /> {t.presetSaveChanges || ui.ppvSaveFallback}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
        }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '150px' }}>
            <Search size={13} style={{
              position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t.search}
              style={{
                width: '100%',
                padding: '6px 8px 6px 28px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
                outline: 'none',
              }}
            />
          </div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            style={{
              padding: '6px 8px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Roles</option>
            <option value="system">System</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
          </select>
        </div>

        {/* Prompt List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {filteredPrompts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {t.presetNoPrompts}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredPrompts.map((prompt, idx) => (
                <PromptCard
                  key={prompt.identifier}
                  prompt={prompt}
                  index={idx}
                  isExpanded={expandedId === prompt.identifier}
                  isEditing={editingId === prompt.identifier}
                  editContent={editingId === prompt.identifier ? editContent : ''}
                  editName={editingId === prompt.identifier ? editName : ''}
                  onToggleExpand={() => setExpandedId(
                    expandedId === prompt.identifier ? null : prompt.identifier
                  )}
                  onToggleEnabled={() => togglePromptEnabled(prompt.identifier)}
                  onStartEdit={() => startEditing(prompt)}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                  onEditContentChange={setEditContent}
                  onEditNameChange={setEditName}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  index,
  isExpanded,
  isEditing,
  editContent,
  editName,
  onToggleExpand,
  onToggleEnabled,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditContentChange,
  onEditNameChange,
  t,
}: {
  prompt: PresetPromptEntry;
  index: number;
  isExpanded: boolean;
  isEditing: boolean;
  editContent: string;
  editName: string;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditContentChange: (v: string) => void;
  onEditNameChange: (v: string) => void;
  t: ReturnType<typeof useT>;
}) {
  const ui = useUi();
  const roleColor = ROLE_COLORS[prompt.role] || '#888';
  const previewText = (prompt.content || '').slice(0, 120).replace(/\n/g, ' ');
  const isEnabled = prompt.enabled !== false;

  return (
    <div style={{
      border: `1px solid ${isEnabled ? 'rgba(34, 197, 94, 0.2)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: isEnabled ? 'rgba(34, 197, 94, 0.02)' : 'var(--bg-elevated)',
      opacity: isEnabled ? 1 : 0.45,
      transition: 'all 0.15s',
    }}>
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          cursor: 'pointer',
        }}
        onClick={onToggleExpand}
      >
        {/* Index */}
        <span style={{
          fontSize: '0.6rem',
          color: 'var(--text-muted)',
          fontWeight: 600,
          width: '20px',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          #{index + 1}
        </span>

        {/* Enable/Disable toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggleEnabled(); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '1px',
            color: isEnabled ? '#22c55e' : '#ef4444',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
          }}
          title={isEnabled ? ui.ppvTogglePromptOff : ui.ppvTogglePromptOn}
        >
          {isEnabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
        </button>

        {/* Role badge */}
        <span style={{
          fontSize: '0.55rem',
          padding: '1px 5px',
          borderRadius: '9999px',
          fontWeight: 600,
          background: `${roleColor}15`,
          color: roleColor,
          flexShrink: 0,
          textTransform: 'uppercase',
        }}>
          {prompt.role}
        </span>

        {/* Name */}
        <span style={{
          flex: 1,
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {prompt.name || prompt.identifier}
        </span>

        {/* Depth info */}
        {prompt.injection_depth !== undefined && (
          <span style={{
            fontSize: '0.55rem',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            {t.presetPromptDepth}: {prompt.injection_depth}
          </span>
        )}

        {/* System prompt badge */}
        {prompt.system_prompt && (
          <span style={{
            fontSize: '0.55rem',
            padding: '1px 5px',
            borderRadius: '9999px',
            background: 'rgba(99, 102, 241, 0.1)',
            color: '#6366f1',
            fontWeight: 600,
            flexShrink: 0,
          }}>
            SYS
          </span>
        )}

        {/* Edit button */}
        <button
          onClick={e => { e.stopPropagation(); onStartEdit(); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
          title={ui.ppvEdit}
        >
          <Edit3 size={12} />
        </button>

        <Check size={12} style={{
          color: 'var(--text-muted)',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
          flexShrink: 0,
        }} />
      </div>

      {/* Preview */}
      {!isExpanded && !isEditing && (
        <div style={{
          padding: '0 12px 8px 44px',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {previewText}...
        </div>
      )}

      {/* Expanded content */}
      {(isExpanded || isEditing) && (
        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '12px',
          maxHeight: '500px',
          overflowY: 'auto',
        }}>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px', display: 'block' }}>
                  {ui.ppvPromptName}
                </label>
                <input
                  value={editName}
                  onChange={e => onEditNameChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem',
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px', display: 'block' }}>
                  {fmt(ui.ppvContent, { count: (editContent || '').length })}
                </label>
                <textarea
                  value={editContent}
                  onChange={e => onEditContentChange(e.target.value)}
                  rows={12}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.7rem',
                    lineHeight: 1.5,
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button
                  onClick={onCancelEdit}
                  style={{
                    padding: '5px 12px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                  }}
                >
                  {ui.ppvCancel}
                </button>
                <button
                  onClick={onSaveEdit}
                  style={{
                    padding: '5px 12px',
                    background: 'var(--accent-primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Save size={12} /> {ui.ppvApply}
                </button>
              </div>
            </div>
          ) : (
            <pre style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.7rem',
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
              background: 'var(--bg-primary)',
              padding: '10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}>
              {prompt.content || '(empty)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
