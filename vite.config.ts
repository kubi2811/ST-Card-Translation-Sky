import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import httpProxy from 'http-proxy';
import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseToolsRoute, isToolsMutating, getToolById, TOOL_SERVERS } from './src/hub/toolCatalog';
import { planInstallTargets, toolsNeedingRestart, describeInstallPlan } from './src/hub/updatePlan';
import { statusAll, startTool, stopTool, getLogTail } from './scripts/tool-server-manager';

// ─── Translation progress cache (filesystem, in the project folder) ───
// Stored as plain JSON files so progress survives F5 / tab close / even switching
// browsers — unlike browser storage which is per-browser. One file per card key.
const PROGRESS_DIR = path.resolve(process.cwd(), 'translation-progress');
const safeCacheName = (key: string) =>
  (key || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) + '.json';
const ensureProgressDir = () => { try { fs.mkdirSync(PROGRESS_DIR, { recursive: true }); } catch { /* ignore */ } };
const readJsonBody = (req: import('http').IncomingMessage): Promise<any> =>
  new Promise((resolve) => {
    // Gom Buffer rồi decode UTF-8 MỘT LẦN ở cuối. Trước đây `body += c` ép mỗi chunk thành
    // chuỗi riêng lẻ: với body vài MB (thẻ dịch, cache resume Dịch Script/Preset), một ký tự
    // UTF-8 nhiều byte bị cắt qua 2 chunk TCP → mỗi nửa byte thành U+FFFD, hỏng chữ (ví dụ "đ"
    // = C4 91 → ). Buffer.concat ghép nhị phân trước, không tách giữa ký tự.
    const chunks: Buffer[] = [];
    req.on('data', (c) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });

// ═══ CẬP NHẬT / HẠ CẤP + CÀI THƯ VIỆN CHO GỐC **VÀ MỌI TOOL CON** ═══
// (User 22/07) Trước đây hai endpoint này chỉ chạy `npm install` ở thư mục GỐC. Repo là
// monorepo: Tạo Card / Tạo Preset / Mod Card / Crawler mỗi tool có package.json riêng. Thêm
// `jszip` vào tao-card, user bấm "Cập nhật" xong mở Tạo Card thì Vite nổ
// "Failed to resolve import jszip" — trắng màn hình, tưởng hỏng app.
// `update.bat` vốn đã lặp qua từng tool; đường trong app thì không. Nay gộp về một hành vi.

/** Chạy một lệnh, đẩy output thẳng ra response. Trả về mã thoát. */
function runStreamed(cmd: string, cwd: string, res: import('http').ServerResponse): Promise<number> {
  return new Promise((resolve) => {
    const child = exec(cmd, { cwd, maxBuffer: 32 * 1024 * 1024 });
    child.stdout?.on('data', (d) => res.write(d));
    child.stderr?.on('data', (d) => res.write(d));
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (e) => { res.write(`\n${e.message}\n`); resolve(1); });
  });
}

async function runUpdateAndInstall(
  res: import('http').ServerResponse,
  opts: { mode: 'update' | 'downgrade' | 'goto'; ref?: string },
) {
  const root = process.cwd();
  const isUpdate = opts.mode === 'update';
  const label = opts.mode === 'update' ? 'Cập nhật'
    : opts.mode === 'downgrade' ? 'Hạ cấp'
    : 'Chuyển phiên bản';

  // Mốc TRƯỚC khi đổi mã nguồn — để biết file nào vừa đổi mà chỉ cài đúng chỗ cần.
  let oldHead = '';
  try {
    oldHead = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  } catch { /* không lấy được thì lát nữa cài hết cho chắc */ }

  // (bugNeedFix/146) Thêm chế độ "goto": nhảy THẲNG tới một phiên bản bất kỳ.
  // Trước đây muốn lùi 5 bản phải bấm "hạ cấp" 5 lần, mỗi lần cài lại thư viện — vừa lâu
  // vừa không biết đang ở đâu. Ref đã được kiểm ở tầng endpoint (chỉ nhận hex 7-40 ký tự).
  res.write(opts.mode === 'goto'
    ? `Đang chuyển sang phiên bản ${opts.ref}...\n`
    : isUpdate
      ? 'Đang tải bản mới nhất từ GitHub...\n'
      : 'Đang hạ cấp phiên bản xuống 1 commit (git reset --hard HEAD~1)...\n');

  const gitCmd = opts.mode === 'goto'
    ? `git fetch origin main && git reset --hard ${opts.ref}`
    : isUpdate
      ? 'git fetch origin main && git reset --hard origin/main'
      : 'git reset --hard HEAD~1';
  const gitCode = await runStreamed(gitCmd, root, res);
  if (gitCode !== 0) {
    res.write(isUpdate
      ? `\n${label} thất bại (mã lỗi ${gitCode}). Kiểm tra mạng/GitHub. Nếu vẫn lỗi: mở thư mục cài đặt, chạy "git fetch origin main && git reset --hard origin/main" một lần rồi khởi động lại.\n`
      : `\n${label} thất bại (mã lỗi ${gitCode}).\n`);
    res.end();
    return;
  }

  // Những file vừa đổi. Không lấy được ⇒ null ⇒ cài hết (thà chậm còn hơn app hỏng).
  let changedFiles: string[] | null = null;
  if (oldHead) {
    try {
      const out = execSync(`git diff --name-only ${oldHead} HEAD`, { cwd: root }).toString();
      changedFiles = out.split('\n').map((s: string) => s.trim()).filter(Boolean);
    } catch { changedFiles = null; }
  }

  const targets = planInstallTargets({
    changedFiles,
    toolDirs: TOOL_SERVERS.map(t => t.dir),
    hasPackageJson: (d) => fs.existsSync(path.join(root, d, 'package.json')),
    hasNodeModules: (d) => fs.existsSync(path.join(root, d, 'node_modules')),
  });

  res.write(`\n${describeInstallPlan(targets)}\n`);

  // Trên Windows, npm không ghi đè được file đang bị tiến trình node giữ → phải DỪNG dev server
  // của tool sắp cài lại. User bấm lại tab tool là nó tự khởi động với thư viện mới.
  const toStop = toolsNeedingRestart(targets, TOOL_SERVERS);
  for (const id of toStop) {
    res.write(`Dừng server "${id}" trước khi cài (Windows khoá file đang chạy)...\n`);
    try { await stopTool(id, root); } catch { /* chưa chạy thì thôi */ }
  }

  let failed = 0;
  for (const t of targets) {
    res.write(`\n── npm install: ${t.dir === '.' ? '(gốc)' : t.dir} ──\n`);
    const code = await runStreamed('npm install --no-audit --no-fund', path.join(root, t.dir), res);
    if (code !== 0) {
      failed++;
      res.write(`\n[LỖI] Cài thư viện ở "${t.dir}" thất bại (mã ${code}).\n`);
    }
  }

  if (failed > 0) {
    res.write(`\n${label} xong phần mã nguồn nhưng ${failed} nơi cài thư viện LỖI. Mở thư mục cài đặt và chạy update.bat một lần để cài lại.\n`);
  } else {
    res.write(`\n${label} hoàn tất thành công.`);
    if (toStop.length > 0) res.write(` Các tool ${toStop.join(', ')} đã được dừng — bấm lại tab tool đó để khởi động với thư viện mới.`);
    res.write(' Vui lòng tải lại trang.\n');
  }
  res.end();
}

// ─── Same-origin guard (chống CSRF) ───
// Các endpoint dev-server dưới đây gây SIDE-EFFECT (git pull/reset, ghi file, hoặc proxy tới
// đích tuỳ ý). Chúng bị gọi bằng POST/GET đơn giản nên MỘT WEBSITE BẤT KỲ đang mở trong cùng
// trình duyệt có thể kích hoạt side-effect qua fetch cross-origin (dù CORS chặn ĐỌC kết quả).
// Nguy hiểm nhất: /api/downgrade chạy `git reset --hard HEAD~1` → mất việc chưa commit.
// Vì app tự gọi các API này là SAME-ORIGIN (localhost:5173), ta chỉ cần chặn khi request mang
// Origin/Referer của một site khác. Same-origin GET thường không có Origin → vẫn cho qua.
const ALLOWED_HOSTS = new Set(['localhost:5173', '127.0.0.1:5173']);
const isSameOrigin = (req: import('http').IncomingMessage): boolean => {
  const origin = req.headers.origin;
  if (origin) {
    try { return ALLOWED_HOSTS.has(new URL(origin).host); } catch { return false; }
  }
  // Không có Origin (same-origin GET, hoặc client không phải trình duyệt): kiểm tra thêm Referer nếu có.
  const referer = req.headers.referer;
  if (referer) {
    try { return ALLOWED_HOSTS.has(new URL(referer).host); } catch { return false; }
  }
  // Không Origin lẫn Referer → coi là same-origin/công cụ nội bộ, cho qua.
  return true;
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'dynamic-cors-proxy',
      configureServer(server) {
        // Create a dedicated proxy for dynamic targets
        const dynamicProxy = httpProxy.createProxyServer({
          changeOrigin: true,
          secure: false,
        });

        dynamicProxy.on('error', (err, req, res) => {
          console.error('[dynamic proxy error]', err);
          if ('writeHead' in res) {
            const response = res as import('http').ServerResponse;
            if (!response.headersSent) {
              response.writeHead(502);
              response.end('Bad Gateway');
            }
          } else {
            res.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          }
        });

        server.middlewares.use(async (req, res, next) => {
          const url = req.url || '';

          // ─── Chặn CSRF cho các route gây side-effect (git, ghi file, proxy tuỳ ý) ───
          // Chỉ chấp nhận khi request đến từ chính app (same-origin). Đọc dữ liệu vô hại
          // (/api/check-update, /api/progress/load|list) không chặn.
          const isMutating =
            url === '/api/update' || url === '/api/downgrade' ||
            url === '/api/dump-config' || url === '/api/debug-log' ||
            url === '/api/progress/save' || url === '/api/progress/delete' ||
            isToolsMutating(url) ||
            url.startsWith('/api-proxy/custom/');
          if (isMutating && !isSameOrigin(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Bị chặn: request cross-origin không được phép gọi endpoint này (chống CSRF).' }));
            return;
          }

          // ─── Lazy-start server tool con: status / start / stop / logs ───
          // Hub (5173) luôn chạy nên nó spawn/kill dev server của các tool anh em theo yêu cầu
          // từ UI. Logic thật nằm ở scripts/tool-server-manager.ts; route parse nằm ở
          // src/hub/toolCatalog.ts (pure, có test).
          {
            const route = parseToolsRoute(url, req.method || 'GET');
            if (route) {
              const sendJson = (code: number, obj: unknown) => {
                res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(JSON.stringify(obj));
              };
              try {
                if (route.kind === 'status') {
                  return sendJson(200, { ok: true, tools: await statusAll() });
                }
                if (route.kind === 'logs') {
                  if (!getToolById(route.id)) return sendJson(400, { ok: false, error: `Tool không tồn tại: ${route.id}` });
                  return sendJson(200, { ok: true, id: route.id, logTail: getLogTail(route.id) });
                }
                const body = await readJsonBody(req);
                const id = body && typeof body.id === 'string' ? body.id : '';
                if (!getToolById(id)) return sendJson(400, { ok: false, error: `Tool không tồn tại: ${id || '(thiếu id)'}` });
                if (route.kind === 'start') {
                  // auto=true: do bấm tab (tự khởi động) → tôn trọng ý muốn "vừa dừng tay"
                  // của cửa sổ khác. Bấm nút Khởi động tường minh thì auto=false, luôn chạy.
                  const r = await startTool(id, process.cwd(), { auto: body?.auto === true });
                  return sendJson(r.ok ? 200 : 500, r);
                }
                const r = await stopTool(id, process.cwd());
                return sendJson(r.ok ? 200 : 500, { ...r, stopped: r.ok });
              } catch (err: any) {
                return sendJson(500, { ok: false, error: err?.message || String(err) });
              }
            }
          }

          // ─── Translation progress cache: save / load / list / delete (filesystem) ───
          if (url.startsWith('/api/progress/')) {
            try {
              ensureProgressDir();
              const sendJson = (code: number, obj: unknown) => {
                res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(JSON.stringify(obj));
              };

              if (url === '/api/progress/save' && req.method === 'POST') {
                const body = await readJsonBody(req);
                if (!body || typeof body.key !== 'string') return sendJson(400, { ok: false, error: 'missing key' });
                const file = path.join(PROGRESS_DIR, safeCacheName(body.key));
                fs.writeFileSync(file, JSON.stringify({ key: body.key, savedAt: Date.now(), data: body.data }), 'utf8');
                return sendJson(200, { ok: true });
              }

              if (url.startsWith('/api/progress/load') && req.method === 'GET') {
                const key = new URL(url, 'http://localhost').searchParams.get('key') || '';
                const file = path.join(PROGRESS_DIR, safeCacheName(key));
                if (!fs.existsSync(file)) return sendJson(404, { ok: false });
                const raw = fs.readFileSync(file, 'utf8');
                return sendJson(200, { ok: true, ...JSON.parse(raw) });
              }

              if (url === '/api/progress/list' && req.method === 'GET') {
                const files = fs.existsSync(PROGRESS_DIR) ? fs.readdirSync(PROGRESS_DIR).filter(f => f.endsWith('.json')) : [];
                const items = files.map(f => {
                  try {
                    const raw = JSON.parse(fs.readFileSync(path.join(PROGRESS_DIR, f), 'utf8'));
                    return { key: raw.key, savedAt: raw.savedAt };
                  } catch { return null; }
                }).filter(Boolean);
                return sendJson(200, { ok: true, items });
              }

              if (url === '/api/progress/delete' && req.method === 'POST') {
                const body = await readJsonBody(req);
                if (body && typeof body.key === 'string') {
                  const file = path.join(PROGRESS_DIR, safeCacheName(body.key));
                  if (fs.existsSync(file)) fs.unlinkSync(file);
                }
                return sendJson(200, { ok: true });
              }

              return sendJson(404, { ok: false, error: 'unknown progress endpoint' });
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
              return;
            }
          }

          if (req.url === '/api/dump-config' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                fs.writeFileSync('config_dump.json', body, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Dumped successfully');
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(err.message || String(err));
              }
            });
            return;
          }

          if (req.url === '/api/debug-log' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                fs.appendFileSync('translation_debug.log', body + '\n', 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Logged');
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(err.message || String(err));
              }
            });
            return;
          }

          // ─── Check for updates ───
          // QUAN TRỌNG: KHÔNG được nuốt lỗi git thành "đã mới nhất". Nếu không phải git clone,
          // hoặc fetch lỗi, hoặc upstream chưa set → phải BÁO ĐÚNG lý do (ok:false) để UI hiển thị,
          // nếu không client cứ tưởng đang ở bản mới nhất trong khi thực ra không kiểm tra được.
          if (req.url === '/api/check-update' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            const fail = (error: string) => res.end(JSON.stringify({ ok: false, behind: 0, commits: [], error }));

            // B1: xác nhận là git repo + fetch origin (lấy ref mới nhất).
            exec('git rev-parse --is-inside-work-tree && git fetch --quiet origin', { timeout: 25000, cwd: process.cwd() }, (err, _o, stderr) => {
              if (err) {
                const reason = (stderr || err.message || '').trim();
                if (/not a git repository/i.test(reason)) {
                  fail('Thư mục này KHÔNG phải bản git clone (có thể bạn tải ZIP) → không thể tự cập nhật. Hãy dùng "git clone" hoặc tải lại bản mới nhất.');
                } else if (/could not resolve host|network|timed out|unable to access|connection/i.test(reason)) {
                  fail('Không kết nối được GitHub để kiểm tra cập nhật (mạng?). Chi tiết: ' + reason.slice(0, 200));
                } else {
                  fail('Không kiểm tra được cập nhật (git fetch lỗi): ' + reason.slice(0, 240));
                }
                return;
              }
              // B2: xác định nhánh so sánh — upstream nếu có, không thì fallback origin/main.
              exec('git rev-parse --abbrev-ref --symbolic-full-name "@{u}"', { cwd: process.cwd() }, (uErr, uOut) => {
                const upstream = (!uErr && uOut.trim()) ? uOut.trim() : 'origin/main';
                // B3: liệt kê commit local đang thiếu so với upstream.
                const logCmd = `git log HEAD..${upstream} --pretty=format:%h%x1f%s%x1e`;
                exec(logCmd, { timeout: 15000, cwd: process.cwd() }, (lErr, lOut, lStderr) => {
                  if (lErr) {
                    fail(`Không so sánh được với ${upstream}: ` + (lStderr || lErr.message || '').trim().slice(0, 200));
                    return;
                  }
                  const commits = String(lOut)
                    .split('\x1e').map((s) => s.trim()).filter(Boolean)
                    .map((rec) => { const [hash, subject] = rec.split('\x1f'); return { hash: (hash || '').trim(), subject: (subject || '').trim() }; });
                  let currentVersion = '';
                  try { currentVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version || ''; } catch { /* ignore */ }
                  res.end(JSON.stringify({ ok: true, behind: commits.length, commits, currentVersion, upstream }));
                });
              });
            });
            return;
          }

          if (req.url === '/api/update' && req.method === 'POST') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');

            // ĐỒNG BỘ CỨNG về bản trên GitHub: fetch + reset --hard (thay cho "git pull" trơn).
            // Lý do: mỗi lần cập nhật, "npm install" tự sửa package-lock.json (file được TRACK) →
            // lần pull sau, merge TỪ CHỐI ghi đè ("local changes would be overwritten") → update KẸT
            // mãi. reset --hard bỏ các thay đổi cục bộ đó (chỉ file đã track; dữ liệu user KHÔNG track
            // — thẻ, cache, progress — vẫn được giữ) nên cập nhật LUÔN chạy được.
            //
            // (User 22/07) Sau đó cài thư viện cho GỐC **và MỌI TOOL CON**. Trước đây chỉ chạy
            // `npm install` ở gốc, trong khi repo là monorepo — mỗi tool có package.json riêng.
            // Thêm `jszip` vào tao-card xong bấm Cập nhật thì Tạo Card nổ
            // "Failed to resolve import jszip", trắng màn hình. `update.bat` vốn làm đúng; hai
            // đường cập nhật lệch nhau mà đường trong app mới là đường user hay bấm.
            runUpdateAndInstall(res, { mode: 'update' });
            return;
          }

          if (req.url === '/api/downgrade' && req.method === 'POST') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            
            // Hạ cấp cũng phải cài lại thư viện cho mọi tool con: bản cũ có thể dùng bộ thư viện
            // KHÁC bản mới (thiếu, hoặc thừa mà sai phiên bản) — cùng một cái bẫy với Cập nhật.
            runUpdateAndInstall(res, { mode: 'downgrade' });
            return;
          }

          // ═══ (bugNeedFix/146) DANH SÁCH PHIÊN BẢN + LOG ═══
          // User: "Gộp 2 nút mũi tên lên/xuống thành 1 nút chung vì hạ từng bản rất cực. Khi bấm
          // vào sẽ hiện danh sách tất cả các phiên bản từ trước tới nay để chọn. Bên cạnh mỗi phiên
          // bản có thêm nút Log để xem thông tin update, để mọi người xem được log khi cậu Sky bận."
          if (req.url === '/api/versions' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            const root = process.cwd();
            try {
              // fetch trước để thấy cả các bản MỚI HƠN bản đang dùng (không có bước này thì
              // sau khi hạ cấp sẽ không còn đường nào quay lại bản mới).
              try { execSync('git fetch origin main --quiet', { cwd: root, timeout: 20000 }); } catch { /* offline vẫn liệt kê được bản cục bộ */ }
              const head = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
              // \x1f ngăn trường, \x1e ngăn bản ghi — an toàn với nội dung commit nhiều dòng.
              const raw = execSync(
                'git log origin/main -n 60 --date=format:%d/%m/%Y %H:%M --format=%H\x1f%h\x1f%ad\x1f%an\x1f%s\x1f%b\x1e',
                { cwd: root, maxBuffer: 8 * 1024 * 1024 },
              ).toString();
              const versions = raw.split('\x1e').map(r => r.trim()).filter(Boolean).map(rec => {
                const [sha, short, date, author, subject, body] = rec.split('\x1f');
                return { sha, short, date, author, subject, body: (body ?? '').trim(), current: sha === head };
              });
              res.end(JSON.stringify({ ok: true, head, versions }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
            }
            return;
          }

          if ((req.url ?? '').startsWith('/api/goto') && req.method === 'POST') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            const ref = new URL(req.url ?? '', 'http://x').searchParams.get('ref') ?? '';
            // Chỉ nhận mã commit dạng hex — chặn mọi thứ có thể biến thành lệnh shell khác.
            if (!/^[0-9a-f]{7,40}$/i.test(ref)) {
              res.statusCode = 400;
              res.end('Mã phiên bản không hợp lệ.\n');
              return;
            }
            runUpdateAndInstall(res, { mode: 'goto', ref });
            return;
          }

          const match = (req.url ?? '').match(/^\/api-proxy\/custom\/([A-Za-z0-9_-]+)\/(.*)/);
          if (match) {
            try {
              const targetOrigin = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
              // Rewrite the URL to just the path part
              req.url = `/${match[2]}`;
              dynamicProxy.web(req, res, { target: targetOrigin });
              return; // Do not call next() since we handled it
            } catch (e) {
              console.error('[dynamic proxy] Invalid base64 origin:', e);
              res.statusCode = 400;
              res.end('Invalid proxy origin');
              return;
            }
          }
          next();
        });
      }
    }
  ],
  server: {
    // Fixed port so the Hub (this app) is always reachable at a stable URL and the
    // combined start.bat can open it deterministically. strictPort => fail instead of
    // silently hopping to 5175/etc. (which would break the card-tool iframe URL).
    port: 5173,
    strictPort: true,
    open: true,
    // ─── CORS Proxy ───
    // These proxies let the browser call /api-proxy/openai/... etc.
    // and Vite forwards them server-side, bypassing CORS entirely.
    proxy: {
      '/api-proxy/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/openai/, ''),
        secure: true,
      },
      '/api-proxy/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/anthropic/, ''),
        secure: true,
      },
      '/api-proxy/google': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/google/, ''),
        secure: true,
      },
    },
  },
})
