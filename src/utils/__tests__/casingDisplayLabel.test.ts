import { describe, it, expect } from 'vitest';
import { enforceVariableCasing } from '../mvuSync';

/**
 * (User 2026) BUG: Schema khai "Cảnh Giới" nhưng bảng trạng thái trong regex bị dịch thành
 * "Cảnh giới" → tên biến lệch giữa 2 nơi, regex không khớp được giá trị → vỡ card.
 * User nói đã khoá từ điển rồi vẫn bị.
 *
 * Nguyên nhân: enforceVariableCasing chỉ ép casing ở các ngữ cảnh CODE (macro, bracket,
 * getvar(), YAML key, lodash path…). Tên biến xuất hiện dưới dạng CHỮ HIỂN THỊ trong HTML
 * của bảng trạng thái không pass nào chạm tới.
 */
describe('enforceVariableCasing — tên biến là chữ hiển thị trong HTML bảng trạng thái', () => {
  const dict = { '境界': 'Cảnh Giới', '灵力': 'Linh Lực' };

  it('nhãn trong <td>/<span> sai casing → phải ép về đúng dạng dict', () => {
    const html = '<tr><td class="label">Cảnh giới</td><td>$1</td></tr>';
    const r = enforceVariableCasing(html, dict);
    expect(r.text).toContain('Cảnh Giới');
    expect(r.text).not.toContain('Cảnh giới');
  });

  it('nhiều nhãn cùng lúc', () => {
    const html = '<div><span>Cảnh giới</span><span>Linh lực</span></div>';
    const r = enforceVariableCasing(html, dict);
    expect(r.text).toContain('Cảnh Giới');
    expect(r.text).toContain('Linh Lực');
  });

  it('đã đúng casing → không đổi, không báo fix thừa', () => {
    const html = '<td>Cảnh Giới</td>';
    const r = enforceVariableCasing(html, dict);
    expect(r.text).toBe(html);
    expect(r.fixes.length).toBe(0);
  });

  it('KHÔNG được đụng vào từ chỉ TRÙNG MỘT PHẦN (tránh phá chữ khác)', () => {
    // "Cảnh giới hạn" là cụm khác, không phải biến "Cảnh Giới" → giữ nguyên.
    const html = '<p>Cảnh giới hạn của ngươi</p>';
    const r = enforceVariableCasing(html, dict);
    expect(r.text).toContain('Cảnh giới hạn');
  });
});
