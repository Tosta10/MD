# 編輯、覆蓋與復原

讀取目前 hash 後建立方案，寫入不直接覆蓋其他工作。annotate_document 可原子保存標註與分類；待刪除標註仍是旁註，需完成／取代依據。

## 文件操作

- create_change_plan：write／create／delete；既有來源帶 expectedHash。read_change_plan 按 operationIndex／offset 比較。
- propose_section_edit：先讀 section ID 及 hash，保留其他正文。
- create_document_plan(action: replace)：values 內提供 documents:[{id,hash}]、search、replacement。此版採字面比對，不執行任意 regex。
- action: metadata：提供 documentId、expectedHash、fields 純量欄位，保留其他 frontmatter 與換行；複雜 YAML 不能安全修改時回原文編輯。
- action: split：提供 routerContent、attachments:[{relativePath,content}]，核對所有來源區塊去向。
- create_move_plan：修復已索引的入站／出站 Markdown 引用，保留文件 ID。

## 整合與拆分

sourceDocuments 鎖定所有來源版本。review_document(action: clauses) 取得內容區塊 ID；set_merge_coverage 必須完整列出來源。

原文在新成果中完整保留的區塊會自動核對。未保留區塊提供 clauses:[{id,resolution,target,reason}]：resolution 為 replaced 或 discarded；取代內容須存在於成果，且兩者都要有理由。這個紀錄讓取捨可審查，不代表程式能證明語意等價。

多來源合併及路由拆分沒有完整覆蓋就不能套用。不要把字詞摘要當成完整內容；沒有處理完時保留來源。

## 套用與復原

具體方案已授權後 apply_change_plan(confirm:true)；有有效自治政策時可用 apply_maintenance_plan。版本、引用及覆蓋檢查依然執行。restore_change_plan 還原指定批次，後續已修改時回報衝突。

刪除需 pending_delete、完成依據及 confirmed。刪除／移動前需要成功索引；範圍外或未支援語法的引用不在保證內。來源及 journal 保留於批次；補償失敗用 recovery_required 流程核對，不宣稱整批已恢復。此版不自動永久清除。
