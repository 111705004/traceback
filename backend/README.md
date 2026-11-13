# TraceBack 後端

Cloudflare Worker 加 D1 資料庫（SQLite）。免費方案就夠初賽與決賽展示用。

## 它做什麼

| 功能 | 路徑 | 誰用 |
|---|---|---|
| 本人登錄、修改、刪除 | `POST /api/kol/register`、`GET/PUT/DELETE /api/kol/me` | 當事人（用管理連結） |
| 官方帳號歸屬驗證 | `POST /api/kol/accounts/:id/verify` | 當事人 |
| 民眾回報收件匣、確認冒用或授權 | `GET /api/kol/reports`、`POST /api/kol/reports/:id` | 當事人 |
| 民眾查證 | `POST /api/check` | 任何人 |
| 交給本人確認、查詢進度 | `POST /api/reports`、`GET /api/reports/:id` | 任何人 |
| 審核登錄、人工確認帳號 | `GET /api/admin/kols`、`POST /api/admin/kols/:id`、`POST /api/admin/accounts/:id` | 管理員 |
| 轉送公開網頁與圖片 | `GET /api/proxy?url=` | 「掃描指定網頁」 |

## 資料怎麼流

- 照片在瀏覽器裡用 face-api 算成 128 維的臉部特徵，送到伺服器的只有這組數值。伺服器不存照片。
- 民眾查證時，送出的是截圖的臉部特徵與感知雜湊。伺服器比對已審核的登錄者，回傳結果，不留紀錄。
- 只有民眾勾選同意並按「交給本人確認」，才會上傳縮小後的截圖。本人處理完 90 天後刪除截圖；沒人處理的回報 180 天後刪除（每天自動執行）。
- 登錄者的臉部特徵只在伺服器上比對，不會傳到民眾的瀏覽器。
- 當事人用登錄時拿到的管理連結登入。伺服器只存連結的 SHA-256，原文只顯示一次。

## 查證的四種結果

依序判斷，先符合的為準：

1. **本人已確認冒用／授權**：截圖和本人確認過的回報是同一張圖（感知雜湊相差 10 位元以內）。
2. **與本人聲明不符**：臉對到登錄者，但帳號不在官方名單裡，或對方的要求是本人聲明不會做的事。
3. **官方帳號**：臉對到登錄者，帳號在名單裡且已驗證。
4. **尚無法確認**：其他情況，包括臉對不到任何登錄者。

臉部比對門檻 0.5，與前端 `js/matching.js` 的 `THRESHOLDS.faceSame` 相同，是暫定值。

## 部署（第一次，約 10 分鐘）

需要一個 Cloudflare 帳號（免費）。

```bash
cd backend
npm install
npx wrangler login
npx wrangler d1 create traceback
```

把 `d1 create` 印出來的 `database_id` 填進 `wrangler.toml`，然後：

```bash
npm run db:remote
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

`ADMIN_TOKEN` 是審核頁的密碼，請用 16 字以上的隨機字串。部署完會印出 Worker 的網址，例如 `https://traceback-api.xxx.workers.dev`。

最後把這個網址填進 `js/config.js` 的 `PRODUCTION_API_URL`，推到 GitHub，GitHub Pages 更新後就能用了。

如果網站不是放在 `https://111705004.github.io`，要改 `wrangler.toml` 的 `ALLOWED_ORIGINS`。

## 在自己的電腦上執行

```bash
cd backend
npm install
npm run db:local
printf 'ADMIN_TOKEN=local-admin-token-for-testing-only\n' > .dev.vars
npm run dev
```

後端會在 `http://localhost:8787`。另開一個終端機，在專案根目錄執行 `python3 -m http.server 8765`，開啟 `http://localhost:8765`。前端偵測到 localhost 會自動連本機後端。

## 已知限制

- **身分驗證**：登錄時只檢查照片和自拍是同一張臉，沒有防偽與證件驗證，所以用管理員人工審核擋住冒名登錄。正式版要接政府或第三方的身分驗證服務。
- **帳號歸屬驗證**：自動檢查是讀帳號的公開頁面找驗證碼。Threads、Instagram、LINE 等需要登入或用 App 開的頁面多半讀不到，要由管理員人工確認。
- **比對規模**：每次查證都會把所有登錄者的特徵讀出來逐一比對，幾百人以內沒問題。登錄者多了要改用 Cloudflare Vectorize 等向量資料庫。
- **流量限制**：每個 IP 每 10 分鐘查證 60 次、每小時回報 10 次、登錄 5 次。IP 雜湊後才存。
- **臉部特徵仍是個資**：特徵數值不是照片，但仍屬可識別個人的生物特徵資料，登錄時要取得明確同意，並提供刪除。
