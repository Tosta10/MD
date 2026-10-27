// Standalone control: Node built-ins only; no plugin modules, server, MCP or skills.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const parent=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(parent,'workbench-control-'));
const results=[];
const record=(domain,id,fn)=>{try{const value=fn();results.push({domain,id,passed:!!value});}catch(e){results.push({domain,id,passed:false,error:e.message});}};
const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
try {
 for(let i=0;i<25;i++)record('需求與問題處理','T'+(i+1),()=>{
  const request='修復案例 '+i+'，保留原始資料。',constraint='限制 '+i,criterion='驗收 '+i;
  save('task-'+i+'.json',{request,constraints:[constraint],criteria:[criterion],unknowns:['未知 '+i]});
  const r=read('task-'+i+'.json');return r.request===request&&r.constraints.includes(constraint)&&r.criteria.includes(criterion)&&r.unknowns.includes('未知 '+i);
 });
 const knowledge=[];
 for(let i=0;i<25;i++)record('知識與檢索','K'+(i+1),()=>{
  const term='lookup'+String(i).padStart(3,'0');knowledge.push({title:term,content:'方法 '+term});save('knowledge.json',knowledge);
  return read('knowledge.json').filter(x=>(x.title+' '+x.content).includes(term)).some(x=>x.title===term);
 });
 for(let i=0;i<25;i++)record('視覺解構','V'+(i+1),()=>{
  const x=(i%5)/10,y=Math.floor(i/5)/10;
  save('visual-'+i+'.json',{observations:['觀察 '+i],hypotheses:['假設 '+i],regions:[{title:'區域',rect:{x,y,width:.1,height:.1}}]});
  const r=read('visual-'+i+'.json');return r.observations[0]==='觀察 '+i&&r.hypotheses[0]==='假設 '+i&&r.regions[0].rect.x===x;
 });
 for(let i=0;i<25;i++)record('來源與證據','S'+(i+1),()=>{
  const section='# 重複 '+i+'\n同一段來源內容。\n',content=section+section;
  const offsets=[];let from=0;for(let n=0;n<2;n++){const pos=content.indexOf(section,from);offsets.push(pos);from=pos+section.length;}
  save('source-'+i+'.json',{content,offsets});const r=read('source-'+i+'.json');
  return r.offsets.length===2&&r.offsets[0]!==r.offsets[1]&&r.offsets.every(offset=>r.content.slice(offset,offset+section.length)===section);
 });
 const output={date:new Date().toISOString(),method:'Node built-ins, isolated temporary directory, no plugin imports or services',modelCalls:0,results};
 fs.writeFileSync('docs/verification/raw/no-plugin-control-100.json',JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({total:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length}));
 if(results.some(x=>!x.passed))process.exitCode=1;
} finally {if(!dir.startsWith(parent+path.sep))throw Error('unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
