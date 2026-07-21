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
 * ═══ Lỗi phía Mod Card ═══
 *
 * Đối chiếu card thật đang chạy với card tool mình xuất ra:
 *
 *   Long Tộc v8.1 (thật):  book.name = "Sách Thế Giới Long Tộc…"
 *                          ext.world = "Sách Thế Giới Long Tộc…"   ← KHỚP
 *
 *   _tr.json (mình xuất):  book.name = "Chiến Cơ Ánh Sáng (6.5)"   ← đã dịch
 *                          ext.world = "光之战姬 (6.5)"             ← CÒN TIẾNG TRUNG
 *
 * Mod Card sửa nội dung entry và đổi tên nhân vật rồi xuất `MODDED_*.json`, nhưng chưa từng
 * đụng `data.extensions.world`. Thẻ đầu vào vốn đã đứt dây thì đầu ra vẫn đứt.
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

/**
 * ═══ Vì sao phải lọc tên world ═══
 *
 * ST lưu world thành FILE: `sanitize(name + '.json')` (src/endpoints/worldinfo.js:24), rồi
 * dựng danh sách `world_names` từ chính TÊN FILE đó (src/endpoints/settings.js:257).
 * Nghĩa là phép `world_names.includes(ext.world)` so tên card khai với tên ĐÃ BỊ LỌC.
 *
 * Nếu tên sách chứa ký tự bị `sanitize-filename` cắt thì hai bên lệch nhau ⇒ quả cầu World
 * không sáng, ST tưởng chưa có gì và mời import lại mỗi lần chọn nhân vật.
 *
 * Đây là ca THẬT, không phải giả định: card `bugNeedFix/9` bản dịch có tên sách
 * "…mọi chuyện dường như bắt đầu không ổn? 3.7…" — dấu `?` ASCII bị cắt. (Bản gốc tiếng
 * Trung dùng `？` fullwidth nên không sao; chính bước dịch đã đổi nó thành `?` ASCII.)
 *
 * Chữ Việt có dấu và chữ Hán KHÔNG bị đụng — regex chỉ chạm U+0000–U+009F.
 */
const ILLEGAL_FILENAME = /[/?<>\\:*|"]|[\x00-\x1f\x80-\x9f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const JSON_SUFFIX_BYTES = 5; // ".json"

const utf8Len = (s: string): number =>
  typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;

/** Cắt chuỗi cho vừa `max` byte UTF-8, không cắt lìa ký tự nhiều byte. */
function truncateUtf8(s: string, max: number): string {
  if (utf8Len(s) <= max) return s;
  let out = s;
  while (out.length > 0 && utf8Len(out) > max) out = out.slice(0, -1);
  return out;
}

/**
 * Trả về tên world y hệt cái ST sẽ lưu xuống đĩa — để `book.name` và `extensions.world`
 * khớp với `world_names` của ST.
 */
export function sanitizeWorldName(name: string): string {
  let s = String(name ?? '').replace(ILLEGAL_FILENAME, '');
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  // Tên dành riêng của Windows: ST vẫn tạo file được nhưng dễ sinh chuyện, đổi cho lành.
  if (WINDOWS_RESERVED.test(s)) s = `${s}_`;
  // ST gọi sanitize(name + '.json') và thư viện cắt TỔNG ở 255 byte — quá dài thì mất luôn
  // đuôi .json, file không được liệt kê nữa và world biến mất hẳn.
  s = truncateUtf8(s, 255 - JSON_SUFFIX_BYTES).replace(/[. ]+$/, '');
  return s;
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
  /** Đã lọc bớt ký tự mà SillyTavern sẽ cắt khỏi tên file world. */
  sanitizedName: boolean;
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
    card, worldName: '', renamedBook: false, sanitizedName: false,
    relinkedWorld: false, keptExternalWorld: false,
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
    base.renamedBook = true;
  }

  // ── 1b. Tên phải sống sót qua sanitize của ST ─────────────────────────────
  // Ghi bản đã lọc vào CẢ book.name lẫn world: ST dù sao cũng chỉ lưu được bản đã lọc, nên
  // giữ tên "đẹp" ở book.name chỉ tạo ra hai tên khác nhau và đứt liên kết.
  const clean = sanitizeWorldName(bookName) || sanitizeWorldName(String(data.name ?? '')) || 'Lorebook';
  if (clean !== bookName) base.sanitizedName = true;
  bookName = clean;
  if (book.name !== bookName) {
    book.name = bookName;
    if (!base.renamedBook && !base.sanitizedName) base.renamedBook = true;
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
