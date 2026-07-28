// (bug 133/135) "Không cào được trang nào — wiki có thể chặn mọi proxy".
// Thủ phạm thật: tool gọi proxy nội bộ SAI ĐƯỜNG (`/cors-proxy?url=` trong khi dev server phục
// vụ ở `/api/cors-proxy/<enc>`), và không hề dùng API MediaWiki vốn cho phép CORS.
// Test khoá cả hai đường đi mới + chống nhận nhầm trang app + báo lý do hỏng.
import { describe, it, expect } from 'vitest';
import { FetchClient } from '../fetchClient';
import { extractPageDoc } from '../htmlExtract';
import { detectPlatform } from '../platform';
import type { FetchLike } from '../types';

const ART = 'https://lordofthemysteries.fandom.com/wiki/Klein_Moretti';

const mkFetch = (handler: (url: string) => { ok: boolean; status: number; body: string } | null): { fn: FetchLike; calls: string[] } => {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const r = handler(url);
    if (!r) return { ok: false, status: 404, url, text: async () => 'not found' };
    return { ok: r.ok, status: r.status, url, text: async () => r.body };
  };
  return { fn, calls };
};

const LONG = 'Klein Moretti là nhân vật chính của Lord of the Mysteries, một Người Chiêm Tinh. '.repeat(4);

describe('(bug 133) đường đi tải trang wiki', () => {
  it('API MediaWiki (origin=*) được thử TRƯỚC — không cần proxy nào, và dựng đúng HTML cho htmlExtract', async () => {
    const { fn, calls } = mkFetch((url) => {
      if (!url.includes('/api.php')) return null;
      return {
        ok: true, status: 200,
        body: JSON.stringify({
          parse: {
            title: 'Klein Moretti',
            text: `<div class="mw-parser-output"><p>${LONG}</p><a href="/wiki/Audrey_Hall">Audrey</a></div>`,
            categories: ['Characters', 'Beyonders'],
          },
        }),
      };
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    const html = await c.get(ART);

    expect(html, 'phải tải được qua API').toBeTruthy();
    // Gọi thẳng api.php của chính wiki — KHÔNG qua proxy công cộng nào.
    expect(calls[0]).toContain('lordofthemysteries.fandom.com/api.php');
    // Cờ CORS ẩn danh của MediaWiki phải là dấu `*` THÔ — encode thành %2A là API từ chối.
    expect(calls[0]).toContain('origin=*');
    expect(calls[0]).not.toContain('origin=%2A');
    expect(calls[0]).toContain('page=Klein_Moretti');
    expect(calls.some(u => u.includes('corsproxy') || u.includes('allorigins'))).toBe(false);
    // HTML dựng ra phải có đúng các mỏ neo htmlExtract tìm.
    expect(html).toContain('mw-parser-output');
    expect(html).toContain('id="firstHeading"');
    expect(html).toContain('id="catlinks"');
    expect(html).toContain('Audrey');
    expect(c.successTransport()).toBe('mw-api');
  });

  it('API hỏng → rơi sang PROXY NỘI BỘ với ĐÚNG đường /api/cors-proxy/<url-encoded> (đây chính là bug)', async () => {
    const { fn, calls } = mkFetch((url) => {
      if (url.includes('/api.php')) return { ok: false, status: 403, body: '' };
      if (url.startsWith('/api/cors-proxy/')) {
        const real = decodeURIComponent(url.slice('/api/cors-proxy/'.length));
        return real === ART ? { ok: true, status: 200, body: `<html><h1>Klein</h1><p>${LONG}</p></html>` } : null;
      }
      return null;
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    const html = await c.get(ART);

    expect(html).toContain('Klein');
    expect(c.successTransport()).toBe('local-proxy');
    // Đường CŨ (sai) tuyệt đối không được dùng nữa.
    expect(calls.some(u => u.startsWith('/cors-proxy?'))).toBe(false);
    expect(calls.some(u => u === `/api/cors-proxy/${encodeURIComponent(ART)}`)).toBe(true);
  });

  it('proxy trả về TRANG APP của dev server (index.html) không bị nhận nhầm là nội dung wiki', async () => {
    const shell = '<!DOCTYPE html><html><head><script type="module" src="/@vite/client"></script></head>'
      + '<body><div id="root"></div></body></html>'.padEnd(400, ' ');
    const { fn } = mkFetch((url) => {
      if (url.startsWith('/api/cors-proxy/')) return { ok: true, status: 200, body: shell };
      return null;   // mọi đường khác 404
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    const html = await c.get(ART);

    expect(html, 'trang app không phải nội dung wiki — phải trả null').toBeNull();
    expect(c.failureReasons().some(r => r.includes('trang app'))).toBe(true);
  });

  it('mọi đường hỏng → trả null kèm LÝ DO từng đường (thay cho câu đoán "wiki chặn mọi proxy")', async () => {
    const { fn } = mkFetch((url) => {
      if (url.includes('/api.php')) return { ok: false, status: 404, body: '' };
      if (url.startsWith('/api/cors-proxy/')) return { ok: false, status: 502, body: '' };
      return { ok: false, status: 429, body: '' };
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });

    expect(await c.get(ART)).toBeNull();
    const why = c.failureReasons().join('\n');
    expect(why).toContain('mw-api: HTTP 404');
    expect(why).toContain('local-proxy: HTTP 502');
    expect(why).toContain('429');           // proxy công cộng bị rate-limit
    expect(c.failureReasons().length).toBeGreaterThanOrEqual(5);
  });

  it('URL không phải MediaWiki (Baidu) thì BỎ QUA đường api.php, không phí một lượt gọi', async () => {
    const BAIDU = 'https://baike.baidu.com/item/克莱恩';
    const { fn, calls } = mkFetch((url) => {
      if (url.startsWith('/api/cors-proxy/')) return { ok: true, status: 200, body: `<html><h1>克莱恩</h1><p>${LONG}</p></html>` };
      return null;
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    await c.get(BAIDU);
    expect(calls.some(u => u.includes('api.php'))).toBe(false);
  });

  it('đường thành công được GHI NHỚ — trang sau đi thẳng đường đó, không dò lại từ đầu', async () => {
    const { fn, calls } = mkFetch((url) => {
      if (url.includes('/api.php')) return { ok: false, status: 403, body: '' };
      if (url.startsWith('/api/cors-proxy/')) return { ok: true, status: 200, body: `<html><h1>T</h1><p>${LONG}</p></html>` };
      return null;
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    await c.get(ART);
    const afterFirst = calls.length;
    await c.get('https://lordofthemysteries.fandom.com/wiki/Audrey_Hall');
    // Trang thứ hai chỉ tốn đúng 1 lượt gọi (đường đã nhớ), không dò lại api.php.
    expect(calls.length - afterFirst).toBe(1);
    expect(calls[calls.length - 1]).toContain('/api/cors-proxy/');
  });

  // Chuỗi đầy đủ: API → HTML dựng lại → PageDoc. Chỉ trả được chuỗi thôi là chưa đủ — crawler
  // còn phải bóc ra title/links/text từ đó thì mới cào tiếp được.
  it('HTML dựng từ API đi trọn qua extractPageDoc: có title, có link nội bộ để cào tiếp', async () => {
    const { fn } = mkFetch((url) => url.includes('/api.php')
      ? {
          ok: true, status: 200,
          body: JSON.stringify({
            parse: {
              title: 'Klein Moretti',
              text: `<div class="mw-parser-output"><p>${LONG}</p>`
                + `<a href="/wiki/Audrey_Hall">Audrey Hall</a><a href="/wiki/User:Bot">bỏ</a></div>`,
              categories: ['Characters'],
            },
          }),
        }
      : null);
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    const html = await c.get(ART);
    const doc = extractPageDoc(html!, ART, detectPlatform(ART), 0);

    expect(doc, 'không dựng được PageDoc từ phản hồi API').toBeTruthy();
    expect(doc!.title).toBe('Klein Moretti');
    expect(doc!.text.length).toBeGreaterThan(80);
    expect(doc!.links.some(l => l.includes('Audrey_Hall')), 'phải giữ link bài để BFS đi tiếp').toBe(true);
    expect(doc!.links.some(l => l.includes('User:')), 'link namespace meta phải bị loại').toBe(false);
  });

  it('cache: cùng URL gọi 2 lần chỉ fetch 1 lần', async () => {
    const { fn, calls } = mkFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ parse: { title: 'K', text: `<div class="mw-parser-output"><p>${LONG}</p></div>` } }) }));
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 500 });
    await c.get(ART);
    const n = calls.length;
    await c.get(ART);
    expect(calls.length).toBe(n);
  });
});
