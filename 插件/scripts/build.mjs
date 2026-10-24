import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isBuiltin } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const plugins = [ ['md-manager','MD 管理台','md','#245e4e'], ['insight-workbench','理解工作台','insight','#596183'] ];
const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const json = (file, data) => { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n'); };
const dependencyRoots = new Set();
async function bundle(outdir) {
  fs.mkdirSync(outdir,{recursive:true});
  for (const entry of ['server','mcp']) {
    const result = await build({ entryPoints:[path.join(root,`src/${entry}.mjs`)], outfile:path.join(outdir,`${entry}.mjs`), bundle:true, platform:'node', target:'node24', format:'esm', packages:'bundle', define:{__WORKBENCH_SERVER_ENTRY__:entry==='server'?'true':'false'}, banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}, legalComments:'eof', sourcemap:false, metafile:true });
    for (const output of Object.values(result.metafile.outputs)) for (const dependency of output.imports) if (dependency.external && !isBuiltin(dependency.path)) throw new Error(`Unbundled dependency: ${dependency.path}`);
    for (const input of Object.keys(result.metafile.inputs)) {
      if (!input.includes('node_modules')) continue;
      let dir = path.dirname(path.resolve(input));
      while (dir !== path.dirname(dir)) { const file=path.join(dir,'package.json'); if(fs.existsSync(file)){const pkg=JSON.parse(fs.readFileSync(file,'utf8'));if(pkg.name){dependencyRoots.add(dir);break;}}dir=path.dirname(dir); }
    }
  }
}
await bundle(path.join(root,'dist'));
const notices=[];
for(const dir of [...dependencyRoots].sort()){
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const licenses=fs.readdirSync(dir).filter(file=>/^(license|licence|copying|notice)(\.|$|-)/i.test(file)&&fs.statSync(path.join(dir,file)).isFile());
  notices.push(`${pkg.name}@${pkg.version}\nLicense: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license||'See package notices')}\n${licenses.map(file=>fs.readFileSync(path.join(dir,file),'utf8')).join('\n')}\n`);
}
fs.writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),notices.join('\n--------------------\n'));
for(const [name,displayName,role,color] of plugins){
  const dir=path.join(root,name);
  if(!fs.existsSync(path.join(dir,'skills',name,'SKILL.md')))throw new Error(`Missing skill: ${name}`);
  fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
  fs.cpSync(path.join(root,'public'),path.join(dir,'public'),{recursive:true});
  fs.cpSync(path.join(root,'dist'),path.join(dir,'runtime'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts','Start-Mcp.ps1'),path.join(dir,'scripts','Start-Mcp.ps1'));
  fs.copyFileSync(path.join(root,'scripts','Open-Workbench.ps1'),path.join(dir,'scripts','Open-Workbench.ps1'));
  fs.copyFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),path.join(dir,'THIRD-PARTY-NOTICES.txt'));
  json(path.join(dir,'workbench.json'),{role,name,displayName,version,preferredPort:role==='md'?39472:39473});
  const description=role==='md'?'盤點與分類 Markdown、檢查指令、標註已完成與待刪除文件，預覽並還原變更。':'保存需求、限制、驗證證據及有情境的經驗，協助 Codex 理解與改善工作。';
  const iface={displayName,shortDescription:description,longDescription:description,developerName:'Local Workbenches',category:'Productivity',capabilities:['Read','Write'],brandColor:color,defaultPrompt:role==='md'?['盤點我指定的資料夾，依五項原則提出整理建議。','將已完成文件標為待刪除並保留依據。']:['整理本次需求的目的、限制與完成條件。','找出這個專案可以使用的已確認經驗。']};
  json(path.join(dir,'plugin.json'),{$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name,version,description,extensions:{'com.openai':{requires_local_executor:true,interface:iface}}});
  const transport={command:'powershell.exe',args:['-NoProfile','-ExecutionPolicy','Bypass','-File','${PLUGIN_ROOT}/scripts/Start-Mcp.ps1'],cwd:'${PLUGIN_ROOT}'};
  json(path.join(dir,'mcp.json'),{$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{[name]:{type:'stdio',...transport}}});
  json(path.join(dir,'.mcp.json'),{mcpServers:{[name]:transport}});
  json(path.join(dir,'.codex-plugin/plugin.json'),{name,version,description,skills:'./skills/',mcpServers:'./.mcp.json',requires_local_executor:true,interface:iface});
  fs.writeFileSync(path.join(dir,'開啟工作台.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\Open-Workbench.ps1"\r\n');
}
json(path.join(root,'.agents/plugins/marketplace.json'),{name:'local-workbenches',interface:{displayName:'本機工作台'},plugins:plugins.map(([name])=>({name,source:{source:'local',path:`./${name}`},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}))});
// A project-local catalog makes the plugins discoverable without editing personal settings.
const project=path.dirname(root), catalog=path.join(project,'.agents/plugins/marketplace.json');
const existing=fs.existsSync(catalog)?JSON.parse(fs.readFileSync(catalog,'utf8')):{name:'website-workbenches',interface:{displayName:'網站 · 本機工作台'},plugins:[]};
existing.plugins ||= [];
for(const [name] of plugins){const prior=existing.plugins.find(p=>p.name===name);const entry={name,source:{source:'local',path:`./${path.basename(root)}/${name}`},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'};if(prior){if(prior.source?.path!==entry.source.path)throw new Error(`Marketplace entry conflict: ${name}`);Object.assign(prior,entry);}else existing.plugins.push(entry);}
json(catalog,existing);
console.log(JSON.stringify({version,plugins:plugins.map(([name,displayName])=>({name,displayName,path:path.join(root,name)})),catalog},null,2));
