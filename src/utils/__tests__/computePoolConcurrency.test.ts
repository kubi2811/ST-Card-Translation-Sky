import { describe, it, expect } from 'vitest';
import type { ProxySettings } from '../../types/card';
import { computePoolConcurrency } from '../apiClient';

/**
 * Số luồng song song = Σ NGÂN SÁCH RPM toàn pool: mỗi KEY đóng góp (primaryRpm + secondaryRpm nếu
 * bật model phụ). Đây là logic đã sửa ở task #35 ("dùng hết key, bỏ trần thủ công"). Test khoá lại
 * công thức + trần cứng 512 + khử trùng key. (Không có provider phụ nào được bơm trong test → pool
 * chỉ gồm config chính.)
 */
function mkProxy(o: Partial<ProxySettings>): ProxySettings {
  return {
    apiKey: '',
    apiKeys: [],
    primaryModelRpm: 0,
    enableSecondaryModel: false,
    secondaryModel: '',
    secondaryModelRpm: 0,
    ...o,
  } as unknown as ProxySettings;
}

describe('computePoolConcurrency', () => {
  it('1 key, chỉ model chính → = primaryRpm', () => {
    expect(computePoolConcurrency(mkProxy({ apiKey: 'k1', primaryModelRpm: 5 }))).toBe(5);
  });

  it('4 key + model phụ bật + CÓ ngưỡng → (primaryRpm + secondaryRpm) × số key', () => {
    const base = mkProxy({
      apiKey: 'k1', apiKeys: ['k2', 'k3', 'k4'],
      primaryModelRpm: 5, enableSecondaryModel: true, secondaryModel: 'flash', secondaryModelRpm: 20,
      secondaryModelThreshold: 1000, // (User 2026) phụ chỉ chạy khi có ngưỡng ⇒ mới tính RPM phụ
    });
    expect(computePoolConcurrency(base)).toBe((5 + 20) * 4); // 100
  });

  it('(User 2026) model phụ bật nhưng NGƯỠNG = 0 → KHÔNG tính RPM phụ (phụ không bao giờ chạy)', () => {
    const base = mkProxy({
      apiKey: 'k1', apiKeys: ['k2', 'k3', 'k4'],
      primaryModelRpm: 5, enableSecondaryModel: true, secondaryModel: 'flash', secondaryModelRpm: 20,
      secondaryModelThreshold: 0,
    });
    expect(computePoolConcurrency(base)).toBe(5 * 4); // 20 — chỉ RPM chính
  });

  it('bật model phụ nhưng tên model rỗng → KHÔNG tính RPM phụ', () => {
    const base = mkProxy({
      apiKey: 'k1', primaryModelRpm: 5, enableSecondaryModel: true, secondaryModel: '  ', secondaryModelRpm: 20,
    });
    expect(computePoolConcurrency(base)).toBe(5);
  });

  it('primaryRpm = 0 → mặc định 5', () => {
    expect(computePoolConcurrency(mkProxy({ apiKey: 'k1', primaryModelRpm: 0 }))).toBe(5);
  });

  it('khử trùng key (apiKey trùng trong apiKeys) → chỉ đếm key phân biệt', () => {
    const base = mkProxy({ apiKey: 'k1', apiKeys: ['k1', 'k2'], primaryModelRpm: 5 });
    expect(computePoolConcurrency(base)).toBe(5 * 2); // {k1,k2} = 2 key
  });

  it('trần cứng 512 chống cấu hình gõ nhầm', () => {
    expect(computePoolConcurrency(mkProxy({ apiKey: 'k1', primaryModelRpm: 100000 }))).toBe(512);
  });

  it('không key nào → vẫn tối thiểu 1 luồng (kc floor = 1)', () => {
    expect(computePoolConcurrency(mkProxy({ primaryModelRpm: 5 }))).toBe(5);
  });
});
