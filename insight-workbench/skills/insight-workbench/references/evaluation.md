# 用量、評測及匯出入

context_run(action:status) 查看文字／圖片估計、剩餘預算與宿主回報。action:usage 以provider、model、requestId及可得的inputTokens、cachedInputTokens、outputTokens保存實際用量。未知不是零。

一般任務初始使用約1500–3000額外文字tokens。run預設6000估計tokens、48KiB及3張圖；圖片是像素啟發式預算，並非模型tokenizer。已開始操作的精簡完成回條可超出最後剩餘量，避免實際成功卻誤報失敗；開始下一項操作前仍查預算。

插件不能刪除已進宿主歷史的內容，也不掌握全部Codex訂閱帳單。工具schema、推理、輸出及其他工具另計；快取不等於上下文縮短。

evaluate_workbench(action:record,values) 保存caseId、arm:A/B/C、domain:md/knowledge/visual、model、settingsHash、datasetHash、artifactRef、passed、holdout及可得用量。report只比較相同模型／設定／資料集，列出配對保留題數與描述統計，不自動宣稱顯著提升。

knowledge_portability分批export；import檢查hash後建立候選方案，不覆寫原ID，來源有效性需再核對。外部來源與資產以定位保留，不冒充完整二進位備份。
