/**
 * (bugNeedFix/177) "phần dò lỗi cho phép chạy nhiều luồng chứ không phải từng luồng 1".
 *
 * Bốn vòng dò/sửa trong aiVerify.ts vốn là `for` tuần tự `await` từng call. Test này canh đúng
 * hai điều: (a) chúng đã đi qua runWorkerPool, (b) pool thật sự chạy chồng lấn chứ không nối đuôi.
 *
 * Cách canh (a) là đọc mã nguồn: gọi thật thì phải có API key và mạng, mà thứ cần bảo vệ ở đây là
 * "đừng ai lỡ tay đổi ngược về `for` tuần tự" — đọc nguồn canh đúng cái đó và không giả lập gì.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWorkerPool } from '../runWorkerPool';

const SRC = readFileSync(resolve(__dirname, '../aiVerify.ts'), 'utf-8').replace(/\r\n/g, '\n');

/** Cắt thân một hàm export theo tên (tới `\nexport ` kế tiếp). */
function bodyOf(name: string): string {
  const i = SRC.indexOf(`export async function ${name}`);
  expect(i, `không tìm thấy ${name}`).toBeGreaterThan(-1);
  const j = SRC.indexOf('\nexport ', i + 10);
  return SRC.slice(i, j > 0 ? j : undefined);
}

describe('Bốn vòng dò/sửa đều đã nối vào pool đa luồng', () => {
  const CASES: Array<[string, string]> = [
    ['aiVerifyCardStreaming', 'quét từng section'],
    ['aiRegexScan', 'quét từng regex script'],
    ['aiRegexFixAll', 'sửa từng field regex'],
    ['aiFixIssues', 'sửa từng field lỗi'],
  ];

  for (const [fn, what] of CASES) {
    it(`${fn} (${what}) chạy qua runWorkerPool, không phải for tuần tự`, () => {
      const body = bodyOf(fn);
      expect(body).toContain('runWorkerPool({');
      expect(body).toContain('concurrency: verifyConcurrency(config)');
      // Vẫn phải dừng được khi user bấm huỷ.
      expect(body).toContain('shouldStop: () => !!signal?.aborted');
    });
  }

  it('số luồng lấy từ ngân sách RPM thật, và không bao giờ tụt về 1', () => {
    const i = SRC.indexOf('function verifyConcurrency');
    expect(i).toBeGreaterThan(-1);
    const fn = SRC.slice(i, i + 260);
    expect(fn).toContain('computePoolConcurrency(config)');
    expect(fn).toContain('Math.max(2');
  });

  it('nhánh HUỶ trong callback dùng return, không dùng break', () => {
    // `break` của các vòng `for` CON bên trong callback (đếm ngoặc, soát macro…) vẫn hợp lệ và
    // vẫn còn — thứ phải biến mất là `break` để thoát vòng NGOÀI khi user bấm huỷ: sau khi thân
    // vòng thành callback thì nó nhảy qua biên hàm, TypeScript báo TS1107 ngay.
    for (const [fn] of CASES) {
      // Chỉ soi phần TỪ `runOne:` trở đi — vòng `for` còn lại ngoài callback (vòng lặp nhiều
      // lượt của aiFixIssues) vẫn được phép break, đó là vòng thật.
      const inCallback = bodyOf(fn).split('runOne: async').slice(1).join('runOne: async');
      expect(inCallback.includes('if (signal?.aborted) break;'), `${fn} còn abort-break kiểu cũ`).toBe(false);
      expect(inCallback).toContain('signal?.aborted) return;');
    }
  });
});

describe('runWorkerPool thật sự chồng lấn (không nối đuôi)', () => {
  it('8 việc mỗi việc 20ms, 4 luồng ⇒ có lúc ≥4 việc chạy cùng lúc', async () => {
    let running = 0;
    let peak = 0;
    const order: number[] = [];

    await runWorkerPool({
      total: 8,
      concurrency: 4,
      runOne: async (i) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 20));
        order.push(i);
        running--;
      },
    });

    expect(peak).toBeGreaterThanOrEqual(4);
    expect(order).toHaveLength(8);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('concurrency=1 là hành vi tuần tự cũ — đối chứng cho thấy phép đo trên có ý nghĩa', async () => {
    let running = 0, peak = 0;
    await runWorkerPool({
      total: 4, concurrency: 1,
      runOne: async () => {
        running++; peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 5));
        running--;
      },
    });
    expect(peak).toBe(1);
  });

  it('shouldStop chặn không cho kéo thêm việc mới', async () => {
    let done = 0;
    const res = await runWorkerPool({
      total: 20, concurrency: 2,
      shouldStop: () => done >= 4,
      runOne: async () => { await new Promise(r => setTimeout(r, 2)); done++; },
    });
    expect(res.cancelled).toBe(true);
    expect(done).toBeLessThan(20);
  });
});
