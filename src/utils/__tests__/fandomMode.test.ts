// (User 19/07) 🎌 CHẾ ĐỘ ĐỒNG NHÂN — card fanfic của IP Nhật/Hàn.
// Bug: "Yukino" bị dịch thành "Tuyết Nãi" dù đã bật kiểu tên Romaji; và tệ hơn, có field đã dịch
// ĐÚNG rồi vẫn "sau một hồi tự sửa thành sai".
// Hai gốc rễ tìm được:
//   (a) card đồng nhân hầu hết là card TIẾNG TRUNG → prompt đi nhánh "Chinese → Sino-Vietnamese";
//       ngay cả Romaji cũng chỉ nói "Chinese → Pinyin" nên vẫn không ra tên Nhật.
//   (b) sweep CUỐI LƯỢT (recanonicalizeMvuInFields) áp từ điển BIẾN MVU lên cả VĂN XUÔI lorebook
//       ⇒ ghi đè ngược lên tên đã dịch đúng — đúng hiện tượng "tự sửa thành sai".
// Test khoá cả hành vi mới LẪN việc tắt cờ thì mọi thứ giữ nguyên như cũ.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildProperNounRules, buildFandomNameRules } from '../masterPrompt';
import { buildNameGlossaryPrompt } from '../nameGlossary';
import { recanonicalizeMvuInFields } from '../mvuSync';
import { setFandom, isFandom, fandomNameOverride } from '../fandomMode';
import type { TranslationField } from '../../types/card';

beforeEach(() => setFandom(false)); // module lá là state toàn cục → reset để test không dây nhau

describe('khối luật tên đồng nhân', () => {
  it('cấm rõ ràng Hán-Việt hoá VÀ Pinyin, có ví dụ đúng ca user gặp', () => {
    const r = buildFandomNameRules('Oregairu');
    expect(r).toContain('Yukino');
    expect(r).toContain('Tuyết Nãi');   // nêu đích danh bản dịch SAI để AI tránh
    expect(r).toMatch(/FORBIDDEN: Pinyin/i);   // cấm Pinyin cho tên tác phẩm Nhật
    expect(r).toContain('Oregairu');     // tên tác phẩm được nhúng
  });

  it('không chắc thì GIỮ NGUYÊN tên gốc — thà chưa dịch còn hơn dịch sai', () => {
    expect(buildFandomNameRules()).toMatch(/keep the name in its ORIGINAL script unchanged/i);
  });

  it('buildProperNounRules: bật đồng nhân ĐÈ mọi kiểu tên (kể cả hanviet)', () => {
    for (const style of ['hanviet', 'romaji', 'keep'] as const) {
      const r = buildProperNounRules(style, true, 'Oregairu');
      expect(r).toContain('FAN-FICTION');
      // Không được còn câu ép đọc Hán-Việt cho tên Trung
      expect(r).not.toMatch(/Chinese proper nouns[^\n]*→ Sino-Vietnamese/);
    }
  });

  it('TẮT đồng nhân → giữ nguyên hành vi cũ 100%', () => {
    expect(buildProperNounRules('hanviet', false)).toContain('Sino-Vietnamese reading');
    expect(buildProperNounRules('hanviet')).toBe(buildProperNounRules('hanviet', false));
  });
});

describe('fandomNameOverride — khối nối vào các prompt hardcode (Chiến lược B/C, surgical, verify)', () => {
  it('tắt → chuỗi RỖNG (không đụng gì tới prompt cũ)', () => {
    setFandom(false);
    expect(fandomNameOverride()).toBe('');
    expect(isFandom()).toBe(false);
  });

  it('bật → có khối override kèm tên tác phẩm', () => {
    setFandom(true, 'Blue Archive');
    expect(isFandom()).toBe(true);
    const o = fandomNameOverride();
    expect(o).toContain('FAN-FICTION');
    expect(o).toContain('Blue Archive');
    expect(o).toContain('Yukino');
  });
});

describe('Pha 0 (bảng tên) — persona phải đổi khi đồng nhân', () => {
  const cands = [{ term: '雪乃', count: 12, fromKeys: true }];

  it('bản thường: persona "thẻ tiếng Trung" + đòi dịch thuật ngữ tu luyện', () => {
    const { system } = buildNameGlossaryPrompt(cands, 'Tiếng Việt', 'romaji');
    expect(system).toContain('tiếng Trung');
    expect(system).toContain('tu luyện');
  });

  it('đồng nhân: persona fandom, KHÔNG còn khung tu tiên, có luật tên canon', () => {
    const { system } = buildNameGlossaryPrompt(cands, 'Tiếng Việt', 'romaji', true, 'Oregairu');
    expect(system).toContain('ĐỒNG NHÂN');
    expect(system).toContain('Oregairu');
    expect(system).not.toContain('cảnh giới tu luyện');
    expect(system).toContain('Yukino');
    // Dặn bỏ dòng khi không chắc (vì bảng này bị ép cho toàn thẻ)
    expect(system).toMatch(/BỎ HẲN dòng đó/);
  });
});

describe('sweep cuối lượt KHÔNG được ghi đè tên trong văn xuôi (gốc rễ "tự sửa thành sai")', () => {
  /** Field lorebook đã dịch đúng tên Nhật; từ điển biến MVU lại chứa bản Hán-Việt. */
  const fields = [
    {
      path: 'character_book.entries.0.content', group: 'lorebook', status: 'done',
      original: '雪乃是学生会成员', translated: 'Yukino là thành viên hội học sinh',
    } as unknown as TranslationField,
    {
      path: 'character_book.entries.1.content', group: 'lorebook', status: 'done',
      entryType: 'initvar', original: '雪乃: 好感度', translated: 'Tuyết_Nãi: Độ_Hảo_Cảm',
    } as unknown as TranslationField,
  ];
  const dict = { '雪乃': 'Tuyết Nãi', '好感度': 'Độ Hảo Cảm' };

  it('skipNarrative=true (đồng nhân): field văn xuôi GIỮ NGUYÊN "Yukino"', () => {
    const { fields: out } = recanonicalizeMvuInFields(fields, dict, undefined, true);
    expect(out[0].translated).toBe('Yukino là thành viên hội học sinh');
  });

  it('skipNarrative=true vẫn dọn field CODE như thường (không làm hỏng Chiến lược B)', () => {
    const { fields: out } = recanonicalizeMvuInFields(fields, dict, undefined, true);
    expect(out[1].translated).not.toContain('_'); // initvar vẫn được chuẩn hoá _ → space
  });

  it('mặc định (không truyền cờ) giữ nguyên hành vi cũ — vẫn quét narrative', () => {
    const { fields: a } = recanonicalizeMvuInFields(fields, dict);
    const { fields: b } = recanonicalizeMvuInFields(fields, dict, undefined, false);
    expect(a.map(f => f.translated)).toEqual(b.map(f => f.translated));
  });
});
