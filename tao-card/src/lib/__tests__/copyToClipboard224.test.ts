/**
 * (bug 224) "Hầu hết các nút hiện nay không có tác dụng như nút copy trong schema."
 * ─────────────────────────────────────────────────────────────────────────────
 * Nút copy KHÔNG thiếu handler. Nó gọi `navigator.clipboard.writeText(...)` rồi NGAY dòng sau
 * đặt `setCopied(true)` — không await, không catch. Tạo Card chạy trong IFRAME của Hub mà iframe
 * không được cấp `allow="clipboard-write"`, nên API trả Promise BỊ TỪ CHỐI: clipboard trống trơn
 * mà nút vẫn hiện "Đã copy!". Tệ hơn "không có tác dụng" — nó BÁO LÀ ĐÃ LÀM.
 *
 * Test khoá hai điều: (1) có đường lùi execCommand chạy được trong iframe, (2) hỏng cả hai đường
 * thì phải trả false để UI nói thật, tuyệt đối không báo thành công giả.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, copyWithToast } from '../copyToClipboard';

const g = globalThis as unknown as Record<string, unknown>;
const def = (k: string, v: unknown) =>
  Object.defineProperty(g, k, { value: v, configurable: true, writable: true });

let execResult: boolean;
let execCalls: string[];
let appended: number;
let removed: number;

function installDom() {
  execResult = true;
  execCalls = [];
  appended = 0;
  removed = 0;
  def('document', {
    createElement: () => ({
      value: '', style: {}, setAttribute: () => {},
      select: () => {}, setSelectionRange: () => {},
    }),
    body: {
      appendChild: (el: { value: string }) => { appended++; (g.__last as unknown) = el; },
      removeChild: () => { removed++; },
    },
    execCommand: (cmd: string) => {
      execCalls.push(cmd);
      // Giá trị được nạp vào textarea trước khi execCommand chạy.
      return execResult;
    },
  });
}

beforeEach(installDom);
afterEach(() => { delete g.document; delete g.navigator; delete g.__last; });

describe('(bug 224) copyToClipboard', () => {
  it('Clipboard API chạy được ⇒ dùng nó, không cần đường lùi', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    def('navigator', { clipboard: { writeText } });
    const r = await copyToClipboard('nội dung');
    expect(r).toEqual({ ok: true, via: 'clipboard-api' });
    expect(writeText).toHaveBeenCalledWith('nội dung');
    expect(execCalls).toEqual([]);
  });

  it('ĐÚNG CA IFRAME: Clipboard API bị TỪ CHỐI ⇒ tự lùi về execCommand và VẪN copy được', async () => {
    def('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) } });
    const r = await copyToClipboard('code Zod');
    expect(r.ok).toBe(true);
    expect(r.via).toBe('exec-command');
    expect(execCalls).toEqual(['copy']);
    // Dọn sạch textarea tạm, không để rác trong DOM.
    expect(appended).toBe(1);
    expect(removed).toBe(1);
  });

  it('trình duyệt KHÔNG có Clipboard API ⇒ vẫn copy được qua execCommand', async () => {
    def('navigator', {});
    const r = await copyToClipboard('x');
    expect(r.ok).toBe(true);
    expect(r.via).toBe('exec-command');
  });

  it('HỎNG CẢ HAI ĐƯỜNG ⇒ trả false — không bao giờ báo thành công giả', async () => {
    def('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } });
    execResult = false;
    const r = await copyToClipboard('x');
    expect(r.ok).toBe(false);
    expect(r.via).toBe('none');
    expect(r.error).toBeTruthy();
  });

  it('chuỗi rỗng ⇒ không gọi API nào, trả false', async () => {
    const writeText = vi.fn();
    def('navigator', { clipboard: { writeText } });
    const r = await copyToClipboard('');
    expect(r.ok).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('execCommand ném ⇒ bắt gọn, không làm vỡ UI', async () => {
    def('navigator', {});
    def('document', { createElement: () => { throw new Error('DOM chết'); } });
    const r = await copyToClipboard('x');
    expect(r.ok).toBe(false);
  });
});

describe('(bug 224) copyWithToast nói ĐÚNG SỰ THẬT', () => {
  it('copy được ⇒ toast success có nêu số ký tự', async () => {
    def('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const toast = { success: vi.fn(), error: vi.fn() };
    const ok = await copyWithToast('12345', 'Zod code', toast);
    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Zod code'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('5'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('copy hỏng ⇒ toast error CÓ CHỈ CÁCH LÀM TAY, không im lặng', async () => {
    def('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } });
    execResult = false;
    const toast = { success: vi.fn(), error: vi.fn() };
    const ok = await copyWithToast('abc', 'YAML initvar', toast);
    expect(ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    const msg = toast.error.mock.calls[0][0] as string;
    expect(msg).toContain('YAML initvar');
    expect(msg).toMatch(/Ctrl\+A/);
  });
});
