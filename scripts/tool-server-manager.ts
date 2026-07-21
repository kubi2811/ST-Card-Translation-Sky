// ─── Quản lý dev server của các tool con (lazy-start) ───
// Chỉ vite.config.ts (hub 5173) import file này. Hub là server LUÔN chạy nên nó chịu trách
// nhiệm spawn/kill các server anh em theo yêu cầu từ UI (/api/tools/*).
//
// Nguyên tắc an toàn:
//  - "Đang chạy" = port TRẢ LỜI (probe TCP) — không tin state trong RAM. Nhờ vậy server do
//    người dùng tự mở (orphan) vẫn được nhận diện + dùng lại, và vite restart không mất dấu.
//  - Kill process: chỉ taskkill cây process do CHÍNH hub spawn (biết đúng PID gốc). Orphan thì
//    đi qua scripts/free-ports.ps1 — script này CHỈ giết node, gặp process lạ là từ chối.
//  - State treo trên globalThis: vite.config đổi → vite restart server TRONG CÙNG process và
//    nạp lại module này (instance mới). Không neo globalThis là mất map children → orphan hoá
//    toàn bộ + đăng ký trùng exit-hook.

import { spawn, execFile, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { TOOL_SERVERS, getToolById, type ToolStatus, type ToolPhase } from '../src/hub/toolCatalog';

interface ManagedChild {
  child: ChildProcess;
  pid: number;
  startedAt: number;
  /** 'starting' cho tới khi port trả lời; 'error' nếu process chết trước đó */
  phase: Extract<ToolPhase, 'starting' | 'error'>;
  lastError: string | null;
  logTail: string[];
}

interface ManagerState {
  children: Map<string, ManagedChild>;
  exitHookInstalled: boolean;
  /** id → thời điểm user CHỦ ĐỘNG bấm Dừng. Chặn tab khác auto-start lại ngay sau đó. */
  stoppedManuallyAt: Map<string, number>;
}

const G = globalThis as any;
const state: ManagerState = G.__ST_TOOL_MANAGER__ ?? (G.__ST_TOOL_MANAGER__ = {
  children: new Map<string, ManagedChild>(),
  exitHookInstalled: false,
  stoppedManuallyAt: new Map<string, number>(),
});
// Module cũ (trước bản này) không có field mới → vá khi vite reload config giữa chừng.
if (!state.stoppedManuallyAt) state.stoppedManuallyAt = new Map<string, number>();

const LOG_TAIL_MAX = 100;
/** Cửa sổ "vừa bị dừng tay": trong khoảng này auto-start (bấm tab) bị bỏ qua. */
const MANUAL_STOP_GRACE_MS = 60_000;

/**
 * Chỉ được taskkill khi tiến trình CÒN SỐNG. Windows tái dùng PID rất nhanh — bắn
 * `taskkill /t /f` vào PID của child đã chết có thể giết nhầm app khác của user
 * (Discord/OBS…) kèm mất dữ liệu chưa lưu.
 */
const isAlive = (m: ManagedChild): boolean =>
  m.child.exitCode === null && m.child.signalCode === null && !m.child.killed;

const killTree = (m: ManagedChild): Promise<void> =>
  new Promise((resolve) => {
    if (!isAlive(m)) { resolve(); return; }
    execFile('taskkill', ['/pid', String(m.pid), '/t', '/f'], () => resolve());
  });

const pushLog = (m: ManagedChild, chunk: unknown) => {
  const lines = String(chunk).split(/\r?\n/).filter((l) => l.trim());
  m.logTail.push(...lines);
  if (m.logTail.length > LOG_TAIL_MAX) m.logTail.splice(0, m.logTail.length - LOG_TAIL_MAX);
};

const probeHost = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: 400 });
    const done = (ok: boolean) => { try { sock.destroy(); } catch { /* ignore */ } resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });

/**
 * Port có đang lắng nghe không — ground truth cho "running", nhận cả server orphan.
 * Thử CẢ IPv4 lẫn IPv6: vite/next trên Windows bind "localhost" = CHỈ [::1] (IPv6),
 * probe mỗi 127.0.0.1 sẽ báo "chưa chạy" mãi dù server đã lên (bug bắt được khi verify live).
 */
export const probePort = async (port: number): Promise<boolean> =>
  (await probeHost('127.0.0.1', port)) || (await probeHost('::1', port));

const toStatus = async (id: string): Promise<ToolStatus> => {
  const def = getToolById(id)!;
  const running = await probePort(def.port);
  const m = state.children.get(id);
  let phase: ToolPhase;
  if (running) phase = 'ready';
  else if (m) phase = m.phase; // 'starting' (chưa lên) hoặc 'error' (chết non)
  else phase = 'stopped';
  return {
    id,
    port: def.port,
    running,
    managed: !!m && running,
    pid: m?.pid ?? null,
    phase,
    startedAt: m?.startedAt ?? null,
    lastError: m?.phase === 'error' ? m.lastError : null,
    logTail: m ? m.logTail.slice(-10) : [],
    manuallyStopped: isManuallyStopped(id),
  };
};

export const statusAll = (): Promise<ToolStatus[]> =>
  Promise.all(TOOL_SERVERS.map((t) => toStatus(t.id)));

export const getLogTail = (id: string): string[] => state.children.get(id)?.logTail.slice(-LOG_TAIL_MAX) ?? [];

/** UI cần biết để KHÔNG auto-start lại tool mà user vừa chủ động dừng ở cửa sổ khác. */
export const isManuallyStopped = (id: string): boolean => {
  const at = state.stoppedManuallyAt.get(id);
  return !!at && Date.now() - at < MANUAL_STOP_GRACE_MS;
};

/**
 * Khởi động 1 tool. Idempotent: đang chạy → nhận luôn (kể cả orphan); đang starting → trả
 * trạng thái hiện tại. Spawn qua cmd.exe tường minh để child.pid là GỐC cây process —
 * taskkill /t sau này quét đúng cả npm lẫn node con.
 */
export async function startTool(
  id: string,
  rootDir: string,
  opts: { auto?: boolean } = {},
): Promise<{ ok: boolean; error?: string; alreadyRunning?: boolean; skipped?: string; tool?: ToolStatus }> {
  const def = getToolById(id);
  if (!def) return { ok: false, error: `TOOL_NOT_FOUND:${id}` };

  if (await probePort(def.port)) {
    state.stoppedManuallyAt.delete(id);
    return { ok: true, alreadyRunning: true, tool: await toStatus(id) };
  }

  // User vừa CHỦ ĐỘNG dừng ở tab/cửa sổ khác → không cho auto-start (bấm tab) bật lại ngay.
  // Bấm nút "Khởi động" tường minh (auto=false) thì luôn được phép.
  const stoppedAt = state.stoppedManuallyAt.get(id);
  if (opts.auto && stoppedAt && Date.now() - stoppedAt < MANUAL_STOP_GRACE_MS) {
    return { ok: true, skipped: 'manually-stopped', tool: await toStatus(id) };
  }
  state.stoppedManuallyAt.delete(id);

  const existing = state.children.get(id);
  if (existing && existing.phase === 'starting') {
    return { ok: true, tool: await toStatus(id) };
  }
  // Bản ghi 'error' cũ → dọn rồi thử lại từ đầu.
  if (existing) state.children.delete(id);

  // Thư mục tool không tồn tại (client copy thiếu folder) → báo lỗi TỬ TẾ, tuyệt đối
  // không để spawn ném ENOENT bất đồng bộ (xem child.on('error') bên dưới).
  const cwd = path.join(rootDir, def.dir);
  if (!fs.existsSync(cwd)) {
    const m: ManagedChild = {
      child: { exitCode: 1, signalCode: null, killed: true } as unknown as ChildProcess,
      pid: -1, startedAt: Date.now(), phase: 'error',
      lastError: `MISSING_DIR:${def.dir}`, logTail: [],
    };
    state.children.set(id, m);
    return { ok: false, error: m.lastError, tool: await toStatus(id) };
  }
  // npm install trước mỗi lần chạy: giống hệt start.bat cũ — sau update git có thể có dep mới,
  // thiếu là dev server chết với "Failed to resolve import". Có node_modules rồi thì chỉ tốn vài giây.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund && npm run dev'], {
    cwd,
    windowsHide: true,               // KHÔNG bung cửa sổ CMD — mục tiêu chính của cả tính năng
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Ghi record TRƯỚC khi kiểm pid: spawn lỗi phát 'error' BẤT ĐỒNG BỘ (nextTick) và
  // ChildProcess KHÔNG có listener 'error' = uncaughtException = SẬP CẢ HUB (đã tái hiện
  // được: `spawn cmd.exe ENOENT` giết luôn process vite → mọi tab mất proxy giữa chừng).
  const m: ManagedChild = { child, pid: child.pid ?? -1, startedAt: Date.now(), phase: 'starting', lastError: null, logTail: [] };
  state.children.set(id, m);
  child.on('error', (err) => {
    if (state.children.get(id) !== m) return;
    m.phase = 'error';
    m.lastError = `SPAWN_FAILED:${(err as NodeJS.ErrnoException)?.code || err.message}`;
  });
  if (!child.pid) {
    m.phase = 'error';
    m.lastError = 'SPAWN_FAILED:NO_PID';
    return { ok: false, error: m.lastError, tool: await toStatus(id) };
  }

  child.stdout?.on('data', (c) => pushLog(m, c));
  child.stderr?.on('data', (c) => pushLog(m, c));
  child.on('exit', (code) => {
    // Chết mà chưa từng lên port (phase vẫn 'starting') = lỗi khởi động thật sự.
    if (state.children.get(id) === m && m.phase === 'starting') {
      m.phase = 'error';
      m.lastError = `EXITED_EARLY:${code ?? '?'}`;
    }
  });

  installExitHook();
  return { ok: true, tool: await toStatus(id) };
}

/** Dừng 1 tool: managed → taskkill cây process; orphan → free-ports.ps1 (node-only, an toàn). */
export async function stopTool(id: string, rootDir: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const def = getToolById(id);
  if (!def) return { ok: false, error: `TOOL_NOT_FOUND:${id}` };

  // Nhớ ý định của user NGAY: tab/cửa sổ khác đang poll không được auto-start lại (state
  // manuallyStopped của React là cục bộ từng tab, còn server là tài nguyên chung).
  state.stoppedManuallyAt.set(id, Date.now());

  const m = state.children.get(id);
  if (m) {
    state.children.delete(id);
    await killTree(m); // chỉ taskkill khi child còn sống (chống giết nhầm PID tái dùng)
  }

  if (await probePort(def.port)) {
    // Còn sống: orphan (user tự mở tay) hoặc child chết mà port chưa nhả → free-ports.ps1,
    // script này CHỈ giết node, gặp process lạ là từ chối và in lý do.
    const res = await new Promise<{ err: string | null; out: string }>((resolve) => {
      execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(rootDir, 'scripts', 'free-ports.ps1'), String(def.port)],
        // free-ports in lý do bằng Write-Host = STDOUT → phải đọc CẢ stdout, không thì UI
        // chỉ nhận "Command failed: powershell…" vô nghĩa.
        (e, stdout, stderr) => resolve({ err: e ? (stderr || e.message) : null, out: String(stdout || '') }),
      );
    });
    if (res.err) {
      const reason = res.out.split('\n').map((l) => l.trim()).filter((l) => /KHONG phai node|Khong dong duoc/i.test(l)).join(' ');
      return { ok: false, error: `PORT_BUSY:${def.port}`, detail: (reason || res.err).slice(0, 220) };
    }
  }

  // Xác nhận port đã trống (≤3s) để UI không hiện "đã dừng" trong khi server còn sống.
  for (let i = 0; i < 15; i++) {
    if (!(await probePort(def.port))) return { ok: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: `STILL_LISTENING:${def.port}` };
}

/** Đóng hub (Ctrl+C / đóng cửa sổ launcher) → dọn hết server con do hub spawn. */
function installExitHook() {
  if (state.exitHookInstalled) return;
  state.exitHookInstalled = true;
  const killAll = () => {
    for (const [, m] of state.children) {
      // CHỈ giết tiến trình còn sống — record 'error' cũ giữ PID của process đã chết từ lâu,
      // mà Windows tái dùng PID rất nhanh ⇒ taskkill /t /f có thể diệt nhầm app của user.
      if (!isAlive(m)) continue;
      try { execFile('taskkill', ['/pid', String(m.pid), '/t', '/f']); } catch { /* ignore */ }
    }
    state.children.clear();
  };
  process.on('exit', killAll);
  process.on('SIGINT', () => { killAll(); process.exit(0); });
  process.on('SIGTERM', () => { killAll(); process.exit(0); });
  // Windows: đóng thẳng cửa sổ console → CTRL_CLOSE_EVENT = SIGHUP. Không bắt là orphan hết
  // (start.bat vẫn còn sweep free-ports 5174-5177 lúc thoát làm lưới đỡ cuối).
  process.on('SIGHUP', () => { killAll(); process.exit(0); });
}
