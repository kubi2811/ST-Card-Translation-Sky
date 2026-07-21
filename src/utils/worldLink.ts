/**
 * (User 22/07 — bug 73) "Lúc import card vào ST thì hay bị tách riêng lorebook với card,
 * phải tự đi add lại vào."
 *
 * ═══ SillyTavern thực sự làm gì (đọc từ mã nguồn public/scripts/world-info.js) ═══
 *
 * ST KHÔNG BAO GIỜ tự động gắn lorebook nhúng vào nhân vật. Khi bạn chọn nhân vật,
 * `checkEmbeddedWorld(chid)` chạy và chỉ MỜI bạn import:
 *
 *     const worldName = characters[chid]?.data?.extensions?.world;
 *     if (!accountStorage.getItem(checkKey) && (!worldName || !world_names.includes(worldName))) {
 *         ... popup "Would you like to import it now?" (hoặc chỉ toast)
 *     }
 *
 * Rút ra 2 điều sống còn:
 *
 *  1. `data.extensions.world` là SỢI DÂY duy nhất buộc nhân vật với world. Nếu nó trỏ đúng
 *     tên một world ĐÃ CÓ trong ST thì nhân vật được gắn ngay, và ST im lặng bỏ qua lời mời
 *     import (điều kiện trên thành false).
 *  2. Nếu nó trỏ SAI tên (world đó không tồn tại) thì sau khi user bấm "Import Card Lore",
 *     ST tạo world theo `character_book.name` rồi gắn tên ĐÓ — lệch hẳn với cái card khai.
 *     Lần mở sau, ST lại tưởng chưa có gì và mời import lần nữa.
 *
 * ═══ Lỗi của tool mình ═══
 *
 * Đối chiếu card thật đang chạy với card tool mình xuất ra:
 *
 *   Long Tộc v8.1 (thật):  book.name = "Sách Thế Giới Long Tộc…"
 *                          ext.world = "Sách Thế Giới Long Tộc…"   ← KHỚP
 *
 *   _tr.json (mình xuất):  book.name = "Chiến Cơ Ánh Sáng (6.5)"   ← đã dịch
 *                          ext.world = "光之战姬 (6.5)"             ← CÒN TIẾNG TRUNG
 *
 * Dịch Card có dịch `data.character_book.name` (cardFields.ts) nhưng KHÔNG hề đụng tới
 * `data.extensions.world` — cả app không có một dòng nào ghi field đó. Nên mọi card dịch ra
 * đều đứt sợi dây: user đã có world tiếng Trung từ bản gốc thì ST thấy `world` đó tồn tại →
 * không mời import gì cả, và nhân vật bị gắn vào world TIẾNG TRUNG cũ chứ không phải bản dịch.
 * Đúng y triệu chứng "bị tách riêng, phải tự đi add lại vào".
 */

/** Tên sách chung chung do template/mặc định để lại — trùng nhau giữa các card, ST sẽ ghi đè lẫn nhau. */
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

type AnyCard = Record<string, unknown>;

const getData = (c: unknown): AnyCard | null => {
  const d = (c as AnyCard | null)?.data;
  return d && typeof d === 'object' ? (d as AnyCard) : null;
};

const getBook = (c: unknown): AnyCard | null => {
  const b = getData(c)?.character_book;
  return b && typeof b === 'object' ? (b as AnyCard) : null;
};

const getWorld = (c: unknown): string => {
  const ext = getData(c)?.extensions;
  const w = ext && typeof ext === 'object' ? (ext as AnyCard).world : undefined;
  return typeof w === 'string' ? w : '';
};

export interface WorldLinkResult<T> {
  card: T;
  /** Tên world cuối cùng card trỏ tới ('' = không đụng gì). */
  worldName: string;
  /** Đã đổi book.name vì nó trống/chung chung. */
  renamedBook: boolean;
  /** Đã nối lại extensions.world cho khớp book.name. */
  relinkedWorld: boolean;
  /** Giữ nguyên extensions.world vì nó trỏ tới world NGOÀI, không phải sách nhúng. */
  keptExternalWorld: boolean;
}

/**
 * Buộc lại sợi dây giữa lorebook nhúng và nhân vật, ngay trước khi xuất file.
 *
 * `original` là thẻ TRƯỚC khi xử lý (bản gốc chưa dịch) — cần nó để phân biệt hai ca:
 *   - gốc `ext.world === book.name`  → đây là một cặp, đổi tên sách thì phải đổi luôn world.
 *   - gốc `ext.world !== book.name`  → user cố ý trỏ sang world NGOÀI, TUYỆT ĐỐI không đụng.
 * Truyền `original === card` (hoặc bỏ trống) khi không có bản gốc, ví dụ luồng tạo card mới.
 */
export function syncEmbeddedWorldLink<T>(card: T, original?: unknown): WorldLinkResult<T> {
  const base: WorldLinkResult<T> = {
    card, worldName: '', renamedBook: false, relinkedWorld: false, keptExternalWorld: false,
  };

  const data = getData(card);
  const book = getBook(card);
  if (!data || !book) return base; // không có sách nhúng thì không có gì để buộc

  const src = original ?? card;
  const origBook = getBook(src);
  const origWorld = getWorld(src);
  const origBookName = String(origBook?.name ?? '').trim();

  // ── 1. Sách phải có tên RIÊNG ─────────────────────────────────────────────
  // Tên chung chung ('New Character', 'Imported Lorebook'…) khiến card này ghi đè world của
  // card khác — ST cảnh báo "It will overwrite the World/Lorebook with the same name".
  let bookName = String(book.name ?? '').trim();
  if (isGenericBookName(bookName)) {
    const charName = String(data.name ?? '').trim();
    // Đặt theo đúng công thức dự phòng của chính ST để tên nhìn quen mắt với user.
    bookName = charName ? `${charName}'s Lorebook` : 'Lorebook';
    book.name = bookName;
    base.renamedBook = true;
  }
  base.worldName = bookName;

  // ── 2. Nối extensions.world về đúng sách ──────────────────────────────────
  const ext = (data.extensions && typeof data.extensions === 'object')
    ? (data.extensions as AnyCard)
    : (data.extensions = {} as AnyCard);
  const curWorld = String(ext.world ?? '').trim();

  if (curWorld === bookName) return base; // đã khớp, không làm gì

  // World NGOÀI: gốc đã trỏ đi chỗ khác ngay từ đầu → đó là lựa chọn của user, giữ nguyên.
  const pointsElsewhere = origWorld !== '' && origBookName !== '' && origWorld !== origBookName;
  if (pointsElsewhere) {
    base.keptExternalWorld = true;
    base.worldName = curWorld;
    return base;
  }

  ext.world = bookName;
  base.relinkedWorld = true;
  return base;
}
