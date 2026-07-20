import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  AutoCreatorConfig,
  AutoCreatorStep,
  MinhNguyetStep,
  AnyPipelineStep,
  PipelineMethod,
  PipelineLog,
  StepStatus,
  StepPreview,
  CardBlueprint,
} from '../types';

interface AutoCreatorState {
  // Config
  config: AutoCreatorConfig;

  // Pipeline state
  isRunning: boolean;
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
  updateMnStepConfig: <K extends keyof AutoCreatorConfig['mnStepConfigs']>(
    step: K,
    patch: Partial<AutoCreatorConfig['mnStepConfigs'][K]>
  ) => void;
  setAutoApplyAll: (v: boolean) => void;
  applyPreset: (presetConfig: Partial<AutoCreatorConfig>) => void;
  
  // Actions — Pipeline control
  setIsRunning: (running: boolean) => void;
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

export const useAutoCreatorStore = create<AutoCreatorState>((set) => ({
  config: {
    idea: '',
    userRules: '',
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
  },

  isRunning: false,
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
}));
