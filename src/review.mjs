import {sha} from './core.mjs';

function shingles(text){const source=text.length>6000?Array.from({length:8},(_,i)=>text.slice(Math.floor(i*(text.length-750)/7),Math.floor(i*(text.length-750)/7)+750)).join(' '):text;const normalized=source.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').slice(0,6000),set=new Set(normalized.match(/[a-z][a-z0-9_]{2,}/g)||[]);for(let i=0;i<Math.min(normalized.length-2,1500);i++){const token=normalized.slice(i,i+3);if(/[\u3400-\u9fff]/.test(token)&&!token.includes(' '))set.add(token);}return set;}
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;}
export function similarFindings(documents,{pairBudget=4000}={}){
  const buckets=new Map(),pairs=new Set(),findings=[];let comparisons=0;
  for(const doc of documents){if(doc.managed||doc.protectedFile||doc.plain.length<180)continue;const set=shingles(doc.plain);if(set.size<20)continue;const signature=[0,1,2,3].map(seed=>{let minimum=0xffffffff;for(const token of set)minimum=Math.min(minimum,Math.imul(hash(token)^(seed*0x9e3779b9),0x45d9f3b)>>>0);return minimum;});
    for(let band=0;band<signature.length;band++){const bucketKey=`${doc.rootId}:${doc.category}:${band}:${signature[band]}`,peers=buckets.get(bucketKey)||[];for(const peer of peers){if(comparisons>=pairBudget)break;const pair=[doc.id,peer.doc.id].sort().join(':');if(pairs.has(pair)||doc.hash===peer.doc.hash)continue;pairs.add(pair);comparisons++;let intersection=0;for(const token of set)if(peer.set.has(token))intersection++;const score=intersection/(set.size+peer.set.size-intersection);if(score<.82)continue;const id=sha(`similar:${pair}:${[doc.hash,peer.doc.hash].sort().join(':')}`).slice(0,24);findings.push({id,documentId:doc.id,path:doc.path,title:doc.title,rule:'similar',line:1,original:`與 ${peer.doc.path} 的抽樣字詞重疊約 ${Math.round(score*100)}%；需核對用途與版本。`,suggestion:'比較兩份來源的獨有內容、反例與適用條件；這是相似候選，不是語意重複或可刪除的判決。',severity:'review',managed:false,protectedFile:false,relatedSources:[{documentId:peer.doc.id,hash:peer.doc.hash}],lexicalScore:score});}
      if(peers.length<24)peers.push({doc,set});buckets.set(bucketKey,peers);
    }
    if(comparisons>=pairBudget)break;
  }
  return {findings,comparisons,pairBudget,truncated:comparisons>=pairBudget};
}
