// administrator.js — the screens an administrator sees: an overview of all procedures, the list of
// users with the things you do to an account, a form to add users, and a log of recent changes.
// Plain JavaScript, no build step. Needs internet; nothing is stored on the tablet.
// app.js decides when to show this (the logged-in account has the role "admin").

import { PROCEDURES_TOP, procName, roleLabel } from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, kv, toast, openSheet, closeSheet, saveBlob,
} from './ui.js';

const ENDED = Symbol('session ended'); // the server ended the session; app.js shows the login screen
const DELIM_KEY = 'logbook.csvDelimiter';
const getDelim = () => { try { return localStorage.getItem(DELIM_KEY) === ',' ? ',' : ';'; } catch { return ';'; } };
const ROLE_NAME = { student: 'Student', supervisor: 'Supervisor', admin: 'Administrator' };

// Everything this screen remembers while it is open. Replaced on every new login.
const ad = {
  token: null, tab: 'overview', users: null, stats: null, audit: null,
  loading: false, error: '', query: '', filter: 'all', addRole: 'student', draft: { ids: '', id: '', name: '' },
};
let ctx = null; // { root, session, version, onAuthError, onLogout, openChangePassword }

export function mountAdministrator(c) {
  ctx = c;
  if (ad.token !== c.session.token) {
    Object.assign(ad, {
      token: c.session.token, tab: 'overview', users: null, stats: null, audit: null,
      loading: false, error: '', query: '', filter: 'all', addRole: 'student', draft: { ids: '', id: '', name: '' },
    });
  }
  paint();
  if (ad.users === null && !ad.loading) loadAll();
}

// ---- drawing -----------------------------------------------------------------

// Redraw only if the administrator screen is on show: a slow reply must not paint over the login screen.
function draw() {
  if (ctx && ctx.root.querySelector('[data-admin]')) paint();
}

function paint() {
  const y = window.scrollY || 0;
  ctx.root.replaceChildren(h('div', { 'data-admin': '' }, h('div', { class: 'sticky-top' }, header(), nav()), h('div', { class: 'banner' }, `Prototype v${ctx.version} · administrator`), h('main', { class: 'main' }, body())));
  if (y) window.scrollTo(0, y);
}

function header() {
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('strong', {}, 'CapaCare logbook'),
      h('span', { class: 'who' }, `Administrator · ${ctx.session.name || ctx.session.candidate}`)),
    h('button', { class: 'chip ok', onclick: () => loadAll(), 'aria-label': 'Refresh from the server' }, ad.loading ? 'Loading…' : 'Refresh'));
}

function nav() {
  const tabs = [['overview', 'Overview'], ['users', 'Users'], ['add', 'Add users'], ['more', 'More']];
  return h('nav', { class: 'nav' }, tabs.map(([id, label]) =>
    h('button', { class: 'tab' + (ad.tab === id ? ' on' : ''), onclick: () => { ad.tab = id; window.scrollTo(0, 0); draw(); } }, label)));
}

function body() {
  if (ad.error) return h('div', { class: 'card' }, h('p', { class: 'error' }, ad.error), h('button', { class: 'btn', onclick: () => loadAll() }, 'Try again'));
  if (ad.tab === 'users') return usersView();
  if (ad.tab === 'add') return addView();
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

const table = (head, rows, cls = '') => h('div', { class: 'scroll' },
  h('table', { class: `tbl ${cls}` }, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows)));

function overviewView() {
  const s = ad.stats;
  if (!s) return h('section', {}, h('h2', {}, 'Overview'), h('p', { class: 'muted' }, 'Loading…'));
  const t = s.totals;
  const top = new Set(PROCEDURES_TOP.map((p) => p.id));

  const procRows = s.procedures.map((p) => h('tr', {},
    h('td', {}, procName(p.procedure)), h('td', {}, p.performed), h('td', {}, p.assisting), h('td', {}, p.observing), h('td', {}, h('strong', {}, p.total)), h('td', {}, p.students)));

  const cell = (c) => (c && c.total ? `${c.performed}/${c.total}` : '·');
  const studentRows = s.students.map((st) => {
    let otherPerformed = 0;
    let otherTotal = 0;
    for (const [id, c] of Object.entries(st.by_procedure)) if (!top.has(id)) { otherPerformed += c.performed; otherTotal += c.total; }
    return h('tr', { class: st.disabled ? 'dim' : '', onclick: () => openEntries(st.candidate) },
      h('td', {}, st.candidate, st.disabled ? h('span', { class: 'tag' }, 'disabled') : null, st.name ? h('span', { class: 'muted small block' }, st.name) : null),
      h('td', {}, st.entries), h('td', {}, st.performed), h('td', {}, st.signed),
      PROCEDURES_TOP.map((p) => h('td', {}, cell(st.by_procedure[p.id]))),
      h('td', {}, cell({ performed: otherPerformed, total: otherTotal })));
  });

  return h('section', {},
    h('h2', {}, 'Overview'),
    backupReminder(s),
    h('div', { class: 'stats four' }, stat(t.students, 'students'), stat(t.supervisors, 'supervisors'), stat(t.entries, 'procedures'), stat(t.unsigned, 'to sign')),
    h('div', { class: 'card' }, h('h3', {}, 'Procedures, all students'),
      s.procedures.length
        ? table(['Procedure', 'Performed', 'Assisted', 'Observed', 'Total', 'Students'], procRows)
        : h('p', { class: 'muted' }, 'Nothing has been logged yet.'),
      h('p', { class: 'muted small' }, 'Performed = surgeon, supervised or independent.')),
    h('div', { class: 'card' }, h('h3', {}, 'Each student'),
      s.students.length
        ? table(['Student', 'Logged', 'Performed', 'Signed', ...PROCEDURES_TOP.map((p) => p.name), 'Other'], studentRows, 'matrix')
        : h('p', { class: 'muted' }, 'No students yet. Add them under "Add users".'),
      h('p', { class: 'muted small' }, 'Each procedure column shows performed / logged. Tap a student to see the entries.')),
    h('div', { class: 'card' }, h('h3', {}, 'Hospitals'),
      s.hospitals.length
        ? table(['Hospital', 'Logged', 'Performed', 'Students'], s.hospitals.map((x) => h('tr', {}, h('td', {}, x.hospital), h('td', {}, x.entries), h('td', {}, x.performed), h('td', {}, x.students))))
        : h('p', { class: 'muted' }, 'Nothing has been logged yet.'),
      h('p', { class: 'muted small' }, 'The hospital is stored with every entry, as chosen by the student when logging.')),
    downloadsCard(),
    h('div', { class: 'card' }, h('h3', {}, 'Recent changes'), auditList()));
}

// ---- downloads ---------------------------------------------------------------------------------

function backupReminder(s) {
  const days = s.last_backup ? (Date.now() - Date.parse(s.last_backup)) / 86400000 : Infinity;
  if (days <= 7 || s.totals.entries === 0) return null;
  return h('div', { class: 'note' }, s.last_backup ? `The last backup was ${Math.floor(days)} days ago. ` : 'No backup has been downloaded yet. ',
    h('button', { class: 'link', type: 'button', onclick: () => { ad.tab = 'more'; draw(); } }, 'Go to the backup'));
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

function downloadsCard() {
  const delim = h('select', { 'aria-label': 'File format' },
    [[';', 'Excel in Norway and most of Europe (semicolon)'], [',', 'Other programs (comma)']].map(([v, label]) => h('option', { value: v, selected: v === getDelim() }, label)));
  delim.addEventListener('change', () => { try { localStorage.setItem(DELIM_KEY, delim.value); } catch { /* the choice is just not remembered */ } });
  const one = (kind, label) => h('button', {
    class: 'btn ghost wide', type: 'button',
    onclick: () => downloadFile(label, (t) => api.adminExport(t, kind, delim.value), `logbook-${kind}-${today()}.csv`),
  }, label);
  return h('div', { class: 'card' }, h('h3', {}, 'Download as a spreadsheet (CSV)'),
    h('label', { class: 'small muted' }, 'File format'), delim,
    h('p', { class: 'muted small' }, 'If Excel puts everything in one column, choose the other format.'),
    one('procedures', 'Procedures per student'),
    one('hospitals', 'Procedures per hospital'),
    one('entries', 'Every entry, one row each'),
    h('p', { class: 'muted small' }, 'The files contain candidate numbers and names. Keep them safe and do not share them in group chats.'));
}

const AUDIT_TEXT = {
  export: (e) => `downloaded the ${e.detail} spreadsheet`,
  backup: () => 'downloaded a backup',
  create: (e) => `created the ${e.detail} account ${e.target}`,
  reset_password: (e) => `reset the password of ${e.target}`,
  disable: (e) => `disabled ${e.target}`,
  enable: (e) => `enabled ${e.target}`,
  revoke_sessions: (e) => `logged ${e.target} out everywhere`,
  rename: (e) => `changed the name of ${e.target}`,
  assign: (e) => `added ${e.target} to the students of ${e.detail}`,
  unassign: (e) => `removed ${e.target} from the students of ${e.detail}`,
};

function auditList() {
  if (!ad.audit || !ad.audit.length) return h('p', { class: 'muted' }, 'Nothing yet.');
  return h('ul', { class: 'list tight' }, ad.audit.map((e) => h('li', { class: 'audit' },
    h('span', {}, h('strong', {}, e.actor), ' ', (AUDIT_TEXT[e.action] || ((x) => `${x.action} ${x.target || ''}`))(e)),
    h('span', { class: 'muted small' }, timeAgo(e.at)))));
}

// All entries of one student, newest first.
const nameOf = (id) => ((ad.users || []).find((u) => u.id === id) || {}).name || null;

async function openEntries(candidate) {
  openSheet([h('h3', {}, candidate), h('p', { class: 'muted' }, 'Loading…')]);
  try {
    const events = [];
    let cursor = 0;
    for (let page = 0; page < 100; page++) {
      const at = cursor;
      const r = await call((t) => api.adminEntries(t, candidate, at));
      if (r === ENDED) return;
      events.push(...r.events);
      cursor = r.cursor;
      if (!r.has_more) break;
    }
    const entries = core.derive(events);
    const shown = entries.slice(0, 200);
    const who = nameOf(candidate);
    openSheet([
      h('h3', {}, `${candidate} · ${entries.length} logged`),
      who ? h('p', { class: 'muted' }, who) : null,
      entries.length
        ? h('ul', { class: 'list tight' }, shown.map((e) => h('li', { class: 'entry' },
          h('div', { class: 'e-main' }, h('strong', {}, procName(e.procedure)), h('span', { class: `role-tag role-${e.role}` }, roleLabel(e.role))),
          h('div', { class: 'e-meta' }, h('span', {}, core.fmtDate(e.performed_on)), h('span', {}, e.hospital),
            e.sign ? h('span', { class: 'tag ok' }, `Signed · ${e.sign.supervisor_name || e.sign.supervisor}`) : h('span', { class: 'tag warn' }, 'Not signed')))))
        : h('p', { class: 'muted' }, 'Nothing logged yet.'),
      entries.length > shown.length ? h('p', { class: 'muted small' }, `Showing the newest ${shown.length}.`) : null,
      h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Close'),
    ]);
  } catch (e) {
    openSheet([h('h3', {}, candidate), h('p', { class: 'error' }, e.message), h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Close')]);
  }
}

// ---- Users ---------------------------------------------------------------------------------

function usersView() {
  const input = h('input', { type: 'search', class: 'search', placeholder: 'Search id or name', value: ad.query, autocomplete: 'off' });
  const filter = h('select', { 'aria-label': 'Show' }, [['all', 'Everyone'], ['student', 'Students'], ['supervisor', 'Supervisors'], ['admin', 'Administrators']]
    .map(([v, label]) => h('option', { value: v, selected: v === ad.filter }, label)));
  const list = h('ul', { class: 'list' });
  const drawList = () => {
    ad.query = input.value;
    ad.filter = filter.value;
    const q = input.value.trim().toUpperCase();
    const rows = (ad.users || []).filter((u) => (ad.filter === 'all' || u.role === ad.filter)
      && (!q || u.id.includes(q) || (u.name || '').toUpperCase().includes(q)));
    list.replaceChildren(...(rows.length ? rows.map(userRow) : [h('p', { class: 'muted' }, ad.users ? 'No accounts match.' : 'Loading…')]));
  };
  input.addEventListener('input', drawList);
  filter.addEventListener('change', drawList);
  drawList();
  return h('section', {}, h('h2', {}, 'Users'), input, filter, list);
}

function userRow(u) {
  const meta = [ROLE_NAME[u.role], `last login ${u.last_login_at ? timeAgo(u.last_login_at) : 'never'}`, u.role === 'student' ? `${u.entries} logged` : null].filter(Boolean).join(' · ');
  return h('li', {},
    h('button', { class: 'srow', onclick: () => openUser(u.id) },
      h('span', { class: 'srow-main' }, h('strong', {}, u.id, u.name ? ` · ${u.name}` : ''), h('span', { class: 'muted small' }, meta)),
      u.disabled ? h('span', { class: 'tag warn' }, 'disabled') : (!u.password_set ? h('span', { class: 'tag' }, 'first login waiting') : null)));
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

function openUser(id) {
  const u = (ad.users || []).find((x) => x.id === id);
  if (!u) { closeSheet(); return; }
  const me = u.id === ctx.session.candidate;
  const parts = [
    h('h3', {}, u.id),
    kv('Name', u.name || 'not set'),
    h('button', { class: 'link', type: 'button', onclick: () => openRename(u) }, u.name ? 'Change name' : 'Add a name'),
    kv('Role', ROLE_NAME[u.role]),
    kv('Status', u.disabled ? 'Disabled' : 'Active'),
    kv('Own password', u.password_set ? 'chosen' : 'not yet'),
    kv('Last login', u.last_login_at ? timeAgo(u.last_login_at) : 'never'),
  ];

  if (u.role === 'student') {
    parts.push(kv('Logged', u.entries));
    parts.push(h('h4', {}, 'Supervisors who can see this student'));
    if (!u.supervisors.length) parts.push(h('p', { class: 'muted small' }, 'None yet.'));
    for (const s of u.supervisors) {
      parts.push(h('div', { class: 'addrow' }, h('span', {}, h('strong', {}, s.id), s.name !== s.id ? ` · ${s.name}` : ''),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => act(u.id, (t) => api.adminUnassign(t, s.id, u.id), 'Removed') }, 'Remove')));
    }
    const free = ad.users.filter((x) => x.role === 'supervisor' && !x.disabled && !u.supervisors.some((s) => s.id === x.id));
    if (free.length) {
      const pick = h('select', { 'aria-label': 'Supervisor to add' }, free.map((x) => h('option', { value: x.id }, x.name ? `${x.id} · ${x.name}` : x.id)));
      parts.push(h('div', { class: 'addrow' }, pick,
        h('button', { class: 'btn small', type: 'button', onclick: () => act(u.id, (t) => api.adminAssign(t, pick.value, u.id), 'Added') }, 'Add')));
    }
    parts.push(h('button', { class: 'btn ghost wide', type: 'button', onclick: () => openEntries(u.id) }, 'See entries'));
  }

  if (u.role === 'supervisor') {
    parts.push(h('h4', {}, `Students (${u.students.length})`));
    if (!u.students.length) parts.push(h('p', { class: 'muted small' }, 'None yet.'));
    for (const sid of u.students) {
      parts.push(h('div', { class: 'addrow' }, h('strong', {}, sid),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => act(u.id, (t) => api.adminUnassign(t, u.id, sid), 'Removed') }, 'Remove')));
    }
  }

  if (me) {
    parts.push(h('p', { class: 'note-info' }, 'This is your own account. Use the More tab to change your password. Another administrator is needed to reset or disable it.'));
  } else {
    parts.push(h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => confirmReset(u) }, 'New password'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => confirmDisable(u) }, u.disabled ? 'Enable' : 'Disable')));
  }
  parts.push(h('div', { class: 'row' },
    h('button', { class: 'btn ghost', type: 'button', onclick: () => act(u.id, (t) => api.adminRevoke(t, u.id), 'Logged out everywhere') }, 'Log out everywhere'),
    h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Close')));
  openSheet(parts);
}

function openRename(u) {
  const input = h('input', { type: 'text', id: 'rename', value: u.name || '', autocomplete: 'off', maxlength: '60', placeholder: 'e.g. Mohamed Kamara' });
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const form = h('form', { class: 'setup-form' },
    h('label', { for: 'rename' }, `Name for ${u.id}`), input, err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'submit' }, 'Save'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openUser(u.id) }, 'Cancel')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await call((t) => api.adminRename(t, u.id, input.value));
      if (r === ENDED) return;
      toast('Name saved');
      await loadAll({ quiet: true });
      openUser(u.id);
    } catch (e) { err.textContent = e.message; }
  });
  openSheet([h('h3', {}, 'Name'), form]);
}

function confirmReset(u) {
  openSheet([
    h('h3', {}, `New password for ${u.id}?`),
    h('p', {}, 'They are logged out on all tablets and must choose their own password at the next login. You will see the new initial password once.'),
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
  openSheet([
    h('h3', {}, title),
    h('p', { class: 'note' }, 'Write these down or copy them now. They are not stored and cannot be shown again. Hand each one to the person through CapaCare, one at a time, not in a group chat.'),
    table(['Account', 'Name', 'Initial password'], rows.map((r) => h('tr', {}, h('td', {}, r.id), h('td', {}, r.name || ''), h('td', { class: 'mono' }, r.password))), 'pwtable'),
    skipped.length ? h('p', { class: 'muted small' }, `Not created: ${skipped.map((x) => `${x.id} (${x.reason})`).join(', ')}`) : null,
    h('div', { class: 'row' },
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy', { sub: 'Write the passwords down instead.' }); }
        },
      }, 'Copy all'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Done')),
  ]);
}

// ---- Add users ---------------------------------------------------------------------------------

function addView() {
  const role = ad.addRole;
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Kind of account' }, [['student', 'Students'], ['supervisor', 'Supervisor'], ['admin', 'Administrator']]
    .map(([v, label]) => h('button', { class: 'seg-b' + (role === v ? ' on' : ''), type: 'button', onclick: () => { ad.addRole = v; draw(); } }, label)));
  const err = h('p', { class: 'error', role: 'alert' }, '');
  let form;

  if (role === 'student') {
    const ids = h('textarea', { id: 'ids', rows: '6', placeholder: 'CC1234 Mohamed Kamara\nCC1235 Fatmata Bangura\nCC1236', value: ad.draft.ids, autocapitalize: 'characters', spellcheck: 'false' });
    ids.addEventListener('input', () => { ad.draft.ids = ids.value; err.textContent = ''; });
    form = h('form', { class: 'setup-form' },
      h('label', { for: 'ids' }, 'Students'),
      h('p', { class: 'muted small' }, 'One student per line: the candidate number, then the name. The name is optional and can be added later. Paste a whole list if you have one.'),
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
    const id = h('input', { id: 'newid', type: 'text', placeholder: role === 'admin' ? 'e.g. ADMIN-ANDERS' : 'e.g. SUP-ANNA', value: ad.draft.id, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    const name = h('input', { id: 'newname', type: 'text', placeholder: 'e.g. Dr Anna Kamara', value: ad.draft.name, autocomplete: 'off' });
    [id, name].forEach((i) => i.addEventListener('input', () => { ad.draft.id = id.value; ad.draft.name = name.value; err.textContent = ''; }));
    form = h('form', { class: 'setup-form' },
      h('label', { for: 'newid' }, 'Staff ID'), id,
      h('label', { for: 'newname' }, 'Name (students see it next to a signature)'), name,
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

  return h('section', {},
    h('h2', {}, 'Add users'),
    h('p', { class: 'muted' }, 'Each new account gets an initial password that works once. The person chooses their own password at the first login.'),
    seg, form);
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

function moreView() {
  return h('section', {},
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Account'),
      kv('Staff ID', ctx.session.candidate),
      kv('Name', ctx.session.name || ctx.session.candidate),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: ctx.openChangePassword }, 'Change password'),
        h('button', { class: 'btn ghost', onclick: confirmLogout }, 'Log out'))),
    backupCard(),
    h('div', { class: 'card' }, h('h3', {}, 'What an administrator can do'),
      h('p', { class: 'muted' }, 'See all students and their procedures, add accounts, give new passwords, disable accounts and choose which supervisor sees which student. You cannot sign procedures. Every change is listed under "Recent changes" on the Overview tab, with who made it. Initial passwords are shown once and never stored.')),
    h('div', { class: 'card' }, h('h3', {}, 'About'), kv('Version', ctx.version), kv('Server', api.serverLabel())));
}

function backupCard() {
  const last = ad.stats && ad.stats.last_backup;
  return h('div', { class: 'card' }, h('h3', {}, 'Backup'),
    h('p', { class: 'muted' }, 'A complete copy of all data, in one file. If the server disk is ever lost, this file is the only way to get the data back. Download one every week and keep it somewhere safe that is not this server, for example on a USB stick or in CapaCare\'s own storage.'),
    kv('Last backup', last ? timeAgo(last) : 'never'),
    h('button', {
      class: 'btn wide', type: 'button',
      onclick: () => downloadFile('Backup', (t) => api.adminBackup(t), `logbook-backup-${today()}.db`),
    }, 'Download backup'),
    h('p', { class: 'muted small' }, 'The file contains all names, entries and the scrambled passwords of every account. Treat it like the live data: do not send it by WhatsApp or e-mail.'));
}

function confirmLogout() {
  openSheet([
    h('h3', {}, 'Log out?'),
    h('p', {}, 'You will need your staff ID and password to log in again.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', type: 'button', onclick: ctx.onLogout }, 'Log out'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel')),
  ]);
}
