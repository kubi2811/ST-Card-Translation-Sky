/**
 * (bug 163) "TẠO THẺ TỪ TRUYỆN" RA 0 ENTRY — LẦN NÀY TRUY TỚI GỐC.
 * ─────────────────────────────────────────────────────────────────────────────
 * User báo lỗi này NHIỀU LẦN mà vẫn chưa dứt. Câu quyết định nằm ở mô tả của chính họ:
 *   "lúc quét thì nó có ghi 200 entry nhưng sau khi hoàn thành thì lại không có entry nào"
 * Tức entry CÓ được sinh ra, rồi bị mất ở chặng sau — không phải AI trả sai định dạng.
 *
 * Bug 158 tôi chỉ test buildYieldWarnings (một hàm thuần) nên chỉ thêm được CẢNH BÁO, còn nguyên
 * nhân thì không đụng tới. Tệ hơn: cảnh báo đó đổ lỗi cho model ("model không giữ được định dạng
 * <entries><entry>") trong khi lỗi nằm ở code — dẫn user đi sai hướng suốt mấy lượt báo lỗi.
 *
 * Nên test này chạy TRỌN pipeline với AI giả, và chốt đúng thứ user nhìn thấy: SỐ ENTRY CUỐI CÙNG.
 * Không có test ở mức này thì mọi lỗi "mất entry giữa đường" đều lọt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// AI giả: luôn trả về khối <entries> hợp lệ cho mọi lượt tổng hợp, và dữ liệu vừa đủ cho các
// lượt đọc. Mục đích là loại hẳn biến "model trả sai định dạng" ra khỏi phép thử — còn 0 entry
// thì chắc chắn lỗi nằm trong code.
vi.mock('../client', () => ({
  computePoolConcurrency: () => 2,
  callAI: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    const has = (s: string) => sys.includes(s);

    // Lượt tổng hợp → trả entry thật.
    if (has('<entries>')) {
      const cat = /<cat>([a-z|]+)<\/cat>/.exec(sys)?.[1]?.split('|')[0] ?? 'other';
      const n = 3;
      const items = Array.from({ length: n }, (_, i) =>
        `<entry><cat>${cat}</cat><title>Mục ${cat} ${i + 1} — ${Math.random().toString(36).slice(2, 8)}</title>`
        + `<keys>khoá${i}${Math.random().toString(36).slice(2, 6)}</keys>`
        + `<content>Nội dung chi tiết riêng biệt số ${i} ${Math.random().toString(36).slice(2, 14)}.</content></entry>`).join('\n');
      return { text: `<entries>\n${items}\n</entries>` };
    }
    if (has('<issues>')) return { text: '<none/>' };

    // Các lượt đọc — trả đủ để bộ nhớ không rỗng.
    return {
      text: [
        '<overview>Một thế giới rộng lớn.</overview>',
        '<main>Chu Minh Thuỵ</main>',
        '<characters><character><name>Chu Minh Thuỵ</name><role>chính</role></character>'
        + '<character><name>Audrey Hall</name><role>phụ</role></character></characters>',
        '<facts><fact><topic>Giáo hội</topic><cat>faction</cat><text>Có bảy vị thần.</text></fact>'
        + '<fact><topic>Nghi thức</topic><cat>mechanic</cat><text>Cần vật liệu hiếm.</text></fact></facts>',
        '<events><event><time>Ngày 1</time><what>Xuyên không.</what></event></events>',
        '<style><note>Giọng kể trầm.</note></style>',
        '<dossier><fact>Thích cà phê.</fact></dossier>',
        '<unknowns><unknown>Thân phận thật của Wright.</unknown></unknowns>',
      ].join('\n'),
    };
  }),
}));

import { runDeepScan, splitEntryBlocks } from '../storyDeepScan';
import type { ProxyProfile, GenerationParams } from '../../../types';

const profile = { id: 'p', name: 'test', provider: 'openai', baseUrl: '', apiKey: 'k', model: 'm' } as unknown as ProxyProfile;
const params = { temperature: 1, maxTokens: 4096 } as unknown as GenerationParams;
const story = Array.from({ length: 40 }, (_, i) => `Chương ${i + 1}. `.repeat(400)).join('\n');

describe('(bug 163) entry sinh ra rồi phải TỚI ĐƯỢC kết quả cuối', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chạy trọn pipeline → result.entries KHÔNG được rỗng', async () => {
    const st = await runDeepScan(story, profile, params, {
      maxChunks: 3, maxVerifyRounds: 0, learnStyle: false, makeCard: false,
    });

    expect(st.status, `pipeline lỗi: ${st.error ?? ''}`).toBe('done');
    // Đây chính là con số user nhìn thấy trên nút "Thêm N entry vào Lorebook".
    expect(st.result?.entries.length ?? 0,
      'AI giả trả entry hợp lệ ở MỌI lượt tổng hợp mà kết quả cuối vẫn rỗng → entry bị mất trong code',
    ).toBeGreaterThan(0);
  });

  it('số entry trên thống kê khớp với số entry thật trong kết quả', async () => {
    // Bản lỗi: stats.entries nhảy lên 200 lúc tổng hợp rồi tụt về 0 — hai con số nói hai điều
    // khác nhau, nên UI báo "200" giữa chừng còn nút cuối ghi "0".
    const st = await runDeepScan(story, profile, params, {
      maxChunks: 3, maxVerifyRounds: 0, learnStyle: false, makeCard: false,
    });
    expect(st.stats.entries).toBe(st.result?.entries.length ?? 0);
  });

  it('không có lượt tổng hợp nào bị coi là trắng tay', async () => {
    const st = await runDeepScan(story, profile, params, {
      maxChunks: 3, maxVerifyRounds: 0, learnStyle: false, makeCard: false,
    });
    const bad = (st.result?.report ?? []).filter((r) => r.includes('❌') || r.includes('không ra entry'));
    expect(bad, 'AI giả luôn trả entry hợp lệ nên không được có lượt nào trắng tay').toEqual([]);
  });
});

// Trần bộ nhớ — đo được trên truyện thật, không phải phỏng đoán.
describe('(bug 163) trần không được cắt âm thầm và không được quá chặt', () => {
  const SRC = readFileSync(resolve(__dirname, '../storyDeepScan.ts'), 'utf-8');

  it('trần nhân vật tổng hợp ≥ 200', () => {
    // Đo thật: truyện 11 triệu ký tự / 48 đoạn gom được 153 nhân vật CÓ dữ kiện, mà trần cũ là 60
    // → 93 nhân vật bị lược mà không dòng nào nói ra. User lấy mốc "truyện lớn phải trên 500
    // entry", nên trần 60 chặn đúng thứ họ đang đo.
    const cap = Number(/const CHAR_CAP = (\d+)/.exec(SRC)?.[1] ?? 0);
    expect(cap, 'hạ trần này xuống là mất nhân vật của truyện dài').toBeGreaterThanOrEqual(200);
  });

  it('trần dữ kiện thế giới ≥ 5000', () => {
    // Chủ đề thế giới là nguồn entry lớn nhất (503 chủ đề → 400+ entry). Trần cũ 2000 đã lên
    // 1851/2000 ở 48 đoạn, tức truyện dài hơn là chạm trần.
    const cap = Number(/worldFacts\.length >= (\d+)/.exec(SRC)?.[1] ?? 0);
    expect(cap).toBeGreaterThanOrEqual(5000);
  });

  it('chạm trần thì phải GHI RA, không im lặng', () => {
    expect(SRC).toContain('capNotices');
    expect(SRC, 'trần nhân vật phải báo khi cắt').toMatch(/capNotices\.push\([^)]*nhân vật/);
  });
});

// Câu hỏi user đặt ra: thiếu tag thì sao, hay bỏ tag luôn? Giữ tag nhưng không bắt buộc thẻ ĐÓNG.
describe('(bug 163) thiếu thẻ đóng vẫn phải lấy được entry', () => {
  it('đủ thẻ đóng — lấy đúng số khối', () => {
    expect(splitEntryBlocks('<entry>A</entry><entry>B</entry>')).toEqual(['A', 'B']);
  });

  it('BỊ CẮT giữa chừng (chạm trần token) — entry cuối vẫn được giữ', () => {
    // Đây là ca thật: model xuất dở danh sách rồi hết token. Bản cũ dùng allTags nên mất hẳn
    // entry cuối — mà entry cuối thường là entry dài nhất.
    const out = splitEntryBlocks('<entry>A</entry>\n<entry><title>B</title><content>đang viết dở');
    expect(out.length).toBe(2);
    expect(out[1]).toContain('đang viết dở');
  });

  it('quên thẻ đóng ở GIỮA — không nuốt entry sau vào entry trước', () => {
    const out = splitEntryBlocks('<entry>A\n<entry>B</entry>');
    expect(out).toEqual(['A', 'B']);
  });

  it('không có entry nào → mảng rỗng, không đẻ ra entry rác', () => {
    expect(splitEntryBlocks('AI trả lời linh tinh không có thẻ nào')).toEqual([]);
  });
});
