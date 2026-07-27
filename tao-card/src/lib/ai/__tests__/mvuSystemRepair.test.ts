// (bug 115) "Cần thêm mục tự fix lại toàn bộ biến mvu như zod, quy tắc, định dạng đầu ra và
// bảng thanh trạng thái." — repairMissingMvuzodEntries chỉ dựng entry THIẾU HẲN; entry tồn tại
// nhưng HỎNG (rỗng, mất <UpdateVariable>, status bar trống) trước giờ không ai đụng.
import { describe, it, expect } from 'vitest';
import { repairMvuSystemIntegrity, autoRepairCard } from '../cardAutoRepair';
import { STATUS_BAR_ANCHOR } from '../../mvuzod/regexAnchors';
import type { CharacterCardV3, LorebookEntry, MVUZODSchema } from '../../../types';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [{
    path: 'Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
    children: [
      { path: 'Người Chơi/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
      { path: 'Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 100 } },
    ],
  }],
} as unknown as MVUZODSchema;

const entry = (o: Partial<LorebookEntry>): LorebookEntry => ({
  id: 1, keys: [], content: '', comment: '', enabled: true, constant: false,
  insertion_order: 100, selective: false, position: 'before_char', ...o,
} as unknown as LorebookEntry);

const mkCard = (entries: LorebookEntry[], scripts: unknown[] = []): CharacterCardV3 => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: 'Test', description: 'x', first_mes: 'Chào', personality: '', scenario: '',
    mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '',
    tags: [], creator: '', character_version: '', alternate_greetings: [],
    character_book: { name: 'LB', entries },
    extensions: { regex_scripts: scripts },
  },
} as unknown as CharacterCardV3);

describe('repairMvuSystemIntegrity — entry hệ thống HỎNG được tái sinh từ schema', () => {
  it('entry [mvu_update] quy tắc TỒN TẠI nhưng RỖNG → tái sinh (tên đúng nội dung rỗng vẫn lỗi 变量更新失败)', () => {
    const r = repairMvuSystemIntegrity(mkCard([
      entry({ id: 1, comment: '[mvu_update] Quy tắc cập nhật biến', content: '' }),
    ]), SCHEMA);
    expect(r.fixed.some(f => f.id === 'mvu_system_broken')).toBe(true);
    const rebuilt = r.card.data.character_book!.entries.find(e => /quy tắc/i.test(e.comment));
    expect(String(rebuilt?.content || '').length).toBeGreaterThan(50);
  });

  it('entry định dạng đầu ra mất khối <UpdateVariable> → tái sinh có đủ hợp đồng', () => {
    const r = repairMvuSystemIntegrity(mkCard([
      entry({ id: 1, comment: '[mvu_update] Định dạng đầu ra biến', content: 'Chỉ là một dòng chữ suông không có khối nào.' }),
    ]), SCHEMA);
    expect(r.fixed.some(f => f.id === 'mvu_system_broken')).toBe(true);
    const all = r.card.data.character_book!.entries.map(e => e.content).join('\n');
    expect(all).toMatch(/<UpdateVariable>/i);
  });

  it('hợp đồng nằm Ở ENTRY KIA (gộp update_rules + output_format) → KHÔNG kết tội oan', () => {
    const r = repairMvuSystemIntegrity(mkCard([
      entry({ id: 1, comment: '[mvu_update] Quy tắc cập nhật biến', content: 'Quy tắc: cập nhật qua khối bên entry định dạng. Xem entry kia. Nội dung đủ dài để không bị coi là rỗng.' }),
      entry({ id: 2, comment: '[mvu_update] Định dạng đầu ra biến', content: '<UpdateVariable>\n<Analysis>...</Analysis>\n<JSONPatch>[]</JSONPatch>\n</UpdateVariable>' }),
    ]), SCHEMA);
    expect(r.fixed).toHaveLength(1); // chỉ status bar (card không có script), KHÔNG có mvu_system_broken
    expect(r.fixed.some(f => f.id === 'mvu_system_broken')).toBe(false);
  });

  it('không có script render nào bám mỏ neo status bar → dựng lại từ schema', () => {
    const r = repairMvuSystemIntegrity(mkCard([], []), SCHEMA);
    expect(r.fixed.some(f => f.id === 'status_bar_rebuilt')).toBe(true);
    const scripts = (r.card.data.extensions as { regex_scripts: { findRegex?: string; replaceString?: string }[] }).regex_scripts;
    const render = scripts.find(s => s.findRegex === STATUS_BAR_ANCHOR && String(s.replaceString || '').includes('<!DOCTYPE'));
    expect(render).toBeTruthy();
  });

  it('status bar ĐANG CÓ và không rỗng → không đụng vào', () => {
    const r = repairMvuSystemIntegrity(mkCard([], [
      { scriptName: 'SB', findRegex: STATUS_BAR_ANCHOR, replaceString: '```html\n<!DOCTYPE html><html><body>ok</body></html>\n```', markdownOnly: true },
    ]), SCHEMA);
    expect(r.fixed.some(f => f.id === 'status_bar_rebuilt')).toBe(false);
  });

  it('không có schema → không làm gì (không có nguồn để tái sinh)', () => {
    const r = repairMvuSystemIntegrity(mkCard([entry({ comment: '[mvu_update] Quy tắc', content: '' })]), null);
    expect(r.fixed).toHaveLength(0);
  });

  it('autoRepairCard gọi cả phép vá này (nút "Vá hết lỗi" xử được hệ MVU)', () => {
    const r = autoRepairCard(mkCard([
      entry({ id: 1, comment: '[mvu_update] Quy tắc cập nhật biến', content: '' }),
    ]), SCHEMA);
    expect(r.fixed.some(f => f.id === 'mvu_system_broken')).toBe(true);
  });
});
