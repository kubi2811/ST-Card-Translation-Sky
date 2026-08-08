/**
 * (bug 227) "Tool cố chấp dịch script này, loop vô hạn, không hề dịch entry nào khác dù bấm
 * dừng hay tiếp tục bao nhiêu lần… báo lỗi 22/21 chunk, dịch lại từ chunk 22, rồi dịch lại
 * toàn bộ 21 chunk từ đầu (lần thứ N)."
 * ─────────────────────────────────────────────────────────────────────────────
 * Vòng lặp này có hai mắt xích, và mắt nào cũng tự nó vô hại — ghép lại mới thành cái bẫy.
 *
 * MẮT 1 — Ô THỪA KHÔNG AI DỌN.
 *   Cỡ chunk THÍCH ỨNG theo số lane API, nên cùng một entry chạy lúc cấu hình khác là ra số
 *   mảnh khác (22 rồi 21). Chỗ ghi tiến trình chỉ NONG mảng cho đủ chỉ số vừa xong, không bao
 *   giờ CẮT đuôi của lượt trước ⇒ ô thứ 22 nằm lại vĩnh viễn.
 *   Rồi luật resume cũ đọc "mảng cũ (22) > số mảnh (21)" là kết luận nhịp cắt đổi và VỨT SẠCH
 *   bản dịch, dịch lại từ đầu. Dịch xong ghi 21 ô, ô thứ 22 vẫn còn ⇒ lượt sau lại vứt. Vòng
 *   không có đáy, mà mỗi vòng là 21 lượt gọi API cho một script 236KB.
 *
 * MẮT 2 — CỔNG MỀM HỨA MỘT ĐẰNG LÀM MỘT NẺO.
 *   Cổng in ra "dừng thử lại (GIỮ BẢN DỊCH HIỆN CÓ)" rồi ngay dòng sau đánh field là 'error'.
 *   Vòng dịch chọn việc theo `pending | error`, nên field đó được nhặt lại ở MỌI lượt Start /
 *   Tiếp tục sau đó — đúng cảnh "bấm dừng hay tiếp tục bao nhiêu lần cũng thế".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeChunkCells, decideChunkResume } from '../chunkRetryPlan';
import { decideSoftGate } from '../softGate';

const hookSrc = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
const apiSrc = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');

/* ───────────────────────── MẮT 1 · ô thừa ───────────────────────── */

describe('(bug 227) mảng ô luôn dài ĐÚNG số mảnh của lượt này', () => {
  it('dài hơn thì CẮT — đây là ô thừa từng đầu độc mọi lượt sau', () => {
    expect(normalizeChunkCells(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
  it('ngắn hơn thì đệm rỗng', () => {
    expect(normalizeChunkCells(['a'], 3)).toEqual(['a', '', '']);
  });
  it('rỗng/không có thì ra mảng đúng cỡ', () => {
    expect(normalizeChunkCells(undefined, 2)).toEqual(['', '']);
    expect(normalizeChunkCells([], 0)).toEqual([]);
  });
  it('giữ đúng nội dung từng ô, không xáo vị trí', () => {
    expect(normalizeChunkCells(['x', undefined, 'z'], 3)).toEqual(['x', '', 'z']);
  });
});

describe('(bug 227) mảng cũ DÀI HƠN nhưng mảnh gốc vẫn khớp ⇒ giữ bản dịch, chỉ cắt đuôi', () => {
  const raw = ['R0', 'R1', 'R2'];

  it('ca thật 22/21: cắt ô thừa rồi dịch tiếp, KHÔNG vứt sạch', () => {
    const d = decideChunkResume(['A', 'B', 'C', 'THỪA'], [...raw, 'R3'], raw);
    expect(d.mode).toBe('resume');
    expect(d.cells).toEqual(['A', 'B', 'C']);
    expect(d.reason).toContain('cắt bỏ 1 ô thừa');
  });

  it('mảnh gốc ĐỔI THẬT ⇒ mới bỏ (dán nhầm đoạn còn tệ hơn dịch lại)', () => {
    const d = decideChunkResume(['A', 'B', 'C'], ['R0', 'KHÁC', 'R2'], raw);
    expect(d.mode).toBe('fresh');
    expect(d.reason).toContain('mảnh gốc số 2');
    expect(d.cells).toEqual(['', '', '']);
  });

  it('mảng cũ NGẮN hơn, mảnh gốc khớp ⇒ đệm rồi dịch tiếp phần trống', () => {
    const d = decideChunkResume(['A'], ['R0'], raw);
    expect(d.mode).toBe('resume');
    expect(d.cells).toEqual(['A', '', '']);
  });

  it('không có mảnh gốc cũ mà số mảnh đã khác ⇒ không đoán bừa, dịch lại', () => {
    const d = decideChunkResume(['A', 'B'], undefined, raw);
    expect(d.mode).toBe('fresh');
    expect(d.reason).toContain('không có mảnh gốc cũ');
  });

  it('không có mảnh gốc cũ nhưng số mảnh trùng khít ⇒ dùng lại', () => {
    expect(decideChunkResume(['A', 'B', 'C'], undefined, raw).mode).toBe('resume');
  });

  it('chưa có gì ⇒ dịch mới, mảng đúng cỡ', () => {
    const d = decideChunkResume(undefined, undefined, raw);
    expect(d.mode).toBe('fresh');
    expect(d.cells).toHaveLength(3);
  });

  it('KẾT QUẢ LUÔN dài đúng số mảnh mới — không còn đường sinh ra 22/21', () => {
    for (const prev of [['A'], ['A', 'B', 'C', 'D', 'E'], []]) {
      expect(decideChunkResume(prev, undefined, raw).cells).toHaveLength(raw.length);
    }
  });
});

/* ───────────────────────── MẮT 2 · cổng mềm ───────────────────────── */

describe('(bug 227) cổng mềm: "giữ bản dịch" phải THẬT SỰ giữ, không đánh lỗi', () => {
  it('cùng lý do hai lượt liền ⇒ stop-same-reason', () => {
    expect(decideSoftGate({ reasonKey: 'cjk-script', previousReasonKey: 'cjk-script', retries: 1, maxRetries: 3 }))
      .toBe('stop-same-reason');
  });

  it('mã nguồn: cổng trả BA kết cục, không còn boolean', () => {
    expect(hookSrc).toContain("type GateOutcome = 'retry' | 'keep' | 'give-up'");
    expect(hookSrc).toContain("return 'keep';");
  });

  it('mã nguồn: MỌI nơi gọi cổng đều so === retry, không dùng truthy', () => {
    // Truthy là bẫy im lặng: 'keep' và 'give-up' đều là chuỗi khác rỗng ⇒ luôn đúng ⇒ thử lại
    // vô tận, tức là biến bản vá thành một bug nặng hơn bug đang sửa.
    const calls = [...hookSrc.matchAll(/if \(softGate\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      const tail = hookSrc.slice(m.index!, m.index! + 700);
      const close = tail.indexOf(') {');
      expect(tail.slice(0, close + 3), 'còn một nơi gọi softGate dùng truthy').toContain("=== 'retry'");
    }
  });

  it('mã nguồn: ba cổng chữ Hán đều có đường keep, và keep đánh done chứ không error', () => {
    for (const key of ["'cjk-script'", "'cjk-schema'", '`cjk-text:']) {
      expect(hookSrc, `cổng ${key} chưa nối vào keep`).toContain(key);
    }
    expect((hookSrc.match(/if \(gate === 'keep'\) return keepAsIs\(/g) || []).length).toBe(3);
    const keepFn = hookSrc.slice(hookSrc.indexOf('const keepAsIs ='), hookSrc.indexOf('const keepAsIs =') + 700);
    expect(keepFn).toContain("status: 'done'");
    expect(keepFn).toContain('keptWithWarning');
    expect(keepFn).not.toContain("status: 'error'");
  });

  it('mã nguồn: mục đã chấp nhận KHÔNG bị bộ quét chữ Hán lôi lại đường dịch đắt', () => {
    expect(hookSrc).toContain('acceptedWithWarning');
  });

  it('mã nguồn: người dùng tự bấm dịch lại thì cờ chấp nhận bị xoá', () => {
    const fn = hookSrc.slice(hookSrc.indexOf('const retranslateField = useCallback'));
    expect(fn.slice(0, 2000)).toContain('keptWithWarning: undefined');
  });
});

/* ───────────────────── engine dùng đúng bộ quyết định ───────────────────── */

describe('(bug 227) engine không còn tự suy luận nhịp cắt bằng phép so độ dài', () => {
  it('apiClient đi qua decideChunkResume', () => {
    expect(apiSrc).toContain('decideChunkResume(previouslyCompletedChunks, previousRawChunks, unmaskedChunks)');
  });

  it('KHÔNG còn luật cũ "mảng dài hơn ⇒ vứt hết"', () => {
    expect(apiSrc).not.toContain('previouslyCompletedChunks.length > chunks.length');
  });

  it('hook ghi tiến trình qua normalizeChunkCells ở MỌI chỗ, không còn vòng push nong mảng', () => {
    expect(hookSrc).not.toContain('while (updatedChunks.length <= chunkIdx)');
    expect((hookSrc.match(/normalizeChunkCells\(currentCompleted/g) || []).length).toBe(3);
  });
});
