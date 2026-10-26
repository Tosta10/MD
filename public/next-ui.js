export function createNextUI(env) {
  const { api, call, e, toast, openDialog, closeDialog, reload } = env;
  const offsets = {}, editing = new Map(), cache = new Map(), timers = new Map(), draftRevisions = new Map();
  let currentContext, visualKind = 'observation', visualOffset = 0;
  const root = () => env.scope() || 'personal';
  const button = (action, label, attributes = '') => '<button data-action="v3-' + action + '" ' + attributes + '>' + label + '</button>';
  const field = (label, name, value = '', area = false, attributes = '') => '<label>' + label + (area ? '<textarea name="' + name + '" ' + attributes + '>' + e(value) + '</textarea>' : '<input name="' + name + '" value="' + e(value) + '" ' + attributes + '>') + '</label>';
  const panel = (title, body, actions = '') => '<section class="panel"><div class="panel-head"><h2>' + title + '</h2><div class="row">' + actions + '</div></div><div class="body">' + body + '</div></section>';
  const empty = label => '<p class="empty">' + label + '</p>';
  const inspect = data => '<pre class="preview">' + e(JSON.stringify(data, null, 2)) + '</pre>';
  const pager = (page, data) => '<div class="list-footer"><span>' + (data.total || 0) + ' 筆 · 第 ' + (Math.floor((offsets[page] || 0) / 20) + 1) + ' 頁</span><div class="row">' + button('page', '上一頁', 'data-page="' + page + '" data-offset="' + Math.max(0, (offsets[page] || 0) - 20) + '" ' + (!offsets[page] ? 'disabled' : '')) + button('page', '下一頁', 'data-page="' + page + '" data-offset="' + ((offsets[page] || 0) + 20) + '" ' + (!data.hasMore ? 'disabled' : '')) + '</div></div>';
  const nav = [['context', '當下脈絡'], ['sources', '研究資料庫'], ['policies', '自治政策'], ['drafts', '編輯草稿'], ['activity', '操作紀錄'], ['evaluations', '成效評測']];
  function owns(page) { return nav.some(([id]) => id === page); }
  async function load(page) {
    const args = { offset: offsets[page] || 0, limit: 20 };
    if (page === 'sources') return call('research_sources', { action: 'list', ...args, scope: env.scope() || undefined });
    if (page === 'policies') return call('maintenance_policy', { action: 'list', ...args });
    if (page === 'drafts') return call('workspace_drafts', { action: 'list', ...args, scope: env.scope() || undefined });
    if (page === 'activity') return api('/api/activity', args);
    if (page === 'evaluations') return call('evaluate_workbench', { action: 'list', ...args, scope: env.scope() || undefined });
    if (page === 'context') return call('list_task_briefs', { scope: env.scope() || undefined });
  }
  function render(page, data) {
    if (page === 'context') {
      const tasks = data.tasks || [], task = env.task();
      return panel('這次 AI 應該使用的資料', '<p class="muted">先核對任務與適用條件，再產生少量脈絡；新加入的資料不會全部載入。</p><form class="form" data-form="v3-context"><label>任務<select name="taskId" required>' + tasks.map(t => '<option value="' + e(t.id) + '" ' + (task?.id === t.id ? 'selected' : '') + '>' + e(t.title) + ' · 第 ' + t.revision + ' 版</option>').join('') + '</select></label>' + field('這次問題（留空使用任務目的）', 'query') + field('額外文字材料預算', 'maxTokens', '3000', false, 'type="number" min="500" max="8000"') + '<label class="check"><input type="checkbox" name="includeSources">包含相關研究片段</label><button class="primary" ' + (!tasks.length ? 'disabled' : '') + '>建立本次脈絡</button></form>' + (currentContext ? '<div class="context-summary"><h3>本次採用 ' + (currentContext.items?.length || 0) + ' 份知識</h3><p>預估文字材料 ' + (currentContext.estimatedTokens || 0) + ' tokens · ' + (currentContext.status === 'needs_research' ? '仍需補充資料' : '有符合條件的依據') + '</p>' + (currentContext.items || []).map(k => '<article class="entry"><h3>' + e(k.title) + '</h3><p>' + e(k.selectedBecause) + '</p><p class="help">適用：' + e(k.appliesWhen) + ' · 證據：' + e(k.verification) + '</p><details><summary>查看內容與例外</summary><p>' + e(k.content) + '</p><p>' + e(k.notWhen || '未指定額外例外') + '</p></details></article>').join('') + '<details><summary>完整脈絡、未確認候選與用量</summary>' + inspect(currentContext) + '</details>' + button('copy-context', '複製脈絡給 AI') + '</div>' : ''));
    }
    if (page === 'sources') return panel('有來源的研究資料', (data.items || []).map(s => '<article class="entry"><h3>' + e(s.title) + '</h3><p class="mono">' + e(s.uri) + '</p><p class="help">第 ' + s.revision + ' 版 · ' + e(s.lifecycle) + ' · ' + e(s.author || '未指定作者') + '</p><div class="row">' + button('read-source', '閱讀與編輯', 'data-id="' + e(s.id) + '"') + button('source-knowledge', '提取知識候選', 'data-id="' + e(s.id) + '"') + '</div></article>').join('') + pager(page, data), button('source-new', '加入研究資料'));
    if (page === 'policies') return panel('AI 可自行執行的範圍與條件', '<p class="muted">政策只授權列出的動作；版本、來源與還原檢查仍會執行。知識維護不依檔齡自動刪除。</p>' + (data.items || []).map(p => '<article class="entry"><h3>' + e(p.title) + ' · ' + (p.enabled ? '啟用' : '停用') + '</h3><p>範圍：' + p.scopes.map(id => e(env.state().roots.find(r => r.id === id)?.name || '個人範圍')).join('、') + '</p><p>已使用 ' + p.usedOperations + '／' + p.maxOperations + ' 項 · 保留 ' + p.retentionDays + ' 天</p><p class="help">' + e(p.actions.join('、')) + '</p><div class="row">' + button('edit-policy', '編輯政策', 'data-id="' + e(p.id) + '"') + button('maintain', '依政策整理知識', 'data-id="' + e(p.id) + '"') + '</div></article>').join('') + pager(page, data), button('new-policy', '設定授權政策'));
    if (page === 'drafts') return panel('保存在本機資料庫的草稿', '<p class="muted">草稿不等於已儲存原文件。來源版本相符時可恢復；有衝突時保留草稿供比較。</p>' + (data.items || []).map(d => '<article class="entry"><h3>' + e(d.title) + '</h3><p>' + e(d.updatedAt) + '</p><div class="row">' + button('draft-read', '查看／複製草稿', 'data-id="' + e(d.id) + '"') + button('draft-delete', '移除草稿', 'data-id="' + e(d.id) + '" data-revision="' + d.revision + '"') + '</div></article>').join('') + pager(page, data));
    if (page === 'activity') return panel('操作結果與問題紀錄', (data.items || []).map(a => '<article class="entry"><span class="badge">' + e(a.status) + '</span><h3>' + e(a.title) + '</h3><p class="help">' + e(new Date(a.at).toLocaleString()) + '</p></article>').join('') + pager(page, data));
    if (page === 'evaluations') return panel('相同條件下比較成果與成本', '<p class="muted">A：一般工具；B：舊版；C：新版。需記錄相同模型、設定、資料集與證據。沒有比較資料時不顯示提升百分比。</p>' + (data.items || []).map(r => '<article class="entry"><h3>' + e(r.title) + ' · ' + e(r.arm) + '</h3><p>' + (r.passed ? '達標' : '未達標') + ' · ' + e(r.model) + ' · ' + e(r.artifactRef) + '</p></article>').join('') + pager(page, data), button('evaluation-new', '記錄評測結果') + button('evaluation-report', '比較評測'));
    return '';
  }
  async function sourceDialog(id) {
    let record = null;
    if (id) {
      let offset = 0, content = '';
      do { const part = await call('research_sources', { action: 'read', id, offset }); record ||= part; content += part.content; offset = part.nextOffset; } while (offset !== null);
      record.content = content;
    }
    editing.set('source', record);
    openDialog(id ? '編輯研究資料' : '加入研究資料', '<form id="v3-source" class="form" data-form="v3-source">' + field('標題', 'title', record?.title, false, 'required') + field('來源網址／定位', 'uri', record?.uri || 'https://', false, 'required') + field('作者／發佈方', 'author', record?.author) + field('使用權／保存範圍', 'license', record?.license) + field('保存的摘要／獲授權內容', 'content', record?.content, true, 'required') + field('可觀察的事實（每行一項）', 'observations', record?.observations?.join('\n'), true) + field('推論與待驗證內容（每行一項）', 'inferences', record?.inferences?.join('\n'), true) + '</form>', '<button class="primary" form="v3-source">保存來源版本</button>');
  }
  const policyActions = [['annotate', '保存文件旁註'], ['knowledge_patch', '建立／整合知識'], ['knowledge_archive', '封存知識'], ['knowledge_trash', '知識移入回收區'], ['document_write', '修改 MD'], ['document_create', '建立 MD／附件'], ['document_delete', '已核對文件移入回收流程']];
  async function policyDialog(id) {
    const p = id ? await call('maintenance_policy', { action: 'read', id }) : null; editing.set('policy', p);
    openDialog('設定 AI 自主整理政策', '<form id="v3-policy" class="form" data-form="v3-policy">' + field('政策名稱', 'title', p?.title, false, 'required') + '<fieldset><legend>允許範圍</legend>' + [['personal', '個人知識'], ...env.state().roots.map(r => [r.id, r.name])].map(([id, name]) => '<label class="check"><input type="checkbox" name="scopes" value="' + e(id) + '" ' + ((p?.scopes || [root()]).includes(id) ? 'checked' : '') + '>' + e(name) + '</label>').join('') + '</fieldset><fieldset><legend>允許動作</legend>' + policyActions.map(([id, name]) => '<label class="check"><input type="checkbox" name="actions" value="' + id + '" ' + ((p?.actions || ['knowledge_archive']).includes(id) ? 'checked' : '') + '>' + name + '</label>').join('') + '</fieldset>' + field('總操作上限', 'maxOperations', p?.maxOperations || 100, false, 'type="number" min="1" max="1000"') + field('回收保留天數', 'retentionDays', p?.retentionDays || 30, false, 'type="number" min="1" max="3650"') + field('授權理由與前提', 'grantReason', p?.grantReason, true, 'required') + '<label class="check"><input type="checkbox" name="enabled" ' + (p?.enabled !== false ? 'checked' : '') + '>啟用政策</label></form>', '<button class="primary" form="v3-policy">授權並儲存政策</button>');
  }
  function visualExtra(data) {
    cache.set('assets', data.assets || []);
    const options = (data.assets || []).filter(a => !a.mime?.startsWith('video/')).map(a => '<option value="' + e(a.id) + '">' + e(a.name) + '</option>').join('');
    return '<div class="visual-toolbar row">' + button('visual-page', '上一頁素材', 'data-offset="' + Math.max(0, visualOffset - 24) + '" ' + (!visualOffset ? 'disabled' : '')) + '<span>素材 ' + (visualOffset + 1) + '–' + (visualOffset + (data.assets?.length || 0)) + '／' + (data.total || 0) + '</span>' + button('visual-page', '下一頁素材', 'data-offset="' + (visualOffset + 24) + '" ' + (!data.hasMore ? 'disabled' : '')) + '</div>' + panel('從畫面觀察到實作方法', '<p>觀察、假設、效果配方、時間軸與評價各自保存，並附來源與實作位置。</p><div class="row">' + button('visual-observation', '新增區域解構') + button('visual-recipe', '新增效果配方') + button('visual-timeline', '新增時間軸') + button('visual-evaluation', '記錄成果評價') + button('visual-records', '查閱已存紀錄') + button('visual-ai', '複製 AI 分析任務') + '</div><hr><form class="form" data-form="v3-pixels"><h3>量測實作與參考的像素差</h3><div class="two"><label>參考<select name="leftAssetId" required>' + options + '</select></label><label>實作<select name="rightAssetId" required>' + options + '</select></label></div><label class="check"><input type="checkbox" name="environmentMatched" required>已對齊尺寸、字型、內容與動畫狀態</label><button>比較像素差異</button></form>');
  }
  function visualDialog(kind, old = null) {
    editing.set('visual', { kind, old });
    const assets = cache.get('assets') || [], chosen = old?.assetIds?.[0];
    let content = '<form id="v3-visual" class="form" data-form="v3-visual">' + field('名稱', 'title', old?.title, false, 'required') + '<label>關聯素材<select name="assetId">' + assets.map(a => '<option value="' + e(a.id) + '" ' + (a.id === chosen ? 'selected' : '') + '>' + e(a.name) + '</option>').join('') + '</select></label>' + field('實際可觀察內容（每行一項）', 'observations', old?.observations?.join('\n'), true) + field('實現假設（每行一項）', 'hypotheses', old?.hypotheses?.join('\n'), true) + field('限制／仍無法確定的事', 'limitations', old?.limitations?.join('\n'), true);
    if (kind === 'observation') content += field('區域名稱', 'regionTitle', old?.regions?.[0]?.title || '主要區域') + '<div class="four">' + ['x', 'y', 'width', 'height'].map(k => field(k === 'x' ? '左側比例' : k === 'y' ? '上側比例' : k === 'width' ? '寬度比例' : '高度比例', k, old?.regions?.[0]?.rect[k] ?? (['width', 'height'].includes(k) ? 1 : 0), false, 'type="number" min="0" max="1" step="0.01"')).join('') + '</div>' + field('區域細節與實現思路', 'implementation', old?.regions?.[0]?.implementation, true);
    if (kind === 'recipe') content += field('技術棧／版本', 'stack', old?.stack || 'HTML / CSS', false, 'required') + field('效果如何實現', 'technique', old?.technique, true, 'required') + field('可調參數 JSON（選填）', 'parameters', JSON.stringify(old?.parameters || []), true) + field('常見陷阱（每行一項）', 'gotchas', old?.gotchas?.join('\n'), true) + field('最小實作／場景位置', 'implementationRef', old?.implementationRef) + field('如何驗證', 'verification', old?.verification, true);
    if (kind === 'timeline') content += field('時長（秒）', 'duration', old?.duration || 1, false, 'type="number" min="0.01" max="60" step="0.01"') + field('影格 JSON：time、assetId', 'frames', JSON.stringify(old?.frames || []), true) + field('觸發、狀態、時間與緩動 JSON', 'transitions', JSON.stringify(old?.transitions || []), true);
    if (kind === 'visualEvaluation') content += field('實作定位', 'implementationRef', old?.implementationRef, false, 'required') + field('評價維度 JSON', 'dimensions', JSON.stringify(old?.dimensions || { layout: '待評估', readability: '待評估', interaction: '待驗證', aesthetics: '待人工校準' }), true) + field('下一步改善（每行一項）', 'improvements', old?.improvements?.join('\n'), true);
    openDialog('視覺理解與學習紀錄', content + '</form>', '<button class="primary" form="v3-visual">保存紀錄版本</button>');
  }
  async function action(name, el) {
    if (!name.startsWith('v3-')) return false;
    name = name.slice(3);
    if (name === 'page') { offsets[el.dataset.page] = Number(el.dataset.offset); await reload(); }
    if (name === 'source-new') await sourceDialog();
    if (name === 'read-source') await sourceDialog(el.dataset.id);
    if (name === 'source-knowledge') { const s = await call('research_sources', { action: 'read', id: el.dataset.id }); openDialog('提取可重用知識候選', '<form id="v3-extract" class="form" data-form="v3-extract" data-id="' + e(s.id) + '" data-revision="' + s.revision + '" data-hash="' + s.contentHash + '" data-scope="'+e(s.scope)+'">' + field('名稱', 'title', s.title, false, 'required') + field('可重用命題／方法', 'content', '', true, 'required') + field('何時適用', 'appliesWhen', '', true, 'required') + '<p class="help">保持候選，不把研究來源直接當作已驗證規則。</p></form>', '<button class="primary" form="v3-extract">保存候選</button>'); }
    if (name === 'copy-context') { await navigator.clipboard.writeText(JSON.stringify(currentContext, null, 2)); toast('已複製本次脈絡與來源'); }
    if (name === 'new-policy' || name === 'edit-policy') await policyDialog(el.dataset.id);
    if (name === 'maintain') { const p = await call('maintenance_policy', { action: 'read', id: el.dataset.id }); const result = await call('maintain_knowledge', { scope: env.scope()||p.scopes[0], policyId: p.id, expectedPolicyRevision: p.revision }); openDialog('知識維護結果', inspect(result)); toast(result.affected ? '已依政策封存 ' + result.affected + ' 筆，可由歷史還原' : '沒有符合自動維護前提的項目'); }
    if (name === 'draft-read') { const d = await call('workspace_drafts', { action: 'read', id: el.dataset.id }); cache.set('draft', d); openDialog('草稿內容與基準版本', '<p class="mono">' + e(d.baseHash || '無原始文件版本') + '</p>' + inspect(d.fields), button('copy-draft', '複製草稿內容')); }
    if (name === 'copy-draft') { await navigator.clipboard.writeText(JSON.stringify(cache.get('draft')?.fields, null, 2)); toast('已複製草稿'); }
    if (name === 'draft-delete') { await call('workspace_drafts', { action: 'delete', id: el.dataset.id, values: { expectedRevision: Number(el.dataset.revision) } }); await reload(); toast('已移除本機草稿，原文件保留'); }
    if (name === 'visual-page') { visualOffset = Number(el.dataset.offset); await reload(); toast('已切換素材頁面'); }
    if (name === 'visual-observation') visualDialog('observation');
    if (name === 'visual-recipe') visualDialog('recipe');
    if (name === 'visual-timeline') visualDialog('timeline');
    if (name === 'visual-evaluation') visualDialog('visualEvaluation');
    if (name === 'visual-records') { const rows = await call('list_visual_records', { kind: visualKind, scope: env.scope() || undefined, offset: offsets.visualRecords || 0, limit: 20 }); openDialog('視覺紀錄', '<div class="row">' + [['observation', '區域解構'], ['recipe', '效果配方'], ['timeline', '時間軸'], ['visualEvaluation', '成果評價']].map(([kind, label]) => button('visual-kind', label, 'data-kind="' + kind + '"')).join('') + '</div>' + rows.items.map(r => '<article class="entry"><h3>' + e(r.title) + '</h3>' + button('visual-edit', '閱讀／編輯', 'data-kind="' + visualKind + '" data-id="' + r.id + '"') + '</article>').join('') + '<div class="row">' + button('visual-record-page', '上一頁', 'data-offset="' + Math.max(0, (offsets.visualRecords || 0) - 20) + '" ' + (!offsets.visualRecords ? 'disabled' : '')) + button('visual-record-page', '下一頁', 'data-offset="' + ((offsets.visualRecords || 0) + 20) + '" ' + (!rows.hasMore ? 'disabled' : '')) + '</div>'); }
    if (name === 'visual-kind') { visualKind = el.dataset.kind; offsets.visualRecords = 0; await action('v3-visual-records', el); }
    if (name === 'visual-record-page') { offsets.visualRecords = Number(el.dataset.offset); await action('v3-visual-records', el); }
    if (name === 'visual-edit') visualDialog(el.dataset.kind, await call('read_visual_record', { kind: el.dataset.kind, id: el.dataset.id }));
    if (name === 'visual-ai') { const prompt = { goal: '解構這些參考，將觀察與假設分開，建立區域／時間軸與實作配方，再比較實際成果。', scope: root(), assets: (cache.get('assets') || []).map(a => ({ id: a.id, name: a.name })), tools: ['read_visual_reference', 'save_visual_record', 'compare_visual_pixels'], limits: '按需讀總覽與區域；單張圖不能推定互動或原始碼；沒有執行證據不標示已實現。' }; await navigator.clipboard.writeText(JSON.stringify(prompt, null, 2)); toast('已複製 AI 分析任務；貼到已連接插件的 AI 對話即可執行'); }
    if(name==='replace'){
      const documents=env.selection().length?env.selection():env.document()?[env.document()]:[];
      if(!documents.length||documents.length>50)throw new Error('請先選取1–50份文件');
      editing.set('replace',documents);
      openDialog('批次搜尋取代', '<form id="v3-replace" class="form" data-form="v3-replace"><p>影響 '+documents.length+' 份文件；先預覽差異。</p>'+field('搜尋原文','search','',true,'required')+field('取代內容','replacement','',true)+'</form>','<button class="primary" form="v3-replace">預覽取代方案</button>');
    }
    if(name==='metadata'){
      const doc=env.document();if(!doc)throw new Error('請先選擇文件');
      openDialog('編輯文件中繼資料','<form id="v3-metadata" class="form" data-form="v3-metadata"><p class="help">只修改填入的欄位，保留其他 frontmatter 與正文。</p>'+field('name（選填）','name',doc.frontmatter?.name)+field('description（選填）','description',doc.frontmatter?.description,true)+field('status（選填）','status',doc.frontmatter?.status)+'</form>','<button class="primary" form="v3-metadata">預覽欄位修改</button>');
    }
    if(name==='split'){
      const doc=env.document();if(!doc)throw new Error('請先選擇文件');
      openDialog('入口與附件拆分','<form id="v3-split" class="form" data-form="v3-split">'+field('精簡入口與路由連結','routerContent',doc.content,true,'required')+'<div id="v3-attachments"></div>'+button('add-attachment','加入附件')+'<p class="help">有效原文需保留在入口或附件；語意重寫請由 AI 提供逐段覆蓋方案。</p></form>','<button class="primary" form="v3-split">預覽拆分方案</button>');
      await action('v3-add-attachment',el);
    }
    if(name==='add-attachment'){
      const box=document.getElementById('v3-attachments'),n=box.children.length;
      box.insertAdjacentHTML('beforeend','<fieldset class="attachment-item"><legend>附件 '+(n+1)+'</legend>'+field('相對 MD 路徑','path:'+n,'references/method-'+(n+1)+'.md',false,'required')+field('附件內容','content:'+n,'',true,'required')+'</fieldset>');
    }
    if(name==='apply-policy'){
      const rows=await call('maintenance_policy',{action:'list',limit:100});
      cache.set('plan-policy',{id:el.dataset.id,kind:el.dataset.kind||'plan',policies:rows.items});
      openDialog('依既有政策套用','<form id="v3-apply-policy" class="form" data-form="v3-apply-policy"><label>明示授權政策<select name="policyId">'+rows.items.filter(p=>p.enabled).map(p=>'<option value="'+p.id+'">'+e(p.title)+'</option>').join('')+'</select></label><p>服務端仍會核對完整範圍、操作額度、來源版本與覆蓋矩陣。</p></form>','<button class="primary" form="v3-apply-policy">依政策套用此方案</button>');
    }
    if(name==='export-knowledge'){
      const bundle=await call('knowledge_portability',{action:'export',scope:root(),limit:20});
      const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='knowledge-page.json';a.click();URL.revokeObjectURL(url);toast('已匯出前20筆知識；工具可用 offset 分批匯出');
    }
    if(name==='import-knowledge')openDialog('匯入知識資料包','<form id="v3-import" class="form" data-form="v3-import"><label>工作台 JSON 資料包<input name="bundle" type="file" accept=".json,application/json" required></label><p>先建立候選方案，保留現有 ID 與原始資料。</p></form>','<button class="primary" form="v3-import">預覽匯入方案</button>');

    if (name === 'evaluation-new') openDialog('記錄一次實際評測', '<form id="v3-eval" class="form" data-form="v3-eval">' + field('名稱', 'title', '', false, 'required') + field('測試題 ID', 'caseId', '', false, 'required') + '<label>組別<select name="arm"><option>A</option><option>B</option><option>C</option></select></label><label>領域<select name="domain"><option value="md">MD 管理</option><option value="knowledge">知識實作</option><option value="visual">視覺</option></select></label>' + field('模型', 'model', '', false, 'required') + field('設定識別', 'settingsHash', '', false, 'required') + field('資料集識別', 'datasetHash', '', false, 'required') + field('證據定位', 'artifactRef', '', false, 'required') + field('輸入 tokens（未知留空）', 'inputTokens', '', false, 'type="number" min="0"') + field('輸出 tokens（未知留空）', 'outputTokens', '', false, 'type="number" min="0"') + '<label class="check"><input type="checkbox" name="passed">達到預定標準</label><label class="check"><input type="checkbox" name="holdout">屬於未用來調整方案的保留測試集</label></form>', '<button class="primary" form="v3-eval">保存評測證據</button>');
    if (name === 'evaluation-report') openDialog('比較相同模型與設定', '<form id="v3-eval-report" class="form" data-form="v3-eval-report">' + ['model', 'settingsHash', 'datasetHash'].map(k => field(({ model: '模型', settingsHash: '設定識別', datasetHash: '資料集識別' })[k], k, '', false, 'required')).join('') + '</form>', '<button class="primary" form="v3-eval-report">產生比較</button>');
    return true;
  }
  const lines = value => String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  async function submit(form) {
    const kind = form.dataset.form, v = Object.fromEntries(new FormData(form)); if (!kind.startsWith('v3-')) return false;
    if(kind==='v3-replace'){const result=await call('create_document_plan',{action:'replace',values:{search:v.search,replacement:v.replacement,documents:editing.get('replace').map(d=>({id:d.id,hash:d.hash}))}});if(result.id)await env.showPlan(result.id);else toast('沒有符合的文字，未修改文件');}
    if(kind==='v3-metadata'){const doc=env.document(),fields=Object.fromEntries(Object.entries(v).filter(([,value])=>value!==''));const result=await call('create_document_plan',{action:'metadata',values:{documentId:doc.id,expectedHash:doc.hash,fields}});await env.showPlan(result.id);}
    if(kind==='v3-split'){const doc=env.document(),attachments=[...form.querySelectorAll('.attachment-item')].map((_,i)=>({relativePath:v['path:'+i],content:v['content:'+i]}));const result=await call('create_document_plan',{action:'split',values:{documentId:doc.id,expectedHash:doc.hash,routerContent:v.routerContent,attachments}});await env.showPlan(result.id);}
    if(kind==='v3-apply-policy'){const current=cache.get('plan-policy'),policy=current.policies.find(p=>p.id===v.policyId);if(!policy)throw new Error('請先建立適用的授權政策');await call('apply_maintenance_plan',{policyId:policy.id,expectedPolicyRevision:policy.revision,planId:current.id,kind:current.kind});closeDialog();await reload();toast('已依既有政策套用，復原紀錄已保存');}
    if(kind==='v3-import'){const file=form.elements.bundle.files[0];if(file.size>1024*1024)throw new Error('單批資料包最多1 MiB');const bundle=JSON.parse(await file.text()),plan=await call('knowledge_portability',{action:'import',scope:root(),bundle});if(plan.id)await env.showPlan(plan.id,'knowledgePlan');else toast(plan.message);}

    if (kind === 'v3-context') { const task = await call('resolve_task_brief', { id: v.taskId }); const run = await call('context_run', { action: 'begin', taskId: task.id, maxTokens: Number(v.maxTokens) + 1500 }); currentContext = await call('build_context_package', { taskId: task.id, expectedRevision: task.revision, runId: run.runId, query: v.query || undefined, maxTokens: Number(v.maxTokens), includeSources: v.includeSources === 'on' }); await reload(); toast('已建立本次脈絡；沒有自動讀取整個資料庫'); }
    if (kind === 'v3-source') { const old = editing.get('source'); await call('research_sources', { action: 'save', scope: old?.scope || root(), ...(old ? { id: old.id, expectedRevision: old.revision } : {}), ...v, observations: lines(v.observations), inferences: lines(v.inferences) }); closeDialog(); await reload(); toast('已保存研究來源版本'); }
    if (kind === 'v3-extract') { await call('save_experience', { ...v, scope: form.dataset.scope||root(), type: 'method', source: 'research:' + form.dataset.id, externalSourceRefs: [{ id: form.dataset.id, revision: Number(form.dataset.revision), hash: form.dataset.hash }], reviewState: 'candidate' }); closeDialog(); toast('已保存知識候選，仍需驗證適用性'); }
    if (kind === 'v3-policy') { const old = editing.get('policy'); await call('maintenance_policy', { action: 'save', values: { ...(old ? { id: old.id, expectedRevision: old.revision } : {}), title: v.title, grantReason: v.grantReason, enabled: v.enabled === 'on', scopes: new FormData(form).getAll('scopes'), actions: new FormData(form).getAll('actions'), maxOperations: Number(v.maxOperations), retentionDays: Number(v.retentionDays), confirm: true } }); closeDialog(); await reload(); toast('已保存明確範圍與動作的授權政策'); }
    if (kind === 'v3-pixels') { const result = await call('compare_visual_pixels', { leftAssetId: v.leftAssetId, rightAssetId: v.rightAssetId, environmentMatched: v.environmentMatched === 'on' }); openDialog('像素量測結果', '<p>此結果不代表功能或審美評價。</p>' + inspect(result)); toast('已保存本機像素比較結果'); }
    if (kind === 'v3-visual') {
      const { kind: type, old } = editing.get('visual'), assetIds = old?.assetIds || (v.assetId ? [v.assetId] : []);
      const values = { ...(old ? { id: old.id, expectedRevision: old.revision } : {}), scope: old?.scope || (cache.get('assets')||[]).find(a=>a.id===v.assetId)?.scope || root(), title: v.title, assetIds, observations: lines(v.observations), hypotheses: lines(v.hypotheses), limitations: lines(v.limitations) };
      if (type === 'observation') values.regions = [{ title: v.regionTitle, assetId: v.assetId, rect: Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, Number(v[k])])), implementation: v.implementation }];
      if (type === 'recipe') Object.assign(values, { stack: v.stack, technique: v.technique, parameters: JSON.parse(v.parameters || '[]'), gotchas: lines(v.gotchas), implementationRef: v.implementationRef, verification: v.verification });
      if (type === 'timeline') { Object.assign(values, { duration: Number(v.duration), frames: JSON.parse(v.frames || '[]'), transitions: JSON.parse(v.transitions || '[]') }); values.assetIds = [...new Set([...assetIds, ...values.frames.map(f => f.assetId)])]; }
      if (type === 'visualEvaluation') Object.assign(values, { implementationRef: v.implementationRef, dimensions: JSON.parse(v.dimensions || '{}'), improvements: lines(v.improvements) });
      await call('save_visual_record', { kind: type, values }); closeDialog(); toast('已保存視覺紀錄版本，觀察與假設分開保留');
    }
    if (kind === 'v3-eval') { for(const key of ['inputTokens','outputTokens'])if(v[key]==='')delete v[key]; await call('evaluate_workbench', { action: 'record', values: { ...v, scope: root(), passed: v.passed === 'on', holdout: v.holdout === 'on', ...Object.fromEntries(['inputTokens', 'outputTokens'].filter(k => v[k] !== undefined).map(k => [k, Number(v[k])])) } }); closeDialog(); await reload(); toast('已保存評測，尚未據此宣稱顯著提升'); }
    if (kind === 'v3-eval-report') { const report = await call('evaluate_workbench', { action: 'report', values: v }); openDialog('評測比較', inspect(report)); }
    return true;
  }
  async function restoreDrafts() {
    for (const form of document.querySelectorAll('form[data-context]')) {
      const key = 'draft:' + encodeURIComponent(form.dataset.context);
      if (draftRevisions.has(key)) continue;
      draftRevisions.set(key, 0);
      try {
        const draft = await api('/api/draft', { action: 'read', id: key });
        draftRevisions.set(key, draft.revision);
        if (!draft.fields || !form.isConnected || form.dataset.touched) continue;
        for (const field of draft.fields) { const el = form.elements.namedItem(field.name); if (el) { if (field.type === 'checkbox') el.checked = field.value; else if(!(el.tagName==='SELECT'&&field.value===''&&![...el.options].some(o=>o.value===''))) el.value = field.value; } }
        if (draft.revision) form.insertAdjacentHTML('afterbegin', '<p class="draft-status" role="status">已恢復本機草稿，尚未寫入原文件。</p>');
      } catch {}
    }
  }
  function saveDraft(form) {
    if (!form?.dataset.context || form.dataset.form === 'criterion') return;
    form.dataset.touched = 'true';
    const key = 'draft:' + encodeURIComponent(form.dataset.context);
    clearTimeout(timers.get(key));
    const fields = [...form.elements].filter(el => el.name).map(el => ({ name: el.name, type: el.type, value: el.type === 'checkbox' ? el.checked : el.value }));
    timers.set(key, setTimeout(async () => {
      try {
        if (!draftRevisions.has(key)) { const current = await api('/api/draft', { action: 'read', id: key }); draftRevisions.set(key, current.revision); }
        const result = await api('/api/draft', { action: 'save', id: key, expectedRevision: draftRevisions.get(key), title: env.document()?.title || '工作台草稿', scope: root(), documentId: env.document()?.id, baseHash: env.document()?.hash, fields });
        draftRevisions.set(key, result.revision);
        let status = form.querySelector('.draft-status'); if (!status && form.isConnected) { status = document.createElement('p'); status.className = 'draft-status'; status.setAttribute('role', 'status'); form.prepend(status); }
        if (status) status.textContent = '草稿已保留於本機；原文件尚未變更。';
      } catch (error) { if (form.isConnected) toast('草稿未保存：' + error.message, 'error'); }
    }, 500));
  }
  async function dataUrl(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); }); }
  async function importFiles(files) {
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) throw new Error('每份媒體最多8 MiB');
      toast('正在匯入 ' + file.name, 'loading');
      if (!file.type.startsWith('video/')) {
        let blob = file;
        if (file.type === 'image/webp') { const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas'); const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio); canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); blob = await new Promise(r => canvas.toBlob(r, 'image/png')); bitmap.close(); }
        await call('import_visual_asset', { base64: await dataUrl(blob), name: file.name, scope: root(), source: 'user:browser-upload' }); continue;
      }
      const url = URL.createObjectURL(file), video = document.createElement('video'); video.preload = 'auto'; video.muted = true; video.src = url;
      try {
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('瀏覽器無法解碼影片')); });
        if(!Number.isFinite(video.duration)){
          await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('無法確定影片時長')),10000);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=1e8;});
        }
        if (!Number.isFinite(video.duration) || video.duration > 60) throw new Error('影片時長最多60秒');
        const original = await call('import_visual_asset', { base64: await dataUrl(file), name: file.name, scope: root(), source: 'user:browser-upload' }), frames = [], canvas = document.createElement('canvas'),sheet=document.createElement('canvas');sheet.width=960;sheet.height=432;
        const ratio = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight)); canvas.width = Math.max(1, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
        for (let i = 0; i < 6; i++) {
          const time = Math.max(0.01, Math.min(video.duration - 0.01, video.duration * (i + 0.1) / 6));
          await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('影格擷取超時')), 10000); video.onseeked = () => { clearTimeout(timer); resolve(); }; video.currentTime = time; });
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          const sx=(i%3)*320,sy=Math.floor(i/3)*216,ctx=sheet.getContext('2d');ctx.fillStyle='#080f1e';ctx.fillRect(sx,sy,320,216);ctx.drawImage(canvas,sx,sy,320,180);ctx.fillStyle='#f5f8ff';ctx.font='16px sans-serif';ctx.fillText(time.toFixed(2)+'s',sx+10,sy+204);
          const image = await call('import_visual_asset', { base64: canvas.toDataURL('image/png').split(',')[1], name: file.name + ' @' + time.toFixed(2) + 's', scope: root(), source: 'artifact:' + original.id });
          frames.push({ assetId: image.id, time });
        }
        const contactSheet=await call('import_visual_asset',{base64:sheet.toDataURL('image/png').split(',')[1],name:file.name+' 關鍵影格總覽',scope:root(),source:'artifact:'+original.id});
        await call('save_visual_record', { kind: 'timeline', values: { title: file.name + ' 關鍵影格', scope: root(), assetIds: [original.id,contactSheet.id, ...frames.map(f => f.assetId)], contactSheetId:contactSheet.id, duration: video.duration, frames, observations: ['由瀏覽器擷取6個取樣影格'], hypotheses: [], limitations: ['取樣影格不足以證明完整時序、緩動或互動因果'], transitions: [] } });
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
    }
    await reload(); toast('已匯入 ' + files.length + ' 份媒體；影片另存影格總覽與時間軸');
  }
  return { nav, owns, load, render, action, submit, visualExtra, restoreDrafts, saveDraft, importFiles, getVisualOffset: () => visualOffset };
}
