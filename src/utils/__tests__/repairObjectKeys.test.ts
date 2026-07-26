// (bugNeedFix/109) "Mất mục khi dịch tool" — thực chất là <script> chết vì khoá object mất nháy.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { repairUnquotedObjectKeys, repairUnquotedObjectKeysInHtml } from '../repairObjectKeys';
import { jsParseErrorAny, extractScriptBodies } from '../scriptSafety';

describe('CHÍNH CA BUG 109: khoá CJK không nháy → dịch ra có khoảng trắng → SyntaxError', () => {
  it('gốc `AP上限:8` hợp lệ; bản dịch `APGiới hạn:8` vỡ; vá xong parse sạch', () => {
    const original = `function defB(){return{stats:{魔力值:80,战斗力:40,AP上限:8}};}`;
    expect(jsParseErrorAny(original)).toBeNull();   // chữ Hán là định danh JS hợp lệ

    const translated = `function defB(){return{stats:{'Chỉ Số Ma Lực':80,'Lực Chiến':40,APGiới hạn:8}};}`;
    expect(jsParseErrorAny(translated)).not.toBeNull(); // đây là thứ làm cả script chết

    const r = repairUnquotedObjectKeys(translated);
    expect(r.repaired).toBe(true);
    expect(r.fixed).toContain('APGiới hạn');
    expect(jsParseErrorAny(r.code)).toBeNull();
    expect(r.code).toContain(`'APGiới hạn':8`);
  });

  it('nhiều khoá hỏng cùng lúc → vá hết trong một lượt', () => {
    const broken = `var o={Sức Tấn Công:5,Giới Hạn AP:8,ok:1};`;
    const r = repairUnquotedObjectKeys(broken);
    expect(r.repaired).toBe(true);
    expect(r.fixed.sort()).toEqual(['Giới Hạn AP', 'Sức Tấn Công']);
    expect(jsParseErrorAny(r.code)).toBeNull();
  });

  it('vá được cả khi khoá nằm trong object lồng nhau', () => {
    const broken = `const cfg={a:{b:{Chỉ Số Ma Lực:100}},c:2};`;
    const r = repairUnquotedObjectKeys(broken);
    expect(r.repaired).toBe(true);
    expect(jsParseErrorAny(r.code)).toBeNull();
  });
});

describe('TUYỆT ĐỐI KHÔNG LÀM HẠI', () => {
  it('code đang lành → trả nguyên văn, không đụng một ký tự', () => {
    const ok = `const o={'Sức Tấn Công':5,binhThuong:1};\nconst url='https://a.b/c';`;
    const r = repairUnquotedObjectKeys(ok);
    expect(r.repaired).toBe(false);
    expect(r.code).toBe(ok);
    expect(r.fixed).toEqual([]);
  });

  it('khoá CJK/định danh hợp lệ không bị bọc nháy thừa', () => {
    const r = repairUnquotedObjectKeys(`var o={魔力值:80,hp:1};`);
    expect(r.repaired).toBe(false);  // vốn đã parse sạch
    expect(r.code).toContain('魔力值:80');
  });

  it('code vỡ vì lý do KHÁC (không phải khoá) → không vá bừa, giữ nguyên', () => {
    const broken = `function f( { var a = 1;`;
    const r = repairUnquotedObjectKeys(broken);
    expect(r.repaired).toBe(false);
    expect(r.code).toBe(broken);
  });

  it('URL trong object không bị hiểu nhầm là khoá', () => {
    const code = `var o={Sức Mạnh:1,link:'https://x.y/z'};`;
    const r = repairUnquotedObjectKeys(code);
    expect(r.repaired).toBe(true);
    expect(r.code).toContain(`'https://x.y/z'`);   // chuỗi URL còn nguyên
    expect(jsParseErrorAny(r.code)).toBeNull();
  });

  it('ternary `cond ? a : b` không bị bọc nháy nhầm', () => {
    const code = `var o={Sức Mạnh:1};\nvar x = cond ? aVal : bVal;`;
    const r = repairUnquotedObjectKeys(code);
    expect(r.repaired).toBe(true);
    expect(r.code).toContain('cond ? aVal : bVal');
    expect(jsParseErrorAny(r.code)).toBeNull();
  });
});

describe('HTML có <script> nhúng (đúng dạng replaceString của regex giao diện)', () => {
  it('vá khối script bên trong, giữ nguyên phần HTML', () => {
    const html = `<div class="gm-w"><h3>Bảng Trạng Thái</h3></div>
<script>
function defB(){return{stats:{'Chỉ Số Ma Lực':80,APGiới hạn:8}};}
</script>`;
    const r = repairUnquotedObjectKeysInHtml(html);
    expect(r.repaired).toBe(true);
    expect(r.code).toContain('<div class="gm-w">');       // HTML nguyên vẹn
    expect(r.code).toContain(`'APGiới hạn':8`);
    expect(r.fixed).toContain('APGiới hạn');
  });

  it('HTML không có script → xử như JS thường, không nổ', () => {
    const html = `<div>chỉ có chữ</div>`;
    expect(() => repairUnquotedObjectKeysInHtml(html)).not.toThrow();
  });

  it('HTML mà script đã lành → không đụng vào', () => {
    const html = `<div>x</div><script>var a={'ok':1};</script>`;
    const r = repairUnquotedObjectKeysInHtml(html);
    expect(r.repaired).toBe(false);
    expect(r.code).toBe(html);
  });
});

describe('Dạng thứ hai của cùng lỗi: truy cập thuộc tính `.AP上限` → `.APtối đa`', () => {
  it('gốc `.AP上限=10` hợp lệ; dịch ra `.APtối đa=10` vỡ; vá thành ["APtối đa"]', () => {
    const original = `allB['A'].stats.AP上限=10;`;
    expect(jsParseErrorAny(original)).toBeNull();

    const translated = `allB['Thánh Tử'].stats.APtối đa=10;`;
    expect(jsParseErrorAny(translated)).not.toBeNull();

    const r = repairUnquotedObjectKeys(translated);
    expect(r.repaired).toBe(true);
    expect(r.fixed).toContain('APtối đa');
    expect(jsParseErrorAny(r.code)).toBeNull();
    expect(r.code).toContain(`['APtối đa']=10`);
  });

  it('truy cập thuộc tính BÌNH THƯỜNG `.foo = 1` không bị đụng tới', () => {
    const ok = `obj.foo = 1;
obj.bar= 2;`;
    const r = repairUnquotedObjectKeys(ok);
    expect(r.repaired).toBe(false);
    expect(r.code).toBe(ok);
  });
});

describe('BẰNG CHỨNG THẬT bugNeedFix/109 — file user gửi kèm', () => {
  it('script trong bản "dịch bằng tool bị lỗi" đang VỠ, sau khi vá thì PARSE SẠCH', () => {
    const bad = readFileSync('bugNeedFix/109/html dịch bằng tool bị lỗi.txt', 'utf8');
    const errBefore = extractScriptBodies(bad).map(b => jsParseErrorAny(b)).filter(Boolean);
    expect(errBefore.length).toBe(1);          // đúng: cả <script> chết ⇒ giao diện mất sạch

    const r = repairUnquotedObjectKeysInHtml(bad);
    expect(r.repaired).toBe(true);
    expect(r.fixed).toEqual(expect.arrayContaining(['APGiới hạn', 'APtối đa']));

    const errAfter = extractScriptBodies(r.code).map(b => jsParseErrorAny(b)).filter(Boolean);
    expect(errAfter.length).toBe(0);           // chữa lành hoàn toàn
  });

  it('bản user tự sửa tay vốn đã lành → bộ vá không đụng vào', () => {
    const fixedByUser = readFileSync('bugNeedFix/109/html đã được sữa lại cho đúng.txt', 'utf8');
    const r = repairUnquotedObjectKeysInHtml(fixedByUser);
    expect(r.repaired).toBe(false);
    expect(r.code).toBe(fixedByUser);
  });
});
