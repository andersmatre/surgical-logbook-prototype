// app.js — the student app, and the entry point that decides what to show.
// Screens: login, choose-password, hospital, then Log / Progress / History / More.
// A supervisor account gets the screens in supervisor.js, an administrator those in administrator.js.
// Plain JavaScript, no build step. Shared interface pieces live in ui.js.

import {
  PROCEDURE_GROUPS, PROCEDURES, ALL_PROCEDURES, LOG_SURGERY, LOG_DELIVERIES,
  HOSPITALS, APP_VERSION, DETAIL_FIELDS, FOLLOWUP_FIELDS, FOLLOWUP_DAYS, findProcedure, procName, rolesFor, roleDone, detailFieldsFor, followupFieldsFor,
} from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, cases, initUi, appShell, pageScroll, setPageScroll, toast, hideToast, openSheet, closeSheet, openCase, confirmOver, scrollHint, passwordForm, openPrivacy, fact, privacyFact, advancedCard,
  procedureProgress, filterButton, openFilterSheet,
} from './ui.js';
import { mountSupervisor } from './supervisor.js';
import { mountAdministrator } from './administrator.js';

// Only students have a logbook on the tablet. Sessions saved by older versions have no role: students.
const isStudent = (session) => !!session && (session.role || 'student') === 'student';

const SESSION_KEY = 'logbook.session';

const state = {
  tab: 'log', session: null, profile: null, events: [], entries: [], sent: new Set(), meta: {},
  online: true, syncing: false, sessionNote: '',
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
  state.sessionNote = 'Your session has ended. Please log in again. Your entries on this device are kept.';
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
  for (const k of ['hospital', 'last_sync_at', 'cursor', 'sync_warning', 'supervisors']) {
    meta[k] = await core.getMeta(k);
  }
  state.meta = meta;
  state.profile = { student: state.session.candidate, hospital: meta.hospital };
}

async function refresh() {
  await loadState();
  render();
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

// The sync button is only shown when something needs attention; when everything is up to date it is left out.
function chipFor(st) {
  if (st.text === 'Up to date') return null;
  return h('button', { class: `chip ${st.cls}`, onclick: () => doSync(true), 'aria-label': `Sync status: ${st.text}. Tap to sync.` }, st.text);
}

function updateChip() {
  const top = root && root.querySelector('header.top');
  if (!top) return;
  const old = top.querySelector('.chip');
  const fresh = chipFor(syncStatus());
  if (old && fresh) old.replaceWith(fresh);
  else if (old) old.remove();
  else if (fresh) top.append(fresh);
}

// Send what the server has not confirmed yet, then fetch what this tablet has not seen.
// If the server was restored from a backup (its db_id changed), it has lost what came after the backup: this tablet
// sends all its own events again and fetches everything from the start (core.restartSync). Once everything is
// fetched, signatures and targets the server no longer has are removed here too. An interrupted resync starts over.
async function syncCore() {
  const token = state.session.token;
  let sent = 0;
  let pulled = 0;
  let warning = null;
  let resync = !!(await core.getMeta('resync', false));
  if (resync) await core.setMeta('cursor', 0);
  const seen = new Set(); // during a resync: the ids of everything the server sent
  let done = false;
  for (let round = 0; round < 100; round++) {
    const all = await core.allEvents();
    const known = await core.sentIds();
    const unsent = all.filter((e) => !known.has(e.id)).slice(0, 200);
    const cursor = (await core.getMeta('cursor', 0)) || 0;
    const res = await api.sync(token, unsent, cursor);
    if (res.db_id) { // an older server sends none
      const was = await core.getMeta('server_db', null);
      if (was !== res.db_id) await core.setMeta('server_db', res.db_id);
      if (was && was !== res.db_id) { // restored: start over (what was just sent is simply sent once more)
        await core.restartSync();
        resync = true;
        seen.clear();
        continue;
      }
    }
    if (resync) for (const e of res.events || []) seen.add(e.id);
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
    if (!res.has_more && !(unsent.length === 200 && ok.size > 0)) { done = true; break; }
  }
  if (resync && done) await core.dropServerEventsExcept(seen);
  await core.setMeta('sync_warning', warning);
  await core.setMeta('last_sync_at', new Date().toISOString());
  return { sent, pulled };
}

async function doSync(manual = false) {
  if (!isStudent(state.session) || state.session.must_change || state.syncing) return;
  if (!state.online) {
    if (manual) toast('No internet right now', { sub: 'Your entries are safe on this device and will be sent later.' });
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

const TABS = [['log', 'New case'], ['history', 'History'], ['progress', 'Progress'], ['more', 'More']];

function render() {
  const y = pageScroll();
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
  root.append(appShell({}, [header(), nav()], tabContent()));
  if (y) setPageScroll(y); // drawn again (a sync, an answer): stay where you were
}

function tabContent() {
  if (state.tab === 'progress') return progressTab();
  if (state.tab === 'history') return historyTab();
  if (state.tab === 'more') return moreTab();
  return logTab();
}

function header() {
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('strong', {}, 'CapaCare logbook'),
      h('span', { class: 'who' }, [state.profile.student, state.session.name, state.profile.hospital].filter(Boolean).join(' · '))),
    chipFor(syncStatus()));
}

function nav() {
  return h('nav', { class: 'nav' }, TABS.map(([id, label]) =>
    h('button', { class: 'tab' + (state.tab === id ? ' on' : ''), onclick: () => { state.tab = id; render(); setPageScroll(0); } }, label)));
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
    h('label', { for: 'cand' }, 'Candidate number'), cand,
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
    if (!state.online) { err.textContent = 'You need internet to log in on this device. Connect and try again.'; return; }
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
    h('p', { class: 'muted' }, 'Log in with your candidate number and the password you got from CapaCare. You need internet the first time you log in on this device. After that the logbook also works without internet.'),
    note, serverNote(), form,
    h('p', { class: 'muted small' }, `Version ${APP_VERSION}`));
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
    form,
    // Everyone (students, supervisors, administrators) passes this screen once: tell them what is stored.
    h('button', { class: 'btn ghost wide pv-link', type: 'button', onclick: () => openPrivacy(state.session.role) }, 'How your data is used'));
}

// Asked once on each device, after the first login. Laid out like the hospital under More: a row with the hospital
// and a button that opens the same hospital menu (hospitalPicker). Nothing is chosen at first, so the button says
// "Choose" and the button at the bottom says what is missing; once chosen they say "Change" and "Continue".
// The hospital is only stored on Continue.
function hospitalScreen() {
  let chosen = null;
  const go = h('button', {
    class: 'btn wide', type: 'button',
    onclick: async () => { go.disabled = true; await setHospital(chosen); await refresh(); },
  }, 'Choose your hospital');
  go.disabled = true;
  const hosp = hospitalPicker((x) => {
    chosen = x;
    row.querySelector('strong').textContent = x;
    hosp.button.textContent = 'Change';
    go.disabled = false;
    go.textContent = 'Continue';
  }, { save: false, current: () => chosen });
  hosp.button.textContent = 'Choose';
  const row = fact('Hospital', 'Not chosen yet', hosp.button, hosp.panel);
  return h('div', { class: 'setup hosp-setup' },
    h('h1', {}, 'Where do you work?'),
    h('p', { class: 'muted' }, 'You can change this later.'),
    h('div', { class: 'card' }, h('div', { class: 'facts plain' }, row)),
    go);
}

// ---- Log tab ---------------------------------------------------------------

function logTab() {
  const counts = {};
  state.entries.forEach((e) => { counts[e.procedure] = (counts[e.procedure] || 0) + 1; });
  // First Surgery or Delivery, like CapaCare's two logbooks; then that part's procedures in two even columns (one
  // on a phone). Every row looks the same: the name, how many, and a "+" that says "add".
  const button = (p) => h('button', { class: 'proc', onclick: () => openEntrySheet(p) },
    h('span', { class: 'proc-text' },
      h('span', { class: 'proc-name' }, p.name),
      h('span', { class: 'proc-count' }, cases(counts[p.id] || 0))),
    h('span', { class: 'proc-add', 'aria-hidden': 'true' }));
  // Surgery or Delivery: two tabs like Details and Follow-up in a case (.ctabs), the open one with a line under it
  const partTab = (id, label) => h('button', {
    class: logPart === id ? 'ctab on' : 'ctab', type: 'button', role: 'tab', 'aria-selected': String(logPart === id),
    onclick: () => { if (logPart !== id) { logPart = id; render(); } },
  }, label);
  return h('section', {},
    h('h2', { class: 'log-title' }, 'Add a new case'), // "case", like the counts on the tiles and on Progress
    h('div', { class: 'ctabs log-parts', role: 'tablist', 'aria-label': 'Surgery or delivery' }, partTab('surgery', 'Surgery'), partTab('delivery', 'Delivery')),
    logPart === 'surgery' ? [
      h('div', { class: 'grid' }, LOG_SURGERY.map(findProcedure).map(button)),
      h('button', { class: 'proc proc-more', onclick: openMoreProcedures },
        h('span', { class: 'proc-text' },
          h('span', { class: 'proc-name' }, 'More operations'),
          h('span', { class: 'proc-count' }, 'Not in the list above? Find it here.')),
        h('span', { class: 'proc-add more', 'aria-hidden': 'true' })),
    ] : null,
    logPart === 'delivery' ? [
      h('div', { class: 'grid' }, LOG_DELIVERIES.map(findProcedure).map(button)),
    ] : null);
}

// Which part of the Log tab is open: 'surgery' (chosen from the start) or 'delivery'. Kept while the app is open,
// so it stays after saving an entry or visiting another tab; back to 'surgery' when the student logs out.
let logPart = 'surgery';

// Every operation, under its group (as in CapaCare's logbook). The search looks at the names of the
// operations and of the groups, so "ortho" shows the whole group.
function openMoreProcedures() {
  const list = h('div', { class: 'plist' });
  const input = h('input', { type: 'search', placeholder: 'Search operation', class: 'search' });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const parts = PROCEDURE_GROUPS.flatMap((g) => {
      const rows = PROCEDURES.filter((p) => p.group === g.id && (g.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)));
      return rows.length
        ? [h('h4', { class: 'plist-group' }, g.name),
          ...rows.map((p) => h('button', { class: 'row-btn', type: 'button', onclick: () => { closeSheet(); openEntrySheet(p); } }, p.name))]
        : [];
    });
    list.replaceChildren(...(parts.length ? parts : [h('p', { class: 'muted' }, 'No match. Use "Other" in the group it belongs to.')]));
  };
  input.addEventListener('input', draw);
  draw();
  openSheet([h('h3', {}, 'All operations'), input, list, h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Close')], { tall: true });
}

// "Change" opens the calendar at once, and a second press closes it again. Returns the button's onpointerdown and
// onclick. On a touch screen the date field lies invisible on top of the button (style.css), because an iPhone
// only opens the calendar from a real tap on the field; there the button is only reached with a keyboard, and
// the tap on the field opens it: by itself on a phone, by showPicker() where it does not (Chrome's tablet mode on
// a computer). With a mouse the button gets the click (and looks like every other button when the mouse is over it).
// The press that closes the calendar has closed it before the page hears of it, so whether it was open is
// remembered: until the browser's :open says it closed in another way (a date chosen, Escape, a click elsewhere).
// A browser without showPicker() shows the field under the row instead.
function dateToggle(el) {
  let open = false;
  let closedAt = -1e9; // when the watch saw it close: a press just after counts as closing it
  let wasOpen = false;
  const watch = () => {
    if (open) return;
    try { if (!el.matches(':open')) return; } catch { return; } // a browser without :open: no closing by a second press
    open = true;
    const timer = setInterval(() => { if (!el.isConnected || !el.matches(':open')) { open = false; closedAt = performance.now(); clearInterval(timer); } }, 150);
  };
  const pressed = () => { wasOpen = open || performance.now() - closedAt < 250; };
  const closedByThisPress = () => { const was = wasOpen; wasOpen = false; return was; };

  // a tap on the field itself (touch screens)
  el.addEventListener('pointerdown', pressed);
  el.addEventListener('click', (ev) => {
    if (el.classList.contains('show')) return; // the field shown under the row works as a normal field
    if (closedByThisPress()) { ev.preventDefault(); return; }
    setTimeout(() => { // after the browser had its chance to open it itself
      try {
        if (!el.matches(':open')) el.showPicker();
        watch();
      } catch { /* an iPhone opens it in its own way */ }
    }, 0);
  });

  return {
    onpointerdown: pressed,
    onclick: () => {
      if (closedByThisPress()) return;
      try {
        if (typeof el.showPicker === 'function') { el.showPicker(); watch(); return; }
      } catch { /* not allowed here: fall back to showing the field */ }
      el.classList.toggle('show');
      if (el.classList.contains('show')) el.focus();
    },
  };
}

// Stores the hospital on this tablet; it goes with every entry logged from now on.
async function setHospital(x) {
  await core.setMeta('hospital', x);
  if (state.profile) state.profile.hospital = x;
}

// The inside of the hospital menu (hospitalPicker): a search field and one button per hospital, the current one
// (current()) marked. onChoose gets the tapped name. draw() shows the whole list again (after clearing the search).
function hospitalList(onChoose, current) {
  const search = h('input', { type: 'text', class: 'search', placeholder: 'Search hospital', 'aria-label': 'Search hospital', autocomplete: 'off' });
  const list = h('div', { class: 'hlist' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = HOSPITALS.filter((x) => x.toLowerCase().includes(q)).map((x) => h('button', {
      class: x === current() ? 'row-btn opt on' : 'row-btn opt', type: 'button',
      onclick: () => onChoose(x),
    }, x));
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted' }, 'No match. Choose "Other".')]));
  };
  search.addEventListener('input', draw);
  draw();
  return { search, list, draw };
}

// The hospital menu that "Change" opens: a white box over the page, under the button, with a search field and one
// button per hospital, the current one marked. One tap chooses. Plain buttons, because a phone's own list (a wheel
// on the iPhone) is slow and needs a second step. It closes with its × button, "Change" again, Escape or a tap
// outside it. Returns the "Change" button and the menu: put both in one element with position: relative
// (.fact). onPick gets the chosen name. Normally the choice is stored on this tablet at once; on the first-login
// screen ({ save: false }) it is only stored on Continue, and current() says which one to mark.
function hospitalPicker(onPick, { save = true, current = () => state.profile?.hospital } = {}) {
  const { search, list, draw } = hospitalList(async (x) => { close(); if (save) await setHospital(x); onPick(x); }, current);
  const close = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  };
  const outside = (ev) => { if (!panel.contains(ev.target) && !button.contains(ev.target)) close(); };
  const escape = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); button.focus(); } };
  const panel = h('div', { class: 'hpick', role: 'dialog', 'aria-label': 'Choose hospital', hidden: true },
    h('div', { class: 'hpick-head' },
      h('strong', {}, 'Choose hospital'),
      h('button', { class: 'hpick-x', type: 'button', 'aria-label': 'Close', onclick: () => close() }, '×')),
    search, list);
  scrollHint(list, panel);
  const open = () => {
    search.value = '';
    draw();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const on = list.querySelector('.on');
    if (on) list.scrollTop = on.offsetTop - (list.clientHeight - on.offsetHeight) / 2; // the current hospital in the middle (.hlist is positioned)
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
  };
  const button = h('button', {
    class: 'change', type: 'button', 'aria-label': 'Change hospital', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    onclick: () => (panel.hidden ? open() : close()),
  }, 'Change');
  return { button, panel };
}

// Logging a procedure: one pop-up with everything on it. Hospital and date are filled in, the role is the
// one thing to choose, the details under it are optional, and Save (always in view at the bottom) stores it.
function openEntrySheet(proc) {
  let date = core.localDateISO();
  let role = null;
  let saving = false;
  const today = core.localDateISO();
  const dateLabel = h('strong', {}, 'Today');
  const dateInput = h('input', { type: 'date', max: today, value: date, class: 'dinput picker', 'aria-label': 'Date' });
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    date = dateInput.value;
    dateLabel.textContent = date === today ? 'Today' : core.fmtDate(date);
    dateInput.classList.remove('show');
  });
  const changeBtn = h('button', { class: 'change', type: 'button', 'aria-label': 'Change date', ...dateToggle(dateInput) }, 'Change');

  // The hospital is stored with every entry. It is the one chosen on this tablet; it can be changed right here.
  const hospLabel = h('strong', {}, state.profile.hospital);
  const hosp = hospitalPicker((x) => { hospLabel.textContent = x; });

  // Save says what is missing until a role is chosen, so the student is never left wondering why nothing happens.
  const saveBtn = h('button', { class: 'btn save', type: 'button', onclick: () => save() });
  const showSave = () => {
    saveBtn.disabled = !role;
    saveBtn.textContent = role ? 'Save' : 'Choose your role';
  };
  const roles = rolesFor(proc.id);
  const roleGroup = choices(roles.map((r) => [r.id, r.label, r.hint, { text: r.tag, on: r.tagOn }]), null, (v) => { role = roles.find((r) => r.id === v); showSave(); }, { required: true, wide: true, column: true });
  showSave();

  const parts = detailFieldsFor(proc.id);
  const form = questions(DETAIL_FIELDS, parts, {});
  const err = h('p', { class: 'error', role: 'alert' }, '');

  // Save checks the answers first. If some questions have no answer, a question on top asks before saving;
  // "Go back" shows the first one without an answer.
  async function save(anyway = false) {
    if (saving || !role) return;
    const v = form.values();
    if (v.error) { err.textContent = v.error; return; }
    const missing = form.missing();
    if (missing.length && !anyway) {
      confirmOver({
        title: 'Not everything is answered',
        text: missing.length === 1 ? '1 question has no answer. Save anyway?' : `${missing.length} questions have no answer. Save anyway?`,
        no: 'Go back', yes: 'Save anyway',
        onYes: () => save(true),
      });
      form.scrollTo(missing[0]);
      return;
    }
    saving = true;
    closeSheet();
    const ev = await core.logEntry({
      student: state.profile.student, hospital: state.profile.hospital,
      procedure: proc.id, role: role.id, performed_on: date, details: v.answers,
    });
    await refresh();
    scheduleSync();
    const p = core.progress(state.entries)[proc.id] || { performed: 0, total: 0 };
    const target = core.targets(state.events)[proc.id];
    toast(`Saved · ${role.label}`, {
      sub: target ? `${proc.name}: ${p.performed} of ${target} performed` : `${proc.name}: ${cases(p.total)}`,
      action: {
        label: 'Undo',
        fn: async () => {
          await core.voidEntry(ev.id);
          await refresh();
          scheduleSync();
          toast('Undone');
        },
      },
    });
  }

  openSheet([
    h('h3', {}, proc.name),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { class: 'fact-text' }, h('span', {}, 'Hospital'), hospLabel), hosp.button, hosp.panel),
      h('div', { class: 'fact' }, h('span', { class: 'fact-text' }, h('span', {}, 'Date'), dateLabel), changeBtn, dateInput)),
    h('section', { class: 'qcard', role: 'group', 'aria-label': 'Your role' }, h('h4', { class: 'qsection' }, 'Your role'), roleGroup),
    form.el,
    err,
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel'),
      saveBtn),
  ]);
}

// A set of big buttons where one can be chosen. `options` are [value, label, hint?]. Tapping the chosen one
// again clears it, unless the answer is required. A chosen button is filled with the main colour.
// The buttons are in a grid, two per row; three short ones (like One, Twins, Triplets) share one row.
function choices(options, initial, onChange, { required = false, wide = false, column = false } = {}) {
  let chosen = initial;
  const three = !wide && options.length === 3 && options.every(([, label]) => label.length <= 9);
  const wrap = h('div', { class: 'choices' + (wide ? ' wide' : three ? ' three' : '') + (column ? ' column' : '') });
  const paint = () => {
    for (const b of wrap.children) {
      const on = b.dataset.value === chosen;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  // An option is [value, label, hint?, tag?]; a tag ({ text, on }) is a small box on the right, in the middle of
  // the button's height (the roles: Scrubbed / Not scrubbed), light blue when `on`, grey when not.
  wrap.append(...options.map(([v, label, hint, tag]) => {
    const text = [h('strong', {}, label), hint ? h('span', { class: 'choice-hint' }, hint) : null];
    const hasTag = !!(tag && tag.text);
    return h('button', {
      class: hasTag ? 'choice has-tag' : 'choice', type: 'button', 'data-value': v,
      onclick: () => { chosen = chosen === v && !required ? null : v; paint(); onChange(chosen); },
    }, hasTag
      ? [h('span', { class: 'choice-text' }, text), h('span', { class: tag.on ? 'choice-tag on' : 'choice-tag' }, tag.text)]
      : text);
  }));
  paint();
  if (options.some(([, , , tag]) => tag && tag.text)) stackTagsTogether(wrap);
  return wrap;
}

// The boxes (tags) on the right of the choices all move under the text together: as soon as one button's text no
// longer fits beside its box (CSS then wraps that box onto its own line), every button gets its box under the text
// (.stacked), so they never sit half on the right and half underneath. Measured again when the width changes.
function stackTagsTogether(wrap) {
  let lastWidth = -1;
  const update = () => {
    const w = wrap.clientWidth;
    if (!w || w === lastWidth) return; // not on the screen yet, or only the height changed
    lastWidth = w;
    wrap.classList.remove('stacked'); // measure the side-by-side layout (no paint in between, so no flicker)
    const wrapped = [...wrap.querySelectorAll('.choice.has-tag')].some((b) => {
      const text = b.querySelector('.choice-text');
      return b.querySelector('.choice-tag').offsetTop >= text.offsetTop + text.offsetHeight - 1;
    });
    wrap.classList.toggle('stacked', wrapped);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(wrap);
  document.fonts?.ready.then(() => { lastWidth = -1; update(); });
}

// A small round "?" after a question whose words need explaining ("Para"), and the explanation in a small bubble
// under it ("Births before this one"), only while it is open: tap "?" again to close it. Returns [button, bubble].
function helpTip(ask, text) {
  // it stays open until "?" is tapped again: closing by itself would move what is under it while the student uses it
  const tip = h('p', { class: 'qhelp', hidden: true }, text);
  const show = (on) => {
    tip.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    btn.classList.toggle('on', on);
  };
  const btn = h('button', {
    class: 'qtip-btn', type: 'button', 'aria-label': `What does "${ask}" mean?`, 'aria-expanded': 'false',
    onclick: () => show(tip.hidden),
  }, '?');
  return [btn, tip];
}

// Questions from DETAIL_FIELDS or FOLLOWUP_FIELDS, in parts ([{ title, note?, ids, ask?, help? }], see
// detailFieldsFor in config.js). A part with a title is a grey card with the title on top. Big buttons for a list
// (tap again to clear), a number field for a number; one question per line.
// A question with `showIf` (and a part whose questions are all hidden) appears only once a matching answer is
// chosen; hidden answers are not saved. `initial` preselects answers. values() returns { answers } or { error }.
function questions(fields, parts, initial) {
  const chosen = { ...initial };
  const numbers = {};
  const rows = {};
  const titles = [];
  const ids = parts.flatMap((p) => p.ids);
  const shown = (id) => {
    const c = fields[id].showIf;
    return !c || Object.entries(c).some(([q, answers]) => answers.includes(chosen[q]));
  };
  const update = () => {
    for (const id of ids) rows[id].hidden = !shown(id);
    for (const [title, partIds] of titles) title.hidden = !partIds.some(shown);
  };
  const row = (id, part = {}) => {
    const f = fields[id];
    const ask = (part.ask && part.ask[id]) || f.ask || f.label;
    const help = part.help && id in part.help ? part.help[id] : f.help;
    const [tipBtn, tip] = help ? helpTip(ask, help) : [null, null];
    if (f.number) {
      numbers[id] = h('input', {
        type: 'number', inputmode: 'numeric', min: String(f.number.min), max: String(f.number.max), step: '1',
        class: 'num', id: `q-${id}`, value: chosen[id] != null ? String(chosen[id]) : '',
      });
      rows[id] = h('div', { class: 'qrow qnum' },
        h('div', { class: 'qhead' }, h('label', { class: 'qlabel', for: `q-${id}` }, ask), tipBtn), tip,
        h('div', { class: 'numrow' }, numbers[id], f.unit ? h('span', { class: 'muted' }, f.unit) : null));
    } else {
      rows[id] = h('div', { class: 'qrow', role: 'group', 'aria-label': ask },
        h('div', { class: 'qhead' }, h('span', { class: 'qlabel' }, ask), tipBtn), tip,
        choices(f.options, chosen[id] ?? null, (v) => { chosen[id] = v ?? undefined; update(); }));
    }
    return rows[id];
  };
  // The rows of a part, one question per line (number questions too).
  const partRows = (p) => p.ids.map((id) => row(id, p));
  const el = h('div', { class: 'questions' }, parts.map((p) => {
    if (!p.title) return partRows(p);
    // a note about the part (whose Surgical Apgar it is) behind a "?" after the heading, like the questions' help
    const [tipBtn, tip] = p.note ? helpTip(p.title, p.note) : [null, null];
    const card = h('section', { class: 'qcard' },
      h('div', { class: 'qsection-wrap' }, h('div', { class: 'qhead' }, h('h4', { class: 'qsection' }, p.title), tipBtn), tip),
      partRows(p));
    titles.push([card, p.ids]);
    return card;
  }));
  update();
  const values = () => {
    const answers = {};
    for (const id of ids.filter(shown)) {
      const f = fields[id];
      if (f.number) {
        const raw = numbers[id].value.trim();
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < f.number.min || n > f.number.max) return { error: `${f.label}: enter a whole number from ${f.number.min} to ${f.number.max}.` };
        answers[id] = n;
      } else if (chosen[id] != null) answers[id] = chosen[id];
    }
    return { answers };
  };
  // The questions on screen that have no answer, in order.
  const missing = () => ids.filter(shown).filter((id) => (fields[id].number ? !numbers[id].value.trim() : chosen[id] == null));
  const scrollTo = (id) => rows[id].scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  return { el, values, missing, scrollTo };
}

// ---- Progress tab ----------------------------------------------------------

function progressTab() {
  const total = state.entries.length;
  const signed = state.entries.filter((e) => e.sign).length;
  const wk = core.weekEntries(state.entries).length;
  // A white tile per procedure, like the procedures on the New case tab (procedureProgress in ui.js, which an
  // administrator's page of one student shows too). Targets are set by a supervisor and come with the sync.
  return h('section', {},
    h('h2', {}, 'My progress'),
    h('div', { class: 'stats' },
      stat(total, 'cases'), stat(signed, 'signed'), stat(wk, 'this week')),
    procedureProgress(state.entries, state.events, { note: 'Set by your supervisor.', none: 'No targets yet. Your supervisor sets them.' }));
}

// ---- History tab -----------------------------------------------------------

function historyTab() {
  if (!state.entries.length) {
    return h('section', {}, h('h2', {}, 'My history'), h('p', { class: 'muted' }, 'No entries yet. Log your first procedure on the Log tab.'));
  }
  const f = historyFilter;
  const shown = state.entries.filter((e) => (!f.procedure || e.procedure === f.procedure) && (!f.role || e.role === f.role));
  const filtered = f.procedure || f.role;
  return h('section', {},
    h('h2', {}, 'My history'),
    h('div', { class: 'filters' },
      filterButton('Procedure', f.procedure ? procName(f.procedure) : 'All', !!f.procedure, openProcedureFilter),
      filterButton('Role', f.role ? roleDone(f.role, f.procedure) : 'All', !!f.role, openRoleFilter)),
    filtered
      ? h('div', { class: 'shown' },
        h('span', {}, `Showing ${shown.length} of ${state.entries.length}`),
        h('button', { class: 'change', type: 'button', onclick: () => setHistoryFilter({ procedure: null, role: null }) }, 'Show all'))
      : null,
    // A small heading per week it was done ("This week", "Last week", "2 – 8 Nov"), so a long history is easy to scan.
    shown.length
      ? core.byWeek(shown).map((w) => [
        h('h3', { class: 'day-head' }, core.fmtWeek(w.week)),
        h('ul', { class: 'list' }, w.entries.map(entryRow))])
      : h('p', { class: 'muted' }, 'No entries match. Tap "Show all" to see everything.'));
}

// "Show only" in History: one procedure and/or one role. Kept while the app is open, so it survives a sync
// or a visit to another tab; it is cleared when the student logs out.
let historyFilter = { procedure: null, role: null };

function setHistoryFilter(change) {
  historyFilter = { ...historyFilter, ...change };
  closeSheet();
  render();
}

// The buttons and the pop-up are filterButton and openFilterSheet in ui.js (an administrator's Users has one too).
// The counts take the other filter into account.
function openProcedureFilter() {
  const base = state.entries.filter((e) => !historyFilter.role || e.role === historyFilter.role);
  const n = (id) => base.filter((e) => e.procedure === id).length;
  // Only procedures the student has logged, in the same order as on the Log tab.
  const ids = ALL_PROCEDURES.map((p) => p.id).filter((id) => n(id) || id === historyFilter.procedure);
  openFilterSheet('Show only this procedure', [
    { label: 'All procedures', n: base.length, on: !historyFilter.procedure, pick: () => setHistoryFilter({ procedure: null }) },
    ...ids.map((id) => ({ label: procName(id), n: n(id), on: historyFilter.procedure === id, pick: () => setHistoryFilter({ procedure: id }) })),
  ], { tall: ids.length > 6 });
}

function openRoleFilter() {
  const base = state.entries.filter((e) => !historyFilter.procedure || e.procedure === historyFilter.procedure);
  const n = (id) => base.filter((e) => e.role === id).length;
  openFilterSheet('Show only this role', [
    { label: 'All roles', n: base.length, on: !historyFilter.role, pick: () => setHistoryFilter({ role: null }) },
    ...rolesFor(historyFilter.procedure).map((r) => ({ label: r.done, n: n(r.id), on: historyFilter.role === r.id, pick: () => setHistoryFilter({ role: r.id }) })),
  ]);
}

// What a student can do in the case pop-up (openCase in ui.js): delete an unsigned case, add or update the follow-up.
const caseActions = { onDelete: (e) => confirmDelete(e), onFollowUp: (e) => openFollowUp(e) };

// One case in the list (under the heading of its week): only the procedure, your role and the date, whether it is signed and whether it has a
// follow-up. Tapping it opens the whole case in a pop-up (openCase), with the follow-up and Delete.
function entryRow(e) {
  const hasOutcome = Object.keys(e.outcome || {}).length > 0;
  return h('li', {
    class: 'entry tap', role: 'button', tabindex: '0', 'aria-label': `Open ${procName(e.procedure)}, ${core.fmtDate(e.performed_on)}`,
    onclick: () => openCase(e, caseActions),
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openCase(e, caseActions); } },
  },
    h('div', { class: 'e-text' },
      h('strong', {}, procName(e.procedure)),
      h('span', { class: 'e-sub' }, `${roleDone(e.role, e.procedure)} · ${core.fmtDate(e.performed_on)}`)),
    h('div', { class: 'e-tags' },
      hasOutcome ? h('span', { class: 'tag fu' }, 'Follow-up added')
        : core.followUpOpen(e) ? null : h('span', { class: 'tag closed' }, 'Follow-up closed'), // too old to add one
      e.sign ? h('span', { class: 'tag ok' }, 'Signed') : h('span', { class: 'tag warn' }, 'Not signed')));
}

// What happened to the patient afterwards, up to FOLLOWUP_DAYS after the operation. Saved as a new
// 'followup' event; the entry itself never changes. Current answers are preselected.
function openFollowUp(e) {
  const form = questions(FOLLOWUP_FIELDS, followupFieldsFor(e.procedure, e.details), e.outcome); // a baby card only for a baby born alive
  const err = h('p', { class: 'error', role: 'alert' }, '');
  // The heading like the case pop-up's (openCase in ui.js): the procedure, a grey line with your role and the date, the
  // hospital on a line of its own; it stays at the top. A round arrow before it, like on other pages, goes back to the
  // case, on its Follow-up tab, where the form was opened. Then, like a new case, the questions in grey cards and Save.
  const back = h('button', {
    class: 'back-btn', type: 'button', 'aria-label': 'Back to the case', onclick: () => openCase(e, { ...caseActions, tab: 'followup' }),
  });
  openSheet([
    h('div', { class: 'sheet-head fu-head' },
      h('div', { class: 'case-top' }, back,
        h('div', { class: 'case-top-text' },
          h('h3', { class: 'case-title' }, procName(e.procedure)),
          h('p', { class: 'case-sub' }, `${roleDone(e.role, e.procedure)} · ${core.fmtDate(e.performed_on)}`),
          e.hospital ? h('p', { class: 'case-sub case-hosp' }, e.hospital) : null))),
    h('p', { class: 'muted small fu-note' }, 'Tap only what you know now. You can add more later.'),
    form.el,
    err,
    h('div', { class: 'sheet-foot' },
      h('button', {
        class: 'btn save', type: 'button',
        onclick: async () => {
          const v = form.values();
          if (v.error) { err.textContent = v.error; return; }
          const changed = Object.fromEntries(Object.entries(v.answers).filter(([id, a]) => e.outcome[id] !== a));
          if (!Object.keys(changed).length) { err.textContent = 'Nothing new to save. Tap an answer, or go back with the arrow.'; return; }
          closeSheet();
          const ev = await core.addFollowUp(e.id, changed);
          await refresh();
          scheduleSync();
          toast('Follow-up saved', {
            sub: procName(e.procedure),
            action: { label: 'Undo', fn: async () => { await core.voidEntry(ev.id); await refresh(); scheduleSync(); toast('Undone'); } },
          });
        },
      }, 'Save')),
  ]);
}

function confirmDelete(e) {
  openSheet([
    h('h3', {}, 'Delete this case?'),
    h('p', {}, `${procName(e.procedure)} · ${roleDone(e.role, e.procedure)} · ${core.fmtDate(e.performed_on)}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: async () => { closeSheet(); await core.voidEntry(e.id); await refresh(); scheduleSync(); toast('Case deleted'); } }, 'Delete'),
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  ]);
}

// ---- More tab --------------------------------------------------------------
// Laid out like the supervisor's and administrator's More (fact, advancedCard in ui.js).

function moreTab() {
  const n = core.unsyncedCount(state.events, state.sent);
  const m = core.metrics(state.events);
  // The account is shown like the hospital and date when logging: the label in bold, the value under it in plain
  // text. "Change" opens the same hospital menu as when logging.
  const hosp = hospitalPicker(() => refresh());

  return h('section', { class: 'more-tab' },
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Account'),
      h('div', { class: 'facts plain' },
        fact('Candidate number', state.profile.student),
        state.session.name ? fact('Name', state.session.name) : null,
        fact('Hospital', state.profile.hospital, hosp.button, hosp.panel)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: openChangePassword }, 'Change password'),
        h('button', { class: 'btn ghost', onclick: openLogout }, 'Log out'))),
    supervisorsCard(),
    // The things a student rarely needs are folded away, so the first screen stays short and simple.
    advancedCard([
      ['Data on this device', [
        fact('Entries', m.entries_active),
        fact('Waiting to be sent', n),
        fact('Last sync', timeAgo(state.meta.last_sync_at))]],
      ['About', [fact('Version', APP_VERSION), privacyFact('student')]],
    ]));
}

function supervisorsCard() {
  const sups = state.meta.supervisors || [];
  return h('div', { class: 'card' }, h('h3', {}, 'Your supervisors'),
    sups.length
      // the name first and plain, "since …" small and grey under it (a fact row the other way round: the name matters)
      ? h('div', { class: 'facts plain' }, sups.map((s) => h('div', { class: 'fact' },
        h('span', { class: 'fact-text' }, h('strong', {}, s.name), h('span', {}, `since ${core.fmtDate(String(s.since).slice(0, 10))}`)))))
      : h('p', { class: 'muted' }, 'No supervisor has added you yet.'),
    h('p', { class: 'muted small' }, 'These supervisors can see your entries and sign them.'));
}

function openChangePassword() {
  openSheet([
    h('h3', {}, 'Change password'),
    passwordForm({
      forced: false,
      candidate: state.session.candidate,
      token: state.session.token,
      onAuthError: handleAuthError,
      onDone: async () => { closeSheet(); toast('Password changed', { sub: 'Other devices were logged out.' }); },
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
      ? h('p', {}, 'Your entries are safe on the server. They are removed from this device when you log out. Log in again to see them.')
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
  historyFilter = { procedure: null, role: null };
  logPart = 'surgery';
  await refresh();
}

// ---- startup ---------------------------------------------------------------

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated', { sub: 'Close and reopen it to use the new version.', sticky: true });
  });
}

async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist(); // asks Chrome not to clear the logbook when space runs low
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
  // Back on the screen (switched back to the app, screen turned on): sync, so signatures made meanwhile arrive by
  // themselves. Android often keeps the app open in the background, so "the app opens" is not enough.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isStudent(state.session) && !state.session.must_change) scheduleSync();
  });

  state.session = readSession();
  if (isStudent(state.session)) {
    core.useUser(state.session.candidate);
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
