// (bug 158) "Tạo thẻ từ truyện" chạy đủ 9 giai đoạn, 179 lượt AI, gom 1.831 dữ kiện — rồi ra
// ĐÚNG 0 entry, mà MỌI giai đoạn vẫn xanh và kết quả chỉ ghi "Thêm 0 entry vào Lorebook".
// User tưởng truyện thiếu dữ liệu; thật ra dữ liệu thừa thãi, chỉ khâu tổng hợp trượt.
import { describe, it, expect } from 'vitest';
import { buildYieldWarnings, MISSION_RULE } from '../storyDeepScan';

describe('(bug 158) có dữ kiện mà 0 entry phải bị gọi là LỖI', () => {
  it('đúng ca của user: nhiều dữ kiện, 0 entry → báo lỗi, không im lặng', () => {
    const w = buildYieldWarnings(0, 1831, []);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('1831');
    expect(w[0], 'phải nói rõ đây là LỖI').toContain('lỗi');
    expect(w[0], 'phải bác bỏ cách hiểu "truyện thiếu dữ liệu"').toContain('thiếu dữ liệu');
  });

  it('nêu ĐÍCH DANH lượt tổng hợp trắng tay để còn dò được', () => {
    const w = buildYieldWarnings(0, 500, ['Entry nhân vật: A, B', 'Entry thế giới [faction]']);
    expect(w[0]).toContain('Entry nhân vật: A, B');
  });

  it('truyện thật sự rỗng (0 dữ kiện, 0 entry) → KHÔNG báo lỗi oan', () => {
    expect(buildYieldWarnings(0, 0, [])).toEqual([]);
  });

  it('ra entry bình thường → im lặng', () => {
    expect(buildYieldWarnings(42, 1831, [])).toEqual([]);
  });

  it('có entry nhưng vài lượt trắng tay → cảnh báo NHẸ, không phải lỗi', () => {
    const w = buildYieldWarnings(42, 1831, ['Entry timeline (phần 2/3)']);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('⚠️');
    expect(w[0]).not.toContain('❌');
  });
});

describe('(bug 158) khung nhiệm vụ dạy AI CHÉP SỬ, không phải soi lỗ hổng', () => {
  it('cấm trả về danh sách "chưa xác định" thay cho entry', () => {
    expect(MISSION_RULE).toContain('chưa xác định');
    expect(MISSION_RULE).toContain('KHÔNG phải công cụ review');
  });

  it('bí ẩn chưa tiết lộ vẫn phải thành entry', () => {
    expect(MISSION_RULE).toContain('VẪN TẠO ENTRY');
  });

  it('không bịa KHÔNG có nghĩa là không viết', () => {
    expect(MISSION_RULE).toContain('không bịa');
  });
});
