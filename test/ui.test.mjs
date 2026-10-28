// Smoke test of the whole user flow in jsdom: setup -> log -> undo -> sign -> progress -> export.
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.scrollTo = () => {};
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.URL.createObjectURL = () => 'blob:test';

const { init } = await import('../app.js');
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const click = async (el) => { assert.ok(el, 'element to click exists'); el.click(); await wait(); };
const byText = (sel, text, scope = document) => $$(sel, scope).find((e) => e.textContent.includes(text));

test('full flow', async () => {
  await init();
  await wait();

  // setup: rejects an empty code, accepts S01
  await click($('.setup-form button[type=submit]'));
  assert.match($('.error').textContent, /Enter the code/);
  $('#code').value = 's01';
  await click($('.setup-form button[type=submit]'));
  assert.ok($('.top'), 'main screen shown after setup');
  assert.match($('.who').textContent, /S01/);

  // Log tab shows ten procedure buttons
  assert.equal($$('.proc').length, 10);

  // log a caesarean section as independent: procedure tap, then role tap
  await click(byText('.proc', 'Caesarean section'));
  assert.ok($('.sheet'), 'role sheet open');
  assert.equal($$('.role').length, 4);
  await click(byText('.role', 'Surgeon, independent'));
  assert.ok(!$('.sheet'), 'sheet closed after saving');
  assert.match($('#toast').textContent, /Saved/);
  assert.match($('#toast').textContent, /1 of 30 performed/);
  assert.match(byText('.proc', 'Caesarean section').textContent, /1 logged/);

  // undo removes it again
  await click($('.t-act'));
  assert.match(byText('.proc', 'Caesarean section').textContent, /0 logged/);

  // log two entries for real; one from the "more procedures" list
  await click(byText('.proc', 'Inguinal hernia repair'));
  await click(byText('.role', 'Surgeon, supervised'));
  await click(byText('.btn', 'More procedures'));
  const search = $('.search');
  search.value = 'abscess';
  search.dispatchEvent(new window.Event('input'));
  await wait(10);
  assert.equal($$('.row-btn').length, 1);
  await click($('.row-btn'));
  await click(byText('.role', 'Observing'));

  // History: two unsigned entries, sign-off with wrong then right PIN
  await click(byText('.tab', 'History'));
  assert.equal($$('.entry').length, 2);
  assert.match(byText('.tab', 'History').textContent, /2/); // unsigned badge
  await click(byText('.btn', 'Supervisor sign-off'));
  $('.pin').value = '9999';
  await click(byText('.btn', 'Next'));
  assert.match($('.error').textContent, /Wrong PIN/);
  $('.pin').value = '1111';
  await click(byText('.btn', 'Next'));
  assert.equal($$('.signlist input[type=checkbox]').length, 2);
  $$('.signlist input[type=checkbox]')[1].checked = false; // untick one
  await click(byText('.btn', 'Sign selected'));
  assert.equal($$('.tag.ok').length, 1);
  assert.equal($$('.tag.warn').length, 1);

  // Progress tab
  await click(byText('.tab', 'Progress'));
  assert.equal($$('.stat strong').map((e) => e.textContent).join(','), '2,1,2');
  assert.match($('.summary').textContent, /Logged: 2/);

  // More tab: sync is simulated, data deleted on request
  await click(byText('.tab', 'More'));
  assert.match(document.body.textContent, /Waiting to sync/);
  await click(byText('.btn', 'Sync now'));
  await wait(1100);
  assert.match(document.body.textContent, /Synced/);
  await click(byText('.btn', 'Delete all data'));
  await click(byText('.btn', 'Delete everything'));
  assert.ok($('.setup'), 'back to setup after wipe');
});
