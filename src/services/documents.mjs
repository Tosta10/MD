import { Workbench as LegacyWorkbench, parseMarkdown } from '../core.mjs';
import { similarFindings } from '../review.mjs';
import { fail, text, hash, uid, now } from './shared.mjs';

const normalize = value => value.replace(/\s+/g, ' ').trim();
export class DocumentService {
  constructor(w) {
    this.w = w;
    w.db.exec('CREATE TABLE IF NOT EXISTS audit_cache(document_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);');
  }
  clauses(documentId) {
    const doc = this.w.document(documentId), blocks = doc.content.split(/\r?\n\s*\r?\n/).filter(v => v.trim());
    if (blocks.length > 1000) fail('單份文件超過1000個內容區塊，請按章節分批整理', 'COVERAGE_LIMIT');
    return { documentId, hash: doc.hash, clauses: blocks.map((value, i) => ({ id: hash(doc.id + ':' + doc.hash + ':' + i).slice(0, 24), text: value, index: i })) };
  }
  coverage(input) {
    const plan = this.w.plan(input.id);
    if (plan.status !== 'proposed') fail('只可更新待套用方案');
    const sources = plan.sourceDocuments || [];
    if (!Array.isArray(input.coverage) || input.coverage.length !== sources.length || new Set(input.coverage.map(x => x.documentId)).size !== sources.length) fail('覆蓋矩陣必須完整且每份來源只出現一次', 'COVERAGE_INCOMPLETE');
    const after = normalize(plan.operations.filter(op => op.after !== null).map(op => op.after).join('\n\n')), matrix = [];
    for (const source of sources) {
      const entry = input.coverage.find(c => c.documentId === source.documentId);
      if (!entry || entry.hash !== source.expectedHash) fail('來源版本不符', 'CONFLICT');
      text(entry.disposition, '來源處理說明', 2000);
      const sourceClauses = this.clauses(source.documentId);
      if (sourceClauses.hash !== source.expectedHash) fail('來源已改變', 'CONFLICT');
      const supplied = entry.clauses || [];
      if (!Array.isArray(supplied) || supplied.some(c => !sourceClauses.clauses.some(s => s.id === c.id)) || new Set(supplied.map(c => c.id)).size !== supplied.length) fail('條款對照格式不正確');
      const clauses = [];
      for (const clause of sourceClauses.clauses) {
        if (after.includes(normalize(clause.text))) { clauses.push({ id: clause.id, resolution: 'retained', verification: 'exact_normalized_text' }); continue; }
        const mapping = supplied.find(c => c.id === clause.id);
        if (!mapping || !['replaced', 'discarded'].includes(mapping.resolution)) fail('仍有未處理內容：' + clause.text.slice(0, 100) + '；請保留原文或逐條記錄取代／捨棄理由', 'COVERAGE_INCOMPLETE');
        const reason = text(mapping.reason, '條款取捨理由', 2000);
        if (mapping.resolution === 'replaced' && (!mapping.target || !after.includes(normalize(mapping.target)))) fail('取代內容不存在於新成果', 'COVERAGE_INCOMPLETE');
        clauses.push({ id: clause.id, resolution: mapping.resolution, reason, target: mapping.target || null, verification: 'explicit_review_required' });
      }
      matrix.push({ documentId: source.documentId, hash: source.expectedHash, disposition: entry.disposition, clauses });
    }
    plan.coverage = matrix; plan.coverageVersion = 3; this.w.save('plan', plan);
    return { ...this.w.planSummary(plan), coverage: matrix.map(e => ({ documentId: e.documentId, clauses: e.clauses.length, explicitlyReviewed: e.clauses.filter(c => c.verification === 'explicit_review_required').length })), contentCoverage: 'complete', semanticFidelity: 'requires_review_for_non_exact_changes' };
  }
  checkCoverage(plan) {
    if (plan.move || !plan.requiresCoverage && (plan.sourceDocuments?.length || 0) < 2) return;
    if (plan.coverageVersion !== 3) fail('整合方案需完整條款覆蓋矩陣', 'COVERAGE_INCOMPLETE');
    this.coverage({ id: plan.id, coverage: plan.coverage });
  }
  annotate(input) {
    return this.w.transaction(() => {
      const mark = this.w.markDocument(input);
      if (input.category) this.w.setCategory(input);
      return { mark, category: input.category, status: 'saved', documentId: input.documentId };
    });
  }
  batch(input) {
    if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 2000) fail('每批標記1–2000份');
    return this.w.transaction(() => {
      for (const item of input.documents) {
        const doc = this.w.document(item.id);
        this.w.markDocument({ documentId: item.id, expectedHash: item.hash, status: input.status, reason: input.reason, evidence: input.evidence, completed: typeof input.completed === 'boolean' ? input.completed : doc.completed, confirmed: false });
      }
      return { status: 'completed', affected: input.documents.length, sourceFilesChanged: false };
    });
  }
  sections(input) {
    this.w.document(input.documentId);
    const limit = Math.min(100, Math.max(1, input.limit || 30)), offset = Math.max(0, input.offset || 0);
    const rows = this.w.db.prepare('SELECT id,title,start_line,end_line,source_hash FROM sections WHERE document_id=? ORDER BY start_line LIMIT ? OFFSET ?').all(input.documentId, limit + 1, offset);
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }
  history(input = {}) {
    const where = ["kind IN ('plan','knowledgePlan','maintenanceEvent')"], params = [];
    if (input.status) { where.push("json_extract(data,'$.status')=?"); params.push(input.status); }
    if (input.query) { where.push("json_extract(data,'$.title') LIKE ?"); params.push('%' + input.query + '%'); }
    const total = this.w.db.prepare('SELECT count(*) n FROM records WHERE ' + where.join(' AND ')).get(...params).n;
    const limit = Math.min(100, Math.max(1, input.limit || 30)), offset = Math.max(0, input.offset || 0);
    const items = this.w.db.prepare('SELECT kind,data FROM records WHERE ' + where.join(' AND ') + ' ORDER BY rowid DESC LIMIT ? OFFSET ?').all(...params, limit, offset).map(r => { const p = JSON.parse(r.data); return { id: p.id, kind: r.kind, title: p.title, status: p.status, at: p.at, operations: p.operations?.length || 0 }; });
    return { items, total, offset, limit, hasMore: offset + items.length < total };
  }
  prepare(input) {
    const doc = this.w.document(input.documentId);
    if (doc.hash !== input.expectedHash) fail('來源已變更', 'CONFLICT');
    const sections = this.sections({ documentId: doc.id, offset: input.offset, limit: 20 });
    return { document: { id: doc.id, hash: doc.hash, title: doc.title, category: doc.category }, principles: ['用途與觸發', '工作流與路由', '責任映射與按變更驗證', '前提式授權', '重疊、互補與衝突'], sections, reviewContract: { sourceHash: doc.hash, originalRequired: true, evidenceRequired: true, inferenceMustBeMarked: true, alternativeAndTriggerExamples: true }, instructionAuthority: false };
  }
  submit(input) {
    const doc = this.w.document(input.documentId);
    if (input.expectedHash !== doc.hash) fail('來源已變更', 'CONFLICT');
    if (!['description', 'routing', 'always', 'authorization', 'overlap', 'similar', 'link'].includes(input.rule)) fail('未知審核原則');
    const original = text(input.original, '原文', 6000), reason = text(input.reason, '理由', 4000), suggestion = text(input.suggestion, '修改建議', 6000), evidence = text(input.evidence, '證據', 4000);
    if (!doc.content.includes(original)) fail('原文不存在於指定版本');
    const finding = { id: uid(), documentId: doc.id, path: doc.path, title: doc.title, rule: input.rule, line: doc.content.slice(0, doc.content.indexOf(original)).split('\n').length, original, suggestion, reason, evidence, sourceHash: doc.hash, ruleVersion: 3, origin: 'ai_semantic_review', inference: true, triggerExamples: input.triggerExamples || [], state: 'open', managed: doc.managed, protectedFile: doc.protectedFile };
    this.w.db.prepare('INSERT INTO findings VALUES(?,?,?,?,?,?)').run(finding.id, doc.id, doc.hash, 'open', input.rule, JSON.stringify(finding)); return finding;
  }
  async replace(input) {
    text(input.search, '搜尋文字', 1000);
    if (input.regex) fail('此版本提供字面搜尋取代；正規表達式請產生明確逐段方案，以免不受限運算');
    if (typeof input.replacement !== 'string' || input.replacement.length > 10000) fail('取代文字不正確');
    if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 50) fail('每批選1–50份');
    const operations = [], preview = [];
    for (const selected of input.documents) {
      const doc = this.w.document(selected.id);
      if (selected.hash !== doc.hash) fail('來源已改變', 'CONFLICT');
      this.w.assertWritable(doc);
      const count = doc.content.split(input.search).length - 1;
      if (!count) continue;
      const content = doc.content.split(input.search).join(input.replacement);
      operations.push({ type: 'write', documentId: doc.id, expectedHash: doc.hash, content }); preview.push({ id: doc.id, title: doc.title, replacements: count });
    }
    if (!operations.length) return { status: 'no_change', affected: 0, message: '沒有符合的文字' };
    const plan = this.w.createPlan({ title: input.title || '批次搜尋取代', operations });
    return { ...this.w.planSummary(plan), preview, affected: operations.length };
  }
  metadata(input) {
    const doc = this.w.document(input.documentId);
    if (doc.hash !== input.expectedHash) fail('來源已改變', 'CONFLICT');
    if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields) || Object.keys(input.fields).length > 20) fail('metadata 欄位不正確');
    const eol = doc.content.includes('\r\n') ? '\r\n' : '\n', bom = doc.content.startsWith('\uFEFF') ? '\uFEFF' : '', content = doc.content.slice(bom.length);
    const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const lines = front ? front[1].split(/\r?\n/) : [];
    for (const [key, value] of Object.entries(input.fields)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) || JSON.stringify(value).length > 4000) fail('metadata 只接受簡單純量欄位');
      const start = lines.findIndex(line => line.startsWith(key + ':'));
      const line = key + ': ' + JSON.stringify(value);
      if (start < 0) lines.push(line);
      else { let end = start + 1; while (end < lines.length && /^\s+\S/.test(lines[end])) end++; lines.splice(start, end - start, line); }
    }
    const result = bom + '---' + eol + lines.join(eol) + eol + '---' + eol + (front ? content.slice(front[0].length) : content);
    const parsed = parseMarkdown(result); if (parsed.frontmatterError) fail('原 frontmatter 有複雜結構，請用原文編輯處理');
    for (const [key, value] of Object.entries(input.fields)) if (parsed.frontmatter[key] !== value) fail('metadata 無法安全更新，請用原文編輯');
    return this.w.planSummary(this.w.createPlan({ title: input.title || '更新文件中繼資料', operations: [{ type: 'write', documentId: doc.id, expectedHash: doc.hash, content: result }] }));
  }
  split(input) {
    const source = this.w.document(input.documentId);
    if (source.hash !== input.expectedHash) fail('來源已變更', 'CONFLICT');
    if (!Array.isArray(input.attachments) || !input.attachments.length || input.attachments.length > 20) fail('附件需1–20份');
    const operations = [{ type: 'write', documentId: source.id, expectedHash: source.hash, content: text(input.routerContent, '入口內容', 100000) }, ...input.attachments.map(a => ({ type: 'create', rootId: source.rootId, relativePath: a.relativePath, content: text(a.content, '附件內容', 100000) }))];
    const plan = this.w.createPlan({ title: input.title || '路由器與附件拆分', sourceDocuments: [{ documentId: source.id, expectedHash: source.hash }], operations });
    plan.requiresCoverage = true; this.w.save('plan', plan);
    this.coverage({ id: plan.id, coverage: [{ documentId: source.id, hash: source.hash, disposition: '拆為入口與附件', clauses: input.clauses || [] }] });
    return this.w.planSummary(this.w.plan(plan.id));
  }
  audit(input = {}) {
    const { rootId = '', rule = '', state = '', cursor = '', limit = 50, refresh = false } = input;
    if (rootId) this.w.root(rootId);
    const rows = this.w.db.prepare('SELECT d.id,d.hash,d.category FROM document_index d WHERE ' + (rootId ? 'EXISTS(SELECT 1 FROM memberships WHERE document_id=d.id AND root_id=?)' : 'EXISTS(SELECT 1 FROM memberships WHERE document_id=d.id)')).all(...(rootId ? [rootId] : []));
    let analyzed = 0;
    this.w.transaction(() => {
      for (const row of rows) {
        const fingerprint = hash(row.hash + ':' + row.category + ':rules3'), cached = this.w.db.prepare('SELECT fingerprint FROM audit_cache WHERE document_id=?').get(row.id);
        if (!refresh && cached?.fingerprint === fingerprint) continue;
        const doc = this.w.get('document', row.id), adapter = { list: () => [{ ...doc, category: row.category }], get: this.w.get.bind(this.w), resolveLink: this.w.resolveLink.bind(this.w) };
        const result = LegacyWorkbench.prototype.audit.call(adapter); analyzed++;
        this.w.db.prepare("UPDATE findings SET state='stale' WHERE document_id=? AND source_hash!=?").run(doc.id, doc.hash);
        for (const f of result.findings) {
          const prior = this.w.db.prepare('SELECT * FROM findings WHERE id=?').get(f.id);
          this.w.db.prepare('INSERT INTO findings VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_hash=excluded.source_hash,data=excluded.data').run(f.id, doc.id, doc.hash, prior?.source_hash === doc.hash ? prior.state : 'open', f.rule, JSON.stringify({ ...f, original: f.original.slice(0, 2000), sourceHash: doc.hash, ruleVersion: 3, origin: 'rule_candidate' }));
        }
        this.w.db.prepare('INSERT INTO audit_cache VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET fingerprint=excluded.fingerprint').run(doc.id, fingerprint);
      }
    });
    const generation = hash(rows.map(r => r.id + ':' + r.hash).sort()), cacheId = 'similarity3:' + rootId;
    if (refresh || this.w.get('meta', cacheId)?.generation !== generation) {
      const docs = rows.slice(0, 2000).map(r => this.w.get('document', r.id)), similar = similarFindings(docs);
      const byHash = new Map();
      for (const doc of docs) { const list = byHash.get(doc.hash) || []; list.push(doc); byHash.set(doc.hash, list); }
      for (const group of byHash.values()) if (group.length > 1) similar.findings.push({ id: hash('duplicate:' + group.map(d => d.id).sort()).slice(0, 24), documentId: group[0].id, path: group[0].path, title: group[0].title, rule: 'overlap', line: 1, original: group.length + '份內容完全相同', suggestion: '核對用途、授權與引用，不能直接刪除副本', relatedSources: group.slice(1, 20).map(d => ({ documentId: d.id, hash: d.hash })) });
      for (const f of similar.findings) { const doc = this.w.get('document', f.documentId), prior = this.w.db.prepare('SELECT * FROM findings WHERE id=?').get(f.id); this.w.db.prepare('INSERT INTO findings VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_hash=excluded.source_hash,data=excluded.data').run(f.id, f.documentId, doc.hash, prior?.source_hash === doc.hash ? prior.state : 'open', f.rule, JSON.stringify({ ...f, sourceHash: doc.hash, origin: 'similarity_candidate', ruleVersion: 3 })); }
      this.w.save('meta', { id: cacheId, generation, comparisons: similar.comparisons, pairBudget: similar.pairBudget, truncated: similar.truncated || rows.length > 2000, considered: docs.length, totalDocuments: rows.length });
    }
    const where = ['1=1'], params = [];
    if (rootId) { where.push('EXISTS(SELECT 1 FROM memberships WHERE document_id=f.document_id AND root_id=?)'); params.push(rootId); }
    if (rule) { where.push('rule=?'); params.push(rule); }
    if (state) { where.push('state=?'); params.push(state); }
    const total = this.w.db.prepare('SELECT count(*) n FROM findings f WHERE ' + where.join(' AND ')).get(...params).n;
    if (cursor) { where.push('id>?'); params.push(cursor); }
    const n = Math.min(100, Math.max(1, limit)), found = this.w.db.prepare('SELECT * FROM findings f WHERE ' + where.join(' AND ') + ' ORDER BY id LIMIT ?').all(...params, n + 1);
    return { findings: found.slice(0, n).map(r => ({ ...JSON.parse(r.data), state: r.state })), total, nextCursor: found.length > n ? found[n - 1].id : null, analyzedDocuments: analyzed, similarity: this.w.get('meta', cacheId), semanticReview: '規則與相似度僅產生候選；AI 以來源版本、原文及證據提交語意審核。' };
  }
}
