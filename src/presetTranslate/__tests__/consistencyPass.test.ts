// (User 20/07) Phase C: thay tên tag/biến toàn cục deterministic — mẫu thật đòi 正文 →
// Chính văn nhất quán ở CẢ 148 chỗ (prose + regex + script), key dài thay trước.
import { describe, it, expect } from 'vitest';
import { applyVarRenames, applyTagRenames, applyPresetDict, sanitizeVarName } from '../consistencyPass';
import { countMacros } from '../macroGuard';
import { emptyPresetDict } from '../types';

describe('applyVarRenames — nguyên tử tuyệt đối', () => {
  it('đổi CẢ setvar lẫn getvar cùng lúc, giữ value', () => {
    const t = '{{setvar::美型化::on}} … {{getvar::美型化}} … {{setvar::美型化::off}}';
    const out = applyVarRenames(t, { 美型化: 'beautify' });
    const c = countMacros(out);
    expect(c.setvar.get('beautify')).toBe(2);
    expect(c.getvar.get('beautify')).toBe(1);
    expect(out).toContain('{{setvar::beautify::on}}');
    expect(out).not.toContain('美型化');
  });

  it('không đụng biến khác / văn bản thường', () => {
    const t = '{{setvar::mood::vui}} 美型化 ngoài macro';
    const out = applyVarRenames(t, { 美型化: 'beautify' });
    expect(out).toContain('{{setvar::mood::vui}}');
    expect(out).toContain('美型化 ngoài macro'); // vars pass CHỈ đụng trong {{setvar/getvar}}
  });
});

describe('applyTagRenames — key dài trước, thay cả dạng trần', () => {
  it('状态面板 không bị 面板 ăn mất một nửa', () => {
    const t = '<状态面板>nội dung</状态面板> và 面板 thường, header ### 正文';
    const out = applyTagRenames(t, { 状态面板: 'Bảng trạng thái', 面板: 'Bảng', 正文: 'Chính văn' });
    expect(out).toContain('<Bảng trạng thái>nội dung</Bảng trạng thái>');
    expect(out).toContain('và Bảng thường');
    expect(out).toContain('### Chính văn');
  });
});

describe('applyPresetDict', () => {
  it('vars chạy trước tags (tag trần không cắn vào tên biến đã đổi)', () => {
    const dict = { ...emptyPresetDict(), vars: { 正文: 'main_text' }, tags: { 正文: 'Chính văn' } };
    const out = applyPresetDict('{{setvar::正文::x}} rồi <正文>', dict);
    expect(out).toContain('{{setvar::main_text::x}}');
    expect(out).toContain('<Chính văn>');
  });
});

describe('sanitizeVarName', () => {
  it('đề xuất sạch giữ nguyên; bẩn thì slug; nát quá thì fallback', () => {
    expect(sanitizeVarName('beautify', 'fb')).toBe('beautify');
    expect(sanitizeVarName('emotion & memory check', 'fb')).toBe('emotion_memory_check');
    expect(sanitizeVarName('美型化', 'fb')).toBe('fb');
  });
});
