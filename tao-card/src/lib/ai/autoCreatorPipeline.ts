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
import { buildMVUZODScripts } from '../mvuzod/tavernScriptBuilder';
import { OPENING_FORM_ANCHOR } from '../mvuzod/regexAnchors';
import { schemaToZodCode } from '../mvuzod/schemaInferencer';
import { buildProgrammaticRegex } from '../mvuzod/programmaticRegexBuilder';
import { collectSchemaVarNames, parseFindRegex } from '../mvuzod/gameUiValidator';
import { runQualityCheck } from '../validation/qualityChecker';
import { checkWorldbookHealth } from '../worldbook/worldbookHealthCheck';
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

    // (User 19/07) YÊU CẦU/QUY TẮC TOÀN CỤC của user — áp cho MỌI bước, đặt sát cuối để ưu tiên cao.
    if (config.userRules?.trim()) {
      finalPrompt += `\n\n[YÊU CẦU & QUY TẮC BẮT BUỘC TỪ NGƯỜI DÙNG — ÁP DỤNG CHO TOÀN BỘ CARD, TUÂN THỦ TUYỆT ĐỐI]\n${config.userRules.trim()}`;
    }

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
      const topicPrompt = buildLorebookBatchPrompt(config.idea, freshCardStr, blueprint, lbConfig.promptOverride, lbConfig.promptMode);
      
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
      // (User 19/07 — "tích hợp Regex và MVU xử lý chung") mvuzod nay chạy TRƯỚC regex (thứ tự
      // ALL_STEPS) và schema được bơm TƯỜNG MINH vào prompt regex → dashboard/data-var bám đúng
      // tên biến, không còn 2 bước lệch nhau.
      const schemaForRegex = (() => {
        const sch = (cardStore.card?.data?.extensions as unknown as Record<string, any>)?.mvuzod?.schema;
        return sch ? buildSchemaContextForBatch(sch) : undefined;
      })();
      const prompt = buildRegexPrompt(config.idea, freshCardStr, config.stepConfigs.regex, blueprint, schemaForRegex);
      const result = await callAIAndExtract(prompt);

      if (config.autoApplyAll && Array.isArray(result)) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, `${Array.isArray(result) ? result.length : 0} scripts${schemaForRegex ? ' (bám schema MVU)' : ''}`);
      break;
    }

    case 'mvuzod': {
      const prompt = buildMvuzodPrompt(config.idea, freshCardStr, config.stepConfigs.mvuzod, blueprint);
      const result = await callAIAndExtract(prompt);

      // (User 19/07 — "MVU tạo xong chơi card bị lỗi") KIỂM NGAY sau khi AI trả về, TRƯỚC khi
      // apply: schema phải dựng được Zod code, các entry đã yêu cầu phải có mặt. Fail → ném lỗi
      // kèm lý do → vòng retry của pipeline chạy lại bước này (log ghi rõ vì sao).
      const mvuIssues = verifyMvuzodResult(result, config.stepConfigs.mvuzod);
      if (mvuIssues.length > 0) {
        throw new Error(`MVU chưa đạt (${mvuIssues.length} vấn đề): ${mvuIssues.join(' · ')}`);
      }
      store.addLog({ step, level: 'success', message: '🧪 Kiểm MVU: schema dựng Zod code OK, đủ entry yêu cầu.' });

      if (config.autoApplyAll) {
        applyParsedDataToCard(step, result, config, cardStore);
      }
      store.setStepResult(step, 'Schema + entries created (đã kiểm)');
      break;
    }

    case 'game_ui': {
      // (User 19/07) Sinh Game UI PROGRAMMATIC từ schema — $0, không tốn AI, kết quả ổn định:
      // status bar + form thiết lập ban đầu (full_set). Cần schema MVU đã có (bước mvuzod trước đó).
      const sch = (cardStore.card?.data?.extensions as unknown as Record<string, any>)?.mvuzod?.schema;
      if (!sch || !Array.isArray(sch.fields) || sch.fields.length === 0) {
        throw new Error('Chưa có schema MVU — bật bước "MVUZOD Schema" chạy trước để sinh Game UI.');
      }
      const uiCfg = config.stepConfigs.game_ui;
      const built = buildProgrammaticRegex({
        schema: normalizeMVUZODSchema(sch),
        component: uiCfg.component,
        themeId: uiCfg.themeId,
        gameName: cardStore.card?.data?.name || 'Game',
      });
      const preview: StepPreview = {
        rawOutput: `Programmatic Game UI (${uiCfg.component}) — ${built.scripts.length} regex script, ${built.fieldsRendered} field, ${Math.round(built.totalSize / 1024)}KB`,
        parsedData: built.scripts,
        tokenEstimate: 0,
      };
      store.setStepPreview(step, preview);
      if (config.autoApplyAll) {
        applyParsedDataToCard(step, built.scripts, config, cardStore);
      } else {
        store.addLog({ step, level: 'info', message: '📋 Preview Game UI sẵn sàng. Nhấn Apply để áp dụng.' });
      }
      store.setStepResult(step, `${built.scripts.length} UI script (${uiCfg.component}, ${built.fieldsRendered} field)`);
      break;
    }

    case 'final_check': {
      // (User 19/07) KIỂM TRA TỔNG THỂ cuối pipeline: deterministic trước (schema/initvar/
      // update-rules/regex compile/data-var khớp schema/lorebook health), rồi tuỳ chọn 1 lượt AI
      // đọc báo cáo + nhận xét. KHÔNG chặn pipeline — báo cáo nằm ở preview + log.
      const report = await buildFinalCheckReport(cardStore);
      for (const line of report.lines) {
        store.addLog({ step, level: line.startsWith('❌') ? 'error' : line.startsWith('⚠️') ? 'warning' : 'info', message: line });
      }
      let aiVerdict = '';
      if (config.stepConfigs.final_check.useAiReview) {
        try {
          const resp = await callAI({
            profile: ctx.profile,
            params: ctx.generationParams,
            messages: [{ role: 'user', content: buildFinalCheckReviewPrompt(report.lines.join('\n'), freshCardStr, config.userRules) }],
          });
          aiVerdict = resp.text.trim();
          store.addLog({ step, level: 'info', message: `🧠 AI nhận xét tổng thể:\n${aiVerdict.slice(0, 1500)}` });
        } catch (e) {
          store.addLog({ step, level: 'warning', message: `AI review lỗi (bỏ qua): ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      store.setStepPreview(step, {
        rawOutput: report.lines.join('\n') + (aiVerdict ? `\n\n═══ AI NHẬN XÉT ═══\n${aiVerdict}` : ''),
        parsedData: { problems: report.problems, lines: report.lines, aiVerdict },
        tokenEstimate: 0,
      });
      store.setStepResult(step, report.problems === 0 ? '✅ Card ổn — không thấy vấn đề' : `⚠️ ${report.problems} vấn đề cần xem (chi tiết trong log/preview)`);
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

// ═══ (User 19/07) KIỂM MVU ngay sau khi AI trả về — fail thì retry bước với lý do rõ ràng ═══
function verifyMvuzodResult(result: unknown, cfg: AutoCreatorConfig['stepConfigs']['mvuzod']): string[] {
  const issues: string[] = [];
  const r = result as Record<string, unknown> | null;
  const schema = r?.schema as { fields?: unknown[] } | undefined;
  if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) {
    issues.push('schema rỗng hoặc thiếu mảng fields');
  } else {
    try {
      const norm = normalizeMVUZODSchema(schema);
      schemaToZodCode(norm, 'check'); // phải dựng được Zod code — đây là thứ SillyTavern chạy thật
      const badPaths = norm.fields.filter(f => !f.path.startsWith('/')).map(f => f.path);
      if (badPaths.length > 0) issues.push(`path không bắt đầu bằng "/": ${badPaths.slice(0, 3).join(', ')}`);
    } catch (e) {
      issues.push(`schema không dựng được Zod code: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (cfg.createInitVar && !hasText(r?.initVarEntry)) issues.push('thiếu initVarEntry ([initvar]) dù đã yêu cầu — thiếu nó là MVU không khởi tạo biến, chơi card sẽ lỗi cập nhật');
  if (cfg.createUpdateRules && !hasText(r?.updateRulesEntry)) issues.push('thiếu updateRulesEntry ([mvu_update]) dù đã yêu cầu — thiếu nó AI trong game không biết cách cập nhật biến');
  if (cfg.createVarList && !hasText(r?.varListEntry)) issues.push('thiếu varListEntry dù đã yêu cầu');
  return issues;
}

// ═══ (User 19/07) BÁO CÁO KIỂM TRA TỔNG THỂ toàn card (deterministic, không tốn AI) ═══
async function buildFinalCheckReport(
  cardStore: ReturnType<typeof useCardStore.getState>,
): Promise<{ lines: string[]; problems: number }> {
  const lines: string[] = [];
  let problems = 0;
  const data = cardStore.card.data;
  const ext = data.extensions as unknown as Record<string, any>;
  const entries = data.character_book?.entries ?? [];
  const regexScripts: Array<{ findRegex?: string; replaceString?: string; scriptName?: string }> = ext?.regex_scripts ?? [];

  // 1. Trường cơ bản
  if (!data.name?.trim()) { lines.push('❌ Thiếu tên nhân vật'); problems++; }
  if (!data.description?.trim()) { lines.push('❌ Thiếu description'); problems++; }
  if (!data.first_mes?.trim()) { lines.push('⚠️ Thiếu first message — vào game sẽ không có lời mở đầu'); problems++; }

  // 2. MVU: schema + initvar + update rules + data-var khớp schema
  const schema = ext?.mvuzod?.schema;
  if (schema && Array.isArray(schema.fields) && schema.fields.length > 0) {
    try {
      schemaToZodCode(normalizeMVUZODSchema(schema), data.name || 'Card');
      lines.push(`✅ Schema MVU: ${schema.fields.length} field, dựng Zod code OK`);
    } catch (e) {
      lines.push(`❌ Schema MVU KHÔNG dựng được Zod code: ${e instanceof Error ? e.message : String(e)}`);
      problems++;
    }
    const hasInit = entries.some(en => String(en.content || '').includes('[initvar]') || String(en.comment || '').toLowerCase().includes('initvar'));
    if (hasInit) lines.push('✅ Có entry [initvar] (khởi tạo biến)');
    else { lines.push('⚠️ Có schema nhưng KHÔNG thấy entry [initvar] — biến sẽ không khởi tạo, MVU dễ báo "变量更新失败"'); problems++; }
    const hasUpdate = entries.some(en => /mvu_update/i.test(String(en.comment || '')) || /mvu_update/i.test(String(en.content || '')));
    if (hasUpdate) lines.push('✅ Có entry quy tắc cập nhật biến ([mvu_update])');
    else { lines.push('⚠️ KHÔNG thấy entry quy tắc cập nhật biến — AI trong game không biết cách cập nhật, dễ lỗi "变量更新失败"'); problems++; }

    const varNames = new Set(collectSchemaVarNames(schema));
    const badVars = new Set<string>();
    for (const rs of regexScripts) {
      for (const m of String(rs.replaceString || '').matchAll(/data-var\s*=\s*["']([^"']+)["']/g)) {
        if (!varNames.has(m[1])) badVars.add(m[1]);
      }
    }
    if (badVars.size > 0) {
      lines.push(`❌ ${badVars.size} data-var trong regex KHÔNG khớp tên biến schema: ${[...badVars].slice(0, 5).join(', ')} — UI sẽ hiện trống`);
      problems++;
    } else if (regexScripts.length > 0) {
      lines.push('✅ Mọi data-var trong regex khớp tên biến schema');
    }
  } else {
    lines.push('ℹ️ Card không có schema MVU — bỏ qua kiểm MVU');
  }

  // 3. Regex compile
  let badRegex = 0;
  for (const rs of regexScripts) {
    if (rs.findRegex && !parseFindRegex(String(rs.findRegex))) badRegex++;
  }
  if (badRegex > 0) { lines.push(`❌ ${badRegex}/${regexScripts.length} regex có findRegex KHÔNG compile được`); problems++; }
  else if (regexScripts.length > 0) lines.push(`✅ ${regexScripts.length} regex compile OK`);

  // 4. Lorebook: chất lượng + cấu hình
  if (entries.length > 0) {
    try {
      const q = runQualityCheck(entries);
      const qIssues = (q as unknown as { issues?: unknown[] }).issues?.length ?? 0;
      lines.push(qIssues > 0 ? `⚠️ Lorebook: ${entries.length} entry, ${qIssues} vấn đề chất lượng (xem tab Lorebook → Kiểm chất lượng)` : `✅ Lorebook: ${entries.length} entry, chất lượng OK`);
      if (qIssues > 0) problems++;
    } catch { /* checker lỗi thì bỏ qua, không chặn */ }
    try {
      const h = await checkWorldbookHealth(entries, 'single');
      const errs = (h as unknown as { errors?: unknown[] }).errors?.length ?? 0;
      const warns = (h as unknown as { warnings?: unknown[] }).warnings?.length ?? 0;
      if (errs + warns > 0) { lines.push(`⚠️ Cấu hình worldbook: ${errs} lỗi, ${warns} cảnh báo (tab Lorebook → Sức khoẻ có nút sửa tự động)`); problems += errs > 0 ? 1 : 0; }
      else lines.push('✅ Cấu hình worldbook OK');
    } catch { /* bỏ qua */ }
  } else {
    lines.push('⚠️ Card chưa có entry lorebook nào'); problems++;
  }

  return { lines, problems };
}

/** (User 19/07) Prompt cho lượt AI đọc báo cáo kiểm tra + nhận xét tổng thể. */
function buildFinalCheckReviewPrompt(reportText: string, cardContext: string, userRules: string): string {
  return `Bạn là chuyên gia thẩm định character card SillyTavern (MVU/Zod, regex dashboard, lorebook).
Dưới đây là BÁO CÁO KIỂM TRA TỰ ĐỘNG của card vừa tạo xong, kèm nội dung card.

═══ BÁO CÁO KIỂM TRA ═══
${reportText}

═══ NỘI DUNG CARD (JSON, có thể bị cắt) ═══
${cardContext.slice(0, 60_000)}
${userRules?.trim() ? `\n═══ QUY TẮC NGƯỜI DÙNG ĐẶT RA ═══\n${userRules.trim()}` : ''}

NHIỆM VỤ: nhận xét NGẮN GỌN bằng tiếng Việt (tối đa ~300 từ):
1. Card đã CHƠI ĐƯỢC chưa? Các mảnh (schema ↔ initvar ↔ update rules ↔ regex UI ↔ lorebook) có ăn khớp không?
2. Với từng dòng ❌/⚠️ trong báo cáo: nên sửa thế nào (chỉ đúng bước Auto Creator cần chạy lại hoặc panel cần mở).
3. Có vi phạm quy tắc người dùng đặt ra không?
KHÔNG trả JSON, KHÔNG viết lại card — chỉ nhận xét và hướng dẫn sửa.`;
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

    case 'game_ui': {
      // (User 19/07) Script Game UI đã ĐẦY ĐỦ field (từ buildProgrammaticRegex) — chỉ cần gắn id.
      const scripts = data as Array<Record<string, unknown>>;
      if (!Array.isArray(scripts)) break;
      cardStore.updateCard((c) => {
        if (!c.data.extensions) c.data.extensions = {} as unknown as CardExtensions;
        if (!c.data.extensions.regex_scripts) c.data.extensions.regex_scripts = [];
        for (const s of scripts) {
          c.data.extensions.regex_scripts.push({ ...(s as object), id: uuidv4() } as (typeof c.data.extensions.regex_scripts)[number]);
        }
      });
      break;
    }

    case 'final_check': {
      // Báo cáo chỉ để đọc — không ghi gì vào card.
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
          const normalized = normalizeMVUZODSchema(result.schema);
          c.data.extensions.mvuzod.schema = normalized;

          // (User 21/07 — bug "Auto Creator xong mà TavernHelper KHÔNG có MVU")
          // Schema chỉ được ghi vào extensions.mvuzod, còn 2 script TavernHelper (import engine
          // MVU + đăng ký Zod schema) trước giờ CHỈ được tạo khi user tự bấm nút trong
          // SchemaBuilder. Chạy Auto Creator thì không ai gọi ⇒ card ra lò thiếu MVU, biến
          // không bao giờ chạy. Nay pipeline tự gắn luôn.
          const scripts = buildMVUZODScripts(normalized, c.data.name);
          const ext = c.data.extensions as unknown as Record<string, unknown>;
          const th = (ext.tavern_helper ?? {}) as Record<string, unknown>;
          const existing = (th.scripts ?? []) as Array<{ name: string }>;
          for (const script of scripts) {
            const idx = existing.findIndex(s => s.name === script.name);
            if (idx >= 0) existing[idx] = script as unknown as { name: string };
            else existing.push(script as unknown as { name: string });
          }
          th.scripts = existing;
          ext.tavern_helper = th;
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

        // (User 21/07) Form mở đầu chỉ hiện được khi trong lời mở đầu CÓ mỏ neo để regex thay.
        // AI thường quên chèn ⇒ regex Opening Form nằm im, user tưởng tool tạo hỏng.
        // Nếu card có script Opening Form mà lời mở đầu thiếu mỏ neo thì tự chèn vào ĐẦU —
        // làm ở tầng code nên không phụ thuộc việc AI có nghe lời hay không.
        const hasOpeningForm = (c.data.extensions?.regex_scripts ?? [])
          .some(s => s.findRegex === OPENING_FORM_ANCHOR);
        if (hasOpeningForm) {
          if (c.data.first_mes && !c.data.first_mes.includes(OPENING_FORM_ANCHOR)) {
            c.data.first_mes = `${OPENING_FORM_ANCHOR}\n${c.data.first_mes}`;
          }
          // Alternate greetings cũng là lời mở đầu → cũng cần form.
          if (Array.isArray(c.data.alternate_greetings)) {
            c.data.alternate_greetings = c.data.alternate_greetings.map(g =>
              typeof g === 'string' && g && !g.includes(OPENING_FORM_ANCHOR)
                ? `${OPENING_FORM_ANCHOR}\n${g}`
                : g,
            );
          }
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
