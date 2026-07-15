// P0 roadmap — kho ký ức IndexedDB: write-through, version conflict, decay, export/import.
// fake-indexeddb giả lập IndexedDB trong Node cho vitest.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetMemoryDbForTest, putMemory, getMemory, touchMemory, deleteMemory,
  listMemories, decayScore, exportMemories, importMemories, newMemoryId,
  type MemoryRecord,
} from '../memoryStore';
import { MemoryCache } from '../memoryCache';

function rec(over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id: newMemoryId(), kind: 'fact', text: 'Long Tộc có 245 mục lorebook',
    source: { origin: 'card', path: 'lorebook[4].content' },
    createdAt: now, updatedAt: now, accessCount: 0, lastAccessAt: now, version: 1,
    ...over,
  };
}

let db: ReturnType<typeof _resetMemoryDbForTest>;
beforeEach(() => { db = _resetMemoryDbForTest(); });

describe('memoryStore — tầng 3 bền vững', () => {
  it('put/get roundtrip giữ nguyên source grounding', async () => {
    const m = rec();
    expect(await putMemory(m, db)).toBe('written');
    const got = await getMemory(m.id, db);
    expect(got?.text).toBe(m.text);
    expect(got?.source.path).toBe('lorebook[4].content'); // truy vết được gốc
  });

  it('version cũ hơn KHÔNG đè bản mới — ghi conflictLog thay vì mất dữ liệu im lặng', async () => {
    const m = rec({ version: 3, text: 'bản mới nhất' });
    await putMemory(m, db);
    const stale = { ...m, version: 2, text: 'bản cũ từ tab khác' };
    expect(await putMemory(stale, db)).toBe('conflict');
    expect((await getMemory(m.id, db))?.text).toBe('bản mới nhất');
    const conflicts = await db.conflicts.toArray();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].reason).toBe('version_lost');
  });

  it('touchMemory tăng accessCount (nuôi decay/LRU) không đổi version', async () => {
    const m = rec();
    await putMemory(m, db);
    await touchMemory(m.id, db);
    await touchMemory(m.id, db);
    const got = await getMemory(m.id, db);
    expect(got?.accessCount).toBe(2);
    expect(got?.version).toBe(1);
  });

  it('listMemories lọc theo kind + cardKey (ký ức chung cardKey rỗng vẫn hiện)', async () => {
    await putMemory(rec({ kind: 'glossary', cardKey: 'cardA', text: 'g1' }), db);
    await putMemory(rec({ kind: 'glossary', cardKey: 'cardB', text: 'g2' }), db);
    await putMemory(rec({ kind: 'glossary', cardKey: '', text: 'g-chung' }), db);
    const rows = await listMemories({ kind: 'glossary', cardKey: 'cardA' }, db);
    expect(rows.map(r => r.text).sort()).toEqual(['g-chung', 'g1']);
  });

  it('deleteMemory xoá cả vector đi kèm', async () => {
    const m = rec();
    await putMemory(m, db);
    await db.vectors.put({ id: m.id, dims: 4, vec: new Float32Array([1, 2, 3, 4]).buffer, embedder: 'hash-v1' });
    await deleteMemory(m.id, db);
    expect(await getMemory(m.id, db)).toBeUndefined();
    expect(await db.vectors.get(m.id)).toBeUndefined();
  });

  it('decayScore: pinned > mới dùng > cũ ít dùng', () => {
    const now = Date.now();
    const pinned = rec({ pinned: true, lastAccessAt: now - 30 * 86_400_000 });
    const fresh = rec({ lastAccessAt: now, accessCount: 5 });
    const stale = rec({ lastAccessAt: now - 60 * 86_400_000, accessCount: 0 });
    expect(decayScore(pinned, now)).toBeGreaterThan(decayScore(fresh, now));
    expect(decayScore(fresh, now)).toBeGreaterThan(decayScore(stale, now));
  });

  it('export → import sang DB khác giữ đủ bản ghi (sao lưu chống trình duyệt dọn IndexedDB)', async () => {
    await putMemory(rec({ text: 'a' }), db);
    await putMemory(rec({ text: 'b' }), db);
    const json = await exportMemories(db);
    const db2 = _resetMemoryDbForTest();
    expect(await importMemories(json, db2)).toBe(2);
    expect((await listMemories({}, db2)).length).toBe(2);
  });
});

describe('MemoryCache — tầng 2 RAM, LRU có pin', () => {
  it('evict bản CŨ NHẤT khi vượt ngân sách; pinned miễn nhiễm; chỉ gỡ RAM', () => {
    const cache = new MemoryCache(100); // ngân sách 100 ký tự
    const a = rec({ id: 'a', text: 'x'.repeat(40), pinned: true });
    const b = rec({ id: 'b', text: 'y'.repeat(40) });
    const c = rec({ id: 'c', text: 'z'.repeat(40) });
    cache.put(a); cache.put(b); cache.put(c); // 120 > 100 → evict b (cũ nhất không pin)
    expect(cache.has('a')).toBe(true);  // pinned giữ nguyên dù cũ nhất
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.getStats().evictions).toBe(1);
  });

  it('get() làm mới vị trí LRU — bản vừa đọc không bị evict trước bản nguội', () => {
    const cache = new MemoryCache(100);
    cache.put(rec({ id: 'a', text: 'x'.repeat(40) }));
    cache.put(rec({ id: 'b', text: 'y'.repeat(40) }));
    cache.get('a'); // a thành "mới nhất"
    cache.put(rec({ id: 'c', text: 'z'.repeat(40) })); // evict b chứ không phải a
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('hit/miss stats đếm đúng (đo hit-rate cho KPI)', () => {
    const cache = new MemoryCache();
    cache.put(rec({ id: 'a' }));
    cache.get('a'); cache.get('a'); cache.get('zzz');
    const s = cache.getStats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
  });
});
