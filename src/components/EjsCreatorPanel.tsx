import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import Editor from '@monaco-editor/react';
import { X, Copy, Save, Plus, Book, Sparkles, Upload, FileJson, ArrowRight, AlertTriangle, Check, Send, RotateCcw, PenTool, Cpu, Trash2 } from 'lucide-react';
import type { CharacterBookEntry } from '../types/card';
import { callProvider } from '../utils/apiClient';
import { isWorldbookFormat } from '../utils/worldbookParser';
import MvuEjsToolkit from './MvuEjsToolkit';

const EJS_SNIPPETS = [
  {
    title: 'Biến cơ bản (getvar / setvar)',
    desc: 'Lấy hoặc gán biến trạng thái toàn cục.',
    code: `<%_ 
var _hp = getvar('stat_data.hp_current', { defaults: 100 }); 
setvar('stat_data.hp_current', _hp - 10);
_%>\n`,
  },
  {
    title: 'Lệnh điều kiện (If / Else)',
    desc: 'Hiển thị nội dung khác nhau tùy vào điều kiện.',
    code: `<%_ if (_hp < 30) { _%>
Nhân vật đang bị thương nặng.
<%_ } else { _%>
Khỏe mạnh.
<%_ } _%>\n`,
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
_%>\n`,
  },
  {
    title: 'Bộ điều khiển thế giới quan (@@preprocessing)',
    desc: 'Thiết lập khung cơ bản thế giới quan thường trú, không bị ảnh hưởng bởi vị trí.',
    code: `@@preprocessing
<%
/* ===== Bộ điều khiển thế giới quan =====
 * Đèn xanh thường trú, luôn kích hoạt tất cả các mục thiết lập cơ bản của thế giới quan hay [Thế Giới Quan] hay các từ tương đương
 * Những mục này là khung cơ bản của toàn bộ thế giới, không bị ảnh hưởng bởi biến vị trí
 */
-%>
<%- await getwi('Thế_Giới_Quan_Nguồn_Gốc_Thế_Giới') %>
<%- await getwi('Thế giới quan_Cảnh giới tu luyện') %>
<%- await getwi('Thế_Giới_Quan_Phàm_Tục_Và_Quy_Tắc') %>
<%- await getwi('Thế giới quan_Hệ thống Linh_Căn') %>
<%- await getwi('Thế Giới Quan_Hệ Thống Phẩm Cấp') %>
<%- await getwi('Thế giới quan_Hệ thống dị hỏa') %>
<%- await getwi('Thế_Giới_Quan_Tài_Nguyên_Tu_Chân') %>
<%- await getwi('Thế_Giới_Quan_Âm_Dương_Lịch_Pháp') %>
<%- await getwi('Tổng Quan Thế Lực Và Địa Điểm') %>`,
  },
  {
    title: 'Bộ điều khiển đa giai đoạn (Controller)',
    desc: 'Điều hướng động để tải các giai đoạn nhân vật khác nhau dựa trên chỉ số (Hảo cảm).',
    code: `<%_
if (typeof goodwill === 'undefined') var goodwill = getvar('stat_data.quan_he.hao_cam', { defaults: 0 });
if (typeof relationship === 'undefined') var relationship = getvar('stat_data.quan_he.trang_thai', { defaults: 'Xa lạ' });
_%>

<%_ if (goodwill < 30) { _%>
<%- await getwi('NhanVat_GiaiDoan_XaLa') %>
<%_ } else if (goodwill < 60) { _%>
<%- await getwi('NhanVat_GiaiDoan_QuenThuoc') %>
<%_ } else if (relationship === 'Người yêu') { _%>
<%- await getwi('NhanVat_GiaiDoan_LuyenAi') %>
<%_ } else { _%>
<%- await getwi('NhanVat_GiaiDoan_ThanThiet') %>
<%_ } _%>`,
  },
  {
    title: 'Thanh trạng thái nhân vật (@@iframe & @@if)',
    desc: 'Tạo giao diện hiển thị chỉ số động ở cuối tin nhắn, sử dụng iframe để tránh xung đột CSS.',
    code: `@@render_after
@@iframe Trạng thái của nhân vật (Click để xem)
@@if !is_user && !is_system
<html>
<head>
  <style>
    body { font-family: sans-serif; color: #ff69b4; margin: 0; padding: 8px; }
    .stat-bar { border: 1px solid #ff69b422; padding: 8px; border-radius: 6px; background: #ff69b405; }
  </style>
</head>
<body>
  <div class="stat-bar">
    💖 Độ hảo cảm: <strong><%- getvar('stat_data.quan_he.hao_cam', { defaults: 0 }) %></strong>
  </div>
</body>
</html>`,
  },
  {
    title: 'Zod Schema MVU Zod 4 Cơ Bản',
    desc: 'Mẫu định nghĩa Schema biến trạng thái an toàn, tự động ép kiểu và đặt giá trị mặc định.',
    code: `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  hp: z.coerce.number().prefault(100).transform(v => _.clamp(v, 0, 100)),
  mp: z.coerce.number().prefault(50).transform(v => _.clamp(v, 0, 100)),
  trang_thai: z.string().prefault('Bình thường'),
  tui_do: z.record(z.string().describe('Tên vật phẩm'), z.object({
    mo_ta: z.string().prefault(''),
    so_luong: z.coerce.number().prefault(1)
  })).prefault({})
});

$(() => {
  registerMvuSchema(Schema);
});`,
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

// Hàm kiểm tra lỗi EJS tĩnh nâng cao để bắt lỗi MVU / EJS phổ biến
function validateEjsCode(code: string): string[] {
  const warnings: string[] = [];
  if (!code) return warnings;

  // 1. Kiểm tra cặp thẻ EJS
  const opens = (code.match(/<%/g) || []).length;
  const closes = (code.match(/%>/g) || []).length;
  if (opens !== closes) {
    warnings.push(`Không khớp thẻ EJS. Tìm thấy ${opens} thẻ mở (<%) và ${closes} thẻ đóng (%>).`);
  }

  // 2. Kiểm tra thẻ script
  const scriptOpens = (code.match(/<script[\s>]/gi) || []).length;
  const scriptCloses = (code.match(/<\/script>/gi) || []).length;
  if (scriptOpens !== scriptCloses) {
    warnings.push(`Không khớp thẻ HTML <script>. Mở: ${scriptOpens}, Đóng: ${scriptCloses}.`);
  }

  // 3. Kiểm tra ngoặc nhọn lồng nhau trong EJS block
  const ejsBlocks = code.match(/<%_([\s\S]*?)_%>/g) || code.match(/<%([\s\S]*?)%>/g) || [];
  ejsBlocks.forEach((block, index) => {
    const oBraces = (block.match(/\{/g) || []).length;
    const cBraces = (block.match(/\}/g) || []).length;
    if (oBraces !== cBraces) {
      warnings.push(`Block EJS thứ ${index + 1} có thể bị lệch ngoặc nhọn { }. Mở: ${oBraces}, Đóng: ${cBraces}.`);
    }
  });

  // 4. Kiểm tra vị trí Decorator (Decorator phải đặt ở dòng đầu của entry, không nằm giữa nội dung)
  const lines = code.split('\n');
  let foundContent = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line.startsWith('@@')) {
      if (foundContent) {
        warnings.push(`Dòng ${i + 1}: Decorator '${line}' phải đặt ở đầu tiên của nội dung entry (không đặt sau chữ thường hay mã HTML/EJS).`);
      }
    } else {
      foundContent = true;
    }
  }

  // 5. Kiểm tra hàm getvar/setvar thiếu tiền tố biến (stat_data hay variables)
  const getvarRegex = /(?:getvar|setvar|addvar|getglobalvar|setglobalvar|addglobalvar|getVariable|setVariable)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = getvarRegex.exec(code)) !== null) {
    const path = match[1];
    if (!path.startsWith('stat_data.') && !path.startsWith('variables.') && !path.startsWith('global.') && !path.startsWith('temp.') && !path.includes('::')) {
      warnings.push(`Cảnh báo: Hàm getvar/setvar gọi biến '${path}' không có tiền tố (khuyến nghị dùng 'stat_data.${path}' hoặc 'variables.${path}' để tránh lỗi).`);
    }
  }

  // 6. Kiểm tra thiếu typeof check chống xung đột biến toàn cục
  ejsBlocks.forEach((block, index) => {
    const varRegex = /\bvar\s+(\w+)\s*=\s*/g;
    let vMatch;
    while ((vMatch = varRegex.exec(block)) !== null) {
      const varName = vMatch[1];
      const typeofCheck = new RegExp(`typeof\\s+${varName}\\s*===\\s*['"]undefined['"]`, 'i');
      if (!typeofCheck.test(block)) {
        warnings.push(`Block EJS thứ ${index + 1}: Nên kiểm tra 'typeof ${varName} === "undefined"' trước khi khai báo 'var ${varName}' để tránh xung đột phạm vi biến toàn cục.`);
      }
    }
  });

  // 7. Kiểm tra await cho các hàm bất đồng bộ của ST-Prompt-Template
  const asyncFuncs = ['getwi', 'execute', 'getchar', 'getpreset', 'evalTemplate', 'getChara', 'getPresetPrompt', 'activewi'];
  asyncFuncs.forEach(func => {
    const regex = new RegExp(`(?<!await\\s+)${func}\\s*\\(`, 'g');
    if (regex.test(code)) {
      warnings.push(`Cảnh báo: Hàm bất đồng bộ '${func}' đang được gọi mà không có từ khóa 'await' phía trước. Điều này có thể gây lỗi bất ngờ trong SillyTavern.`);
    }
  });

  return warnings;
}

// Thuật toán xếp hạng độ tương quan (RAG) đơn giản phía client
function rankEntriesByRelevance(query: string, entries: CharacterBookEntry[]): CharacterBookEntry[] {
  if (!query || entries.length === 0) return [];
  
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (queryTokens.length === 0) return [];

  const scored = entries.map(entry => {
    const title = (entry.name || entry.comment || '').toLowerCase();
    const content = (entry.content || '').toLowerCase();
    const keys = (entry.keys || []).join(' ').toLowerCase();

    let score = 0;
    queryTokens.forEach(token => {
      if (title.includes(token)) score += 10;
      if (keys.includes(token)) score += 5;
      if (content.includes(token)) score += 1;
    });
    return { entry, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.entry);
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
  
  const [activeTab, setActiveTab] = useState<'reference' | 'ai' | 'toolkit'>('reference');
  
  // Cẩm nang (Snippets) States
  const [snippets, setSnippets] = useState<{ title: string; desc: string; code: string }[]>(() => {
    const saved = localStorage.getItem('ejs_snippets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved ejs_snippets', e);
      }
    }
    return EJS_SNIPPETS;
  });

  useEffect(() => {
    localStorage.setItem('ejs_snippets', JSON.stringify(snippets));
  }, [snippets]);

  const [newSnipTitle, setNewSnipTitle] = useState('');
  const [newSnipDesc, setNewSnipDesc] = useState('');
  const [newSnipCode, setNewSnipCode] = useState('');
  const [isAddingSnippet, setIsAddingSnippet] = useState(false);

  const handleAddSnippet = () => {
    if (!newSnipTitle.trim() || !newSnipCode.trim()) {
      addToast('error', 'Tiêu đề và mã code không được bỏ trống.');
      return;
    }
    const newSnip = {
      title: newSnipTitle.trim(),
      desc: newSnipDesc.trim(),
      code: newSnipCode
    };
    setSnippets([newSnip, ...snippets]);
    setNewSnipTitle('');
    setNewSnipDesc('');
    setNewSnipCode('');
    setIsAddingSnippet(false);
    addToast('success', 'Đã thêm phần cẩm nang mới!');
  };

  const handleDeleteSnippet = (index: number) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa phần cẩm nang này không?')) {
      const next = snippets.filter((_, i) => i !== index);
      setSnippets(next);
      addToast('success', 'Đã xóa phần cẩm nang.');
    }
  };

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

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const completionProviderRef = useRef<any>(null);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider('html', {
      triggerCharacters: ["'", '"'],
      provideCompletionItems: (model: any, position: any) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        const suggestions = entriesRef.current.map((e: any) => {
          const entryName = e.name || e.comment || 'Không tên';
          const keysStr = e.keys && e.keys.length > 0 ? e.keys.join(', ') : 'Không có';
          const contentSnippet = e.content ? e.content.slice(0, 150) + '...' : 'Trống';
          return {
            label: entryName,
            kind: monaco.languages.CompletionItemKind.Field,
            documentation: `Từ khóa: ${keysStr}\nNội dung:\n${contentSnippet}`,
            insertText: entryName,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column,
              endColumn: position.column,
            }
          };
        });

        return { suggestions };
      },
    });
  };

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
      }
    };
  }, []);

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
    
    // Nén toàn bộ nội dung của Lorebook Entries để gửi lên AI làm ngữ cảnh cốt truyện thực tế
    const compactLorebookText = entries.map((e, index) => {
      const entryName = e.name || e.comment || `Entry ${index + 1}`;
      const entryKeys = e.keys && e.keys.length > 0 ? e.keys.join(', ') : 'Không có';
      const entryContent = e.content || 'Nội dung trống';
      return `[Entry ${index + 1}: ${entryName}]\nKeys kích hoạt: ${entryKeys}\nNội dung thực tế:\n${entryContent}\n-------------------------`;
    }).join('\n');

    // Chạy RAG chấm điểm tìm các Entry có liên quan nhất với yêu cầu hiện tại để làm nổi bật ngữ cảnh
    const rankedEntries = rankEntriesByRelevance(promptText, entries);
    const topRelevantEntries = rankedEntries.slice(0, 5);
    let ragFocusText = '';
    if (topRelevantEntries.length > 0) {
      ragFocusText = `TIÊU ĐIỂM NGỮ CẢNH (CÁC ENTRIES LIÊN QUAN NHẤT CẦN CHÚ Ý ĐẶC BIỆT):
${topRelevantEntries.map((e, idx) => {
        return `${idx + 1}. [${e.name || e.comment}]\n   - Từ khóa: ${(e.keys || []).join(', ')}\n   - Nội dung thực tế:\n${e.content || 'Trống'}`;
      }).join('\n-------------------------\n')}
==================================\n\n`;
    }

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
You are extremely familiar with the ST-Prompt-Template extension (by zonde306) and its full EJS API, as well as the MVU ZOD variables framework (by Autumn Qingzi).

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

CRITICAL WORKFLOW BEST PRACTICES (ZOD 4 & EJS 2026):
1. Zod 4 Schema Design:
   - Always use 'z.coerce.number()' instead of 'z.number()' for numeric fields to ensure automatic conversion.
   - Never use 'z.coerce.boolean()'; use raw 'z.boolean()' instead.
   - Always use '.prefault(defaultValue)' instead of '.default(defaultValue)'. If a compound object has '.prefault()', all its inner fields must also have '.prefault()'.
   - Avoid using '.strict()' or '.passthrough()' as they are not supported in the MVU ZOD environment.
   - Prefer 'z.record()' over 'z.array()' for list items to make JSON Patch updates more robust.
   - Do NOT import 'z' or '_' (lodash) in MVU scripts, as they are already injected globally.
   - Implement value clamping on numerical ranges using '.transform(v => _.clamp(v, min, max))'.
2. EJS Scripting:
   - Always call asynchronous functions with the 'await' keyword (e.g., 'await getwi(...)', 'await activewi(...)', 'await execute(...)').
   - For JSON Patch updates in AI comments, write paths starting from the root of the variable tree WITHOUT the 'stat_data' prefix (e.g., '/user/hp' instead of '/stat_data/user/hp').
   - However, when reading or writing variables inside EJS code, always include the 'stat_data' prefix (e.g., 'getvar("stat_data.user.hp")').
   - To prevent duplicate variable declaration errors when multiple EJS blocks run, always check if a variable exists before declaring it (e.g., 'if (typeof myVar === "undefined") var myVar = getvar(...)') or use the '@@private' decorator.
   - Use '@@preprocessing' at the top of a Lorebook entry to perform early computations and dynamically trigger keyword greenlights before prompt assembly.

CRITICAL CARD CONTEXT:
- Tên nhân vật chính: ${cardName}
- Mô tả thẻ: ${cardDesc.slice(0, 1000)}
- Bối cảnh thẻ (Scenario): ${cardScenario.slice(0, 500)}

DANH SÁCH TOÀN BỘ LOREBOOK ENTRIES THỰC TẾ TRONG CARD (BẮT BUỘC ĐỌC NỘI DUNG NÀY ĐỂ THAM CHIẾU VÀ TRÁNH TỰ BỊA RA):
==================================
${ragFocusText}${compactLorebookText}
==================================

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
          width: '520px', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column', flexShrink: 0
        }}>
          {/* Tab Headers */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setActiveTab('reference')}
              style={{
                flex: 1, padding: '12px 6px', background: activeTab === 'reference' ? 'var(--bg-primary)' : 'transparent',
                border: 'none', borderBottom: activeTab === 'reference' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'reference' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'reference' ? 600 : 400, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', fontSize: '0.78rem'
              }}>
              <FileJson size={14} /> Cẩm Nang
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              style={{
                flex: 1, padding: '12px 6px', background: activeTab === 'ai' ? 'var(--bg-primary)' : 'transparent',
                border: 'none', borderBottom: activeTab === 'ai' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'ai' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'ai' ? 600 : 400, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', fontSize: '0.78rem'
              }}>
              <Sparkles size={14} /> Trợ Lý AI
            </button>
            <button
              onClick={() => setActiveTab('toolkit')}
              style={{
                flex: 1, padding: '12px 6px', background: activeTab === 'toolkit' ? 'var(--bg-primary)' : 'transparent',
                border: 'none', borderBottom: activeTab === 'toolkit' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'toolkit' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'toolkit' ? 600 : 400, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', fontSize: '0.78rem'
              }}>
              <Cpu size={14} /> Công cụ MVU
            </button>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
            {activeTab === 'reference' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                    Cú pháp thường dùng của <strong>ST-Prompt-Template</strong>.
                  </p>
                  <button
                    onClick={() => setIsAddingSnippet(!isAddingSnippet)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px',
                      background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '4px',
                      fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    <Plus size={14} /> Thêm phần mới
                  </button>
                </div>

                {isAddingSnippet && (
                  <div style={{
                    background: 'var(--bg-secondary)', border: '1px dashed var(--accent-primary)',
                    borderRadius: '8px', padding: '12px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px'
                  }}>
                    <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)' }}>Thêm Cẩm Nang Mới</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Tiêu đề *</label>
                      <input
                        type="text"
                        placeholder="VD: Kiểm tra quan hệ"
                        value={newSnipTitle}
                        onChange={e => setNewSnipTitle(e.target.value)}
                        style={{ padding: '6px', fontSize: '0.75rem', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Mô tả ngắn</label>
                      <input
                        type="text"
                        placeholder="VD: Cú pháp kiểm tra hảo cảm và tình trạng"
                        value={newSnipDesc}
                        onChange={e => setNewSnipDesc(e.target.value)}
                        style={{ padding: '6px', fontSize: '0.75rem', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Mã code *</label>
                      <textarea
                        placeholder="VD: <%_ if (getvar('stat_data.hp') <= 0) { _%> ..."
                        value={newSnipCode}
                        onChange={e => setNewSnipCode(e.target.value)}
                        style={{ padding: '6px', fontSize: '0.75rem', height: '100px', fontFamily: 'monospace', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: 'var(--text-primary)', resize: 'vertical' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <button
                        onClick={() => setIsAddingSnippet(false)}
                        style={{ padding: '5px 10px', fontSize: '0.72rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer' }}
                      >
                        Hủy
                      </button>
                      <button
                        onClick={handleAddSnippet}
                        style={{ padding: '5px 10px', fontSize: '0.72rem', background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', color: 'white', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Lưu lại
                      </button>
                    </div>
                  </div>
                )}

                {snippets.map((snip, i) => (
                  <div key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{snip.title}</h4>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{snip.desc}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => handleCopySnippet(snip.code)} title="Sao chép mã" style={{
                          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
                          padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)'
                        }}>
                          <Copy size={14} />
                        </button>
                        <button onClick={() => handleDeleteSnippet(i)} title="Xóa phần này" style={{
                          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
                          padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--accent-danger)'
                        }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
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
                    <RotateCcw size={14} />
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

            {activeTab === 'toolkit' && (
              <MvuEjsToolkit card={card} updateCard={updateCard} addToast={addToast} />
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
              onMount={handleEditorDidMount}
              options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 14, lineHeight: 24, padding: { top: 16 } }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
