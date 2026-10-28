// End-to-end test of the supervisor screens in jsdom against a real in-process server:
// first login -> own password -> add students -> sign some entries -> remove a student -> log out.
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
globalThis.LOGBOOK_SYNC_DELAY = 30;

const server = await createServer({ dbPath: ':memory:' });
const port = await server.listen(0, '127.0.0.1');
globalThis.LOGBOOK_API_BASE = `http://127.0.0.1:${port}`;

const post = async (path, token, body = {}) => (await fetch(`http://127.0.0.1:${port}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})).json();

// Two students with entries on the server, as if they had synced from their tablets.
let n = 0;
async function studentWithEntries(candidate, procedures) {
  await addUser(server.db, candidate, 'initial-pw-1', { name: candidate === 'CC1001' ? 'Mohamed Kamara' : null });
  const token = (await post('/api/login', null, { candidate, password: 'initial-pw-1' })).token;
  await post('/api/password', token, { old_password: 'initial-pw-1', new_password: 'student-own-1' });
  const events = procedures.map((procedure) => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, type: 'entry', ts: new Date().toISOString(),
    hospital: 'Masanga Hospital', procedure, role: 'supervised', performed_on: '2026-10-20', entered_on: '2026-10-20',
    ms_to_log: 3000, online: true, schema: 1,
  }));
  await post('/api/sync', token, { events, cursor: 0 });
  return token;
}
const s1 = await studentWithEntries('CC1001', ['cs', 'appendectomy', 'laparotomy']);
await studentWithEntries('CC1002', ['cs']);
await addUser(server.db, 'sup-anna', 'sup-initial-1', { role: 'supervisor', name: 'Dr Anna Kamara' });

const { init } = await import('../app.js');
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const click = async (el, ms = 300) => { assert.ok(el, 'element to click exists'); el.click(); await wait(ms); };
const byText = (sel, text, scope = document) => $$(sel, scope).find((e) => e.textContent.includes(text));
const submit = async (form, ms = 500) => {
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await wait(ms);
};
const type = (input, value) => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
const signsOf = (c) => server.db.prepare("SELECT COUNT(*) AS n FROM events WHERE owner = ? AND type = 'sign'").get(c).n;

test.after(async () => { await server.close(); });

test('a supervisor logs in, adds students, signs selected entries, removes a student, logs out', async () => {
  await init();
  await wait();

  // ---- login with a staff ID, then the forced password change
  assert.match(document.body.textContent, /staff ID/);
  $('#cand').value = 'sup-anna';
  $('#pw').value = 'sup-initial-1';
  await submit($('.setup-form'), 600);
  assert.match($('h1').textContent, /Choose your own password/);
  $('#oldpw').value = 'sup-initial-1';
  $('#newpw').value = 'sup-own-secret-1';
  $('#reppw').value = 'sup-own-secret-1';
  await submit($('.setup-form'), 700);

  // ---- the supervisor screen, with no students yet
  assert.ok($('[data-sv]'), 'supervisor screen');
  assert.equal($('#hosp'), null, 'a supervisor is not asked for a hospital');
  assert.match($('.who').textContent, /Supervisor · Dr Anna Kamara/);
  assert.match($('.main').textContent, /No students yet/);
  assert.equal(byText('.tab', 'Log'), undefined, 'no logbook tabs');

  // ---- add students: search, add one, the other is still offered
  await click(byText('.tab', 'Add students'));
  assert.deepEqual($$('.addrow strong').map((e) => e.textContent), ['CC1001', 'CC1002']);
  type($('.search'), 'cc1002');
  assert.deepEqual($$('.addrow strong').map((e) => e.textContent), ['CC1002']);
  await click(byText('.btn', 'Add', $('.addrow')));
  assert.match($('#toast').textContent, /CC1002 is now one of your students/);
  assert.doesNotMatch($('#toast').textContent, /null/);
  assert.doesNotMatch($('.main').textContent, /null|undefined/);
  type($('.search'), '');
  assert.deepEqual($$('.addrow strong').map((e) => e.textContent), ['CC1001'], 'an added student leaves the list');
  type($('.search'), 'zzz');
  assert.match($('.plist').textContent, /No match/);
  type($('.search'), 'mohamed');
  assert.match($('.addrow').textContent, /CC1001\s*Mohamed Kamara/, 'a student can be found by name');
  type($('.search'), '');
  await click(byText('.btn', 'Add', $('.addrow')));
  assert.match($('.plist').textContent, /Every student is already added/);

  // ---- my students: the one with entries waiting comes first
  await click(byText('.tab', 'My students'), 500);
  const rows = $$('.srow');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /CC1001/);
  assert.match(rows[0].textContent, /Mohamed Kamara/, 'the name is shown');
  assert.match(rows[0].textContent, /3 to sign/);
  assert.match(rows[1].textContent, /CC1002/);
  assert.match($('.nav .badge').textContent, /4/, 'badge counts all entries waiting');

  // ---- one student: untick one entry, sign the rest
  await click(rows[0], 500);
  assert.match($('h2').textContent, /CC1001/);
  assert.match($('.main').textContent, /Mohamed Kamara/);
  const boxes = $$('.signlist input[type=checkbox]');
  assert.equal(boxes.length, 3);
  assert.ok(boxes.every((b) => b.checked), 'everything unsigned starts ticked');
  boxes[2].checked = false;
  boxes[2].dispatchEvent(new window.Event('change'));
  assert.equal(byText('.btn', 'Sign 2 selected').textContent, 'Sign 2 selected');
  await click(byText('.btn', 'Sign 2 selected'), 100);
  assert.match($('.sheet').textContent, /Sign 2 entries\?/);
  assert.match($('.sheet').textContent, /you supervised/);
  await click(byText('.sheet .btn', 'Sign'), 600);
  assert.match($('#toast').textContent, /Signed 2 entries/);
  assert.equal(signsOf('CC1001'), 2);
  assert.equal($$('.signlist input[type=checkbox]').length, 1, 'one entry is still waiting');
  assert.equal($$('.entry .tag.ok').length, 2);
  assert.match($('.entry .tag.ok').textContent, /Signed · Dr Anna Kamara/);

  // the student's tablet would receive the signatures with its next sync
  const pulled = await post('/api/sync', s1, { events: [], cursor: 0 });
  assert.equal(pulled.events.filter((e) => e.type === 'sign').length, 2);

  // ---- remove the student: access ends
  await click(byText('.link', 'Remove from my students'), 100);
  assert.match($('.sheet').textContent, /Remove CC1001\?/);
  await click(byText('.sheet .btn', 'Remove'), 700);
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['CC1002']);
  assert.equal((await post('/api/sup/entries', (await post('/api/login', null, { candidate: 'SUP-ANNA', password: 'sup-own-secret-1' })).token, { candidate: 'CC1001' })).error, 'not_assigned');

  // ---- More tab, then log out; nothing was stored on the tablet
  await click(byText('.tab', 'More'));
  assert.match($('.main').textContent, /SUP-ANNA/);
  assert.match($('.main').textContent, /Only the students you added/);
  const dbs = (await indexedDB.databases()).map((d) => d.name);
  assert.deepEqual(dbs.filter((x) => /SUP-ANNA|surgical-logbook/.test(x)), [], 'no local logbook database for a supervisor');
  await click(byText('.btn', 'Log out'), 100);
  await click(byText('.sheet .btn.danger', 'Log out'), 500);
  assert.ok($('#cand'), 'login screen');
  assert.equal(localStorage.getItem('logbook.session'), null);
});

test('a supervisor whose session ended is sent back to login', async () => {
  $('#cand').value = 'SUP-ANNA';
  $('#pw').value = 'sup-own-secret-1';
  await submit($('.setup-form'), 700);
  assert.ok($('[data-sv]'));
  assert.equal($$('.srow').length, 1, 'the list is loaded fresh from the server after a new login');
  server.db.prepare('DELETE FROM sessions').run();
  await click($('.chip'), 500);
  assert.ok($('#cand'), 'back at the login screen');
  assert.match(document.body.textContent, /session has ended/);
  assert.equal($('[data-sv]'), null, 'nothing from the supervisor screen is left on show');
});
