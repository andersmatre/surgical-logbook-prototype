import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';

test.beforeEach(async () => { await core.wipeAll(); });

const base = { student: 'S01', hospital: 'Masanga Hospital' };

test('logging, voiding and signing derive the right state', async () => {
  const a = await core.logEntry({ ...base, procedure: 'cs', role: 'independent' });
  const b = await core.logEntry({ ...base, procedure: 'cs', role: 'observing' });
  const c = await core.logEntry({ ...base, procedure: 'appendectomy', role: 'supervised' });
  await core.voidEntry(b.id);
  // signatures are made by a supervisor on the server and arrive with the sync
  await core.addPulled([{ id: 'aaaaaaaa-5151-4000-8000-000000000001', type: 'sign', ts: new Date().toISOString(), target: a.id, supervisor: 'SUP-ANNA', supervisor_name: 'Dr Anna' }]);

  const events = await core.allEvents();
  assert.equal(events.length, 5); // 3 entries + 1 void + 1 sign: nothing was edited or removed
  const entries = core.derive(events);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.id === a.id).sign.supervisor_name, 'Dr Anna');
  assert.equal(entries.find((e) => e.id === c.id).sign, null);

  const p = core.progress(entries);
  assert.equal(p.cs.performed, 1);
  assert.equal(p.cs.observing, 0); // the voided one is gone
  assert.equal(p.appendectomy.performed, 1);

  const m = core.metrics(events);
  assert.equal(m.entries_total, 3);
  assert.equal(m.entries_active, 2);
  assert.equal(m.entries_voided, 1);
  assert.equal(m.entries_signed, 1);
  // How the app is used is not measured: no seconds to log, offline flag or undo count anywhere.
  assert.equal(events[0].ms_to_log, undefined);
  assert.equal(events[0].online, undefined);
  assert.deepEqual(Object.keys(m).filter((k) => /ms|offline|undo|open/.test(k)), []);
});

test('late entries are flagged and "this week" only counts the last 7 days', async () => {
  const today = new Date();
  const old = new Date(today); old.setDate(old.getDate() - 20);
  await core.logEntry({ ...base, procedure: 'cs', role: 'independent' });
  await core.logEntry({ ...base, procedure: 'cs', role: 'supervised', performed_on: core.localDateISO(old) });
  const entries = core.derive(await core.allEvents());
  assert.equal(core.metrics(await core.allEvents()).late_entries, 1);
  assert.equal(core.weekEntries(entries).length, 1);
  assert.equal(core.progress(entries).cs.performed, 2, 'progress counts the old entry too');
});

test('sync bookkeeping: only events the server has not confirmed count as unsynced', async () => {
  const a = await core.logEntry({ ...base, procedure: 'cs', role: 'observing' });
  await core.logEntry({ ...base, procedure: 'cs', role: 'assisting' });
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
  await core.logEntry({ ...base, procedure: 'cs', role: 'observing' });
  assert.equal((await core.allEvents()).length, 1);

  core.useUser('S002');
  await core.wipeAll();
  assert.equal((await core.allEvents()).length, 0); // S002 does not see S001's entry
  await core.logEntry({ ...base, student: 'S002', procedure: 'laparotomy', role: 'assisting' });

  core.useUser('S001');
  assert.equal((await core.allEvents()).length, 1);
  await core.wipeAll(); // logging out S001 leaves S002 alone
  core.useUser('S002');
  assert.equal((await core.allEvents()).length, 1);
  await core.wipeAll();
  core.useUser('default-test-user');
});

test('History groups entries by the day they were done, newest first', () => {
  const e = (id, performed_on) => ({ id, performed_on });
  // as derive() gives them: newest logged first; c was logged last but done in September
  const groups = core.byDay([e('c', '2026-09-30'), e('b', '2026-11-02'), e('a', '2026-11-02'), e('d', '2026-10-15'), e('x', '2025-12-01')]);
  assert.deepEqual(groups.map((g) => [g.day, g.entries.map((x) => x.id)]),
    [['2026-11-02', ['b', 'a']], ['2026-10-15', ['d']], ['2026-09-30', ['c']], ['2025-12-01', ['x']]], 'same day keeps its order');
  assert.equal(core.fmtDay('2026-11-05', '2026-11-05'), 'Today');
  assert.equal(core.fmtDay('2026-11-04', '2026-11-05'), 'Yesterday');
  assert.equal(core.fmtDay('2026-03-01', '2026-03-02'), 'Yesterday', 'also across the start of a month');
  assert.equal(core.fmtDay('2026-11-02', '2026-11-05'), 'Monday 2 Nov', 'this year: the weekday and the date');
  assert.equal(core.fmtDay('2025-12-01', '2026-11-05'), 'Monday 1 Dec 2025', 'an earlier year: with the year');
});

test('wipeAll removes everything', async () => {
  await core.setMeta('profile', { student: 'S01', hospital: 'Masanga Hospital' });
  await core.logEntry({ ...base, procedure: 'cs', role: 'observing' });
  assert.equal((await core.allEvents()).length, 1);

  await core.wipeAll();
  assert.equal((await core.allEvents()).length, 0);
  assert.equal(await core.getMeta('profile'), null);
});

test('dropEvent removes one event from the log and from the sent list', async () => {
  const a = await core.logEntry({ ...base, procedure: 'cs', role: 'observing' });
  const v = await core.voidEntry(a.id);
  await core.markSent([v.id]);
  await core.dropEvent(v.id);
  const events = await core.allEvents();
  assert.deepEqual(events.map((e) => e.id), [a.id]);
  assert.equal((await core.sentIds()).has(v.id), false);
  assert.equal(core.derive(events).length, 1); // the entry is back
});

test('details are stored with the entry; follow-ups are added on top, newest answer wins, and can be undone', async () => {
  const a = await core.logEntry({ ...base, procedure: 'cs', role: 'independent', details: { anaesthesia: 'spinal', duration_min: 40 } });
  const b = await core.logEntry({ ...base, procedure: 'cs', role: 'assisting', details: {} });
  assert.deepEqual(a.details, { anaesthesia: 'spinal', duration_min: 40 });
  assert.equal('details' in b, false, 'no answers, no details field');

  const f1 = await core.addFollowUp(a.id, { mother: 'alive', baby: 'alive' });
  await new Promise((r) => setTimeout(r, 5)); // a later ts
  await core.addFollowUp(a.id, { baby: 'died' });
  const wrong = await core.addFollowUp(b.id, { complication: 'bleeding' });
  await core.voidEntry(wrong.id); // Undo
  assert.equal(f1.known_on, core.localDateISO());

  const events = await core.allEvents();
  assert.equal(events.filter((e) => e.type === 'entry').length, 2, 'the entries themselves never change');
  const entries = core.derive(events);
  const ea = entries.find((e) => e.id === a.id);
  assert.deepEqual(ea.outcome, { mother: 'alive', baby: 'died' });
  assert.equal(ea.followups.length, 2);
  assert.deepEqual(entries.find((e) => e.id === b.id).outcome, {}, 'the undone follow-up is gone');
  assert.equal(entries.length, 2, 'voiding a follow-up does not remove the entry');

  const { DETAIL_FIELDS, FOLLOWUP_FIELDS } = await import('../config.js');
  assert.equal(core.answersText(DETAIL_FIELDS, ea.details), 'Anaesthesia: Spinal or epidural · Operation time: 40 minutes');
  assert.equal(core.answersText(FOLLOWUP_FIELDS, ea.outcome), 'Mother: Alive · Baby: Died after birth');
  assert.equal(core.answersText(DETAIL_FIELDS, undefined), '');

  assert.equal(core.followUpOpen({ performed_on: '2026-09-17' }, '2026-10-29'), true, '42 days: still open');
  assert.equal(core.followUpOpen({ performed_on: '2026-09-16' }, '2026-10-29'), false, '43 days: closed');

  const m = core.metrics(events);
  assert.equal(m.entries_with_details, 1);
  assert.equal(m.followups, 3);
});

test('the procedure list: ids are valid and unique, every group and Log-tab button exists, roles are worded per procedure', async () => {
  const cfg = await import('../config.js');
  const ids = cfg.ALL_PROCEDURES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no id is used twice, retired ones included');
  for (const id of ids) assert.match(id, /^[a-z0-9_]{1,40}$/, `${id} is an id the server accepts`);
  const groups = new Set(cfg.PROCEDURE_GROUPS.map((g) => g.id));
  for (const p of cfg.PROCEDURES) assert.ok(p.group ? groups.has(p.group) : p.delivery, `${p.id} is an operation in a known group, or a delivery`);
  for (const g of groups) assert.ok(cfg.PROCEDURES.some((p) => p.group === g && p.id === `other_${g}`), `the group ${g} has an "Other"`);
  for (const id of [...cfg.LOG_SURGERY, ...cfg.LOG_DELIVERIES, ...Object.keys(cfg.TARGETS)]) {
    assert.ok(cfg.PROCEDURES.some((p) => p.id === id), `${id} is offered`);
  }
  for (const id of cfg.LOG_SURGERY) assert.ok(cfg.findProcedure(id).group, `${id} is an operation`);
  for (const id of cfg.LOG_DELIVERIES) assert.ok(cfg.findProcedure(id).delivery, `${id} is a delivery`);
  // The ids of the first list are kept, so entries made before still show a name.
  for (const id of ['cs', 'ing_hernia', 'abscess', 'placenta', 'burns', 'other']) assert.notEqual(cfg.procName(id), id);

  // A caesarean is an operation and keeps the surgical wording; a normal delivery uses the obstetric logbook's.
  assert.equal(cfg.roleLabel('independent', 'cs'), 'Surgeon, independent');
  assert.equal(cfg.roleLabel('independent', 'normal_delivery'), 'Delivered alone');
  assert.equal(cfg.roleDone('supervised', 'forceps_delivery'), 'Delivered with supervisor');
  assert.equal(cfg.roleDone('observing', 'normal_delivery'), 'Observed');
  assert.equal(cfg.roleDone('supervised', 'not_a_procedure'), 'Operated with supervisor');
  assert.equal(cfg.roleLabel('nonsense'), 'nonsense');
  // Everything is logged afterwards: the roles are in the past tense everywhere, the stored ids stay as they are.
  assert.deepEqual(cfg.ROLES.map((r) => [r.id, r.label]).slice(0, 2), [['observing', 'Observed'], ['assisting', 'Assisted']]);
  assert.ok(cfg.ROLES.every((r) => !/ing\b/.test(r.label) && !/ing\b/.test(r.done) && !/ing\b/.test(r.birth.label || '')), 'no "-ing" words');
  // The questions: an operation, a delivery, or both (each question once); every id is a known question.
  const ids2 = (parts) => parts.flatMap((p) => p.ids);
  assert.ok(ids2(cfg.detailFieldsFor('appendectomy')).includes('sapgar_hr') && !ids2(cfg.detailFieldsFor('appendectomy')).includes('gravida'));
  assert.ok(ids2(cfg.detailFieldsFor('normal_delivery')).includes('baby2_weight_g') && !ids2(cfg.detailFieldsFor('normal_delivery')).includes('anaesthesia'));
  for (const p of cfg.PROCEDURES) {
    const d = ids2(cfg.detailFieldsFor(p.id));
    const f = ids2(cfg.followupFieldsFor(p.id));
    assert.equal(new Set(d).size, d.length, `${p.id} asks each detail once`);
    assert.equal(new Set(f).size, f.length, `${p.id} asks each follow-up once`);
    for (const id of d) assert.ok(cfg.DETAIL_FIELDS[id], `${id} is a detail question`);
    for (const id of f) assert.ok(cfg.FOLLOWUP_FIELDS[id], `${id} is a follow-up question`);
  }
  assert.ok(ids2(cfg.detailFieldsFor('cs')).includes('cs_reason') && ids2(cfg.detailFieldsFor('cs')).includes('sapgar_map'), 'a caesarean asks both logbooks');
  assert.ok(ids2(cfg.followupFieldsFor('cs')).includes('mother') && !ids2(cfg.followupFieldsFor('cs')).includes('patient'));
  // Surgical Apgar: the three parts added up; the blood loss can come from millilitres.
  assert.equal(cfg.surgicalApgar({ sapgar_blood: '2', sapgar_map: '3', sapgar_hr: '1' }), 6);
  assert.equal(cfg.surgicalApgar({ blood_loss_ml: 1200, sapgar_map: '3', sapgar_hr: '4' }), 7);
  assert.equal(cfg.surgicalApgar({ sapgar_map: '3', sapgar_hr: '4' }), null);
  assert.ok(cfg.HOSPITALS.includes('Masanga Hospital') && cfg.HOSPITALS.includes('Bo Government Hospital'), 'names already stored on tablets are still in the list');
});
