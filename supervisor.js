// supervisor.js — the screens a supervisor sees: their students, the entries waiting for a
// signature, and a list to find more students. Plain JavaScript, no build step.
//
// A supervisor needs internet for everything here. Nothing is stored on the tablet: the list of
// students and their entries are fetched from the server each time, and signing is checked by the server.
// app.js decides when to show this (the logged-in account has the role "supervisor").

import { procName, roleLabel } from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, timeAgo, stat, kv, toast, openSheet, closeSheet, passwordForm,
} from './ui.js';

const ENDED = Symbol('session ended'); // the server ended the session; app.js shows the login screen

// Everything this screen remembers while it is open. Replaced on every new login.
const sv = {
  token: null, tab: 'students',
  students: null, candidates: null, query: '',
  loading: false, error: '',
  detail: null, // { candidate, events, entries, selected:Set, loading, error }
};
let ctx = null; // { root, session, version, onAuthError, onLogout, openChangePassword }

export function mountSupervisor(c) {
  ctx = c;
  if (sv.token !== c.session.token) {
    Object.assign(sv, { token: c.session.token, tab: 'students', students: null, candidates: null, query: '', loading: false, error: '', detail: null });
  }
  paint();
  if (sv.students === null && !sv.loading) loadStudents();
}

// ---- drawing -----------------------------------------------------------------

// Redraw only if the supervisor screen is what is on show: a slow reply must not paint over the login screen.
function draw() {
  if (ctx && ctx.root.querySelector('[data-sv]')) paint();
}

function paint() {
  const y = window.scrollY || 0;
  ctx.root.replaceChildren(h('div', { 'data-sv': '' }, header(), h('div', { class: 'banner' }, `Prototype v${ctx.version} · supervisor`), h('main', { class: 'main' }, body()), nav()));
  if (y) window.scrollTo(0, y);
}

function header() {
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('strong', {}, 'CapaCare logbook'),
      h('span', { class: 'who' }, `Supervisor · ${ctx.session.name || ctx.session.candidate}`)),
    h('button', { class: 'chip ok', onclick: refreshCurrent, 'aria-label': 'Refresh from the server' }, sv.loading ? 'Loading…' : 'Refresh'));
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
  window.scrollTo(0, 0);
  if (id === 'students' && sv.students === null) loadStudents();
  if (id === 'add' && sv.candidates === null) loadCandidates();
  draw();
}

function refreshCurrent() {
  if (sv.detail) loadDetail(sv.detail.candidate);
  else if (sv.tab === 'add') loadCandidates();
  else loadStudents();
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

async function loadDetail(candidate) {
  const d = { candidate, events: [], entries: [], selected: new Set(), loading: true, error: '' };
  sv.detail = d;
  draw();
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
    d.selected = new Set(d.entries.filter((e) => !e.sign).map((e) => e.id)); // everything unsigned is ticked; untick what is wrong
  } catch (e) { d.error = e.message; }
  d.loading = false;
  if (sv.detail === d) draw();
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
      h('button', { class: 'srow', onclick: () => { window.scrollTo(0, 0); loadDetail(s.candidate); } },
        h('span', { class: 'srow-main' },
          h('strong', {}, s.candidate),
          s.name ? h('span', { class: 'small' }, s.name) : null,
          h('span', { class: 'muted small' }, `${s.entries} logged · last update ${timeAgo(s.last_received)}`)),
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

function entryLine(e) {
  return [h('strong', {}, procName(e.procedure)), ` · ${roleLabel(e.role)} · ${core.fmtDate(e.performed_on)}`];
}

function detailView() {
  const d = sv.detail;
  const back = h('button', {
    class: 'link', onclick: () => { sv.detail = null; window.scrollTo(0, 0); loadStudents(); },
  }, '‹ My students');
  if (d.loading) return h('section', {}, back, h('h2', {}, d.candidate), h('p', { class: 'muted' }, 'Loading entries…'));
  if (d.error) return h('section', {}, back, h('h2', {}, d.candidate), h('div', { class: 'card' }, h('p', { class: 'error' }, d.error), h('button', { class: 'btn', onclick: () => loadDetail(d.candidate) }, 'Try again')));

  const unsigned = d.entries.filter((e) => !e.sign);
  const signed = d.entries.filter((e) => e.sign);
  const signBtn = h('button', { class: 'btn wide', onclick: () => confirmSign(d) });
  const updateBtn = () => {
    signBtn.textContent = d.selected.size ? `Sign ${d.selected.size} selected` : 'Select entries to sign';
    signBtn.disabled = d.selected.size === 0;
  };

  const rows = unsigned.map((e) => {
    const box = h('input', { type: 'checkbox', checked: d.selected.has(e.id) });
    box.addEventListener('change', () => { if (box.checked) d.selected.add(e.id); else d.selected.delete(e.id); updateBtn(); });
    return h('label', { class: 'check' }, box,
      h('span', {}, entryLine(e), e.performed_on !== e.entered_on ? h('span', { class: 'tag' }, 'late entry') : null,
        h('span', { class: 'muted small block' }, e.hospital)));
  });
  updateBtn();

  return h('section', {},
    back,
    h('h2', {}, d.candidate),
    nameOf(d.candidate) ? h('p', { class: 'muted' }, nameOf(d.candidate)) : null,
    h('div', { class: 'stats' }, stat(d.entries.length, 'logged'), stat(signed.length, 'signed'), stat(unsigned.length, 'to sign')),
    unsigned.length
      ? h('div', { class: 'card' },
        h('h3', {}, 'Waiting for your signature'),
        h('p', { class: 'muted small' }, 'Untick anything that is not correct. Only sign what you supervised.'),
        h('div', { class: 'signlist' }, rows),
        signBtn)
      : h('p', { class: 'muted' }, d.entries.length ? 'Nothing waiting for a signature.' : 'This student has not logged anything yet.'),
    signed.length ? h('div', { class: 'card' },
      h('h3', {}, 'Signed'),
      h('ul', { class: 'list tight' }, signed.map((e) => h('li', { class: 'entry' },
        h('div', { class: 'e-main' }, h('span', {}, entryLine(e))),
        h('div', { class: 'e-meta' }, h('span', { class: 'tag ok' }, `Signed · ${e.sign.supervisor_name || e.sign.supervisor}`)))))) : null,
    h('button', { class: 'link danger', onclick: () => confirmRemove(d.candidate) }, 'Remove from my students'));
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

function moreView() {
  return h('section', {},
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Account'),
      kv('Staff ID', ctx.session.candidate),
      kv('Name shown to students', ctx.session.name || ctx.session.candidate),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: ctx.openChangePassword }, 'Change password'),
        h('button', { class: 'btn ghost', onclick: confirmLogout }, 'Log out'))),
    h('div', { class: 'card' }, h('h3', {}, 'What you can see'),
      h('p', { class: 'muted' }, 'Only the students you added, and only what is needed to check and sign their procedures: procedure, role, date and hospital. You need internet to use the supervisor screens.')),
    h('div', { class: 'card' }, h('h3', {}, 'About'), kv('Version', ctx.version)));
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
