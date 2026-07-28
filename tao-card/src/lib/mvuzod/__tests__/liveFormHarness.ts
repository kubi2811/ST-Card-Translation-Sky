// Harness DOM mô phỏng dùng chung cho các bài kiểm "live" của Opening Form —
// tách từ openingFormLive.test.ts (bug 117) khi Goal 28/07 cần chạy thêm JS cảnh báo mềm.
// Đủ cho selector mà JS của form dùng; KHÔNG phải DOM đầy đủ.

export interface FakeEl {
  id: string;
  tag: string;
  type: string;
  className: string;
  value: string;
  checked: boolean;
  textContent: string;
  innerHTML: string;
  attrs: Record<string, string>;
  /** (Goal 28/07) JS cảnh báo bật/tắt qua el.style.display. */
  style: Record<string, string>;
  getAttribute(n: string): string | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  select(): void;
  setSelectionRange(a: number, b: number): void;
}

export interface FakeDocument {
  getElementById(id: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
}

export function makeDom(html: string): { document: FakeDocument; els: FakeEl[] } {
  const els: FakeEl[] = [];
  const mk = (tag: string, id: string, type: string, className: string, attrs: Record<string, string>): FakeEl => {
    const el: FakeEl = {
      id, tag, type, className, attrs,
      value: attrs.value ?? '', checked: false, textContent: '', innerHTML: '',
      style: {},
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
  // (Goal 28/07) Div cảnh báo mềm `<div id="…-warn" …>` dưới ô nhập của trường phụ thuộc.
  for (const m of html.matchAll(/<div\b[^>]*\bid="([^"]*-warn)"[^>]*>/g)) {
    if (!els.some(e => e.id === m[1])) mk('div', m[1], '', '', {});
  }

  const document: FakeDocument = {
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
