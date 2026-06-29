import { useCallback, useRef } from 'react';
import { useStore } from '../store';
import { translateText, translateBatch, fieldGroupToFieldType, generateLorebookEntries, ChunkError } from '../utils/apiClient';
import { extractTranslatableFields, applyTranslationsToCard, autoTranslateLorebookTriggerKeys, injectNewLorebookEntries } from '../utils/cardFields';
import { syncMvuVariables, postProcessRegexHtml, normalizeSmartQuotesInCode, fixBrokenLodashPaths, fixDotNotationPaths, extractPotentialMvuKeyStrings, aiTranslateMvuKeys, aiRenameMvuKeys, extractZodDescriptions, extractSchemaContextFromCard, extractMappingFromTranslatedSchemas, enforceInitvarCovariance, extractMappingFromTranslatedInitvar, enforceExactConsistency, enforceVariableCasing, fixZodSyntaxErrors, validateDictionaryConflicts, aiResolveMvuConflicts } from '../utils/mvuSync';
import { shouldSkipTranslation, detectLanguage } from '../utils/langDetect';
import { clearRAGCache } from '../utils/ragContext';
import { storeTranslation, lookupTranslationMemory } from '../utils/translationMemory';
import { getMvuCardSummary } from '../utils/mvuDetector';
import { validateMvuVariables, autoFixMvuVariables, generateSyncReport, buildEntryNameDictionary, buildRegexTriggerDictionary, validateEntryNameSync } from '../utils/mvuValidator';
import { buildEffectivePrompt } from '../utils/promptBuilder';
import { surgicalTranslate } from '../utils/surgical';
import { parsePatchOutput, applyPatches, validatePatchResult } from '../utils/patchEngine';
import { injectMvuZodSystem } from '../utils/mvuGenerator';
import { detectEjsCard, extractEjsEntryNames, extractEjsKeywords, aiTranslateEjsEntries, validateEjsSync, autoFixEjsEntryNames, autoFixEjsKeywords, enforceEjsEntryName, enforceEjsCovariance, enforceEjsKeywordCasing, autoFixEjsKeywordsExtended } from '../utils/ejsSync';
import { getActivePresetPromptContent } from '../utils/presetParser';
import { CallMonitor } from '../utils/callMonitor';
import type { FieldGroup, FieldGroupConfig, TranslationField } from '../types/card';

/**
 * An entry longer than this (in characters) is "too long" to translate safely inside a
 * multi-item batch — `translateBatch` sends a multi-item batch as ONE un-chunked API call,
 * so a long entry makes the whole call take many minutes and risks truncation/timeout.
 * Such entries are isolated into their own batch and routed through `translateSingleField`,
 * which splits them into ~12K-char chunks (with resume support) — far more reliable.
 * Matches `chunkText`'s 12K hard cap in apiClient.ts (with margin so we only isolate
 * entries that genuinely span multiple chunks, keeping normal entries batched for speed).
 */
const LONG_ENTRY_ISOLATE_CHARS = 16000;

/**
 * Strip URL/link content from text before CJK residual detection.
 * Prevents false-positive retries when URLs intentionally contain CJK characters
 * (e.g., import('https://cdn.com/骰子系统/stable.js') should NOT trigger retry).
 */
function stripUrlsForCjkCheck(text: string): string {
  let s = text;
  s = s.replace(/(?:https?|ftp):\/\/[^\s'"<>(){}\\]+|\/\/[a-zA-Z0-9][^\s'"<>(){}\\]*/gi, '');
  s = s.replace(/(?:src|href|action|data-src|data-href|poster|srcset)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  s = s.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)/gi, '');
  s = s.replace(/(?:import|require)\s*\(\s*(?:[`'"][^`'"]*[`'"]|`[^`]*`)\s*\)/gi, '');
  s = s.replace(/data:[a-zA-Z0-9+/.-]+;[^\s'"<>)]+/gi, '');
  s = s.replace(/(?:\.\.?\/)[^\s'"<>(){}\\]+/g, '');
  s = s.replace(/(!?\[[^\]]*\])\([^)]+\)/g, '$1()');
  return s;
}


/**
 * Bake modded/translated fields into the card and update field originals.
 * After this, store.card reflects the latest modded state, and each
 * completed field's `original` becomes its modded value (translated cleared).
 * This ensures subsequent mod operations scan the updated card as the base.
 */
/**
 * Sort fields to enforce Multi-Pass Covariant Translation.
 * Precedence: Phase 1 (Technical: Schema/Initvars) -> Phase 2 (Interaction: Regex/Keys) -> Phase 3 (Narrative & Prose)
 */
function sortFieldsForCovariance(fields: TranslationField[], enableMvuSync: boolean) {
  const getFieldPhase = (f: TranslationField): number => {
    // Phase 1: Technical Infrastructure (Zod schema & initvars)
    if (f.group === 'tavern_helper' || f.entryType === 'initvar') {
      return 1;
    }
    // Phase 2: Interaction Logic (Regex & Lorebook Keys)
    if (f.group === 'regex' || f.group === 'lorebook_keys') {
      return 2;
    }
    // Phase 3: Narrative, Greetings & Prose
    return 3;
  };

  const MVU_GROUP_ORDER: Record<string, number> = {
    tavern_helper: 0,
    lorebook: 1,
    lorebook_keys: 2,
    regex: 3,
    core: 4,
    messages: 5,
    system: 6,
    depth_prompt: 7,
    creator: 8
  };

  const TYPE_ORDER: Record<string, number> = {
    initvar: 0,
    controller: 1,
    mvu_logic: 2,
    rules: 3,
    narrative: 4,
    other: 5
  };

  fields.sort((a, b) => {
    const phaseA = getFieldPhase(a);
    const phaseB = getFieldPhase(b);
    if (phaseA !== phaseB) return phaseA - phaseB;

    const orderA = MVU_GROUP_ORDER[a.group] ?? 99;
    const orderB = MVU_GROUP_ORDER[b.group] ?? 99;
    if (orderA !== orderB) return orderA - orderB;

    if (a.group === 'lorebook' || a.group === 'lorebook_keys') {
      const tA = TYPE_ORDER[a.entryType || 'other'] ?? 99;
      const tB = TYPE_ORDER[b.entryType || 'other'] ?? 99;
      if (tA !== tB) return tA - tB;
    }
    return 0;
  });
}

function bakeModdedFieldsIntoCard() {
  const state = useStore.getState();
  const currentFields = state.fields;
  const currentCard = state.card;
  if (!currentCard) return;

  const doneFields = currentFields.filter(f => f.status === 'done' && f.translated);
  if (doneFields.length === 0) return;

  // Apply all modded translations to get the updated card
  const updatedCard = applyTranslationsToCard(currentCard, currentFields, 'merge');

  // Update store.card to the new base
  state.updateCard(updatedCard);

  // Update each done field: original = translated (new base), clear translated
  for (const field of doneFields) {
    state.updateField(field.path, {
      original: field.translated,
      translated: '',
      status: 'pending',
    });
  }

  state.addLog('info', `📌 Baked ${doneFields.length} modded field(s) into card — new base state set`);
}

export function useTranslation() {
  const store = useStore();
  const abortRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);
  // Track whether the main translation loop is actively running
  const runningRef = useRef(false);
  // Per-field abort controllers: cancel previous in-flight translation for same field on retry
  const fieldAbortMap = useRef<Map<string, AbortController>>(new Map());

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
    if (store.fields.length > 0) {
      // ALWAYS merge: preserve fields already done/skipped/ignored from store.
      // This respects manual per-field translations AND continue-mode resumptions.
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

    sortFieldsForCovariance(mergedFields, Boolean(store.translationConfig.enableMvuSync));

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
    const currentMaxTokens = store.proxy.maxTokens;
    const currentChunkSize = store.translationConfig.chunkSize;
    // Adaptive CHUNK_THRESHOLD: regex/code-heavy fields cần chunk nhỏ hơn
    // vì AI output limit không đủ cho 100K chars code 1:1
    const isRegexOrCodeField = field.group === 'regex' || field.group === 'tavern_helper';
    let CHUNK_THRESHOLD: number;
    if (currentChunkSize && currentChunkSize >= 100) {
      CHUNK_THRESHOLD = currentChunkSize;
    } else if (isRegexOrCodeField) {
      // Regex/TavernHelper: chunk nhỏ hơn vì nội dung code-heavy
      CHUNK_THRESHOLD = currentMaxTokens && currentMaxTokens > 0
        ? Math.min(Math.floor(currentMaxTokens * 2), 50000)
        : 30000;
    } else {
      CHUNK_THRESHOLD = currentMaxTokens && currentMaxTokens > 0
        ? Math.min(Math.floor(currentMaxTokens * 3.5), 200000)
        : 100000;
    }
      
    const targetModel = store.translationConfig.enableModelRouting
      ? (store.translationConfig.entryModelRouting[field.path] || store.translationConfig.groupModelRouting[field.group] || store.proxy.model)
      : store.proxy.model;
    // Threshold routing: fields shorter than threshold → secondary model directly (speed)
    const resolvedModel = (
      store.proxy.enableSecondaryModel &&
      store.proxy.secondaryModel?.trim() &&
      (store.proxy.secondaryModelThreshold ?? 0) > 0 &&
      charCount <= store.proxy.secondaryModelThreshold
    ) ? store.proxy.secondaryModel : targetModel;
    const effectiveProxy = resolvedModel !== store.proxy.model ? { ...store.proxy, model: resolvedModel } : store.proxy;

    if (charCount > CHUNK_THRESHOLD) {
      const estimatedChunks = Math.ceil(charCount / CHUNK_THRESHOLD);
      store.addLog('active', `Translating: ${field.label} (${charCount.toLocaleString()} chars → ~${estimatedChunks} chunks 🔗sequential)${targetModel !== store.proxy.model ? ` [Model: ${targetModel}]` : ''}`);
    } else {
      store.addLog('active', `Translating: ${field.label} (${charCount.toLocaleString()} chars)${targetModel !== store.proxy.model ? ` [Model: ${targetModel}]` : ''}`);
    }

    // IMPORTANT: read fresh retries from store (not stale `field` parameter) to prevent infinite retry loops
    const freshRetries = () => useStore.getState().fields.find(f => f.path === field.path)?.retries || 0;

    try {
      // Contextual keyword translation: for lorebook keys, find the already-translated content
      // IMPORTANT: Read from store (not stale `fields` snapshot) to get fresh translated content
      let contextHint: string | undefined;
      if (field.group === 'lorebook_keys') {
        const contentPath = field.path.replace('.keys', '.content').replace('.secondary_keys', '.content');
        const contentField = useStore.getState().fields.find(f => f.path === contentPath);
        if (contentField) {
          // Use translated content if available, else original (truncated to save tokens)
          const ctx = contentField.translated || contentField.original || '';
          contextHint = ctx.slice(0, 1500);
        }
      }

      // ═══ Absolute Priority User Prompts ═══
      const userPrompts: string[] = [];
      if (store.translationConfig.translationPrompt?.trim()) {
        userPrompts.push(store.translationConfig.translationPrompt.trim());
      }
      if (store.translationConfig.surgicalPrompt?.trim() && (field.group === 'regex' || field.group === 'tavern_helper')) {
        userPrompts.push(store.translationConfig.surgicalPrompt.trim());
      }
      const userPriorityPrompt = userPrompts.length > 0 ? userPrompts.join('\n\n---\n\n') : undefined;

      // ═══ Centralized prompt building (single source of truth) ═══
      // Build entry name dictionary from already-translated lorebook name fields
      // IMPORTANT: Read fresh fields from store (not stale `fields` snapshot which only has pending/error)
      // so we can see tavern_helper/lorebook fields that have already been translated to status='done'.
      const freshFields = useStore.getState().fields;
      const entryNameDict = { ...buildEntryNameDictionary(freshFields), ...buildRegexTriggerDictionary(freshFields) };

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: store.translationConfig.enableObjectiveMode,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field,
        allFields: freshFields,
        mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
        glossary: store.translationConfig.glossary,
        customSchema: store.translationConfig.customSchema,
        liveSchemaContext: store.liveSchemaContext,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(entryNameDict).length > 0 ? entryNameDict : undefined,
        expertMode: effectiveProxy.expertMode,
        enableModMode: store.translationConfig.enableModMode,
        modInstructions: store.translationConfig.modInstructions,
      
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        // Translation Memory hits (cross-session)
        translationMemoryHits: store.translationConfig.enableTranslationMemory
          ? await lookupTranslationMemory(field).catch(() => [])
          : undefined,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });

      // ═══ Determine field type for Master Prompt (expert mode) ═══
      const resolvedFieldType = fieldGroupToFieldType(field.group, field.entryType);
      const currentMvuDict = store.translationConfig.enableMvuSync
        ? useStore.getState().translationConfig.mvuDictionary
        : undefined;

      let translated = '';
      let usedSurgical = false;
      let surgicalFallback = false;

      const isEligibleForSurgical = (() => {
        if (!store.translationConfig.surgicalMode) return false;
        if (field.group === 'regex' || field.group === 'tavern_helper') return true;
        if (field.group === 'lorebook') {
          if (field.entryType === 'initvar' || field.entryType === 'controller' || field.entryType === 'mvu_logic') {
            return true;
          }
        }
        const text = field.original;
        if (text.includes('<%') && text.includes('%>')) return true;
        if (/<script[\s\S]*?>/i.test(text)) return true;
        if (/<style[\s\S]*?>/i.test(text)) return true;
        if (text.includes('```')) return true;
        return false;
      })();

      if (isEligibleForSurgical) {
        usedSurgical = true;
        store.addLog('active', `🔪 Initiating Surgical Translation for ${field.label}...`);
        const sResult = await surgicalTranslate(
          field.original,
          effectiveProxy,
          store.translationConfig.targetLanguage,
          abortRef.current?.signal,
          store.translationConfig.glossary,
          currentMvuDict,
          true,
          undefined,
          'preserve',
          store.translationConfig.customSchema,
          promptResult.effectivePrompt,
          field.label
        );
        translated = sResult.translated;
        
        if (sResult.success) {
          store.updateField(field.path, { 
            surgicalResult: { type: 'success', info: 'Successfully extracted and reinserted CJK without touching code structure.' } 
          });
        } else {
          surgicalFallback = true;
          store.updateField(field.path, { 
            surgicalResult: { type: 'fallback', info: 'Structural verification failed. Falling back to standard translation.' } 
          });
          store.addLog('warning', `Surgical verification failed for ${field.label}. Falling back to standard translation.`);
        }
      }

      if (!isEligibleForSurgical || surgicalFallback) {
        // ═══ Chunk-level resume: pass previously completed chunks + progress callback ═══
        const freshField = useStore.getState().fields.find(f => f.path === field.path) || field;
        const prevChunks = freshField.completedChunks && freshField.completedChunks.length > 0
          ? freshField.completedChunks
          : undefined;

        if (prevChunks) {
          const filledCount = prevChunks.filter(c => c && c.length > 0).length;
          store.addLog('info', `🔄 Resuming ${field.label}: ${filledCount} chunks cached`);
        }

        translated = await translateText(
          field.original,
          field.label,
          effectiveProxy,
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
          store.translationConfig.chunkSize,
          prevChunks,
          // onChunkComplete: save chunk progress in real-time (supports out-of-order for parallel)
          (chunkIdx, translatedChunk, totalChunks) => {
            const currentField = useStore.getState().fields.find(f => f.path === field.path);
            const currentCompleted = currentField?.completedChunks || [];
            // Index-based storage: safe for both sequential and parallel
            const updatedChunks = [...currentCompleted];
            // Extend array if needed (parallel may complete out-of-order)
            while (updatedChunks.length <= chunkIdx) updatedChunks.push('');
            updatedChunks[chunkIdx] = translatedChunk;
            store.updateField(field.path, {
              completedChunks: updatedChunks,
              totalChunks,
            });
          },
          // parallelChunks
          store.translationConfig.parallelChunks,
          // enableChunkVerification
          store.translationConfig.enableChunkVerification,
          // onChunksReady
          (rawChunks) => {
            store.updateField(field.path, {
              rawChunks,
            });
          },
          // cssCjkHandling
          store.translationConfig.cssCjkHandling
        );
      }

      if (translated && field.group === 'tavern_helper') {
        const fixed = fixZodSyntaxErrors(translated);
        if (fixed !== translated) {
          translated = fixed;
          store.addLog('info', `🔧 Fixed Zod syntax errors in ${field.label}`);
        }
      }

      // ─── Post-single MVU variable validation + auto-fix ───
      const hasMvuDict = currentMvuDict && Object.keys(currentMvuDict).length > 0;
      if (hasMvuDict && translated) {
        const fieldType = (field.entryType || field.group) as any;
        const validation = validateMvuVariables(field.original, translated, currentMvuDict, fieldType);
        
        if (validation.unreplaced.length > 0) {
          const fixed = autoFixMvuVariables(translated, currentMvuDict, validation.unreplaced);
          if (fixed !== translated) {
            translated = fixed;
            store.addLog('info', `🔧 Auto-fixed ${validation.unreplaced.length} vars in ${field.label}`);
          }
        }

        // ─── COVARIANCE FIX: Enforce covariance across initvar, controller, mvu_logic, regex, tavern_helper, AND lorebook fields ───
        // Code-like entries: full fuzzy matching (typos in variable names cause real bugs)
        // Lorebook narrative entries: STRICT exact-only matching (prevents false positives
        // where Vietnamese proper nouns like dynasty/place names get fuzzy-matched to MVU vars)
        const isCodeLike = field.entryType === 'initvar' || field.entryType === 'controller' || field.entryType === 'mvu_logic' || field.group === 'regex' || field.group === 'tavern_helper';
        const isLorebookNarrative = field.group === 'lorebook' && !isCodeLike;
        const isCodeOrLogic = isCodeLike || isLorebookNarrative;
        if (isCodeOrLogic) {

          const covariance = enforceInitvarCovariance(translated, currentMvuDict, isLorebookNarrative);
          if (covariance.fixes.length > 0) {
            translated = covariance.text;
            const fixSummary = covariance.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
            store.addLog('info', `🔗 Covariance${isLorebookNarrative ? ' (strict)' : ''}: fixed ${covariance.fixes.length} key(s) in ${field.label}: ${fixSummary}`);
          }

          // ═══ PROGRESSIVE DICT: Extract new variable mappings from this just-translated entry ═══
          // Entries like initvar/controller may define variables NOT in the Zod schema.
          // By extracting mappings here, we ensure subsequent entries use the same translated names.
          if (field.entryType === 'initvar' || field.entryType === 'controller' || field.entryType === 'mvu_logic') {
            const entryMappings = extractMappingFromTranslatedInitvar([
              { original: field.original, translated, status: 'done', entryType: field.entryType }
            ]);
            const newMappingKeys = Object.keys(entryMappings);
            if (newMappingKeys.length > 0) {
              const freshDict = useStore.getState().translationConfig.mvuDictionary;
              const updatedDict = { ...freshDict };
              let addedCount = 0;
              const currentMetadata = { ...useStore.getState().mvuKeyMetadata };
              // Dedup check: skip entries whose translation already exists for a different source key
              const existingVals = new Set(Object.values(freshDict).map(v => v?.trim()).filter(Boolean));
              for (const [k, v] of Object.entries(entryMappings)) {
                if (v && v.trim()) {
                  const existingConf = currentMetadata[k]?.confidence;
                  if (existingConf === 'schema') {
                    continue; // Schema mapping overrides/takes priority
                  }
                  if (!(k in updatedDict)) {
                    if (existingVals.has(v.trim())) {
                      console.warn(`[MVU Progressive] Skipped duplicate: "${k}"→"${v}" (already exists for another key)`);
                      continue;
                    }
                    updatedDict[k] = v;
                    existingVals.add(v.trim());
                    addedCount++;
                    
                    if (!currentMetadata[k]) {
                      currentMetadata[k] = {
                        sources: [field.entryType || 'progressive'],
                        confidence: 'progressive',
                        occurrences: 1
                      };
                    } else {
                      currentMetadata[k] = {
                        ...currentMetadata[k],
                        confidence: 'progressive'
                      };
                    }
                  }
                }
              }
              if (addedCount > 0) {
                store.setMvuKeyMetadata(currentMetadata);
                // Enforce 100% exact consistency
                const { fixedDict, fixes } = enforceExactConsistency(updatedDict, currentMetadata);
                if (fixes.length > 0) {
                  store.setTranslationConfig({ mvuDictionary: fixedDict });
                  store.addLog('info', `🔒 Exact consistency: fixed ${fixes.length} case/spelling variations: ${fixes.join(', ')}`);
                } else {
                  store.setTranslationConfig({ mvuDictionary: updatedDict });
                }
                store.addLog('info', `🔗 Progressive: +${addedCount} entry-specific var(s) from ${field.label}`);
              }
            }
          }
        }
      }

      // ─── CASING FIX: Enforce variable casing for regex/lorebook/tavern_helper ───
      // AI often uses lowercase for variable names in regex/lorebook content even though
      // the schema uses Title Case. This post-processing step fixes the casing.
      if (hasMvuDict && translated && (field.group === 'regex' || field.group === 'lorebook' || field.group === 'tavern_helper')) {
        const casingResult = enforceVariableCasing(translated, currentMvuDict);
        if (casingResult.fixes.length > 0) {
          translated = casingResult.text;
          const fixSummary = casingResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
          store.addLog('info', `🔠 Casing: fixed ${casingResult.fixes.length} variable(s) in ${field.label}: ${fixSummary}`);
        }
      }

      // ─── EJS AUTO-FIX: Enforce EJS entry names & keywords (Strategy C) ───
      if (translated && store.translationConfig.enableEjsSync) {
        const ejsEntryDict = useStore.getState().translationConfig.ejsEntryNameDict;
        const ejsKwDict = useStore.getState().translationConfig.ejsKeywordDict;

        // Force lorebook entry name/comment to match EJS dict
        const isLorebookNameOrComment = field.group === 'lorebook' && (
          field.path.endsWith('.name') || field.path.endsWith('.comment')
        ) && field.path.includes('character_book.entries[');
        if (isLorebookNameOrComment && Object.keys(ejsEntryDict).length > 0) {
          const enforceResult = enforceEjsEntryName(field.original, translated, ejsEntryDict);
          if (enforceResult.forced) {
            store.addLog('info', `🔗 EJS Sync: Forced entry name "${field.original}" → "${enforceResult.text}" (was: "${translated}")`);
            translated = enforceResult.text;
          }
        }

        // Auto-fix getwi()/activewi() entry names
        if (Object.keys(ejsEntryDict).length > 0) {
          const entryFixResult = autoFixEjsEntryNames(translated, ejsEntryDict);
          if (entryFixResult.fixes.length > 0) {
            translated = entryFixResult.text;
            const fixSummary = entryFixResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
            store.addLog('info', `🔗 EJS EntryName: fixed ${entryFixResult.fixes.length} getwi/activewi call(s) in ${field.label}: ${fixSummary}`);
          }
        }

        // Auto-fix keywords inside <% %> EJS blocks
        if (Object.keys(ejsKwDict).length > 0) {
          const kwFixResult = autoFixEjsKeywords(translated, ejsKwDict);
          if (kwFixResult.fixes.length > 0) {
            translated = kwFixResult.text;
            const fixSummary = kwFixResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
            store.addLog('info', `🔗 EJS Keyword: fixed ${kwFixResult.fixes.length} keyword(s) in ${field.label}: ${fixSummary}`);
          }
        }

        // ─── EJS COVARIANCE: Full-context enforcement (Strategy C equivalent of Strategy B) ───
        // Enforce entry names + keywords across ALL code contexts (comparisons, bracket, attrs, CSS, script blocks)
        if (Object.keys(ejsEntryDict).length > 0 || Object.keys(ejsKwDict).length > 0) {
          const covResult = enforceEjsCovariance(translated, ejsEntryDict, ejsKwDict);
          if (covResult.fixes.length > 0) {
            translated = covResult.text;
            const fixSummary = covResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
            store.addLog('info', `🔗 EJS Covariance: fixed ${covResult.fixes.length} ref(s) in ${field.label}: ${fixSummary}`);
          }
        }

        // ─── EJS CASING: Fix case mismatches for keywords/entry names ───
        if (Object.keys(ejsEntryDict).length > 0 || Object.keys(ejsKwDict).length > 0) {
          const casingResult = enforceEjsKeywordCasing(translated, ejsEntryDict, ejsKwDict);
          if (casingResult.fixes.length > 0) {
            translated = casingResult.text;
            const fixSummary = casingResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
            store.addLog('info', `🔠 EJS Casing: fixed ${casingResult.fixes.length} casing(s) in ${field.label}: ${fixSummary}`);
          }
        }

        // ─── EJS EXTENDED: Fix keywords OUTSIDE <% %> blocks (HTML text, inline scripts) ───
        if (Object.keys(ejsKwDict).length > 0) {
          const extResult = autoFixEjsKeywordsExtended(translated, ejsKwDict);
          if (extResult.fixes.length > 0) {
            translated = extResult.text;
            const fixSummary = extResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
            store.addLog('info', `🔗 EJS Extended: fixed ${extResult.fixes.length} keyword(s) outside EJS blocks in ${field.label}: ${fixSummary}`);
          }
        }

        // ─── PROGRESSIVE EJS DICT: Extract new mappings from translated lorebook entry names ───
        const isLbNameOrComment = field.group === 'lorebook' && (
          field.path.endsWith('.name') || field.path.endsWith('.comment')
        ) && field.path.includes('character_book.entries[');
        if (isLbNameOrComment && translated && field.original !== translated) {
          const freshEjsDict = useStore.getState().translationConfig.ejsEntryNameDict;
          const trimOrig = field.original.trim();
          const trimTrans = translated.trim();
          if (trimOrig && trimTrans && !(trimOrig in freshEjsDict) && trimOrig !== trimTrans) {
            const updatedEjsDict = { ...freshEjsDict, [trimOrig]: trimTrans };
            store.setTranslationConfig({ ejsEntryNameDict: updatedEjsDict });
            store.addLog('info', `🔗 EJS Progressive: +1 entry name mapping "${trimOrig}" → "${trimTrans}"`);
          }
        }
      }

      // Post-process regex HTML: font swap + underscore display + lodash path fix
      const isRegexContent = field.group === 'regex' && (field.path.includes('replaceString') || field.path.includes('trimStrings'));
      if (isRegexContent && translated) {
        translated = postProcessRegexHtml(translated);
      }
      // Post-process TavernHelper content that contains HTML
      if (field.group === 'tavern_helper' && translated && /<[a-z][^>]*>/i.test(translated)) {
        translated = postProcessRegexHtml(translated);
      }
      // ─── SMART-QUOTE FIX for ALL code fields ───
      // Fixes the "lỗi dấu": AI emits “ ” ‘ ’ ＂ ＇ inside JS/HTML/regex, breaking the script.
      // Covers code paths that skip postProcessRegexHtml above (findRegex, scriptName,
      // external custom code, pure-JS TavernHelper). Idempotent if already normalized.
      if (translated && (field.group === 'regex' || field.group === 'tavern_helper')) {
        translated = normalizeSmartQuotesInCode(translated);
      }

      // ─── LODASH PATH FIX: Fix broken _.get/getvar paths for ALL code-containing fields ───
      // AI often breaks string paths by inserting newlines or using dot notation with spaced keys.
      // Apply to lorebook entries with EJS, initvar, controller, mvu_logic, and any field with _.get calls.
      if (translated && !isRegexContent && field.group !== 'tavern_helper') {
        const isCodeField = field.entryType === 'initvar' || field.entryType === 'controller' || field.entryType === 'mvu_logic' ||
          (field.group === 'lorebook' && (translated.includes('_.get') || translated.includes('_.set') || translated.includes('getvar')));
        if (isCodeField) {
          const beforeFix = translated;
          translated = fixBrokenLodashPaths(translated);
          translated = fixDotNotationPaths(translated);
          if (translated !== beforeFix) {
            store.addLog('info', `🔧 Fixed broken _.get/getvar paths in ${field.label}`);
          }
        }
      }

      // ═══ COMPLETENESS VALIDATION: detect genuinely truncated output ═══
      // CJK → Latin expansion means output is normally 1.3-2x LONGER than input.
      // Only flag as incomplete when output is very short (actual truncation), not ratio-based.
      if (translated && translated.trim() && field.original.length > 100) {
        const origLen = field.original.length;
        const transLen = translated.length;
        // Regex & TavernHelper: code structure must survive (minRatio = 0.6 of input)
        // Text thường: CJK→Latin expansion means output should be >= input, so only
        // flag if severely short (< 0.6x input = probably lost 40%+ content)
        const isCodeField = field.group === 'regex' || field.group === 'tavern_helper';
        const minRatio = isCodeField ? 0.5 : 0.6;
        
        if (transLen < origLen * minRatio) {
          if (freshRetries() < 1) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry', 
              `⚠️ Dịch thiếu nghiêm trọng: ${transLen}/${origLen} chars ` +
              `(${(transLen / origLen * 100).toFixed(0)}% < ${(minRatio * 100).toFixed(0)}%). Auto-retry...`
            );
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry';
          }
          store.addLog('warning', 
            `⚠️ Vẫn ngắn sau retry: ${transLen}/${origLen} chars ` +
            `(${(transLen / origLen * 100).toFixed(0)}%). Có thể thiếu nội dung.`
          );
        }
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

      // Schema CJK Validation: Ensure schema doesn't have any Chinese
      // Strip URLs before checking — CJK in URL paths (e.g. 骰子系统 in import paths) is intentional
      const isTargetNonCJK = !(/chinese|中文|japanese|日本語|korean|한국어/i.test(store.translationConfig.targetLanguage));
      const isSchemaCritical = field.entryType === 'initvar' || field.entryType === 'controller' || field.entryType === 'mvu_logic' || field.group === 'tavern_helper';
      if (isTargetNonCJK && isSchemaCritical) {
        const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/;
        const translatedStripped = stripUrlsForCjkCheck(translated);
        if (cjkRegex.test(translatedStripped)) {
          if (freshRetries() < (store.proxy.maxRetries || 3)) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry', `⚠️ Chinese characters detected in Schema (${field.label}). Auto-retrying...`);
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry';
          }
          store.updateField(field.path, { status: 'error', error: 'Schema translation failed (Chinese characters remaining)' });
          store.addLog('error', `Chinese characters remaining in Schema for ${field.label} after retries.`);
          return 'error';
        }
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

      // Keep chunk progress for export, clear failed index only
      store.updateField(field.path, { status: 'done', translated, failedChunkIndex: undefined });
      store.addLog('success', `Translated: ${field.label} (${translated.length} chars)`);
      // Store to Translation Memory (non-blocking)
      if (store.translationConfig.enableTranslationMemory) {
        storeTranslation({ ...field, translated, status: 'done' }, store.cardFileName || 'unknown').catch(() => {});
      }
      return 'done';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Cancelled' || checkAbort()) {
        // On cancel, preserve any completed chunks for resume
        if (err instanceof ChunkError) {
          store.updateField(field.path, {
            status: 'pending',
            completedChunks: err.completedChunks,
            failedChunkIndex: err.failedChunkIndex,
            totalChunks: err.totalChunks,
          });
          store.addLog('info', `⏸ ${field.label}: saved ${err.completedChunks.length}/${err.totalChunks} chunks for resume`);
        } else {
          store.updateField(field.path, { status: 'pending' });
        }
        throw err; // Re-throw for cancel handling
      }

      // ═══ CHUNK-LEVEL RESUME: Save partial progress on chunk failure ═══
      const currentRetries = freshRetries();
      const maxChunkRetries = 2; // Auto-retry up to 2 times for chunk errors (3 total attempts)

      if (err instanceof ChunkError) {
        // Save the progress first so we can resume
        store.updateField(field.path, {
          completedChunks: err.completedChunks,
          failedChunkIndex: err.failedChunkIndex,
          totalChunks: err.totalChunks,
        });

        if (currentRetries < maxChunkRetries) {
          store.updateField(field.path, { retries: currentRetries + 1 });
          store.addLog('retry', `⚠️ Chunk translation failed at chunk ${err.failedChunkIndex + 1}/${err.totalChunks}. Auto-retrying with resume (Attempt ${currentRetries + 1}/${maxChunkRetries})...`);
          await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
          return 'retry';
        }

        // If all retries exhausted, set error state
        store.updateField(field.path, {
          status: 'error',
          error: msg,
          retries: currentRetries + 1,
        });
        store.addLog('error', `Failed: ${field.label} — chunk ${err.failedChunkIndex + 1}/${err.totalChunks} (${err.completedChunks.length} chunks saved for resume)`);
        store.addToast('error', `${field.label}: chunk ${err.failedChunkIndex + 1}/${err.totalChunks} failed — retry will resume`);
        return 'error';
      }

      // If it's a standard error but the field is chunk-eligible (meaning first chunk failed or single-chunk error on a large field)
      const isChunked = charCount > CHUNK_THRESHOLD;
      if (isChunked && currentRetries < maxChunkRetries) {
        store.updateField(field.path, { retries: currentRetries + 1 });
        store.addLog('retry', `⚠️ Chunk translation failed at chunk 1. Auto-retrying (Attempt ${currentRetries + 1}/${maxChunkRetries})...`);
        await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
        return 'retry';
      }

      store.updateField(field.path, { status: 'error', error: msg, retries: currentRetries + 1 });
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
    if (batchFields.length === 0) return;
    const targetModel = store.translationConfig.enableModelRouting
      ? (store.translationConfig.entryModelRouting[batchFields[0].path] || store.translationConfig.groupModelRouting[batchFields[0].group] || store.proxy.model)
      : store.proxy.model;
    // Threshold routing: batch total chars < threshold → secondary model directly
    const batchCharCount = batchFields.reduce((sum, f) => sum + f.original.length, 0);
    const resolvedModel = (
      store.proxy.enableSecondaryModel &&
      store.proxy.secondaryModel?.trim() &&
      (store.proxy.secondaryModelThreshold ?? 0) > 0 &&
      batchCharCount <= store.proxy.secondaryModelThreshold
    ) ? store.proxy.secondaryModel : targetModel;
    const effectiveProxy = resolvedModel !== store.proxy.model ? { ...store.proxy, model: resolvedModel } : store.proxy;

    // ═══ NATIVE ROUTING TO SINGLE STREAM ═══
    // For MVU/Controller scripts, they can be huge. If they are in a batch of 1,
    // explicitly route them through the single-translation flow to utilize adaptive chunking.
    // ALSO route any oversized single entry (e.g. a very long lorebook.content) the same way:
    // a multi-item batch is one un-chunked call, but translateSingleField chunks + can resume,
    // which prevents the "entry dài quá" 10–20 min stalls / truncation.
    const isMvuCritical = batchFields[0].entryType === 'mvu_logic' || batchFields[0].entryType === 'controller' || batchFields[0].entryType === 'initvar';
    const isLongSingle = batchFields.length === 1 && batchFields[0].original.length > LONG_ENTRY_ISOLATE_CHARS;
    if (batchFields.length === 1 && (isMvuCritical || isLongSingle)) {
      if (isLongSingle && !isMvuCritical) {
        store.addLog('info', `📏 Entry dài (${batchFields[0].original.length.toLocaleString()} ký tự) — dịch riêng & cắt nhỏ (chunk) thay vì gộp lô, để tránh lỗi/timeout: ${batchFields[0].label}`);
      }
      const allCurrentFields = useStore.getState().fields;
      const fieldIdx = allCurrentFields.findIndex(sf => sf.path === batchFields[0].path);
      // translateSingleField manages its own retry counter; loop on 'retry' (capped) like the
      // main single-field loop does, so a flagged chunk actually gets re-attempted.
      let result = await translateSingleField(batchFields[0], fieldIdx >= 0 ? fieldIdx : 0, allCurrentFields);
      let guard = 0;
      while (result === 'retry' && guard++ < 5) {
        if (checkAbort()) throw new Error('Cancelled');
        result = await translateSingleField(batchFields[0], fieldIdx >= 0 ? fieldIdx : 0, useStore.getState().fields);
      }
      if (result === 'error') {
         throw new Error(`Single translation failed for ${batchFields[0].label}`);
      }
      return;
    }

    // Mark all as translating
    for (const f of batchFields) {
      store.updateField(f.path, { status: 'translating' });
    }
    const totalChars = batchFields.reduce((s, f) => s + f.original.length, 0);
    const retryPrefix = retryCount > 0 ? `[Retry ${retryCount}] ` : '';
    const mvuCriticalCount = batchFields.filter(isMvuCriticalField).length;
    const entryTypes = [...new Set(batchFields.map(f => f.entryType).filter(Boolean))];
    const typeLabel = entryTypes.length > 0 ? ` [${entryTypes.join(',')}]` : '';
    store.addLog('active', `${retryPrefix}Batch translating ${batchFields.length} entries${typeLabel} (${totalChars} chars${mvuCriticalCount > 0 ? `, ${mvuCriticalCount} MVU-critical` : ''}) - Unlimited Context${targetModel !== store.proxy.model ? ` [Model: ${targetModel}]` : ''}`);

    try {
      const items = batchFields.map(f => ({ text: f.original, fieldName: f.label }));
      
      
      // ═══ Absolute Priority User Prompts ═══
      const batchUserPrompts: string[] = [];
      if (store.translationConfig.translationPrompt?.trim()) {
        batchUserPrompts.push(store.translationConfig.translationPrompt.trim());
      }
      // If ANY field in the batch is a regex/tavern_helper field, include surgicalPrompt
      if (store.translationConfig.surgicalPrompt?.trim() && batchFields.some(f => f.group === 'regex' || f.group === 'tavern_helper')) {
        batchUserPrompts.push(store.translationConfig.surgicalPrompt.trim());
      }
      const batchUserPriorityPrompt = batchUserPrompts.length > 0 ? batchUserPrompts.join('\n\n---\n\n') : undefined;

      // ═══ Centralized prompt building (single source of truth) ═══
      // Build entry name dictionary from already-translated lorebook name fields
      // IMPORTANT: Read fresh fields from store (not stale closure) for covariance
      const batchFreshFields = useStore.getState().fields;
      const batchEntryNameDict = { ...buildEntryNameDictionary(batchFreshFields), ...buildRegexTriggerDictionary(batchFreshFields) };

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: store.translationConfig.enableObjectiveMode,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field: batchFields[0],
        allFields: batchFreshFields,
        batchFields,
        mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
        glossary: store.translationConfig.glossary,
        customSchema: store.translationConfig.customSchema,
        liveSchemaContext: store.liveSchemaContext,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(batchEntryNameDict).length > 0 ? batchEntryNameDict : undefined,
        expertMode: effectiveProxy.expertMode,
        enableModMode: store.translationConfig.enableModMode,
        modInstructions: store.translationConfig.modInstructions,
      
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        // Translation Memory hits for batch (use first field as representative)
        translationMemoryHits: store.translationConfig.enableTranslationMemory
          ? await lookupTranslationMemory(batchFields[0]).catch(() => [])
          : undefined,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });

      const results = await translateBatch(
        items,
        effectiveProxy,
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

      // Count how many results are empty (cleared by cross-validation or failed parse)
      const emptyResultCount = results.filter(r => !r || !r.trim()).length;
      if (emptyResultCount > 0 && emptyResultCount < batchFields.length) {
        store.addLog('info', `🔍 Batch cross-validation: ${emptyResultCount}/${batchFields.length} entries will be retranslated individually (suspicious alignment detected)`);
      }

      for (let j = 0; j < batchFields.length; j++) {
        let translated = results[j] || '';
        if (!translated.trim()) {
          emptyFields.push(batchFields[j]);
          continue;
        }

        if (translated && batchFields[j].group === 'tavern_helper') {
          const fixed = fixZodSyntaxErrors(translated);
          if (fixed !== translated) {
            translated = fixed;
            store.addLog('info', `🔧 Fixed Zod syntax errors in ${batchFields[j].label}`);
          }
        }

        const isTargetNonCJK = !(/chinese|中文|japanese|日本語|korean|한국어/i.test(store.translationConfig.targetLanguage));
        const f = batchFields[j];

        // ─── Residual CJK detection: retry individually if Chinese text remains ───
        // Strip URLs first — CJK in URL paths (e.g. 骰子系统 in import paths) is intentional
        if (isTargetNonCJK) {
          const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
          const translatedStripped = stripUrlsForCjkCheck(translated);
          const cjkMatches = translatedStripped.match(cjkRegex);
          const residualCount = cjkMatches ? cjkMatches.length : 0;

          // ZERO TOLERANCE: Any CJK remaining = retry individually
          // Previously non-schema fields allowed up to 5 CJK chars — this caused
          // scattered Chinese characters like "nhân际" in final output.
          if (residualCount > 0) {
            const isSchemaCritical = f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic' || f.group === 'tavern_helper';
            const typeLabel = isSchemaCritical ? 'Schema' : 'Content';
            store.addLog('warning', `⚠️ ${residualCount} Chinese chars in ${typeLabel} batch (${f.label}). Will retry individually.`);
            emptyFields.push(f);
            continue;
          }
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

          // ─── COVARIANCE FIX: Enforce covariance across all code-like AND lorebook fields ───
          // Lorebook narrative: strict exact-only matching to prevent false positives
          const bf = batchFields[j];
          const isBfCodeLike = bf.entryType === 'initvar' || bf.entryType === 'controller' || bf.entryType === 'mvu_logic' || bf.group === 'regex' || bf.group === 'tavern_helper';
          const isBfLorebookNarrative = bf.group === 'lorebook' && !isBfCodeLike;
          const isBfCodeOrLogic = isBfCodeLike || isBfLorebookNarrative;
          if (isBfCodeOrLogic) {

            const covariance = enforceInitvarCovariance(translated, mvuDict, isBfLorebookNarrative);
            if (covariance.fixes.length > 0) {
              translated = covariance.text;
              autoFixCount += covariance.fixes.length;
              const fixSummary = covariance.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
              store.addLog('info', `🔗 Covariance${isBfLorebookNarrative ? ' (strict)' : ''}: fixed ${covariance.fixes.length} key(s) in ${bf.label}: ${fixSummary}`);
            }

            // ═══ PROGRESSIVE DICT: Extract new variable mappings from batch-translated entry ═══
            if (bf.entryType === 'initvar' || bf.entryType === 'controller' || bf.entryType === 'mvu_logic') {
              const entryMappings = extractMappingFromTranslatedInitvar([
                { original: bf.original, translated, status: 'done', entryType: bf.entryType }
              ]);
              const newMappingKeys = Object.keys(entryMappings);
              if (newMappingKeys.length > 0) {
                const freshDict = useStore.getState().translationConfig.mvuDictionary;
                const updatedDict = { ...freshDict };
                let addedCount = 0;
                // Dedup check: skip entries whose translation already exists for a different source key
                const existingVals = new Set(Object.values(freshDict).map(v => v?.trim()).filter(Boolean));
                for (const [k, v] of Object.entries(entryMappings)) {
                  if (v && v.trim() && !(k in updatedDict)) {
                    if (existingVals.has(v.trim())) {
                      console.warn(`[MVU Progressive Batch] Skipped duplicate: "${k}"→"${v}" (already exists for another key)`);
                      continue;
                    }
                    updatedDict[k] = v;
                    existingVals.add(v.trim());
                    addedCount++;
                  }
                }
                if (addedCount > 0) {
                  store.setTranslationConfig({ mvuDictionary: updatedDict });
                  store.addLog('info', `🔗 Progressive: +${addedCount} entry-specific var(s) from ${bf.label}`);
                }
              }
            }
          }

          // Log warnings (macro disappearance, etc.)
          for (const w of validation.warnings.slice(0, 2)) {
            store.addLog('warning', `${batchFields[j].label}: ${w}`);
          }
        }

          // ─── CASING FIX (batch): Enforce variable casing for regex/lorebook/tavern_helper ───
          if (hasMvuDict && (batchFields[j].group === 'regex' || batchFields[j].group === 'lorebook' || batchFields[j].group === 'tavern_helper')) {
            const casingResult = enforceVariableCasing(translated, mvuDict);
            if (casingResult.fixes.length > 0) {
              translated = casingResult.text;
              autoFixCount += casingResult.fixes.length;
              const fixSummary = casingResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
              store.addLog('info', `🔠 Casing: fixed ${casingResult.fixes.length} var(s) in ${batchFields[j].label}: ${fixSummary}`);
            }
          }

          // ─── EJS AUTO-FIX (batch): Enforce EJS entry names & keywords ───
          if (translated && store.translationConfig.enableEjsSync) {
            const ejsEntryDict = useStore.getState().translationConfig.ejsEntryNameDict;
            const ejsKwDict = useStore.getState().translationConfig.ejsKeywordDict;

            // Force lorebook entry name/comment to match EJS dict
            const isLorebookNameOrComment = batchFields[j].group === 'lorebook' && (
              batchFields[j].path.endsWith('.name') || batchFields[j].path.endsWith('.comment')
            ) && batchFields[j].path.includes('character_book.entries[');
            if (isLorebookNameOrComment && Object.keys(ejsEntryDict).length > 0) {
              const enforceResult = enforceEjsEntryName(batchFields[j].original, translated, ejsEntryDict);
              if (enforceResult.forced) {
                store.addLog('info', `🔗 EJS Sync: Forced entry name "${batchFields[j].original}" → "${enforceResult.text}" (was: "${translated}")`);
                translated = enforceResult.text;
              }
            }

            // Auto-fix getwi()/activewi() entry names
            if (Object.keys(ejsEntryDict).length > 0) {
              const entryFixResult = autoFixEjsEntryNames(translated, ejsEntryDict);
              if (entryFixResult.fixes.length > 0) {
                translated = entryFixResult.text;
                autoFixCount += entryFixResult.fixes.length;
                store.addLog('info', `🔗 EJS EntryName: fixed ${entryFixResult.fixes.length} call(s) in ${batchFields[j].label}`);
              }
            }

            // Auto-fix keywords inside EJS blocks
            if (Object.keys(ejsKwDict).length > 0) {
              const kwFixResult = autoFixEjsKeywords(translated, ejsKwDict);
              if (kwFixResult.fixes.length > 0) {
                translated = kwFixResult.text;
                autoFixCount += kwFixResult.fixes.length;
                store.addLog('info', `🔗 EJS Keyword: fixed ${kwFixResult.fixes.length} keyword(s) in ${batchFields[j].label}`);
              }
            }

            // ─── EJS COVARIANCE (batch): Full-context enforcement ───
            if (Object.keys(ejsEntryDict).length > 0 || Object.keys(ejsKwDict).length > 0) {
              const covResult = enforceEjsCovariance(translated, ejsEntryDict, ejsKwDict);
              if (covResult.fixes.length > 0) {
                translated = covResult.text;
                autoFixCount += covResult.fixes.length;
                const fixSummary = covResult.fixes.map(f => `"${f.found}"→"${f.replaced}"`).join(', ');
                store.addLog('info', `🔗 EJS Covariance: fixed ${covResult.fixes.length} ref(s) in ${batchFields[j].label}: ${fixSummary}`);
              }
            }

            // ─── EJS CASING (batch): Fix case mismatches ───
            if (Object.keys(ejsEntryDict).length > 0 || Object.keys(ejsKwDict).length > 0) {
              const casingResult = enforceEjsKeywordCasing(translated, ejsEntryDict, ejsKwDict);
              if (casingResult.fixes.length > 0) {
                translated = casingResult.text;
                autoFixCount += casingResult.fixes.length;
                store.addLog('info', `🔠 EJS Casing: fixed ${casingResult.fixes.length} casing(s) in ${batchFields[j].label}`);
              }
            }

            // ─── EJS EXTENDED (batch): Fix keywords OUTSIDE <% %> blocks ───
            if (Object.keys(ejsKwDict).length > 0) {
              const extResult = autoFixEjsKeywordsExtended(translated, ejsKwDict);
              if (extResult.fixes.length > 0) {
                translated = extResult.text;
                autoFixCount += extResult.fixes.length;
                store.addLog('info', `🔗 EJS Extended: fixed ${extResult.fixes.length} keyword(s) outside EJS blocks in ${batchFields[j].label}`);
              }
            }

            // ─── PROGRESSIVE EJS DICT (batch): Extract new mappings ───
            const isLbNameOrComment = batchFields[j].group === 'lorebook' && (
              batchFields[j].path.endsWith('.name') || batchFields[j].path.endsWith('.comment')
            ) && batchFields[j].path.includes('character_book.entries[');
            if (isLbNameOrComment && translated && batchFields[j].original !== translated) {
              const freshEjsDict = useStore.getState().translationConfig.ejsEntryNameDict;
              const trimOrig = batchFields[j].original.trim();
              const trimTrans = translated.trim();
              if (trimOrig && trimTrans && !(trimOrig in freshEjsDict) && trimOrig !== trimTrans) {
                const updatedEjsDict = { ...freshEjsDict, [trimOrig]: trimTrans };
                store.setTranslationConfig({ ejsEntryNameDict: updatedEjsDict });
                store.addLog('info', `🔗 EJS Progressive: +1 entry name "${trimOrig}" → "${trimTrans}"`);
              }
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
        // Smart-quote fix for code fields not covered above (fixes "lỗi dấu" breaking regex/JS)
        if (translated && (batchFields[j].group === 'regex' || batchFields[j].group === 'tavern_helper')) {
          translated = normalizeSmartQuotesInCode(translated);
        }

        store.updateField(batchFields[j].path, { status: 'done', translated, retries: retryCount });
        // Store to Translation Memory (non-blocking)
        if (store.translationConfig.enableTranslationMemory) {
          storeTranslation({ ...batchFields[j], translated, status: 'done' }, store.cardFileName || 'unknown').catch(() => {});
        }
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

              if (result === 'retry') {
                fi--; // Dịch lại field này ở loop tiếp theo
                continue;
              }

              // Extra retry for MVU-critical fields that failed
              if (result === 'error' && isMvuCriticalField(ef)) {
                store.addLog('retry', `🔄 Extra retry for MVU-critical: ${ef.label}`);
                await new Promise((r) => setTimeout(r, backoffDelay));
                const secondResult = await translateSingleField(ef, fieldIdx >= 0 ? fieldIdx : fi, allCurrentFields);
                if (secondResult === 'retry') {
                  fi--;
                  continue;
                }
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

          if (result === 'retry') {
            fi--; // Dịch lại
            continue;
          }

          // Extra retry for MVU-critical fields
          if (result === 'error' && isMvuCriticalField(f)) {
            store.addLog('retry', `🔄 Extra retry for MVU-critical: ${f.label}`);
            await new Promise((r) => setTimeout(r, backoffDelay));
            const secondResult = await translateSingleField(f, fieldIdx >= 0 ? fieldIdx : fi, allCurrentFields);
            if (secondResult === 'retry') {
              fi--;
              continue;
            }
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

    // ═══ Abort any previous running operation before starting fresh ═══
    if (abortRef.current) {
      abortRef.current.abort();
    }
    // Also cancel any per-field in-flight translations (from retranslate/retry)
    for (const [, ctrl] of fieldAbortMap.current) {
      ctrl.abort();
    }
    fieldAbortMap.current.clear();

    abortRef.current = new AbortController();
    pauseRef.current = false;
    runningRef.current = true;
    store.setPhase('translating');
    store.setStartTime(Date.now());
    store.clearLogs();
    store.setPreprocessProgress(null);
    CallMonitor.reset();

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

    // ═══ (MVU auto-suggest removed per user request) ═══




    sortFieldsForCovariance(fields, Boolean(store.translationConfig.enableMvuSync));
    if (store.translationConfig.enableMvuSync) {
      store.addLog('info', '📋 Multi-Pass Covariant Sorting applied: Phase 1 (Schema & Initvars) → Phase 2 (Regex & Keys) → Phase 3 (Narrative & Prompts)');
    } else {
      const hasFindRegex = fields.some(f => f.path.includes('findRegex'));
      if (hasFindRegex) {
        store.addLog('info', `📋 findRegex fields moved to front (translate before narrative)`);
      }
    }

    const isBatchLorebook = store.translationConfig.lorebookStrategy === 'batch';
    const batchSize = store.translationConfig.lorebookBatchSize || 20;
    const lorebookGroups: FieldGroup[] = ['lorebook', 'lorebook_keys'];

    // ═══ Strategy B: Build MVU Dictionary BEFORE starting loop ═══
    // In continueMode, skip if dictionary already populated (avoid re-calling AI)
    const existingMvuDictForCheck = useStore.getState().translationConfig.mvuDictionary;
    const skipMvuBuild = continueMode && Object.keys(existingMvuDictForCheck).length > 0;
    if (store.translationConfig.enableMvuSync && store.card && !skipMvuBuild) {
      try {
        store.addLog('info', '🔧 Strategy B: Auto-detecting MVU/Zod variables...');
        const extractedKeys = extractPotentialMvuKeyStrings(store.card);
        
        if (extractedKeys.length > 0) {
          let existingDict = store.translationConfig.mvuDictionary;
          const totalMvuPasses = Math.max(1, Math.min(5, store.translationConfig.mvuScanPasses || 1));
          
          for (let mvuPass = 0; mvuPass < totalMvuPasses; mvuPass++) {
            if (checkAbort()) {
              runningRef.current = false;
              store.setPhase('cancelled');
              store.addLog('warning', 'Translation cancelled by user');
              return;
            }
            if (await waitForPause()) {
              runningRef.current = false;
              store.setPhase('cancelled');
              return;
            }

            existingDict = useStore.getState().translationConfig.mvuDictionary;
            const newKeys = extractedKeys.filter(k => !(k in existingDict));
            
            if (totalMvuPasses > 1) {
              store.addLog('info', `🔧 Strategy B Pass ${mvuPass + 1}/${totalMvuPasses}: Found ${extractedKeys.length} variables (${newKeys.length} new, ${extractedKeys.length - newKeys.length} already mapped)`);
            } else {
              store.addLog('info', `Found ${extractedKeys.length} variables (${newKeys.length} new, ${extractedKeys.length - newKeys.length} already mapped)`);
            }

            if (newKeys.length === 0) {
              if (totalMvuPasses > 1 && mvuPass > 0) {
                store.addLog('success', `🔧 Strategy B: All variables mapped after ${mvuPass} pass(es) — no new keys to translate`);
              }
              break;
            }

            store.addLog('active', `🤖 Calling AI to translate ${newKeys.length} variable names...`);
            
            // Build schema context
            let schemaContext = store.translationConfig.customSchema || '';
            if (!schemaContext.trim()) {
              schemaContext = extractSchemaContextFromCard(store.card!);
            }

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
              keyDescriptions,
              undefined,
              undefined,
              store.translationConfig.mvuTranslationPrompt,
              (done, total) => {
                const passLabel = totalMvuPasses > 1 ? ` (Pass ${mvuPass + 1}/${totalMvuPasses})` : '';
                store.setPreprocessProgress({
                  label: `🔧 Dịch tên biến MVU${passLabel}`,
                  current: done,
                  total,
                });
              },
            );
            store.setPreprocessProgress(null);
            
            const mergedDict = { ...existingDict };
            let addedCount = 0;
            const currentMetadata = { ...useStore.getState().mvuKeyMetadata };
            for (const [k, v] of Object.entries(aiTranslations)) {
              if (v && v.trim() && k !== v && !(k in mergedDict)) {
                mergedDict[k] = v;
                addedCount++;
                currentMetadata[k] = { sources: ['ai'], confidence: 'ai', occurrences: 1 };
              }
            }
            
            if (addedCount > 0) {
              store.setMvuKeyMetadata(currentMetadata);
              const { fixedDict, fixes } = enforceExactConsistency(mergedDict, currentMetadata);
              store.setTranslationConfig({ mvuDictionary: fixedDict });
              store.addLog('success', `✅ Auto-added ${addedCount} variable translations to MVU Dictionary`);
            } else {
              store.addLog('info', 'All variables are already ASCII or mapped — no AI translation needed');
              break;
            }
          }
        } else {
          store.addLog('info', 'No MVU/Zod variables detected in this card');
        }
      } catch (mvuErr) {
        const mvuMsg = mvuErr instanceof Error ? mvuErr.message : String(mvuErr);
        if (mvuMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase('cancelled');
          return;
        }
        store.addLog('warning', `⚠️ MVU auto-detect failed (non-critical): ${mvuMsg}`);
      }
    } else if (skipMvuBuild) {
      store.addLog('info', `🔧 Strategy B: Reusing existing MVU dictionary (${Object.keys(existingMvuDictForCheck).length} entries) — skipping AI re-translation`);
    }

    // ═══ Strategy B: Auto-resolve conflicts before EJS/translation loop ═══
    // Skip on resume — conflicts were already resolved in the first run
    if (store.translationConfig.enableMvuSync && store.card && !skipMvuBuild) {
      try {
        const currentDict = useStore.getState().translationConfig.mvuDictionary;
        const conflicts = validateDictionaryConflicts(currentDict);
        if (conflicts.length > 0) {
          if (checkAbort()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            return;
          }
          store.addLog('active', `⚠️ Strategy B: Detected ${conflicts.length} translation conflict(s). Calling AI to resolve conflicts before proceeding...`);
          
          let schemaContext = store.translationConfig.customSchema || '';
          if (!schemaContext.trim()) {
            schemaContext = extractSchemaContextFromCard(store.card!);
          }
          let keyDescriptions: Record<string, string> = {};
          if (schemaContext) {
            keyDescriptions = extractZodDescriptions(schemaContext);
          }

          const { fixedDict, fixedCount } = await aiResolveMvuConflicts(
            currentDict,
            store.translationConfig.targetLanguage,
            store.proxy,
            abortRef.current?.signal,
            schemaContext,
            keyDescriptions
          );

          if (fixedCount > 0) {
            // Update metadata for fixed keys
            const currentMetadata = { ...useStore.getState().mvuKeyMetadata };
            const conflictedKeys = Array.from(new Set(conflicts.flatMap(c => [c.key1, c.key2])));
            for (const k of conflictedKeys) {
              if (fixedDict[k] && fixedDict[k] !== currentDict[k]) {
                currentMetadata[k] = {
                  ...currentMetadata[k],
                  confidence: 'ai'
                };
              }
            }
            store.setMvuKeyMetadata(currentMetadata);
            store.setTranslationConfig({ mvuDictionary: fixedDict });
            store.addLog('success', `✅ Strategy B: Resolved ${fixedCount} translation conflicts`);
          } else {
            store.addLog('warning', `⚠️ Strategy B: Could not automatically resolve conflicts`);
          }
        }
      } catch (conflictErr) {
        const conflictMsg = conflictErr instanceof Error ? conflictErr.message : String(conflictErr);
        if (conflictMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase('cancelled');
          return;
        }
        store.addLog('warning', `⚠️ MVU conflict resolution failed: ${conflictMsg}`);
      }
    }

    // ═══ Strategy C: Build EJS Dictionary BEFORE starting loop ═══
    // In continueMode, skip if dictionaries already populated (avoid re-calling AI)
    const existingEjsDictForCheck = useStore.getState().translationConfig.ejsEntryNameDict;
    const existingKwDictForCheck = useStore.getState().translationConfig.ejsKeywordDict;
    const skipEjsBuild = continueMode && (Object.keys(existingEjsDictForCheck || {}).length > 0 || Object.keys(existingKwDictForCheck || {}).length > 0);
    if (store.translationConfig.enableEjsSync && store.card && !skipEjsBuild) {
      try {
        store.addLog('info', '🔮 Strategy C: Scanning EJS entry names & keywords...');
        const ejsEntryRefs = extractEjsEntryNames(store.card);
        const ejsKeywords = extractEjsKeywords(store.card);
        const totalEjsPasses = Math.max(1, Math.min(5, store.translationConfig.ejsScanPasses || 1));

        for (let ejsPass = 0; ejsPass < totalEjsPasses; ejsPass++) {
          if (checkAbort()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            store.addLog('warning', 'Translation cancelled by user');
            return;
          }
          if (await waitForPause()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            return;
          }

          const existingEntryDict = useStore.getState().translationConfig.ejsEntryNameDict;
          const existingKwDict = useStore.getState().translationConfig.ejsKeywordDict;

          const newEntryNames = ejsEntryRefs.map(r => r.name).filter(n => !(n in existingEntryDict));
          const newKeywords = ejsKeywords.map(k => k.keyword).filter(k => !(k in existingKwDict));

          if (totalEjsPasses > 1) {
            store.addLog('info', `🔮 Strategy C Pass ${ejsPass + 1}/${totalEjsPasses}: Found ${ejsEntryRefs.length} entry refs (${newEntryNames.length} new), ${ejsKeywords.length} keywords (${newKeywords.length} new)`);
          } else {
            store.addLog('info', `Found ${ejsEntryRefs.length} entry refs (${newEntryNames.length} new), ${ejsKeywords.length} keywords (${newKeywords.length} new)`);
          }

          if (newEntryNames.length === 0 && newKeywords.length === 0) {
            if (totalEjsPasses > 1 && ejsPass > 0) {
              store.addLog('success', `🔮 Strategy C: All EJS items mapped after ${ejsPass} pass(es)`);
            }
            break;
          }

          store.addLog('active', `🤖 Calling AI to translate ${newEntryNames.length} entry names + ${newKeywords.length} keywords...`);

          const ejsContext = (store.card!.data?.character_book?.entries || [])
            .filter((e: any) => e.content && /<%[\s\S]*?%>/.test(e.content))
            .map((e: any) => e.content)
            .join('\n\n')
            .slice(0, 3000);

          const { entryTranslations, keywordTranslations } = await aiTranslateEjsEntries(
            newEntryNames,
            newKeywords,
            store.translationConfig.targetLanguage,
            store.proxy,
            abortRef.current?.signal,
            ejsContext,
            store.translationConfig.ejsTranslationPrompt,
          );

          const mergedEntryDict = { ...existingEntryDict, ...entryTranslations };
          const mergedKwDict = { ...existingKwDict, ...keywordTranslations };
          const addedEntries = Object.keys(entryTranslations).length;
          const addedKw = Object.keys(keywordTranslations).length;

          if (addedEntries > 0 || addedKw > 0) {
            store.setTranslationConfig({ ejsEntryNameDict: mergedEntryDict, ejsKeywordDict: mergedKwDict });
            store.addLog('success', `✅ Strategy C: Added ${addedEntries} entry name translations + ${addedKw} keyword translations`);
          } else {
            store.addLog('info', 'All EJS items already mapped or no CJK content to translate');
            break;
          }
        }

        if (store.translationConfig.ejsDecoratorPreserve) {
          const ejsDetection = detectEjsCard(store.card);
          if (ejsDetection.hasDecorators) {
            store.addLog('info', '🛡️ Strategy C: Decorator preservation active — @@, [GENERATE:], @INJECT lines will be protected');
          }
        }
      } catch (ejsErr) {
        const ejsMsg = ejsErr instanceof Error ? ejsErr.message : String(ejsErr);
        if (ejsMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase('cancelled');
          return;
        }
        store.addLog('warning', `⚠️ EJS auto-detect failed (non-critical): ${ejsMsg}`);
      }
    } else if (skipEjsBuild) {
      store.addLog('info', `🔮 Strategy C: Reusing existing EJS dictionaries (${Object.keys(existingEjsDictForCheck || {}).length} entries + ${Object.keys(existingKwDictForCheck || {}).length} keywords) — skipping AI re-translation`);
    }

    let i = 0;

    while (i < fields.length) {
      // Check abort
      if (checkAbort()) {
        runningRef.current = false;
        store.setPhase('cancelled');
        store.addLog('warning', 'Translation cancelled by user');
        return;
      }

      // Handle pause
      if (await waitForPause()) {
        runningRef.current = false;
        store.setPhase('cancelled');
        return;
      }

      const field = fields[i];

      // ─── Batch mode for lorebook fields ───
      if (isBatchLorebook && lorebookGroups.includes(field.group)) {
        const concurrency = store.translationConfig.concurrentBatches || 1;
        const MAX_BATCH_CHARS = Math.max(store.proxy.maxTokens || 65536, 10000);
        // ═══ SAFETY: Dynamic soft cap to prevent AI from losing track of sections ═══
        const SOFT_CHAR_CAP = 30000; // If total chars > 30K, auto-reduce effective batch size
        const isMvuEnabled = store.translationConfig.enableMvuSync;

        // Warn when batch size is large
        if (batchSize > 10) {
          store.addLog('warning', `⚠️ Batch size is ${batchSize} (>10). Large batches may cause AI to swap/mix translations between entries. Consider reducing to 5-10 for best accuracy.`);
        }

        // Step 1: Collect ALL consecutive lorebook fields
        const allLorebookFields: TranslationField[] = [];
        while (i < fields.length && lorebookGroups.includes(fields[i].group)) {
          allLorebookFields.push(fields[i]);
          i++;
        }

        // Step 2: Split into sub-batches
        const subBatches: TranslationField[][] = [];

        if (isMvuEnabled) {
          // ═══ MVU Smart Grouping: group by targetModel and entryType first, then split ═══
          // This ensures initvar entries batch together (YAML format),
          // mvu_logic entries batch together (code), and narrative batches separately
          const typeGroups: Record<string, TranslationField[]> = {};
          for (const f of allLorebookFields) {
            const targetModel = store.translationConfig.enableModelRouting
              ? (store.translationConfig.entryModelRouting[f.path] || store.translationConfig.groupModelRouting[f.group] || store.proxy.model)
              : store.proxy.model;
            const typeKey = `${f.entryType || 'other'}_|_${targetModel}`;
            if (!typeGroups[typeKey]) typeGroups[typeKey] = [];
            typeGroups[typeKey].push(f);
          }

          // Process each type group with appropriate batch sizes
          const TYPE_BATCH_SIZES: Record<string, number> = {
            initvar: 1,                  // YAML: ONE BY ONE
              mvu_logic: 1,                // Code: ONE BY ONE
              controller: 1,               // Code: ONE BY ONE
            rules: batchSize,            // Rules: normal size
            narrative: batchSize,        // Narrative: normal size
            other: batchSize,            // Default: normal size
          };

          // Order: initvar first (schema variables), then logic, then rest
          const typeOrder = ['initvar', 'controller', 'mvu_logic', 'rules', 'narrative', 'other'];
          const sortedTypes = Object.keys(typeGroups).sort((a, b) => {
            const baseA = a.split('_|_')[0];
            const baseB = b.split('_|_')[0];
            const ia = typeOrder.indexOf(baseA);
            const ib = typeOrder.indexOf(baseB);
            if (ia === ib) return a.localeCompare(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          });

          for (const typeKey of sortedTypes) {
            const baseTypeKey = typeKey.split('_|_')[0];
            const typeFields = typeGroups[typeKey];
            const typeBatchSize = TYPE_BATCH_SIZES[baseTypeKey] || batchSize;
            let currentBatch: TranslationField[] = [];
            let currentChars = 0;

            for (const f of typeFields) {
              // Long entry → isolate into its own batch so translateOneBatch routes it
              // through chunked single-field translation (avoids the un-chunked giant call).
              if (f.original.length > LONG_ENTRY_ISOLATE_CHARS) {
                if (currentBatch.length > 0) { subBatches.push(currentBatch); currentBatch = []; currentChars = 0; }
                subBatches.push([f]);
                continue;
              }
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
          // ═══ Standard splitting: group by targetModel first, then by batchSize + char limit ═══
          const modelGroups: Record<string, TranslationField[]> = {};
          for (const f of allLorebookFields) {
            const targetModel = store.translationConfig.enableModelRouting
              ? (store.translationConfig.entryModelRouting[f.path] || store.translationConfig.groupModelRouting[f.group] || store.proxy.model)
              : store.proxy.model;
            if (!modelGroups[targetModel]) modelGroups[targetModel] = [];
            modelGroups[targetModel].push(f);
          }

          for (const targetModel of Object.keys(modelGroups)) {
            const modelFields = modelGroups[targetModel];
            let currentBatch: TranslationField[] = [];
            let currentChars = 0;
            for (const f of modelFields) {
              // Long entry → isolate into its own batch so it gets chunked single-field
              // translation instead of being sent inside one un-chunked giant batch call.
              if (f.original.length > LONG_ENTRY_ISOLATE_CHARS) {
                if (currentBatch.length > 0) { subBatches.push(currentBatch); currentBatch = []; currentChars = 0; }
                subBatches.push([f]);
                continue;
              }
              // Split when: count exceeds batchSize, OR char count exceeds soft cap
              if (currentBatch.length >= batchSize ||
                  (currentBatch.length > 0 && currentChars + f.original.length > MAX_BATCH_CHARS) ||
                  (currentBatch.length > 0 && currentChars + f.original.length > SOFT_CHAR_CAP && currentBatch.length >= 3)) {
                subBatches.push(currentBatch);
                currentBatch = [];
                currentChars = 0;
              }
              currentBatch.push(f);
              currentChars += f.original.length;
            }
            if (currentBatch.length > 0) subBatches.push(currentBatch);
          }
          // Log with safety info
          const avgBatchSize = subBatches.length > 0 ? Math.round(allLorebookFields.length / subBatches.length) : 0;
          store.addLog('info', `${allLorebookFields.length} lorebook fields → ${subBatches.length} batch(es) (avg ${avgBatchSize}/batch), concurrency: ${concurrency}`);
        }

        store.setCurrentFieldIndex(i - 1);

        // Step 3: Dispatch sub-batches with concurrency limit (sliding window)
        let batchIdx = 0;
        while (batchIdx < subBatches.length) {
          if (checkAbort()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            store.addLog('warning', 'Translation cancelled');
            return;
          }

          // Handle pause inside batch loop
          if (await waitForPause()) {
            runningRef.current = false;
            store.setPhase('cancelled');
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
                  runningRef.current = false;
                  store.setPhase('cancelled');
                  store.addLog('warning', 'Translation cancelled');
                  return;
                }
              }
            }
          } catch {
            runningRef.current = false;
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
      // ─── Regex fields: use Regex Manager mechanism (individual per-field API calls) ───
      // Instead of going through translateSingleField (which uses surgical/chunk-splitting),
      // regex fields are translated individually like the RegexManagerPanel does.
      // Each regex field gets its own prompt build + single translateText call.
      if (field.group === 'regex') {
        // Collect all consecutive regex fields
        const regexFields: TranslationField[] = [];
        while (i < fields.length && fields[i].group === 'regex') {
          regexFields.push(fields[i]);
          i++;
        }

        store.addLog('info', `🔧 Regex: Translating ${regexFields.length} regex field(s) via Regex Manager mechanism...`);

        for (const rf of regexFields) {
          // Check abort
          if (checkAbort()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            store.addLog('warning', 'Translation cancelled by user');
            return;
          }

          // Handle pause
          if (await waitForPause()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            return;
          }

          // Skip already done fields (for continue mode)
          if (rf.status === 'done') continue;

          store.updateField(rf.path, { status: 'translating', error: undefined });
          store.addLog('active', `Translating: ${rf.label}`);

          try {
            // ═══ Build prompt (same as retranslateField) ═══
            const regexFreshFields = useStore.getState().fields;
            const regexEntryNameDict = { ...buildEntryNameDictionary(regexFreshFields), ...buildRegexTriggerDictionary(regexFreshFields) };

            const regexTargetModel = store.translationConfig.enableModelRouting
              ? (store.translationConfig.entryModelRouting[rf.path] || store.translationConfig.groupModelRouting[rf.group] || store.proxy.model)
              : store.proxy.model;
            const regexEffectiveProxy = regexTargetModel !== store.proxy.model ? { ...store.proxy, model: regexTargetModel } : store.proxy;

            const regexPromptResult = buildEffectivePrompt({
              translationPrompt: store.translationConfig.translationPrompt,
              enableJailbreak: store.translationConfig.enableJailbreak,
              enableObjectiveMode: store.translationConfig.enableObjectiveMode,
              enableMvuSync: store.translationConfig.enableMvuSync,
              enableRAGContext: store.translationConfig.enableRAGContext,
              field: rf,
              allFields: regexFreshFields,
              mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
              glossary: store.translationConfig.glossary,
              customSchema: store.translationConfig.customSchema,
              liveSchemaContext: store.liveSchemaContext,
              ragMaxFields: store.translationConfig.ragMaxFields,
              ragMaxChars: store.translationConfig.ragMaxChars,
              entryNameDictionary: Object.keys(regexEntryNameDict).length > 0 ? regexEntryNameDict : undefined,
              expertMode: regexEffectiveProxy.expertMode,
              enableModMode: store.translationConfig.enableModMode,
              modInstructions: store.translationConfig.modInstructions,
              enableModThinking: store.translationConfig.enableModThinking,
              modPreset: store.translationConfig.modPreset,
              enableEjsSync: store.translationConfig.enableEjsSync,
              ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
              ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
              ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
              presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
            });

            const regexFieldType = fieldGroupToFieldType(rf.group, rf.entryType);
            const regexMvuDict = store.translationConfig.enableMvuSync
              ? useStore.getState().translationConfig.mvuDictionary
              : undefined;

            // ═══ Surgical Translation (primary path for regex) ═══
            let regexTranslated = '';
            let regexUsedSurgical = false;
            let regexSurgicalFallback = false;

            const regexIsEligibleForSurgical = true; // Regex always uses surgical (like Regex Manager)

            if (regexIsEligibleForSurgical) {
              regexUsedSurgical = true;
              store.addLog('active', `🔪 Initiating Surgical Translation for ${rf.label}...`);
              const sResult = await surgicalTranslate(
                rf.original,
                regexEffectiveProxy,
                store.translationConfig.targetLanguage,
                abortRef.current?.signal,
                store.translationConfig.glossary,
                regexMvuDict,
                true,
                undefined,
                'preserve',
                store.translationConfig.customSchema,
                regexPromptResult.effectivePrompt,
                rf.label
              );
              regexTranslated = sResult.translated;

              if (sResult.success) {
                store.updateField(rf.path, {
                  surgicalResult: { type: 'success', info: 'Successfully extracted and reinserted CJK without touching code structure.' }
                });
              } else {
                regexSurgicalFallback = true;
                store.updateField(rf.path, {
                  surgicalResult: { type: 'fallback', info: 'Structural verification failed. Falling back to standard translation.' }
                });
                store.addLog('warning', `Surgical verification failed for ${rf.label}. Falling back to standard translation.`);
              }
            }

            // ═══ Standard translateText (fallback or when surgical is disabled) ═══
            if (!regexIsEligibleForSurgical || regexSurgicalFallback) {
              regexTranslated = await translateText(
                rf.original,
                rf.label,
                regexEffectiveProxy,
                store.translationConfig.targetLanguage,
                store.translationConfig.sourceLanguage,
                regexPromptResult.effectivePrompt,
                regexPromptResult.schemaForApi,
                abortRef.current?.signal,
                undefined,
                regexPromptResult.glossaryForApi,
                rf.previousTranslation,
                regexFieldType,
                regexMvuDict,
                store.translationConfig.chunkSize,
                undefined, // no prevChunks — fresh translation
                // onChunkComplete
                (chunkIdx, translatedChunk, totalChunks) => {
                  const currentField = useStore.getState().fields.find(f => f.path === rf.path);
                  const currentCompleted = currentField?.completedChunks || [];
                  const updatedChunks = [...currentCompleted];
                  while (updatedChunks.length <= chunkIdx) updatedChunks.push('');
                  updatedChunks[chunkIdx] = translatedChunk;
                  store.updateField(rf.path, { completedChunks: updatedChunks, totalChunks });
                },
                store.translationConfig.parallelChunks,
                store.translationConfig.enableChunkVerification,
                // onChunksReady
                (rawChunks) => {
                  store.updateField(rf.path, { rawChunks });
                },
                store.translationConfig.cssCjkHandling,
              );
            }

            // ═══ Post-process regex HTML ═══
            const isRegexContent = rf.path.includes('replaceString') || rf.path.includes('trimStrings');
            if (isRegexContent && regexTranslated) {
              regexTranslated = postProcessRegexHtml(regexTranslated);
            }

            // ═══ EJS AUTO-FIX (Strategy C) ═══
            if (regexTranslated && store.translationConfig.enableEjsSync) {
              const ejsEntryDict = useStore.getState().translationConfig.ejsEntryNameDict;
              const ejsKwDict = useStore.getState().translationConfig.ejsKeywordDict;

              if (Object.keys(ejsEntryDict).length > 0) {
                const entryFixResult = autoFixEjsEntryNames(regexTranslated, ejsEntryDict);
                if (entryFixResult.fixes.length > 0) {
                  regexTranslated = entryFixResult.text;
                  store.addLog('info', `🔗 EJS EntryName: fixed ${entryFixResult.fixes.length} call(s) in ${rf.label}`);
                }
              }
              if (Object.keys(ejsKwDict).length > 0) {
                const kwFixResult = autoFixEjsKeywords(regexTranslated, ejsKwDict);
                if (kwFixResult.fixes.length > 0) {
                  regexTranslated = kwFixResult.text;
                  store.addLog('info', `🔗 EJS Keyword: fixed ${kwFixResult.fixes.length} keyword(s) in ${rf.label}`);
                }
              }
              // EJS Covariance + Casing + Extended
              if (Object.keys(ejsEntryDict).length > 0 || Object.keys(ejsKwDict).length > 0) {
                const covResult = enforceEjsCovariance(regexTranslated, ejsEntryDict, ejsKwDict);
                if (covResult.fixes.length > 0) {
                  regexTranslated = covResult.text;
                  store.addLog('info', `🔗 EJS Covariance: fixed ${covResult.fixes.length} ref(s) in ${rf.label}`);
                }
                const casingResult = enforceEjsKeywordCasing(regexTranslated, ejsEntryDict, ejsKwDict);
                if (casingResult.fixes.length > 0) {
                  regexTranslated = casingResult.text;
                  store.addLog('info', `🔠 EJS Casing: fixed ${casingResult.fixes.length} casing(s) in ${rf.label}`);
                }
              }
              if (Object.keys(ejsKwDict).length > 0) {
                const extResult = autoFixEjsKeywordsExtended(regexTranslated, ejsKwDict);
                if (extResult.fixes.length > 0) {
                  regexTranslated = extResult.text;
                  store.addLog('info', `🔗 EJS Extended: fixed ${extResult.fixes.length} keyword(s) outside EJS blocks in ${rf.label}`);
                }
              }
            }

            // ═══ MVU AUTO-FIX (Strategy B) ═══
            const regexHasMvuDict = regexMvuDict && Object.keys(regexMvuDict).length > 0;
            if (regexHasMvuDict && regexTranslated) {
              const covariance = enforceInitvarCovariance(regexTranslated, regexMvuDict!);
              if (covariance.fixes.length > 0) {
                regexTranslated = covariance.text;
                store.addLog('info', `🔗 MVU Covariance: fixed ${covariance.fixes.length} var(s) in ${rf.label}`);
              }
              const casingResult = enforceVariableCasing(regexTranslated, regexMvuDict!);
              if (casingResult.fixes.length > 0) {
                regexTranslated = casingResult.text;
                store.addLog('info', `🔠 MVU Casing: fixed ${casingResult.fixes.length} var(s) in ${rf.label}`);
              }
            }

            store.updateField(rf.path, { status: 'done', translated: regexTranslated, failedChunkIndex: undefined });
            store.addLog('success', `Done: ${rf.label}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === 'Cancelled' || msg === 'The operation was aborted' || msg === 'The user aborted a request.' || checkAbort()) {
              runningRef.current = false;
              store.setPhase('cancelled');
              store.addLog('warning', 'Translation cancelled');
              return;
            }
            store.updateField(rf.path, { status: 'error', error: msg });
            store.addLog('error', `Regex translate failed: ${rf.label} — ${msg}`);
          }

          // Delay between requests
          if (store.proxy.requestDelay > 0) {
            await new Promise((r) => setTimeout(r, store.proxy.requestDelay));
          }

          // Auto-save cache
          store.saveTranslationCache();
        }

        // Delay before next non-regex field
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

          // ═══ Early Key Mapping Injection (Cross-Script Covariance) ═══
          // Extract key mappings from ALL translated TavernHelper scripts so far
          // and inject them into mvuDictionary immediately.
          // This ensures the NEXT tavern_helper script receives these mappings
          // in its prompt (via buildEffectivePrompt → mvuDictionary), forcing
          // the AI to use the same variable names across all scripts.
          if (store.translationConfig.enableMvuSync && store.card) {
            try {
              const earlyMappings = extractMappingFromTranslatedSchemas(store.card, useStore.getState().fields);
              const earlyMappingCount = Object.keys(earlyMappings).length;
              if (earlyMappingCount > 0) {
                const currentDict = useStore.getState().translationConfig.mvuDictionary;
                const newEntries = Object.keys(earlyMappings).filter(k => !(k in currentDict));
                if (newEntries.length > 0) {
                  // Merge ALL new mappings into dictionary (including potential conflicts)
                  const mergedDict = { ...currentDict };
                  for (const [k, v] of Object.entries(earlyMappings)) {
                    if (!(k in currentDict)) {
                      mergedDict[k] = v as string;
                    }
                  }
                  
                  const currentMetadata = { ...useStore.getState().mvuKeyMetadata };
                  for (const k of Object.keys(earlyMappings)) {
                    if (!currentMetadata[k]) {
                      currentMetadata[k] = {
                        sources: ['zod'],
                        confidence: 'schema',
                        occurrences: 1
                      };
                    } else {
                      currentMetadata[k] = {
                        ...currentMetadata[k],
                        confidence: 'schema'
                      };
                    }
                  }
                  store.setMvuKeyMetadata(currentMetadata);

                  // Enforce 100% exact consistency
                  const { fixedDict, fixes } = enforceExactConsistency(mergedDict, currentMetadata);
                  const dictAfterConsistency = fixes.length > 0 ? fixedDict : mergedDict;
                  if (fixes.length > 0) {
                    store.addLog('info', `🔒 Exact consistency: fixed ${fixes.length} case/spelling variations: ${fixes.join(', ')}`);
                  }
                  store.setTranslationConfig({ mvuDictionary: dictAfterConsistency });
                  store.addLog('info', `🔗 Cross-Script Covariance: injected ${newEntries.length} key mapping(s) from translated schema → dictionary (total: ${earlyMappingCount})`);

                  // ═══ Auto-resolve conflicts after injection ═══
                  const postInjectConflicts = validateDictionaryConflicts(dictAfterConsistency);
                  if (postInjectConflicts.length > 0) {
                    store.addLog('active', `⚠️ Cross-Script Covariance: Detected ${postInjectConflicts.length} conflict(s) after schema injection. Calling AI to resolve...`);
                    try {
                      let schemaCtx = store.translationConfig.customSchema || '';
                      if (!schemaCtx.trim()) {
                        schemaCtx = extractSchemaContextFromCard(store.card!);
                      }
                      let keyDescs: Record<string, string> = {};
                      if (schemaCtx) {
                        keyDescs = extractZodDescriptions(schemaCtx);
                      }

                      const { fixedDict: resolvedDict, fixedCount } = await aiResolveMvuConflicts(
                        dictAfterConsistency,
                        store.translationConfig.targetLanguage,
                        store.proxy,
                        abortRef.current?.signal,
                        schemaCtx,
                        keyDescs
                      );

                      if (fixedCount > 0) {
                        const updatedMeta = { ...useStore.getState().mvuKeyMetadata };
                        const conflictedKeys = Array.from(new Set(postInjectConflicts.flatMap(c => [c.key1, c.key2])));
                        for (const k of conflictedKeys) {
                          if (resolvedDict[k] && resolvedDict[k] !== dictAfterConsistency[k]) {
                            updatedMeta[k] = { ...updatedMeta[k], confidence: 'ai' };
                          }
                        }
                        store.setMvuKeyMetadata(updatedMeta);
                        store.setTranslationConfig({ mvuDictionary: resolvedDict });
                        store.addLog('success', `✅ Cross-Script Covariance: AI resolved ${fixedCount} conflict(s)`);
                      } else {
                        store.addLog('warning', `⚠️ Cross-Script Covariance: AI could not auto-resolve conflicts`);
                      }
                    } catch (resolveErr) {
                      const resolveMsg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
                      if (resolveMsg === 'Cancelled' || checkAbort()) throw resolveErr;
                      store.addLog('warning', `⚠️ Cross-Script conflict resolution failed: ${resolveMsg}`);
                    }
                  }
                }
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg === 'Cancelled' || checkAbort()) throw err;
              console.error('Failed to extract early key mappings:', err);
            }
          }
        }
      } catch {
        // Cancel was thrown
        runningRef.current = false;
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

    runningRef.current = false;
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

    // ═══ Post-Translation EJS Sync Verification (Strategy C) ═══
    if (store.translationConfig.enableEjsSync) {
      const ejsEntryDict = store.translationConfig.ejsEntryNameDict;
      const ejsKwDict = store.translationConfig.ejsKeywordDict;
      if (Object.keys(ejsEntryDict).length > 0 || Object.keys(ejsKwDict).length > 0) {
        const doneFields = store.fields.filter(f => f.status === 'done');
        const ejsSyncResult = validateEjsSync(
          doneFields.map(f => ({
            path: f.path,
            group: f.group,
            original: f.original,
            translated: f.translated,
            status: f.status,
          })),
          ejsEntryDict,
          ejsKwDict,
        );

        // Report entry name sync
        if (ejsSyncResult.totalEntryNames > 0) {
          if (ejsSyncResult.missingEntryNames.length === 0) {
            store.addLog('success', `✅ Strategy C: All ${ejsSyncResult.matchedEntryNames} getwi() entry names correctly synced!`);
          } else {
            store.addLog('warning', `⚠️ Strategy C: ${ejsSyncResult.missingEntryNames.length} getwi() entry name(s) NOT synced!`);
            for (const m of ejsSyncResult.missingEntryNames.slice(0, 5)) {
              store.addLog('error', `  getwi() "${m.name}" → "${m.translatedName}" still using original in: ${m.referencedIn.join(', ')}`);
            }
          }
        }

        // Report keyword sync
        if (ejsSyncResult.totalKeywords > 0) {
          if (ejsSyncResult.missingKeywords.length === 0) {
            store.addLog('success', `✅ Strategy C: All ${ejsSyncResult.matchedKeywords} EJS keywords correctly synced!`);
          } else {
            store.addLog('warning', `⚠️ Strategy C: ${ejsSyncResult.missingKeywords.length} EJS keyword(s) NOT synced!`);
            for (const m of ejsSyncResult.missingKeywords.slice(0, 5)) {
              store.addLog('error', `  Keyword "${m.keyword}" → "${m.translatedKeyword}" still original in: ${m.foundIn}`);
            }
          }
        }

        // Report broken decorators
        if (ejsSyncResult.brokenDecorators.length > 0) {
          store.addLog('warning', `⚠️ Strategy C: ${ejsSyncResult.brokenDecorators.length} decorator(s) modified or missing!`);
          for (const d of ejsSyncResult.brokenDecorators.slice(0, 5)) {
            store.addLog('error', `  Decorator "${d.original}" → ${d.translated} in: ${d.fieldPath}`);
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
    if (runningRef.current) {
      // The translation loop is still alive (paused in waitForPause),
      // just flip the flag and it will continue on its own.
      store.setPhase('translating');
      store.addLog('info', 'Translation resumed');
    } else {
      // The translation loop has exited (e.g., API error during pause killed it).
      // We need to restart via continueTranslation to pick up where we left off.
      store.addLog('info', 'Translation loop was not active — restarting via continue...');
      // Reset any fields stuck in 'translating' status back to 'pending'
      const stuckFields = useStore.getState().fields.filter(f => f.status === 'translating');
      for (const f of stuckFields) {
        store.updateField(f.path, { status: 'pending' });
      }
      store.setPhase('translating');
      // Use setTimeout to avoid calling startTranslation synchronously inside this callback
      setTimeout(() => {
        startTranslation(true);
      }, 0);
    }
  }, [store, startTranslation]);

  const cancelTranslation = useCallback(() => {
    abortRef.current?.abort();
    // Also cancel any per-field in-flight translations
    for (const [, ctrl] of fieldAbortMap.current) {
      ctrl.abort();
    }
    fieldAbortMap.current.clear();
    pauseRef.current = false;
    runningRef.current = false;
    // Reset any fields stuck in 'translating' status back to 'pending'
    const stuckFields = useStore.getState().fields.filter(f => f.status === 'translating');
    for (const f of stuckFields) {
      store.updateField(f.path, { status: 'pending' });
    }
    store.setPhase('cancelled');
  }, [store]);

  const cancelFieldTranslation = useCallback((path: string) => {
    const ctrl = fieldAbortMap.current.get(path);
    if (ctrl) {
      ctrl.abort();
      fieldAbortMap.current.delete(path);
    }
    // Reset field status from 'translating' back to its previous state
    const field = useStore.getState().fields.find(f => f.path === path);
    if (field && field.status === 'translating') {
      store.updateField(path, { status: field.translated ? 'done' : 'pending' });
    }
    store.addLog('info', `⏹ Cancelled translation for field: ${path}`);
  }, [store]);

  const cancelAllFieldTranslations = useCallback(() => {
    // Cancel global abort
    abortRef.current?.abort();
    // Cancel all per-field in-flight translations
    for (const [, ctrl] of fieldAbortMap.current) {
      ctrl.abort();
    }
    fieldAbortMap.current.clear();
    pauseRef.current = false;
    runningRef.current = false;
    // Reset any fields stuck in 'translating' status
    const stuckFields = useStore.getState().fields.filter(f => f.status === 'translating');
    for (const f of stuckFields) {
      store.updateField(f.path, { status: f.translated ? 'done' : 'pending' });
    }
    store.addLog('info', `⏹ Cancelled all in-flight translations (${stuckFields.length} fields reset)`);
  }, [store]);

  const retranslateField = useCallback(async (path: string, resume = false) => {
    const field = store.fields.find((f) => f.path === path);
    if (!field) return;

    // ═══ Cancel any previous in-flight translation for this field ═══
    const prevController = fieldAbortMap.current.get(path);
    if (prevController) {
      prevController.abort();
      fieldAbortMap.current.delete(path);
    }
    const controller = new AbortController();
    fieldAbortMap.current.set(path, controller);
    store.updateField(path, { status: 'translating', error: undefined });

    // Read fresh field state from store to prevent stale reference
    const freshField = useStore.getState().fields.find(f => f.path === path) || field;
    const prevChunks = resume && freshField.completedChunks && freshField.completedChunks.length > 0
      ? freshField.completedChunks
      : undefined;

    if (prevChunks) {
      store.addLog('active', `Re-translating: ${field.label} (Resuming from chunk ${prevChunks.length + 1})`);
    } else {
      store.addLog('active', `Re-translating: ${field.label}`);
      // Clear chunk progress if we are translating from scratch
      store.updateField(path, { completedChunks: undefined, rawChunks: undefined, failedChunkIndex: undefined, totalChunks: undefined });
    }

    try {
      // Contextual keyword translation for retranslate
      // IMPORTANT: Read fresh fields from store for up-to-date translated content
      const retranslateFreshFields = useStore.getState().fields;
      let contextHint: string | undefined;
      if (field.group === 'lorebook_keys') {
        const contentPath = field.path.replace('.keys', '.content').replace('.secondary_keys', '.content');
        const contentField = retranslateFreshFields.find(f => f.path === contentPath);
        if (contentField) {
          contextHint = (contentField.translated || contentField.original || '').slice(0, 1500);
        }
      }

      // ═══ Centralized prompt building (single source of truth) ═══
      // Build entry name dictionary from already-translated lorebook name fields
      const retranslateEntryNameDict = { ...buildEntryNameDictionary(retranslateFreshFields), ...buildRegexTriggerDictionary(retranslateFreshFields) };


      const targetModel = store.translationConfig.enableModelRouting
        ? (store.translationConfig.entryModelRouting[field.path] || store.translationConfig.groupModelRouting[field.group] || store.proxy.model)
        : store.proxy.model;
      const effectiveProxy = targetModel !== store.proxy.model ? { ...store.proxy, model: targetModel } : store.proxy;

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: store.translationConfig.enableObjectiveMode,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field,
        allFields: retranslateFreshFields,
        mvuDictionary: useStore.getState().translationConfig.mvuDictionary,
        glossary: store.translationConfig.glossary,
        customSchema: store.translationConfig.customSchema,
        liveSchemaContext: store.liveSchemaContext,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(retranslateEntryNameDict).length > 0 ? retranslateEntryNameDict : undefined,
        expertMode: effectiveProxy.expertMode,
        enableModMode: store.translationConfig.enableModMode,
        modInstructions: store.translationConfig.modInstructions,
      
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });

      const resolvedFieldType = fieldGroupToFieldType(field.group, field.entryType);
      const currentMvuDict = store.translationConfig.enableMvuSync
        ? useStore.getState().translationConfig.mvuDictionary
        : undefined;

      let translated = await translateText(
        field.original,
        field.label,
        effectiveProxy,
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
        store.translationConfig.chunkSize,
        prevChunks,
        // onChunkComplete: save chunk progress in real-time (supports out-of-order for parallel)
        (chunkIdx, translatedChunk, totalChunks) => {
          const currentField = useStore.getState().fields.find(f => f.path === field.path);
          const currentCompleted = currentField?.completedChunks || [];
          const updatedChunks = [...currentCompleted];
          while (updatedChunks.length <= chunkIdx) updatedChunks.push('');
          updatedChunks[chunkIdx] = translatedChunk;
          store.updateField(field.path, {
            completedChunks: updatedChunks,
            totalChunks,
          });
        },
        store.translationConfig.parallelChunks,
        store.translationConfig.enableChunkVerification,
        // onChunksReady
        (rawChunks) => {
          store.updateField(field.path, {
            rawChunks,
          });
        },
        // cssCjkHandling
        store.translationConfig.cssCjkHandling,
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
      // Smart-quote fix for ALL code fields (regex Manager, external custom code, TavernHelper):
      // turns “ ” ‘ ’ ＂ ＇ back into straight " ' so the translated regex/JS actually runs.
      if (translated && (field.group === 'regex' || field.group === 'tavern_helper')) {
        translated = normalizeSmartQuotesInCode(translated);
      }

      store.updateField(path, {
        status: 'done',
        translated,
        failedChunkIndex: undefined,
      });
      store.addLog('success', `Re-translated: ${field.label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Cancelled' || msg === 'The operation was aborted' || msg === 'The user aborted a request.') {
        // Silently ignore abort — field was cancelled because a new retranslate started
        store.updateField(path, { status: 'pending' });
        return;
      }
      if (err instanceof ChunkError) {
        store.updateField(path, {
          status: 'error',
          error: msg,
          completedChunks: err.completedChunks,
          failedChunkIndex: err.failedChunkIndex,
          totalChunks: err.totalChunks,
        });
        store.addLog('error', `Re-translate failed: ${field.label} — chunk ${err.failedChunkIndex + 1}/${err.totalChunks} (${err.completedChunks.length} saved)`);
      } else {
        store.updateField(path, { status: 'error', error: msg });
        store.addLog('error', `Re-translate failed: ${field.label} — ${msg}`);
      }
    } finally {
      // Clean up per-field abort controller
      fieldAbortMap.current.delete(path);
    }
  }, [store]);

  const getExportCard = useCallback(() => {
    if (!store.card) return null;

    // ═══ COVARIANCE FIX: Correct order of operations ═══
    // 1. First, run syncMvuVariables on the ORIGINAL card where CJK variable names
    //    still exist. This ensures all variable names are consistently replaced
    //    across schema, initvar, regex, lorebook, and narrative fields.
    // 2. Then, overlay AI translations on top. For fields that were translated,
    //    the AI output (which was guided by the MVU dictionary) takes precedence.
    //    For fields that were NOT translated, the MVU-synced version persists.
    //
    // Previous order was: applyTranslations → syncMvu (WRONG — CJK vars already
    // replaced by AI, so syncMvu couldn't find them → inconsistent variable names).
    let baseCard = store.card;
    if (store.translationConfig.enableMvuSync && Object.keys(store.translationConfig.mvuDictionary).length > 0) {
      // Prior to export, enforce exact consistency of the dictionary
      const currentDict = store.translationConfig.mvuDictionary;
      const { fixedDict, fixes } = enforceExactConsistency(currentDict, useStore.getState().mvuKeyMetadata);
      if (fixes.length > 0) {
        store.setTranslationConfig({ mvuDictionary: fixedDict });
        store.addLog('info', `🔒 Export exact consistency: fixed ${fixes.length} case/spelling variations: ${fixes.join(', ')}`);
      }

      const enabledGroups = store.translationConfig.fieldGroups
        .filter((g: FieldGroupConfig) => g.enabled)
        .map((g: FieldGroupConfig) => g.id);
      baseCard = syncMvuVariables(baseCard, fixes.length > 0 ? fixedDict : currentDict, enabledGroups);
    }

    // Now overlay AI translations on the MVU-synced card
    let exportCard = applyTranslationsToCard(baseCard, store.fields, store.translationConfig.exportKeyMode);
    
    // B3 FIX: Auto-add translated trigger keys for lorebook entries.
    // Ensures CJK trigger keys are supplemented with their translated equivalents
    // so lorebook entries activate correctly when the AI writes in the target language.
    exportCard = autoTranslateLorebookTriggerKeys(
      exportCard,
      store.fields,
      store.translationConfig.enableMvuSync ? store.translationConfig.mvuDictionary : undefined
    );
    
    return exportCard;
  }, [store]);

  /** Continue translation — merge with existing done fields, only translate pending/error */
  const continueTranslation = useCallback(async () => {
    await startTranslation(true);
  }, [startTranslation]);

  /** Retry all fields that are in 'error' status */
  const retryAllErrors = useCallback(async () => {
    const errorFields = useStore.getState().fields.filter(f => f.status === 'error');
    if (errorFields.length === 0) {
      store.addToast('info', 'No error fields to retry');
      return;
    }

    // ═══ Properly manage phase and abort controller for retry ═══
    if (abortRef.current) {
      abortRef.current.abort();
    }
    for (const [, ctrl] of fieldAbortMap.current) {
      ctrl.abort();
    }
    fieldAbortMap.current.clear();
    abortRef.current = new AbortController();
    pauseRef.current = false;
    runningRef.current = true;
    store.setPhase('translating');

    store.addLog('info', `♻️ Retrying ${errorFields.length} failed field(s)...`);
    let successCount = 0;
    let failCount = 0;

    for (const field of errorFields) {
      // Check abort/pause between fields
      if (checkAbort()) {
        runningRef.current = false;
        store.setPhase('cancelled');
        store.addLog('warning', 'Retry cancelled by user');
        return;
      }
      if (await waitForPause()) {
        runningRef.current = false;
        store.setPhase('cancelled');
        return;
      }

      let attempts = 0;
      const maxAttempts = 2; // Auto-retry up to 2 times for chunk errors
      let success = false;

      while (attempts <= maxAttempts) {
        try {
          // Cancel any previous in-flight translation for this field
          const prevCtrl = fieldAbortMap.current.get(field.path);
          if (prevCtrl) {
            prevCtrl.abort();
            fieldAbortMap.current.delete(field.path);
          }
          const retryController = new AbortController();
          fieldAbortMap.current.set(field.path, retryController);
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

          // Chunk-level resume: pass previously completed chunks if available dynamically from the store
          const freshField = useStore.getState().fields.find(f => f.path === field.path) || field;
          const prevChunks = freshField.completedChunks && freshField.completedChunks.length > 0
            ? freshField.completedChunks
            : undefined;

          if (prevChunks && attempts === 0) {
            const filledCount = prevChunks.filter(c => c && c.length > 0).length;
            store.addLog('info', `🔄 Resuming ${field.label}: ${filledCount} chunks cached`);
          }

          const translated = await translateText(
            field.original,
            field.label,
            store.proxy,
            store.translationConfig.targetLanguage,
            store.translationConfig.sourceLanguage,
            store.translationConfig.translationPrompt,
            store.translationConfig.customSchema,
            abortRef.current?.signal,
            contextHint,
            store.translationConfig.glossary,
            field.previousTranslation,
            undefined,
            undefined,
            store.translationConfig.chunkSize,
            prevChunks,
            // onChunkComplete: save chunk progress in real-time (supports out-of-order for parallel)
            (chunkIdx, translatedChunk, totalChunks) => {
              const currentField = useStore.getState().fields.find(f => f.path === field.path);
              const currentCompleted = currentField?.completedChunks || [];
              const updatedChunks = [...currentCompleted];
              while (updatedChunks.length <= chunkIdx) updatedChunks.push('');
              updatedChunks[chunkIdx] = translatedChunk;
              store.updateField(field.path, {
                completedChunks: updatedChunks,
                totalChunks,
              });
            },
            store.translationConfig.parallelChunks,
            store.translationConfig.enableChunkVerification,
            // onChunksReady
            (rawChunks) => {
              store.updateField(field.path, {
                rawChunks,
              });
            },
            // cssCjkHandling
            store.translationConfig.cssCjkHandling,
          );

          // Keep chunk progress for export, clear failed index only
          store.updateField(field.path, {
            status: 'done', translated, retries: field.retries + attempts + 1,
            failedChunkIndex: undefined,
          });
          store.addLog('success', `✓ Retry OK: ${field.label}`);
          successCount++;
          success = true;
          fieldAbortMap.current.delete(field.path);

          // Delay between retries
          if (store.proxy.requestDelay > 0) {
            await new Promise(r => setTimeout(r, store.proxy.requestDelay));
          }
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          // Handle cancellation during retry
          if (msg === 'Cancelled' || msg === 'The operation was aborted' || msg === 'The user aborted a request.' || checkAbort()) {
            store.updateField(field.path, { status: 'error', error: 'Cancelled' });
            fieldAbortMap.current.delete(field.path);
            runningRef.current = false;
            store.setPhase('cancelled');
            store.addLog('warning', 'Retry cancelled by user');
            return;
          }

          attempts++;

          // Check if chunking is expected
          const currentMaxTokens = store.proxy.maxTokens;
          const currentChunkSize = store.translationConfig.chunkSize;
          const CHUNK_THRESHOLD = currentChunkSize && currentChunkSize >= 100
            ? currentChunkSize
            : (currentMaxTokens && currentMaxTokens > 0 ? Math.min(Math.floor(currentMaxTokens * 3.5), 200000) : 100000);
          const isChunked = field.original.length > CHUNK_THRESHOLD;

          if (isChunked && attempts <= maxAttempts) {
            if (err instanceof ChunkError) {
              store.updateField(field.path, {
                completedChunks: err.completedChunks,
                failedChunkIndex: err.failedChunkIndex,
                totalChunks: err.totalChunks,
              });
              store.addLog('retry', `⚠️ Lỗi thử lại chunk ${err.failedChunkIndex + 1}/${err.totalChunks}. Đang tự động thử lại (Attempt ${attempts}/${maxAttempts})...`);
            } else {
              store.addLog('retry', `⚠️ Lỗi thử lại chunk 1. Đang tự động thử lại (Attempt ${attempts}/${maxAttempts})...`);
            }
            await new Promise(r => setTimeout(r, store.proxy.retryDelay || 1000));
            continue;
          }

          // If we reach here, it failed and we are not retrying
          if (err instanceof ChunkError) {
            store.updateField(field.path, {
              status: 'error', error: msg, retries: field.retries + attempts,
              completedChunks: err.completedChunks,
              failedChunkIndex: err.failedChunkIndex,
              totalChunks: err.totalChunks,
            });
            store.addLog('error', `✗ Retry failed: ${field.label} — chunk ${err.failedChunkIndex + 1}/${err.totalChunks} (${err.completedChunks.length} saved)`);
          } else {
            store.updateField(field.path, { status: 'error', error: msg, retries: field.retries + attempts });
            store.addLog('error', `✗ Retry failed: ${field.label} — ${msg}`);
          }
          failCount++;
          fieldAbortMap.current.delete(field.path);

          // Delay between retries
          if (store.proxy.requestDelay > 0) {
            await new Promise(r => setTimeout(r, store.proxy.requestDelay));
          }
          break;
        }
      }
    }

    runningRef.current = false;
    // Only set phase to done/cancelled if still in 'translating' (not already cancelled by user)
    if (useStore.getState().phase === 'translating') {
      store.setPhase(failCount > 0 ? 'done' : 'done');
    }
    store.saveTranslationCache();
    store.addLog('info', `Retry complete: ${successCount} fixed, ${failCount} still failing`);
    store.addToast(failCount === 0 ? 'success' : 'error', `Retry: ${successCount}/${errorFields.length} fixed`);
  }, [store]);

  /** Apply Mod instructions to a single field by path (standalone mode — no language change) */
  const applyModToField = useCallback(async (path: string) => {
    const modInstructions = store.translationConfig.modInstructions?.trim();
    if (!modInstructions) {
      store.addToast('error', 'Mod instructions are empty. Please enter instructions first.');
      return;
    }

    const field = store.fields.find(f => f.path === path);
    if (!field) {
      store.addToast('error', 'Field not found.');
      return;
    }

    const inputContent = field.translated || field.original;
    if (!inputContent || !inputContent.trim()) {
      store.addToast('error', 'Field has no content to mod.');
      return;
    }

    // Auto-detect language from field content
    const detectedLang = detectLanguage(inputContent);
    const effectiveLang = detectedLang === 'unknown' || detectedLang === 'mixed'
      ? store.translationConfig.targetLanguage
      : detectedLang;

    const controller = new AbortController();
    store.updateField(path, { status: 'translating', error: undefined });
    store.addLog('active', `🔧 Modding single field: ${field.label}`);

    try {
      // ═══ MVU variable rename — same as applyModToAllFields ═══
      // If MVU sync is enabled but no dictionary exists yet (first per-field mod),
      // run the same scan + AI rename pipeline to build the mapping.
      if (store.translationConfig.enableMvuSync && store.card) {
        const existingDict = useStore.getState().translationConfig.mvuDictionary;
        const hasDict = Object.keys(existingDict).filter(k => existingDict[k] && k !== existingDict[k]).length > 0;

        if (!hasDict) {
          try {
            store.addLog('info', '🔧 Single-field Mod: Scanning MVU/Zod variables...');
            // Build current-state card with already-modded fields applied
            const currentStateCard = applyTranslationsToCard(store.card!, useStore.getState().fields, 'merge');
            const extractedKeys = extractPotentialMvuKeyStrings(currentStateCard);

            if (extractedKeys.length > 0) {
              store.addLog('active', `🤖 Renaming ${extractedKeys.length} variable names with Mod instructions...`);

              // Schema context: prefer already-modded tavern_helper content > customSchema > original card scripts
              let schemaContext = store.translationConfig.customSchema || '';
              if (!schemaContext.trim()) {
                const moddedSchemaFields = useStore.getState().fields
                  .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated?.trim());
                if (moddedSchemaFields.length > 0) {
                  schemaContext = moddedSchemaFields.map(f => f.translated).join('\n\n');
                  store.addLog('info', '📋 Using already-modded TavernHelper schema for MVU scan');
                } else if (store.card?.data?.extensions?.tavern_helper?.scripts) {
                  schemaContext = store.card.data.extensions.tavern_helper.scripts.map(s => s.content).join('\n\n');
                }
              }

              let keyDescriptions: Record<string, string> = {};
              if (schemaContext) {
                keyDescriptions = extractZodDescriptions(schemaContext);
              }

              const renames = await aiRenameMvuKeys(
                extractedKeys,
                effectiveLang,
                modInstructions,
                store.proxy,
                controller.signal,
                schemaContext,
                keyDescriptions
              );

              const newDict: Record<string, string> = {};
              let changedCount = 0;
              for (const [k, v] of Object.entries(renames)) {
                if (v && v.trim()) {
                  newDict[k] = v.trim();
                  if (k !== v.trim()) changedCount++;
                }
              }

              if (changedCount > 0) {
                store.setTranslationConfig({ mvuDictionary: newDict });
                store.addLog('success', `✅ Mod: ${changedCount} variable(s) will be renamed during sync`);
              } else {
                store.addLog('info', 'Mod instructions did not change any variable names');
              }
            }
          } catch (mvuErr) {
            const mvuMsg = mvuErr instanceof Error ? mvuErr.message : String(mvuErr);
            store.addLog('warning', `⚠️ MVU rename scan failed (non-critical): ${mvuMsg}`);
          }
        }
      }

      // Contextual keyword translation for lorebook_keys
      // IMPORTANT: Read fresh fields from store for up-to-date translated content
      let contextHint: string | undefined;
      if (field.group === 'lorebook_keys') {
        const contentPath = field.path.replace('.keys', '.content').replace('.secondary_keys', '.content');
        const contentField = useStore.getState().fields.find(f => f.path === contentPath);
        if (contentField) {
          contextHint = (contentField.translated || contentField.original || '').slice(0, 1500);
        }
      }

      // Read fresh state for dynamic dictionaries
      const freshState = useStore.getState();
      const freshFields = freshState.fields;
      const freshMvuDict = freshState.translationConfig.mvuDictionary;
      const freshLiveSchema = freshState.liveSchemaContext;

      // Build effective schema: prefer modded tavern_helper content over original
      let effectiveCustomSchema = store.translationConfig.customSchema || '';
      if (!effectiveCustomSchema.trim()) {
        const moddedSchemaFields = freshFields
          .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated?.trim());
        if (moddedSchemaFields.length > 0) {
          effectiveCustomSchema = moddedSchemaFields.map(f => f.translated).join('\n\n');
        }
      }

      const modEntryNameDict = buildEntryNameDictionary(freshFields);
      const modRegexTriggerDict = buildRegexTriggerDictionary(freshFields);

      const targetModel = store.translationConfig.enableModelRouting
        ? (store.translationConfig.entryModelRouting[field.path] || store.translationConfig.groupModelRouting[field.group] || store.proxy.model)
        : store.proxy.model;
      const effectiveProxy = targetModel !== store.proxy.model ? { ...store.proxy, model: targetModel } : store.proxy;

      const promptResult = buildEffectivePrompt({
        translationPrompt: store.translationConfig.translationPrompt,
        enableJailbreak: store.translationConfig.enableJailbreak,
        enableObjectiveMode: false,
        enableMvuSync: store.translationConfig.enableMvuSync,
        enableRAGContext: store.translationConfig.enableRAGContext,
        field,
        allFields: freshFields,
        mvuDictionary: freshMvuDict,
        glossary: store.translationConfig.glossary,
        customSchema: effectiveCustomSchema,
        liveSchemaContext: freshLiveSchema,
        ragMaxFields: store.translationConfig.ragMaxFields,
        ragMaxChars: store.translationConfig.ragMaxChars,
        entryNameDictionary: Object.keys(modEntryNameDict).length > 0 ? modEntryNameDict : undefined,
        regexTriggerDictionary: Object.keys(modRegexTriggerDict).length > 0 ? modRegexTriggerDict : undefined,
        expertMode: effectiveProxy.expertMode,
        enableModMode: true,
        modInstructions: store.translationConfig.modInstructions,
        forceModStandalone: true,
        enablePatchMode: store.translationConfig.enablePatchMode,
      
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });

      const resolvedFieldType = fieldGroupToFieldType(field.group, field.entryType);
      const currentMvuDict = store.translationConfig.enableMvuSync
        ? freshMvuDict
        : undefined;

      let result = await translateText(
        inputContent,
        field.label,
        effectiveProxy,
        effectiveLang,
        effectiveLang,
        promptResult.effectivePrompt,
        promptResult.schemaForApi,
        controller.signal,
        contextHint,
        promptResult.glossaryForApi,
        undefined,
        resolvedFieldType,
        currentMvuDict,
        store.translationConfig.chunkSize,
        undefined, // previouslyCompletedChunks
        undefined, // onChunkComplete
        undefined, // parallelChunks
        undefined, // enableChunkVerification
        undefined, // onChunksReady
        store.translationConfig.cssCjkHandling,
      );

      // ═══ PATCH MODE: parse find/replace patches and apply to original ═══
      const isRegexContent = field.group === 'regex' && (field.path.includes('replaceString') || field.path.includes('trimStrings'));
      const isPatchMode = store.translationConfig.enablePatchMode && isRegexContent;

      if (isPatchMode && result) {
        const patches = parsePatchOutput(result);
        if (patches.length > 0) {
          const patchResult = applyPatches(inputContent, patches);
          const validation = validatePatchResult(inputContent, patchResult.result);

          if (patchResult.applied > 0) {
            store.addLog('success', `🩹 Patch: ${patchResult.applied}/${patchResult.totalPatches} applied to ${field.label}`);
            if (patchResult.failed.length > 0) {
              store.addLog('warning', `🩹 ${patchResult.failed.length} patch(es) not found: ${patchResult.failed.slice(0, 2).join(', ')}`);
            }
            if (!validation.valid) {
              store.addLog('warning', `🩹 Structure warnings: ${validation.warnings.join('; ')}`);
            }
            result = patchResult.result;
          } else {
            // All patches failed — fallback to full mode
            store.addLog('warning', `🩹 All patches failed to match — falling back to full mode for ${field.label}`);
            const fullPromptResult = buildEffectivePrompt({
              translationPrompt: store.translationConfig.translationPrompt,
              enableJailbreak: store.translationConfig.enableJailbreak,
              enableObjectiveMode: false,
              enableMvuSync: store.translationConfig.enableMvuSync,
              enableRAGContext: store.translationConfig.enableRAGContext,
              enablePatchMode: false,
              enableModMode: true,
              modInstructions: store.translationConfig.modInstructions,
              forceModStandalone: true,
              field,
              allFields: freshFields,
              mvuDictionary: freshMvuDict,
              glossary: store.translationConfig.glossary,
              customSchema: effectiveCustomSchema,
              liveSchemaContext: freshLiveSchema,
              ragMaxFields: store.translationConfig.ragMaxFields,
              ragMaxChars: store.translationConfig.ragMaxChars,
              expertMode: effectiveProxy.expertMode,
            
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });
            result = await translateText(
              inputContent, field.label, effectiveProxy, effectiveLang, effectiveLang,
              fullPromptResult.effectivePrompt, fullPromptResult.schemaForApi,
              controller.signal, contextHint, fullPromptResult.glossaryForApi,
              undefined, resolvedFieldType, currentMvuDict, store.translationConfig.chunkSize,
              undefined, undefined, undefined, undefined, undefined,
              store.translationConfig.cssCjkHandling,
            );
          }
        } else if (/<<<\s*NO_CHANGES\s*>>>/.test(result)) {
          // AI says no changes needed
          store.addLog('info', `🩹 Patch: no changes needed for ${field.label}`);
          result = inputContent;
        } else {
          // Parse failed — fallback to treating as full output
          store.addLog('warning', `🩹 Patch parse failed — treating response as full output for ${field.label}`);
        }
      }

      // Post-process regex HTML
      if (isRegexContent && result) {
        result = postProcessRegexHtml(result);
      }
      if (field.group === 'tavern_helper' && result && /<[a-z][^>]*>/i.test(result)) {
        result = postProcessRegexHtml(result);
      }

      if (!result || !result.trim()) {
        store.updateField(path, { status: 'error', error: 'Mod returned empty result' });
        store.addLog('error', `🔧 Mod returned empty for: ${field.label}`);
        return;
      }

      // Post-mod MVU Validation + Auto-fix
      const mvuDict = store.translationConfig.enableMvuSync ? freshMvuDict : {};
      const hasMvuDict = Object.keys(mvuDict).filter(k => mvuDict[k] && k !== mvuDict[k]).length > 0;

      if (hasMvuDict) {
        const fieldType = (field.entryType || field.group) as any;
        const validation = validateMvuVariables(inputContent, result, mvuDict, fieldType);

        if (validation.unreplaced.length > 0) {
          const fixed = autoFixMvuVariables(result, mvuDict, validation.unreplaced);
          if (fixed !== result) {
            result = fixed;
            store.addLog('info', `🔧 Auto-fixed ${validation.unreplaced.length} MVU vars in ${field.label}`);
          }
        }
      }

      store.updateField(path, { status: 'done', translated: result });
      store.addLog('success', `🔧 Modded: ${field.label}`);
      store.addToast('success', `Mod applied to ${field.label}`);

      // ═══ Live Schema Capture: if modded a tavern_helper, update liveSchemaContext ═══
      // so subsequent single-field mods see the updated key names
      if (field.group === 'tavern_helper') {
        const currentCustomSchema = store.translationConfig.customSchema;
        if (!currentCustomSchema?.trim()) {
          const allModdedSchemas = useStore.getState().fields
            .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated?.trim())
            .map(f => f.translated)
            .join('\n\n');
          if (allModdedSchemas.trim()) {
            store.setLiveSchemaContext(allModdedSchemas);
            store.addLog('info', '📋 Live Schema: captured modded TavernHelper → context for subsequent mods');
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.updateField(path, { status: 'error', error: msg });
      store.addLog('error', `🔧 Mod failed: ${field.label} — ${msg}`);
      store.addToast('error', `Mod failed: ${field.label}`);
    }
  }, [store]);

  /** Apply Mod instructions to all fields in-place (standalone mode — no language change) */
  const applyModToAllFields = useCallback(async (isContinue: boolean = false) => {
    const modInstructions = store.translationConfig.modInstructions?.trim();
    if (!modInstructions) {
      store.addToast('error', 'Mod instructions are empty. Please enter instructions first.');
      return;
    }

    if (!store.card) {
      store.addToast('error', 'No card loaded. Please upload a card first.');
      return;
    }

    // Auto-prepare fields if empty (user clicks Apply Mod without translating first)
    let currentFields = store.fields;
    if (currentFields.length === 0) {
      currentFields = prepareFields(false);
      if (currentFields.length === 0) {
        store.addToast('error', 'No translatable fields found in card.');
        return;
      }
    }

    // Get all fields that have content (translated or original)
    const enabledGroups = store.translationConfig.fieldGroups
      .filter((g: FieldGroupConfig) => g.enabled)
      .map((g: FieldGroupConfig) => g.id);

    const targetFields = currentFields.filter(f => {
      if (f.status === 'ignored') return false;
      if (isContinue && f.status === 'done') return false; // Skip already done fields when continuing
      if (!enabledGroups.includes(f.group)) return false;
      const content = f.translated || f.original;
      return content && content.trim().length > 0;
    });

    if (targetFields.length === 0) {
      store.addToast('info', 'No fields to apply Mod to (or all selected fields are already done).');
      return;
    }

    // Auto-detect language from first substantial field
    const sampleField = targetFields.find(f => (f.translated || f.original).length > 50) || targetFields[0];
    const sampleContent = sampleField.translated || sampleField.original;
    const detectedLang = detectLanguage(sampleContent);
    const effectiveLang = detectedLang === 'unknown' || detectedLang === 'mixed'
      ? store.translationConfig.targetLanguage
      : detectedLang;

    // ═══ Abort any previous running operation before starting fresh ═══
    if (abortRef.current) {
      abortRef.current.abort();
    }
    // Also cancel any per-field in-flight translations (from retranslate/retry)
    for (const [, ctrl] of fieldAbortMap.current) {
      ctrl.abort();
    }
    fieldAbortMap.current.clear();

    // Clear state for fresh progress tracking
    abortRef.current = new AbortController();
    pauseRef.current = false;
    runningRef.current = true;
    store.setPhase('translating');
    store.setStartTime(Date.now());
    store.clearLogs();
    store.setPreprocessProgress(null);
    CallMonitor.reset();

    store.addLog('info', `🔧 Applying Mod to ${targetFields.length} field(s) [Language: ${effectiveLang}]`);
    store.addLog('info', `📝 Mod instructions: "${modInstructions.slice(0, 100)}${modInstructions.length > 100 ? '...' : ''}"`);

    // ═══ Clear RAG cache + live schema context for fresh state ═══
    clearRAGCache();
    store.clearLiveSchemaContext();
    if (store.translationConfig.enableRAGContext) {
      store.addLog('info', '🧠 Cross-field Context RAG enabled for Mod');
    }

    // ═══ Rename MVU variables theo Mod instructions ═══
    // Tìm biến → đổi tên theo yêu cầu Mod → dùng mapping để đồng bộ biến khi Mod
    if (store.translationConfig.enableMvuSync && store.card) {
      try {
        store.addLog('info', '🔧 Mod: Scanning MVU/Zod variables...');
        // Build current-state card with already-modded fields applied
        const currentStateCard = applyTranslationsToCard(store.card!, useStore.getState().fields, 'merge');
        const extractedKeys = extractPotentialMvuKeyStrings(currentStateCard);

        if (extractedKeys.length > 0) {
          store.addLog('active', `🤖 Renaming ${extractedKeys.length} variable names with Mod instructions...`);

          let schemaContext = store.translationConfig.customSchema || '';
          if (!schemaContext.trim()) {
            // Prefer already-modded tavern_helper content > original card scripts
            const moddedSchemaFields = useStore.getState().fields
              .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated?.trim());
            if (moddedSchemaFields.length > 0) {
              schemaContext = moddedSchemaFields.map(f => f.translated).join('\n\n');
              store.addLog('info', '📋 Using already-modded TavernHelper schema for MVU scan');
            } else if (store.card?.data?.extensions?.tavern_helper?.scripts) {
              schemaContext = store.card.data.extensions.tavern_helper.scripts.map(s => s.content).join('\n\n');
            }
          }

          let keyDescriptions: Record<string, string> = {};
          if (schemaContext) {
            keyDescriptions = extractZodDescriptions(schemaContext);
          }

          const renames = await aiRenameMvuKeys(
            extractedKeys,
            effectiveLang,
            modInstructions,
            store.proxy,
            abortRef.current?.signal,
            schemaContext,
            keyDescriptions
          );

          // Build MVU dictionary: old_name → new_name (chỉ giữ key thực sự đổi)
          const newDict: Record<string, string> = {};
          let changedCount = 0;
          for (const [k, v] of Object.entries(renames)) {
            if (v && v.trim()) {
              newDict[k] = v.trim();
              if (k !== v.trim()) changedCount++;
            }
          }

          if (changedCount > 0) {
            store.setTranslationConfig({ mvuDictionary: newDict });
            store.addLog('success', `✅ Mod: ${changedCount} variable(s) will be renamed during Mod sync`);
          } else {
            store.addLog('info', 'Mod instructions did not change any variable names');
          }
        } else {
          store.addLog('info', 'No MVU/Zod variables detected in this card');
        }
      } catch (mvuErr) {
        const mvuMsg = mvuErr instanceof Error ? mvuErr.message : String(mvuErr);
        if (mvuMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase('cancelled');
          return;
        }
        store.addLog('warning', `⚠️ MVU rename failed (non-critical): ${mvuMsg}`);
      }
    }

    // ═══ MVU-optimized field ordering ═══
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
      const TYPE_ORDER: Record<string, number> = {
        initvar: 0,
        controller: 1,
        mvu_logic: 2,
        rules: 3,
        narrative: 4,
        other: 5
      };
      targetFields.sort((a, b) => {
        const orderA = MVU_GROUP_ORDER[a.group] ?? 99;
        const orderB = MVU_GROUP_ORDER[b.group] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        if (a.group === 'lorebook' || a.group === 'lorebook_keys') {
          const tA = TYPE_ORDER[a.entryType || 'other'] ?? 99;
          const tB = TYPE_ORDER[b.entryType || 'other'] ?? 99;
          if (tA !== tB) return tA - tB;
        }
        return 0;
      });
      store.addLog('info', '📋 Mod: MVU field ordering → schema → lorebook → regex → OP → rest');
    } else {
      // Non-MVU: move findRegex fields BEFORE narrative/system fields
      // so regex trigger dictionary is available when modding system prompts
      const hasFindRegex = targetFields.some(f => f.path.includes('findRegex'));
      if (hasFindRegex) {
        const findRegexFields = targetFields.filter(f => f.path.includes('findRegex'));
        const otherFields = targetFields.filter(f => !f.path.includes('findRegex'));
        targetFields.length = 0;
        targetFields.push(...findRegexFields, ...otherFields);
        store.addLog('info', `📋 Mod: findRegex fields moved to front (${findRegexFields.length} patterns → mod before narrative)`);
      }
    }

    let successCount = 0;
    let failCount = 0;
    let autoFixCount = 0;

    // ═══ Helper: Mod a single field (mirrors translateSingleField but uses forceModStandalone) ═══
    const modSingleField = async (field: TranslationField): Promise<'done' | 'error'> => {
      const inputContent = field.translated || field.original;
      store.updateField(field.path, { status: 'translating', error: undefined });

      try {
        // Contextual keyword translation for lorebook_keys (same as translateSingleField)
        let contextHint: string | undefined;
        if (field.group === 'lorebook_keys') {
          const contentPath = field.path.replace('.keys', '.content').replace('.secondary_keys', '.content');
          const currentFields = useStore.getState().fields;
          const contentField = currentFields.find(f => f.path === contentPath);
          if (contentField) {
            contextHint = (contentField.translated || contentField.original || '').slice(0, 1500);
          }
        }

        // Read FRESH state for dynamic dictionaries (updated as fields are modded)
        const freshState = useStore.getState();
        const freshFields = freshState.fields;
        const freshMvuDict = freshState.translationConfig.mvuDictionary;
        const freshLiveSchema = freshState.liveSchemaContext;

        // Build effective schema: prefer modded tavern_helper content over original
        let effectiveCustomSchema = store.translationConfig.customSchema || '';
        if (!effectiveCustomSchema.trim()) {
          const moddedSchemaFields = freshFields
            .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated?.trim());
          if (moddedSchemaFields.length > 0) {
            effectiveCustomSchema = moddedSchemaFields.map(f => f.translated).join('\n\n');
          }
        }

        const modEntryNameDict = buildEntryNameDictionary(freshFields);
        const modRegexTriggerDict = buildRegexTriggerDictionary(freshFields);

        const promptResult = buildEffectivePrompt({
          translationPrompt: store.translationConfig.translationPrompt,
          enableJailbreak: store.translationConfig.enableJailbreak,
          enableObjectiveMode: false,
          enableMvuSync: store.translationConfig.enableMvuSync,
          enableRAGContext: store.translationConfig.enableRAGContext,
          field,
          allFields: freshFields,
          mvuDictionary: freshMvuDict,
          glossary: store.translationConfig.glossary,
          customSchema: effectiveCustomSchema,
          liveSchemaContext: freshLiveSchema,
          ragMaxFields: store.translationConfig.ragMaxFields,
          ragMaxChars: store.translationConfig.ragMaxChars,
          entryNameDictionary: Object.keys(modEntryNameDict).length > 0 ? modEntryNameDict : undefined,
          regexTriggerDictionary: Object.keys(modRegexTriggerDict).length > 0 ? modRegexTriggerDict : undefined,
          expertMode: store.proxy.expertMode,
          enableModMode: true,
          modInstructions: store.translationConfig.modInstructions,
          forceModStandalone: true,
          enablePatchMode: store.translationConfig.enablePatchMode,
        
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });

        const resolvedFieldType = fieldGroupToFieldType(field.group, field.entryType);
        const currentMvuDict = store.translationConfig.enableMvuSync
          ? freshMvuDict
          : undefined;

        let result = await translateText(
          inputContent,
          field.label,
          store.proxy,
          effectiveLang,
          effectiveLang,
          promptResult.effectivePrompt,
          promptResult.schemaForApi,
          abortRef.current?.signal,
          contextHint,
          promptResult.glossaryForApi,
          undefined,
          resolvedFieldType,
          currentMvuDict,
          store.translationConfig.chunkSize
        );

        // ═══ PATCH MODE: parse find/replace patches and apply to original ═══
        const isRegexContent = field.group === 'regex' && (field.path.includes('replaceString') || field.path.includes('trimStrings'));
        const isPatchMode = store.translationConfig.enablePatchMode && isRegexContent;

        if (isPatchMode && result) {
          const patches = parsePatchOutput(result);
          if (patches.length > 0) {
            const patchResult = applyPatches(inputContent, patches);
            const validation = validatePatchResult(inputContent, patchResult.result);

            if (patchResult.applied > 0) {
              store.addLog('success', `🩹 Patch: ${patchResult.applied}/${patchResult.totalPatches} applied to ${field.label}`);
              if (patchResult.failed.length > 0) {
                store.addLog('warning', `🩹 ${patchResult.failed.length} patch(es) not found: ${patchResult.failed.slice(0, 2).join(', ')}`);
              }
              if (!validation.valid) {
                store.addLog('warning', `🩹 Structure warnings: ${validation.warnings.join('; ')}`);
              }
              result = patchResult.result;
            } else {
              // All patches failed — fallback to full mode
              store.addLog('warning', `🩹 All patches failed — falling back to full mode for ${field.label}`);
              const fullPromptResult = buildEffectivePrompt({
                translationPrompt: store.translationConfig.translationPrompt,
                enableJailbreak: store.translationConfig.enableJailbreak,
                enableObjectiveMode: false,
                enableMvuSync: store.translationConfig.enableMvuSync,
                enableRAGContext: store.translationConfig.enableRAGContext,
                field,
                allFields: freshFields,
                mvuDictionary: freshMvuDict,
                glossary: store.translationConfig.glossary,
                customSchema: effectiveCustomSchema,
                liveSchemaContext: freshLiveSchema,
                ragMaxFields: store.translationConfig.ragMaxFields,
                ragMaxChars: store.translationConfig.ragMaxChars,
                entryNameDictionary: Object.keys(modEntryNameDict).length > 0 ? modEntryNameDict : undefined,
                regexTriggerDictionary: Object.keys(modRegexTriggerDict).length > 0 ? modRegexTriggerDict : undefined,
                expertMode: store.proxy.expertMode,
                enableModMode: true,
                modInstructions: store.translationConfig.modInstructions,
                forceModStandalone: true,
                enablePatchMode: false,
              
        enableModThinking: store.translationConfig.enableModThinking,
        modPreset: store.translationConfig.modPreset,
        enableEjsSync: store.translationConfig.enableEjsSync,
        ejsEntryNameDict: useStore.getState().translationConfig.ejsEntryNameDict,
        ejsKeywordDict: useStore.getState().translationConfig.ejsKeywordDict,
        ejsDecoratorPreserve: store.translationConfig.ejsDecoratorPreserve,
        presetPromptContent: getActivePresetPromptContent(store.activePreset?.preset, store.card?.data?.name || store.card?.name),
      });
              result = await translateText(
                inputContent, field.label, store.proxy, effectiveLang, effectiveLang,
                fullPromptResult.effectivePrompt, fullPromptResult.schemaForApi,
                abortRef.current?.signal, contextHint, fullPromptResult.glossaryForApi,
                undefined, resolvedFieldType, currentMvuDict, store.translationConfig.chunkSize
              );
            }
          } else if (/<<<\s*NO_CHANGES\s*>>>/.test(result)) {
            store.addLog('info', `🩹 Patch: no changes needed for ${field.label}`);
            result = inputContent;
          } else {
            store.addLog('warning', `🩹 Patch parse failed — treating as full output for ${field.label}`);
          }
        }

        // Post-process regex HTML
        if (isRegexContent && result) {
          result = postProcessRegexHtml(result);
        }
        if (field.group === 'tavern_helper' && result && /<[a-z][^>]*>/i.test(result)) {
          result = postProcessRegexHtml(result);
        }

        if (!result || !result.trim()) {
          store.updateField(field.path, { status: 'error', error: 'Mod returned empty result' });
          store.addLog('error', `🔧 Mod returned empty for: ${field.label}`);
          failCount++;
          return 'error';
        }

        // Post-mod MVU Validation + Auto-fix (uses freshMvuDict from above)
        const mvuDict = store.translationConfig.enableMvuSync ? freshMvuDict : {};
        const hasMvuDict = Object.keys(mvuDict).filter(k => mvuDict[k] && k !== mvuDict[k]).length > 0;

        if (hasMvuDict) {
          const fieldType = (field.entryType || field.group) as any;
          const validation = validateMvuVariables(inputContent, result, mvuDict, fieldType);

          if (validation.unreplaced.length > 0) {
            const fixed = autoFixMvuVariables(result, mvuDict, validation.unreplaced);
            if (fixed !== result) {
              result = fixed;
              autoFixCount++;
              store.addLog('info', `🔧 Auto-fixed ${validation.unreplaced.length} MVU vars in ${field.label}`);
            } else {
              store.addLog('warning', `⚠️ ${validation.unreplaced.length} unreplaced MVU vars in ${field.label}: ${validation.unreplaced.slice(0, 3).join(', ')}`);
            }
          }

          for (const w of validation.warnings.slice(0, 2)) {
            store.addLog('warning', `${field.label}: ${w}`);
          }
        }

        store.updateField(field.path, { status: 'done', translated: result });
        store.addLog('success', `🔧 Modded: ${field.label}`);
        successCount++;
        return 'done';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Cancelled' || checkAbort()) {
          store.updateField(field.path, { status: 'pending' });
          throw err;
        }
        store.updateField(field.path, { status: 'error', error: msg });
        store.addLog('error', `🔧 Mod failed: ${field.label} — ${msg}`);
        failCount++;
        return 'error';
      }
    };

    // ═══ Helper: Mod one batch of lorebook fields (mirrors translateOneBatch) ═══
    const modOneBatch = async (batchFields: TranslationField[]) => {
      // For batch mod, we build the prompt once with batchFields context
      for (const f of batchFields) {
        store.updateField(f.path, { status: 'translating' });
      }
      store.addLog('active', `🔧 Mod batch: ${batchFields.length} fields`);

      // Process each field in the batch sequentially (mod is per-field API call)
      for (const f of batchFields) {
        if (checkAbort()) throw new Error('Cancelled');
        if (await waitForPause()) throw new Error('Cancelled');
        await modSingleField(f);

        if (store.proxy.requestDelay > 0) {
          await new Promise(r => setTimeout(r, Math.max(store.proxy.requestDelay, 300)));
        }
      }
    };

    // ═══ Main Mod Loop — mirrors startTranslation exactly ═══
    const isBatchLorebook = store.translationConfig.lorebookStrategy === 'batch';
    const batchSize = store.translationConfig.lorebookBatchSize || 20;
    const lorebookGroups: FieldGroup[] = ['lorebook', 'lorebook_keys'];

    let i = 0;
    while (i < targetFields.length) {
      // Check abort
      if (checkAbort()) {
        runningRef.current = false;
        store.setPhase('cancelled');
        store.addLog('warning', '🔧 Mod cancelled by user');
        return;
      }

      // Handle pause
      if (await waitForPause()) {
        runningRef.current = false;
        store.setPhase('cancelled');
        return;
      }

      const field = targetFields[i];

      // ─── Batch mode for lorebook fields (same as startTranslation) ───
      if (isBatchLorebook && lorebookGroups.includes(field.group)) {
        const concurrency = store.translationConfig.concurrentBatches || 1;
        const MAX_BATCH_CHARS = Math.max(store.proxy.maxTokens || 65536, 10000);
        const isMvuEnabled = store.translationConfig.enableMvuSync;

        // Step 1: Collect ALL consecutive lorebook fields
        const allLorebookFields: TranslationField[] = [];
        while (i < targetFields.length && lorebookGroups.includes(targetFields[i].group)) {
          allLorebookFields.push(targetFields[i]);
          i++;
        }

        // Step 2: Split into sub-batches
        const subBatches: TranslationField[][] = [];

        if (isMvuEnabled) {
          // ═══ MVU Smart Grouping: group by entryType first, then split ═══
          const typeGroups: Record<string, TranslationField[]> = {};
          for (const f of allLorebookFields) {
            const typeKey = f.entryType || 'other';
            if (!typeGroups[typeKey]) typeGroups[typeKey] = [];
            typeGroups[typeKey].push(f);
          }

          const TYPE_BATCH_SIZES: Record<string, number> = {
            initvar: 1,
            mvu_logic: 1,
            controller: 1,
            rules: batchSize,
            narrative: batchSize,
            other: batchSize,
          };

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
              const fContent = (f.translated || f.original).length;
              if (currentBatch.length >= typeBatchSize || (currentBatch.length > 0 && currentChars + fContent > MAX_BATCH_CHARS)) {
                subBatches.push(currentBatch);
                currentBatch = [];
                currentChars = 0;
              }
              currentBatch.push(f);
              currentChars += fContent;
            }
            if (currentBatch.length > 0) subBatches.push(currentBatch);
          }

          const groupSummary = sortedTypes
            .map(t => `${t}:${typeGroups[t].length}`)
            .join(', ');
          store.addLog('info', `🔧 Mod MVU batch grouping: ${allLorebookFields.length} fields → [${groupSummary}] → ${subBatches.length} batch(es)`);
        } else {
          // ═══ Standard splitting ═══
          let currentBatch: TranslationField[] = [];
          let currentChars = 0;
          for (const f of allLorebookFields) {
            const fContent = (f.translated || f.original).length;
            if (currentBatch.length >= batchSize || (currentBatch.length > 0 && currentChars + fContent > MAX_BATCH_CHARS)) {
              subBatches.push(currentBatch);
              currentBatch = [];
              currentChars = 0;
            }
            currentBatch.push(f);
            currentChars += fContent;
          }
          if (currentBatch.length > 0) subBatches.push(currentBatch);
          store.addLog('info', `🔧 Mod: ${allLorebookFields.length} lorebook fields → ${subBatches.length} batch(es), concurrency: ${concurrency}`);
        }

        store.setCurrentFieldIndex(i - 1);

        // Step 3: Dispatch sub-batches with concurrency limit
        let batchIdx = 0;
        while (batchIdx < subBatches.length) {
          if (checkAbort()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            store.addLog('warning', '🔧 Mod cancelled');
            return;
          }

          // Handle pause inside mod batch loop
          if (await waitForPause()) {
            runningRef.current = false;
            store.setPhase('cancelled');
            return;
          }

          const window = subBatches.slice(batchIdx, batchIdx + concurrency);
          batchIdx += window.length;

          try {
            const results = await Promise.allSettled(
              window.map(batch => modOneBatch(batch))
            );

            for (const r of results) {
              if (r.status === 'rejected') {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                if (msg === 'Cancelled' || checkAbort()) {
                  runningRef.current = false;
                  store.setPhase('cancelled');
                  store.addLog('warning', '🔧 Mod cancelled');
                  return;
                }
              }
            }
          } catch {
            runningRef.current = false;
            store.setPhase('cancelled');
            store.addLog('warning', '🔧 Mod cancelled');
            return;
          }

          // Delay between batch windows
          if (batchIdx < subBatches.length && store.proxy.requestDelay > 0) {
            await new Promise(r => setTimeout(r, store.proxy.requestDelay));
          }

          store.saveTranslationCache();
        }

        // Delay before next non-lorebook field
        if (i < targetFields.length && store.proxy.requestDelay > 0) {
          await new Promise(r => setTimeout(r, store.proxy.requestDelay));
        }
        continue;
      }

      // ─── Single field mode ───
      try {
        store.setCurrentFieldIndex(i);
        store.addLog('active', `🔧 Modding: ${field.label} (${i + 1}/${targetFields.length})`);
        const result = await modSingleField(field);

        // ═══ Live Schema Injection: capture modded TavernHelper as schema context ═══
        if (field.group === 'tavern_helper' && result === 'done') {
          const currentSchema = store.translationConfig.customSchema;
          if (!currentSchema?.trim()) {
            const allModdedSchemas = useStore.getState().fields
              .filter(f => f.group === 'tavern_helper' && f.status === 'done' && f.translated)
              .map(f => f.translated)
              .join('\n\n');
            if (allModdedSchemas.trim()) {
              store.setLiveSchemaContext(allModdedSchemas);
              store.addLog('info', '📋 Live Schema: captured modded TavernHelper → context for remaining fields');
            }
          }
        }
      } catch {
        // Cancel was thrown
        runningRef.current = false;
        store.setPhase('cancelled');
        store.addLog('warning', '🔧 Mod cancelled');
        return;
      }

      i++;

      // Auto-save cache every 10 fields
      if (i % 10 === 0) store.saveTranslationCache();

      // Delay between requests
      if (i < targetFields.length && store.proxy.requestDelay > 0) {
        await new Promise(r => setTimeout(r, store.proxy.requestDelay));
      }
    }

    store.saveTranslationCache();

    // ═══ Post-Mod MVU-ZOD Sync Verification Report ═══
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
        store.addLog('success', `✅ Mod MVU Sync: All ${syncReport.totalVars} variables correctly preserved!`);
      } else {
        store.addLog('warning', `⚠️ Mod MVU Sync: ${missingVars} variables were NOT properly preserved! Check Verify panel for details.`);
        for (const detail of syncReport.details) {
          store.addLog('error', detail);
        }
      }
      for (const warning of syncReport.warnings) {
        store.addLog('warning', warning);
      }
    }

    // ═══ Post-Mod Entry Name ↔ Text Sync Verification (EJS) ═══
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
          store.addLog('success', `✅ Mod EJS Sync: All ${entryNameResult.matchedNames.length} entry names correctly synchronized!`);
        } else {
          store.addLog('warning', `⚠️ Mod EJS Sync: ${entryNameResult.missingNames.length} entry name(s) NOT found in modded text — EJS auto-trigger will fail!`);
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

    // ═══ Bake all modded fields into card so next operations use updated base ═══
    bakeModdedFieldsIntoCard();

    runningRef.current = false;
    // Only set to 'done' if not already cancelled
    if (useStore.getState().phase === 'translating') {
      store.setPhase('done');
    }
    store.addLog('info', `🔧 Mod complete: ${successCount} success, ${failCount} failed${autoFixCount > 0 ? `, ${autoFixCount} auto-fixed` : ''}`);
    store.addToast(
      failCount === 0 ? 'success' : 'error',
      `Mod applied: ${successCount}/${targetFields.length} fields${autoFixCount > 0 ? ` (${autoFixCount} auto-fixed)` : ''}`
    );
  }, [store, prepareFields]);

  const continueMod = useCallback(async () => {
    await applyModToAllFields(true);
  }, [applyModToAllFields]);

  /**
   * Generate new lorebook entries based on modded card content.
   * Analyzes the card to find characters/concepts/locations without entries
   * and creates new ones via AI.
   */
  const generateModLorebook = useCallback(async (): Promise<number> => {
    const currentCard = useStore.getState().card;
    const currentFields = useStore.getState().fields;
    const config = useStore.getState().translationConfig;

    if (!currentCard) {
      store.addLog('error', '[Lorebook Gen] No card loaded');
      return 0;
    }

    const modInstructions = config.modInstructions || '';
    if (!modInstructions.trim()) {
      store.addLog('warning', '[Lorebook Gen] No mod instructions set');
      return 0;
    }

    store.addLog('info', '📚 Starting lorebook entry generation...');
    store.setPhase('translating');

    try {
      // 1. Collect card context (use translated values where available)
      const contextParts: string[] = [];
      const coreFields = ['data.name', 'data.description', 'data.personality', 'data.scenario'];
      const messageFields = ['data.first_mes', 'data.mes_example'];
      const systemFields = ['data.system_prompt', 'data.post_history_instructions'];

      for (const path of [...coreFields, ...messageFields, ...systemFields]) {
        const field = currentFields.find(f => f.path === path);
        const content = field?.translated || field?.original || '';
        if (content.trim()) {
          contextParts.push(`[${path}]\n${content.slice(0, 5000)}`);
        }
      }

      // Add existing lorebook content (summarized)
      const lorebookFields = currentFields.filter(f => f.group === 'lorebook' && f.path.endsWith('.content'));
      for (const lf of lorebookFields.slice(0, 30)) {
        const content = lf.translated || lf.original || '';
        if (content.trim()) {
          contextParts.push(`[${lf.path}]\n${content.slice(0, 2000)}`);
        }
      }

      const cardContext = contextParts.join('\n\n---\n\n');

      // 2. Get existing entry names
      const entries = currentCard.data?.character_book?.entries || [];
      const existingNames = entries
        .map(e => e.name || e.comment || `Entry ${e.id}`)
        .filter(Boolean);

      // 3. Call AI — use store.proxy for API settings
      const abortCtrl = new AbortController();
      abortRef.current = abortCtrl;

      const proxySettings = useStore.getState().proxy;

      const newEntries = await generateLorebookEntries(
        proxySettings,
        cardContext,
        existingNames,
        modInstructions,
        abortCtrl.signal,
      );

      if (newEntries.length === 0) {
        store.addLog('info', '📚 No new entries needed — all concepts already have entries.');
        store.setPhase('done');
        return 0;
      }

      // 4. Inject entries into card
      const updatedCard = injectNewLorebookEntries(currentCard, newEntries);
      useStore.getState().updateCard(updatedCard);

      // 5. Create TranslationField records for new entries
      const baseIndex = entries.length;
      const newFields: TranslationField[] = [];

      for (let i = 0; i < newEntries.length; i++) {
        const idx = baseIndex + i;
        const entry = newEntries[i];
        const entryLabel = entry.name || `Entry ${idx}`;

        // Name field
        if (entry.name) {
          newFields.push({
            path: `data.character_book.entries[${idx}].name`,
            label: `LB[${idx}] ${entryLabel} → name`,
            original: entry.name,
            translated: entry.name,
            status: 'done',
            group: 'lorebook',
            retries: 0,
          });
        }

        // Content field
        if (entry.content) {
          newFields.push({
            path: `data.character_book.entries[${idx}].content`,
            label: `LB[${idx}] ${entryLabel} → content`,
            original: entry.content,
            translated: entry.content,
            status: 'done',
            group: 'lorebook',
            retries: 0,
          });
        }

        // Comment field
        if (entry.comment) {
          newFields.push({
            path: `data.character_book.entries[${idx}].comment`,
            label: `LB[${idx}] ${entryLabel} → comment`,
            original: entry.comment,
            translated: entry.comment,
            status: 'done',
            group: 'lorebook',
            retries: 0,
          });
        }

        // Keys field
        if (entry.keys && entry.keys.length > 0) {
          const keysStr = entry.keys.join(', ');
          newFields.push({
            path: `data.character_book.entries[${idx}].keys`,
            label: `LB[${idx}] ${entryLabel} → keys`,
            original: keysStr,
            translated: keysStr,
            status: 'done',
            group: 'lorebook_keys',
            retries: 0,
          });
        }

        // Secondary keys
        if (entry.secondary_keys && entry.secondary_keys.length > 0) {
          const secKeysStr = entry.secondary_keys.join(', ');
          newFields.push({
            path: `data.character_book.entries[${idx}].secondary_keys`,
            label: `LB[${idx}] ${entryLabel} → secondary_keys`,
            original: secKeysStr,
            translated: secKeysStr,
            status: 'done',
            group: 'lorebook_keys',
            retries: 0,
          });
        }
      }

      // 6. Update store fields
      const allFields = [...useStore.getState().fields, ...newFields];
      store.setFields(allFields);
      store.saveTranslationCache();

      store.addLog('info', `📚 Generated ${newEntries.length} new lorebook entries (${newFields.length} fields)`);
      store.addToast('success', `Created ${newEntries.length} new lorebook entries!`);
      store.setPhase('done');

      return newEntries.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.addLog('error', `[Lorebook Gen] Failed: ${msg}`);
      store.addToast('error', `Lorebook generation failed: ${msg}`);
      store.setPhase('done');
      return 0;
    }
  }, [store, prepareFields]);

  return {
    prepareFields,
    startTranslation,
    continueTranslation,
    pauseTranslation,
    resumeTranslation,
    cancelTranslation,
    cancelFieldTranslation,
    cancelAllFieldTranslations,
    retranslateField,
    retryAllErrors,
    getExportCard,
    applyModToField,
    applyModToAllFields,
    continueMod,
    generateModLorebook,
  };
}
