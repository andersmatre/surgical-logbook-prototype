// Guards against forgetting a file in one of the three places that list the app files:
// the service worker (offline cache), the server (what it may serve) and the Dockerfile (what is copied).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from '../server/app.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('every app file is cached by the service worker, served by the server and copied into the image', async () => {
  const sw = read('sw.js');
  const list = /const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1];
  const assets = [...list.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(assets.includes('supervisor.js') && assets.includes('ui.js') && assets.includes('app.js'));

  const dockerfile = read('Dockerfile');
  const s = await createServer({ dbPath: ':memory:', serveStatic: true });
  const port = await s.listen(0, '127.0.0.1');
  try {
    for (const f of assets) {
      assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${f} exists`);
      assert.equal((await fetch(`http://127.0.0.1:${port}/${f}`)).status, 200, `server serves /${f}`);
      assert.ok(dockerfile.includes(f), `Dockerfile copies ${f}`);
    }
  } finally { await s.close(); }
});

test('every local import in the app files is listed, so the app works offline', () => {
  const sw = read('sw.js');
  for (const file of ['app.js', 'core.js', 'api.js', 'ui.js', 'supervisor.js', 'config.js']) {
    for (const m of read(file).matchAll(/from '\.\/([^']+)'/g)) {
      assert.ok(sw.includes(`'./${m[1]}'`), `${file} imports ./${m[1]}, which sw.js must cache`);
    }
  }
});

test('the page is not drawn under the system bars (Android Chrome leaves an empty strip at the bottom)', () => {
  assert.ok(!/viewport-fit\s*=\s*cover/.test(read('index.html')), 'index.html must not use viewport-fit=cover (empty white strip at the bottom)');
});

test('the version is the same in config.js, package.json, the service worker cache name and PROJECT.md', () => {
  const v = /APP_VERSION = '([^']+)'/.exec(read('config.js'))[1];
  assert.equal(JSON.parse(read('package.json')).version, v);
  assert.ok(read('sw.js').includes(`'logbook-v${v}'`), 'bump CACHE in sw.js together with APP_VERSION');
  assert.ok(read('PROJECT.md').includes(`Version **${v}**`), 'update the "Version **x.y.z**" line in section 2 of PROJECT.md together with APP_VERSION');
});
