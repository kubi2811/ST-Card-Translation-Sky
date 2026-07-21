/**
 * src/lib/ai/agentLoop.ts — Client-Agent Loop for AI Copilot
 * Spec Phần 9.5: runCopilotLoop, handleAction, applyAction
 */

import type { ChatMessage, CharacterCardV3, ProxyProfile, GenerationParams, LorebookEntry, TavernHelperScript, AIGeneratedEntry } from '../../types';
import type { AIAction, AIResponse, WorldbuildingMode, CopilotMessage } from './copilotTypes';
import { callAI } from './client';
import { buildCopilotSystemPrompt } from './copilotPrompts';
import { buildMemoryBlock, getSessionId } from './memoryContext';
import { shouldSummarize, summarizeHistory, buildCompressedHistory, KEEP_RECENT } from './memorySummarizer';
import { useMemoryStore } from '../../store/memoryStore';
import { useCardStore } from '../../store/cardStore';
import { parseAIResponseJSON } from './jsonExtract';
import { materializeEntry, nextEntryId } from '../converters/cardDefaults';
import { toolsEngine } from '../toolsEngine';
import { sanitizeAiKeys } from '../worldbook/keyInput';
import { v4 as uuidv4 } from 'uuid';


// Completeness Protocol
const CRITICAL_ABSOLUTE_COMPLETENESS_PROTOCOL = `
[LỆNH THỰC THI KIÊN QUYẾT TỪ HỆ THỐNG]: 
Ngay cả khi bạn nghĩ rằng bạn đã viết đủ, HÃY TIẾP TỤC TÌM KIẾM VÀ VIẾT THÊM. 
Tuyệt đối KHÔNG ĐƯỢC TÓM TẮT hay LƯỢC BỎ bất kỳ chi tiết nào. 
Mục tiêu của bạn là VẮT KIỆT 100% dữ liệu. Trả về status "CONTINUE" nếu vẫn còn nội dung cần viết. 
Chỉ trả về "DONE" khi bạn chắc chắn không còn một từ nào có thể viết thêm được nữa.`;

// ═══════════════════════════════════════════════════════════════════════════
// COPILOT CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export interface CopilotContext {
  mode: WorldbuildingMode;
  card: CharacterCardV3;
  profile: ProxyProfile;
  generationParams: GenerationParams;
  chatHistory: ChatMessage[];
  contextChip: string;
  autoApply: boolean;
  safeMode?: boolean; // Nếu true, từ chối update/delete entry
  documentChunks?: string[];

  // Callbacks
  paused: boolean;
  stopped: boolean;
  setStatus: (status: string | null) => void;
  appendMessage: (msg: CopilotMessage) => void;
  showThought: (thought: string) => void;
  showActionCard: (action: AIAction) => Promise<'apply' | 'skip'>;
  applyAction: (action: AIAction) => void;
  getCard: () => CharacterCardV3;
}

const MAX_LOOPS = 15;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ─── Cache bản nén lịch sử ───
 * `coveredUpTo` = số lượt đầu ĐÃ được gói vào `summary`; các lượt từ mốc đó trở đi luôn gửi
 * nguyên văn. Có cache thì mới không phải nén lại mỗi lượt (tốn thêm 1 call AI + độ trễ).
 * Bị xoá khi lịch sử ngắn đi (user xoá chat / đổi thẻ). */
let _summaryCache: { coveredUpTo: number; summary: string } | null = null;
/** Phần chưa nén phải dài thêm chừng này mới nén lại. */
const RESUMMARIZE_EVERY = 10;

/**
 * Adapter: bọc `callAI` (nhận AICallOptions, trả AICallResult) thành callback
 * `(prompt: string) => Promise<string>` mà memorySummarizer yêu cầu.
 * Dùng đúng profile + generationParams đang có trong CopilotContext.
 */
function summarizerCallAI(ctx: CopilotContext): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    const res = await callAI({
      profile: ctx.profile,
      // Tóm lược là việc phụ, KHÔNG ép JSON response format (prompt yêu cầu văn xuôi gạch đầu dòng).
      params: { ...ctx.generationParams, useJsonResponseFormat: false },
      messages: [{ role: 'user', content: prompt }],
      label: 'Nén lịch sử chat',
    });
    return res.text;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

export async function runCopilotLoop(userMessage: string, ctx: CopilotContext): Promise<void> {
  const isPipelineMode = ctx.mode === 'genesis' || ctx.mode === 'evolution' || ctx.mode === 'document_extraction';
  // ─── Truy hồi ký ức liên quan tới câu user vừa hỏi ───
  // Lỗi ở đây KHÔNG được làm hỏng chat: nuốt lỗi, coi như không có ký ức.
  let memoryBlock = '';
  try {
    const projectId = useCardStore.getState().currentProjectId ?? undefined;
    const found = useMemoryStore.getState().searchMemory(userMessage, { projectId, sessionId: getSessionId() });
    // Tin rỗng (vd chỉ đính file) → store trả nguyên kho theo thứ tự chèn, không phải theo độ
    // liên quan; khi đó phải ưu tiên ký ức mới nhất thay vì 12 mục cũ nhất.
    memoryBlock = buildMemoryBlock(found, 12, userMessage.trim() === '');
  } catch (e) {
    console.warn('[memory] truy hồi lỗi, bỏ qua:', e);
  }

  const systemPrompt = buildCopilotSystemPrompt(ctx.mode, ctx.getCard(), ctx.contextChip) +
    (memoryBlock ? '\n\n' + memoryBlock : '') +
    (isPipelineMode ? '\n\n' + CRITICAL_ABSOLUTE_COMPLETENESS_PROTOCOL : '');

  // ─── Nén lịch sử chat khi đã quá dài ───
  // Mặc định dùng NGUYÊN lịch sử gốc; chỉ thay bằng bản nén khi nén thành công.
  // Mọi lỗi ở đây đều bị nuốt → chat KHÔNG được đứt.
  let historyPart: ChatMessage[] = ctx.chatHistory;
  try {
    // Lịch sử ngắn đi (user xoá chat / đổi thẻ) → bản nén cũ vô nghĩa, bỏ đi.
    if (_summaryCache && ctx.chatHistory.length < _summaryCache.coveredUpTo) _summaryCache = null;

    if (shouldSummarize(ctx.chatHistory)) {
      // Chỉ nén LẠI khi phần chưa được nén đã dài ra đáng kể. Nếu nén mỗi lượt thì từ lượt 20
      // trở đi lượt nào cũng tốn thêm 1 call AI + độ trễ, mà nội dung gần như y hệt.
      const uncovered = ctx.chatHistory.length - (_summaryCache?.coveredUpTo ?? 0);
      if (!_summaryCache || uncovered >= RESUMMARIZE_EVERY + KEEP_RECENT) {
        ctx.setStatus('🧠 Đang nén lịch sử hội thoại cho gọn...');
        const r = await summarizeHistory(ctx.chatHistory, summarizerCallAI(ctx));
        if (r) {
          _summaryCache = { coveredUpTo: ctx.chatHistory.length - KEEP_RECENT, summary: r.summary };
          ctx.appendMessage({
            id: Date.now().toString(),
            role: 'system',
            content: `🧠 Hội thoại đã dài (${ctx.chatHistory.length} lượt) nên phần cũ được nén thành tóm lược; ${KEEP_RECENT} lượt gần nhất giữ nguyên văn.`,
            timestamp: Date.now(),
          });
        }
        ctx.setStatus(null);
      }

      if (_summaryCache) historyPart = buildCompressedHistory(ctx.chatHistory, _summaryCache);
    }
  } catch (e) {
    console.warn('[memory] nén lịch sử lỗi, dùng lịch sử gốc:', e);
    historyPart = ctx.chatHistory;
    ctx.setStatus(null);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyPart,
    { role: 'user', content: userMessage },
  ];

  let keepRunning = true;
  let loopCount = 0;

  while (keepRunning && loopCount < MAX_LOOPS && !ctx.stopped) {
    while (ctx.paused) await sleep(300);
    loopCount++;
    ctx.setStatus(`Đang gọi AI (lượt ${loopCount})...`);

    let response: AIResponse;
    let rawResult: { text: string; finishReason?: string } | undefined;
    try {
      rawResult = await callAI({
        profile: ctx.profile,
        params: ctx.generationParams,
        messages,
      });
      response = parseAIResponseJSON(rawResult.text);
    } catch (err) {
      if (rawResult && (rawResult.finishReason === 'length' || rawResult.finishReason === 'MAX_TOKENS')) {
        response = {
          message: rawResult.text + '\n\n*(Nội dung bị ngắt dở do giới hạn token. Hệ thống đang tự động yêu cầu viết tiếp...)*',
          thought: '',
          actions: [],
          status: 'CONTINUE'
        };
      } else {
        ctx.appendMessage({
          id: Date.now().toString(),
          role: 'system',
          content: `❌ Lỗi gọi AI: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
        break;
      }
    }

    // Show thought
    if (response.thought) {
      ctx.showThought(response.thought);
    }

    // Handle actions
    for (const action of response.actions) {
      if (ctx.stopped) break;
      await handleAction(action, ctx, messages);
    }

    // Show message
    if (response.message) {
      ctx.appendMessage({
        id: Date.now().toString(),
        role: 'assistant',
        content: response.message,
        thought: response.thought,
        actions: response.actions,
        timestamp: Date.now(),
      });
    }

    // Handle auto-continue if cut off
    if (rawResult && (rawResult.finishReason === 'length' || rawResult.finishReason === 'MAX_TOKENS')) {
      messages.push({
        role: 'assistant',
        content: rawResult.text
      });
      messages.push({
        role: 'user',
        content: 'Vui lòng tiếp tục đoạn văn bản bị ngắt dở ở trên (không cần giải thích, chỉ viết tiếp tục).'
      });
      keepRunning = true;
      continue;
    }

    // Check if we should continue
    const hasPending = response.actions.some(a =>
      ['fetch_fandom_data', 'read_document', 'continue_signal'].includes(a.type)
    );
    keepRunning = response.status === 'CONTINUE' || hasPending;

    if (loopCount >= MAX_LOOPS && keepRunning) {
      ctx.appendMessage({
        id: Date.now().toString(),
        role: 'system',
        content: '⚠️ AI lặp quá nhiều bước. Thử lại với yêu cầu cụ thể hơn.',
        timestamp: Date.now(),
      });
    }
  }

  ctx.setStatus(null);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLER
// ═══════════════════════════════════════════════════════════════════════════

async function handleAction(
  action: AIAction,
  ctx: CopilotContext,
  messages: ChatMessage[],
): Promise<void> {
  switch (action.type) {
    case 'fetch_fandom_data': {
      ctx.setStatus(`🌐 Tải: ${action.data.url}`);
      // This would call fetchWikiPageWithFallback in a real implementation
      // For now, add a system message indicating the action
      messages.push({
        role: 'user',
        content: `[System: fetch_fandom_data requested for "${action.data.url}". User cần copy nội dung vào tab Doc Extract.]`,
      });
      break;
    }

    case 'read_document': {
      const chunk = ctx.documentChunks?.[action.data.chunk_index] ?? '';
      const isLast = action.data.chunk_index >= (ctx.documentChunks?.length ?? 0) - 1;
      messages.push({
        role: 'user',
        content: isLast
          ? `[System: Chunk ${action.data.chunk_index + 1}/${ctx.documentChunks?.length}:\n${chunk}\n[END OF DOCUMENT]]`
          : `[System: Chunk ${action.data.chunk_index + 1}/${ctx.documentChunks?.length}:\n${chunk}]`,
      });
      break;
    }

    case 'continue_signal': {
      // Just continue the loop
      break;
    }

    // `save_memory` KHÔNG phải action áp lên thẻ: executeAction không có case cho nó,
    // nên nếu để rơi xuống default thì hệ thống báo "applied successfully" trong khi
    // không có gì được lưu → AI tin nhầm, panel trống. Chặn tường minh và bắt AI tự sửa.
    case 'save_memory': {
      messages.push({
        role: 'user',
        content: '[System Tool Error] Dùng tool propose_memory để ghi nhớ, KHÔNG phát action save_memory trực tiếp.',
      });
      break;
    }

    default: {
      if (action.type === 'tool_call') {
        const { tool, args } = action.data as { tool: string; args: Record<string, unknown> };
        const toolDef = toolsEngine[tool];
        if (!toolDef) {
          messages.push({ role: 'user', content: `[System: Tool "${tool}" không tồn tại.]` });
        } else {
          ctx.setStatus(`🛠 Đang chạy tool: ${tool}...`);
          try {
            const result = await toolDef.execute(args, ctx);
            messages.push({ role: 'user', content: `[System Tool Result: ${tool}]\n${result}` });
          } catch (e) {
            messages.push({ role: 'user', content: `[System Tool Error: ${tool}]\n${e instanceof Error ? e.message : String(e)}` });
          }
        }
        return;
      }

      // create/update/delete/update_field/add_regex/update_regex/delete_regex/set_variable
      const isDestructive = action.type.startsWith('delete');
      const autoApply = ctx.autoApply && !isDestructive;

      if (autoApply) {
        ctx.applyAction(action);
        messages.push({ role: 'user', content: `[System: Action "${action.type}" applied successfully.]` });
      } else {
        const decision = await ctx.showActionCard(action);
        if (decision === 'apply') {
          ctx.applyAction(action);
          messages.push({ role: 'user', content: `[System: Action "${action.type}" applied by user.]` });
        } else {
          messages.push({ role: 'user', content: `[System: Action "${action.type}" skipped by user.]` });
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLY ACTION TO CARD
// ═══════════════════════════════════════════════════════════════════════════

interface GenericAction {
  type: string;
  data?: {
    comment?: string;
    keys?: string[];
    content?: string;
    id?: string | number;
    patch?: Record<string, unknown>;
    name?: string;
    code?: string;
    key?: string;
    value?: unknown;
    path?: string;
    [key: string]: unknown;
  };
  id?: string | number;
  patch?: Record<string, unknown>;
}

export function executeAction(
  rawAction: AIAction,
  card: CharacterCardV3,
  addEntry: (entry: LorebookEntry) => void,
  updateEntry: (id: number, patch: Partial<LorebookEntry>) => void,
  deleteEntry: (id: number) => void,
  updateField: (path: string, value: unknown) => void,
  safeMode: boolean = false
): void {
  const action = rawAction as unknown as GenericAction;
  if (!card.data.character_book) {
    card.data.character_book = { name: card.data.name, entries: [] };
  }
  if (!card.data.character_book.entries) {
    card.data.character_book.entries = [];
  }
  const entries = card.data.character_book.entries;
  // Build lookup Set for duplicate check (O(1))
  const existingComments = new Set(entries.map(e => e.comment.trim().toLowerCase()));

  switch (action.type) {
    case 'create_entry': {
      // Duplicate check
      const newComment = (action.data?.comment || '').trim().toLowerCase();
      if (existingComments.has(newComment)) {
        console.warn(`[SafeMode] Bỏ qua tạo entry trùng lặp: ${action.data?.comment}`);
        break;
      }

      const id = nextEntryId(entries);
      // Force recursion prevention
      const patch = {
        ...action.data,
        // AI hay ra key dính "_" (giao_hàng) hoặc gộp nhiều key vào 1 chuỗi. Người chơi gõ
        // "giao hàng" có khoảng trắng nên key sai kiểu đó không bao giờ kích hoạt → entry chết.
        ...(action.data?.keys ? { keys: sanitizeAiKeys(action.data.keys) } : {}),
        prevent_recursion: true,
        exclude_recursion: true
      };
      const entry = materializeEntry(patch as unknown as AIGeneratedEntry, {}, id);
      addEntry(entry);
      entries.push(entry);
      break;
    }
    case 'update_entry': {
      if (safeMode) {
        console.warn(`[SafeMode] Từ chối update entry ${action.data?.id}`);
        break;
      }
      if (action.data?.id !== undefined) {
        const rawPatch = (action.data.patch ?? {}) as Partial<LorebookEntry>;
        // Sửa entry cũng phải dọn key (cùng lý do như create_entry).
        const cleanPatch = rawPatch.keys
          ? { ...rawPatch, keys: sanitizeAiKeys(rawPatch.keys) }
          : rawPatch;
        updateEntry(Number(action.data.id), cleanPatch);
      }
      break;
    }
    case 'delete_entry': {
      if (safeMode) {
        console.warn(`[SafeMode] Từ chối delete entry ${action.data?.id}`);
        break;
      }
      if (action.data?.id !== undefined) {
        deleteEntry(Number(action.data.id));
      }
      break;
    }
    case 'update_field': {
      if (action.data?.path) {
        updateField(action.data.path, action.data.value);
      }
      break;
    }
    case 'add_regex':
    case 'add_regex_script': {
      if (!card.data.extensions) {
        card.data.extensions = {} as unknown as CharacterCardV3['data']['extensions'];
      }
      if (!card.data.extensions.regex_scripts) {
        card.data.extensions.regex_scripts = [];
      }
      const rawData = action.data;
      const newScript = {
        id: uuidv4(),
        ...rawData,
      };
      card.data.extensions.regex_scripts.push(newScript as unknown as CharacterCardV3['data']['extensions']['regex_scripts'][number]);
      updateField('data.extensions.regex_scripts', card.data.extensions.regex_scripts);
      break;
    }
    case 'update_regex':
    case 'update_regex_script': {
      const data = action.data;
      const id = action.type === 'update_regex' ? action.id : data?.id;
      const patch = action.type === 'update_regex' ? action.patch : data?.patch;
      if (card.data.extensions?.regex_scripts && id) {
        card.data.extensions.regex_scripts = card.data.extensions.regex_scripts.map(s =>
          s.id === id ? { ...s, ...patch } : s
        );
        updateField('data.extensions.regex_scripts', card.data.extensions.regex_scripts);
      }
      break;
    }
    case 'delete_regex':
    case 'delete_regex_script': {
      const data = action.data;
      const id = action.type === 'delete_regex' ? action.id : data?.id;
      if (card.data.extensions?.regex_scripts && id) {
        card.data.extensions.regex_scripts = card.data.extensions.regex_scripts.filter(s => s.id !== id);
        updateField('data.extensions.regex_scripts', card.data.extensions.regex_scripts);
      }
      break;
    }
    case 'create_tavern_script': {
      if (!card.data.extensions) {
        card.data.extensions = {} as unknown as CharacterCardV3['data']['extensions'];
      }
      if (!card.data.extensions.tavern_helper) {
        card.data.extensions.tavern_helper = { scripts: [], variables: {} };
      }
      if (!card.data.extensions.tavern_helper.scripts) {
        card.data.extensions.tavern_helper.scripts = [];
      }
      const rawData = action.data;
      const newScript: TavernHelperScript = {
        type: 'script',
        enabled: true,
        id: uuidv4(),
        name: rawData?.name || 'Script',
        content: rawData?.code || '',
        info: 'Sinh bởi AI Copilot',
        button: { enabled: false, buttons: [] },
        data: {},
      };
      card.data.extensions.tavern_helper.scripts.push(newScript);
      updateField('data.extensions.tavern_helper.scripts', card.data.extensions.tavern_helper.scripts);
      break;
    }
    case 'set_variable': {
      if (!card.data.extensions) {
        card.data.extensions = {} as unknown as CharacterCardV3['data']['extensions'];
      }
      if (!card.data.extensions.tavern_helper) {
        card.data.extensions.tavern_helper = { scripts: [], variables: {} };
      }
      if (!card.data.extensions.tavern_helper.variables) {
        card.data.extensions.tavern_helper.variables = {};
      }
      const rawData = action.data;
      if (rawData?.key) {
        card.data.extensions.tavern_helper.variables[rawData.key] = rawData.value;
        updateField('data.extensions.tavern_helper.variables', card.data.extensions.tavern_helper.variables);
      }
      break;
    }
  }
}
