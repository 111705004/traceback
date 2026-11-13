// 呼叫後端，以及民眾查證頁、登錄頁、管理頁共用的小工具。
import { API_URL } from './config.js';

export const hasBackend = () => !!API_URL;

// 與 backend/src/index.js 的 ACTIVITIES 相同
export const ACTIVITIES = {
  'line-group': '邀請加入 LINE 或其他投資群組',
  'stock-tips': '報明牌、帶單操作、保證獲利',
  'private-dm': '主動私訊陌生人',
  'transfer': '要求匯款、儲值或購買虛擬貨幣',
  'paid-course': '販售投資課程或會員',
  'product': '代言保健品或商品',
};

export const PLATFORMS = {
  line: 'LINE',
  threads: 'Threads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  website: '網站',
  other: '其他',
};

export async function api(path, { method = 'GET', body, token } = {}) {
  if (!API_URL) throw new Error('這個網站還沒有連上後端，請先部署 backend/ 並在 js/config.js 填上位址。');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (_) {
    throw new Error('連不上伺服器，請檢查網路後再試一次。');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* 沒有內容 */
  }
  if (!res.ok) throw new Error((data && data.error) || `伺服器回應 ${res.status}`);
  return data;
}

export const $ = (id) => document.getElementById(id);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function setStatus(text) {
  const el = $('status');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

export function setLine(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `result-line ${kind}`;
}

export function oops(err) {
  console.error(err);
  setStatus('');
  const text = $('oops-text');
  if (text) {
    text.textContent = err.message || String(err);
    $('oops').showModal();
  } else alert(err.message || String(err));
}

// 讓一個 .drop 區塊支援拖放；貼上截圖由各頁自己處理
export function setupDrop(drop, input) {
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (!e.dataTransfer.files.length) return;
    const dt = new DataTransfer();
    for (const f of e.dataTransfer.files) if (f.type.startsWith('image/')) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
}

export async function sha256File(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function copyCanvas(source, maxSide = 200) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.round(source.width * scale);
  c.height = Math.round(source.height * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('zh-TW', { hour12: false });
}

export function platformOptions(selected = '') {
  return Object.entries(PLATFORMS)
    .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`)
    .join('');
}

export function accountLink(a) {
  const label = `${PLATFORMS[a.platform] || a.platform}：${a.label}`;
  const badge = a.verified ? '<span class="pill high">已驗證</span>' : '<span class="pill mid">未驗證</span>';
  const text = a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
  return `${text} ${badge}`;
}
