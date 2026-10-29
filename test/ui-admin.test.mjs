// End-to-end test of the administrator screens in jsdom against a real in-process server:
// first login -> own password -> overview -> add users -> user actions -> entries -> log out.
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
const saved = []; // files the page hands to the browser as downloads
globalThis.LOGBOOK_SAVE_FILE = (blob, filename) => saved.push({ blob, filename });

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
  await addUser(server.db, candidate, 'initial-pw-1');
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
await studentWithEntries('CC1001', ['cs', 'appendectomy']);
await studentWithEntries('CC1002', ['cs']);
await addUser(server.db, 'sup-anna', 'sup-initial-1', { role: 'supervisor', name: 'Dr Anna Kamara' });
await addUser(server.db, 'admin-anders', 'adm-initial-1', { role: 'admin', name: 'Anders' });

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
const clean = () => assert.doesNotMatch(document.body.textContent, /\bnull\b|undefined/);
const loginOk = async (candidate, password) => (await post('/api/login', null, { candidate, password })).token;

test.after(async () => { await server.close(); });

test('an administrator gets an overview, adds users, manages accounts and sees entries', async () => {
  await init();
  await wait();

  // ---- login and the forced password change
  $('#cand').value = 'admin-anders';
  $('#pw').value = 'adm-initial-1';
  await submit($('.setup-form'), 600);
  assert.match($('h1').textContent, /Choose your own password/);
  $('#oldpw').value = 'adm-initial-1';
  $('#newpw').value = 'adm-own-secret-1';
  $('#reppw').value = 'adm-own-secret-1';
  await submit($('.setup-form'), 800);

  // ---- overview: totals, procedures across students, one row per student
  assert.ok($('[data-admin]'), 'administrator screen');
  assert.equal($('#hosp'), null);
  assert.match($('.who').textContent, /Administrator · Anders/);
  const stats = $$('.stats .stat, .stats > div').map((e) => e.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(stats.some((t) => /^2\s*students/.test(t)), `students stat in ${stats}`);
  assert.ok(stats.some((t) => /^1\s*supervisors/.test(t)), 'supervisors stat');
  assert.ok(stats.some((t) => /^3\s*procedures/.test(t)), 'procedures stat');
  const proc = byText('tr', 'Caesarean section', $('.main'));
  assert.deepEqual([...proc.children].map((c) => c.textContent), ['Caesarean section', '2', '0', '0', '2', '2'], 'cs: performed 2, total 2, by 2 students');
  const matrix = $('.tbl.matrix');
  assert.deepEqual($$('tbody tr', matrix).map((r) => r.children[0].textContent), ['CC1001', 'CC1002']);
  assert.equal($$('tbody tr', matrix)[0].children[1].textContent, '2', 'CC1001 logged 2');
  assert.match(matrix.textContent, /1\/1/);
  assert.match($('.main').textContent, /created the student account CC1001/, 'recent changes list');
  assert.match($('.main').textContent, /No backup has been downloaded yet/, 'a reminder while there is data and no backup');
  const hosp = byText('.card', 'Hospitals');
  assert.deepEqual($$('tbody tr', hosp).map((r) => [...r.children].map((c) => c.textContent)), [['Masanga Hospital', '3', '3', '2']]);
  clean();

  // ---- spreadsheet downloads: the chosen format is used
  assert.equal($('select[aria-label="File format"]').value, ';');
  await click(byText('.btn', 'Procedures per student'), 400);
  assert.equal(saved.length, 1);
  assert.match(saved[0].filename, /^logbook-procedures-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv1 = await saved[0].blob.text(); // text() drops the byte order mark; the file itself keeps it
  assert.deepEqual([...Buffer.from(await saved[0].blob.arrayBuffer()).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv1, /^candidate;name;procedure_id;procedure;/);
  assert.match(csv1, /CC1001;;cs;Caesarean section;0;0;1;0;1;1;0/);
  const fmt = $('select[aria-label="File format"]');
  fmt.value = ',';
  fmt.dispatchEvent(new window.Event('change'));
  await click(byText('.btn', 'Every entry'), 400);
  const csv2 = await saved[1].blob.text();
  assert.match(csv2, /^candidate,name,entry_id,performed_on,entered_on,hospital,/);
  assert.match(csv2, /,Masanga Hospital,cs,Caesarean section,/);
  assert.match($('.main').textContent, /downloaded the entries spreadsheet/, 'downloads are listed under recent changes');
  assert.doesNotMatch($('.main').textContent, /\bnull\b|undefined/);
  fmt.value = ';';
  fmt.dispatchEvent(new window.Event('change'));

  // ---- one student's entries
  await click($$('tbody tr', matrix)[0], 600);
  assert.match($('.sheet').textContent, /CC1001 · 2 logged/);
  assert.match($('.sheet').textContent, /Appendectomy/);
  assert.match($('.sheet').textContent, /Not signed/);
  clean();
  await click(byText('.sheet .btn', 'Close'));

  // ---- users: list, search, filter
  await click(byText('.tab', 'Users'));
  assert.equal($$('.srow').length, 4);
  type($('.search'), 'anna');
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['SUP-ANNA · Dr Anna Kamara']);
  type($('.search'), '');
  $('select').value = 'student';
  $('select').dispatchEvent(new window.Event('change'));
  assert.equal($$('.srow').length, 2);
  type($('.search'), 'zzz');
  assert.match($('.main').textContent, /No accounts match/);
  type($('.search'), '');
  $('select').value = 'all';
  $('select').dispatchEvent(new window.Event('change'));

  // ---- add students in bulk: one already exists
  await click(byText('.tab', 'Add users'));
  type($('#ids'), 'cc2001 Mohamed  Kamara\nCC2002, CC2003\nCC1001');
  await submit($('.setup-form'), 800);
  assert.match($('.sheet').textContent, /3 accounts created/);
  assert.match($('.sheet').textContent, /Not created: CC1001/);
  assert.match($('.sheet').textContent, /cannot be shown again/);
  const shown = Object.fromEntries($$('.pwtable tbody tr').map((r) => [r.children[0].textContent, r.children[2].textContent]));
  assert.deepEqual(Object.keys(shown), ['CC2001', 'CC2002', 'CC2003']);
  assert.ok(await loginOk('CC2001', shown.CC2001), 'the shown password works');
  assert.equal($$('.pwtable tbody tr')[0].children[1].textContent, 'Mohamed Kamara', 'the name is shown next to the password');
  await click(byText('.sheet .btn', 'Done'));
  assert.equal($('#ids').value, '', 'the list is cleared');
  clean();

  // ---- add a supervisor
  await click(byText('.seg-b', 'Supervisor'));
  type($('#newid'), 'sup-ben');
  type($('#newname'), 'Dr Ben Sesay');
  await submit($('.setup-form'), 800);
  assert.match($('.sheet').textContent, /Supervisor account created/);
  const supPw = $('.pwtable tbody tr').children[2].textContent;
  assert.equal(server.db.prepare("SELECT role, display_name FROM users WHERE candidate = 'SUP-BEN'").get().display_name, 'Dr Ben Sesay');
  assert.ok(await loginOk('SUP-BEN', supPw));
  await click(byText('.sheet .btn', 'Done'));

  // an invalid id is refused on the screen
  await click(byText('.seg-b', 'Administrator'));
  type($('#newid'), '!');
  await submit($('.setup-form'), 100);
  assert.match($('.error').textContent, /2 to 20/);

  // ---- the new student has the name that was typed
  await click(byText('.tab', 'Users'));
  assert.ok(byText('.srow', 'Mohamed Kamara'), 'the name is in the list');
  type($('.search'), 'mohamed');
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['CC2001 · Mohamed Kamara'], 'search finds a name');
  type($('.search'), '');

  // ---- a student: give a supervisor access
  await click(byText('.srow', 'CC1002'), 200);
  assert.match($('.sheet').textContent, /Student/);
  assert.match($('.sheet').textContent, /None yet/);
  const pick = $('.sheet select');
  assert.ok($$('option', pick).some((o) => o.value === 'SUP-ANNA'));
  pick.value = 'SUP-ANNA';
  await click(byText('.sheet .btn', 'Add'), 700);
  assert.match($('#toast').textContent, /Added/);
  assert.match($('.sheet').textContent, /SUP-ANNA/);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE supervisor = 'SUP-ANNA' AND student = 'CC1002'").get().n, 1);
  await click(byText('.sheet .btn', 'Remove'), 700);
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n, 0);
  clean();

  // ---- give a student a name afterwards
  await click(byText('.sheet .link', 'Add a name'), 100);
  type($('#rename'), '  Fatmata   Bangura ');
  await submit($('.setup-form'), 800);
  assert.match($('#toast').textContent, /Name saved/);
  assert.match($('.sheet').textContent, /Fatmata Bangura/);
  assert.equal(server.db.prepare("SELECT display_name FROM users WHERE candidate = 'CC1002'").get().display_name, 'Fatmata Bangura');
  assert.ok(byText('.sheet .link', 'Change name'));

  // ---- reset a password: confirm first, then shown once
  await click(byText('.sheet .btn', 'New password'), 100);
  assert.match($('.sheet').textContent, /New password for CC1002\?/);
  await click(byText('.sheet .btn', 'Cancel'), 100);
  await click(byText('.sheet .btn', 'New password'), 100);
  await click(byText('.sheet .btn', 'Reset password'), 800);
  const newPw = $('.pwtable tbody tr').children[2].textContent;
  assert.ok(await loginOk('CC1002', newPw), 'the new initial password works');
  assert.equal((await post('/api/login', null, { candidate: 'CC1002', password: 'initial-pw-1' })).error, 'bad_credentials');
  await click(byText('.sheet .btn', 'Done'));

  // ---- disable and enable
  await click(byText('.srow', 'CC1002'), 200);
  await click(byText('.sheet .btn', 'Disable'), 100);
  assert.match($('.sheet').textContent, /Disable CC1002\?/);
  await click(byText('.sheet .btn.danger', 'Disable'), 800);
  assert.match($('.sheet').textContent, /Disabled/);
  assert.equal((await post('/api/login', null, { candidate: 'CC1002', password: newPw })).error, 'bad_credentials');
  await click(byText('.sheet .btn', 'Enable'), 800);
  assert.match($('.sheet').textContent, /Active/);
  assert.equal(byText('.sheet .link', 'for good'), undefined, 'an active account cannot be deleted');
  await click(byText('.sheet .btn', 'Close'));

  // ---- delete an account for good: only after disabling it, and after a second confirmation
  await click(byText('.srow', 'CC2003'), 200);
  await click(byText('.sheet .btn', 'Disable'), 100);
  await click(byText('.sheet .btn.danger', 'Disable'), 800);
  await click(byText('.sheet .link', 'for good'), 100);
  assert.match($('.sheet').textContent, /Delete CC2003 for good\?/);
  assert.match($('.sheet').textContent, /cannot be undone/);
  await click(byText('.sheet .btn', 'Cancel'), 100);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM users WHERE candidate = 'CC2003'").get().n, 1, 'Cancel deletes nothing');
  await click(byText('.sheet .link', 'for good'), 100);
  await click(byText('.sheet .btn.danger', 'Delete for good'), 800);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM users WHERE candidate = 'CC2003'").get().n, 0);
  assert.equal(byText('.srow', 'CC2003'), undefined, 'gone from the user list');

  // ---- your own account offers no reset or disable
  await click(byText('.srow', 'ADMIN-ANDERS'), 200);
  assert.match($('.sheet').textContent, /your own account/);
  assert.equal(byText('.sheet .btn', 'New password'), undefined);
  assert.equal(byText('.sheet .btn', 'Disable'), undefined);
  await click(byText('.sheet .btn', 'Close'));

  // ---- the changes are listed on the overview
  await click(byText('.tab', 'Overview'));
  assert.match($('.main').textContent, /ADMIN-ANDERS reset the password of CC1002/);
  assert.match($('.main').textContent, /disabled CC1002/);
  assert.match($('.main').textContent, /ADMIN-ANDERS deleted CC2003 and its data for good/);
  assert.doesNotMatch($('.main').textContent, new RegExp(newPw), 'no password anywhere on the page');

  // ---- More, then log out
  await click(byText('.tab', 'More'));
  assert.match($('.main').textContent, /ADMIN-ANDERS/);
  assert.match($('.main').textContent, /cannot sign/);
  assert.match($('.main').textContent, /Last backup\s*never/);
  await click(byText('.btn', 'Download backup'), 600);
  assert.equal(saved.length, 3);
  assert.match(saved[2].filename, /^logbook-backup-\d{4}-\d{2}-\d{2}\.db$/);
  assert.equal(Buffer.from(await saved[2].blob.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3', 'a real database file');
  assert.match($('.main').textContent, /Last backup\s*just now/);
  await click(byText('.tab', 'Overview'));
  assert.doesNotMatch($('.main').textContent, /No backup has been downloaded/, 'the reminder is gone after a backup');
  await click(byText('.tab', 'More'));
  await click(byText('.btn', 'Log out'), 100);
  await click(byText('.sheet .btn.danger', 'Log out'), 500);
  assert.ok($('#cand'), 'login screen');
  assert.equal(localStorage.getItem('logbook.session'), null);
});

test('an administrator whose session ended is sent back to login', async () => {
  $('#cand').value = 'ADMIN-ANDERS';
  $('#pw').value = 'adm-own-secret-1';
  await submit($('.setup-form'), 800);
  assert.ok($('[data-admin]'));
  server.db.prepare('DELETE FROM sessions').run();
  await click(byText('.chip', 'Refresh'), 600);
  assert.ok($('#cand'), 'back at the login screen');
  assert.match(document.body.textContent, /session has ended/);
  assert.equal($('[data-admin]'), null);
});
