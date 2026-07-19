// Bug "không tuân thủ Custom Translation Prompt" (2026): prompt khai FROM 中文 TO Tiếng Việt nhưng
// entry THUẦN TIẾNG ANH vẫn bị dịch sang tiếng Việt. Gốc rễ: shouldSkipTranslation trước đây CHỈ bỏ
// qua field đã ở ngôn ngữ ĐÍCH, hoàn toàn lơ ngôn ngữ NGUỒN user khai — field tiếng Anh vào tay AI
// là bị luật "không được sót ký tự ngoại ngữ" của master prompt ép dịch nốt.
// Fix: nguồn khai CỤ THỂ (không phải auto) + field chắc chắn thuộc ngôn ngữ THỨ BA → skip tại máy,
// không đưa cho AI. Test khoá cả hành vi mới lẫn các hành vi cũ không được đổi.
import { describe, it, expect } from 'vitest';
import { shouldSkipTranslation, detectLanguage } from '../langDetect';

const EN_ENTRY =
  'Whenever using an NPC character, obtain the complete StatBlocks from the monster menu or similar D&D book sources for reference. You are a professional Dungeon Master specialized in running pre-written modules.';
const ZH_ENTRY = '角色设定：他是一名冷静的侦探，居住在上海郊区的一栋老宅里，擅长观察与推理。每当夜幕降临时他都会外出调查。';
const VI_ENTRY = 'Anh ấy là một thám tử điềm tĩnh, sống trong một căn nhà cổ ở ngoại ô, giỏi quan sát và suy luận.';

describe('shouldSkipTranslation — tôn trọng FROM/TO của Custom Translation Prompt', () => {
  it('nguồn 中文: entry THUẦN TIẾNG ANH → SKIP (đúng ca user báo)', () => {
    expect(detectLanguage(EN_ENTRY)).toBe('English');
    expect(shouldSkipTranslation(EN_ENTRY, 'Tiếng Việt', '中文')).toBe(true);
  });

  it('nguồn 中文: entry tiếng Trung → vẫn DỊCH như cũ', () => {
    expect(shouldSkipTranslation(ZH_ENTRY, 'Tiếng Việt', '中文')).toBe(false);
  });

  it('entry đã là tiếng Việt (ngôn ngữ đích) → SKIP như cũ', () => {
    expect(shouldSkipTranslation(VI_ENTRY, 'Tiếng Việt', '中文')).toBe(true);
  });

  it("nguồn 'auto' → giữ hành vi cũ: tiếng Anh vẫn được dịch", () => {
    expect(shouldSkipTranslation(EN_ENTRY, 'Tiếng Việt', 'auto')).toBe(false);
    expect(shouldSkipTranslation(EN_ENTRY, 'Tiếng Việt')).toBe(false); // mặc định
  });

  it('nguồn English, đích Tiếng Việt → entry tiếng Anh DỊCH bình thường', () => {
    expect(shouldSkipTranslation(EN_ENTRY, 'Tiếng Việt', 'English')).toBe(false);
  });

  it('text TRỘN Hán + Anh (mixed) → vẫn đưa cho AI, không skip nhầm', () => {
    const mixed = `${ZH_ENTRY}\nUse the dice in strict order! And use the data from it as the dice sequence data. Nhân vật này rất đặc biệt và bí ẩn trong câu chuyện.`;
    expect(detectLanguage(mixed)).toBe('mixed');
    expect(shouldSkipTranslation(mixed, 'Tiếng Việt', '中文')).toBe(false);
  });

  it('nguồn 中文: entry tiếng Nhật (có kana) cũng là ngôn ngữ thứ ba → SKIP', () => {
    const ja = 'これは日本語のテキストです。彼女は静かな性格で、毎晩図書館で本を読んでいます。とても優しい人です。';
    expect(shouldSkipTranslation(ja, 'Tiếng Việt', '中文')).toBe(true);
  });
});
