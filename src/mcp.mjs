import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolCatalog,discoveryTool } from './tool-catalog.mjs';
import { validate } from './tools-next.mjs';
import { VERSION } from './core.mjs';
import { Workbench } from './workbench.mjs';
import { definitions, dispatch } from './tools.mjs';
import { defaultDataDir, startUi } from './server.mjs';

const role = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role')+1] : 'md';
if (!['md','insight'].includes(role)) throw new Error('Unknown plugin role');
const workbench = new Workbench(defaultDataDir());
const catalog=new ToolCatalog(role);
let ui;
const uiProvider = async () => { ui ||= await startUi(workbench, { role }); return ui.url; };
const server = new Server({ name: role === 'md' ? 'md-manager' : 'insight-workbench', version: VERSION }, { capabilities: { tools: {listChanged:true} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools:catalog.list() }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const { name, arguments: input = {} } = request.params;
    if (!catalog.has(name)) throw new Error('工具不在此插件範圍內');
    if(name==='get_workbench_capabilities'){
      validate(discoveryTool.inputSchema,input);const result=catalog.activate(input.groups||[]);
      if(result.changed)await server.sendToolListChanged();
      return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    }
    validate(catalog.list().find(t=>t.name===name).inputSchema,input);
    if (name === 'read_visual_reference') {
      const image=await workbench.visual.read(input);
      return {content:[{type:'text',text:JSON.stringify(image.metadata)},...(image.bytes?[{type:'image',mimeType:image.mime,data:image.bytes.toString('base64')}]:[])]};
    }
    const result = await dispatch(workbench, name, input, uiProvider,{role});
    const structuredContent = result && typeof result === 'object' && !Array.isArray(result) ? result : { result };
    return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message, code: error.code || 'INVALID_REQUEST' }) }] }; }
});
await server.connect(new StdioServerTransport());
process.stdin.on('end', async () => { if (ui) await ui.close(); workbench.close(); process.exit(0); });
