import { describe, it, expect } from 'vitest';
import { recommendPreset } from '../presetRecommend';
import type { CharacterCard } from '../../types/card';

// Bộ phân tích card khi import → gợi ý preset (⚡ nhẹ / 📖 đầy đủ / 🚀 siêu tốc).
const mkCard = (over: any = {}): CharacterCard => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'test', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
    ...over,
  },
} as any);

describe('recommendPreset — gợi ý preset theo nội dung card', () => {
  it('card có [initvar]/[mvu_update] trong lorebook → ⚡ light (lý do mvu)', () => {
    const card = mkCard({
      character_book: { entries: [
        { comment: '[initvar]', content: '{"好感度": 0}' },
        { comment: '[mvu_update]变量更新规则', content: '规则规则' },
      ] },
    });
    const r = recommendPreset(card);
    expect(r.preset).toBe('light');
    expect(r.reason).toBe('mvu');
    expect(r.stats.hasMvu).toBe(true);
  });

  it('card có script TavernHelper dùng stat_data/registerMvuSchema → ⚡ light', () => {
    const card = mkCard({
      extensions: { tavern_helper: { scripts: [
        { name: 'schema', content: 'export const Schema = z.object({}); registerMvuSchema(Schema);' },
      ] } },
    });
    expect(recommendPreset(card).preset).toBe('light');
  });

  it('script nhiều chữ Hán (UI script) dù không MVU → ⚡ light (lý do script)', () => {
    const card = mkCard({
      extensions: { tavern_helper: { scripts: [
        { name: 'ui', content: '姓名'.repeat(300) }, // 600 chữ Hán > ngưỡng 500
      ] } },
    });
    const r = recommendPreset(card);
    expect(r.preset).toBe('light');
    expect(r.reason).toBe('script');
  });

  it('card thường nhưng NHIỀU entry → 🚀 turbo', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ comment: `e${i}`, content: '内容'.repeat(50) }));
    const card = mkCard({ character_book: { entries } });
    const r = recommendPreset(card);
    expect(r.preset).toBe('turbo');
    expect(r.reason).toBe('big');
  });

  it('card thường nhưng RẤT nhiều chữ → 🚀 turbo', () => {
    const card = mkCard({ description: '很'.repeat(50000) });
    expect(recommendPreset(card).preset).toBe('turbo');
  });

  it('card gọn nhẹ, không script/MVU → 📖 full', () => {
    const card = mkCard({
      description: '简介'.repeat(100),
      character_book: { entries: [{ comment: 'a', content: '内容内容' }] },
    });
    const r = recommendPreset(card);
    expect(r.preset).toBe('full');
    expect(r.reason).toBe('small');
  });
});
