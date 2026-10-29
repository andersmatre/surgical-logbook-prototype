// dev/seed.mjs — demo accounts and entries for local front-end work. NOT part of the app.
//
//   node dev/seed.mjs            add the demo data to data/dev.db (does nothing if it is already there)
//   node dev/seed.mjs --reset    delete data/dev.db first, then add the demo data
//
// Every demo account has the password "demo1234" (CC1099 still has to choose its own, so you can
// look at that screen). The data is the same every time you reset, apart from the dates, which are
// relative to today. It refuses to touch a database called logbook.db, so it can never hit real data.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, addUser, assign, insertEvent, signEntries, validateEvent } from '../server/lib.js';
import { PROCEDURES_TOP, PROCEDURES_OTHER, HOSPITALS } from '../config.js';

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_ACCOUNTS = [
  { id: 'CC1001', role: 'student', name: 'Demo Student One', note: 'many entries, some signed, some deleted' },
  { id: 'CC1002', role: 'student', name: 'Demo Student Two', note: 'a few entries' },
  { id: 'CC1003', role: 'student', name: 'Demo Student Three', note: 'a medium amount, none signed' },
  { id: 'CC1004', role: 'student', name: 'Demo Student Four', note: 'no entries yet (empty screens)' },
  { id: 'CC1099', role: 'student', name: 'Demo New Student', note: 'has not chosen a password yet', fresh: true },
  { id: 'SUP-DEMO', role: 'supervisor', name: 'Dr Demo Supervisor', note: 'supervises CC1001, CC1002 and CC1003' },
  { id: 'ADMIN-DEMO', role: 'admin', name: 'Demo Administrator', note: 'sees everything' },
];

// Small deterministic random numbers, so a reset always gives the same data.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day = (daysAgo, now) => new Date(now - daysAgo * 86400000).toISOString().slice(0, 10);

// Makes `count` entries for one student and returns their ids (oldest first).
function addEntries(db, student, count, seed, now) {
  const rand = prng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const procedures = [...PROCEDURES_TOP, ...PROCEDURES_TOP, ...PROCEDURES_TOP, ...PROCEDURES_OTHER]; // top ten are more common
  const roles = ['observing', 'assisting', 'assisting', 'supervised', 'supervised', 'independent'];
  const hospitals = HOSPITALS.slice(0, 4);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const ago = Math.floor((count - i) * (90 / count)); // spread over about the last 90 days
    const ts = new Date(now - ago * 86400000 + 36000000).toISOString();
    const raw = {
      id: `demo-${student}-${String(i + 1).padStart(4, '0')}`, type: 'entry', ts,
      hospital: hospitals[Math.floor(i / Math.max(1, count / hospitals.length)) % hospitals.length] ?? pick(hospitals),
      procedure: pick(procedures).id, role: pick(roles),
      performed_on: day(ago, now), entered_on: day(ago, now),
      ms_to_log: 4000 + Math.floor(rand() * 14000), online: rand() > 0.15,
    };
    const { clean, reason } = validateEvent(raw, student);
    if (!clean) throw new Error(`Seed entry rejected (${reason}); has validateEvent changed?`);
    insertEvent(db, student, clean, ts);
    ids.push(clean.id);
  }
  return ids;
}

function voidEntry(db, student, target, now) {
  const ts = new Date(now).toISOString();
  const { clean } = validateEvent({ id: `demo-void-${target.slice(-12)}`, type: 'void', ts, target }, student);
  insertEvent(db, student, clean, ts);
}

// Adds the demo data to an open database. Returns false (and changes nothing) if it is already there.
export async function seedDemo(db, { now = Date.now() } = {}) {
  if (db.prepare('SELECT 1 FROM users WHERE candidate = ?').get('CC1001')) return false;
  for (const a of DEMO_ACCOUNTS) {
    await addUser(db, a.id, DEMO_PASSWORD, { role: a.role, name: a.name, actor: 'dev-seed' });
    if (!a.fresh) db.prepare('UPDATE users SET must_change = 0 WHERE candidate = ?').run(a.id);
  }
  for (const s of ['CC1001', 'CC1002', 'CC1003']) assign(db, 'SUP-DEMO', s, { actor: 'dev-seed' });

  const nowIso = new Date(now).toISOString();
  const sup = { id: 'SUP-DEMO', name: 'Dr Demo Supervisor' };

  const one = addEntries(db, 'CC1001', 60, 1001, now);
  signEntries(db, sup, 'CC1001', one.slice(0, 35), nowIso); // the oldest ones are signed
  for (const id of one.slice(50, 53)) voidEntry(db, 'CC1001', id, now); // a few deleted (not signed ones)

  const two = addEntries(db, 'CC1002', 8, 1002, now);
  signEntries(db, sup, 'CC1002', two.slice(0, 3), nowIso);

  addEntries(db, 'CC1003', 25, 1003, now);
  return true;
}

// ---- command line ------------------------------------------------------------

export const devDbPath = () => path.resolve(process.env.DEV_DB || 'data/dev.db');

export function assertSafeDbPath(file) {
  if (path.basename(file) === 'logbook.db') {
    throw new Error(`${file} looks like the real database. The dev tools only use data/dev.db (or DEV_DB=...).`);
  }
}

export function resetDb(file) {
  assertSafeDbPath(file);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = devDbPath();
  assertSafeDbPath(file);
  if (process.argv.includes('--reset')) resetDb(file);
  const db = openDb(file);
  const added = await seedDemo(db);
  db.close();
  console.log(added ? `Demo data added to ${file}` : `${file} already has the demo data (use --reset to start over)`);
}
