import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import httpProxy from 'http-proxy';
import { exec } from 'child_process';

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

        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/update' && req.method === 'POST') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            
            res.write('Đang tải bản mới nhất từ GitHub...\n');
            const child = exec('git pull && npm install');
            
            child.stdout?.on('data', (data) => {
              res.write(data);
            });
            child.stderr?.on('data', (data) => {
              res.write(data);
            });
            child.on('close', (code) => {
              res.write(`\nCập nhật hoàn tất (code ${code}). Vui lòng tải lại trang hoặc khởi động lại app nếu cần.\n`);
              res.end();
            });
            return;
          }

          if (req.url === '/api/downgrade' && req.method === 'POST') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            
            res.write('Đang hạ cấp phiên bản xuống 1 commit (git reset --hard HEAD~1)...\n');
            const child = exec('git reset --hard HEAD~1 && npm install');
            
            child.stdout?.on('data', (data) => {
              res.write(data);
            });
            child.stderr?.on('data', (data) => {
              res.write(data);
            });
            child.on('close', (code) => {
              res.write(`\nHạ cấp hoàn tất (code ${code}). Vui lòng tải lại trang hoặc khởi động lại app nếu cần.\n`);
              res.end();
            });
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
