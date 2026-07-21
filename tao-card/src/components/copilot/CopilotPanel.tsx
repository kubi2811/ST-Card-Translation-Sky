/**
 * CopilotPanel — Persistent AI Assistant Drawer
 * Spec Phần 9.1: Chat panel + mode selector + action cards + thought bubbles
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  MessageSquare, Send, ChevronDown, Loader2,
  Check, X, Trash2, AlertTriangle, Bot, User,
  Pause, Play, Square, Ghost, Paperclip, FileText
} from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { MODE_LABELS } from '../../lib/ai/copilotTypes';
import type { WorldbuildingMode, AIAction, CopilotMessage } from '../../lib/ai/copilotTypes';
import type { ChatAttachment } from '../../types/aiAgent.types';
import { runCopilotLoop, executeAction, type CopilotContext } from '../../lib/ai/agentLoop';
import type { ChatMessage } from '../../types';
import { DiffViewer } from '../DiffViewer';
import { t as ui } from '../../i18n';

/** Mô tả 7 chế độ Copilot. Giữ nguyên MODE_LABELS trong lib/ai/copilotTypes.ts. */
const MODE_DESC: Record<string, string> = {
  genesis: ui.cpDescGenesis,
  evolution: ui.cpDescEvolution,
  document_extraction: ui.cpDescDocExtract,
  discussion: ui.cpDescDiscussion,
  mvuzod: ui.cpDescMvuzod,
  regex: ui.cpDescRegex,
  game_dev: ui.cpDescGameDev,
};

// ═══════════════════════════════════════════════════════════════════════════
// ACTION CARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function ActionCard({ action, onApply, onSkip }: {
  action: AIAction;
  onApply: () => void;
  onSkip: () => void;
}) {
  const labels: Record<string, { icon: string; label: string; color: string }> = {
    create_entry: { icon: '➕', label: ui.cpActCreateEntry, color: 'text-emerald-400' },
    update_entry: { icon: '✏️', label: ui.cpActUpdateEntry, color: 'text-blue-400' },
    delete_entry: { icon: '🗑️', label: ui.cpActDeleteEntry, color: 'text-destructive' },
    update_field: { icon: '✏️', label: ui.cpActUpdateField, color: 'text-blue-400' },
    add_regex_script: { icon: '➕', label: ui.cpActAddRegex, color: 'text-emerald-400' },
    update_regex_script: { icon: '✏️', label: ui.cpActUpdateRegex, color: 'text-blue-400' },
    delete_regex_script: { icon: '🗑️', label: ui.cpActDeleteRegex, color: 'text-destructive' },
    fetch_fandom_data: { icon: '🌐', label: ui.cpActFetchWiki, color: 'text-primary' },
    read_document: { icon: '📄', label: ui.cpActReadDoc, color: 'text-primary' },
    set_variable: { icon: '⚙️', label: 'Set variable', color: 'text-amber-400' },
    create_tavern_script: { icon: '📜', label: ui.cpActCreateScript, color: 'text-violet-400' },
    generate_game_ui: { icon: '🎮', label: ui.cpActGameUi, color: 'text-cyan-400' },
    save_memory: { icon: '🧠', label: ui.cpActSaveMemory, color: 'text-amber-400' },
  };

  const info = labels[action.type] ?? { icon: '❓', label: action.type, color: 'text-muted-foreground' };
  const summary = action.type === 'save_memory' ? `[${(action.data as Record<string, unknown>).scope}] "${(action.data as Record<string, unknown>).key}": ${(action.data as Record<string, unknown>).value}`
    : action.type === 'create_entry' ? `"${(action.data as Record<string, unknown>).comment}"`
    : action.type === 'update_entry' ? `ID: ${(action.data as Record<string, unknown>).id}`
    : action.type === 'delete_entry' ? `"${(action.data as Record<string, unknown>).comment ?? `ID ${(action.data as Record<string, unknown>).id}`}"`
    : action.type === 'update_field' ? (action.data as Record<string, unknown>).path as string
    : '';

  const isDestructive = action.type.startsWith('delete');
  const cardState = useCardStore(s => s.card);

  let oldContent = '';
  let newContent = '';
  let showDiff = false;

  if (action.type === 'update_entry') {
    const data = action.data as Record<string, unknown>;
    const id = data.id as number;
    const patch = data.patch as Record<string, unknown> | undefined;
    const entry = cardState.data.character_book?.entries?.find(e => e.id === id);
    if (entry && patch && patch.content !== undefined) {
      oldContent = entry.content;
      newContent = patch.content as string;
      showDiff = true;
    }
  }

  return (
    <div className={`rounded-lg border p-3 ${isDestructive ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/20'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-medium ${info.color}`}>
          {info.icon} {info.label}: {summary}
        </span>
      </div>
      
      {showDiff && (
        <div className="mb-2 max-h-32 overflow-hidden">
          <DiffViewer oldText={oldContent} newText={newContent} />
        </div>
      )}

      <div className="flex gap-1.5">
        <button onClick={onApply}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors">
          <Check className="w-3 h-3" /> {ui.cpApply}
        </button>
        <button onClick={onSkip}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors">
          <X className="w-3 h-3" /> {ui.cpSkip}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COPILOT PANEL
// ═══════════════════════════════════════════════════════════════════════════

export function CopilotPanel() {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const updateEntry = useCardStore(s => s.updateEntry);
  const deleteEntry = useCardStore(s => s.deleteEntry);
  const updateField = useCardStore(s => s.updateField);
  const settings = useSettingsStore();

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<WorldbuildingMode>('genesis');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(false);
  const [isGhostMode, setIsGhostMode] = useState(false);
  const [thought, setThought] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<AIAction[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<{ paused: boolean; stopped: boolean }>({ paused: false, stopped: false });
  const [isPaused, setIsPaused] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const actionResolveRef = useRef<((decision: 'apply' | 'skip') => void) | null>(null);

  const activeProfile = settings.profiles.find(p => p.id === settings.activeProfileId);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingActions]);

  // ─── Send message ──────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!input.trim() && pendingAttachments.length === 0) return;
    if (!activeProfile) return;

    // Xử lý Infinite File: Nếu có file text cực lớn (> 8M ký tự), chuyển sang Chunking RAG
    const documentChunks: string[] = [];
    const directAttachments = pendingAttachments.map(att => {
      if (att.type === 'file' && att.data.length > 4000000) { // ngưỡng 4 triệu ký tự ~ 1M tokens
        // Chunking
        const chunkSize = 2000000;
        for (let i = 0; i < att.data.length; i += chunkSize) {
          documentChunks.push(`[File: ${att.name} - Phần ${Math.floor(i/chunkSize) + 1}]\n` + att.data.slice(i, i + chunkSize));
        }
        return { ...att, data: `(File quá lớn, đã được tự động chia thành ${Math.ceil(att.data.length/chunkSize)} chunks. AI có thể dùng tool read_document để đọc từng phần.)` };
      }
      return att;
    });

    const userMsg: CopilotMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      attachments: directAttachments.length > 0 ? directAttachments : undefined,
      timestamp: Date.now(),
    };
    
    setPendingAttachments([]);
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsRunning(true);
    setThought(null);
    setPendingActions([]);
    ctxRef.current = { paused: false, stopped: false };

    const chatHistory: ChatMessage[] = messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const ctx: CopilotContext = {
      mode,
      card: structuredClone(card),
      profile: activeProfile,
      generationParams: settings.generationParams,
      chatHistory,
      contextChip: '📍 Copilot Panel',
      autoApply,
      documentChunks: documentChunks.length > 0 ? documentChunks : undefined,
      get paused() { return ctxRef.current.paused; },
      get stopped() { return ctxRef.current.stopped; },
      setStatus: (s) => setStatus(s),
      appendMessage: (msg) => setMessages(prev => [...prev, msg]),
      showThought: (t) => setThought(t),
      showActionCard: (action) => {
        return new Promise<'apply' | 'skip'>((resolve) => {
          setPendingActions(prev => [...prev, action]);
          actionResolveRef.current = resolve;
        });
      },
      applyAction: (action) => {
        executeAction(
          action,
          useCardStore.getState().card,
          addEntry,
          (id, patch) => updateEntry(id, patch),
          deleteEntry,
          updateField,
        );
      },
      getCard: () => useCardStore.getState().card,
    };

    try {
      await runCopilotLoop(input.trim(), ctx);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: `💥 Lỗi: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }]);
    }

    setIsRunning(false);
    setStatus(null);
  }, [input, activeProfile, mode, card, settings.generationParams, messages, autoApply, addEntry, updateEntry, deleteEntry, updateField, pendingAttachments]);

  const handleActionDecision = useCallback((decision: 'apply' | 'skip') => {
    if (actionResolveRef.current) {
      actionResolveRef.current(decision);
      actionResolveRef.current = null;
      setPendingActions(prev => prev.slice(1));
    }
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();
      
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        if (isImage) {
          const base64Data = result.split(',')[1];
          setPendingAttachments(prev => [...prev, {
            type: 'image',
            mimeType: file.type,
            name: file.name,
            data: base64Data,
            previewUrl: result
          }]);
        } else {
          setPendingAttachments(prev => [...prev, {
            type: 'file',
            mimeType: file.type || 'text/plain',
            name: file.name,
            data: result
          }]);
        }
      };

      if (isImage) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    }
    e.target.value = '';
  };

  const handlePause = useCallback(() => {
    const next = !ctxRef.current.paused;
    ctxRef.current.paused = next;
    setIsPaused(next);
  }, []);

  const handleStop = useCallback(() => {
    ctxRef.current.stopped = true;
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setThought(null);
    setPendingActions([]);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ─── Toggle button (always visible) ────────────────────────────────

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25
          flex items-center justify-center hover:scale-105 active:scale-95 transition-transform">
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  // ─── Drawer ────────────────────────────────────────────────────────

  return (
    <div className={`fixed top-0 right-0 z-50 h-full w-[420px] max-w-full flex flex-col border-l shadow-2xl transition-all duration-300
      ${isGhostMode ? 'bg-background/40 backdrop-blur-md border-border/30 opacity-60 hover:opacity-100 hover:bg-background/95' : 'bg-background border-border'}
    `}>
      {/* Header */}
      <div className={`shrink-0 px-4 py-3 border-b flex items-center justify-between ${isGhostMode ? 'bg-transparent border-border/30' : 'bg-card/50 border-border'}`}>
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold">AI Copilot</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setIsGhostMode(!isGhostMode)} title="Ghost Mode"
            className={`p-1.5 rounded-md transition-colors ${isGhostMode ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            <Ghost className="w-4 h-4" />
          </button>
          <button onClick={handleClear} title={ui.cpClearHistory}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode selector */}
      <div className={`shrink-0 px-4 py-2 border-b ${isGhostMode ? 'bg-transparent border-border/30' : 'bg-muted/20 border-border'}`}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground font-medium">{ui.cpMode}</label>
          <div className="relative flex-1">
            <select value={mode} onChange={e => setMode(e.target.value as WorldbuildingMode)}
              disabled={isRunning}
              className={`w-full text-xs px-2 py-1.5 rounded-md border appearance-none pr-6 cursor-pointer ${isGhostMode ? 'bg-background/50 border-border/50' : 'bg-background border-border'}`}>
              {Object.entries(MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label} — {MODE_DESC[k] ?? v.description}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={autoApply} onChange={e => setAutoApply(e.target.checked)}
              className="settings-checkbox" disabled={isRunning} />
            {ui.cpAutoApply}
          </label>
          {!activeProfile && (
            <span className="text-[10px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {ui.cpNoProfile}
            </span>
          )}
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground mt-8">
            <Bot className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-medium">{ui.cpReady}</p>
            <p className="text-xs mt-1">{ui.cpReady2}</p>

            {/* Quick actions based on mode */}
            <div className="mt-4 space-y-1.5 text-left max-w-[280px] mx-auto">
              {mode === 'game_dev' && (
                <>
                  <QuickAction emoji="🎮" text={ui.cpQaOpeningForm} onClick={() => { setInput('Tạo Opening Form thu thập thông tin người chơi'); }} />
                  <QuickAction emoji="📊" text={ui.cpQaStatusBar} onClick={() => { setInput('Tạo Status Bar hiển thị các biến game từ schema'); }} />
                  <QuickAction emoji="🖥️" text={ui.cpQaGameScreen} onClick={() => { setInput('Tạo layout Game Screen với options và narrative'); }} />
                  <QuickAction emoji="📦" text={ui.cpQaExportProject} onClick={() => { setInput('Export project hoàn chỉnh cho jsdelivr CDN'); }} />
                </>
              )}
              {mode === 'mvuzod' && (
                <>
                  <QuickAction emoji="🔧" text={ui.cpQaLoreToSchema} onClick={() => { setInput('Phân tích Lorebook hiện có và đề xuất MVUZOD schema'); }} />
                  <QuickAction emoji="📝" text={ui.cpQaInitVar} onClick={() => { setInput('Tạo bảng biến khởi tạo từ schema'); }} />
                  <QuickAction emoji="⚡" text={ui.cpQaVarList} onClick={() => { setInput('Tạo danh sách biến hiển thị cho AI đọc'); }} />
                </>
              )}
              {mode === 'genesis' && (
                <>
                  <QuickAction emoji="🌍" text={ui.cpQaWorldbook} onClick={() => { setInput('Tạo worldbook cho RPG game với thế giới fantasy'); }} />
                  <QuickAction emoji="👤" text={ui.cpQaNpc} onClick={() => { setInput('Tạo 5 NPC entries với personality và background'); }} />
                </>
              )}
              {mode === 'regex' && (
                <>
                  <QuickAction emoji="🎭" text={ui.cpQaRegexDialogue} onClick={() => { setInput('Tạo regex script format đối thoại nhân vật'); }} />
                  <QuickAction emoji="🧹" text={ui.cpQaRegexCleanup} onClick={() => { setInput('Tạo regex script cleanup AI output (OOC, emoji, etc)'); }} />
                </>
              )}
              {(mode === 'discussion' || mode === 'evolution' || mode === 'document_extraction') && (
                <>
                  <QuickAction emoji="💡" text={ui.cpQaSuggest} onClick={() => { setInput('Xem card hiện tại và đề xuất cải thiện'); }} />
                </>
              )}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className={`flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {msg.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
              <span>{msg.role === 'user' ? ui.cpYou : 'Copilot'}</span>
            </div>
            <div className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
              msg.role === 'user' ? 'bg-primary text-primary-foreground ml-8' :
              'bg-muted mr-8'
            }`}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {msg.attachments.map((att, j) => (
                    att.type === 'image' ? (
                      <img key={j} src={att.previewUrl} alt={att.name} className="max-w-24 max-h-24 rounded border border-border" />
                    ) : (
                      <div key={j} className="flex items-center gap-1.5 px-2 py-1 bg-background/20 rounded border border-border text-xs">
                        <FileText className="w-3 h-3" /> {att.name}
                      </div>
                    )
                  ))}
                </div>
              )}
              {msg.content}
            </div>
          </div>
        ))}

        {/* Thought bubble */}
        {thought && (
          <details className="rounded-lg bg-muted/30 border border-border">
            <summary className="px-3 py-1.5 text-xs text-muted-foreground cursor-pointer">
              {ui.cpThought}
            </summary>
            <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
              {thought}
            </div>
          </details>
        )}

        {/* Pending action cards */}
        {pendingActions.map((action, i) => (
          <ActionCard key={i} action={action}
            onApply={() => handleActionDecision('apply')}
            onSkip={() => handleActionDecision('skip')} />
        ))}

        <div ref={chatEndRef} />
      </div>

      {/* Status bar */}
      {status && (
        <div className="shrink-0 px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground flex-1 truncate">{status}</span>
          {isRunning && (
            <div className="flex gap-1">
              <button onClick={handlePause}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <button onClick={handleStop}
                className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <Square className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview pending attachments */}
      {pendingAttachments.length > 0 && (
        <div className={`px-4 py-2 border-t flex flex-wrap gap-2 ${isGhostMode ? 'bg-background/40 backdrop-blur border-border/30' : 'bg-muted/30 border-border'}`}>
          {pendingAttachments.map((att, i) => (
            <div key={i} className="relative group">
              {att.type === 'image' ? (
                <img src={att.previewUrl} alt={att.name} className="w-12 h-12 object-cover rounded border border-border" />
              ) : (
                <div className="w-12 h-12 flex flex-col items-center justify-center bg-background rounded border border-border text-[8px] text-center p-1 overflow-hidden">
                  <FileText className="w-4 h-4 mb-1 text-muted-foreground" />
                  <span className="truncate w-full">{att.name}</span>
                </div>
              )}
              <button onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={`shrink-0 px-4 py-3 border-t ${isGhostMode ? 'bg-transparent border-border/30' : 'bg-card/50 border-border'}`}>
        <div className="flex gap-2 items-end">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,.txt,.md,.json,.csv" className="hidden" />
          <button onClick={() => fileInputRef.current?.click()}
            disabled={isRunning || !activeProfile}
            title={ui.cpAttach}
            className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50
              ${isGhostMode ? 'bg-background/50 hover:bg-background/80 text-muted-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}
            `}>
            <Paperclip className="w-4 h-4" />
          </button>
          
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isRunning || !activeProfile}
            placeholder={activeProfile ? ui.cpInputPh : ui.cpInputNoProfile}
            className={`flex-1 min-h-[38px] max-h-24 px-3 py-2 rounded-xl border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50
              ${isGhostMode ? 'bg-background/50 border-border/50 backdrop-blur-md' : 'bg-background border-border'}
            `}
            style={{ height: 'auto', minHeight: '38px' }} />
          <button onClick={handleSend}
            disabled={(!input.trim() && pendingAttachments.length === 0) || isRunning || !activeProfile}
            className={`shrink-0 w-9 h-9 rounded-xl text-primary-foreground flex items-center justify-center disabled:opacity-50 transition-colors
              ${isGhostMode ? 'bg-primary/80 hover:bg-primary backdrop-blur-md' : 'bg-primary hover:bg-primary/90'}
            `}>
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK ACTION BUTTON
// ═══════════════════════════════════════════════════════════════════════════

function QuickAction({ emoji, text, onClick }: { emoji: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/30
        hover:bg-primary/5 hover:border-primary/30 text-xs text-muted-foreground hover:text-foreground
        transition-all text-left group">
      <span className="text-sm">{emoji}</span>
      <span className="flex-1">{text}</span>
      <Send className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    </button>
  );
}
