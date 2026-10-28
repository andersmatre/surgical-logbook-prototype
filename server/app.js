// server/app.js — the HTTP API. Plain node:http, no framework.
//
//   POST /api/login      { candidate, password } -> { token, candidate, must_change_password }
//   POST /api/logout     (auth)
//   POST /api/password   (auth) { old_password, new_password }
//   POST /api/sync       (auth) { events: [...], cursor } -> { accepted, rejected, events, cursor, has_more }
//   GET  /api/health

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, hashPassword, verifyPassword, sha256, normCandidate, validCandidate, validatePassword, validateEvent,
} from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 120 * 24 * 3600 * 1000; // sliding: long, because tablets are often offline for weeks
const MAX_BODY = 1024 * 1024;
const MAX_EVENTS_PER_SYNC = 200;
const PAGE = 500;

// Only these files are ever served; the database and server code are not reachable.
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/core.js': 'core.js',
  '/config.js': 'config.js', '/api.js': 'api.js', '/style.css': 'style.css', '/sw.js': 'sw.js',
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
      'SELECT s.last_seen, u.candidate, u.must_change, u.disabled FROM sessions s JOIN users u ON u.candidate = s.candidate WHERE s.token_hash = ?',
    ).get(tokenHash);
    const age = row ? now() - Date.parse(row.last_seen) : Infinity;
    if (!row || row.disabled || age > SESSION_MS) {
      if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      throw new HttpError(401, 'session_expired', 'Your session has ended. Please log in again.');
    }
    if (age > 3600 * 1000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(new Date(now()).toISOString(), tokenHash);
    return { candidate: row.candidate, mustChange: !!row.must_change, tokenHash };
  }

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
      return send(res, 200, { token, candidate: c, must_change_password: !!row.must_change });
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
      if (a.mustChange) throw new HttpError(403, 'password_change_required', 'Change your password first.');
      const body = await readJson(req);
      const incoming = Array.isArray(body.events) ? body.events : [];
      if (incoming.length > MAX_EVENTS_PER_SYNC) throw new HttpError(413, 'too_many_events', `At most ${MAX_EVENTS_PER_SYNC} events per request.`);
      const cursor = Number.isInteger(body.cursor) && body.cursor >= 0 ? body.cursor : 0;

      const accepted = [];
      const rejected = [];
      const insert = db.prepare('INSERT OR IGNORE INTO events (owner, id, payload, received_at) VALUES (?, ?, ?, ?)');
      const received = new Date(now()).toISOString();
      db.exec('BEGIN');
      try {
        for (const ev of incoming) {
          const v = validateEvent(ev, a.candidate);
          if (v.clean) { insert.run(a.candidate, v.clean.id, JSON.stringify(v.clean), received); accepted.push(v.clean.id); }
          else rejected.push({ id: ev && typeof ev.id === 'string' ? ev.id.slice(0, 64) : null, reason: v.reason });
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }

      const rows = db.prepare('SELECT seq, payload FROM events WHERE owner = ? AND seq > ? ORDER BY seq LIMIT ?').all(a.candidate, cursor, PAGE + 1);
      const hasMore = rows.length > PAGE;
      const page = hasMore ? rows.slice(0, PAGE) : rows;
      return send(res, 200, {
        accepted, rejected,
        events: page.map((r) => JSON.parse(r.payload)),
        cursor: page.length ? page[page.length - 1].seq : cursor,
        has_more: hasMore,
      });
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
