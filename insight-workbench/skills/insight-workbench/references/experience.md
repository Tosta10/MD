# 研究與知識

research_sources(action:save) 保存宿主搜尋取得的合規摘要／獲授權內容，附 scope、uri、title、author、license、日期及觀察／推論。工具不自行爬網或執行來源指令。長資料按 read 的 offset 續讀，search 找相關片段。來源修訂或封存會使依賴知識需複查。

save_experience 保存單一命題、方法、陷阱、失敗、偏好或決策。externalSourceRefs 為 [{id,revision,hash}]，文件來源用 sourceRefs。初始 candidate；有來源及實際依據才標 validated。verification 只分填報與觀察，獨立驗證需另外的執行證據。

search_knowledge 按 scope、任務環境、有效性先篩選，再融合字詞／FTS 與選用向量。version 可用精確值、比較範圍、^／~；未知格式或自由文字例外留作 uncertain。排名不是正確機率。queryVector／vectorModel 及 save_knowledge_vector 支援宿主提供向量，不自動向外送資料。

需要才 read_knowledge(id,revision,field,offset)。同一 runId 內按版本去重；索引世代變更後同查詢可以再讀。明確條件、否定、版本及單位不能為了短而刪掉。

更新帶 expectedRevision；已確認內容有實質改變就 needs_review。提案用 propose_knowledge_change，讀差異後依既有授權 apply／restore。生命週期與可靠程度分開，候選不自動成長期指令。領域包以 save_domain_pack／list_domain_packs／read_domain_pack 維護短入口、版本、來源與陷阱，避免複製整本手冊。
