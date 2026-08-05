/**
 * (bug 213 — Đợt 1: AN TOÀN DỮ LIỆU)
 *
 * Ba đường âm thầm làm hỏng thẻ của user, không cái nào báo lỗi:
 *
 *   #2 postTranslationResidualCheck: điều kiện nhận bản dọn chữ Hán sót CHỈ là "ít chữ Hán hơn",
 *      không hề so độ dài. Entry vài chục nghìn ký tự → agent dọn trả nửa văn bản → đương nhiên
 *      "ít chữ Hán hơn" → được nhận làm KẾT QUẢ CUỐI, sau mọi guard độ dài của translateText.
 *
 *   #3 aiFixIssues / aiFixSingleIssue / aiFixRegexFields: field vượt hạn mức bị cắt thành đầu+đuôi
 *      kèm marker "[... N chars truncated ...]" rồi gửi AI, nhưng bản AI trả về (viết dựa trên bản
 *      CẮT) lại thay CẢ field → khúc giữa bốc hơi, marker rác chui vào thẻ xuất ra.
 *      Nay: gửi MỘT cửa sổ liền mạch và ghép trở lại đúng chỗ (đầu + đoạn sửa + đuôi).
 *
 *   #4 stream đứt giữa chừng: phần đã nhận được trả về như thành công; nếu nó tình cờ vượt ngưỡng
 *      continuation (85%, hoặc ≥100% thì thoát ngay) thì đoạn đuôi mất hẳn, không lỗi, không log.
 *
 * File này khoá hành vi ĐÚNG của cả ba, cộng lớp chặn marker cắt cụt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickFixWindow } from '../aiVerify';

const aiVerifySrc = readFileSync(new URL('../aiVerify.ts', import.meta.url), 'utf-8');
const apiClientSrc = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8');
const useTranslationSrc = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8');

/* ═════════════════ #3 — cửa sổ vá thay cho cắt cụt ═════════════════ */

describe('pickFixWindow — cửa sổ LIỀN MẠCH, ghép lại được', () => {
  it('văn bản vừa ngân sách → lấy trọn, không cắt gì', () => {
    const text = 'a'.repeat(500);
    expect(pickFixWindow(text, [10, 200], 1000)).toEqual({ start: 0, end: 500 });
  });

  it('văn bản quá khổ → cửa sổ không vượt ngân sách và nằm trong văn bản', () => {
    const text = 'x'.repeat(100_000);
    const w = pickFixWindow(text, [50_000], 10_000);
    expect(w.end - w.start).toBeLessThanOrEqual(10_000);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end).toBeLessThanOrEqual(text.length);
  });

  it('cửa sổ bám quanh chỗ lỗi', () => {
    const text = 'x'.repeat(100_000);
    const w = pickFixWindow(text, [70_000], 10_000);
    expect(70_000).toBeGreaterThanOrEqual(w.start);
    expect(70_000).toBeLessThanOrEqual(w.end);
  });

  it('không có mốc lỗi → lấy quanh giữa, vẫn liền mạch', () => {
    const text = 'x'.repeat(100_000);
    const w = pickFixWindow(text, [], 10_000);
    expect(w.end - w.start).toBeLessThanOrEqual(10_000);
    expect(w.start).toBeLessThan(w.end);
  });

  it('lỗi ở sát đầu / sát cuối vẫn cho cửa sổ hợp lệ', () => {
    const text = 'x'.repeat(100_000);
    const head = pickFixWindow(text, [0], 10_000);
    expect(head.start).toBe(0);
    expect(head.end).toBeLessThanOrEqual(10_000);

    const tail = pickFixWindow(text, [99_999], 10_000);
    expect(tail.end).toBe(100_000);
    expect(tail.end - tail.start).toBeLessThanOrEqual(10_000);
  });

  it('ĐIỂM MẤU CHỐT: ghép đầu + cửa sổ + đuôi phải dựng lại ĐÚNG bản gốc', () => {
    // Đây chính là tính chất mà cách cắt cũ (đầu+đuôi kèm marker) KHÔNG có: phần ngoài cửa sổ
    // được giữ nguyên xi, nên không có đường nào làm mất dữ liệu.
    const text = Array.from({ length: 2000 }, (_, i) => `dòng ${i} nội dung nào đó`).join('\n');
    const w = pickFixWindow(text, [Math.floor(text.length / 2)], 5_000);
    const rebuilt = text.slice(0, w.start) + text.slice(w.start, w.end) + text.slice(w.end);
    expect(rebuilt).toBe(text);
  });

  it('mốc lỗi rác (âm / vượt độ dài) không làm vỡ cửa sổ', () => {
    const text = 'x'.repeat(50_000);
    const w = pickFixWindow(text, [-5, 999_999], 8_000);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end).toBeLessThanOrEqual(50_000);
    expect(w.end - w.start).toBeLessThanOrEqual(8_000);
  });
});

describe('#3 — nối dây trong aiVerify: bản sửa phải được GHÉP, không thay cả field', () => {
  it('aiFixIssues ghép cửa sổ rồi mới đem đi kiểm & lưu', () => {
    expect(aiVerifySrc).toMatch(/const fixedFull = fixWindow[\s\S]{0,200}effectiveTranslation\.slice\(0, fixWindow\.start\)/);
    // validate + đếm lỗi + lưu đều phải chạy trên bản ĐẦY ĐỦ
    expect(aiVerifySrc).toMatch(/validateFixQuality\(\s*origField\.original, effectiveTranslation, fixedFull,/);
    expect(aiVerifySrc).toMatch(/translated: fixedFull/);
    expect(aiVerifySrc).toMatch(/bestFixes\.set\(path, \{ fixedText: fixedFull,/);
  });

  it('aiFixSingleIssue trả về bản ĐẦY ĐỦ, không trả riêng đoạn cửa sổ', () => {
    expect(aiVerifySrc).toMatch(/return \{ success: true, fixedText: fixedFull \}/);
    expect(aiVerifySrc).not.toMatch(/return \{ success: true, fixedText: fixed \}/);
  });

  it('aiFixRegexFields cũng ghép cửa sổ trước khi kiểm', () => {
    expect(aiVerifySrc).toMatch(/if \(rgWindowed\) \{[\s\S]{0,200}field\.translated\.slice\(0, rgTransWin\.start\)/);
  });

  it('ngưỡng "quá ngắn" đo theo CỬA SỔ, không theo cả field', () => {
    // Lấy cả field làm mốc thì bản sửa đúng của một đoạn nhỏ luôn bị coi là cụt và bị bác oan.
    expect(aiVerifySrc).toMatch(/const expectedLen = fixWindow \? fixWindow\.end - fixWindow\.start : effectiveTranslation\.length/);
    expect(aiVerifySrc).toMatch(/const rgExpectedLen = rgWindowed \? rgTransWin\.end - rgTransWin\.start : field\.translated\.length/);
  });

  it('prompt phải dặn AI trả ĐÚNG đoạn, cấm bịa phần không nhìn thấy', () => {
    expect(aiVerifySrc).toContain('EXCERPT MODE');
    expect(aiVerifySrc).toMatch(/do NOT try to reconstruct the parts you cannot see|never mention omitted text|do NOT reconstruct what you cannot see/i);
  });

  it('vị trí lỗi bên bản dịch suy theo TỈ LỆ, không dùng thẳng offset bản gốc', () => {
    expect(aiVerifySrc).toMatch(/lenRatio[\s\S]{0,120}field\.translated\.length \/ field\.original\.length/);
    expect(aiVerifySrc).toMatch(/transAnchors = issuePositions\.map\(p => Math\.round\(p \* lenRatio\)\)/);
  });
});

describe('#3b — marker cắt cụt không bao giờ được lọt vào thẻ', () => {
  const MARKER_RE = /\[\s*\.{3}\s*\d+\s*chars?(?:\s+truncated\s*)?\.{3}\s*\]/i;

  it('regex chặn bắt đúng cả hai dạng marker mà smartTruncate sinh ra', () => {
    expect(MARKER_RE.test('abc\n\n[... 12345 chars truncated ...]\n\ndef')).toBe(true);
    expect(MARKER_RE.test('abc\n[...900 chars...]\ndef')).toBe(true);
  });

  it('văn bản lành không bị bắt oan', () => {
    expect(MARKER_RE.test('Cô ấy có 200 chars trong tay [ghi chú]')).toBe(false);
    expect(MARKER_RE.test('mảng[...rest] trong JS')).toBe(false);
  });

  it('validateFixQuality có lớp chặn marker, và chặn TRƯỚC mọi kiểm khác', () => {
    const idxGuard = aiVerifySrc.indexOf('AI đang chép lại phần nó không nhìn thấy');
    const idxRatio = aiVerifySrc.indexOf('const lengthRatio = fixedText.length / currentTranslation.length');
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxRatio).toBeGreaterThan(idxGuard);
  });
});

/* ═════════════════ #2 — hàng rào độ dài cho bước dọn chữ Hán sót ═════════════════ */

describe('#2 — postTranslationResidualCheck không được nhận bản CỤT', () => {
  it('có hàng rào tỉ lệ độ dài trước khi chấp nhận bản dọn', () => {
    expect(apiClientSrc).toMatch(/const cleanedRatio = currentResult\.length > 0 \? parsed\.trim\(\)\.length \/ currentResult\.length : 1/);
    expect(apiClientSrc).toMatch(/if \(cleanedRatio < 0\.75\)[\s\S]{0,400}return currentResult;/);
  });

  it('hàng rào đứng TRƯỚC nhánh "ít chữ Hán hơn thì nhận"', () => {
    const idxGuard = apiClientSrc.indexOf('const cleanedRatio =');
    const idxAccept = apiClientSrc.indexOf('if (newResidual < residualCount)');
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxAccept).toBeGreaterThan(idxGuard);
  });

  it('luật quyết định: bản cụt bị loại kể cả khi sạch chữ Hán hơn hẳn', () => {
    // Mô phỏng đúng phép quyết định trong code.
    const accept = (before: string, cleaned: string, residualBefore: number, residualAfter: number) => {
      const ratio = before.length > 0 ? cleaned.length / before.length : 1;
      if (ratio < 0.75) return false;
      return residualAfter < residualBefore;
    };
    const full = 'x'.repeat(80_000);
    expect(accept(full, 'x'.repeat(40_000), 30, 0)).toBe(false);   // cụt một nửa, sạch trơn → LOẠI
    expect(accept(full, 'x'.repeat(59_000), 30, 0)).toBe(false);   // mất 26% → LOẠI
    expect(accept(full, 'x'.repeat(79_000), 30, 2)).toBe(true);    // gần đủ, bớt Hán → NHẬN
    expect(accept(full, 'x'.repeat(88_000), 30, 1)).toBe(true);    // dài hơn (Việt dài hơn Hán) → NHẬN
    expect(accept(full, 'x'.repeat(80_000), 30, 30)).toBe(false);  // đủ dài nhưng không bớt Hán → LOẠI
  });
});

/* ═════════════════ #4 — stream đứt giữa chừng phải lộ diện ═════════════════ */

describe('#4 — stream đứt giữa chừng không được coi là thành công', () => {
  it('cả ba provider đều gắn cờ streamBroken khi trả về bản dở', () => {
    const marks = apiClientSrc.match(/if \(usageSink\) usageSink\.streamBroken = true;/g) || [];
    expect(marks.length).toBe(3);   // OpenAI-compatible + Anthropic + Gemini
  });

  it('cờ được đẩy ngược lên caller qua meta.out', () => {
    expect(apiClientSrc).toMatch(/out\?: \{ streamBroken\?: boolean \}/);
    expect(apiClientSrc).toMatch(/if \(meta\?\.out && usageSink\.streamBroken\) meta\.out\.streamBroken = true;/);
  });

  it('translateChunk ÉP continuation khi stream đứt, bất kể tỉ lệ độ dài', () => {
    expect(apiClientSrc).toMatch(/let forceContinuation = !!callOut\.streamBroken/);
    expect(apiClientSrc).toMatch(/if \(responseRatio >= CONT_THRESHOLD && !forceContinuation\)/);
  });

  it('cờ ép chỉ dùng một vòng, không quay đủ 5 vòng vô ích', () => {
    expect(apiClientSrc).toMatch(/forceContinuation = false;/);
  });

  it('lượt nối bù mà cũng đứt stream thì bật lại cờ', () => {
    expect(apiClientSrc).toMatch(/if \(contOut\.streamBroken\) forceContinuation = true;/);
  });
});

/* ═════════════════ #1 — không cho hai vòng dịch chạy song song ═════════════════ */

describe('#1 — mọi đường khởi động lại đều phải bump runIdRef', () => {
  it('số lần bump runIdRef ĐỦ CHO cả 6 đường (start/pause/cancel + 3 đường phụ)', () => {
    const bumps = useTranslationSrc.match(/runIdRef\.current\+\+|\+\+runIdRef\.current/g) || [];
    expect(bumps.length).toBeGreaterThanOrEqual(6);
  });

  it('mỗi chỗ thay abortRef bằng controller MỚI đều có bump runIdRef đứng trước', () => {
    // Đây là bất biến thật sự của bug: abort suông rồi lắp controller mới = vòng cũ không thấy
    // tín hiệu thoát ở checkpoint và chạy tiếp bằng signal mới.
    const lines = useTranslationSrc.split('\n');
    const replaceIdx = lines
      .map((l, i) => (/abortRef\.current = new AbortController\(\)/.test(l) ? i : -1))
      .filter(i => i >= 0);
    expect(replaceIdx.length).toBeGreaterThanOrEqual(3);
    for (const i of replaceIdx) {
      const before = lines.slice(Math.max(0, i - 30), i).join('\n');
      expect(before).toMatch(/runIdRef\.current\+\+|\+\+runIdRef\.current/);
    }
  });

  it('generateModLorebook dừng hẳn vòng cũ thay vì ghi đè abortRef', () => {
    const idx = useTranslationSrc.indexOf('const generateModLorebook');
    const body = useTranslationSrc.slice(idx, idx + 3000);
    expect(body).toMatch(/runIdRef\.current\+\+/);
    expect(body).toMatch(/abortRef\.current\?\.abort\(\)/);
    // và phải abort TRƯỚC khi chiếm abortRef
    expect(body.indexOf('abortRef.current?.abort()')).toBeLessThan(body.indexOf('abortRef.current = abortCtrl'));
  });

  it('retranslateField đi qua CHUNG khoá inFlightPaths với vòng chính', () => {
    const idx = useTranslationSrc.indexOf('const retranslateField = useCallback');
    const body = useTranslationSrc.slice(idx, useTranslationSrc.indexOf('const residualCjkSweep', idx));
    expect(body).toMatch(/if \(inFlightPaths\.current\.has\(path\)\)/);
    expect(body).toMatch(/inFlightPaths\.current\.add\(path\)/);
    expect(body).toMatch(/inFlightPaths\.current\.delete\(path\)/);
  });

  it('khoá được nhả trong finally (lỗi giữa chừng không kẹt khoá vĩnh viễn)', () => {
    const idx = useTranslationSrc.indexOf('const retranslateField = useCallback');
    const body = useTranslationSrc.slice(idx, useTranslationSrc.indexOf('const residualCjkSweep', idx));
    const finallyIdx = body.lastIndexOf('} finally {');
    const releaseIdx = body.indexOf('inFlightPaths.current.delete(path)');
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(finallyIdx);
  });
});
