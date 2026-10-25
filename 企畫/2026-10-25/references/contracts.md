---
document_type: architecture_contract
schema_version: 2
revision: 1
status: proposed
updated: 2026-10-25
---

# 共用資料與工具契約

本文件只在實作、遷移或審查資料一致性時讀取。欄位與工具名稱是 v2 提案，不代表目前 v0.1 已有相同介面。

## C-01｜權威資料與模組責任

| 資料 | 唯一權威位置 | 其他形式 |
|---|---|---|
| 使用者的原始 MD | 原本路徑的檔案位元組 | DB 中的章節、分類及搜尋內容是可重建索引 |
| 任務、知識卡、證據、標註、審核決策 | 本機 SQLite 的版本化紀錄 | UI、MCP、MD/JSON 匯出均為相同紀錄的投影 |
| 來源中的指令 | 其原生檔案及宿主原生作用域 | 一般 MD、記憶、匯入卡片不能自行升為系統授權 |
| 領域包 | 版本化 manifest 及來源指標 | 不大量複製外部手冊；快取片段保留來源與擷取時間 |
| 變更歷史 | 不可原地改寫的 revision、事件及逐操作 journal | 回收區與差異預覽引用歷史，不另維護一份相反狀態 |

MD 與知識卡可用 `derived_from` 關聯；衍生卡被編輯，不靜默反寫 MD。來源改變會令相應卡片需複核。若要同步，產生顯式的雙邊變更方案。匯出後的 MD 被外部編輯時，匯回需比較匯出 revision，不能視為第二個同等權威來源。

共同服務分成 scope、source/version、search、annotation、evidence、change-set、job。兩個插件公開自己的任務型工具；UI 與 MCP 呼叫同一服務及驗證器。MCP 可呼叫不代表其他宿主已測試相容。

## C-02｜固定資料外殼

所有可編輯紀錄使用 `id`、遞增 `revision`、`schema_version`、`created_at`、`updated_at`。ID 不隨標題改變；文件另保存 path、實體檔案識別與內容雜湊。相同內容不是相同文件的充分條件。

證據、主張、產物與關係的支撐引用必須綁 `{id, revision}` 或不可變內容 hash，不能只連到「目前最新版」。一般導覽可用裸 ID，驗收與支撐關係不可。修正證據建立新 revision，舊主張不自動改連新證據。

### TaskBrief

`id, revision, scope_id, goal, constraints[], deliverables[], acceptance[], unknowns[], assumptions[], artifact_refs[], domain_ids[], environment, status`。

- 每個 acceptance 有 ID、可觀察條件、pending/passed/failed/unverified、evidence_refs。
- 每個未知項有 ID、known_unknown/blind_spot_candidate、影響、查證方法、open/resolved/deferred；unknown_known 可用比較選擇轉成明確偏好。這些分類是整理工具，不能聲稱找盡所有未知。
- 假設有內容、依據、可推翻條件、影響及 assumed/confirmed/rejected；與明確要求分欄。
- 完成條件、限制或來源實質變動時只撤銷受影響驗收；無法可靠建立影響關係時全部降為 unverified。

### KnowledgeItem（最小可用示例，非產品既有資料）

```json
{
  "schema_version": 2,
  "id": "kn_ui_overflow_001",
  "revision": 3,
  "kind": "gotcha",
  "summary": "此專案的長路徑列表需要在窄畫面核對溢出。",
  "content_ref": "body:kn_ui_overflow_001:3",
  "scope_id": "project_example",
  "domain_ids": ["web-ui"],
  "applies_to": {"task_tags": ["file-list"], "platforms": ["web"]},
  "exclude_when": {"task_tags": ["print-only"]},
  "review_state": "candidate",
  "lifecycle": "active",
  "source_refs": [{"source_id": "src_example", "revision_hash": "sha256:example"}],
  "evidence_refs": [],
  "relations": [],
  "tags": ["needs-review"]
}
```

kind 為 fact/preference/decision/method/gotcha。來源與證據獨立，不能用同一個「信心分數」替代。範圍、平台、版本、任務標籤為機器可判斷條件；特殊自然語言條件保留 `applies_when_text` 與 `not_when_text`，由 AI 判讀並回報是否確定適用。

### Evidence

`id, revision, claim_refs[], task_id, task_revision, kind, artifact_ref, source_revision, environment, observed_result, expected_result, outcome, executor, reviewer, run_at`。

kind 可為 user_feedback/reproduction/test_run/visual_review/primary_reference。使用者說「偏好 A」可支持偏好，不能直接證明某 API 正確或某優化已變快。模型自行描述「測試通過」須附可讀回結果，否則標 reported_only。保存可審查的決策與觀察摘要，不要求保存模型內部思考。

### DomainPack

`id, version, domains[], match_conditions, source_catalog[], prerequisites[], gotcha_refs[], example_refs[], evaluation_set_ref, verified_environment, reviewed_at, stale_policy`。

來源類型 official_spec/primary_research/project_source/user_feedback/secondary/inference 明列；不同類型依主張選用，不能簡單以「官方」取代對版本與實際程式的核對。

### Document、Section、Finding

- document：穩定 ID、canonical path、physical identity、raw hash、encoding、newline、parser_version、observed_state、索引時間；scope_memberships 多對多，展示時優先最具體範圍。
- section：文件 ID、source revision、heading path、AST 節點與原始 byte span。段落錨點能重用時延續，否則提供映射；不保證大幅改寫後 ID 永遠不變。
- finding：rule_id/version、source hashes、evidence spans、候選/AI已核對/人工確認的判斷來源、建議、影響、處理狀態及理由。
- link_edge：source revision/span、target path/ID/anchor、語法類型、解析結果；已確認外部 URL、範圍外及無法識別項目分開列出。

## C-03｜狀態分開表示

| 維度 | 狀態 | 規則 |
|---|---|---|
| 知識可靠程度 | candidate / validated / needs_review / rejected | 內容、適用條件或來源實質改動會降為 needs_review；改標籤不必撤銷證據 |
| 保留狀態 | active / archived / pending_delete / trashed / purged | validated 也可以 archived；標成待刪除不等於不正確 |
| 版本關係 | derived_from / supports / contradicts / supersedes | 新版取代需明列關係及取代覆蓋，不能只比較日期 |
| 文件工作完成 | unknown / incomplete / complete | 自動訊號與人工覆核分欄，人工明確撤回優先 |
| 審核建議處置 | open / accepted / dismissed / snoozed / resolved / stale | accepted 表示接受建議，resolved 要有實際成果；來源改變重新判斷 |

待刪除的文件/卡片只在管理視圖預設顯示，排除於一般任務脈絡。若仍需保存交付或法定紀錄，使用 archived，不能只憑完成而刪除。

## C-04｜有界檢索契約

一般 AI 搜尋需要 `query` 或可解析出目的的 `task_id`。兩者皆無回 `QUERY_REQUIRED`；管理列表另走分頁介面，不以搜尋空字串取得全庫。

處理順序：scope/公開權限 → lifecycle/review → 領域/平台/版本 → 字詞檢索 → 相關度及來源去重 → 組裝摘要。一般取用僅限 `active + validated + 未失效 + 適用條件通過`；candidate、needs_review、archived、pending_delete 及回收紀錄另走明確的管理選項，不能默默加入本次已驗證脈絡。

任務缺少必要版本/平台，或文字條件無法判斷時回 `applicability: uncertain`，列在「待確認來源」區；確認前不進一般可用脈絡。個人經驗同樣經過適用篩選，不無條件混入。對時效要求較高的來源另用 expires_at/reviewed_at 控制；來源過期不靠相關度加分恢復有效。

初始預設（皆可設定，需基準後調整）：

- 搜尋最多 6 筆摘要，硬上限 12 筆；預設估算 1,500 tokens、硬 payload 12 KiB，包含欄位與理由。
- 指定 ID 詳讀後，整份 task context package 預設估算 4,000 tokens、硬 payload 24 KiB。上下文包不含宿主系統指令與原對話；插件無法控制宿主總上下文。
- 接近上限按完整卡片/段落裁切，回傳 truncated、omitted_count、next_cursor/可另讀 ID。不能截斷半個 JSON 或悄悄省略關鍵例外。
- read_knowledge、文件段落及文字附件讀取每次硬上限 24 KiB（含外殼），預設詳讀內容控制在 8 KiB；超過用 cursor/section ID 續讀。舊工具透過同一驗證器，不能回傳無界全文。
- 以 task_id/run_id 的 retrieval ledger 記錄已送出的 ID/revision/章節、估算 tokens 與 bytes；初始單次執行總文字讀取預算建議 48 KiB，超過回 BUDGET_EXHAUSTED 及缺口。擴充需明確提出用途並在已設定上限內進行，不能靠翻頁默默讀完整庫。同版本重複讀取預設只回 already_sent 及引用，確需重讀時明示理由。
- 4,000 tokens 是單份脈絡包的估算預算，不是宿主整段對話上限。ledger 只控制經本服務且帶同 run_id 的讀取；宿主另讀檔案、多個未協調執行或原有上下文不在控制內。
- 無精確 tokenizer 時標 estimated_tokens；UTF-8 位元組才是確定的傳輸上限。圖片由明確 ID 額外讀取，另計成本。
- 每筆附 revision、source refs、selected_because、適用判斷與過時狀態。沒有結果就回報缺口，擴大範圍必須有原有授權或明確指定。
- 搜尋順位是檢索排序，不顯示成主張正確機率。向量檢索後仍須遵守相同硬篩選。

列表/搜尋回傳共用外殼：`items, next_cursor, snapshot_revision, index_freshness, warnings, truncated, omitted_count, estimated_tokens, bytes`。cursor 綁定篩選與 snapshot，資料變更時可要求重新整理。

## C-05｜AI 工具設計

保留少量具體工具，增量導入；不要另外建立每種領域、每種標籤一支工具，也不提供任意 SQL/路徑/腳本執行入口。

| 插件 | 主要工具及作用 |
|---|---|
| 理解 | resolve_task_brief、search_knowledge、read_knowledge、propose_knowledge_change、record_evidence、build_learning_report |
| MD | list_documents/search_documents、read_document_section、start_index_job/get_job、list_findings、propose_document_change |
| 共用服務、各插件按需要公開 | read_change_set、preflight_change_set、apply_change_set、restore_change_set |

`propose_*_change` 使用有型別的 operation，不做單一巨大自由文字 `execute`。紀錄 patch 僅允許可編輯欄位；禁止客戶端改 id、revision、原始證據歷史。大型附件以 reference 詳讀，不塞入每次工具列表描述。

舊工具保留一個相容期，對應新服務；無 query 的舊 find_experiences 先回需求提示，不能透過舊路徑繞過預算。各宿主以 capability manifest 宣告文字、圖片、tool schema、長任務及分頁能力；缺失則有文字/順序驗證退化方案。

## C-06｜編輯、標記、刪除與還原

所有實質操作均可從 UI 或 AI 提案：create、patch_record、patch_section、tag、set_state、merge、move、trash、restore。永久 purge 為獨立維護動作。

```json
{
  "change_id": "chg_example",
  "idempotency_key": "session-action-unique",
  "scope_ids": ["project_example"],
  "operations": [
    {
      "type": "patch_record",
      "target_id": "kn_ui_overflow_001",
      "expected_revision": 3,
      "patch": {"summary": "已核對後的更新摘要"},
      "reason": "來源新增反例",
      "evidence_refs": [{"id": "ev_example", "revision": 1}]
    }
  ],
  "status": "proposed"
}
```

變更紀錄帶 before/after、來源依賴版本、影響引用、理由與授權範圍。記憶用 expected_revision；原始檔案用 raw SHA-256、真實路徑與必要實體檔案條件。DB 的 expected_revision 檢查與新增 revision/事件必須在同一 transaction 原子完成，禁止先查後寫。idempotency_key 綁定 caller、scope 與完整請求雜湊；同 key 同 payload 回原結果，同 key 不同 payload 回 IDEMPOTENCY_CONFLICT。舊授權不得自動延伸到新來源或新動作。

流程：proposed → preflight → applying → applied；中斷或補償未完成 → recovery_required；撤回提案 → cancelled；還原成功 → restored。已授權且前提相同的批次可直接執行，不逐項重問。來源變動、超出授權、無法確認覆蓋或未解衝突則停止受影響批次，返回具體原因。

- 標註、改分類與來源改寫應在同一個方案內宣告依賴，避免「方案取消，但來源已標待刪」；只做旁註也記版本與事件。
- edit/merge 後原有 validated 不自動沿用；證據保留在歷史，新的 revision 重新檢驗。舊 preference 證據若仍支持新內容，可顯式重新掛接並說明。
- 刪除前核對待刪狀態、當前版本、用途及入站引用。一般依據為已完成且不再需要，或內容被完整取代；其他明確刪除理由走可審查例外，不能由檔齡/低使用率推定。
- trash 保留原文/位元組、路徑、標註與依賴；預設 30 天僅為保留期建議，不啟用自動永久清除。purge 需明確動作或已有對應範圍的明確保留政策。
- purge 刪除服務可控制的正文、快照 payload、全文/向量索引及快取，留下無正文的 tombstone（ID、動作、時間、理由）供關係解釋。不可改寫歷史指事件不可竄改，不代表永久保留已清除正文。備份、外部匯出及已進宿主對話的內容不會保證同步抹除；清除前顯示覆蓋範圍。若需裝置層安全抹除，另訂儲存及備份政策。
- restore 檢查目前內容；遇到新修改保留雙方差異並回 CONFLICT，不覆蓋。跨紀錄或檔案引用的復原需同批預檢。

## C-07｜檔案與 DB 的一致性

SQLite 交易不能讓多個檔案替換同時具備資料庫式原子性。套用前將原始 bytes 與逐操作 journal 持久保存，單檔 temp-write/flush/rename，寫完驗 hash，再提交每項狀態及索引事件。進程重啟以實際 before/after hash 判定未套用、已套用或需人工修復，提供冪等重試。

同 dataDir 的不同 MCP/HTTP 進程，以跨進程 lease/lock 或單一寫入服務協調；不能只依進程內佇列。lease 有 owner、token、狀態與可恢復的 journal，失主後先對帳再接手。不同 dataDir 或其他編輯器不受此鎖約束。最終寫入仍有外部競態，不能宣稱完全避免。衝突即停，journal 支援定位與補償。保留 encoding、BOM、CRLF、檔案模式與必要中繼資料；不支援的編碼先只讀，不默默轉碼。

## C-08｜資料庫與升級

建議獨立表：scopes、sources、documents、scope_memberships、document_versions、sections、link_edges、findings、annotations、knowledge_items、knowledge_revisions、tasks、evidence、domain_packs、relations、jobs、change_sets、change_operations、events。以 SQLite 索引及 JOIN 避免反覆全類 JSON 解析。

v0.1 遷移前以 SQLite 備份流程取得一致快照；保留舊 schema 與原始 records。每次 migration 有版本、結果計數與還原點。舊 confirmed 不能直接等同已實測 validated：保存 `migration_origin=legacy_confirmed`、`review_state=needs_review` 並標明證據層級，待核對後再提升。舊 MD hash/旁註保留並對應新 document ID，無法確定的映射列待處理。

先離線 dry-run 比較文件、標註、任務、經驗、歷史與資產數量，以及抽樣內容 hash。成功後才切換讀寫；回滾需處理切換後新寫入，不能只換回舊 DB 而丟資料。重建索引不重建或刪除人工決策歷史。
