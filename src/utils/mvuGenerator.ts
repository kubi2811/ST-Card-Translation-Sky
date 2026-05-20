import { useStore } from '../store';
import { callProvider, ChunkError } from './apiClient';
import { MVU_SCHEMA_GENERATION_PROMPT, MVU_RULES_GENERATION_PROMPT } from './promptBuilder';
import type { CharacterCard, CharacterBookEntry, RegexScript, TavernHelperScript, ProxySettings } from '../types/card';

/**
 * Trình quản lý sinh ra thẻ MVU-Zod.
 * Sử dụng API Client gốc để vượt rào (No Truncation) và cấu trúc thẻ tự động.
 */

// Các regex chuẩn cần tiêm vào
const MVU_REGEXES: RegexScript[] = [
  {
    scriptName: 'MVU: Ẩn thanh trạng thái khởi tạo',
    findRegex: '[\\r\\n]*<StatusPlaceHolderImpl\\/>',
    replaceString: '<style>.StatusPlaceHolderImpl { display: none; }</style><div class="StatusPlaceHolderImpl"><StatusPlaceHolderImpl/></div>',
    placement: ['1'],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: true,
    minDepth: 0,
    maxDepth: 0,
  },
  {
    scriptName: 'MVU: Ẩn thẻ Update gốc',
    findRegex: '[\\r\\n]*<UpdateVariable[^>]*>.*?</UpdateVariable>',
    replaceString: '<span style="display:none;">$&</span>',
    placement: ['1'],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: true,
    minDepth: 0,
    maxDepth: 0,
  },
  {
    scriptName: 'MVU: Loading Cập Nhật',
    findRegex: '<UpdateVariable>(.*?)</UpdateVariable>',
    replaceString: '<div class="mvu-loading" style="padding: 5px; background: rgba(0,0,0,0.5); color: #fff; border-radius: 5px;">⏳ Đang cập nhật trạng thái...</div>',
    placement: ['1'],
    disabled: true, // Thường để disabled hoặc để cho user tự bật tuỳ theme
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: true,
    minDepth: 0,
    maxDepth: 0,
  },
  {
    scriptName: 'MVU: Hoàn Thành Cập Nhật',
    findRegex: '<UpdateVariable>(.*?)</UpdateVariable>',
    replaceString: '<div class="mvu-done" style="padding: 5px; background: rgba(40,167,69,0.5); color: #fff; border-radius: 5px;">✅ Trạng thái đã cập nhật</div>',
    placement: ['1'],
    disabled: true,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: true,
    minDepth: 0,
    maxDepth: 0,
  }
];

// Hàm tạo UUID tạm
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Các script chuẩn cần tiêm vào
const MVU_RUNTIME_SCRIPT: TavernHelperScript = {
  type: "script",
  enabled: true,
  name: "MVU",
  id: generateUUID(),
  content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
  info: "Magical Variable Update Runtime",
  button: {
    enabled: true,
    buttons: [
      { name: "重新处理变量", visible: true },
      { name: "重新读取初始变量", visible: true },
      { name: "快照楼层", visible: false },
      { name: "重演楼层", visible: false },
      { name: "重试额外模型解析", visible: true },
      { name: "清除旧楼层变量", visible: false }
    ]
  },
  data: {}
};

const ZOD_SCHEMA_SCRIPT_TEMPLATE: TavernHelperScript = {
  type: "script",
  enabled: true,
  name: "MVU Zod Schema",
  id: generateUUID(),
  content: "__ZOD_SCHEMA_HERE__",
  info: "MVU State Variables Schema",
  button: {
    enabled: false,
    buttons: []
  },
  data: {}
};

/**
 * Hàm hỗ trợ gọi API liên tục (vượt qua giới hạn cắt đoạn token).
 * Nếu chuỗi JSON hoặc XML không hoàn chỉnh, nó sẽ gọi lại AI.
 */
async function generateWithContinuation(
  config: ProxySettings,
  systemPrompt: string,
  userPrompt: string,
  endToken: string, // VD: '}' hoặc '</Variable_rules>'
  abortSignal?: AbortSignal
): Promise<string> {
  let fullResponse = '';
  let retryCount = 0;
  const maxRetries = 10;
  let currentPrompt = userPrompt;

  while (retryCount < maxRetries) {
    if (abortSignal?.aborted) throw new Error('Cancelled');

    // Mẹo: Thêm lịch sử (fullResponse) vào prompt nếu đang gọi nối tiếp
    const effectivePrompt = fullResponse 
      ? currentPrompt + '\n\n---\nĐoạn văn bản sau đây bị cắt dở dang do giới hạn (chưa thấy ký tự kết thúc \'' + endToken + '\'). Hãy VIẾT TIẾP tục ngay từ chỗ bị cắt, KHÔNG LẶP LẠI phần đã viết:\n' + fullResponse.slice(-500)
      : currentPrompt;

    let chunk = await callProvider(config, systemPrompt, effectivePrompt, abortSignal);
    
    // Nếu AI có xu hướng lặp lại 1 chút cuối, ta tìm điểm giao (logic phức tạp hơn, tạm thời nối thẳng nếu AI thông minh)
    // Hoặc bỏ qua các rác code block
    chunk = chunk.replace(/^[\`\\s]+|[\`\\s]+$/g, '');
    
    if (!fullResponse) {
      fullResponse = chunk;
    } else {
      // Đơn giản hoá việc nối (nếu AI ngoan thì nối thẳng là xong)
      fullResponse += chunk;
    }

    if (fullResponse.trim().endsWith(endToken)) {
      break; // Hoàn thành
    }

    retryCount++;
    console.log(`[MVU Generator] Mảnh ${retryCount} chưa hoàn thành. Gọi tiếp để nối dài...`);
  }

  return fullResponse.trim();
}

/**
 * Luồng chính tiêm MVU Zod vào thẻ hiện tại
 */
export async function injectMvuZodSystem(
  card: CharacterCard,
  proxyConfig: ProxySettings,
  setProgress: (msg: string) => void,
  customSchema: string,
  abortSignal?: AbortSignal
): Promise<CharacterCard> {
  const newCard = JSON.parse(JSON.stringify(card)) as CharacterCard;
  if (!newCard.data) newCard.data = {};
  if (!newCard.data.extensions) newCard.data.extensions = {};
  if (!newCard.data.character_book) newCard.data.character_book = { entries: [] };

  setProgress('Chuẩn bị phân tích thẻ...');
  const cardContent = `Tên: ${newCard.data.name || 'Không rõ'}
Mô tả: ${newCard.data.description || ''}
Tính cách: ${newCard.data.personality || ''}
Bối cảnh: ${newCard.data.scenario || ''}
Tin nhắn đầu: ${newCard.data.first_mes || ''}`;

  let zodSchemaStr = '';
  let initvarStr = '';

  // Bước 1: Sinh Schema & Initvar
  if (customSchema && customSchema.trim()) {
    setProgress('Đang sử dụng Custom Schema...');
    // Dùng Regex hoặc JSON parse để bóc tách từ customSchema nếu nó là cục JSON bự
    try {
      const parsed = JSON.parse(customSchema);
      zodSchemaStr = parsed.zod_schema || JSON.stringify(parsed);
      initvarStr = parsed.initvar || '{}';
    } catch {
      // Fallback: cứ coi custom schema là một cục chữ
      zodSchemaStr = customSchema;
      initvarStr = '{}';
    }
  } else {
    setProgress('Đang gọi AI sinh Zod Schema & Biến số...');
    const rawSchemaJson = await generateWithContinuation(
      proxyConfig,
      MVU_SCHEMA_GENERATION_PROMPT,
      `Hãy thiết kế cấu trúc biến số cho thẻ này. Tuân thủ 100% định dạng JSON đầu ra.\n\nNội dung thẻ:\n${cardContent}`,
      '}',
      abortSignal
    );

    try {
      // Lọc bỏ rác markdown nếu AI quên
      const cleanJsonStr = rawSchemaJson.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      const schemaData = JSON.parse(cleanJsonStr);
      zodSchemaStr = schemaData.zod_schema || '';
      initvarStr = typeof schemaData.initvar === 'string' ? schemaData.initvar : JSON.stringify(schemaData.initvar);
    } catch (e) {
      console.error('Lỗi Parse Zod Schema JSON:', e, rawSchemaJson);
      throw new Error('AI sinh Schema không đúng chuẩn JSON.');
    }
  }

  // Bước 2: Sinh Rules từ Schema
  setProgress('Đang gọi AI sinh <Variable_rules> (Luật cập nhật)...');
  const rulesXml = await generateWithContinuation(
    proxyConfig,
    MVU_RULES_GENERATION_PROMPT,
    `Dưới đây là cấu trúc biến:\n${zodSchemaStr}\n\nViết khối <Variable_rules> cho các biến trên.\nNội dung thẻ để lấy bối cảnh:\n${cardContent}`,
    '</Variable_rules>',
    abortSignal
  );

  // Bước 3: Lắp ráp vào Card
  setProgress('Đang lắp ráp hệ thống MVU vào Thẻ...');

  // 3.1: Thêm [khởi tạo] vào first_mes
  if (newCard.data.first_mes && !newCard.data.first_mes.includes('<StatusPlaceHolderImpl/>')) {
    newCard.data.first_mes += '\\n\\n[khởi tạo]\\n\\n<StatusPlaceHolderImpl/>';
  }

  // 3.2: Tiêm Regex Scripts
  if (!newCard.data.extensions.regex_scripts) {
    newCard.data.extensions.regex_scripts = [];
  }
  const existingRegexNames = newCard.data.extensions.regex_scripts.map(r => r.scriptName);
  for (const r of MVU_REGEXES) {
    if (!existingRegexNames.includes(r.scriptName)) {
      newCard.data.extensions.regex_scripts.push(r);
    }
  }

  // 3.3: Tiêm TavernHelper Scripts (CẢ HAI format để tương thích mọi phiên bản ST)
  // Format 1 (mới, ưu tiên): data.extensions.tavern_helper.scripts
  if (!newCard.data.extensions.tavern_helper) {
    newCard.data.extensions.tavern_helper = { scripts: [] };
  }
  const tavernHelper = newCard.data.extensions.tavern_helper as { scripts: TavernHelperScript[]; [key: string]: unknown };
  if (!tavernHelper.scripts) {
    tavernHelper.scripts = [];
  }
  // Remove old MVU scripts if exists
  tavernHelper.scripts = tavernHelper.scripts.filter(
    s => s.name !== 'MVU Zod Schema' && s.name !== 'MVU'
  );
  tavernHelper.scripts.push(MVU_RUNTIME_SCRIPT);
  tavernHelper.scripts.push({
    ...ZOD_SCHEMA_SCRIPT_TEMPLATE,
    content: zodSchemaStr,
    id: generateUUID(),
  });

  // Format 2 (legacy, fallback): data.extensions.TavernHelper_scripts
  if (!newCard.data.extensions.TavernHelper_scripts) {
    newCard.data.extensions.TavernHelper_scripts = [];
  }
  // Remove old MVU schema script if exists
  newCard.data.extensions.TavernHelper_scripts = newCard.data.extensions.TavernHelper_scripts.filter(
    s => s.name !== 'MVU Zod Schema' && s.name !== 'MVU'
  );
  newCard.data.extensions.TavernHelper_scripts.push(MVU_RUNTIME_SCRIPT);
  newCard.data.extensions.TavernHelper_scripts.push({
    ...ZOD_SCHEMA_SCRIPT_TEMPLATE,
    content: zodSchemaStr,
    id: generateUUID(),
  });

  // 3.4: Tiêm Lorebook Entries
  // Xoá các entry MVU cũ nếu có để tránh trùng
  newCard.data.character_book.entries = newCard.data.character_book.entries.filter(
    e => !e.keys.includes('[initvar]') && !e.keys.includes('Danh sách biến số') && !e.keys.includes('[mvu_update]')
  );

  const newEntries: CharacterBookEntry[] = [
    {
      id: Date.now() + 1,
      keys: ['[initvar]Khởi tạo biến', '[initvar]'],
      comment: 'Hệ thống khởi tạo biến tự động',
      content: `[initvar]\n${initvarStr}`,
      enabled: false, // Thường initvar không cần enabled liên tục
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
      content: rulesXml,
      enabled: true,
      insertion_order: 12,
      position: 'before_char',
      constant: true,
    },
    {
      id: Date.now() + 4,
      keys: ['[mvu_update] Định dạng xuất'],
      comment: 'Hướng dẫn AI cách xuất biến ra JSON Patch',
      content: `<UpdateVariable>
[
  {"op": "replace", "path": "/tên_biến", "value": giá_trị_mới}
]
</UpdateVariable>`,
      enabled: true,
      insertion_order: 13,
      position: 'after_char',
      constant: true,
    }
  ];

  newCard.data.character_book.entries.push(...newEntries);

  setProgress('✅ Chuyển đổi MVU-Zod hoàn tất!');
  return newCard;
}
