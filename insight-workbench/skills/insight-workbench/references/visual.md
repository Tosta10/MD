# 視覺解構、實作與評價

import_visual_asset 接受明確提供的 base64 或已加入專案範圍內 path，避免在提示詞手寫二進位。保存原素材、hash、範圍與來源，單份8MiB。介面可擷取60秒內MP4/WebM的取樣影格。

list_visual_references 分頁找素材，read_visual_reference 讀總覽；PNG/JPEG 用正規化 rect 與 maxDimension 裁切／縮圖。WebP 的受控裁切需轉PNG，介面匯入會轉換。完整影片不是圖片輸入，AI 從時間軸選必要影格；圖片有共用讀取預算。

save_visual_record(kind,values) 的類型：
- observation：assetIds、observations、hypotheses、limitations、regions。區域為 title、assetId、rect、description、implementation；觀察與實現假設分開。
- recipe：stack、technique、parameters、gotchas、implementationRef、verification。描述布局、渲染層、材質、資源、參數及驗證條件，按技術棧分開實作。
- timeline：duration、frames:[{time,assetId}]、transitions。觸發、狀態、緩動及可中斷行為，有證據才記為觀察。
- visualEvaluation：implementationRef、dimensions、improvements、evidenceRefs。分開評價內容、布局、互動、可讀性、動態、效能及偏好。

更新帶id／expectedRevision。先做最小實現，再在目標環境擷取結果。單圖不能證明原始CSS、引擎配置或動態因果；沒有執行證據不得標為已實現。

compare_visual_pixels 在 environmentMatched:true 時以本機工作器量測PNG/JPEG。先對齊viewport、字型、內容及動畫狀態；像素相似不代表美觀或功能完成。保留最值得改善的項目與證據，將有條件的可重用結論轉成知識；修正循環有明確次數及成本上限。
