# 家庭資料庫：架構與維護說明

本文件是家庭資料庫前端的技術入口，供後續 ChatGPT、其他 AI 或開發者接手維護。正式程式位於本目錄，不再使用 V2 子目錄。

## 1. 專案位置與入口

- 網頁入口：`https://khoohew.github.io/Hub/apps/family/`
- 頁面：`index.html`
- 樣式：`app.css`
- 啟動程式：`src/main.js`
- 核心模組：`src/core/`
- GitHub 儲存介面：`src/storage/`
- 自動化測試：`tests/`
- 實際家庭資料：另一個私人倉庫 `Khoohew/Personal-Data-Manager` 的 `data/family/v1/objects/`

這是無建置步驟的原生 JavaScript ES Modules 靜態網頁，不使用 React、Vue 或外部資料庫伺服器。GitHub Pages 負責發布前端；瀏覽器直接透過 GitHub Contents API 讀寫私人資料倉庫。

## 2. 主要模組

### `src/main.js`
負責頁面初始化、表單事件、人物／關係／事件／附件／醫療紀錄的載入與呈現，以及呼叫儲存層。

### `src/core/`
- `id.js`：資料識別碼與時間工具。
- `validate.js`：家庭人物、親屬關係、事件及附件資料驗證。
- `relationship-index.js`：親屬關係索引。
- `tree-layout.js`：族譜視圖排版。
- `medical-validation.js`：醫療紀錄欄位驗證。
- `crypto.js`：舊版保險庫加密相容，以及附件獨立加密／解密。
- `backup.js`、`zip-store.js`：舊版加密備份功能模組；目前備份操作介面已隱藏，尚未列入新架構的正式驗收範圍。
- `vault-service.js`：統一資料存取介面；新資料預設明文，附件可單件加密。

### `src/storage/`
- `github-release-storage.js`：GitHub 私人倉庫 API、授權 Token 及舊版 Release 備份介面。
- `github-plain-contents-cache.js`：新架構主要儲存層，將每筆資料保存為獨立 JSON。
- `github-contents-cache.js`、`indexeddb-cache.js`：舊版相容模組，暫保留供檢查／後續清理，不代表新架構依賴它們。

## 3. 私人資料結構

每筆物件保存於：

`data/family/v1/objects/{scope}/{collection}/{recordId}.json`

目前使用的分類：

| scope | collection | 用途 |
|---|---|---|
| family | persons | 家庭人物 |
| family | relationships | 親屬關係 |
| family | events | 人生事件及家庭故事 |
| family | media | 附件索引與描述 |
| family | media-blobs | 附件二進位內容 |
| medical | health | 醫療文字紀錄 |

每個 JSON 物件包含格式版本、物件識別碼、分類、資料內容、版本號及更新時間。GitHub 檔案 SHA 用於更新／刪除時的版本控制。

## 4. 明文與附件加密

- 人物、關係、事件、生平故事及醫療文字：預設普通 JSON 明文。
- 附件：使用者逐件選擇是否加密；預設不勾選。
- 加密在瀏覽器本機完成，使用 PBKDF2-HMAC-SHA-256（600,000 次迭代）派生 AES-256-GCM 金鑰。
- 每件附件有獨立 salt、IV 及使用者密碼；密碼不寫入 GitHub。
- 加密只保護附件內容；附件名稱、MIME 類型、檔案大小、人物關聯及備註仍是明文。
- 忘記附件密碼無法解密。加密附件不能直接供 AI 讀取。
- 私人倉庫授權 Token 只留在目前頁面的 JavaScript 記憶體；鎖定或重新整理後需再次輸入。

## 5. 開發與檢查

GitHub Actions 工作流程位於 `.github/workflows/family-app-check.yml`。它會在家庭程式或工作流程檔變更時：
1. 使用 Node.js 22 檢查 `src/` 內 JavaScript 語法。
2. 執行 `tests/attachment-crypto.test.mjs`，測試附件加密往返、錯誤密碼拒絕及資料識別資訊驗證。

這些是基本自動化檢查，不等於瀏覽器端到端測試，也不等於完整功能驗收。

## 6. 目前已知驗收邊界

目前自動化測試覆蓋附件加密核心及 JavaScript 語法；人物、關係、事件、醫療紀錄、GitHub Token 權限、實際附件上傳／下載／刪除、跨裝置同步及行動裝置版面，仍需在真實瀏覽器及私人倉庫中逐項驗收。未完成真人驗收前，不應把本程式視為已正式驗收的成品。

## 7. 維護原則

- 正式修改直接提交 `main`，不建立額外開發分支或 PR，除非使用者另行要求。
- 不得把私人資料、Token、密碼或真實病歷放進公開的 Hub 倉庫。
- 不得把黃金或設備管理資料併入家庭資料模組。
- 變更資料結構時，先更新本文件及私人倉庫的 `data/family/README.md`。
- 刪除資料前先確認範圍，家庭資料以外的私人資料不可連帶刪除。
