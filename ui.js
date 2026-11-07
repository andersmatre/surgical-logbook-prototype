// ui.js — small pieces of interface shared by the student app (app.js) and the
// supervisor app (supervisor.js): the DOM helper, toast, sheets and the password form.
// Plain JavaScript, no build step.

import * as api from './api.js';
import {
  PRIVACY, PRIVACY_IS_PLACEHOLDER, DETAIL_FIELDS, FOLLOWUP_FIELDS, FOLLOWUP_DAYS, procName, roleDone, detailFieldsFor, followupFieldsFor,
  surgicalApgar, answerLabel,
} from './config.js';
import * as core from './core.js';

// ---- tiny DOM helper -------------------------------------------------------

export function h(tag, attrs, ...kids) {
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

export const timeAgo = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export const stat = (n, label) => h('div', { class: 'stat' }, h('strong', {}, n), h('span', {}, label));
// A number of entries in words: "1 case", "3 cases".
export const cases = (n) => `${n} ${n === 1 ? 'case' : 'cases'}`;

export const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v));

// Hands a file to the browser as a download. Tests replace this with globalThis.LOGBOOK_SAVE_FILE.
export function saveBlob(blob, filename) {
  if (typeof globalThis.LOGBOOK_SAVE_FILE === 'function') { globalThis.LOGBOOK_SAVE_FILE(blob, filename); return; }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The screen once logged in: the header and tabs at the top, and under them the page, which scrolls on its own
// (.shell in style.css). The window itself never scrolls, so on an iPhone the header cannot be pulled along when
// the page is scrolled far or fast, or bounces at its ends. pageScroll and setPageScroll read and set where the
// page is scrolled to, to keep that when the screen is drawn again, or go back to the top on another tab.
// The content sits in .page, which on a touch screen is 1 px taller than the screen (style.css), so a short page can still be dragged and bounce.
// bottom: buttons that stay at the bottom of the screen (a supervisor's Sign), in a white bar under the page, as wide
// as the top bar; the page scrolls above it, not under it.
export const appShell = (attrs, top, page, bottom = null) =>
  h('div', { ...attrs, class: 'shell' }, h('div', { class: 'top-bar' }, top),
    h('main', { class: 'main' }, h('div', { class: 'page' }, page)),
    bottom ? h('div', { class: 'bottom-bar' }, h('div', { class: 'bottom-bar-in' }, bottom)) : null);
export const pageScroll = () => document.querySelector('.shell > .main')?.scrollTop || 0;
export function setPageScroll(y) {
  const page = document.querySelector('.shell > .main');
  if (page) page.scrollTop = y;
}

// Before a screen is drawn again (a fresh answer from the server): if a search field in it has the keyboard,
// returns a function that gives it back to the new search field, with the cursor where it was, so typing is
// never interrupted. Call it after drawing.
export function keepTyping(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.classList.contains('search')) return () => {};
  const { selectionStart: a, selectionEnd: b } = el;
  return () => {
    const next = root.querySelector('input.search');
    if (!next) return;
    next.focus();
    try { next.setSelectionRange(a, b); } catch { /* not every input type has a cursor */ }
  };
}

// ---- toast and sheets ------------------------------------------------------

let overlay;
let toastEl;
let toastTimer;

export function initUi({ overlayEl, toastElement }) {
  overlay = overlayEl;
  toastEl = toastElement;
  pressOnTouch();
}

// On a phone or tablet, a touch while something is still scrolling only stops the scrolling: the browser sends no
// click, so the button has to be tapped a second time. A finger that moves a little also loses the tap. That is
// right for buttons that scroll with the page (a touch there may just mean "stop"), but not for the buttons that
// stay in place while the content moves under them: Cancel and Save at the bottom of a pop-up, the tabs and the
// sync button at the top, Tick all and Sign in the bar at the bottom of a supervisor's page, Undo in the message at the bottom, Delete in the heading of a case. A touch on one of
// those always means "press", so it is pressed when the finger lifts, at once.
const STAY_PUT = '.sheet-foot, .sheet-head, .top-bar, .bottom-bar, #toast';
let pressInstalled = false;
function pressOnTouch() {
  if (pressInstalled) return;
  pressInstalled = true;
  let start = null;
  document.addEventListener('touchstart', (ev) => {
    const btn = ev.touches.length === 1 && ev.target.closest ? ev.target.closest('button') : null;
    const t = ev.changedTouches[0];
    start = btn && btn.closest(STAY_PUT) ? { btn, id: t.identifier, x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  document.addEventListener('touchend', (ev) => {
    const s = start;
    start = null;
    if (!s) return;
    const t = [...ev.changedTouches].find((x) => x.identifier === s.id);
    if (!t || Math.hypot(t.clientX - s.x, t.clientY - s.y) > 16) return; // the finger really moved: a swipe, not a press
    ev.preventDefault(); // so the browser does not send a click of its own as well
    if (s.btn.disabled) return;
    const focused = document.activeElement;
    if (focused && focused !== s.btn && focused.blur) focused.blur(); // as a normal tap would (closes the keyboard)
    s.btn.click();
  }, { passive: false });
}

export function hideToast() { toastEl.classList.remove('show'); }

export function toast(msg, opts = {}) {
  clearTimeout(toastTimer);
  // Never pass null to replaceChildren: it would be written out as the text "null".
  const kids = [h('div', { class: 't-main' }, h('strong', {}, msg), opts.sub ? h('span', {}, opts.sub) : null)];
  if (opts.action) kids.push(h('button', { class: 't-act', onclick: () => { hideToast(); opts.action.fn(); } }, opts.action.label));
  toastEl.replaceChildren(...kids);
  toastEl.classList.add('show');
  if (!opts.sticky) toastTimer = setTimeout(hideToast, opts.ms || 6000);
}

// Opens a pop-up in the middle of the screen. { tall: true } gives it a fixed height, for a list that
// gets shorter while you search, so the pop-up does not jump around.
// A pop-up with buttons at the bottom (.sheet-foot, like Cancel and Save) and maybe a heading at the top
// (.sheet-head) scrolls only what is between them (.sheet-body): the buttons and the heading never move, also
// not when an iPhone bounces at the end of the scrolling. When that part is longer than the screen it shows a
// fade above the buttons, and one at its top once scrolled down (scrollHint), under the
// heading if there is one. A tall one shows them over its list.
export function openSheet(content, { tall = false } = {}) {
  const sheet = h('div', { class: tall ? 'sheet tall' : 'sheet', role: 'dialog', 'aria-modal': 'true' }, content);
  overlay.replaceChildren(h('div', { class: 'scrim', onclick: closeSheet }), sheet);
  overlay.classList.add('open');
  const foot = sheet.querySelector(':scope > .sheet-foot');
  const list = sheet.querySelector(':scope > .plist');
  const head = sheet.querySelector(':scope > .sheet-head');
  if (foot) {
    const body = h('div', { class: 'sheet-body' }, [...sheet.children].filter((c) => c !== head && c !== foot));
    sheet.insertBefore(body, foot);
    sheet.classList.add('split');
    let top = head;
    if (!top) {
      top = h('div', { class: 'scroll-dock' }); // the fade at the top edge
      sheet.prepend(top);
    }
    scrollHint(body, foot, top);
  } else if (tall && list) scrollHint(list, sheet);
}

// Fades for people who are not used to scrolling: the bottom edge of `scroller` fades out to white while there is
// more further down, the top edge once it is scrolled down. Only a fade, no arrow or button; a tap goes through it
// to what is under it. The fade at the bottom is placed in `downHost`, the one at the top in `upHost`: elements
// with a position. If they hold the scroller (a list in a pop-up), the fades are put at the top and bottom of the
// list; otherwise CSS places them (.scroll-hint).
export function scrollHint(scroller, downHost, upHost = downHost) {
  const fade = (dir) => h('div', { class: `scroll-hint ${dir}`, hidden: true, 'aria-hidden': 'true' });
  const down = fade('down');
  const up = fade('up');
  downHost.append(down);
  upHost.append(up);
  const inHost = downHost.contains(scroller);
  // only when it changes: the observer would see it. A fade that comes later fades in (.fade); the first time
  // (below, while the pop-up opens) it does not, so it comes together with the pop-up and not a moment after it.
  let first = true;
  const show = (el, on) => {
    if (el.hidden !== on) return;
    if (on && !first) el.classList.add('fade');
    el.hidden = !on;
  };
  const update = () => {
    show(down, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 12);
    show(up, scroller.scrollTop > 12);
    if (inHost) { // outside the scroller, so this does not wake the observer
      up.style.top = `${scroller.offsetTop}px`;
      down.style.top = `${scroller.offsetTop + scroller.clientHeight}px`;
    }
  };
  scroller.addEventListener('scroll', update, { passive: true });
  // answers that show more questions, a search that makes a list shorter, a screen that turns
  new MutationObserver(update).observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(scroller);
  update(); // at once, in the same picture as the pop-up (a list not yet on the screen measures 0 and shows none)
  first = false;
  requestAnimationFrame(update);
  return update;
}

// A small question on top of the open pop-up, which stays as it is underneath. "No" (or a tap outside) only
// closes the question; "Yes" closes it and runs onYes.
export function confirmOver({ title, text, yes, no, onYes }) {
  const close = () => layer.remove();
  const layer = h('div', { class: 'layer' },
    h('div', { class: 'scrim', onclick: close }),
    h('div', { class: 'sheet confirm', role: 'alertdialog', 'aria-modal': 'true' },
      h('h3', {}, title),
      h('p', {}, text),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: close }, no),
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); onYes(); } }, yes))));
  overlay.append(layer);
}

export function closeSheet() {
  overlay.classList.remove('open');
  overlay.replaceChildren();
}

// ---- privacy notice ("Your data") -------------------------------------------------------
// The text lives in config.js. Shown from the first-login screen and from "Advanced" under More.

// Each part is a grey card with its heading, like the parts of the entry pop-up; several lines become a list.
// A line can be for one role only ({ for: 'student', text }), so each person reads only what is about them.
export function openPrivacy(role) {
  const part = ([title, lines]) => {
    const shown = lines.filter((l) => typeof l === 'string' || l.for === role).map((l) => (typeof l === 'string' ? l : l.text));
    return h('div', { class: 'pv-card' }, h('h4', {}, title),
      shown.length > 1 ? h('ul', { class: 'pv-list' }, shown.map((l) => h('li', {}, l))) : h('p', {}, shown[0]));
  };
  openSheet([
    h('h3', { class: 'pv-title' }, 'Your data'),
    PRIVACY_IS_PLACEHOLDER ? h('p', { class: 'muted small pv-draft' }, 'Draft: CapaCare still has to confirm parts of this text.') : null,
    PRIVACY.parts.map(part),
    part(['How long it is kept', [PRIVACY.keptFor]]),
    part(['Your rights', [
      `You can ask to see your data, to have mistakes corrected, or to have your account and your data deleted. Ask ${PRIVACY.contact}.`,
    ]]),
    h('button', { class: 'btn ghost wide', type: 'button', onclick: closeSheet }, 'Close'),
  ]);
}

// ---- the More tab, the same in all three apps --------------------------------------------

// A row like the hospital and date when logging: the label in bold, the value under it in plain text, and
// anything else (a "Change" or "Read" button) on the right. Rows go in a .facts.plain box.
export const fact = (label, value, ...extra) => h('div', { class: 'fact' }, h('span', { class: 'fact-text' }, h('span', {}, label), h('strong', {}, value)), ...extra);

// The "Your data" row: opens the privacy notice for this role.
export const privacyFact = (role) => fact('Your data', 'What is stored and who can see it',
  h('button', { class: 'change', type: 'button', onclick: () => openPrivacy(role) }, 'Read'));

// The things rarely needed, folded away at the bottom of More: parts of [heading, rows]. The line under
// "Advanced" says what is inside: "Data and about", or just "About" when that is the only part. Whether it is
// open is kept here, so a redraw of the tab (after a sync) does not fold it shut.
let advancedOpen = false;
export function advancedCard(parts) {
  const sub = parts.length === 1 ? parts[0][0] : 'Data and about';
  return h('details', { class: 'card advanced', open: advancedOpen, ontoggle: (ev) => { advancedOpen = ev.target.open; } },
    h('summary', {}, h('span', { class: 'fold-title' }, h('strong', {}, 'Advanced'), h('span', { class: 'muted small' }, sub))),
    parts.map(([title, rows]) => [h('h3', {}, title), h('div', { class: 'facts plain' }, rows)]));
}

// ---- password form (forced at first login, or chosen from the More tab) --------------

// onAuthError(e) returns true when the error was "session ended" and has been handled.
export function passwordForm({ forced, candidate, token, onDone, onAuthError }) {
  const label = forced ? 'Save and continue' : 'Change password';
  const old = h('input', { id: 'oldpw', type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { id: 'newpw', type: 'password', autocomplete: 'new-password' });
  const rep = h('input', { id: 'reppw', type: 'password', autocomplete: 'new-password' });
  const show = h('input', { type: 'checkbox', id: 'showpw2' });
  show.addEventListener('change', () => { [old, nw, rep].forEach((i) => { i.type = show.checked ? 'text' : 'password'; }); });
  const err = h('p', { class: 'error', role: 'alert' }, '');
  const btn = h('button', { class: 'btn wide', type: 'submit' }, label);
  const form = h('form', { class: 'setup-form' },
    h('label', { for: 'oldpw' }, forced ? 'The password you were given' : 'Current password'), old,
    h('label', { for: 'newpw' }, 'New password (at least 8 characters)'), nw,
    h('label', { for: 'reppw' }, 'Type the new password again'), rep,
    h('label', { class: 'checkrow', for: 'showpw2' }, show, h('span', {}, 'Show passwords')),
    err, btn);
  [old, nw, rep].forEach((i) => i.addEventListener('input', () => { err.textContent = ''; }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    if (!old.value) { err.textContent = 'Type the current password.'; old.focus(); return; }
    if (nw.value.length < 8) { err.textContent = 'The new password must be at least 8 characters.'; nw.focus(); return; }
    if (nw.value.toUpperCase() === candidate) { err.textContent = 'The password must not be your candidate number.'; nw.focus(); return; }
    if (nw.value !== rep.value) { err.textContent = 'The two new passwords are not the same.'; rep.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api.changePassword(token, old.value, nw.value);
      await onDone();
    } catch (e) {
      if (onAuthError(e)) return;
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  return form;
}

// ---- a case in a pop-up --------------------------------------------------------

// A case in a pop-up (a student's History, a supervisor's student page), kept quiet on purpose. At the top what
// matters most: the procedure, the date and hospital, and the role with Signed / Not signed (like the row in the list). Under it two plain tabs: "Details"
// (the answers of the form) and "Follow-up". The answers are in grey cards, a row per answered question (the
// question on the left, the answer on the right); a card only has a heading when the tab has several (Mother, Baby,
// Operation ...). Changing a case is not possible (the log only grows). With onDelete an unsigned entry can be deleted
// with a quiet link at the bottom of Details; with onFollowUp a follow-up can be added on the Follow-up tab next to
// Close. A supervisor gets neither: they only read.
// roleText: how the role is worded (roleDone for the student; a supervisor passes roleDoneBy).
export function openCase(e, { onDelete = null, onFollowUp = null, roleText = roleDone } = {}) {
  const row = (label, value) => h('div', { class: 'case-row' }, h('span', {}, label), h('span', {}, value));
  // A heading that only repeats the tab's name ("Details", "Follow-up") is left out.
  const part = (title, rows) => (rows.length
    ? h('section', { class: 'case-part' }, title === 'Details' || title === 'Follow-up' ? null : h('h4', {}, title), rows)
    : null);
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
  // Why there is no follow-up button: the time for it is over (not the signature: a signed case can get one too).
  const limit = FOLLOWUP_DAYS % 7 === 0 ? `${FOLLOWUP_DAYS / 7} weeks` : `${FOLLOWUP_DAYS} days`;
  const closed = canFollowUp ? null : h('p', { class: 'muted case-note' }, `Follow-up is closed: more than ${limit} after the operation.`);

  const caseTab = h('div', { class: 'case-tab', id: 'case-tab-details', role: 'tabpanel' },
    details.length ? details : h('p', { class: 'muted case-note' }, 'No details were filled in.'),
    // Delete: rarely needed, so a quiet red link at the bottom, not a button that catches the eye (it asks first)
    e.sign || !onDelete ? null : h('div', { class: 'case-del-row' },
      h('button', { class: 'link danger case-del', type: 'button', onclick: () => onDelete(e) }, 'Delete this case')));
  const followTab = h('div', { class: 'case-tab', id: 'case-tab-followup', role: 'tabpanel', hidden: true },
    followUp.length ? followUp : null,
    followUp.length && !closed ? null : closed || h('p', { class: 'muted case-note' }, 'No follow-up yet.'));
  // Add or update the follow-up: only on the Follow-up tab, next to Close (bigger, like Save elsewhere)
  const followBtn = canFollowUp && onFollowUp
    ? h('button', { class: 'btn save', type: 'button', hidden: true, onclick: () => onFollowUp(e) }, hasOutcome ? 'Update follow-up' : 'Add follow-up')
    : null;
  const tab = (id, label) => h('button', {
    class: 'ctab', type: 'button', role: 'tab', 'data-tab': id, 'aria-controls': `case-tab-${id}`, onclick: () => show(id),
  }, label);
  const tabs = h('div', { class: 'ctabs', role: 'tablist', 'aria-label': 'Details or follow-up' }, tab('details', 'Details'), tab('followup', 'Follow-up'));
  const show = (id) => {
    const sheet = caseTab.closest('.sheet');
    const top = sheet ? sheet.getBoundingClientRect().top : null;
    for (const b of tabs.children) {
      b.classList.toggle('on', b.dataset.tab === id);
      b.setAttribute('aria-selected', String(b.dataset.tab === id));
    }
    caseTab.hidden = id !== 'details';
    followTab.hidden = id !== 'followup';
    if (followBtn) followBtn.hidden = id !== 'followup';
    if (caseTab.parentNode) caseTab.parentNode.scrollTop = 0; // the other tab starts at its top
    if (sheet) keepTop(sheet, top);
  };
  show('details');

  const signedBy = e.sign
    ? `Signed by ${e.sign.supervisor_name || e.sign.supervisor}${e.sign.ts ? ` on ${core.fmtDate(String(e.sign.ts).slice(0, 10))}` : ''}`
    : null;
  openSheet([
    h('div', { class: 'sheet-head' }, // stays at the top while the case scrolls
      // like the row in the list: the procedure, under it in grey your role, the date (and hospital), and the tags on
      // the right (Follow-up, Signed or Not signed); who signed it and when in a grey line under it
      h('div', { class: 'case-top' },
        h('div', { class: 'case-top-text' },
          h('h3', { class: 'case-title' }, procName(e.procedure)),
          h('p', { class: 'case-sub' }, [
            roleText(e.role, e.procedure),
            late ? `${core.fmtDate(e.performed_on)} (logged ${core.fmtDate(e.entered_on)})` : core.fmtDate(e.performed_on),
          ].filter(Boolean).join(' · ')),
          e.hospital ? h('p', { class: 'case-sub case-hosp' }, e.hospital) : null), // the hospital on a line of its own, like in the rows
        h('div', { class: 'e-tags' },
          hasOutcome ? h('span', { class: 'tag fu' }, 'Follow-up added') : null,
          e.sign ? h('span', { class: 'tag ok' }, 'Signed') : h('span', { class: 'tag warn' }, 'Not signed'))),
      signedBy ? h('p', { class: 'case-sub case-signed' }, signedBy) : null,
      tabs),
    caseTab,
    followTab,
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeSheet }, 'Close'),
      followBtn),
  ]);
}

// When the case pop-up changes tab it fits its new content, but its top edge stays where it was, so the heading and
// the tabs do not jump; only the bottom moves. It only moves up when a taller tab needs the room.
function keepTop(sheet, top) {
  const h = sheet.offsetHeight;
  const t = Math.max(16, Math.min(top, window.innerHeight - 16 - h)); // 16: the space around a pop-up (#overlay)
  sheet.style.alignSelf = 'flex-start';
  sheet.style.marginTop = `${t - 16}px`;
}
