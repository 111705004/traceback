// 後端（backend/）的位址。部署後把 PRODUCTION_API_URL 換成 Worker 的網址，例如
// 'https://traceback-api.你的帳號.workers.dev'，結尾不要加斜線。
// 在自己的電腦上開發時，自動連到 npm run dev 啟動的本機後端。
const PRODUCTION_API_URL = 'https://traceback-api.traceback-nextwave.workers.dev';
const LOCAL = location.hostname === 'localhost';
export const API_URL = LOCAL ? 'http://localhost:8787' : PRODUCTION_API_URL;

// 掃描外部網站時用的轉送服務，已經併進後端。留白表示只能掃描這個網站自己的頁面。
export const PROXY_URL = API_URL ? `${API_URL}/api/proxy?url=` : '';

// 內建測試站的起點，給「掃描指定網頁」示範用。
export const TESTSITE_URL = 'testsite/index.html';
