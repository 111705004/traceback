// 民眾查證：上傳可疑截圖，比對登錄者，回傳四種狀態之一。
import * as M from './matching.js';
import { faceParts } from './faceparts.js';
import { readProvenance } from './provenance.js';
import { renderSignals, setupAiButton } from './signals.js';
import { api, hasBackend, ACTIVITIES, $, esc, icon, setStatus, setLine, oops, setupDrop, sha256File, platformOptions, accountLink, fmtTime } from './api.js';

const state = {
  file: null,
  canvas: null,
  faces: [],
  parts: [],
  provenance: null,
  phash: '',
  sha256: '',
  result: null,
  request: null,
};

function show(id) {
  $('form-view').hidden = id !== 'form-view';
  $('result-view').hidden = id !== 'result-view';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function setShot(file) {
  if (!file || !file.type.startsWith('image/')) return;
  state.file = file;
  state.faces = [];
  $('check').disabled = true;
  const drop = $('shot-drop');
  drop.classList.add('has-file');
  drop.querySelector('canvas')?.remove();
  $('shot-name').textContent = file.name || '貼上的截圖';
  setLine('shot-result', '', '');
  try {
    const img = await M.fileToImage(file);
    state.canvas = M.toCanvas(img, 800);
    const preview = M.toCanvas(state.canvas, 360);
    drop.insertBefore(preview, drop.querySelector('strong'));
    setStatus('正在找截圖裡的臉。第一次需要下載模型，請等一下');
    const small = M.toCanvas(state.canvas, 640);
    const faces = await M.faceDescriptors(small);
    state.faces = faces.map((f) => Array.from(f));
    state.parts = faces.length ? await faceParts(small) : [];
    // 兩次偵測的臉數不同時（很少見）就不做換臉檢查
    if (state.parts.length !== state.faces.length) state.parts = [];
    state.provenance = await readProvenance(file);
    state.phash = M.hashToHex(M.pHash(state.canvas));
    state.sha256 = await sha256File(file);
    setStatus('');
    if (!state.faces.length) {
      setLine('shot-result', '截圖裡找不到臉。可以換一張臉比較清楚的截圖，例如對方的頭像或個人頁。', 'bad');
    } else {
      setLine('shot-result', `找到 ${state.faces.length} 張臉，可以查證了。`, 'ok');
    }
    $('check').disabled = !hasBackend();
  } catch (err) {
    setStatus('');
    setLine('shot-result', '讀不了這個檔案，請換一張試試。', 'bad');
    console.error(err);
  }
}

function readForm() {
  const platform = $('platform').value;
  return {
    platform,
    handle: platform ? $('handle').value.trim() : '',
    source_url: $('source-url').value.trim(),
    activities: [...document.querySelectorAll('#activities input:checked')].map((i) => i.value),
  };
}

const VERDICTS = {
  'confirmed-fake': {
    cls: 'strong',
    icon: 'alert',
    title: (k) => `本人已確認：這是冒用 ${k.display_name} 的內容`,
    text: '本人已確認同一張圖不是本人發的。請不要加入群組或匯款，可以檢舉這則內容並打 165 通報。',
  },
  conflict: {
    cls: 'strong',
    icon: 'alert',
    title: (k) => `與 ${k.display_name} 本人的聲明不符，很可能是冒用`,
    text: '截圖上的人看起來是登錄者本人，但帳號或對方的要求和本人的聲明不一樣。這是轉述本人的聲明，不是系統的判斷。',
  },
  'confirmed-authorized': {
    cls: 'calm',
    icon: 'check',
    title: (k) => `${k.display_name} 本人已確認授權這則內容`,
    text: '授權只代表本人同意這則內容使用其照片，不代表投資或商品安全。',
  },
  'official-account': {
    cls: 'calm',
    icon: 'shield',
    title: (k) => `這是 ${k.display_name} 登錄並驗證過的官方帳號`,
    text: '帳號是本人的，但仍請自己判斷內容。本人的官方帳號也可能被盜，看到異常要求時請透過其他官方管道確認。',
  },
  'unknown-registered': {
    cls: 'likely',
    icon: 'help',
    title: (k) => `看起來是 ${k.display_name}，但還無法確認是不是本人發的`,
    text: '本人還沒看過這則內容。請直接透過下面的官方帳號詢問本人，也可以把截圖交給本人確認。',
  },
  'unknown-not-registered': {
    cls: '',
    icon: 'help',
    title: () => '無法確認，這個人不在登錄名單裡',
    text: '查不到不代表安全。詐騙常用沒有登錄的人的照片，請依下面的提醒判斷，或打 165 查證。',
  },
  'unknown-no-face': {
    cls: '',
    icon: 'help',
    title: () => '截圖裡認不出臉，無法比對',
    text: '可以換一張臉比較清楚的截圖，例如對方的頭像或個人頁。查不到不代表安全。',
  },
};

function verdictKey(r) {
  if (r.state !== 'unknown') return r.state;
  if (r.reason === 'registered-no-evidence') return 'unknown-registered';
  if (r.reason === 'no-face') return 'unknown-no-face';
  return 'unknown-not-registered';
}

function renderResult(r) {
  const key = verdictKey(r);
  const v = VERDICTS[key];
  const k = r.kol || {};
  const box = $('verdict');
  box.className = `verdict ${v.cls}`;
  let extra = '';
  if (r.confirmed && r.confirmed.kol_note) extra = `<p>本人說明：「${esc(r.confirmed.kol_note)}」（${esc(fmtTime(r.confirmed.decided_at))}）</p>`;
  if (r.matched_by === 'inner') {
    extra += `<p>完整的臉對不上，是靠五官認出來的：五官很像 ${esc(k.display_name)}，臉型卻不像，可能是換臉。</p>`;
  }
  if (key === 'unknown-registered' && r.account === 'listed-unverified') {
    extra += '<p>這個帳號在本人的官方帳號名單裡，但還沒完成帳號歸屬驗證。</p>';
  }
  box.innerHTML = `${icon(v.icon)}<div><strong>${esc(v.title(k))}</strong><p>${esc(v.text)}</p>${extra}</div>`;

  $('reasons-wrap').hidden = !r.reasons?.length;
  $('reasons').innerHTML = (r.reasons || []).map((x) => `<li>${esc(x.text)}</li>`).join('');

  $('kol-wrap').hidden = !r.kol;
  if (r.kol) {
    const accounts = k.accounts.length ? k.accounts.map((a) => `<div>${accountLink(a)}</div>`).join('') : '沒有填寫';
    const never = k.never.length ? k.never.map((n) => `<div>不會${esc(n.label)}</div>`).join('') : '沒有填寫';
    $('kol-record').innerHTML = `
      <dt>名稱</dt><dd>${esc(k.display_name)}${k.title ? `（${esc(k.title)}）` : ''}</dd>
      <dt>官方帳號</dt><dd>${accounts}</dd>
      <dt>本人聲明</dt><dd>${never}${k.note ? `<div>${esc(k.note)}</div>` : ''}</dd>`;
  }

  const pd = r.part_distance;
  renderSignals($('signals'), {
    provenance: state.provenance,
    swap: r.kol && pd && pd.inner !== null ? { found: r.signals?.some((s) => s.kind === 'swap'), who: k.display_name, inner: pd.inner, outer: pd.outer } : null,
  });
  $('ai-run').disabled = false;
  setLine('ai-result', '', '');

  // 本人還沒確認過的，才需要回報
  const canReport = r.kol && !r.confirmed;
  $('report-wrap').hidden = !canReport;
  $('report-consent').checked = false;
  $('report-send').disabled = true;
  setLine('report-result', '', '');
}

async function runCheck() {
  const form = readForm();
  state.request = form;
  $('check').disabled = true;
  setStatus('查證中');
  try {
    const r = await api('/api/check', {
      method: 'POST',
      body: { faces: state.faces, parts: state.parts.length ? state.parts : undefined, phash: state.phash, platform: form.platform || undefined, handle: form.handle, activities: form.activities },
    });
    state.result = r;
    renderResult(r);
    show('result-view');
  } catch (err) {
    oops(err);
  } finally {
    setStatus('');
    $('check').disabled = false;
  }
}

function reportImage() {
  // 縮小再存，保留足夠讓本人辨認的大小
  for (const [side, q] of [[800, 0.8], [640, 0.7], [480, 0.6]]) {
    const url = M.toCanvas(state.canvas, side).toDataURL('image/jpeg', q);
    if (url.length < 600_000) return url;
  }
  return '';
}

async function sendReport() {
  const form = state.request;
  $('report-send').disabled = true;
  setStatus('正在送出');
  try {
    const r = await api('/api/reports', {
      method: 'POST',
      body: {
        consent: true,
        kol_id: state.result.kol.id,
        faces: state.faces,
        parts: state.parts.length ? state.parts : undefined,
        phash: state.phash,
        sha256: state.sha256,
        image: reportImage(),
        platform: form.platform || undefined,
        handle: form.handle,
        source_url: form.source_url,
        activities: form.activities,
        note: $('report-note').value.trim(),
      },
    });
    setLine('report-result', `已交給本人。回報編號：${r.id}。請記下來，之後可以在下面查詢處理進度。`, 'ok');
    $('lookup-id').value = r.id;
  } catch (err) {
    setLine('report-result', err.message, 'bad');
    $('report-send').disabled = false;
  } finally {
    setStatus('');
  }
}

const REPORT_STATUS = {
  pending: '本人還沒處理',
  fake: '本人已確認：這是冒用',
  authorized: '本人已確認：這是授權的內容',
  dismissed: '本人表示與他無關',
};

async function lookup() {
  const id = $('lookup-id').value.trim().toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(id)) return setLine('lookup-result', '回報編號是 12 碼的英文字母與數字。', 'bad');
  try {
    const r = await api(`/api/reports/${id}`);
    const note = r.kol_note ? `本人說明：「${r.kol_note}」` : '';
    setLine('lookup-result', `回報給 ${r.display_name}，${fmtTime(r.created_at)} 送出。狀態：${REPORT_STATUS[r.status] || r.status}。${note}`, r.status === 'fake' ? 'bad' : 'ok');
  } catch (err) {
    setLine('lookup-result', err.message, 'bad');
  }
}

function reset() {
  state.file = null;
  state.faces = [];
  state.result = null;
  const drop = $('shot-drop');
  drop.classList.remove('has-file');
  drop.querySelector('canvas')?.remove();
  $('shot-name').textContent = '點這裡選檔案、把圖拖進來，或直接貼上截圖';
  setLine('shot-result', '', '');
  $('check').disabled = true;
  for (const i of document.querySelectorAll('#activities input')) i.checked = false;
  $('report-note').value = '';
  show('form-view');
}

function init() {
  $('platform').insertAdjacentHTML('beforeend', platformOptions());
  $('activities').innerHTML = Object.entries(ACTIVITIES)
    .map(
      ([k, v]) =>
        `<label class="choice"><input type="checkbox" value="${k}"><span class="mark"></span><span class="body"><strong>${esc(v)}</strong></span></label>`,
    )
    .join('');
  $('no-backend').hidden = hasBackend();
  $('help-open').addEventListener('click', () => $('help').showModal());

  setupDrop($('shot-drop'), $('shot-file'));
  $('shot-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) setShot(file);
  });
  document.addEventListener('paste', (e) => {
    if (!$('form-view').hidden) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) setShot(item.getAsFile());
    }
  });
  $('check').addEventListener('click', runCheck);
  setupAiButton($('ai-run'), $('ai-result'), () => state.canvas, (level) => {
    if (level === 'low') return '請以上面的查證結果為準。';
    if (!$('report-wrap').hidden) {
      setTimeout(() => $('report-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' }), 600);
      return '下一步：不要加入群組或匯款，把截圖交給本人確認（在下方）。';
    }
    return '下一步：不要加入群組或匯款，有疑問請打 165。';
  });
  $('report-consent').addEventListener('change', (e) => ($('report-send').disabled = !e.target.checked));
  $('report-send').addEventListener('click', sendReport);
  $('again').addEventListener('click', reset);
  $('lookup').addEventListener('click', lookup);

  // 從 LINE 等地方分享過來的連結可以帶回報編號：verify.html#r=xxxx
  const m = location.hash.match(/r=([0-9a-f]{12})/);
  if (m) {
    $('lookup-id').value = m[1];
    lookup();
  }
}

init();
