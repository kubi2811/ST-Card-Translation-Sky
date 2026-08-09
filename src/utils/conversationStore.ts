/**
 * src/utils/conversationStore.ts — (bug 218) HỘI THOẠI ĐÃ LƯU, GHIM, VÀ THU HỒI KÝ ỨC.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "thêm ghim chat mình thích để AI nhớ cuộc trò chuyện đó, nhưng hãy nhớ cẩn thận phải làm
 * sao khi mà bỏ ghim hay xóa chat thì AI sẽ không nhớ. Thêm tính năng chọn chat cũ nào mà AI cần
 * nhớ, có thể chọn nhiều."
 *
 * Chỗ khó nằm hết ở vế "cẩn thận", nên nói rõ trước khi vào code.
 *
 * TRỢ LÝ NHỚ MỘT CUỘC TRÒ CHUYỆN THEO HAI ĐƯỜNG KHÁC HẲN NHAU:
 *
 *   1. Đường TRỰC TIẾP — nội dung cuộc đó được chép vào system prompt ở lượt sau. Đường này dễ:
 *      bỏ chọn là hết, vì prompt được ghép lại mỗi lượt.
 *
 *   2. Đường GIÁN TIẾP — bộ trích ký ức đọc hội thoại rồi đẻ ra các bản ghi "fact/preference/
 *      glossary" nằm trong kho trí nhớ dài hạn. Đường này mới là cái bẫy: xoá cuộc trò chuyện đi
 *      thì mấy bản ghi kia VẪN NẰM ĐÓ và vẫn được RAG bơm vào prompt. Người dùng tưởng đã xoá
 *      sạch, thực tế Trợ Lý vẫn nhớ như in.
 *
 * Trước bản này, đường 2 KHÔNG THỂ thu hồi được, vì bộ trích ký ức chỉ ghi
 * `source.turnId = 'turn-' + số tin nhắn` — mọi cuộc trò chuyện đều đẻ ra `turn-7`, `turn-9`
 * giống hệt nhau, không có gì buộc ký ức vào cuộc trò chuyện đã sinh ra nó.
 *
 * Nay mỗi ký ức sinh từ chat mang `source.conversationId`, và mọi thao tác làm Trợ Lý "thôi nhớ"
 * đều đi qua đúng một cửa: `revokeMemoriesOfConversation`.
 *
 * MỘT LỰA CHỌN CÓ CHỦ Ý — THU HỒI LÀ XOÁ HẲN, TRỪ KÝ ỨC ĐÃ GHIM RIÊNG:
 * Ký ức được người dùng tự tay ghim (`memory.pinned`) thì KHÔNG bị cuốn theo. Người dùng đã chủ
 * động giữ nó lại thì đó là ý muốn mới nhất, mạnh hơn nguồn gốc của nó. Mọi ký ức còn lại sinh từ
 * cuộc đó bị xoá cùng vector — vì để lại nghĩa là Trợ Lý vẫn nhớ, đúng thứ user bảo không được.
 */
import { memoryDb, deleteMemory, type ConversationRecord, type MemoryRecord } from './memoryStore';

export type { ConversationRecord };

/** Id hội thoại — cùng kiểu ulid-lite với ký ức để sắp xếp được theo thời gian. */
export function newConversationId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Đặt tiêu đề từ câu đầu tiên của người dùng. Cắt ở ranh giới TỪ chứ không cắt giữa chữ, và bỏ
 * xuống dòng — tiêu đề nhiều dòng làm vỡ danh sách.
 */
export function titleFromMessages(
  messages: { role: string; content: string }[],
  max = 60,
): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim());
  const raw = (first?.content || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Cuộc trò chuyện chưa đặt tên';
  if (raw.length <= max) return raw;
  const cut = raw.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut) + '…';
}

export async function putConversation(rec: ConversationRecord, db = memoryDb()): Promise<void> {
  await db.conversations.put({ ...rec, updatedAt: Date.now() });
}

export async function getConversation(id: string, db = memoryDb()): Promise<ConversationRecord | undefined> {
  return db.conversations.get(id);
}

export async function listConversations(
  opts: { cardKey?: string; onlyPinned?: boolean; limit?: number } = {},
  db = memoryDb(),
): Promise<ConversationRecord[]> {
  let rows = await db.conversations.toArray();
  if (opts.onlyPinned) rows = rows.filter((c) => c.pinned);
  if (opts.cardKey !== undefined) rows = rows.filter((c) => !c.cardKey || c.cardKey === opts.cardKey);
  // Ghim luôn nổi lên đầu, còn lại theo lần sửa gần nhất.
  rows.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.updatedAt - a.updatedAt));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/** Các cuộc đang được chọn cho Trợ Lý nhớ — nguồn duy nhất cho tầng prompt tương ứng. */
export async function listRememberedConversations(
  opts: { cardKey?: string } = {},
  db = memoryDb(),
): Promise<ConversationRecord[]> {
  const rows = await listConversations(opts, db);
  return rows.filter((c) => c.remembered);
}

export interface RevokeResult {
  /** Số ký ức đã xoá hẳn. */
  deleted: number;
  /** Số ký ức được GIỮ vì người dùng đã tự tay ghim riêng bản ghi đó. */
  keptPinned: number;
}

/**
 * THU HỒI mọi thứ Trợ Lý nhớ được từ một cuộc trò chuyện.
 *
 * Gọi ở cả ba chỗ: bỏ ghim, bỏ chọn nhớ, và xoá hội thoại. Ba thao tác khác nhau nhưng lời hứa
 * với người dùng là một: sau đó Trợ Lý không được nhớ cuộc đó nữa.
 *
 * KHÔNG dùng `db.memories.where(...).delete()` mà lặp qua `deleteMemory`, vì bản ghi vector nằm
 * ở bảng khác — xoá thẳng bảng memories sẽ để lại vector mồ côi, và RAG vẫn tìm ra chúng.
 */
export async function revokeMemoriesOfConversation(
  conversationId: string,
  db = memoryDb(),
): Promise<RevokeResult> {
  if (!conversationId) return { deleted: 0, keptPinned: 0 };
  let rows: MemoryRecord[] = [];
  try {
    rows = await db.memories.where('source.conversationId').equals(conversationId).toArray();
  } catch {
    // Kho cũ chưa có index lồng nhau (schema v1) — lùi về quét tay, chậm hơn nhưng vẫn đúng.
    rows = (await db.memories.toArray()).filter((m) => m.source?.conversationId === conversationId);
  }
  let deleted = 0;
  let keptPinned = 0;
  for (const m of rows) {
    if (m.pinned) { keptPinned++; continue; }
    await deleteMemory(m.id, db);
    deleted++;
  }
  return { deleted, keptPinned };
}

/**
 * Bật/tắt ghim. Bỏ ghim thì thu hồi luôn — vì với người dùng, "bỏ ghim" nghĩa là thôi nhớ, chứ
 * không phải "vẫn nhớ nhưng không hiện ở đầu danh sách".
 */
export async function setConversationPinned(
  id: string,
  pinned: boolean,
  db = memoryDb(),
): Promise<RevokeResult> {
  const conv = await db.conversations.get(id);
  if (!conv) return { deleted: 0, keptPinned: 0 };
  await db.conversations.put({
    ...conv,
    pinned,
    // Bỏ ghim thì cũng thôi nạp vào prompt — không thì "bỏ ghim" mà Trợ Lý vẫn đọc nguyên cuộc đó.
    remembered: pinned ? conv.remembered : false,
    updatedAt: Date.now(),
  });
  return pinned ? { deleted: 0, keptPinned: 0 } : revokeMemoriesOfConversation(id, db);
}

/** Bật/tắt "cho Trợ Lý nhớ cuộc này". Tắt cũng phải thu hồi, cùng lý do như bỏ ghim. */
export async function setConversationRemembered(
  id: string,
  remembered: boolean,
  db = memoryDb(),
): Promise<RevokeResult> {
  const conv = await db.conversations.get(id);
  if (!conv) return { deleted: 0, keptPinned: 0 };
  await db.conversations.put({ ...conv, remembered, updatedAt: Date.now() });
  return remembered ? { deleted: 0, keptPinned: 0 } : revokeMemoriesOfConversation(id, db);
}

/** Chọn NHIỀU cuộc một lúc — đúng thứ user xin. Cuộc nào rời khỏi danh sách thì bị thu hồi. */
export async function setRememberedSet(
  ids: string[],
  db = memoryDb(),
): Promise<RevokeResult> {
  const want = new Set(ids);
  const all = await db.conversations.toArray();
  const total: RevokeResult = { deleted: 0, keptPinned: 0 };
  for (const c of all) {
    const should = want.has(c.id);
    if (!!c.remembered === should) continue;
    const r = await setConversationRemembered(c.id, should, db);
    total.deleted += r.deleted;
    total.keptPinned += r.keptPinned;
  }
  return total;
}

/** Xoá hẳn một cuộc + thu hồi ký ức của nó. */
export async function deleteConversation(id: string, db = memoryDb()): Promise<RevokeResult> {
  const res = await revokeMemoriesOfConversation(id, db);
  await db.conversations.delete(id);
  return res;
}

/**
 * Dựng khối văn bản của các cuộc được nhớ để nhét vào system prompt.
 *
 * Có TRẦN ký tự vì đây là thứ dễ phình nhất trong cả prompt: người dùng chọn 5 cuộc dài là đủ
 * đẩy prompt vượt cửa sổ ngữ cảnh, và lúc đó thứ bị cắt mất lại là phần quan trọng nhất — câu
 * hỏi hiện tại. Cắt từ cuộc CŨ NHẤT trở đi, giữ trọn cuộc mới nhất.
 */
export function buildRememberedBlock(
  convs: ConversationRecord[],
  maxChars = 12_000,
): string {
  if (!convs.length) return '';
  const newestFirst = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
  const parts: string[] = [];
  let used = 0;
  let boCuoc = 0;
  for (const c of newestFirst) {
    const body = c.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Trợ Lý'}: ${m.content}`)
      .join('\n');
    const piece = `— Cuộc "${c.title}":\n${body}`;
    if (used + piece.length > maxChars) { boCuoc++; continue; }
    parts.push(piece);
    used += piece.length;
  }
  if (!parts.length) return '';
  const ghiChu = boCuoc > 0
    ? `\n(Đã lược ${boCuoc} cuộc cũ hơn cho vừa ngữ cảnh — chọn ít cuộc lại nếu cần nhớ đủ.)`
    : '';
  return `[NHỮNG CUỘC TRÒ CHUYỆN NGƯỜI DÙNG MUỐN BẠN NHỚ]\n${parts.join('\n\n')}${ghiChu}`;
}
