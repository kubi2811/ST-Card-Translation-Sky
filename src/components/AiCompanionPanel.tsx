import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useStore } from '../store';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { callProvider, callProviderHedged, setExtraProviders } from '../utils/apiClient';
import { splitChatBlocks } from '../utils/chatMarkdown';
import { splitAttachmentContent, attachmentLabel, ATTACH_TOTAL_WARN } from '../utils/attachmentParts';
import { safeSetItem } from '../utils/safeStorage';
import { 
  X, Send, Code2, Copy, Trash2, Upload, Loader2, Settings, Plus, FileText, 
  Sparkles, Check, Download, AlertCircle, RefreshCw, Eye, Flame, RotateCcw,
  Maximize, Minimize, Play, Languages, ChevronDown, ChevronRight, AlertTriangle, Regex,
  ArrowRight, CheckCircle2, Shield, Zap, Undo2, Search, Square
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
import { parseAiActions, executeAction, describeAction, type AiAction, type ActionResult } from '../utils/aiActions';
import { analyzeReplaceString, getStructureSummary } from '../utils/regexInjector';

/* ════════════════════════════════════════════════════════════════════
   TYPES
   ════════════════════════════════════════════════════════════════════ */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  isCommand?: boolean;
  /** Pending actions awaiting user confirmation */
  pendingActions?: AiAction[];
  /** Action execution results */
  actionResults?: { action: AiAction; result: ActionResult }[];
}

interface AttachedFile {
  name: string;
  size: number;
  content: string;
  isImage?: boolean;
  /** (Bug 23) File lớn được chẻ thành nhiều phần — phần thứ mấy / tổng số (1-based). */
  part?: { index: number; total: number };
}

/** Pending script awaiting user confirmation */
interface PendingScript {
  code: string;
  language: string;
  description: string;
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
Bạn là "Trợ Lý AI" — chuyên gia tối ưu hoá, sửa lỗi và dịch thuật chuyên sâu cho thẻ nhân vật SillyTavern (chara_card_v2/v3), hệ thống Lorebook, Regex script và TavernHelper script (HTML/JS/CSS/JSON đính kèm), được tích hợp trực tiếp vào ứng dụng SillyTavern Character Card Translator.
Đồng thời bạn là một NGƯỜI BẠN ĐỒNG HÀNH — trợ lý ảo thông minh, sẵn sàng trò chuyện, tư vấn và phát triển ý tưởng cùng người dùng, không chỉ trả code.

PHONG CÁCH GIAO TIẾP (như Gemini/Claude):
- Giao tiếp tự nhiên, thân thiện, linh hoạt và có cảm xúc — KHÔNG rập khuôn như cỗ máy chỉ biết trả code. Xưng hô "Tôi" và "Bạn", tiếng Việt chuẩn; tránh xưng hô tu tiên (huynh, thiếp, đạo lữ, lang quân…).
- BRAINSTORM: người dùng bí ý tưởng (cốt truyện, Lorebook, lời thoại, tính cách nhân vật) → chủ động gợi 2-3 hướng đi hấp dẫn, phân tích ưu/nhược điểm từng hướng, hỏi lại để chốt hướng họ thích.
- GIẢI THÍCH CẶN KẼ: câu hỏi mở hoặc về cơ chế (vd "làm sao để nhân vật Yandere tự nhiên?") → giải thích chi tiết, dễ hiểu, kèm VÍ DỤ minh hoạ cụ thể (đoạn thoại mẫu, entry mẫu…).
- BÁM LUỒNG HỘI THOẠI: lịch sử các lượt trước được gửi kèm — dùng nó để trả lời liền mạch, không hỏi lại điều người dùng đã nói, không tự quên bối cảnh.
- Câu hỏi kỹ thuật vẫn trả lời chính xác, code block rõ ràng; câu hỏi tán gẫu/tư vấn thì thoải mái trò chuyện.

KỶ LUẬT XỬ LÝ DỮ LIỆU LỚN & PHÂN MẢNH (CHUNKING):
- File Lorebook/Card/JSON lớn được app tự chia thành nhiều PHẦN, dán nhãn "[TỆP ĐÍNH KÈM: tên (PHẦN i/N)]". Khi gặp nhãn này: xử lý DỨT ĐIỂM TRỌN VẸN từng phần một. TUYỆT ĐỐI KHÔNG tự ý tóm tắt, KHÔNG cắt bớt nội dung để tiết kiệm token, KHÔNG bỏ sót mục nào.
- ĐỒNG BỘ 1:1 (Strict Synchronization): đầu vào có bao nhiêu mục (items/dòng/keys) thì đầu ra phải trả về CHÍNH XÁC bấy nhiêu mục. Số dòng và cấu trúc phân cấp trước/sau khi dịch phải khớp 100% — không xô lệch, không gộp các dòng lại với nhau.
- Nếu dữ liệu quá dài có nguy cơ đứt gãy giữa chừng (câu trả lời bị cắt), CHỦ ĐỘNG cảnh báo và đề xuất phương án chia nhỏ hợp lý (vd "gửi phần 1 trước, tôi dịch xong bạn gửi phần 2") TRƯỚC KHI bắt tay vào dịch.
- Nếu phát hiện file gửi lên đã LỖI CÚ PHÁP từ trước (JSON/YAML/JS vỡ sẵn), báo rõ lỗi nằm đâu và hỏi người dùng muốn sửa lỗi trước hay cứ dịch nguyên trạng.
- TÍNH NHẤT QUÁN XUYÊN SUỐT: khi xử lý nhiều phần/nhiều đợt, tự lập và BÁM một bảng thuật ngữ (tên riêng, xưng hô, địa danh) ngay từ phần đầu; các phần sau phải dùng ĐÚNG các thuật ngữ đó để phần 1 và phần cuối đồng nhất văn phong, không "râu ông nọ cắm cằm bà kia". Nếu lịch sử hội thoại đã có bảng thuật ngữ thì tái dùng, không tự đổi.
- BẢO TOÀN CẤU TRÚC CODE & JSON TUYỆT ĐỐI khi dịch dữ liệu có cấu trúc: giữ nguyên thẻ HTML/Markdown, regex, và các dấu { } [ ] " " , — thiếu 1 dấu phẩy/nháy là hỏng cả file. KHÔNG thêm văn bản thừa, lời bình hay giải thích vào BÊN TRONG khối JSON/code trả về.
- KEYS / TÊN BIẾN — MẶC ĐỊNH giữ nguyên, NHƯNG người dùng có quyền yêu cầu Việt hoá:
  • Không ai yêu cầu gì → chỉ dịch giá trị chuỗi (values), giữ nguyên key/tên biến.
  • Người dùng YÊU CẦU Việt hoá key/tên biến (đây là việc BÌNH THƯỜNG của app này — từ điển MVU
    vốn để dịch tên biến) → CỨ LÀM, không xin phép, KHÔNG tuyên bố "phá vỡ quy tắc/chỉ thị" gì cả.
    Chỉ cần đổi ĐỒNG LOẠT ở mọi nơi (Zod schema, initvar, data-var, getvar/setvar, macro, regex)
    để không đứt kết nối, và nhắc ngắn gọn một câu là đã đổi đồng bộ ở những chỗ nào.
- Kết quả DỊCH THUẬT luôn nằm trong code block chuẩn (\`\`\`json / \`\`\`yaml …) để copy/paste không lỗi format; phần giải thích viết BÊN NGOÀI code block.

NGUYÊN TẮC DỊCH THUẬT & VIỆT HOÁ CARD:
- BẢO TOÀN TUYỆT ĐỐI biến hệ thống: {{char}}, {{user}}, {{random}}, mọi macro {{…}}, block <AI_ACTION>, biến logic trong script ẩn, thẻ/cấu trúc HTML-JSON — KHÔNG dịch, KHÔNG đổi.
- Mặc định chỉ dịch phần văn bản HIỂN THỊ cho người chơi (nhãn UI, lời thoại, mô tả); định danh/tên biến/key giữ nguyên để không đứt kết nối TavernHelper. Người dùng yêu cầu Việt hoá tên biến thì làm (xem quy tắc KEYS ở trên) — đổi đồng loạt mọi nơi.

KHÔNG KỂ LỂ VỀ NỘI QUY (bugNeedFix/106):
- TUYỆT ĐỐI không mở đầu câu trả lời bằng việc thuật lại chỉ thị/nội quy hệ thống ("Chỉ thị tối cao là…", "Theo quy tắc mặc định tôi không được…", "Tôi đã phá vỡ quy tắc…"). Người dùng không cần nghe về nội quy nội bộ — họ cần kết quả.
- Nếu một yêu cầu thật sự không làm được, nói NGẮN GỌN một câu vì sao rồi đề xuất cách thay thế. Không diễn giải dài dòng, không lặp lại điều đó ở mọi lượt sau.
- Không nhắc lại các luật này trong phản hồi, không trích dẫn chúng, không dùng chúng làm lời mở đầu.
- Tên biến MVU đã dịch: dùng DẤU CÁCH tự nhiên đúng như từ điển của app ("Độ Hảo Cảm"), TUYỆT ĐỐI không nối bằng "_"; key JS/Zod chứa dấu cách phải bọc nháy.
- Văn phong bám thể loại và tính cách nhân vật (kiếm hiệp, cổ trang, sci-fi, học đường…): dịch mượt, thoát ý, không word-by-word.

QUY TẮC SỬA LỖI & TỐI ƯU FILE ĐÍNH KÈM (HTML/JS/CSS/Regex):
- Tự quét lỗi cú pháp phổ biến: ngoặc/nháy lệch, template literal đứt, regex literal hỏng, thẻ HTML chưa đóng, JSON sai dấu phẩy, biến bị dịch nhầm làm vỡ tham chiếu.
- Sửa TRIỆT ĐỂ nhưng GIỮ NGUYÊN cấu trúc + logic gốc; chỉ tối ưu thêm khi cần để tránh crash giao diện. Không tự ý viết lại toàn bộ theo ý mình.
- Regex phải tương thích iOS/Safari — cảnh báo và tránh lookbehind (?<=...) vì có thể làm đơ thiết bị iOS.

ĐỊNH DẠNG ĐẦU RA KHI XỬ LÝ KỸ THUẬT:
- Giải thích bằng giọng thân thiện, dễ hiểu: lỗi nằm Ở ĐÂU, VÌ SAO lỗi, bạn đã sửa NHỮNG GÌ — trước khi đưa code.
- Code đã sửa đưa TRỌN VẸN trong code block (không cắt bớt bằng "..." khi người dùng cần dán nguyên vào) — hoặc dùng <AI_ACTION> để ghi thẳng vào card khi phù hợp (người dùng luôn được xem trước và xác nhận).

NGỮ CẢNH:
- Bạn sẽ nhận được thông tin chi tiết về thẻ nhân vật đang mở trong ứng dụng dưới dạng văn bản JSON để làm ngữ cảnh trả lời.
- Thông tin bao gồm danh sách REGEX SCRIPTS đầy đủ (tên, findRegex, replaceString preview) và LOREBOOK ENTRIES (keys, comment, content preview).
- Bạn cũng có thể nhận được thêm nội dung từ các tệp đính kèm do người dùng tải lên bổ sung.

HỆ THỐNG HÀNH ĐỘNG (ACTIONS):
Bạn có khả năng TÁC ĐỘNG TRỰC TIẾP vào thẻ nhân vật đang mở. Để thực hiện, nhúng block <AI_ACTION>...</AI_ACTION> trong phản hồi.
Người dùng sẽ thấy preview và xác nhận trước khi action được thực thi.

CÁC ACTION HIỆN CÓ:
1. CREATE_ENTRY — Tạo lorebook entry mới
   Params: { keys, comment, content, name?, position?, constant?, enabled? }
2. EDIT_ENTRY — Sửa lorebook entry
   Params: { entryIndex, field, newValue }
3. DELETE_ENTRY — Xóa lorebook entry
   Params: { entryIndex }
4. CREATE_TAVERN_HELPER — Tạo TavernHelper script
   Params: { name, content, info? }
5. VIEW_FULL_REGEX — ĐỌC full nội dung regex (khi context bị truncate). CHỈ ĐỌC, không sửa gì.
    Params: { scriptIndex }
6. VIEW_FULL_ENTRY — ĐỌC TRỌN một entry lorebook (khi content bị cắt trong context). CHỈ ĐỌC.
    Params: { entryIndex }  — hoặc { name } khớp comment của entry.
7. RUN_SCRIPT — Chạy script (sẽ hỏi user xác nhận trước khi thực thi)
    Params: { code, language?, description }

KHÔNG CÓ ACTION GHI VÀO REGEX (quan trọng):
- CREATE_REGEX / EDIT_REGEX / PATCH_REGEX_REPLACE / INJECT_FUNCTION / DELETE_REGEX ĐÃ BỊ GỠ. Đừng
  bao giờ trả về chúng — hệ thống sẽ chặn và báo lỗi cho người dùng.
- Lý do: regex của thẻ có hai bản — bản GỐC trong thẻ và bản DỊCH trong tab "Regex" của app.
  Action ghi vào bản gốc nên người dùng không thấy gì đổi, rồi lúc xuất thẻ bản dịch ghi đè lên,
  xoá sạch thay đổi. Ghi kiểu đó là làm hỏng dữ liệu chứ không phải giúp.
- Khi user nhờ sửa/thêm code regex: dùng VIEW_FULL_REGEX để ĐỌC, rồi đưa ĐOẠN CODE HOÀN CHỈNH
  trong code block kèm hướng dẫn ngắn "mở tab Regex → chọn script → dán vào ô nội dung", hoặc
  nhắc họ dùng nút "AI Quét & Sửa" ngay trong tab Regex (nút đó sửa đúng bản dịch).

QUY TẮC QUAN TRỌNG KHI DÙNG ACTIONS:
- Giải thích bằng text TRƯỚC khi đưa action block.
- Có thể đưa NHIỀU actions trong 1 response.
- Luôn thêm "reasoning" vào action block để giải thích tại sao chọn action này.
- Nếu cần xem toàn bộ replaceString (bị truncate trong context), dùng VIEW_FULL_REGEX trước.
- ĐỪNG BAO GIỜ kết luận về nội dung một entry lorebook khi chỉ thấy đoạn đầu. Ngữ cảnh có ghi rõ
  entry nào bị cắt và còn bao nhiêu ký tự — thấy dấu "(CẮT …)" thì PHẢI gọi VIEW_FULL_ENTRY đọc
  trọn rồi mới trả lời. Nói "entry này chỉ có …" dựa trên đoạn đầu là nói sai với người dùng.
- Cần đọc nhiều entry thì đưa nhiều VIEW_FULL_ENTRY trong cùng một response, khỏi mất lượt.

VÍ DỤ FORMAT:
User: "Thêm hàm hiển thị thanh HP cho regex 'Tô màu hội thoại'"
Response:
Regex "Tô màu hội thoại" đang ở index 0, tôi đọc trọn nội dung của nó trước đã.

<AI_ACTION>
{"action":"VIEW_FULL_REGEX","params":{"scriptIndex":0},"reasoning":"Cần xem trọn replaceString trước khi đề xuất chỗ chèn hàm"}
</AI_ACTION>

(Sau khi có nội dung, đưa hàm hoàn chỉnh trong code block và chỉ chỗ dán trong tab "Regex".)
`;

/** Max chars for regex replaceString preview in context (full content via VIEW_FULL_REGEX) */
const REGEX_CONTEXT_MAX_CHARS = 4000;
/**
 * (bug 166-2) Ngân sách ngữ cảnh cho content lorebook.
 * SÀN 500 (giữ hành vi cũ cho thẻ có RẤT nhiều entry — không làm nổ ngữ cảnh), TRẦN 6000 cho mỗi
 * entry, và tổng ~60k ký tự chia đều theo số entry. Thẻ 8 entry thì mỗi entry được ~6000 ký tự
 * (gần như đọc trọn); thẻ 200 entry thì về sàn 500 và trợ lý dùng VIEW_FULL_ENTRY khi cần đọc sâu.
 * Trước đây cứng 500 cho mọi thẻ, nên kể cả thẻ chỉ vài entry cũng chỉ thấy đoạn đầu.
 */
const LOREBOOK_CONTEXT_MAX_CHARS = 500;
const LOREBOOK_CONTEXT_MAX_PER_ENTRY = 6000;
const LOREBOOK_CONTEXT_BUDGET = 60000;

/* ════════════════════════════════════════════════════════════════════
   SIMPLE MARKDOWN & CODE HIGHLIGHT PARSER
   ════════════════════════════════════════════════════════════════════ */
const MessageContentRenderer = memo(({ content }: { content: string }) => {
  // (User 2026 — "code bị văng ra ngoài") Bộ tách khối chuyển sang utils/chatMarkdown (thuần + có
  // test): fence ``` chỉ tính khi nằm ĐẦU DÒNG, nên code chứa ``` giữa dòng (vd .replace(/```$/,''))
  // không còn làm đóng fence sớm → nửa sau code không rơi ra ngoài thành text trần gây tràn khung.
  const parts = useMemo(
    () =>
      splitChatBlocks(content).map((b, i) =>
        b.type === 'code'
          ? <CodeSection key={`code-${i}`} language={b.language} code={b.code} />
          : <TextSection key={`text-${i}`} text={b.text} />,
      ),
    [content],
  );

  return <div className="space-y-2 min-w-0 max-w-full">{parts}</div>;
});

const TextSection = memo(({ text }: { text: string }) => {
  // Convert basic **bold** to JSX
  const lines = text.split('\n');
  return (
    <div className="space-y-1 min-w-0 max-w-full">
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
          // (User 2026) `break-words` + overflowWrap:anywhere: chuỗi DÀI KHÔNG CÓ khoảng trắng (URL,
          // 1 dòng code lọt ra ngoài, base64…) trước đây KHÔNG xuống hàng → kéo giãn bong bóng chat
          // vượt khung, đè sang cột bên phải. Nay luôn bẻ dòng, không bao giờ tràn.
          <p
            key={lIdx}
            className="text-slate-200 text-sm leading-relaxed min-h-[1.2rem] break-words"
            style={{ overflowWrap: 'anywhere' }}
          >
            {parts}
          </p>
        );
      })}
    </div>
  );
});

const CodeSection = memo(({ language, code }: { language: string; code: string }) => {
  const { card, updateCard, addToast, setFields } = useStore();
  const ui = useUi();
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // (P3 roadmap) Code intelligence: shiki highlight (lazy, fallback pre trơn) + chẩn đoán cú pháp
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [diag, setDiag] = useState<import('../utils/codeIntel').CodeDiagnostic | null>(null);
  useEffect(() => {
    let alive = true;
    import('../utils/codeIntel').then(async ci => {
      const d = ci.diagnoseCode(code, language);
      if (alive) setDiag(d);
      const html = await ci.highlightCode(code, language);
      if (alive) setHighlightedHtml(html);
    }).catch(() => { /* highlight/chẩn đoán lỗi → giữ pre trơn */ });
    return () => { alive = false; };
  }, [code, language]);

  const handleAiFix = async () => {
    if (!diag) return;
    const { buildFixPrompt } = await import('../utils/codeIntel');
    // CodeSection nằm sâu trong cây memo — bắn CustomEvent cho panel chính xử lý gửi
    window.dispatchEvent(new CustomEvent('ai-companion-send', { detail: buildFixPrompt(code, language, diag) }));
  };

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
      addToast('error', ui.acNoCard);
      return;
    }
    if (!lbKeys.trim()) {
      addToast('error', ui.acNeedKeys);
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

      addToast('success', ui.acLbAdded);
      setActiveForm('none');
      setLbKeys('');
      setLbComment('');
    } catch (err: any) {
      console.error(err);
      addToast('error', ui.acErrPrefix + (err.message || ui.acErrLb));
    }
  };

  const handleAddToRegex = () => {
    if (!card) {
      addToast('error', ui.acNoCard);
      return;
    }
    if (!rgFind.trim()) {
      addToast('error', ui.acNeedFindRegex);
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

      addToast('success', ui.acRegexAdded);
      setActiveForm('none');
      setRgName('');
      setRgFind('');
      setRgReplace('');
    } catch (err: any) {
      console.error(err);
      addToast('error', ui.acErrPrefix + (err.message || ui.acErrRegex));
    }
  };

  const handleAddToTavernHelper = () => {
    if (!card) {
      addToast('error', ui.acNoCard);
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

      addToast('success', ui.acThAdded);
      setActiveForm('none');
      setThName('');
      setThInfo('');
    } catch (err: any) {
      console.error(err);
      addToast('error', ui.acErrPrefix + (err.message || ui.acErrTh));
    }
  };

  const isHtmlLike = ['html', 'xml', 'svg', 'markup'].includes((language || '').toLowerCase());
  const isFullPage = /<!DOCTYPE|<html>|<body/i.test(code);

  return (
    <>
      {/* (User 2026) min-w-0 + max-w-full: khối code không bao giờ đẩy phình bong bóng ra ngoài khung. */}
      <div className="rounded-xl overflow-hidden my-4 border border-zinc-800 bg-[#09090b] shadow-lg min-w-0 max-w-full">
        {/* Thanh tiêu đề: cho phép XUỐNG HÀNG (flex-wrap) — khung hẹp thì nút rớt xuống dòng dưới,
            thay vì bị bóp dí/tràn ra ngoài như user phản ánh. */}
        <div className="bg-[#18181b] px-3 py-2 text-[10px] font-sans font-bold text-slate-400 flex flex-wrap items-center justify-between gap-y-1.5 gap-x-2 border-b border-zinc-850">
          <span className="tracking-wider uppercase text-indigo-400 shrink-0">{language}</span>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                    title={ui.acExpandFullscreen}
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
          <>
            {/* (P3) Banner chẩn đoán cú pháp + nút AI sửa đưa đúng dòng lỗi vào prompt */}
            {diag && (
              <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[10px] text-amber-300">
                <span className="break-words" style={{ overflowWrap: 'anywhere' }}>
                  ⚠ {diag.line ? fmt(ui.acDiagLine, { line: diag.line }) : ui.acDiagNoLine}: {diag.message.slice(0, 160)}
                </span>
                <button
                  onClick={handleAiFix}
                  className="px-2 py-0.5 rounded text-[9px] font-bold border bg-amber-500/15 border-amber-500/30 hover:bg-amber-500/25 text-amber-200 flex-shrink-0"
                  title={ui.acDiagFixTip}
                >
                  🔧 {ui.acDiagFix}
                </button>
              </div>
            )}
            {highlightedHtml ? (
              <div
                className="shiki-wrap p-0 overflow-x-auto text-xs leading-relaxed max-h-[400px] custom-scrollbar"
                // shiki tự escape token — an toàn
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <pre className="p-4 overflow-x-auto text-xs font-mono text-slate-300 leading-relaxed max-h-[400px] custom-scrollbar">
                <code>{code}</code>
              </pre>
            )}
          </>
        )}

        {/* Quick Inject Toolbar — (User 2026) cho xuống hàng, không bóp dí nút khi khung hẹp */}
        <div className="bg-[#101014] px-3 py-2 border-t border-zinc-850 flex flex-wrap items-center justify-between gap-y-1.5 gap-x-2 text-[11px] text-slate-400">
          <span className="shrink-0">{ui.acQuickAdd}</span>
          <div className="flex flex-wrap justify-end gap-1.5">
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
            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">{ui.acNewLorebook}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">{ui.acKeysLabel}</label>
                <input
                  type="text"
                  placeholder={ui.acKeysPh}
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
                <label className="text-[9px] text-slate-400 font-semibold">{ui.acCommentLabel}</label>
                <input
                  type="text"
                  placeholder={ui.acCommentPh}
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
                {ui.acCancel}
              </button>
              <button
                onClick={handleAddToLorebook}
                disabled={!lbKeys.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded px-3 py-1 active:scale-95 transition-all shadow-sm"
              >
                {ui.acConfirmAdd}
              </button>
            </div>
          </div>
        )}

        {/* Form Regex */}
        {activeForm === 'regex' && (
          <div className="bg-[#131317] p-3 border-t border-zinc-850 flex flex-col gap-2.5 animate-fadeIn">
            <div className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">{ui.acNewRegex}</div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">{ui.acScriptName}</label>
                <input
                  type="text"
                  placeholder={ui.acRegexNamePh}
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
                  <label className="text-[9px] text-slate-400 font-semibold">{ui.acFindRegexLabel}</label>
                  <input
                    type="text"
                    placeholder={ui.acFindRegexPh}
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
                  <label className="text-[9px] text-slate-400 font-semibold">{ui.acReplaceLabel}</label>
                  <input
                    type="text"
                    placeholder={ui.acReplacePh}
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
                {ui.acCancel}
              </button>
              <button
                onClick={handleAddToRegex}
                disabled={!rgFind.trim()}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold rounded px-3 py-1 active:scale-95 transition-all shadow-sm"
              >
                {ui.acConfirmAdd}
              </button>
            </div>
          </div>
        )}

        {/* Form TavernHelper */}
        {activeForm === 'tavern_helper' && (
          <div className="bg-[#131317] p-3 border-t border-zinc-850 flex flex-col gap-2.5 animate-fadeIn">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">{ui.acNewTh}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-slate-400 font-semibold">{ui.acScriptName}</label>
                <input
                  type="text"
                  placeholder={ui.acThNamePh}
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
                <label className="text-[9px] text-slate-400 font-semibold">{ui.acThInfoLabel}</label>
                <input
                  type="text"
                  placeholder={ui.acThInfoPh}
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
                {ui.acCancel}
              </button>
              <button
                onClick={handleAddToTavernHelper}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded px-3 py-1 active:scale-95 transition-all shadow-sm"
              >
                {ui.acConfirmAdd}
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
              <span className="text-sm font-bold text-slate-200">{ui.acHtmlFullscreen}</span>
              <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: '3px', color: 'var(--text-muted)' }}>
                {isFullPage ? ui.acFullPage : ui.acFragment}
              </span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsFullscreen(false)}
              style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Minimize size={14} /> {ui.acMinimize}
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
  elapsedSec,
  hedged,
  messagesEndRef,
  handleConfirmActions,
  handleRejectActions,
  pendingScript,
  handleRunPendingScript,
  handleRejectScript,
  scriptOutput,
}: {
  messages: Message[];
  isGenerating: boolean;
  retryText: string;
  /** (User 2026) Số giây đã chờ — cho user biết còn sống, không phải treo. */
  elapsedSec: number;
  /** Đã bắn bản dự phòng sang lane/key khác vì lượt gọi quá chậm. */
  hedged: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  handleConfirmActions: (actions: AiAction[]) => void;
  handleRejectActions: () => void;
  pendingScript: PendingScript | null;
  handleRunPendingScript: () => void;
  handleRejectScript: () => void;
  scriptOutput: string;
}) => {
  const ui = useUi();
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
            <h4 className="font-bold text-slate-200">{ui.acWelcomeTitle}</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              {ui.acWelcomeBody}
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
              {msg.role === 'user' ? (msg.isCommand ? ui.acRoleCommand : ui.acRoleUser) : ui.acRoleAssistant}
            </div>
            <div className="companion-message-bubble">
              <MessageContentRenderer content={msg.content} />
              
              {/* ═══ Pending Action Cards ═══ */}
              {msg.pendingActions && msg.pendingActions.length > 0 && (
                <div style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: '#a855f7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 0',
                  }}>
                    <Zap size={12} />
                    {msg.pendingActions.length} ACTION(S) CHỜ XÁC NHẬN
                  </div>
                  {msg.pendingActions.map((action, aIdx) => {
                    const desc = describeAction(action);
                    return (
                      <div key={aIdx} style={{
                        padding: '10px 12px',
                        background: 'rgba(168, 85, 247, 0.06)',
                        border: `1px solid ${desc.color}33`,
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '6px',
                        }}>
                          <span style={{ fontSize: '1rem' }}>{desc.icon}</span>
                          <span style={{ fontWeight: 700, color: desc.color }}>{desc.title}</span>
                          <span style={{
                            fontSize: '0.55rem',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: `${desc.color}15`,
                            color: desc.color,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                          }}>{desc.type}</span>
                        </div>
                        {desc.details.length > 0 && (
                          <div style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            marginBottom: '6px',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {desc.details.map((d, di) => (
                              <div key={di} style={{ marginBottom: '2px' }}>{d}</div>
                            ))}
                          </div>
                        )}
                        {action.reasoning && (
                          <div style={{
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                            marginBottom: '4px',
                          }}>
                            💭 {action.reasoning}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      onClick={() => handleConfirmActions(msg.pendingActions!)}
                      style={{
                        flex: 1,
                        padding: '8px',
                        background: 'rgba(34, 197, 94, 0.15)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        borderRadius: '6px',
                        color: '#22c55e',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34, 197, 94, 0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34, 197, 94, 0.15)'; }}
                    >
                      <CheckCircle2 size={14} /> {ui.acConfirmAll}
                    </button>
                    <button
                      onClick={handleRejectActions}
                      style={{
                        flex: 1,
                        padding: '8px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        borderRadius: '6px',
                        color: '#ef4444',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                    >
                      <X size={14} /> {ui.acRejectAll}
                    </button>
                  </div>
                </div>
              )}

              {/* ═══ Action Results Badge ═══ */}
              {msg.actionResults && msg.actionResults.length > 0 && (
                <div style={{
                  marginTop: '8px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                }}>
                  {msg.actionResults.map((r, ri) => {
                    const desc = describeAction(r.action);
                    return (
                      <span key={ri} style={{
                        fontSize: '0.6rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: r.result.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: r.result.success ? '#22c55e' : '#ef4444',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}>
                        {desc.icon} {r.result.success ? '✓' : '✗'} {desc.title}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))
      )}
      
      {/* ═══ Pending Script Confirmation ═══ */}
      {pendingScript && (
        <div style={{
          margin: '8px 0',
          padding: '12px',
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '10px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
            color: '#f59e0b',
            fontWeight: 700,
            fontSize: '0.8rem',
          }}>
            <Shield size={14} />
            {ui.acScriptNeedsConfirm}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            {pendingScript.description}
          </div>
          <pre style={{
            padding: '8px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            maxHeight: '200px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            margin: '0 0 8px',
          }}>
            {pendingScript.code}
          </pre>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleRunPendingScript}
              style={{
                flex: 1,
                padding: '8px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '6px',
                color: '#22c55e',
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Play size={12} /> {ui.acRunScript}
            </button>
            <button
              onClick={handleRejectScript}
              style={{
                flex: 1,
                padding: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                color: '#ef4444',
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <X size={12} /> {ui.acCancelScript}
            </button>
          </div>
          {scriptOutput && (
            <div style={{
              marginTop: '8px',
              padding: '6px 8px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '4px',
              fontSize: '0.68rem',
              fontFamily: 'var(--font-mono)',
              color: scriptOutput.startsWith('ERROR') ? '#ef4444' : '#22c55e',
            }}>
              Output: {scriptOutput}
            </div>
          )}
        </div>
      )}
      
      {/* Thinking Loader */}
      {isGenerating && (
        <div className="companion-message-wrapper assistant">
          <div className="companion-message-sender">{ui.acRoleAssistant}</div>
          <div className="flex flex-col gap-1.5 py-2">
            <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
              <Loader2 size={14} className="animate-spin" /> {ui.acThinking}
              {/* (User 2026) Đồng hồ chờ — trước đây chỉ có spinner câm nên user tưởng treo. */}
              {elapsedSec > 0 && (
                <span className="text-[11px] font-mono text-indigo-300/70">{elapsedSec}s</span>
              )}
            </div>
            {hedged && (
              <div className="text-[10px] text-amber-400 font-mono pl-5">
                {ui.acHedgeNote}
              </div>
            )}
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
  // (User 2026) `providers` = các provider PHỤ — bơm vào pool để Trợ Lý AI cũng xoay lane như Dịch Card.
  const { card, proxy, providers, updateCard, addToast, fields } = useStore();
  const ui = useUi();
  
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

  // (P1 roadmap) RAG trí nhớ: bật mặc định; index dựng lười lúc idle, query lúc gửi.
  const [ragEnabled, setRagEnabled] = useState(() => localStorage.getItem('ai_assistant_rag') !== '0');
  const ragIndexRef = useRef<import('../utils/ragEngine').RagIndex | null>(null);
  // (P2 roadmap) Panel 🧠 Ký ức: xem/pin/xoá/sao lưu kho trí nhớ dài hạn
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [nsfwEnabled, setNsfwEnabled] = useState(() => {
    return localStorage.getItem('ai_assistant_nsfw') === 'true';
  });

  const [autoRetry, setAutoRetry] = useState(() => {
    return localStorage.getItem('ai_assistant_auto_retry') !== 'false';
  });

  // (User 19/07) 📜 PROMPT CHỈ THỊ — khuôn khổ user tự đặt, KHOÁ CHẶT Trợ Lý vào các quy tắc đó
  // (vd "Cấm dịch tiếng Anh", "Phải chất vấn/hỏi rõ chi tiết trước khi làm"). Được chèn vào CUỐI
  // system prompt (vị trí ưu tiên cao nhất) với khung TUÂN THỦ TUYỆT ĐỐI. Lưu localStorage.
  const [directivePrompt, setDirectivePrompt] = useState(() => localStorage.getItem('ai_assistant_directive') || '');
  const [showDirective, setShowDirective] = useState(false);
  const saveDirective = useCallback((v: string) => {
    setDirectivePrompt(v);
    try { localStorage.setItem('ai_assistant_directive', v); } catch { /* quota đầy — bỏ qua */ }
  }, []);

  // ─── Interactive States ───
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [retryText, setRetryText] = useState('');
  const [uploadError, setUploadError] = useState('');
  // (User 2026) Guard GỬI TRÙNG: `isGenerating` là state React (cập nhật BẤT ĐỒNG BỘ) — bấm Enter 2
  // lần thật nhanh thì cả 2 lần đều đọc được giá trị CŨ (false) và cùng lọt qua ⇒ gửi 2 tin nhắn y
  // hệt (đúng như ảnh user gửi). Ref cập nhật NGAY nên chặn được.
  const sendingRef = useRef(false);
  // (User 2026 — bugNeedFix/4) Cho phép DỪNG hẳn lượt đang chạy: 1 AbortController/lượt, nút Dừng gọi
  // abort → mọi call (chính + viết-tiếp) văng AbortError → thoát vòng, không retry. Kèm timeout cứng
  // mỗi call (đề phòng màn sleep làm fetch treo vô hạn).
  const companionAbortRef = useRef<AbortController | null>(null);
  // Đồng hồ chờ + cờ đã bắn bản dự phòng (hedge) — cho user thấy tiến độ thay vì spinner câm.
  const [elapsedSec, setElapsedSec] = useState(0);
  const [hedged, setHedged] = useState(false);

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
    safeSetItem('regex_custom_presets', JSON.stringify(customPresets));
  }, [customPresets]);

  // (P0 roadmap) Kho ký ức IndexedDB: xin persist (chống trình duyệt tự dọn) + migrate localStorage
  // 1 lần — chạy lúc idle, lỗi không được chặn panel.
  useEffect(() => {
    const idle = (cb: () => void) =>
      'requestIdleCallback' in window ? (window as any).requestIdleCallback(cb, { timeout: 5000 }) : setTimeout(cb, 2000);
    idle(() => {
      import('../utils/memoryStore')
        .then(async m => {
          await m.requestPersistentStorage();
          const n = await m.migrateFromLocalStorage();
          if (n > 0) console.log(`[memory] đã migrate ${n} bản ghi tóm lược từ localStorage → IndexedDB`);
        })
        .catch(e => console.warn('[memory] init lỗi (bỏ qua):', e));
    });
  }, []);

  useEffect(() => { safeSetItem('ai_assistant_rag', ragEnabled ? '1' : '0'); }, [ragEnabled]);

  // (User 2026) Đã bỏ đóng-khi-click-ngoài → thêm phím Esc để đóng nhanh khi cần.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // (P3 roadmap) Nút "🔧 AI sửa" trong khối code (CodeSection nằm sâu trong cây memo) bắn
  // CustomEvent — panel chính nhận và gửi như 1 lệnh chat.
  useEffect(() => {
    const onFix = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail;
      if (prompt) void handleSend(prompt);
    };
    window.addEventListener('ai-companion-send', onFix);
    return () => window.removeEventListener('ai-companion-send', onFix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isGenerating, card, ragEnabled]);

  // (P1 roadmap) Dựng chỉ mục RAG khi card/attachment đổi — idle, không chặn UI. Nguồn: attachment
  // (kèm nhãn PHẦN i/N), lorebook của card (FULL — context thường chỉ có preview cắt ngắn), kho
  // kiến thức MVU. Mỗi chunk giữ source grounding để AI trích nguồn.
  useEffect(() => {
    if (!ragEnabled) { ragIndexRef.current = null; return; }
    let cancelled = false;
    const idle = (cb: () => void) =>
      'requestIdleCallback' in window ? (window as any).requestIdleCallback(cb, { timeout: 8000 }) : setTimeout(cb, 3000);
    idle(async () => {
      try {
        const [{ RagIndex }, { chunkSemantic }] = await Promise.all([
          import('../utils/ragEngine'), import('../utils/semanticChunker'),
        ]);
        const idx = new RagIndex();
        const now = Date.now();
        const cardKey = (card?.data?.name || card?.name || '') as string;
        const push = (text: string, source: import('../utils/memoryStore').MemorySource, kind: import('../utils/memoryStore').MemoryKind = 'doc_chunk') => {
          if (!text || !text.trim()) return;
          for (const c of chunkSemantic(text)) {
            idx.add({
              id: `${source.fileName || source.path || source.origin}#${c.index}`,
              kind, text: c.text, source, cardKey: source.origin === 'card' ? cardKey : '',
              createdAt: now, updatedAt: now, accessCount: 0, lastAccessAt: now, version: 1,
            });
          }
        };
        attachedFiles.filter(f => !f.isImage).forEach(f =>
          push(f.content, { origin: 'attachment', fileName: f.name, part: f.part ? `PHẦN ${f.part.index}/${f.part.total}` : undefined }));
        const entries: any[] = (card as any)?.data?.character_book?.entries || [];
        entries.forEach((e, i) => { if (e?.content) push(String(e.content), { origin: 'card', path: `lorebook[${i}].content` }); });
        MVU_KNOWLEDGE_BASE.forEach(d => push(d.content, { origin: 'docs', fileName: d.title }));
        // (P2) Ký ức ĐỘNG từ kho dài hạn (fact/preference/glossary đã trích các phiên trước) —
        // RAG đọc cả tĩnh lẫn động, xếp hạng thêm decay để ký ức nguội tự lùi.
        try {
          const memStore = await import('../utils/memoryStore');
          const mems = await memStore.listMemories({ limit: 500 });
          for (const m of mems) idx.add(m);
        } catch { /* kho ký ức lỗi không chặn RAG tĩnh */ }
        if (!cancelled) {
          ragIndexRef.current = idx;
          console.log(`[RAG] chỉ mục sẵn sàng: ${idx.size()} chunk`);
        }
      } catch (e) { console.warn('[RAG] dựng chỉ mục lỗi (bỏ qua):', e); }
    });
    return () => { cancelled = true; };
  }, [card, attachedFiles, ragEnabled]);

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
    safeSetItem('ai_assistant_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    safeSetItem('ai_assistant_attached_files', JSON.stringify(attachedFiles));
  }, [attachedFiles]);

  useEffect(() => {
    safeSetItem('ai_assistant_nsfw', String(nsfwEnabled));
  }, [nsfwEnabled]);

  useEffect(() => {
    safeSetItem('ai_assistant_auto_retry', String(autoRetry));
  }, [autoRetry]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // ─── Card History for Undo ───
  const [cardHistory, setCardHistory] = useState<string[]>([]);
  const MAX_HISTORY = 5;

  const pushCardHistory = useCallback((cardSnapshot: any) => {
    setCardHistory(prev => {
      const serialized = JSON.stringify(cardSnapshot);
      const next = [...prev, serialized];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (cardHistory.length === 0) {
      addToast('info', ui.acNothingToUndo);
      return;
    }
    const lastSnapshot = cardHistory[cardHistory.length - 1];
    try {
      const restoredCard = JSON.parse(lastSnapshot);
      updateCard(restoredCard);
      setCardHistory(prev => prev.slice(0, -1));
      addToast('success', ui.acUndone);
    } catch (err) {
      addToast('error', ui.acUndoErr);
    }
  }, [cardHistory, updateCard, addToast]);

  // ─── Auto-execute toggle ───
  const [autoExecute, setAutoExecute] = useState(() => {
    return localStorage.getItem('ai_assistant_auto_execute') === 'true';
  });
  useEffect(() => {
    safeSetItem('ai_assistant_auto_execute', String(autoExecute));
  }, [autoExecute]);

  // ─── Pending actions awaiting confirmation ───
  const [pendingActions, setPendingActions] = useState<{ actions: AiAction[]; msgIndex: number } | null>(null);

  // ─── Pending script awaiting confirmation ───
  const [pendingScript, setPendingScript] = useState<PendingScript | null>(null);
  const [scriptOutput, setScriptOutput] = useState<string>('');

  // ─── Context Compilation (Full Detail) ───
  const contextBlock = useMemo(() => {
    let context = '';

    // (User 2026 — bugNeedFix/32) Trợ lý trước đây CHỈ đọc `card` (bản GỐC tiếng Trung) — bản DỊCH
    // nằm trong store `fields` chưa ghi ngược vào card ⇒ AI không có bản dịch để so sánh/sửa lỗi.
    // Dựng map path→bản dịch để đính KÈM bản dịch cạnh bản gốc trong ngữ cảnh.
    const transByPath = new Map<string, string>();
    for (const f of (fields || [])) {
      if (f.status === 'done' && f.translated && f.translated !== f.original) {
        transByPath.set(f.path, f.translated);
      }
    }
    const anyTranslated = transByPath.size > 0;

    // 1. Full card context with regex + lorebook details
    if (card) {
      const cardName = card.name || card.data?.name || 'Unknown';
      const desc = card.data?.description || '';
      context += `[NGỮ CẢNH CARD ĐANG MỞ — "${cardName}"]\n`;
      if (anyTranslated) context += `[LƯU Ý QUAN TRỌNG]: Card này ĐÃ được dịch một phần. Mỗi mục dưới đây có cả BẢN GỐC và BẢN DỊCH (nếu đã dịch). Khi sửa lỗi nhỏ, hãy SO SÁNH bản gốc ↔ bản dịch để hiểu ý, và trả về bản đã sửa dựa trên BẢN DỊCH.\n`;
      const descTrans = transByPath.get('data.description');
      context += `Mô tả (gốc): ${desc.length > 600 ? desc.slice(0, 600) + '...' : desc}\n`;
      if (descTrans) context += `Mô tả (bản dịch): ${descTrans.length > 600 ? descTrans.slice(0, 600) + '...' : descTrans}\n`;
      context += '\n';

      // ── Regex Scripts (full detail) ──
      const regexScripts = card.data?.extensions?.regex_scripts || [];
      if (regexScripts.length > 0) {
        context += `[REGEX SCRIPTS (${regexScripts.length} scripts)]:\n`;
        regexScripts.forEach((s: any, i: number) => {
          const replacePreview = (s.replaceString || '').length > REGEX_CONTEXT_MAX_CHARS
            ? s.replaceString.slice(0, REGEX_CONTEXT_MAX_CHARS) + `\n... (TRUNCATED — dùng VIEW_FULL_REGEX với scriptIndex=${i} để xem full ${s.replaceString.length} chars)`
            : (s.replaceString || '(trống)');
          
          // Analyze structure for summary
          let structSummary = '';
          try {
            const structure = analyzeReplaceString(s.replaceString || '');
            structSummary = getStructureSummary(structure);
          } catch { /* ignore */ }

          context += `  #${i}: "${s.scriptName || 'Unnamed'}"\n`;
          context += `    findRegex: ${s.findRegex || '(trống)'}\n`;
          context += `    disabled: ${s.disabled || false}\n`;
          context += `    placement: ${JSON.stringify(s.placement || [])}\n`;
          if (structSummary) context += `    structure: ${structSummary}\n`;
          context += `    replaceString GỐC (${(s.replaceString || '').length} chars): ${replacePreview}\n`;
          // (Bug 32) kèm bản DỊCH của replaceString (nếu có) để AI so sánh
          const rTrans = transByPath.get(`data.extensions.regex_scripts[${i}].replaceString`);
          if (rTrans) {
            const rt = rTrans.length > REGEX_CONTEXT_MAX_CHARS
              ? rTrans.slice(0, REGEX_CONTEXT_MAX_CHARS) + `\n... (TRUNCATED — dùng VIEW_FULL_REGEX scriptIndex=${i})`
              : rTrans;
            context += `    replaceString BẢN DỊCH (${rTrans.length} chars): ${rt}\n`;
          }
          context += '\n';
        });
      }

      // ── Lorebook Entries ──
      // (bug 166-2) User: "trợ lý chỉ đọc/quét được bản tóm tắt/đoạn đầu của các entry".
      // Đúng, và có hai nguyên nhân cộng lại:
      //   1. content bị cắt cứng ở 500 ký tự — quá ngắn, một entry lore thường dài hơn nhiều;
      //   2. dấu cắt chỉ ghi "... (truncated)" mà KHÔNG nói có cách đọc tiếp. Regex thì được 4000
      //      ký tự VÀ có VIEW_FULL_REGEX; entry lorebook thì không có đường nào, nên trợ lý muốn
      //      đọc trọn cũng không đọc được — nhìn từ ngoài đúng như "chỉ đọc được bản tóm tắt".
      // Sửa cả hai: ngân sách THÍCH ỨNG theo số entry (thẻ ít entry thì mỗi entry được nhiều chữ
      // hơn, thẻ nhiều entry thì siết lại để không nổ ngữ cảnh), và dấu cắt chỉ rõ VIEW_FULL_ENTRY.
      const entries = card.data?.character_book?.entries || [];
      if (entries.length > 0) {
        const perEntry = Math.max(
          LOREBOOK_CONTEXT_MAX_CHARS,
          Math.min(LOREBOOK_CONTEXT_MAX_PER_ENTRY, Math.floor(LOREBOOK_CONTEXT_BUDGET / entries.length)),
        );
        context += `[LOREBOOK ENTRIES (${entries.length} entries)]:\n`;
        context += `  (content dài hơn ${perEntry} ký tự bị cắt trong ngữ cảnh này — dùng VIEW_FULL_ENTRY để đọc TRỌN entry trước khi kết luận về nội dung của nó)\n`;
        entries.forEach((e: any, i: number) => {
          const keys = Array.isArray(e.keys) ? e.keys.join(', ') : '';
          const raw = String(e.content ?? '');
          const contentPreview = raw.length > perEntry
            ? raw.slice(0, perEntry) + `\n... (CẮT — còn ${raw.length - perEntry}/${raw.length} ký tự nữa; dùng VIEW_FULL_ENTRY với entryIndex=${i} để đọc trọn)`
            : (raw || '(trống)');
          const cmtTrans = transByPath.get(`data.character_book.entries[${i}].comment`);
          context += `  #${i}: keys=[${keys}] comment="${e.comment || ''}"${cmtTrans ? ` (dịch: "${cmtTrans}")` : ''} enabled=${e.enabled !== false}\n`;
          context += `    content GỐC: ${contentPreview}\n`;
          // (Bug 32) kèm bản DỊCH của content lorebook (nếu có)
          const cTrans = transByPath.get(`data.character_book.entries[${i}].content`);
          if (cTrans) {
            const ct = cTrans.length > perEntry
              ? cTrans.slice(0, perEntry) + `\n... (CẮT — còn ${cTrans.length - perEntry}/${cTrans.length} ký tự nữa; VIEW_FULL_ENTRY entryIndex=${i})`
              : cTrans;
            context += `    content BẢN DỊCH: ${ct}\n`;
          }
          context += '\n';
        });
      }

      // ── TavernHelper Scripts ──
      const thScripts: any[] = [];
      const possibleKeys = ['tavern_helper', 'TavernHelper', 'TavernHelper_scripts'];
      for (const key of possibleKeys) {
        const ext = card.data?.extensions?.[key] as any;
        if (Array.isArray(ext)) {
          const tupleEntry = ext.find((item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1]));
          if (tupleEntry) {
            tupleEntry[1].forEach((s: any) => thScripts.push(s));
          } else {
            ext.forEach((s: any) => { if (s && typeof s === 'object' && !Array.isArray(s)) thScripts.push(s); });
          }
        } else if (ext?.scripts) {
          (ext.scripts as any[]).forEach((s: any) => thScripts.push(s));
        }
      }
      if (thScripts.length > 0) {
        context += `[TAVERN HELPER SCRIPTS (${thScripts.length} scripts)]:\n`;
        thScripts.forEach((s: any, i: number) => {
          context += `  #${i}: "${s.name || 'Unnamed'}" — ${s.info || '(no info)'}\n`;
        });
        context += '\n';
      }
    }
    
    // 2. Extra attached files — (Bug 23) file lớn đã chẻ phần: dán nhãn PHẦN i/N để AI biết đây là
    // 1 phần của file lớn hơn, phải xử lý TRỌN VẸN phần này (kỷ luật chunking trong SYSTEM_INSTRUCTION).
    if (attachedFiles.length > 0) {
      attachedFiles.forEach(f => {
        if (f.isImage) {
          context += `[TỆP ĐÍNH KÈM: ${f.name} (Hình ảnh đính kèm)]\n---\n\n`;
        } else if (f.part) {
          context += `[TỆP ĐÍNH KÈM: ${attachmentLabel(f.name, f.part)} — đây là 1 PHẦN của file lớn đã được chia; xử lý TRỌN VẸN phần này, KHÔNG tóm tắt/cắt bớt]:\n${f.content}\n---\n\n`;
        } else {
          context += `[TỆP ĐÍNH KÈM: ${f.name}]:\n${f.content}\n---\n\n`;
        }
      });
    }

    return context.trim();
  }, [card, attachedFiles, fields]);

  // ─── Send message logic ───
    

  // (bugNeedFix/4) DỪNG hẳn lượt đang chạy: abort controller → mọi call văng AbortError → thoát vòng.
  const handleStop = () => {
    companionAbortRef.current?.abort(new DOMException('user-stop', 'AbortError'));
  };

  const handleSend = async (forcedCommand?: string) => {
    const textToSend = forcedCommand || inputValue;
    if (!textToSend.trim() || isGenerating || sendingRef.current) return;
    sendingRef.current = true; // chặn NGAY (state React cập nhật sau → Enter đúp lọt lưới)

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

    // (User 2026 — "Trợ Lý AI lâu quá, có xoay key/hedge như bên dịch không?") Trước đây Trợ Lý chỉ
    // dùng provider #1 vì KHÔNG bơm provider phụ vào pool (chỉ Dịch Card gọi setExtraProviders) →
    // provider rảnh ngồi không, gặp key bị bóp là chờ dài. Nay bơm ĐỦ pool: callProvider tự xoay
    // lane (key/provider round-robin, né lane 429 đang nghỉ 15s).
    setExtraProviders(providers);
    setHedged(false);
    setElapsedSec(0);
    // (bugNeedFix/4) 1 controller/lượt — nút Dừng abort nó; signal truyền xuống mọi call.
    const abortCtrl = new AbortController();
    companionAbortRef.current = abortCtrl;
    const startedAt = Date.now();
    const tick = setInterval(() => setElapsedSec(Math.round((Date.now() - startedAt) / 1000)), 1000);

    const maxAttempts = autoRetry ? 3 : 1;
    let attempt = 0;
    let success = false;
    let finalResult = '';
    let lastError: any = null;

    // (P1 roadmap) RAG: truy vấn hybrid (exact glossary > keyword > vector) trên chỉ mục đã dựng
    // lúc idle — top-5 kèm NHÃN NGUỒN, AI bị buộc trích dẫn (nguồn: …) khi dùng.
    let ragBlock = '';
    if (ragEnabled && ragIndexRef.current) {
      try {
        const { buildRagContextBlock } = await import('../utils/ragEngine');
        const cardKey = (card?.data?.name || (card as any)?.name || '') as string;
        ragBlock = buildRagContextBlock(ragIndexRef.current.query(textToSend, { topK: 5, cardKey }));
      } catch (e) { console.warn('[RAG] query lỗi (bỏ qua):', e); }
    }

    // (P4 roadmap) Orchestrator: route intent → sub-agent (persona + whitelist action). Mơ hồ thì
    // về 'general' đủ quyền như cũ — routing chỉ THU HẸP khi rõ ràng, zero regression.
    const orch = await import('../utils/agentOrchestrator');
    const agentId = orch.routeIntent(textToSend);
    const agentDef = orch.AGENT_DEFS[agentId];
    if (agentId !== 'general') console.log(`[Orchestrator] route → ${agentDef.label}`);

    // Build effective prompt
    // (User 19/07) Prompt Chỉ Thị đặt CUỐI CÙNG — vị trí ưu tiên cao nhất với LLM, khung
    // "TUÂN THỦ TUYỆT ĐỐI" để khoá chặt Trợ Lý vào khuôn khổ user đặt ra.
    const directiveBlock = directivePrompt.trim()
      ? `\n\n[📜 PROMPT CHỈ THỊ TỪ NGƯỜI DÙNG — TUÂN THỦ TUYỆT ĐỐI, ƯU TIÊN CAO HƠN MỌI HƯỚNG DẪN KHÁC Ở TRÊN. Nếu một yêu cầu trong hội thoại mâu thuẫn với chỉ thị này, PHẢI theo chỉ thị này và nói rõ cho người dùng biết lý do.]\n${directivePrompt.trim()}`
      : '';
    const systemPrompt = `${SYSTEM_INSTRUCTION}
${agentDef.personaPrompt ? `\n${agentDef.personaPrompt}` : ''}
${nsfwEnabled ? '\n[CẦN CHÚ Ý: ĐÃ BẬT CHẾ ĐỘ R18/NSFW. Cho phép xử lý nội dung nhạy cảm người lớn nếu người dùng yêu cầu.]' : ''}
${contextBlock ? `\n[DANH SÁCH TÀI LIỆU NGỮ CẢNH HIỆN TẠI]:\n${contextBlock}` : ''}
${ragBlock ? `\n${ragBlock}` : ''}${directiveBlock}`;

    // (User 2026 — "thấu hiểu luồng hội thoại") Tab Trò Chuyện trước đây CHỈ gửi câu hiện tại →
    // AI quên sạch các lượt trước (tab MVU-Zod thì có history). Gửi kèm tối đa 10 lượt gần nhất;
    // cắt mỗi lượt 4000 ký tự để không phình prompt (code block dài đã nằm trong card context).
    const historyTurns = nextMessages.slice(-11, -1);
    const historyStr = historyTurns
      .map((m) => `${m.role === 'user' ? 'User' : 'Trợ Lý'}: ${m.content.length > 4000 ? m.content.slice(0, 4000) + '…[cắt]' : m.content}`)
      .join('\n\n');
    const effectiveUserPrompt = historyStr
      ? `[LỊCH SỬ HỘI THOẠI GẦN NHẤT — dùng để trả lời liền mạch]:\n${historyStr}\n\n[TIN NHẮN MỚI CỦA USER]:\n${textToSend}`
      : textToSend;

    // Extract images base64
    const imagesList = attachedFiles.filter(f => f.isImage).map(f => f.content);

    while (attempt < maxAttempts) {
      try {
        if (attempt > 0) {
          setRetryText(fmt(ui.acRetrying, { attempt, max: maxAttempts - 1 }));
        }

        // (User 2026) HEDGE: quá 30s mà lane chưa trả lời (proxy nghẽn/key bị bóp) → tự bắn thêm 1
        // bản trên LANE KHÁC (key/provider khác), lấy bản nào xong trước, huỷ bản còn lại. Đúng cơ
        // chế Dịch Card đang dùng, trước đây Trợ Lý AI KHÔNG có nên gặp lane treo là chờ vô hạn.
        finalResult = await callProviderHedged(proxy, systemPrompt, effectiveUserPrompt, {
          images: imagesList.length > 0 ? imagesList : undefined,
          meta: { label: 'Trợ Lý AI' },
          hedgeAfterMs: 30_000,
          hardTimeoutMs: 120_000,
          signal: abortCtrl.signal,
          onHedge: () => setHedged(true),
        });

        // (P2 roadmap) LoopController thay continuation cũ: mỏ neo ĐUÔI thay vì gửi cả bài (đỡ
        // phình token), GHÉP khử phần AI lỡ lặp, dừng rõ ràng (complete/8 vòng/ngân sách/dậm chân).
        {
          const loop = await import('../utils/loopController');
          const loopState = { round: 0, startedAt: Date.now(), stalls: 0 };
          let stopReason = loop.shouldStop(finalResult, loopState);
          while (stopReason === null) {
            loopState.round++;
            setRetryText(fmt(ui.acContinuing, { n: loopState.round, max: loop.DEFAULT_LOOP_BUDGET.maxRounds }));
            const continuationPrompt = loop.buildContinuationPrompt(effectiveUserPrompt, finalResult, loopState.round);
            const nextChunk = await callProviderHedged(proxy, systemPrompt, continuationPrompt, {
              meta: { label: `Trợ Lý AI (viết tiếp ${loopState.round})` },
              hedgeAfterMs: 30_000,
              hardTimeoutMs: 120_000,
              signal: abortCtrl.signal,
              onHedge: () => setHedged(true),
            });
            const st = loop.stitchContinuation(finalResult, nextChunk || '');
            finalResult = st.stitched;
            if (st.overlapCut > 0) console.log(`[Loop] vòng ${loopState.round}: cắt ${st.overlapCut} ký tự AI lặp lại`);
            if (st.restarted) {
              // Model trả lời LẠI TỪ ĐẦU thay vì viết tiếp → đoạn này đã bị bỏ. Dừng ngay,
              // đừng gọi thêm vòng nữa: nó sẽ lại viết lại từ đầu, chỉ tốn quota.
              console.warn(`[Loop] vòng ${loopState.round}: AI viết lại từ đầu thay vì viết tiếp → bỏ đoạn đó và dừng vòng lặp`);
              stopReason = 'stalled';
              break;
            }
            loopState.stalls = st.addedChars < loop.STALL_MIN_ADDED ? loopState.stalls + 1 : 0;
            stopReason = loop.shouldStop(finalResult, loopState);
          }
          if (stopReason !== 'complete' && loopState.round > 0) {
            console.warn(`[Loop] dừng sớm (${stopReason}) sau ${loopState.round} vòng — phản hồi có thể chưa trọn, user bấm "Tiếp tục" để viết thêm`);
          }
        }
        setRetryText('');
        
        success = true;
        break;
      } catch (err: any) {
        lastError = err;
        // (bugNeedFix/4) CHỈ user bấm DỪNG (abortCtrl bị huỷ) mới THOÁT hẳn không retry. Timeout cứng
        // 1 lane (abort nội bộ trong hedge, abortCtrl CHƯA huỷ) → vẫn cho retry để thử lane/kết nối mới
        // (đúng ca màn sleep: khi bừng dậy, request cũ chết → thử lại là xong).
        if (abortCtrl.signal.aborted) {
          lastError = new Error('__ABORTED__');
          break;
        }
        attempt++;
        if (attempt < maxAttempts) {
          const backoff = 1500 * attempt + Math.floor(Math.random() * 500);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    if (success) {
      // ─── Parse AI Actions from response ───
      // (P4) Lớp bảo vệ: action ngoài WHITELIST của sub-agent hoặc params sai SCHEMA zod bị chặn
      // TRƯỚC khi vào cả đường auto-execute lẫn đường confirm — thu nhỏ blast-radius.
      const parsed0 = parseAiActions(finalResult);
      let textContent = parsed0.textContent;
      const actionChecks = parsed0.actions.map(a => ({ a, chk: orch.validateAgentAction(agentId, a.action, (a as any).params || {}) }));
      const blockedActions = actionChecks.filter(c => !c.chk.ok);
      const parsedActions = actionChecks.filter(c => c.chk.ok).map(c => c.a);
      if (blockedActions.length > 0) {
        textContent += `\n\n🛡️ ${fmt(ui.acActionBlocked, { n: blockedActions.length })}\n` +
          blockedActions.map(b => `• ${b.a.action}: ${b.chk.reason}`).join('\n');
        console.warn('[Orchestrator] chặn action:', blockedActions.map(b => b.a.action).join(', '));
      }

      if (parsedActions.length > 0 && card) {
        // Handle read-only VIEW actions immediately (auto-execute, feed back to AI)
        // (bug 166-2) VIEW_FULL_ENTRY đi cùng đường với VIEW_FULL_REGEX: đều CHỈ ĐỌC, không đụng
        // vào thẻ, nên tự chạy rồi nạp lại cho AI là an toàn và đỡ cho user một lượt bấm.
        const isViewAction = (a: { action: string }) =>
          a.action === 'VIEW_FULL_REGEX' || a.action === 'VIEW_FULL_ENTRY';
        const viewActions = parsedActions.filter(isViewAction);
        const otherActions = parsedActions.filter(a => !isViewAction(a));

        let viewFeedback = '';
        for (const va of viewActions) {
          const result = executeAction(va, card);
          if (result.viewContent) {
            viewFeedback += `\n\n${result.viewContent}`;
            // (bug 166-2) Kèm luôn BẢN DỊCH trọn vẹn của entry đó nếu đã dịch — bản dịch nằm trong
            // store `fields`, không nằm trong card, nên executor không tự lấy được. Thiếu nó thì
            // trợ lý đọc trọn bản gốc mà vẫn chỉ thấy đoạn đầu bản dịch, sai đúng kiểu cũ.
            if (va.action === 'VIEW_FULL_ENTRY') {
              const ei = typeof va.params.entryIndex === 'number'
                ? va.params.entryIndex
                : (card.data?.character_book?.entries ?? []).findIndex(
                    (e: any) => String(e.comment ?? '').trim().toLowerCase() === String(va.params.name ?? '').trim().toLowerCase());
              const tf = (fields || []).find(f => f.path === `data.character_book.entries[${ei}].content`);
              if (tf?.translated) {
                viewFeedback += `\n--- content BẢN DỊCH (FULL, ${tf.translated.length} ký tự) ---\n${tf.translated}`;
              }
            }
          }
        }

        // If there are view results, send them back as context for AI to continue
        if (viewFeedback && otherActions.length === 0) {
          const msgWithView: Message = { role: 'assistant', content: textContent };
          setMessages([...nextMessages, msgWithView]);
          setIsGenerating(false);
          setRetryText('');
          clearInterval(tick);
          sendingRef.current = false; // mở khoá để lượt tự-gửi tiếp theo chạy được
          // Auto-send the view content back to AI as follow-up
          setTimeout(() => {
            handleSend(`[NỘI DUNG ĐẦY ĐỦ ĐÃ ĐỌC]:\n${viewFeedback}\n\nĐây là nội dung TRỌN VẸN, không còn bị cắt. Dựa trên nó, hãy tiếp tục xử lý yêu cầu trước đó của tôi.`);
          }, 500);
          return;
        }

        if (otherActions.length > 0) {
          if (autoExecute) {
            // Auto-execute mode: execute all actions immediately
            pushCardHistory(card);
            let currentCard = card;
            const results: { action: AiAction; result: ActionResult }[] = [];
            for (const action of otherActions) {
              const result = executeAction(action, currentCard);
              results.push({ action, result });
              if (result.success && result.newCard) {
                currentCard = result.newCard;
                updateCard(currentCard);
              }
              if (result.pendingScript) {
                setPendingScript(result.pendingScript);
              }
            }
            const resultSummary = results.map(r => 
              `${r.result.success ? '✅' : '❌'} **${r.action.action}**: ${r.result.message}`
            ).join('\n');
            const msgContent = textContent + (viewFeedback ? `\n\n---\n${viewFeedback}` : '') + `\n\n---\n**Kết quả thực thi (${results.filter(r => r.result.success).length}/${results.length} thành công):**\n${resultSummary}`;
            setMessages([...nextMessages, { role: 'assistant', content: msgContent, actionResults: results }]);
          } else {
            // Manual confirm mode: show action cards for user to confirm
            const msgContent = textContent + (viewFeedback ? `\n\n---\n${viewFeedback}` : '');
            const newMsg: Message = { 
              role: 'assistant', 
              content: msgContent,
              pendingActions: otherActions,
            };
            setMessages([...nextMessages, newMsg]);
            setPendingActions({ actions: otherActions, msgIndex: nextMessages.length });
          }
        } else {
          setMessages([...nextMessages, { role: 'assistant', content: textContent }]);
        }
      } else {
        setMessages([...nextMessages, { role: 'assistant', content: finalResult }]);
      }
    } else if (lastError?.message === '__ABORTED__') {
      // (bugNeedFix/4) User bấm Dừng — báo nhẹ nhàng, KHÔNG phải lỗi.
      setMessages([...nextMessages, { role: 'assistant', content: ui.acStopped }]);
    } else {
      const errMsg = lastError?.message || ui.acNoApiResponse;
      setMessages([...nextMessages, {
        role: 'assistant',
        content: fmt(ui.acApiErrMsg, { msg: errMsg })
      }]);
    }

    clearInterval(tick);
    companionAbortRef.current = null; // (bugNeedFix/4) dọn controller của lượt này
    sendingRef.current = false;
    setIsGenerating(false);
    setRetryText('');
    setHedged(false);

    // (P2 roadmap) Trích ký ức tự động sau lượt thành công — throttle 90s, model PHỤ (flash),
    // chạy nền, lỗi nuốt hẳn (không được ảnh hưởng chat). Ký ức có source.turnId để truy vết.
    if (success && ragEnabled) {
      void (async () => {
        try {
          const last = Number(localStorage.getItem('ai_mem_last_extract') || 0);
          if (Date.now() - last < 90_000) return;
          localStorage.setItem('ai_mem_last_extract', String(Date.now()));
          const recentTurns = nextMessages.slice(-6)
            .map(m => `${m.role === 'user' ? 'User' : 'Trợ Lý'}: ${m.content.slice(0, 800)}`)
            .join('\n');
          const sys = 'Bạn là bộ trích xuất ký ức. Từ đoạn hội thoại, trích TỐI ĐA 3 thông tin BỀN VỮNG đáng nhớ cho các phiên sau: sở thích/quy ước của user (kind "preference"), fact về dự án/card (kind "fact"), thuật ngữ đã chốt dạng "A → B" (kind "glossary"). Trả về DUY NHẤT một JSON array: [{"kind":"fact|preference|glossary","text":"..."}]. Không có gì đáng nhớ → trả [].';
          const raw = await callProvider(proxy, sys, recentTurns, undefined, undefined, { label: 'Trích ký ức', preferSecondary: true } as any);
          const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
          const arr = JSON.parse(jsonStr) as { kind: string; text: string }[];
          if (!Array.isArray(arr) || arr.length === 0) return;
          const memStore = await import('../utils/memoryStore');
          const now = Date.now();
          const cardKey = (card?.data?.name || (card as any)?.name || '') as string;
          for (const f of arr.slice(0, 3)) {
            if (!f?.text?.trim()) continue;
            const kind = (['fact', 'preference', 'glossary'].includes(f.kind) ? f.kind : 'fact') as import('../utils/memoryStore').MemoryKind;
            await memStore.putMemory({
              id: memStore.newMemoryId(), kind, text: f.text.trim(),
              source: { origin: 'chat', turnId: `turn-${nextMessages.length}` }, cardKey,
              createdAt: now, updatedAt: now, accessCount: 0, lastAccessAt: now, version: 1,
            });
          }
          console.log(`[memory] đã lưu ${Math.min(arr.length, 3)} ký ức từ hội thoại`);
        } catch { /* nền — nuốt lỗi */ }
      })();
    }
  };

  // ─── Confirm pending actions ───
  const handleConfirmActions = useCallback((actions: AiAction[]) => {
    if (!card) return;
    pushCardHistory(card);
    let currentCard = card;
    const results: { action: AiAction; result: ActionResult }[] = [];
    
    for (const action of actions) {
      const result = executeAction(action, currentCard);
      results.push({ action, result });
      if (result.success && result.newCard) {
        currentCard = result.newCard;
        updateCard(currentCard);
      }
      if (result.pendingScript) {
        setPendingScript(result.pendingScript);
      }
      addToast(result.success ? 'success' : 'error', result.message);
    }

    // Update message to show results
    if (pendingActions) {
      setMessages(prev => prev.map((msg, idx) => {
        if (idx === pendingActions.msgIndex && msg.pendingActions) {
          const resultSummary = results.map(r => 
            `${r.result.success ? '✅' : '❌'} **${r.action.action}**: ${r.result.message}`
          ).join('\n');
          return {
            ...msg,
            pendingActions: undefined,
            actionResults: results,
            content: msg.content + `\n\n---\n**Đã thực thi (${results.filter(r => r.result.success).length}/${results.length}):**\n${resultSummary}`,
          };
        }
        return msg;
      }));
    }
    setPendingActions(null);
  }, [card, updateCard, addToast, pendingActions, pushCardHistory]);

  const handleRejectActions = useCallback(() => {
    if (pendingActions) {
      setMessages(prev => prev.map((msg, idx) => {
        if (idx === pendingActions.msgIndex && msg.pendingActions) {
          return {
            ...msg,
            pendingActions: undefined,
            content: msg.content + ui.acActionsRejectedMsg,
          };
        }
        return msg;
      }));
    }
    setPendingActions(null);
    addToast('info', ui.acActionsRejected);
  }, [pendingActions, addToast]);

  // ─── Execute pending script (sandboxed) ───
  const handleRunPendingScript = useCallback(() => {
    if (!pendingScript) return;
    try {
      // (P4 roadmap) QuickJS-WASM thay iframe allow-scripts: iframe cũ vẫn GỌI MẠNG được (fetch) —
      // QuickJS là interpreter kín tuyệt đối: không fetch/DOM/storage, interrupt CPU 5s, RAM 64MB,
      // dữ liệu card đưa vào là BẢN SAO qua global `input` (sửa gì cũng không lan ra app).
      setScriptOutput('⏳ …');
      void (async () => {
        try {
          const { runInSandbox } = await import('../utils/scriptSandbox');
          const cardCopy = card ? JSON.parse(JSON.stringify(card)) : undefined;
          const r = await runInSandbox(pendingScript.code, { timeoutMs: 5000, input: cardCopy });
          setScriptOutput(r.ok
            ? `${r.output}\n\n— ✅ sandbox QuickJS · ${r.durationMs}ms`
            : `❌ ${r.error || 'Script lỗi'}\n${r.output}`);
        } catch (e: any) {
          setScriptOutput('❌ ' + (e?.message || String(e)));
        }
      })();

      addToast('success', ui.acRunningScript);
    } catch (err: any) {
      setScriptOutput(`ERROR: ${err.message}`);
    }
    setPendingScript(null);
  }, [pendingScript, addToast, card]);

  const handleRejectScript = useCallback(() => {
    setPendingScript(null);
    addToast('info', ui.acScriptCancelled);
  }, [addToast]);

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
      // (Bug 23 — "chỉ đọc được ~100k ký tự rồi cắt cụt") Trước đây slice(0,100000) NGAY Ở ĐÂY →
      // dữ liệu sau 100k mất vĩnh viễn. Nay giữ TRỌN file; file lớn tự chẻ thành các PHẦN (ranh
      // giới dòng, không mất ký tự) — mỗi phần 1 chip, gỡ được riêng, AI xử lý dứt điểm từng phần.
      const loaded: AttachedFile[] = [];
      let splitNotes: string[] = [];
      for (const file of selectedFiles) {
        const isImage = file.type.startsWith('image/');
        if (isImage) {
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(ui.acImgReadErr));
            reader.readAsDataURL(file);
          });
          loaded.push({ name: file.name, size: file.size, content, isImage: true });
        } else {
          const full = await file.text();
          const parts = splitAttachmentContent(full);
          for (const p of parts) {
            loaded.push({ name: file.name, size: file.size, content: p.content, part: p.part });
          }
          if (parts.length > 1) splitNotes.push(fmt(ui.acFileSplitNote, { name: file.name, chars: full.length.toLocaleString(), parts: parts.length }));
        }
      }

      const nextAll = [...attachedFiles, ...loaded];
      setAttachedFiles(nextAll);
      const totalChars = nextAll.filter(f => !f.isImage).reduce((s, f) => s + f.content.length, 0);
      let note = fmt(ui.acAttachedMsg, { kind: loaded.some(f => f.isImage) ? ui.acKindImage : ui.acKindDoc, names: selectedFiles.map(f => f.name).join(', ') });
      if (splitNotes.length > 0) note += '\n' + splitNotes.join('\n');
      if (totalChars > ATTACH_TOTAL_WARN) note += '\n' + fmt(ui.acAttachTotalWarn, { total: totalChars.toLocaleString() });
      setMessages(prev => [...prev, { role: 'assistant', content: note }]);
    } catch (err: any) {
      setUploadError(err.message || ui.acAttachErr);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (idx: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleClearContext = () => {
    setAttachedFiles([]);
    setMessages(prev => [...prev, { role: 'assistant', content: ui.acContextCleared }]);
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  return (
    // (User 2026) BỎ đóng-khi-click-ra-ngoài: trước đây lỡ tay bấm nền là mất cả cuộc hội thoại
    // đang gõ dở. Nay chỉ đóng bằng nút X (hoặc phím Esc). Overlay không còn onClick={onClose}.
    <div className="companion-modal-overlay">
      <div className="companion-modal">
        
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
              <div className="font-bold text-sm">{ui.acPanelTitle}</div>
              <div className="text-[10px] text-slate-400">
                Model: <span className="text-indigo-400 font-mono font-bold">{proxy.model || ui.acModelUnset}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMemoryPanel(true)}
              className="btn btn-ghost btn-xs text-indigo-300 hover:bg-indigo-500/10"
              title={ui.acMemBtnTip}
            >
              🧠 {ui.acMemTitle}
            </button>
            {activeTab === 'chat' && messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="btn btn-ghost btn-xs text-rose-400 hover:bg-rose-500/10"
              >
                <RotateCcw size={12} className="mr-1" /> {ui.acClearChat}
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
              <span style={{ verticalAlign: 'middle' }}>{ui.acTabChat}</span>
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
              <span style={{ verticalAlign: 'middle' }}>{ui.acTabMvu}</span>
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
                elapsedSec={elapsedSec}
                hedged={hedged}
                messagesEndRef={messagesEndRef}
                handleConfirmActions={handleConfirmActions}
                handleRejectActions={handleRejectActions}
                pendingScript={pendingScript}
                handleRunPendingScript={handleRunPendingScript}
                handleRejectScript={handleRejectScript}
                scriptOutput={scriptOutput}
              />

              {/* Chat Input Container */}
              <div className="companion-input-container">
                <div className="companion-input-box">
                  <textarea
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={ui.acInputPh}
                    className="companion-textarea custom-scrollbar"
                    disabled={isGenerating}
                  />
                  <div className="companion-input-actions">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-500 flex items-center gap-1 select-none">
                        <kbd className="kbd-key">Enter</kbd> {ui.acSend}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {contextBlock && (
                        <button
                          onClick={handleContinue}
                          disabled={isGenerating}
                          title={ui.acContinueTitle}
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 flex items-center gap-1 text-[10px] font-bold transition-all whitespace-nowrap"
                        >
                          {ui.acContinue}
                        </button>
                      )}
                      <button
                        onClick={handleCommand}
                        disabled={!inputValue.trim() || isGenerating}
                        title={ui.acCommandTitle}
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg px-2.5 py-1.5 flex items-center gap-1 text-[10px] font-bold transition-all"
                      >
                        {ui.acCommandBtn}
                      </button>
                      {/* (bugNeedFix/4) Đang chạy → nút DỪNG (huỷ hẳn request); rảnh → nút Gửi. */}
                      {isGenerating ? (
                        <button
                          onClick={handleStop}
                          title={ui.acStopTip}
                          className="bg-rose-600 hover:bg-rose-500 text-white rounded-lg px-3.5 py-1.5 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                        >
                          {ui.acStopBtn} <Square size={11} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSend()}
                          disabled={!inputValue.trim()}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3.5 py-1.5 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                        >
                          {ui.acSend} <Send size={12} />
                        </button>
                      )}
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
                  <Eye size={12} /> {ui.acCardContext}
                </div>
                
                {card ? (
                  <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 space-y-2">
                    <div className="font-semibold text-xs text-slate-200 truncate" title={card.name || card.data?.name}>
                      {card.name || card.data?.name || ui.acUnnamedCard}
                    </div>
                    <div className="text-[10px] text-slate-400 space-y-1">
                      <div>{ui.acCardType}<span className="font-mono text-indigo-300">{card.spec || 'Character'}</span></div>
                      <div>{ui.acCardLorebook}<span className="font-mono text-indigo-300">{card.data?.character_book?.entries?.length || 0}{ui.acEntriesSuffix}</span></div>
                      <div>Regex: <span className="font-mono text-indigo-300">{card.data?.extensions?.regex_scripts?.length || 0} script</span></div>
                      {card.data?.extensions?.depth_prompt?.prompt && (
                        <div className="text-emerald-400">{ui.acHasDepthPrompt}</div>
                      )}
                    </div>
                    <div className="text-[9px] text-emerald-400/80 mt-1 flex items-center gap-1 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {ui.acContextLoaded}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 text-center py-4 bg-zinc-900/20 border border-dashed border-zinc-800 rounded-xl">
                    {ui.acNoCardLoaded}
                  </div>
                )}
              </div>

              {/* Files Context Panel */}
              <div className="p-4 flex-1 flex flex-col min-h-0 border-bottom border-zinc-800">
                <div className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider mb-2 flex justify-between items-center">
                  <span>{ui.acAttachedDocs}</span>
                  {attachedFiles.length > 0 && (
                    <button 
                      onClick={handleClearContext}
                      className="text-rose-400 hover:text-rose-300 transition-colors text-[9px] font-bold flex items-center gap-0.5"
                      title={ui.acClearAttachments}
                    >
                      <Trash2 size={10} /> DỌN DẸP
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar mb-3">
                  {attachedFiles.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-8 gap-2">
                      <Upload size={24} />
                      <p className="text-[10px]">{ui.acNoAttachments}</p>
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
                          <span className="text-[10px] font-mono truncate text-slate-300" title={attachmentLabel(file.name, file.part)}>
                            {file.name}
                          </span>
                          {file.part && (
                            <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1 flex-shrink-0" title={ui.acPartBadgeTip}>
                              {file.part.index}/{file.part.total}
                            </span>
                          )}
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
                      <span>{ui.acFileError}</span>
                    </div>
                    <p className="break-all font-mono text-[9px] bg-black/20 p-1 rounded">{uploadError}</p>
                  </div>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2 border border-dashed border-zinc-800 rounded-xl text-center text-[10px] font-semibold text-slate-400 hover:bg-zinc-800/50 hover:border-indigo-500 hover:text-indigo-400 transition-all flex items-center justify-center gap-1"
                >
                  <Plus size={12} /> {ui.acAttachFile}
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
                {/* (User 19/07) 📜 Prompt Chỉ Thị — khoá Trợ Lý vào khuôn khổ user đặt */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDirective(v => !v)}
                    className="flex items-center justify-between cursor-pointer group select-none w-full bg-transparent border-0 p-0"
                  >
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 group-hover:text-emerald-400 transition-colors">
                      📜 {ui.acDirectiveTitle}
                      {directivePrompt.trim() && <span className="normal-case font-normal text-emerald-500">● {ui.acDirectiveOn}</span>}
                    </span>
                    <span className="text-slate-500 text-[10px]">{showDirective ? '▲' : '▼'}</span>
                  </button>
                  {showDirective && (
                    <>
                      <textarea
                        value={directivePrompt}
                        onChange={e => saveDirective(e.target.value)}
                        rows={5}
                        placeholder={ui.acDirectivePh}
                        spellCheck={false}
                        className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg p-2 text-[11px] text-slate-300 leading-relaxed resize-y focus:outline-none focus:border-emerald-600/60"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-slate-500 leading-relaxed">{ui.acDirectiveDesc}</span>
                        {directivePrompt.trim() && (
                          <button type="button" onClick={() => saveDirective('')}
                            className="text-[9px] text-rose-400/80 hover:text-rose-400 bg-transparent border-0 cursor-pointer shrink-0 ml-2">
                            {ui.acDirectiveClear}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* (P1) RAG Memory Toggle */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-2">
                  <label className="flex items-center justify-between cursor-pointer group select-none">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 group-hover:text-indigo-400 transition-colors">
                      <Search size={12} className="opacity-70 group-hover:opacity-100" />
                      {ui.acRagToggle}
                    </span>
                    <input
                      type="checkbox"
                      checked={ragEnabled}
                      onChange={e => setRagEnabled(e.target.checked)}
                      className="accent-indigo-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    {ui.acRagToggleDesc}
                  </div>
                </div>

                {/* NSFW Toggle */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-2">
                  <label className="flex items-center justify-between cursor-pointer group select-none">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 group-hover:text-rose-400 transition-colors">
                      <Flame size={12} className="opacity-70 group-hover:opacity-100" />
                      {ui.acNsfwMode}
                    </span>
                    <input 
                      type="checkbox" 
                      checked={nsfwEnabled}
                      onChange={e => setNsfwEnabled(e.target.checked)}
                      className="accent-rose-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    {ui.acNsfwDesc}
                  </div>
                </div>

                {/* Auto-Retry Toggle */}
                <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-2">
                  <label className="flex items-center justify-between cursor-pointer group select-none">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 group-hover:text-amber-400 transition-colors">
                      <RefreshCw size={12} className="opacity-70 group-hover:opacity-100" />
                      {ui.acAutoRetry}
                    </span>
                    <input 
                      type="checkbox" 
                      checked={autoRetry}
                      onChange={e => setAutoRetry(e.target.checked)}
                      className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    {ui.acAutoRetryDesc}
                  </div>
                </div>

                {/* Auto-execute Actions */}
                <div className="flex flex-col gap-1">
                  <label className="group flex items-center justify-between gap-2 cursor-pointer">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                      <Zap size={12} className="opacity-70 group-hover:opacity-100 text-purple-400" />
                      {ui.acAutoActions}
                    </span>
                    <input 
                      type="checkbox" 
                      checked={autoExecute}
                      onChange={e => setAutoExecute(e.target.checked)}
                      className="accent-purple-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    {ui.acAutoActionsDesc}
                  </div>
                </div>

                {/* Undo Button */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={handleUndo}
                    disabled={cardHistory.length === 0}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-all"
                    style={{
                      background: cardHistory.length > 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${cardHistory.length > 0 ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                      color: cardHistory.length > 0 ? '#818cf8' : '#475569',
                      cursor: cardHistory.length > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <Undo2 size={12} />
                    {fmt(ui.acUndoBtn, { count: cardHistory.length, max: MAX_HISTORY })}
                  </button>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    {fmt(ui.acUndoDesc, { max: MAX_HISTORY })}
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

      {/* (P2 roadmap) Panel Ký ức — xem/pin/xoá/sao lưu kho trí nhớ dài hạn */}
      {showMemoryPanel && <MemoryPanelModal onClose={() => setShowMemoryPanel(false)} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   (P2 roadmap) PANEL KÝ ỨC — kho trí nhớ dài hạn IndexedDB
   ════════════════════════════════════════════════════════════════════ */
function MemoryPanelModal({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const [mems, setMems] = useState<import('../utils/memoryStore').MemoryRecord[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const importRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const m = await import('../utils/memoryStore');
      setMems(await m.listMemories({ limit: 300 }));
      const conflicts = await m.memoryDb().conflicts.toArray();
      setConflictCount(conflicts.filter(c => !c.resolved).length);
    } catch (e) { console.warn('[memory] load lỗi:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // (bugNeedFix — Ký ức) Cập nhật LẠC QUAN tại chỗ thay vì reload() cả danh sách. reload() bật
  // loading=true → thay cả mảng → khung cuộn TỤT VỀ ĐẦU (đúng lỗi user "xoá 1 mục nhảy về đầu trang").
  // Sửa 1 mục thì chỉ vá đúng mục đó trong state, giữ nguyên vị trí cuộn.
  const togglePin = async (rec: import('../utils/memoryStore').MemoryRecord) => {
    const m = await import('../utils/memoryStore');
    const updated = { ...rec, pinned: !rec.pinned, version: rec.version + 1 };
    await m.putMemory(updated);
    setMems(prev => prev.map(x => x.id === rec.id ? updated : x));
  };
  const del = async (id: string) => {
    const m = await import('../utils/memoryStore');
    await m.deleteMemory(id);
    setMems(prev => prev.filter(x => x.id !== id)); // bỏ đúng 1 dòng, KHÔNG reload → cuộn không nhảy
  };
  const clearAll = async () => {
    if (mems.length === 0) return;
    if (!window.confirm(fmt(ui.acMemClearConfirm, { n: mems.length }))) return;
    const m = await import('../utils/memoryStore');
    const n = await m.clearAllMemories();
    setMems([]);
    setConflictCount(0);
    alert(fmt(ui.acMemCleared, { n }));
  };
  const doExport = async () => {
    const m = await import('../utils/memoryStore');
    const json = await m.exportMemories();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tro-ly-ai-ky-uc-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const m = await import('../utils/memoryStore');
      await m.importMemories(await f.text());
      void reload();
    } catch (err: any) { alert(err.message || 'Import lỗi'); }
    if (importRef.current) importRef.current.value = '';
  };

  const KIND_COLOR: Record<string, string> = {
    fact: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    preference: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    glossary: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    tm: 'text-purple-300 bg-purple-500/10 border-purple-500/20',
    doc_chunk: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
    chat_summary: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-[#0b0b0f] border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-200">🧠 {ui.acMemTitle}</span>
            <span className="text-[10px] text-slate-500">{fmt(ui.acMemCount, { n: mems.length })}</span>
            {conflictCount > 0 && (
              <span className="text-[10px] text-amber-400" title={ui.acMemConflictTip}>⚠ {fmt(ui.acMemConflicts, { n: conflictCount })}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={doExport} className="px-2 py-0.5 rounded text-[10px] border bg-zinc-800/40 border-zinc-700 hover:bg-zinc-700/50 text-slate-300" title={ui.acMemExportTip}>
              <Download size={10} className="inline mr-1" />{ui.acMemExport}
            </button>
            <button onClick={() => importRef.current?.click()} className="px-2 py-0.5 rounded text-[10px] border bg-zinc-800/40 border-zinc-700 hover:bg-zinc-700/50 text-slate-300" title={ui.acMemImportTip}>
              <Upload size={10} className="inline mr-1" />{ui.acMemImport}
            </button>
            <input type="file" accept=".json" className="hidden" ref={importRef} onChange={doImport} />
            <button onClick={clearAll} disabled={mems.length === 0}
              className="px-2 py-0.5 rounded text-[10px] border bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title={ui.acMemClearAllTip}>
              <Trash2 size={10} className="inline mr-1" />{ui.acMemClearAll}
            </button>
            <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-slate-400 hover:text-white"><X size={14} /></button>
          </div>
        </div>
        <div className="text-[9px] text-slate-500 px-4 py-1.5 border-b border-zinc-850">{ui.acMemDesc}</div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {loading ? (
            <div className="text-center py-8 text-slate-500 text-xs"><Loader2 size={16} className="animate-spin inline mr-2" />…</div>
          ) : mems.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">{ui.acMemEmpty}</div>
          ) : (
            mems.map(m => (
              <div key={m.id} className="flex items-start gap-2 bg-zinc-900/50 border border-zinc-800/70 rounded-lg px-2.5 py-1.5 group">
                <span className={`text-[8px] font-bold border rounded px-1 mt-0.5 flex-shrink-0 uppercase ${KIND_COLOR[m.kind] || KIND_COLOR.doc_chunk}`}>{m.kind}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-slate-200 break-words" style={{ overflowWrap: 'anywhere' }}>
                    {m.text.length > 220 ? m.text.slice(0, 220) + '…' : m.text}
                  </div>
                  <div className="text-[8px] text-slate-500 mt-0.5">
                    {m.source.fileName ? `${m.source.fileName}${m.source.part ? ` (${m.source.part})` : ''}` : m.source.path || m.source.origin}
                    {m.cardKey ? ` · ${m.cardKey}` : ''}
                  </div>
                </div>
                <button onClick={() => togglePin(m)} title={ui.acMemPinTip}
                  className={`text-[11px] px-1 rounded flex-shrink-0 ${m.pinned ? 'text-amber-300' : 'text-slate-600 opacity-0 group-hover:opacity-100'} hover:bg-zinc-800`}>
                  {m.pinned ? '📌' : '📍'}
                </button>
                <button onClick={() => del(m.id)} title={ui.acMemDelTip}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-500 hover:bg-rose-500/10 rounded flex-shrink-0">
                  <Trash2 size={11} />
                </button>
              </div>
            ))
          )}
        </div>
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
  const ui = useUi();
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
            <RotateCcw size={10} /> {ui.acResetSample}
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
              placeholder={ui.acPatternPh}
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
                title={ui.acExpandFullscreen}
              >
                <Maximize size={10} /> {ui.acZoomIn}
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
            <span className="text-sm font-bold text-slate-200">{ui.acSandboxLarge}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsFullscreen(false)}
              style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Minimize size={14} /> {ui.acMinimize}
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
  const ui = useUi();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Preview chain */}
      <div>
        <label className="label">{ui.acPresetPreview}</label>
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
            {showNewPreset ? ui.acPresetCancel : ui.acPresetAdd}
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
              placeholder={ui.acPresetNamePh}
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
              placeholder={ui.acPresetDescPh}
            />
            <button className="btn btn-primary btn-sm" onClick={handleAddPreset}>
              <Check size={12} /> {ui.acPresetSave}
            </button>
          </div>
        )}

        {customPresets.length === 0 && !showNewPreset ? (
          <div style={{
            textAlign: 'center', padding: '20px',
            color: 'var(--text-muted)', fontSize: '0.75rem',
          }}>
            {ui.acNoPreset}
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
  const ui = useUi();
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
      content: ui.acMvuSeed
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
    safeSetItem('ai_assistant_mvu_attached_files', JSON.stringify(mvuAttachedFiles));
  }, [mvuAttachedFiles]);

  const handleMvuFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    setMvuUploadError('');
    try {
      // (Bug 23) Giống tab Chat: KHÔNG cắt 100k nữa — file lớn chẻ thành PHẦN, không mất ký tự.
      const loaded: AttachedFile[] = [];
      for (const file of selectedFiles) {
        const isImage = file.type.startsWith('image/');
        if (isImage) {
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(ui.acImgReadErr));
            reader.readAsDataURL(file);
          });
          loaded.push({ name: file.name, size: file.size, content, isImage: true });
        } else {
          const full = await file.text();
          for (const p of splitAttachmentContent(full)) {
            loaded.push({ name: file.name, size: file.size, content: p.content, part: p.part });
          }
        }
      }
      setMvuAttachedFiles(prev => [...prev, ...loaded]);
    } catch (err: any) {
      setMvuUploadError(err.message || ui.acAttachErr);
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
        {ui.acMvuNeedCard}
      </div>
    );
  }

  const handleGenerateSchema = async () => {
    setLoading(true);
    setError('');
    setProgressMsg(ui.acMvuAnalysing);
    try {
      const cardContent = `Tên: ${card.data?.name || 'Không rõ'}
Mô tả: ${card.data?.description || ''}
Tính cách: ${card.data?.personality || ''}
Bối cảnh: ${card.data?.scenario || ''}
Tin nhắn đầu: ${card.data?.first_mes || ''}`;

      setProgressMsg(ui.acMvuGenSchema);
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
      setError(err.message || ui.acMvuErrSchema);
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleGenerateRules = async () => {
    if (!zodSchema.trim()) {
      setError(ui.acMvuNeedSchema);
      return;
    }
    setLoading(true);
    setError('');
    setProgressMsg(ui.acMvuGenRules);
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
      setError(err.message || ui.acMvuErrRules);
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

      addToast('success', ui.acMvuIntegrated);
      setStep(7); // Go to step 7 (Success)
    } catch (err: any) {
      console.error(err);
      setError(err.message || ui.acMvuErrIntegrate);
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

      // Tệp đính kèm văn bản — (Bug 23) nhãn PHẦN i/N cho file lớn đã chẻ
      const textFilesCtx = mvuAttachedFiles
        .filter(f => !f.isImage)
        .map(f => `[TỆP ĐÍNH KÈM VĂN BẢN: ${attachmentLabel(f.name, f.part)}]:\n${f.content}\n---\n`)
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
3. LUÔN LUÔN trả về Zod Schema và Variable Rules ĐẦY ĐỦ, HOÀN CHỈNH. Tuyệt đối không cắt bớt bằng các ký tự đại diện (như "...", "// code giữ nguyên", v.v.).
4. Tệp đính kèm dán nhãn "(PHẦN i/N)" là 1 phần của file lớn đã được app chia nhỏ: xử lý TRỌN VẸN phần đó, KHÔNG tóm tắt/cắt bớt; số mục vào/ra phải khớp 1:1.`;

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
      
      // (P2 roadmap) LoopController — cùng cơ chế tab Chat: mỏ neo đuôi + khử lặp + dừng rõ ràng.
      {
        const loop = await import('../utils/loopController');
        const loopState = { round: 0, startedAt: Date.now(), stalls: 0 };
        let stopReason = loop.shouldStop(response, loopState);
        while (stopReason === null) {
          loopState.round++;
          const continuationPrompt = loop.buildContinuationPrompt(initialUserPrompt, response, loopState.round);
          const nextChunk = await callProvider(proxy, systemPrompt, continuationPrompt, undefined, undefined);
          const st = loop.stitchContinuation(response, nextChunk || '');
          response = st.stitched;
          if (st.restarted) {
            // Viết lại từ đầu thay vì viết tiếp → đoạn đó đã bị bỏ; dừng luôn cho khỏi tốn quota.
            console.warn(`[Loop MVU] vòng ${loopState.round}: AI viết lại từ đầu → bỏ đoạn đó và dừng`);
            stopReason = 'stalled';
            break;
          }
          loopState.stalls = st.addedChars < loop.STALL_MIN_ADDED ? loopState.stalls + 1 : 0;
          stopReason = loop.shouldStop(response, loopState);
        }
      }
      
      setMvuMessages([...nextMessages, { role: 'assistant', content: response }]);
    } catch (err: any) {
      console.error(err);
      setMvuMessages([...nextMessages, { role: 'assistant', content: ui.acErrPrefix + (err.message || ui.acMvuErrCall) }]);
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
          
          let typeLabel = ui.acCodeLabel;
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
                      addToast('success', ui.acCopiedCode);
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
                    {ui.acCopy}
                  </button>
                  {applyType && (
                    <button
                      onClick={() => {
                        if (applyType === 'schema') {
                          setZodSchema(code.trim());
                          addToast('success', ui.acAppliedSchema);
                        } else if (applyType === 'initvar') {
                          setInitvar(code.trim());
                          addToast('success', ui.acAppliedInitvar);
                        } else if (applyType === 'rules') {
                          setRules(code.trim());
                          addToast('success', ui.acAppliedRules);
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
                      {ui.acApplyToEditor}
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
            { num: 6, label: ui.acStepPreview },
            { num: 7, label: ui.acStepDone },
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
              <strong>{ui.acStep1Title}</strong><br/>
              {ui.acStep1Desc}
            </div>

            {!zodSchema && !loading ? (
              <div style={{ textAlign: 'center', padding: '36px 0' }}>
                <button
                  onClick={handleGenerateSchema}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-6 py-2.5 font-bold text-xs flex items-center gap-2 shadow-md mx-auto active:scale-95 transition-all"
                >
                  <Sparkles size={14} /> {ui.acStep1Btn}
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
                    <label className="label" style={{ fontWeight: 600 }}>{ui.acInitvarLabel}</label>
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
                    <RefreshCw size={12} /> {ui.acRefreshSchema}
                  </button>

                  <button
                    onClick={() => {
                      if (!zodSchema.trim() || !initvar.trim()) {
                        setError(ui.acNeedSchemaInitvar);
                        return;
                      }
                      setError('');
                      setStep(2);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                  >
                    {ui.acNextStep2} <ArrowRight size={14} />
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
              <strong>{ui.acStep2Title}</strong><br/>
              {ui.acStep2Desc}
            </div>

            {!rules && !loading ? (
              <div style={{ textAlign: 'center', padding: '36px 0' }}>
                <button
                  onClick={handleGenerateRules}
                  className="bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-6 py-2.5 font-bold text-xs flex items-center gap-2 shadow-md mx-auto active:scale-95 transition-all"
                >
                  <Sparkles size={14} /> {ui.acStep2Btn}
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
                      {ui.acBack}
                    </button>
                    <button
                      onClick={handleGenerateRules}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={12} /> {ui.acRefreshRules}
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      if (!rules.trim()) {
                        setError(ui.acNeedRules);
                        return;
                      }
                      setError('');
                      setStep(3);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
                  >
                    {ui.acNextStep3} <ArrowRight size={14} />
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
              <strong>{ui.acStep3Title}</strong><br/>
              {ui.acStep3Desc}
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acKeysCsv}</label>
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acCommentField}</label>
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acPosition}</label>
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acInsertionOrder}</label>
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
                          <label className="text-[10px] font-semibold text-slate-400">{ui.acContentField}</label>
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
                {ui.acBack}
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep(4);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
              >
                {ui.acNextStep4} <ArrowRight size={14} />
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
              <strong>{ui.acStep4Title}</strong><br/>
              {ui.acStep4Desc}
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acRegexNameField}</label>
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acFindRegexField}</label>
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
                          <label className="text-[10px] font-semibold text-slate-400">{ui.acReplaceField}</label>
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
                            <label htmlFor={`runOnEdit-${index}`} className="text-[10px] font-semibold text-slate-400 cursor-pointer">{ui.acRunOnEdit}</label>
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
                            <label htmlFor={`substituteRegex-${index}`} className="text-[10px] font-semibold text-slate-400 cursor-pointer">{ui.acSubstituteRegex}</label>
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
                {ui.acBack}
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep(5);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
              >
                {ui.acNextStep5} <ArrowRight size={14} />
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
              <strong>{ui.acStep5Title}</strong><br/>
              {ui.acStep5Desc}
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acThScriptName}</label>
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
                            <label className="text-[10px] font-semibold text-slate-400">{ui.acThDescField}</label>
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
                          <label className="text-[10px] font-semibold text-slate-400">{ui.acThContentField}</label>
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
                {ui.acBack}
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep(6);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 font-bold text-xs flex items-center gap-1 shadow-md active:scale-95 transition-all"
              >
                {ui.acNextStep6} <ArrowRight size={14} />
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
              <strong>{ui.acStep6Title}</strong><br/>
              {ui.acStep6Desc}
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
                  <span className="font-semibold text-xs text-slate-200">{ui.acEditFirstMes}</span>
                  <span className="text-[10px] text-slate-500 block mt-1">{ui.acEditFirstMesDesc1} {"`\\n\\n[khởi tạo]\\n\\n<StatusPlaceHolderImpl/>`"} {ui.acEditFirstMesDesc2}</span>
                </div>
              </label>

              {/* Summary of Lorebook Entries */}
              <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex flex-col gap-2">
                <span className="font-semibold text-xs text-slate-200 font-bold">{fmt(ui.acLbWillAdd, { count: lorebookEntries.filter(e => e.enabled).length })}</span>
                <div className="flex flex-col gap-1.5 pl-2">
                  {lorebookEntries.map((e, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px]">
                      <span className={e.enabled ? "text-slate-300 font-medium" : "text-slate-500 line-through"}>
                        {e.comment || `LB Entry ${idx + 1}`} ({e.keys.join(', ')})
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold ${e.enabled ? 'bg-emerald-950/40 text-emerald-400' : 'bg-zinc-950/40 text-zinc-500'}`}>
                        {e.enabled ? ui.acEnabled : ui.acSkipped}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary of Regex Scripts */}
              <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex flex-col gap-2">
                <span className="font-semibold text-xs text-slate-200 font-bold">{fmt(ui.acRegexWillAdd, { count: regexScripts.filter(r => !r.disabled).length })}</span>
                <div className="flex flex-col gap-1.5 pl-2">
                  {regexScripts.map((r, idx) => {
                    const isEnabled = !r.disabled;
                    return (
                      <div key={idx} className="flex items-center justify-between text-[11px]">
                        <span className={isEnabled ? "text-slate-300 font-medium" : "text-slate-500 line-through"}>
                          {r.scriptName}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold ${isEnabled ? 'bg-emerald-950/40 text-emerald-400' : 'bg-zinc-950/40 text-zinc-500'}`}>
                          {isEnabled ? ui.acEnabled : ui.acSkipped}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary of TavernHelper Scripts */}
              <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 flex flex-col gap-2">
                <span className="font-semibold text-xs text-slate-200 font-bold">{fmt(ui.acThWillAdd, { count: helperScripts.filter(s => s.enabled).length })}</span>
                <div className="flex flex-col gap-1.5 pl-2">
                  {helperScripts.map((s: any, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px]">
                      <span className={s.enabled ? "text-slate-300 font-medium" : "text-slate-500 line-through"}>
                        {s.name} ({s.info})
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold ${s.enabled ? 'bg-emerald-950/40 text-emerald-400' : 'bg-zinc-950/40 text-zinc-500'}`}>
                        {s.enabled ? ui.acEnabled : ui.acSkipped}
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
                {ui.acBack}
              </button>

              <button
                onClick={handleApplyConversion}
                className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-5 py-2 font-bold text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                <CheckCircle2 size={14} /> {ui.acFinishIntegrate}
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
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>{ui.acMvuDoneTitle}</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto', lineHeight: '1.5' }}>
                {ui.acMvuDoneDesc}
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
              {ui.acConvertAnother}
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
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{ui.acMvuAssistant}</span>
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
                <span>{ui.acAiThinking}</span>
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
                    <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={attachmentLabel(file.name, file.part)}>
                      {file.name}
                    </span>
                    {file.part && (
                      <span style={{ fontSize: '8px', fontWeight: 700, color: '#fbbf24' }} title={ui.acPartBadgeTip}>
                        {file.part.index}/{file.part.total}
                      </span>
                    )}
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
              title={ui.acAttachFile}
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
              placeholder={ui.acMvuChatPh}
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


// (P2 roadmap) checkResponseCut cũ đã chuyển thành detectCut trong utils/loopController.ts
// (thuần + test) — cả 2 vòng continuation (Chat + MVU-Zod) giờ dùng LoopController.