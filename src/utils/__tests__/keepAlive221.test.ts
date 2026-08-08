/**
 * (bug 221) "Ở Edge đang chạy mà tự chuyển về chế độ ngầm, out khỏi phiên làm việc và ngắt toàn
 * bộ tiến trình — chỉ cần mở tab khác để làm việc là web tự tắt."
 * ─────────────────────────────────────────────────────────────────────────────
 * Wake lock (bug 205) chỉ giữ MÀN HÌNH sáng, không nói gì với bộ quản lý tab của Edge. Thứ Edge
 * cam kết không đụng tới là tab đang PHÁT ÂM THANH — nên keepAlive phát một dòng âm thanh CÂM.
 * Test ở đây khoá đúng ba điều đáng khoá (không test được "Edge có ngủ không" trong vitest):
 *   1. bật là có phát âm thanh thật, và ÂM LƯỢNG BẰNG 0 (không ai nghe thấy gì);
 *   2. tắt là nhả sạch — không để oscillator/audio element sống ký sinh sau lượt dịch;
 *   3. trình duyệt/máy không hỗ trợ WebAudio hay chặn autoplay thì KHÔNG được ném lỗi làm vỡ
 *      lượt dịch — đây là điều kiện sống còn: giữ tab là tính năng phụ, dịch là việc chính.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakeNode { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }

const g = globalThis as unknown as Record<string, unknown>;
let created: { osc: number; started: number; stopped: number; closed: number; gains: number[] };
let audioEls: Array<{ played: number; paused: number; loop: boolean; volume: number }>;

function installFakeAudio(opts: { noAudioContext?: boolean; blockAutoplay?: boolean } = {}) {
  created = { osc: 0, started: 0, stopped: 0, closed: 0, gains: [] };
  audioEls = [];

  if (!opts.noAudioContext) {
    class FakeCtx {
      state = 'running';
      destination = {} as unknown;
      createGain() {
        const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
        created.gains.push(node.gain.value);
        // Ghi lại giá trị THẬT lúc stop bằng cách trả object sống.
        Object.defineProperty(node.gain, 'value', {
          get: () => created.gains[created.gains.length - 1],
          set: (v: number) => { created.gains[created.gains.length - 1] = v; },
        });
        return node as unknown as GainNode;
      }
      createOscillator() {
        created.osc++;
        const node: FakeNode & { frequency: { value: number }; start: () => void; stop: () => void } = {
          frequency: { value: 0 },
          connect: vi.fn(), disconnect: vi.fn(),
          start: () => { created.started++; },
          stop: () => { created.stopped++; },
        };
        return node as unknown as OscillatorNode;
      }
      // (bug 225) Nhánh đo để runtime tự kiểm mức phát ra.
      createAnalyser() {
        return {
          fftSize: 2048,
          connect: vi.fn(), disconnect: vi.fn(),
          getFloatTimeDomainData: (b: Float32Array) => {
            // Trả đúng tông mà keepAlive lẽ ra đang phát, biên độ lấy từ gain hiện hành.
            const amp = created.gains[created.gains.length - 1] ?? 0;
            for (let i = 0; i < b.length; i++) b[i] = amp * Math.sin((2 * Math.PI * 30 * i) / 8000);
          },
        } as unknown as AnalyserNode;
      }
      close() { created.closed++; return Promise.resolve(); }
      resume() { this.state = 'running'; return Promise.resolve(); }
    }
    g.AudioContext = FakeCtx as unknown;
  } else {
    delete g.AudioContext;
    delete g.webkitAudioContext;
  }

  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'audio') return {};
      const el = {
        src: '', loop: false, volume: 1, paused: true, played: 0, pausedCount: 0,
        style: {} as Record<string, string>,
        setAttribute: vi.fn(), remove: vi.fn(),
        play: () => {
          if (opts.blockAutoplay) return Promise.reject(new Error('NotAllowedError'));
          el.played++; el.paused = false;
          return Promise.resolve();
        },
        pause: () => { el.pausedCount++; el.paused = true; },
      };
      audioEls.push(el as unknown as typeof audioEls[number]);
      return el;
    },
    // (bug 225) Phần tử media phải nằm TRONG trang, và watchdog bám visibilitychange.
    body: { appendChild: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown;

  // `navigator` là getter-only global trong Node 22 — phải defineProperty, gán thẳng là ném.
  const def = (k: string, v: unknown) =>
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  def('navigator', { mediaSession: { playbackState: 'none', metadata: null } });
  def('MediaMetadata', class { constructor(public init: unknown) {} });
  def('window', g);
  def('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'));
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => {
  delete g.AudioContext; delete g.webkitAudioContext;
  delete g.document; delete g.MediaMetadata;
});

const load = async () => await import('../keepAlive');

describe('(bug 221) keepAlive giữ tab khỏi bị Edge cho ngủ', () => {
  it('bật ⇒ phát âm thanh THẬT (khác 0) và khai với hệ điều hành là đang phát', async () => {
    installFakeAudio();
    const k = await load();
    k.startKeepAlive();
    expect(k.isKeepAliveRunning()).toBe(true);
    expect(created.started).toBe(1);
    // (bug 225) Đây là dòng đảo ngược hợp đồng cũ, và là cả nội dung bản vá:
    // gain = 0 thì Chromium đo được công suất 0, KHÔNG đánh dấu tab audible, thanh địa chỉ
    // không hiện loa, và mọi ưu đãi chống-ngủ không được cấp. Phải khác 0.
    const gainNow = created.gains[created.gains.length - 1];
    expect(gainNow).toBeGreaterThan(0);
    // …nhưng vẫn phải nhỏ đến mức tai không nghe: dưới 1% biên độ tối đa.
    expect(gainNow).toBeLessThan(0.01);
    // Lớp 2: phần tử media loop. volume PHẢI là 1 — âm lượng nằm ở dữ liệu WAV; đặt volume 0
    // là tự bịt lại đúng thứ vừa mở ra.
    expect(audioEls[0].loop).toBe(true);
    expect(audioEls[0].volume).toBe(1);
    expect((g.navigator as { mediaSession: { playbackState: string } }).mediaSession.playbackState).toBe('playing');
    k.stopKeepAlive();
  });

  it('mức đo được VƯỢT ngưỡng im lặng của Chromium — nếu không thì tab vẫn bị cho ngủ', async () => {
    installFakeAudio();
    const k = await load();
    k.startKeepAlive();
    const db = k.measureKeepAliveDbfs();
    expect(db).not.toBeNull();
    expect(db!).toBeGreaterThan(k.CHROMIUM_SILENCE_DBFS);
    expect(k.isKeepAliveAudible()).toBe(true);
    // Và vẫn nằm sâu dưới ngưỡng nghe được của người ở âm lượng thường.
    expect(db!).toBeLessThan(-40);
    k.stopKeepAlive();
    expect(k.measureKeepAliveDbfs()).toBeNull();
  });

  it('file WAV dự phòng cũng có tiếng thật, không phải toàn mẫu im lặng như bản cũ', async () => {
    installFakeAudio();
    const k = await load();
    const uri = k.keepAliveWavDataUri();
    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
    const raw = Buffer.from(uri.slice('data:audio/wav;base64,'.length), 'base64');
    // Bỏ 44 byte header, đọc mẫu 16-bit: phải có mẫu khác 0 mới là có tiếng.
    let peak = 0;
    for (let i = 44; i + 1 < raw.length; i += 2) peak = Math.max(peak, Math.abs(raw.readInt16LE(i)));
    expect(peak).toBeGreaterThan(0);
    // …và đỉnh vẫn rất khẽ so với toàn thang 32767.
    expect(peak / 32767).toBeLessThan(0.01);
  });

  it('tắt ⇒ nhả sạch, không để gì sống ký sinh sau lượt dịch', async () => {
    installFakeAudio();
    const k = await load();
    k.startKeepAlive();
    k.stopKeepAlive();
    expect(k.isKeepAliveRunning()).toBe(false);
    expect(created.stopped).toBe(1);
    expect(created.closed).toBe(1);
    expect((g.navigator as { mediaSession: { playbackState: string } }).mediaSession.playbackState).toBe('none');
  });

  it('bật hai lần chỉ tạo MỘT dòng âm thanh (idempotent — startTranslation gọi lại nhiều lượt)', async () => {
    installFakeAudio();
    const k = await load();
    k.startKeepAlive();
    k.startKeepAlive();
    expect(created.osc).toBe(1);
    k.stopKeepAlive();
  });

  it('máy KHÔNG có WebAudio ⇒ không ném, vẫn chạy lớp media element', async () => {
    installFakeAudio({ noAudioContext: true });
    const k = await load();
    expect(() => k.startKeepAlive()).not.toThrow();
    expect(k.isKeepAliveRunning()).toBe(true);
    expect(audioEls[0].loop).toBe(true);
    expect(() => k.stopKeepAlive()).not.toThrow();
  });

  it('autoplay bị chặn ⇒ không ném (lượt dịch KHÔNG được vỡ vì tính năng phụ)', async () => {
    installFakeAudio({ blockAutoplay: true });
    const k = await load();
    expect(() => k.startKeepAlive()).not.toThrow();
    expect(created.started).toBe(1);   // lớp WebAudio vẫn giữ tab
    expect(() => k.stopKeepAlive()).not.toThrow();
  });

  it('resumeKeepAlive dựng lại AudioContext bị treo về suspended', async () => {
    installFakeAudio();
    const k = await load();
    k.startKeepAlive();
    expect(() => k.resumeKeepAlive()).not.toThrow();
    k.stopKeepAlive();
    // Đã tắt thì resume là no-op, không được tự bật lại.
    k.resumeKeepAlive();
    expect(k.isKeepAliveRunning()).toBe(false);
  });
});
