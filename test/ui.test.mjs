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
await addUser(server.db, 'cc 1234', 'initial-pw-1', { name: 'Mohamed Kamara' }); // the admin creates the account: stored as CC1234

const { init } = await import('../app.js');
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const click = async (el, ms) => { assert.ok(el, 'element to click exists'); el.click(); await wait(ms); };
const byText = (sel, text, scope = document) => $$(sel, scope).find((e) => e.textContent.includes(text));
// Tap a role, then Save (every detail question is optional).
const logAs = async (role, ms) => { await click(byText('.choice', role)); await click(byText('.sheet .btn', 'Save'), ms); };
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

const syncNow = async (back) => { await click(byText('.tab', 'More')); await click(byText('.btn', 'Sync now'), 500); await click(byText('.tab', back)); };

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

  // ---- must choose own password; the privacy notice can be read right there
  assert.match($('h1').textContent, /Choose your own password/);
  await click(byText('.setup .btn', 'How your data is used'));
  assert.match($('.sheet h3').textContent, /Your data/);
  assert.match($('.sheet').textContent, /Patient names or numbers/);
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
  $('#hosp').value = 'Masanga Hospital';
  await submit($('.setup-form'));
  assert.ok($('.top'), 'main screen');
  assert.match($('.who').textContent, /CC1234 · Mohamed Kamara · Masanga Hospital/);
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
  await syncNow('Log');
  assert.match($('.who').textContent, /Mohamed Sorie Kamara/, 'a changed name arrives with the next sync');

  // ---- no supervisor yet: nothing is signed, and there is no sign-off button.
  // History has no count of unsigned entries on its tab and no message about them.
  await click(byText('.tab', 'History'));
  assert.equal($('.nav .badge'), null, 'no count on the History tab');
  assert.equal($('.note-info'), null, 'no message about signatures at the top of History');
  assert.match($('.entry .e-meta').textContent, /^\d+ \w+ · (Bo Government|Masanga) Hospital/, 'date · hospital');
  assert.match($('.list').textContent, /Bo Government Hospital/, 'history shows where each procedure was done');
  assert.match($('.list').textContent, /Masanga Hospital/);
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
  await syncNow('History');
  assert.equal($$('.tag.ok').length, 3);
  assert.match($('.entry').textContent, /Signed · Dr Anna Kamara/);
  assert.equal($$('.entry .link.danger').length, 0, 'signed entries cannot be deleted');

  // ---- the More tab lists who can see the entries
  await click(byText('.tab', 'More'));
  assert.match(document.body.textContent, /Your supervisors/);
  assert.match(document.body.textContent, /Dr Anna Kamara/);
  await click(byText('.card .btn', 'How your data is used'));
  assert.match($('.sheet h3').textContent, /Your data/, 'the privacy notice is also under More');
  await click(byText('.sheet .btn', 'Close'));

  // ---- the hospital is a row like candidate number and name, and can still be changed from there
  assert.ok(byText('.kv', 'Hospital'), 'the hospital is shown as a row in the account card');
  assert.ok($('.hpick').hidden, 'the list of hospitals is hidden until "Change" is tapped');
  await click(byText('.kv .link', 'Change'), 100);
  assert.ok(!$('.hpick').hidden);
  await click(byText('.hlist .row-btn', 'Kenema Government Hospital'), 200);
  assert.match(byText('.kv', 'Hospital').textContent, /Kenema Government Hospital/);
  assert.match($('.who').textContent, /Kenema Government Hospital/);
  assert.ok($('.hpick').hidden, 'the list closes after choosing');

  // ---- the More tab: account, supervisors, your data, then the rarely needed things folded away under "Advanced"
  assert.deepEqual($$('section .card').map((c) => c.querySelector('h3, summary strong').textContent), ['Account', 'Your supervisors', 'Your data', 'Advanced']);
  assert.ok(!$('details.advanced').open, 'Advanced is folded when the tab is opened');
  assert.ok(byText('details.advanced .btn', 'Sync now') && byText('details.advanced', 'Version'), 'sync, export and app details are inside it');
  $('details.advanced').open = true;
  $('details.advanced').dispatchEvent(new window.Event('toggle'));
  await click(byText('.btn', 'Sync now'), 500);
  assert.ok($('details.advanced').open, 'tapping Sync now redraws the tab but keeps Advanced open');

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
  assert.match(byText('.proc', 'Caesarean section').textContent, /1 logged/);
  assert.match(byText('.proc', 'Appendectomy').textContent, /1 logged/);
  assert.match(byText('.proc', 'Laparotomy').textContent, /1 logged/);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
  await click(byText('.tab', 'History'));
  assert.equal($$('.entry').length, 3);
  assert.equal($$('.tag.ok').length, 3, 'signatures came back too');
  assert.match($('.entry').textContent, /Signed · Dr Anna Kamara/);
  assert.deepEqual($$('.role-tag').map((t) => t.textContent).sort(), ['Assisted', 'Observed', 'Operated on my own'], 'History says what the student did, in the past tense');

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
  assert.match(byText('.proc', 'Umbilical hernia repair').textContent, /1 logged/, 'the entry made while logged out is still there');
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
  await click(byText('.link', 'Delete', row()));
  await click(byText('.btn.danger', 'Delete'), 700);
  assert.ok(row(), 'the entry is still there');
  assert.match(row().textContent, /Signed · Dr Anna Kamara/);
  assert.equal($('.chip'), null, 'no sync button when everything is up to date');
});

test('role and details are on one screen, and a follow-up can be added later from History', async () => {
  window.dispatchEvent(new window.Event('online'));
  await click(byText('.tab', 'Log'));
  await openProc('Caesarean section');
  assert.ok(byText('.qlabel', 'Main reason'), 'a caesarean asks its own questions, on the same screen as the role');
  const save = () => $('.sheet-foot .btn.save');
  assert.equal(save().textContent, 'Choose your role', 'Save says what is missing');
  assert.equal(save().disabled, true);
  await click(byText('.choice', 'Surgeon, independent'));
  assert.equal(save().textContent, 'Save');
  await click(byText('.choice', 'Surgeon, independent'));
  assert.equal(byText('.choice', 'Surgeon, independent').getAttribute('aria-pressed'), 'true', 'a second tap does not clear the role');
  await click(byText('.choice', 'Surgeon, supervised')); // changed my mind
  assert.deepEqual($$('.sheet .choices.wide .choice.on').map((b) => b.dataset.value), ['supervised'], 'one role at a time');

  // the questions come in parts; the second and third baby only after "Twins" or "Triplets"
  const visible = (sel) => $$(sel).filter((x) => !x.closest('[hidden]') && !x.hidden);
  assert.deepEqual(visible('.sheet .qsection').map((x) => x.textContent), ['Mother', 'Baby', 'Operation', 'Surgical Apgar (mother)']);
  assert.equal($('.sheet label[for="q-age_years"]').textContent, 'Age', 'the mother\'s age needs no "under 1 year"');
  await click(byText('.choice', 'Twins'));
  assert.deepEqual(visible('.sheet .qsection').map((x) => x.textContent), ['Mother', 'Baby', 'Second baby', 'Operation', 'Surgical Apgar (mother)']);
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
  await click(byText('.sheet .btn', 'Save'), 400);
  const stored = () => server.db.prepare("SELECT payload FROM events WHERE owner = 'CC1234' AND type = ? ORDER BY seq DESC LIMIT 1");
  assert.deepEqual(JSON.parse(stored().get('entry').payload).details, { anaesthesia: 'general', duration_min: 50 });

  await click(byText('.tab', 'History'));
  const row = () => $('.entry'); // the newest entry is on top
  assert.match(row().textContent, /Anaesthesia: General · Operation time: 50 minutes/);
  assert.match(row().textContent, /No follow-up yet/);
  await click(byText('.link', 'Add follow-up', row()));
  assert.deepEqual(visible('.sheet .qlabel').map((l) => l.textContent),
    ['Complication at birth', 'Mother', 'Wound infection (antibiotics started for the wound)', 'Back to theatre (same stay)', 'Referred to another hospital', 'Days in hospital afterwards']);
  await click(byText('.sheet .btn', 'Save'));
  assert.match($('.sheet .error').textContent, /Nothing new/);
  await click(byText('.choice', 'Alive')); // the mother
  await click(byText('.sheet .btn', 'Save'), 400);
  assert.match(row().textContent, /Follow-up: Mother: Alive/);
  assert.deepEqual(JSON.parse(stored().get('followup').payload).answers, { mother: 'alive' });

  // later: a wound infection. The earlier answer is shown and kept; only the new one is sent.
  await click(byText('.link', 'Update', row()));
  assert.equal(byText('.choice.on', 'Alive').getAttribute('aria-pressed'), 'true', 'the earlier answer is preselected');
  assert.equal(visible('.sheet .qlabel').some((l) => /Cause of death/.test(l.textContent)), false, 'the cause of death is only asked after "Died"');
  await click(byText('.qrow', 'Wound infection').querySelector('.choice'));
  await click(byText('.sheet .btn', 'Save'), 400);
  assert.match(row().textContent, /Mother: Alive · Wound infection: Yes/);
  assert.deepEqual(JSON.parse(stored().get('followup').payload).answers, { wound_infection: 'yes' });
  assert.equal($('.chip'), null, 'everything was sent');
});
