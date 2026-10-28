import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';

test.beforeEach(async () => { await core.wipeAll(); });

const base = { student: 'S01', hospital: 'Masanga Hospital', online: true };

test('logging, voiding and signing derive the right state', async () => {
  const a = await core.logEntry({ ...base, procedure: 'cs', role: 'independent', ms_to_log: 4000 });
  const b = await core.logEntry({ ...base, procedure: 'cs', role: 'observing', ms_to_log: 6000 });
  const c = await core.logEntry({ ...base, procedure: 'appendectomy', role: 'supervised', ms_to_log: 5000, online: false });
  await core.voidEntry(b.id);
  await core.signEntries([a.id], 'sup_a');

  const events = await core.allEvents();
  assert.equal(events.length, 5); // 3 entries + 1 void + 1 sign: nothing was edited or removed
  const entries = core.derive(events);
  assert.equal(entries.length, 2);
  assert.ok(entries.find((e) => e.id === a.id).sign);
  assert.equal(entries.find((e) => e.id === c.id).sign, null);

  const p = core.progress(entries);
  assert.equal(p.cs.performed, 1);
  assert.equal(p.cs.observing, 0); // the voided one is gone
  assert.equal(p.appendectomy.performed, 1);

  const m = core.metrics(events, { undo_count: 1, open_count: 3 });
  assert.equal(m.entries_total, 3);
  assert.equal(m.entries_active, 2);
  assert.equal(m.entries_voided, 1);
  assert.equal(m.entries_signed, 1);
  assert.equal(m.entries_logged_offline, 1);
  assert.equal(m.median_ms_procedure_tap_to_saved, 5000);
  assert.equal(m.undo_count, 1);
});

test('late entries are flagged and the weekly summary only counts the last 7 days', async () => {
  const today = new Date();
  const old = new Date(today); old.setDate(old.getDate() - 20);
  await core.logEntry({ ...base, procedure: 'cs', role: 'independent', ms_to_log: 1000 });
  await core.logEntry({ ...base, procedure: 'cs', role: 'supervised', ms_to_log: 1000, performed_on: core.localDateISO(old) });
  const entries = core.derive(await core.allEvents());
  assert.equal(core.metrics(await core.allEvents()).late_entries, 1);
  assert.equal(core.weekEntries(entries).length, 1);
  const text = core.weeklySummary(entries, { student: 'S01' });
  assert.match(text, /Logged: 1 \(0 signed\)/);
  assert.match(text, /Caesarean section: 2\/30/); // cumulative progress includes the old entry
  assert.doesNotMatch(text, /patient/i);
});

test('sync bookkeeping: only events the server has not confirmed count as unsynced', async () => {
  const a = await core.logEntry({ ...base, procedure: 'cs', role: 'observing', ms_to_log: 1 });
  await core.logEntry({ ...base, procedure: 'cs', role: 'assisting', ms_to_log: 1 });
  let events = await core.allEvents();
  assert.equal(core.unsyncedCount(events, await core.sentIds()), 2);
  await core.markSent([a.id]);
  assert.equal(core.unsyncedCount(events, await core.sentIds()), 1);
});

test('events pulled from the server are stored once and count as already sent', async () => {
  const fromServer = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'entry', ts: '2026-10-01T08:00:00.000Z', student: 'S001', hospital: 'Bo Government Hospital', procedure: 'cs', role: 'independent', performed_on: '2026-10-01', entered_on: '2026-10-01', ms_to_log: 3000, online: true, schema: 1 },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'entry', ts: '2026-10-02T08:00:00.000Z', student: 'S001', hospital: 'Bo Government Hospital', procedure: 'appendectomy', role: 'observing', performed_on: '2026-10-02', entered_on: '2026-10-02', ms_to_log: 3000, online: true, schema: 1 },
  ];
  assert.equal(await core.addPulled(fromServer), 2);
  assert.equal(await core.addPulled(fromServer), 0); // the same events again: nothing new
  const events = await core.allEvents();
  assert.equal(events.length, 2);
  assert.equal(core.unsyncedCount(events, await core.sentIds()), 0);
  assert.equal(core.derive(events).length, 2);
});

test('each student has a separate local database', async () => {
  core.useUser('S001');
  await core.wipeAll();
  await core.logEntry({ ...base, procedure: 'cs', role: 'observing', ms_to_log: 1 });
  assert.equal((await core.allEvents()).length, 1);

  core.useUser('S002');
  await core.wipeAll();
  assert.equal((await core.allEvents()).length, 0); // S002 does not see S001's entry
  await core.logEntry({ ...base, student: 'S002', procedure: 'laparotomy', role: 'assisting', ms_to_log: 1 });

  core.useUser('S001');
  assert.equal((await core.allEvents()).length, 1);
  await core.wipeAll(); // logging out S001 leaves S002 alone
  core.useUser('S002');
  assert.equal((await core.allEvents()).length, 1);
  await core.wipeAll();
  core.useUser('default-test-user');
});

test('export contains events and metrics, and wipeAll removes everything', async () => {
  await core.setMeta('profile', { student: 'S01', hospital: 'Masanga Hospital' });
  await core.logEntry({ ...base, procedure: 'cs', role: 'observing', ms_to_log: 1 });
  const events = await core.allEvents();
  const out = core.buildExport(events, { profile: await core.getMeta('profile') });
  assert.equal(out.events.length, 1);
  assert.equal(out.profile.student, 'S01');
  assert.equal(out.metrics.entries_active, 1);
  JSON.stringify(out); // must be serialisable

  await core.wipeAll();
  assert.equal((await core.allEvents()).length, 0);
  assert.equal(await core.getMeta('profile'), null);
});
