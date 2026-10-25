import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from './core.mjs';
import { Workbench } from './workbench.mjs';
import { definitions, dispatch } from './tools.mjs';
import { defaultDataDir, startUi } from './server.mjs';

const role = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role')+1] : 'md';
if (!['md','insight'].includes(role)) throw new Error('Unknown plugin role');
const workbench = new Workbench(defaultDataDir());
const tools = definitions(role), names = new Set(tools.map(t => t.name));
let ui;
const uiProvider = async () => { ui ||= await startUi(workbench, { role }); return ui.url; };
const server = new Server({ name: role === 'md' ? 'md-manager' : 'insight-workbench', version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const { name, arguments: input = {} } = request.params;
    if (!names.has(name)) throw new Error('工具不在此插件範圍內');
    if (name === 'read_visual_reference') { const asset = workbench.asset(input.id); return { content: [{ type: 'text', text: JSON.stringify({ id: asset.id, name: asset.name }) }, { type: 'image', mimeType: asset.mime, data: fs.readFileSync(asset.file).toString('base64') }] }; }
    const result = await dispatch(workbench, name, input, uiProvider);
    const structuredContent = result && typeof result === 'object' && !Array.isArray(result) ? result : { result };
    return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message, code: error.code || 'INVALID_REQUEST' }) }] }; }
});
await server.connect(new StdioServerTransport());
process.stdin.on('end', async () => { if (ui) await ui.close(); workbench.close(); process.exit(0); });
