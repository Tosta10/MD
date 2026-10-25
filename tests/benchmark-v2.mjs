import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {Workbench} from '../src/workbench.mjs';
const count=Math.min(10000,Math.max(100,Number(process.env.WORKBENCH_BENCH_COUNT)||1000)),parent=path.resolve('.test-data');fs.mkdirSync(parent,{recursive:true});const reused=process.env.WORKBENCH_BENCH_REUSE,base=reused?fs.realpathSync(reused):fs.mkdtempSync(path.join(parent,'benchmark-'));if(!base.startsWith(fs.realpathSync(parent)+path.sep))throw new Error('Benchmark path must stay in .test-data');const project=path.join(base,'project');if(!reused)fs.mkdirSync(project);
const elapsed=async fn=>{const start=performance.now();const value=await fn();return {ms:Number((performance.now()-start).toFixed(2)),value};};
const percentile=xs=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*.95))];
let bytes=0;
for(let i=0;i<count;i++){const file=path.join(project,`doc-${String(i).padStart(5,'0')}.md`);if(reused){bytes+=fs.statSync(file).size;continue;}const text=`# 基準文件 ${i}\n\n## 文件索引\n\nrecord_${String(i).padStart(5,'0')}\n\n`+'索引資料 source revision interface 文件內容。 '.repeat(330);bytes+=Buffer.byteLength(text);fs.writeFileSync(file,text);}
const w=new Workbench(path.join(base,`data-${Date.now()}`));w.addRoot({path:project});
try{
  console.log(JSON.stringify({stage:'seeded',count,sourceBytes:bytes}));
  const cold=await elapsed(()=>w.scan());console.log(JSON.stringify({stage:'cold',ms:cold.ms}));
  const warm=await elapsed(()=>w.scan());
  const list=[],search=[],health=[];for(let i=0;i<100;i++){let start=performance.now();w.documents({query:'doc-',limit:50});list.push(performance.now()-start);start=performance.now();w.context({query:`record_${String(i%count).padStart(5,'0')}`});search.push(performance.now()-start);start=performance.now();w.summary();health.push(performance.now()-start);}
  fs.appendFileSync(path.join(project,'doc-00000.md'),'\n單檔新內容');const changed=await elapsed(()=>w.scan());
  const report={date:new Date().toISOString(),node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,memoryGiB:Number((os.totalmem()/1024**3).toFixed(1)),corpus:{files:count,bytes,averageBytes:Math.round(bytes/count),languages:['Traditional Chinese','English identifiers']},cold:{ms:cold.ms,readFiles:cold.value.readFiles,parsedFiles:cold.value.parsedFiles},warm:{ms:warm.ms,readFiles:warm.value.readFiles,parsedFiles:warm.value.parsedFiles},singleChange:{ms:changed.ms,readFiles:changed.value.readFiles,parsedFiles:changed.value.parsedFiles},listP95Ms:Number(percentile(list).toFixed(2)),searchP95Ms:Number(percentile(search).toFixed(2)),summaryP95Ms:Number(percentile(health).toFixed(2)),metadataPayloadBytes:Buffer.byteLength(JSON.stringify(w.documents({limit:50}))),peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024),notes:['Cold/warm local SQLite; 100 repeated list/search/summary queries.','No network, model or UI rendering latency included.','No v0.1 baseline or semantic quality comparison was measured.']};
  fs.mkdirSync('artifacts/v2',{recursive:true});fs.writeFileSync('artifacts/v2/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{w.close();const resolved=fs.realpathSync(base),allowed=fs.realpathSync(parent)+path.sep;if(!resolved.startsWith(allowed))throw new Error('Unsafe benchmark cleanup');fs.rmSync(resolved,{recursive:true,force:true});}
