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
}

const G = globalThis as any;
const state: ManagerState = G.__ST_TOOL_MANAGER__ ?? (G.__ST_TOOL_MANAGER__ = {
  children: new Map<string, ManagedChild>(),
  exitHookInstalled: false,
});

const LOG_TAIL_MAX = 100;

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
  };
};

export const statusAll = (): Promise<ToolStatus[]> =>
  Promise.all(TOOL_SERVERS.map((t) => toStatus(t.id)));

export const getLogTail = (id: string): string[] => state.children.get(id)?.logTail.slice(-LOG_TAIL_MAX) ?? [];

/**
 * Khởi động 1 tool. Idempotent: đang chạy → nhận luôn (kể cả orphan); đang starting → trả
 * trạng thái hiện tại. Spawn qua cmd.exe tường minh để child.pid là GỐC cây process —
 * taskkill /t sau này quét đúng cả npm lẫn node con.
 */
export async function startTool(id: string, rootDir: string): Promise<{ ok: boolean; error?: string; alreadyRunning?: boolean; tool?: ToolStatus }> {
  const def = getToolById(id);
  if (!def) return { ok: false, error: `Tool không tồn tại: ${id}` };

  if (await probePort(def.port)) {
    return { ok: true, alreadyRunning: true, tool: await toStatus(id) };
  }

  const existing = state.children.get(id);
  if (existing && existing.phase === 'starting') {
    return { ok: true, tool: await toStatus(id) };
  }
  // Bản ghi 'error' cũ → dọn rồi thử lại từ đầu.
  if (existing) state.children.delete(id);

  const cwd = path.join(rootDir, def.dir);
  // npm install trước mỗi lần chạy: giống hệt start.bat cũ — sau update git có thể có dep mới,
  // thiếu là dev server chết với "Failed to resolve import". Có node_modules rồi thì chỉ tốn vài giây.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund && npm run dev'], {
    cwd,
    windowsHide: true,               // KHÔNG bung cửa sổ CMD — mục tiêu chính của cả tính năng
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.pid) return { ok: false, error: 'Spawn thất bại (không có PID).' };

  const m: ManagedChild = { child, pid: child.pid, startedAt: Date.now(), phase: 'starting', lastError: null, logTail: [] };
  state.children.set(id, m);
  child.stdout?.on('data', (c) => pushLog(m, c));
  child.stderr?.on('data', (c) => pushLog(m, c));
  child.on('exit', (code) => {
    // Chết mà chưa từng lên port (phase vẫn 'starting') = lỗi khởi động thật sự.
    if (state.children.get(id) === m && m.phase === 'starting') {
      m.phase = 'error';
      m.lastError = `Server thoát sớm (mã ${code ?? '?'}). ` + (m.logTail.slice(-3).join(' | ') || 'Không có log.');
    }
  });

  installExitHook();
  return { ok: true, tool: await toStatus(id) };
}

/** Dừng 1 tool: managed → taskkill cây process; orphan → free-ports.ps1 (node-only, an toàn). */
export async function stopTool(id: string, rootDir: string): Promise<{ ok: boolean; error?: string }> {
  const def = getToolById(id);
  if (!def) return { ok: false, error: `Tool không tồn tại: ${id}` };

  const m = state.children.get(id);
  if (m) {
    state.children.delete(id);
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/pid', String(m.pid), '/t', '/f'], () => resolve());
    });
  } else if (await probePort(def.port)) {
    // Orphan: giao cho free-ports.ps1 — chỉ giết node, process lạ thì từ chối (exit 1).
    const err = await new Promise<string | null>((resolve) => {
      execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(rootDir, 'scripts', 'free-ports.ps1'), String(def.port)],
        (e, _out, stderr) => resolve(e ? (stderr || e.message) : null),
      );
    });
    if (err) return { ok: false, error: `Port ${def.port} không giải phóng được (có thể do process KHÔNG phải node đang giữ): ${err.slice(0, 200)}` };
  } else {
    return { ok: true }; // đã dừng sẵn
  }

  // Xác nhận port đã trống (≤3s) để UI không hiện "đã dừng" trong khi server còn sống.
  for (let i = 0; i < 15; i++) {
    if (!(await probePort(def.port))) return { ok: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: `Đã gửi lệnh dừng nhưng port ${def.port} vẫn trả lời sau 3s.` };
}

/** Đóng hub (Ctrl+C / đóng cửa sổ launcher) → dọn hết server con do hub spawn. */
function installExitHook() {
  if (state.exitHookInstalled) return;
  state.exitHookInstalled = true;
  const killAll = () => {
    for (const [, m] of state.children) {
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
