// api.js — talks to the logbook server. Every failure becomes an ApiError with a message
// that can be shown to the student as is.

import { API_BASE } from './config.js';

// For testing the hosted app against a server on your own computer: open the app once with
// ?api=http://localhost:8080 and the address is remembered ("?api=" with nothing clears it).
// Only localhost addresses are accepted, so a link can never send someone's password to another server.
const OVERRIDE_KEY = 'logbook.api';
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

export function applyApiParam(search) {
  try {
    const p = new URLSearchParams(search);
    if (!p.has('api')) return;
    const v = p.get('api').trim().replace(/\/$/, '');
    if (!v) localStorage.removeItem(OVERRIDE_KEY);
    else if (LOCAL.test(v)) localStorage.setItem(OVERRIDE_KEY, v);
  } catch { /* storage blocked: the override simply does not apply */ }
}

export function apiOverride() {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return v && LOCAL.test(v) ? v : null;
  } catch { return null; }
}

const base = () => String(globalThis.LOGBOOK_API_BASE ?? apiOverride() ?? API_BASE).replace(/\/$/, '');
export const serverLabel = () => base() || globalThis.location?.origin || '';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status; // 0 = could not reach the server
    this.code = code;
  }
}

async function call(path, { body, token } = {}) {
  let res;
  try {
    res = await fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(25000) : undefined, // slow links
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check the internet connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'error', (data && data.message) || `Server error (${res.status}).`);
  return data;
}

export const login = (candidate, password) => call('/api/login', { body: { candidate, password } });
export const logout = (token) => call('/api/logout', { token });
export const changePassword = (token, old_password, new_password) => call('/api/password', { token, body: { old_password, new_password } });
export const sync = (token, events, cursor) => call('/api/sync', { token, body: { events, cursor } });

// Supervisor calls. The server checks the role and that the student is assigned to the caller.
export const supStudents = (token) => call('/api/sup/students', { token });
export const supCandidates = (token) => call('/api/sup/candidates', { token });
export const supAssign = (token, candidate) => call('/api/sup/assign', { token, body: { candidate } });
export const supUnassign = (token, candidate) => call('/api/sup/unassign', { token, body: { candidate } });
export const supEntries = (token, candidate, cursor) => call('/api/sup/entries', { token, body: { candidate, cursor } });
export const supSign = (token, candidate, ids) => call('/api/sup/sign', { token, body: { candidate, ids } });
