// (Tawa 2.0) Ba mảng prompt port từ Tawa Worldbuilder 2.0, và MỘT thứ cố ý không port.
//
// Thứ không port là quan trọng nhất ở đây: bản gốc có `ABSOLUTE_VERBOSITY_PROTOCOL` ép
// "content phải ít nhất N token, thấy ngắn thì viết lại cho dài". Đó đúng là kiểu sàn độ dài vừa
// bị gỡ khỏi dự án này (xem tokenBudget.ts) — nó dạy mô hình viết chạm mốc rồi dừng và đẻ ra vòng
// bắt viết lại không dứt. Test cuối cùng khoá cửa đó lại để không ai vô tình mang về.
import { describe, it, expect } from 'vitest';
import { CHARACTER_QUALITY_PROTOCOL, CHARACTER_QUALITY_SHORT } from '../characterQuality';
import { buildContentFormatDirective } from '../worldSettingTemplate';
import { AUTO_CONFIG_ADDON } from '../../lib/ai/batchGenerator';

describe('(Tawa 2.0) luật chất lượng nhân vật', () => {
  it('bịt đủ ba lỗ thiết kế: nhân vật hoàn hảo, giọng NPC trả bài, thiếu chi tiết nhỏ', () => {
    expect(CHARACTER_QUALITY_PROTOCOL).toMatch(/CÁI GIÁ/);
    expect(CHARACTER_QUALITY_PROTOCOL).toMatch(/khiếm khuyết/i);
    expect(CHARACTER_QUALITY_PROTOCOL).toMatch(/mâu thuẫn nội tâm/i);
    expect(CHARACTER_QUALITY_PROTOCOL).toMatch(/NPC TRẢ BÀI/i);
  });

  it('nói rõ entry không-phải-người thì bỏ qua — không bắt entry cơ chế phải có "khiếm khuyết"', () => {
    expect(CHARACTER_QUALITY_PROTOCOL).toMatch(/bỏ qua/i);
    expect(CHARACTER_QUALITY_SHORT).toMatch(/bỏ qua/i);
  });

  it('buộc tính từ tính cách phải kèm hành vi chứng minh', () => {
    expect(CHARACTER_QUALITY_PROTOCOL).toMatch(/HÀNH VI cụ thể/);
  });
});

describe('(Tawa 2.0) cẩm nang tham số ST trong prompt auto-config', () => {
  it('dạy đủ bộ tham số vừa mở cho AI', () => {
    for (const p of ['match_whole_words', 'selectiveLogic', 'sticky', 'cooldown', 'delay',
                     'probability', 'group_weight', 'ignore_budget', 'vectorized']) {
      expect(AUTO_CONFIG_ADDON, `thiếu hướng dẫn cho ${p}`).toContain(p);
    }
  });

  it('nêu ĐÚNG bảng mã selectiveLogic của SillyTavern', () => {
    expect(AUTO_CONFIG_ADDON).toMatch(/0=AND ANY/);
    expect(AUTO_CONFIG_ADDON).toMatch(/3=AND ALL/);
  });

  it('chặn hai ca hỏng hay gặp nhất: lạm dụng thẻ VIP và sticky trên hồ sơ tĩnh', () => {
    expect(AUTO_CONFIG_ADDON).toMatch(/TỐI ĐA 1-2 entry/);
    expect(AUTO_CONFIG_ADDON).toMatch(/KHÔNG dùng cho hồ sơ tĩnh/);
  });

  it('nói rõ đệ quy KHÔNG phải việc của AI — tool tự ép', () => {
    expect(AUTO_CONFIG_ADDON).toMatch(/KHÔNG phải việc của bạn: prevent_recursion/);
  });
});

describe('(Tawa 2.0) định dạng nội dung XML+YAML', () => {
  it('mặc định KHÔNG chèn gì — đây là lựa chọn của user, không phải mặc định mới', () => {
    expect(buildContentFormatDirective('default')).toBe('');
    expect(buildContentFormatDirective(undefined)).toBe('');
  });

  it('bật thì có thẻ XML đặt theo nội dung + YAML lồng nhau', () => {
    const d = buildContentFormatDirective('xml_yaml');
    expect(d).toMatch(/<kingdom/);
    expect(d).toMatch(/<system/);
    expect(d).toMatch(/YAML/);
    expect(d, 'phải cấm bọc markdown, không thì content dính ```').toMatch(/code fence/i);
  });
});

describe('(Tawa 2.0) KHÔNG mang theo sàn độ dài của bản gốc', () => {
  it('không prompt nào port về được doạ sàn token hay bắt viết lại cho dài', () => {
    for (const [name, p] of Object.entries({
      CHARACTER_QUALITY_PROTOCOL,
      CHARACTER_QUALITY_SHORT,
      XML_YAML: buildContentFormatDirective('xml_yaml'),
    })) {
      expect(p, `${name} mọc lại sàn độ dài`).not.toMatch(/ít nhất \d+ (token|từ)/i);
      expect(p, `${name} mọc lại lệnh viết cho dài`).not.toMatch(/viết lại cho dài|REWRITE IT LONGER/i);
    }
  });
});
