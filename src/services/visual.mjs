import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { text, strings, finite, revision, saveVersion, page, scope, hash, uid, now, fail } from './shared.mjs';

function dimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 255) { i++; continue; }
      const marker = bytes[i + 1]; i += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      const n = bytes.readUInt16BE(i); if (n < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) return { width: bytes.readUInt16BE(i + 5), height: bytes.readUInt16BE(i + 3) };
      i += n;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii', 12, 16) === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  return { width: null, height: null };
}
function rect(value) {
  if (!value || typeof value !== 'object') fail('區域需 x、y、width、height 的正規化座標');
  for (const key of ['x', 'y', 'width', 'height']) finite(value[key], 0, 1, key);
  if (!value.width || !value.height || value.x + value.width > 1.000001 || value.y + value.height > 1.000001) fail('區域超出圖片');
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}
export class VisualService {
  constructor(w) { this.w = w; this.workers = new Set(); }
  close() { for (const worker of this.workers) worker.terminate(); }
  async worker(data) {
    if (this.workers.size >= 2) fail('圖片處理中，請稍後再試', 'BUSY');
    return new Promise((resolve, reject) => {
      const adjacent=new URL('./image-worker.mjs',import.meta.url),workerUrl=fs.existsSync(adjacent)?adjacent:new URL('../image-worker.mjs',import.meta.url);
      const worker = new Worker(workerUrl, { workerData: data, execArgv:[], resourceLimits: { maxOldGenerationSizeMb: 256 } }); this.workers.add(worker);
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('圖片處理超時')); }, 15000);
      const done = () => { clearTimeout(timer); this.workers.delete(worker); };
      worker.once('message', result => { done(); worker.terminate(); result.error ? reject(new Error(result.error)) : resolve(result); });
      worker.once('error', error => { done(); reject(error); });
      worker.once('exit', code => { if (this.workers.has(worker)) { done(); reject(new Error('圖片工作器提前結束：' + code)); } });
    });
  }
  import(input) {
    const selected = scope(this.w, input.scope || 'personal');
    let bytes;
    if(input.path){
      if(selected==='personal')fail('檔案路徑匯入需指定已加入的專案範圍','OUT_OF_SCOPE');
      const root=this.w.root(selected), real=fs.realpathSync(input.path), rel=path.relative(root.path,real);
      if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep))fail('媒體超出已加入範圍','OUT_OF_SCOPE');
      if(fs.statSync(real).size>8*1024*1024)fail('媒體最多8 MiB');
      bytes=fs.readFileSync(real);
    }else bytes=Buffer.from(text(input.base64, '媒體資料', 12 * 1024 * 1024), 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) fail('媒體最多 8 MiB');
    let item;
    const video = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' ? 'video/mp4' : bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? 'video/webm' : null;
    if (video) {
      const id = uid(), dir = path.join(this.w.dataDir, 'assets'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, id + (video === 'video/mp4' ? '.mp4' : '.webm')); fs.writeFileSync(file, bytes, { flag: 'wx' });
      item = { id, file, mime: video, name: text(input.name || '動態參考', '名稱', 200), size: bytes.length, at: now(), width: null, height: null };
    } else {
      item = this.w.addAsset(bytes, input.name);
      const d = dimensions(bytes, item.mime);
      if (d.width && (!d.height || d.width * d.height > 16000000)) { fs.unlinkSync(item.file); this.w.remove('asset', item.id); fail('圖片最多 1600 萬像素'); }
      Object.assign(item, d);
    }
    Object.assign(item, { scope: selected, source: text(input.source || 'user:import', '來源', 2000), license: text(input.license, '使用權', 1000, true), hash: hash(bytes), viewport: input.viewport || null, revision: 1, lifecycle: 'active', schemaVersion: 3 });
    const duplicate = this.w.db.prepare("SELECT data FROM records WHERE kind='asset' AND json_extract(data,'$.hash')=? LIMIT 1").get(item.hash);
    if (duplicate) { const existing = JSON.parse(duplicate.data); if (fs.existsSync(existing.file)) { fs.unlinkSync(item.file); item.file = existing.file; item.sharedBinary = existing.id; } }
    this.w.save('asset', item); const { file, ...meta } = item; return meta;
  }
  list(input = {}) {
    const assets = page(this.w, 'asset', input, ({ file, ...a }) => a);
    return { ...assets, assets: assets.items, comparisons: page(this.w,'comparison',input,c=>({id:c.id,title:c.title,scope:c.scope,leftAssetId:c.leftAssetId,rightAssetId:c.rightAssetId,preferred:c.preferred,notes:c.notes?.map(v=>v.slice(0,300)).slice(0,4),at:c.at})).items, nextOffset: assets.hasMore ? assets.offset + assets.limit : null };
  }
  save(input) {
    const kind = input.kind;
    if (!['observation', 'recipe', 'timeline', 'visualEvaluation'].includes(kind)) fail('視覺紀錄類型不正確');
    return this.w.transaction(() => {
      const old = revision(this.w, kind, input), selected = scope(this.w, input.scope || old?.scope || 'personal'), assetIds = strings(input.assetIds ?? old?.assetIds, '素材', 20);
      for (const id of assetIds) { const asset = this.w.asset(id); if ((asset.scope || 'personal') !== selected) fail('素材與紀錄範圍不同', 'OUT_OF_SCOPE'); }
      const fields = { title: text(input.title ?? old?.title, '名稱', 200), scope: selected, assetIds, observations: strings(input.observations ?? old?.observations), hypotheses: strings(input.hypotheses ?? old?.hypotheses), limitations: strings(input.limitations ?? old?.limitations), sourceRefs: input.sourceRefs ?? old?.sourceRefs ?? [], environment: input.environment ?? old?.environment ?? {}, lifecycle: input.lifecycle || old?.lifecycle || 'active' };
      if (!['active', 'archived', 'pending_delete', 'trashed'].includes(fields.lifecycle)) fail('保留狀態不正確');
      if (kind === 'observation') {
        fields.regions = input.regions ?? old?.regions ?? [];
        if (!Array.isArray(fields.regions) || fields.regions.length > 100) fail('區域最多100個');
        fields.regions = fields.regions.map(r => ({ id: r.id || uid(), title: text(r.title, '區域名稱', 200), assetId: r.assetId || assetIds[0], rect: rect(r.rect), description: text(r.description, '區域觀察', 4000, true), implementation: text(r.implementation, '實現假設', 4000, true) }));
        if (fields.regions.some(r => !assetIds.includes(r.assetId))) fail('區域素材不在此紀錄內');
      }
      if (kind === 'recipe') {
        fields.stack = text(input.stack ?? old?.stack, '技術棧', 200); fields.technique = text(input.technique ?? old?.technique, '實現方法', 8000);
        fields.parameters = input.parameters ?? old?.parameters ?? []; fields.gotchas = strings(input.gotchas ?? old?.gotchas);
        fields.implementationRef = text(input.implementationRef ?? old?.implementationRef, '實作定位', 2000, true);
        fields.verification = text(input.verification ?? old?.verification, '驗證方式', 4000, true);
      }
      if (kind === 'timeline') {
        fields.contactSheetId=input.contactSheetId??old?.contactSheetId??null;if(fields.contactSheetId&&!assetIds.includes(fields.contactSheetId))fail('影格總覽不在素材清單');
        fields.duration = finite(input.duration ?? old?.duration, 0.01, 60, '時長'); fields.frames = input.frames ?? old?.frames ?? [];
        if (!Array.isArray(fields.frames) || fields.frames.length > 60) fail('最多60個關鍵影格');
        let prior = -1;
        for (const frame of fields.frames) { finite(frame.time, 0, fields.duration, '時間'); if (frame.time < prior) fail('影格需依時間排序'); prior = frame.time; if (!assetIds.includes(frame.assetId)) fail('影格素材不在此紀錄內'); }
        fields.transitions = input.transitions ?? old?.transitions ?? [];
        if (!Array.isArray(fields.transitions) || fields.transitions.length > 100) fail('轉場最多100項');
      }
      if (kind === 'visualEvaluation') {
        fields.implementationRef = text(input.implementationRef ?? old?.implementationRef, '實作定位', 2000);
        fields.environment = input.environment ?? old?.environment ?? {};
        fields.dimensions = input.dimensions ?? old?.dimensions ?? {};
        fields.improvements = strings(input.improvements ?? old?.improvements);
        fields.evidenceRefs = strings(input.evidenceRefs ?? old?.evidenceRefs);
        fields.verification = 'reported';
        if (input.pixelMetrics) fail('像素量測由 compare_visual_pixels 產生，不接受手填冒充量測');
      }
      if (Buffer.byteLength(JSON.stringify(fields)) > 64000) fail('紀錄超過64 KiB');
      return saveVersion(this.w, kind, old, fields);
    });
  }
  records(input) {
    if(!['observation','recipe','timeline','visualEvaluation'].includes(input.kind))fail('紀錄類型不正確');
    return page(this.w,input.kind,input,item=>({id:item.id,revision:item.revision,title:item.title,scope:item.scope,lifecycle:item.lifecycle,assetIds:item.assetIds.slice(0,3),assetCount:item.assetIds.length,summary:item.observations?.[0]?.slice(0,200),stack:item.stack,updatedAt:item.updatedAt}));
  }
  readRecord(input) {
    if(!['observation','recipe','timeline','visualEvaluation'].includes(input.kind))fail('紀錄類型不正確');
    const original=input.revision?this.w.get(input.kind+'Revision',input.id+':'+input.revision):this.w.get(input.kind,input.id);
    if(!original)fail('紀錄不存在');
    const item={...original,id:input.id};
    if(input.field){
      if(!['technique','observations','hypotheses','limitations','regions','frames','transitions','dimensions','parameters','gotchas','improvements','implementationRef','verification','sourceRefs','evidenceRefs'].includes(input.field))fail('詳讀欄位不正確');
      const value=item[input.field]??'',body=typeof value==='string'?value:JSON.stringify(value),offset=Math.max(0,input.offset||0),content=body.slice(offset,offset+1800);
      return {id:item.id,revision:item.revision,scope:item.scope,title:item.title,field:input.field,format:typeof value==='string'?'text':'json_fragment',content,nextOffset:offset+content.length<body.length?offset+content.length:null};
    }
    if(input._internal||Buffer.byteLength(JSON.stringify(item))<3000)return item;
    return {id:item.id,revision:item.revision,title:item.title,scope:item.scope,availableFields:Object.keys(item).filter(key=>!['id','revision','scope','title'].includes(key)),detailRequired:true};
  }

  async read(input) {
    const asset = this.w.asset(input.id);
    if (asset.lifecycle && asset.lifecycle !== 'active') fail('素材已封存或回收');
    if (asset.mime.startsWith('video/')) fail('請從時間軸選取影格；不將完整影片當成圖片傳給 AI');
    if (asset.hash && hash(fs.readFileSync(asset.file)) !== asset.hash) fail('素材內容已變更', 'CONFLICT');
    const maxDimension = Math.min(2048, Math.max(128, input.maxDimension || 1024)), region = input.rect ? rect(input.rect) : null;
    let result;
    if (asset.mime === 'image/webp') {
      if (region) fail('WebP 請先轉為 PNG 後裁切');
      if (!asset.width || !asset.height || Math.max(asset.width, asset.height) > maxDimension) fail('此 WebP 尚未有可控尺寸版本，請在工作台轉為 PNG');
      result = { bytes: fs.readFileSync(asset.file), width: asset.width, height: asset.height, mime: asset.mime };
    } else result = await this.worker({ file: asset.file, mime: asset.mime, rect: region, maxDimension });
    const metadata = { id: asset.id, name: asset.name, hash: asset.hash, width: result.width, height: result.height, region, mime: result.mime, source: asset.source, imageEstimateMethod: 'pixel_budget_heuristic_not_model_tokenizer' };
    const estimate = Math.ceil(result.width * result.height / 750) + 256, runId = input.runId || this.w.budget.resolve({ scope: asset.scope || 'personal' });
    const ledger = this.w.get('retrieval', runId); if (ledger.scope && ledger.scope !== (asset.scope || 'personal')) fail('素材超出此讀取工作範圍', 'OUT_OF_SCOPE');
    const charged = this.w.budget.charge(metadata, runId, 'image:' + hash({ id: asset.id, hash: asset.hash, maxDimension, region }), { images: 1, estimatedTokens: estimate, model: input.model || 'unknown-host-model' });
    return charged.alreadySent ? { metadata: charged } : { metadata: charged, bytes: Buffer.from(result.bytes), mime: result.mime };
  }
  async compare(input) {
    const left = this.w.asset(input.leftAssetId), right = this.w.asset(input.rightAssetId);
    if ((left.scope || 'personal') !== (right.scope || 'personal')) fail('比較素材範圍不同', 'OUT_OF_SCOPE');
    if (input.environmentMatched !== true) fail('像素比較前需確認尺寸、字型、內容與狀態等環境條件');
    const metrics = await this.worker({ file: left.file, mime: left.mime, compare: { file: right.file, mime: right.mime } });
    const record = { id: uid(), scope: left.scope || 'personal', title: input.title || '像素比較', leftAssetId: left.id, rightAssetId: right.id, leftHash: left.hash || hash(fs.readFileSync(left.file)), rightHash: right.hash || hash(fs.readFileSync(right.file)), metrics, provenance: 'local_pixel_measurement', at: now() };
    this.w.save('pixelComparison', record); return record;
  }
}
