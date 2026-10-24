import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Workbench } from './core.mjs';
import { definitions, dispatch } from './tools.mjs';

export const defaultDataDir = () => process.env.CODEX_WORKBENCH_HOME || path.join(os.homedir(), '.codex-md-workbenches');
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

export async function startUi(workbench, { port = 0, role = 'both' } = {}) {
  const token = randomBytes(32).toString('hex');
  const allowedTools = new Set(definitions(role).map(t => t.name));
  const sameToken = value => typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  let baseUrl = '';
  const send = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    try {
      if (req.headers.host !== new URL(baseUrl).host || (req.headers.origin && req.headers.origin !== baseUrl)) return send(res, 403, { error: '來源不符' });
      const url = new URL(req.url, baseUrl);
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { app: 'codex-workbenches', role, version: workbench.summary().version });
      if (url.pathname.startsWith('/api/')) {
        if (!sameToken(req.headers['x-workbench-token'])) return send(res, 403, { error: '本機工作階段無效，請重新開啟首頁' });
        if (req.method === 'GET' && url.pathname === '/api/state') {
          const state = { role, overview: workbench.summary(), roots: workbench.roots(), documents: workbench.documents({ limit: 300 }), plans: workbench.list('plan').map(p => workbench.planSummary(p)) };
          if (role !== 'md') Object.assign(state, { tasks: workbench.list('task'), memories: workbench.list('memory'), assets: workbench.list('asset').map(({file,...a}) => a), comparisons: workbench.list('comparison') });
          return send(res, 200, state);
        }
        if (req.method === 'GET' && url.pathname.startsWith('/api/asset/') && role !== 'md') { const asset = workbench.asset(decodeURIComponent(url.pathname.slice('/api/asset/'.length))); res.writeHead(200, { 'content-type': asset.mime, 'cache-control': 'no-store' }); fs.createReadStream(asset.file).pipe(res); return; }
        if (req.method !== 'POST') return send(res, 405, { error: '不支援的操作' });
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: '需要 JSON' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) return send(res, 413, { error: '內容過大' }); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (url.pathname === '/api/document' && role !== 'insight') return send(res, 200, { result: workbench.document(input.documentId) });
        if (url.pathname === '/api/call') {
          if (!allowedTools.has(input.name)) return send(res, 404, { error: '工具不在此插件範圍內' });
          return send(res, 200, { result: await dispatch(workbench, input.name, input.arguments || {}, async () => baseUrl) });
        }
        if (url.pathname === '/api/remove-scope') return send(res, 200, { result: workbench.removeRoot(input.id) });
        if (url.pathname === '/api/asset' && role !== 'md') { if (typeof input.base64 !== 'string') throw new Error('需要圖片資料'); const {file,...asset} = workbench.addAsset(Buffer.from(input.base64, 'base64'), input.name); return send(res, 200, { result: asset }); }
        if (url.pathname === '/api/delete-memory' && role !== 'md') return send(res, 200, { result: workbench.deleteMemory(input.id) });
        return send(res, 404, { error: '找不到操作' });
      }
      if (req.method !== 'GET') return send(res, 405, { error: '不支援的操作' });
      const assets = { '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
      const asset = assets[url.pathname]; if (!asset) return send(res, 404, { error: '找不到頁面' });
      let content = fs.readFileSync(path.join(publicDir, asset[0]));
      if (url.pathname === '/') content = Buffer.from(content.toString().replace('__WORKBENCH_TOKEN__', token));
      res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store' }); res.end(content);
    } catch (error) { send(res, ['CONFLICT','INBOUND_LINK','BROKEN_LINK','BUSY'].includes(error.code) ? 409 : 400, { error: error.message, code: error.code || 'INVALID_REQUEST' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { url: baseUrl, server, close: () => new Promise(resolve => server.close(resolve)) };
}

if (typeof __WORKBENCH_SERVER_ENTRY__ !== 'undefined' ? __WORKBENCH_SERVER_ENTRY__ : (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), get = name => args.includes(name) ? args[args.indexOf(name)+1] : undefined;
  const workbench = new Workbench(get('--data-dir') || defaultDataDir());
  const role = get('--role') || 'both'; if (!['both','md','insight'].includes(role)) throw new Error('Unknown role');
  const ui = await startUi(workbench, { port: Number(get('--port') || 39471), role });
  console.log(JSON.stringify({ url: ui.url, dataDir: workbench.dataDir, role }));
  const stop = async () => { await ui.close(); workbench.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
