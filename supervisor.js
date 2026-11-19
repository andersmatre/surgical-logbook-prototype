// supervisor.js — the screens a supervisor sees: their students, the cases waiting for a signature, each
// student's progress and targets, and a list to find more students. Plain JavaScript, no build step.
//
// A supervisor needs internet for everything here. Nothing is stored on the tablet: the list of
// students and their cases are fetched from the server each time, and signing is checked by the server.
// app.js decides when to show this (the logged-in account has the role "supervisor").

import { TARGET_PROCEDURES, MAX_TARGET, procName } from './config.js';
import * as core from './core.js';
import * as api from './api.js';
import {
  h, daysAgo, stat, cases, appShell, pageScroll, setPageScroll, keepTyping, toast, openSheet, closeSheet, confirmSheet, caseRow, fact, privacyFact, advancedCard,
  procedureProgress, segSwitch, showPanel, closePanel,
} from './ui.js';

const ENDED = Symbol('session ended'); // the server ended the session; app.js shows the login screen

// Everything this screen remembers while it is open. Replaced on every new login.
const sv = {
  token: null, tab: 'students',
  students: null, candidates: null, query: '', myQuery: '', // query: the search on Add students; myQuery: on My students
  loading: false, error: '',
  detail: null, // { candidate, events, entries, selected:Set, loading, error }
  detailTab: 'sign', // on a student's page: 'sign', 'signed' or 'progress'
};
let ctx = null; // { root, session, version, onAuthError, onLogout, openChangePassword }

export function mountSupervisor(c) {
  ctx = c;
  if (sv.token !== c.session.token) {
    Object.assign(sv, { token: c.session.token, tab: 'students', students: null, candidates: null, query: '', myQuery: '', loading: false, error: '', detail: null, detailTab: 'sign' });
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

// The page of the tab, and over it, while a student is open, the student's pop-up (showPanel in ui.js), drawn again
// with it. panelTop: the pop-up starts at the top (another student, another tab) instead of where it was scrolled.
let panelTop = false;
function paint() {
  const y = pageScroll();
  const typing = keepTyping(ctx.root);
  ctx.root.replaceChildren(appShell({ 'data-sv': '' }, [header(), nav()], body()));
  if (y) setPageScroll(y);
  if (sv.detail) showPanel({ ...detailView(), label: `Student ${sv.detail.candidate}`, onClose: closeDetail, top: panelTop });
  else closePanel();
  panelTop = false;
  typing();
}

// Back to My students, fetched again for the new counts.
function closeDetail() {
  sv.detail = null;
  loadStudents();
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
    // a student's page is part of My students, so that tab stays chosen there; tapping it goes back to the list
    h('button', { class: 'tab' + (sv.tab === id ? ' on' : ''), onclick: () => goTab(id) },
      label, id === 'students' && waiting > 0 ? h('span', { class: 'badge' }, waiting) : null)));
}

function body() {
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
// supervisor ticked stays ticked (new entries come in unticked, like on opening).
async function loadDetail(candidate, { quiet = false } = {}) {
  const old = quiet && sv.detail && sv.detail.candidate === candidate && !sv.detail.error ? sv.detail : null;
  const d = { candidate, events: [], entries: [], selected: new Set(), loading: true, error: '' };
  if (!old) {
    sv.detail = d;
    panelTop = true;
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
    // nothing is ticked at first: the supervisor ticks what they supervised (or Tick all). Fetched again in the
    // background, what was ticked stays ticked as long as it is still waiting; new entries come in unticked.
    d.selected = new Set(old ? d.entries.filter((e) => !e.sign && old.selected.has(e.id)).map((e) => e.id) : []);
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
      h('p', {}, 'Open "Add students" and add the candidate numbers of the students you supervise. After that you can see their cases and sign them.'),
      h('button', { class: 'btn wide', onclick: () => goTab('add') }, 'Add students'));
  } else {
    // a search like the one on Add students: candidate number or name; the list narrows while typing
    const input = h('input', { type: 'search', placeholder: 'Search candidate number or name', class: 'search', value: sv.myQuery, autocapitalize: 'characters', autocomplete: 'off' });
    const ul = h('ul', { class: 'list' });
    const drawList = () => {
      sv.myQuery = input.value;
      const q = core.normCandidate(input.value);
      const shown = list.filter((s) => s.candidate.includes(q) || (s.name || '').toUpperCase().replace(/\s+/g, '').includes(q));
      ul.replaceChildren(...(shown.length ? shown.map((s) => h('li', {},
        h('button', { class: 'srow', onclick: () => { sv.detailTab = 'sign'; loadDetail(s.candidate); } },
          h('span', { class: 'srow-main' },
            h('strong', {}, s.candidate),
            s.name ? h('span', { class: 'small' }, s.name) : null,
            h('span', { class: 'muted small' }, lastLogged(s))),
          s.unsigned > 0 ? h('span', { class: 'tag warn' }, `${s.unsigned} to sign`) : s.entries ? h('span', { class: 'tag ok' }, 'All signed') : null)))
        : [h('p', { class: 'muted' }, 'None of your students match. Check the candidate number or the name.')]));
    };
    input.addEventListener('input', drawList);
    drawList();
    content = [input, ul];
  }
  return h('section', {}, h('h2', {}, 'My students'), content);
}

// "12 cases · last case logged 3 days ago" (the day the student logged it on their tablet), or just "No cases yet".
const lastLogged = (s) => (s.entries ? `${cases(s.entries)} · last case logged ${daysAgo(s.last_logged)}` : 'No cases yet');

function errorBox() {
  return h('div', { class: 'card' },
    h('p', { class: 'error' }, sv.error),
    h('button', { class: 'btn', onclick: refreshCurrent }, 'Try again'));
}

// ---- one student ----------------------------------------------------------------------

// A student opens in a big pop-up over My students (showPanel in ui.js), laid out like the case pop-up: at the top,
// staying there, the candidate number with the name under it, Remove (red, it asks first) and ×, and under them the
// three tabs; then the numbers and the tab's cases, which scroll; on To sign, Select all and Sign at the bottom.
// Each case is a short row (caseRow in ui.js, shared with an administrator's student); tapping it opens the whole
// case on top, only to read. Returns { head, body, foot } for showPanel.
function detailView() {
  const d = sv.detail;
  const name = nameOf(d.candidate);
  const who = name || d.candidate; // first on the grey line of a case pop-up: whose case it is
  // "Remove student", just "Remove" on a narrow phone so the name has room
  const remove = h('button', { class: 'btn ghost danger', type: 'button', 'aria-label': 'Remove student', onclick: () => confirmRemove(d.candidate) }, 'Remove', h('span', { class: 'wide-only' }, ' student'));
  const head = (tabs) => h('div', { class: 'sheet-head' },
    h('div', { class: 'case-top' },
      h('div', { class: 'case-top-text' }, h('h3', { class: 'case-title' }, d.candidate), name ? h('p', { class: 'case-sub' }, name) : null),
      remove),
    tabs);
  if (d.loading) return { head: head(null), body: h('p', { class: 'muted' }, 'Loading cases…') };
  if (d.error) return { head: head(null), body: h('div', { class: 'card' }, h('p', { class: 'error' }, d.error), h('button', { class: 'btn', onclick: () => loadDetail(d.candidate) }, 'Try again')) };

  const unsigned = d.entries.filter((e) => !e.sign);
  const signed = d.entries.filter((e) => e.sign);
  const signBtn = h('button', { class: 'btn save', type: 'button', onclick: () => confirmSign(d) });
  // "Select all" / "Select none" on a row above the cases (Close and Sign are at the bottom): Select none when
  // everything is selected. A round outlined button, like "Show all" in History.
  const allBtn = h('button', {
    class: 'change', type: 'button',
    onclick: () => {
      const tick = d.selected.size < unsigned.length;
      for (const [id, box] of boxes) { box.checked = tick; if (tick) d.selected.add(id); else d.selected.delete(id); }
      updateBtn();
    },
  });
  const updateBtn = () => {
    signBtn.textContent = d.selected.size ? `Sign ${cases(d.selected.size)}` : 'Select cases to sign';
    signBtn.disabled = d.selected.size === 0;
    allBtn.textContent = d.selected.size < unsigned.length ? 'Select all' : 'Select none';
  };

  const boxes = new Map();
  const rows = unsigned.map((e) => {
    const box = h('input', { type: 'checkbox', checked: d.selected.has(e.id), 'aria-label': `Select ${procName(e.procedure)}, ${core.fmtDate(e.performed_on)}` });
    boxes.set(e.id, box);
    box.addEventListener('change', () => { if (box.checked) d.selected.add(e.id); else d.selected.delete(e.id); updateBtn(); });
    // logged a week or more after the day it was done: worth a second look before signing (the next day is normal)
    const late = core.daysLate(e);
    return caseRow(e, { box, who, tags: late >= core.LATE_DAYS ? h('span', { class: 'tag warn' }, `Logged ${late} days later`) : null });
  });
  updateBtn();

  const none = h('p', { class: 'muted' }, 'This student has not logged anything yet.');
  let action = null;
  const pages = {
    // "N waiting" with Select all, the rows, and Sign at the bottom of the pop-up next to Close
    sign: () => {
      if (!unsigned.length) return d.entries.length ? h('p', { class: 'muted' }, 'Nothing waiting for a signature.') : none;
      action = signBtn;
      return [
        unsigned.length > 1 ? h('div', { class: 'shown select-row' }, h('span', {}, `${cases(unsigned.length)} waiting`), allBtn) : null,
        h('ul', { class: 'list signlist' }, rows),
      ];
    },
    signed: () => (signed.length
      ? h('ul', { class: 'list' }, signed.map((e) => caseRow(e, { who, tags: h('span', { class: 'tag ok' }, `Signed · ${e.sign.supervisor_name || e.sign.supervisor}`) })))
      : d.entries.length ? h('p', { class: 'muted' }, 'Nothing signed yet.') : none),
    progress: () => progressPage(d),
  };

  // To sign, Signed and Progress: a switch whose white button slides to the tab that is tapped (segSwitch in ui.js)
  const tabs = segSwitch('What to show about the student', [['sign', 'To sign'], ['signed', 'Signed'], ['progress', 'Progress']], sv.detailTab, (id) => { sv.detailTab = id; panelTop = true; draw(); });
  const body = [
    h('div', { class: 'stats' }, stat(d.entries.length, 'cases'), stat(signed.length, 'signed'), stat(unsigned.length, 'to sign')),
    (pages[sv.detailTab] || pages.sign)(),
  ];
  return { head: head(tabs), body, action };
}

// ---- progress and targets -------------------------------------------------------------------
// A supervisor sets how many of each procedure a student should perform (as surgeon). The server stores them as
// 'target' events in the student's own events, so the student sees them on Progress after the next sync.

// The student's progress as the student sees it (procedureProgress in ui.js: the procedures with a target, then
// those without one), with "Set targets" / "Change targets" at the top.
function progressPage(d) {
  const any = Object.keys(core.targets(d.events)).length > 0;
  return [
    h('button', { class: 'btn ghost wide set-targets', type: 'button', onclick: () => openTargets(d) }, any ? 'Change targets' : 'Set targets'),
    procedureProgress(d.entries, d.events, { note: 'The student sees these under Progress.', none: 'No targets yet. Set how many of each procedure the student should perform.' }),
  ];
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
      await loadDetail(d.candidate, { quiet: true }); // keeps what is ticked under To sign
    } catch (e) {
      toast('Could not save the targets', { sub: e.message });
    }
  };
  const name = nameOf(d.candidate);
  openSheet([
    h('h3', {}, `Targets for ${d.candidate}`),
    name ? h('p', { class: 'case-sub targets-name' }, name) : null,
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
  confirmSheet({
    title: `Sign ${cases(ids.length)}?`,
    text: `You confirm that you supervised these procedures for ${d.candidate}. Your name is shown to the student next to each signature. A signature cannot be undone.`,
    action: 'Sign', onAction: () => doSign(d, ids),
  });
}

async function doSign(d, ids) {
  closeSheet();
  try {
    const r = await call((t) => api.supSign(t, d.candidate, ids));
    if (r === ENDED) return;
    const skipped = r.skipped.length ? `${r.skipped.length} skipped (already signed or deleted)` : undefined;
    toast(`Signed ${cases(r.signed)}`, { sub: skipped });
    // fetched again in the background: what was unticked stays unticked (it was left out on purpose). The list of
    // students too, for the new counts (the badge on My students); it is kept meanwhile, it has the student's name.
    loadStudents();
    await loadDetail(d.candidate, { quiet: true });
  } catch (e) {
    toast('Could not sign', { sub: e.message });
  }
}

function confirmRemove(candidate) {
  confirmSheet({
    title: `Remove ${candidate}?`,
    text: 'You will no longer see this student’s cases or be able to sign them. Signatures you already made stay. You can add the student again later.',
    action: 'Remove', danger: true,
    onAction: async () => {
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
  });
}

// ---- Add students ---------------------------------------------------------------------

function addView() {
  const list = h('div', { class: 'list' }); // the same list and rows as My students, with Add on the right
  const more = h('p', { class: 'muted small', hidden: true }); // "Showing 40 of 120", under the card
  const input = h('input', { type: 'search', placeholder: 'Search candidate number or name', class: 'search', value: sv.query, autocapitalize: 'characters', autocomplete: 'off' });
  const drawList = () => {
    sv.query = input.value;
    more.hidden = true;
    if (sv.error) { list.replaceChildren(errorBox()); return; }
    if (sv.candidates === null) { list.replaceChildren(h('p', { class: 'muted' }, 'Loading…')); return; }
    const q = core.normCandidate(input.value);
    const all = sv.candidates.filter((c) => !c.mine && (c.candidate.includes(q) || (c.name || '').toUpperCase().replace(/\s+/g, '').includes(q)));
    const shown = all.slice(0, 40);
    list.replaceChildren(
      ...(shown.length
        ? shown.map((c) => h('div', { class: 'addrow' },
          h('span', { class: 'srow-main' }, h('strong', {}, c.candidate), c.name ? h('span', { class: 'small' }, c.name) : null,
            h('span', { class: 'muted small' }, lastLogged(c))),
          h('button', { class: 'btn small', type: 'button', onclick: () => addStudent(c, drawList) }, 'Add')))
        : [h('p', { class: 'muted' }, q ? 'No match. Check the candidate number, or ask CapaCare to create the account.' : 'Every student is already added.')]));
    more.hidden = all.length <= shown.length;
    more.textContent = `Showing ${shown.length} of ${all.length}. Type to narrow down.`;
  };
  input.addEventListener('input', drawList);
  drawList();
  return h('section', {},
    h('h2', {}, 'Add students'),
    input, list, more);
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
  confirmSheet({
    title: 'Log out?', text: 'You will need your candidate number and password to log in again.',
    action: 'Log out', danger: true, onAction: ctx.onLogout,
  });
}
