import { create } from 'zustand';
import type { Locale } from './i18n/translations';
import type {
  CharacterCard,
  ProxySettings,
  ConnectionStatus,
  TranslationConfig,
  TranslationField,
  LogEntry,
  LogFilter,
  FieldGroup,
  FieldGroupConfig,
  ExportKeyMode,
  GlossaryEntry,
  ModPreset,
  SavedPreset,
} from './types/card';
import type { Worldbook } from './utils/worldbookParser';
import { DEFAULT_FIELD_GROUPS, extractTranslatableFields } from './utils/cardFields';
import { IDB } from './utils/idb';
import { clearRAGCache } from './utils/ragContext';
import { clearTranslationMemory } from './utils/translationMemory';
import type { MvuKeyMetadata } from './utils/mvuSync';
import { extractAIParams } from './utils/presetParser';

/* ─── localStorage helpers ─── */
const LS = {
  get: <T>(key: string, fallback: T): T => {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

/* ─── Translation State ─── */
type TranslationPhase = 'idle' | 'translating' | 'paused' | 'done' | 'cancelled';
export type ContentType = 'card' | 'worldbook';

interface AppState {
  // Card
  card: CharacterCard | null;
  cardFileName: string;
  originalImage: string | null;
  contentType: ContentType;
  originalWorldbook: Worldbook | null;
  /** Raw PNG ArrayBuffer kept for export — avoids re-reading file */
  _pngArrayBuffer: ArrayBuffer | null;
  /** Blob URL for preview — must be revoked on clearCard */
  _blobUrl: string | null;
  setCard: (card: CharacterCard, fileName: string, originalImage?: string | null, contentType?: ContentType, originalWorldbook?: Worldbook | null) => void;
  updateCard: (card: CharacterCard) => void;
  clearCard: () => void;
  loadStateFromIDB: () => Promise<void>;

  // Proxy config
  proxy: ProxySettings;
  setProxy: (partial: Partial<ProxySettings>) => void;
  resetProxy: () => void;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (s: ConnectionStatus) => void;
  scannedModels: string[];
  setScannedModels: (models: string[]) => void;

  // Translation config
  translationConfig: TranslationConfig;
  setTranslationConfig: (partial: Partial<TranslationConfig>) => void;
  toggleFieldGroup: (id: FieldGroup) => void;
  resetTranslationConfig: () => void;

  // Translation state
  fields: TranslationField[];
  setFields: (fields: TranslationField[]) => void;
  updateField: (path: string, update: Partial<TranslationField>) => void;
  phase: TranslationPhase;
  setPhase: (p: TranslationPhase) => void;
  currentFieldIndex: number;
  setCurrentFieldIndex: (i: number) => void;
  startTime: number | null;
  setStartTime: (t: number | null) => void;

  // Logs
  logs: LogEntry[];
  logFilter: LogFilter;
  setLogFilter: (f: LogFilter) => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  clearLogs: () => void;

  // Toasts
  toasts: { id: string; level: 'error' | 'success' | 'info'; message: string }[];
  addToast: (level: 'error' | 'success' | 'info', message: string) => void;
  removeToast: (id: string) => void;

  // UI
  locale: Locale;
  setLocale: (l: Locale) => void;
  activeTab: string;
  setActiveTab: (t: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Live Schema Context — translated TavernHelper schema injected for subsequent fields
  liveSchemaContext: string;
  setLiveSchemaContext: (s: string) => void;
  clearLiveSchemaContext: () => void;

  // MVU-Zod Conversion Progress
  mvuConversionProgress: string;
  setMvuConversionProgress: (p: string) => void;

  // MVU Key Metadata & Dictionary History
  mvuKeyMetadata: Record<string, MvuKeyMetadata>;
  setMvuKeyMetadata: (m: Record<string, MvuKeyMetadata>) => void;
  mvuDictionaryHistory: Record<string, string>[];
  pushDictionaryHistory: (dict: Record<string, string>) => void;

  // Preset Management
  activePreset: SavedPreset | null;
  setActivePreset: (preset: SavedPreset | null) => void;
  applyPresetAIParams: () => void;

  // Per-file translation cache
  saveTranslationCache: () => void;
  loadTranslationCache: (fileName: string) => Promise<boolean>;
  deleteCurrentCardCache: () => Promise<void>;
  deleteAllCaches: () => Promise<void>;
}

export const useStore = create<AppState>((set) => ({
  card: null,
  cardFileName: '',
  originalImage: null,
  contentType: 'card',
  originalWorldbook: null,
  _pngArrayBuffer: null,
  _blobUrl: null,
  setCard: (card, fileName, originalImage = null, contentType = 'card', originalWorldbook = null) => {
    // Revoke previous Blob URL if any
    const prev = useStore.getState()._blobUrl;
    if (prev) URL.revokeObjectURL(prev);

    set((s) => ({
      card,
      cardFileName: fileName,
      originalImage,
      _blobUrl: originalImage?.startsWith('blob:') ? originalImage : null,
      contentType,
      originalWorldbook,
      // ═══ Reset ALL translation state for the new card ═══
      fields: [],
      phase: 'idle' as TranslationPhase,
      logs: [],
      currentFieldIndex: 0,
      startTime: null,
      liveSchemaContext: '',
      mvuConversionProgress: '',
      translationConfig: {
        ...s.translationConfig,
        mvuDictionary: {}, // Clear dictionary for new card
        ejsEntryNameDict: {}, // Clear EJS dictionaries for new card
        ejsKeywordDict: {},
      },
      mvuKeyMetadata: {},
      mvuDictionaryHistory: [],
    }));
    // Clear Translation Memory on card load
    clearTranslationMemory().catch(e => console.warn('[TM] Clear error:', e));
    LS.set('st-translator-mvu-dict', {});
    LS.set('st-translator-ejs-entry-dict', {});
    LS.set('st-translator-ejs-keyword-dict', {});
    // Clear stale fields cache in IDB so it won't reload old card's fields
    IDB.remove('st-translator-fields-data');
    // Separate image from card data in IDB — avoids serializing huge base64/blob
    IDB.set('st-translator-card-data', { card, cardFileName: fileName, contentType, originalWorldbook });
    
    // Also save the raw ArrayBuffer if we have it
    const currentBuffer = useStore.getState()._pngArrayBuffer;
    if (currentBuffer) {
      IDB.set('st-translator-image-buffer', currentBuffer);
    } else {
      IDB.remove('st-translator-image-buffer');
    }

    if (originalImage && !originalImage.startsWith('blob:')) {
      // Only persist data URLs (Blob URLs are not persistable)
      IDB.set('st-translator-image-data', originalImage);
    } else if (!currentBuffer) {
      // If we don't have a buffer and it's a blob url, the image won't persist!
      // But we always set currentBuffer if it's a blob URL from the parser.
      IDB.remove('st-translator-image-data');
    }
  },
  updateCard: (card) => {
    set({ card });
    // Persist updated card data to IDB (keep existing fileName, contentType, worldbook)
    const s = useStore.getState();
    IDB.set('st-translator-card-data', {
      card,
      cardFileName: s.cardFileName,
      contentType: s.contentType,
      originalWorldbook: s.originalWorldbook,
    });
  },
  clearCard: () => {
    // Revoke Blob URL to free memory
    const prev = useStore.getState()._blobUrl;
    if (prev) URL.revokeObjectURL(prev);

    set((s) => ({
      card: null,
      cardFileName: '',
      originalImage: null,
      _pngArrayBuffer: null,
      _blobUrl: null,
      contentType: 'card' as ContentType,
      originalWorldbook: null,
      fields: [],
      phase: 'idle',
      logs: [],
      mvuConversionProgress: '',
      translationConfig: {
        ...s.translationConfig,
        mvuDictionary: {},
        ejsEntryNameDict: {},
        ejsKeywordDict: {},
      },
      mvuKeyMetadata: {},
      mvuDictionaryHistory: [],
    }));
    LS.set('st-translator-mvu-dict', {});
    LS.set('st-translator-ejs-entry-dict', {});
    LS.set('st-translator-ejs-keyword-dict', {});
    IDB.remove('st-translator-card-data');
    IDB.remove('st-translator-fields-data');
    IDB.remove('st-translator-image-data');
    IDB.remove('st-translator-image-buffer');
  },
  loadStateFromIDB: async () => {
    const cardData = await IDB.get<{card: CharacterCard, cardFileName: string, contentType?: ContentType, originalWorldbook?: Worldbook | null} | null>('st-translator-card-data', null);
    if (cardData) {
      // Load image separately
      const savedImage = await IDB.get<string | null>('st-translator-image-data', null);
      const savedBuffer = await IDB.get<ArrayBuffer | null>('st-translator-image-buffer', null);
      
      let loadedImage = savedImage;
      let blobUrl = null;
      if (savedBuffer) {
        const blob = new Blob([savedBuffer], { type: 'image/png' });
        blobUrl = URL.createObjectURL(blob);
        loadedImage = blobUrl;
      }

      set({
        card: cardData.card,
        cardFileName: cardData.cardFileName,
        originalImage: loadedImage,
        _pngArrayBuffer: savedBuffer || null,
        _blobUrl: blobUrl,
        contentType: cardData.contentType || 'card',
        originalWorldbook: cardData.originalWorldbook || null,
      });
    }
    const fieldsData = await IDB.get<{fields: TranslationField[], phase: TranslationPhase} | null>('st-translator-fields-data', null);
    if (fieldsData) {
      set({ fields: fieldsData.fields, phase: fieldsData.phase });
    }
  },

  // ─── Proxy ───
  proxy: {
    provider: LS.get('st-translator-provider', 'openai'),
    proxyUrl: LS.get('st-translator-proxy-url', 'https://api.openai.com/v1'),
    apiKey: LS.get('st-translator-api-key', ''),
    apiKeys: LS.get('st-translator-api-keys', []),
    model: LS.get('st-translator-model', 'gpt-4o-mini'),
    maxTokens: LS.get('st-translator-advanced-settings', { maxTokens: 65536 }).maxTokens ?? 65536,
    temperature: LS.get('st-translator-advanced-settings', { temperature: 0.3 }).temperature ?? 0.3,
    topP: LS.get('st-translator-advanced-settings', { topP: 1 }).topP ?? 1,
    topK: LS.get('st-translator-advanced-settings', { topK: 0 }).topK ?? 0,
    minP: LS.get('st-translator-advanced-settings', { minP: 0 }).minP ?? 0,
    frequencyPenalty: LS.get('st-translator-advanced-settings', { frequencyPenalty: 0 }).frequencyPenalty ?? 0,
    presencePenalty: LS.get('st-translator-advanced-settings', { presencePenalty: 0 }).presencePenalty ?? 0,
    repetitionPenalty: LS.get('st-translator-advanced-settings', { repetitionPenalty: 1 }).repetitionPenalty ?? 1,
    requestDelay: LS.get('st-translator-advanced-settings', { requestDelay: 500 }).requestDelay ?? 500,
    retryDelay: LS.get('st-translator-advanced-settings', { retryDelay: 1000 }).retryDelay ?? 1000,
    requestTimeout: LS.get('st-translator-advanced-settings', { requestTimeout: 600000 }).requestTimeout ?? 600000,
    maxRetries: LS.get('st-translator-advanced-settings', { maxRetries: 3 }).maxRetries ?? 3,
    minResponseRatio: LS.get('st-translator-advanced-settings', { minResponseRatio: 0.15 }).minResponseRatio ?? 0.15,
    systemPromptPrefix: LS.get('st-translator-advanced-settings', { systemPromptPrefix: '' }).systemPromptPrefix ?? '',
    useCorsProxy: LS.get('st-translator-use-cors-proxy', true),
    useStream: LS.get('st-translator-use-stream', true),
    expertMode: LS.get('st-translator-advanced-settings', { expertMode: false }).expertMode ?? false,
    primaryModelRpm: LS.get('st-translator-advanced-settings', { primaryModelRpm: 5 }).primaryModelRpm ?? 5,
    secondaryModel: LS.get('st-translator-advanced-settings', { secondaryModel: '' }).secondaryModel ?? '',
    secondaryModelRpm: LS.get('st-translator-advanced-settings', { secondaryModelRpm: 17 }).secondaryModelRpm ?? 17,
    enableSecondaryModel: LS.get('st-translator-advanced-settings', { enableSecondaryModel: false }).enableSecondaryModel ?? false,
    secondaryModelThreshold: LS.get('st-translator-advanced-settings', { secondaryModelThreshold: 0 }).secondaryModelThreshold ?? 0,
  },
  setProxy: (partial) => {
    set((s) => {
      const next = { ...s.proxy, ...partial };
      // Persist
      LS.set('st-translator-provider', next.provider);
      LS.set('st-translator-proxy-url', next.proxyUrl);
      LS.set('st-translator-api-key', next.apiKey);
      LS.set('st-translator-api-keys', next.apiKeys);
      LS.set('st-translator-model', next.model);
      LS.set('st-translator-use-cors-proxy', next.useCorsProxy);
      LS.set('st-translator-use-stream', next.useStream);
      LS.set('st-translator-advanced-settings', {
        maxTokens: next.maxTokens,
        temperature: next.temperature,
        topP: next.topP,
        topK: next.topK,
        minP: next.minP,
        frequencyPenalty: next.frequencyPenalty,
        presencePenalty: next.presencePenalty,
        repetitionPenalty: next.repetitionPenalty,
        requestDelay: next.requestDelay,
        retryDelay: next.retryDelay,
        requestTimeout: next.requestTimeout,
        maxRetries: next.maxRetries,
        minResponseRatio: next.minResponseRatio,
        systemPromptPrefix: next.systemPromptPrefix,
        expertMode: next.expertMode,
        primaryModelRpm: next.primaryModelRpm,
        secondaryModel: next.secondaryModel,
        secondaryModelRpm: next.secondaryModelRpm,
        enableSecondaryModel: next.enableSecondaryModel,
        secondaryModelThreshold: next.secondaryModelThreshold,
      });
      return { proxy: next };
    });
  },
  resetProxy: () => {
    const defaultProxy = {
      provider: 'openai' as const,
      proxyUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiKeys: [],
      model: 'gpt-4o-mini',
      maxTokens: 65536,
      temperature: 0.3,
      topP: 1,
      topK: 0,
      minP: 0,
      frequencyPenalty: 0,
      presencePenalty: 0,
      repetitionPenalty: 1,
      requestDelay: 500,
      retryDelay: 1000,
      requestTimeout: 600000,
      maxRetries: 3,
      minResponseRatio: 0.15,
      systemPromptPrefix: '',
      useCorsProxy: true,
      useStream: true,
      expertMode: false,
      primaryModelRpm: 5,
      secondaryModel: '',
      secondaryModelRpm: 17,
      enableSecondaryModel: false,
      secondaryModelThreshold: 0,
    };
    LS.set('st-translator-provider', defaultProxy.provider);
    LS.set('st-translator-proxy-url', defaultProxy.proxyUrl);
    LS.set('st-translator-api-key', defaultProxy.apiKey);
    LS.set('st-translator-api-keys', defaultProxy.apiKeys);
    LS.set('st-translator-model', defaultProxy.model);
    LS.set('st-translator-use-cors-proxy', defaultProxy.useCorsProxy);
    LS.set('st-translator-use-stream', defaultProxy.useStream);
    LS.set('st-translator-advanced-settings', {
      maxTokens: defaultProxy.maxTokens,
      temperature: defaultProxy.temperature,
      topP: defaultProxy.topP,
      topK: defaultProxy.topK,
      minP: defaultProxy.minP,
      frequencyPenalty: defaultProxy.frequencyPenalty,
      presencePenalty: defaultProxy.presencePenalty,
      repetitionPenalty: defaultProxy.repetitionPenalty,
      requestDelay: defaultProxy.requestDelay,
      retryDelay: defaultProxy.retryDelay,
      requestTimeout: defaultProxy.requestTimeout,
      maxRetries: defaultProxy.maxRetries,
      minResponseRatio: defaultProxy.minResponseRatio,
      systemPromptPrefix: defaultProxy.systemPromptPrefix,
      expertMode: defaultProxy.expertMode,
      primaryModelRpm: defaultProxy.primaryModelRpm,
      secondaryModel: defaultProxy.secondaryModel,
      secondaryModelRpm: defaultProxy.secondaryModelRpm,
      enableSecondaryModel: defaultProxy.enableSecondaryModel,
      secondaryModelThreshold: defaultProxy.secondaryModelThreshold,
    });
    set({ proxy: defaultProxy, connectionStatus: 'untested' });
  },
  connectionStatus: 'untested',
  setConnectionStatus: (s) => set({ connectionStatus: s }),
  scannedModels: LS.get('st-translator-scanned-models', []),
  setScannedModels: (models) => {
    LS.set('st-translator-scanned-models', models);
    set({ scannedModels: models });
  },

  // ─── Translation Config ───
  translationConfig: {
    sourceLanguage: LS.get('st-translator-source-lang', '中文'),
    targetLanguage: LS.get('st-translator-target-lang', 'Tiếng Việt'),
    translationPrompt: LS.get('st-translator-custom-prompt', ''),
    mode: LS.get('st-translator-translation-mode', 'field') as any,
    lorebookStrategy: LS.get('st-translator-lorebook-strategy', 'single') as any,
    lorebookBatchSize: LS.get('st-translator-lorebook-batch-size', 5),
    concurrentBatches: LS.get('st-translator-concurrent-batches', 1),
    skipAlreadyTranslated: LS.get('st-translator-skip-already-translated', true),
    fieldGroups: (() => {
      const saved = LS.get<Record<string, boolean>>('st-translator-field-groups-enabled', {});
      return DEFAULT_FIELD_GROUPS.map(g => ({
        ...g,
        enabled: saved[g.id] !== undefined ? saved[g.id] : g.enabled
      }));
    })(),
    customSchema: LS.get('st-translator-custom-schema', ''),
    exportKeyMode: LS.get('st-translator-export-key-mode', 'merge') as ExportKeyMode,
    glossary: LS.get('st-translator-glossary', []) as GlossaryEntry[],
    enableMvuSync: LS.get('st-translator-mvu-sync-enabled', true),
    mvuDictionary: LS.get('st-translator-mvu-dict', {}) as Record<string, string>,
    enableRAGContext: LS.get('st-translator-rag-enabled', true),
    ragMaxFields: LS.get('st-translator-rag-max-fields', 5),
    ragMaxChars: LS.get('st-translator-rag-max-chars', 3000),
    chunkSize: LS.get('st-translator-chunk-size', 0),
    parallelChunks: LS.get('st-translator-parallel-chunks', 1),
    enableJailbreak: LS.get('st-translator-jailbreak', true),
    enableObjectiveMode: LS.get('st-translator-objective-mode', true),
    surgicalMode: LS.get('st-translator-surgical-mode', false),
    surgicalPrompt: LS.get('st-translator-surgical-prompt', ''),
    enableModMode: LS.get('st-translator-mod-mode', false),
    modInstructions: LS.get('st-translator-mod-instructions', ''),
    enablePatchMode: LS.get('st-translator-patch-mode', false),
    enableMvuConversion: LS.get('st-translator-mvu-conversion', false),
    enableModelRouting: LS.get('st-translator-model-routing-enabled', false),
    groupModelRouting: LS.get('st-translator-group-model-routing', {}),
    entryModelRouting: LS.get('st-translator-entry-model-routing', {}),
    modPreset: LS.get('st-translator-mod-preset', 'none') as ModPreset,
    enableModThinking: LS.get('st-translator-mod-thinking', false),
    enableEjsThinking: LS.get('st-translator-ejs-thinking', false),
    enableEjsSync: false,
    ejsEntryNameDict: LS.get('st-translator-ejs-entry-dict', {}) as Record<string, string>,
    ejsKeywordDict: LS.get('st-translator-ejs-keyword-dict', {}) as Record<string, string>,
    ejsDecoratorPreserve: LS.get('st-translator-ejs-decorator-preserve', true),
    enableChunkVerification: LS.get('st-translator-chunk-verification', false),
    enableTranslationMemory: LS.get('st-translator-tm-enabled', true),
    mvuScanPasses: LS.get('st-translator-mvu-scan-passes', 1),
    ejsScanPasses: LS.get('st-translator-ejs-scan-passes', 1),
    mvuTranslationPrompt: LS.get('st-translator-mvu-translation-prompt', ''),
    ejsTranslationPrompt: LS.get('st-translator-ejs-translation-prompt', ''),
    cssCjkHandling: LS.get('st-translator-css-cjk-handling', 'preserve') as 'preserve' | 'translate',
  },
  setTranslationConfig: (partial) =>
    set((s) => {
      const next = { ...s.translationConfig, ...partial };
      if ('glossary' in partial) {
        LS.set('st-translator-glossary', next.glossary);
      }
      if ('mvuDictionary' in partial) {
        LS.set('st-translator-mvu-dict', next.mvuDictionary);
      }
      if ('enableRAGContext' in partial) {
        LS.set('st-translator-rag-enabled', next.enableRAGContext);
      }
      if ('ragMaxFields' in partial) {
        LS.set('st-translator-rag-max-fields', next.ragMaxFields);
      }
      if ('ragMaxChars' in partial) {
        LS.set('st-translator-rag-max-chars', next.ragMaxChars);
      }
      if ('chunkSize' in partial) {
        LS.set('st-translator-chunk-size', next.chunkSize);
      }
      if ('parallelChunks' in partial) {
        LS.set('st-translator-parallel-chunks', next.parallelChunks);
      }
      if ('enableJailbreak' in partial) {
        LS.set('st-translator-jailbreak', next.enableJailbreak);
      }
      if ('enableObjectiveMode' in partial) {
        LS.set('st-translator-objective-mode', next.enableObjectiveMode);
      }
      if ('surgicalMode' in partial) {
        LS.set('st-translator-surgical-mode', next.surgicalMode);
      }
      if ('surgicalPrompt' in partial) {
        LS.set('st-translator-surgical-prompt', next.surgicalPrompt);
      }
      if ('enableModMode' in partial) {
        LS.set('st-translator-mod-mode', next.enableModMode);
      }
      if ('modInstructions' in partial) {
        LS.set('st-translator-mod-instructions', next.modInstructions);
      }
      if ('enablePatchMode' in partial) {
        LS.set('st-translator-patch-mode', next.enablePatchMode);
      }
      if ('enableMvuSync' in partial) {
        LS.set('st-translator-mvu-sync-enabled', next.enableMvuSync);
      }
      if ('enableMvuConversion' in partial) {
        LS.set('st-translator-mvu-conversion', next.enableMvuConversion);
      }
      if ('enableModelRouting' in partial) {
        LS.set('st-translator-model-routing-enabled', next.enableModelRouting);
      }
      if ('groupModelRouting' in partial) {
        LS.set('st-translator-group-model-routing', next.groupModelRouting);
      }
      if ('entryModelRouting' in partial) {
        LS.set('st-translator-entry-model-routing', next.entryModelRouting);
      }
      if ('translationPrompt' in partial) {
        LS.set('st-translator-custom-prompt', next.translationPrompt);
      }
      if ('customSchema' in partial) {
        LS.set('st-translator-custom-schema', next.customSchema);
      }
      if ('sourceLanguage' in partial) {
        LS.set('st-translator-source-lang', next.sourceLanguage);
      }
      if ('targetLanguage' in partial) {
        LS.set('st-translator-target-lang', next.targetLanguage);
      }
      if ('modPreset' in partial) {
        LS.set('st-translator-mod-preset', next.modPreset);
      }
      if ('enableModThinking' in partial) {
        LS.set('st-translator-mod-thinking', next.enableModThinking);
      }
      if ('enableEjsThinking' in partial) {
        LS.set('st-translator-ejs-thinking', next.enableEjsThinking);
      }
      if ('ejsEntryNameDict' in partial) {
        LS.set('st-translator-ejs-entry-dict', next.ejsEntryNameDict);
      }
      if ('ejsKeywordDict' in partial) {
        LS.set('st-translator-ejs-keyword-dict', next.ejsKeywordDict);
      }
      if ('ejsDecoratorPreserve' in partial) {
        LS.set('st-translator-ejs-decorator-preserve', next.ejsDecoratorPreserve);
      }
      if ('enableChunkVerification' in partial) {
        LS.set('st-translator-chunk-verification', next.enableChunkVerification);
      }
      if ('enableTranslationMemory' in partial) {
        LS.set('st-translator-tm-enabled', next.enableTranslationMemory);
      }
      if ('mode' in partial) {
        LS.set('st-translator-translation-mode', next.mode);
      }
      if ('lorebookStrategy' in partial) {
        LS.set('st-translator-lorebook-strategy', next.lorebookStrategy);
      }
      if ('lorebookBatchSize' in partial) {
        LS.set('st-translator-lorebook-batch-size', next.lorebookBatchSize);
      }
      if ('concurrentBatches' in partial) {
        LS.set('st-translator-concurrent-batches', next.concurrentBatches);
      }
      if ('skipAlreadyTranslated' in partial) {
        LS.set('st-translator-skip-already-translated', next.skipAlreadyTranslated);
      }
      if ('mvuScanPasses' in partial) {
        LS.set('st-translator-mvu-scan-passes', next.mvuScanPasses);
      }
      if ('ejsScanPasses' in partial) {
        LS.set('st-translator-ejs-scan-passes', next.ejsScanPasses);
      }
      if ('mvuTranslationPrompt' in partial) {
        LS.set('st-translator-mvu-translation-prompt', next.mvuTranslationPrompt);
      }
      if ('ejsTranslationPrompt' in partial) {
        LS.set('st-translator-ejs-translation-prompt', next.ejsTranslationPrompt);
      }
      if ('cssCjkHandling' in partial) {
        LS.set('st-translator-css-cjk-handling', next.cssCjkHandling);
      }
      if ('exportKeyMode' in partial) {
        LS.set('st-translator-export-key-mode', next.exportKeyMode);
      }
      return { translationConfig: next };
    }),
  toggleFieldGroup: (id) =>
    set((s) => {
      const updatedGroups = s.translationConfig.fieldGroups.map((g: FieldGroupConfig) =>
        g.id === id ? { ...g, enabled: !g.enabled } : g
      );
      const enabledMap = updatedGroups.reduce((acc, g) => {
        acc[g.id] = g.enabled;
        return acc;
      }, {} as Record<string, boolean>);
      LS.set('st-translator-field-groups-enabled', enabledMap);

      let updatedFields = s.fields;
      if (s.card) {
        const enabledGroupIds = updatedGroups.filter(g => g.enabled).map(g => g.id);
        const newFields = extractTranslatableFields(s.card, enabledGroupIds);
        
        // Merge: preserve done, skipped, and ignored fields from previous fields
        const existingMap = new Map(s.fields.map(f => [f.path, f]));
        updatedFields = newFields.map(nf => {
          const existing = existingMap.get(nf.path);
          if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
            return existing;
          }
          return nf;
        });

        // Also keep done/skipped/ignored fields from groups not currently enabled
        for (const ef of s.fields) {
          if ((ef.status === 'done' || ef.status === 'skipped' || ef.status === 'ignored') && !updatedFields.find(m => m.path === ef.path)) {
            updatedFields.push(ef);
          }
        }

        IDB.set('st-translator-fields-data', { fields: updatedFields, phase: s.phase });
      }

      return {
        translationConfig: {
          ...s.translationConfig,
          fieldGroups: updatedGroups,
        },
        fields: updatedFields,
      };
    }),
  resetTranslationConfig: () => {
    const defaultFields = DEFAULT_FIELD_GROUPS.map(g => ({ ...g, enabled: true }));
    const defaultTranslationConfig = {
      sourceLanguage: '中文',
      targetLanguage: 'Tiếng Việt',
      translationPrompt: '',
      mode: 'field' as const,
      lorebookStrategy: 'single' as const,
      lorebookBatchSize: 5,
      concurrentBatches: 1,
      skipAlreadyTranslated: true,
      fieldGroups: defaultFields,
      customSchema: '',
      exportKeyMode: 'merge' as const,
      glossary: [],
      enableMvuSync: false,
      mvuDictionary: {},
      enableRAGContext: true,
      ragMaxFields: 5,
      ragMaxChars: 3000,
      chunkSize: 0,
      parallelChunks: 1,
      enableJailbreak: true,
      enableObjectiveMode: true,
      surgicalMode: false,
      surgicalPrompt: '',
      enableModMode: false,
      modInstructions: '',
      enablePatchMode: false,
      enableMvuConversion: false,
      enableModelRouting: false,
      groupModelRouting: {},
      entryModelRouting: {},
      modPreset: 'none' as const,
      enableModThinking: false,
      enableEjsThinking: false,
      enableEjsSync: false,
      ejsEntryNameDict: {},
      ejsKeywordDict: {},
      ejsDecoratorPreserve: true,
      enableChunkVerification: false,
      enableTranslationMemory: true,
      mvuScanPasses: 1,
      ejsScanPasses: 1,
      mvuTranslationPrompt: '',
      ejsTranslationPrompt: '',
      cssCjkHandling: 'preserve' as const,
    };

    LS.set('st-translator-source-lang', defaultTranslationConfig.sourceLanguage);
    LS.set('st-translator-target-lang', defaultTranslationConfig.targetLanguage);
    LS.set('st-translator-custom-prompt', defaultTranslationConfig.translationPrompt);
    LS.set('st-translator-translation-mode', defaultTranslationConfig.mode);
    LS.set('st-translator-lorebook-strategy', defaultTranslationConfig.lorebookStrategy);
    LS.set('st-translator-lorebook-batch-size', defaultTranslationConfig.lorebookBatchSize);
    LS.set('st-translator-concurrent-batches', defaultTranslationConfig.concurrentBatches);
    LS.set('st-translator-skip-already-translated', defaultTranslationConfig.skipAlreadyTranslated);
    
    const enabledMap = defaultFields.reduce((acc, g) => {
      acc[g.id] = g.enabled;
      return acc;
    }, {} as Record<string, boolean>);
    LS.set('st-translator-field-groups-enabled', enabledMap);
    
    LS.set('st-translator-custom-schema', defaultTranslationConfig.customSchema);
    LS.set('st-translator-export-key-mode', defaultTranslationConfig.exportKeyMode);
    LS.set('st-translator-glossary', defaultTranslationConfig.glossary);
    LS.set('st-translator-mvu-sync-enabled', defaultTranslationConfig.enableMvuSync);
    LS.set('st-translator-mvu-dict', defaultTranslationConfig.mvuDictionary);
    LS.set('st-translator-rag-enabled', defaultTranslationConfig.enableRAGContext);
    LS.set('st-translator-rag-max-fields', defaultTranslationConfig.ragMaxFields);
    LS.set('st-translator-rag-max-chars', defaultTranslationConfig.ragMaxChars);
    LS.set('st-translator-chunk-size', defaultTranslationConfig.chunkSize);
    LS.set('st-translator-parallel-chunks', defaultTranslationConfig.parallelChunks);
    LS.set('st-translator-jailbreak', defaultTranslationConfig.enableJailbreak);
    LS.set('st-translator-objective-mode', defaultTranslationConfig.enableObjectiveMode);
    LS.set('st-translator-surgical-mode', defaultTranslationConfig.surgicalMode);
    LS.set('st-translator-mod-mode', defaultTranslationConfig.enableModMode);
    LS.set('st-translator-mod-instructions', defaultTranslationConfig.modInstructions);
    LS.set('st-translator-patch-mode', defaultTranslationConfig.enablePatchMode);
    LS.set('st-translator-mvu-conversion', defaultTranslationConfig.enableMvuConversion);
    LS.set('st-translator-model-routing-enabled', defaultTranslationConfig.enableModelRouting);
    LS.set('st-translator-group-model-routing', defaultTranslationConfig.groupModelRouting);
    LS.set('st-translator-entry-model-routing', defaultTranslationConfig.entryModelRouting);
    LS.set('st-translator-mod-preset', defaultTranslationConfig.modPreset);
    LS.set('st-translator-mod-thinking', defaultTranslationConfig.enableModThinking);
    LS.set('st-translator-ejs-thinking', defaultTranslationConfig.enableEjsThinking);
    LS.set('st-translator-ejs-entry-dict', defaultTranslationConfig.ejsEntryNameDict);
    LS.set('st-translator-ejs-keyword-dict', defaultTranslationConfig.ejsKeywordDict);
    LS.set('st-translator-ejs-decorator-preserve', defaultTranslationConfig.ejsDecoratorPreserve);
    LS.set('st-translator-chunk-verification', defaultTranslationConfig.enableChunkVerification);
    LS.set('st-translator-tm-enabled', defaultTranslationConfig.enableTranslationMemory);
    LS.set('st-translator-mvu-scan-passes', defaultTranslationConfig.mvuScanPasses);
    LS.set('st-translator-ejs-scan-passes', defaultTranslationConfig.ejsScanPasses);
    LS.set('st-translator-mvu-translation-prompt', defaultTranslationConfig.mvuTranslationPrompt);
    LS.set('st-translator-ejs-translation-prompt', defaultTranslationConfig.ejsTranslationPrompt);
    LS.set('st-translator-css-cjk-handling', defaultTranslationConfig.cssCjkHandling);

    set((s) => {
      let updatedFields = s.fields;
      if (s.card) {
        const enabledGroupIds = defaultFields.filter(g => g.enabled).map(g => g.id);
        const newFields = extractTranslatableFields(s.card, enabledGroupIds);
        
        const existingMap = new Map(s.fields.map(f => [f.path, f]));
        updatedFields = newFields.map(nf => {
          const existing = existingMap.get(nf.path);
          if (existing && (existing.status === 'done' || existing.status === 'skipped' || existing.status === 'ignored')) {
            return existing;
          }
          return nf;
        });

        for (const ef of s.fields) {
          if ((ef.status === 'done' || ef.status === 'skipped' || ef.status === 'ignored') && !updatedFields.find(m => m.path === ef.path)) {
            updatedFields.push(ef);
          }
        }
        IDB.set('st-translator-fields-data', { fields: updatedFields, phase: s.phase });
      }

      return {
        translationConfig: defaultTranslationConfig,
        fields: updatedFields,
      };
    });
  },

  // ─── Translation State ───
  fields: [],
  setFields: (fields) => {
    set({ fields });
    set((s) => {
      // Debounce IDB write — fields can be set rapidly during extraction
      IDB.setDebounced('st-translator-fields-data', { fields: s.fields, phase: s.phase }, 2000);
      return s;
    });
  },
  updateField: (path, update) =>
    set((s) => {
      const nextFields = s.fields.map((f) => (f.path === path ? { ...f, ...update } : f));
      // Debounce: during translation loop, updateField fires per-field (every ~1-3s).
      // Coalesce into single IDB write every 3s instead of each call.
      IDB.setDebounced('st-translator-fields-data', { fields: nextFields, phase: s.phase }, 3000);
      return { fields: nextFields };
    }),
  phase: 'idle',
  setPhase: (p) => set((s) => {
    IDB.set('st-translator-fields-data', { fields: s.fields, phase: p });
    return { phase: p };
  }),
  currentFieldIndex: 0,
  setCurrentFieldIndex: (i) => set({ currentFieldIndex: i }),
  startTime: null,
  setStartTime: (t) => set({ startTime: t }),

  // ─── Logs ───
  logs: [],
  logFilter: 'all',
  setLogFilter: (f) => set({ logFilter: f }),
  addLog: (level, message) =>
    set((s) => ({
      logs: [...s.logs, { id: crypto.randomUUID(), timestamp: Date.now(), level, message }],
    })),
  clearLogs: () => set({ logs: [] }),

  // ─── Toasts ───
  toasts: [],
  addToast: (level, message) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, level, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // ─── UI ───
  locale: (LS.get('st-translator-locale', 'en') as Locale) || 'en',
  setLocale: (l) => {
    LS.set('st-translator-locale', l);
    set({ locale: l });
  },
  activeTab: 'core',
  setActiveTab: (t) => set({ activeTab: t }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Live Schema Context
  liveSchemaContext: '',
  setLiveSchemaContext: (s) => set({ liveSchemaContext: s }),
  clearLiveSchemaContext: () => set({ liveSchemaContext: '' }),

  mvuConversionProgress: '',
  setMvuConversionProgress: (p) => set({ mvuConversionProgress: p }),

  // MVU Key Metadata & Dictionary History
  mvuKeyMetadata: {},
  setMvuKeyMetadata: (m) => set({ mvuKeyMetadata: m }),
  mvuDictionaryHistory: [],
  pushDictionaryHistory: (dict) => set((s) => ({
    // Keep max 10 history entries
    mvuDictionaryHistory: [...s.mvuDictionaryHistory.slice(-9), { ...dict }],
  })),

  // ─── Preset Management ───
  activePreset: LS.get<SavedPreset | null>('st-translator-active-preset', null),
  setActivePreset: (preset) => {
    LS.set('st-translator-active-preset', preset);
    set({ activePreset: preset });
  },
  applyPresetAIParams: () => {
    const s = useStore.getState();
    if (!s.activePreset) return;
    const params = extractAIParams(s.activePreset.preset);
    if (Object.keys(params).length > 0) {
      s.setProxy(params);
    }
  },

  // ─── Per-file Translation Cache ───
  saveTranslationCache: () => {
    const s = useStore.getState();
    if (!s.cardFileName || s.fields.length === 0) return;
    const cacheKey = `st-cache-${s.cardFileName}`;
    const cacheData = {
      fields: s.fields,
      phase: s.phase,
      targetLang: s.translationConfig.targetLanguage,
      savedAt: Date.now(),
    };
    IDB.set(cacheKey, cacheData);
  },
  loadTranslationCache: async (fileName: string): Promise<boolean> => {
    const cacheKey = `st-cache-${fileName}`;
    const cached = await IDB.get<{
      fields: TranslationField[];
      phase: TranslationPhase;
      targetLang: string;
      savedAt: number;
    } | null>(cacheKey, null);
    if (cached && cached.fields.length > 0) {
      set({ fields: cached.fields, phase: cached.phase });
      return true;
    }
    return false;
  },
  deleteCurrentCardCache: async () => {
    const s = useStore.getState();
    if (s.cardFileName) {
      // Remove cache key in IDB
      await IDB.remove(`st-cache-${s.cardFileName}`);
      
      // Reset translation state of all fields in the active store
      const resetFields = s.fields.length > 0
        ? s.fields.map(f => ({
            ...f,
            translated: '',
            status: 'pending' as const,
            error: undefined,
            completedChunks: undefined,
            rawChunks: undefined,
            totalChunks: undefined,
            failedChunkIndex: undefined,
          }))
        : [];

      set((state) => ({
        fields: resetFields,
        phase: 'idle',
        currentFieldIndex: 0,
        liveSchemaContext: '',
        mvuConversionProgress: '',
        mvuKeyMetadata: {},
        mvuDictionaryHistory: [],
        translationConfig: {
          ...state.translationConfig,
          mvuDictionary: {},
          ejsEntryNameDict: {},
          ejsKeywordDict: {},
        },
      }));

      // Reset dictionaries in localStorage
      LS.set('st-translator-mvu-dict', {});
      LS.set('st-translator-ejs-entry-dict', {});
      LS.set('st-translator-ejs-keyword-dict', {});

      // Clear memory RAG cache
      clearRAGCache();

      if (resetFields.length > 0) {
        IDB.set('st-translator-fields-data', { fields: resetFields, phase: 'idle' });
      } else {
        IDB.remove('st-translator-fields-data');
      }
    }
  },
  deleteAllCaches: async () => {
    // Remove all cache keys starting with 'st-cache-'
    await IDB.clearPrefix('st-cache-');
    
    const s = useStore.getState();
    const resetFields = s.fields.length > 0
      ? s.fields.map(f => ({
          ...f,
          translated: '',
          status: 'pending' as const,
          error: undefined,
          completedChunks: undefined,
          rawChunks: undefined,
          totalChunks: undefined,
          failedChunkIndex: undefined,
        }))
      : [];

    set((state) => ({
      fields: resetFields,
      phase: 'idle',
      currentFieldIndex: 0,
      liveSchemaContext: '',
      mvuConversionProgress: '',
      mvuKeyMetadata: {},
      mvuDictionaryHistory: [],
      translationConfig: {
        ...state.translationConfig,
        mvuDictionary: {},
        ejsEntryNameDict: {},
        ejsKeywordDict: {},
      },
    }));

    // Reset dictionaries in localStorage
    LS.set('st-translator-mvu-dict', {});
    LS.set('st-translator-ejs-entry-dict', {});
    LS.set('st-translator-ejs-keyword-dict', {});

    // Clear memory RAG cache
    clearRAGCache();

    if (resetFields.length > 0) {
      IDB.set('st-translator-fields-data', { fields: resetFields, phase: 'idle' });
    } else {
      IDB.remove('st-translator-fields-data');
    }
  },
}));
