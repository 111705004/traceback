// 掃描外部網站時用的轉送服務位址。留白表示只能掃描這個網站自己的頁面。
// 部署 proxy/worker.js 之後，把位址填在這裡，結尾要帶 ?url=
// 例如：'https://traceback-proxy.example.workers.dev/?url='
export const PROXY_URL = '';

// 內建測試站的起點，給「掃描指定網頁」示範用。
export const TESTSITE_URL = 'testsite/index.html';
