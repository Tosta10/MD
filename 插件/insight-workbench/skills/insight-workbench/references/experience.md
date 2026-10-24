# 有情境的經驗與視覺比較

find_experiences 預設只選已確認、未失效且符合專案的經驗；需要檢閱候選才 includeCandidates。個人記憶也須符合 appliesWhen，當前要求有衝突時不用舊偏好。

save_experience 分 preference、fact、decision、method、failure。每筆保存來源、適用條件、反例或失效時間；預設 candidate。只有明確使用者回饋或可追溯實際證據支持時才 confirmed，將推論保留為候選。

不要把單次偏好擴張到所有產品；專案經驗以範圍 ID 保存。規則值得寫入 MD 時交給 MD 管理台提案，不直接累積全域 AGENTS。

## 視覺與審美

list_visual_references 只列使用者加入的圖片。read_visual_reference 可直接取得圖片供檢視；對照真實畫面，區分觀察與推測，檢查閱讀順序、對齊、間距、對比、操作狀態及任務適配。

save_visual_comparison 保存左右圖片、選擇、理由與範圍；不自動生成全域偏好。若使用者要長期保存，整理為有情境的 preference。沒有實際畫面時不得宣稱已看過或驗證審美改善。

## 程式與目的分析

依相關文件與原始碼確認模組責任、輸入輸出、資料流與變更影響；結果保存為 decision／fact，含版本與檔案來源。將問題分成需求誤解、設計取捨、實作缺陷、相容性及驗證缺口，避免只調整提示詞卻忽略實際根因。
