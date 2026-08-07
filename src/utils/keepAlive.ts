/**
 * src/utils/keepAlive.ts — (bug 221) GIỮ TAB SỐNG SUỐT LƯỢT DỊCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "ở Edge thì đang chạy mà tự chuyển về chế độ ngầm, out khỏi phiên làm việc và ngắt
 * toàn bộ tiến trình… chỉ cần mở tab khác để làm việc là web tự tắt."
 *
 * Đó là hai tính năng KHÁC NHAU của Edge, và wake lock (bug 205) không chặn được cái nào:
 *   • Sleeping tabs — tab nền không tương tác quá X phút bị "đóng băng": mọi timer, promise,
 *     fetch đang bay đứng lại. Đây là thứ làm tiến trình dịch chết lặng.
 *   • Memory saver / tab discard — nặng hơn: tab bị GIẢI PHÓNG hẳn, quay lại là trang tải lại
 *     từ đầu (đúng cảm giác "out khỏi phiên làm việc").
 * Wake lock chỉ giữ MÀN HÌNH không tắt, không nói gì với bộ quản lý tab.
 *
 * Điều Edge/Chrome CAM KẾT không đụng tới: tab đang PHÁT ÂM THANH. Tab "audible" bị loại khỏi
 * cả sleeping tabs lẫn discard — đó là lý do người ta để YouTube chạy nền thì tab không ngủ.
 * Nên ở đây phát một dòng âm thanh CÂM (gain = 0) suốt lượt dịch: người dùng không nghe gì,
 * hệ điều hành và trình duyệt thì thấy tab đang phát nhạc.
 *
 * Ba lớp, hỏng lớp nào thì các lớp còn lại vẫn chạy (không lớp nào được phép làm vỡ lượt dịch):
 *   1. WebAudio: oscillator → gain 0 → destination. Rẻ, không cần file, không cần quyền.
 *   2. <audio> loop bằng WAV im lặng dựng tại chỗ (data URI) — vài trình duyệt chỉ tính
 *      "audible" cho phần tử media, không tính WebAudio.
 *   3. Media Session: khai với hệ điều hành là đang phát, kèm nhãn để user thấy trên thanh
 *      điều khiển media của Windows là "đang dịch" chứ không phải tab lạ phát nhạc.
 *
 * PHẢI gọi từ trong một cử chỉ của người dùng (nút Bắt đầu dịch) — autoplay policy chặn âm
 * thanh khởi tạo ngoài cử chỉ. `resumeIfSuspended` vá thêm ca AudioContext bị treo về suspended.
 */

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let el: HTMLAudioElement | null = null;
let running = false;

/** WAV 1 giây IM LẶNG dựng tại chỗ — khỏi kèm file nhị phân vào repo. */
function silentWavDataUri(): string {
  const sampleRate = 8000;
  const samples = sampleRate; // 1 giây
  const blockAlign = 1;       // 8-bit mono
  const dataSize = samples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);            // PCM
  v.setUint16(22, 1, true);            // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 8, true);            // 8 bit
  ascii(36, 'data');
  v.setUint32(40, dataSize, true);
  // 8-bit PCM: giá trị giữa (128) = im lặng tuyệt đối.
  for (let i = 0; i < dataSize; i++) v.setUint8(44 + i, 128);

  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

function startWebAudio(): void {
  try {
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    gain = ctx.createGain();
    gain.gain.value = 0;               // CÂM tuyệt đối — không phải "nhỏ", là 0.
    osc = ctx.createOscillator();
    osc.frequency.value = 20;          // dưới ngưỡng nghe, và gain=0 nên vô nghĩa với tai
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
  } catch {
    ctx = null; osc = null; gain = null;
  }
}

function startMediaElement(): void {
  try {
    el = document.createElement('audio');
    el.src = silentWavDataUri();
    el.loop = true;
    el.volume = 0;
    // Không nhét vào DOM để khỏi ảnh hưởng layout; phần tử vẫn phát bình thường.
    void el.play().catch(() => { /* autoplay bị chặn — hai lớp kia vẫn giữ tab */ });
  } catch {
    el = null;
  }
}

function announceMediaSession(): void {
  try {
    const ms = (navigator as unknown as { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    if ('MediaMetadata' in window) {
      ms.metadata = new MediaMetadata({
        title: 'Đang dịch thẻ — đừng đóng tab',
        artist: 'SillyTavern Multi Tools',
      });
    }
    ms.playbackState = 'playing';
  } catch { /* không hỗ trợ — bỏ qua */ }
}

/**
 * Bật giữ-tab-sống. Gọi nhiều lần vô hại (idempotent). PHẢI gọi trong cử chỉ người dùng.
 */
export function startKeepAlive(): void {
  if (running) return;
  running = true;
  startWebAudio();
  startMediaElement();
  announceMediaSession();
}

/**
 * (Autoplay policy) AudioContext có thể bị đưa về 'suspended' khi tab mất focus lúc mới tạo.
 * Gọi hàm này ở các mốc có cử chỉ/định kỳ để dựng lại — thất bại thì im lặng.
 */
export function resumeKeepAlive(): void {
  if (!running) return;
  try { if (ctx && ctx.state === 'suspended') void ctx.resume(); } catch { /* bỏ qua */ }
  try { if (el && el.paused) void el.play().catch(() => {}); } catch { /* bỏ qua */ }
}

export function stopKeepAlive(): void {
  running = false;
  try { osc?.stop(); } catch { /* đã dừng */ }
  try { osc?.disconnect(); gain?.disconnect(); } catch { /* đã ngắt */ }
  try { void ctx?.close(); } catch { /* đã đóng */ }
  osc = null; gain = null; ctx = null;
  try { el?.pause(); } catch { /* đã dừng */ }
  if (el) { el.src = ''; el = null; }
  try {
    const ms = (navigator as unknown as { mediaSession?: MediaSession }).mediaSession;
    if (ms) ms.playbackState = 'none';
  } catch { /* bỏ qua */ }
}

/** Cho test/UI biết trạng thái. */
export function isKeepAliveRunning(): boolean { return running; }
