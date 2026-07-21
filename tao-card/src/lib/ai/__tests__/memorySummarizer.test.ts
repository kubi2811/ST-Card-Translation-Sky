import { describe, it, expect, vi } from 'vitest';
import { shouldSummarize, summarizeHistory, buildCompressedHistory, SUMMARIZE_THRESHOLD, KEEP_RECENT } from '../memorySummarizer';
import type { ChatMessage } from '../../../types';

const msgs = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `tin ${i}` } as ChatMessage));

describe('shouldSummarize', () => {
  it('dưới ngưỡng → không nén', () => {
    expect(shouldSummarize(msgs(SUMMARIZE_THRESHOLD - 1))).toBe(false);
  });
  it('đạt ngưỡng → nén', () => {
    expect(shouldSummarize(msgs(SUMMARIZE_THRESHOLD))).toBe(true);
  });
});

describe('summarizeHistory', () => {
  it('nén phần cũ, giữ N lượt gần nhất', async () => {
    const callAI = vi.fn().mockResolvedValue('TÓM LƯỢC');
    const r = await summarizeHistory(msgs(30), callAI);
    expect(r).not.toBeNull();
    expect(r!.summary).toBe('TÓM LƯỢC');
    expect(r!.kept).toHaveLength(KEEP_RECENT);
    expect(r!.kept[KEEP_RECENT - 1].content).toBe('tin 29');
  });

  it('AI lỗi → trả null, KHÔNG ném ra ngoài (chat vẫn chạy)', async () => {
    const callAI = vi.fn().mockRejectedValue(new Error('API sập'));
    await expect(summarizeHistory(msgs(30), callAI)).resolves.toBeNull();
  });

  it('dưới ngưỡng → trả null, không gọi AI', async () => {
    const callAI = vi.fn();
    expect(await summarizeHistory(msgs(3), callAI)).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });
});

// Hai test dưới đây chặn 2 lỗi ÂM THẦM đã thực sự xảy ra khi triển khai — đều không làm
// đứt chat nên không có gì báo, chỉ khiến AI mất trí nhớ / tốn tiền vô ích.
describe('buildCompressedHistory — chặn tái phát 2 bug đã gặp', () => {
  it('BUG C1: tóm lược KHÔNG được dùng role "system" (Claude/Gemini sẽ vứt im lặng)', () => {
    const out = buildCompressedHistory(msgs(30), { coveredUpTo: 24, summary: 'TÓM LƯỢC' });
    const block = out[0];
    // client.ts (Claude/Gemini) chỉ giữ system message ĐẦU TIÊN rồi filter bỏ hết phần còn lại,
    // nên khối tóm lược nằm giữa mảng mà mang role 'system' sẽ biến mất không dấu vết.
    expect(block.role).toBe('user');
    expect(block.role).not.toBe('system');
    expect(block.content).toContain('TÓM LƯỢC');
    expect(block.content).toContain('[System:');
  });

  it('BUG C2: các lượt phát sinh SAU lần nén không được rơi mất', () => {
    // Nén lúc lịch sử dài 30 (gói 24 lượt đầu). Sau đó có thêm 5 lượt mới → tổng 35.
    const grown = msgs(35);
    const out = buildCompressedHistory(grown, { coveredUpTo: 24, summary: 'TÓM LƯỢC' });
    // 1 khối tóm lược + 11 lượt chưa nén (index 24..34)
    expect(out).toHaveLength(1 + 11);
    expect(out[out.length - 1].content).toBe('tin 34'); // lượt mới nhất PHẢI có mặt
  });
});
