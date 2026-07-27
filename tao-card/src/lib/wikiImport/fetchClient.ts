/**
 * src/lib/wikiImport/fetchClient.ts — TẢI TRANG: proxy rotation + retry + rate-limit + cache.
 * ─────────────────────────────────────────────────────────────────────────
 * (bug 121: "retry khi request lỗi · giới hạn request tránh rate limit · cache trang đã tải ·
 * bỏ qua trang lỗi nhưng tiếp tục crawl")
 *
 * Thứ tự proxy tái dùng từ wikiCrawlerEngine (đã chạy ổn qua nhiều wiki thật):
 * local /cors-proxy (dev) → direct → codetabs → corsproxy.io → allorigins → cors.lol.
 * fetch inject được (FetchLike) để test không cần mạng.
 */

import type { FetchLike } from './types';

const PROXY_FACTORIES: Array<(url: string) => string> = [
  (url) => `/cors-proxy?url=${encodeURIComponent(url)}`,
  (url) => url,
  (url) => `https://api.codetabs.com/v1/proxy?value=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://cors.lol/?url=${encodeURIComponent(url)}`,
];

export interface FetchClientOptions {
  fetchImpl?: FetchLike;
  /** Khoảng cách tối thiểu giữa 2 request tới CÙNG host (ms). */
  minHostIntervalMs?: number;
  /** Số lần thử lại mỗi URL (tính cả các proxy khác nhau như một chuỗi thử). */
  timeoutMs?: number;
}

export class FetchClient {
  private cache = new Map<string, string>();
  private lastHitByHost = new Map<string, number>();
  private fetchImpl: FetchLike;
  private minInterval: number;
  private timeoutMs: number;
  /** Proxy nào vừa thành công thì ưu tiên dùng lại — đỡ đốt 20s timeout mỗi trang. */
  private preferredProxy = 0;

  constructor(opts: FetchClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.minInterval = opts.minHostIntervalMs ?? 350;
    this.timeoutMs = opts.timeoutMs ?? 20000;
  }

  cacheSize(): number { return this.cache.size; }

  private async throttle(url: string): Promise<void> {
    let host = '';
    try { host = new URL(url).host; } catch { /* url tương đối (local proxy) — không throttle */ }
    if (!host) return;
    const last = this.lastHitByHost.get(host) ?? 0;
    const wait = last + this.minInterval - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastHitByHost.set(host, Date.now());
  }

  /**
   * Tải HTML/JSON của một URL. Trả null khi MỌI đường đều hỏng — caller bỏ trang và đi tiếp,
   * không ném lỗi giết cả lượt crawl.
   */
  async get(url: string, signal?: AbortSignal): Promise<string | null> {
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;

    // Thử proxy ưu tiên trước, rồi các proxy còn lại theo thứ tự.
    const order = [
      this.preferredProxy,
      ...PROXY_FACTORIES.map((_, i) => i).filter(i => i !== this.preferredProxy),
    ];
    for (const idx of order) {
      if (signal?.aborted) throw new Error('Cancelled');
      const fetchUrl = PROXY_FACTORIES[idx](url);
      try {
        await this.throttle(url);
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), this.timeoutMs));
        const res = await Promise.race([this.fetchImpl(fetchUrl, { signal }), timeout]);
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || text.trim().length < 50) continue;
        // allorigins dạng JSON {contents}
        let body = text;
        if (idx === 4) {
          try {
            const parsed = JSON.parse(text) as { contents?: string };
            if (parsed.contents) body = parsed.contents;
          } catch { /* raw đã là body */ }
        }
        this.preferredProxy = idx;
        this.cache.set(url, body);
        return body;
      } catch (e) {
        if ((e as Error).message === 'Cancelled' || signal?.aborted) throw new Error('Cancelled');
        // proxy này hỏng — thử proxy kế
      }
    }
    return null;
  }
}
