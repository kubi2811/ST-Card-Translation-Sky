/**
 * softGate.ts — (bug 198) QUYẾT ĐỊNH CỦA "CỔNG MỀM" TRONG LUỒNG DỊCH CHÍNH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "luồng dịch chính của app Dịch Card đang có quá nhiều thứ gây xung đột, các chức năng
 * không hiệu quả, thường hay bắt quá sát yêu cầu dịch lại — trong khi dịch bằng retry lại khá
 * tốt, dịch được cả những thứ mà luồng chính liên tục báo lỗi và đòi dịch lại."
 *
 * `translateSingleField` có 11 cổng `return 'retry'`. Phần lớn là SUY ĐOÁN: tỉ lệ dài/ngắn, còn
 * chữ Hán, lệch khối EJS, nghi bịa code. Cái khó là các phép dịch ở đây gần như TẤT ĐỊNH (phẫu
 * thuật = thay theo từ điển; cùng prompt + cùng model): đoán sai thì dịch lại ra y hệt, cổng lại
 * chặn tiếp — đốt thời gian và token mà không tiến thêm được bước nào. Bug 197 là ca cực đoan:
 * lý do không bao giờ hết nên nó quay vòng mãi.
 *
 * Cách chữa đã có sẵn ở chốt JS từ bugNeedFix/95: NHỚ DẤU VÂN TAY LÝ DO, trùng thì dừng. File này
 * chỉ tách phần quyết định đó ra thành hàm thuần để mọi cổng dùng chung và test được.
 *
 * Nguyên tắc: lần đầu gặp một lý do thì VẪN thử lại như cũ (không mất khả năng phát hiện); gặp lại
 * ĐÚNG lý do đó thì dừng, giữ bản dịch và nói rõ cho user. Bằng chứng CỨNG (bản dịch rỗng, JS vỡ
 * cú pháp, lỗi mạng/chunk) không đi qua đây.
 */

export type SoftGateDecision = 'retry' | 'stop-same-reason' | 'stop-out-of-retries';

export interface SoftGateInput {
  /** Vân tay lý do lần này — nên gói cả SỐ ĐO (vd `cjk-text:12/300`) để "đang tiến bộ" còn được thử tiếp. */
  reasonKey: string;
  /** Vân tay lý do của lượt trước trên chính field này (undefined nếu chưa có). */
  previousReasonKey?: string;
  /** Số lần đã thử lại. */
  retries: number;
  /** Trần số lần thử lại cho cổng này. */
  maxRetries: number;
}

export function decideSoftGate(input: SoftGateInput): SoftGateDecision {
  if (input.previousReasonKey !== undefined && input.previousReasonKey === input.reasonKey) {
    return 'stop-same-reason';
  }
  if (input.retries >= input.maxRetries) return 'stop-out-of-retries';
  return 'retry';
}
