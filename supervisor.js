// supervisor.js — the screens a supervisor sees: their students, the entries waiting for a
// signature, and a list to find more students. Plain JavaScript, no build step.
//
// A supervisor needs internet for everything here. Nothing is stored on the tablet: the list of
// students and their entries are fetched from the server each time, and signing is checked by the server.
// app.js decides when to show this (the logged-in account has the role "supervisor").

import { TARGET_PROCEDURES, MAX_TARGET, procName, roleDoneBy } from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, cases, appShell, pageScroll, setPageScroll, keepTyping, toast, openSheet, closeSheet, openCase, passwordForm, fact, privacyFact, advancedCard,
} from './ui.js';

const ENDED = Symbol('session ended'); // the server ended the session; app.js shows the login screen

// Everything this screen remembers while it is open. Replaced on every new login.
const sv = {
  token: null, tab: 'students',
  students: null, candidates: null, query: '',
  loading: false, error: '',
  detail: null, // { candidate, events, entries, selected:Set, loading, error }
  detailTab: 'sign', // on a student's page: 'sign', 'signed' or 'targets'
};
let ctx = null; // { root, session, version, onAuthError, onLogout, openChangePassword }

export function mountSupervisor(c) {
  ctx = c;
  if (sv.token !== c.session.token) {
    Object.assign(sv, { token: c.session.token, tab: 'students', students: null, candidates: null, query: '', loading: false, error: '', detail: null, detailTab: 'sign' });
  }
  paint();
  watchVisibility();
  if (sv.students === null && !sv.loading) loadStudents();
}

// ---- drawing -----------------------------------------------------------------

// Redraw only if the supervisor screen is what is on show: a slow reply must not paint over the login screen.
function draw() {
  if (ctx && ctx.root.querySelector('[data-sv]')) paint();
}

function paint() {
  const y = pageScroll();
  const typing = keepTyping(ctx.root);
  ctx.root.replaceChildren(appShell({ 'data-sv': '' }, [header(), nav()], body()));
  if (y) setPageScroll(y);
  typing();
}

function header() {
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('strong', {}, 'CapaCare logbook'),
      h('span', { class: 'who' }, `Supervisor · ${ctx.session.name || ctx.session.candidate}`)));
}

function nav() {
  const waiting = (sv.students || []).reduce((n, s) => n + s.unsigned, 0);
  const tabs = [['students', 'My students'], ['add', 'Add students'], ['more', 'More']];
  return h('nav', { class: 'nav' }, tabs.map(([id, label]) =>
    h('button', { class: 'tab' + (sv.tab === id && !sv.detail ? ' on' : ''), onclick: () => goTab(id) },
      label, id === 'students' && waiting > 0 ? h('span', { class: 'badge' }, waiting) : null)));
}

function body() {
  if (sv.detail) return detailView();
  if (sv.tab === 'add') return addView();
  if (sv.tab === 'more') return moreView();
  return studentsView();
}

function goTab(id) {
  sv.tab = id;
  sv.detail = null;
  setPageScroll(0);
  // fetched again every time, so the list is never old; what was there stays on show until the answer comes
  if (id === 'students') loadStudents();
  if (id === 'add') loadCandidates();
  draw();
}

// There is no Refresh button: each page is fetched when it is opened, and the page on show is fetched again
// when the app comes back on the screen (switched back to, screen turned on), so entries students synced
// meanwhile show up by themselves. Not while a pop-up is open: that would change what it is about.
function refreshCurrent() {
  if (sv.detail) loadDetail(sv.detail.candidate, { quiet: true });
  else if (sv.tab === 'add') loadCandidates();
  else if (sv.tab === 'students') loadStudents();
}

let watching = false;
function watchVisibility() {
  if (watching) return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !ctx || !ctx.root.querySelector('[data-sv]')) return;
    if (document.getElementById('overlay')?.classList.contains('open') || sv.loading || sv.detail?.loading) return;
    refreshCurrent();
  });
}

// ---- talking to the server ---------------------------------------------------------

async function call(fn) {
  try { return await fn(ctx.session.token); }
  catch (e) {
    if (ctx.onAuthError(e)) return ENDED;
    throw e;
  }
}

async function loadStudents() {
  sv.loading = true;
  sv.error = '';
  draw();
  try {
    const r = await call(api.supStudents);
    if (r === ENDED) return;
    sv.students = r.students;
  } catch (e) { sv.error = e.message; }
  sv.loading = false;
  draw();
}

async function loadCandidates() {
  sv.loading = true;
  sv.error = '';
  draw();
  try {
    const r = await call(api.supCandidates);
    if (r === ENDED) return;
    sv.candidates = r.candidates;
  } catch (e) { sv.error = e.message; }
  sv.loading = false;
  draw();
}

const nameOf = (candidate) => ((sv.students || []).find((s) => s.candidate === candidate) || {}).name || null;

// quiet: fetch again in the background; the page on show stays until the answer comes, and what the
// supervisor ticked stays ticked (new entries come in ticked, like on opening).
async function loadDetail(candidate, { quiet = false } = {}) {
  const old = quiet && sv.detail && sv.detail.candidate === candidate && !sv.detail.error ? sv.detail : null;
  const d = { candidate, events: [], entries: [], selected: new Set(), loading: true, error: '' };
  if (!old) {
    sv.detail = d;
    draw();
  }
  let cursor = 0;
  try {
    for (let page = 0; page < 100; page++) {
      const at = cursor;
      const r = await call((t) => api.supEntries(t, candidate, at));
      if (r === ENDED) return;
      d.events.push(...r.events);
      cursor = r.cursor;
      if (!r.has_more) break;
    }
    d.entries = core.derive(d.events);
    // everything unsigned is ticked; untick what is wrong
    const seen = old ? new Set(old.entries.map((e) => e.id)) : new Set();
    d.selected = new Set(d.entries.filter((e) => !e.sign && (!seen.has(e.id) || old.selected.has(e.id))).map((e) => e.id));
  } catch (e) { d.error = e.message; }
  d.loading = false;
  if (old) {
    if (sv.detail !== old || d.error) return; // moved on meanwhile, or no answer: keep what is on show
    sv.detail = d;
    draw();
  } else if (sv.detail === d) draw();
}

// ---- My students ----------------------------------------------------------------------

function studentsView() {
  const list = sv.students;
  let content;
  if (sv.error) content = errorBox();
  else if (list === null) content = h('p', { class: 'muted' }, 'Loading…');
  else if (!list.length) {
    content = h('div', { class: 'card' },
      h('h3', {}, 'No students yet'),
      h('p', {}, 'Open "Add students" and add the candidate numbers of the students you supervise. After that you can see their entries and sign them.'),
      h('button', { class: 'btn wide', onclick: () => goTab('add') }, 'Add students'));
  } else {
    content = h('ul', { class: 'list' }, list.map((s) => h('li', {},
      h('button', { class: 'srow', onclick: () => { setPageScroll(0); sv.detailTab = 'sign'; loadDetail(s.candidate); } },
        h('span', { class: 'srow-main' },
          h('strong', {}, s.candidate),
          s.name ? h('span', { class: 'small' }, s.name) : null,
          h('span', { class: 'muted small' }, `${cases(s.entries)} · last update ${timeAgo(s.last_received)}`)),
        s.unsigned > 0 ? h('span', { class: 'tag warn' }, `${s.unsigned} to sign`) : h('span', { class: 'tag ok' }, 'all signed')))));
  }
  return h('section', {}, h('h2', {}, 'My students'), content);
}

function errorBox() {
  return h('div', { class: 'card' },
    h('p', { class: 'error' }, sv.error),
    h('button', { class: 'btn', onclick: refreshCurrent }, 'Try again'));
}

// ---- one student ----------------------------------------------------------------------

// One case as a short row, like in the student's History: the procedure, under it the role and the date, tags on the
// right. Tapping it opens the whole case in the same pop-up the student sees (openCase in ui.js), only to read.
// box: a tick box on the left (To sign); tapping the box ticks, it does not open the case.
function caseRow(e, { box = null, tags = [] } = {}) {
  const open = () => openCase(e, { roleText: roleDoneBy }); // the role about the student: "Operated alone"
  return h('li', {
    class: box ? 'entry tap has-box' : 'entry tap', role: 'button', tabindex: '0',
    'aria-label': `Open ${procName(e.procedure)}, ${core.fmtDate(e.performed_on)}`,
    onclick: open,
    onkeydown: (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(); } },
  },
    box ? h('label', { class: 'pick', onclick: (ev) => ev.stopPropagation() }, box) : null,
    h('div', { class: 'e-text' },
      h('strong', {}, procName(e.procedure)),
      h('span', { class: 'e-sub' }, `${roleDoneBy(e.role, e.procedure)} · ${core.fmtDate(e.performed_on)}`)),
    h('div', { class: 'e-tags' },
      Object.keys(e.outcome || {}).length ? h('span', { class: 'tag fu' }, 'Follow-up added') : null,
      tags));
}

function detailView() {
  const d = sv.detail;
  const back = h('button', {
    class: 'btn ghost', onclick: () => { sv.detail = null; setPageScroll(0); loadStudents(); },
  }, '‹ My students');
  if (d.loading) return h('section', {}, back, h('h2', {}, d.candidate), h('p', { class: 'muted' }, 'Loading entries…'));
  if (d.error) return h('section', {}, back, h('h2', {}, d.candidate), h('div', { class: 'card' }, h('p', { class: 'error' }, d.error), h('button', { class: 'btn', onclick: () => loadDetail(d.candidate) }, 'Try again')));

  const unsigned = d.entries.filter((e) => !e.sign);
  const signed = d.entries.filter((e) => e.sign);
  const signBtn = h('button', { class: 'btn', onclick: () => confirmSign(d) });
  // "Tick all" / "Untick all" in the bar at the bottom, next to Sign: Untick all when everything is ticked
  const allBtn = h('button', {
    class: 'btn ghost', type: 'button',
    onclick: () => {
      const tick = d.selected.size < unsigned.length;
      for (const [id, box] of boxes) { box.checked = tick; if (tick) d.selected.add(id); else d.selected.delete(id); }
      updateBtn();
    },
  });
  const updateBtn = () => {
    signBtn.textContent = d.selected.size ? `Sign ${d.selected.size} selected` : 'Select entries to sign';
    signBtn.disabled = d.selected.size === 0;
    allBtn.textContent = d.selected.size < unsigned.length ? 'Tick all' : 'Untick all';
  };

  const boxes = new Map();
  const rows = unsigned.map((e) => {
    const box = h('input', { type: 'checkbox', checked: d.selected.has(e.id), 'aria-label': `Sign ${procName(e.procedure)}, ${core.fmtDate(e.performed_on)}` });
    boxes.set(e.id, box);
    box.addEventListener('change', () => { if (box.checked) d.selected.add(e.id); else d.selected.delete(e.id); updateBtn(); });
    // logged later than the day it was done: worth a second look before signing
    return caseRow(e, { box, tags: e.performed_on !== e.entered_on ? h('span', { class: 'tag warn' }, 'Logged late') : null });
  });
  updateBtn();

  const none = h('p', { class: 'muted' }, 'This student has not logged anything yet.');
  const pages = {
    // the rows, then the Sign button in a bar that stays at the bottom of the screen while the list scrolls
    sign: () => (unsigned.length
      ? [h('ul', { class: 'list signlist' }, rows),
        h('div', { class: 'sign-bar' }, unsigned.length > 1 ? allBtn : null, signBtn)]
      : d.entries.length ? h('p', { class: 'muted' }, 'Nothing waiting for a signature.') : none),
    signed: () => (signed.length
      ? h('ul', { class: 'list' }, signed.map((e) => caseRow(e, { tags: h('span', { class: 'tag ok' }, `Signed · ${e.sign.supervisor_name || e.sign.supervisor}`) })))
      : d.entries.length ? h('p', { class: 'muted' }, 'Nothing signed yet.') : none),
    targets: () => targetsCard(d),
  };
  // To sign, Signed and Targets: a switch like Surgery and Delivery on the student's New case tab
  const tab = (id, label) => h('button', {
    class: sv.detailTab === id ? 'ctab on' : 'ctab', type: 'button', role: 'tab', 'aria-selected': String(sv.detailTab === id),
    onclick: () => { if (sv.detailTab !== id) { sv.detailTab = id; draw(); } },
  }, label);

  return h('section', {},
    // back on the left, Remove on the right in red (it asks first); outlined buttons like Change password and Log out
    h('div', { class: 'detail-top' }, back,
      h('button', { class: 'btn ghost danger', onclick: () => confirmRemove(d.candidate) }, 'Remove student')),
    h('h2', {}, d.candidate),
    nameOf(d.candidate) ? h('p', { class: 'muted detail-name' }, nameOf(d.candidate)) : null,
    h('div', { class: 'stats' }, stat(d.entries.length, 'cases'), stat(signed.length, 'signed'), stat(unsigned.length, 'to sign')),
    h('div', { class: 'ctabs log-parts', role: 'tablist', 'aria-label': 'What to show' },
      tab('sign', 'To sign'), tab('signed', 'Signed'), tab('targets', 'Targets')),
    (pages[sv.detailTab] || pages.sign)());
}

// ---- targets ---------------------------------------------------------------------------
// A supervisor sets how many of each procedure a student should perform (as surgeon). The server stores them as
// 'target' events in the student's own events, so the student sees them on Progress after the next sync.

function targetsCard(d) {
  const targets = core.targets(d.events);
  const prog = core.progress(d.entries);
  const ids = TARGET_PROCEDURES.map((p) => p.id).filter((id) => id in targets);
  return h('div', { class: 'card' },
    h('h3', {}, 'Targets'),
    ids.length
      ? [h('p', { class: 'muted small' }, 'The student sees these under Progress.'),
        ids.map((id) => h('div', { class: 'orow' }, h('span', {}, procName(id)), h('span', {}, `${(prog[id] || { performed: 0 }).performed} / ${targets[id]}`)))]
      : h('p', { class: 'muted' }, 'No targets yet. Set how many of each procedure the student should perform.'),
    h('button', { class: 'btn ghost wide', type: 'button', onclick: () => openTargets(d) }, ids.length ? 'Change targets' : 'Set targets'));
}

// A pop-up with every procedure and a number field for each, the current targets filled in. Empty (or 0) is no
// target. A search narrows the list. Save sends only what changed.
function openTargets(d) {
  const now = core.targets(d.events);
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const fields = new Map();
  const rows = TARGET_PROCEDURES.map((p) => {
    const input = h('input', {
      type: 'number', inputmode: 'numeric', min: '0', max: String(MAX_TARGET), step: '1', class: 'num', id: `t-${p.id}`,
      value: now[p.id] ? String(now[p.id]) : '', placeholder: '–',
    });
    fields.set(p.id, input);
    return h('div', { class: 'trow', 'data-name': p.name.toLowerCase() }, h('label', { for: `t-${p.id}` }, p.name), input);
  });
  const search = h('input', { type: 'text', class: 'search', placeholder: 'Find a procedure', 'aria-label': 'Find a procedure', autocomplete: 'off' });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const r of rows) r.hidden = !!q && !r.dataset.name.includes(q);
  });
  const save = async () => {
    const changes = {};
    for (const [id, input] of fields) {
      const v = input.value.trim();
      const n = v === '' ? 0 : Number(v);
      if (!Number.isInteger(n) || n < 0 || n > MAX_TARGET) {
        err.textContent = `Type a whole number from 0 to ${MAX_TARGET}, or leave it empty.`;
        search.value = ''; for (const r of rows) r.hidden = false;
        input.focus();
        return;
      }
      if (n !== (now[id] || 0)) changes[id] = n;
    }
    if (!Object.keys(changes).length) { err.textContent = 'Nothing changed. Type a number, or Cancel.'; return; }
    closeSheet();
    try {
      const r = await call((t) => api.supTargets(t, d.candidate, changes));
      if (r === ENDED) return;
      toast('Targets saved', { sub: `The student sees them under Progress after the next sync.` });
      await loadDetail(d.candidate);
    } catch (e) {
      toast('Could not save the targets', { sub: e.message });
    }
  };
  openSheet([
    h('h3', {}, `Targets for ${d.candidate}`),
    h('p', { class: 'muted' }, 'How many of each procedure the student should perform as surgeon. Leave empty for no target.'),
    search,
    h('div', { class: 'tlist' }, rows),
    err,
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'btn save', type: 'button', onclick: save }, 'Save')),
  ]);
}

function confirmSign(d) {
  const ids = [...d.selected];
  if (!ids.length) return;
  openSheet([
    h('h3', {}, `Sign ${ids.length} entr${ids.length > 1 ? 'ies' : 'y'}?`),
    h('p', {}, `You confirm that you supervised these procedures for ${d.candidate}. Your name is shown to the student next to each signature. A signature cannot be undone.`),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => doSign(d, ids) }, 'Sign'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel')),
  ]);
}

async function doSign(d, ids) {
  closeSheet();
  try {
    const r = await call((t) => api.supSign(t, d.candidate, ids));
    if (r === ENDED) return;
    const skipped = r.skipped.length ? `${r.skipped.length} skipped (already signed or deleted)` : undefined;
    toast(`Signed ${r.signed} entr${r.signed === 1 ? 'y' : 'ies'}`, { sub: skipped });
    sv.students = null; // counts changed
    await loadDetail(d.candidate);
  } catch (e) {
    toast('Could not sign', { sub: e.message });
  }
}

function confirmRemove(candidate) {
  openSheet([
    h('h3', {}, `Remove ${candidate}?`),
    h('p', {}, 'You will no longer see this student’s entries or be able to sign them. Signatures you already made stay. You can add the student again later.'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          closeSheet();
          try {
            const r = await call((t) => api.supUnassign(t, candidate));
            if (r === ENDED) return;
            sv.students = null;
            sv.candidates = null;
            sv.detail = null;
            toast('Removed', { sub: candidate });
            loadStudents();
          } catch (e) { toast('Could not remove', { sub: e.message }); }
        },
      }, 'Remove'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel')),
  ]);
}

// ---- Add students ---------------------------------------------------------------------

function addView() {
  const list = h('div', { class: 'plist' });
  const input = h('input', { type: 'search', placeholder: 'Search candidate number or name', class: 'search', value: sv.query, autocapitalize: 'characters', autocomplete: 'off' });
  const drawList = () => {
    sv.query = input.value;
    if (sv.error) { list.replaceChildren(errorBox()); return; }
    if (sv.candidates === null) { list.replaceChildren(h('p', { class: 'muted' }, 'Loading…')); return; }
    const q = core.normCandidate(input.value);
    const all = sv.candidates.filter((c) => !c.mine && (c.candidate.includes(q) || (c.name || '').toUpperCase().replace(/\s+/g, '').includes(q)));
    const shown = all.slice(0, 40);
    list.replaceChildren(
      ...(shown.length
        ? shown.map((c) => h('div', { class: 'addrow' },
          h('span', { class: 'srow-main' }, h('strong', {}, c.candidate), c.name ? h('span', { class: 'small' }, c.name) : null),
          h('button', { class: 'btn small', type: 'button', onclick: () => addStudent(c, drawList) }, 'Add')))
        : [h('p', { class: 'muted' }, q ? 'No match. Check the candidate number, or ask CapaCare to create the account.' : 'Every student is already added.')]),
      ...(all.length > shown.length ? [h('p', { class: 'muted small' }, `Showing ${shown.length} of ${all.length}. Type to narrow down.`)] : []),
    );
  };
  input.addEventListener('input', drawList);
  drawList();
  return h('section', {},
    h('h2', {}, 'Add students'),
    h('p', { class: 'muted' }, 'Add the students you supervise. Then you can see their entries and sign them. The student sees your name under "Your supervisors", so nobody is added in secret.'),
    input, list);
}

async function addStudent(c, drawList) {
  try {
    const r = await call((t) => api.supAssign(t, c.candidate));
    if (r === ENDED) return;
    c.mine = true;
    sv.students = null; // reload the list next time it is shown
    toast('Added', { sub: `${c.candidate} is now one of your students.` });
    drawList();
  } catch (e) { toast('Could not add', { sub: e.message }); }
}

// ---- More -----------------------------------------------------------------------------

// Laid out like the student's More (fact, advancedCard in ui.js).
function moreView() {
  return h('section', { class: 'more-tab' },
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Account'),
      h('div', { class: 'facts plain' },
        fact('Candidate number', ctx.session.candidate),
        fact('Name shown to students', ctx.session.name || ctx.session.candidate)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: ctx.openChangePassword }, 'Change password'),
        h('button', { class: 'btn ghost', onclick: confirmLogout }, 'Log out'))),
    advancedCard([['About', [fact('Version', ctx.version), privacyFact('supervisor')]]]));
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
