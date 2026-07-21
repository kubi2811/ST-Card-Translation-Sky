import { describe, it, expect, vi } from 'vitest';
import { shouldSummarize, summarizeHistory, SUMMARIZE_THRESHOLD, KEEP_RECENT } from '../memorySummarizer';
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
