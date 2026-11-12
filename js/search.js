// 路徑二「幫我找找看」：連結評分與權重學習、依權重爬取、網頁來源（真實網頁與模擬網路）。
// 別人的圖片抓回瀏覽器後在本機比對；使用者的照片不會送出去。

import * as M from './matching.js';
import { PROXY_URL } from './config.js';

// ---------- 連結評分 ----------

// 每個特徵只看連結上的文字與周圍說明，不需要先打開頁面。
export const FEATURES = [
  { key: 'invest', label: '提到投資、飆股、獲利', re: /投資|飆股|獲利|明牌|翻倍|股票|報酬|賺|理財/ },
  { key: 'urgent', label: '催促行動：限時、免費、加 LINE', re: /限時|免費|加\s*LINE|名額|立即|點我|倒數/i },
  { key: 'endorse', label: '提到名人、老師、專家、推薦', re: /名人|老師|專家|達人|推薦|代言|親授|名師/ },
  { key: 'sponsored', label: '標示為贊助或廣告' },
  { key: 'depth', label: '離起點每多一層' },
];

// 第一階段：人工設定的起始權重。
export const DEFAULT_WEIGHTS = { bias: -1.2, invest: 2.0, urgent: 1.2, endorse: 1.4, sponsored: 1.6, depth: -0.4 };

const WEIGHTS_KEY = 'traceback.weights.v1';

export function loadWeights() {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (raw) return { ...DEFAULT_WEIGHTS, ...JSON.parse(raw) };
  } catch (_) {
    /* 無法使用儲存空間時就用預設值 */
  }
  return { ...DEFAULT_WEIGHTS };
}

export function saveWeights(weights) {
  try {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
  } catch (_) {
    /* 存不了也不影響這次搜尋 */
  }
}

export function resetWeights() {
  try {
    localStorage.removeItem(WEIGHTS_KEY);
  } catch (_) {
    /* 同上 */
  }
  return { ...DEFAULT_WEIGHTS };
}

export function linkFeatures(link, depth) {
  const text = `${link.text || ''} ${link.context || ''}`;
  const x = { depth };
  for (const f of FEATURES) if (f.re) x[f.key] = f.re.test(text) ? 1 : 0;
  x.sponsored = link.sponsored || /贊助|廣告|sponsored/i.test(text) ? 1 : 0;
  return x;
}

export function scoreOf(weights, x) {
  let z = weights.bias;
  for (const k of Object.keys(x)) z += (weights[k] || 0) * x[k];
  return 1 / (1 + Math.exp(-z));
}

// 第二階段：用「這一頁有沒有找到」當答案，以邏輯迴歸調整權重。
export function learn(weights, samples, { rate = 0.1, epochs = 12 } = {}) {
  const w = { ...weights };
  const clamp = (v) => Math.max(-4, Math.min(4, v));
  for (let e = 0; e < epochs; e++) {
    for (const { x, y } of samples) {
      const err = y - scoreOf(w, x);
      w.bias = clamp(w.bias + rate * err);
      for (const k of Object.keys(x)) w[k] = clamp((w[k] || 0) + rate * err * x[k]);
    }
  }
  for (const k of Object.keys(w)) w[k] = Math.round(w[k] * 100) / 100;
  return w;
}

// ---------- 比對一張抓回來的圖 ----------

const HIT_VERDICTS = new Set(['derived', 'likely', 'face-only']);

// 先用雜湊、特徵向量與人臉粗篩，通過的才做費時的特徵點比對。
export async function matchImage(canvas, refs) {
  const T = M.THRESHOLDS;
  const features = {
    canvas,
    hash: M.pHash(canvas),
    faces: await M.faceDescriptors(canvas),
    embedding: await M.embed(canvas),
  };
  let best = null;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!ref.embedding) ref.embedding = await M.embed(ref.canvas);
    const faceDist = M.closestFace(ref.faces, features.faces);
    const candidate =
      M.hamming(ref.hash, features.hash) <= T.hashClose ||
      M.cosine(ref.embedding, features.embedding) >= T.embedMid ||
      (faceDist !== null && faceDist <= T.faceSame);
    if (!candidate) continue;
    const r = await M.comparePair(ref, features);
    if (!best || r.rank > best.rank) best = { index: i, ref, ...r };
  }
  return { features, best };
}

const MAX_IMAGES_PER_PAGE = 12;

export async function inspectPage(page, refs, signal) {
  const hits = [];
  let checked = 0;
  for (const image of page.images.slice(0, MAX_IMAGES_PER_PAGE)) {
    if (signal && signal.aborted) break;
    let loaded = null;
    try {
      loaded = await image.load();
    } catch (_) {
      continue; // 讀不到的圖略過
    }
    if (!loaded || loaded.canvas.width < 96 || loaded.canvas.height < 96) continue;
    checked++;
    const m = await matchImage(loaded.canvas, refs);
    if (m.best && HIT_VERDICTS.has(m.best.verdict)) {
      hits.push({ page, imageUrl: image.url, alt: image.alt || '', blob: loaded.blob, features: m.features, best: m.best });
    } else {
      M.forgetFeatures(loaded.canvas);
    }
  }
  return { hits, checked };
}

// ---------- 依權重爬取 ----------

// 每次從待看清單裡挑分數最高的連結。同分時先看到的先看。
export async function crawl({ web, seeds, weights, maxPages, inspect, onVisit, signal }) {
  const seen = new Set();
  const queue = [];
  const push = (link, depth, from) => {
    if (seen.has(link.url)) return;
    seen.add(link.url);
    const x = depth === 0 ? null : linkFeatures(link, depth);
    queue.push({ url: link.url, text: link.text || '', x, score: x ? scoreOf(weights, x) : 1, depth, from });
  };
  for (const url of seeds) push({ url }, 0, null);

  const visited = [];
  while (queue.length && visited.length < maxPages && !(signal && signal.aborted)) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].score > queue[bi].score) bi = i;
    const item = queue.splice(bi, 1)[0];
    const entry = { ...item, title: item.text || web.label(item.url), platform: '', checked: 0, hits: [], error: null, done: false };
    visited.push(entry);
    if (onVisit) onVisit(entry, visited);
    try {
      const page = await web.fetchPage(item.url);
      entry.title = page.title || entry.title;
      entry.platform = page.platform || '';
      const found = await inspect(page, entry);
      entry.hits = found.hits;
      entry.checked = found.checked;
      for (const link of page.links) if (web.sameSite(link.url, item.url)) push(link, item.depth + 1, item.url);
    } catch (err) {
      entry.error = err && err.message ? err.message : String(err);
    }
    entry.done = true;
    if (onVisit) onVisit(entry, visited);
  }
  return visited;
}

// ---------- 來源一：真實網頁 ----------

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function httpWeb() {
  const own = location.origin;
  const isOwn = (url) => new URL(url).origin === own;
  const via = (url) => (isOwn(url) ? url : PROXY_URL + encodeURIComponent(url));

  async function loadImage(url) {
    const res = await fetch(via(url), { credentials: 'omit' });
    if (!res.ok) throw new Error('圖片讀取失敗');
    const blob = await res.blob();
    if (/svg/.test(blob.type)) return null; // 向量圖不會是照片
    const bitmap = await createImageBitmap(blob);
    return { canvas: M.toCanvas(bitmap, 640), blob };
  }

  return {
    kind: 'http',
    reachable: (url) => isOwn(url) || Boolean(PROXY_URL),
    sameSite: (a, b) => new URL(a).origin === new URL(b).origin,
    label: (url) => url,
    async fetchPage(url) {
      const res = await fetch(via(url), { credentials: 'omit' });
      if (!res.ok) throw new Error(`讀不到這一頁（${res.status}）`);
      if (!/html/.test(res.headers.get('content-type') || '')) throw new Error('這個網址不是網頁');
      // DOMParser 只解析文字，不會執行頁面上的程式，也不會自動載入圖片
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

      const links = [];
      const seenLinks = new Set([url]);
      for (const a of doc.querySelectorAll('a[href]')) {
        let u;
        try {
          u = new URL(a.getAttribute('href'), url);
        } catch (_) {
          continue;
        }
        if (!/^https?:$/.test(u.protocol)) continue;
        // 網站標示不希望被跟隨的連結就不跟
        if (/nofollow/.test(a.getAttribute('rel') || '')) continue;
        u.hash = '';
        if (seenLinks.has(u.href)) continue;
        seenLinks.add(u.href);
        const box = a.closest('[data-sponsored], .sponsored, .ad');
        links.push({
          url: u.href,
          text: clean(a.textContent).slice(0, 120) || clean(a.getAttribute('title')),
          context: box ? clean(box.textContent).slice(0, 160) : '',
          sponsored: Boolean(box) || /sponsored/.test(a.getAttribute('rel') || ''),
        });
      }

      const images = [];
      const seenImages = new Set();
      const addImage = (src, alt) => {
        let u;
        try {
          u = new URL(src, url);
        } catch (_) {
          return;
        }
        if (!/^https?:$/.test(u.protocol) || seenImages.has(u.href)) return;
        seenImages.add(u.href);
        images.push({ url: u.href, alt: clean(alt), load: () => loadImage(u.href) });
      };
      for (const img of doc.querySelectorAll('img[src]')) addImage(img.getAttribute('src'), img.getAttribute('alt'));
      const og = doc.querySelector('meta[property="og:image"]');
      if (og && og.content) addImage(og.content, '');

      const title = clean(doc.title) || url;
      const meta = (sel) => {
        const el = doc.querySelector(sel);
        return el ? clean(el.getAttribute('content') || el.textContent) : '';
      };
      const text = `${title} ${clean(doc.body ? doc.body.textContent : '').slice(0, 400)}`;
      return {
        url,
        title,
        platform: meta('meta[property="og:site_name"]') || new URL(url).hostname,
        account: meta('[data-account]') || meta('meta[name="author"]'),
        advertiser: meta('[data-advertiser]'),
        hint: FEATURES[0].re.test(text) ? 'scam' : FEATURES[2].re.test(text) ? 'endorsement' : null,
        links,
        images,
      };
    },
  };
}

// ---------- 來源二：模擬網路 ----------
// 用使用者自己的照片在瀏覽器裡做出幾則模擬假廣告，混進一組模擬網頁。
// 用途是讓人不需要真實的侵權內容，就能看到搜尋與比對怎麼運作。不會連到任何真實網站。

const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

// 把來源圖以「填滿」的方式畫進指定區域。
function cover(ctx, src, x, y, w, h, flip = false) {
  const scale = Math.max(w / src.width, h / src.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (src.width - sw) / 2;
  const sy = (src.height - sh) / 3; // 偏上，保留臉
  ctx.save();
  if (flip) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
  }
  ctx.restore();
}

function text(ctx, str, x, y, size, color, weight = 700, align = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// 每張模擬圖都加上標記，避免截圖流出後被誤認為真實廣告。
function watermark(ctx, w, h) {
  const label = '示範用模擬內容';
  ctx.font = `600 13px ${FONT}`;
  const tw = ctx.measureText(label).width + 14;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(w - tw - 6, 6, tw, 22);
  text(ctx, label, w - 13, 17, 13, '#fff', 600, 'right');
}

// 模擬廣告一：整張照片加上橫幅與標章。
function adBanner(src) {
  const scale = Math.min(1, 560 / Math.max(src.width, src.height));
  const c = newCanvas(src.width * scale, src.height * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const bh = Math.round(c.height * 0.24);
  ctx.fillStyle = '#c62828';
  ctx.fillRect(0, c.height - bh, c.width, bh);
  const fs = Math.max(16, Math.round(c.width / 15));
  text(ctx, '保證獲利 30%', c.width / 2, c.height - bh * 0.66, fs, '#ffeb3b', 800, 'center');
  text(ctx, '加 LINE 免費領飆股名單', c.width / 2, c.height - bh * 0.27, fs * 0.72, '#fff', 700, 'center');
  ctx.fillStyle = '#ffd600';
  ctx.fillRect(0, Math.round(c.height * 0.06), Math.round(c.width * 0.5), Math.round(fs * 1.7));
  text(ctx, '財經名師 親自帶單', 10, Math.round(c.height * 0.06 + fs * 0.85), fs * 0.8, '#222', 800);
  watermark(ctx, c.width, c.height);
  return c;
}

// 模擬廣告二：裁切、左右翻轉、加暖色濾鏡與標題。
function adMirror(src) {
  const cw = src.width * 0.84;
  const ch = src.height * 0.86;
  const scale = Math.min(1, 520 / Math.max(cw, ch));
  const c = newCanvas(cw * scale, ch * scale);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, src.width * 0.08, src.height * 0.04, cw, ch, 0, 0, c.width, c.height);
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 150, 40, 0.16)';
  ctx.fillRect(0, 0, c.width, c.height);
  const fs = Math.max(16, Math.round(c.width / 14));
  ctx.fillStyle = 'rgba(20, 20, 20, 0.78)';
  ctx.fillRect(0, c.height - fs * 2.2, c.width, fs * 2.2);
  text(ctx, '三個月翻倍　名額有限', c.width / 2, c.height - fs * 1.1, fs, '#ffe082', 800, 'center');
  watermark(ctx, c.width, c.height);
  return c;
}

// 模擬廣告三：照片縮小後放進一張商品廣告的版面。
function adComposite(src) {
  const c = newCanvas(640, 460);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 640, 460);
  g.addColorStop(0, '#e8f5e9');
  g.addColorStop(1, '#a5d6a7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 460);
  ctx.fillStyle = '#fff';
  ctx.fillRect(22, 46, 326, 392);
  cover(ctx, src, 30, 54, 310, 376);
  // 商品
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(432, 170, 120, 190);
  ctx.fillStyle = '#1b5e20';
  ctx.fillRect(462, 138, 60, 36);
  ctx.fillStyle = '#fff';
  ctx.fillRect(444, 222, 96, 70);
  text(ctx, '活力', 492, 246, 24, '#2e7d32', 800, 'center');
  text(ctx, '每日一包', 492, 274, 15, '#2e7d32', 700, 'center');
  text(ctx, '名人真心推薦', 492, 76, 30, '#1b5e20', 800, 'center');
  text(ctx, '吃了都說好', 492, 112, 20, '#33691e', 700, 'center');
  ctx.fillStyle = '#d84315';
  ctx.beginPath();
  ctx.arc(560, 400, 44, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, '限時', 560, 388, 18, '#fff', 800, 'center');
  text(ctx, '買一送一', 560, 412, 16, '#fff', 800, 'center');
  watermark(ctx, 640, 460);
  return c;
}

// 模擬轉貼：照片沒有被改，只是被縮小並加了一行圖說。
function repost(src) {
  const scale = 420 / src.width;
  const ph = Math.round(src.height * scale);
  const c = newCanvas(420, ph + 46);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#263238';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, 420, ph);
  text(ctx, '理財達人的十句話', 210, ph + 23, 18, '#fff', 700, 'center');
  watermark(ctx, c.width, ph);
  return c;
}

// 與使用者無關的示意圖。用簡單的圖形畫成，不含任何真人影像。
function scene(kind, caption) {
  const c = newCanvas(480, 360);
  const ctx = c.getContext('2d');
  const fill = (color) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 480, 360);
  };
  const circle = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const tri = (x1, y1, x2, y2, x3, y3, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.fill();
  };
  if (kind === 'chart') {
    fill('#10202b');
    ctx.strokeStyle = '#26c281';
    ctx.lineWidth = 5;
    ctx.beginPath();
    const ys = [270, 240, 255, 200, 215, 160, 175, 110, 130, 70];
    ys.forEach((y, i) => (i ? ctx.lineTo(40 + i * 44, y) : ctx.moveTo(40, y)));
    ctx.stroke();
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 3 ? '#26c281' : '#e74c3c';
      ctx.fillRect(50 + i * 44, 290 - (i % 4) * 12, 18, 30 + (i % 4) * 12);
    }
  } else if (kind === 'food') {
    fill('#ffe0b2');
    circle(240, 185, 120, '#fff');
    circle(240, 185, 92, '#fff3e0');
    circle(205, 170, 34, '#e65100');
    circle(270, 200, 30, '#7cb342');
    circle(262, 150, 22, '#fdd835');
  } else if (kind === 'travel') {
    const g = ctx.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, '#81d4fa');
    g.addColorStop(1, '#e1f5fe');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 360);
    circle(380, 80, 36, '#ffeb3b');
    tri(0, 300, 150, 110, 300, 300, '#558b2f');
    tri(170, 300, 320, 150, 480, 300, '#33691e');
    ctx.fillStyle = '#0277bd';
    ctx.fillRect(0, 296, 480, 64);
  } else if (kind === 'pet') {
    fill('#f3e5f5');
    tri(150, 150, 170, 70, 220, 120, '#8d6e63');
    tri(330, 150, 310, 70, 260, 120, '#8d6e63');
    circle(240, 190, 96, '#8d6e63');
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(196, 172, 10, 26);
    ctx.fillRect(274, 172, 10, 26);
    tri(228, 214, 252, 214, 240, 228, '#ef9a9a');
  } else if (kind === 'gadget') {
    fill('#eceff1');
    ctx.fillStyle = '#263238';
    ctx.fillRect(180, 50, 120, 240);
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(190, 66, 100, 196);
    circle(240, 276, 7, '#90a4ae');
  } else if (kind === 'sports') {
    fill('#2e7d32');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 40, 420, 250);
    ctx.beginPath();
    ctx.moveTo(240, 40);
    ctx.lineTo(240, 290);
    ctx.stroke();
    circle(240, 165, 30, '#fff');
    circle(240, 165, 12, '#212121');
  } else if (kind === 'sale') {
    fill('#fff8e1');
    ctx.fillStyle = '#f57c00';
    ctx.fillRect(110, 80, 260, 160);
    text(ctx, '全館免運', 240, 160, 44, '#fff', 800, 'center');
  } else {
    fill('#fafafa');
    ctx.fillStyle = '#b0bec5';
    for (let i = 0; i < 6; i++) ctx.fillRect(40, 50 + i * 40, i % 2 ? 300 : 400, 18);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 316, 480, 44);
  text(ctx, caption, 16, 338, 19, '#fff', 700);
  return c;
}

function toBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
}

function simImage(id, alt, make) {
  return {
    url: `sim://img/${id}.jpg`,
    alt,
    // 經過一次 JPEG 壓縮再解碼，接近實際從網路抓到圖的狀況
    async load() {
      const blob = await toBlob(make());
      const bitmap = await createImageBitmap(blob);
      return { canvas: M.toCanvas(bitmap, 640), blob };
    },
  };
}

export function simulatedWeb(refs) {
  const ref = (i) => refs[i % refs.length].canvas;
  const pages = new Map();
  const add = (id, p) => pages.set(`sim://${id}`, { url: `sim://${id}`, links: [], images: [], account: '', advertiser: '', hint: null, planted: false, ...p });
  const link = (id, textStr, sponsored = false) => ({ url: `sim://${id}`, text: textStr, sponsored });
  const pic = (id, kind, caption) => simImage(id, caption, () => scene(kind, caption));

  add('portal', {
    title: '生活入口網｜今日熱門',
    platform: '模擬入口網站',
    images: [pic('portal', 'news', '今日熱門')],
    links: [
      link('feed', '社群動態牆'),
      link('news', '新聞快報'),
      link('food', '週末食譜'),
      link('travel', '花東三日遊'),
      link('shop', '3C 購物節｜限時免運'),
      link('ad-teacher', '財經老師親授：飆股名單免費領', true),
    ],
  });
  add('feed', {
    title: '社群動態牆',
    platform: '模擬社群平台',
    images: [pic('feed', 'news', '朋友的最新動態')],
    links: [
      link('pet', '我家的貓今天也很可愛'),
      link('group', '投資理財交流社團'),
      link('ad-health', '名人推薦保健食品，限時優惠', true),
      link('sports', '昨晚球賽精華'),
    ],
  });
  add('news', {
    title: '新聞快報',
    platform: '模擬新聞網站',
    images: [pic('news', 'news', '新聞快報')],
    links: [link('rate', '央行利率決議整理'), link('quotes', '名人語錄：理財達人的十句話'), link('gadget', '新手機開箱')],
  });
  add('food', { title: '週末食譜', platform: '模擬部落格', images: [pic('food', 'food', '三十分鐘上桌')], links: [link('recipe', '氣炸鍋料理十選')] });
  add('recipe', { title: '氣炸鍋料理十選', platform: '模擬部落格', images: [pic('recipe', 'food', '氣炸鍋料理')] });
  add('travel', { title: '花東三日遊', platform: '模擬部落格', images: [pic('travel', 'travel', '花東縱谷')], links: [link('hotel', '訂房優惠，限時三天')] });
  add('hotel', { title: '訂房優惠', platform: '模擬訂房網站', images: [pic('hotel', 'travel', '海景房')] });
  add('shop', { title: '3C 購物節', platform: '模擬購物網站', images: [pic('shop', 'sale', '全館免運到月底'), pic('shop2', 'gadget', '本週主打')] });
  add('pet', { title: '我家的貓', platform: '模擬社群平台', images: [pic('pet', 'pet', '午睡中')] });
  add('sports', { title: '昨晚球賽精華', platform: '模擬新聞網站', images: [pic('sports', 'sports', '精彩好球')] });
  add('rate', { title: '央行利率決議整理', platform: '模擬新聞網站', images: [pic('rate', 'chart', '利率走勢')] });
  add('gadget', { title: '新手機開箱', platform: '模擬新聞網站', images: [pic('gadget', 'gadget', '開箱實拍')] });
  add('group', {
    title: '投資理財交流社團',
    platform: '模擬社群平台',
    images: [pic('group', 'chart', '今日盤勢討論')],
    links: [link('ad-line', '老師帶你三個月翻倍，加 LINE 進群'), link('stock', '今日大盤分析，股票新手必看')],
  });
  add('stock', { title: '今日大盤分析', platform: '模擬社群平台', images: [pic('stock', 'chart', '大盤走勢')] });

  // 以下四頁放了用使用者照片做的模擬內容
  add('ad-teacher', {
    title: '財經老師親授：飆股名單免費領',
    platform: '模擬社群平台的贊助廣告',
    account: '飆股報報（模擬粉專）',
    advertiser: '模擬廣告主 A',
    hint: 'scam',
    planted: true,
    images: [simImage('ad-teacher', '保證獲利', () => adBanner(ref(0))), pic('ad-teacher2', 'chart', '學員獲利對帳單')],
  });
  add('ad-line', {
    title: '老師帶你三個月翻倍',
    platform: '模擬一頁式網站',
    account: '翻倍學院（模擬帳號）',
    advertiser: '',
    hint: 'scam',
    planted: true,
    images: [simImage('ad-line', '三個月翻倍', () => adMirror(ref(1)))],
  });
  add('ad-health', {
    title: '名人推薦保健食品',
    platform: '模擬社群平台的贊助廣告',
    account: '活力生技（模擬粉專）',
    advertiser: '模擬廣告主 B',
    hint: 'endorsement',
    planted: true,
    images: [simImage('ad-health', '名人真心推薦', () => adComposite(ref(2)))],
  });
  add('quotes', {
    title: '名人語錄：理財達人的十句話',
    platform: '模擬內容農場',
    account: '語錄天天看（模擬網站）',
    hint: 'other',
    planted: true,
    images: [simImage('quotes', '理財達人', () => repost(ref(3))), pic('quotes2', 'news', '延伸閱讀')],
  });

  const seeds = ['sim://portal'];
  return {
    kind: 'sim',
    seeds,
    pages,
    plantedCount: [...pages.values()].filter((p) => p.planted).length,
    reachable: () => true,
    sameSite: () => true,
    label: (url) => url.replace('sim://', '模擬網路／'),
    async fetchPage(url) {
      await new Promise((r) => setTimeout(r, 150));
      const page = pages.get(url);
      if (!page) throw new Error('找不到這一頁');
      return page;
    },
    // 對照組：不排序，照連結出現的順序一頁一頁看，前 n 頁會遇到幾則。
    baseline(n) {
      const order = [...seeds];
      const seen = new Set(seeds);
      let found = 0;
      for (let i = 0; i < order.length && i < n; i++) {
        const page = pages.get(order[i]);
        if (page.planted) found++;
        for (const l of page.links) {
          if (!seen.has(l.url)) {
            seen.add(l.url);
            order.push(l.url);
          }
        }
      }
      return found;
    },
  };
}
