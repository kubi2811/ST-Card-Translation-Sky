// (bug 117) VERIFY "LIVE": chạy TOÀN BỘ chuỗi JS thật mà builder nhúng vào card — sharedJS +
// submitJS — trên DOM mô phỏng, điền form thật, bấm Xác nhận thật, kiểm biến được ghi thật.
// Đây là bài kiểm CHẤP NHẬN cho cả chuỗi 114 + 116: id khớp, thu đủ input, hàm nào gọi cũng
// tồn tại (không ReferenceError), ghi đúng payload/scope, trang kết quả + hồ sơ + copy hoạt động.
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
// (Goal 28/07) DOM mô phỏng tách ra harness dùng chung — statRelationsLive.test.ts cũng dùng.
import { makeDom } from './liveFormHarness';
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
