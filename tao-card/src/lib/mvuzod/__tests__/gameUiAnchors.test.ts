// (User 21/07 — bug 72.3) "Giao diện Opening Form và Status Bar vẫn chưa hiện ra. Tui có xem
// thì mới bọc được ```html, chưa có ``` nằm cuối, cũng có thể do nó setting về Affects,
// Other Options, Macro in Find Regex, Ephemerality sai hoặc thiếu"
//
// 4 lỗi thật sự tìm được trong programmaticRegexBuilder (file Auto Creator thực sự gọi):
//   1. Opening Form dùng NHẦM mỏ neo của Status Bar → hai giao diện tranh nhau một chỗ bám
//   2. thiếu fence ``` đóng ở cuối khối HTML → ST không render
//   3. Ephemerality minDepth/maxDepth = 0 → form chỉ sống đúng lượt mới nhất rồi biến mất
//   4. Macro in Find Regex (substituteRegex) BẬT → ST chạy macro trên cả khối HTML/JS
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../regexAnchors';
import { normalizeMVUZODSchema } from '../normalizeSchema';

const FENCE = '`'.repeat(3);

// Schema PHẲNG — đúng dạng AI hay trả về (xem nestFlatSchema.test.ts)
const schema = normalizeMVUZODSchema({
  version: '1.0',
  fields: [
    { path: '/Nhân vật/Tên', type: 'string' },
    { path: '/Nhân vật/Cấp độ', type: 'number', constraints: { min: 1, max: 100 } },
    { path: '/Túi đồ/Vàng', type: 'number' },
  ],
});

const build = (component: 'opening_form' | 'status_bar' | 'full_set') =>
  buildProgrammaticRegex({ schema, component, gameName: 'Test Game' });

const isRender = (s: { promptOnly?: boolean; markdownOnly?: boolean }) => !(s.promptOnly && !s.markdownOnly);

describe('bug 72 — Game UI phải thật sự hiện được trong SillyTavern', () => {
  it('Opening Form bám mỏ neo RIÊNG, không giẫm lên Status Bar', () => {
    const render = build('opening_form').scripts.filter(isRender);
    expect(render).toHaveLength(1);
    expect(render[0].findRegex).toBe(OPENING_FORM_ANCHOR);
    expect(render[0].findRegex).not.toBe(STATUS_BAR_ANCHOR);
  });

  it('full_set: mỗi mỏ neo chỉ có ĐÚNG MỘT script render bám vào', () => {
    const render = build('full_set').scripts.filter(isRender);
    const anchors = render.map(s => s.findRegex);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors).toEqual(expect.arrayContaining([OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR]));
  });

  it('mỗi mỏ neo render đều có vế ẨN đi kèm (không lọt vào prompt gửi AI)', () => {
    const scripts = build('full_set').scripts;
    for (const anchor of [OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR]) {
      const hide = scripts.filter(s => s.findRegex === anchor && s.promptOnly && !s.markdownOnly);
      expect(hide, `thiếu vế ẩn cho ${anchor}`).toHaveLength(1);
    }
  });

  it('khối HTML mở fence thì PHẢI đóng fence (lỗi user tự soi ra)', () => {
    for (const c of ['opening_form', 'status_bar', 'full_set'] as const) {
      for (const s of build(c).scripts.filter(isRender)) {
        const rep = String(s.replaceString);
        if (!rep.startsWith(FENCE + 'html')) continue;
        expect(rep.endsWith(FENCE), `${c}/${s.scriptName} thiếu fence đóng`).toBe(true);
      }
    }
  });

  it('Ephemerality không ghim 0/0 — form phải sống qua nhiều lượt', () => {
    for (const s of build('full_set').scripts.filter(isRender)) {
      expect(s.minDepth ?? null, `${s.scriptName} minDepth`).toBeNull();
      expect(s.maxDepth ?? null, `${s.scriptName} maxDepth`).toBeNull();
    }
  });

  it('Macro in Find Regex phải TẮT trên script render (không đụng {{...}} trong HTML/JS)', () => {
    for (const s of build('full_set').scripts.filter(isRender)) {
      expect(s.substituteRegex, `${s.scriptName} substituteRegex`).toBe(0);
    }
  });

  it('schema phẳng vẫn dựng ra ô nhập (không còn form trống trơn)', () => {
    expect(build('opening_form').fieldsRendered).toBeGreaterThan(0);
  });
});
