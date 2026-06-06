import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { callProvider } from '../utils/apiClient';
import { 
  X, Send, Code2, Copy, Trash2, Upload, Loader2, Settings, Plus, FileText, 
  Sparkles, Check, Download, AlertCircle, RefreshCw, Eye, Flame, RotateCcw,
  Maximize, Minimize, Play, Languages, ChevronDown, ChevronRight, AlertTriangle, Regex,
  ArrowRight, CheckCircle2
} from 'lucide-react';
import type { TranslationField, CharacterBookEntry, RegexScript, TavernHelperScript } from '../types/card';
import { 
  generateWithContinuation, 
  generateUUID, 
  MVU_REGEXES, 
  MVU_RUNTIME_SCRIPT, 
  ZOD_SCHEMA_SCRIPT_TEMPLATE,
  injectTavernHelperScripts,
  injectCustomTavernHelperScript
} from '../utils/mvuGenerator';
import { extractTranslatableFields } from '../utils/cardFields';
import { MVU_SCHEMA_GENERATION_PROMPT, MVU_RULES_GENERATION_PROMPT } from '../utils/promptBuilder';
import { MVU_KNOWLEDGE_BASE, type MvuDoc } from '../utils/mvuKnowledgeBase';

/* ════════════════════════════════════════════════════════════════════
   TYPES
   ════════════════════════════════════════════════════════════════════ */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  isCommand?: boolean;
}

interface AttachedFile {
  name: string;
  size: number;
  content: string;
  isImage?: boolean;
}

/* ════════════════════════════════════════════════════════════════════
   HELPER: Render fully interactive HTML preview with jQuery & ST CSS
   ════════════════════════════════════════════════════════════════════ */
const renderSafeHtml = (htmlContent: string) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <style>
          body {
            margin: 0;
            padding: 12px 16px;
            background: #0f0f12;
            color: #e8e6f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 0.9rem;
            line-height: 1.7;
          }
          /* Custom SillyTavern Chat Bubble CSS */
          .chinh_van {
            border-left: 3px solid #6366f1;
            padding-left: 10px;
            margin: 4px 0;
            color: #c7d2fe;
          }
          .thoai {
            color: #67e8f9;
            font-style: italic;
          }
          .hanhdong {
            color: #fbbf24;
            font-style: italic;
            font-family: monospace;
          }
          .suy_nghi {
            color: #c084fc;
            font-style: italic;
            opacity: 0.85;
          }
          .regex-error {
            color: #f06a6a;
            font-family: monospace;
            font-size: 0.8rem;
            padding: 4px 8px;
            background: rgba(240, 106, 106, 0.1);
            border-radius: 4px;
          }
          
          /* Native ST/Tavern accordion details */
          .section {
            border-bottom: 1px solid #2a2a3e;
            margin-bottom: 6px;
          }
          .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            background: #16161e;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.85rem;
            color: #a09cb5;
            transition: background 0.15s;
          }
          .section-header:hover {
            background: #2a2a3e;
            color: #e8e6f0;
          }
          .section-content {
            padding: 12px 14px;
            font-size: 0.82rem;
            color: #e8e6f0;
          }
          .hidden {
            display: none !important;
          }
          .divider {
            height: 1px;
            background: #2a2a3e;
            margin: 8px 0;
          }
          ul.scroll-list {
            list-style: none;
            padding: 0;
            margin: 0;
            overflow-y: auto;
          }
          li.list-item {
            display: flex;
            justify-content: space-between;
            padding: 6px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.03);
          }
          .badge {
            font-size: 0.7rem;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 99px;
            background: rgba(160,156,181,0.1);
            color: #a09cb5;
            margin-left: 6px;
          }
        </style>
      </head>
      <body>
        <div class="st-preview">
          ${htmlContent}
        </div>
        
        <script>
          // Automatic accordion toggler fallback for ST-style script accordions
          $(document).ready(function() {
            // Bind section togglers
            $(document).on('click', '.section-header', function() {
              $(this).toggleClass('collapsed');
              $(this).next('.section-content').toggleClass('hidden');
            });
            
            // Log interaction
            console.log('ST Accoridon and Event fallback binders executed.');
          });
        </script>
      </body>
    </html>
  `;
};

/* ════════════════════════════════════════════════════════════════════
   DEFAULT ST PRESETS — 4 universal regex presets for SillyTavern
   ════════════════════════════════════════════════════════════════════ */
const ST_DEFAULT_PRESETS = [
  {
    id: 'st_dialogue',
    name: 'Tô màu hội thoại "..."',
    find: '/"([^"]+)"/g',
    replace: '<span class="thoai">"$1"</span>',
    flags: 'g',
    description: 'Bọc nội dung đối thoại trong dấu ngoặc kép bằng class thoại (hiển thị màu khác biệt)',
    isCustom: false,
  },
  {
    id: 'st_action',
    name: 'Tô màu hành động *...*',
    find: '/\\*([^*]+)\\*/g',
    replace: '<span class="hanhdong">*$1*</span>',
    flags: 'g',
    description: 'Bọc hành động nhân vật trong dấu sao bằng class hành động',
    isCustom: false,
  },
  {
    id: 'st_thought',
    name: 'Tô màu suy nghĩ (...)',
    find: '/\\(([^)]+)\\)/g',
    replace: '<span class="suy_nghi">($1)</span>',
    flags: 'g',
    description: 'Bọc suy nghĩ nội tâm trong ngoặc tròn bằng class suy_nghĩ',
    isCustom: false,
  },
  {
    id: 'st_prose',
    name: 'Tô màu chính văn (phần còn lại)',
    find: '/^(?![\\s]*<span)(.+)$/gm',
    replace: '<span class="chinh_van">$1</span>',
    flags: 'gm',
    description: 'Bọc đoạn văn tự sự (không phải hội thoại/hành động) bằng class chính văn',
    isCustom: false,
  },
];

/* ════════════════════════════════════════════════════════════════════
   SAMPLE TEXT for sandbox preview
   ════════════════════════════════════════════════════════════════════ */
const SAMPLE_TEXT = `"Ngươi muốn gì?" Nàng nhìn ta bằng ánh mắt lạnh lùng.

*Lý Mộ Bạch khẽ nghiêng đầu, mỉm cười*

(Không ngờ nàng lại mạnh đến vậy... Ta phải cẩn thận.)

Ánh trăng chiếu rọi qua cửa sổ, phủ lên gương mặt nàng một lớp ánh bạc mỏng manh.`;

/* ════════════════════════════════════════════════════════════════════
   HELPER: safely apply regex for sandbox preview
   ════════════════════════════════════════════════════════════════════ */
function safeApplyRegex(text: string, findStr: string, replaceStr: string): { result: string; error?: string } {
  try {
    // Parse /pattern/flags format
    const match = findStr.match(/^\/(.+)\/([gimsuy]*)$/);
    if (!match) {
      // Try raw pattern
      const regex = new RegExp(findStr, 'g');
      return { result: text.replace(regex, replaceStr) };
    }
    const regex = new RegExp(match[1], match[2] || 'g');
    return { result: text.replace(regex, replaceStr) };
  } catch (err: any) {
    return { result: text, error: err.message };
  }
}


/* ════════════════════════════════════════════════════════════════════
   SYSTEM INSTRUCTION & PROMPTS
   ════════════════════════════════════════════════════════════════════ */
const SYSTEM_INSTRUCTION = `
Bạn là "Trợ Lý AI" - một chuyên gia lập trình và trợ lý kỹ thuật chuyên sâu được tích hợp trực tiếp vào ứng dụng SillyTavern Character Card Translator.
Nhiệm vụ chính của bạn là hỗ trợ người dùng thiết kế, chỉnh sửa, dịch thuật và tối ưu hóa các thẻ nhân vật SillyTavern (định dạng JSON V2/V3), viết mã EJS, cấu hình kịch bản TavernHelper và viết các biểu thức chính quy (Regex).

VĂN PHONG & QUY TẮC ỨNG XỬ:
- Thân thiện, chuyên nghiệp, rõ ràng và tập trung hoàn toàn vào kỹ thuật.
- Trả lời bằng tiếng Việt chuẩn. Tránh mọi yếu tố xưng hô tu tiên, tu chân (KHÔNG sử dụng các từ như huynh, thiếp, lang quân, đạo lữ, pháp trận, linh ảnh...). Sử dụng cách xưng hô chuẩn mực: "Tôi" và "Bạn".
- Luôn cung cấp các khối mã nguồn (code blocks) chính xác, rõ ràng khi được yêu cầu.
- Luôn kiểm tra tính tương thích của biểu thức chính quy (Regex) đối với iOS/Safari, cảnh báo người dùng tránh sử dụng lookbehind (?<=...) vì có thể làm đơ thiết bị iOS.

NGỮ CẢNH:
- Bạn sẽ nhận được thông tin chi tiết về thẻ nhân vật đang mở trong ứng dụng dưới dạng văn bản JSON để làm ngữ cảnh trả lời.
- Bạn cũng có thể nhận được thêm nội dung từ các tệp đính kèm do người dùng tải lên bổ sung.
`;

/* ════════════════════════════════════════════════════════════════════
   SIMPLE MARKDOWN & CODE HIGHLIGHT PARSER
   ════════════════════════════════════════════════════════════════════ */
const MessageContentRenderer = memo(({ content }: { content: string }) => {
  // Simple custom parser for bold (**text**) and code blocks (```lang code```)
  const parts = useMemo(() => {
    if (!content) return [];
    
    const elements: React.ReactNode[] = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    
    let lastIndex = 0;
    let match;
    let index = 0;

    while ((match = regex.exec(content)) !== null) {
      const textBefore = content.substring(lastIndex, match.index);
      const language = match[1] || 'text';
      const code = match[2];

      if (textBefore) {
        elements.push(<TextSection key={`text-${index}`} text={textBefore} />);
        index++;
      }

      elements.push(<CodeSection key={`code-${index}`} language={language} code={code} />);
      index++;
      lastIndex = regex.lastIndex;
    }

    const remainingText = content.substring(lastIndex);
    if (remainingText) {
      elements.push(<TextSection key={`text-${index}`} text={remainingText} />);
    }

    return elements;
  }, [content]);

  return <div className="space-y-2">{parts}</div>;
});

const TextSection = memo(({ text }: { text: string }) => {
  // Convert basic **bold** to JSX
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, lIdx) => {
        const parts = [];
        const boldRegex = /\*\*([\s\S]*?)\*\*/g;
        let lastIdx = 0;
        let match;
        let pIdx = 0;

        while ((match = boldRegex.exec(line)) !== null) {
          if (match.index > lastIdx) {
            parts.push(<span key={pIdx++}>{line.substring(lastIdx, match.index)}</span>);
          }
          parts.push(<strong key={pIdx++} className="font-bold text-indigo-400">{match[1]}</strong>);
          lastIdx = boldRegex.lastIndex;
        }

        if (lastIdx < line.length) {
          parts.push(<span key={pIdx++}>{line.substring(lastIdx)}</span>);
        }

        return (
          <p key={lIdx} className="text-slate-200 text-sm leading-relaxed min-h-[1.2rem]">
            {parts}
          </p>
        );
      })}
    </div>
  );
});

const CodeSection = memo(({ language, code }: { language: string; code: string }) => {
  const { card, updateCard, addToast, setFields } = useStore();
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Quick Inject Forms State
  const [activeForm, setActiveForm] = useState<'none' | 'lorebook' | 'regex' | 'tavern_helper'>('none');
  const [lbKeys, setLbKeys] = useState('');
  const [lbComment, setLbComment] = useState('');
  const [rgName, setRgName] = useState('');
  const [rgFind, setRgFind] = useState('');
  const [rgReplace, setRgReplace] = useState('');
  const [thName, setThName] = useState('');
  const [thInfo, setThInfo] = useState('');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code-snippet.${language === 'javascript' ? 'js' : language === 'typescript' ? 'ts' : language === 'json' ? 'json' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAddToLorebook = () => {
    if (!card) {
      addToast('error', 'Chưa có thẻ nhân vật nào được tải lên!');
      return;
    }
    if (!lbKeys.trim()) {
      addToast('error', 'Vui lòng nhập từ khóa (keys) kích hoạt!');
      return;
    }

    try {
      const newCard = JSON.parse(JSON.stringify(card));
      if (!newCard.data) newCard.data = {};
      if (!newCard.data.character_book) newCard.data.character_book = { entries: [] };

      const newEntry: CharacterBookEntry = {
        id: Date.now(),
        keys: lbKeys.split(',').map(k => k.trim()).filter(Boolean),
        comment: lbComment.trim() || 'Tạo từ Trợ lý AI',
        content: code,
        enabled: true,
        insertion_order: 10,
        position: 'before_char',
        constant: true,
      };

      newCard.data.character_book.entries.push(newEntry);
      updateCard(newCard);

      // Refresh translatable fields list on UI
      const enabledGroupIds = useStore.getState().translationConfig.fieldGroups.filter(g => g.enabled).map(g => g.id);
      const newFields = extractTranslatableFields(newCard, enabledGroupIds);
      const existingMap = new Map(useStore.getState().fields.map(f => [f.path, f]));
      const updatedFields = newFields.map(nf => {
        const existing = existingMap.get(nf.path);
        if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
          return existing;
        }
        return nf;
      });
      for (const ef of useStore.getState().fields) {
        if (!updatedFields.some(uf => uf.path === ef.path)) {
          updatedFields.push(ef);
        }
      }
      setFields(updatedFields);

      addToast('success', 'Đã thêm entry mới vào Lorebook thành công!');
      setActiveForm('none');
      setLbKeys('');
      setLbComment('');
    } catch (err: any) {
      console.error(err);
      addToast('error', `Lỗi: ${err.message || 'Không thể thêm vào Lorebook'}`);
    }
  };

  const handleAddToRegex = () => {
    if (!card) {
      addToast('error', 'Chưa có thẻ nhân vật nào được tải lên!');
      return;
    }
    if (!rgFind.trim()) {
      addToast('error', 'Vui lòng nhập Regex tìm kiếm (findRegex)!');
      return;
    }

    try {
      const newCard = JSON.parse(JSON.stringify(card));
      if (!newCard.data) newCard.data = {};
      if (!newCard.data.extensions) newCard.data.extensions = {};
      if (!newCard.data.extensions.regex_scripts) newCard.data.extensions.regex_scripts = [];

      const newRegex: RegexScript = {
        scriptName: rgName.trim() || 'Regex Script mới',
        findRegex: rgFind.trim(),
        replaceString: rgReplace,
        placement: ['1'],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: true,
        minDepth: 0,
        maxDepth: 0,
      };

      newCard.data.extensions.regex_scripts.push(newRegex);
      updateCard(newCard);

      // Refresh translatable fields list on UI
      const enabledGroupIds = useStore.getState().translationConfig.fieldGroups.filter(g => g.enabled).map(g => g.id);
      const newFields = extractTranslatableFields(newCard, enabledGroupIds);
      const existingMap = new Map(useStore.getState().fields.map(f => [f.path, f]));
      const updatedFields = newFields.map(nf => {
        const existing = existingMap.get(nf.path);
        if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
          return existing;
        }
        return nf;
      });
      for (const ef of useStore.getState().fields) {
        if (!updatedFields.some(uf => uf.path === ef.path)) {
          updatedFields.push(ef);
        }
      }
      setFields(updatedFields);

      addToast('success', 'Đã thêm regex script mới thành công!');
      setActiveForm('none');
      setRgName('');
      setRgFind('');
      setRgReplace('');
    } catch (err: any) {
      console.error(err);
      addToast('error', `Lỗi: ${err.message || 'Không thể thêm Regex script'}`);
    }
  };

  const handleAddToTavernHelper = () => {
    if (!card) {
      addToast('error', 'Chưa có thẻ nhân vật nào được tải lên!');
      return;
    }

    try {
      const newCard = JSON.parse(JSON.stringify(card));
      if (!newCard.data) newCard.data = {};
      if (!newCard.data.extensions) newCard.data.extensions = {};

      const newScript: TavernHelperScript = {
        type: 'script',
        enabled: true,
        name: thName.trim() || 'Script mới',
        id: generateUUID(),
        content: code,
        info: thInfo.trim() || 'Tạo bởi Trợ lý AI',
        button: { enabled: false, buttons: [] },
        data: {}
      };

      injectCustomTavernHelperScript(newCard.data.extensions, newScript);
      updateCard(newCard);

      // Refresh translatable fields list on UI
      const enabledGroupIds = useStore.getState().translationConfig.fieldGroups.filter(g => g.enabled).map(g => g.id);
      const newFields = extractTranslatableFields(newCard, enabledGroupIds);
      const existingMap = new Map(useStore.getState().fields.map(f => [f.path, f]));
      const updatedFields = newFields.map(nf => {
        const existing = existingMap.get(nf.path);
        if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
          return existing;
        }
        return nf;
      });
      for (const ef of useStore.getState().fields) {
        if (!updatedFields.some(uf => uf.path === ef.path)) {
          updatedFields.push(ef);
        }
      }
      setFields(updatedFields);

      addToast('success', 'Đã tích hợp TavernHelper script mới thành công!');
      setActiveForm('none');
      setThName('');
      setThInfo('');
    } catch (err: any) {
      console.error(err);
      addToast('error', `Lỗi: ${err.message || 'Không thể thêm TavernHelper script'}`);
    }
  };

  const isHtmlLike = ['html', 'xml', 'svg', 'markup'].includes((language || '').toLowerCase());
  const isFullPage = /<!DOCTYPE|<html>|<body/i.test(code);

  return (
    <>
      <div className="rounded-xl overflow-hidden my-4 border border-zinc-800 bg-[#09090b] shadow-lg">
        <div className="bg-[#18181b] px-4 py-2 text-[10px] font-sans font-bold text-slate-400 flex items-center justify-between border-b border-zinc-850">
          <span className="tracking-wider uppercase text-indigo-400">{language}</span>
          <div className="flex items-center gap-2">
            {isHtmlLike && (
              <>
                <button 
                  onClick={() => setShowPreview(!showPreview)}
                  className="hover:text-white flex items-center gap-1 px-2 py-0.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded text-[9px] transition-all font-bold"
                >
                  {showPreview ? <Code2 size={10} /> : <Eye size={10} />}
                  {showPreview ? 'MÃ NGUỒN' : 'XEM PREVIEW'}
                </button>
                {showPreview && (
                  <button 
                    onClick={() => setIsFullscreen(true)}
                    className="hover:text-white flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded text-[9px] transition-all font-bold"
                    title="Mở rộng xem toàn màn hình"
                  >
                    <Maximize size={10} /> PHÓNG TO
                  </button>
                )}
              </>
            )}
            <button 
              onClick={handleDownload}
              className="hover:text-white flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded text-[9px] transition-colors"
            >
              <Download size={10} /> TẢI VỀ
            </button>
            <button 
              onClick={handleCopy}
              className="hover:text-white flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded text-[9px] transition-colors"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              {copied ? 'ĐÃ COPY' : 'COPY'}
            </button>
          </div>
        </div>
        {showPreview ? (
          isFullPage ? (
            <div style={{ background: '#ffffff', padding: '8px' }}>
              <iframe
                title="HTML Preview"
                srcDoc={code}
                sandbox="allow-scripts"
                style={{
                  width: '100%',
                  height: '420px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  background: '#ffffff',
                }}
              />
            </div>
          ) : (
            <div className="p-4 bg-[#09090b]">
              <iframe
                title="HTML Preview"
                srcDoc={renderSafeHtml(code)}
                sandbox="allow-scripts"
                style={{
                  width: '100%',
                  height: '320px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: '#0f0f12',
                }}
              />
            </div>
          )
        ) : (
          <pre className="p-4 overflow-x-auto text-xs font-mono text-slate-300 leading-relaxed max-h-[400px] custom-scrollbar">
            <code>{code}</code>
          </pre>
        )}

        {/* Quick Inject Toolbar */}
        <div className="bg-[#101014] px-4 py-2 border-t border-zinc-850 flex items-center justify-between text-[11px] text-slate-400">
          <span>Đưa nhanh vào Thẻ:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveForm(activeForm === 'lorebook' ? 'none' : 'lorebook')}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                activeForm === 'lorebook'
                  ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold'
                  : 'bg-zinc-800/40 border-zinc-700 hover:bg-zinc-850 text-slate-300'
              }`}
            >
              + Lorebook
            </button>
            <button
              onClick={() => {
                setActiveForm(activeForm === 'regex' ? 'none' : 'regex');
                if (activeForm !== 'regex') {
                  setRgReplace(code);
                }
              }}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                activeForm === 'regex'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300 font-bold'
                  : 'bg-zinc-800/40 border-zinc-700 hover:bg-zinc-850 text-slate-300'
              }`}
            >
              + Regex
            </button>
            <button
              onClick={() => setActiveForm(activeForm === 'tavern_helper' ? 'none' : 'tavern_helper')}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                activeForm === 'tavern_helper'
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 font-bold'
                  : 'bg-zinc-800/40 border-zinc-700 hover:bg-zinc-850 text-slate-300'
              }`}
            >
              + TavernHelper
            </button>
          </div>
        </div>

        {/* Form Lorebook */}
        {activeForm === 'lorebook' && (
          <div className="bg-[#131317] p-3 border-t border-zinc-850 flex flex-col gap-2.5 animate-fadeIn">
            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Tạo Lorebook Entry</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">Từ khóa kích hoạt (Keys - phân cách bằng dấu phẩy):</label>
                <input
                  type="text"
                  placeholder="Ví dụ: [initvar], mvu_update"
                  value={lbKeys}
                  onChange={e => setLbKeys(e.target.value)}
                  style={{
                    background: '#09090b',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.7rem',
                    padding: '4px 8px',
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">Chú thích (Comment):</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Hệ thống biến số"
                  value={lbComment}
                  onChange={e => setLbComment(e.target.value)}
                  style={{
                    background: '#09090b',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.7rem',
                    padding: '4px 8px',
                  }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 text-[10px] mt-1">
              <button
                onClick={() => setActiveForm('none')}
                className="btn btn-ghost btn-xs text-slate-400"
              >
                Hủy
              </button>
              <button
                onClick={handleAddToLorebook}
                disabled={!lbKeys.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded px-3 py-1 active:scale-95 transition-all shadow-sm"
              >
                Xác nhận thêm
              </button>
            </div>
          </div>
        )}

        {/* Form Regex */}
        {activeForm === 'regex' && (
          <div className="bg-[#131317] p-3 border-t border-zinc-850 flex flex-col gap-2.5 animate-fadeIn">
            <div className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Tạo Regex Script</div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">Tên Script:</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Định dạng hội thoại"
                  value={rgName}
                  onChange={e => setRgName(e.target.value)}
                  style={{
                    background: '#09090b',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.7rem',
                    padding: '4px 8px',
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-slate-400 font-semibold">Tìm kiếm (Find Regex):</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: /([a-z]+)/g"
                    value={rgFind}
                    onChange={e => setRgFind(e.target.value)}
                    style={{
                      background: '#09090b',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.7rem',
                      padding: '4px 8px',
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-slate-400 font-semibold">Thay thế (Replace String):</label>
                  <input
                    type="text"
                    placeholder="Bỏ trống hoặc nhập chuỗi thay thế"
                    value={rgReplace}
                    onChange={e => setRgReplace(e.target.value)}
                    style={{
                      background: '#09090b',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.7rem',
                      padding: '4px 8px',
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 text-[10px] mt-1">
              <button
                onClick={() => setActiveForm('none')}
                className="btn btn-ghost btn-xs text-slate-400"
              >
                Hủy
              </button>
              <button
                onClick={handleAddToRegex}
                disabled={!rgFind.trim()}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold rounded px-3 py-1 active:scale-95 transition-all shadow-sm"
              >
                Xác nhận thêm
              </button>
            </div>
          </div>
        )}

        {/* Form TavernHelper */}
        {activeForm === 'tavern_helper' && (
          <div className="bg-[#131317] p-3 border-t border-zinc-850 flex flex-col gap-2.5 animate-fadeIn">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Tạo TavernHelper Script</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">Tên Script:</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Cập nhật trạng thái"
                  value={thName}
                  onChange={e => setThName(e.target.value)}
                  style={{
                    background: '#09090b',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.7rem',
                    padding: '4px 8px',
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">Thông tin mô tả (Info):</label>
                <input
                  type="text"
                  placeholder="Mô tả chức năng script"
                  value={thInfo}
                  onChange={e => setThInfo(e.target.value)}
                  style={{
                    background: '#09090b',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.7rem',
                    padding: '4px 8px',
                  }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 text-[10px] mt-1">
              <button
                onClick={() => setActiveForm('none')}
                className="btn btn-ghost btn-xs text-slate-400"
              >
                Hủy
              </button>
              <button
                onClick={handleAddToTavernHelper}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded px-3 py-1 active:scale-95 transition-all shadow-sm"
              >
                Xác nhận thêm
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Fullscreen Modal Overlay */}
      {isFullscreen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(9, 9, 11, 0.96)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px',
          animation: 'fadeIn 0.2s ease',
        }}>
          {/* Header of Fullscreen Preview */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="text-sm font-bold text-slate-200">Xem Trước HTML Toàn Màn Hình</span>
              <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: '3px', color: 'var(--text-muted)' }}>
                {isFullPage ? 'Trang nguyên bản (IFrame)' : 'Đoạn phân mảnh (SillyTavern CSS)'}
              </span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsFullscreen(false)}
              style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Minimize size={14} /> Thu nhỏ
            </button>
          </div>

          {/* Preview Container */}
          <div style={{ flex: 1, overflow: 'hidden', background: isFullPage ? '#ffffff' : '#09090b', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
            {isFullPage ? (
              <iframe
                title="HTML Preview Fullscreen"
                srcDoc={code}
                sandbox="allow-scripts"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#ffffff',
                }}
              />
            ) : (
              <iframe
                title="HTML Preview Fullscreen"
                srcDoc={renderSafeHtml(code)}
                sandbox="allow-scripts"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#0f0f12',
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
});

const MessageList = memo(({
  messages,
  isGenerating,
  retryText,
  messagesEndRef
}: {
  messages: Message[];
  isGenerating: boolean;
  retryText: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) => {
  return (
    <div className="companion-chat-messages custom-scrollbar">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center max-w-[450px] mx-auto space-y-4 opacity-75">
          <div style={{
            width: '60px', height: '60px', borderRadius: '50%',
            background: 'rgba(99, 102, 241, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-primary)'
          }}>
            <Code2 size={28} />
          </div>
          <div className="space-y-1.5">
            <h4 className="font-bold text-slate-200">Trợ lý Lập trình Thẻ Nhân vật</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Chào bạn! Tôi có thể giúp bạn viết/sửa biểu thức chính quy (Regex), lập trình logic EJS cho Lorebook, kiểm tra lỗi cú pháp hoặc phân dịch các thành phần nâng cao.
            </p>
          </div>
        </div>
      ) : (
        messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`companion-message-wrapper ${msg.role}`}
          >
            <div className="companion-message-sender">
              {msg.role === 'user' ? (msg.isCommand ? '⚡ Lệnh' : 'Người dùng') : 'Trợ lý AI'}
            </div>
            <div className="companion-message-bubble">
              <MessageContentRenderer content={msg.content} />
            </div>
          </div>
        ))
      )}
      
      {/* Thinking Loader */}
      {isGenerating && (
        <div className="companion-message-wrapper assistant">
          <div className="companion-message-sender">Trợ lý AI</div>
          <div className="flex flex-col gap-1.5 py-2">
            <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
              <Loader2 size={14} className="animate-spin" /> Đang phân tích và viết câu trả lời...
            </div>
            {retryText && (
              <div className="text-[10px] text-amber-500 font-mono pl-5 animate-pulse">
                {retryText}
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
});

/* ════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════ */
export default function AiCompanionPanel({ onClose }: { onClose: () => void }) {
  const { card, proxy, updateCard, addToast } = useStore();
  
  // ─── Local Storage States ───
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem('ai_assistant_messages');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(() => {
    try {
      const saved = localStorage.getItem('ai_assistant_attached_files');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [nsfwEnabled, setNsfwEnabled] = useState(() => {
    return localStorage.getItem('ai_assistant_nsfw') === 'true';
  });

  const [autoRetry, setAutoRetry] = useState(() => {
    return localStorage.getItem('ai_assistant_auto_retry') !== 'false';
  });

  // ─── Interactive States ───
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [retryText, setRetryText] = useState('');
  const [uploadError, setUploadError] = useState('');

  // ─── Tab State ───
  const [activeTab, setActiveTab] = useState<'chat' | 'sandbox' | 'presets' | 'mvu-zod'>('chat');

  // ─── Sandbox States ───
  const [sandboxInput, setSandboxInput] = useState(SAMPLE_TEXT);
  const [sandboxFind, setSandboxFind] = useState('');
  const [sandboxReplace, setSandboxReplace] = useState('');

  // ─── Presets States ───
  const [customPresets, setCustomPresets] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('regex_custom_presets');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showNewPreset, setShowNewPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetFind, setNewPresetFind] = useState('');
  const [newPresetReplace, setNewPresetReplace] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');

  // Save custom presets to localStorage
  useEffect(() => {
    localStorage.setItem('regex_custom_presets', JSON.stringify(customPresets));
  }, [customPresets]);

  // Compute sandbox result
  const sandboxResult = useMemo(() => {
    if (!sandboxFind) return { result: sandboxInput };
    return safeApplyRegex(sandboxInput, sandboxFind, sandboxReplace);
  }, [sandboxInput, sandboxFind, sandboxReplace]);

  // Compute preview with presets
  const previewWithPresets = useMemo(() => {
    let text = SAMPLE_TEXT;
    // Apply defaults
    ST_DEFAULT_PRESETS.forEach(p => {
      const res = safeApplyRegex(text, p.find, p.replace);
      text = res.result;
    });
    // Apply customs
    customPresets.forEach(p => {
      const res = safeApplyRegex(text, p.find, p.replace);
      text = res.result;
    });
    return text;
  }, [customPresets]);

  // Handlers for presets
  const handleAddPreset = () => {
    if (!newPresetName.trim() || !newPresetFind.trim()) return;
    const newPreset = {
      id: 'custom_' + Date.now(),
      name: newPresetName,
      find: newPresetFind,
      replace: newPresetReplace,
      description: newPresetDesc,
      isCustom: true,
    };
    setCustomPresets(prev => [...prev, newPreset]);
    // Reset fields
    setNewPresetName('');
    setNewPresetFind('');
    setNewPresetReplace('');
    setNewPresetDesc('');
    setShowNewPreset(false);
  };

  const handleDeletePreset = (id: string) => {
    setCustomPresets(prev => prev.filter(p => p.id !== id));
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('ai_assistant_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('ai_assistant_attached_files', JSON.stringify(attachedFiles));
  }, [attachedFiles]);

  useEffect(() => {
    localStorage.setItem('ai_assistant_nsfw', String(nsfwEnabled));
  }, [nsfwEnabled]);

  useEffect(() => {
    localStorage.setItem('ai_assistant_auto_retry', String(autoRetry));
  }, [autoRetry]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // ─── Context Compilation ───
  const contextBlock = useMemo(() => {
    let context = '';
    
    // 1. Auto-loaded active card context
    if (card) {
      const summary = {
        name: card.name || card.data?.name || 'Unknown',
        description: card.data?.description ? (card.data.description.length > 500 ? card.data.description.slice(0, 500) + '...' : card.data.description) : '',
        lorebookEntries: card.data?.character_book?.entries?.length || 0,
        regexCount: card.data?.extensions?.regex_scripts?.length || 0,
        tavernHelperScripts: card.data?.extensions?.tavern_helper?.scripts?.length || 0,
      };
      context += `[NGỮ CẢNH CARD ĐANG MỞ]:\n${JSON.stringify(summary, null, 2)}\n\n`;
    }
    
    // 2. Extra attached files
    if (attachedFiles.length > 0) {
      attachedFiles.forEach(f => {
        if (f.isImage) {
          context += `[TỆP ĐÍNH KÈM: ${f.name} (Hình ảnh đính kèm)]\n---\n\n`;
        } else {
          context += `[TỆP ĐÍNH KÈM: ${f.name}]:\n${f.content}\n---\n\n`;
        }
      });
    }

    return context.trim();
  }, [card, attachedFiles]);

  // ─── Send message logic ───
    

  const handleSend = async (forcedCommand?: string) => {
    const textToSend = forcedCommand || inputValue;
    if (!textToSend.trim() || isGenerating) return;

    const userMsg: Message = { 
      role: 'user', 
      content: textToSend,
      isCommand: !!forcedCommand
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!forcedCommand) setInputValue('');
    setIsGenerating(true);
    setRetryText('');

    const maxAttempts = autoRetry ? 3 : 1;
    let attempt = 0;
    let success = false;
    let finalResult = '';
    let lastError: any = null;

    // Build effective prompt
    const systemPrompt = `${SYSTEM_INSTRUCTION}
${nsfwEnabled ? '\n[CẦN CHÚ Ý: ĐÃ BẬT CHẾ ĐỘ R18/NSFW. Cho phép xử lý nội dung nhạy cảm người lớn nếu người dùng yêu cầu.]' : ''}
${contextBlock ? `\n[DANH SÁCH TÀI LIỆU NGỮ CẢNH HIỆN TẠI]:\n${contextBlock}` : ''}`;

    // Extract images base64
    const imagesList = attachedFiles.filter(f => f.isImage).map(f => f.content);

    while (attempt < maxAttempts) {
      try {
        if (attempt > 0) {
          setRetryText(`Đang thử gửi lại yêu cầu (${attempt}/${maxAttempts - 1})...`);
        }
        
        finalResult = await callProvider(proxy, systemPrompt, textToSend, undefined, imagesList.length > 0 ? imagesList : undefined);
        
        let continuationCount = 0;
        const maxContinuations = 5;
        while (checkResponseCut(finalResult) && continuationCount < maxContinuations) {
          continuationCount++;
          const continuationPrompt = `${textToSend}\n\n[TIẾP TỤC PHẢN HỒI BỊ CẮT (Lượt ${continuationCount})]\nPhản hồi trước đó của bạn đã bị ngắt giữa chừng do giới hạn token. Dưới đây là TOÀN BỘ nội dung bạn đã viết được cho đến hiện tại:\n"""\n${finalResult}\n"""\n\nHãy tiếp tục viết tiếp ngay sau ký tự cuối cùng của nội dung trên để hoàn thiện phản hồi đầy đủ. KHÔNG viết lại hoặc lặp lại những phần đã có ở trên. Bắt đầu viết trực tiếp từ chữ bị cắt dở dang.`;
          
          const nextChunk = await callProvider(proxy, systemPrompt, continuationPrompt, undefined, undefined);
          if (!nextChunk || !nextChunk.trim()) break;
          finalResult += (nextChunk.startsWith('```') && finalResult.endsWith('```') ? '\n' : '') + nextChunk;
        }
        
        success = true;
        break;
      } catch (err: any) {
        lastError = err;
        attempt++;
        if (attempt < maxAttempts) {
          const backoff = 1500 * attempt + Math.floor(Math.random() * 500);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    if (success) {
      setMessages([...nextMessages, { role: 'assistant', content: finalResult }]);
    } else {
      const errMsg = lastError?.message || 'Không có phản hồi từ máy chủ API.';
      setMessages([...nextMessages, { 
        role: 'assistant', 
        content: `❌ **Lỗi gọi API:** \`${errMsg}\`\n\nHãy kiểm tra lại API Key, Endpoint hoặc trạng thái kết nối mạng của bạn.` 
      }]);
    }

    setIsGenerating(false);
    setRetryText('');
  };

  // Quick Action Commands
  const handleCommand = () => {
    if (!inputValue.trim()) return;
    handleSend(`[LỆNH ƯU TIÊN]: ${inputValue}`);
  };

  const handleContinue = () => {
    handleSend('Hãy tiếp tục xử lý nội dung dựa trên thông tin ngữ cảnh đã đính kèm.');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── File Upload Handler ───
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    setUploadError('');
    try {
      const loaded = await Promise.all(selectedFiles.map(async file => {
        const isImage = file.type.startsWith('image/');
        let content = '';
        if (isImage) {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Lỗi đọc file ảnh.'));
            reader.readAsDataURL(file);
          });
        } else {
          content = await file.text();
          content = content.slice(0, 100000); // limit size to prevent context overflow
        }
        return {
          name: file.name,
          size: file.size,
          content,
          isImage
        };
      }));

      setAttachedFiles(prev => [...prev, ...loaded]);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `📁 **Đã đính kèm ${loaded.some(f => f.isImage) ? 'ảnh/tài liệu' : 'tài liệu'} thành công:** ${selectedFiles.map(f => f.name).join(', ')}.` 
      }]);
    } catch (err: any) {
      setUploadError(err.message || 'Lỗi khi đọc file đính kèm.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (idx: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleClearContext = () => {
    setAttachedFiles([]);
    setMessages(prev => [...prev, { role: 'assistant', content: '🧹 **Đã dọn sạch ngữ cảnh đính kèm.** Bắt đầu phiên làm việc mới.' }]);
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  return (
    <div className="companion-modal-overlay" onClick={onClose}>
      <div className="companion-modal" onClick={e => e.stopPropagation()}>
        
        {/* ══════ COMMON MODAL HEADER ══════ */}
        <div className="companion-chat-header">
          <div className="flex items-center gap-3">
            <div style={{
              width: '32px', height: '32px', borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #a855f7, #6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Sparkles size={16} color="white" />
            </div>
            <div>
              <div className="font-bold text-sm">Trợ Lý AI Lập Trình</div>
              <div className="text-[10px] text-slate-400">
                Model: <span className="text-indigo-400 font-mono font-bold">{proxy.model || 'Chưa thiết lập'}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {activeTab === 'chat' && messages.length > 0 && (
              <button 
                onClick={handleClearChat}
                className="btn btn-ghost btn-xs text-rose-400 hover:bg-rose-500/10"
              >
                <RotateCcw size={12} className="mr-1" /> Xóa chat
              </button>
            )}
            <button 
              onClick={onClose}
              className="p-1 hover:bg-zinc-800 rounded transition-colors text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ══════ TAB BAR ══════ */}
        <div style={{
          padding: '8px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div className="tabs">
            <button
              type="button"
              className={`tab ${activeTab === 'chat' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <Sparkles size={12} style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
              <span style={{ verticalAlign: 'middle' }}>Trò Chuyện</span>
            </button>
            <button
              type="button"
              className={`tab ${activeTab === 'sandbox' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('sandbox')}
            >
              <Play size={12} style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
              <span style={{ verticalAlign: 'middle' }}>Sandbox</span>
            </button>
            <button
              type="button"
              className={`tab ${activeTab === 'presets' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('presets')}
            >
              <Languages size={12} style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
              <span style={{ verticalAlign: 'middle' }}>Presets</span>
            </button>
            <button
              type="button"
              className={`tab ${activeTab === 'mvu-zod' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('mvu-zod')}
            >
              <Code2 size={12} style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
              <span style={{ verticalAlign: 'middle' }}>Tạo MVU-Zod</span>
            </button>
          </div>
        </div>

        {/* ══════ TAB CONTENT ══════ */}
        {activeTab === 'chat' && (
          <div className="companion-chat-layout">
            {/* ══════ LEFT COLUMN: CHAT ══════ */}
            <div className="companion-chat-area">
              {/* Message Log */}
              <MessageList 
                messages={messages} 
                isGenerating={isGenerating} 
                retryText={retryText} 
                messagesEndRef={messagesEndRef} 
              />

              {/* Chat Input Container */}
              <div className="companion-input-container">
                <div className="companion-input-box">
                  <textarea
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Nhập câu hỏi hoặc yêu cầu tại đây... (Shift + Enter để xuống dòng)"
                    className="companion-textarea custom-scrollbar"
                    disabled={isGenerating}
                  />
                  <div className="companion-input-actions">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-500 flex items-center gap-1 select-none">
                        <kbd className="kbd-key">Enter</kbd> Gửi
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {contextBlock && (
                        <button
                          onClick={handleContinue}
                          disabled={isGenerating}
                          title="Tiếp tục xử lý ngữ cảnh cũ"
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 flex items-center gap-1 text-[10px] font-bold transition-all whitespace-nowrap"
                        >
                          Tiếp tục
                        </button>
                      )}
                      <button
                        onClick={handleCommand}
                        disabled={!inputValue.trim() || isGenerating}
                        title="Gửi dưới dạng Lệnh Ưu Tiên"
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg px-2.5 py-1.5 flex items-center gap-1 text-[10px] font-bold transition-all"
                      >
                        Linh Lệnh ⚔️
                      </button>
                      <button
                        onClick={() => handleSend()}
                        disabled={!inputValue.trim() || isGenerating}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3.5 py-1.5 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                      >
                        Gửi <Send size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ══════ RIGHT COLUMN: SIDEBAR ══════ */}
            <div className="companion-sidebar">
              {/* Card metadata (auto-loaded context) */}
              <div className="p-4 border-bottom border-zinc-800">
                <div className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider mb-3 flex items-center gap-1">
                  <Eye size={12} /> Ngữ cảnh Thẻ Hồn
                </div>
                
                {card ? (
                  <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 space-y-2">
                    <div className="font-semibold text-xs text-slate-200 truncate" title={card.name || card.data?.name}>
                      {card.name || card.data?.name || 'Thẻ không tên'}
                    </div>
                    <div className="text-[10px] text-slate-400 space-y-1">
                      <div>Loại: <span className="font-mono text-indigo-300">{card.spec || 'Character'}</span></div>
                      <div>Lorebook: <span className="font-mono text-indigo-300">{card.data?.character_book?.entries?.length || 0} mục</span></div>
                      <div>Regex: <span className="font-mono text-indigo-300">{card.data?.extensions?.regex_scripts?.length || 0} script</span></div>
                      {card.data?.extensions?.depth_prompt?.prompt && (
                        <div className="text-emerald-400">✓ Có Depth Prompt</div>
                      )}
                    </div>
                    <div className="text-[9px] text-emerald-400/80 mt-1 flex items-center gap-1 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Đã tự động nạp ngữ cảnh
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 text-center py-4 bg-zinc-900/20 border border-dashed border-zinc-800 rounded-xl">
                    Chưa tải thẻ nhân vật nào
                  </div>
                )}
              </div>

              {/* Files Context Panel */}
              <div className="p-4 flex-1 flex flex-col min-h-0 border-bottom border-zinc-800">
                <div className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider mb-2 flex justify-between items-center">
                  <span>Tài Liệu Đính Kèm</span>
                  {attachedFiles.length > 0 && (
                    <button 
                      onClick={handleClearContext}
                      className="text-rose-400 hover:text-rose-300 transition-colors text-[9px] font-bold flex items-center gap-0.5"
                      title="Dọn sạch file đính kèm"
                    >
                      <Trash2 size={10} /> DỌN DẸP
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar mb-3">
                  {attachedFiles.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-8 gap-2">
                      <Upload size={24} />
                      <p className="text-[10px]">Chưa đính kèm tài liệu</p>
                    </div>
                  ) : (
                    attachedFiles.map((file, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/80 px-2 py-1.5 rounded-lg group"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {file.isImage ? (
                            <img 
                              src={file.content} 
                              alt={file.name} 
                              className="w-5 h-5 object-cover rounded border border-zinc-700 flex-shrink-0"
                            />
                          ) : (
                            <FileText size={12} className="text-indigo-400 flex-shrink-0" />
                          )}
                          <span className="text-[10px] font-mono truncate text-slate-300" title={file.name}>
                            {file.name}
                          </span>
                        </div>
                        <button 
                          onClick={() => handleRemoveFile(idx)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-rose-500 transition-all hover:bg-rose-500/10 rounded"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {uploadError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] p-2.5 rounded-xl leading-relaxed space-y-1 mb-2">
                    <div className="font-semibold flex items-center gap-1">
                      <AlertCircle size={10} className="text-rose-400 shrink-0" />
                      <span>Lỗi tệp tin:</span>
                    </div>
                    <p className="break-all font-mono text-[9px] bg-black/20 p-1 rounded">{uploadError}</p>
                  </div>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2 border border-dashed border-zinc-800 rounded-xl text-center text-[10px] font-semibold text-slate-400 hover:bg-zinc-800/50 hover:border-indigo-500 hover:text-indigo-400 transition-all flex items-center justify-center gap-1"
                >
                  <Plus size={12} /> Đính kèm tệp/ảnh
                </button>
                <input 
                  type="file" 
                  multiple 
                  className="hidden" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload}
                  accept="image/*,.json,.js,.jsx,.ts,.tsx,.txt,.md,.css,.html,.yaml,.yml,.xml"
                />
              </div>

              {/* Settings Card */}
              <div className="p-4 space-y-4">
                {/* NSFW Toggle */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-2">
                  <label className="flex items-center justify-between cursor-pointer group select-none">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 group-hover:text-rose-400 transition-colors">
                      <Flame size={12} className="opacity-70 group-hover:opacity-100" />
                      Chế độ NSFW / R18
                    </span>
                    <input 
                      type="checkbox" 
                      checked={nsfwEnabled}
                      onChange={e => setNsfwEnabled(e.target.checked)}
                      className="accent-rose-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    Cho phép dịch và viết các kịch bản nhạy cảm (R18/NSFW).
                  </div>
                </div>

                {/* Auto-Retry Toggle */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-2">
                  <label className="flex items-center justify-between cursor-pointer group select-none">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 group-hover:text-amber-400 transition-colors">
                      <RefreshCw size={12} className="opacity-70 group-hover:opacity-100" />
                      Tự động thử lại
                    </span>
                    <input 
                      type="checkbox" 
                      checked={autoRetry}
                      onChange={e => setAutoRetry(e.target.checked)}
                      className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    Tự động thử lại cuộc gọi API khi xảy ra lỗi mạng hoặc quá tải (Tối đa 3 lần).
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sandbox' && (
          <div className="regex-main-scroll" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
            <SandboxTab
              sandboxInput={sandboxInput}
              setSandboxInput={setSandboxInput}
              sandboxFind={sandboxFind}
              setSandboxFind={setSandboxFind}
              sandboxReplace={sandboxReplace}
              setSandboxReplace={setSandboxReplace}
              sandboxResult={sandboxResult}
            />
          </div>
        )}

        {activeTab === 'presets' && (
          <div className="regex-main-scroll" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
            <PresetsTab
              customPresets={customPresets}
              previewWithPresets={previewWithPresets}
              showNewPreset={showNewPreset}
              setShowNewPreset={setShowNewPreset}
              newPresetName={newPresetName}
              setNewPresetName={setNewPresetName}
              newPresetFind={newPresetFind}
              setNewPresetFind={setNewPresetFind}
              newPresetReplace={newPresetReplace}
              setNewPresetReplace={setNewPresetReplace}
              newPresetDesc={newPresetDesc}
              setNewPresetDesc={setNewPresetDesc}
              handleAddPreset={handleAddPreset}
              handleDeletePreset={handleDeletePreset}
            />
          </div>
        )}

        {activeTab === 'mvu-zod' && (
          <div className="regex-main-scroll" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
            <MvuZodTab />
          </div>
        )}

      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 2: Sandbox — test regex live
   ════════════════════════════════════════════════════════════════════ */
function SandboxTab({
  sandboxInput, setSandboxInput,
  sandboxFind, setSandboxFind,
  sandboxReplace, setSandboxReplace,
  sandboxResult,
}: {
  sandboxInput: string;
  setSandboxInput: (v: string) => void;
  sandboxFind: string;
  setSandboxFind: (v: string) => void;
  sandboxReplace: string;
  setSandboxReplace: (v: string) => void;
  sandboxResult: { result: string; error?: string };
}) {
  const [viewMode, setViewMode] = useState<'render' | 'raw'>('render');
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Input */}
        <div>
          <label className="label">Input Text</label>
          <textarea
            className="input input-mono"
            value={sandboxInput}
            onChange={e => setSandboxInput(e.target.value)}
            rows={4}
            style={{ minHeight: '80px' }}
          />
          <button
            className="btn btn-ghost btn-xs"
            style={{ marginTop: '4px' }}
            onClick={() => setSandboxInput(SAMPLE_TEXT)}
          >
            <RotateCcw size={10} /> Reset mẫu
          </button>
        </div>

        {/* Find / Replace */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label className="label">Find (Regex)</label>
            <input
              className="input input-mono"
              value={sandboxFind}
              onChange={e => setSandboxFind(e.target.value)}
              placeholder='/pattern/flags hoặc raw pattern'
            />
          </div>
          <div>
            <label className="label">Replace</label>
            <input
              className="input input-mono"
              value={sandboxReplace}
              onChange={e => setSandboxReplace(e.target.value)}
              placeholder='Replacement string ($1, $2...)'
            />
          </div>
        </div>

        {/* Error */}
        {sandboxResult.error && (
          <div className="ios-warning">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>Regex error: <code>{sandboxResult.error}</code></span>
          </div>
        )}

        {/* Preview */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label className="label" style={{ margin: 0 }}>Preview</label>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-indigo-400"
                style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={() => setIsFullscreen(true)}
                title="Mở rộng xem toàn màn hình"
              >
                <Maximize size={10} /> Phóng to
              </button>
            </div>
            <div className="tabs" style={{ padding: '2px' }}>
              <button
                type="button"
                className={`tab ${viewMode === 'render' ? 'tab-active' : ''}`}
                onClick={() => setViewMode('render')}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
              >
                Rendered HTML
              </button>
              <button
                type="button"
                className={`tab ${viewMode === 'raw' ? 'tab-active' : ''}`}
                onClick={() => setViewMode('raw')}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
              >
                Raw HTML
              </button>
            </div>
          </div>

          {viewMode === 'render' ? (
            <iframe
              title="Sandbox Rendered Preview"
              srcDoc={renderSafeHtml(sandboxResult.result)}
              sandbox="allow-scripts"
              style={{
                width: '100%',
                height: '320px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: '#0f0f12',
              }}
            />
          ) : (
            <pre
              className="input-mono"
              style={{
                background: '#0f0f12',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                minHeight: '80px',
                maxHeight: '180px',
                overflowY: 'auto',
                fontSize: '0.8rem',
                lineHeight: '1.5',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
              }}
            >
              {sandboxResult.result}
            </pre>
          )}
        </div>
      </div>

      {/* Fullscreen Sandbox View Overlay */}
      {isFullscreen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(9, 9, 11, 0.96)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px',
          animation: 'fadeIn 0.2s ease',
        }}>
          {/* Header of Fullscreen Preview */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '12px',
          }}>
            <span className="text-sm font-bold text-slate-200">Sandbox Preview - Kích Thước Lớn</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsFullscreen(false)}
              style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Minimize size={14} /> Thu nhỏ
            </button>
          </div>

          {/* Preview Container */}
          <div style={{ flex: 1, overflow: 'hidden', background: '#09090b', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
            {viewMode === 'render' ? (
              <iframe
                title="Sandbox Fullscreen Rendered Preview"
                srcDoc={renderSafeHtml(sandboxResult.result)}
                sandbox="allow-scripts"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#09090b',
                }}
              />
            ) : (
              <pre
                className="input-mono"
                style={{
                  background: '#09090b',
                  border: 'none',
                  height: '100%',
                  overflowY: 'auto',
                  fontSize: '0.9rem',
                  lineHeight: '1.6',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  margin: 0,
                  padding: '24px',
                }}
              >
                {sandboxResult.result}
              </pre>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 3: Presets — ST default + custom presets
   ════════════════════════════════════════════════════════════════════ */
function PresetsTab({
  customPresets,
  previewWithPresets,
  showNewPreset, setShowNewPreset,
  newPresetName, setNewPresetName,
  newPresetFind, setNewPresetFind,
  newPresetReplace, setNewPresetReplace,
  newPresetDesc, setNewPresetDesc,
  handleAddPreset,
  handleDeletePreset,
}: {
  customPresets: any[];
  previewWithPresets: string;
  showNewPreset: boolean;
  setShowNewPreset: (v: boolean) => void;
  newPresetName: string;
  setNewPresetName: (v: string) => void;
  newPresetFind: string;
  setNewPresetFind: (v: string) => void;
  newPresetReplace: string;
  setNewPresetReplace: (v: string) => void;
  newPresetDesc: string;
  setNewPresetDesc: (v: string) => void;
  handleAddPreset: () => void;
  handleDeletePreset: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Preview chain */}
      <div>
        <label className="label">Preview — tất cả preset áp dụng lên text mẫu</label>
        <div
          className="st-preview"
          dangerouslySetInnerHTML={{ __html: previewWithPresets }}
        />
      </div>

      {/* Default presets */}
      <div>
        <div style={{
          fontSize: '0.8rem', fontWeight: 600, marginBottom: '8px',
          color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Regex size={14} /> ST Default Presets ({ST_DEFAULT_PRESETS.length})
        </div>
        {ST_DEFAULT_PRESETS.map(p => (
          <PresetCard
            key={p.id}
            preset={p}
            isExpanded={expandedId === p.id}
            onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
            onDelete={undefined}
          />
        ))}
      </div>

      {/* Custom presets */}
      <div>
        <div style={{
          fontSize: '0.8rem', fontWeight: 600, marginBottom: '8px',
          color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={14} /> Custom Presets ({customPresets.length})
          </span>
          <button
            className="btn btn-secondary btn-xs"
            onClick={() => setShowNewPreset(!showNewPreset)}
          >
            {showNewPreset ? 'Hủy' : '+ Thêm preset'}
          </button>
        </div>

        {/* New preset form */}
        {showNewPreset && (
          <div style={{
            padding: '12px', background: 'var(--bg-primary)',
            border: '1px solid var(--accent-primary)',
            borderRadius: 'var(--radius-md)', marginBottom: '8px',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <input
              className="input"
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              placeholder="Tên preset"
            />
            <input
              className="input input-mono"
              value={newPresetFind}
              onChange={e => setNewPresetFind(e.target.value)}
              placeholder="Find: /pattern/flags"
            />
            <input
              className="input input-mono"
              value={newPresetReplace}
              onChange={e => setNewPresetReplace(e.target.value)}
              placeholder="Replace: replacement string"
            />
            <input
              className="input"
              value={newPresetDesc}
              onChange={e => setNewPresetDesc(e.target.value)}
              placeholder="Mô tả (tùy chọn)"
            />
            <button className="btn btn-primary btn-sm" onClick={handleAddPreset}>
              <Check size={12} /> Lưu preset
            </button>
          </div>
        )}

        {customPresets.length === 0 && !showNewPreset ? (
          <div style={{
            textAlign: 'center', padding: '20px',
            color: 'var(--text-muted)', fontSize: '0.75rem',
          }}>
            Chưa có custom preset. Nhấn "Thêm preset" để tạo mới.
          </div>
        ) : (
          customPresets.map((p: any) => (
            <PresetCard
              key={p.id}
              preset={p}
              isExpanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              onDelete={() => handleDeletePreset(p.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PRESET CARD SUB-COMPONENT
   ════════════════════════════════════════════════════════════════════ */
function PresetCard({
  preset,
  isExpanded,
  onToggle,
  onDelete,
}: {
  preset: { id: string; name: string; find: string; replace: string; description: string; isCustom?: boolean };
  isExpanded: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div style={{
      marginBottom: '4px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', fontSize: '0.78rem',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span style={{ fontWeight: 500 }}>{preset.name}</span>
          {preset.isCustom && (
            <span style={{
              fontSize: '0.55rem', padding: '1px 5px',
              background: 'rgba(124,106,240,0.15)', color: 'var(--accent-primary)',
              borderRadius: '3px', fontWeight: 600,
            }}>
              CUSTOM
            </span>
          )}
        </div>
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{
              background: 'none', border: 'none',
              color: 'var(--accent-danger)', cursor: 'pointer', padding: '2px',
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {isExpanded && (
        <div style={{
          padding: '8px 12px 10px',
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '0.72rem',
          display: 'flex', flexDirection: 'column', gap: '4px',
        }}>
          {preset.description && (
            <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>{preset.description}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: 'var(--text-muted)', width: '50px' }}>Find:</span>
            <code style={{
              flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
              background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: '3px',
              color: 'var(--accent-warning)',
            }}>
              {preset.find}
            </code>
            <button
              onClick={() => handleCopy(preset.find)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}
            >
              <Copy size={10} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: 'var(--text-muted)', width: '50px' }}>Replace:</span>
            <code style={{
              flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
              background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: '3px',
              color: 'var(--accent-secondary)',
            }}>
              {preset.replace || '(empty)'}
            </code>
            <button
              onClick={() => handleCopy(preset.replace)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}
            >
              <Copy size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MvuZodTab() {
  const { card, proxy, updateCard, addToast, setFields } = useStore();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');

  // States for outputs
  const [zodSchema, setZodSchema] = useState('');
  const [initvar, setInitvar] = useState('');
  const [rules, setRules] = useState('');

  // States for individual resources
  const [lorebookEntries, setLorebookEntries] = useState<CharacterBookEntry[]>([]);
  const [regexScripts, setRegexScripts] = useState<RegexScript[]>([]);
  const [helperScripts, setHelperScripts] = useState<TavernHelperScript[]>([]);

  // Accordion open states
  const [expandedLorebook, setExpandedLorebook] = useState<number | null>(null);
  const [expandedRegex, setExpandedRegex] = useState<number | null>(null);
  const [expandedHelper, setExpandedHelper] = useState<number | null>(null);

  // States for step 6 options
  const [optFirstMes, setOptFirstMes] = useState(true);

  // States for MVU-Zod Chat
  const [chatInput, setChatInput] = useState('');
  const [mvuMessages, setMvuMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Xin chào! Tôi là Trợ lý AI chuyên trách MVU-Zod. Tôi đã đọc bối cảnh nhân vật này. Bạn có thể nhờ tôi thiết kế cấu trúc Schema, định nghĩa các biến số Initvar hoặc viết các quy tắc cập nhật Rules phù hợp. \n\nKhi tôi đưa ra các đoạn mã trong khung phản hồi, bạn có thể click nút **"Áp dụng vào Editor"** để tự động nạp đoạn mã đó vào form bên trái!'
    }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const mvuChatEndRef = useRef<HTMLDivElement>(null);

  const [mvuAttachedFiles, setMvuAttachedFiles] = useState<AttachedFile[]>(() => {
    try {
      const saved = localStorage.getItem('ai_assistant_mvu_attached_files');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [mvuUploadError, setMvuUploadError] = useState('');
  const mvuFileInputRef = useRef<HTMLInputElement>(null);
  const [mvuSelectedDocs, setMvuSelectedDocs] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem('ai_assistant_mvu_attached_files', JSON.stringify(mvuAttachedFiles));
  }, [mvuAttachedFiles]);

  const handleMvuFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    setMvuUploadError('');
    try {
      const loaded = await Promise.all(selectedFiles.map(async file => {
        const isImage = file.type.startsWith('image/');
        let content = '';
        if (isImage) {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Lỗi đọc file ảnh.'));
            reader.readAsDataURL(file);
          });
        } else {
          content = await file.text();
          content = content.slice(0, 100000);
        }
        return {
          name: file.name,
          size: file.size,
          content,
          isImage
        };
      }));

      setMvuAttachedFiles(prev => [...prev, ...loaded]);
    } catch (err: any) {
      setMvuUploadError(err.message || 'Lỗi khi đọc file đính kèm.');
    } finally {
      if (mvuFileInputRef.current) mvuFileInputRef.current.value = '';
    }
  };

  const handleRemoveMvuFile = (idx: number) => {
    setMvuAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const retrieveMvuKnowledge = (query: string): MvuDoc[] => {
    const lowerQuery = query.toLowerCase();
    return MVU_KNOWLEDGE_BASE.filter(doc => {
      return doc.keywords.some(keyword => lowerQuery.includes(keyword)) ||
             doc.title.toLowerCase().includes(lowerQuery);
    });
  };

  // Auto-scroll chat
  useEffect(() => {
    mvuChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mvuMessages]);

  // Synchronize initvar to lorebookEntries
  useEffect(() => {
    let initvarClean = initvar.trim();
    try {
      const parsedInit = JSON.parse(initvarClean);
      initvarClean = JSON.stringify(parsedInit, null, 2);
    } catch {
      // ignore
    }

    setLorebookEntries(prev => {
      if (prev.length === 0) {
        return [
          {
            id: Date.now() + 1,
            keys: ['[initvar]Khởi tạo biến', '[initvar]'],
            comment: 'Hệ thống khởi tạo biến tự động',
            content: `[initvar]\n${initvarClean}`,
            enabled: false,
            insertion_order: 10,
            position: 'before_char',
            constant: true,
          },
          {
            id: Date.now() + 2,
            keys: ['Danh sách biến số'],
            comment: 'Cấp phát danh sách biến cho AI biết',
            content: `<status_current_variables>{{format_message_variable::stat_data}}</status_current_variables>`,
            enabled: true,
            insertion_order: 11,
            position: 'before_char',
            constant: true,
          },
          {
            id: Date.now() + 3,
            keys: ['[mvu_update]', 'Quy tắc cập nhật'],
            comment: 'Quy tắc cập nhật biến',
            content: rules,
            enabled: true,
            insertion_order: 12,
            position: 'before_char',
            constant: true,
          },
          {
            id: Date.now() + 4,
            keys: ['[mvu_update] Định dạng xuất'],
            comment: 'Hướng dẫn AI cách xuất biến ra JSON Patch',
            content: `<UpdateVariable>\n[\n  {"op": "replace", "path": "/tên_biến", "value": giá_trị_mới}\n]\n</UpdateVariable>`,
            enabled: true,
            insertion_order: 13,
            position: 'after_char',
            constant: true,
          }
        ];
      }
      return prev.map(entry => {
        if (entry.keys.includes('[initvar]') || entry.keys.includes('[initvar]Khởi tạo biến')) {
          return { ...entry, content: `[initvar]\n${initvarClean}` };
        }
        return entry;
      });
    });
  }, [initvar]);

  // Synchronize rules to lorebookEntries
  useEffect(() => {
    setLorebookEntries(prev => {
      if (prev.length === 0) return prev;
      return prev.map(entry => {
        if (entry.keys.includes('[mvu_update]') || entry.keys.includes('Quy tắc cập nhật')) {
          if (entry.content !== rules) {
            return { ...entry, content: rules };
          }
        }
        return entry;
      });
    });
  }, [rules]);

  // Synchronize zodSchema to TavernHelper scripts
  useEffect(() => {
    setHelperScripts(prev => {
      if (prev.length === 0) {
        return [
          {
            ...MVU_RUNTIME_SCRIPT,
            id: generateUUID()
          },
          {
            ...ZOD_SCHEMA_SCRIPT_TEMPLATE,
            content: zodSchema,
            id: generateUUID()
          }
        ];
      }
      return prev.map(s => {
        if (s.name === 'MVU Zod Schema') {
          return { ...s, content: zodSchema };
        }
        return s;
      });
    });
  }, [zodSchema]);

  // Initialize regex scripts once
  useEffect(() => {
    setRegexScripts(
      MVU_REGEXES.map(r => ({
        ...r,
        id: generateUUID(),
      }))
    );
  }, []);

  if (!card) {
    return (
      <div className="text-center py-12 text-slate-500">
        <AlertTriangle className="mx-auto mb-4 text-amber-500" size={32} />
        Vui lòng tải một thẻ nhân vật lên ứng dụng trước để thực hiện chuyển đổi MVU-Zod.
      </div>
    );
  }

  const handleGenerateSchema = async () => {
    setLoading(true);
    setError('');
    setProgressMsg('Đang phân tích bối cảnh thẻ...');
    try {
      const cardContent = `Tên: ${card.data?.name || 'Không rõ'}
Mô tả: ${card.data?.description || ''}
Tính cách: ${card.data?.personality || ''}
Bối cảnh: ${card.data?.scenario || ''}
Tin nhắn đầu: ${card.data?.first_mes || ''}`;

      setProgressMsg('Đang gọi AI sinh Zod Schema...');
      const rawSchemaJson = await generateWithContinuation(
        proxy,
        MVU_SCHEMA_GENERATION_PROMPT,
        `Hãy thiết kế cấu trúc biến số cho thẻ này. Tuân thủ 100% định dạng JSON đầu ra.\n\nNội dung thẻ:\n${cardContent}`,
        '}'
      );

      // Clean the json output
      const cleanJsonStr = rawSchemaJson.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      const schemaData = JSON.parse(cleanJsonStr);
      
      setZodSchema(schemaData.zod_schema || '');
      setInitvar(typeof schemaData.initvar === 'string' ? schemaData.initvar : JSON.stringify(schemaData.initvar, null, 2));
      setStep(1); // remain in step 1 but show results
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Lỗi sinh Schema từ AI.');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleGenerateRules = async () => {
    if (!zodSchema.trim()) {
      setError('Cần có Zod Schema trước khi tạo rules.');
      return;
    }
    setLoading(true);
    setError('');
    setProgressMsg('Đang gọi AI sinh <Variable_rules>...');
    try {
      const cardContent = `Tên: ${card.data?.name || 'Không rõ'}
Mô tả: ${card.data?.description || ''}
Tính cách: ${card.data?.personality || ''}
Bối cảnh: ${card.data?.scenario || ''}
Tin nhắn đầu: ${card.data?.first_mes || ''}`;

      const rulesXml = await generateWithContinuation(
        proxy,
        MVU_RULES_GENERATION_PROMPT,
        `Dưới đây là cấu trúc biến:\n${zodSchema}\n\nViết khối <Variable_rules> cho các biến trên.\nNội dung thẻ để lấy bối cảnh:\n${cardContent}`,
        '</Variable_rules>'
      );
      setRules(rulesXml || '');
      setStep(2); // remain in step 2 but show rules
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Lỗi sinh Rules từ AI.');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleApplyConversion = () => {
    try {
      const newCard = JSON.parse(JSON.stringify(card));
      if (!newCard.data) newCard.data = {};
      if (!newCard.data.extensions) newCard.data.extensions = {};
      if (!newCard.data.character_book) newCard.data.character_book = { entries: [] };

      // 1. Modify first_mes
      if (optFirstMes) {
        if (newCard.data.first_mes && !newCard.data.first_mes.includes('<StatusPlaceHolderImpl/>')) {
          newCard.data.first_mes += '\\n\\n[khởi tạo]\\n\\n<StatusPlaceHolderImpl/>';
        }
      }

      // 2. Inject Regex Scripts
      if (!newCard.data.extensions.regex_scripts) {
        newCard.data.extensions.regex_scripts = [];
      }
      // Clean previous MVU regexes
      newCard.data.extensions.regex_scripts = newCard.data.extensions.regex_scripts.filter((r: any) => 
        !r.scriptName.startsWith('MVU:')
      );
      // Inject only enabled ones from regexScripts state
      regexScripts.forEach(r => {
        if (!r.disabled) {
          const { id, ...cleanR } = r as any;
          newCard.data.extensions.regex_scripts.push(cleanR);
        }
      });

      // 3. Inject TavernHelper Scripts
      // Filter out old helper scripts
      const possibleKeys = ['tavern_helper', 'TavernHelper', 'js_slash_runner', 'TavernHelper_scripts'];
      possibleKeys.forEach(key => {
        const extData = newCard.data.extensions[key];
        if (!extData) return;

        if (Array.isArray(extData)) {
          const tupleEntry = extData.find(
            (item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])
          );
          if (tupleEntry) {
            tupleEntry[1] = (tupleEntry[1] as TavernHelperScript[]).filter(
              s => s && s.name !== 'MVU' && s.name !== 'MVU Zod Schema'
            );
          } else {
            const isTupleArray = extData.some((item: any) => Array.isArray(item));
            if (!isTupleArray) {
              newCard.data.extensions[key] = (extData as TavernHelperScript[]).filter(
                s => s && s.name !== 'MVU' && s.name !== 'MVU Zod Schema'
              );
            }
          }
        } else if (typeof extData === 'object' && extData !== null) {
          if ('scripts' in extData && Array.isArray(extData.scripts)) {
            extData.scripts = (extData.scripts as TavernHelperScript[]).filter(
              s => s && s.name !== 'MVU' && s.name !== 'MVU Zod Schema'
            );
          }
        }
      });

      // Inject enabled scripts
      helperScripts.forEach(s => {
        if (s.enabled) {
          injectCustomTavernHelperScript(newCard.data.extensions, s);
        }
      });

      // 4. Inject Lorebook Entries
      // Remove old entries
      newCard.data.character_book.entries = newCard.data.character_book.entries.filter((e: any) => {
        if (!e.keys) return true;
        const hasTargetKey = e.keys.some((k: string) => 
          k.includes('[initvar]') || 
          k.includes('Danh sách biến số') || 
          k.includes('[mvu_update]') || 
          k.includes('Quy tắc cập nhật')
        );
        return !hasTargetKey;
      });

      // Inject enabled entries
      const enabledEntries = lorebookEntries.filter(e => e.enabled);
      newCard.data.character_book.entries.push(...enabledEntries);

      updateCard(newCard);

      // Extract fields and reload translation dashboard
      const enabledGroupIds = useStore.getState().translationConfig.fieldGroups.filter(g => g.enabled).map(g => g.id);
      const newFields = extractTranslatableFields(newCard, enabledGroupIds);
      const existingMap = new Map(useStore.getState().fields.map(f => [f.path, f]));
      const updatedFields = newFields.map(nf => {
        const existing = existingMap.get(nf.path);
        if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
          return existing;
        }
        return nf;
      });
      for (const ef of useStore.getState().fields) {
        if (!updatedFields.some(uf => uf.path === ef.path)) {
          updatedFields.push(ef);
        }
      }
      setFields(updatedFields);

      addToast('success', 'Đã tích hợp các thành phần MVU-Zod vào Card thành công!');
      setStep(7); // Go to step 7 (Success)
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Lỗi khi tích hợp vào card.');
    }
  };

  const handleSendMvuChatMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;
    
    const userMsgText = chatInput;
    setChatInput('');
    setIsChatLoading(true);
    
    const userMsg: Message = { role: 'user', content: userMsgText };
    const nextMessages = [...mvuMessages, userMsg];
    setMvuMessages(nextMessages);

    try {
      const cardContent = `Tên: ${card.data?.name || 'Không rõ'}
Mô tả: ${card.data?.description || ''}
Tính cách: ${card.data?.personality || ''}
Bối cảnh: ${card.data?.scenario || ''}
Tin nhắn đầu: ${card.data?.first_mes || ''}`;

      let stepContext = '';
      if (step === 1) {
        stepContext = `Người dùng đang ở Bước 1: Thiết kế Lược đồ Zod Schema & Biến khởi tạo Initvar. Hãy giúp họ phân tích nhân vật, tạo/chỉnh sửa Schema hoặc Initvar phù hợp.`;
      } else if (step === 2) {
        stepContext = `Người dùng đang ở Bước 2: Thiết kế Quy tắc Cập nhật Biến (Variable Rules). Hãy giúp viết các quy tắc logic bằng XML.`;
      } else if (step === 3) {
        stepContext = `Người dùng đang ở Bước 3: Xem/sửa 4 Lorebook entries tự động. Bạn có thể gợi ý cấu trúc keys, comment hay nội dung lorebook.`;
      } else if (step === 4) {
        stepContext = `Người dùng đang ở Bước 4: Xem/sửa 4 Regex scripts tiện ích. Hãy hỗ trợ họ viết Regex hoặc chuỗi thay thế (replace).`;
      } else if (step === 5) {
        stepContext = `Người dùng đang ở Bước 5: Xem/sửa 2 TavernHelper scripts (Runtime và Zod Schema script).`;
      } else if (step === 6) {
        stepContext = `Người dùng đang ở Bước 6: Xem trước tất cả tài nguyên chuẩn bị tích hợp vào Thẻ.`;
      }

      // ─── RAG: Retrieval-Augmented Generation ───
      // 1. Auto RAG
      const autoDocs = retrieveMvuKnowledge(userMsgText);
      // 2. Manual RAG
      const manualDocs = MVU_KNOWLEDGE_BASE.filter(doc => mvuSelectedDocs.includes(doc.id));
      // Gộp lại và loại bỏ trùng lặp
      const combinedDocs = Array.from(new Map([...autoDocs, ...manualDocs].map(d => [d.id, d])).values());

      let ragContextBlock = '';
      if (combinedDocs.length > 0) {
        ragContextBlock = `\n\n[TÀI LIỆU TRI THỨC VÀ HƯỚNG DẪN THAM KHẢO]:\n` + 
          combinedDocs.map(doc => `--- TÀI LIỆU: ${doc.title} ---\n${doc.content}`).join('\n\n') + '\n---';
      }

      // Tệp đính kèm văn bản
      const textFilesCtx = mvuAttachedFiles
        .filter(f => !f.isImage)
        .map(f => `[TỆP ĐÍNH KÈM VĂN BẢN: ${f.name}]:\n${f.content}\n---\n`)
        .join('\n');

      const systemPrompt = `Bạn là chuyên gia thiết kế hệ thống thẻ nhân vật MVU-Zod (Magical Variable Update + Zod Schema validation) cho SillyTavern.
Nhiệm vụ của bạn là hỗ trợ người dùng xây dựng, tinh chỉnh Schema biến số và Rules (luật cập nhật) cho nhân vật hiện tại.

Bối cảnh hiện tại:
${stepContext}

Thông tin nhân vật hiện tại:
${cardContent}

Zod Schema hiện tại trong editor (YÊU CẦU ĐỌC VÀ BẢO TOÀN TOÀN BỘ SCHEMA NÀY):
${zodSchema || '(Trống - Chưa được tạo)'}

Initvar JSON hiện tại trong editor:
${initvar || '(Trống - Chưa được tạo)'}

Variable Rules hiện tại trong editor:
${rules || '(Trống - Chưa được tạo)'}
${ragContextBlock}
${textFilesCtx ? `\n\n[TÀI LIỆU VÀ TỆP ĐÍNH KÈM THÊM TỪ NGƯỜI DÙNG]:\n${textFilesCtx}` : ''}

Hãy phản hồi ngắn gọn, trực diện, đúng trọng tâm.
QUY TẮC BẮT BUỘC:
1. Khi đề xuất mã nguồn (Schema, Initvar, Rules), hãy đặt trong các block mã markdown riêng biệt rõ ràng.
- Zod Schema: Sử dụng block mã ngôn ngữ \`\`\`typescript hoặc \`\`\`javascript.
- Initvar JSON: Sử dụng block mã ngôn ngữ \`\`\`json.
- Variable Rules: Sử dụng block mã ngôn ngữ \`\`\`xml hoặc \`\`\`html.
2. Tránh ghi chú thích quá nhiều ngoài mã nguồn bên trong block mã, để khi bấm áp dụng, mã nguồn được đưa vào editor sạch sẽ và không gây lỗi cú pháp.
3. LUÔN LUÔN trả về Zod Schema và Variable Rules ĐẦY ĐỦ, HOÀN CHỈNH. Tuyệt đối không cắt bớt bằng các ký tự đại diện (như "...", "// code giữ nguyên", v.v.).`;

      // Build history
      const historyStr = nextMessages.slice(-10)
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      // Extract images base64
      const mvuImagesList = mvuAttachedFiles.filter(f => f.isImage).map(f => f.content);

      const initialUserPrompt = `Dưới đây là lịch sử cuộc hội thoại của chúng ta:\n\n${historyStr}\n\nUser: ${userMsgText}`;
      let response = await callProvider(
        proxy, 
        systemPrompt, 
        initialUserPrompt,
        undefined,
        mvuImagesList.length > 0 ? mvuImagesList : undefined
      );
      
      let continuationCount = 0;
      const maxContinuations = 5;
      while (checkResponseCut(response) && continuationCount < maxContinuations) {
        continuationCount++;
        const continuationPrompt = `${initialUserPrompt}\n\n[TIẾP TỤC PHẢN HỒI BỊ CẮT (Lượt ${continuationCount})]\nPhản hồi trước đó của bạn đã bị ngắt giữa chừng do giới hạn token. Dưới đây là TOÀN BỘ nội dung bạn đã viết được cho đến hiện tại:\n"""\n${response}\n"""\n\nHãy tiếp tục viết tiếp ngay sau ký tự cuối cùng của nội dung trên để hoàn thiện phản hồi đầy đủ. KHÔNG viết lại hoặc lặp lại những phần đã có ở trên. Bắt đầu viết trực tiếp từ chữ bị cắt dở dang.`;
        
        const nextChunk = await callProvider(proxy, systemPrompt, continuationPrompt, undefined, undefined);
        if (!nextChunk || !nextChunk.trim()) break;
        response += (nextChunk.startsWith('```') && response.endsWith('```') ? '\n' : '') + nextChunk;
      }
      
      setMvuMessages([...nextMessages, { role: 'assistant', content: response }]);
    } catch (err: any) {
      console.error(err);
      setMvuMessages([...nextMessages, { role: 'assistant', content: `Lỗi: ${err.message || 'Không thể gọi AI.'}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const renderMvuMessageContent = (content: string) => {
    // Split by markdown code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        if (match) {
          const lang = match[1] || 'text';
          const code = match[2];
          
          let typeLabel = 'Mã nguồn';
          let applyType: 'schema' | 'initvar' | 'rules' | null = null;
          
          const lowerLang = lang.toLowerCase();
          const lowerCode = code.toLowerCase();
          
          if (lowerLang === 'json') {
            typeLabel = 'Initvar JSON';
            applyType = 'initvar';
          } else if (lowerLang === 'xml' || lowerCode.includes('<variable_rules>') || lowerLang === 'html') {
            typeLabel = 'Variable Rules (XML)';
            applyType = 'rules';
          } else if (lowerLang === 'typescript' || lowerLang === 'javascript' || lowerCode.includes('zod') || lowerCode.includes('z.object')) {
            typeLabel = 'Zod Schema';
            applyType = 'schema';
          }
          
          return (
            <div key={idx} style={{
              margin: '8px 0',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: '#09090b',
              overflow: 'hidden',
            }}>
              <div style={{
                background: 'var(--bg-elevated)',
                padding: '4px 10px',
                fontSize: '0.65rem',
                color: 'var(--text-muted)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{typeLabel}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      addToast('success', 'Đã sao chép mã nguồn!');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.65rem',
                      padding: '2px 4px',
                    }}
                  >
                    Sao chép
                  </button>
                  {applyType && (
                    <button
                      onClick={() => {
                        if (applyType === 'schema') {
                          setZodSchema(code.trim());
                          addToast('success', 'Đã áp dụng mã vào ô Zod Schema!');
                        } else if (applyType === 'initvar') {
                          setInitvar(code.trim());
                          addToast('success', 'Đã áp dụng mã vào ô Initvar!');
                        } else if (applyType === 'rules') {
                          setRules(code.trim());
                          addToast('success', 'Đã áp dụng mã vào ô Variable Rules!');
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#10b981',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.65rem',
                        padding: '2px 4px',
                      }}
                    >
                      Áp dụng vào Editor
                    </button>
                  )}
                </div>
              </div>
              <pre style={{
                margin: 0,
                padding: '10px',
                overflowX: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                color: '#cbd5e1',
                whiteSpace: 'pre-wrap',
              }}>
                <code>{code}</code>
              </pre>
            </div>
          );
        }
      }
      
      return (
        <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
      );
    });
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: step === 7 ? '1fr' : '1.2fr 0.8fr',
      gap: '20px',
      alignItems: 'stretch',
    }}>
      
      {/* LEFT COLUMN: WIZARD FORM */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Steps Header Progress bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          overflowX: 'auto',
        }}>
          {[
            { num: 1, label: 'Schema' },
            { num: 2, label: 'Rules' },
            { num: 3, label: 'Lorebook' },
            { num: 4, label: 'Regex' },
            { num: 5, label: 'Helper' },
            { num: 6, label: 'Xem trước' },
            { num: 7, label: 'Hoàn thành' },
          ].map((s, idx, arr) => (
            <React.Fragment key={s.num}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: step === s.num 
                    ? 'var(--accent-primary)' 
                    : step > s.num 
                      ? 'rgba(16,185,129,0.15)' 
                      : 'var(--bg-elevated)',
                  color: step === s.num 
                    ? 'white' 
                    : step > s.num 
                      ? '#10b981' 
                      : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  border: step === s.num 
                    ? 'none' 
                    : step > s.num 
                      ? '1px solid #10b981' 
                      : '1px solid var(--border-default)',
                }}>
                  {step > s.num ? <Check size={10} /> : s.num}
                </div>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: step === s.num ? 600 : 400,
                  color: step === s.num ? 'var(--text-primary)' : 'var(--text-muted)'
                }}>{s.label}</span>
              </div>
              {idx < arr.length - 1 && (
                <ArrowRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Error message Banner */}
        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 'var(--radius-sm)',
            color: '#f87171',
            fontSize: '0.78rem',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        {/* Step Contents */}

        {/* STEP 1: Schema & Initvar */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px',
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}>
              <strong>Bước 1: Thiết kế Lược đồ Schema & Biến Khởi tạo.</strong><br/>
              Hệ thống sẽ phân tích thông tin nhân vật để tự động đề xuất cấu trúc Zod Schema và các biến trạng thái khởi tạo tương ứng. Bạn có thể chỉnh sửa kết quả trực tiếp bên dưới hoặc chat với AI bên phải để tinh chỉnh cấu trúc.
            </div>

            {!zodSchema && !loading ? (
              <div style={{ textAlign: 'center', padding: '36px 0' }}>
                <button
                  onClick={handleGenerateSchema}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-6 py-2.5 font-bold text-xs flex items-center gap-2 shadow-md mx-auto active:scale-95 transition-all"
                >
                  <Sparkles size={14} /> Phân tích & Sinh Schema tự động
                </button>
              </div>
            ) : null}

            {loading && (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin mx-auto mb-2 text-indigo-400" />
                <div className="text-xs font-mono">{progressMsg}</div>
              </div>
            )}

            {(zodSchema || initvar) && !loading ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label className="label" style={{ fontWeight: 600 }}>Zod Schema (TavernHelper script):</label>
                    <textarea
                      value={zodSchema}
                      onChange={e => setZodSchema(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '260px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        background: '#09090b',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        color: '#c7d2fe',
                        padding: '10px',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label className="label" style={{ fontWeight: 600 }}>Initvar JSON (Giá trị khởi tạo ban đầu):</label>
                    <textarea
                      value={initvar}
                      onChange={e => setInitvar(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '260px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        background: '#09090b',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        color: '#a7f3d0',
                        padding: '10px',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                  <button
                    onClick={handleGenerateSchema}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RefreshCw size={12} /> Làm mới Schema
                  </button>

                  <button
                    onClick={() => {
                      if (!zodSchema.trim() || !initvar.trim()) {
                        setError('Cần có đầy đủ Zod Schema và Initvar trước khi sang bước 2.');
                        return;
                      }
                      setError('');
                      setStep(2);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                  >
                    Tiếp tục bước 2 <ArrowRight size={14} />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* STEP 2: Variable Rules XML */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px',
              background: 'rgba(168,85,247,0.06)',
              border: '1px solid rgba(168,85,247,0.15)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}>
              <strong>Bước 2: Viết Quy tắc Cập nhật Biến (Variable Rules).</strong><br/>
              Khối XML này hướng dẫn AI cách suy luận logic, điều chỉnh thuộc tính nhân vật và cập nhật trị số biến theo hệ quả hành động.
            </div>

            {!rules && !loading ? (
              <div style={{ textAlign: 'center', padding: '36px 0' }}>
                <button
                  onClick={handleGenerateRules}
                  className="bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-6 py-2.5 font-bold text-xs flex items-center gap-2 shadow-md mx-auto active:scale-95 transition-all"
                >
                  <Sparkles size={14} /> Sinh Luật (Variable Rules) bằng AI
                </button>
              </div>
            ) : null}

            {loading && (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin mx-auto mb-2 text-purple-400" />
                <div className="text-xs font-mono">{progressMsg}</div>
              </div>
            )}

            {rules && !loading ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="label" style={{ fontWeight: 600 }}>Variable Rules Content (XML format):</label>
                  <textarea
                    value={rules}
                    onChange={e => setRules(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '320px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      background: '#09090b',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      color: '#fde047',
                      padding: '10px',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setStep(1)}
                      className="btn btn-ghost btn-sm"
                    >
                      Quay lại
                    </button>
                    <button
                      onClick={handleGenerateRules}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={12} /> Làm mới Rules
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      if (!rules.trim()) {
                        setError('Quy tắc cập nhật không được bỏ trống.');
                        return;
                      }
                      setError('');
                      setStep(3);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                  >
                    Tiếp tục bước 3 <ArrowRight size={14} />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* STEP 3: Lorebook Entries */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px',
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}>
              <strong>Bước 3: Xem và Chỉnh sửa Lorebook Entries đề xuất.</strong><br/>
              Hệ thống sẽ thêm 4 entries mặc định vào character_book. Nhấp vào mỗi entry để tùy chỉnh chi tiết hoặc bật/tắt (checkbox).
            </div>

            <div className="flex flex-col gap-3">
              {lorebookEntries.map((entry, index) => {
                const isExpanded = expandedLorebook === index;
                return (
                  <div key={entry.id} className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden flex flex-col transition-all">
                    <div 
                      onClick={() => setExpandedLorebook(isExpanded ? null : index)}
                      className="p-3 flex items-center justify-between cursor-pointer hover:bg-zinc-800/40 select-none"
                    >
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            setLorebookEntries(prev => prev.map((item, idx) => idx === index ? { ...item, enabled: e.target.checked } : item));
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-slate-200">{entry.comment || `Entry ${index + 1}`}</span>
                          <span className="text-[10px] text-slate-500 font-mono">Keys: {entry.keys.join(', ')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-indigo-950/40 border border-indigo-900 text-indigo-400 px-2 py-0.5 rounded font-mono">LB Entry</span>
                        {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-3 border-t border-zinc-800 flex flex-col gap-3 bg-zinc-950/20">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Keys (phân cách bằng dấu phẩy):</label>
                            <input 
                              type="text" 
                              value={entry.keys.join(', ')}
                              onChange={(e) => {
                                const newKeys = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
                                setLorebookEntries(prev => prev.map((item, idx) => idx === index ? { ...item, keys: newKeys } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Mô tả / Comment:</label>
                            <input 
                              type="text" 
                              value={entry.comment}
                              onChange={(e) => {
                                setLorebookEntries(prev => prev.map((item, idx) => idx === index ? { ...item, comment: e.target.value } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Vị trí (Position):</label>
                            <select
                              value={entry.position}
                              onChange={(e) => {
                                setLorebookEntries(prev => prev.map((item, idx) => idx === index ? { ...item, position: e.target.value } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            >
                              <option value="before_char">Before Character (before_char)</option>
                              <option value="after_char">After Character (after_char)</option>
                              <option value="top">Top (top)</option>
                              <option value="bottom">Bottom (bottom)</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Thứ tự chèn (Insertion Order):</label>
                            <input 
                              type="number" 
                              value={entry.insertion_order}
                              onChange={(e) => {
                                setLorebookEntries(prev => prev.map((item, idx) => idx === index ? { ...item, insertion_order: parseInt(e.target.value) || 0 } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-slate-400">Nội dung (Content):</label>
                          <textarea 
                            value={entry.content}
                            onChange={(e) => {
                              setLorebookEntries(prev => prev.map((item, idx) => idx === index ? { ...item, content: e.target.value } : item));
                            }}
                            rows={6}
                            className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-slate-200 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
              <button
                onClick={() => setStep(2)}
                className="btn btn-ghost btn-sm"
              >
                Quay lại
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep(4);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
              >
                Tiếp tục bước 4 <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Regex Scripts */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px',
              background: 'rgba(234,179,8,0.06)',
              border: '1px solid rgba(234,179,8,0.15)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}>
              <strong>Bước 4: Xem và Chỉnh sửa Regex Scripts tiện ích.</strong><br/>
              Hệ thống đề xuất 4 regex để xử lý hiển thị thẻ HTML và ẩn khung Update. Nhấp để chỉnh sửa Regex, replacement hoặc bật/tắt.
            </div>

            <div className="flex flex-col gap-3">
              {regexScripts.map((script, index) => {
                const isExpanded = expandedRegex === index;
                const isEnabled = !script.disabled;
                return (
                  <div key={script.id || index} className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden flex flex-col transition-all">
                    <div 
                      onClick={() => setExpandedRegex(isExpanded ? null : index)}
                      className="p-3 flex items-center justify-between cursor-pointer hover:bg-zinc-800/40 select-none"
                    >
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, disabled: !e.target.checked } : item));
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-slate-200">{script.scriptName}</span>
                          <span className="text-[10px] text-slate-500 font-mono font-semibold max-w-[300px] truncate">Find: {script.findRegex}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-amber-950/40 border border-amber-900 text-amber-400 px-2 py-0.5 rounded font-mono">Regex</span>
                        {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-3 border-t border-zinc-800 flex flex-col gap-3 bg-zinc-950/20">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Tên Regex Script:</label>
                            <input 
                              type="text" 
                              value={script.scriptName}
                              onChange={(e) => {
                                setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, scriptName: e.target.value } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Tìm kiếm (Find Regex):</label>
                            <input 
                              type="text" 
                              value={script.findRegex}
                              onChange={(e) => {
                                setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, findRegex: e.target.value } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200 font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-slate-400">Chuỗi thay thế (Replace String):</label>
                          <textarea 
                            value={script.replaceString}
                            onChange={(e) => {
                              setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, replaceString: e.target.value } : item));
                            }}
                            rows={3}
                            className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-slate-200 font-mono"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Placement (comma list):</label>
                            <input 
                              type="text" 
                              value={(script.placement || []).join(', ')}
                              onChange={(e) => {
                                const plc = e.target.value.split(',').map(p => p.trim()).filter(Boolean);
                                setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, placement: plc } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200 font-mono"
                            />
                          </div>
                          <div className="flex items-center gap-2 mt-4 select-none cursor-pointer">
                            <input 
                              type="checkbox"
                              id={`runOnEdit-${index}`}
                              checked={script.runOnEdit}
                              onChange={(e) => {
                                setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, runOnEdit: e.target.checked } : item));
                              }}
                              className="cursor-pointer"
                            />
                            <label htmlFor={`runOnEdit-${index}`} className="text-[10px] font-semibold text-slate-400 cursor-pointer">Chạy khi sửa tin nhắn</label>
                          </div>
                          <div className="flex items-center gap-2 mt-4 select-none cursor-pointer">
                            <input 
                              type="checkbox"
                              id={`substituteRegex-${index}`}
                              checked={script.substituteRegex}
                              onChange={(e) => {
                                setRegexScripts(prev => prev.map((item, idx) => idx === index ? { ...item, substituteRegex: e.target.checked } : item));
                              }}
                              className="cursor-pointer"
                            />
                            <label htmlFor={`substituteRegex-${index}`} className="text-[10px] font-semibold text-slate-400 cursor-pointer">Thay thế Regex (Substitute)</label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
              <button
                onClick={() => setStep(3)}
                className="btn btn-ghost btn-sm"
              >
                Quay lại
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep(5);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
              >
                Tiếp tục bước 5 <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: TavernHelper Scripts */}
        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px',
              background: 'rgba(168,85,247,0.06)',
              border: '1px solid rgba(168,85,247,0.15)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}>
              <strong>Bước 5: Xem và Chỉnh sửa TavernHelper Scripts đề xuất.</strong><br/>
              Hệ thống sẽ thêm 2 scripts hỗ trợ: Runtime script `MVU` và Schema script `MVU Zod Schema`.
            </div>

            <div className="flex flex-col gap-3">
              {helperScripts.map((script: any, index) => {
                const isExpanded = expandedHelper === index;
                return (
                  <div key={script.id || index} className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden flex flex-col transition-all">
                    <div 
                      onClick={() => setExpandedHelper(isExpanded ? null : index)}
                      className="p-3 flex items-center justify-between cursor-pointer hover:bg-zinc-800/40 select-none"
                    >
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox"
                          checked={script.enabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            setHelperScripts(prev => prev.map((item, idx) => idx === index ? { ...item, enabled: e.target.checked } : item));
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-slate-200">{script.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono font-semibold max-w-[300px] truncate">{script.info}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-purple-950/40 border border-purple-900 text-purple-400 px-2 py-0.5 rounded font-mono">TavernHelper</span>
                        {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-3 border-t border-zinc-800 flex flex-col gap-3 bg-zinc-950/20">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Tên Script:</label>
                            <input 
                              type="text" 
                              value={script.name}
                              onChange={(e) => {
                                setHelperScripts(prev => prev.map((item, idx) => idx === index ? { ...item, name: e.target.value } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-slate-400">Mô tả (Info):</label>
                            <input 
                              type="text" 
                              value={script.info}
                              onChange={(e) => {
                                setHelperScripts(prev => prev.map((item, idx) => idx === index ? { ...item, info: e.target.value } : item));
                              }}
                              className="bg-zinc-900 border border-zinc-700 rounded p-1 text-xs text-slate-200"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-slate-400">Nội dung Script Content (JavaScript):</label>
                          <textarea 
                            value={script.content}
                            onChange={(e) => {
                              setHelperScripts(prev => prev.map((item, idx) => idx === index ? { ...item, content: e.target.value } : item));
                            }}
                            rows={8}
                            className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-slate-200 font-mono font-semibold"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
              <button
                onClick={() => setStep(4)}
                className="btn btn-ghost btn-sm"
              >
                Quay lại
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep(6);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
              >
                Tiếp tục bước 6 <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Preview and Customize Injection Components */}
        {step === 6 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px',
              background: 'rgba(234,179,8,0.06)',
              border: '1px solid rgba(234,179,8,0.15)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}>
              <strong>Bước 6: Xem trước Tổng quan Tài nguyên Tích hợp.</strong><br/>
              Xác nhận các tùy chọn cuối cùng trước khi tiến hành ghi vào Thẻ nhân vật.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {/* option 1: first_mes */}
              <label className="checkbox-wrapper bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex items-start gap-3 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={optFirstMes}
                  onChange={e => setOptFirstMes(e.target.checked)}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <span className="font-semibold text-xs text-slate-200">Sửa đổi Tin Nhắn Đầu (first_mes)</span>
                  <span className="text-[10px] text-slate-500 block mt-1">Tự động chèn tag {"`\\n\\n[khởi tạo]\\n\\n<StatusPlaceHolderImpl/>`"} để gọi hàm render trạng thái.</span>
                </div>
              </label>

              {/* Summary of Lorebook Entries */}
              <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex flex-col gap-2">
                <span className="font-semibold text-xs text-slate-200 font-bold">Lorebook Entries sẽ được thêm ({lorebookEntries.filter(e => e.enabled).length})</span>
                <div className="flex flex-col gap-1.5 pl-2">
                  {lorebookEntries.map((e, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px]">
                      <span className={e.enabled ? "text-slate-300 font-medium" : "text-slate-500 line-through"}>
                        {e.comment || `LB Entry ${idx + 1}`} ({e.keys.join(', ')})
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold ${e.enabled ? 'bg-emerald-950/40 text-emerald-400' : 'bg-zinc-950/40 text-zinc-500'}`}>
                        {e.enabled ? 'Kích hoạt' : 'Bỏ qua'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary of Regex Scripts */}
              <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex flex-col gap-2">
                <span className="font-semibold text-xs text-slate-200 font-bold">Regex Scripts sẽ được thêm ({regexScripts.filter(r => !r.disabled).length})</span>
                <div className="flex flex-col gap-1.5 pl-2">
                  {regexScripts.map((r, idx) => {
                    const isEnabled = !r.disabled;
                    return (
                      <div key={idx} className="flex items-center justify-between text-[11px]">
                        <span className={isEnabled ? "text-slate-300 font-medium" : "text-slate-500 line-through"}>
                          {r.scriptName}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold ${isEnabled ? 'bg-emerald-950/40 text-emerald-400' : 'bg-zinc-950/40 text-zinc-500'}`}>
                          {isEnabled ? 'Kích hoạt' : 'Bỏ qua'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary of TavernHelper Scripts */}
              <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex flex-col gap-2">
                <span className="font-semibold text-xs text-slate-200 font-bold">TavernHelper Scripts sẽ được thêm ({helperScripts.filter(s => s.enabled).length})</span>
                <div className="flex flex-col gap-1.5 pl-2">
                  {helperScripts.map((s: any, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px]">
                      <span className={s.enabled ? "text-slate-300 font-medium" : "text-slate-500 line-through"}>
                        {s.name} ({s.info})
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold ${s.enabled ? 'bg-emerald-950/40 text-emerald-400' : 'bg-zinc-950/40 text-zinc-500'}`}>
                        {s.enabled ? 'Kích hoạt' : 'Bỏ qua'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
              <button
                onClick={() => setStep(5)}
                className="btn btn-ghost btn-sm"
              >
                Quay lại
              </button>

              <button
                onClick={handleApplyConversion}
                className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-5 py-2 font-bold text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                <CheckCircle2 size={14} /> Hoàn tất & Tích hợp vào Card
              </button>
            </div>
          </div>
        )}

        {/* STEP 7: Success & Finished */}
        {step === 7 && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            background: 'rgba(16,185,129,0.04)',
            border: '1px dashed rgba(16,185,129,0.2)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(16,185,129,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981',
            }}>
              <CheckCircle2 size={28} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>Chuyển đổi MVU-Zod Hoàn Tất!</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto', lineHeight: '1.5' }}>
                Thẻ nhân vật của bạn đã được tiêm cấu trúc Schema, rules và các tiện ích regex. Bây giờ thẻ đã trở thành thẻ MVU-Zod hoạt động hoàn chỉnh! Các trường dữ liệu mới đã được nạp lại vào bảng điều khiển dịch.
              </p>
            </div>
            
            <button
              onClick={() => {
                setZodSchema('');
                setInitvar('');
                setRules('');
                setLorebookEntries([]);
                setRegexScripts(MVU_REGEXES.map(r => ({ ...r, id: generateUUID() })));
                setHelperScripts([]);
                setStep(1);
              }}
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '12px' }}
            >
              Chuyển đổi Thẻ khác
            </button>
          </div>
        )}

      </div>

      {/* RIGHT COLUMN: AI CHAT ASSISTANT FOR MVU-ZOD */}
      {step < 7 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-secondary)',
          overflow: 'hidden',
          minHeight: '480px',
          maxHeight: '650px',
        }}>
          {/* Chat Header */}
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <Sparkles size={14} className="text-indigo-400" />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>Trợ lý Thiết kế MVU-Zod</span>
          </div>

          {/* Messages Window */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '0.75rem',
            lineHeight: 1.45,
          }} className="custom-scrollbar">
            {mvuMessages.map((msg, idx) => (
              <div 
                key={idx} 
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: msg.role === 'user' ? 'rgba(99,102,241,0.12)' : 'var(--bg-elevated)',
                  border: msg.role === 'user' ? '1px solid rgba(99,102,241,0.25)' : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                }}
              >
                {msg.role === 'assistant' ? renderMvuMessageContent(msg.content) : msg.content}
              </div>
            ))}
            {isChatLoading && (
              <div style={{
                alignSelf: 'flex-start',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <Loader2 size={12} className="animate-spin text-indigo-400" />
                <span>AI đang suy nghĩ...</span>
              </div>
            )}
            <div ref={mvuChatEndRef} />
          </div>

          {/* RAG & Attached Files Area */}
          <div style={{
            padding: '6px 10px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            {/* Hàng tài liệu RAG tri thức */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>TÀI LIỆU RAG:</span>
              {MVU_KNOWLEDGE_BASE.map(doc => {
                const isSelected = mvuSelectedDocs.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setMvuSelectedDocs(prev => 
                        prev.includes(doc.id) 
                          ? prev.filter(id => id !== doc.id) 
                          : [...prev, doc.id]
                      );
                    }}
                    style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: isSelected ? '1px solid rgba(99,102,241,0.5)' : '1px solid var(--border-default)',
                      background: isSelected ? 'rgba(99,102,241,0.15)' : 'var(--bg-default)',
                      color: isSelected ? '#818cf8' : 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      transition: 'all 0.15s'
                    }}
                  >
                    {isSelected ? <Check size={8} /> : <Plus size={8} />}
                    {doc.title.replace('Mẫu Hệ thống ', '').replace('Hướng dẫn ', '')}
                  </button>
                );
              })}
            </div>

            {/* Hàng files đính kèm */}
            {mvuAttachedFiles.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                paddingTop: '4px',
                borderTop: '1px solid var(--border-subtle)',
                marginTop: '2px'
              }}>
                {mvuAttachedFiles.map((file, idx) => (
                  <div 
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'var(--bg-default)',
                      border: '1px solid var(--border-default)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '9px',
                      color: 'var(--text-primary)'
                    }}
                  >
                    {file.isImage ? (
                      <img 
                        src={file.content} 
                        alt={file.name} 
                        style={{ width: '12px', height: '12px', objectFit: 'cover', borderRadius: '2px' }} 
                      />
                    ) : (
                      <FileText size={10} className="text-indigo-400" />
                    )}
                    <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                      {file.name}
                    </span>
                    <button 
                      onClick={() => handleRemoveMvuFile(idx)}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, marginLeft: '2px' }}
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mvuUploadError && (
              <div style={{ color: '#f87171', fontSize: '9px', marginTop: '2px' }}>
                {mvuUploadError}
              </div>
            )}
          </div>

          {/* Input Area */}
          <div style={{
            padding: '8px 10px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            gap: '6px',
          }}>
            <button
              onClick={() => mvuFileInputRef.current?.click()}
              className="text-slate-400 hover:text-indigo-400 hover:bg-zinc-800/50 rounded-md p-1.5 transition-all flex items-center justify-center"
              style={{ width: '28px', height: '28px', border: '1px solid var(--border-default)', background: 'var(--bg-default)', cursor: 'pointer' }}
              title="Đính kèm tệp/ảnh"
            >
              <Upload size={12} />
            </button>
            <input 
              type="file" 
              multiple 
              className="hidden" 
              ref={mvuFileInputRef} 
              onChange={handleMvuFileUpload}
              accept="image/*,.json,.js,.jsx,.ts,.tsx,.txt,.md,.css,.html,.yaml,.yml,.xml"
            />
            <input
              type="text"
              placeholder="Yêu cầu AI điều chỉnh Schema/Rules..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendMvuChatMessage(); }}
              style={{
                flex: 1,
                background: 'var(--bg-default)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.72rem',
                padding: '6px 10px',
              }}
            />
            <button
              onClick={handleSendMvuChatMessage}
              disabled={isChatLoading || (!chatInput.trim() && mvuAttachedFiles.length === 0)}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-md p-1.5 active:scale-95 transition-all flex items-center justify-center"
              style={{ width: '28px', height: '28px', border: 'none', cursor: 'pointer' }}
            >
              {isChatLoading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}


// Helper to check if AI response was truncated mid-generation
const checkResponseCut = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  
  // 1. Kiểm tra codeblocks markdown lẻ
  const backticks = (trimmed.match(/\`\`\`/g) || []).length;
  if (backticks % 2 !== 0) return true;

  // 2. Kiểm tra XML tag chưa đóng
  const xmlTags = ['Variable_rules', 'thought_process', 'translation'];
  for (const tag of xmlTags) {
    const openCount = (trimmed.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    const closeCount = (trimmed.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (openCount > closeCount) return true;
  }

  // 3. Kiểm tra dấu ngoặc nhọn/vuông chưa đóng
  if (trimmed.includes('{') || trimmed.includes('[')) {
    let openBraces = (trimmed.match(/\\{/g) || []).length;
    let closeBraces = (trimmed.match(/\\}/g) || []).length;
    let openBrackets = (trimmed.match(/\[/g) || []).length;
    let closeBrackets = (trimmed.match(/\]/g) || []).length;
    if (openBraces > closeBraces || openBrackets > closeBrackets) return true;
  }

  // 4. Nếu kết thúc không có dấu câu hợp lệ ở cuối văn bản dài
  if (trimmed.length > 1000) {
    const lastChar = trimmed.slice(-1);
    if (!['.', '!', '?', '>', '}', ']', '\`', '"', "'", '”', '»'].includes(lastChar)) {
      return true;
    }
  }

  return false;
};