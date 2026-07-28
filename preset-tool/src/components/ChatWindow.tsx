import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../storeContext';
import { callAI } from '../utils/ai';
import { extractJSONsFromText, ExtractedJSON } from '../utils/parser';
import { buildProjectContext, resolveReferences, buildReferencedContext } from '../utils/contextBuilder';
import {
  loadPresetLibrary, savePresetLibrary, upsertPreset, buildPresetLibraryContext,
  type ImportedPreset,
} from '../utils/presetLibrary';
import { PromptBlock, RegexScript, ChatMessage } from '../types';
import { Send, RefreshCw, Sparkles, Plus, Calendar, Code, Paperclip, X, FileJson } from 'lucide-react';
import { t, fmt } from '../i18n';

const EMPTY_MESSAGES: ChatMessage[] = [];

const generateRandomId = () => {
  return 'p-ai-' + Math.floor(Math.random() * 1000000).toString(36);
};

const SCHEDULE_TEMPLATE = `Thêm vào preset một prompt block có nội dung sau (đặt tên "🗓 Lịch trình 7 ngày"):

<Quy tắc lịch trình>
[CHỈ THỊ]: Ngay sau vùng <content>, AI BẮT BUỘC xuất ra lịch trình 7 ngày liên tiếp
dưới dạng <details> collapsible widget.

Định dạng:
<details>
<summary>[✰] Lịch trình của {{user}}</summary>
<calendar_widget>
Date: DD/MM|Thứ X
Event: type|title|description|time|location|npc_action
</calendar_widget>
</details>

Quy tắc:
- type: world | major | {{user}} | character
- Mỗi ngày 2–5 sự kiện, tổng 15–30 events
- description: góc nhìn chủ quan {{user}}, ≥30 từ  
- npc_action: hành động độc lập NPC, ≥30 từ
</Quy tắc lịch trình>

Đồng thời tạo kèm một Regex Script JSON để làm đẹp <calendar_widget> thành HTML widget
có date scroller, event cards có thể expand, màu phân loại theo type.`;

interface ChatWindowProps {
  onOpenSettings: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ onOpenSettings }) => {
  const { 
    chatHistory, 
    addChatMessage, 
    activeProjectId,
    activeProject,
    settings, 
    importFullPreset,
    addPromptBlock,
    addRegexScript,
    addToast,
    getActionLog,
  } = useApp();

  const activeMessages = chatHistory[activeProjectId] || EMPTY_MESSAGES;

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null); // nút Dừng: hủy call AI đang chạy
  const [streamingText, setStreamingText] = useState('');
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string; summary: string } | null>(null);
  // (bug 139) Thư viện preset mẫu — nạp một lần, MỌI lượt chat sau tự có ngữ cảnh.
  const [presetLib, setPresetLib] = useState<ImportedPreset[]>(() => loadPresetLibrary());
  const updateLib = (next: ImportedPreset[]) => { setPresetLib(next); savePresetLibrary(next); };
  const importLibFiles = async (files: File[]) => {
    let next = presetLib;
    for (const f of files) {
      if (!/\.(json|txt|ya?ml|md)$/i.test(f.name)) continue;
      try { next = upsertPreset(next, f.name, await f.text()); } catch { /* file hỏng — bỏ */ }
    }
    updateLib(next);
  };
  
  const templateFileRef = useRef<HTMLInputElement>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Handle preset file attachment for AI reference
  const handleAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      addToast(t.toastOnlyJson, "error");
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target?.result as string;
        const parsed = JSON.parse(content);
        
        // Build a summary for display
        let summary = '';
        if (parsed.prompts && Array.isArray(parsed.prompts)) {
          summary = fmt(t.cwSummaryPreset, { count: parsed.prompts.length });
        } else if (parsed.findRegex) {
          summary = fmt(t.cwSummaryRegex, { name: parsed.scriptName || 'Script' });
        } else if (Array.isArray(parsed)) {
          summary = fmt(t.cwSummaryArray, { count: parsed.length });
        } else {
          summary = fmt(t.cwSummaryObject, { count: Object.keys(parsed).length });
        }

        setAttachedFile({
          name: file.name,
          content: JSON.stringify(parsed, null, 2),
          summary,
        });
        addToast(fmt(t.cwToastAttached, { name: file.name }), "success");
      } catch {
        addToast(fmt(t.toastBadJson, { name: file.name }), "error");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRemoveAttachment = () => {
    setAttachedFile(null);
  };

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, streamingText]);

  const handleSend = async (textToSend: string = input) => {
    if (!textToSend.trim() || isSending) return;
    
    // Check if key is available
    if (!settings.useProxy && !settings.apiKey) {
      addToast(t.cwToastNoKey, "error");
      onOpenSettings();
      return;
    }

    // If a file is attached, prepend it as context
    let userText = textToSend;
    let displayText = textToSend;
    if (attachedFile) {
      userText = `[FILE PRESET MẪU ĐÍNH KÈM — "${attachedFile.name}"]
Dưới đây là nội dung file preset/regex mẫu mà người dùng muốn bạn tham khảo, phân tích hoặc cải tiến:
\`\`\`json
${attachedFile.content}
\`\`\`

Yêu cầu của người dùng:
${textToSend}`;
      displayText = `${fmt(t.cwAttachPrefix, { name: attachedFile.name })}\n\n${textToSend}`;
      setAttachedFile(null);
    }

    setInput('');
    setIsSending(true);
    setStreamingText('');
    const ac = new AbortController();
    abortRef.current = ac;

    // 1. Add user message
    addChatMessage({
      role: 'user',
      content: displayText
    });

    try {
      // 2. Build RAG context
      const actionLog = getActionLog();
      // (bug 139) Thư viện preset nạp sẵn đi kèm MỌI lượt chat: preset được nhắc tên/ghim gửi
      // nguyên văn, còn lại gửi tóm tắt (cache) — user chỉ cần nói "sửa preset A", "gộp A với B".
      const libContext = buildPresetLibraryContext(presetLib, userText);
      const projectContext = buildProjectContext(activeProject, actionLog) + (libContext ? `\n\n${libContext}` : '');
      const refs = resolveReferences(userText, activeProject, actionLog);
      const referencedContext = buildReferencedContext(refs);

      // 3. Call API with full context
      const reply = await callAI(userText, activeMessages, settings, projectContext, referencedContext, ac.signal);
      
      // 3. Extract JSONs from reply
      const extracted = extractJSONsFromText(reply);

      // 4. Simulate streaming effect (typewriter)
      let currentText = '';
      const chars = reply.split('');
      const chunkSize = Math.max(1, Math.floor(chars.length / 50)); // Simulating speeds
      
      for (let i = 0; i < chars.length; i += chunkSize) {
        currentText += chars.slice(i, i + chunkSize).join('');
        setStreamingText(currentText);
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      
      setStreamingText('');

      // 5. Add AI Response with parsed data
      addChatMessage({
        role: 'assistant',
        content: reply,
        extractedJSONs: extracted
      });
      
      if (extracted.length > 0) {
        addToast(fmt(t.cwToastFoundJson, { count: extracted.length }), "success");
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') {
        setStreamingText('');
        addChatMessage({ role: 'system', content: t.cwStopped });
      } else {
        const errMsg = e instanceof Error ? e.message : t.cwErrGeneric;
        addChatMessage({
          role: 'system',
          content: fmt(t.cwErrConn, { msg: errMsg })
        });
        addToast(errMsg, "error");
      }
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  };

  const handlePrefill = (type: 'preset' | 'regex' | 'schedule') => {
    if (type === 'preset') {
      setInput("Tạo SillyTavern preset tiếng Việt cho roleplay, tối ưu Gemini, với ");
    } else if (type === 'regex') {
      setInput("Tạo SillyTavern regex script để ");
    } else if (type === 'schedule') {
      setInput(prev => prev + (prev ? '\n\n' : '') + SCHEDULE_TEMPLATE);
    }
  };

  const handleImportExtracted = (item: ExtractedJSON) => {
    if (item.type === 'preset') {
      if (confirm(fmt(t.cwConfirmOverwrite, { name: item.name }))) {
        importFullPreset(item.data);
      }
    } else if (item.type === 'prompt') {
      const block = item.data as Partial<PromptBlock>;
      addPromptBlock({
        name: block.name || "Prompt Block AI",
        identifier: block.identifier || generateRandomId(),
        role: block.role || 'system',
        system_prompt: block.system_prompt !== undefined ? block.system_prompt : true,
        content: block.content || "",
        enabled: block.enabled !== undefined ? block.enabled : true,
        injection_position: block.injection_position || 0,
        injection_depth: block.injection_depth || 4,
        injection_order: block.injection_order || 100,
        forbid_overrides: block.forbid_overrides || false
      });
    } else if (item.type === 'prompts') {
      const blocks = (Array.isArray(item.data) ? item.data : []) as Partial<PromptBlock>[];
      blocks.forEach((block) => {
        addPromptBlock({
          name: block.name || "Prompt Block AI",
          identifier: block.identifier || generateRandomId(),
          role: block.role || 'system',
          system_prompt: block.system_prompt !== undefined ? block.system_prompt : true,
          content: block.content || "",
          enabled: block.enabled !== undefined ? block.enabled : true,
          injection_position: block.injection_position || 0,
          injection_depth: block.injection_depth || 4,
          injection_order: block.injection_order || 100,
          forbid_overrides: block.forbid_overrides || false
        });
      });
      addToast(fmt(t.cwToastAddedPrompts, { count: blocks.length }), "success");
    } else if (item.type === 'regex') {
      const data = (item.data || {}) as Partial<RegexScript>;
      addRegexScript({
        scriptName: data.scriptName || "Regex Script AI",
        findRegex: data.findRegex || "",
        replaceString: data.replaceString || "",
        trimStrings: data.trimStrings || [],
        placement: data.placement || [1, 2],
        disabled: data.disabled !== undefined ? data.disabled : false,
        markdownOnly: data.markdownOnly !== undefined ? data.markdownOnly : false,
        promptOnly: data.promptOnly !== undefined ? data.promptOnly : false,
        runOnEdit: data.runOnEdit !== undefined ? data.runOnEdit : true,
        substituteRegex: data.substituteRegex !== undefined ? data.substituteRegex : 0,
        minDepth: data.minDepth !== undefined ? data.minDepth : null,
        maxDepth: data.maxDepth !== undefined ? data.maxDepth : null,
        id: data.id
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-theme-bg">
      
      {/* Chats Container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {activeMessages.length === 0 && !streamingText && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-6">
            <div className="p-4 bg-purple-500/10 rounded-full border border-purple-500/20 text-purple-400 animate-pulse">
              <Sparkles size={32} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-gray-200">{t.cwWelcomeTitle}</h2>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                {t.cwWelcomeBody}
              </p>
            </div>
            
            {/* Quick buttons starting help */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full pt-4">
              <button
                onClick={() => handlePrefill('preset')}
                className="flex items-center justify-center gap-2 p-3 bg-gray-900 border border-theme-border hover:border-purple-500/40 rounded-xl text-xs text-gray-300 transition text-left"
              >
                <Code size={14} className="text-purple-400" />
                <span>{t.cwQuickPreset}</span>
              </button>
              <button
                onClick={() => handlePrefill('regex')}
                className="flex items-center justify-center gap-2 p-3 bg-gray-900 border border-theme-border hover:border-cyan-500/40 rounded-xl text-xs text-gray-300 transition text-left"
              >
                <RefreshCw size={14} className="text-cyan-400" />
                <span>{t.cwQuickRegex}</span>
              </button>
            </div>
          </div>
        )}

        {/* Message items list */}
        {activeMessages.map((msg) => (
          <div 
            key={msg.id}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            } space-y-1 animate-fade-in`}
          >
            {/* Sender Label */}
            <span className="text-[10px] text-gray-500 font-bold px-1 uppercase tracking-wider font-mono">
              {msg.role === 'user' ? t.cwRoleUser : msg.role === 'system' ? t.cwRoleSystem : t.cwRoleAssistant}
            </span>

            {/* Bubble content */}
            <div 
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-purple-600 text-white rounded-tr-sm shadow-md shadow-purple-500/10'
                  : msg.role === 'system'
                    ? 'bg-red-500/15 border border-red-500/30 text-red-300 rounded-tl-sm'
                    : 'bg-theme-panel border border-theme-border/60 text-gray-200 rounded-tl-sm shadow-sm'
              }`}
            >
              <div className="whitespace-pre-wrap select-text font-sans">
                {msg.content}
              </div>

              {/* Parsed actions attachments */}
              {msg.extractedJSONs && msg.extractedJSONs.length > 0 && (
                <div className="mt-3.5 pt-3 border-t border-theme-border/40 space-y-2">
                  <span className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest font-mono">
                    {t.cwExtractHeader}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {msg.extractedJSONs.map((item, idx) => (
                      <div 
                        key={idx}
                        className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2.5 bg-gray-950/40 rounded-xl border border-theme-border/50 gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <Code size={14} className={item.type === 'regex' ? 'text-cyan-400' : 'text-purple-400'} />
                          <div className="text-left">
                            <span className="block text-[11px] font-bold text-gray-300 truncate max-w-[200px] sm:max-w-xs">{item.name}</span>
                            <span className="block text-[9px] text-gray-500 uppercase font-mono font-bold">
                              {fmt(t.cwKind, { type: item.type === 'preset' ? t.cwKindPreset : item.type === 'regex' ? t.cwKindRegex : t.cwKindPrompts })}
                            </span>
                          </div>
                        </div>
                        
                        <button
                          onClick={() => handleImportExtracted(item)}
                          className="flex items-center gap-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-bold text-[10px] px-3 py-1.5 rounded-lg border border-purple-500/30 transition self-end sm:self-auto"
                        >
                          <Plus size={10} />
                          {item.type === 'preset' ? t.cwImportOverwrite : t.cwImportAdd}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming Placeholder */}
        {streamingText && (
          <div className="flex flex-col items-start space-y-1 animate-pulse">
            <span className="text-[10px] text-gray-500 font-bold px-1 uppercase tracking-wider font-mono">{t.cwStreaming}</span>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-theme-panel border border-theme-border text-gray-200 text-xs sm:text-sm whitespace-pre-wrap leading-relaxed select-text">
              {streamingText}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Attached file indicator */}
      {/* (bug 139) Thư viện preset mẫu — nạp nhiều file .json/.txt/.yaml, MỌI lượt chat sau
          tự có ngữ cảnh (nhắc tên hoặc ghim = gửi nguyên văn; còn lại là tóm tắt). */}
      <div
        className="px-4 py-1.5 border-t border-theme-border flex items-center gap-1.5 flex-wrap"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void importLibFiles(Array.from(e.dataTransfer.files)); }}
      >
        <button
          onClick={() => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.multiple = true; inp.accept = '.json,.txt,.yaml,.yml,.md';
            inp.onchange = () => { void importLibFiles(Array.from(inp.files ?? [])); };
            inp.click();
          }}
          className="text-[10px] px-2 py-0.5 rounded border border-theme-border hover:bg-white/5 flex items-center gap-1"
          title={t.plImportTip}
        >📚 {t.plImportBtn}{presetLib.length > 0 ? ` (${presetLib.length})` : ''}</button>
        {presetLib.map(p => (
          <span key={p.id}
            className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${p.pinned ? 'border-amber-400/60 text-amber-300' : 'border-theme-border text-theme-muted'}`}
            title={`${p.format} · ${p.raw.length.toLocaleString()} ký tự\n${p.summary}`}>
            <button onClick={() => updateLib(presetLib.map(x => x.id === p.id ? { ...x, pinned: !x.pinned } : x))}
              title={p.pinned ? t.plUnpin : t.plPin}>{p.pinned ? '📌' : '📄'}</button>
            {p.name}
            <button onClick={() => updateLib(presetLib.filter(x => x.id !== p.id))} title={t.plRemove}><X size={10} /></button>
          </span>
        ))}
        {presetLib.length === 0 && <span className="text-[10px] text-theme-muted">{t.plEmptyHint}</span>}
      </div>

      {attachedFile && (
        <div className="px-4 py-2 border-t border-theme-border bg-emerald-500/[0.05] flex items-center gap-2 animate-fade-in">
          <FileJson size={14} className="text-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="block text-[11px] font-bold text-emerald-300 truncate">{attachedFile.name}</span>
            <span className="block text-[9px] text-gray-500">{fmt(t.cwAttachSuffix, { summary: attachedFile.summary })}</span>
          </div>
          <button
            onClick={handleRemoveAttachment}
            className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition flex-shrink-0"
            title={t.cwRemoveAttach}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Quick Action buttons above Input */}
      <div className="px-4 py-2 border-t border-theme-border bg-gray-950/20 flex flex-wrap items-center gap-2">
        <button
          onClick={() => handlePrefill('preset')}
          className="flex items-center gap-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition"
        >
          <Code size={12} />
          {t.cwBtnPreset}
        </button>
        <button
          onClick={() => handlePrefill('regex')}
          className="flex items-center gap-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition"
        >
          <RefreshCw size={12} />
          {t.cwBtnRegex}
        </button>
        <button
          onClick={() => handlePrefill('schedule')}
          className="flex items-center gap-1 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 border border-yellow-500/20 font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition"
        >
          <Calendar size={12} />
          {t.cwBtnSchedule}
        </button>
        
        {/* File attach button */}
        <button
          onClick={() => templateFileRef.current?.click()}
          className="flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition ml-auto"
          title={t.cwAttachTitle}
        >
          <Paperclip size={12} />
          {t.cwAttachBtn}
        </button>
        <input
          ref={templateFileRef}
          type="file"
          accept=".json"
          onChange={handleAttachFile}
          className="hidden"
        />
      </div>

      {/* Input container footer */}
      <div className="p-4 bg-gray-950/40 border-t border-theme-border flex gap-2">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={t.cwInputPh}
          className="flex-1 bg-gray-900 border border-theme-border rounded-xl px-4 py-3 text-xs sm:text-sm text-gray-200 focus:outline-none focus:border-purple-400 placeholder-gray-500 resize-none max-h-24 font-sans"
        />
        {isSending ? (
          <button
            onClick={() => abortRef.current?.abort(new DOMException('Người dùng đã dừng', 'AbortError'))}
            title={t.cwStop}
            className="flex items-center justify-center p-3 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-xl transition shadow-md shadow-red-500/10 self-end"
          >
            <X size={16} />
          </button>
        ) : (
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="flex items-center justify-center p-3 bg-purple-500 hover:bg-purple-600 active:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded-xl transition shadow-md shadow-purple-500/10 self-end"
          >
            <Send size={16} />
          </button>
        )}
      </div>

    </div>
  );
};
