/**
 * Bug 9 (guillichan) — hai ý còn lại của báo cáo:
 *  (4) "thay vì chờ nó chạy hết các batch mới gọi tiếp thì hãy cho nó gọi liên tục tới khi đủ như thiết lập"
 *  (5) "khi dùng tính năng áp dụng luôn hãy cho nó làm tới đâu thì đổi tới đó"
 * Bản cũ chạy theo LƯỢT: gọi `concurrency` batch rồi chờ CẢ LƯỢT xong. Một batch chậm giữ chân mọi
 * luồng còn lại, và actions chỉ tới tay panel khi cả trăm batch xong.
 */
import { describe, it, expect, vi } from 'vitest';

const started: string[] = [];
let releaseSlow: () => void = () => {};
const slowGate = new Promise<void>((r) => { releaseSlow = r; });

vi.mock('../client', () => ({
  computePoolConcurrency: () => 10,
  callAI: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const name = 'E' + (user.match(/--- ENTRY #(\d+)/)?.[1] ?? '?'); // entry của RIÊNG batch này
    started.push(name);
    if (name === 'E1') await slowGate; // batch đầu chậm (thử lại / model nghĩ lâu)
    const id = Number(name.slice(1));
    return { text: JSON.stringify([{ type: 'rewrite_content', targetEntryId: id, targetComment: `Mục ${name}`, reason: 'r', newContent: `mới ${name}` }]) };
  }),
}));

import { runRefinerPipeline, applyRefinerActions } from '../lorebookRefiner';
import { DEFAULT_REFINER_CONFIG } from '../../../types/lorebookRefiner.types';
import type { RefinerAction } from '../../../types/lorebookRefiner.types';

const entry = (i: number) => ({
  id: i, keys: [`khoá${i}`], secondary_keys: [], comment: `Mục E${i}`, content: `Nội dung mục E${i} đủ dài để không bị coi là rỗng.`,
  constant: false, selective: true, insertion_order: 100, enabled: true, position: 'after_char', use_regex: false,
  extensions: { position: 1, depth: 4, display_index: i, probability: 100, useProbability: true },
});

describe('bug 9 — refiner gọi batch liên tục + áp dụng tới đâu đổi tới đó', () => {
  it('batch chậm không giữ chân các luồng khác; actions tới tay ngay khi từng batch xong', async () => {
    const entries = [1, 2, 3, 4, 5, 6].map(entry);
    const card = { spec: 'chara_card_v3', data: { name: 'T', character_book: { entries } } } as any;
    const perBatch: RefinerAction[][] = [];
    const run = runRefinerPipeline(
      { ...DEFAULT_REFINER_CONFIG, operationMode: 'fix_only', entriesPerBatch: 1, concurrentBatches: 2, maxEntriesToProcess: 0 },
      {
        card, profile: {} as any, generationParams: {} as any, paused: false, stopped: false,
        log: () => {}, onProgress: () => {}, onActionsReady: () => {},
        onBatchActions: (a) => perBatch.push(a),
      },
    );

    // E1 đang treo. Với 2 luồng, luồng còn lại phải chạy hết E2..E6 MÀ KHÔNG đợi E1.
    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(['E1', 'E2', 'E3', 'E4', 'E5', 'E6'])));
    expect(perBatch.length).toBe(5);            // 5 batch xong đã báo về từng cái một
    releaseSlow();
    const { actions } = await run;
    expect(perBatch.length).toBe(6);
    expect(actions.filter((a) => a.type === 'rewrite_content')).toHaveLength(6);
  });

  it('action đã áp ở lúc batch xong thì bước áp cuối lượt không áp lại', () => {
    const updates: number[] = [];
    const ctx = {
      getEntries: () => [entry(1)] as any, addEntry: () => {}, deleteEntry: () => {}, getNextEntryId: () => 99, log: () => {},
      updateEntry: (id: number) => { updates.push(id); },
    };
    const a = { id: 'x', type: 'rewrite_content', targetEntryId: 1, reason: 'r', severity: 'warning', newContent: 'mới', applied: false, skipped: false } as RefinerAction;
    applyRefinerActions([a], ctx);
    expect(a.applied).toBe(true);
    applyRefinerActions([a], ctx);
    expect(updates).toEqual([1]);
  });
});
