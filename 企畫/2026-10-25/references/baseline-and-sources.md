---
document_type: evidence_index
revision: 1
status: proposed
updated: 2026-10-25
---

# 現況、Thariq 方法與來源

## B-01｜盤點範圍與結論界線

依 2026-10-25 的 `插件/src/`、`public/`、技能及測試原始碼進行只讀分析。沒有為本企畫執行產品測試、使用者資料掃描或效能基準；現有測試檔僅用於了解覆蓋範圍。以下缺口是程式分析所得，延遲、耗用與實際誤報率尚未量測。安裝快取可能與開發來源不同，升級前需記錄兩者版本及 build hash。

現有優點應保留：限定資料夾、跳過範圍外連結、受管與授權文件保護、原文旁註、SHA-256 核對、批次預覽、失敗補償、還原及需求變更後撤銷既有驗收。

## B-02｜理解工作台的實際缺口

以下連結相對於本企畫資料夾；行號為盤點當時的位置。

| ID | 現況依據 | 問題與影響 | 優先級 |
|---|---|---|---|
| I-01 | [core.mjs:368](../../../src/core.mjs#L368) | query 可空白；無數量、篇幅上限或排序。空查詢回傳所有有效專案及個人經驗 | P0 |
| I-02 | [core.mjs:371](../../../src/core.mjs#L371) | 單一字串 includes；appliesWhen 只參與字詞搜尋，notWhen 不參與排除。尚無真正適用性判斷 | P0 |
| I-03 | [core.mjs:353](../../../src/core.mjs#L353) | 修改已確認經驗可沿用舊狀態與證據；沒有 expectedRevision、歷史版本或更新衝突控制 | P0 |
| I-04 | [core.mjs:392](../../../src/core.mjs#L392)、[tools.mjs:25](../../../src/tools.mjs#L25) | UI 經驗刪除是直接移除；沒有 AI 對應的刪除、垃圾桶與還原流程 | P0 |
| I-05 | [server.mjs:29](../../../src/server.mjs#L29) | 網頁 state 一次回傳全部任務與經驗；這是網頁資料載入，不等於每次 AI 都閱讀全部經驗 | P0 |
| I-06 | [core.mjs:333](../../../src/core.mjs#L333) | 有任務與證據文字，未建模來源版本、可重現案例、獨立驗證及遷移測試 | P1 |
| I-07 | [core.mjs:353](../../../src/core.mjs#L353) | 沒有領域包、產品版本、來源類型及知識依賴關係 | P1 |
| I-08 | [core.mjs:327](../../../src/core.mjs#L327) | 文件檢索雖有 6 筆預設、12 筆上限，仍掃描全部 plain；無章節索引與整體上下文預算 | P1 |

## B-03｜MD 管理台的實際缺口

| ID | 現況依據 | 問題與影響 | 優先級 |
|---|---|---|---|
| M-01 | [core.mjs:62](../../../src/core.mjs#L62)、[core.mjs:106](../../../src/core.mjs#L106) | 通用 JSON records；列表先讀全類內容，再逐份取標註與分類，缺少可索引欄位與 SQL 分頁 | P0 |
| M-02 | [core.mjs:115](../../../src/core.mjs#L115) | 全量讀取、雜湊、解析；沒有增量監看、工作進度或取消，主事件迴圈仍有同步 IO | P1 |
| M-03 | [core.mjs:127](../../../src/core.mjs#L127)、[core.mjs:155](../../../src/core.mjs#L155) | 讀取失敗項不在 visited，後續可能移除舊索引；不能將「讀不到」視作「已刪除」 | P0 |
| M-04 | [core.mjs:84](../../../src/core.mjs#L84)、[core.mjs:146](../../../src/core.mjs#L146) | 單一 rootId 無法穩定表達父子重疊範圍；分次掃描可能改寫歸屬 | P0 |
| M-05 | [core.mjs:111](../../../src/core.mjs#L111)、[core.mjs:393](../../../src/core.mjs#L393)、舊版 app.js:62（已移除） | 自動完成、人工標註、總數與篩選使用不同條件，可能出現「顯示完成但篩不到」 | P0 |
| M-06 | [core.mjs:170](../../../src/core.mjs#L170) | 五原則為固定句型與長度門檻；相似只抓完全重複，無誤報處置與版本化審核 | P1 |
| M-07 | [core.mjs:393](../../../src/core.mjs#L393)、[server.mjs:26](../../../src/server.mjs#L26) | summary 呼叫全量 audit，health 也呼叫 summary；簡單探測會做內容分析 | P0 |
| M-08 | [server.mjs:29](../../../src/server.mjs#L29)、舊版 app.js:28（已移除） | state 打包文件及全部方案，前端又取一次列表；refresh 成本與資料量一起增加 | P0 |
| M-09 | [core.mjs:243](../../../src/core.mjs#L243) | 每份方案重讀所有已索引 MD 檢查引用，即使沒有刪除；沒有入站引用圖 | P1 |
| M-10 | 舊版 app.js:109（已移除）、舊版 app.js:139（已移除） | 合併只選目前分頁 2–8 份；候選標註先於套用寫入，取消方案不會自動撤回 | P0/P1 |
| M-11 | [core.mjs:213](../../../src/core.mjs#L213) | 只有整檔 write/create/delete，缺段落 patch、移動、改名與引用修復操作 | P2 |
| M-12 | 舊版 app.js:119（已移除） | 套用後無論改幾份都重掃全部範圍 | P1 |
| M-13 | [core.mjs:303](../../../src/core.mjs#L303)、[core.mjs:314](../../../src/core.mjs#L314) | 補償失敗記為 failed，但 restore 不接受此狀態；缺逐操作修復日誌與 recovery_required 流程 | P0 |
| M-14 | 舊版 app.js:45（已移除）、舊版 app.js:158（已移除） | 全畫面重繪、建議全渲染、查詢競態、草稿可能丟失；切換合併目標會直接置換內容 | P1 |

## T-01｜Thariq 技巧如何轉成產品設計

使用者已於本對話貼上完整技巧整理。下列五篇作者原始文章已實際開啟；方法轉成插件功能的部分是本企畫的設計延伸，不是原作者發表的插件架構。

| 方法 | 插件中的產物與使用時機 | 來源 |
|---|---|---|
| Blind Spot Pass | 高不確定任務建立未知項、可能後果與查證方式 | S1 |
| Brainstorm / Prototype | 偏好不明時比較少量差異明確的原型，保存選擇 | S1 |
| Interview | 缺資訊會改變成果時，先問最有影響的問題 | S1 |
| References | 保存真實作品、原始碼或規格的版本與採用特徵 | S1 |
| Implementation Plan / Notes | 可視計畫與決策摘要；需求更動後重估影響 | S1 |
| Pitches / Explainers / Quizzes | 成果可審查；人類理解測驗與 AI 能力評估分開記錄 | S1 |
| Gotchas、精簡 skill | 從真實失敗整理具體陷阱，細節按需載入 | S2 |
| 從 AI 角度設計工具 | 明確輸入與有界結果，搜尋後詳讀，不增加大量重複工具 | S3 |
| 簡化上下文 | 刪除重複規則，以版本與案例檢驗效果，不套用固定刪減百分比 | S4 |
| Builder / Verifier | 僅對值得獨立驗證的任務啟用，保留角色與成本 | S5 |

S1 的八法、S2 的 gotchas 與漸進揭露、S3 的工具設計、S4 的實驗條件、S5 的動態協作均有原文依據。S4 報告的「超過 80%」為特定 Claude 系統提示的內部實驗，不能視作所有模型的成效保證。S5 也明確指出多代理可能增加成本。

使用者材料中的 **「HTML is the New Markdown」訪談日期與逐字內容**、**「Thin Prompts, Thick Artifacts, Thin Skills」作為 Thariq 原話**，本輪沒有獨立核實；以使用者提供的設計方向採用，不寫成已查證引述。保留可視化成果作人類介面，AI 仍讀取相同來源的結構資料，並非全面把 MD 轉成 HTML。

## S-01｜已查閱的第一方資料

以下連結直接支持上述方法或技術邊界；擷取日為 2026-10-25。

- **S1** [Thariq：Finding your unknowns](https://claude.com/resources/articles/a-field-guide-to-claude-fable-finding-your-unknowns)：八種探索、決策及交付方法。
- **S2** [Thariq：How we use skills](https://claude.dev/blog/lessons-from-building-claude-code-how-we-use-skills/)：有價值的陷阱知識、條件式讀取與避免過度規定。
- **S3** [Thariq：Seeing like an agent](https://claude.dev/blog/seeing-like-an-agent/)：工具形狀應配合模型能力，搜尋與揭露方式需實測。
- **S4** [Thariq：The new rules of context engineering](https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/)：精簡規則與版本限定的效果。
- **S5** [Thariq / Sid：A harness for every task](https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/)：按任務選擇動態流程與成本限制。
- **S6** [OpenAI：Skills](https://developers.openai.com/plugins/concepts/skills)：skill 說明工作方法，MCP 提供資料與受控動作；指令按匹配載入。
- **S7** [OpenAI：Package your plugin](https://developers.openai.com/plugins/build/plugins)：portable manifest、MCP 及平台擴充；本機來源的可用性依宿主而異。
- **S8** [SQLite FTS5](https://www.sqlite.org/fts5.html)：全文索引、排名、trigram 及分詞器；不代表直接具備完善中文語意搜尋。
- **S9** [MCP Tools 規格](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：工具結構與結構化回傳。業務搜尋的 cursor、預算與權限仍由本插件定義。
- **S10** [W3C：Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)：WCAG 2.2 的指標目標尺寸與例外；本產品另採觸控 44px 的設計目標。

所有效能門檻、資料契約、UI 配置與分期均為本企畫建議，不是以上來源保證的成績。
