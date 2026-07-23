import { splitLorebookBatches } from '../utils/batchSplit';
import { stripUrlsForCjkCheck } from '../utils/cjk';
import { scanFieldsForResidualCjk, buildResidualRetryInstruction } from '../utils/residualCjkScan';
import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { translateText, translateBatch, fieldGroupToFieldType, generateLorebookEntries, ChunkError, ApiError, setExtraProviders, resetProviderPool, computePoolConcurrency, callProvider, setNameStyle, setFandomMode } from '../utils/apiClient';
import { extractNameCandidates, buildNameGlossaryPrompt, parseNameGlossaryResponse, mergeGlossary, harvestGlossaryFromFields } from '../utils/nameGlossary';
import { GLOSSARY_PRESETS } from '../utils/glossaryPresets';
import { extractTranslatableFields, applyTranslationsToCard, autoTranslateLorebookTriggerKeys, injectNewLorebookEntries, isMvuUpdateField } from '../utils/cardFields';
import { syncEmbeddedWorldLink } from '../utils/worldLink';
import { syncMvuVariables, postProcessRegexHtml, normalizeSmartQuotesInCode, fixNestedQuoteBracketPaths, fixBrokenLodashPaths, fixDotNotationPaths, extractPotentialMvuKeyStrings, aiTranslateMvuKeys, aiRenameMvuKeys, extractZodDescriptions, extractSchemaContextFromCard, extractMappingFromTranslatedSchemas, enforceInitvarCovariance, extractMappingFromTranslatedInitvar, enforceExactConsistency, enforceVariableCasing, fixZodSyntaxErrors, validateDictionaryConflicts, aiResolveMvuConflicts, recanonicalizeMvuInFields, unifyVietnameseUnderscoresInText } from '../utils/mvuSync';
import { shouldSkipTranslation, detectLanguage, detectResidualCjk } from '../utils/langDetect';
import { clearRAGCache } from '../utils/ragContext';
import { storeTranslation, lookupTranslationMemory } from '../utils/translationMemory';
import { findReusableTwin } from '../utils/translationReuse';
import { getMvuCardSummary } from '../utils/mvuDetector';
import { validateMvuVariables, autoFixMvuVariables, generateSyncReport, buildEntryNameDictionary, buildRegexTriggerDictionary, validateEntryNameSync } from '../utils/mvuValidator';
import { buildEffectivePrompt } from '../utils/promptBuilder';
import { surgicalTranslate, verifyCodeStructureParity, detectInventedDeclarations } from '../utils/surgical';
import { parsePatchOutput, applyPatches, validatePatchResult } from '../utils/patchEngine';
import { injectMvuZodSystem } from '../utils/mvuGenerator';
import { unifyCrossStrategyDicts } from '../utils/crossStrategySync';
import { detectEjsCard, extractEjsEntryNames, extractEjsKeywords, aiTranslateEjsEntries, validateEjsSync, autoFixEjsEntryNames, autoFixEjsKeywords, enforceEjsEntryName, enforceEjsCovariance, enforceEjsKeywordCasing, autoFixEjsKeywordsExtended, enforceEjsDictConsistency } from '../utils/ejsSync';
import { isEjsProseField, maskEjsCode, unmaskEjsCode, countEjsBlocks } from '../utils/ejsSegmenter';
import { isLikelyJsScript, jsParseErrorAny, isImportOnlyScript } from '../utils/scriptSafety';
import { getActivePresetPromptContent } from '../utils/presetParser';
import { CallMonitor } from '../utils/callMonitor';
import { runWorkerPool } from '../utils/runWorkerPool';
import { smartPackFields } from '../utils/smartPack';
import { estimateLorebookBatchLoad } from '../utils/estimateBatchTokens';
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

// (Audit dot 3) stripUrlsForCjkCheck gom ve utils/cjk.ts (truoc day dup 3 noi).

/**
 * (User 2026 — "AI tự thêm lại biến vào từ điển dù đã sửa/xoá") Ghi mvuDictionary từ PIPELINE TỰ ĐỘNG
 * (auto-extract / AI dịch biến / merge / consistency / covariance / sweep / dọn) — TÔN TRỌNG khoá 🔒:
 * khi user bật "Khoá từ điển" ở Chiến lược B, mọi ghi tự động bị BỎ QUA (chỉ DÙNG dict user đã chốt).
 * Trả về true nếu đã ghi (caller mới nên log "đã thêm/sửa…"). Thao tác TAY trong panel không đi qua đây.
 */
function writeMvuDictAuto(dict: Record<string, string>, why: string): boolean {
  const st = useStore.getState();
  if (st.translationConfig.mvuDictLocked) {
    st.addLog('info', `🔒 Từ điển MVU đang KHOÁ — bỏ qua: ${why} (giữ nguyên từ điển của bạn).`);
    return false;
  }
  st.setTranslationConfig({ mvuDictionary: dict });
  return true;
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
  // (User 2026 — bugNeedFix/39) KHÔNG subscribe store trong hook engine.
  // Trước đây `const store = useStore()` (không selector) khiến MỌI component gọi useTranslation()
  // (FieldEditor, TranslationProgress, VerifyPanel, ExportPanel, ExternalLinkTab…) re-render theo
  // TỪNG set() — burst dịch 187 field bắn 560+ set() ⇒ bão re-render + identity `store` đổi phá
  // memo của bảng ảo hoá. Engine chỉ cần ĐỌC TƯƠI + gọi action — Proxy này chuyển mọi truy cập
  // thuộc tính sang useStore.getState() tại thời điểm dùng: luôn tươi, identity ổn định vĩnh viễn
  // (useRef), và KHÔNG đăng ký subscription nào. Hành vi đọc/ghi giữ nguyên 100% (các chỗ cần
  // snapshot tươi vốn đã gọi useStore.getState() trực tiếp).
  const storeProxyRef = useRef<ReturnType<typeof useStore.getState> | null>(null);
  if (!storeProxyRef.current) {
    storeProxyRef.current = new Proxy({} as ReturnType<typeof useStore.getState>, {
      get: (_t, prop) => (useStore.getState() as unknown as Record<string | symbol, unknown>)[prop],
    });
  }
  const store = storeProxyRef.current;
  const abortRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);
  // Track whether the main translation loop is actively running
  const runningRef = useRef(false);
  // Monotonic run token: every startTranslation bumps it. Any older loop still alive
  // bails out at its next checkpoint, so two loops can never translate concurrently.
  const runIdRef = useRef(0);
  // Paths currently being translated by SOME context. Prevents the same field from
  // being translated twice at once (e.g. a zombie loop + a fresh resume loop).
  const inFlightPaths = useRef<Set<string>>(new Set());
  // Which flow last ran, so Resume (after a hard pause) continues the correct one.
  const lastRunModeRef = useRef<'translate' | 'mod'>('translate');
  // (Việc 80) Bộ quét chữ Trung sót được khai báo SAU startTranslation (nó cần retranslateField)
  // → startTranslation gọi ngược qua ref này.
  const residualSweepRef = useRef<((maxRounds?: number) => Promise<number>) | null>(null);
  // Late-bound reference to applyModToAllFields (defined later in this hook) so Resume
  // can call it without a use-before-define / dep-array TDZ issue.
  const applyModRef = useRef<((isContinue: boolean) => void) | null>(null);
  // Per-field abort controllers: cancel previous in-flight translation for same field on retry
  const fieldAbortMap = useRef<Map<string, AbortController>>(new Map());

  /**
   * Prepare fields for translation.
   * If `continueMode` is true, merge new field groups with existing translated fields.
   */
  const prepareFields = useCallback((continueMode = false, freshStart = false) => {
    if (!store.card) return [];
    const enabledGroups = store.translationConfig.fieldGroups
      .filter((g: FieldGroupConfig) => g.enabled)
      .map((g: FieldGroupConfig) => g.id) as FieldGroup[];
    const newFields = extractTranslatableFields(store.card, enabledGroups);

    // In continue mode: preserve already-done fields from previous runs.
    // freshStart (Re-translate All): KHÔNG gộp — dùng thẳng field mới trích (toàn 'pending') để dịch
    // lại TỪ ĐẦU. Không đọc store.fields ⇒ tránh lỗi "stale closure" (deleteCurrentCardCache đã xoá
    // fields trong store nhưng snapshot React của hook chưa cập nhật ⇒ trước đây vẫn thấy fields 'done'
    // rồi gộp lại ⇒ báo "All fields are already translated" thay vì restart).
    let mergedFields = newFields;
    if (!freshStart && store.fields.length > 0) {
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

    // Preset "Dịch nhẹ": trong core/lorebook chỉ dịch field TÊN (kết thúc .name) + comment
    // lorebook; content TO (description/personality/scenario + thân entry) → ignore.
    // Làm ở đây (khi Start, field luôn đã trích đủ) nên không phụ thuộc timing của nút.
    if (store.translationConfig.lightSkipContent) {
      const isNameOrComment = (p: string) => /(^|\.)name$/.test(p) || /\.comment$/.test(p);
      // (Fix bug #13, PhatSiz) Ở Dịch Nhẹ, entry [mvu update] vẫn ĐƯỢC DỊCH (không skip): đây là entry
      // "quy tắc cập nhật biến" MVU mà user muốn ra tiếng đích. Xem isMvuUpdateField.
      for (const f of mergedFields) {
        if ((f.group === 'core' || f.group === 'lorebook') && !isNameOrComment(f.path) && !isMvuUpdateField(f) && f.status !== 'done') {
          f.status = 'ignored';
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

  /* ─── Translate a single field (inner — wrapped below with an in-flight lock) ─── */
  const _translateSingleFieldInner = async (field: TranslationField, index: number, fields: TranslationField[]) => {
    // #2: nếu đã bấm Dừng/Hủy thì KHÔNG đánh dấu 'translating' (tránh task nền set lại sau khi
    // pause đã reset → kẹt 'translating' hoài / "vẫn dịch nền"). Bail ngay để loop trên bắt Cancelled.
    if (checkAbort()) throw new Error('Cancelled');
    store.setCurrentFieldIndex(index);
    store.updateField(field.path, { status: 'translating' });
    // (User 2026 — bugNeedFix/39) NHẢ main thread 1 nhịp trước phần chuẩn bị ĐỒNG BỘ (RAG/prompt/dict).
    // Nhiều worker song song chạy các khối sync liên tiếp có thể chiếm main thread hàng chục giây
    // (luồng So sánh: 418 field done sẵn → RAG per-field nặng ngay từ đầu) → "Trang không phản hồi".
    // Gốc rễ đã fix ở ragContext (vector cache, ×67 nhanh hơn); yield này là LƯỚI BẢO HIỂM để UI
    // LUÔN sống kể cả khi xuất hiện hotspot mới. Chi phí ~1-4ms/field — không đáng kể.
    await new Promise<void>((r) => setTimeout(r, 0));
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

    // Mục >15k ký tự sẽ được cắt ~15k/phần (chunkText) rồi dịch SONG SONG qua pool → log cho user rõ.
    const estimatedChunks = Math.ceil(charCount / 15000);
    if (estimatedChunks > 1) {
      store.addLog('active', `🔗 Mục lớn "${field.label}" (${charCount.toLocaleString()} ký tự) → chia ~${estimatedChunks} phần, dịch SONG SONG${targetModel !== store.proxy.model ? ` [Model: ${targetModel}]` : ''}`);
    } else {
      store.addLog('active', `Đang dịch: ${field.label} (${charCount.toLocaleString()} ký tự)${targetModel !== store.proxy.model ? ` [Model: ${targetModel}]` : ''}`);
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
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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

      // ═══ (User 2026 — Đợt 1b) SURGICAL EJS: entry lorebook-EJS (prose + <%…%>) → MASK toàn bộ CODE
      // thành token {{__ejs_N__}}, chỉ gửi PROSE cho AI → hết "dịch nửa vời / vỡ code". CJK trong code
      // do từ điển EJS (covariance) lo sau. Chỉ áp khi bật Chiến lược C + đúng loại entry. ═══
      // Áp cho field CÓ khối EJS + prose-CJK (isEjsProseField là gate thật) ở lorebook HOẶC tavern_helper
      // (script TavernHelper dạng template EJS — nơi entry rule/note/action lỗi "dịch nửa vời" hay nằm).
      // KHÔNG áp cho entryType schema/initvar/controller/mvu_logic (đã có đường riêng của MVU).
      const useEjsSurgical =
        store.translationConfig.enableEjsSync &&
        (field.group === 'lorebook' || field.group === 'tavern_helper') &&
        field.entryType !== 'initvar' && field.entryType !== 'controller' && field.entryType !== 'mvu_logic' &&
        isEjsProseField(field.original);
      let ejsMaskCodes: string[] = [];
      let ejsTextToTranslate = field.original;
      if (useEjsSurgical) {
        const masked = maskEjsCode(field.original);
        if (masked.codes.length > 0) {
          ejsMaskCodes = masked.codes;
          ejsTextToTranslate = masked.masked;
          store.addLog('active', `🧩 EJS surgical: che ${masked.codes.length} khối code, chỉ dịch phần chữ cho ${field.label}…`);
        }
      }

      const isEligibleForSurgical = (() => {
        if (useEjsSurgical) return false; // EJS surgical (mask code) lo — bỏ surgical CJK-token generic
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
        store.addLog('active', `🔪 Dịch phẫu thuật (chỉ sửa phần cần) cho ${field.label}…`);
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
          store.addLog('warning', `Dịch phẫu thuật cho ${field.label} không đạt — chuyển sang dịch thường.`);
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
          store.addLog('info', `🔄 Tiếp tục ${field.label}: đã có ${filledCount} phần (chunk) trong bộ nhớ`);
        }

        translated = await translateText(
          ejsTextToTranslate,
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
          computePoolConcurrency(store.proxy),
          // enableChunkVerification
          store.translationConfig.enableChunkVerification,
          // onChunksReady
          (rawChunks) => {
            store.updateField(field.path, {
              rawChunks,
            });
          },
          // cssCjkHandling
          store.translationConfig.cssCjkHandling,
          // (User yêu cầu 2026) KHÔNG còn đẩy retry xuống model phụ: model phụ CHỈ chạy entry ngắn
          // theo ngưỡng ký tự (xem laneOrder). Retry đi lại đúng model theo độ dài entry.
          false
        );
      }

      // ═══ (Đợt 1b) BỎ MASK EJS: khôi phục code đã che. Đủ token → dùng bản dịch (CJK-trong-code do
      // covariance lo sau). Thiếu token (AI làm rơi) → giữ bản GỐC để KHÔNG vỡ code + cảnh báo. ═══
      if (ejsMaskCodes.length > 0 && translated) {
        const { text: unmasked, ok, missing, dup } = unmaskEjsCode(translated, ejsMaskCodes);
        // `ok` = MỖI token khôi phục ĐÚNG 1 lần. Chỉ so tổng số (restored===length) là BẪY: AI có thể
        // NHÂN BẢN token này + LÀM RƠI token khác → tổng khớp nhưng code mất/đúp. Dùng `ok` mới an toàn.
        if (ok) {
          translated = unmasked;
        } else {
          store.addLog('warning', `🧩 EJS surgical: token code KHÔNG khớp ở ${field.label} (rơi ${missing.length}, đúp ${dup.length}) — giữ bản gốc, không vỡ code (thử dịch lại field này).`);
          translated = field.original;
        }
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
          // (User 2026 — bug #8) SWEEP dict-less TRƯỚC covariance: AI thi thoảng nối từ Việt bằng `_`
          // (Lưu_Tam_Bảo) dù prompt cấm → gom về space + bọc nháy key JS ngay tại đây, kể cả biến
          // KHÔNG có trong dict. Covariance/casing (dict-driven) chạy sau chốt đúng dạng từ điển.
          {
            const uni = unifyVietnameseUnderscoresInText(translated);
            if (uni.count > 0) {
              translated = uni.text;
              store.addLog('info', `🔧 Đồng nhất ${uni.count} biến nối "_" → dấu cách trong ${field.label}`);
            }
          }

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
                if (writeMvuDictAuto(fixes.length > 0 ? fixedDict : updatedDict, 'progressive thêm biến từ entry')) {
                  if (fixes.length > 0) store.addLog('info', `🔒 Exact consistency: fixed ${fixes.length} case/spelling variations: ${fixes.join(', ')}`);
                  store.addLog('info', `🔗 Progressive: +${addedCount} entry-specific var(s) from ${field.label}`);
                }
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
        // Sửa nháy đơn lồng nháy đơn trong bracket notation (vd setDeepValue(x,'a['key']',y))
        // — lỗi này làm vỡ cả kịch bản JS; path-fixer cũ chỉ khớp _.get nên không bắt được.
        translated = fixNestedQuoteBracketPaths(translated);
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
        if (field.group === 'tavern_helper') {
          // (Sua bug #3) TavernHelper = SCRIPT JS LON (co the 100KB+, vd ERA变量框架 148KB) chua chu
          // Han trong string data / comment ma AI doi khi GIU LAI hop le. Guard cu "con BAT KY 1 chu
          // Han -> dich lai CA field" => re-dich ca 148KB toi maxRetries lan = treo 30-45 phut, roi bao
          // "Schema translation failed" (dung bug user: dich toi day roi NAM IM). Nay theo TY LE: chi
          // dich lai khi CHUA DICH that (echo / do nua chung, >35% Han song), bo qua vai chu con sot.
          const { suspect, transCjk, origCjk, survival } = detectResidualCjk(field.original, translated);
          if (suspect) {
            if (freshRetries() < (store.proxy.maxRetries || 3)) {
              store.updateField(field.path, { retries: freshRetries() + 1 });
              store.addLog('retry', `⚠️ Script con ${transCjk}/${origCjk} chu Han (${(survival * 100).toFixed(0)}%) — nghi chua dich. Thu lai: ${field.label}…`);
              await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
              return 'retry';
            }
            store.updateField(field.path, { status: 'error', error: `Script con ${transCjk}/${origCjk} chu Han sau ${store.proxy.maxRetries || 3} lan thu` });
            store.addLog('error', `Chinese remaining in TavernHelper for ${field.label} after retries.`);
            return 'error';
          }
        } else {
          // initvar/controller/mvu_logic: schema bien (nho) -> giu nghiem (bat ky chu Han = bien chua
          // dich). Chi dem CHU Han that (KHONG dem dau fullwidth nhu bug #2) + bo URL/import path.
          const cjkRegex = /[一-鿿㐀-䶿]/;
          const translatedStripped = stripUrlsForCjkCheck(translated);
          if (cjkRegex.test(translatedStripped)) {
            if (freshRetries() < (store.proxy.maxRetries || 3)) {
              store.updateField(field.path, { retries: freshRetries() + 1 });
              store.addLog('retry', `⚠️ Con chu Han trong Schema (${field.label}). Dang thu lai…`);
              await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
              return 'retry';
            }
            store.updateField(field.path, { status: 'error', error: 'Schema translation failed (Chinese characters remaining)' });
            store.addLog('error', `Chinese characters remaining in Schema for ${field.label} after retries.`);
            return 'error';
          }
        }
      }

      // ═══ RESIDUAL-CJK GUARD (mọi trường VĂN BẢN thường) — chống "DONE giả" (bug #1) ═══
      // AI đôi khi TRẢ LẠI NGUYÊN VĂN nguồn (echo) → field dài ≈ nguồn (ratio ~100%) nên lọt các guard
      // độ dài và bị đánh dấu 'done' dù VẪN tiếng Trung. Guard schema-critical ở trên KHÔNG bao trường
      // content/lorebook/messages/core… nên chúng lọt lưới. Chặn theo TỶ LỆ chữ Hán sống sót (>35% ⇒
      // chưa dịch ⇒ retry; hết retry ⇒ 'error' đỏ, không DONE giả). KHÔNG áp cho lorebook_keys (merge),
      // regex/tavern_helper (đã có guard riêng ở trên).
      if (
        isTargetNonCJK &&
        !isSchemaCritical &&
        field.group !== 'lorebook_keys' &&
        field.group !== 'regex' &&
        field.group !== 'tavern_helper'
      ) {
        const { suspect, origCjk, transCjk, survival } = detectResidualCjk(field.original, translated);
        if (suspect) {
          if (freshRetries() < (store.proxy.maxRetries || 3)) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry',
              `⚠️ Nghi CHƯA DỊCH: còn ${(survival * 100).toFixed(0)}% chữ Hán ` +
              `(${transCjk}/${origCjk}) ở ${field.label}. AI có thể trả lại nguyên văn. Thử lại…`
            );
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry';
          }
          store.updateField(field.path, {
            status: 'error',
            error: `Chưa dịch: còn ${transCjk}/${origCjk} chữ Hán (${(survival * 100).toFixed(0)}%) sau ${store.proxy.maxRetries || 3} lần thử`,
          });
          store.addLog('error',
            `❌ ${field.label} vẫn còn ${(survival * 100).toFixed(0)}% tiếng Trung sau retry — ` +
            `đánh dấu LỖI (không phải DONE giả).`
          );
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

      // ═══ (User 2026) GUARD TOÀN VẸN KHỐI EJS — chống "html broken / EJS tag mismatch" khi xuất ═══
      // Dù đi đường surgical, MVU hay dịch cả khối (entry lớn bị chunk → AI rơi khối ở mối nối), nếu SỐ
      // khối <%…%> của bản dịch KHÁC bản gốc thì JS trong SillyTavern sẽ VỠ (mismatch block). Xử lý:
      //  1) còn lượt retry → DỊCH LẠI field (đa số lỗi rơi khối là ngẫu nhiên, dịch lại là khớp);
      //  2) hết retry → GIỮ NGUYÊN bản gốc field (code Trung vẫn CHẠY được — comment/chuỗi bên trong là
      //     nội bộ, người chơi không đọc) + cảnh báo rõ. THÀ 1 entry logic tiếng Trung còn hơn card lỗi.
      if (translated && field.original.includes('<%')) {
        const origBlocks = countEjsBlocks(field.original);
        const transBlocks = countEjsBlocks(translated);
        if (origBlocks > 0 && transBlocks !== origBlocks) {
          if (freshRetries() < (store.proxy.maxRetries || 3)) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry', `⚠️ EJS lệch khối: ${field.label} có ${transBlocks}/${origBlocks} khối <%…%> → dịch lại để không vỡ JS…`);
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry';
          }
          store.addLog('warning',
            `⚠️ EJS toàn vẹn: ${field.label} vẫn ${transBlocks}/${origBlocks} khối <%…%> sau retry → GIỮ NGUYÊN ` +
            `bản gốc field này để KHÔNG vỡ JS khi xuất. Hãy dịch lại riêng entry này.`
          );
          translated = field.original;
        }
      }

      // ═══ (User 2026 — bug script TavernHelper 71K cụt đuôi giữa regex) GUARD CÚ PHÁP JS FIELD ═══
      // Field là SCRIPT JS trần (TavernHelper/JS-Slash-Runner) mà bản GỐC parse sạch (acorn, cả mode
      // module lẫn script) thì bản DỊCH cũng PHẢI parse sạch. Vỡ (cụt output, đứt regex/chuỗi…) →
      // retry; hết retry → GIỮ NGUYÊN bản gốc + chỉ rõ DÒNG lỗi. Card không bao giờ xuất script liệt.
      if (translated && translated !== field.original && isLikelyJsScript(field.original) && jsParseErrorAny(field.original) === null) {
        const jsErr = jsParseErrorAny(translated);
        if (jsErr) {
          if (freshRetries() < (store.proxy.maxRetries || 3)) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry', `⚠️ Script vỡ cú pháp sau dịch (${field.label}, dòng ~${jsErr.line}: ${jsErr.msg.slice(0, 60)}) → dịch lại…`);
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry';
          }
          store.addLog('warning',
            `⚠️ Script toàn vẹn: ${field.label} vẫn vỡ cú pháp JS sau retry (dòng ~${jsErr.line}) → GIỮ NGUYÊN ` +
            `bản gốc để script KHÔNG liệt trong SillyTavern. Hãy dịch lại riêng entry này.`
          );
          translated = field.original;
        }
      }

      // ═══ (User 2026 — bugNeedFix/33) GUARD CHỐNG "AI BỊA THÊM CODE" (safeString & đồng bọn) ═══
      // Đã gỡ 2 lệnh prompt bắt inject safeString (masterPrompt C3.4 + promptBuilder rule 25). Đây là
      // LƯỚI TẦNG 2: kể cả AI tự ý thêm hàm/khối mới, bắt bằng 2 tín hiệu — (a) có KHAI BÁO const/function
      // mới không có trong gốc, (b) TỔNG ngoặc ()/{}/[]/backtick LỆCH (thêm hàm = thêm ngoặc). Code dịch
      // trung thực KHÔNG đổi số ngoặc; phiên âm tên định danh (Hán→ASCII) KHÔNG đổi ngoặc → không báo nhầm.
      // Chỉ áp cho field code (tavern_helper/regex/initvar/controller/mvu_logic). Dính → retry; hết retry
      // → GIỮ NGUYÊN gốc (code Trung vẫn chạy) + cảnh báo. THÀ giữ gốc còn hơn nhét code AI bịa vào card.
      const isCodeFieldForHallucGuard =
        field.group === 'tavern_helper' || field.group === 'regex' ||
        field.entryType === 'initvar' || field.entryType === 'controller' || field.entryType === 'mvu_logic';
      if (translated && translated !== field.original && isCodeFieldForHallucGuard) {
        const parity = verifyCodeStructureParity(field.original, translated);
        const invented = detectInventedDeclarations(field.original, translated);
        // Bịa code khi: ngoặc lệch NHIỀU (≥4 = cả 1 khối/hàm thêm-bớt) HOẶC có khai báo mới + ngoặc lệch ≥1.
        const hallucinated = parity.maxDiff >= 4 || (invented.length > 0 && parity.maxDiff >= 1);
        if (hallucinated) {
          const why = invented.length > 0
            ? `thêm khai báo lạ [${invented.slice(0, 3).join(', ')}${invented.length > 3 ? '…' : ''}]` + (parity.reason ? ` + ${parity.reason}` : '')
            : (parity.reason || 'cấu trúc code lệch');
          if (freshRetries() < (store.proxy.maxRetries || 3)) {
            store.updateField(field.path, { retries: freshRetries() + 1 });
            store.addLog('retry', `⚠️ Nghi AI BỊA CODE (${field.label}): ${why} → dịch lại (chỉ dịch chữ, không thêm code)…`);
            await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
            return 'retry';
          }
          store.addLog('warning',
            `⚠️ Chống bịa code: ${field.label} vẫn ${why} sau retry → GIỮ NGUYÊN bản gốc để KHÔNG nhét ` +
            `code AI tự chế vào card. Hãy dịch lại riêng entry này (hoặc bật Dịch phẫu thuật).`
          );
          translated = field.original;
        }
      }

      // Keep chunk progress for export, clear failed index only
      store.updateField(field.path, { status: 'done', translated, failedChunkIndex: undefined });
      store.addLog('success', `✅ Đã dịch: ${field.label} (${translated.length} ký tự)`);
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
          store.addLog('info', `⏸ ${field.label}: đã lưu ${err.completedChunks.length}/${err.totalChunks} phần để chạy tiếp`);
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
          store.addLog('retry', `⚠️ Lỗi ở phần ${err.failedChunkIndex + 1}/${err.totalChunks}. Tự chạy tiếp từ chỗ dở (lần ${currentRetries + 1}/${maxChunkRetries})…`);
          await new Promise((r) => setTimeout(r, store.proxy.retryDelay || 1000));
          return 'retry';
        }

        // If all retries exhausted, set error state
        store.updateField(field.path, {
          status: 'error',
          error: msg,
          retries: currentRetries + 1,
        });
        store.addLog('error', `Lỗi: ${field.label} — phần ${err.failedChunkIndex + 1}/${err.totalChunks} (đã lưu ${err.completedChunks.length} phần để chạy tiếp)`);
        store.addToast('error', `${field.label}: chunk ${err.failedChunkIndex + 1}/${err.totalChunks} failed — retry will resume`);
        return 'error';
      }

      // Auto-retry ở CẤP FIELD:
      //  - field lớn (chunk-eligible): chunk đầu lỗi → thử lại (như cũ).
      //  - LỖI TẠM THỜI (proxy/CDN 5xx như 524, timeout, mất mạng): thử lại DÙ field nhỏ,
      //    thay vì skip luôn. Trước đây field nhỏ (không chunk) không được retry cấp field
      //    nên gặp 524 là bỏ qua ngay — đúng lỗi user báo.
      const isChunked = charCount > CHUNK_THRESHOLD;
      const isTransient =
        (err instanceof ApiError && err.retryable) ||
        /server error 5\d\d|http 5\d\d|\b52\d\b|timeout|timed out|fetch failed|failed to fetch|network|bodystreambuffer|econnreset|ngắt kết nối/i.test(msg);
      if ((isChunked || isTransient) && currentRetries < maxChunkRetries) {
        store.updateField(field.path, { retries: currentRetries + 1 });
        const why = isChunked ? 'Chunk 1 lỗi' : 'Lỗi tạm thời (proxy/mạng)';
        store.addLog('retry', `⚠️ ${field.label}: ${why}. Tự thử lại (lần ${currentRetries + 1}/${maxChunkRetries})...`);
        // Backoff tăng dần — cho proxy/CDN thời gian hồi phục khi bị 5xx/timeout.
        await new Promise((r) => setTimeout(r, (store.proxy.retryDelay || 1000) * (currentRetries + 1)));
        return 'retry';
      }

      // Cắt ngắn message trước khi log/lưu (phòng lỗi không phải ApiError vẫn dài).
      const shortMsg = msg.length > 240 ? msg.replace(/\s+/g, ' ').slice(0, 240) + '…' : msg;
      store.updateField(field.path, { status: 'error', error: shortMsg, retries: currentRetries + 1 });
      store.addLog('error', `Lỗi: ${field.label} — ${shortMsg}`);
      store.addToast('error', `Failed: ${field.label}`);
      return 'error';
    }
  };

  /* ─── In-flight lock wrapper ───
   * Guarantees the same field is never translated by two contexts at once
   * (e.g. a zombie loop whose API call is still hanging + a fresh resume loop).
   * If the path is already being translated, this call is skipped. */
  const translateSingleField = async (field: TranslationField, index: number, fields: TranslationField[]) => {
    if (inFlightPaths.current.has(field.path)) {
      store.addLog('warning', `⏭️ Bỏ qua dịch trùng: ${field.label} (đang được dịch ở luồng khác)`);
      return 'skip';
    }

    // (User 2026 — học từ template script cộng đồng) Script CHỈ gồm `import 'https://…jsdelivr…'`
    // (+comment): nội dung THẬT nằm trên CDN tự cập nhật — dịch vô ích, đụng vào chỉ thêm rủi ro
    // → giữ nguyên, done ngay, 0 call AI.
    if (field.group === 'tavern_helper' && isImportOnlyScript(field.original)) {
      store.updateField(field.path, { status: 'done', translated: field.original, error: undefined });
      store.addLog('info', `⏭️ ${field.label}: script chỉ import từ CDN (tự cập nhật) — giữ nguyên, không cần dịch.`);
      return 'done';
    }

    // ♻️ BỘ NHỚ DỊCH: nếu đã có 1 trường KHÁC (trùng HỆT nội dung gốc + nhóm + loại) dịch xong
    //    → copy thẳng bản dịch, khỏi tốn 1 call. An toàn tuyệt đối (2 trường giống hệt → cùng bản dịch).
    //    Tôn trọng tuỳ chọn "Bỏ qua trường đã dịch": tắt tuỳ chọn = dịch mới toàn bộ, không tái dùng.
    if (store.translationConfig.skipAlreadyTranslated) {
      const twin = findReusableTwin(useStore.getState().fields, field);
      if (twin) {
        store.updateField(field.path, { status: 'done', translated: twin.translated, error: undefined });
        store.addLog('success', `♻️ Tái dùng bản dịch cho "${field.label}" (trùng nội dung với "${twin.label}") — tiết kiệm 1 lượt gọi AI`);
        return 'done';
      }
    }

    inFlightPaths.current.add(field.path);
    try {
      return await _translateSingleFieldInner(field, index, fields);
    } finally {
      inFlightPaths.current.delete(field.path);
    }
  };

  /* ─── Helper: check if a field is MVU-critical (needs extra care) ─── */
  const isMvuCriticalField = (f: TranslationField) =>
    f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic';

  /* ─── Translate one batch of fields (single API call + fallback) ─── */
  const translateOneBatch = async (batchFields: TranslationField[], retryCount = 0, preferSecondary = false) => {
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
    // MỌI batch 1-field → đi qua translateSingleField: có guard inFlightPaths (chống 2 luồng ghi đè
    // cùng field), chunk + resume, retry RIÊNG từng field, và KHÔNG dùng prompt gộp nhiều-entry (vốn
    // gây AI trộn thứ tự → gán nhầm bản dịch). Đây là nền cho chế độ dịch từng-entry song song.
    if (batchFields.length === 1) {
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
    // (User yêu cầu) Lô GỘP ≥2 mục → hiện RÕ đang chạy những entry nào (giúp theo dõi batch nào chạy mục nào).
    const entryListLabel = batchFields.length > 1
      ? `: ${batchFields.map(f => f.label).slice(0, 8).join(' · ')}${batchFields.length > 8 ? ` …(+${batchFields.length - 8})` : ''}`
      : '';
    store.addLog('active', `${retryPrefix}Đang dịch ${batchFields.length} mục${typeLabel} (${totalChars} ký tự${mvuCriticalCount > 0 ? `, ${mvuCriticalCount} mục biến số MVU` : ''})${targetModel !== store.proxy.model ? ` [Model: ${targetModel}]` : ''}${entryListLabel}`);

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
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
        store.translationConfig.chunkSize,
        preferSecondary // lô gộp toàn entry ngắn (Dịch siêu tốc) → đi model phụ (flash)
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
        store.addLog('info', `🔍 Đối chiếu chéo lô: ${emptyResultCount}/${batchFields.length} mục sẽ dịch lại RIÊNG (nghi AI trả lệch thứ tự)`);
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
            // (User 2026 — bug #8) SWEEP dict-less như đường single: gom biến Việt nối `_` về space.
            {
              const uni = unifyVietnameseUnderscoresInText(translated);
              if (uni.count > 0) {
                translated = uni.text;
                store.addLog('info', `🔧 Đồng nhất ${uni.count} biến nối "_" → dấu cách trong ${bf.label}`);
              }
            }

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
                if (addedCount > 0 && writeMvuDictAuto(updatedDict, 'progressive thêm biến (batch)')) {
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
          translated = fixNestedQuoteBracketPaths(translated);
        }

        // ═══ (User 2026) GUARD TOÀN VẸN KHỐI EJS (đường BATCH) — nếu bản dịch LỆCH số khối <%…%> so với
        // gốc → JS vỡ khi xuất. Batch không retry per-field → GIỮ NGUYÊN bản gốc field này (an toàn) +
        // cảnh báo rõ để dịch lại riêng. (Đường single-field đã có guard + retry ở translateSingleField.)
        if (translated && batchFields[j].original.includes('<%')) {
          const oB = countEjsBlocks(batchFields[j].original);
          const tB = countEjsBlocks(translated);
          if (oB > 0 && tB !== oB) {
            store.addLog('warning',
              `⚠️ EJS toàn vẹn: ${batchFields[j].label} có ${tB}/${oB} khối <%…%> (lệch ${tB - oB}) → GIỮ NGUYÊN ` +
              `bản gốc field này để KHÔNG vỡ JS khi xuất. Hãy dịch lại riêng entry này.`
            );
            translated = batchFields[j].original;
          }
        }

        // ═══ (User 2026) GUARD CÚ PHÁP JS (đường BATCH) — script gốc parse sạch mà bản dịch vỡ
        // (cụt output/đứt regex/chuỗi) → GIỮ NGUYÊN bản gốc, không xuất script liệt. ═══
        if (translated && translated !== batchFields[j].original &&
            isLikelyJsScript(batchFields[j].original) && jsParseErrorAny(batchFields[j].original) === null) {
          const jsErr = jsParseErrorAny(translated);
          if (jsErr) {
            store.addLog('warning',
              `⚠️ Script toàn vẹn: ${batchFields[j].label} vỡ cú pháp JS sau dịch (dòng ~${jsErr.line}) → GIỮ NGUYÊN ` +
              `bản gốc field này. Hãy dịch lại riêng entry này.`
            );
            translated = batchFields[j].original;
          }
        }

        // ═══ (User 2026 — bugNeedFix/33) GUARD CHỐNG BỊA CODE (đường BATCH) — kể cả sau khi gỡ lệnh inject
        // safeString, nếu AI tự thêm hàm/khối mới (khai báo lạ + ngoặc lệch nhiều) → GIỮ NGUYÊN bản gốc.
        {
          const bf = batchFields[j];
          const isCode = bf.group === 'tavern_helper' || bf.group === 'regex' ||
            bf.entryType === 'initvar' || bf.entryType === 'controller' || bf.entryType === 'mvu_logic';
          if (translated && translated !== bf.original && isCode) {
            const parity = verifyCodeStructureParity(bf.original, translated);
            const invented = detectInventedDeclarations(bf.original, translated);
            if (parity.maxDiff >= 4 || (invented.length > 0 && parity.maxDiff >= 1)) {
              const why = invented.length > 0
                ? `thêm khai báo lạ [${invented.slice(0, 3).join(', ')}${invented.length > 3 ? '…' : ''}]` + (parity.reason ? ` + ${parity.reason}` : '')
                : (parity.reason || 'cấu trúc code lệch');
              store.addLog('warning',
                `⚠️ Chống bịa code: ${bf.label} — ${why} → GIỮ NGUYÊN bản gốc field này (không nhét code AI tự chế). ` +
                `Hãy dịch lại riêng entry này.`
              );
              translated = bf.original;
            }
          }
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
        store.addLog('info', `📋 Kiểm tra lô: ${doneCount} mục đã dịch, ${autoFixCount} mục tự sửa`);
      }

      // ═══ Fallback/Retry for empty results ═══
      if (emptyFields.length > 0) {
        // Exponential backoff
        const backoffDelay = Math.min((store.proxy.retryDelay || 1000) * Math.pow(2, retryCount), 15000);

        if (retryCount < (store.proxy.maxRetries || 3)) {
          // Log which specific fields failed
          const failedLabels = emptyFields.map(f => f.label.replace(/^Lorebook: /, '')).slice(0, 5);
          store.addLog('retry', `⚠️ ${emptyFields.length} mục bị trống (AI chưa trả kết quả): [${failedLabels.join(', ')}${emptyFields.length > 5 ? '…' : ''}]. Đang thử lại sau ${(backoffDelay/1000).toFixed(1)}s…`);
          await new Promise((r) => setTimeout(r, backoffDelay));
          await translateOneBatch(emptyFields, retryCount + 1, preferSecondary);
        } else {
          // ─── Fallback to individual using translateSingleField ───
          // Separate MVU-critical fields (process first) from regular ones
          const criticalFields = emptyFields.filter(isMvuCriticalField);
          const normalFields = emptyFields.filter(f => !isMvuCriticalField(f));
          const orderedFallback = [...criticalFields, ...normalFields];

          if (criticalFields.length > 0) {
            store.addLog('warning', `${emptyFields.length} mục vẫn trống sau khi thử lại — chuyển sang dịch RIÊNG (ưu tiên ${criticalFields.length} mục biến MVU)…`);
          } else {
            store.addLog('warning', `${emptyFields.length} mục vẫn trống sau khi thử lại — chuyển sang dịch RIÊNG từng mục…`);
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
        store.addLog('success', `${retryPrefix}✅ Xong lô: ${doneCount}/${batchFields.length} mục${autoFixCount > 0 ? ` (tự sửa ${autoFixCount})` : ''}`);
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
        store.addLog('retry', `⚠️ Cả lô bị lỗi, đang thử lại sau ${(backoffDelay/1000).toFixed(1)}s… (${msg})`);
        await new Promise((r) => setTimeout(r, backoffDelay));
        await translateOneBatch(batchFields, retryCount + 1, preferSecondary);
        return;
      }

      // ─── Batch completely failed after retries — fallback ALL via translateSingleField ───
      const criticalFields = batchFields.filter(isMvuCriticalField);
      const normalFields = batchFields.filter(f => !isMvuCriticalField(f));
      const orderedFallback = [...criticalFields, ...normalFields];

      store.addLog('warning', `Lô bị lỗi sau khi thử lại — chuyển sang dịch RIÊNG ${batchFields.length} mục${criticalFields.length > 0 ? ` (ưu tiên ${criticalFields.length} mục biến số MVU)` : ''}…`);

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
  const startTranslation = useCallback(async (continueMode = false, freshStart = false) => {
    const allFields = prepareFields(continueMode, freshStart);
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
    // Release any field locks held by a previous (now-superseded) run
    inFlightPaths.current.clear();

    // Bump the run token: any older loop still alive will see runIdRef change and bail
    // out at its next checkpoint, so two loops can never run concurrently.
    const myRunId = ++runIdRef.current;
    abortRef.current = new AbortController();
    pauseRef.current = false;
    runningRef.current = true;
    lastRunModeRef.current = 'translate';
    store.setPhase('translating');
    // Fresh start resets the elapsed timer + logs. CONTINUE (incl. Resume after a hard
    // pause) keeps them so the timer keeps counting and log history is preserved.
    if (!continueMode) {
      store.setStartTime(Date.now());
      store.clearLogs();
    } else if (!useStore.getState().startTime) {
      store.setStartTime(Date.now());
    }
    store.setPreprocessProgress(null);
    CallMonitor.reset();
    // Nạp pool provider phụ + reset round-robin cho lượt dịch này.
    setExtraProviders(store.providers);
    resetProviderPool();
    setNameStyle(store.translationConfig.nameStyle); // (User 2026) Kiểu tên riêng → mọi prompt dùng chung
    // (User 19/07) 🎌 Đồng nhân → khối luật tên canon (cấm Hán-Việt hoá) áp cho mọi prompt.
    setFandomMode(store.translationConfig.fandomMode, store.translationConfig.fandomName);
    if (store.providers.filter((p) => p.enabled).length > 0) {
      store.addLog('info', `🔀 Đa provider: ${1 + store.providers.filter((p) => p.enabled).length} provider chạy song song (rải đều).`);
    }

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




    store.setLogPhase('prepare'); // gom log giai đoạn Chuẩn bị (sắp xếp + Chiến lược B/C)
    sortFieldsForCovariance(fields, Boolean(store.translationConfig.enableMvuSync));
    if (store.translationConfig.enableMvuSync) {
      store.addLog('info', '📋 Đã sắp xếp đa lượt để đồng bộ thuật ngữ: Lượt 1 (Schema & biến khởi tạo) → Lượt 2 (Regex & từ khoá) → Lượt 3 (Tường thuật & prompt)');
    } else {
      const hasFindRegex = fields.some(f => f.path.includes('findRegex'));
      if (hasFindRegex) {
        store.addLog('info', `📋 findRegex fields moved to front (translate before narrative)`);
      }
    }

    // ═══ Pha 0: Bảng tên riêng tự động — dịch bảng tên TRƯỚC để mọi luồng song song dùng chung ═══
    // Đếm cục bộ (0 token) các cụm Hán lặp lại trong đúng những field sắp dịch + keyword lorebook,
    // rồi 1 lượt gọi AI dịch cả bảng → merge vào glossary (entry user nhập tay luôn thắng).
    // Continue/re-run: ứng viên đã có trong glossary bị lọc ra ⇒ đủ bảng thì 0 call, không tốn thêm.
    if (useStore.getState().translationConfig.autoNameGlossary) {
      try {
        // ── Tự nạp bộ thuật ngữ có sẵn khi card khớp thể loại (user khỏi phải nhớ bấm nút) ──
        // Đếm nhanh (0 token): ≥8 thuật ngữ của bộ xuất hiện trong card → nạp cả bộ.
        // Đã có ≥5 mục của bộ trong Từ điển thì coi như nạp rồi (tôn trọng user đã xoá bớt).
        // (User 19/07) 🎌 ĐỒNG NHÂN: KHÔNG tự nạp bộ tu tiên/võ hiệp. Bộ này toàn thuật ngữ Hán-Việt,
        // nạp vào card đồng nhân Nhật/Hàn là kéo cả văn phong lẫn tên riêng về hướng Hán-Việt.
        if (useStore.getState().translationConfig.fandomMode) {
          store.addLog('info', '🎌 Chế độ Đồng Nhân: bỏ qua tự nạp bộ thuật ngữ Tu tiên/Võ hiệp (tránh kéo tên nhân vật về Hán-Việt).');
        } else {
          const cfgPk = useStore.getState().translationConfig;
          const corpus = fields
            .filter(f => f.status === 'pending' || f.status === 'error')
            .map(f => f.original).join('\n').slice(0, 200_000);
          const have = new Set(cfgPk.glossary.map(g => g.source.trim()));
          for (const pack of GLOSSARY_PRESETS) {
            const alreadyLoaded = pack.entries.filter(e => have.has(e.source)).length >= 5;
            if (alreadyLoaded) continue;
            const hits = pack.entries.filter(e => corpus.includes(e.source)).length;
            if (hits >= 8) {
              // (Fix bug #10) đánh dấu auto: bộ nạp theo card → dọn khi gỡ card/xoá cache.
              const { merged, added } = mergeGlossary(cfgPk.glossary, pack.entries.map(e => ({ ...e, auto: true, origin: 'preset' as const })));
              store.setTranslationConfig({ glossary: merged });
              store.addLog('info', `📚 Card có ${hits} thuật ngữ tu tiên/võ hiệp → đã tự nạp bộ thuật ngữ chuẩn (+${added} mục vào Từ điển; mục bạn tự nhập luôn được giữ).`);
              break;
            }
          }
        }

        const cfgP0 = useStore.getState().translationConfig;
        const existingSources = new Set(cfgP0.glossary.map(g => g.source.trim()));
        const candidates = extractNameCandidates(fields).filter(c => !existingSources.has(c.term));
        if (candidates.length >= 2) {
          store.addLog('info', `📖 Pha 0 — bảng tên riêng: thấy ${candidates.length} tên/thuật ngữ lặp lại, đang dịch bảng tên (1 lượt gọi) để thống nhất toàn card…`);
          const { system, user } = buildNameGlossaryPrompt(candidates, cfgP0.targetLanguage, cfgP0.nameStyle, cfgP0.fandomMode, cfgP0.fandomName);
          const rawNames = await callProvider(store.proxy, system, user, abortRef.current!.signal, undefined,
            { label: '📖 Bảng tên riêng (Pha 0)', charCount: user.length });
          const nameEntries = parseNameGlossaryResponse(rawNames, candidates);
          if (nameEntries.length > 0) {
            // (Fix bug #10) đánh dấu auto: tên riêng của card hiện tại → dọn khi gỡ card/xoá cache.
            const { merged, added } = mergeGlossary(useStore.getState().translationConfig.glossary, nameEntries.map(e => ({ ...e, auto: true, origin: 'name' as const })));
            store.setTranslationConfig({ glossary: merged });
            const sample = nameEntries.slice(0, 3).map(e => `${e.source}→${e.target}`).join(', ');
            store.addLog('success', `📖 Pha 0 xong: +${added} mục vào bảng tên (${sample}${nameEntries.length > 3 ? ', …' : ''}) — mọi luồng dịch dùng chung, tên nhất quán.`);
          } else {
            store.addLog('info', '📖 Pha 0: AI không giữ tên nào (card ít tên riêng lặp lại) — dịch tiếp bình thường.');
          }
        }
      } catch (e: any) {
        if (checkAbort()) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
          store.addLog('warning', '⏹ Đã dừng dịch theo yêu cầu.');
          return;
        }
        // Pha 0 chỉ là tăng cường chất lượng — lỗi thì bỏ qua, KHÔNG chặn lượt dịch.
        store.addLog('warning', `📖 Pha 0 lỗi (${e?.message || e}) — bỏ qua bảng tên, dịch tiếp bình thường.`);
      }
    }

    const isBatchLorebook = store.translationConfig.lorebookStrategy === 'batch';
    // Mặc định TỪNG ENTRY (batchSize=1): mỗi field 1 request — an toàn nhất (AI không trộn thứ tự /
    // gán nhầm giữa các mục). Tốc độ đến từ đa luồng RPM (#1).
    // (User yêu cầu khôi phục) Nếu bật "gộp nhiều entry / 1 lần gọi" thì batchSize = số user nhập
    // (2..50); splitLorebookBatches vẫn tự chia nhỏ nếu 1 lô vượt trần ký tự/token.
    const batchSize = (isBatchLorebook && store.translationConfig.lorebookManualBatch)
      ? Math.max(2, Math.min(50, Math.floor(store.translationConfig.lorebookBatchSize) || 5))
      : 1;
    const lorebookGroups: FieldGroup[] = ['lorebook', 'lorebook_keys'];

    // ═══ (Fix bug #12) Card THƯỜNG (không MVU/không EJS) → KHÔNG chạy đồng bộ biến / "tự chế key" ═══
    // Trước đây Chiến lược B (Sync MVU) mặc định BẬT, nên kể cả card thường vẫn dò biến + gọi AI
    // dịch tên biến ("chế key"). Tệ hơn: từ điển MVU/EJS của card CŨ còn dính trong config (tái dùng
    // phiên bản hoặc LS) khiến card thường bị ép key cũ. Nay chỉ card THẬT SỰ là MVU/EJS (bộ dò
    // getMvuCardSummary/detectEjsCard) mới xử lý; card thường thì dọn sạch từ điển dây dính.
    // Nới ngưỡng: coi là MVU nếu có BẤT KỲ tín hiệu (isMvu score≥3, HOẶC 1 [initvar]/Zod/biến bất kỳ)
    // → không bỏ sót card MVU nhẹ; chỉ card hoàn toàn KHÔNG tín hiệu (card thường) mới bị skip.
    // (Bug 39c) NHẢ main thread trước cụm quét đồng bộ (getMvuCardSummary/detectEjsCard/
    // extractPotentialMvuKeys…) — để log Pha 0 kịp vẽ và trình duyệt kịp thở; gốc rễ treo
    // (extractZodDescriptions backtracking) đã fix tận nơi, đây là lưới bảo hiểm cho hotspot mới.
    await new Promise<void>((r) => setTimeout(r, 0));
    const mvuSummary = store.card ? getMvuCardSummary(store.card) : null;
    const cardIsMvu = !!mvuSummary && (mvuSummary.isMvu || mvuSummary.initvarCount > 0 || mvuSummary.hasZodSchema || mvuSummary.variableCount > 0);
    const cardIsEjs = store.card ? (() => { try { return detectEjsCard(store.card!).isEjs; } catch { return false; } })() : false;
    if (!cardIsMvu && Object.keys(useStore.getState().translationConfig.mvuDictionary).length > 0) {
      if (writeMvuDictAuto({}, 'dọn từ điển cho card thường')) {
        store.addLog('info', 'ℹ️ Card thường (không phát hiện biến MVU) → bỏ qua Chiến lược B, không tự chế key. Đã dọn từ điển MVU dây từ card trước.');
      }
    }
    if (!cardIsEjs && (Object.keys(useStore.getState().translationConfig.ejsEntryNameDict).length > 0 || Object.keys(useStore.getState().translationConfig.ejsKeywordDict).length > 0)) {
      store.setTranslationConfig({ ejsEntryNameDict: {}, ejsKeywordDict: {} });
    }

    // ═══ Strategy B: Build MVU Dictionary BEFORE starting loop ═══
    // In continueMode, skip if dictionary already populated (avoid re-calling AI)
    const existingMvuDictForCheck = useStore.getState().translationConfig.mvuDictionary;
    const skipMvuBuild = continueMode && Object.keys(existingMvuDictForCheck).length > 0;
    if (store.translationConfig.enableMvuSync && cardIsMvu && store.card && !skipMvuBuild) {
      try {
        store.addLog('info', '🔧 Chiến lược B (đồng bộ biến MVU): đang dò biến MVU/Zod…');
        // (User 2026 — khoá dict) 🔒 khoá → KHÔNG dò + KHÔNG gọi AI dịch tên biến; dùng nguyên dict user.
        const dictLockedB = useStore.getState().translationConfig.mvuDictLocked;
        if (dictLockedB) {
          store.addLog('info', `🔒 Từ điển MVU đang KHOÁ — bỏ qua tự dò/AI dịch tên biến; dùng nguyên ${Object.keys(useStore.getState().translationConfig.mvuDictionary).length} biến bạn đã chốt.`);
        }
        const extractedKeys = dictLockedB ? [] : extractPotentialMvuKeyStrings(store.card);

        if (extractedKeys.length > 0) {
          let existingDict = store.translationConfig.mvuDictionary;
          const totalMvuPasses = Math.max(1, Math.min(5, store.translationConfig.mvuScanPasses || 1));
          
          for (let mvuPass = 0; mvuPass < totalMvuPasses; mvuPass++) {
            if (checkAbort()) {
              runningRef.current = false;
              store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
              store.addLog('warning', '⏹ Đã dừng dịch theo yêu cầu.');
              return;
            }
            if (await waitForPause()) {
              runningRef.current = false;
              store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
              return;
            }

            existingDict = useStore.getState().translationConfig.mvuDictionary;
            const newKeys = extractedKeys.filter(k => !(k in existingDict));
            
            if (totalMvuPasses > 1) {
              store.addLog('info', `🔧 Chiến lược B — lượt ${mvuPass + 1}/${totalMvuPasses}: thấy ${extractedKeys.length} biến (${newKeys.length} mới, ${extractedKeys.length - newKeys.length} đã có)`);
            } else {
              store.addLog('info', `Thấy ${extractedKeys.length} biến (${newKeys.length} mới, ${extractedKeys.length - newKeys.length} đã có)`);
            }

            if (newKeys.length === 0) {
              if (totalMvuPasses > 1 && mvuPass > 0) {
                store.addLog('success', `🔧 Chiến lược B: đã dịch hết biến sau ${mvuPass} lượt — không còn biến mới`);
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
              computePoolConcurrency(store.proxy),   // chạy các lô tên biến SONG SONG qua pool
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
              if (writeMvuDictAuto(fixedDict, 'auto-add biến AI dịch')) {
                store.addLog('success', `✅ Auto-added ${addedCount} variable translations to MVU Dictionary`);
              }
            } else {
              store.addLog('info', 'Mọi biến đã là ASCII hoặc đã dịch — không cần gọi AI');
              break;
            }
          }
        } else {
          store.addLog('info', 'Thẻ này không có biến MVU/Zod');
        }
      } catch (mvuErr) {
        const mvuMsg = mvuErr instanceof Error ? mvuErr.message : String(mvuErr);
        if (mvuMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
          return;
        }
        store.addLog('warning', `⚠️ MVU auto-detect failed (non-critical): ${mvuMsg}`);
      }
    } else if (skipMvuBuild) {
      store.addLog('info', `🔧 Chiến lược B: dùng lại từ điển biến MVU đã có (${Object.keys(existingMvuDictForCheck).length} biến) — không dịch lại bằng AI`);
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
            store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
            return;
          }
          store.addLog('active', `⚠️ Chiến lược B: có ${conflicts.length} chỗ dịch mâu thuẫn — gọi AI xử lý trước khi tiếp tục…`);
          
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
            if (writeMvuDictAuto(fixedDict, 'xử lý mâu thuẫn dict')) {
              store.addLog('success', `✅ Chiến lược B: đã xử lý ${fixedCount} chỗ mâu thuẫn`);
            }
          } else {
            store.addLog('warning', `⚠️ Chiến lược B: không tự xử lý được mâu thuẫn`);
          }
        }
      } catch (conflictErr) {
        const conflictMsg = conflictErr instanceof Error ? conflictErr.message : String(conflictErr);
        if (conflictMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
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
        store.addLog('info', '🔮 Chiến lược C (đồng bộ EJS): đang quét tên mục & từ khoá EJS…');
        // (Bug 39c) nhả main thread để log trên kịp vẽ trước cụm quét EJS đồng bộ.
        await new Promise<void>((r) => setTimeout(r, 0));
        const ejsEntryRefs = extractEjsEntryNames(store.card);
        const ejsKeywords = extractEjsKeywords(store.card);
        const totalEjsPasses = Math.max(1, Math.min(5, store.translationConfig.ejsScanPasses || 1));

        for (let ejsPass = 0; ejsPass < totalEjsPasses; ejsPass++) {
          if (checkAbort()) {
            runningRef.current = false;
            store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
            store.addLog('warning', '⏹ Đã dừng dịch theo yêu cầu.');
            return;
          }
          if (await waitForPause()) {
            runningRef.current = false;
            store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
            return;
          }

          const existingEntryDict = useStore.getState().translationConfig.ejsEntryNameDict;
          const existingKwDict = useStore.getState().translationConfig.ejsKeywordDict;

          const newEntryNames = ejsEntryRefs.map(r => r.name).filter(n => !(n in existingEntryDict));
          const newKeywords = ejsKeywords.map(k => k.keyword).filter(k => !(k in existingKwDict));

          if (totalEjsPasses > 1) {
            store.addLog('info', `🔮 Chiến lược C — lượt ${ejsPass + 1}/${totalEjsPasses}: thấy ${ejsEntryRefs.length} tham chiếu mục (${newEntryNames.length} mới), ${ejsKeywords.length} từ khoá (${newKeywords.length} mới)`);
          } else {
            store.addLog('info', `Thấy ${ejsEntryRefs.length} tham chiếu mục (${newEntryNames.length} mới), ${ejsKeywords.length} từ khoá (${newKeywords.length} mới)`);
          }

          if (newEntryNames.length === 0 && newKeywords.length === 0) {
            if (totalEjsPasses > 1 && ejsPass > 0) {
              store.addLog('success', `🔮 Chiến lược C: đã dịch hết mục EJS sau ${ejsPass} lượt`);
            }
            break;
          }

          store.addLog('active', `🤖 Calling AI to translate ${newEntryNames.length} entry names + ${newKeywords.length} keywords (chia lô + đa luồng)...`);

          const ejsContext = (store.card!.data?.character_book?.entries || [])
            .filter((e: any) => e.content && /<%[\s\S]*?%>/.test(e.content))
            .map((e: any) => e.content)
            .join('\n\n')
            .slice(0, 3000);

          // Chạy đa luồng như MVU: chia lô nhỏ, bắn song song (callProvider tự gate RPM + xoay
          // key), tự retry item sót. Log tiến độ mỗi ~25% cho card bự.
          let lastPct = 0;
          const { entryTranslations, keywordTranslations } = await aiTranslateEjsEntries(
            newEntryNames,
            newKeywords,
            store.translationConfig.targetLanguage,
            store.proxy,
            abortRef.current?.signal,
            ejsContext,
            store.translationConfig.ejsTranslationPrompt,
            {
              concurrency: computePoolConcurrency(store.proxy),   // tổng ngân sách RPM toàn pool (mọi key×provider)
              onProgress: (done, total) => {
                const pct = Math.floor((done / Math.max(1, total)) * 100);
                if (pct - lastPct >= 25 || done >= total) {
                  lastPct = pct;
                  store.addLog('info', `   ⏳ EJS: ${done}/${total} mục (${pct}%)`);
                }
              },
            },
          );

          const mergedEntryDict = { ...existingEntryDict, ...entryTranslations };
          const mergedKwDict = { ...existingKwDict, ...keywordTranslations };
          const addedEntries = Object.keys(entryTranslations).length;
          const addedKw = Object.keys(keywordTranslations).length;

          if (addedEntries > 0 || addedKw > 0) {
            store.setTranslationConfig({ ejsEntryNameDict: mergedEntryDict, ejsKeywordDict: mergedKwDict });
            store.addLog('success', `✅ Chiến lược C: thêm ${addedEntries} bản dịch tên mục + ${addedKw} bản dịch từ khoá`);
          } else {
            store.addLog('info', 'Mọi mục EJS đã dịch hoặc không có chữ Hán cần dịch');
            break;
          }
        }

        if (store.translationConfig.ejsDecoratorPreserve) {
          const ejsDetection = detectEjsCard(store.card);
          if (ejsDetection.hasDecorators) {
            store.addLog('info', '🛡️ Chiến lược C: bảo vệ dòng đặc biệt (@@, [GENERATE:], @INJECT) khỏi bị dịch');
          }
        }
      } catch (ejsErr) {
        const ejsMsg = ejsErr instanceof Error ? ejsErr.message : String(ejsErr);
        if (ejsMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
          return;
        }
        store.addLog('warning', `⚠️ EJS auto-detect failed (non-critical): ${ejsMsg}`);
      }
    } else if (skipEjsBuild) {
      store.addLog('info', `🔮 Chiến lược C: dùng lại từ điển EJS đã có (${Object.keys(existingEjsDictForCheck || {}).length} mục + ${Object.keys(existingKwDictForCheck || {}).length} từ khoá) — không dịch lại bằng AI`);
    }

    // ═══ (User 2026 — việc 79) ĐỐI CHIẾU CHÉO B ↔ C trước khi dịch ═══
    // Hai chiến lược gọi AI riêng, không bên nào thấy từ điển bên kia → cùng một từ gốc rất
    // hay ra hai bản dịch lệch nhau (B: "Tu Vi", C: "Cảnh Giới"). Dịch xong thì biến MVU tên
    // một đằng, getwi()/từ khoá EJS gọi một nẻo → bảng trống, lorebook không kích hoạt.
    // Chạy ở ĐÂY vì cả hai dict đã chốt mà chưa được áp xuống card — chỉ cần sửa từ điển.
    {
      const cfg = useStore.getState().translationConfig;
      if (cfg.enableMvuSync && cfg.enableEjsSync) {
        const unified = unifyCrossStrategyDicts(
          cfg.mvuDictionary,
          cfg.ejsEntryNameDict,
          cfg.ejsKeywordDict,
          { mvuDictLocked: cfg.mvuDictLocked },
        );
        if (unified.conflicts.length > 0) {
          store.addLog('active', `🔗 Đối chiếu B↔C: ${unified.conflicts.length} từ bị hai bên dịch lệch nhau — đang thống nhất…`);
          for (const c of unified.conflicts.slice(0, 12)) {
            store.addLog('info', `   • "${c.source}": B="${c.mvuValue}" / C="${c.ejsValue}" → chọn "${c.unified}" (${c.reason})`);
          }
          if (unified.conflicts.length > 12) {
            store.addLog('info', `   … và ${unified.conflicts.length - 12} từ nữa`);
          }
          // Dict B đang KHOÁ thì chỉ được sửa phía C — writeMvuDictAuto tự chặn ghi vào B.
          writeMvuDictAuto(unified.mvuDictionary, 'thống nhất B↔C');
          store.setTranslationConfig({
            ejsEntryNameDict: unified.ejsEntryNameDict,
            ejsKeywordDict: unified.ejsKeywordDict,
          });
          store.addLog('success', `✅ Đối chiếu B↔C: đã thống nhất ${unified.fixedCount} ô từ điển`);
        }
      }
    }

    store.setLogPhase('translate'); // gom log giai đoạn Dịch (vòng lặp từng trường)
    let i = 0;

    while (i < fields.length) {
      // Superseded by a newer run → bail silently without touching shared phase state
      if (runIdRef.current !== myRunId) {
        store.addLog('info', 'Vòng dịch cũ dừng lại (đã có vòng mới thay thế)');
        return;
      }

      // Check abort
      if (checkAbort()) {
        runningRef.current = false;
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
        store.addLog('warning', '⏹ Đã dừng dịch theo yêu cầu.');
        return;
      }

      // Handle pause
      if (await waitForPause()) {
        runningRef.current = false;
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
        return;
      }

      const field = fields[i];

      // ─── Batch mode for lorebook fields ───
      if (isBatchLorebook && lorebookGroups.includes(field.group)) {
        const concurrency = computePoolConcurrency(store.proxy);   // tổng ngân sách RPM toàn pool (mọi key×provider)
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

        // ═══ (User yêu cầu) KIỂM TRA TOKEN TRƯỚC KHI CHẠY (chỉ khi gộp nhiều entry / 1 lần gọi) ═══
        // Ước lượng lô nặng nhất so với trần OUTPUT token của model → cảnh báo nếu batchSize quá lớn.
        // splitLorebookBatches vẫn tự chia nhỏ để không tràn, nên đây là cảnh báo + gợi ý (không chặn).
        if (store.translationConfig.lorebookManualBatch && batchSize > 1) {
          const est = estimateLorebookBatchLoad(
            allLorebookFields.map(f => f.original),
            batchSize,
            store.proxy.maxTokens || 65536,
          );
          const pct = Math.round(est.ratio * 100);
          if (est.verdict === 'danger') {
            store.addLog('warning', `⚠️ Gộp ${batchSize} entry/lô: lô nặng nhất ~${est.worstBatchChars.toLocaleString()} ký tự → ước ~${est.estOutputTokens.toLocaleString()} token đầu ra (${pct}% trần ${est.outputLimit.toLocaleString()} của model) — CÓ THỂ VƯỢT/CẮT CỤT. Đề xuất giảm còn ${est.recommendedBatchSize} entry/lô. (Hệ thống sẽ tự chia nhỏ lô quá lớn để tránh tràn.)`);
          } else if (est.verdict === 'warn') {
            store.addLog('info', `ℹ️ Gộp ${batchSize} entry/lô: lô nặng nhất ~${est.estOutputTokens.toLocaleString()} token đầu ra (${pct}% trần model). An toàn tương đối; nếu thấy dịch thiếu/lỗi, giảm còn ~${est.recommendedBatchSize} entry/lô.`);
          } else {
            store.addLog('info', `✅ Gộp ${batchSize} entry/lô: ước ~${est.estOutputTokens.toLocaleString()} token đầu ra/lô (${pct}% trần model) — an toàn.`);
          }
        }

        // Step 2: Split into sub-batches — logic chia lô DÙNG CHUNG với pipeline Mod
        // (utils/batchSplit, audit đợt 3 — trước đây đúp nguyên khối 2 nơi, sửa 1 nơi quên nơi kia).
        const getTargetModelFor = (f: TranslationField) => store.translationConfig.enableModelRouting
          ? (store.translationConfig.entryModelRouting[f.path] || store.translationConfig.groupModelRouting[f.group] || store.proxy.model)
          : store.proxy.model;
        const smartOn = store.translationConfig.smartBatchPacking;
        const { batches: subBatches, prefer: subBatchPrefer, summary: splitSummary } = splitLorebookBatches(allLorebookFields, {
          batchSize,
          maxBatchChars: MAX_BATCH_CHARS,
          mvuEnabled: isMvuEnabled,
          getModelKey: getTargetModelFor,
          isolateChars: LONG_ENTRY_ISOLATE_CHARS, // entry dài → lô riêng để dịch chunk
          softCharCap: SOFT_CHAR_CAP,
          softMinCount: 3,
          smartPacking: smartOn, // ⚡ Dịch siêu tốc: gộp entry ngắn → model phụ
        });
        if (isMvuEnabled) {
          store.addLog('info', `🔧 MVU batch grouping: ${allLorebookFields.length} fields → [${splitSummary}] → ${subBatches.length} batch(es)`);
        } else {
          const avgBatchSize = subBatches.length > 0 ? Math.round(allLorebookFields.length / subBatches.length) : 0;
          store.addLog('info', `${allLorebookFields.length} lorebook fields → ${subBatches.length} batch(es) (avg ${avgBatchSize}/batch), concurrency: ${concurrency}`);
        }

        store.setCurrentFieldIndex(i - 1);

        // Step 3: Dispatch sub-batches — POOL WORKER LIÊN TỤC (không rào chắn đợt).
        // Mỗi worker xong 1 batch là KÉO batch kế NGAY, không đợi cả đợt → không phí thời gian
        // chờ straggler. RPM vẫn an toàn vì mỗi call qua pickLane. Cache lưu định kỳ thay vì mỗi đợt.
        let savedLb = 0; const saveEveryLb = Math.max(4, Math.floor(concurrency / 2));
        if (smartOn) {
          const packed = subBatchPrefer.filter(Boolean).length;
          store.addLog('info', `⚡ Dịch siêu tốc: ${allLorebookFields.length} entry → ${subBatches.length} call (${packed} lô gộp đi model phụ, ${subBatches.length - packed} entry dài đi model chính)`);
        }
        const lbPool = await runWorkerPool({
          total: subBatches.length,
          concurrency,
          runOne: (idx) => translateOneBatch(subBatches[idx], 0, subBatchPrefer[idx] || false),
          shouldStop: () => !!checkAbort(),
          waitIfPaused: waitForPause,
          onSettled: () => { if (++savedLb % saveEveryLb === 0) store.saveTranslationCache(); },
          betweenMs: store.proxy.requestDelay,
        });
        store.saveTranslationCache();
        if (lbPool.cancelled) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
          store.addLog('warning', '⏹ Đã dừng dịch.');
          return;
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

        store.addLog('info', `🔧 Regex: đang dịch ${regexFields.length} script regex…`);

        // Dịch 1 script regex (giữ NGUYÊN logic cũ). Ném 'Cancelled' để pool dừng cả mẻ.
        // Abort/pause do runWorkerPool lo ở đầu mỗi vòng worker (nhạy hơn per-field cũ).
        const translateOneRegexField = async (rf: TranslationField): Promise<void> => {
          // Skip already done fields (for continue mode)
          if (rf.status === 'done') return;

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
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
              store.addLog('active', `🔪 Dịch phẫu thuật (chỉ sửa phần cần) cho ${rf.label}…`);
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
                store.addLog('warning', `Dịch phẫu thuật cho ${rf.label} không đạt — chuyển sang dịch thường.`);
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
                computePoolConcurrency(store.proxy),
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
              throw new Error('Cancelled'); // → runWorkerPool set cancelled + dừng cả mẻ
            }
            store.updateField(rf.path, { status: 'error', error: msg });
            store.addLog('error', `Regex translate failed: ${rf.label} — ${msg}`);
          }
        };

        // POOL WORKER LIÊN TỤC cho regex (trước đây chạy TUẦN TỰ từng script → chậm khi nhiều regex).
        const regexConc = computePoolConcurrency(store.proxy);
        let savedRx = 0; const saveEveryRx = Math.max(4, Math.floor(regexConc / 2));
        const rxPool = await runWorkerPool({
          total: regexFields.length,
          concurrency: regexConc,
          runOne: (idx) => translateOneRegexField(regexFields[idx]),
          shouldStop: () => !!checkAbort(),
          waitIfPaused: waitForPause,
          onSettled: () => { if (++savedRx % saveEveryRx === 0) store.saveTranslationCache(); },
          betweenMs: store.proxy.requestDelay,
        });
        store.saveTranslationCache();
        if (rxPool.cancelled) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
          store.addLog('warning', '⏹ Đã dừng dịch.');
          return;
        }

        // Delay before next non-regex field
        if (i < fields.length && store.proxy.requestDelay > 0) {
          await new Promise((r) => setTimeout(r, store.proxy.requestDelay));
        }
        continue;
      }

      // ─── (Audit đợt 1) Chiến lược 'single' + lorebook: ĐA LUỒNG thay vì tuần tự ───
      // Trước đây strategy 'single' dịch 74 entry lorebook TỪNG CÁI MỘT (chậm kinh khủng) — trong khi
      // các entry độc lập nhau. Nay gom dải entry LIỀN NHAU cùng nhóm (lorebook / lorebook_keys),
      // KHÔNG phải MVU-critical (initvar/controller/mvu_logic vẫn tuần tự để giữ đồng bộ biến), rồi
      // chạy SONG SONG qua pool — mỗi entry vẫn 1 call riêng, prompt y hệt ⇒ chất lượng không đổi,
      // chỉ nhanh hơn. Chỉ gom dải CÙNG NHÓM liền kề nên thứ tự giữa các nhóm (keys ↔ content) giữ nguyên.
      if (
        !isBatchLorebook &&
        lorebookGroups.includes(field.group) &&
        !isMvuCriticalField(field)
      ) {
        const waveGroup = field.group;
        const waveIdx: number[] = [];
        let j = i;
        while (j < fields.length && fields[j].group === waveGroup && !isMvuCriticalField(fields[j])) {
          const st = fields[j].status;
          if (st === 'pending' || st === 'error') waveIdx.push(j);
          j++;
        }
        if (waveIdx.length >= 2) {
          const waveConc = computePoolConcurrency(store.proxy);
          store.addLog('info', `⚡ ${waveIdx.length} mục ${waveGroup} độc lập → dịch SONG SONG qua pool (ngân sách ${waveConc} luồng)`);
          let savedWv = 0; const saveEveryWv = Math.max(4, Math.floor(waveConc / 2));
          const wvPool = await runWorkerPool({
            total: waveIdx.length,
            concurrency: waveConc,
            runOne: async (k) => {
              const fi = waveIdx[k];
              const fresh = useStore.getState().fields.find(x => x.path === fields[fi].path) || fields[fi];
              let r = await translateSingleField(fresh, fi, fields);
              let guard = 0;
              while (r === 'retry' && guard++ < 8) {
                if (checkAbort()) throw new Error('Cancelled');
                if (await waitForPause()) throw new Error('Cancelled');
                const again = useStore.getState().fields.find(x => x.path === fields[fi].path) || fresh;
                r = await translateSingleField(again, fi, useStore.getState().fields);
              }
              if (r === 'retry') {
                store.updateField(fields[fi].path, { status: 'error', error: 'Vượt số lần thử lại — bỏ qua để dịch tiếp' });
              }
            },
            shouldStop: () => !!checkAbort(),
            waitIfPaused: waitForPause,
            onSettled: () => { if (++savedWv % saveEveryWv === 0) store.saveTranslationCache(); },
            betweenMs: store.proxy.requestDelay,
          });
          store.saveTranslationCache();
          if (wvPool.cancelled) {
            runningRef.current = false;
            store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
            store.addLog('warning', '⏹ Đã dừng dịch.');
            return;
          }
          i = j; // nhảy qua cả dải đã xử lý
          continue;
        }
        // dải chỉ 0-1 mục cần dịch → rơi xuống single mode như cũ
      }

      // ─── Single field mode ───
      try {
        let result = await translateSingleField(field, i, fields);
        // (Sửa bug #3) Lưới an toàn: 'retry' vốn KHÔNG tăng i (dịch lại CÙNG field). Bọc trong vòng
        // CÓ GIỚI HẠN để 1 field không thể kẹt vô hạn → treo cả bản dịch ("dịch tới đây rồi nằm im").
        // Các guard tự dừng ở maxRetries; đây là chốt chặn cứng phòng trường hợp bất ngờ.
        let retryGuard = 0;
        while (result === 'retry' && retryGuard++ < 8) {
          if (checkAbort()) throw new Error('Cancelled');
          if (await waitForPause()) throw new Error('Cancelled');
          result = await translateSingleField(field, i, useStore.getState().fields);
        }
        if (result === 'retry') {
          // Vẫn 'retry' sau 8 lần → KHÔNG kẹt: đánh dấu lỗi rồi đi tiếp field kế (rơi xuống i++).
          store.updateField(field.path, { status: 'error', error: 'Vượt số lần thử lại — bỏ qua để dịch tiếp' });
          store.addLog('warning', `⚠️ ${field.label}: vượt số lần thử lại, bỏ qua để không kẹt.`);
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
                  if (writeMvuDictAuto(dictAfterConsistency, 'covariance inject key từ schema')) {
                    if (fixes.length > 0) {
                      store.addLog('info', `🔒 Exact consistency: fixed ${fixes.length} case/spelling variations: ${fixes.join(', ')}`);
                    }
                    store.addLog('info', `🔗 Cross-Script Covariance: injected ${newEntries.length} key mapping(s) from translated schema → dictionary (total: ${earlyMappingCount})`);
                  }

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
                        if (writeMvuDictAuto(resolvedDict, 'AI resolve mâu thuẫn covariance')) {
                          store.addLog('success', `✅ Cross-Script Covariance: AI resolved ${fixedCount} conflict(s)`);
                        }
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
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
        store.addLog('warning', '⏹ Đã dừng dịch.');
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

    // ═══ (User yêu cầu 2026) SWEEP CUỐI: ĐỒNG NHẤT TÊN BIẾN MVU toàn thẻ ═══
    // Field dịch TRƯỚC khi dict đủ có thể còn dạng lệch (Họ_Tên / Họ tên). Nay dict đã đủ → làm sạch
    // dict về dạng chuẩn "Họ Tên" (bỏ `_`/`-`) rồi ENFORCE LẠI mọi field code/lorebook đã xong.
    if (store.translationConfig.enableMvuSync) {
      try {
        const rawDict = useStore.getState().translationConfig.mvuDictionary;
        if (rawDict && Object.keys(rawDict).length > 0) {
          // (User 19/07) 🎌 Đồng nhân: sweep CHỈ đụng field code. Trước đây nó áp từ điển biến lên
          // cả văn xuôi lorebook ở CUỐI lượt dịch — đó chính là cơ chế "đã dịch đúng rồi sau một
          // hồi lại tự sửa thành sai" (Yukino ở narrative bị kéo về dạng trong dict biến).
          const { fields: sweptFields, dictionary: fixedDict, fixCount } = recanonicalizeMvuInFields(
            useStore.getState().fields, rawDict, useStore.getState().mvuKeyMetadata,
            store.translationConfig.fandomMode,
          );
          // (khoá dict) 🔒 → không chuẩn hoá lại dict (user chốt dạng nào giữ dạng đó, kể cả _/-).
          if (writeMvuDictAuto(fixedDict, 'sweep chuẩn hoá dict (_/- → space)') && fixCount > 0) {
            store.setFields(sweptFields);
            store.addLog('success', `🔗 Đồng nhất tên biến MVU: chuẩn hoá ${fixCount} field về 1 dạng thống nhất (bỏ dấu _/-).`);
          }
        }
      } catch { /* sweep chỉ tăng cường chất lượng — lỗi thì bỏ qua, không chặn hoàn tất */ }
    }

    // ═══ (User 2026) HỌC TỪ ĐIỂN TRONG KHI DỊCH: "gặt" tên/biệt danh từ keyword lorebook + tên thẻ
    // ĐÃ DỊCH → merge vào glossary (origin 'harvest'). Bộ rule của thẻ tự lớn dần từ chính bản dịch;
    // lần dịch lại / dịch tiếp dùng chung → tên nhất quán. Thuần luật, không tốn AI. ═══
    try {
      const harvested = harvestGlossaryFromFields(useStore.getState().fields);
      if (harvested.length > 0) {
        const { merged, added } = mergeGlossary(useStore.getState().translationConfig.glossary, harvested);
        if (added > 0) {
          store.setTranslationConfig({ glossary: merged });
          const sample = harvested.slice(0, 3).map(e => `${e.source}→${e.target}`).join(', ');
          store.addLog('success', `📚 Học từ điển khi dịch: +${added} tên/biệt danh từ bản dịch (${sample}${harvested.length > 3 ? ', …' : ''}) — thêm vào bộ rule của thẻ.`);
        }
      }
    } catch { /* harvest chỉ tăng cường — lỗi thì bỏ qua */ }

    // ═══ (User 2026 — việc 80) QUÉT CHỮ TRUNG CÒN SÓT → TỰ DỊCH LẠI ═══
    // Đặt TRƯỚC sweep đồng nhất EJS bên dưới: field vừa dịch lại phải được chuẩn hoá từ điển
    // như mọi field khác, nếu chạy sau thì bản vá lọt lưới enforce. Cũng chạy trước khi chốt
    // 'done' để con số "x thành công / y lỗi" báo ra là con số SAU khi vá.
    if (!checkAbort()) {
      try {
        await residualSweepRef.current?.(2);
      } catch (sweepErr) {
        const m = sweepErr instanceof Error ? sweepErr.message : String(sweepErr);
        if (m !== 'Cancelled') store.addLog('warning', `⚠️ Quét chữ Trung sót lỗi (không nghiêm trọng): ${m}`);
      }
    }

    // ═══ (User 2026) SWEEP CUỐI: ĐỒNG NHẤT TỪ ĐIỂN EJS (Chiến lược C) ═══
    // Làm sạch value (bỏ dấu/ký tự lạ, gộp hoa-thường) + gom cụm gần-giống → 1 dạng, rồi ENFORCE LẠI
    // mọi field code/lorebook với dict đã sạch → hết cảnh cùng keyword ra nhiều dạng gây EJS/MVU gãy.
    if (store.translationConfig.enableEjsSync) {
      try {
        const kwRaw = useStore.getState().translationConfig.ejsKeywordDict || {};
        const enRaw = useStore.getState().translationConfig.ejsEntryNameDict || {};
        const kwRes = enforceEjsDictConsistency(kwRaw);
        const enRes = enforceEjsDictConsistency(enRaw);
        if (kwRes.fixes.length > 0 || enRes.fixes.length > 0) {
          store.setTranslationConfig({ ejsKeywordDict: kwRes.fixedDict, ejsEntryNameDict: enRes.fixedDict });
        }
        const cleanKw = kwRes.fixedDict, cleanEn = enRes.fixedDict;
        let swept = 0;
        for (const f of useStore.getState().fields) {
          if (f.status !== 'done' || typeof f.translated !== 'string' || !f.translated) continue;
          if (f.group !== 'lorebook' && f.group !== 'tavern_helper' && f.group !== 'regex') continue;
          let t = enforceEjsCovariance(f.translated, cleanEn, cleanKw).text;
          t = enforceEjsKeywordCasing(t, cleanEn, cleanKw).text;
          if (t !== f.translated) { store.updateField(f.path, { translated: t }); swept++; }
        }
        if (swept > 0) store.addLog('success', `🔗 Đồng nhất từ điển EJS: chuẩn hoá ${swept} field về 1 dạng thống nhất (bỏ dấu lạ / hoa-thường lệch).`);
      } catch { /* sweep chỉ tăng cường — lỗi thì bỏ qua */ }
    }

    runningRef.current = false;
    store.setPhase('done');
    store.saveTranslationCache();
    // `store` là snapshot lúc render → store.fields còn status CŨ (pending). Phải đọc
    // FRESH từ getState() nếu không toast báo "0/16" dù đã xong 16/16.
    const freshFields = useStore.getState().fields;
    const doneCount = freshFields.filter((f) => f.status === 'done').length;
    const failCount = freshFields.filter((f) => f.status === 'error').length;
    store.addLog('info', `🎉 Dịch xong: ${doneCount} thành công, ${failCount} lỗi`);
    store.addToast('success', `Translation complete! ${doneCount}/${fields.length} fields translated`);

    // (User 2026) Dịch xong có kết quả thật → mở popup hướng dẫn bước tiếp (Sức khoẻ thẻ / Đồng nhất
    // biến MVU / AI Verify). Popup tự tôn trọng "Đừng hiện lại" nên gọi vô điều kiện ở đây.
    if (doneCount > 0) useStore.getState().triggerTranslateGuide();

    // ═══ Tổng kết token THẬT của cả run (đọc từ usage/usageMetadata; thiếu thì ước lượng ~) ═══
    {
      const tok = CallMonitor.getTokenTotals();
      if (tok.calls > 0) {
        const k = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
        const approx = tok.estimatedCalls > 0 ? '~' : '';
        const perLane = tok.lanes
          .filter(l => l.calls > 0)
          .sort((a, b) => (b.input + b.output) - (a.input + a.output))
          .map(l => `${l.model}: ${k(l.input)} vào / ${k(l.output)} ra (${l.calls} call${l.cached > 0 ? `, ⚡${k(l.cached)} cache` : ''})`)
          .join(' · ');
        const cachedNote = tok.cached > 0
          ? ` — trong đó ⚡${k(tok.cached)} token vào TRÚNG CACHE provider (${Math.round((tok.cached / Math.max(1, tok.input)) * 100)}%, rẻ + nhanh hơn)`
          : '';
        store.addLog('info', `🧮 Token cả lượt dịch: ${approx}${k(tok.input)} vào / ${approx}${k(tok.output)} ra, ${tok.calls} call${cachedNote}${tok.estimatedCalls > 0 ? ` (${tok.estimatedCalls} call API không trả usage — phần đó là ước lượng)` : ''}. ${perLane}`);
      }
    }

    store.setLogPhase('verify'); // gom log giai đoạn Kiểm tra (hậu kiểm MVU/EJS)

    // ═══ Post-Translation MVU-ZOD Sync Verification Report ═══
    if (store.translationConfig.enableMvuSync && Object.keys(store.translationConfig.mvuDictionary).length > 0) {
      const syncReport = generateSyncReport(
        freshFields.filter(f => f.status === 'done').map(f => ({
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
        store.addLog('success', `✅ Đồng bộ MVU: đã thay đúng toàn bộ ${syncReport.totalVars} biến!`);
      } else {
        store.addLog('warning', `⚠️ Đồng bộ MVU: còn ${missingVars} biến CHƯA được thay! Xem bảng Kiểm tra để biết chi tiết.`);
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
      const doneFields = freshFields.filter(f => f.status === 'done');
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
          store.addLog('success', `✅ Đồng bộ EJS: đã đồng bộ đúng toàn bộ ${entryNameResult.matchedNames.length} tên mục trong văn bản!`);
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
        const doneFields = freshFields.filter(f => f.status === 'done');
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
            store.addLog('success', `✅ Chiến lược C: đã đồng bộ đúng ${ejsSyncResult.matchedEntryNames} tên mục getwi()!`);
          } else {
            store.addLog('warning', `⚠️ Chiến lược C: còn ${ejsSyncResult.missingEntryNames.length} tên mục getwi() CHƯA đồng bộ!`);
            for (const m of ejsSyncResult.missingEntryNames.slice(0, 5)) {
              store.addLog('error', `  getwi() "${m.name}" → "${m.translatedName}" still using original in: ${m.referencedIn.join(', ')}`);
            }
          }
        }

        // Report keyword sync
        if (ejsSyncResult.totalKeywords > 0) {
          if (ejsSyncResult.missingKeywords.length === 0) {
            store.addLog('success', `✅ Chiến lược C: đã đồng bộ đúng ${ejsSyncResult.matchedKeywords} từ khoá EJS!`);
          } else {
            store.addLog('warning', `⚠️ Chiến lược C: còn ${ejsSyncResult.missingKeywords.length} từ khoá EJS CHƯA đồng bộ!`);
            for (const m of ejsSyncResult.missingKeywords.slice(0, 5)) {
              store.addLog('error', `  Keyword "${m.keyword}" → "${m.translatedKeyword}" still original in: ${m.foundIn}`);
            }
          }
        }

        // Report broken decorators
        if (ejsSyncResult.brokenDecorators.length > 0) {
          store.addLog('warning', `⚠️ Chiến lược C: ${ejsSyncResult.brokenDecorators.length} dòng đặc biệt bị đổi/thiếu!`);
          for (const d of ejsSyncResult.brokenDecorators.slice(0, 5)) {
            store.addLog('error', `  Decorator "${d.original}" → ${d.translated} in: ${d.fieldPath}`);
          }
        }
      }
    }
  }, [prepareFields, store]);

  // #2: quét lại 'translating' → 'pending' NHIỀU LẦN trong ~2.5s sau khi Dừng/Hủy. Với đa luồng cao,
  // một số task nền (đang trong backoff/await fetch chưa abort xong) có thể set lại 'translating' NGAY
  // SAU lần reset đầu; sweeper dọn các straggler đó. Chỉ quét khi loop KHÔNG chạy (chưa bấm Tiếp tục)
  // để không phá một lần Resume ngay sau đó.
  const sweepStuckToPending = useCallback(() => {
    [200, 500, 1000, 1800, 2600].forEach((ms) => {
      setTimeout(() => {
        if (runningRef.current) return;   // đã Resume → thôi
        const stuck = useStore.getState().fields.filter(f => f.status === 'translating');
        if (stuck.length) for (const f of stuck) store.updateField(f.path, { status: 'pending' });
      }, ms);
    });
  }, [store]);

  const pauseTranslation = useCallback(() => {
    // ═══ HARD, RESUMABLE PAUSE ═══
    // The user usually pauses to EDIT an entry. A cooperative pause would let the
    // in-flight entry (and concurrent batches) finish and advance first — that was the
    // "vừa dừng mà vẫn tự chạy tiếp 1 entry" bug. So we stop hard: supersede the loop,
    // abort in-flight work, and reset any mid-flight field to pending. Nothing runs again
    // until the user presses Tiếp tục/Start (which continues via startTranslation(true),
    // preserving logs + the elapsed timer, and re-doing the reset fields from cached chunks).
    pauseRef.current = true;
    runIdRef.current++;                 // any live loop bails silently at its next checkpoint
    abortRef.current?.abort();          // stop in-flight field/batch translations
    for (const [, ctrl] of fieldAbortMap.current) ctrl.abort();
    fieldAbortMap.current.clear();
    inFlightPaths.current.clear();
    runningRef.current = false;
    const stuck = useStore.getState().fields.filter(f => f.status === 'translating');
    for (const f of stuck) store.updateField(f.path, { status: 'pending' });
    sweepStuckToPending();              // dọn straggler do task nền set lại 'translating' sau reset
    store.setPhase('paused');
    store.saveTranslationCache();
    store.addLog('warning', '⏸ Đã tạm dừng. Cứ sửa entry thoải mái — nó sẽ KHÔNG tự chạy; bấm Tiếp tục/Start mới chạy lại.');
  }, [store]);

  const resumeTranslation = useCallback(() => {
    pauseRef.current = false;
    if (runningRef.current) {
      // Loop still alive (cooperative pause) — just flip the flag and it continues.
      store.setPhase('translating');
      store.addLog('info', '▶ Tiếp tục dịch.');
    } else {
      // Hard pause (or an error) killed the loop → restart in CONTINUE mode, picking up
      // pending fields. Route to the SAME flow that was running (translate vs mod).
      store.addLog('info', '▶ Tiếp tục...');
      const stuckFields = useStore.getState().fields.filter(f => f.status === 'translating');
      for (const f of stuckFields) {
        store.updateField(f.path, { status: 'pending' });
      }
      store.setPhase('translating');
      setTimeout(() => {
        if (lastRunModeRef.current === 'mod' && applyModRef.current) {
          applyModRef.current(true);
        } else {
          startTranslation(true);
        }
      }, 0);
    }
  }, [store, startTranslation]);

  const cancelTranslation = useCallback(() => {
    // Invalidate any running loop so it bails at its next checkpoint
    runIdRef.current++;
    abortRef.current?.abort();
    // Also cancel any per-field in-flight translations
    for (const [, ctrl] of fieldAbortMap.current) {
      ctrl.abort();
    }
    fieldAbortMap.current.clear();
    inFlightPaths.current.clear();
    pauseRef.current = false;
    runningRef.current = false;
    // Reset any fields stuck in 'translating' status back to 'pending'
    const stuckFields = useStore.getState().fields.filter(f => f.status === 'translating');
    for (const f of stuckFields) {
      store.updateField(f.path, { status: 'pending' });
    }
    sweepStuckToPending();              // #2: dọn straggler nền sau khi Hủy
    store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
  }, [store, sweepStuckToPending]);

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

  /**
   * `extraInstruction` (User 2026 — việc 80): câu nhắc gắn thêm vào cuối prompt cho lượt dịch lại.
   * Dịch lại y nguyên prompt cũ thì AI rất dễ ra đúng kết quả cũ — phải chỉ mặt chỗ hỏng.
   */
  const retranslateField = useCallback(async (path: string, resume = false, extraInstruction?: string) => {
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
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
        extraInstruction ? `${promptResult.effectivePrompt}\n${extraInstruction}` : promptResult.effectivePrompt,
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
        computePoolConcurrency(store.proxy),
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
        translated = fixNestedQuoteBracketPaths(translated);
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
        store.addLog('error', `Dịch lại lỗi: ${field.label} — phần ${err.failedChunkIndex + 1}/${err.totalChunks} (đã lưu ${err.completedChunks.length})`);
      } else {
        store.updateField(path, { status: 'error', error: msg });
        store.addLog('error', `Re-translate failed: ${field.label} — ${msg}`);
      }
    } finally {
      // Clean up per-field abort controller
      fieldAbortMap.current.delete(path);
    }
  }, [store]);

  /**
   * ═══ (User 2026 — việc 80) QUÉT CHỮ TRUNG CÒN SÓT SAU KHI DỊCH → TỰ DỊCH LẠI ═══
   *
   * Guard trong vòng dịch chỉ chặn theo TỶ LỆ sống sót (>35%, và nguồn phải ≥20 chữ Hán) — nó
   * sinh ra để bắt ca "AI trả lại nguyên văn", KHÔNG bắt được dịch SÓT. Field dịch được 90%,
   * còn lơ thơ vài chục chữ Hán rải rác, vẫn được đánh 'done'. Đây là lưới cuối cùng: đếm
   * CHÍNH XÁC chữ Hán còn lại rồi dịch lại đúng những field đó, kèm chỉ rõ đoạn nào còn sót.
   *
   * KHÔNG đếm chữ Hán trong LINK (yêu cầu của user) và trong giá trị CSS giữ nguyên có chủ ý —
   * đếm mấy thứ đó thì dịch kiểu gì cũng còn, thành retry vô tận.
   */
  const residualCjkSweep = useCallback(async (maxRounds = 2): Promise<number> => {
    const cssMode = useStore.getState().translationConfig.cssCjkHandling || 'preserve';
    let totalFixed = 0;

    for (let round = 1; round <= maxRounds; round++) {
      if (checkAbort()) return totalFixed;

      const hits = scanFieldsForResidualCjk(useStore.getState().fields, { cssCjkHandling: cssMode });
      if (hits.length === 0) {
        if (round === 1) store.addLog('success', '🔍 Quét chữ Trung sót: sạch, không mục nào còn tiếng Trung (link không tính).');
        return totalFixed;
      }

      const totalHan = hits.reduce((s, h) => s + h.count, 0);
      store.addLog('warning',
        `🔍 Quét chữ Trung sót (lượt ${round}/${maxRounds}): ${hits.length} mục còn tổng ${totalHan} chữ Hán chưa dịch — đang dịch lại…`
      );
      for (const h of hits.slice(0, 10)) {
        store.addLog('info', `   • ${h.label}: còn ${h.count} chữ — ${h.samples[0] || ''}`);
      }
      if (hits.length > 10) store.addLog('info', `   … và ${hits.length - 10} mục nữa`);

      for (const h of hits) {
        if (checkAbort()) return totalFixed;
        if (await waitForPause()) return totalFixed;
        await retranslateField(h.path, false, buildResidualRetryInstruction(h));
        totalFixed++;
      }
    }

    // Hết lượt mà vẫn còn → báo rõ chứ không im lặng nuốt (user cần biết để sửa tay).
    const left = scanFieldsForResidualCjk(useStore.getState().fields, { cssCjkHandling: cssMode });
    if (left.length > 0) {
      store.addLog('error',
        `❌ Sau ${maxRounds} lượt dịch lại vẫn còn ${left.length} mục có tiếng Trung ` +
        `(${left.reduce((s, h) => s + h.count, 0)} chữ). Cần xem tay: ${left.slice(0, 5).map(h => h.label).join(', ')}`
      );
    } else {
      store.addLog('success', `✅ Quét chữ Trung sót: đã dịch lại ${totalFixed} mục, giờ sạch hoàn toàn.`);
    }
    return totalFixed;
  }, [store, retranslateField, checkAbort, waitForPause]);

  // startTranslation được khai báo TRƯỚC hàm này nên không gọi thẳng được → đi qua ref.
  useEffect(() => { residualSweepRef.current = residualCjkSweep; }, [residualCjkSweep]);

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
      if (fixes.length > 0 && writeMvuDictAuto(fixedDict, 'export exact-consistency')) {
        store.addLog('info', `🔒 Export exact consistency: fixed ${fixes.length} case/spelling variations: ${fixes.join(', ')}`);
      }

      // Chiến lược B đồng bộ tên biến trên TOÀN thẻ (schema, initvar, regex, lorebook,
      // narrative) — KHÔNG giới hạn theo nhóm đang dịch. Nếu bó theo enabledGroups thì
      // khi tắt dịch content lorebook (ví dụ chế độ "Dịch nhẹ"), tên biến trong content
      // tiếng Trung không được đổi → lệch với schema/keys đã dịch. undefined = mọi nhóm.
      baseCard = syncMvuVariables(baseCard, fixes.length > 0 ? fixedDict : currentDict, undefined);
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

    // (bug 73) Nối lại sợi dây lorebook ↔ nhân vật. Ta CÓ dịch data.character_book.name
    // nhưng data.extensions.world thì trước giờ không ai đụng, nên card dịch ra luôn lệch:
    // sách tên tiếng Việt mà world vẫn trỏ tên tiếng Trung. SillyTavern chỉ mời import lore
    // khi world đó CHƯA tồn tại — ai đã cài bản gốc thì ST im lặng, và nhân vật bị gắn vào
    // world tiếng Trung cũ. Đó chính là "lorebook bị tách riêng, phải tự đi add lại".
    // `store.card` là bản GỐC — cần nó để không đụng world ngoài mà user cố ý trỏ tới.
    const link = syncEmbeddedWorldLink(exportCard, store.card);
    if (link.relinkedWorld) {
      store.addLog('info', `🔗 Đã nối lorebook vào nhân vật: World = "${link.worldName}"${link.renamedBook ? ' (sách chưa có tên riêng, đã tự đặt)' : ''}`);
    } else if (link.keptExternalWorld) {
      store.addLog('info', `🔗 Giữ nguyên World ngoài mà thẻ gốc trỏ tới: "${link.worldName}"`);
    }

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

    store.addLog('info', `♻️ Đang dịch lại ${errorFields.length} mục bị lỗi…`);
    let successCount = 0;
    let failCount = 0;

    for (const field of errorFields) {
      // Check abort/pause between fields
      if (checkAbort()) {
        runningRef.current = false;
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
        store.addLog('warning', 'Retry cancelled by user');
        return;
      }
      if (await waitForPause()) {
        runningRef.current = false;
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
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
            store.addLog('info', `🔄 Tiếp tục ${field.label}: đã có ${filledCount} phần (chunk) trong bộ nhớ`);
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
            computePoolConcurrency(store.proxy),
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
            store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
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
            store.addLog('error', `✗ Thử lại lỗi: ${field.label} — phần ${err.failedChunkIndex + 1}/${err.totalChunks} (đã lưu ${err.completedChunks.length})`);
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
    store.addLog('info', `Thử lại xong: ${successCount} đã sửa, ${failCount} vẫn lỗi`);
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

              if (changedCount === 0) {
                store.addLog('info', 'Mod instructions did not change any variable names');
              } else if (writeMvuDictAuto(newDict, 'Mod đổi tên biến')) {
                store.addLog('success', `✅ Mod: ${changedCount} variable(s) will be renamed during sync`);
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
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
        computePoolConcurrency(store.proxy), // parallelChunks — field to (mod) cũng chunk song song qua pool
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
            store.addLog('warning', `🩹 Bản vá không khớp — dịch lại TOÀN BỘ mục ${field.label}`);
            const fullPromptResult = buildEffectivePrompt({
              translationPrompt: store.translationConfig.translationPrompt,
              enableJailbreak: store.translationConfig.enableJailbreak,
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
    lastRunModeRef.current = 'mod';
    store.setPhase('translating');
    if (!isContinue) {
      store.setStartTime(Date.now());
      store.clearLogs();
    } else if (!useStore.getState().startTime) {
      store.setStartTime(Date.now());
    }
    store.setPreprocessProgress(null);
    CallMonitor.reset();
    setExtraProviders(store.providers);
    resetProviderPool();
    setNameStyle(store.translationConfig.nameStyle); // (User 2026) Kiểu tên riêng → mọi prompt dùng chung
    // (User 19/07) 🎌 Đồng nhân → khối luật tên canon (cấm Hán-Việt hoá) áp cho mọi prompt.
    setFandomMode(store.translationConfig.fandomMode, store.translationConfig.fandomName);

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
            if (writeMvuDictAuto(newDict, 'Mod đổi tên biến (Mod sync)')) {
              store.addLog('success', `✅ Mod: ${changedCount} variable(s) will be renamed during Mod sync`);
            }
          } else {
            store.addLog('info', 'Mod instructions did not change any variable names');
          }
        } else {
          store.addLog('info', 'Thẻ này không có biến MVU/Zod');
        }
      } catch (mvuErr) {
        const mvuMsg = mvuErr instanceof Error ? mvuErr.message : String(mvuErr);
        if (mvuMsg === 'Cancelled' || checkAbort()) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
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
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
              store.addLog('warning', `🩹 Bản vá không khớp — dịch lại TOÀN BỘ mục ${field.label}`);
              const fullPromptResult = buildEffectivePrompt({
                translationPrompt: store.translationConfig.translationPrompt,
                enableJailbreak: store.translationConfig.enableJailbreak,
        enableGomorrahNsfwRules: store.translationConfig.enableGomorrahNsfwRules,
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
    // Mặc định TỪNG ENTRY (batchSize=1): mỗi field 1 request — an toàn nhất (AI không trộn thứ tự /
    // gán nhầm giữa các mục). Tốc độ đến từ đa luồng RPM (#1).
    // (User yêu cầu khôi phục) Nếu bật "gộp nhiều entry / 1 lần gọi" thì batchSize = số user nhập
    // (2..50); splitLorebookBatches vẫn tự chia nhỏ nếu 1 lô vượt trần ký tự/token.
    const batchSize = (isBatchLorebook && store.translationConfig.lorebookManualBatch)
      ? Math.max(2, Math.min(50, Math.floor(store.translationConfig.lorebookBatchSize) || 5))
      : 1;
    const lorebookGroups: FieldGroup[] = ['lorebook', 'lorebook_keys'];

    let i = 0;
    while (i < targetFields.length) {
      // Check abort
      if (checkAbort()) {
        runningRef.current = false;
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
        store.addLog('warning', '🔧 Mod cancelled by user');
        return;
      }

      // Handle pause
      if (await waitForPause()) {
        runningRef.current = false;
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
        return;
      }

      const field = targetFields[i];

      // ─── Batch mode for lorebook fields (same as startTranslation) ───
      if (isBatchLorebook && lorebookGroups.includes(field.group)) {
        const concurrency = computePoolConcurrency(store.proxy);   // tổng ngân sách RPM toàn pool (mọi key×provider)
        const MAX_BATCH_CHARS = Math.max(store.proxy.maxTokens || 65536, 10000);
        const isMvuEnabled = store.translationConfig.enableMvuSync;

        // Step 1: Collect ALL consecutive lorebook fields
        const allLorebookFields: TranslationField[] = [];
        while (i < targetFields.length && lorebookGroups.includes(targetFields[i].group)) {
          allLorebookFields.push(targetFields[i]);
          i++;
        }

        // Step 2: Split into sub-batches — dùng chung utils/batchSplit (audit đợt 3).
        // Mod đếm theo bản ĐÃ mod (translated||original); không isolate/soft/smart (giữ hành vi cũ).
        const { batches: subBatches, summary: modSummary } = splitLorebookBatches(allLorebookFields, {
          batchSize,
          maxBatchChars: MAX_BATCH_CHARS,
          mvuEnabled: isMvuEnabled,
          getLength: (f) => (f.translated || f.original).length,
        });
        if (isMvuEnabled) {
          store.addLog('info', `🔧 Mod MVU batch grouping: ${allLorebookFields.length} fields → [${modSummary}] → ${subBatches.length} batch(es)`);
        } else {
          store.addLog('info', `🔧 Mod: ${allLorebookFields.length} lorebook fields → ${subBatches.length} batch(es), concurrency: ${concurrency}`);
        }

        store.setCurrentFieldIndex(i - 1);

        // Step 3: Dispatch sub-batches — POOL WORKER LIÊN TỤC (không rào chắn đợt).
        // Worker xong 1 batch là kéo batch kế ngay, không đợi straggler. RPM vẫn qua pickLane.
        let savedMod = 0; const saveEveryMod = Math.max(4, Math.floor(concurrency / 2));
        const modPool = await runWorkerPool({
          total: subBatches.length,
          concurrency,
          runOne: (idx) => modOneBatch(subBatches[idx]),
          shouldStop: () => !!checkAbort(),
          waitIfPaused: waitForPause,
          onSettled: () => { if (++savedMod % saveEveryMod === 0) store.saveTranslationCache(); },
          betweenMs: store.proxy.requestDelay,
        });
        store.saveTranslationCache();
        if (modPool.cancelled) {
          runningRef.current = false;
          store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
          store.addLog('warning', '🔧 Mod cancelled');
          return;
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
        store.setPhase(pauseRef.current ? 'paused' : 'cancelled');
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

    // Report hậu-mod cũng phải đọc field FRESH (store là snapshot cũ).
    const freshFields = useStore.getState().fields;

    // ═══ Post-Mod MVU-ZOD Sync Verification Report ═══
    if (store.translationConfig.enableMvuSync && Object.keys(store.translationConfig.mvuDictionary).length > 0) {
      const syncReport = generateSyncReport(
        freshFields.filter(f => f.status === 'done').map(f => ({
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
      const doneFields = freshFields.filter(f => f.status === 'done');
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
    store.addLog('info', `🔧 Mod xong: ${successCount} thành công, ${failCount} lỗi${autoFixCount > 0 ? `, tự sửa ${autoFixCount}` : ''}`);
    store.addToast(
      failCount === 0 ? 'success' : 'error',
      `Mod applied: ${successCount}/${targetFields.length} fields${autoFixCount > 0 ? ` (${autoFixCount} auto-fixed)` : ''}`
    );
  }, [store, prepareFields]);
  // Late-bind so resumeTranslation (defined earlier) can continue a paused mod run.
  applyModRef.current = applyModToAllFields;

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
      store.addLog('error', `[Tạo Lorebook] Lỗi: ${msg}`);
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
