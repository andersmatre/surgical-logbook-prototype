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

// What a supervisor's own app does, called directly: the student UI test only needs the signatures to exist.
const post = async (path, token, body = {}) => (await fetch(`http://127.0.0.1:${port}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})).json();
async function supervisorToken() { // a fresh login each time: other tests clear all sessions
  return (await post('/api/login', null, { candidate: 'SUP-ANNA', password: 'sup-own-secret-1' })).token;
}

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

  // ---- no supervisor yet: the History tab says so, and there is no sign-off button
  await click(byText('.tab', 'History'));
  assert.match($('.note-info').textContent, /No supervisor has added you yet/);
  assert.equal(byText('.btn', 'Supervisor sign-off'), undefined);
  assert.equal($$('.tag.ok').length, 0);

  // ---- a supervisor adds the student and signs on the server
  await addUser(server.db, 'sup-anna', 'sup-initial-1', { role: 'supervisor', name: 'Dr Anna Kamara' });
  const first = (await post('/api/login', null, { candidate: 'SUP-ANNA', password: 'sup-initial-1' })).token;
  await post('/api/password', first, { old_password: 'sup-initial-1', new_password: 'sup-own-secret-1' });
  const sup = await supervisorToken();
  await post('/api/sup/assign', sup, { candidate: 'CC1234' });
  const ids = (await post('/api/sup/entries', sup, { candidate: 'CC1234', cursor: 0 })).events.filter((e) => e.type === 'entry').map((e) => e.id);
  assert.equal(ids.length, 3);
  assert.equal((await post('/api/sup/sign', sup, { candidate: 'CC1234', ids })).signed, 3);
  assert.equal(serverEvents(), 6); // 3 entries + 3 signatures

  // ---- the student sees the signatures after the next sync (tap the sync button)
  await click($('.chip'), 500);
  assert.equal($$('.tag.ok').length, 3);
  assert.match($('.entry').textContent, /Signed · Dr Anna Kamara/);
  assert.match($('.note-info').textContent, /All your entries are signed/);
  assert.equal($$('.entry .link.danger').length, 0, 'signed entries cannot be deleted');

  // ---- the More tab lists who can see the entries
  await click(byText('.tab', 'More'));
  assert.match(document.body.textContent, /Your supervisors/);
  assert.match(document.body.textContent, /Dr Anna Kamara/);

  // ---- change password from the More tab
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
  assert.match($('.entry').textContent, /Signed · Dr Anna Kamara/);
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

test('deleting an entry that a supervisor signed in the meantime keeps it, and shows the signature', async () => {
  window.dispatchEvent(new window.Event('online'));
  await click(byText('.tab', 'Log'));
  await click(byText('.proc', 'Strangulated hernia repair'));
  await click(byText('.role', 'Surgeon, supervised'), 400); // saved and sent
  const id = server.db.prepare("SELECT id FROM events WHERE owner = 'CC1234' AND type = 'entry' AND payload LIKE '%strang_hernia%'").get().id;

  // the supervisor signs it; this tablet has not synced since, so it still shows "Not signed"
  const sup = await supervisorToken();
  assert.equal((await post('/api/sup/sign', sup, { candidate: 'CC1234', ids: [id] })).signed, 1);
  await click(byText('.tab', 'History'));
  const row = () => $$('.entry').find((e) => e.textContent.includes('Strangulated hernia repair'));
  assert.match(row().textContent, /Not signed/);

  // the student deletes it: the server refuses (it is signed) and the tablet forgets the delete
  await click(byText('.link', 'Delete', row()));
  await click(byText('.btn.danger', 'Delete'), 700);
  assert.ok(row(), 'the entry is still there');
  assert.match(row().textContent, /Signed · Dr Anna Kamara/);
  assert.equal($('.chip').textContent, 'Up to date');
});
