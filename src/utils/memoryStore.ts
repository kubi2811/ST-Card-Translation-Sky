/**
 * ─── P0 Roadmap Trợ Lý AI — Kho trí nhớ dài hạn (Tầng 3) ───
 * Xem docs/ROADMAP_TRO_LY_AI.md mục 2-3.
 *
 * IndexedDB (Dexie) thay localStorage vì: quota hàng GB (localStorage 5MB đã tràn tới mức
 * safeSetItem phải nuốt lỗi), có index/transaction, đọc ghi async không chặn UI.
 *
 * Nguyên tắc ghi: WRITE-THROUGH (ghi thẳng disk ngay, debounce ở tầng gọi nếu cần) — trình duyệt
 * có thể đóng bất kỳ lúc nào, ký ức là dữ liệu KHÔNG ĐƯỢC PHÉP MẤT (bài học bug 23). Riêng bảng
 * vectors (embedding) được phép ghi lười vì tính lại được từ text.
 *
 * Nhất quán đa tab: Web Locks (1 writer) + version check (thua version → ghi conflictLog thay vì
 * đè im lặng) + BroadcastChannel để tab khác invalidate cache RAM.
 */
import Dexie, { type Table } from 'dexie';

export type MemoryKind = 'fact' | 'preference' | 'glossary' | 'tm' | 'doc_chunk' | 'chat_summary';

export interface MemorySource {
  origin: 'attachment' | 'card' | 'chat' | 'docs' | 'user_edit';
  fileName?: string;
  part?: string;        // "PHẦN 2/9"
  path?: string;        // "lorebook[4].content"
  turnId?: string;
  /**
   * (bug 218) CUỘC TRÒ CHUYỆN ĐẺ RA KÝ ỨC NÀY.
   *
   * User dặn: "phải làm sao khi mà bỏ ghim hay xóa chat thì AI sẽ không nhớ". Muốn làm được thì
   * phải truy ngược được ký ức về đúng cuộc trò chuyện — mà trước đây KHÔNG thể: bộ trích ký ức
   * chỉ ghi `turnId: 'turn-' + số tin nhắn`, tức mọi cuộc trò chuyện đều đẻ ra `turn-7`, `turn-9`
   * giống hệt nhau. Xoá một chat thì không có cách nào biết ký ức nào là của nó.
   *
   * Nay mỗi ký ức sinh từ chat đều mang `conversationId`; xem `revokeMemoriesOfConversation`.
   */
  conversationId?: string;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessAt: number;
  version: number;
  supersedes?: string;
  pinned?: boolean;
  /** id thẻ card gắn với ký ức (lọc theo ngữ cảnh); '' = dùng chung */
  cardKey?: string;
}

export interface VectorRecord {
  id: string;           // = MemoryRecord.id
  dims: number;
  /** Lưu ArrayBuffer để structured-clone rẻ; RAM dùng Float32Array view. */
  vec: ArrayBuffer;
  embedder: string;     // 'hash-v1' | 'api:<model>' — đổi embedder ⇒ phải re-embed
}

/**
 * (bug 218) MỘT CUỘC TRÒ CHUYỆN ĐÃ LƯU.
 *
 * Trước đây Trợ Lý AI không có khái niệm "cuộc trò chuyện": toàn bộ chat là MỘT mảng phẳng nằm
 * trong localStorage khoá `ai_assistant_messages`. Không có nó thì không ghim được, không chọn
 * lại chat cũ được, và cũng không thu hồi được ký ức sinh ra từ một chat cụ thể.
 */
export interface ConversationRecord {
  id: string;
  /** Tiêu đề hiện trong danh sách — lấy từ câu đầu của user, người dùng sửa được. */
  title: string;
  messages: { role: 'user' | 'assistant'; content: string; at?: number }[];
  createdAt: number;
  updatedAt: number;
  /** GHIM: người dùng thích cuộc này, muốn Trợ Lý nhớ nó lâu dài. */
  pinned?: boolean;
  /**
   * ĐANG ĐƯỢC NHỚ: cuộc này có được nạp vào prompt ở lượt sau hay không.
   *
   * Tách khỏi `pinned` có chủ ý: ghim là "đừng dọn cuộc này đi", còn nhớ là "đưa nó vào đầu
   * Trợ Lý". Người dùng có thể chọn NHIỀU cuộc cũ để nhớ mà không cần ghim cuộc nào, và ngược
   * lại giữ một cuộc yêu thích mà tạm thời không muốn nó chen vào ngữ cảnh.
   */
  remembered?: boolean;
  /** Thẻ đang mở lúc trò chuyện — để lọc theo ngữ cảnh như ký ức. */
  cardKey?: string;
}

export interface ConflictRecord {
  id?: number;
  memoryId: string;
  incomingText: string;
  existingText: string;
  reason: 'version_lost' | 'contradiction';
  at: number;
  resolved?: boolean;
}

class MemoryDB extends Dexie {
  memories!: Table<MemoryRecord, string>;
  vectors!: Table<VectorRecord, string>;
  conflicts!: Table<ConflictRecord, number>;
  /** (bug 218) Hội thoại đã lưu — xem conversationStore.ts. */
  conversations!: Table<ConversationRecord, string>;

  constructor(name = 'st_assistant_memory') {
    super(name);
    this.version(1).stores({
      memories: 'id, kind, cardKey, updatedAt, lastAccessAt, pinned',
      vectors: 'id, embedder',
      conflicts: '++id, memoryId, resolved, at',
    });
    /**
     * (bug 218) v2 — thêm bảng `conversations` và đánh index `source.conversationId`.
     *
     * Index đó là thứ làm cho "bỏ ghim / xoá chat ⇒ AI quên" chạy được: không có nó thì mỗi lần
     * thu hồi phải quét toàn bộ kho ký ức. Dexie cho phép đánh index trên đường dẫn lồng nhau
     * bằng cú pháp `source.conversationId`.
     *
     * Bản ghi cũ (chưa có trường đó) vẫn nằm yên — Dexie chỉ bỏ chúng ra khỏi index, không xoá.
     */
    this.version(2).stores({
      memories: 'id, kind, cardKey, updatedAt, lastAccessAt, pinned, source.conversationId',
      vectors: 'id, embedder',
      conflicts: '++id, memoryId, resolved, at',
      conversations: 'id, updatedAt, pinned, remembered',
    });
  }
}

let _db: MemoryDB | null = null;
export function memoryDb(): MemoryDB {
  if (!_db) _db = new MemoryDB();
  return _db;
}

/** Cho test: dùng DB tên riêng / reset. */
export function _resetMemoryDbForTest(name?: string): MemoryDB {
  _db = new MemoryDB(name || `test_mem_${Math.random().toString(36).slice(2)}`);
  return _db;
}

const CHANNEL_NAME = 'st-memory-sync';
let _channel: BroadcastChannel | null = null;
function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_channel) _channel = new BroadcastChannel(CHANNEL_NAME);
  return _channel;
}

export type MemorySyncMsg =
  | { type: 'put' | 'delete'; id: string; version?: number }
  | { type: 'clear'; id?: undefined };

/** Đăng ký nghe thay đổi từ tab khác (invalidate cache RAM). Trả về hàm huỷ. */
export function onMemorySync(fn: (msg: MemorySyncMsg) => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent) => fn(e.data as MemorySyncMsg);
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

/** Chạy fn trong lock ghi toàn cục (mọi tab). Fallback chạy trực tiếp nếu không có Web Locks. */
async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (typeof navigator !== 'undefined' && (navigator as any).locks) || null;
  if (locks?.request) {
    return locks.request('st-memory-write', fn) as Promise<T>;
  }
  return fn();
}

export function newMemoryId(): string {
  // ulid-lite: thời gian (sắp xếp được) + ngẫu nhiên — đủ cho phạm vi 1 user
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ghi 1 ký ức (write-through). Version check: bản ghi đến với version cũ hơn bản trong DB
 * → KHÔNG đè, ghi conflictLog (đè im lặng là mất dữ liệu kiểu bug 23).
 */
export async function putMemory(rec: MemoryRecord, db = memoryDb()): Promise<'written' | 'conflict'> {
  const result = await withWriteLock(async () => {
    const existing = await db.memories.get(rec.id);
    if (existing && existing.version > rec.version) {
      await db.conflicts.add({
        memoryId: rec.id,
        incomingText: rec.text,
        existingText: existing.text,
        reason: 'version_lost',
        at: Date.now(),
      });
      return 'conflict' as const;
    }
    await db.memories.put({ ...rec, updatedAt: Date.now() });
    return 'written' as const;
  });
  if (result === 'written') channel()?.postMessage({ type: 'put', id: rec.id, version: rec.version } satisfies MemorySyncMsg);
  return result;
}

export async function getMemory(id: string, db = memoryDb()): Promise<MemoryRecord | undefined> {
  return db.memories.get(id);
}

/** Đánh dấu vừa dùng (cho decay/LRU). Không bump version — chỉ metadata truy cập. */
export async function touchMemory(id: string, db = memoryDb()): Promise<void> {
  await db.memories.where('id').equals(id).modify(m => {
    m.accessCount += 1;
    m.lastAccessAt = Date.now();
  });
}

export async function deleteMemory(id: string, db = memoryDb()): Promise<void> {
  await withWriteLock(async () => {
    await db.memories.delete(id);
    await db.vectors.delete(id);
  });
  channel()?.postMessage({ type: 'delete', id } satisfies MemorySyncMsg);
}

/** (bugNeedFix — Ký ức) Xoá TẤT CẢ bản ghi trí nhớ (+ vector). Trả về số bản ghi đã xoá. */
export async function clearAllMemories(db = memoryDb()): Promise<number> {
  const n = await withWriteLock(async () => {
    const count = await db.memories.count();
    await db.memories.clear();
    await db.vectors.clear();
    return count;
  });
  channel()?.postMessage({ type: 'clear' } satisfies MemorySyncMsg);
  return n;
}

export async function listMemories(
  opts: { kind?: MemoryKind; cardKey?: string; limit?: number } = {},
  db = memoryDb(),
): Promise<MemoryRecord[]> {
  let coll = opts.kind
    ? db.memories.where('kind').equals(opts.kind)
    : db.memories.toCollection();
  let rows = await coll.toArray();
  if (opts.cardKey !== undefined) rows = rows.filter(r => !r.cardKey || r.cardKey === opts.cardKey);
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/* ─── Vectors (write-back được phép: tính lại được từ text) ─── */

export async function putVector(v: VectorRecord, db = memoryDb()): Promise<void> {
  await db.vectors.put(v);
}

export async function getVectors(embedder: string, db = memoryDb()): Promise<VectorRecord[]> {
  return db.vectors.where('embedder').equals(embedder).toArray();
}

/* ─── Decay score (mục 2 roadmap) ─── */

/**
 * Điểm ưu tiên đưa vào prompt = recency + tần suất + pin.
 * KHÔNG dùng để xoá (T3 giữ vĩnh viễn) — chỉ để xếp hạng/chọn lọc.
 */
export function decayScore(m: MemoryRecord, now = Date.now()): number {
  const ageDays = (now - m.lastAccessAt) / 86_400_000;
  const recency = Math.exp(-ageDays / 14);            // nửa đời ~10 ngày
  const freq = Math.log2(1 + m.accessCount) / 6;      // 63 lần dùng ≈ 1.0
  return (m.pinned ? 1 : 0) * 2 + recency * 1.0 + Math.min(freq, 1) * 0.6;
}

/* ─── Migrate từ localStorage (1 lần, giữ bản cũ tới khi verify) ─── */

const MIGRATED_FLAG = 'st_memory_migrated_v1';

/** Chuyển messages/attachments cũ từ localStorage sang IndexedDB dạng chat_summary/doc_chunk. */
export async function migrateFromLocalStorage(db = memoryDb()): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  if (localStorage.getItem(MIGRATED_FLAG)) return 0;
  let migrated = 0;
  try {
    const rawMsgs = localStorage.getItem('ai_assistant_messages');
    if (rawMsgs) {
      const msgs = JSON.parse(rawMsgs) as { role: string; content: string }[];
      // Chỉ lưu tóm lược phiên cũ (mỗi 20 lượt 1 bản ghi) — lịch sử sống vẫn ở localStorage
      for (let i = 0; i < msgs.length; i += 20) {
        const slice = msgs.slice(i, i + 20);
        const text = slice.map(m => `${m.role}: ${m.content.slice(0, 300)}`).join('\n');
        const now = Date.now();
        await putMemory({
          id: newMemoryId(), kind: 'chat_summary', text,
          source: { origin: 'chat' },
          createdAt: now, updatedAt: now, accessCount: 0, lastAccessAt: now, version: 1,
        }, db);
        migrated++;
      }
    }
    localStorage.setItem(MIGRATED_FLAG, String(Date.now()));
  } catch (e) {
    console.warn('[memoryStore] migrate lỗi (không chặn app):', e);
  }
  return migrated;
}

/** Xin trình duyệt KHÔNG tự dọn IndexedDB khi thiếu đĩa (rủi ro #1 roadmap). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* không hỗ trợ → thôi */ }
  return false;
}

/* ─── Export / Import (rủi ro #1: người dùng tự sao lưu được) ─── */

export async function exportMemories(db = memoryDb()): Promise<string> {
  const memories = await db.memories.toArray();
  const conflicts = await db.conflicts.toArray();
  return JSON.stringify({ v: 1, exportedAt: Date.now(), memories, conflicts }, null, 2);
}

export async function importMemories(json: string, db = memoryDb()): Promise<number> {
  const data = JSON.parse(json) as { v: number; memories: MemoryRecord[] };
  if (!Array.isArray(data.memories)) throw new Error('File không đúng định dạng export ký ức');
  let n = 0;
  for (const m of data.memories) {
    if ((await putMemory(m, db)) === 'written') n++;
  }
  return n;
}
