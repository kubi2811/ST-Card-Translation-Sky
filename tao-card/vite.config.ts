import { defineConfig } from 'vite'
import type { ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { exec, execSync } from 'child_process'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { IncomingMessage, ServerResponse } from 'http'
import fs from 'fs'
import path from 'path'

// ─── Card project cache (filesystem, in the project folder) ───────────────────
// Mirror of each project as a JSON file so work survives F5 / tab close / even
// switching browsers (IndexedDB is per-browser; these files are not). One file per
// project id. This folder is gitignored, so the in-app "Update" (git pull) never
// touches it — code updates only, user data stays put.
const CARD_CACHE_DIR = path.resolve(process.cwd(), 'card-progress')
const safeCacheName = (key: string) =>
  (key || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) + '.json'
const ensureCacheDir = () => { try { fs.mkdirSync(CARD_CACHE_DIR, { recursive: true }) } catch { /* ignore */ } }
const readCacheBody = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })

const cardCachePlugin = () => ({
  name: 'card-cache',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const url = req.url || ''
      if (!url.startsWith('/api/card-cache/')) return next()
      const sendJson = (code: number, obj: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        res.end(JSON.stringify(obj))
      }
      try {
        ensureCacheDir()
        if (url === '/api/card-cache/save' && req.method === 'POST') {
          const body = await readCacheBody(req)
          if (!body || typeof body.key !== 'string') return sendJson(400, { ok: false, error: 'missing key' })
          fs.writeFileSync(path.join(CARD_CACHE_DIR, safeCacheName(body.key)),
            JSON.stringify({ key: body.key, savedAt: Date.now(), data: body.data }), 'utf8')
          return sendJson(200, { ok: true })
        }
        if (url.startsWith('/api/card-cache/load') && req.method === 'GET') {
          const key = new URL(url, 'http://localhost').searchParams.get('key') || ''
          const file = path.join(CARD_CACHE_DIR, safeCacheName(key))
          if (!fs.existsSync(file)) return sendJson(404, { ok: false })
          return sendJson(200, { ok: true, ...JSON.parse(fs.readFileSync(file, 'utf8')) })
        }
        if (url === '/api/card-cache/list' && req.method === 'GET') {
          const files = fs.existsSync(CARD_CACHE_DIR) ? fs.readdirSync(CARD_CACHE_DIR).filter(f => f.endsWith('.json')) : []
          const items = files.map(f => {
            try {
              const raw = JSON.parse(fs.readFileSync(path.join(CARD_CACHE_DIR, f), 'utf8'))
              return { key: raw.key, savedAt: raw.savedAt }
            } catch { return null }
          }).filter(Boolean)
          return sendJson(200, { ok: true, items })
        }
        if (url === '/api/card-cache/delete' && req.method === 'POST') {
          const body = await readCacheBody(req)
          if (body && typeof body.key === 'string') {
            const file = path.join(CARD_CACHE_DIR, safeCacheName(body.key))
            if (fs.existsSync(file)) fs.unlinkSync(file)
          }
          return sendJson(200, { ok: true })
        }
        return sendJson(404, { ok: false, error: 'unknown card-cache endpoint' })
      } catch (err: any) {
        return sendJson(500, { ok: false, error: err?.message || String(err) })
      }
    })
  },
})

// ─── CORS Proxy Plugin ──────────────────────────────────────────────────────
// Forwards /api/cors-proxy/<encoded-url> to the real URL, bypassing CORS.
const corsProxyPlugin = () => ({
  name: 'cors-proxy',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const prefix = '/api/cors-proxy/';
      if (!req.url?.startsWith(prefix)) return next();

      const targetUrl = decodeURIComponent(req.url.slice(prefix.length));
      try {
        new URL(targetUrl);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid target URL' }));
        return;
      }

      // Read the incoming body
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // (bug 133) Forward headers — bỏ header định danh trình duyệt.
        // `sec-fetch-*`/`sec-ch-*` là dấu hiệu request chạy TRONG trình duyệt; Cloudflare của
        // Fandom thấy chúng đi kèm một IP máy chủ lạ thì coi là bot và trả 403. Gỡ đi thì
        // request trông như một client HTTP bình thường. `accept-encoding` cũng gỡ để nhận
        // body chưa nén (ta pipe thô, không giải nén được br/zstd).
        const forwardHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          const lk = key.toLowerCase();
          if (['host', 'origin', 'referer', 'connection', 'transfer-encoding', 'accept-encoding', 'cookie'].includes(lk)) continue;
          if (lk.startsWith('sec-')) continue;
          if (value) forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
        }
        if (!forwardHeaders['user-agent']) {
          forwardHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
        }
        forwardHeaders['accept-encoding'] = 'identity';
        if (body.length > 0 && !forwardHeaders['content-length']) {
          forwardHeaders['content-length'] = String(body.length);
        }

        // (bug 133) ĐI THEO REDIRECT. MediaWiki trả 301/302 rất nhiều (chuẩn hoá tiêu đề, trang
        // đổi tên, http→https). Bản cũ trả nguyên 301 về trình duyệt; fetch() của trình duyệt
        // KHÔNG tự đi tiếp được vì Location trỏ sang origin khác (bị CORS chặn) ⇒ mọi trang có
        // redirect đều thành "trang lỗi" — im lặng, và đó là phần lớn wiki lớn.
        const MAX_HOPS = 5;
        const send = (urlStr: string, hop: number) => {
          let parsed: URL;
          try { parsed = new URL(urlStr); } catch {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: `Redirect tới URL không hợp lệ: ${urlStr}` }));
            return;
          }
          const isHttps = parsed.protocol === 'https:';
          const reqFn = isHttps ? httpsRequest : httpRequest;

          const proxyReq = reqFn(
            {
              hostname: parsed.hostname,
              port: parsed.port || (isHttps ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: req.method || 'POST',
              headers: { ...forwardHeaders, host: parsed.host },
              timeout: 1800000, // 30 min — match AI client timeout
            },
            (proxyRes) => {
              const status = proxyRes.statusCode || 500;
              const loc = proxyRes.headers.location;
              // Chỉ đi tiếp với request không có body (GET/HEAD) — POST theo redirect là đổi
              // ngữ nghĩa, để nguyên cho caller quyết.
              if (status >= 300 && status < 400 && loc && hop < MAX_HOPS && body.length === 0) {
                proxyRes.resume();   // xả body để giải phóng socket
                send(new URL(loc, parsed).toString(), hop + 1);
                return;
              }

              // Set CORS headers so the browser accepts the response
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', '*');

              // Forward status + response headers (excluding problematic ones)
              res.statusCode = status;
              for (const [key, value] of Object.entries(proxyRes.headers)) {
                const lk = key.toLowerCase();
                if (['transfer-encoding', 'connection', 'access-control-allow-origin'].includes(lk)) continue;
                if (value) res.setHeader(key, value);
              }

              proxyRes.pipe(res);
            },
          );

          proxyReq.on('error', (err) => {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
          });

          if (body.length > 0) proxyReq.write(body);
          proxyReq.end();
        };

        send(targetUrl, 0);
      });
    });
  },
});

/**
 * (User 22/07) Đồng bộ mã nguồn RỒI CÀI THƯ VIỆN — trước đây hai endpoint dưới đây chạy
 * `git reset --hard` xong là xong, KHÔNG cài gì cả. Đây là đường cập nhật tệ nhất trong ba
 * đường của repo: kéo mã mới về mà thư viện mới thì không có, nên vừa thêm `jszip` vào
 * tao-card là Vite nổ "Failed to resolve import jszip", trắng màn hình.
 *
 * `git` tự đi ngược lên gốc repo nên phần đồng bộ vẫn đúng dù cwd là tao-card; chỉ phần cài
 * là phải làm ở CẢ gốc lẫn tao-card (mỗi nơi một package.json riêng).
 */
function syncThenInstall(gitCmd: string, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  const fail = (msg: string) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: msg }));
  };

  exec(gitCmd, (err, stdout, stderr) => {
    if (err) return fail(stderr || err.message);

    let repoRoot = '..';
    try {
      repoRoot = execSync('git rev-parse --show-toplevel').toString().trim() || '..';
    } catch { /* không lấy được thì dùng thư mục cha */ }

    // Cài tuần tự: gốc trước (Hub hỏng thì chẳng mở được tool nào), rồi tới tao-card.
    const dirs = [repoRoot, process.cwd()];
    let log = stdout;
    const next = (i: number) => {
      if (i >= dirs.length) {
        return res.end(JSON.stringify({ success: true, message: log }));
      }
      exec('npm install --no-audit --no-fund', { cwd: dirs[i], maxBuffer: 32 * 1024 * 1024 }, (e, out, errOut) => {
        log += `\n── npm install: ${dirs[i]} ──\n${out || ''}`;
        // Cài lỗi thì BÁO RÕ chứ không nuốt: nuốt đi thì user nhận "thành công" rồi mở tool
        // ra mới thấy trắng màn hình, không hiểu vì sao.
        if (e) return fail(`Đồng bộ mã nguồn xong nhưng cài thư viện ở "${dirs[i]}" thất bại:\n${errOut || e.message}`);
        next(i + 1);
      });
    };
    next(0);
  });
}

// Custom plugin to handle Git commands
const appUpdaterPlugin = () => ({
  name: 'app-updater',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      // Handle CORS preflight for proxy
      if (req.method === 'OPTIONS' && req.url?.startsWith('/api/cors-proxy/')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/api/app/upgrade') {
        // fetch + reset --hard: đồng bộ cứng về GitHub, không kẹt vì package-lock bị npm install sửa.
        syncThenInstall('git fetch origin main && git reset --hard origin/main', res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/app/downgrade') {
        syncThenInstall('git reset --hard HEAD~1', res);
        return;
      }
      
      next();
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), corsProxyPlugin(), appUpdaterPlugin(), cardCachePlugin()],
  server: {
    // Fixed port so the Hub (Dịch Card app) can embed this tool at a stable iframe URL.
    // strictPort => fail loudly instead of hopping ports and breaking the iframe.
    port: 5174,
    strictPort: true,
    fs: {
      strict: true,
      allow: ['.']
    }
  }
})
