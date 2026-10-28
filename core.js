// core.js — data layer. No DOM access, so it can be tested in Node.
//
// Design: an append-only event log in IndexedDB. Entries are never edited or
// deleted; a "void" or "sign" event is added on top. Current state is derived
// from the log. This is what makes later server sync conflict-free: sync just
// means "upload events the server has not seen".

import { TARGETS, TARGETS_ARE_PLACEHOLDER, procName } from './config.js';
import { APP_VERSION } from './config.js';

const DB_VERSION = 2;
let dbName = 'surgical-logbook';
let dbPromise = null;

// Each student gets a separate local database, so two students sharing a tablet
// never see each other's entries, and logging out can wipe exactly one student.
export function useUser(candidate) {
  if (dbPromise) dbPromise.then((db) => db.close()).catch(() => {});
  dbName = `surgical-logbook-${candidate}`;
  dbPromise = null;
}

export const normCandidate = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const validCandidate = (c) => /^[A-Z0-9/_-]{2,20}$/.test(c);

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sent')) db.createObjectStore('sent', { keyPath: 'id' }); // ids the server has confirmed
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function addEvent(ev) {
  const s = await store('events', 'readwrite');
  await wrap(s.add(ev));
  return ev;
}

export async function allEvents() {
  const s = await store('events');
  const list = await wrap(s.getAll());
  return list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
}

export async function getMeta(key, fallback = null) {
  const s = await store('meta');
  const row = await wrap(s.get(key));
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const s = await store('meta', 'readwrite');
  await wrap(s.put({ key, value }));
}

export async function wipeAll() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function localDateISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ---- writing events -------------------------------------------------------

export async function logEntry(f) {
  const now = new Date();
  return addEvent({
    id: newId(),
    type: 'entry',
    ts: now.toISOString(),
    student: f.student,
    hospital: f.hospital,
    procedure: f.procedure,
    role: f.role,
    performed_on: f.performed_on || localDateISO(now),
    entered_on: localDateISO(now),
    ms_to_log: Math.round(f.ms_to_log || 0), // procedure tap -> role tap
    online: !!f.online,
    schema: 1,
  });
}

export async function voidEntry(targetId) {
  return addEvent({ id: newId(), type: 'void', ts: new Date().toISOString(), target: targetId });
}

export async function signEntries(ids, supervisorId) {
  const out = [];
  for (const target of ids) {
    out.push(await addEvent({ id: newId(), type: 'sign', ts: new Date().toISOString(), target, supervisor: supervisorId }));
  }
  return out;
}

// ---- derived state --------------------------------------------------------

export function derive(events) {
  const voided = new Set();
  const signs = new Map();
  for (const e of events) {
    if (e.type === 'void') voided.add(e.target);
    if (e.type === 'sign' && !signs.has(e.target)) signs.set(e.target, e);
  }
  return events
    .filter((e) => e.type === 'entry' && !voided.has(e.id))
    .map((e) => ({ ...e, sign: signs.get(e.id) || null }))
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

export function progress(entries) {
  const out = {};
  for (const e of entries) {
    const p = out[e.procedure] || (out[e.procedure] = { observing: 0, assisting: 0, supervised: 0, independent: 0, total: 0, performed: 0 });
    p[e.role] += 1;
    p.total += 1;
    if (e.role === 'supervised' || e.role === 'independent') p.performed += 1;
  }
  return out;
}

export function weekEntries(entries, now = new Date(), days = 7) {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  const a = localDateISO(start);
  const b = localDateISO(now);
  return entries.filter((e) => e.performed_on >= a && e.performed_on <= b);
}

export function weeklySummary(entries, { student, now = new Date(), days = 7 }) {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  const week = weekEntries(entries, now, days);
  const prog = progress(entries);
  const lines = [`Logbook summary - ${student}`, `${fmtDate(localDateISO(start))} to ${fmtDate(localDateISO(now))}`, ''];
  if (!week.length) {
    lines.push('No procedures logged this week.');
  } else {
    const signed = week.filter((e) => e.sign).length;
    lines.push(`Logged: ${week.length} (${signed} signed)`);
    const by = {};
    for (const e of week) by[e.procedure] = (by[e.procedure] || 0) + 1;
    for (const [id, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) lines.push(`- ${procName(id)}: ${n}`);
  }
  const tl = Object.entries(TARGETS)
    .filter(([id]) => prog[id])
    .map(([id, t]) => `- ${procName(id)}: ${prog[id].performed}/${t}`);
  if (tl.length) {
    lines.push('', 'Performed as surgeon so far:', ...tl);
    if (TARGETS_ARE_PLACEHOLDER) lines.push('(targets are examples only)');
  }
  return lines.join('\n');
}

// ---- sync bookkeeping ---------------------------------------------------------
// An event is "sent" once the server has confirmed it (or once it came from the server).

export async function sentIds() {
  const s = await store('sent');
  return new Set(await wrap(s.getAllKeys()));
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function markSent(ids) {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction('sent', 'readwrite');
  for (const id of ids) tx.objectStore('sent').put({ id });
  await txDone(tx);
}

// Store events that came from the server. Returns how many were new on this tablet.
export async function addPulled(events) {
  if (!events.length) return 0;
  const have = new Set((await allEvents()).map((e) => e.id));
  const fresh = events.filter((e) => !have.has(e.id));
  const db = await openDb();
  const tx = db.transaction(['events', 'sent'], 'readwrite');
  for (const e of events) tx.objectStore('sent').put({ id: e.id });
  for (const e of fresh) tx.objectStore('events').put(e);
  await txDone(tx);
  return fresh.length;
}

export const unsyncedCount = (events, sentSet) => events.filter((e) => !sentSet.has(e.id)).length;

// ---- test metrics and export ----------------------------------------------

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function metrics(events, meta = {}) {
  const all = events.filter((e) => e.type === 'entry');
  const live = derive(events);
  return {
    entries_total: all.length,
    entries_active: live.length,
    entries_voided: all.length - live.length,
    entries_signed: live.filter((e) => e.sign).length,
    median_ms_procedure_tap_to_saved: median(all.map((e) => e.ms_to_log).filter((n) => n > 0)),
    entries_logged_offline: all.filter((e) => !e.online).length,
    late_entries: all.filter((e) => e.performed_on !== e.entered_on).length,
    days_with_entries: new Set(all.map((e) => e.entered_on)).size,
    undo_count: meta.undo_count || 0,
    app_opens: meta.open_count || 0,
    first_open_at: meta.first_open_at || null,
  };
}

export function buildExport(events, meta = {}) {
  return {
    app: 'surgical-logbook-prototype',
    version: APP_VERSION,
    exported_at: new Date().toISOString(),
    profile: meta.profile || null,
    metrics: metrics(events, meta),
    events,
  };
}
