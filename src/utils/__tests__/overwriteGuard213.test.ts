/**
 * (bug 213 — Đợt 3: HẾT SỬA ĐÈ BẢN DỊCH ĐÚNG)
 *
 * Nhóm lỗi cùng một gốc bệnh: ĐOÁN MÒ mà không có chứng cứ. Fuzzy-match, ghép-theo-vị-trí,
 * ghép-cặp-bừa — tất cả đều tạo ra thay đổi SAI mà không có lỗi cú pháp nào báo, nên chỉ lộ ra
 * lúc user chơi thẻ. Các bản vá trước (bug #2, bug 70, bug 200) đã thiết lập đúng nguyên tắc
 * nhưng chưa được áp đều lên các "hàm song sinh".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { enforceInitvarCovariance, collectNameLikeLiterals } from '../mvuSync';
import { buildRegexTriggerDictionary } from '../mvuValidator';
import { patchReplaceString, validateReplaceStringSyntax } from '../regexInjector';

const aiVerifySrc = readFileSync(new URL('../aiVerify.ts', import.meta.url), 'utf-8');
const mythicSrc = readFileSync(new URL('../mythicSkill.ts', import.meta.url), 'utf-8');
const persistSrc = readFileSync(new URL('../../presetTranslate/persist.ts', import.meta.url), 'utf-8');
const pipelineSrc = readFileSync(new URL('../../presetTranslate/presetPipeline.ts', import.meta.url), 'utf-8');

/* ═══════ #5 — fuzzy Levenshtein không được ghi đè giá trị enum hợp lệ ═══════ */

describe('#5 — Pass 5 (=== / case) chỉ sửa khi CÓ CHỨNG CỨ đó là tên biến', () => {
  const DICT = { '好感度': 'Hảo Cảm', '魅力': 'Sức Hút' };

  it('CA GỐC CỦA BUG: giá trị enum hợp lệ cách tên biến 2 ký tự → KHÔNG bị ghi đè', () => {
    // 'Hảo Tâm' là giá trị hợp lệ, cách 'Hảo Cảm' đúng 2 ký tự, dài 7 nên lọt ngưỡng dist ≤ 2.
    const code = `if (trangThai === 'Hảo Tâm') { doSomething(); }`;
    const out = enforceInitvarCovariance(code, DICT, false);
    expect(out.text).toContain(`'Hảo Tâm'`);
    expect(out.text).not.toContain(`'Hảo Cảm'`);
  });

  it('case cũng vậy — không lỗi cú pháp nào bắt được nên phải chặn từ đây', () => {
    const code = `switch (x) { case 'Hảo Tâm': break; }`;
    expect(enforceInitvarCovariance(code, DICT, false).text).toContain(`case 'Hảo Tâm'`);
  });

  it('khớp CHÍNH XÁC (chỉ lệch hoa/thường hoặc gạch dưới) thì VẪN sửa — đó là chứng cứ chắc', () => {
    const code = `if (k === 'hảo_cảm') {}`;
    const out = enforceInitvarCovariance(code, DICT, false);
    expect(out.text).toContain(`'Hảo Cảm'`);
  });

  it('literal cũng xuất hiện ở vị trí TÊN BIẾN trong cùng văn bản → fuzzy được phép', () => {
    // Có `stat_data['Hảo Cẩm']` ở vị trí tên → chuỗi đó đúng là tên biến bị dịch lệch, đáng sửa.
    const code = `const v = stat_data['Hảo Cẩm'];\nif (key === 'Hảo Cẩm') {}`;
    const out = enforceInitvarCovariance(code, DICT, false);
    expect(out.text).toContain(`'Hảo Cảm'`);
  });

  it('strict mode vẫn không fuzzy gì cả (lorebook narrative)', () => {
    const code = `if (x === 'Hảo Tâm') {}`;
    expect(enforceInitvarCovariance(code, DICT, true).text).toContain(`'Hảo Tâm'`);
  });
});

describe('collectNameLikeLiterals — nhận đúng các vị trí TÊN BIẾN', () => {
  it('bắt getvar/setvar, bracket access, dot path, khoá YAML', () => {
    const text = [
      `{{getvar::Hảo Cảm}}`,
      `obj['Sức Hút']`,
      `stat_data.ThểLực`,
      `Ma Lực: 10`,
    ].join('\n');
    const s = collectNameLikeLiterals(text);
    expect(s.has('hảo cảm')).toBe(true);
    expect(s.has('sức hút')).toBe(true);
    expect(s.has('thểlực')).toBe(true);
    expect(s.has('ma lực')).toBe(true);
  });

  it('KHÔNG bắt chuỗi chỉ nằm trong phép so sánh', () => {
    const s = collectNameLikeLiterals(`if (x === 'Hảo Tâm') {}`);
    expect(s.has('hảo tâm')).toBe(false);
  });
});

/* ═══════ CSS class — bỏ ghép cặp đoán mò ═══════ */

describe('CSS class check — báo mất, KHÔNG bịa ra "nó đã thành cái gì"', () => {
  it('không còn dòng ghép cặp bừa với class mới đầu tiên bất kỳ', () => {
    expect(aiVerifySrc).not.toMatch(/const possibleTranslation = transArr\.find/);
    expect(aiVerifySrc).not.toMatch(/was translated to "\$\{possibleTranslation\}"/);
  });

  it('thông điệp mới trung thực như nhánh CSS ID vốn đã làm đúng', () => {
    expect(aiVerifySrc).toMatch(/biến mất khỏi bản dịch \(bị dịch hoặc bị đổi tên\)/);
    expect(aiVerifySrc).toMatch(/\(mất hoặc bị đổi tên\)/);
  });
});

/* ═══════ từ điển trigger regex — bỏ ghép theo vị trí ═══════ */

describe('buildRegexTriggerDictionary — hết sinh mục từ điển rác', () => {
  const mk = (original: string, translated: string) => ([{
    path: 'data.extensions.regex_scripts[0].findRegex',
    original, translated, status: 'done',
  }]);

  it('CA GỐC CỦA BUG: 【开场】 ↔ 【Mở đầu】 không được map thành dấu ngoặc lẻ', () => {
    const dict = buildRegexTriggerDictionary(mk('/【开场】/g', '/【Mở đầu】/g'));
    expect(dict['【开场】']).not.toBe('【');
    expect(dict['【开场】']).not.toBe('】');
    // pass ngoặc mới là đường đúng và nó cho kết quả chuẩn
    expect(dict['【开场】']).toBe('【Mở đầu】');
  });

  it('số đoạn CJK lệch nhau → không ghép mù theo chỉ số', () => {
    const dict = buildRegexTriggerDictionary(mk('/开场|结束/g', '/Mở đầu|结束/g'));
    // gốc 2 run (开场, 结束), dịch 1 run (结束) → lệch, bỏ qua pass vị trí
    expect(dict['开场']).toBeUndefined();
  });

  it('đoạn đích chỉ còn DẤU thì không bao giờ nhận là bản dịch', () => {
    const dict = buildRegexTriggerDictionary(mk('/【开场】/g', '/【 】/g'));
    expect(Object.values(dict)).not.toContain('【');
  });

  it('cùng số đoạn và đích có chữ thật → vẫn map bình thường', () => {
    const dict = buildRegexTriggerDictionary(mk('/开场/g', '/開場/g'));
    expect(dict['开场']).toBe('開場');
  });

  it('số cụm ngoặc lệch nhau → không mispair', () => {
    const dict = buildRegexTriggerDictionary(mk('/【A开场】【B结束】/g', '/【A Mở đầu】/g'));
    expect(dict['【B结束】']).toBeUndefined();
  });
});

/* ═══════ String.replace nuốt $& — hai chỗ ═══════ */

describe('$& trong nội dung chèn không được diễn giải thành pattern', () => {
  it('patchReplaceString chèn nguyên văn code có $& / $1', () => {
    const before = 'AAA__SLOT__BBB';
    const inject = `const m = s.replace(/x/, '$&!'); const g = '$1';`;
    const { result, success } = patchReplaceString(before, '__SLOT__', inject);
    expect(success).toBe(true);
    expect(result).toBe(`AAA${inject}BBB`);
    // nếu bị diễn giải thì '$&' sẽ nở thành '__SLOT__'
    expect(result).not.toContain('__SLOT__');
  });

  it("backtick-dollar và $' cũng an toàn", () => {
    const before = 'X__S__Y';
    const inject = "a$'b$`c";
    expect(patchReplaceString(before, '__S__', inject).result).toBe(`X${inject}Y`);
  });

  it('mythicSkill ghép khối meta bằng callback', () => {
    expect(mythicSrc).toMatch(/out\.replace\(b\.raw, \(\) => rebuilt\)/);
    expect(mythicSrc).not.toMatch(/out\.replace\(b\.raw, rebuilt\)/);
  });
});

/* ═══════ regexInjector validate — EJS không phải lỗi cú pháp ═══════ */

describe('validateReplaceStringSyntax — EJS hợp lệ không bị báo lỗi oan', () => {
  it('script chứa <% %> vẫn được coi là hợp lệ', () => {
    const rs = `<div><script>
      const n = <%= getvar('Hảo Cảm') %>;
      if (n > 5) { console.log('cao'); }
    </script></div>`;
    expect(validateReplaceStringSyntax(rs).valid).toBe(true);
  });

  it('thẻ XUẤT <%- %> cũng được gỡ như <%= %>', () => {
    const rs = `<script>var b = <%- raw %>; console.log(b);</script>`;
    expect(validateReplaceStringSyntax(rs).valid).toBe(true);
  });

  it('thẻ ĐIỀU KHIỂN <% %> → bỏ qua kiểm, không kết luận bừa', () => {
    // Bỏ thẻ đi là mất thân lệnh, thay bằng literal là dính hai biểu thức — không parse tử tế
    // được, nên thà không kết luận còn hơn báo lỗi oan.
    const rs = `<script><% if (x) { %> var a = 1; <% } %></script>`;
    expect(validateReplaceStringSyntax(rs).valid).toBe(true);
  });

  it('lỗi cú pháp THẬT vẫn bị bắt', () => {
    const rs = `<script>function f( { return 1 }</script>`;
    expect(validateReplaceStringSyntax(rs).valid).toBe(false);
  });
});

/* ═══════ resume Dịch Preset — dây an toàn thứ 2 ═══════ */

describe('resume Dịch Preset đối chiếu chuỗi gốc như Dịch Script', () => {
  it('bản lưu mang kèm chuỗi gốc, không chỉ bản dịch', () => {
    expect(persistSrc).toMatch(/export type UnitEntry = \{ o: string; t: string \}/);
    expect(persistSrc).toMatch(/map\[u\.id\] = \{ o: u\.original, t: u\.translated \}/);
  });

  it('chỉ áp bản dịch cũ khi chuỗi gốc TRÙNG', () => {
    expect(pipelineSrc).toMatch(/if \(saved && saved\.o === u\.original\) u\.translated = saved\.t;/);
  });

  it('mục định dạng CŨ (chuỗi trần, không đối chiếu được) bị loại khi nạp', () => {
    expect(persistSrc).toMatch(/typeof \(v as UnitEntry\)\.o === 'string' && typeof \(v as UnitEntry\)\.t === 'string'/);
  });
});
