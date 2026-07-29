/**
 * Card defaults — spec Phụ Lục B
 * createEmptyCard(), syncMirrorFields(), materializeEntry()
 */

import type { CharacterCardV3 } from '../../types/card.types';
import type { LorebookEntry } from '../../types/lorebook.types';
import type { AIGeneratedEntry } from '../../types/aiAgent.types';
import { DEFAULT_ENTRY_EXT } from '../../types/lorebook.types';
import { getPreset, lockedFieldsOf, type EntryCategory, type CardType, type LockableField } from '../worldbook/worldbookConfig';

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
  /** Keys hiểu như regex hay chuỗi thường. Mặc định true (giữ hành vi cũ). */
  useRegex?: boolean;
  /**
   * (lõi lorebook) CƠ HỌC DO CALLER TỰ QUYẾT — bỏ qua preset và bỏ qua cả AI.
   *
   * Dành cho đường sinh entry có TAXONOMY RIÊNG. Ví dụ `storyDeepScan` phân loại theo chuẩn
   * worldbook của user (Group 1-5: meta/worldview/timeline/character/faction/location, order
   * 900/800/200/150/100) — khác hẳn taxonomy của worldbookConfig vốn xoay quanh thẻ đơn/nhiều
   * nhân vật. Ép hai bên dùng chung một bảng phân loại là phá mất cái đúng của cả hai.
   *
   * Tách như vậy để: PHẦN PHÂN LOẠI được phép khác nhau, còn PHẦN ỐNG NƯỚC (chống đệ quy, cờ
   * disable đi cùng enabled, DEFAULT_ENTRY_EXT, display_index, đồng bộ position số ↔ chuỗi) thì
   * dùng chung — sửa một chỗ là mọi đường sinh entry được hưởng.
   */
  placement?: {
    constant: boolean;
    selective: boolean;
    position: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    depth: number;
    role: 0 | 1 | 2 | null;
    insertion_order: number;
    scan_depth?: number | null;
    /**
     * Chuỗi `position` của định dạng V3. Với entry @depth (position số = 4) thì cả
     * 'before_char' lẫn 'after_char' đều không diễn tả đúng — ST đọc `extensions.position`,
     * chuỗi này chỉ là đường lui cho bộ đọc cũ. Cho caller tự chọn thay vì suy ngầm, vì suy
     * ngầm sẽ lặng lẽ đổi hành vi của những đường sinh entry đã chạy đúng từ trước.
     */
    positionName?: LorebookEntry['position'];
  };
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

  // ═══ THỨ TỰ ƯU TIÊN ═══
  //   trường BỊ KHOÁ:  người dùng > preset            (BỎ QUA giá trị AI)
  //   trường tự do:    AI > người dùng > preset > mặc định
  //
  // Trước đây AI thắng tất, kể cả `constant`/`selective` — mà đó là thứ phụ thuộc CẤU TRÚC THẺ
  // (thẻ đơn thường trú, thẻ nhiều nhân vật kích hoạt theo từ khoá), thứ AI không thể biết vì nó
  // chỉ nhìn thấy nội dung MỘT entry. Prompt vẫn ghi "CẤU HÌNH BẮT BUỘC: constant=true…" rồi tin
  // AI làm đúng — nhờ vả chứ không phải ép. Nay ép thật; xem lockedFieldsOf() để biết vì sao.
  // Người dùng vẫn đè được qua config: khoá này chỉ chặn AI, không chặn user.
  const locked = new Set(config.category ? lockedFieldsOf(config.category) : []);
  const pick = <T>(field: LockableField, aiVal: T | undefined, cfgVal: T | undefined, presetVal: T | undefined, fallback: T): T =>
    (locked.has(field)
      ? (cfgVal ?? presetVal ?? fallback)
      : (aiVal ?? cfgVal ?? presetVal ?? fallback));

  // `placement` là quyết định TƯỜNG MINH của caller (taxonomy riêng) → thắng cả preset lẫn AI.
  const pl = config.placement;
  const posExt = pl ? pl.position : pick('position', ai.position, config.defaultPosition, preset?.defaults.position, 0);
  const constant = pl ? pl.constant : pick('constant', ai.constant, undefined, preset?.defaults.constant, false);
  const selective = pl ? pl.selective : pick('selective', ai.selective, undefined, preset?.defaults.selective, true);
  const depth = pl ? pl.depth : pick('depth', ai.depth, config.defaultDepth, preset?.defaults.depth, 4);
  // role dùng `!== undefined` vì null LÀ giá trị hợp lệ (không gán role) — `??` sẽ nuốt mất null.
  const role = pl
    ? pl.role
    : locked.has('role')
      ? (config.defaultRole !== undefined ? config.defaultRole : (preset?.defaults.role ?? null))
      : (ai.role !== undefined ? ai.role : (config.defaultRole ?? preset?.defaults.role ?? null));
  const scanDepth = pl
    ? (pl.scan_depth ?? null)
    : (ai.scan_depth ?? config.scanDepth ?? preset?.defaults.scan_depth ?? 2);
  const insertionOrder = pl
    ? pl.insertion_order
    : (ai.insertion_order ?? config.insertionOrderStart ?? preset?.defaults.insertion_order ?? 100);

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
    position: pl?.positionName ?? (posExt === 0 ? 'before_char' : 'after_char'),
    use_regex: config.useRegex ?? true,
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
