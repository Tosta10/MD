# 任務與脈絡

compile_task_request 保存原始 request、目標、交付、限制、驗收、假設、未知與環境。優化是建立可理解的任務表示；不得刪掉使用者限制、增加未要求目標或擴大授權。假設需明示，不在後續摘要升成事實。

已有任務以 resolve_task_brief 讀回；update_task_brief 帶 expectedRevision。原始 request 及舊任務版本保留。環境或目標改變會使先前驗收需再核對。

context_run(action:begin,taskId) 建立共用預算；build_context_package 帶 taskId、expectedRevision、runId，初始 maxTokens 約3000。回傳本次採用、理由、完整必要條件、來源、待核對候選及省略數。沒有命中時補來源，不把不適用知識硬塞入。修改任務後建立新的明確工作，不繞過舊預算。

需要探索重大未知或驗證實作時，使用 [task-harness](../../task-harness/SKILL.md)；list_methods 提供可選方法及停止條件，無需每次執行所有方法。

record_evidence 保存任務版本、觀察、證據位置、環境及結果。build_learning_report 列驗收與缺口；填報證據不是獨立執行。未做比較就維持 not_measured。
