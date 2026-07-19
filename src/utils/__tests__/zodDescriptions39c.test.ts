// Bug 39c (19/07) — TREO VÔ HẠN khi bấm "Bắt đầu dịch" sau luồng gộp So Sánh.
// Gốc rễ (xác nhận bằng card thật bugNeedFix/40, đo Node): regex cũ trong extractZodDescriptions
// có `(?:\.\w+\([^)]*\))*` — quantifier LỒNG không chặn ⇒ catastrophic backtracking trên script
// MVU 525K đầy chuỗi `z.number().min().max()` KHÔNG có .describe (>10 phút chưa xong 1 script;
// extractPotentialMvuKeys gọi nó cho TỪNG script ngay sau Pha 0 ⇒ "Trang không phản hồi").
// Sau khi viết lại tuyến tính: extractPotentialMvuKeys trên card đó chỉ còn ~365ms.
// Test này khoá CẢ tính đúng LẪN hiệu năng để lỗi không quay lại.
import { describe, it, expect } from 'vitest';
import { extractZodDescriptions } from '../mvuSync';

describe('extractZodDescriptions — tính đúng (bản viết lại tuyến tính)', () => {
  it('field không nháy + .describe trực tiếp', () => {
    const s = `好感度: z.number().describe("How much the character likes the user")`;
    expect(extractZodDescriptions(s)).toEqual({ 好感度: 'How much the character likes the user' });
  });

  it('chuỗi method dài min/max/int trước .describe', () => {
    const s = `hp: z.number().min(0).max(100).int().describe('Sinh lực hiện tại')`;
    expect(extractZodDescriptions(s)['hp']).toBe('Sinh lực hiện tại');
  });

  it('field CÓ nháy + mô tả backtick + đối số enum có mảng', () => {
    const s = '"Cảnh giới": z.enum(["Luyện Khí","Trúc Cơ"]).describe(`Cảnh giới tu luyện`)';
    expect(extractZodDescriptions(s)['Cảnh giới']).toBe('Cảnh giới tu luyện');
  });

  it('nhiều field trong một z.object', () => {
    const s = `const schema = z.object({
      武力: z.number().min(0).describe("Sức mạnh võ học"),
      魅力: z.number().describe("Sức hút"),
      note: z.string(),
    });`;
    const d = extractZodDescriptions(s);
    expect(d['武力']).toBe('Sức mạnh võ học');
    expect(d['魅力']).toBe('Sức hút');
    expect('note' in d).toBe(false);
  });

  it('.describe không thuộc chuỗi z.* (vd obj.describe(...)) → bỏ qua, không nhặt bừa', () => {
    const s = `logger.describe('not a zod field')`;
    expect(extractZodDescriptions(s)).toEqual({});
  });
});

describe('extractZodDescriptions — GUARD hiệu năng (chống backtracking tái phát)', () => {
  it('50K chuỗi z-chain KHÔNG có .describe phải xong dưới 300ms (regex cũ: treo vô hạn)', () => {
    // Đúng hình dạng nội dung giết regex cũ: hàng nghìn chain dài không có .describe.
    const chain = '生命值: z.number().min(0).max(100).step(1).int().positive().finite().lte(100).gte(0),\n';
    const text = 'const schema = z.object({\n' + chain.repeat(500) + '});\n' + 'x'.repeat(20000);
    const t0 = performance.now();
    extractZodDescriptions(text);
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it('trộn describe thật giữa biển chain không describe → vẫn nhặt đúng + nhanh', () => {
    const noise = 'a: z.number().min(0).max(9),\n'.repeat(2000);
    const text = noise + `目标: z.string().describe("Mục tiêu hiện tại"),\n` + noise;
    const t0 = performance.now();
    const d = extractZodDescriptions(text);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(d['目标']).toBe('Mục tiêu hiện tại');
  });
});
