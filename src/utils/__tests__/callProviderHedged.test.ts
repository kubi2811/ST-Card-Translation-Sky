import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hedgedRace, type HedgeAttempt } from '../hedge';

/**
 * (User 2026 — "Trợ Lý AI lâu quá, có xoay key/hedge như bên dịch không?") hedgedRace là lõi hedge
 * DÙNG CHUNG (callProviderHedged bọc quanh nó): quá ngưỡng mà lane chưa trả lời → bắn thêm bản trên
 * lane KHÁC (spawn tự chọn key/provider khác), lấy bản xong trước, HUỶ bản còn lại.
 * Test thuần logic — không đụng mạng.
 */

/** Tạo `spawn` giả: mỗi lần gọi lấy 1 kịch bản trong danh sách; ghi lại lượt gọi + trạng thái huỷ. */
function makeSpawn(scripts: ((resolve: (v: string) => void, reject: (e: Error) => void) => void)[]) {
  const calls: { aborted: boolean; reason?: string }[] = [];
  const spawn = (): HedgeAttempt<string> => {
    const idx = calls.length;
    const rec = { aborted: false as boolean, reason: undefined as string | undefined };
    calls.push(rec);
    const p = new Promise<string>((res, rej) => {
      const script = scripts[idx] ?? ((r) => r(`r${idx}`));
      script(res, rej);
    });
    return { p, abort: (reason?: string) => { rec.aborted = true; rec.reason = reason; } };
  };
  return { spawn, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hedgedRace — hedge dùng chung cho lượt gọi 1-shot', () => {
  it('trả lời TRƯỚC ngưỡng → chỉ 1 lượt gọi, KHÔNG tốn call kép', async () => {
    const { spawn, calls } = makeSpawn([(res) => setTimeout(() => res('nhanh'), 1000)]);
    const p = hedgedRace(spawn, 5000);
    await vi.advanceTimersByTimeAsync(1200);
    await expect(p).resolves.toBe('nhanh');
    expect(calls.length).toBe(1);
  });

  it('quá ngưỡng → bắn bản dự phòng trên lane khác; B xong trước → lấy B + HUỶ A (không tốn quota)', async () => {
    const onHedge = vi.fn();
    const { spawn, calls } = makeSpawn([
      (res) => setTimeout(() => res('A-treo'), 60_000), // lane nghẽn
      (res) => setTimeout(() => res('B-nhanh'), 500),   // lane khác, khoẻ
    ]);
    const p = hedgedRace(spawn, 5000, onHedge);

    await vi.advanceTimersByTimeAsync(5100);
    expect(onHedge).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(2); // đã bắn bản dự phòng

    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBe('B-nhanh');
    expect(calls[0].aborted).toBe(true);  // bản A thua → bị huỷ
    expect(calls[1].aborted).toBe(true);  // bản thắng cũng được dọn (no-op)
  });

  it('A lỗi TRƯỚC ngưỡng → ném luôn cho tầng trên retry, KHÔNG hedge vô ích', async () => {
    const onHedge = vi.fn();
    const { spawn, calls } = makeSpawn([(_res, rej) => setTimeout(() => rej(new Error('429 rate limit')), 800)]);
    const caught = hedgedRace(spawn, 5000, onHedge).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(caught).resolves.toContain('429');
    expect(calls.length).toBe(1);
    expect(onHedge).not.toHaveBeenCalled();
  });

  it('A treo, B lỗi → vẫn CHỜ A (không vội ném lỗi), A xong thì lấy A', async () => {
    const { spawn } = makeSpawn([
      (res) => setTimeout(() => res('A-cuối cùng cũng xong'), 9000),
      (_res, rej) => setTimeout(() => rej(new Error('B hỏng')), 300),
    ]);
    const p = hedgedRace(spawn, 5000);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe('A-cuối cùng cũng xong');
  });

  it('cả 2 bản đều lỗi → ném lỗi (không treo vô hạn)', async () => {
    const { spawn, calls } = makeSpawn([
      (_res, rej) => setTimeout(() => rej(new Error('A hỏng')), 9000),
      (_res, rej) => setTimeout(() => rej(new Error('B hỏng')), 300),
    ]);
    const caught = hedgedRace(spawn, 5000).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(caught).resolves.toMatch(/hỏng/);
    expect(calls.length).toBe(2);
  });
});

describe('hedgedRace + shouldHedge — bug "Aborted": đừng bắn kép khi lane ĐANG stream', () => {
  it('shouldHedge()=false tại ngưỡng (đã có byte về) → KHÔNG bắn B, chờ A xong', async () => {
    const onHedge = vi.fn();
    // A là câu trả lời DÀI: stream 40s mới xong — trước fix, chạm ngưỡng 5s là bắn bản kép vô ích.
    const { spawn, calls } = makeSpawn([(res) => setTimeout(() => res('A-dài-nhưng-khoẻ'), 40_000)]);
    const p = hedgedRace(spawn, 5000, onHedge, () => false /* đang stream */);
    await vi.advanceTimersByTimeAsync(41_000);
    await expect(p).resolves.toBe('A-dài-nhưng-khoẻ');
    expect(calls.length).toBe(1);          // không tốn call kép
    expect(onHedge).not.toHaveBeenCalled();
    expect(calls[0].aborted).toBe(false);  // và KHÔNG ai chém bản đang chạy tốt
  });

  it('shouldHedge()=true tại ngưỡng (im bặt, chưa có byte nào) → hedge như cũ', async () => {
    const onHedge = vi.fn();
    const { spawn, calls } = makeSpawn([
      (res) => setTimeout(() => res('A-treo'), 60_000),
      (res) => setTimeout(() => res('B-cứu'), 400),
    ]);
    const p = hedgedRace(spawn, 5000, onHedge, () => true /* chưa nhận gì */);
    await vi.advanceTimersByTimeAsync(5600);
    await expect(p).resolves.toBe('B-cứu');
    expect(calls.length).toBe(2);
    expect(onHedge).toHaveBeenCalledTimes(1);
  });

  it('không truyền shouldHedge → giữ nguyên hành vi cũ (hedge tại ngưỡng)', async () => {
    const { spawn, calls } = makeSpawn([
      (res) => setTimeout(() => res('A-treo'), 60_000),
      (res) => setTimeout(() => res('B'), 400),
    ]);
    const p = hedgedRace(spawn, 5000);
    await vi.advanceTimersByTimeAsync(5600);
    await expect(p).resolves.toBe('B');
    expect(calls.length).toBe(2);
  });
});
