// Tests for the development tools in dev/ (not part of the app): the demo data and the dev server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/lib.js';
import { seedDemo, DEMO_ACCOUNTS, DEMO_PASSWORD, assertSafeDbPath } from '../dev/seed.mjs';
import { startDevServer, resolveStatic } from '../dev/dev-server.mjs';

const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;

test('the demo data has every kind of account and every kind of screen state', async () => {
  const db = openDb(':memory:');
  assert.equal(await seedDemo(db), true);
  assert.equal(await seedDemo(db), false, 'seeding twice changes nothing');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM users'), DEMO_ACCOUNTS.length);
  assert.equal(count(db, "SELECT COUNT(*) n FROM events WHERE owner = 'CC1001' AND type = 'entry'"), 60);
  assert.equal(count(db, "SELECT COUNT(*) n FROM events WHERE owner = 'CC1001' AND type = 'sign'"), 35);
  assert.equal(count(db, "SELECT COUNT(*) n FROM events WHERE owner = 'CC1001' AND type = 'void'"), 3);
  assert.equal(count(db, "SELECT COUNT(*) n FROM events WHERE owner = 'CC1003' AND type = 'sign'"), 0, 'CC1003 has nothing signed');
  assert.equal(count(db, "SELECT COUNT(*) n FROM events WHERE owner = 'CC1004'"), 0, 'CC1004 is the empty state');
  assert.equal(count(db, "SELECT COUNT(*) n FROM assignments WHERE student = 'CC1004'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) n FROM users WHERE candidate = 'CC1099' AND must_change = 1"), 1, 'CC1099 must still choose a password');
  assert.equal(count(db, "SELECT COUNT(*) n FROM users WHERE candidate = 'CC1001' AND must_change = 0"), 1);
  // A voided entry is never one that was signed (the server would not allow it).
  assert.equal(count(db, "SELECT COUNT(*) n FROM events v JOIN events s ON s.owner = v.owner AND s.target = v.target AND s.type = 'sign' WHERE v.type = 'void'"), 0);
  db.close();
});

test('the dev tools refuse to touch the real database file', () => {
  assert.throws(() => assertSafeDbPath(path.resolve('data/logbook.db')), /real database/);
  assert.doesNotThrow(() => assertSafeDbPath(path.resolve('data/dev.db')));
});

test('resolveStatic serves app files only', () => {
  assert.ok(resolveStatic('/')?.endsWith('index.html'));
  assert.ok(resolveStatic('/app.js')?.endsWith('app.js'));
  assert.ok(resolveStatic('/style.css'));
  for (const p of ['/server/lib.js', '/data/dev.db', '/test/ui.test.mjs', '/dev/seed.mjs', '/PROJECT.md', '/local.env',
    '/package.json', '/.git/config', '/../etc/passwd', '/%2e%2e/etc/passwd', '/nope.js', '/Dockerfile']) {
    assert.equal(resolveStatic(p), null, `${p} must not be served`);
  }
});

test('the dev server serves fresh files, an empty service worker, live reload and the API', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-dev-'));
  const dev = await startDevServer({ port: 0, dbPath: path.join(dir, 'dev.db'), quiet: true, watch: false });
  t.after(async () => { await dev.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${dev.port}`;

  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  const html = await index.text();
  assert.ok(html.includes('/__dev/events'), 'live reload is added to index.html');
  assert.ok(html.includes("import { init } from './app.js'"), 'the rest of index.html is unchanged');
  assert.ok(!fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').includes('__dev'), 'the file on disk is not changed');

  const css = await fetch(base + '/style.css?dev=123');
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('cache-control'), 'no-store');

  const sw = await (await fetch(base + '/sw.js')).text();
  assert.ok(!sw.includes('ASSETS') && !sw.includes("addEventListener('fetch'"), 'the dev service worker caches nothing and handles no requests');

  assert.equal((await fetch(base + '/server/lib.js')).status, 404);
  assert.equal((await fetch(base + '/data/dev.db')).status, 404);

  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.ok, true);

  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate: 'CC1001', password: DEMO_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.role, 'student');
  assert.equal(session.must_change_password, false);

  const fresh = await (await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate: 'CC1099', password: DEMO_PASSWORD }),
  })).json();
  assert.equal(fresh.must_change_password, true);
});

test('a saved file is announced to open pages: css without a reload, anything else with one', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-dev-'));
  const dev = await startDevServer({ port: 0, dbPath: path.join(dir, 'dev.db'), quiet: true, watch: false });
  t.after(async () => { await dev.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${dev.port}/__dev/events`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const until = async (re) => {
    const stop = Date.now() + 3000;
    while (!re.test(seen) && Date.now() < stop) {
      const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: false }), 200))]);
      if (done) break;
      if (value) seen += decoder.decode(value);
    }
    assert.match(seen, re);
  };
  await until(/retry: 500/);
  dev.broadcast('css');
  await until(/data: css/);
  dev.broadcast('reload');
  await until(/data: reload/);
  ctrl.abort();
});
