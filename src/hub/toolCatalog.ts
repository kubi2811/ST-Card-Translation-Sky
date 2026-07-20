// ─── Catalog server của các tool con (nguồn sự thật DUY NHẤT cho lazy-start) ───
// File này được import bởi CẢ HAI phía:
//   - client (useToolServers, AppHub) — hiển thị trạng thái + gọi API
//   - vite.config.ts / scripts/tool-server-manager.ts — spawn/kill dev server thật
// nên TUYỆT ĐỐI zero-import: không React, không import.meta.env, không Node API.
// id ở đây PHẢI TRÙNG FlowDef.id trong src/flows.ts (test toolCatalog.test.ts khoá điều đó).

export interface ToolServerDef {
  /** Trùng FlowDef.id của tab tương ứng trên rail */
  id: string;
  /** Thư mục con (tương đối repo root) chứa package.json + npm run dev */
  dir: string;
  /** Port cố định (strictPort) — ground truth để probe "đang chạy hay không" */
  port: number;
}

export const TOOL_SERVERS: ToolServerDef[] = [
  { id: 'card-creator', dir: 'tao-card',    port: 5174 },
  { id: 'preset',       dir: 'preset-tool', port: 5175 },
  { id: 'mod-card',     dir: 'mod-card',    port: 5176 },
  { id: 'crawler',      dir: 'crawler',     port: 5177 },
];

export type ToolPhase = 'stopped' | 'starting' | 'ready' | 'error';

export interface ToolStatus {
  id: string;
  port: number;
  /** Port có đang trả lời không (probe TCP) — ground truth, kể cả server "mồ côi" */
  running: boolean;
  /** true = do hub spawn (kill được bằng taskkill /t); false = orphan (dừng qua free-ports) */
  managed: boolean;
  pid: number | null;
  phase: ToolPhase;
  startedAt: number | null;
  lastError: string | null;
  /** ~10 dòng log cuối (stdout+stderr) để hiện trong màn chờ / màn lỗi */
  logTail: string[];
}

export const getToolById = (id: string): ToolServerDef | undefined =>
  TOOL_SERVERS.find((t) => t.id === id);

export type ToolsRoute =
  | { kind: 'status' }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'logs'; id: string };

/**
 * Phân giải route /api/tools/* (pure — test được không cần HTTP).
 * Trả null nếu không khớp route/method — caller cho rơi xuống 404.
 */
export function parseToolsRoute(url: string, method: string): ToolsRoute | null {
  const [pathname, query = ''] = url.split('?');
  if (pathname === '/api/tools/status' && method === 'GET') return { kind: 'status' };
  if (pathname === '/api/tools/start' && method === 'POST') return { kind: 'start' };
  if (pathname === '/api/tools/stop' && method === 'POST') return { kind: 'stop' };
  if (pathname === '/api/tools/logs' && method === 'GET') {
    const id = new URLSearchParams(query).get('id') || '';
    return { kind: 'logs', id };
  }
  return null;
}

/** start/stop gây side-effect (spawn/kill process) → phải qua CSRF guard; status/logs chỉ đọc. */
export function isToolsMutating(url: string): boolean {
  const pathname = url.split('?')[0];
  return pathname === '/api/tools/start' || pathname === '/api/tools/stop';
}
