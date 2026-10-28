// server/lib.js — database, accounts, passwords, signing and event validation. No HTTP here.
// Zero dependencies: uses Node's built-in sqlite and crypto modules (Node >= 22.13).

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 16384;

// ---- database ---------------------------------------------------------------

// Creates missing tables and upgrades a database made by an older version. Safe to run on every start.
// Rules for changing this function are in PROJECT.md ("Changing the database").
export function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      candidate     TEXT PRIMARY KEY,           -- account id: the candidate number (students) or a staff ID (supervisors)
      pw_hash       TEXT NOT NULL,
      must_change   INTEGER NOT NULL DEFAULT 1,
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      last_login_at TEXT,
      role          TEXT NOT NULL DEFAULT 'student',   -- 'student' | 'supervisor' | 'admin'
      display_name  TEXT                         -- supervisors and admins: shown to students next to a signature
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      candidate  TEXT NOT NULL REFERENCES users(candidate),
      created_at TEXT NOT NULL,
      last_seen  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner       TEXT NOT NULL REFERENCES users(candidate),   -- always the student the event is about
      id          TEXT NOT NULL,
      type        TEXT,                          -- copied out of payload so it can be queried
      target      TEXT,                          -- same: the entry a void or sign refers to
      payload     TEXT NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE (owner, id)
    );
    CREATE INDEX IF NOT EXISTS events_owner_seq ON events (owner, seq);
    CREATE TABLE IF NOT EXISTS assignments (
      supervisor TEXT NOT NULL REFERENCES users(candidate),
      student    TEXT NOT NULL REFERENCES users(candidate),
      created_at TEXT NOT NULL,
      PRIMARY KEY (supervisor, student)
    );
    CREATE INDEX IF NOT EXISTS assignments_student ON assignments (student);
    CREATE TABLE IF NOT EXISTS audit (           -- who changed accounts and access, and when. Never holds passwords.
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      at     TEXT NOT NULL,
      actor  TEXT NOT NULL,                      -- an account id, or 'cli' / 'startup' for the command line and server start
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT
    );
  `);

  // Upgrade a database created by v0.2 (no roles, no type/target columns).
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const users = columns('users');
  if (!users.has('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'");
  if (!users.has('display_name')) db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  if (!columns('events').has('type')) {
    db.exec('ALTER TABLE events ADD COLUMN type TEXT');
    db.exec('ALTER TABLE events ADD COLUMN target TEXT');
    db.exec("UPDATE events SET type = json_extract(payload, '$.type'), target = json_extract(payload, '$.target')");
  }
  db.exec('CREATE INDEX IF NOT EXISTS events_owner_target ON events (owner, target)');
}

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  initSchema(db);
  return db;
}

// A consistent copy of the live database (safe while the server runs). Used by `admin.js backup`.
export function backupTo(db, file) {
  const target = path.resolve(file);
  if (fs.existsSync(target)) throw new Error(`${target} already exists; choose a new file name.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  db.prepare('VACUUM INTO ?').run(target);
  return target;
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

// ---- account ids ------------------------------------------------------------

export const normCandidate = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const validCandidate = (c) => /^[A-Z0-9/_-]{2,20}$/.test(c);

export function validatePassword(pw, candidate) {
  if (typeof pw !== 'string' || pw.length < 8) return 'The new password must be at least 8 characters.';
  if (pw.length > 200) return 'The new password is too long.';
  if (pw.toUpperCase() === candidate) return 'The password must not be your candidate number.';
  return null;
}

// ---- audit log ------------------------------------------------------------------

// Records who changed accounts or access. `actor` is an account id, or 'cli' / 'startup'.
export function logAudit(db, actor, action, target = null, detail = null, at = new Date()) {
  db.prepare('INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(at.toISOString(), actor, action, target, detail);
}

export const recentAudit = (db, limit = 50) =>
  db.prepare('SELECT at, actor, action, target, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r }));

// ---- user administration (used by admin.js, the HTTP layer and tests) ---------

export const ROLES = ['student', 'supervisor', 'admin'];

export function cleanName(s) {
  const n = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  return n ? n.slice(0, 60) : null;
}

export async function addUser(db, candidate, password, { role = 'student', name = null, actor = 'cli' } = {}) {
  const c = normCandidate(candidate);
  if (!validCandidate(c)) throw new Error(`Invalid id: "${candidate}" (2-20 letters, numbers, / _ -)`);
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  const hash = await hashPassword(password);
  db.prepare('INSERT INTO users (candidate, pw_hash, must_change, disabled, created_at, role, display_name) VALUES (?, ?, 1, 0, ?, ?, ?)')
    .run(c, hash, new Date().toISOString(), role, role === 'student' ? null : cleanName(name));
  logAudit(db, actor, 'create', c, role);
  return c;
}

// First start of a new server: create the first administrator from ADMIN_ID and ADMIN_PASSWORD
// (set as secrets on the host), so no shell access is needed. Does nothing if the account exists.
export async function bootstrapAdmin(db, id, password) {
  const c = normCandidate(id);
  if (!c || !password) return null;
  if (!validCandidate(c)) throw new Error(`ADMIN_ID is not a valid account id: "${id}"`);
  if (db.prepare('SELECT 1 FROM users WHERE candidate = ?').get(c)) return null;
  await addUser(db, c, password, { role: 'admin', actor: 'startup' });
  return c;
}

export async function resetPassword(db, candidate, password, actor = 'cli') {
  const c = normCandidate(candidate);
  const res = db.prepare('UPDATE users SET pw_hash = ?, must_change = 1 WHERE candidate = ?').run(await hashPassword(password), c);
  if (!res.changes) throw new Error(`No such account: ${c}`);
  db.prepare('DELETE FROM sessions WHERE candidate = ?').run(c);
  logAudit(db, actor, 'reset_password', c);
  return c;
}

export function setDisabled(db, candidate, disabled, actor = 'cli') {
  const c = normCandidate(candidate);
  const res = db.prepare('UPDATE users SET disabled = ? WHERE candidate = ?').run(disabled ? 1 : 0, c);
  if (!res.changes) throw new Error(`No such account: ${c}`);
  if (disabled) db.prepare('DELETE FROM sessions WHERE candidate = ?').run(c);
  logAudit(db, actor, disabled ? 'disable' : 'enable', c);
  return c;
}

export function revokeSessions(db, candidate, actor = 'cli') {
  const c = normCandidate(candidate);
  const n = db.prepare('DELETE FROM sessions WHERE candidate = ?').run(c).changes;
  logAudit(db, actor, 'revoke_sessions', c, `${n}`);
  return n;
}

export function renameUser(db, candidate, name, actor = 'cli') {
  const c = normCandidate(candidate);
  const res = db.prepare("UPDATE users SET display_name = ? WHERE candidate = ? AND role != 'student'").run(cleanName(name), c);
  if (!res.changes) throw new Error(`No such supervisor or administrator: ${c}`);
  logAudit(db, actor, 'rename', c);
  return c;
}

// ---- supervisor <-> student assignments --------------------------------------

export class LookupError extends Error {}

// Returns 1 if the assignment is new, 0 if it already existed.
export function assign(db, supervisor, student, { now = new Date(), actor = 'cli' } = {}) {
  const s = normCandidate(supervisor);
  const c = normCandidate(student);
  const sup = db.prepare('SELECT role, disabled FROM users WHERE candidate = ?').get(s);
  if (!sup || sup.role !== 'supervisor' || sup.disabled) throw new LookupError(`No such supervisor: ${s}`);
  const stu = db.prepare('SELECT role, disabled FROM users WHERE candidate = ?').get(c);
  if (!stu || stu.role !== 'student' || stu.disabled) throw new LookupError(`No such candidate: ${c}`);
  const added = db.prepare('INSERT OR IGNORE INTO assignments (supervisor, student, created_at) VALUES (?, ?, ?)').run(s, c, now.toISOString()).changes;
  if (added) logAudit(db, actor, 'assign', c, s, now);
  return added;
}

export function unassign(db, supervisor, student, { actor = 'cli' } = {}) {
  const s = normCandidate(supervisor);
  const c = normCandidate(student);
  const n = db.prepare('DELETE FROM assignments WHERE supervisor = ? AND student = ?').run(s, c).changes;
  if (n) logAudit(db, actor, 'unassign', c, s);
  return n;
}

export const isAssigned = (db, supervisor, student) =>
  !!db.prepare('SELECT 1 FROM assignments WHERE supervisor = ? AND student = ?').get(supervisor, student);

// ---- overviews for administrators ---------------------------------------------------

const NOT_VOIDED = "NOT EXISTS (SELECT 1 FROM events v WHERE v.owner = e.owner AND v.type = 'void' AND v.target = e.id)";

// Every account with what an administrator needs to see at a glance.
export function listUsers(db) {
  const rows = db.prepare(
    `SELECT u.candidate AS id, u.role, u.display_name AS name, u.disabled, u.must_change, u.last_login_at, u.created_at,
       (SELECT COUNT(*) FROM events e WHERE e.owner = u.candidate AND e.type = 'entry' AND ${NOT_VOIDED}) AS entries
     FROM users u ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'supervisor' THEN 1 ELSE 2 END, u.candidate`,
  ).all();
  const links = db.prepare(
    'SELECT a.supervisor, a.student, s.display_name AS supervisor_name FROM assignments a JOIN users s ON s.candidate = a.supervisor',
  ).all();
  const supervisorsOf = new Map();
  const studentsOf = new Map();
  for (const l of links) {
    if (!supervisorsOf.has(l.student)) supervisorsOf.set(l.student, []);
    supervisorsOf.get(l.student).push({ id: l.supervisor, name: l.supervisor_name || l.supervisor });
    if (!studentsOf.has(l.supervisor)) studentsOf.set(l.supervisor, []);
    studentsOf.get(l.supervisor).push(l.student);
  }
  return rows.map((r) => ({
    id: r.id, role: r.role, name: r.name, disabled: !!r.disabled, password_set: !r.must_change,
    last_login_at: r.last_login_at, created_at: r.created_at, entries: r.entries,
    supervisors: r.role === 'student' ? (supervisorsOf.get(r.id) || []) : undefined,
    students: r.role === 'supervisor' ? (studentsOf.get(r.id) || []) : undefined,
  }));
}

// Procedures across all students: totals, per procedure, and per student per procedure.
export function adminStats(db) {
  const entries = db.prepare(
    `SELECT e.owner AS student, json_extract(e.payload, '$.procedure') AS procedure, json_extract(e.payload, '$.role') AS role,
            json_extract(e.payload, '$.performed_on') AS performed_on,
            EXISTS (SELECT 1 FROM events g WHERE g.owner = e.owner AND g.type = 'sign' AND g.target = e.id) AS signed
     FROM events e WHERE e.type = 'entry' AND ${NOT_VOIDED}`,
  ).all();
  const students = db.prepare("SELECT candidate, disabled FROM users WHERE role = 'student' ORDER BY candidate").all();
  const activeSupervisors = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'supervisor' AND disabled = 0").get().n;

  const performedRole = (r) => r === 'supervised' || r === 'independent';
  const byProcedure = new Map();
  const byStudent = new Map(students.map((u) => [u.candidate, {
    candidate: u.candidate, disabled: !!u.disabled, entries: 0, performed: 0, signed: 0, last_performed_on: null, by_procedure: {},
  }]));
  let signed = 0;
  for (const e of entries) {
    const p = byProcedure.get(e.procedure) || { procedure: e.procedure, observing: 0, assisting: 0, supervised: 0, independent: 0, total: 0, performed: 0, students: new Set() };
    p[e.role] += 1;
    p.total += 1;
    if (performedRole(e.role)) p.performed += 1;
    p.students.add(e.student);
    byProcedure.set(e.procedure, p);

    const st = byStudent.get(e.student);
    if (!st) continue;
    st.entries += 1;
    if (e.signed) { st.signed += 1; signed += 1; }
    if (performedRole(e.role)) st.performed += 1;
    if (!st.last_performed_on || e.performed_on > st.last_performed_on) st.last_performed_on = e.performed_on;
    const cell = st.by_procedure[e.procedure] || (st.by_procedure[e.procedure] = { performed: 0, total: 0 });
    cell.total += 1;
    if (performedRole(e.role)) cell.performed += 1;
  }
  const active = students.filter((u) => !u.disabled).length;
  return {
    totals: { students: active, supervisors: activeSupervisors, entries: entries.length, signed, unsigned: entries.length - signed },
    procedures: [...byProcedure.values()].map((p) => ({ ...p, students: p.students.size })).sort((a, b) => b.total - a.total),
    students: [...byStudent.values()],
  };
}

// ---- events -------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROLE_IDS = ['observing', 'assisting', 'supervised', 'independent'];
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);

// The server stores only whitelisted fields, and always stamps the owner's account id
// itself: a client cannot write entries for someone else. Students cannot write
// signatures at all: those are created by the server when a supervisor signs.
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
  if (ev.type === 'sign') return { reason: 'sign_not_allowed' };
  return { reason: 'unknown type' };
}

// Returns 1 if stored, 0 if this owner already had an event with that id.
export function insertEvent(db, owner, ev, receivedAt) {
  return db.prepare('INSERT OR IGNORE INTO events (owner, id, type, target, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(owner, ev.id, ev.type, ev.target ?? null, JSON.stringify(ev), receivedAt).changes;
}

const hasEvent = (db, owner, type, target) =>
  !!db.prepare('SELECT 1 FROM events WHERE owner = ? AND type = ? AND target = ?').get(owner, type, target);

// An entry that a supervisor has signed can no longer be deleted by the student.
export const isSigned = (db, owner, entryId) => hasEvent(db, owner, 'sign', entryId);

// Signs entries on behalf of a supervisor. The caller has already checked that the
// supervisor is assigned to `owner`. Returns { signed: [ids], skipped: [{id, reason}] }.
export function signEntries(db, supervisor, owner, ids, nowIso) {
  const out = { signed: [], skipped: [] };
  const seen = new Set();
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      if (!idOk(id)) { out.skipped.push({ id: String(id).slice(0, 64), reason: 'bad id' }); continue; }
      if (seen.has(id)) continue;
      seen.add(id);
      if (!db.prepare("SELECT 1 FROM events WHERE owner = ? AND id = ? AND type = 'entry'").get(owner, id)) {
        out.skipped.push({ id, reason: 'not found' });
      } else if (hasEvent(db, owner, 'void', id)) {
        out.skipped.push({ id, reason: 'deleted by the student' });
      } else if (hasEvent(db, owner, 'sign', id)) {
        out.skipped.push({ id, reason: 'already signed' });
      } else {
        insertEvent(db, owner, {
          id: crypto.randomUUID(), type: 'sign', ts: nowIso, target: id,
          supervisor: supervisor.id, supervisor_name: supervisor.name || supervisor.id,
        }, nowIso);
        out.signed.push(id);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return out;
}
