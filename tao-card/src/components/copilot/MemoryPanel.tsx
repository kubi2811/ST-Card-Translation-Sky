/**
 * MemoryPanel — người dùng tự quản lý ký ức của Copilot.
 * Xem / thêm / xoá / bật-tắt. Tắt (không xoá) để khoanh vùng mục ghi sai
 * mà không mất dữ liệu — quan trọng với scope 'global' vì nó áp cho MỌI thẻ.
 */

import { useState } from 'react';
import { X, Trash2, AlertTriangle, Pencil } from 'lucide-react';
import { useMemoryStore } from '../../store/memoryStore';
import type { MemoryScope } from '../../store/memoryStore';
import { useCardStore } from '../../store/cardStore';
import { getSessionId } from '../../lib/ai/memoryContext';
import { t as ui } from '../../i18n';

const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: ui.cpMemoryScopeGlobal,
  project: ui.cpMemoryScopeProject,
  session: ui.cpMemoryScopeSession,
};

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const memories = useMemoryStore(s => s.memories);
  const addMemory = useMemoryStore(s => s.addMemory);
  const deleteMemory = useMemoryStore(s => s.deleteMemory);
  const toggleMemory = useMemoryStore(s => s.toggleMemory);
  const updateMemory = useMemoryStore(s => s.updateMemory);
  const currentProjectId = useCardStore(s => s.currentProjectId);

  const [scope, setScope] = useState<MemoryScope>('global');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  // Sửa inline: id đang sửa + bản nháp key/value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');

  const startEdit = (id: string, k: string, v: string) => {
    setEditingId(id);
    setEditKey(k);
    setEditValue(v);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = (id: string) => {
    if (!editKey.trim() || !editValue.trim()) return;
    updateMemory(id, { key: editKey.trim(), value: editValue.trim() });
    setEditingId(null);
  };

  // Ca biên: scope 'project' nhưng dự án chưa lưu → không có projectId để gắn.
  const projectUnsaved = scope === 'project' && !currentProjectId;
  const canAdd = key.trim().length > 0 && value.trim().length > 0 && !projectUnsaved;

  const handleAdd = () => {
    if (!canAdd) return;
    addMemory({
      scope,
      key: key.trim(),
      value: value.trim(),
      projectId: scope === 'project' ? currentProjectId ?? undefined : undefined,
      sessionId: scope === 'session' ? getSessionId() : undefined,
    });
    setKey('');
    setValue('');
  };

  return (
    <div className="shrink-0 max-h-[50%] overflow-y-auto scrollbar-thin border-t border-border bg-muted/30 px-4 py-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          🧠 {ui.cpMemoryPanelTitle}
        </span>
        <button onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Danh sách ký ức */}
      {memories.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">{ui.cpMemoryEmpty}</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {memories.map(m => {
            // Ký ức scope 'project' của thẻ KHÁC vẫn hiện (user cần thấy toàn bộ kho)
            // nhưng KHÔNG được dán nhãn "Thẻ này" — trước đây user tưởng nhầm rồi xoá oan.
            const isOtherProject = m.scope === 'project' && m.projectId !== currentProjectId;
            const scopeLabel = isOtherProject ? ui.cpMemoryScopeOtherProject : SCOPE_LABELS[m.scope];
            const isEditing = editingId === m.id;
            return (
              <li key={m.id}
                className={`flex items-start gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5 transition-opacity
                  ${m.disabled ? 'opacity-40' : isOtherProject ? 'opacity-65' : ''}`}>
                <input type="checkbox" checked={!m.disabled}
                  onChange={() => toggleMemory(m.id)}
                  title={ui.cpMemoryToggle}
                  className="settings-checkbox mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-1">
                      <input value={editKey} onChange={e => setEditKey(e.target.value)}
                        className="w-full text-[11px] px-2 py-1 rounded-md border border-border bg-background
                          focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <textarea value={editValue} onChange={e => setEditValue(e.target.value)} rows={2}
                        className="w-full text-[11px] px-2 py-1 rounded-md border border-border bg-background resize-none
                          focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <div className="flex gap-1.5">
                        <button onClick={() => saveEdit(m.id)}
                          disabled={!editKey.trim() || !editValue.trim()}
                          className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px]
                            hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                          {ui.cpMemorySaveEdit}
                        </button>
                        <button onClick={cancelEdit}
                          className="px-2 py-1 rounded-md border border-border text-[10px]
                            hover:bg-muted transition-colors">
                          {ui.lbCancel}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium truncate">{m.key}</span>
                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {scopeLabel}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground break-words whitespace-pre-wrap">{m.value}</p>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <button onClick={() => startEdit(m.id, m.key, m.value)} title={ui.cpMemoryEdit}
                    className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => deleteMemory(m.id)} title={ui.cpMemoryDelete}
                  className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Form thêm mới */}
      <div className="space-y-1.5 border-t border-border pt-2">
        <select value={scope} onChange={e => setScope(e.target.value as MemoryScope)}
          className="w-full text-[11px] px-2 py-1.5 rounded-md border border-border bg-background cursor-pointer">
          <option value="global">{ui.cpMemoryScopeGlobal}</option>
          <option value="project">{ui.cpMemoryScopeProject}</option>
          <option value="session">{ui.cpMemoryScopeSession}</option>
        </select>

        {projectUnsaved && (
          <p className="text-[10px] text-destructive flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {ui.cpMemoryProjectUnsaved}
          </p>
        )}

        <input value={key} onChange={e => setKey(e.target.value)}
          placeholder={ui.cpMemoryPanelTitle}
          className="w-full text-[11px] px-2 py-1.5 rounded-md border border-border bg-background
            focus:outline-none focus:ring-2 focus:ring-primary/30" />

        <textarea value={value} onChange={e => setValue(e.target.value)}
          rows={2}
          className="w-full text-[11px] px-2 py-1.5 rounded-md border border-border bg-background resize-none
            focus:outline-none focus:ring-2 focus:ring-primary/30" />

        <button onClick={handleAdd} disabled={!canAdd}
          className="w-full px-2 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px]
            hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {ui.cpMemoryAdd}
        </button>
      </div>
    </div>
  );
}
