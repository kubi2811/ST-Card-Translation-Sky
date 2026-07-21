/**
 * Card defaults — spec Phụ Lục B
 * createEmptyCard(), syncMirrorFields(), materializeEntry()
 */

import type { CharacterCardV3 } from '../../types/card.types';
import type { LorebookEntry } from '../../types/lorebook.types';
import type { AIGeneratedEntry } from '../../types/aiAgent.types';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import { getPreset, type EntryCategory, type CardType } from '../worldbook/worldbookConfig';

export function createEmptyCard(): CharacterCardV3 {
  const now = new Date().toISOString();
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    name: 'New Character',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creatorcomment: '',
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: [],
    create_date: now,
    data: {
      name: 'New Character',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator: '',
      character_version: '1.0',
      alternate_greetings: [],
      extensions: {
        talkativeness: '0.5',
        fav: false,
        world: '',
        depth_prompt: { prompt: '', depth: 4, role: 'system' },
        tavern_helper: { scripts: [], variables: {} },
        regex_scripts: [],
      },
      character_book: { name: 'New Character', entries: [] },
    },
  };
}

export interface MaterializeConfig {
  category?: EntryCategory;   // loại entry theo guide worldbook
  cardType?: CardType;        // thẻ đơn vs nhiều nhân vật
  defaultPosition?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  defaultDepth?: number;
  defaultRole?: 0 | 1 | 2 | null;
  insertionOrderStart?: number;
  scanDepth?: number | null;
  /** (bug 72) Entry hệ thống như [initvar] phải TẮT — MVU đọc nó làm template, không phải lore. */
  enabled?: boolean;
}

export function materializeEntry(
  ai: AIGeneratedEntry,
  config: MaterializeConfig,
  id: number
): LorebookEntry {
  // Lookup preset nếu có category
  const preset = config.category && config.category !== 'custom'
    ? getPreset(config.category, config.cardType ?? 'single')
    : undefined;

  // Priority: AI per-entry > config default > preset > fallback
  const posExt = ai.position ?? config.defaultPosition ?? preset?.defaults.position ?? 0;
  const constant = ai.constant ?? preset?.defaults.constant ?? false;
  const selective = ai.selective ?? preset?.defaults.selective ?? true;
  const depth = ai.depth ?? config.defaultDepth ?? preset?.defaults.depth ?? 4;
  const role = ai.role !== undefined ? ai.role : (config.defaultRole ?? preset?.defaults.role ?? null);
  const scanDepth = ai.scan_depth ?? config.scanDepth ?? preset?.defaults.scan_depth ?? 2;
  const insertionOrder = ai.insertion_order
    ?? config.insertionOrderStart
    ?? preset?.defaults.insertion_order
    ?? 100;

  return {
    id,
    keys: ai.keys,
    secondary_keys: ai.secondary_keys ?? [],
    comment: ai.comment,
    content: ai.content,
    constant,
    selective,
    insertion_order: insertionOrder,
    enabled: config.enabled ?? true,
    // SillyTavern đọc cờ `disable` (ngược nghĩa `enabled`) — trước đây không nơi nào ghi ra
    // nên entry tắt vẫn xuất ra file ở trạng thái bật.
    disable: !(config.enabled ?? true),
    position: posExt === 0 ? 'before_char' : 'after_char',
    use_regex: true,
    extensions: {
      ...DEFAULT_ENTRY_EXT,
      position: posExt,
      depth,
      role,
      scan_depth: scanDepth,
      display_index: id,
      // ENFORCE: đệ quy luôn bật — guide: "không cần nghĩ, cứ tick hết"
      exclude_recursion: true,
      prevent_recursion: true,
    },
  };
}

/**
 * Đồng bộ mirror fields — PHẢI chạy trước mỗi lần lưu DB và export.
 * talkativeness LUÔN là string.
 */
export function syncMirrorFields(card: CharacterCardV3): CharacterCardV3 {
  card.name = card.data.name;
  card.description = card.data.description;
  card.personality = card.data.personality;
  card.scenario = card.data.scenario;
  card.first_mes = card.data.first_mes;
  card.mes_example = card.data.mes_example;
  card.creatorcomment = card.data.creator_notes;
  card.tags = [...card.data.tags];
  card.fav = card.data.extensions.fav;
  // talkativeness phải luôn là STRING
  card.talkativeness = String(card.data.extensions.talkativeness);
  card.data.extensions.talkativeness = String(card.data.extensions.talkativeness);
  return card;
}

/**
 * Tìm ID tiếp theo cho entry mới
 */
export function nextEntryId(entries: LorebookEntry[]): number {
  if (entries.length === 0) return 0;
  return Math.max(...entries.map(e => e.id)) + 1;
}
