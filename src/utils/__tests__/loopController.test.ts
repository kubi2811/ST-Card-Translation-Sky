// P2 roadmap — LoopController: phát hiện cắt dở, ghép khử lặp, mỏ neo đuôi, điều kiện dừng.
import { describe, it, expect } from 'vitest';
import {
  detectCut, findOverlap, stitchContinuation, buildContinuationPrompt,
  shouldStop, TAIL_ANCHOR_CHARS, STALL_MIN_ADDED,
} from '../loopController';

describe('detectCut — phát hiện phản hồi bị cắt dở', () => {
  it('code fence lẻ → cắt dở', () => {
    expect(detectCut('Đây là code:\n```js\nconst a = 1;')).toBe(true);
    expect(detectCut('Đây là code:\n```js\nconst a = 1;\n```')).toBe(false);
  });

  it('XML tag mở chưa đóng (AI_ACTION dở dang) → cắt dở', () => {
    expect(detectCut('<AI_ACTION>\n{"action":"EDIT_ENTRY"')).toBe(true);
  });

  it('kết thúc GIỮA CÂU với văn bản dài → cắt dở; kết thúc trọn câu → không', () => {
    const long = 'Nội dung phân tích chi tiết. '.repeat(20);
    expect(detectCut(long + 'và điều quan trọng nhất là nhân v')).toBe(true);
    expect(detectCut(long + 'và đó là kết luận cuối cùng.')).toBe(false);
  });

  it('câu trả lời ngắn không áp luật giữa-câu (chat "OK bạn nhé" hợp lệ)', () => {
    expect(detectCut('OK để tôi xem nhé')).toBe(false);
  });
});

describe('stitchContinuation — khử phần AI lỡ lặp lại', () => {
  it('AI lặp lại 2 câu cuối → cắt sạch, nối liền mạch', () => {
    const existing = 'Phần một của câu chuyện. Nhân vật chính bước vào rừng sâu và nghe thấy tiếng động lạ phía xa.';
    const continuation = 'Nhân vật chính bước vào rừng sâu và nghe thấy tiếng động lạ phía xa. Đó là một con rồng khổng lồ.';
    const r = stitchContinuation(existing, continuation);
    expect(r.stitched).toBe(existing + ' Đó là một con rồng khổng lồ.');
    expect(r.overlapCut).toBeGreaterThan(20);
    // Không còn đoạn lặp
    expect(r.stitched.match(/rừng sâu/g)!.length).toBe(1);
  });

  it('AI thêm \\n rồi mới lặp → vẫn bắt được overlap', () => {
    const existing = 'Danh sách quy tắc quan trọng: quy tắc số một là bảo toàn biến hệ thống';
    const continuation = '\n\nquy tắc số một là bảo toàn biến hệ thống, quy tắc số hai là giữ nguyên keys.';
    const r = stitchContinuation(existing, continuation);
    expect(r.stitched).toContain('quy tắc số hai');
    expect(r.stitched.match(/quy tắc số một/g)!.length).toBe(1);
  });

  it('không overlap → nối thẳng, addedChars = độ dài mới', () => {
    const r = stitchContinuation('abc xyz kết thúc ở đây rồi nhé.', 'Phần hoàn toàn mới tiếp theo.');
    expect(r.overlapCut).toBe(0);
    expect(r.addedChars).toBeGreaterThan(20);
  });

  it('findOverlap không ăn nhầm khi chỉ trùng vài ký tự ngẫu nhiên (< MIN_OVERLAP)', () => {
    expect(findOverlap('kết thúc bằng chữ a', 'a là chữ cái đầu tiên của bảng chữ cái tiếng Việt')).toBe(0);
  });
});

describe('buildContinuationPrompt — chỉ gửi mỏ neo đuôi', () => {
  it('bài dài 50k → prompt chỉ chứa đuôi ~800 ký tự, không chứa phần đầu', () => {
    const full = 'MỞ_ĐẦU_DUY_NHẤT ' + 'nội dung giữa bài. '.repeat(3000) + 'ĐUÔI_CUỐI_CÙNG';
    const p = buildContinuationPrompt('câu hỏi gốc', full, 2);
    expect(p).toContain('ĐUÔI_CUỐI_CÙNG');
    expect(p).not.toContain('MỞ_ĐẦU_DUY_NHẤT');
    expect(p.length).toBeLessThan(TAIL_ANCHOR_CHARS + 800); // đuôi + khung lệnh
  });
});

describe('shouldStop — điều kiện dừng rõ ràng, chống lặp vô hạn', () => {
  const cutText = 'Nội dung dài đang viết dở. '.repeat(30) + '```js\nlet x';
  const doneText = 'Hoàn chỉnh rồi. '.repeat(30);

  it('hết cắt dở → complete', () => {
    expect(shouldStop(doneText, { round: 1, startedAt: Date.now(), stalls: 0 })).toBe('complete');
  });

  it('còn cắt + chưa chạm giới hạn → tiếp tục (null)', () => {
    expect(shouldStop(cutText, { round: 1, startedAt: Date.now(), stalls: 0 })).toBe(null);
  });

  it('đủ 8 vòng → max_rounds; quá ngân sách thời gian → budget; 2 vòng dậm chân → stalled', () => {
    const now = Date.now();
    expect(shouldStop(cutText, { round: 8, startedAt: now, stalls: 0 }, undefined, now)).toBe('max_rounds');
    expect(shouldStop(cutText, { round: 1, startedAt: now - 6 * 60_000, stalls: 0 }, undefined, now)).toBe('budget');
    expect(shouldStop(cutText, { round: 1, startedAt: now, stalls: 2 }, undefined, now)).toBe('stalled');
  });

  it('STALL_MIN_ADDED là ngưỡng dương hợp lý', () => {
    expect(STALL_MIN_ADDED).toBeGreaterThan(0);
  });
});
