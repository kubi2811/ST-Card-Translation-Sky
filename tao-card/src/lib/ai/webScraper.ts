/**
 * SOTA Web Search Engine — Robust Multi-Source Web Scraper
 * DuckDuckGo Lite → Wikipedia (Search API → Extract) → Fandom Wiki → Wiktionary
 * Tất cả requests có timeout, retry, fallback proxy tự động
 */
import { FetchClient } from '../wikiImport/fetchClient';

export interface ScraperResult {
  source: string;
  url: string;
  content: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROXY & FETCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * (bug 191) HỢP NHẤT hệ chống-CORS về FetchClient của Wiki Importer.
 *
 * Trước đây web search đi hệ riêng: 3 proxy công cộng + proxy dev, KHÔNG có đường MediaWiki
 * `origin=*` (đường DUY NHẤT trình duyệt gọi thẳng được không cần proxy), không nhớ đường nào
 * vừa sống (mỗi request lại đốt timeout lần lượt từng proxy chết), và hỏng thì im lặng — user
 * chỉ thấy "Không tìm thấy dữ liệu" mà không biết là do CORS. FetchClient (bug 133/135) đã giải
 * đủ các bài đó: 8 đường đi ưu tiên theo độ tin cậy, nhớ đường thành công, throttle theo host,
 * ghi lý do hỏng từng đường. Dùng chung một hệ — sửa một chỗ, cả wiki import lẫn web search hưởng.
 */
const searchClient = new FetchClient({ timeoutMs: 15000, minHostIntervalMs: 250 });

/** Lý do hỏng của lượt fetch gần nhất — để UI/log nói được "vì sao không có kết quả". */
export function searchFailureReasons(): string[] {
  return searchClient.failureReasons();
}

async function fetchWithTimeout(url: string, timeoutMs: number = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch chống CORS: custom proxy của user thử trước (họ chủ động đặt thì tôn trọng),
 * rồi giao cho FetchClient chạy chuỗi 8 đường đi.
 */
async function fetchViaProxy(targetUrl: string, customProxy?: string, timeoutMs: number = 15000): Promise<string | null> {
  if (customProxy && customProxy.trim()) {
    try {
      const res = await fetchWithTimeout(`${customProxy.trim()}${encodeURIComponent(targetUrl)}`, timeoutMs);
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length >= 50) return text;
      }
    } catch { /* custom proxy hỏng → rơi xuống FetchClient */ }
  }
  try {
    return await searchClient.get(targetUrl);
  } catch {
    return null; // 'Cancelled' — caller không truyền signal vào đây nên coi như không có kết quả
  }
}

async function fetchJsonViaProxy<T = unknown>(targetUrl: string, customProxy?: string, timeoutMs?: number): Promise<T | null> {
  const text = await fetchViaProxy(targetUrl, customProxy, timeoutMs);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH SOURCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 1. DuckDuckGo Instant Answer API — trả về abstract từ Wikipedia/sources
 */
async function searchDuckDuckGo(query: string, proxy?: string): Promise<ScraperResult | null> {
  const targetUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const data = await fetchJsonViaProxy<{
    AbstractText?: string;
    AbstractURL?: string;
    Abstract?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  }>(targetUrl, proxy);

  if (!data) return null;

  // Ưu tiên AbstractText
  if (data.AbstractText && data.AbstractText.length > 30) {
    return {
      source: 'DuckDuckGo',
      url: data.AbstractURL || '',
      content: data.AbstractText,
    };
  }

  // Fallback: gom RelatedTopics
  if (data.RelatedTopics && data.RelatedTopics.length > 0) {
    const topics = data.RelatedTopics
      .filter(t => t.Text && t.Text.length > 20)
      .slice(0, 5)
      .map(t => t.Text!)
      .join('\n');
    if (topics.length > 50) {
      return {
        source: 'DuckDuckGo Topics',
        url: data.AbstractURL || '',
        content: topics,
      };
    }
  }

  return null;
}

/**
 * 2. Wikipedia — Dùng Search API tìm bài viết, rồi lấy extract
 * Hỗ trợ cả tiếng Việt (vi) và tiếng Anh (en)
 */
async function searchWikipedia(query: string, proxy?: string): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];

  for (const lang of ['vi', 'en'] as const) {
    // Bước 1: Search để tìm title chính xác
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`;
    const searchData = await fetchJsonViaProxy<{
      query?: { search?: Array<{ title: string; snippet: string }> };
    }>(searchUrl, proxy);

    if (!searchData?.query?.search || searchData.query.search.length === 0) continue;

    // Bước 2: Lấy extract cho kết quả tốt nhất
    const bestTitle = searchData.query.search[0].title;
    const extractUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&titles=${encodeURIComponent(bestTitle)}&origin=*`;
    const extractData = await fetchJsonViaProxy<{
      query?: { pages?: Record<string, { title: string; extract?: string }> };
    }>(extractUrl, proxy);

    if (!extractData?.query?.pages) continue;

    const pages = extractData.query.pages;
    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') continue;

    const page = pages[pageId];
    if (page.extract && page.extract.length > 50) {
      results.push({
        source: `Wikipedia (${lang})`,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        content: page.extract.slice(0, 2000), // Giới hạn 2000 ký tự
      });
      break; // Chỉ lấy 1 kết quả wiki tốt nhất
    }
  }

  return results;
}

/**
 * 3. Fandom Wiki — Tìm kiếm trên Fandom (tốt cho anime, game, tiểu thuyết)
 */
async function searchFandom(query: string, proxy?: string): Promise<ScraperResult | null> {
  // Fandom unified search
  const searchUrl = `https://community.fandom.com/api/v1/Search/CrossWiki?query=${encodeURIComponent(query)}&lang=en&limit=3`;
  const data = await fetchJsonViaProxy<{
    items?: Array<{ snippet: string; url: string; title: string }>;
  }>(searchUrl, proxy, 6000);

  if (!data?.items || data.items.length === 0) return null;

  const best = data.items[0];
  if (best.snippet && best.snippet.length > 30) {
    return {
      source: 'Fandom Wiki',
      url: best.url,
      content: `${best.title}: ${best.snippet.replace(/<[^>]*>/g, '')}`,
    };
  }

  return null;
}

/**
 * 4. Wiktionary — Định nghĩa từ điển (hữu ích cho thuật ngữ chuyên ngành)
 */
async function searchWiktionary(query: string, proxy?: string): Promise<ScraperResult | null> {
  const url = `https://en.wiktionary.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&titles=${encodeURIComponent(query)}&origin=*`;
  const data = await fetchJsonViaProxy<{
    query?: { pages?: Record<string, { title: string; extract?: string }> };
  }>(url, proxy);

  if (!data?.query?.pages) return null;
  const pages = data.query.pages;
  const pageId = Object.keys(pages)[0];
  if (pageId === '-1') return null;

  const page = pages[pageId];
  if (page.extract && page.extract.length > 20) {
    return {
      source: 'Wiktionary',
      url: `https://en.wiktionary.org/wiki/${encodeURIComponent(page.title)}`,
      content: page.extract.slice(0, 1000),
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

export interface CascadeSearchOptions {
  /** URL proxy CORS (để trống = dùng fallback tự động) */
  proxyUrl?: string;
  /** Timeout cho mỗi request (ms) */
  timeoutMs?: number;
  /** Bỏ qua Fandom search */
  skipFandom?: boolean;
  /** Bỏ qua Wiktionary */
  skipWiktionary?: boolean;
}

/**
 * Cascade search — tìm kiếm song song trên nhiều nguồn
 * Trả về danh sách kết quả từ tất cả nguồn tìm được
 */
export async function cascadeSearch(
  query: string,
  proxyUrl?: string,
  options?: CascadeSearchOptions,
): Promise<ScraperResult[]> {
  const proxy = proxyUrl || options?.proxyUrl;
  const results: ScraperResult[] = [];

  // Chạy tất cả nguồn SONG SONG với Promise.allSettled
  const tasks: Array<Promise<ScraperResult | ScraperResult[] | null>> = [
    searchDuckDuckGo(query, proxy),
    searchWikipedia(query, proxy),
  ];

  if (!options?.skipFandom) {
    tasks.push(searchFandom(query, proxy));
  }
  if (!options?.skipWiktionary) {
    tasks.push(searchWiktionary(query, proxy));
  }

  const settled = await Promise.allSettled(tasks);

  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      if (Array.isArray(result.value)) {
        results.push(...result.value);
      } else {
        results.push(result.value);
      }
    }
  }

  // Loại bỏ kết quả trùng lặp (cùng URL)
  const seen = new Set<string>();
  return results.filter(r => {
    if (r.url && seen.has(r.url)) return false;
    if (r.url) seen.add(r.url);
    return true;
  });
}
