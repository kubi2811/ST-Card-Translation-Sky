// (bug 117) VERIFY "LIVE": chạy TOÀN BỘ chuỗi JS thật mà builder nhúng vào card — sharedJS +
// submitJS — trên DOM mô phỏng, điền form thật, bấm Xác nhận thật, kiểm biến được ghi thật.
// Đây là bài kiểm CHẤP NHẬN cho cả chuỗi 114 + 116: id khớp, thu đủ input, hàm nào gọi cũng
// tồn tại (không ReferenceError), ghi đúng payload/scope, trang kết quả + hồ sơ + copy hoạt động.
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: 'Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        { path: 'Người Chơi/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
        { path: 'Người Chơi/HP', type: 'number', label: 'HP', defaultValue: 100, constraints: { min: 0, max: 100 } },
        { path: 'Người Chơi/Phả Hệ', type: 'string', label: 'Phả Hệ', defaultValue: 'Ignis', constraints: { enumValues: ['Ignis', 'Glacis'] } },
        { path: 'Người Chơi/Đã Thức Tỉnh', type: 'boolean', label: 'Đã Thức Tỉnh', defaultValue: false, constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

/* ─── DOM mô phỏng tối thiểu — đủ cho selector mà JS của form dùng ─── */
interface FakeEl {
  id: string;
  tag: string;
  type: string;
  className: string;
  value: string;
  checked: boolean;
  textContent: string;
  innerHTML: string;
  attrs: Record<string, string>;
  getAttribute(n: string): string | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  select(): void;
  setSelectionRange(a: number, b: number): void;
}

function makeDom(html: string) {
  const els: FakeEl[] = [];
  const mk = (tag: string, id: string, type: string, className: string, attrs: Record<string, string>): FakeEl => {
    const el: FakeEl = {
      id, tag, type, className, attrs,
      value: attrs.value ?? '', checked: false, textContent: '', innerHTML: '',
      getAttribute: (n) => attrs[n] ?? null,
      querySelector: (sel) => el.querySelectorAll(sel)[0] ?? null,
      querySelectorAll: (sel) => {
        // grid.querySelectorAll('.stcs-card') — selectCard bỏ 'selected' của mọi thẻ trong grid
        if (sel === '.stcs-card') {
          return els.filter(e => e.attrs['data-grid'] === el.id);
        }
        // grid.querySelector('.stcs-card.selected') — collectFormData đọc thẻ đang chọn
        if (sel === '.stcs-card.selected') {
          return els.filter(e => e.attrs['data-grid'] === el.id && e.classList.contains('selected'));
        }
        return [];
      },
      classList: {
        add: (c) => { if (!el.className.includes(c)) el.className += ' ' + c; },
        remove: (c) => { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); },
        contains: (c) => el.className.split(/\s+/).includes(c),
      },
      select: () => {}, setSelectionRange: () => {},
    };
    els.push(el);
    return el;
  };

  // Bóc input/textarea/select-card/grid/page/textarea-kết-quả từ HTML thật của builder
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const tagHtml = m[0];
    const attr = (n: string) => (tagHtml.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] ?? '';
    mk('input', attr('id'), attr('type') || 'text', attr('class'), { value: attr('value') });
  }
  for (const m of html.matchAll(/<textarea\b[^>]*>/g)) {
    const attr = (n: string) => (m[0].match(new RegExp(`${n}="([^"]*)"`)) || [])[1] ?? '';
    mk('textarea', attr('id'), 'textarea', attr('class'), {});
  }
  for (const m of html.matchAll(/<div class="stcs-card-grid" id="([^"]+)">([\s\S]*?)<\/div>\s*(?=<div class="stcs-btn-row"|<div class="stcs-page)/g)) {
    const gridId = m[1];
    const grid = mk('div', gridId, '', 'stcs-card-grid', {});
    for (const c of m[2].matchAll(/<div class="(stcs-card[^"]*)" data-value="([^"]*)"/g)) {
      mk('div', '', '', c[1], { 'data-value': c[2], 'data-grid': gridId });
    }
    void grid;
  }
  for (const m of html.matchAll(/<div class="(stcs-page[^"]*)" id="(stcs-page-\d+)"/g)) {
    mk('div', m[2], '', m[1], {});
  }
  for (const m of html.matchAll(/<(div|td|table|span|button)\b[^>]*\bid="(stcs-(?:result-status|out-text|copy-btn|summary-table))"[^>]*>/g)) {
    if (!els.some(e => e.id === m[2])) mk(m[1], m[2], '', '', {});
  }

  const document = {
    getElementById: (id: string) => els.find(e => e.id === id) ?? null,
    querySelectorAll: (sel: string) => {
      if (sel.includes('input[type=text]')) return els.filter(e => e.tag === 'input' && ['text', 'number', 'range'].includes(e.type));
      if (sel === '#stcs-app textarea') return els.filter(e => e.tag === 'textarea');
      if (sel.includes('checkbox')) return els.filter(e => e.type === 'checkbox');
      if (sel.includes('.stcs-card-grid')) return els.filter(e => e.className.includes('stcs-card-grid'));
      if (sel === '.stcs-page') return els.filter(e => e.className.includes('stcs-page') && !e.className.includes('page-title') && !e.className.includes('page-desc'));
      if (sel === '.stcs-step-dot') return [];
      return [];
    },
  };
  return { document, els };
}

/** Dựng form thật rồi chạy TOÀN BỘ JS của nó trong sandbox. */
function runLiveForm(opts: { scenarios?: Array<{ title: string; desc: string }> } = {}) {
  const r = buildProgrammaticRegex({
    schema: SCHEMA, component: 'opening_form', gameName: 'Verify 116', scenarios: opts.scenarios,
  });
  const render = r.scripts.find(s => (s as { markdownOnly?: boolean }).markdownOnly && String(s.replaceString || '').includes('<!DOCTYPE'));
  const full = String(render!.replaceString);
  const js = (full.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1];
  expect(js, 'không bóc được khối JS').toBeTruthy();

  const { document, els } = makeDom(full);
  const written: { payload?: unknown; opts?: unknown } = {};
  const windowObj: Record<string, unknown> = { parent: {} };
  const sandbox = {
    document,
    window: windowObj,
    navigator: {},
    console: { log: () => {}, warn: () => {}, error: (...a: unknown[]) => { sandbox.__errors.push(a.join(' ')); } },
    __errors: [] as string[],
    insertOrAssignVariables: (payload: unknown, o: unknown) => { written.payload = payload; written.opts = o; return Promise.resolve(); },
    setTimeout: (fn: () => void) => { fn(); return 0; },
  };
  const fn = new Function('document', 'window', 'navigator', 'console', 'insertOrAssignVariables', 'setTimeout', js!);
  fn(sandbox.document, sandbox.window, sandbox.navigator, sandbox.console, sandbox.insertOrAssignVariables, sandbox.setTimeout);
  // Hàm được export lên window (bug 75) — lấy từ đó để "bấm nút"
  return { written, els, win: windowObj, errors: sandbox.__errors };
}

describe('(bug 117) chạy THẬT chuỗi JS của form — điền, bấm Xác nhận, biến phải được ghi', () => {
  it('JS của form chạy không nổ ReferenceError, mọi handler được export lên window', async () => {
    const { win } = runLiveForm();
    for (const fn of ['goToPage', 'onConfirm', 'selectCard', 'copyProfileText']) {
      expect(typeof win[fn], `window.${fn} phải là function`).toBe('function');
    }
  });

  it('điền form → bấm Xác nhận → insertOrAssignVariables nhận ĐÚNG payload message-scoped', async () => {
    const { written, els, win } = runLiveForm();
    // Điền như người chơi thật
    const nameInput = els.find(e => e.id.endsWith('-input') && e.tag === 'input');
    expect(nameInput, 'phải có ô nhập tên').toBeTruthy();
    nameInput!.value = 'Luffy';
    const hpSlider = els.find(e => e.id.endsWith('-slider'));
    if (hpSlider) hpSlider.value = '75';
    const check = els.find(e => e.type === 'checkbox');
    if (check) check.checked = true;

    (win.onConfirm as () => void)();
    await new Promise(r => setTimeout(r, 0));

    expect(written.payload, 'insertOrAssignVariables phải được gọi').toBeTruthy();
    const p = written.payload as { stat_data: Record<string, Record<string, unknown>> };
    expect(p.stat_data).toBeTruthy();
    expect(p.stat_data['Người Chơi']['Tên']).toBe('Luffy');
    expect(p.stat_data['Người Chơi']['HP']).toBe(75);
    expect(p.stat_data['Người Chơi']['Đã Thức Tỉnh']).toBe(true);
    expect(written.opts).toEqual({ type: 'message', message_id: 'latest' });
  });

  it('sau ghi thành công → trang kết quả hiện "Đã ghi thành công biến MVU" + hồ sơ + đủ dữ liệu đã nhập', async () => {
    const { els, win } = runLiveForm();
    els.find(e => e.id.endsWith('-input') && e.tag === 'input')!.value = 'Zoro';
    (win.onConfirm as () => void)();
    await new Promise(r => setTimeout(r, 0));

    const status = els.find(e => e.id === 'stcs-result-status');
    expect(status!.innerHTML).toContain('Đã ghi thành công biến MVU');
    const out = els.find(e => e.id === 'stcs-out-text');
    expect(out!.value).toContain('Zoro');
    expect(out!.value).toContain('Hồ sơ khởi đầu');
  });

  it('có scenarios → chọn bối cảnh trong lưới thẻ → hồ sơ chứa bối cảnh đã chọn', async () => {
    const { els, win } = runLiveForm({
      scenarios: [
        { title: 'Tân binh nhập môn', desc: 'Bắt đầu tại sơn môn.' },
        { title: 'Kẻ lưu vong', desc: 'Mở màn nơi biên ải.' },
      ],
    });
    els.find(e => e.id.endsWith('-input') && e.tag === 'input')!.value = 'Nami';
    // Chọn thẻ bối cảnh thứ 2 như người chơi bấm
    const card2 = els.filter(e => e.attrs['data-grid'] === 'stcs-scenario-cards')[1];
    expect(card2, 'phải có thẻ bối cảnh thứ 2').toBeTruthy();
    (win.selectCard as (c: unknown, g: string) => void)(card2, 'stcs-scenario-cards');

    (win.onConfirm as () => void)();
    await new Promise(r => setTimeout(r, 0));
    const out = els.find(e => e.id === 'stcs-out-text');
    expect(out!.value).toContain('Kẻ lưu vong');
    expect(out!.value).toContain('Bối cảnh bắt đầu');
  });

  it('KHÔNG có API ghi biến → báo rõ trên trang kết quả, hồ sơ vẫn copy được (không im lặng)', async () => {
    const r = buildProgrammaticRegex({ schema: SCHEMA, component: 'opening_form', gameName: 'X' });
    const render = r.scripts.find(s => (s as { markdownOnly?: boolean }).markdownOnly && String(s.replaceString || '').includes('<!DOCTYPE'));
    const js = (String(render!.replaceString).match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1];
    const { document, els } = makeDom(String(render!.replaceString));
    const win: Record<string, unknown> = { parent: {} };
    // KHÔNG truyền insertOrAssignVariables
    const fn = new Function('document', 'window', 'navigator', 'console', 'setTimeout', js!);
    fn(document, win, {}, { log: () => {}, warn: () => {}, error: () => {} }, (f: () => void) => { f(); return 0; });
    els.find(e => e.id.endsWith('-input') && e.tag === 'input')!.value = 'Sanji';
    (win.onConfirm as () => void)();
    await new Promise(r2 => setTimeout(r2, 0));
    const status = els.find(e => e.id === 'stcs-result-status');
    expect(status!.innerHTML).toContain('Chưa ghi được biến MVU');
    expect(els.find(e => e.id === 'stcs-out-text')!.value).toContain('Sanji');
  });
});
