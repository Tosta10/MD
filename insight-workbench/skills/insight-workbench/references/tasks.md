# 需求摘要與成果驗證

用 create_task_brief 保存目標、原始需求摘要、範圍、限制、交付物及可觀察的完成條件。資訊已明確時直接整理；只有缺失會改變成果時才詢問。

新訊息可能補充、修正、暫停或替換任務；resolve_task_brief 先取得當前 revision，再以 update_task_brief 的 expectedRevision 記錄 correction 並更新受影響欄位。不要只加註修正卻繼續用舊目標。unknowns、assumptions、environment 與 domains 保存必要未知、假設及環境。

依工作選擇驗證：程式看受影響行為與測試、設計看實際畫面、文件看引用與內容、資料看讀回結果。每個 passed／failed 條件附實際證據；沒做的檢查標 pending 或 unverified。完成任務需全部條件通過，不能用「程式已生成」代替驗收。

feedback 記錄採用、需修改或拒絕與原因。衡量同類任務的修正次數、返工、重複缺陷及驗證缺口，不製造沒有定義的理解力分數。

list_methods 列出八種方法的時機、產物與停止條件，按任務選用，不要求每次跑八步。record_evidence 保存觀察與可讀回位置，綁 taskRevision；reported_only 不能冒充實測。build_learning_report 彙整條件及本版本證據；baseline/heldOut 未量測就如實保留，不宣稱模型權重已更新或理解力提升百分比。
