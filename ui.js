// ui.js — small pieces of interface shared by the student app (app.js) and the
// supervisor app (supervisor.js): the DOM helper, toast, sheets and the password form.
// Plain JavaScript, no build step.

import * as api from './api.js';
import { PRIVACY, PRIVACY_IS_PLACEHOLDER } from './config.js';

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
// sync button at the top, Undo in the message at the bottom, the small scroll arrows. A touch on one of those
// always means "press", so it is pressed when the finger lifts, at once.
const STAY_PUT = '.sheet-foot, .sticky-top, #toast, .scroll-hint';
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
// A pop-up that is longer than the screen shows a small arrow down above its Cancel and Save, and an arrow up at
// its top once scrolled down (scrollHint), under its .sheet-head if it has one (a heading that stays at the top);
// a tall one shows them over its list.
export function openSheet(content, { tall = false } = {}) {
  const sheet = h('div', { class: tall ? 'sheet tall' : 'sheet', role: 'dialog', 'aria-modal': 'true' }, content);
  overlay.replaceChildren(h('div', { class: 'scrim', onclick: closeSheet }), sheet);
  overlay.classList.add('open');
  const foot = sheet.querySelector(':scope > .sheet-foot');
  const list = sheet.querySelector(':scope > .plist');
  const head = sheet.querySelector(':scope > .sheet-head');
  if (foot && head) scrollHint(sheet, foot, head);
  else if (foot) {
    const dock = h('div', { class: 'scroll-dock' }); // stays at the top while the pop-up scrolls
    sheet.prepend(dock);
    scrollHint(sheet, foot, dock);
  } else if (tall && list) scrollHint(list, sheet);
}

// Small arrows for people who are not used to scrolling: one down at the bottom of `scroller` while there is more
// further down, one up at its top once it is scrolled down. The content fades out under them; a tap scrolls a
// screen. They are small and quiet, so they do not get in the way once someone knows. The arrow down is placed
// in `downHost`, the arrow up in `upHost`: elements with a position. If they hold the scroller (a list in a
// pop-up), the arrows are put at the top and bottom of the list; otherwise CSS places them (.scroll-hint).
export function scrollHint(scroller, downHost, upHost = downHost) {
  const arrow = (dir) => h('div', { class: `scroll-hint ${dir}`, hidden: true },
    h('button', {
      class: 'scroll-pill', type: 'button', tabindex: '-1', 'aria-label': dir === 'down' ? 'Scroll down' : 'Scroll up',
      onclick: () => scroller.scrollBy({ top: (dir === 'down' ? 0.7 : -0.7) * scroller.clientHeight, behavior: 'smooth' }),
    }));
  const down = arrow('down');
  const up = arrow('up');
  downHost.append(down);
  upHost.append(up);
  const inHost = downHost.contains(scroller);
  const show = (el, on) => { if (el.hidden === on) el.hidden = !on; }; // only when it changes: the observer would see it
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
