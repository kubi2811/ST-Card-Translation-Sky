import { describe, it, expect } from 'vitest';
import { estimateLorebookBatchLoad } from '../estimateBatchTokens';

const cjk = (n: number) => '字'.repeat(n);

describe('estimateLorebookBatchLoad', () => {
  it('lô nhỏ, entry ngắn → an toàn (safe)', () => {
    const texts = Array.from({ length: 20 }, () => cjk(300)); // 300 ký tự CJK/entry
    const est = estimateLorebookBatchLoad(texts, 5, 65536);
    // 5 × 300 = 1500 ký tự → ~1680 output token → ~2.5% trần → safe
    expect(est.verdict).toBe('safe');
    expect(est.worstBatchChars).toBe(1500);
    expect(est.estOutputTokens).toBeGreaterThan(0);
    expect(est.batchSize).toBe(5);
  });

  it('lô lớn với entry dài → cảnh báo/nguy hiểm + gợi ý giảm', () => {
    const texts = Array.from({ length: 30 }, () => cjk(6000)); // entry rất dài
    const est = estimateLorebookBatchLoad(texts, 15, 65536);
    // 15 × 6000 = 90K ký tự → ~100K output token → > trần 65K → danger
    expect(est.verdict).toBe('danger');
    expect(est.ratio).toBeGreaterThan(0.9);
    expect(est.recommendedBatchSize).toBeLessThan(15);
    expect(est.recommendedBatchSize).toBeGreaterThanOrEqual(1);
  });

  it('lấy top-N entry DÀI NHẤT làm lô nặng nhất (kịch bản xấu nhất)', () => {
    const texts = [cjk(100), cjk(5000), cjk(200), cjk(4000), cjk(50)];
    const est = estimateLorebookBatchLoad(texts, 2, 65536);
    expect(est.worstBatchChars).toBe(9000); // 5000 + 4000
  });

  it('recommendedBatchSize không vượt batchSize đã chọn', () => {
    const texts = Array.from({ length: 40 }, () => cjk(200));
    const est = estimateLorebookBatchLoad(texts, 8, 65536);
    expect(est.recommendedBatchSize).toBeLessThanOrEqual(8);
  });

  it('mảng rỗng → không ném, worstBatchChars = 0', () => {
    const est = estimateLorebookBatchLoad([], 10, 65536);
    expect(est.worstBatchChars).toBe(0);
    expect(est.entryCount).toBe(0);
  });
});
