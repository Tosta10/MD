import { PNG } from 'pngjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workbench } from '../src/core.mjs';
import { startUi } from '../src/server.mjs';
const testRoot=path.resolve('.test-data');fs.mkdirSync(testRoot,{recursive:true});
const cleanup=dir=>{if(!path.resolve(dir).startsWith(testRoot+path.sep))throw new Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});};

test('HTTP local session checks token and origin, and round-trips Chinese payloads',async t=>{
  const dir=fs.mkdtempSync(path.join(testRoot,'http-')),w=new Workbench(path.join(dir,'data')),ui=await startUi(w);
  t.after(async()=>{await ui.close();w.close();cleanup(dir);});
  const html=await (await fetch(ui.url)).text(),token=html.match(/name="workbench-token" content="([^"]+)"/)[1];
  assert.equal((await fetch(`${ui.url}/api/state`)).status,403);
  assert.equal((await fetch(`${ui.url}/api/state`,{headers:{'x-workbench-token':token,origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(`${ui.url}/health`)).status,200);
  const res=await fetch(`${ui.url}/api/call`,{method:'POST',headers:{'x-workbench-token':token,'content-type':'application/json',origin:ui.url},body:JSON.stringify({name:'create_task_brief',arguments:{title:'理解繁體中文',goal:'保存中文原文',criteria:['實際讀回一致']}})});
  assert.equal(res.status,200);assert.equal((await res.json()).result.title,'理解繁體中文');
});

for(const role of ['md','insight'])test(`standalone ${role} plugin negotiates MCP, lists scoped tools and opens its UI`,{timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(testRoot,`mcp-${role}-`));
  const plugin=role==='md'?'md-manager':'insight-workbench';
  const launch=process.platform==='win32'?{command:'powershell.exe',args:['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve(plugin,'scripts/Start-Mcp.ps1')]}:{command:process.execPath,args:[path.resolve(plugin,'runtime/mcp.mjs'),'--role',role]};
  const transport=new StdioClientTransport({...launch,env:{...process.env,CODEX_NODE_PATH:process.execPath,CODEX_WORKBENCH_HOME:dir},stderr:'pipe'});
  const client=new Client({name:'workbench-integration-test',version:'1.0.0'});
  t.after(async()=>{await client.close();cleanup(dir);});
  await client.connect(transport);const {tools}=await client.listTools();const names=tools.map(x=>x.name);
  assert.ok(names.includes('open_workbench'));assert.equal(names.includes('mark_document'),role==='md');assert.equal(names.includes('save_experience'),role==='insight');
  const overview=await client.callTool({name:'get_overview',arguments:{}});assert.equal(overview.isError,undefined);assert.equal(JSON.parse(overview.content[0].text).documents,0);
  const catalog=await client.callTool({name:'get_workbench_capabilities',arguments:{groups:['visual','research','documents']}});
  assert.equal(catalog.isError,undefined);const expanded=await client.listTools();assert.ok(expanded.tools.length>tools.length);
  const open=await client.callTool({name:'open_workbench',arguments:{}});const url=JSON.parse(open.content[0].text).url;assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal((await (await fetch(url+'/health')).json()).role,role);
  if(role==='insight'){
    assert.ok(names.includes('search_knowledge'));const empty=await client.callTool({name:'find_experiences',arguments:{}});assert.equal(empty.isError,true);assert.equal(JSON.parse(empty.content[0].text).code,'QUERY_REQUIRED');
    const saved=await client.callTool({name:'save_experience',arguments:{title:'MCP知識',content:'來源版本需要核對',type:'method',source:'隔離驗證',appliesWhen:'MCP流程'}});assert.equal(saved.isError,undefined);const memory=JSON.parse(saved.content[0].text);assert.equal(memory.revision,1);
    const read=await client.callTool({name:'read_knowledge',arguments:{id:memory.id,field:'content',runId:'integration'}});assert.equal(JSON.parse(read.content[0].text).content,'來源版本需要核對');
    const png=new PNG({width:4,height:4});png.data.fill(255);
    const imported=await client.callTool({name:'import_visual_asset',arguments:{name:'mcp-image',base64:PNG.sync.write(png).toString('base64')}});
    assert.equal(imported.isError,undefined);const asset=JSON.parse(imported.content[0].text);
    const pixels=await client.callTool({name:'read_visual_reference',arguments:{id:asset.id,maxDimension:128}});
    assert.equal(pixels.isError,undefined);assert.ok(pixels.content.some(block=>block.type==='image'));
    const packs=await client.callTool({name:'list_domain_packs',arguments:{}});assert.deepEqual(JSON.parse(packs.content[0].text).items,[]);
  }else{assert.ok(expanded.tools.some(t=>t.name==='create_move_plan'));const start=await client.callTool({name:'start_index_job',arguments:{}});const job=JSON.parse(start.content[0].text);assert.ok(job.id);}
  const invalid=await client.callTool({name:role==='md'?'save_experience':'scan_markdown',arguments:{}});assert.equal(invalid.isError,true);
});

for(const role of ['md','insight'])test('portable Node '+role+' starts without PowerShell and supports the full tool profile',{timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(testRoot,'portable-')),plugin=role==='md'?'md-manager':'insight-workbench';
  const client=new Client({name:'portable-profile',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(plugin,'runtime/mcp.mjs'),'--role',role],env:{...process.env,CODEX_WORKBENCH_HOME:dir,WORKBENCH_TOOL_PROFILE:'all'},stderr:'pipe'});
  t.after(async()=>{await client.close();cleanup(dir);});await client.connect(transport);
  const tools=await client.listTools();assert.ok(tools.tools.length>30);
  const discovery=await client.callTool({name:'get_workbench_capabilities',arguments:{groups:['all']}});assert.equal(JSON.parse(discovery.content[0].text).changed,false);
  const overview=await client.callTool({name:'get_overview',arguments:{}});assert.equal(JSON.parse(overview.content[0].text).version,'3.0.1');
});
