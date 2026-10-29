// dev/dev-server.mjs — a development server for front-end work. NOT part of the app and never deployed.
//
//   npm run dev                  http://localhost:5173  (demo data is created on the first start)
//   npm run dev -- --reset       throw the dev database away and start with fresh demo data
//   npm run dev -- --lan         also reachable from other devices on the same network (a tablet)
//   npm run dev -- --port 4000
//
// What it does, and why:
//   - Serves the app files straight from the project folder with no caching, so a reload always shows
//     your latest edit. (The real server caches files for 5 minutes, and sw.js caches them for ever.)
//   - Replaces sw.js with an empty service worker, so nothing is served from an old offline cache.
//     The real sw.js is untouched and still what gets deployed.
//   - Reloads the page when you save a file. A saved .css file is swapped in without a reload, so the
//     screen you are looking at stays as it is.
//   - Runs the real API (server/app.js) in this process on data/dev.db and forwards /api/* to it,
//     so the app and the API have one address and there is nothing to configure.
// None of this changes the app files: the reload script is added to index.html while it is sent.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from '../server/app.js';
import { seedDemo, resetDb, assertSafeDbPath, devDbPath, DEMO_ACCOUNTS, DEMO_PASSWORD } from './seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
// Never served, even though they are inside the project folder.
const HIDDEN = new Set(['server', 'data', 'test', 'dev', 'node_modules', '.git']);

const EMPTY_SW = `// dev: an empty service worker. It removes the offline caches and handles no requests.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
`;

const RELOAD_SCRIPT = `<script>
// dev only: added by dev/dev-server.mjs, not part of the app
(() => {
  const es = new EventSource('/__dev/events');
  es.onmessage = (m) => {
    if (m.data === 'css') {
      for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
        const u = new URL(l.href); u.searchParams.set('dev', Date.now()); l.href = u.href;
      }
    } else location.reload();
  };
  es.onerror = () => { document.title = '(dev server stopped) ' + document.title.replace(/^\\(dev server stopped\\) /, ''); };
  es.onopen = () => { document.title = document.title.replace(/^\\(dev server stopped\\) /, ''); };
})();
</script>`;

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

// Maps a URL path to a file inside the project folder, or null if it must not be served.
export function resolveStatic(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  const parts = path.relative(ROOT, file).split(path.sep);
  if (parts.some((p) => HIDDEN.has(p) || p.startsWith('.'))) return null;
  if (!TYPES[path.extname(file).toLowerCase()]) return null;
  try { if (!fs.statSync(file).isFile()) return null; } catch { return null; }
  return file;
}

export async function startDevServer({ port = 5173, host = '127.0.0.1', dbPath = devDbPath(), reset = false, quiet = false, watch = true } = {}) {
  assertSafeDbPath(dbPath);
  if (reset) resetDb(dbPath);

  // The real API, in this process, on a port only this machine can reach.
  const api = await createServer({ dbPath, serveStatic: false });
  const seeded = await seedDemo(api.db);
  const apiPort = await api.listen(0, '127.0.0.1');

  const watchers = new Set(); // open browser tabs (server-sent events)
  const broadcast = (kind) => { for (const res of watchers) res.write(`data: ${kind}\n\n`); };

  const proxy = (req, res) => {
    const up = http.request({
      host: '127.0.0.1', port: apiPort, method: req.method, path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
    }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'dev_api_down', message: 'The dev API is not running.' }));
    });
    req.pipe(up);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname.startsWith('/api/')) return proxy(req, res);

    if (url.pathname === '/__dev/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write('retry: 500\n\n');
      watchers.add(res);
      req.on('close', () => watchers.delete(res));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    if (url.pathname === '/sw.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      return res.end(EMPTY_SW);
    }
    const file = resolveStatic(url.pathname);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    let body = fs.readFileSync(file);
    if (path.basename(file) === 'index.html' && path.dirname(file) === ROOT) {
      body = Buffer.from(body.toString('utf8').replace('</body>', `${RELOAD_SCRIPT}\n</body>`));
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] });
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  const keepAlive = setInterval(() => { for (const res of watchers) res.write(': keep-alive\n\n'); }, 20000);
  keepAlive.unref();

  // Watch the project folder. Editors save in several steps, so wait a moment and send one message.
  let watcher = null;
  let timer = null;
  let pending = null;
  if (watch) {
    watcher = fs.watch(ROOT, { recursive: true }, (_event, name) => {
      if (!name) return;
      const parts = String(name).split(/[\\/]/);
      if (parts.some((p) => HIDDEN.has(p) || p.startsWith('.') || p.endsWith('~') || p.endsWith('.swp'))) return;
      if (!TYPES[path.extname(name).toLowerCase()]) return;
      pending = name.endsWith('.css') && (pending === null || pending === 'css') ? 'css' : 'reload';
      clearTimeout(timer);
      timer = setTimeout(() => { broadcast(pending); pending = null; }, 80);
    });
  }

  const actual = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });

  if (!quiet) {
    console.log(`\nDev server: http://localhost:${actual}`);
    if (host !== '127.0.0.1') for (const ip of lanAddresses()) console.log(`On your network: http://${ip}:${actual}`);
    console.log(`Database: ${dbPath}${seeded ? '  (demo data created)' : ''}`);
    console.log(`\nDemo accounts, password "${DEMO_PASSWORD}":`);
    for (const a of DEMO_ACCOUNTS) console.log(`  ${a.id.padEnd(11)} ${a.role.padEnd(11)} ${a.note}`);
    console.log('\nSaving a file reloads the page (a .css file is swapped in without a reload). Stop with Ctrl+C.\n');
  }

  return {
    port: actual, apiPort, db: api.db, broadcast,
    close: async () => {
      clearInterval(keepAlive);
      clearTimeout(timer);
      watcher?.close();
      for (const res of watchers) res.end();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await api.close();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const lan = args.includes('--lan');
  try {
    const dev = await startDevServer({
      port: Number(flag('port') || process.env.DEV_PORT || 5173),
      host: lan ? '0.0.0.0' : '127.0.0.1',
      reset: args.includes('--reset'),
    });
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await dev.close(); process.exit(0); });
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `That port is already in use. Try: npm run dev -- --port 5174` : e.message);
    process.exit(1);
  }
}
