import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function fail(message, code = 'INVALID_REQUEST') { throw Object.assign(new Error(message), { code }); }
export function text(value, name, max = 8000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name}需填寫，最多 ${max} 字`);
  return value.trim();
}
export function scope(w, value = 'personal') { if (value !== 'personal') w.root(value); return value; }
export function finite(value, min, max, label) { if (!Number.isFinite(value) || value < min || value > max) fail(`${label}須介於 ${min} 與 ${max}`); return value; }
export function strings(value = [], label = '項目', max = 100) { if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || v.length > 4000)) fail(`${label}格式不正確`); return value; }
export function revision(w, kind, input) {
  const old = input.id ? w.get(kind, input.id) : null;
  if (input.id && !old) fail('紀錄不存在', 'NOT_FOUND');
  if (old && input.expectedRevision !== old.revision) fail('版本已變更，請重新讀取', 'CONFLICT');
  return old;
}
export function saveVersion(w, kind, old, fields) {
  const item = { ...fields, id: old?.id || uid(), revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || now(), updatedAt: now(), schemaVersion: 3 };
  w.save(kind, item); w.save(`${kind}Revision`, { ...item, id: `${item.id}:${item.revision}`, recordId: item.id });
  return item;
}
export function page(w, kind, { scope: requested = '', query = '', offset = 0, limit = 30, lifecycle = '' } = {}, project = item => item) {
  const where = ['kind=?'], params = [kind];
  if (requested) { scope(w, requested); where.push("json_extract(data,'$.scope')=?"); params.push(requested); }
  if (query) { where.push("(json_extract(data,'$.title') LIKE ? ESCAPE '\\' OR id=?)"); params.push(`%${String(query).replace(/[\\%_]/g, '\\$&')}%`, query); }
  if (lifecycle) { where.push("json_extract(data,'$.lifecycle')=?"); params.push(lifecycle); }
  const total = w.db.prepare(`SELECT count(*) n FROM records WHERE ${where.join(' AND ')}`).get(...params).n;
  const size = Math.min(100, Math.max(1, Number(limit) || 30)), start = Math.max(0, Number(offset) || 0);
  const rows = w.db.prepare(`SELECT data FROM records WHERE ${where.join(' AND ')} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...params, size, start);
  return { items: rows.map(r => project(JSON.parse(r.data))), total, offset: start, limit: size, hasMore: start + rows.length < total };
}
export function estimateTokens(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const cjk = (s.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return Math.ceil(cjk * 1.5 + (s.length - cjk) / 3);
}
