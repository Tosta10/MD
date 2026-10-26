import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Workbench} from '../src/workbench.mjs';
import {startUi} from '../src/server.mjs';
const {chromium}=createRequire(path.join(process.env.WORKBENCH_PLAYWRIGHT_ROOT,'browser.cjs'))('playwright');
const parent=path.resolve('.test-data');fs.mkdirSync(parent,{recursive:true});
const dir=fs.mkdtempSync(path.join(parent,'guide-')),w=new Workbench(dir),ui=await startUi(w);
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(ui.url);await page.getByRole('link',{name:'使用手冊 ↗'}).waitFor();
 const checks=[];
 for(const url of ['/guide.html','/test-report.html']){
  const response=await page.goto(ui.url+url);assert.equal(response.status(),200);
  await page.locator('article h1').waitFor();assert.ok(await page.locator('aside a').count()>5);
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
   await page.setViewportSize(size);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
   checks.push(url+' '+size.width+'px: headings, navigation, no page overflow');
  }
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync('docs/verification/raw/guide-browser.json',JSON.stringify({version:'3.0.1',passed:true,checks,pageErrors:errors},null,2)+'\n');
 console.log(JSON.stringify({passed:true,checks:checks.length}));
} finally {await browser.close();await ui.close();w.close();if(!dir.startsWith(parent+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
