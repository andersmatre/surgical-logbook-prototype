// app.js — the student app, and the entry point that decides what to show.
// Screens: login, choose-password, hospital, then Log / Progress / History / More.
// A supervisor account gets the screens in supervisor.js, an administrator those in administrator.js.
// Plain JavaScript, no build step. Shared interface pieces live in ui.js.

import {
  PROCEDURES_TOP, PROCEDURES_OTHER, ROLES, TARGETS, TARGETS_ARE_PLACEHOLDER,
  HOSPITALS, APP_VERSION, procName, roleLabel,
} from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, kv, initUi, toast, hideToast, openSheet, closeSheet, passwordForm,
} from './ui.js';
import { mountSupervisor } from './supervisor.js';
import { mountAdministrator } from './administrator.js';

// Only students have a logbook on the tablet. Sessions saved by older versions have no role: students.
const isStudent = (session) => !!session && (session.role || 'student') === 'student';

const SESSION_KEY = 'logbook.session';

const state = {
  tab: 'log', session: null, profile: null, events: [], entries: [], sent: new Set(), meta: {},
  online: true, swReady: false, syncing: false, sessionNote: '',
};
let root, syncTimer;

// ---- session (who is logged in on this tablet) ------------------------------

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function writeSession(s) {
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  state.session = s;
}

// A 401 from the server means the session ended (changed password elsewhere, account
// disabled, very long inactivity). Entries on this tablet are kept; logging in again resumes.
function handleAuthError(e) {
  if (!(e instanceof api.ApiError) || e.status !== 401) return false;
  writeSession(null);
  state.sessionNote = 'Your session has ended. Please log in again. Your entries on this tablet are kept.';
  state.tab = 'log';
  render();
  return true;
}

// ---- state loading ---------------------------------------------------------

async function loadState() {
  if (!isStudent(state.session)) {
    Object.assign(state, { events: [], entries: [], sent: new Set(), meta: {}, profile: null });
    return;
  }
  state.events = await core.allEvents();
  state.entries = core.derive(state.events);
  state.sent = await core.sentIds();
  const meta = {};
  for (const k of ['hospital', 'last_sync_at', 'cursor', 'sync_warning', 'undo_count', 'open_count', 'first_open_at', 'persisted', 'supervisors']) {
    meta[k] = await core.getMeta(k);
  }
  state.meta = meta;
  state.profile = { student: state.session.candidate, hospital: meta.hospital };
}

async function refresh() {
  const y = window.scrollY || 0;
  await loadState();
  render();
  if (y) window.scrollTo(0, y);
}

// ---- syncing with the server -------------------------------------------------

function syncStatus() {
  const n = core.unsyncedCount(state.events, state.sent);
  if (state.syncing) return { cls: 'ok', text: 'Syncing…' };
  if (state.meta.sync_warning) return { cls: 'warn', text: 'Sync problem' };
  if (!state.online) return { cls: 'warn', text: n ? `Offline · ${n} waiting` : 'Offline' };
  if (state.meta.cursor == null) return { cls: 'warn', text: 'Tap to load your logbook' };
  if (n > 0) return { cls: 'warn', text: `${n} to sync` };
  return { cls: 'ok', text: 'Up to date' };
}

function updateChip() {
  const el = root && root.querySelector('.chip');
  if (!el) return;
  const st = syncStatus();
  el.className = `chip ${st.cls}`;
  el.textContent = st.text;
  el.setAttribute('aria-label', `Sync status: ${st.text}. Tap to sync.`);
}

// Send what the server has not confirmed yet, then fetch what this tablet has not seen.
async function syncCore() {
  const token = state.session.token;
  let sent = 0;
  let pulled = 0;
  let warning = null;
  for (let round = 0; round < 100; round++) {
    const all = await core.allEvents();
    const known = await core.sentIds();
    const unsent = all.filter((e) => !known.has(e.id)).slice(0, 200);
    const cursor = (await core.getMeta('cursor', 0)) || 0;
    const res = await api.sync(token, unsent, cursor);
    const ok = new Set(res.accepted || []);
    await core.markSent(unsent.filter((e) => ok.has(e.id)).map((e) => e.id));
    sent += ok.size;
    pulled += await core.addPulled(res.events || []);
    await core.setMeta('cursor', res.cursor);
    if (Array.isArray(res.supervisors)) await core.setMeta('supervisors', res.supervisors);
    if (state.session && res.name !== undefined && (res.name || null) !== (state.session.name || null)) writeSession({ ...state.session, name: res.name || null });
    let refused = 0;
    for (const r of res.rejected || []) {
      if (!r.id) continue;
      // A delete of an entry that a supervisor signed meanwhile: forget the delete. The signature arrives in this same sync.
      if (r.reason === 'signed_locked') { await core.dropEvent(r.id); continue; }
      // Refused for good (the same event would be refused again): stop retrying, but tell the student.
      await core.markSent([r.id]);
      refused += 1;
    }
    if (refused) warning = `${refused} entr${refused > 1 ? 'ies were' : 'y was'} refused by the server.`;
    if (!res.has_more && !(unsent.length === 200 && ok.size > 0)) break;
  }
  await core.setMeta('sync_warning', warning);
  await core.setMeta('last_sync_at', new Date().toISOString());
  return { sent, pulled };
}

async function doSync(manual = false) {
  if (!isStudent(state.session) || state.session.must_change || state.syncing) return;
  if (!state.online) {
    if (manual) toast('No internet right now', { sub: 'Your entries are safe on this tablet and will be sent later.' });
    return;
  }
  state.syncing = true;
  updateChip();
  let result;
  try {
    result = await syncCore();
  } catch (e) {
    state.syncing = false;
    if (handleAuthError(e)) return;
    updateChip();
    if (manual) toast('Could not sync', { sub: e.message });
    return;
  }
  state.syncing = false;
  await refresh();
  if (manual) {
    if (state.meta.sync_warning) toast('Sync problem', { sub: state.meta.sync_warning });
    else if (result.sent + result.pulled === 0) toast('Everything is up to date');
    else toast('Synced', { sub: `Sent ${result.sent}, received ${result.pulled}` });
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync(false), globalThis.LOGBOOK_SYNC_DELAY ?? 1500);
}

async function pullAll() {
  try { await syncCore(); } catch (e) { handleAuthError(e); /* offline: the chip tells the student */ }
}

// ---- render ----------------------------------------------------------------

const TABS = [['log', 'Log'], ['progress', 'Progress'], ['history', 'History'], ['more', 'More']];

function render() {
  root.replaceChildren();
  if (!state.session) { root.append(loginScreen()); return; }
  if (state.session.must_change) { root.append(forcedPasswordScreen()); return; }
  if (state.session.role === 'supervisor' || state.session.role === 'admin') {
    const mount = state.session.role === 'admin' ? mountAdministrator : mountSupervisor;
    mount({
      root, session: state.session, version: APP_VERSION,
      onAuthError: handleAuthError, onLogout: doLogout, openChangePassword,
    });
    return;
  }
  if (!state.profile || !state.profile.hospital) { root.append(hospitalScreen()); return; }
  root.append(
    header(),
    h('div', { class: 'banner' }, `Prototype v${APP_VERSION} · never type patient names or numbers`),
    h('main', { class: 'main' }, tabContent()),
    nav(),
  );
}

function tabContent() {
  if (state.tab === 'progress') return progressTab();
  if (state.tab === 'history') return historyTab();
  if (state.tab === 'more') return moreTab();
  return logTab();
}

function header() {
  const st = syncStatus();
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('strong', {}, 'CapaCare logbook'),
      h('span', { class: 'who' }, [state.profile.student, state.session.name, state.profile.hospital].filter(Boolean).join(' · '))),
    h('button', { class: `chip ${st.cls}`, onclick: () => doSync(true), 'aria-label': `Sync status: ${st.text}. Tap to sync.` }, st.text));
}

function nav() {
  const unsigned = state.entries.filter((e) => !e.sign).length;
  return h('nav', { class: 'nav' }, TABS.map(([id, label]) =>
    h('button', { class: 'tab' + (state.tab === id ? ' on' : ''), onclick: () => { state.tab = id; render(); window.scrollTo(0, 0); } },
      label, id === 'history' && unsigned > 0 ? h('span', { class: 'badge' }, unsigned) : null)));
}

// ---- login, password, hospital ------------------------------------------------

function loginScreen() {
  const cand = h('input', {
    id: 'cand', type: 'text', placeholder: 'e.g. CC1234', maxlength: '24', autocomplete: 'username',
    autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
  });
  const pw = h('input', { id: 'pw', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const show = h('input', { type: 'checkbox', id: 'showpw' });
  show.addEventListener('change', () => { pw.type = show.checked ? 'text' : 'password'; });
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const note = state.sessionNote ? h('p', { class: 'note' }, state.sessionNote) : null;
  const btn = h('button', { class: 'btn wide', type: 'submit' }, 'Log in');
  const reset = () => { btn.disabled = false; btn.textContent = 'Log in'; };

  const form = h('form', { class: 'setup-form' },
    h('label', { for: 'cand' }, 'Candidate number or staff ID'), cand,
    h('label', { for: 'pw' }, 'Password'), pw,
    h('label', { class: 'checkrow', for: 'showpw' }, show, h('span', {}, 'Show password')),
    err, btn);
  [cand, pw].forEach((i) => i.addEventListener('input', () => { err.textContent = ''; }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const candidate = core.normCandidate(cand.value);
    if (!core.validCandidate(candidate)) { err.textContent = 'Enter your candidate number.'; cand.focus(); return; }
    if (!pw.value) { err.textContent = 'Enter your password.'; pw.focus(); return; }
    if (!state.online) { err.textContent = 'You need internet to log in on this tablet. Connect and try again.'; return; }
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      const res = await api.login(candidate, pw.value);
      state.sessionNote = '';
      const role = res.role === 'supervisor' || res.role === 'admin' ? res.role : 'student';
      writeSession({ candidate: res.candidate, token: res.token, must_change: !!res.must_change_password, role, name: res.name || null });
      if (role === 'student') {
        // Supervisors keep no logbook on the tablet, so only students get a local database.
        core.useUser(res.candidate);
        if (!(await core.getMeta('first_open_at'))) await core.setMeta('first_open_at', new Date().toISOString());
        if (!res.must_change_password) {
          btn.textContent = 'Loading your logbook…';
          await pullAll();
        }
      }
      await refresh();
    } catch (e) {
      err.textContent = e.message;
      reset();
    }
  });

  return h('div', { class: 'setup' },
    h('h1', {}, 'CapaCare logbook'),
    h('p', { class: 'muted' }, 'Log in with the candidate number (students) or staff ID (supervisors and administrators) and the password you got from CapaCare. You need internet the first time you log in on a tablet. After that the student logbook also works without internet.'),
    note, serverNote(), form,
    h('p', { class: 'muted small' }, `Prototype v${APP_VERSION}. Never type patient names or numbers anywhere.`));
}

// Tells a tester which server the app talks to, when it is not the address the app was loaded from.
function serverNote() {
  const o = api.apiOverride();
  if (o) return h('p', { class: 'note' }, `Test mode: this app talks to the server on ${o}. Open the app with ?api= at the end of the address to switch it off.`);
  if (/\.github\.io$/.test(window.location.hostname) && !globalThis.LOGBOOK_API_BASE) {
    return h('p', { class: 'note' }, 'This address has no server of its own. To test against a server on your own computer, add ?api=http://localhost:8080 to the address.');
  }
  return null;
}

function forcedPasswordScreen() {
  const form = passwordForm({
    forced: true,
    candidate: state.session.candidate,
    token: state.session.token,
    onAuthError: handleAuthError,
    onDone: async () => {
      writeSession({ ...state.session, must_change: false });
      if (isStudent(state.session)) await pullAll();
      await refresh();
    },
  });
  return h('div', { class: 'setup' },
    h('h1', {}, 'Choose your own password'),
    h('p', { class: 'muted' }, `Welcome, ${state.session.candidate}. The password you were given is only for the first login. Choose a password that only you know, and do not share it with anyone.`),
    form);
}

function hospitalScreen() {
  const sel = h('select', { id: 'hosp' }, HOSPITALS.map((x) => h('option', { value: x }, x)));
  const form = h('form', { class: 'setup-form' },
    h('label', { for: 'hosp' }, 'Where are you working now?'), sel,
    h('button', { class: 'btn wide', type: 'submit' }, 'Continue'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await core.setMeta('hospital', sel.value);
    await refresh();
  });
  return h('div', { class: 'setup' },
    h('h1', {}, 'Almost there'),
    h('p', { class: 'muted' }, 'This is saved with your entries. You can change it later under More.'),
    form);
}

// ---- Log tab ---------------------------------------------------------------

function logTab() {
  const counts = {};
  state.entries.forEach((e) => { counts[e.procedure] = (counts[e.procedure] || 0) + 1; });
  return h('section', {},
    h('h2', {}, 'What did you do?'),
    h('div', { class: 'grid' }, PROCEDURES_TOP.map((p) =>
      h('button', { class: 'proc', onclick: () => openRoleSheet(p) },
        h('span', { class: 'proc-name' }, p.name),
        h('span', { class: 'proc-count' }, `${counts[p.id] || 0} logged`)))),
    h('button', { class: 'btn ghost wide', onclick: openMoreProcedures }, 'More procedures…'));
}

function openMoreProcedures() {
  const list = h('div', { class: 'plist' });
  const input = h('input', { type: 'search', placeholder: 'Search procedure', class: 'search' });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const rows = PROCEDURES_OTHER.filter((p) => p.name.toLowerCase().includes(q));
    list.replaceChildren(...(rows.length
      ? rows.map((p) => h('button', { class: 'row-btn', type: 'button', onclick: () => { closeSheet(); openRoleSheet(p); } }, p.name))
      : [h('p', { class: 'muted' }, 'No match. Use "Other / not listed".')]));
  };
  input.addEventListener('input', draw);
  draw();
  openSheet([h('h3', {}, 'More procedures'), input, list, h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Close')]);
}

function openRoleSheet(proc) {
  const t0 = performance.now();
  let date = core.localDateISO();
  let saving = false;
  const today = core.localDateISO();
  const dateLabel = h('strong', {}, 'Today');
  const dateInput = h('input', { type: 'date', max: today, value: date, class: 'dinput' });
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    date = dateInput.value;
    dateLabel.textContent = date === today ? 'Today' : core.fmtDate(date);
  });
  const changeBtn = h('button', { class: 'link', type: 'button', onclick: () => dateInput.classList.toggle('show') }, 'Change date');

  const roleBtns = ROLES.map((r) => h('button', {
    class: `role role-${r.id}`, type: 'button',
    onclick: async () => {
      if (saving) return;
      saving = true;
      const ms = performance.now() - t0;
      closeSheet();
      const ev = await core.logEntry({
        student: state.profile.student, hospital: state.profile.hospital,
        procedure: proc.id, role: r.id, performed_on: date, ms_to_log: ms, online: state.online,
      });
      await refresh();
      scheduleSync();
      const p = core.progress(state.entries)[proc.id] || { performed: 0, total: 0 };
      const target = TARGETS[proc.id];
      toast(`Saved · ${r.label}`, {
        sub: target ? `${proc.name}: ${p.performed} of ${target} performed` : `${proc.name}: ${p.total} logged`,
        action: {
          label: 'Undo',
          fn: async () => {
            await core.voidEntry(ev.id);
            await core.setMeta('undo_count', (state.meta.undo_count || 0) + 1);
            await refresh();
            scheduleSync();
            toast('Undone');
          },
        },
      });
    },
  }, h('strong', {}, r.label), h('span', {}, r.hint)));

  // The hospital is stored with every entry. It is the one chosen on this tablet; it can be changed right here.
  const hospLabel = h('strong', {}, state.profile.hospital);
  const hospSel = h('select', { 'aria-label': 'Hospital', class: 'dinput' }, HOSPITALS.map((x) => h('option', { value: x, selected: x === state.profile.hospital }, x)));
  hospSel.addEventListener('change', async () => {
    await core.setMeta('hospital', hospSel.value);
    state.profile.hospital = hospSel.value;
    hospLabel.textContent = hospSel.value;
    hospSel.classList.remove('show');
  });
  const hospBtn = h('button', { class: 'link', type: 'button', onclick: () => hospSel.classList.toggle('show') }, 'Change hospital');

  openSheet([
    h('h3', {}, proc.name),
    h('div', { class: 'daterow' }, h('span', {}, 'Hospital: '), hospLabel, hospBtn),
    hospSel,
    h('div', { class: 'daterow' }, h('span', {}, 'Date: '), dateLabel, changeBtn),
    dateInput,
    h('p', { class: 'q' }, 'What was your role?'),
    h('div', { class: 'roles' }, roleBtns),
    h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Cancel'),
  ]);
}

// ---- Progress tab ----------------------------------------------------------

function progressTab() {
  const prog = core.progress(state.entries);
  const total = state.entries.length;
  const signed = state.entries.filter((e) => e.sign).length;
  const wk = core.weekEntries(state.entries).length;
  const text = core.weeklySummary(state.entries, { student: state.profile.student });
  const others = Object.entries(prog).filter(([id]) => !(id in TARGETS));

  return h('section', {},
    h('h2', {}, 'My progress'),
    h('div', { class: 'stats' },
      stat(total, 'logged'), stat(signed, 'signed'), stat(wk, 'this week')),
    h('div', { class: 'card' },
      PROCEDURES_TOP.map((p) => {
        const pr = prog[p.id] || { performed: 0, assisting: 0, observing: 0 };
        const t = TARGETS[p.id];
        const pct = Math.min(100, Math.round((pr.performed / t) * 100));
        return h('div', { class: 'prow' },
          h('div', { class: 'prow-top' }, h('strong', {}, p.name), h('span', {}, `${pr.performed} / ${t}`)),
          h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(t), 'aria-valuenow': String(pr.performed), 'aria-label': p.name },
            h('div', { class: 'fill', style: `width:${pct}%` })),
          h('div', { class: 'muted small' }, `performed ${pr.performed} · assisted ${pr.assisting} · observed ${pr.observing}`));
      }),
      TARGETS_ARE_PLACEHOLDER ? h('p', { class: 'muted small' }, 'Targets are examples until the real training-manual targets are added.') : null),
    others.length ? h('div', { class: 'card' }, h('h3', {}, 'Other procedures'),
      others.map(([id, p]) => h('div', { class: 'orow' }, h('span', {}, procName(id)), h('strong', {}, p.total)))) : null,
    h('div', { class: 'card' },
      h('h3', {}, 'Weekly summary'),
      h('pre', { class: 'summary' }, text),
      h('p', { class: 'muted small' }, 'Only numbers. No patient information.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => shareWhatsApp(text) }, 'Share on WhatsApp'),
        h('button', { class: 'btn ghost', onclick: () => copyText(text) }, 'Copy'))));
}

function shareWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Could not copy', { sub: 'Select the text and copy it by hand.' }); }
}

// ---- History tab -----------------------------------------------------------

function historyTab() {
  const unsigned = state.entries.filter((e) => !e.sign).length;
  const sups = state.meta.supervisors || [];
  let info;
  if (!state.entries.length) info = null;
  else if (!sups.length) info = 'No supervisor has added you yet. Ask your supervisor to add your candidate number in the supervisor app; then they can sign your entries.';
  else if (unsigned) info = `${unsigned} waiting for a signature. Your supervisor signs in their own app once your entries are synced.`;
  else info = 'All your entries are signed.';
  return h('section', {},
    h('h2', {}, 'History'),
    info ? h('p', { class: 'note-info' }, info) : null,
    state.entries.length
      ? h('ul', { class: 'list' }, state.entries.map(entryRow))
      : h('p', { class: 'muted' }, 'No entries yet. Log your first procedure on the Log tab.'));
}

function entryRow(e) {
  const late = e.performed_on !== e.entered_on;
  return h('li', { class: 'entry' },
    h('div', { class: 'e-main' }, h('strong', {}, procName(e.procedure)), h('span', { class: `role-tag role-${e.role}` }, roleLabel(e.role))),
    h('div', { class: 'e-meta' },
      h('span', {}, core.fmtDate(e.performed_on)),
      e.hospital ? h('span', {}, e.hospital) : null,
      late ? h('span', { class: 'tag' }, 'late entry') : null,
      e.sign ? h('span', { class: 'tag ok' }, `Signed · ${e.sign.supervisor_name || e.sign.supervisor}`) : h('span', { class: 'tag warn' }, 'Not signed')),
    e.sign ? null : h('button', { class: 'link danger', onclick: () => confirmDelete(e) }, 'Delete'));
}

function confirmDelete(e) {
  openSheet([
    h('h3', {}, 'Delete this entry?'),
    h('p', {}, `${procName(e.procedure)} · ${roleLabel(e.role)} · ${core.fmtDate(e.performed_on)}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: async () => { closeSheet(); await core.voidEntry(e.id); await refresh(); scheduleSync(); toast('Entry deleted'); } }, 'Delete'),
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  ]);
}

// ---- More tab --------------------------------------------------------------

function moreTab() {
  const n = core.unsyncedCount(state.events, state.sent);
  const m = core.metrics(state.events, state.meta);
  const sel = h('select', {
    'aria-label': 'Hospital',
    onchange: async (ev) => { await core.setMeta('hospital', ev.target.value); await refresh(); },
  }, HOSPITALS.map((x) => h('option', { value: x, selected: x === state.profile.hospital }, x)));

  return h('section', {},
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Account'),
      kv('Candidate number', state.profile.student),
      state.session.name ? kv('Name', state.session.name) : null,
      h('label', { class: 'small muted' }, 'Hospital'), sel,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: openChangePassword }, 'Change password'),
        h('button', { class: 'btn ghost', onclick: openLogout }, 'Log out'))),
    h('div', { class: 'card' }, h('h3', {}, 'Data on this tablet'),
      kv('Entries', m.entries_active),
      kv('Waiting to be sent', n),
      kv('Last sync', timeAgo(state.meta.last_sync_at)),
      kv('Works offline', state.swReady ? 'yes' : 'not yet'),
      kv('Storage protected', state.meta.persisted === true ? 'yes' : state.meta.persisted === false ? 'no' : 'unknown'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => doSync(true) }, 'Sync now'),
        h('button', { class: 'btn ghost', onclick: exportData }, 'Export test data')),
      h('p', { class: 'muted small' }, 'Entries are sent to the server automatically when there is internet. "Export test data" saves a file you can send on WhatsApp.')),
    supervisorsCard(),
    h('div', { class: 'card' }, h('h3', {}, 'About'), kv('Version', APP_VERSION), kv('Server', api.serverLabel())));
}

function supervisorsCard() {
  const sups = state.meta.supervisors || [];
  return h('div', { class: 'card' }, h('h3', {}, 'Your supervisors'),
    sups.length
      ? sups.map((s) => kv(s.name, `since ${core.fmtDate(String(s.since).slice(0, 10))}`))
      : h('p', { class: 'muted' }, 'No supervisor has added you yet.'),
    h('p', { class: 'muted small' }, 'These supervisors can see your entries and sign them. Nobody else can. If someone is on this list who should not be, tell CapaCare.'));
}

function openChangePassword() {
  openSheet([
    h('h3', {}, 'Change password'),
    passwordForm({
      forced: false,
      candidate: state.session.candidate,
      token: state.session.token,
      onAuthError: handleAuthError,
      onDone: async () => { closeSheet(); toast('Password changed', { sub: 'Other tablets were logged out.' }); },
    }),
    h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Cancel'),
  ]);
}

async function openLogout() {
  let n = core.unsyncedCount(state.events, state.sent);
  if (n > 0 && state.online) {
    toast('Sending your entries first…', { sticky: true });
    await doSync(false);
    hideToast();
    if (!state.session) return; // session ended while syncing
    n = core.unsyncedCount(state.events, state.sent);
  }
  openSheet([
    h('h3', {}, 'Log out?'),
    n === 0
      ? h('p', {}, 'Your entries are safe on the server. They are removed from this tablet when you log out. Log in again to see them.')
      : h('p', { class: 'error' }, `${n} entr${n > 1 ? 'ies have' : 'y has'} NOT been sent to the server. If you log out now, ${n > 1 ? 'they are' : 'it is'} lost for good.${state.online ? '' : ' Connect to the internet and sync first.'}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: doLogout }, n === 0 ? 'Log out' : 'Log out and lose entries'),
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  ]);
}

async function doLogout() {
  closeSheet();
  const token = state.session && state.session.token;
  if (token) {
    // Best effort: tell the server, but never make the student wait for a bad connection.
    await Promise.race([api.logout(token).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  }
  clearTimeout(syncTimer);
  if (!state.session || isStudent(state.session)) await core.wipeAll();
  writeSession(null);
  state.sessionNote = '';
  state.tab = 'log';
  await refresh();
}

async function exportData() {
  const payload = core.buildExport(state.events, { ...state.meta, profile: state.profile });
  const name = `logbook-${state.profile.student.replace(/[^A-Z0-9_-]/g, '_')}-${core.localDateISO()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Logbook test data' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  toast('Test data saved', { sub: name });
}

// ---- startup ---------------------------------------------------------------

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { state.swReady = true; updateChip(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated', { sub: 'Close and reopen it to use the new version.', sticky: true });
  });
}

async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await core.setMeta('persisted', await navigator.storage.persist());
    }
  } catch { /* ignore */ }
}

export async function init() {
  root = document.getElementById('app');
  api.applyApiParam(window.location.search);
  initUi({ overlayEl: document.getElementById('overlay'), toastElement: document.getElementById('toast') });
  state.online = navigator.onLine !== false;

  // Only the sync chip changes when the connection changes, so nothing a student is typing is lost.
  window.addEventListener('online', () => { state.online = true; updateChip(); scheduleSync(); });
  window.addEventListener('offline', () => { state.online = false; updateChip(); });

  state.session = readSession();
  if (isStudent(state.session)) {
    core.useUser(state.session.candidate);
    await core.setMeta('open_count', ((await core.getMeta('open_count', 0)) || 0) + 1);
  }
  await loadState();
  render();
  registerSW();
  requestPersist();
  if (isStudent(state.session) && !state.session.must_change) scheduleSync();

  // Retry now and then while the app stays open on a flaky connection.
  const timer = setInterval(() => {
    if (isStudent(state.session) && !state.session.must_change && state.online
      && (core.unsyncedCount(state.events, state.sent) > 0 || state.meta.cursor == null)) doSync(false);
  }, 180000);
  if (timer && timer.unref) timer.unref();
}
