import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Workbench, parseMarkdown, sha } from '../src/core.mjs';
const testRoot = path.resolve('.test-data');
fs.mkdirSync(testRoot,{recursive:true});
function fixture(t) {
  const base=fs.mkdtempSync(path.join(testRoot,'core-')), project=path.join(base,'project'); fs.mkdirSync(project);
  const w=new Workbench(path.join(base,'data')), root=w.addRoot({path:project});
  const write=(name,content)=>{const p=path.join(project,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);return p;};
  t.after(()=>{w.close();if(!path.resolve(base).startsWith(testRoot+path.sep))throw new Error('Unsafe test cleanup');fs.rmSync(base,{recursive:true,force:true});});
  return {base,project,w,root,write,doc:name=>w.list('document').find(d=>d.relativePath===name)};
}
const markDelete=(w,doc)=>w.markDocument({documentId:doc.id,status:'pending_delete',expectedHash:doc.hash,reason:'新版已取代',evidence:'已核對交付與唯一內容',completed:true,confirmed:true});

test('Markdown parser ignores code links and completed examples; reads safe frontmatter',()=>{
  const p=parseMarkdown('---\nname: sample\ndescription: Use for testing\n---\n# 文件\n\n[規格](docs/spec.md)\n\n```md\n- [x] 假完成\n[假連結](missing.md)\n```\n');
  assert.equal(p.frontmatter.name,'sample');assert.equal(p.links.length,1);assert.equal(p.completed,false);
  assert.equal(p.headings[0].text,'文件');assert.equal(p.headings[0].line,5);
  assert.ok(parseMarkdown('---\nstatus: completed\n---\n# 任務').completed);
  assert.ok(parseMarkdown('---\nbad: [\n---\n# 無效').frontmatterError);
});

test('scope scanner excludes vendor, own data, junction escapes and deduplicates hardlinks',async t=>{
  const f=fixture(t);f.write('README.md','# 專案');f.write('node_modules/vendor/README.md','# 套件');f.write('LICENSE.md','# License');
  const outside=path.join(f.base,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.md'),'private');
  fs.symlinkSync(outside,path.join(f.project,'escape'),process.platform==='win32'?'junction':'dir');
  const report=await f.w.scan();assert.equal(report.count,2);assert.ok(report.skipped>=2);
  fs.linkSync(path.join(f.project,'README.md'),path.join(f.project,'alias.md'));await f.w.scan();assert.equal(f.w.list('document').length,2);assert.equal(f.w.list('document').find(d=>d.category!=='授權與署名').aliases.length,1);
  assert.throws(()=>f.w.assertPath(f.root.id,path.join(f.project,'escape/private.md')),/範圍/);
  assert.throws(()=>f.w.createPlan({title:'test',operations:[{type:'create',rootId:f.root.id,relativePath:'../outside/new.md',content:'# nope'}]}),/範圍/);
});

test('marking completed files never edits originals and becomes stale after a change',async t=>{
  const f=fixture(t), file=f.write('done.md','# 已完成\n- [x] 交付\n');await f.w.scan();const doc=f.doc('done.md');
  markDelete(f.w,doc);assert.equal(fs.readFileSync(file,'utf8'),doc.content);assert.equal(f.w.document(doc.id).mark.stale,false);
  fs.appendFileSync(file,'\n新的需求');assert.equal(f.w.document(doc.id).mark.stale,true);
  assert.throws(()=>f.w.createPlan({title:'刪除',operations:[{type:'delete',documentId:doc.id,expectedHash:doc.hash}]}),/雜湊|變動/);
});

test('deletion requires confirmed completed mark and handles inbound links in the same batch',async t=>{
  const f=fixture(t);f.write('old.md','# 舊規格');f.write('README.md','# 入口\n[規格](old.md)');await f.w.scan();const old=f.doc('old.md'), main=f.doc('README.md');
  assert.throws(()=>f.w.createPlan({title:'刪除',operations:[{type:'delete',documentId:old.id,expectedHash:old.hash}]}),/待刪除/);
  markDelete(f.w,old);assert.throws(()=>f.w.createPlan({title:'刪除',operations:[{type:'delete',documentId:old.id,expectedHash:old.hash}]}),/引用/);
  const p=f.w.createPlan({title:'整合',operations:[{type:'write',documentId:main.id,expectedHash:main.hash,content:'# 入口\n新版規格已整合。'},{type:'delete',documentId:old.id,expectedHash:old.hash}]});
  f.w.applyPlan(p.id,true);assert.equal(fs.existsSync(old.path),false);assert.ok(f.w.applyPlan(p.id,true).idempotent);
  f.w.restorePlan(p.id,true);assert.equal(fs.readFileSync(old.path,'utf8'),old.content);assert.equal(fs.readFileSync(main.path,'utf8'),main.content);
});

test('apply detects live inbound links introduced after proposal',async t=>{
  const f=fixture(t);f.write('old.md','# 舊');const mainFile=f.write('README.md','# 入口');await f.w.scan();const old=f.doc('old.md');markDelete(f.w,old);
  const p=f.w.createPlan({title:'刪除',operations:[{type:'delete',documentId:old.id,expectedHash:old.hash}]});fs.appendFileSync(mainFile,'\n[保留](old.md)');
  assert.throws(()=>f.w.applyPlan(p.id,true),/引用/);assert.ok(fs.existsSync(old.path));
});

test('proposal and restore never overwrite concurrent edits',async t=>{
  const f=fixture(t);const file=f.write('a.md','# 原始');await f.w.scan();let doc=f.doc('a.md');
  const stale=f.w.createPlan({title:'修改',operations:[{type:'write',documentId:doc.id,expectedHash:doc.hash,content:'# 提案'}]});
  fs.writeFileSync(file,'# 另一個對話');assert.throws(()=>f.w.applyPlan(stale.id,true),/版本/);assert.equal(fs.readFileSync(file,'utf8'),'# 另一個對話');
  await f.w.scan();doc=f.doc('a.md');const p=f.w.createPlan({title:'新提案',operations:[{type:'write',documentId:doc.id,expectedHash:doc.hash,content:'# 已套用'}]});f.w.applyPlan(p.id,true);fs.writeFileSync(file,'# 更新中的成果');
  assert.throws(()=>f.w.restorePlan(p.id,true),/版本/);assert.equal(fs.readFileSync(file,'utf8'),'# 更新中的成果');
});

test('batch rollback recovers earlier writes if a later write fails',async t=>{
  const f=fixture(t);f.write('a.md','# A');f.write('b.md','# B');await f.w.scan();const a=f.doc('a.md'),b=f.doc('b.md');
  const p=f.w.createPlan({title:'兩份',operations:[a,b].map(d=>({type:'write',documentId:d.id,expectedHash:d.hash,content:'# 新版'}))});
  const original=f.w.putFile.bind(f.w);let n=0;f.w.putFile=(op,value)=>{if(++n===2)throw new Error('simulated write failure');original(op,value);};
  assert.throws(()=>f.w.applyPlan(p.id,true),/simulated/);assert.equal(fs.readFileSync(a.path,'utf8'),a.content);assert.equal(fs.readFileSync(b.path,'utf8'),b.content);assert.equal(f.w.plan(p.id).status,'failed');
});

test('new references validate against planned files, protected files remain immutable',async t=>{
  const f=fixture(t);f.write('a.md','# A');f.write('NOTICE.Nova.md','# Notice');await f.w.scan();const a=f.doc('a.md'),notice=f.doc('NOTICE.Nova.md');
  assert.throws(()=>f.w.createPlan({title:'broken',operations:[{type:'write',documentId:a.id,expectedHash:a.hash,content:'[no](missing.md)'}]}),/失效引用/);
  assert.throws(()=>f.w.createPlan({title:'license',operations:[{type:'write',documentId:notice.id,expectedHash:notice.hash,content:'x'}]}),/授權/);
  const p=f.w.createPlan({title:'new reference',operations:[{type:'write',documentId:a.id,expectedHash:a.hash,content:'[附件](references/new.md)'},{type:'create',rootId:f.root.id,relativePath:'references/new.md',content:'# 附件'}]});f.w.applyPlan(p.id,true);assert.ok(fs.existsSync(path.join(f.project,'references/new.md')));f.w.restorePlan(p.id,true);assert.equal(fs.existsSync(path.join(f.project,'references/new.md')),false);
});

test('audit identifies the five principles without treating code examples as commands',async t=>{
  const f=fixture(t);f.write('SKILL.md','---\nname: broad\ndescription: Everything\n---\n# Skill\nAlways read all docs.\nAsk before every action.\n[broken](missing.md)');f.write('copy.md','same');f.write('another.md','same');await f.w.scan();
  const rules=new Set(f.w.audit().findings.map(x=>x.rule));for(const rule of ['description','always','authorization','overlap','link'])assert.ok(rules.has(rule),rule);
});

test('context excludes pending deletion and memories respect scope, confirmation, expiry',async t=>{
  const f=fixture(t);f.write('a.md','# 作者權限\n作者需要兩個密碼。');await f.w.scan();const a=f.doc('a.md');assert.equal(f.w.context({query:'作者'}).length,1);markDelete(f.w,a);assert.equal(f.w.context({query:'作者'}).length,0);
  const basic={title:'偏好',content:'簡潔',type:'preference',source:'使用者回饋',appliesWhen:'本產品介面',scope:f.root.id};
  const candidate=f.w.saveMemory(basic);assert.equal(f.w.memories({scope:f.root.id}).length,0);
  f.w.saveMemory({...candidate,status:'confirmed',evidence:'使用者明確選擇'});assert.equal(f.w.memories({scope:f.root.id}).length,1);assert.equal(f.w.memories({scope:'personal'}).length,0);
  f.w.saveMemory({...candidate,status:'confirmed',evidence:'有確認',expiresAt:'2020-01-01T00:00:00Z'});assert.equal(f.w.memories({scope:f.root.id}).length,0);
});

test('task completion requires evidence; changed goals invalidate previous verification',t=>{
  const f=fixture(t);const task=f.w.createTask({title:'網站',goal:'完成登入',constraints:['不更動原版'],criteria:['雙密碼登入通過']});
  assert.throws(()=>f.w.updateTask({id:task.id,status:'completed'}),/條件/);
  assert.throws(()=>f.w.updateTask({id:task.id,criterionId:task.criteria[0].id,criterionStatus:'passed'}),/證據/);
  f.w.updateTask({id:task.id,criterionId:task.criteria[0].id,criterionStatus:'passed',evidence:'隔離瀏覽器讀回登入成功'});assert.equal(f.w.updateTask({id:task.id,status:'completed'}).status,'completed');
  const changed=f.w.updateTask({id:task.id,goal:'改為單密碼登入',correction:'需求已更新'});assert.equal(changed.status,'active');assert.equal(changed.criteria[0].status,'unverified');assert.ok(changed.criteria[0].priorEvidence);
});

test('visual references require supported bytes and preserve comparison scope',t=>{
  const f=fixture(t);assert.throws(()=>f.w.addAsset(Buffer.from('<html>not an image</html>'),'bad.png'),/只接受/);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');
  const left=f.w.addAsset(png,'左圖'),right=f.w.addAsset(png,'右圖');assert.throws(()=>f.w.saveComparison({title:'對比',leftAssetId:left.id,rightAssetId:left.id}),/不同/);
  const result=f.w.saveComparison({title:'可讀性',leftAssetId:left.id,rightAssetId:right.id,preferred:'left',scope:f.root.id,notes:['左圖的層級清楚']});assert.equal(result.scope,f.root.id);assert.equal(f.w.list('memory').length,0);
});

test('merge guards every source version, including unchanged source files',async t=>{
  const f=fixture(t);f.write('target.md','# 目標');const source=f.write('source.md','# 來源');await f.w.scan();const a=f.doc('target.md'),b=f.doc('source.md');
  const p=f.w.createPlan({title:'整合',operations:[{type:'write',documentId:a.id,expectedHash:a.hash,content:'# 目標\n來源已整合'}],sourceDocuments:[a,b].map(d=>({documentId:d.id,expectedHash:d.hash}))});
  fs.appendFileSync(source,'\n新增重要內容');assert.throws(()=>f.w.applyPlan(p.id,true),/整合來源版本/);assert.equal(fs.readFileSync(a.path,'utf8'),a.content);
});

test('shared database serializes writers and releases lock after failure',t=>{
  const f=fixture(t),other=new Workbench(path.join(f.base,'data'));
  try { f.w.fileLock(()=>assert.throws(()=>other.fileLock(()=>{}),/另一個工作台/));assert.throws(()=>f.w.fileLock(()=>{throw new Error('failure');}),/failure/);assert.equal(other.fileLock(()=>42),42); } finally {other.close();}
});

test('non-UTF8 Markdown is skipped without rewriting its bytes',async t=>{
  const f=fixture(t),bytes=Buffer.from([0xff,0xfe,0x23,0x00]);const file=f.write('legacy.md',bytes);f.write('valid.md','# 有效');await f.w.scan();assert.equal(f.w.list('document').length,1);assert.deepEqual(fs.readFileSync(file),bytes);
});

test('manual classification is versioned and never removes source protections',async t=>{
  const f=fixture(t),file=f.write('a.md','# A');f.write('LICENSE.md','# License');await f.w.scan();const a=f.doc('a.md'),license=f.doc('LICENSE.md');
  f.w.setCategory({documentId:a.id,expectedHash:a.hash,category:'任務待辦',reason:'使用者指定用途'});assert.equal(f.w.document(a.id).category,'任務待辦');
  fs.appendFileSync(file,'\n新用途');assert.equal(f.w.document(a.id).classification.stale,true);assert.notEqual(f.w.document(a.id).category,'任務待辦');
  f.w.setCategory({documentId:license.id,expectedHash:license.hash,category:'其他文件',reason:'測試分類不能解除保護'});assert.throws(()=>f.w.createPlan({title:'test',operations:[{type:'write',documentId:license.id,expectedHash:license.hash,content:'# modified'}]}),/授權/);
  f.w.markDocument({documentId:a.id,status:'active',reason:'完成判斷已撤回',completed:false});assert.equal(f.w.document(a.id).mark.completed,false);
});
