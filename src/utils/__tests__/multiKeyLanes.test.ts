import { describe, it, expect } from 'vitest';
import { flattenLanes, laneKeyForTest, laneKeyToPanelForTest, type PoolProvider } from '../apiClient';

/**
 * (User yêu cầu 2026) BUG: nhét ≥2 key vào 1 provider bị "treo / chỉ dùng 1 key".
 * Gốc: rate-bucket + cooling khoá theo (provider,model) — 1 key 429 làm CẢ provider nghỉ 15s.
 * Fix: mỗi (provider, keyIndex) là 1 LANE độc lập (bucket/cooling riêng). Test khoá 2 bất biến:
 *  (1) N key → N lane; (2) mỗi key có khoá bucket RIÊNG nhưng GỘP đúng về 1 dòng UI (provider,model).
 */
function mkPool(o: Partial<PoolProvider>): PoolProvider {
  return {
    id: 'default', provider: 'google', proxyUrl: '', keys: ['k1'],
    primaryModel: 'pro', primaryRpm: 5,
    enableSecondary: false, secondaryModel: 'flash', secondaryRpm: 20, secondaryThreshold: 0,
    ...o,
  };
}

describe('flattenLanes — N key = N lane độc lập', () => {
  it('1 provider 3 key → 3 lane (keyIndex 0,1,2), cùng provider', () => {
    const lanes = flattenLanes([mkPool({ id: 'p1', keys: ['k1', 'k2', 'k3'] })]);
    expect(lanes.length).toBe(3);
    expect(lanes.map(l => l.ki)).toEqual([0, 1, 2]);
    expect(lanes.every(l => l.p.id === 'p1')).toBe(true);
  });

  it('provider 0 key → vẫn 1 lane (keyIndex 0)', () => {
    const lanes = flattenLanes([mkPool({ keys: [] })]);
    expect(lanes.length).toBe(1);
    expect(lanes[0].ki).toBe(0);
  });

  it('nhiều provider [3 key, 1 key] → 4 lane', () => {
    const lanes = flattenLanes([
      mkPool({ id: 'default', keys: ['a', 'b', 'c'] }),
      mkPool({ id: 'p2', keys: ['d'] }),
    ]);
    expect(lanes.length).toBe(4);
    expect(lanes.filter(l => l.p.id === 'default').length).toBe(3);
    expect(lanes.filter(l => l.p.id === 'p2').length).toBe(1);
  });
});

describe('khoá lane per-key: bucket riêng nhưng gộp đúng cho UI', () => {
  it('mỗi keyIndex có khoá bucket KHÁC nhau (⇒ nhịp RPM + cooling độc lập)', () => {
    const k0 = laneKeyForTest('default', 0, 'pro');
    const k1 = laneKeyForTest('default', 1, 'pro');
    const k2 = laneKeyForTest('default', 2, 'pro');
    expect(new Set([k0, k1, k2]).size).toBe(3);
  });

  it('cùng model khác model → khoá khác nhau', () => {
    expect(laneKeyForTest('p1', 0, 'pro')).not.toBe(laneKeyForTest('p1', 0, 'flash'));
  });

  it('MỌI key của 1 (provider,model) GỘP về CÙNG 1 khoá UI → ActiveCallsPanel cộng dồn đúng', () => {
    const panel0 = laneKeyToPanelForTest(laneKeyForTest('p1', 0, 'flash'));
    const panel1 = laneKeyToPanelForTest(laneKeyForTest('p1', 1, 'flash'));
    const panel9 = laneKeyToPanelForTest(laneKeyForTest('p1', 9, 'flash'));
    expect(panel0).toBe(panel1);
    expect(panel1).toBe(panel9);
  });

  it('provider "default" gộp về đúng dạng UI (chỉ model, không kèm id)', () => {
    expect(laneKeyToPanelForTest(laneKeyForTest('default', 3, 'pro'))).toBe('pro');
  });

  it('provider khác default gộp kèm id (khác model của default cùng tên)', () => {
    const dflt = laneKeyToPanelForTest(laneKeyForTest('default', 0, 'pro'));
    const other = laneKeyToPanelForTest(laneKeyForTest('p2', 0, 'pro'));
    expect(dflt).not.toBe(other);
  });
});
