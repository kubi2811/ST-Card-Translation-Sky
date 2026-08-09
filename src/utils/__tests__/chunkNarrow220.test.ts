/**
 * (bug 220) "Tớ dịch tavern helper lớn nó bị lặp nghi bịa AI giống cái này 74 chunk, sai có 1
 * chunk mà nó cứ dịch đi dịch lại toàn bộ 74 chunk."
 * ─────────────────────────────────────────────────────────────────────────────
 * Bản 207 đã dạy engine khoanh vùng chunk hỏng, nhưng chỉ cho HAI cổng: vỡ cú pháp và còn
 * tiếng Trung. Cổng "nghi bịa code" và "lệch khối EJS" vẫn trả 'retry' trần — mà 'retry' của
 * một field đã đủ ô nghĩa là gọi AI lại cho TỪNG ô. Bundle webpack 765KB chia 74 mảnh, sai một
 * mảnh, là 74 lượt gọi, lặp tới khi hết lượt thử.
 *
 * Test này khoá hai thứ: bộ khoanh vùng theo vị từ chạy đúng, và MỌI cổng trong hook đều đã
 * nối vào một bộ khoanh nào đó trước khi trả 'retry' (đọc mã nguồn — vì đường đó gọi API thật
 * nên không unit-test trực tiếp được).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findChunksFailing } from '../chunkRetryPlan';

const hookSrc = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');

describe('(bug 220) khoanh đúng ô hỏng theo một phép thử bất kỳ', () => {
  const raw = ['A', 'B', 'C', 'D'];

  it('chỉ trả về ô mà phép thử kêu hỏng', () => {
    const done = ['a', 'B-HONG', 'c', 'd'];
    expect(findChunksFailing(raw, done, (_r, d) => d.includes('HONG'))).toEqual([1]);
  });

  it('ô giữ NGUYÊN bản gốc là ô chốt an toàn cứu, KHÔNG phải ô hỏng', () => {
    // Cell 2 == raw[2]: chốt an toàn đã cố ý trả về gốc. Xoá nó đi là ném lại vào lò đúng cái
    // vừa được cứu — và đường dịch lại không có chốt cú pháp.
    expect(findChunksFailing(raw, ['a', 'b', 'C', 'd'], () => true)).toEqual([0, 1, 3]);
  });

  it('ô rỗng để đường resume sẵn có tự lo, không đụng vào', () => {
    expect(findChunksFailing(raw, ['a', '', 'c', 'd'], () => true)).toEqual([0, 2, 3]);
  });

  it('lệch nhịp (số ô khác số mảnh) ⇒ không kết luận gì', () => {
    expect(findChunksFailing(raw, ['a', 'b'], () => true)).toEqual([]);
    expect(findChunksFailing(undefined, ['a'], () => true)).toEqual([]);
  });

  it('phép thử NÉM thì bỏ qua ô đó — thà bỏ sót còn hơn xoá nhầm ô đang tốt', () => {
    const done = ['a', 'b', 'c', 'd'];
    const out = findChunksFailing(raw, done, (_r, _d, i) => {
      if (i === 1) throw new Error('bộ dò hỏng');
      return true;
    });
    expect(out).toEqual([0, 2, 3]);
  });

  it('ca thật: 74 mảnh sai đúng 1 ⇒ khoanh ra đúng 1', () => {
    const raws = Array.from({ length: 74 }, (_, i) => `chunk-${i}`);
    const dones = raws.map((r, i) => (i === 39 ? `${r}-BIA-THEM-CODE` : `${r}-ok`));
    expect(findChunksFailing(raws, dones, (_r, d) => d.includes('BIA'))).toEqual([39]);
  });
});

describe('(bug 220) mọi cổng trong hook đều khoanh vùng trước khi retry', () => {
  it('có bộ khoanh theo vị từ dùng chung', () => {
    expect(hookSrc).toContain('function clearSuspectChunksBy(');
    // Chốt an toàn: khoanh gần hết ô nghĩa là phép thử đang nhìn cả field, không nhắm trúng gì.
    expect(hookSrc).toContain('Math.floor(raws.length * 0.6)');
  });

  it('cổng nghi-bịa-code chạy phép thử trên TỪNG cặp ô, không phải cả field', () => {
    const i = hookSrc.indexOf("'phần bị nghi bịa code'");
    expect(i, 'cổng nghi bịa chưa nối vào bộ khoanh').toBeGreaterThan(0);
    const block = hookSrc.slice(i, i + 400);
    expect(block).toContain('verifyCodeStructureParity(raw, done)');
    expect(block).toContain('detectInventedDeclarations(raw, done)');
  });

  it('cổng lệch-khối-EJS cũng khoanh', () => {
    expect(hookSrc).toContain("'phần lệch khối EJS'");
  });

  it('KHÔNG còn cổng nào trả retry mà chưa qua một bộ khoanh nào', () => {
    // Mỗi `return 'retry';` trong thân translateSingleField phải có một lời gọi khoanh vùng
    // đứng ngay trước đó (trong khoảng 900 ký tự) — trừ các ca KHÔNG chia chunk được:
    // dịch rỗng (chưa có ô nào) và lỗi mạng.
    const body = hookSrc.slice(hookSrc.indexOf('const softGate ='), hookSrc.indexOf('// Keep chunk progress for export'));
    const gates = [...body.matchAll(/return 'retry';/g)];
    expect(gates.length).toBeGreaterThan(3);
    const missing: string[] = [];
    for (const m of gates) {
      const before = body.slice(Math.max(0, m.index! - 900), m.index!);
      const narrowed = /clearSuspectChunksForRetry\(|clearSuspectChunksBy\(/.test(before);
      // Bỏ qua chính `return 'retry'` của softGate — đó là GIÁ TRỊ QUYẾT ĐỊNH trả cho caller,
      // không phải một lượt dịch lại; caller mới là nơi phải khoanh vùng.
      const isGateDecision = /lastSoftGateFingerprint: reasonKey/.test(before);
      const cannotChunk = isGateDecision || /Empty translation|API returned empty/.test(before);
      if (!narrowed && !cannotChunk) missing.push(before.slice(-160).trim());
    }
    expect(missing, 'còn cổng trả retry mà không khoanh vùng ⇒ dịch lại cả field').toEqual([]);
  });
});
