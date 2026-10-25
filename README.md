# MD 管理台與理解工作台 v2

Windows 本機工作台，使用 Node.js 24 以上。包含實際 UI、兩個獨立 MCP 插件、原始碼與隔離測試；網頁本身不呼叫模型 API。

## 開啟與更新

雙擊 [開啟工作台.cmd](開啟工作台.cmd) 開啟整合介面。也可開啟 [MD 管理台](md-manager/開啟工作台.cmd) 或 [理解工作台](insight-workbench/開啟工作台.cmd)。啟動器會核對版本和資料目錄，避免誤開仍在運行的 v0.1 服務。

Codex 本機來源清單在本專案的 `.agents/plugins/marketplace.json`；從本機來源更新/重新安裝兩個插件，再於新對話使用。安裝快取不直接修改；目前對話的舊工具列表不會因 build 自動替換。其他 MCP 宿主可參考封裝的 mcp.json，仍需個別驗證相容性。

第一次使用，在「管理範圍」加入完整資料夾路徑，再按「索引新增與變更」。原有 MD 留在原位置。個人 skills 需另外加入；不自行加入其他磁碟或讀取所有歷史對話。

## MD 管理台

- **增量索引**：初次讀取來源；一般暖掃描未變檔案不重讀/重解析。可查看階段、已處理數、變更數及錯誤，並取消背景工作。
- **範圍監看**：在管理範圍啟用；僅此服務運行期間有效，重開後重新啟用。事件去抖後索引該範圍；手動索引用於對帳。監看未提供永久排程。
- **文件工作區**：名稱/路徑與狀態篩選、每頁50／100／200筆、上一頁／末頁／跳頁、整頁及全部搜尋結果選取（最多2,000份）、取消選取、跨頁選取、原文/章節/編輯/入站引用。草稿在此頁面記憶體保留，關閉頁面前請先建立方案。
- **整理待核對**：五原則候選、精確重複、抽樣字詞近似、失效 Markdown 引用。可採用、忽略、延後或記錄處理；AI 審核需理由與依據。
- **文件整合**：跨頁選2–8份，核對原文，填整合後內容及每份來源的保留去向，再預覽方案。來源本輪保留；沒有模型時不假裝自動語意合併。
- **移動/改名**：選文件後建立方案，修復已索引的 Markdown 行內/定義式相對連結，保留文件 ID；不支援的連結寫法會停止。支援範圍外引用不在保證內。
- **段落修改**：MCP 可按 section ID 建立局部修改方案；來源 hash 改變就停止。未修改內容的 BOM/換行保留。
- **待刪除/回收**：先標註理由、依據、完成與確認，再預覽/套用移除。來源原文保存在批次紀錄，可在回收與修復頁還原；沒有自動永久清除。

刪除與移動前需成功索引，會核對新出現文件、來源版本、已知入站引用及實體路徑。不可讀來源、未索引文件或衝突會停止。授權、受管及硬連結來源維持保護。單檔分析上限2MiB；非 UTF-8 文件保留並回報。

字詞近似採有配對上限的候選搜尋，不代表語意重複、矛盾或可以刪除。實際完成、用途及獨有內容需由 AI/使用者核對。只處理已加入範圍與支援語法；Wiki-link、HTML連結、外部系統引用與完整 anchor 校驗尚未涵蓋。

## 理解工作台

**本次任務**保存目的、限制、交付物、未知、假設、環境、完成條件及本次選用方法。修改既有任務需 expectedRevision；修正需求後既有驗收降為未驗證。八種 Thariq 方法可選，不強制每次跑完。

**知識與經驗**保存單一事實、偏好、方法、決策、失敗案例或陷阱。每筆有來源、適用情境、平台/精確版本條件、可靠程度、保留狀態及歷史版本。修改已確認內容或來源後需複核，舊證據留於歷史。可封存、待刪、移入回收區及還原。

**領域來源**維護薄領域包的名稱、版本、來源、適用情境與陷阱。此版為人工維護來源索引；尚未自動下載文件、更新整個領域知識或進行模型訓練。

**成果回報**綁定任務版本與證據位置，列通過/全部條件、缺口及實際觀察。沒有基準或遷移測量就回 not_measured；不以卡片數量或模型自述當成理解力提升百分比。

**視覺參考**只讀主動加入的 PNG/JPEG/WebP，每張最多8MiB；比較後保存用途與理由。保存比較不會自動生成全域偏好。

## AI 按需讀取

1. `search_knowledge(query 或 taskId)`：先回摘要，最多6筆、硬上限12筆；預設文字回應約3KiB。空查詢拒絕。
2. 僅 active/validated/未失效且明確條件匹配的內容進一般結果；缺版本、排除文字或候選狀態放 uncertain 區。自由文字適用條件仍需 AI 判讀。
3. `read_knowledge(id, revision, offset)`：正文每次最多8KiB。相同執行帶同一 runId，累計48KiB，重複片段回 alreadySent；無 runId 時僅有單次限制。
4. `find_context` 搜尋文件章節，摘要最多12KiB；長原文與方案按頁/offset 詳讀。列表只回 metadata。
5. `propose_knowledge_change` → `read_knowledge_change` → `apply_knowledge_change`／`restore_knowledge_change` 可管理知識批次；單筆保存與狀態工具也有 revision 核對。

插件只控制經自身工具傳出的內容；不能替宿主刪除已進對話的內容，也不保證每次自動啟用。傳給 Codex 的片段會進該次模型脈絡。未接 embedding、外部模型或雲端同步服務。

## 資料與遷移

預設資料目錄為使用者家目錄的 `.codex-md-workbenches/`；也可用 CODEX_WORKBENCH_HOME 指定。兩插件使用同一目錄才會共用資料。

- `workbench.sqlite`：保留的 v0.1 資料庫。
- `workbench-v2.sqlite`：v2 主資料庫，含索引、版本、方案、回收內容及證據。
- `assets/`：主動加入的圖片。

v2 首次啟動且存在舊 DB 時，使用 SQLite 的一致快照建立獨立新版 DB，再升級索引與紀錄。原 DB 保留；舊 confirmed 會帶原始來源與證據，降為 needs_review 待核對。沒有舊 DB 時直接建立空資料庫。

**切換後請使用 v2 入口。舊服務在快照之後的新寫入，不會自動合併到 v2。** 備份使用一致 SQLite 備份工具，或關閉所有相關服務後複製 DB、WAL/SHM 與 assets。回到舊版也不會自動帶回 v2 的新紀錄；不要直接刪除新版 DB 來嘗試回滾。

檔案替換採 temp-write/flush/rename，DB 保存 before/after 與逐項 journal；同資料庫套用/還原有跨進程鎖。其他編輯器或不同 dataDir 不受此鎖控制；衝突會停止，無法保證跨軟體多檔案原子交易。部分補償失敗進 recovery_required，提供核對與還原。

## 開發與驗證

`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test`。`src/workbench.mjs` 為 v2 服務；`src/core.mjs` 保留基礎檔案引擎與相容性測試；`src/knowledge.mjs` 管理知識與證據；`src/review.mjs` 建立有界近似候選。UI 來源為 `public/app-v2.js`、`workbench.css`。

`runtime/`、插件內 public 及 manifests 均由 build 產生，不直接編輯安裝快取。舊版前端與離線 UI 示意已移除；正式介面只使用上述 UI 來源。建置只更新本專案目錄，不修改上層專案的來源清單。

隔離瀏覽器流程：`node tests/v2-browser.mjs` 及 `node tests/ui-usability.mjs`。需先將 `WORKBENCH_PLAYWRIGHT_ROOT` 設為已安裝 Playwright 的 node_modules 目錄，並安裝 Microsoft Edge。大量文件量測：`WORKBENCH_BENCH_COUNT=10000 node tests/benchmark-v2.mjs`（PowerShell 先設 `$env:WORKBENCH_BENCH_COUNT`）。結果位於 `artifacts/v2/`；實測不等於所有硬體或內容分布的保證。

完整設計與待辦見 [v2企畫入口](企畫/2026-10-25/README.md) 及 [實作進度](實作進度.md)。第三方聲明見 THIRD-PARTY-NOTICES.txt。
