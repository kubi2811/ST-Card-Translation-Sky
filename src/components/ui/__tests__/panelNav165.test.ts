/**
 * (bug 165) ĐIỀU HƯỚNG TỚI PANEL NẰM TRONG TAB.
 * ─────────────────────────────────────────────────────────────────────────────
 * Đây là chỗ dễ hỏng nhất của đợt đại tu, và hỏng thì hỏng IM LẶNG: trước khi bọc tab, mọi panel đều
 * mount cùng lúc nên `getElementById(id).scrollIntoView()` luôn chạy. Sau khi bọc, panel không active
 * KHÔNG CÓ trong DOM ⇒ getElementById trả null ⇒ nút "tới bước xuất thẻ" bấm không thấy gì xảy ra,
 * mà cũng chẳng có lỗi nào hiện ra. Bug 165 dặn đúng điều này phải giữ được.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onPanelRequest, requestPanel, jumpToAnchor } from '../panelNav';

describe('(bug 165) yêu cầu panel trước khi cuộn', () => {
  it('người đăng ký nhận đúng anchor id', () => {
    const seen: string[] = [];
    const off = onPanelRequest((id) => seen.push(id));
    requestPanel('verify-panel-anchor');
    requestPanel('export-panel-anchor');
    off();
    expect(seen).toEqual(['verify-panel-anchor', 'export-panel-anchor']);
  });

  it('gỡ đăng ký rồi thì không nhận nữa (không rò listener khi App unmount)', () => {
    const seen: string[] = [];
    const off = onPanelRequest((id) => seen.push(id));
    off();
    requestPanel('verify-panel-anchor');
    expect(seen).toEqual([]);
  });

  it('nhiều người đăng ký đều nhận được', () => {
    const a: string[] = []; const b: string[] = [];
    const offA = onPanelRequest((id) => a.push(id));
    const offB = onPanelRequest((id) => b.push(id));
    requestPanel('x');
    offA(); offB();
    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
  });
});

describe('(bug 165) jumpToAnchor: đổi tab XONG mới cuộn', () => {
  // Runner của repo dùng environment 'node' (không có DOM) và repo KHÔNG có jsdom. Thêm jsdom chỉ để
  // test mấy dòng này là không đáng — thứ cần kiểm ở đây là LUỒNG ĐIỀU KHIỂN của jumpToAnchor
  // (phát yêu cầu ngay → chờ frame → cuộn → dự phòng khi panel mount muộn), không phải hành vi DOM
  // thật. Nên dựng một `document` giả đúng bề mặt được dùng: getElementById + style + scrollIntoView.
  interface FakeEl { id: string; style: Record<string, string>; scrollIntoView: (o?: unknown) => void }
  let els: Map<string, FakeEl>;
  const addEl = (id: string, scrollIntoView: () => void): FakeEl => {
    const el: FakeEl = { id, style: {}, scrollIntoView };
    els.set(id, el);
    return el;
  };

  beforeEach(() => {
    els = new Map();
    vi.stubGlobal('document', { getElementById: (id: string) => els.get(id) ?? null });
    // LƯU Ý: vi.useFakeTimers() giả lập LUÔN requestAnimationFrame, nên KHÔNG tự stub rAF nữa —
    // stub riêng sẽ bị fake timers ghi đè và mọi phép chờ frame chạy vào mảng rỗng (đã mắc một lần).
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  /** Cho vài frame chạy qua (fake timers lo cả rAF). */
  const flushRaf = () => vi.advanceTimersByTime(64);

  it('phát yêu cầu panel NGAY, không đợi frame — App phải kịp đổi tab', () => {
    const seen: string[] = [];
    const off = onPanelRequest((id) => seen.push(id));
    jumpToAnchor('export-panel-anchor');
    // Chưa chạy frame nào mà yêu cầu đã tới: đây là điều kiện để React kịp mount trước lúc cuộn.
    expect(seen).toEqual(['export-panel-anchor']);
    off();
  });

  it('phần tử xuất hiện sau khi đổi tab → vẫn cuộn tới được', () => {
    const scrollIntoView = vi.fn();
    // Mô phỏng React mount panel khi tab đổi.
    const off = onPanelRequest((id) => { addEl(id, scrollIntoView); });
    jumpToAnchor('verify-panel-anchor');
    flushRaf();
    expect(scrollIntoView, 'không cuộn tới panel vừa được mount').toHaveBeenCalled();
    off();
  });

  it('chunk lazy về MUỘN (sau 2 frame) → vẫn cuộn được nhờ nhánh dự phòng', () => {
    const scrollIntoView = vi.fn();
    jumpToAnchor('export-panel-anchor');
    flushRaf();
    expect(scrollIntoView, 'chưa có phần tử thì chưa cuộn').not.toHaveBeenCalled();

    // Panel mount muộn — đúng ca chunk lazy chưa tải xong lúc bấm.
    addEl('export-panel-anchor', scrollIntoView);
    vi.advanceTimersByTime(300);
    expect(scrollIntoView, 'nhánh dự phòng phải bắt được panel mount muộn').toHaveBeenCalled();
  });

  it('panel không bao giờ xuất hiện → bỏ cuộc, KHÔNG treo timer vô hạn', () => {
    jumpToAnchor('khong-ton-tai');
    flushRaf();
    vi.advanceTimersByTime(10_000);
    // Không có gì để assert ngoài việc không ném lỗi và không còn timer nào chạy mãi.
    expect(vi.getTimerCount(), 'còn timer treo = rò rỉ').toBe(0);
  });
});
