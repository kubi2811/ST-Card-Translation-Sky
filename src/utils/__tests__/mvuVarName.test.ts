import { describe, it, expect } from 'vitest';
import { sanitizeMvuVarName } from '../mvuSync';

/* (User 2026 — bug #8 ĐẢO CHIỀU bug #4) LỊCH SỬ: bug #4 (card AI1.1) từng ép tên biến nối '_'
 * (Tự_Sự) vì object key JS không quote chứa space là SyntaxError. Nhưng chuẩn '_' này ĐÁNH NHAU
 * với canonicalizeMvuVarName + promptBuilder rule 21 (đều chuẩn SPACE) → từ điển/initvar TRỘN
 * 2 kiểu → card user vỡ (bugNeedFix/8: 272 chỗ `Lưu_Tam_Bảo`, initvar 8 key space + 8 key `_`).
 * CHUẨN DUY NHẤT mới: tên biến dùng DẤU CÁCH ("Tự Sự"); chỗ key JS không quote do
 * enforceVariableCasing/unifyVietnameseUnderscoresInText tự BỌC NHÁY ('Tự Sự': hợp lệ JS + YAML);
 * guard cú pháp JS v1.99.7 là lưới đỡ chống SyntaxError — bug #4 KHÔNG tái phát theo đường mới. */
describe('sanitizeMvuVarName — chuẩn SPACE duy nhất cho tên biến MVU (đảo chiều bug #4)', () => {
  it('bản dịch có dấu cách → GIỮ dấu cách (không còn ép _)', () => {
    expect(sanitizeMvuVarName('叙事', 'Tự Sự')).toBe('Tự Sự');
    expect(sanitizeMvuVarName('当前时间', 'Thời Gian Hiện Tại')).toBe('Thời Gian Hiện Tại');
    expect(sanitizeMvuVarName('AI接管', 'AI Tiếp Quản')).toBe('AI Tiếp Quản');
    expect(sanitizeMvuVarName('好感度', 'Độ Hảo Cảm')).toBe('Độ Hảo Cảm');
  });

  it('bản dịch lỡ nối "_" (AI cũ) → gom về dấu cách', () => {
    expect(sanitizeMvuVarName('武力', 'Võ_Lực')).toBe('Võ Lực');
    expect(sanitizeMvuVarName('体力', 'ThểLực')).toBe('ThểLực');
  });

  it('prefix chức năng _/$ giữ nguyên vị trí đầu', () => {
    expect(sanitizeMvuVarName('_类型', '_Loại Hình')).toBe('_Loại Hình');
    expect(sanitizeMvuVarName('$开局类型', '$Loại_Mở_Đầu')).toBe('$Loại Mở Đầu');
  });

  it('compound enum value có SỐ (阶段 1_静谧) → giữ nguyên separator gốc', () => {
    expect(sanitizeMvuVarName('阶段 1_静谧', 'Giai đoạn 1_Tĩnh lặng')).toBe('Giai đoạn 1_Tĩnh lặng');
  });

  it('trim khoảng trắng thừa đầu/cuối', () => {
    expect(sanitizeMvuVarName('魅力', '  Sức Hút  ')).toBe('Sức Hút');
  });
});
