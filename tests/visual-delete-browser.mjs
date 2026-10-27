import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {PNG} from 'pngjs';import {Workbench} from '../src/workbench.mjs';import {startUi} from '../src/server.mjs';
const {chromium}=createRequire(path.join(process.env.WORKBENCH_PLAYWRIGHT_ROOT,'browser.cjs'))('playwright');
const parent=path.resolve('.test-data');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'delete-ui-')),w=new Workbench(dir),ui=await startUi(w,{role:'insight'}),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();
try {const png=new PNG({width:4,height:4});png.data.fill(255);const a=w.visual.import({base64:PNG.sync.write(png).toString('base64'),name:'test-reference.png',scope:'personal'});
 await page.goto(ui.url);await page.locator('[data-page=visual]').click();await page.locator('[data-action=visual-remove]').click();await page.getByText('確認刪除視覺素材').waitFor();
 await page.locator('dialog [data-action=close]').first().click();assert.equal(w.asset(a.id).lifecycle,'active');
 await page.locator('[data-action=visual-remove]').click();await page.locator('[data-action=visual-remove-confirm]').click();await page.getByText('素材已移入回收區').waitFor();assert.equal(w.asset(a.id).lifecycle,'trashed');
 await page.locator('[data-action=visual-toggle-trash]').click();await page.locator('[data-action=visual-restore]').click();await page.getByText('素材已還原').waitFor();assert.equal(w.asset(a.id).lifecycle,'active');console.log('confirmation, cancel, trash and restore passed');
}finally{await browser.close();await ui.close();w.close();if(!dir.startsWith(parent+path.sep))throw Error('unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
