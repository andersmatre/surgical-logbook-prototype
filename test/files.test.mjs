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

test('no class names that ad blockers hide (they did hide "adv-text" on the live site)', () => {
  const css = read('style.css');
  const names = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const adLike = [...names].filter((n) => /^(ad|ads|adv|advert|sponsor|promo)(-|$)/i.test(n));
  assert.deepEqual(adLike, [], 'rename these classes in style.css and the scripts');
});

test('the service worker fills a new cache with fresh files, never with copies from the browser cache', () => {
  assert.match(read('sw.js'), /cache: 'reload'/, 'otherwise a new version can be stored with old files mixed in');
});

test('a pop-up fades in as one piece: the dark layer, the pop-up and its arrows together', () => {
  const css = read('style.css');
  assert.match(css, /#overlay\.open, \.layer \{ animation: sheet-in/, 'the whole overlay fades, not only the pop-up');
  assert.doesNotMatch(/\n\.sheet \{[^}]*\}/.exec(css)[0], /animation/, 'the pop-up has no fade of its own: on an iPad that looked like two steps');
  assert.match(css, /\n\.scroll-hint \{[^}]*\}/);
  assert.doesNotMatch(/\n\.scroll-hint \{[^}]*\}/.exec(css)[0], /animation/, 'an arrow only fades (.fade) when it comes later, not with the pop-up');
});

test('no grey line above Cancel and Save in a pop-up', () => {
  assert.doesNotMatch(/\n\.sheet-foot \{[^}]*\}/.exec(read('style.css'))[0], /border/, 'the fade under the arrow already shows where the content ends');
});

test('a wide table does not bounce sideways past its first column', () => {
  assert.match(/\n\.scroll \{[^}]*\}/.exec(read('style.css'))[0], /overscroll-behavior-x: none/,
    'on iPad, iPhone and Android the "Each student" table could be pulled past its edge into an empty strip');
});

test('the page does not jump sideways when a scrollbar appears', () => {
  assert.match(/\n\.shell > \.main \{[^}]*\}/.exec(read('style.css'))[0], /scrollbar-gutter: stable both-edges/,
    'the room for the scrollbar is always kept, on both sides so the page stays in the middle under the header');
});

test('on a touch screen a short page can still be dragged: .page is a little taller than the area that scrolls', () => {
  assert.match(read('style.css'), /@media \(pointer: coarse\) \{ \.shell > \.main > \.page \{ min-height: calc\(100% \+ 1px\); \} \}/,
    'without it Log and More do not move at all on a phone and the app feels frozen; only on touch, so a mouse wheel does not move a short page');
});
