// (bugNeedFix/108) Entry EJS bị đánh "BỎ QUA 100%" dù bên trong còn chữ Hán phải dịch.
import { describe, it, expect } from 'vitest';
import { shouldSkipTranslation, detectLanguage } from '../langDetect';

// Đúng nội dung trong ảnh bug: vỏ toàn từ khoá Latin, ruột là biến MVU + tên worldbook tiếng Trung.
const EJS_ENTRY = `<%_ var qingyu = getvar('stat_data.顾清澜.情欲值', { defaults: 0 }); _%>
<%_ if (qingyu >= 0 && qingyu <= 50) { _%>
<%- await getwi('阶段1_极度抗拒期') %>
<%_ } else if (qingyu >= 51 && qingyu <= 100) { _%>
<%- await getwi('阶段2_生理初醒期') %>
<%_ } _%>`;

describe('CHÍNH CA BUG 108: entry EJS KHÔNG được bỏ qua khi còn chữ Hán', () => {
  it('vỏ Latin nên bị đoán nhầm là English — nhưng vẫn PHẢI dịch (FROM 中文 → Tiếng Việt)', () => {
    // Chứng minh nguyên nhân: detectLanguage thật sự trả về English vì đếm ký tự.
    expect(detectLanguage(EJS_ENTRY)).toBe('English');
    // Và đây là hành vi ĐÚNG sau fix: không bỏ qua.
    expect(shouldSkipTranslation(EJS_ENTRY, 'Tiếng Việt', '中文')).toBe(false);
  });

  it('cả khi nguồn khai là 日本語 mà entry còn chữ Hán → vẫn dịch', () => {
    expect(shouldSkipTranslation(EJS_ENTRY, 'Tiếng Việt', '日本語')).toBe(false);
  });

  it('script JS thường lẫn chuỗi tiếng Trung cũng không bị bỏ qua', () => {
    const js = `const label = '灵石'; function show(){ return label; } // hiển thị số linh thạch`;
    expect(shouldSkipTranslation(js, 'Tiếng Việt', '中文')).toBe(false);
  });
});

describe('Luật bỏ-qua-ngôn-ngữ-thứ-ba vẫn giữ nguyên khi RUỘT ĐÃ SẠCH', () => {
  it('entry tiếng Anh thuần trong card Trung → vẫn bỏ qua như trước (không phá fix cũ #140)', () => {
    const en = 'This is a purely English lorebook entry describing the world setting in detail.';
    expect(shouldSkipTranslation(en, 'Tiếng Việt', '中文')).toBe(true);
  });

  it('code EJS KHÔNG còn chữ Hán → không bị luật ngôn-ngữ-thứ-ba đụng tới (đoán ra "unknown" ⇒ cứ dịch, an toàn)', () => {
    const clean = `<%_ var hp = getvar('stat_data.player.hp', { defaults: 100 }); _%>
<%_ if (hp > 50) { _%>
<%- await getwi('healthy_state') %>
<%_ } _%>`;
    // cleanText bóc hết khối <%…%> nên còn quá ít chữ để đoán ⇒ 'unknown' ⇒ luôn dịch.
    // Đây là hành vi AN TOÀN có sẵn: thà tốn một call còn hơn bỏ sót nội dung cần dịch.
    expect(detectLanguage(clean)).toBe('unknown');
    expect(shouldSkipTranslation(clean, 'Tiếng Việt', '中文')).toBe(false);
  });

  it('text đã là tiếng đích → vẫn bỏ qua', () => {
    expect(shouldSkipTranslation('Đây là nội dung đã dịch sang tiếng Việt đầy đủ rồi.', 'Tiếng Việt', '中文')).toBe(true);
  });

  it('RANH GIỚI với #140: VĂN XUÔI tiếng Nhật (có kanji) trong card Trung → vẫn bỏ qua', () => {
    // Chốt "còn chữ nguồn" chỉ áp cho CODE. Văn xuôi ngôn ngữ thứ ba vẫn tôn trọng hợp đồng
    // FROM/TO của user, dù nó có kanji — nếu không sẽ phá fix #140.
    const ja = 'これは日本語のテキストです。彼女は静かな性格で、毎晩図書館で本を読んでいます。とても優しい人です。';
    expect(shouldSkipTranslation(ja, 'Tiếng Việt', '中文')).toBe(true);
  });

  it('nguồn auto → giữ hành vi cũ (chỉ bỏ qua khi đã đúng tiếng đích)', () => {
    const en = 'A purely English entry that should still be translated when source is auto.';
    expect(shouldSkipTranslation(en, 'Tiếng Việt', 'auto')).toBe(false);
  });

  it('dịch SANG tiếng Trung thì chữ Hán không còn là "thứ cần dịch"', () => {
    const en = 'A purely English entry inside a Japanese card.';
    expect(shouldSkipTranslation(en, '中文', '日本語')).toBe(true);
  });
});
