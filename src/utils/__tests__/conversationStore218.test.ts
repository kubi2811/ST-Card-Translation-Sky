/**
 * (bug 218) GHIM CHAT — VÀ LỜI HỨA "BỎ GHIM / XOÁ THÌ AI KHÔNG NHỚ NỮA".
 * ─────────────────────────────────────────────────────────────────────────────
 * User dặn thẳng: "hãy nhớ cẩn thận phải làm sao khi mà bỏ ghim hay xóa chat thì AI sẽ không
 * nhớ". Cái bẫy là Trợ Lý nhớ một cuộc trò chuyện theo HAI đường:
 *   1. trực tiếp — nội dung cuộc đó chép vào system prompt (bỏ chọn là hết);
 *   2. gián tiếp — bộ trích ký ức đẻ ra fact/preference/glossary nằm trong kho dài hạn, và mấy
 *      bản ghi đó SỐNG SÓT qua việc xoá hội thoại, vẫn được RAG bơm vào prompt.
 *
 * Trước bản này đường 2 không thu hồi được: ký ức chỉ ghi `turnId: 'turn-' + số tin nhắn`, đụng
 * nhau giữa mọi cuộc trò chuyện. Test này khoá cả hai đường.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { _resetMemoryDbForTest, putMemory, listMemories, newMemoryId, type MemoryRecord } from '../memoryStore';
import {
  newConversationId, titleFromMessages, putConversation, getConversation, listConversations,
  listRememberedConversations, setConversationPinned, setConversationRemembered, setRememberedSet,
  deleteConversation, revokeMemoriesOfConversation, buildRememberedBlock,
  type ConversationRecord,
} from '../conversationStore';

let db: ReturnType<typeof _resetMemoryDbForTest>;
beforeEach(() => { db = _resetMemoryDbForTest(); });

function conv(over: Partial<ConversationRecord> = {}): ConversationRecord {
  const now = Date.now();
  return {
    id: newConversationId(), title: 'Bàn về thẻ Long Tộc',
    messages: [
      { role: 'user', content: 'Thẻ này nên dịch tên riêng kiểu Hán-Việt' },
      { role: 'assistant', content: 'Đã rõ, tôi sẽ giữ Hán-Việt cho tên nhân vật.' },
    ],
    createdAt: now, updatedAt: now, ...over,
  };
}

/** Ký ức sinh RA TỪ một cuộc trò chuyện — đúng hình dạng bộ trích ký ức tạo ra. */
function memOfConv(conversationId: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id: newMemoryId(), kind: 'preference', text: 'User thích tên riêng để Hán-Việt',
    source: { origin: 'chat', conversationId, turnId: 'turn-2' },
    createdAt: now, updatedAt: now, accessCount: 0, lastAccessAt: now, version: 1,
    ...over,
  };
}

describe('(bug 218) kho hội thoại cơ bản', () => {
  it('lưu và đọc lại được', async () => {
    const c = conv();
    await putConversation(c, db);
    expect((await getConversation(c.id, db))?.title).toBe('Bàn về thẻ Long Tộc');
  });

  it('ghim nổi lên đầu danh sách, còn lại theo lần sửa gần nhất', async () => {
    await putConversation(conv({ id: 'a', title: 'A', updatedAt: 3000 }), db);
    await putConversation(conv({ id: 'b', title: 'B', updatedAt: 9000, pinned: true }), db);
    await putConversation(conv({ id: 'c', title: 'C', updatedAt: 5000 }), db);
    // `putConversation` tự dập updatedAt = now nên chỉ kiểm thứ tự ghim-trước.
    const rows = await listConversations({}, db);
    expect(rows[0].id).toBe('b');
    expect(rows).toHaveLength(3);
  });

  it('tiêu đề lấy từ câu đầu của user, cắt ở ranh giới TỪ', () => {
    expect(titleFromMessages([{ role: 'assistant', content: 'chào' }, { role: 'user', content: 'Dịch giúp tôi' }]))
      .toBe('Dịch giúp tôi');
    const goc = 'một hai ba bốn năm sáu bảy tám chín mười mười một mười hai';
    const dai = titleFromMessages([{ role: 'user', content: goc }], 20);
    expect(dai.endsWith('…')).toBe(true);
    // Cắt ĐÚNG ranh giới từ: bỏ dấu … ra thì phần còn lại là tiền tố của bản gốc và ký tự ngay
    // sau nó trong bản gốc phải là dấu cách — tức không xén ngang một chữ.
    const than = dai.slice(0, -1);
    expect(goc.startsWith(than)).toBe(true);
    expect(goc[than.length]).toBe(' ');
  });

  it('không có tin nhắn user thì vẫn có tiêu đề, không để rỗng', () => {
    expect(titleFromMessages([])).toBe('Cuộc trò chuyện chưa đặt tên');
  });
});

describe('(bug 218) BỎ GHIM / XOÁ ⇒ AI PHẢI QUÊN THẬT', () => {
  it('thu hồi đúng ký ức của cuộc đó, KHÔNG đụng cuộc khác', async () => {
    const a = conv({ id: 'conv-a' });
    const b = conv({ id: 'conv-b' });
    await putConversation(a, db); await putConversation(b, db);
    await putMemory(memOfConv('conv-a'), db);
    await putMemory(memOfConv('conv-a', { text: 'thêm một ký ức nữa' }), db);
    await putMemory(memOfConv('conv-b', { text: 'ký ức của cuộc B' }), db);

    const res = await revokeMemoriesOfConversation('conv-a', db);
    expect(res.deleted).toBe(2);
    const left = await listMemories({}, db);
    expect(left).toHaveLength(1);
    expect(left[0].text).toBe('ký ức của cuộc B');
  });

  it('bỏ ghim là thu hồi — không chỉ đổi cờ hiển thị', async () => {
    await putConversation(conv({ id: 'c1', pinned: true, remembered: true }), db);
    await putMemory(memOfConv('c1'), db);

    const res = await setConversationPinned('c1', false, db);
    expect(res.deleted).toBe(1);
    expect(await listMemories({}, db)).toHaveLength(0);
    // và cũng thôi nạp vào prompt
    expect((await getConversation('c1', db))?.remembered).toBe(false);
  });

  it('bỏ chọn "cho AI nhớ" cũng thu hồi', async () => {
    await putConversation(conv({ id: 'c2', remembered: true }), db);
    await putMemory(memOfConv('c2'), db);
    expect((await setConversationRemembered('c2', false, db)).deleted).toBe(1);
    expect(await listMemories({}, db)).toHaveLength(0);
  });

  it('xoá hội thoại thì xoá luôn ký ức nó đẻ ra', async () => {
    await putConversation(conv({ id: 'c3' }), db);
    await putMemory(memOfConv('c3'), db);
    expect((await deleteConversation('c3', db)).deleted).toBe(1);
    expect(await getConversation('c3', db)).toBeUndefined();
    expect(await listMemories({}, db)).toHaveLength(0);
  });

  it('ký ức NGƯỜI DÙNG TỰ GHIM thì giữ lại — ý muốn mới nhất mạnh hơn nguồn gốc', async () => {
    await putConversation(conv({ id: 'c4', pinned: true }), db);
    await putMemory(memOfConv('c4', { text: 'thường' }), db);
    await putMemory(memOfConv('c4', { text: 'đã ghim riêng', pinned: true }), db);

    const res = await setConversationPinned('c4', false, db);
    expect(res).toEqual({ deleted: 1, keptPinned: 1 });
    const left = await listMemories({}, db);
    expect(left.map(m => m.text)).toEqual(['đã ghim riêng']);
  });

  it('thu hồi xoá luôn VECTOR, không để vector mồ côi cho RAG đào lên', async () => {
    await putConversation(conv({ id: 'c5' }), db);
    const m = memOfConv('c5');
    await putMemory(m, db);
    await db.vectors.put({ id: m.id, dims: 4, vec: new ArrayBuffer(16), embedder: 'hash-v1' });
    expect(await db.vectors.count()).toBe(1);
    await revokeMemoriesOfConversation('c5', db);
    expect(await db.vectors.count()).toBe(0);
  });

  it('bật ghim thì KHÔNG xoá gì cả', async () => {
    await putConversation(conv({ id: 'c6' }), db);
    await putMemory(memOfConv('c6'), db);
    expect((await setConversationPinned('c6', true, db)).deleted).toBe(0);
    expect(await listMemories({}, db)).toHaveLength(1);
  });

  it('cuộc không tồn tại / id rỗng ⇒ không ném, không xoá nhầm', async () => {
    await putMemory(memOfConv('con-nao-do'), db);
    expect(await revokeMemoriesOfConversation('', db)).toEqual({ deleted: 0, keptPinned: 0 });
    expect(await setConversationPinned('khong-co', false, db)).toEqual({ deleted: 0, keptPinned: 0 });
    expect(await listMemories({}, db)).toHaveLength(1);
  });
});

describe('(bug 218) chọn NHIỀU cuộc cũ cho AI nhớ', () => {
  it('đặt cả tập một lần; cuộc rời khỏi tập bị thu hồi', async () => {
    await putConversation(conv({ id: 'x', remembered: true }), db);
    await putConversation(conv({ id: 'y' }), db);
    await putConversation(conv({ id: 'z' }), db);
    await putMemory(memOfConv('x'), db);

    const res = await setRememberedSet(['y', 'z'], db);
    expect(res.deleted).toBe(1);                       // 'x' bị bỏ ⇒ thu hồi
    const nho = await listRememberedConversations({}, db);
    expect(nho.map(c => c.id).sort()).toEqual(['y', 'z']);
  });

  it('đặt lại đúng tập cũ thì không đụng gì', async () => {
    await putConversation(conv({ id: 'p', remembered: true }), db);
    await putMemory(memOfConv('p'), db);
    expect(await setRememberedSet(['p'], db)).toEqual({ deleted: 0, keptPinned: 0 });
    expect(await listMemories({}, db)).toHaveLength(1);
  });

  it('đặt tập RỖNG = thôi nhớ hết', async () => {
    await putConversation(conv({ id: 'q', remembered: true }), db);
    await putMemory(memOfConv('q'), db);
    expect((await setRememberedSet([], db)).deleted).toBe(1);
    expect(await listRememberedConversations({}, db)).toHaveLength(0);
  });
});

describe('(bug 218) khối văn bản nạp vào prompt', () => {
  it('rỗng khi không chọn cuộc nào — không chèn tiêu đề trống vào prompt', () => {
    expect(buildRememberedBlock([])).toBe('');
  });

  it('có tiêu đề cuộc và nội dung hai vai', () => {
    const s = buildRememberedBlock([conv({ title: 'Quy ước dịch' })]);
    expect(s).toContain('Quy ước dịch');
    expect(s).toContain('User:');
    expect(s).toContain('Trợ Lý:');
  });

  it('vượt trần thì lược cuộc CŨ hơn, giữ trọn cuộc mới nhất, và NÓI RÕ đã lược', () => {
    const moi = conv({ title: 'MỚI', updatedAt: 9_000, messages: [{ role: 'user', content: 'm'.repeat(300) }] });
    const cu = conv({ title: 'CŨ', updatedAt: 1_000, messages: [{ role: 'user', content: 'c'.repeat(300) }] });
    const s = buildRememberedBlock([cu, moi], 400);
    expect(s).toContain('MỚI');
    expect(s).not.toContain('CŨ');
    expect(s).toContain('Đã lược 1 cuộc');
  });

  it('trần quá nhỏ để chứa cả cuộc mới nhất ⇒ trả rỗng, không trả khối cụt', () => {
    expect(buildRememberedBlock([conv({ messages: [{ role: 'user', content: 'x'.repeat(500) }] })], 50)).toBe('');
  });
});
