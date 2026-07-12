import { create } from 'zustand';
import type { Locale } from './i18n/translations';
import { getUiLang, resolveLocale } from './i18n';
import type {
  CharacterCard,
  ProxySettings,
  ProviderConfig,
  ConnectionStatus,
  TranslationConfig,
  TranslationField,
  LogEntry,
  LogFilter,
  LogPhase,
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
import { FsCache } from './utils/fsCache';
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[store] localStorage.setItem failed (quota?)', key, e);
    }
  },
};

/* ─── Filesystem progress-cache write debounce ───
 * saveTranslationCache() is called very frequently (after each batch / every few fields).
 * Coalesce into at most one filesystem write per window so we don't hammer the disk. */
let _fsSaveTimer: ReturnType<typeof setTimeout> | null = null;
const FS_SAVE_DEBOUNCE_MS = 1500;

/** Build the persisted progress snapshot from the current store state. */
export function buildProgressSnapshot(cur: AppState) {
  return {
    savedAt: Date.now(),
    cardFileName: cur.cardFileName,
    contentType: cur.contentType,
    phase: cur.phase,
    currentFieldIndex: cur.currentFieldIndex,
    fields: cur.fields,
    mvuKeyMetadata: cur.mvuKeyMetadata,
    dicts: {
      mvuDictionary: cur.translationConfig.mvuDictionary,
      ejsEntryNameDict: cur.translationConfig.ejsEntryNameDict,
      ejsKeywordDict: cur.translationConfig.ejsKeywordDict,
    },
  };
}

/** Synchronous best-effort flush used on tab close / hide (beforeunload, visibilitychange). */
export function flushProgressBeacon() {
  try {
    const cur = useStore.getState();
    if (!cur.cardFileName || cur.fields.length === 0) return;
    if (cur.phase !== 'translating' && cur.phase !== 'paused') return;
    const payload = JSON.stringify({ key: cur.cardFileName, data: buildProgressSnapshot(cur) });
    navigator.sendBeacon?.('/api/progress/save', new Blob([payload], { type: 'application/json' }));
  } catch { /* best-effort */ }
}

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
  /** Rename the character (card.name + card.data.name) and/or the export file name.
   *  charName = tên nhân vật hiển thị trong SillyTavern; fileName = tên file khi xuất. */
  renameCard: (opts: { charName?: string; fileName?: string }) => void;
  clearCard: () => void;
  loadStateFromIDB: () => Promise<void>;

  // Proxy config
  proxy: ProxySettings;
  setProxy: (partial: Partial<ProxySettings>) => void;
  resetProxy: () => void;
  /** Các provider PHỤ (ngoài `proxy`). Engine gộp proxy + providers bật → pool rải call song song. */
  providers: ProviderConfig[];
  addProvider: () => void;
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void;
  removeProvider: (id: string) => void;
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

  // Pre-processing progress (Strategy B variable translation, conflict resolution,
  // EJS entry/keyword translation) — steps that run BEFORE the main field loop and
  // don't touch `fields`, so they need their own progress indicator.
  preprocessProgress: { label: string; current: number; total: number } | null;
  setPreprocessProgress: (p: { label: string; current: number; total: number } | null) => void;

  // Logs
  logs: LogEntry[];
  logFilter: LogFilter;
  setLogFilter: (f: LogFilter) => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  /** Giai đoạn hiện tại — addLog đóng dấu vào mỗi dòng để gom nhóm gấp/mở được. */
  logPhase: LogPhase;
  setLogPhase: (p: LogPhase) => void;
  clearLogs: () => void;

  // Toasts
  toasts: { id: string; level: 'error' | 'success' | 'info'; message: string }[];
  addToast: (level: 'error' | 'success' | 'info', message: string) => void;
  removeToast: (id: string) => void;

  // UI
  /** Chỉ đọc — suy ra từ uiLang lúc khởi động. Đổi ngôn ngữ = setUiLang() (reload trang). */
  locale: Locale;
  activeTab: string;
  setActiveTab: (t: string) => void;
  /** Preset dich dang chon ('light'|'full'|'turbo'|'') — highlight nut + popup goi y dung chung. */
  activePresetId: string;
  setActivePresetId: (id: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Live Schema Context — translated TavernHelper schema injected for subsequent fields
  liveSchemaContext: string;
  setLiveSchemaContext: (s: string) => void;
  clearLiveSchemaContext: () => void;

  // MVU-Zod Conversion Progress
  mvuConversionProgress: string;
  setMvuConversionProgress: (p: string) => void;

  // "Nhảy tới trường" — tín hiệu tạm (path field cần cuộn tới) do bảng Sức khoẻ thẻ phát ra;
  // FieldEditor (trường thường) / RegexManagerPanel (trường regex) tiêu thụ rồi tự xoá về null.
  jumpToFieldPath: string | null;
  setJumpToFieldPath: (p: string | null) => void;

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
    // IDB is not used — opening it causes Windows Defender to scan old LevelDB files (freeze).
  },
  updateCard: (card) => {
    set({ card });
  },
  renameCard: ({ charName, fileName }) => {
    set((s) => {
      if (!s.card) return {};
      const next: Partial<AppState> = {};

      // ─── File name (tên file khi xuất — KHÔNG phải tên nhân vật) ───
      if (typeof fileName === 'string' && fileName.trim()) {
        next.cardFileName = fileName.trim();
      }

      // ─── Character name (tên nhân vật trong SillyTavern) ───
      const trimmedChar = typeof charName === 'string' ? charName.trim() : undefined;
      if (trimmedChar) {
        // Update BOTH V1 (card.name) and V2/V3 (card.data.name) so SillyTavern shows it
        // consistently regardless of spec version.
        const newCard: CharacterCard = {
          ...s.card,
          name: trimmedChar,
          data: { ...(s.card.data || {}), name: trimmedChar },
        } as CharacterCard;
        next.card = newCard;

        // The name is ALSO a translatable field ('name' / 'data.name'). If we don't update
        // those fields, applyTranslationsToCard would overwrite our rename on export. So mark
        // them done with the new value to keep export consistent.
        if (s.fields.length > 0) {
          next.fields = s.fields.map((f) =>
            f.path === 'name' || f.path === 'data.name'
              ? { ...f, translated: trimmedChar, status: 'done' as const, error: undefined }
              : f
          );
        }
      }

      return next;
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
    // IDB is not used — opening it causes Windows Defender to scan old LevelDB files (freeze).
  },
  loadStateFromIDB: async () => {
    // No-op: IDB is entirely disabled to prevent Windows Defender from scanning LevelDB files.
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
    maxRetries: LS.get('st-translator-advanced-settings', { maxRetries: 5 }).maxRetries ?? 5,
    minResponseRatio: LS.get('st-translator-advanced-settings', { minResponseRatio: 0.15 }).minResponseRatio ?? 0.15,
    systemPromptPrefix: LS.get('st-translator-advanced-settings', { systemPromptPrefix: '' }).systemPromptPrefix ?? '',
    useCorsProxy: LS.get('st-translator-use-cors-proxy', true),
    useStream: LS.get('st-translator-use-stream', true),
    expertMode: LS.get('st-translator-advanced-settings', { expertMode: false }).expertMode ?? false,
    primaryModelRpm: LS.get('st-translator-advanced-settings', { primaryModelRpm: 5 }).primaryModelRpm ?? 5,
    secondaryModel: LS.get('st-translator-advanced-settings', { secondaryModel: '' }).secondaryModel ?? '',
    secondaryModelRpm: LS.get('st-translator-advanced-settings', { secondaryModelRpm: 17 }).secondaryModelRpm ?? 17,
    enableSecondaryModel: LS.get('st-translator-advanced-settings', { enableSecondaryModel: false }).enableSecondaryModel ?? false,
    secondaryModelThreshold: LS.get('st-translator-advanced-settings', { secondaryModelThreshold: 10000 }).secondaryModelThreshold ?? 10000,
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
      maxRetries: 5,
      minResponseRatio: 0.15,
      systemPromptPrefix: '',
      useCorsProxy: true,
      useStream: true,
      expertMode: false,
      primaryModelRpm: 5,
      secondaryModel: '',
      secondaryModelRpm: 17,
      enableSecondaryModel: false,
      secondaryModelThreshold: 10000,
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

  // ─── Provider phụ (đa provider — gộp chạy song song) ───
  providers: LS.get('st-translator-providers', [] as ProviderConfig[]),
  addProvider: () => {
    set((s) => {
      const n = s.providers.length + 2; // provider #1 = proxy, nên phụ bắt đầu từ #2
      const np: ProviderConfig = {
        id: (globalThis.crypto?.randomUUID?.() || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        name: `Provider #${n}`,
        enabled: true,
        provider: s.proxy.provider,
        proxyUrl: s.proxy.proxyUrl,
        apiKey: '',
        apiKeys: [],
        model: s.proxy.model,
        primaryModelRpm: 5,
        enableSecondaryModel: false,
        secondaryModel: '',
        secondaryModelRpm: 17,
        secondaryModelThreshold: 10000,
      };
      const providers = [...s.providers, np];
      LS.set('st-translator-providers', providers);
      return { providers };
    });
  },
  updateProvider: (id, patch) => {
    set((s) => {
      const providers = s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
      LS.set('st-translator-providers', providers);
      return { providers };
    });
  },
  removeProvider: (id) => {
    set((s) => {
      const providers = s.providers.filter((p) => p.id !== id);
      LS.set('st-translator-providers', providers);
      return { providers };
    });
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
    // (Audit đợt 1) Mặc định 'batch': đa luồng + gộp call — 'single' cũ làm user mới dịch 74 entry
    // lorebook TUẦN TỰ từng cái (chậm kinh khủng). User đã tự chọn thì LS giữ nguyên lựa chọn.
    lorebookStrategy: LS.get('st-translator-lorebook-strategy', 'batch') as any,
    skipAlreadyTranslated: LS.get('st-translator-skip-already-translated', true),
    lightSkipContent: LS.get('st-translator-light-skip-content', false),
    smartBatchPacking: LS.get('st-translator-smart-batch-packing', false),
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
    enableGomorrahNsfwRules: LS.get('st-translator-gomorrah-nsfw-rules', true),
    enableObjectiveMode: LS.get('st-translator-objective-mode', true),
    // (Audit) Mac dinh BAT: dich 'phau thuat' chi trich chuoi CJK trong code/regex — an toan hon han
    // cho nguoi moi (truoc day OFF va la nguon vo regex pho bien). User da tung chinh thi LS giu nguyen.
    surgicalMode: LS.get('st-translator-surgical-mode', true),
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
    cssCjkHandling: LS.get('st-translator-css-cjk-handling', 'translate') as 'preserve' | 'translate',
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
      if ('enableGomorrahNsfwRules' in partial) {
        LS.set('st-translator-gomorrah-nsfw-rules', next.enableGomorrahNsfwRules);
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
      if ('skipAlreadyTranslated' in partial) {
        LS.set('st-translator-skip-already-translated', next.skipAlreadyTranslated);
      }
      // (Fix audit đợt 1) lightSkipContent cần handler RIÊNG: trước đây chỉ được lưu khi partial có
      // skipAlreadyTranslated — preset "Dịch nhẹ" set lightSkipContent một mình ⇒ F5 là MẤT cờ.
      if ('lightSkipContent' in partial) {
        LS.set('st-translator-light-skip-content', next.lightSkipContent);
      }
      if ('smartBatchPacking' in partial) {
        LS.set('st-translator-smart-batch-packing', next.smartBatchPacking);
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
      skipAlreadyTranslated: true,
      lightSkipContent: false,
      smartBatchPacking: false,
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
      enableGomorrahNsfwRules: true,
      enableObjectiveMode: true,
      surgicalMode: true,
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
      cssCjkHandling: 'translate' as const,
    };

    LS.set('st-translator-source-lang', defaultTranslationConfig.sourceLanguage);
    LS.set('st-translator-target-lang', defaultTranslationConfig.targetLanguage);
    LS.set('st-translator-custom-prompt', defaultTranslationConfig.translationPrompt);
    LS.set('st-translator-translation-mode', defaultTranslationConfig.mode);
    LS.set('st-translator-lorebook-strategy', defaultTranslationConfig.lorebookStrategy);
    LS.set('st-translator-skip-already-translated', defaultTranslationConfig.skipAlreadyTranslated);
    LS.set('st-translator-light-skip-content', defaultTranslationConfig.lightSkipContent);
    LS.set('st-translator-smart-batch-packing', defaultTranslationConfig.smartBatchPacking);
    
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
    LS.set('st-translator-gomorrah-nsfw-rules', defaultTranslationConfig.enableGomorrahNsfwRules);
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
  },
  updateField: (path, update) =>
    set((s) => {
      const nextFields = s.fields.map((f) => (f.path === path ? { ...f, ...update } : f));
      return { fields: nextFields };
    }),
  phase: 'idle',
  setPhase: (p) => set(() => ({ phase: p })),
  preprocessProgress: null,
  setPreprocessProgress: (p) => set({ preprocessProgress: p }),
  currentFieldIndex: 0,
  setCurrentFieldIndex: (i) => set({ currentFieldIndex: i }),
  startTime: null,
  setStartTime: (t) => set({ startTime: t }),

  // ─── Logs ───
  logs: [],
  logFilter: 'all',
  setLogFilter: (f) => set({ logFilter: f }),
  addLog: (level, message) =>
    set((s) => {
      // Giới hạn số dòng log giữ trong bộ nhớ. Dịch card lớn gọi addLog hàng nghìn lần
      // (mỗi field/chunk/retry 1 dòng); nếu để mảng phình vô hạn thì mỗi lần append copy cả
      // mảng + panel filter cả mảng → O(n²), gây giật dần về cuối. Panel chỉ hiển thị 300 dòng
      // cuối nên giữ 800 là thừa cho mọi bộ lọc.
      const MAX_LOGS = 800;
      const next = [...s.logs, { id: crypto.randomUUID(), timestamp: Date.now(), level, message, phase: s.logPhase }];
      return { logs: next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next };
    }),
  logPhase: 'other',
  setLogPhase: (p) => set({ logPhase: p }),
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
  // Suy ra từ ngôn ngữ giao diện. 'vi' → 'en' là CỐ Ý (xem resolveLocale trong i18n/index.ts):
  // giữ nguyên bộ mặt app mà user cũ đã quen. Không có setter — đổi ngôn ngữ sẽ reload trang.
  locale: resolveLocale(getUiLang()),
  activeTab: 'core',
  setActiveTab: (t) => set({ activeTab: t }),
  activePresetId: LS.get('st-preset-active-id', ''),
  setActivePresetId: (id) => { LS.set('st-preset-active-id', id); set({ activePresetId: id }); },
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Live Schema Context
  liveSchemaContext: '',
  setLiveSchemaContext: (s) => set({ liveSchemaContext: s }),
  clearLiveSchemaContext: () => set({ liveSchemaContext: '' }),

  mvuConversionProgress: '',
  setMvuConversionProgress: (p) => set({ mvuConversionProgress: p }),

  jumpToFieldPath: null,
  setJumpToFieldPath: (p) => set({ jumpToFieldPath: p }),

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

  // ─── Per-file Translation Cache (filesystem — survives F5 / tab close / browser change) ───
  saveTranslationCache: () => {
    const s = useStore.getState();
    if (!s.cardFileName || s.fields.length === 0) return;
    // Debounce: one disk write per window, capturing the latest state at flush time.
    if (_fsSaveTimer) return;
    _fsSaveTimer = setTimeout(() => {
      _fsSaveTimer = null;
      const cur = useStore.getState();
      if (!cur.cardFileName || cur.fields.length === 0) return;
      FsCache.save(cur.cardFileName, buildProgressSnapshot(cur)).catch(() => { /* best-effort */ });
    }, FS_SAVE_DEBOUNCE_MS);
  },
  loadTranslationCache: async (fileName: string): Promise<boolean> => {
    const entry = await FsCache.load<any>(fileName);
    const snap = entry?.data;
    if (!snap || !Array.isArray(snap.fields) || snap.fields.length === 0) return false;

    set((s) => ({
      fields: snap.fields,
      // A run was active when last saved → restore as 'paused' (never silently auto-run a loop)
      phase: snap.phase === 'translating' ? ('paused' as TranslationPhase) : (snap.phase || 'idle'),
      currentFieldIndex: snap.currentFieldIndex || 0,
      mvuKeyMetadata: snap.mvuKeyMetadata || {},
      translationConfig: {
        ...s.translationConfig,
        mvuDictionary: snap.dicts?.mvuDictionary ?? s.translationConfig.mvuDictionary,
        ejsEntryNameDict: snap.dicts?.ejsEntryNameDict ?? s.translationConfig.ejsEntryNameDict,
        ejsKeywordDict: snap.dicts?.ejsKeywordDict ?? s.translationConfig.ejsKeywordDict,
      },
    }));
    return true;
  },
  deleteCurrentCardCache: async () => {
    const s = useStore.getState();
    if (s.cardFileName) {
      // Remove the on-disk progress file for this card
      FsCache.remove(s.cardFileName).catch(() => { /* best-effort */ });

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

    }
  },
  deleteAllCaches: async () => {
    // Remove ALL on-disk progress files
    try {
      const items = await FsCache.list();
      await Promise.all(items.map(it => FsCache.remove(it.key)));
    } catch { /* best-effort */ }

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

  },
}));
