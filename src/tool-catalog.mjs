import { definitions } from './tools.mjs';
import { fail } from './services/shared.mjs';
const core = {
  md: ['open_workbench', 'get_overview', 'list_scopes', 'add_scope', 'start_index_job', 'get_index_job', 'list_documents', 'read_document', 'audit_markdown', 'mark_document', 'create_change_plan', 'read_change_plan', 'apply_change_plan', 'restore_change_plan', 'find_context', 'context_run'],
  insight: ['open_workbench', 'get_overview', 'list_scopes', 'add_scope', 'context_run', 'compile_task_request', 'build_context_package', 'search_knowledge', 'find_experiences', 'read_knowledge', 'save_experience', 'resolve_task_brief', 'record_evidence', 'build_learning_report']
};
const groups = {
  documents: { description: '文件分類、章節、整合覆蓋、改名、拆分與搜尋取代', names: ['annotate_document', 'set_document_category', 'review_document', 'read_document_section', 'propose_section_edit', 'create_move_plan', 'set_merge_coverage', 'create_document_plan'] },
  jobs: { description: '大量選取、背景工作、監看與取消', names: ['selection_snapshot', 'background_job', 'cancel_index_job', 'watch_scope'] },
  governance: { description: '自治授權、維護、歷史與草稿', names: ['maintenance_policy', 'apply_maintenance_plan', 'maintain_knowledge', 'list_change_history', 'workspace_drafts', 'review_finding'] },
  knowledge: { description: '知識管理、狀態、批次提案、還原與向量', names: ['list_knowledge', 'set_knowledge_state', 'propose_knowledge_change', 'read_knowledge_change', 'apply_knowledge_change', 'restore_knowledge_change', 'save_knowledge_vector', 'knowledge_portability'] },
  research: { description: '有來源的研究資料與領域包', names: ['research_sources', 'save_domain_pack', 'list_domain_packs', 'read_domain_pack'] },
  tasks: { description: '任務列表、修訂、方法與評測', names: ['create_task_brief', 'list_task_briefs', 'update_task_brief', 'list_methods', 'evaluate_workbench'] },
  visual: { description: '媒體、區域、配方、時間軸與成果比較', names: ['list_visual_references', 'import_visual_asset', 'read_visual_reference', 'save_visual_comparison', 'save_visual_record', 'list_visual_records', 'read_visual_record', 'compare_visual_pixels'] }
};
export const discoveryTool = {
  name: 'get_workbench_capabilities',
  description: '查看工作台能力群組；提供groups會按需揭露該組工具並通知宿主更新工具列表，不讀資料。重試前先刷新列表。',
  inputSchema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: [...Object.keys(groups), 'all'] }, maxItems: 8 } }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
};
export class ToolCatalog {
  constructor(role, profile = process.env.WORKBENCH_TOOL_PROFILE || 'compact') {
    this.role = role; this.full = definitions(role); this.active = new Set(profile === 'all' ? this.full.map(t => t.name) : core[role]);
  }
  list() { return [discoveryTool, ...this.full.filter(t => this.active.has(t.name))]; }
  has(name) { return name === discoveryTool.name || this.full.some(t => t.name === name && this.active.has(name)); }
  activate(requested = []) {
    if (!Array.isArray(requested) || requested.length > 8 || requested.some(g => g !== 'all' && !groups[g])) fail('能力群組不正確');
    const before = this.active.size;
    for (const group of requested) for (const name of group === 'all' ? this.full.map(t => t.name) : groups[group].names) if (this.full.some(t => t.name === name)) this.active.add(name);
    return { changed: this.active.size !== before, profile: 'session_progressive', groups: Object.entries(groups).map(([id, item]) => { const available = item.names.filter(name => this.full.some(t => t.name === name)); return { id, description: item.description, toolCount: available.length, exposed: available.every(name => this.active.has(name)) }; }).filter(g => g.toolCount), exposedTools: this.list().map(t => t.name), fallback: '若宿主不刷新工具列表，在MCP設定加入WORKBENCH_TOOL_PROFILE=all並重新連線。' };
  }
}
