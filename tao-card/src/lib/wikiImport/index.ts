/**
 * src/lib/wikiImport/index.ts — runWikiImport: điểm vào duy nhất của bộ Wiki Importer mới.
 * ─────────────────────────────────────────────────────────────────────────
 * Pha 1 CRAWL: BFS toàn wiki (crawler.ts) — resume qua localStorage theo URL.
 * Pha 2 GENERATE: coordinator chia trang thành batch TẤT ĐỊNH → worker song song → mỗi entry
 * qua 3 cửa: claim tiêu đề → FactIndex (trùng nội dung) → isDuplicateEntry (identity/Jaccard/
 * RAG, việc 90) + ngân sách token — rồi mới vào lorebook.
 *
 * ═══ (bug 229) BỘ NÀY CHƯA HỀ NHẬN BẢN VÁ CỦA BUG 194 ═══
 * User báo: "tạo entries thì bị lỗi không tạo được, nó luôn không tạo theo số token yêu cầu mỗi
 * entry, cũng như luôn bỏ các entry khi không đủ."
 *
 * Lời than đó GIỐNG HỆT bug 194 — và bug 194 đã được sửa rồi, nhưng chỉ sửa trong
 * `batchGenerator.ts` (Auto Creator / sinh theo lô). Bộ Wiki Importer viết trước đó (bug 120/121/
 * 122) đi một đường riêng và giữ nguyên cả BA lỗi mà docblock của `tokenBudget.ts` đã nêu đích danh:
 *
 *   1. SÀN 60% TÍNH THEO KÝ TỰ. `minChars = tokensPerEntry × 3.5 × 0.6`, tức nhận mọi entry dài
 *      từ 60% mục tiêu trở lên. Mô hình vốn luôn viết hụt so với yêu cầu độ dài nên kết quả dồn
 *      hết xuống sát sàn — đúng cảnh "không bao giờ đủ token". Không có gì kéo nó lên.
 *   2. KHÔNG BAO GIỜ ĐẾM TOKEN THẬT, nên chính tool cũng không biết nó đang giao thiếu bao nhiêu,
 *      và không nói được cho user con số nào.
 *   3. `max_tokens` để nguyên con số cố định trong Settings (mặc định 4096) thay vì suy từ
 *      `tokensPerEntry × số entry mỗi lô`. Lô chạm trần thì mô hình KHÔNG báo lỗi — nó tự nén
 *      mỗi entry ngắn lại cho vừa chỗ. Hỏng im lặng đúng nghĩa.
 *
 * Và hai lỗi riêng của bộ này:
 *   4. ENTRY DƯỚI SÀN BỊ VỨT THẲNG, không nới thêm, không sinh bù — "luôn bỏ các entry khi không
 *      đủ". `batchGenerator` cùng cảnh thì nới (45-85%) hoặc ghi nợ để sinh bù; ở đây thì mất hẳn.
 *   5. LÔ HỎNG LÀ BỎ LUÔN. `tryExtractJsonArray(raw) ?? []` không ghi một dòng log nào, còn lỗi
 *      AI thì "bỏ batch, đi tiếp" — không thử lại, không dò output bị cắt, không vòng bù. Ba lô
 *      hỏng là ra 0 entry mà người dùng không biết vì sao.
 *
 * Nay pha GENERATE dùng chung đúng bộ đồ nghề của bug 194: `planBatch` (cỡ lô + trần output),
 * `checkEntryBudget` (đo token thật — THUẦN ĐO, không phán đạt/không đạt), cộng thêm thử lại theo
 * lô và các VÒNG SINH BÙ cho tới khi đủ số entry đã đặt.
 *
 * (User 2026) SÀN ĐỘ DÀI ĐÃ BỎ HẲN — cả ở đây lẫn `batchGenerator`. Sàn dạy mô hình viết vừa chạm
 * mốc rồi dừng, còn cơ chế nới/sinh bù đi kèm biến mỗi entry hụt thành thêm vài lời gọi AI: đúng
 * vòng lặp user than. Ngân sách token nay chỉ còn là định hướng độ chi tiết trong lời nhắc.
 */

import type { CharacterCardV3, GenerationParams, LorebookEntry, ProxyProfile } from '../../types';
import type { CrawlState, PageDoc, WikiImportConfig, WikiImportControl } from './types';
import { FetchClient } from './fetchClient';
import { crawlWiki, initCrawlState } from './crawler';
import { partitionPages, buildBatchSource, createClaimStore } from './coordinator';
import { FactIndex } from './factIndex';
import { buildWikiEntrySystemPrompt, buildWikiEntryUserPrompt } from './entryGen';
import { callAI, computePoolConcurrency } from '../ai/client';
import { tryExtractJsonArray, looksTruncated } from '../ai/batchGenerator';
import { isDuplicateEntry } from '../ai/deduplicator';
import { materializeEntry, nextEntryId } from '../converters/cardDefaults';
import { TFIDFIndex } from '../rag/tfidfIndexer';
import { checkEntryBudget, planBatch } from '../ai/tokenBudget';

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

/**
 * (bug 229) Trả về false khi KHÔNG lưu được, để caller nói ra thay vì nuốt trong im lặng.
 * localStorage trần ~5MB; state của một lượt cào 120 trang đã 5.4MB (đo được) nên từ đó trở đi
 * mọi lần lưu đều ném quota — trước đây `catch {}` nuốt sạch, user F5 là mất trắng mà không hiểu.
 */
export function saveCrawlState(url: string, s: CrawlState): boolean {
  try { localStorage.setItem(stateKey(url), JSON.stringify(s)); return true; }
  catch { return false; }
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

/** Số vòng sinh bù tối đa — chặn vòng lặp vô tận khi AI cứ trả rỗng mãi. */
const MAX_TOPUP_ROUNDS = 6;
/** Số lần thử lại một lô khi AI trả về thứ không đọc được. */
const MAX_BATCH_RETRIES = 2;

/**
 * Pha 2 tách riêng để test được không cần mạng, và để `runWikiImport` chỉ còn việc nối hai pha.
 */
export async function generateEntriesFromPages(
  config: WikiImportConfig,
  pages: PageDoc[],
  deps: WikiImportDeps,
  ctl: WikiImportControl,
  pagesDead = 0,
): Promise<Omit<WikiImportResult, 'pagesCrawled'>> {
  const entriesTarget = Math.max(1, config.totalEntries);

  // (bug 229) `deps.card.data.character_book!.entries.push(...)` của bản cũ là một khẳng định
  // non-null KHÔNG có căn cứ: `addEntry` của store làm việc trên bản structuredClone nên thẻ mà
  // hàm này cầm KHÔNG BAO GIỜ mọc ra `character_book`. Thẻ nhập từ PNG/JSON không kèm lorebook
  // thì thuộc tính đó là undefined, và entry ĐẦU TIÊN qua được bộ lọc sẽ ném TypeError giết cả
  // lượt import — "tạo entries thì bị lỗi không tạo được". Mọi chỗ khác trong repo (cardStore,
  // cardPackager, batchGenerator) đều canh `if (!character_book)`; chỉ chỗ này quên.
  // Nay giữ một danh sách CỤC BỘ, không đụng vào thẻ của store.
  const bookEntries: LorebookEntry[] = [...(deps.card.data.character_book?.entries ?? [])];

  const claims = createClaimStore(bookEntries.map(e => e.comment || ''));
  const facts = new FactIndex();
  for (const e of bookEntries) facts.add(`book:${e.id}`, `${e.comment}\n${e.content}`);
  const ragIndex = new TFIDFIndex();
  ragIndex.indexWithSource(bookEntries);

  let created = 0, droppedDuplicate = 0, droppedThin = 0;
  const t0 = Date.now();

  const progress = (note?: string) => ctl.onProgress({
    phase: 'generate',
    pagesCrawled: pages.length, pagesQueued: 0, pagesDead,
    etaSeconds: created > 0 ? Math.round(((Date.now() - t0) / created) * Math.max(0, entriesTarget - created) / 1000) : null,
    entriesCreated: created, entriesTarget, note,
  });

  const system = buildWikiEntrySystemPrompt(config.tokensPerEntry);

  // (bug 194-3) Cỡ lô và trần output suy TỪ NGÂN SÁCH, không để con số trong Settings quyết định
  // hộ. Trần lấy theo khả năng model (tối thiểu 8192) chứ không theo `max_tokens` user đang để —
  // vì chính con số đó là thứ đang bóp nghẹt kết quả.
  const wantedPerBatch = Math.max(1, Math.ceil(entriesTarget / Math.max(1, config.concurrentBatches)));
  const plan = planBatch(
    config.tokensPerEntry ?? 0,
    wantedPerBatch,
    Math.max(deps.generationParams.max_tokens || 0, 8192),
  );
  if (config.tokensPerEntry > 0 && plan.reduced) {
    ctl.log(
      `📐 Ngân sách ${config.tokensPerEntry} token/entry → rút lô từ ${wantedPerBatch} xuống ` +
      `${plan.entriesPerBatch} entry và nâng trần output lên ${plan.maxTokens} token. ` +
      `Nhồi cả lô vào một lời gọi thì AI tự nén cho vừa, entry nào cũng ngắn.`,
    );
  }
  const callParams: GenerationParams = {
    ...deps.generationParams,
    // tokensPerEntry = 0 nghĩa là "không ép độ dài" — lúc đó `plan.maxTokens` suy ra từ giả định
    // 1 token/entry nên bé tí, không được để nó hạ trần của user xuống.
    max_tokens: config.tokensPerEntry > 0
      ? Math.max(deps.generationParams.max_tokens || 0, plan.maxTokens)
      : (deps.generationParams.max_tokens || 4096),
    useJsonResponseFormat: false,
  };

  const aborted = () => ctl.signal?.aborted === true;
  const waitIfPaused = async () => {
    while (ctl.isPaused?.()) {
      await new Promise(r => setTimeout(r, 300));
      if (aborted()) throw new Error('Cancelled');
    }
    if (aborted()) throw new Error('Cancelled');
  };

  /** Một lô: gọi AI (có thử lại) rồi đưa từng entry qua các cửa. */
  const runBatch = async (myPages: PageDoc[], ask: number, label: string): Promise<void> => {
    if (!myPages.length || created >= entriesTarget) return;
    await waitIfPaused();

    progress(`${label}: ${myPages.length} trang, xin ${ask} entry`);
    const source = buildBatchSource(myPages);

    let items: ReturnType<typeof tryExtractJsonArray> = null;
    let askNow = ask;
    for (let attempt = 0; attempt <= MAX_BATCH_RETRIES && !items; attempt++) {
      if (aborted()) throw new Error('Cancelled');
      const user = buildWikiEntryUserPrompt({
        source, count: askNow, laneIndex: 1, laneTotal: 1,
        claimedTitles: [...claims.titles],
        extraInstructions: config.extraInstructions,
      });
      try {
        const res = await callAI({
          profile: deps.profile, params: callParams, signal: ctl.signal, label: `Wiki ${label}`,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        });
        items = tryExtractJsonArray(res.text);
        if (items?.length) break;

        // (bug 229) Bản cũ viết `tryExtractJsonArray(raw) ?? []` — hỏng ở đây là hỏng CÂM: không
        // một dòng log, lô coi như rỗng, người dùng chỉ thấy "Xong: 0 entry".
        const cutOff = ['length', 'MAX_TOKENS', 'max_tokens'].includes(res.finishReason || '')
          || looksTruncated(res.text);
        const peek = (res.text || '').trim().replace(/\s+/g, ' ').slice(0, 160) || '(rỗng)';
        ctl.log(
          `⚠️ ${label} — không đọc được JSON` +
          (cutOff ? ' (output BỊ CẮT giữa chừng — dài quá trần token của model)' : '') +
          `. AI trả về: «${peek}${(res.text || '').length > 160 ? '…' : ''}»` +
          (attempt < MAX_BATCH_RETRIES ? ' → thử lại…' : ' → hết lượt thử.'),
        );
        // Bị cắt mà thử lại Y NGUYÊN thì lần nào cũng cắt — hạ số entry của lô xuống một nửa.
        if (cutOff && askNow > 1) askNow = Math.max(1, Math.floor(askNow / 2));
      } catch (e) {
        if (aborted() || (e as Error).message === 'Cancelled') throw new Error('Cancelled', { cause: e });
        ctl.log(
          `⚠️ ${label} lỗi AI: ${(e as Error).message}` +
          (attempt < MAX_BATCH_RETRIES ? ' → thử lại…' : ' — bỏ lô này, đi tiếp.'),
        );
      }
    }
    if (!items?.length) return;

    for (const ai of items) {
      if (created >= entriesTarget) break;
      if (aborted()) throw new Error('Cancelled');
      const title = String(ai.comment || '').trim();
      const content = String(ai.content || '').trim();
      if (!title || !content) { droppedThin++; continue; }

      // Cửa 1: claim tiêu đề — lô khác đã nhận thì thôi.
      if (!claims.claim(title)) { droppedDuplicate++; ctl.log(`⏭️ "${title}" — thực thể đã có entry, bỏ.`); continue; }
      // Cửa 2: trùng NỘI DUNG (khác cách diễn đạt vẫn bắt).
      const factDup = facts.isDuplicate(`${title}\n${content}`);
      if (factDup.dup) {
        claims.release(title); droppedDuplicate++;
        ctl.log(`⏭️ "${title}" trùng nội dung với ${factDup.with} (${(factDup.score! * 100).toFixed(0)}%) — bỏ.`);
        continue;
      }
      // Cửa 3: bộ lọc 4 lớp dùng chung với Auto Creator/Batch (việc 90).
      const dup = isDuplicateEntry(ai, bookEntries, ragIndex);
      if (dup.isDuplicate) {
        claims.release(title); droppedDuplicate++;
        ctl.log(`⏭️ "${title}" trùng với "${dup.conflictWith}" (${dup.reason}) — bỏ.`);
        continue;
      }

      // Cửa 4: ĐO độ dài để báo cho user — KHÔNG còn sàn nào (User 2026). Sàn cũ vừa dạy mô hình
      // viết vừa chạm mốc rồi dừng bút, vừa đẻ ra vòng nới/sinh bù không dứt cho mỗi entry hụt.
      const chk = checkEntryBudget(content, config.tokensPerEntry);

      const id = nextEntryId(bookEntries);
      const entry = materializeEntry(
        { ...ai, content, insertion_order: config.insertionOrderStart + created },
        {
          category: 'custom', cardType: 'single',
          defaultPosition: config.defaultPosition,
          insertionOrderStart: config.insertionOrderStart + created,
        },
        id,
      );
      deps.appendEntry(entry);
      bookEntries.push(entry);
      facts.add(`new:${id}`, `${title}\n${content}`);
      ragIndex.indexWithSource(bookEntries);
      created++;
      const budgetNote = chk.target > 0 ? ` — ${chk.actual}/${chk.target} token` : '';
      ctl.log(`✅ [${label}] "${title}"${budgetNote} (${entry.keys.join(', ')})`);
      progress();
    }
  };

  const concurrency = Math.max(1, Math.min(config.concurrentBatches, computePoolConcurrency(deps.profile)));

  // (bug 229) VÒNG SINH BÙ. Bản cũ chạy đúng MỘT lượt: mỗi lô một lời gọi, lô nào hỏng hay trả
  // thiếu thì con số cuối cùng thấp hơn yêu cầu và không có gì bù lại. Nay lặp tới khi đủ hoặc
  // tới khi một vòng trọn vẹn không thêm được entry nào (AI đã cạn nguyên liệu — dừng, không quay
  // vô ích).
  for (let round = 0; round < MAX_TOPUP_ROUNDS && created < entriesTarget; round++) {
    if (aborted()) throw new Error('Cancelled');
    const before = created;
    const shortfall = entriesTarget - created;
    const nTasks = Math.max(1, Math.min(config.concurrentBatches, pages.length, Math.ceil(shortfall / plan.entriesPerBatch)));
    const askPerTask = Math.min(plan.entriesPerBatch, Math.ceil(shortfall / nTasks));

    // Xoay danh sách trang mỗi vòng: `partitionPages` chia round-robin theo chỉ số, nên xoay đi
    // một bậc là các lô nhìn thấy tổ hợp trang khác — vòng bù có nguyên liệu mới thay vì hỏi lại
    // đúng câu hỏi cũ trên đúng tập trang cũ.
    const rotated = round === 0 ? pages : [...pages.slice(round % pages.length), ...pages.slice(0, round % pages.length)];
    const parts = partitionPages(rotated, nTasks);

    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < parts.length && created < entriesTarget) {
        const mine = cursor++;
        await runBatch(parts[mine], askPerTask, round === 0 ? `lô ${mine + 1}/${parts.length}` : `bù ${round}·${mine + 1}`);
      }
    }));

    if (created === before) {
      if (created < entriesTarget) {
        ctl.log(`🛑 Vòng ${round + 1} không thêm được entry nào — nguồn đã cạn, dừng ở ${created}/${entriesTarget}.`);
      }
      break;
    }
    if (created < entriesTarget) {
      ctl.log(`🔁 Mới ${created}/${entriesTarget} entry — sinh bù vòng ${round + 2}.`);
    }
  }

  return { entriesCreated: created, droppedDuplicate, droppedThin };
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

  // (bug 229) Lưu state hỏng thì PHẢI NÓI — im lặng là mất trắng lượt cào khi F5.
  let quotaWarned = false;
  const pages = await crawlWiki(
    { startUrl: config.url, maxDepth: config.maxDepth, maxPages: config.maxPages, canonOnly: config.canonOnly, autoExpand: config.autoExpand },
    client, ctl, state,
    (s) => {
      if (saveCrawlState(config.url, s) || quotaWarned) return;
      quotaWarned = true;
      ctl.log('⚠️ Trạng thái cào đã vượt hạn mức localStorage (~5MB) — lượt cào vẫn chạy bình thường, nhưng F5 giữa chừng sẽ KHÔNG tiếp tục được. Giảm "Trần trang" nếu cần resume.');
    },
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

  /* ─── Pha 2: GENERATE ─── */
  const r = await generateEntriesFromPages(config, pages, deps, ctl, state.dead.length);

  clearCrawlState(config.url);
  ctl.onProgress({
    phase: 'done', pagesCrawled: pages.length, pagesQueued: 0, pagesDead: state.dead.length,
    etaSeconds: 0, entriesCreated: r.entriesCreated, entriesTarget: config.totalEntries,
  });
  ctl.log(`🎉 Xong: ${r.entriesCreated} entry từ ${pages.length} trang (loại ${r.droppedDuplicate} trùng, ${r.droppedThin} mỏng).`);
  return { pagesCrawled: pages.length, ...r };
}
