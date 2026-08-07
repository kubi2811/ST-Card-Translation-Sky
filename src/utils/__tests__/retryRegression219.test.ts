/**
 * (bug 219) "21/21 chunk sạch, chỉ sót ~106 chữ Hán. Bấm dịch lại thì tool xoá sạch bản dịch và
 * bê nguyên bản gốc sang làm bản dịch — 106 chữ Hán thành 30.000."
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai nửa của bản vá, test cả hai:
 *   A. judgeRetryResult — chốt CUỐI: bản mới tệ hơn bản đang có thì KHÔNG nhận. Chốt này độc
 *      lập với nguyên nhân, nên dù sau này có thêm đường dịch lại nào nữa thì tai nạn "mất
 *      trắng bản dịch tốt" cũng không tái diễn.
 *   B. findResidualCjkChunks / planTargetedChunkRetry('residual') — khoanh ĐÚNG cell còn sót
 *      chữ Hán. Bộ cũ ('cjk') đòi cell >35% Hán nên với ca 106 chữ rải rác nó trả về RỖNG, và
 *      tool đành dịch tươi cả field 30k — chính con đường dẫn tới tai nạn ở A.
 */
import { describe, it, expect } from 'vitest';
import { judgeRetryResult, regressionMessage } from '../retryRegression';
import {
  findResidualCjkChunks, findCjkHeavyChunks, planTargetedChunkRetry,
} from '../chunkRetryPlan';

/* ─────────────────────────── A · chốt không-tệ-hơn ─────────────────────────── */

describe('(bug 219) judgeRetryResult — không bao giờ đổi bản tốt lấy bản tệ', () => {
  const ORIGINAL = '功法系统初始化：' + '神契六维'.repeat(2000);   // ~8000 chữ Hán

  it('ĐÚNG CA USER: bản mới là nguyên văn bản gốc, bản cũ chỉ sót ít ⇒ TỪ CHỐI', () => {
    const previous = 'Khởi tạo hệ thống công pháp: ' + 'Thần Khế Lục Duy '.repeat(1500) + '神契';
    const v = judgeRetryResult({ original: ORIGINAL, previous, next: ORIGINAL });
    expect(v.worse).toBe(true);
    expect(v.reason).toMatch(/NGUYÊN VĂN bản gốc/);
    expect(v.nextHan).toBeGreaterThan(v.prevHan);
    expect(regressionMessage('tavernHelper[2].content', v)).toContain('GIỮ LẠI bản dịch cũ');
  });

  it('chữ Hán TĂNG (dù không bằng bản gốc) ⇒ TỪ CHỐI', () => {
    const previous = 'Bản dịch tốt, còn sót 神契 hai chữ.';
    const next = 'Bản dịch kém, còn sót 神契六维功法 nhiều chữ hơn.';
    const v = judgeRetryResult({ original: ORIGINAL, previous, next });
    expect(v.worse).toBe(true);
    expect(v.reason).toMatch(/TĂNG từ 2 lên/);
  });

  it('chữ Hán GIẢM ⇒ NHẬN bản mới', () => {
    const previous = 'Bản cũ còn 神契六维功法 sót nhiều.';
    const next = 'Bản mới chỉ còn 神 một chữ.';
    const v = judgeRetryResult({ original: ORIGINAL, previous, next });
    expect(v.worse).toBe(false);
    expect(v.nextHan).toBeLessThan(v.prevHan);
  });

  it('sạch hẳn ⇒ NHẬN', () => {
    const v = judgeRetryResult({
      original: ORIGINAL,
      previous: 'Bản cũ còn 神契 sót.',
      next: 'Bản mới sạch hoàn toàn, không còn chữ nào.',
    });
    expect(v.worse).toBe(false);
    expect(v.nextHan).toBe(0);
  });

  it('chưa có bản dịch nào (hoặc bản cũ CHÍNH LÀ bản gốc) ⇒ luôn NHẬN, không có gì để mất', () => {
    expect(judgeRetryResult({ original: ORIGINAL, previous: '', next: ORIGINAL }).worse).toBe(false);
    expect(judgeRetryResult({ original: ORIGINAL, previous: ORIGINAL, next: ORIGINAL }).worse).toBe(false);
  });

  it('bản mới cụt còn dưới nửa bản cũ trên field lớn ⇒ TỪ CHỐI', () => {
    const previous = 'Câu dịch đầy đủ và dài. '.repeat(400);   // ~9600 ký tự, 0 chữ Hán
    const next = 'Câu dịch đầy đủ và dài. '.repeat(100);       // ~2400 ký tự, cũng 0 chữ Hán
    const v = judgeRetryResult({ original: ORIGINAL, previous, next });
    expect(v.worse).toBe(true);
    expect(v.reason).toMatch(/ngắn hơn một nửa/);
  });

  it('entry NGẮN dịch gọn lại thì KHÔNG bị coi là cụt (luật chỉ áp cho field lớn)', () => {
    const v = judgeRetryResult({ original: '简短', previous: 'Bản dịch dài dòng lắm lời', next: 'Ngắn gọn' });
    expect(v.worse).toBe(false);
  });

  it('chữ Hán trong LINK không tính — không báo oan (dùng chung bộ quét của việc 80)', () => {
    const previous = "Bản cũ sạch. import('https://cdn.com/骰子系统/a.js')";
    const next = "Bản mới sạch. import('https://cdn.com/骰子系统/a.js')";
    const v = judgeRetryResult({ original: '骰子系统很好', previous, next });
    expect(v.worse).toBe(false);
    expect(v.prevHan).toBe(0);
    expect(v.nextHan).toBe(0);
  });
});

/* ──────────────────── B · khoanh đúng cell còn sót chữ Hán ──────────────────── */

describe('(bug 219) findResidualCjkChunks — bắt được ca 106 chữ rải rác', () => {
  /** 21 cell, mỗi cell ~1500 chữ Hán nguồn; cell 3 và 17 còn sót vài chữ trong bản dịch. */
  const raw = Array.from({ length: 21 }, () => '神契六维功法系统'.repeat(200));
  const done = raw.map((_, i) => {
    const base = 'Hệ thống công pháp Thần Khế Lục Duy hoạt động bình thường. '.repeat(60);
    if (i === 3) return base + '神契六维';       // sót 4 chữ
    if (i === 17) return base + '功法系统';       // sót 4 chữ
    return base;
  });

  it('bộ CŨ (>35% Hán) mù hoàn toàn với ca này', () => {
    expect(findCjkHeavyChunks(raw, done)).toEqual([]);
  });

  it('bộ MỚI khoanh đúng cell 3 và 17', () => {
    expect(findResidualCjkChunks(raw, done)).toEqual([3, 17]);
  });

  it('planTargetedChunkRetry("residual") trả kế hoạch đúng 2 cell', () => {
    const plan = planTargetedChunkRetry({ rawChunks: raw, completedChunks: done }, 'residual');
    expect(plan).not.toBeNull();
    expect(plan!.suspects).toEqual([3, 17]);
    expect(plan!.reason).toContain('còn sót chữ Hán');
  });

  it('mọi cell còn sót ⇒ VẪN khoanh (không rơi về dịch tươi cả field như luật "hỏng quá nửa")', () => {
    const dirty = raw.map(() => 'Bản dịch còn 神契 sót.');
    const plan = planTargetedChunkRetry({ rawChunks: raw, completedChunks: dirty }, 'residual');
    expect(plan).not.toBeNull();
    expect(plan!.suspects).toHaveLength(21);
  });

  it('cell sạch hết ⇒ null (không có gì để dịch lại)', () => {
    const clean = raw.map(() => 'Bản dịch sạch hoàn toàn.');
    expect(planTargetedChunkRetry({ rawChunks: raw, completedChunks: clean }, 'residual')).toBeNull();
  });

  it('cell nguồn KHÔNG có chữ Hán thì Hán trong bản dịch không phải "sót"', () => {
    expect(findResidualCjkChunks(['English source only'], ['Bản dịch nhắc tên 神契'])).toEqual([]);
  });

  it('còn ô TRỐNG ⇒ null, để đường resume sẵn có tự xử', () => {
    const withHole = [...done];
    withHole[5] = '';
    expect(planTargetedChunkRetry({ rawChunks: raw, completedChunks: withHole }, 'residual')).toBeNull();
  });

  it('lệch nhịp cắt ⇒ null, không bao giờ dán bản cũ vào nhịp mới', () => {
    expect(planTargetedChunkRetry({ rawChunks: raw, completedChunks: done.slice(0, 20) }, 'residual')).toBeNull();
  });
});
