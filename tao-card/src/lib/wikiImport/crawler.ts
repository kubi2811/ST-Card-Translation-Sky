/**
 * src/lib/wikiImport/crawler.ts — BFS TOÀN WIKI theo depth/maxPages (bug 120+121).
 * ─────────────────────────────────────────────────────────────────────────
 * "Crawl toàn bộ trang gốc + internal links, recursive theo độ sâu; không link chết, không
 * redirect loop, không duplicate page" — visited set trên URL đã normalize; redirect theo
 * final-URL cũng ghi visited nên vòng lặp A→B→A tự đứt. Trang lỗi bị bỏ và crawl đi tiếp.
 * State persist được (resume sau ngắt/F5); tiến trình + ETA cập nhật theo thời gian thực.
 */

import type { CrawlProgress, CrawlState, PageDoc, WikiImportControl } from './types';
import { detectPlatform, isArticleLink, isCategoryUrl, normalizeArticleUrl } from './platform';
import { extractPageDoc } from './htmlExtract';
import type { FetchClient } from './fetchClient';
import { titleMatchesMeta } from '../ai/wikiCrawlerEngine';

export interface CrawlOptions {
  startUrl: string;
  maxDepth: number;
  maxPages: number;
  canonOnly: boolean;
  autoExpand: boolean;
}

const NONCANON_RE = /non-?canon|fanon|fan ?fiction|what.?if|april fools|parody|doujin/i;

/** Một bước resume: dựng state mới hoặc tiếp tục từ state cũ. */
export function initCrawlState(startUrl: string, prev?: CrawlState | null): CrawlState {
  if (prev && prev.queue.length + prev.pages.length > 0) return prev;
  return { visited: [], queue: [[normalizeArticleUrl(startUrl), 0]], pages: [], dead: [] };
}

export async function crawlWiki(
  opts: CrawlOptions,
  client: FetchClient,
  ctl: WikiImportControl,
  state: CrawlState,
  /** Gọi sau MỖI trang để persist state (resume). */
  onState?: (s: CrawlState) => void,
): Promise<PageDoc[]> {
  const wiki = detectPlatform(opts.startUrl);
  const visited = new Set(state.visited);
  const dead = new Set(state.dead);
  // (bug 229) Hàng đợi trước đây nhận link TRÙNG thoải mái — chỉ lọc `visited`, mà trang chưa
  // cào thì chưa visited nên mọi trang cùng trỏ tới một URL đều đẩy thêm một bản. Đo được: 200
  // trang × ~120 link ⇒ hàng đợi 24.000 mục cho chưa tới 200 URL thật, và toàn bộ đống đó bị
  // JSON.stringify lại sau MỖI trang để lưu resume. Một Set là đủ chặn.
  const queued = new Set(state.queue.map(([u]) => u));
  const t0 = Date.now();
  let crawledThisRun = 0;

  const progress = (note?: string): CrawlProgress => {
    const elapsed = (Date.now() - t0) / 1000;
    const perPage = crawledThisRun > 0 ? elapsed / crawledThisRun : null;
    const remain = Math.min(state.queue.length, opts.maxPages - state.pages.length);
    return {
      phase: 'crawl',
      pagesCrawled: state.pages.length,
      pagesQueued: state.queue.length,
      pagesDead: dead.size,
      etaSeconds: perPage !== null && remain > 0 ? Math.round(perPage * remain) : null,
      entriesCreated: 0, entriesTarget: 0, note,
    };
  };

  while (state.queue.length > 0 && state.pages.length < opts.maxPages) {
    if (ctl.signal?.aborted) throw new Error('Cancelled');
    while (ctl.isPaused?.()) {
      await new Promise(r => setTimeout(r, 300));
      if (ctl.signal?.aborted) throw new Error('Cancelled');
    }

    const [url, depth] = state.queue.shift()!;
    queued.delete(url);
    if (visited.has(url) || dead.has(url)) continue;
    visited.add(url);

    ctl.onProgress(progress(url));
    const html = await client.get(url, ctl.signal);
    if (!html) {
      // Link chết / mọi proxy hỏng — bỏ và đi tiếp (bug 121: "bỏ qua trang lỗi nhưng tiếp tục").
      dead.add(url);
      state.dead = [...dead];
      ctl.log(`⚠️ Bỏ trang lỗi: ${url}`);
      continue;
    }

    const doc = extractPageDoc(html, url, wiki, depth);
    if (!doc) { dead.add(url); state.dead = [...dead]; continue; }

    // Redirect: URL cuối trùng trang đã cào → bỏ (chống redirect loop + duplicate).
    if (visited.has(doc.url) && doc.url !== url) continue;
    visited.add(doc.url);

    const isCategory = isCategoryUrl(doc.url);

    // Lọc meta theo TIÊU ĐỀ (tái dùng META_FILTERS của engine cũ — wikimeta luôn bật).
    // CATEGORY được miễn ở đây: keyword 'category:' nằm trong wikimeta nên check trước sẽ
    // vứt category TRƯỚC KHI kịp bóc member — cả nhánh con biến mất (test tích hợp bắt được).
    // Category vẫn không thành PageDoc (nhánh !isCategory bên dưới), chỉ mượn link của nó.
    if (!isCategory && titleMatchesMeta(doc.title, ['wikimeta'])) continue;
    if (opts.canonOnly && (NONCANON_RE.test(doc.title) || doc.categories.some(c => NONCANON_RE.test(c)))) {
      ctl.log(`⏭️ Bỏ non-canon: ${doc.title}`);
      continue;
    }
    if (!isCategory) {
      state.pages.push(doc);
      crawledThisRun++;
    }

    // Nở hàng đợi: depth kế tiếp, trong trần. Category chỉ dùng để bóc member (đi sâu tiếp)
    // chứ không thành PageDoc — "không crawl category rỗng" tự thoả vì rỗng thì không có link.
    const nextDepth = depth + 1;
    const allowExpand = opts.autoExpand || depth === 0;
    if (allowExpand && nextDepth < opts.maxDepth + (isCategory ? 1 : 0)) {
      for (const link of doc.links) {
        if (visited.has(link) || dead.has(link) || queued.has(link)) continue;
        if (!isArticleLink(link, wiki)) continue;
        state.queue.push([link, nextDepth]);
        queued.add(link);
      }
    }

    state.visited = [...visited];
    onState?.(state);
  }

  ctl.onProgress({ ...progress(), phase: 'crawl', note: 'Cào xong' });
  return state.pages;
}
