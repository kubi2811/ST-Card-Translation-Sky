// (User 22/07 — bug 75) Ba lỗi trong một đợt:
//   (a) MVU vẫn báo "[MVU额外模型解析]变量更新失败" — user đoán đúng: THIẾU entry định dạng đầu ra
//   (b) Opening Form đã hiện ra nhưng KHÔNG BẤM ĐƯỢC nút
//   (c) Kiểm tra tổng thể "toàn thấy nó nói Card đã chơi được"
//
// Đối chiếu 3 card MVU THẬT (bugNeedFix/1/_raw.json, /8, /9) — cả 3 đều có 5 entry hệ thống,
// thẻ do Auto Creator tạo chỉ có 3. Entry thiếu quy định khối đầu ra phải có ĐÚNG hai thẻ con
// <Analysis> và <JSONPatch>; thiếu nó thì engine MVU bóc không ra lệnh nào.
import { describe, it, expect } from 'vitest';
import { buildOutputFormatContent, buildEmphasisContent } from '../systemEntriesBuilder';
import { exportInlineHandlersToWindow, assembleHtmlDocument } from '../gameHtmlTemplates';

describe('bug 75a — định dạng đầu ra biến phải khớp hợp đồng của engine MVU', () => {
  const fmt = buildOutputFormatContent();

  it('có khối <UpdateVariable> với ĐỦ hai thẻ con <Analysis> và <JSONPatch>', () => {
    expect(fmt).toContain('<UpdateVariable>');
    expect(fmt).toContain('</UpdateVariable>');
    expect(fmt).toContain('<Analysis>');
    expect(fmt).toContain('</Analysis>');
    expect(fmt).toContain('<JSONPatch>');
    expect(fmt).toContain('</JSONPatch>');
  });

  it('mảng JSON nằm TRONG <JSONPatch>, không để trần trong <UpdateVariable>', () => {
    const inner = fmt.slice(fmt.indexOf('<JSONPatch>'), fmt.indexOf('</JSONPatch>'));
    expect(inner).toContain('"op"');
    expect(inner).toContain('"path"');
    // Đây chính là lỗi bản cũ: mảng đứng ngay sau <UpdateVariable>
    expect(fmt).not.toMatch(/<UpdateVariable>\s*\[/);
  });

  it('dạy đủ 5 operator mà MVU hỗ trợ', () => {
    for (const op of ['replace', 'delta', 'insert', 'remove', 'move']) {
      expect(fmt, `thieu operator ${op}`).toContain(op);
    }
  });

  it('dặn không đụng field chỉ đọc (bắt đầu bằng _)', () => {
    expect(fmt).toMatch(/`_`|bắt đầu bằng/i);
  });

  it('entry nhấn mạnh vẫn nhắc lại khối bắt buộc', () => {
    expect(buildEmphasisContent()).toContain('<UpdateVariable>');
  });
});

describe('bug 75b — nút trong Opening Form phải bấm được', () => {
  it('handler gọi từ onclick= được đưa ra window (module scope không tự lên global)', () => {
    const body = '<button onclick="goToPage(1)">Tiếp</button><button onclick="onConfirm()">Xong</button>';
    const js = 'function goToPage(n){}\nconst onConfirm = () => {};';
    const out = exportInlineHandlersToWindow(body, js);
    expect(out).toContain('window.goToPage = goToPage;');
    expect(out).toContain('window.onConfirm = onConfirm;');
  });

  it('KHÔNG gán window cho hàm chưa khai báo (để lỗi thiếu hàm vẫn nổ ra, không bị che)', () => {
    const out = exportInlineHandlersToWindow('<div onclick="khongCoThat()">x</div>', 'function khac(){}');
    expect(out).toBe('');
  });

  it('tài liệu HTML dựng ra chứa phần gán window sau khối JS', () => {
    const html = assembleHtmlDocument('body{}', '<button onclick="goToPage(2)">x</button>', 'function goToPage(n){}');
    expect(html).toContain('<script type="module">');
    expect(html).toContain('window.goToPage = goToPage;');
    // phần gán phải nằm TRONG thẻ script, trước khi đóng
    expect(html.indexOf('window.goToPage')).toBeLessThan(html.indexOf('</script>'));
  });

  it('bắt được mọi loại handler inline, không chỉ onclick', () => {
    const body = '<input onchange="a()"><form onsubmit="b()"><input oninput="c()">';
    const js = 'function a(){}function b(){}function c(){}';
    const out = exportInlineHandlersToWindow(body, js);
    for (const n of ['a', 'b', 'c']) expect(out).toContain(`window.${n} = ${n};`);
  });

  it('không có handler inline → không chèn gì thừa', () => {
    expect(exportInlineHandlersToWindow('<div>chỉ chữ</div>', 'function x(){}')).toBe('');
  });
});

// (User 22/07, ảnh chụp log final_check) Phép kiểm "script render rỗng" tớ vừa thêm đã báo
// động GIẢ trên chính script "[AI] Loại bỏ khối UpdateVariable":
//     ❌ 1 script render có nội dung RỖNG ([AI] Loại bỏ khối UpdateVariable)
// Script đó có replaceString rỗng là ĐÚNG — việc của nó là XOÁ khối, không phải render.
//
// Cờ markdownOnly+promptOnly cùng bật của nó cũng đúng chuẩn. Đọc engine.js:347-355 của ST:
//   (markdownOnly && isMarkdown) || (promptOnly && isPrompt) || (!markdownOnly && !promptOnly && !isMarkdown && !isPrompt)
// ⇒ tổ hợp cả-hai-true chạy ở lượt HIỂN THỊ và lượt PROMPT, nhưng KHÔNG chạy ở lượt ghi
// chat[].mes. Nghĩa là khối <UpdateVariable> bị giấu khỏi mắt user và khỏi prompt lượt sau,
// mà vẫn còn nguyên trong tin nhắn thô để MVU đọc. Đúng như thiết kế.
describe('bug 75c — phép kiểm không được báo động giả trên script xoá nội dung', () => {
  const isEmptyRenderFlagged = (script: Record<string, unknown>) => {
    const UI_ANCHORS = ['<OpeningFormImpl/>', '<StatusPlaceHolderImpl/>'];
    const r = script as { findRegex?: string; replaceString?: string; promptOnly?: boolean; markdownOnly?: boolean };
    if (r.promptOnly && !r.markdownOnly) return false;
    const isAnchor = !!r.findRegex && UI_ANCHORS.includes(r.findRegex);
    return isAnchor && String(r.replaceString || '').trim() === '';
  };

  it('script XOÁ khối UpdateVariable (replaceString rỗng có chủ ý) KHÔNG bị báo lỗi', () => {
    expect(isEmptyRenderFlagged({
      scriptName: '[AI] Loại bỏ khối UpdateVariable',
      findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g',
      replaceString: '', markdownOnly: true, promptOnly: true,
    })).toBe(false);
  });

  it('nhưng script RENDER bám mỏ neo mà rỗng thì VẪN bị báo (lỗi thật)', () => {
    expect(isEmptyRenderFlagged({
      scriptName: '[Render] Opening Form',
      findRegex: '<OpeningFormImpl/>',
      replaceString: '', markdownOnly: true, promptOnly: false,
    })).toBe(true);
    expect(isEmptyRenderFlagged({
      scriptName: '[Render] Status Bar',
      findRegex: '<StatusPlaceHolderImpl/>',
      replaceString: '   ', markdownOnly: true, promptOnly: false,
    })).toBe(true);
  });

  it('script render bám mỏ neo CÓ nội dung → không bị báo', () => {
    expect(isEmptyRenderFlagged({
      findRegex: '<OpeningFormImpl/>', replaceString: '```html\n<div>...</div>\n```',
      markdownOnly: true, promptOnly: false,
    })).toBe(false);
  });
});
