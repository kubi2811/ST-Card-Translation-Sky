/**
 * Bàn thử front-end ngoài SillyTavern (bug 192).
 *
 *   node frontend-kit/harness/serve.mjs        → http://127.0.0.1:8791/opening
 *                                               http://127.0.0.1:8791/main
 *
 * Nó rút ĐÚNG khối HTML mà build.mjs vừa nhét vào card (bóc lớp ``` bọc ngoài),
 * chèn thêm bộ giả lập API rồi phục vụ qua HTTP. Nghĩa là thứ đang chạy trên trình
 * duyệt chính là thứ sẽ chạy trong quán rượu, không phải một bản chép tay khác.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CARD = path.join(REPO, 'bug', '192', 'output', 'Hành Tinh Eldran - Front-End.json');
const PORT = Number(process.env.PORT || 8791);

function unfence(s) {
  const m = String(s).match(/```\n([\s\S]*?)\n```/);
  return m ? m[1] : String(s);
}

function payloads() {
  const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
  const scripts = card.data.extensions.regex_scripts;
  const get = (name) => scripts.find((s) => s.scriptName === name);
  return {
    opening: unfence(get('[FE] Màn Khởi Tạo').replaceString),
    main: unfence(get('[FE] Màn Chính').replaceString),
  };
}

function wrap(html, which) {
  const mock = fs.readFileSync(path.join(HERE, 'mock-tavern.js'), 'utf8');
  const panel = `
<div style="position:fixed;right:0;top:0;bottom:0;width:34vw;overflow:auto;background:#05080d;color:#9fb3cd;
     font:12px/1.45 ui-monospace,Consolas,monospace;padding:10px;border-left:1px solid #223;z-index:99999">
  <div style="color:#4dd6c1;font-weight:700;margin-bottom:6px">BÀN THỬ · ${which}</div>
  <div id="mock-banner" style="color:#f0b862;margin-bottom:8px"></div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    <button onclick="window.__mockReset()">Reset</button>
    <button onclick="window.__mockFail=true">Cho lượt sau lỗi</button>
    <button onclick="window.__mockDump()">Xem lại</button>
  </div>
  <pre id="mock-dump" style="white-space:pre-wrap;word-break:break-word"></pre>
</div>
<style>body{margin-right:35vw !important}</style>`;

  return html
    .replace('</head>', `<script>\n${mock}\n</script>\n</head>`)
    .replace('</body>', `${panel}\n<script>setTimeout(function(){window.__mockDump&&window.__mockDump();},300)</script>\n</body>`);
}

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  // Nhận lại đúng đoạn script mà SillyTavern đã nhả vào iframe, để so từng ký tự
  // với bản mình dựng ra — cách duy nhất thấy được ST đã sửa cái gì ở giữa đường.
  if (req.method === 'POST' && req.url.startsWith('/__dump')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fs.writeFileSync(path.join(HERE, 'dump-from-st.txt'), body, 'utf8');
      res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' });
      res.end('ok ' + body.length);
    });
    return;
  }

  if (req.url.startsWith('/raw/')) {
    const p0 = payloads();
    const which0 = req.url.includes('main') ? 'main' : 'opening';
    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(p0[which0]);
  }

  const p = payloads();
  const which = req.url.startsWith('/main') ? 'main' : 'opening';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(wrap(p[which], which === 'main' ? 'MÀN CHÍNH' : 'MÀN KHỞI TẠO'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bàn thử chạy ở http://127.0.0.1:${PORT}/opening  và  /main`);
});
