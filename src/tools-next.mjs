import { fail } from './services/shared.mjs';
const str = description => ({ type: 'string', description });
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const integer = { type: 'integer', minimum: 0 };
const boolean = { type: 'boolean' };
const values = { type: 'object', additionalProperties: true };
const list = { type: 'array', items: { type: 'string' }, maxItems: 100 };
const action = names => ({ type: 'string', enum: names });
const paging = { scope: str('專案 ID 或 personal'), query: str('關鍵字'), offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } };

export function nextDefinitions(role) {
  const tools = [];
  const add = (name, description, properties, required, group, effect = 'read') => {
    if (role === 'both' || group === 'common' || group === role) tools.push({ name, description, inputSchema: obj(properties, required), annotations: { readOnlyHint: effect === 'read', destructiveHint: effect === 'destructive', openWorldHint: false } });
  };
  add('context_run', '建立共用讀取預算、查看用量或接收宿主實際用量；估計與實測分開。', { action: action(['begin', 'status', 'usage']), runId: str('讀取工作 ID'), taskId: str('任務 ID'), scope: str('範圍'), maxTokens: integer, maxBytes: integer, maxImages: integer, provider: str('供應商'), model: str('模型'), requestId: str('請求 ID'), inputTokens: integer, cachedInputTokens: integer, outputTokens: integer }, ['action'], 'common', 'write');
  add('compile_task_request', '保存原始需求並建立有版本的任務表示；假設不改變授權。', { request: str('原始需求'), title: str('名稱'), goal: str('目標'), scope: str('範圍'), constraints: list, deliverables: list, criteria: list, assumptions: list, unknowns: list, domains: list, environment: values }, ['request'], 'insight', 'write');
  add('build_context_package', '依目前任務版本選取少量適用知識，完整保留前提、例外與來源；不讀全庫。', { taskId: str('任務 ID'), expectedRevision: integer, runId: str('讀取工作'), query: str('本次問題'), maxTokens: integer, excludeIds: list, includeSources: boolean }, ['taskId', 'expectedRevision'], 'insight');
  add('research_sources', '管理有來源與版本的研究資料；只保存宿主提供內容，不自行上網或執行來源指令。', { action: action(['list', 'read', 'search', 'save']), field:action(['content','observations','inferences']), ...paging, id: str('來源 ID'), revision: integer, expectedRevision: integer, title: str('標題'), uri: str('http(s)／document:／artifact:／user:'), content: str('合規摘要或獲授權內容'), author: str('作者'), license: str('使用權'), publishedAt: str('發佈日期'), expiresAt: str('有效期'), lifecycle: action(['active', 'archived', 'pending_delete', 'trashed']), observations: list, inferences: list }, ['action'], 'insight', 'write');
  add('import_visual_asset', '匯入明確提供的 PNG／JPEG／WebP／MP4／WebM，保存來源、hash、範圍；單份8MiB。', { base64: str('媒體 base64'), path: str('已加入的專案範圍內媒體完整路徑'), name: str('名稱'), scope: str('範圍'), source: str('來源'), license: str('使用權'), viewport: values }, [], 'insight', 'write');
  add('save_visual_record', '保存觀察、效果配方、動態時間軸或多維評價；觀察與假設分開。', { kind: action(['observation', 'recipe', 'timeline', 'visualEvaluation']), values }, ['kind', 'values'], 'insight', 'write');
  add('list_visual_records', '分頁查詢視覺解構、配方、時間軸與評價摘要。', { kind: action(['observation', 'recipe', 'timeline', 'visualEvaluation']), ...paging }, ['kind'], 'insight');
  add('read_visual_record', '詳讀指定視覺紀錄；配方與證據按需要載入。', { kind: action(['observation', 'recipe', 'timeline', 'visualEvaluation']), id: str('紀錄 ID'),revision:integer,field:str('需要詳讀的欄位'),offset:integer }, ['kind', 'id'], 'insight');
  add('compare_visual_pixels', '在已對齊環境的 PNG／JPEG 上量測像素差；不將相似度當成審美評分。', { leftAssetId: str('參考圖'), rightAssetId: str('實作圖'), title: str('名稱'), environmentMatched: boolean }, ['leftAssetId', 'rightAssetId', 'environmentMatched'], 'insight', 'write');
  add('review_document', '準備五原則審核、列內容區塊，或提交有原文與依據的 AI 建議。', { action: action(['prepare', 'clauses', 'submit', 'sections']), documentId: str('文件'), expectedHash: str('來源 hash'), offset: integer, limit: integer, rule: str('原則'), original: str('實際原文'), reason: str('理由'), suggestion: str('修改建議'), evidence: str('證據'), triggerExamples: list }, ['action', 'documentId'], 'md', 'write');
  add('annotate_document', '原子保存標註與分類；任一項失敗不留下半完成結果。', { documentId: str('文件'), expectedHash: str('hash'), status: action(['active', 'completed', 'pending_delete', 'keep']), category: str('分類或 auto'), reason: str('理由'), evidence: str('完成證據'), completed: boolean, confirmed: boolean }, ['documentId', 'expectedHash', 'status', 'reason'], 'md', 'write');
  add('set_merge_coverage', '核對全部來源與每個內容區塊去向；未保留內容需逐條取代或捨棄理由。', { id: str('方案 ID'), coverage: { type: 'array', maxItems: 50, items: values } }, ['id', 'coverage'], 'md', 'write');
  add('create_document_plan', '產生字面搜尋取代或路由器附件拆分方案，先檢查版本與內容覆蓋。', { action: action(['replace', 'split', 'metadata']), values }, ['action', 'values'], 'md', 'write');
  add('list_change_history', '分頁搜尋文件與知識的變更／維護歷史。', { query: str('名稱'), status: str('狀態'), offset: integer, limit: integer }, [], 'common');
  add('maintenance_policy', '列出／查看或明確授權範圍與動作；政策不由被讀文件自動產生。', { action: action(['list', 'read', 'save']), values, id: str('政策 ID'), offset: integer, limit: integer }, ['action'], 'common', 'write');
  add('apply_maintenance_plan', '依指定版本政策套用已完成的變更計畫；檢查動作、範圍與額度，保留復原。', { policyId: str('政策'), expectedPolicyRevision: integer, planId: str('方案'), kind: action(['plan', 'knowledgePlan']) }, ['policyId', 'expectedPolicyRevision', 'planId', 'kind'], 'common', 'destructive');
  add('maintain_knowledge', '找出明示過期或同條件完全重複的候選；有有效政策才封存，低頻或檔齡不觸發刪除。', { scope: str('範圍'), policyId: str('可選政策'), expectedPolicyRevision: integer }, [], 'insight', 'write');
  add('selection_snapshot', '固定全部篩選結果與來源版本，或核對本頁選取成員；不讀全文。', { action: action(['create','membership']), id: str('快照'), documentIds: {type:'array',maxItems:300,items:{type:'string'}}, rootId: str('範圍'), query: str('搜尋'), status: str('狀態'), category: str('分類') }, [], 'md', 'write');
  add('background_job', '啟動、追蹤、取消或恢復可持續的索引／批次標記工作。', { action: action(['start', 'get', 'cancel', 'resume']), id: str('工作 ID'), values }, ['action'], 'md', 'write');
  add('save_knowledge_vector', '保存宿主提供、綁定知識版本的向量；模型與維度不可混用，不自動呼叫外部服務。', { id: str('知識'), expectedRevision: integer, model: str('embedding 模型'), vector: { type: 'array', minItems: 2, maxItems: 4096, items: { type: 'number' } } }, ['id', 'expectedRevision', 'model', 'vector'], 'insight', 'write');
  add('workspace_drafts','保存、讀取與移除有版本的本機草稿；草稿不寫入原文件。',{action:action(['list','read','save','delete']),values,id:str('草稿ID'),...paging},['action'],'common','write');
  add('knowledge_portability','分批匯出知識或從資料包產生候選匯入方案，不覆寫來源 ID。',{action:action(['export','import']),scope:str('範圍'),offset:integer,limit:integer,bundle:values,title:str('名稱')},['action'],'insight','write');
  add('evaluate_workbench','保存實際 A/B/C 評測與證據或按相同模型設定彙整；缺資料不宣稱改善。',{action:action(['record','list','report']),values,...paging},['action'],'insight','write');
  add('save_domain_pack','建立或修訂有作用範圍及版本的領域來源包。',{values},['values'],'insight','write');
  return tools;
}
export function validate(schema, value, label = 'arguments') {
  if (value === undefined) return;
  if (schema.const !== undefined && value !== schema.const) fail(label + '值不正確');
  if (schema.enum && !schema.enum.includes(value)) fail(label + '選項不正確');
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '需為物件');
    for (const field of schema.required || []) if (value[field] === undefined) fail(label + '缺少 ' + field);
    for (const [key, v] of Object.entries(value)) {
      if (schema.additionalProperties === false && !schema.properties?.[key]) fail(label + '不接受 ' + key);
      if (schema.properties?.[key]) validate(schema.properties[key], v, label + '.' + key);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? 10000) || value.length < (schema.minItems || 0)) fail(label + '陣列長度不正確');
    for (const v of value) validate(schema.items || {}, v, label);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (!Number.isFinite(value) || schema.type === 'integer' && !Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail(label + '數值不正確');
  } else if (schema.type && typeof value !== schema.type) fail(label + '型別不正確');
}
export async function dispatchNext(w, name, input) {
  switch (name) {
    case 'workspace_drafts': return w.workspace.draft(input.action==='save'?{...input.values,action:'save'}:{...input,expectedRevision:input.values?.expectedRevision});
    case 'knowledge_portability': return w.workspace.portability(input);
    case 'evaluate_workbench': return w.workspace.evaluation({...input.values,...input});
    case 'save_domain_pack': return w.saveDomain(input.values);
    case 'context_run': return input.action === 'begin' ? w.budget.begin(input) : input.action === 'usage' ? w.budget.actual(input) : w.budget.status(input.runId);
    case 'compile_task_request': return w.contextService.compile(input);
    case 'build_context_package': return w.contextService.build(input);
    case 'research_sources': return w.sources[input.action === 'save' ? 'save' : input.action](input);
    case 'import_visual_asset': return w.visual.import(input);
    case 'save_visual_record': return w.visual.save({ ...input.values, kind: input.kind });
    case 'list_visual_records': return w.visual.records(input);
    case 'read_visual_record': return w.visual.readRecord(input);
    case 'compare_visual_pixels': return w.visual.compare(input);
    case 'review_document': return input.action === 'clauses' ? w.documentsService.clauses(input.documentId) : input.action === 'sections' ? w.documentsService.sections(input) : w.documentsService[input.action](input);
    case 'annotate_document': return w.documentsService.annotate(input);
    case 'set_merge_coverage': return w.documentsService.coverage(input);
    case 'create_document_plan': return w.documentsService[input.action](input.values);
    case 'list_change_history': return w.documentsService.history(input);
    case 'maintenance_policy': return input.action === 'save' ? w.policies.save(input.values || {}) : input.action === 'list' ? w.policies.list(input) : w.get('policy', input.id) || fail('政策不存在');
    case 'apply_maintenance_plan': return w.policies.apply(input);
    case 'maintain_knowledge': return w.policies.maintain(input);
    case 'selection_snapshot': return w.background.snapshot(input);
    case 'background_job': return input.action === 'start' ? w.background.start(input.values || {}) : w.background[input.action](input.id);
    case 'save_knowledge_vector': return w.retrieval.saveVector(input);
  }
}
