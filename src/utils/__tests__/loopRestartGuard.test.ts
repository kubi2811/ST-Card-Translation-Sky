import { describe, it, expect } from 'vitest';
import { stitchContinuation } from '../loopController';

/**
 * (User 2026) BUG: "Trợ Lý AI thường trả về 2~3 phản hồi trong 1 câu trả lời", hay gặp ở câu
 * hỏi cần suy nghĩ lâu.
 *
 * Cơ chế: câu trả lời dài bị cắt do giới hạn token → app tự gọi vòng "viết tiếp".
 * stitchContinuation khử được phần AI LẶP LẠI ĐUÔI (findOverlap), nhưng nếu model phớt lờ
 * lệnh và VIẾT LẠI TỪ ĐẦU thì không có overlap nào → nguyên bài mới bị nối vào bài cũ →
 * user thấy 2-3 phản hồi trong một câu trả lời.
 */
describe('stitchContinuation — chặn ca model viết lại từ đầu', () => {
  const answer1 =
    'Để giải quyết vấn đề này, ta cần xét ba khía cạnh chính. ' +
    'Thứ nhất là hiệu năng, thứ hai là khả năng bảo trì, thứ ba là chi phí vận hành. ' +
    'Về hiệu năng, hệ thống hiện tại đang gặp nút thắt ở tầng truy vấn';

  it('model VIẾT LẠI TỪ ĐẦU → KHÔNG nối, giữ nguyên bài cũ', () => {
    // Model trả lời lại y hệt câu hỏi cũ (mở đầu giống hệt), chỉ khác phần sau.
    const restart =
      'Để giải quyết vấn đề này, ta cần xét ba khía cạnh chính. ' +
      'Thứ nhất là hiệu năng, thứ hai là khả năng bảo trì, thứ ba là chi phí. ' +
      'Tôi sẽ phân tích từng cái một cách chi tiết hơn.';
    const r = stitchContinuation(answer1, restart);
    expect(r.restarted).toBe(true);
    expect(r.stitched).toBe(answer1); // không nối gì thêm
    expect(r.addedChars).toBe(0);
  });

  it('viết tiếp ĐÚNG mạch → vẫn nối bình thường', () => {
    const cont = ' do thiếu chỉ mục. Giải pháp là thêm chỉ mục phù hợp.';
    const r = stitchContinuation(answer1, cont);
    expect(r.restarted).toBe(false);
    expect(r.stitched).toBe(answer1 + cont);
    expect(r.addedChars).toBeGreaterThan(0);
  });

  it('lặp lại đuôi rồi mới viết tiếp → vẫn cắt overlap như cũ', () => {
    const tail = answer1.slice(-60);
    const cont = tail + ' do thiếu chỉ mục ở bảng lớn.';
    const r = stitchContinuation(answer1, cont);
    expect(r.restarted).toBe(false);
    expect(r.overlapCut).toBeGreaterThan(0);
    expect(r.stitched).toContain('do thiếu chỉ mục ở bảng lớn.');
    // không được lặp lại đoạn đuôi hai lần
    expect(r.stitched.indexOf(tail)).toBe(r.stitched.lastIndexOf(tail));
  });

  it('continuation rỗng → không đổi gì, không báo restart', () => {
    const r = stitchContinuation(answer1, '');
    expect(r.restarted).toBe(false);
    expect(r.stitched).toBe(answer1);
  });
});
