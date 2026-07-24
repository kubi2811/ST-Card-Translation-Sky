/**
 * autoCreatorPipeline.ts — Pipeline Engine v3
 * Context chaining, error recovery, preview mode, blueprint-driven
 */

import { v4 as uuidv4 } from 'uuid';
import type { AutoCreatorConfig, AutoCreatorStep, CardBlueprint, StepPreview } from '../../types';
import type { ProxyProfile, GenerationParams, CardExtensions } from '../../types';
import type { RegexPlacement, MVUZODSchema } from '../../types';
import { useCardStore } from '../../store/cardStore';
import { buildSchemaContextForBatch } from '../mvuzod/schemaContextBuilder';
import { normalizeMVUZODSchema } from '../mvuzod/normalizeSchema';
import { buildOutputFormatContent, buildEmphasisContent } from '../mvuzod/systemEntriesBuilder';
import { nestFlatInitvarKeys } from '../mvuzod/nestFlatInitvar';
import { buildMVUZODScripts } from '../mvuzod/tavernScriptBuilder';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../mvuzod/regexAnchors';
import { isMvuUpdateBlockAccepted } from '../mvuzod/mvuReference';
import { validateMvuCard } from '../mvuzod/validateMvuCard';
import { autoRepairCard } from './cardAutoRepair';
import { checkMvuOutputContract } from '../mvuzod/mvuReference';
import { buildMvuCoreRegexScripts } from '../mvuzod/mvuCoreRegex';
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

    // (User 21/07) 2 lần là quá ít cho lỗi tạm thời (mạng/model hiccup) — bước bị bỏ là card
    // thiếu mảng, user phải sửa tay. Nâng lên 3 lần, và lần sau CÓ NÓI cho AI biết lần trước
    // hỏng vì gì (xem lastError bên dưới) thay vì gửi lại y hệt prompt cũ.
    const maxRetries = 2;
    let lastError = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          store.addLog({ step, level: 'info', message: `🔄 Retry lần ${attempt}...` });
        }

        await executeStep(step, config, ctx, blueprint, lastError);
        
        store.setStepStatus(step, 'done');
        store.addLog({ step, level: 'success', message: `✅ Hoàn thành: ${step}` });
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        lastError = msg; // lần thử sau sẽ được nhắc rõ lần trước hỏng vì gì
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

/**
 * ═══ (User 22/07 — việc 82) TIẾN TRÌNH VÁ LẠI HẾT LỖI ═══
 *
 * "Kiểm tra tổng thể xong hiện ra 1 đống lỗi → thêm 1 nút / 1 tiến trình vá lại hết lỗi để
 * card hoàn thiện."
 *
 * Phần lớn lỗi mà báo cáo bắt được là lỗi CƠ HỌC, biết chính xác phải sửa thế nào — bắt user
 * đi sửa tay từng cái là vô lý. Chạy vòng lặp: đếm lỗi → vá → đếm lại, tối đa 3 lượt và dừng
 * ngay khi một lượt không giảm được lỗi nào (chống lặp vô tận nếu có lỗi không tự vá nổi).
 *
 * Chỉ vá TẤT ĐỊNH, không gọi mạng. Lỗi cần sáng tác nội dung được liệt kê riêng để user biết
 * phải chạy lại bước nào của Auto Creator.
 */
export async function runAutoRepair(): Promise<{ before: number; after: number; fixedCount: number }> {
  const store = useAutoCreatorStore.getState();
  const step: AutoCreatorStep = 'final_check';
  const log = (level: 'info' | 'success' | 'warning' | 'error', message: string) =>
    store.addLog({ step, level, message });

  const cardStore = useCardStore.getState();
  const before = (await buildFinalCheckReport(cardStore)).problems;
  if (before === 0) {
    log('success', '✅ Không có lỗi nào để vá — card đã sạch.');
    return { before: 0, after: 0, fixedCount: 0 };
  }

  log('info', `🔧 Bắt đầu vá lỗi tự động — báo cáo đang có ${before} vấn đề.`);

  let fixedCount = 0;
  let remaining = before;
  const pendingAi = new Set<string>();

  for (let round = 1; round <= 3; round++) {
    const fresh = useCardStore.getState();
    const schema = ((fresh.card?.data?.extensions as unknown as Record<string, any>)?.mvuzod?.schema ?? null) as MVUZODSchema | null;
    const result = autoRepairCard(fresh.card, schema);

    for (const n of result.needsAi) pendingAi.add(n);

    if (result.fixed.length === 0) {
      if (round === 1) log('warning', '⚠️ Không có lỗi nào tự vá được bằng máy.');
      break;
    }

    // Ghi card đã vá về store.
    fresh.updateCard((c) => {
      c.data = result.card.data;
    });

    for (const f of result.fixed) log('success', `   ✔ ${f.description}`);
    fixedCount += result.fixed.length;

    const after = (await buildFinalCheckReport(useCardStore.getState())).problems;
    log('info', `🔧 Lượt ${round}: vá ${result.fixed.length} chỗ — còn ${after}/${remaining} vấn đề.`);
    if (after >= remaining) { remaining = after; break; }  // không tiến triển ⇒ dừng
    remaining = after;
    if (remaining === 0) break;
  }

  if (pendingAi.size > 0) {
    log('warning', `⚠️ ${pendingAi.size} lỗi cần AI sáng tác nội dung, máy không tự vá được:`);
    for (const n of pendingAi) log('warning', `   • ${n}`);
    log('info', 'Chạy lại bước tương ứng của Auto Creator (Retry) để AI sinh phần còn thiếu.');
  }

  if (remaining === 0) log('success', `🎉 Đã vá xong toàn bộ ${fixedCount} chỗ — báo cáo sạch, card hoàn thiện.`);
  else log('warning', `⚠️ Đã vá ${fixedCount} chỗ, còn ${remaining} vấn đề cần xử lý tay hoặc chạy lại bước AI.`);

  return { before, after: remaining, fixedCount };
}

// ═══ EXECUTE STEP ═══
async function executeStep(
  step: AutoCreatorStep,
  config: AutoCreatorConfig,
  ctx: AutoCreatorContext,
  blueprint: CardBlueprint | null,
  /** Lỗi của lần thử TRƯỚC (nếu có) — nhắc lại cho AI để nó khỏi lặp đúng lỗi cũ. */
  lastError = '',
) {
  const cardStore = useCardStore.getState();
  const store = useAutoCreatorStore.getState();
  
  // v3: Re-read card data (includes results from previous steps)
  const freshCardStr = JSON.stringify(cardStore.card.data, null, 2);

  const callAIAndExtract = async (prompt: string): Promise<unknown> => {
    let finalPrompt = prompt;

    // Lần thử trước hỏng vì gì thì nói thẳng, đừng gửi lại y hệt prompt cũ rồi mong khác đi.
    if (lastError) {
      finalPrompt += `\n\n[LẦN TRƯỚC BẠN TRẢ VỀ BỊ LỖI — ĐỪNG LẶP LẠI]\nLỗi: ${lastError}\nLần này BẮT BUỘC xuất JSON hợp lệ, thuần tuý, KHÔNG bọc markdown, KHÔNG thêm lời dẫn trước/sau.`;
    }

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
    
    let parsed = extractJsonFromText(response.text);

    // (User 21/07 — "không skip tiến trình và tự vá") Trước đây parse hỏng là ném lỗi ngay,
    // vòng ngoài retry bằng ĐÚNG prompt cũ nên model lặp lại đúng lỗi cũ, rồi pipeline bỏ qua
    // luôn bước đó ⇒ card ra lò thiếu mảng, user phải sửa tay. Nay tự vá tại chỗ: đưa CHÍNH
    // output hỏng lại cho model và bảo nó sửa thành JSON hợp lệ. Đây là lỗi ĐỊNH DẠNG, model
    // gần như luôn sửa được khi biết mình sai ở đâu — khác hẳn retry mù.
    if (!parsed) {
      store.addLog({ step, level: 'warning', message: '🩹 Kết quả không phải JSON hợp lệ — đang nhờ AI tự vá lại...' });
      const repairPrompt = `Đoạn dưới đây ĐÁNG LẼ phải là JSON hợp lệ nhưng bị sai định dạng. Hãy sửa lại thành JSON HỢP LỆ.

QUY TẮC:
- CHỈ xuất JSON thuần, KHÔNG bọc markdown, KHÔNG thêm lời dẫn nào.
- GIỮ NGUYÊN toàn bộ nội dung/ý nghĩa, chỉ sửa phần cú pháp (ngoặc thiếu, dấu phẩy thừa, chuỗi chưa đóng, xuống dòng chưa escape...).
- Nếu nội dung bị cắt giữa chừng thì đóng lại cho hợp lệ, giữ tối đa phần đã có.

NỘI DUNG CẦN SỬA:
${response.text}`;
      try {
        const repaired = await callAI({
          profile: ctx.profile,
          params: { ...ctx.generationParams, temperature: 0 },
          messages: [{ role: 'user', content: repairPrompt }],
        });
        parsed = extractJsonFromText(repaired.text);
        if (parsed) {
          store.addLog({ step, level: 'success', message: '🩹 Đã vá được JSON, tiếp tục (không mất bước này).' });
        }
      } catch (e) {
        console.warn('[AutoCreator] vá JSON thất bại:', e);
      }
    }

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

      // (User 21/07 — bug 71) Thế giới lớn mà lorebook chỉ vài entry. Ba chốt chặn:
      // 1) TRẦN nới theo QUY MÔ thật của thế giới — blueprint đã liệt kê bao nhiêu thực thể
      //    (chủ đề gợi ý + phe phái + hệ thống) thì cần chừng đó entry, đừng kẹt ở mặc định 20.
      const entityCount =
        (blueprint?.suggestedEntryTopics?.length ?? 0) +
        (blueprint?.worldStructure?.factions?.length ?? 0) +
        (blueprint?.worldStructure?.systems?.length ?? 0);
      const totalEntries = Math.min(100, Math.max(lbConfig.totalEntries, entityCount + 5));
      // 2) SÀN mặc định = 80% trần (card cũ lưu minEntries=0 cũng được nâng) → thiếu thì tự nối batch bù.
      const minEntries = Math.max(lbConfig.minEntries ?? 0, Math.floor(totalEntries * 0.8));
      if (totalEntries > lbConfig.totalEntries) {
        store.addLog({ step, level: 'info', message: `📐 Thế giới có ~${entityCount} thực thể → nâng mục tiêu lorebook ${lbConfig.totalEntries} → ${totalEntries} entry (sàn ${minEntries}).` });
      }

      let createdCount = 0;
      await runBatchGeneration({
        topicPrompt,
        // (việc 90) Bước lorebook trước đây đi vòng qua callAIAndExtract nên KHÔNG nhận được
        // quy tắc của user — gõ "không tạo nhân vật" mà vẫn đẻ hàng loạt nhân vật.
        userRules: config.userRules,
        useCardContext: true,
        totalEntries,
        minEntries,
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
      // 3) KHÔNG THẤT BẠI ÂM THẦM: dưới sàn an toàn thì ném lỗi để pipeline chạy lại bước này
      //    (giống bước mvuzod), thay vì log "✅ Hoàn thành" trong khi lorebook rỗng hoác.
      const floor = Math.max(1, Math.floor(minEntries * 0.6));
      if (createdCount < floor) {
        throw new Error(`Lorebook chỉ tạo được ${createdCount}/${totalEntries} entry (sàn ${floor}) — nhiều entry bị loại trùng hoặc AI trả thiếu. Đang thử lại...`);
      }
      store.setStepResult(step, `Đã tạo ${createdCount}/${totalEntries} entries.`);
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
      // (bug 72) Form 0 field = wizard chỉ có trang bìa + trang xác nhận, user không nhập được
      // gì. Trước đây lỗi này im lặng đi thẳng vào card. Ném lỗi để vòng retry chạy lại bước.
      if (built.fieldsRendered === 0 && uiCfg.component !== 'status_bar') {
        throw new Error(
          'Game UI dựng ra 0 ô nhập — schema MVU không có field nào nhập được ' +
          '(toàn readOnly/hidden, hoặc schema rỗng). Chạy lại bước MVUZOD Schema để sinh schema đủ field.',
        );
      }
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
    const initEntry = entries.find(en => String(en.content || '').includes('[initvar]') || String(en.comment || '').toLowerCase().includes('initvar'));
    if (initEntry) {
      lines.push('✅ Có entry [initvar] (khởi tạo biến)');
      // (bug 72) Entry khởi tạo BẬT là lỗi im lặng nguy hiểm nhất: card nhìn có vẻ đủ, nhưng
      // engine MVU không nhận nó làm template nên biến không bao giờ khởi tạo → vào game là lỗi.
      const initOn = (initEntry as { enabled?: boolean; disable?: boolean }).enabled !== false
        && (initEntry as { disable?: boolean }).disable !== true;
      if (initOn) {
        lines.push('❌ Entry [initvar] đang BẬT — phải TẮT nó. Đang bật thì MVU không đọc làm template khởi tạo biến, vào game sẽ lỗi "变量更新失败".');
        problems++;
      } else {
        lines.push('✅ Entry [initvar] đã tắt đúng chuẩn (MVU đọc làm template)');
      }
    }
    else { lines.push('⚠️ Có schema nhưng KHÔNG thấy entry [initvar] — biến sẽ không khởi tạo, MVU dễ báo "变量更新失败"'); problems++; }
    const hasUpdate = entries.some(en => /mvu_update/i.test(String(en.comment || '')) || /mvu_update/i.test(String(en.content || '')));
    if (hasUpdate) lines.push('✅ Có entry quy tắc cập nhật biến ([mvu_update])');
    else { lines.push('⚠️ KHÔNG thấy entry quy tắc cập nhật biến — AI trong game không biết cách cập nhật, dễ lỗi "变量更新失败"'); problems++; }

    // (User 22/07 — bug 75) HỢP ĐỒNG VỚI ENGINE MVU — phần trước đây lọt lưới hoàn toàn.
    // Phép kiểm cũ chỉ hỏi "có entry nào chứa chữ mvu_update không", nên một entry rỗng cũng
    // PASS. Thẻ user gửi có đủ 3 entry đầu, báo cáo xanh mướt, mà vào game vẫn lỗi.
    // Card MVU thật (đối chiếu bugNeedFix/1, /8, /9) bắt buộc có khối <UpdateVariable> với
    // ĐÚNG hai thẻ con <Analysis> và <JSONPatch>.
    // (User 23/07 — việc 87) Dùng CHUNG `checkMvuOutputContract` với bộ sinh entry. Trước đây hai
    // bên tự định nghĩa riêng: bộ sinh xuất mảng JSON để trần, bộ kiểm đòi <Analysis>/<JSONPatch>
    // → mọi thẻ Auto Creator tạo ra đều đỏ mà chẳng ai phát hiện hai bên lệch nhau.
    const allContent = entries.map(en => String(en.content || '')).join('\n');
    const contract = checkMvuOutputContract(allContent);
    if (contract.missing.includes('UpdateVariable')) {
      lines.push('❌ Không có entry nào dạy AI khối <UpdateVariable> — đây là ĐỊNH DẠNG ĐẦU RA của biến. Thiếu nó thì MVU không bóc được lệnh cập nhật, vào game báo "变量更新失败".');
      problems++;
    } else if (!contract.ok) {
      // (Goal 100.1) ĐỐI CHIẾU SOURCE ENGINE: <UpdateVariable> chứa lệnh hàm `_.set(...)`
      // CŨNG hợp lệ (fn_call_match || json_patch_match — invoke_extra_model.ts:351). Trước
      // đây phép kiểm chỉ biết JSONPatch nên bắt lỗi oan card dùng phương ngữ _.set.
      if (isMvuUpdateBlockAccepted(allContent)) {
        lines.push('✅ Khối <UpdateVariable> dùng phương ngữ lệnh _.set — engine chấp nhận (không bắt buộc JSONPatch)');
      } else {
        lines.push(`❌ Khối <UpdateVariable> THIẾU thẻ con ${contract.missing.map(m => `<${m}>`).join(' và ')} và cũng không có lệnh _.set nào — đúng lỗi "其内的更新命令无效" của engine.`);
        problems++;
      }
    } else {
      lines.push('✅ Có định dạng đầu ra biến đầy đủ (<UpdateVariable> + <Analysis> + <JSONPatch>)');
    }

    // Entry [initvar] phải có nội dung THẬT, không chỉ đúng cái tên.
    if (initEntry && String(initEntry.content || '').trim().length < 10) {
      lines.push('❌ Entry [initvar] rỗng — biến không có giá trị khởi tạo, MVU sẽ chạy trên object trống.');
      problems++;
    }

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

  // (Goal 100.3/100.4) Suite hợp nhất validateMvuCard — bắt những gì các phép kiểm cũ lọt:
  // form ghi biến sai đường (bug #162 — kho biến chat của ST thay vì Mvu API) và khoá phẳng
  // "A/B:" trong initvar (bug 78a). Chỉ lấy các mã CHƯA được kiểm ở trên để không báo trùng.
  const unified = validateMvuCard({ entries: entries as never, regexScripts });
  const NEW_CODES = new Set(['initvar-flat-keys', 'form-write-path']);
  for (const iss of unified.errors) {
    if (!NEW_CODES.has(iss.code)) continue;
    lines.push(`❌ ${iss.message}${iss.where ? ` (${iss.where})` : ''}`);
    problems++;
  }

  // 3b. (bug 72) Giao diện không hiện — 2 nguyên nhân im lặng nhất, kiểm thẳng ở đây:
  //  - khối HTML mở fence ```html mà thiếu ``` đóng ⇒ SillyTavern không render;
  //  - nhiều script cùng bám một mỏ neo ⇒ cái chạy trước ăn mất, cái sau vô hình.
  const FENCE = '`'.repeat(3);
  const unclosed = regexScripts.filter(rs => {
    const rep = String(rs.replaceString || '');
    return rep.startsWith(FENCE + 'html') && !new RegExp('\\n' + FENCE + '\\s*$').test(rep);
  });
  if (unclosed.length > 0) {
    lines.push(`❌ ${unclosed.length} script mở fence ${FENCE}html nhưng THIẾU ${FENCE} đóng ở cuối — ST sẽ không render giao diện: ${unclosed.map(s => s.scriptName || '?').slice(0, 3).join(', ')}`);
    problems++;
  }
  const renderByAnchor = new Map<string, number>();
  for (const rs of regexScripts) {
    const r = rs as { findRegex?: string; promptOnly?: boolean; markdownOnly?: boolean };
    if (r.promptOnly && !r.markdownOnly) continue; // vế ẩn, không tranh chỗ render
    if (!r.findRegex) continue;
    renderByAnchor.set(r.findRegex, (renderByAnchor.get(r.findRegex) ?? 0) + 1);
  }
  const clashed = [...renderByAnchor].filter(([, n]) => n > 1);
  if (clashed.length > 0) {
    lines.push(`❌ ${clashed.length} mỏ neo bị NHIỀU script render cùng bám (${clashed.map(([a, n]) => `${a} ×${n}`).join(', ')}) — chỉ cái đầu chạy, các giao diện còn lại biến mất`);
    problems++;
  } else if (renderByAnchor.size > 0) {
    lines.push('✅ Mỗi mỏ neo giao diện chỉ có đúng 1 script render');
  }

  // 3c. (User 22/07 — bug 75) "Opening Form đã hiện ra nhưng không bấm được nút."
  // Trước đây báo cáo không đọc JS một dòng nào, nên lỗi này lọt 100%.
  // Hai lỗi im lặng làm giao diện "hiện mà chết":
  //   (a) handler gọi từ `onclick=` inline nhưng hàm khai báo trong <script type="module">
  //       → hàm chỉ sống trong scope module, `onclick=` chạy ở global ⇒ ReferenceError;
  //   (b) script render có replaceString RỖNG — nó vẫn "compile OK" và vẫn "đúng 1 script mỗi
  //       mỏ neo", nên báo cáo xanh mướt trong khi màn hình trắng trơn.
  // Chỉ MỎ NEO giao diện mới được coi là "script render". Script XOÁ nội dung (ví dụ
  // "[AI] Loại bỏ khối UpdateVariable") vốn dĩ PHẢI có replaceString rỗng — đó là việc của nó,
  // không phải lỗi. Cờ markdownOnly+promptOnly cùng bật của nó cũng đúng chuẩn: theo
  // engine.js:347-355 của ST, tổ hợp đó chạy ở lượt hiển thị và lượt prompt nhưng KHÔNG chạy ở
  // lượt ghi chat[].mes — nên khối <UpdateVariable> bị giấu khỏi mắt user và khỏi prompt, mà
  // vẫn còn nguyên trong tin nhắn thô cho MVU đọc.
  const UI_ANCHORS = [OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR];
  const brokenHandlers: string[] = [];
  const emptyRender: string[] = [];
  for (const rs of regexScripts) {
    const r = rs as { findRegex?: string; replaceString?: string; scriptName?: string; promptOnly?: boolean; markdownOnly?: boolean };
    const rep = String(r.replaceString || '');
    if (r.promptOnly && !r.markdownOnly) continue; // vế ẩn, không render gì

    const isAnchor = !!r.findRegex && UI_ANCHORS.includes(r.findRegex);
    if (isAnchor && rep.trim() === '') { emptyRender.push(r.scriptName || r.findRegex!); continue; }
    if (!/<script/i.test(rep)) continue;

    const isModule = /<script[^>]*type\s*=\s*["']module["']/i.test(rep);
    if (!isModule) continue;
    for (const m of rep.matchAll(/\son(?:click|change|input|submit|blur|focus)\s*=\s*["']([A-Za-z_$][\w$]*)\s*\(/g)) {
      const fn = m[1];
      const exported = new RegExp(`(?:window|globalThis)\\s*\\.\\s*${fn}\\s*=`).test(rep);
      if (!exported && !brokenHandlers.includes(fn)) brokenHandlers.push(fn);
    }
  }
  if (emptyRender.length > 0) {
    lines.push(`❌ ${emptyRender.length} script render có nội dung RỖNG (${emptyRender.slice(0, 3).join(', ')}) — mỏ neo bị nuốt, giao diện sẽ trắng trơn dù báo cáo nhìn có vẻ ổn.`);
    problems++;
  }
  if (brokenHandlers.length > 0) {
    lines.push(`❌ ${brokenHandlers.length} nút sẽ BẤM KHÔNG CHẠY: ${brokenHandlers.slice(0, 5).join(', ')} — gọi từ onclick= nhưng hàm nằm trong <script type="module"> nên không lên global. Cần gán window.<tên hàm> = <tên hàm>.`);
    problems++;
  } else if (regexScripts.some(rs => /<script[^>]*type\s*=\s*["']module["']/i.test(String((rs as { replaceString?: string }).replaceString || '')))) {
    lines.push('✅ Mọi handler gọi từ onclick= đều đã được đưa ra global (nút bấm chạy được)');
  }

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

/**
 * (User 22/07 — bug 75) "Nâng lại độ thông minh của Kiểm tra tổng thể: toàn thấy nó nói Card
 * đã chơi được."
 *
 * Prompt cũ có 4 chỗ đẩy AI về phía lạc quan, sửa hết:
 *  1. Khung "nhận xét" (comment) chứ không phải phán xử — không một chữ nào bắt AI hoài nghi.
 *  2. NEO: báo cáo tự động đặt TRƯỚC nội dung thẻ. Báo cáo cũ dễ toàn ✅ nên AI đọc xong là
 *     đã tin card ổn rồi mới nhìn tới thẻ. Nay đảo thứ tự: THẺ trước, báo cáo sau.
 *  3. "NGẮN GỌN ~300 từ" ép tóm tắt lạc quan thay vì liệt kê lỗi.
 *  4. Câu hỏi "card chơi được chưa?" không có tiêu chí trượt nào.
 *
 * Cũng liệt kê thẳng những lỗi ĐÃ TỪNG lọt lưới để AI biết chỗ mà soi.
 */
function buildFinalCheckReviewPrompt(reportText: string, cardContext: string, userRules: string): string {
  return `Bạn là người NGHIỆM THU character card SillyTavern (MVU/Zod, regex dashboard, lorebook).
Vai của bạn là người HOÀI NGHI, không phải người khen. Mặc định coi card là CHƯA đạt cho tới khi
tự tìm thấy bằng chứng ngược lại trong chính nội dung thẻ bên dưới.

═══ NỘI DUNG CARD (JSON, có thể bị cắt) ═══
${cardContext.slice(0, 60_000)}
${userRules?.trim() ? `\n═══ QUY TẮC NGƯỜI DÙNG ĐẶT RA ═══\n${userRules.trim()}` : ''}

═══ BÁO CÁO KIỂM TRA TỰ ĐỘNG (chỉ là gợi ý, KHÔNG phải kết luận) ═══
${reportText}

Báo cáo trên chỉ bắt được lỗi máy kiểm được. NÓ ĐÃ TỪNG BÁO "ĐẠT" CHO CARD HỎNG. Đừng tin nó.

═══ NHỮNG LỖI TỪNG LỌT LƯỚI — SOI ĐÚNG NHỮNG CHỖ NÀY ═══
1. Entry [mvu_update] có tên đúng nhưng nội dung KHÔNG dạy khối <UpdateVariable> với đủ hai thẻ
   con <Analysis> và <JSONPatch> ⇒ vào game báo "变量更新失败".
2. Entry [initvar] còn BẬT (phải tắt), hoặc nội dung rỗng, hoặc thiếu biến mà schema có.
3. Nút trong Opening Form gọi từ onclick= nhưng hàm nằm trong <script type="module"> mà không
   gán ra window ⇒ giao diện hiện nhưng bấm không chạy.
4. Script render có replaceString rỗng ⇒ mỏ neo bị nuốt, màn hình trắng.
5. Khối HTML mở fence \`\`\`html mà thiếu fence đóng ở cuối.
6. Mỏ neo (<OpeningFormImpl/>, <StatusPlaceHolderImpl/>) không hề xuất hiện trong first_mes
   ⇒ không có chỗ nào để giao diện bám vào.
7. data-var trong regex không khớp tên biến trong schema ⇒ ô hiển thị trống.

═══ TRẢ LỜI (tiếng Việt) ═══
A. PHÁN QUYẾT: chọn đúng một trong ba — CHƠI ĐƯỢC / CHƠI ĐƯỢC NHƯNG LỖI VẶT / CHƯA CHƠI ĐƯỢC.
   Quy tắc: chỉ cần MỘT trong 7 mục trên dính ⇒ CHƯA CHƠI ĐƯỢC. Không được nói "có vẻ ổn".
B. BẰNG CHỨNG: với mỗi mục bạn kết luận là hỏng, trích ĐÚNG đoạn trong thẻ chứng minh. Không
   trích được thì đừng kết luận.
C. CÁCH SỬA: mỗi lỗi một dòng — chạy lại bước nào của Auto Creator, hoặc mở panel nào.
D. NẾU BẠN KHÔNG NHÌN THẤY ĐỦ: nội dung thẻ bị cắt bớt. Nói rõ phần nào bạn không kiểm được,
   thay vì đoán là nó ổn.

Viết đủ dài để nói hết ý. KHÔNG trả JSON, KHÔNG viết lại card.`;
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
        // (bug 72) Trước đây push thẳng: bước mvuzod đã tạo sẵn vế "ẩn" cho cùng mỏ neo, rồi
        // mỗi lần Apply/retry lại chồng thêm một bộ nữa. Hai script cùng mỏ neo thì cái chạy
        // trước ăn mất mỏ neo, cái sau không tìm thấy gì — giao diện im lặng biến mất.
        // Ghi đè theo (mỏ neo + vai trò) để Apply bao nhiêu lần cũng ra đúng một bộ.
        const roleOf = (s: { promptOnly?: boolean; markdownOnly?: boolean }) =>
          s.promptOnly && !s.markdownOnly ? 'hide' : 'render';
        for (const s of scripts) {
          const incoming = s as { findRegex?: string; promptOnly?: boolean; markdownOnly?: boolean };
          const rs = c.data.extensions.regex_scripts;
          const dupAt = rs.findIndex(
            e => e.findRegex === incoming.findRegex && roleOf(e) === roleOf(incoming),
          );
          const next = { ...(s as object), id: uuidv4() } as (typeof rs)[number];
          if (dupAt >= 0) rs[dupAt] = next;
          else rs.push(next);
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

          // (User 21/07 — "MVU có 4 file mà card tui mới có 2 cái")
          // Bộ regex lõi MVU gồm 2 CẶP (ẩn khỏi prompt + render ra màn hình) cho thanh trạng
          // thái và bảng khởi đầu, cộng script xoá khối <UpdateVariable>. Thiếu vế render thì
          // user chỉ thấy mỏ neo trơ; thiếu vế ẩn thì mỏ neo lọt vào prompt mỗi lượt.
          // Bổ sung THEO findRegex+vai trò, không đụng script đã có (Game UI ghi HTML sau).
          if (!c.data.extensions.regex_scripts) c.data.extensions.regex_scripts = [];
          const rs = c.data.extensions.regex_scripts;
          const roleOf = (s: { promptOnly?: boolean; markdownOnly?: boolean }) =>
            s.promptOnly && !s.markdownOnly ? 'hide' : 'render';
          for (const core of buildMvuCoreRegexScripts()) {
            const already = rs.some(
              s => s.findRegex === core.findRegex && roleOf(s) === roleOf(core),
            );
            if (!already) rs.push({ ...core, id: uuidv4() } as (typeof rs)[number]);
          }
        }
        
        if (!c.data.character_book) c.data.character_book = { name: c.data.name, entries: [] };
        const entries = c.data.character_book.entries;

        if (config.stepConfigs.mvuzod.createInitVar && result.initVarEntry) {
          // (bug 72) Đúng chuẩn card MVU thật: entry khởi tạo phải TẮT (engine MVU đọc nội
          // dung nó làm template, KHÔNG được bơm vào prompt) và constant = true.
          entries.push(materializeEntry({
            comment: '[initvar]初始化',
            keys: [''],
            // (bug 78) AI hay viết khoá PHẲNG có dấu `/` (`Player/Name: "..."`) thay vì cây YAML.
            // MVU đọc thành MỘT khoá tên đúng chữ "Player/Name", không phải Player > Name, nên
            // không khớp schema lẫn Opening Form. Đo trên thẻ thật (bugNeedFix/41): giao nhau
            // giữa tên biến của initvar và của schema là ĐÚNG 0.
            content: nestFlatInitvarKeys(result.initVarEntry as string),
            constant: true,
          }, { enabled: false, defaultRole: 0, insertionOrderStart: 0 }, nextEntryId(entries)));
        }

        if (config.stepConfigs.mvuzod.createUpdateRules && result.updateRulesEntry) {
          entries.push(materializeEntry({
            comment: '[mvu_update]Quy tắc cập nhật biến',
            keys: [''],
            content: result.updateRulesEntry as string,
            constant: true,
          }, { defaultPosition: 4, defaultDepth: 0, defaultRole: 0 }, nextEntryId(entries)));
        }

        if (config.stepConfigs.mvuzod.createVarList && result.varListEntry) {
          entries.push(materializeEntry({
            comment: 'Danh sách biến',
            keys: [''],
            content: result.varListEntry as string,
            constant: true,
          }, { defaultDepth: 1 }, nextEntryId(entries)));
        }

        // (User 22/07 — bug 75) HAI ENTRY BẮT BUỘC MÀ AUTO CREATOR TRƯỚC GIỜ KHÔNG HỀ TẠO.
        //
        // Card MVU thật có 5 entry hệ thống; Auto Creator chỉ đẻ ra 3 cái đầu — khớp 100% với
        // thẻ lỗi user gửi. Thiếu entry "định dạng đầu ra" thì AI không biết phải bọc mảng JSON
        // trong <Analysis> + <JSONPatch>, engine MVU bóc không ra lệnh nào ⇒ SillyTavern báo
        // "[MVU额外模型解析]变量更新失败". Đối chiếu 3 card thật (bugNeedFix/1, /8, /9): cả 3
        // đều có entry này, đặt ở position 4 (@depth), depth 0, role system.
        //
        // Không phụ thuộc AI — nội dung là HỢP ĐỒNG cố định với engine, sinh bằng luật.
        if (config.stepConfigs.mvuzod.createUpdateRules) {
          const hasFormat = entries.some(e => /输出格式|Định dạng đầu ra/i.test(String(e.comment || '')));
          if (!hasFormat) {
            entries.push(materializeEntry({
              comment: '[mvu_update]Định dạng đầu ra biến',
              keys: [''],
              content: buildOutputFormatContent(),
              constant: true,
            }, { defaultPosition: 4, defaultDepth: 0, defaultRole: 0, insertionOrderStart: 200 }, nextEntryId(entries)));
            entries.push(materializeEntry({
              comment: '[mvu_update]Nhấn mạnh định dạng đầu ra',
              keys: [''],
              content: buildEmphasisContent(),
              constant: true,
            }, { defaultPosition: 4, defaultDepth: 0, defaultRole: 0, insertionOrderStart: 200 }, nextEntryId(entries)));
            useAutoCreatorStore.getState().addLog({
              step, level: 'success',
              message: '📐 Đã thêm 2 entry định dạng đầu ra biến (bắt buộc để MVU đọc được lệnh cập nhật).',
            });
          }
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
