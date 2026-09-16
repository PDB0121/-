# 今天吃什麼 — 訂餐 App

從 Claude Artifact 版本轉換而來的獨立網站，前端用 Vite + React，資料存在 Vercel KV（所有人共用同一份），菜單辨識透過伺服器端呼叫 Claude API（金鑰不會外流到瀏覽器）。部署到 Vercel 之後，任何人點連結就能用，不需要 Claude 帳號或登入。

## 專案結構

```
src/MealOrderApp.jsx     所有畫面與邏輯（表單、成員儲值、結算…）
api/state.js             讀寫共用資料（成員/表單/交易/設定）— 存在 Vercel KV
api/recognize-menu.js    上傳菜單照片辨識品項 — 伺服器端呼叫 Anthropic API
```

## 部署到 Vercel（一次性設定，之後改程式碼會自動重新部署）

### 1. 裝 Node.js（如果這台電腦還沒裝）

到 https://nodejs.org 下載 LTS 版安裝（一路下一步就好）。裝完重開一次終端機。

### 2. 建立 GitHub repo 並推上去

```bash
git init
git add .
git commit -m "init meal order app"
```

到 https://github.com/new 建一個新 repo（例如 `meal-order-app`），照 GitHub 給的指示把這個資料夾 push 上去，例如：

```bash
git remote add origin https://github.com/你的帳號/meal-order-app.git
git branch -M main
git push -u origin main
```

### 3. 註冊 / 登入 Vercel，匯入這個 repo

1. 到 https://vercel.com ，用 GitHub 帳號登入（免費方案就夠用）。
2. 「Add New → Project」，選剛剛建立的 `meal-order-app` repo，Import。
3. Framework 會自動偵測成 Vite，不用改設定，直接按 **Deploy**。第一次部署會失敗或跑起來但存不了資料，沒關係，先讓它跑一次，等下面步驟設完環境變數會自動修好。

### 4. 加上共用資料庫（Vercel KV）

1. 進到剛剛建立的專案 → 上方 **Storage** 分頁 → **Create Database** → 選 **KV**（背後是 Upstash Redis，免費額度足夠這種小型用量）。
2. 建立好之後選 **Connect Project**，把它接到 `meal-order-app` 這個專案（會自動幫你加上 `KV_REST_API_URL`、`KV_REST_API_TOKEN` 等環境變數，不用手動填）。

### 5.（選用）加上菜單照片辨識功能

不設定這步，App 其他功能都正常，只是上傳菜單照片不會自動辨識品項，改成手動輸入品項即可。

1. 到 https://console.anthropic.com 申請一組 API Key（需要綁信用卡，辨識菜單這種用量通常一次幾分錢台幣等級）。
2. 回到 Vercel 專案 → **Settings → Environment Variables**，新增一筆：
   - Key: `ANTHROPIC_API_KEY`
   - Value: 你剛剛申請的金鑰
   - 套用到 Production（也可以順便勾 Preview / Development）

### 6. 重新部署

到 **Deployments** 分頁，點最新那筆右邊的 `⋯` → **Redeploy**，讓剛剛加的環境變數生效。

完成後 Vercel 會給你一個網址，例如 `https://meal-order-app-xxxx.vercel.app`，把這個連結分享出去，任何人點開就能用，不需要登入。

之後想換網域，可以在 Vercel 的 **Settings → Domains** 綁自訂網域。

## 首次使用

- 管理員密碼預設是 `0000`，進去後到「設定」馬上改掉。
- 先到「成員儲值」建立訂餐的人跟他們的起始儲值金，大家才找得到自己的名字填單。

## 本機開發測試（選用）

安裝 Vercel CLI 並登入、把本機資料夾接到剛剛建立的 Vercel 專案，這樣本機測試時 API 和 KV 資料庫都跟正式站共用（會動到真實資料，測試時請留意）：

```bash
npm install
npm install -g vercel
vercel login
vercel link
vercel dev
```

`vercel dev` 會同時把前端和 `/api` 的伺服器端函式跑起來（預設 http://localhost:3000）。單獨跑 `npm run dev`（Vite）只能看畫面，`/api` 的請求會全部失敗，因為那些函式需要 Vercel 的環境才能跑。

## 已知限制

- 菜單照片是壓縮後直接存進表單資料（跟原本 Artifact 版本一樣的做法），Vercel KV 對單一資料大小有限制；如果常常放很大張或很多張照片，之後可以改成用 Vercel Blob 存圖片本體，資料庫只存網址。目前使用量（幾張菜單、幾十筆訂單）不會碰到這個限制。
- `db`/`sample` 這類 Claude Artifact 專屬能力已經不再使用，改成標準的 Vercel Serverless Functions + KV，所以不再受「必須是同組織 Claude 帳號」的限制。
