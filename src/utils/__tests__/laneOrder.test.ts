import { describe, it, expect } from 'vitest';
import { laneOrder, type PoolProvider } from '../apiClient';

/**
 * (User yêu cầu 2026) Model PHỤ chỉ chạy entry NGẮN hơn/bằng ngưỡng ký tự.
 * ĐÃ BỎ fallback "model chính bận/treo → phụ" và ép-phụ-khi-retry.
 * ⇒ laneOrder chỉ trả về DUY NHẤT 1 model: ngắn→phụ, dài/không rõ→chính.
 */
function mkPool(o: Partial<PoolProvider>): PoolProvider {
  return {
    id: 'p0', provider: 'google', proxyUrl: '', keys: ['k1'],
    primaryModel: 'pro', primaryRpm: 5,
    enableSecondary: true, secondaryModel: 'flash', secondaryRpm: 20, secondaryThreshold: 1000,
    ...o,
  };
}

describe('laneOrder (routing model phụ theo ngưỡng ký tự)', () => {
  it('entry NGẮN (≤ ngưỡng) → CHỈ model phụ, không fallback về chính', () => {
    const lanes = laneOrder(mkPool({}), 500);
    expect(lanes.map(l => l.model)).toEqual(['flash']);
  });

  it('entry đúng bằng ngưỡng → model phụ', () => {
    expect(laneOrder(mkPool({}), 1000).map(l => l.model)).toEqual(['flash']);
  });

  it('entry DÀI (> ngưỡng) → CHỈ model chính, KHÔNG rớt xuống phụ (bỏ fallback chính→phụ)', () => {
    expect(laneOrder(mkPool({}), 1001).map(l => l.model)).toEqual(['pro']);
    expect(laneOrder(mkPool({}), 50000).map(l => l.model)).toEqual(['pro']);
  });

  it('không rõ độ dài (charCount undefined) → model chính', () => {
    expect(laneOrder(mkPool({}), undefined).map(l => l.model)).toEqual(['pro']);
  });

  it('bỏ qua preferSecondary (retry/smartPack cũ ép phụ) → vẫn theo ngưỡng: entry dài đi chính', () => {
    expect(laneOrder(mkPool({}), 50000, true).map(l => l.model)).toEqual(['pro']);
    expect(laneOrder(mkPool({}), 300, true).map(l => l.model)).toEqual(['flash']);
  });

  it('ngưỡng = 0 → model phụ KHÔNG bao giờ chạy (mọi entry đi chính)', () => {
    const p = mkPool({ secondaryThreshold: 0 });
    expect(laneOrder(p, 100).map(l => l.model)).toEqual(['pro']);
    expect(laneOrder(p, 99999).map(l => l.model)).toEqual(['pro']);
  });

  it('model phụ TẮT → luôn model chính', () => {
    const p = mkPool({ enableSecondary: false });
    expect(laneOrder(p, 100).map(l => l.model)).toEqual(['pro']);
  });

  it('RPM lane = rpm/model × số key', () => {
    const p = mkPool({ keys: ['k1', 'k2', 'k3'] });
    expect(laneOrder(p, 500)[0].rpm).toBe(20 * 3); // phụ
    expect(laneOrder(p, 5000)[0].rpm).toBe(5 * 3);  // chính
  });
});
