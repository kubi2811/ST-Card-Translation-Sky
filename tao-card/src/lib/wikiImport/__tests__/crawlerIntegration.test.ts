import { describe, it, expect } from 'vitest';
import { crawlWiki, initCrawlState } from '../crawler';
import { FetchClient } from '../fetchClient';
import type { CrawlState, FetchLike } from '../types';

/**
 * (bug 122 — "check hoạt động tốt") Tích hợp crawler + fetchClient trên MINI-WIKI GIẢ LẬP:
 * fetch inject, không cần mạng — depth, dedup, link chết, meta page, resume đều kiểm được thật.
 */

const page = (title: string, links: string[]) => `<!DOCTYPE html><html><head><title>${title}</title></head>
<body><h1>${title}</h1>
<p>Nội dung của ${title}. ${'Thông tin lore quan trọng đủ dài để không bị coi là stub. '.repeat(4)}</p>
${links.map(l => `<a href="${l}">${l}</a>`).join('\n')}
</body></html>`;

/** Mini-wiki: Root → A,B,Category:C; A → A1(chết), B; Category:C → C1; User:X bị cấm. */
const SITE: Record<string, string> = {
  'https://mini.fandom.com/wiki/Root': page('Root', ['/wiki/A', '/wiki/B', '/wiki/Category:C', '/wiki/User:X', 'https://other.fandom.com/wiki/External']),
  'https://mini.fandom.com/wiki/A': page('A', ['/wiki/A1', '/wiki/B']),
  'https://mini.fandom.com/wiki/B': page('B', ['/wiki/Root']),          // vòng lặp về Root
  'https://mini.fandom.com/wiki/Category:C': page('Category:C', ['/wiki/C1']),
  'https://mini.fandom.com/wiki/C1': page('C1', []),
  'https://mini.fandom.com/wiki/User:X': page('User:X', []),
  // A1 KHÔNG có trong SITE → link chết
};

let fetchCalls: string[] = [];
const fakeFetch: FetchLike = async (url) => {
  // Bóc URL thật khỏi proxy wrapper
  let real = url;
  const m = url.match(/[?&](?:url|value)=([^&]+)/);
  if (m) real = decodeURIComponent(m[1]);
  fetchCalls.push(real);
  const body = SITE[real];
  return {
    ok: body !== undefined,
    status: body !== undefined ? 200 : 404,
    url: real,
    text: async () => body ?? 'not found',
  };
};

const mkCtl = () => {
  const logs: string[] = [];
  return {
    logs,
    ctl: {
      log: (m: string) => logs.push(m),
      onProgress: () => {},
    },
  };
};

const run = async (maxDepth: number, maxPages = 50, prev?: CrawlState) => {
  fetchCalls = [];
  const client = new FetchClient({ fetchImpl: fakeFetch, minHostIntervalMs: 0, timeoutMs: 2000 });
  const state = initCrawlState('https://mini.fandom.com/wiki/Root', prev ?? null);
  const { ctl, logs } = mkCtl();
  const pages = await crawlWiki(
    { startUrl: 'https://mini.fandom.com/wiki/Root', maxDepth, maxPages, canonOnly: false, autoExpand: true },
    client, ctl, state,
  );
  return { pages, state, logs };
};

describe('crawler tích hợp trên mini-wiki giả lập', () => {
  it('depth 2: cào Root + A + B; KHÔNG cào User page, KHÔNG cào external, KHÔNG lặp vòng Root', async () => {
    const { pages } = await run(2);
    const titles = pages.map(p => p.title).sort();
    expect(titles).toContain('Root');
    expect(titles).toContain('A');
    expect(titles).toContain('B');
    expect(titles).not.toContain('User:X');
    expect(titles).not.toContain('External');
    // Root chỉ xuất hiện MỘT lần dù B link ngược về nó
    expect(pages.filter(p => p.title === 'Root')).toHaveLength(1);
  });

  it('category được bóc member: C1 vào kết quả nhưng CHÍNH category thì không thành trang', async () => {
    const { pages } = await run(3);
    const titles = pages.map(p => p.title);
    expect(titles).toContain('C1');
    expect(titles.filter(t => t.startsWith('Category:'))).toHaveLength(0);
  });

  it('link chết (A1) bị ghi vào dead, crawl vẫn đi tiếp — không chết cả lượt', async () => {
    const { pages, state, logs } = await run(3);
    expect(state.dead.some(u => u.includes('/wiki/A1'))).toBe(true);
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(logs.some(l => l.includes('Bỏ trang lỗi'))).toBe(true);
  });

  it('mỗi URL SỐNG chỉ fetch MỘT lần (visited-set + cache không thủng; URL chết được thử nhiều proxy là đúng)', async () => {
    await run(3);
    const alive = fetchCalls.filter(u => SITE[u] !== undefined);
    expect(alive.length).toBe(new Set(alive).size);
  });

  it('maxPages chặn đúng trần', async () => {
    const { pages } = await run(3, 2);
    expect(pages.length).toBeLessThanOrEqual(2);
  });

  it('RESUME: chạy dở (trần 2 trang) rồi tiếp tục với state cũ → không cào lại trang đã có', async () => {
    const first = await run(3, 2);
    expect(first.pages).toHaveLength(2);
    const firstUrls = new Set(first.state.visited);

    // Tiếp tục từ state cũ, trần đầy đủ
    fetchCalls = [];
    const second = await run(3, 50, first.state);
    // Trang cũ vẫn còn (không mất), có thêm trang mới
    expect(second.pages.length).toBeGreaterThan(2);
    // Không fetch lại trang đã visited
    for (const u of fetchCalls) {
      expect(firstUrls.has(u), `đã cào rồi mà còn fetch lại: ${u}`).toBe(false);
    }
  });
});
