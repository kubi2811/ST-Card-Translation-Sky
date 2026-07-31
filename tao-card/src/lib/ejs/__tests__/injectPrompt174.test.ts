/**
 * (bug 174 — phần kiểm chất lượng EJS) injectPrompt GỌI SAI CHỮ KÝ ⇒ KHÔNG BAO GIỜ CHẠY.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thẻ user gửi có 13 "Bộ điều khiển EJS", trong đó 10 khối chỉ làm đúng một việc: gọi
 *     injectPrompt({ text: '…', position: 'in_chat', depth: 1 })
 * Không lỗi đỏ, không cảnh báo, và cũng KHÔNG có tác dụng gì cả.
 *
 * Đối chiếu source của chính extension đang cài trên máy user
 * (SillyTavern/data/default-user/extensions/ST-Prompt-Template/src/function/inject.ts:24):
 *     function injectPrompt(key, prompt, order = 100, sticky = 0, uid = '')
 * Tham số là VỊ TRÍ, không phải object, và KHÔNG hề có `position`/`depth`. Truyền một object
 * vào thì `key` = object đó, `prompt` = undefined — nội dung bị vứt thẳng.
 *
 * Tệ hơn: `injectPrompt` KHÔNG tự chèn vào prompt. Nó chỉ bỏ nội dung vào một Map nội bộ, phải
 * có chỗ gọi `getPromptsInjected(key)` (hoặc macro {{outletPromptsInjected:key}}) thì mới ra
 * prompt. Thẻ này không có lấy một chỗ đọc nào.
 *
 * Nguồn cơn KHÔNG phải do user viết ẩu: chính tool dạy như vậy — ejsSnippets, ejsPrompt,
 * ejsExamples, stptApi, bảng API trong EJS Studio và bộ sinh mvuzodToEjs đều dùng dạng object.
 * Nhầm với `injectPrompts` (SỐ NHIỀU, {id, position, depth, content}) của TavernHelper — một API
 * khác hẳn, của extension khác.
 *
 * Cách đúng trong khối EJS: in thẳng bằng print(...) (docs/reference.md:331) — nội dung rơi vào
 * đúng vị trí/độ sâu của chính entry đó. Hoặc dùng cặp injectPrompt('nhóm', text) +
 * getPromptsInjected('nhóm') nếu muốn gom nội dung rồi hút vào một chỗ khác trong preset.
 */
import { describe, it, expect } from 'vitest';
import { checkEjsSemantics } from '../ejsSemanticGuard';
import { EJS_SNIPPETS } from '../../../components/ejs/ejsSnippets';
import { rewriteInjectPromptCalls } from '../../ai/cardAutoRepair';

const check = (code: string, extraBlocks: Array<{ name: string; code: string }> = []) =>
  checkEjsSemantics({
    blocks: [{ name: 'Bộ điều khiển EJS', code }, ...extraBlocks],
    entries: [],
    schema: null,
  });

describe('(bug 174) bắt injectPrompt gọi bằng object — dạng không bao giờ chạy', () => {
  it('ca thật của thẻ user bị báo lỗi', () => {
    const found = check(`@@preprocessing
<%_
  injectPrompt({ text: '[Chỉ thị: Giọng điệu GM]', position: 'in_chat', depth: 1 });
_%>`).filter(i => i.kind === 'injectprompt-args');
    expect(found.length, 'im lặng nuốt mất nội dung là loại lỗi tệ nhất').toBe(1);
    expect(found[0].level).toBe('error');
    expect(found[0].fix, 'phải chỉ ra cách viết đúng').toMatch(/print\(/);
  });

  it('nhiều lệnh sai trong một khối thì báo hết, không gộp mất dấu', () => {
    const found = check(`<%_
  injectPrompt({ text: 'a', position: 'in_chat', depth: 1 });
  injectPrompt({ text: 'b', position: 'after_char', depth: 0 });
_%>`).filter(i => i.kind === 'injectprompt-args');
    expect(found.length).toBe(2);
  });

  it('print() thì KHÔNG báo — đây là cách viết đúng', () => {
    expect(check(`<%_ print('[Chỉ thị: Giọng điệu GM]'); _%>`).filter(i => i.kind.startsWith('injectprompt'))).toEqual([]);
  });
});

describe('(bug 174) injectPrompt viết đúng chữ ký nhưng KHÔNG ai đọc ra', () => {
  it('có injectPrompt mà cả thẻ không có getPromptsInjected → vẫn không tới tay AI', () => {
    const found = check(`<%_ injectPrompt('gm_directive', '[Chỉ thị]'); _%>`)
      .filter(i => i.kind === 'injectprompt-orphan');
    expect(found.length).toBe(1);
    expect(found[0].message).toMatch(/getPromptsInjected/);
  });

  it('có chỗ đọc ở entry khác → KHÔNG báo', () => {
    const found = check(
      `<%_ injectPrompt('gm_directive', '[Chỉ thị]'); _%>`,
      [{ name: 'Điểm hút', code: `<%- getPromptsInjected('gm_directive') %>` }],
    ).filter(i => i.kind === 'injectprompt-orphan');
    expect(found).toEqual([]);
  });

  it('dùng macro outlet cũng tính là có chỗ đọc', () => {
    const found = check(
      `<%_ injectPrompt('gm_directive', '[Chỉ thị]'); _%>`,
      [{ name: 'Preset', code: `{{outletPromptsInjected:gm_directive}}` }],
    ).filter(i => i.kind === 'injectprompt-orphan');
    expect(found).toEqual([]);
  });

  it('đọc nhóm KHÁC thì vẫn là mồ côi — không nhận vơ', () => {
    const found = check(
      `<%_ injectPrompt('gm_directive', '[Chỉ thị]'); _%>`,
      [{ name: 'Điểm hút', code: `<%- getPromptsInjected('nhóm_khác') %>` }],
    ).filter(i => i.kind === 'injectprompt-orphan');
    expect(found.length).toBe(1);
  });
});

describe('(bug 174) chính tool phải thôi dạy dạng sai', () => {
  it('không snippet nào trong EJS Studio còn dùng injectPrompt({…})', () => {
    const bad = EJS_SNIPPETS.filter(s => /injectPrompt\s*\(\s*\{/.test(s.code)).map(s => s.id);
    expect(bad, 'user copy snippet ra là dính lỗi ngay').toEqual([]);
  });

  it('mọi snippet có injectPrompt đều viết đủ cặp gọi + chỗ đọc', () => {
    for (const s of EJS_SNIPPETS) {
      if (!/\binjectPrompt\s*\(/.test(s.code)) continue;
      expect(/getPromptsInjected\s*\(|outletPromptsInjected/.test(s.code), `snippet "${s.id}" gọi injectPrompt mà không có chỗ đọc`).toBe(true);
    }
  });
});

describe('(bug 174) vá tự động: injectPrompt({…}) → print(…)', () => {
  it('ca thật của thẻ user', () => {
    const r = rewriteInjectPromptCalls(`<%_
  injectPrompt({ text: '[Chỉ thị: Giọng điệu GM]', position: 'in_chat', depth: 1 });
_%>`);
    expect(r.count).toBe(1);
    expect(r.code).toContain(`print('[Chỉ thị: Giọng điệu GM]')`);
    expect(r.code).not.toContain('injectPrompt');
  });

  it('giữ nguyên biểu thức ghép chuỗi và biến, không cắt ở dấu phẩy bên trong', () => {
    const r = rewriteInjectPromptCalls(
      `injectPrompt({ text: '[Ngoại hình: ' + desc.join(', ') + ']', position: 'in_chat', depth: 0 });`,
    );
    expect(r.code).toBe(`print('[Ngoại hình: ' + desc.join(', ') + ']');`);
  });

  it('object nhiều dòng + template literal', () => {
    const r = rewriteInjectPromptCalls([
      'injectPrompt({',
      '  text: `Cảnh ${scene} lúc ${gio}`,',
      "  position: 'in_chat',",
      '  depth: 8,',
      '});',
    ].join('\n'));
    expect(r.code).toBe('print(`Cảnh ${scene} lúc ${gio}`);');
  });

  it('lệnh viết ĐÚNG chữ ký thì KHÔNG đụng vào', () => {
    const src = `injectPrompt('gm', '[Chỉ thị]', 10);`;
    expect(rewriteInjectPromptCalls(src)).toEqual({ code: src, count: 0 });
  });

  it('nhiều lệnh trong một khối đều được vá', () => {
    const r = rewriteInjectPromptCalls(
      `injectPrompt({ text: 'a', depth: 1 });\nif (x) { injectPrompt({ text: 'b', depth: 2 }); }`,
    );
    expect(r.count).toBe(2);
    expect(r.code).toBe(`print('a');\nif (x) { print('b'); }`);
  });
});

describe('(bug 174) chốt kiểm không được báo oan vì chú thích', () => {
  it('chú thích nhắc tới injectPrompt({…}) không phải là lệnh', () => {
    const found = check(`<%_
  // KHÔNG dùng injectPrompt({ text, position, depth }) — sai chữ ký
  print('ok');
_%>`).filter(i => i.kind.startsWith('injectprompt'));
    expect(found).toEqual([]);
  });
});

describe('(bug 174) nhớ giá trị lượt trước bằng biến tạm trong @@preprocessing', () => {
  it('ca thật "Kiểm tra sụt giảm VP" bị cảnh báo', () => {
    const found = check(`@@preprocessing
<%_
var current_vp = Number(getvar('stat_data.Người Chơi.Veil Point', { defaults: 100 }));
var old_vp = Number(getvar('temp_old_vp', { defaults: 100 }));
if (old_vp - current_vp > 20) { print('[sụt VP]'); }
setvar('temp_old_vp', current_vp);
_%>`).filter(i => i.kind === 'preprocessing-memo');
    expect(found.length).toBe(1);
    expect(found[0].path).toBe('temp_old_vp');
    expect(found[0].fix).toMatch(/setMessageVar|postprocessing/);
  });

  it('chỉ ĐỌC biến tạm (không ghi đè) thì không sao', () => {
    expect(check(`@@preprocessing\n<%_ var x = getvar('temp_x'); _%>`)
      .filter(i => i.kind === 'preprocessing-memo')).toEqual([]);
  });

  it('ghi biến stat_data thì không thuộc diện này — đã có chốt khác lo', () => {
    expect(check(`@@preprocessing
<%_
var vp = Number(getvar('stat_data.Người Chơi.Veil Point', { defaults: 100 }));
if (isNaN(vp)) setvar('stat_data.Người Chơi.Veil Point', 100);
_%>`).filter(i => i.kind === 'preprocessing-memo')).toEqual([]);
  });
});
