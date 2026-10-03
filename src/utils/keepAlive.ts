/**
 * src/utils/keepAlive.ts — GIỮ TAB SỐNG SUỐT LƯỢT DỊCH.
 * ─────────────────────────────────────────────────────────────────────────────
 * User (bug 221): "ở Edge đang chạy mà tự chuyển về chế độ ngầm, out khỏi phiên làm việc và
 * ngắt toàn bộ tiến trình… chỉ cần mở tab khác để làm việc là web tự tắt."
 *
 * Đó là hai tính năng KHÁC NHAU của Edge, và wake lock (bug 205) không chặn được cái nào:
 *   • Sleeping tabs — tab nền không tương tác quá X phút bị "đóng băng": mọi timer, promise,
 *     fetch đang bay đứng lại. Đây là thứ làm tiến trình dịch chết lặng.
 *   • Memory saver / tab discard — nặng hơn: tab bị GIẢI PHÓNG hẳn, quay lại là trang tải lại
 *     từ đầu (đúng cảm giác "out khỏi phiên làm việc").
 * Wake lock chỉ giữ MÀN HÌNH không tắt, không nói gì với bộ quản lý tab.
 *
 * Điều Edge/Chrome CAM KẾT không đụng tới: tab đang PHÁT ÂM THANH. Tab "audible" bị loại khỏi
 * cả sleeping tabs lẫn discard — đó là lý do để YouTube chạy nền thì tab không ngủ.
 *
 * ═══ (bug 225) VÌ SAO BẢN ĐẦU KHÔNG CHẠY ═══
 * User: "trên thanh trình duyệt không hiện ra biểu tượng phát ra âm thanh như các web đang
 * phát, vì thế chạy ngầm trên Edge hoàn toàn không hoạt động."
 *
 * Người dùng nhìn đúng chỗ: BIỂU TƯỢNG LOA CHÍNH LÀ đèn báo. Không có loa nghĩa là trình duyệt
 * không coi tab này là đang phát, và mọi ưu đãi chống-ngủ đều không được cấp.
 *
 * Bản đầu đặt `gain.gain.value = 0` và `el.volume = 0`, lại phát một file WAV toàn mẫu im lặng
 * — tức là ba lớp bảo hiểm cho cùng MỘT thứ: sự im lặng tuyệt đối. Nhưng Chromium không hỏi
 * "trang có gọi play() không", nó ĐO công suất dòng âm thanh thật (AudioStreamMonitor) rồi so
 * với ngưỡng im lặng ~-72 dBFS. Đúng 0 thì nằm dưới mọi ngưỡng, nên tab không bao giờ được
 * đánh dấu audible. Bản vá 221 vì thế im lặng theo cả nghĩa đen lẫn nghĩa bóng: chạy trót lọt,
 * không lỗi, và không có tác dụng nào.
 *
 * Cách sửa: phát âm thanh THẬT nhưng nằm ngoài tầm nghe của người:
 *   • biên độ ~0,003 (≈ -50 dBFS) — trên ngưỡng đo của trình duyệt hơn 20 dB, dưới ngưỡng nghe
 *     của tai ở mọi mức loa thông thường;
 *   • tần số 30 Hz — loa laptop/điện thoại gần như không tái tạo nổi dải này (thường cắt từ
 *     150-200 Hz trở xuống), trong khi bộ đo của trình duyệt nằm TRƯỚC loa nên vẫn đếm đủ.
 * Kết quả: thanh địa chỉ hiện biểu tượng loa, tai không nghe gì.
 *
 * Ba lớp, hỏng lớp nào thì các lớp còn lại vẫn chạy (không lớp nào được phép làm vỡ lượt dịch):
 *   1. WebAudio: oscillator → gain → destination.
 *   2. <audio> loop bằng WAV dựng tại chỗ — vài trình duyệt chỉ tính "audible" cho phần tử
 *      media, không tính WebAudio.
 *   3. Media Session: khai với hệ điều hành là đang phát, kèm nhãn để user thấy trên thanh
 *      điều khiển media của Windows là "đang dịch" chứ không phải tab lạ phát nhạc.
 *
 * Kèm một CHỐT TỰ KIỂM: AnalyserNode đo lại chính dòng ra của mình, để log nói được mức thật
 * đang phát thay vì hứa suông — nếu sau này ai chỉnh biên độ về 0 nữa thì con số sẽ tố cáo.
 *
 * PHẢI gọi từ trong một cử chỉ của người dùng (nút Bắt đầu dịch) — autoplay policy chặn âm
 * thanh khởi tạo ngoài cử chỉ. Watchdog bên dưới vá thêm ca AudioContext bị treo về suspended.
 */

/** Biên độ dòng giữ-tab. Trên ngưỡng đo của trình duyệt (~-72 dBFS), dưới ngưỡng nghe. */
export const KEEPALIVE_AMPLITUDE = 0.003;
/** Tần số (Hz) — đủ thấp để loa phổ thông không phát ra tiếng nghe được. */
export const KEEPALIVE_FREQ_HZ = 30;

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let el: HTMLAudioElement | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let onVisibility: (() => void) | null = null;
let running = false;

/**
 * WAV 1 giây chứa một tông 30 Hz rất khẽ, dựng tại chỗ — khỏi kèm file nhị phân vào repo.
 *
 * 16-bit chứ không phải 8-bit như bản cũ: ở 8-bit, bước biên độ nhỏ nhất khác 0 đã là 1/128
 * (≈ -42 dBFS) — to hơn mức cần gấp 8 lần, và lượng tử hoá thô đến mức tông sạch biến thành
 * sóng vuông nghe rõ tiếng rè. Số mẫu chia hết cho số chu kỳ nên vòng lặp khép kín, không có
 * cú "tách" ở mối nối.
 */
export function keepAliveWavDataUri(): string {
  const sampleRate = 8000;
  const samples = sampleRate;               // 1 giây = đúng 30 chu kỳ của 30 Hz
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                                  // PCM
  v.setUint16(22, 1, true);                                  // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataSize, true);
  const peak = Math.round(KEEPALIVE_AMPLITUDE * 32767);
  for (let i = 0; i < samples; i++) {
    v.setInt16(44 + i * bytesPerSample,
      Math.round(peak * Math.sin((2 * Math.PI * KEEPALIVE_FREQ_HZ * i) / sampleRate)), true);
  }

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
    // (bug 225) KHÁC 0 mới được tính là đang phát. Xem phần đầu file.
    gain.gain.value = KEEPALIVE_AMPLITUDE;
    osc = ctx.createOscillator();
    osc.frequency.value = KEEPALIVE_FREQ_HZ;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    osc.connect(gain);
    gain.connect(analyser);          // nhánh đo, không phát ra loa
    gain.connect(ctx.destination);
    osc.start();
  } catch {
    ctx = null; osc = null; gain = null; analyser = null;
  }
}

function startMediaElement(): void {
  try {
    el = document.createElement('audio');
    el.src = keepAliveWavDataUri();
    el.loop = true;
    el.volume = 1;                   // âm lượng nằm ở DỮ LIỆU; volume=0 là tự bịt lại lần nữa
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    // Gắn vào trang: vài engine chỉ tính "audible" cho phần tử media nằm trong tài liệu.
    document.body.appendChild(el);
    playMedia();   // autoplay bị chặn ⇒ lớp WebAudio vẫn giữ tab, và chờ cú bấm kế tiếp
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

/* ═══ (bug 241) NHIỀU NGƯỜI GIỮ, MỘT DÒNG ÂM THANH ═══
 *
 * User (gogopikachu): "tự động phát âm thanh để chạy ngầm không ổn định — lúc thì có biểu tượng loa
 * trên tab, lúc thì không, lúc không có thì để một lúc là tab vào sleep mode… tệp audio khi tắt thì
 * không bật lại thủ công được mà phải tắt hẳn cmd mở lại."
 *
 * Ba gốc rễ, đọc thẳng từ code trước bản này:
 *   1. CHỈ "Bắt đầu dịch" cả thẻ mới bật. Dịch lẻ ở Regex Manager / Link ngoài / Script nặng, nút
 *      "Dịch lại mục này", bộ quét chữ Hán… đều chạy KHÔNG có loa ⇒ đúng cảnh "lúc có lúc không".
 *   2. MỘT công tắc chung: việc nào xong / tạm dừng / huỷ cũng gọi stopKeepAlive() — tắt luôn cho
 *      cả việc khác đang chạy.
 *   3. Watchdog chỉ "gọi dậy" (resume/play). Dòng đã CHẾT hẳn (AudioContext bị đóng khi đổi thiết
 *      bị âm thanh, <audio> lỗi, phím media Pause của bàn phím/tai nghe) thì gọi bao nhiêu cũng
 *      không sống lại; và không có nút nào cho người dùng tự bật lại.
 *
 * Nay: mỗi việc GIỮ bằng một tên riêng (acquire/release) — còn ít nhất một người giữ là còn phát.
 * Watchdog ĐO mức thật mỗi 10 giây, chết thì DỰNG LẠI từ đầu; bị trình duyệt chặn vì thiếu cử chỉ
 * thì chờ cú bấm kế tiếp của người dùng rồi tự bật lại. Nút 🔊 trên thanh đầu trang cho bật/tắt
 * tay và hiện đúng trạng thái.
 */
const holders = new Set<string>();
let restarts = 0;
let mediaBlocked = false;
let lastDb: number | null = null;
let gestureRetry: (() => void) | null = null;
const listeners = new Set<() => void>();

export type KeepAliveHealth = 'off' | 'ok' | 'quiet' | 'blocked';
export interface KeepAliveStatus {
  running: boolean;
  holders: string[];
  health: KeepAliveHealth;
  /** Mức đo được của dòng WebAudio (dBFS), null nếu không đo được. */
  db: number | null;
  /** Số lần watchdog phải dựng lại từ đầu. */
  restarts: number;
}

let statusCache: KeepAliveStatus = { running: false, holders: [], health: 'off', db: null, restarts: 0 };

function computeHealth(): KeepAliveHealth {
  if (!running) return 'off';
  const webOk = lastDb !== null && lastDb > CHROMIUM_SILENCE_DBFS;
  const mediaOk = !!el && !el.paused && !mediaBlocked;
  if (webOk || mediaOk) return 'ok';
  return mediaBlocked ? 'blocked' : 'quiet';
}

function notify(): void {
  statusCache = { running, holders: [...holders], health: computeHealth(), db: lastDb, restarts };
  for (const fn of listeners) { try { fn(); } catch { /* bỏ qua */ } }
}

/** Đăng ký nghe trạng thái (dùng với useSyncExternalStore). Trả hàm huỷ. */
export function subscribeKeepAlive(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getKeepAliveStatus(): KeepAliveStatus { return statusCache; }

function teardownWebAudio(): void {
  try { osc?.stop(); } catch { /* đã dừng */ }
  try { osc?.disconnect(); gain?.disconnect(); analyser?.disconnect(); } catch { /* đã ngắt */ }
  try { void ctx?.close(); } catch { /* đã đóng */ }
  osc = null; gain = null; analyser = null; ctx = null;
}

function teardownMedia(): void {
  try { el?.pause(); } catch { /* đã dừng */ }
  if (el) { el.remove(); el.src = ''; el = null; }
}

function playMedia(): void {
  if (!el) return;
  try {
    void el.play().then(() => { mediaBlocked = false; notify(); }).catch(() => {
      // Autoplay bị chặn (chưa có cử chỉ người dùng) — chờ cú bấm kế tiếp để thử lại.
      mediaBlocked = true;
      armGestureRetry();
      notify();
    });
  } catch { /* bỏ qua */ }
}

/** Chờ cú bấm/phím kế tiếp của người dùng (cử chỉ hợp lệ) rồi dựng lại toàn bộ dòng âm thanh. */
function armGestureRetry(): void {
  if (gestureRetry || typeof document?.addEventListener !== 'function') return;
  gestureRetry = () => {
    disarmGestureRetry();
    if (running) pokeKeepAlive();
  };
  try {
    document.addEventListener('pointerdown', gestureRetry, true);
    document.addEventListener('keydown', gestureRetry, true);
  } catch { gestureRetry = null; }
}
function disarmGestureRetry(): void {
  if (!gestureRetry) return;
  try {
    document.removeEventListener('pointerdown', gestureRetry, true);
    document.removeEventListener('keydown', gestureRetry, true);
  } catch { /* bỏ qua */ }
  gestureRetry = null;
}

/** Phím media Pause (bàn phím, tai nghe Bluetooth) mặc định dừng <audio> — giữ nó phát tiếp. */
function setMediaHandlers(on: boolean): void {
  try {
    const ms = (navigator as unknown as { mediaSession?: MediaSession }).mediaSession;
    if (!ms || typeof ms.setActionHandler !== 'function') return;
    const keep = on ? () => { resumeKeepAlive(); } : null;
    ms.setActionHandler('pause', keep);
    ms.setActionHandler('play', keep);
    ms.setActionHandler('stop', keep);
  } catch { /* trình duyệt không hỗ trợ action này */ }
}

function bringUp(): void {
  running = true;
  startWebAudio();
  startMediaElement();
  announceMediaSession();
  setMediaHandlers(true);

  // (bug 225) Khởi động một lần là chưa đủ. Edge treo AudioContext về 'suspended' khi tab lùi
  // xuống nền, và <audio> có thể bị hệ thống tạm dừng khi máy ngủ/đổi thiết bị ra. Không ai
  // dựng lại thì tab thôi audible giữa chừng — đúng lúc cần được bảo vệ nhất.
  // Bọc typeof như mọi lớp khác trong file: giữ tab là tính năng PHỤ, không được phép ném lỗi
  // làm vỡ lượt dịch chỉ vì môi trường thiếu một API.
  try {
    if (typeof document?.addEventListener === 'function') {
      onVisibility = () => resumeKeepAlive();
      document.addEventListener('visibilitychange', onVisibility);
    }
  } catch { onVisibility = null; }
  try { watchdog = setInterval(() => checkKeepAliveHealth(), 10_000); } catch { watchdog = null; }
}

function bringDown(): void {
  running = false;
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  if (onVisibility) {
    try { document.removeEventListener('visibilitychange', onVisibility); } catch { /* bỏ qua */ }
    onVisibility = null;
  }
  disarmGestureRetry();
  setMediaHandlers(false);
  teardownWebAudio();
  teardownMedia();
  mediaBlocked = false;
  lastDb = null;
  try {
    const ms = (navigator as unknown as { mediaSession?: MediaSession }).mediaSession;
    if (ms) ms.playbackState = 'none';
  } catch { /* bỏ qua */ }
}

/** Một việc bắt đầu cần giữ tab sống. Gọi nhiều lần cùng tên vô hại. */
export function acquireKeepAlive(owner: string): void {
  holders.add(owner);
  if (!running) bringUp();
  notify();
}

/** Việc đó xong. Chỉ khi KHÔNG còn ai giữ mới tắt dòng âm thanh. */
export function releaseKeepAlive(owner: string): void {
  holders.delete(owner);
  if (holders.size === 0 && running) bringDown();
  notify();
}

/**
 * Bật giữ-tab-sống cho lượt dịch thẻ. Gọi nhiều lần vô hại (idempotent). Nên gọi trong cử chỉ
 * người dùng (nút Bắt đầu dịch) — autoplay policy chặn âm thanh khởi tạo ngoài cử chỉ.
 */
export function startKeepAlive(): void { acquireKeepAlive('translation'); }

/**
 * (bug 225) Watchdog: ĐO mức thật rồi mới kết luận. AudioContext đã đóng / im dưới ngưỡng thì
 * dựng lại WebAudio từ đầu; <audio> bị dừng thì phát lại (bị chặn ⇒ chờ cú bấm kế tiếp).
 */
export function checkKeepAliveHealth(): void {
  if (!running) return;
  resumeKeepAlive();
  const state = (ctx as unknown as { state?: string } | null)?.state;
  lastDb = measureKeepAliveDbfs();
  const deadWeb = !!ctx && (state === 'closed' || state === 'interrupted');
  const quietWeb = !!ctx && state === 'running' && lastDb !== null && lastDb <= CHROMIUM_SILENCE_DBFS;
  if (deadWeb || quietWeb) {
    teardownWebAudio();
    startWebAudio();
    restarts++;
    lastDb = measureKeepAliveDbfs();
  }
  if (el && (el.paused || (el as unknown as { error?: unknown }).error)) {
    if ((el as unknown as { error?: unknown }).error) {
      teardownMedia();
      startMediaElement();
      restarts++;
    } else {
      playMedia();
    }
  }
  notify();
}

/**
 * Dựng lại TOÀN BỘ dòng âm thanh ngay bây giờ. Gọi từ một cú bấm của người dùng (nút 🔊) — trong
 * cử chỉ thì trình duyệt cho phát, nên đây là cách chắc chắn nhất để bật lại sau khi bị chặn.
 */
export function pokeKeepAlive(countAsRestart = true): void {
  if (!running) return;
  teardownWebAudio();
  teardownMedia();
  startWebAudio();
  startMediaElement();
  announceMediaSession();
  if (countAsRestart) restarts++;
  lastDb = measureKeepAliveDbfs();
  notify();
}

/**
 * (Autoplay policy) AudioContext có thể bị đưa về 'suspended'. Gọi định kỳ để dựng lại —
 * thất bại thì im lặng, không được phép làm vỡ lượt dịch.
 */
export function resumeKeepAlive(): void {
  if (!running) return;
  try { if (ctx && ctx.state === 'suspended') void ctx.resume(); } catch { /* bỏ qua */ }
  try { if (el && el.paused) playMedia(); } catch { /* bỏ qua */ }
}

/** Lượt dịch thẻ xong / dừng — nhả phần giữ của nó (việc khác đang giữ thì vẫn phát). */
export function stopKeepAlive(): void { releaseKeepAlive('translation'); }

/* ─── (bug 241) Giữ tab THỦ CÔNG — nút 🔊 trên thanh đầu trang, nhớ qua lần mở sau ─── */
const MANUAL_KEY = 'keepalive-manual';

export function isManualKeepAliveSaved(): boolean {
  try { return localStorage.getItem(MANUAL_KEY) === '1'; } catch { return false; }
}

/** Bật/tắt giữ tab thủ công. Gọi TỪ cú bấm của người dùng. */
export function setManualKeepAlive(on: boolean): void {
  try { localStorage.setItem(MANUAL_KEY, on ? '1' : '0'); } catch { /* chế độ riêng tư */ }
  if (on) {
    const wasRunning = running;
    acquireKeepAlive('manual');
    // Đang chạy sẵn (có thể đang bị chặn) ⇒ dựng lại NGAY trong cử chỉ này để chắc chắn được phát.
    if (wasRunning) pokeKeepAlive(false);
  } else {
    releaseKeepAlive('manual');
  }
}

/** Cho test/UI biết trạng thái. */
export function isKeepAliveRunning(): boolean { return running; }

/**
 * (bug 225) TỰ KIỂM: đo lại chính dòng ra của mình, trả về mức RMS quy ra dBFS.
 *
 * Có hàm này vì lời hứa "đang phát âm thanh" là thứ đã sai một lần mà không ai biết. Số đo
 * phải > -72 dBFS thì trình duyệt mới tính tab là audible; log lúc bắt đầu dịch in con số này
 * ra để người dùng đối chiếu với biểu tượng loa trên thanh địa chỉ. Trả null khi chưa chạy.
 */
export function measureKeepAliveDbfs(): number | null {
  if (!running || !analyser) return null;
  try {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms <= 0) return -Infinity;
    return 20 * Math.log10(rms);
  } catch {
    return null;
  }
}

/** Ngưỡng im lặng của Chromium — dưới mức này là tab KHÔNG được tính đang phát. */
export const CHROMIUM_SILENCE_DBFS = -72.24;

/** Dòng âm thanh hiện tại có đủ để trình duyệt tính là "đang phát" không? */
export function isKeepAliveAudible(): boolean {
  const db = measureKeepAliveDbfs();
  return db !== null && db > CHROMIUM_SILENCE_DBFS;
}
