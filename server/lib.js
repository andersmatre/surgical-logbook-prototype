// server/lib.js — database, passwords and event validation. No HTTP here.
// Zero dependencies: uses Node's built-in sqlite and crypto modules (Node >= 22.13).

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 16384;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      candidate     TEXT PRIMARY KEY,
      pw_hash       TEXT NOT NULL,
      must_change   INTEGER NOT NULL DEFAULT 1,
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      candidate  TEXT NOT NULL REFERENCES users(candidate),
      created_at TEXT NOT NULL,
      last_seen  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner       TEXT NOT NULL REFERENCES users(candidate),
      id          TEXT NOT NULL,
      payload     TEXT NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE (owner, id)
    );
    CREATE INDEX IF NOT EXISTS events_owner_seq ON events (owner, seq);
  `);
  return db;
}

// ---- passwords --------------------------------------------------------------

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return ['scrypt', SCRYPT_N, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(keyB64, 'base64');
  const got = await scrypt(String(pw), Buffer.from(saltB64, 'base64'), want.length, { N: +n, r: +r, p: +p });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
export function generatePassword() {
  let s = '';
  for (let i = 0; i < 10; i++) {
    s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (i === 4) s += '-';
  }
  return s;
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- candidate numbers ------------------------------------------------------

export const normCandidate = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const validCandidate = (c) => /^[A-Z0-9/_-]{2,20}$/.test(c);

export function validatePassword(pw, candidate) {
  if (typeof pw !== 'string' || pw.length < 8) return 'The new password must be at least 8 characters.';
  if (pw.length > 200) return 'The new password is too long.';
  if (pw.toUpperCase() === candidate) return 'The password must not be your candidate number.';
  return null;
}

// ---- user administration (used by admin.js and tests) -----------------------

export async function addUser(db, candidate, password) {
  const c = normCandidate(candidate);
  if (!validCandidate(c)) throw new Error(`Invalid candidate number: "${candidate}" (2-20 letters, numbers, / _ -)`);
  const hash = await hashPassword(password);
  db.prepare('INSERT INTO users (candidate, pw_hash, must_change, disabled, created_at) VALUES (?, ?, 1, 0, ?)')
    .run(c, hash, new Date().toISOString());
  return c;
}

export async function resetPassword(db, candidate, password) {
  const c = normCandidate(candidate);
  const res = db.prepare('UPDATE users SET pw_hash = ?, must_change = 1 WHERE candidate = ?').run(await hashPassword(password), c);
  if (!res.changes) throw new Error(`No such candidate: ${c}`);
  db.prepare('DELETE FROM sessions WHERE candidate = ?').run(c);
  return c;
}

export function setDisabled(db, candidate, disabled) {
  const c = normCandidate(candidate);
  const res = db.prepare('UPDATE users SET disabled = ? WHERE candidate = ?').run(disabled ? 1 : 0, c);
  if (!res.changes) throw new Error(`No such candidate: ${c}`);
  if (disabled) db.prepare('DELETE FROM sessions WHERE candidate = ?').run(c);
  return c;
}

export function revokeSessions(db, candidate) {
  return db.prepare('DELETE FROM sessions WHERE candidate = ?').run(normCandidate(candidate)).changes;
}

// ---- event validation -------------------------------------------------------
// The server stores only whitelisted fields, and always stamps the owner's
// candidate number itself: a client cannot write entries for someone else.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROLE_IDS = ['observing', 'assisting', 'supervised', 'independent'];
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);

export function validateEvent(ev, candidate) {
  if (!ev || typeof ev !== 'object') return { reason: 'not an object' };
  if (!idOk(ev.id)) return { reason: 'bad id' };
  if (typeof ev.ts !== 'string' || ev.ts.length > 32 || Number.isNaN(Date.parse(ev.ts))) return { reason: 'bad ts' };
  const base = { id: ev.id, type: ev.type, ts: ev.ts };

  if (ev.type === 'entry') {
    if (typeof ev.procedure !== 'string' || !/^[a-z0-9_]{1,40}$/.test(ev.procedure)) return { reason: 'bad procedure' };
    if (!ROLE_IDS.includes(ev.role)) return { reason: 'bad role' };
    if (!DATE.test(ev.performed_on) || !DATE.test(ev.entered_on)) return { reason: 'bad date' };
    if (typeof ev.hospital !== 'string' || ev.hospital.length > 100) return { reason: 'bad hospital' };
    if (typeof ev.ms_to_log !== 'number' || !Number.isFinite(ev.ms_to_log) || ev.ms_to_log < 0 || ev.ms_to_log > 1e8) return { reason: 'bad ms_to_log' };
    return {
      clean: {
        ...base, student: candidate, hospital: ev.hospital, procedure: ev.procedure, role: ev.role,
        performed_on: ev.performed_on, entered_on: ev.entered_on, ms_to_log: Math.round(ev.ms_to_log),
        online: !!ev.online, schema: 1,
      },
    };
  }
  if (ev.type === 'void') {
    if (!idOk(ev.target)) return { reason: 'bad target' };
    return { clean: { ...base, target: ev.target } };
  }
  if (ev.type === 'sign') {
    if (!idOk(ev.target)) return { reason: 'bad target' };
    if (typeof ev.supervisor !== 'string' || !/^[a-z0-9_]{1,40}$/.test(ev.supervisor)) return { reason: 'bad supervisor' };
    return { clean: { ...base, target: ev.target, supervisor: ev.supervisor } };
  }
  return { reason: 'unknown type' };
}
