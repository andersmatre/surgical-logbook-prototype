import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/app.js';
import { addUser, setDisabled, revokeSessions, resetPassword, generatePassword } from '../server/lib.js';

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
    const sign = { id: '11111111-0000-4000-8000-000000000001', type: 'sign', ts: new Date().toISOString(), target: e1.id, supervisor: 'sup_a' };

    const r1 = await t.call('/api/sync', { token: tabletA, body: { events: [e1, e2, sign], cursor: 0 } });
    assert.deepEqual(r1.body.accepted.sort(), [e1.id, e2.id, sign.id].sort());
    assert.equal(r1.body.events.length, 3);
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
    assert.equal(r3.body.events.length, 3);

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
    const evil = await fetch(`${t.base}/api/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    assert.equal((await fetch(`${t.base}/`)).status, 200);
    assert.equal((await fetch(`${t.base}/app.js`)).status, 200);
    for (const p of ['/server/lib.js', '/package.json', '/data/logbook.db', '/../package.json', '/.git/config']) {
      assert.equal((await fetch(`${t.base}${p}`)).status, 404, p);
    }
  } finally { await t.s.close(); }
});
