// End-to-end test in jsdom against a real in-process server:
// first login with the initial password -> choose password -> log -> auto-sync -> log out ->
// log in again on a "new tablet" (empty local storage) -> entries come back from the server.
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createServer } from '../server/app.js';
import { addUser, newDatabaseId } from '../server/lib.js';
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
  const b = byText('.log-parts .ctab', part);
  if (b.getAttribute('aria-selected') !== 'true') await click(b);
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
  assert.match($('.sheet').textContent, /Each case you log/, 'a student reads what is stored about students');
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
  assert.ok($('.hosp-setup'), 'hospital question is shown once per tablet');
  assert.equal($('.setup h1').textContent, 'Where do you work?');
  // laid out like More: a row with the hospital and a button that opens the same menu
  assert.match($('.hosp-setup .fact').textContent, /Hospital\s*Not chosen yet/);
  const goBtn = $('.hosp-setup > .btn');
  assert.equal(goBtn.textContent, 'Choose your hospital', 'the button says what is missing');
  assert.equal(goBtn.disabled, true);
  assert.ok($('.hosp-setup .hpick').hidden, 'the menu is closed until the button is tapped');
  const chooseBtn = $('.hosp-setup [aria-label="Change hospital"]');
  assert.equal(chooseBtn.textContent, 'Choose');
  await click(chooseBtn, 100);
  assert.ok(!$('.hosp-setup .hpick').hidden, 'the button opens the hospital menu');
  assert.equal($$('.hosp-setup .hlist .row-btn').length, HOSPITALS.length, 'every hospital is a button');
  assert.equal($('.hosp-setup .hlist .on'), null, 'nothing is chosen yet');
  const firstSearch = $('.hosp-setup .search');
  firstSearch.value = 'masan';
  firstSearch.dispatchEvent(new window.Event('input'));
  assert.deepEqual($$('.hosp-setup .hlist .row-btn').map((b) => b.textContent), ['Masanga Hospital'], 'search narrows the list');
  await click(byText('.hosp-setup .row-btn', 'Masanga Hospital'), 100);
  assert.ok($('.hosp-setup .hpick').hidden, 'the menu closes after choosing');
  assert.match($('.hosp-setup .fact').textContent, /Hospital\s*Masanga Hospital/);
  assert.equal(chooseBtn.textContent, 'Change');
  assert.equal($('.hosp-setup'), $('.setup'), 'still on this screen: nothing is stored before Continue');
  assert.equal(goBtn.textContent, 'Continue');
  await click(goBtn, 300);
  assert.ok($('.top'), 'main screen');
  assert.ok($('.shell > .top-bar > .top + .nav') && $('.shell > .top-bar + .main'), 'header and tabs at the top, the page under them scrolls on its own');
  assert.ok($('.shell > .main > .page'), 'the content sits in .page, which is always a little taller than the screen');
  assert.deepEqual($$('.nav .tab').map((t) => t.textContent), ['New case', 'History', 'Progress', 'More'], 'the first tab says what it is for');
  assert.match($('.who').textContent, /CC1234 · Mohamed Kamara · Masanga Hospital/);
  assert.doesNotMatch(document.body.textContent, /never type/i, 'no warning about typing patient data: there is nowhere to type it');
  assert.equal($('.banner'), null, 'no version strip on the screens: the version is under More, About');
  assert.doesNotMatch(document.body.textContent, /Version \d/);
  assert.doesNotMatch(document.body.textContent, /prototype/i);
  assert.equal(JSON.parse(localStorage.getItem('logbook.session')).must_change, false);

  // ---- the Log tab: Surgery or Delivery, like CapaCare's two logbooks; Surgery is chosen from the start
  assert.deepEqual($$('.log-parts .ctab').map((x) => [x.textContent, x.classList.contains('on')]), [['Surgery', true], ['Delivery', false]], 'two tabs, like in a case');
  assert.equal(byText('.log-parts .ctab', 'Surgery').getAttribute('aria-selected'), 'true', 'Surgery is chosen from the start');
  assert.equal($('.log-title').textContent, 'Add a new case', 'the heading says what the page is for, in the same word as the counts');
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
  assert.deepEqual($$('.sheet .choices.wide .choice strong').map((x) => x.textContent), ['Observed', 'Assisted', 'Delivered, supervised', 'Delivered alone']);
  // each role: a small box on the right (hands on or off) and a line in two sentences: what I did, what the senior did
  const roleTags = () => $$('.sheet .choices.wide .choice .choice-tag').map((x) => [x.textContent, x.classList.contains('on')]);
  assert.deepEqual(roleTags(), [['Hands off', false], ['Hands on', true], ['Hands on', true], ['Hands on', true]]);
  assert.equal(byText('.sheet .choice', 'Delivered alone').querySelector('.choice-hint').textContent, 'I delivered. No supervisor was in the room.');
  await click(byText('.sheet .btn', 'Cancel'));
  await openProc('Caesarean section');
  assert.deepEqual($$('.sheet .choices.wide .choice strong').map((x) => x.textContent), ['Observed', 'Assisted', 'Surgeon, supervised', 'Surgeon, independent']);
  assert.deepEqual(roleTags(), [['Not scrubbed', false], ['Scrubbed', true], ['Scrubbed', true], ['Scrubbed', true]], 'scrubbed or not, on the right of each role');
  assert.ok($('.sheet .choices.wide').classList.contains('column'), 'one role per row, so each fits on one line');
  assert.deepEqual($$('.sheet .choices.wide .choice-hint').map((x) => x.textContent),
    ['I watched. Others operated.', 'I helped. A senior surgeon operated.', 'I operated. A senior surgeon helped.', 'I operated. No one more senior was scrubbed.']);
  await click(byText('.sheet .btn', 'Cancel'));

  // ---- log two entries; they are sent automatically
  await openProc('Caesarean section');
  await logAs('Surgeon, independent');
  await openProc('Appendectomy');
  await logAs('Observed', 400);
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
  await logAs('Assisted', 200);
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
  assert.equal($('.note-info:not(.fu-reminder)'), null, 'no message about signatures at the top of History');
  // a reminder of the cases that can still get a follow-up, with a button that shows only those
  assert.match($('.fu-reminder').textContent, /^3 cases can get a follow-up\.Show$/);
  await click(byText('.fu-reminder .change', 'Show'));
  assert.equal($$('.entry').length, 3);
  assert.match($('.shown').textContent, /Showing 3 that can get a follow-up/);
  assert.equal($('.fu-reminder'), null, 'the reminder is not shown while only those are shown');
  await click(byText('.shown button', 'Show all'));
  assert.equal($('.shown'), null);
  assert.match($('.entry .e-sub').textContent, /^Assisted · \d+ \w+$/, 'the row: your role and the date');
  assert.deepEqual($$('.day-head').map((x) => x.textContent), ['This week'], 'a heading for the week, above its entries');
  await click($('.entry'));
  assert.match($('.sheet .case-sub').textContent, /^Assisted · \d+ \w+$/, 'the case shows the role and the date');
  assert.equal($('.sheet .case-hosp').textContent, 'Bo Government Hospital', 'and where it was done, on a line of its own');
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
  // no targets yet: it says so, and every procedure with a case is listed with how many
  const ptiles = () => $$('.ptile').map((t) => t.querySelector('.prow-top').textContent);
  const titles = () => $$('.prog-title').map((x) => x.textContent);
  assert.match($('.page').textContent, /No targets yet\. Your supervisor sets them\./);
  assert.deepEqual(titles(), ['Procedures with a target', 'Procedures without a target']);
  assert.deepEqual(ptiles(), ['Appendectomy1 case', 'Caesarean section1 case', 'Laparotomy1 case']);
  // the supervisor sets a target; the tablet gets it with the next sync, like a signature
  assert.deepEqual((await post('/api/sup/targets', sup, { candidate: 'CC1234', targets: { cs: 30 } })).changed, ['cs']);
  await comeBack();
  await click(byText('.tab', 'Progress'));
  assert.deepEqual(titles(), ['Procedures with a target', 'Procedures without a target']);
  assert.match($('.page').textContent, /Set by your supervisor\./);
  assert.deepEqual(ptiles(), ['Caesarean section1 / 30', 'Appendectomy1 case', 'Laparotomy1 case'], 'the one with a target on top; the others under it, without it');
  assert.match($('.ptile').textContent, /Observed 0 · Assisted 0/);
  await click(byText('.tab', 'History'));
  await click($('.entry'));
  assert.deepEqual($$('.sheet-head .case-top .tag').map((t) => t.textContent), ['Signed'], 'Signed on the right at the top, like in the list');
  assert.match($('.sheet-head .case-signed').textContent, /^Signed by Dr Anna Kamara on /);
  assert.equal($('.sheet .case-del'), null, 'signed entries cannot be deleted');
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
  assert.deepEqual($$('details.advanced .fact-text > span').map((x) => x.textContent), ['Cases', 'Waiting to be sent', 'Last sync', 'Version', 'Your data'],
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
  assert.ok($('.hosp-setup'), 'a fresh tablet asks for the hospital again');
  await click($('.hosp-setup [aria-label="Change hospital"]'), 100);
  await click(byText('.hosp-setup .row-btn', 'Bo Government Hospital'), 100);
  await click($('.hosp-setup > .btn'), 300);

  // the history came back from the server; after logging out, Surgery is chosen again
  assert.equal(byText('.log-parts .ctab', 'Surgery').getAttribute('aria-selected'), 'true');
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
  await click(byText('.tab', 'New case'));
  await openProc('Inguinal hernia repair');
  await logAs('Surgeon, supervised', 200);
  await click(byText('.tab', 'More'));
  await click(byText('.btn', 'Log out'), 200);
  assert.match($('.sheet').textContent, /NOT been sent/);
  assert.ok(byText('.btn.danger', 'Log out and lose them'));
  await click(byText('.btn', 'Cancel'));
  assert.ok($('.top'), 'still logged in after cancel');
  assert.equal($$('.sheet').length, 0);
});

test('a session ended by the server returns to login and keeps the local entries', async () => {
  window.dispatchEvent(new window.Event('online'));
  await wait(400); // the waiting entry is sent
  const before = serverEvents();
  server.db.prepare('DELETE FROM sessions').run(); // e.g. the account was disabled, or the password changed elsewhere
  await click(byText('.tab', 'New case'));
  await openProc('Umbilical hernia repair');
  await logAs('Observed', 500);
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
  await click(byText('.tab', 'New case'));
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
  await click($('.sheet .case-del'));
  await click(byText('.btn.danger', 'Delete'), 700);
  assert.ok(row(), 'the entry is still there');
  assert.match(row().textContent, /Signed/);
  assert.doesNotMatch(row().textContent, /Not signed/);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
});

test('after the server is restored from a backup, the tablet sends its entries again and shows what the server has', async () => {
  window.dispatchEvent(new window.Event('online'));
  await comeBack();
  assert.ok(await core.getMeta('server_db', null), 'the tablet remembers which copy of the data it synced with');
  const one = (sql) => server.db.prepare(sql).get();
  // The backup was taken just before the hernia repair was logged (the test above): the entry and its signature
  // are lost. The server starts from the backup: a new database id, and the numbering continues from the backup's.
  const hernia = one("SELECT seq, id FROM events WHERE owner = 'CC1234' AND type = 'entry' AND payload LIKE '%strang_hernia%'");
  const herniaSign = one(`SELECT id FROM events WHERE type = 'sign' AND target = '${hernia.id}'`);
  server.db.prepare('DELETE FROM events WHERE seq >= ?').run(hernia.seq);
  server.db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'events'").run(hernia.seq - 1);
  newDatabaseId(server.db);
  // on the restored server a supervisor signs an older entry: its number is lower than where this tablet had got to
  const older = one(`SELECT id FROM events e WHERE owner = 'CC1234' AND type = 'entry'
    AND NOT EXISTS (SELECT 1 FROM events g WHERE g.type IN ('sign', 'void') AND g.target = e.id) ORDER BY seq DESC LIMIT 1`);
  assert.equal((await post('/api/sup/sign', await supervisorToken(), { candidate: 'CC1234', ids: [older.id] })).signed, 1);

  await comeBack();
  await wait(800);
  assert.equal(one(`SELECT COUNT(*) AS n FROM events WHERE id = '${hernia.id}'`).n, 1, 'the lost entry was sent again');
  const local = await core.allEvents();
  const entries = core.derive(local);
  assert.ok(entries.find((e) => e.id === older.id).sign, 'the new signature arrived, although its number is low');
  assert.equal(entries.find((e) => e.id === hernia.id).sign, null, 'the lost signature is gone from the tablet too');
  assert.ok(!local.some((e) => e.id === herniaSign.id));
  assert.equal(await core.getMeta('resync', false), false, 'finished');
  assert.equal(core.unsyncedCount(local, await core.sentIds()), 0, 'everything is on the server again');
  await click(byText('.tab', 'History'));
  assert.match($$('.entry').find((e) => e.textContent.includes('Strangulated hernia repair')).textContent, /Not signed/);
  assert.equal($('.chip'), null, 'no sync button: everything is up to date');

  // a later sync is an ordinary one again
  const n = serverEvents();
  await comeBack();
  assert.equal(serverEvents(), n);
});

test('role and details are on one screen, and a follow-up can be added later from History', async () => {
  window.dispatchEvent(new window.Event('online'));
  await click(byText('.tab', 'New case'));
  await openProc('Caesarean section');
  assert.ok(byText('.qlabel', 'Main reason'), 'a caesarean asks its own questions, on the same screen as the role');
  // "Change" date: a browser without showPicker() shows the field; a second press hides it again
  const dateField = $('.sheet input[type=date]');
  await click($('.sheet [aria-label="Change date"]'));
  assert.ok(dateField.classList.contains('show'));
  await click($('.sheet [aria-label="Change date"]'));
  assert.ok(!dateField.classList.contains('show'), 'a second press closes it');
  // only the questions scroll: the buttons are outside that part, so they never move
  assert.deepEqual([...$('.sheet').children].map((c) => c.className), ['scroll-dock', 'sheet-body', 'sheet-foot']);
  assert.ok($('.sheet-body .qcard') && !$('.sheet-body .sheet-foot'), 'the questions in the part that scrolls, the buttons not');
  // the arrow down shows while there is more further down, and goes away at the bottom (jsdom has no layout: pretend)
  const sheet = $('.sheet-body');
  const hint = $('.sheet-foot > .scroll-hint');
  let top = 0;
  Object.defineProperty(sheet, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(sheet, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(sheet, 'scrollTop', { get: () => top, configurable: true });
  sheet.dispatchEvent(new window.Event('scroll'));
  assert.equal(hint.hidden, false, 'more below: the hint shows');
  assert.ok(hint.classList.contains('fade'), 'an arrow that comes after the pop-up opened fades in');
  assert.equal(hint.children.length, 0, 'only a fade, no arrow or button: a scroll button sometimes went too far');
  assert.equal(hint.getAttribute('aria-hidden'), 'true', 'screen readers read the content itself');
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
  assert.deepEqual(visible('.sheet .qcard .qsection').map((x) => x.textContent), ['Your role', 'Mother', 'Baby', 'Complications', 'Operation', 'Surgical Apgar']);
  const sapgar = byText('.sheet .qcard', 'Surgical Apgar');
  await click(sapgar.querySelector('.qsection-wrap .qtip-btn'), 50);
  assert.match(sapgar.querySelector('.qsection-wrap .qhelp').textContent, /for the mother/, 'a "?" after the heading says whose Surgical Apgar it is');
  await click(sapgar.querySelector('.qsection-wrap .qtip-btn'), 50);
  assert.ok(sapgar.textContent.includes('Lowest blood pressure (MAP)'));
  assert.ok(sapgar.textContent.includes('Lowest heart rate (BPM)'));
  assert.equal($('.sheet label[for="q-age_years"]').textContent, 'Age');
  assert.equal($('.sheet label[for="q-age_years"]').closest('.qrow').querySelector('.qtip-btn, .qhelp'), null, 'age needs no explanation: no "?"');
  // an unclear word has a "?" after it; tapping it shows the explanation, tapping again hides it
  const gravida = byText('.sheet .qrow', 'Gravida');
  assert.equal(gravida.querySelector('.qhelp').hidden, true, 'the explanation is hidden at first');
  await click(gravida.querySelector('.qtip-btn'), 50);
  assert.equal(gravida.querySelector('.qhelp').hidden, false);
  assert.match(gravida.querySelector('.qhelp').textContent, /Pregnancies/, 'an unclear word is explained');
  await click(gravida.querySelector('.qtip-btn'), 50);
  assert.equal(gravida.querySelector('.qhelp').hidden, true);
  assert.equal($('.sheet .numgrid'), null, 'number questions are not side by side');
  assert.equal($('#q-gravida').closest('.qrow').nextElementSibling, $('#q-para').closest('.qrow'), 'each on its own line, one under the other');
  assert.ok(byText('.sheet .qrow', 'Number of babies').querySelector('.choices.three'), 'three short choices share one row');
  await click(byText('.choice', 'Twins'));
  assert.deepEqual(visible('.sheet .qcard .qsection').map((x) => x.textContent), ['Your role', 'Mother', 'Baby', 'Second baby', 'Complications', 'Operation', 'Surgical Apgar']);
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
  // the message right under the number, not at the bottom of the form (where it may be out of sight); only that one
  const shownErrors = () => $$('.sheet .num-error').filter((x) => !x.hidden);
  assert.equal(shownErrors().length, 1);
  assert.equal(shownErrors()[0].closest('.qrow'), $('#q-duration_min').closest('.qrow'));
  assert.match(shownErrors()[0].textContent, /whole number from 1 to 1440/, 'a wrong number is explained, nothing saved');
  assert.equal($('#q-duration_min').getAttribute('aria-invalid'), 'true');
  $('#q-duration_min').value = '50';
  $('#q-duration_min').dispatchEvent(new window.Event('input'));
  assert.equal(shownErrors().length, 0, 'typing again takes the message away');
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
  assert.match(row().querySelector('.e-sub').textContent, /^Operated with supervisor · \d+ \w+$/, 'the role and the date');
  assert.match(row().textContent, /Not signed/);
  assert.deepEqual($$('.tag', row()).map((t) => t.textContent), ['Not signed yet'], 'no follow-up tag yet');

  // tapping the case opens it in a pop-up: at the top your role and Not signed, like the row in the list
  await click(row());
  assert.equal($('.sheet h3').textContent, 'Caesarean section');
  // like the row in the list: role, date and hospital in one grey line, the tags on the right
  assert.match($('.sheet-head .case-sub').textContent, /^Operated with supervisor · \d+ \w+$/);
  assert.deepEqual($$('.sheet-head .case-top .tag').map((t) => t.textContent), ['Not signed yet']);
  // then the answers, in a card per part with only what was answered; a heading only when it is not the tab's name
  assert.deepEqual($$('.sheet .case-part h4').map((x) => x.textContent), ['Operation'], 'only the parts with an answer');
  const rows = () => $$('.sheet .case-row').map((r) => [...r.children].map((c) => c.textContent).join(': '));
  assert.deepEqual(rows(), ['Anaesthesia: General', 'Operation time: 50 minutes']);
  assert.equal($('#case-tab-followup').textContent, 'No follow-up yet.');
  // Delete: in red on the line of the tabs, on the right; at the bottom Close and the follow-up, the bigger one (.save)
  assert.equal($('.sheet-head .case-tabbar .case-del').textContent, 'Delete this case');
  // two tabs: Details (open first) and Follow-up; the follow-up button only on the Follow-up tab
  const tabsShown = () => ({
    tabs: $$('.sheet-head .ctab').map((t) => [t.textContent, t.classList.contains('on')]),
    panel: $$('.sheet .case-tab').filter((p) => !p.hidden).map((p) => p.id),
    foot: $$('.sheet-foot .btn').filter((b) => !b.hidden).map((b) => [b.textContent, b.classList.contains('save')]),
  });
  assert.deepEqual(tabsShown(), { tabs: [['Details', true], ['Follow-up', false]], panel: ['case-tab-details'], foot: [['Close', false]] });
  await click(byText('.sheet-head .ctab', 'Follow-up'));
  assert.deepEqual(tabsShown(), { tabs: [['Details', false], ['Follow-up', true]], panel: ['case-tab-followup'], foot: [['Close', false], ['Add follow-up', true]] });
  await click(byText('.sheet-head .ctab', 'Details'));
  assert.deepEqual(tabsShown().foot, [['Close', false]], 'back on Details: no follow-up button');
  await click(byText('.sheet .btn', 'Close'));
  assert.equal($('.sheet'), null);
  await click(row());
  await click($('.sheet .case-del'));
  assert.equal($('.sheet h3').textContent, 'Delete this case?', 'an unsigned case can be deleted from its pop-up');
  await click(byText('.sheet .btn', 'Cancel'));

  // a follow-up is added from the case
  await click(row());
  await click(byText('.sheet-head .ctab', 'Follow-up'));
  await click(byText('.sheet .btn', 'Add follow-up'));
  // headed like the case pop-up (the procedure, your role and the date, the hospital), with a round arrow back to the
  // case before it; then, like a new case, the questions in grey cards, and only Save at the bottom
  assert.equal($('.sheet .sheet-head .case-title').textContent, 'Caesarean section');
  assert.deepEqual($$('.sheet .sheet-head .case-sub').map((p) => p.textContent),
    [`Operated with supervisor · ${core.fmtDate(core.localDateISO())}`, 'Bo Government Hospital']);
  assert.ok($('.sheet .sheet-head .back-btn'), 'the arrow back, like on other pages');
  assert.ok($$('.sheet .qcard').length > 0, 'the questions in grey cards');
  assert.deepEqual($$('.sheet .sheet-foot .btn').map((b) => b.textContent), ['Save']);
  await click($('.sheet .back-btn'));
  assert.equal($('.sheet-head .ctab.on').textContent, 'Follow-up', 'back on the case, on its Follow-up tab');
  await click(byText('.sheet .btn', 'Add follow-up'));
  assert.deepEqual(visible('.sheet .qlabel').map((l) => l.textContent),
    ['Outcome', 'Outcome', 'Wound infection', 'Back to theatre', 'Referred to another hospital', 'Days in hospital after the operation']);
  assert.deepEqual(visible('.sheet .qcard .qsection').map((x) => x.textContent), ['Mother', 'Baby', 'Complications', 'Hospital stay'], 'in parts named like the details; the baby too (born alive, as far as the details say)');
  await click(byText('.sheet .btn', 'Save'));
  assert.match($('#toast').textContent, /Nothing new to save/, 'said at the bottom of the screen, where it is always seen');
  await click(byText('.choice', 'Alive')); // the mother
  await click(byText('.sheet .btn', 'Save'), 400);
  const caseFollowUp = async () => {
    await click(row());
    const t = $$('#case-tab-followup .case-row');
    const out = [...t].map((r) => [...r.children].map((c) => c.textContent).join(': '));
    await click(byText('.sheet .btn', 'Close'));
    return out;
  };
  assert.deepEqual(await caseFollowUp(), ['Outcome: Alive'], 'the follow-up answers are in the pop-up');
  assert.deepEqual($$('.tag', row()).map((t) => t.textContent), ['Follow-up added', 'Not signed yet'], 'the row shows that it has a follow-up');
  assert.deepEqual(JSON.parse(stored().get('followup').payload).answers, { mother: 'alive' });

  // later: a wound infection. The earlier answer is shown and kept; only the new one is sent.
  await click(row());
  await click(byText('.sheet-head .ctab', 'Follow-up'));
  await click(byText('.sheet .btn', 'Update follow-up'));
  assert.equal(byText('.choice.on', 'Alive').getAttribute('aria-pressed'), 'true', 'the earlier answer is preselected');
  assert.equal(visible('.sheet .qlabel').some((l) => /Cause of death/.test(l.textContent)), false, 'the cause of death is only asked after "Died"');
  await click(byText('.qrow', 'Wound infection').querySelector('.choice'));
  await click(byText('.sheet .btn', 'Save'), 400);
  assert.deepEqual(await caseFollowUp(), ['Outcome: Alive', 'Wound infection: Yes']);
  assert.deepEqual(JSON.parse(stored().get('followup').payload).answers, { wound_infection: 'yes' });
  assert.equal($('.chip'), null, 'everything was sent');

  // more than 6 weeks after the operation: no follow-up button, and the pop-up says why
  await click(byText('.tab', 'New case'));
  await openProc('Appendectomy');
  const dateInput = $('.sheet input[type=date]');
  dateInput.value = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  dateInput.dispatchEvent(new window.Event('change'));
  await logAs('Assisted', 400);
  await click(byText('.tab', 'History'));
  assert.equal($$('.entry .tag.closed').length, 1, 'in the list it has a tag "Follow-up closed"; the newer ones do not');
  await click($$('.entry').filter((x) => x.textContent.includes('Appendectomy')).at(-1)); // the oldest one
  await click(byText('.sheet-head .ctab', 'Follow-up'));
  assert.equal($('#case-tab-followup').textContent, 'Follow-up is closed: more than 6 weeks after the operation.');
  assert.equal(byText('.sheet .btn', 'follow-up'), undefined, 'no follow-up button');
  await click(byText('.sheet .btn', 'Close'));
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
  await click(byText('.tab', 'New case'));
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

test('"A new version is ready" stays until Restart is tapped; other messages show on top of it for a moment', async () => {
  const { toast, hideToast } = await import('../ui.js');
  let restarted = 0;
  toast('A new version is ready', { sub: 'Tap Restart to use it.', persist: true, action: { label: 'Restart', fn: () => { restarted += 1; } } });
  const shown = () => ($('#toast').classList.contains('show') ? $('#toast').textContent : '');
  assert.match(shown(), /A new version is ready.*Restart/);
  hideToast();
  assert.match(shown(), /A new version is ready/, 'it does not go away by itself');
  toast('Saved', { ms: 30 });
  assert.match(shown(), /^Saved/, 'another message shows on top of it');
  await wait(80);
  assert.match(shown(), /A new version is ready/, 'and then it is back');
  await click(byText('#toast .t-act', 'Restart'), 20);
  assert.equal(restarted, 1);
  assert.match(shown(), /A new version is ready/, 'still there until the app has restarted');
});
