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
import { HOSPITALS } from '../config.js';
import * as core from '../core.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.scrollTo = () => {};
globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver; // the arrow down when there is more (scrollHint in ui.js)
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.localStorage = window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.LOGBOOK_SYNC_DELAY = 30;

const server = await createServer({ dbPath: ':memory:' });
const port = await server.listen(0, '127.0.0.1');
globalThis.LOGBOOK_API_BASE = `http://127.0.0.1:${port}`;
await addUser(server.db, 'cc 1234', 'initial-pw-1', { name: 'Mohamed Kamara' }); // the admin creates the account: stored as CC1234

const { init } = await import('../app.js');
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const click = async (el, ms) => { assert.ok(el, 'element to click exists'); el.click(); await wait(ms); };
const byText = (sel, text, scope = document) => $$(sel, scope).find((e) => e.textContent.includes(text));
// Tap a role, then Save (every detail question is optional).
// Saves without answering the questions, so it confirms "Save anyway".
const logAs = async (role, ms) => {
  await click(byText('.choice', role));
  await click(byText('.sheet .btn', 'Save'));
  await click(byText('.layer .btn', 'Save anyway'), ms);
};
// On the Log tab: choose Surgery or Delivery (unless it is chosen already), then tap the procedure.
const choosePart = async (part) => {
  const b = byText('.log-parts .choice', part);
  if (b.getAttribute('aria-pressed') !== 'true') await click(b);
};
const openProc = async (name, part = 'Surgery') => { await choosePart(part); await click(byText('.proc', name)); };
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

// The app comes back on the screen (switched back to it, screen turned on): it syncs by itself.
const comeBack = async () => { document.dispatchEvent(new window.Event('visibilitychange')); await wait(500); };

test('login, first password, logging, sync, logout, login on a new tablet', async () => {
  await init();
  await wait();

  // ---- login screen
  assert.ok($('#cand'), 'login screen shown when nobody is logged in');
  assert.match($('.setup').textContent, /Version \d+\.\d+\.\d+$/, 'the version is shown quietly under the login form');
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

  // ---- must choose own password; the privacy notice can be read right there
  assert.match($('h1').textContent, /Choose your own password/);
  await click(byText('.setup .btn', 'How your data is used'));
  assert.match($('.sheet h3').textContent, /Your data/);
  assert.match($('.sheet').textContent, /What is stored/);
  assert.doesNotMatch($('.sheet').textContent, /What is never stored/);
  assert.deepEqual($$('.sheet .pv-card h4').map((x) => x.textContent), ['What is stored', 'Why', 'Who can see it', 'Where it is kept', 'How long it is kept', 'Your rights'], 'one grey card per part');
  assert.match($('.sheet').textContent, /Each procedure you log/, 'a student reads what is stored about students');
  assert.doesNotMatch($('.sheet').textContent, /Which students you added/, 'and not what is stored about supervisors');
  assert.match($('.sheet').textContent, /Who can see it/);
  assert.match($('.sheet').textContent, /have your account and your data deleted/);
  await click(byText('.sheet .btn', 'Close'));
  assert.equal($('.sheet'), null);
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
  assert.equal($('.setup h1').textContent, 'Where do you work?');
  assert.equal($$('#hosp option').length, HOSPITALS.length, 'every hospital is in the list');
  $('#hosp').value = 'Masanga Hospital';
  await submit($('.setup-form'));
  assert.ok($('.top'), 'main screen');
  assert.match($('.who').textContent, /CC1234 · Mohamed Kamara · Masanga Hospital/);
  assert.doesNotMatch(document.body.textContent, /never type/i, 'no warning about typing patient data: there is nowhere to type it');
  assert.equal($('.banner'), null, 'no version strip on the screens: the version is under More, About');
  assert.doesNotMatch(document.body.textContent, /Version \d/);
  assert.doesNotMatch(document.body.textContent, /prototype/i);
  assert.equal(JSON.parse(localStorage.getItem('logbook.session')).must_change, false);

  // ---- the Log tab: Surgery or Delivery, like CapaCare's two logbooks; Surgery is chosen from the start
  assert.deepEqual($$('.log-parts .choice strong').map((x) => x.textContent), ['Surgery', 'Delivery']);
  assert.equal(byText('.log-parts .choice', 'Surgery').getAttribute('aria-pressed'), 'true', 'Surgery is chosen from the start');
  assert.equal($$('.grid .proc').length, 10);
  await choosePart('Delivery');
  assert.deepEqual($$('.grid .proc .proc-name').map((x) => x.textContent), ['Normal delivery', 'Caesarean section', 'Vacuum delivery', 'Forceps delivery', 'Destructive delivery (craniotomy)']);
  assert.equal($('.proc-more'), null, 'every way of giving birth is already there');
  await choosePart('Surgery');
  assert.equal($$('.grid .proc').length, 10, 'the ten most common operations');
  assert.ok(byText('.grid .proc', 'Caesarean section'), 'a caesarean is under both');
  assert.ok(!$('.proc-more').closest('.grid'), '"More operations" is on its own, under the ten');

  // ---- "More operations" lists every operation by group
  await click($('.proc-more'));
  assert.match($('.sheet h3').textContent, /All operations/);
  assert.deepEqual($$('.sheet .plist-group').map((x) => x.textContent), ['Gynaecology and obstetrics', 'Neurosurgery', 'Orthopaedics', 'Soft tissue']);
  assert.ok(byText('.sheet .row-btn', 'Caesarean section'), 'a caesarean is an operation too');
  assert.equal(byText('.sheet .row-btn', 'Normal delivery'), undefined, 'a normal delivery is not an operation');
  const search = $('.sheet .search');
  search.value = 'ortho';
  search.dispatchEvent(new window.Event('input'));
  assert.deepEqual($$('.sheet .plist-group').map((x) => x.textContent), ['Orthopaedics'], 'searching for a group shows that group');
  assert.ok(byText('.sheet .row-btn', 'Skin traction'));
  search.value = 'hernia';
  search.dispatchEvent(new window.Event('input'));
  assert.deepEqual($$('.sheet .plist-group').map((x) => x.textContent), ['Soft tissue']);
  assert.equal($$('.sheet .row-btn').length, 5);
  search.value = 'zzz';
  search.dispatchEvent(new window.Event('input'));
  assert.match($('.sheet .plist').textContent, /No match/);
  await click(byText('.sheet .btn', 'Close'));

  // ---- a delivery that is not an operation words the roles as the obstetric logbook does
  await openProc('Normal delivery', 'Delivery');
  assert.deepEqual($$('.sheet .choices.wide .choice strong').map((x) => x.textContent), ['Observing', 'Assisting', 'Delivered, supervised', 'Delivered alone']);
  await click(byText('.sheet .btn', 'Cancel'));
  await openProc('Caesarean section');
  assert.deepEqual($$('.sheet .choices.wide .choice strong').map((x) => x.textContent), ['Observing', 'Assisting', 'Surgeon, supervised', 'Surgeon, independent']);
  await click(byText('.sheet .btn', 'Cancel'));

  // ---- log two entries; they are sent automatically
  await openProc('Caesarean section');
  await logAs('Surgeon, independent');
  await openProc('Appendectomy');
  await logAs('Observing', 400);
  assert.equal(serverEvents(), 2);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
  assert.doesNotMatch(document.body.textContent, /null|undefined/, 'no stray "null" on screen');

  // ---- offline: entries wait, then go out when the connection returns.
  // The hospital is shown when logging and can be changed right there; it is stored with the entry.
  window.dispatchEvent(new window.Event('offline'));
  assert.match($('.chip').textContent, /Offline/);
  await openProc('Laparotomy');
  assert.equal($('.sheet .fact strong').textContent, 'Masanga Hospital', 'the hospital is shown when logging');
  assert.ok($('.sheet .hpick').hidden, 'the hospital list is folded away until "Change" is tapped');
  await click($('.sheet [aria-label="Change hospital"]'), 100);
  assert.ok(!$('.sheet .hpick').hidden, 'one tap on "Change" shows the list');
  assert.equal($$('.sheet .hlist .row-btn').length, HOSPITALS.length, 'every hospital is a button');
  assert.equal($('.sheet .hlist .on').textContent, 'Masanga Hospital', 'the current hospital is marked');
  const hsearch = $('.sheet .hpick .search');
  hsearch.value = 'bo gov';
  hsearch.dispatchEvent(new window.Event('input'));
  assert.deepEqual($$('.sheet .hlist .row-btn').map((b) => b.textContent), ['Bo Government Hospital'], 'search narrows the list');
  await click(byText('.sheet .hlist .row-btn', 'Bo Government Hospital'), 100);
  assert.equal($('.sheet .fact strong').textContent, 'Bo Government Hospital');
  assert.ok($('.sheet .hpick').hidden, 'the list folds away after choosing');
  await logAs('Assisting', 200);
  assert.match($('.who').textContent, /Bo Government Hospital/, 'the tablet now works at the new hospital');
  assert.equal(serverEvents(), 2, 'nothing sent while offline');
  assert.equal($('.chip').textContent, 'Offline · 1 waiting');
  window.dispatchEvent(new window.Event('online'));
  await wait(400);
  assert.equal(serverEvents(), 3);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
  assert.deepEqual(
    server.db.prepare("SELECT json_extract(payload, '$.procedure') AS p, json_extract(payload, '$.hospital') AS h FROM events WHERE type = 'entry'").all().map((r) => `${r.p}@${r.h}`).sort(),
    ['appendectomy@Masanga Hospital', 'cs@Masanga Hospital', 'laparotomy@Bo Government Hospital'],
  );
  server.db.prepare("UPDATE users SET display_name = 'Mohamed Sorie Kamara' WHERE candidate = 'CC1234'").run();
  await comeBack();
  assert.match($('.who').textContent, /Mohamed Sorie Kamara/, 'a changed name arrives with the next sync');

  // ---- no supervisor yet: nothing is signed, and there is no sign-off button.
  // History has no count of unsigned entries on its tab and no message about them.
  await click(byText('.tab', 'History'));
  assert.equal($('.nav .badge'), null, 'no count on the History tab');
  assert.equal($('.note-info'), null, 'no message about signatures at the top of History');
  assert.match($('.entry .e-sub').textContent, /^Assisted · \d+ \w+$/, 'the row: your role · date');
  assert.deepEqual($$('.month').map((x) => x.textContent), [core.fmtMonth(core.localDateISO().slice(0, 7))], 'a heading for the month, above its entries');
  await click($('.entry'));
  assert.match($('.sheet .case-sub').textContent, /^\d+ \w+ · Bo Government Hospital$/, 'the case shows where it was done');
  await click(byText('.sheet .btn', 'Close'));
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

  // ---- the student sees the signatures when the app comes back on the screen, without tapping anything
  await comeBack();
  assert.equal($$('.tag.ok').length, 3);
  assert.match($('.entry').textContent, /Signed/);

  // ---- the Progress tab counts them; there is no weekly summary to share
  await click(byText('.tab', 'Progress'));
  assert.match($('.stats').textContent, /3\s*cases/);
  assert.match($('.stats').textContent, /3\s*signed/);
  assert.doesNotMatch(document.body.textContent, /WhatsApp|Weekly summary/);
  await click(byText('.tab', 'History'));
  await click($('.entry'));
  assert.match(byText('.sheet .case-row', 'Signature').textContent, /Signed by Dr Anna Kamara/);
  assert.equal(byText('.sheet-foot .btn', 'Delete'), undefined, 'signed entries cannot be deleted');
  await click(byText('.sheet .btn', 'Close'));

  // ---- the More tab lists who can see the entries
  await click(byText('.tab', 'More'));
  assert.match(document.body.textContent, /Your supervisors/);
  assert.match(document.body.textContent, /Dr Anna Kamara/);
  await click(byText('details.advanced .fact', 'Your data').querySelector('.change'));
  assert.match($('.sheet h3').textContent, /Your data/, 'the privacy notice is also under More, in Advanced');
  await click(byText('.sheet .btn', 'Close'));

  // ---- the hospital is a row like candidate number and name, and can still be changed from there
  const hospRow = () => byText('.card .fact', 'Hospital');
  assert.ok(hospRow(), 'the hospital is shown as a row in the account card, like when logging');
  assert.equal(hospRow().querySelector('.fact-text strong').textContent, 'Bo Government Hospital', 'the value is under the label');
  assert.ok($('.hpick').hidden, 'the list of hospitals is hidden until "Change" is tapped');
  const hospBtn = $('[aria-label="Change hospital"]');
  await click(hospBtn, 100);
  assert.ok(!$('.hpick').hidden);
  assert.equal(hospBtn.getAttribute('aria-expanded'), 'true', 'the button shows the menu is open');
  // a menu: the × , "Change" again, Escape and a tap outside all close it
  await click($('.hpick-x'));
  assert.ok($('.hpick').hidden, 'the × closes it');
  assert.equal(hospBtn.getAttribute('aria-expanded'), 'false');
  await click(hospBtn);
  await click(hospBtn);
  assert.ok($('.hpick').hidden, '"Change" again closes it');
  await click(hospBtn);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok($('.hpick').hidden, 'Escape closes it');
  await click(hospBtn);
  $('h2').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.ok($('.hpick').hidden, 'a tap outside closes it');
  await click(hospBtn);
  $('.hpick .search').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.ok(!$('.hpick').hidden, 'a tap inside does not');
  await click(byText('.hlist .row-btn', 'Kenema Government Hospital'), 200);
  assert.match(hospRow().textContent, /Kenema Government Hospital/);
  assert.match($('.who').textContent, /Kenema Government Hospital/);
  assert.ok($('.hpick').hidden, 'the list closes after choosing');

  // ---- the More tab: account, supervisors, then the rarely needed things (your data too) folded away under "Advanced"
  assert.deepEqual($$('section .card').map((c) => c.querySelector('h3, summary strong').textContent), ['Account', 'Your supervisors', 'Advanced']);
  assert.deepEqual($$('details.advanced h3').map((x) => x.textContent), ['Data on this device', 'About'], 'no separate "Your data" part');
  assert.deepEqual($$('details.advanced .fact-text > span').map((x) => x.textContent), ['Entries', 'Waiting to be sent', 'Last sync', 'Version', 'Your data'],
    'the same rows as the account: label in bold, value under it; "Your data" is one row under About, with a button');
  assert.ok(!$('details.advanced').open, 'Advanced is folded when the tab is opened');
  assert.match(document.body.textContent, /Data on this device/);
  assert.doesNotMatch(document.body.textContent, /tablet/i, 'the app works on any device, so the screens say "device"');
  assert.ok(byText('details.advanced', 'Version'), 'app details are inside it');
  assert.equal(byText('.btn', 'Export test data'), undefined, 'no test-data export');
  assert.equal(byText('.btn', 'Sync now'), undefined, 'no Sync now button: syncing is automatic');
  $('details.advanced').open = true;
  $('details.advanced').dispatchEvent(new window.Event('toggle'));
  await comeBack();
  assert.ok($('details.advanced').open, 'a sync redraws the tab but keeps Advanced open');

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

  // the history came back from the server; after logging out, Surgery is chosen again
  assert.equal(byText('.log-parts .choice', 'Surgery').getAttribute('aria-pressed'), 'true');
  assert.match(byText('.proc', 'Caesarean section').textContent, /1 case$/);
  assert.match(byText('.proc', 'Appendectomy').textContent, /1 case$/);
  assert.match(byText('.proc', 'Laparotomy').textContent, /1 case$/);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
  await click(byText('.tab', 'History'));
  assert.equal($$('.entry').length, 3);
  assert.equal($$('.tag.ok').length, 3, 'signatures came back too');
  assert.match($('.entry').textContent, /Signed$/);
  assert.deepEqual($$('.entry .e-sub').map((t) => t.textContent.split(' · ')[0]).sort(), ['Assisted', 'Observed', 'Operated on my own'], 'History says what the student did, in the past tense');

  // ---- History: show only one role, or one procedure
  await click(byText('.filter', 'Role'));
  assert.match(byText('.sheet .opt', 'Observed').textContent, /Observed1/, 'each choice shows how many entries it has');
  await click(byText('.sheet .opt', 'Observed'));
  assert.equal($$('.entry').length, 1);
  assert.match($('.entry').textContent, /Appendectomy/);
  assert.match($('.shown').textContent, /Showing 1 of 3/);
  await click(byText('.filter', 'Procedure'));
  assert.deepEqual($$('.sheet .opt').map((o) => o.firstChild.textContent), ['All procedures', 'Appendectomy'], 'only procedures that match the chosen role');
  await click(byText('.shown button', 'Show all'));
  assert.equal($$('.entry').length, 3);
  assert.equal($('.shown'), null);
  await click(byText('.filter', 'Procedure'));
  assert.equal($$('.sheet .opt').length, 4, '"All procedures" and the three logged procedures');
  await click(byText('.sheet .opt', 'Laparotomy'));
  assert.equal($$('.entry').length, 1);
  assert.match(byText('.filter', 'Procedure').textContent, /Laparotomy/);
  await click(byText('.shown button', 'Show all'));
});

test('logging out with unsent entries warns and offers to lose them', async () => {
  // still logged in as CC1234 from the previous test
  window.dispatchEvent(new window.Event('offline'));
  await click(byText('.tab', 'Log'));
  await openProc('Inguinal hernia repair');
  await logAs('Surgeon, supervised', 200);
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
  await openProc('Umbilical hernia repair');
  await logAs('Observing', 500);
  assert.ok($('#cand'), 'back at the login screen');
  assert.match(document.body.textContent, /session has ended/);
  assert.equal(serverEvents(), before);

  $('#cand').value = 'CC1234';
  $('#pw').value = 'even-better-secret-2';
  await submit($('.setup-form'), 700);
  await choosePart('Surgery');
  assert.match(byText('.proc', 'Umbilical hernia repair').textContent, /1 case$/, 'the entry made while logged out is still there');
  await wait(400);
  assert.equal(serverEvents(), before + 1, 'and it reached the server after logging in again');
});

test('deleting an entry that a supervisor signed in the meantime keeps it, and shows the signature', async () => {
  window.dispatchEvent(new window.Event('online'));
  await click(byText('.tab', 'Log'));
  await openProc('Strangulated hernia repair');
  await logAs('Surgeon, supervised', 400); // saved and sent
  const id = server.db.prepare("SELECT id FROM events WHERE owner = 'CC1234' AND type = 'entry' AND payload LIKE '%strang_hernia%'").get().id;

  // the supervisor signs it; this tablet has not synced since, so it still shows "Not signed"
  const sup = await supervisorToken();
  assert.equal((await post('/api/sup/sign', sup, { candidate: 'CC1234', ids: [id] })).signed, 1);
  await click(byText('.tab', 'History'));
  const row = () => $$('.entry').find((e) => e.textContent.includes('Strangulated hernia repair'));
  assert.match(row().textContent, /Not signed/);

  // the student deletes it: the server refuses (it is signed) and the tablet forgets the delete
  await click(row());
  await click(byText('.sheet-foot .btn', 'Delete'));
  await click(byText('.btn.danger', 'Delete'), 700);
  assert.ok(row(), 'the entry is still there');
  assert.match(row().textContent, /Signed/);
  assert.doesNotMatch(row().textContent, /Not signed/);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
});

test('role and details are on one screen, and a follow-up can be added later from History', async () => {
  window.dispatchEvent(new window.Event('online'));
  await click(byText('.tab', 'Log'));
  await openProc('Caesarean section');
  assert.ok(byText('.qlabel', 'Main reason'), 'a caesarean asks its own questions, on the same screen as the role');
  // "Change" date: a browser without showPicker() shows the field; a second press hides it again
  const dateField = $('.sheet input[type=date]');
  await click($('.sheet [aria-label="Change date"]'));
  assert.ok(dateField.classList.contains('show'));
  await click($('.sheet [aria-label="Change date"]'));
  assert.ok(!dateField.classList.contains('show'), 'a second press closes it');
  // the arrow down shows while there is more further down, and goes away at the bottom (jsdom has no layout: pretend)
  const sheet = $('.sheet');
  const hint = $('.sheet-foot > .scroll-hint');
  let top = 0;
  Object.defineProperty(sheet, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(sheet, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(sheet, 'scrollTop', { get: () => top, configurable: true });
  sheet.dispatchEvent(new window.Event('scroll'));
  assert.equal(hint.hidden, false, 'more below: the hint shows');
  assert.equal(hint.querySelector("button").getAttribute("aria-label"), "Scroll down", "an arrow only, no words, but a name for screen readers");
  top = 2200;
  sheet.dispatchEvent(new window.Event('scroll'));
  assert.equal(hint.hidden, true, 'at the bottom it goes away');
  top = 0;
  for (const k of ['scrollHeight', 'clientHeight', 'scrollTop']) delete sheet[k];
  const save = () => $('.sheet-foot .btn.save');
  assert.equal(save().textContent, 'Choose your role', 'Save says what is missing');
  assert.equal(save().disabled, true);
  await click(byText('.choice', 'Surgeon, independent'));
  assert.equal(save().textContent, 'Save');
  await click(byText('.choice', 'Surgeon, independent'));
  assert.equal(byText('.choice', 'Surgeon, independent').getAttribute('aria-pressed'), 'true', 'a second tap does not clear the role');
  await click(byText('.choice', 'Surgeon, supervised')); // changed my mind
  assert.deepEqual($$('.sheet .choices.wide .choice.on').map((b) => b.dataset.value), ['supervised'], 'one role at a time');

  // the questions come in parts, each a card with one heading; the second and third baby only after "Twins" or "Triplets"
  const visible = (sel) => $$(sel).filter((x) => !x.closest('[hidden]') && !x.hidden);
  assert.deepEqual(visible('.sheet .qcard .qsection').map((x) => x.textContent), ['Your role', 'Mother', 'Baby', 'Operation', 'Surgical Apgar']);
  assert.match(byText('.sheet .qcard', 'Surgical Apgar').querySelector('.qnote').textContent, /mother's/, 'says whose Surgical Apgar it is');
  assert.equal($('.sheet label[for="q-age_years"]').textContent, 'Age');
  assert.equal($('.sheet label[for="q-age_years"]').nextElementSibling.className, 'numrow', 'age has no grey line under it');
  assert.match(byText('.sheet .qrow', 'Gravida').querySelector('.qhelp').textContent, /Pregnancies/, 'an unclear word is explained');
  assert.equal($('.sheet .numgrid'), null, 'number questions are not side by side');
  assert.equal($('#q-gravida').closest('.qrow').nextElementSibling, $('#q-para').closest('.qrow'), 'each on its own line, one under the other');
  assert.ok(byText('.sheet .qrow', 'Number of babies').querySelector('.choices.three'), 'three short choices share one row');
  await click(byText('.choice', 'Twins'));
  assert.deepEqual(visible('.sheet .qcard .qsection').map((x) => x.textContent), ['Your role', 'Mother', 'Baby', 'Second baby', 'Operation', 'Surgical Apgar']);
  $('#q-baby2_weight_g').value = '2100';
  await click(byText('.choice', 'Twins')); // a second tap clears it: the second baby is hidden again and not saved
  assert.ok($('#q-baby2_weight_g').closest('[hidden]'));

  await click(byText('.choice', 'Emergency'));
  await click(byText('.choice', 'Spinal'));
  await click(byText('.choice', 'General')); // changes the answer
  await click(byText('.choice', 'Planned'));
  await click(byText('.choice', 'Planned')); // a second tap clears it
  $('#q-duration_min').value = '5000';
  await click(byText('.sheet .btn', 'Save'));
  assert.match($('.sheet .error').textContent, /whole number from 1 to 1440/, 'a wrong number is explained, nothing saved');
  $('#q-duration_min').value = '50';
  await click(byText('.sheet .btn', 'Save'));
  // questions without an answer: a question on top asks first; "Go back" keeps everything as it was
  const visibleRows = $$('.sheet .qrow').filter((r) => !r.hidden && !r.closest('[hidden]') && r.querySelector('.qlabel'));
  assert.equal($('.layer h3').textContent, 'Not everything is answered');
  assert.equal($('.layer p').textContent, `${visibleRows.length - 2} questions have no answer. Save anyway?`, 'counts only the questions on screen');
  await click(byText('.layer .btn', 'Go back'));
  assert.equal($('.layer'), null);
  assert.ok($('.sheet #q-duration_min'), 'the logging pop-up is still open, answers kept');
  assert.equal($('#q-duration_min').value, '50');
  await click(byText('.sheet .btn', 'Save'));
  await click(byText('.layer .btn', 'Save anyway'), 400);
  const stored = () => server.db.prepare("SELECT payload FROM events WHERE owner = 'CC1234' AND type = ? ORDER BY seq DESC LIMIT 1");
  assert.deepEqual(JSON.parse(stored().get('entry').payload).details, { anaesthesia: 'general', duration_min: 50 });

  await click(byText('.tab', 'History'));
  const row = () => $('.entry'); // the newest entry is on top
  assert.doesNotMatch(row().textContent, /Anaesthesia/, 'the row shows only the most important; the answers are in the pop-up');
  assert.match(row().textContent, /Operated with supervisor · \d+ \w+/);
  assert.match(row().textContent, /Not signed/);
  assert.deepEqual($$('.tag', row()).map((t) => t.textContent), ['Not signed'], 'no follow-up tag yet');

  // tapping the case opens it in a pop-up: one table, with a part per heading and only what was answered
  await click(row());
  assert.equal($('.sheet h3').textContent, 'Caesarean section');
  assert.deepEqual($$('.sheet .case-part h4').map((x) => x.textContent), ['Case', 'Operation', 'Follow-up'], 'only the parts with an answer');
  const rows = () => $$('.sheet .case-row').map((r) => [...r.children].map((c) => c.textContent).join(': '));
  assert.deepEqual(rows(), ['Your role: Operated with supervisor', 'Signature: Not signed yet', 'Anaesthesia: General', 'Operation time: 50 minutes']);
  assert.match(byText('.sheet .case-part', 'Follow-up').textContent, /No follow-up yet/);
  await click(byText('.sheet .btn', 'Close'));
  assert.equal($('.sheet'), null);
  await click(row());
  await click(byText('.sheet-foot .btn', 'Delete'));
  assert.equal($('.sheet h3').textContent, 'Delete this entry?', 'an unsigned case can be deleted from its pop-up');
  await click(byText('.sheet .btn', 'Cancel'));

  // a follow-up is added from the case
  await click(row());
  await click(byText('.sheet .btn', 'Add follow-up'));
  assert.deepEqual(visible('.sheet .qlabel').map((l) => l.textContent),
    ['Complication at birth', 'Mother', 'Wound infection', 'Back to theatre', 'Referred to another hospital', 'Days in hospital afterwards']);
  await click(byText('.sheet .btn', 'Save'));
  assert.match($('.sheet .error').textContent, /Nothing new/);
  await click(byText('.choice', 'Alive')); // the mother
  await click(byText('.sheet .btn', 'Save'), 400);
  const caseFollowUp = async () => {
    await click(row());
    const t = $$('.sheet .case-part').find((p) => p.querySelector('h4').textContent === 'Follow-up').querySelectorAll('.case-row');
    const out = [...t].map((r) => [...r.children].map((c) => c.textContent).join(': '));
    await click(byText('.sheet .btn', 'Close'));
    return out;
  };
  assert.deepEqual(await caseFollowUp(), ['Mother: Alive'], 'the follow-up answers are in the pop-up');
  assert.deepEqual($$('.tag', row()).map((t) => t.textContent), ['Follow-up', 'Not signed'], 'the row shows that it has a follow-up');
  assert.deepEqual(JSON.parse(stored().get('followup').payload).answers, { mother: 'alive' });

  // later: a wound infection. The earlier answer is shown and kept; only the new one is sent.
  await click(row());
  await click(byText('.sheet .btn', 'Update follow-up'));
  assert.equal(byText('.choice.on', 'Alive').getAttribute('aria-pressed'), 'true', 'the earlier answer is preselected');
  assert.equal(visible('.sheet .qlabel').some((l) => /Cause of death/.test(l.textContent)), false, 'the cause of death is only asked after "Died"');
  await click(byText('.qrow', 'Wound infection').querySelector('.choice'));
  await click(byText('.sheet .btn', 'Save'), 400);
  assert.deepEqual(await caseFollowUp(), ['Mother: Alive', 'Wound infection: Yes']);
  assert.deepEqual(JSON.parse(stored().get('followup').payload).answers, { wound_infection: 'yes' });
  assert.equal($('.chip'), null, 'everything was sent');
});

test('a touch on Cancel works at once, also while the pop-up is still scrolling', async () => {
  // The browser sends no click for a touch that stops scrolling; the buttons that stay in place act on the touch itself.
  const touch = (type, el, x, y) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    const t = { identifier: 7, clientX: x, clientY: y, target: el };
    Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
    Object.defineProperty(ev, 'changedTouches', { value: [t] });
    el.dispatchEvent(ev);
    return ev;
  };
  await click(byText('.tab', 'Log'));
  await openProc('Caesarean section');
  const cancel = () => byText('.sheet-foot .btn', 'Cancel');
  touch('touchstart', cancel(), 100, 500);
  touch('touchend', cancel(), 100, 540); // the finger moved: a swipe, not a press
  assert.ok($('.sheet'), 'a swipe over Cancel does not close the pop-up');
  touch('touchstart', cancel(), 100, 500);
  const end = touch('touchend', cancel(), 103, 502); // a press, without any click from the browser
  await wait(50);
  assert.equal($('.sheet'), null, 'the press closes the pop-up');
  assert.ok(end.defaultPrevented, 'the browser is told not to send its own click as well');

  // a button that scrolls with the page keeps the normal behaviour: a touch alone does not open a procedure
  const proc = byText('.proc', 'Caesarean section');
  touch('touchstart', proc, 100, 300);
  touch('touchend', proc, 100, 300);
  await wait(50);
  assert.equal($('.sheet'), null);
});
