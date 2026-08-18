// (Tawa 2.0) Bốn luật sức khoẻ mới, đi kèm việc mở tham số ST nâng cao cho AI.
//
// Mở cho AI đặt sticky/selectiveLogic/probability/ignore_budget thì phải có chỗ bắt lại lúc nó
// đặt sai — cả khi người dùng tự tay chỉnh. Ba trong bốn luật dưới đây bắt kiểu hỏng IM LẶNG:
// entry vẫn hợp lệ, vẫn xuất ra file, chỉ là không bao giờ chạy như người viết tưởng.
import { describe, it, expect } from 'vitest';
import { checkWorldbookHealth } from '../worldbookHealthCheck';
import { DEFAULT_ENTRY_EXT } from '../../../types/lorebook.types';
import type { LorebookEntry, LorebookEntryExt } from '../../../types/lorebook.types';

const entry = (over: Partial<LorebookEntry> = {}, ext: Partial<LorebookEntryExt> = {}): LorebookEntry => ({
  id: over.id ?? 1,
  keys: ['Hắc Long Đầm'],
  secondary_keys: [],
  comment: 'Thử',
  content: 'nội dung đủ dài để không bị luật khác bắt vạ'.repeat(3),
  constant: false,
  selective: true,
  insertion_order: 100,
  enabled: true,
  position: 'after_char',
  use_regex: true,
  ...over,
  extensions: { ...DEFAULT_ENTRY_EXT, position: 1, ...ext },
});

const codes = async (e: LorebookEntry[]) => (await checkWorldbookHealth(e, 'single')).items.map(i => i.code);

describe('(Tawa 2.0) luật sức khoẻ cho tham số nâng cao', () => {
  it('sticky/cooldown/delay trên entry thường trú → cảnh báo + tự sửa về 0', async () => {
    const report = await checkWorldbookHealth([entry({ constant: true, selective: false }, { sticky: 5, cooldown: 3 })], 'single');
    const w = report.items.find(i => i.code === 'TIMING_ON_CONSTANT');
    expect(w, 'entry constant không có lúc "kích hoạt" để mà đếm lượt').toBeTruthy();
    expect(w!.autoFixable).toBe(true);
    expect(w!.fix?.extensions).toMatchObject({ sticky: 0, cooldown: 0, delay: 0 });
  });

  it('entry xanh lá có sticky thì KHÔNG bị bắt — đó là ca dùng đúng', async () => {
    expect(await codes([entry({}, { sticky: 5 })])).not.toContain('TIMING_ON_CONSTANT');
  });

  it('selectiveLogic khác AND ANY mà không có secondary key → cảnh báo', async () => {
    const report = await checkWorldbookHealth([entry({ secondary_keys: [] }, { selectiveLogic: 3 })], 'single');
    const w = report.items.find(i => i.code === 'LOGIC_NO_SECONDARY');
    expect(w, 'AND ALL không có tập key phụ để so → entry có thể không nổ lần nào').toBeTruthy();
    expect(w!.level).toBe('warning');
    expect(w!.fix?.extensions).toMatchObject({ selectiveLogic: 0 });
  });

  it('có secondary key thì selectiveLogic=3 là hợp lệ', async () => {
    expect(await codes([entry({ secondary_keys: ['Đêm Trăng Máu'] }, { selectiveLogic: 3 })]))
      .not.toContain('LOGIC_NO_SECONDARY');
  });

  it('key NGẮN mà chưa bật khớp trọn từ → nhắc (ca "nam" bắt trúng "việt nam")', async () => {
    const report = await checkWorldbookHealth([entry({ keys: ['nam', 'Vương Nam'] }, { match_whole_words: null })], 'single');
    const w = report.items.find(i => i.code === 'SHORT_KEY_PARTIAL_MATCH');
    expect(w).toBeTruthy();
    expect(w!.message).toContain('nam');
    expect(w!.fix?.extensions).toMatchObject({ match_whole_words: true });
  });

  it('key dài, hoặc đã bật khớp trọn từ → im lặng', async () => {
    expect(await codes([entry({ keys: ['Hắc Long Đầm'] })])).not.toContain('SHORT_KEY_PARTIAL_MATCH');
    expect(await codes([entry({ keys: ['nam'] }, { match_whole_words: true })])).not.toContain('SHORT_KEY_PARTIAL_MATCH');
  });

  it('probability < 100 mà useProbability=false → ST bỏ qua con số đó, phải báo', async () => {
    const report = await checkWorldbookHealth([entry({}, { probability: 30, useProbability: false })], 'single');
    const w = report.items.find(i => i.code === 'PROBABILITY_IGNORED');
    expect(w).toBeTruthy();
    expect(w!.fix?.extensions).toMatchObject({ useProbability: true });
  });

  it('quá 3 thẻ VIP ignore_budget → cảnh báo trên từng entry', async () => {
    const vips = [1, 2, 3, 4].map(id => entry({ id, comment: `VIP ${id}` }, { ignore_budget: true }));
    const report = await checkWorldbookHealth(vips, 'single');
    const hits = report.items.filter(i => i.code === 'IGNORE_BUDGET_ABUSE');
    expect(hits.length).toBe(4);
    expect(hits[0].message).toContain('4 entry');
  });

  it('ba thẻ VIP thì vẫn chấp nhận được', async () => {
    const vips = [1, 2, 3].map(id => entry({ id }, { ignore_budget: true }));
    expect(await codes(vips)).not.toContain('IGNORE_BUDGET_ABUSE');
  });
});
