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
globalThis.MutationObserver = window.MutationObserver; // the "More below" hint (scrollHint in ui.js)
globalThis.requestAnimationFrame = window.requestAnimationFrame;
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
    schema: 1,
  }));
  await post('/api/sync', token, { events, cursor: 0 });
  return token;
}
const tokA = await studentWithEntries('CC1001', ['cs', 'appendectomy']);
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

  // ---- overview: the numbers, then three tabs; Students is open first
  assert.ok($('[data-admin]'), 'administrator screen');
  assert.equal($('.hosp-setup'), null, 'an administrator is not asked for a hospital');
  assert.match($('.who').textContent, /Administrator · Anders/);
  const stats = $$('.stats .stat, .stats > div').map((e) => e.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(stats.some((t) => /^2\s*students/.test(t)), `students stat in ${stats}`);
  assert.ok(stats.some((t) => /^1\s*supervisors/.test(t)), 'supervisors stat');
  assert.ok(stats.some((t) => /^3\s*cases/.test(t)), 'cases stat');
  assert.ok(stats.some((t) => /^1\s*hospitals/.test(t)), 'hospitals with at least one case');
  assert.ok(!stats.some((t) => /to sign/.test(t)), 'no "to sign" on the overview');
  assert.match($('.note.reminder').textContent, /No backup has been downloaded in the last 7 days./, 'a reminder while there is data and no backup');
  await click(byText('.note.reminder .change', 'Go to backup'), 400);
  assert.equal($('.tab.on').textContent, 'More', 'the button opens More, where the backup is');
  assert.ok(byText('.card h3', 'Backup'));
  await click(byText('.tab', 'Overview'), 400);
  assert.deepEqual($$('.log-parts .ctab').map((b) => b.textContent), ['Students', 'Procedures', 'Hospitals']);
  assert.doesNotMatch($('.main').textContent, /created the student account/, 'recent changes are under More');
  assert.equal($('.log-parts .ctab.on').textContent, 'Students');
  assert.equal($('.tbl'), null, 'no wide tables any more');
  // a row per student, like a supervisor's My students
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['CC1001', 'CC1002']);
  const row1 = byText('.srow', 'CC1001');
  assert.match(row1.textContent, /2 cases · last 20 Oct/);
  assert.equal(row1.querySelector('.tag').textContent, '2 to sign');
  type($('.search'), 'cc 1002');
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['CC1002'], 'the search narrows the list');
  type($('.search'), 'zzz');
  assert.match($('.main').textContent, /No student matches/);
  type($('.search'), '');
  clean();
  // procedures and hospitals: a tile each, like the student's Progress
  await click(byText('.ctab', 'Procedures'));
  const csTile = byText('.ptile', 'Caesarean section');
  assert.equal(csTile.querySelector('.pcount').textContent, '2 cases');
  assert.equal(csTile.querySelector('.proc-count').textContent, 'Observed 0 · Assisted 0 · Performed 2 · 2 students');
  // a search on Procedures and Hospitals too, kept per tab
  assert.equal($$('.ptile').length, 2);
  type($('.search'), 'APPEND');
  assert.deepEqual($$('.ptile strong').map((e) => e.textContent), ['Appendectomy'], 'the search narrows the tiles, any case');
  type($('.search'), 'zzz');
  assert.match($('.main').textContent, /No procedure matches\./);
  type($('.search'), 'append');
  await click(byText('.ctab', 'Hospitals'));
  assert.equal($('.search').value, '', 'each tab has its own search');
  type($('.search'), 'zzz');
  assert.match($('.main').textContent, /No hospital matches\./);
  type($('.search'), 'masanga');
  await click(byText('.ctab', 'Procedures'));
  assert.equal($('.search').value, 'append', 'what was typed is kept');
  type($('.search'), '');
  await click(byText('.ctab', 'Hospitals'));
  assert.equal($('.search').value, 'masanga');
  assert.deepEqual($$('.ptile').map((t) => [t.querySelector('strong').textContent, t.querySelector('.pcount').textContent, t.querySelector('.proc-count').textContent]),
    [['Masanga Hospital', '3 cases', 'Performed 3 · 2 students']]);
  clean();
  await click(byText('.tab', 'More'), 400);
  assert.match(byText('.card', 'Recent changes').textContent, /created the student account CC1001/, 'recent changes list under More');
  await click(byText('.tab', 'Overview'), 400);

  // ---- one student's page: tapped on Students; the cases by week, each opens the case pop-up, only to read
  await click(byText('.ctab', 'Students'));
  await click(byText('.srow', 'CC1001'), 600);
  assert.equal($('.detail-title h2').textContent, 'CC1001');
  assert.equal($('.tab.on').textContent, 'Overview', 'the page is part of Overview');
  assert.deepEqual($$('.sv-detail .stat').map((e) => [...e.children].map((c) => c.textContent).join(' ')), ['2 cases', '0 signed', '2 to sign']);
  assert.deepEqual($$('.log-parts .ctab').map((b) => b.textContent), ['Cases', 'Progress']);
  assert.ok($('.day-head'), 'a heading per week');
  const caseRows = $$('.entry.tap');
  assert.equal(caseRows.length, 2);
  const appRow = caseRows.find((r) => /Appendectomy/.test(r.textContent));
  assert.deepEqual($$('.e-sub', appRow).map((e) => e.textContent), ['Operated with supervisor · 20 Oct', 'Masanga Hospital']);
  assert.equal(appRow.querySelector('.tag').textContent, 'Not signed');
  await click(appRow);
  assert.equal($('.sheet .case-title').textContent, 'Appendectomy');
  assert.deepEqual($$('.sheet .ctab').map((b) => b.textContent), ['Details', 'Follow-up']);
  assert.equal(byText('.sheet button', 'Delete this case'), undefined, 'an administrator cannot delete');
  assert.equal(byText('.sheet button', 'follow-up'), undefined, 'nor add a follow-up');
  clean();
  await click(byText('.sheet .btn', 'Close'));
  await click(byText('.ctab', 'Progress'));
  assert.match($('.main').textContent, /No targets yet\. A supervisor sets them\./);
  assert.ok(byText('.ptile', 'Appendectomy'), 'procedures without a target');
  // Account: the same pop-up as under Users; "See cases" there just goes back to the page
  await click(byText('.detail-head .btn', 'Account'), 200);
  assert.ok(byText('.sheet .acct-title', 'Supervisors'));
  await click(byText('.sheet .fact', 'Cases').querySelector('.change'));
  assert.equal($('#overlay.open'), null);
  assert.equal($('.detail-title h2').textContent, 'CC1001');
  await click($('.back-btn'), 400);
  assert.equal($('.detail-head'), null, 'back on the overview');
  assert.equal($('.log-parts .ctab.on').textContent, 'Students', 'on the tab it was opened from');

  // ---- Manage users: the list of every account, and (behind "Add users") the page to add users
  assert.deepEqual($$('.nav .tab').map((b) => b.textContent), ['Overview', 'Manage users', 'Download data', 'More'], 'four tabs at the top');
  await click(byText('.tab', 'Manage users'));
  assert.equal($('.detail-title h2').textContent, 'Manage users');
  assert.equal($$('.srow').length, 4);
  // a small heading per kind of account, like the week headings in History, each over its own rows
  const heads = () => $$('.main h3.day-head').map((e) => [e.textContent, e.nextElementSibling.querySelectorAll('.srow').length]);
  assert.deepEqual(heads(), [['Administrators', 1], ['Supervisors', 1], ['Students', 2]]);
  type($('.search'), 'anna');
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['SUP-ANNA']);
  assert.deepEqual(heads(), [['Supervisors', 1]], 'only the headings that have rows');
  // like the rows elsewhere: the id alone in medium, the name under it in plain text, then the grey line
  assert.deepEqual([...$('.srow .srow-main').children].map((e) => [e.tagName, e.className, e.textContent.replace(/ · last login.*/, '')]),
    [['STRONG', '', 'SUP-ANNA'], ['SPAN', 'small', 'Dr Anna Kamara'], ['SPAN', 'muted small', 'Supervisor']]);
  type($('.search'), '');
  // "Show": a button like the filters in History, a pop-up with a row per kind of account and how many there are
  assert.equal($('.main select'), null, 'no drop-down list');
  const showBtn = byText('.filter', 'Show');
  assert.match(showBtn.textContent, /Everyone/);
  assert.ok(!showBtn.classList.contains('on'));
  await click(showBtn, 100);
  assert.deepEqual($$('.sheet .opt').map((o) => [o.firstChild.textContent, o.querySelector('.opt-n').textContent]),
    [['Everyone', '4'], ['Students', '2'], ['Supervisors', '1'], ['Administrators', '1']]);
  assert.ok(byText('.sheet .opt', 'Everyone').classList.contains('on'), 'the current choice is marked');
  await click(byText('.sheet .opt', 'Students'), 100);
  assert.equal($('#overlay.open'), null, 'one tap chooses and closes');
  assert.equal($$('.srow').length, 2);
  assert.deepEqual(heads(), [['Students', 2]]);
  assert.match(byText('.filter', 'Show').textContent, /Students/);
  assert.ok(byText('.filter', 'Show').classList.contains('on'), 'coloured while not everyone is shown');
  // "Showing N of M" and "Show all", as in History; the numbers follow the search
  assert.equal($('.shown span').textContent, 'Showing 2 of 4');
  type($('.search'), 'cc1001');
  assert.equal($('.shown span').textContent, 'Showing 1 of 1');
  type($('.search'), 'zzz');
  assert.match($('.main').textContent, /No accounts match/);
  type($('.search'), '');
  await click(byText('.shown .change', 'Show all'), 100);
  assert.equal($$('.srow').length, 4);
  assert.equal($('.shown'), null, 'gone when everyone is shown');
  assert.match(byText('.filter', 'Show').textContent, /Everyone/);
  // the pop-up can also choose Everyone again
  await click(byText('.filter', 'Show'), 100);
  await click(byText('.sheet .opt', 'Supervisors'), 100);
  assert.equal($$('.srow').length, 1);
  await click(byText('.filter', 'Show'), 100);
  await click(byText('.sheet .opt', 'Everyone'), 100);
  assert.equal($$('.srow').length, 4);
  // a student's page from Manage users: part of it, and tapping Manage users goes back to the list
  await click(byText('.srow', 'CC1002'), 200);
  await click(byText('.sheet .fact', 'Cases').querySelector('.change'), 600);
  assert.equal($('.detail-title h2').textContent, 'CC1002');
  assert.equal($('.tab.on').textContent, 'Manage users');
  assert.equal($('.back-btn').getAttribute('aria-label'), 'Back to users');
  assert.equal($$('.entry.tap').length, 1);
  await click(byText('.tab', 'Manage users'), 400);
  assert.equal($$('.srow').length, 4, 'back on the list');

  // ---- add students in bulk: one already exists. "Add users" on Manage users opens a page with an arrow back
  await click(byText('.detail-head .btn', 'Add users'));
  assert.equal($('.detail-title h2').textContent, 'Add users');
  assert.equal($('.tab.on').textContent, 'Manage users', 'part of Manage users');
  assert.equal($('.back-btn').getAttribute('aria-label'), 'Back to the list of users');
  // the kind of account in the same switch as elsewhere; the form in a card with a heading, like those under More
  assert.deepEqual($$('.log-parts .ctab').map((b) => b.textContent), ['Students', 'Supervisor', 'Administrator']);
  assert.equal($('.log-parts .ctab.on').textContent, 'Students');
  assert.equal($('.add-tab .card h3').textContent, 'New students');
  assert.match($('.add-tab .field-hint').textContent, /One student per line/);
  type($('#ids'), 'cc2001 Mohamed  Kamara\nCC2002, CC2003\nCC1001');
  await submit($('.setup-form'), 800);
  assert.match($('.sheet').textContent, /3 accounts created/);
  assert.match($('.sheet').textContent, /Not created: CC1001/);
  assert.match($('.sheet').textContent, /cannot be shown again/);
  // a row per person in a grey box: the id, the name in grey under it, the password on the right
  assert.equal($('.sheet table'), null, 'no table');
  const pwRows = $$('.sheet .pw-row');
  const shown = Object.fromEntries(pwRows.map((r) => [r.querySelector('.fact-text strong').textContent, r.querySelector('.pw').textContent]));
  assert.deepEqual(Object.keys(shown), ['CC2001', 'CC2002', 'CC2003']);
  assert.ok(await loginOk('CC2001', shown.CC2001), 'the shown password works');
  assert.equal(pwRows[0].querySelector('.fact-text span').textContent, 'Mohamed Kamara', 'the name is shown with the password');
  assert.deepEqual($$('.sheet .sheet-foot .btn').map((b) => b.textContent), ['Done', 'Copy all']);
  await click(byText('.sheet .btn', 'Done'));
  assert.equal($('#ids').value, '', 'the list is cleared');
  clean();

  // ---- add a supervisor
  await click(byText('.log-parts .ctab', 'Supervisor'));
  assert.equal($('.add-tab .card h3').textContent, 'New supervisor');
  assert.equal($('label[for=newname]').textContent, 'Name');
  assert.equal($('label[for=newname]').nextElementSibling.textContent, 'Students see it next to a signature.', 'the hint in grey under the label');
  type($('#newid'), 'sup-ben');
  type($('#newname'), 'Dr Ben Sesay');
  await submit($('.setup-form'), 800);
  assert.match($('.sheet').textContent, /Supervisor account created/);
  const supPw = $('.sheet .pw-row .pw').textContent;
  assert.equal(server.db.prepare("SELECT role, display_name FROM users WHERE candidate = 'SUP-BEN'").get().display_name, 'Dr Ben Sesay');
  assert.ok(await loginOk('SUP-BEN', supPw));
  await click(byText('.sheet .btn', 'Done'));

  // an invalid id is refused on the screen
  await click(byText('.log-parts .ctab', 'Administrator'));
  assert.equal($('label[for=newname]').nextElementSibling.textContent, 'Shown at the top of their own screen.', 'administrators do not sign, so no word about signatures');
  type($('#newid'), '!');
  await submit($('.setup-form'), 100);
  assert.match($('.error').textContent, /2 to 20/);

  // ---- the arrow goes back to the list; the new student has the name that was typed
  await click($('.back-btn'), 400);
  assert.equal($('.detail-title h2').textContent, 'Manage users');
  assert.ok(byText('.srow', 'Mohamed Kamara'), 'the name is in the list');
  type($('.search'), 'mohamed');
  assert.deepEqual($$('.srow strong').map((e) => e.textContent), ['CC2001'], 'search finds a name');
  type($('.search'), '');

  // ---- a student: give a supervisor access
  await click(byText('.srow', 'CC1002'), 200);
  // laid out like the case pop-up: a heading that stays, grey boxes with a row per fact and a round button on the right
  assert.equal($('.sheet .sheet-head .case-title').textContent, 'CC1002');
  assert.equal($('.sheet .sheet-head .case-sub').textContent, 'Student');
  assert.deepEqual($$('.sheet .acct > .facts:first-of-type .fact-text > span').map((e) => e.textContent), ['Name', 'Password', 'Last login', 'Status', 'Cases']);
  assert.equal(byText('.sheet .fact', 'Name').querySelector('.change').textContent, 'Add');
  assert.equal($('.sheet .link'), null, 'no underlined links (only "Delete … for good" for a disabled account)');
  assert.deepEqual($$('.sheet .sheet-foot .btn').map((b) => b.textContent), ['Close']);
  assert.match(byText('.sheet .acct-title', 'Supervisors').nextElementSibling.nextElementSibling.textContent, /None yet/);
  // ---- give the student a supervisor: a list to choose from, one tap adds
  assert.equal($('.sheet select'), null, 'no drop-down list');
  await click(byText('.sheet .btn', 'Add a supervisor'), 100);
  assert.match($('.sheet h3').textContent, /Add a supervisor/);
  await click(byText('.sheet .opt', 'Dr Anna Kamara'), 700);
  assert.match($('#toast').textContent, /Added/);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE supervisor = 'SUP-ANNA' AND student = 'CC1002'").get().n, 1);
  // a supervisor by name, the id in grey under it, Remove on the right; all in one grey box
  const supRow = byText('.sheet .acct .facts .fact', 'Dr Anna Kamara');
  assert.deepEqual([...supRow.querySelector('.fact-text').children].map((e) => e.textContent), ['Dr Anna Kamara', 'SUP-ANNA']);
  await click(byText('.sheet .btn', 'Add a supervisor'), 100);
  assert.deepEqual($$('.sheet .opt > span:first-child').map((e) => e.textContent), ['Dr Ben Sesay'], 'only supervisors not added yet');
  await click(byText('.sheet .btn', 'Cancel'), 100);
  assert.equal($('.sheet .case-title').textContent, 'CC1002', 'Cancel goes back to the account');
  await click(byText('.sheet .btn', 'Close'));
  // the supervisor's pop-up lists the student the same way
  await click(byText('.srow', 'SUP-ANNA'), 200);
  assert.equal($('.sheet .case-sub').textContent, 'Supervisor · Dr Anna Kamara');
  assert.equal(byText('.sheet .fact', 'Cases'), undefined, 'cases only for a student');
  const studentRow = byText('.sheet .acct .facts .fact', 'CC1002');
  assert.ok(studentRow.closest('.facts').previousElementSibling.matches('.acct-note'), 'under the Students heading');
  await click(studentRow.querySelector('.change'), 700);
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n, 0);
  assert.match($('.sheet').textContent, /None yet/);
  clean();
  await click(byText('.sheet .btn', 'Close'));
  await click(byText('.srow', 'CC1002'), 200);

  // ---- give a student a name afterwards: its own pop-up, Cancel and Save at the bottom
  await click(byText('.sheet .fact', 'Name').querySelector('.change'), 100);
  assert.equal($('.sheet h3').textContent, 'Add a name');
  assert.deepEqual($$('.sheet .sheet-foot .btn').map((b) => b.textContent), ['Cancel', 'Save']);
  await click(byText('.sheet .btn', 'Cancel'), 100);
  assert.equal($('.sheet .case-title').textContent, 'CC1002', 'Cancel goes back to the account');
  await click(byText('.sheet .fact', 'Name').querySelector('.change'), 100);
  type($('#rename'), '  Fatmata   Bangura ');
  await click(byText('.sheet .btn', 'Save'), 800);
  assert.match($('#toast').textContent, /Name saved/);
  assert.match($('.sheet .case-sub').textContent, /Student · Fatmata Bangura/);
  assert.equal(server.db.prepare("SELECT display_name FROM users WHERE candidate = 'CC1002'").get().display_name, 'Fatmata Bangura');
  assert.equal(byText('.sheet .fact', 'Name').querySelector('.change').textContent, 'Change');

  // ---- reset a password: confirm first, then shown once
  await click(byText('.sheet .change', 'New password'), 100);
  assert.match($('.sheet').textContent, /New password for CC1002\?/);
  await click(byText('.sheet .btn', 'Cancel'), 100);
  await click(byText('.sheet .change', 'New password'), 100);
  await click(byText('.sheet .btn', 'Reset password'), 800);
  const newPw = $('.sheet .pw-row .pw').textContent;
  assert.ok(await loginOk('CC1002', newPw), 'the new initial password works');
  assert.equal((await post('/api/login', null, { candidate: 'CC1002', password: 'initial-pw-1' })).error, 'bad_credentials');
  await click(byText('.sheet .btn', 'Done'));

  // ---- disable and enable
  await click(byText('.srow', 'CC1002'), 200);
  await click(byText('.sheet .change', 'Disable'), 100);
  assert.match($('.sheet').textContent, /Disable CC1002\?/);
  await click(byText('.sheet .btn.danger', 'Disable'), 800);
  assert.match($('.sheet').textContent, /Disabled/);
  assert.equal((await post('/api/login', null, { candidate: 'CC1002', password: newPw })).error, 'bad_credentials');
  assert.equal($('.sheet .e-tags .tag').textContent, 'Disabled', 'a tag in the heading, like in the list');
  await click(byText('.sheet .change', 'Enable'), 800);
  assert.match($('.sheet').textContent, /Active/);
  assert.equal(byText('.sheet .link', 'for good'), undefined, 'an active account cannot be deleted');
  await click(byText('.sheet .btn', 'Close'));

  // ---- delete an account for good: only after disabling it, and after a second confirmation
  await click(byText('.srow', 'CC2003'), 200);
  await click(byText('.sheet .change', 'Disable'), 100);
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
  assert.equal(byText('.sheet .change', 'New password'), undefined);
  assert.equal(byText('.sheet .change', 'Disable'), undefined);
  await click(byText('.sheet .btn', 'Close'));

  // ---- the changes are listed under More
  await click(byText('.tab', 'More'), 400);
  assert.match($('.main').textContent, /ADMIN-ANDERS reset the password of CC1002/);
  assert.match($('.main').textContent, /disabled CC1002/);
  assert.match($('.main').textContent, /ADMIN-ANDERS deleted CC2003 and its data for good/);
  assert.doesNotMatch($('.main').textContent, new RegExp(newPw), 'no password anywhere on the page');

  // ---- More, then log out
  assert.match($('.main').textContent, /ADMIN-ANDERS/);
  assert.deepEqual($$('.more-tab .card').map((c) => c.querySelector('h3, summary strong').textContent), ['Account', 'Backup', 'Advanced']);
  // Recent changes is under Advanced, after About: shut at first, and it stays open when the tab is drawn again
  const changes = () => $('details.advanced');
  assert.equal(changes().querySelector('summary .muted').textContent, 'About and recent changes');
  assert.deepEqual($$('h3', changes()).map((e) => e.textContent), ['About', 'Recent changes']);
  assert.equal(changes().open, false);
  changes().querySelector('summary').click();
  await wait(50);
  assert.equal(changes().open, true);
  await click(byText('.tab', 'More'), 400);
  assert.equal(changes().open, true, 'still open after a fresh answer from the server');

  // ---- spreadsheet downloads, on their own tab: two switches (people, file format) and a row per file with a Download button
  await click(byText('.tab', 'Download data'), 300);
  assert.equal($('.main h2').textContent, 'Download data');
  const dl = byText('.more-tab .card', 'Spreadsheets');
  assert.equal($('select', dl), null, 'no drop-down list');
  assert.deepEqual($$('.ctab', dl).map((b) => b.textContent), ['Anonymous', 'With names', 'Excel', 'Other programs']);
  assert.deepEqual($$('.ctab.on', dl).map((b) => b.textContent), ['Anonymous', 'Excel'], 'anonymous at first; Excel format (;) at first');
  assert.deepEqual($$('.dl-files .fact-text strong', dl).map((e) => e.textContent), ['Progress per student', 'Procedures per student', 'Procedures per hospital', 'Every case', 'Codebook']);
  const download = async (title) => click(byText('.dl-files .fact', title).querySelector('.change'), 400);
  // anonymous: a code instead of the candidate number, and no names
  await download('Procedures per student');
  assert.equal(saved.length, 1);
  assert.match(saved[0].filename, /^logbook-procedures-anonymous-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv1 = await saved[0].blob.text(); // text() drops the byte order mark; the file itself keeps it
  assert.deepEqual([...Buffer.from(await saved[0].blob.arrayBuffer()).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv1, /^student_code;procedure_id;procedure;/);
  assert.match(csv1, /\nS-[0-9A-F]{8};cs;Caesarean section;0;0;1;0;1;1;0;0;(1;0|0;1)\r?\n/, 'counts, then follow-ups done, open, missed (open or missed depends on today)');
  assert.doesNotMatch(csv1, /CC1001|CC1002/);
  // with names, in the other format
  await click(byText('.ctab', 'With names', dl));
  await click(byText('.ctab', 'Other programs', byText('.more-tab .card', 'Spreadsheets')));
  await download('Every case');
  assert.match(saved[1].filename, /^logbook-entries-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv2 = await saved[1].blob.text();
  assert.match(csv2, /^candidate,name,entry_id,performed_on,entered_on,hospital,/);
  assert.match(csv2, /,Masanga Hospital,cs,Caesarean section,/);
  assert.match(csv2, /,followup_status,/);
  await download('Codebook');
  assert.match(saved[2].filename, /^logbook-codebook-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.match(await saved[2].blob.text(), /^file,column,meaning,code,code_meaning/);
  await click(byText('.ctab', 'Excel', byText('.more-tab .card', 'Spreadsheets')));
  clean();
  await click(byText('.tab', 'More'), 400);
  assert.match(byText('.card', 'Recent changes').textContent, /downloaded the anonymous "Procedures per student" spreadsheet/, 'downloads are listed under Recent changes');
  assert.match(byText('.card', 'Recent changes').textContent, /downloaded the "Every case" spreadsheet/);
  assert.match($('.main').textContent, /Treat it with care\./);
  assert.match($('.main').textContent, /Last backup\s*never/);
  // the same More as a student's: "Advanced" with About (version, server) and "Your data"
  assert.deepEqual($$('details.advanced .fact-text > span').map((x) => x.textContent), ['Version', 'Server', 'Your data']);
  await click(byText('details.advanced .fact', 'Your data').querySelector('.change'));
  assert.match($('.sheet h3').textContent, /Your data/);
  await click(byText('.sheet .btn', 'Close'));
  await click(byText('.btn', 'Download backup'), 600);
  assert.equal(saved.length, 4);
  assert.match(saved[3].filename, /^logbook-backup-\d{4}-\d{2}-\d{2}\.db$/);
  assert.equal(Buffer.from(await saved[3].blob.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3', 'a real database file');
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
  assert.equal(byText('.top button', 'Refresh'), undefined, 'no Refresh button');
  // a page on show is fetched again when the app comes back on the screen, and typing in the search goes on
  await click(byText('.tab', 'Manage users'), 600);
  const search = $('.search');
  search.focus();
  search.value = 'CC';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await addUser(server.db, 'CC1777', 'initial-pw-1');
  document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(600);
  assert.ok(byText('.srow strong', 'CC1777'), 'an account added meanwhile shows up by itself');
  assert.equal(document.activeElement, $('.search'), 'the search field keeps the keyboard');
  assert.equal($('.search').value, 'CC');
  // a student's page too: a case synced meanwhile shows up when the app comes back on the screen
  await click(byText('.tab', 'Overview'), 600);
  await click(byText('.srow', 'CC1001'), 600);
  assert.equal($$('.entry.tap').length, 2);
  await post('/api/sync', tokA, {
    cursor: 0,
    events: [{ id: '00000000-0000-4000-8000-000000000999', type: 'entry', ts: new Date().toISOString(), hospital: 'Masanga Hospital', procedure: 'cs', role: 'assisting', performed_on: '2026-10-21', entered_on: '2026-10-21', schema: 1 }],
  });
  document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(600);
  assert.equal($$('.entry.tap').length, 3, 'fetched again by itself');
  assert.equal($('.detail-title h2').textContent, 'CC1001', 'still on the same page');
  server.db.prepare('DELETE FROM sessions').run();
  await click(byText('.tab', 'Manage users'), 600); // fetched again: the server says the session ended
  assert.ok($('#cand'), 'back at the login screen');
  assert.match(document.body.textContent, /session has ended/);
  assert.equal($('[data-admin]'), null);
});
