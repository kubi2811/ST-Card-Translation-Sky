// bugNeedFix/34 — quét đúng trạng thái chuỗi để dot-notation CJK được đổi sang bracket (chống crash).
import { describe, it, expect } from 'vitest';
import { isInsideStringAtEnd, extractCJKTokens } from '../surgical';

describe('isInsideStringAtEnd — đếm đúng nháy lồng nhau', () => {
  it('BUG THẬT: dấu " nằm trong chuỗi \'…\' KHÔNG bị tính là mở chuỗi', () => {
    // Đúng đoạn gây crash: +'<span class="tag '+(cv.<CJK>
    expect(isInsideStringAtEnd(`+'<span class="tag '+(cv.`)).toBe(false);
  });
  it('đang mở chuỗi nháy đơn → true', () => {
    expect(isInsideStringAtEnd(`msg += 'nội dung `)).toBe(true);
  });
  it('đang mở chuỗi nháy kép (có \' bên trong) → true', () => {
    expect(isInsideStringAtEnd(`x = "it's a `)).toBe(true);
  });
  it('chuỗi đã đóng cân bằng → false', () => {
    expect(isInsideStringAtEnd(`a = 'x'; b = "y"; obj.`)).toBe(false);
  });
  it('escape \\\' không đóng chuỗi', () => {
    expect(isInsideStringAtEnd(`s = 'don\\'t `)).toBe(true);
  });
  it('ngoài mọi chuỗi → false', () => {
    expect(isInsideStringAtEnd('const x = obj.')).toBe(false);
  });
});

describe('extractCJKTokens — cv.CJK sau chuỗi có " → phải là dot-notation (đổi bracket)', () => {
  it('BUG 34: token 已测能量 trong cv.已测能量 (sau `class="tag "`) được nhận là dot-notation', () => {
    const line = `h+='<span class="tag '+(cv.已测能量?'g':'')+'">'+(cv['已测能量']?'A':'B')+'</span>';`;
    const tokens = extractCJKTokens(line);
    // token đầu tiên (vị trí sau cv.) phải isDotNotation = true → reinsert sẽ đổi sang bracket
    const dotTok = tokens.find(t => t.text === '已测能量' && t.isDotNotation);
    expect(dotTok).toBeTruthy();
  });
});
