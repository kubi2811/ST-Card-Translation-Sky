import { useCallback, useRef } from 'react';
import { useStore } from '../store';
import { translateText, translateBatch, fieldGroupToFieldType } from '../utils/apiClient';
import { extractTranslatableFields, applyTranslationsToCard } from '../utils/cardFields';
import { syncMvuVariables, postProcessRegexHtml, extractPotentialMvuKeyStrings, aiTranslateMvuKeys, extractZodDescriptions } from '../utils/mvuSync';
import { shouldSkipTranslation } from '../utils/langDetect';
import { clearRAGCache } from '../utils/ragContext';
import { getMvuCardSummary } from '../utils/mvuDetector';
import { validateMvuVariables, autoFixMvuVariables, generateSyncReport, buildEntryNameDictionary, validateEntryNameSync } from '../utils/mvuValidator';
import { buildEffectivePrompt } from '../utils/promptBuilder';
import type { FieldGroup, FieldGroupConfig, TranslationField } from '../types/card';


export function useTranslation() {
  const store = useStore();
  const abortRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);

  /**
   * Prepare fields for translation.
   * If `continueMode` is true, merge new field groups with existing translated fields.
   */
  const prepareFields = useCallback((continueMode = false) => {
    if (!store.card) return [];
    const enabledGroups = store.translationConfig.fieldGroups
      .filter((g: FieldGroupConfig) => g.enabled)
      .map((g: FieldGroupConfig) => g.id) as FieldGroup[];
    const newFields = extractTranslatableFields(store.card, enabledGroups);

    // In continue mode: preserve already-done fields from previous runs
    let mergedFields = newFields;
    if (continueMode && store.fields.length > 0) {
      const existingMap = new Map(store.fields.map(f => [f.path, f]));
      mergedFields = newFields.map(nf => {
        const existing = existingMap.get(nf.path);
        // Keep existing translation if done, skipped or ignored
        if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
          return existing;
        }
        return nf;
      });
      // Also keep done/skipped/ignored fields from groups not currently enabled
      for (const ef of store.fields) {
        if ((ef.status === 'done' || ef.status === 'skipped' || ef.status === 'ignored') && !mergedFields.find(m => m.path === ef.path)) {
          mergedFields.push(ef);
        }
      }
    }

    // Skip detection: mark fields already in target language or wrong source language
    // Only apply to fields that aren't already done/skipped
    if (store.translationConfig.skipAlreadyTranslated) {
      const targetLang = store.translationConfig.targetLanguage;
      const sourceLang = store.translationConfig.sourceLanguage;
      for (const f of mergedFields) {
        if (f.status === 'pending' || f.status === 'error') {
          if (f.original.length > 5 && shouldSkipTranslation(f.original, targetLang, sourceLang)) {
            f.status = 'skipped';
            f.translated = f.original; // Keep original since it's either correct or we don't want to translate it
          }
        }
      }
    }

    store.setFields(mergedFields);
    return mergedFields;
  }, [store]);

  /* ─── Check pause/abort helpers ─── */
  const checkAbort = () => abortRef.current?.signal.aborted;

  const waitForPause = async (): Promise<boolean> => {
    while (pauseRef.current) {
      await new Promise((r) => setTimeout(r, 200));
      if (checkAbort()) return true; // aborted
    }
    return false; // not aborted
  };

  /* ─── Translate a single field ─── */
  const translateSingleField = async (field: TranslationField, index: number, fields: TranslationField[]) => {
    store.setCurrentFieldIndex(index);
    store.updateField(field.path, { status: 'translating' });
    const charCount = field.original.length;
    // Tự động tính toán CHUNK_THRESHOLD dựa trên token user nhập (cùng công thức maxTokens * 3.5)
    const currentMaxTokens = store.proxy.maxTokens;
    const currentChunkSize = store.translationConfig.chunkSize;
    const CHUNK_THRESHOLD = currentChunkSize && currentChunkSize > 0
      ? currentChunkSize
      : (currentMaxTokens && currentMaxTokens > 0 ? Math.min(Math.floor(currentMaxTokens * 3.5), 200000) : 40000);
      
    if (charCount > CHUNK_THRESHOLD) {
      const estimatedChunks = Math.ceil(charCount / CHUNK_THRESHOLD);
      store.addLog('active', `Translating: ${field.label} (${charCount.toLocaleString()} chars → ~${estimatedChunks} chunks ⚡parallel)`);
    } else {
      store.addLog('active', `Translating: ${field.label} (${charCount.toLocaleString()} chars)`);
    }

    // IMPORTANT: read fresh retries from store (not stale `field` parameter) to prevent infinite retry loops
    const freshRetries = () => useStore.getState().fields.find(f => f.path === field.path)?.retries || 0;

    try {
      // Contextual keyword translation: for lorebook keys, find the already-translated content
      let contextHint: string | undefined;
      if (field.group === 'lorebook_keys') {
        const contentPath = field.path.replace('.keys', '.content').replace('.secondary_keys', '.content');
        const contentField = fields.find(f => f.path === contentPath);
        if (contentField) {
          // Use translated content if available, else original (truncated to save tokens)
          const ctx = contentField.translated || contentField.original || '';
          contextHint = ctx.slice(0, 1500);
        }
      }

      // ═══ Centralized prompt building (single source of truth) ═══
      // Build entry name dictionary from already-translated lorebook name fields
      const entryNameDict = buildEntryNameDictionary(fields);

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: store.translationConfig.enableObjectiveMode,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field,
        allFields: fields,
        mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
        glossary: store.translationConfig.glossary,
        customSchema: store.translationConfig.customSchema,
        liveSchemaContext: store.liveSchemaContext,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(entryNameDict).length > 0 ? entryNameDict : undefined,
        expertMode: store.proxy.expertMode,
      });

      // ═══ Determine field type for Master Prompt (expert mode) ═══
      const resolvedFieldType = fieldGroupToFieldType(field.group, field.entryType);
      const currentMvuDict = store.translationConfig.enableMvuSync
        ? useStore.getState().translationConfig.mvuDictionary
        : undefined;

      let translated = await translateText(
        field.original,
        field.label,
        store.proxy,
        store.translationConfig.targetLanguage,
        store.translationConfig.sourceLanguage,
        promptResult.effectivePrompt,
        promptResult.schemaForApi,
        abortRef.current?.signal,
        contextHint,
        promptResult.glossaryForApi,
        field.previousTranslation,
        resolvedFieldType,
        currentMvuDict,
        store.translationConfig.chunkSize
      );

      // Post-process regex HTML: font swap + underscore display
      const isRegexContent = field.group === 'regex' && (field.path.includes('replaceString') || field.path.includes('trimStrings'));
      if (isRegexContent && translated) {
        translated = postProcessRegexHtml(translated);
      }
      // Post-process TavernHelper content that contains HTML
      if (field.group === 'tavern_helper' && translated && /<[a-z][^>]*>/i.test(translated)) {
        translated = postProcessRegexHtml(translated);
      }

      // Empty translation guard — if API returned empty/whitespace, treat as error

      if (!translated || !translated.trim()) {
        if (freshRetries() < 1) {
          store.updateField(field.path, { retries: freshRetries() + 1 });
          store.addLog('retry', `⚠️ Empty translation for ${field.label}. Auto-retrying...`);
          await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
          return 'retry';
        }
        store.updateField(field.path, { status: 'error', error: 'API returned empty translation' });
        store.addLog('error', `Empty translation for ${field.label} after retry`);
        return 'error';
      }

      // Min response length validation
      // Code-heavy fields (TavernHelper scripts, regex HTML) legitimately produce much shorter
      // translations because most content is code that stays unchanged — only CJK text is translated.
      // Use a much lower threshold for these fields to prevent false-positive retries.
      const isCodeHeavyField = field.group === 'tavern_helper' || field.group === 'regex';
      const baseRatio = store.proxy.minResponseRatio || 0;
      const ratio = isCodeHeavyField ? Math.min(baseRatio, 0.03) : baseRatio;
      if (ratio > 0 && field.original.length > 20) {
        const responseRatio = translated.length / field.original.length;
        if (responseRatio < ratio) {
          if (freshRetries() < 1) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry', `⚠️ Translation too short for ${field.label}: ${translated.length}/${field.original.length} chars (${(responseRatio * 100).toFixed(0)}% ratio). Auto-retrying...`);
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry'; // Signal to retry
          } else {
            store.addLog('warning', `Translation still short for ${field.label}: ${translated.length}/${field.original.length} chars. Accepting result.`);
          }
        }
      }

      store.updateField(field.path, { status: 'done', translated });
      store.addLog('success', `Translated: ${field.label} (${translated.length} chars)`);
      return 'done';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Cancelled' || checkAbort()) {
        store.updateField(field.path, { status: 'pending' });
        throw err; // Re-throw for cancel handling
      }
      store.updateField(field.path, { status: 'error', error: msg, retries: freshRetries() + 1 });
      store.addLog('error', `Failed: ${field.label} — ${msg}`);
      store.addToast('error', `Failed: ${field.label}`);
      return 'error';
    }
  };

  /* ─── Helper: check if a field is MVU-critical (needs extra care) ─── */
  const isMvuCriticalField = (f: TranslationField) =>
    f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic';

  /* ─── Translate one batch of fields (single API call + fallback) ─── */
  const translateOneBatch = async (batchFields: TranslationField[], retryCount = 0) => {
    // Mark all as translating
    for (const f of batchFields) {
      store.updateField(f.path, { status: 'translating' });
    }
    const totalChars = batchFields.reduce((s, f) => s + f.original.length, 0);
    const retryPrefix = retryCount > 0 ? `[Retry ${retryCount}] ` : '';
    const mvuCriticalCount = batchFields.filter(isMvuCriticalField).length;
    const entryTypes = [...new Set(batchFields.map(f => f.entryType).filter(Boolean))];
    const typeLabel = entryTypes.length > 0 ? ` [${entryTypes.join(',')}]` : '';
    store.addLog('active', `${retryPrefix}Batch translating ${batchFields.length} entries${typeLabel} (${totalChars} chars${mvuCriticalCount > 0 ? `, ${mvuCriticalCount} MVU-critical` : ''}) - Unlimited Context`);

    try {
      const items = batchFields.map(f => ({ text: f.original, fieldName: f.label }));
      
      
      // ═══ Centralized prompt building (single source of truth) ═══
      // Build entry name dictionary from already-translated lorebook name fields
      const batchEntryNameDict = buildEntryNameDictionary(store.fields);

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: store.translationConfig.enableObjectiveMode,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field: batchFields[0],
        allFields: store.fields,
        batchFields,
        mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
        glossary: store.translationConfig.glossary,
        customSchema: store.translationConfig.customSchema,
        liveSchemaContext: store.liveSchemaContext,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(batchEntryNameDict).length > 0 ? batchEntryNameDict : undefined,
        expertMode: store.proxy.expertMode,
      });

      const results = await translateBatch(
        items,
        store.proxy,
        store.translationConfig.targetLanguage,
        store.translationConfig.sourceLanguage,
        store.proxy.systemPromptPrefix,
        promptResult.effectivePrompt,
        promptResult.schemaForApi,
        abortRef.current?.signal,
        promptResult.glossaryForApi,
        store.translationConfig.chunkSize
      );

      // ═══ Apply results + Post-batch MVU validation ═══
      let doneCount = 0;
      let autoFixCount = 0;
      const emptyFields: TranslationField[] = [];
      const mvuDict = store.translationConfig.enableMvuSync
        ? useStore.getState().translationConfig.mvuDictionary
        : {};
      const hasMvuDict = Object.keys(mvuDict).filter(k => mvuDict[k] && k !== mvuDict[k]).length > 0;

      for (let j = 0; j < batchFields.length; j++) {
        let translated = results[j] || '';
        if (!translated.trim()) {
          emptyFields.push(batchFields[j]);
          continue;
        }

        // ─── Post-batch MVU variable validation + auto-fix ───
        if (hasMvuDict) {
          const fieldType = (batchFields[j].entryType || batchFields[j].group) as any;
          const validation = validateMvuVariables(batchFields[j].original, translated, mvuDict, fieldType);

          if (validation.unreplaced.length > 0) {
            // Tự động sửa (auto-fix) biến MVU cho TẤT CẢ các trường (kể cả lorebook, description, v.v.)
            // để đảm bảo tính nhất quán của biến trên toàn bộ thẻ theo yêu cầu người dùng.
            const fixed = autoFixMvuVariables(translated, mvuDict, validation.unreplaced);
            if (fixed !== translated) {
              translated = fixed;
              autoFixCount++;
              store.addLog('info', `🔧 Auto-fixed ${validation.unreplaced.length} vars in ${batchFields[j].label}`);
            } else {
              store.addLog('warning', `⚠️ ${validation.unreplaced.length} unreplaced vars in ${batchFields[j].label}: ${validation.unreplaced.slice(0, 3).join(', ')}`);
            }
          }

          // Log warnings (macro disappearance, etc.)
          for (const w of validation.warnings.slice(0, 2)) {
            store.addLog('warning', `${batchFields[j].label}: ${w}`);
          }
        }

        // Post-process regex HTML
        const isRegexField = batchFields[j].group === 'regex' && (batchFields[j].path.includes('replaceString') || batchFields[j].path.includes('trimStrings'));
        if (isRegexField && translated) {
          translated = postProcessRegexHtml(translated);
        }
        if (batchFields[j].group === 'tavern_helper' && translated && /<[a-z][^>]*>/i.test(translated)) {
          translated = postProcessRegexHtml(translated);
        }

        store.updateField(batchFields[j].path, { status: 'done', translated, retries: retryCount });
        doneCount++;
      }

      // Log validation summary
      if (autoFixCount > 0) {
        store.addLog('info', `📋 Batch validation: ${doneCount} translated, ${autoFixCount} auto-fixed`);
      }

      // ═══ Fallback/Retry for empty results ═══
      if (emptyFields.length > 0) {
        // Exponential backoff
        const backoffDelay = Math.min((store.proxy.retryDelay || 1000) * Math.pow(2, retryCount), 15000);

        if (retryCount < (store.proxy.maxRetries || 3)) {
          // Log which specific fields failed
          const failedLabels = emptyFields.map(f => f.label.replace(/^Lorebook: /, '')).slice(0, 5);
          store.addLog('retry', `⚠️ ${emptyFields.length} items empty in batch: [${failedLabels.join(', ')}${emptyFields.length > 5 ? '...' : ''}]. Retrying (${backoffDelay}ms)...`);
          await new Promise((r) => setTimeout(r, backoffDelay));
          await translateOneBatch(emptyFields, retryCount + 1);
        } else {
          // ─── Fallback to individual using translateSingleField ───
          // Separate MVU-critical fields (process first) from regular ones
          const criticalFields = emptyFields.filter(isMvuCriticalField);
          const normalFields = emptyFields.filter(f => !isMvuCriticalField(f));
          const orderedFallback = [...criticalFields, ...normalFields];

          if (criticalFields.length > 0) {
            store.addLog('warning', `${emptyFields.length} empty after retries. Falling back to individual (${criticalFields.length} MVU-critical first)...`);
          } else {
            store.addLog('warning', `${emptyFields.length} empty after retries, falling back to individual...`);
          }

          for (let fi = 0; fi < orderedFallback.length; fi++) {
            const ef = orderedFallback[fi];
            if (checkAbort()) throw new Error('Cancelled');

            // Pause support during fallback
            if (await waitForPause()) throw new Error('Cancelled');

            try {
              // Use translateSingleField for full MVU context (per-type prompts, RAG, dict injection)
              const allCurrentFields = useStore.getState().fields;
              const fieldIdx = allCurrentFields.findIndex(f => f.path === ef.path);
              const result = await translateSingleField(ef, fieldIdx >= 0 ? fieldIdx : fi, allCurrentFields);

              // Extra retry for MVU-critical fields that failed
              if (result === 'error' && isMvuCriticalField(ef)) {
                store.addLog('retry', `🔄 Extra retry for MVU-critical: ${ef.label}`);
                await new Promise((r) => setTimeout(r, backoffDelay));
                await translateSingleField(ef, fieldIdx >= 0 ? fieldIdx : fi, allCurrentFields);
              }
            } catch (fallbackErr) {
              const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
              if (fbMsg === 'Cancelled' || checkAbort()) throw fallbackErr;
              store.updateField(ef.path, { status: 'error', error: fbMsg, retries: retryCount + 1 });
            }

            // Small delay between individual fallback calls
            if (fi < orderedFallback.length - 1 && store.proxy.requestDelay > 0) {
              await new Promise((r) => setTimeout(r, Math.max(store.proxy.requestDelay, 300)));
            }
          }
        }
      } else {
        store.addLog('success', `${retryPrefix}Batch complete: ${doneCount}/${batchFields.length}${autoFixCount > 0 ? ` (${autoFixCount} auto-fixed)` : ''}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Cancelled' || checkAbort()) {
        for (const f of batchFields) {
          const currentStatus = useStore.getState().fields.find(sf => sf.path === f.path)?.status;
          if (currentStatus === 'translating') {
            store.updateField(f.path, { status: 'pending' });
          }
        }
        throw err;
      }

      // Exponential backoff for batch-level failure
      const backoffDelay = Math.min((store.proxy.retryDelay || 1000) * Math.pow(2, retryCount), 15000);

      if (retryCount < (store.proxy.maxRetries || 3)) {
        store.addLog('retry', `⚠️ Batch completely failed, retrying (${backoffDelay}ms)... (${msg})`);
        await new Promise((r) => setTimeout(r, backoffDelay));
        await translateOneBatch(batchFields, retryCount + 1);
        return;
      }

      // ─── Batch completely failed after retries — fallback ALL via translateSingleField ───
      const criticalFields = batchFields.filter(isMvuCriticalField);
      const normalFields = batchFields.filter(f => !isMvuCriticalField(f));
      const orderedFallback = [...criticalFields, ...normalFields];

      store.addLog('warning', `Batch failed after retries, falling back for ${batchFields.length} entries${criticalFields.length > 0 ? ` (${criticalFields.length} MVU-critical first)` : ''}...`);

      for (let fi = 0; fi < orderedFallback.length; fi++) {
        const f = orderedFallback[fi];
        if (checkAbort()) throw new Error('Cancelled');
        if (await waitForPause()) throw new Error('Cancelled');

        try {
          const allCurrentFields = useStore.getState().fields;
          const fieldIdx = allCurrentFields.findIndex(sf => sf.path === f.path);
          const result = await translateSingleField(f, fieldIdx >= 0 ? fieldIdx : fi, allCurrentFields);

          // Extra retry for MVU-critical fields
          if (result === 'error' && isMvuCriticalField(f)) {
            store.addLog('retry', `🔄 Extra retry for MVU-critical: ${f.label}`);
            await new Promise((r) => setTimeout(r, backoffDelay));
            await translateSingleField(f, fieldIdx >= 0 ? fieldIdx : fi, allCurrentFields);
          }
        } catch (fallbackErr) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          if (fbMsg === 'Cancelled' || checkAbort()) throw fallbackErr;
          store.updateField(f.path, { status: 'error', error: fbMsg, retries: retryCount + 1 });
        }

        if (fi < orderedFallback.length - 1 && store.proxy.requestDelay > 0) {
          await new Promise((r) => setTimeout(r, Math.max(store.proxy.requestDelay, 300)));
        }
      }
    }
  };

  /* ─── Main translation loop ─── */
  const startTranslation = useCallback(async (continueMode = false) => {
    const allFields = prepareFields(continueMode);
    if (allFields.length === 0) {
      store.addToast('info', 'No translatable fields found');
      return;
    }

    // Filter to only fields that need translation
    const fields = allFields.filter(f => f.status === 'pending' || f.status === 'error');
    const skippedCount = allFields.filter(f => f.status === 'skipped').length;
    const alreadyDone = allFields.filter(f => f.status === 'done').length;

    if (fields.length === 0) {
      store.addToast('info', 'All fields are already translated or skipped');
      store.setPhase('done');
      return;
    }

    abortRef.current = new AbortController();
    pauseRef.current = false;
    store.setPhase('translating');
    store.setStartTime(Date.now());
    store.clearLogs();

    const logParts = [`Starting translation of ${fields.length} fields to ${store.translationConfig.targetLanguage}`];
    if (skippedCount > 0) logParts.push(`(${skippedCount} skipped — already in target language)`);
    if (alreadyDone > 0) logParts.push(`(${alreadyDone} already done)`);
    store.addLog('info', logParts.join(' '));

    // ═══ Clear RAG cache + live schema context for fresh card ═══
    clearRAGCache();
    store.clearLiveSchemaContext();
    if (store.translationConfig.enableRAGContext) {
      store.addLog('info', '🧠 Cross-field Context RAG enabled — each field will receive context from related translated fields');
    }

    // ═══ Auto-detect MVU card + suggest enabling sync ═══
    if (store.card && !store.translationConfig.enableMvuSync) {
      const mvuSummary = getMvuCardSummary(store.card);
      if (mvuSummary.isMvu) {
        store.addToast('info', `🔧 MVU card detected (${mvuSummary.reasons.join(', ')}). Consider enabling Strategy B for variable sync.`);
        store.addLog('info', `🔍 MVU card auto-detected: confidence=${(mvuSummary.confidence * 100).toFixed(0)}%, vars=${mvuSummary.variableCount}, initvar=${mvuSummary.initvarCount}`);
      }
    }

    // ═══ Auto-populate MVU Dictionary (Strategy B) ═══
    if (store.translationConfig.enableMvuSync && store.card) {
      try {
        store.addLog('info', '🔧 Strategy B: Auto-detecting MVU/Zod variables...');
        const extractedKeys = extractPotentialMvuKeyStrings(store.card);
        
        if (extractedKeys.length > 0) {
          // Filter out keys already in dictionary
          const existingDict = store.translationConfig.mvuDictionary;
          const newKeys = extractedKeys.filter(k => !(k in existingDict));
          
          store.addLog('info', `Found ${extractedKeys.length} variables (${newKeys.length} new, ${extractedKeys.length - newKeys.length} already mapped)`);
          
          if (newKeys.length > 0) {
            store.addLog('active', `🤖 Calling AI to translate ${newKeys.length} variable names...`);
            
            // Provide schema context + Zod descriptions for better AI translation
            let schemaContext = store.translationConfig.customSchema || '';
            if (!schemaContext.trim() && store.card?.data?.extensions?.tavern_helper?.scripts) {
              schemaContext = store.card.data.extensions.tavern_helper.scripts.map(s => s.content).join('\n\n');
            }

            // Extract .describe() annotations for richer context
            let keyDescriptions: Record<string, string> = {};
            if (schemaContext) {
              keyDescriptions = extractZodDescriptions(schemaContext);
            }

            const aiTranslations = await aiTranslateMvuKeys(
              newKeys,
              store.translationConfig.targetLanguage,
              store.proxy,
              abortRef.current?.signal,
              schemaContext,
              keyDescriptions
            );
            
            // Merge AI translations into dictionary (only non-empty, non-identical)
            const mergedDict = { ...existingDict };
            let addedCount = 0;
            for (const [k, v] of Object.entries(aiTranslations)) {
              if (v && v.trim() && k !== v && !(k in mergedDict)) {
                mergedDict[k] = v;
                addedCount++;
              }
            }
            
            if (addedCount > 0) {
              store.setTranslationConfig({ mvuDictionary: mergedDict });
              store.addLog('success', `✅ Auto-added ${addedCount} variable translations to MVU Dictionary`);
            } else {
              store.addLog('info', 'All variables are already ASCII or mapped — no AI translation needed');
            }
          }
        } else {
          store.addLog('info', 'No MVU/Zod variables detected in this card');
        }
      } catch (mvuErr) {
        const mvuMsg = mvuErr instanceof Error ? mvuErr.message : String(mvuErr);
        if (mvuMsg === 'Cancelled' || checkAbort()) {
          store.setPhase('cancelled');
          return;
        }
        store.addLog('warning', `⚠️ MVU auto-detect failed (non-critical): ${mvuMsg}`);
      }
    }

    // ═══ Reorder fields for Strategy B (MVU-optimized) ═══
    // Khi bật MVU Sync, thứ tự dịch tối ưu:
    // 1. tavern_helper → Zod schema, JS logic (quan trọng nhất — thiết lập biến MVU)
    // 2. lorebook → initvar, mvu_update, rules (tham chiếu biến)
    // 3. lorebook_keys → keywords
    // 4. regex → HTML dashboard UI (sử dụng biến đã dịch)
    // 5. system → OP/system prompt (ngữ cảnh tổng quát)
    // 6. core (name, description) → thông tin nhân vật
    // 7. messages → dialogue examples
    // 8. depth_prompt, creator → phụ trợ
    if (store.translationConfig.enableMvuSync) {
      const MVU_GROUP_ORDER: Record<string, number> = {
        tavern_helper: 0,
        lorebook: 1,
        lorebook_keys: 2,
        regex: 3,
        system: 4,
        core: 5,
        messages: 6,
        depth_prompt: 7,
        creator: 8,
      };
      fields.sort((a, b) => {
        const orderA = MVU_GROUP_ORDER[a.group] ?? 99;
        const orderB = MVU_GROUP_ORDER[b.group] ?? 99;
        return orderA - orderB;
      });
      store.addLog('info', '📋 Strategy B: Reordered fields → schema → lorebook → regex → OP → rest');
    }

    const isBatchLorebook = store.translationConfig.lorebookStrategy === 'batch';
    const batchSize = store.translationConfig.lorebookBatchSize || 20;
    const lorebookGroups: FieldGroup[] = ['lorebook', 'lorebook_keys'];

    let i = 0;
    while (i < fields.length) {
      // Check abort
      if (checkAbort()) {
        store.setPhase('cancelled');
        store.addLog('warning', 'Translation cancelled by user');
        return;
      }

      // Handle pause
      if (await waitForPause()) {
        store.setPhase('cancelled');
        return;
      }

      const field = fields[i];

      // ─── Batch mode for lorebook fields ───
      if (isBatchLorebook && lorebookGroups.includes(field.group)) {
        const concurrency = store.translationConfig.concurrentBatches || 1;
        const MAX_BATCH_CHARS = Math.max(store.proxy.maxTokens || 65536, 10000);
        const isMvuEnabled = store.translationConfig.enableMvuSync;

        // Step 1: Collect ALL consecutive lorebook fields
        const allLorebookFields: TranslationField[] = [];
        while (i < fields.length && lorebookGroups.includes(fields[i].group)) {
          allLorebookFields.push(fields[i]);
          i++;
        }

        // Step 2: Split into sub-batches
        const subBatches: TranslationField[][] = [];

        if (isMvuEnabled) {
          // ═══ MVU Smart Grouping: group by entryType first, then split ═══
          // This ensures initvar entries batch together (YAML format),
          // mvu_logic entries batch together (code), and narrative batches separately
          const typeGroups: Record<string, TranslationField[]> = {};
          for (const f of allLorebookFields) {
            const typeKey = f.entryType || 'other';
            if (!typeGroups[typeKey]) typeGroups[typeKey] = [];
            typeGroups[typeKey].push(f);
          }

          // Process each type group with appropriate batch sizes
          const TYPE_BATCH_SIZES: Record<string, number> = {
            initvar: batchSize,          // YAML: normal size
            mvu_logic: Math.min(batchSize, 5),  // Code: smaller batches (complex, longer)
            controller: Math.min(batchSize, 5), // Code: smaller batches
            rules: batchSize,            // Rules: normal size
            narrative: batchSize,        // Narrative: normal size
            other: batchSize,            // Default: normal size
          };

          // Order: initvar first (schema variables), then logic, then rest
          const typeOrder = ['initvar', 'controller', 'mvu_logic', 'rules', 'narrative', 'other'];
          const sortedTypes = Object.keys(typeGroups).sort((a, b) => {
            const ia = typeOrder.indexOf(a);
            const ib = typeOrder.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          });

          for (const typeKey of sortedTypes) {
            const typeFields = typeGroups[typeKey];
            const typeBatchSize = TYPE_BATCH_SIZES[typeKey] || batchSize;
            let currentBatch: TranslationField[] = [];
            let currentChars = 0;

            for (const f of typeFields) {
              if (currentBatch.length >= typeBatchSize || (currentBatch.length > 0 && currentChars + f.original.length > MAX_BATCH_CHARS)) {
                subBatches.push(currentBatch);
                currentBatch = [];
                currentChars = 0;
              }
              currentBatch.push(f);
              currentChars += f.original.length;
            }
            if (currentBatch.length > 0) subBatches.push(currentBatch);
          }

          // Log MVU grouping detail
          const groupSummary = sortedTypes
            .map(t => `${t}:${typeGroups[t].length}`)
            .join(', ');
          store.addLog('info', `🔧 MVU batch grouping: ${allLorebookFields.length} fields → [${groupSummary}] → ${subBatches.length} batch(es)`);

        } else {
          // ═══ Standard splitting: by batchSize + char limit ═══
          let currentBatch: TranslationField[] = [];
          let currentChars = 0;
          for (const f of allLorebookFields) {
            if (currentBatch.length >= batchSize || (currentBatch.length > 0 && currentChars + f.original.length > MAX_BATCH_CHARS)) {
              subBatches.push(currentBatch);
              currentBatch = [];
              currentChars = 0;
            }
            currentBatch.push(f);
            currentChars += f.original.length;
          }
          if (currentBatch.length > 0) subBatches.push(currentBatch);
          store.addLog('info', `${allLorebookFields.length} lorebook fields → ${subBatches.length} batch(es), concurrency: ${concurrency}`);
        }

        store.setCurrentFieldIndex(i - 1);

        // Step 3: Dispatch sub-batches with concurrency limit (sliding window)
        let batchIdx = 0;
        while (batchIdx < subBatches.length) {
          if (checkAbort()) {
            store.setPhase('cancelled');
            store.addLog('warning', 'Translation cancelled');
            return;
          }

          // Take up to `concurrency` batches
          const window = subBatches.slice(batchIdx, batchIdx + concurrency);
          batchIdx += window.length;

          try {
            const results = await Promise.allSettled(
              window.map(batch => translateOneBatch(batch))
            );

            for (const r of results) {
              if (r.status === 'rejected') {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                if (msg === 'Cancelled' || checkAbort()) {
                  store.setPhase('cancelled');
                  store.addLog('warning', 'Translation cancelled');
                  return;
                }
              }
            }
          } catch {
            store.setPhase('cancelled');
            store.addLog('warning', 'Translation cancelled');
            return;
          }

          // Delay between batch windows
          if (batchIdx < subBatches.length && store.proxy.requestDelay > 0) {
            await new Promise((r) => setTimeout(r, store.proxy.requestDelay));
          }

          // Auto-save cache after each batch window
          store.saveTranslationCache();
        }

        // Delay before next non-lorebook field
        if (i < fields.length && store.proxy.requestDelay > 0) {
          await new Promise((r) => setTimeout(r, store.proxy.requestDelay));
        }
        continue;
      }

      // ─── Single field mode ───
      try {
        const result = await translateSingleField(field, i, fields);
        if (result === 'retry') {
          continue; // Don't increment i
        }

        // ═══ Live Schema Injection: capture translated TavernHelper as schema context ═══
        if (field.group === 'tavern_helper' && result === 'done') {
          const currentSchema = store.translationConfig.customSchema;
          // Only inject if user hasn't already set a custom schema
          if (!currentSchema?.trim()) {
            const allTranslatedSchemas = useStore.getState().fields
              .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated)
              .map(f => f.translated)
              .join('\n\n');
            if (allTranslatedSchemas.trim()) {
              store.setLiveSchemaContext(allTranslatedSchemas);
              store.addLog('info', '📋 Live Schema: captured translated TavernHelper → context for remaining fields');
            }
          }
        }
      } catch {
        // Cancel was thrown
        store.setPhase('cancelled');
        store.addLog('warning', 'Translation cancelled');
        return;
      }

      i++;

      // Auto-save translation cache every 10 fields
      if (i % 10 === 0) store.saveTranslationCache();

      // Delay between requests
      if (i < fields.length && store.proxy.requestDelay > 0) {
        await new Promise((r) => setTimeout(r, store.proxy.requestDelay));
      }
    }

    store.setPhase('done');
    store.saveTranslationCache();
    const doneCount = store.fields.filter((f) => f.status === 'done').length;
    const failCount = store.fields.filter((f) => f.status === 'error').length;
    store.addLog('info', `Translation complete: ${doneCount} done, ${failCount} failed`);
    store.addToast('success', `Translation complete! ${doneCount}/${fields.length} fields translated`);

    // ═══ Post-Translation MVU-ZOD Sync Verification Report ═══
    if (store.translationConfig.enableMvuSync && Object.keys(store.translationConfig.mvuDictionary).length > 0) {
      const syncReport = generateSyncReport(
        store.fields.filter(f => f.status === 'done').map(f => ({
          original: f.original,
          translated: f.translated,
          label: f.label,
          group: f.group,
          entryType: f.entryType,
        })),
        store.translationConfig.mvuDictionary
      );
      
      const missingVars = syncReport.unreplaced;
      if (missingVars === 0) {
        store.addLog('success', `✅ MVU Sync: All ${syncReport.totalVars} variables correctly replaced!`);
      } else {
        store.addLog('warning', `⚠️ MVU Sync: ${missingVars} variables were NOT replaced! Check Verify panel for details.`);
        for (const detail of syncReport.details) {
           store.addLog('error', detail);
        }
      }
      for (const warning of syncReport.warnings) {
         store.addLog('warning', warning);
      }
    }

    // ═══ Post-Translation Entry Name ↔ Text Sync Verification ═══
    {
      const doneFields = store.fields.filter(f => f.status === 'done');
      const entryNameResult = validateEntryNameSync(doneFields.map(f => ({
        path: f.path,
        label: f.label,
        group: f.group,
        original: f.original,
        translated: f.translated,
        status: f.status,
      })));

      if (entryNameResult.matchedNames.length > 0 || entryNameResult.missingNames.length > 0) {
        if (entryNameResult.valid) {
          store.addLog('success', `✅ EJS Sync: All ${entryNameResult.matchedNames.length} entry names correctly synchronized in text!`);
        } else {
          store.addLog('warning', `⚠️ EJS Sync: ${entryNameResult.missingNames.length} entry name(s) NOT found in translated text — EJS auto-trigger will fail!`);
          for (const m of entryNameResult.missingNames.slice(0, 5)) {
            store.addLog('error', `  Entry "${m.originalName}" → "${m.translatedName}" missing in text (was in: ${m.appearedInOriginal})`);
          }
          if (entryNameResult.suggestions.length > 0) {
            for (const s of entryNameResult.suggestions.slice(0, 3)) {
              store.addLog('info', `  💡 "${s.missingName}": ${s.closest}`);
            }
          }
        }
      }
    }
  }, [prepareFields, store]);

  const pauseTranslation = useCallback(() => {
    pauseRef.current = true;
    store.setPhase('paused');
    store.saveTranslationCache();
    store.addLog('warning', 'Translation paused');
  }, [store]);

  const resumeTranslation = useCallback(() => {
    pauseRef.current = false;
    store.setPhase('translating');
    store.addLog('info', 'Translation resumed');
  }, [store]);

  const cancelTranslation = useCallback(() => {
    abortRef.current?.abort();
    pauseRef.current = false;
    store.setPhase('cancelled');
  }, [store]);

  const retranslateField = useCallback(async (path: string) => {
    const field = store.fields.find((f) => f.path === path);
    if (!field) return;

    const controller = new AbortController();
    store.updateField(path, { status: 'translating', error: undefined });
    store.addLog('active', `Re-translating: ${field.label}`);

    try {
      // Contextual keyword translation for retranslate
      let contextHint: string | undefined;
      if (field.group === 'lorebook_keys') {
        const contentPath = field.path.replace('.keys', '.content').replace('.secondary_keys', '.content');
        const contentField = store.fields.find(f => f.path === contentPath);
        if (contentField) {
          contextHint = (contentField.translated || contentField.original || '').slice(0, 1500);
        }
      }

      // ═══ Centralized prompt building (single source of truth) ═══
      // Build entry name dictionary from already-translated lorebook name fields
      const retranslateEntryNameDict = buildEntryNameDictionary(store.fields);

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: store.translationConfig.enableObjectiveMode,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field,
        allFields: store.fields,
        mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
        glossary: store.translationConfig.glossary,
        customSchema: store.translationConfig.customSchema,
        liveSchemaContext: store.liveSchemaContext,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(retranslateEntryNameDict).length > 0 ? retranslateEntryNameDict : undefined,
        expertMode: store.proxy.expertMode,
      });

      const resolvedFieldType = fieldGroupToFieldType(field.group, field.entryType);
      const currentMvuDict = store.translationConfig.enableMvuSync
        ? useStore.getState().translationConfig.mvuDictionary
        : undefined;

      let translated = await translateText(
        field.original,
        field.label,
        store.proxy,
        store.translationConfig.targetLanguage,
        store.translationConfig.sourceLanguage,
        promptResult.effectivePrompt,
        promptResult.schemaForApi,
        controller.signal,
        contextHint,
        promptResult.glossaryForApi,
        field.previousTranslation,
        resolvedFieldType,
        currentMvuDict,
        store.translationConfig.chunkSize
      );

      // Post-process regex HTML: font swap + underscore display
      const isRegexContent = field.group === 'regex' && (field.path.includes('replaceString') || field.path.includes('trimStrings'));
      if (isRegexContent && translated) {
        translated = postProcessRegexHtml(translated);
      }
      // Post-process TavernHelper content that contains HTML
      if (field.group === 'tavern_helper' && translated && /<[a-z][^>]*>/i.test(translated)) {
        translated = postProcessRegexHtml(translated);
      }

      store.updateField(path, { status: 'done', translated });
      store.addLog('success', `Re-translated: ${field.label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.updateField(path, { status: 'error', error: msg });
      store.addLog('error', `Re-translate failed: ${field.label} — ${msg}`);
    }
  }, [store]);

  const getExportCard = useCallback(() => {
    if (!store.card) return null;
    let exportCard = applyTranslationsToCard(store.card, store.fields, store.translationConfig.exportKeyMode);
    
    if (store.translationConfig.enableMvuSync && Object.keys(store.translationConfig.mvuDictionary).length > 0) {
      const enabledGroups = store.translationConfig.fieldGroups
        .filter((g: FieldGroupConfig) => g.enabled)
        .map((g: FieldGroupConfig) => g.id);
      exportCard = syncMvuVariables(exportCard, store.translationConfig.mvuDictionary, enabledGroups);
    }
    
    return exportCard;
  }, [store]);

  /** Continue translation — merge with existing done fields, only translate pending/error */
  const continueTranslation = useCallback(async () => {
    await startTranslation(true);
  }, [startTranslation]);

  /** Retry all fields that are in 'error' status */
  const retryAllErrors = useCallback(async () => {
    const errorFields = store.fields.filter(f => f.status === 'error');
    if (errorFields.length === 0) {
      store.addToast('info', 'No error fields to retry');
      return;
    }

    store.addLog('info', `♻️ Retrying ${errorFields.length} failed field(s)...`);
    let successCount = 0;
    let failCount = 0;

    for (const field of errorFields) {
      try {
        store.updateField(field.path, { status: 'translating', error: undefined });

        // Build context hint for lorebook keys
        let contextHint: string | undefined;
        if (field.group === 'lorebook_keys') {
          const contentPath = field.path.replace('.keys', '.content');
          const contentField = store.fields.find(f => f.path === contentPath);
          if (contentField) {
            contextHint = (contentField.translated || contentField.original || '').slice(0, 1500);
          }
        }

        const translated = await translateText(
          field.original,
          field.label,
          store.proxy,
          store.translationConfig.targetLanguage,
          store.translationConfig.sourceLanguage,
          store.translationConfig.translationPrompt,
          store.translationConfig.customSchema,
          undefined,
          contextHint,
          store.translationConfig.glossary,
          field.previousTranslation,
          undefined,
          undefined,
          store.translationConfig.chunkSize
        );

        store.updateField(field.path, { status: 'done', translated, retries: field.retries + 1 });
        store.addLog('success', `✓ Retry OK: ${field.label}`);
        successCount++;

        // Delay between retries
        if (store.proxy.requestDelay > 0) {
          await new Promise(r => setTimeout(r, store.proxy.requestDelay));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store.updateField(field.path, { status: 'error', error: msg, retries: field.retries + 1 });
        store.addLog('error', `✗ Retry failed: ${field.label} — ${msg}`);
        failCount++;
      }
    }

    store.saveTranslationCache();
    store.addLog('info', `Retry complete: ${successCount} fixed, ${failCount} still failing`);
    store.addToast(failCount === 0 ? 'success' : 'error', `Retry: ${successCount}/${errorFields.length} fixed`);
  }, [store]);

  return {
    prepareFields,
    startTranslation,
    continueTranslation,
    pauseTranslation,
    resumeTranslation,
    cancelTranslation,
    retranslateField,
    retryAllErrors,
    getExportCard,
  };
}
