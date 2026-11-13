// 尋影 TraceBack 後端（Cloudflare Worker + D1）
//
// 做四件事：
// 1. 登錄庫：當事人登錄臉部特徵、本人聲明與官方帳號，審核通過後才開放公開查證。
// 2. 民眾查證：收到可疑截圖的臉部特徵與感知雜湊，比對登錄庫，回傳四種狀態之一。
// 3. 線索回報：民眾同意後把截圖交給當事人確認，確認結果會更新之後的查證。
// 4. 轉送服務：替瀏覽器讀取公開網頁與圖片，給「掃描指定網頁」用。
//
// 收到的是瀏覽器算好的數值，不是照片；只有民眾按下「回報」時才會收到縮小後的截圖。

const FACE_DIM = 128;
const FACE_MATCH = 0.5; // 與前端 THRESHOLDS.faceSame 相同
// 換臉檢查的門檻，與前端 js/faceparts.js 的 PART_THRESHOLDS 相同
const INNER_IDENTIFY = 0.4;
const INNER_CLOSE = 0.45;
const OUTER_DIFFER = 0.28;
const HASH_SAME = 10; // 與前端 THRESHOLDS.hashNear 相同
const MAX_FACES_PER_KOL = 12;
const MAX_IMAGE_CHARS = 700_000;
const IMAGE_KEEP_DAYS = 90; // 已處理的回報，截圖保留天數
const PENDING_KEEP_DAYS = 180; // 沒人處理的回報保留天數

// 本人可以聲明「我不會做」的事，民眾端用同一組代號勾選
export const ACTIVITIES = {
  'line-group': '邀請加入 LINE 或其他投資群組',
  'stock-tips': '報明牌、帶單操作、保證獲利',
  'private-dm': '主動私訊陌生人',
  'transfer': '要求匯款、儲值或購買虛擬貨幣',
  'paid-course': '販售投資課程或會員',
  'product': '代言保健品或商品',
};

const PLATFORMS = ['line', 'threads', 'facebook', 'instagram', 'youtube', 'tiktok', 'x', 'website', 'other'];

// ---------- 工具 ----------

const now = () => Date.now();

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

function randomHex(bytes) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  // 去掉容易看錯的 0、O、1、I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(6));
  return 'TB-' + [...a].map((b) => chars[b % chars.length]).join('');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 兩個字串等長比較，避免用回應時間猜出管理碼
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function str(v, max, name) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${name} 格式不正確`);
  const s = v.trim();
  if (s.length > max) throw bad(`${name} 太長（上限 ${max} 字）`);
  return s;
}

function descriptor(v) {
  if (!Array.isArray(v) || v.length !== FACE_DIM || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 2)) {
    throw bad('臉部特徵格式不正確');
  }
  return v.map((x) => Math.round(x * 1e5) / 1e5);
}

// 每張臉的五官與臉型特徵（換臉檢查用），可以省略
function partsOf(v, n) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length !== n) throw bad('換臉檢查的特徵數量不正確');
  return v.map((p) => (p ? { inner: descriptor(p.inner), outer: descriptor(p.outer) } : null));
}

function faceDistance(a, b) {
  let s = 0;
  for (let i = 0; i < FACE_DIM; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function hexToBits(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{16}$/.test(hex)) throw bad('感知雜湊格式不正確');
  const bits = [];
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    bits.push((n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1);
  }
  return bits;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// 帳號正規化：去掉 @、空白、大小寫；貼網址時取網址裡的帳號
export function normalizeHandle(platform, input) {
  let s = String(input || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      if (platform === 'website') s = u.hostname.replace(/^www\./, '') + (parts.length ? '/' + parts.join('/') : '');
      else if (/line\.me$/.test(u.hostname)) s = parts[parts.length - 1] || '';
      else if (/youtube\.com$/.test(u.hostname) && parts[0] && !parts[0].startsWith('@')) s = parts[parts.length - 1];
      else s = parts[0] || u.hostname;
    }
  } catch (_) {
    /* 不是網址就照原樣 */
  }
  return s.toLowerCase().replace(/^@+/, '').replace(/\s+/g, '').replace(/\/+$/, '');
}

function platformOf(v) {
  const p = String(v || '').toLowerCase();
  if (!PLATFORMS.includes(p)) throw bad('平台不在清單內');
  return p;
}

function activitiesOf(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((a) => typeof a === 'string' && ACTIVITIES[a]))];
}

async function body(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 1_200_000) throw new HttpError(413, '資料太大');
  try {
    return await request.json();
  } catch (_) {
    throw bad('資料不是 JSON');
  }
}

// 每個 IP 每個時段的次數上限。IP 先雜湊，不保存原文。
async function limit(env, request, bucket, max, seconds) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const window = Math.floor(now() / 1000 / seconds);
  const key = `${bucket}:${(await sha256Hex(ip + bucket)).slice(0, 24)}`;
  const row = await env.DB.prepare('SELECT count, window FROM rate WHERE key = ?').bind(key).first();
  if (row && row.window === window) {
    if (row.count >= max) throw new HttpError(429, '太頻繁了，請稍後再試');
    await env.DB.prepare('UPDATE rate SET count = count + 1 WHERE key = ?').bind(key).run();
  } else {
    await env.DB.prepare('INSERT OR REPLACE INTO rate (key, count, window) VALUES (?, 1, ?)').bind(key, window).run();
  }
}

// ---------- 身分 ----------

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function requireKol(env, request) {
  const token = bearer(request);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, '管理連結不正確');
  const hash = await sha256Hex(token);
  const kol = await env.DB.prepare('SELECT * FROM kols WHERE token_hash = ?').bind(hash).first();
  if (!kol) throw new HttpError(401, '管理連結不正確或帳號已刪除');
  return kol;
}

function requireAdmin(env, request) {
  const token = bearer(request);
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) throw new HttpError(503, '尚未設定 ADMIN_TOKEN');
  if (!safeEqual(token, env.ADMIN_TOKEN)) throw new HttpError(401, '管理員密碼不正確');
}

// ---------- 讀取資料 ----------

async function accountsOf(env, kolId) {
  const { results } = await env.DB.prepare('SELECT * FROM kol_accounts WHERE kol_id = ? ORDER BY id').bind(kolId).all();
  return results;
}

function publicKol(kol, accounts) {
  const statement = JSON.parse(kol.statement || '{}');
  return {
    id: kol.id,
    display_name: kol.display_name,
    title: kol.title,
    never: (statement.never || []).map((k) => ({ key: k, label: ACTIVITIES[k] })),
    note: statement.note || '',
    accounts: accounts.map((a) => ({ platform: a.platform, label: a.label, url: a.url, verified: !!a.verified })),
  };
}

function privateKol(kol, accounts) {
  return {
    ...publicKol(kol, accounts),
    status: kol.status,
    created_at: kol.created_at,
    accounts: accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      label: a.label,
      url: a.url,
      code: a.code,
      verified: !!a.verified,
      verified_by: a.verified_by,
    })),
  };
}

// ---------- 當事人：登錄與管理 ----------

function readProfile(input) {
  const display_name = str(input.display_name, 40, '名稱');
  if (!display_name) throw bad('請填寫名稱');
  const title = str(input.title, 60, '頭銜');
  const never = activitiesOf(input.never);
  const note = str(input.note, 300, '補充說明');
  if (!Array.isArray(input.accounts)) throw bad('官方帳號格式不正確');
  if (input.accounts.length > 10) throw bad('官方帳號最多 10 個');
  const accounts = input.accounts.map((a) => {
    const platform = platformOf(a.platform);
    const label = str(a.handle, 120, '帳號');
    const handle = normalizeHandle(platform, label);
    if (!handle) throw bad('官方帳號不能空白');
    let url = str(a.url, 300, '帳號網址');
    if (url && !/^https:\/\//i.test(url)) throw bad('帳號網址要以 https:// 開頭');
    return { platform, label, handle, url };
  });
  return { display_name, title, statement: JSON.stringify({ never, note }), accounts };
}

async function writeAccounts(env, kolId, accounts) {
  const existing = await accountsOf(env, kolId);
  const keep = new Set();
  const stmts = [];
  for (const a of accounts) {
    const old = existing.find((e) => e.platform === a.platform && e.handle === a.handle);
    if (old) {
      keep.add(old.id);
      // 網址改了就要重新驗證，否則可以先驗證自己的帳號再改成別人的網址
      const urlChanged = old.url !== a.url;
      stmts.push(
        env.DB.prepare('UPDATE kol_accounts SET label = ?, url = ?, verified = ?, verified_by = ? WHERE id = ?').bind(
          a.label,
          a.url,
          urlChanged ? 0 : old.verified,
          urlChanged ? '' : old.verified_by,
          old.id,
        ),
      );
    } else {
      stmts.push(
        env.DB.prepare('INSERT INTO kol_accounts (kol_id, platform, handle, label, url, code) VALUES (?, ?, ?, ?, ?, ?)').bind(
          kolId,
          a.platform,
          a.handle,
          a.label,
          a.url,
          randomCode(),
        ),
      );
    }
  }
  for (const e of existing) if (!keep.has(e.id)) stmts.push(env.DB.prepare('DELETE FROM kol_accounts WHERE id = ?').bind(e.id));
  if (stmts.length) await env.DB.batch(stmts);
}

async function register(env, request) {
  await limit(env, request, 'register', 5, 3600);
  const input = await body(request);
  if (input.consent !== true) throw bad('需要同意條款才能登錄');
  const profile = readProfile(input);
  const selfie = descriptor(input.selfie);
  if (!Array.isArray(input.faces) || input.faces.length === 0) throw bad('至少要有一張照片的臉部特徵');
  if (input.faces.length > MAX_FACES_PER_KOL) throw bad(`照片最多 ${MAX_FACES_PER_KOL} 張`);
  const faces = input.faces.map(descriptor);
  // 前端已經檢查過，這裡再檢查一次每張照片都和自拍是同一張臉
  if (faces.some((f) => faceDistance(f, selfie) > FACE_MATCH)) throw bad('有照片和自拍不是同一張臉');
  // 順序：自拍、照片 1、照片 2……
  const parts = partsOf(input.parts, faces.length + 1);

  const id = randomHex(8);
  const token = randomHex(32);
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO kols (id, display_name, title, statement, status, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, profile.display_name, profile.title, profile.statement, 'pending', await sha256Hex(token), t, t),
    ...[selfie, ...faces].map((f) =>
      env.DB.prepare("INSERT INTO kol_faces (kol_id, kind, descriptor) VALUES (?, 'full', ?)").bind(id, JSON.stringify(f)),
    ),
    ...(parts || [])
      .filter(Boolean)
      .flatMap((p) => [
        env.DB.prepare("INSERT INTO kol_faces (kol_id, kind, descriptor) VALUES (?, 'inner', ?)").bind(id, JSON.stringify(p.inner)),
        env.DB.prepare("INSERT INTO kol_faces (kol_id, kind, descriptor) VALUES (?, 'outer', ?)").bind(id, JSON.stringify(p.outer)),
      ]),
  ]);
  await writeAccounts(env, id, profile.accounts);
  return { id, token };
}

async function getMe(env, request) {
  const kol = await requireKol(env, request);
  return privateKol(kol, await accountsOf(env, kol.id));
}

async function updateMe(env, request) {
  const kol = await requireKol(env, request);
  const profile = readProfile(await body(request));
  await env.DB.prepare('UPDATE kols SET display_name = ?, title = ?, statement = ?, updated_at = ? WHERE id = ?')
    .bind(profile.display_name, profile.title, profile.statement, now(), kol.id)
    .run();
  await writeAccounts(env, kol.id, profile.accounts);
  const fresh = await env.DB.prepare('SELECT * FROM kols WHERE id = ?').bind(kol.id).first();
  return privateKol(fresh, await accountsOf(env, kol.id));
}

async function deleteMe(env, request) {
  const kol = await requireKol(env, request);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE kol_id = ?').bind(kol.id),
    env.DB.prepare('DELETE FROM kol_accounts WHERE kol_id = ?').bind(kol.id),
    env.DB.prepare('DELETE FROM kol_faces WHERE kol_id = ?').bind(kol.id),
    env.DB.prepare('DELETE FROM kols WHERE id = ?').bind(kol.id),
  ]);
  return { deleted: true };
}

// 讀取帳號的公開頁面，看簡介裡有沒有驗證碼。
// 需要登入才看得到的平台（例如 Threads、Instagram）多半讀不到，這時改由管理員人工確認。
async function verifyAccount(env, request, accountId) {
  const kol = await requireKol(env, request);
  await limit(env, request, 'verify', 20, 3600);
  const acc = await env.DB.prepare('SELECT * FROM kol_accounts WHERE id = ? AND kol_id = ?').bind(accountId, kol.id).first();
  if (!acc) throw new HttpError(404, '找不到這個帳號');
  if (acc.verified) return { verified: true, method: acc.verified_by };
  if (!acc.url) return { verified: false, reason: '沒有填帳號網址，無法自動檢查。請等待管理員人工確認。' };
  let text = '';
  try {
    const url = safeUrl(acc.url);
    const res = await fetch(url.href, {
      headers: { 'User-Agent': 'TraceBackVerifier/0.2 (+account ownership check)', Accept: 'text/html' },
      redirect: 'follow',
    });
    text = (await res.text()).slice(0, 2_000_000);
  } catch (_) {
    return { verified: false, reason: '讀不到這個網址。請等待管理員人工確認。' };
  }
  if (!text.includes(acc.code)) {
    return { verified: false, reason: `頁面上沒有看到 ${acc.code}。這個平台可能要登入才看得到簡介，可以改等管理員人工確認。` };
  }
  await env.DB.prepare("UPDATE kol_accounts SET verified = 1, verified_by = 'auto' WHERE id = ?").bind(acc.id).run();
  return { verified: true, method: 'auto' };
}

async function myReports(env, request) {
  const kol = await requireKol(env, request);
  const { results } = await env.DB.prepare(
    'SELECT id, phash, sha256, image, source_url, platform, handle, activities, note, status, kol_note, created_at, decided_at FROM reports WHERE kol_id = ? ORDER BY created_at DESC LIMIT 100',
  )
    .bind(kol.id)
    .all();
  return results.map((r) => ({ ...r, activities: JSON.parse(r.activities || '[]') }));
}

async function decide(env, request, reportId) {
  const kol = await requireKol(env, request);
  const input = await body(request);
  const status = input.status;
  if (!['fake', 'authorized', 'dismissed', 'pending'].includes(status)) throw bad('狀態不正確');
  const kolNote = str(input.kol_note, 300, '說明');
  const r = await env.DB.prepare('UPDATE reports SET status = ?, kol_note = ?, decided_at = ? WHERE id = ? AND kol_id = ?')
    .bind(status, kolNote, status === 'pending' ? null : now(), reportId, kol.id)
    .run();
  if (!r.meta.changes) throw new HttpError(404, '找不到這則回報');
  return { id: reportId, status };
}

// ---------- 民眾：查證與回報 ----------

async function approvedFaces(env) {
  const { results } = await env.DB.prepare(
    "SELECT f.kol_id, f.kind, f.descriptor FROM kol_faces f JOIN kols k ON k.id = f.kol_id WHERE k.status = 'approved'",
  ).all();
  return results.map((r) => ({ kol_id: r.kol_id, kind: r.kind, d: JSON.parse(r.descriptor) }));
}

// 可疑圖上每張臉，對每位登錄者算完整的臉、五官、臉型各自的最小距離
function distanceTable(registry, faces, parts) {
  const table = new Map(); // kol_id -> [{ full, inner, outer }]，每張可疑臉一筆
  for (const r of registry) {
    if (!table.has(r.kol_id)) table.set(r.kol_id, faces.map(() => ({ full: Infinity, inner: Infinity, outer: Infinity })));
    const rows = table.get(r.kol_id);
    faces.forEach((f, i) => {
      const target = r.kind === 'full' ? f : parts?.[i]?.[r.kind];
      if (!target) return;
      rows[i][r.kind] = Math.min(rows[i][r.kind], faceDistance(target, r.d));
    });
  }
  return table;
}

// 找出可疑圖上的人是哪位登錄者。
// 先看完整的臉；對不上時，再看「五官很像、臉型不像」的情形，那是把登錄者的臉換到別人身上。
function identify(table) {
  let byFull = null;
  let byInner = null;
  for (const [kol_id, rows] of table) {
    rows.forEach((d, i) => {
      if (d.full <= FACE_MATCH && (!byFull || d.full < byFull.d.full)) byFull = { kol_id, d, via: 'full' };
      if (d.inner <= INNER_IDENTIFY && d.outer >= OUTER_DIFFER && (!byInner || d.inner < byInner.d.inner)) {
        byInner = { kol_id, d, via: 'inner' };
      }
    });
  }
  return byFull || byInner;
}

async function check(env, request) {
  await limit(env, request, 'check', 60, 600);
  const input = await body(request);
  if (!Array.isArray(input.faces) || input.faces.length > 20) throw bad('臉部特徵格式不正確');
  const faces = input.faces.map(descriptor);
  const parts = partsOf(input.parts, faces.length);
  const bits = input.phash ? hexToBits(input.phash) : null;
  const platform = input.platform ? platformOf(input.platform) : '';
  const handle = platform ? normalizeHandle(platform, str(input.handle, 200, '帳號')) : '';
  const activities = activitiesOf(input.activities);

  if (faces.length === 0) {
    return { state: 'unknown', reason: 'no-face' };
  }
  const near = identify(distanceTable(await approvedFaces(env), faces, parts));
  if (!near) {
    return { state: 'unknown', reason: 'not-registered' };
  }
  near.dist = near.d.full;
  // 換臉跡象：五官像本人、臉型不像
  const signals = [];
  const swapped = near.via === 'inner' || (near.d.inner <= INNER_CLOSE && near.d.outer >= OUTER_DIFFER);
  if (swapped) {
    signals.push({
      kind: 'swap',
      text: '五官很像本人，但臉型、下巴或髮際線不像，可能是把本人的臉換到別人身上（換臉）',
    });
  }
  const round = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

  const kol = await env.DB.prepare('SELECT * FROM kols WHERE id = ?').bind(near.kol_id).first();
  const accounts = await accountsOf(env, kol.id);
  const profile = publicKol(kol, accounts);
  const statement = JSON.parse(kol.statement || '{}');
  const reasons = [];

  // 1. 本人已確認過同一張圖
  let confirmed = null;
  if (bits) {
    const { results } = await env.DB.prepare(
      "SELECT id, phash, status, kol_note, decided_at FROM reports WHERE kol_id = ? AND status IN ('fake', 'authorized') ORDER BY decided_at DESC LIMIT 500",
    )
      .bind(kol.id)
      .all();
    for (const r of results) {
      if (hamming(bits, hexToBits(r.phash)) <= HASH_SAME) {
        confirmed = r;
        break;
      }
    }
  }

  // 2. 帳號是否在官方名單
  let account = 'not-given';
  if (handle) {
    const hit = accounts.find((a) => a.platform === platform && a.handle === handle);
    if (!hit) {
      account = 'not-official';
      reasons.push({ kind: 'account', text: '這個帳號不在本人聲明的官方帳號名單裡' });
    } else account = hit.verified ? 'official' : 'listed-unverified';
  }

  // 3. 對方要你做的事，是否為本人聲明不做的
  const conflicts = activities.filter((a) => (statement.never || []).includes(a));
  for (const a of conflicts) reasons.push({ kind: 'activity', text: `本人聲明不會「${ACTIVITIES[a]}」` });

  let state;
  if (confirmed && confirmed.status === 'fake') state = 'confirmed-fake';
  else if (confirmed && confirmed.status === 'authorized') state = 'confirmed-authorized';
  else if (reasons.length) state = 'conflict';
  else if (account === 'official') state = 'official-account';
  else state = 'unknown';

  return {
    state,
    reason: state === 'unknown' ? 'registered-no-evidence' : undefined,
    kol: profile,
    face_distance: round(near.dist),
    part_distance: { inner: round(near.d.inner), outer: round(near.d.outer) },
    matched_by: near.via,
    account,
    reasons,
    signals,
    confirmed: confirmed ? { id: confirmed.id, kol_note: confirmed.kol_note, decided_at: confirmed.decided_at } : null,
  };
}

async function submitReport(env, request) {
  await limit(env, request, 'report', 10, 3600);
  const input = await body(request);
  if (input.consent !== true) throw bad('需要同意把截圖交給當事人確認');
  const kolId = str(input.kol_id, 32, '當事人');
  const kol = await env.DB.prepare("SELECT id FROM kols WHERE id = ? AND status = 'approved'").bind(kolId).first();
  if (!kol) throw bad('找不到這位登錄者');
  // 再比一次臉，避免把回報塞給不相干的登錄者
  if (!Array.isArray(input.faces) || input.faces.length === 0 || input.faces.length > 20) throw bad('臉部特徵格式不正確');
  const faces = input.faces.map(descriptor);
  const parts = partsOf(input.parts, faces.length);
  const { results } = await env.DB.prepare('SELECT kol_id, kind, descriptor FROM kol_faces WHERE kol_id = ?').bind(kolId).all();
  const table = distanceTable(
    results.map((r) => ({ kol_id: r.kol_id, kind: r.kind, d: JSON.parse(r.descriptor) })),
    faces,
    parts,
  );
  if (!identify(table)) throw bad('截圖上的臉與這位登錄者不符');

  hexToBits(input.phash);
  const image = str(input.image, MAX_IMAGE_CHARS, '截圖');
  if (image && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) throw bad('截圖格式不正確');
  const platform = input.platform ? platformOf(input.platform) : '';
  const sourceUrl = str(input.source_url, 500, '網址');
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw bad('網址要以 http:// 或 https:// 開頭');
  const id = randomHex(6);
  await env.DB.prepare(
    'INSERT INTO reports (id, kol_id, phash, sha256, image, source_url, platform, handle, activities, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      kolId,
      input.phash,
      /^[0-9a-f]{64}$/.test(input.sha256 || '') ? input.sha256 : '',
      image,
      sourceUrl,
      platform,
      str(input.handle, 200, '帳號'),
      JSON.stringify(activitiesOf(input.activities)),
      str(input.note, 500, '補充說明'),
      now(),
    )
    .run();
  return { id };
}

async function reportStatus(env, reportId) {
  if (!/^[0-9a-f]{12}$/.test(reportId)) throw bad('回報編號不正確');
  const r = await env.DB.prepare(
    'SELECT r.id, r.status, r.kol_note, r.created_at, r.decided_at, k.display_name FROM reports r JOIN kols k ON k.id = r.kol_id WHERE r.id = ?',
  )
    .bind(reportId)
    .first();
  if (!r) throw new HttpError(404, '找不到這個回報編號');
  return r;
}

// ---------- 管理員 ----------

async function adminList(env, request, url) {
  requireAdmin(env, request);
  const status = url.searchParams.get('status') || 'pending';
  const { results } = await env.DB.prepare(
    'SELECT k.*, (SELECT COUNT(*) FROM kol_faces f WHERE f.kol_id = k.id) AS faces, (SELECT COUNT(*) FROM reports r WHERE r.kol_id = k.id) AS reports FROM kols k WHERE status = ? ORDER BY created_at DESC LIMIT 200',
  )
    .bind(status)
    .all();
  const out = [];
  for (const k of results) {
    out.push({ ...privateKol(k, await accountsOf(env, k.id)), faces: k.faces, reports: k.reports });
  }
  return out;
}

async function adminSetStatus(env, request, kolId) {
  requireAdmin(env, request);
  const { status } = await body(request);
  if (!['approved', 'rejected', 'pending'].includes(status)) throw bad('狀態不正確');
  const r = await env.DB.prepare('UPDATE kols SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), kolId).run();
  if (!r.meta.changes) throw new HttpError(404, '找不到這位登錄者');
  return { id: kolId, status };
}

async function adminVerifyAccount(env, request, accountId) {
  requireAdmin(env, request);
  const { verified } = await body(request);
  const r = await env.DB.prepare('UPDATE kol_accounts SET verified = ?, verified_by = ? WHERE id = ?')
    .bind(verified ? 1 : 0, verified ? 'admin' : '', accountId)
    .run();
  if (!r.meta.changes) throw new HttpError(404, '找不到這個帳號');
  return { id: Number(accountId), verified: !!verified };
}

// ---------- 轉送服務 ----------

function safeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw bad('網址格式不正確');
  }
  if (!/^https?:$/.test(url.protocol)) throw bad('只接受 http 與 https');
  if (/^(localhost$|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(url.hostname) || url.hostname.endsWith('.local')) {
    throw bad('不接受這個位址');
  }
  return url;
}

async function proxy(env, request, url, cors) {
  await limit(env, request, 'proxy', 300, 600);
  const target = safeUrl(url.searchParams.get('url'));
  const res = await fetch(target.href, {
    headers: { 'User-Agent': 'TraceBackPrototype/0.2', Accept: 'text/html,image/*' },
    redirect: 'follow',
  });
  const type = res.headers.get('content-type') || '';
  if (!/^(text\/html|image\/)/.test(type)) throw new HttpError(415, '只轉送網頁與圖片');
  if (Number(res.headers.get('content-length') || 0) > 5 * 1024 * 1024) throw new HttpError(413, '檔案太大');
  return new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

// ---------- 路由 ----------

async function route(request, env, cors) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;
  let p;

  if (m === 'GET' && (path === '/' || path === '/api/health')) return { ok: true, service: 'traceback-api' };
  if (m === 'GET' && path === '/api/meta') return { activities: ACTIVITIES, platforms: PLATFORMS };
  if (m === 'GET' && path === '/api/proxy') return proxy(env, request, url, cors);

  if (m === 'POST' && path === '/api/kol/register') return register(env, request);
  if (m === 'GET' && path === '/api/kol/me') return getMe(env, request);
  if (m === 'PUT' && path === '/api/kol/me') return updateMe(env, request);
  if (m === 'DELETE' && path === '/api/kol/me') return deleteMe(env, request);
  if (m === 'GET' && path === '/api/kol/reports') return myReports(env, request);
  if (m === 'POST' && (p = path.match(/^\/api\/kol\/accounts\/(\d+)\/verify$/))) return verifyAccount(env, request, p[1]);
  if (m === 'POST' && (p = path.match(/^\/api\/kol\/reports\/([0-9a-f]{12})$/))) return decide(env, request, p[1]);

  if (m === 'POST' && path === '/api/check') return check(env, request);
  if (m === 'POST' && path === '/api/reports') return submitReport(env, request);
  if (m === 'GET' && (p = path.match(/^\/api\/reports\/([^/]+)$/))) return reportStatus(env, p[1]);

  if (m === 'GET' && path === '/api/admin/kols') return adminList(env, request, url);
  if (m === 'POST' && (p = path.match(/^\/api\/admin\/kols\/([0-9a-f]{16})$/))) return adminSetStatus(env, request, p[1]);
  if (m === 'POST' && (p = path.match(/^\/api\/admin\/accounts\/(\d+)$/))) return adminVerifyAccount(env, request, p[1]);

  throw new HttpError(404, '沒有這個路徑');
}

export default {
  async fetch(request, env) {
    const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const allowed = origins.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : origins[0] || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    // 有帶 Origin 的請求必須來自允許的網站；沒有 Origin 的（例如 curl）只能讀健康檢查
    const path = new URL(request.url).pathname;
    if (!allowed && !(request.method === 'GET' && (path === '/' || path === '/api/health'))) {
      return json({ error: '來源不在允許清單' }, 403, cors);
    }
    try {
      const out = await route(request, env, cors);
      return out instanceof Response ? out : json(out, 200, cors);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: '伺服器發生錯誤' }, 500, cors);
    }
  },

  // 清掉過期的截圖與沒人處理的回報
  async scheduled(_event, env) {
    const day = 86_400_000;
    await env.DB.batch([
      env.DB.prepare("UPDATE reports SET image = '' WHERE status != 'pending' AND decided_at < ?").bind(now() - IMAGE_KEEP_DAYS * day),
      env.DB.prepare("DELETE FROM reports WHERE status = 'pending' AND created_at < ?").bind(now() - PENDING_KEEP_DAYS * day),
      // 流量限制的時段最長一小時，每天清空即可
      env.DB.prepare('DELETE FROM rate'),
    ]);
  },
};
