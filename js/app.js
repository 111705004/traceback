import * as M from './matching.js';
import * as S from './search.js';
import { TESTSITE_URL } from './config.js';
import { SCENARIOS, legalPath, buildDocuments, RESOURCES } from './templates.js';
import { explainEdit } from './edits.js';
import { faceParts, partDistances, swapSignal } from './faceparts.js';
import { readProvenance, describeProvenance } from './provenance.js';
import { renderSignals, setupAiButton } from './signals.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// 兩條路徑各自的步驟順序
const FLOWS = {
  known: ['bind', 'library', 'case', 'result', 'evidence', 'action'],
  find: ['bind', 'library', 'idcheck', 'search', 'case', 'result', 'evidence', 'action'],
};
const STEP_NAMES = {
  bind: '確認是你本人',
  library: '加入你的照片',
  idcheck: '證件驗證',
  search: '幫你找找看',
  case: '發生了什麼事',
  result: '比對結果',
  evidence: '留下證據',
  action: '接下來怎麼做',
};

const state = {
  path: 'known',
  selfie: null, // 自拍的臉部特徵向量
  refs: [], // 通過本人比對的參考照
  idVerified: false,
  suspectFile: null,
  suspect: null,
  results: [],
  best: null,
  evidence: null,
  stream: null,
  search: null, // 目前這次搜尋的狀態
  fromSearch: null, // 從搜尋結果帶入的那一則
};

// ---------- 共用 ----------

function show(view) {
  if (view !== 'bind') stopCamera();
  for (const el of document.querySelectorAll('.view')) el.hidden = el.id !== view;
  const flow = FLOWS[state.path];
  const idx = flow.indexOf(view);
  $('progress').hidden = idx < 0;
  if (idx >= 0) {
    $('progress-count').textContent = `第 ${idx + 1} 步，共 ${flow.length} 步`;
    $('progress-name').textContent = STEP_NAMES[view];
    $('progress-bar').style.width = `${((idx + 1) / flow.length) * 100}%`;
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
  $('oops-text').textContent = err && err.message ? err.message : String(err);
  if (!$('oops').open) $('oops').showModal();
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

function selected(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function setLine(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = `result-line ${kind || ''}`;
}

// 讓上傳區支援拖放。放下的檔案交給原本的檔案輸入框處理。
function setupDrop(drop, input) {
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    });
  }
  drop.addEventListener('drop', (e) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const dt = new DataTransfer();
    for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---------- 確認本人 ----------

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
    setLine('bind-result', '', '');
  } catch (err) {
    setLine('bind-result', '打不開鏡頭。請在瀏覽器允許使用鏡頭，或改用上傳自拍照。', 'bad');
  }
}

async function processSelfie(canvas) {
  setLine('bind-result', '', '');
  $('bind-next').disabled = true;
  state.selfie = null;
  setStatus('正在看這張自拍。第一次需要下載模型，請等一下');
  try {
    const faces = await M.faceDescriptors(canvas);
    setStatus('');
    if (faces.length === 0) return setLine('bind-result', '這張照片裡找不到臉。請面對鏡頭、找個亮一點的地方，再試一次。', 'bad');
    if (faces.length > 1) return setLine('bind-result', '畫面裡不只一張臉。請只拍你自己。', 'bad');
    state.selfie = faces[0];
    const preview = $('selfie-preview');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    preview.hidden = false;
    setLine('bind-result', '好了，認得你了。接下來加入的照片都要是這張臉。', 'ok');
    $('bind-next').disabled = false;
  } catch (err) {
    fail(err);
  }
}

// ---------- 參考照片 ----------

function updateLibraryNext() {
  $('library-next').disabled = state.refs.length === 0;
}

async function addReferences(files) {
  const list = $('ref-list');
  for (const file of files) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="name">${esc(file.name)}</div><div class="state">檢查中</div>`;
    list.appendChild(li);
    const stateEl = li.querySelector('.state');
    const reject = (text) => {
      stateEl.textContent = text;
      stateEl.className = 'state bad';
    };
    try {
      setStatus(`正在檢查 ${file.name}`);
      const img = await M.fileToImage(file);
      const canvas = M.toCanvas(img, 640);
      li.prepend(copyCanvas(canvas));
      const faces = await M.faceDescriptors(canvas);
      const dist = M.closestFace([state.selfie], faces);
      if (dist === null) {
        reject('沒有加入：照片裡找不到臉');
      } else if (dist > M.THRESHOLDS.faceSame) {
        reject('沒有加入：和自拍不是同一張臉');
      } else {
        // 合照裡可能不只一張臉，記下哪一張是本人，判斷臉部有沒有被改時要用
        const dists = faces.map((f) => M.faceDistance(state.selfie, f));
        const ref = {
          name: file.name,
          canvas,
          faces,
          faceIndex: dists.indexOf(Math.min(...dists)),
          hash: M.pHash(canvas),
          embedding: null,
          sha256: await sha256(file),
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
          M.forgetFeatures(canvas);
          li.remove();
          updateLibraryNext();
        });
        li.appendChild(remove);
      }
    } catch (err) {
      reject('沒有加入：讀不了這個檔案');
      console.error(err);
    }
  }
  setStatus('');
  updateLibraryNext();
}

// ---------- 證件驗證（路徑二） ----------

function updateIdNext() {
  $('id-next').disabled = !(state.idVerified && $('id-consent-self').checked && $('id-consent-use').checked);
}

async function processId(file) {
  state.idVerified = false;
  $('id-drop').classList.remove('has-file');
  setLine('id-result', '', '');
  updateIdNext();
  setStatus('正在比對證件上的照片和你的自拍');
  try {
    // 證件影像只留在這個函式裡，比對完就不再保留
    const canvas = M.toCanvas(await M.fileToImage(file), 1000);
    const faces = await M.faceDescriptors(canvas);
    setStatus('');
    if (!faces.length) {
      return setLine('id-result', '在這張圖上找不到臉。請把證件放平、光線充足，拍清楚一點再試一次。', 'bad');
    }
    const dist = M.closestFace([state.selfie], faces);
    if (dist > M.THRESHOLDS.faceId) {
      return setLine('id-result', '證件上的照片和你的自拍看起來不是同一個人。如果證件照比較舊，可以換一張近期的證件再試。', 'bad');
    }
    state.idVerified = true;
    $('id-drop').classList.add('has-file');
    setLine('id-result', '證件照片和你的自拍相符。證件影像已經丟棄，沒有保存。', 'ok');
  } catch (err) {
    fail(err);
  } finally {
    $('id-file').value = '';
    updateIdNext();
  }
}

// ---------- 搜尋（路徑二） ----------

const HIT_TEXT = {
  derived: '這張圖是從你的照片來的',
  likely: '這張圖很可能是從你的照片來的',
  'face-only': '這張圖裡的臉很像你，但不是從你加入的照片改的',
};

function searchRunning() {
  return Boolean(state.search && state.search.running);
}

function updateSearchForm() {
  const mode = selected('search-mode');
  const scan = mode === 'scan';
  $('search-scan-box').hidden = !scan;
  $('scan-locked').hidden = !(scan && !state.idVerified);
  const blocked = scan && (!state.idVerified || !$('scan-url').value.trim());
  $('search-start').disabled = searchRunning() || blocked;
  $('search-start').hidden = searchRunning();
  $('search-stop').hidden = !searchRunning();
}

function renderWeights() {
  const now = S.loadWeights();
  const rows = [{ key: 'bias', label: '基準值' }, ...S.FEATURES];
  $('weights').innerHTML =
    '<thead><tr><th>特徵</th><th>起始權重</th><th>目前權重</th></tr></thead><tbody>' +
    rows
      .map((f) => {
        const a = S.DEFAULT_WEIGHTS[f.key];
        const b = now[f.key];
        const changed = Math.abs(a - b) >= 0.01;
        return `<tr><td>${esc(f.label)}</td><td>${a.toFixed(2)}</td><td>${changed ? `<strong>${b.toFixed(2)}</strong>` : b.toFixed(2)}</td></tr>`;
      })
      .join('') +
    '</tbody>';
}

function renderCrawl(visited) {
  const s = state.search;
  $('crawl-log').innerHTML = visited
    .map((v) => {
      const hot = v.score >= 0.5 ? ' hot' : '';
      let right = '<span class="miss">正在看</span>';
      if (v.done) {
        if (v.error) right = `<span class="miss">${esc(v.error)}</span>`;
        else if (v.hits.length) right = `<span class="hit">找到 ${v.hits.length} 則</span>`;
        else right = '<span class="miss">沒有</span>';
      }
      const where = v.depth === 0 ? '起點' : `${esc(v.platform || '')}`;
      return `<li class="${v.hits.length ? 'is-hit' : ''}"><span class="title"><span class="score${hot}">${v.depth === 0 ? '起點' : v.score.toFixed(2)}</span>${esc(v.title)}<small>${esc(where)}　${esc(s.web.label(v.url))}</small></span>${right}</li>`;
    })
    .join('');
  const images = visited.reduce((n, v) => n + v.checked, 0);
  $('search-stats').innerHTML = `<div><b>${visited.length}</b><span>看過的頁面</span></div><div><b>${images}</b><span>比對過的圖片</span></div><div><b>${s.hits.length}</b><span>找到的內容</span></div>`;
}

function hitCanvas(source, blur) {
  const c = copyCanvas(source);
  if (blur) c.style.filter = 'blur(14px)';
  return c;
}

function renderHit(hit) {
  $('hits-wrap').hidden = false;
  const li = document.createElement('li');
  const b = hit.best;
  const how = explainEdit(b.edit);
  const pics = document.createElement('div');
  pics.className = 'hit-pics';
  const fig = (canvas, cap) => {
    const f = document.createElement('figure');
    f.appendChild(canvas);
    const c = document.createElement('figcaption');
    c.textContent = cap;
    f.appendChild(c);
    return f;
  };
  pics.appendChild(fig(hitCanvas(hit.features.canvas), '找到的圖'));
  pics.appendChild(fig(hitCanvas(b.ref.canvas), `你的照片：${b.ref.name}`));
  li.appendChild(pics);
  const p = document.createElement('p');
  p.className = 'hit-text';
  p.innerHTML = `<strong>${HIT_TEXT[b.verdict]}</strong>。${how.labels && b.verdict !== 'face-only' ? `<small>被動的手腳：${esc(how.labels)}</small>` : ''}<small>出現在：${esc(hit.page.title)}（${esc(hit.page.platform || '')}）</small><small>${esc(state.search.web.label(hit.page.url))}</small>`;
  li.appendChild(p);
  const row = document.createElement('div');
  row.className = 'row';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'primary';
  yes.textContent = '是我的照片，處理這一則';
  yes.addEventListener('click', () => {
    feedback(hit, true);
    li.classList.remove('rejected');
    pickHit(hit).catch(fail);
  });
  const no = document.createElement('button');
  no.type = 'button';
  no.textContent = '這不是我';
  no.addEventListener('click', () => {
    feedback(hit, false);
    li.classList.add('rejected');
  });
  row.append(yes, no);
  li.appendChild(row);
  $('hits').appendChild(li);
}

// 使用者的確認會變成訓練資料：有確認命中的頁面是 1，其餘看過的頁面是 0。
function feedback(hit, isMine) {
  const s = state.search;
  hit.confirmed = isMine;
  const samples = s.visited
    .filter((v) => v.x && v.done && !v.error)
    .map((v) => ({ x: v.x, y: v.hits.some((h) => h.confirmed !== false) ? 1 : 0 }));
  if (!samples.length) return;
  S.saveWeights(S.learn(s.baseWeights, samples));
  renderWeights();
}

async function runSearch() {
  const mode = selected('search-mode');
  const controller = new AbortController();
  let web;
  let seeds;
  let maxPages;
  if (mode === 'demo') {
    web = S.simulatedWeb(state.refs);
    seeds = web.seeds;
    maxPages = 11;
  } else {
    let url;
    try {
      url = new URL($('scan-url').value.trim(), location.href).href;
    } catch (_) {
      return setLine('search-summary', '這個網址看起來不完整，請檢查一下。', 'bad');
    }
    web = S.httpWeb();
    if (!web.reachable(url)) {
      $('search-progress').hidden = false;
      return setLine(
        'search-summary',
        '目前還不能掃描外部網站：瀏覽器不允許直接讀取別的網站，需要先部署轉送服務。你可以先用內建的測試站試試看，或改用「我自己有截圖」。',
        'bad',
      );
    }
    seeds = [url];
    maxPages = Number($('scan-depth').value);
  }

  state.search = { running: true, controller, web, mode, hits: [], visited: [], baseWeights: S.loadWeights() };
  const s = state.search;
  $('search-progress').hidden = false;
  $('hits-wrap').hidden = true;
  $('hits').innerHTML = '';
  $('crawl-log').innerHTML = '';
  $('search-stats').innerHTML = '';
  setLine('search-summary', '', '');
  renderWeights();
  updateSearchForm();

  try {
    setStatus('正在準備比對用的模型。第一次需要下載，請等一下');
    for (const ref of state.refs) if (!ref.embedding) ref.embedding = await M.embed(ref.canvas);
    await S.crawl({
      web,
      seeds,
      weights: s.baseWeights,
      maxPages,
      signal: controller.signal,
      inspect: async (page) => {
        const found = await S.inspectPage(page, state.refs, controller.signal);
        for (const hit of found.hits) {
          s.hits.push(hit);
          renderHit(hit);
        }
        return found;
      },
      onVisit: (entry, visited) => {
        s.visited = visited;
        if (!entry.done) setStatus(`正在看：${entry.title}`);
        renderCrawl(visited);
      },
    });
    setStatus('');
    const n = s.visited.length;
    const stopped = controller.signal.aborted ? '（已停止）' : '';
    if (s.hits.length) {
      let text = `看了 ${n} 頁，找到 ${s.hits.length} 則可能用了你照片的內容${stopped}。請往下一則一則確認。`;
      if (mode === 'demo' && !controller.signal.aborted) {
        text += `如果不排序、照連結出現的順序一頁一頁看，同樣 ${n} 頁只會遇到 ${web.baseline(n)} 則；這個模擬網路裡總共放了 ${web.plantedCount} 則。`;
      }
      setLine('search-summary', text, 'ok');
    } else {
      setLine(
        'search-summary',
        `看了 ${n} 頁，這次沒有找到用了你照片的內容${stopped}。這只代表這幾頁沒有，不代表其他地方沒有。`,
        '',
      );
    }
  } catch (err) {
    fail(err);
  } finally {
    s.running = false;
    setStatus('');
    updateSearchForm();
  }
}

// 把搜尋到的那一則帶進後面的流程。
async function pickHit(hit) {
  state.fromSearch = hit;
  const name = hit.imageUrl.split('/').pop() || 'found.jpg';
  const file = new File([hit.blob], name, { type: hit.blob.type || 'image/jpeg' });
  for (const r of document.querySelectorAll('input[name="scenario"], input[name="minor"]')) r.checked = false;
  if (hit.page.hint) {
    const radio = document.querySelector(`input[name="scenario"][value="${hit.page.hint}"]`);
    if (radio) radio.checked = true;
  }
  $('source-url').value = state.search.web.label(hit.page.url);
  $('platform').value = hit.page.platform || '';
  $('account').value = hit.page.account || '';
  $('advertiser').value = hit.page.advertiser || '';
  $('found-at').value = localDateTimeValue();
  setSuspectFile(file);
  renderCaseHeader();
  show('case');
}

// ---------- 可疑內容 ----------

const SCENARIO_ORDER = ['scam', 'endorsement', 'intimate', 'other'];

function renderScenarios() {
  $('scenario-grid').innerHTML = SCENARIO_ORDER.map((key) => {
    const s = SCENARIOS[key];
    return `<label class="choice"><input type="radio" name="scenario" value="${key}"><span class="mark"></span><span class="body"><strong>${esc(s.label)}</strong><small>${esc(s.hint)}</small></span></label>`;
  }).join('');
}

function renderCaseHeader() {
  const hit = state.fromSearch;
  $('picked').hidden = !hit;
  if (hit) {
    $('case-title').textContent = '確認這一則的情況';
    $('case-lead').textContent = '圖片和來源已經幫你帶進來了。請選一個最接近的情況，有需要再補充。';
    $('picked').innerHTML = `<strong>已帶入搜尋到的內容</strong><p>${esc(hit.page.title)}${state.search.mode === 'demo' ? '（這是示範用的模擬內容，不是真實網頁）' : ''}</p>`;
  } else {
    $('case-title').textContent = '你看到的是什麼？';
    $('case-lead').textContent = '選一個最接近的情況。之後的建議和文件會跟著調整。';
  }
}

function setSuspectFile(file) {
  state.suspectFile = file || null;
  const drop = $('suspect-drop');
  const old = drop.querySelector('img');
  if (old) {
    URL.revokeObjectURL(old.src);
    old.remove();
  }
  drop.classList.toggle('has-file', Boolean(file));
  if (file) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = URL.createObjectURL(file);
    drop.prepend(img);
    $('suspect-title').textContent = '已經選好了';
    $('suspect-name').textContent = `${file.name}　點一下可以換一張`;
  } else {
    $('suspect-title').textContent = '上傳那張圖，或廣告的截圖';
    $('suspect-name').textContent = '點這裡選檔案、把圖拖進來，或直接貼上截圖';
  }
  updateCaseForm();
}

function isMinorCase() {
  return selected('scenario') === 'intimate' && selected('minor') === 'yes';
}

function updateCaseForm() {
  // 涉及未成年人的影像一律不收：已經選好的檔案也立刻放掉
  if (isMinorCase() && state.suspectFile) {
    $('suspect-file').value = '';
    state.suspect = null;
    return setSuspectFile(null);
  }
  const scenario = selected('scenario');
  const intimate = scenario === 'intimate';
  $('age-question').hidden = !intimate;
  const minor = isMinorCase();
  $('minor-callout').hidden = !minor;
  $('suspect-upload').hidden = minor;
  $('advertiser-field').hidden = !(scenario === 'scam' || scenario === 'endorsement');
  // 不雅影像的預覽一律模糊，避免再次受到衝擊
  const preview = $('suspect-drop').querySelector('img');
  if (preview) preview.style.filter = intimate ? 'blur(16px)' : '';

  let ready = Boolean(scenario);
  if (intimate && !selected('minor')) ready = false;
  if (minor) ready = ready && $('source-url').value.trim() !== '';
  else ready = ready && Boolean(state.suspectFile);
  $('case-next').disabled = !ready;
  $('case-next').textContent = minor ? '只記錄文字資訊' : '開始比對';
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

// ---------- 比對 ----------

function verdictContent(b) {
  const n = b.index + 1;
  const headline = explainEdit(b.edit).headline;
  const how = headline ? `${headline}。` : '';
  switch (b.verdict) {
    case 'derived':
      return ['alert', 'strong', '這張圖是從你的照片來的', `它和你的第 ${n} 張照片對得上。${how}`];
    case 'likely':
      return ['alert', 'likely', '這張圖很可能是從你的照片來的', `它和你的第 ${n} 張照片有不少地方對得上。${how}`];
    case 'face-only':
      return [
        'help',
        '',
        '臉很像你，但不是從這幾張照片改的',
        '可能是用你的另一張照片做的，或是重新生成的。把那張原圖加進來可以再比一次。你還是可以先存證。',
      ];
    case 'similar':
      return ['help', '', '看起來有點像，但沒辦法確定', '整體構圖和你的照片相似，可是細節對不上。請你自己判斷，還是可以先存證。'];
    default:
      return [
        'help',
        '',
        '沒有找到對得上的照片',
        '這不代表它沒有用到你的照片，可能只是來源那張不在你加入的照片裡。如果你確定那是你，還是可以先存證。',
      ];
  }
}

const PILL_TEXT = { high: '相符', mid: '部分相符', low: '不相符', na: '無法判斷' };

async function runCompare() {
  show('result');
  $('verdict').innerHTML = '';
  $('verdict').className = 'verdict';
  $('compare').innerHTML = '';
  $('layers').innerHTML = '';
  setLine('confirm-note', '', '');
  for (const r of document.querySelectorAll('input[name="confirm"]')) r.checked = false;
  $('result-next').disabled = true;
  try {
    setStatus('正在準備比對用的模型。第一次需要下載，請等一下');
    const img = await M.fileToImage(state.suspectFile);
    const canvas = M.toCanvas(img, 640);
    state.suspect = await M.describe(canvas);
    state.results = [];
    for (let i = 0; i < state.refs.length; i++) {
      setStatus(`正在和你的第 ${i + 1} 張照片比對，共 ${state.refs.length} 張`);
      const ref = state.refs[i];
      if (!ref.embedding) ref.embedding = await M.embed(ref.canvas);
      const r = await M.comparePair(ref, state.suspect);
      state.results.push({ index: i, ref, ...r });
    }
    state.results.sort((a, b) => b.rank - a.rank);
    state.best = state.results[0];
    state.aiScore = null;
    setStatus('正在檢查其他線索');
    state.provenance = await readProvenance(state.suspectFile);
    state.swap = await checkSwap(state.best);
    setStatus('');
    renderResult();
  } catch (err) {
    fail(err);
  }
}

// 換臉檢查：可疑圖上的臉，五官像你、臉型卻不像
async function checkSwap(b) {
  if (!b || !state.suspect.faces.length) return null;
  const ref = b.ref;
  if (ref.parts === undefined) {
    const all = await faceParts(ref.canvas);
    ref.parts = all.length === ref.faces.length ? all[ref.faceIndex] : null;
  }
  if (!ref.parts) return null;
  const sus = await faceParts(state.suspect.canvas);
  if (!sus.length) return null;
  // 可疑圖上可能有好幾張臉，取五官最像你的那張
  const d = partDistances(sus, [ref.parts]).sort((x, y) => x.inner - y.inner)[0];
  const identified = b.faceDist !== null && b.faceDist <= M.THRESHOLDS.faceSame;
  return { found: swapSignal(d, identified), who: '你', inner: d.inner, outer: d.outer };
}

function figure(canvas, title, caption, blurred) {
  const fig = document.createElement('figure');
  fig.appendChild(canvas);
  const cap = document.createElement('figcaption');
  cap.innerHTML = `<strong>${esc(title)}</strong>${esc(caption)}`;
  fig.appendChild(cap);
  if (blurred) {
    fig.classList.add('blurred');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reveal small';
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
  const [iconName, cls, title, body] = verdictContent(b);
  const v = $('verdict');
  v.className = `verdict ${cls}`;
  v.innerHTML = `${icon(iconName)}<div><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;

  // 被動了什麼手腳
  const how = explainEdit(b.edit);
  $('edits-wrap').hidden = !how.items.length;
  $('edits').innerHTML = how.items
    .map((i) => `<li class="${i.tag === 'face-intact' || i.tag === 'identical' ? 'calm' : ''}"><strong>${esc(i.label)}</strong>${esc(i.text)}</li>`)
    .join('');

  renderSignals($('signals'), { provenance: state.provenance, swap: state.swap });
  $('ai-run').disabled = false;
  setLine('ai-result', '', '');

  const box = $('compare');
  box.appendChild(figure(copyCanvas(b.ref.canvas), `你的第 ${b.index + 1} 張照片`, b.ref.name, false));
  box.appendChild(figure(copyCanvas(state.suspect.canvas), '可疑的圖', state.suspectFile.name, blur));
  if (b.local.overlay) {
    box.appendChild(figure(copyCanvas(b.local.overlay), '被改過的地方', '紅色是被改動的區域；變暗的是你的照片沒有涵蓋的範圍', blur));
  }

  const changed =
    b.local.changedRatio === null ? '' : `，約 ${Math.round(b.local.changedRatio * 100)}% 的區域被改動`;
  const rows = [
    ['整張圖的指紋', `64 個位元裡有 ${b.hashDistance} 個不同`, b.layers.hash, '感知雜湊'],
    ['整體畫面像不像', b.embedSim === null ? '未計算' : `相似度 ${b.embedSim.toFixed(2)}`, b.layers.embed, '影像特徵向量'],
    [
      '細節對不對得上',
      `${b.local.good} 組特徵點裡有 ${b.local.inliers} 組位置吻合${changed}${b.mirrored ? '（左右翻轉後比對）' : ''}`,
      b.layers.local,
      '局部特徵點與幾何驗證',
    ],
    ['臉像不像', b.faceDist === null ? '其中一張圖找不到臉' : `距離 ${b.faceDist.toFixed(2)}，越小越像`, b.layers.face, '人臉相似度'],
  ];
  $('layers').innerHTML =
    '<thead><tr><th>比什麼</th><th>結果</th><th>判斷</th></tr></thead><tbody>' +
    rows
      .map(
        ([name, value, level, tech]) =>
          `<tr><td>${name}<br><small class="note">${tech}</small></td><td>${esc(value)}</td><td><span class="pill ${level}">${PILL_TEXT[level]}</span></td></tr>`,
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
    const mirrored = b.mirrored ? '，且經左右翻轉' : '';
    const labels = explainEdit(b.edit).labels;
    const how = labels ? `；自動判斷的改動類型：${labels}` : '';
    return `與本人的參考照「${b.ref.name}」相符（${b.local.inliers} 組特徵點通過幾何驗證${changed}${mirrored}）${how}；${confirmText}`;
  }
  return `自動比對未能確認來源；${confirmText}`;
}

// ---------- 存證 ----------

async function buildEvidence() {
  const c = readCase();
  const now = new Date();
  const hit = state.fromSearch;
  const ev = {
    id: `TB-${localDateTimeValue(now).slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: now.toISOString(),
    clockNote: '時間取自裝置時鐘，未經第三方時間戳驗證',
    scenario: c.scenario,
    scenarioLabel: SCENARIOS[c.scenario].label,
    minor: c.minor,
    displayName: c.displayName,
    foundBy: hit ? (state.search.mode === 'demo' ? '系統搜尋（示範用的模擬網路，非真實網頁）' : '系統掃描指定網頁') : '本人自行發現',
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
      mirrored: b.mirrored,
      editTags: b.edit.tags,
      editLabels: explainEdit(b.edit).labels,
      editNumbers: {
        coverage: b.edit.coverage,
        referenceUsed: b.edit.refUsed,
        changedInFace: b.edit.changedInFace,
        changedOutsideFace: b.edit.changedOutsideFace,
      },
      changedRatio: b.local.changedRatio === null ? null : Number(b.local.changedRatio.toFixed(4)),
      faceDistance: b.faceDist === null ? null : Number(b.faceDist.toFixed(4)),
    };
    ev.signals = {
      provenance: state.provenance ? describeProvenance(state.provenance).title : null,
      swap: state.swap ? (state.swap.found ? '可能經過換臉（五官像本人、臉型不像）' : '沒有看到換臉跡象') : null,
      ai: state.aiScore === undefined || state.aiScore === null ? null : `疑似 AI 生成分數 ${Math.round(state.aiScore * 100)}/100（偵測模型，僅供參考）`,
      swapNumbers: state.swap ? { inner: Number(state.swap.inner.toFixed(4)), outer: Number(state.swap.outer.toFixed(4)) } : null,
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
    ['發現方式', ev.foundBy],
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
    rows.push(['可疑影像的數位指紋（SHA-256）', ev.suspect.sha256]);
    rows.push(['你的照片檔名', ev.match.referenceFile]);
    rows.push(['你的照片的數位指紋（SHA-256）', ev.match.referenceSha256]);
    rows.push(['比對結果', ev.match.summary]);
    const s = ev.signals || {};
    const other = [s.provenance, s.swap, s.ai].filter(Boolean).join('；');
    if (other) rows.push(['其他線索（輔助，非判定）', other]);
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
      <tr><th>特徵點配對</th><td>${m.localMatches} 組配對，${m.localInliers} 組通過幾何驗證${m.mirrored ? '（可疑圖經左右翻轉後比對）' : ''}</td></tr>
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
    <p class="foot">本紀錄由「尋影 TraceBack」原型在使用者的裝置上產生。數位指紋可用來核對檔案是否與存證時相同。比對結果為自動分析加上本人確認，僅供參考，不是鑑定報告，也不是法律意見。</p>`;
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

// ---------- 行動 ----------

function renderAction() {
  const ev = state.evidence;
  $('legal-path').innerHTML = legalPath(ev.scenario)
    .map(
      (p) =>
        `<li><label class="choice"><input type="checkbox"><span class="mark"></span><span class="body"><strong>${esc(p.title)}</strong>${esc(p.body)}${p.basis ? `<span class="basis">依據：${esc(p.basis)}</span>` : ''}</span></label></li>`,
    )
    .join('');

  const docs = buildDocuments({ ...ev, match: ev.match ? { summary: ev.match.summary } : null });
  const box = $('documents');
  box.innerHTML = '';
  if (ev.minor) {
    const warn = document.createElement('div');
    warn.className = 'callout';
    warn.innerHTML =
      '<strong>請直接撥打 113 或報警。</strong><p>涉及未滿 18 歲的影像時，請不要自己下載或轉傳，把網址交給社工與警方處理。</p>';
    box.appendChild(warn);
  }
  for (const d of docs) {
    const el = document.createElement('article');
    el.className = 'doc';
    el.innerHTML = `<header><strong>${esc(d.title)}</strong><button type="button" class="small">複製</button></header><p class="doc-note">${esc(d.note)}</p><pre>${esc(d.text)}</pre>`;
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
    .map((r) => {
      const name = r.tel
        ? `<a class="tel" href="tel:${esc(r.tel)}">${esc(r.name)}</a>`
        : r.url
          ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><strong>${esc(r.name)}</strong></a>`
          : `<strong>${esc(r.name)}</strong>`;
      return `<li>${name}<span>${esc(r.detail)}</span></li>`;
    })
    .join('');
  show('action');
}

function resetCase() {
  state.suspect = null;
  state.results = [];
  state.best = null;
  state.evidence = null;
  state.fromSearch = null;
  for (const id of ['source-url', 'platform', 'account', 'advertiser']) $(id).value = '';
  $('found-at').value = localDateTimeValue();
  $('suspect-file').value = '';
  for (const r of document.querySelectorAll('input[name="scenario"], input[name="minor"]')) r.checked = false;
  setSuspectFile(null);
  renderCaseHeader();
  // 路徑二回到搜尋結果，可以接著處理下一則
  show(state.path === 'find' && state.search ? 'search' : 'case');
}

// ---------- 事件 ----------

function startPath(path) {
  state.path = path;
  show(state.selfie ? 'library' : 'bind');
}

function init() {
  setupAiButton($('ai-run'), $('ai-result'), () => state.suspect?.canvas, (level, score) => {
    state.aiScore = score;
    return level === 'low' ? '這項不會影響比對結果。' : '下一步：存證紀錄會一起記下這個分數，標示為輔助訊號。';
  });
  renderScenarios();
  renderWeights();
  $('found-at').value = localDateTimeValue();

  $('help-open').addEventListener('click', () => $('help').showModal());
  $('home-link').addEventListener('click', () => {
    if (!$('home').hidden) return;
    if (searchRunning()) state.search.controller.abort();
    show('home');
  });
  $('start-known').addEventListener('click', () => startPath('known'));
  $('start-find').addEventListener('click', () => startPath('find'));

  // 確認本人
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
    } catch (err) {
      setLine('bind-result', '讀不了這個檔案，請換一張試試。', 'bad');
    }
  });
  $('bind-back').addEventListener('click', () => show('home'));
  $('bind-next').addEventListener('click', () => show('library'));

  // 參考照片
  setupDrop($('ref-drop'), $('ref-files'));
  $('ref-files').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) addReferences(files).catch(fail);
  });
  $('library-back').addEventListener('click', () => show('bind'));
  $('library-next').addEventListener('click', () => show(state.path === 'find' ? 'idcheck' : 'case'));

  // 證件驗證
  setupDrop($('id-drop'), $('id-file'));
  $('id-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processId(file);
  });
  $('id-consent-self').addEventListener('change', updateIdNext);
  $('id-consent-use').addEventListener('change', updateIdNext);
  $('id-back').addEventListener('click', () => show('library'));
  const openSearch = () => {
    updateSearchForm();
    show('search');
  };
  $('id-next').addEventListener('click', openSearch);
  $('id-skip').addEventListener('click', () => {
    state.idVerified = false;
    document.querySelector('input[name="search-mode"][value="demo"]').checked = true;
    openSearch();
  });

  // 搜尋
  $('search-mode').addEventListener('change', updateSearchForm);
  $('scan-url').addEventListener('input', updateSearchForm);
  $('scan-example').addEventListener('click', () => {
    $('scan-url').value = new URL(TESTSITE_URL, location.href).href;
    updateSearchForm();
  });
  $('search-start').addEventListener('click', () => runSearch().catch(fail));
  $('search-stop').addEventListener('click', () => {
    if (searchRunning()) state.search.controller.abort();
    setStatus('正在停止，等目前這張圖比對完');
  });
  $('weights-reset').addEventListener('click', () => {
    S.resetWeights();
    renderWeights();
  });
  $('search-back').addEventListener('click', () => {
    if (searchRunning()) state.search.controller.abort();
    show('idcheck');
  });
  $('search-manual').addEventListener('click', () => {
    if (searchRunning()) state.search.controller.abort();
    state.fromSearch = null;
    renderCaseHeader();
    show('case');
  });

  // 可疑內容
  setupDrop($('suspect-drop'), $('suspect-file'));
  $('case').addEventListener('change', updateCaseForm);
  $('source-url').addEventListener('input', updateCaseForm);
  $('suspect-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 自己換了一張圖，就不再算是搜尋帶入的內容
    state.fromSearch = null;
    renderCaseHeader();
    setSuspectFile(file);
  });
  document.addEventListener('paste', (e) => {
    if ($('case').hidden || $('suspect-upload').hidden || !e.clipboardData) return;
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    state.fromSearch = null;
    renderCaseHeader();
    setSuspectFile(file);
  });
  $('case-back').addEventListener('click', () => show(state.path === 'find' ? 'search' : 'library'));
  $('case-next').addEventListener('click', () => {
    if (isMinorCase()) buildEvidence().catch(fail);
    else runCompare();
  });

  // 比對
  $('confirm').addEventListener('change', () => {
    const c = selected('confirm');
    $('result-next').disabled = !(c === 'yes' || c === 'unsure');
    setLine('confirm-note', c === 'no' ? '好的，那就不用處理這一則。如果想換一張圖再比一次，可以回上一步。' : '', '');
  });
  $('result-back').addEventListener('click', () => show('case'));
  $('result-next').addEventListener('click', () => buildEvidence().catch(fail));

  // 存證
  $('print-report').addEventListener('click', printReport);
  $('download-json').addEventListener('click', downloadJson);
  $('evidence-back').addEventListener('click', () => show(state.evidence && state.evidence.minor ? 'case' : 'result'));
  $('evidence-next').addEventListener('click', renderAction);

  // 行動
  $('action-back').addEventListener('click', () => show('evidence'));
  $('restart').addEventListener('click', resetCase);

  updateCaseForm();
  updateSearchForm();
}

init();
