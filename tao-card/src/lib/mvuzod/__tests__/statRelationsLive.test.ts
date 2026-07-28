// (Goal 28/07) RÀNG BUỘC MỀM giữa các chỉ số liên quan — chạy THẬT chuỗi JS builder nhúng
// vào Opening Form trên DOM mô phỏng. Kiểm đúng các lời hứa với user:
//   1. Trường phụ thuộc là Ô NHẬP SỐ TỰ DO (không slider trần cứng) dù schema có max.
//   2. Nhập lệch mốc lore → cảnh báo hiện KÈM CĂN CỨ; trong khoảng → ẩn.
//   3. Giá trị neo không khớp mốc nào → im lặng (không bịa).
//   4. Xác nhận KHÔNG BAO GIỜ bị chặn — giá trị "vô lý" user cố ý giữ vẫn được ghi nguyên vẹn.
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import { makeDom, type FakeEl } from './liveFormHarness';

// Schema kiểu thế giới tu tiên: Cảnh giới (enum) ↔ Linh lực (số), do "AI" sinh kèm statRelations.
// Linh lực cố tình mang max: 100 — normalize phải GỠ trần vì nó là trường phụ thuộc.
const RAW_SCHEMA = {
  version: '1.0',
  fields: [
    {
      path: '/Nhân vật', type: 'object', label: 'Nhân vật', defaultValue: {}, constraints: {},
      children: [
        { path: '/Nhân vật/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
        {
          path: '/Nhân vật/Cảnh giới', type: 'string', label: 'Cảnh giới', defaultValue: 'Luyện Khí',
          constraints: { enumValues: ['Luyện Khí', 'Trúc Cơ', 'Kim Đan'] },
        },
        { path: '/Nhân vật/Linh lực', type: 'number', label: 'Linh lực', defaultValue: 50, constraints: { min: 0, max: 100 } },
      ],
    },
  ],
  statRelations: [
    {
      anchorPath: '/Nhân vật/Cảnh giới',
      dependentPath: '/Nhân vật/Linh lực',
      basis: 'theo mô tả cảnh giới trong World Book, Luyện Khí chỉ mới dẫn khí nhập thể',
      landmarks: [
        { anchor: 'Luyện Khí', plausibleMin: 10, plausibleMax: 500, note: 'lore tả Luyện Khí viên mãn cũng chỉ ~500 linh lực' },
        { anchor: 'Trúc Cơ', plausibleMin: 400, plausibleMax: 3000 },
        // Kim Đan: lore KHÔNG mô tả mức linh lực → không có mốc — không được bịa.
      ],
    },
  ],
};

function runForm() {
  const schema = normalizeMVUZODSchema(RAW_SCHEMA);
  const r = buildProgrammaticRegex({ schema, component: 'opening_form', gameName: 'Tu Tiên Test' });
  const render = r.scripts.find(s => (s as { markdownOnly?: boolean }).markdownOnly && String(s.replaceString || '').includes('<!DOCTYPE'));
  const full = String(render!.replaceString);
  const js = (full.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1];
  expect(js, 'không bóc được khối JS').toBeTruthy();

  const { document, els } = makeDom(full);
  const written: { payload?: unknown; opts?: unknown } = {};
  const win: Record<string, unknown> = { parent: {} };
  const fn = new Function('document', 'window', 'navigator', 'console', 'insertOrAssignVariables', 'setTimeout', js!);
  fn(
    document, win, {},
    { log: () => {}, warn: () => {}, error: () => {} },
    (payload: unknown, o: unknown) => { written.payload = payload; written.opts = o; return Promise.resolve(); },
    (f: () => void) => { f(); return 0; },
  );
  const linhLuc = els.find(e => e.tag === 'input' && e.id.includes('linh-l') && e.id.endsWith('-slider'))
    ?? els.find(e => e.tag === 'input' && e.type === 'number');
  const warn = els.find(e => e.id.endsWith('-warn'));
  const realmCards = els.filter(e => e.attrs['data-grid'] && e.attrs['data-grid'].endsWith('-cards'));
  return { els, win, written, linhLuc, warn, realmCards };
}

function pickRealm(win: Record<string, unknown>, realmCards: FakeEl[], value: string) {
  const card = realmCards.find(c => c.attrs['data-value'] === value)!;
  expect(card, `phải có thẻ cảnh giới ${value}`).toBeTruthy();
  (win.selectCard as (c: unknown, g: string) => void)(card, card.attrs['data-grid']);
}

describe('(Goal 28/07) ràng buộc mềm giữa chỉ số liên quan — chạy JS thật của form', () => {
  it('trường phụ thuộc render là Ô NHẬP SỐ tự do (không slider), dù schema khai max', () => {
    const { linhLuc } = runForm();
    expect(linhLuc, 'phải có ô nhập Linh lực').toBeTruthy();
    expect(linhLuc!.type).toBe('number');
    // normalize đã gỡ trần của trường phụ thuộc → không còn max kẹp giá trị
    const schema = normalizeMVUZODSchema(RAW_SCHEMA);
    const dep = schema.fields[0].children!.find(f => f.path.includes('Linh lực'))!;
    expect(dep.constraints.max).toBeUndefined();
    expect(dep.constraints.min).toBe(0);
  });

  it('nhập 99999 ở Luyện Khí → cảnh báo hiện KÈM CĂN CỨ lore + khoảng thường thấy', () => {
    const { win, linhLuc, warn } = runForm();
    linhLuc!.value = '99999';
    (win.stcsRelationCheck as () => void)();
    expect(warn!.style.display).toBe('block');
    expect(warn!.innerHTML).toContain('99999');
    expect(warn!.innerHTML).toContain('cao bất thường');
    expect(warn!.innerHTML).toContain('lore tả Luyện Khí viên mãn cũng chỉ ~500 linh lực');
    expect(warn!.innerHTML).toContain('10–500');
    expect(warn!.innerHTML).toContain('giữ nguyên');
  });

  it('giá trị trong khoảng mốc → không cảnh báo; mốc không có note → dùng basis làm căn cứ', () => {
    const { win, linhLuc, warn, realmCards } = runForm();
    linhLuc!.value = '300';
    (win.stcsRelationCheck as () => void)();
    expect(warn!.style.display).toBe('none');

    // Trúc Cơ (mốc không note): 50 là quá thấp → cảnh báo dùng basis của relation
    pickRealm(win, realmCards, 'Trúc Cơ');
    linhLuc!.value = '50';
    (win.stcsRelationCheck as () => void)();
    expect(warn!.style.display).toBe('block');
    expect(warn!.innerHTML).toContain('thấp bất thường');
    expect(warn!.innerHTML).toContain('theo mô tả cảnh giới trong World Book');
  });

  it('neo không khớp mốc nào (Kim Đan — lore không tả) → IM LẶNG, không bịa cảnh báo', () => {
    const { win, linhLuc, warn, realmCards } = runForm();
    pickRealm(win, realmCards, 'Kim Đan');
    linhLuc!.value = '99999';
    (win.stcsRelationCheck as () => void)();
    expect(warn!.style.display).toBe('none');
    expect(warn!.innerHTML).toBe('');
  });

  it('cảnh báo KHÔNG chặn: Xác nhận vẫn ghi nguyên giá trị 99999 user cố ý giữ', async () => {
    const { win, linhLuc, written } = runForm();
    linhLuc!.value = '99999';
    (win.stcsRelationCheck as () => void)();
    (win.onConfirm as () => void)();
    await new Promise(r => setTimeout(r, 0));
    const p = written.payload as { stat_data: Record<string, Record<string, unknown>> };
    expect(p, 'insertOrAssignVariables phải được gọi dù đang có cảnh báo').toBeTruthy();
    expect(p.stat_data['Nhân vật']['Linh lực']).toBe(99999);
    expect(written.opts).toEqual({ type: 'message', message_id: 'latest' });
  });

  it('vào trang Tổng kết → cảnh báo (kèm căn cứ) được nối dưới bảng, nút Xác nhận vẫn hoạt động', () => {
    const { win, els, linhLuc } = runForm();
    linhLuc!.value = '99999';
    const totalPages = els.filter(e => /^stcs-page-\d+$/.test(e.id)).length;
    (win.goToPage as (n: number) => void)(totalPages - 2);
    const tbl = els.find(e => e.id === 'stcs-summary-table')!;
    expect(tbl.innerHTML).toContain('cao bất thường');
    expect(tbl.innerHTML).toContain('lore tả Luyện Khí viên mãn');
  });

  it('schema KHÔNG có statRelations → form không nhúng JS cảnh báo, không warn div', () => {
    const schema = normalizeMVUZODSchema({ ...RAW_SCHEMA, statRelations: [] });
    const r = buildProgrammaticRegex({ schema, component: 'opening_form', gameName: 'X' });
    const render = r.scripts.find(s => (s as { markdownOnly?: boolean }).markdownOnly && String(s.replaceString || '').includes('<!DOCTYPE'));
    const full = String(render!.replaceString);
    expect(full).not.toContain('STCS_RELATIONS');
    expect(full).not.toContain('-slider-warn');
  });
});
