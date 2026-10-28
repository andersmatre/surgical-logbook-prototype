// End-to-end test in jsdom against a real in-process server:
// first login with the initial password -> choose password -> log -> auto-sync -> log out ->
// log in again on a "new tablet" (empty local storage) -> entries come back from the server.
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createServer } from '../server/app.js';
import { addUser } from '../server/lib.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.scrollTo = () => {};
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.LOGBOOK_SYNC_DELAY = 30;

const server = await createServer({ dbPath: ':memory:' });
const port = await server.listen(0, '127.0.0.1');
globalThis.LOGBOOK_API_BASE = `http://127.0.0.1:${port}`;
await addUser(server.db, 'cc 1234', 'initial-pw-1'); // the admin creates the account: stored as CC1234

const { init } = await import('../app.js');
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const click = async (el, ms) => { assert.ok(el, 'element to click exists'); el.click(); await wait(ms); };
const byText = (sel, text, scope = document) => $$(sel, scope).find((e) => e.textContent.includes(text));
const submit = async (form, ms = 300) => {
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await wait(ms);
};
const serverEvents = () => server.db.prepare("SELECT COUNT(*) AS n FROM events WHERE owner = 'CC1234'").get().n;

test.after(async () => { await server.close(); });

test('login, first password, logging, sync, logout, login on a new tablet', async () => {
  await init();
  await wait();

  // ---- login screen
  assert.ok($('#cand'), 'login screen shown when nobody is logged in');
  await submit($('.setup-form'));
  assert.match($('.error').textContent, /Enter your candidate number/);
  $('#cand').value = 'cc1234';
  await submit($('.setup-form'));
  assert.match($('.error').textContent, /Enter your password/);
  $('#pw').value = 'not-the-password';
  await submit($('.setup-form'));
  assert.match($('.error').textContent, /Wrong candidate number or password/);
  assert.equal($('.setup-form button').disabled, false, 'the button works again after a failed login');

  $('#pw').value = 'initial-pw-1';
  await submit($('.setup-form'), 500);

  // ---- must choose own password
  assert.match($('h1').textContent, /Choose your own password/);
  $('#oldpw').value = 'initial-pw-1';
  $('#newpw').value = 'short';
  $('#reppw').value = 'short';
  await submit($('.setup-form'));
  assert.match($('.error').textContent, /at least 8/);
  $('#newpw').value = 'my-own-secret-1';
  $('#reppw').value = 'something-else';
  await submit($('.setup-form'));
  assert.match($('.error').textContent, /not the same/);
  $('#reppw').value = 'my-own-secret-1';
  await submit($('.setup-form'), 600);

  // ---- hospital, then the main screen
  assert.ok($('#hosp'), 'hospital question is shown once per tablet');
  $('#hosp').value = 'Masanga Hospital';
  await submit($('.setup-form'));
  assert.ok($('.top'), 'main screen');
  assert.match($('.who').textContent, /CC1234 · Masanga Hospital/);
  assert.equal(JSON.parse(localStorage.getItem('logbook.session')).must_change, false);

  // ---- log two entries; they are sent automatically
  await click(byText('.proc', 'Caesarean section'));
  await click(byText('.role', 'Surgeon, independent'));
  await click(byText('.proc', 'Appendectomy'));
  await click(byText('.role', 'Observing'), 400);
  assert.equal(serverEvents(), 2);
  assert.equal($('.chip').textContent, 'Up to date');

  // ---- offline: entries wait, then go out when the connection returns
  window.dispatchEvent(new window.Event('offline'));
  assert.match($('.chip').textContent, /Offline/);
  await click(byText('.proc', 'Laparotomy'));
  await click(byText('.role', 'Assisting'), 200);
  assert.equal(serverEvents(), 2, 'nothing sent while offline');
  assert.equal($('.chip').textContent, 'Offline · 1 waiting');
  window.dispatchEvent(new window.Event('online'));
  await wait(400);
  assert.equal(serverEvents(), 3);
  assert.equal($('.chip').textContent, 'Up to date');

  // ---- supervisor sign-off is synced too
  await click(byText('.tab', 'History'));
  await click(byText('.btn', 'Supervisor sign-off'));
  $('.pin').value = '1111';
  await click(byText('.btn', 'Next'));
  await click(byText('.btn', 'Sign selected'), 400);
  assert.equal(serverEvents(), 6); // 3 entries + 3 signatures

  // ---- change password from the More tab
  await click(byText('.tab', 'More'));
  await click(byText('.btn', 'Change password'));
  $('#oldpw').value = 'my-own-secret-1';
  $('#newpw').value = 'even-better-secret-2';
  $('#reppw').value = 'even-better-secret-2';
  await submit($('.sheet .setup-form'), 600);
  assert.match($('#toast').textContent, /Password changed/);

  // ---- log out: confirms, wipes this tablet, shows the login screen
  await click(byText('.btn', 'Log out'), 200);
  assert.match($('.sheet').textContent, /safe on the server/);
  await click(byText('.btn.danger', 'Log out'), 500);
  assert.ok($('#cand'), 'login screen after logout');
  assert.equal(localStorage.getItem('logbook.session'), null);

  // ---- "new tablet": nothing stored locally; the old password no longer works
  $('#cand').value = 'CC1234';
  $('#pw').value = 'my-own-secret-1';
  await submit($('.setup-form'));
  assert.match($('.error').textContent, /Wrong candidate number or password/);
  $('#pw').value = 'even-better-secret-2';
  await submit($('.setup-form'), 700);
  assert.ok($('#hosp'), 'a fresh tablet asks for the hospital again');
  $('#hosp').value = 'Bo Government Hospital';
  await submit($('.setup-form'));

  // the history came back from the server
  assert.match(byText('.proc', 'Caesarean section').textContent, /1 logged/);
  assert.match(byText('.proc', 'Appendectomy').textContent, /1 logged/);
  assert.match(byText('.proc', 'Laparotomy').textContent, /1 logged/);
  assert.equal($('.chip').textContent, 'Up to date');
  await click(byText('.tab', 'History'));
  assert.equal($$('.entry').length, 3);
  assert.equal($$('.tag.ok').length, 3, 'signatures came back too');
});

test('logging out with unsent entries warns and offers to lose them', async () => {
  // still logged in as CC1234 from the previous test
  window.dispatchEvent(new window.Event('offline'));
  await click(byText('.tab', 'Log'));
  await click(byText('.proc', 'Inguinal hernia repair'));
  await click(byText('.role', 'Surgeon, supervised'), 200);
  await click(byText('.tab', 'More'));
  await click(byText('.btn', 'Log out'), 200);
  assert.match($('.sheet').textContent, /NOT been sent/);
  assert.ok(byText('.btn.danger', 'Log out and lose entries'));
  await click(byText('.btn', 'Cancel'));
  assert.ok($('.top'), 'still logged in after cancel');
  assert.equal($$('.sheet').length, 0);
});

test('a session ended by the server returns to login and keeps the local entries', async () => {
  window.dispatchEvent(new window.Event('online'));
  await wait(400); // the waiting entry is sent
  const before = serverEvents();
  server.db.prepare('DELETE FROM sessions').run(); // e.g. the account was disabled, or the password changed elsewhere
  await click(byText('.tab', 'Log'));
  await click(byText('.proc', 'Umbilical hernia repair'));
  await click(byText('.role', 'Observing'), 500);
  assert.ok($('#cand'), 'back at the login screen');
  assert.match(document.body.textContent, /session has ended/);
  assert.equal(serverEvents(), before);

  $('#cand').value = 'CC1234';
  $('#pw').value = 'even-better-secret-2';
  await submit($('.setup-form'), 700);
  assert.match(byText('.proc', 'Umbilical hernia repair').textContent, /1 logged/, 'the entry made while logged out is still there');
  await wait(400);
  assert.equal(serverEvents(), before + 1, 'and it reached the server after logging in again');
});
