/**
 * src/lib/wikiImport/index.ts — runWikiImport: điểm vào duy nhất của bộ Wiki Importer mới.
 * ─────────────────────────────────────────────────────────────────────────
 * Pha 1 CRAWL: BFS toàn wiki (crawler.ts) — resume qua localStorage theo URL.
 * Pha 2 GENERATE: coordinator chia trang thành batch TẤT ĐỊNH → worker song song → mỗi entry
 * qua 3 cửa: claim tiêu đề → FactIndex (trùng nội dung) → isDuplicateEntry (identity/Jaccard/
 * RAG, việc 90) + sàn ký tự — rồi mới vào lorebook.
 */

import type { CharacterCardV3, GenerationParams, LorebookEntry, ProxyProfile } from '../../types';
import type { CrawlState, WikiImportConfig, WikiImportControl } from './types';
import { FetchClient } from './fetchClient';
import { crawlWiki, initCrawlState } from './crawler';
import { partitionPages, buildBatchSource, createClaimStore } from './coordinator';
import { FactIndex } from './factIndex';
import { buildWikiEntrySystemPrompt, buildWikiEntryUserPrompt } from './entryGen';
import { callAI, computePoolConcurrency } from '../ai/client';
import { tryExtractJsonArray } from '../ai/batchGenerator';
import { isDuplicateEntry } from '../ai/deduplicator';
import { materializeEntry, nextEntryId } from '../converters/cardDefaults';
import { TFIDFIndex } from '../rag/tfidfIndexer';

export interface WikiImportDeps {
  card: CharacterCardV3;
  profile: ProxyProfile;
  generationParams: GenerationParams;
  appendEntry: (entry: LorebookEntry) => void;
}

const stateKey = (url: string) => `wikiImport.state.${url.slice(0, 180)}`;

export function loadCrawlState(url: string): CrawlState | null {
  try {
    const raw = localStorage.getItem(stateKey(url));
    return raw ? (JSON.parse(raw) as CrawlState) : null;
  } catch { return null; }
}

export function saveCrawlState(url: string, s: CrawlState): void {
  try { localStorage.setItem(stateKey(url), JSON.stringify(s)); }
  catch { /* quota — resume mất nhưng import vẫn chạy */ }
}

export function clearCrawlState(url: string): void {
  try { localStorage.removeItem(stateKey(url)); } catch { /* ignore */ }
}

export interface WikiImportResult {
  pagesCrawled: number;
  entriesCreated: number;
  droppedDuplicate: number;
  droppedThin: number;
}

export async function runWikiImport(
  config: WikiImportConfig,
  deps: WikiImportDeps,
  ctl: WikiImportControl,
): Promise<WikiImportResult> {
  const client = new FetchClient();

  /* ─── Pha 1: CRAWL ─── */
  ctl.log(`🕸️ Bắt đầu cào: ${config.url} (depth ${config.maxDepth}, trần ${config.maxPages} trang${config.canonOnly ? ', chỉ canon' : ''})`);
  const state = initCrawlState(config.url, loadCrawlState(config.url));
  if (state.pages.length > 0) ctl.log(`▶️ Tiếp tục từ lần trước: đã có ${state.pages.length} trang, hàng đợi ${state.queue.length}.`);

  const pages = await crawlWiki(
    { startUrl: config.url, maxDepth: config.maxDepth, maxPages: config.maxPages, canonOnly: config.canonOnly, autoExpand: config.autoExpand },
    client, ctl, state,
    (s) => saveCrawlState(config.url, s),
  );
  if (pages.length === 0) {
    // (bug 133) Bản cũ đoán "wiki có thể chặn mọi proxy" — câu đó đúng kiểu gì cũng nói được
    // nên chẳng giúp chẩn đoán, và lần này thủ phạm thật lại là tool gọi sai đường proxy nội
    // bộ. Nay nêu ĐÍCH DANH từng đường đã thử và lý do hỏng của nó.
    const why = client.failureReasons();
    throw new Error(
      'Không cào được trang nào. Đã thử các đường sau:\n' +
      (why.length ? why.map(r => `  • ${r}`).join('\n') : '  • (không có đường nào chạy được)') +
      '\nKiểm tra lại URL, hoặc mở tool bằng dev server (npm run dev) để dùng proxy nội bộ.',
    );
  }
  ctl.log(`✅ Cào xong ${pages.length} trang qua đường "${client.successTransport() ?? '?'}" (${state.dead.length} trang lỗi đã bỏ qua).`);

  /* ─── Pha 2: GENERATE — batch song song, dữ liệu tách hẳn ─── */
  const entriesTarget = config.totalEntries;
  const nBatches = Math.max(1, Math.min(config.concurrentBatches, pages.length));
  const parts = partitionPages(pages, nBatches);
  const perBatch = Math.ceil(entriesTarget / parts.length);

  // Bộ nhớ chung (bug 121: MEMORY): claim tiêu đề + fact index + lorebook hiện có.
  const book = deps.card.data.character_book?.entries ?? [];
  const claims = createClaimStore(book.map(e => e.comment || ''));
  const facts = new FactIndex();
  for (const e of book) facts.add(`book:${e.id}`, `${e.comment}\n${e.content}`);
  const ragIndex = new TFIDFIndex();
  ragIndex.indexWithSource(book);

  let created = 0, droppedDuplicate = 0, droppedThin = 0;
  const minChars = config.tokensPerEntry > 0 ? Math.round(config.tokensPerEntry * 3.5 * 0.6) : 200;
  const t0 = Date.now();

  const progress = (note?: string) => ctl.onProgress({
    phase: 'generate',
    pagesCrawled: pages.length, pagesQueued: 0, pagesDead: state.dead.length,
    etaSeconds: created > 0 ? Math.round(((Date.now() - t0) / created) * Math.max(0, entriesTarget - created) / 1000) : null,
    entriesCreated: created, entriesTarget, note,
  });

  const system = buildWikiEntrySystemPrompt(config.tokensPerEntry);
  const concurrency = Math.max(1, Math.min(nBatches, computePoolConcurrency(deps.profile)));

  let cursor = 0;
  const runBatch = async (batchIdx: number): Promise<void> => {
    const myPages = parts[batchIdx];
    if (!myPages?.length || created >= entriesTarget) return;
    while (ctl.isPaused?.()) {
      await new Promise(r => setTimeout(r, 300));
      if (ctl.signal?.aborted) throw new Error('Cancelled');
    }
    if (ctl.signal?.aborted) throw new Error('Cancelled');

    progress(`batch ${batchIdx + 1}/${parts.length}: ${myPages.length} trang`);
    const user = buildWikiEntryUserPrompt({
      source: buildBatchSource(myPages),
      count: perBatch,
      laneIndex: batchIdx + 1,
      laneTotal: parts.length,
      claimedTitles: [...claims.titles],
      extraInstructions: config.extraInstructions,
    });

    let raw: string;
    try {
      const res = await callAI({
        profile: deps.profile, params: deps.generationParams, signal: ctl.signal,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      raw = res.text;
    } catch (e) {
      if (ctl.signal?.aborted || (e as Error).message === 'Cancelled') throw new Error('Cancelled');
      ctl.log(`⚠️ Batch ${batchIdx + 1} lỗi AI: ${(e as Error).message} — bỏ batch, đi tiếp.`);
      return;
    }

    const items = tryExtractJsonArray(raw) ?? [];
    for (const ai of items) {
      if (created >= entriesTarget) break;
      const title = String(ai.comment || '').trim();
      const content = String(ai.content || '').trim();

      if (content.length < minChars) { droppedThin++; ctl.log(`⏭️ "${title}" quá mỏng (${content.length}/${minChars} ký tự) — bỏ.`); continue; }
      // Cửa 1: claim tiêu đề — batch khác đã nhận thì thôi.
      if (!claims.claim(title)) { droppedDuplicate++; ctl.log(`⏭️ "${title}" — thực thể đã có entry, bỏ.`); continue; }
      // Cửa 2: trùng NỘI DUNG (khác cách diễn đạt vẫn bắt).
      const factDup = facts.isDuplicate(`${title}\n${content}`);
      if (factDup.dup) { droppedDuplicate++; ctl.log(`⏭️ "${title}" trùng nội dung với ${factDup.with} (${(factDup.score! * 100).toFixed(0)}%) — bỏ.`); continue; }
      // Cửa 3: bộ lọc 4 lớp dùng chung với Auto Creator/Batch (việc 90).
      const dup = isDuplicateEntry(ai, deps.card.data.character_book?.entries ?? [], ragIndex);
      if (dup.isDuplicate) { droppedDuplicate++; ctl.log(`⏭️ "${title}" trùng với "${dup.conflictWith}" (${dup.reason}) — bỏ.`); continue; }

      const id = nextEntryId(deps.card.data.character_book?.entries ?? []);
      const entry = materializeEntry(
        { ...ai, insertion_order: config.insertionOrderStart + created },
        {
          category: 'custom', cardType: 'single',
          defaultPosition: config.defaultPosition,
          insertionOrderStart: config.insertionOrderStart + created,
        },
        id,
      );
      deps.appendEntry(entry);
      deps.card.data.character_book!.entries.push(entry);
      facts.add(`new:${id}`, `${title}\n${content}`);
      ragIndex.indexWithSource(deps.card.data.character_book!.entries);
      created++;
      ctl.log(`✅ [batch ${batchIdx + 1}] "${title}" (${entry.keys.join(', ')})`);
      progress();
    }
  };

  // Pool song song đơn giản: concurrency worker kéo batch kế tiếp từ cursor.
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < parts.length) {
      const mine = cursor++;
      await runBatch(mine);
    }
  });
  await Promise.all(workers);

  clearCrawlState(config.url);
  ctl.onProgress({
    phase: 'done', pagesCrawled: pages.length, pagesQueued: 0, pagesDead: state.dead.length,
    etaSeconds: 0, entriesCreated: created, entriesTarget,
  });
  ctl.log(`🎉 Xong: ${created} entry từ ${pages.length} trang (loại ${droppedDuplicate} trùng, ${droppedThin} mỏng).`);
  return { pagesCrawled: pages.length, entriesCreated: created, droppedDuplicate, droppedThin };
}
