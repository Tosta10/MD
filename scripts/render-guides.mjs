import fs from 'node:fs';
import { renderMarkdown } from '../public/markdown.js';
const root = new URL('../', import.meta.url);
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for (const [file, source, title] of [['guide.html','使用手冊.md','使用手冊與外掛接入'],['test-report.html','docs/verification/完整測試與成效報告.md','完整測試與成效報告']]) {
  const markdown = fs.readFileSync(new URL(source,root),'utf8');
  let count=0;
  const entries=[];
  const body=renderMarkdown(markdown).replace(/<h2>(.*?)<\/h2>/g,(_,label)=>{const id='section-'+(++count);entries.push('<a href="#'+id+'">'+label+'</a>');return '<h2 id="'+id+'">'+label+'</h2>';});
  const html='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'｜本機工作台</title><link rel="stylesheet" href="/guide.css"></head><body><header><a class="brand" href="/">◈ 本機工作台</a><nav><a href="/guide.html">使用手冊</a><a href="/test-report.html">測試與成效</a></nav></header><div class="hero"><p>LOCAL WORKBENCHES · v3.0.5</p><h1>'+escape(title)+'</h1><p>先連接工具，再按任務取用資料；以可查核的證據判斷成果。</p><div class="cards"><a href="/guide.html#section-4">外掛安裝與接入 ↗</a><a href="/guide.html#section-6">適用模型與限制 ↗</a><a href="/test-report.html">查看完整證據 ↗</a></div></div><main><aside aria-label="章節目錄"><strong>快速前往</strong>'+entries.join('')+'</aside>'+body+'</main><footer>本機說明文件 · 不包含使用者資料 · Ctrl+P 可列印／儲存 PDF</footer></body></html>';
  fs.writeFileSync(new URL('public/'+file,root),html);
}
