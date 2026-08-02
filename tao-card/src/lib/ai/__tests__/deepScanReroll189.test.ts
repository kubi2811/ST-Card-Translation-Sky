/**
 * (bug 189) Reroll từng giai đoạn của "Quét truyện bằng AI".
 * ─────────────────────────────────────────────────────────────────────────────
 * Nguyên tắc được kiểm: reroll lượt X đặt lại X + mọi lượt SAU, còn mọi lượt TRƯỚC và
 * toàn bộ bộ nhớ nghiên cứu (memory, chunkDone của lượt trước, stats) GIỮ NGUYÊN —
 * đấy chính là cái cứu 12 giờ quét + 4k call khi chỉ một bước hỏng.
 */
import { describe, it, expect } from 'vitest';
import {
  rerollFromPass, initDeepState, buildPassList, emptyMemory,
  type DeepScanState, type DeepScanOptions,
} from '../storyDeepScan';

const OPTS: DeepScanOptions = { maxVerifyRounds: 2, learnStyle: true, makeCard: true };

/** Dựng một state "đã chạy xong" đủ dữ liệu để soi reroll không phá phần nào. */
function doneState(): DeepScanState {
  const st = initDeepState('truyện dài thử nghiệm', OPTS, 3);
  st.status = 'done';
  st.passIndex = st.passes.length;
  for (const p of st.passes) { p.status = 'done'; p.done = 3; p.total = 3; }
  st.chunkDone = {
    structure: [0, 1, 2], characters: [0, 1, 2], world: [0, 1, 2],
    timeline: [0, 1, 2], style: [0, 1], verify1: [0, 1, 2], verify2: [0, 1, 2],
  };
  st.verifyRound = 2;
  st.memory = { ...emptyMemory(), overview: 'tổng quan', mainCharacter: 'Chu Minh Thụy' };
  st.memory.worldFacts.push({ topic: 'Hệ tu luyện', cat: 'system', fact: 'Có 9 cảnh giới' });
  st.stats = { aiCalls: 4336, facts: 26127, entries: 2089 };
  st.synthCache = {
    entries: [{ cat: 'system', title: 'Hệ tu luyện', keys: ['tu luyện'], content: '<System>…</System>', constant: false }],
    cards: [{ name: 'Chu Minh Thụy' }],
  };
  st.result = { entries: [], cards: [], report: ['x'] };
  return st;
}

const passIds = (st: DeepScanState) => st.passes.map((p) => `${p.id}:${p.status}`);

describe('rerollFromPass', () => {
  it('reroll lượt CUỐI (quality): chỉ nó reset, cache tổng hợp GIỮ — đúng ca "bước cuối không call"', () => {
    const st = rerollFromPass(doneState(), 'quality');
    expect(passIds(st).filter((s) => s.endsWith(':pending'))).toEqual(['quality:pending']);
    expect(st.passIndex).toBe(st.passes.findIndex((p) => p.id === 'quality'));
    expect(st.status).toBe('paused');
    expect(st.result).toBeUndefined();                       // kết quả cũ lỗi thời
    expect(st.synthCache?.entries).toHaveLength(1);          // 495 call tổng hợp KHÔNG phải chạy lại
    expect(st.chunkDone.structure).toEqual([0, 1, 2]);       // lượt trước nguyên vẹn
    expect(st.stats.aiCalls).toBe(4336);
  });

  it('reroll synthesize: cache tổng hợp phải bỏ (không thì quality đọc bản cũ), quality reset theo', () => {
    const st = rerollFromPass(doneState(), 'synthesize');
    expect(st.synthCache).toBeUndefined();
    const pending = passIds(st).filter((s) => s.endsWith(':pending'));
    expect(pending).toEqual(['synthesize:pending', 'quality:pending']);
    expect(st.verifyRound).toBe(2);                          // verify trước đó không bị đụng
    expect(st.chunkDone.verify1).toEqual([0, 1, 2]);
  });

  it('reroll verify: verifyRound về 0 + chunkDone verifyN xoá sạch, các lượt đọc trước giữ nguyên', () => {
    const st = rerollFromPass(doneState(), 'verify');
    expect(st.verifyRound).toBe(0);
    expect(st.chunkDone.verify1).toBeUndefined();
    expect(st.chunkDone.verify2).toBeUndefined();
    expect(st.chunkDone.world).toEqual([0, 1, 2]);
    const pending = passIds(st).filter((s) => s.endsWith(':pending'));
    expect(pending).toEqual(['verify:pending', 'synthesize:pending', 'quality:pending']);
  });

  it('reroll lượt ĐẦU (structure): mọi lượt reset nhưng BỘ NHỚ nghiên cứu giữ nguyên (dedup máy lo phần thêm)', () => {
    const st = rerollFromPass(doneState(), 'structure');
    expect(st.passes.every((p) => p.status === 'pending')).toBe(true);
    expect(st.passIndex).toBe(0);
    expect(Object.keys(st.chunkDone)).toEqual([]);
    expect(st.memory.overview).toBe('tổng quan');
    expect(st.memory.worldFacts).toHaveLength(1);
    expect(st.memory.mainCharacter).toBe('Chu Minh Thụy');
  });

  it('pass không tồn tại trong cấu hình → trả nguyên trạng, không nổ', () => {
    const noStyle = initDeepState('x', { ...OPTS, learnStyle: false }, 1);
    const st = rerollFromPass(noStyle, 'style');
    expect(st.passes.map((p) => p.id)).toEqual(buildPassList({ ...OPTS, learnStyle: false }).map((p) => p.id));
    expect(st.passes.every((p) => p.status === 'pending')).toBe(true);
  });

  it('reroll khi passIndex đang ĐỨNG TRƯỚC lượt được chọn (đang dở dang) không kéo lùi passIndex quá đà', () => {
    const st0 = doneState();
    st0.status = 'paused';
    st0.passIndex = 2; // đang dở lượt characters
    const st = rerollFromPass(st0, 'quality');
    expect(st.passIndex).toBe(2); // vẫn resume từ chỗ đang dở, quality chỉ bị reset trạng thái
  });
});
