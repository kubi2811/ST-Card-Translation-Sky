/**
 * (bug 222) "Retry xong 21/21 chunk mà tool không áp vào bản dịch — phải tự bấm 'Ghép lại' thì
 * 30k chữ Hán mới thành 251."
 * ─────────────────────────────────────────────────────────────────────────────
 * Bệnh: MỌI chunk đã dịch xong, nhưng một bước SAU khi ghép (verifySeams / bloat guard /
 * postTranslationResidualCheck — mấy bước này còn gọi API nên rất dễ đứt mạng) ném lỗi ⇒
 * translateText ném theo ⇒ caller đánh field 'error' và không ghi gì vào `translated`. Bản dịch
 * nằm đủ trong completedChunks nhưng KHÔNG ai ghép, nên user phải bấm tay.
 *
 * Luật mới, và là thứ file này khoá: ĐÃ ĐỦ CHUNK THÌ translateText KHÔNG BAO GIỜ NÉM.
 * Hậu xử lý là phần làm đẹp, không phải cửa ải.
 *
 * Đường đi này gọi API thật ở 4 chỗ nên không unit-test trực tiếp được; theo đúng lối đã dùng ở
 * bug 213/207, khoá bằng đối chiếu MÃ NGUỒN — nhưng khoá những điểm mà nếu ai sửa hỏng thì bug
 * quay lại y nguyên, đặc biệt là BỘ UNMASK phải khớp giữa đường thường và đường cứu cánh (thiếu
 * một cái là token che `__URL_0__` chui thẳng vào thẻ của user).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { joinChunks } from '../chunkAudit';

const src = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
const hookSrc = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8').replace(/\r\n/g, '\n');

/** Cắt đúng thân hàm rawJoinFallback để soi riêng. */
function fallbackBody(): string {
  const start = src.indexOf('const rawJoinFallback');
  expect(start, 'không thấy rawJoinFallback — bản vá 222 đã bị gỡ?').toBeGreaterThan(0);
  const end = src.indexOf('\n  };', start);
  return src.slice(start, end);
}

describe('(bug 222) đủ chunk rồi thì translateText không được ném', () => {
  it('có đường cứu cánh rawJoinFallback và catch TRẢ VỀ nó thay vì ném lại', () => {
    expect(src).toContain('const rawJoinFallback');
    const catchIdx = src.indexOf('} catch (postErr) {');
    expect(catchIdx, 'không thấy catch bọc khâu hậu xử lý').toBeGreaterThan(0);
    const catchBlock = src.slice(catchIdx, catchIdx + 1200);
    expect(catchBlock).toContain('return fallback;');
    // Không được ném lại — ném lại là bug quay về nguyên trạng.
    expect(catchBlock).not.toMatch(/\bthrow\b/);
  });

  it('BỘ UNMASK của đường cứu cánh khớp đủ với đường thường (thiếu 1 là lộ token che)', () => {
    const body = fallbackBody();
    for (const fn of ['unmaskUrls', 'unmaskSecrets', 'unmaskCssCjkValues', 'unmaskCodeBlocks']) {
      expect(body, `rawJoinFallback thiếu ${fn}`).toContain(fn);
    }
  });

  it('đường cứu cánh dùng ĐÚNG joiner đã tính cho field (HTML/code nối liền)', () => {
    const body = fallbackBody();
    expect(body).toContain('finalChunks.join(joiner)');
    // joiner phải được tính TRƯỚC try, nếu không đường cứu cánh không thấy nó.
    const joinerIdx = src.indexOf('const joiner = (isHtmlContent || isCodeHeavy)');
    const tryIdx = src.indexOf('  try {\n  const verifiedChunks = await verifySeams');
    expect(joinerIdx).toBeGreaterThan(0);
    expect(tryIdx).toBeGreaterThan(joinerIdx);
  });

  it('chốt "ghép hụt" (chunk rỗng) VẪN ném ChunkError — nằm TRƯỚC try, không bị nuốt', () => {
    const missingIdx = src.indexOf('Ghép hụt:');
    const tryIdx = src.indexOf('  try {\n  const verifiedChunks = await verifySeams');
    expect(missingIdx).toBeGreaterThan(0);
    expect(missingIdx, 'chốt ghép hụt bị lọt vào trong try → chunk rỗng sẽ bị ghép ra bản thiếu')
      .toBeLessThan(tryIdx);
  });

  it('quy tắc ghép của nút "Ghép lại" thủ công và của engine là MỘT', () => {
    // Nút thủ công dùng joinChunks; engine dùng joiner ''/'\n\n' theo cùng hai điều kiện.
    const code = 'const a = 1;\nfunction f() { return a; }\n' + '{};'.repeat(20);
    expect(joinChunks(['const a = 1;', 'let b = 2;'], code)).toBe('const a = 1;let b = 2;');
    expect(joinChunks(['Câu một.', 'Câu hai.'], 'Văn xuôi thường')).toBe('Câu một.\n\nCâu hai.');
    expect(joinChunks(['<p>a</p>', '<p>b</p>'], '<div><p>x</p></div>')).toBe('<p>a</p><p>b</p>');
  });
});

describe('(bug 219) đường dịch lại giữ được bản cũ khi lượt mới tệ hơn', () => {
  it('có ảnh chụp trước khi động dao + đường trả lại', () => {
    expect(hookSrc).toContain('const snapshot = {');
    expect(hookSrc).toContain('const restoreSnapshot =');
    expect(hookSrc).toContain('const hadTranslation =');
  });

  it('chốt judgeRetryResult chạy TRƯỚC khi ghi translated', () => {
    const judgeIdx = hookSrc.indexOf('judgeRetryResult({');
    const writeIdx = hookSrc.indexOf("store.updateField(path, {\n        status: 'done',\n        translated,");
    expect(judgeIdx).toBeGreaterThan(0);
    expect(writeIdx).toBeGreaterThan(0);
    expect(judgeIdx, 'chốt phải chạy TRƯỚC lệnh ghi, không thì ghi rồi mới xét là vô nghĩa')
      .toBeLessThan(writeIdx);
  });

  it('lỗi giữa đường mà đã có bản dịch ⇒ trả lại cả bản dịch LẪN tiến trình chunk cũ', () => {
    expect(hookSrc).toContain('} else if (hadTranslation) {');
    const idx = hookSrc.indexOf('} else if (hadTranslation) {');
    const block = hookSrc.slice(idx, idx + 900);
    expect(block).toContain('translated: snapshot.translated');
    expect(block).toContain('completedChunks: snapshot.completedChunks');
    expect(block).toContain('rawChunks: snapshot.rawChunks');
  });

  it('dịch lại nhắm đích được nối vào CẢ hai đường (bulk + sweep chữ Hán sót)', () => {
    expect(hookSrc).toContain('const armTargetedCjkResume = useCallback');
    // Đúng HAI chỗ gọi: vòng dịch lại hàng loạt và bộ quét chữ Hán sót.
    expect((hookSrc.match(/armTargetedCjkResume\(/g) ?? []).length).toBe(2);
    expect(hookSrc).toContain("planTargetedChunkRetry(f, 'residual')");
  });
});

describe('(bug 221) keep-alive được bật/tắt đúng chỗ trong vòng dịch', () => {
  it('bật khi bắt đầu dịch, tắt ở CẢ ba đường kết thúc (xong / dừng tay / huỷ)', () => {
    expect((hookSrc.match(/startKeepAlive\(\)/g) ?? []).length).toBe(1);
    expect((hookSrc.match(/stopKeepAlive\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
