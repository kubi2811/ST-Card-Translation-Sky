/**
 * autoCreatorPipeline.ts — Pipeline Engine v3
 * Context chaining, error recovery, preview mode, blueprint-driven
 */

import { v4 as uuidv4 } from 'uuid';
import type { AutoCreatorConfig, AutoCreatorStep, CardBlueprint, StepPreview } from '../../types';
import type { ProxyProfile, GenerationParams, CardExtensions } from '../../types';
import type { RegexPlacement } from '../../types';
import { useCardStore } from '../../store/cardStore';
import { buildSchemaContextForBatch } from '../mvuzod/schemaContextBuilder';
import { normalizeMVUZODSchema } from '../mvuzod/normalizeSchema';
import { useAutoCreatorStore } from '../../store/autoCreatorStore';
import { callAI } from './client';
import { runBatchGeneration } from './batchGenerator';
import { getProfileExtractionContext } from './worldbuildingDefaults';
import { materializeEntry, nextEntryId } from '../converters/cardDefaults';
import { analyzeIdea } from './autoCreatorAnalyzer';
import {
  buildBasicInfoPrompt,
  buildLorebookBatchPrompt,
  buildRegexPrompt,
  buildMvuzodPrompt,
  buildSystemPromptPrompt,
  buildFirstMessagePrompt,
  buildMesExamplePrompt,
} from './autoCreatorPrompts';

export interface AutoCreatorContext {
  profile: ProxyProfile;
  generationParams: GenerationParams;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ═══ JSON extraction helper ═══
function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* ignore */ }
  
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* ignore */ } }
  
  const objMatch = trimmed.match(/\{[\s\S]+\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch { /* ignore */ } }
  
  const arrMatch = trimmed.match(/\[[\s\S]+\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch { /* ignore */ } }
  
  return null;
}

// ═══ MAIN PIPELINE ═══
export async function runAutoCreatorPipeline(ctx: AutoCreatorContext) {
  const store = useAutoCreatorStore.getState();
  
  if (store.isRunning || store.config.selectedSteps.length === 0 || !store.config.idea) {
    return;
  }

  store.setIsRunning(true);
  store.addLog({ step: 'system', level: 'info', message: '🚀 Pipeline v3 bắt đầu...' });

  const { config } = store;

  // ─── Phase 0: Blueprint Analysis ───
  store.addLog({ step: 'blueprint', level: 'info', message: '🧠 Phase 0: Đang phân tích ý tưởng...' });
  store.setBlueprintLoading(true);
  
  let blueprint: CardBlueprint | null = null;
  try {
    blueprint = await analyzeIdea(config.idea, ctx.profile, ctx.generationParams);
    store.setBlueprint(blueprint);
    store.addLog({
      step: 'blueprint',
      level: 'success',
      message: `✅ Blueprint: "${blueprint.characterProfile.name}" | ${blueprint.estimatedComplexity} | ${blueprint.suggestedEntryTopics.length} topics, ${blueprint.suggestedVariables.length} vars`,
    });
  } catch (error) {
    store.addLog({
      step: 'blueprint',
      level: 'warning',
      message: `⚠️ Blueprint thất bại, tiếp tục không có blueprint: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  store.setBlueprintLoading(false);

  // ─── Run selected steps ───
  const stepsToRun = config.selectedSteps;

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

    store.setStepStatus(step, 'running');
    store.setCurrentStep(step);
    store.addLog({ step, level: 'info', message: `Bắt đầu xử lý: ${step}` });

    const maxRetries = 1;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          store.addLog({ step, level: 'info', message: `🔄 Retry lần ${attempt}...` });
        }
        
        await executeStep(step, config, ctx, blueprint);
        
        store.setStepStatus(step, 'done');
        store.addLog({ step, level: 'success', message: `✅ Hoàn thành: ${step}` });
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        store.addLog({ step, level: 'error', message: `❌ Lỗi tại ${step}: ${msg}` });
        
        if (attempt >= maxRetries) {
          // Auto-skip on final failure when autoApplyAll = true
          if (config.autoApplyAll) {
            store.setStepStatus(step, 'skipped');
            store.addLog({ step, level: 'warning', message: `⏭ Bỏ qua ${step} sau ${maxRetries + 1} lần thử, tiếp tục pipeline...` });
            // handled, so pipeline continues
          } else {
            store.setStepStatus(step, 'error');
            store.setIsRunning(false);
            store.addLog({ step: 'system', level: 'error', message: `Pipeline dừng tại ${step}. Bạn có thể retry bước này hoặc skip.` });
            return;
          }
        }
      }
    }
  }

  store.setIsRunning(false);
  store.setCurrentStep(null);
  store.addLog({ step: 'system', level: 'success', message: '🎉 Pipeline v3 hoàn tất thành công!' });
}

// ═══ Retry a single step ═══
export async function retrySingleStep(step: AutoCreatorStep, ctx: AutoCreatorContext) {
  const store = useAutoCreatorStore.getState();
  const config = store.config;
  const blueprint = store.blueprint;

  store.setStepStatus(step, 'running');
  store.setCurrentStep(step);
  store.addLog({ step, level: 'info', message: `🔄 Retry ${step}...` });
  store.setStepPreview(step, null);

  try {
    await executeStep(step, config, ctx, blueprint);
    store.setStepStatus(step, 'done');
    store.addLog({ step, level: 'success', message: `✅ Retry thành công: ${step}` });
  } catch (error) {
    store.setStepStatus(step, 'error');
    store.addLog({ step, level: 'error', message: `❌ Retry thất bại: ${error instanceof Error ? error.message : String(error)}` });
  }
  store.setCurrentStep(null);
}

// ═══ Skip a step ═══
export function skipStep(step: AutoCreatorStep) {
  const store = useAutoCreatorStore.getState();
  store.setStepStatus(step, 'skipped');
  store.addLog({ step, level: 'warning', message: `⏭ Đã bỏ qua: ${step}` });
  
  // If pipeline was stopped due to error, resume
  if (!store.isRunning && store.currentStep === step) {
    // Find next step index
    const idx = store.config.selectedSteps.indexOf(step);
    if (idx >= 0 && idx < store.config.selectedSteps.length - 1) {
      store.setCurrentStep(null);
    }
  }
}

// ═══ Apply a preview into the card ═══
export function applyStepPreview(step: AutoCreatorStep) {
  const store = useAutoCreatorStore.getState();
  const preview = store.stepPreviews[step];
  if (!preview) return;

  const data = preview.editedData ?? preview.parsedData;
  if (!data) return;

  const cardStore = useCardStore.getState();
  const config = store.config;

  applyParsedDataToCard(step, data, config, cardStore);
  store.setStepStatus(step, 'done');
  store.setStepPreview(step, null);
  store.addLog({ step, level: 'success', message: `✅ Preview applied: ${step}` });
}

// ═══ EXECUTE STEP ═══
async function executeStep(
  step: AutoCreatorStep,
  config: AutoCreatorConfig,
  ctx: AutoCreatorContext,
  blueprint: CardBlueprint | null,
) {
  const cardStore = useCardStore.getState();
  const store = useAutoCreatorStore.getState();
  
  // v3: Re-read card data (includes results from previous steps)
  const freshCardStr = JSON.stringify(cardStore.card.data, null, 2);

  const callAIAndExtract = async (prompt: string): Promise<unknown> => {
    let finalPrompt = prompt;
    
    // Inject global Master Instruction & Pipeline Steps
    finalPrompt += getProfileExtractionContext(ctx.profile);

    if (ctx.generationParams.max_tokens && ctx.generationParams.max_tokens >= 4000) {
      finalPrompt += `\n\n[YÊU CẦU ĐỘ DÀI VÀ CHI TIẾT - QUAN TRỌNG]
Người dùng đã cấp dung lượng output rất lớn (${ctx.generationParams.max_tokens} tokens). 
BẠN PHẢI TẬN DỤNG TỐI ĐA dung lượng này để tạo ra nội dung CỰC KỲ CHI TIẾT, TOÀN DIỆN VÀ CHUYÊN SÂU.
- Tuyệt đối không viết tóm tắt, cộc lốc hay dùng các câu ngắn gọn (trừ khi cố ý vì lý do nghệ thuật).
- Mở rộng mọi khía cạnh có thể, cung cấp ví dụ chi tiết, đào sâu vào cơ chế, tâm lý, lịch sử hoặc bối cảnh.
- Không bỏ lỡ bất cứ tiểu tiết nào quan trọng, không dùng các cụm từ "vân vân", "tương tự".`;
    }

    const response = await callAI({
      profile: ctx.profile,
      params: ctx.generationParams,
      messages: [{ role: 'user', content: finalPrompt }]
    });
    
    const parsed = extractJsonFromText(response.text);
    if (!parsed) throw new Error('Không thể parse kết quả trả về từ AI (không phải JSON hợp lệ)');
    
    // v3: Store preview
    const preview: StepPreview = {
      rawOutput: response.text,
      parsedData: parsed,
      tokenEstimate: Math.ceil(response.text.length / 4),
    };
    store.setStepPreview(step, preview);
    
    // If not auto-apply, pause here (the UI will show preview)
    if (!config.autoApplyAll && step !== 'lorebook') {
      store.setStepStatus(step, 'done');
      store.addLog({ step, level: 'info', message: `📋 Preview sẵn sàng. Nhấn Apply để áp dụng.` });
      // Don't apply automatically — user must click Apply
      store.setStepResult(step, `Preview ready (~${preview.tokenEstimate} tokens)`);
      return parsed;
    }
    
    return parsed;
  };

  switch (step) {
    case 'basic_info': {
      const prompt = buildBasicInfoPrompt(config.idea, config.stepConfigs.basic_info, blueprint);
      const result = await callAIAndExtract(prompt) as { name?: string; description?: string; personality?: string; scenario?: string };
      
      if (config.autoApplyAll) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, `Name: ${result.name || '?'}`);
      break;
    }

    case 'lorebook': {
      const lbConfig = config.stepConfigs.lorebook;
      const topicPrompt = buildLorebookBatchPrompt(config.idea, freshCardStr, blueprint);
      
      let createdCount = 0;
      await runBatchGeneration({
        topicPrompt,
        useCardContext: true,
        totalEntries: lbConfig.totalEntries,
        minEntries: lbConfig.minEntries,
        entriesPerBatch: lbConfig.entriesPerBatch,
        concurrentBatches: lbConfig.concurrentBatches,
        defaultPosition: 0,
        insertionOrderMode: 'increment',
        insertionOrderStart: 100,
        maxRetriesPerBatch: 2,
        maxConsecutiveErrors: 3,
        category: lbConfig.category,
        cardType: lbConfig.cardType,
        useWebSearch: lbConfig.useWebSearch,
        // Bám SCHEMA biến (MVU-ZOD) nếu card đã có (vd NPC có võ lực/trí lực) → entry sinh ra tham
        // chiếu đúng các chỉ số/cấu trúc đã định thay vì viết linh tinh không liên quan.
        schemaContext: (() => {
          const sch = (cardStore.card?.data?.extensions as unknown as Record<string, any>)?.mvuzod?.schema;
          return sch ? buildSchemaContextForBatch(sch) : undefined;
        })(),
      }, {
        card: cardStore.card,
        profile: ctx.profile,
        generationParams: ctx.generationParams,
        paused: false,
        stopped: false,
        log: (msg) => store.addLog({ step, level: 'info', message: msg }),
        onProgress: (p) => {
          store.addLog({ step, level: 'info', message: `Batch ${p.batch}/${p.totalBatches}: ${p.created}/${p.total} entries` });
        },
        appendEntry: (entry) => {
          cardStore.addEntry(entry);
          createdCount++;
        },
      });
      store.setStepResult(step, `Đã tạo ${createdCount} entries.`);
      break;
    }

    case 'regex': {
      const prompt = buildRegexPrompt(config.idea, freshCardStr, config.stepConfigs.regex, blueprint);
      const result = await callAIAndExtract(prompt);
      
      if (config.autoApplyAll && Array.isArray(result)) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, `${Array.isArray(result) ? result.length : 0} scripts`);
      break;
    }

    case 'mvuzod': {
      const prompt = buildMvuzodPrompt(config.idea, freshCardStr, config.stepConfigs.mvuzod, blueprint);
      const result = await callAIAndExtract(prompt);
      
      if (config.autoApplyAll) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, 'Schema + entries created');
      break;
    }

    case 'system_prompt': {
      const prompt = buildSystemPromptPrompt(config.idea, freshCardStr, config.stepConfigs.system_prompt, blueprint);
      const result = await callAIAndExtract(prompt) as { system_prompt?: string; depth_prompt?: string };
      
      if (config.autoApplyAll) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, `${result.system_prompt ? '✅ System' : '—'} ${result.depth_prompt ? '✅ Depth' : '—'}`);
      break;
    }

    case 'first_message': {
      const prompt = buildFirstMessagePrompt(config.idea, freshCardStr, config.stepConfigs.first_message, blueprint);
      const result = await callAIAndExtract(prompt) as { first_mes?: string; alternate_greetings?: string[] };
      
      if (config.autoApplyAll) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, `1 first_mes + ${result.alternate_greetings?.length || 0} alternates`);
      break;
    }

    case 'mes_example': {
      const prompt = buildMesExamplePrompt(config.idea, freshCardStr, config.stepConfigs.mes_example, blueprint);
      const result = await callAIAndExtract(prompt) as { mes_example?: string };
      
      if (config.autoApplyAll) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, result.mes_example ? 'Done' : '—');
      break;
    }
  }
}

// ═══ APPLY DATA TO CARD (shared by auto-apply and manual apply) ═══
function applyParsedDataToCard(
  step: AutoCreatorStep,
  data: unknown,
  config: AutoCreatorConfig,
  cardStore: ReturnType<typeof useCardStore.getState>,
) {
  switch (step) {
    case 'basic_info': {
      const result = data as { name?: string; description?: string; personality?: string; scenario?: string };
      cardStore.updateCard((c) => {
        if (result.name) c.data.name = result.name;
        if (result.description) c.data.description = result.description;
        if (result.personality && config.stepConfigs.basic_info.includePersonality) c.data.personality = result.personality;
        if (result.scenario && config.stepConfigs.basic_info.includeScenario) c.data.scenario = result.scenario;
      });
      break;
    }

    case 'regex': {
      const items = data as Record<string, unknown>[];
      if (!Array.isArray(items)) break;
      cardStore.updateCard((c) => {
        if (!c.data.extensions) c.data.extensions = {} as unknown as CardExtensions;
        if (!c.data.extensions.regex_scripts) c.data.extensions.regex_scripts = [];
        
        for (const s of items) {
          c.data.extensions.regex_scripts.push({
            id: uuidv4(),
            scriptName: (s.scriptName as string) || 'Auto Regex',
            findRegex: (s.regex as string) || '',
            replaceString: (s.replaceString as string) || '',
            placement: (s.placement as RegexPlacement[]) || [1],
            minDepth: (s.minDepth as number) || null,
            maxDepth: (s.maxDepth as number) || null,
            disabled: false,
            markdownOnly: !!s.markdownOnly,
            promptOnly: !!s.promptOnly,
            runOnEdit: false,
            substituteRegex: 1,
            trimStrings: [],
          });
        }
      });
      break;
    }

    case 'mvuzod': {
      const result = data as Record<string, unknown>;
      cardStore.updateCard((c) => {
        if (!c.data.extensions) c.data.extensions = {} as unknown as CardExtensions;
        if (!c.data.extensions.mvuzod) {
          c.data.extensions.mvuzod = {
            schema: { version: '1.0', fields: [] },
            extractorRegex: '',
            validationMode: 'strict',
            stateHistoryMaxLength: 20,
            displayTemplate: '',
            injectionTemplate: '',
          };
        }
        if (result.schema) {
          // (Bug enumValues 19/07) Schema AI trả về hay THIẾU key `constraints` (nhất là field
          // string/children) — cast thô là consumer phía sau crash "reading 'enumValues'".
          // Normalize tại biên: constraints luôn là object, children đệ quy sạch.
          c.data.extensions.mvuzod.schema = normalizeMVUZODSchema(result.schema);
        }
        
        if (!c.data.character_book) c.data.character_book = { name: c.data.name, entries: [] };
        const entries = c.data.character_book.entries;

        if (config.stepConfigs.mvuzod.createInitVar && result.initVarEntry) {
          entries.push(materializeEntry({
            comment: '[initvar]初始化',
            keys: [''],
            content: result.initVarEntry as string,
            constant: false,
          }, {}, nextEntryId(entries)));
        }

        if (config.stepConfigs.mvuzod.createUpdateRules && result.updateRulesEntry) {
          entries.push(materializeEntry({
            comment: '[mvu_update]Quy tắc cập nhật biến',
            keys: [''],
            content: result.updateRulesEntry as string,
            constant: true,
          }, { defaultDepth: 0 }, nextEntryId(entries)));
        }

        if (config.stepConfigs.mvuzod.createVarList && result.varListEntry) {
          entries.push(materializeEntry({
            comment: 'Danh sách biến',
            keys: [''],
            content: result.varListEntry as string,
            constant: true,
          }, { defaultDepth: 1 }, nextEntryId(entries)));
        }
      });
      break;
    }

    case 'system_prompt': {
      const result = data as { system_prompt?: string; depth_prompt?: string };
      cardStore.updateCard((c) => {
        if (result.system_prompt) c.data.system_prompt = result.system_prompt;
        if (config.stepConfigs.system_prompt.includeDepthPrompt && result.depth_prompt) {
          if (!c.data.extensions) c.data.extensions = {} as unknown as CardExtensions;
          c.data.extensions.depth_prompt = {
            prompt: result.depth_prompt,
            depth: config.stepConfigs.system_prompt.depthValue,
            role: 'system',
          };
        }
      });
      break;
    }

    case 'first_message': {
      const result = data as { first_mes?: string; alternate_greetings?: string[] };
      cardStore.updateCard((c) => {
        if (result.first_mes) c.data.first_mes = result.first_mes;
        if (result.alternate_greetings && Array.isArray(result.alternate_greetings)) {
          c.data.alternate_greetings = result.alternate_greetings;
        }
      });
      break;
    }

    case 'mes_example': {
      const result = data as { mes_example?: string };
      if (result.mes_example) {
        cardStore.updateCard((c) => {
          c.data.mes_example = result.mes_example!;
        });
      }
      break;
    }
  }
}
