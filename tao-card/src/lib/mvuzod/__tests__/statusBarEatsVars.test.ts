import { describe, it, expect } from 'vitest';
import { generateStatusBarSharedJS } from '../gameHtmlTemplates';

/**
 * (User 21/07 — việc 78) Test end-to-end cho lỗi "bảng không ăn biến".
 *
 * Bộ sinh code sinh ra lệnh dạng `stcsSetText('id', _.get(d, ['Cảnh Giới'], '—'))`.
 * `_.get` trả về CẢ CẶP ["Luyện Khí", "mô tả..."] vì MVU lưu biến kiểu đó.
 * Nếu stcsSetText in thẳng thì bảng hiện "Luyện Khí,cảnh giới tu luyện hiện tại".
 * Test này chạy THẬT đoạn JS được nhúng vào card, trên dữ liệu đúng định dạng MVU.
 */

/** Dựng DOM giả tối thiểu + chạy đoạn helper thật, trả về API để kiểm. */
function runHelpers() {
  const els = new Map<string, { textContent: string; style: Record<string, string> }>();
  const doc = {
    getElementById: (id: string) => {
      if (!els.has(id)) els.set(id, { textContent: '', style: {} });
      return els.get(id);
    },
    querySelectorAll: () => [] as unknown[],
  };
  const fn = new Function(
    'document',
    `${generateStatusBarSharedJS()}\nreturn { stcsSetText, stcsSetBar, mvuGet, mvuText, mvuNum };`,
  );
  const api = fn(doc) as {
    stcsSetText: (id: string, v: unknown, fb?: string) => void;
    stcsSetBar: (barId: string, valId: string, cur: unknown, max: unknown, suffix?: string) => void;
    mvuGet: (d: unknown, p: string, dflt?: unknown) => unknown;
  };
  return { api, els };
}

describe('bảng trạng thái ĂN ĐÚNG biến MVU (cặp [giá trị, mô tả])', () => {
  it('stcsSetText nhận CẶP → chỉ in giá trị, KHÔNG in kèm mô tả', () => {
    const { api, els } = runHelpers();
    // Đúng định dạng MVU thật: giá trị bọc trong mảng cùng phần mô tả.
    api.stcsSetText('canh-gioi', ['Luyện Khí Tầng 3', 'cảnh giới tu luyện hiện tại']);
    const out = els.get('canh-gioi')!.textContent;
    expect(out).toBe('Luyện Khí Tầng 3');
    expect(out).not.toContain('cảnh giới tu luyện');
  });

  it('stcsSetText nhận giá trị TRẦN → vẫn hoạt động như cũ', () => {
    const { api, els } = runHelpers();
    api.stcsSetText('x', 'Luyện Khí');
    expect(els.get('x')!.textContent).toBe('Luyện Khí');
  });

  it('stcsSetText nhận object (YAML parse lỗi) → KHÔNG in [object Object]', () => {
    const { api, els } = runHelpers();
    api.stcsSetText('y', { 'Tên': 'A', 'Tuổi': 20 });
    expect(els.get('y')!.textContent).not.toContain('[object Object]');
  });

  it('stcsSetBar nhận CẶP số → tính % đúng, không ra NaN', () => {
    const { api, els } = runHelpers();
    api.stcsSetBar('hp-bar', 'hp-val', [75, 'máu hiện tại'], [100, 'máu tối đa']);
    expect(els.get('hp-bar')!.style.width).toBe('75%');
    expect(els.get('hp-val')!.textContent).toBe('75/100');
    expect(els.get('hp-val')!.textContent).not.toContain('NaN');
  });

  it('thiếu biến → hiện dấu — thay vì undefined/NaN', () => {
    const { api, els } = runHelpers();
    api.stcsSetText('missing', undefined);
    expect(els.get('missing')!.textContent).toBe('—');
  });

  it('mvuGet đọc đúng đường dẫn lồng nhau có khoảng trắng, tự bóc cặp', () => {
    const { api } = runHelpers();
    const d = { 'Người Chơi': { 'Cảnh Giới': ['Trúc Cơ', 'mô tả'] } };
    expect(api.mvuGet(d, 'Người Chơi.Cảnh Giới', '—')).toBe('Trúc Cơ');
  });
});
