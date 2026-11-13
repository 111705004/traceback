// 本人登錄與管理：自拍綁定、加入照片、官方帳號與聲明、民眾回報收件匣。
import * as M from './matching.js';
import { faceParts } from './faceparts.js';
import { api, hasBackend, ACTIVITIES, PLATFORMS, $, esc, icon, setStatus, setLine, oops, setupDrop, copyCanvas, platformOptions, accountLink, fmtTime } from './api.js';

const MAX_PHOTOS = 11;

const state = {
  selfie: null,
  selfieParts: null,
  refs: [], // { name, face }
  stream: null,
  token: '',
  me: null,
  mode: 'register', // register 或 edit
};

const VIEWS = ['intro', 'bind', 'photos', 'profile', 'done', 'manage'];
function show(id) {
  for (const v of VIEWS) $(v).hidden = v !== id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 自拍 ----------

function stopCamera() {
  if (state.stream) for (const t of state.stream.getTracks()) t.stop();
  state.stream = null;
  $('video').hidden = true;
  $('camera-shot').hidden = true;
  $('camera-start').hidden = false;
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    const video = $('video');
    video.srcObject = state.stream;
    video.hidden = false;
    $('selfie-preview').hidden = true;
    await video.play();
    $('camera-start').hidden = true;
    $('camera-shot').hidden = false;
  } catch (_) {
    setLine('bind-result', '打不開鏡頭。請在瀏覽器允許使用鏡頭，或改用上傳自拍照。', 'bad');
  }
}

async function processSelfie(canvas) {
  $('bind-next').disabled = true;
  state.selfie = null;
  setStatus('正在看這張自拍。第一次需要下載模型，請等一下');
  try {
    const faces = await M.faceDescriptors(canvas);
    setStatus('');
    if (faces.length === 0) return setLine('bind-result', '這張照片裡找不到臉。請面對鏡頭、找個亮一點的地方，再試一次。', 'bad');
    if (faces.length > 1) return setLine('bind-result', '畫面裡不只一張臉。請只拍你自己。', 'bad');
    state.selfie = Array.from(faces[0]);
    state.selfieParts = (await faceParts(canvas))[0] || null;
    const preview = $('selfie-preview');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    preview.hidden = false;
    setLine('bind-result', '好了，認得你了。', 'ok');
    $('bind-next').disabled = false;
    // 換了自拍，之前加的照片要重新檢查
    state.refs = [];
    $('ref-list').innerHTML = '';
  } catch (err) {
    oops(err);
  }
}

// ---------- 照片 ----------

async function addPhotos(files) {
  for (const file of files) {
    if (state.refs.length >= MAX_PHOTOS) {
      setStatus('');
      return oops(new Error(`照片最多 ${MAX_PHOTOS} 張。`));
    }
    const li = document.createElement('li');
    li.innerHTML = `<div class="name">${esc(file.name)}</div><div class="state">檢查中</div>`;
    $('ref-list').appendChild(li);
    const stateEl = li.querySelector('.state');
    try {
      setStatus(`正在檢查 ${file.name}`);
      const canvas = M.toCanvas(await M.fileToImage(file), 640);
      li.prepend(copyCanvas(canvas));
      const faces = await M.faceDescriptors(canvas);
      const dists = faces.map((f) => M.faceDistance(state.selfie, f));
      const best = dists.length ? Math.min(...dists) : null;
      if (best === null) {
        stateEl.textContent = '沒有加入：找不到臉';
        stateEl.className = 'state bad';
      } else if (best > M.THRESHOLDS.faceSame) {
        stateEl.textContent = '沒有加入：和自拍不是同一張臉';
        stateEl.className = 'state bad';
      } else {
        const index = dists.indexOf(best);
        const parts = await faceParts(canvas);
        const ref = {
          name: file.name,
          face: Array.from(faces[index]),
          parts: parts.length === faces.length ? parts[index] : null,
        };
        state.refs.push(ref);
        stateEl.textContent = '已加入';
        stateEl.className = 'state ok';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.setAttribute('aria-label', `移除 ${file.name}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          state.refs = state.refs.filter((r) => r !== ref);
          li.remove();
          $('photos-next').disabled = state.refs.length === 0;
        });
        li.appendChild(remove);
      }
    } catch (err) {
      stateEl.textContent = '沒有加入：讀不了這個檔案';
      stateEl.className = 'state bad';
      console.error(err);
    }
  }
  setStatus('');
  $('photos-next').disabled = state.refs.length === 0;
}

// ---------- 資料與聲明 ----------

function accountRow(a = { platform: 'threads', handle: '', url: '' }) {
  const li = document.createElement('li');
  li.innerHTML = `
    <label class="field"><span>平台</span><select data-k="platform">${platformOptions(a.platform)}</select></label>
    <label class="field"><span>帳號 ID</span><input type="text" data-k="handle" maxlength="120" autocomplete="off" placeholder="@帳號 或 LINE ID" value="${esc(a.handle)}"></label>
    <label class="field"><span>帳號網址（驗證用）</span><input type="url" data-k="url" maxlength="300" autocomplete="off" placeholder="https://" value="${esc(a.url)}"></label>
    <button type="button" class="small remove-account" aria-label="移除這個帳號">移除</button>`;
  li.querySelector('.remove-account').addEventListener('click', () => li.remove());
  $('accounts').appendChild(li);
}

function fillProfile(me) {
  $('display-name').value = me?.display_name || '';
  $('title').value = me?.title || '';
  $('note').value = me?.note || '';
  $('accounts').innerHTML = '';
  const accounts = me?.accounts?.length ? me.accounts : [undefined];
  for (const a of accounts) accountRow(a && { platform: a.platform, handle: a.label, url: a.url });
  const never = new Set((me?.never || []).map((n) => n.key));
  for (const i of document.querySelectorAll('#never input')) i.checked = me ? never.has(i.value) : ['line-group', 'stock-tips', 'private-dm', 'transfer'].includes(i.value);
}

function readProfile() {
  const accounts = [...$('accounts').children]
    .map((li) => ({
      platform: li.querySelector('[data-k=platform]').value,
      handle: li.querySelector('[data-k=handle]').value.trim(),
      url: li.querySelector('[data-k=url]').value.trim(),
    }))
    .filter((a) => a.handle);
  return {
    display_name: $('display-name').value.trim(),
    title: $('title').value.trim(),
    note: $('note').value.trim(),
    never: [...document.querySelectorAll('#never input:checked')].map((i) => i.value),
    accounts,
  };
}

function openProfile(mode) {
  state.mode = mode;
  $('consents').hidden = mode !== 'register';
  $('profile-title').textContent = mode === 'register' ? '官方帳號與聲明' : '修改官方帳號與聲明';
  $('profile-submit').textContent = mode === 'register' ? '送出登錄' : '儲存';
  $('profile-back').textContent = mode === 'register' ? '上一步' : '取消';
  setLine('profile-result', '', '');
  if (mode === 'edit') fillProfile(state.me);
  show('profile');
}

async function submitProfile() {
  const p = readProfile();
  if (!p.display_name) return setLine('profile-result', '請填寫名稱。', 'bad');
  const bad = p.accounts.find((a) => a.url && !/^https:\/\//i.test(a.url));
  if (bad) return setLine('profile-result', '帳號網址要以 https:// 開頭。', 'bad');
  if (state.mode === 'register') {
    if (!['consent-public', 'consent-data', 'consent-self'].every((id) => $(id).checked)) {
      return setLine('profile-result', '請勾選三項同意事項。', 'bad');
    }
  }
  $('profile-submit').disabled = true;
  setStatus('正在送出');
  try {
    if (state.mode === 'register') {
      const r = await api('/api/kol/register', {
        method: 'POST',
        body: {
          ...p,
          consent: true,
          selfie: state.selfie,
          faces: state.refs.map((x) => x.face),
          parts: [state.selfieParts, ...state.refs.map((x) => x.parts)],
        },
      });
      state.token = r.token;
      const link = `${location.origin}${location.pathname}#token=${r.token}`;
      $('manage-link').value = link;
      show('done');
    } else {
      state.me = await api('/api/kol/me', { method: 'PUT', body: p, token: state.token });
      renderManage();
      show('manage');
    }
  } catch (err) {
    setLine('profile-result', err.message, 'bad');
  } finally {
    setStatus('');
    $('profile-submit').disabled = false;
  }
}

// ---------- 管理 ----------

const KOL_STATUS = {
  pending: { cls: 'likely', icon: 'help', title: '審核中', text: '管理員確認後就會開放民眾查證。審核期間你可以先驗證官方帳號。' },
  approved: { cls: 'calm', icon: 'shield', title: '已開放民眾查證', text: '民眾上傳的截圖比對到你時，會看到你的官方帳號與聲明。' },
  rejected: { cls: 'strong', icon: 'alert', title: '審核沒有通過', text: '目前不會出現在查證結果中。如有疑問請聯絡主辦團隊。' },
};

function renderManage() {
  const me = state.me;
  $('manage-name').textContent = `${me.display_name} 的登錄`;
  const s = KOL_STATUS[me.status] || KOL_STATUS.pending;
  $('manage-status').className = `verdict ${s.cls}`;
  $('manage-status').innerHTML = `${icon(s.icon)}<div><strong>${s.title}</strong><p>${s.text}</p></div>`;

  $('verify-list').innerHTML = '';
  if (!me.accounts.length) $('verify-list').innerHTML = '<li class="note">還沒有官方帳號。可以在「修改資料」加入。</li>';
  for (const a of me.accounts) {
    const li = document.createElement('li');
    li.innerHTML = `<div>${accountLink(a)}</div>
      ${a.verified ? `<small>${a.verified_by === 'admin' ? '管理員人工確認' : '已讀到驗證碼'}</small>` : `<small>驗證碼：<code>${esc(a.code)}</code></small>`}
      <p class="result-line"></p>`;
    if (!a.verified) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'small';
      btn.textContent = '檢查';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const line = li.querySelector('.result-line');
        try {
          const r = await api(`/api/kol/accounts/${a.id}/verify`, { method: 'POST', token: state.token });
          if (r.verified) {
            await loadMe();
          } else {
            line.textContent = r.reason;
            line.className = 'result-line bad';
          }
        } catch (err) {
          line.textContent = err.message;
          line.className = 'result-line bad';
        } finally {
          btn.disabled = false;
        }
      });
      li.appendChild(btn);
    }
    $('verify-list').appendChild(li);
  }
}

const REPORT_STATUS = { pending: '待確認', fake: '已確認冒用', authorized: '已確認授權', dismissed: '與我無關' };

async function loadInbox() {
  const list = $('inbox');
  try {
    const reports = await api('/api/kol/reports', { token: state.token });
    const pending = reports.filter((r) => r.status === 'pending').length;
    $('inbox-count').textContent = pending ? `${pending} 則待確認` : '沒有待確認';
    list.innerHTML = reports.length ? '' : '<li class="note">還沒有民眾回報。</li>';
    for (const r of reports) {
      const li = document.createElement('li');
      li.className = `report-${r.status}`;
      const acts = r.activities.map((a) => ACTIVITIES[a]).filter(Boolean);
      li.innerHTML = `
        ${r.image ? `<img src="${esc(r.image)}" alt="民眾回報的截圖">` : '<div class="note">截圖已到期刪除</div>'}
        <div class="inbox-body">
          <strong>${REPORT_STATUS[r.status]}</strong>
          <dl class="record">
            <dt>回報時間</dt><dd>${esc(fmtTime(r.created_at))}</dd>
            ${r.platform || r.handle ? `<dt>帳號</dt><dd>${esc(PLATFORMS[r.platform] || '')} ${esc(r.handle)}</dd>` : ''}
            ${r.source_url ? `<dt>網址</dt><dd>${esc(r.source_url)}</dd>` : ''}
            ${acts.length ? `<dt>對方要求</dt><dd>${acts.map(esc).join('、')}</dd>` : ''}
            ${r.note ? `<dt>民眾說明</dt><dd>${esc(r.note)}</dd>` : ''}
            ${r.sha256 ? `<dt>SHA-256</dt><dd><code>${esc(r.sha256)}</code></dd>` : ''}
          </dl>
          <label class="field"><span>給民眾看的說明（可留白）</span><input type="text" maxlength="300" value="${esc(r.kol_note)}" placeholder="例如：我沒有開任何 LINE 群組"></label>
          <div class="row">
            <button type="button" class="small primary" data-s="fake">是冒用</button>
            <button type="button" class="small" data-s="authorized">是我授權的</button>
            <button type="button" class="small" data-s="dismissed">與我無關</button>
          </div>
        </div>`;
      for (const btn of li.querySelectorAll('[data-s]')) {
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/kol/reports/${r.id}`, {
              method: 'POST',
              token: state.token,
              body: { status: btn.dataset.s, kol_note: li.querySelector('input').value.trim() },
            });
            loadInbox();
          } catch (err) {
            oops(err);
          }
        });
      }
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = `<li class="result-line bad">${esc(err.message)}</li>`;
  }
}

async function loadMe() {
  state.me = await api('/api/kol/me', { token: state.token });
  renderManage();
}

async function openManage(token) {
  state.token = token;
  setStatus('正在讀取');
  try {
    await loadMe();
    show('manage');
    loadInbox();
  } catch (err) {
    show('intro');
    oops(err);
  } finally {
    setStatus('');
  }
}

async function deleteAll() {
  if (!confirm('確定要刪除全部資料嗎？臉部特徵、官方帳號、聲明與所有回報都會移除，無法復原。')) return;
  try {
    await api('/api/kol/me', { method: 'DELETE', token: state.token });
    state.token = '';
    history.replaceState(null, '', location.pathname);
    show('intro');
    alert('已刪除。');
  } catch (err) {
    oops(err);
  }
}

function tokenFrom(text) {
  const m = String(text).match(/token=([0-9a-f]{64})/);
  return m ? m[1] : '';
}

function init() {
  $('no-backend').hidden = hasBackend();
  $('start').disabled = !hasBackend();
  $('never').innerHTML = Object.entries(ACTIVITIES)
    .map(([k, v]) => `<label class="choice"><input type="checkbox" value="${k}"><span class="mark"></span><span class="body"><strong>${esc(v)}</strong></span></label>`)
    .join('');

  $('start').addEventListener('click', () => show('bind'));
  $('have-link').addEventListener('click', () => ($('link-box').hidden = false));
  $('link-open').addEventListener('click', () => {
    const t = tokenFrom($('link-input').value);
    if (!t) return oops(new Error('這不是有效的管理連結。'));
    history.replaceState(null, '', `#token=${t}`);
    openManage(t);
  });

  $('camera-start').addEventListener('click', startCamera);
  $('camera-shot').addEventListener('click', () => {
    const canvas = M.toCanvas($('video'), 640);
    stopCamera();
    processSelfie(canvas);
  });
  $('selfie-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    stopCamera();
    try {
      processSelfie(M.toCanvas(await M.fileToImage(file), 640));
    } catch (_) {
      setLine('bind-result', '讀不了這個檔案，請換一張試試。', 'bad');
    }
  });
  $('bind-back').addEventListener('click', () => {
    stopCamera();
    show('intro');
  });
  $('bind-next').addEventListener('click', () => show('photos'));

  setupDrop($('ref-drop'), $('ref-files'));
  $('ref-files').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) addPhotos(files).catch(oops);
  });
  $('photos-back').addEventListener('click', () => show('bind'));
  $('photos-next').addEventListener('click', () => {
    fillProfile(null);
    openProfile('register');
  });

  $('account-add').addEventListener('click', () => accountRow());
  $('profile-back').addEventListener('click', () => show(state.mode === 'register' ? 'photos' : 'manage'));
  $('profile-submit').addEventListener('click', submitProfile);

  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('manage-link').value);
      $('copy-link').textContent = '已複製';
    } catch (_) {
      $('manage-link').select();
    }
  });
  $('go-manage').addEventListener('click', () => {
    history.replaceState(null, '', `#token=${state.token}`);
    openManage(state.token);
  });

  $('inbox-refresh').addEventListener('click', loadInbox);
  $('edit').addEventListener('click', () => openProfile('edit'));
  $('delete').addEventListener('click', deleteAll);

  const t = tokenFrom(location.hash);
  if (t && hasBackend()) openManage(t);
}

init();
