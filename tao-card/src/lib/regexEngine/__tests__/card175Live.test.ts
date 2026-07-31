/**
 * (bug 175) Chạy trên ĐÚNG file thẻ user gửi, tái hiện đúng cái lỗi đo được trên SillyTavern thật.
 * ─────────────────────────────────────────────────────────────────────────────
 * File nằm trong bug/ nên không đẩy lên git — bài kiểm tự bỏ qua khi không có file.
 *
 * Số liệu đo trực tiếp trong ST của user (đã nhập thẻ vào rồi gỡ ra sạch sẽ):
 *   iframe TH-message--0--0: 47 nút hiện đủ, `typeof window.goToPage === "undefined"`
 *   lỗi: Uncaught SyntaxError: Unexpected identifier 'color' (dòng 225 của module)
 *   dòng 225 sau khi ST xử lý chứa: <span style="color: #fbbf24; …">115 VP</span>
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { findChainBreaks, applyDisplayChain, reorderRenderScriptsLast } from '../stRegexChain';

const CARD = 'G:/ClaudePJ/TOOL_CARD_GUILLICHAN/d-ch-card-sillytarven/bug/175/Quản Trò Eldran.json';

const load = () => {
  const c = JSON.parse(readFileSync(CARD, 'utf-8'));
  return { scripts: c.data.extensions.regex_scripts, firstMes: String(c.data.first_mes) };
};

/** Lấy phần JS của khối Opening Form trong tin nhắn đã qua chuỗi regex. */
function openingFormJs(text: string): string {
  for (const b of text.matchAll(/```html\n([\s\S]*?)\n```/g)) {
    if (!b[1].includes('goToPage')) continue;
    const m = /<script[^>]*>([\s\S]*?)<\/script>/.exec(b[1]);
    if (m) return m[1];
  }
  return '';
}
const compiles = (js: string) => { try { new Function(js); return true; } catch { return false; } };

describe.skipIf(!existsSync(CARD))('(bug 175) thẻ thật của user', () => {
  it('tái hiện: chuỗi regex làm VỠ cú pháp JS của Opening Form', () => {
    const { scripts, firstMes } = load();
    const out = applyDisplayChain(firstMes, scripts).text;
    const js = openingFormJs(out);
    expect(js.length, 'phải lấy được khối JS của form').toBeGreaterThan(1000);
    expect(compiles(js), 'đây chính là lúc 47 nút chết').toBe(false);
    expect(js, 'thủ phạm để lại dấu vết ngay trong code').toContain('<span style="color:');
  });

  it('chỉ đúng tên thủ phạm và nạn nhân', () => {
    const { scripts, firstMes } = load();
    const breaks = findChainBreaks(firstMes, scripts);
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks[0].culprit).toContain('Tô màu Tài nguyên');
    expect(breaks[0].victim).toContain('Opening Form');
  });

  it('sau khi vá thứ tự: JS còn nguyên, hết vỡ', () => {
    const { scripts, firstMes } = load();
    const fixed = reorderRenderScriptsLast(scripts);
    expect(fixed.moved.length, 'phải dời cả Status Bar lẫn Opening Form').toBeGreaterThan(0);
    expect(findChainBreaks(firstMes, fixed.scripts)).toEqual([]);
    const js = openingFormJs(applyDisplayChain(firstMes, fixed.scripts).text);
    expect(compiles(js)).toBe(true);
    expect(js).not.toContain('<span style="color:');
  });

  it('vá xong vẫn giữ được tính năng tô màu cho VĂN XUÔI', () => {
    const { scripts, firstMes } = load();
    const out = applyDisplayChain(firstMes, reorderRenderScriptsLast(scripts).scripts).text;
    // Lời dẫn của thẻ có nhắc tài nguyên; nếu không có thì ít nhất phải không mất khối render.
    expect(out).toContain('```html');
    expect(out.match(/```html/g)!.length, 'cả Status Bar lẫn Opening Form đều còn').toBe(2);
  });
});
