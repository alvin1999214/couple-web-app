// Optional browser regression suite. See README for Playwright setup.
// All writes use a disposable database; no existing app instance is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { chromium } = require('playwright-core');

const widths = [320, 390, 520, 800, 801, 900, 1120, 1121, 1280, 1440];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function checkLayout(page, label) {
  await page.waitForTimeout(100);
  await settle(page);
  const errors = await page.evaluate(() => {
    const errors = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('page overflows horizontally: ' + document.documentElement.scrollWidth + ' ' + [...document.querySelectorAll('body *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'absolute').slice(0, 8).map(e => e.className).join(','));
    const selectors = '.onboarding-card,.expense-info,.list-main,.balance-number,.balance-split,.event-info,.insight-copy,.budget-meta,.widget-header,.expense-filters,.modal,.field,.order-row,.order-bulk,.admin-toolbar,.metric-body,.toast';
    for (const el of document.querySelectorAll(selectors)) {
      if (!el.getClientRects().length) continue;
      if (el.scrollWidth > el.clientWidth + 2) errors.push(`${el.className}: content wider than box`);
    }
    // Check real text bounds against card edges; hiding overflow cannot pass this check.
    for (const el of document.querySelectorAll('.expense-info strong,.list-main strong,.balance-split span,.event-info strong,.metric-value,.field label')) {
      if (!el.getClientRects().length) continue;
      const box = el.closest('.widget,.modal,.admin-metric-card,.onboarding-card').getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(el);
      for (const rect of range.getClientRects()) {
        if (rect.width && (rect.left < box.left - 1 || rect.right > box.right + 1)) errors.push(`${el.className || el.tagName}: text clipped by card`);
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], label);
}

test('responsive pages, widgets, dialogs and long text', { timeout: 180000 }, async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'couple-layout-'));
  const port = await new Promise(resolve => {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  });
  const server = spawn(process.env.PYTHON || 'python3', ['app.py'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATA_DIR: dataDir, PORT: String(port) }, stdio: 'ignore',
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; ; attempt++) {
      try { await fetch(`${base}/api/health`); break; }
      catch (e) { if (attempt > 60) throw e; await new Promise(r => setTimeout(r, 100)); }
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    // Font fallback is deliberately tested offline and makes the suite deterministic.
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.goto(base);
    await page.locator('#onboarding').waitFor({ state: 'visible' });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await checkLayout(page, `onboarding ${width}`);
    }
    const setup = await page.request.post(`${base}/api/onboarding`, { data: { couple_names: ['Alex', 'Sam'], monthly_budget: 20000, started_on: '2020-01-01' } });
    assert.equal(setup.ok(), true);
    await page.reload(); await page.waitForFunction(() => state.data?.configured);
    for (const width of [320, 801, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await checkLayout(page, `empty dashboard ${width}`);
    }
    await page.evaluate(() => {
      const title = '週末一起採購KitchenStorage'.repeat(4);
      const name = 'VeryLongUnbrokenPartnerName甲乙丙丁';
      const cat = '日常分類<em>文字</em>ExtraLongCategory';
      window.layoutFixture = { title, name, cat };
      state.data.settings.couple_names = [name, name + '二'];
      categories.groceries.label = cat; updateCategoryDropdowns();
      state.data.expenses = [{ id: 1, title, category: 'groceries', amount: 100000000, paid_by: name, spent_on: localISODate(), has_invoice: true }];
      state.data.shopping = [{ id: 1, name: title, quantity: 100, category: 'groceries', purchased: true }];
      state.data.todos = [{ id: 1, title, assignee: name, due_date: localISODate(), done: false }];
      state.data.special_days = [{ id: 1, title, event_date: localISODate(), emoji: '♥♥♥♥♥♥♥♥', repeats_yearly: true }];
      state.data.breakdown = [{ label: cat, amount: 100000000 }];
      state.data.month_expense_total = state.data.expense_total = 100000000;
      state.data.filter.is_active = true; state.data.filter.category = 'groceries';
      updateIdentity(); renderDashboard();
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const size of ['small', 'medium', 'large', 'wide']) {
        await page.evaluate(size => { state.data.layout.forEach(x => x.size = size); renderDashboard(); }, size);
        await checkLayout(page, `dashboard ${width} ${size}`);
      }
      await page.evaluate(() => { state.editing = true; renderDashboard(); });
      await checkLayout(page, `editing ${width}`);
      await page.evaluate(() => { state.editing = false; renderDashboard(); });
    }
    assert.equal(await page.locator('.expense-info em,.list-main em').count(), 0);
    const types = await page.evaluate(() => Object.keys(forms));
    for (const width of [320, 390, 801, 1280]) {
      await page.setViewportSize({ width, height: width === 801 ? 450 : 844 });
      for (const type of types) {
        await page.evaluate(type => {
          const { title, cat, name } = layoutFixture;
          const item = { id: 1, name: title + '<em>商品</em>', title, key: 'groceries', label: cat, amount: 100000000, category: 'groceries', paid_by: name, event_date: localISODate(), due_date: localISODate(), value: title, expense_count: 10, shopping_count: 10 };
          openModal(type, { item, targets: [{ key: 'other', label: cat }] });
        }, type);
        await checkLayout(page, `dialog ${type} ${width}`);
        assert.equal(await page.locator('.field label em').count(), 0);
        if (type === 'split') {
          for (const method of ['equal', 'custom', 'income']) {
            await page.locator('[name=split_method]').selectOption(method);
            await checkLayout(page, `split ${method} ${width}`);
            assert.equal(await page.locator('[data-split-group]:visible').count(), method === 'equal' ? 0 : method === 'custom' ? 1 : 2);
          }
        }
        await page.locator('#dynamic-form button[type=submit]').scrollIntoViewIfNeeded();
        const button = await page.locator('#dynamic-form button[type=submit]').boundingBox();
        assert.ok(button.y >= 0 && button.y + button.height <= page.viewportSize().height + 1, `submit reachable ${type}`);
        await page.evaluate(() => closeModal());
      }
      // New receipt has extra upload, warning and duplicate-review controls.
      await page.evaluate(() => {
        openModal('expense');
        document.querySelector('#invoice-status').textContent = layoutFixture.title.repeat(3);
        const warnings = document.querySelector('#invoice-warnings'); warnings.hidden = false; warnings.innerHTML = '<li>' + 'OCRWarning'.repeat(30) + '</li>';
        showInvoiceDuplicates([{ id: 1, title: layoutFixture.title, amount: 100000000, spent_on: localISODate() }], document.querySelector('#dynamic-form'));
      });
      await checkLayout(page, `receipt warnings ${width}`);
      await page.evaluate(() => {
        closeModal(); openOrderImport(); document.querySelector('#order-review').hidden = false;
        orderImport.orders = Array.from({ length: 3 }, () => ({ selected: true, platform: '淘寶', order_id: 'OrderID'.repeat(14), title: layoutFixture.title, original_amount: 100000000, currency: 'CNY', amount: 100000000, spent_on: '', category: 'groceries', source_pages: [1,2,3,4,5,6,7,8,9,10], warnings: ['WarningWithoutSpaces'.repeat(20)] }));
        renderOrderRows();
      });
      await checkLayout(page, `order review ${width}`);
      if (width <= 800) assert.ok(await page.locator('[data-order-field=title]').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      await page.evaluate(() => closeModal());
      await page.evaluate(() => toast('LongErrorMessage'.repeat(35), true));
      await checkLayout(page, `toast ${width}`);
      await page.evaluate(() => document.querySelector('#toast-region').replaceChildren());
    }
    await page.evaluate(async () => { document.querySelector('#living-view').hidden = true; document.querySelector('#admin-view').hidden = false; await loadAdminOverview(); });
    for (const width of [320, 390, 801, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const table of ['categories', 'settings', 'expenses', 'shopping_items', 'todos', 'special_days']) {
        await page.evaluate(table => {
          const { title, cat, name } = layoutFixture;
          renderAdminContextFilters(table);
          renderAdminTable({ table, rows: [{ id: 1, key: 'LongUnbrokenParameterKey'.repeat(5), title, name: title, label: cat, color: '#abcdef', icon: 'tag', amount: 100000000, category: 'groceries', paid_by: name, assignee: name, spent_on: localISODate(), due_date: localISODate(), event_date: localISODate(), emoji: '♥♥♥♥♥♥♥♥', value: title.repeat(3) }] });
          renderAdminMetrics({ counts: { categories: 100000 }, total_expense_amount: 100000000000, db_size_formatted: '123456789 MB', schema_version: 8 });
        }, table);
        await checkLayout(page, `admin ${table} ${width}`);
        const tableOverflow = await page.locator('.admin-data-table').evaluate(el => el.scrollWidth > el.clientWidth + 2);
        assert.equal(tableOverflow, false, `table cells contained ${table} ${width}`);
      }
    }
    if (process.env.LAYOUT_SCREENSHOTS) {
      mkdirSync(process.env.LAYOUT_SCREENSHOTS, { recursive: true });
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(350);
        await settle(page);
        await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOTS, `admin-${width}.png`), fullPage: true });
        await page.evaluate(() => { switchView('dashboard'); state.data.layout.forEach(x => x.size = 'medium'); renderDashboard(); });
        await page.waitForTimeout(350);
        await settle(page);
        await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOTS, `dashboard-${width}.png`), fullPage: true });
        await page.evaluate(() => openOrderImport()); await page.waitForTimeout(350);
        await settle(page);
        await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOTS, `dialog-${width}.png`) });
        await page.evaluate(() => { closeModal(); document.querySelector('#living-view').hidden = true; document.querySelector('#admin-view').hidden = false; });
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
