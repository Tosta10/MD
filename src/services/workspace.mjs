import { revision, saveVersion, page, text, scope, uid, now, fail, hash } from './shared.mjs';

export class WorkspaceService {
  constructor(w) { this.w = w; }
  draft(input){return ['save','delete'].includes(input.action)?this.w.transaction(()=>this.draftLocked(input)):this.draftLocked(input);}
  draftLocked(input) {
    if (input.action === 'list') return page(this.w, 'draft', input, ({ content, fields, ...item }) => item);
    if (input.action === 'read') return this.w.get('draft', input.id) || { id: input.id, revision: 0, fields: null };
    if (input.action === 'delete') {
      const item = this.w.get('draft', input.id); if (item && item.revision !== input.expectedRevision) fail('草稿已更新', 'CONFLICT');
      this.w.remove('draft', input.id); return { id: input.id, status: 'removed' };
    }
    if (input.action !== 'save') fail('草稿動作不正確');
    text(input.id, '草稿識別', 200);
    const old = this.w.get('draft', input.id);
    if (old && input.expectedRevision !== old.revision) fail('草稿已由其他工作階段修改，請重新讀取', 'CONFLICT');
    if (Buffer.byteLength(JSON.stringify(input.fields || {})) > 2 * 1024 * 1024) fail('草稿超過2 MiB');
    const item = { id: input.id, revision: (old?.revision || 0) + 1, title: text(input.title || '編輯草稿', '名稱', 300), scope: scope(this.w, input.scope || 'personal'), documentId: input.documentId || null, baseHash: input.baseHash || null, fields: input.fields, updatedAt: now() };
    this.w.save('draft', item); return { ...item, fields: undefined, status: 'saved' };
  }
  activity(input) {
    if (input.action !== 'add') return page(this.w, 'activity', input);
    const record = { id: uid(), title: text(input.title, '操作訊息', 2000), status: input.status || 'success', scope: input.scope || 'personal', at: now() };
    this.w.save('activity', record);
    this.w.db.prepare("DELETE FROM records WHERE kind='activity' AND rowid NOT IN (SELECT rowid FROM records WHERE kind='activity' ORDER BY rowid DESC LIMIT 1000)").run();
    return record;
  }
  portability(input) {
    const selected = scope(this.w, input.scope || 'personal');
    if (input.action === 'export') {
      const rows = this.w.db.prepare("SELECT data FROM records WHERE kind='memory' AND json_extract(data,'$.scope')=? ORDER BY id LIMIT ? OFFSET ?").all(selected, Math.min(20, input.limit || 10), Math.max(0, input.offset || 0));
      const knowledge = rows.map(r => JSON.parse(r.data));
      return { format: 'workbench-knowledge', schemaVersion: 3, scope: selected, at: now(), knowledge, manifestHash: hash(knowledge), nextOffset: rows.length === (input.limit || 10) ? (input.offset || 0) + rows.length : null, note: '外部來源與資產以定位保留；匯入會提出候選方案，不覆寫原 ID' };
    }
    if (input.action !== 'import') fail('匯出入動作不正確');
    const bundle = input.bundle;
    if (!bundle || bundle.format !== 'workbench-knowledge' || !Array.isArray(bundle.knowledge) || bundle.knowledge.length > 20 || bundle.manifestHash !== hash(bundle.knowledge)) fail('資料包格式、筆數或 hash 不正確');
    const operations = [];
    for (const item of bundle.knowledge) {
      const values = { title: item.title, content: item.content, source: item.source, appliesWhen: item.appliesWhen, notWhen: item.notWhen || '', type: item.type, domains: item.domains || [], tags: item.tags || [], scope: selected, appliesTo: item.appliesTo || {}, excludeWhen: item.excludeWhen || {}, reviewState: 'candidate', lifecycle: 'active' };
      const existing = this.w.db.prepare("SELECT 1 FROM records WHERE kind='memory' AND json_extract(data,'$.scope')=? AND json_extract(data,'$.content')=? AND json_extract(data,'$.appliesWhen')=? LIMIT 1").get(selected, item.content, item.appliesWhen);
      if (!existing) operations.push({ type: 'create', values });
    }
    if (!operations.length) return { status: 'no_change', message: '此範圍已有相同內容與適用條件' };
    return this.w.knowledge.propose({ title: input.title || '匯入知識資料包', reason: '使用者選定資料包；來源有效性仍需核對', operations });
  }
  evaluation(input) {
    if (input.action === 'list') return page(this.w, 'evaluation', input);
    if (input.action === 'record') {
      if (!['A', 'B', 'C'].includes(input.arm) || !['md', 'knowledge', 'visual'].includes(input.domain)) fail('需指定 A／B／C 及領域');
      const numbers = ['inputTokens', 'outputTokens', 'cachedTokens', 'durationMs', 'cost', 'rework'];
      for (const key of numbers) if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < 0)) fail('評測數值需為非負');
      if (typeof input.passed !== 'boolean') fail('需提供明確完成判斷');
      const record = { id: uid(), title: text(input.title, '評測名稱', 300), scope: scope(this.w, input.scope || 'personal'), caseId: text(input.caseId, '測試題 ID', 200), arm: input.arm, domain: input.domain, model: text(input.model, '模型', 200), settingsHash: text(input.settingsHash, '設定識別', 200), datasetHash: text(input.datasetHash, '資料集識別', 200), artifactRef: text(input.artifactRef, '證據定位', 2000), passed: input.passed, holdout: input.holdout === true, ...Object.fromEntries(numbers.map(k => [k, input[k] ?? null])), provenance: 'host_reported', at: now() };
      this.w.save('evaluation', record); return record;
    }
    if (input.action !== 'report') fail('評測動作不正確');
    const rows = this.w.db.prepare("SELECT data FROM records WHERE kind='evaluation' AND json_extract(data,'$.datasetHash')=? AND json_extract(data,'$.model')=? AND json_extract(data,'$.settingsHash')=?").all(input.datasetHash, input.model, input.settingsHash).map(r => JSON.parse(r.data));
    const arms = {};
    for (const arm of ['A', 'B', 'C']) {
      const items = rows.filter(r => r.arm === arm && r.holdout), cases = new Set(items.map(r => r.caseId));
      arms[arm] = { runs: items.length, independentCases: cases.size, passed: items.filter(r => r.passed).length, successRate: items.length ? items.filter(r => r.passed).length / items.length : null, meanTotalTokens: items.length && items.every(r => r.inputTokens !== null && r.outputTokens !== null) ? items.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0) / items.length : null };
    }
    const paired = ['A', 'B', 'C'].map(a => new Set(rows.filter(r => r.arm === a && r.holdout).map(r => r.caseId))), common = [...paired[0]].filter(id => paired[1].has(id) && paired[2].has(id));
    return { arms, pairedIndependentCases: common.length, comparison: common.length ? 'descriptive_only' : 'not_measured', significance: 'not_established', source: 'host_reported', note: '同題重跑不是獨立樣本；需人工校準、配對比較與信賴區間，不能據此宣稱模型能力永久提高' };
  }
}
