// administrator.js — the screens an administrator sees: an overview (students, procedures and hospitals, each under
// its own tab), a page per student with their cases, the list of users with the things you do to an account, a form
// to add users, and More (backup, spreadsheets, a log of recent changes).
// Plain JavaScript, no build step. Needs internet; nothing is stored on the tablet.
// app.js decides when to show this (the logged-in account has the role "admin").

import { procName } from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, cases, appShell, pageScroll, setPageScroll, keepTyping, toast, openSheet, closeSheet, saveBlob, fact, privacyFact, advancedCard,
  caseRow, procTile, procedureProgress, filterButton, openFilterSheet,
} from './ui.js';

const ENDED = Symbol('session ended'); // the server ended the session; app.js shows the login screen
const DELIM_KEY = 'logbook.csvDelimiter';
const getDelim = () => { try { return localStorage.getItem(DELIM_KEY) === ',' ? ',' : ';'; } catch { return ';'; } };
const ROLE_NAME = { student: 'Student', supervisor: 'Supervisor', admin: 'Administrator' };

// Everything this screen remembers while it is open. Replaced on every new login.
const fresh = () => ({
  tab: 'overview', users: null, stats: null, audit: null,
  loading: false, error: '', query: '', filter: 'all', addRole: 'student', draft: { ids: '', id: '', name: '' },
  adding: false, // Manage users: the page to add users is open (instead of the list)
  people: 'anonymous', // the spreadsheets: 'anonymous' (codes instead of people) or 'names'; anonymous at every login
  delim: getDelim(), // the spreadsheets: ';' (Excel in most of Europe) or ','; remembered on this device
  overTab: 'students', studentQuery: '', procQuery: '', hospQuery: '', // Overview: the tab on show, and the search on each tab
  detail: null, // one student's page: { candidate, events, entries, loading, error }; part of the tab it was opened from
  detailTab: 'cases', // on a student's page: 'cases' or 'progress'
});
const ad = { token: null, ...fresh() };
let ctx = null; // { root, session, version, onAuthError, onLogout, openChangePassword }

export function mountAdministrator(c) {
  ctx = c;
  if (ad.token !== c.session.token) Object.assign(ad, { token: c.session.token, ...fresh() });
  paint();
  watchVisibility();
  if (ad.users === null && !ad.loading) loadAll();
}

// ---- drawing -----------------------------------------------------------------

// Redraw only if the administrator screen is on show: a slow reply must not paint over the login screen.
function draw() {
  if (ctx && ctx.root.querySelector('[data-admin]')) paint();
}

function paint() {
  const y = pageScroll();
  const typing = keepTyping(ctx.root);
  ctx.root.replaceChildren(appShell({ 'data-admin': '' }, [header(), nav()], body()));
  if (y) setPageScroll(y);
  typing();
}

function header() {
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('strong', {}, 'CapaCare logbook'),
      h('span', { class: 'who' }, `Administrator · ${ctx.session.name || ctx.session.candidate}`)));
}

function nav() {
  // Manage users holds the list of every account and, behind its "Add users" button, the page to add users
  const tabs = [['overview', 'Overview'], ['users', 'Manage users'], ['download', 'Download data'], ['more', 'More']];
  return h('nav', { class: 'nav' }, tabs.map(([id, label]) =>
    h('button', { class: 'tab' + (ad.tab === id ? ' on' : ''), onclick: () => goTab(id) }, label)));
}

// There is no Refresh button: Overview, Manage users and More (recent changes, last backup) are fetched again each
// time they are opened, and when the app comes back on the screen (switched back to, screen turned on) while one of
// them is on show; what was there stays on show until the answer comes. A student's page likewise. Not while a pop-up
// is open, and not on the page to add users, where nothing from the server changes and a redraw could disturb typing.
// A student's page (and the page to add users) is part of the tab it was opened from; tapping that tab goes back.
const FETCHED = ['overview', 'users', 'more'];
function goTab(id) {
  ad.tab = id;
  ad.detail = null;
  ad.adding = false;
  setPageScroll(0);
  draw();
  if (FETCHED.includes(id) && !ad.loading) loadAll({ quiet: true });
}

let watching = false;
function watchVisibility() {
  if (watching) return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !ctx || !ctx.root.querySelector('[data-admin]')) return;
    if (document.getElementById('overlay')?.classList.contains('open') || ad.loading || ad.detail?.loading || ad.adding) return;
    if (ad.detail) loadDetail(ad.detail.candidate, { quiet: true });
    else if (FETCHED.includes(ad.tab)) loadAll({ quiet: true });
  });
}

function body() {
  if (ad.error) return h('div', { class: 'card' }, h('p', { class: 'error' }, ad.error), h('button', { class: 'btn', onclick: () => loadAll() }, 'Try again'));
  if (ad.detail) return detailView();
  if (ad.tab === 'users') return ad.adding ? addView() : usersView();
  if (ad.tab === 'download') return downloadView();
  if (ad.tab === 'more') return moreView();
  return overviewView();
}

// ---- talking to the server ---------------------------------------------------------

async function call(fn) {
  try { return await fn(ctx.session.token); }
  catch (e) {
    if (ctx.onAuthError(e)) return ENDED;
    throw e;
  }
}

async function loadAll({ quiet = false } = {}) {
  ad.loading = !quiet;
  ad.error = '';
  if (!quiet) draw();
  try {
    const [users, stats, audit] = await Promise.all([call(api.adminUsers), call(api.adminStats), call(api.adminAudit)]);
    if (users === ENDED || stats === ENDED || audit === ENDED) return;
    ad.users = users.users;
    ad.stats = stats;
    ad.audit = audit.log;
  } catch (e) { ad.error = e.message; }
  ad.loading = false;
  draw();
}

// ---- Overview --------------------------------------------------------------------------

// A switch like Surgery and Delivery on the student's New case tab (and a supervisor's student page). key: where
// the open tab is kept in `ad`.
function switcher(key, tabs, label, onPick = null) {
  return h('div', { class: 'ctabs log-parts', role: 'tablist', 'aria-label': label },
    tabs.map(([id, text]) => h('button', {
      class: ad[key] === id ? 'ctab on' : 'ctab', type: 'button', role: 'tab', 'aria-selected': String(ad[key] === id),
      onclick: () => { if (ad[key] !== id) { ad[key] = id; if (onPick) onPick(id); draw(); } },
    }, text)));
}

const people = (n) => `${n} ${n === 1 ? 'student' : 'students'}`;

// The numbers at the top, then three tabs: Students (a row each, tap for their page), and Procedures and Hospitals
// (a tile each, the most cases first). The log of recent changes is under More.
function overviewView() {
  const s = ad.stats;
  if (!s) return h('section', {}, h('h2', {}, 'Overview'), h('p', { class: 'muted' }, 'Loading…'));
  const t = s.totals;
  const nothing = h('p', { class: 'muted' }, 'Nothing has been logged yet.');
  const lower = (q) => q.trim().toLowerCase();
  const pages = {
    students: () => studentsPart(s),
    procedures: () => (s.procedures.length
      ? searchable({
        key: 'procQuery', placeholder: 'Search procedure', items: s.procedures,
        matches: (p, q) => procName(p.procedure).toLowerCase().includes(lower(q)),
        item: (p) => procTile(procName(p.procedure), cases(p.total), `Observed ${p.observing} · Assisted ${p.assisting} · Performed ${p.performed} · ${people(p.students)}`),
        noMatch: 'No procedure matches.',
      })
      : nothing),
    hospitals: () => (s.hospitals.length
      ? searchable({
        key: 'hospQuery', placeholder: 'Search hospital', items: s.hospitals,
        matches: (x, q) => x.hospital.toLowerCase().includes(lower(q)),
        item: (x) => procTile(x.hospital, cases(x.entries), `Performed ${x.performed} · ${people(x.students)}`),
        noMatch: 'No hospital matches.',
      })
      : nothing),
  };
  return h('section', { class: 'sv-detail' }, // a column on every tab, so nothing moves when the tab changes
    h('h2', {}, 'Overview'),
    backupReminder(s),
    h('div', { class: 'stats four' }, stat(t.students, 'students'), stat(t.supervisors, 'supervisors'), stat(t.entries, 'cases'), stat(s.hospitals.filter((x) => x.hospital !== '(not recorded)').length, 'hospitals')), // hospitals with at least one case
    switcher('overTab', [['students', 'Students'], ['procedures', 'Procedures'], ['hospitals', 'Hospitals']], 'What to show'),
    (pages[ad.overTab] || pages.students)());
}

// Every student as a row, like a supervisor's My students, with a search: the candidate number, the name, how many
// cases and the day of the last one, and on the right how many wait for a signature.
function studentsPart(s) {
  if (!s.students.length) return h('p', { class: 'muted' }, 'No students yet. Add them under "Manage users".');
  return searchable({
    key: 'studentQuery', placeholder: 'Search candidate number or name', items: s.students, caps: true, list: h('ul', { class: 'list' }),
    matches: (st, text) => {
      const q = core.normCandidate(text);
      return st.candidate.includes(q) || (st.name || '').toUpperCase().replace(/\s+/g, '').includes(q);
    },
    item: studentRow,
    noMatch: 'No student matches. Check the candidate number or the name.',
  });
}

// A search field right under the switch, and under it the list, which narrows while typing.
// What was typed is kept in ad[key] while the app is open, so a fresh answer from the server does not clear it.
function searchable({ key, placeholder, items, matches, item, noMatch, caps = false, list = h('div', { class: 'prows' }) }) {
  const input = h('input', { type: 'search', placeholder, class: 'search', value: ad[key], autocapitalize: caps ? 'characters' : null, autocomplete: 'off' });
  const drawList = () => {
    ad[key] = input.value;
    const shown = items.filter((x) => matches(x, input.value));
    list.replaceChildren(...(shown.length ? shown.map(item) : [h('p', { class: 'muted' }, noMatch)]));
  };
  input.addEventListener('input', drawList);
  drawList();
  return [input, list];
}

function studentRow(st) {
  const waiting = st.entries - st.signed;
  return h('li', {},
    h('button', { class: 'srow', onclick: () => openStudent(st.candidate) },
      h('span', { class: 'srow-main' },
        h('strong', {}, st.candidate),
        st.name ? h('span', { class: 'small' }, st.name) : null,
        h('span', { class: 'muted small' }, st.last_performed_on ? `${cases(st.entries)} · last ${core.fmtDate(st.last_performed_on)}` : cases(st.entries))),
      st.disabled ? h('span', { class: 'tag' }, 'Disabled')
        : waiting > 0 ? h('span', { class: 'tag warn' }, `${waiting} to sign`)
          : st.entries ? h('span', { class: 'tag ok' }, 'All signed') : null));
}

// ---- downloads ---------------------------------------------------------------------------------

function backupReminder(s) {
  const days = s.last_backup ? (Date.now() - Date.parse(s.last_backup)) / 86400000 : Infinity;
  if (days <= 7 || s.totals.entries === 0) return null;
  // a row like "Show all" in History: the text on the left, a round outlined button on the right
  return h('div', { class: 'note reminder' },
    h('span', {}, s.last_backup ? `The last backup was ${Math.floor(days)} days ago.` : 'No backup has been downloaded in the last 7 days.'),
    h('button', { class: 'change', type: 'button', onclick: () => goTab('more') }, 'Go to backup'));
}

const today = () => new Date().toISOString().slice(0, 10);

async function downloadFile(label, fetcher, filename) {
  try {
    const blob = await call(fetcher);
    if (blob === ENDED) return;
    saveBlob(blob, filename);
    toast('File downloaded', { sub: `${label} · ${filename}` });
    loadAll({ quiet: true }); // the download is listed under Recent changes
  } catch (e) {
    toast('Could not download', { sub: e.message });
  }
}

// Laid out like the rest of More: the two choices in the same switch as elsewhere, each with a grey line under it, then
// a row per file with a short line about what is in it and a round Download button on the right.
// Anonymous is chosen at every login, so names are only in a file when someone chose them on purpose.
const FILES = [
  ['progress', 'Progress per student', 'The targets set by supervisors, and how many each student has performed.'],
  ['procedures', 'Procedures per student', 'How many of each procedure, in each role, signed, and with a follow-up.'],
  ['hospitals', 'Procedures per hospital', 'The same, per hospital. Never has names in it.'],
  ['entries', 'Every case', 'A row per case, with every answer and the follow-up.'],
  ['codebook', 'Codebook', 'What each column and each code in the other files means.'],
];
const FILE_NAME = Object.fromEntries(FILES.map(([kind, title]) => [kind, title]));

// The Download data tab: the spreadsheets, in a card like those under More. (The backup is under More.)
function downloadView() {
  return h('section', { class: 'more-tab' }, h('h2', {}, 'Download data'), downloadsCard());
}

function downloadsCard() {
  const anonymous = ad.people === 'anonymous';
  const fileRow = ([kind, title, about]) => {
    const anon = anonymous && kind !== 'hospitals' && kind !== 'codebook'; // the hospital file and the codebook have no people in them
    return h('div', { class: 'fact' },
      h('span', { class: 'fact-text' }, h('strong', {}, title), h('span', {}, about)),
      h('button', {
        class: 'change', type: 'button', 'aria-label': `Download ${title}`,
        onclick: () => downloadFile(title, (t) => api.adminExport(t, kind, ad.delim, anon), `logbook-${kind}${anon ? '-anonymous' : ''}-${today()}.csv`),
      }, 'Download'));
  };
  return h('div', { class: 'card downloads' }, h('h3', {}, 'Spreadsheets'),
    h('p', { class: 'muted small card-note' }, 'Files to open in Excel or another spreadsheet program.'),
    h('p', { class: 'dl-label' }, 'People in the files'),
    switcher('people', [['anonymous', 'Anonymous'], ['names', 'With names']], 'People in the files'),
    h('p', { class: 'dl-label' }, 'File format'),
    switcher('delim', [[';', 'Excel'], [',', 'Other programs']], 'File format', (v) => { try { localStorage.setItem(DELIM_KEY, v); } catch { /* the choice is just not remembered */ } }),    h('div', { class: 'facts plain dl-files' }, FILES.map(fileRow)));
}

const AUDIT_TEXT = {
  // detail: the kind of file, with " (anonymous)" after it for a file with codes instead of names
  export: (e) => {
    const [kind, anon] = String(e.detail || '').split(' ');
    return `downloaded the ${anon ? 'anonymous ' : ''}"${FILE_NAME[kind] || kind}" spreadsheet`;
  },
  backup: () => 'downloaded a backup',
  mark_restored: () => 'marked the database as restored from a backup',
  create: (e) => `created the ${e.detail} account ${e.target}`,
  reset_password: (e) => `reset the password of ${e.target}`,
  disable: (e) => `disabled ${e.target}`,
  enable: (e) => `enabled ${e.target}`,
  revoke_sessions: (e) => `logged ${e.target} out everywhere`,
  delete: (e) => `deleted ${e.target} and its data for good`,
  rename: (e) => `changed the name of ${e.target}`,
  assign: (e) => `added ${e.target} to the students of ${e.detail}`,
  unassign: (e) => `removed ${e.target} from the students of ${e.detail}`,
  set_targets: (e) => `changed ${e.detail === '1' ? 'a target' : `${e.detail} targets`} for ${e.target}`,
};

function auditList() {
  if (!ad.audit || !ad.audit.length) return h('p', { class: 'muted' }, 'Nothing yet.');
  return h('ul', { class: 'list tight' }, ad.audit.map((e) => h('li', { class: 'audit' },
    h('span', {}, h('strong', {}, e.actor), ' ', (AUDIT_TEXT[e.action] || ((x) => `${x.action} ${x.target || ''}`))(e)),
    h('span', { class: 'muted small' }, timeAgo(e.at)))));
}

// ---- one student ---------------------------------------------------------------------------
// A page, like a supervisor's page of one student: the arrow back, the candidate number with the name, and Account
// (the same pop-up as under Users); the numbers; then two tabs: Cases (a short row each under the heading of its
// week, like the student's History; tapping one opens the whole case, only to read) and Progress (as on the
// student's Progress).

const nameOf = (id) => ((ad.users || []).find((u) => u.id === id) || {}).name || null;

function openStudent(candidate) {
  closeSheet();
  setPageScroll(0);
  ad.detailTab = 'cases';
  loadDetail(candidate);
}

// quiet: fetch again in the background; the page on show stays until the answer comes.
async function loadDetail(candidate, { quiet = false } = {}) {
  const old = quiet && ad.detail && ad.detail.candidate === candidate && !ad.detail.error ? ad.detail : null;
  const d = { candidate, events: [], entries: [], loading: true, error: '' };
  if (!old) {
    ad.detail = d;
    draw();
  }
  try {
    let cursor = 0;
    for (let page = 0; page < 100; page++) {
      const at = cursor;
      const r = await call((t) => api.adminEntries(t, candidate, at));
      if (r === ENDED) return;
      d.events.push(...r.events);
      cursor = r.cursor;
      if (!r.has_more) break;
    }
    d.entries = core.derive(d.events);
  } catch (e) { d.error = e.message; }
  d.loading = false;
  if (old) {
    if (ad.detail !== old || d.error) return; // moved on meanwhile, or no answer: keep what is on show
    ad.detail = d;
    draw();
  } else if (ad.detail === d) draw();
}

function detailView() {
  const d = ad.detail;
  const back = h('button', {
    class: 'back-btn', type: 'button', 'aria-label': ad.tab === 'users' ? 'Back to users' : 'Back to the overview',
    onclick: () => { ad.detail = null; setPageScroll(0); draw(); if (!ad.loading) loadAll({ quiet: true }); },
  });
  const name = nameOf(d.candidate);
  const head = h('div', { class: 'detail-head' }, back,
    h('div', { class: 'detail-title' }, h('h2', {}, d.candidate), name ? h('p', { class: 'muted detail-name' }, name) : null),
    ad.users?.some((u) => u.id === d.candidate) ? h('button', { class: 'btn ghost', type: 'button', onclick: () => openUser(d.candidate) }, 'Account') : null);
  if (d.loading) return h('section', {}, head, h('p', { class: 'muted' }, 'Loading cases…'));
  if (d.error) return h('section', {}, head, h('div', { class: 'card' }, h('p', { class: 'error' }, d.error), h('button', { class: 'btn', onclick: () => loadDetail(d.candidate) }, 'Try again')));

  const signed = d.entries.filter((e) => e.sign).length;
  const none = h('p', { class: 'muted' }, 'This student has not logged anything yet.');
  const pages = {
    cases: () => (d.entries.length
      ? core.byWeek(d.entries).map((w) => [
        h('h3', { class: 'day-head' }, core.fmtWeek(w.week)),
        h('ul', { class: 'list' }, w.entries.map((e) => caseRow(e, {
          tags: e.sign ? h('span', { class: 'tag ok' }, 'Signed') : h('span', { class: 'tag warn' }, 'Not signed'),
        })))])
      : none),
    progress: () => procedureProgress(d.entries, d.events, { note: 'Set by a supervisor.', none: 'No targets yet. A supervisor sets them.' }),
  };
  return h('section', { class: 'sv-detail' },
    head,
    h('div', { class: 'stats' }, stat(d.entries.length, 'cases'), stat(signed, 'signed'), stat(d.entries.length - signed, 'to sign')),
    switcher('detailTab', [['cases', 'Cases'], ['progress', 'Progress']], 'What to show'),
    (pages[ad.detailTab] || pages.cases)());
}

// ---- Users ---------------------------------------------------------------------------------

// "Show": which kind of account, chosen like the filters in a student's History (filterButton and openFilterSheet in ui.js).
const SHOW = [['all', 'Everyone'], ['student', 'Students'], ['supervisor', 'Supervisors'], ['admin', 'Administrators']];
const searched = () => {
  const q = ad.query.trim().toUpperCase();
  return (ad.users || []).filter((u) => !q || u.id.includes(q) || (u.name || '').toUpperCase().includes(q));
};

// One big row per kind of account, with how many there are; the counts take the search into account.
function openShowFilter() {
  const base = searched();
  openFilterSheet('Show only', SHOW.map(([id, label]) => ({
    label, n: id === 'all' ? base.length : base.filter((u) => u.role === id).length, on: ad.filter === id,
    pick: () => { ad.filter = id; draw(); },
  })));
}

function usersView() {
  const input = h('input', { type: 'search', class: 'search', placeholder: 'Search id or name', value: ad.query, autocomplete: 'off' });
  const show = SHOW.find(([id]) => id === ad.filter) || SHOW[0];
  const list = h('div', {});
  // a small grey heading per kind of account, like the week headings in a student's History; in the order the server
  // sends them (administrators, supervisors, students)
  const HEAD = { admin: 'Administrators', supervisor: 'Supervisors', student: 'Students' };
  const groups = (rows) => Object.keys(HEAD).map((role) => rows.filter((u) => u.role === role)).filter((g) => g.length)
    .map((g) => [h('h3', { class: 'day-head' }, HEAD[g[0].role]), h('ul', { class: 'list' }, g.map(userRow))]);
  // while one kind is chosen, as in History: "Showing N of M" and "Show all" (back to Everyone; the search stays)
  const count = h('span', {});
  const shown = ad.filter === 'all' ? null : h('div', { class: 'shown' }, count,
    h('button', { class: 'change', type: 'button', onclick: () => { ad.filter = 'all'; draw(); } }, 'Show all'));
  const drawList = () => {
    ad.query = input.value;
    const all = searched();
    const rows = all.filter((u) => ad.filter === 'all' || u.role === ad.filter);
    count.textContent = `Showing ${rows.length} of ${all.length}`;
    list.replaceChildren(...(rows.length ? groups(rows).flat() : [h('p', { class: 'muted' }, ad.users ? 'No accounts match.' : 'Loading…')]));
  };
  input.addEventListener('input', drawList);
  drawList();
  // the heading with "Add users" on the right, like "Account" on a student's page; it opens the page to add users
  const head = h('div', { class: 'detail-head' },
    h('div', { class: 'detail-title' }, h('h2', {}, 'Manage users')),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { ad.adding = true; setPageScroll(0); draw(); } }, 'Add users'));
  return h('section', {}, head, input,
    h('div', { class: 'filters one' }, filterButton('Show', show[1], ad.filter !== 'all', openShowFilter)),
    shown, list);
}

function userRow(u) {
  const meta = [ROLE_NAME[u.role], `last login ${u.last_login_at ? timeAgo(u.last_login_at) : 'never'}`, u.role === 'student' ? cases(u.entries) : null].filter(Boolean).join(' · ');
  // laid out like the rows on Overview and a supervisor's My students: the id, the name under it, then a grey line
  return h('li', {},
    h('button', { class: 'srow', onclick: () => openUser(u.id) },
      h('span', { class: 'srow-main' },
        h('strong', {}, u.id),
        u.name ? h('span', { class: 'small' }, u.name) : null,
        h('span', { class: 'muted small' }, meta)),
      u.disabled ? h('span', { class: 'tag warn' }, 'Disabled') : (!u.password_set ? h('span', { class: 'tag' }, 'First login waiting') : null)));
}

// Do something to an account, say so, and show the account again with fresh data.
async function act(id, fn, done, { reopen = true } = {}) {
  try {
    const r = await call(fn);
    if (r === ENDED) return undefined;
    toast(done);
    await loadAll({ quiet: true });
    if (reopen) openUser(id);
    return r;
  } catch (e) {
    toast('Could not do that', { sub: e.message });
    return undefined;
  }
}

// One account in a pop-up, laid out like the case pop-up and the pop-up for a new case: a heading that stays at the
// top (the id, the kind of account and the name, a tag on the right like in the list), grey boxes with a row per
// fact and a round button on the right for what can be done to it (like the hospital and date when logging), the
// people who are linked to it as rows in a grey box, and Close at the bottom. Erasing is a quiet red link at the
// bottom, like "Delete this case", and only for a disabled account: two separate steps, so nobody deletes by accident.
function openUser(id) {
  const u = (ad.users || []).find((x) => x.id === id);
  if (!u) { closeSheet(); return; }
  const me = u.id === ctx.session.candidate;
  const pill = (label, onclick, aria = null) => h('button', { class: 'change', type: 'button', onclick, 'aria-label': aria }, label);
  // a person: the main line, a grey line under it, and Remove on the right
  const person = (main, sub, onRemove) => h('div', { class: 'fact' },
    h('span', { class: 'fact-text' }, h('strong', {}, main), sub ? h('span', {}, sub) : null),
    pill('Remove', onRemove, `Remove ${main}`));
  const group = (title, note, rows, empty) => [
    h('h4', { class: 'acct-title' }, title),
    h('p', { class: 'muted small acct-note' }, note),
    rows.length ? h('div', { class: 'facts' }, rows) : h('p', { class: 'muted acct-empty' }, empty),
  ];

  const account = h('div', { class: 'facts' },
    fact('Name', u.name || 'Not set', pill(u.name ? 'Change' : 'Add', () => openRename(u), u.name ? 'Change name' : 'Add a name')),
    fact('Password', u.password_set ? 'Chosen by them' : 'The initial one, not changed yet', me ? null : pill('New password', () => confirmReset(u))),
    fact('Last login', u.last_login_at ? timeAgo(u.last_login_at) : 'Never',
      pill('Log out everywhere', () => act(u.id, (t) => api.adminRevoke(t, u.id), 'Logged out everywhere'))),
    fact('Status', u.disabled ? 'Disabled, cannot log in' : 'Active', me ? null : pill(u.disabled ? 'Enable' : 'Disable', () => confirmDisable(u))),
    // the student's page (from that page itself: just back to it)
    u.role === 'student'
      ? fact('Cases', String(u.entries), pill('See', () => (ad.detail?.candidate === u.id ? closeSheet() : openStudent(u.id)), 'See cases'))
      : null);

  let people = null;
  if (u.role === 'student') {
    const free = ad.users.filter((x) => x.role === 'supervisor' && !x.disabled && !u.supervisors.some((s) => s.id === x.id));
    people = [
      group('Supervisors', 'They can see this student\'s cases and sign them.',
        // a supervisor by name, like on the student's More; the id in grey under it
        u.supervisors.map((s) => person(s.name, s.name !== s.id ? s.id : null, () => act(u.id, (t) => api.adminUnassign(t, s.id, u.id), 'Removed'))),
        'None yet.'),
      free.length ? h('button', { class: 'btn ghost wide', type: 'button', onclick: () => openAddSupervisor(u, free) }, 'Add a supervisor') : null,
    ];
  }
  if (u.role === 'supervisor') {
    // a student by candidate number, like everywhere else; the name in grey under it
    people = group('Students', 'This supervisor can see their cases and sign them.',
      u.students.map((sid) => person(sid, nameOf(sid), () => act(u.id, (t) => api.adminUnassign(t, u.id, sid), 'Removed'))),
      'None yet. A supervisor adds students in the app, or you add a supervisor to a student here.');
  }

  const tag = u.disabled ? h('span', { class: 'tag warn' }, 'Disabled') : !u.password_set ? h('span', { class: 'tag' }, 'First login waiting') : null;
  openSheet([
    h('div', { class: 'sheet-head' },
      h('div', { class: 'case-top' },
        h('div', { class: 'case-top-text' },
          h('h3', { class: 'case-title' }, u.id),
          h('p', { class: 'case-sub' }, [ROLE_NAME[u.role], u.name].filter(Boolean).join(' · '))),
        tag ? h('div', { class: 'e-tags' }, tag) : null)),
    h('div', { class: 'acct' },
      me ? h('p', { class: 'note-info' }, 'This is your own account. Change your password under More. Another administrator is needed to reset or disable it.') : null,
      account,
      people,
      u.disabled && !me
        ? h('div', { class: 'case-del-row' }, h('button', { class: 'link danger', type: 'button', onclick: () => confirmDelete(u) }, 'Delete account and data for good'))
        : null),
    h('div', { class: 'sheet-foot' }, h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Close')),
  ]);
}

// Choose a supervisor for a student: a big row each, like the filters in History; one tap adds them.
function openAddSupervisor(u, free) {
  openSheet([
    h('h3', {}, 'Add a supervisor'),
    h('p', { class: 'muted' }, `They can see the cases of ${u.id} and sign them.`),
    h('div', { class: 'plist' }, free.map((x) => h('button', {
      class: 'row-btn opt', type: 'button', onclick: () => act(u.id, (t) => api.adminAssign(t, x.id, u.id), 'Added'),
    }, h('span', {}, x.name || x.id), x.name ? h('span', { class: 'muted small' }, x.id) : null))),
    h('button', { class: 'btn ghost wide', type: 'button', onclick: () => openUser(u.id) }, 'Cancel'),
  ], { tall: free.length > 6 });
}

function confirmDelete(u) {
  const what = u.role === 'student'
    ? `Everything about ${u.id} is erased from the server: the account, all ${u.entries} entries and the signatures on them.`
    : `The account ${u.id} is erased from the server. Signatures this person made stay in the students' logbooks, with the name.`;
  openSheet([
    h('h3', {}, `Delete ${u.id} for good?`),
    h('p', {}, what),
    h('p', { class: 'note' }, 'This cannot be undone. Use it when a person asks for their data to be deleted, or has left and their data is no longer needed. Backups taken earlier still contain the data.'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: () => act(u.id, (t) => api.adminDelete(t, u.id), `${u.id} deleted`, { reopen: false }).then((r) => {
          closeSheet();
          if (r && ad.detail?.candidate === u.id) { ad.detail = null; draw(); } // the page of the account that is gone
        }),
      }, 'Delete for good'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openUser(u.id) }, 'Cancel')),
  ]);
}

// The name in a pop-up of its own, like the other pop-ups with something to save: Cancel and Save at the bottom
// (Save the bigger one); Cancel goes back to the account.
function openRename(u) {
  const input = h('input', {
    type: 'text', id: 'rename', value: u.name || '', autocomplete: 'off', maxlength: '60', 'aria-label': `Name for ${u.id}`,
    placeholder: u.role === 'supervisor' ? 'e.g. Dr Anna Kamara' : 'e.g. Mohamed Kamara',
  });
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const who = { student: 'The student, their supervisors and administrators see it.', supervisor: 'Students see it next to a signature.', admin: 'It is shown at the top of their own screen.' };
  const save = async () => {
    try {
      const r = await call((t) => api.adminRename(t, u.id, input.value));
      if (r === ENDED) return;
      toast('Name saved');
      await loadAll({ quiet: true });
      openUser(u.id);
    } catch (e) { err.textContent = e.message; }
  };
  input.addEventListener('input', () => { err.textContent = ''; });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
  openSheet([
    h('h3', {}, u.name ? 'Change name' : 'Add a name'),
    h('p', { class: 'muted' }, `For ${u.id}. ${who[u.role] || ''}`),
    input, err,
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openUser(u.id) }, 'Cancel'),
      h('button', { class: 'btn save', type: 'button', onclick: save }, 'Save')),
  ]);
}

function confirmReset(u) {
  openSheet([
    h('h3', {}, `New password for ${u.id}?`),
    h('p', {}, 'They are logged out on all devices and must choose their own password at the next login. You will see the new initial password once.'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          try {
            const r = await call((t) => api.adminReset(t, u.id));
            if (r === ENDED) return;
            await loadAll({ quiet: true });
            showPasswords('New initial password', [{ id: r.id, name: u.name, password: r.password }]);
          } catch (e) { toast('Could not reset', { sub: e.message }); closeSheet(); }
        },
      }, 'Reset password'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openUser(u.id) }, 'Cancel')),
  ]);
}

function confirmDisable(u) {
  if (u.disabled) { act(u.id, (t) => api.adminSetDisabled(t, u.id, false), 'Enabled'); return; }
  openSheet([
    h('h3', {}, `Disable ${u.id}?`),
    h('p', {}, 'They are logged out and cannot log in. Their entries and signatures stay. You can enable the account again.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', type: 'button', onclick: () => act(u.id, (t) => api.adminSetDisabled(t, u.id, true), 'Disabled') }, 'Disable'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openUser(u.id) }, 'Cancel')),
  ]);
}

// The only time an initial password is visible. It cannot be looked up afterwards.
function showPasswords(title, rows, skipped = []) {
  const text = ['account,name,initial_password', ...rows.map((r) => `${r.id},${r.name || ''},${r.password}`)].join('\n');
  // a row per person in a grey box, like the people in an account's pop-up: the id, the name in grey under it, and the
  // password on the right; Done and Copy all at the bottom, like Cancel and Save
  openSheet([
    h('h3', {}, title),
    h('p', { class: 'note' }, 'Write these down or copy them now. They are not stored and cannot be shown again. Hand each one to the person through CapaCare, one at a time, not in a group chat.'),
    rows.length
      ? h('div', { class: 'facts pw-list' }, rows.map((r) => h('div', { class: 'fact pw-row' },
        h('span', { class: 'fact-text' }, h('strong', {}, r.id), r.name ? h('span', {}, r.name) : null),
        h('span', { class: 'mono pw', 'aria-label': `Initial password for ${r.id}` }, r.password))))
      : null,
    skipped.length ? h('p', { class: 'muted small' }, `Not created: ${skipped.map((x) => `${x.id} (${x.reason})`).join(', ')}`) : null,
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Done'),
      rows.length ? h('button', {
        class: 'btn save', type: 'button',
        onclick: async () => {
          try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy', { sub: 'Write the passwords down instead.' }); }
        },
      }, 'Copy all') : null),
  ]);
}

// ---- Add users ---------------------------------------------------------------------------------

// A page of Manage users, opened with its "Add users" button, laid out like a student's page: a round arrow back to the
// list, the heading; then the kind of account in the same switch as Overview and Surgery/Delivery, and under it a white
// card like those under More: a heading, a grey line, then the fields, each with its label and a grey hint under it,
// and the button. After creating, the page stays open, to add more.
function addView() {
  const role = ad.addRole;
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const label = (forId, text, hint = null) => [h('label', { for: forId }, text), hint ? h('p', { class: 'muted small field-hint' }, hint) : null];
  let form;

  if (role === 'student') {
    const ids = h('textarea', { id: 'ids', rows: '6', placeholder: 'CC1234 Mohamed Kamara\nCC1235 Fatmata Bangura\nCC1236', value: ad.draft.ids, autocapitalize: 'characters', spellcheck: 'false' });
    ids.addEventListener('input', () => { ad.draft.ids = ids.value; err.textContent = ''; });
    form = h('form', { class: 'setup-form' },
      label('ids', 'Candidate numbers and names', 'One student per line: the candidate number, then the name. The name can be left out and added later. Paste a whole list if you have one.'),
      ids, err, h('button', { class: 'btn wide', type: 'submit' }, 'Create accounts'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const list = parseStudents(ids.value);
      if (!list.length) { err.textContent = 'Type at least one candidate number.'; return; }
      await create(err, async () => {
        const created = [];
        const skipped = [];
        for (let i = 0; i < list.length; i += 100) {
          const chunk = list.slice(i, i + 100);
          const r = await call((t) => api.adminCreateMany(t, chunk));
          if (r === ENDED) return null;
          const names = new Map(chunk.map((p) => [core.normCandidate(p.id), p.name || '']));
          created.push(...r.created.map((x) => ({ ...x, name: names.get(x.id) || '' })));
          skipped.push(...r.skipped);
        }
        ad.draft.ids = '';
        return { title: `${created.length} account${created.length === 1 ? '' : 's'} created`, rows: created, skipped };
      });
    });
  } else {
    const id = h('input', { id: 'newid', type: 'text', placeholder: role === 'admin' ? 'e.g. ADMIN-ANNA' : 'e.g. SUP-ANNA', value: ad.draft.id, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    const name = h('input', { id: 'newname', type: 'text', placeholder: role === 'admin' ? 'e.g. Fatmata Bangura' : 'e.g. Dr Anna Kamara', value: ad.draft.name, autocomplete: 'off' });
    [id, name].forEach((i) => i.addEventListener('input', () => { ad.draft.id = id.value; ad.draft.name = name.value; err.textContent = ''; }));
    form = h('form', { class: 'setup-form' },
      label('newid', 'Candidate number', `What they log in with. For example ${role === 'admin' ? 'ADMIN-' : 'SUP-'} and a short name.`), id,
      // only supervisors sign; an administrator's name is only shown at the top of their own screen
      label('newname', 'Name', role === 'admin' ? 'Shown at the top of their own screen.' : 'Students see it next to a signature.'), name,
      err, h('button', { class: 'btn wide', type: 'submit' }, 'Create account'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const clean = core.normCandidate(id.value);
      if (!core.validCandidate(clean)) { err.textContent = 'The id must be 2 to 20 letters, numbers, / _ or -.'; id.focus(); return; }
      await create(err, async () => {
        const r = await call((t) => api.adminCreate(t, role, clean, name.value));
        if (r === ENDED) return null;
        ad.draft.id = '';
        ad.draft.name = '';
        return { title: `${ROLE_NAME[role]} account created`, rows: [{ id: r.id, name: name.value.trim(), password: r.password }], skipped: [] };
      });
    });
  }

  const title = { student: 'New students', supervisor: 'New supervisor', admin: 'New administrator' }[role];
  const back = h('button', {
    class: 'back-btn', type: 'button', 'aria-label': 'Back to the list of users',
    onclick: () => { ad.adding = false; setPageScroll(0); draw(); if (!ad.loading) loadAll({ quiet: true }); },
  });
  return h('section', { class: 'add-tab' },
    h('div', { class: 'detail-head' }, back, h('div', { class: 'detail-title' }, h('h2', {}, 'Add users'))),
    switcher('addRole', [['student', 'Students'], ['supervisor', 'Supervisor'], ['admin', 'Administrator']], 'Kind of account'),
    h('div', { class: 'card' },
      h('h3', {}, title),
      h('p', { class: 'muted small card-note' }, `Each new account gets an initial password that works once. ${role === 'student' ? 'Each student' : 'They'} choose${role === 'student' ? 's' : ''} their own at the first login.`),
      form));
}

// "CC1234 Mohamed Kamara" per line. A line with only candidate numbers (each has a digit) is several students.
export function parseStudents(text) {
  const people = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[\s,;]+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => /\d/.test(p))) { parts.forEach((id) => people.push({ id })); continue; }
    const m = /^([^\s,;]+)[\s,;]+(.+)$/.exec(t);
    people.push(m ? { id: m[1], name: m[2].trim().replace(/\s+/g, ' ') } : { id: t });
  }
  return people;
}

async function create(err, run) {
  err.textContent = '';
  try {
    const res = await run();
    if (!res) return;
    await loadAll({ quiet: true });
    showPasswords(res.title, res.rows, res.skipped);
  } catch (e) { err.textContent = e.message; }
}

// ---- More ------------------------------------------------------------------------------------------

// Laid out like the student's More (fact, advancedCard in ui.js).
function moreView() {
  return h('section', { class: 'more-tab' },
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Account'),
      h('div', { class: 'facts plain' },
        fact('Candidate number', ctx.session.candidate),
        fact('Name', ctx.session.name || ctx.session.candidate)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: ctx.openChangePassword }, 'Change password'),
        h('button', { class: 'btn ghost', onclick: confirmLogout }, 'Log out'))),
    backupCard(),
    // Recent changes (who changed which account, and every download) under About: rarely needed, and long
    advancedCard([
      ['About', [fact('Version', ctx.version), fact('Server', api.serverLabel()), privacyFact('admin')]],
      ['Recent changes', auditList()],
    ], 'About and recent changes'));
}

function backupCard() {
  const last = ad.stats && ad.stats.last_backup;
  return h('div', { class: 'card' }, h('h3', {}, 'Backup'),
    h('p', { class: 'muted' }, 'A complete copy of all data, in one file. If the server disk is ever lost, this file is the only way to get the data back. Keep it somewhere safe.'),
    h('div', { class: 'facts plain' }, fact('Last backup', last ? timeAgo(last) : 'never')),
    h('button', {
      class: 'btn wide', type: 'button',
      onclick: () => downloadFile('Backup', (t) => api.adminBackup(t), `logbook-backup-${today()}.db`),
    }, 'Download backup'),
    h('p', { class: 'muted small' }, 'The file contains all names, entries and the scrambled passwords of every account. Treat it with care.'));
}

function confirmLogout() {
  openSheet([
    h('h3', {}, 'Log out?'),
    h('p', {}, 'You will need your candidate number and password to log in again.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', type: 'button', onclick: ctx.onLogout }, 'Log out'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel')),
  ]);
}
