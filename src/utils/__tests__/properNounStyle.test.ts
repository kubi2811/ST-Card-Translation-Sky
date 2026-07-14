import { describe, it, expect } from 'vitest';
import { buildProperNounRules } from '../masterPrompt';
import { buildNameGlossaryPrompt, type NameCandidate } from '../nameGlossary';

/**
 * (User 2026) LỖI: tên phương Tây/ngoài Trung bị dịch bậy (Titan→Thái Thản, William→Uy Lợi Nhĩ).
 * Gốc: Pha 0 (buildNameGlossaryPrompt) KHÔNG có luật khôi phục tên phương Tây. Test khoá:
 *  - MỌI kiểu tên (hanviet/romaji/keep) đều có luật khôi phục tên phương Tây về Latin.
 *  - Pha 0 giờ NHÚNG luật đó (trước đây thiếu ⇒ đóng băng sai trong Từ điển).
 *  - Kiểu 'romaji' đổi tên nhân vật sang phiên âm quốc tế (Pinyin/Romaji), khác 'hanviet'.
 */
describe('buildProperNounRules — luật phiên âm theo Kiểu tên', () => {
  it('MỌI kiểu đều LUÔN khôi phục tên phương Tây về Latin (William/Titan)', () => {
    for (const style of ['hanviet', 'romaji', 'keep'] as const) {
      const r = buildProperNounRules(style);
      expect(r).toMatch(/William/);
      expect(r).toMatch(/Titan/);
      expect(r.toLowerCase()).toMatch(/latin|original/);
    }
  });

  it("'hanviet' → tên Trung dùng Sino-Vietnamese; 'romaji' → Pinyin/Romaji quốc tế", () => {
    expect(buildProperNounRules('hanviet')).toMatch(/Sino-Vietnamese/);
    const romaji = buildProperNounRules('romaji');
    expect(romaji.toLowerCase()).toMatch(/pinyin|romaji|international/);
    expect(romaji).toMatch(/Ye Fan|Shiro|Tanaka/);
  });

  it("3 kiểu cho ra chuỗi luật KHÁC nhau", () => {
    const a = buildProperNounRules('hanviet');
    const b = buildProperNounRules('romaji');
    const c = buildProperNounRules('keep');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('buildNameGlossaryPrompt (Pha 0) — nay đã nhúng luật tên riêng (fix gốc bug)', () => {
  const cands: NameCandidate[] = [{ term: '威廉', count: 5, fromKeys: false }];

  it('system prompt CHỨA luật khôi phục tên phương Tây (trước đây thiếu → đóng băng sai)', () => {
    const { system } = buildNameGlossaryPrompt(cands, 'Tiếng Việt', 'hanviet');
    expect(system).toMatch(/William/);
    expect(system.toLowerCase()).toMatch(/latin|original/);
    expect(system).toMatch(/Sino-Vietnamese/); // kiểu hanviet
  });

  it('kiểu romaji → prompt bảng tên đổi sang phiên âm quốc tế', () => {
    const { system } = buildNameGlossaryPrompt(cands, 'Tiếng Việt', 'romaji');
    expect(system.toLowerCase()).toMatch(/pinyin|romaji|international/);
    expect(system).toMatch(/William/); // vẫn khôi phục tên Tây
  });
});
