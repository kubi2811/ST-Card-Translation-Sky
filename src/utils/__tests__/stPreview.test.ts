import { describe, it, expect } from 'vitest';
import { parseFindRegex, substituteMacros, applyDisplayRegex, buildPreviewHtml, extractRegexScripts } from '../stPreview';

describe('parseFindRegex', () => {
  it('parse dạng /pattern/flags chuẩn ST, tự thêm g', () => {
    const re = parseFindRegex('/abc/i')!;
    expect(re.source).toBe('abc');
    expect(re.flags).toContain('g');
    expect(re.flags).toContain('i');
  });
  it('chuỗi trần → pattern với flag g; regex hỏng → null', () => {
    expect(parseFindRegex('hello')!.flags).toContain('g');
    expect(parseFindRegex('/[unclosed/')).toBeNull();
    expect(parseFindRegex('')).toBeNull();
  });
});

describe('substituteMacros', () => {
  it('thay {{user}}/{{char}} không phân biệt hoa thường', () => {
    expect(substituteMacros('{{User}} gặp {{CHAR}}', { user: 'An', char: 'Diệp Phàm' }))
      .toBe('An gặp Diệp Phàm');
  });
});

describe('applyDisplayRegex', () => {
  const scripts = [
    { scriptName: 'status', findRegex: '/【(.+?)】/g', replaceString: '<div class="st">$1</div>', placement: [2] },
    { scriptName: 'match-macro', findRegex: '/=start=/', replaceString: '[{{match}}]', placement: [2] },
    { scriptName: 'prompt-only', findRegex: '/bí mật/', replaceString: 'XXX', placement: [2], promptOnly: true },
    { scriptName: 'disabled', findRegex: '/tắt/', replaceString: 'YYY', placement: [2], disabled: true },
    { scriptName: 'input-only', findRegex: '/input/', replaceString: 'ZZZ', placement: [1] },
  ];

  it('áp đúng script hiển thị: $1 + {{match}}; bỏ promptOnly/disabled/placement khác', () => {
    const { text, applied } = applyDisplayRegex('【HP: 100】 =start= bí mật tắt input', scripts);
    expect(text).toBe('<div class="st">HP: 100</div> [=start=] bí mật tắt input');
    expect(applied).toEqual(['status', 'match-macro']);
  });

  it('regex hỏng trong 1 script không làm chết các script sau', () => {
    const bad = [
      { scriptName: 'bad', findRegex: '/[oops/', replaceString: 'x', placement: [2] },
      { scriptName: 'good', findRegex: '/ok/', replaceString: 'OK', placement: [2] },
    ];
    const { text, applied } = applyDisplayRegex('ok', bad);
    expect(text).toBe('OK');
    expect(applied).toEqual(['good']);
  });
});

describe('buildPreviewHtml', () => {
  it('văn bản thuần: escape + <br> + đậm/nghiêng tối thiểu', () => {
    const html = buildPreviewHtml('Xin chào 5 < 6\n**đậm** *nghiêng*', 'Diệp Phàm');
    expect(html).toContain('Xin chào 5 &lt; 6<br><b>đậm</b> <i>nghiêng</i>');
    expect(html).toContain('Diệp Phàm');
  });
  it('nội dung HTML: render thẳng, mở code fence bao ngoài', () => {
    const html = buildPreviewHtml('```html\n<div class="ui">UI</div>\n```', 'C');
    expect(html).toContain('<div class="ui">UI</div>');
    expect(html).not.toContain('```');
  });
});

describe('extractRegexScripts', () => {
  it('đọc từ data.extensions.regex_scripts (chuẩn V2) hoặc extensions trực tiếp', () => {
    expect(extractRegexScripts({ data: { extensions: { regex_scripts: [{ scriptName: 'a' }] } } })).toHaveLength(1);
    expect(extractRegexScripts({ extensions: { regex_scripts: [{}, {}] } })).toHaveLength(2);
    expect(extractRegexScripts({})).toEqual([]);
    expect(extractRegexScripts(null)).toEqual([]);
  });
});
