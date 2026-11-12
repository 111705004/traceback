// 批次比對實驗：每張測試圖對每張原圖都跑四層比對，統計認回率與誤判率。
import * as M from './matching.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const files = { originals: [], edited: [], negatives: [] };
let pairs = []; // 每一組配對的原始數值
let summaryRows = [];

const LAYERS = [
  { key: 'hash', name: '1 感知雜湊' },
  { key: 'embed', name: '2 影像特徵向量' },
  { key: 'local', name: '3 局部特徵點' },
  { key: 'face', name: '4 人臉相似度' },
  { key: 'verdict', name: '綜合判斷' },
];

function setStatus(text) {
  $('status').hidden = !text;
  $('status').textContent = text || '';
}

const baseName = (name) => name.replace(/\.[^.]+$/, '');

// 改造圖檔名：原圖主檔名 + 兩個底線 + 處理方式
function parseEdited(name) {
  const base = baseName(name);
  const i = base.indexOf('__');
  if (i < 0) return null;
  return { original: base.slice(0, i), type: base.slice(i + 2) || '未標示' };
}

function refreshInputs() {
  $('originals-count').textContent = files.originals.length ? `已選 ${files.originals.length} 張` : '尚未選擇';
  $('edited-count').textContent = files.edited.length ? `已選 ${files.edited.length} 張` : '尚未選擇';
  $('negatives-count').textContent = files.negatives.length ? `已選 ${files.negatives.length} 張` : '尚未選擇，可省略';

  const known = new Set(files.originals.map((f) => baseName(f.name)));
  const warnings = [];
  for (const f of files.edited) {
    const p = parseEdited(f.name);
    if (!p) warnings.push(`${f.name}：檔名沒有兩個底線，無法判斷來源，會被略過`);
    else if (files.originals.length && !known.has(p.original)) {
      warnings.push(`${f.name}：找不到主檔名為「${p.original}」的原圖，會被略過`);
    }
  }
  $('warnings').innerHTML = warnings.map((w) => `<li class="bad">${esc(w)}</li>`).join('');
  $('run').disabled = !(files.originals.length && (files.edited.length || files.negatives.length));
}

async function load(file) {
  const img = await M.fileToImage(file);
  return M.describe(M.toCanvas(img, 640));
}

// 一組配對在某一層是否算相符。strict 只算「相符」，否則連「部分相符」也算。
function hit(pair, key, strict) {
  if (key === 'verdict') return strict ? pair.verdict === 'derived' : pair.verdict === 'derived' || pair.verdict === 'likely';
  const level = pair.layers[key];
  return strict ? level === 'high' : level === 'high' || level === 'mid';
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%（${n}/${d}）` : '無資料');

async function run() {
  $('run').disabled = true;
  $('results').hidden = true;
  pairs = [];
  try {
    setStatus('正在載入模型，第一次需要下載，請稍候');
    await Promise.all([M.loadEmbedder(), M.loadFace(), M.loadOpenCV()]);

    const originals = [];
    for (let i = 0; i < files.originals.length; i++) {
      setStatus(`正在分析原圖 ${i + 1}/${files.originals.length}`);
      originals.push({ name: files.originals[i].name, base: baseName(files.originals[i].name), ...(await load(files.originals[i])) });
    }
    const bases = new Set(originals.map((o) => o.base));

    const tests = [];
    for (const f of files.edited) {
      const p = parseEdited(f.name);
      if (p && bases.has(p.original)) tests.push({ file: f, kind: 'edited', source: p.original, type: p.type });
    }
    for (const f of files.negatives) tests.push({ file: f, kind: 'negative', source: '', type: '' });

    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      setStatus(`正在比對測試圖 ${i + 1}/${tests.length}：${t.file.name}`);
      const features = await load(t.file);
      for (const o of originals) {
        const r = await M.comparePair(o, features);
        pairs.push({
          test: t.file.name,
          kind: t.kind,
          type: t.type,
          original: o.name,
          correct: t.kind === 'edited' && t.source === o.base,
          hashDistance: r.hashDistance,
          embedSim: r.embedSim,
          localGood: r.local.good,
          localInliers: r.local.inliers,
          changedRatio: r.local.changedRatio,
          faceDist: r.faceDist,
          layers: r.layers,
          verdict: r.verdict,
        });
      }
      // 讓畫面有機會更新
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    M.clearFeatureCache();
    setStatus('');
    render(originals.length, tests);
  } catch (err) {
    console.error(err);
    setStatus('');
    alert(`發生錯誤：${err && err.message ? err.message : err}`);
  } finally {
    $('run').disabled = false;
  }
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function stats(values) {
  const v = values.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return null;
  return { min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1], n: v.length };
}

function render(originalCount, tests) {
  const positives = pairs.filter((p) => p.correct);
  const wrongSource = pairs.filter((p) => p.kind === 'edited' && !p.correct);
  const negByTest = groupBy(
    pairs.filter((p) => p.kind === 'negative'),
    (p) => p.test,
  );
  const editedCount = tests.filter((t) => t.kind === 'edited').length;
  const negativeCount = tests.filter((t) => t.kind === 'negative').length;

  $('overview').textContent = `原圖 ${originalCount} 張、改造圖 ${editedCount} 張、對照圖 ${negativeCount} 張，共比對 ${pairs.length} 組。`;

  // 各層摘要
  summaryRows = LAYERS.map(({ key, name }) => {
    const negHit = (strict) => [...negByTest.values()].filter((list) => list.some((p) => hit(p, key, strict))).length;
    return [
      name,
      pct(positives.filter((p) => hit(p, key, true)).length, positives.length),
      pct(positives.filter((p) => hit(p, key, false)).length, positives.length),
      pct(negHit(true), negByTest.size),
      pct(negHit(false), negByTest.size),
      pct(wrongSource.filter((p) => hit(p, key, false)).length, wrongSource.length),
    ];
  });
  const head = ['方法', '認回率（相符）', '認回率（含部分相符）', '對照圖誤判率（相符）', '對照圖誤判率（含部分相符）', '配錯原圖（含部分相符）'];
  $('summary').innerHTML =
    `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
    summaryRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') +
    '</tbody>';

  // 依處理方式
  const byType = groupBy(positives, (p) => p.type);
  $('by-type').innerHTML =
    `<thead><tr><th>處理方式</th>${LAYERS.map((l) => `<th>${l.name}</th>`).join('')}</tr></thead><tbody>` +
    [...byType.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))
      .map(
        ([type, list]) =>
          `<tr><td>${esc(type)}</td>${LAYERS.map((l) => `<td>${pct(list.filter((p) => hit(p, l.key, false)).length, list.length)}</td>`).join('')}</tr>`,
      )
      .join('') +
    '</tbody>';

  // 數值分布
  const others = pairs.filter((p) => !p.correct);
  const fmt = (s, digits) => (s ? `${s.min.toFixed(digits)} ／ ${s.median.toFixed(digits)} ／ ${s.max.toFixed(digits)}` : '無資料');
  const metrics = [
    ['1 感知雜湊相異位元', 'hashDistance', 0, '越小越像'],
    ['2 影像特徵向量相似度', 'embedSim', 2, '越大越像'],
    ['3 通過幾何驗證的特徵點', 'localInliers', 0, '越多越像'],
    ['4 人臉距離', 'faceDist', 2, '越小越像'],
  ];
  $('spread').innerHTML =
    '<thead><tr><th>數值</th><th>方向</th><th>應該相符：最小／中位／最大</th><th>不該相符：最小／中位／最大</th></tr></thead><tbody>' +
    metrics
      .map(
        ([name, key, digits, dir]) =>
          `<tr><td>${name}</td><td>${dir}</td><td>${fmt(stats(positives.map((p) => p[key])), digits)}</td><td>${fmt(stats(others.map((p) => p[key])), digits)}</td></tr>`,
      )
      .join('') +
    '</tbody>';

  // 沒被認回的改造圖
  const misses = positives.filter((p) => !hit(p, 'verdict', false));
  $('misses').innerHTML = misses.length
    ? '<thead><tr><th>改造圖</th><th>雜湊相異</th><th>向量相似度</th><th>特徵點</th><th>人臉距離</th></tr></thead><tbody>' +
      misses
        .map(
          (p) =>
            `<tr><td>${esc(p.test)}</td><td>${p.hashDistance}</td><td>${p.embedSim === null ? '' : p.embedSim.toFixed(2)}</td><td>${p.localInliers}/${p.localGood}</td><td>${p.faceDist === null ? '找不到臉' : p.faceDist.toFixed(2)}</td></tr>`,
        )
        .join('') +
      '</tbody>'
    : '<tbody><tr><td>全部改造圖都被綜合判斷認回。</td></tr></tbody>';

  const T = M.THRESHOLDS;
  $('thresholds').textContent =
    `雜湊相異 ${T.hashNear}／${T.hashClose} 位元以內；向量相似度 ${T.embedHigh}／${T.embedMid} 以上；` +
    `特徵點 ${T.inliersHigh}／${T.inliersMid} 組以上且比例 ${T.inlierRatioHigh}／${T.inlierRatioMid} 以上；人臉距離 ${T.faceSame} 以內。`;
  $('results').hidden = false;
  $('results').scrollIntoView();
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv() {
  const head = [
    '測試圖', '類別', '處理方式', '原圖', '是否為正確來源', '雜湊相異位元', '向量相似度',
    '特徵點配對數', '通過幾何驗證數', '改動面積比例', '人臉距離', '綜合判斷',
  ];
  const rows = pairs.map((p) => [
    p.test,
    p.kind === 'edited' ? '改造圖' : '對照圖',
    p.type,
    p.original,
    p.correct ? '是' : '否',
    p.hashDistance,
    p.embedSim === null ? '' : p.embedSim.toFixed(4),
    p.localGood,
    p.localInliers,
    p.changedRatio === null ? '' : p.changedRatio.toFixed(4),
    p.faceDist === null ? '' : p.faceDist.toFixed(4),
    p.verdict,
  ]);
  // 開頭加 BOM，試算表軟體才會把中文讀對
  const text = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `比對實驗-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function copySummary() {
  const head = ['方法', '認回率（相符）', '認回率（含部分相符）', '對照圖誤判率（相符）', '對照圖誤判率（含部分相符）', '配錯原圖（含部分相符）'];
  const text = [head, ...summaryRows].map((r) => r.join('\t')).join('\n');
  const btn = $('copy-summary');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '已複製，可貼到試算表或文件';
  } catch (_) {
    btn.textContent = '複製失敗，請直接選取表格';
  }
  setTimeout(() => (btn.textContent = '複製摘要表格'), 3000);
}

for (const key of ['originals', 'edited', 'negatives']) {
  $(key).addEventListener('change', (e) => {
    files[key] = [...e.target.files];
    refreshInputs();
  });
}
$('run').addEventListener('click', run);
$('download-csv').addEventListener('click', downloadCsv);
$('copy-summary').addEventListener('click', copySummary);
