# 五原則審核

audit_markdown 先找規則、連結及字詞相似候選，按 rootId 分範圍及 cursor 續讀。來源沒變時重用逐文件分析。相似度有配對與文件上限；truncated 為真就不能宣稱全庫語意檢查完成。

review_document(action: prepare) 列出章節與審核契約；用 read_document_section 讀相關原文。以 action: submit 保存 documentId、expectedHash、rule、original、reason、suggestion、evidence 及正反觸發例子。original 必須存在於目前原文；輸出屬 AI 推論，仍可由人審查。

1. description 說清楚做什麼、何時用；給縮短版及不應觸發的例子。字數不是品質分數。
2. 不同任務需要的工作流才拆成入口＋附件。入口保留路由、必要前提；附件不能互相要求讀完全部。
3. 固定先讀／每次全測，改為文件責任與變更驗證映射；保留必要品質門檻。
4. 重複先問，改成動作、範圍、前提、停止條件及復原方式。修改規則的建議不能自動創造本次授權。
5. 區分完全重複、互補、版本差異及同範圍衝突。授權副本、不同專案偏好與不同平台限制可合理共存。

一般 MD 不要求 skill frontmatter。檔名、舊日期、低使用率或模型覺得相似，都不足以判定可刪除。採用建議不等於來源已修改；實際套用、讀回後才記為已處理。
