// Cloudflare Worker：替瀏覽器轉送「讀取網頁與圖片」的請求。
// 瀏覽器不能直接讀取別的網站，所以掃描外部網頁時要經過這一層。
// 狀態：尚未部署，也尚未測試。部署後把位址填進 js/config.js 的 PROXY_URL。
//
// 這個服務只轉送公開的網頁與圖片，不保存任何內容，也不會收到使用者的照片。

// 只接受從這些網站發出的請求，避免被當成公用的跳板。
const ALLOWED_ORIGINS = ['https://111705004.github.io', 'http://localhost:8765'];
const MAX_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0], Vary: 'Origin' };
    const reply = (status, text) => new Response(text, { status, headers: cors });

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    }
    if (request.method !== 'GET') return reply(405, '只接受 GET');
    if (!allowed) return reply(403, '來源不在允許清單');

    let url;
    try {
      url = new URL(new URL(request.url).searchParams.get('url'));
    } catch (_) {
      return reply(400, '缺少 url 參數或格式不正確');
    }
    if (!/^https?:$/.test(url.protocol)) return reply(400, '只接受 http 與 https');
    // 不轉送到內部網路位址
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname)) return reply(400, '不接受這個位址');

    const res = await fetch(url.href, {
      headers: { 'User-Agent': 'TraceBackPrototype/0.1', Accept: 'text/html,image/*' },
      redirect: 'follow',
    });
    const type = res.headers.get('content-type') || '';
    if (!/^(text\/html|image\/)/.test(type)) return reply(415, '只轉送網頁與圖片');
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return reply(413, '檔案太大');

    return new Response(res.body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' },
    });
  },
};
