/**
 * (bug 163) MỘT KHOÁ HỎNG TRONG BỘ KHOÁ KHÔNG ĐƯỢC LÀM GÃY CẢ BUỔI.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ca thật: bộ khoá user đưa để chạy thử có 3 khoá thì khoá số 2 đã bị thu hồi. Client xoay vòng
 * khoá theo kiểu round-robin, mà 401 KHÔNG nằm trong nhóm "lỗi tạm thời" nên nó ném thẳng ra
 * ngoài — cứ 3 lượt gọi là chết 1. Một lượt quét truyện dài cần hàng trăm lượt gọi thì không có
 * cách nào chạy tới cuối, và thứ user nhìn thấy vẫn đúng một câu: "không có entry nào".
 *
 * Khoá cũ còn sót trong ô cấu hình là chuyện rất thường. Bỏ qua nó là được, miễn còn khoá sống.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { liveKeys, markKeyDead, isKeyDead, resetDeadKeys } from '../client';

describe('(bug 163) bỏ qua khoá đã biết là hỏng', () => {
  beforeEach(() => resetDeadKeys());

  it('chưa đánh dấu gì → dùng cả bộ', () => {
    expect(liveKeys('p1', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('đánh dấu một khoá hỏng → các lượt sau không đụng vào nó nữa', () => {
    markKeyDead('p1', 'b');
    expect(isKeyDead('p1', 'b')).toBe(true);
    expect(liveKeys('p1', ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('khoá hỏng của provider này KHÔNG ảnh hưởng provider khác', () => {
    // Hai provider dùng chung một chuỗi khoá là chuyện có thật (cùng nhà cung cấp, hai proxy).
    markKeyDead('p1', 'a');
    expect(liveKeys('p2', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('HỎNG HẾT → trả lại nguyên bộ để lỗi thật nổi lên, không trả mảng rỗng', () => {
    // Trả rỗng thì client sẽ gọi với khoá undefined và ném ra một lỗi khác hẳn, che mất nguyên
    // nhân thật là "mọi khoá đều bị từ chối".
    markKeyDead('p1', 'a'); markKeyDead('p1', 'b');
    expect(liveKeys('p1', ['a', 'b'])).toEqual(['a', 'b']);
  });
});
