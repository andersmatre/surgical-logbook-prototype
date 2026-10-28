// server/app.js — the HTTP API. Plain node:http, no framework.
//
//   GET  /api/health
//   POST /api/login      { candidate, password } -> { token, candidate, role, name, must_change_password }
//   POST /api/logout     (auth)
//   POST /api/password   (auth) { old_password, new_password }
//
// Students:
//   POST /api/sync       (auth) { events, cursor } -> { accepted, rejected, events, cursor, has_more, supervisors }
//
// Supervisors (every call checks that the student is assigned to the caller):
//   POST /api/sup/students    -> { students: [{ candidate, entries, unsigned, since, last_received }] }
//   POST /api/sup/candidates  -> { candidates: [{ candidate, mine }] }       (to find students to add)
//   POST /api/sup/assign      { candidate }
//   POST /api/sup/unassign    { candidate }
//   POST /api/sup/entries     { candidate, cursor } -> { events, cursor, has_more }
//   POST /api/sup/sign        { candidate, ids } -> { signed, skipped }
//
// Administrators (accounts, overviews; they cannot sign and have no logbook):
//   POST /api/admin/users       -> { users: [...] }
//   POST /api/admin/stats       -> { totals, procedures, students }
//   POST /api/admin/audit       -> { log: [...] }
//   POST /api/admin/create      { role, id, name? } -> { id, password }     (password is shown once)
//   POST /api/admin/create_many { people: [{id, name?}] } -> { created: [{id, password}], skipped: [{id, reason}] }   (students)
//   POST /api/admin/rename      { id, name }
//   POST /api/admin/export      { kind: procedures|hospitals|entries, delimiter } -> CSV file
//   POST /api/admin/backup      -> a copy of the database file
//   POST /api/admin/reset | disable | enable | revoke   { id }              (not on your own account, except revoke)
//   POST /api/admin/assign | unassign   { supervisor, student }
//   POST /api/admin/entries     { candidate, cursor } -> { events, cursor, has_more }

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, hashPassword, verifyPassword, sha256, normCandidate, validCandidate, validatePassword, validateEvent,
  insertEvent, isSigned, signEntries, assign, unassign, isAssigned, LookupError,
  addUser, resetPassword, setDisabled, revokeSessions, generatePassword, ROLES, listUsers, adminStats, recentAudit,
  renameUser, exportCsv, EXPORT_KINDS, backupTo, logAudit,
} from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 365 * 24 * 3600 * 1000; // sliding: long, because tablets are often offline for weeks
const MAX_BODY = 1024 * 1024;
const MAX_EVENTS_PER_SYNC = 200;
const PAGE = 500;

// Only these files are ever served; the database and server code are not reachable.
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/core.js': 'core.js',
  '/config.js': 'config.js', '/api.js': 'api.js', '/ui.js': 'ui.js', '/supervisor.js': 'supervisor.js', '/administrator.js': 'administrator.js',
  '/style.css': 'style.css', '/sw.js': 'sw.js',
  '/manifest.webmanifest': 'manifest.webmanifest', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function createServer({ dbPath = ':memory:', allowedOrigin = '', serveStatic = false, now = () => Date.now() } = {}) {
  const db = openDb(dbPath);
  const origins = allowedOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  const dummyHash = await hashPassword('dummy-password-used-for-equal-timing');
  const failures = new Map(); // candidate -> { count, until }

  const sendFile = (res, type, filename, data) => {
    res.writeHead(200, {
      'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data),
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(data);
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin || !origins.length) return;
    if (origins.includes('*') || origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
      // Chrome asks this when a public page (e.g. GitHub Pages) calls a server on localhost.
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Request too large.');
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw new HttpError(400, 'bad_json', 'Request was not valid JSON.'); }
  }

  const checkLock = (key) => {
    const f = failures.get(key);
    if (f && f.until > now()) throw new HttpError(429, 'locked', 'Too many attempts. Try again in 10 minutes.');
  };
  const registerFailure = (key) => {
    const f = failures.get(key) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= 5) { f.until = now() + 10 * 60 * 1000; f.count = 0; }
    failures.set(key, f);
  };

  function authenticate(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'unauthenticated', 'Please log in.');
    const tokenHash = sha256(m[1]);
    const row = db.prepare(
      'SELECT s.last_seen, u.candidate, u.must_change, u.disabled, u.role, u.display_name FROM sessions s JOIN users u ON u.candidate = s.candidate WHERE s.token_hash = ?',
    ).get(tokenHash);
    const age = row ? now() - Date.parse(row.last_seen) : Infinity;
    if (!row || row.disabled || age > SESSION_MS) {
      if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      // The reason is in the message so a user who is logged out can tell us why it happened.
      const why = !row ? 'it was ended on the server (password changed or reset, or logged out everywhere)' : row.disabled ? 'the account is disabled' : 'it was unused for a year';
      throw new HttpError(401, 'session_expired', `Your session has ended: ${why}. Please log in again.`);
    }
    if (age > 3600 * 1000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(new Date(now()).toISOString(), tokenHash);
    return { candidate: row.candidate, mustChange: !!row.must_change, role: row.role, name: row.display_name, tokenHash };
  }

  function requireSupervisor(req) {
    const a = authenticate(req);
    if (a.role !== 'supervisor') throw new HttpError(403, 'wrong_role', 'This is only for supervisors.');
    if (a.mustChange) throw new HttpError(403, 'password_change_required', 'Change your password first.');
    return a;
  }

  function requireAdmin(req) {
    const a = authenticate(req);
    if (a.role !== 'admin') throw new HttpError(403, 'wrong_role', 'This is only for administrators.');
    if (a.mustChange) throw new HttpError(403, 'password_change_required', 'Change your password first.');
    return a;
  }

  // An existing account named in an administrator's request.
  function accountOf(id) {
    const c = normCandidate(id);
    const row = validCandidate(c) ? db.prepare('SELECT candidate, role, disabled FROM users WHERE candidate = ?').get(c) : null;
    if (!row) throw new HttpError(404, 'no_such_account', 'There is no account with that id.');
    return row;
  }

  // Resolves { candidate } in a request body to a student this supervisor may work with.
  function assignedStudent(a, body) {
    const c = normCandidate(body.candidate);
    if (!validCandidate(c) || !isAssigned(db, a.candidate, c)) {
      throw new HttpError(403, 'not_assigned', 'This candidate is not one of your students.');
    }
    return c;
  }

  // Supervisors get what they need to judge and sign an entry, not the app-usage measurements.
  const supervisorView = (e) => (e.type === 'entry'
    ? { id: e.id, type: e.type, ts: e.ts, hospital: e.hospital, procedure: e.procedure, role: e.role, performed_on: e.performed_on, entered_on: e.entered_on }
    : e);

  // The events of one student after `cursor`, one page at a time.
  function eventsPage(owner, cursor, project = (e) => e) {
    const rows = db.prepare('SELECT seq, payload FROM events WHERE owner = ? AND seq > ? ORDER BY seq LIMIT ?').all(owner, cursor, PAGE + 1);
    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;
    return { events: page.map((r) => project(JSON.parse(r.payload))), cursor: page.length ? page[page.length - 1].seq : cursor, has_more: hasMore };
  }

  const cursorOf = (body) => (Number.isInteger(body.cursor) && body.cursor >= 0 ? body.cursor : 0);

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/health') return send(res, 200, { ok: true });

    if (route === 'POST /api/login') {
      const body = await readJson(req);
      const c = normCandidate(body.candidate);
      checkLock(c || '?');
      const row = validCandidate(c) ? db.prepare('SELECT * FROM users WHERE candidate = ?').get(c) : null;
      // Always run a hash comparison so unknown candidates take as long as known ones.
      const ok = await verifyPassword(typeof body.password === 'string' ? body.password : '', row ? row.pw_hash : dummyHash);
      if (!row || !ok || row.disabled) {
        registerFailure(c || '?');
        throw new HttpError(401, 'bad_credentials', 'Wrong candidate number or password.');
      }
      failures.delete(c);
      const token = crypto.randomBytes(32).toString('base64url');
      const iso = new Date(now()).toISOString();
      db.prepare('INSERT INTO sessions (token_hash, candidate, created_at, last_seen) VALUES (?, ?, ?, ?)').run(sha256(token), c, iso, iso);
      db.prepare('UPDATE users SET last_login_at = ? WHERE candidate = ?').run(iso, c);
      return send(res, 200, { token, candidate: c, role: row.role, name: row.display_name, must_change_password: !!row.must_change });
    }

    if (route === 'POST /api/logout') {
      const a = authenticate(req);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(a.tokenHash);
      return send(res, 200, { ok: true });
    }

    if (route === 'POST /api/password') {
      const a = authenticate(req);
      const body = await readJson(req);
      const row = db.prepare('SELECT pw_hash FROM users WHERE candidate = ?').get(a.candidate);
      checkLock(a.candidate);
      if (!(await verifyPassword(typeof body.old_password === 'string' ? body.old_password : '', row.pw_hash))) {
        registerFailure(a.candidate);
        throw new HttpError(403, 'bad_old_password', 'The current password is wrong.');
      }
      const problem = validatePassword(body.new_password, a.candidate);
      if (problem) throw new HttpError(400, 'weak_password', problem);
      if (body.new_password === body.old_password) throw new HttpError(400, 'same_password', 'Choose a different password from the current one.');
      db.prepare('UPDATE users SET pw_hash = ?, must_change = 0 WHERE candidate = ?').run(await hashPassword(body.new_password), a.candidate);
      db.prepare('DELETE FROM sessions WHERE candidate = ? AND token_hash != ?').run(a.candidate, a.tokenHash); // log out other tablets
      return send(res, 200, { ok: true });
    }

    if (route === 'POST /api/sync') {
      const a = authenticate(req);
      if (a.role !== 'student') throw new HttpError(403, 'wrong_role', 'Supervisor accounts do not have a logbook.');
      if (a.mustChange) throw new HttpError(403, 'password_change_required', 'Change your password first.');
      const body = await readJson(req);
      const incoming = Array.isArray(body.events) ? body.events : [];
      if (incoming.length > MAX_EVENTS_PER_SYNC) throw new HttpError(413, 'too_many_events', `At most ${MAX_EVENTS_PER_SYNC} events per request.`);

      const accepted = [];
      const rejected = [];
      const received = new Date(now()).toISOString();
      db.exec('BEGIN');
      try {
        for (const ev of incoming) {
          const v = validateEvent(ev, a.candidate);
          const id = ev && typeof ev.id === 'string' ? ev.id.slice(0, 64) : null;
          if (!v.clean) rejected.push({ id, reason: v.reason });
          else if (v.clean.type === 'void' && isSigned(db, a.candidate, v.clean.target)) rejected.push({ id, reason: 'signed_locked' });
          else { insertEvent(db, a.candidate, v.clean, received); accepted.push(v.clean.id); }
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }

      // Who can see (and sign) this student's entries. The app shows this list to the student.
      const supervisors = db.prepare(
        `SELECT u.candidate AS id, COALESCE(u.display_name, u.candidate) AS name, a.created_at AS since
         FROM assignments a JOIN users u ON u.candidate = a.supervisor
         WHERE a.student = ? AND u.disabled = 0 ORDER BY a.created_at`,
      ).all(a.candidate);
      return send(res, 200, { accepted, rejected, supervisors, name: a.name, ...eventsPage(a.candidate, cursorOf(body)) });
    }

    // ---- supervisors --------------------------------------------------------

    if (route === 'POST /api/sup/students') {
      const a = requireSupervisor(req);
      const live = `e.owner = s.student AND e.type = 'entry'
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.owner = e.owner AND v.type = 'void' AND v.target = e.id)`;
      const students = db.prepare(
        `SELECT s.student AS candidate, u.display_name AS name, s.created_at AS since,
           (SELECT COUNT(*) FROM events e WHERE ${live}) AS entries,
           (SELECT COUNT(*) FROM events e WHERE ${live}
              AND NOT EXISTS (SELECT 1 FROM events g WHERE g.owner = e.owner AND g.type = 'sign' AND g.target = e.id)) AS unsigned,
           (SELECT MAX(received_at) FROM events e WHERE e.owner = s.student) AS last_received
         FROM assignments s JOIN users u ON u.candidate = s.student
         WHERE s.supervisor = ? AND u.disabled = 0
         ORDER BY unsigned DESC, s.student`,
      ).all(a.candidate);
      return send(res, 200, { students });
    }

    if (route === 'POST /api/sup/candidates') {
      const a = requireSupervisor(req);
      const candidates = db.prepare(
        `SELECT u.candidate, u.display_name AS name, EXISTS (SELECT 1 FROM assignments x WHERE x.supervisor = ? AND x.student = u.candidate) AS mine
         FROM users u WHERE u.role = 'student' AND u.disabled = 0 ORDER BY u.candidate`,
      ).all(a.candidate).map((r) => ({ candidate: r.candidate, name: r.name, mine: !!r.mine }));
      return send(res, 200, { candidates });
    }

    if (route === 'POST /api/sup/assign') {
      const a = requireSupervisor(req);
      const body = await readJson(req);
      try { assign(db, a.candidate, normCandidate(body.candidate), { now: new Date(now()), actor: a.candidate }); }
      catch (e) {
        if (e instanceof LookupError) throw new HttpError(404, 'no_such_candidate', 'There is no active student with that candidate number.');
        throw e;
      }
      return send(res, 200, { ok: true });
    }

    if (route === 'POST /api/sup/unassign') {
      const a = requireSupervisor(req);
      const body = await readJson(req);
      unassign(db, a.candidate, normCandidate(body.candidate), { actor: a.candidate });
      return send(res, 200, { ok: true });
    }

    if (route === 'POST /api/sup/entries') {
      const a = requireSupervisor(req);
      const body = await readJson(req);
      const student = assignedStudent(a, body);
      return send(res, 200, eventsPage(student, cursorOf(body), supervisorView));
    }

    if (route === 'POST /api/sup/sign') {
      const a = requireSupervisor(req);
      const body = await readJson(req);
      const student = assignedStudent(a, body);
      if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(400, 'no_ids', 'Choose at least one entry to sign.');
      if (body.ids.length > MAX_EVENTS_PER_SYNC) throw new HttpError(413, 'too_many_events', `At most ${MAX_EVENTS_PER_SYNC} entries per request.`);
      const r = signEntries(db, { id: a.candidate, name: a.name }, student, body.ids, new Date(now()).toISOString());
      return send(res, 200, { signed: r.signed.length, signed_ids: r.signed, skipped: r.skipped });
    }

    // ---- administrators -----------------------------------------------------

    if (route.startsWith('POST /api/admin/')) {
      const a = requireAdmin(req);
      const action = url.pathname.slice('/api/admin/'.length);
      const body = await readJson(req);
      const notSelf = (id) => {
        if (id === a.candidate) throw new HttpError(400, 'not_yourself', 'You cannot do this to your own account. Ask another administrator.');
      };

      if (action === 'users') return send(res, 200, { users: listUsers(db) });
      if (action === 'stats') return send(res, 200, adminStats(db));
      if (action === 'audit') return send(res, 200, { log: recentAudit(db, 50) });

      if (action === 'create') {
        if (!ROLES.includes(body.role)) throw new HttpError(400, 'bad_role', 'Choose student, supervisor or administrator.');
        const id = normCandidate(body.id);
        if (!validCandidate(id)) throw new HttpError(400, 'bad_id', 'The id must be 2 to 20 letters, numbers, / _ or -.');
        const password = generatePassword();
        try { await addUser(db, id, password, { role: body.role, name: body.name, actor: a.candidate }); }
        catch (e) {
          if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'exists', `${id} already exists.`);
          throw e;
        }
        return send(res, 200, { id, password });
      }

      if (action === 'create_many') {
        // { people: [{ id, name }] } (names optional), or the older { ids: [...] }.
        const people = Array.isArray(body.people) ? body.people : (Array.isArray(body.ids) ? body.ids.map((id) => ({ id })) : []);
        if (!people.length) throw new HttpError(400, 'no_ids', 'Add at least one candidate number.');
        if (people.length > 100) throw new HttpError(413, 'too_many', 'At most 100 at a time.');
        const created = [];
        const skipped = [];
        const seen = new Set();
        for (const person of people) {
          const raw = person && typeof person === 'object' ? person.id : person;
          const id = normCandidate(raw);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (!validCandidate(id)) { skipped.push({ id: String(raw).slice(0, 30), reason: 'not a valid id' }); continue; }
          const password = generatePassword();
          try { await addUser(db, id, password, { role: 'student', name: person && person.name, actor: a.candidate }); created.push({ id, password }); }
          catch (e) {
            if (/UNIQUE/.test(String(e.message))) skipped.push({ id, reason: 'already exists' });
            else throw e;
          }
        }
        return send(res, 200, { created, skipped });
      }

      if (action === 'rename') {
        const t = accountOf(body.id);
        renameUser(db, t.candidate, body.name, a.candidate);
        return send(res, 200, { ok: true });
      }

      if (action === 'export') {
        const kind = EXPORT_KINDS.includes(body.kind) ? body.kind : null;
        if (!kind) throw new HttpError(400, 'bad_kind', 'Choose procedures, hospitals or entries.');
        const delimiter = body.delimiter === ';' ? ';' : ',';
        logAudit(db, a.candidate, 'export', null, kind, new Date(now()));
        return sendFile(res, 'text/csv; charset=utf-8', `logbook-${kind}-${new Date(now()).toISOString().slice(0, 10)}.csv`, exportCsv(db, kind, delimiter));
      }

      if (action === 'backup') {
        // A consistent copy of the live database. It holds everything, including password hashes.
        const tmp = path.join(os.tmpdir(), `logbook-backup-${crypto.randomUUID()}.db`);
        try {
          backupTo(db, tmp);
          logAudit(db, a.candidate, 'backup', null, null, new Date(now()));
          return sendFile(res, 'application/octet-stream', `logbook-backup-${new Date(now()).toISOString().slice(0, 10)}.db`, fs.readFileSync(tmp));
        } finally { fs.rmSync(tmp, { force: true }); }
      }

      if (action === 'reset') {
        const t = accountOf(body.id);
        notSelf(t.candidate);
        const password = generatePassword();
        await resetPassword(db, t.candidate, password, a.candidate);
        return send(res, 200, { id: t.candidate, password });
      }
      if (action === 'disable' || action === 'enable') {
        const t = accountOf(body.id);
        if (action === 'disable') notSelf(t.candidate);
        setDisabled(db, t.candidate, action === 'disable', a.candidate);
        return send(res, 200, { ok: true });
      }
      if (action === 'revoke') {
        const t = accountOf(body.id);
        return send(res, 200, { ok: true, sessions: revokeSessions(db, t.candidate, a.candidate) });
      }

      if (action === 'assign' || action === 'unassign') {
        const sup = accountOf(body.supervisor);
        const stu = accountOf(body.student);
        if (action === 'unassign') unassign(db, sup.candidate, stu.candidate, { actor: a.candidate });
        else {
          try { assign(db, sup.candidate, stu.candidate, { now: new Date(now()), actor: a.candidate }); }
          catch (e) {
            if (e instanceof LookupError) throw new HttpError(400, 'cannot_assign', 'That needs an active supervisor and an active student.');
            throw e;
          }
        }
        return send(res, 200, { ok: true });
      }

      if (action === 'entries') {
        const t = accountOf(body.candidate);
        if (t.role !== 'student') throw new HttpError(400, 'not_a_student', 'Only students have entries.');
        return send(res, 200, eventsPage(t.candidate, cursorOf(body), supervisorView));
      }
    }

    throw new HttpError(404, 'not_found', 'No such endpoint.');
  }

  function staticFile(pathname, req, res) {
    const name = STATIC[pathname];
    if (!name) throw new HttpError(404, 'not_found', 'Not found.');
    const body = fs.readFileSync(path.join(ROOT, name));
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream',
      'Cache-Control': name === 'sw.js' || name === 'index.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    cors(req, res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (serveStatic && (req.method === 'GET' || req.method === 'HEAD')) return staticFile(url.pathname, req, res);
      throw new HttpError(404, 'not_found', 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      return send(res, 500, { error: 'server_error', message: 'Something went wrong on the server.' });
    }
  });

  return {
    server, db,
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(() => { try { db.close(); } catch { /* already closed */ } resolve(); })),
  };
}
