import { text, strings, scope, revision, saveVersion, page, hash, uid, now, fail, estimateTokens } from './shared.mjs';
import { queryTerms } from './retrieval.mjs';

export class SourceService {
  constructor(w) {
    this.w = w;
    w.db.exec('CREATE TABLE IF NOT EXISTS source_chunks(id TEXT PRIMARY KEY,source_id TEXT,scope TEXT,revision INTEGER,title TEXT,body TEXT,locator TEXT); CREATE INDEX IF NOT EXISTS source_scope ON source_chunks(scope,source_id);');
  }
  save(input) {
    return this.w.transaction(() => {
      const old = revision(this.w, 'source', input), selected = scope(this.w, input.scope || old?.scope || 'personal');
      const content = text(input.content ?? old?.content, '來源內容', 64000), title = text(input.title ?? old?.title, '來源標題', 300);
      const uri = text(input.uri ?? old?.uri, '來源網址或定位', 2000);
      if (!/^(https?:\/\/|document:|user:|artifact:)/i.test(uri)) fail('來源定位需為 http(s)、document:、user: 或 artifact:');
      for (const key of ['publishedAt', 'expiresAt']) if (input[key] && !Number.isFinite(Date.parse(input[key]))) fail('來源日期格式不正確');
      const item = saveVersion(this.w, 'source', old, { title, scope: selected, uri, content, contentHash: hash(content), author: text(input.author ?? old?.author, '作者', 300, true), license: text(input.license ?? old?.license, '使用權', 1000, true), publishedAt: input.publishedAt ?? old?.publishedAt ?? null, retrievedAt: now(), expiresAt: input.expiresAt ?? old?.expiresAt ?? null, lifecycle: input.lifecycle || old?.lifecycle || 'active', trust: 'reference_data', observations: strings(input.observations ?? old?.observations), inferences: strings(input.inferences ?? old?.inferences) });
      if (!['active', 'archived', 'pending_delete', 'trashed'].includes(item.lifecycle)) fail('來源狀態不正確');
      this.w.db.prepare('DELETE FROM source_chunks WHERE source_id=?').run(item.id);
      const sections = content.split(/(?=^#{1,6}\s)/m);
      let part = 0;
      for (const section of sections) for (let start = 0; start < section.length; start += 1800) this.w.db.prepare('INSERT INTO source_chunks VALUES(?,?,?,?,?,?,?)').run(item.id + ':' + part++, item.id, selected, item.revision, title, section.slice(start, start + 1800), 'offset:' + content.indexOf(section) + '+' + start);
      if (old && (old.contentHash !== item.contentHash || item.lifecycle !== 'active')) {
        for (const row of this.w.db.prepare("SELECT data FROM records WHERE kind='memory' AND EXISTS(SELECT 1 FROM json_each(data,'$.externalSourceRefs') WHERE json_extract(value,'$.id')=?)").all(item.id)) {
          const knowledge = JSON.parse(row.data);
          this.w.saveMemory({ id: knowledge.id, expectedRevision: knowledge.revision, reviewState: 'needs_review' });
        }
      }
      return { ...item, content: undefined, chunkCount: part };
    });
  }
  list(input) { return page(this.w,'source',input,item=>({id:item.id,revision:item.revision,title:item.title,scope:item.scope,uri:item.uri,author:item.author,license:item.license?.slice(0,300),contentHash:item.contentHash,lifecycle:item.lifecycle,publishedAt:item.publishedAt,retrievedAt:item.retrievedAt,expiresAt:item.expiresAt})); }
  read(input) {
    const item = input.revision ? this.w.get('sourceRevision', input.id + ':' + input.revision) : this.w.get('source', input.id);
    if (!item) fail('來源不存在');
    const field=input.field||'content';if(!['content','observations','inferences'].includes(field))fail('來源欄位不正確');
    const value=item[field],body=typeof value==='string'?value:JSON.stringify(value),offset=Math.max(0,Number(input.offset)||0),content=body.slice(offset,offset+2000);
    return { ...item, observations:input._internal?item.observations:undefined,inferences:input._internal?item.inferences:undefined, content, field, format:typeof value==='string'?'text':'json_fragment',offset,nextOffset:offset+content.length<body.length?offset+content.length:null,instructionAuthority:false };
  }
  search(input) {
    const selected = scope(this.w, input.scope || 'personal'), terms = queryTerms(text(input.query, '查詢', 2000));
    if (!terms.length) return { items: [] };
    const pattern = t => '%' + t.replace(/[\\%_]/g, '\\$&') + '%';
    const rank = terms.map(() => "(CASE WHEN lower(c.title||c.body) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)").join('+');
    const rows = this.w.db.prepare('SELECT c.*,(' + rank + ") score FROM source_chunks c JOIN records r ON r.kind='source' AND r.id=c.source_id WHERE (c.scope=? OR c.scope='personal') AND json_extract(r.data,'$.lifecycle')='active' AND (json_extract(r.data,'$.expiresAt') IS NULL OR json_extract(r.data,'$.expiresAt')>?) AND (" + terms.map(() => "lower(c.title||c.body) LIKE ? ESCAPE '\\'").join(' OR ') + ') ORDER BY score DESC,c.id LIMIT ?').all(...terms.map(pattern), selected, now(), ...terms.map(pattern), Math.min(12, input.limit || 6));
    return { items: rows.map(r => ({ id: r.source_id, revision: r.revision, chunkId: r.id, title: r.title, locator: r.locator, excerpt: r.body.slice(0, 600), trust: 'reference_data', instructionAuthority: false })) };
  }
}

export class ContextService {
  constructor(w) { this.w = w; }
  compile(input){return this.w.transaction(()=>this.compileLocked(input));}
  compileLocked(input) {
    const request = text(input.request, '原始需求', 14000);
    const task = this.w.createTask({ title: input.title || request.slice(0, 60), goal: input.goal || request.slice(0, 1000), request, scope: scope(this.w, input.scope || 'personal'), constraints: strings(input.constraints), deliverables: strings(input.deliverables), criteria: strings(input.criteria), assumptions: strings(input.assumptions), unknowns: strings(input.unknowns), environment: input.environment || {}, domains: strings(input.domains) });
    this.w.save('taskRequest', { id: task.id + ':1', taskId: task.id, taskRevision: task.revision, request, hash: hash(request), at: now() });
    return this.explain(task.id);
  }
  explain(id) {
    const task = this.w.get('task', id); if (!task) fail('任務不存在');
    const methods = this.w.methods().filter(m => (task.methods || []).includes(m.id) || task.unknowns?.length && ['blind-spots', 'interview'].includes(m.id));
    return { task, originalRequest: task.request, optimizedTask: { objective: task.goal, outputs: task.deliverables, constraints: task.constraints, acceptance: task.criteria, assumptions: task.assumptions, unknowns: task.unknowns, environment: task.environment, methodRoutes: methods }, guidance: '原始需求是使用者來源；摘要與假設不改變其授權。方法依需要選用，未指定內容不得當作已確認。' };
  }
  build(input) {
    const task = this.w.get('task', input.taskId); if (!task) fail('任務不存在');
    if (input.expectedRevision !== task.revision) fail('任務已修訂', 'CONFLICT');
    const runId = input.runId || this.w.budget.resolve({ taskId: task.id, scope: task.scope });
    const ledger = this.w.get('retrieval', runId); this.w.budget.checkTask(ledger);
    if (ledger.scope && ledger.scope !== task.scope) fail('讀取工作與任務範圍不符', 'OUT_OF_SCOPE');
    const excluded = new Set(input.excludeIds || []), selected = this.w.retrieval.search({ taskId: task.id, query: input.query || task.goal, limit: 6, _internal: true });
    const items = [], max = Math.min(8000, Math.max(500, input.maxTokens || 3000));
    const brief = { goal: task.goal, constraints: task.constraints, deliverables: task.deliverables, criteria: task.criteria, assumptions: task.assumptions, unknowns: task.unknowns, environment: task.environment };
    let used = estimateTokens(brief);
    if(used>max)fail('必要的任務摘要超出材料預算；請精簡重複描述或明確提高預算，不能刪掉必要限制','BRIEF_TOO_LARGE');
    for (const found of selected.items) {
      if (excluded.has(found.id)) continue;
      const memory = this.w.get('memory', found.id);
      const item = { ...found, content: memory.content, appliesWhen: memory.appliesWhen, notWhen: memory.notWhen || '', excludeWhen: memory.excludeWhen, sourceRefs: memory.sourceRefs, externalSourceRefs: memory.externalSourceRefs || [], verification: memory.verification || 'reported', evidence: memory.evidence || '' };
      const n = estimateTokens(item);
      if (used + n > max) continue;
      items.push(item); used += n;
    }
    const sources = input.includeSources ? this.w.sources.search({ scope: task.scope, query: input.query || task.goal, limit: 3 }).items : [];
    const context = { taskId: task.id, taskRevision: task.revision, scope: task.scope, brief, items, uncertain: selected.uncertain, sources: [], indexVersion: selected.indexVersion, estimatedTokens: used, omittedCount: selected.items.length - items.length, status: items.length ? 'matched' : 'needs_research', instructionAuthority: 'task_and_host_only', sourceOfTruth: 'original_request_and_versioned_sources' };
    for (const source of sources) if (used + estimateTokens(source) < max) { context.sources.push(source); used += estimateTokens(source); }
    context.estimatedTokens = used;
    const charged = this.w.budget.charge(context, runId, 'context:' + hash({ task: task.id, revision: task.revision, index: selected.indexVersion, items: items.map(i => [i.id, i.revision]), excluded: [...excluded], query: input.query, sources: context.sources.map(s => [s.chunkId, s.revision]) }));
    if (!charged.alreadySent) this.w.save('contextPackage', { id: uid(), taskId: task.id, taskRevision: task.revision, scope: task.scope, runId, items: items.map(i => ({ id: i.id, revision: i.revision, reason: i.selectedBecause })), at: now(), estimatedTokens: used });
    return charged;
  }
  history(input) { return page(this.w, 'contextPackage', input); }
}
