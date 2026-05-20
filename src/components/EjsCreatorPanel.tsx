import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import Editor from '@monaco-editor/react';
import { X, Copy, Save, Plus, Book, Sparkles, Upload, FileJson, ArrowRight, AlertTriangle, Check, Send, RotateCcw, PenTool } from 'lucide-react';
import type { CharacterBookEntry } from '../types/card';
import { callProvider } from '../utils/apiClient';
import { isWorldbookFormat } from '../utils/worldbookParser';

const EJS_SNIPPETS = [
  {
    title: 'Biến cơ bản (getvar / setvar)',
    desc: 'Lấy hoặc gán biến trạng thái toàn cục.',
    code: `<%_ 
var _hp = getvar('stat_data.hp_current', { defaults: 100 }); 
setvar('stat_data.hp_current', _hp - 10);
_%>`,
  },
  {
    title: 'Lệnh điều kiện (If / Else)',
    desc: 'Hiển thị nội dung khác nhau tùy vào điều kiện.',
    code: `<%_ if (_hp < 30) { _%>
Nhân vật đang bị thương nặng.
<%_ } else { _%>
Khỏe mạnh.
<%_ } _%>`,
  },
  {
    title: 'Nạp Lorebook động (getwi)',
    desc: 'Chèn nội dung từ một Lorebook Entry khác.',
    code: `<%- await getwi(null, 'Tên_Của_Entry') %>`,
  },
  {
    title: 'Quét lịch sử tin nhắn (getChatMessages)',
    desc: 'Lấy 3 tin nhắn gần nhất của user.',
    code: `<%_ 
var _txt = '';
if (typeof getChatMessages === 'function') {
  var _um = getChatMessages(-1, 'user');
  var _un = Math.min(3, _um.length);
  for (var _i = _um.length - _un; _i < _um.length; _i++) { 
    _txt += _um[_i] + ' '; 
  }
}
_%>`,
  }
];

interface GeneratedEntry {
  name: string;
  keys: string[];
  content: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  generatedEntries?: GeneratedEntry[];
}

// Hàm kiểm tra lỗi EJS tĩnh đơn giản kèm theo kiểm tra await
function validateEjsCode(code: string): string[] {
  const warnings: string[] = [];
  if (!code) return warnings;

  // Kiểm tra cặp thẻ EJS
  const opens = (code.match(/<%/g) || []).length;
  const closes = (code.match(/%>/g) || []).length;
  if (opens !== closes) {
    warnings.push(`Không khớp thẻ EJS. Tìm thấy ${opens} thẻ mở (<%) và ${closes} thẻ đóng (%>).`);
  }

  // Kiểm tra thẻ script
  const scriptOpens = (code.match(/<script[\s>]/gi) || []).length;
  const scriptCloses = (code.match(/<\/script>/gi) || []).length;
  if (scriptOpens !== scriptCloses) {
    warnings.push(`Không khớp thẻ HTML <script>. Mở: ${scriptOpens}, Đóng: ${scriptCloses}.`);
  }

  // Kiểm tra ngoặc nhọn lồng nhau trong EJS block
  const ejsBlocks = code.match(/<%_([\s\S]*?)_%>/g) || [];
  ejsBlocks.forEach((block, index) => {
    const oBraces = (block.match(/\{/g) || []).length;
    const cBraces = (block.match(/\}/g) || []).length;
    if (oBraces !== cBraces) {
      warnings.push(`Block EJS thứ ${index + 1} có thể bị lệch ngoặc nhọn { }. Mở: ${oBraces}, Đóng: ${cBraces}.`);
    }
  });

  // Kiểm tra await cho các hàm bất đồng bộ của ST-Prompt-Template
  const asyncFuncs = ['getwi', 'execute', 'getchar', 'getpreset', 'evalTemplate', 'getChara', 'getPresetPrompt'];
  asyncFuncs.forEach(func => {
    const regex = new RegExp(`(?<!await\\s+)${func}\\s*\\(`, 'g');
    if (regex.test(code)) {
      warnings.push(`Cảnh báo: Hàm bất đồng bộ '${func}' đang được gọi mà không có từ khóa 'await' phía trước. Điều này có thể gây lỗi bất ngờ trong SillyTavern.`);
    }
  });

  return warnings;
}

// Component xem trước nhiều entries dạng Accordion
function GeneratedEntriesPreview({ 
  entries, 
  onMerge, 
  onCopy 
}: { 
  entries: GeneratedEntry[]; 
  onMerge: (entries: GeneratedEntry[]) => void;
  onCopy: (code: string) => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-primary)' }}>Phát hiện {entries.length} entries:</span>
        <button
          onClick={() => onMerge(entries)}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 8px',
            background: 'var(--accent-primary)', border: 'none', borderRadius: '4px',
            color: 'white', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600
          }}
        >
          <Check size={12} /> Gộp vào Card
        </button>
      </div>
      {entries.map((e, gIdx) => {
        const isExpanded = expandedIndex === gIdx;
        return (
          <div key={gIdx} style={{ padding: '6px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '4px' }}>
            <div 
              onClick={() => setExpandedIndex(isExpanded ? null : gIdx)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-primary)' }}
            >
              <span>{e.name}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{isExpanded ? '▲ Thu gọn' : '▼ Xem code'}</span>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>Keys: {e.keys && e.keys.length > 0 ? e.keys.join(', ') : '*'}</div>
            
            {isExpanded && (
              <div style={{ marginTop: '6px', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                  <button 
                    onClick={(evt) => { evt.stopPropagation(); onCopy(e.content); }}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
                      padding: '2px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--text-secondary)', fontSize: '0.65rem'
                    }}
                  >
                    <Copy size={10} /> Copy code
                  </button>
                </div>
                <pre style={{
                  margin: 0, background: '#1e1e1e', color: '#d4d4d4', padding: '6px',
                  borderRadius: '4px', fontSize: '0.75rem', overflowX: 'auto', fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto'
                }}>
                  {e.content}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EjsCreatorPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { card, updateCard, addToast, proxy } = useStore();
  
  const entries = card?.data?.character_book?.entries || [];
  
  const [selectedEntryId, setSelectedEntryId] = useState<number | 'new'>('new');
  const [keys, setKeys] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [name, setName] = useState<string>('');
  
  const [activeTab, setActiveTab] = useState<'reference' | 'ai'>('reference');
  
  // Prompt Builder States
  const [systemType, setSystemType] = useState<'general' | 'combat' | 'survival' | 'relationship' | 'npc_router'>('general');
  const [chatInput, setChatInput] = useState('');
  
  // Chat History State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'system', content: 'Chào bạn! Tôi là Trợ Lý AI chuyên biệt về EJS SillyTavern. Bạn có thể sử dụng các lựa chọn hệ thống bên trên để bắt đầu nhanh hoặc chat trực tiếp để yêu cầu viết/sửa code.' }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Linter warnings
  const warnings = validateEjsCode(content);

  useEffect(() => {
    if (selectedEntryId === 'new') {
      setKeys('');
      setContent('');
      setName('EJS Script ' + (entries.length + 1));
    } else {
      const entry = entries.find((e) => e.id === selectedEntryId) || entries[selectedEntryId as number];
      if (entry) {
        setKeys(entry.keys ? entry.keys.join(', ') : '');
        setContent(entry.content || '');
        setName(entry.name || entry.comment || 'Unnamed Entry');
      }
    }
  }, [selectedEntryId, entries]);

  // Tự động cuộn xuống cuối khung chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleCopySnippet = (code: string) => {
    navigator.clipboard.writeText(code);
    addToast('success', 'Đã copy đoạn mã EJS!');
  };

  const handleSave = () => {
    if (!card || !card.data) return;
    const newCard = JSON.parse(JSON.stringify(card));
    if (!newCard.data.character_book) newCard.data.character_book = { entries: [] };
    
    const keysArray = keys.split(',').map(k => k.trim()).filter(k => k);
    const targetEntries: CharacterBookEntry[] = newCard.data.character_book.entries;
    
    if (selectedEntryId === 'new') {
      const maxId = targetEntries.reduce((max, e) => Math.max(max, e.id || 0), 0);
      const newEntry: CharacterBookEntry = {
        id: maxId + 1,
        keys: keysArray,
        content: content,
        name: name,
        comment: name,
        enabled: true,
        insertion_order: 50,
      };
      targetEntries.push(newEntry);
      addToast('success', 'Đã tạo mới Lorebook Entry!');
      updateCard(newCard);
      setSelectedEntryId(newEntry.id!);
    } else {
      const idx = targetEntries.findIndex(e => e.id === selectedEntryId);
      if (idx !== -1) {
        targetEntries[idx].keys = keysArray;
        targetEntries[idx].content = content;
        targetEntries[idx].name = name;
        targetEntries[idx].comment = name;
        addToast('success', 'Đã cập nhật Lorebook Entry!');
        updateCard(newCard);
      }
    }
  };

  // Hàm gọi AI chính với Chat History và Card Context
  const handleSendChat = async (overridePrompt?: string) => {
    const promptText = overridePrompt || chatInput;
    if (!promptText.trim()) return;

    const newMessages: ChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: promptText }
    ];
    
    setChatMessages(newMessages);
    if (!overridePrompt) setChatInput('');
    setIsGenerating(true);

    // Lấy thông tin ngữ cảnh Thẻ Nhân Vật hiện tại (Context-Awareness)
    const cardName = card?.data?.name || 'Chưa rõ';
    const cardDesc = card?.data?.description || 'Trống';
    const cardScenario = card?.data?.scenario || 'Trống';
    const entryNames = entries.map(e => e.name || e.comment || 'Không tên').join(', ');

    // Xây dựng prompt có cấu trúc dựa trên lựa chọn hệ thống
    let structuredUserMsg = '';
    if (systemType !== 'general' && !overridePrompt) {
      const typeLabel = {
        combat: 'CHIẾN ĐẤU & VÕ HỒN',
        survival: 'SINH TỒN (HP/Đói/Khát)',
        relationship: 'MỐI QUAN HỆ / HẢO CẢM',
        npc_router: 'QUẢN LÝ NPC & ĐỊA ĐIỂM ĐỘNG'
      }[systemType];
      structuredUserMsg += `[Hệ thống mẫu: ${typeLabel}]\n`;
    }

    // Định dạng lịch sử chat để gửi lên API đơn lẻ
    if (newMessages.length > 2) {
      structuredUserMsg += `--- LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ ---\n`;
      newMessages.slice(1, -1).forEach(m => {
        structuredUserMsg += `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}\n`;
      });
      structuredUserMsg += `----------------------------------\n\n`;
    }

    structuredUserMsg += `Yêu cầu mới: "${promptText}"`;

    const systemPrompt = `You are an expert Senior Game Developer specializing in SillyTavern EJS game engine scripts for character cards and Lorebooks.
You are extremely familiar with the ST-Prompt-Template extension (by zonde306) and its full EJS API:

API REFERENCES:
1. Variables:
   - getvar(key, { defaults: def, scope: 'local'|'global'|'message' }) / setvar(key, value, { scope: 'local'|'global' })
   - incvar(key, value, { max: X, min: Y }) / decvar(key, value)
   - Scope 'local' limits state to current chat session; 'global' persists across all chats.
2. SillyTavern Interop:
   - await getwi(null, 'EntryName') - dynamically load other entries (always use 'await'!)
   - await execute('/slash_command') - run SillyTavern commands (always use 'await'!)
   - await getchar() - get character definition (always use 'await'!)
   - define('funcName', function() { ... }) - declare helper functions/global variables

CONTENT INJECTION & POSITIONING (via Entry Name/Comment prefixes):
If designing multiple entries, you can instruct where to place them by naming the entry with a prefix:
- [GENERATE:BEFORE]: Injects at the start of context sent to LLM.
- [GENERATE:AFTER]: Injects at the end of context sent to LLM.
- [InitialVariables]: A JSON object defining initial variables (e.g. initial stats/items).

PROMPT MESSAGE INJECTION (@INJECT System):
To inject a prompt as a distinct message block instead of merging into system text:
Format the entry name/comment as: @INJECT pos=X,role=Y OR @INJECT target=A,index=B,at=before|after,role=Y
- pos=-1,role=user: Inject as a user message at the very end of prompt.
- target=user,index=1,at=before,role=system: Inject system instructions right before the first user message.
Important: Set enabled to false for the entries using @INJECT or prefix triggers to avoid double execution.

CRITICAL CARD CONTEXT:
- Tên nhân vật chính: ${cardName}
- Mô tả thẻ: ${cardDesc.slice(0, 1000)}
- Bối cảnh thẻ (Scenario): ${cardScenario.slice(0, 500)}
- Các Lorebook Entries hiện có: ${entryNames}

Use variables or getwi calls matching this card context if relevant to the user request.

CRITICAL COMPLIANCE:
Depending on complexity, you can return:
1. A SINGLE block of raw EJS code.
2. MULTIPLE entries represented as a JSON array if the system is complex (e.g. requiring an initialization entry and one or more conditional entries).

If you decide to return a JSON array for multiple entries, you MUST return a valid JSON array format wrapped in a single \`\`\`json block. The array elements MUST have this format:
[
  {
    "name": "Tên Entry (comment) - có thể dùng prefix [GENERATE:BEFORE] hoặc @INJECT",
    "keys": ["từ_khóa_kích_hoạt"],
    "content": "mã EJS hoặc nội dung của entry này"
  }
]
For global initializers, use keys: ["*"] or no keys.

If you return a single EJS block, do NOT wrap it in a JSON array, just return the raw EJS code.`;

    try {
      const result = await callProvider(proxy, systemPrompt, structuredUserMsg);
      const cleanResult = result.trim();

      // Thử xem kết quả có phải là JSON array hay không
      let isJson = false;
      let parsedEntries: GeneratedEntry[] = [];
      if (cleanResult.includes('```json')) {
        const jsonMatch = cleanResult.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            const parsed = JSON.parse(jsonMatch[1].trim());
            if (Array.isArray(parsed)) {
              parsedEntries = parsed;
              isJson = true;
            }
          } catch (e) {}
        }
      }

      if (isJson) {
        setChatMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `Tôi đã thiết kế xong một hệ thống gồm ${parsedEntries.length} entries. Bạn có thể xem thử bên dưới và gộp chúng vào Card.`,
            generatedEntries: parsedEntries
          }
        ]);
        addToast('success', `Đã tạo ${parsedEntries.length} entries thành công!`);
      } else {
        let rawCode = cleanResult;
        if (rawCode.startsWith('```')) {
          rawCode = rawCode.replace(/^\`\`\`(ejs|html|javascript|js)?\n/, '').replace(/\n\`\`\`$/, '');
        }
        setChatMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: rawCode
          }
        ]);
        addToast('success', 'Đã tạo mã EJS thành công!');
      }
    } catch (err: any) {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Lỗi: ${err.message || 'Không thể gọi được API AI. Vui lòng kiểm tra lại proxy và API Key.'}` }
      ]);
      addToast('error', err.message || 'Lỗi khi gọi AI');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMergeGenerated = (gEntries: GeneratedEntry[]) => {
    if (!card || !card.data || gEntries.length === 0) return;
    
    const newCard = JSON.parse(JSON.stringify(card));
    if (!newCard.data.character_book) newCard.data.character_book = { entries: [] };
    
    const targetEntries = newCard.data.character_book.entries;
    let maxId = targetEntries.reduce((max: number, e: any) => Math.max(max, e.id || 0), 0);
    
    gEntries.forEach(gen => {
      maxId++;
      
      // Nếu tên entry chứa @INJECT hoặc [GENERATE: thì set enabled = false để tránh ST trigger nhầm
      const shouldDisable = gen.name.includes('@INJECT') || gen.name.includes('[GENERATE:');
      
      targetEntries.push({
        id: maxId,
        keys: gen.keys || [],
        content: gen.content || '',
        name: gen.name || 'AI Generated Entry',
        comment: gen.name || 'AI Generated Entry',
        enabled: !shouldDisable,
        insertion_order: 50,
      });
    });
    
    updateCard(newCard);
    addToast('success', `Đã gộp thành công ${gEntries.length} entries vào Card!`);
    setSelectedEntryId(maxId); // Chuyển sang entry vừa được add cuối cùng
  };

  // Thao tác nhanh từ Monaco Editor (Quick Actions)
  const handleQuickAction = (action: 'complete' | 'fix') => {
    setActiveTab('ai');
    if (action === 'complete') {
      const prompt = `Đây là đoạn code EJS hiện tại của tôi:\n\`\`\`html\n${content}\n\`\`\`\nHãy viết tiếp hoặc hoàn thiện đoạn code này dựa theo logic đã có.`;
      handleSendChat(prompt);
    } else if (action === 'fix') {
      const errorList = warnings.join('\n');
      const prompt = `Đoạn code EJS hiện tại của tôi đang bị lỗi cú pháp:\n\`\`\`html\n${content}\n\`\`\`\nCác lỗi ghi nhận:\n${errorList}\nHãy phân tích và viết lại đoạn code đã được sửa hoàn chỉnh giúp tôi.`;
      handleSendChat(prompt);
    }
  };

  const handleResetChat = () => {
    setChatMessages([
      { role: 'system', content: 'Chào bạn! Tôi là Trợ Lý AI chuyên biệt về EJS SillyTavern. Bạn có thể sử dụng các lựa chọn hệ thống bên trên để bắt đầu nhanh hoặc chat trực tiếp để yêu cầu viết/sửa code.' }
    ]);
  };

  const handleImportWorldbook = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const json = JSON.parse(text);
        
        let newEntries: CharacterBookEntry[] = [];
        if (isWorldbookFormat(json)) {
          newEntries = (Array.isArray(json.entries) ? json.entries : Object.values(json.entries || {})) as unknown as CharacterBookEntry[];
        } else if (json.data?.character_book?.entries) {
          newEntries = json.data.character_book.entries;
        } else if (Array.isArray(json)) {
          newEntries = json;
        }

        if (newEntries.length > 0 && card && card.data) {
          const newCard = JSON.parse(JSON.stringify(card));
          if (!newCard.data.character_book) newCard.data.character_book = { entries: [] };
          
          let maxId = newCard.data.character_book.entries.reduce((max: number, en: any) => Math.max(max, en.id || 0), 0);
          
          newEntries.forEach(entry => {
            maxId++;
            newCard.data.character_book.entries.push({
              ...entry,
              id: maxId
            });
          });
          
          updateCard(newCard);
          addToast('success', `Đã gộp thành công ${newEntries.length} entries vào thẻ hiện tại!`);
        } else {
          addToast('error', 'Không tìm thấy entries hợp lệ trong file này.');
        }
      } catch (err) {
        addToast('error', 'Lỗi đọc file JSON.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column', zIndex: 9999
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'var(--bg-secondary)', flexShrink: 0
      }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)' }}>
          <Book size={20} /> EJS Creator & World Info Editor
        </h2>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input type="file" accept=".json" style={{ display: 'none' }} ref={fileInputRef} onChange={handleImportWorldbook} />
          <button 
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              borderRadius: '4px', cursor: 'pointer', color: 'var(--text-primary)'
            }}>
            <Upload size={16} /> Nhập Lorebook (.json)
          </button>

          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: '16px'
          }}>
            <X size={28} />
          </button>
        </div>
      </div>

      {/* Body (Split Pane) */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        
        {/* Left Column: Tabs */}
        <div style={{
          width: '450px', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column', flexShrink: 0
        }}>
          {/* Tab Headers */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setActiveTab('reference')}
              style={{
                flex: 1, padding: '12px', background: activeTab === 'reference' ? 'var(--bg-primary)' : 'transparent',
                border: 'none', borderBottom: activeTab === 'reference' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'reference' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'reference' ? 600 : 400, cursor: 'pointer', display: 'flex', justifyContent: 'center', gap: '6px'
              }}>
              <FileJson size={16} /> Cẩm Nang EJS
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              style={{
                flex: 1, padding: '12px', background: activeTab === 'ai' ? 'var(--bg-primary)' : 'transparent',
                border: 'none', borderBottom: activeTab === 'ai' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'ai' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'ai' ? 600 : 400, cursor: 'pointer', display: 'flex', justifyContent: 'center', gap: '6px'
              }}>
              <Sparkles size={16} /> Trợ Lý AI Chat (EJS Master)
            </button>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
            {activeTab === 'reference' && (
              <div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  Dưới đây là các cú pháp thường dùng của <strong>ST-Prompt-Template</strong>.
                </p>
                {EJS_SNIPPETS.map((snip, i) => (
                  <div key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{snip.title}</h4>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{snip.desc}</div>
                      </div>
                      <button onClick={() => handleCopySnippet(snip.code)} style={{
                        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
                        padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)'
                      }}>
                        <Copy size={14} />
                      </button>
                    </div>
                    <pre style={{ margin: 0, background: '#1e1e1e', color: '#d4d4d4', padding: '8px', borderRadius: '4px', fontSize: '0.8rem', overflowX: 'auto', fontFamily: 'monospace' }}>
                      {snip.code}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                {/* Chat Config / Reset */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                  <select
                    value={systemType}
                    onChange={e => setSystemType(e.target.value as any)}
                    style={{
                      flex: 1, padding: '6px', borderRadius: '4px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontSize: '0.8rem'
                    }}
                  >
                    <option value="general">Hệ thống tự do</option>
                    <option value="combat">⚔️ Hệ thống Chiến Đấu</option>
                    <option value="survival">🏕️ Hệ thống Sinh Tồn</option>
                    <option value="relationship">❤️ Hệ thống Hảo Cảm</option>
                    <option value="npc_router">🗺️ Bộ Quét NPC & Địa Điểm</option>
                  </select>
                  <button onClick={handleResetChat} title="Đặt lại cuộc trò chuyện" style={{
                    padding: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                    borderRadius: '4px', cursor: 'pointer', color: 'var(--text-secondary)'
                  }}>
                    <RotateCcw size={16} />
                  </button>
                </div>

                {/* Chat History View */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
                  {chatMessages.map((msg, idx) => {
                    const isUser = msg.role === 'user';
                    const isSystem = msg.role === 'system';
                    
                    return (
                      <div key={idx} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isUser ? 'flex-end' : 'flex-start'
                      }}>
                        <div style={{
                          maxWidth: '90%',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          lineHeight: '1.4',
                          background: isUser ? 'var(--accent-primary)' : isSystem ? 'var(--bg-secondary)' : 'var(--bg-elevated)',
                          color: isUser ? 'white' : 'var(--text-primary)',
                          border: isSystem ? '1px dashed var(--border-default)' : '1px solid var(--border-subtle)'
                        }}>
                          {/* Nội dung tin nhắn */}
                          <div style={{ whiteSpace: 'pre-wrap', fontFamily: isUser ? 'inherit' : 'monospace' }}>
                            {msg.content}
                          </div>
                          
                          {/* Nút tác vụ nhanh chèn code cho tin nhắn đơn lẻ */}
                          {!isUser && !isSystem && !msg.generatedEntries && (
                            <button
                              onClick={() => { setContent(prev => prev + '\n' + msg.content); addToast('success', 'Đã chèn vào cuối Editor!'); }}
                              style={{
                                marginTop: '10px', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px',
                                background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)', borderRadius: '4px',
                                color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600
                              }}>
                              <ArrowRight size={14} /> Chèn vào Editor
                            </button>
                          )}

                          {/* Preview Entries dạng Accordion */}
                          {msg.generatedEntries && (
                            <GeneratedEntriesPreview 
                              entries={msg.generatedEntries} 
                              onMerge={handleMergeGenerated} 
                              onCopy={handleCopySnippet} 
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input Box */}
                <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                  <textarea
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendChat();
                      }
                    }}
                    placeholder="Nhập yêu cầu để sinh hoặc sửa code EJS..."
                    style={{
                      flex: 1, height: '50px', padding: '8px', borderRadius: '6px',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)', resize: 'none', fontSize: '0.85rem'
                    }}
                  />
                  <button
                    onClick={() => handleSendChat()}
                    disabled={isGenerating || !chatInput.trim()}
                    style={{
                      width: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center',
                      background: isGenerating ? 'var(--bg-elevated)' : 'var(--accent-primary)',
                      color: 'white', border: 'none', borderRadius: '6px', cursor: isGenerating ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
          {/* Toolbar */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chọn Entry:</span>
              <select 
                value={selectedEntryId} 
                onChange={(e) => setSelectedEntryId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                style={{ padding: '6px', borderRadius: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', minWidth: '200px' }}
              >
                <option value="new">-- ✨ Tạo Entry Mới --</option>
                {entries.map((e, idx) => (
                  <option key={e.id || idx} value={e.id || idx}>
                    [{e.id || idx}] {e.name || e.comment || 'Unnamed'}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}></div>

            {/* Quick Actions (AI Complete, AI Fix) */}
            <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
              <button 
                onClick={() => handleQuickAction('complete')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                  borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-secondary)'
                }}
              >
                <PenTool size={14} /> 🪄 Viết tiếp code (AI)
              </button>
              
              {warnings.length > 0 && (
                <button 
                  onClick={() => handleQuickAction('fix')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px',
                    background: 'var(--bg-elevated)', border: '1px solid #eb5e28',
                    borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', color: '#eb5e28'
                  }}
                >
                  <AlertTriangle size={14} /> 🐛 Sửa lỗi code (AI)
                </button>
              )}
            </div>

            <button onClick={() => setSelectedEntryId('new')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-primary)' }}>
              <Plus size={16} /> Tạo Mới
            </button>
            <button onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 16px', background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'white', fontWeight: 600 }}>
              <Save size={16} /> Lưu Vào Card
            </button>
          </div>

          {/* Inputs */}
          <div style={{ padding: '12px 16px', display: 'flex', gap: '16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tên / Ghi chú (Name/Comment)</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} placeholder="Ví dụ: Quy tắc chiến đấu" />
            </div>
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Từ khóa kích hoạt (Keys - ngăn cách bằng dấu phẩy)</label>
              <input type="text" value={keys} onChange={e => setKeys(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} placeholder="Ví dụ: combat, chiến đấu, đánh nhau" />
            </div>
          </div>

          {/* Linter warnings alert */}
          {warnings.length > 0 && (
            <div style={{
              background: 'rgba(235, 94, 40, 0.1)',
              borderBottom: '1px solid rgba(235, 94, 40, 0.3)',
              padding: '10px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {warnings.map((w, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#eb5e28' }}>
                  <AlertTriangle size={14} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Editor */}
          <div style={{ flex: 1, position: 'relative' }}>
            <Editor
              height="100%"
              defaultLanguage="html"
              theme="vs-dark"
              value={content}
              onChange={(val) => setContent(val || '')}
              options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 14, lineHeight: 24, padding: { top: 16 } }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
