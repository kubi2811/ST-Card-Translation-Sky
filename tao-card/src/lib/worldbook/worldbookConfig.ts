/**
 * worldbookConfig.ts — Entry Category System + Presets
 * Theo "Hướng dẫn worldbook" guide: chiến lược kích hoạt, vị trí, thứ tự, đệ quy
 */

// ⚠️ `label`/`description` của ENTRY_CATEGORY_LABELS + preset đi vào PROMPT AI
// (lib/ai/batchGenerator.ts nhét `catLabel.label` vào lệnh) → KHÔNG i18n hoá.
// Chỉ `getStrategyLabel()` và `keywordHint` là chuỗi hiển thị thuần → dịch qua ui.
import { t as ui } from '../../i18n';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Phân loại entry theo guide Worldbook */
export type EntryCategory =
  | 'worldview'              // Thế giới quan / Thiết lập bối cảnh
  | 'region_overview'        // Xem lướt khu vực
  | 'character_overview'     // Xem lướt nhân vật
  | 'character_detail'       // Thông tin chi tiết nhân vật cốt lõi
  | 'npc'                    // NPC
  | 'scene'                  // Cảnh vật / Sự kiện
  | 'secondary_explanation'  // Giải thích lần hai (D0)
  // ═══ Minh Nguyệt categories ═══
  | 'color_palette'          // Bảng điều sắc tính cách
  | 'three_faces'            // Ba diện tính
  | 'wardrobe'               // Tủ quần áo
  | 'nsfw_palette'           // Bảng NSFW
  | 'opening'                // Khai bạch
  | 'custom';                // Tuỳ chỉnh tự do

/** Đường thế giới quan Minh Nguyệt */
export type WorldviewPath = 'real_background' | 'small_world' | 'large_world';

/** Loại thẻ: đơn nhân vật vs nhiều nhân vật */
export type CardType = 'single' | 'multi';

/** Config presets cho mỗi loại entry */
export interface CategoryPreset {
  label: string;
  labelVi: string;
  icon: string;
  description: string;
  defaults: {
    constant: boolean;
    selective: boolean;
    position: 0 | 1 | 4;
    depth: number;
    role: 0 | 1 | 2 | null;
    insertion_order: number;
    scan_depth: number | null;
    exclude_recursion: true;
    prevent_recursion: true;
  };
  keywordHint: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// LABELS
// ═══════════════════════════════════════════════════════════════════════════

export const ENTRY_CATEGORY_LABELS: Record<EntryCategory, { label: string; icon: string }> = {
  worldview:              { label: 'Thế giới quan / Bối cảnh',     icon: '🌍' },
  region_overview:        { label: 'Xem lướt khu vực',             icon: '🗺' },
  character_overview:     { label: 'Xem lướt nhân vật',            icon: '👥' },
  character_detail:       { label: 'Chi tiết nhân vật cốt lõi',    icon: '🧑' },
  npc:                    { label: 'NPC',                          icon: '🤝' },
  scene:                  { label: 'Cảnh vật / Sự kiện',           icon: '🏞' },
  secondary_explanation:  { label: 'Giải thích lần hai (D0)',      icon: '🎯' },
  // Minh Nguyệt
  color_palette:          { label: 'Bảng điều sắc tính cách',      icon: '🎨' },
  three_faces:            { label: 'Ba diện tính',                 icon: '🎭' },
  wardrobe:               { label: 'Tủ quần áo',                   icon: '👗' },
  nsfw_palette:           { label: 'Bảng NSFW',                    icon: '🔞' },
  opening:                { label: 'Khai bạch',                    icon: '📜' },
  custom:                 { label: 'Tuỳ chỉnh tự do',             icon: '⚙️' },
};

export const WORLDVIEW_PATH_LABELS: Record<WorldviewPath, { label: string; desc: string }> = {
  real_background: { label: 'Đường A: Bối cảnh thực', desc: 'AI đã biết — chỉ cần ghi chú khác biệt' },
  small_world:    { label: 'Đường B: Thế giới nhỏ',  desc: 'AI biết cơ bản, cần tùy chỉnh chi tiết' },
  large_world:    { label: 'Đường C: Thế giới lớn',  desc: 'Nguyên tạo/phức tạp — cần worldbook đầy đủ' },
};

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  single: 'Nhân vật đơn (1 nhân vật cốt lõi)',
  multi: 'Nhiều nhân vật (2+ nhân vật cốt lõi)',
};

// ═══════════════════════════════════════════════════════════════════════════
// PRESETS — Thẻ nhân vật ĐƠN (single)
// Guide: "Thẻ nhân vật đơn, tất cả mục toàn bộ đèn xanh dương. Quy luật thép."
// ═══════════════════════════════════════════════════════════════════════════

export const SINGLE_CARD_PRESETS: Record<Exclude<EntryCategory, 'custom'>, CategoryPreset> = {
  worldview: {
    label: 'Worldview',
    labelVi: 'Thế giới quan / Bối cảnh',
    icon: '🌍',
    description: 'Tổng cương thế giới, bối cảnh, quy tắc. Luôn thường trú (đèn xanh dương).',
    defaults: {
      constant: true,
      selective: false,
      position: 0,           // before_char
      depth: 4,
      role: null,
      insertion_order: 1,
      scan_depth: null,       // constant → không cần scan
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú → không cần từ khóa.',
  },

  region_overview: {
    label: 'Region Overview',
    labelVi: 'Xem lướt khu vực',
    icon: '🗺',
    description: 'Liệt kê khu vực + 1 câu định vị. Thường trú.',
    defaults: {
      constant: true,
      selective: false,
      position: 0,
      depth: 4,
      role: null,
      insertion_order: 2,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú → không cần từ khóa.',
  },

  character_overview: {
    label: 'Character Overview',
    labelVi: 'Xem lướt nhân vật',
    icon: '👥',
    description: 'Giới thiệu vắn tắt tất cả nhân vật. Thường trú.',
    defaults: {
      constant: true,
      selective: false,
      position: 0,
      depth: 4,
      role: null,
      insertion_order: 4,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú → không cần từ khóa.',
  },

  character_detail: {
    label: 'Character Detail',
    labelVi: 'Chi tiết nhân vật cốt lõi',
    icon: '🧑',
    // Thẻ đơn: QUY LUẬT THÉP — toàn bộ constant!
    description: '⚡ QUY LUẬT THÉP: Thẻ đơn → tất cả mục nhân vật PHẢI thường trú (đèn xanh dương).',
    defaults: {
      constant: true,         // QUY LUẬT THÉP cho thẻ đơn!
      selective: false,
      position: 1,            // after_char
      depth: 4,
      role: null,
      insertion_order: 99,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú (thẻ đơn) → không cần từ khóa.',
  },

  npc: {
    label: 'NPC',
    labelVi: 'NPC',
    icon: '🤝',
    description: 'Vai phụ, tải theo nhu cầu. Từ khóa = tên + biệt danh + chức vụ.',
    defaults: {
      constant: false,
      selective: true,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 100,
      scan_depth: 2,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Tên đầy đủ, biệt danh, ngoại hiệu, chức vụ. VD: "Vương Tĩnh,Cô giáo Vương,Giáo viên chủ nhiệm"',
  },

  scene: {
    label: 'Scene/Event',
    labelVi: 'Cảnh vật / Sự kiện',
    icon: '🏞',
    description: 'Tải theo nhu cầu. Từ khóa = tên địa danh + tên gọi khác + hành động liên quan.',
    defaults: {
      constant: false,
      selective: true,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 80,
      scan_depth: 2,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Tên cảnh vật, địa danh, tên gọi khác, hành động. VD: "Thư viện,Thư viện trường,Mượn sách"',
  },

  secondary_explanation: {
    label: 'Secondary Explanation (D0)',
    labelVi: 'Giải thích lần hai (D0)',
    icon: '🎯',
    description: 'Chỉ đạo AI — vị trí D0, role=system. Sức ảnh hưởng mạnh nhất.',
    defaults: {
      constant: false,        // xanh lá — chỉ kích hoạt khi nhắc đến nhân vật
      selective: true,
      position: 4,            // @depth
      depth: 0,               // D0 — cuối cùng AI đọc
      role: 0,                // system
      insertion_order: 1,
      scan_depth: 2,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Tên nhân vật cần điều chỉnh. VD: "Lâm Tiểu Vũ,Tiểu Vũ"',
  },

  // ═══ Minh Nguyệt categories ═══
  color_palette: {
    label: 'Color Palette',
    labelVi: 'Bảng điều sắc tính cách',
    icon: '🎨',
    description: 'Màu nền + Chủ sắc + Phái sinh + Điểm xuyết. Thường trú (thẻ đơn).',
    defaults: {
      constant: true,
      selective: false,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 30,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú (thẻ đơn) → không cần từ khóa.',
  },

  three_faces: {
    label: 'Three Faces',
    labelVi: 'Ba diện tính',
    icon: '🎭',
    description: 'Diện công khai + Riêng tư + Mặt nạ. Tùy chọn.',
    defaults: {
      constant: true,
      selective: false,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 35,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú (thẻ đơn) → không cần từ khóa.',
  },

  wardrobe: {
    label: 'Wardrobe',
    labelVi: 'Tủ quần áo',
    icon: '👗',
    description: 'Bộ trang phục theo ngữ cảnh (thường ngày, formal, chiến đấu...). Thường trú.',
    defaults: {
      constant: true,
      selective: false,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 40,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Entry thường trú (thẻ đơn) → không cần từ khóa.',
  },

  nsfw_palette: {
    label: 'NSFW Palette',
    labelVi: 'Bảng NSFW',
    icon: '🔞',
    description: 'Bảng điều sắc NSFW. Xanh lá, kích hoạt bằng từ khóa.',
    defaults: {
      constant: false,
      selective: true,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 50,
      scan_depth: 2,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Tên nhân vật + từ khóa NSFW.',
  },

  opening: {
    label: 'Opening',
    labelVi: 'Khai bạch',
    icon: '📜',
    description: 'Lời mở đầu — first_mes + alternate greetings.',
    defaults: {
      constant: false,
      selective: false,
      position: 0,
      depth: 4,
      role: null,
      insertion_order: 999,
      scan_depth: null,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Khai bạch không dùng keyword — chỉ là first message.',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PRESETS — Thẻ NHIỀU nhân vật (multi)
// Guide: "Xem lướt = xanh dương, Chi tiết = xanh lá"
// ═══════════════════════════════════════════════════════════════════════════

export const MULTI_CARD_PRESETS: Record<Exclude<EntryCategory, 'custom'>, CategoryPreset> = {
  // worldview, region_overview, character_overview — giống thẻ đơn
  worldview:          { ...SINGLE_CARD_PRESETS.worldview },
  region_overview:    { ...SINGLE_CARD_PRESETS.region_overview },
  character_overview: { ...SINGLE_CARD_PRESETS.character_overview },

  character_detail: {
    label: 'Character Detail',
    labelVi: 'Chi tiết nhân vật cốt lõi',
    icon: '🧑',
    description: 'Thẻ nhiều NV → xanh lá, kích hoạt bằng từ khóa. Chỉ tải khi nhắc đến.',
    defaults: {
      constant: false,        // Khác thẻ đơn: xanh LÁ
      selective: true,
      position: 1,
      depth: 4,
      role: null,
      insertion_order: 99,
      scan_depth: 2,
      exclude_recursion: true,
      prevent_recursion: true,
    },
    keywordHint: 'Tên nhân vật + biệt danh + ngoại hiệu. VD: "Thu Minh Nguyệt,Minh Nguyệt,Nguyệt Nguyệt,Chị Thu"',
  },

  npc: { ...SINGLE_CARD_PRESETS.npc },
  scene: { ...SINGLE_CARD_PRESETS.scene },

  secondary_explanation: {
    ...SINGLE_CARD_PRESETS.secondary_explanation,
    description: 'Chỉ đạo AI — D0, role=system. Dùng xanh lá, kích hoạt bằng tên nhân vật.',
    defaults: {
      ...SINGLE_CARD_PRESETS.secondary_explanation.defaults,
      insertion_order: 1,
    },
  },

  // MN categories — multi card: chuyển sang selective
  color_palette: {
    ...SINGLE_CARD_PRESETS.color_palette,
    description: 'Thẻ nhiều NV: bảng điều sắc theo từ khóa.',
    defaults: { ...SINGLE_CARD_PRESETS.color_palette.defaults, constant: false, selective: true, scan_depth: 2 },
  },
  three_faces: {
    ...SINGLE_CARD_PRESETS.three_faces,
    defaults: { ...SINGLE_CARD_PRESETS.three_faces.defaults, constant: false, selective: true, scan_depth: 2 },
  },
  wardrobe: {
    ...SINGLE_CARD_PRESETS.wardrobe,
    defaults: { ...SINGLE_CARD_PRESETS.wardrobe.defaults, constant: false, selective: true, scan_depth: 2 },
  },
  nsfw_palette: { ...SINGLE_CARD_PRESETS.nsfw_palette },
  opening: { ...SINGLE_CARD_PRESETS.opening },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lấy preset đúng dựa trên cardType + category.
 * Trả về undefined nếu category='custom'.
 */
export function getPreset(
  category: EntryCategory,
  cardType: CardType,
): CategoryPreset | undefined {
  if (category === 'custom') return undefined;
  return cardType === 'single'
    ? SINGLE_CARD_PRESETS[category]
    : MULTI_CARD_PRESETS[category];
}

// ═══════════════════════════════════════════════════════════════════════════
// TRƯỜNG BỊ KHOÁ — AI KHÔNG ĐƯỢC ĐÈ LÊN PRESET
// ═══════════════════════════════════════════════════════════════════════════

/** Trường cơ học có thể khoá lại, không cho AI tự quyết. */
export type LockableField = 'constant' | 'selective' | 'position' | 'depth' | 'role';

/**
 * Vì sao phải khoá `constant`/`selective` cho MỌI category:
 *
 * Chiến lược kích hoạt là thứ khác nhau giữa THẺ ĐƠN và THẺ NHIỀU NHÂN VẬT — xem
 * `character_detail`: thẻ đơn `constant: true` (quy luật thép), thẻ nhiều `constant: false`.
 * Giá trị đúng phụ thuộc vào CẤU TRÚC THẺ, thứ mà hệ preset biết còn AI thì không: AI chỉ
 * nhìn thấy nội dung một entry, không biết thẻ này có mấy nhân vật cốt lõi.
 *
 * Mà trước đây `materializeEntry` cho AI thắng preset (`ai.constant ?? preset...`). Prompt thì
 * viết "CẤU HÌNH BẮT BUỘC: constant=true, selective=false" rồi TIN AI làm đúng — nhờ vả chứ
 * không phải ép. Khoá lại chỉ là làm cho hành vi khớp với ý định vốn đã tuyên bố sẵn.
 *
 * Người dùng thì VẪN được quyền đè (config.defaultPosition/Depth/Role) — khoá này chỉ chặn AI.
 */
const DEFAULT_LOCKED: LockableField[] = ['constant', 'selective'];

/** Khoá thêm cho category mà cơ học CHÍNH LÀ định nghĩa của nó. */
const EXTRA_LOCKED: Partial<Record<EntryCategory, LockableField[]>> = {
  // D0 = "@depth 0, role system". AI đổi depth/role thì nó không còn là D0 nữa,
  // chỉ còn cái tên — hỏng âm thầm, vì entry vẫn hợp lệ và vẫn nạp được.
  secondary_explanation: ['position', 'depth', 'role'],
};

/** Trường mà AI KHÔNG được đè lên preset, theo category. */
export function lockedFieldsOf(category: EntryCategory): LockableField[] {
  if (category === 'custom') return [];   // custom = user tự cầm lái hoàn toàn
  return [...DEFAULT_LOCKED, ...(EXTRA_LOCKED[category] ?? [])];
}

/**
 * Mô tả chiến lược kích hoạt dạng label ngắn gọn.
 */
export function getStrategyLabel(constant: boolean, selective: boolean): {
  label: string;
  icon: string;
  color: string;
} {
  if (constant) {
    return { label: ui.wbStratConstant, icon: '🔵', color: 'text-blue-400' };
  }
  if (selective) {
    return { label: ui.wbStratSelective, icon: '🟢', color: 'text-emerald-400' };
  }
  return { label: ui.wbStratNone, icon: '⚪', color: 'text-muted-foreground' };
}

/** Bảng tra keywordHint (chuỗi VI gốc) → i18n. Dùng ở panel thay cho preset.keywordHint. */
const KEYWORD_HINT_KEY: Record<string, keyof typeof ui> = {
  'Entry thường trú → không cần từ khóa.': 'khResident',
  'Entry thường trú (thẻ đơn) → không cần từ khóa.': 'khResidentSingle',
  'Tên đầy đủ, biệt danh, ngoại hiệu, chức vụ. VD: "Vương Tĩnh,Cô giáo Vương,Giáo viên chủ nhiệm"': 'khNpc',
  'Tên cảnh vật, địa danh, tên gọi khác, hành động. VD: "Thư viện,Thư viện trường,Mượn sách"': 'khScene',
  'Tên nhân vật cần điều chỉnh. VD: "Lâm Tiểu Vũ,Tiểu Vũ"': 'khD0',
  'Tên nhân vật + từ khóa NSFW.': 'khNsfw',
  'Khai bạch không dùng keyword — chỉ là first message.': 'khOpening',
  'Tên nhân vật + biệt danh + ngoại hiệu. VD: "Thu Minh Nguyệt,Minh Nguyệt,Nguyệt Nguyệt,Chị Thu"': 'khMnChar',
};

/** Nhãn keywordHint đã i18n. Fallback về chuỗi gốc nếu chưa map. */
export function keywordHintUi(hint: string): string {
  const k = KEYWORD_HINT_KEY[hint];
  return k ? ui[k] : hint;
}
