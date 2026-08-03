/**
 * (bug 190) ENTRY SINH RA TỚI ĐÂU PHẢI GIỮ ĐƯỢC TỚI ĐÓ.
 * ─────────────────────────────────────────────────────────────────────────────
 * Chuyện thật từ bug 189: hơn 12 giờ quét + 4k call rồi bước cuối hỏng. Bản vá 189 cứu được
 * tiến trình, nhưng entry vẫn chỉ VÀO LOREBOOK ở cú bấm cuối cùng — nghĩa là mọi sự cố trước
 * cú bấm đó vẫn có thể nuốt thứ đã sinh xong. Ba lưới của bug 190:
 *   1. onEntryBatch: mỗi job tổng hợp xong là entry được BÁO RA NGOÀI ngay (UI add vào Lorebook);
 *   2. synthCache ghi TĂNG DẦN sau từng job — crash giữa lượt tổng hợp không mất job đã xong;
 *   3. lượt tổng hợp RESUME THEO TỪNG JOB (chunkDone['synthesize']) — dừng ở job 3/4 thì chạy
 *      tiếp đúng 1 job còn thiếu, không đốt lại 3 job kia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let synthCalls = 0;
let abortAtSynthCall = 0; // 0 = không abort; N = job tổng hợp thứ N vừa tới là dừng
let ctrl: AbortController | null = null;

vi.mock('../client', () => ({
  computePoolConcurrency: () => 1, // tuần tự → thứ tự job xác định, test đoán được chỉ số
  callAI: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    if (sys.includes('<entries>')) {
      synthCalls++;
      if (abortAtSynthCall > 0 && synthCalls === abortAtSynthCall) {
        ctrl?.abort();
        throw new DOMException('Aborted', 'AbortError');
      }
      const cat = /<cat>([a-z|]+)<\/cat>/.exec(sys)?.[1]?.split('|')[0] ?? 'other';
      const uid = Math.random().toString(36).slice(2, 9);
      return {
        text: `<entries><entry><cat>${cat}</cat><title>Mục ${uid}</title><keys>k${uid}</keys>`
          + `<content>Nội dung riêng ${Math.random().toString(36).slice(2, 16)}.</content></entry></entries>`,
      };
    }
    if (sys.includes('<issues>')) return { text: '<none/>' };
    // Lượt đọc: trả đúng định dạng để bộ nhớ có 2 chủ đề thế giới (2 cat khác nhau) + 1 timeline
    // → lượt tổng hợp có NHIỀU job (worldview+meta, 2 lô thế giới, timeline) cho kịch bản dừng giữa chừng.
    return {
      text: '<part><summary>- tóm tắt</summary><terms></terms><main>A</main><unk></unk></part>'
        + '<overview>- thế giới rộng</overview><main>A</main>'
        + '<world><wf><topic>Kiếm Tông</topic><cat>faction</cat><f>Tông môn lớn nhất.</f></wf>'
        + '<wf><topic>Hệ Linh Căn</topic><cat>system</cat><f>Chia 5 cấp.</f></wf></world>'
        + '<tl><ev><time>Ngày 1</time><f>A xuống núi.</f></ev></tl>',
    };
  }),
}));

import { runDeepScan, rerollFromPass, type DeepScanState, type DeepEntry } from '../storyDeepScan';
import type { ProxyProfile, GenerationParams } from '../../../types';

const profile = { id: 'p', label: 'p', providerType: 'openai', baseUrl: '', apiKey: 'k', selectedModel: 'm' } as unknown as ProxyProfile;
const params = { temperature: 1, maxTokens: 4096 } as unknown as GenerationParams;
const story = 'Chương 1. ' + 'nội dung truyện. '.repeat(3000);
const baseOpts = { maxChunks: 2, maxVerifyRounds: 0, learnStyle: false, makeCard: false } as const;

describe('(bug 190) entry tổng hợp phải sống sót từng job một', () => {
  beforeEach(() => { synthCalls = 0; abortAtSynthCall = 0; ctrl = null; });

  it('onEntryBatch bắn ra NGAY theo từng job — tổng các batch = đúng bộ entry cuối', async () => {
    const batches: DeepEntry[][] = [];
    const st = await runDeepScan(story, profile, params, {
      ...baseOpts, onEntryBatch: (b) => batches.push(b),
    });
    expect(st.status).toBe('done');
    const streamed = batches.flat().map((e) => e.title).sort();
    expect(batches.length, 'phải bắn nhiều lần (theo job), không dồn một cục cuối').toBeGreaterThan(1);
    // Kết quả cuối là bộ streamed sau khử trùng — mọi entry cuối đều PHẢI đã được bắn ra trước đó.
    for (const e of st.result?.entries ?? []) expect(streamed).toContain(e.title);
  });

  it('dừng giữa lượt tổng hợp → synthCache + chunkDone giữ đúng các job đã xong', async () => {
    ctrl = new AbortController();
    abortAtSynthCall = 3; // job 1, 2 xong; job 3 vừa gọi là dừng
    const st = await runDeepScan(story, profile, params, { ...baseOpts, signal: ctrl.signal });
    expect(st.status).toBe('paused');
    // Bản cũ: synthCache chỉ ghi MỘT LẦN ở cuối pass → dừng giữa chừng là mất sạch 2 job đã xong.
    expect(st.synthCache?.entries.length ?? 0).toBe(2);
    expect(st.chunkDone['synthesize']?.length ?? 0).toBe(2);
  });

  it('resume sau khi dừng → CHỈ chạy job còn thiếu, entry cũ giữ nguyên', async () => {
    ctrl = new AbortController();
    abortAtSynthCall = 3;
    const st1 = await runDeepScan(story, profile, params, { ...baseOpts, signal: ctrl.signal });
    const totalJobs = st1.passes.find((p) => p.id === 'synthesize')?.total ?? 0;
    expect(totalJobs).toBeGreaterThan(2); // còn job chưa chạy thì resume mới có gì để đo

    abortAtSynthCall = 0;
    const callsBefore = synthCalls;
    const batches: DeepEntry[][] = [];
    const st2 = await runDeepScan(story, profile, params, { ...baseOpts, onEntryBatch: (b) => batches.push(b) }, st1);
    expect(st2.status).toBe('done');
    // Chỉ tốn đúng số job còn thiếu (job 3 dở dang + phần sau) — không đốt lại job 1, 2.
    expect(synthCalls - callsBefore).toBe(totalJobs - 2);
    // 2 entry của job cũ vẫn phải có mặt trong kết quả cuối (qua synthCache).
    const titles = (st2.result?.entries ?? []).map((e) => e.title);
    for (const e of st1.synthCache?.entries ?? []) expect(titles).toContain(e.title);
    // Entry khôi phục từ cache cũng được bắn lại qua onEntryBatch — bên nhận khử trùng theo tên.
    const streamed = batches.flat().map((e) => e.title);
    for (const e of st1.synthCache?.entries ?? []) expect(streamed).toContain(e.title);
  });

  it('reroll lượt tổng hợp → xoá cả sổ job đã xong (chạy lại thật, không bị "đã xong" chặn)', async () => {
    const st = await runDeepScan(story, profile, params, baseOpts);
    expect(st.chunkDone['synthesize']?.length ?? 0).toBeGreaterThan(0);
    const re = rerollFromPass(st as DeepScanState, 'synthesize');
    expect(re.chunkDone['synthesize']).toBeUndefined();
    expect(re.synthCache).toBeUndefined();
  });
});
