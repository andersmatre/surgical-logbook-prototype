// ui.js — small pieces of interface shared by the student app (app.js) and the
// supervisor app (supervisor.js): the DOM helper, toast, sheets and the password form.
// Plain JavaScript, no build step.

import * as api from './api.js';

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
export const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v));

// ---- toast and sheets ------------------------------------------------------

let overlay;
let toastEl;
let toastTimer;

export function initUi({ overlayEl, toastElement }) {
  overlay = overlayEl;
  toastEl = toastElement;
}

export function hideToast() { toastEl.classList.remove('show'); }

export function toast(msg, opts = {}) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(
    h('div', { class: 't-main' }, h('strong', {}, msg), opts.sub ? h('span', {}, opts.sub) : null),
    opts.action ? h('button', { class: 't-act', onclick: () => { hideToast(); opts.action.fn(); } }, opts.action.label) : null,
  );
  toastEl.classList.add('show');
  if (!opts.sticky) toastTimer = setTimeout(hideToast, opts.ms || 6000);
}

export function openSheet(content) {
  overlay.replaceChildren(
    h('div', { class: 'scrim', onclick: closeSheet }),
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content),
  );
  overlay.classList.add('open');
}

export function closeSheet() {
  overlay.classList.remove('open');
  overlay.replaceChildren();
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
