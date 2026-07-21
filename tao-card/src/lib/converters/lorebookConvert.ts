/**
 * src/lib/converters/lorebookConvert.ts — Import/Export converters
 * Spec Phần 3.1, 3.6, 4.1: V3 card JSON, standalone lorebook, auto-detect
 */

import type { CharacterCardV3, CardExtensions, LorebookEntry, LorebookEntryExt } from '../../types';
import { DEFAULT_ENTRY_EXT } from '../../types';
import { createEmptyCard, syncMirrorFields } from './cardDefaults';
import { syncEmbeddedWorldLink } from './worldLink';
import { parseZodCodeToSchema, isMvuSchemaScript } from '../mvuzod/zodCodeParser';

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-DETECT IMPORT FORMAT
// ═══════════════════════════════════════════════════════════════════════════

export type ImportFormat = 'v3_card' | 'v2_card' | 'standalone_lorebook' | 'unknown';

export function detectFormat(json: Record<string, unknown>): ImportFormat {
  // V3 card
  if (json.spec === 'chara_card_v3' && json.data) return 'v3_card';

  // V2 card (has data but no spec field, or spec != v3)
  if (json.data && typeof (json.data as Record<string, unknown>).name === 'string') return 'v2_card';

  // Standalone lorebook (has entries as Record<string, {...}>)
  if (json.entries && typeof json.entries === 'object' && !Array.isArray(json.entries)) {
    const firstKey = Object.keys(json.entries)[0];
    if (firstKey !== undefined) {
      const entry = (json.entries as Record<string, unknown>)[firstKey];
      if (entry && typeof entry === 'object' && 'key' in (entry as object)) {
        return 'standalone_lorebook';
      }
    }
    return 'standalone_lorebook';
  }

  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════════════════

export interface ImportResult {
  card: CharacterCardV3;
  format: ImportFormat;
  warnings: string[];
}

/**
 * Import a JSON object → CharacterCardV3.
 * Auto-detects format and converts.
 */
export function importCard(json: Record<string, unknown>): ImportResult {
  const format = detectFormat(json);
  const warnings: string[] = [];

  switch (format) {
    case 'v3_card': {
      const card = json as unknown as CharacterCardV3;
      // Ensure all required extensions exist
      ensureExtensions(card);
      // Auto-extract MVUZOD schema from tavern_helper scripts if not already present
      const mvuExtracted = tryExtractMvuzodFromScripts(card);
      if (mvuExtracted) {
        warnings.push('Đã tự động nhận diện và trích xuất MVUZOD schema từ scripts trong card.');
      }
      return { card: syncMirrorFields(card), format, warnings };
    }

    case 'v2_card': {
      const card = convertV2toV3(json);
      warnings.push('Card V2 đã được chuyển đổi sang V3. Kiểm tra lại extensions.');
      // Auto-extract MVUZOD schema from tavern_helper scripts if not already present
      const mvuExtractedV2 = tryExtractMvuzodFromScripts(card);
      if (mvuExtractedV2) {
        warnings.push('Đã tự động nhận diện và trích xuất MVUZOD schema từ scripts trong card.');
      }
      return { card: syncMirrorFields(card), format, warnings };
    }

    case 'standalone_lorebook': {
      const card = createEmptyCard();
      const entries = convertStandaloneEntries(json.entries as Record<string, Record<string, unknown>>);
      card.data.character_book = { name: 'Imported Lorebook', entries };
      card.data.name = 'Imported Lorebook';
      warnings.push(`Đã import ${entries.length} entries từ standalone lorebook. Cần bổ sung thông tin nhân vật.`);
      return { card: syncMirrorFields(card), format, warnings };
    }

    default:
      throw new Error('Không nhận dạng được định dạng file. Cần file V3 card, V2 card, hoặc standalone lorebook.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

/** Export full V3 card JSON */
export function exportCardV3(card: CharacterCardV3): string {
  const synced = syncMirrorFields(structuredClone(card));
  // (bug 73) Chốt chặn CHUNG cho mọi đường xuất — cả nút xuất nhanh ở TopBar lẫn Export
  // Wizard đều đi qua đây. Không có data.extensions.world thì SillyTavern để lorebook nằm
  // rời, user phải tự vào "More… → Import Card Lore" rồi tự gắn vào nhân vật.
  syncEmbeddedWorldLink(synced, card);
  return JSON.stringify(synced, null, 2);
}

/**
 * Export V2-compatible card JSON for the 'chara' PNG tEXt chunk.
 *
 * SillyTavern reads 'chara' as V2 format. The key difference is that
 * character_book.entries is a Record<string, {...}> (object with string keys)
 * instead of an Array, and field names use SillyTavern's internal conventions
 * (uid, key, keysecondary, order, disable, etc.).
 */
export function exportCardV2Compat(card: CharacterCardV3): string {
  const synced = syncMirrorFields(structuredClone(card));
  // (bug 73) Chunk 'chara' của PNG cũng phải mang sợi dây world — xem exportCardV3.
  syncEmbeddedWorldLink(synced, card);

  // Convert character_book entries to SillyTavern V2 format
  const entries = synced.data.character_book?.entries ?? [];
  const v2Entries: Record<string, Record<string, unknown>> = {};
  entries.forEach((entry, index) => {
    v2Entries[String(index)] = entryToStandalone(entry);
  });

  // Build V2-compatible card object
  const v2Card = {
    ...synced,
    data: {
      ...synced.data,
      character_book: synced.data.character_book
        ? {
            ...synced.data.character_book,
            entries: v2Entries,
          }
        : undefined,
    },
  };

  return JSON.stringify(v2Card, null, 2);
}

/** Export standalone lorebook file (spec 3.6) */
export function exportStandaloneLorebook(card: CharacterCardV3): string {
  const entries = card.data.character_book?.entries ?? [];
  const standalone: Record<string, Record<string, unknown>> = {};

  entries.forEach((entry, index) => {
    standalone[String(index)] = entryToStandalone(entry);
  });

  return JSON.stringify({ entries: standalone }, null, 2);
}

/** Export only character data (no lorebook, for quick sharing) */
export function exportCharacterOnly(card: CharacterCardV3): string {
  const synced = syncMirrorFields(structuredClone(card));
  // Remove character_book to reduce size
  // (bug 73) Bỏ sách thì phải bỏ luôn sợi dây trỏ tới nó — nếu không, file này vẫn khai
  // world "<tên sách>" và ST sẽ gắn nhân vật vào world trùng tên của card KHÁC.
  const slimCard = {
    ...synced,
    data: { ...synced.data, character_book: undefined, extensions: { ...synced.data.extensions, world: '' } },
  };
  return JSON.stringify(slimCard, null, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERTERS (internal)
// ═══════════════════════════════════════════════════════════════════════════

function convertV2toV3(json: Record<string, unknown>): CharacterCardV3 {
  const base = createEmptyCard();
  const data = json.data as Record<string, unknown> | undefined;

  if (data) {
    base.data.name = String(data.name ?? '');
    base.data.description = String(data.description ?? '');
    base.data.personality = String(data.personality ?? '');
    base.data.scenario = String(data.scenario ?? '');
    base.data.first_mes = String(data.first_mes ?? '');
    base.data.mes_example = String(data.mes_example ?? '');
    base.data.creator_notes = String(data.creator_notes ?? '');
    base.data.system_prompt = String(data.system_prompt ?? '');
    base.data.post_history_instructions = String(data.post_history_instructions ?? '');
    base.data.creator = String(data.creator ?? '');
    base.data.character_version = String(data.character_version ?? '1.0');

    if (Array.isArray(data.tags)) base.data.tags = data.tags.map(String);
    if (Array.isArray(data.alternate_greetings)) base.data.alternate_greetings = data.alternate_greetings.map(String);

    // Extensions
    const ext = data.extensions as Record<string, unknown> | undefined;
    if (ext) {
      if (ext.talkativeness !== undefined) base.data.extensions.talkativeness = String(ext.talkativeness);
      if (typeof ext.fav === 'boolean') base.data.extensions.fav = ext.fav;
      if (typeof ext.world === 'string') base.data.extensions.world = ext.world;
      if (ext.depth_prompt && typeof ext.depth_prompt === 'object') {
        const dp = ext.depth_prompt as Record<string, unknown>;
        base.data.extensions.depth_prompt = {
          prompt: String(dp.prompt ?? ''),
          depth: Number(dp.depth ?? 4),
          role: (['system', 'user', 'assistant'].includes(String(dp.role)) ? String(dp.role) : 'system') as 'system' | 'user' | 'assistant',
        };
      }
      if (Array.isArray(ext.regex_scripts)) {
        base.data.extensions.regex_scripts = ext.regex_scripts;
      }
      // Preserve tavern_helper (scripts + variables)
      if (ext.tavern_helper && typeof ext.tavern_helper === 'object') {
        const th = ext.tavern_helper as Record<string, unknown>;
        base.data.extensions.tavern_helper = {
          scripts: Array.isArray(th.scripts) ? th.scripts : [],
          variables: (th.variables && typeof th.variables === 'object') ? th.variables as Record<string, unknown> : {},
        };
      }
      // Preserve mvuzod extension if present
      if (ext.mvuzod && typeof ext.mvuzod === 'object') {
        (base.data.extensions as unknown as Record<string, unknown>).mvuzod = ext.mvuzod;
      }
    }

    // Character book
    const book = data.character_book as Record<string, unknown> | undefined;
    if (book) {
      let rawEntries: Record<string, unknown>[];
      if (Array.isArray(book.entries)) {
        // V3/modern format: entries is Array
        rawEntries = book.entries;
      } else if (book.entries && typeof book.entries === 'object') {
        // V2 format: entries is Record<string, entry>
        rawEntries = Object.values(book.entries as Record<string, Record<string, unknown>>);
      } else {
        rawEntries = [];
      }
      base.data.character_book = {
        name: String(book.name ?? base.data.name),
        entries: rawEntries.map((e, i) => convertRawEntry(e, i)),
      };
    }
  }

  // Top-level mirror fields from V2
  if (typeof json.name === 'string') base.data.name = json.name;
  if (typeof json.avatar === 'string') base.avatar = json.avatar;
  if (typeof json.create_date === 'string') base.create_date = json.create_date;

  return base;
}

function convertRawEntry(raw: Record<string, unknown>, index: number): LorebookEntry {
  const ext = (raw.extensions ?? {}) as Partial<LorebookEntryExt>;
  const extPosition = typeof ext.position === 'number' ? ext.position as LorebookEntryExt['position'] : 0;

  return {
    id: typeof raw.id === 'number' ? raw.id : index,
    keys: Array.isArray(raw.keys) ? raw.keys.map(String) : (typeof raw.key === 'string' ? [raw.key] : []),
    secondary_keys: Array.isArray(raw.secondary_keys) ? raw.secondary_keys.map(String) : [],
    comment: String(raw.comment ?? `Entry ${index}`),
    content: String(raw.content ?? ''),
    constant: Boolean(raw.constant),
    selective: raw.selective !== false,
    insertion_order: typeof raw.insertion_order === 'number' ? raw.insertion_order : 100,
    enabled: raw.enabled !== false,
    position: extPosition === 0 ? 'before_char' : 'after_char',
    use_regex: raw.use_regex !== false,
    extensions: {
      ...DEFAULT_ENTRY_EXT,
      ...ext,
      position: extPosition,
      display_index: typeof ext.display_index === 'number' ? ext.display_index : index,
    },
  };
}

function convertStandaloneEntries(entries: Record<string, Record<string, unknown>>): LorebookEntry[] {
  return Object.entries(entries).map(([, raw], index) => {
    const extPos = typeof raw.position === 'number' ? raw.position as LorebookEntryExt['position'] : 0;
    return {
      id: typeof raw.uid === 'number' ? raw.uid : index,
      keys: Array.isArray(raw.key) ? raw.key.map(String) : [],
      secondary_keys: Array.isArray(raw.keysecondary) ? raw.keysecondary.map(String) : [],
      comment: String(raw.comment ?? ''),
      content: String(raw.content ?? ''),
      constant: Boolean(raw.constant),
      selective: Boolean(raw.selective),
      insertion_order: typeof raw.order === 'number' ? raw.order : 100,
      enabled: raw.disable === true ? false : true,
      position: extPos === 0 ? 'before_char' : 'after_char',
      use_regex: true,
      extensions: {
        ...DEFAULT_ENTRY_EXT,
        position: extPos,
        selectiveLogic: typeof raw.selectiveLogic === 'number' ? raw.selectiveLogic as 0|1|2|3 : 0,
        depth: typeof raw.depth === 'number' ? raw.depth : 4,
        probability: typeof raw.probability === 'number' ? raw.probability : 100,
        useProbability: raw.useProbability !== false,
        group: typeof raw.group === 'string' ? raw.group : '',
        group_override: Boolean(raw.groupOverride),
        group_weight: typeof raw.groupWeight === 'number' ? raw.groupWeight : 100,
        prevent_recursion: Boolean(raw.preventRecursion),
        exclude_recursion: Boolean(raw.excludeRecursion),
        delay_until_recursion: Boolean(raw.delayUntilRecursion),
        ignore_budget: Boolean(raw.ignoreBudget),
        vectorized: Boolean(raw.vectorized),
        sticky: typeof raw.sticky === 'number' ? raw.sticky : 0,
        cooldown: typeof raw.cooldown === 'number' ? raw.cooldown : 0,
        delay: typeof raw.delay === 'number' ? raw.delay : 0,
        scan_depth: typeof raw.scanDepth === 'number' ? raw.scanDepth : null,
        case_sensitive: typeof raw.caseSensitive === 'boolean' ? raw.caseSensitive : null,
        match_whole_words: typeof raw.matchWholeWords === 'boolean' ? raw.matchWholeWords : null,
        outlet_name: typeof raw.outletName === 'string' ? raw.outletName : '',
        role: typeof raw.role === 'number' ? raw.role as 0|1|2 : null,
        display_index: typeof raw.displayIndex === 'number' ? raw.displayIndex : 0,
        automation_id: typeof raw.automationId === 'string' ? raw.automationId : '',
        triggers: Array.isArray(raw.triggers) ? raw.triggers : [],
        use_group_scoring: Boolean(raw.useGroupScoring),
        match_persona_description: Boolean(raw.matchPersonaDescription),
        match_character_description: Boolean(raw.matchCharacterDescription),
        match_character_personality: Boolean(raw.matchCharacterPersonality),
        match_character_depth_prompt: Boolean(raw.matchCharacterDepthPrompt),
        match_scenario: Boolean(raw.matchScenario),
        match_creator_notes: Boolean(raw.matchCreatorNotes),
      },
    };
  });
}

function entryToStandalone(entry: LorebookEntry): Record<string, unknown> {
  const e = entry.extensions;
  return {
    uid: entry.id,
    key: entry.keys,
    keysecondary: entry.secondary_keys,
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    vectorized: e.vectorized,
    selective: entry.selective,
    selectiveLogic: e.selectiveLogic,
    addMemo: true,
    order: entry.insertion_order,
    position: e.position,
    disable: !entry.enabled,
    ignoreBudget: e.ignore_budget,
    excludeRecursion: e.exclude_recursion,
    preventRecursion: e.prevent_recursion,
    matchPersonaDescription: e.match_persona_description,
    matchCharacterDescription: e.match_character_description,
    matchCharacterPersonality: e.match_character_personality,
    matchCharacterDepthPrompt: e.match_character_depth_prompt,
    matchScenario: e.match_scenario,
    matchCreatorNotes: e.match_creator_notes,
    delayUntilRecursion: e.delay_until_recursion,
    probability: e.probability,
    useProbability: e.useProbability,
    depth: e.depth,
    outletName: e.outlet_name,
    group: e.group,
    groupOverride: e.group_override,
    groupWeight: e.group_weight,
    scanDepth: e.scan_depth,
    caseSensitive: e.case_sensitive,
    matchWholeWords: e.match_whole_words,
    useGroupScoring: e.use_group_scoring,
    automationId: e.automation_id,
    role: e.role,
    sticky: e.sticky,
    cooldown: e.cooldown,
    delay: e.delay,
    triggers: e.triggers,
    displayIndex: e.display_index,
    characterFilter: { isExclude: false, names: [], tags: [] },
  };
}

function ensureExtensions(card: CharacterCardV3) {
  if (!card.data.extensions) {
    card.data.extensions = {
      talkativeness: '0.5', fav: false, world: '',
      depth_prompt: { prompt: '', depth: 4, role: 'system' },
      tavern_helper: { scripts: [], variables: {} },
      regex_scripts: [],
    };
  }
  if (!card.data.extensions.tavern_helper) {
    card.data.extensions.tavern_helper = { scripts: [], variables: {} };
  }
  if (!card.data.extensions.regex_scripts) {
    card.data.extensions.regex_scripts = [];
  }
  if (!card.data.extensions.depth_prompt) {
    card.data.extensions.depth_prompt = { prompt: '', depth: 4, role: 'system' };
  }
  if (!card.data.character_book) {
    card.data.character_book = { name: card.data.name, entries: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MVUZOD AUTO-EXTRACTION FROM TAVERN SCRIPTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Try to extract MVUZODSchema from tavern_helper scripts in the card.
 * If the card already has extensions.mvuzod.schema, skip.
 * Returns true if schema was successfully extracted and set.
 */
function tryExtractMvuzodFromScripts(card: CharacterCardV3): boolean {
  const ext = card.data.extensions as unknown as Record<string, unknown>;
  
  // Skip if mvuzod.schema already exists
  const existingMvuzod = ext?.mvuzod as Record<string, unknown> | undefined;
  if (existingMvuzod?.schema) return false;
  
  // Get tavern_helper scripts
  const th = ext?.tavern_helper as Record<string, unknown> | undefined;
  const scripts = (th?.scripts ?? []) as Array<{ name: string; content: string; enabled?: boolean }>;
  if (!scripts.length) return false;
  
  // Find MVU schema script
  for (const script of scripts) {
    if (!script.name || !script.content) continue;
    if (!isMvuSchemaScript(script.name, script.content)) continue;
    
    // Try to parse Zod code into MVUZODSchema
    const schema = parseZodCodeToSchema(script.content);
    if (schema && schema.fields.length > 0) {
      // Set the schema into extensions.mvuzod
      ext.mvuzod = {
        ...(existingMvuzod ?? {}),
        schema,
      };
      card.data.extensions = ext as unknown as CardExtensions;
      return true;
    }
  }
  
  return false;
}
