import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Workbench } from '../src/workbench.mjs';
import { Workbench as Legacy } from '../src/core.mjs';
import { definitions, dispatch } from '../src/tools.mjs';
import { versionMatches } from '../src/services/retrieval.mjs';
import { startUi } from '../src/server.mjs';
import { ToolCatalog } from '../src/tool-catalog.mjs';

const parent = path.resolve('.test-data'); fs.mkdirSync(parent, { recursive: true });
function fixture(t) {
  const base = fs.mkdtempSync(path.join(parent, 'v3-')), project = path.join(base, 'project'), data = path.join(base, 'data'); fs.mkdirSync(project);
  const w = new Workbench(data), root = w.addRoot({ path: project });
  const write = (name, content) => { const file = path.join(project, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
  t.after(() => { w.close(); if (!base.startsWith(parent + path.sep)) throw new Error('unsafe cleanup'); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, project, data, w, root, write, doc: name => w.list('document').find(d => d.relativePath === name) };
}
const memory = extra => ({ title: '渲染方法', content: '相機渲染需要驗證框架版本及場景。', type: 'method', source: 'user:fixture', appliesWhen: '相機渲染', reviewState: 'validated', evidence: '隔離案例已驗證', ...extra });
test('compact MCP tools reveal only requested groups and preserve the full-host fallback',()=>{const catalog=new ToolCatalog('insight','compact'),initial=catalog.list();assert.ok(initial.length<20);assert.equal(catalog.has('read_visual_reference'),false);assert.equal(catalog.activate(['visual']).changed,true);assert.equal(catalog.has('read_visual_reference'),true);assert.equal(catalog.activate(['visual']).changed,false);assert.equal(catalog.has('set_merge_coverage'),false);const full=new ToolCatalog('insight','all');assert.equal(full.list().length,definitions('insight').length+1);});
function image(w, scope, name = 'image.png') { const png = new PNG({ width: 64, height: 32 }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 36; png.data[i + 1] = 99; png.data[i + 2] = 235; png.data[i + 3] = 255; } return w.visual.import({ base64: PNG.sync.write(png).toString('base64'), scope, name }); }

test('v3 snapshots v2 and never writes back into the running old database', t => {
  const base = fs.mkdtempSync(path.join(parent, 'migration3-')), data = path.join(base, 'data'), old = new Legacy(data, { databaseName: 'workbench-v2.sqlite' });
  old.save('custom', { id: 'note', title: '舊庫原文' }); const w = new Workbench(data);
  try { assert.equal(w.get('custom', 'note').title, '舊庫原文'); w.save('custom', { id: 'note', title: '新版' }); assert.equal(old.get('custom', 'note').title, '舊庫原文'); old.save('custom', { id: 'new-old-write', title: '不自動合併' }); assert.equal(w.get('custom', 'new-old-write'), null); assert.ok(fs.existsSync(path.join(data, 'before-v3.sqlite'))); }
  finally { w.close(); old.close(); fs.rmSync(base, { recursive: true, force: true }); }
});

test('ranking finds highly relevant late titles beyond the old first 120 candidates', t => {
  const f = fixture(t);
  for (let i = 0; i < 140; i++) f.w.saveMemory(memory({ title: 'AAA ' + i, content: '渲染但不涉及其他能力', scope: f.root.id }));
  const target = f.w.saveMemory(memory({ title: 'ZZZ 相機渲染', scope: f.root.id }));
  const found = f.w.knowledge.search({ query: '相機渲染', scope: f.root.id, maxBytes: 12000 });
  assert.ok(found.items.some(x => x.id === target.id)); assert.equal(found.items[0].id, target.id);
});

test('version ranges and scope filtering run before candidate limits', t => {
  const f = fixture(t); for (let i = 0; i < 125; i++) f.w.saveMemory(memory({ title: 'AAA ' + i, scope: f.root.id, appliesTo: { version: '>=9.0.0' } }));
  const target = f.w.saveMemory(memory({ title: 'ZZZ 版本範圍', scope: f.root.id, appliesTo: { version: '^4.2.0' } }));
  const found = f.w.knowledge.search({ query: '相機渲染', scope: f.root.id, environment: { version: '4.4.2' }, maxBytes: 12000 }); assert.equal(found.items[0].id, target.id);
  assert.equal(versionMatches('0.3.2', '^0.3.0'), true); assert.equal(versionMatches('0.4.0', '^0.3.0'), false); assert.equal(versionMatches('4.3.0', '>=4.2 <5'), true);
});

test('retrieval generations invalidate sent-query caches and host vectors stay version bound', t => {
  const f = fixture(t), item = f.w.saveMemory(memory({ scope: f.root.id })), run = f.w.budget.begin({ scope: f.root.id, maxTokens: 12000 });
  const one = f.w.knowledge.search({ query: '相機渲染', scope: f.root.id, runId: run.runId }); assert.ok(one.items.length);
  assert.equal(f.w.knowledge.search({ query: '相機渲染', scope: f.root.id, runId: run.runId }).alreadySent, true);
  f.w.retrieval.saveVector({ id: item.id, expectedRevision: item.revision, model: 'fixture-2', vector: [1, 0] });
  assert.ok(f.w.knowledge.search({ query: '相機渲染', scope: f.root.id, runId: run.runId }).indexVersion > one.indexVersion);
  f.w.saveMemory({ id: item.id, expectedRevision: item.revision, content: '更新後相機渲染' });
  assert.equal(f.w.db.prepare('SELECT count(*) n FROM retrieval_vectors').get().n, 0);
});

test('research source changes invalidate dependent knowledge without losing original evidence', t => {
  const f = fixture(t), s = f.w.sources.save({ title: '官方方法', uri: 'https://example.test/api', scope: f.root.id, content: '# 版本一\n方法與前提。' });
  const k = f.w.saveMemory(memory({ scope: f.root.id, externalSourceRefs: [{ id: s.id, revision: s.revision, hash: s.contentHash }] }));
  f.w.sources.save({ id: s.id, expectedRevision: s.revision, content: '# 版本二\n條件已變更。' });
  assert.equal(f.w.get('memory', k.id).reviewState, 'needs_review');
  assert.equal(f.w.get('sourceRevision', s.id + ':1').content, '# 版本一\n方法與前提。');
  f.w.sources.save({ id: s.id, expectedRevision: 2, lifecycle: 'archived' }); assert.equal(f.w.sources.search({ query: '方法', scope: f.root.id }).items.length, 0);
});

test('task compilation preserves original request and old task revisions; context expires on revision', t => {
  const f = fixture(t); f.w.saveMemory(memory({ scope: f.root.id }));
  const compiled = f.w.contextService.compile({ request: '請在指定專案製作相機渲染，保留中文。', title: '相機', goal: '相機渲染', constraints: ['保留中文'], scope: f.root.id }), task = compiled.task;
  const run = f.w.budget.begin({ taskId: task.id, maxTokens: 8000 }), result = f.w.contextService.build({ taskId: task.id, expectedRevision: task.revision, runId: run.runId });
  assert.equal(result.items.length, 1); assert.deepEqual(result.brief.constraints, ['保留中文']);
  f.w.updateTask({ id: task.id, expectedRevision: task.revision, goal: '改成燈光' });
  assert.equal(f.w.get('taskRevision', task.id + ':1').goal, '相機渲染');
  assert.equal(f.w.get('taskRevision', task.id + ':1').request, compiled.originalRequest);
  assert.throws(() => f.w.contextService.build({ taskId: task.id, expectedRevision: 2, runId: run.runId }), e => e.code === 'CONFLICT');
});

test('read budgets apply to implicit runs, cross-scope reads, and reject unknown bypass arguments', async t => {
  const f = fixture(t), k = f.w.saveMemory(memory({ scope: f.root.id,content:'必要的來源版本。'.repeat(100) }));
  const read = f.w.knowledge.read({ id: k.id }); assert.ok(read.runId); assert.ok(read.budget);
  const personal = f.w.budget.begin({ scope: 'personal' });
  assert.throws(() => f.w.knowledge.read({ id: k.id, runId: personal.runId }), e => e.code === 'OUT_OF_SCOPE');
  await assert.rejects(dispatch(f.w, 'read_knowledge', { id: k.id, _internal: true }), /不接受/);
  const tiny = f.w.budget.begin({ scope: f.root.id, maxTokens: 256 });
  assert.throws(() => f.w.knowledge.read({ id: k.id, runId: tiny.runId }), e => e.code === 'BUDGET_EXHAUSTED');
});

test('PNG crops use bounded workers, shared image budgets, and preserve source bytes', async t => {
  const f = fixture(t), a = image(f.w, f.root.id), b = image(f.w, f.root.id, 'same.png'), run = f.w.budget.begin({ scope: f.root.id, maxImages: 1 });
  const original = fs.readFileSync(f.w.asset(a.id).file), crop = await f.w.visual.read({ id: a.id, rect: { x: 0, y: 0, width: 0.5, height: 1 }, runId: run.runId });
  assert.equal(crop.metadata.width, 32); assert.equal(crop.metadata.height, 32); assert.equal(crop.mime, 'image/png'); assert.deepEqual(fs.readFileSync(f.w.asset(a.id).file), original);
  await assert.rejects(f.w.visual.read({ id: b.id, runId: run.runId }), e => e.code === 'BUDGET_EXHAUSTED');
  await assert.rejects(f.w.visual.read({ id: a.id, rect: { x: .9, y: 0, width: .5, height: 1 } }), /超出/);
});

test('visual recipes, regions and timelines check scope, coordinates, ordering and CAS', t => {
  const f = fixture(t), a = image(f.w, f.root.id), b = image(f.w, 'personal');
  assert.throws(() => f.w.visual.save({ kind: 'observation', scope: f.root.id, title: '跨範圍', assetIds: [b.id] }), e => e.code === 'OUT_OF_SCOPE');
  const saved = f.w.visual.save({ kind: 'observation', scope: f.root.id, title: '版面', assetIds: [a.id], observations: ['可見欄位'], hypotheses: ['可能使用 Grid'], regions: [{ title: '主區', rect: { x: 0, y: 0, width: 1, height: 1 } }] });
  assert.equal(saved.regions[0].assetId, a.id);
  assert.throws(() => f.w.visual.save({ kind: 'observation', id: saved.id, expectedRevision: 0, title: '覆寫' }), e => e.code === 'CONFLICT');
  assert.throws(() => f.w.visual.save({ kind: 'timeline', scope: f.root.id, title: '動態', assetIds: [a.id], duration: 1, frames: [{ time: .9, assetId: a.id }, { time: .2, assetId: a.id }] }), /排序/);
  const evaluation = f.w.visual.save({ kind: 'visualEvaluation', scope: f.root.id, title: '成果', assetIds: [a.id], implementationRef: 'artifact:scene', verification: 'independent', dimensions: { layout: '待實測' } });
  assert.equal(evaluation.verification, 'reported');
});

test('pixel comparison records an actual measurement without asserting aesthetics', async t => {
  const f = fixture(t), a = image(f.w, f.root.id), b = image(f.w, f.root.id);
  const result = await f.w.visual.compare({ leftAssetId: a.id, rightAssetId: b.id, environmentMatched: true });
  assert.equal(result.metrics.normalizedSimilarity, 1); assert.equal(result.provenance, 'local_pixel_measurement'); assert.equal(result.metrics.sameDimensions, true);
});

test('merge rejects partial coverage and lost clauses; valid full coverage applies and restores', async t => {
  const f = fixture(t); f.write('a.md', '# A\n\n唯一條款 A'); f.write('b.md', '# B\n\n唯一條款 B'); await f.w.scan();
  const a = f.doc('a.md'), b = f.doc('b.md'), refs = [a, b].map(d => ({ documentId: d.id, expectedHash: d.hash }));
  const bad = f.w.createPlan({ title: '不可遺失', sourceDocuments: refs, operations: [{ type: 'write', documentId: a.id, expectedHash: a.hash, content: '# 新版' }] });
  assert.throws(() => f.w.applyPlan(bad.id, true), e => e.code === 'COVERAGE_INCOMPLETE');
  assert.throws(() => f.w.documentsService.coverage({ id: bad.id, coverage: [{ documentId: a.id, hash: a.hash, disposition: '保留' }] }), /完整/);
  const good = f.w.createPlan({ title: '保留原文', sourceDocuments: refs, operations: [{ type: 'write', documentId: a.id, expectedHash: a.hash, content: a.content + '\n\n' + b.content }] });
  f.w.documentsService.coverage({ id: good.id, coverage: [a, b].map(d => ({ documentId: d.id, hash: d.hash, disposition: '保留原文' })) });
  f.w.applyPlan(good.id, true); assert.match(fs.readFileSync(a.path, 'utf8'), /唯一條款 B/); f.w.restorePlan(good.id, true); assert.equal(fs.readFileSync(a.path, 'utf8'), '# A\n\n唯一條款 A');
});

test('router splitting and metadata edits preserve independent content, BOM and CRLF', async t => {
  const f = fixture(t), original = '\uFEFF---\r\nname: demo\r\ncustom: untouched # keep\r\n---\r\n# 入口\r\n\r\n## 方法\r\n完整方法\r\n';
  f.write('guide.md', original); await f.w.scan(); const d = f.doc('guide.md');
  const meta = f.w.documentsService.metadata({ documentId: d.id, expectedHash: d.hash, fields: { description: '做什麼與何時用' } });
  f.w.applyPlan(meta.id, true); const changed = fs.readFileSync(d.path, 'utf8'); assert.ok(changed.startsWith('\uFEFF')); assert.match(changed, /custom: untouched # keep\r\n/);
  f.w.restorePlan(meta.id, true);
  const split = f.w.documentsService.split({ documentId: d.id, expectedHash: d.hash, routerContent: original.split('## 方法')[0] + '[方法](references/method.md)\r\n', attachments: [{ relativePath: 'references/method.md', content: '## 方法\r\n完整方法\r\n' }] });
  f.w.applyPlan(split.id, true); assert.match(fs.readFileSync(path.join(f.project, 'references/method.md'), 'utf8'), /完整方法/); f.w.restorePlan(split.id, true); assert.equal(fs.readFileSync(d.path, 'utf8'), original);
});

test('annotation and category failures roll back together', async t => {
  const f = fixture(t); f.write('a.md', '# A'); await f.w.scan(); const d = f.doc('a.md');
  assert.throws(() => f.w.documentsService.annotate({ documentId: d.id, expectedHash: d.hash, status: 'keep', reason: '測試', category: '不存在' }));
  assert.equal(f.w.get('mark', d.id), null);
});

test('autonomy policies block scope changes and quotas before changes and preserve undo', t => {
  const f = fixture(t), a = f.w.saveMemory(memory({ scope: f.root.id })), b = f.w.saveMemory(memory());
  const policy = f.w.policies.save({ title: '只可封存個人知識', scopes: ['personal'], actions: ['knowledge_archive'], maxOperations: 1, confirm: true, grantReason: '隔離測試明示授權' });
  const denied = f.w.knowledge.propose({ title: '不准跨範圍', reason: '測試', operations: [{ type: 'state', id: a.id, expectedRevision: 1, lifecycle: 'archived' }] });
  assert.throws(() => f.w.policies.apply({ policyId: policy.id, expectedPolicyRevision: 1, kind: 'knowledgePlan', planId: denied.id }), e => e.code === 'POLICY_BLOCKED');
  const good = f.w.knowledge.propose({ title: '封存', reason: '明示過期', operations: [{ type: 'state', id: b.id, expectedRevision: 1, lifecycle: 'archived' }] });
  const result = f.w.policies.apply({ policyId: policy.id, expectedPolicyRevision: 1, kind: 'knowledgePlan', planId: good.id }); assert.equal(result.status, 'applied'); assert.equal(f.w.get('policy', policy.id).usedOperations, 1);
  f.w.knowledge.restoreChange(good.id, true); assert.equal(f.w.get('memory', b.id).lifecycle, 'active');
  const next = f.w.knowledge.propose({ title: '超額', reason: '測試', operations: [{ type: 'state', id: b.id, expectedRevision: f.w.get('memory', b.id).revision, lifecycle: 'archived' }] });
  assert.throws(() => f.w.policies.apply({ policyId: policy.id, expectedPolicyRevision: 1, kind: 'knowledgePlan', planId: next.id }), e => e.code === 'POLICY_BLOCKED');
});

test('persistent drafts survive another connection and reject stale saves', t => {
  const f = fixture(t);
  const d = f.w.workspace.draft({ action: 'save', id: 'draft-a', scope: f.root.id, title: '草稿', fields: [{ name: 'content', value: '未儲存內容' }] });
  const second = new Workbench(f.data);
  try { assert.equal(second.workspace.draft({ action: 'read', id: d.id }).fields[0].value, '未儲存內容'); second.workspace.draft({ action: 'save', id: d.id, expectedRevision: 1, title: '草稿', fields: [] }); assert.throws(() => f.w.workspace.draft({ action: 'save', id: d.id, expectedRevision: 1, fields: [] }), e => e.code === 'CONFLICT'); } finally { second.close(); }
});

test('selection snapshots report partial changes accurately and jobs never alter source files', async t => {
  const f = fixture(t); for (let i = 0; i < 30; i++) f.write(i + '.md', '# Note ' + i); await f.w.scan();
  const snapshot = f.w.background.snapshot({ rootId: f.root.id }); fs.appendFileSync(path.join(f.project, '0.md'), '\n外部變更');
  const job = f.w.background.start({ action: 'batch_mark', selectionId: snapshot.id, status: 'keep', reason: '批次用途' });
  let state; for (let i = 0; i < 100; i++) { state = f.w.background.get(job.id); if (!['queued', 'running'].includes(state.status)) break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(state.status, 'partial'); assert.equal(state.succeeded, 29); assert.equal(state.failed, 1); assert.equal(fs.readFileSync(path.join(f.project, '1.md'), 'utf8'), '# Note 1');
});

test('knowledge import produces candidates without overriding original identities', t => {
  const f = fixture(t), k = f.w.saveMemory(memory({ scope: f.root.id })), bundle = f.w.workspace.portability({ action: 'export', scope: f.root.id });
  const plan = f.w.workspace.portability({ action: 'import', scope: 'personal', bundle }); f.w.knowledge.applyChange(plan.id, true);
  const imported = f.w.knowledge.list({ scope: 'personal' }).items[0]; assert.notEqual(imported.id, k.id); assert.equal(imported.reviewState, 'candidate');
});

test('tool definitions are unique, validate forbidden inputs, and keep UI reads outside AI budgets', async t => {
  const f = fixture(t), tools = definitions('both'); assert.equal(new Set(tools.map(t => t.name)).size, tools.length);
  const ui = await startUi(f.w); try {
    const html = await (await fetch(ui.url)).text(), token = html.match(/name="workbench-token" content="([^"]+)"/)[1];
    for (let i = 0; i < 10; i++) { const r = await fetch(ui.url + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': token }, body: JSON.stringify({ name: 'list_documents', arguments: {} }) }); assert.equal(r.status, 200); }
    assert.equal(f.w.list('retrieval').length, 0);
    assert.equal((await fetch(ui.url + '/next-ui.js')).status, 200);
  } finally { await ui.close(); }
});

test('evaluation reports do not invent comparisons or significance', t => {
  const f = fixture(t), report = f.w.workspace.evaluation({ action: 'report', model: 'fixture', settingsHash: 'same', datasetHash: 'heldout' });
  assert.equal(report.comparison, 'not_measured'); assert.equal(report.significance, 'not_established');
  for (const arm of ['A', 'B', 'C']) f.w.workspace.evaluation({ action: 'record', title: 'case', caseId: 'one', arm, domain: 'md', model: 'fixture', settingsHash: 'same', datasetHash: 'heldout', artifactRef: 'artifact:test', passed: true, holdout: true, inputTokens: 20, outputTokens: 10 });
  const actual = f.w.workspace.evaluation({ action: 'report', model: 'fixture', settingsHash: 'same', datasetHash: 'heldout' });
  assert.equal(actual.pairedIndependentCases, 1); assert.equal(actual.arms.C.meanTotalTokens, 30); assert.equal(actual.significance, 'not_established');
});

test('default AI inventories fit the shared budget rather than returning UI-sized pages',async t=>{const f=fixture(t);for(let i=0;i<60;i++)f.write('entry-'+i+'.md','# Note '+i);await f.w.scan();const result=await dispatch(f.w,'list_documents',{});assert.equal(result.total,60);assert.equal(result.documents.length,20);assert.ok(result.budget.remainingEstimatedTokens>0);assert.ok(result.nextCursor);});

test('source removals invalidate referencing audit caches without forcing a full audit',async t=>{const f=fixture(t);f.write('a.md','# A\n\n[B](b.md)');f.write('b.md','# B');await f.w.scan();assert.equal(f.w.audit({rule:'link',state:'open'}).total,0);fs.unlinkSync(path.join(f.project,'b.md'));await f.w.scan();assert.equal(f.w.audit({rule:'link',state:'open'}).total,1);});
test('a mismatched run rejects knowledge mutations before saving',async t=>{const f=fixture(t),k=f.w.saveMemory(memory({scope:f.root.id})),run=f.w.budget.begin({scope:'personal'});await assert.rejects(dispatch(f.w,'set_knowledge_state',{id:k.id,expectedRevision:1,lifecycle:'archived',reason:'不能跨脈絡',runId:run.runId}),e=>e.code==='OUT_OF_SCOPE');assert.equal(f.w.get('memory',k.id).lifecycle,'active');});
