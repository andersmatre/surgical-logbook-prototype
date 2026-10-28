// app.js — user interface. Plain JavaScript, no build step.
// Screens: setup, Log, Progress, History, More. Sheets (modals) live in #overlay.

import {
  PROCEDURES_TOP, PROCEDURES_OTHER, ROLES, TARGETS, TARGETS_ARE_PLACEHOLDER,
  HOSPITALS, SUPERVISORS, APP_VERSION, procName, roleLabel, supName,
} from './config.js';
import * as core from './core.js';

const state = {
  tab: 'log', profile: null, events: [], entries: [], meta: {},
  online: true, swReady: false,
};
let root, overlay, toastEl, toastTimer;

// ---- tiny DOM helper -------------------------------------------------------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

const timeAgo = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

// ---- state loading ---------------------------------------------------------

async function loadState() {
  state.events = await core.allEvents();
  state.entries = core.derive(state.events);
  const meta = {};
  for (const k of ['profile', 'synced_upto', 'last_sync_at', 'undo_count', 'open_count', 'first_open_at', 'persisted']) {
    meta[k] = await core.getMeta(k);
  }
  state.meta = meta;
  state.profile = meta.profile;
}

async function refresh() {
  const y = window.scrollY || 0;
  await loadState();
  render();
  if (y) window.scrollTo(0, y);
}

// ---- toast and sheets ------------------------------------------------------

function hideToast() { toastEl.classList.remove('show'); }

function toast(msg, opts = {}) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(
    h('div', { class: 't-main' }, h('strong', {}, msg), opts.sub ? h('span', {}, opts.sub) : null),
    opts.action ? h('button', { class: 't-act', onclick: () => { hideToast(); opts.action.fn(); } }, opts.action.label) : null,
  );
  toastEl.classList.add('show');
  if (!opts.sticky) toastTimer = setTimeout(hideToast, opts.ms || 6000);
}

function openSheet(content) {
  overlay.replaceChildren(
    h('div', { class: 'scrim', onclick: closeSheet }),
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content),
  );
  overlay.classList.add('open');
}

function closeSheet() {
  overlay.classList.remove('open');
  overlay.replaceChildren();
}

// ---- sync (simulated) ------------------------------------------------------

function syncStatus() {
  const n = core.unsyncedCount(state.events, state.meta.synced_upto);
  if (!state.online) return { cls: 'warn', text: n ? `Offline · ${n} waiting` : 'Offline' };
  if (n > 0) return { cls: 'warn', text: `${n} to sync` };
  return { cls: 'ok', text: 'Up to date' };
}

async function doSync() {
  if (!state.online) {
    toast('No internet right now', { sub: 'Your entries are safe on this tablet and will sync later.' });
    return;
  }
  const n = core.unsyncedCount(state.events, state.meta.synced_upto);
  if (n === 0) { toast('Everything is already synced'); return; }
  toast('Syncing…', { sticky: true });
  await new Promise((r) => setTimeout(r, 900));
  await core.markSynced(state.events);
  await refresh();
  toast(`Synced ${n} item${n > 1 ? 's' : ''}`, { sub: 'Demo only: v0.1 has no server yet.' });
}

// ---- render ----------------------------------------------------------------

const TABS = [['log', 'Log'], ['progress', 'Progress'], ['history', 'History'], ['more', 'More']];

function render() {
  root.replaceChildren();
  if (!state.profile) { root.append(setupScreen()); return; }
  root.append(
    header(),
    h('div', { class: 'banner' }, `Prototype v${APP_VERSION} · entries stay on this tablet · never type patient names`),
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
      h('strong', {}, 'Surgical logbook'),
      h('span', { class: 'who' }, `${state.profile.student} · ${state.profile.hospital}`)),
    h('button', { class: `chip ${st.cls}`, onclick: doSync, 'aria-label': `Sync status: ${st.text}. Tap to sync.` }, st.text));
}

function nav() {
  const unsigned = state.entries.filter((e) => !e.sign).length;
  return h('nav', { class: 'nav' }, TABS.map(([id, label]) =>
    h('button', { class: 'tab' + (state.tab === id ? ' on' : ''), onclick: () => { state.tab = id; render(); window.scrollTo(0, 0); } },
      label, id === 'history' && unsigned > 0 ? h('span', { class: 'badge' }, unsigned) : null)));
}

// ---- setup -----------------------------------------------------------------

function setupScreen() {
  const input = h('input', { id: 'code', type: 'text', placeholder: 'e.g. S01', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters' });
  const sel = h('select', { id: 'hosp' }, HOSPITALS.map((x) => h('option', { value: x }, x)));
  const err = h('p', { class: 'error', role: 'alert' }, '');
  input.addEventListener('input', () => { err.textContent = ''; });
  const form = h('form', { class: 'setup-form' },
    h('label', { for: 'code' }, 'Your tester code'),
    input,
    h('label', { for: 'hosp' }, 'Where are you working now?'),
    sel,
    err,
    h('button', { class: 'btn wide', type: 'submit' }, 'Start'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const code = input.value.trim();
    if (!/^[A-Za-z0-9_-]{2,12}$/.test(code)) {
      err.textContent = 'Enter the code you were given (2–12 letters or numbers), e.g. S01.';
      input.focus();
      return;
    }
    await core.setMeta('profile', { student: code.toUpperCase(), hospital: sel.value, created_at: new Date().toISOString() });
    await core.setMeta('first_open_at', new Date().toISOString());
    await refresh();
  });
  return h('div', { class: 'setup' },
    h('h1', {}, 'Surgical logbook'),
    h('p', { class: 'muted' }, `Prototype v${APP_VERSION}. Log what you did in the theatre in a few taps. Works without internet.`),
    form,
    h('p', { class: 'muted small' }, 'Your entries stay on this tablet. Do not type patient names or numbers anywhere.'));
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
            toast('Undone');
          },
        },
      });
    },
  }, h('strong', {}, r.label), h('span', {}, r.hint)));

  openSheet([
    h('h3', {}, proc.name),
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

const stat = (n, label) => h('div', { class: 'stat' }, h('strong', {}, n), h('span', {}, label));

function shareWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Could not copy', { sub: 'Select the text and copy it by hand.' }); }
}

// ---- History tab -----------------------------------------------------------

function historyTab() {
  const unsigned = state.entries.filter((e) => !e.sign);
  return h('section', {},
    h('h2', {}, 'History'),
    h('button', { class: 'btn wide', disabled: unsigned.length === 0, onclick: openSignoff },
      unsigned.length ? `Supervisor sign-off (${unsigned.length})` : 'Nothing to sign'),
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
      late ? h('span', { class: 'tag' }, 'late entry') : null,
      e.sign ? h('span', { class: 'tag ok' }, `Signed · ${supName(e.sign.supervisor)}`) : h('span', { class: 'tag warn' }, 'Not signed')),
    e.sign ? null : h('button', { class: 'link danger', onclick: () => confirmDelete(e) }, 'Delete'));
}

function confirmDelete(e) {
  openSheet([
    h('h3', {}, 'Delete this entry?'),
    h('p', {}, `${procName(e.procedure)} · ${roleLabel(e.role)} · ${core.fmtDate(e.performed_on)}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: async () => { closeSheet(); await core.voidEntry(e.id); await refresh(); toast('Entry deleted'); } }, 'Delete'),
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  ]);
}

function openSignoff() {
  let sup = SUPERVISORS[0].id;
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const pin = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', placeholder: 'PIN', class: 'pin', autocomplete: 'off' });
  pin.addEventListener('input', () => { err.textContent = ''; });
  const radios = SUPERVISORS.map((s) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'sup', value: s.id, checked: s.id === sup, onchange: () => { sup = s.id; } }),
    h('span', {}, s.name)));
  const next = () => {
    const s = SUPERVISORS.find((x) => x.id === sup);
    if (pin.value !== s.pin) { err.textContent = 'Wrong PIN. Try again.'; pin.value = ''; pin.focus(); return; }
    signStep2(s);
  };
  openSheet([
    h('h3', {}, 'Supervisor sign-off'),
    h('p', { class: 'muted' }, 'The supervisor chooses their name and types their PIN.'),
    radios,
    pin,
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: next }, 'Next'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel')),
  ]);
}

function signStep2(s) {
  const unsigned = state.entries.filter((e) => !e.sign);
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const checks = unsigned.map((e) => ({ e, box: h('input', { type: 'checkbox', checked: true }) }));
  openSheet([
    h('h3', {}, 'Entries to sign'),
    h('p', { class: 'muted' }, `Signing as ${s.name}. Untick anything that is not correct.`),
    h('div', { class: 'signlist' }, checks.map(({ e, box }) => h('label', { class: 'check' }, box,
      h('span', {}, h('strong', {}, procName(e.procedure)), ` · ${roleLabel(e.role)} · ${core.fmtDate(e.performed_on)}`)))),
    err,
    h('div', { class: 'row' },
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const ids = checks.filter((c) => c.box.checked).map((c) => c.e.id);
          if (!ids.length) { err.textContent = 'Select at least one entry.'; return; }
          closeSheet();
          await core.signEntries(ids, s.id);
          await refresh();
          toast(`Signed ${ids.length} entr${ids.length > 1 ? 'ies' : 'y'}`, { sub: s.name });
        },
      }, 'Sign selected'),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Cancel')),
  ]);
}

// ---- More tab --------------------------------------------------------------

function moreTab() {
  const n = core.unsyncedCount(state.events, state.meta.synced_upto);
  const m = core.metrics(state.events, state.meta);
  const sel = h('select', {
    'aria-label': 'Hospital',
    onchange: async (ev) => { await core.setMeta('profile', { ...state.profile, hospital: ev.target.value }); await refresh(); },
  }, HOSPITALS.map((x) => h('option', { value: x, selected: x === state.profile.hospital }, x)));
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v));

  return h('section', {},
    h('h2', {}, 'More'),
    h('div', { class: 'card' }, h('h3', {}, 'Profile'), kv('Tester code', state.profile.student),
      h('label', { class: 'small muted' }, 'Hospital'), sel),
    h('div', { class: 'card' }, h('h3', {}, 'Data on this tablet'),
      kv('Entries', m.entries_active),
      kv('Waiting to sync', n),
      kv('Last sync', timeAgo(state.meta.last_sync_at)),
      kv('Works offline', state.swReady ? 'yes' : 'not yet'),
      kv('Storage protected', state.meta.persisted === true ? 'yes' : state.meta.persisted === false ? 'no' : 'unknown'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: doSync }, 'Sync now'),
        h('button', { class: 'btn ghost', onclick: exportData }, 'Export test data')),
      h('p', { class: 'muted small' }, 'Sync is simulated in v0.1. "Export test data" saves a file you can send on WhatsApp.')),
    h('div', { class: 'card' }, h('h3', {}, 'Demo supervisors'),
      SUPERVISORS.map((s) => kv(s.name, `PIN ${s.pin}`)),
      h('p', { class: 'muted small' }, 'Prototype only. Real PINs are checked on a server.')),
    h('div', { class: 'card' }, h('h3', {}, 'About'),
      kv('Version', APP_VERSION),
      h('button', { class: 'btn danger wide', onclick: confirmReset }, 'Delete all data on this tablet')));
}

async function exportData() {
  const payload = core.buildExport(state.events, state.meta);
  const name = `logbook-${state.profile.student}-${core.localDateISO()}.json`;
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

function confirmReset() {
  openSheet([
    h('h3', {}, 'Delete all data?'),
    h('p', {}, 'This removes every entry on this tablet. Export first if you want to keep them. This cannot be undone.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: async () => { closeSheet(); await core.wipeAll(); state.tab = 'log'; await refresh(); } }, 'Delete everything'),
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  ]);
}

// ---- startup ---------------------------------------------------------------

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { state.swReady = true; if (state.profile) render(); });
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
  overlay = document.getElementById('overlay');
  toastEl = document.getElementById('toast');
  state.online = navigator.onLine !== false;
  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  await core.setMeta('open_count', ((await core.getMeta('open_count', 0)) || 0) + 1);
  await loadState();
  render();
  registerSW();
  requestPersist();
}
