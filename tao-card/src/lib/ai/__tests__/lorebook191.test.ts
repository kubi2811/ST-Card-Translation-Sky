/**
 * (bug 191) ĐẠI TU LOREBOOK — bốn lưới kiểm theo đúng cách chúng được ép:
 *   1. Batch: "Số batch song song" của user phải được TÔN TRỌNG (trước đây engine bỏ qua),
 *      và kế hoạch tiêu đề chia phần TRƯỚC khi sinh → các batch không thể viết trùng thực thể.
 *   2. Kế hoạch hỏng thì rơi về đường cũ, KHÔNG giết cả lượt sinh.
 *   3. Sắp xếp order & config: AI chỉ phân loại, máy áp bảng chuẩn — tất định, test được từng ô.
 *   4. Sửa bằng AI có CHỐT AN TOÀN: bản sửa rỗng/teo nội dung bị từ chối, entry giữ nguyên.
 * Kèm nối dây: webScraper phải đi qua FetchClient; LorebookPage phải mount panel hợp nhất.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

let plannerFail = false;
const logs: string[] = [];

const randWords = (n: number) => Array.from({ length: n }, () => Math.random().toString(36).slice(2)).join(' ');

vi.mock('../client', () => ({
  computePoolConcurrency: () => 8, // pool dư dả — để thấy rõ trần user mới là thứ quyết định
  callAI: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
    const sys = messages.find(m => m.role === 'system')?.content ?? '';
    const user = messages.find(m => m.role === 'user')?.content ?? '';
    // 1) Lượt lập kế hoạch tiêu đề
    if (sys.includes('<titles>')) {
      if (plannerFail) throw new Error('[429] planner chết');
      const titles = ['Kiếm Tông', 'Hệ Linh Căn', 'Trưởng Lão Vân', 'Thành Lạc Nhật', 'Đan Phòng', 'Bí Cảnh Huyền Thiên', 'Đề Dư Một', 'Đề Dư Hai'];
      return { text: `<titles>\n${titles.map(t => `<t>${t}</t>`).join('\n')}\n</titles>` };
    }
    // 2) Lượt sinh batch: viết ĐÚNG các đề được giao (nếu có), không thì tự bịa
    const m = user.match(/PHẦN VIỆC ĐƯỢC GIAO[\s\S]*?entry:\n([\s\S]*?)\nTUYỆT ĐỐI/);
    const assigned = m
      ? m[1].split('\n').map(s => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
      : [];
    const want = assigned.length > 0 ? assigned : [`Tự Bịa ${Math.random().toString(36).slice(2, 7)}`, `Tự Bịa ${Math.random().toString(36).slice(2, 7)}`];
    const arr = want.map(t => ({ comment: t, keys: [t], content: `${t}: ${randWords(80)}` }));
    return { text: JSON.stringify(arr) };
  }),
}));

import { runBatchGeneration, parsePlannedTitles, type BatchGenConfig, type BatchRunContext } from '../batchGenerator';
import { parseClassification, buildArrangeChange, isTechnicalEntry } from '../lorebookArranger';
import { parseFixPatch } from '../lorebookDoctor';
import type { ProxyProfile, GenerationParams, CharacterCardV3, LorebookEntry } from '../../../types';

const profile = { id: 'p', label: 'p', providerType: 'openai', baseUrl: '', apiKey: 'k', selectedModel: 'm' } as unknown as ProxyProfile;
const params = { temperature: 1, maxTokens: 4096 } as unknown as GenerationParams;

const makeCard = (): CharacterCardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'Thẻ Test', description: 'Thế giới tu tiên.', personality: '', scenario: '',
    first_mes: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '',
    alternate_greetings: [], tags: [], creator: '', character_version: '', extensions: {},
    character_book: { name: 'WB', entries: [] },
  },
} as unknown as CharacterCardV3);

const makeConfig = (over: Partial<BatchGenConfig> = {}): BatchGenConfig => ({
  topicPrompt: 'Thế giới tu tiên rộng lớn', useCardContext: false,
  totalEntries: 6, entriesPerBatch: 2, defaultPosition: 0,
  insertionOrderMode: 'same', insertionOrderStart: 100,
  maxRetriesPerBatch: 1, maxConsecutiveErrors: 3,
  concurrentBatches: 2, autoConfig: false,
  ...over,
});

const makeCtx = (card: CharacterCardV3): BatchRunContext => ({
  card, profile, generationParams: params,
  paused: false, stopped: false,
  log: (msg) => logs.push(msg),
  onProgress: () => {},
  appendEntry: () => {},
});

describe('(bug 191) batch: kế hoạch chia phần + tôn trọng thiết lập luồng', () => {
  beforeEach(() => { plannerFail = false; logs.length = 0; });

  it('entry sinh ra mang ĐÚNG các tiêu đề đã lập kế hoạch — không batch nào tự bịa đề', async () => {
    const card = makeCard();
    await runBatchGeneration(makeConfig(), makeCtx(card));
    const comments = (card.data.character_book?.entries ?? []).map(e => e.comment);
    expect(comments.length).toBe(6);
    const planned = ['Kiếm Tông', 'Hệ Linh Căn', 'Trưởng Lão Vân', 'Thành Lạc Nhật', 'Đan Phòng', 'Bí Cảnh Huyền Thiên'];
    expect(comments.sort()).toEqual(planned.sort());
    // Không có entry trùng tên — chia phần từ gốc nghĩa là trùng không thể xảy ra theo thiết kế.
    expect(new Set(comments).size).toBe(comments.length);
  });

  it('concurrency = min(pool, trần user) — thiết lập "Batch song song" không còn là đồ trang trí', async () => {
    await runBatchGeneration(makeConfig({ concurrentBatches: 2 }), makeCtx(makeCard()));
    // Pool cho 8 nhưng user đặt 2 → dòng log mở màn phải báo 2 song song.
    expect(logs.some(l => l.includes('(2 song song)')), logs[0]).toBe(true);
  });

  it('lượt lập kế hoạch chết → vẫn sinh đủ entry bằng đường dự phòng, có nói rõ trong log', async () => {
    plannerFail = true;
    const card = makeCard();
    await runBatchGeneration(makeConfig(), makeCtx(card));
    expect((card.data.character_book?.entries ?? []).length).toBe(6);
    expect(logs.some(l => l.includes('dự phòng'))).toBe(true);
  });

  it('parsePlannedTitles: đọc tag chuẩn, chịu được rớt tag, tự khử tiêu đề lặp', () => {
    expect(parsePlannedTitles('<titles><t>A</t><t>B</t><t>a</t></titles>')).toEqual(['A', 'B']);
    expect(parsePlannedTitles('1. Kiếm Tông\n2. Đan Phòng\n')).toEqual(['Kiếm Tông', 'Đan Phòng']);
  });
});

describe('(bug 191) sắp xếp order & config — AI phân loại, máy áp bảng chuẩn', () => {
  const entry = (over: Partial<LorebookEntry>): LorebookEntry => ({
    id: 1, keys: ['k'], secondary_keys: [], comment: 'X', content: 'Nội dung.',
    constant: false, selective: true, insertion_order: 10, enabled: true,
    position: 'after_char', use_regex: false,
    extensions: { position: 1, depth: 4, role: null },
    ...over,
  } as LorebookEntry);

  it('parseClassification đọc đúng id→cat, cat lạ quy về other', () => {
    const m = parseClassification('<cls><e><id>3</id><cat>character</cat></e><e><id>7</id><cat>vôdanh</cat></e></cls>');
    expect(m.get(3)).toBe('character');
    expect(m.get(7)).toBe('other');
  });

  it('entry nhân vật đặt sai order/constant → bảng chuẩn kê đủ khác biệt; entry đã đúng → null', () => {
    const wrong = entry({ constant: true, selective: false, insertion_order: 10 });
    const ch = buildArrangeChange(wrong, 'character');
    expect(ch).not.toBeNull();
    expect(ch!.patch.insertion_order).toBe(200);        // Group 3 chuẩn worldbook
    expect(ch!.patch.constant).toBe(false);
    expect(ch!.diffs.join(' ')).toContain('order 10 → 200');

    const right = entry({ insertion_order: 200 });
    expect(buildArrangeChange(right, 'character')).toBeNull();
  });

  it('entry hệ thống (meta/system) → constant + order 900; entry kỹ thuật EJS/MVU bị né', () => {
    const sys = buildArrangeChange(entry({ comment: 'Hệ Thống Tu Luyện' }), 'system');
    expect(sys!.patch.constant).toBe(true);
    expect(sys!.patch.insertion_order).toBe(900);
    expect(isTechnicalEntry(entry({ comment: '@@preprocessing controller' }))).toBe(true);
    expect(isTechnicalEntry(entry({ content: '[initvar]\n{"hp": 100}' }))).toBe(true);
    expect(isTechnicalEntry(entry({ comment: 'Trưởng Lão Vân' }))).toBe(false);
  });
});

describe('(bug 191) sửa bằng AI — chốt an toàn chống phá entry', () => {
  const original = {
    id: 1, comment: 'Kiếm Tông', keys: ['Kiếm Tông'], content: 'Kiếm Tông là tông môn lớn. '.repeat(20),
  } as unknown as LorebookEntry;

  it('bản sửa hợp lệ được nhận, trường thiếu thì giữ của bản gốc', () => {
    const fixed = parseFixPatch(JSON.stringify({ comment: 'Kiếm Tông', keys: ['Kiếm Tông', 'Tông môn kiếm'], content: 'Kiếm Tông: tông môn kiếm đạo đứng đầu. '.repeat(15) }), original);
    expect(fixed).not.toBeNull();
    expect(fixed!.keys).toContain('Tông môn kiếm');
  });

  it('bản sửa teo còn dưới 30% bản gốc hoặc rỗng → TỪ CHỐI (trả null), entry không bị phá', () => {
    expect(parseFixPatch(JSON.stringify({ comment: 'Kiếm Tông', keys: ['x'], content: 'ngắn' }), original)).toBeNull();
    expect(parseFixPatch('AI xin lỗi, không sửa được.', original)).toBeNull();
  });

  it('chịu được code fence bao quanh', () => {
    const body = JSON.stringify({ content: 'Kiếm Tông: chi tiết đầy đủ về tông môn. '.repeat(15), keys: ['Kiếm Tông'], comment: 'Kiếm Tông' });
    expect(parseFixPatch('```json\n' + body + '\n```', original)).not.toBeNull();
  });
});

describe('(bug 191) nối dây', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('webScraper đi qua FetchClient (hệ chống CORS hợp nhất với Wiki Importer)', () => {
    const SRC = read('../webScraper.ts');
    expect(SRC).toContain("from '../wikiImport/fetchClient'");
    expect(SRC).toContain('searchClient.get(targetUrl)');
    expect(SRC).toContain('export function searchFailureReasons');
  });

  it('LorebookPage: 2 tab phân tích cũ đã hợp nhất thành LorebookDoctorPanel', () => {
    const SRC = read('../../../pages/LorebookPage.tsx');
    expect(SRC).toContain('LorebookDoctorPanel');
    expect(SRC).not.toContain('QualityHubPanel');
    expect(SRC).not.toContain('LorebookCategorizationPanel');
  });

  it('engine: trần user thật sự vào công thức concurrency', () => {
    const SRC = read('../batchGenerator.ts');
    expect(SRC).toContain('computePoolConcurrency(ctx.profile), totalBatches, userCap');
  });
});
