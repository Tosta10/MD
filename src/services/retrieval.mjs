import { fail, hash, scope, estimateTokens, text } from './shared.mjs';

export function queryTerms(query) {
  const words = query.normalize('NFKC').toLowerCase().match(/[a-z0-9_./:#@-]+|[\u3400-\u9fff]+/g) || [];
  const result = new Set();
  for (const word of words) {
    result.add(word);
    if (/[\u3400-\u9fff]/.test(word) && word.length > 3) for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
  }
  return [...result].slice(0, 24);
}
function compare(a, b) {
  const pa = String(a).replace(/^v/, '').split('.'), pb = String(b).replace(/^v/, '').split('.');
  if (![...pa, ...pb].every(x => /^\d+$/.test(x))) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const n = Number(pa[i] || 0) - Number(pb[i] || 0); if (n) return Math.sign(n); }
  return 0;
}
export function versionMatches(actual, range) {
  if (!actual) return null;
  if (actual === range || range === '*') return true;
  if (range.includes('||')) { const values = range.split('||').map(s => versionMatches(actual, s.trim())); return values.includes(true) ? true : values.includes(null) ? null : false; }
  if (/^[~^]/.test(range)) {
    const base = range.slice(1), parts = base.split('.').map(Number);
    if (compare(actual, base) === null) return null;
    let upper;
    if (range[0] === '~') upper = parts[0] + '.' + ((parts[1] || 0) + 1) + '.0';
    else if (parts[0]) upper = (parts[0] + 1) + '.0.0';
    else if (parts[1]) upper = '0.' + (parts[1] + 1) + '.0';
    else upper = '0.0.' + ((parts[2] || 0) + 1);
    return compare(actual, base) >= 0 && compare(actual, upper) < 0;
  }
  const values = range.trim().split(/\s+/).map(clause => {
    const match = clause.match(/^(>=|<=|>|<|=)?v?(\d+(?:\.\d+)*)$/); if (!match) return null;
    const n = compare(actual, match[2]); if (n === null) return null;
    return ({ '>=': n >= 0, '<=': n <= 0, '>': n > 0, '<': n < 0, '=': n === 0 })[match[1] || '='];
  });
  return values.includes(false) ? false : values.includes(null) ? null : true;
}
export function applicability(item, environment = {}) {
  let uncertain = false;
  for (const [key, expected] of Object.entries(item.appliesTo || {})) {
    const actual = environment[key], matches = actual === undefined ? null : key === 'version' ? versionMatches(actual, expected) : actual === expected;
    if (matches === false) return 'excluded';
    if (matches === null) uncertain = true;
  }
  const exclusions = Object.entries(item.excludeWhen || {});
  if (exclusions.length) {
    const results = exclusions.map(([key, expected]) => environment[key] === undefined ? null : key === 'version' ? versionMatches(environment[key], expected) : environment[key] === expected);
    if (results.every(x => x === true)) return 'excluded';
    if (!results.includes(false) && results.includes(null)) uncertain = true;
  }
  if (item.notWhen) uncertain = true;
  return uncertain ? 'uncertain' : 'matched';
}

export class RetrievalService {
  constructor(w) {
    this.w = w;
    w.db.exec("CREATE TABLE IF NOT EXISTS retrieval_vectors(id TEXT PRIMARY KEY,model TEXT NOT NULL,source_hash TEXT NOT NULL,dimensions INTEGER NOT NULL,vector TEXT NOT NULL);");
    w.db.function('wb_eligible', (meta, env) => {
      const item = JSON.parse(meta);
      return (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()) && applicability(item, JSON.parse(env)) !== 'excluded' ? 1 : 0;
    });
    try { w.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(knowledge_id UNINDEXED,title,body,tokenize='trigram')"); this.fts = true; } catch { this.fts = false; }
    if (this.fts && !w.get('meta', 'retrieval-3')) {
      w.transaction(() => {
        w.db.exec('DELETE FROM knowledge_fts');
        for (const row of w.db.prepare('SELECT id,title,search FROM knowledge_index').all()) w.db.prepare('INSERT INTO knowledge_fts VALUES(?,?,?)').run(row.id, row.title, row.search);
        w.save('meta', { id: 'retrieval-3', version: 3 });
      });
    }
  }
  indexGeneration() { const item = this.w.get('meta', 'knowledge-generation') || { id: 'knowledge-generation', value: 0 }; this.w.save('meta', { ...item, value: item.value + 1 }); }
  index(item) {
    if (this.fts) { this.w.db.prepare('DELETE FROM knowledge_fts WHERE knowledge_id=?').run(item.id); this.w.db.prepare('INSERT INTO knowledge_fts VALUES(?,?,?)').run(item.id, item.title, item.content + '\n' + item.appliesWhen); }
    this.w.db.prepare('DELETE FROM retrieval_vectors WHERE id=? AND source_hash!=?').run(item.id, hash(item.content));
    this.indexGeneration();
  }
  saveVector(input){return this.w.transaction(()=>this.saveVectorLocked(input));}
  saveVectorLocked(input) {
    const item = this.w.get('memory', input.id); if (!item) fail('知識不存在');
    if (item.revision !== input.expectedRevision) fail('知識版本已變更', 'CONFLICT');
    text(input.model, 'embedding 模型', 200);
    if (!Array.isArray(input.vector) || input.vector.length < 2 || input.vector.length > 4096 || input.vector.some(v => !Number.isFinite(v))) fail('向量需為 2–4096 維有限數值');
    const length = Math.hypot(...input.vector); if (!length) fail('不接受零向量');
    const vector = input.vector.map(v => v / length);
    this.w.db.prepare('INSERT INTO retrieval_vectors VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,source_hash=excluded.source_hash,dimensions=excluded.dimensions,vector=excluded.vector').run(item.id, input.model, hash(item.content), vector.length, JSON.stringify(vector));
    this.indexGeneration();
    return { id: item.id, model: input.model, dimensions: vector.length, provider: 'host_supplied', sourceRevision: item.revision };
  }
  search(input = {}) {
    const task = input.taskId ? this.w.get('task', input.taskId) : null;
    if (input.taskId && !task) fail('任務不存在');
    if (!(input.query || task?.goal)?.trim()) fail('請提供需求關鍵字或任務 ID', 'QUERY_REQUIRED');
    const query = text(input.query || task?.goal, '需求關鍵字', 2000), selectedScope = scope(this.w, input.scope || task?.scope || 'personal');
    if (task && task.scope !== selectedScope) fail('任務與範圍不一致', 'OUT_OF_SCOPE');
    const terms = queryTerms(query); if (!terms.length) fail('請提供可檢索的關鍵字', 'QUERY_REQUIRED');
    const environment = { ...task?.environment, ...input.environment }, env = JSON.stringify(environment);
    const filters = ["(k.scope=? OR k.scope='personal')", "k.lifecycle='active'", input.includeCandidates ? "k.review!='rejected'" : "k.review='validated'", 'wb_eligible(k.meta,?)=1'], base = [selectedScope, env];
    if (input.domain) { filters.push("EXISTS(SELECT 1 FROM json_each(k.meta,'$.domains') WHERE value=?)"); base.push(input.domain); }
    const where = filters.join(' AND '), candidates = new Map(), rankings = [];
    const scores = terms.map(() => "(CASE WHEN lower(k.title) LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END + CASE WHEN lower(k.search) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)").join('+');
    const pattern = term => '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
    const patterns = terms.flatMap(t => [pattern(t), pattern(t)]);
    const sql = 'SELECT k.id,k.meta,(' + scores + ') score FROM knowledge_index k WHERE ' + where + ' AND (' + terms.map(() => "lower(k.search) LIKE ? ESCAPE '\\'").join(' OR ') + ') ORDER BY score DESC,k.id LIMIT 120';
    const lexical = this.w.db.prepare(sql).all(...patterns, ...base, ...terms.map(pattern));
    rankings.push(lexical); for (const row of lexical) candidates.set(row.id, row);
    const long = terms.filter(t => [...t].length >= 3);
    if (this.fts && long.length) {
      const phrase = long.map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
      const ranked = this.w.db.prepare('SELECT k.id,k.meta,bm25(knowledge_fts) score FROM knowledge_fts JOIN knowledge_index k ON k.id=knowledge_fts.knowledge_id WHERE knowledge_fts MATCH ? AND ' + where + ' ORDER BY score,k.id LIMIT 100').all(phrase, ...base);
      rankings.push(ranked); for (const row of ranked) candidates.set(row.id, row);
    }
    if (input.queryVector) {
      if (!input.vectorModel || !Array.isArray(input.queryVector) || input.queryVector.length > 4096 || input.queryVector.some(v => !Number.isFinite(v))) fail('語意查詢需要相容模型及有限向量');
      const norm = Math.hypot(...input.queryVector); if (!norm) fail('不接受零查詢向量');
      const ranked = this.w.db.prepare('SELECT k.id,k.meta,v.vector FROM retrieval_vectors v JOIN knowledge_index k ON k.id=v.id WHERE v.model=? AND v.dimensions=? AND ' + where).all(input.vectorModel, input.queryVector.length, ...base).map(r => ({ ...r, score: JSON.parse(r.vector).reduce((sum, v, i) => sum + v * input.queryVector[i] / norm, 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 100);
      rankings.push(ranked); for (const row of ranked) candidates.set(row.id, row);
    }
    const fused = new Map();
    for (const ranking of rankings) ranking.forEach((row, i) => fused.set(row.id, (fused.get(row.id) || 0) + 1 / (60 + i + 1)));
    const ordered = [...candidates.values()].sort((a, b) => fused.get(b.id) - fused.get(a.id) || a.id.localeCompare(b.id));
    const eligible = [], uncertain = [];
    for (const row of ordered) {
      const m = JSON.parse(row.meta), applied = applicability(m, environment);
      const item = { id: m.id, revision: m.revision, title: m.title.slice(0, 100), type: m.type, scope: m.scope, reviewState: m.reviewState, lifecycle: m.lifecycle, summary: m.summary?.slice(0, 180), appliesWhen: m.appliesWhen, notWhen: m.notWhen, appliesTo: m.appliesTo, source: m.source.slice(0, 200), sourceRefs: m.sourceRefs, score: Math.round(fused.get(m.id) * 1e6) / 1e6, selectedBecause: '通過專案、生命週期及環境條件，依字詞／全文及選用向量融合排名', applicability: applied, detailRef: { id: m.id, revision: m.revision } };
      if (applied === 'uncertain' || m.reviewState !== 'validated') uncertain.push(item); else eligible.push(item);
    }
    const cap = Math.min(12288, Math.max(1024, input.maxBytes || 3000)), limit = Math.min(12, Math.max(1, input.limit || 6)), items = [];
    const pending = uncertain.slice(0, 2).map(m => ({ id: m.id, revision: m.revision, title: m.title, applicability: 'uncertain', reason: '適用條件、例外或證據仍需詳讀核對' }));
    for (const item of eligible) { if (items.length >= limit) break; if (Buffer.byteLength(JSON.stringify({ items: [...items, item], uncertain: pending })) < cap - 1000) items.push(item); }
    const generation = this.w.get('meta', 'knowledge-generation')?.value || 0;
    const result = { items, uncertain: pending, uncertainCount: uncertain.length, omittedCount: eligible.length - items.length, truncated: eligible.length > items.length || uncertain.length > pending.length, candidatePoolTruncated: rankings.some(x => x.length >= 100), omittedCountIsLowerBound: rankings.some(x => x.length >= 100), query: query.slice(0, 160), scope: selectedScope, indexVersion: generation, retrieval: input.queryVector ? 'lexical+fts+host-vector-rrf' : 'lexical+fts-rrf', estimatedTokens: estimateTokens(items), scoresAreProbabilities: false };
    if (input._internal) return result;
    return this.w.knowledge.charge(result, input.runId || this.w.budget.resolve({ ...input, scope: selectedScope }), 'search:' + hash({ query, selectedScope, environment, domain: input.domain, includeCandidates: input.includeCandidates, generation, vector: input.queryVector }));
  }
}
