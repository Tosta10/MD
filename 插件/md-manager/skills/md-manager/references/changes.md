# 完成標註與可還原變更

## 標註

用 `read_document` 取得目前雜湊。`mark_document` 的 completed 表示有工作完成依據，pending_delete 表示候選待刪除；reason 與 evidence 記錄理由及成果，可填 replacementId。

標註保存在本機，不修改來源 MD。只有使用者確實確認該候選時才設定 confirmed。檔案改變後舊標註會過時，需重新核對。授權或套件文件可以標註，但不經一般刪除流程處理。

## 提案與套用

1. 整合由 Codex 比對來源、保留獨有內容並提供完整目標文字。新附件以 create 操作指定 rootId 與相對 MD 路徑。
2. `create_change_plan` 建立 write／create／delete 操作；既有文件帶目前 expectedHash。同一批更新所有受影響引用。
3. 刪除需 pending_delete、完成依據及 confirmed 均成立。沒有取代文件時也要說明完成且不再需要的理由；舊日期本身不是刪除依據。
4. `read_change_plan` 檢視修改前後。具體方案已獲授權後用 `apply_change_plan(confirm: true)`，再重新掃描與核對。
5. `restore_change_plan(confirm: true)` 還原指定批次。後續檔案被改過時停止，不以舊備份覆蓋新內容。

讀寫範圍以已加入根目錄為準。操作失敗會嘗試還原已寫入的項目；進程中斷的 applying 批次可用還原工具復原。若復原也發生版本衝突，保留紀錄並回報具體檔案，不宣稱整批已還原。
