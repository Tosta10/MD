# 完成標註與可還原變更

## 標註

用 `read_document` 取得目前雜湊。`mark_document` 的 completed 表示有工作完成依據，pending_delete 表示候選待刪除；reason 與 evidence 記錄理由及成果，可填 replacementId。

標註保存在本機，不修改來源 MD。只有使用者確實確認該候選時才設定 confirmed。檔案改變後舊標註會過時，需重新核對。授權或套件文件可以標註，但不經一般刪除流程處理。

## 提案與套用

1. 整合由 Codex 比對來源、保留獨有內容並提供完整目標文字。新附件以 create 操作指定 rootId 與相對 MD 路徑。
2. `create_change_plan` 建立 write／create／delete 操作；既有文件帶目前 expectedHash。同一批更新所有受影響引用。
3. 刪除需 pending_delete、完成依據及 confirmed 均成立。沒有取代文件時也要說明完成且不再需要的理由；舊日期本身不是刪除依據。
4. `read_change_plan` 以 operationIndex 查看各項差異；長內容以 offset 續讀，不把片段視為全文。具體方案已獲授權後用 `apply_change_plan(confirm: true)`；受影響文件會即時更新索引，再核對成果。
5. `restore_change_plan(confirm: true)` 還原指定批次。後續檔案被改過時停止，不以舊備份覆蓋新內容。

章節修改使用 `propose_section_edit`，必須先用 `read_document_section` 核對來源；移動/改名用 `create_move_plan`，顯示入站與出站引用修復。合併用 sourceDocuments 鎖定所有來源版本，保留獨有內容及取捨，不在提案套用前把來源標為已被取代。

刪除或移動前執行一次成功索引，若發現未索引檔案、不可讀來源或新引用則停止。讀寫範圍以已加入根目錄為準；只保證已加入範圍及支援 Markdown 語法的引用。操作失敗會嘗試還原已寫入項目；applying、recovery_required 或 failed 批次可走還原流程核對每項實際 hash。若有後續衝突，回報具體檔案，不宣稱整批已還原。
