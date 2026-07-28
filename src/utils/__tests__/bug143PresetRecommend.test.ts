// (bug 143) "Mỗi lần thoát Regex Manager về Menu chính lại hiện bảng Gợi ý cấu hình".
// Gốc rễ: cờ "đã đóng" là useState BÊN TRONG PresetRecommendModal, mà mở Regex Manager toàn
// màn hình thì App return sớm một cây khác ⇒ modal unmount ⇒ cờ về false ⇒ thoát ra hiện lại.
// Test khoá hợp đồng ở tầng STORE: đóng rồi thì mọi lần mount lại đều KHÔNG hiện nữa.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../store';

/** Điều kiện hiện popup, sao nguyên từ PresetRecommendModal. */
const shouldShow = () => {
  const s = useStore.getState();
  return !!s.presetRecommendCard && s.presetRecommendCard === s.cardFileName;
};

describe('(bug 143) bảng "Gợi ý cấu hình" chỉ hiện một lần cho mỗi lần import', () => {
  beforeEach(() => {
    useStore.setState({ cardFileName: 'card-a.png', presetRecommendCard: '', presetRecommendSeed: 0 });
  });

  it('import card mới → hiện', () => {
    useStore.getState().triggerPresetRecommend('card-a.png');
    expect(shouldShow()).toBe(true);
  });

  it('đóng rồi → KHÔNG hiện lại, dù component có mount lại bao nhiêu lần (ra/vào Regex Manager)', () => {
    useStore.getState().triggerPresetRecommend('card-a.png');
    useStore.getState().dismissPresetRecommend();
    expect(shouldShow()).toBe(false);
    // Mô phỏng vào Regex Manager rồi thoát ra: component mount lại, đọc lại store.
    for (let i = 0; i < 5; i++) expect(shouldShow(), `lần thoát thứ ${i + 1}`).toBe(false);
  });

  it('import card KHÁC sau đó vẫn hiện bình thường (không tắt vĩnh viễn tính năng)', () => {
    useStore.getState().triggerPresetRecommend('card-a.png');
    useStore.getState().dismissPresetRecommend();
    useStore.setState({ cardFileName: 'card-b.png' });
    useStore.getState().triggerPresetRecommend('card-b.png');
    expect(shouldShow()).toBe(true);
  });

  it('popup của card cũ không "đuổi theo" khi user đổi sang card khác mà chưa import lại', () => {
    useStore.getState().triggerPresetRecommend('card-a.png');
    useStore.setState({ cardFileName: 'card-b.png' });
    expect(shouldShow()).toBe(false);
  });
});
