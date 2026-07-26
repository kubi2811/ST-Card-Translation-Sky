/**
 * minhNguyetPipeline.ts — Pipeline Engine cho phương pháp Minh Nguyệt
 * 
 * 10 bước theo thứ tự:
 * Thế giới quan → Nhân vật cơ sở → Bảng điều sắc → Ba diện tính (opt)
 * → Tái diễn giải → Tủ quần áo → Bảng NSFW (opt) → NPC (opt)
 * → Xem lướt nhân vật → Khai bạch
 * 
 * Context chaining: output bước trước → input bước sau
 */

import type {
  AutoCreatorConfig,
  MinhNguyetStep,
  StepPreview,
} from '../../types';
import type { AutoCreatorContext } from './autoCreatorPipeline';
import { useCardStore } from '../../store/cardStore';
import { useAutoCreatorStore } from '../../store/autoCreatorStore';
import { getProfileExtractionContext } from './worldbuildingDefaults';
import { callAI } from './client';
import { materializeEntry, nextEntryId } from '../converters/cardDefaults';
import { allocateTags } from '../worldbook/tagManager';
import {
  buildMinhNguyetSystemPrompt,
  getMinhNguyetStepTemplate,
  MINH_NGUYET_STEP_LABELS,
  TAG_SPEC,
} from '../../prompts/minhNguyetTemplates';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT CHAIN — Tích lũy output qua các bước
// ═══════════════════════════════════════════════════════════════════════════

interface StepOutput {
  step: MinhNguyetStep;
  content: string;
}

function buildContextFromPrevious(outputs: StepOutput[]): string {
  if (outputs.length === 0) return '';
  
  const parts = outputs.map(o => {
    const label = MINH_NGUYET_STEP_LABELS[o.step]?.label ?? o.step;
    return `[Kết quả bước "${label}"]\n${o.content}`;
  });
  
  return '\n---\nKết quả các bước trước:\n' + parts.join('\n---\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

export async function runMinhNguyetPipeline(ctx: AutoCreatorContext) {
  const store = useAutoCreatorStore.getState();
  
  if (store.isRunning || store.config.selectedMnSteps.length === 0 || !store.config.idea) {
    return;
  }

  store.setIsRunning(true);
  // (#43) Cùng chuẩn với pipeline Standard: một AbortController cho cả lượt chạy, nút Dừng
  // abort là call AI đang bay chết ngay thay vì chạy nốt rồi ghi kết quả vào card.
  const abortController = new AbortController();
  store.setAbort(abortController);
  store.addLog({ step: 'system', level: 'info', message: '🌙 Pipeline Minh Nguyệt bắt đầu...' });

  const { config } = store;
  const stepsToRun = config.selectedMnSteps;
  const previousOutputs: StepOutput[] = [];

  for (const step of stepsToRun) {
    // Check pause/stop
    while (useAutoCreatorStore.getState().isPaused) {
      await sleep(500);
      if (!useAutoCreatorStore.getState().isRunning) return;
    }
    if (!useAutoCreatorStore.getState().isRunning) {
      store.addLog({ step: 'system', level: 'warning', message: '⏹ Pipeline đã dừng.' });
      return;
    }

    const stepLabel = MINH_NGUYET_STEP_LABELS[step]?.label ?? step;
    store.setMnStepStatus(step, 'running');
    store.setCurrentStep(step);
    store.addLog({ step, level: 'info', message: `🌙 Bắt đầu: ${stepLabel}` });

    try {
      const output = await executeMnStep(step, config, ctx, previousOutputs, abortController.signal);
      
      if (output) {
        previousOutputs.push({ step, content: output });
      }
      
      store.setMnStepStatus(step, 'done');
      store.addLog({ step, level: 'success', message: `✅ Hoàn thành: ${stepLabel}` });
    } catch (error) {
      // (#43) User bấm Dừng → abort: thoát êm, không ghi lỗi bước, không chạy tiếp.
      if (error instanceof DOMException && error.name === 'AbortError') {
        store.addLog({ step: 'system', level: 'warning', message: '⏹ Pipeline đã dừng.' });
        store.setIsRunning(false);
        store.setAbort(null);
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      store.addLog({ step, level: 'error', message: `❌ Lỗi tại ${stepLabel}: ${msg}` });
      
      if (config.autoApplyAll) {
        store.setMnStepStatus(step, 'skipped');
        store.addLog({ step, level: 'warning', message: `⏭ Bỏ qua ${stepLabel}, tiếp tục...` });
      } else {
        store.setMnStepStatus(step, 'error');
        store.setIsRunning(false);
        store.addLog({ step: 'system', level: 'error', message: `Pipeline dừng tại ${stepLabel}.` });
        return;
      }
    }
  }

  // ─── Auto-tag nếu bật ───
  if (config.mnConfig.autoTag) {
    try {
      const cardStore = useCardStore.getState();
      const entries = cardStore.card.data.character_book?.entries ?? [];
      if (entries.length > 0) {
        const tagSummary = allocateTags(entries);
        store.addLog({
          step: 'system', level: 'info',
          message: `🏷️ Auto-tag: ${tagSummary.totalTags} entries đã gán tag`,
        });
      }
    } catch {
      store.addLog({ step: 'system', level: 'warning', message: '⚠️ Auto-tag thất bại' });
    }
  }

  store.setIsRunning(false);
  store.setCurrentStep(null);
  store.setAbort(null);
  store.addLog({ step: 'system', level: 'success', message: '🌙 Pipeline Minh Nguyệt hoàn tất!' });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTE STEP
// ═══════════════════════════════════════════════════════════════════════════

async function executeMnStep(
  step: MinhNguyetStep,
  config: AutoCreatorConfig,
  ctx: AutoCreatorContext,
  previousOutputs: StepOutput[],
  /** (#43) Signal từ nút Dừng — call AI của bước phải chết ngay khi user dừng. */
  signal?: AbortSignal,
): Promise<string | null> {
  const cardStore = useCardStore.getState();
  const store = useAutoCreatorStore.getState();
  
  const template = getMinhNguyetStepTemplate(step);
  if (!template) {
    store.addLog({ step, level: 'warning', message: `⚠️ Không có template cho bước: ${step}` });
    return null;
  }

  // ─── Build prompt với context chaining ───
  const contextFromPrevious = buildContextFromPrevious(previousOutputs);
  
  let extraContext = '';
  // Thêm worldview path context
  if (step === 'worldview') {
    const pathLabels = {
      real_background: 'Đường A: Bối cảnh thực (AI đã biết)',
      small_world: 'Đường B: Thế giới nhỏ (AI biết cơ bản, cần tùy chỉnh)',
      large_world: 'Đường C: Thế giới lớn (nguyên tạo/phức tạp)',
    };
    extraContext = `\n\nĐường thế giới quan được chọn: ${pathLabels[config.mnConfig.worldviewPath]}`;
  }
  
  if (step === 'npc_creation') {
    extraContext += `\n\nSố lượng NPC cần tạo: ${config.mnStepConfigs.npc_creation.npcCount}`;
  }

  if (step === 'opening') {
    extraContext += `\n\nSố lượng khai bạch (lời chào) thay thế (Alternate Greetings) cần tạo: ${config.mnStepConfigs.opening.alternateGreetings}`;
  }
  
  // Thêm card type context
  if (step === 'character_basic' || step === 'color_palette') {
    extraContext += `\n\nLoại thẻ: ${config.mnConfig.cardType === 'single' ? 'Nhân vật đơn' : 'Nhiều nhân vật'}`;
  }

  // Thêm tag spec nếu auto-tag bật
  if (config.mnConfig.autoTag) {
    extraContext += `\n\n${TAG_SPEC}`;
  }

  // Ép viết siêu chi tiết nếu người dùng cấu hình token lớn
  let exhaustiveRule = '';
  if (ctx.generationParams.max_tokens && ctx.generationParams.max_tokens >= 4000) {
    exhaustiveRule = `\n\n[YÊU CẦU ĐỘ DÀI VÀ CHI TIẾT - QUAN TRỌNG]
Người dùng đã cấp dung lượng output rất lớn (${ctx.generationParams.max_tokens} tokens). 
BẠN PHẢI TẬN DỤNG TỐI ĐA dung lượng này để tạo ra nội dung CỰC KỲ CHI TIẾT, TOÀN DIỆN VÀ CHUYÊN SÂU.
- Tuyệt đối không viết tóm tắt, cộc lốc hay dùng các câu ngắn gọn (trừ khi cố ý vì lý do nghệ thuật).
- Mở rộng mọi khía cạnh có thể, cung cấp ví dụ chi tiết, đào sâu vào cơ chế, tâm lý, lịch sử hoặc bối cảnh.
- Không bỏ lỡ bất cứ tiểu tiết nào quan trọng, không dùng các cụm từ "vân vân", "tương tự".`;
  }

  let systemPrompt = buildMinhNguyetSystemPrompt(template, config.idea);
  
  // Inject global Master Instruction & Pipeline Steps
  systemPrompt += getProfileExtractionContext(ctx.profile);
  let userPrompt = `${contextFromPrevious}${extraContext}${exhaustiveRule}

Dựa trên ý tưởng và kết quả các bước trước, hãy tạo nội dung cho bước "${MINH_NGUYET_STEP_LABELS[step]?.label ?? step}".

Yêu cầu:
- Output YAML tiếng Việt trong code block
- Tuân thủ tuyệt đối linh độ, bạch miêu
- Không dùng bát cổ (từ mơ hồ, ẩn dụ kém, vi biểu cảm)
- Đảm bảo nhất quán với các bước trước`;

  // ─── Áp dụng Prompt Override từ mnStepConfigs ───
  const stepConfig = config.mnStepConfigs[step] as unknown as { promptOverride?: string; promptMode: string };
  if (stepConfig && stepConfig.promptOverride) {
    if (stepConfig.promptMode === 'replace') {
      userPrompt = `${contextFromPrevious}${extraContext}${exhaustiveRule}\n\n${stepConfig.promptOverride}`;
    } else if (stepConfig.promptMode === 'append') {
      userPrompt += `\n\n[CHỈ THỊ BỔ SUNG TỪ NGƯỜI DÙNG]\n${stepConfig.promptOverride}`;
    }
  }

  const response = await callAI({
    profile: ctx.profile,
    params: ctx.generationParams,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    signal,
  });

  const output = response.text;

  // ─── Store preview ───
  const preview: StepPreview = {
    rawOutput: output,
    parsedData: output,
    tokenEstimate: Math.ceil(output.length / 4),
  };
  store.setMnStepPreview(step, preview);
  store.setMnStepResult(step, `~${preview.tokenEstimate} tokens`);

  // ─── Auto-apply vào card ───
  if (config.autoApplyAll) {
    applyMnOutputToCard(step, output, config, cardStore);
  }

  return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLY TO CARD — Chuyển output thành entries/card data
// ═══════════════════════════════════════════════════════════════════════════

function applyMnOutputToCard(
  step: MinhNguyetStep,
  output: string,
  config: AutoCreatorConfig,
  cardStore: ReturnType<typeof useCardStore.getState>,
) {
  // Đảm bảo character_book tồn tại
  if (!cardStore.card.data.character_book) {
    cardStore.updateCard((c) => {
      c.data.character_book = { name: c.data.name || 'New Card', entries: [] };
    });
  }

  const entries = cardStore.card.data.character_book!.entries;
  const isSingle = config.mnConfig.cardType === 'single';

  switch (step) {
    case 'worldview': {
      // Thế giới quan → Entry đèn xanh dương (constant)
      const entry = materializeEntry({
        comment: 'Thế giới quan',
        keys: [''],
        content: output,
        constant: true,
      }, {
        defaultPosition: 0,      // before_char
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'character_basic': {
      // Nhân vật cơ sở → Entry constant (single) or selective (multi)
      const entry = materializeEntry({
        comment: 'Nhân vật cơ sở',
        keys: isSingle ? [''] : extractCharNameFromOutput(output),
        content: output,
        constant: isSingle,
        selective: !isSingle,
      }, {
        defaultPosition: 1,      // after_char
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'color_palette': {
      // Bảng điều sắc → Entry constant/selective
      const entry = materializeEntry({
        comment: 'Bảng điều sắc tính cách',
        keys: isSingle ? [''] : extractCharNameFromOutput(output),
        content: output,
        constant: isSingle,
        selective: !isSingle,
      }, {
        defaultPosition: 1,
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'three_faces': {
      const entry = materializeEntry({
        comment: 'Ba diện tính',
        keys: isSingle ? [''] : extractCharNameFromOutput(output),
        content: output,
        constant: isSingle,
        selective: !isSingle,
      }, {
        defaultPosition: 1,
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'secondary_explanation': {
      // Tái diễn giải → Depth 0, System role (đặc biệt!)
      const entry = materializeEntry({
        comment: 'Tái diễn giải',
        keys: extractCharNameFromOutput(output),
        content: output,
        constant: false,
        selective: true,
      }, {
        defaultPosition: 4,      // D0 (Author's Note Top)
        defaultDepth: 0,
        defaultRole: 0,          // System
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'wardrobe': {
      const entry = materializeEntry({
        comment: 'Tủ quần áo',
        keys: isSingle ? [''] : extractCharNameFromOutput(output),
        content: output,
        constant: isSingle,
        selective: !isSingle,
      }, {
        defaultPosition: 1,
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'nsfw_palette': {
      const entry = materializeEntry({
        comment: 'Bảng NSFW điều sắc',
        keys: extractCharNameFromOutput(output),
        content: output,
        constant: false,
        selective: true,
      }, {
        defaultPosition: 1,
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'npc_creation': {
      // NPC có thể trả về nhiều NPC → tạo nhiều entries
      const npcBlocks = splitNpcBlocks(output);
      for (const block of npcBlocks) {
        const entry = materializeEntry({
          comment: `NPC: ${block.name}`,
          keys: [block.name, ...(block.aliases ?? [])],
          content: block.content,
          constant: false,
          selective: true,
        }, {
          defaultPosition: 1,
          defaultDepth: 4,
        }, nextEntryId(entries));
        cardStore.addEntry(entry);
        entries.push(entry);
      }
      break;
    }

    case 'character_overview': {
      // Xem lướt nhân vật → constant, trước char def
      const entry = materializeEntry({
        comment: 'Xem lướt nhân vật',
        keys: [''],
        content: output,
        constant: true,
      }, {
        defaultPosition: 0,
        defaultDepth: 4,
      }, nextEntryId(entries));
      cardStore.addEntry(entry);
      entries.push(entry);
      break;
    }

    case 'opening': {
      // Khai bạch → first_mes + alternate greetings
      const { firstMessage, alternates } = extractOpeningMessages(output);
      cardStore.updateCard((c) => {
        if (firstMessage) c.data.first_mes = firstMessage;
        if (alternates.length > 0) c.data.alternate_greetings = alternates;
      });
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Trích xuất tên nhân vật từ output (heuristic) */
function extractCharNameFromOutput(output: string): string[] {
  // Tìm pattern: Tên: xxx, 姓名: xxx, Thân phận: xxx
  const nameMatch = output.match(/(?:tên|tên nhân vật|姓名|name)\s*[:：]\s*(.+)/i);
  if (nameMatch) {
    return [nameMatch[1].trim().replace(/['"]/g, '')];
  }
  return [''];
}

interface NpcBlock {
  name: string;
  aliases?: string[];
  content: string;
}

/** Tách output chứa nhiều NPC thành blocks riêng */
function splitNpcBlocks(output: string): NpcBlock[] {
  // Tìm pattern: "NPC [tên]:" hoặc "---" separator
  const blocks: NpcBlock[] = [];
  const sections = output.split(/(?:^|\n)(?:NPC\s+|---\s*\n)/i);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    
    const nameMatch = trimmed.match(/^([^\n:]+?)[:：\n]/);
    const name = nameMatch ? nameMatch[1].trim() : `NPC_${blocks.length + 1}`;
    
    blocks.push({ name, content: trimmed });
  }
  
  // Nếu không tách được, coi toàn bộ là 1 NPC
  if (blocks.length === 0 && output.trim()) {
    blocks.push({ name: 'NPC', content: output.trim() });
  }
  
  return blocks;
}

/** Trích xuất first message và alternates từ output khai bạch */
function extractOpeningMessages(output: string): {
  firstMessage: string | null;
  alternates: string[];
} {
  // Tìm phân tách: "Khai bạch 1:", "Alternate 1:", "---"
  const parts = output.split(/(?:^|\n)(?:khai bạch|alternate|lời mở đầu)\s*\d*\s*[:：]?\s*\n?/i)
    .map(p => p.trim())
    .filter(Boolean);
  
  if (parts.length === 0) {
    return { firstMessage: output.trim() || null, alternates: [] };
  }
  
  return {
    firstMessage: parts[0] || null,
    alternates: parts.slice(1),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RETRY / SKIP for MN steps
// ═══════════════════════════════════════════════════════════════════════════

export async function retryMnStep(step: MinhNguyetStep, ctx: AutoCreatorContext) {
  const store = useAutoCreatorStore.getState();
  const config = store.config;

  store.setMnStepStatus(step, 'running');
  store.setCurrentStep(step);
  store.setMnStepPreview(step, null);

  const stepLabel = MINH_NGUYET_STEP_LABELS[step]?.label ?? step;
  store.addLog({ step, level: 'info', message: `🔄 Retry ${stepLabel}...` });

  try {
    // Rebuild previous outputs from results
    const prevOutputs: StepOutput[] = [];
    const allSteps = config.selectedMnSteps;
    for (const s of allSteps) {
      if (s === step) break;
      const result = store.mnStepResults[s];
      if (result) {
        const preview = store.mnStepPreviews[s];
        prevOutputs.push({ step: s, content: preview?.rawOutput ?? result });
      }
    }

    await executeMnStep(step, config, ctx, prevOutputs);
    store.setMnStepStatus(step, 'done');
    store.addLog({ step, level: 'success', message: `✅ Retry thành công: ${stepLabel}` });
  } catch (error) {
    store.setMnStepStatus(step, 'error');
    store.addLog({ step, level: 'error', message: `❌ Retry thất bại: ${error instanceof Error ? error.message : String(error)}` });
  }
  store.setCurrentStep(null);
}

export function skipMnStep(step: MinhNguyetStep) {
  const store = useAutoCreatorStore.getState();
  const stepLabel = MINH_NGUYET_STEP_LABELS[step]?.label ?? step;
  store.setMnStepStatus(step, 'skipped');
  store.addLog({ step, level: 'warning', message: `⏭ Đã bỏ qua: ${stepLabel}` });
}
