import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Check, Eye, Zap, Edit3, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import type { SavedPreset } from '../types/card';
import { parsePresetJSON, getPresetSummary } from '../utils/presetParser';
import { getAllPresets, savePresetToLibrary, deletePreset, renamePreset } from '../utils/presetLibrary';

interface Props {
  onOpenPromptViewer: () => void;
}

export default function PresetImportPanel({ onOpenPromptViewer }: Props) {
  const t = useT();
  // (bugNeedFix/39) selector hẹp — trước đây subscribe toàn store, re-render theo mọi set() lúc dịch.
  const activePreset = useStore((s) => s.activePreset);
  const setActivePreset = useStore((s) => s.setActivePreset);
  const applyPresetAIParams = useStore((s) => s.applyPresetAIParams);
  const card = useStore((s) => s.card);
  const addToast = useStore((s) => s.addToast);
  const [library, setLibrary] = useState<SavedPreset[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Load library on mount
  useEffect(() => {
    getAllPresets().then(setLibrary);
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const parsed = parsePresetJSON(json);
        if (!parsed) {
          addToast('error', t.presetInvalidFile);
          return;
        }

        const fileName = file.name.replace(/\.json$/i, '');
        const existing = library.find(p => p.fileName === file.name);

        if (existing) {
          if (!confirm(t.presetAlreadyExists)) return;
          // Replace existing
          const updated: SavedPreset = {
            ...existing,
            preset: parsed,
            importedAt: Date.now(),
          };
          await savePresetToLibrary(updated);
          setActivePreset(updated);
        } else {
          const newPreset: SavedPreset = {
            id: crypto.randomUUID(),
            name: fileName,
            fileName: file.name,
            preset: parsed,
            importedAt: Date.now(),
          };
          await savePresetToLibrary(newPreset);
          setActivePreset(newPreset);
        }

        const refreshed = await getAllPresets();
        setLibrary(refreshed);
        addToast('success', t.presetImported.replace('{name}', fileName));
      } catch {
        addToast('error', t.presetInvalidFile);
      }
    }
  }, [library, addToast, setActivePreset, t]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'] },
    multiple: false,
  });

  const handleDelete = async (id: string) => {
    if (!confirm(t.presetConfirmDelete)) return;
    await deletePreset(id);
    if (activePreset?.id === id) setActivePreset(null);
    const refreshed = await getAllPresets();
    setLibrary(refreshed);
    addToast('info', t.presetDeleted);
  };

  const handleActivate = (preset: SavedPreset) => {
    setActivePreset(preset);
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    await renamePreset(id, renameValue.trim());
    if (activePreset?.id === id) {
      setActivePreset({ ...activePreset, name: renameValue.trim() });
    }
    const refreshed = await getAllPresets();
    setLibrary(refreshed);
    setRenamingId(null);
  };

  const summary = activePreset ? getPresetSummary(activePreset.preset) : null;

  return (
    <div style={{ padding: '0 20px', marginBottom: '6px' }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 0',
          fontSize: '0.8rem',
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          📋 {t.presetManager}
          {activePreset && (
            <span style={{
              background: 'var(--accent-primary)',
              color: 'white',
              fontSize: '0.6rem',
              padding: '1px 6px',
              borderRadius: '9999px',
              fontWeight: 600,
            }}>
              {t.presetActive}
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Dropzone */}
          <div
            {...getRootProps()}
            style={{
              border: `2px dashed ${isDragActive ? 'var(--accent-primary)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '12px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragActive ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-secondary)',
              transition: 'all 0.2s',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={16} style={{ marginBottom: '4px', color: 'var(--text-muted)' }} />
            <div>{t.presetDragDrop}</div>
            <div style={{ fontSize: '0.6rem', marginTop: '2px' }}>{t.presetOrClick}</div>
          </div>

          {/* Library */}
          {library.length > 0 && (
            <div>
              <div style={{
                fontSize: '0.65rem',
                color: 'var(--text-muted)',
                fontWeight: 600,
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {t.presetLibrary}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {library.map(preset => {
                  const isActive = activePreset?.id === preset.id;
                  const isRenaming = renamingId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: isActive ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-elevated)',
                        border: `1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        fontSize: '0.7rem',
                      }}
                      onClick={() => !isRenaming && handleActivate(preset)}
                    >
                      {isActive && <Check size={12} color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => handleRename(preset.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename(preset.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%',
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--accent-primary)',
                              borderRadius: '3px',
                              padding: '2px 4px',
                              fontSize: '0.7rem',
                              color: 'var(--text-primary)',
                              outline: 'none',
                            }}
                          />
                        ) : (
                          <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                          }}>
                            {preset.name}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setRenamingId(preset.id); setRenameValue(preset.name); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)', flexShrink: 0 }}
                        title={t.presetRename}
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(preset.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)', flexShrink: 0 }}
                        title={t.presetClear}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active Preset Summary & Actions */}
          {activePreset && summary && (
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '8px',
              fontSize: '0.65rem',
            }}>
              {/* Params summary */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginBottom: '6px', color: 'var(--text-muted)' }}>
                {Object.entries(summary.params).map(([key, val]) => (
                  <span key={key}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{key}</span>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 600, marginLeft: '2px' }}>
                      {typeof val === 'boolean' ? (val ? '✓' : '✗') : val}
                    </span>
                  </span>
                ))}
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
                📝 {t.presetSummary.replace('{enabled}', String(summary.enabledPrompts)).replace('{total}', String(summary.totalPrompts))}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={() => { applyPresetAIParams(); addToast('success', t.presetApplyParamsSuccess); }}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: 'var(--accent-primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
                  onMouseOut={e => e.currentTarget.style.opacity = '1'}
                >
                  <Zap size={12} /> {t.presetApplyParams}
                </button>

                <button
                  onClick={onOpenPromptViewer}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
                >
                  <Eye size={12} /> {t.presetViewPrompts}
                </button>

              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
