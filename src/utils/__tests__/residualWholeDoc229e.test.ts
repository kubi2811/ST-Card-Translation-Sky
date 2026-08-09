/**
 * (bug 229e) XONG 74/74 MẢNH RỒI MÀ THANH TRẠNG THÁI VẪN QUAY.
 * ─────────────────────────────────────────────────────────────────────────────
 * Sau khi ghép đủ chunk, `translateText` gọi `postTranslationResidualCheck` — bộ này nhét TOÀN
 * BỘ bản dịch vào MỘT lượt gọi và bảo AI "trả lại đầy đủ văn bản, dịch nốt mấy chữ Hán còn sót".
 *
 * Với entry khổng lồ thì hỏng theo ba đường cùng lúc:
 *   • bản dịch tiếng Việt của 714.000 ký tự gốc dài hơn 1,5 triệu ký tự — vượt xa cửa sổ ngữ
 *     cảnh, lượt gọi hoặc trượt hoặc trả về bản CỤT (mà bản cụt thì ghi đè lên bản ghép tốt);
 *   • hạn chờ ở đó là `requestTimeout × 3` = 30 PHÚT;
 *   • lượt gọi không truyền nhãn ⇒ bảng luồng chỉ hiện "Đang dịch…".
 *
 * Đo được: entry tavernHelper[6] xong đủ 74/74 mảnh lúc 21:57, tới 22:12 vẫn treo ở đúng đây.
 *
 * Đường tốt hơn đã có sẵn mà bị bỏ quên: bộ vá cục bộ (residualPatch.ts, bug 226) — gom đúng
 * những vùng còn chữ Hán, dịch MỘT lượt chỉ mấy vùng đó, dán về đúng offset cũ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { patchEligibility } from '../residualPatch';

const api = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
const fnStart = api.indexOf('async function postTranslationResidualCheck(');
const fn = api.slice(fnStart, fnStart + 9000);

/** Kế hoạch vá tối thiểu — chỉ hai trường mà patchEligibility đọc tới. */
const plan = (totalHan: number, spans: number) =>
  ({ totalHan, spans: new Array(spans).fill({}) } as unknown as Parameters<typeof patchEligibility>[0][number]);

describe('(bug 229e) chặn lượt viết lại cả tài liệu với entry lớn', () => {
  it('có ngưỡng và lùi lại trước khi vào vòng gọi AI', () => {
    expect(fn).toContain('MAX_WHOLE_DOC_REWRITE');
    const i = fn.indexOf('MAX_WHOLE_DOC_REWRITE');
    const j = fn.indexOf('for (let retry');
    expect(i, 'ngưỡng phải nằm TRƯỚC vòng gọi AI, không thì vẫn gửi cả tài liệu đi').toBeLessThan(j);
  });

  it('ngưỡng đủ nhỏ để chặn entry cỡ TavernHelper, đủ lớn để entry thường vẫn được quét', () => {
    const m = fn.match(/MAX_WHOLE_DOC_REWRITE = ([\d_]+)/);
    expect(m, 'không đọc được ngưỡng').toBeTruthy();
    const nguong = Number(m![1].replace(/_/g, ''));
    expect(nguong).toBeGreaterThanOrEqual(20_000);
    expect(nguong).toBeLessThanOrEqual(200_000);
  });

  it('lùi lại thì TRẢ NGUYÊN bản đang có, không trả rỗng', () => {
    const i = fn.indexOf('MAX_WHOLE_DOC_REWRITE)');
    const block = fn.slice(i, i + 500);
    expect(block).toContain('return translated;');
  });

  it('lượt gọi quét chữ Hán phải có NHÃN — không thì bảng luồng chỉ hiện "Đang dịch…"', () => {
    expect(fn).toMatch(/label: `\$\{fieldName\} — quét chữ Hán còn sót/);
  });
});

describe('(bug 229e) đường thay thế phải thật sự gánh được', () => {
  it('bộ vá cục bộ nhận ca "văn bản khổng lồ, ít chữ Hán sót"', () => {
    // Đây chính là hình dạng của entry sau khi 74 mảnh dịch xong: rất dài, chỉ lác đác chữ Hán.
    // `patchEligibility` trả null nghĩa là ĐI ĐƯỢC.
    expect(patchEligibility([plan(120, 8)])).toBeNull();
  });

  it('và vẫn từ chối khi sót quá nhiều — lúc đó dịch lại mới đúng, không phải vá', () => {
    expect(patchEligibility([plan(50_000, 9)])).toContain('50000 chữ Hán');
    expect(patchEligibility([plan(10, 900)])).toContain('900 vùng rời');
  });
});
