// app.js — the student app, and the entry point that decides what to show.
// Screens: login, choose-password, hospital, then Log / Progress / History / More.
// A supervisor account gets the screens in supervisor.js, an administrator those in administrator.js.
// Plain JavaScript, no build step. Shared interface pieces live in ui.js.

import {
  PROCEDURE_GROUPS, PROCEDURES, ALL_PROCEDURES, LOG_SURGERY, LOG_DELIVERIES, TARGETS, TARGETS_ARE_PLACEHOLDER,
  HOSPITALS, APP_VERSION, DETAIL_FIELDS, FOLLOWUP_FIELDS, findProcedure, procName, rolesFor, roleDone, detailFieldsFor, followupFieldsFor, surgicalApgar, answerLabel,
} from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, kv, cases, initUi, toast, hideToast, openSheet, closeSheet, confirmOver, scrollHint, passwordForm, openPrivacy, privacyCard,
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
    h('div', { class: 'sticky-top' }, header(), nav()),
    h('div', { class: 'banner' }, `Prototype v${APP_VERSION} · never type patient names or numbers`),
    h('main', { class: 'main' }, tabContent()),
  );
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
    h('button', { class: 'tab' + (state.tab === id ? ' on' : ''), onclick: () => { state.tab = id; render(); window.scrollTo(0, 0); } }, label)));
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
    form,
    // Everyone (students, supervisors, administrators) passes this screen once: tell them what is stored.
    h('button', { class: 'btn ghost wide pv-link', type: 'button', onclick: openPrivacy }, 'How your data is used'));
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
  // First Surgery or Delivery, like CapaCare's two logbooks; then that part's procedures in two even columns (one
  // on a phone). Every row looks the same: the name, how many, and a "+" that says "add".
  const button = (p) => h('button', { class: 'proc', onclick: () => openEntrySheet(p) },
    h('span', { class: 'proc-text' },
      h('span', { class: 'proc-name' }, p.name),
      h('span', { class: 'proc-count' }, cases(counts[p.id] || 0))),
    h('span', { class: 'proc-add', 'aria-hidden': 'true' }));
  const parts = choices([['surgery', 'Surgery', 'An operation'], ['delivery', 'Delivery', 'A birth you took part in']],
    logPart, (v) => { logPart = v; render(); }, { required: true, wide: true });
  return h('section', {},
    h('h2', { class: 'log-title' }, 'What did you do?'),
    h('div', { class: 'log-parts', role: 'group', 'aria-label': 'Surgery or delivery' }, parts),
    logPart === 'surgery' ? [
      h('p', { class: 'muted log-hint' }, 'Tap the operation to add it.'),
      h('div', { class: 'grid' }, LOG_SURGERY.map(findProcedure).map(button)),
      h('button', { class: 'proc proc-more', onclick: openMoreProcedures },
        h('span', { class: 'proc-text' },
          h('span', { class: 'proc-name' }, 'More operations'),
          h('span', { class: 'proc-count' }, 'Not in the list above? Find it here.')),
        h('span', { class: 'proc-add more', 'aria-hidden': 'true' })),
    ] : null,
    logPart === 'delivery' ? [
      h('p', { class: 'muted log-hint' }, 'Tap how the baby was born to add it.'),
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

// The hospital menu that "Change" opens: a white box over the page, under the button, with a search field and one
// button per hospital, the current one marked. One tap chooses. Plain buttons, because a phone's own list (a wheel
// on the iPhone) is slow and needs a second step. It closes with its × button, "Change" again, Escape or a tap
// outside it. Returns the "Change" button and the menu: put both in one element with position: relative
// (.fact). onPick gets the chosen name.
function hospitalPicker(onPick) {
  const search = h('input', { type: 'text', class: 'search', placeholder: 'Search hospital', 'aria-label': 'Search hospital', autocomplete: 'off' });
  const list = h('div', { class: 'hlist' });
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
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = HOSPITALS.filter((x) => x.toLowerCase().includes(q)).map((x) => h('button', {
      class: x === state.profile.hospital ? 'row-btn opt on' : 'row-btn opt', type: 'button',
      onclick: async () => { close(); await core.setMeta('hospital', x); state.profile.hospital = x; onPick(x); },
    }, x));
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted' }, 'No match. Choose "Other".')]));
  };
  search.addEventListener('input', draw);
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
  const t0 = performance.now();
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
  const roleGroup = choices(roles.map((r) => [r.id, r.label, r.hint]), null, (v) => { role = roles.find((r) => r.id === v); showSave(); }, { required: true, wide: true });
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
    const ms = performance.now() - t0;
    closeSheet();
    const ev = await core.logEntry({
      student: state.profile.student, hospital: state.profile.hospital,
      procedure: proc.id, role: role.id, performed_on: date, ms_to_log: ms, online: state.online, details: v.answers,
    });
    await refresh();
    scheduleSync();
    const p = core.progress(state.entries)[proc.id] || { performed: 0, total: 0 };
    const target = TARGETS[proc.id];
    toast(`Saved · ${role.label}`, {
      sub: target ? `${proc.name}: ${p.performed} of ${target} performed` : `${proc.name}: ${cases(p.total)}`,
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
function choices(options, initial, onChange, { required = false, wide = false } = {}) {
  let chosen = initial;
  const three = !wide && options.length === 3 && options.every(([, label]) => label.length <= 9);
  const wrap = h('div', { class: 'choices' + (wide ? ' wide' : three ? ' three' : '') });
  const paint = () => {
    for (const b of wrap.children) {
      const on = b.dataset.value === chosen;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  wrap.append(...options.map(([v, label, hint]) => h('button', {
    class: 'choice', type: 'button', 'data-value': v,
    onclick: () => { chosen = chosen === v && !required ? null : v; paint(); onChange(chosen); },
  }, h('strong', {}, label), hint ? h('span', {}, hint) : null)));
  paint();
  return wrap;
}

// Questions from DETAIL_FIELDS or FOLLOWUP_FIELDS, in parts ([{ title, note?, ids, ask?, help? }], see
// detailFieldsFor in config.js). A part with a title is a grey card with the title on top. Big buttons for a list
// (tap again to clear), a number field for a number; number questions that follow each other sit side by side.
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
    const helpEl = help ? h('span', { class: 'qhelp' }, help) : null;
    if (f.number) {
      numbers[id] = h('input', {
        type: 'number', inputmode: 'numeric', min: String(f.number.min), max: String(f.number.max), step: '1',
        class: 'num', id: `q-${id}`, value: chosen[id] != null ? String(chosen[id]) : '',
      });
      rows[id] = h('div', { class: 'qrow qnum' },
        h('label', { class: 'qlabel', for: `q-${id}` }, ask), helpEl,
        h('div', { class: 'numrow' }, numbers[id], f.unit ? h('span', { class: 'muted' }, f.unit) : null));
    } else {
      rows[id] = h('div', { class: 'qrow', role: 'group', 'aria-label': ask },
        h('span', { class: 'qlabel' }, ask), helpEl,
        choices(f.options, chosen[id] ?? null, (v) => { chosen[id] = v ?? undefined; update(); }));
    }
    return rows[id];
  };
  // The rows of a part, with number questions that follow each other put together in one grid.
  const partRows = (p) => {
    const out = [];
    for (const id of p.ids) {
      const r = row(id, p);
      if (!fields[id].number) { out.push(r); continue; }
      const last = out[out.length - 1];
      if (last && last.classList.contains('numgrid')) last.append(r);
      else out.push(h('div', { class: 'numgrid' }, r));
    }
    return out;
  };
  const el = h('div', { class: 'questions' }, parts.map((p) => {
    if (!p.title) return partRows(p);
    const card = h('section', { class: 'qcard' },
      h('h4', { class: 'qsection' }, p.title), p.note ? h('p', { class: 'qnote' }, p.note) : null, partRows(p));
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
  const prog = core.progress(state.entries);
  const total = state.entries.length;
  const signed = state.entries.filter((e) => e.sign).length;
  const wk = core.weekEntries(state.entries).length;
  const text = core.weeklySummary(state.entries, { student: state.profile.student });
  const others = Object.entries(prog).filter(([id]) => !(id in TARGETS));

  return h('section', {},
    h('h2', {}, 'My progress'),
    h('div', { class: 'stats' },
      stat(total, 'cases'), stat(signed, 'signed'), stat(wk, 'this week')),
    h('div', { class: 'card' },
      Object.entries(TARGETS).map(([id, t]) => {
        const p = { id, name: procName(id) };
        const pr = prog[id] || { performed: 0, assisting: 0, observing: 0 };
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
    shown.length
      ? h('ul', { class: 'list' }, shown.map(entryRow))
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

function filterButton(label, value, on, onclick) {
  return h('button', { class: 'filter' + (on ? ' on' : ''), type: 'button', onclick },
    h('span', { class: 'filter-text' }, h('span', {}, label), h('strong', {}, value)));
}

// A pop-up with one big row per choice and how many entries it has. The counts take the other filter into account.
function openFilterSheet(title, options, { tall = false } = {}) {
  openSheet([
    h('h3', {}, title),
    h('div', { class: 'plist' }, options.map((o) => h('button', {
      class: 'row-btn opt' + (o.on ? ' on' : ''), type: 'button', onclick: () => setHistoryFilter(o.change),
    }, h('span', {}, o.label), h('span', { class: 'opt-n' }, String(o.n))))),
    h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Cancel'),
  ], { tall });
}

function openProcedureFilter() {
  const base = state.entries.filter((e) => !historyFilter.role || e.role === historyFilter.role);
  const n = (id) => base.filter((e) => e.procedure === id).length;
  // Only procedures the student has logged, in the same order as on the Log tab.
  const ids = ALL_PROCEDURES.map((p) => p.id).filter((id) => n(id) || id === historyFilter.procedure);
  openFilterSheet('Show only this procedure', [
    { label: 'All procedures', n: base.length, on: !historyFilter.procedure, change: { procedure: null } },
    ...ids.map((id) => ({ label: procName(id), n: n(id), on: historyFilter.procedure === id, change: { procedure: id } })),
  ], { tall: ids.length > 6 });
}

function openRoleFilter() {
  const base = state.entries.filter((e) => !historyFilter.procedure || e.procedure === historyFilter.procedure);
  const n = (id) => base.filter((e) => e.role === id).length;
  openFilterSheet('Show only this role', [
    { label: 'All roles', n: base.length, on: !historyFilter.role, change: { role: null } },
    ...rolesFor(historyFilter.procedure).map((r) => ({ label: r.done, n: n(r.id), on: historyFilter.role === r.id, change: { role: r.id } })),
  ]);
}

// A case from History in a pop-up: one calm table. Under the title the date and hospital; then parts with a small
// heading (Case, then the parts of the form, then Follow-up) and a row per answered question: the question on the
// left, the answer on the right. Changing it is not possible (the log only grows); a follow-up can be added and an
// unsigned entry deleted from here, with the buttons at the bottom next to Close.
function openCase(e) {
  const row = (label, value) => h('div', { class: 'case-row' }, h('span', {}, label), h('span', {}, value));
  const part = (title, rows) => (rows.length ? h('section', { class: 'case-part' }, h('h4', {}, title), rows) : null);
  // The answers in the parts of the form; an answer to a question no longer asked comes last, under "Other".
  const parts = (fields, list, answers, fallbackTitle, extra = {}) => {
    const has = (id) => answers && answers[id] != null;
    const asked = new Set(list.flatMap((p) => p.ids));
    const rest = Object.keys(fields).filter((id) => has(id) && !asked.has(id));
    return [...list, ...(rest.length ? [{ title: 'Other', ids: rest }] : [])].map((p) => part(p.title || fallbackTitle, [
      ...p.ids.filter(has).map((id) => row((p.ask && p.ask[id]) || fields[id].ask || fields[id].label, answerLabel(fields, id, answers[id]))),
      ...(extra[p.title] && p.ids.some(has) ? [extra[p.title]] : []),
    ]));
  };
  const apgar = surgicalApgar(e.details);
  const late = e.performed_on !== e.entered_on;
  const canFollowUp = core.followUpOpen(e);
  const hasOutcome = Object.keys(e.outcome || {}).length > 0;
  const details = parts(DETAIL_FIELDS, detailFieldsFor(e.procedure), e.details, 'Details',
    apgar == null ? {} : { 'Surgical Apgar': row('Score', `${apgar} of 10`) }).filter(Boolean);
  const followUp = parts(FOLLOWUP_FIELDS, followupFieldsFor(e.procedure), e.outcome, 'Follow-up').filter(Boolean);

  openSheet([
    h('div', { class: 'sheet-head' }, // stays at the top while the case scrolls
      h('h3', { class: 'case-title' }, procName(e.procedure)),
      h('p', { class: 'case-sub' }, [core.fmtDate(e.performed_on), e.hospital].filter(Boolean).join(' · '))),
    part('Case', [
      row('Your role', roleDone(e.role, e.procedure)),
      row('Signature', e.sign
        ? `Signed by ${e.sign.supervisor_name || e.sign.supervisor}${e.sign.ts ? ` on ${core.fmtDate(String(e.sign.ts).slice(0, 10))}` : ''}`
        : 'Not signed yet'),
      late ? row('Logged', `${core.fmtDate(e.entered_on)} (later)`) : null,
    ].filter(Boolean)),
    details.length ? details : part('Details', [h('p', { class: 'muted' }, 'No details were filled in.')]),
    followUp.length ? followUp : part('Follow-up', [h('p', { class: 'muted' }, canFollowUp ? 'No follow-up yet.' : 'No follow-up was added.')]),
    h('div', { class: 'sheet-foot case-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Close'),
      canFollowUp ? h('button', { class: 'btn save', type: 'button', onclick: () => openFollowUp(e) }, hasOutcome ? 'Update follow-up' : 'Add follow-up') : null,
      e.sign ? null : h('button', { class: 'btn ghost danger', type: 'button', onclick: () => confirmDelete(e) }, 'Delete')),
  ]);
}

// One case in the list: only the procedure, your role and the date, and whether it is signed. Tapping it opens
// the whole case in a pop-up (openCase), with the follow-up and Delete.
function entryRow(e) {
  return h('li', {
    class: 'entry tap', role: 'button', tabindex: '0', 'aria-label': `Open ${procName(e.procedure)}, ${core.fmtDate(e.performed_on)}`,
    onclick: () => openCase(e),
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openCase(e); } },
  },
    h('div', { class: 'e-text' },
      h('strong', {}, procName(e.procedure)),
      h('span', { class: 'e-sub' }, `${roleDone(e.role, e.procedure)} · ${core.fmtDate(e.performed_on)}`)),
    e.sign ? h('span', { class: 'tag ok' }, 'Signed') : h('span', { class: 'tag warn' }, 'Not signed'));
}

// What happened to the patient afterwards, up to FOLLOWUP_DAYS after the operation. Saved as a new
// 'followup' event; the entry itself never changes. Current answers are preselected.
function openFollowUp(e) {
  const form = questions(FOLLOWUP_FIELDS, followupFieldsFor(e.procedure), e.outcome);
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const days = core.daysBetween(e.performed_on, core.localDateISO());
  openSheet([
    h('h3', {}, 'Follow-up'),
    h('p', {}, h('strong', {}, procName(e.procedure)), ` · ${core.fmtDate(e.performed_on)} (${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`})`),
    h('p', { class: 'muted' }, 'What do you know now? Tap only what you know. You can add more later.'),
    form.el,
    err,
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel'),
      h('button', {
        class: 'btn save', type: 'button',
        onclick: async () => {
          const v = form.values();
          if (v.error) { err.textContent = v.error; return; }
          const changed = Object.fromEntries(Object.entries(v.answers).filter(([id, a]) => e.outcome[id] !== a));
          if (!Object.keys(changed).length) { err.textContent = 'Nothing new to save. Tap an answer, or Cancel.'; return; }
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
    h('h3', {}, 'Delete this entry?'),
    h('p', {}, `${procName(e.procedure)} · ${roleDone(e.role, e.procedure)} · ${core.fmtDate(e.performed_on)}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: async () => { closeSheet(); await core.voidEntry(e.id); await refresh(); scheduleSync(); toast('Entry deleted'); } }, 'Delete'),
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  ]);
}

// ---- More tab --------------------------------------------------------------

// Whether the "Advanced" part of the More tab is open. Kept here so that tapping "Sync now" (which redraws the tab) does not fold it shut.
let advancedOpen = false;

// A row like the hospital and date when logging: the label in bold, the value under it in plain text, and
// anything else (a "Change" button) on the right.
const fact = (label, value, ...extra) => h('div', { class: 'fact' }, h('span', { class: 'fact-text' }, h('span', {}, label), h('strong', {}, value)), ...extra);

function moreTab() {
  const n = core.unsyncedCount(state.events, state.sent);
  const m = core.metrics(state.events, state.meta);
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
    privacyCard(),
    // The things a student rarely needs are folded away, so the first screen stays short and simple.
    h('details', { class: 'card advanced', open: advancedOpen, ontoggle: (ev) => { advancedOpen = ev.target.open; } },
      h('summary', {}, h('span', { class: 'fold-title' }, h('strong', {}, 'Advanced'), h('span', { class: 'muted small' }, 'Sync now, export, app details'))),
      h('h3', {}, 'Data on this tablet'),
      kv('Entries', m.entries_active),
      kv('Waiting to be sent', n),
      kv('Last sync', timeAgo(state.meta.last_sync_at)),
      kv('Works offline', state.swReady ? 'yes' : 'not yet'),
      kv('Storage protected', state.meta.persisted === true ? 'yes' : state.meta.persisted === false ? 'no' : 'unknown'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => doSync(true) }, 'Sync now'),
        h('button', { class: 'btn ghost', onclick: exportData }, 'Export test data')),
      h('p', { class: 'muted small' }, 'Entries are sent to the server automatically when there is internet. "Export test data" saves a file you can send on WhatsApp.'),
      h('h3', {}, 'About'), kv('Version', APP_VERSION), kv('Server', api.serverLabel())));
}

function supervisorsCard() {
  const sups = state.meta.supervisors || [];
  return h('div', { class: 'card' }, h('h3', {}, 'Your supervisors'),
    sups.length
      ? h('div', { class: 'facts plain' }, sups.map((s) => fact(s.name, `since ${core.fmtDate(String(s.since).slice(0, 10))}`)))
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
  historyFilter = { procedure: null, role: null };
  logPart = 'surgery';
  await refresh();
}

async function exportData() {
  const payload = core.buildExport(state.events, { ...state.meta, profile: state.profile });
  const name = `logbook-test-data-${core.localDateISO()}.json`; // no candidate number: the file identifies nobody
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
