// EJS conflict detection (phần thuần, không đụng mạng) — cơ chế bắt "khác từ nhưng dịch cùng nghĩa".
import { describe, it, expect } from 'vitest';
import { detectEjsConflicts } from '../ejsSync';

describe('detectEjsConflicts — bắt dịch trùng nghĩa cho Chiến lược C', () => {
  it('2 key gốc khác nhau → CÙNG bản dịch → báo đụng độ', () => {
    const conflicts = detectEjsConflicts({
      '父女': 'Cha con',
      '父子': 'Cha con',   // trùng nghĩa với 父女 dù chữ gốc khác
      '青龙': 'Thanh Long',
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].value).toBe('Cha con');
    expect(conflicts[0].keys.sort()).toEqual(['父女', '父子']);
  });

  it('gom ĐÚNG nhiều nhóm đụng độ khác nhau', () => {
    const conflicts = detectEjsConflicts({
      '青龙': 'Thanh Long', '苍龙': 'Thanh Long',       // nhóm 1
      '师父': 'Sư phụ', '师傅': 'Sư phụ', '老师': 'Sư phụ', // nhóm 2 (3 key)
      '独一无二': 'Độc nhất',                            // không trùng
    });
    const map = Object.fromEntries(conflicts.map(c => [c.value, c.keys.length]));
    expect(map['Thanh Long']).toBe(2);
    expect(map['Sư phụ']).toBe(3);
    expect(map['Độc nhất']).toBeUndefined();
  });

  it('map identity (k===v, chưa dịch) KHÔNG tính là đụng độ; value rỗng bỏ qua', () => {
    expect(detectEjsConflicts({ 'ABC': 'ABC', 'XYZ': 'XYZ', 'foo': '', 'bar': '' })).toEqual([]);
  });

  it('cùng value nhưng chỉ 1 key → không phải đụng độ', () => {
    expect(detectEjsConflicts({ '龙': 'Rồng' })).toEqual([]);
  });

  it('trim: "Cha Con " và "Cha Con" tính là cùng value', () => {
    const conflicts = detectEjsConflicts({ 'a': 'Cha Con ', 'b': 'Cha Con' });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].keys.sort()).toEqual(['a', 'b']);
  });
});
