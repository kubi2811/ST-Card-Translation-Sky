// bugNeedFix/34 — quét đúng trạng thái chuỗi để dot-notation CJK được đổi sang bracket (chống crash).
import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import { isInsideStringAtEnd, extractCJKTokens, reinsertTranslations, surgicalTranslate, verifySurgicalResult } from '../surgical';

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
  it('dấu nháy trong regex literal KHÔNG mở chuỗi giả', () => {
    expect(isInsideStringAtEnd(`const single = /'/g; const double = /[\"]/; obj.`)).toBe(false);
    expect(isInsideStringAtEnd(`const slash = /[\\/']/g; obj.`)).toBe(false);
  });
  it('regex trong nội suy template cũng không làm lệch trạng thái chuỗi', () => {
    expect(isInsideStringAtEnd('const s = `${/[\']/g.test(x) ? obj.')).toBe(false);
  });
  it('phép chia vẫn là phép chia, chuỗi thật phía sau vẫn được nhận ra', () => {
    expect(isInsideStringAtEnd(`const ratio = total / divisor; const text = 'đang mở`)).toBe(true);
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

  it('regex có nháy ở phía trước không làm obj.中文 mất lớp bọc bracket', () => {
    const source = `const quote = /'/g; const value = obj.当前状态;`;
    const tokens = extractCJKTokens(source);
    const token = tokens.find(t => t.text === '当前状态');
    expect(token?.isDotNotation).toBe(true);
    if (token) token.translated = 'Trạng thái hiện tại';
    const translated = reinsertTranslations(source, tokens);
    expect(translated).toContain("obj['Trạng thái hiện tại']");
    expect(() => acorn.parse(translated, { ecmaVersion: 'latest' })).not.toThrow();
  });
});

describe('surgical local-only — vẫn phải qua lưới cú pháp', () => {
  it('từ điển chèn dấu / làm vỡ regex literal JS → strict phải trả về bản gốc', async () => {
    const source = 'const re = /<状态>/g;';
    expect(verifySurgicalResult(source, 'const re = /<Trạng/thái>/g;')).toBe(false);
    const out = await surgicalTranslate(
      source, {} as never, 'Vietnamese', undefined, undefined,
      { 状态: 'Trạng/thái' }, true,
    );
    expect(out.success).toBe(false);
    expect(out.fallbackTriggered).toBe(true);
    expect(out.translated).toBe(source);
  });

  it('JSON gốc hợp lệ nhưng bản dịch hỏng nháy → verify không cho qua', () => {
    expect(verifySurgicalResult('{"状态":1}', '{"Trạng "Thái"":1}')).toBe(false);
  });

  it("obj['KEY'] thành obj[''] vẫn parse được nhưng phải bị chặn", () => {
    expect(verifySurgicalResult("const x = obj['状态'];", "const x = obj[''];")).toBe(false);
    // Nguồn vốn cố ý dùng key rỗng thì không báo oan.
    expect(verifySurgicalResult("const x = obj[''];", "const x = obj[''];")).toBe(true);
  });
});
