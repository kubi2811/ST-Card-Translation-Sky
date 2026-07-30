/**
 * (bug 163) Đề xuất số đoạn quét — chốt bằng CHÍNH số đo thật đã chạy.
 */
import { describe, it, expect } from 'vitest';
import { adviseChunks, adviceText, MAX_ADVISED_CHUNKS } from '../chunkAdvice';

const NOVEL = 11_056_048;   // đúng độ dài truyện đã dùng để đo
const SIZE = 40_000;

describe('adviseChunks', () => {
  it('truyện 11 triệu ký tự với mặc định 12 đoạn → phải khuyên, và nói đúng 4%', () => {
    const a = adviseChunks(NOVEL, SIZE, 12);
    expect(a.shouldAdvise).toBe(true);
    expect(a.currentCoverage).toBe(4);
    expect(a.recommended).toBe(MAX_ADVISED_CHUNKS);
    expect(a.needed).toBe(Math.ceil(NOVEL / SIZE));
  });

  it('ước lượng entry khớp số đo thật (24→371, 48→551, lệch dưới 15%)', () => {
    const at24 = adviseChunks(NOVEL, SIZE, 24).currentEntries;
    const at48 = adviseChunks(NOVEL, SIZE, 48).currentEntries;
    expect(Math.abs(at24 - 371) / 371).toBeLessThan(0.15);
    expect(Math.abs(at48 - 551) / 551).toBeLessThan(0.15);
  });

  it('truyện ngắn đọc hết rồi → KHÔNG khuyên gì (đừng làm ồn vô cớ)', () => {
    const a = adviseChunks(100_000, SIZE, 12);
    expect(a.alreadyFull).toBe(true);
    expect(a.shouldAdvise).toBe(false);
    expect(adviceText(a, 100_000, 12)).toEqual([]);
  });

  it('đã đặt bằng/cao hơn mức đề xuất → không khuyên', () => {
    expect(adviseChunks(NOVEL, SIZE, 48).shouldAdvise).toBe(false);
    expect(adviseChunks(NOVEL, SIZE, 50).shouldAdvise).toBe(false);
  });

  it('không đề xuất quá trần — chạy hàng giờ thì lợi bất cập hại', () => {
    expect(adviseChunks(999_000_000, SIZE, 12).recommended).toBe(MAX_ADVISED_CHUNKS);
  });

  it('chunkSize = 0 (user xoá ô) không làm chia cho 0', () => {
    const a = adviseChunks(NOVEL, 0, 12);
    expect(Number.isFinite(a.needed)).toBe(true);
    expect(a.needed).toBeGreaterThan(0);
  });

  it('truyện rỗng → không khuyên, không NaN', () => {
    const a = adviseChunks(0, SIZE, 12);
    expect(a.shouldAdvise).toBe(false);
    expect(a.currentCoverage).toBe(0);
  });
});

describe('adviceText — phải nói cả CÁI GIÁ, không chỉ dụ bấm nút', () => {
  const a = adviseChunks(NOVEL, SIZE, 12);
  const lines = adviceText(a, NOVEL, 12);

  it('nêu % truyện đang đọc và % sau khi nâng', () => {
    expect(lines.join('\n')).toContain('4%');
    expect(lines.join('\n')).toContain(`${a.advisedCoverage}%`);
  });

  it('nêu thời gian chạy tăng lên — không giấu chi phí', () => {
    expect(lines.some((l) => /phút|giờ/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('Cái giá'))).toBe(true);
  });

  it('dẫn số đo thật để user tin được, không nói suông', () => {
    expect(lines.join('\n')).toContain('371');
    expect(lines.join('\n')).toContain('551');
  });

  it('nói rõ đổi lại được, để user không sợ bấm sai', () => {
    expect(lines.some((l) => l.includes('đổi lại'))).toBe(true);
  });

  it('truyện quá dài để đọc trọn thì mách cách tăng kích thước đoạn', () => {
    expect(lines.some((l) => l.includes('Kích thước mỗi đoạn'))).toBe(true);
  });
});
