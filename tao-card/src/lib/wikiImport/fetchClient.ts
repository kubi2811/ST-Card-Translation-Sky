/**
 * src/lib/wikiImport/fetchClient.ts — TẢI TRANG: nhiều ĐƯỜNG ĐI + retry + rate-limit + cache.
 * ─────────────────────────────────────────────────────────────────────────
 * (bug 121: "retry khi request lỗi · giới hạn request tránh rate limit · cache trang đã tải ·
 * bỏ qua trang lỗi nhưng tiếp tục crawl")
 *
 * ═══ (bug 133/135) "KHÔNG CÀO ĐƯỢC TRANG NÀO — WIKI CÓ THỂ CHẶN MỌI PROXY" ═══
 * Ảnh user gửi: cào lordofthemysteries.fandom.com, MỌI trang đều đỏ. Đọc code thì lỗi không
 * nằm ở chỗ "wiki chặn" mà ở chính tool:
 *
 *  1. GỌI SAI ĐƯỜNG PROXY NỘI BỘ. Bản cũ gọi `/cors-proxy?url=…`, trong khi middleware của
 *     Vite (vite.config.ts) phục vụ ở `/api/cors-proxy/<url-đã-encode>`. Đường sai ⇒ Vite trả
 *     trang index.html (200 OK, dài hơn 50 ký tự) hoặc 404 ⇒ đường ĐÁNG TIN NHẤT (chạy phía
 *     máy chủ, không dính CORS, không bị Cloudflare của Fandom soi) không bao giờ được dùng.
 *     Còn lại chỉ có `direct` (trình duyệt chặn vì CORS) và 4 proxy công cộng — mà proxy công
 *     cộng thì Fandom rate-limit/chặn thường xuyên. Nên "chặn mọi proxy" là TRIỆU CHỨNG.
 *
 *  2. THIẾU ĐƯỜNG CHÍNH THỐNG. MediaWiki (Fandom, Wikipedia, wiki.gg, Miraheze…) có sẵn API
 *     cho phép CORS: `api.php?action=parse&origin=*` trả `Access-Control-Allow-Origin: *`,
 *     tức TRÌNH DUYỆT GỌI THẲNG ĐƯỢC, không cần proxy nào cả. Đây là đường lách tốt nhất và
 *     cũng nhẹ hơn tải HTML đầy đủ. Bản cũ không hề dùng.
 *
 *  3. IM LẶNG KHI HỎNG. `if (!res.ok) continue` nuốt sạch mã lỗi, nên người dùng chỉ nhận một
 *     câu chung chung. Nay mỗi đường đi ghi lại lý do thật (404/403/timeout/CORS) và câu báo
 *     lỗi cuối nêu đích danh từng đường đã thử.
 *
 * Thứ tự đường đi: mw-api (CORS-safe) → local proxy (server-side) → direct → 5 proxy công cộng.
 * fetch inject được (FetchLike) để test không cần mạng.
 */

import type { FetchLike } from './types';

/** Một ĐƯỜNG ĐI tới nội dung trang. */
interface Transport {
  id: string;
  /** URL thật sẽ fetch — trả null nghĩa là đường này không áp dụng cho URL đó. */
  build: (url: string) => string | null;
  /** Bóc HTML bài viết ra khỏi phần vỏ (JSON của API/proxy). Trả null = phản hồi không dùng được. */
  unwrap?: (text: string, url: string) => string | null;
}

/** Tách {origin, title} của một URL bài MediaWiki dạng /wiki/Tiêu_Đề. */
function parseMwArticle(url: string): { origin: string; title: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const path = decodeURIComponent(u.pathname);
  const m = path.match(/^\/(?:wiki|index\.php\/)\/(.+)$/);
  const title = m?.[1] ?? (u.searchParams.get('title') ?? '');
  if (!title) return null;
  return { origin: `${u.protocol}//${u.host}`, title };
}

/**
 * Dựng HTML tương đương trang thật từ phản hồi `action=parse` để htmlExtract xử lý y như khi
 * tải HTML đầy đủ: nội dung nằm trong `.mw-parser-output`, tiêu đề ở `#firstHeading`,
 * thể loại ở `#catlinks` — đúng ba mỏ neo mà htmlExtract tìm.
 */
function mwParseToHtml(json: string): string | null {
  let data: {
    parse?: { title?: string; text?: string | { '*': string }; categories?: Array<string | { '*'?: string; category?: string }> };
    error?: { info?: string };
  };
  try { data = JSON.parse(json); } catch { return null; }
  const p = data.parse;
  if (!p) return null;
  const body = typeof p.text === 'string' ? p.text : p.text?.['*'];
  if (!body || body.length < 50) return null;

  const cats = (p.categories ?? [])
    .map(c => (typeof c === 'string' ? c : (c['*'] ?? c.category ?? '')))
    .filter(Boolean)
    .map(c => `<a href="/wiki/Category:${encodeURIComponent(String(c))}">${String(c).replace(/_/g, ' ')}</a>`)
    .join('');

  const title = (p.title ?? '').replace(/[<>]/g, '');
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>` +
    `<h1 id="firstHeading">${title}</h1>` +
    `<div id="mw-content-text"><div class="mw-parser-output">${body}</div></div>` +
    (cats ? `<div id="catlinks">${cats}</div>` : '') +
    `</body></html>`;
}

const TRANSPORTS: Transport[] = [
  // 1. API MediaWiki với origin=* — CORS-safe, gọi thẳng, KHÔNG qua proxy nào.
  //    Đây là đường lách chính cho Fandom/Wikipedia/wiki.gg/Miraheze khi proxy bị chặn.
  {
    id: 'mw-api',
    build: (url) => {
      const a = parseMwArticle(url);
      if (!a) return null;
      const q = new URLSearchParams({
        action: 'parse', page: a.title, prop: 'text|categories',
        format: 'json', formatversion: '2', redirects: '1',
      });
      // `origin=*` phải để THÔ: MediaWiki so khớp chuỗi nguyên bản, encode thành %2A là API
      // trả lỗi "origin does not match" và mất luôn header CORS.
      return `${a.origin}/api.php?${q}&origin=*`;
    },
    unwrap: (text) => mwParseToHtml(text),
  },
  // 2. Proxy nội bộ của chính dev server — chạy phía Node nên KHÔNG dính CORS và không bị
  //    Cloudflare soi như request trình duyệt. Đường đáng tin nhất khi tool chạy local.
  { id: 'local-proxy', build: (url) => `/api/cors-proxy/${encodeURIComponent(url)}` },
  // 3. Gọi thẳng — chỉ chạy được với wiki tự bật CORS.
  { id: 'direct', build: (url) => url },
  // 4+. Proxy công cộng (hay rate-limit, để cuối).
  { id: 'codetabs', build: (url) => `https://api.codetabs.com/v1/proxy?value=${encodeURIComponent(url)}` },
  { id: 'corsproxy.io', build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
  {
    id: 'allorigins',
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    unwrap: (text) => {
      // allorigins/raw thường trả thẳng body, nhưng có lúc bọc JSON {contents}.
      try {
        const parsed = JSON.parse(text) as { contents?: string };
        return parsed.contents ?? text;
      } catch { return text; }
    },
  },
  { id: 'cors.lol', build: (url) => `https://cors.lol/?url=${encodeURIComponent(url)}` },
  { id: 'thingproxy', build: (url) => `https://thingproxy.freeboard.io/fetch/${url}` },
];

export interface FetchClientOptions {
  fetchImpl?: FetchLike;
  /** Khoảng cách tối thiểu giữa 2 request tới CÙNG host (ms). */
  minHostIntervalMs?: number;
  /** Hạn chờ cho MỘT đường đi. */
  timeoutMs?: number;
  /**
   * (bug 229) Trần thời gian cho TOÀN BỘ một URL, tính chung mọi đường đi.
   * Không có nó thì một trang chết đốt 8 × timeoutMs — đo được 164 giây với timeout 20s — và
   * người dùng thấy y như treo vì crawler chạy tuần tự.
   */
  urlBudgetMs?: number;
}

export class FetchClient {
  private cache = new Map<string, string>();
  private lastHitByHost = new Map<string, number>();
  private fetchImpl: FetchLike;
  private minInterval: number;
  private timeoutMs: number;
  private urlBudgetMs: number;
  /** Đường nào vừa thành công thì ưu tiên dùng lại — đỡ đốt 20s timeout mỗi trang. */
  private preferred = 0;
  /** Lý do hỏng của lần get() gần nhất, theo từng đường — để báo lỗi nói được điều gì thật. */
  private lastFailures: string[] = [];
  /** Đường đã dùng thành công gần nhất (hiện trong log để user biết tool đang đi lối nào). */
  private lastOkTransport: string | null = null;

  constructor(opts: FetchClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.minInterval = opts.minHostIntervalMs ?? 350;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.urlBudgetMs = opts.urlBudgetMs ?? 30000;
  }

  cacheSize(): number { return this.cache.size; }
  /** Lý do hỏng của lần get() gần nhất ("mw-api: 404", "local-proxy: timeout"…). */
  failureReasons(): string[] { return [...this.lastFailures]; }
  successTransport(): string | null { return this.lastOkTransport; }

  private async throttle(url: string, signal?: AbortSignal): Promise<void> {
    let host = '';
    try { host = new URL(url).host; } catch { /* url tương đối (local proxy) — không throttle */ }
    if (!host) return;
    const last = this.lastHitByHost.get(host) ?? 0;
    const wait = last + this.minInterval - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (signal?.aborted) throw new Error('Cancelled');
    this.lastHitByHost.set(host, Date.now());
  }

  /**
   * (bug 229) ĐỌC TRỌN phản hồi trong ĐÚNG MỘT hạn chờ — đây là gốc của "đang cào thì treo".
   *
   * Bản cũ đua `fetch()` với hạn chờ rồi mới `await res.text()` Ở NGOÀI cuộc đua. Với `fetch`,
   * promise resolve NGAY KHI CÓ HEADER; thân phản hồi về sau. Proxy công cộng quá tải làm đúng
   * cảnh đó: trả 200 tức thì rồi giữ kết nối không đẩy byte nào ⇒ `res.text()` chờ vĩnh viễn,
   * KHÔNG hạn chờ nào phủ tới. Crawler chạy tuần tự nên cả lượt cào đứng im tại URL đó, thanh
   * tiến trình treo nguyên ở tên trang — đúng triệu chứng user báo.
   * Đo được trước khi vá: `timeoutMs` đặt 300ms mà `get()` vẫn chưa trả về sau 3007ms.
   *
   * Nay cả `fetch` LẪN `res.text()` nằm trong cuộc đua, hết giờ thì `ac.abort()` cắt hẳn socket
   * (không cắt thì kết nối chết vẫn treo đó, ăn dần hạn ngạch kết nối của trình duyệt), và hẹn
   * giờ luôn được `clearTimeout` để không rò một timer mỗi trang.
   */
  private async readWithin(
    fetchUrl: string,
    budgetMs: number,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const ac = new AbortController();
    const onOuterAbort = () => ac.abort();
    if (signal?.aborted) throw new Error('Cancelled');
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => { ac.abort(); rej(new Error('timeout')); }, Math.max(1, budgetMs));
      });
      const read = (async () => {
        const res = await this.fetchImpl(fetchUrl, { signal: ac.signal });
        if (!res.ok) return { ok: false, status: res.status, text: '' };
        return { ok: true, status: res.status, text: await res.text() };
      })();
      return await Promise.race([read, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  /**
   * Tải HTML/JSON của một URL. Trả null khi MỌI đường đều hỏng — caller bỏ trang và đi tiếp,
   * không ném lỗi giết cả lượt crawl. Lý do hỏng nằm ở failureReasons().
   */
  async get(url: string, signal?: AbortSignal): Promise<string | null> {
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;

    this.lastFailures = [];
    // (bug 229) NGÂN SÁCH cho cả URL này. Không có nó thì một trang chết đi hết 8 đường × 20s;
    // đo được 164 giây cho MỘT trang — người dùng đọc là "treo, không cào nữa".
    const deadline = Date.now() + this.urlBudgetMs;
    // Thử đường ưu tiên trước, rồi các đường còn lại theo thứ tự.
    const order = [
      this.preferred,
      ...TRANSPORTS.map((_, i) => i).filter(i => i !== this.preferred),
    ];
    for (const idx of order) {
      if (signal?.aborted) throw new Error('Cancelled');
      const left = deadline - Date.now();
      if (left <= 0) {
        this.lastFailures.push(`(hết ngân sách ${this.urlBudgetMs}ms cho trang này — bỏ các đường còn lại)`);
        break;
      }
      const t = TRANSPORTS[idx];
      const fetchUrl = t.build(url);
      if (!fetchUrl) continue;   // đường không áp dụng cho URL này (vd mw-api với Baidu)
      try {
        await this.throttle(url, signal);
        const res = await this.readWithin(fetchUrl, Math.min(this.timeoutMs, deadline - Date.now()), signal);
        if (!res.ok) { this.lastFailures.push(`${t.id}: HTTP ${res.status}`); continue; }
        const text = res.text;
        if (!text || text.trim().length < 50) { this.lastFailures.push(`${t.id}: phản hồi rỗng`); continue; }

        const body = t.unwrap ? t.unwrap(text, url) : text;
        if (!body || body.trim().length < 50) { this.lastFailures.push(`${t.id}: không bóc được nội dung`); continue; }
        // Dev server trả index.html cho MỌI đường dẫn lạ — nhận về trang app thay vì trang wiki
        // là hỏng IM LẶNG (crawl ra toàn rác). Bắt tại đây thay vì để htmlExtract lọt.
        if (isDevServerShell(body)) { this.lastFailures.push(`${t.id}: nhận về trang app (proxy không tồn tại)`); continue; }

        this.preferred = idx;
        this.lastOkTransport = t.id;
        this.cache.set(url, body);
        return body;
      } catch (e) {
        if ((e as Error).message === 'Cancelled' || signal?.aborted) throw new Error('Cancelled', { cause: e });
        // CORS bị chặn thì fetch ném TypeError "Failed to fetch" — ghi lại cho người dùng đọc.
        this.lastFailures.push(`${t.id}: ${(e as Error).message || 'lỗi mạng'}`);
      }
    }
    return null;
  }
}

/**
 * Phản hồi này có phải trang vỏ của chính dev server không (Vite trả index.html cho đường dẫn
 * không khớp middleware nào)? Dấu hiệu: có thẻ nạp module Vite hoặc div gốc của app mà KHÔNG
 * có bất kỳ mỏ neo nội dung wiki nào.
 */
function isDevServerShell(html: string): boolean {
  const head = html.slice(0, 4000);
  const looksApp = /\/@vite\/client|id="root"|<div id="root">/.test(head);
  if (!looksApp) return false;
  return !/mw-parser-output|mw-content-text|firstHeading|class="lemma|<h1/i.test(html);
}
