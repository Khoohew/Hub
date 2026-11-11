# AI HTML Gallery

這是私人動畫倉庫 `ChewchewHan/AI-HTML-Archive` 的公開畫廊介面。

- 本倉庫只存放畫廊頁面程式，不包含動畫 HTML、目錄資料或 GitHub Token。
- 原始動畫與 `catalog.json` 仍保存在私人倉庫。
- 畫廊在你的瀏覽器中直接透過 GitHub API 讀取私人倉庫；沒有 Cloudflare、第三方圖床或外部前端 CDN。
- 任何人都可以開啟這個公開頁面，但只有持有該私人倉庫有效讀取權限 Token 的人才能載入作品。

## 使用方式

1. 在 GitHub 建立 Fine-grained Personal Access Token。
2. Resource owner 選擇 `ChewchewHan`。
3. Repository access 選擇 **Only select repositories**，只勾選 `AI-HTML-Archive`。
4. Repository permissions 設定 **Contents: Read-only**（Metadata 通常會自動包含）。
5. 建議有效期設為 30 天。
6. 開啟畫廊網址，在連接頁輸入 Token。

不要把 Token 貼到聊天、Issue、程式碼、網址或公開文件。畫廊不會將 Token 寫入 localStorage、sessionStorage、Cookie 或 URL；Token 只存在目前頁面的 JavaScript 記憶體中。登出或關閉頁面會清除本頁持有的 Token。

## 安全與隱私說明

這是一個**公開的靜態網站**，不是私有網站。公開的是畫廊介面程式；私人動畫和目錄仍留在私人倉庫。沒有 Token 時，頁面不會顯示作品清單或讀取動畫。

輸入 Token 代表你信任目前載入的畫廊程式。Token 會由瀏覽器透過 HTTPS 直接傳送到 `api.github.com`，用於讀取指定私人倉庫。瀏覽器擴充功能、被入侵的裝置或未來遭竄改的公開頁面仍可能帶來風險。使用前可檢查本倉庫的程式碼；若懷疑 Token 外洩，請立即到 GitHub 撤銷。

動畫在隔離的 iframe（不授予同源權限）中預覽。作品若自行引用外部圖片、字體或腳本，瀏覽器仍可能連線到那些外部來源。

## GitHub Pages

在本倉庫的 **Settings → Pages**：
- Build and deployment：**Deploy from a branch**
- Branch：**main**
- Folder：**/ (root)**
- Save

部署完成後，GitHub Pages 會提供本畫廊網址。此設定只部署本公開倉庫，不會改變原始私人倉庫的可見性。

## 專案結構

- `index.html`：畫廊介面、GitHub API 讀取、搜尋篩選與動畫預覽。
