// (User 22/07 — bug 76) Bấm nút xanh "Đồng nhất tên biến MVU (non-AI)" thì hiện cảnh báo:
//   "Detected 1 translation conflict(s): 白芍 & 赤芍 both translate to Bạch Thược"
//
// Nút TỰ TAY tạo ra xung đột đó rồi mới báo. Thủ phạm: enforceExactConsistency gom cụm theo
// GIÁ TRỊ ĐÃ DỊCH bằng khoảng cách Levenshtein ≤ 2 rồi ép cả cụm về một tên. Với Hán-Việt,
// hai thực thể khác hẳn nhau rất hay chỉ lệch 1-2 ký tự:
//
//   白芍 = Bạch Thược (bạch = trắng) ┐ Levenshtein = 2 → bản cũ GỘP làm một
//   赤芍 = Xích Thược (xích = đỏ)    ┘
//
// Nguyên tắc đúng: chỉ gộp khi hai mục là CÙNG MỘT BIẾN ở phía NGUỒN. Nguồn khác nhau thì
// bản dịch phải giữ riêng; trùng nhau là XUNG ĐỘT để báo, không phải để im lặng gộp.
import { describe, it, expect } from 'vitest';
import { enforceExactConsistency, validateDictionaryConflicts } from '../mvuSync';

describe('enforceExactConsistency — KHÔNG được gộp hai biến khác nhau', () => {
  it('CA THẬT: 白芍 (Bạch Thược) và 赤芍 (Xích Thược) phải giữ riêng', () => {
    const { fixedDict } = enforceExactConsistency({ '白芍': 'Bạch Thược', '赤芍': 'Xích Thược' });
    expect(fixedDict['白芍']).toBe('Bạch Thược');
    expect(fixedDict['赤芍']).toBe('Xích Thược');
    expect(fixedDict['白芍']).not.toBe(fixedDict['赤芍']);
  });

  it('các cặp Hán-Việt lệch 1-2 ký tự khác đều phải giữ riêng', () => {
    const dict: Record<string, string> = {
      '青云': 'Thanh Vân', '成云': 'Thành Vân',
      '林浩': 'Lâm Hạo', '蓝浩': 'Lam Hạo',
      '东宫': 'Đông Cung', '同宫': 'Đồng Cung',
      '火灵': 'Hỏa Linh', '寒灵': 'Hàn Linh',
    };
    const { fixedDict } = enforceExactConsistency(dict);
    for (const [k, v] of Object.entries(dict)) {
      expect(fixedDict[k], `${k} bị đổi oan`).toBe(v);
    }
    // và không có hai biến nào bị gom về cùng một tên
    expect(new Set(Object.values(fixedDict)).size).toBe(Object.keys(dict).length);
  });

  it('nút KHÔNG được tự sinh ra xung đột mới', () => {
    const before = { '白芍': 'Bạch Thược', '赤芍': 'Xích Thược' };
    expect(validateDictionaryConflicts(before)).toHaveLength(0);
    const { fixedDict } = enforceExactConsistency(before);
    expect(validateDictionaryConflicts(fixedDict), 'nut tu tao ra xung dot').toHaveLength(0);
  });

  it('VẪN gộp đúng khi CÙNG MỘT BIẾN viết hai kiểu (chỉ khác dấu nối)', () => {
    // 好感度 và 好感_度 là một biến — đây mới là ca "đồng nhất" hợp lệ
    const { fixedDict, fixes } = enforceExactConsistency({
      '好感度': 'Hảo Cảm Độ', '好感_度': 'Hao Cam Do',
    });
    expect(fixedDict['好感度']).toBe(fixedDict['好感_度']);
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('VẪN chuẩn hoá dấu nối trong bản dịch của từng biến (không đụng biến khác)', () => {
    const { fixedDict } = enforceExactConsistency({ '姓名': 'Họ_Tên', '赤芍': 'Xích Thược' });
    expect(fixedDict['姓名']).toBe('Họ Tên');
    expect(fixedDict['赤芍']).toBe('Xích Thược');
  });

  it('xung đột CÓ SẴN thì vẫn báo, và nút không được che nó đi', () => {
    // AI dịch sai từ đầu: hai nguồn khác nhau ra cùng một tên
    const dict = { '白芍': 'Bạch Thược', '赤芍': 'Bạch Thược' };
    const conflicts = validateDictionaryConflicts(dict);
    expect(conflicts).toHaveLength(1);
    // sau khi bấm nút, xung đột VẪN còn để user thấy mà gọi AI dịch lại
    const { fixedDict } = enforceExactConsistency(dict);
    expect(validateDictionaryConflicts(fixedDict)).toHaveLength(1);
  });

  it('rác/rỗng không làm sập', () => {
    expect(() => enforceExactConsistency({})).not.toThrow();
    expect(enforceExactConsistency({ 'a': '' }).fixedDict).toEqual({ 'a': '' });
  });
});
