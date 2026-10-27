import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Workbench } from '../src/workbench.mjs';

// Isolated component experiments, not AI model A/B evaluations.
const parent=path.resolve('.test-data');fs.mkdirSync(parent,{recursive:true});
const base=fs.mkdtempSync(path.join(parent,'paired-100-')),project=path.join(base,'project');fs.mkdirSync(project);
const w=new Workbench(path.join(base,'data')),scope=w.addRoot({path:project}).id,results=[];
const check=(domain,id,fn)=>{try{const evidence=fn();results.push({domain,id,withPlugin:evidence?'pass':'fail',withoutPlugin:'not_measured',evidence});}catch(e){results.push({domain,id,withPlugin:'fail',withoutPlugin:'not_measured',error:e.message});}};
try {
  for(let i=0;i<25;i++)check('需求與問題處理','T'+(i+1),()=>{
    const request='修復案例 '+i+'，保留原始資料。',constraint='限制 '+i,criterion='驗收 '+i;
    const {task,originalRequest}=w.contextService.compile({request,title:'任務 '+i,goal:'排查 '+i,scope,constraints:[constraint],criteria:[criterion],unknowns:['未知 '+i]});
    const r=w.contextService.explain(task.id);
    return originalRequest===request&&r.optimizedTask.constraints.includes(constraint)&&r.optimizedTask.acceptance.some(c=>c.text===criterion)&&r.optimizedTask.unknowns.includes('未知 '+i)?'原文、限制、驗收及未知可回讀':null;
  });
  for(let i=0;i<25;i++)check('知識與檢索','K'+(i+1),()=>{
    const term='lookup'+String(i).padStart(3,'0');
    const item=w.saveMemory({title:term,content:'方法 '+term,type:'method',scope,source:'user:fixture',appliesWhen:term,reviewState:'validated',evidence:'fixture'});
    const run=w.budget.begin({scope,maxTokens:6000});
    const r=w.knowledge.search({query:term,scope,runId:run.runId,maxBytes:12000});
    if (!r.items.some(x=>x.id===item.id)) throw Error(JSON.stringify({keys:Object.keys(r),titles:r.items.map(x=>x.title),alreadySent:r.alreadySent,uncertain:r.uncertain,omitted:r.omittedCount})); return '依查詢找回指定知識';
  });
  const png=new PNG({width:40,height:40});png.data.fill(255);
  const image=w.visual.import({base64:PNG.sync.write(png).toString('base64'),scope,name:'fixture.png'});
  for(let i=0;i<25;i++)check('視覺解構','V'+(i+1),()=>{
    const x=(i%5)/10,y=Math.floor(i/5)/10;
    const item=w.visual.save({kind:'observation',scope,title:'畫面 '+i,assetIds:[image.id],observations:['觀察 '+i],hypotheses:['假設 '+i],regions:[{title:'區域',rect:{x,y,width:.1,height:.1}}]});
    const r=w.visual.readRecord({kind:'observation',id:item.id});
    return r.observations[0]==='觀察 '+i&&r.hypotheses[0]==='假設 '+i&&r.regions[0].rect.x===x?'觀察、推測及區域可分別回讀':null;
  });
  for(let i=0;i<25;i++)check('來源與證據','S'+(i+1),()=>{
    const section='# 重複 '+i+'\n同一段來源內容。\n',content=section+section;
    const item=w.sources.save({title:'來源 '+i,uri:'user:fixture',scope,content});
    const rows=w.db.prepare('SELECT body,locator FROM source_chunks WHERE source_id=? ORDER BY rowid').all(item.id);
    return rows.length===2&&rows.every(r=>{const m=/^offset:(\d+)\+(\d+)$/.exec(r.locator);return m&&content.slice(Number(m[1])+Number(m[2]),Number(m[1])+Number(m[2])+r.body.length)===r.body;})&&rows[0].locator!==rows[1].locator?'重複段落各自定位正確':null;
  });
  const output={date:new Date().toISOString(),kind:'synthetic-component-checks',modelCalls:0,baseline:'not_measured',warning:'No-plugin AI or manual workflows not run. These are correlated variations, not 100 independent real tasks.',results};
  fs.writeFileSync('docs/verification/raw/cross-domain-100.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({total:results.length,passed:results.filter(x=>x.withPlugin==='pass').length,failed:results.filter(x=>x.withPlugin==='fail').length,withoutPlugin:'not_measured'}));
  if(results.some(x=>x.withPlugin==='fail'))process.exitCode=1;
} finally {w.close();if(!base.startsWith(parent+path.sep))throw Error('unsafe cleanup');fs.rmSync(base,{recursive:true,force:true});}
