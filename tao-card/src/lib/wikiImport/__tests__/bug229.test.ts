/**
 * (bug 229) "Cào wiki đang cào thì treo ở đó không cào nữa; tạo entries thì lỗi không tạo được,
 * không tạo theo số token yêu cầu, và luôn bỏ entry khi không đủ."
 *
 * Bốn gốc riêng biệt, mỗi gốc một nhóm test bên dưới:
 *   A. fetchClient — `res.text()` nằm NGOÀI hạn chờ ⇒ thân phản hồi treo thì cả lượt cào treo vĩnh viễn.
 *   B. wikiImport  — chưa hề nhận bản vá bug 194: sàn 60% tính theo KÝ TỰ, không đếm token thật,
 *                    không suy `max_tokens` theo lô, không nới entry ngắn, không sinh bù.
 *   C. wikiImport  — batch hỏng là bỏ luôn, có nhánh còn không ghi một dòng log nào.
 *   D. coordinator — ngân sách nguồn chia đôi liên tiếp nên phần lớn trang đã cào không bao giờ tới AI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchClient } from '../fetchClient';
import { buildBatchSource } from '../coordinator';
import { buildWikiEntrySystemPrompt } from '../entryGen';
import { countTokens } from '../../ai/tokenBudget';
import type { FetchLike, PageDoc } from '../types';
import type { CharacterCardV3, GenerationParams, LorebookEntry, ProxyProfile } from '../../../types';

const ART = 'https://x.fandom.com/wiki/A';

/* ═══════════════════════════ A. TREO GIỮA CHỪNG ═══════════════════════════ */

describe('(bug 229-A) cào wiki treo giữa chừng', () => {
  it('THÂN phản hồi không bao giờ về → get() vẫn phải bỏ cuộc theo hạn chờ (đây chính là chỗ treo)', async () => {
    // Proxy công cộng quá tải hay làm đúng thế này: trả header 200 ngay rồi giữ kết nối, không
    // đẩy byte nào. Bản cũ đua `fetch()` với hạn chờ nhưng `await res.text()` lại nằm NGOÀI cuộc
    // đua ⇒ treo vô hạn, mà crawler chạy tuần tự nên cả lượt cào đứng im tại đúng URL đó.
    const fn: FetchLike = async (url) => ({
      ok: true, status: 200, url,
      text: () => new Promise<string>(() => {}),
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 200 });

    const race = await Promise.race([
      c.get(ART).then(() => 'xong'),
      new Promise<string>(r => setTimeout(() => r('TREO'), 4000)),
    ]);
    expect(race, 'get() phải trả về, không được treo quá 4 giây').toBe('xong');
  });

  it('mọi đường đều lặng → một trang chết không được đốt quá NGÂN SÁCH của nó (8 × 20s = 164s)', async () => {
    const fn: FetchLike = () => new Promise(() => {});
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 200, urlBudgetMs: 700 });
    const t0 = Date.now();
    const r = await c.get(ART);
    const spent = Date.now() - t0;

    expect(r).toBeNull();
    // 8 đường × 200ms = 1600ms nếu không có trần. Ngân sách 700ms phải cắt sớm.
    expect(spent, `đốt ${spent}ms cho một trang chết`).toBeLessThan(1400);
    expect(c.failureReasons().some(x => x.includes('ngân sách'))).toBe(true);
  });

  it('hẹn giờ hạn chờ được dọn khi đường đi thành công (không rò timer mỗi trang)', async () => {
    const fn: FetchLike = async (url) => ({
      ok: true, status: 200, url,
      text: async () => `<html><h1>A</h1><p>${'Nội dung wiki đủ dài. '.repeat(10)}</p></html>`,
    });
    const c = new FetchClient({ fetchImpl: fn, minHostIntervalMs: 0, timeoutMs: 60000 });
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await c.get(ART);
    expect(clear, 'hẹn giờ 60s không được dọn — mỗi trang rò một timer').toHaveBeenCalled();
    clear.mockRestore();
  });
});

/* ═══════════════════════ D. NGUỒN GỬI CHO AI ═══════════════════════ */

describe('(bug 229-D) buildBatchSource vứt phần lớn trang đã cào', () => {
  const mkPage = (i: number): PageDoc => ({
    url: `https://x.fandom.com/wiki/P${i}`, title: `P${i}`, aliases: [],
    text: 'Nội dung lore của trang này khá dài. '.repeat(400),   // ~14.8 KB mỗi trang
    infobox: {}, links: [], categories: [], platform: 'mediawiki', depth: 1,
  });

  it('20 trang cùng cỡ → MỌI trang phải có mặt trong nguồn, không chỉ 6 trang đầu', () => {
    const pages = Array.from({ length: 20 }, (_, i) => mkPage(i + 1));
    const src = buildBatchSource(pages, 42000);
    const seen = pages.filter(p => src.includes(`═══ TRANG: ${p.title} ═══`)).length;
    expect(seen, `chỉ ${seen}/20 trang tới được AI`).toBe(20);
  });

  it('chia ngân sách CÔNG BẰNG — trang đầu không được nuốt một nửa hạn mức', () => {
    const pages = Array.from({ length: 20 }, (_, i) => mkPage(i + 1));
    const src = buildBatchSource(pages, 42000);
    const blocks = src.split('═══ TRANG:').slice(1).map(b => b.length);
    expect(blocks.length).toBe(20);
    expect(Math.max(...blocks), 'trang béo nhất không được gấp quá 3 lần trang gầy nhất')
      .toBeLessThan(Math.min(...blocks) * 3);
    expect(src.length).toBeLessThanOrEqual(42000 + 200);
  });

  it('ít trang mà mỗi trang ngắn thì giữ NGUYÊN VĂN, không cắt oan', () => {
    const small: PageDoc[] = [1, 2].map(i => ({ ...mkPage(i), text: 'Ngắn gọn thôi. '.repeat(5) }));
    const src = buildBatchSource(small, 42000);
    for (const p of small) expect(src).toContain(p.text);
  });
});

/* ═══════════════════ B+C. SINH ENTRY ═══════════════════ */

const mockCallAI = vi.fn();
vi.mock('../../ai/client', async (orig) => {
  const real = await orig<typeof import('../../ai/client')>();
  return { ...real, callAI: (...a: unknown[]) => mockCallAI(...a), computePoolConcurrency: () => 2 };
});

const PROFILE = { id: 'p', name: 'p', apiKey: 'k', model: 'm', provider: 'gemini' } as unknown as ProxyProfile;
const PARAMS = { max_tokens: 4096, temperature: 1 } as unknown as GenerationParams;

const mkCard = (withBook: boolean): CharacterCardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'T', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
    creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
    tags: [], creator: '', character_version: '', extensions: {},
    ...(withBook ? { character_book: { name: 'B', entries: [] as LorebookEntry[] } } : {}),
  },
} as unknown as CharacterCardV3);

const mkPages = (n: number): PageDoc[] => Array.from({ length: n }, (_, i) => ({
  url: `https://x.fandom.com/wiki/P${i}`, title: `P${i}`, aliases: [],
  text: `Trang ${i}: ${'nội dung lore đầy đủ để chưng cất. '.repeat(50)}`,
  infobox: {}, links: [], categories: [], platform: 'mediawiki' as const, depth: 1,
}));

/**
 * Văn xuôi tiếng Việt dài đúng khoảng `tok` token. `seed` đổi hẳn từ vựng để hai entry khác
 * nhau thật — dùng chung một đoạn văn thì bộ lọc trùng nội dung loại ngay entry thứ hai, và
 * test sẽ đo nhầm bộ lọc thay vì đo cái đang cần đo.
 */
// Tám kho từ RỜI HẲN NHAU: dùng chung dù chỉ phần khung câu thôi là TF-IDF đã ra ~59% và bộ
// lọc trùng nội dung loại entry thứ hai — lúc đó test đo bộ lọc chứ không đo cái đang cần đo.
const WORD_POOLS = [
  ['kiếm', 'sương', 'đền', 'lửa', 'thép', 'quạ', 'tuyết', 'chuông', 'bạc', 'gió'],
  ['thuyền', 'muối', 'ngọc', 'vực', 'cá', 'buồm', 'neo', 'bão', 'ngư', 'san'],
  ['sách', 'mực', 'tháp', 'sao', 'kính', 'giấy', 'bụi', 'đèn', 'chữ', 'gác'],
  ['rừng', 'nai', 'rễ', 'nấm', 'suối', 'đá', 'rêu', 'sói', 'lá', 'khe'],
  ['máu', 'nanh', 'hầm', 'quan', 'đêm', 'dơi', 'mộ', 'xích', 'nến', 'khói'],
  ['súng', 'trại', 'cờ', 'ngựa', 'giáp', 'trống', 'lệnh', 'thành', 'cung', 'tường'],
  ['vàng', 'chợ', 'cân', 'lụa', 'thương', 'hội', 'kho', 'thuế', 'bến', 'sổ'],
  ['băng', 'đỉnh', 'hang', 'gấu', 'da', 'lều', 'lửa hồng', 'móng', 'trăng', 'sương giá'],
];
const proseOf = (tok: number, seed = 0): string => {
  const pool = WORD_POOLS[seed % WORD_POOLS.length];
  let s = '', i = 0;
  while (countTokens(s) < tok) { s += `${pool[i % pool.length]} `; i++; }
  return s.trim();
};

/** Chạy pha GENERATE với danh sách trang cho sẵn (bỏ qua pha crawl bằng cách tiêm pages). */
const runGenerate = async (opts: {
  card: CharacterCardV3;
  pages: PageDoc[];
  totalEntries: number;
  tokensPerEntry: number;
  concurrentBatches?: number;
}) => {
  const { generateEntriesFromPages } = await import('../index');
  const logs: string[] = [];
  const added: LorebookEntry[] = [];
  const r = await generateEntriesFromPages(
    {
      url: ART, totalEntries: opts.totalEntries, tokensPerEntry: opts.tokensPerEntry,
      autoExpand: true, maxDepth: 2, maxPages: 60, canonOnly: false,
      concurrentBatches: opts.concurrentBatches ?? 2,
      defaultPosition: 1, insertionOrderStart: 100,
    },
    opts.pages,
    { card: opts.card, profile: PROFILE, generationParams: PARAMS, appendEntry: (e) => added.push(e) },
    { log: (m) => logs.push(m), onProgress: () => {} },
  );
  return { ...r, logs, added };
};

const aiArray = (items: Array<{ comment: string; content: string }>) =>
  ({ text: JSON.stringify(items.map(x => ({ ...x, keys: [x.comment], secondary_keys: [], constant: false, selective: true }))), model: 'm' });

describe('(bug 229-B) Wiki Importer chưa hề nhận bản vá bug 194', () => {
  beforeEach(() => { mockCallAI.mockReset(); });

  it('lời nhắc độ dài KHÔNG được nêu con số trần trụi không đơn vị (AI đọc "175" ngay sau "875 ký tự" là hiểu thành ký tự)', () => {
    const p = buildWikiEntrySystemPrompt(250);
    expect(p).not.toMatch(/không ngắn hơn \d+,/);
    // Phải dùng chỉ thị dùng chung của bug 194: nói bằng token + ký tự + CẤU TRÚC.
    expect(p).toContain('SÀN CỨNG');
    expect(p).toMatch(/ký tự/);
    expect(p).toMatch(/câu hoàn chỉnh/);
  });

  it('max_tokens phải suy từ ngân sách lô, không để nguyên 4096 của Settings', async () => {
    mockCallAI.mockResolvedValue(aiArray([{ comment: 'A', content: proseOf(1000) }]));
    await runGenerate({ card: mkCard(true), pages: mkPages(6), totalEntries: 12, tokensPerEntry: 1000, concurrentBatches: 1 });

    expect(mockCallAI).toHaveBeenCalled();
    const params = mockCallAI.mock.calls[0][0].params as GenerationParams;
    expect(params.max_tokens, 'trần output vẫn là con số cố định 4096').toBeGreaterThan(4096);
  });

  it('entry ngắn (60% mục tiêu) được NỚI THÊM chứ không bị vứt — đúng cách batchGenerator đã làm', async () => {
    mockCallAI
      .mockResolvedValueOnce(aiArray([{ comment: 'Klein', content: proseOf(150) }]))   // 60% của 250
      .mockResolvedValue({ text: proseOf(260), model: 'm' });                          // lượt nới

    const r = await runGenerate({ card: mkCard(true), pages: mkPages(4), totalEntries: 1, tokensPerEntry: 250, concurrentBatches: 1 });

    expect(r.entriesCreated, 'entry ngắn bị vứt thay vì nới').toBe(1);
    expect(r.logs.some(l => l.includes('nới') || l.includes('token'))).toBe(true);
    expect(countTokens(r.added[0].content)).toBeGreaterThan(200);
  });

  it('entry đạt yêu cầu phải được đo bằng TOKEN THẬT và báo con số cho user', async () => {
    mockCallAI.mockResolvedValue(aiArray([{ comment: 'Audrey', content: proseOf(300) }]));
    const r = await runGenerate({ card: mkCard(true), pages: mkPages(4), totalEntries: 1, tokensPerEntry: 250, concurrentBatches: 1 });
    expect(r.entriesCreated).toBe(1);
    expect(r.logs.join('\n')).toMatch(/\d+\/250 token/);
  });
});

describe('(bug 229-C) batch hỏng thì im lặng và không thử lại', () => {
  beforeEach(() => { mockCallAI.mockReset(); });

  it('AI trả về thứ không phải JSON → phải GHI LOG nói rõ nó trả gì, rồi THỬ LẠI', async () => {
    mockCallAI
      .mockResolvedValueOnce({ text: 'Xin lỗi, tôi không thể tạo nội dung này.', model: 'm' })
      .mockResolvedValue(aiArray([{ comment: 'A', content: proseOf(260) }]));

    const r = await runGenerate({ card: mkCard(true), pages: mkPages(4), totalEntries: 1, tokensPerEntry: 250, concurrentBatches: 1 });

    expect(r.logs.some(l => l.includes('Xin lỗi')), 'không hề nói AI đã trả về cái gì').toBe(true);
    expect(mockCallAI.mock.calls.length, 'không thử lại lần nào').toBeGreaterThan(1);
    expect(r.entriesCreated).toBe(1);
  });

  it('lượt đầu ra thiếu → SINH BÙ cho tới khi đủ số entry đã đặt', async () => {
    let call = 0;
    mockCallAI.mockImplementation(async () => {
      call++;
      // Mỗi lượt chỉ chịu trả 1 entry dù được hỏi nhiều hơn.
      return aiArray([{ comment: `E${call}`, content: proseOf(260, call) }]);
    });

    const r = await runGenerate({ card: mkCard(true), pages: mkPages(8), totalEntries: 5, tokensPerEntry: 250, concurrentBatches: 2 });
    expect(r.entriesCreated, 'dừng ở lượt đầu, không sinh bù').toBe(5);
  });

  it('thẻ CHƯA có character_book → không được ném TypeError, vẫn tạo được entry', async () => {
    mockCallAI.mockResolvedValue(aiArray([{ comment: 'A', content: proseOf(260) }]));
    const card = mkCard(false);
    const r = await runGenerate({ card, pages: mkPages(4), totalEntries: 1, tokensPerEntry: 250, concurrentBatches: 1 });
    expect(r.entriesCreated).toBe(1);
    expect(r.added).toHaveLength(1);
  });

  it('mọi lượt gọi đều hỏng → báo lỗi có nội dung, không im lặng trả 0 entry', async () => {
    mockCallAI.mockRejectedValue(new Error('429 Too Many Requests'));
    const r = await runGenerate({ card: mkCard(true), pages: mkPages(4), totalEntries: 3, tokensPerEntry: 250, concurrentBatches: 1 });
    expect(r.entriesCreated).toBe(0);
    expect(r.logs.some(l => l.includes('429'))).toBe(true);
  });
});
