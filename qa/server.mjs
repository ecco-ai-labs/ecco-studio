// Local/CI fixture host. Never deploy this server or expose it to the internet.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.mp4':'video/mp4', '.wav':'audio/wav'};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if(relative.endsWith('/'))relative+='index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root) || relative.split('/').some(p=>p.startsWith('.')) || !['GET','HEAD'].includes(req.method)) {
      res.writeHead(403); res.end(); return;
    }
    if (!(await stat(filename)).isFile()) { res.writeHead(404);res.end();return; }
    let body = await readFile(filename);
    if (relative === 'index.html' && (url.searchParams.get('__qa') === '1' || url.searchParams.get('tester') === '1')) {
      body = Buffer.from(body.toString()
        .replace(/<link[^>]+href="https:[^>]+>/g, '')
        .replace('<head>', '<head><script src="/qa/tests/bootstrap.js"></script>')
        .replace('</body>', '<script src="/qa/tests/fixture.js"></script></body>'));
      // Inject a known defect (library search ignores typing) only into the runner's isolated fixture.
      // This verifies detection even after production search is repaired.
      if(url.searchParams.get('tester')==='1')body=Buffer.from(body.toString().replace('</head>','<script>document.addEventListener("input",e=>{if(e.target&&e.target.id==="lh-search")e.stopImmediatePropagation();},true)</script></head>'));
      // PDF tests fulfill these three pinned reader assets from npm locally; the browser route still blocks external traffic.
      const reader=url.searchParams.get('pdf')==='1'?' https://cdn.jsdelivr.net':'';
      res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'"+reader+"; style-src 'self' 'unsafe-inline'"+reader+"; worker-src 'self' blob:; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'");
    }
    if(relative==='desk/index.html'&&url.searchParams.get('__qa')==='1'){
      body=Buffer.from(body.toString().replace('<head>','<head><script src="/qa/tests/desk-bootstrap.js"></script>'));
      res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'self'; object-src 'none'");
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
      if (start > end) { res.writeHead(416);res.end();return; }
      res.writeHead(206, {'Content-Range':`bytes ${start}-${end}/${body.length}`, 'Accept-Ranges':'bytes', 'Content-Length':end-start+1});
      res.end(req.method==='HEAD'?undefined:body.subarray(start,end+1));
    } else {
      res.writeHead(200, {'Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
    }
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', ()=>console.log('Ecco QA fixture server ready'));
