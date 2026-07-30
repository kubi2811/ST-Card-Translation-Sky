/**
 * (bug 163) MỘT LỖI LẺ KHÔNG ĐƯỢC GIẾT CẢ LƯỢT QUÉT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai lưới này không phải phòng xa — cả hai đều đo được trên API thật khi chạy thử bug 163:
 *   • một khoá trong bộ 3 khoá user đưa đã bị thu hồi → 401 → cứ 3 lượt gọi chết 1;
 *   • provider giới hạn 10 lượt/phút → 429 → cả pipeline dừng ở trạng thái error.
 * Cả hai đều kết thúc y hệt nhau dưới mắt user: "quét xong không có entry nào". Quét một truyện
 * dài là hàng trăm lượt gọi chạy hàng giờ, nên xác suất dính ÍT NHẤT một lỗi tạm thời là gần như
 * chắc chắn — không chịu được lỗi lẻ thì tính năng này không bao giờ chạy trọn được.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let failChunk1 = false;

vi.mock('../client', () => ({
  computePoolConcurrency: () => 1,
  callAI: vi.fn(async ({ messages, label }: { messages: Array<{ role: string; content: string }>; label?: string }) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    calls.push(label ?? '');
    // Giả cảnh: đúng MỘT phần của lượt đọc bị 429 dai dẳng (đã hết số lần thử lại bên trong client).
    if (failChunk1 && /Chương 2\b/.test(messages.find((m) => m.role === 'user')?.content ?? '')) {
      throw new Error('[429] Too Many Requests: {"detail":"速率限制: 10 次/分钟 "}');
    }
    if (sys.includes('<entries>')) {
      const cat = /<cat>([a-z|]+)<\/cat>/.exec(sys)?.[1]?.split('|')[0] ?? 'other';
      return {
        text: `<entries><entry><cat>${cat}</cat><title>Mục ${Math.random().toString(36).slice(2, 9)}</title>`
          + `<keys>k${Math.random().toString(36).slice(2, 6)}</keys>`
          + `<content>Nội dung riêng biệt ${Math.random().toString(36).slice(2, 16)}.</content></entry></entries>`,
      };
    }
    if (sys.includes('<issues>')) return { text: '<none/>' };
    return {
      text: '<overview>Thế giới rộng.</overview><main>A</main>'
        + '<characters><character><name>A</name><role>chính</role></character></characters>'
        + '<facts><fact><topic>T</topic><cat>faction</cat><text>Có thế lực.</text></fact></facts>'
        + '<events><event><time>Ngày 1</time><what>Bắt đầu.</what></event></events>'
        + '<dossier><fact>Ưa yên tĩnh.</fact></dossier>',
    };
  }),
}));

import { runDeepScan } from '../storyDeepScan';
import type { ProxyProfile, GenerationParams } from '../../../types';

const profile = { id: 'p', label: 'p', providerType: 'openai', baseUrl: '', apiKey: 'k', selectedModel: 'm' } as unknown as ProxyProfile;
const params = { temperature: 1, maxTokens: 4096 } as unknown as GenerationParams;
// Mỗi chunk mang một nhãn "Chương N" riêng để bài test bắn hỏng đúng một chunk.
const story = Array.from({ length: 3 }, (_, i) => `Chương ${i + 1}. ` + 'nội dung truyện. '.repeat(3000)).join('\n');
const opts = { maxChunks: 3, maxVerifyRounds: 0, learnStyle: false, makeCard: false } as const;

describe('(bug 163) một phần hỏng → bỏ qua phần đó, KHÔNG mất cả lượt', () => {
  beforeEach(() => { calls.length = 0; failChunk1 = false; });

  it('không lỗi gì → chạy trọn và có entry', async () => {
    const st = await runDeepScan(story, profile, params, opts);
    expect(st.status).toBe('done');
    expect(st.result?.entries.length ?? 0).toBeGreaterThan(0);
  });

  it('một chunk dính 429 dai dẳng → vẫn hoàn tất và VẪN có entry', async () => {
    failChunk1 = true;
    const st = await runDeepScan(story, profile, params, opts);
    // Bản cũ: ném thẳng ra ngoài → status 'error', result undefined, user nhận 0 entry.
    expect(st.status, `đáng lẽ phải chạy tiếp: ${st.error ?? ''}`).toBe('done');
    expect(st.result?.entries.length ?? 0,
      'bỏ qua một phần thì lorebook mỏng hơn, nhưng không được rỗng',
    ).toBeGreaterThan(0);
  });

  it('phần bị bỏ qua phải được NÓI RA trong báo cáo, không im lặng', async () => {
    failChunk1 = true;
    const st = await runDeepScan(story, profile, params, opts);
    const warned = (st.result?.report ?? []).some((r) => r.includes('bị bỏ qua do lỗi'));
    expect(warned, 'bỏ qua âm thầm = user tưởng bản quét đã trọn vẹn').toBe(true);
  });
});
