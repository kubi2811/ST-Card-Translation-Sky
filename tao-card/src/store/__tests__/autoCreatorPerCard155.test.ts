// (bug 155-2) Cấu hình Auto Creator phải theo TỪNG CARD.
// User: "Khi tạo hoặc chuyển sang một Card khác, dữ liệu trong Xem trước & Tinh chỉnh, ô Ý tưởng
// và ô Yêu cầu/quy tắc sẽ tự động reset về trạng thái của Card đó. Mỗi Card chỉ lưu dữ liệu của
// riêng mình." Trước đây chỉ có MỘT bản config dùng chung — mở card khác vẫn thấy dữ liệu card
// trước, rồi vô tình tạo card mới bằng ý tưởng của card cũ.
import { describe, it, expect, beforeEach } from 'vitest';
import { useAutoCreatorStore } from '../autoCreatorStore';

const S = () => useAutoCreatorStore.getState();

describe('(bug 155-2) config Auto Creator tách theo card', () => {
  beforeEach(() => {
    useAutoCreatorStore.setState({ configByProject: {}, boundProjectId: null });
    S().bindProject(null);
    S().setIdea('');
  });

  it('đổi card → ô Ý tưởng và Quy tắc trả về trạng thái CỦA CARD ĐÓ', () => {
    S().bindProject('card-A');
    S().setIdea('ý tưởng của A');
    S().setUserRules?.('quy tắc A');

    S().bindProject('card-B');
    expect(S().config.idea, 'card mới phải sạch, không mang dữ liệu card A').toBe('');

    S().setIdea('ý tưởng của B');
    S().bindProject('card-A');
    expect(S().config.idea, 'quay lại A phải thấy đúng dữ liệu của A').toBe('ý tưởng của A');
  });

  it('schema "Xem trước & Tinh chỉnh" cũng theo card', () => {
    S().bindProject('card-A');
    S().setTuning({ step: 1, confirmed: false } as never);
    expect(S().config.tuning).toBeTruthy();

    S().bindProject('card-B');
    expect(S().config.tuning, 'card B chưa tinh chỉnh gì thì phải trống').toBeFalsy();

    S().bindProject('card-A');
    expect(S().config.tuning, 'A vẫn giữ bản tinh chỉnh của mình').toBeTruthy();
  });

  it('gắn lại CÙNG một card thì không đụng gì (không xoá nhầm dữ liệu đang nhập)', () => {
    S().bindProject('card-A');
    S().setIdea('đang gõ dở');
    S().bindProject('card-A');
    expect(S().config.idea).toBe('đang gõ dở');
  });

  it('dữ liệu từng card được giữ trong ngăn riêng, không đè lên nhau', () => {
    S().bindProject('card-A'); S().setIdea('A');
    S().bindProject('card-B'); S().setIdea('B');
    S().bindProject('card-C'); S().setIdea('C');
    S().bindProject('card-A'); expect(S().config.idea).toBe('A');
    S().bindProject('card-B'); expect(S().config.idea).toBe('B');
    S().bindProject('card-C'); expect(S().config.idea).toBe('C');
  });
});
