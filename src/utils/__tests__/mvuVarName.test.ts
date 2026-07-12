import { describe, it, expect } from 'vitest';
import { sanitizeMvuVarName } from '../mvuSync';

/* Bug #4 (card AI1.1): Dịch nhẹ/Strategy B đổi tên biến MVU thành tiếng Việt CÓ DẤU CÁCH,
 * áp vào script Zod dạng object key KHÔNG QUOTE:  `叙事:` (hợp lệ) → `Tự Sự:` (SyntaxError)
 * → schema chết → framework MVU báo "当前角色卡不支持额外模型解析". Guard: tên gốc không có
 * space thì bản dịch cũng không được có space (nối '_'); gốc CÓ space (enum value trong
 * quotes) thì giữ nguyên. */
describe('sanitizeMvuVarName — tên biến MVU an toàn cho object key JS', () => {
  it('BUG #4: tên gốc là identifier (không space) → bản dịch thay space bằng _', () => {
    // fixture rút từ chính schema card AI1.1
    expect(sanitizeMvuVarName('叙事', 'Tự Sự')).toBe('Tự_Sự');
    expect(sanitizeMvuVarName('当前时间', 'Thời Gian Hiện Tại')).toBe('Thời_Gian_Hiện_Tại');
    expect(sanitizeMvuVarName('AI接管', 'AI Tiếp Quản')).toBe('AI_Tiếp_Quản');
    expect(sanitizeMvuVarName('好感度', 'Độ Hảo Cảm')).toBe('Độ_Hảo_Cảm');
  });

  it('bản dịch không space → giữ nguyên', () => {
    expect(sanitizeMvuVarName('武力', 'Võ_Lực')).toBe('Võ_Lực');
    expect(sanitizeMvuVarName('体力', 'ThểLực')).toBe('ThểLực');
  });

  it('prefix chức năng _/$ giữ nguyên vị trí đầu', () => {
    expect(sanitizeMvuVarName('_类型', '_Loại Hình')).toBe('_Loại_Hình');
    expect(sanitizeMvuVarName('$开局类型', '$Loại Mở Đầu')).toBe('$Loại_Mở_Đầu');
  });

  it('tên GỐC có space (compound enum value — luôn nằm trong quotes) → giữ nguyên bản dịch', () => {
    expect(sanitizeMvuVarName('阶段 1_静谧', 'Giai đoạn 1_Tĩnh lặng')).toBe('Giai đoạn 1_Tĩnh lặng');
  });

  it('trim khoảng trắng thừa đầu/cuối', () => {
    expect(sanitizeMvuVarName('魅力', '  Sức Hút  ')).toBe('Sức_Hút');
  });
});
