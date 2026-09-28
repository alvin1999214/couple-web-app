// Run with: node --test tests/test_frontend.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../static/app.js`, 'utf8');

function app() {
  const context = vm.createContext({
    document: { documentElement: { classList: { toggle() {} } } },
    window: { matchMedia: () => ({ matches: false }), navigator: {} },
    AbortController, setTimeout, clearTimeout, URLSearchParams,
  });
  vm.runInContext(source.slice(0, source.lastIndexOf('\nsetupTime();')), context);
  return context;
}

for (const [label, spent_on, category] of [
  ['older receipt', '2026-08-25', 'dining'],
  ['previous year same month', '2025-09-26', 'dining'],
  ['previous year end', '2025-12-31', 'dining'],
  ['historical leap day', '2024-02-29', 'dining'],
  ['different category', '2026-09-25', 'groceries'],
  ['future receipt', '2026-10-01', 'dining'],
]) {
  test(`saved expense becomes visible: ${label}`, () => {
    const c = app();
    vm.runInContext(`state.data = { filter: { date_from: '2026-09-01', date_to: '2026-09-30', category: 'dining' } };`, c);
    const payload = { spent_on, category };
    assert.equal(c.revealSavedExpense(payload), true);
    assert.equal(payload.spent_on, spent_on);
    assert.equal(vm.runInContext('state.month', c), spent_on.slice(0, 7));
    assert.equal(vm.runInContext('state.category', c), 'all');
    assert.equal(vm.runInContext('state.period', c), 'month');
  });
}

test('a matching receipt preserves current filters', () => {
  const c = app();
  vm.runInContext(`state.period = 'today'; state.data = { filter: { date_from: '2026-09-26', date_to: '2026-09-26', category: 'dining' } };`, c);
  assert.equal(c.revealSavedExpense({ spent_on: '2026-09-26', category: 'dining' }), false);
  assert.equal(vm.runInContext('state.period', c), 'today');
});

test('HTTP 200 with invalid JSON must not count as success', async () => {
  const c = app();
  c.fetch = async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } });
  await assert.rejects(c.api('/api/expenses'), /回應不完整/);
});

test('API deadline still works when caller supplies a signal', async () => {
  const c = app();
  c.fetch = (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
  });
  await assert.rejects(c.api('/api/expenses/ocr', { signal: new AbortController().signal, timeoutMs: 10 }), /逾時/);
});

test('caller cancellation reaches fetch', async () => {
  const c = app();
  c.fetch = (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
  });
  const controller = new AbortController();
  const request = c.api('/api/expenses/ocr', { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, /取消/);
});

function submission() {
  const c = app();
  const button = {};
  const status = {};
  const form = { dataset: { formType: 'expense', method: 'POST', endpoint: '/api/expenses', success: 'saved' } };
  c.FormData = class { *[Symbol.iterator]() { yield ['title', 'Receipt']; yield ['amount', '10']; yield ['spent_on', '2026-08-25']; yield ['category', 'other']; } };
  form.querySelector = (selector) => selector === 'button[type=submit]' ? button : selector === '#form-save-status' ? status : null;
  c.document.querySelector = () => null;
  c.form = form;
  c.button = button;
  c.status = status;
  vm.runInContext(`
    state.data = { filter: { date_from: '2026-09-01', date_to: '2026-09-30', category: 'all' } };
    invoiceImage = 'data:image/jpeg;base64,test';
    globalThis.messages = [];
    toast = (message) => messages.push(message);
    closeModal = () => { globalThis.closed = true; };
    renderLoadError = (message) => { globalThis.loadError = message; };
  `, c);
  return { c, form, button, status };
}

test('successful save followed by refresh failure never offers to resubmit', async () => {
  const { c, form, button } = submission();
  c.api = async (_, options) => { assert.equal(options.timeoutMs, 60_000); return { ok: true, id: 123 }; };
  c.loadDashboard = async (options) => { assert.equal(options.throwOnError, true); throw new Error('offline'); };
  await c.submitForm({ preventDefault() {}, currentTarget: form });
  assert.equal(c.closed, true);
  assert.match(c.loadError, /已儲存.*毋須再次提交/);
  assert.equal(button.disabled, true);
  assert.equal(vm.runInContext('state.month', c), '2026-08');
});

test('uncertain save preserves draft and shows a persistent warning', async () => {
  const { c, form, button, status } = submission();
  c.api = async () => { throw new Error('network failed'); };
  await c.submitForm({ preventDefault() {}, currentTarget: form });
  assert.equal(c.closed, undefined);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /未能確認是否已儲存/);
  assert.equal(button.disabled, false);
  assert.equal(vm.runInContext('invoiceImage', c), 'data:image/jpeg;base64,test');
});

test('missing save acknowledgement must not close the form', async () => {
  const { c, form, status } = submission();
  c.api = async () => ({});
  await c.submitForm({ preventDefault() {}, currentTarget: form });
  assert.equal(c.closed, undefined);
  assert.match(status.textContent, /未確認儲存結果/);
});

test('API preserves duplicate candidates from a conflict response', async () => {
  const c = app();
  c.fetch = async () => ({ ok: false, json: async () => ({ error: '可能重複', code: 'duplicate_invoice', duplicates: [{ id: 7 }] }) });
  await assert.rejects(c.api('/api/expenses'), (error) => error.code === 'duplicate_invoice' && error.duplicates[0].id === 7);
});

function duplicateSubmission() {
  const setup = submission();
  setup.c.document.createElement = () => ({
    textContent: '',
    get innerHTML() { return this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); },
  });
  const panel = { dataset: {}, scrollIntoView() {} };
  const confirm = { checked: false, reportValidity() { this.reported = true; } };
  const baseQuery = setup.form.querySelector;
  setup.form.querySelector = (selector) => selector === '#invoice-duplicates' ? panel
    : selector === '#invoice-duplicate-confirm' ? (panel.hidden === false ? confirm : null) : baseQuery(selector);
  return { ...setup, panel, confirm };
}

test('duplicate warning links images safely and resets on a new scan', () => {
  const { c, form, panel } = duplicateSubmission();
  c.showInvoiceDuplicates([{ id: 7, title: '<img src=x>', spent_on: '2026-09-26', amount: 123.45, reason: '日期及金額相同' }], form);
  assert.equal(panel.hidden, false);
  assert.match(panel.innerHTML, /href="\/api\/expenses\/7\/invoice"/);
  assert.match(panel.innerHTML, /&lt;img src=x&gt;/);
  assert.match(panel.innerHTML, /required/);
  c.showInvoiceDuplicates([], form);
  assert.equal(panel.hidden, true);
  assert.equal(panel.innerHTML, '');
  assert.equal(panel.dataset.reviewIds, '[]');
});

test('save conflict keeps the draft, requires review, and sends reviewed IDs on confirmation', async () => {
  const { c, form, panel, confirm, status, button } = duplicateSubmission();
  let calls = 0;
  c.api = async () => {
    calls++;
    throw Object.assign(new Error('可能重複'), { code: 'duplicate_invoice', duplicates: [{ id: 7, title: 'Shop', spent_on: '2026-09-26', amount: 10, reason: '相同圖片' }] });
  };
  await c.submitForm({ preventDefault() {}, currentTarget: form });
  assert.equal(c.closed, undefined);
  assert.equal(panel.hidden, false);
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /尚未儲存/);
  assert.equal(vm.runInContext('invoiceImage', c), 'data:image/jpeg;base64,test');
  await c.submitForm({ preventDefault() {}, currentTarget: form });
  assert.equal(calls, 1);
  assert.equal(confirm.reported, true);
  confirm.checked = true;
  c.api = async (_, options) => {
    assert.deepEqual(JSON.parse(options.body).reviewed_invoice_ids, [7]);
    return { ok: true, id: 8 };
  };
  c.loadDashboard = async () => {};
  await c.submitForm({ preventDefault() {}, currentTarget: form });
  assert.equal(c.closed, true);
});
