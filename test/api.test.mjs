// The ?api= override lets the hosted app (GitHub Pages) talk to a server on your own computer.
// It must never accept any other address: a link must not be able to redirect logins.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { origin: 'https://example.github.io', hostname: 'example.github.io' };
const api = await import('../api.js');

test.beforeEach(() => store.clear());

test('localhost addresses are remembered, and an empty ?api= clears them', () => {
  api.applyApiParam('?api=http://localhost:8080/');
  assert.equal(api.apiOverride(), 'http://localhost:8080');
  assert.equal(api.serverLabel(), 'http://localhost:8080');
  api.applyApiParam('?other=1'); // unrelated parameters change nothing
  assert.equal(api.apiOverride(), 'http://localhost:8080');
  api.applyApiParam('?api=');
  assert.equal(api.apiOverride(), null);
  assert.equal(api.serverLabel(), 'https://example.github.io');
  for (const ok of ['http://127.0.0.1:3000', 'https://localhost:8443', 'http://[::1]:8080']) {
    api.applyApiParam(`?api=${encodeURIComponent(ok)}`);
    assert.equal(api.apiOverride(), ok);
  }
});

test('any other address is ignored, also if it only looks like localhost', () => {
  for (const bad of [
    'https://evil.example', 'http://evil.example:8080', 'http://localhost.evil.example', 'http://localhost@evil.example',
    'http://localhost:8080/path', 'http://127.0.0.1.evil.example', 'javascript:alert(1)', 'http://localhost:99999999',
  ]) {
    api.applyApiParam(`?api=${encodeURIComponent(bad)}`);
    assert.equal(api.apiOverride(), null, bad);
  }
  store.set('logbook.api', 'https://evil.example'); // even a value planted in storage is not used
  assert.equal(api.apiOverride(), null);
});
