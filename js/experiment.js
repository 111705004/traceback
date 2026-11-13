// 比對實驗：放入本人的照片，系統自動做出常見的冒用改法，再用比對找回來源。
// 也可以放別人的照片（測誤認與自動換臉）和自己用 AI 工具做的改造圖。
import * as M from './matching.js';
import { MOCK_EDITS } from './search.js';
import { EDIT_LABELS } from './edits.js';
import { faceParts, partDistances, swapSignal, makeSwap } from './faceparts.js';
import { loadDetector, aiScore, AI_THRESHOLDS } from './aidetect.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MAX_ORIGINALS = 10;
const SWAPS_PER_ORIGINAL = 2;
const SWAP_TYPE = '換臉（自動剪貼）';
const COMPRESS_TYPE = '縮小加重度壓縮';

const input = { originals: [], others: [], own: [] }; // own：{ file, source, type }
let result = null;

// ---------- 選檔 ----------

const baseName = (name) => name.replace(/\.[^.]+$/, '');

function thumb(file) {
  const img = document.createElement('img');
  img.src = URL.createObjectURL(file);
  img.alt = file.name;
  img.onload = () => URL.revokeObjectURL(img.src);
  return img;
}

function renderList(key) {
  const list = $(key === 'originals' ? 'orig-list' : 'other-list');
  list.innerHTML = '';
  input[key].forEach((file, i) => {
    const li = document.createElement('li');
    li.appendChild(thumb(file));
    li.insertAdjacentHTML('beforeend', `<div class="name">${esc(file.name)}</div>`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.setAttribute('aria-label', `移除 ${file.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      input[key].splice(i, 1);
      if (key === 'originals') for (const o of input.own) o.source = Math.min(o.source, Math.max(0, input.originals.length - 1));
      refresh();
    });
    li.appendChild(remove);
    list.appendChild(li);
  });
}

function renderOwn() {
  const list = $('own-list');
  list.innerHTML = '';
  input.own.forEach((o, i) => {
    const li = document.createElement('li');
    li.appendChild(thumb(o.file));
    const options = input.originals.length
      ? input.originals.map((f, j) => `<option value="${j}"${j === o.source ? ' selected' : ''}>${esc(f.name)}</option>`).join('')
      : '<option value="">先加入本人的照片</option>';
    li.insertAdjacentHTML(
      'beforeend',
      `<label class="field"><span>從哪張原圖改來的</span><select data-k="source">${options}</select></label>
       <label class="field"><span>改了什麼</span><input type="text" data-k="type" maxlength="30" value="${esc(o.type)}" placeholder="例如 AI 換背景"></label>
       <button type="button" class="small" data-k="remove">移除</button>`,
    );
    li.querySelector('[data-k=source]').addEventListener('change', (e) => (o.source = Number(e.target.value)));
    li.querySelector('[data-k=type]').addEventListener('input', (e) => (o.type = e.target.value.trim()));
    li.querySelector('[data-k=remove]').addEventListener('click', () => {
      input.own.splice(i, 1);
      refresh();
    });
    list.appendChild(li);
  });
}

// 舊的命名方式（a01__AI換背景.jpg）仍然可以自動帶入來源與改法
function guessOwn(file) {
  const base = baseName(file.name);
  const i = base.indexOf('__');
  let source = 0;
  let type = '';
  if (i > 0) {
    const j = input.originals.findIndex((f) => baseName(f.name) === base.slice(0, i));
    if (j >= 0) source = j;
    type = base.slice(i + 2);
  }
  return { file, source, type };
}

function planText() {
  const n = input.originals.length;
  if (!n) return '';
  const swaps = input.others.length ? Math.min(input.others.length, SWAPS_PER_ORIGINAL) * n : 0;
  const auto = n * (MOCK_EDITS.length + 1) + swaps;
  const parts = [`系統會自動做出 ${auto} 張改造圖`];
  if (input.own.length) parts.push(`加上你的 ${input.own.length} 張`);
  if (input.others.length) parts.push(`用 ${input.others.length} 張別人的照片測誤認`);
  const minutes = Math.max(1, Math.round(((auto + input.own.length + input.others.length) * n * 0.6) / 60));
  return `${parts.join('，')}。大約需要 ${minutes} 分鐘。`;
}

function refresh() {
  renderList('originals');
  renderList('others');
  renderOwn();
  $('orig-count').textContent = input.originals.length ? `已選 ${input.originals.length} 張` : '還沒有照片';
  $('other-count').textContent = input.others.length ? `已選 ${input.others.length} 張` : '還沒有照片';
  $('own-count').textContent = input.own.length ? `已選 ${input.own.length} 張` : '還沒有圖片';
  $('plan').textContent = planText();
  $('plan').className = input.originals.length ? 'result-line ok' : 'result-line';
  $('run').disabled = !input.originals.length;
}

function addFiles(key, files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (key === 'own') input.own.push(...images.map(guessOwn));
  else input[key].push(...images);
  if (input.originals.length > MAX_ORIGINALS) input.originals.length = MAX_ORIGINALS;
  refresh();
}

function setupDrop(dropId, inputId, key) {
  const drop = $(dropId);
  const el = $(inputId);
  el.addEventListener('change', () => {
    addFiles(key, el.files);
    el.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(key, e.dataTransfer.files);
  });
}

// ---------- 進度 ----------

function progress(text, ratio) {
  $('step-text').textContent = text;
  if (ratio !== undefined) $('step-bar').style.width = `${Math.round(Math.min(1, ratio) * 100)}%`;
}

// 模型檔下載進度：transformers.js 會分檔回報，取目前最大那個檔案的進度
function downloadReporter(label) {
  return (p) => {
    if (p.status === 'progress' && p.total > 1_000_000) progress(`${label}：${Math.round((p.loaded / p.total) * 100)}%`);
  };
}

// ---------- 實驗 ----------

const jpeg = async (canvas, quality = 0.86) => {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return M.toCanvas(await createImageBitmap(blob), 640);
};

async function loadImage(file) {
  return M.toCanvas(await M.fileToImage(file), 640);
}

async function buildTests(originals, others) {
  const tests = [];
  for (const o of originals) {
    const box = M.faceBoxes(o.canvas)[0] || null;
    for (const e of MOCK_EDITS) {
      tests.push({ kind: 'auto', type: e.label, source: o.index, canvas: await jpeg(e.make(o.canvas, box)) });
    }
    const small = M.toCanvas(o.canvas, 360);
    tests.push({ kind: 'auto', type: COMPRESS_TYPE, source: o.index, canvas: await jpeg(small, 0.4) });
    // 換臉：只貼到「不是同一個人」的臉上
    let made = 0;
    for (const other of others) {
      if (made >= SWAPS_PER_ORIGINAL) break;
      const d = M.closestFace(o.features.faces.slice(0, 1), other.features.faces.slice(0, 1));
      if (d === null || d < 0.6) continue;
      const swapped = await makeSwap(o.canvas, other.canvas);
      if (!swapped) continue;
      tests.push({ kind: 'auto', type: SWAP_TYPE, source: o.index, canvas: await jpeg(swapped), swap: true });
      made++;
    }
  }
  for (const own of input.own) {
    tests.push({ kind: 'own', type: own.type || '自己做的改造', source: own.source, canvas: await loadImage(own.file), name: own.file.name });
  }
  for (const other of others) tests.push({ kind: 'negative', type: '別人的照片', source: -1, canvas: other.canvas, name: other.name });
  return tests;
}

async function run() {
  const withAi = $('with-ai').checked;
  $('setup').hidden = true;
  $('results').hidden = true;
  $('progress-view').hidden = false;
  window.scrollTo({ top: 0 });
  try {
    progress('下載比對用的模型（第一次比較久）', 0.02);
    await M.loadFace();
    await M.loadOpenCV();
    await M.loadEmbedder(downloadReporter('下載影像特徵模型'));
    if (withAi) {
      progress('下載 AI 生成偵測模型（約 87 MB）', 0.05);
      await loadDetector(downloadReporter('下載 AI 生成偵測模型'));
    }

    const originals = [];
    for (let i = 0; i < input.originals.length; i++) {
      progress(`分析本人的照片 ${i + 1}/${input.originals.length}`, 0.08);
      const canvas = await loadImage(input.originals[i]);
      const features = await M.describe(canvas);
      const parts = features.faces.length ? await faceParts(canvas) : [];
      originals.push({
        index: i,
        name: input.originals[i].name,
        canvas,
        features: { ...features, faceIndex: 0 },
        parts: parts.length === features.faces.length ? parts[0] : null,
        ai: withAi ? await aiScore(canvas) : null,
      });
    }
    const others = [];
    for (let i = 0; i < input.others.length; i++) {
      progress(`分析別人的照片 ${i + 1}/${input.others.length}`, 0.1);
      const canvas = await loadImage(input.others[i]);
      others.push({ name: input.others[i].name, canvas, features: await M.describe(canvas) });
    }

    progress('做出改造圖', 0.12);
    const tests = await buildTests(originals, others);

    const rows = [];
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      progress(`比對第 ${i + 1}/${tests.length} 張：${t.type}`, 0.12 + (0.88 * i) / tests.length);
      const features = await M.describe(t.canvas);
      const row = { ...t, pairs: [], ai: withAi ? await aiScore(t.canvas) : null, swapFlag: null, swapDist: null };
      for (const o of originals) {
        const r = await M.comparePair(o.features, features);
        row.pairs.push({ original: o.index, correct: o.index === t.source, ...r });
      }
      // 換臉檢查只和真正的來源比
      const src = originals[t.source];
      const own = row.pairs.find((p) => p.correct);
      if (src && src.parts && features.faces.length) {
        const sus = await faceParts(t.canvas);
        if (sus.length) {
          const d = partDistances(sus, [src.parts]).sort((a, b) => a.inner - b.inner)[0];
          row.swapDist = d;
          row.swapFlag = swapSignal(d, own.faceDist !== null && own.faceDist <= M.THRESHOLDS.faceSame);
        }
      }
      M.forgetFeatures(t.canvas);
      rows.push(row);
      await new Promise((r) => setTimeout(r, 0));
    }
    M.clearFeatureCache();
    progress('完成', 1);
    result = { originals, others, rows, withAi };
    render();
  } catch (err) {
    console.error(err);
    $('progress-view').hidden = true;
    $('setup').hidden = false;
    $('plan').className = 'result-line bad';
    $('plan').textContent = `實驗中斷：${err && err.message ? err.message : err}。可以重新整理頁面再試一次。`;
  }
}

// ---------- 結果 ----------

const recognized = (p) => p && (p.verdict === 'derived' || p.verdict === 'likely');
// 換臉被標出：換臉檢查有跡象，或對齊比對判成「臉被換成另一張臉」
const swapMarked = (r) => Boolean(r.swapFlag) || correctPair(r).edit.tags.includes('face-replaced');
const correctPair = (row) => row.pairs.find((p) => p.correct);
const frac = (n, d) => (d ? `${n}/${d}` : '—');
const pctText = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function topTags(rows) {
  const count = new Map();
  // 「臉沒有被改」幾乎每張都有，列出來只是雜訊
  for (const r of rows) for (const t of correctPair(r).edit.tags) if (t !== 'face-intact') count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${EDIT_LABELS[t] || t}（${n}）`)
    .join('、');
}

function median(values) {
  const v = values.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

function summarize() {
  const { rows, originals, others, withAi } = result;
  // 換臉圖大部分是別人的照片，「認不認得出來源」對它沒有意義，另外統計
  const edited = rows.filter((r) => r.kind !== 'negative' && !r.swap);
  const negatives = rows.filter((r) => r.kind === 'negative');
  const swaps = rows.filter((r) => r.swap);
  const nonSwaps = edited.filter((r) => !r.swap && r.kind === 'auto');
  const s = {
    edited: edited.length,
    recognized: edited.filter((r) => recognized(correctPair(r))).length,
    faceOnly: edited.filter((r) => correctPair(r).verdict === 'face-only').length,
    negatives: negatives.length,
    falsePositives: negatives.filter((r) => r.pairs.some(recognized)).length,
    swaps: swaps.length,
    swapCaught: swaps.filter(swapMarked).length,
    swapFalseAlarms: nonSwaps.filter(swapMarked).length,
    nonSwaps: nonSwaps.length,
    byType: [...groupBy(edited, (r) => `${r.kind === 'own' ? '你的：' : ''}${r.type}`).entries()],
  };
  if (withAi) {
    const realScores = [...originals.map((o) => o.ai), ...negatives.map((r) => r.ai)];
    s.aiReal = { n: realScores.length, flagged: realScores.filter((v) => v >= AI_THRESHOLDS.mid).length };
    const own = edited.filter((r) => r.kind === 'own');
    s.aiOwn = { n: own.length, flagged: own.filter((r) => r.ai >= AI_THRESHOLDS.mid).length };
    const auto = rows.filter((r) => r.kind === 'auto');
    s.aiAuto = { n: auto.length, flagged: auto.filter((r) => r.ai >= AI_THRESHOLDS.mid).length };
  }
  return s;
}

function tile(value, label) {
  return `<div><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function render() {
  const s = summarize();
  result.summary = s;
  const { withAi, originals } = result;

  const tiles = [tile(frac(s.recognized, s.edited), '改造圖認出來源')];
  if (s.negatives) tiles.push(tile(frac(s.falsePositives, s.negatives), '別人被誤認成本人'));
  if (s.swaps) tiles.push(tile(frac(s.swapCaught, s.swaps), '換臉被標出'));
  if (withAi) tiles.push(tile(frac(s.aiReal.flagged, s.aiReal.n), '真照片被誤判為 AI'));
  $('tiles').innerHTML = tiles.join('');

  // 結論
  const lines = [];
  const all = [];
  const partial = [];
  for (const [type, list] of s.byType) {
    const n = list.filter((r) => recognized(correctPair(r))).length;
    if (n === list.length) all.push(type);
    else partial.push(`${type}（${n}/${list.length}）`);
  }
  if (all.length) lines.push(['calm', '全部認出', `${all.join('、')}`]);
  if (partial.length) lines.push(['', '有認不出來的', `${partial.join('、')}。認不出來的圖列在下面。`]);
  if (s.faceOnly) lines.push(['', `${s.faceOnly} 張只認得出臉`, '比對認得出是本人，但對不上原圖的細節；換臉或大幅修改時常見。']);
  if (s.negatives) {
    lines.push(
      s.falsePositives
        ? ['', `${s.falsePositives} 張別人的照片被誤認`, '把別人的照片判成來自本人的照片，門檻可能太鬆。']
        : ['calm', '沒有誤認別人', `${s.negatives} 張別人的照片都沒有被判成來自本人的照片。`],
    );
  }
  if (s.swaps) {
    lines.push([
      s.swapCaught === s.swaps ? 'calm' : '',
      `換臉標出 ${s.swapCaught}/${s.swaps}`,
      `把本人的五官貼到別人臉上，有 ${s.swapCaught} 張被標出可能換臉；${s.nonSwaps} 張不是換臉的改造圖裡，有 ${s.swapFalseAlarms} 張被誤標。自動換臉是剪貼，不是真正的 AI 換臉。`,
    ]);
  }
  $('conclusions').innerHTML = lines.map(([cls, t, d]) => `<li class="${cls}"><strong>${esc(t)}</strong>${esc(d)}</li>`).join('');

  // 每種改法
  const head = ['改法', '張數', '認出來源', '只認得臉', '判成的改動（最常見）', '標出換臉'];
  if (withAi) head.push('AI 分數中位數');
  $('by-type').innerHTML =
    `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
    [...s.byType, ...(s.swaps ? [[SWAP_TYPE, result.rows.filter((r) => r.swap)]] : [])]
      .map(([type, list]) => {
        const cells = [
          type,
          list.length,
          list[0]?.swap ? '不適用' : frac(list.filter((r) => recognized(correctPair(r))).length, list.length),
          list[0]?.swap ? '' : list.filter((r) => correctPair(r).verdict === 'face-only').length || '',
          topTags(list) || '無法判斷',
          list.filter(swapMarked).length || '',
        ];
        if (withAi) {
          const m = median(list.map((r) => r.ai));
          cells.push(m === null ? '' : `${Math.round(m * 100)}/100`);
        }
        return `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
      })
      .join('') +
    '</tbody>';

  // AI 分數的解讀
  $('ai-wrap').hidden = !withAi;
  if (withAi) {
    const items = [
      [
        s.aiReal.flagged ? '' : 'calm',
        `真照片被誤判為 AI：${frac(s.aiReal.flagged, s.aiReal.n)}`,
        '本人與別人的原始照片都是真的，這個比例就是誤報率，越低越好。',
      ],
      ['calm', `自動改造圖被判為 AI：${frac(s.aiAuto.flagged, s.aiAuto.n)}`, '自動改造是剪貼與壓縮，照片本身是真的，分數低是正常的。'],
    ];
    if (s.aiOwn.n) {
      items.push([
        '',
        `你上傳的改造圖被判為 AI：${frac(s.aiOwn.flagged, s.aiOwn.n)}`,
        '如果這些都是用 AI 工具做的，這就是抓到率。企劃書可以拿它說明：沒有原圖時偵測模型抓得到多少。',
      ]);
    } else {
      items.push(['', '還缺 AI 工具做的圖', '想知道偵測模型抓不抓得到 AI 改造，要在第 3 區放用 AI 工具做的圖再跑一次。']);
    }
    $('ai-findings').innerHTML = items.map(([c, t, d]) => `<li class="${c}"><strong>${esc(t)}</strong>${esc(d)}</li>`).join('');
  }

  // 沒認出來的圖
  const misses = result.rows.filter((r) => (r.swap ? !swapMarked(r) : r.kind !== 'negative' && !recognized(correctPair(r))));
  $('misses-wrap').hidden = !misses.length;
  $('misses').innerHTML = '';
  for (const r of misses) {
    const p = correctPair(r);
    const li = document.createElement('li');
    li.appendChild(M.toCanvas(r.canvas, 240));
    const why = r.swap ? '沒標出換臉' : p.verdict === 'face-only' ? '只認得臉' : '沒認出';
    const dist =
      r.swap && r.swapDist
        ? `五官距離 ${r.swapDist.inner.toFixed(2)}、臉型距離 ${r.swapDist.outer.toFixed(2)}`
        : `特徵點 ${p.local.inliers}/${p.local.good}，人臉距離 ${p.faceDist === null ? '找不到臉' : p.faceDist.toFixed(2)}`;
    li.insertAdjacentHTML(
      'beforeend',
      `<strong>${esc(r.type)}</strong><small>${why}；原圖 ${esc(originals[r.source]?.name || '')}；${dist}</small>`,
    );
    $('misses').appendChild(li);
  }

  renderDetails();

  // 下一步
  const next = [];
  if (!input.own.length) next.push(['加入 AI 工具做的改造圖', '目前只測了自動的剪貼改法。用 AI 工具把本人照片換背景、換衣服、換臉後放進第 3 區再跑一次，才能證明對真正 AI 改造的效果。']);
  if (!input.others.length) next.push(['加入別人的照片', '才能測會不會誤認別人，以及換臉檢查抓不抓得到。']);
  if (input.originals.length < 5) next.push(['多放幾張本人的照片', `目前只有 ${input.originals.length} 張，數字容易受單張照片影響，建議 5 到 10 張。`]);
  next.push(['寫進企劃書時', '按「複製結果」貼上。請註明這是團隊自製的測試資料，不是獨立評測。']);
  $('next-steps').innerHTML = next.map(([t, d]) => `<li class="calm"><strong>${esc(t)}</strong>${esc(d)}</li>`).join('');

  $('progress-view').hidden = true;
  $('results').hidden = false;
  window.scrollTo({ top: 0 });
}

function renderDetails() {
  const { rows } = result;
  const positives = rows.filter((r) => r.kind !== 'negative' && !r.swap).map(correctPair);
  const negatives = rows.filter((r) => r.kind === 'negative');
  const others = rows.flatMap((r) => r.pairs.filter((p) => !p.correct));
  const layers = [
    ['1 感知雜湊', 'hash'],
    ['2 影像特徵向量', 'embed'],
    ['3 局部特徵點', 'local'],
    ['4 人臉相似度', 'face'],
  ];
  const on = (p, k) => p.layers[k] === 'high' || p.layers[k] === 'mid';
  $('layers').innerHTML =
    '<thead><tr><th>方法</th><th>改造圖認回率</th><th>別人被誤認</th></tr></thead><tbody>' +
    layers
      .map(
        ([name, k]) =>
          `<tr><td>${name}</td><td>${pctText(positives.filter((p) => on(p, k)).length, positives.length)}</td><td>${negatives.length ? pctText(negatives.filter((r) => r.pairs.some((p) => on(p, k))).length, negatives.length) : '—'}</td></tr>`,
      )
      .join('') +
    `<tr><td>綜合判斷</td><td>${pctText(positives.filter(recognized).length, positives.length)}</td><td>${negatives.length ? pctText(negatives.filter((r) => r.pairs.some(recognized)).length, negatives.length) : '—'}</td></tr></tbody>`;

  const range = (vals, d) => {
    const v = vals.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
    return v.length ? `${v[0].toFixed(d)} ／ ${v[Math.floor(v.length / 2)].toFixed(d)} ／ ${v[v.length - 1].toFixed(d)}` : '—';
  };
  const metrics = [
    ['雜湊相異位元（越小越像）', (p) => p.hashDistance, 0],
    ['特徵向量相似度（越大越像）', (p) => p.embedSim, 2],
    ['通過幾何驗證的特徵點（越多越像）', (p) => p.local.inliers, 0],
    ['人臉距離（越小越像）', (p) => p.faceDist, 2],
  ];
  $('spread').innerHTML =
    '<thead><tr><th>數值</th><th>應該相符：最小／中位／最大</th><th>不該相符：最小／中位／最大</th></tr></thead><tbody>' +
    metrics.map(([n, f, d]) => `<tr><td>${n}</td><td>${range(positives.map(f), d)}</td><td>${range(others.map(f), d)}</td></tr>`).join('') +
    '</tbody>';
  const T = M.THRESHOLDS;
  $('thresholds').textContent = `雜湊 ${T.hashNear}／${T.hashClose} 位元以內；向量 ${T.embedHigh}／${T.embedMid} 以上；特徵點 ${T.inliersHigh}／${T.inliersMid} 組以上；人臉距離 ${T.faceSame} 以內。`;
}

// ---------- 匯出 ----------

function copyText() {
  const s = result.summary;
  const out = [
    `比對實驗結果（${new Date().toLocaleDateString('zh-TW')}，團隊自製測試資料）`,
    `本人照片 ${result.originals.length} 張、別人的照片 ${result.others.length} 張、改造圖 ${s.edited} 張。`,
    `改造圖認出來源：${frac(s.recognized, s.edited)}`,
  ];
  if (s.negatives) out.push(`別人被誤認成本人：${frac(s.falsePositives, s.negatives)}`);
  if (s.swaps) out.push(`換臉被標出：${frac(s.swapCaught, s.swaps)}（非換臉被誤標 ${frac(s.swapFalseAlarms, s.nonSwaps)}）`);
  if (result.withAi) {
    out.push(`真照片被誤判為 AI：${frac(s.aiReal.flagged, s.aiReal.n)}`);
    if (s.aiOwn.n) out.push(`上傳的改造圖被判為 AI：${frac(s.aiOwn.flagged, s.aiOwn.n)}`);
  }
  out.push('', '| 改法 | 張數 | 認出來源 | 判成的改動 |', '| --- | --- | --- | --- |');
  for (const [type, list] of s.byType) {
    out.push(`| ${type} | ${list.length} | ${frac(list.filter((r) => recognized(correctPair(r))).length, list.length)} | ${topTags(list) || '無法判斷'} |`);
  }
  if (s.swaps) out.push(`| ${SWAP_TYPE} | ${s.swaps} | 不適用（標出換臉 ${s.swapCaught}/${s.swaps}） | |`);
  return out.join('\n');
}

async function copy() {
  try {
    await navigator.clipboard.writeText(copyText());
    $('copy-result').className = 'result-line ok';
    $('copy-result').textContent = '已複製，可以直接貼到企劃書或 Notion。';
  } catch (_) {
    // 瀏覽器不允許直接複製時，放進文字框讓使用者自己複製
    $('copy-result').className = 'result-line';
    $('copy-result').textContent = '瀏覽器不允許直接複製，請從下面的文字框選取後複製。';
    const box = $('copy-box');
    box.hidden = false;
    box.value = copyText();
    box.focus();
    box.select();
  }
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv() {
  const head = ['測試圖', '類別', '改法', '比對的原圖', '是否為真正來源', '綜合判斷', '雜湊相異', '向量相似度', '特徵點配對', '通過幾何驗證', '人臉距離', '改動類型', '五官距離', '臉型距離', '換臉跡象', 'AI 分數'];
  const kind = { auto: '自動改造', own: '上傳的改造圖', negative: '別人的照片' };
  const lines = [head];
  result.rows.forEach((r, i) => {
    for (const p of r.pairs) {
      lines.push([
        r.name || `自動 ${i + 1}`,
        kind[r.kind],
        r.type,
        result.originals[p.original].name,
        p.correct ? '是' : '否',
        p.verdict,
        p.hashDistance,
        p.embedSim === null ? '' : p.embedSim.toFixed(4),
        p.local.good,
        p.local.inliers,
        p.faceDist === null ? '' : p.faceDist.toFixed(4),
        p.edit.tags.map((t) => EDIT_LABELS[t] || t).join('、'),
        p.correct && r.swapDist ? r.swapDist.inner.toFixed(4) : '',
        p.correct && r.swapDist ? r.swapDist.outer.toFixed(4) : '',
        p.correct ? (r.swapFlag ? '是' : r.swapFlag === false ? '否' : '') : '',
        r.ai === null ? '' : r.ai.toFixed(4),
      ]);
    }
  });
  const text = '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `比對實驗-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- 啟動 ----------

setupDrop('orig-drop', 'orig-files', 'originals');
setupDrop('other-drop', 'other-files', 'others');
setupDrop('own-drop', 'own-files', 'own');
$('run').addEventListener('click', run);
$('copy').addEventListener('click', copy);
$('csv').addEventListener('click', downloadCsv);
$('again').addEventListener('click', () => {
  $('results').hidden = true;
  $('setup').hidden = false;
  window.scrollTo({ top: 0 });
});
refresh();
