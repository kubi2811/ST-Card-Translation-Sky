/**
 * (User 22/07 — bug 74) Xuất kèm file World Info rời để SillyTavern tự gắn lorebook.
 *
 * ═══ Vì sao cần ═══
 *
 * ST KHÔNG BAO GIỜ tự import lorebook nhúng — nó chỉ MỜI, và chỉ nhắc MỘT LẦN cho mỗi card
 * (nhớ theo tên file avatar trong accountStorage). Nhưng `checkEmbeddedWorld` bỏ qua lời mời
 * khi world đã tồn tại:
 *
 *     const worldName = characters[chid]?.data?.extensions?.world;
 *     if (!alertShown && (!worldName || !world_names.includes(worldName))) { …mời… }
 *
 * Nên nếu user nạp file world TRƯỚC rồi mới import card, `world_names.includes(world)` thành
 * true ⇒ ST im lặng gắn luôn, không popup, không phải "add lại". Đây là cách duy nhất né được
 * cả thao tác thủ công lẫn lỗi popup của ST (luồng popup thiếu saveCharacterDebounced nên liên
 * kết chưa kịp ghi xuống đĩa).
 *
 * ═══ Hợp đồng ═══
 *
 * File phải GIỐNG HỆT cái ST tự tạo qua "Import Card Lore", nếu không world sinh ra sẽ khác.
 * Mọi ánh xạ dưới đây chép đúng theo `convertCharacterBook` (public/scripts/world-info.js:5498)
 * và mặc định lấy từ `newWorldInfoEntryDefinition` (cùng file, :4003).
 */

/** Mặc định của một entry World Info — chép từ newWorldInfoEntryDefinition của ST. */
const WI_ENTRY_TEMPLATE: Record<string, unknown> = {
  key: [], keysecondary: [], comment: '', content: '',
  constant: false, vectorized: false, selective: true, selectiveLogic: 0,
  addMemo: false, order: 100, position: 0, disable: false,
  ignoreBudget: false, excludeRecursion: false, preventRecursion: false,
  matchPersonaDescription: false, matchCharacterDescription: false,
  matchCharacterPersonality: false, matchCharacterDepthPrompt: false,
  matchScenario: false, matchCreatorNotes: false,
  delayUntilRecursion: 0, probability: 100, useProbability: true,
  depth: 4, outletName: '', group: '', groupOverride: false, groupWeight: 100,
  scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
  automationId: '', role: 0, sticky: null, cooldown: null, delay: null, triggers: [],
};

type AnyObj = Record<string, unknown>;

const obj = (v: unknown): AnyObj | null => (v && typeof v === 'object' ? (v as AnyObj) : null);

export interface WorldInfoFile {
  entries: Record<string, AnyObj>;
  originalData?: unknown;
}

/**
 * Đổi `data.character_book` của thẻ thành file World Info mà ST nạp được.
 *
 * Trả về `null` khi thẻ không có lorebook nhúng — gọi phía ngoài đừng tạo file rỗng.
 */
export function characterBookToWorldInfo(card: unknown): WorldInfoFile | null {
  const data = obj(obj(card)?.data);
  const book = obj(data?.character_book);
  const rawEntries = book?.entries;
  if (!book || !Array.isArray(rawEntries) || rawEntries.length === 0) return null;

  const entries: Record<string, AnyObj> = {};

  rawEntries.forEach((raw, index) => {
    const e = obj(raw);
    if (!e) return;
    const ext = obj(e.extensions) ?? {};
    // ST tự gán id theo thứ tự khi entry thiếu id — làm y hệt để uid khớp.
    const id = typeof e.id === 'number' ? e.id : index;
    const num = (v: unknown, fallback: number | null): number | null =>
      typeof v === 'number' ? v : fallback;

    entries[String(id)] = {
      ...WI_ENTRY_TEMPLATE,
      uid: id,
      key: Array.isArray(e.keys) ? e.keys : [],
      keysecondary: Array.isArray(e.secondary_keys) ? e.secondary_keys : [],
      comment: e.comment ?? '',
      content: e.content ?? '',
      constant: e.constant ?? false,
      selective: e.selective ?? false,
      order: e.insertion_order,
      position: ext.position ?? (e.position === 'before_char' ? 0 : 1),
      excludeRecursion: ext.exclude_recursion ?? false,
      preventRecursion: ext.prevent_recursion ?? false,
      delayUntilRecursion: ext.delay_until_recursion ?? false,
      // Cờ NGƯỢC nghĩa: `enabled: false` (vd entry [initvar]) phải thành `disable: true`.
      disable: !e.enabled,
      addMemo: !!e.comment,
      displayIndex: num(ext.display_index, index),
      probability: ext.probability ?? 100,
      useProbability: ext.useProbability ?? true,
      depth: ext.depth ?? 4,
      selectiveLogic: ext.selectiveLogic ?? 0,
      outletName: ext.outlet_name ?? '',
      group: ext.group ?? '',
      groupOverride: ext.group_override ?? false,
      groupWeight: ext.group_weight ?? 100,
      scanDepth: ext.scan_depth ?? null,
      caseSensitive: ext.case_sensitive ?? null,
      matchWholeWords: ext.match_whole_words ?? null,
      useGroupScoring: ext.use_group_scoring ?? null,
      automationId: ext.automation_id ?? '',
      role: ext.role ?? 0,
      vectorized: ext.vectorized ?? false,
      sticky: ext.sticky ?? null,
      cooldown: ext.cooldown ?? null,
      delay: ext.delay ?? null,
      matchPersonaDescription: ext.match_persona_description ?? false,
      matchCharacterDescription: ext.match_character_description ?? false,
      matchCharacterPersonality: ext.match_character_personality ?? false,
      matchCharacterDepthPrompt: ext.match_character_depth_prompt ?? false,
      matchScenario: ext.match_scenario ?? false,
      matchCreatorNotes: ext.match_creator_notes ?? false,
      extensions: ext,
      triggers: Array.isArray(ext.triggers) ? ext.triggers : [],
      ignoreBudget: ext.ignore_budget ?? false,
    };
  });

  if (Object.keys(entries).length === 0) return null;
  // ST giữ luôn bản gốc trong `originalData` — chép theo để file trùng khít.
  return { entries, originalData: book };
}

/**
 * Tên file world. ST lưu bằng `sanitize(name + '.json')` nên tên đã được
 * `sanitizeWorldName` xử lý từ trước (xem worldLink.ts) — ở đây chỉ ghép đuôi.
 */
export function worldInfoFileName(worldName: string): string {
  return `${worldName || 'Lorebook'}.json`;
}
