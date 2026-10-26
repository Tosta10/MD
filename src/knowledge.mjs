import crypto from 'node:crypto';

const now=()=>new Date().toISOString(),id=()=>crypto.randomUUID();
const fail=(message,code='INVALID_REQUEST')=>{throw Object.assign(new Error(message),{code});};
const text=(value,label,max=8000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label}需填寫，最多 ${max} 字`);return value.trim();};
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const tokens=value=>Math.ceil(Buffer.byteLength(JSON.stringify(value))/2);
const types=['preference','fact','decision','method','failure','gotcha'];
export const METHODS=[
  {id:'blind-spots',title:'盲點掃描',when:'陌生領域或關鍵限制不清',output:'未知項、影響、查證方式',stop:'關鍵未知已解決或明確保留'},
  {id:'prototype',title:'多方案原型',when:'偏好難表達或方案有重大取捨',output:'差異明確的原型與選擇理由',stop:'足以選定方向'},
  {id:'interview',title:'反向訪談',when:'答案會改變架構或交付',output:'必要問題、已知答案與假設',stop:'本次範圍已足夠明確'},
  {id:'references',title:'真實參考',when:'品質或互動標準不明',output:'來源版本、採用與不採用特徵',stop:'標準已可操作'},
  {id:'plan',title:'可視計畫',when:'流程與依賴需要對照',output:'可審查計畫或原型',stop:'足以決策'},
  {id:'decision',title:'決策筆記',when:'重要取捨或偏離原案',output:'原因、替代方案與重訪條件',stop:'已記下有影響的決策'},
  {id:'explain',title:'成果說明',when:'交付或交接',output:'改動、證據、缺口與下一步',stop:'可以判斷是否完成'},
  {id:'quiz',title:'反向測驗',when:'要確認人類理解或方法遷移',output:'案例、結果、分母與環境',stop:'完成本次評估，不無限出題'}
];

export class KnowledgeStore {
  constructor(w){this.w=w;}
  index(item){
    const {content}=item;const meta=Object.fromEntries(['id','revision','title','type','scope','status','reviewState','lifecycle','appliesTo','excludeWhen','expiresAt','updatedAt'].map(k=>[k,item[k]]));Object.assign(meta,{domains:item.domains?.slice(0,8).map(v=>v.slice(0,60)),tags:item.tags?.slice(0,8).map(v=>v.slice(0,60)),source:item.source.slice(0,400),appliesWhen:item.appliesWhen.slice(0,400),notWhen:(item.notWhen||'').slice(0,400),sourceRefs:(item.sourceRefs||[]).slice(0,8)});
    this.w.db.prepare(`INSERT INTO knowledge_index(id,scope,review,lifecycle,title,search,meta) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,review=excluded.review,lifecycle=excluded.lifecycle,title=excluded.title,search=excluded.search,meta=excluded.meta`).run(item.id,item.scope,item.reviewState,item.lifecycle,item.title,`${item.title}\n${item.content}\n${item.appliesWhen}\n${(item.domains||[]).join(' ')}`,JSON.stringify({...meta,summary:content.slice(0,220)}));
    this.w.retrieval?.index(item);
    this.w.db.prepare('DELETE FROM knowledge_sources WHERE knowledge_id=?').run(item.id);for(const ref of item.sourceRefs||[])this.w.db.prepare('INSERT OR REPLACE INTO knowledge_sources VALUES(?,?,?)').run(ref.documentId,item.id,ref.hash);
  }
  save(input,{migration=false}={}){
    return this.w.transaction(()=>{
      const old=input.id?this.w.get('memory',input.id):null;if(input.id&&!old)fail('經驗不存在','NOT_FOUND');
      if(old&&!migration&&input.expectedRevision!==old.revision)fail('經驗版本已改變，請重新讀取','CONFLICT');
      const allowed=['externalSourceRefs','verification','title','content','type','status','scope','source','appliesWhen','notWhen','evidence','expiresAt','taskId','domains','appliesTo','excludeWhen','reviewState','lifecycle','tags','sourceRefs','evidenceRefs','relations'];
      const item={...old,...Object.fromEntries(allowed.filter(k=>input[k]!==undefined).map(k=>[k,input[k]]))};
      item.id=old?.id||id();item.title=text(item.title,'名稱',200);item.content=text(item.content,'內容');item.source=text(item.source,'來源',4000);item.appliesWhen=text(item.appliesWhen,'適用情境',4000);
      item.type ||= 'method';if(!types.includes(item.type))fail('知識類型不正確');item.scope ||= 'personal';if(item.scope!=='personal')this.w.root(item.scope);
      item.reviewState ||= item.status==='confirmed'?'validated':'candidate';item.lifecycle ||= item.status==='disabled'?'archived':'active';
      if(input.status){if(!['candidate','confirmed','disabled'].includes(input.status))fail('舊版狀態不正確');if(input.reviewState===undefined)item.reviewState=input.status==='confirmed'?'validated':'candidate';if(input.status==='disabled')item.lifecycle='archived';}
      const material=old&&['title','content','source','scope','appliesWhen','notWhen','domains','appliesTo','excludeWhen','sourceRefs','externalSourceRefs','relations'].some(k=>JSON.stringify(old[k]??null)!==JSON.stringify(item[k]??null));
      if(material&&old.reviewState==='validated'){item.reviewState='needs_review';item.priorEvidence=old.evidence;item.evidence='';item.evidenceRefs=[];}
      if(!['candidate','validated','needs_review','rejected'].includes(item.reviewState))fail('可靠程度不正確');
      if(!['active','archived','pending_delete','trashed'].includes(item.lifecycle))fail('保留狀態不正確');
      if(item.reviewState==='validated')text(item.evidence,'確認依據',4000);
      item.verification ||= 'reported';
      if(!['reported','observed'].includes(item.verification))fail('獨立驗證需執行器證據；不可由知識表單自行宣稱');
      item.externalSourceRefs ||= [];
      if(!Array.isArray(item.externalSourceRefs)||item.externalSourceRefs.length>20)fail('外部來源最多20筆');
      if(!old||input.externalSourceRefs||item.reviewState==='validated')for(const ref of item.externalSourceRefs){const source=this.w.get('source',ref.id);if(!source||source.revision!==ref.revision||source.contentHash!==ref.hash||source.lifecycle!=='active')fail('外部來源不存在或已變更','CONFLICT');if(source.scope!==item.scope&&source.scope!=='personal')fail('外部來源範圍不同','OUT_OF_SCOPE');}
      for(const key of ['domains','tags']){item[key] ||= [];if(!Array.isArray(item[key])||item[key].length>(key==='domains'?8:30)||item[key].some(v=>typeof v!=='string'||v.length>100))fail(`${key} 格式不正確（領域最多8個、標籤最多30個）`);}
      for(const key of ['appliesTo','excludeWhen']){item[key] ||= {};if(typeof item[key]!=='object'||Array.isArray(item[key])||Object.entries(item[key]).some(([k,v])=>!['platform','version','taskTag'].includes(k)||typeof v!=='string'||v.length>100))fail(`${key} 只接受 platform/version/taskTag 精確條件`);}
      for(const key of ['sourceRefs','evidenceRefs','relations']){item[key] ||= [];if(!Array.isArray(item[key])||item[key].length>50)fail(`${key} 格式不正確`);}
      if(!old||input.sourceRefs)for(const ref of item.sourceRefs){if(!ref.documentId||!ref.hash)fail('文件來源需 documentId/hash');const doc=this.w.document(ref.documentId);if(doc.hash!==ref.hash)fail('來源文件版本不符','CONFLICT');}
      for(const ref of item.evidenceRefs){const ev=this.w.get('evidence',ref.id);if(!ev||ev.revision!==ref.revision)fail('證據版本不存在','CONFLICT');}item.sourceRefs=item.sourceRefs.map(({documentId,hash})=>({documentId,hash}));item.evidenceRefs=item.evidenceRefs.map(({id,revision})=>({id,revision}));
      item.expiresAt ||= null;if(item.expiresAt&&!Number.isFinite(Date.parse(item.expiresAt)))fail('失效日期不正確');if(item.taskId&&!this.w.get('task',item.taskId))fail('任務不存在');
      item.status=item.lifecycle!=='active'?'disabled':item.reviewState==='validated'?'confirmed':'candidate';item.revision=(old?.revision||0)+1;item.schemaVersion=2;item.createdAt=old?.createdAt||now();item.updatedAt=now();
      if(migration){item.reviewState=old?.status==='confirmed'?'needs_review':'candidate';item.migrationOrigin=old?.status||'legacy';item.status='candidate';}
      this.w.save('memory',item);this.w.save('knowledgeRevision',{...item,id:`${item.id}:${item.revision}`,knowledgeId:item.id});this.index(item);return item;
    });
  }
  list({query='',scope='',review='',lifecycle='',cursor='',limit=30}={}){
    const params=[],where=['1=1'];if(scope){if(scope!=='personal')this.w.root(scope);where.push('scope=?');params.push(scope);}
    if(query){where.push('(title LIKE ? ESCAPE \'\\\' OR search LIKE ? ESCAPE \'\\\')');const q=`%${String(query).replace(/[\\%_]/g,'\\$&')}%`;params.push(q,q);}
    for(const [col,value] of [['review',review],['lifecycle',lifecycle]])if(value){where.push(`${col}=?`);params.push(value);}
    const total=this.w.db.prepare(`SELECT count(*) n FROM knowledge_index WHERE ${where.join(' AND ')}`).get(...params).n;
    if(cursor){where.push('id>?');params.push(cursor);}const size=Math.min(50,Math.max(1,Number(limit)||30));
    const rows=this.w.db.prepare(`SELECT id,meta FROM knowledge_index WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`).all(...params,size+1);
    const items=[];for(const row of rows.slice(0,size)){const item=JSON.parse(row.meta);if(items.length&&bytes([...items,item])>14000)break;items.push(item);}return {items,total,nextCursor:rows.length>items.length?rows[items.length-1]?.id:null};
  }
  search(input={}){
    if(this.w.retrieval)return this.w.retrieval.search(input);
    const task=input.taskId?this.w.get('task',input.taskId):null;const query=input.query||task?.goal;if(!query?.trim())fail('請提供需求關鍵字或任務 ID；不允許空查詢讀取全庫','QUERY_REQUIRED');
    const scope=input.scope||task?.scope||'personal';if(scope!=='personal')this.w.root(scope);const terms=query.toLowerCase().split(/[\s，。、；:：]+/).filter(Boolean).slice(0,12);
    const params=[scope],clauses=terms.map(term=>{params.push(`%${term.replace(/[\\%_]/g,'\\$&')}%`);return "search LIKE ? ESCAPE '\\'";});
    let domainClause='';if(input.domain){domainClause=" AND EXISTS(SELECT 1 FROM json_each(knowledge_index.meta,'$.domains') WHERE value=?)";params.push(input.domain);}const rows=this.w.db.prepare(`SELECT id,meta,search FROM knowledge_index WHERE (scope=? OR scope='personal') AND lifecycle='active' AND ${input.includeCandidates?"review!='rejected'":"review='validated'"} AND (${clauses.join(' OR ')}) ${domainClause} ORDER BY title LIMIT 120`).all(...params);
    const context={...(task?.environment||{}),...(input.environment||{})},uncertain=[],eligible=[];
    for(const row of rows){const m=JSON.parse(row.meta);if(m.expiresAt&&Date.parse(m.expiresAt)<=Date.now())continue;if(input.domain&&!m.domains?.includes(input.domain))continue;
      if(Object.entries(m.excludeWhen||{}).some(([k,v])=>context[k]===v))continue;
      const missing=Object.entries(m.appliesTo||{}).filter(([k,v])=>context[k]!==v);if(missing.some(([k])=>context[k]!==undefined))continue;
      const score=terms.reduce((s,t)=>s+(row.search.toLowerCase().includes(t)?1:0)+(m.title.toLowerCase().includes(t)?2:0),0);
      const item={id:m.id,revision:m.revision,title:m.title.slice(0,80),type:m.type,scope:m.scope,domains:m.domains?.slice(0,2).map(v=>v.slice(0,30)),domainCount:m.domains?.length||0,reviewState:m.reviewState,lifecycle:m.lifecycle,summary:m.summary?.slice(0,100),appliesWhen:m.appliesWhen.slice(0,80),notWhen:(m.notWhen||'').slice(0,80),source:m.source.slice(0,80),sourceRefs:m.sourceRefs?.slice(0,2),score,selectedBecause:'符合關鍵字及明確條件；文字條件需詳讀',applicability:missing.length||m.notWhen?'uncertain':'matched'};
      // Free text exclusions cannot be reliably evaluated by a keyword engine.
      if(item.applicability==='uncertain'||m.reviewState!=='validated')uncertain.push(item);else eligible.push(item);
    }
    eligible.sort((a,b)=>b.score-a.score);const limit=Math.min(12,Math.max(1,input.limit||6)),items=[],pending=uncertain.slice(0,2).map(m=>({id:m.id,revision:m.revision,title:m.title,applicability:'uncertain',reason:'版本、排除條件或可靠程度仍需核對'}));
    const cap=Math.min(12*1024,Math.max(1024,input.maxBytes||3000));for(const item of eligible.slice(0,limit)){if(bytes({items:[...items,item],uncertain:pending})>cap-400)break;items.push(item);}
    const result={items,uncertain:pending,uncertainCount:uncertain.length,truncated:eligible.length>items.length,omittedCount:eligible.length-items.length,candidatePoolTruncated:rows.length===120,omittedCountIsLowerBound:rows.length===120,estimatedTokens:tokens(items),query:query.slice(0,160),scope};
    while(bytes(result)>cap-200&&result.uncertain.length)result.uncertain.pop();while(bytes(result)>cap-200&&result.items.length)result.items.pop();result.omittedCount=eligible.length-result.items.length;result.truncated=result.candidatePoolTruncated||result.omittedCount>0||uncertain.length>result.uncertain.length;result.estimatedTokens=tokens(result);
    return this.charge(result,input.runId,`search:${JSON.stringify({query,scope,environment:context,domain:input.domain,includeCandidates:input.includeCandidates})}`);
  }
  charge(result,runId,key){
    if(this.w.budget)return this.w.budget.charge(result,runId||this.w.budget.resolve(),key);
    if(!runId)return {...result,budgetScope:'single_response'};text(runId,'runId',120);
    return this.w.transaction(()=>{const ledger=this.w.get('retrieval',runId)||{id:runId,bytes:0,sent:[]};if(ledger.sent.includes(key))return {alreadySent:true,runId,bytesUsed:ledger.bytes};const n=bytes(result);if(ledger.bytes+n>48*1024)fail('本次讀取已達 48 KiB，請縮小需求或開始明確的新執行','BUDGET_EXHAUSTED');ledger.bytes+=n;ledger.sent.push(key);this.w.save('retrieval',ledger);return {...result,runId,bytesUsed:ledger.bytes,remainingBytes:48*1024-ledger.bytes};});
  }
  read({id:recordId,revision,field='content',offset=0,maxBytes=8192,runId,_internal=false}={}){
    const m=revision?this.w.get('knowledgeRevision',`${recordId}:${revision}`):this.w.get('memory',recordId);if(!m)fail('知識版本不存在','NOT_FOUND');
    const fields=['content','source','appliesWhen','notWhen','evidence'];if(!fields.includes(field))fail('不支援的詳讀欄位');const text=String(m[field]||'');
    const limit=Math.min(8192,Math.max(512,maxBytes)),start=Math.max(0,Number(offset)||0);let content=text.slice(start,start+limit);while(Buffer.byteLength(content)>limit)content=content.slice(0,-1);
    const result={id:recordId,scope:m.scope,revision:m.revision,title:m.title,field,content,availableTextFields:fields.map(name=>({field:name,length:String(m[name]||'').length})),sourcePreview:m.source.slice(0,300),reviewState:m.reviewState,lifecycle:m.lifecycle,sourceRefs:m.sourceRefs?.slice(0,8),evidenceRefs:m.evidenceRefs?.slice(0,8),nextOffset:start+content.length<text.length?start+content.length:null,notWhenPreview:(m.notWhen||'').slice(0,300),appliesTo:m.appliesTo,excludeWhen:m.excludeWhen};
    if(_internal)return result;
    return this.charge(result,runId||this.w.budget?.resolve({scope:m.scope}),`${recordId}:${m.revision}:${field}:${start}`);
  }
  state({id:recordId,expectedRevision,lifecycle,reason,confirm=false}={}){
    text(reason,'維護理由',4000);if(lifecycle==='trashed'&&confirm!==true)fail('移入回收區需確認');
    const old=this.w.get('memory',recordId);if(!old)fail('經驗不存在');const item=this.save({id:recordId,expectedRevision,lifecycle});this.w.save('knowledgeEvent',{id:id(),knowledgeId:recordId,from:old.lifecycle,to:lifecycle,reason,revision:item.revision,at:now()});return item;
  }
  invalidateSource(documentId,hash){for(const row of this.w.db.prepare("SELECT k.id FROM knowledge_sources s JOIN knowledge_index k ON k.id=s.knowledge_id WHERE s.document_id=? AND (? IS NULL OR s.source_hash!=?) AND k.review='validated'").all(documentId,hash??null,hash??null)){const old=this.w.get('memory',row.id),item={...old,revision:old.revision+1,reviewState:'needs_review',status:'candidate',priorEvidence:old.evidence,evidence:'',evidenceRefs:[],updatedAt:now(),reviewReason:'來源版本改變或已移除'};this.w.save('memory',item);this.w.save('knowledgeRevision',{...item,id:`${item.id}:${item.revision}`,knowledgeId:item.id});this.index(item);}}
  propose(input){
    if(!Array.isArray(input.operations)||!input.operations.length||input.operations.length>20)fail('知識方案需 1–20 項操作');
    const seen=new Set(),operations=input.operations.map(op=>{if(!['create','patch','state'].includes(op.type))fail('知識操作不正確');if(op.values&&(op.values.id!==undefined||op.values.expectedRevision!==undefined))fail('values 不可覆寫識別與版本欄位');if(op.type==='create'&&op.id)fail('新增不可指定既有 ID');const before=op.id?this.w.get('memory',op.id):null;if(op.type!=='create'&&(!before||before.revision!==op.expectedRevision))fail('知識版本已改變','CONFLICT');if(op.id&&seen.has(op.id))fail('同批不可重複修改一筆知識');seen.add(op.id);return {...op,before};});
    return this.w.save('knowledgePlan',{id:id(),title:text(input.title,'方案名稱',200),reason:text(input.reason,'方案理由',4000),status:'proposed',operations,at:now()});
  }
  applyChange(changeId,confirm){
    if(confirm!==true)fail('套用需確認');return this.w.transaction(()=>{const plan=this.w.get('knowledgePlan',changeId);if(!plan)fail('方案不存在');if(plan.status==='applied')return {id:changeId,status:'applied',idempotent:true};if(plan.status!=='proposed')fail('方案不可套用');
      for(const op of plan.operations)if(op.before&&this.w.get('memory',op.id)?.revision!==op.expectedRevision)fail('知識版本已改變','CONFLICT');
      for(const op of plan.operations){let item;if(op.type==='state')item=this.state({id:op.id,expectedRevision:op.expectedRevision,lifecycle:op.lifecycle,reason:plan.reason,confirm:true});else item=this.save({...op.values,...(op.before?{id:op.id,expectedRevision:op.expectedRevision}:{})});op.afterId=item.id;op.afterRevision=item.revision;}
      plan.status='applied';plan.appliedAt=now();this.w.save('knowledgePlan',plan);return {id:changeId,status:plan.status};});
  }
  restoreChange(changeId,confirm){if(confirm!==true)fail('還原需確認');return this.w.transaction(()=>{const plan=this.w.get('knowledgePlan',changeId);if(!plan)fail('方案不存在');if(plan.status==='restored')return {id:changeId,status:'restored',idempotent:true};if(plan.status!=='applied')fail('方案未套用');for(const op of plan.operations)if(this.w.get('memory',op.afterId)?.revision!==op.afterRevision)fail('知識後續已有修改','CONFLICT');for(const op of plan.operations){if(op.before)this.save({...op.before,id:op.afterId,expectedRevision:op.afterRevision,reviewState:op.before.reviewState});else this.state({id:op.afterId,expectedRevision:op.afterRevision,lifecycle:'trashed',reason:'還原新增方案',confirm:true});}plan.status='restored';this.w.save('knowledgePlan',plan);return {id:changeId,status:plan.status};});}
  recordEvidence(input){
    const task=input.taskId?this.w.get('task',input.taskId):null;if(input.taskId&&!task)fail('任務不存在');if(task&&input.taskRevision!==task.revision)fail('任務版本已變動','CONFLICT');
    const item={id:id(),revision:1,kind:input.kind||'reported_only',taskId:task?.id||null,taskRevision:task?.revision||null,observed:text(input.observed,'實際觀察',8000),artifactRef:text(input.artifactRef,'證據位置',2000),environment:input.environment||{},outcome:input.outcome||'unverified',at:now(),executor:input.executor||'user_reported'};
    if(!['user_feedback','test_run','visual_review','primary_reference','reported_only'].includes(item.kind)||!['passed','failed','unverified'].includes(item.outcome))fail('證據類型或結果不正確');return this.w.save('evidence',item);
  }
  report(taskId){const task=this.w.get('task',taskId);if(!task)fail('任務不存在');const criteria=task.criteria||[],evidence=this.w.db.prepare("SELECT data FROM records WHERE kind='evidence' AND json_extract(data,'$.taskId')=? AND json_extract(data,'$.taskRevision')=?").all(taskId,task.revision).map(r=>JSON.parse(r.data));return {taskId,taskRevision:task.revision,status:task.status,applicationLevel:evidence.some(e=>e.kind==='test_run'&&e.outcome==='passed')?'reported_applied':'not_measured',evaluation:{representative:{passed:criteria.filter(c=>c.status==='passed').length,total:criteria.length},baseline:'not_measured',heldOut:'not_measured'},evidence:evidence.map(e=>({id:e.id,revision:e.revision,outcome:e.outcome,artifactRef:e.artifactRef,provenance:e.executor})),remainingGaps:criteria.filter(c=>c.status!=='passed').map(c=>c.text),note:'證據依填報來源，尚未自動重跑或獨立驗證外部結果。條件通過不代表模型權重改變；未量測的比較與遷移測試不回報提升百分比。'};}
}
