import { text, strings, scope, revision, saveVersion, page, now, uid, hash, fail } from './shared.mjs';

const actions = ['annotate', 'knowledge_patch', 'knowledge_archive', 'knowledge_trash', 'document_write', 'document_create', 'document_delete'];
export class PolicyService {
  constructor(w) { this.w = w; }
  save(input) {return this.w.transaction(()=>this.saveLocked(input));}
  saveLocked(input) {
    if (input.confirm !== true) fail('建立或修改自治政策需明確授權');
    const old = revision(this.w, 'policy', input), scopes = strings(input.scopes ?? old?.scopes, '授權範圍', 20), allowed = strings(input.actions ?? old?.actions, '動作', 20);
    if (!scopes.length || !allowed.length || allowed.some(a => !actions.includes(a))) fail('需指定有效範圍與動作');
    for (const s of scopes) scope(this.w, s);
    if (input.expiresAt && (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now())) fail('政策到期日需在未來');
    const maxOperations = Math.min(1000, Math.max(1, input.maxOperations || old?.maxOperations || 100));
    return saveVersion(this.w, 'policy', old, { title: text(input.title ?? old?.title, '政策名稱', 200), scopes, actions: allowed, enabled: input.enabled ?? old?.enabled ?? true, expiresAt: input.expiresAt || old?.expiresAt || null, maxOperations, usedOperations: old?.usedOperations || 0, retentionDays: Math.min(3650, Math.max(1, input.retentionDays || old?.retentionDays || 30)), grantReason: text(input.grantReason ?? old?.grantReason, '授權依據', 2000) });
  }
  list(input) { return page(this.w, 'policy', input); }
  check(policy, operations) {
    if (!policy || !policy.enabled || policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now()) fail('自治政策不存在、停用或已到期', 'POLICY_BLOCKED');
    if (policy.usedOperations + operations.length > policy.maxOperations) fail('政策操作額度已達上限', 'POLICY_BLOCKED');
    for (const op of operations) if (!policy.scopes.includes(op.scope) || !policy.actions.includes(op.action)) fail('方案超出自治政策的範圍或動作：' + op.action, 'POLICY_BLOCKED');
  }
  apply(input) {
    const policy = this.w.get('policy', input.policyId);
    if (!policy || input.expectedPolicyRevision !== policy.revision) fail('政策已改變，請重新讀取', 'CONFLICT');
    const kind = input.kind;
    if (!['knowledgePlan', 'plan'].includes(kind)) fail('方案類型不正確');
    const plan = this.w.get(kind, input.planId); if (!plan) fail('方案不存在');
    if (plan.status === 'applied') return { id: plan.id, status: 'applied', idempotent: true };
    const operations = kind === 'knowledgePlan' ? plan.operations.flatMap(op => {const action=op.type==='state'?(op.lifecycle==='trashed'?'knowledge_trash':op.lifecycle==='active'?'knowledge_patch':'knowledge_archive'):'knowledge_patch',target=op.values?.scope||op.before?.scope||'personal';return [{scope:target,action},...(op.before&&op.before.scope!==target?[{scope:op.before.scope,action}]:[])];}) : plan.operations.map(op => ({ scope: op.rootId, action: 'document_' + op.type }));
    const pending = { id: uid(), title: plan.title, status: 'applying', policyId: policy.id, policyRevision: policy.revision, planId: plan.id, kind, operations, at: now() };
    this.w.transaction(()=>{
      const current=this.w.get('policy',policy.id);
      if(current.revision!==policy.revision)fail('政策已改變','CONFLICT');
      const leaseId=kind+':'+plan.id,lease=this.w.get('policyLease',leaseId);
      if(lease&&lease.status==='applying'){let alive=false;try{process.kill(lease.pid,0);alive=true;}catch{}if(alive)fail('同一方案正在套用，請稍候','BUSY');}
      this.check(current,operations);
      this.w.save('policyLease',{id:leaseId,status:'applying',pid:process.pid,eventId:pending.id,at:now()});
      this.w.save('policy',{...current,usedOperations:current.usedOperations+operations.length});
      this.w.save('maintenanceEvent',pending);
    });
    try {
      const result = kind === 'knowledgePlan' ? this.w.knowledge.applyChange(plan.id, true) : this.w.applyPlan(plan.id, true);
      this.w.save('policyLease',{id:kind+':'+plan.id,status:'applied',eventId:pending.id,at:now()});
      this.w.save('maintenanceEvent', { ...pending, status: 'applied', finishedAt: now(), result, undo: { kind, planId: plan.id }, quarantineUntil: new Date(Date.now() + policy.retentionDays * 86400000).toISOString() });
      return { ...result, policyId: policy.id, undo: { kind, planId: plan.id } };
    } catch (error) { this.w.save('policyLease',{id:kind+':'+plan.id,status:'failed',eventId:pending.id,at:now()});this.w.save('maintenanceEvent', { ...pending, status: 'failed', error: error.message, finishedAt: now() }); throw error; }
  }
  maintain(input) {
    const selected = scope(this.w, input.scope || 'personal');
    const rows = this.w.db.prepare("SELECT data FROM records WHERE kind='memory' AND json_extract(data,'$.scope')=? AND json_extract(data,'$.lifecycle')='active' ORDER BY rowid DESC LIMIT 1001").all(selected);
    const grouped = new Map(), candidates = [];
    for (const row of rows.slice(0, 1000)) {
      const item = JSON.parse(row.data);
      if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) { candidates.push({ id: item.id, revision: item.revision, reason: '已超過明示有效期限', lifecycle: 'archived' }); continue; }
      const key = hash({ content: item.content, source: item.source, appliesWhen: item.appliesWhen, notWhen: item.notWhen, appliesTo: item.appliesTo, excludeWhen: item.excludeWhen, type: item.type });
      if (grouped.has(key)) { const replacement = grouped.get(key); if (replacement.reviewState === 'validated' && item.reviewState !== 'validated') candidates.push({ id: item.id, revision: item.revision, reason: '與相同適用條件及來源的已確認紀錄完全重複', replacementId: replacement.id, lifecycle: 'archived' }); }
      else grouped.set(key, item);
    }
    if (!input.policyId || !candidates.length) return { candidates: candidates.slice(0, 100), total: candidates.length, truncated: rows.length > 1000, status: 'review', note: '低使用率、檔齡或檔名不作為自動刪除依據' };
    const chosen = candidates.slice(0, 20), plan = this.w.knowledge.propose({ title: '知識維護', reason: chosen.map(c => c.reason).join('；').slice(0, 4000), operations: chosen.map(c => ({ type: 'state', id: c.id, expectedRevision: c.revision, lifecycle: 'archived' })) });
    return { ...this.apply({ policyId: input.policyId, expectedPolicyRevision: input.expectedPolicyRevision, planId: plan.id, kind: 'knowledgePlan' }), affected: chosen.length, remaining: candidates.length - chosen.length };
  }
}

export class JobService {
  constructor(w) { this.w = w; this.running = new Map(); }
  snapshot(input = {}) {
    if(input.action==='membership'){
      const snapshot=this.w.get('selection',input.id);if(!snapshot)fail('選取快照不存在');
      const requested=new Set(strings(input.documentIds,'文件ID',300));
      return {id:snapshot.id,ids:snapshot.documents.filter(d=>requested.has(d.id)).map(d=>d.id),total:snapshot.total};
    }
    if (input.rootId) this.w.root(input.rootId);
    const documents = []; let cursor = '', total;
    do {
      const page = this.w.documents({ ...input, offset: 0, cursor, limit: 300 });
      total ??= page.total;
      if (page.total !== total || total > 50000) fail('選取結果已變更或超過50,000份，請縮小範圍', 'CONFLICT');
      documents.push(...page.documents.map(d => ({ id: d.id, hash: d.hash }))); cursor = page.nextCursor;
    } while (cursor);
    if (documents.length !== total) fail('索引在選取期間已變更', 'CONFLICT');
    const record = { id: uid(), scope: input.rootId || null, query: { rootId: input.rootId, query: input.query, status: input.status, category: input.category }, documents, total, createdAt: now() };
    this.w.save('selection', record);
    return { id: record.id, total, query: record.query, version: hash(documents), message: '固定選取結果與來源版本；套用時會再核對' };
  }
  start(input) {
    if (!['index', 'batch_mark'].includes(input.action)) fail('背景工作類型不正確');
    if (input.action === 'index') return this.w.startJob(input);
    const snapshot = this.w.get('selection', input.selectionId); if (!snapshot) fail('選取快照不存在');
    text(input.reason, '共同理由', 4000);
    if(!['active','completed','pending_delete','keep'].includes(input.status))fail('標註狀態不正確');
    if(input.status==='pending_delete')text(input.evidence,'完成或取代依據',4000);
    const excluded = new Set(input.excludeIds || []), documents = snapshot.documents.filter(d => !excluded.has(d.id));
    const job = { id: uid(), action: input.action, input: { status: input.status, reason: input.reason, evidence: input.evidence || '' }, documents, total: documents.length, processed: 0, succeeded: 0, errors: [], status: 'queued', createdAt: now(), pid: process.pid };
    this.w.save('backgroundJob', job); this.schedule(job); return this.summary(job);
  }
  summary(job) { const { input, documents, ...meta } = job; return meta; }
  schedule(job) {
    this.running.set(job.id, job);
    const step = () => {
      if (this.w.closed) return;
      if (job.cancelRequested || job.processed >= job.total) { job.status = job.cancelRequested ? 'cancelled' : job.errors.length ? 'partial' : 'completed'; job.finishedAt = now(); this.w.save('backgroundJob', job); this.running.delete(job.id); return; }
      job.status = 'running';
      const end = Math.min(job.processed + 25, job.total);
      for (; job.processed < end; job.processed++) {
        const selected = job.documents[job.processed];
        try { this.w.documentsService.batch({ ...job.input, documents: [selected] }); job.succeeded++; }
        catch (error) { if (job.errors.length < 100) job.errors.push({ id: selected.id, error: error.message }); job.failed = (job.failed || 0) + 1; }
      }
      job.heartbeat = now(); this.w.save('backgroundJob', job); setImmediate(step);
    };
    setImmediate(step);
  }
  get(id) {
    const job = this.running.get(id) || this.w.get('backgroundJob', id);
    if (!job) return this.w.getJob(id);
    if (!this.running.has(id) && ['running', 'queued'].includes(job.status)) {
      let alive = false; try { process.kill(job.pid, 0); alive = true; } catch {}
      if (!alive || Date.now() - Date.parse(job.heartbeat || job.createdAt) > 60000) { job.status = 'interrupted'; this.w.save('backgroundJob', job); }
    }
    return this.summary(job);
  }
  cancel(id) { const job = this.running.get(id); if (!job) return this.w.cancelJob(id); job.cancelRequested = true; this.w.save('backgroundJob', job); return this.summary(job); }
  resume(id) {
    if(!this.w.get('backgroundJob',id)){const old=this.w.getJob(id);if(old.status!=='interrupted')fail('索引工作不可恢復');return {...this.w.startJob({rootId:old.rootId||undefined}),resumedFrom:id};}
    const job = this.w.get('backgroundJob', id); if (!job || !['interrupted', 'cancelled', 'partial'].includes(this.get(id).status)) fail('工作不可恢復');
    if (job.status === 'partial') fail('部分成功工作請重新選取失敗項目，避免重複修改');
    job.cancelRequested = false; job.status = 'queued'; job.pid = process.pid; this.w.save('backgroundJob', job); this.schedule(job); return this.summary(job);
  }
  close() { for (const job of this.running.values()) { job.status = 'interrupted'; this.w.save('backgroundJob', job); } this.running.clear(); }
}
