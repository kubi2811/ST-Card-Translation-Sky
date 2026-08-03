/**
 * (bug 198) LUỒNG DỊCH CHÍNH BẮT QUÁ SÁT, ÉP DỊCH LẠI VÔ ÍCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "luồng dịch chính của app Dịch Card có quá nhiều thứ gây xung đột, các chức năng không
 * hiệu quả, thường hay bắt quá sát yêu cầu dịch lại — trong khi dịch bằng retry lại khá tốt,
 * dịch được cả những thứ mà luồng chính liên tục báo lỗi và đòi dịch lại."
 *
 * `translateSingleField` có 11 cổng ép dịch lại, phần lớn là suy đoán (dài/ngắn, còn chữ Hán,
 * lệch khối EJS, nghi bịa code). Phép dịch ở đây gần như TẤT ĐỊNH, nên đoán sai thì dịch lại ra
 * y hệt và cổng chặn tiếp — bug 197 là ca cực đoan, lý do không bao giờ hết nên quay vòng mãi.
 *
 * Luật mới (mượn nguyên cách chữa đã có ở chốt JS, bugNeedFix/95): cùng MỘT lý do thì chỉ bắt
 * dịch lại ĐÚNG MỘT LẦN. Lý do ĐỔI thì vẫn cho thử tiếp — đó là dấu hiệu đang tiến bộ.
 */
import { describe, it, expect } from 'vitest';
import { decideSoftGate } from '../softGate';

const d = (reasonKey: string, previousReasonKey?: string, retries = 0, maxRetries = 3) =>
  decideSoftGate({ reasonKey, previousReasonKey, retries, maxRetries });

describe('(bug 198) cổng mềm: cùng một lý do chỉ dịch lại một lần', () => {
  it('lần đầu gặp lý do → vẫn thử lại như cũ (không mất khả năng phát hiện)', () => {
    expect(d('halluc:dấu "[" THÊM 89')).toBe('retry');
  });

  it('gặp lại ĐÚNG lý do đó → dừng, không quay vòng', () => {
    expect(d('halluc:dấu "[" THÊM 89', 'halluc:dấu "[" THÊM 89', 1)).toBe('stop-same-reason');
  });

  it('lý do ĐỔI thì vẫn được thử tiếp — đang tiến bộ thì đừng chặn', () => {
    // Ca thật: lượt 1 còn 300/900 chữ Hán, lượt 2 còn 12/900 → rõ ràng đang khá lên.
    expect(d('cjk-text:12/900', 'cjk-text:300/900', 1)).toBe('retry');
  });

  it('cùng loại nhưng SỐ ĐO y hệt = không tiến bộ → dừng', () => {
    expect(d('cjk-text:300/900', 'cjk-text:300/900', 1)).toBe('stop-same-reason');
  });

  it('hết lượt thử thì dừng dù lý do mới', () => {
    expect(d('ejs-blocks:3/4', 'halluc:x', 3)).toBe('stop-out-of-retries');
  });

  it('cổng chỉ cho 1 lượt (tỉ lệ ngắn) vẫn tôn trọng trần riêng của nó', () => {
    expect(d('short', undefined, 0, 1)).toBe('retry');
    expect(d('short', undefined, 1, 1)).toBe('stop-out-of-retries');
  });

  it('chưa từng có vân tay (undefined) KHÔNG được coi là trùng', () => {
    expect(d('bất kỳ', undefined, 0)).toBe('retry');
  });

  it('vân tay rỗng của lượt trước cũng không trùng với lý do rỗng-khác', () => {
    expect(d('x', '', 0)).toBe('retry');
  });
});
