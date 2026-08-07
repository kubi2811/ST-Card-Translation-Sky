/**
 * src/utils/retryRegression.ts — (bug 219) DỊCH LẠI KHÔNG BAO GIỜ ĐƯỢC LÀM TỆ HƠN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật user gửi: entry tavernHelper 30k ký tự, 21/21 chunk sạch, bản dịch chỉ còn sót ~106
 * chữ Hán. Bấm dịch lại ⇒ bản dịch biến thành NGUYÊN VĂN bản gốc: 106 chữ Hán thành 30.000.
 * Công sức của 21 lượt gọi API bốc hơi, và với script lớn thì đó là án tử — chỉ cần sót 100
 * chữ là không bao giờ dám bấm dịch lại nữa.
 *
 * Đường đi của tai nạn (có ba khúc, mỗi khúc tự nó "hợp lý"):
 *   1. đường dịch lại XOÁ sạch completedChunks/rawChunks trước khi chạy (để cắt lại nhịp mới);
 *   2. lượt mới chạy trên NGUYÊN field 30k, và một chốt an toàn (cú pháp JS / EJS / bịa code)
 *      bắt được lỗi ⇒ theo luật bug 211 nó trả về BẢN GỐC để script không liệt;
 *   3. bản gốc đó được ghi thẳng lên `translated`, đè mất bản 99,6% tốt vừa rồi.
 * Khúc 2 là ĐÚNG khi field chưa có bản dịch nào. Nó chỉ sai khi đã có bản tốt hơn trong tay.
 *
 * Nên module này là chốt CUỐI, độc lập với mọi nguyên nhân: so bản MỚI với bản ĐANG CÓ, tệ hơn
 * thì không nhận. Không cần biết vì sao tệ — chỉ cần biết là tệ hơn.
 *
 * Thước đo (theo đúng thứ tự, dừng ở dấu hiệu đầu tiên):
 *   1. bản mới là nguyên văn bản gốc mà bản cũ thì không ⇒ tệ (đúng ca 219);
 *   2. còn NHIỀU chữ Hán hơn bản cũ ⇒ tệ (đếm bằng cùng bộ quét của việc 80: link và giá trị
 *      CSS giữ nguyên KHÔNG tính, nên không báo oan);
 *   3. ngắn hơn một nửa bản cũ trên field lớn ⇒ tệ (cụt output).
 * Không dấu hiệu nào ⇒ nhận bản mới, kể cả khi nó chỉ nhích hơn một chút.
 */

import { countResidualHan } from './residualCjkScan';

export interface RegressionInput {
  original: string;
  /** Bản dịch ĐANG CÓ trong thẻ. Rỗng/không có ⇒ chẳng có gì để mất. */
  previous?: string;
  /** Bản vừa dịch lại. */
  next: string;
  cssCjkHandling?: 'preserve' | 'translate';
}

export interface RegressionVerdict {
  /** true = KHÔNG được nhận bản mới. */
  worse: boolean;
  /** Câu nói thẳng cho log — chỉ có khi worse. */
  reason?: string;
  prevHan: number;
  nextHan: number;
}

/** Field lớn cỡ này mới xét luật "ngắn hơn một nửa" — entry ngắn dịch gọn là chuyện thường. */
const BIG_FIELD_CHARS = 2000;

export function judgeRetryResult(input: RegressionInput): RegressionVerdict {
  const { original, next } = input;
  const previous = input.previous ?? '';
  const css = input.cssCjkHandling ?? 'preserve';

  const prevHan = previous ? countResidualHan(previous, css) : 0;
  const nextHan = next ? countResidualHan(next, css) : 0;
  const nothingToLose = !previous.trim() || previous === original;
  if (nothingToLose) return { worse: false, prevHan, nextHan };

  if (next === original) {
    return {
      worse: true,
      reason: `bản mới là NGUYÊN VĂN bản gốc (${nextHan} chữ Hán) trong khi bản đang có chỉ còn ${prevHan}`,
      prevHan,
      nextHan,
    };
  }
  if (nextHan > prevHan) {
    return {
      worse: true,
      reason: `chữ Hán TĂNG từ ${prevHan} lên ${nextHan}`,
      prevHan,
      nextHan,
    };
  }
  if (previous.length > BIG_FIELD_CHARS && next.length < previous.length * 0.5) {
    return {
      worse: true,
      reason: `bản mới ngắn hơn một nửa bản đang có (${next.length.toLocaleString()} vs ${previous.length.toLocaleString()} ký tự) — nghi cụt output`,
      prevHan,
      nextHan,
    };
  }
  return { worse: false, prevHan, nextHan };
}

/** Câu log khi từ chối bản mới — nói rõ đã giữ lại cái gì để user không hoảng. */
export function regressionMessage(label: string, v: RegressionVerdict): string {
  return `🛡️ ${label}: GIỮ LẠI bản dịch cũ, bỏ bản vừa dịch lại — ${v.reason}. `
    + `Bản dịch tốt hơn không bị mất. Muốn ép ghi đè thì sửa tay trong ô bản dịch.`;
}
