# 有情境的經驗與視覺比較

search_knowledge 以 query/taskId 搜尋，附 scope、必要 domain/environment 與同次執行的 runId。先讀最多6筆有界摘要，再用 read_knowledge 按 ID/revision/offset 詳讀。相同 runId 累計48KiB；遇上限回報缺口，不能換 ID 偷偷繞過。find_experiences 為相容入口，同樣禁止空查詢。

只有 active、validated、未失效且明確條件匹配的內容進一般結果；uncertain/candidate/needs_review 分開列出。appliesTo/excludeWhen 支援 platform/version/taskTag 精確條件；自由文字 appliesWhen/notWhen 仍需判讀，不宣稱後端有完整語意理解。

save_experience 分 preference、fact、decision、method、failure、gotcha。每筆保存來源、適用條件、反例及證據；預設 candidate。更新需 expectedRevision；修改已確認內容會降為 needs_review，舊證據保留歷史。舊版 confirmed 遷移後先複核，不當成新環境已驗證。

AI 可用 propose_knowledge_change 建立 create/patch/state 批次，再 read_knowledge_change、apply_knowledge_change、restore_knowledge_change。單筆維護可用 set_knowledge_state，附版本及理由，標 pending_delete、archived、trashed 或 active。trashed 可還原，沒有自動永久清除；低使用率不是刪除理由。

不要把單次偏好擴張到所有產品；專案經驗以範圍 ID 保存。規則值得寫入 MD 時交給 MD 管理台提案，不直接累積全域 AGENTS。

## 視覺與審美

list_visual_references 只列使用者加入的圖片。read_visual_reference 可直接取得圖片供檢視；對照真實畫面，區分觀察與推測，檢查閱讀順序、對齊、間距、對比、操作狀態及任務適配。

save_visual_comparison 保存左右圖片、選擇、理由與範圍；不自動生成全域偏好。若使用者要長期保存，整理為有情境的 preference。沒有實際畫面時不得宣稱已看過或驗證審美改善。

## 程式與目的分析

依相關文件與原始碼確認模組責任、輸入輸出、資料流與變更影響；結果保存為 decision／fact，含版本與檔案來源。將問題分成需求誤解、設計取捨、實作缺陷、相容性及驗證缺口，避免只調整提示詞卻忽略實際根因。
