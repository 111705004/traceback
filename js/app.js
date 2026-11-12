import * as M from './matching.js';
import { SCENARIOS, legalPath, buildDocuments, RESOURCES } from './templates.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ORDER = ['bind', 'library', 'case', 'result', 'evidence', 'action'];

const state = {
  selfie: null, // 自拍的臉部特徵向量
  refs: [], // 通過本人比對的參考照
  suspectFile: null,
  suspect: null,
  results: [],
  best: null,
  evidence: null,
  stream: null,
};

// ---------- 共用 ----------

function show(view) {
  for (const el of document.querySelectorAll('.view')) el.hidden = el.id !== view;
  const idx = ORDER.indexOf(view);
  $('steps').hidden = idx < 0;
  for (const li of document.querySelectorAll('#steps li')) {
    const i = ORDER.indexOf(li.dataset.step);
    li.classList.toggle('current', i === idx);
    li.classList.toggle('done', i < idx);
    if (i === idx) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

function setStatus(text) {
  $('status').hidden = !text;
  $('status').textContent = text || '';
}

function fail(err) {
  console.error(err);
  setStatus('');
  alert(`發生錯誤：${err && err.message ? err.message : err}\n請重新整理頁面後再試一次。`);
}

async function sha256(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function copyCanvas(source) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  c.getContext('2d').drawImage(source, 0, 0);
  return c;
}

function localDateTimeValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 步驟一：確認本人 ----------

function stopCamera() {
  if (state.stream) {
    for (const t of state.stream.getTracks()) t.stop();
    state.stream = null;
  }
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
  } catch (err) {
    setBindResult('無法開啟鏡頭。請允許使用鏡頭，或改用上傳自拍照。', 'bad');
  }
}

function setBindResult(text, kind) {
  const el = $('bind-result');
  el.textContent = text;
  el.className = `result-line ${kind || ''}`;
}

async function processSelfie(canvas) {
  setBindResult('', '');
  $('bind-next').disabled = true;
  state.selfie = null;
  setStatus('正在載入人臉模型並分析，第一次需要一點時間');
  try {
    const faces = await M.faceDescriptors(canvas);
    setStatus('');
    if (faces.length === 0) return setBindResult('找不到臉。請面對鏡頭、光線充足後再試一次。', 'bad');
    if (faces.length > 1) return setBindResult('畫面中有不只一張臉。請只拍你自己。', 'bad');
    state.selfie = faces[0];
    const preview = $('selfie-preview');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    preview.hidden = false;
    setBindResult('已確認。接下來加入的照片都要與這張臉相符。', 'ok');
    $('bind-next').disabled = false;
  } catch (err) {
    fail(err);
  }
}

// ---------- 步驟二：參考照片 ----------

async function addReferences(files) {
  const list = $('ref-list');
  for (const file of files) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="name">${esc(file.name)}</div><div class="state">分析中</div>`;
    list.appendChild(li);
    try {
      setStatus(`正在檢查 ${file.name}`);
      const img = await M.fileToImage(file);
      const canvas = M.toCanvas(img, 640);
      li.prepend(copyCanvas(canvas));
      const faces = await M.faceDescriptors(canvas);
      const dist = M.closestFace([state.selfie], faces);
      const stateEl = li.querySelector('.state');
      if (dist === null) {
        stateEl.textContent = '未加入：照片中找不到臉';
        stateEl.className = 'state bad';
      } else if (dist > M.THRESHOLDS.faceSame) {
        stateEl.textContent = '未加入：與自拍不是同一張臉';
        stateEl.className = 'state bad';
      } else {
        state.refs.push({
          name: file.name,
          canvas,
          faces,
          hash: M.pHash(canvas),
          embedding: null,
          sha256: await sha256(file),
        });
        stateEl.textContent = '已加入';
        stateEl.className = 'state ok';
      }
    } catch (err) {
      const stateEl = li.querySelector('.state');
      stateEl.textContent = '未加入：無法讀取這個檔案';
      stateEl.className = 'state bad';
      console.error(err);
    }
  }
  setStatus('');
  $('library-next').disabled = state.refs.length === 0;
}

// ---------- 步驟三：可疑內容 ----------

function renderScenarios() {
  const box = $('scenario');
  for (const [key, s] of Object.entries(SCENARIOS)) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="scenario" value="${key}"> ${esc(s.label)}<small>${esc(s.hint)}</small>`;
    box.appendChild(label);
  }
}

function selected(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function isMinorCase() {
  return selected('scenario') === 'intimate' && selected('minor') === 'yes';
}

function updateCaseForm() {
  const scenario = selected('scenario');
  const intimate = scenario === 'intimate';
  $('age-question').hidden = !intimate;
  const minor = isMinorCase();
  $('minor-callout').hidden = !minor;
  $('suspect-upload').hidden = minor;
  $('advertiser-field').hidden = !(scenario === 'scam' || scenario === 'endorsement');

  let ready = Boolean(scenario);
  if (intimate && !selected('minor')) ready = false;
  if (minor) ready = ready && $('source-url').value.trim() !== '';
  else ready = ready && Boolean(state.suspectFile);
  $('case-next').disabled = !ready;
  $('case-next').textContent = minor ? '記錄文字資訊' : '開始比對';
}

function readCase() {
  const scenario = selected('scenario');
  return {
    scenario,
    minor: isMinorCase(),
    displayName: $('display-name').value.trim(),
    sourceUrl: $('source-url').value.trim(),
    platform: $('platform').value.trim(),
    account: $('account').value.trim(),
    advertiser: scenario === 'scam' || scenario === 'endorsement' ? $('advertiser').value.trim() : '',
    foundAt: $('found-at').value ? $('found-at').value.replace('T', ' ') : '',
  };
}

// ---------- 步驟四：比對 ----------

const VERDICT_TEXT = {
  derived: (n) => `這張圖是由你的第 ${n} 張參考照而來。`,
  likely: (n) => `這張圖很可能是由你的第 ${n} 張參考照而來。`,
  similar: () => '整體構圖與你的照片相似，但找不到足夠的對應點，無法確認來源。',
  'face-only': () => '臉部與你相似，但不像是由參考庫裡的照片改造。可能是重新生成的，或來源照片不在參考庫。',
  none: () => '沒有找到與參考庫相符的照片。',
};

const PILL_TEXT = { high: '相符', mid: '部分相符', low: '不相符', na: '無法判斷' };

async function runCompare() {
  show('result');
  $('verdict').textContent = '';
  $('verdict').className = 'verdict';
  $('compare').innerHTML = '';
  $('layers').innerHTML = '';
  for (const r of document.querySelectorAll('input[name="confirm"]')) r.checked = false;
  $('result-next').disabled = true;
  try {
    setStatus('正在載入比對模型，第一次需要下載，請稍候');
    const img = await M.fileToImage(state.suspectFile);
    const canvas = M.toCanvas(img, 640);
    state.suspect = await M.describe(canvas);
    state.results = [];
    for (let i = 0; i < state.refs.length; i++) {
      setStatus(`正在比對第 ${i + 1} 張參考照，共 ${state.refs.length} 張`);
      const ref = state.refs[i];
      if (!ref.embedding) ref.embedding = await M.embed(ref.canvas);
      const r = await M.comparePair(ref, state.suspect);
      state.results.push({ index: i, ref, ...r });
    }
    state.results.sort((a, b) => b.rank - a.rank);
    state.best = state.results[0];
    setStatus('');
    renderResult();
  } catch (err) {
    fail(err);
  }
}

function figure(canvas, caption, blurred) {
  const fig = document.createElement('figure');
  fig.appendChild(canvas);
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.appendChild(cap);
  if (blurred) {
    fig.classList.add('blurred');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reveal';
    btn.textContent = '顯示';
    btn.addEventListener('click', () => {
      const on = fig.classList.toggle('blurred');
      btn.textContent = on ? '顯示' : '隱藏';
    });
    fig.appendChild(btn);
  }
  return fig;
}

function renderResult() {
  const b = state.best;
  const blur = selected('scenario') === 'intimate';
  const v = $('verdict');
  v.textContent = VERDICT_TEXT[b.verdict](b.index + 1);
  v.className = `verdict ${b.verdict === 'derived' ? 'strong' : b.verdict === 'likely' ? 'likely' : ''}`;

  const box = $('compare');
  box.appendChild(figure(copyCanvas(b.ref.canvas), `你的第 ${b.index + 1} 張參考照：${b.ref.name}`, false));
  box.appendChild(figure(copyCanvas(state.suspect.canvas), '可疑的圖', blur));
  if (b.local.overlay) {
    box.appendChild(figure(copyCanvas(b.local.overlay), '紅色是被改動的區域；變暗的是參考照沒有涵蓋的範圍', blur));
  }

  const changed =
    b.local.changedRatio === null ? '' : `，約 ${Math.round(b.local.changedRatio * 100)}% 的區域被改動`;
  const rows = [
    ['1', '感知雜湊', `64 位元中有 ${b.hashDistance} 位元不同`, b.layers.hash],
    ['2', '影像特徵向量', b.embedSim === null ? '未計算' : `相似度 ${b.embedSim.toFixed(2)}`, b.layers.embed],
    [
      '3',
      '局部特徵點與幾何驗證',
      `${b.local.good} 組配對中有 ${b.local.inliers} 組通過驗證${changed}`,
      b.layers.local,
    ],
    [
      '4',
      '人臉相似度',
      b.faceDist === null ? '其中一張圖找不到臉' : `距離 ${b.faceDist.toFixed(2)}，越小越像`,
      b.layers.face,
    ],
  ];
  $('layers').innerHTML =
    '<thead><tr><th>層</th><th>方法</th><th>數值</th><th>判斷</th></tr></thead><tbody>' +
    rows
      .map(
        ([n, name, value, level]) =>
          `<tr><td>${n}</td><td>${name}</td><td>${esc(value)}</td><td><span class="pill ${level}">${PILL_TEXT[level]}</span></td></tr>`,
      )
      .join('') +
    '</tbody>';
}

function matchSummary() {
  const b = state.best;
  if (!b) return '';
  const confirm = selected('confirm');
  const confirmText = confirm === 'yes' ? '本人確認為自己的照片' : '本人尚未確認';
  if (b.verdict === 'derived' || b.verdict === 'likely') {
    const changed =
      b.local.changedRatio === null ? '' : `，約 ${Math.round(b.local.changedRatio * 100)}% 的區域經改動`;
    return `與本人的參考照「${b.ref.name}」相符（${b.local.inliers} 組特徵點通過幾何驗證${changed}）；${confirmText}`;
  }
  return `自動比對未能確認來源；${confirmText}`;
}

// ---------- 步驟五：存證 ----------

async function buildEvidence() {
  const c = readCase();
  const now = new Date();
  const ev = {
    id: `TB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: now.toISOString(),
    clockNote: '時間取自裝置時鐘，未經第三方時間戳驗證',
    scenario: c.scenario,
    scenarioLabel: SCENARIOS[c.scenario].label,
    minor: c.minor,
    displayName: c.displayName,
    sourceUrl: c.sourceUrl,
    platform: c.platform,
    account: c.account,
    advertiser: c.advertiser,
    foundAt: c.foundAt,
  };
  if (!c.minor && state.suspectFile) {
    ev.suspect = {
      fileName: state.suspectFile.name,
      bytes: state.suspectFile.size,
      sha256: await sha256(state.suspectFile),
      perceptualHash: M.hashToHex(state.suspect.hash),
    };
    const b = state.best;
    ev.match = {
      summary: matchSummary(),
      verdict: b.verdict,
      userConfirmation: selected('confirm'),
      referenceFile: b.ref.name,
      referenceSha256: b.ref.sha256,
      hashDistance: b.hashDistance,
      embeddingSimilarity: b.embedSim === null ? null : Number(b.embedSim.toFixed(4)),
      localMatches: b.local.good,
      localInliers: b.local.inliers,
      changedRatio: b.local.changedRatio === null ? null : Number(b.local.changedRatio.toFixed(4)),
      faceDistance: b.faceDist === null ? null : Number(b.faceDist.toFixed(4)),
    };
  }
  state.evidence = ev;
  renderEvidence();
}

function evidenceRows(ev) {
  const rows = [
    ['紀錄編號', ev.id],
    ['建立時間', `${new Date(ev.createdAt).toLocaleString('zh-TW')}（${ev.clockNote}）`],
    ['情況', ev.scenarioLabel],
    ['來源網址', ev.sourceUrl || '未填'],
    ['平台', ev.platform || '未填'],
    ['帳號或粉專名稱', ev.account || '未填'],
  ];
  if (ev.scenario === 'scam' || ev.scenario === 'endorsement') {
    rows.push(['刊登者或出資者', ev.advertiser || '未填']);
  }
  rows.push(['發現時間', ev.foundAt || '未填']);
  if (ev.suspect) {
    rows.push(['可疑影像檔名', ev.suspect.fileName]);
    rows.push(['可疑影像 SHA-256', ev.suspect.sha256]);
    rows.push(['參考照檔名', ev.match.referenceFile]);
    rows.push(['參考照 SHA-256', ev.match.referenceSha256]);
    rows.push(['比對結果', ev.match.summary]);
  } else if (ev.minor) {
    rows.push(['影像', '依設計不收取、不保存']);
  }
  return rows;
}

function renderEvidence() {
  const ev = state.evidence;
  $('record').innerHTML = evidenceRows(ev)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${/SHA-256/.test(k) ? `<code>${esc(v)}</code>` : esc(v)}</dd>`)
    .join('');
  $('include-images-wrap').hidden = !ev.suspect;
  $('include-images').checked = Boolean(ev.suspect) && ev.scenario !== 'intimate';
  show('evidence');
}

function printReport() {
  const ev = state.evidence;
  const rows = evidenceRows(ev)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('');
  let detail = '';
  let imgs = '';
  if (ev.match) {
    const m = ev.match;
    detail = `<h2>比對數值</h2><table>
      <tr><th>感知雜湊相異位元</th><td>${m.hashDistance} / 64</td></tr>
      <tr><th>影像特徵向量相似度</th><td>${m.embeddingSimilarity ?? '未計算'}</td></tr>
      <tr><th>特徵點配對</th><td>${m.localMatches} 組配對，${m.localInliers} 組通過幾何驗證</td></tr>
      <tr><th>改動面積比例</th><td>${m.changedRatio === null ? '未計算' : `${Math.round(m.changedRatio * 100)}%`}</td></tr>
      <tr><th>人臉距離</th><td>${m.faceDistance ?? '未偵測到臉'}</td></tr>
    </table>`;
    if ($('include-images').checked) {
      const b = state.best;
      const pic = (canvas, cap) =>
        `<figure><img src="${canvas.toDataURL('image/jpeg', 0.85)}" alt=""><figcaption>${esc(cap)}</figcaption></figure>`;
      imgs = `<h2>影像對照</h2><div class="imgs">${pic(b.ref.canvas, '本人的參考照')}${pic(state.suspect.canvas, '可疑的圖')}${b.local.overlay ? pic(b.local.overlay, '改動區域標示（紅色）') : ''}</div>`;
    }
  }
  $('report').innerHTML = `<h1>存證紀錄</h1><table>${rows}</table>${detail}${imgs}
    <p class="foot">本紀錄由「尋影 TraceBack」原型在使用者的裝置上產生。雜湊值可用來核對檔案是否與存證時相同。比對結果為自動分析加上本人確認，僅供參考，不是鑑定報告，也不是法律意見。</p>`;
  window.print();
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(state.evidence, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.evidence.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- 步驟六：行動 ----------

function renderAction() {
  const ev = state.evidence;
  $('legal-path').innerHTML = legalPath(ev.scenario)
    .map(
      (p) =>
        `<li><strong>${esc(p.title)}</strong><br>${esc(p.body)}${p.basis ? `<span class="basis">依據：${esc(p.basis)}</span>` : ''}</li>`,
    )
    .join('');

  const docs = buildDocuments({ ...ev, match: ev.match ? { summary: ev.match.summary } : null });
  const box = $('documents');
  box.innerHTML = '';
  if (ev.minor) {
    const warn = document.createElement('div');
    warn.className = 'callout';
    warn.innerHTML =
      '<strong>請直接撥打 113 或報警。</strong><p>涉及未滿 18 歲的影像時，請不要自行下載或轉傳，把網址交給社工與警方處理。</p>';
    box.appendChild(warn);
  }
  for (const d of docs) {
    const el = document.createElement('article');
    el.className = 'doc';
    el.innerHTML = `<header><strong>${esc(d.title)}</strong><button type="button">複製</button></header><p class="doc-note">${esc(d.note)}</p><pre>${esc(d.text)}</pre>`;
    const btn = el.querySelector('button');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(d.text);
        btn.textContent = '已複製';
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('pre'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = '已選取，請按複製';
      }
      setTimeout(() => (btn.textContent = '複製'), 2500);
    });
    box.appendChild(el);
  }

  const res = [...(ev.scenario === 'intimate' ? RESOURCES.intimate : []), ...RESOURCES.common];
  $('resources').innerHTML = res
    .map(
      (r) =>
        `<li><strong>${esc(r.name)}</strong><span>${esc(r.detail)}${r.url ? `　<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace('https://', ''))}</a>` : ''}</span></li>`,
    )
    .join('');
  show('action');
}

function resetCase() {
  state.suspectFile = null;
  state.suspect = null;
  state.results = [];
  state.best = null;
  state.evidence = null;
  for (const id of ['source-url', 'platform', 'account', 'advertiser']) $(id).value = '';
  $('found-at').value = localDateTimeValue();
  $('suspect-file').value = '';
  $('suspect-name').textContent = '';
  for (const r of document.querySelectorAll('input[name="scenario"], input[name="minor"]')) r.checked = false;
  updateCaseForm();
  show('case');
}

// ---------- 事件 ----------

function init() {
  renderScenarios();
  $('found-at').value = localDateTimeValue();
  $('steps').hidden = true;

  $('help-open').addEventListener('click', () => $('help').showModal());
  $('start-path1').addEventListener('click', () => show('bind'));

  $('camera-start').addEventListener('click', startCamera);
  $('camera-shot').addEventListener('click', () => {
    const canvas = M.toCanvas($('video'), 640);
    stopCamera();
    processSelfie(canvas);
  });
  $('selfie-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    stopCamera();
    try {
      processSelfie(M.toCanvas(await M.fileToImage(file), 640));
    } catch (err) {
      setBindResult('無法讀取這個檔案。', 'bad');
    }
  });
  $('bind-next').addEventListener('click', () => show('library'));

  $('ref-files').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) addReferences(files).catch(fail);
  });
  $('library-back').addEventListener('click', () => show('bind'));
  $('library-next').addEventListener('click', () => show('case'));

  $('case').addEventListener('change', updateCaseForm);
  $('source-url').addEventListener('input', updateCaseForm);
  $('suspect-file').addEventListener('change', (e) => {
    state.suspectFile = e.target.files[0] || null;
    $('suspect-name').textContent = state.suspectFile ? `已選擇：${state.suspectFile.name}` : '';
    updateCaseForm();
  });
  $('case-back').addEventListener('click', () => show('library'));
  $('case-next').addEventListener('click', () => {
    if (isMinorCase()) buildEvidence().catch(fail);
    else runCompare();
  });

  $('confirm').addEventListener('change', () => {
    const c = selected('confirm');
    $('result-next').disabled = !(c === 'yes' || c === 'unsure');
  });
  $('result-back').addEventListener('click', () => show('case'));
  $('result-next').addEventListener('click', () => buildEvidence().catch(fail));

  $('print-report').addEventListener('click', printReport);
  $('download-json').addEventListener('click', downloadJson);
  $('evidence-back').addEventListener('click', () => show(state.evidence && state.evidence.minor ? 'case' : 'result'));
  $('evidence-next').addEventListener('click', renderAction);

  $('action-back').addEventListener('click', () => show('evidence'));
  $('restart').addEventListener('click', resetCase);

  updateCaseForm();
}

init();
