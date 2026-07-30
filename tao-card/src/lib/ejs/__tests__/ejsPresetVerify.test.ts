// (bug 159-9) "20 tính năng liệt kê nhưng chỉ 7 thật sự được triển khai" — mà giao diện vẫn hiện
// "đã bật" cho cả 20. Hỏng âm thầm: không lỗi nào, chỉ là thiếu, và user phải tự dò bằng mắt.
import { describe, it, expect } from 'vitest';
import { verifyPresetsApplied, PRESET_SIGNALS } from '../ejsPresetVerify';
import { QUICK_PRESETS } from '../ejsQuickPresets';

const T = Object.fromEntries(QUICK_PRESETS.map(p => [p.id, p.title]));

describe('(bug 159-9) xác minh tính năng đã chọn có dấu vết thật', () => {
  it('không có gì trong thẻ → báo THIẾU đích danh từng tính năng', () => {
    const r = verifyPresetsApplied(['save-tokens', 'keyword-npc'], T, { entryContents: ['chỉ là chữ thường'] });
    expect(r.appliedCount).toBe(0);
    expect(r.missing.length).toBe(2);
    expect(r.summary, 'phải nêu tên để chạy lại đúng cái đó').toContain(T['keyword-npc']);
  });

  it('có dấu vết → tính là đã áp', () => {
    const r = verifyPresetsApplied(['keyword-npc'], T, {
      entryContents: ["<% activewi('NPC Lan', true) %>"],
    });
    expect(r.appliedCount).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it('đếm được ĐÚNG tỉ lệ khi chỉ một phần được áp — đúng ca 7/20 user gặp', () => {
    const ids = ['save-tokens', 'conditional-lore', 'keyword-npc', 'ui-panel'];
    const r = verifyPresetsApplied(ids, T, {
      entryContents: ["<% if (getvar('stat_data.Máu') > 0) { %>x<% } %>", "<% activewi('A', true) %>"],
    });
    expect(r.appliedCount).toBeGreaterThan(0);
    expect(r.appliedCount).toBeLessThan(ids.length);
    expect(r.summary).toContain(`${r.appliedCount}/${ids.length}`);
  });

  it('"full-suite" là nút gộp — không tự sinh mã nên không đem ra soi', () => {
    const r = verifyPresetsApplied(['full-suite'], T, { entryContents: [''] });
    expect(r.rows).toEqual([]);
  });

  it('soi cả replaceString của regex script, không chỉ entry', () => {
    const r = verifyPresetsApplied(['ui-hud'], T, {
      entryContents: [''],
      regexContents: ["<div><%= getvar('stat_data.Máu') %></div>"],
    });
    expect(r.appliedCount).toBe(1);
  });

  it('preset chưa khai dấu hiệu → KHÔNG kết luận là thiếu (thà không biết còn hơn báo oan)', () => {
    const r = verifyPresetsApplied(['khong-ton-tai'], { 'khong-ton-tai': 'Lạ' }, { entryContents: [''] });
    expect(r.missing).toEqual([]);
  });
});

describe('(bug 159-9) bảng dấu hiệu phủ hết preset thật', () => {
  it('mọi preset (trừ nút gộp) đều có dấu hiệu để soi', () => {
    const thieu = QUICK_PRESETS
      .filter(p => p.id !== 'full-suite')
      .filter(p => !PRESET_SIGNALS[p.id]?.length)
      .map(p => p.id);
    expect(thieu, `preset chưa khai dấu hiệu: ${thieu.join(', ')}`).toEqual([]);
  });

  // User đếm "20 tính năng riêng lẻ + 1 nút Áp dụng TẤT CẢ". Đếm lại trong code: 19 riêng lẻ +
  // 1 nút gộp = 20 thẻ. Lệch một cái — ghi con số THẬT vào test để lần sau ai thêm/bớt preset mà
  // quên khai dấu hiệu thì test ở trên bắt được ngay.
  it('19 tính năng riêng lẻ + 1 nút gộp', () => {
    expect(QUICK_PRESETS.filter(p => p.id !== 'full-suite').length).toBe(19);
    expect(QUICK_PRESETS.some(p => p.id === 'full-suite')).toBe(true);
  });
});
