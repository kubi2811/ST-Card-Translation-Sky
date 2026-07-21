/**
 * (User 22/07 — bug 73) "Lúc import card vào ST thì hay bị tách riêng lorebook với card,
 * phải tự đi add lại vào."
 *
 * ═══ SillyTavern thực sự làm gì (đọc từ public/scripts/world-info.js) ═══
 *
 * ST KHÔNG BAO GIỜ tự gắn lorebook nhúng. Khi chọn nhân vật, `checkEmbeddedWorld` chỉ MỜI:
 *
 *     const worldName = characters[chid]?.data?.extensions?.world;
 *     if (!accountStorage.getItem(checkKey) && (!worldName || !world_names.includes(worldName))) { … }
 *
 * `data.extensions.world` là SỢI DÂY duy nhất buộc nhân vật với world. Sau khi user bấm
 * "Import Card Lore", ST tạo world tên `character_book.name` rồi gắn tên đó. Nên hai field
 * này PHẢI bằng nhau — card MVU thật (Long Tộc v8.1) đúng như vậy.
 *
 * ═══ Lỗi phía Tạo Card ═══
 *
 * Cả app chưa từng ghi `data.extensions.world` (chỉ khởi tạo `world: ''`), và tên sách thì
 * hay dính giá trị chung chung do template/mặc định để lại: 'New Character' (cardDefaults),
 * 'Imported Lorebook' (lorebookConvert), 'Game Master'/'Narrator' (cardTemplates). Hậu quả:
 *   - không có world → user phải tự vào "More… → Import Card Lore" rồi tự gắn;
 *   - tên trùng nhau giữa các card → ST cảnh báo "It will overwrite the World/Lorebook with
 *     the same name", card sau đè lorebook của card trước.
 */

/** Tên sách chung chung do template/mặc định để lại — trùng nhau giữa các card. */
const GENERIC_BOOK_NAMES = new Set([
  'new character',
  'imported lorebook',
  'game master',
  'narrator',
  'new card',
  'lorebook',
  'untitled',
]);

export function isGenericBookName(name: unknown): boolean {
  const s = String(name ?? '').trim();
  return s === '' || GENERIC_BOOK_NAMES.has(s.toLowerCase());
}

type AnyObj = Record<string, unknown>;

const asObj = (v: unknown): AnyObj | null =>
  v && typeof v === 'object' ? (v as AnyObj) : null;

export interface WorldLinkResult<T> {
  card: T;
  /** Tên world cuối cùng card trỏ tới ('' = không đụng gì). */
  worldName: string;
  /** Đã đặt tên riêng cho sách vì nó trống/chung chung. */
  renamedBook: boolean;
  /** Đã nối extensions.world về đúng sách. */
  relinkedWorld: boolean;
  /** Giữ nguyên extensions.world vì nó trỏ tới world NGOÀI. */
  keptExternalWorld: boolean;
}

/**
 * Buộc lorebook nhúng vào nhân vật ngay trước khi xuất file.
 *
 * `original` là thẻ TRƯỚC khi xử lý — dùng để phân biệt:
 *   - gốc `ext.world === book.name` → một cặp, đổi tên sách thì đổi luôn world;
 *   - gốc `ext.world !== book.name` → user cố ý trỏ world NGOÀI, không đụng.
 * Bỏ trống `original` khi tạo card mới (không có bản gốc để so).
 */
export function syncEmbeddedWorldLink<T>(card: T, original?: unknown): WorldLinkResult<T> {
  const base: WorldLinkResult<T> = {
    card, worldName: '', renamedBook: false, relinkedWorld: false, keptExternalWorld: false,
  };

  const data = asObj(asObj(card)?.data);
  const book = asObj(data?.character_book);
  if (!data || !book) return base; // không có sách nhúng thì không có gì để buộc

  const src = original ?? card;
  const origBook = asObj(asObj(src)?.data && asObj(asObj(src)!.data)!.character_book);
  const origExt = asObj(asObj(src)?.data && asObj(asObj(src)!.data)!.extensions);
  const origWorld = String(origExt?.world ?? '').trim();
  const origBookName = String(origBook?.name ?? '').trim();

  // ── 1. Sách phải có tên RIÊNG ─────────────────────────────────────────────
  let bookName = String(book.name ?? '').trim();
  if (isGenericBookName(bookName)) {
    const charName = String(data.name ?? '').trim();
    // Theo đúng công thức dự phòng của chính ST để tên nhìn quen mắt với user.
    bookName = charName ? `${charName}'s Lorebook` : 'Lorebook';
    book.name = bookName;
    base.renamedBook = true;
  }
  base.worldName = bookName;

  // ── 2. Nối extensions.world về đúng sách ──────────────────────────────────
  const ext = asObj(data.extensions) ?? (data.extensions = {} as AnyObj);
  const curWorld = String((ext as AnyObj).world ?? '').trim();
  if (curWorld === bookName) return base;

  const pointsElsewhere = origWorld !== '' && origBookName !== '' && origWorld !== origBookName;
  if (pointsElsewhere) {
    base.keptExternalWorld = true;
    base.worldName = curWorld;
    return base;
  }

  (ext as AnyObj).world = bookName;
  base.relinkedWorld = true;
  return base;
}
