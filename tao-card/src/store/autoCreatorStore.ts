import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  AutoCreatorConfig,
  AutoCreatorStep,
  MinhNguyetStep,
  AnyPipelineStep,
  PipelineMethod,
  CardKind,
  PipelineLog,
  StepStatus,
  StepPreview,
  CardBlueprint,
  AppliedEjsPolicy,
  AppliedBatchPreset,
  CardTuning,
} from '../types';

interface AutoCreatorState {
  // Config
  config: AutoCreatorConfig;

  // Pipeline state
  isRunning: boolean;
  /** (Goal 104 — #43) Hủy call AI ĐANG BAY khi bấm Dừng — không chỉ dừng giữa các bước. */
  abort: AbortController | null;
  isPaused: boolean;
  currentStep: AnyPipelineStep | null;
  stepStatuses: Record<AutoCreatorStep, StepStatus>;
  mnStepStatuses: Record<MinhNguyetStep, StepStatus>;
  logs: PipelineLog[];

  // v3: Blueprint
  blueprint: CardBlueprint | null;
  isBlueprintLoading: boolean;

  // v3: Step previews
  stepPreviews: Record<AutoCreatorStep, StepPreview | null>;
  mnStepPreviews: Record<MinhNguyetStep, StepPreview | null>;

  // Step results (summary text)
  stepResults: Record<AutoCreatorStep, string>;
  mnStepResults: Record<MinhNguyetStep, string>;

  // Actions — Config
  setIdea: (idea: string) => void;
  /** (104b) Đổi loại thẻ — game_world tự bỏ bước system_prompt khỏi danh sách chạy. */
  setCardKind: (kind: CardKind) => void;
  setUserRules: (userRules: string) => void;
  setPipelineMethod: (method: PipelineMethod) => void;
  toggleStep: (step: AutoCreatorStep) => void;
  toggleMnStep: (step: MinhNguyetStep) => void;
  reorderSteps: (newOrder: AutoCreatorStep[]) => void;
  reorderMnSteps: (newOrder: MinhNguyetStep[]) => void;
  updateStepConfig: <K extends keyof AutoCreatorConfig['stepConfigs']>(
    step: K,
    patch: Partial<AutoCreatorConfig['stepConfigs'][K]>
  ) => void;
  updateMnConfig: (patch: Partial<AutoCreatorConfig['mnConfig']>) => void;
  /** (bug 126) EJS Studio áp chính sách EJS sang — Auto Creator hiện banner báo cho user biết. */
  applyEjsPolicy: (policy: AppliedEjsPolicy) => void;
  clearEjsPolicy: () => void;
  /**
   * (bug 134) BẬT/TẮT cấu hình "AI Sinh Theo Batch" cho bước Lorebook.
   * Bật: chụp cấu hình hiện tại rồi ghi cấu hình của Batch đè lên.
   * Tắt: trả lại đúng bản chụp đó — không để lại promptOverride/category mồ côi.
   */
  applyBatchPreset: (preset: AppliedBatchPreset, patch: Partial<AutoCreatorConfig['stepConfigs']['lorebook']>) => void;
  clearBatchPreset: () => void;
  /** (bug 141) Cập nhật trạng thái "Xem trước & Tinh chỉnh" (persist theo config). */
  setTuning: (patch: Partial<CardTuning> | CardTuning | undefined) => void;
  clearTuning: () => void;
  /** (bug 155-2) Ngăn cấu hình riêng cho từng card. */
  configByProject: Record<string, AutoCreatorConfig>;
  boundProjectId: string | null;
  /** Chuyển sang card khác: cất bản cũ, lấy bản của card mới (chưa có → mặc định sạch). */
  bindProject: (projectId: string | null) => void;
  updateMnStepConfig: <K extends keyof AutoCreatorConfig['mnStepConfigs']>(
    step: K,
    patch: Partial<AutoCreatorConfig['mnStepConfigs'][K]>
  ) => void;
  setAutoApplyAll: (v: boolean) => void;
  applyPreset: (presetConfig: Partial<AutoCreatorConfig>) => void;
  
  // Actions — Pipeline control
  setIsRunning: (running: boolean) => void;
  setAbort: (ac: AbortController | null) => void;
  /** (Goal 104 — #43) Dừng DỨT HẲN: tắt cờ chạy + abort mọi request đang bay. */
  stopPipeline: () => void;
  setPaused: (paused: boolean) => void;
  setCurrentStep: (step: AnyPipelineStep | null) => void;
  setStepStatus: (step: AutoCreatorStep, status: StepStatus) => void;
  setMnStepStatus: (step: MinhNguyetStep, status: StepStatus) => void;
  setStepResult: (step: AutoCreatorStep, result: string) => void;
  setMnStepResult: (step: MinhNguyetStep, result: string) => void;
  addLog: (log: Omit<PipelineLog, 'id' | 'timestamp'>) => void;
  resetPipeline: () => void;

  // v3: Blueprint
  setBlueprint: (bp: CardBlueprint | null) => void;
  setBlueprintLoading: (v: boolean) => void;

  // v3: Step previews
  setStepPreview: (step: AutoCreatorStep, preview: StepPreview | null) => void;
  setMnStepPreview: (step: MinhNguyetStep, preview: StepPreview | null) => void;
  clearAllPreviews: () => void;
}

// (User 19/07) THỨ TỰ CHẠY: mvuzod TRƯỚC regex (regex bám tên biến schema), game_ui ngay sau
// mvuzod (cần schema), final_check CUỐI CÙNG (kiểm tổng thể toàn card).
const ALL_STEPS: AutoCreatorStep[] = [
  'basic_info', 'lorebook', 'mvuzod', 'game_ui', 'regex', 'system_prompt', 'first_message', 'mes_example', 'final_check'
];

const ALL_MN_STEPS: MinhNguyetStep[] = [
  'worldview', 'character_basic', 'color_palette', 'three_faces', 'secondary_explanation',
  'wardrobe', 'nsfw_palette', 'npc_creation', 'character_overview', 'opening'
];

const DEFAULT_MN_STEPS: MinhNguyetStep[] = [
  'worldview', 'character_basic', 'color_palette', 'secondary_explanation',
  'wardrobe', 'character_overview', 'opening'
];

const emptyStatuses = (): Record<AutoCreatorStep, StepStatus> => ({
  basic_info: 'pending', lorebook: 'pending', regex: 'pending', mvuzod: 'pending',
  game_ui: 'pending', final_check: 'pending',
  system_prompt: 'pending', first_message: 'pending', mes_example: 'pending'
});

const emptyMnStatuses = (): Record<MinhNguyetStep, StepStatus> => ({
  worldview: 'pending', character_basic: 'pending', color_palette: 'pending',
  three_faces: 'pending', secondary_explanation: 'pending', wardrobe: 'pending',
  nsfw_palette: 'pending', npc_creation: 'pending', character_overview: 'pending', opening: 'pending'
});

const emptyResults = (): Record<AutoCreatorStep, string> => ({
  basic_info: '', lorebook: '', regex: '', mvuzod: '', game_ui: '', final_check: '',
  system_prompt: '', first_message: '', mes_example: ''
});

const emptyMnResults = (): Record<MinhNguyetStep, string> => ({
  worldview: '', character_basic: '', color_palette: '', three_faces: '',
  secondary_explanation: '', wardrobe: '', nsfw_palette: '',
  npc_creation: '', character_overview: '', opening: ''
});

const emptyPreviews = (): Record<AutoCreatorStep, StepPreview | null> => ({
  basic_info: null, lorebook: null, regex: null, mvuzod: null, game_ui: null, final_check: null,
  system_prompt: null, first_message: null, mes_example: null
});

const emptyMnPreviews = (): Record<MinhNguyetStep, StepPreview | null> => ({
  worldview: null, character_basic: null, color_palette: null, three_faces: null,
  secondary_explanation: null, wardrobe: null, nsfw_palette: null,
  npc_creation: null, character_overview: null, opening: null
});

/**
 * (bug 155-2) Cấu hình MẶC ĐỊNH — tách ra hằng số để dựng lại khi chuyển sang card khác.
 * User: "Mỗi Card chỉ lưu dữ liệu của riêng mình, không giữ lại dữ liệu từ Card trước."
 */
const defaultConfig = (): AutoCreatorConfig => ({
    idea: '',
    userRules: '',
    cardKind: 'character',
    pipelineMethod: 'minh_nguyet',  // Minh Nguyệt = default
    selectedSteps: [...ALL_STEPS],
    selectedMnSteps: [...DEFAULT_MN_STEPS],
    autoApplyAll: true,
    stepConfigs: {
      basic_info: { includePersonality: true, includeScenario: true, language: 'vi', promptMode: 'default' },
      lorebook: { totalEntries: 20, minEntries: 0, entriesPerBatch: 5, concurrentBatches: 1, category: 'custom', cardType: 'single', useWebSearch: false, promptMode: 'default' },
      regex: { count: 3, types: ['dialog', 'cleanup', 'style'], promptMode: 'default' },
      mvuzod: { autoDetect: true, createInitVar: true, createVarList: true, createUpdateRules: true, promptMode: 'default' },
      game_ui: { component: 'full_set' },
      final_check: { useAiReview: true },
      system_prompt: { includeDepthPrompt: true, depthValue: 4, promptMode: 'default' },
      first_message: { alternateGreetings: 2, promptMode: 'default' },
      mes_example: { exampleCount: 2, promptMode: 'default' },
    },
    mnConfig: {
      worldviewPath: 'small_world',
      cardType: 'single',
      includeThreeFaces: false,
      includeNsfw: false,
      includeNpc: false,
      autoTag: true,
    },
    mnStepConfigs: {
      worldview: { promptMode: 'default' },
      character_basic: { promptMode: 'default' },
      color_palette: { promptMode: 'default' },
      three_faces: { promptMode: 'default' },
      secondary_explanation: { promptMode: 'default' },
      wardrobe: { promptMode: 'default' },
      nsfw_palette: { promptMode: 'default' },
      npc_creation: { npcCount: 2, promptMode: 'default' },
      character_overview: { promptMode: 'default' },
      opening: { alternateGreetings: 2, promptMode: 'default' },
    },
});

export const useAutoCreatorStore = create<AutoCreatorState>()(persist((set, get) => ({
  config: defaultConfig(),
  configByProject: {},
  boundProjectId: null,

  /**
   * (bug 155-2) Gắn cấu hình vào ĐÚNG card đang mở.
   *
   * Trước đây `config` là MỘT bản dùng chung cho mọi card, persist dưới một khoá duy nhất —
   * nên mở card khác vẫn thấy ý tưởng, quy tắc và schema của card trước, rồi vô tình tạo card
   * mới bằng dữ liệu của card cũ. Nay cất bản đang dùng vào ngăn của card cũ rồi lấy ra ngăn
   * của card mới (chưa có thì dựng mặc định sạch).
   */
  bindProject: (projectId) => set((s) => {
    if (s.boundProjectId === projectId) return {};
    const saved = s.boundProjectId
      ? { ...s.configByProject, [s.boundProjectId]: s.config }
      : s.configByProject;
    return {
      configByProject: saved,
      boundProjectId: projectId,
      config: (projectId && saved[projectId]) ? saved[projectId] : defaultConfig(),
    };
  }),

  isRunning: false,
  abort: null,
  isPaused: false,
  currentStep: null,
  stepStatuses: emptyStatuses(),
  mnStepStatuses: emptyMnStatuses(),
  logs: [],
  stepResults: emptyResults(),
  mnStepResults: emptyMnResults(),
  
  // v3
  blueprint: null,
  isBlueprintLoading: false,
  stepPreviews: emptyPreviews(),
  mnStepPreviews: emptyMnPreviews(),

  // ─── Config actions ───
  setIdea: (idea) => set((s) => ({ config: { ...s.config, idea } })),
  setCardKind: (cardKind) => set((s) => ({
    config: {
      ...s.config,
      cardKind,
      // (104b) "bỏ System prompt" cho thẻ game/thế giới: luật chơi thuộc về lorebook +
      // [mvu_update] + giao diện. Đổi về character thì trả lại bước đó.
      selectedSteps: cardKind === 'game_world'
        ? s.config.selectedSteps.filter((x) => x !== 'system_prompt')
        : (s.config.selectedSteps.includes('system_prompt')
            ? s.config.selectedSteps
            : ([...s.config.selectedSteps, 'system_prompt'] as AutoCreatorStep[])
                .sort((a, b) => ALL_STEPS.indexOf(a) - ALL_STEPS.indexOf(b))),
    },
  })),

  // (User 19/07) Yêu cầu/quy tắc toàn cục — áp cho MỌI bước pipeline.
  setUserRules: (userRules) => set((s) => ({ config: { ...s.config, userRules } })),

  setPipelineMethod: (pipelineMethod) => set((s) => ({
    config: { ...s.config, pipelineMethod }
  })),
  
  toggleStep: (step) => set((s) => {
    const isSelected = s.config.selectedSteps.includes(step);
    const selectedSteps = isSelected
      ? s.config.selectedSteps.filter(st => st !== step)
      : [...s.config.selectedSteps, step].sort((a, b) => ALL_STEPS.indexOf(a) - ALL_STEPS.indexOf(b));
    return { config: { ...s.config, selectedSteps } };
  }),

  toggleMnStep: (step) => set((s) => {
    const isSelected = s.config.selectedMnSteps.includes(step);
    const selectedMnSteps = isSelected
      ? s.config.selectedMnSteps.filter(st => st !== step)
      : [...s.config.selectedMnSteps, step].sort((a, b) => ALL_MN_STEPS.indexOf(a) - ALL_MN_STEPS.indexOf(b));
    return { config: { ...s.config, selectedMnSteps } };
  }),

  reorderSteps: (newOrder) => set((s) => ({
    config: { ...s.config, selectedSteps: newOrder }
  })),

  reorderMnSteps: (newOrder) => set((s) => ({
    config: { ...s.config, selectedMnSteps: newOrder }
  })),

  applyEjsPolicy: (policy) => set((s) => ({ config: { ...s.config, appliedEjsPolicy: policy } })),
  clearEjsPolicy: () => set((s) => {
    const next = { ...s.config };
    delete next.appliedEjsPolicy;
    return { config: next };
  }),

  // (bug 134) Toggle cấu hình AI Sinh Theo Batch — bật ghi đè, tắt hoàn nguyên đúng bản chụp.
  applyBatchPreset: (preset, patch) => set((s) => ({
    config: {
      ...s.config,
      appliedBatchPreset: preset,
      stepConfigs: { ...s.config.stepConfigs, lorebook: { ...s.config.stepConfigs.lorebook, ...patch } },
    },
  })),
  setTuning: (patch) => set((s) => {
    if (patch === undefined) {
      const next = { ...s.config };
      delete next.tuning;
      return { config: next };
    }
    const cur = s.config.tuning;
    const merged = ('schema' in patch && 'originalSchema' in patch && 'ideaSig' in patch)
      ? (patch as CardTuning)
      : ({ ...(cur as CardTuning), ...patch } as CardTuning);
    return { config: { ...s.config, tuning: merged } };
  }),
  clearTuning: () => set((s) => {
    const next = { ...s.config };
    delete next.tuning;
    return { config: next };
  }),

  clearBatchPreset: () => set((s) => {
    const prev = s.config.appliedBatchPreset?.previousConfig;
    const next = { ...s.config };
    delete next.appliedBatchPreset;
    if (prev) {
      // Hoàn nguyên: các khoá có trong bản chụp trả về giá trị cũ. `promptOverride` từng là
      // undefined thì phải XOÁ hẳn, không để chuỗi rỗng làm prompt vẫn coi như có override.
      const restored = { ...next.stepConfigs.lorebook, ...prev } as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(prev)) if (v === undefined) delete restored[k];
      next.stepConfigs = { ...next.stepConfigs, lorebook: restored as unknown as typeof next.stepConfigs.lorebook };
    }
    return { config: next };
  }),

  updateStepConfig: (step, patch) => set((s) => ({
    config: {
      ...s.config,
      stepConfigs: {
        ...s.config.stepConfigs,
        [step]: { ...s.config.stepConfigs[step], ...patch }
      }
    }
  })),

  updateMnConfig: (patch) => set((s) => ({
    config: {
      ...s.config,
      mnConfig: { ...s.config.mnConfig, ...patch }
    }
  })),

  updateMnStepConfig: (step, patch) => set((s) => ({
    config: {
      ...s.config,
      mnStepConfigs: {
        ...s.config.mnStepConfigs,
        [step]: { ...s.config.mnStepConfigs[step], ...patch }
      }
    }
  })),

  setAutoApplyAll: (autoApplyAll) => set((s) => ({ config: { ...s.config, autoApplyAll } })),

  applyPreset: (presetConfig) => set((s) => {
    const merged = { ...s.config };
    if (presetConfig.pipelineMethod) merged.pipelineMethod = presetConfig.pipelineMethod;
    if (presetConfig.selectedSteps) merged.selectedSteps = presetConfig.selectedSteps;
    if (presetConfig.selectedMnSteps) merged.selectedMnSteps = presetConfig.selectedMnSteps;
    if (presetConfig.stepConfigs) {
      merged.stepConfigs = {
        ...merged.stepConfigs,
        ...presetConfig.stepConfigs,
      };
    }
    if (presetConfig.mnConfig) {
      merged.mnConfig = { ...merged.mnConfig, ...presetConfig.mnConfig };
    }
    if (presetConfig.mnStepConfigs) {
      merged.mnStepConfigs = {
        ...merged.mnStepConfigs,
        ...presetConfig.mnStepConfigs,
      };
    }
    if (presetConfig.presetId !== undefined) merged.presetId = presetConfig.presetId;
    return { config: merged };
  }),

  // ─── Pipeline control ───
  setIsRunning: (isRunning) => set({ isRunning }),
  setAbort: (abort) => set({ abort }),
  stopPipeline: () => {
    // (#43) Trước đây Dừng chỉ tắt cờ — call AI đang bay vẫn chạy tiếp hàng chục giây rồi
    // GHI KẾT QUẢ vào card như thường. Nay abort thật để luồng kết thúc ngay.
    get().abort?.abort();
    set({ isRunning: false, isPaused: false, currentStep: null });
  },
  setPaused: (isPaused) => set({ isPaused }),
  setCurrentStep: (currentStep) => set({ currentStep }),
  setStepStatus: (step, status) => set((s) => ({
    stepStatuses: { ...s.stepStatuses, [step]: status }
  })),
  setMnStepStatus: (step, status) => set((s) => ({
    mnStepStatuses: { ...s.mnStepStatuses, [step]: status }
  })),
  setStepResult: (step, result) => set((s) => ({
    stepResults: { ...s.stepResults, [step]: result }
  })),
  setMnStepResult: (step, result) => set((s) => ({
    mnStepResults: { ...s.mnStepResults, [step]: result }
  })),
  addLog: (log) => set((s) => ({
    logs: [...s.logs, { ...log, id: uuidv4(), timestamp: Date.now() }]
  })),
  resetPipeline: () => set(() => ({
    isRunning: false,
    isPaused: false,
    currentStep: null,
    stepStatuses: emptyStatuses(),
    mnStepStatuses: emptyMnStatuses(),
    logs: [],
    stepResults: emptyResults(),
    mnStepResults: emptyMnResults(),
    stepPreviews: emptyPreviews(),
    mnStepPreviews: emptyMnPreviews(),
    blueprint: null,
  })),

  // ─── v3: Blueprint ───
  setBlueprint: (blueprint) => set({ blueprint }),
  setBlueprintLoading: (isBlueprintLoading) => set({ isBlueprintLoading }),

  // ─── v3: Previews ───
  setStepPreview: (step, preview) => set((s) => ({
    stepPreviews: { ...s.stepPreviews, [step]: preview }
  })),
  setMnStepPreview: (step, preview) => set((s) => ({
    mnStepPreviews: { ...s.mnStepPreviews, [step]: preview }
  })),
  clearAllPreviews: () => set({ stepPreviews: emptyPreviews(), mnStepPreviews: emptyMnPreviews() }),
}), {
  name: 'tcs.autocreator.v1',
  // (#43 — "giữ input khi đổi tab") Chỉ persist CONFIG (ý tưởng, quy tắc, bước đã chọn,
  // config từng bước) — trạng thái chạy/log/preview là phù du, không lưu.
  // (bug 155-2) Persist CẢ ngăn theo card + card đang gắn, không thì đóng app mở lại là mất
  // hết dữ liệu riêng của từng card.
  partialize: (s) => ({ config: s.config, configByProject: s.configByProject, boundProjectId: s.boundProjectId }),
}));
