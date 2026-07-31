/**
 * (bug 175) OPENING FORM HIỆN RA NHƯNG MỌI NÚT CHẾT — REGEX TRANG TRÍ ĂN VÀO CHÍNH CODE.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Auto Creator tạo Card xong import vào SillyTavern, giao diện Opening Form các nút bị
 * liệt, test trong Regex Lab thì bình thường."
 *
 * ĐO TRÊN SILLYTAVERN THẬT (đã nhập thẻ bug/175 vào bản ST đang chạy của user rồi gỡ ra):
 *   iframe TH-message--0--0 : 47 nút hiện đủ, `typeof window.goToPage === "undefined"`
 *   lỗi trong iframe        : Uncaught SyntaxError: Unexpected identifier 'color' — dòng 225
 *   dòng 225 sau khi ST xử lý:
 *       "note":"Theo lore, khởi điểm thức tỉnh trung bình khoảng
 *        <span style="color: #fbbf24; …">115 VP</span>, đây là dung lượng cơ bản cho Sơ thức."
 *
 * GỐC RỄ: SillyTavern áp TẤT CẢ regex hiển thị LẦN LƯỢT lên CÙNG MỘT chuỗi tin nhắn
 * (regex/engine.js:346 — global trước, scoped sau, theo đúng thứ tự mảng). `[Render] Opening
 * Form` chèn 40KB HTML+JS vào tin nhắn TRƯỚC, rồi `[Style] Tô màu Tài nguyên` chạy SAU và khớp
 * chuỗi "115 VP" nằm bên trong một chuỗi JSON TRONG JAVASCRIPT, bọc nó bằng thẻ <span> có dấu
 * nháy kép — dấu nháy đó cắt đứt chuỗi JS ⇒ cả khối <script type="module"> không biên dịch được
 * ⇒ KHÔNG một handler nào được gán ra window ⇒ 47 nút chết sạch. HTML và CSS vẫn render đẹp nên
 * nhìn ngoài không thấy gì bất thường, cũng không có lỗi đỏ nào ở giao diện ST.
 *
 * Vì sao Regex Lab báo "bình thường": nó thử TỪNG script một trên tin nhắn gốc, không bao giờ
 * chạy CẢ CHUỖI theo đúng thứ tự — mà lỗi chỉ sinh ra khi script sau ăn vào output của script
 * trước.
 */
import { describe, it, expect } from 'vitest';
import {
  stRegexFromString,
  runsOnDisplay,
  applyDisplayChain,
  findChainBreaks,
  reorderRenderScriptsLast,
} from '../stRegexChain';

/** Khối render tối giản nhưng giữ nguyên cái bẫy: một con số + đơn vị nằm TRONG chuỗi JS. */
const RENDER_HTML = [
  '```html',
  '<!DOCTYPE html>',
  '<html lang="vi"><head><style>#a{color:red}</style></head>',
  '<body><div id="stcs-app"><button onclick="goToPage(1)">Tiếp</button></div>',
  '<script type="module">',
  'var STCS_RELATIONS = [{"note":"Khởi điểm trung bình khoảng 115 VP, đủ cho Sơ Thức."}];',
  'function goToPage(n){ return n; }',
  'window.goToPage = goToPage;',
  '<\/script>',
  '</body></html>',
  '```',
].join('\n');

const RENDER = {
  scriptName: '[Render] Opening Form',
  findRegex: '<OpeningFormImpl/>',
  replaceString: RENDER_HTML,
  markdownOnly: true, promptOnly: false, placement: [2], disabled: false,
};
/** Chính con regex trang trí của thẻ user, nguyên văn. */
const STYLE = {
  scriptName: '[Style] Tô màu Tài nguyên (VP, AP, Veil Coin)',
  findRegex: '([-+]?\\d+\\s?(?:VP|AP|Veil Coin))(?!\\w)',
  replaceString: '<span style="color: #fbbf24; font-family: monospace; font-weight: bold;">$1</span>',
  markdownOnly: true, promptOnly: false, placement: [2], disabled: false,
};
const HIDE = {
  scriptName: '[AI] Ẩn Opening Form',
  findRegex: '<OpeningFormImpl/>', replaceString: '',
  markdownOnly: false, promptOnly: true, placement: [2], disabled: false,
};
const FIRST_MES = '<OpeningFormImpl/>\nBạn nhận được 50 VP khởi đầu.';

describe('(bug 175) đọc findRegex ĐÚNG như SillyTavern', () => {
  it('chuỗi trần là MẪU REGEX chứ không phải chữ cần tìm nguyên văn', () => {
    // Đây chính là chỗ bản mô phỏng đầu tiên của tôi sai: escape nó thành chuỗi literal nên
    // đo ra "0 lần khớp" và suýt kết luận nhầm là regex trang trí vô hại.
    const re = stRegexFromString('([-+]?\\d+\\s?(?:VP|AP|Veil Coin))(?!\\w)');
    expect(re).toBeTruthy();
    expect('khoảng 115 VP, đủ dùng'.replace(re!, 'X')).toContain('X');
  });

  it('dạng /mẫu/cờ vẫn hiểu đúng cả cờ', () => {
    const re = stRegexFromString('/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm');
    expect(re!.flags).toContain('g');
    expect('a<UpdateVariable>x</UpdateVariable>b'.replace(re!, '')).toBe('ab');
  });

  it('chuỗi thường không có ký tự đặc biệt vẫn khớp nguyên văn', () => {
    expect('a<OpeningFormImpl/>b'.replace(stRegexFromString('<OpeningFormImpl/>')!, 'X')).toBe('aXb');
  });
});

describe('(bug 175) chỉ script markdownOnly mới chạy ở luồng hiển thị', () => {
  it('markdownOnly = chạy', () => expect(runsOnDisplay(RENDER)).toBe(true));
  it('promptOnly thuần = KHÔNG chạy', () => expect(runsOnDisplay(HIDE)).toBe(false));
  it('không cờ nào = KHÔNG chạy ở luồng hiển thị (engine.js:354 đòi !isMarkdown)', () => {
    expect(runsOnDisplay({ ...HIDE, promptOnly: false, markdownOnly: false })).toBe(false);
  });
  it('bị tắt thì bỏ qua', () => expect(runsOnDisplay({ ...RENDER, disabled: true })).toBe(false));
});

describe('(bug 175) bắt được ca thật: regex sau ăn vào code của regex trước', () => {
  it('chuỗi [Render] → [Style] làm VỠ script, chỉ đích danh thủ phạm', () => {
    const breaks = findChainBreaks(FIRST_MES, [HIDE, RENDER, STYLE]);
    expect(breaks.length, 'đây đúng là ca 47 nút chết của user').toBe(1);
    expect(breaks[0].culprit).toBe('[Style] Tô màu Tài nguyên (VP, AP, Veil Coin)');
    expect(breaks[0].victim).toBe('[Render] Opening Form');
    expect(breaks[0].detail, 'phải nêu được lỗi cú pháp thật').toMatch(/color|SyntaxError|Unexpected/i);
  });

  it('đảo [Render] xuống CUỐI là hết vỡ — regex trang trí chỉ còn ăn vào văn xuôi', () => {
    const breaks = findChainBreaks(FIRST_MES, [HIDE, STYLE, RENDER]);
    expect(breaks).toEqual([]);
  });

  it('văn xuôi vẫn được tô màu như ý — không mất tính năng', () => {
    const out = applyDisplayChain(FIRST_MES, [HIDE, STYLE, RENDER]).text;
    expect(out, '"50 VP" trong lời dẫn vẫn phải được tô').toContain('<span style="color: #fbbf24');
    expect(out).toContain('>50 VP</span>');
  });

  it('thẻ không có regex trang trí thì KHÔNG báo oan', () => {
    expect(findChainBreaks(FIRST_MES, [HIDE, RENDER])).toEqual([]);
  });

  it('regex trang trí khớp nhưng KHÔNG làm vỡ cú pháp thì cũng không báo', () => {
    const soft = { ...STYLE, replaceString: '**$1**' };
    expect(findChainBreaks(FIRST_MES, [HIDE, RENDER, soft])).toEqual([]);
  });
});

describe('(bug 175) phép vá: đẩy mọi script render xuống cuối', () => {
  it('giữ nguyên thứ tự tương đối, chỉ dời script render', () => {
    const res = reorderRenderScriptsLast([HIDE, RENDER, STYLE]);
    expect(res.moved).toEqual(['[Render] Opening Form']);
    expect(res.scripts.map(s => s.scriptName)).toEqual([
      '[AI] Ẩn Opening Form',
      '[Style] Tô màu Tài nguyên (VP, AP, Veil Coin)',
      '[Render] Opening Form',
    ]);
  });

  it('nhiều script render thì giữ đúng thứ tự giữa chúng', () => {
    const bar = { ...RENDER, scriptName: '[Render] Status Bar', findRegex: '<StatusPlaceHolderImpl/>' };
    const res = reorderRenderScriptsLast([bar, RENDER, STYLE]);
    expect(res.scripts.map(s => s.scriptName)).toEqual([
      '[Style] Tô màu Tài nguyên (VP, AP, Veil Coin)',
      '[Render] Status Bar',
      '[Render] Opening Form',
    ]);
  });

  it('đã đúng thứ tự rồi thì không đụng vào (không đẻ diff vô nghĩa)', () => {
    const res = reorderRenderScriptsLast([HIDE, STYLE, RENDER]);
    expect(res.moved).toEqual([]);
    expect(res.scripts.map(s => s.scriptName)).toEqual([HIDE, STYLE, RENDER].map(s => s.scriptName));
  });

  it('script chỉ-cho-prompt đứng sau thì KHÔNG cần dời — nó không chạy ở luồng hiển thị', () => {
    // Chỉ cần render là script HIỂN THỊ cuối cùng; cái gì chỉ chạy ở luồng prompt thì đứng đâu
    // cũng không đụng tới code đã chèn. Dời nó chỉ đẻ ra diff vô nghĩa cho user.
    const res = reorderRenderScriptsLast([RENDER, HIDE]);
    expect(res.moved).toEqual([]);
    expect(res.scripts.map(s => s.scriptName)).toEqual(['[Render] Opening Form', '[AI] Ẩn Opening Form']);
  });
});
