// P1 roadmap — semantic chunker + hash embedding + RAG hybrid query + citation.
import { describe, it, expect } from 'vitest';
import { chunkSemantic } from '../semanticChunker';
import { hashEmbed, dot } from '../embeddings';
import { RagIndex, buildRagContextBlock, extractKeywords, sourceLabelOf } from '../ragEngine';
import type { MemoryRecord } from '../memoryStore';

function mem(id: string, text: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id, kind: 'doc_chunk', text,
    source: { origin: 'attachment', fileName: 'lore.json', part: 'PHẦN 2/9', path: `lorebook[${id}]` },
    createdAt: now, updatedAt: now, accessCount: 0, lastAccessAt: now, version: 1,
    ...over,
  };
}

describe('chunkSemantic — bảo toàn 100% + không cắt code', () => {
  it('join các chunk == văn bản gốc (bất biến sống còn, chuẩn attachmentParts)', () => {
    const text = Array.from({ length: 300 }, (_, i) =>
      i % 7 === 0 ? `\n\nĐoạn mới ${i}. 这是中文句子${i}。` : `Câu số ${i} kết thúc bằng dấu chấm. `,
    ).join('');
    const chunks = chunkSemantic(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map(c => c.text).join('')).toBe(text);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1600 + 200);
  });

  it('khối code fence giữ NGUYÊN 1 chunk, không bị chẻ giữa code', () => {
    const code = '```js\n' + 'const x = 1;\n'.repeat(200) + '```\n';
    const text = 'Giới thiệu ngắn.\n' + code + 'Kết luận.';
    const chunks = chunkSemantic(text);
    const codeChunks = chunks.filter(c => c.isCode);
    expect(codeChunks.length).toBe(1);
    expect(codeChunks[0].text).toBe(code);
    expect(chunks.map(c => c.text).join('')).toBe(text);
  });
});

describe('hashEmbed — near-match hoạt động với CJK + Việt', () => {
  it('câu gần giống có cosine CAO hơn hẳn câu khác chủ đề (bài Translation Memory)', () => {
    const a = hashEmbed('笔记拥有者在笔记上写下目标真实姓名');
    const aNear = hashEmbed('笔记拥有者在笔记上写下目标的真实姓名。');
    const other = hashEmbed('今天天气很好我们去公园散步');
    expect(dot(a, aNear)).toBeGreaterThan(0.8);
    expect(dot(a, other)).toBeLessThan(0.35);
  });

  it('tiếng Việt: cùng chủ đề > khác chủ đề', () => {
    const a = hashEmbed('Độ hảo cảm của nhân vật tăng lên khi tặng quà');
    const near = hashEmbed('tặng quà làm độ hảo cảm nhân vật tăng');
    const far = hashEmbed('cấu hình máy chủ proxy và khóa API');
    expect(dot(a, near)).toBeGreaterThan(dot(a, far) + 0.2);
  });
});

describe('RagIndex — hybrid query + citation', () => {
  it('exact glossary thắng tuyệt đối; kết quả kèm nhãn nguồn truy vết được', () => {
    const idx = new RagIndex();
    idx.add(mem('g1', '青龙 → Thanh Long', { kind: 'glossary', source: { origin: 'user_edit' } }));
    idx.add(mem('d1', '青龙是东方守护神兽，身躯如山，鳞片闪耀'));
    idx.add(mem('d2', 'Hôm nay trời đẹp, nhân vật đi dạo công viên'));
    const hits = idx.query('青龙 dịch là gì?');
    expect(hits[0].record.id).toBe('g1');            // exact glossary đứng đầu
    expect(hits[0].via).toContain('exact');
    const docHit = hits.find(h => h.record.id === 'd1');
    expect(docHit).toBeTruthy();                      // doc liên quan cũng vào top
    expect(docHit!.sourceLabel).toContain('lore.json (PHẦN 2/9)'); // citation
    expect(hits.find(h => h.record.id === 'd2')).toBeFalsy(); // rác không lọt
  });

  it('lọc theo cardKey: ký ức card khác bị loại, ký ức chung vẫn qua', () => {
    const idx = new RagIndex();
    idx.add(mem('a', 'Long Tộc có hệ thống tu luyện độc đáo', { cardKey: 'long-toc' }));
    idx.add(mem('b', 'Long Tộc phiên bản khác của card khác', { cardKey: 'card-khac' }));
    idx.add(mem('c', 'Quy tắc chung: Long Tộc luôn viết hoa', { cardKey: '' }));
    const hits = idx.query('Long Tộc tu luyện', { cardKey: 'long-toc' });
    const ids = hits.map(h => h.record.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
    expect(ids).not.toContain('b');
  });

  it('buildRagContextBlock: có nhãn nguồn + lệnh bắt AI trích dẫn; rỗng khi không hit', () => {
    const idx = new RagIndex();
    idx.add(mem('d1', '笔记拥有者书写目标姓名后40秒生效'));
    const block = buildRagContextBlock(idx.query('笔记 姓名 生效'));
    expect(block).toContain('(nguồn: lore.json (PHẦN 2/9) › lorebook[d1])');
    expect(block).toContain('PHẢI ghi kèm nhãn nguồn');
    expect(buildRagContextBlock([])).toBe('');
  });

  it('extractKeywords: bắt cả từ Việt lẫn bigram CJK', () => {
    const kws = extractKeywords('Độ hảo cảm 好感度 tăng');
    expect(kws).toContain('hảo');
    expect(kws).toContain('好感');
    expect(kws).toContain('感度');
  });

  it('sourceLabelOf: đủ file (PHẦN) › path; fallback origin', () => {
    expect(sourceLabelOf(mem('x', 't'))).toBe('lore.json (PHẦN 2/9) › lorebook[x]');
    expect(sourceLabelOf(mem('y', 't', { source: { origin: 'chat' } }))).toBe('chat');
  });
});
