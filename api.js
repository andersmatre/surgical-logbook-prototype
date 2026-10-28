// api.js — talks to the logbook server. Every failure becomes an ApiError with a message
// that can be shown to the student as is.

import { API_BASE } from './config.js';

const base = () => String(globalThis.LOGBOOK_API_BASE ?? API_BASE).replace(/\/$/, '');

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
