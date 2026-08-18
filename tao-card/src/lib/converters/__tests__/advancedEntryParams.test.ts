// (Tawa 2.0) THAM SỐ ST NÂNG CAO — mở cho AI đặt, nhưng KHÔNG mở toang.
//
// `LorebookEntryExt` đỡ đủ bộ tham số của SillyTavern từ lâu (sticky/cooldown/ignore_budget/
// selectiveLogic/match_whole_words…), nhưng chưa đường sinh nào cho AI chạm tới: mọi entry sinh ra
// đều mang y hệt DEFAULT_ENTRY_EXT. Nay AI đặt được — nên phải khoá lại đúng ba thứ:
//   1. miền giá trị (AI trả sticky 9999 / probability -3 là chuyện thường);
//   2. tham số vô nghĩa với entry thường trú thì không được ghi vào file;
//   3. cơ chế đệ quy vẫn là quyết định của guide, không phải của AI.
import { describe, it, expect } from 'vitest';
import { materializeEntry, advancedExtFromAi } from '../cardDefaults';
import { DEFAULT_ENTRY_EXT } from '../../../types/lorebook.types';
import type { AIGeneratedEntry } from '../../../types/aiAgent.types';

const ai = (over: Partial<AIGeneratedEntry> = {}): AIGeneratedEntry => ({
  comment: 'Thử',
  content: 'nội dung',
  keys: ['a'],
  ...over,
} as AIGeneratedEntry);

describe('(Tawa 2.0) AI đặt được tham số nâng cao', () => {
  it('entry kích hoạt theo từ khoá: sticky/cooldown/delay/group đi thẳng vào extensions', () => {
    const e = materializeEntry(
      ai({ constant: false, selective: true, sticky: 4, cooldown: 6, delay: 2, group: 'thời tiết', group_weight: 30 }),
      {},
      1,
    );
    expect(e.extensions.sticky).toBe(4);
    expect(e.extensions.cooldown).toBe(6);
    expect(e.extensions.delay).toBe(2);
    expect(e.extensions.group).toBe('thời tiết');
    expect(e.extensions.group_weight).toBe(30);
  });

  it('match_whole_words/selectiveLogic/ignore_budget/vectorized nhận đúng giá trị', () => {
    const e = materializeEntry(
      ai({ constant: false, selective: true, match_whole_words: true, selectiveLogic: 3, ignore_budget: true, vectorized: true }),
      {},
      1,
    );
    expect(e.extensions.match_whole_words).toBe(true);
    expect(e.extensions.selectiveLogic).toBe(3);
    expect(e.extensions.ignore_budget).toBe(true);
    expect(e.extensions.vectorized).toBe(true);
  });

  it('đặt probability thì phải tự bật useProbability — không thì ST bỏ qua con số đó', () => {
    const e = materializeEntry(ai({ constant: false, selective: true, probability: 35 }), {}, 1);
    expect(e.extensions.probability).toBe(35);
    expect(e.extensions.useProbability).toBe(true);
  });

  it('không đặt gì thì entry giữ nguyên mặc định — mở thêm cửa không được đổi hành vi cũ', () => {
    const e = materializeEntry(ai(), {}, 1);
    expect(e.extensions.sticky).toBe(DEFAULT_ENTRY_EXT.sticky);
    expect(e.extensions.probability).toBe(DEFAULT_ENTRY_EXT.probability);
    expect(e.extensions.selectiveLogic).toBe(DEFAULT_ENTRY_EXT.selectiveLogic);
    expect(e.extensions.match_whole_words).toBe(DEFAULT_ENTRY_EXT.match_whole_words);
    expect(e.extensions.ignore_budget).toBe(DEFAULT_ENTRY_EXT.ignore_budget);
  });
});

describe('(Tawa 2.0) giá trị AI trả về phải bị KẸP trước khi vào thẻ', () => {
  it('số vượt trần bị kẹp, số âm bị kéo về 0', () => {
    const e = materializeEntry(
      ai({ constant: false, selective: true, sticky: 9999, cooldown: -5, delay: 10_000, probability: 300, group: 'g', group_weight: 99_999 }),
      {},
      1,
    );
    expect(e.extensions.sticky).toBe(100);
    expect(e.extensions.cooldown).toBe(0);
    expect(e.extensions.delay).toBe(100);
    expect(e.extensions.probability).toBe(100);
    expect(e.extensions.group_weight).toBe(1000);
  });

  it('rác không phải số / không phải bool thì bỏ qua, giữ mặc định', () => {
    const e = materializeEntry(
      ai({
        constant: false, selective: true,
        sticky: 'nhiều' as unknown as number,
        ignore_budget: 'có' as unknown as boolean,
        selectiveLogic: 7 as unknown as 0,
      }),
      {},
      1,
    );
    expect(e.extensions.sticky).toBe(DEFAULT_ENTRY_EXT.sticky);
    expect(e.extensions.ignore_budget).toBe(DEFAULT_ENTRY_EXT.ignore_budget);
    expect(e.extensions.selectiveLogic).toBe(DEFAULT_ENTRY_EXT.selectiveLogic);
  });

  it('tên group dài bị cắt, group rỗng thì bỏ luôn cả group_weight', () => {
    const long = materializeEntry(ai({ constant: false, selective: true, group: 'x'.repeat(200), group_weight: 5 }), {}, 1);
    expect(long.extensions.group.length).toBe(40);

    const blank = materializeEntry(ai({ constant: false, selective: true, group: '   ', group_weight: 5 }), {}, 1);
    expect(blank.extensions.group).toBe(DEFAULT_ENTRY_EXT.group);
    expect(blank.extensions.group_weight, 'trọng số không có nhóm để mà cân').toBe(DEFAULT_ENTRY_EXT.group_weight);
  });
});

describe('(Tawa 2.0) tham số vô nghĩa với entry thường trú thì không ghi vào file', () => {
  it('constant=true: sticky/cooldown/delay/vectorized bị bỏ, vì không có lúc "kích hoạt" nào để đếm', () => {
    const ext = advancedExtFromAi(
      { sticky: 5, cooldown: 5, delay: 5, vectorized: true, ignore_budget: true, match_whole_words: true },
      true,
    );
    expect(ext.sticky).toBeUndefined();
    expect(ext.cooldown).toBeUndefined();
    expect(ext.delay).toBeUndefined();
    expect(ext.vectorized).toBeUndefined();
    // Hai cái này thì vẫn có nghĩa với entry thường trú.
    expect(ext.ignore_budget).toBe(true);
    expect(ext.match_whole_words).toBe(true);
  });

  it('cùng bộ tham số đó, entry xanh lá thì giữ đủ', () => {
    const ext = advancedExtFromAi({ sticky: 5, cooldown: 5, delay: 5, vectorized: true }, false);
    expect(ext.sticky).toBe(5);
    expect(ext.vectorized).toBe(true);
  });
});

describe('(Tawa 2.0) cơ chế đệ quy KHÔNG mở cho AI', () => {
  it('AI có gửi kèm cũng vô ích — hai cờ đệ quy luôn bật', () => {
    const e = materializeEntry(
      ai({ prevent_recursion: false, exclude_recursion: false } as unknown as Partial<AIGeneratedEntry>),
      {},
      1,
    );
    expect(e.extensions.prevent_recursion).toBe(true);
    expect(e.extensions.exclude_recursion).toBe(true);
  });
});
