import { describe, it, expect, beforeEach } from 'vitest';
import { CallMonitor, estimateTokens } from '../callMonitor';

describe('estimateTokens', () => {
  it('CJK ≈ 1 token/ký tự, Latin ≈ 4 ký tự/token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('你好世界')).toBe(4);          // 4 CJK
    expect(estimateTokens('abcdefgh')).toBe(2);          // 8 latin / 4
    expect(estimateTokens('你好abcd')).toBe(2 + 1);      // 2 CJK + 4 latin/4
  });
});

describe('CallMonitor token stats', () => {
  beforeEach(() => CallMonitor.reset());

  it('gom theo lane (providerId|model) + tổng đúng', () => {
    CallMonitor.recordTokens({ providerId: 'default', model: 'pro', input: 100, output: 50, estimated: false });
    CallMonitor.recordTokens({ providerId: 'default', model: 'pro', input: 200, output: 70, estimated: false });
    CallMonitor.recordTokens({ providerId: 'p2', model: 'flash', input: 10, output: 5, estimated: true });

    const t = CallMonitor.getTokenTotals();
    expect(t.calls).toBe(3);
    expect(t.input).toBe(310);
    expect(t.output).toBe(125);
    expect(t.estimatedCalls).toBe(1);
    expect(t.lanes).toHaveLength(2);

    const pro = t.lanes.find(l => l.model === 'pro')!;
    expect(pro.calls).toBe(2);
    expect(pro.input).toBe(300);
    expect(pro.output).toBe(120);
    expect(pro.estimatedCalls).toBe(0);

    const flash = t.lanes.find(l => l.model === 'flash')!;
    expect(flash.providerId).toBe('p2');
    expect(flash.estimatedCalls).toBe(1);
  });

  it('reset() xoá sạch thống kê token (đầu mỗi run)', () => {
    CallMonitor.recordTokens({ providerId: 'default', model: 'pro', input: 100, output: 50, estimated: false });
    CallMonitor.reset();
    const t = CallMonitor.getTokenTotals();
    expect(t.calls).toBe(0);
    expect(t.input).toBe(0);
    expect(t.lanes).toHaveLength(0);
  });

  it('số âm/thiếu providerId không làm hỏng tổng', () => {
    CallMonitor.recordTokens({ model: 'pro', input: -5, output: 10, estimated: false });
    const t = CallMonitor.getTokenTotals();
    expect(t.input).toBe(0);
    expect(t.output).toBe(10);
    expect(t.lanes[0].providerId).toBe('default');
  });

  it('cộng dồn cached tokens theo lane + tổng (bằng chứng prompt caching)', () => {
    CallMonitor.recordTokens({ providerId: 'default', model: 'pro', input: 1000, output: 50, cached: 800, estimated: false });
    CallMonitor.recordTokens({ providerId: 'default', model: 'pro', input: 1000, output: 60, cached: 900, estimated: false });
    CallMonitor.recordTokens({ providerId: 'p2', model: 'flash', input: 500, output: 20, estimated: false }); // không có cached
    const t = CallMonitor.getTokenTotals();
    expect(t.cached).toBe(1700);
    expect(t.lanes.find(l => l.model === 'pro')?.cached).toBe(1700);
    expect(t.lanes.find(l => l.model === 'flash')?.cached).toBe(0);
  });
});
