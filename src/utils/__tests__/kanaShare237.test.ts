/**
 * (bug 237) MỘT KÝ TỰ KANA KHÔNG BIẾN CẢ ĐOẠN VĂN TRUNG THÀNH TIẾNG NHẬT.
 *
 * Bằng chứng thẻ thật (bugNeedFix/237, lorebook[71].content — hồ sơ 材木座义辉): 398 ký tự, 272 chữ
 * HÁN, 2 kana đến từ chú furigana `我（われ）`. Luật cũ `kanaCount > 0` gọi nó là 日本語, rồi luật
 * "ngôn ngữ thứ ba" của yêu cầu #140 BỎ QUA cả entry — 272 chữ Hán chưa từng được gửi cho AI.
 *
 * Nhóm test này khoá cả hai chiều: đoạn Trung lỡ dính kana thì PHẢI dịch, còn tiếng Nhật thật
 * (kể cả nhan đề ngắn chỉ có một trợ từ の) thì vẫn PHẢI được tôn trọng — không đánh đổi #140.
 */
import { describe, it, expect } from 'vitest';
import { detectLanguage, shouldSkipTranslation } from '../langDetect';

const VI = 'Tiếng Việt';

describe('(bug 237) kana điểm xuyết trong văn bản Trung', () => {
  const HO_SO = '基本信息:\n  姓名: 材木座义辉\n  年龄: 17岁→19岁\n  性别: 男\n  身份: 总武高中2年F班·中二病·轻小说创作爱好者\n'
    + '性格核心:\n  - 沉浸在自己的世界观里\n  - 说话时手势夸张·自称"我（われ）"等古风的自称\n  - 现实与妄想的边界模糊';

  it('hồ sơ nhân vật thuần Trung có 2 kana KHÔNG được gọi là tiếng Nhật', () => {
    const kana = (HO_SO.match(/[぀-ヿ]/g) || []).length;
    const han = (HO_SO.match(/[一-鿿]/g) || []).length;
    expect(kana).toBeLessThanOrEqual(4);
    expect(han).toBeGreaterThan(70);      // Hán áp đảo kana hơn 20 lần
    expect(detectLanguage(HO_SO)).not.toBe('日本語');
  });

  it('…và vì thế KHÔNG được bỏ qua khi dịch 中文 → Tiếng Việt', () => {
    expect(shouldSkipTranslation(HO_SO, VI, '中文')).toBe(false);
  });

  it('tiếng Nhật THẬT vẫn được nhận đúng và vẫn được tôn trọng (hợp đồng #140)', () => {
    const jp = '私は毎朝六時に起きて、学校まで自転車で通っています。今日はとても良い天気ですね。';
    expect(detectLanguage(jp)).toBe('日本語');
    expect(shouldSkipTranslation(jp, VI, '中文')).toBe(true);
  });

  it('nhan đề Nhật ngắn (một trợ từ の) vẫn là tiếng Nhật — ngưỡng không được siết quá tay', () => {
    for (const t of ['鋼の錬金術師です', '進撃の巨人という作品']) {
      expect(detectLanguage(t), t).toBe('日本語');
    }
  });

  it('văn bản Trung thuần (không kana) vẫn là 中文 và vẫn được dịch', () => {
    const zh = '这是一段完全没有假名的中文说明文字，用来测试语言判定是否稳定。';
    expect(detectLanguage(zh)).toBe('中文');
    expect(shouldSkipTranslation(zh, VI, '中文')).toBe(false);
  });

  it('cùng cái bẫy với tiếng Hàn: vài hangul lẫn trong đoạn Trung không làm nó thành 한국어', () => {
    const mixed = '角色设定：主角来自异世界的修真门派，掌门称号为「천마」，其余全部为中文描述内容，'
      + '包括功法、丹药、灵石与宗门规矩等等细节说明文字。';
    expect(detectLanguage(mixed)).not.toBe('한국어');
    expect(shouldSkipTranslation(mixed, VI, '中文')).toBe(false);
  });

  it('tiếng Hàn thật vẫn được nhận đúng', () => {
    expect(detectLanguage('안녕하세요 오늘 날씨가 정말 좋네요 우리 같이 산책 갈까요')).toBe('한국어');
  });
});
