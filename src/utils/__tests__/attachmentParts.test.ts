import { describe, it, expect } from 'vitest';
import { splitAttachmentContent, attachmentLabel, ATTACH_PART_SIZE } from '../attachmentParts';

/**
 * (User 2026 — bug 23) Trước đây file đính kèm bị slice(0, 100000) NGAY LÚC UPLOAD → dữ liệu sau
 * 100k mất vĩnh viễn, AI "đọc thiếu". Các test này khoá tính chất SỐNG CÒN của bộ chẻ phần:
 * KHÔNG MẤT 1 KÝ TỰ NÀO (join lại == gốc) + cắt tại ranh giới dòng.
 */
describe('splitAttachmentContent — chẻ file lớn thành phần, không mất ký tự', () => {
  it('file nhỏ hơn ngưỡng → 1 phần duy nhất, không có nhãn part', () => {
    const parts = splitAttachmentContent('nội dung ngắn', 100);
    expect(parts).toEqual([{ content: 'nội dung ngắn' }]);
  });

  it('BUG THẬT (file 250k > cap 100k cũ): join các phần == file gốc 100%, không mất gì', () => {
    // Mô phỏng lorebook JSON lớn: 25k dòng ~10 ký tự
    const lines: string[] = [];
    for (let i = 0; i < 25_000; i++) lines.push(`"mục_${i}": "giá trị 值 ${i}",`);
    const content = lines.join('\n');
    expect(content.length).toBeGreaterThan(ATTACH_PART_SIZE * 2);

    const parts = splitAttachmentContent(content);
    expect(parts.length).toBeGreaterThan(2);
    // KHÔNG MẤT 1 KÝ TỰ NÀO — đây là điều bug cũ vi phạm
    expect(parts.map(p => p.content).join('')).toBe(content);
    // Đánh số 1-based, total nhất quán
    parts.forEach((p, i) => {
      expect(p.part).toEqual({ index: i + 1, total: parts.length });
      expect(p.content.length).toBeLessThanOrEqual(ATTACH_PART_SIZE);
    });
  });

  it('cắt tại ranh giới DÒNG — không phần nào (trừ phần cuối) kết thúc giữa dòng', () => {
    const content = Array.from({ length: 5000 }, (_, i) => `dòng số ${i} có nội dung dài hơn một chút để đủ cỡ`).join('\n');
    const parts = splitAttachmentContent(content, 10_000);
    for (let i = 0; i < parts.length - 1; i++) {
      expect(parts[i].content.endsWith('\n')).toBe(true);
    }
    expect(parts.map(p => p.content).join('')).toBe(content);
  });

  it('dòng đơn siêu dài (JSON minify 1 dòng) → buộc cắt cứng nhưng vẫn không mất ký tự', () => {
    const content = 'x'.repeat(250_000); // không có \n nào
    const parts = splitAttachmentContent(content);
    expect(parts.length).toBe(3);
    expect(parts.map(p => p.content).join('')).toBe(content);
  });

  it('attachmentLabel: có part → "(PHẦN i/N)", không part → tên trần', () => {
    expect(attachmentLabel('lore.json')).toBe('lore.json');
    expect(attachmentLabel('lore.json', { index: 2, total: 5 })).toBe('lore.json (PHẦN 2/5)');
  });
});
