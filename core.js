// core.js — data layer. No DOM access, so it can be tested in Node.
//
// Design: an append-only event log in IndexedDB. Entries are never edited or
// deleted; a "void" or "sign" event is added on top. Current state is derived
// from the log. This is what makes later server sync conflict-free: sync just
// means "upload events the server has not seen".

import { FOLLOWUP_DAYS, FOLLOWUP_FIELDS, answerLabel, shownAnswers } from './config.js';

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

// Date arithmetic on 'YYYY-MM-DD' in UTC, so summer time never shifts a day.
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// The Monday of the week that 'YYYY-MM-DD' is in (weeks run Monday to Sunday).
export function weekStart(iso) {
  return addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
}

// The heading of a week in History, from its Monday: "This week", "Last week", "26 Oct – 1 Nov",
// "2 – 8 Nov", with the year when the week ends in an earlier year ("1 – 7 Dec 2025").
export function fmtWeek(monday, today = localDateISO()) {
  const now = weekStart(today);
  if (monday === now) return 'This week';
  if (monday === addDays(now, -7)) return 'Last week';
  const sunday = addDays(monday, 6);
  const from = monday.slice(5, 7) === sunday.slice(5, 7) ? String(+monday.slice(8)) : fmtDate(monday);
  return `${from} – ${fmtDate(sunday)}${sunday.slice(0, 4) === today.slice(0, 4) ? '' : ` ${sunday.slice(0, 4)}`}`;
}

// Entries grouped by the week they were done, newest first: [{ week: its Monday 'YYYY-MM-DD', entries }].
// Inside a week the newest day comes first; entries of the same day keep their order.
export function byWeek(entries) {
  const sorted = [...entries].sort((a, b) => (a.performed_on < b.performed_on ? 1 : a.performed_on > b.performed_on ? -1 : 0));
  const out = [];
  for (const e of sorted) {
    const week = weekStart(e.performed_on);
    if (!out.length || out[out.length - 1].week !== week) out.push({ week, entries: [] });
    out[out.length - 1].entries.push(e);
  }
  return out;
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
    schema: 1,
    // Answers to the procedure's detail questions (DETAIL_FIELDS in config.js). Left out when none were given.
    ...(f.details && Object.keys(f.details).length ? { details: f.details } : {}),
  });
}

// What became of the patient, added later (FOLLOWUP_FIELDS in config.js). A new event on top of the entry,
// never a change to it. `known_on` is the day the student learnt it.
export async function addFollowUp(targetId, answers) {
  const now = new Date();
  return addEvent({ id: newId(), type: 'followup', ts: now.toISOString(), target: targetId, known_on: localDateISO(now), answers });
}

export async function voidEntry(targetId) {
  return addEvent({ id: newId(), type: 'void', ts: new Date().toISOString(), target: targetId });
}

// Signatures are not written here: a supervisor signs on the server, and the signature
// arrives with the next sync as a 'sign' event.

// Remove one event from this tablet. Only used when the server refuses an event for good,
// for example a delete of an entry that a supervisor has signed in the meantime.
export async function dropEvent(id) {
  const db = await openDb();
  const tx = db.transaction(['events', 'sent'], 'readwrite');
  tx.objectStore('events').delete(id);
  tx.objectStore('sent').delete(id);
  await txDone(tx);
}

// ---- derived state --------------------------------------------------------

// Each live entry gets `sign` (or null), `followups` (oldest first) and `outcome`: the follow-up answers
// merged, a newer answer to the same question replacing an older one, without answers to questions that would no
// longer be asked (the days until death, after "Died" was changed to "Alive"). A void can also undo a follow-up.
export function derive(events) {
  const voided = new Set();
  const signs = new Map();
  const followups = new Map();
  for (const e of events) {
    if (e.type === 'void') voided.add(e.target);
    if (e.type === 'sign' && !signs.has(e.target)) signs.set(e.target, e);
  }
  for (const e of events) {
    if (e.type !== 'followup' || voided.has(e.id)) continue;
    if (!followups.has(e.target)) followups.set(e.target, []);
    followups.get(e.target).push(e);
  }
  return events
    .filter((e) => e.type === 'entry' && !voided.has(e.id))
    .map((e) => {
      const fu = (followups.get(e.id) || []).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      return { ...e, sign: signs.get(e.id) || null, followups: fu, outcome: shownAnswers(FOLLOWUP_FIELDS, Object.assign({}, ...fu.map((f) => f.answers || {}))) };
    })
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

// Whole days from one date ('YYYY-MM-DD') to another.
export const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

// A follow-up can be added up to FOLLOWUP_DAYS after the operation.
export const followUpOpen = (entry, today = localDateISO()) => daysBetween(entry.performed_on, today) <= FOLLOWUP_DAYS;

// Answers as one line of text, in the order of the fields: 'Anaesthesia: Spinal · Operation time: 45 minutes'.
export function answersText(fields, answers) {
  return Object.keys(fields).filter((id) => answers && answers[id] != null)
    .map((id) => `${fields[id].label}: ${answerLabel(fields, id, answers[id])}`).join(' · ');
}

// The targets a supervisor set for this student, { procedure: number }. They are 'target' events, made only by the
// server when a supervisor saves targets, so the newest one for a procedure wins (by `ts`, the server's clock; the
// order of the events for equal times). A target of 0 removes it. Several supervisors: the newest wins.
export function targets(events) {
  const latest = new Map();
  for (const e of events) {
    if (e.type !== 'target') continue;
    const before = latest.get(e.procedure);
    if (!before || e.ts >= before.ts) latest.set(e.procedure, e);
  }
  const out = {};
  for (const [id, e] of latest) if (e.count > 0) out[id] = e.count;
  return out;
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

// The entries done this week, Monday to Sunday: the same week as "This week" in History.
export function weekEntries(entries, today = localDateISO()) {
  const monday = weekStart(today);
  return entries.filter((e) => e.performed_on >= monday && e.performed_on <= today);
}

// How many days after the day it was done a case was logged (0: the same day). A supervisor sees "Logged N days
// later" from LATE_DAYS on: a case logged the next morning is normal.
export const LATE_DAYS = 7;
export const daysLate = (e) => (e.performed_on && e.entered_on ? daysBetween(e.performed_on, e.entered_on) : 0);

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

// ---- after the server was restored from a backup ---------------------------------
// The server has lost what came after the backup. This tablet still has it, but had marked it as sent, and its
// cursor may be past the server's newest event. So: forget what was sent and start fetching from the beginning.
// Only the student's own events are sent again; signatures and targets are made by the server, which would refuse
// them from a tablet. Which of those the server still has is known once everything has been fetched again
// (dropServerEventsExcept). Kept in meta ('resync') until then, so an interrupted sync starts over.
const SERVER_TYPES = new Set(['sign', 'target']);

export async function restartSync() {
  const fromServer = (await allEvents()).filter((e) => SERVER_TYPES.has(e.type)).map((e) => e.id);
  const db = await openDb();
  const tx = db.transaction(['sent', 'meta'], 'readwrite');
  tx.objectStore('sent').clear();
  for (const id of fromServer) tx.objectStore('sent').put({ id }); // not sent again
  tx.objectStore('meta').put({ key: 'cursor', value: 0 });
  tx.objectStore('meta').put({ key: 'resync', value: true });
  await txDone(tx);
}

// After everything was fetched again: signatures and targets the server no longer has are removed from this tablet
// too (the supervisor signs again), so the tablet shows what the server has. Returns how many were removed.
export async function dropServerEventsExcept(seen) {
  const gone = (await allEvents()).filter((e) => SERVER_TYPES.has(e.type) && !seen.has(e.id)).map((e) => e.id);
  for (const id of gone) await dropEvent(id);
  await setMeta('resync', false);
  return gone.length;
}

// ---- counts ------------------------------------------------------------------

// Counts of what is in the logbook. How the app is used (seconds to log, offline, undo, app opens) is not
// measured: entries made before version 0.13.0 still hold ms_to_log and online, which nothing reads.
export function metrics(events) {
  const all = events.filter((e) => e.type === 'entry');
  const live = derive(events);
  return {
    entries_total: all.length,
    entries_active: live.length,
    entries_voided: all.length - live.length,
    entries_signed: live.filter((e) => e.sign).length,
    late_entries: all.filter((e) => e.performed_on !== e.entered_on).length,
    entries_with_details: all.filter((e) => e.details).length,
    followups: events.filter((e) => e.type === 'followup').length,
    days_with_entries: new Set(all.map((e) => e.entered_on)).size,
  };
}
