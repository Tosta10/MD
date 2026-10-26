import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { Workbench } from '../src/workbench.mjs';
import { KnowledgeStore } from '../src/knowledge.mjs';

const parent = path.resolve('.test-data'); fs.mkdirSync(parent, { recursive: true });
const base = fs.mkdtempSync(path.join(parent, 'retrieval-effects-'));
const project = path.join(base, 'project'), other = path.join(base, 'other'); fs.mkdirSync(project); fs.mkdirSync(other);
const w = new Workbench(path.join(base, 'data')), root = w.addRoot({ path: project }), peer = w.addRoot({ path: other });
const oldView = new Proxy(w, { get(target, key) { if (['retrieval', 'budget'].includes(key)) return null; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
const legacy = new KnowledgeStore(oldView), cases = [];
const save = values => w.saveMemory({ title: '測試', content: '合成資料', type: 'method', source: 'user:synthetic-regression', appliesWhen: '隔離檢索案例', scope: root.id, reviewState: 'validated', evidence: '測試fixture，不是真實領域知識', ...values });
try {
  for (let i = 0; i < 6; i++) {
    const query = 'rank_case_' + i;
    for (let n = 0; n < 130; n++) save({ title: 'AAA distractor ' + n, content: query + ' 相關但非主要答案' });
    const target = save({ title: 'ZZZ ' + query, content: query + ' 主要答案' });
    cases.push({ family: 'late-title-ranking', query, target: target.id, expected: 'present' });
  }
  for (let i = 0; i < 6; i++) {
    const query = 'version_case_' + i;
    for (let n = 0; n < 130; n++) save({ title: 'AAA wrong ' + n, content: query, appliesTo: { version: '9.0.0' } });
    const target = save({ title: 'ZZZ compatible', content: query, appliesTo: { version: '>=4.0 <5.0' } });
    cases.push({ family: 'version-prefilter', query, environment: { version: '4.4.2' }, target: target.id, expected: 'present' });
  }
  for (const [query, content] of [
    ['如何改善畫面渲染效能', '畫面渲染時先量測效能瓶頸，固定場景比較。'],
    ['新任務如何套用專案經驗', '專案經驗需要按任務條件套用。'],
    ['整理文件時如何保留來源版本', '整理文件必須保留來源版本。'],
    ['圖片區域應該如何解構', '圖片區域的解構先記錄觀察，再標記假設。']
  ]) {
    const target = save({ title: content.slice(0, 10), content });
    cases.push({ family: 'chinese-query-segmentation', query, target: target.id, expected: 'present' });
  }
  for (let i = 0; i < 2; i++) { const query = 'control_exact_' + i, target = save({ title: query, content: query }); cases.push({ family: 'exact-positive-control', query, target: target.id, expected: 'present' }); }
  const hidden = save({ title: 'control_scope', content: 'control_scope', scope: peer.id });
  cases.push({ family: 'scope-negative-control', query: 'control_scope', target: hidden.id, expected: 'absent' });
  const expired = save({ title: 'control_expiry', content: 'control_expiry', expiresAt: '2020-01-01' });
  cases.push({ family: 'expiry-negative-control', query: 'control_expiry', target: expired.id, expected: 'absent' });
  const rows = [];
  for (const item of cases) {
    const input = { query: item.query, scope: root.id, environment: item.environment || {}, limit: 6, maxBytes: 12288 };
    let start = performance.now(); const old = legacy.search(input), oldMs = performance.now() - start;
    start = performance.now(); const next = w.retrieval.search({ ...input, _internal: true }), newMs = performance.now() - start;
    const oldHit = old.items.some(x => x.id === item.target), newHit = next.items.some(x => x.id === item.target);
    rows.push({ family: item.family, query: item.query, expected: item.expected, legacyPassed: item.expected === 'present' ? oldHit : !oldHit, currentPassed: item.expected === 'present' ? newHit : !newHit, legacyMs: Number(oldMs.toFixed(3)), currentMs: Number(newMs.toFixed(3)) });
  }
  const family = {};
  for (const row of rows) { const bucket = family[row.family] ||= { total: 0, legacyPassed: 0, currentPassed: 0 }; bucket.total++; bucket.legacyPassed += Number(row.legacyPassed); bucket.currentPassed += Number(row.currentPassed); }
  const report = { date: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), purpose: 'targeted-synthetic-component-regression', legacyDefinition: 'v2 search branch in KnowledgeStore with retrieval and budget adapters disabled; same corpus and query limits', currentDefinition: 'v3 RetrievalService; no embedding, no external LLM, no query budget truncation in this isolated algorithm study', corpus: { knowledgeItems: w.knowledge.list({ scope: root.id, limit: 1 }).total, crossScopeControlItems: 1 }, cases: rows.length, legacyPassed: rows.filter(x => x.legacyPassed).length, currentPassed: rows.filter(x => x.currentPassed).length, families: family, rows, limitations: ['Cases deliberately target known defects; this is not a representative random dataset or a blind holdout.', 'No LLM answer generation, semantic merge quality, visual aesthetics, real-world task success or billed token savings was measured.', 'No claim of general 100% retrieval success, statistical significance, or permanent model learning is supported.', 'The v3 budget bypass is internal to this synthetic component study; real MCP budget paths remain tested separately.'] };
  fs.mkdirSync('docs/verification/raw', { recursive: true });
  fs.writeFileSync('docs/verification/raw/retrieval-effects.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: report.cases, legacyPassed: report.legacyPassed, currentPassed: report.currentPassed, families: report.families }));
} finally { w.close(); if (!base.startsWith(parent + path.sep)) throw new Error('Unsafe cleanup'); fs.rmSync(base, { recursive: true, force: true }); }
