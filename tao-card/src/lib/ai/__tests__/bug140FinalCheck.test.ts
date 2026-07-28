// (bug 140) "Kiểm tra tổng thể" báo lỗi MVU cho card KHÔNG dùng MVU + vá lỗi phải có chừng mực.
// User: "card không tạo MVU thì nó cũng kiểm tra về phần MVU rồi nói card đó có lỗi MVU mặc dù
// là card normal" và "không được gộp/xóa entry quá tay đến mức từ 50 hay 100 entry rút xuống
// chỉ còn 5-6 entry".
import { describe, it, expect } from 'vitest';
import { cardUsesMvu, buildFinalCheckReport } from '../autoCreatorPipeline';
import type { CharacterCardV3 } from '../../../types';

const mkCard = (over: Record<string, unknown> = {}): CharacterCardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'Thẩm Vân', description: 'Một kiếm khách lang bạt.', first_mes: 'Ngươi tới rồi.',
    character_book: { name: 'wb', entries: [] },
    extensions: {},
    ...over,
  },
} as unknown as CharacterCardV3);

/** Cardstore giả — buildFinalCheckReport chỉ đọc `.card`. */
const asStore = (card: CharacterCardV3) => ({ card }) as never;

describe('(bug 140) cardUsesMvu — nhận diện card có thật sự dùng MVU', () => {
  it('card thường (chỉ lore + regex tô màu) → KHÔNG phải card MVU', () => {
    const card = mkCard({
      character_book: { name: 'wb', entries: [{ id: 1, comment: 'Thành Vọng Nguyệt', content: 'Một toà thành cổ ven sông.', keys: ['thành'] }] },
      extensions: { regex_scripts: [{ scriptName: 'Tô màu thoại', findRegex: '/"(.+?)"/g', replaceString: '<b>$1</b>' }] },
    });
    expect(cardUsesMvu(card.data as never)).toBe(false);
  });

  it('nhận ra card MVU qua schema / [initvar] / <UpdateVariable> / script MVU / stat_data', () => {
    expect(cardUsesMvu(mkCard({ extensions: { mvuzod: { schema: { fields: [{ path: '/HP', type: 'number' }] } } } }).data as never)).toBe(true);
    expect(cardUsesMvu(mkCard({ character_book: { entries: [{ comment: '[initvar]初始化', content: 'HP: 100' }] } }).data as never)).toBe(true);
    expect(cardUsesMvu(mkCard({ character_book: { entries: [{ comment: 'Định dạng', content: 'Dùng <UpdateVariable>…</UpdateVariable>' }] } }).data as never)).toBe(true);
    expect(cardUsesMvu(mkCard({ extensions: { tavern_helper: { scripts: [{ name: 'MVU', content: 'MagVarUpdate/artifact/bundle.js' }] } } }).data as never)).toBe(true);
    expect(cardUsesMvu(mkCard({ extensions: { regex_scripts: [{ replaceString: 'getvar("stat_data.HP")' }] } }).data as never)).toBe(true);
  });
});

describe('(bug 140) báo cáo Kiểm tra tổng thể', () => {
  it('card thường: KHÔNG có dòng lỗi MVU nào, và nói rõ đã bỏ qua', async () => {
    const card = mkCard({
      character_book: { name: 'wb', entries: [{ id: 1, comment: 'Thành Vọng Nguyệt', content: 'Một toà thành cổ ven sông, nổi tiếng với chợ đêm.', keys: ['thành'] }] },
      // Có script TavernHelper KHÁC (không phải MVU) — trước đây đủ để kích hoạt kiểm MVU
      // và báo "Thiếu script MVU".
      extensions: { tavern_helper: { scripts: [{ name: 'Hiệu ứng mưa', content: 'console.log("rain")', enabled: true }] } },
    });
    const r = await buildFinalCheckReport(asStore(card));
    const mvuErrors = r.lines.filter(l => l.startsWith('❌') && /MVU|initvar|UpdateVariable|registerMvuSchema|biến/i.test(l));
    expect(mvuErrors, `còn báo lỗi MVU oan: ${mvuErrors.join(' | ')}`).toEqual([]);
    expect(r.lines.some(l => l.includes('Card thường (không dùng MVU)'))).toBe(true);
  });

  it('card MVU thiếu thứ thật thì VẪN phải báo (không nới lỏng nhầm)', async () => {
    const card = mkCard({
      character_book: { name: 'wb', entries: [{ id: 1, comment: '[initvar]初始化', content: 'HP: 100', keys: [''] }] },
      extensions: {},   // có initvar nhưng KHÔNG có schema
    });
    const r = await buildFinalCheckReport(asStore(card));
    expect(r.problems).toBeGreaterThan(0);
    expect(r.lines.some(l => l.includes('dấu vết MVU') && l.includes('KHÔNG có schema'))).toBe(true);
  });
});
