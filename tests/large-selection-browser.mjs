import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Workbench } from '../src/workbench.mjs';
import { startUi } from '../src/server.mjs';
const { chromium } = createRequire(path.join(process.env.WORKBENCH_PLAYWRIGHT_ROOT, 'browser.cjs'))('playwright');
const parent = path.resolve('.test-data'); fs.mkdirSync(parent, { recursive: true });
const base = fs.mkdtempSync(path.join(parent, 'large-selection-')), project = path.join(base, 'project'); fs.mkdirSync(project);
for (let i = 0; i < 2030; i++) fs.writeFileSync(path.join(project, 'file-' + String(i).padStart(4, '0') + '.md'), '# File ' + i);
const w = new Workbench(path.join(base, 'data')); w.addRoot({ path: project }); await w.scan();
const ui = await startUi(w, { role: 'md' }), browser = await chromium.launch({ channel: 'msedge', headless: true }), page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const idle = () => page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
try {
  await page.goto(ui.url); await page.locator('.file-row').first().waitFor();
  await page.locator('[data-action=select-filtered]').click(); await idle();
  assert.match(await page.locator('.batchbar').innerText(), /已選 2030 份/);
  assert.equal(await page.locator('[data-select]:checked').count(), 50);
  await page.locator('[data-select]').first().uncheck(); await idle();
  assert.match(await page.locator('.batchbar').innerText(), /已選 2029 份/);
  await page.locator('[data-action=clear-selection]').click(); await idle(); assert.equal(await page.locator('.batchbar').count(), 0);
  await page.locator('[data-action=select-filtered]').click(); await idle(); await page.locator('[data-action=batch-mark]').click(); await idle();
  await page.locator('#batch-mark [name=status]').selectOption('keep'); await page.locator('#batch-mark [name=reason]').fill('大批次原文保持');
  await page.getByRole('button', { name: '儲存批次標記', exact: true }).click(); await idle(); await page.locator('dialog').waitFor({ state: 'hidden' });
  for (let i = 0; i < 300 && w.documents({ status: 'keep', limit: 1 }).total < 2030; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(w.documents({ status: 'keep', limit: 1 }).total, 2030); assert.equal(fs.readFileSync(path.join(project, 'file-0000.md'), 'utf8'), '# File 0');
  assert.deepEqual(errors, []);
  const result = { passed: true, files: 2030, flows: ['snapshot-selection', 'per-row-exclusion', 'cancel-selection', 'background-mark-originals-preserved'], pageErrors: errors };
  fs.mkdirSync('artifacts/v3', { recursive: true }); fs.writeFileSync('artifacts/v3/large-selection-results.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { console.error((await page.locator('body').innerText()).slice(-1800)); throw error; }
finally { await browser.close(); await ui.close(); w.close(); if (base.startsWith(parent + path.sep)) fs.rmSync(base, { recursive: true, force: true }); }
