# 理解工作台 v2

保存本次目的、限制、交付物、實際驗證證據及有情境的經驗，協助 Codex 減少需求遺漏與重複錯誤。

v2 加入未知/假設、按任務選用 Thariq 方法、薄領域來源、知識版本、適用條件、封存/回收/還原及結構化成果回報。修改已確認內容需重新複核；更新必帶 expectedRevision。

AI 先 search_knowledge 回少量摘要，再 read_knowledge 詳讀。空查詢拒絕、正文每次最多8KiB；相同 runId 的累計讀取上限48KiB。條件不明的結果分區，不混入已確認適用內容。未提供 runId 時僅執行單次上限。

雙擊「開啟工作台.cmd」使用本機介面；在 Codex 安裝本機插件後，可使用 `$insight-workbench` 或請它呼叫 `open_workbench`。

需求變更會使舊驗證失效；完成條件通過需有實際證據。經驗保存來源、範圍、適用條件與反例；候選不自動成為全域規則。支援主動加入圖片、比較方案及保存選擇理由。

需要 Node.js 24+；啟動器會尋找 Codex 捆綁 Node 或 CODEX_NODE_PATH。預設資料位置為使用者家目錄 `.codex-md-workbenches`，可用 CODEX_WORKBENCH_HOME 指定。

主庫為 workbench-v2.sqlite，首次啟動從舊 workbench.sqlite 建立一致快照。原資料保留，舊 confirmed 先降為 needs_review。切換後請使用新版；舊服務後續寫入不會自動合併。安裝快取需在 Codex 內更新，當前對話不會自動換工具列表。

插件提供記錄、檢索與工作流程；語意、視覺、審美與程式判讀由 Codex 根據已提供的證據完成。它不修改模型權重，不自動存取其他對話。MD 管理台的文件索引可供情境查詢；單獨安裝時仍可使用需求、經驗與圖片功能。
