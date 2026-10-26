import { now, uid, fail, scope, estimateTokens } from './shared.mjs';

export class BudgetService {
  constructor(w) { this.w = w; this.defaults = new Map(); }
  begin(input = {}) {
    const task = input.taskId ? this.w.get('task', input.taskId) : null;
    if (input.taskId && !task) fail('任務不存在');
    const selectedScope = scope(this.w, input.scope || task?.scope || 'personal');
    if (task && task.scope !== selectedScope) fail('任務與範圍不符', 'OUT_OF_SCOPE');
    const item = { id: uid(), scope: selectedScope, taskId: task?.id || null, taskRevision: task?.revision || null, bytes: 0, sent: [], textTokens: 0, imageTokens: 0, images: 0, maxBytes: Math.min(196608, Math.max(1024, input.maxBytes || 49152)), maxTokens: Math.min(32000, Math.max(256, input.maxTokens || 6000)), maxImages: Math.min(12, Math.max(0, input.maxImages ?? 3)), createdAt: now(), expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(), usageSource: 'plugin_estimate', actual: [] };
    this.w.save('retrieval', item); return this.status(item.id);
  }
  resolve(input = {}) {
    if (input.runId) return input.runId;
    const task = input.taskId ? this.w.get('task', input.taskId) : null;
    const key = `${input.scope || input.rootId || task?.scope || 'personal'}:${task?.id || ''}:${task?.revision || ''}`;
    const run = this.defaults.get(key);
    if (run && Date.parse(this.w.get('retrieval', run)?.expiresAt || '') > Date.now()) return run;
    const id = this.begin({ ...input, scope: input.scope || input.rootId || task?.scope || 'personal' }).runId;
    this.defaults.set(key, id); return id;
  }
  checkTask(ledger) {
    if (ledger.expiresAt && Date.parse(ledger.expiresAt) <= Date.now()) fail('本次脈絡工作已到期，請建立新工作', 'RUN_EXPIRED');
    if (ledger.taskId) { const task = this.w.get('task', ledger.taskId); if (!task || task.revision !== ledger.taskRevision) fail('任務已修訂，請重新建立脈絡工作', 'CONFLICT'); }
  }
  charge(result, runId, key, media = {}) {
    runId ||= this.resolve();
    return this.w.transaction(() => {
      const ledger = this.w.get('retrieval', runId) || { id: runId, bytes: 0, sent: [], maxBytes: 49152, maxTokens: 6000, maxImages: 3, textTokens: 0, imageTokens: 0, images: 0, createdAt: now(), usageSource: 'plugin_estimate' };
      this.checkTask(ledger);
      if(!media.ack&&ledger.scope&&result.scope&&result.scope!=='personal'&&result.scope!==ledger.scope)fail('資料超出本次脈絡工作範圍','OUT_OF_SCOPE');
      if (ledger.sent.includes(key)) return { alreadySent: true, runId, bytesUsed: ledger.bytes, message: '此版本已在本次工作提供；內容變更後可重新讀取。' };
      const bytes = Buffer.byteLength(JSON.stringify(result)), textTokens = estimateTokens(result), imageTokens = media.estimatedTokens || 0, imageCount = media.images || 0;
      if ((ledger.bytes + bytes > (ledger.maxBytes || 49152) || (ledger.textTokens || 0) + (ledger.imageTokens || 0) + textTokens + imageTokens > (ledger.maxTokens || 6000) || (ledger.images || 0) + imageCount > (ledger.maxImages ?? 3) ) && !media.ack) fail('本次共用讀取預算不足；請讀較小段落、區域或檢視目前用量', 'BUDGET_EXHAUSTED');
      ledger.bytes += bytes; ledger.textTokens = (ledger.textTokens || 0) + textTokens; ledger.imageTokens = (ledger.imageTokens || 0) + imageTokens; ledger.images = (ledger.images || 0) + imageCount; ledger.sent.push(key); ledger.updatedAt = now();
      if (ledger.sent.length > 2000) fail('本次讀取項目已達上限', 'BUDGET_EXHAUSTED');
      this.w.save('retrieval', ledger);
      this.w.save('budgetEvent', { id: uid(), runId, key, bytes, textTokens, imageTokens, images: imageCount, at: now(), usageSource: 'estimate', mediaModel: media.model || null });
      const budget = this.status(runId);
      return { ...result, runId, bytesUsed: ledger.bytes, remainingBytes: budget.remainingBytes, budget: { remainingEstimatedTokens: budget.remainingEstimatedTokens, estimatedTextTokens: budget.estimatedTextTokens, estimatedImageTokens: budget.estimatedImageTokens, images: budget.images, usageSource: 'plugin_estimate' } };
    });
  }
  status(runId) {
    const r = this.w.get('retrieval', runId); if (!r) fail('脈絡工作不存在', 'NOT_FOUND');
    return { runId, scope: r.scope, taskId: r.taskId, taskRevision: r.taskRevision, bytesUsed: r.bytes, remainingBytes: (r.maxBytes || 49152) - r.bytes, estimatedTextTokens: r.textTokens || 0, estimatedImageTokens: r.imageTokens || 0, remainingEstimatedTokens: (r.maxTokens || 6000) - (r.textTokens || 0) - (r.imageTokens || 0), images: r.images || 0, maxImages: r.maxImages ?? 3, actual: r.actual || [], usageSource: r.usageSource || 'plugin_estimate', expiresAt: r.expiresAt, excludes: ['宿主歷史與工具定義', '未回報的模型輸出與推理', '其他工具及供應商費用'] };
  }
  actual(input) {
    const r = this.w.get('retrieval', input.runId); if (!r) fail('脈絡工作不存在');
    if (!input.provider || !input.model || !input.requestId) fail('實際用量需要供應商、模型與 requestId');
    for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens']) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < 0)) fail('用量須為非負整數');
    if ((r.actual || []).some(x => x.requestId === input.requestId)) return this.status(r.id);
    r.actual = [...(r.actual || []), { provider: input.provider, model: input.model, requestId: input.requestId, inputTokens: input.inputTokens ?? null, cachedInputTokens: input.cachedInputTokens ?? null, outputTokens: input.outputTokens ?? null, at: now(), provenance: 'host_reported' }].slice(-100);
    this.w.save('retrieval', r); return this.status(r.id);
  }
}
