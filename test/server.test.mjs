import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/app.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  addUser, setDisabled, revokeSessions, resetPassword, generatePassword, initSchema, openDb, backupTo, bootstrapAdmin,
} from '../server/lib.js';

async function start(opts = {}) {
  const s = await createServer({ dbPath: ':memory:', ...opts });
  const port = await s.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, { method = 'POST', body, token, headers = {} } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, body: json, headers: r.headers };
  };
  return { s, base, call };
}

let n = 0;
const entry = (over = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  type: 'entry', ts: new Date().toISOString(), student: 'SOMEONE-ELSE', hospital: 'Masanga Hospital',
  procedure: 'cs', role: 'independent', performed_on: '2026-10-20', entered_on: '2026-10-20',
  ms_to_log: 4200, online: true, schema: 1, ...over,
});

// Logs in; if the account still has its initial password, changes it to `newPw`.
async function ready(t, candidate, initial, newPw) {
  await addUser(t.s.db, candidate, initial);
  const login = await t.call('/api/login', { body: { candidate, password: initial } });
  assert.equal(login.status, 200);
  const ch = await t.call('/api/password', { token: login.body.token, body: { old_password: initial, new_password: newPw } });
  assert.equal(ch.status, 200);
  return login.body.token;
}

test('health, wrong endpoints and unknown candidates', async () => {
  const t = await start();
  try {
    assert.equal((await t.call('/api/health', { method: 'GET' })).status, 200);
    assert.equal((await t.call('/api/nothing', { method: 'GET' })).status, 404);
    const r = await t.call('/api/login', { body: { candidate: 'NOBODY', password: 'whatever1' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Wrong candidate number or password.'); // same message as a wrong password
  } finally { await t.s.close(); }
});

test('candidate numbers are case- and space-insensitive; wrong password gives the same generic message', async () => {
  const t = await start();
  try {
    await addUser(t.s.db, 'cc 123/45', 'initial-pw-1');
    const ok = await t.call('/api/login', { body: { candidate: ' cc123/45 ', password: 'initial-pw-1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.candidate, 'CC123/45');
    assert.equal(ok.body.must_change_password, true);
    const bad = await t.call('/api/login', { body: { candidate: 'CC123/45', password: 'nope-nope' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.message, 'Wrong candidate number or password.');
  } finally { await t.s.close(); }
});

test('five failed attempts lock the account for ten minutes, then it opens again', async () => {
  let clock = Date.now();
  const t = await start({ now: () => clock });
  try {
    await addUser(t.s.db, 'S001', 'initial-pw-1');
    for (let i = 0; i < 5; i++) {
      assert.equal((await t.call('/api/login', { body: { candidate: 'S001', password: 'wrong-pass' } })).status, 401);
    }
    const locked = await t.call('/api/login', { body: { candidate: 'S001', password: 'initial-pw-1' } });
    assert.equal(locked.status, 429);
    clock += 11 * 60 * 1000;
    assert.equal((await t.call('/api/login', { body: { candidate: 'S001', password: 'initial-pw-1' } })).status, 200);
  } finally { await t.s.close(); }
});

test('initial password must be changed before syncing; password rules are enforced', async () => {
  const t = await start();
  try {
    await addUser(t.s.db, 'S001', 'initial-pw-1');
    const { body: { token } } = await t.call('/api/login', { body: { candidate: 'S001', password: 'initial-pw-1' } });

    const blocked = await t.call('/api/sync', { token, body: { events: [], cursor: 0 } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'password_change_required');

    const wrongOld = await t.call('/api/password', { token, body: { old_password: 'not-it-123', new_password: 'brand-new-pw' } });
    assert.equal(wrongOld.status, 403);
    assert.equal((await t.call('/api/password', { token, body: { old_password: 'initial-pw-1', new_password: 'short' } })).status, 400);
    assert.equal((await t.call('/api/password', { token, body: { old_password: 'initial-pw-1', new_password: 'initial-pw-1' } })).status, 400);

    // a password equal to a (long enough) candidate number is refused, whatever the case
    await addUser(t.s.db, 'CAND-12345', 'initial-pw-9');
    const long = (await t.call('/api/login', { body: { candidate: 'CAND-12345', password: 'initial-pw-9' } })).body.token;
    const same = await t.call('/api/password', { token: long, body: { old_password: 'initial-pw-9', new_password: 'cand-12345' } });
    assert.equal(same.status, 400);
    assert.match(same.body.message, /candidate number/);

    assert.equal((await t.call('/api/password', { token, body: { old_password: 'initial-pw-1', new_password: 'brand-new-pw' } })).status, 200);

    assert.equal((await t.call('/api/sync', { token, body: { events: [], cursor: 0 } })).status, 200);
    assert.equal((await t.call('/api/login', { body: { candidate: 'S001', password: 'initial-pw-1' } })).status, 401);
    const again = await t.call('/api/login', { body: { candidate: 'S001', password: 'brand-new-pw' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.must_change_password, false);
  } finally { await t.s.close(); }
});

test('changing the password logs out the other tablets', async () => {
  const t = await start();
  try {
    const first = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const other = (await t.call('/api/login', { body: { candidate: 'S001', password: 'second-pw-22' } })).body.token;
    assert.equal((await t.call('/api/sync', { token: other, body: { events: [], cursor: 0 } })).status, 200);
    await t.call('/api/password', { token: first, body: { old_password: 'second-pw-22', new_password: 'third-pw-333' } });
    assert.equal((await t.call('/api/sync', { token: other, body: { events: [], cursor: 0 } })).status, 401);
    assert.equal((await t.call('/api/sync', { token: first, body: { events: [], cursor: 0 } })).status, 200);
  } finally { await t.s.close(); }
});

test('sync is idempotent, restores data on a second tablet, and stamps the real owner', async () => {
  const t = await start();
  try {
    const tabletA = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const e1 = entry();
    const e2 = entry({ procedure: 'appendectomy', role: 'supervised' });
    const r1 = await t.call('/api/sync', { token: tabletA, body: { events: [e1, e2], cursor: 0 } });
    assert.deepEqual(r1.body.accepted.sort(), [e1.id, e2.id].sort());
    assert.equal(r1.body.events.length, 2);
    assert.ok(r1.body.cursor > 0);
    const stored = r1.body.events.find((e) => e.id === e1.id);
    assert.equal(stored.student, 'S001'); // client claimed SOMEONE-ELSE

    // resend the same events: no duplicates
    const r2 = await t.call('/api/sync', { token: tabletA, body: { events: [e1, e2], cursor: r1.body.cursor } });
    assert.equal(r2.body.events.length, 0);
    assert.equal(r2.body.cursor, r1.body.cursor);

    // a different tablet logs in and pulls everything from cursor 0
    const tabletB = (await t.call('/api/login', { body: { candidate: 'S001', password: 'second-pw-22' } })).body.token;
    const r3 = await t.call('/api/sync', { token: tabletB, body: { events: [], cursor: 0 } });
    assert.equal(r3.body.events.length, 2);

    // new event on B shows up on A with the cursor
    const e3 = entry({ procedure: 'laparotomy', role: 'observing' });
    await t.call('/api/sync', { token: tabletB, body: { events: [e3], cursor: r3.body.cursor } });
    const r4 = await t.call('/api/sync', { token: tabletA, body: { events: [], cursor: r1.body.cursor } });
    assert.deepEqual(r4.body.events.map((e) => e.id), [e3.id]);
  } finally { await t.s.close(); }
});

test('students cannot see each other\'s data', async () => {
  const t = await start();
  try {
    const a = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const b = await ready(t, 'S002', 'initial-pw-2', 'second-pw-33');
    await t.call('/api/sync', { token: a, body: { events: [entry()], cursor: 0 } });
    const seenByB = await t.call('/api/sync', { token: b, body: { events: [], cursor: 0 } });
    assert.equal(seenByB.body.events.length, 0);
    // the same event id from another student is a separate row, not a collision
    const shared = entry();
    assert.equal((await t.call('/api/sync', { token: a, body: { events: [shared], cursor: 0 } })).body.accepted.length, 1);
    assert.equal((await t.call('/api/sync', { token: b, body: { events: [shared], cursor: 0 } })).body.accepted.length, 1);
  } finally { await t.s.close(); }
});

test('invalid events are rejected individually and never stored', async () => {
  const t = await start();
  try {
    const token = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const good = entry();
    const bad = [
      entry({ role: 'god' }), entry({ performed_on: 'yesterday' }), entry({ procedure: 'DROP TABLE' }),
      entry({ ms_to_log: -5 }), { id: 'short', type: 'entry' }, entry({ type: 'explode' }), null,
    ];
    const r = await t.call('/api/sync', { token, body: { events: [good, ...bad], cursor: 0 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.accepted, [good.id]);
    assert.equal(r.body.rejected.length, bad.length);
    assert.equal(r.body.events.length, 1);
    const tooMany = await t.call('/api/sync', { token, body: { events: Array.from({ length: 201 }, () => entry()), cursor: 0 } });
    assert.equal(tooMany.status, 413);
  } finally { await t.s.close(); }
});

test('large histories are delivered in pages', async () => {
  const t = await start();
  try {
    const token = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    for (let batch = 0; batch < 6; batch++) {
      const events = Array.from({ length: 100 }, () => entry());
      await t.call('/api/sync', { token, body: { events, cursor: 0 } });
    }
    let cursor = 0;
    let total = 0;
    let pages = 0;
    for (;;) {
      const r = await t.call('/api/sync', { token, body: { events: [], cursor } });
      total += r.body.events.length;
      cursor = r.body.cursor;
      pages += 1;
      if (!r.body.has_more) break;
    }
    assert.equal(total, 600);
    assert.equal(pages, 2);
  } finally { await t.s.close(); }
});

test('disabling an account, revoking sessions and resetting a password cut access', async () => {
  const t = await start();
  try {
    const token = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    assert.equal((await t.call('/api/sync', { token, body: { events: [], cursor: 0 } })).status, 200);

    assert.equal(revokeSessions(t.s.db, 'S001'), 1); // the password change already removed the initial session
    assert.equal((await t.call('/api/sync', { token, body: { events: [], cursor: 0 } })).status, 401);

    const again = (await t.call('/api/login', { body: { candidate: 'S001', password: 'second-pw-22' } })).body.token;
    setDisabled(t.s.db, 'S001', true);
    assert.equal((await t.call('/api/sync', { token: again, body: { events: [], cursor: 0 } })).status, 401);
    assert.equal((await t.call('/api/login', { body: { candidate: 'S001', password: 'second-pw-22' } })).status, 401);
    setDisabled(t.s.db, 'S001', false);

    const pw = generatePassword();
    assert.match(pw, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    await resetPassword(t.s.db, 'S001', pw);
    const login = await t.call('/api/login', { body: { candidate: 'S001', password: pw } });
    assert.equal(login.body.must_change_password, true);
  } finally { await t.s.close(); }
});

test('CORS only for the allowed origin; static serving only exposes the app files', async () => {
  const t = await start({ allowedOrigin: 'https://andersmatre.github.io', serveStatic: true });
  try {
    const pre = await fetch(`${t.base}/api/login`, { method: 'OPTIONS', headers: { origin: 'https://andersmatre.github.io', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://andersmatre.github.io');
    // Chrome's extra question when a public page calls a server on localhost
    const pna = await fetch(`${t.base}/api/login`, { method: 'OPTIONS', headers: { origin: 'https://andersmatre.github.io', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
    assert.equal(pna.headers.get('access-control-allow-private-network'), 'true');
    assert.equal(pre.headers.get('access-control-allow-private-network'), null);
    const evil = await fetch(`${t.base}/api/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    assert.equal((await fetch(`${t.base}/`)).status, 200);
    assert.equal((await fetch(`${t.base}/app.js`)).status, 200);
    for (const p of ['/server/lib.js', '/package.json', '/data/logbook.db', '/../package.json', '/.git/config']) {
      assert.equal((await fetch(`${t.base}${p}`)).status, 404, p);
    }
  } finally { await t.s.close(); }
});

// ---- supervisors ------------------------------------------------------------------

// A supervisor account that has chosen its own password; returns its token.
async function supervisorReady(t, id = 'SUP-ANNA', name = 'Dr Anna Kamara') {
  await addUser(t.s.db, id, 'initial-sup-1', { role: 'supervisor', name });
  const login = await t.call('/api/login', { body: { candidate: id, password: 'initial-sup-1' } });
  assert.equal(login.body.role, 'supervisor');
  assert.equal(login.body.name, name);
  const ch = await t.call('/api/password', { token: login.body.token, body: { old_password: 'initial-sup-1', new_password: 'sup-own-secret-1' } });
  assert.equal(ch.status, 200);
  return login.body.token;
}
const sup = (t, token, path, body = {}) => t.call(`/api/sup/${path}`, { token, body });

test('students cannot create signatures; a supervisor cannot use the logbook sync', async () => {
  const t = await start();
  try {
    const student = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const e1 = entry();
    const forged = { id: '22222222-0000-4000-8000-000000000001', type: 'sign', ts: new Date().toISOString(), target: e1.id, supervisor: 'SUP-ANNA' };
    const r = await t.call('/api/sync', { token: student, body: { events: [e1, forged], cursor: 0 } });
    assert.deepEqual(r.body.accepted, [e1.id]);
    assert.deepEqual(r.body.rejected, [{ id: forged.id, reason: 'sign_not_allowed' }]);
    assert.equal(r.body.events.length, 1);

    const supToken = await supervisorReady(t);
    const s = await t.call('/api/sync', { token: supToken, body: { events: [], cursor: 0 } });
    assert.equal(s.status, 403);
    assert.equal(s.body.error, 'wrong_role');
    // and students cannot use the supervisor routes
    for (const p of ['students', 'candidates', 'assign', 'entries', 'sign']) {
      assert.equal((await sup(t, student, p, { candidate: 'S001', ids: [e1.id] })).status, 403, p);
    }
  } finally { await t.s.close(); }
});

test('supervisor: add a student, see the entries, sign them; the student receives the signature', async () => {
  const t = await start();
  try {
    const student = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    await addUser(t.s.db, 'S002', 'initial-pw-2'); // never logged in, still listed
    const supToken = await supervisorReady(t);

    const e1 = entry();
    const e2 = entry({ procedure: 'appendectomy', role: 'supervised' });
    const e3 = entry({ procedure: 'laparotomy', role: 'observing' });
    const voidE3 = { id: '33333333-0000-4000-8000-000000000001', type: 'void', ts: new Date().toISOString(), target: e3.id };
    await t.call('/api/sync', { token: student, body: { events: [e1, e2, e3, voidE3], cursor: 0 } });

    // nothing is visible before the student is added
    assert.deepEqual((await sup(t, supToken, 'students')).body.students, []);
    assert.equal((await sup(t, supToken, 'entries', { candidate: 'S001' })).status, 403);

    const list = (await sup(t, supToken, 'candidates')).body.candidates;
    assert.deepEqual(list, [{ candidate: 'S001', mine: false }, { candidate: 'S002', mine: false }]);
    assert.equal((await sup(t, supToken, 'assign', { candidate: ' s001 ' })).status, 200);
    assert.equal((await sup(t, supToken, 'assign', { candidate: 'S001' })).status, 200); // adding twice is harmless
    assert.equal((await sup(t, supToken, 'assign', { candidate: 'NOBODY' })).status, 404);
    assert.equal((await sup(t, supToken, 'assign', { candidate: 'SUP-ANNA' })).status, 404); // only students can be added

    const students = (await sup(t, supToken, 'students')).body.students;
    assert.equal(students.length, 1);
    assert.equal(students[0].candidate, 'S001');
    assert.equal(students[0].entries, 2, 'the deleted entry is not counted');
    assert.equal(students[0].unsigned, 2);

    // the supervisor sees what is needed to judge an entry, not usage measurements
    const view = (await sup(t, supToken, 'entries', { candidate: 'S001', cursor: 0 })).body;
    assert.equal(view.events.length, 4);
    const seen = view.events.find((e) => e.id === e1.id);
    assert.equal(seen.procedure, 'cs');
    assert.equal(seen.ms_to_log, undefined);
    assert.equal(seen.online, undefined);

    // sign: e1 and e2 work; e3 was deleted; an unknown id is skipped; signing twice is skipped
    const r = await sup(t, supToken, 'sign', { candidate: 'S001', ids: [e1.id, e2.id, e3.id, 'does-not-exist-1', e1.id] });
    assert.equal(r.status, 200);
    assert.equal(r.body.signed, 2);
    assert.deepEqual(r.body.skipped.map((x) => x.reason).sort(), ['deleted by the student', 'not found']);
    const again = await sup(t, supToken, 'sign', { candidate: 'S001', ids: [e1.id] });
    assert.equal(again.body.signed, 0);
    assert.equal(again.body.skipped[0].reason, 'already signed');
    assert.equal((await sup(t, supToken, 'students')).body.students[0].unsigned, 0);

    // the student gets the signatures with the normal sync, including who signed
    const pulled = await t.call('/api/sync', { token: student, body: { events: [], cursor: 0 } });
    const signs = pulled.body.events.filter((e) => e.type === 'sign');
    assert.equal(signs.length, 2);
    assert.deepEqual(signs.map((s) => s.target).sort(), [e1.id, e2.id].sort());
    assert.equal(signs[0].supervisor, 'SUP-ANNA');
    assert.equal(signs[0].supervisor_name, 'Dr Anna Kamara');
    assert.equal(pulled.body.supervisors.length, 1);
    assert.equal(pulled.body.supervisors[0].name, 'Dr Anna Kamara');
  } finally { await t.s.close(); }
});

test('a signed entry can no longer be deleted by the student', async () => {
  const t = await start();
  try {
    const student = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const supToken = await supervisorReady(t);
    const e1 = entry();
    await t.call('/api/sync', { token: student, body: { events: [e1], cursor: 0 } });
    await sup(t, supToken, 'assign', { candidate: 'S001' });
    await sup(t, supToken, 'sign', { candidate: 'S001', ids: [e1.id] });

    const voidIt = { id: '44444444-0000-4000-8000-000000000001', type: 'void', ts: new Date().toISOString(), target: e1.id };
    const r = await t.call('/api/sync', { token: student, body: { events: [voidIt], cursor: 0 } });
    assert.deepEqual(r.body.rejected, [{ id: voidIt.id, reason: 'signed_locked' }]);
    assert.equal(r.body.events.filter((e) => e.type === 'void').length, 0);
  } finally { await t.s.close(); }
});

test('supervisors only reach their own students; removing a student ends the access', async () => {
  const t = await start();
  try {
    const s1 = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const s2 = await ready(t, 'S002', 'initial-pw-2', 'second-pw-33');
    const anna = await supervisorReady(t, 'SUP-ANNA', 'Dr Anna');
    const ben = await supervisorReady(t, 'SUP-BEN', 'Dr Ben');
    const a1 = entry();
    const a2 = entry();
    await t.call('/api/sync', { token: s1, body: { events: [a1], cursor: 0 } });
    await t.call('/api/sync', { token: s2, body: { events: [a2], cursor: 0 } });
    await sup(t, anna, 'assign', { candidate: 'S001' });
    await sup(t, ben, 'assign', { candidate: 'S002' });

    // Anna cannot read or sign Ben's student, even with a valid entry id
    assert.equal((await sup(t, anna, 'entries', { candidate: 'S002' })).status, 403);
    assert.equal((await sup(t, anna, 'sign', { candidate: 'S002', ids: [a2.id] })).status, 403);
    assert.equal((await sup(t, anna, 'sign', { candidate: 'S001', ids: [a2.id] })).body.signed, 0, 'an id that belongs to another student is not found');

    // two supervisors can share one student; the student sees both
    await sup(t, anna, 'assign', { candidate: 'S002' });
    assert.equal((await t.call('/api/sync', { token: s2, body: { events: [], cursor: 0 } })).body.supervisors.length, 2);

    // removing the assignment ends access straight away
    await sup(t, anna, 'unassign', { candidate: 'S001' });
    assert.equal((await sup(t, anna, 'entries', { candidate: 'S001' })).status, 403);
    assert.equal((await t.call('/api/sync', { token: s1, body: { events: [], cursor: 0 } })).body.supervisors.length, 0);

    // a disabled supervisor is logged out and no longer listed for the student
    setDisabled(t.s.db, 'SUP-BEN', true);
    assert.equal((await sup(t, ben, 'students')).status, 401);
    assert.equal((await t.call('/api/sync', { token: s2, body: { events: [], cursor: 0 } })).body.supervisors.length, 1);
  } finally { await t.s.close(); }
});

test('a supervisor must choose their own password before using the supervisor routes', async () => {
  const t = await start();
  try {
    await addUser(t.s.db, 'SUP-ANNA', 'initial-sup-1', { role: 'supervisor', name: 'Dr Anna' });
    const { body: { token } } = await t.call('/api/login', { body: { candidate: 'SUP-ANNA', password: 'initial-sup-1' } });
    const r = await sup(t, token, 'students');
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'password_change_required');
  } finally { await t.s.close(); }
});

test('a database made by v0.2 is upgraded in place and keeps its data', async () => {
  const old = new DatabaseSync(':memory:');
  old.exec(`
    CREATE TABLE users (candidate TEXT PRIMARY KEY, pw_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1,
      disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, candidate TEXT NOT NULL REFERENCES users(candidate), created_at TEXT NOT NULL, last_seen TEXT NOT NULL);
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL REFERENCES users(candidate), id TEXT NOT NULL,
      payload TEXT NOT NULL, received_at TEXT NOT NULL, UNIQUE (owner, id));
    INSERT INTO users VALUES ('S001', 'x', 0, 0, '2026-09-01T00:00:00Z', NULL);
    INSERT INTO events (owner, id, payload, received_at) VALUES ('S001', 'aaaaaaaa-0000', '{"id":"aaaaaaaa-0000","type":"entry"}', '2026-09-01T00:00:00Z');
    INSERT INTO events (owner, id, payload, received_at) VALUES ('S001', 'bbbbbbbb-0000', '{"id":"bbbbbbbb-0000","type":"void","target":"aaaaaaaa-0000"}', '2026-09-01T00:00:00Z');
  `);
  initSchema(old);
  initSchema(old); // running it again changes nothing
  assert.equal(old.prepare("SELECT role FROM users WHERE candidate = 'S001'").get().role, 'student');
  assert.deepEqual(old.prepare('SELECT type, target FROM events ORDER BY seq').all().map((r) => ({ ...r })),
    [{ type: 'entry', target: null }, { type: 'void', target: 'aaaaaaaa-0000' }]);
  assert.ok(old.prepare("SELECT name FROM sqlite_master WHERE name = 'assignments'").get());
});

test('admin backup writes a complete, readable copy and refuses to overwrite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-backup-'));
  const t = await start();
  try {
    const student = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    await t.call('/api/sync', { token: student, body: { events: [entry(), entry()], cursor: 0 } });
    const file = path.join(dir, 'copy.db');
    backupTo(t.s.db, file);
    const copy = openDb(file);
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
    copy.close();
    assert.throws(() => backupTo(t.s.db, file), /already exists/);
  } finally { await t.s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- administrators -----------------------------------------------------------------

async function adminReady(t, id = 'ADMIN-ONE') {
  await addUser(t.s.db, id, 'initial-adm-1', { role: 'admin', name: 'Admin One' });
  const login = await t.call('/api/login', { body: { candidate: id, password: 'initial-adm-1' } });
  assert.equal(login.body.role, 'admin');
  await t.call('/api/password', { token: login.body.token, body: { old_password: 'initial-adm-1', new_password: 'adm-own-secret-1' } });
  return login.body.token;
}
const adm = (t, token, path, body = {}) => t.call(`/api/admin/${path}`, { token, body });

test('administrator routes are closed to students and supervisors, and administrators have no logbook', async () => {
  const t = await start();
  try {
    const student = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const supToken = await supervisorReady(t);
    const admin = await adminReady(t);
    for (const token of [student, supToken]) {
      for (const p of ['users', 'stats', 'audit', 'create', 'reset', 'assign', 'entries']) {
        assert.equal((await adm(t, token, p, { role: 'student', id: 'X1' })).status, 403, p);
      }
    }
    assert.equal((await adm(t, null, 'users')).status, 401);
    assert.equal((await t.call('/api/sync', { token: admin, body: { events: [], cursor: 0 } })).status, 403);
    assert.equal((await sup(t, admin, 'students')).status, 403, 'an administrator cannot sign or add students as a supervisor');
    // an administrator must choose their own password first
    await addUser(t.s.db, 'ADMIN-TWO', 'initial-adm-2', { role: 'admin' });
    const fresh = (await t.call('/api/login', { body: { candidate: 'ADMIN-TWO', password: 'initial-adm-2' } })).body.token;
    assert.equal((await adm(t, fresh, 'users')).body.error, 'password_change_required');
  } finally { await t.s.close(); }
});

test('administrator creates accounts; the initial password is shown once and must be changed', async () => {
  const t = await start();
  try {
    const admin = await adminReady(t);
    const one = await adm(t, admin, 'create', { role: 'student', id: ' cc 1234 ' });
    assert.equal(one.status, 200);
    assert.equal(one.body.id, 'CC1234');
    assert.match(one.body.password, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const login = await t.call('/api/login', { body: { candidate: 'CC1234', password: one.body.password } });
    assert.equal(login.body.must_change_password, true);

    const sp = await adm(t, admin, 'create', { role: 'supervisor', id: 'SUP-ANNA', name: '  Dr  Anna Kamara ' });
    assert.equal(sp.status, 200);
    const spLogin = await t.call('/api/login', { body: { candidate: 'SUP-ANNA', password: sp.body.password } });
    assert.equal(spLogin.body.role, 'supervisor');
    assert.equal(spLogin.body.name, 'Dr Anna Kamara');

    assert.equal((await adm(t, admin, 'create', { role: 'student', id: 'CC1234' })).status, 409);
    assert.equal((await adm(t, admin, 'create', { role: 'student', id: '!' })).status, 400);
    assert.equal((await adm(t, admin, 'create', { role: 'owner', id: 'X123' })).status, 400);

    const many = await adm(t, admin, 'create_many', { ids: ['cc2001', 'CC2002', 'cc 2001', 'CC1234', 'bad id!', '', 'CC2003'] });
    assert.deepEqual(many.body.created.map((c) => c.id), ['CC2001', 'CC2002', 'CC2003']);
    assert.deepEqual(many.body.skipped.map((c) => c.reason).sort(), ['already exists', 'not a valid id']);
    assert.equal(new Set(many.body.created.map((c) => c.password)).size, 3, 'each account gets its own password');
    assert.equal((await adm(t, admin, 'create_many', { ids: [] })).status, 400);
    assert.equal((await adm(t, admin, 'create_many', { ids: Array.from({ length: 101 }, (_, i) => `ZZ${i}`) })).status, 413);

    const users = (await adm(t, admin, 'users')).body.users;
    assert.deepEqual(users.map((u) => u.id), ['ADMIN-ONE', 'SUP-ANNA', 'CC1234', 'CC2001', 'CC2002', 'CC2003']);
    assert.equal(users.find((u) => u.id === 'ADMIN-ONE').password_set, true);
    assert.equal(users.find((u) => u.id === 'CC1234').password_set, false);
  } finally { await t.s.close(); }
});

test('administrator can reset, disable, enable and log out accounts, but not harm their own', async () => {
  const t = await start();
  try {
    const admin = await adminReady(t);
    const student = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');

    const rst = await adm(t, admin, 'reset', { id: 's001' });
    assert.equal(rst.status, 200);
    assert.equal((await t.call('/api/sync', { token: student, body: { events: [], cursor: 0 } })).status, 401, 'reset logs the student out everywhere');
    const again = await t.call('/api/login', { body: { candidate: 'S001', password: rst.body.password } });
    assert.equal(again.body.must_change_password, true);

    assert.equal((await adm(t, admin, 'disable', { id: 'S001' })).status, 200);
    assert.equal((await t.call('/api/login', { body: { candidate: 'S001', password: rst.body.password } })).status, 401);
    assert.equal((await adm(t, admin, 'enable', { id: 'S001' })).status, 200);
    assert.equal((await t.call('/api/login', { body: { candidate: 'S001', password: rst.body.password } })).status, 200);
    assert.equal((await adm(t, admin, 'revoke', { id: 'S001' })).body.sessions >= 1, true);

    assert.equal((await adm(t, admin, 'reset', { id: 'ADMIN-ONE' })).body.error, 'not_yourself');
    assert.equal((await adm(t, admin, 'disable', { id: 'ADMIN-ONE' })).body.error, 'not_yourself');
    assert.equal((await adm(t, admin, 'reset', { id: 'NOBODY' })).status, 404);
    assert.equal((await adm(t, admin, 'users')).status, 200, 'the administrator is still logged in');
  } finally { await t.s.close(); }
});

test('administrator assigns supervisors, sees every student, and the audit log records it without passwords', async () => {
  const t = await start();
  try {
    const admin = await adminReady(t);
    const s1 = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    await ready(t, 'S002', 'initial-pw-2', 'second-pw-33');
    const supToken = await supervisorReady(t, 'SUP-ANNA', 'Dr Anna');
    const e1 = entry();
    await t.call('/api/sync', { token: s1, body: { events: [e1], cursor: 0 } });

    assert.equal((await adm(t, admin, 'assign', { supervisor: 'SUP-ANNA', student: 'S001' })).status, 200);
    assert.equal((await adm(t, admin, 'assign', { supervisor: 'S001', student: 'S002' })).status, 400, 'the first must be a supervisor');
    assert.equal((await sup(t, supToken, 'students')).body.students[0].candidate, 'S001');
    const listed = (await adm(t, admin, 'users')).body.users;
    assert.deepEqual(listed.find((u) => u.id === 'S001').supervisors, [{ id: 'SUP-ANNA', name: 'Dr Anna' }]);
    assert.deepEqual(listed.find((u) => u.id === 'SUP-ANNA').students, ['S001']);

    // an administrator can read a student's entries, but not sign
    const view = await adm(t, admin, 'entries', { candidate: 'S001', cursor: 0 });
    assert.equal(view.body.events.length, 1);
    assert.equal(view.body.events[0].ms_to_log, undefined);
    assert.equal((await adm(t, admin, 'entries', { candidate: 'SUP-ANNA' })).status, 400);
    assert.equal((await adm(t, admin, 'sign', { candidate: 'S001', ids: [e1.id] })).status, 404);

    assert.equal((await adm(t, admin, 'unassign', { supervisor: 'SUP-ANNA', student: 'S001' })).status, 200);
    assert.deepEqual((await sup(t, supToken, 'students')).body.students, []);

    // supervisors adding students themselves is recorded too
    await sup(t, supToken, 'assign', { candidate: 'S002' });
    await adm(t, admin, 'reset', { id: 'S002' });
    const log = (await adm(t, admin, 'audit')).body.log;
    const actions = log.map((l) => `${l.actor}:${l.action}:${l.target}`);
    assert.ok(actions.includes('ADMIN-ONE:assign:S001'));
    assert.ok(actions.includes('ADMIN-ONE:unassign:S001'));
    assert.ok(actions.includes('SUP-ANNA:assign:S002'), 'who added whom is recorded');
    assert.ok(actions.includes('ADMIN-ONE:reset_password:S002'));
    assert.equal(log[0].action, 'reset_password', 'newest first');
    assert.doesNotMatch(JSON.stringify(log), /password":"|[a-z2-9]{5}-[a-z2-9]{5}/, 'no password ever in the log');
  } finally { await t.s.close(); }
});

test('the overview counts live entries per procedure and per student', async () => {
  const t = await start();
  try {
    const admin = await adminReady(t);
    const a = await ready(t, 'S001', 'initial-pw-1', 'second-pw-22');
    const b = await ready(t, 'S002', 'initial-pw-2', 'second-pw-33');
    await ready(t, 'S003', 'initial-pw-3', 'second-pw-44'); // nothing logged
    const supToken = await supervisorReady(t);

    const a1 = entry({ procedure: 'cs', role: 'independent', performed_on: '2026-10-01' });
    const a2 = entry({ procedure: 'cs', role: 'observing', performed_on: '2026-10-05' });
    const a3 = entry({ procedure: 'appendectomy', role: 'supervised', performed_on: '2026-10-03' });
    const a4 = entry({ procedure: 'laparotomy', role: 'assisting' });
    const voidA4 = { id: '55555555-0000-4000-8000-000000000001', type: 'void', ts: new Date().toISOString(), target: a4.id };
    const b1 = entry({ procedure: 'cs', role: 'supervised', performed_on: '2026-10-09' });
    await t.call('/api/sync', { token: a, body: { events: [a1, a2, a3, a4, voidA4], cursor: 0 } });
    await t.call('/api/sync', { token: b, body: { events: [b1], cursor: 0 } });
    await sup(t, supToken, 'assign', { candidate: 'S001' });
    await sup(t, supToken, 'sign', { candidate: 'S001', ids: [a1.id] });

    const r = (await adm(t, admin, 'stats')).body;
    assert.deepEqual(r.totals, { students: 3, supervisors: 1, entries: 4, signed: 1, unsigned: 3 });
    const cs = r.procedures.find((p) => p.procedure === 'cs');
    assert.deepEqual({ ...cs }, { procedure: 'cs', observing: 1, assisting: 0, supervised: 1, independent: 1, total: 3, performed: 2, students: 2 });
    assert.equal(r.procedures.find((p) => p.procedure === 'laparotomy'), undefined, 'a deleted entry is not counted');
    assert.equal(r.procedures[0].procedure, 'cs', 'most frequent first');

    const s1 = r.students.find((s) => s.candidate === 'S001');
    assert.equal(s1.entries, 3);
    assert.equal(s1.performed, 2);
    assert.equal(s1.signed, 1);
    assert.equal(s1.last_performed_on, '2026-10-05');
    assert.deepEqual(s1.by_procedure.cs, { performed: 1, total: 2 });
    assert.equal(r.students.find((s) => s.candidate === 'S003').entries, 0, 'students without entries are listed too');
  } finally { await t.s.close(); }
});

test('the first administrator can be created from settings, once, without touching an existing account', async () => {
  const db = openDb(':memory:');
  assert.equal(await bootstrapAdmin(db, 'admin-anders', 'first-secret-1'), 'ADMIN-ANDERS');
  const row = db.prepare("SELECT role, must_change FROM users WHERE candidate = 'ADMIN-ANDERS'").get();
  assert.equal(row.role, 'admin');
  assert.equal(row.must_change, 1, 'must choose their own password at first login');
  const hash = db.prepare("SELECT pw_hash FROM users WHERE candidate = 'ADMIN-ANDERS'").get().pw_hash;
  assert.equal(await bootstrapAdmin(db, 'ADMIN-ANDERS', 'another-secret-2'), null, 'second start creates nothing');
  assert.equal(db.prepare("SELECT pw_hash FROM users WHERE candidate = 'ADMIN-ANDERS'").get().pw_hash, hash, 'and does not reset the password');
  assert.equal(await bootstrapAdmin(db, '', 'x'), null);
  await assert.rejects(() => bootstrapAdmin(db, 'bad id!', 'secret-secret'), /not a valid/);
  assert.equal(db.prepare("SELECT actor FROM audit WHERE action = 'create'").get().actor, 'startup');
});
