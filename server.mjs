import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const allowed = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/detector.js', ['detector.js', 'text/javascript; charset=utf-8']],
  ['/worker.js', ['worker.js', 'text/javascript; charset=utf-8']],
  ['/vision.js', ['vision.js', 'text/javascript; charset=utf-8']],
  ['/demo-view.js', ['demo-view.js', 'text/javascript; charset=utf-8']],
  ['/object-tracker.js', ['object-tracker.js', 'text/javascript; charset=utf-8']],
  ['/appearance.js', ['appearance.js', 'text/javascript; charset=utf-8']],
  ['/local-media.js', ['local-media.js', 'text/javascript; charset=utf-8']],
  ['/media-platform.js', ['media-platform.js', 'text/javascript; charset=utf-8']],
  ['/pwa.js', ['pwa.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/icons/icon.svg', ['icons/icon.svg', 'image/svg+xml']],
  ['/icons/icon-192.png', ['icons/icon-192.png', 'image/png']],
  ['/icons/icon-512.png', ['icons/icon-512.png', 'image/png']],
  ['/icons/apple-touch-icon.png', ['icons/apple-touch-icon.png', 'image/png']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
export async function application(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
  }
  const asset = allowed.get(new URL(req.url, 'http://localhost').pathname);
  if (!asset) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(join(root, asset[0]));
    res.writeHead(200, {
      'Content-Type': asset[1], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(self), microphone=()',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500).end('Unable to read application file'); }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startDesktop();
function startDesktop() {
const server = http.createServer(application);
let port = Number(process.env.PORT || 8765);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
let attempts = 0;
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && attempts++ < 20 && port < 65535) {
    server.listen(++port, '127.0.0.1');
  } else { console.error(error.message); process.exitCode = 1; }
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Feature Lens: ${url}\nClose this window or press Ctrl+C to stop the server.`);
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  }
});
}
