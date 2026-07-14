import { describe, it, expect } from 'vitest';
import { enforceVariableCasing } from '../mvuSync';

/**
 * (User 2026) Nút "Đồng nhất tên biến MVU" nay chạy thêm enforceVariableCasing lên field đã dịch —
 * dẹp cảnh báo "mvu inconsistent: 'Tiến trình' should be renamed to 'Tiến Trình'" mà Kiểm tra tổng
 * báo trên card Mafia (dict Title Case, text lower case → lookup getvar trong game LỆCH).
 */
describe('enforceVariableCasing — ép hoa/thường theo dict vào text đã dịch (nút Đồng nhất)', () => {
  const dict = { '进程': 'Tiến Trình', '主角': 'Nhân Vật Chính' };

  it('getvar path dùng casing lệch dict → ép về đúng dạng dict', () => {
    const text = "<%_ var stat = getvar('stat_data'); if (_.get(stat, ['Tiến trình', 'Giai đoạn'])) { } _%>";
    const r = enforceVariableCasing(text, dict);
    expect(r.text).toContain('Tiến Trình');
    expect(r.text).not.toContain("['Tiến trình'");
    expect(r.fixes.length).toBeGreaterThanOrEqual(1);
  });

  it('đúng casing sẵn → không đổi gì', () => {
    const text = "_.get(stat, ['Tiến Trình', 'Giai đoạn'])";
    const r = enforceVariableCasing(text, dict);
    expect(r.text).toBe(text);
    expect(r.fixes.length).toBe(0);
  });
});
