/**
 * Card store — Zustand + Dexie sync
 * Quản lý card hiện tại, auto-save, undo
 * Được chia thành các slice: ProjectSlice, CardSlice, PersistenceSlice
 */

import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import type { CharacterCardV3, LorebookEntry, CardExtensions, TavernHelperScript } from '../types';
import type { MVUZODSchema, InitVarConfig } from '../types/mvuzod.types';
import { tavernSync } from '../lib/sync/tavernSyncService';
import { createEmptyCard, syncMirrorFields, nextEntryId } from '../lib/converters/cardDefaults';
import { schemaToZodCode } from '../lib/mvuzod/schemaInferencer';
import { normalizeMVUZODSchema } from '../lib/mvuzod/normalizeSchema';
import * as repo from '../lib/db/projectRepo';

// ═══════════════════════════════════════════════════════════════════════════
// SLICE INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectSlice {
  currentProjectId: string | null;
  projects: Array<{ id: string; name: string; updatedAt: number }>;
  loadProject: (id: string) => Promise<void>;
  createNewProject: (name?: string) => Promise<string>;
  deleteCurrentProject: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjectList: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
}

export interface CardSlice {
  card: CharacterCardV3;
  isDirty: boolean;
  updateCard: (updater: (card: CharacterCardV3) => void) => void;
  updateField: (path: string, value: unknown) => void;
  setCard: (card: CharacterCardV3) => void;
  addEntry: (entry: LorebookEntry) => void;
  updateEntry: (id: number, patch: Partial<LorebookEntry>) => void;
  deleteEntry: (id: number) => void;
  reorderEntries: (newOrder: number[]) => void;
  getNextEntryId: () => number;
  setMvuzodSchema: (schema: MVUZODSchema | null) => void;
  setMvuzodInitVar: (config: InitVarConfig | null) => void;
  getMvuzodInitVar: () => InitVarConfig | null;
  addTavernScript: (script: TavernHelperScript) => void;
  updateTavernScript: (idx: number, patch: Partial<TavernHelperScript>) => void;
  deleteTavernScript: (idx: number) => void;
}

export interface PersistenceSlice {
  isSaving: boolean;
  lastSavedAt: number | null;
  _autoSaveTimer: ReturnType<typeof setTimeout> | null;
  save: () => Promise<void>;
  createSnapshot: (label: string) => Promise<void>;
  undoToSnapshot: () => Promise<boolean>;
  _scheduleAutoSave: () => void;
}

export interface CardState extends ProjectSlice, CardSlice, PersistenceSlice {}

// ═══════════════════════════════════════════════════════════════════════════
// SLICE CREATORS
// ═══════════════════════════════════════════════════════════════════════════

const createProjectSlice: StateCreator<CardState, [], [], ProjectSlice> = (set, get) => ({
  currentProjectId: null,
  projects: [],

  loadProject: async (id) => {
    const project = await repo.getProject(id);
    if (!project) return;
    set({
      currentProjectId: id,
      card: project.card,
      isDirty: false,
      lastSavedAt: project.updatedAt,
    });
  },

  createNewProject: async (name) => {
    const project = await repo.createProject(name);
    set({
      currentProjectId: project.id,
      card: project.card,
      isDirty: false,
      lastSavedAt: project.updatedAt,
    });
    await get().refreshProjectList();
    return project.id;
  },

  deleteCurrentProject: async () => {
    const { currentProjectId } = get();
    if (!currentProjectId) return;
    await repo.deleteProject(currentProjectId);
    const projects = await repo.getAllProjects();
    if (projects.length > 0) {
      await get().loadProject(projects[0].id);
    } else {
      await get().createNewProject();
    }
    await get().refreshProjectList();
  },

  deleteProject: async (id) => {
    await repo.deleteProject(id);
    const projects = await repo.getAllProjects();
    const { currentProjectId } = get();
    
    if (currentProjectId === id) {
      if (projects.length > 0) {
        await get().loadProject(projects[0].id);
      } else {
        await get().createNewProject();
      }
    }
    await get().refreshProjectList();
  },

  refreshProjectList: async () => {
    const projects = await repo.getAllProjects();
    set({
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
      })),
    });
  },
  renameProject: async (id, name) => {
    await repo.renameProject(id, name);
    await get().refreshProjectList();
  },
});

const createCardSlice: StateCreator<CardState, [], [], CardSlice> = (set, get) => ({
  card: createEmptyCard(),
  isDirty: false,

  updateCard: (updater) => {
    set(s => {
      const card = structuredClone(s.card);
      updater(card);
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  updateField: (path, value) => {
    set(s => {
      const card = structuredClone(s.card);
      const parts = path.split('.');
      let obj: Record<string, unknown> = card as unknown as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (obj[key] === undefined || obj[key] === null) {
          obj[key] = {};
        }
        obj = obj[key] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]] = value;
      return { card: card as CharacterCardV3, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  setCard: (card) => {
    set({ card: structuredClone(card), isDirty: true });
    get()._scheduleAutoSave();
  },

  addEntry: (entry) => {
    set(s => {
      const card = structuredClone(s.card);
      if (!card.data.character_book) {
        card.data.character_book = { name: card.data.name, entries: [] };
      }
      card.data.character_book.entries.push(entry);
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  updateEntry: (id, patch) => {
    set(s => {
      const card = structuredClone(s.card);
      const entries = card.data.character_book?.entries ?? [];
      const idx = entries.findIndex(e => e.id === id);
      if (idx !== -1) {
        entries[idx] = { ...entries[idx], ...patch };
      }
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  deleteEntry: (id) => {
    set(s => {
      const card = structuredClone(s.card);
      if (card.data.character_book) {
        card.data.character_book.entries = card.data.character_book.entries.filter(e => e.id !== id);
      }
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  reorderEntries: (newOrder) => {
    set(s => {
      const card = structuredClone(s.card);
      if (!card.data.character_book) return { card };
      const entries = card.data.character_book.entries;
      const entryMap = new Map(entries.map(e => [e.id, e]));
      card.data.character_book.entries = newOrder
        .map(id => entryMap.get(id))
        .filter((e): e is LorebookEntry => !!e);
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  getNextEntryId: () => {
    const entries = get().card.data.character_book?.entries ?? [];
    return nextEntryId(entries);
  },

  setMvuzodSchema: (schemaRaw) => {
    // (Bug enumValues 19/07) Chốt chặn cho MỌI đường ghi schema (AI sinh, wizard, import):
    // field thiếu `constraints` sẽ làm schemaToZodCode bên dưới (và mọi consumer khác) crash
    // "reading 'enumValues'". Normalize trước khi đụng bất kỳ thứ gì.
    const schema = schemaRaw ? normalizeMVUZODSchema(schemaRaw) : schemaRaw;
    set(s => {
      const card = structuredClone(s.card);
      const ext = (card.data.extensions ?? {}) as unknown as Record<string, unknown>;
      if (schema) {
        ext.mvuzod = { ...(ext.mvuzod as Record<string, unknown> ?? {}), schema };

        // Auto-sync TavernHelper scripts with new schema
        const th = (ext.tavern_helper ?? { scripts: [], variables: {} }) as Record<string, unknown>;
        const scripts = (th.scripts ?? []) as TavernHelperScript[];
        const cardName = card.data.name || 'Card';

        // Update or create 'MVU' import script
        const mvuIdx = scripts.findIndex(s => s.name === 'MVU');
        const mvuScript: TavernHelperScript = {
          type: 'script', enabled: true, name: 'MVU',
          id: mvuIdx >= 0 ? scripts[mvuIdx].id : crypto.randomUUID(),
          content: `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';`,
          info: '', button: { enabled: false, buttons: [] }, data: {},
        };
        if (mvuIdx >= 0) scripts[mvuIdx] = mvuScript;
        else scripts.push(mvuScript);

        // Update or create schema registration script
        const schemaPrefix = 'Cấu trúc biến';
        const schemaIdx = scripts.findIndex(s => s.name.startsWith(schemaPrefix));
        const schemaScript: TavernHelperScript = {
          type: 'script', enabled: true, name: `${schemaPrefix} ${cardName}`,
          id: schemaIdx >= 0 ? scripts[schemaIdx].id : crypto.randomUUID(),
          content: schemaToZodCode(schema, cardName),
          info: '', button: { enabled: false, buttons: [] }, data: {},
        };
        if (schemaIdx >= 0) scripts[schemaIdx] = schemaScript;
        else scripts.push(schemaScript);

        th.scripts = scripts;
        ext.tavern_helper = th;
      } else {
        if (ext.mvuzod) {
          delete (ext.mvuzod as Record<string, unknown>).schema;
        }
      }
      card.data.extensions = ext as unknown as CardExtensions;
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  setMvuzodInitVar: (config) => {
    set(s => {
      const card = structuredClone(s.card);
      const ext = (card.data.extensions ?? {}) as unknown as Record<string, unknown>;
      if (config) {
        ext.mvuzod = { ...(ext.mvuzod as Record<string, unknown> ?? {}), initVarConfig: config };
      } else {
        if (ext.mvuzod) {
          delete (ext.mvuzod as Record<string, unknown>).initVarConfig;
        }
      }
      card.data.extensions = ext as unknown as CardExtensions;
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  getMvuzodInitVar: () => {
    const ext = get().card.data.extensions as unknown as Record<string, unknown>;
    if (ext?.mvuzod) {
      return (ext.mvuzod as Record<string, unknown>).initVarConfig as InitVarConfig ?? null;
    }
    return null;
  },

  addTavernScript: (script) => {
    set(s => {
      const card = structuredClone(s.card);
      const ext = (card.data.extensions ?? {}) as unknown as Record<string, unknown>;
      const th = (ext.tavern_helper ?? { scripts: [], variables: {} }) as Record<string, unknown>;
      const scripts = (th.scripts ?? []) as TavernHelperScript[];
      scripts.push(script);
      th.scripts = scripts;
      ext.tavern_helper = th;
      card.data.extensions = ext as unknown as CardExtensions;
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  updateTavernScript: (idx, patch) => {
    set(s => {
      const card = structuredClone(s.card);
      const ext = (card.data.extensions ?? {}) as unknown as Record<string, unknown>;
      const th = (ext.tavern_helper ?? { scripts: [], variables: {} }) as Record<string, unknown>;
      const scripts = (th.scripts ?? []) as TavernHelperScript[];
      if (idx >= 0 && idx < scripts.length) {
        scripts[idx] = { ...scripts[idx], ...patch };
      }
      th.scripts = scripts;
      ext.tavern_helper = th;
      card.data.extensions = ext as unknown as CardExtensions;
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },

  deleteTavernScript: (idx) => {
    set(s => {
      const card = structuredClone(s.card);
      const ext = (card.data.extensions ?? {}) as unknown as Record<string, unknown>;
      const th = (ext.tavern_helper ?? { scripts: [], variables: {} }) as Record<string, unknown>;
      const scripts = (th.scripts ?? []) as TavernHelperScript[];
      if (idx >= 0 && idx < scripts.length) {
        scripts.splice(idx, 1);
      }
      th.scripts = scripts;
      ext.tavern_helper = th;
      card.data.extensions = ext as unknown as CardExtensions;
      return { card, isDirty: true };
    });
    get()._scheduleAutoSave();
  },
});

const createPersistenceSlice: StateCreator<CardState, [], [], PersistenceSlice> = (set, get) => ({
  isSaving: false,
  lastSavedAt: null,
  _autoSaveTimer: null,

  save: async () => {
    const { currentProjectId, card } = get();
    if (!currentProjectId) return;
    set({ isSaving: true });
    const synced = syncMirrorFields(structuredClone(card));
    await repo.saveProject(currentProjectId, synced);
    set({ isSaving: false, isDirty: false, lastSavedAt: Date.now(), card: synced });
    await get().refreshProjectList();

    // Auto-sync to SillyTavern nếu bật
    const syncSettings = tavernSync.getSettings();
    if (syncSettings.autoSync) {
      tavernSync.pushCard(synced).catch(() => { /* silent fail */ });
    }
  },

  createSnapshot: async (label) => {
    const { currentProjectId, card } = get();
    if (!currentProjectId) return;
    await repo.createSnapshot(currentProjectId, card, label);
  },

  undoToSnapshot: async () => {
    const { currentProjectId } = get();
    if (!currentProjectId) return false;
    const snapshot = await repo.getLatestSnapshot(currentProjectId);
    if (!snapshot) return false;
    set({ card: snapshot.card, isDirty: true });
    await repo.deleteSnapshot(snapshot.id);
    get()._scheduleAutoSave();
    return true;
  },

  _scheduleAutoSave: () => {
    const timer = get()._autoSaveTimer;
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(() => {
      get().save();
    }, 1500);
    set({ _autoSaveTimer: newTimer });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STORE MERGING
// ═══════════════════════════════════════════════════════════════════════════

export const useCardStore = create<CardState>()((...a) => ({
  ...createProjectSlice(...a),
  ...createCardSlice(...a),
  ...createPersistenceSlice(...a),
}));
